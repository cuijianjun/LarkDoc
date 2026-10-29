'use strict'
/**
 * 浏览器契约：日程搜索面板。原生化前后必须逐条保持一致。
 * 用法：node scripts/verify-browser-calendar-panel.js [url]
 */
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright-core')

const BASE = process.argv[2] || 'http://localhost:8080/lark-doc'
const results = []

function findChromium() {
  const cache = path.join(process.env.HOME, 'Library', 'Caches', 'ms-playwright')
  if (!fs.existsSync(cache)) return null
  const dirs = fs.readdirSync(cache).filter(name => /^chromium-\d+$/.test(name)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
  for (const dir of dirs) {
    for (const candidate of [
      path.join(cache, dir, 'chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
      path.join(cache, dir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
    ]) if (fs.existsSync(candidate)) return candidate
  }
  return null
}

function record(name, ok, detail = '') {
  results.push(!!ok)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

async function main() {
  const executablePath = findChromium()
  if (!executablePath) throw new Error('未找到本机 chromium 缓存')
  const browser = await chromium.launch({ headless: true, executablePath })
  const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } })
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(String(error)))
  try {
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 })
    await page.waitForFunction(() => window.__larkDoc && window.__larkDoc.getEditor && window.__larkDoc.getEditor(), { timeout: 30000 })
    await page.evaluate(() => window.__larkDoc.setContent('<p></p><p>第二段正文</p>'))
    await page.waitForTimeout(360)
    const editor = page.locator('.ProseMirror')
    await editor.locator(':scope > p').first().click()
    await page.keyboard.press('End')
    await page.keyboard.type('/')
    await page.waitForTimeout(100)
    console.log('COMMANDS', await page.locator('.lark-doc-command-menu').count(), await page.locator('.lark-doc-command-menu [role="option"]').allTextContents())
    const calendarCommand = page.locator('.lark-doc-command-menu [role="option"]').filter({ hasText: '日程' }).first()
    if (await calendarCommand.count()) await calendarCommand.click()
    else await page.keyboard.type('日程'); await page.keyboard.press('Enter')
    await page.waitForTimeout(160)

    const root = page.locator('.lark-doc-calendar-search')
    record('面板进入 DOM 且声明 dialog/aria-label', await root.count() === 1 && await root.getAttribute('role') === 'dialog' && await root.getAttribute('aria-label') === '插入日程')
    record('面板标题与关闭按钮结构稳定', await root.locator('.lark-doc-calendar-search-title').textContent() === '插入日程' && await root.locator('.lark-doc-calendar-search-close').getAttribute('aria-label') === '关闭')
    record('搜索输入框属性完整并自动获得焦点', await root.locator('input[type="text"]').getAttribute('aria-label') === '搜索日程' && await root.locator('input').getAttribute('placeholder') === '搜索日程' && await page.evaluate(() => document.activeElement?.classList.contains('lark-doc-calendar-search-input')))
    record('结果区声明 listbox/aria-label', await root.locator('[role="listbox"]').count() === 1 && await root.locator('[role="listbox"]').getAttribute('aria-label') === '日程搜索结果')
    await page.waitForTimeout(120)
    record('无数据时显示加载或空态，且结果区固定存在', await root.locator('[role="listbox"]').count() === 1 && (await root.locator('.lark-doc-calendar-search-empty').count() === 1 || await root.locator('.lark-doc-calendar-search-row').count() === 0))

    await root.locator('input').fill('不存在的日程')
    record('输入事件更新搜索状态且仍保留面板', await root.locator('input').inputValue() === '不存在的日程' && await root.count() === 1)
    await page.evaluate(() => document.querySelector('.lark-doc-calendar-search-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    record('Escape 不关闭日程面板', await root.count() === 1)
    await page.mouse.click(1500, 900)
    await page.waitForTimeout(80)
    record('点击面板外部关闭', await root.count() === 0)

    await page.evaluate(() => window.__larkDoc.setContent('<p></p><p>第二段正文</p>'))
    await page.waitForTimeout(300)
    await page.locator('.ProseMirror > p').first().click()
    await page.keyboard.press('End')
    await page.keyboard.type('/')
    await page.waitForTimeout(260)
    const reopenCommand = page.locator('.lark-doc-command-menu [role="option"]').filter({ hasText: '日程' }).first()
    if (await reopenCommand.count()) await reopenCommand.click()
    else { await page.keyboard.type('日程'); await page.keyboard.press('Enter') }
    await page.waitForTimeout(120)
    await page.locator('.lark-doc-calendar-search-close').dispatchEvent('mousedown')
    record('关闭按钮 mousedown 直接关闭面板', await page.locator('.lark-doc-calendar-search').count() === 0)
    record('页面无脚本错误', pageErrors.length === 0, pageErrors.join(' | '))
  } finally {
    await browser.close()
  }
  const passed = results.filter(Boolean).length
  console.log(`RESULT ${passed}/${results.length}`)
  if (passed !== results.length) process.exitCode = 1
}

main().catch(error => { console.error(error); process.exitCode = 1 })
