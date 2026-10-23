'use strict'
/**
 * 浏览器级验证：列表序号可点 + 编号菜单（与标题编号共用）+ 弹窗无滚动条。
 *
 * 对齐真飞书的语义：
 * - 有序列表的序号是**可点**的块级 UI（不是纯展示文字），点它弹出编号菜单；
 * - 菜单三项：继续编号 / 重新开始编号 / 设置编号的值，图标是「1.」+ 动作符号；
 * - 「重新开始编号」让该项起算 1，后面的兄弟接着数（不拆成两个列表）；
 * - 「设置编号的值」就地输入，提交后该项从该值起算；
 * - 所有浮层都不画滚动条（`scrollbar-width: none` + `::-webkit-scrollbar` 隐藏）。
 *
 * 依赖：demo dev server（Vue 路由暴露 window.__larkDoc）。用法：
 *   node scripts/verify-browser-list-number-menu.js [url]
 */
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright-core')

const BASE = process.argv[2] || 'http://localhost:8080/lark-doc'
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

const CONTENT = `
<ol>
  <li><p>第一项</p></li>
  <li><p>第二项</p></li>
  <li><p>第三项</p></li>
</ol>
<ul>
  <li><p>圆点项</p></li>
</ul>
`.trim()

const setContent = async (page, html) => {
  await page.evaluate((value) => {
    window.__larkDoc.getEditor().commands.setContent(value)
    window.localStorage.removeItem('lark-doc:folds:local')
  }, html)
  await page.waitForTimeout(600)
}

const readMarkers = (page) => page.evaluate(() => {
  const editor = window.__larkDoc.getEditor()
  const numbers = Array.from(document.querySelectorAll('.lark-doc-list-number'))
  const bullets = Array.from(document.querySelectorAll('.lark-doc-list-bullet'))
  const starts = []
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'listItem') starts.push(node.attrs.numberStart ?? null)
  })
  return {
    labels: numbers.map((el) => el.textContent),
    tags: numbers.map((el) => el.tagName),
    ariaHidden: numbers.map((el) => el.getAttribute('aria-hidden')),
    contentEditable: numbers.map((el) => el.getAttribute('contenteditable')),
    heights: numbers.map((el) => Math.round(el.getBoundingClientRect().height)),
    bulletTags: bullets.map((el) => el.tagName),
    bulletAria: bullets.map((el) => el.getAttribute('aria-hidden')),
    starts,
    // 序号是块级 UI：不在正文文本里
    text: editor.getText(),
    html: editor.getHTML(),
    json: JSON.stringify(editor.getJSON()),
  }
})

const clickMarker = async (page, index) => {
  const box = await page.evaluate((target) => {
    const el = document.querySelectorAll('.lark-doc-list-number')[target]
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }, index)
  if (!box) throw new Error(`没有第 ${index} 个列表序号`)
  await page.mouse.click(box.x, box.y)
  await page.waitForTimeout(320)
}

const menuState = (page) => page.evaluate(() => {
  const menu = document.querySelector('.lark-doc-heading-number-menu')
  if (!menu) return { open: false }
  const items = Array.from(menu.querySelectorAll('.lark-doc-heading-number-item'))
  const rect = menu.getBoundingClientRect()
  const style = getComputedStyle(menu)
  return {
    open: true,
    ids: items.map((el) => el.getAttribute('data-menu-id')),
    labels: items.map((el) => (el.querySelector('.lark-doc-heading-number-text')?.textContent || '').trim()),
    disabled: items.map((el) => el.disabled === true || el.getAttribute('aria-disabled') === 'true'),
    // 图标是「1.」+ 动作符号的组合（飞书同款），SVG 里应当有数字文本
    numeral: items.map((el) => (el.querySelector('.lark-doc-heading-number-icon svg text')?.textContent || '').trim()),
    hasIcons: items.every((el) => !!el.querySelector('.lark-doc-heading-number-icon svg')),
    width: Math.round(rect.width),
    scrollbarWidth: style.scrollbarWidth,
    // clientWidth 不含边框，减掉左右边框才是滚动条真正占的宽度
    scrollbarGap: Math.round(rect.width - menu.clientWidth - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth)),
    editing: menu.classList.contains('is-editing'),
    inputValue: menu.querySelector('.lark-doc-heading-number-input')?.value ?? null,
    top: Math.round(rect.top),
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

  // 1. 有序序号是 button、圆点仍是纯展示 span
  await setContent(page, CONTENT)
  const base = await readMarkers(page)
  record('[序号] 有序序号渲染成可点按钮', base.tags.every((tag) => tag === 'BUTTON'), base.tags.join(','))
  record('[序号] 序号不进正文、不可编辑', base.contentEditable.every((value) => value === 'false') && !/\d\./.test(base.text), `text=${JSON.stringify(base.text)}`)
  record('[序号] 圆点仍是纯展示（aria-hidden 的 span）', base.bulletTags.every((tag) => tag === 'SPAN') && base.bulletAria.every((value) => value === 'true'),
    `${base.bulletTags.join(',')} aria-hidden=${base.bulletAria.join(',')}`)
  // 全局 button 有 30px 最小高，序号按钮必须把它抹掉，否则行高会被撑开
  record('[序号] 按钮不带全局 30px 最小高（不撑行）', base.heights.every((height) => height > 0 && height < 30), `高度=${base.heights.join(',')}`)

  // 2. 点序号弹菜单（与标题编号同一套）
  await clickMarker(page, 1)
  const menu = await menuState(page)
  record('[菜单] 点列表序号弹出编号菜单', menu.open === true && menu.ids.length === 3, `open=${menu.open} 项=${(menu.ids || []).join(',')}`)
  record('[菜单] 项顺序与飞书一致', JSON.stringify(menu.ids) === JSON.stringify(['continue', 'restart', 'renumber']), (menu.ids || []).join(','))
  record('[菜单] 文案与飞书一致', JSON.stringify(menu.labels) === JSON.stringify(['继续编号', '重新开始编号', '设置编号的值']), (menu.labels || []).join(' | '))
  record('[菜单] 图标是「1.」+ 动作符号', menu.hasIcons === true && menu.numeral.every((text) => text === '1.'), (menu.numeral || []).join(','))
  record('[菜单] 未设起点时「继续编号」禁用', menu.disabled?.[0] === true && menu.disabled?.[1] === false && menu.disabled?.[2] === false, (menu.disabled || []).join(','))

  // 3. 重新开始编号 → 该项起算 1，兄弟接着数
  await clickMenuItem(page, 'restart')
  const restarted = await readMarkers(page)
  record('[重开] 该项从 1 起算、后续接上', JSON.stringify(restarted.labels) === JSON.stringify(['1.', '1.', '2.']), restarted.labels.join(' '))
  record('[重开] 起点落进 listItem.attrs.numberStart', JSON.stringify(restarted.starts) === JSON.stringify([null, 1, null, null]), JSON.stringify(restarted.starts))
  record('[重开] 不拆列表（仍是一个 ol）', (restarted.html.match(/<ol/g) || []).length === 1, `ol 数=${(restarted.html.match(/<ol/g) || []).length}`)

  // 4. 继续编号 → 清掉起点，回到连续编号
  await clickMarker(page, 1)
  const continueMenu = await menuState(page)
  record('[继续] 设过起点后「继续编号」可点', continueMenu.open === true && continueMenu.disabled?.[0] === false, `disabled=${continueMenu.disabled?.[0]}`)
  await clickMenuItem(page, 'continue')
  const continued = await readMarkers(page)
  record('[继续] 编号回到连续', JSON.stringify(continued.labels) === JSON.stringify(['1.', '2.', '3.']), continued.labels.join(' '))
  record('[继续] 起点被清空', JSON.stringify(continued.starts) === JSON.stringify([null, null, null, null]), JSON.stringify(continued.starts))

  // 5. 设置编号的值 → 就地输入 → 该项从该值起算
  await clickMarker(page, 1)
  await clickMenuItem(page, 'renumber')
  const editing = await menuState(page)
  record('[设置值] 就地变成数字输入框', editing.open === true && editing.editing === true && editing.inputValue !== null, `value=${editing.inputValue}`)
  record('[设置值] 预填当前序号', editing.inputValue === '2', `value=${editing.inputValue}`)
  await page.fill('.lark-doc-heading-number-input', '7')
  await page.waitForTimeout(150)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)
  const afterValue = await readMarkers(page)
  record('[设置值] 提交后该项从 7 起算', JSON.stringify(afterValue.labels) === JSON.stringify(['1.', '7.', '8.']), afterValue.labels.join(' '))
  record('[设置值] 提交后菜单关闭', (await menuState(page)).open === false)
  record('[设置值] 起点写进 JSON 且导出成 <li value>', /"numberStart":7/.test(afterValue.json) && /value="7"/.test(afterValue.html),
    afterValue.html.match(/<li[^>]*>/g)?.join(' ') || '')

  // 5.5 两个相邻列表都从 1. 开始时，「继续编号」把后面的列表接到前一个后面
  //     （每帧现算的编号默认按单个 ol 各算各的，只清起点等于什么都没做）
  await setContent(page, '<ol><li><p>你好</p></li></ol><ol><li><p>周报</p></li></ol>')
  const adjacent = await readMarkers(page)
  record('[接号] 相邻两个列表未接号时都从 1. 开始', JSON.stringify(adjacent.labels) === JSON.stringify(['1.', '1.']), adjacent.labels.join(' '))
  await clickMarker(page, 1)
  const adjacentMenu = await menuState(page)
  record('[接号] 列表首项「继续编号」可点', adjacentMenu.open === true && adjacentMenu.disabled?.[0] === false, `disabled=${adjacentMenu.disabled?.[0]}`)
  await clickMenuItem(page, 'continue')
  const joined = await readMarkers(page)
  record('[接号] 点继续后接上前一个列表（1. 2.）', JSON.stringify(joined.labels) === JSON.stringify(['1.', '2.']), joined.labels.join(' '))
  record('[接号] 接号标记落进 ol 的 data-continue-from', /data-continue-from="true"/.test(joined.html), joined.html.slice(0, 80))
  await clickMarker(page, 1)
  await clickMenuItem(page, 'restart')
  const unlinked = await readMarkers(page)
  record('[接号] 重新开始编号回到 1. 并摘掉接号标记', JSON.stringify(unlinked.labels) === JSON.stringify(['1.', '1.']) && !/data-continue-from/.test(unlinked.html),
    `${unlinked.labels.join(' ')} / ${/data-continue-from/.test(unlinked.html)}`)

  // 6. 菜单不画滚动条（滚动条宽度为 0）
  record('[滚动条] 编号菜单无可视滚动条', menu.scrollbarWidth === 'none' && menu.scrollbarGap === 0, `scrollbar-width=${menu.scrollbarWidth} 占宽=${menu.scrollbarGap}px`)

  // 7. 全部浮层的 CSS 规则都关了滚动条（覆盖命令菜单、下拉、子菜单等难以逐个打开的）
  const popoverRules = await page.evaluate(() => {
    const wanted = ['.lark-doc-dropdown', '.lark-doc-select-menu', '.lark-doc-block-menu', '.lark-doc-block-submenu', '.lark-doc-command-menu', '.lark-doc-command-submenu', '.lark-doc-template-list', '.lark-doc-bubble-align-menu', '.lark-doc-heading-number-menu', '.lark-doc-color-palette', '.lark-doc-callout-emoji-picker', '.lark-doc-dialog']
    const seen = new Set()
    for (const sheet of Array.from(document.styleSheets)) {
      let rules = []
      try { rules = Array.from(sheet.cssRules || []) } catch (_) { continue }
      for (const rule of rules) {
        const selector = rule.selectorText || ''
        if (!selector || /::-webkit-scrollbar/.test(selector)) continue
        wanted.forEach((name) => { if (selector.includes(name) && rule.style && rule.style.scrollbarWidth === 'none') seen.add(name) })
      }
    }
    return { covered: Array.from(seen).sort(), wanted: wanted.slice().sort() }
  })
  record('[滚动条] 所有浮层都声明了 scrollbar-width: none', popoverRules.wanted.every((name) => popoverRules.covered.includes(name)),
    `${popoverRules.covered.length}/${popoverRules.wanted.length}：${popoverRules.wanted.filter((name) => !popoverRules.covered.includes(name)).join(',') || '全覆盖'}`)

  // 8. 命令菜单（slash）实测：展开后也没有滚动条占宽
  const commandMenu = await page.evaluate(async () => {
    const editor = window.__larkDoc.getEditor()
    editor.commands.setContent('<p></p>')
    await new Promise((resolve) => setTimeout(resolve, 300))
    editor.commands.setTextSelection(1)
    editor.view.focus()
    return true
  })
  if (commandMenu) {
    await page.keyboard.type('/')
    await page.waitForTimeout(500)
    const measured = await page.evaluate(() => {
      const el = document.querySelector('.lark-doc-command-menu')
      if (!el) return null
      const rect = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      return { scrollbarWidth: style.scrollbarWidth, gap: Math.round(rect.width - el.clientWidth - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth)), scrollable: el.scrollHeight > el.clientHeight }
    })
    record('[滚动条] 命令菜单无滚动条（仍可滚动）', !!measured && measured.scrollbarWidth === 'none' && measured.gap === 0,
      measured ? `scrollbar-width=${measured.scrollbarWidth} 占宽=${measured.gap}px 可滚动=${measured.scrollable}` : '命令菜单未出现')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
  }

  // 9. 只读态点序号不弹菜单
  const readonly = await page.evaluate(async () => {
    const editor = window.__larkDoc.getEditor()
    editor.commands.setContent('<ol><li><p>只读项</p></li></ol>')
    await new Promise((resolve) => setTimeout(resolve, 400))
    editor.setEditable(false)
    await new Promise((resolve) => setTimeout(resolve, 200))
    const el = document.querySelector('.lark-doc-list-number')
    const rect = el.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })
  await page.mouse.click(readonly.x, readonly.y)
  await page.waitForTimeout(300)
  record('[只读] 只读态点序号不弹菜单', (await menuState(page)).open === false)
  await page.evaluate(() => window.__larkDoc.getEditor().setEditable(true))
  await page.waitForTimeout(200)

  record('无脚本错误', errors.length === 0, errors.slice(0, 2).join(' | '))

  await browser.close()
  const failed = results.filter((item) => !item.ok)
  console.log(`\n${results.length - failed.length}/${results.length} 项通过`)
  if (failed.length) process.exitCode = 1
}

main().catch((error) => { console.error(error); process.exit(1) })
