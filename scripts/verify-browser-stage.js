'use strict'
// Current Feishu presentation: a fullscreen, scrolling rich document with a Return control.
const assert = require('assert')
const path = require('path')
const { chromium } = require('playwright-core')
const base = process.argv[2] || 'http://127.0.0.1:58742/lark-doc?verify=1'
const evidence = process.env.LARK_DOC_EVIDENCE_DIR || '/tmp/lark-doc-v12e'
const results = []
async function main() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } })
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const check = (name, ok, detail) => {
    results.push({ name, ok: !!ok, detail })
    console.log((ok ? 'PASS ' : 'FAIL ') + name)
    assert(ok, name + (detail ? ': ' + JSON.stringify(detail) : ''))
  }
  const stage = () => page.locator('.lark-doc-slide-stage')
  const snapshot = () => page.evaluate(() => JSON.stringify(window.__larkDoc.getJSON()))
  const enter = async () => {
    await page.locator('.lark-doc-toolbar button[aria-label="演示模式"]').click()
    await stage().waitFor()
    await page.waitForFunction(() => !!document.fullscreenElement && document.querySelector('.lark-doc-slide-stage strong')?.textContent === '粗体正文')
  }
  const exited = async () => {
    await stage().waitFor({ state: 'detached' })
    await page.waitForFunction(() => !document.fullscreenElement)
  }
  try {
    await page.goto(base, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => window.__larkDoc?.getEditor?.())
    await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 323; canvas.height = 275
      const paint = canvas.getContext('2d')
      paint.fillStyle = '#28b999'; paint.fillRect(0, 0, 323, 275)
      paint.fillStyle = '#f19b80'; paint.fillRect(40, 35, 130, 120)
      const text = value => ({ type: 'text', text: value })
      const para = value => ({ type: 'paragraph', content: [text(value)] })
      const href = location.origin + '/__larkdoc-preview-fixture'
      window.__larkDoc.setContent({ type: 'doc', content: [
        { type: 'heading', attrs: { level: 1 }, content: [text('第一节演示')] },
        { type: 'paragraph', content: [{ ...text('粗体正文'), marks: [{ type: 'bold' }] }, text(' 与 '), { type: 'inlineMath', attrs: { latex: 'x^2+1' } }] },
        { type: 'table', content: [{ type: 'tableRow', content: ['左单元格', '右单元格'].map(value => ({ type: 'tableCell', content: [para(value)] })) }] },
        { type: 'codeBlock', attrs: { language: 'javascript' }, content: [text('const presentation = 1;')] },
        { type: 'image', attrs: { src: canvas.toDataURL('image/png'), width: 323, naturalWidth: 323, naturalHeight: 275, crop: [0.1, 0.1, 0.9, 0.9], caption: '裁剪图片说明' } },
        { type: 'paragraph', content: [{ ...text('行内链接'), marks: [{ type: 'link', attrs: { href, target: '_blank' } }] }] },
        { type: 'bookmark', attrs: { url: href, title: '演示网页卡片' } },
        { type: 'linkEmbed', attrs: { href, view: 'preview', title: '演示网页预览' } },
        { type: 'heading', attrs: { level: 1 }, content: [text('第二节演示')] },
        ...Array.from({ length: 50 }, (_, index) => para('完整文档滚动内容 ' + index)),
        para('全文结束标记'),
      ] })
    })
    await page.waitForFunction(() => document.querySelector('.lark-doc-image-img')?.naturalWidth === 323)
    const before = await snapshot()
    check('编辑模式不挂载演示副本', await stage().count() === 0)
    await enter()
    const geometry = await stage().evaluate(root => {
      const css = getComputedStyle(root), rect = root.getBoundingClientRect()
      const header = root.querySelector('header')
      const scrollers = [root, ...root.querySelectorAll('*')].filter(node => /auto|scroll/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 100)
      return { position: css.position, rect: rect.toJSON(), header: header?.getBoundingClientRect().toJSON(), scrollers: scrollers.length, fullscreen: !!document.fullscreenElement }
    })
    check('演示为铺满视口的固定全屏层', geometry.position === 'fixed' && geometry.rect.x === 0 && geometry.rect.y === 0 && geometry.rect.width === 1440 && geometry.rect.height === 1050 && geometry.fullscreen, geometry)
    check('返回顶栏高64px且无旧分页控件', geometry.header?.height === 64 && await stage().getByRole('button', { name: '返回', exact: true }).count() === 1 && await stage().getByRole('button', { name: /上一页|下一页|退出演示/ }).count() === 0)
    check('同一演示文档保留两个章节及全文末尾', await stage().getByText('第一节演示', { exact: true }).count() === 1 && await stage().getByText('第二节演示', { exact: true }).count() === 1 && await stage().getByText('全文结束标记', { exact: true }).count() === 1)
    check('正文粗体、表格及代码均保留', await stage().locator('strong').filter({ hasText: '粗体正文' }).count() === 1 && await stage().locator('td').count() === 2 && (await stage().innerText()).includes('const presentation = 1;'))
    check('公式保留实际渲染结果', await stage().locator('.katex').count() > 0)
    check('副本不包含可编辑区域、代码编辑框或图片调整控件', await stage().locator('[contenteditable="true"], textarea, .lark-doc-image-resize, .lark-doc-link-preview-resize').count() === 0)
    check('原编辑器在演示期间只读且正文不变', await page.evaluate(() => !window.__larkDoc.getEditor().isEditable) && await snapshot() === before)
    const image = stage().locator('.lark-doc-image-img').first()
    await image.scrollIntoViewIfNeeded()
    const picture = await image.evaluate(node => ({ decoded: node.complete && node.naturalWidth === 323, viewport: node.parentElement.getBoundingClientRect().toJSON(), style: node.getAttribute('style') }))
    check('裁剪图片像素、说明及投影样式保留', picture.decoded && (await stage().innerText()).includes('裁剪图片说明') && !!picture.style, picture)
    await image.click()
    await page.locator('.lark-doc-image-viewer-shell').waitFor()
    check('演示中的图片点击打开只读查看器', await page.locator('.lark-doc-image-viewer-shell').isVisible())
    await page.keyboard.press('Escape')
    await page.locator('.lark-doc-image-viewer-shell').waitFor({ state: 'detached' })
    check('关闭图片查看器后演示继续保持', await stage().isVisible())
    for (const selector of ['a[href]', '.lark-doc-bookmark-card']) {
      const target = stage().locator(selector).first()
      await target.scrollIntoViewIfNeeded()
      const popupPending = context.waitForEvent('page')
      await target.click()
      const popup = await popupPending
      await popup.waitForLoadState('domcontentloaded')
      check('演示内容点击在新页打开：' + selector, popup.url().includes('/__larkdoc-preview-fixture'))
      await popup.close()
    }
    check('内嵌网页仍有实际预览而非纯文字标题', await stage().locator('iframe').count() === 1)
    check('完整文档有独立滚动区域', geometry.scrollers > 0)
    await page.mouse.move(1400, 700)
    await page.mouse.wheel(0, 1600)
    await page.waitForTimeout(100)
    const scrolled = await stage().evaluate(root => [root, ...root.querySelectorAll('*')].some(node => node.scrollTop > 0))
    check('真实鼠标滚轮可滚动全文', scrolled)
    await page.keyboard.press('PageDown')
    check('PageDown不切换为纯文字分页', await stage().getByText('第一节演示', { exact: true }).count() === 1 && await stage().getByText('第二节演示', { exact: true }).count() === 1)
    await stage().screenshot({ path: path.join(evidence, 'master-parity-local-presentation.png') })
    await stage().getByRole('button', { name: '返回', exact: true }).click()
    await exited()
    check('返回退出全屏、恢复编辑及原文档', await page.evaluate(() => window.__larkDoc.getEditor().isEditable) && await snapshot() === before)
    await enter()
    await page.keyboard.press('Escape')
    await exited()
    check('Escape退出后副本彻底移除且正文不变', await stage().count() === 0 && await snapshot() === before)
    await page.evaluate(() => window.__larkDoc.setReadonly(true))
    await enter()
    await stage().getByRole('button', { name: '返回', exact: true }).click()
    await exited()
    check('从外部只读状态进入演示后仍恢复为只读', await page.evaluate(() => !window.__larkDoc.getEditor().isEditable))
    check('浏览器无脚本错误', errors.length === 0, errors)
  } finally {
    if (errors.length) console.error('PAGE_ERRORS ' + JSON.stringify(errors))
    const overlay = page.frameLocator('#webpack-dev-server-client-overlay').locator('body')
    if (await page.locator('#webpack-dev-server-client-overlay').count()) console.error('DEV_OVERLAY ' + await overlay.innerText())
    await browser.close()
  }
  console.log('RESULT ' + results.filter(item => item.ok).length + '/' + results.length)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
