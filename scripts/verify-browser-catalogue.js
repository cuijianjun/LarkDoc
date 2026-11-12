'use strict'

const assert = require('assert')
const { chromium } = require('playwright-core')

const BASE = process.argv[2] || 'http://127.0.0.1:58742/lark-doc?verify=1'
const results = []

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1680, height: 900 } })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const check = (name, passed, detail) => {
    results.push(passed)
    console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`)
    assert(passed, name)
  }
  const catalogEntry = index => page.frameLocator('.isv-catalog-iframe').locator('.catalog-text').nth(index)
  const metrics = async index => {
    const entry = catalogEntry(index)
    const entryBox = await entry.boundingBox()
    const pos = Number(await entry.getAttribute('data-catalog-pos'))
    const result = await page.evaluate(() => {
      const root = document.querySelector('.lark-doc')
      const editor = window.__larkDoc?.getEditor?.()
      const fixed = [...(root?.querySelectorAll('.lark-doc-topbar, .lark-doc-toolbar, .lark-doc-actions-host') || [])]
        .filter(element => ['fixed', 'sticky'].includes(getComputedStyle(element).position))
        .reduce((bottom, element) => Math.max(bottom, element.getBoundingClientRect().bottom), 0)
      return { pageY: window.scrollY, pageX: window.scrollX, fixedBottom: fixed, viewport: window.innerHeight, editorReady: !!editor }
    })
    const heading = await page.evaluate(pos => {
      const editor = window.__larkDoc?.getEditor?.()
      if (!editor || !Number.isFinite(pos)) return { headingTop: null, headingBottom: null }
      let target = editor.view.nodeDOM(Math.min(Math.max(pos, 0), editor.state.doc.content.size))
      if (!target) target = editor.view.domAtPos(Math.min(Math.max(pos, 0), editor.state.doc.content.size)).node
      if (target?.nodeType === 3) target = target.parentElement
      const node = target?.closest?.('[data-type="heading"], h1, h2, h3, h4, h5, h6')
      if (!node) return { headingTop: null, headingBottom: null }
      const rect = node.getBoundingClientRect()
      return { headingTop: rect.top, headingBottom: rect.bottom }
    }, pos)
    return { ...result, ...heading, targetTop: entryBox?.y ?? null }
  }
  const content = {
    type: 'doc',
    content: [
      { type: 'isv', attrs: { kind: 'catalog', instanceId: 'catalogue-browser-20261111', appId: 'cli_a3f7707424af9013', height: 335 } },
      ...Array.from({ length: 20 }, (_, index) => [
        { type: 'heading', attrs: { level: index % 3 + 1 }, content: [{ type: 'text', text: `目录目标 ${index + 1}` }] },
        { type: 'paragraph', content: [{ type: 'text', text: `正文段落 ${index + 1} `.repeat(14) }] },
      ]).flat(),
    ],
  }
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => window.__larkDoc?.getEditor?.())
    await page.evaluate(value => window.__larkDoc.setContent(value), content)
    await page.waitForFunction(() => document.querySelector('.isv-catalog-iframe'))
    await page.frameLocator('.isv-catalog-iframe').locator('.catalog-text').nth(19).waitFor()
    check('目录 iframe 内树节点完整挂载', await page.frameLocator('.isv-catalog-iframe').locator('.catalog-text').count() === 20)
    await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }))
    const before = await metrics(19)
    const last = catalogEntry(19)
    await last.click()
    await page.waitForTimeout(350)
    const after = await metrics(19)
    check('远距离目录点击定位到目标标题', after.headingTop !== null && after.headingBottom <= after.viewport + 1 && after.headingTop >= Math.max(0, after.fixedBottom) - 1, { before, after })
    check('目录定位不横向推动整个页面', after.pageX === 0)
    const beforeRepeat = await metrics(19)
    await last.click()
    await page.waitForTimeout(120)
    const afterRepeat = await metrics(19)
    check('目标已可见时重复点击不再次跳动', Math.abs(afterRepeat.pageY - beforeRepeat.pageY) < 1 && Math.abs((afterRepeat.headingTop || 0) - (beforeRepeat.headingTop || 0)) < 1, { beforeRepeat, afterRepeat })
    const first = catalogEntry(0)
    await first.click()
    await page.waitForTimeout(350)
    const back = await metrics(0)
    check('目录可反向定位回首个标题', back.headingTop >= Math.max(0, back.fixedBottom) - 1 && back.headingBottom <= back.viewport + 1, back)
    await page.evaluate(() => window.__larkDoc.patchProps({ readonly: true }))
    const beforeReadonly = await metrics(10)
    await catalogEntry(10).click()
    await page.waitForTimeout(350)
    const afterReadonly = await metrics(10)
    check('只读态仍保留目录跳转能力', afterReadonly.headingTop >= Math.max(0, afterReadonly.fixedBottom) - 1 && afterReadonly.headingBottom <= afterReadonly.viewport + 1, { beforeReadonly, afterReadonly })
    check('目录定位无脚本错误', errors.length === 0, errors)
  } finally {
    await browser.close()
  }
  console.log(`RESULT ${results.filter(Boolean).length}/${results.length}`)
}

main().catch(error => { console.error(error); process.exitCode = 1 })
