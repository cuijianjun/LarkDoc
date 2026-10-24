'use strict'

/**
 * 真实浏览器验证：主题（深色档）外观断言集（0.12 T3 / T4）
 *
 * 依赖：playwright-core（NODE_PATH 指向已装 node_modules）+ 本机 chromium 缓存
 * 运行：
 *   NODE_PATH=/Users/cjjxw/.workbuddy/binaries/node/workspace/node_modules \
 *   node scripts/verify-browser-theme.js [baseUrl]
 *
 * 断言清单：
 *  T3-04 表格：深色下只换线（#434343）、单元格恒透明、表头底 α0.08
 *  T3-05 图片：--ld-media-dim 默认 1（不改像素），宿主设 0.85 即生效
 *  T3-07 打印：深色档下 emulateMedia('print') 一律出浅稿（白底深字浅表格线）
 *  G1     主题引擎四属性落盘（data-theme / data-content-theme / source / color-scheme）
 *         —— 见 scripts/verify-browser-mermaid.js 的图表专测
 */

const path = require('path')
const fs = require('fs')
const { chromium } = require('playwright-core')

const BASE_URL = process.argv[2] || 'http://localhost:8080/lark-doc'
const SHOT_DIR = path.join(__dirname, '..', '.verify-shots')

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
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate
    }
  }
  return null
}

const results = []
function record(name, ok, detail) {
  results.push({ name, ok, detail: detail || '' })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const READ_PAGE = `(() => {
  const cs = (sel, prop) => {
    const el = document.querySelector(sel)
    return el ? getComputedStyle(el)[prop] : null
  }
  const root = document.querySelector('.lark-doc')
  return {
    tdBorder: cs('.ProseMirror td', 'borderTopColor'),
    thBg: cs('.ProseMirror th', 'backgroundColor'),
    tdBg: cs('.ProseMirror td', 'backgroundColor'),
    imgFilter: cs('.lark-doc-image-frame img', 'filter'),
    paperBg: cs('.lark-doc-paper', 'backgroundColor'),
    textColor: cs('.ProseMirror p', 'color'),
    mediaDim: root ? getComputedStyle(root).getPropertyValue('--ld-media-dim').trim() : null,
  }
})()`

async function main() {
  const executablePath = findChromium()
  if (!executablePath) throw new Error('未找到本机 chromium 缓存')
  const browser = await chromium.launch({ headless: true, executablePath })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(String(error)))

  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 60000 })
    await page.waitForSelector('.ProseMirror', { timeout: 30000 })

    // 图片节点会被离线策略拦掉外链 / data URI，插入同结构 DOM 只为验证 CSS 级联。
    await page.evaluate(() => {
      document.querySelector('.lark-doc-paper').insertAdjacentHTML('beforeend',
        '<figure class="lark-doc-image" data-align="center"><div class="lark-doc-image-frame">' +
        '<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="t"></div></figure>')
      const editor = window.__larkDoc.getEditor()
      if (editor.commands.insertTable) editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true })
    })
    await page.waitForTimeout(1200)

    const light = await page.evaluate(READ_PAGE)
    record('浅色表格线 = 绿档 #d4e0d9', light.tdBorder === 'rgb(212, 224, 217)', light.tdBorder)
    record('浅色未设 --ld-media-dim 时图片不压暗', light.imgFilter === 'brightness(1)', light.imgFilter)

    // ---- 深色档 ----
    await page.evaluate(() => { window.__larkDoc.setTheme('dark', 'dark') })
    await page.waitForTimeout(1000)
    const dark = await page.evaluate(READ_PAGE)
    record('T3-04 表格线深色 #434343（只换线）', dark.tdBorder === 'rgb(67, 67, 67)', dark.tdBorder)
    record('T3-04 单元格恒透明（M7）', dark.tdBg === 'rgba(0, 0, 0, 0)', dark.tdBg)
    record('T3-04 表头底 α0.08', dark.thBg === 'rgba(207, 207, 207, 0.08)', dark.thBg)
    record('T3-04 正文纸张 #292929', dark.paperBg === 'rgb(41, 41, 41)', dark.paperBg)
    record('T3-05 深色档默认仍不压暗（开关留给宿主）', dark.imgFilter === 'brightness(1)', dark.imgFilter)

    await page.evaluate(() => { document.querySelector('.lark-doc').style.setProperty('--ld-media-dim', '0.85') })
    await page.waitForTimeout(300)
    const dimmed = await page.evaluate(() => {
      const el = document.querySelector('.lark-doc-image-frame img')
      return el ? getComputedStyle(el).filter : null
    })
    record('T3-05 宿主设 --ld-media-dim: .85 后即生效', dimmed === 'brightness(0.85)', dimmed)
    await page.screenshot({ path: path.join(SHOT_DIR, 'theme-01-dark.png'), fullPage: true })

    // ---- T3-07：打印强制浅稿 ----
    await page.emulateMedia({ media: 'print' })
    await page.waitForTimeout(500)
    const printed = await page.evaluate(READ_PAGE)
    record('T3-07 打印时正文纸张为白', printed.paperBg === 'rgb(255, 255, 255)', printed.paperBg)
    record('T3-07 打印时正文文字恢复深色', printed.textColor === 'rgb(38, 56, 48)', printed.textColor)
    record('T3-07 打印时表格线恢复浅色', printed.tdBorder === 'rgb(212, 224, 217)', printed.tdBorder)
    await page.emulateMedia({ media: 'screen' })

    record('无页面脚本错误', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))
  } finally {
    await browser.close()
  }

  const failed = results.filter((item) => !item.ok)
  console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`)
  if (failed.length) {
    process.exitCode = 1
    failed.forEach((item) => console.error(`FAIL: ${item.name} ${item.detail}`))
  }
}

fs.mkdirSync(SHOT_DIR, { recursive: true })
main().catch((error) => { console.error('验证脚本异常:', error); process.exit(1) })
