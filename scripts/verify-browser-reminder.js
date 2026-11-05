'use strict'
/**
 * 浏览器契约：日期提醒日历浮层。覆盖阶段 5 原生 DOM 改造前后的结构与交互语义。
 * 用法：node scripts/verify-browser-reminder.js [url]
 */
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright-core')

const BASE = process.argv[2] || 'http://localhost:8080/lark-doc'
const results = []

function findChromium() {
  const cache = path.join(process.env.HOME, 'Library', 'Caches', 'ms-playwright')
  if (!fs.existsSync(cache)) return null
  const dirs = fs.readdirSync(cache).filter(name => /^chromium-\d+$/.test(name)).sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)))
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
  const errors = []
  page.on('pageerror', error => errors.push(String(error)))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })

  try {
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 })
    await page.waitForFunction(() => window.__larkDoc && window.__larkDoc.getEditor && window.__larkDoc.getEditor(), { timeout: 30000 })
    await page.evaluate(() => window.__larkDoc.setContent('<p><span data-type="reminder" data-remind-at="2099-10-26T13:00:00Z" data-notify="true" data-repeat="none">明天 13:00</span></p>'))
    await page.waitForTimeout(300)

    const initial = await page.evaluate(() => ({
      popover: !!document.querySelector('.lark-doc-reminder-popover'),
      times: !!document.querySelector('.lark-doc-reminder-times'),
      layer: !!document.querySelector('.lark-doc-reminder-layer'),
    }))
    record('关闭态只保留原生 layer，浮层节点真实摘除', initial.layer && !initial.popover && !initial.times)

    await page.locator('.lark-doc-reminder-chip').click()
    await page.waitForTimeout(250)
    const open = await page.evaluate(() => {
      const popover = document.querySelector('.lark-doc-reminder-popover')
      const layer = document.querySelector('.lark-doc-reminder-layer')
      const days = Array.from(document.querySelectorAll('.lark-doc-reminder-day'))
      const outside = days.filter(el => el.disabled)
      return {
        popover: !!popover,
        role: popover?.getAttribute('role'),
        ariaLabel: popover?.getAttribute('aria-label'),
        days: days.length,
        outside: outside.length,
        selected: days.filter(el => el.getAttribute('aria-selected') === 'true').length,
        dayLabels: days.every(el => el.getAttribute('role') === 'gridcell' && /^\d{4}年\d{1,2}月\d{1,2}日$/.test(el.getAttribute('aria-label') || '')),
        selectedLabel: days.find(el => el.getAttribute('aria-selected') === 'true')?.getAttribute('aria-label'),
        expectedLabel: (() => {
          const date = new Date('2099-10-26T13:00:00Z')
          return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
        })(),
        remindAt: window.__larkDoc.getEditor().getJSON().content[0].content[0].marks.find(mark => mark.type === 'reminder')?.attrs.remindAt,
        layerChildren: layer ? Array.from(layer.children).map(el => el.className) : [],
        repeatDisabled: document.querySelector('[data-reminder="repeat"]')?.disabled === true,
        timeExpanded: document.querySelector('[data-reminder="time"]')?.getAttribute('aria-expanded'),
      }
    })
    record('打开后 dialog 与日期提醒 ARIA 正确', open.popover && open.role === 'dialog' && open.ariaLabel === '日期提醒')
    record('日历严格渲染 42 格且补白格 disabled', open.days === 42 && open.outside > 0 && open.outside < 14, `格数=${open.days} disabled=${open.outside}`)
    record('日期格保留 gridcell/selected/aria-label 语义', open.selected === 1 && open.dayLabels && open.selectedLabel === open.expectedLabel, `${open.selectedLabel} / 预期 ${open.expectedLabel}`)
    record('HTML 导入保留原始提醒日期', open.remindAt === '2099-10-26T13:00:00Z', open.remindAt)
    record('提醒行保持 disabled 展示', open.repeatDisabled === true)
    record('时间下拉初始关闭且真实不在 DOM', open.timeExpanded === 'false' && !open.layerChildren.includes('lark-doc-reminder-times'))

    const daySelection = await page.evaluate(() => {
      const button = document.querySelector('.lark-doc-reminder-day:not(:disabled)')
      const expected = new Date('2099-10-26T13:00:00Z')
      expected.setDate(Number(button.textContent))
      let prevented = false
      button.addEventListener('mousedown', event => { prevented = event.defaultPrevented }, { once: true })
      button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      return {
        prevented,
        expectedAt: expected.toISOString(),
        remindAt: window.__larkDoc.getEditor().getJSON().content[0].content[0].marks.find(mark => mark.type === 'reminder')?.attrs.remindAt,
      }
    })
    record('日期选择保留 mousedown.prevent', daySelection.prevented)
    record('日期选择写回所选日期并保留原始时间', daySelection.remindAt === daySelection.expectedAt, `${daySelection.remindAt} / 预期 ${daySelection.expectedAt}`)

    await page.locator('[data-reminder="time"]').dispatchEvent('mousedown')
    await page.waitForTimeout(100)
    const times = await page.evaluate(() => {
      const select = document.querySelector('[data-reminder="time"]')
      const list = document.querySelector('.lark-doc-reminder-times')
      const popover = document.querySelector('.lark-doc-reminder-popover')
      const rows = Array.from(document.querySelectorAll('.lark-doc-reminder-time-row'))
      return {
        expanded: select?.getAttribute('aria-expanded'),
        list: !!list,
        role: list?.getAttribute('role'),
        label: list?.getAttribute('aria-label'),
        options: rows.length,
        selected: rows.filter(el => el.getAttribute('aria-selected') === 'true').length,
        siblings: !!list && !!popover && list.parentNode === popover.parentNode,
        order: !!list && !!popover && popover.nextElementSibling === list,
        mousedownPrevented: (() => {
          const row = rows[0]
          let prevented = false
          row.addEventListener('mousedown', event => { prevented = event.defaultPrevented }, { once: true })
          row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
          return prevented
        })(),
      }
    })
    record('时间下拉打开后真实挂载并声明 listbox/option', times.expanded === 'true' && times.list && times.role === 'listbox' && times.label === '提醒时间' && times.options === 48 && times.selected === 1)
    record('时间下拉与浮层是兄弟节点且顺序正确', times.siblings && times.order)
    record('时间选项保留 mousedown.prevent', times.mousedownPrevented)
    await page.waitForFunction(() => document.querySelector('[data-reminder="time"]')?.getAttribute('aria-expanded') === 'false')
    record('mousedown 探针选中首项后真实收起时间下拉', await page.locator('.lark-doc-reminder-times').count() === 0)

    // 上面的探针也会执行选时；确认其关闭语义后重新打开，再选择末项。
    await page.locator('[data-reminder="time"]').dispatchEvent('mousedown')
    await page.locator('.lark-doc-reminder-time-row').filter({ hasText: '23:30' }).dispatchEvent('mousedown')
    await page.waitForTimeout(200)
    const afterTime = await page.evaluate((selectedDay) => ({
      list: !!document.querySelector('.lark-doc-reminder-times'),
      selected: document.querySelector('[data-reminder="time"]')?.textContent.trim() || '',
      html: window.__larkDoc.getEditor().getHTML(),
      remindAt: window.__larkDoc.getEditor().getJSON().content[0].content[0].marks.find(mark => mark.type === 'reminder')?.attrs.remindAt,
      expectedAt: (() => {
        const date = new Date(selectedDay)
        date.setHours(23, 30, 0, 0)
        return date.toISOString()
      })(),
    }), daySelection.expectedAt)
    record('选择时间委托 reminderMixin 并收起下拉', !afterTime.list && afterTime.selected.includes('23:30'))
    record('时间选择写回正文 mark 属性', /data-remind-at="/.test(afterTime.html) && /lark-doc-reminder-chip/.test(afterTime.html) && afterTime.remindAt === afterTime.expectedAt, `${afterTime.remindAt} / 预期 ${afterTime.expectedAt}`)

    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
    record('Escape 后浮层节点真实摘除', await page.locator('.lark-doc-reminder-popover').count() === 0)
    record('页面无脚本错误', errors.length === 0, errors.slice(0, 2).join(' | '))
  } finally {
    await browser.close()
  }

  const passed = results.filter(Boolean).length
  console.log(`RESULT ${passed}/${results.length}`)
  if (passed !== results.length) process.exitCode = 1
}

main().catch(error => { console.error(error); process.exitCode = 1 })
