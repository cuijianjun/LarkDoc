'use strict'
/**
 * 浏览器级验证：表格工具条 + 表格边界操作条（阶段 5 批次 5G 前半）。
 *
 * 这一批把 `editor/TableTools.vue`（52 行）与 `editor/TableBoundaryTools.vue`（78 行）
 * 换成原生 DOM（`src/ui/tableTools.js`）。两条都是**选区驱动**的浮动工具条，不是面板：
 * 没有开合状态、没有 Esc、没有点外部关闭 —— 显隐完全由「光标是否在表格里」和
 * 「指针是否贴着单元格边线」决定。因此断言必须真的把光标放进单元格、真的把鼠标
 * 移到边线上，不能靠改状态变量伪造（那样只能证明 `v-if` 写对了，证明不了驱动源）。
 *
 * 五条容易漂移的契约：
 *   ① `.lark-doc-table-tools` 的 **13 颗按钮顺序 = `constants.js` 的 `tableActions`**，
 *      顺序错了图标/文案还对，只是点下去做的事变了 —— 最隐蔽的一类回归；
 *   ② 只有「表头行 / 表头列」两颗带 `aria-pressed`，其余**不带**（不是 `"false"`）；
 *   ③ 单元格背景那一段是 `label[title] > input[type=color]`，**不是**自绘色块，
 *      默认值来自 `DEFAULT_CELL_BACKGROUND`（`#f2faf6`）；
 *   ④ 两个对齐下拉走共用下拉原语（`role=combobox` + `.lark-doc-select-label`）；
 *   ⑤ 边界条是「线 `span[aria-hidden]` + 两颗 `＋` 按钮」，class 用 `is-column-before`
 *      这类语义名，**不是** `data-*`；CSS 变量 `--lark-doc-column-line-left` 同时喂给
 *      根节点（线本身另有一份 `left`）。
 *
 * 量法说明：单元格边线阈值 9px（`tableToolsMixin.updateTableBoundaryHover`），
 * 所以鼠标落点取「cell 左边线 +2px」或「cell 上边线 +2px」，别取正中。
 *
 * 依赖：demo dev server（`window.__larkDoc`）。用法：
 *   node scripts/verify-browser-table-tools.js [url]
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
  results.push({ ok: !!ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

// ══════════════ 页面内工具函数（必须自包含：会被 page.evaluate 序列化执行） ══════════════

/** 工具条快照。不在 DOM 里返回 null —— 「v-if 为假」就靠这个 null 判。 */
const measureTableTools = () => {
  const el = document.querySelector('.lark-doc-table-tools')
  if (!el) return null
  const buttons = [...el.children].filter((n) => n.tagName === 'BUTTON')
  const wrap = el.querySelector(':scope > label')
  const input = wrap ? wrap.querySelector('input') : null
  const selects = [...el.children].filter((n) => n.classList && n.classList.contains('lark-doc-select'))
  return {
    tag: el.tagName.toLowerCase(),
    classes: [...el.classList],
    role: el.getAttribute('role'),
    ariaLabel: el.getAttribute('aria-label'),
    childTags: [...el.children].map((n) => n.tagName.toLowerCase()),
    buttons: buttons.map((b) => ({
      text: b.textContent.trim(),
      type: b.getAttribute('type'),
      title: b.getAttribute('title'),
      pressed: b.getAttribute('aria-pressed'),
      hasPressed: b.hasAttribute('aria-pressed'),
    })),
    wrap: wrap ? {
      tag: wrap.tagName.toLowerCase(),
      title: wrap.getAttribute('title'),
      text: wrap.textContent.trim(),
      inputType: input ? input.getAttribute('type') : null,
      inputLabel: input ? input.getAttribute('aria-label') : null,
      inputValue: input ? input.value : null,
    } : null,
    selects: selects.map((span) => {
      const trigger = span.querySelector('button.lark-doc-select-trigger')
      const label = span.querySelector('.lark-doc-select-label')
      const caret = span.querySelector('.lark-doc-select-caret')
      return {
        triggerTag: trigger ? trigger.tagName.toLowerCase() : null,
        triggerType: trigger ? trigger.getAttribute('type') : null,
        role: trigger ? trigger.getAttribute('role') : null,
        ariaLabel: trigger ? trigger.getAttribute('aria-label') : null,
        title: trigger ? trigger.getAttribute('title') : null,
        expanded: trigger ? trigger.getAttribute('aria-expanded') : null,
        haspopup: trigger ? trigger.getAttribute('aria-haspopup') : null,
        labelText: label ? label.textContent.trim() : null,
        caret: caret ? { className: caret.className, tag: caret.tagName.toLowerCase() } : null,
      }
    }),
  }
}

/** 边界条快照。 */
const measureBoundary = () => {
  const el = document.querySelector('.lark-doc-table-boundary-tools')
  if (!el) return null
  const cs = getComputedStyle(el)
  const line = el.querySelector('.lark-doc-table-boundary-line')
  const buttons = [...el.children].filter((n) => n.tagName === 'BUTTON')
  return {
    tag: el.tagName.toLowerCase(),
    classes: [...el.classList],
    role: el.getAttribute('role'),
    ariaLabel: el.getAttribute('aria-label'),
    childTags: [...el.children].map((n) => n.tagName.toLowerCase()),
    columnVar: cs.getPropertyValue('--lark-doc-column-line-left').trim(),
    rowVar: cs.getPropertyValue('--lark-doc-row-line-top').trim(),
    line: line ? {
      className: line.className,
      ariaHidden: line.getAttribute('aria-hidden'),
      left: line.style.left,
      top: line.style.top,
      position: getComputedStyle(line).position,
    } : null,
    buttons: buttons.map((b) => ({
      className: b.className,
      type: b.getAttribute('type'),
      text: b.textContent.trim(),
      ariaLabel: b.getAttribute('aria-label'),
      title: b.getAttribute('title'),
    })),
    rect: { width: Math.round(el.getBoundingClientRect().width), height: Math.round(el.getBoundingClientRect().height) },
  }
}

/** 把光标放进第 index 个 tableCell（0 基）。 */
const selectCell = (index) => {
  const editor = window.__larkDoc.getEditor()
  let seen = 0
  let pos = null
  editor.state.doc.descendants((node, p) => {
    if (pos !== null) return false
    if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
      if (seen === index) pos = p + 2
      seen += 1
      return false
    }
    return true
  })
  if (pos === null) return null
  editor.commands.setTextSelection(pos)
  return pos
}

const TABLE = '<p>表格前的正文</p>' +
  '<table><tbody>' +
  '<tr><td><p>甲一</p></td><td><p>甲二</p></td></tr>' +
  '<tr><td><p>乙一</p></td><td><p>乙二</p></td></tr>' +
  '</tbody></table>' +
  '<p>表格后的正文</p>'

const setDoc = async (page, html) => {
  await page.evaluate((content) => {
    window.__larkDoc.setContent(content)
    window.__larkDoc.getEditor().commands.focus('start')
  }, html)
  await page.waitForTimeout(360)
}

/** 单元格第 row/col 个的四个边中点（视口坐标）。 */
const cellEdge = async (page, index) => page.evaluate((cellIndex) => {
  const cells = [...document.querySelectorAll('.lark-doc-paper td, .lark-doc-paper th')]
  const cell = cells[cellIndex]
  if (!cell) return null
  const r = cell.getBoundingClientRect()
  return {
    left: { x: r.left + 2, y: r.top + r.height / 2 },
    right: { x: r.right - 2, y: r.top + r.height / 2 },
    top: { x: r.left + r.width / 2, y: r.top + 2 },
    bottom: { x: r.left + r.width / 2, y: r.bottom - 2 },
    rect: { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) },
  }
}, index)

;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: findChromium() || undefined })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)

  await setDoc(page, TABLE)

  // ——————————————————— ① 显隐由选区驱动 ———————————————————
  record('[表格条] 光标在正文段落里 → 工具条**不在 DOM 里**',
    (await page.evaluate(measureTableTools)) === null, '正文态')

  await page.evaluate(selectCell, 0)
  await page.waitForTimeout(300)
  let snap = await page.evaluate(measureTableTools)
  record('[表格条] 光标进单元格 → 工具条真进 DOM（v-if 语义）',
    !!snap, snap ? '已渲染' : '没渲染')

  record('[表格条] 根是 div.lark-doc-table-tools[role=toolbar][aria-label=表格工具]',
    !!snap && snap.tag === 'div' && snap.classes.length === 1 && snap.classes[0] === 'lark-doc-table-tools' &&
      snap.role === 'toolbar' && snap.ariaLabel === '表格工具',
    snap ? `${snap.tag}.${snap.classes.join('.')} role=${snap.role} label=${snap.ariaLabel}` : '没渲染')

  // ——————————————————— ② 13 颗按钮 —— 顺序即契约 ———————————————————
  const EXPECTED = ['上方加行', '下方加行', '删行', '左侧加列', '右侧加列', '删列', '合并单元格',
    '拆分单元格', '表头行', '表头列', '清空单元格', '均分列宽', '删除表格']
  record('[表格条] 13 颗按钮，文案顺序 = constants.js 的 tableActions（顺序错了功能会张冠李戴）',
    !!snap && JSON.stringify(snap.buttons.map((b) => b.text)) === JSON.stringify(EXPECTED),
    snap ? snap.buttons.map((b) => b.text).join(' / ') : '没渲染')

  record('[表格条] 每颗按钮 type=button 且 title = 文案（原生 `title` 走 tooltip 气泡）',
    !!snap && snap.buttons.every((b) => b.type === 'button' && b.title === b.text),
    snap ? JSON.stringify(snap.buttons.map((b) => b.title)) : '没渲染')

  record('[表格条] 只有「表头行 / 表头列」带 aria-pressed，其余**没有该属性**（不是 "false"）',
    !!snap && snap.buttons[8].hasPressed && snap.buttons[9].hasPressed &&
      snap.buttons.filter((b) => b.hasPressed).length === 2 &&
      snap.buttons[8].pressed === 'false' && snap.buttons[9].pressed === 'false',
    snap ? snap.buttons.map((b) => `${b.text}=${b.pressed}`).join(' ') : '没渲染')

  // ——————————————————— ③ 单元格背景 = 原生 color input ———————————————————
  record('[表格条] 单元格背景段 = `label[title=单元格背景] > input[type=color][aria-label=单元格背景]`',
    !!snap && !!snap.wrap && snap.wrap.tag === 'label' && snap.wrap.title === '单元格背景' &&
      snap.wrap.inputType === 'color' && snap.wrap.inputLabel === '单元格背景',
    snap && snap.wrap ? `${snap.wrap.tag}[${snap.wrap.title}] input=${snap.wrap.inputType}` : '没渲染')

  record('[表格条] 背景色默认值 = DEFAULT_CELL_BACKGROUND（#f2faf6）',
    !!snap && !!snap.wrap && String(snap.wrap.inputValue).toLowerCase() === '#f2faf6',
    snap && snap.wrap ? snap.wrap.inputValue : '没渲染')

  // ——————————————————— ④ 两个对齐下拉 —— 共用下拉原语 ———————————————————
  record('[表格条] 两个对齐下拉：aria-label = 单元格水平对齐 / 单元格垂直对齐',
    !!snap && snap.selects.length === 2 &&
      snap.selects[0].ariaLabel === '单元格水平对齐' && snap.selects[1].ariaLabel === '单元格垂直对齐',
    snap ? snap.selects.map((s) => s.ariaLabel).join(' / ') : '没渲染')

  record('[表格条] 下拉走共用原语：触发按钮 role=combobox / aria-haspopup=listbox / aria-expanded=false + 12px caret',
    !!snap && snap.selects.every((s) => s.triggerTag === 'button' && s.triggerType === 'button' &&
      s.role === 'combobox' && s.haspopup === 'listbox' && s.expanded === 'false' &&
      s.caret && s.caret.className === 'lark-doc-select-caret lark-doc-icon'),
    snap ? JSON.stringify(snap.selects.map((s) => ({ role: s.role, exp: s.expanded, caret: s.caret && s.caret.className }))) : '没渲染')

  record('[表格条] 下拉未选中时显示 options[0] 的 label（水平对齐 / 垂直对齐），不是空串',
    !!snap && snap.selects[0].labelText === '水平对齐' && snap.selects[1].labelText === '垂直对齐',
    snap ? snap.selects.map((s) => s.labelText).join(' / ') : '没渲染')

  // ——————————————————— ⑤ 动手：表头行 / 上方加行 ———————————————————
  const rowsBefore = await page.evaluate(() => document.querySelectorAll('.lark-doc-paper table tr').length)
  await page.evaluate(() => {
    const tools = document.querySelector('.lark-doc-table-tools')
    ;[...tools.querySelectorAll('button')].find((b) => b.textContent.trim() === '上方加行').click()
  })
  await page.waitForTimeout(360)
  const rowsAfter = await page.evaluate(() => document.querySelectorAll('.lark-doc-paper table tr').length)
  record('[表格条] 点「上方加行」→ 真的加了一行（2 → 3）',
    rowsBefore === 2 && rowsAfter === 3, `${rowsBefore} → ${rowsAfter}`)

  await page.evaluate(selectCell, 0)
  await page.waitForTimeout(260)
  await page.evaluate(() => {
    const tools = document.querySelector('.lark-doc-table-tools')
    ;[...tools.querySelectorAll('button')].find((b) => b.textContent.trim() === '表头行').click()
  })
  await page.waitForTimeout(360)
  const headerState = await page.evaluate(() => ({
    th: document.querySelectorAll('.lark-doc-paper table th').length,
    pressed: (() => {
      const tools = document.querySelector('.lark-doc-table-tools')
      if (!tools) return null
      const btn = [...tools.querySelectorAll('button')].find((b) => b.textContent.trim() === '表头行')
      return btn ? btn.getAttribute('aria-pressed') : null
    })(),
  }))
  record('[表格条] 点「表头行」→ 首行变 th 且按钮 aria-pressed 翻成 "true"',
    headerState.th > 0 && headerState.pressed === 'true',
    `th=${headerState.th} pressed=${headerState.pressed}`)

  // ——————————————————— ⑥ 边界条：列 ———————————————————
  await page.evaluate(selectCell, 0)
  await page.waitForTimeout(260)
  const edge = await cellEdge(page, 0)
  record('[边界条] 找到首个单元格（列边界判定需要真实几何）', !!edge, edge ? JSON.stringify(edge.rect) : '没找到单元格')

  await page.mouse.move(edge.left.x, edge.left.y)
  await page.waitForTimeout(260)
  let boundary = await page.evaluate(measureBoundary)
  record('[边界条] 鼠标贴单元格左边线 → 边界条进 DOM，class 带 is-column',
    !!boundary && boundary.classes.indexOf('is-column') !== -1,
    boundary ? boundary.classes.join('.') : '没渲染')

  record('[边界条] 根是 div[role=toolbar][aria-label=表格边界操作]（class 含 lark-doc-table-boundary-tools）',
    !!boundary && boundary.tag === 'div' && boundary.role === 'toolbar' && boundary.ariaLabel === '表格边界操作' &&
      boundary.classes.indexOf('lark-doc-table-boundary-tools') !== -1,
    boundary ? `${boundary.tag}.${boundary.classes.join('.')} label=${boundary.ariaLabel}` : '没渲染')

  record('[边界条] 列态 = 线 span[aria-hidden] + 两颗 ＋ 按钮（is-column-before / is-column-after）',
    !!boundary && boundary.childTags.join(',') === 'span,button,button' &&
      boundary.buttons.map((b) => b.className).join(',') === 'is-column-before,is-column-after' &&
      boundary.buttons.every((b) => b.text === '＋' && b.type === 'button') &&
      boundary.line && boundary.line.className === 'lark-doc-table-boundary-line is-column-line' && boundary.line.ariaHidden === 'true',
    boundary ? `${boundary.childTags.join('>')} [${boundary.buttons.map((b) => b.className)}]` : '没渲染')

  record('[边界条] 列态按钮 aria-label / title = 在左侧插入列 / 在右侧插入列',
    !!boundary && boundary.buttons[0].ariaLabel === '在左侧插入列' && boundary.buttons[0].title === '在左侧插入列' &&
      boundary.buttons[1].ariaLabel === '在右侧插入列' && boundary.buttons[1].title === '在右侧插入列',
    boundary ? boundary.buttons.map((b) => b.ariaLabel).join(' / ') : '没渲染')

  record('[边界条] 竖线位置两处都给了：线自身 `left` 与根节点 CSS 变量 `--lark-doc-column-line-left`',
    !!boundary && /px$/.test(boundary.line.left) && /^-?\d+(\.\d+)?px$/.test(boundary.columnVar) &&
      boundary.line.left === boundary.columnVar,
    boundary ? `line.left=${boundary.line.left} var=${boundary.columnVar}` : '没渲染')

  const colsBefore = await page.evaluate(() => document.querySelectorAll('.lark-doc-paper table tr')[0].children.length)
  await page.evaluate(() => {
    const bar = document.querySelector('.lark-doc-table-boundary-tools')
    bar.querySelector('.is-column-after').click()
  })
  await page.waitForTimeout(400)
  const colsAfter = await page.evaluate(() => document.querySelectorAll('.lark-doc-paper table tr')[0].children.length)
  record('[边界条] 点「在右侧插入列」→ 真的加了一列（2 → 3），且边界条自己收起',
    colsAfter === colsBefore + 1 && (await page.evaluate(measureBoundary)) === null,
    `${colsBefore} → ${colsAfter}`)

  // ——————————————————— ⑦ 边界条：行 ———————————————————
  await page.evaluate(selectCell, 0)
  await page.waitForTimeout(260)
  const edge2 = await cellEdge(page, 0)
  await page.mouse.move(edge2.top.x, edge2.top.y)
  await page.waitForTimeout(260)
  boundary = await page.evaluate(measureBoundary)
  record('[边界条] 鼠标贴上边线 → 切成行态（is-row / is-row-line / 两颗插入行按钮）',
    !!boundary && boundary.classes.indexOf('is-row') !== -1 &&
      boundary.line.className === 'lark-doc-table-boundary-line is-row-line' &&
      boundary.buttons.map((b) => b.className).join(',') === 'is-row-before,is-row-after' &&
      boundary.buttons[0].ariaLabel === '在上方插入行' && boundary.buttons[1].ariaLabel === '在下方插入行',
    boundary ? `${boundary.classes.join('.')} [${boundary.buttons.map((b) => b.className)}]` : '没渲染')

  record('[边界条] 横线位置给的是 `--lark-doc-row-line-top` 与线自身 `top`（列变量此时为空）',
    !!boundary && /^-?\d+(\.\d+)?px$/.test(boundary.rowVar) && boundary.line.top === boundary.rowVar &&
      boundary.columnVar === '',
    boundary ? `line.top=${boundary.line.top} rowVar=${boundary.rowVar} colVar="${boundary.columnVar}"` : '没渲染')

  // 移开鼠标 → 收起。落点选正文段落（在 `.ProseMirror` 里、但不在任何 td 里）：
  // 边线判定只在「指针进到单元格上」时才跑，所以这一下必须打到编辑器内容区，
  // 打到 paper 的空白或页头都不会触发 `updateTableBoundaryHover`。
  const outside = await page.evaluate(() => {
    const paragraph = [...document.querySelectorAll('.lark-doc-paper p')].pop()
    const r = paragraph.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await page.mouse.move(outside.x, outside.y)
  await page.waitForTimeout(320)
  record('[边界条] 鼠标离开单元格边线 → 边界条真从 DOM 摘掉',
    (await page.evaluate(measureBoundary)) === null, '已摘除')

  // ——————————————————— ⑧ 只读态 ———————————————————
  await page.evaluate(selectCell, 0)
  await page.waitForTimeout(220)
  await page.evaluate(() => { document.querySelector('.lark-doc').__vue__.readonly = true })
  await page.waitForTimeout(320)
  record('[只读] 只读态下表格工具条不进 DOM（`!effectiveReadonly` 是硬条件）',
    (await page.evaluate(measureTableTools)) === null, '只读')
  await page.mouse.move(edge2.top.x, edge2.top.y)
  await page.waitForTimeout(240)
  record('[只读] 只读态下边界条也不进 DOM',
    (await page.evaluate(measureBoundary)) === null, '只读')

  record('无脚本错误', errors.length === 0, errors.join(' | '))

  await browser.close()
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} 项通过`)
  process.exit(failed.length ? 1 : 0)
})().catch((error) => {
  console.error('运行失败：', error)
  process.exit(2)
})
