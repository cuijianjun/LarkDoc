'use strict'

/**
 * 真实浏览器验证：拆包后的按需加载确实生效（0.6.x）
 *
 * 依赖：playwright-core（NODE_PATH 指向已装 node_modules）+ 本机 chromium 缓存
 * 前置：Demo 已起（apps/vue2-webpack-node14: npm run dev）且已 npm run build:element
 * 运行：
 *   NODE_PATH=/Users/cjjxw/.workbuddy/binaries/node/workspace/node_modules \
 *   node scripts/verify-browser-splitting.js [vueUrl] [wcUrl]
 *
 * 断言清单（每个路由一组）：
 *  1. 编辑器挂载，工具栏可用
 *  2. 首屏没有下载 office / markdown / highlight / import-export 区块
 *     （math 与 mermaid vendor 会因初始内容含公式 / 图表而加载 —— 这正是按需生效的证据）
 *  3. WC 路由：element 主文件 ≤ 1 MiB（改造前是 2.16 MiB 单文件）
 *  4. 插入代码块 → highlight 区块按需下载 + 高亮类渲染（Vue 路由，暴露 window.__feishu）
 *  5. mermaid vendor 脚本本地按需注入 + 预览层渲染出 SVG
 *  6. 无 404、无页面脚本错误
 */

const path = require('path')
const fs = require('fs')
const { chromium } = require('playwright-core')

const VUE_URL = process.argv[2] || 'http://localhost:8080/feishu-document'
const WC_URL = process.argv[3] || 'http://localhost:8080/feishu-document-wc'

function findChromium() {
  const cache = path.join(process.env.HOME || '', 'Library', 'Caches', 'ms-playwright')
  if (!fs.existsSync(cache)) return null
  const dirs = fs.readdirSync(cache)
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
  for (const dir of dirs) {
    const candidates = [
      path.join(cache, dir, 'chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
      path.join(cache, dir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
    ]
    for (const c of candidates) if (fs.existsSync(c)) return c
  }
  return null
}

const results = []
function record(name, ok, detail) {
  results.push({ name, ok, detail: detail || '' })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

/** 与首屏无关、必须按需下载的区块。math / mermaid 由初始内容决定，单独统计。 */
const SHOULD_BE_LAZY = /(office|markdown|highlight|import-export)[^/]*\.js(\?|$)/i
const ON_DEMAND_ALL = /(math|office|markdown|highlight|import-export)[^/]*\.js(\?|$)|vendor\/mermaid/i
const kb = (v) => `${(v / 1024).toFixed(0)} KiB`

async function runRoute(page, url, label, isWc) {
  console.log(`\n—— ${label}（${url}）——`)
  const scripts = []
  const failures = []
  const pageErrors = []
  const onRequest = (request) => { if (request.resourceType() === 'script') scripts.push(request.url()) }
  const onResponse = (response) => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`) }
  const onError = (error) => pageErrors.push(String(error))
  page.on('request', onRequest)
  page.on('response', onResponse)
  page.on('pageerror', onError)

  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 })
  await page.waitForSelector('.ProseMirror', { timeout: 30000 })
  await page.waitForSelector('.feishu-toolbar', { timeout: 30000 })

  // 1. 挂载
  const buttons = await page.locator('.feishu-toolbar button').count()
  record(`[${label}] 编辑器挂载且工具栏可用`, buttons > 10, `按钮=${buttons}`)

  // 2. 首屏按需区块：office / markdown / highlight 必须缺席
  const firstScreen = scripts.slice()
  const leaked = firstScreen.filter((entry) => SHOULD_BE_LAZY.test(entry))
  const onDemand = firstScreen.filter((entry) => ON_DEMAND_ALL.test(entry))
  record(`[${label}] 首屏未下载 office / markdown / highlight 区块`, leaked.length === 0,
    leaked.slice(0, 3).join(' | ') || `首屏脚本 ${firstScreen.length} 个，按需区块 ${onDemand.length} 个（${onDemand.map((u) => u.split('/').pop()).join(',') || '无'}）`)

  // 3. WC：element 运行时 chunk 寻址正确（publicPath:'auto' 能解析到 /js/）
  if (isWc) {
    const chunk = firstScreen.find((entry) => /feishu-document-element\.umd\.min\.(math|office|highlight|markdown)\.js(\?|$)/.test(entry))
    let ok = false
    let detail = '首屏未请求按需区块'
    if (chunk) {
      const response = await page.request.get(chunk)
      ok = response.status() === 200
      detail = `${response.status()} ${chunk.split('/').pop()}`
    }
    record(`[${label}] element 按需区块按 publicPath:'auto' 正确寻址`, ok, detail)
    const mainUrl = new URL('/js/feishu-document-element.umd.min.js', url).toString()
    const mainResponse = await page.request.get(mainUrl)
    const mainSize = mainResponse.status() === 200 ? (await mainResponse.body()).length : 0
    record(`[${label}] element 主文件 ≤ 1 MiB`, mainSize > 0 && mainSize <= 1024 * 1024, `${mainResponse.status()} ${kb(mainSize)}`)
  }

  // 4. mermaid vendor 本地按需注入 + SVG（走初始内容里的图表块）
  const diagram = await page.evaluate(() => {
    const script = document.querySelector('script[data-feishu-diagram="mermaid"]')
    return {
      src: script ? (script.getAttribute('src') || '') : '',
      sameOrigin: script ? new URL(script.src, location.href).host === location.host : false,
      svg: document.querySelectorAll('.feishu-diagram svg').length,
    }
  })
  record(`[${label}] mermaid vendor 本地脚本按需注入并渲染 SVG`, !!diagram.src && diagram.sameOrigin && diagram.svg > 0,
    `src=${diagram.src || '(未注入)'} svg=${diagram.svg}`)

  // 5. 代码块 → highlight 区块按需加载
  scripts.length = 0
  const hasApi = await page.evaluate(() => !!(window.__feishu && window.__feishu.getEditor && window.__feishu.getEditor()))
  if (hasApi) {
    await page.evaluate(() => {
      window.__feishu.getEditor().commands.setContent('<pre><code class="language-javascript">const answer = 42</code></pre>')
    })
    await page.waitForTimeout(2000)
    const highlighted = await page.locator('.feishu-code [class^="hljs-"]').count()
    const pulled = scripts.filter((entry) => /highlight/i.test(entry))
    record(`[${label}] 代码块触发 highlight 区块下载并渲染高亮`, highlighted > 0 && pulled.length > 0,
      `高亮节点=${highlighted}，新增 highlight 脚本=${pulled.length}`)
  } else {
    record(`[${label}] 代码块触发 highlight 区块下载并渲染高亮`, true, '该路由未暴露 window.__feishu，跳过')
  }

  // 6. 无 404 / 无脚本错误
  record(`[${label}] 无 404 / 无页面脚本错误`, failures.length === 0 && pageErrors.length === 0,
    [...failures.slice(0, 2), ...pageErrors.slice(0, 2)].join(' | '))

  page.off('request', onRequest)
  page.off('response', onResponse)
  page.off('pageerror', onError)
}

async function main() {
  const executablePath = findChromium()
  if (!executablePath) throw new Error('未找到本机 chromium 缓存')
  const browser = await chromium.launch({ headless: true, executablePath })
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  try {
    await runRoute(page, VUE_URL, 'vue', false)
    await runRoute(page, WC_URL, 'wc', true)
  } finally {
    await browser.close()
  }
  const failed = results.filter((item) => !item.ok)
  console.log(`\n${results.length - failed.length}/${results.length} 项通过`)
  if (failed.length) process.exit(1)
}

main().catch((error) => {
  console.error('验证脚本异常:', error)
  process.exit(1)
})
