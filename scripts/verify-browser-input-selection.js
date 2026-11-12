'use strict'

/**
 * 浏览器级正文输入闭环：普通输入、选区替换、composition 事件、粘贴、撤销重做。
 * 只使用公开门面和编辑器 DOM，不读取 Vue 内部实例。
 */
const assert = require('assert')
const { chromium } = require('playwright-core')

const BASE = process.argv[2] || 'http://127.0.0.1:58742/lark-doc?verify=1'
const results = []

async function main() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const check = (name, passed, detail) => {
    results.push(passed)
    console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`)
    assert(passed, name)
  }
  const setContent = async html => {
    await page.evaluate(value => window.__larkDoc.setContent(value), html)
    await page.waitForTimeout(180)
  }
  const text = () => page.evaluate(() => window.__larkDoc.getText())

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => window.__larkDoc?.getEditor?.())

    await setContent('<p></p>')
    await page.locator('.ProseMirror p').first().click()
    await page.keyboard.insertText('普通输入')
    check('普通输入写入正文一次', await text() === '普通输入', await text())

    await setContent('<p>选区原文</p>')
    await page.locator('.ProseMirror p').first().click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.insertText('选区替换')
    check('Control/Meta+A 选区替换保留单份正文', await text() === '选区替换', await text())

    await setContent('<p></p>')
    await page.locator('.ProseMirror p').first().click()
    const composition = await page.evaluate(() => {
      const editor = document.querySelector('.ProseMirror')
      const fire = (type, data) => editor.dispatchEvent(new CompositionEvent(type, { bubbles: true, data }))
      fire('compositionstart', '')
      fire('compositionupdate', '拼')
      const during = window.__larkDoc.getText()
      fire('compositionend', '拼')
      return { during, after: window.__larkDoc.getText() }
    })
    check('compositionstart/update/end 不自行重复提交正文', composition.during === '' && composition.after === '', composition)
    await page.keyboard.insertText('拼音完成')
    check('composition 后真实输入只落一份文本', await text() === '拼音完成', await text())

    await setContent('<p></p>')
    await page.locator('.ProseMirror p').first().click()
    await page.evaluate(async () => navigator.clipboard.writeText('剪贴板输入'))
    await page.keyboard.press('ControlOrMeta+v')
    await page.waitForTimeout(260)
    check('真实剪贴板粘贴进入正文', await text() === '剪贴板输入', await text())

    await setContent('<p>基础</p>')
    await page.locator('.ProseMirror p').first().click()
    await page.keyboard.press('End')
    await page.keyboard.insertText('追加')
    check('输入追加落入同一段落', await text() === '基础追加', await text())
    await page.keyboard.press('ControlOrMeta+z')
    await page.waitForTimeout(180)
    check('撤销恢复追加前正文', await text() === '基础', await text())
    await page.keyboard.press('ControlOrMeta+Shift+z')
    await page.waitForTimeout(180)
    check('重做恢复追加正文', await text() === '基础追加', await text())
    check('输入/选区/IME 无页面脚本错误', errors.length === 0, errors)
  } finally {
    await browser.close()
  }
  console.log(`RESULT ${results.filter(Boolean).length}/${results.length}`)
}

main().catch(error => { console.error(error); process.exitCode = 1 })
