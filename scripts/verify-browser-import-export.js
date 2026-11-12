'use strict'

/**
 * 浏览器级导入/导出闭环：文件选择、确认替换、格式下载与开关边界。
 *
 * 只通过公开 LarkDoc 门面和可访问 DOM 断言，不读取 Vue 实例或内部 renderer 状态。
 */
const assert = require('assert')
const { chromium } = require('playwright-core')

const BASE = process.argv[2] || 'http://127.0.0.1:58742/lark-doc?verify=1'
const results = []

async function main() {
  const browser = await chromium.launch({ headless: true, acceptDownloads: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(12000)
  const errors = []
  let dialogs = 0
  page.on('pageerror', error => errors.push(error.message))
  page.on('dialog', async dialog => {
    dialogs += 1
    await dialog.accept()
  })
  const check = (name, passed, detail) => {
    results.push(passed)
    console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`)
    assert(passed, name)
  }
  const waitRender = () => page.waitForTimeout(420)
  const text = () => page.evaluate(() => window.__larkDoc.getText())

  async function importFile(name, body, mimeType, expectedText) {
    await page.locator('input[aria-label="导入文档"]').setInputFiles({
      name,
      mimeType,
      buffer: Buffer.from(body),
    })
    await page.waitForFunction(expected => window.__larkDoc.getText().includes(expected), expectedText)
    await waitRender()
  }

  async function exportFile(label) {
    const select = page.locator('button[role="combobox"][aria-label="导出文档格式"]')
    await select.click()
    const option = page.locator('[role="listbox"][aria-label="导出文档格式"] [role="option"]')
      .filter({ hasText: new RegExp(`^${label}`) }).first()
    await option.waitFor()
    const downloadPromise = page.waitForEvent('download')
    await option.click()
    const download = await downloadPromise
    return {
      filename: download.suggestedFilename(),
      body: await download.createReadStream().then(async stream => {
        if (!stream) return ''
        const chunks = []
        for await (const chunk of stream) chunks.push(chunk)
        return Buffer.concat(chunks).toString('utf8')
      }),
    }
  }

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => window.__larkDoc?.getEditor?.())
    await page.waitForTimeout(1800)
    await page.evaluate(() => window.__larkDoc.patchProps({
      config: { layout: { headerVisible: true }, features: { persistence: false } },
    }))
    await waitRender()

    const initial = await page.evaluate(() => ({
      importInput: !!document.querySelector('input[aria-label="导入文档"]'),
      exportSelect: !!document.querySelector('button[role="combobox"][aria-label="导出文档格式"]'),
      editable: document.querySelector('.ProseMirror')?.getAttribute('contenteditable'),
    }))
    check('导入/导出入口在宿主打开工作区头部后可见', initial.importInput && initial.exportSelect && initial.editable === 'true', initial)

    await page.evaluate(() => window.__larkDoc.setContent('<p>导入前正文</p>'))
    await page.waitForFunction(() => window.__larkDoc.getText() === '导入前正文')
    await importFile('safe-import.html', '<h1>HTML 导入标题</h1><p>安全正文<script>alert(1)</script></p>', 'text/html', 'HTML 导入标题')
    const htmlImport = await page.evaluate(() => ({
      text: window.__larkDoc.getText(),
      html: document.querySelector('.ProseMirror')?.innerHTML || '',
    }))
    check('HTML 文件选择确认后替换正文并清理脚本标签', htmlImport.text.includes('HTML 导入标题') && htmlImport.text.includes('安全正文') && !htmlImport.html.includes('<script'), htmlImport)

    const jsonPayload = await page.evaluate(() => ({
      schemaVersion: 3,
      title: 'JSON 导入标题',
      document: window.__larkDoc.getJSON(),
    }))
    await importFile('safe-import.json', JSON.stringify(jsonPayload), 'application/json', 'HTML 导入标题')
    check('JSON 文件导入保留文档结构和标题',
      (await text()).includes('HTML 导入标题') && (await page.evaluate(() => window.__larkDoc.getTitle?.() || '')) === 'JSON 导入标题',
      { text: await text(), title: await page.evaluate(() => window.__larkDoc.getTitle?.() || '') })

    await importFile('safe-import.md', '# Markdown 导入标题\n\nMarkdown 正文', 'text/markdown', 'Markdown 导入标题')
    check('Markdown 文件导入转换为可编辑正文', (await text()).includes('Markdown 导入标题') && (await text()).includes('Markdown 正文'), await text())
    check('导入确认闭环至少触发三次原生确认', dialogs >= 3, { dialogs })

    const html = await exportFile('HTML')
    check('HTML 导出产生下载且保留标题正文', /\.html$/i.test(html.filename) && html.body.includes('Markdown 导入标题') && html.body.includes('Markdown 正文'), { filename: html.filename, bytes: html.body.length })
    const json = await exportFile('JSON')
    let jsonDocument = null
    try { jsonDocument = JSON.parse(json.body) } catch (_) { /* assertion below reports malformed output */ }
    check('JSON 导出产生可回读的完整正文结构', /\.json$/i.test(json.filename) && jsonDocument?.document?.type === 'doc' && JSON.stringify(jsonDocument).includes('Markdown 正文'), { filename: json.filename, type: jsonDocument?.document?.type })
    const markdown = await exportFile('Markdown')
    check('Markdown 导出产生下载并保留正文语义', /\.md$/i.test(markdown.filename) && markdown.body.includes('Markdown 正文'), { filename: markdown.filename, bytes: markdown.body.length })
    const txt = await exportFile('纯文本')
    check('纯文本导出只下载文字内容', /\.txt$/i.test(txt.filename) && txt.body.includes('Markdown 正文') && !txt.body.includes('<h1>'), { filename: txt.filename, body: txt.body.slice(0, 120) })
    const word = await exportFile('Word')
    check('Word 导出产生 docx 下载', /\.docx$/i.test(word.filename) && word.body.length > 0, { filename: word.filename, bytes: word.body.length })

    let printed = 0
    await page.evaluate(() => { window.__verifyPrintCount = 0; window.print = () => { window.__verifyPrintCount += 1 } })
    await page.locator('button[role="combobox"][aria-label="导出文档格式"]').click()
    await page.locator('[role="listbox"][aria-label="导出文档格式"] [role="option"]').filter({ hasText: /^打印 \/ PDF/ }).click()
    await page.waitForTimeout(700)
    printed = await page.evaluate(() => window.__verifyPrintCount)
    check('打印/PDF 选项调用浏览器打印入口', printed === 1, { printed })

    await page.evaluate(() => window.__larkDoc.patchProps({ config: { features: { importExport: false } } }))
    await waitRender()
    const disabled = await page.evaluate(() => ({
      importInput: !!document.querySelector('input[aria-label="导入文档"]'),
      exportSelect: !!document.querySelector('button[role="combobox"][aria-label="导出文档格式"]'),
    }))
    check('关闭 importExport 总开关会同时移除导入/导出入口', !disabled.importInput && !disabled.exportSelect, disabled)
    check('导入导出浏览器闭环无页面脚本错误', errors.length === 0, errors)
  } finally {
    await browser.close()
  }
  console.log(`RESULT ${results.filter(Boolean).length}/${results.length}`)
}

main().catch(error => { console.error(error); process.exitCode = 1 })
