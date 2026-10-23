'use strict'
/**
 * 浏览器级验证：标题编号（飞书「标题编号」= 给标题挂有序列表编号）。
 *
 * 覆盖真飞书核对过的语义：
 * - 编号是块级 UI（contentEditable=false 的按钮），不在正文文本里，getText 拿不到；
 * - 三级格式 1. / 1.1 / 1.1.1，一级带尾点、多级不带；
 * - 点编号弹三项菜单：继续标题编号（未重开时禁用）/ 重新开始编号 / 设置编号的值；
 * - 「设置编号的值」就地数字输入框，提交后本级从该值起算；
 * - 「重新开始编号」该层从 1 重开，「继续标题编号」回到跟随上文的连续编号；
 * - 编号每帧按文档现算：删掉中间带编号的标题后自动接续，不留空号；
 * - 块菜单「有序列表」作用在标题上 = 开启编号，作用在正文上 = 真转有序列表；
 * - 快捷键 Cmd/Ctrl+Shift+7 切换。
 *
 * 依赖：demo dev server（Vue 路由暴露 window.__larkDoc）。用法：
 *   node scripts/verify-browser-heading-number.js [url]
 */
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright-core')

const BASE = process.argv[2] || 'http://localhost:8080/lark-doc'
const LARK_DOC_PRIMARY = 'rgb(20, 86, 240)'
const results = []

function findChromium() {
  const cache = path.join(process.env.HOME, 'Library', 'Caches', 'ms-playwright')
  if (!fs.existsSync(cache)) return null
  const dirs = fs.readdirSync(cache).filter((name) => /^chromium-\d+$/.test(name)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
  for (const dir of dirs) {
    for (const candidate of [
      path.join(cache, dir, 'chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
      path.join(cache, dir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
    ]) if (fs.existsSync(candidate)) return candidate
  }
  return null
}

function record(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

// H1 第一章 / H2 第一节 / H2 第二节 / H1 第二章 —— 期望 1. / 1.1 / 1.2 / 2.
const CONTENT = `
<h1 data-numbering="true">第一章</h1>
<h2 data-numbering="true">第一节</h2>
<h2 data-numbering="true">第二节</h2>
<h1 data-numbering="true">第二章</h1>
<p>普通段落</p>
`.trim()

const readNumbers = (page) => page.evaluate(() => {
  const editor = window.__larkDoc.getEditor()
  const buttons = Array.from(document.querySelectorAll('.lark-doc-heading-number'))
  return {
    labels: buttons.map((el) => el.textContent),
    levels: buttons.map((el) => el.getAttribute('data-level')),
    colors: buttons.map((el) => getComputedStyle(el).color),
    fontSizes: buttons.map((el) => Math.round(parseFloat(getComputedStyle(el).fontSize))),
    contentEditable: buttons.map((el) => el.getAttribute('contenteditable')),
    // 编号必须在标题文字之前、同一行（飞书是「▾ 2. 标题」）：
    // 用文字首字符的实测矩形比对，避免依赖具体 DOM 包装层。
    beforeContent: buttons.map((el) => {
      const heading = el.closest('h1, h2, h3, h4, h5, h6')
      if (!heading) return false
      const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT)
      let node = walker.nextNode()
      while (node && (!node.textContent.trim() || el.contains(node))) node = walker.nextNode()
      if (!node) return false
      const text = node.textContent
      const range = document.createRange()
      range.setStart(node, text.search(/\S/))
      range.setEnd(node, text.search(/\S/) + 1)
      const textRect = range.getBoundingClientRect()
      const box = el.getBoundingClientRect()
      const sameRow = box.bottom > textRect.top + 2 && box.top < textRect.bottom - 2
      return sameRow && box.right <= textRect.left + 4
    }),
    text: editor.getText(),
    headingFontSizes: Array.from(document.querySelectorAll('.ProseMirror h1, .ProseMirror h2')).map((el) => Math.round(parseFloat(getComputedStyle(el).fontSize))),
    html: editor.getHTML(),
  }
})

const setContent = async (page, html) => {
  await page.evaluate((value) => {
    window.__larkDoc.getEditor().commands.setContent(value)
    window.localStorage.removeItem('lark-doc:folds:local')
  }, html)
  await page.waitForTimeout(600)
}

const clickNumber = async (page, index = 0) => {
  const box = await page.evaluate((target) => {
    const el = document.querySelectorAll('.lark-doc-heading-number')[target]
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }, index)
  if (!box) throw new Error(`没有第 ${index} 个编号按钮`)
  await page.mouse.click(box.x, box.y)
  await page.waitForTimeout(320)
}

const menuState = (page) => page.evaluate(() => {
  const menu = document.querySelector('.lark-doc-heading-number-menu')
  if (!menu) return { open: false }
  const items = Array.from(menu.querySelectorAll('.lark-doc-heading-number-item'))
  const rect = menu.getBoundingClientRect()
  return {
    open: true,
    ids: items.map((el) => el.getAttribute('data-menu-id')),
    labels: items.map((el) => (el.querySelector('.lark-doc-heading-number-text')?.textContent || '').trim()),
    disabled: items.map((el) => el.disabled === true || el.getAttribute('aria-disabled') === 'true'),
    hasIcons: items.every((el) => !!el.querySelector('.lark-doc-heading-number-icon svg')),
    width: Math.round(rect.width),
    editing: menu.classList.contains('is-editing'),
    inputValue: menu.querySelector('.lark-doc-heading-number-input')?.value ?? null,
  }
})

const clickMenuItem = async (page, id) => {
  await page.evaluate((menuId) => {
    const el = Array.from(document.querySelectorAll('.lark-doc-heading-number-item')).find((item) => item.getAttribute('data-menu-id') === menuId)
    if (el) el.click()
  }, id)
  await page.waitForTimeout(400)
}

async function main() {
  const executablePath = findChromium()
  if (!executablePath) throw new Error('未找到本机 chromium 缓存，无法运行浏览器验证')
  const browser = await chromium.launch({ headless: true, executablePath })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 90000 })
  await page.waitForFunction(() => window.__larkDoc && window.__larkDoc.getEditor && window.__larkDoc.getEditor(), { timeout: 60000 })

  // 1. 多级格式与渲染
  await setContent(page, CONTENT)
  const first = await readNumbers(page)
  record('[编号] 一级带尾点、二级多级不带点', JSON.stringify(first.labels) === JSON.stringify(['1.', '1.1', '1.2', '2.']), first.labels.join(' '))
  record('[编号] 编号是块级按钮，不在正文文本里', first.contentEditable.every((value) => value === 'false') && !/\d\./.test(first.text.replace(/第[一二]章|第[一二]节/g, '')),
    `contentEditable=${first.contentEditable.join(',')} / text=${JSON.stringify(first.text)}`)
  record('[编号] 编号渲染在标题文字之前', first.beforeContent.every(Boolean), first.beforeContent.join(','))
  record('[编号] 颜色用飞书主色 #1456f0', first.colors.every((color) => color === LARK_DOC_PRIMARY), first.colors[0])
  // 飞书编号字号跟随标题字号（H1 26px、H2 20px 这一档）
  record('[编号] 编号字号跟随标题字号', first.fontSizes[0] === first.headingFontSizes[0] && first.fontSizes[1] === first.headingFontSizes[1],
    `H1 ${first.fontSizes[0]}/${first.headingFontSizes[0]} H2 ${first.fontSizes[1]}/${first.headingFontSizes[1]}`)
  record('[HTML] 编号开关落进 data-numbering', (first.html.match(/data-numbering="true"/g) || []).length === 4, `出现 ${(first.html.match(/data-numbering="true"/g) || []).length} 次`)

  // 2. 点编号弹菜单：三项、顺序、图标、「继续」初始禁用
  await clickNumber(page, 0)
  const menu = await menuState(page)
  record('[菜单] 点编号弹出三项菜单', menu.open === true && menu.ids.length === 3, `open=${menu.open} 项=${(menu.ids || []).join(',')}`)
  record('[菜单] 项顺序与飞书一致', JSON.stringify(menu.ids) === JSON.stringify(['continue', 'restart', 'renumber']), (menu.ids || []).join(','))
  record('[菜单] 文案与飞书一致', JSON.stringify(menu.labels) === JSON.stringify(['继续编号', '重新开始编号', '设置编号的值']), (menu.labels || []).join(' | '))
  record('[菜单] 每项都带图标', menu.hasIcons === true)
  record('[菜单] 未重开编号时「继续标题编号」禁用', menu.disabled?.[0] === true && menu.disabled?.[1] === false && menu.disabled?.[2] === false,
    (menu.disabled || []).join(','))
  record('[菜单] 菜单宽度贴飞书 192px', menu.width === 192, `${menu.width}px`)

  // 「设置编号」气泡必须跟着编号走：编号按钮要自成定位祖先，
  // 否则 absolute 的 ::after 会挂到 .ProseMirror 上、永远画在正文左上角。
  const tooltip = await page.evaluate(() => {
    const el = document.querySelectorAll('.lark-doc-heading-number')[0]
    const rect = el.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, position: getComputedStyle(el).position, height: rect.height }
  })
  await page.mouse.move(tooltip.x, tooltip.y)
  await page.waitForTimeout(250)
  const bubble = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelectorAll('.lark-doc-heading-number')[0], '::after')
    return { content: cs.content, bottom: cs.bottom, left: cs.left }
  })
  record('[气泡] 编号按钮自成定位祖先', tooltip.position === 'relative', `position=${tooltip.position}`)
  record('[气泡] 「设置编号」贴在数字上方', Math.abs(parseFloat(bubble.bottom) - (tooltip.height + 4)) < 1.5 && bubble.left === '0px',
    `bottom=${bubble.bottom} 行高=${tooltip.height.toFixed(1)} left=${bubble.left}`)
  await page.mouse.move(0, 0)
  await page.waitForTimeout(120)

  // 3. 设置编号的值 → 就地输入框 → 从该值起算
  await clickMenuItem(page, 'renumber')
  const editing = await menuState(page)
  record('[设置值] 就地变成数字输入框', editing.open === true && editing.editing === true && editing.inputValue !== null, `value=${editing.inputValue}`)
  record('[设置值] 输入框预填当前编号末位', editing.inputValue === '1', `value=${editing.inputValue}`)
  await page.fill('.lark-doc-heading-number-input', '7')
  await page.waitForTimeout(150)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)
  const afterValue = await readNumbers(page)
  record('[设置值] 提交后本级从 7 起算', JSON.stringify(afterValue.labels) === JSON.stringify(['7.', '7.1', '7.2', '8.']), afterValue.labels.join(' '))
  record('[设置值] 提交后菜单关闭', (await menuState(page)).open === false)
  record('[HTML] 起点落进 data-numbering-start', /data-numbering-start="7"/.test(afterValue.html), afterValue.html.slice(0, 60))

  // 4. 重新开始编号 → 该层从 1 重开；再「继续」回到跟随上文
  //    第 1 块在第 3 步已经被设成 7，此时它的「继续标题编号」才应该可点。
  await clickNumber(page, 0)
  const secondMenu = await menuState(page)
  record('[重开] 指定过起点后「继续标题编号」可点', secondMenu.open === true && secondMenu.disabled?.[0] === false, `disabled=${secondMenu.disabled?.[0]}`)
  await page.evaluate(() => window.__larkDoc.getWorkspace().$refs.document.closeHeadingNumberMenu())
  await setContent(page, CONTENT)
  await page.evaluate(() => {
    const editor = window.__larkDoc.getEditor()
    const pos = []
    editor.state.doc.descendants((node, at) => { if (node.type.name === 'heading' && node.attrs.level === 1) pos.push(at) })
    editor.commands.setLarkDocHeadingNumber(pos[1], { numbering: true, numberingStart: 7 })
  })
  await page.waitForTimeout(400)
  const restarted = await readNumbers(page)
  record('[重开] 指定值只影响该块本身', JSON.stringify(restarted.labels) === JSON.stringify(['1.', '1.1', '1.2', '7.']), restarted.labels.join(' '))
  await clickNumber(page, 3)
  await clickMenuItem(page, 'continue')
  const continued = await readNumbers(page)
  record('[继续] 回到跟随上文的连续编号', JSON.stringify(continued.labels) === JSON.stringify(['1.', '1.1', '1.2', '2.']), continued.labels.join(' '))
  await clickNumber(page, 0)
  await clickMenuItem(page, 'restart')
  const restartFirst = await readNumbers(page)
  record('[重开] 「重新开始编号」让该层从 1 重开', JSON.stringify(restartFirst.labels) === JSON.stringify(['1.', '1.1', '1.2', '2.']), restartFirst.labels.join(' '))

  // 5. 编号每帧现算：删掉中间带编号的标题后自动接续，不留空号
  await setContent(page, CONTENT)
  const afterDelete = await page.evaluate(async () => {
    const editor = window.__larkDoc.getEditor()
    const positions = []
    editor.state.doc.descendants((node, at) => { if (node.type.name === 'heading') positions.push(at) })
    const node = editor.state.doc.nodeAt(positions[2])
    editor.view.dispatch(editor.state.tr.delete(positions[2], positions[2] + node.nodeSize))
    await new Promise((resolve) => setTimeout(resolve, 400))
    return { labels: Array.from(document.querySelectorAll('.lark-doc-heading-number')).map((el) => el.textContent) }
  })
  record('[自动更新] 删掉「第二节」后不留空号', JSON.stringify(afterDelete.labels) === JSON.stringify(['1.', '1.1', '2.']), afterDelete.labels.join(' '))

  // 6. 块菜单「有序列表」作用在标题上 = 开启编号
  const blockMenu = await page.evaluate(async () => {
    const editor = window.__larkDoc.getEditor()
    editor.commands.setContent('<h2>块菜单标题</h2><p>块菜单正文</p>')
    await new Promise((resolve) => setTimeout(resolve, 400))
    const vm = window.__larkDoc.getWorkspace().$refs.document
    editor.commands.setTextSelection(1)
    vm.handleRange = { from: 0, to: editor.state.doc.firstChild.nodeSize }
    vm.blockTypeAction('orderedList')
    await new Promise((resolve) => setTimeout(resolve, 400))
    const headingNumbered = editor.state.doc.firstChild.attrs.numbering === true
    const activeOnHeading = vm.blockTypeActive('orderedList')
    const labelAfter = document.querySelector('.lark-doc-heading-number')?.textContent || ''

    let paragraphPos = -1
    editor.state.doc.descendants((node, at) => { if (node.type.name === 'paragraph') paragraphPos = at })
    editor.commands.setTextSelection(paragraphPos + 1)
    vm.handleRange = { from: paragraphPos, to: paragraphPos + editor.state.doc.nodeAt(paragraphPos).nodeSize }
    vm.blockTypeAction('orderedList')
    await new Promise((resolve) => setTimeout(resolve, 400))
    const types = []
    editor.state.doc.descendants((node) => { if (node.isBlock && node.type.name !== 'doc') types.push(node.type.name) })
    return { headingNumbered, activeOnHeading, labelAfter, types, headingStillNumbered: editor.state.doc.firstChild.attrs.numbering === true }
  })
  record('[块菜单] 作用在标题上开启标题编号', blockMenu.headingNumbered === true && blockMenu.labelAfter === '1.', `numbering=${blockMenu.headingNumbered} label=${blockMenu.labelAfter}`)
  record('[块菜单] 标题编号时菜单项显示激活', blockMenu.activeOnHeading === true)
  record('[块菜单] 作用在正文上仍然真转有序列表', blockMenu.types.includes('orderedList') === true, blockMenu.types.join(','))
  record('[块菜单] 正文转列表不影响标题编号', blockMenu.headingStillNumbered === true)

  // 7. 快捷键 Cmd/Ctrl+Shift+7（ProseMirror 的 Mod 在 mac 上解析成 Meta）
  const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
  const shortcut = await page.evaluate(async () => {
    const editor = window.__larkDoc.getEditor()
    editor.commands.setContent('<h2>快捷键标题</h2><p>普通段落</p>')
    await new Promise((resolve) => setTimeout(resolve, 400))
    editor.commands.setTextSelection(1)
    editor.view.focus()
    return { before: editor.state.doc.firstChild.attrs.numbering === true }
  })
  await page.keyboard.press(`${MOD}+Shift+7`)
  await page.waitForTimeout(400)
  const shortcutOn = await page.evaluate(() => ({
    numbering: window.__larkDoc.getEditor().state.doc.firstChild.attrs.numbering === true,
    label: document.querySelector('.lark-doc-heading-number')?.textContent || '',
  }))
  await page.keyboard.press(`${MOD}+Shift+7`)
  await page.waitForTimeout(400)
  const shortcutOff = await page.evaluate(() => ({
    numbering: window.__larkDoc.getEditor().state.doc.firstChild.attrs.numbering === true,
    widget: document.querySelectorAll('.lark-doc-heading-number').length,
  }))
  record('[快捷键] Cmd/Ctrl+Shift+7 开启标题编号', shortcut.before === false && shortcutOn.numbering === true && shortcutOn.label === '1.',
    `numbering=${shortcutOn.numbering} label=${shortcutOn.label}`)
  record('[快捷键] 再按一次关闭编号并清掉编号按钮', shortcutOff.numbering === false && shortcutOff.widget === 0,
    `numbering=${shortcutOff.numbering} widget=${shortcutOff.widget}`)

  // 8. 未开启编号的标题不渲染编号按钮；关闭后 numberingStart 一并清掉
  const closed = await page.evaluate(async () => {
    const editor = window.__larkDoc.getEditor()
    editor.commands.setContent('<h1 data-numbering="true" data-numbering-start="5">有编号</h1><h2>无编号</h2>')
    await new Promise((resolve) => setTimeout(resolve, 400))
    const before = { widgets: document.querySelectorAll('.lark-doc-heading-number').length, start: editor.state.doc.firstChild.attrs.numberingStart }
    editor.commands.toggleLarkDocHeadingNumber(0)
    await new Promise((resolve) => setTimeout(resolve, 400))
    return { before, after: { numbering: editor.state.doc.firstChild.attrs.numbering, start: editor.state.doc.firstChild.attrs.numberingStart, widgets: document.querySelectorAll('.lark-doc-heading-number').length } }
  })
  record('[默认态] 没开编号的标题不渲染编号按钮', closed.before.widgets === 1, `按钮=${closed.before.widgets}`)
  record('[默认态] 关闭编号时一并清掉起点', closed.after.numbering === false && closed.after.start === null && closed.after.widgets === 0,
    `numbering=${closed.after.numbering} start=${closed.after.start} 按钮=${closed.after.widgets}`)

  // 9. HTML 往返：导出再导入，编号与起点都还原
  const roundTrip = await page.evaluate(async () => {
    const editor = window.__larkDoc.getEditor()
    editor.commands.setContent('<h1 data-numbering="true">一</h1><h2 data-numbering="true" data-numbering-start="4">二</h2><h1 data-numbering="true">三</h1>')
    await new Promise((resolve) => setTimeout(resolve, 400))
    const exported = editor.getHTML()
    const labelsA = Array.from(document.querySelectorAll('.lark-doc-heading-number')).map((el) => el.textContent)
    editor.commands.setContent(exported)
    await new Promise((resolve) => setTimeout(resolve, 400))
    const labelsB = Array.from(document.querySelectorAll('.lark-doc-heading-number')).map((el) => el.textContent)
    return { exported, labelsA, labelsB }
  })
  record('[往返] 三级编号与指定起点都写进 HTML', /data-numbering="true"/.test(roundTrip.exported) && /data-numbering-start="4"/.test(roundTrip.exported))
  record('[往返] 重新导入后编号完全一致', JSON.stringify(roundTrip.labelsA) === JSON.stringify(['1.', '1.4', '2.']) && JSON.stringify(roundTrip.labelsB) === JSON.stringify(roundTrip.labelsA),
    `${roundTrip.labelsA.join(' ')} → ${roundTrip.labelsB.join(' ')}`)

  // 10. 折叠箭头与编号同一行内位置时，顺序是飞书的「▾ 2. 标题」
  const withFold = await page.evaluate(async () => {
    const editor = window.__larkDoc.getEditor()
    window.localStorage.removeItem('lark-doc:folds:local')
    editor.commands.setContent('<h1 data-numbering="true">带子块</h1><p data-indent="1">子块正文</p>')
    await new Promise((resolve) => setTimeout(resolve, 500))
    const heading = document.querySelector('.ProseMirror h1')
    const toggle = heading?.querySelector('.lark-doc-heading-fold-toggle')
    const number = heading?.querySelector('.lark-doc-heading-number')
    if (!toggle || !number) return null
    const t = toggle.getBoundingClientRect()
    const n = number.getBoundingClientRect()
    return {
      hasBoth: true,
      order: t.left < n.left,
      gap: Math.round(n.left - t.right),
      sameRow: Math.abs((t.top + t.height / 2) - (n.top + n.height / 2)) <= 3,
    }
  })
  record('[组合] 折叠箭头与编号都在标题行内', !!withFold && withFold.hasBoth === true)
  record('[组合] 箭头在编号左侧（▾ 2. 标题）', !!withFold && withFold.order === true && withFold.sameRow === true,
    withFold ? `间距=${withFold.gap}px 同一行=${withFold.sameRow}` : '未测得')

  // 11. 只读模式不弹菜单
  const readonly = await page.evaluate(async () => {
    const editor = window.__larkDoc.getEditor()
    editor.commands.setContent('<h1 data-numbering="true">只读标题</h1>')
    await new Promise((resolve) => setTimeout(resolve, 400))
    editor.setEditable(false)
    await new Promise((resolve) => setTimeout(resolve, 200))
    const button = document.querySelector('.lark-doc-heading-number')
    const rect = button.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })
  await page.mouse.click(readonly.x, readonly.y)
  await page.waitForTimeout(300)
  const readonlyMenu = await menuState(page)
  record('[只读] 只读态点编号不弹菜单', readonlyMenu.open === false)
  await page.evaluate(() => window.__larkDoc.getEditor().setEditable(true))
  await page.waitForTimeout(200)

  record('无脚本错误', errors.length === 0, errors.slice(0, 2).join(' | '))

  await browser.close()
  const failed = results.filter((item) => !item.ok)
  console.log(`\n${results.length - failed.length}/${results.length} 项通过`)
  if (failed.length) process.exitCode = 1
}

main().catch((error) => { console.error(error); process.exit(1) })
