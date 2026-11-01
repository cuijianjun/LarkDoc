'use strict'

// Real browser keyboard events and OS clipboard, never dispatchEvent/DataTransfer mocks.
const assert = require('assert').strict
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright-core')
const BASE = process.argv[2] || 'http://127.0.0.1:54189/lark-doc'
const MIME = 'application/vnd.lark-doc.blocks+json'
function executable() {
  const cache = path.join(process.env.HOME, 'Library/Caches/ms-playwright')
  for (const dir of fs.readdirSync(cache).filter(n => /^chromium-\d+$/.test(n)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))) {
    for (const suffix of ['chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
      const candidate = path.join(cache, dir, suffix)
      if (fs.existsSync(candidate)) return candidate
    }
  }
  throw new Error('No Chromium executable')
}
const paragraph = (text, id) => ({ type: 'paragraph', attrs: { blockId: id }, content: [{ type: 'text', text, marks: [{ type: 'bold' }] }] })
function collectIds(nodes, target) { for (const node of nodes) { if (node.attrs?.blockId) target.add(node.attrs.blockId); collectIds(node.content || [], target) } }
function compareNodes(actual, expected, oldIds) {
  assert.equal(actual.type, expected.type)
  if (expected.attrs?.blockId) { assert.ok(actual.attrs.blockId); assert.ok(!oldIds.has(actual.attrs.blockId)) }
  if (expected.text) { assert.equal(actual.text, expected.text); assert.deepEqual(actual.marks, expected.marks) }
  assert.equal((actual.content || []).length, (expected.content || []).length)
  ;(expected.content || []).forEach((node, index) => compareNodes(actual.content[index], node, oldIds))
}
async function set(page, blocks, all = true) {
  await page.bringToFront()
  await page.evaluate(({ blocks, all }) => {
    const editor = window.__larkDoc.getEditor()
    editor.commands.setContent({ type: 'doc', content: blocks })
    editor.commands.focus('start')
    if (all) editor.commands.selectAll()
  }, { blocks, all })
}
async function read(page) { return page.evaluate(() => window.__larkDoc.getEditor().getJSON()) }
async function main() {
  const browser = await chromium.launch({ executablePath: executable(), headless: true })
  const errors = []
  let passed = 0
  try {
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
    const source = await context.newPage()
    const target = await context.newPage()
    for (const page of [source, target]) {
      page.on('pageerror', error => errors.push(String(error)))
      await page.goto(BASE, { waitUntil: 'networkidle' })
      await page.waitForFunction(() => window.__larkDoc?.getEditor?.())
      await page.evaluate(() => {
        window.__clipboardEvidence = []
        document.addEventListener('paste', event => window.__clipboardEvidence.push({
          trusted: event.isTrusted, types: Array.from(event.clipboardData.types),
          structured: event.clipboardData.getData('application/vnd.lark-doc.blocks+json'),
          html: event.clipboardData.getData('text/html'),
        }), true)
      })
    }
    const status = await (await context.request.get(new URL('/__verify__/status.json', BASE).href)).json()
    assert.equal(status.sourceArtifactsCurrent, true)
    assert.equal(status.root, path.resolve(__dirname, '..'))
    console.log('PASS current-worktree artifact identity')
    passed++
    const cases = [
      ['single', [paragraph('single bold', 'source-single')]],
      ['multi', [paragraph('first', 'source-first'), paragraph('second', 'source-second')]],
      ['container', [{ type: 'blockquote', attrs: { blockId: 'source-container' }, content: [paragraph('nested bold', 'source-child')] }]],
    ]
    for (const [name, blocks] of cases) {
      await set(source, blocks)
      const original = await read(source)
      await source.keyboard.press('ControlOrMeta+c')
      await set(target, [{ type: 'paragraph' }])
      await target.keyboard.press('ControlOrMeta+v')
      await target.waitForFunction(text => window.__larkDoc.getEditor().state.doc.textContent.includes(text), blocks[0].type === 'blockquote' ? 'nested bold' : blocks[0].content[0].text)
      const evidence = await target.evaluate(() => window.__clipboardEvidence.at(-1))
      assert.equal(evidence.trusted, true)
      assert.ok(evidence.types.includes(MIME), JSON.stringify(evidence))
      const payload = JSON.parse(evidence.structured)
      const expected = original.content
      assert.equal(payload.blocks.length, expected.length)
      const actual = (await read(target)).content
      assert.equal(actual.length, expected.length)
      const oldIds = new Set()
      collectIds(expected, oldIds)
      expected.forEach((node, i) => compareNodes(actual[i], node, oldIds))
      assert.deepEqual(await read(source), original)
      console.log(`PASS ${name}: trusted cross-tab private MIME, structure, bold, fresh IDs, source unchanged`)
      passed++
    }
    await set(source, [paragraph('cut original', 'cut-id')])
    const beforeCut = await read(source)
    await source.keyboard.press('ControlOrMeta+x')
    assert.equal(await source.evaluate(() => window.__larkDoc.getEditor().state.doc.textContent), '')
    await set(target, [{ type: 'paragraph' }])
    await target.keyboard.press('ControlOrMeta+v')
    await target.waitForFunction(() => window.__larkDoc.getEditor().state.doc.textContent === 'cut original')
    await source.bringToFront()
    await source.keyboard.press('ControlOrMeta+z')
    assert.deepEqual(await read(source), beforeCut)
    console.log('PASS cut across tabs and undo restores original identity')
    passed++
    await set(source, [paragraph('partial text', 'partial-id')], false)
    await source.evaluate(() => window.__larkDoc.getEditor().commands.setTextSelection({ from: 1, to: 8 }))
    await source.keyboard.press('ControlOrMeta+c')
    await set(target, [{ type: 'paragraph', content: [{ type: 'text', text: 'XY' }] }], false)
    await target.evaluate(() => window.__larkDoc.getEditor().commands.setTextSelection(2))
    await target.keyboard.press('ControlOrMeta+v')
    await target.waitForFunction(() => window.__larkDoc.getEditor().state.doc.textContent === 'XpartialY')
    const partialEvidence = await target.evaluate(() => window.__clipboardEvidence.at(-1))
    assert.ok(!partialEvidence.types.includes(MIME))
    assert.equal((await read(target)).content.length, 1)
    console.log('PASS partial native text paste not expanded to whole block')
    passed++
    // Async Clipboard API custom formats use a different browser representation.
    await set(source, [paragraph('menu bold', 'menu-id')])
    const menuResult = await source.evaluate(async () => {
      const root = document.querySelector('.lark-doc-editor')
      const queue = [root?.__vue__, window.__larkDoc.getWorkspace(), window.__verifyHostVm]
      const seen = new Set()
      while (queue.length) {
        const vm = queue.shift()
        if (!vm || seen.has(vm)) continue
        seen.add(vm)
        if (typeof vm.copyBlock === 'function') return vm.copyBlock({ from: 0, to: vm.editor.state.doc.firstChild.nodeSize })
        queue.push(...(vm.$children || []))
      }
      throw new Error('Menu component unavailable')
    })
    assert.equal(menuResult, true)
    await set(target, [{ type: 'paragraph' }])
    await target.keyboard.press('ControlOrMeta+v')
    await target.waitForFunction(() => window.__larkDoc.getEditor().state.doc.textContent === 'menu bold')
    const menuEvidence = await target.evaluate(() => window.__clipboardEvidence.at(-1))
    // Chromium exposes Async custom formats through read(), not native paste.
    assert.ok(menuEvidence.types.includes('text/html'))
    console.log('LIMITATION menu native paste only exposes: ' + menuEvidence.types.join(', '))
    assert.ok((await read(target)).content[0].content[0].marks.some(mark => mark.type === 'bold'))
    console.log('PASS menu HTML compatibility paste preserves bold; custom identity roundtrip NOT accepted')
    passed++
    await target.evaluate(async () => navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob(['<ul><li>nested list</li></ul>'], { type: 'text/html' }), 'text/plain': new Blob(['nested list'], { type: 'text/plain' }) })]))
    await set(target, [{ type: 'paragraph' }])
    await target.keyboard.press('ControlOrMeta+v')
    await target.waitForFunction(() => window.__larkDoc.getEditor().state.doc.textContent.includes('nested list'))
    const nested = await target.evaluate(() => window.__clipboardEvidence.at(-1))
    assert.ok(!nested.types.includes(MIME))
    const nestedJson = await read(target)
    assert.ok(nestedJson.content.some(node => node.type === 'bulletList'), JSON.stringify(nestedJson))
    console.log('PASS external list HTML native fallback preserves list wrapper')
    passed++
    for (const [name, html, expected] of [
      ['image', '<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=">', 'image'],
      ['table', '<table><tbody><tr><td><p>A</p></td><td><p>B</p></td></tr></tbody></table>', 'table'],
    ]) {
      await target.evaluate(async html => navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }) })]), html)
      await set(target, [{ type: 'paragraph' }])
      await target.keyboard.press('ControlOrMeta+v')
      await target.waitForFunction(type => window.__larkDoc.getEditor().getJSON().content.some(node => node.type === type), expected)
      const evidence = await target.evaluate(() => window.__clipboardEvidence.at(-1))
      assert.equal(evidence.trusted, true)
      assert.ok(!evidence.types.includes(MIME))
      if (name === 'table') assert.equal(await target.evaluate(() => window.__larkDoc.getEditor().state.doc.textContent), 'AB')
      console.log(`PASS external ${name} HTML paste not intercepted by private block path`)
      passed++
    }
    assert.deepEqual(errors, [])
    console.log(`PASS ${passed}/${passed}; Chromium headless OS clipboard, not Safari/device evidence`)
  } finally { await browser.close() }
}
main().catch(error => { console.error('FAIL', error); process.exitCode = 1 })
