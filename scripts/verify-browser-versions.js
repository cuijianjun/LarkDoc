'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright-core')
const baseUrl = process.argv[2] || 'http://127.0.0.1:58742/lark-doc?verify=1'
const evidenceDir = process.env.LARK_DOC_EVIDENCE_DIR || '/tmp/lark-doc-v12e'
const results = []

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.setDefaultTimeout(20000)
  const check = (name, passed, detail) => { results.push({ name, passed, detail }); console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`); assert(passed, name) }
  const click = async locator => {
    await locator.click()
  }
  const json = () => page.evaluate(() => window.__versionDoc.getJSON())
  const editor = () => page.locator('.lark-doc-paper .tiptap').first()
  const history = () => page.getByRole('dialog', { name: '历史记录', exact: true })
  const confirm = () => page.getByRole('alertdialog', { name: '还原此记录确认', exact: true })
  const openAction = async name => {
    await click(page.locator('.lark-doc-topbar .lark-doc-more-btn'))
    await click(page.locator('.lark-doc-topbar-more').getByRole('menuitem', { name, exact: true }))
  }
  // 产品从宿主侧保存版本，浏览器仍从真实菜单打开、浏览和还原它们。
  const save = label => page.evaluate(label => window.__versionDoc.getSession().createVersion({ label }), label)
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => window.__larkDoc?.getEditor?.())
    await page.evaluate(async () => {
      const { createMemoryVersioningProvider } = await import('/dist/lark-doc-versioning.mjs')
      window.__versionDoc = window.__larkDoc.document || window.__larkDoc
      const config = window.__versionDoc.getConfig()
      window.__versionDoc.patchProps({ config: { layout: { ...config.layout, headerVisible: true }, features: { ...config.features, versionHistory: true } } })
      const session = window.__versionDoc.getSession()
      // 手动控制本地记录数，精确断言两次保存和一次恢复。
      session.setAutoSnapshot({ enabled: false })
      window.__versionProvider = createMemoryVersioningProvider({ author: 'browser-owner' })
      session.setProvider('versioning', window.__versionProvider)
      window.__versionDoc.setContent('<p data-block-id="version_browser_body"></p>')
    })
    await click(editor())
    await page.keyboard.insertText('历史正文中文😀')
    const baseline = await json()
    await save('保存基线')
    const saved = await page.evaluate(async () => {
      const list = await window.__versionProvider.list({ documentId: window.__versionDoc.getSession().documentId })
      window.__versionBaselineId = list[0].id
      const record = await window.__versionProvider.get(list[0].id)
      return { count: list.length, binary: record.payload instanceof Uint8Array, decoded: await window.__versionDoc.getSession().readVersionDocument(record.id) }
    })
    check('The host session saves current unicode body through the binary version provider', saved.count === 1 && saved.binary && JSON.stringify(saved.decoded.content) === JSON.stringify(baseline))
    await click(editor())
    await page.keyboard.press('Meta+End')
    await page.keyboard.insertText(' 待移除的恢复标记')
    const modified = await json()
    await save('保存编辑后版本')
    await openAction('历史记录')
    await history().locator('[aria-label="历史版本正文"]').waitFor()
    const geometry = await history().evaluate(e => ({ width: e.getBoundingClientRect().width, right: e.querySelector('.lark-doc-version-right').getBoundingClientRect().width, preview: e.querySelector('.lark-doc-version-preview').getBoundingClientRect().toJSON(), readonly: e.querySelector('.tiptap').getAttribute('contenteditable'), title: getComputedStyle(e.querySelector('.lark-doc-version-preview-title')).fontSize }))
    check('History automatically previews the newest body with measured 294px timeline and 820px document', geometry.width === 1680 && geometry.right === 294 && geometry.preview.width === 820 && geometry.preview.y === 112 && geometry.title === '34px' && geometry.readonly === 'false', geometry)
    check('Current saved record cannot be restored repeatedly', await history().locator('.lark-doc-version-restore').isDisabled())
    await click(history().locator('.lark-doc-version-item').nth(1))
    await page.waitForFunction(() => document.querySelector('[aria-label="历史版本正文"]')?.textContent === '历史正文中文😀')
    check('Selecting older history changes only the readonly preview', JSON.stringify(await json()) === JSON.stringify(modified))
    check('Decoded history displays the document instead of binary metadata cards', await history().locator('.lark-doc-version-binary,.lark-doc-version-preview-meta,.lark-doc-version-diff').count() === 0)
    await click(history().getByRole('button', { name: '还原此历史记录', exact: true }))
    const confirmGeometry = await confirm().evaluate(e => ({ rect: e.getBoundingClientRect().toJSON(), radius: getComputedStyle(e).borderRadius, buttons: [...e.querySelectorAll('button')].map(b => ({ text: b.textContent, rect: b.getBoundingClientRect().toJSON() })), focused: document.activeElement.textContent, modal: e.getAttribute('aria-modal') }))
    check('Restore confirmation is 420px wide, has two usable controls and focuses Cancel', confirmGeometry.rect.width === 420 && confirmGeometry.radius === '12px'
      && confirmGeometry.buttons.length === 2 && confirmGeometry.buttons.every(b => b.rect.height >= 40) && confirmGeometry.focused === '取消' && confirmGeometry.modal === 'true', confirmGeometry)
    await page.mouse.click(20, 20)
    check('Clicking outside the restore confirmation keeps it open', await confirm().count() === 1)
    await page.keyboard.press('Escape')
    check('Escape cancels restoration without changing the live document', await confirm().count() === 0 && JSON.stringify(await json()) === JSON.stringify(modified))
    await click(history().getByRole('button', { name: '还原此历史记录', exact: true }))
    await click(confirm().getByRole('button', { name: '取消还原', exact: true }))
    check('Cancel returns to the same selected history without a new record', await page.evaluate(async () => (await window.__versionProvider.list()).length) === 2)
    await click(history().getByRole('button', { name: '还原此历史记录', exact: true }))
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Escape')
    check('Escape also cancels after keyboard focus leaves the confirmation buttons', await confirm().count() === 0)
    await click(history().getByRole('button', { name: '还原此历史记录', exact: true }))
    await page.screenshot({ path: path.join(evidenceDir, 'master-parity-local-version-confirm.png') })
    await click(confirm().getByRole('button', { name: '确认还原', exact: true }))
    await page.waitForFunction(() => window.__versionDoc.getEditor().state.doc.textContent === '历史正文中文😀')
    check('Confirm restores the exact saved document including persistent block identity', JSON.stringify(await json()) === JSON.stringify(baseline))
    const chain = await page.evaluate(async () => {
      const list = await window.__versionProvider.list()
      return { count: list.length, kind: list[0].kind, retained: list.some(r => r.id === window.__versionBaselineId), marker: window.__versionDoc.getSession().getCurrentVersionId() === list[0].id }
    })
    check('Restoration appends an immutable record and retains both earlier versions', chain.count === 3 && chain.kind === 'restore' && chain.retained && chain.marker, chain)
    await click(history().getByRole('button', { name: '返回文档', exact: true }))
    check('Return closes history and releases the underlying editor isolation', await history().count() === 0 && !await editor().evaluate(e => !!e.closest('[inert]')))
    await click(editor())
    await page.keyboard.press('Meta+z')
    check('One real keyboard Undo recovers the complete pre-restore body', JSON.stringify(await json()) === JSON.stringify(modified))
    await page.keyboard.press('Meta+Shift+z')
    check('Redo reapplies the complete historical body', JSON.stringify(await json()) === JSON.stringify(baseline))
    await openAction('历史记录')
    await history().locator('[aria-label="历史版本正文"]').waitFor()
    await page.keyboard.press('Escape')
    check('Escape leaves the outer history open, matching source', await history().count() === 1)
    await page.screenshot({ path: path.join(evidenceDir, 'master-parity-local-version-preview.png') })
    await click(history().getByRole('button', { name: '返回文档', exact: true }))
    await page.evaluate(() => { window.__versionDoc.setReadonly(true) })
    await click(page.locator('.lark-doc-topbar .lark-doc-more-btn'))
    const readonlyMenu = page.locator('.lark-doc-topbar-more')
    check('Readonly menu preserves access to history with no manual creation item', await readonlyMenu.getByRole('menuitem', { name: '历史记录', exact: true }).isEnabled()
      && await readonlyMenu.getByRole('menuitem', { name: '另存为版本', exact: true }).count() === 0)
    await page.keyboard.press('Escape')
    await openAction('历史记录')
    await history().locator('[aria-label="历史版本正文"]').waitFor()
    await click(history().locator('.lark-doc-version-item').nth(2))
    check('Readonly history never enables restoring an older version', await history().locator('.lark-doc-version-restore').isDisabled())
    await click(history().getByRole('button', { name: '返回文档', exact: true }))
    check('No uncaught page errors', errors.length === 0, errors)
  } finally {
    fs.writeFileSync(path.join(evidenceDir, 'master-parity-local-versions.json'), JSON.stringify(results, null, 2))
    await browser.close()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
