'use strict'

/**
 * 真实浏览器验证：飞书式颜色盘（0.6.x）
 *
 * 依赖：playwright-core（NODE_PATH 指向已装 node_modules）+ 本机 chromium 缓存
 * 运行：
 *   NODE_PATH=/Users/cjjxw/.workbuddy/binaries/node/workspace/node_modules \
 *   node scripts/verify-browser-colors.js [baseUrl]
 *
 * 断言清单：
 *  1. 页面加载，编辑器挂载，工具栏只有 1 个合并颜色触发器（A + caret）
 *  2. 点击触发器 → 飞书式面板出现，含「字体颜色」与「背景颜色」两节
 *  3. 字体颜色 A 字行 8 个按钮
 *  4. 背景颜色网格两行、每行 9 格、首格为斜杠默认格
 *  5. 选中文字后点击红色 A → textStyle color 生效，触发器回显同步
 *  6. 重新打开面板 → 红色 A 有选中描边
 *  7. 点击浅红背景格 → backgroundColor 生效
 *  8. 点击默认斜杠格 → 背景清除
 *  9. 高亮块（callout）颜色面板仍是旧版圆形色块结构，功能不受影响
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

async function main() {
  const executablePath = findChromium()
  if (!executablePath) throw new Error('未找到本机 chromium 缓存')
  const browser = await chromium.launch({ headless: true, executablePath })
  const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } })
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(String(error)))

  try {
    // ---- 1. 页面加载 + 合并触发器 ----
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 60000 })
    await page.waitForSelector('.ProseMirror', { timeout: 30000 })
    await page.waitForSelector('.lark-doc-toolbar', { timeout: 30000 })
    const triggerCount = await page.locator('.lark-doc-toolbar label.lark-doc-color').count()
    record('工具栏只有 1 个合并颜色触发器', triggerCount === 1, `计数=${triggerCount}`)
    const triggerGlyph = await page.locator('.lark-doc-toolbar label.lark-doc-color .lark-doc-color-letter').first().textContent()
    record('触发器为 A 字 + 下拉箭头', triggerGlyph.trim() === 'A' && await page.locator('.lark-doc-toolbar label.lark-doc-color .lark-doc-caret').count() === 1, `glyph=${triggerGlyph.trim()}`)

    // ---- 2. 打开飞书式面板 ----
    await page.locator('.lark-doc-toolbar label.lark-doc-color').click()
    const panel = page.locator('.lark-doc-color-palette-text')
    await panel.waitFor({ state: 'visible', timeout: 5000 })
    const sectionTitles = await panel.locator('small').allTextContents()
    record('面板含「字体颜色」「背景颜色」两节', sectionTitles.join(',') === '字体颜色,背景颜色', JSON.stringify(sectionTitles))

    // ---- 3. A 字行 ----
    const letterCount = await panel.locator('.lark-doc-color-letters button').count()
    record('字体颜色 A 字行 8 个', letterCount === 8, `计数=${letterCount}`)

    // ---- 4. 背景网格 ----
    const rows = await panel.locator('.lark-doc-color-grid').count()
    const rowCells = await panel.locator('.lark-doc-color-grid').first().locator('button').count()
    const row2Cells = await panel.locator('.lark-doc-color-grid').nth(1).locator('button').count()
    const hasDefault = await panel.locator('.lark-doc-color-grid button.is-transparent').first().isVisible()
    record('背景网格两行、各 9 格', rows === 2 && rowCells === 9 && row2Cells === 9, `行=${rows} 首行=${rowCells} 次行=${row2Cells}`)
    record('首格为斜杠默认格', hasDefault)

    await page.screenshot({ path: path.join(SHOT_DIR, 'colors-01-panel.png') })

    // ---- 5. 应用文字颜色 ----
    await page.evaluate(() => {
      const editor = window.__larkDoc.getEditor()
      editor.commands.selectAll()
    })
    await panel.locator('.lark-doc-color-letters button').nth(2).click() // 红色 #f54a45
    const textColor = await page.evaluate(() => window.__larkDoc.getEditor().getAttributes('textStyle').color)
    record('点击红色 A 后 textStyle.color 生效', String(textColor).toLowerCase() === '#f54a45', String(textColor))
    const triggerColor = await page.locator('.lark-doc-toolbar label.lark-doc-color .lark-doc-color-letter').first().evaluate((node) => node.style.color)
    record('触发器 A 字回显当前字色', triggerColor.toLowerCase() === 'rgb(245, 74, 69)', triggerColor)

    // ---- 6. 选中描边 ----
    await page.locator('.lark-doc-toolbar label.lark-doc-color').click()
    await panel.waitFor({ state: 'visible', timeout: 5000 })
    const activeLetter = await panel.locator('.lark-doc-color-letters button.is-active').count()
    record('当前字色 A 字有选中描边', activeLetter === 1, `is-active 计数=${activeLetter}`)

    // ---- 7. 应用背景颜色 ----
    await panel.locator('.lark-doc-color-grid').first().locator('button').nth(1).click() // 浅红 #fbd0d0
    const bgColor = await page.evaluate(() => window.__larkDoc.getEditor().getAttributes('textStyle').backgroundColor)
    record('点击浅红背景格后 backgroundColor 生效', String(bgColor).toLowerCase() === '#fbd0d0', String(bgColor))

    // ---- 8. 默认格清除背景 ----
    await page.locator('.lark-doc-toolbar label.lark-doc-color').click()
    await panel.waitFor({ state: 'visible', timeout: 5000 })
    await panel.locator('.lark-doc-color-grid').first().locator('button.is-transparent').first().click()
    const bgCleared = await page.evaluate(() => window.__larkDoc.getEditor().getAttributes('textStyle').backgroundColor)
    record('点击默认格后背景清除', !bgCleared, String(bgCleared))

    await page.screenshot({ path: path.join(SHOT_DIR, 'colors-02-applied.png') })

    // ---- 9. callout 旧面板不受影响 ----
    await page.evaluate(() => {
      const editor = window.__larkDoc.getEditor()
      editor.commands.selectAll()
      editor.commands.insertContent({ type: 'callout', content: [{ type: 'paragraph' }] })
    })
    await page.waitForSelector('[data-type="callout"]', { timeout: 5000 }).catch(() => {})
    // 光标放进 callout 内部段落，确保工具条显示
    await page.locator('[data-type="callout"] p').first().click().catch(() => {})
    const calloutBtn = page.locator('button[aria-label="高亮块颜色"], [title*="颜色"]').first()
    await calloutBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
    const calloutColorBtnCount = await page.locator('[aria-haspopup="menu"][title*="颜色"], button[title*="颜色"]').count()
    record('高亮块工具条存在颜色按钮', calloutColorBtnCount > 0, `计数=${calloutColorBtnCount}`)
    // 点击 callout 文字颜色触发器 → 旧版圆形色块面板
    const calloutTrigger = page.locator('label[title="高亮块文字颜色"]').first()
    const clicked = await calloutTrigger.click({ timeout: 3000 }).then(() => true).catch(() => false)
    if (clicked) {
      const oldPanel = page.locator('.lark-doc-color-palette:not(.lark-doc-color-palette-text)')
      await oldPanel.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
      const oldVisible = await oldPanel.isVisible().catch(() => false)
      const roundCells = oldVisible ? await oldPanel.locator('.lark-doc-color-palette-section button').count() : 0
      record('callout 颜色面板为旧版圆形色块结构', oldVisible && roundCells >= 9, `可见=${oldVisible} 色块=${roundCells}`)
      await page.screenshot({ path: path.join(SHOT_DIR, 'colors-03-callout.png') })
    } else {
      record('callout 颜色面板为旧版圆形色块结构', false, '未找到 callout 颜色触发按钮')
    }

    // ---- 页面错误 ----
    record('无页面脚本错误', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))
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
