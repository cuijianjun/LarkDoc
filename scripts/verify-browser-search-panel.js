'use strict'
/**
 * 浏览器契约：查找替换面板。原生化前后必须逐条保持一致。
 * 用法：node scripts/verify-browser-search-panel.js [url]
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
    await page.evaluate(() => window.__larkDoc.setContent('<p>查找 查找</p>'))
    await page.locator('.ProseMirror').click()
    await page.keyboard.press('Control+f')
    await page.waitForTimeout(100)

    const root = page.locator('.lark-doc-fr')
    record('面板进入 DOM 且声明 search/aria-label', await root.count() === 1 && await root.getAttribute('role') === 'search' && await root.getAttribute('aria-label') === '查找和替换')
    record('查找页模板结构与焦点正确', await root.locator('.lark-doc-fr-bar[role="tablist"]').count() === 1 && await root.locator('.lark-doc-fr-pane').count() === 1 && await root.locator('input#lark-doc-fr-find').count() === 1 && await page.evaluate(() => document.activeElement?.id === 'lark-doc-fr-find'))
    record('查找页 v-if 条件节点真实摘除', await root.locator('#lark-doc-fr-replace').count() === 0 && await root.locator('.lark-doc-fr-label').count() === 0)
    record('查找按钮 disabled 与计数器正确', await root.locator('.lark-doc-fr-btn').count() === 2 && await root.locator('.lark-doc-fr-btn').allTextContents().then(text => text.includes('上一处') && text.includes('下一处')) && await root.locator('.lark-doc-fr-counter').textContent() === '0 / 0')

    await root.locator('input#lark-doc-fr-find').fill('查找')
    await page.waitForTimeout(180)
    record('输入触发业务搜索且计数器更新', await root.locator('.lark-doc-fr-counter').textContent() === '1 / 2' && await root.locator('button').filter({ hasText: '下一处' }).isEnabled())
    await root.locator('.lark-doc-fr-tab').filter({ hasText: '替换' }).click()
    record('替换页保留结构并真实插入条件节点', await root.locator('#lark-doc-fr-replace').count() === 1 && await root.locator('.lark-doc-fr-field').count() === 2 && await root.locator('.lark-doc-fr-btn').count() === 4 && await root.evaluate(node => node.style.height) === '286px')
    await root.locator('#lark-doc-fr-replace').fill('替换')
    await root.locator('.lark-doc-fr-btn').filter({ hasText: '替换' }).last().click()
    record('替换按钮调用业务回调', (await page.evaluate(() => window.__larkDoc.getText())).includes('替换'))

    await root.locator('.lark-doc-fr-close').click()
    record('关闭后 v-if 根节点真实摘除', await page.locator('.lark-doc-fr').count() === 0)
    record('页面无脚本错误', pageErrors.length === 0, pageErrors.join(' | '))
  } finally {
    await browser.close()
  }
  const passed = results.filter(Boolean).length
  console.log(`RESULT ${passed}/${results.length}`)
  if (passed !== results.length) process.exitCode = 1
}

main().catch(error => { console.error(error); process.exitCode = 1 })
