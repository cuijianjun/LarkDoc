'use strict'
/** RevisionPanel 浏览器结构契约，先锁现有 Vue 行为，原生化后逐条复跑。 */
const fs = require('fs'); const path = require('path'); const { chromium } = require('playwright-core')
const BASE = process.argv[2] || 'http://localhost:8080/lark-doc'; const results = []
function chromePath() { const root = path.join(process.env.HOME, 'Library/Caches/ms-playwright'); if (!fs.existsSync(root)) return null; for (const d of fs.readdirSync(root).filter(x => /^chromium-\d+$/.test(x)).sort().reverse()) { const p = path.join(root, d, 'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'); if (fs.existsSync(p)) return p } return null }
function rec(name, ok, detail = '') { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`) }
async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: chromePath() }); const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } }); const errors = []; page.on('pageerror', e => errors.push(String(e)))
  try {
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 }); await page.waitForFunction(() => window.__larkDoc?.getEditor?.(), { timeout: 30000 })
    await page.evaluate(() => { window.__larkDoc.getEditor().commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '前置' }] }, { type: 'paragraph', content: [{ type: 'text', text: '修订文本', marks: [{ type: 'revision', attrs: { revisionId: 'r1', author: 'local-user', kind: 'insert' } }] }] }, { type: 'paragraph', content: [{ type: 'text', text: '后置' }] }] }) })
    await page.waitForTimeout(120)
    const editor = page.locator('.ProseMirror'); await editor.click(); await page.waitForTimeout(100)
    const layer = page.locator('.lark-doc-revision-layer'); const panel = page.locator('.lark-doc-revision-panel')
    rec('修订层与面板进入 DOM', await layer.count() === 1 && await panel.count() >= 1)
    rec('面板声明 dialog/aria-label/fixed/270px', await panel.first().getAttribute('role') === 'dialog' && await panel.first().getAttribute('aria-label') === '修订建议' && await panel.first().evaluate(n => getComputedStyle(n).position === 'fixed' && getComputedStyle(n).width === '270px'))
    rec('头部、回复卡、六控件结构顺序', await panel.first().evaluate(n => { const kids = [...n.children]; return kids[0]?.classList.contains('lark-doc-revision-head') && kids[1]?.classList.contains('lark-doc-revision-reply') && kids[0].querySelectorAll('.lark-doc-revision-cell').length === 6 }))
    rec('控件包含分割条、拒绝在接受之前', await panel.first().evaluate(n => { const cells = [...n.querySelectorAll('.lark-doc-revision-cell')]; const buttons = [...n.querySelectorAll('.lark-doc-revision-btn')]; return cells.some(x => x.querySelector('.lark-doc-revision-split')) && buttons.some(x => x.classList.contains('is-reject')) && buttons.some(x => x.classList.contains('is-accept')) && buttons.findIndex(x => x.classList.contains('is-reject')) < buttons.findIndex(x => x.classList.contains('is-accept')) }))
    rec('回复卡含头像/作者/摘要', await panel.first().locator('.lark-doc-revision-avatar').count() === 1 && await panel.first().locator('.lark-doc-revision-author').count() === 1 && await panel.first().locator('.lark-doc-revision-body').count() === 1)
    rec('按钮全部无 title 且为 button', await panel.first().locator('.lark-doc-revision-btn').evaluateAll(ns => ns.every(n => n.tagName === 'BUTTON' && !n.hasAttribute('title') && n.getAttribute('aria-label') !== null)))
    rec('无页面脚本错误', errors.length === 0, errors.join(' | '))
  } finally { await browser.close() }
  if (results.some(x => !x)) process.exitCode = 1; console.log(`\n${results.filter(Boolean).length}/${results.length} 项通过`)
}
main().catch(e => { console.error('验证脚本异常:', e); process.exitCode = 1 })
