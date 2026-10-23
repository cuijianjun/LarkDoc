'use strict'
/**
 * 浏览器级验证：块背景高亮的「上下层包含」几何 + 章节折叠的状态/持久化。
 *
 * 覆盖需求文档：
 * - 13.4.3.1 块高亮：只包围文字（不铺满画布整行）、空段落至少一行高、
 *   容器按整框高亮、嵌套命中唯一（父子不同时高亮）、表格整表。
 * - 13.6.1 章节折叠：箭头切换、后代隐藏 + aria-hidden、光标迁移、
 *   折叠偏好按 document 键持久化并在刷新后恢复。
 *
 * 依赖：demo dev server（Vue 路由暴露 window.__larkDoc）。用法：
 *   node scripts/verify-browser-highlight-fold.js [url]
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

// 章节正文用 data-indent 缩进：飞书的折叠/高亮范围是缩进子树，不缩进的段落是兄弟块。
const CONTENT = `
<h2>章节 A</h2>
<p data-indent="1">章节 A 的正文段落，用于验证章节高亮。</p>
<p data-indent="1">这是一段很长很长的正文，长到一定会折成好几行，用来确认飞书的悬停高亮是整块一个矩形：既不按字形收窄，也不会在每个折行之间断开。</p>
<h2>章节 B</h2>
<p>短段落</p>
<p></p>
<blockquote><p>引用块正文</p></blockquote>
<div data-type="callout"><p>高亮块正文</p></div>
<pre><code class="language-javascript">const answer = 42</code></pre>
<ul><li><p>列表项一</p><ul><li><p>嵌套项</p></li></ul></li></ul>
<table><tbody><tr><td><p>单元格文字</p></td></tr></tbody></table>
<p>勾股公式：a<sup>2</sup> + b<sup>2</sup> = c<sup>2</sup></p>
<p></p>
`.trim()

async function readHighlight(page) {
  return page.evaluate(() => {
    const hovered = Array.from(document.querySelectorAll('.lark-doc-block-handle-hovered'))
    // 必须读渲染结果（rect + computed），不能读内联 style：
    // 内联宽高由 JS 写入，即使对应的 CSS 规则整组不命中（曾因选择器多写
    // 一层 .ProseMirror 导致 overlay 不可见）也会「测得过」，但用户看不到高亮。
    const segments = Array.from(document.querySelectorAll('.lark-doc-block-hover-segment, .lark-doc-heading-hover-segment')).map((node) => {
      const rect = node.getBoundingClientRect()
      const style = window.getComputedStyle(node)
      const painted = style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent' && style.display !== 'inline' && Number.parseFloat(style.opacity || '1') > 0
      return {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        painted,
        section: node.classList.contains('lark-doc-heading-segment') || node.classList.contains('lark-doc-heading-hover-segment'),
      }
    })
    return {
      count: hovered.length,
      targets: hovered.map((node) => ({
        tag: node.tagName,
        type: node.getAttribute('data-type'),
        className: String(node.className || ''),
        text: (node.textContent || '').slice(0, 16),
        blockWidth: Math.round(node.getBoundingClientRect().width),
      })),
      segments,
    }
  })
}

async function hoverTarget(page, box) {
  await page.mouse.move(box.x + Math.min(6, box.width / 2), box.y + box.height / 2)
  await page.waitForTimeout(240)
  const handle = page.locator('.lark-doc-block-handle-main').first()
  const handleBox = await handle.boundingBox()
  if (!handleBox) throw new Error('block handle not visible')
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
  await page.waitForTimeout(280)
  return readHighlight(page)
}

async function hoverSelector(page, selector) {
  const box = await page.locator(selector).first().boundingBox()
  if (!box) throw new Error(`missing target ${selector}`)
  return hoverTarget(page, box)
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
  await page.evaluate((html) => {
    window.__larkDoc.getEditor().commands.setContent(html)
    window.localStorage.removeItem('lark-doc:folds:local')
  }, CONTENT)
  await page.waitForTimeout(700)

  // 1. 短段落：只包围文字 + 6px 留白，不铺满整行
  const paragraph = await hoverSelector(page, 'p:text-is("短段落")')
  const paragraphSegment = paragraph.segments[0]
  record('[高亮] 短段落命中唯一文本块', paragraph.count === 1 && paragraph.targets[0]?.tag === 'P', `${paragraph.count} 个目标 / ${paragraph.targets[0]?.tag}`)
  // 飞书的 hovered-mask 就是块盒子本身（整列宽、整块高、6px 圆角），不按字形收窄。
  record('[高亮] 段落高亮铺满整块盒子', !!paragraphSegment && paragraphSegment.width >= paragraph.targets[0].blockWidth - 4,
    `高亮宽=${Math.round(paragraphSegment?.width || 0)} 块宽=${paragraph.targets[0]?.blockWidth}`)
  record('[高亮] 段落高亮至少一行高', !!paragraphSegment && paragraphSegment.height >= 18, `高=${Math.round(paragraphSegment?.height || 0)}`)
  // 这一条专门防「内联几何写对了、CSS 却没命中」的假绿：必须读到真实渲染宽高与背景色。
  record('[高亮] 高亮层真实可见（CSS 命中且有底色）', !!paragraphSegment && paragraphSegment.painted === true,
    paragraphSegment ? `painted=${paragraphSegment.painted} 宽=${paragraphSegment.width}` : '无高亮段')

  // 2. 空段落：只有 + 控件（没有六点句柄），几何仍按「一行高、窄条」计算
  const empty = await page.evaluate(() => {
    const editor = window.__larkDoc.getEditor()
    let pos = -1
    editor.state.doc.descendants((node, at) => { if (node.type.name === 'paragraph' && !(node.textContent || '').trim()) pos = at })
    if (pos < 0) return null
    const node = editor.state.doc.nodeAt(pos)
    editor.commands.setLarkDocHandleHover({ from: pos, to: pos + node.nodeSize })
    return { pos }
  })
  if (empty) {
    await page.waitForTimeout(120)
    const emptyHighlight = await readHighlight(page)
    const emptySegment = emptyHighlight.segments[0]
    record('[高亮] 空段落可命中且整行宽', emptyHighlight.count === 1 && !!emptySegment && emptySegment.width > 200,
      `宽=${Math.round(emptySegment?.width || 0)}`)
    record('[高亮] 空段落至少一行高', !!emptySegment && emptySegment.height >= 18, `高=${Math.round(emptySegment?.height || 0)}`)
    await page.evaluate(() => window.__larkDoc.getEditor().commands.setLarkDocHandleHover(null))
    await page.waitForTimeout(120)
  } else record('[高亮] 空段落可命中且宽度收敛', false, '未找到空段落')

  // 3. 整块容器：引用 / 高亮块只亮容器外框，内部段落不同时高亮
  const quote = await hoverSelector(page, 'blockquote p')
  record('[高亮] 引用块按整体外框命中', quote.count === 1 && quote.targets[0].tag === 'BLOCKQUOTE', quote.targets.map((item) => item.tag).join(','))
  record('[高亮] 引用块外框宽度覆盖整框', (quote.segments[0]?.width || 0) >= quote.targets[0].blockWidth - 4, `高亮宽=${Math.round(quote.segments[0]?.width || 0)} 块宽=${quote.targets[0].blockWidth}`)
  const callout = await hoverSelector(page, '[data-type="callout"] p')
  record('[高亮] 高亮块按整体外框命中', callout.count === 1 && callout.targets[0].type === 'callout', callout.targets.map((item) => item.type || item.tag).join(','))
  record('[高亮] 高亮块外框宽度覆盖整框', (callout.segments[0]?.width || 0) >= callout.targets[0].blockWidth - 4, `高亮宽=${Math.round(callout.segments[0]?.width || 0)} 块宽=${callout.targets[0].blockWidth}`)

  // 4. 代码块整体外框
  const code = await hoverSelector(page, 'pre code')
  const codeTarget = code.targets[0] || {}
  record('[高亮] 代码块按整体外框命中', code.count === 1 && (codeTarget.type === 'codeBlock' || /lark-doc-code/.test(codeTarget.className)),
    `${codeTarget.tag}.${codeTarget.className}`)
  record('[高亮] 代码块外框宽度覆盖整块', (code.segments[0]?.width || 0) >= codeTarget.blockWidth - 4, `高亮宽=${Math.round(code.segments[0]?.width || 0)} 块宽=${codeTarget.blockWidth}`)

  // 5. 列表：命中当前 item；嵌套 item 不扩大到父项
  const item = await hoverSelector(page, 'li p:text-is("列表项一")')
  record('[高亮] 列表命中当前 item', item.count === 1 && item.targets[0].tag === 'LI', `${item.count} 个目标 / ${item.targets[0]?.tag}`)
  const nested = await hoverSelector(page, 'li p:text-is("嵌套项")')
  // 列表标记（• / 1.）现在是装饰层的 span，textContent 会带上它，断言只看正文文字。
  record('[高亮] 嵌套项只命中自己（父项不同时高亮）', nested.count === 1 && nested.targets[0].text.includes('嵌套项'), `${nested.count} 个目标 / ${nested.targets[0]?.text.trim()}`)

  // 6. 表格：整表一个目标，单元格不抢句柄
  const table = await hoverSelector(page, 'td p')
  const tableTarget = table.targets[0] || {}
  record('[高亮] 表格按整表命中', table.count === 1 && (tableTarget.tag === 'TABLE' || /tableWrapper/.test(tableTarget.className)),
    `${tableTarget.tag}.${tableTarget.className}`)
  record('[高亮] 表格外框宽度覆盖整表', (table.segments[0]?.width || 0) >= tableTarget.blockWidth - 4, `高亮宽=${Math.round(table.segments[0]?.width || 0)} 块宽=${tableTarget.blockWidth}`)

  // 7. 标题：有后代的标题按章节整体高亮（多段覆盖）
  const heading = await hoverSelector(page, 'h2:text-is("章节 A")')
  // 飞书把「标题 + 缩进子树」画成一个整体矩形，逐块分段会在块间距里露出白缝。
  record('[高亮] 章节整体合成一个矩形', heading.segments.length === 1 && heading.segments.filter((item) => item.section).length === 1, `分段数=${heading.segments.length}`)
  record('[高亮] 章节高亮不叠加单块高亮', heading.segments.every((item) => item.section), heading.segments.map((item) => (item.section ? 'section' : 'block')).join(','))
  record('[高亮] 章节每个分段都真实绘制', heading.segments.filter((item) => item.section).every((item) => item.painted && item.width > 0 && item.height > 0),
    heading.segments.map((item) => `${item.section ? 'section' : 'block'}:${item.width}x${item.height}`).join(' '))

  // 7.5 块稳定 id：所有可视块都带 blockId，文档内唯一，并且落进 DOM
  const blockIds = await page.evaluate(() => {
    const editor = window.__larkDoc.getEditor()
    // 列表项也在编号范围内（飞书把折叠状态挂在 item 上），所以 types 必须同步。
    const types = new Set(['paragraph', 'heading', 'blockquote', 'callout', 'columns', 'details', 'detailsSummary', 'listItem', 'taskItem', 'bulletList', 'orderedList', 'taskList', 'codeBlock', 'image', 'horizontalRule', 'blockMath', 'table'])
    const docIds = []
    let missing = 0
    let tables = 0
    editor.state.doc.descendants((node) => {
      if (!types.has(node.type.name)) return
      if (node.type.name === 'table') tables += 1
      if (!node.attrs.blockId) missing += 1
      else docIds.push(node.attrs.blockId)
    })
    return { docIds, missing, tables, unique: new Set(docIds).size, domCount: document.querySelectorAll('.lark-doc [data-block-id]').length }
  })
  record('[块 id] 每个块都有稳定 id', blockIds.missing === 0 && blockIds.docIds.length > 0, `块数=${blockIds.docIds.length} 缺号=${blockIds.missing}`)
  record('[块 id] 文档内 id 唯一', blockIds.unique === blockIds.docIds.length, `${blockIds.unique}/${blockIds.docIds.length}`)
  // prosemirror-tables 的 TableView 自建 table 元素，不回写节点 attrs（表格 id 只在模型里），
  // 所以 DOM 里少的那一个恰好是表格，断言按这个口径精确比对。
  record('[块 id] id 渲染进 DOM', blockIds.domCount === blockIds.docIds.length - blockIds.tables,
    `DOM=${blockIds.domCount} 文档块=${blockIds.docIds.length} 表格=${blockIds.tables}`)

  // 8. 折叠：箭头切换、后代隐藏并 aria-hidden、光标迁移
  const fold = await page.evaluate(async () => {
    const editor = window.__larkDoc.getEditor()
    const headingPositions = []
    editor.state.doc.descendants((node, pos) => { if (node.type.name === 'heading' && node.textContent.trim() === '章节 A') headingPositions.push(pos) })
    const pos = headingPositions[0]
    // 光标放进即将隐藏的正文，验证折叠后焦点迁回标题
    editor.commands.setTextSelection(pos + 1 + editor.state.doc.nodeAt(pos).nodeSize)
    const dom = editor.view.nodeDOM(pos)
    const toggle = dom && dom.querySelector('.lark-doc-heading-fold-toggle')
    if (toggle) toggle.click()
    await new Promise((resolve) => setTimeout(resolve, 400))
    const hidden = Array.from(document.querySelectorAll('.lark-doc-fold-hidden'))
    const body = Array.from(document.querySelectorAll('.lark-doc p')).find((node) => (node.textContent || '').includes('章节 A 的正文段落'))
    return {
      hiddenCount: hidden.length,
      ariaHidden: hidden.length > 0 && hidden.every((node) => node.getAttribute('aria-hidden') === 'true'),
      bodyVisible: body ? body.getBoundingClientRect().height > 0 : null,
      caretInHeading: editor.state.selection.from > pos && editor.state.selection.from <= pos + editor.state.doc.nodeAt(pos).nodeSize,
      toggleCollapsed: document.querySelectorAll('.lark-doc-heading-fold-toggle[aria-expanded="false"]').length,
      foldedId: editor.state.doc.nodeAt(pos).attrs.blockId,
      stored: window.localStorage.getItem('lark-doc:folds:local'),
    }
  })
  record('[折叠] 折叠后后代块隐藏', fold.hiddenCount >= 1 && fold.bodyVisible === false, `隐藏块=${fold.hiddenCount} 正文可见=${fold.bodyVisible}`)
  record('[折叠] 隐藏块标记 aria-hidden', fold.ariaHidden === true)
  record('[折叠] 折叠后光标迁回标题', fold.caretInHeading === true)
  record('[折叠] 箭头状态为 aria-expanded=false', fold.toggleCollapsed >= 1)
  let storedIds = []
  try { storedIds = JSON.parse(fold.stored || '[]') } catch (_) { storedIds = [] }
  record('[折叠] 折叠偏好按 blockId 写入本地', storedIds.length === 1 && storedIds[0] === fold.foldedId, `存的 id=${String(storedIds[0] || '').slice(0, 16)} 标题 id=${String(fold.foldedId || '').slice(0, 16)}`)

  // 9. 刷新后按稳定键恢复
  await page.evaluate(() => window.__larkDoc.save())
  await page.waitForTimeout(500)
  await page.reload({ waitUntil: 'networkidle', timeout: 90000 })
  await page.waitForFunction(() => window.__larkDoc && window.__larkDoc.getEditor && window.__larkDoc.getEditor(), { timeout: 60000 })
  await page.waitForTimeout(900)
  const restored = await page.evaluate(() => {
    const editor = window.__larkDoc.getEditor()
    let hasBody = false
    let headingId = null
    editor.state.doc.descendants((node) => {
      if (node.isTextblock && (node.textContent || '').includes('章节 A 的正文段落')) hasBody = true
      if (node.type.name === 'heading' && node.textContent.trim() === '章节 A') headingId = node.attrs.blockId
    })
    return {
      hidden: document.querySelectorAll('.lark-doc-fold-hidden').length,
      hasBody,
      headingId,
      foldedHeadings: document.querySelectorAll('.lark-doc-heading-folded').length,
      domIds: document.querySelectorAll('.lark-doc [data-block-id]').length,
    }
  })
  record('[折叠] 刷新后恢复折叠位', restored.hidden >= 1 && restored.foldedHeadings >= 1, `隐藏块=${restored.hidden}`)
  record('[折叠] 折叠状态不修改内容（正文仍在文档模型中）', restored.hasBody === true)
  record('[块 id] 刷新后 id 保持稳定', restored.headingId === fold.foldedId && restored.domIds > 0, `${String(restored.headingId || '').slice(0, 16)} / DOM=${restored.domIds}`)

  // 10. 同名标题：折叠状态按 blockId 各自独立，删掉靠前那个不会串给后面那个
  //     （旧版「层级+文本+同名序号」派生键会在这里整体前移、把折叠错挂到第二个同名标题）
  const sameName = await page.evaluate(async () => {
    const editor = window.__larkDoc.getEditor()
    localStorage.removeItem('lark-doc:folds:local')
    editor.commands.setContent('<h2>同名</h2><p data-indent="1">第一段</p><h2>同名</h2><p data-indent="1">第二段</p>')
    await new Promise((resolve) => setTimeout(resolve, 500))
    const headings = []
    editor.state.doc.descendants((node, pos) => { if (node.type.name === 'heading') headings.push(pos) })
    const ids = headings.map((pos) => editor.state.doc.nodeAt(pos).attrs.blockId)
    editor.view.nodeDOM(headings[0]).querySelector('.lark-doc-heading-fold-toggle').click()
    await new Promise((resolve) => setTimeout(resolve, 350))
    const foldedFirst = { hidden: document.querySelectorAll('.lark-doc-fold-hidden').length, stored: localStorage.getItem('lark-doc:folds:local') }
    // 删掉第一个同名章节（标题 + 正文）
    editor.view.dispatch(editor.state.tr.delete(headings[0], headings[1]))
    await new Promise((resolve) => setTimeout(resolve, 350))
    const afterDelete = {
      headingId: editor.state.doc.nodeAt(0).attrs.blockId,
      foldedHeadings: document.querySelectorAll('.lark-doc-heading-folded').length,
      hidden: document.querySelectorAll('.lark-doc-fold-hidden').length,
      stored: localStorage.getItem('lark-doc:folds:local'),
    }
    return { ids, foldedFirst, afterDelete }
  })
  record('[同名标题] 两个同名标题的 id 不同', sameName.ids.length === 2 && sameName.ids[0] !== sameName.ids[1], `${String(sameName.ids[0]).slice(0, 12)} / ${String(sameName.ids[1]).slice(0, 12)}`)
  record('[同名标题] 折叠第一个不影响第二个', sameName.foldedFirst.hidden === 1 && JSON.parse(sameName.foldedFirst.stored || '[]')[0] === sameName.ids[0],
    `隐藏=${sameName.foldedFirst.hidden} 存=${String(sameName.foldedFirst.stored).slice(0, 24)}`)
  record('[同名标题] 删掉靠前的同名标题后折叠不串位', sameName.afterDelete.headingId === sameName.ids[1] && sameName.afterDelete.foldedHeadings === 0 && sameName.afterDelete.hidden === 0,
    `剩余 id=${String(sameName.afterDelete.headingId).slice(0, 12)} 折叠标记=${sameName.afterDelete.foldedHeadings} 隐藏=${sameName.afterDelete.hidden}`)
  record('[同名标题] 删块后旧 id 不残留', JSON.parse(sameName.afterDelete.stored || '[]').length === 0, `存=${String(sameName.afterDelete.stored)}`)


  // 11. 飞书细节对齐（用户逐条反馈的 6 个问题）
  // 前面的用例换过正文，这里先把基准内容灌回来。
  await page.evaluate((html) => {
    window.localStorage.removeItem('lark-doc:folds:local')
    window.__larkDoc.getEditor().commands.setContent(html)
  }, CONTENT)
  await page.waitForTimeout(600)
  // 11.1 多行段落的高亮是一个整块矩形（不分行、不按字形收窄）
  const multiLine = await hoverSelector(page, 'p:has-text("长到一定会折成好几行")')
  const multiSeg = multiLine.segments[0]
  const multiBox = await page.evaluate(() => {
    const node = Array.from(document.querySelectorAll('.lark-doc p')).find((el) => (el.textContent || '').includes('长到一定会折成好几行'))
    const rect = node.getBoundingClientRect()
    return { height: Math.round(rect.height), width: Math.round(rect.width), lines: node.getClientRects().length }
  })
  record('[①整体高亮] 多行段落只画一个矩形', multiLine.segments.length === 1, `分段=${multiLine.segments.length}`)
  record('[①整体高亮] 矩形高度等于整块高度（含换行）', !!multiSeg && Math.abs(multiSeg.height - multiBox.height) <= 2, `高亮=${Math.round(multiSeg?.height || 0)} 块高=${multiBox.height}`)

  // 11.2 代码块可以整块缩进，并且上限由「前一个块」决定（飞书的缩进 = 成为上一个块的子块）
  //      这里给代码块前置一个 2 级缩进的段落 → 上限 3 级。
  const codeIndent = await page.evaluate(async () => {
    const editor = window.__larkDoc.getEditor()
    editor.commands.setContent('<p data-indent="2">缩进基准</p><pre><code>box</code></pre>')
    await new Promise((resolve) => setTimeout(resolve, 400))
    let pos = -1
    editor.state.doc.descendants((node, at) => { if (node.type.name === 'codeBlock') pos = at })
    if (pos < 0) return null
    editor.commands.setTextSelection(pos + 2)
    editor.view.focus()
    return { pos }
  })
  if (codeIndent) {
    for (let i = 0; i < 2; i += 1) { await page.keyboard.press('Meta+]'); await page.waitForTimeout(120) }
    const indentState = await page.evaluate(() => {
      const editor = window.__larkDoc.getEditor()
      let node = null
      editor.state.doc.descendants((child) => { if (child.type.name === 'codeBlock') node = child })
      const dom = document.querySelector('.lark-doc-code')
      return { indent: node?.attrs?.indent, margin: dom ? Math.round(parseFloat(getComputedStyle(dom).marginLeft)) : null }
    })
    record('[②代码块缩进] 代码块能增加缩进', indentState.indent === 2, `indent=${indentState.indent}`)
    record('[②代码块缩进] 缩进是整框位移 25px/级', indentState.margin === 50, `marginLeft=${indentState.margin}`)
    for (let i = 0; i < 6; i += 1) { await page.keyboard.press('Meta+]'); await page.waitForTimeout(80) }
    const capped = await page.evaluate(() => {
      let indent = null
      window.__larkDoc.getEditor().state.doc.descendants((child) => { if (child.type.name === 'codeBlock') indent = child.attrs.indent })
      return indent
    })
    record('[②代码块缩进] 停在前一个块 + 1 级（不是硬上限 5）', capped === 3, `indent=${capped}`)
    for (let i = 0; i < 6; i += 1) { await page.keyboard.press('Meta+['); await page.waitForTimeout(60) }
    const floored = await page.evaluate(() => {
      let indent = null
      window.__larkDoc.getEditor().state.doc.descendants((child) => { if (child.type.name === 'codeBlock') indent = child.attrs.indent })
      return indent
    })
    record('[②代码块缩进] 减少缩进可以一路回到 0', floored === 0, `indent=${floored}`)
  } else record('[②代码块缩进] 代码块能增加缩进', false, '文档里没有代码块')

  // 11.2a 文档第一个块没有任何前兄弟 → 增加缩进一级都加不了
  const firstBlock = await page.evaluate(async () => {
    const editor = window.__larkDoc.getEditor()
    editor.commands.setContent('<p>第一个块</p><p>第二个块</p>')
    await new Promise((resolve) => setTimeout(resolve, 400))
    editor.commands.setTextSelection(1)
    editor.view.focus()
    const vm = window.__larkDoc.getWorkspace().$refs.document
    const before = { level: vm.blockIndentLevel(), limit: vm.blockIndentLimit(), can: vm.canIncreaseIndent() }
    vm.changeIndent(1)
    await new Promise((resolve) => setTimeout(resolve, 250))
    const after = editor.state.doc.firstChild.attrs.indent
    editor.commands.setTextSelection(editor.state.doc.firstChild.nodeSize + 1)
    await new Promise((resolve) => setTimeout(resolve, 120))
    const second = { limit: vm.blockIndentLimit(), can: vm.canIncreaseIndent() }
    vm.changeIndent(1)
    await new Promise((resolve) => setTimeout(resolve, 250))
    return { before, after, second, secondIndent: editor.state.doc.lastChild.attrs.indent }
  })
  record('[②缩进上限] 第一个块不能缩进（上限 0 且按钮禁用）',
    firstBlock.before.limit === 0 && firstBlock.before.can === false && firstBlock.after === 0,
    `上限=${firstBlock.before.limit} 可增加=${firstBlock.before.can} 缩进后=${firstBlock.after}`)
  record('[②缩进上限] 第二个块上限是前一个块 + 1',
    firstBlock.second.limit === 1 && firstBlock.second.can === true && firstBlock.secondIndent === 1,
    `上限=${firstBlock.second.limit} 缩进后=${firstBlock.secondIndent}`)

  // 11.2a2 截图场景复现：列表项内代码块已经缩进 1 级（前兄弟是 item 首段落，0 级）
  //        → 块菜单「增加缩进」置灰（当前内容块已达最大缩进层级），「减少缩进」仍可用。
  const codeInItem = await page.evaluate(async () => {
    const editor = window.__larkDoc.getEditor()
    editor.commands.setContent('<ol><li><p>b. 4</p><pre data-indent="1"><code>1</code></pre></li></ol>')
    await new Promise((resolve) => setTimeout(resolve, 400))
    const vm = window.__larkDoc.getWorkspace().$refs.document
    // 句柄悬停在代码块上时，块目标其实是外层 listItem（item 自己没有 indent 属性），
    // 缩进目标要能落回 item 里的代码块，否则两个菜单项都会灰掉。
    let itemPos = -1
    editor.state.doc.descendants((node, at) => { if (node.type.name === 'listItem') itemPos = at })
    const nodeSize = () => editor.state.doc.nodeAt(itemPos).nodeSize
    vm.handleRange = { from: itemPos, to: itemPos + nodeSize() }
    let codePos = -1
    editor.state.doc.descendants((node, at) => { if (node.type.name === 'codeBlock') codePos = at })
    const state = { level: vm.blockAlignIndent(), limit: vm.blockAlignIndentLimit(), canIncrease: vm.blockAlignCanIncrease() }
    vm.blockAlignAction('increaseIndent')
    await new Promise((resolve) => setTimeout(resolve, 250))
    const afterIncrease = editor.state.doc.nodeAt(codePos).attrs.indent
    vm.handleRange = { from: itemPos, to: itemPos + nodeSize() }
    vm.blockAlignAction('decreaseIndent')
    await new Promise((resolve) => setTimeout(resolve, 250))
    const afterDecrease = editor.state.doc.nodeAt(codePos).attrs.indent
    return { state, afterIncrease, afterDecrease }
  })
  record('[②块菜单] 列表项内代码块只能缩到「前一个块 + 1」（截图场景）',
    codeInItem.state.level === 1 && codeInItem.state.limit === 1 && codeInItem.state.canIncrease === false,
    `当前=${codeInItem.state.level} 上限=${codeInItem.state.limit} 可增加=${codeInItem.state.canIncrease}`)
  record('[②块菜单] 已达上限时「增加缩进」是空操作', codeInItem.afterIncrease === 1, `缩进后=${codeInItem.afterIncrease}`)
  record('[②块菜单] 「减少缩进」不受前块限制，可以直接减回 0', codeInItem.afterDecrease === 0, `缩进后=${codeInItem.afterDecrease}`)

  // 11.2b 工具栏「增加缩进」也必须停在同一上限（上限由前一个块决定）：
  //       给目标块前置一个 5 级缩进段落 → 上限 5，连点 12 次也只能到 5。
  await page.evaluate(async () => {
    const editor = window.__larkDoc.getEditor()
    editor.commands.setContent('<p data-indent="5">缩进基准</p><p>工具栏缩进</p>')
    await new Promise((resolve) => setTimeout(resolve, 300))
    editor.commands.setTextSelection(editor.state.doc.firstChild.nodeSize + 1)
    editor.view.focus()
  })
  await page.waitForTimeout(300)
  const indentBtn = page.locator('.lark-doc-toolbar button[aria-label="增加缩进"], .lark-doc button[aria-label="增加缩进"]').first()
  const targetBox = () => page.evaluate(() => {
    const editor = window.__larkDoc.getEditor()
    const pos = editor.state.doc.firstChild.nodeSize
    const dom = editor.view.nodeDOM(pos)
    const rect = dom.getBoundingClientRect()
    return { indent: editor.state.doc.lastChild.attrs.indent, left: Math.round(rect.left), width: Math.round(rect.width) }
  })
  const toolbarStart = await targetBox()
  for (let i = 0; i < 12; i += 1) {
    await indentBtn.click({ force: true }).catch(() => {})
    await page.waitForTimeout(60)
  }
  const toolbarEnd = await page.evaluate(() => {
    const editor = window.__larkDoc.getEditor()
    const dom = editor.view.nodeDOM(editor.state.doc.firstChild.nodeSize)
    const rect = dom.getBoundingClientRect()
    const cs = getComputedStyle(dom)
    return { indent: editor.state.doc.lastChild.attrs.indent, left: Math.round(rect.left), width: Math.round(rect.width), margin: cs.marginLeft, padding: cs.paddingLeft }
  })
  const toolbarBtn = await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="增加缩进"]')
    return btn ? { disabled: btn.disabled, title: btn.getAttribute('title') } : null
  })
  record('[②工具栏缩进] 连点 12 次停在上限 5', toolbarEnd.indent === 5, `indent=${toolbarEnd.indent}`)
  record('[②工具栏缩进] 缩进缩的是整块盒子（margin 125px / padding 0）',
    toolbarEnd.margin === `${5 * 25}px` && toolbarEnd.padding === '0px',
    `margin=${toolbarEnd.margin} padding=${toolbarEnd.padding}`)
  record('[②工具栏缩进] 每级 25px 且宽度同步变窄',
    toolbarEnd.left === toolbarStart.left + 5 * 25 && toolbarEnd.width === toolbarStart.width - 5 * 25,
    `left=${toolbarStart.left}→${toolbarEnd.left} width=${toolbarStart.width}→${toolbarEnd.width}`)
  record('[②工具栏缩进] 到顶后按钮禁用并给出上限提示',
    !!toolbarBtn && toolbarBtn.disabled === true && /最大缩进/.test(toolbarBtn.title || ''),
    toolbarBtn ? `disabled=${toolbarBtn.disabled} title=${toolbarBtn.title}` : '未找到按钮')

  // 11.2c 外部 JSON 里的超限缩进在 setContent 后被压回上限
  const legacyIndent = await page.evaluate(async () => {
    const vm = window.__larkDoc.getWorkspace().$refs.document
    vm.setContent({ type: 'doc', content: [{ type: 'paragraph', attrs: { indent: 8 }, content: [{ type: 'text', text: 'legacy' }] }] })
    await new Promise((resolve) => setTimeout(resolve, 400))
    const editor = window.__larkDoc.getEditor()
    const dom = document.querySelector('.ProseMirror p')
    return { indent: editor.state.doc.firstChild.attrs.indent, margin: dom ? getComputedStyle(dom).marginLeft : null }
  })
  record('[②缩进归一] 老数据 indent=8 被压回 5', legacyIndent.indent === 5, `indent=${legacyIndent.indent}`)
  record('[②缩进归一] 归一后不再溢出内容列', legacyIndent.margin === '125px', `margin=${legacyIndent.margin}`)

  // 11.2d 列表下沉（Tab）也停在同一上限。下沉需要「同层前面有兄弟」，所以按层数造嵌套：
  // 第 5 层已经有兄弟可以下沉，但必须被上限拦住；第 4 层则应该能沉到第 5 层。
  const listSink = async (levels) => page.evaluate(async (depth) => {
    const paragraph = (value) => ({ type: 'paragraph', content: [{ type: 'text', text: value }] })
    let list = {
      type: 'orderedList', attrs: { start: 1 }, content: [
        { type: 'listItem', content: [paragraph(`L${depth}-a`)] },
        { type: 'listItem', content: [paragraph(`L${depth}`)] },
      ],
    }
    for (let level = depth - 1; level >= 1; level -= 1) {
      list = { type: 'orderedList', attrs: { start: 1 }, content: [{ type: 'listItem', content: [paragraph(`L${level}`), list] }] }
    }
    const editor = window.__larkDoc.getEditor()
    editor.commands.setContent({ type: 'doc', content: [list] })
    await new Promise((resolve) => setTimeout(resolve, 300))
    let pos = -1
    editor.state.doc.descendants((node, at) => { if (node.type.name === 'paragraph' && (node.textContent || '') === `L${depth}`) pos = at })
    editor.commands.setTextSelection(pos + 1)
    editor.view.focus()
    return pos
  }, levels)
  const depthAt = () => page.evaluate(() => {
    const selection = window.__larkDoc.getEditor().state.selection
    let depth = 0
    for (let level = selection.$from.depth; level > 0; level -= 1) {
      if (['listItem', 'taskItem'].includes(selection.$from.node(level).type.name)) depth += 1
    }
    return depth
  })
  await listSink(5)
  const cappedDepth = [await depthAt()]
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press('Tab')
    await page.waitForTimeout(120)
    cappedDepth.push(await depthAt())
  }
  record('[②列表缩进] 第 5 层再按 Tab 不再下沉', cappedDepth.every((depth) => depth === 5), `各次深度=${cappedDepth.join(',')}`)
  await listSink(4)
  const beforeLift = await depthAt()
  await page.keyboard.press('Tab')
  await page.waitForTimeout(200)
  const afterLift = await depthAt()
  record('[②列表缩进] 第 4 层仍可沉到第 5 层', beforeLift === 4 && afterLift === 5, `${beforeLift}→${afterLift}`)

  // 11.3 折叠范围跟着缩进走：缩进更深的普通段落属于标题，同级缩进的 H4 不属于
  const foldScope = await page.evaluate(async () => {
    const editor = window.__larkDoc.getEditor()
    editor.commands.setContent('<h2 data-indent="1">我是2</h2><p data-indent="2">你好 我是标题2</p><h4 data-indent="1">你好 我是3</h4><p data-indent="1">兄弟正文</p>')
    await new Promise((resolve) => setTimeout(resolve, 500))
    const headings = []
    editor.state.doc.descendants((node, pos) => { if (node.type.name === 'heading') headings.push({ pos, level: node.attrs.level, text: node.textContent }) })
    const toggle = editor.view.nodeDOM(headings[0].pos).querySelector('.lark-doc-heading-fold-toggle')
    if (!toggle) return { hasToggle: false, headings }
    toggle.click()
    await new Promise((resolve) => setTimeout(resolve, 400))
    const hidden = Array.from(document.querySelectorAll('.lark-doc-fold-hidden')).map((node) => (node.textContent || '').trim().slice(0, 10))
    const h4Visible = (() => {
      const node = Array.from(document.querySelectorAll('.lark-doc h4')).find((el) => (el.textContent || '').includes('你好 我是3'))
      return node ? node.getBoundingClientRect().height > 0 : null
    })()
    return { hasToggle: true, headings, hidden, h4Visible }
  })
  record('[③折叠范围] 缩进子树才可折叠（H2 有箭头）', foldScope.hasToggle === true)
  record('[③折叠范围] 只隐藏缩进更深的子块', foldScope.hidden.length === 1 && foldScope.hidden[0].includes('你好 我是标题2'), JSON.stringify(foldScope.hidden))
  record('[③折叠范围] 同级缩进的 H4 不被折叠', foldScope.h4Visible === true)

  // 11.4 折叠箭头只有一个提示（data-tooltip），没有原生 title 重影
  const foldTip = await page.evaluate(() => {
    const editor = window.__larkDoc.getEditor()
    editor.commands.setContent('<h2>提示</h2><p data-indent="1">正文</p>')
    const toggle = document.querySelector('.lark-doc-heading-fold-toggle')
    return toggle ? { title: toggle.getAttribute('title'), tooltip: toggle.getAttribute('data-tooltip'), aria: toggle.getAttribute('aria-label') } : null
  })
  record('[④提示不重影] 折叠箭头没有原生 title', foldTip && foldTip.title === null, `title=${foldTip && foldTip.title}`)
  record('[④提示不重影] 折叠箭头保留自定义气泡与 aria-label', !!foldTip && !!foldTip.tooltip && !!foldTip.aria, `${foldTip && foldTip.tooltip} / ${foldTip && foldTip.aria}`)

  // 11.5 六点句柄与首行文字垂直居中（上标/公式不把中心拉偏）
  const centered = await page.evaluate(async () => {
    const editor = window.__larkDoc.getEditor()
    editor.commands.setContent('<p>勾股公式：a<sup>2</sup> + b<sup>2</sup> = c<sup>2</sup></p>')
    await new Promise((resolve) => setTimeout(resolve, 400))
    const paragraph = document.querySelector('.ProseMirror p')
    const box = paragraph.getBoundingClientRect()
    return { x: box.x + 8, y: box.y + box.height / 2 }
  })
  await page.mouse.move(centered.x, centered.y)
  await page.waitForTimeout(200)
  const handleBox = await page.locator('.lark-doc-block-handle-main').first().boundingBox()
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
  await page.waitForTimeout(250)
  const vertical = await page.evaluate(() => {
    const paragraph = document.querySelector('.ProseMirror p')
    const handle = document.querySelector('.lark-doc-block-handle-main')
    if (!paragraph || !handle) return null
    // 正文字号 rect：跳过 sup 里的数字
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT)
    const rects = []
    let node = walker.nextNode()
    while (node) {
      const value = node.textContent || ''
      if (value.trim() && !node.parentElement.closest('sup, sub')) {
        const range = document.createRange()
        range.setStart(node, value.search(/\S/))
        range.setEnd(node, value.search(/\s*$/))
        Array.from(range.getClientRects()).forEach((rect) => { if (rect.height > 1) rects.push(rect) })
      }
      node = walker.nextNode()
    }
    const textCenter = rects.reduce((sum, rect) => sum + rect.top + rect.height / 2, 0) / Math.max(1, rects.length)
    const handleRect = handle.getBoundingClientRect()
    return { textCenter, handleCenter: handleRect.top + handleRect.height / 2, handleHeight: handleRect.height }
  })
  record('[⑤句柄居中] 句柄中心与首行文字中心对齐', !!vertical && Math.abs(vertical.handleCenter - vertical.textCenter) <= 1.5,
    vertical ? `Δ=${Math.round((vertical.handleCenter - vertical.textCenter) * 10) / 10}px 句柄高=${vertical.handleHeight}` : '未测得')
  record('[⑤句柄居中] 句柄高度是 26px 盒模型（含边框）', !!vertical && vertical.handleHeight === 26, `高=${vertical && vertical.handleHeight}`)

  // 11.6 「1. 」+ 空格自动转有序列表
  const ordered = await page.evaluate(async () => {
    const editor = window.__larkDoc.getEditor()
    editor.commands.setContent('<p>列表输入</p><p></p>')
    await new Promise((resolve) => setTimeout(resolve, 400))
    let pos = -1
    editor.state.doc.descendants((node, at) => { if (node.type.name === 'paragraph' && !(node.textContent || '').trim()) pos = at })
    if (pos < 0) return null
    editor.commands.setTextSelection(pos + 1)
    editor.view.focus()
    return { pos }
  })
  if (ordered) {
    await page.keyboard.type('1. ', { delay: 90 })
    await page.waitForTimeout(500)
    const converted = await page.evaluate(() => {
      const editor = window.__larkDoc.getEditor()
      const types = []
      editor.state.doc.descendants((node) => { if (node.isBlock && node.type.name !== 'doc' && node.type.name !== 'text') types.push(node.type.name) })
      const list = document.querySelector('.lark-doc ol')
      return { types, hasOlDom: !!list, liCount: document.querySelectorAll('.lark-doc ol > li').length }
    })
    record('[⑥有序列表] 输入「1. 」自动转有序列表', converted.types.includes('orderedList') && converted.hasOlDom, JSON.stringify(converted.types))
    record('[⑥有序列表] 转换后是一个列表项', converted.liCount === 1, `li=${converted.liCount}`)
  } else record('[⑥有序列表] 输入「1. 」自动转有序列表', false, '没有空段落可输入')

  // 11.7 非标题块（段落 / 列表项）也能折叠 + 整块高亮
  // 真飞书里 can-fold / fold-handler 挂在「任何有子块的块」上，不只是标题；
  // 悬停遮罩覆盖整棵子树（一个矩形），折叠范围同样是缩进子树。
  await page.evaluate(async (html) => {
    window.localStorage.removeItem('lark-doc:folds:local')
    window.__larkDoc.getEditor().commands.setContent(html)
  }, '<p data-indent="0">段落折叠</p><pre data-indent="1"><code>方法</code></pre><p data-indent="0">你好你好</p>')
  await page.waitForTimeout(600)
  const paragraphFoldHover = await hoverSelector(page, '.ProseMirror p:text-is("段落折叠")')
  const paragraphFoldSegment = paragraphFoldHover.segments[0]
  const paragraphFoldShape = await page.evaluate(() => {
    const editor = window.__larkDoc.getEditor()
    let pos = -1
    editor.state.doc.descendants((node, at) => { if (node.type.name === 'paragraph' && (node.textContent || '') === '段落折叠') pos = at })
    if (pos < 0) return null
    const dom = editor.view.nodeDOM(pos)
    const paragraphRect = dom.getBoundingClientRect()
    const codeRect = document.querySelector('.lark-doc-code')?.getBoundingClientRect()
    return {
      hasToggle: !!dom.querySelector('.lark-doc-heading-fold-toggle'),
      subtreeHeight: Math.round(codeRect ? codeRect.bottom - paragraphRect.top : paragraphRect.height),
    }
  })
  record('[⑦非标题折叠] 段落挂了缩进子块就出现折叠箭头', !!paragraphFoldShape && paragraphFoldShape.hasToggle === true)
  record('[⑦非标题折叠] 段落悬停高亮整棵子树（一个矩形）',
    paragraphFoldHover.segments.length === 1 && paragraphFoldSegment?.section === true,
    `分段=${paragraphFoldHover.segments.length} section=${paragraphFoldSegment?.section}`)
  record('[⑦非标题折叠] 高亮高度覆盖缩进子块',
    !!paragraphFoldSegment && !!paragraphFoldShape && Math.abs(paragraphFoldSegment.height - paragraphFoldShape.subtreeHeight) <= 3,
    `高亮=${Math.round(paragraphFoldSegment?.height || 0)} 子树=${paragraphFoldShape?.subtreeHeight}`)
  const paragraphFolded = await page.evaluate(async () => {
    const editor = window.__larkDoc.getEditor()
    let pos = -1
    editor.state.doc.descendants((node, at) => { if (node.type.name === 'paragraph' && (node.textContent || '') === '段落折叠') pos = at })
    editor.view.nodeDOM(pos)?.querySelector('.lark-doc-heading-fold-toggle')?.click()
    await new Promise((resolve) => setTimeout(resolve, 400))
    const code = document.querySelector('.lark-doc-code')
    const sibling = Array.from(document.querySelectorAll('.ProseMirror p')).find((el) => (el.textContent || '') === '你好你好')
    return {
      hidden: document.querySelectorAll('.lark-doc-fold-hidden').length,
      codeVisible: code ? code.getBoundingClientRect().height > 0 : null,
      siblingVisible: sibling ? sibling.getBoundingClientRect().height > 0 : true,
      stored: JSON.parse(localStorage.getItem('lark-doc:folds:local') || '[]').length,
      foldedMark: document.querySelectorAll('.lark-doc-heading-folded').length,
    }
  })
  record('[⑦非标题折叠] 点箭头后缩进子块隐藏', paragraphFolded.hidden >= 1 && paragraphFolded.codeVisible === false,
    `隐藏=${paragraphFolded.hidden} 代码块可见=${paragraphFolded.codeVisible}`)
  record('[⑦非标题折叠] 折叠不带走同级兄弟块', paragraphFolded.siblingVisible === true)
  record('[⑦非标题折叠] 非标题块的折叠状态按 blockId 落盘', paragraphFolded.stored === 1 && paragraphFolded.foldedMark >= 1,
    `存=${paragraphFolded.stored} 折叠标记=${paragraphFolded.foldedMark}`)

  // 列表项：被子块藏在 item 内部（飞书把 fold-block-id 直接挂在 item 上）
  await page.evaluate(async () => {
    window.localStorage.removeItem('lark-doc:folds:local')
    window.__larkDoc.getEditor().commands.setContent('<ol><li><p>b. 4</p><pre data-indent="1"><code>1</code></pre></li><li><p>c. 5</p></li></ol>')
  })
  await page.waitForTimeout(600)
  const itemFold = await page.evaluate(async () => {
    const editor = window.__larkDoc.getEditor()
    let itemPos = -1
    editor.state.doc.descendants((node, at) => { if (node.type.name === 'listItem' && (node.textContent || '').trim().startsWith('b. 4')) itemPos = at })
    if (itemPos < 0) return null
    const dom = editor.view.nodeDOM(itemPos)
    const toggle = dom?.querySelector('.lark-doc-heading-fold-toggle')
    // item 的首个段落如果也挂箭头，两个 widget 会落在同一个行内位置、互相盖住，
    // 点其中一个等于把另一个刚设的状态切回去（实测只剩 1 个块被折叠）。
    const toggleCount = dom ? dom.querySelectorAll('.lark-doc-heading-fold-toggle').length : 0
    const hasBlockId = !!editor.state.doc.nodeAt(itemPos).attrs.blockId
    if (toggle) toggle.click()
    await new Promise((resolve) => setTimeout(resolve, 400))
    const code = document.querySelector('.lark-doc-code')
    const nextItem = Array.from(document.querySelectorAll('.ProseMirror li')).find((el) => (el.textContent || '').trim().startsWith('c. 5'))
    return {
      hasToggle: !!toggle,
      toggleCount,
      hasBlockId,
      hidden: document.querySelectorAll('.lark-doc-fold-hidden').length,
      codeVisible: code ? code.getBoundingClientRect().height > 0 : null,
      nextItemVisible: nextItem ? nextItem.getBoundingClientRect().height > 0 : true,
      stored: JSON.parse(localStorage.getItem('lark-doc:folds:local') || '[]').length,
      itemId: editor.state.doc.nodeAt(itemPos).attrs.blockId,
    }
  })
  record('[⑦列表项折叠] 列表项有 blockId 且出现折叠箭头', !!itemFold && itemFold.hasBlockId === true && itemFold.hasToggle === true,
    itemFold ? `id=${String(itemFold.itemId).slice(0, 12)} 箭头=${itemFold.hasToggle}` : '未找到列表项')
  record('[⑦列表项折叠] 整个 item 只有一个折叠箭头', !!itemFold && itemFold.toggleCount === 1,
    itemFold ? `箭头数=${itemFold.toggleCount}` : '未找到列表项')
  record('[⑦列表项折叠] 折叠后 item 内部子块隐藏', !!itemFold && itemFold.hidden >= 1 && itemFold.codeVisible === false,
    itemFold ? `隐藏=${itemFold.hidden} 代码块可见=${itemFold.codeVisible}` : '未找到列表项')
  record('[⑦列表项折叠] 折叠当前 item 不影响下一个 item', !!itemFold && itemFold.nextItemVisible === true)
  record('[⑦列表项折叠] 折叠状态挂在 item 自己的 id 上', !!itemFold && itemFold.stored === 1)

  record('无脚本错误', errors.length === 0, errors.slice(0, 2).join(' | '))

  await browser.close()
  const failed = results.filter((item) => !item.ok)
  console.log(`\n${results.length - failed.length}/${results.length} 项通过`)
  if (failed.length) process.exitCode = 1
}

main().catch((error) => { console.error(error); process.exit(1) })
