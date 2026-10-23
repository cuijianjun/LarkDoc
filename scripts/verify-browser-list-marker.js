'use strict'
/**
 * 浏览器级验证：有序 / 无序列表的编号与标记。
 *
 * 覆盖真飞书核对过的行为：
 * - 序号按层级换样式（1. / a. / i.，再深回到 1.），`<ol start>` 从指定值起算；
 * - 序号是装饰层里的蓝色文本（#1456f0），contentEditable=false，不进正文、getText 拿不到；
 * - 标记在正文流里，所以「句柄 → 折叠箭头 → 序号 → 正文」四者互不重叠；
 * - 圆点列表同样走装饰层（灰色），不再依赖浏览器 ::marker；
 * - 行首 `1.` + 空格 / 中文输入法的 `1、` `1。` `1）` + 空格 → 编号块；
 *   标题行则保留标题、改成「标题 + 蓝色编号」（文字不丢）。
 *
 * 依赖：demo dev server（Vue 路由暴露 window.__larkDoc）。用法：
 *   node scripts/verify-browser-list-marker.js [url]
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
  results.push({ ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const CONTENT = `
<ol>
  <li><p>第一项</p></li>
  <li><p>第二项</p>
    <ol>
      <li><p>嵌套字母项</p></li>
      <li><p>嵌套字母项二</p>
        <ol><li><p>深层罗马项</p></li></ol>
      </li>
    </ol>
  </li>
</ol>
<ul><li><p>圆点一</p><ul><li><p>嵌套圆点</p></li></ul></li></ul>
<ol start="5"><li><p>从五开始</p></li><li><p>第六项</p></li></ol>
`.trim()

const setContent = async (page, html) => {
  await page.evaluate((value) => { window.__larkDoc.getEditor().commands.setContent(value) }, html)
  await page.waitForTimeout(600)
}

const readMarkers = (page) => page.evaluate(() => {
  const editor = window.__larkDoc.getEditor()
  const numbers = Array.from(document.querySelectorAll('.lark-doc-list-number'))
  const bullets = Array.from(document.querySelectorAll('.lark-doc-list-bullet'))
  const firstList = document.querySelector('.ProseMirror ol')
  const firstBullet = document.querySelector('.ProseMirror ul:not([data-type="taskList"])')
  const body = document.querySelector('.ProseMirror p')
  return {
    labels: numbers.map((el) => el.textContent),
    depths: numbers.map((el) => el.getAttribute('data-depth')),
    colors: numbers.map((el) => getComputedStyle(el).color),
    fontSizes: numbers.map((el) => Math.round(parseFloat(getComputedStyle(el).fontSize))),
    bodyFontSize: body ? Math.round(parseFloat(getComputedStyle(body).fontSize)) : null,
    contentEditable: numbers.map((el) => el.getAttribute('contenteditable')),
    bulletLabels: bullets.map((el) => el.textContent),
    bulletColor: bullets[0] ? getComputedStyle(bullets[0]).color : null,
    listStyle: firstList ? getComputedStyle(firstList).listStyleType : null,
    listPadding: firstList ? getComputedStyle(firstList).paddingLeft : null,
    bulletListStyle: firstBullet ? getComputedStyle(firstBullet).listStyleType : null,
    text: editor.getText(),
    html: editor.getHTML(),
  }
})

// 序号必须在正文文字之前、同一行；用首字符的实测矩形比对，不依赖包装层。
const markerBeforeText = (page) => page.evaluate(() => {
  const read = (marker) => {
    const host = marker.closest('li')
    if (!host) return false
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node && (!node.textContent.trim() || marker.contains(node))) node = walker.nextNode()
    if (!node) return false
    const text = node.textContent
    const start = text.search(/\S/)
    const range = document.createRange()
    range.setStart(node, start)
    range.setEnd(node, start + 1)
    const textRect = range.getBoundingClientRect()
    const box = marker.getBoundingClientRect()
    const sameRow = box.bottom > textRect.top + 2 && box.top < textRect.bottom - 2
    return sameRow && box.right <= textRect.left + 4
  }
  return Array.from(document.querySelectorAll('.lark-doc-list-number, .lark-doc-list-bullet')).map(read)
})

const hoverItem = async (page, selector, index) => {
  const point = await page.evaluate(({ selector, index }) => {
    const el = document.querySelectorAll(selector)[index]
    if (!el) return null
    el.scrollIntoView({ block: 'center' })
    const rect = el.getBoundingClientRect()
    // 有子块的 li 矩形会覆盖整棵子树，必须贴首行取点，否则命中的是后代块。
    return { x: rect.left + 24, y: rect.top + Math.min(12, rect.height / 2) }
  }, { selector, index })
  if (!point) throw new Error(`没有第 ${index} 个 ${selector}`)
  await page.mouse.move(point.x, point.y)
  await page.waitForTimeout(500)
}

const readGutter = (page, selector, index) => page.evaluate(({ selector, index }) => {
  const round = (value) => Math.round(value * 10) / 10
  const box = (el) => { if (!el) return null; const rect = el.getBoundingClientRect(); return { left: round(rect.left), right: round(rect.right), top: round(rect.top), bottom: round(rect.bottom) } }
  const item = document.querySelectorAll(selector)[index]
  const handle = document.querySelector('.lark-doc-block-handle-main')
  return {
    item: box(item),
    handle: box(handle),
    glyph: handle ? (handle.querySelector('.lark-doc-block-handle-type')?.textContent || '').trim() : null,
    arrow: box(item?.querySelector('.lark-doc-heading-fold-toggle')),
    marker: box(item?.querySelector('.lark-doc-list-number, .lark-doc-list-bullet')),
  }
}, { selector, index })

const typeAtStart = async (page, html, chars) => {
  await setContent(page, html)
  await page.evaluate(() => {
    const editor = window.__larkDoc.getEditor()
    editor.commands.setTextSelection(1)
    editor.view.focus()
  })
  await page.waitForTimeout(200)
  for (const char of chars) {
    await page.keyboard.type(char)
    await page.waitForTimeout(120)
  }
  await page.waitForTimeout(420)
  return page.evaluate(() => {
    const editor = window.__larkDoc.getEditor()
    const first = editor.state.doc.firstChild
    return {
      type: first.type.name,
      start: first.attrs.start ?? null,
      numbering: first.attrs.numbering ?? null,
      numberingStart: first.attrs.numberingStart ?? null,
      text: first.textContent,
      marker: document.querySelector('.lark-doc-list-number')?.textContent || '',
      html: editor.getHTML(),
    }
  })
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

  // 1. 格式：1. / a. / i. / 1.，start 生效
  await setContent(page, CONTENT)
  const markers = await readMarkers(page)
  record('[列表] 层级格式 1. / a. / i.', JSON.stringify(markers.labels) === JSON.stringify(['1.', '2.', 'a.', 'b.', 'i.', '5.', '6.']), markers.labels.join(' '))
  record('[列表] 深度写进 data-depth', JSON.stringify(markers.depths) === JSON.stringify(['1', '1', '2', '2', '3', '1', '1']), markers.depths.join(','))
  record('[列表] ol start=5 从 5 起算', markers.labels.slice(-2).join(' ') === '5. 6.', markers.labels.slice(-2).join(' '))
  record('[列表] 关掉浏览器原生 marker', markers.listStyle === 'none' && markers.listPadding === '24px' && markers.bulletListStyle === 'none',
    `ol=${markers.listStyle}/${markers.listPadding} ul=${markers.bulletListStyle}`)
  record('[列表] 序号用飞书主色 #1456f0', markers.colors.every((color) => color === LARK_DOC_PRIMARY), markers.colors[0])
  record('[列表] 序号字号跟随正文', markers.fontSizes.every((size) => size === markers.bodyFontSize), `${markers.fontSizes[0]} / ${markers.bodyFontSize}`)
  record('[列表] 序号是块级 UI（contentEditable=false）', markers.contentEditable.every((value) => value === 'false'), markers.contentEditable.join(','))
  record('[列表] 圆点是灰色而不是蓝色', markers.bulletLabels.every((label) => label === '•') && markers.bulletColor !== LARK_DOC_PRIMARY, `${markers.bulletLabels[0]} ${markers.bulletColor}`)
  record('[列表] 序号不进正文文本', !/\d+\.\s/.test(markers.text) && markers.text.includes('第一项'), JSON.stringify(markers.text))
  record('[HTML] 序号不写进 HTML', !/>\s*1\.\s*</.test(markers.html) && /<ol/.test(markers.html), markers.html.slice(0, 50))
  const beforeText = await markerBeforeText(page)
  record('[列表] 标记渲染在正文之前', beforeText.every(Boolean), beforeText.join(','))

  // 2. 句柄 / 箭头 / 序号 三者不重叠
  await hoverItem(page, '.ProseMirror ol > li', 1)
  const nested = await readGutter(page, '.ProseMirror ol > li', 1)
  record('[间距] 句柄落在折叠箭头左侧', nested.handle && nested.arrow && nested.handle.right <= nested.arrow.left - 4,
    `句柄右=${nested.handle?.right} 箭头左=${nested.arrow?.left}`)
  record('[间距] 箭头在序号左侧', nested.arrow && nested.marker && nested.arrow.right <= nested.marker.left,
    `箭头右=${nested.arrow?.right} 序号左=${nested.marker?.left}`)
  record('[间距] 句柄不盖住序号', nested.handle && nested.marker && nested.handle.right <= nested.marker.left - 8,
    `句柄右=${nested.handle?.right} 序号左=${nested.marker?.left}`)
  record('[句柄] 列表项句柄显示列表图标', nested.glyph === '1≡', nested.glyph)

  await hoverItem(page, '.ProseMirror ul:not([data-type="taskList"]) > li', 0)
  const bullet = await readGutter(page, '.ProseMirror ul:not([data-type="taskList"]) > li', 0)
  record('[间距] 圆点列表：箭头在圆点左侧', bullet.arrow && bullet.marker && bullet.arrow.right <= bullet.marker.left,
    `箭头右=${bullet.arrow?.right} 圆点左=${bullet.marker?.left}`)
  record('[间距] 圆点列表：句柄不盖住圆点', bullet.handle && bullet.marker && bullet.handle.right <= bullet.marker.left - 8,
    `句柄右=${bullet.handle?.right} 圆点左=${bullet.marker?.left}`)

  // 3. 行首输入：空行 / 有文字 / 全角标记 / 标题
  const empty = await typeAtStart(page, '<p></p>', ['1', '.', ' '])
  record('[输入] 空行「1.」+ 空格 → 有序列表', empty.type === 'orderedList' && empty.start === 1 && empty.marker === '1.', `${empty.type} start=${empty.start} marker=${empty.marker}`)

  const withText = await typeAtStart(page, '<p>回归结果</p>', ['3', '.', ' '])
  record('[输入] 行首「3.」+ 空格 → 列表从 3 起算且文字保留',
    withText.type === 'orderedList' && withText.start === 3 && withText.text === '回归结果' && withText.marker === '3.',
    `${withText.type} start=${withText.start} text=${JSON.stringify(withText.text)}`)

  const fullWidth = await typeAtStart(page, '<p>中文输入法</p>', ['2', '、', ' '])
  record('[输入] 全角「2、」+ 空格也能转列表', fullWidth.type === 'orderedList' && fullWidth.start === 2, `${fullWidth.type} start=${fullWidth.start}`)

  const heading = await typeAtStart(page, '<h1>回归结果</h1>', ['3', '.', ' '])
  record('[输入] 标题行「3.」+ 空格 → 标题 + 编号（文字不丢）',
    heading.type === 'heading' && heading.numbering === true && heading.numberingStart === 3 && heading.text === '回归结果',
    `${heading.type} numbering=${heading.numbering} start=${heading.numberingStart} text=${JSON.stringify(heading.text)}`)

  // 句尾输入不应该触发（飞书同样只在行首生效）
  await setContent(page, '<p>回归结果</p>')
  await page.evaluate(() => {
    const editor = window.__larkDoc.getEditor()
    editor.commands.setTextSelection(editor.state.doc.firstChild.nodeSize - 1)
    editor.view.focus()
  })
  await page.waitForTimeout(200)
  for (const char of ['1', '.', ' ']) { await page.keyboard.type(char); await page.waitForTimeout(100) }
  await page.waitForTimeout(300)
  const atEnd = await page.evaluate(() => {
    const first = window.__larkDoc.getEditor().state.doc.firstChild
    return { type: first.type.name, text: first.textContent }
  })
  record('[输入] 句尾「1.」+ 空格仍是普通文本', atEnd.type === 'paragraph' && atEnd.text === '回归结果1. ', `${atEnd.type} ${JSON.stringify(atEnd.text)}`)

  record('[运行] 无 JS 报错', errors.length === 0, errors.slice(0, 2).join(' | '))

  await browser.close()
  const failed = results.filter((item) => !item.ok).length
  console.log(`\n${results.length - failed}/${results.length} 项通过`)
  if (failed) process.exitCode = 1
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
