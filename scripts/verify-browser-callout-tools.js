'use strict'
/**
 * 浏览器契约：高亮块工具条与表情选择器。
 * 先在现有 Vue 实现上建立基线，原生化后必须逐条复跑，不得放宽。
 * 用法：node scripts/verify-browser-callout-tools.js [url]
 */
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright-core')

const BASE = process.argv[2] || 'http://localhost:8080/lark-doc'
const results = []

function findChromium() {
  const cache = path.join(process.env.HOME, 'Library', 'Caches', 'ms-playwright')
  if (!fs.existsSync(cache)) return null
  const dirs = fs.readdirSync(cache).filter((name) => /^chromium-\d+$/.test(name)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
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
  page.on('pageerror', (error) => pageErrors.push(String(error)))
  try {
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 })
    await page.waitForFunction(() => window.__larkDoc && window.__larkDoc.getEditor && window.__larkDoc.getEditor(), { timeout: 30000 })
    await page.evaluate(() => window.__larkDoc.getEditor().commands.setContent('<p>前置段落</p><div data-type="callout" data-emoji="💡"><p>高亮块正文</p></div><p>后置段落</p>'))
    await page.waitForTimeout(160)
    await page.locator('[data-type="callout"] p').click()
    await page.waitForTimeout(180)

    const root = page.locator('.lark-doc-callout-tools')
    record('工具条进入 DOM 且声明 toolbar/aria-label', await root.count() === 1 && await root.getAttribute('role') === 'toolbar' && await root.getAttribute('aria-label') === '高亮块工具')
    record('工具条含 3 个颜色输入和 3 个操作按钮', await root.locator('input[type="color"]').count() === 3 && await root.locator(':scope > button').count() === 3)
    record('三个颜色触发器标题与输入 aria-label 一一对应', await page.evaluate(() => {
      const labels = [...document.querySelectorAll('.lark-doc-callout-tools > label')]
      return labels.length === 3 && labels.every((label) => label.getAttribute('aria-haspopup') === 'menu' && label.title === label.querySelector('input')?.getAttribute('aria-label'))
    }))
    record('操作按钮 aria-label 顺序稳定', await root.locator(':scope > button').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')).join('|') === '更换高亮块图标|恢复高亮块默认样式|删除高亮块'))
    record('工具条 mousedown 阻止默认行为', await page.evaluate(() => {
      const node = document.querySelector('.lark-doc-callout-tools')
      const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
      const returned = node.dispatchEvent(event)
      return event.defaultPrevented && returned === false
    }))

    await root.locator('button[aria-label="更换高亮块图标"]').click()
    const picker = page.locator('.lark-doc-callout-emoji-picker')
    record('点击图标按钮打开表情面板', await picker.count() === 1 && await picker.getAttribute('role') === 'menu' && await picker.getAttribute('aria-label') === '高亮块图标')
    record('表情面板包含搜索、随机、tablist、表情分组', await picker.locator('input[type="search"]').count() === 1 && await picker.locator('button[aria-label="随机高亮块图标"]').count() === 1 && await picker.locator('[role="tablist"]').count() === 1 && await picker.locator('[role="group"]').count() === 1)
    const tabs = picker.locator('[role="tab"]')
    record('表情分类包含最近、全部且只有一个选中项', await tabs.count() >= 11 && await tabs.filter({ hasText: '最近' }).count() === 1 && await tabs.filter({ hasText: '全部' }).count() === 1 && await tabs.locator('[aria-selected="true"]').count() === 0 && await page.locator('[role="tab"][aria-selected="true"]').count() === 1)
    await picker.locator('input[type="search"]').fill('不存在的表情')
    await page.waitForTimeout(80)
    record('搜索无结果显示空态文案', (await picker.locator('.lark-doc-callout-emoji-empty').textContent()).trim() === '没有匹配的表情')
    await picker.locator('input[type="search"]').fill('')
    await picker.locator('[role="tab"]').filter({ hasText: '全部' }).click()
    await picker.locator('[role="menuitem"]').first().click()
    await page.waitForTimeout(120)
    record('选择表情后写入 callout 且面板保持打开', await page.evaluate(() => !!document.querySelector('[data-type="callout"]') && !!document.querySelector('.lark-doc-callout-emoji-picker')))

    await page.keyboard.press('Escape')
    await page.waitForTimeout(80)
    record('Escape 关闭表情面板', await picker.count() === 0)
    await root.locator('button[aria-label="恢复高亮块默认样式"]').click()
    await page.waitForTimeout(100)
    const defaults = await page.evaluate(() => {
      const node = document.querySelector('[data-type="callout"]')
      return { emoji: node?.getAttribute('data-emoji'), color: node?.getAttribute('data-color'), bg: node?.getAttribute('data-background-color'), border: node?.getAttribute('data-border-color') }
    })
    record('恢复默认样式保留 callout 且 emoji 回到默认值', defaults.emoji === '💡' && await page.locator('[data-type="callout"]').count() === 1, JSON.stringify(defaults))

    await page.evaluate(() => { window.__larkDoc.setReadonly(true) })
    await page.waitForTimeout(100)
    record('只读时工具条真出 DOM', await page.locator('.lark-doc-callout-tools').count() === 0)
    await page.evaluate(() => { window.__larkDoc.setReadonly(false) })
    await page.waitForTimeout(100)
    const restoredCount = await page.locator('.lark-doc-callout-tools').count()
    await page.locator('[data-type="callout"] p').click()
    await page.waitForTimeout(160)
    const reopenedCount = await page.locator('.lark-doc-callout-tools').count()
    record('解除只读不残留旧工具条且重新选中 Callout 后可出现', restoredCount === 0 && reopenedCount === 1, `解除=${restoredCount} 重选=${reopenedCount}`)

    record('无页面脚本错误', pageErrors.length === 0, pageErrors.join(' | '))
  } finally {
    await browser.close()
  }
  if (results.some((ok) => !ok)) process.exitCode = 1
  console.log(`\n${results.filter(Boolean).length}/${results.length} 项通过`)
}

main().catch((error) => { console.error('验证脚本异常:', error); process.exitCode = 1 })
