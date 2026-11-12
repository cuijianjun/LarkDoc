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
  // The menu opens through the same Vue2 overlay pipeline as the other
  // document actions. During a full sequential matrix the cold dev bundle can
  // make that first panel mount exceed 10s; keep the assertion unchanged and
  // give the UI enough time to become observable.
  page.setDefaultTimeout(20000)
  const check = (name, passed, detail) => { results.push({ name, passed, detail }); console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`); assert(passed, name) }
  const click = async locator => {
    await locator.click()
  }
  const json = () => page.evaluate(() => window.__versionDoc.getJSON())
  const editor = () => page.locator('.lark-doc-paper .tiptap').first()
  const history = () => page.getByRole('dialog', { name: '历史记录', exact: true })
  const confirm = () => page.getByRole('dialog', { name: '还原此记录？', exact: true })
  const openAction = async name => {
    if (!await page.getByRole('combobox', { name: '文档更多操作', exact: true }).isVisible()) await click(page.getByRole('button', { name: '文档操作', exact: true }))
    await click(page.getByRole('combobox', { name: '文档更多操作', exact: true }))
    // The shared select opens on hover and closes 150ms after the pointer leaves
    // the trigger. Playwright's locator.click waits between move and click long
    // enough to lose the menu; use the same immediate pointer sequence as a
    // human click across the 4px trigger/menu gap.
    const option = page.getByRole('option', { name, exact: true })
    const box = await option.boundingBox()
    if (!box) throw new Error(`版本菜单选项未定位：${name}`)
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 1 })
    await page.mouse.down()
    await page.mouse.up()
  }
  const save = async label => {
    await openAction('另存为版本')
    const input = page.getByRole('textbox', { name: '版本名称', exact: true })
    await click(input)
    await page.keyboard.press('Meta+a')
    await page.keyboard.insertText(label)
    await click(page.locator('.lark-doc-save-version-confirm'))
    await page.locator('.lark-doc-save-version-wrap').waitFor({ state: 'detached' })
  }
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => window.__larkDoc?.getEditor?.() && window.__larkDocVersioning?.createMemoryVersioningProvider)
    await page.evaluate(() => {
      window.__versionDoc = window.__larkDoc.document || window.__larkDoc
      const session = window.__versionDoc.getSession()
      window.__versionProvider = window.__larkDocVersioning.createMemoryVersioningProvider({ author: 'browser-owner' })
      session.setProvider('versioning', window.__versionProvider)
      window.__versionDoc.setContent('<p data-block-id="version_browser_body"></p>')
    })
    await click(editor())
    await page.keyboard.insertText('历史正文中文😀')
    const baseline = await json()
    await save('鼠标保存基线')
    const saved = await page.evaluate(async () => {
      const list = await window.__versionProvider.list({ documentId: window.__versionDoc.getSession().documentId })
      window.__versionBaselineId = list[0].id
      const record = await window.__versionProvider.get(list[0].id)
      return { count: list.length, binary: record.payload instanceof Uint8Array, decoded: await window.__versionDoc.getSession().readVersionDocument(record.id) }
    })
    check('Real Vue2 UI saves current unicode body through the actual binary version provider', saved.count === 1 && saved.binary && JSON.stringify(saved.decoded.content) === JSON.stringify(baseline))
    await click(editor())
    await page.keyboard.press('Meta+End')
    await page.keyboard.insertText(' 待移除的恢复标记')
    const modified = await json()
    await save('鼠标保存编辑后版本')
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
    const confirmGeometry = await confirm().evaluate(e => ({ rect: e.getBoundingClientRect().toJSON(), radius: getComputedStyle(e).borderRadius, buttons: [...e.querySelectorAll('button')].map(b => ({ text: b.textContent, rect: b.getBoundingClientRect().toJSON(), background: getComputedStyle(b).backgroundColor })), focused: document.activeElement.textContent }))
    check('Restore confirmation matches 420×178, 8px corners and two 80×32 controls with green accent', confirmGeometry.rect.width === 420 && confirmGeometry.rect.height === 178 && confirmGeometry.radius === '8px' && confirmGeometry.buttons.every(b => b.rect.width === 80 && b.rect.height === 32) && confirmGeometry.buttons[0].background === 'rgb(0, 184, 135)' && confirmGeometry.focused === '还原', confirmGeometry)
    await page.mouse.click(20, 20)
    check('Clicking outside the restore confirmation keeps it open', await confirm().count() === 1)
    await page.keyboard.press('Escape')
    check('Escape cancels restoration without changing the live document', await confirm().count() === 0 && JSON.stringify(await json()) === JSON.stringify(modified))
    await click(history().getByRole('button', { name: '还原此历史记录', exact: true }))
    await click(confirm().getByRole('button', { name: '取消', exact: true }))
    check('Cancel returns to the same selected history without a new record', await page.evaluate(async () => (await window.__versionProvider.list()).length) === 2)
    await click(history().getByRole('button', { name: '还原此历史记录', exact: true }))
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Escape')
    check('Escape also cancels after keyboard focus leaves the confirmation buttons', await confirm().count() === 0)
    await click(history().getByRole('button', { name: '还原此历史记录', exact: true }))
    await page.screenshot({ path: path.join(evidenceDir, 'master-parity-local-version-confirm.png') })
    await click(confirm().getByRole('button', { name: '还原', exact: true }))
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
    if (!await page.getByRole('combobox', { name: '文档更多操作', exact: true }).isVisible()) await click(page.getByRole('button', { name: '文档操作', exact: true }))
    await click(page.getByRole('combobox', { name: '文档更多操作', exact: true }))
    check('Readonly mode keeps history available while disabling version creation', await page.getByRole('option', { name: '另存为版本', exact: true }).isDisabled())
    await click(page.getByRole('option', { name: '历史记录', exact: true }))
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
