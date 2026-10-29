#!/usr/bin/env node
/**
 * 断网特性包渲染验证（阶段 4 判据的浏览器侧验证）。
 *
 * 流程：起本地静态服务 → Playwright 打开 test/fixtures/offline-features.html
 * → 拦截并 abort 一切非本机请求（模拟断网）→ 等待 lite 主产物 + features/mermaid
 * 特性包把 mermaid 代码块渲染成 SVG → 断言渲染成功且零外部请求。
 *
 * 运行环境：Node 22 + playwright-core（NODE_PATH 指向共享 node_modules）。
 *   NODE_PATH=... node scripts/verify-offline-mermaid.mjs
 */
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// 前置：依赖已构建产物（dist/lark-doc-lite.esm.js + dist/features/mermaid.js）
for (const rel of ['dist/lark-doc-lite.esm.js', 'dist/features/mermaid.js']) {
  try {
    await import('node:fs').then((fs) => fs.accessSync(path.join(repoRoot, rel)))
  } catch {
    console.error(`FAIL：缺少 ${rel}，请先跑 npm run build:lite / build:features`)
    process.exit(1)
  }
}

const PORT = 18923
const BASE = `http://127.0.0.1:${PORT}`
const TIMEOUT_MS = 30_000

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, BASE)
      const rel = url.pathname === '/' ? '/index.html' : url.pathname
      const file = path.join(repoRoot, decodeURIComponent(rel))
      if (!file.startsWith(repoRoot)) {
        res.writeHead(403)
        res.end()
        return
      }
      import('node:fs').then((fs) => {
        fs.readFile(file, (error, data) => {
          if (error) {
            res.writeHead(404)
            res.end(`not found: ${rel}`)
            return
          }
          res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
          res.end(data)
        })
      })
    })
    server.listen(PORT, '127.0.0.1', () => resolve(server))
  })
}

async function main() {
  // ESM 不走 NODE_PATH，playwright-core 按共享目录绝对路径解析
  const { createRequire } = await import('node:module')
  const sharedRequire = createRequire(path.join(repoRoot, 'package.json'))
  const { chromium } = sharedRequire('/Users/cjjxw/.workbuddy/binaries/node/workspace/node_modules/playwright-core')
  // 1.64.1 需要的 headless_shell-1248 未下载，复用本机已有的 chromium-1228
  const executablePath = '/Users/cjjxw/Library/Caches/ms-playwright/chromium-1228/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
  const server = await serve()
  const blocked = []
  let browser
  try {
    browser = await chromium.launch({ headless: true, executablePath })
    const page = await browser.newPage()
    // 断网模拟：本机请求放行，其余一律 abort 并记账
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url())
      if (url.hostname === '127.0.0.1') route.continue()
      else {
        blocked.push(url.href)
        route.abort()
      }
    })
    page.on('pageerror', (error) => console.error('[pageerror]', error.message))

    await page.goto(`${BASE}/test/fixtures/offline-features.html`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(
      () => window.__offlineFixture && (window.__offlineFixture.created || window.__offlineFixture.error),
      null,
      { timeout: TIMEOUT_MS },
    )
    const fixture = await page.evaluate(() => window.__offlineFixture)
    if (!fixture.created) {
      throw new Error(`编辑器创建失败：${fixture.error}`)
    }
    // 300ms 防抖 + mermaid 初始化，30s 上限足够
    await page.waitForSelector('.lark-doc-diagram-svg svg', { timeout: TIMEOUT_MS })
    const svgInfo = await page.evaluate(() => {
      const svg = document.querySelector('.lark-doc-diagram-svg svg')
      return { exists: !!svg, nodes: svg ? svg.querySelectorAll('*').length : 0 }
    })
    if (!svgInfo.exists || svgInfo.nodes < 2) {
      throw new Error(`mermaid SVG 渲染异常：${JSON.stringify(svgInfo)}`)
    }
    if (blocked.length > 0) {
      throw new Error(`断网环境下仍发起外部请求：\n${blocked.join('\n')}`)
    }
    console.log(`PASS：断网下 features/mermaid 渲染成功（SVG 节点 ${svgInfo.nodes} 个），零外部请求`)
  } finally {
    if (browser) await browser.close().catch(() => {})
    server.close()
  }
}

main().catch((error) => {
  console.error('FAIL：', error.message)
  process.exit(1)
})
