/**
 * 表格工具条 + 表格边界操作条 —— 原生 DOM 版（`src/ui/` 积木 · 阶段 5 批次 5G）。
 *
 * 这一批摘掉 `editor/TableTools.vue`（52 行）与 `editor/TableBoundaryTools.vue`（78 行）。
 * 两条都是**选区驱动**的浮动条，没有开合状态机：显隐完全由「光标是否在表格里」
 * 与「指针是否贴着单元格边线」决定，所以这里的 `update(state)` 只做「按 state 重画」，
 * 判断与几何计算全部留在 `tableToolsMixin`（那边读的是 ProseMirror 的实时 state）。
 *
 * 结构即契约（`scripts/verify-browser-table-tools.js` 逐字段量这些）：
 *
 *   div.lark-doc-table-tools[role=toolbar][aria-label=表格工具]
 *     button[type=button][title=label]              ← 13 颗，**顺序 = `constants.js` 的 tableActions**
 *                                                     只有 toggleHeaderRow / toggleHeaderColumn 带
 *                                                     `aria-pressed`（其余**没有该属性**，不是 "false"）
 *     label[title=单元格背景] > '单元格背景 ' + input[type=color][aria-label=单元格背景]
 *     span.lark-doc-select ...                      ← 两个对齐下拉，走共用原语 `select.js`
 *
 *   div.lark-doc-table-boundary-tools[.is-column|.is-row][role=toolbar][aria-label=表格边界操作]
 *     span.lark-doc-table-boundary-line.is-column-line|.is-row-line[aria-hidden=true]
 *     button.is-column-before / .is-column-after    ← 列态
 *     button.is-row-before / .is-row-after          ← 行态
 *
 * ⚠️ 与 SFC 的两处**刻意差异**（都是修 bug，不是换写法）：
 *
 * 1. SFC 的 `:style` 绑定写的是 `...tableBoundary.style`（漏了 `ed.` 前缀）。模板作用域里没有
 *    `tableBoundary` 这个变量，渲染期直接抛 `TypeError: Cannot read properties of undefined
 *    (reading 'style')` —— **整条边界条从来没渲染出来过**（Vue 报 render error 但不影响别处，
 *    所以只在控制台留一行）。这里改成真的把几何喂给根节点（`applyStyle`）。
 * 2. 两个 CSS 变量只写**当前轴**那一个：列态给 `--lark-doc-column-line-left`、行态给
 *    `--lark-doc-row-line-top`，另一轴 `removeProperty`。SFC 两个都写，行态下留着上一轮的
 *    列位置，既没意义也让人以为还在列态（CSS 本来就有 `, 50%` 兜底）。
 */
import { applyStyle, mountNode, setAttr, syncChildren } from './dom'
import { createSelect } from './select'
import { DEFAULT_CELL_BACKGROUND } from './palette'

const SEP = '\u0001'

function setVar(node, name, value) {
  if (value === null) {
    if (node.style.getPropertyValue(name)) node.style.removeProperty(name)
    return
  }
  if (node.style.getPropertyValue(name) !== value) node.style.setProperty(name, value)
}

/**
 * @param {object} options
 * @param {HTMLElement} options.host 挂载点（`display: contents` 宿主，不占盒）
 * @param {{onAction?: (id: string) => void, onBackground?: (color: string) => void, onAlign?: (key: string, value: string) => void}} [options.handlers]
 * @returns {{ el: HTMLElement, update(state: object): void, destroy(): void }}
 */
export function createTableTools({ host, handlers = {} }) {
  const el = document.createElement('div')
  el.className = 'lark-doc-table-tools'
  el.setAttribute('role', 'toolbar')
  el.setAttribute('aria-label', '表格工具')

  // 背景色是原生 color input（不是自绘色块）：点开就是系统取色器，值回填由浏览器负责。
  const label = document.createElement('label')
  label.setAttribute('title', '单元格背景')
  label.appendChild(document.createTextNode('单元格背景 '))
  const input = document.createElement('input')
  input.type = 'color'
  input.setAttribute('aria-label', '单元格背景')
  input.value = DEFAULT_CELL_BACKGROUND
  input.addEventListener('change', () => {
    if (handlers.onBackground) handlers.onBackground(input.value)
  })
  label.appendChild(input)

  const textAlign = createSelect({
    ariaLabel: '单元格水平对齐',
    onChange: (value) => { if (handlers.onAlign) handlers.onAlign('textAlign', value) },
  })
  const verticalAlign = createSelect({
    ariaLabel: '单元格垂直对齐',
    onChange: (value) => { if (handlers.onAlign) handlers.onAlign('verticalAlign', value) },
  })

  /** 13 颗动作按钮：只在 id 序列变了才重建（顺序即契约，必须按 `actions` 原序插）。 */
  let rows = []
  let rowsSignature = ''

  function rebuildActions(actions) {
    const signature = actions.map((item) => item.id).join(SEP)
    if (signature === rowsSignature) return
    rows.forEach((row) => row.node.remove())
    rows = actions.map((item) => {
      const node = document.createElement('button')
      node.type = 'button'
      node.setAttribute('title', item.label)
      node.textContent = item.label
      // 与 SFC 的 `@mousedown.prevent` 同义：按下不转移焦点，单元格选区才不会被浏览器清掉。
      node.addEventListener('mousedown', (event) => event.preventDefault())
      node.addEventListener('click', () => { if (handlers.onAction) handlers.onAction(item.id) })
      // 动作按钮永远排在 label 之前，按 actions 原序依次插入即为最终顺序。
      el.insertBefore(node, label)
      return { node, id: item.id }
    })
    rowsSignature = signature
  }

  el.appendChild(label)
  el.appendChild(textAlign.el)
  el.appendChild(verticalAlign.el)

  function update(state = {}) {
    if (!state.open) {
      mountNode(host, el, false)
      return
    }
    if (state.actions) rebuildActions(state.actions)
    if (state.header) {
      rows.forEach((row) => {
        const pressed = row.id === 'toggleHeaderRow' ? state.header.row
          : row.id === 'toggleHeaderColumn' ? state.header.column : null
        // 只有表头两颗输出 aria-pressed；其余走 null → 属性不存在（不是 "false"）。
        setAttr(row.node, 'aria-pressed', pressed === null || pressed === undefined ? null : String(pressed))
      })
    }
    if (state.textAlignOptions) textAlign.update({ options: state.textAlignOptions, value: state.textAlign })
    if (state.verticalAlignOptions) verticalAlign.update({ options: state.verticalAlignOptions, value: state.verticalAlign })
    mountNode(host, el, true)
  }

  return {
    el,
    update,
    destroy() {
      textAlign.destroy()
      verticalAlign.destroy()
      if (el.parentNode) el.parentNode.removeChild(el)
    },
  }
}

/**
 * @param {object} options
 * @param {HTMLElement} options.host 挂载点（在 `.lark-doc-paper` 里，`display: contents`）
 * @param {{onAction?: (id: string) => void, onKeep?: () => void, onClear?: () => void}} [options.handlers]
 * @returns {{ el: HTMLElement, update(state: object): void, destroy(): void }}
 */
export function createTableBoundaryTools({ host, handlers = {} }) {
  const el = document.createElement('div')
  el.className = 'lark-doc-table-boundary-tools'
  el.setAttribute('role', 'toolbar')
  el.setAttribute('aria-label', '表格边界操作')

  const line = document.createElement('span')
  line.className = 'lark-doc-table-boundary-line'
  line.setAttribute('aria-hidden', 'true')

  function makeButton(className, label, id) {
    const node = document.createElement('button')
    node.type = 'button'
    node.className = className
    node.setAttribute('aria-label', label)
    node.setAttribute('title', label)
    // 文本是 `＋`（CSS 里 `font-size: 0` + `::before` 才是真正可见的胶囊），与 SFC 一致。
    node.textContent = '＋'
    node.addEventListener('mousedown', (event) => event.preventDefault())
    node.addEventListener('click', () => { if (handlers.onAction) handlers.onAction(id) })
    return node
  }

  const columnBefore = makeButton('is-column-before', '在左侧插入列', 'addColumnBefore')
  const columnAfter = makeButton('is-column-after', '在右侧插入列', 'addColumnAfter')
  const rowBefore = makeButton('is-row-before', '在上方插入行', 'addRowBefore')
  const rowAfter = makeButton('is-row-after', '在下方插入行', 'addRowAfter')

  // 指针进到条上不能把 hover 清掉（否则鼠标一移向按钮，条就先消失了）。
  el.addEventListener('pointerenter', () => { if (handlers.onKeep) handlers.onKeep() })
  el.addEventListener('pointerleave', () => { if (handlers.onClear) handlers.onClear() })

  function update(state = {}) {
    if (!state.open) {
      mountNode(host, el, false)
      return
    }
    const kind = state.kind === 'row' ? 'row' : 'column'
    el.classList.toggle('is-column', kind === 'column')
    el.classList.toggle('is-row', kind === 'row')
    // 根节点的盒子就是整张表格：`position: absolute` 靠它把线/按钮摆到单元格边线上。
    applyStyle(el, state.style)
    if (kind === 'column') {
      setVar(el, '--lark-doc-column-line-left', `${state.columnLineLeft}px`)
      setVar(el, '--lark-doc-row-line-top', null)
      applyStyle(line, { left: `${state.columnLineLeft}px` })
    } else {
      setVar(el, '--lark-doc-row-line-top', `${state.rowLineTop}px`)
      setVar(el, '--lark-doc-column-line-left', null)
      applyStyle(line, { top: `${state.rowLineTop}px` })
    }
    line.className = kind === 'column' ? 'lark-doc-table-boundary-line is-column-line' : 'lark-doc-table-boundary-line is-row-line'
    // 四个按钮各带 v-if：不在当前轴的必须**真的不在 DOM 里**（不是 display:none）。
    syncChildren(el, [
      { node: line, on: true },
      { node: columnBefore, on: kind === 'column' },
      { node: columnAfter, on: kind === 'column' },
      { node: rowBefore, on: kind === 'row' },
      { node: rowAfter, on: kind === 'row' },
    ])
    mountNode(host, el, true)
  }

  return {
    el,
    update,
    destroy() {
      if (el.parentNode) el.parentNode.removeChild(el)
    },
  }
}
