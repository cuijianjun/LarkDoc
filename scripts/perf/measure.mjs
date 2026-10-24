/**
 * measure.mjs — P0-10 性能基线采集（requirements/09 §2.4.3，决策 6「先实测，不达标才优化」）。
 *
 * 环境口径：element UMD 产物 + 静态宿主页（与 e2e 冒烟同构，Node 22 + playwright-core）。
 * 7 指标中 6 项在此采集，主包 gzip 由 `npm run size`（size-limit）已在 check 链覆盖：
 *   1. mountToTypeableMs   首屏可输入：setContent(2000 块) → focus → 首次键入事务提交（浏览器时钟打点）
 *   2. keystrokeP95Ms/P99  击键 → 下一帧渲染：insertContent + 双 rAF，30 次采样取分位
 *   3. decorationsRebuildMs 单次全量装饰重建：view.updateState(view.state) 强制重算，20 次 中位数
 *      （现实现每次 update 全量重建装饰 —— extensions.js，P7-01 脏区更新的优化对象）
 *   4. scrollFps           中段连续滚动 3s 的 rAF 帧率
 *   5. saveProxyMs         整篇保存代理：全篇 getJSON() 序列化 10 次中位数
 *      （element 宿主无 workspace.save；落库口径就是 JSON 序列化，见 workspace 落库 json）
 *   6. heapMB              打开 2,000 块静置后 CDP 强制 GC + Runtime.getHeapUsage
 *
 * 产出 perf/.perf-result.json；基线更新走 report.mjs --update（不许手填）。
 * 环境变量：PERF_SEED（默认 42）、PERF_BLOCKS（默认 2000）、LARK_DOC_CHROMIUM。
 */

import { createRequire } from 'module'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDocHtml } from './build-doc.mjs'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')

const SEED = Number(process.env.PERF_SEED || 42)
const BLOCKS = Number(process.env.PERF_BLOCKS || 2000)
// 大文档下单次重建可达秒级，采样次数自适应下调（中位数/分位口径不变，数字仍真实）：
// 2000 块时击键 8 次、装饰重建 5 次；小文档足量采样。
const KEYSTROKE_SAMPLES = BLOCKS >= 1500 ? 8 : 30
const DECORATION_SAMPLES = BLOCKS >= 1500 ? 5 : 20
const SCROLL_SECONDS = 3

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

const median = (samples) => {
  const sorted = [...samples].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
const percentile = (samples, p) => {
  const sorted = [...samples].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * sorted.length) - 1))]
}
const round1 = (value) => Math.round(value * 10) / 10

async function main() {
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

  const { server, port } = await serveStatic(runDir)
  const executablePath = findChromium()
  if (!executablePath) throw new Error('未找到本机 chromium 缓存，无法采集性能基线')
  const browser = await loadChromiumDriver().launch({ headless: true, executablePath })
  const page = await (await browser.newContext()).newPage()

  try {
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

    // 3. 单次全量装饰重建：updateState(同状态) 强制重算，取中位数
    console.log('[measure] 3/6 装饰重建耗时...')
    const decorationsSamples = await page.evaluate((count) => {
      const editor = window.__larkDoc.getEditor()
      const samples = []
      for (let i = 0; i < count; i += 1) {
        const start = performance.now()
        editor.view.updateState(editor.view.state)
        samples.push(performance.now() - start)
      }
      return samples
    }, DECORATION_SAMPLES)

    // 4. 滚动帧率：文档中段连续滚动 3s，rAF 计帧
    console.log(`[measure] 4/6 滚动帧率（${SCROLL_SECONDS}s）...`)
    const scrollFps = await page.evaluate((seconds) => {
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
        decorationsRebuildMs: round1(median(decorationsSamples)),
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
    await browser.close()
    server.close()
  }
}

main().catch((error) => {
  console.error('性能采集失败:', error.message)
  process.exit(1)
})
