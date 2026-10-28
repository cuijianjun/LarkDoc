/**
 * browser.mjs — 性能脚本共用的浏览器环境（headless Chromium + 静态宿主服务）。
 *
 * 从 `measure.mjs` 抽出来的原因：P8-01 的 `attribute.mjs` 要用同一套「element UMD 产物 +
 * 静态宿主页」口径去复现 `setContent` 全链。两处各抄一份的话，哪天宿主页的挂载方式变了
 * （比如 `window.__larkDoc` 改名），只会有一处被改到，另一处静静地量着另一个页面。
 *
 * 这里只有 IO，没有判据 —— 判据（负载门、分位数）分别在 preflight.mjs / stats.mjs，
 * 那两个是纯函数，由 test/unit/perf-*.test.js 钉住。
 */

import { createRequire } from 'module'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const REPO_ROOT = path.resolve(__dirname, '../..')

/** playwright-core 优先；本机全局工作区目录显式回退（npm run 环境没有 NODE_PATH）。 */
export function loadChromiumDriver() {
  const names = ['playwright-core', 'playwright']
  for (const name of names) {
    try {
      return require(name).chromium
    } catch (err) { /* 继续尝试 */ }
  }
  const localModules = `${process.env.HOME}/.workbuddy/binaries/node/workspace/node_modules`
  for (const name of names) {
    try {
      return require(path.join(localModules, name)).chromium
    } catch (err) { /* 继续尝试 */ }
  }
  throw new Error('未找到 playwright-core / playwright —— 请 export NODE_PATH=... 或 npm i --no-save playwright')
}

/** 与 scripts/verify-smoke.js 同款查找顺序（env 覆盖 → macOS 缓存 → Linux 缓存）。 */
export function findChromium() {
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
export function serveStatic(dir) {
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

/**
 * 把 element UMD 产物与宿主页铺到 `perf/.run/`，返回该目录。
 *
 * 宿主页与 `measure.mjs` 完全同构，只有 `window.__larkDoc` 一个契约 —— 归因脚本量的必须是
 * 采集脚本量的那个页面，否则两张数字放在同一份报告里没有意义。
 */
export function prepareHostPage(runDir) {
  fs.mkdirSync(runDir, { recursive: true })
  fs.writeFileSync(path.join(runDir, 'index.html'), [
    '<!doctype html><html><head><meta charset="utf-8">',
    '<style>lark-doc{display:block;width:960px;height:860px;margin:12px auto}</style></head>',
    '<body><lark-doc id="doc"></lark-doc>',
    '<script src="./lark-doc-element.umd.min.js"></script>',
    '<script>window.__larkDoc = document.getElementById("doc")</script>',
    '</body></html>',
  ].join('\n'))
  fs.copyFileSync(path.join(REPO_ROOT, 'dist', 'lark-doc-element.umd.min.js'), path.join(runDir, 'lark-doc-element.umd.min.js'))
  return runDir
}

/** 等 `window.__larkDoc.getEditor()` 可用（宿主页就绪的唯一信号）。 */
export async function waitForHostReady(page) {
  await page.waitForFunction(
    () => window.__larkDoc && typeof window.__larkDoc.getEditor === 'function' && window.__larkDoc.getEditor(),
    { timeout: 60000 },
  )
}
