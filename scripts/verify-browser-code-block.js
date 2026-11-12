'use strict'

// Feishu source facts: /tmp/lark-doc-v12e/master-parity-source-media-shell.json.
// Fixture setup uses the public facade; interactions use real mouse/key events.
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright-core')

const baseUrl = process.argv[2] || 'http://127.0.0.1:58742/lark-doc?verify=1'
const evidenceDir = process.env.LARK_DOC_EVIDENCE_DIR || '/tmp/lark-doc-v12e'
const results = []
const source = `const value = 42;\nconsole.log(value);\n${'long-line-code-'.repeat(40)}\n// logical fourth line`

async function main() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1680, height: 1050 }, permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const check = (name, passed, detail) => {
    results.push({ name, passed, detail })
    console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`)
    assert(passed, name)
  }
  const click = async locator => {
    await locator.scrollIntoViewIfNeeded()
    const rect = await locator.boundingBox()
    assert(rect, 'Mouse target must be visible')
    await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2)
  }
  const code = () => page.locator('.lark-doc-code:not(.lark-doc-code-diagram)').first()
  const attrs = () => page.evaluate(() => window.__larkDoc.getEditor().getJSON().content.find(node => node.type === 'codeBlock').attrs)
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => window.__larkDoc?.getEditor?.())
    await page.evaluate(() => window.__larkDoc.setContent('<p></p>'))
    await click(page.locator('.tiptap p').first())
    await page.keyboard.type('/')
    await click(page.locator('.lark-doc-command-menu [data-command-id="code"]'))
    await code().locator('.lark-doc-code-caption').waitFor({ state: 'visible' })
    check('Slash insertion starts with Plain Text and wrap off', (await attrs()).language === 'plaintext' && (await attrs()).wrap === false)
    await click(code().locator('.lark-doc-code-caption'))
    await page.keyboard.type('代码闭环标题')
    await click(code().locator('.lark-doc-code-language'))
    const menu = page.locator('.lark-doc-code-language-menu')
    check('Searchable menu exposes all 71 source languages', await menu.locator('[role="option"]').count() === 71)
    const geometry = await menu.evaluate(node => ({ width: node.getBoundingClientRect().width, searchHeight: node.querySelector('input').getBoundingClientRect().height, rowHeight: node.querySelector('[role="option"]').getBoundingClientRect().height }))
    check('Menu matches measured width, search and item heights', geometry.width === 219 && geometry.searchHeight === 40 && geometry.rowHeight === 36, geometry)
    await menu.locator('input').fill(' python')
    check('Literal leading space yields disabled no-match state', await menu.locator('.lark-doc-code-language-empty').innerText() === '无匹配结果' && await menu.locator('[role="option"]').count() === 0)
    await menu.locator('input').fill('jpt')
    check('Ordered subsequence search finds JavaScript only', await menu.locator('[role="option"]').count() === 1 && await menu.locator('[role="option"]').innerText() === 'JavaScript')
    await page.keyboard.press('Enter')
    check('Language choice preserves the edited caption', (await attrs()).language === 'javascript' && (await attrs()).caption === '代码闭环标题')
    await click(code().locator('.lark-doc-code-input'))
    await page.keyboard.insertText(source)
    await page.waitForFunction(() => document.querySelector('.lark-doc-code-line-numbers')?.children.length === 4)
    await code().locator('.hljs-keyword').first().waitFor({ state: 'attached' })
    check('JavaScript loads real syntax highlighting', await code().locator('.hljs-keyword').count() > 0)
    const off = await code().locator('.lark-doc-code-body').evaluate(node => ({ scroll: node.scrollWidth, client: node.clientWidth, overflow: getComputedStyle(node.querySelector('.lark-doc-code-input')).overflow }))
    check('Wrap off has one shared horizontal scroller', off.scroll > off.client && off.overflow === 'visible', off)
    await code().locator('.lark-doc-code-body').evaluate(node => { node.scrollLeft = 180 })
    await page.waitForFunction(() => document.querySelector('.lark-doc-code-line-numbers').style.transform === 'translateX(180px)')
    const scrolled = await code().evaluate(node => ({ gutter: node.querySelector('.lark-doc-code-line-numbers').getBoundingClientRect().left, body: node.querySelector('.lark-doc-code-body').getBoundingClientRect().left, preScroll: node.querySelector('.lark-doc-code-input').scrollLeft }))
    check('Horizontal scroll keeps gutter fixed and input/highlight together', Math.abs(scrolled.gutter - scrolled.body) < 1 && scrolled.preScroll === 0, scrolled)
    await code().locator('.lark-doc-code-body').evaluate(node => { node.scrollLeft = 0 })
    await click(code().locator('.lark-doc-code-wrap'))
    await page.waitForFunction(() => document.querySelector('.lark-doc-code-line-numbers>span:nth-child(3)')?.getBoundingClientRect().height > 22)
    const wrapped = await code().evaluate(node => ({ whiteSpace: getComputedStyle(node.querySelector('.lark-doc-code-input')).whiteSpace, scroll: node.querySelector('.lark-doc-code-body').scrollWidth, client: node.querySelector('.lark-doc-code-body').clientWidth, lines: [...node.querySelectorAll('.lark-doc-code-line-numbers>span')].map(line => ({ text: line.textContent, top: line.getBoundingClientRect().top, height: line.getBoundingClientRect().height })) }))
    check('Wrap on aligns four logical numbers after a long wrapped line', wrapped.whiteSpace === 'break-spaces' && wrapped.scroll === wrapped.client && wrapped.lines.length === 4 && wrapped.lines[2].height > 22 && wrapped.lines[3].top === wrapped.lines[2].top + wrapped.lines[2].height, wrapped)
    await page.screenshot({ path: path.join(evidenceDir, 'master-parity-local-code-wrap.png'), fullPage: true })
    await click(code().locator('.lark-doc-code-copy'))
    const toast = code().locator('[role="status"]')
    await toast.waitFor({ state: 'visible' })
    const toastRect = await toast.boundingBox()
    check('Copy retains its label and shows source-sized top-center feedback', await toast.innerText() === '复制成功' && await code().locator('.lark-doc-code-copy').innerText() === '复制' && toastRect.y === 40 && toastRect.width === 120 && toastRect.height === 54 && Math.abs(toastRect.x + toastRect.width / 2 - 840) < 1, toastRect)
    check('Real clipboard contains the complete original source', await page.evaluate(() => navigator.clipboard.readText()) === source)
    await page.screenshot({ path: path.join(evidenceDir, 'master-parity-local-code-copy.png'), fullPage: true })
    await toast.waitFor({ state: 'hidden', timeout: 4500 })
    check('Copy feedback disappears automatically', await toast.isHidden())
    // Make a distinct text edit so Undo has a previous edit to revert; folding has no history step.
    await click(code().locator('.lark-doc-code-input'))
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.insertText('\n// fold history probe')
    const saved = await page.evaluate(() => window.__larkDoc.getEditor().getJSON())
    await click(code().locator('.lark-doc-code-fold'))
    check('Folding collapses to 40px without changing the document', await code().evaluate(node => node.getBoundingClientRect().height) === 40 && JSON.stringify(await page.evaluate(() => window.__larkDoc.getEditor().getJSON())) === JSON.stringify(saved))
    await page.keyboard.press('Meta+z')
    check('Undo reverts the prior text edit while preserving the view-only fold', (await code().getAttribute('class')).includes('is-collapsed') && !(await code().locator('.lark-doc-code-input').innerText()).includes('fold history probe'))
    await click(code().locator('.lark-doc-code-fold'))
    // A fresh mount simulates serialized document reload without relying on demo autosave.
    await page.evaluate(doc => localStorage.setItem('lark-doc-code-acceptance', JSON.stringify(doc)), saved)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => window.__larkDoc?.getEditor?.())
    await page.evaluate(() => { const doc = JSON.parse(localStorage.getItem('lark-doc-code-acceptance')); localStorage.removeItem('lark-doc-code-acceptance'); window.__larkDoc.setContent(doc) })
    check('A fresh view restores caption/language/wrap and expands the fold', (await attrs()).caption === '代码闭环标题' && (await attrs()).language === 'javascript' && (await attrs()).wrap === true && !(await code().getAttribute('class')).includes('is-collapsed'))
    await click(code().locator('.lark-doc-code-wrap'))
    await click(code().locator('.lark-doc-code-wrap'))
    await click(code().locator('.lark-doc-code-language'))
    await page.locator('.lark-doc-code-language-search').fill('py')
    await click(page.locator('.lark-doc-code-language-option').filter({ hasText: /^Python$/ }))
    await click(code().locator('.lark-doc-code-input'))
    await page.keyboard.press('Meta+End')
    await page.keyboard.press('ArrowDown')
    // Create a new block through the documented command after choosing UI preferences.
    await page.evaluate(() => { const editor = window.__larkDoc.getEditor(); editor.commands.setTextSelection(editor.state.doc.content.size - 1); editor.commands.setCodeBlock() })
    const blocks = await page.evaluate(() => window.__larkDoc.getEditor().getJSON().content.filter(node => node.type === 'codeBlock').map(node => node.attrs))
    check('New blocks inherit this session language/wrap without copying caption', blocks.length === 2 && blocks[1].language === 'python' && blocks[1].wrap === true && blocks[1].caption === '', blocks)
    await click(code().locator('.lark-doc-code-language'))
    await page.evaluate(() => window.__larkDoc.setReadonly(true))
    check('Readonly closes menus and disables mutations while allowing copy', await page.locator('.lark-doc-code-language-menu').count() === 0 && await code().locator('.lark-doc-code-language').isDisabled() && await code().locator('.lark-doc-code-wrap').isDisabled() && await code().locator('.lark-doc-code-caption').isDisabled() && await code().locator('.lark-doc-code-copy').isEnabled())
    await page.evaluate(() => window.__larkDoc.setReadonly(false))
    for (const [alias, label, language] of [['js', 'JavaScript', 'javascript'], ['ts', 'TypeScript', 'typescript'], ['htm', 'XML', 'xml']]) {
      await page.evaluate(value => window.__larkDoc.setContent(`<pre data-language="${value}"><code>source</code></pre>`), alias)
      await click(code().locator('.lark-doc-code-language'))
      const active = await page.locator('.lark-doc-code-language-option.is-highlight').innerText()
      await page.keyboard.press('Enter')
      check(`Legacy ${alias} keeps ${label} active when confirming without a query`, active === label && (await attrs()).language === language)
    }
    await code().locator('.lark-doc-code-caption').fill('x'.repeat(100001))
    check('Pasted captions remain serializable at the maximum document string length', (await attrs()).caption.length === 100000 && await code().locator('.lark-doc-code-caption').inputValue().then(value => value.length === 100000))
    const addedLanguages = [
      ['ABAP', 'DATA value TYPE i. WRITE value.', 'DATA'],
      ['Apex', 'trigger Demo on Account (before insert) { Integer n = 42; }', 'trigger'],
      ['COBOL', '>>SOURCE FORMAT FREE\n01 ITEM-1 PIC 9(3) VALUE 42.\nMOVE "*x" TO ITEM-1.', 'PIC'],
      ['GraphQL', 'query X($id: ID!) { user(id: $id) { name } }', 'query'],
      ['Solidity', 'contract Vault { uint256 public n = 1_000; }', 'contract'],
    ]
    for (const [label, sample, token] of addedLanguages) {
      await page.evaluate(() => window.__larkDoc.setContent('<pre data-language="plaintext"><code></code></pre>'))
      await click(code().locator('.lark-doc-code-input'))
      await page.keyboard.insertText(sample)
      await click(code().locator('.lark-doc-code-language'))
      await page.locator('.lark-doc-code-language-search').fill(label)
      await click(page.locator('.lark-doc-code-language-option').filter({ hasText: new RegExp(`^${label}$`) }))
      await page.waitForFunction(expected => [...document.querySelectorAll('.lark-doc-code-highlight .hljs-keyword')].some(node => node.textContent === expected), token)
      const highlighted = await code().locator('.lark-doc-code-highlight').innerText()
      check(`${label} lazy grammar renders actual keyword tokens and preserves source`, highlighted === sample, { highlighted })
      const json = await page.evaluate(() => window.__larkDoc.getJSON())
      await page.evaluate(() => window.__larkDoc.setContent('<p>temporary reset</p>'))
      await page.evaluate(json => window.__larkDoc.setContent(json), json)
      await page.waitForFunction(expected => [...document.querySelectorAll('.lark-doc-code-highlight .hljs-keyword')].some(node => node.textContent === expected), token)
      check(`${label} survives a fresh node view`, await code().locator('.lark-doc-code-highlight').innerText() === sample)
    }
    check('No uncaught page errors', errors.length === 0, errors)
  } finally {
    fs.mkdirSync(evidenceDir, { recursive: true })
    fs.writeFileSync(path.join(evidenceDir, 'master-parity-local-code.json'), JSON.stringify({ url: baseUrl, results, errors }, null, 2))
    await browser.close()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
