'use strict'

/**
 * 浏览器级正文输入闭环：普通输入、选区替换、composition 事件、粘贴、撤销重做。
 * 只使用公开门面和编辑器 DOM，不读取 Vue 内部实例。
 */
const assert = require('assert')
const { chromium } = require('playwright-core')

const BASE = process.argv[2] || 'http://127.0.0.1:58742/lark-doc?verify=1'
const results = []

async function auditInteractions(page, check) {
  const toolbar = page.locator('.lark-doc-toolbar')
  const paragraph = () => page.locator('.ProseMirror p').last()
  const text = () => page.evaluate(() => window.__larkDoc.getText())
  const setContent = async html => {
    await page.evaluate(value => window.__larkDoc.setContent(value), html)
    await paragraph().click()
  }
  const move = async selector => {
    await toolbar.locator(selector).hover()
    await page.waitForTimeout(200)
  }
  await page.setViewportSize({ width: 1920, height: 1000 })
  await setContent('<p>连续操作正文</p>')
  await move('button[aria-label="标题级别"]')
  check('冷开标题菜单可见', await page.getByRole('menu', { name: '标题级别', exact: true }).isVisible())
  await move('button[aria-label="插入"]')
  check('只悬浮插入按钮也能收掉旧标题菜单', await page.locator('.lark-doc-heading-menu').count() === 0)
  await move('button[aria-label="标题级别"]')
  await move('.lark-doc-color')
  check('标题切到颜色只保留颜色面板', await page.locator('.lark-doc-heading-menu').count() === 0 && await page.locator('.lark-doc-color-palette').isVisible())
  await move('button[aria-label="图表"]')
  check('颜色切到图表关闭旧色板', await page.locator('.lark-doc-color-palette').count() === 0 && await page.locator('.lark-doc-diagram-menu').isVisible())
  check('六种图表入口都有独立图标', await page.locator('.lark-doc-diagram-menu button').count() === 6 && new Set(await page.locator('.lark-doc-diagram-menu-icon svg').evaluateAll(nodes => nodes.map(n => n.innerHTML))).size === 6)
  await move('button[aria-label="标题级别"]')
  check('图表切回标题不残留旧浮层', await page.locator('.lark-doc-diagram-menu').count() === 0 && await page.locator('.lark-doc-heading-menu').isVisible())
  await page.getByRole('menuitem', { name: '二级标题', exact: true }).click()
  check('标题选择保留正文并关闭菜单', await page.locator('.ProseMirror h2').innerText() === '连续操作正文' && await page.locator('.lark-doc-heading-menu').count() === 0)
  await page.keyboard.press('ControlOrMeta+z')
  check('标题转换可撤销', await paragraph().innerText() === '连续操作正文')

  await page.setViewportSize({ width: 900, height: 900 })
  await paragraph().click()
  await page.keyboard.press('End')
  await move('button[aria-label="标题级别"]')
  await move('button[aria-label="更多"]')
  check('窄窗标题切更多不叠旧菜单', await page.locator('.lark-doc-heading-menu').count() === 0 && await page.locator('.lark-doc-more-menu').isVisible())
  await page.getByRole('menuitem', { name: '插入内容…', exact: true }).click()
  await page.locator('.lark-doc-command-menu').waitFor()
  check('更多可进入插入菜单且自身关闭', await page.locator('.lark-doc-command-menu').isVisible() && await page.locator('.lark-doc-more-menu').count() === 0)
  const beforeCancel = await text()
  await page.keyboard.press('Escape')
  await page.keyboard.insertText('取消后续写')
  check('插入取消后直接续写不丢字', await text() === beforeCancel + '取消后续写', { actual: await text(), expected: beforeCancel + '取消后续写' })
  await page.keyboard.press('ControlOrMeta+z')

  await setContent('<p>链接原文</p>')
  await page.keyboard.press('End')
  await toolbar.getByRole('button', { name: '设置链接', exact: true }).click()
  await page.getByRole('textbox', { name: '链接文本', exact: true }).fill('取消草稿')
  await page.keyboard.press('Escape')
  await page.keyboard.insertText('即时续写')
  check('链接取消立即归还焦点且丢弃草稿', await text() === '链接原文即时续写' && await page.locator('.lark-doc-link-dialog').count() === 0)
  await toolbar.getByRole('button', { name: '设置链接', exact: true }).click()
  await page.getByRole('textbox', { name: '链接文本', exact: true }).fill('本地链接')
  await page.getByRole('textbox', { name: '链接地址', exact: true }).fill('javascript:alert(1)')
  check('链接危险协议禁止确认', await page.getByRole('dialog', { name: '设置链接', exact: true }).getByRole('button', { name: '确认', exact: true }).isDisabled())
  await page.getByRole('textbox', { name: '链接地址', exact: true }).fill('https://example.com/local-audit')
  await page.getByRole('dialog', { name: '设置链接', exact: true }).getByRole('button', { name: '确认', exact: true }).click()
  check('确认链接生成真实行内节点', await page.locator('.ProseMirror a[href="https://example.com/local-audit"]').innerText() === '本地链接', await page.evaluate(() => ({ text: window.__larkDoc.getText(), focus: document.activeElement?.tagName })))
  await page.keyboard.press('ControlOrMeta+z')
  check('链接插入撤销保留前文', await text() === '链接原文即时续写', await page.evaluate(() => ({ text: window.__larkDoc.getText(), focus: document.activeElement?.tagName })))

  await setContent('<p>目标一 目标二</p>')
  await page.keyboard.press('ControlOrMeta+f')
  const find = page.locator('#lark-doc-fr-find')
  const counter = page.locator('.lark-doc-fr-counter')
  await find.fill('目标')
  await page.waitForFunction(() => document.querySelector('.lark-doc-fr-counter')?.textContent === '1 / 2')
  check('实际键盘打开查找并列出两处命中', await counter.innerText() === '1 / 2')
  await page.keyboard.press('Shift+Enter')
  check('Shift+Enter反向查找并循环到最后一处', await counter.innerText() === '2 / 2')
  await page.keyboard.press('Enter')
  check('Enter正向查找循环到首处', await counter.innerText() === '1 / 2')
  await page.keyboard.press('ControlOrMeta+Shift+h')
  check('查找输入内快捷键能切换替换页', await page.locator('#lark-doc-fr-replace').isVisible() && await find.inputValue() === '目标')
  await page.locator('#lark-doc-fr-replace').fill('替换')
  await page.keyboard.press('ControlOrMeta+f')
  check('替换输入内快捷键能切回查找并聚焦', !await page.locator('#lark-doc-fr-replace').isVisible() && await find.evaluate(n => n === document.activeElement))
  await page.keyboard.press('ControlOrMeta+Shift+h')
  await page.getByRole('button', { name: '全部替换', exact: true }).click()
  check('全部替换真实修改两处', await text() === '替换一 替换二')
  await page.keyboard.press('Escape')
  await page.keyboard.insertText('继续')
  check('查找取消立即返回正文可输入', await page.locator('.lark-doc-fr').count() === 0 && (await text()).includes('继续'))
  await page.keyboard.press('ControlOrMeta+z')
  await page.keyboard.press('ControlOrMeta+z')
  check('替换与后续输入可逐步撤销', await text() === '目标一 目标二', await text())
  await page.keyboard.press('ControlOrMeta+f')
  await find.fill('目标')
  await page.waitForFunction(() => document.querySelector('.lark-doc-fr-counter')?.textContent?.endsWith('/ 2'))
  await page.keyboard.press('ControlOrMeta+Shift+h')
  await page.evaluate(() => window.__larkDoc.setReadonly(true))
  check('只读切换后替换按钮禁用但查找保留', await page.getByRole('button', { name: '全部替换', exact: true }).isDisabled() && await find.isVisible())
  await page.keyboard.press('Escape')
  check('只读下关闭查找不修改正文', await text() === '目标一 目标二')
  await page.evaluate(() => window.__larkDoc.setReadonly(false))
  await paragraph().click()
  await page.keyboard.press('End')
  await page.keyboard.insertText('恢复编辑')
  check('退出只读后正文可继续输入', await text() === '目标一 目标二恢复编辑')
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined, chromiumSandbox: true, headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const check = (name, passed, detail) => {
    results.push(passed)
    console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`)
    if (!process.argv.includes('--interaction-audit')) assert(passed, name)
  }
  const setContent = async html => {
    await page.evaluate(value => window.__larkDoc.setContent(value), html)
    await page.waitForTimeout(180)
  }
  const text = () => page.evaluate(() => window.__larkDoc.getText())

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => window.__larkDoc?.getEditor?.())

    if (process.argv.includes('--interaction-audit')) await auditInteractions(page, check)
    else {
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
    }
    check('输入/选区/IME 无页面脚本错误', errors.length === 0, errors)
  } finally {
    await browser.close()
  }
  console.log(`RESULT ${results.filter(Boolean).length}/${results.length}`)
  if (results.some(passed => !passed)) process.exitCode = 1
}

main().catch(error => { console.error(error); process.exitCode = 1 })
