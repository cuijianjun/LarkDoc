/**
 * measure.mjs — P0-10 性能基线采集（requirements/09 §2.4.3，决策 6「先实测，不达标才优化」）。
 *
 * 环境口径：element UMD 产物 + 静态宿主页（与 e2e 冒烟同构，Node 22 + playwright-core）。
 * 7 指标中 6 项在此采集，主包 gzip 由 `npm run size`（size-limit）已在 check 链覆盖：
 *   1. mountToTypeableMs   首屏可输入：setContent(2000 块) → focus → 首次键入事务提交（浏览器时钟打点）
 *   2. keystrokeP95Ms/P99  击键 → 下一帧渲染：insertContent + 双 rAF，30 次采样取分位
 *   3. decorationIncrementalMs 击键路径上的装饰耗时：发文本块内纯文字改动，取 derive 层打点中位数
 *      （P7-01 之后装饰走脏区增量；全量重建只在首次装配/换文档/invalidate 时发生）
 *   4. scrollFps           中段连续滚动 3s 的 rAF 帧率
 *   5. saveProxyMs         整篇保存代理：全篇 getJSON() 序列化 10 次中位数
 *      （element 宿主无 workspace.save；落库口径就是 JSON 序列化，见 workspace 落库 json）
 *   6. heapMB              打开 2,000 块静置后 CDP 强制 GC + Runtime.getHeapUsage
 *
 * 产出 perf/.perf-result.json；基线更新走 report.mjs --update（不许手填）。
 *
 * 采集前的两道自检（P8-00，见 perf/preflight.mjs 与下方 `waitForIdleMachine`）：
 *   - 机器负载：`check:perf` 串跑时 build 尾流会把 loadavg 推到 2 倍以上，此时采样得到的是
 *     采集环境而不是指标，故先等到 `loadavg[0] <= max(4, cores×0.5)` 再起浏览器；
 *   - 孤儿浏览器：上一次被 kill 的 headless Chromium 不会自己退，会逐轮叠加吃满 CPU。
 *     起浏览器前报告数量，超时未回落时直接提示清理命令（不自动杀，避免误伤并行采集）。
 *
 * 环境变量：
 *   PERF_SEED              文档种子（默认 42）
 *   PERF_BLOCKS            块数（默认 2000）
 *   LARK_DOC_CHROMIUM      Chromium 可执行文件路径
 *   PERF_KEYSTROKE_SAMPLES 击键采样数（默认 30）
 *   PERF_SKIP_LOAD_WAIT    置 1 跳过负载等待（只给「明知机器忙但要一份数」的场合用）
 *   PERF_LOAD_WAIT_MS      负载等待上限毫秒数（默认 180000）
 *   PERF_LOAD_MAX          直接指定 1 分钟负载上限（默认按「核数 × 0.5 且不低于 4」换算）
 */

import { execSync } from 'node:child_process'
import { createRequire } from 'module'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDocHtml } from './build-doc.mjs'
import { evaluateLoad } from './preflight.mjs'
import { median, percentile } from './stats.mjs'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')

const SEED = Number(process.env.PERF_SEED || 42)
const BLOCKS = Number(process.env.PERF_BLOCKS || 2000)
// 击键采样数：统一 30 次，不再随块数下调。
//
// 早先「2,000 块降到 8 次」是为了压总耗时，代价是分位数失去意义 —— 8 个样本下
// `percentile(v, 0.95)` 取到的就是最大值（见下面 `percentile` 的注释），于是 p95 与 p99
// 恒等、单次抖动直接决定基线，同机重复采集实测极差 2.65 倍（2578 / 4343.9 / 6837.7）。
// 30 个样本足够让 p95 的秩落在 27.55（有序第 28 与第 29 个之间），最坏耗时约 30 × 2.6s ≈ 1 分钟，仍在
// `check:perf` 的预算里。本地想快跑可用 `PERF_KEYSTROKE_SAMPLES` 覆盖。
const KEYSTROKE_SAMPLES = Number(process.env.PERF_KEYSTROKE_SAMPLES || 30)
// 装饰增量探针只发便宜的文字事务，但每次仍会触发一次整篇 view
// 更新（DOM 补丁 + 排版，2,000 块实测整段 dispatch 约 196 ms、抖动 < 3%），
// 2,000 块时 20 次即可 —— 这里的样本是 `derive` 层打点（2,000 块约 79 ms），
// 不是整段 dispatch，别把两个量级混着读。
const DECORATION_SAMPLES = 20
const SCROLL_SECONDS = 3
// 滚动要预热：首轮是首次布局/合成，不是滚动帧率（见第 4 段注释）。取 3 轮中位数。
const SCROLL_ROUNDS = 3
// 负载等待：默认最多 3 分钟。build 尾流一般 1~2 分钟内衰减到阈值以下，
// 超过这个时间还没回落，说明不是尾流而是别的东西在持续跑（含孤儿浏览器），继续等没有意义。
const LOAD_WAIT_MS = Number(process.env.PERF_LOAD_WAIT_MS || 180000)
const LOAD_POLL_MS = 3000
// 直接指定上限（默认按核数换算）。CI 按运行器写死时用，也让「机器忙就等」这条路径可被手工验证。
const LOAD_MAX = Number(process.env.PERF_LOAD_MAX || 0)
// 上一次被 kill 的采集会留下 headless Chromium：Playwright 的 profile 目录名固定带这个标记，
// 起浏览器前 `pgrep -f` 就能数出来。只报告、不自动杀 —— 并行跑两份采集时会误伤别人的进程。
const ORPHAN_PATTERN = 'playwright_chromiumdev_profile'

/** 数一下当前已有的 headless Chromium：本进程还没 launch，所以数到的都是别人/孤儿。 */
function countOrphanChromium() {
  try {
    const out = execSync(`pgrep -f ${ORPHAN_PATTERN} || true`, { encoding: 'utf8' })
    return out.split('\n').filter((line) => line.trim()).length
  } catch (err) {
    // 没有 pgrep（Windows）或权限不足：当作数不出来，不影响采集。
    return 0
  }
}

/**
 * 等机器静下来再采。
 *
 * 这不是保险丝而是**口径**：热机采到的数字不可与冷机基线比较，宁可等，也不写一份
 * 看起来更低/更高的假指标（2026-10-28 因此连挂 5 次假红灯，见 perf/preflight.mjs 头注）。
 */
async function waitForIdleMachine() {
  if (process.env.PERF_SKIP_LOAD_WAIT === '1') {
    console.warn('[measure] PERF_SKIP_LOAD_WAIT=1，跳过负载等待 —— 本次数字可能偏热，不可与冷机基线混比')
    return
  }
  const cores = os.cpus().length
  const startedAt = Date.now()
  for (;;) {
    const state = evaluateLoad({ load1: os.loadavg()[0], cores, limit: LOAD_MAX || undefined })
    if (state.idle) {
      const shown = state.known ? state.load1.toFixed(2) : '不可读'
      console.log(`[measure] 机器负载 ${shown}（上限 ${state.limit}，${cores} 核），开始采集`)
      return
    }
    const waited = Date.now() - startedAt
    if (waited >= LOAD_WAIT_MS) {
      const orphans = countOrphanChromium()
      const hint = orphans
        ? `检测到 ${orphans} 个 headless Chromium 进程（多为上次采集被 kill 的孤儿）；先执行 pkill -f ${ORPHAN_PATTERN} 再重跑`
        : '确认没有并行的构建、文档打包或另一次采集在跑'
      throw new Error(`等待 ${Math.round(waited / 1000)}s 后 1 分钟负载仍为 ${state.load1.toFixed(2)} > 上限 ${state.limit}（${cores} 核）—— 热机采集不可比，${hint}`)
    }
    console.log(`[measure] 机器仍在忙（load ${state.load1.toFixed(2)} > 上限 ${state.limit}），已等 ${Math.round(waited / 1000)}s，${LOAD_POLL_MS / 1000}s 后重试...`)
    await new Promise((resolve) => setTimeout(resolve, LOAD_POLL_MS))
  }
}

// 浏览器与静态服务挂在模块级，只为了在信号里也能关掉它们。
// 坑：`finally` 只在正常返回/抛错时执行，进程被 SIGTERM / Ctrl-C 打断时**不会**，
// 于是 headless Chromium 变成孤儿、带着满文档继续吃 CPU，下一轮采集就被它污染。
let activeBrowser = null
let activeServer = null
let teardownDone = false
// 信号已经接管退出流程：此时 `main()` 内部的 promise 也会 reject（页面在关），
// 若让 `main().catch` 照常 `exit(1)`，就抢在 handler 前面把「被中断」（130）报成「采集失败」。
let interruptedBySignal = false

async function teardown() {
  if (teardownDone) return
  teardownDone = true
  const browser = activeBrowser
  const server = activeServer
  activeBrowser = null
  activeServer = null
  if (browser) {
    // 浏览器可能已经崩了，close() 会 reject。目的是不留进程，失败就算了，但别无限等。
    await Promise.race([
      browser.close().catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ])
  }
  if (server) await new Promise((resolve) => server.close(() => resolve()))
}

function installTeardownHandlers() {
  const onSignal = (signal) => {
    interruptedBySignal = true
    console.error(`\n[measure] 收到 ${signal}，正在关闭浏览器以免留下孤儿 Chromium...`)
    teardown().finally(() => process.exit(130))
  }
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, () => onSignal(signal))
  // launch 之后的未捕获异常同样走这里：否则浏览器会一直活到机器重启。
  process.once('uncaughtException', (error) => {
    console.error('\n[measure] 未捕获异常:', error && error.message)
    teardown().finally(() => process.exit(1))
  })
}

function loadChromiumDriver() {
  const names = ['playwright-core', 'playwright']
  for (const name of names) {
    try {
      return require(name).chromium
    } catch (err) { /* 继续尝试 */ }
  }
  // npm run 环境没有 NODE_PATH：本机全局工作区目录显式回退（与 verify-smoke 的 NODE_PATH 用法同源）。
  const localModules = `${process.env.HOME}/.workbuddy/binaries/node/workspace/node_modules`
  for (const name of names) {
    try {
      return require(path.join(localModules, name)).chromium
    } catch (err) { /* 继续尝试 */ }
  }
  throw new Error('未找到 playwright-core / playwright —— 请 export NODE_PATH=... 或 npm i --no-save playwright')
}

/** 与 scripts/verify-smoke.js 同款查找顺序（env 覆盖 → macOS 缓存 → Linux 缓存）。 */
function findChromium() {
  if (process.env.LARK_DOC_CHROMIUM && fs.existsSync(process.env.LARK_DOC_CHROMIUM)) {
    return process.env.LARK_DOC_CHROMIUM
  }
  for (const cache of [
    `${process.env.HOME}/Library/Caches/ms-playwright`,
    `${process.env.HOME}/.cache/ms-playwright`,
  ]) {
    if (!fs.existsSync(cache)) continue
    const dirs = fs.readdirSync(cache).filter((dir) => /^chromium-\d+$/.test(dir)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
    for (const dir of dirs) {
      for (const candidate of [
        `${cache}/${dir}/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
        `${cache}/${dir}/chrome-mac/Chromium.app/Contents/MacOS/Chromium`,
        `${cache}/${dir}/chrome-linux/chrome`,
      ]) if (fs.existsSync(candidate)) return candidate
    }
  }
  return null
}

/** 起静态服务（复用 e2e 冒烟的 element UMD 宿主方案），随机端口。 */
function serveStatic(dir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = req.url.split('?')[0]
      const file = path.join(dir, urlPath === '/' ? 'index.html' : urlPath)
      try {
        res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8')
        res.end(fs.readFileSync(file))
      } catch (err) {
        res.statusCode = 404
        res.end('not found')
      }
    })
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

// 统计口径单独放 scripts/perf/stats.mjs：本文件在模块顶层就 `main()` 起浏览器，
// 单元测试没法 import 它，而分位数恰恰是最需要被用例钉住的一段逻辑。
//
// `percentile` 曾经用 `sorted[round(p*n)-1]`，8 个样本下 p95 恒等于最大值、与 p99 同值，
// 现在改成线性插值。详见 stats.mjs 的注释与 test/unit/perf-stats.test.js。
const round1 = (value) => Math.round(value * 10) / 10

async function main() {
  installTeardownHandlers()

  const html = buildDocHtml({ seed: SEED, blocks: BLOCKS })
  const runDir = path.join(repoRoot, 'perf', '.run')
  fs.mkdirSync(runDir, { recursive: true })
  fs.writeFileSync(path.join(runDir, 'index.html'), [
    '<!doctype html><html><head><meta charset="utf-8">',
    '<style>lark-doc{display:block;width:960px;height:860px;margin:12px auto}</style></head>',
    '<body><lark-doc id="doc"></lark-doc>',
    '<script src="./lark-doc-element.umd.min.js"></script>',
    '<script>window.__larkDoc = document.getElementById("doc")</script>',
    '</body></html>',
  ].join('\n'))
  fs.copyFileSync(path.join(repoRoot, 'dist', 'lark-doc-element.umd.min.js'), path.join(runDir, 'lark-doc-element.umd.min.js'))

  // 起浏览器前的两道自检。先报孤儿（原因）再等负载（结果），否则用户只看到「一直在等」。
  const orphans = countOrphanChromium()
  if (orphans) {
    console.warn(`[measure] 警告：已有 ${orphans} 个 headless Chromium 在跑（多为上次采集被 kill 留下的孤儿），会让本次数字偏热`)
  }
  await waitForIdleMachine()

  const { server, port } = await serveStatic(runDir)
  activeServer = server

  try {
    const executablePath = findChromium()
    if (!executablePath) throw new Error('未找到本机 chromium 缓存，无法采集性能基线')
    activeBrowser = await loadChromiumDriver().launch({ headless: true, executablePath })
    const browser = activeBrowser
    const page = await (await browser.newContext()).newPage()

    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForFunction(
      () => window.__larkDoc && typeof window.__larkDoc.getEditor === 'function' && window.__larkDoc.getEditor(),
      { timeout: 60000 },
    )

    // 1. 首屏可输入：灌 2000 块 → focus → 真键盘敲第一个字 → 事务提交（浏览器时钟 mark 对 mark）
    console.log(`[measure] 1/6 首屏灌入 ${BLOCKS} 块（${Math.round(html.length / 1024)} KB）...`)
    await page.evaluate((contentHtml) => {
      const editor = window.__larkDoc.getEditor()
      window.__perfFirstTyped = false
      editor.on('transaction', () => {
        if (!window.__perfFirstTyped) {
          window.__perfFirstTyped = true
          performance.mark('perf:first-typed')
        }
      })
      performance.mark('perf:mount-start')
      editor.commands.setContent(contentHtml)
      editor.commands.focus('start')
    }, html)
    await page.keyboard.type('测')
    const mountToTypeableMs = await page.evaluate(() => {
      return performance.measure('perf:mount', 'perf:mount-start', 'perf:first-typed').duration
    })

    // 2. 击键 → 下一帧渲染：连续 30 次，事务分发 + 双 rAF
    console.log('[measure] 2/6 击键延迟采样...')
    const keystrokeSamples = await page.evaluate(async (count) => {
      const samples = []
      const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const editor = window.__larkDoc.getEditor()
      const paragraphPositions = []
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'paragraph' && !paragraphPositions.length) paragraphPositions.push(pos)
      })
      const end = paragraphPositions[0] + 1 + editor.state.doc.nodeAt(paragraphPositions[0]).nodeSize - 1
      editor.commands.setTextSelection(end)
      editor.commands.focus()
      for (let i = 0; i < count; i += 1) {
        const start = performance.now()
        editor.commands.insertContent(`字${i}`)
        await nextFrame()
        samples.push(performance.now() - start)
      }
      return samples
    }, KEYSTROKE_SAMPLES)

    // 3. 击键路径的装饰增量耗时：发一笔**文本块内的纯文字改动**，只量装饰那一层。
    //
    // 口径变更史（三段数字不可互换，任何两段拼成「−100%」都是假结论）：
    //   ① P7 前：每次 update 都全量重扫 2,000 块，`view.updateState(view.state)` 量到 21186.3；
    //   ② P7-01 落地后：同一 state 重放只命中缓存，于是改发纯 meta 事务 —— 但那笔事务被插件
    //      判成「不动装饰」，量到的 35.1 是 dispatch 固定开销，装饰根本没重建；
    //   ③ 现在：量**击键路径本身**。derive 层在 `decorations()` 里自带打点（`__larkDocPerf`），
    //      只统计走增量分支的那一段（`previous.map` + 脏区重扫），不含 DOM 补丁、排版与合成。
    //
    // 采样动作是插一个字符（纯文字改动 → isTextOnlyChange 通过 → 走增量），结束后一次删净。
    // 万一判据把它挡住了，会退回全量：宁可在这里大声失败，也不写一个「没有增量样本」的指标。
    console.log('[measure] 3/6 装饰增量耗时（击键路径）...')
    const { samples: decorationSamples, dispatchMs } = await page.evaluate((count) => {
      const view = window.__larkDoc.getEditor().view
      const sink = { samples: [] }
      window.__larkDocPerf = sink
      let pos = -1
      view.state.doc.descendants((node, p) => {
        if (pos >= 0) return false
        if (node.isTextblock && node.textContent.length > 16) pos = p + 1
        return pos < 0
      })
      if (pos < 0) throw new Error('找不到长度 > 16 的文本块，无法采集装饰增量')
      const samples = []
      const dispatch = []
      for (let i = 0; i < count; i += 1) {
        sink.samples.length = 0
        const start = performance.now()
        view.dispatch(view.state.tr.insertText('x', pos))
        dispatch.push(performance.now() - start)
        for (const sample of sink.samples) samples.push(sample)
      }
      // 收尾：把插进去的字符一次删净（同样是纯文字改动），别让后面的滚动/序列化背这笔账。
      view.dispatch(view.state.tr.delete(pos, pos + count))
      window.__larkDocPerf = null
      return { samples, dispatchMs: dispatch }
    }, DECORATION_SAMPLES)
    const incrementalSamples = decorationSamples.filter((sample) => sample.path === 'incremental').map((sample) => sample.ms)
    const rebuildCount = decorationSamples.filter((sample) => sample.path === 'rebuild').length
    if (!incrementalSamples.length) {
      throw new Error(`装饰探针没拿到增量样本（${decorationSamples.length} 次全部退回全量）—— 判据可能把文字改动也挡住了`)
    }
    console.log(`[measure]    增量 ${incrementalSamples.length} 次 / 退回全量 ${rebuildCount} 次；整段 dispatch 中位数 ${median(dispatchMs).toFixed(1)} ms`)
    // 分位诊断：只看中位数会掩盖长尾（GC、首次 map、窗口跨块的偶发），
    // 所以把 p95/max 一并打出来，便于判断抖动而不是靠猜。增量与整段 dispatch 相差约 2.5 倍，
    // 两行必须分开打 —— 混着打会让人以为「装饰只要 80 ms，那整篇重排不值一提」。
    const decorationStats = (values) => {
      const sorted = [...values].sort((a, b) => a - b)
      return `p50 ${median(sorted).toFixed(2)} / p95 ${percentile(sorted, 0.95).toFixed(2)} / max ${sorted[sorted.length - 1].toFixed(2)}`
    }
    console.log(`[measure]    装饰增量 ${decorationStats(incrementalSamples)} ms`)
    console.log(`[measure]    整段 dispatch ${decorationStats(dispatchMs)} ms`)

    // 4. 滚动帧率：文档中段连续滚动 3s，rAF 计帧
    //
    // 第一轮必须丢弃：它测到的是「这批块第一次进入视口」的首次布局与图层合成，
    // 是冷启动值而不是滚动帧率。2,000 块实测同一会话连续 7 轮为
    // 3 / 23.7 / 59.3 / 60.3 / 60.3 / 60.3 / 60.3 —— 首轮比稳态低 16~20 倍，
    // 单轮采样会让门禁在 1.7~3.7 之间随机摆动（±95%），完全无法判定退化。
    console.log(`[measure] 4/6 滚动帧率（${SCROLL_SECONDS}s，预热 1 轮后取 ${SCROLL_ROUNDS} 轮中位数）...`)
    const runScroll = () => page.evaluate((seconds) => {
      return new Promise((resolve) => {
        const candidates = [document.scrollingElement, ...document.querySelectorAll('lark-doc, lark-doc *')]
        let scroller = document.scrollingElement
        for (const el of candidates) {
          if (!el || el === document.scrollingElement) continue
          const style = getComputedStyle(el)
          if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 500) { scroller = el; break }
        }
        const startTop = scroller.scrollTop + scroller.scrollHeight * 0.25
        scroller.scrollTop = startTop
        let frames = 0
        const startAt = performance.now()
        const tick = () => {
          frames += 1
          scroller.scrollTop = startTop + ((performance.now() - startAt) / 1000) * 2200
          if (performance.now() - startAt < seconds * 1000) requestAnimationFrame(tick)
          else resolve(frames / seconds)
        }
        requestAnimationFrame(tick)
      })
    }, SCROLL_SECONDS)
    const scrollSamples = []
    for (let round = 0; round < SCROLL_ROUNDS + 1; round += 1) {
      const value = await runScroll()
      if (round > 0) scrollSamples.push(value)
    }
    const scrollFps = median(scrollSamples)

    // 5. 整篇保存代理：全篇 getJSON 序列化 10 次中位数
    console.log('[measure] 5/6 全篇序列化...')
    const saveSamples = await page.evaluate((count) => {
      const samples = []
      for (let i = 0; i < count; i += 1) {
        const start = performance.now()
        window.__larkDoc.getJSON()
        samples.push(performance.now() - start)
      }
      return samples
    }, 10)

    // 6. 堆内存：强制 GC 后 CDP Runtime.getHeapUsage
    console.log('[measure] 6/6 堆内存...')
    const client = await page.context().newCDPSession(page)
    await client.send('HeapProfiler.enable')
    await client.send('HeapProfiler.collectGarbage')
    await page.waitForTimeout(800)
    // CDP 响应形状：{ jsHeapSizeLimit, totalSize, usedSize }（兼容包一层 result 的驱动实现）
    const usage = await client.send('Runtime.getHeapUsage')
    const heapBytes = usage.usedSize ?? (usage.result && usage.result.usedSize) ?? 0

    const result = {
      seed: SEED,
      blockCount: BLOCKS,
      capturedAt: new Date().toISOString(),
      node: process.version,
      samples: { keystroke: KEYSTROKE_SAMPLES, decorations: DECORATION_SAMPLES, save: 10 },
      metrics: {
        mountToTypeableMs: round1(mountToTypeableMs),
        keystrokeP95Ms: round1(percentile(keystrokeSamples, 0.95)),
        keystrokeP99Ms: round1(percentile(keystrokeSamples, 0.99)),
        decorationIncrementalMs: round1(median(incrementalSamples)),
        scrollFps: round1(scrollFps),
        saveProxyMs: round1(median(saveSamples)),
        heapMB: round1(heapBytes / 1048576),
      },
    }
    const outPath = path.join(repoRoot, 'perf', '.perf-result.json')
    fs.writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`)
    console.log(`性能采集完成 → ${path.relative(repoRoot, outPath)}`)
    for (const [key, value] of Object.entries(result.metrics)) console.log(`  ${key} = ${value}`)
  } finally {
    // 统一出口：正常结束、抛错、被信号打断都走这里，别让 Chromium 活过本进程。
    await teardown()
  }
}

main().catch((error) => {
  // 信号 handler 已经在关浏览器并把退出码定成 130，这里不能再抢着 exit(1)。
  if (interruptedBySignal) return
  console.error('性能采集失败:', error.message)
  process.exit(1)
})
