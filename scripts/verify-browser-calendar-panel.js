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
    record('无数据时渲染真实空态文案', await root.locator('[role="listbox"]').count() === 1 && await root.locator('.lark-doc-calendar-search-empty').innerText() === '没有匹配的搜索结果')

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
    // Exercise the public facade and a genuinely asynchronous host directory.
    await page.evaluate(() => {
      const Facade = window.__larkDoc.document?.constructor || window.__larkDoc.constructor
      window.__larkDoc.destroy()
      const element = document.createElement('div')
      element.id = 'calendar-provider-acceptance'
      document.body.appendChild(element)
      window.__calendarJoinCalls = []
      window.__calendarContractDoc = new Facade({ element, storage: 'none', content: '<p></p>',
        calendarSource: { search: () => new Promise(resolve => { window.__calendarSearchResolve = resolve }) },
        onCalendarEventJoin: value => window.__calendarJoinCalls.push(value),
      })
    })
    const fixture = page.locator('#calendar-provider-acceptance')
    await fixture.locator('.ProseMirror > p').first().click()
    await page.keyboard.type('/')
    await fixture.locator('[data-command-id="calendar_event"]').click()
    const providerPanel = fixture.locator('.lark-doc-calendar-search')
    record('宿主异步请求期间渲染搜索中', await providerPanel.locator('.lark-doc-calendar-search-empty').innerText() === '搜索中…')
    await page.evaluate(() => window.__calendarSearchResolve([{ eventId: 'parity-calendar', title: '宿主日程闭环', start: '2026-11-11T10:00:00+08:00', end: '2026-11-11T11:00:00+08:00' }]))
    const row = providerPanel.locator('.lark-doc-calendar-search-row')
    await row.waitFor({ state: 'visible' })
    record('异步候选真实进入DOM而不是仅更新状态', await row.count() === 1 && await row.innerText() === '宿主日程闭环')
    await providerPanel.locator('input').fill('没有此日程')
    record('筛选零结果渲染空态', await providerPanel.locator('.lark-doc-calendar-search-empty').innerText() === '没有匹配的搜索结果')
    await providerPanel.locator('input').fill('')
    await row.click()
    record('点击实际候选行插入卡片并关闭搜索', await providerPanel.count() === 0 && await fixture.locator('.lark-doc-calendar-container').count() === 1)
    await fixture.locator('.lark-doc-calendar-join').click()
    const calls = await page.evaluate(() => window.__calendarJoinCalls)
    record('加入按钮经门面回调返回正确日程身份', calls.length === 1 && calls[0].eventId === 'parity-calendar' && calls[0].title === '宿主日程闭环')
    await page.evaluate(() => { window.__calendarContractDoc.destroy(); document.getElementById('calendar-provider-acceptance').remove(); delete window.__calendarSearchResolve; delete window.__calendarContractDoc; delete window.__calendarJoinCalls })
    record('页面无脚本错误', pageErrors.length === 0, pageErrors.join(' | '))
  } finally {
    await browser.close()
  }
  const passed = results.filter(Boolean).length
  console.log(`RESULT ${passed}/${results.length}`)
  if (passed !== results.length) process.exitCode = 1
}

main().catch(error => { console.error(error); process.exitCode = 1 })
