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
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const check = (name, passed, detail) => { results.push({ name, passed, detail }); console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`); assert(passed, name) }
  const json = () => page.evaluate(() => window.__columnsDoc.getJSON())
  const grid = () => page.locator('.tiptap [data-type="columns"]').first()
  const columns = () => grid().locator(':scope > [data-type="column"]')
  const click = async locator => {
    await locator.scrollIntoViewIfNeeded()
    const r = await locator.boundingBox(), viewport = page.viewportSize()
    assert(r && r.x + r.width / 2 >= 0 && r.x + r.width / 2 <= viewport.width && r.y + r.height / 2 >= 0 && r.y + r.height / 2 <= viewport.height, 'Visible mouse target required')
    await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2)
  }
  const drag = async (dx, cancel = false) => {
    const divider = columns().first().locator('.lark-doc-column-divider')
    await divider.scrollIntoViewIfNeeded()
    const r = await divider.boundingBox()
    await page.mouse.move(r.x + 6, r.y + 13)
    await page.mouse.down()
    await page.mouse.move(r.x + 6 + dx, r.y + 13, { steps: 12 })
    if (cancel) await page.keyboard.press('Escape')
    await page.mouse.up()
  }
  const setup = async content => page.evaluate(content => {
    const Facade = window.__larkDoc.document?.constructor || window.__larkDoc.constructor
    window.__larkDoc.destroy()
    const element = document.createElement('div')
    document.body.appendChild(element)
    window.__columnsDoc = new Facade({ element, storage: 'none', content })
  }, content)
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => window.__larkDoc?.getEditor?.())
    await setup('<p data-block-id="p_original">当前列正文</p>')
    await click(page.locator('.tiptap p').first())
    await page.keyboard.press('End')
    await page.keyboard.type(' /')
    await page.locator('[data-command-id="columns"]').hover()
    await click(page.getByRole('menuitem', { name: '2栏', exact: true }))
    await grid().waitFor()
    let doc = await json()
    check('Slash layout wraps existing text and retains its paragraph identity', doc.content[0].type === 'columns' && doc.content[0].content[0].content[0].attrs.blockId === 'p_original' && doc.content[0].content[0].content[0].content[0].text === '当前列正文 ')
    const paragraphStyle = await columns().first().locator('p').evaluate(e => ({ size: getComputedStyle(e).fontSize, height: getComputedStyle(e).lineHeight }))
    check('Default body typography matches measured 16px / 26px', paragraphStyle.size === '16px' && paragraphStyle.height === '26px', paragraphStyle)
    for (let target = 3; target <= 10; target += 1) {
      await grid().hover()
      await click(columns().first().getByRole('button', { name: '添加一栏', exact: true }))
      check(`Boundary button inserts real editable column ${target}`, await columns().count() === target && (await json()).content[0].content[0].content[0].attrs.blockId === 'p_original')
    }
    const geometry = await grid().evaluate(e => {
      const c = e.querySelector('[data-type="column"]'), d = c.querySelector('.lark-doc-column-divider'), a = c.querySelector('.lark-doc-column-add')
      return { grid: e.getBoundingClientRect().width, column: c.getBoundingClientRect().width, divider: d.getBoundingClientRect().width, add: a.getBoundingClientRect().toJSON(), columnTop: c.getBoundingClientRect().top }
    })
    check('Column, 12px divider and 16px add target match source geometry', Math.abs(geometry.column - (geometry.grid - 176) / 10) < 1 && geometry.divider === 12 && geometry.add.width === 16 && geometry.add.height === 16 && geometry.add.top === geometry.columnTop - 15, geometry)
    await columns().first().getByRole('button', { name: '添加一栏' }).hover()
    const accent = await columns().first().getByRole('button', { name: '添加一栏' }).evaluate(e => getComputedStyle(e, '::after').backgroundColor)
    const rgb = accent.match(/[\d.]+/g).map(Number)
    check('Column controls retain the project green theme', rgb[1] > rgb[0] && rgb[1] > rgb[2], accent)
    await page.screenshot({ path: path.join(evidenceDir, 'master-parity-local-columns-ten.png') })
    for (let target = 9; target >= 5; target -= 1) {
      await page.keyboard.press('Meta+z')
      await page.waitForFunction(count => document.querySelectorAll('.tiptap [data-type="columns"] > [data-type="column"]').length === count, target)
    }
    const before = await json(), width = (await grid().boundingBox()).width
    await drag(24)
    doc = await json()
    check('Divider drag changes only its adjacent pair and preserves all content IDs', Math.abs(doc.content[0].content[0].attrs.width - (20 + 24 / width * 100)) < 0.0001 && Math.abs(doc.content[0].content[1].attrs.width - (20 - 24 / width * 100)) < 0.0001 && JSON.stringify(doc.content[0].content.slice(2)) === JSON.stringify(before.content[0].content.slice(2)) && doc.content[0].content[0].content[0].attrs.blockId === 'p_original')
    await page.keyboard.press('Meta+z')
    check('One undo restores both widths', JSON.stringify(await json()) === JSON.stringify(before))
    await page.keyboard.press('Meta+Shift+z')
    check('Redo restores the completed resize', JSON.stringify(await json()) === JSON.stringify(doc))
    const resized = await json()
    await drag(24, true)
    check('Escape cancels resize without a document write', JSON.stringify(await json()) === JSON.stringify(resized))
    await drag(-500)
    check('Resize clamps at the measured one-of-24 minimum', Math.abs((await json()).content[0].content[0].attrs.width - 100 / 24) < 0.0001)
    await page.keyboard.press('Meta+z')
    const saved = await json()
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => window.__larkDoc?.getEditor?.())
    await setup(saved)
    check('JSON reload retains five columns, custom widths and stable identities', JSON.stringify(await json()) === JSON.stringify(saved))
    await grid().hover()
    await click(columns().first().getByRole('button', { name: '添加一栏' }))
    check('Loaded persistent layouts retain live add controls', await columns().count() === 6)
    await page.keyboard.press('Meta+z')
    check('Loaded-layout add restores keyboard focus and undo removes that column', await columns().count() === 5)
    await drag(12)
    check('Loaded persistent layouts retain live resize controls', (await json()).content[0].content[0].attrs.width > saved.content[0].content[0].attrs.width)
    await page.keyboard.press('Meta+z')
    await page.evaluate(() => window.__columnsDoc.patchProps({ config: { features: { columns: false } } }))
    const disabled = await json()
    const blocked = await page.evaluate(() => ({ insert: window.__columnsDoc.getEditor().commands.insertColumns(2), add: window.__columnsDoc.getEditor().commands.addLayoutColumn(1) }))
    check('Feature disable hides layout controls and blocks direct layout API', await grid().getByRole('button', { name: '添加一栏' }).count() === 0 && blocked.insert === false && blocked.add === false && JSON.stringify(await json()) === JSON.stringify(disabled))
    await click(columns().nth(1).locator('p').first())
    await page.keyboard.press('Backspace')
    check('Feature disable keeps an empty column on Backspace', JSON.stringify(await json()) === JSON.stringify(disabled))
    await page.evaluate(() => window.__columnsDoc.patchProps({ config: { features: { columns: true } } }))
    for (let target = 4; target >= 2; target -= 1) {
      await click(columns().nth(1).locator('p').first())
      await page.keyboard.press('Home')
      await page.keyboard.press('Backspace')
      check(`Empty-column Backspace removes exactly one column (${target} remain)`, await columns().count() === target)
    }
    await click(columns().nth(1).locator('p').first())
    await page.keyboard.press('Backspace')
    check('Two-to-one Backspace unwraps the survivor with original paragraph ID and text', await grid().count() === 0 && (await json()).content[0].attrs.blockId === 'p_original' && (await json()).content[0].content[0].text === '当前列正文 ')
    await page.keyboard.press('Meta+z')
    await page.evaluate(() => window.__columnsDoc.setReadonly(true))
    const readonly = await json()
    check('Read mode hides all layout mutation controls', await grid().getByRole('button', { name: '添加一栏' }).count() === 0)
    await click(columns().first().locator('p').first())
    await page.keyboard.press('Backspace')
    check('Read-mode keyboard does not mutate the document', JSON.stringify(await json()) === JSON.stringify(readonly))
    await page.evaluate(() => {
      window.__columnsDoc.setReadonly(false)
      window.__columnsDoc.setContent({ type: 'doc', content: [{ type: 'columns', content: Array.from({ length: 3 }, (_, index) => ({ type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: `旧栏${index + 1}` }] }] })) }] })
    })
    const legacy = await grid().evaluate(e => ({ width: e.getBoundingClientRect().width, left: e.getBoundingClientRect().left, right: e.getBoundingClientRect().right, columns: [...e.children].map(c => c.getBoundingClientRect().toJSON()) }))
    check('Legacy default 50/50/50 weights render as three equal columns without overflow', Math.abs(legacy.columns[0].width - (legacy.width - 36) / 3) < 1 && Math.abs(legacy.columns[2].right - legacy.right - 2) < 1 && Math.abs(legacy.columns[0].left - legacy.left + 2) < 1, legacy)
    await page.evaluate(() => window.__columnsDoc.setContent(window.__columnsDoc.getHTML()))
    check('Legacy HTML also retains three columns without overflow', await columns().count() === 3 && (await columns().last().boundingBox()).x + (await columns().last().boundingBox()).width <= (await grid().boundingBox()).x + (await grid().boundingBox()).width + 3)
    check('No uncaught page errors', errors.length === 0, errors)
  } catch (error) {
    console.error('DOCUMENT', JSON.stringify(await json().catch(() => null)))
    await page.screenshot({ path: path.join(evidenceDir, 'master-parity-local-columns-failure.png') })
    throw error
  } finally {
    fs.writeFileSync(path.join(evidenceDir, 'master-parity-local-columns.json'), JSON.stringify({ url: baseUrl, results, errors }, null, 2))
    await browser.close()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
