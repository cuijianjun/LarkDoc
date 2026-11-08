/**
 * tableOverlays — 表格的「md 风格」交互层（原生 DOM 积木 · feat/md-table-interaction）。
 *
 * 与 `createTableTools` / `createTableBoundaryTools` 的分工：那两条是**选区驱动**的工具条，
 * 本层是**表格块驱动**的几何层：行/列选择条、拖选择条重排（指示线 + 预览卡）、
 * 横向滚动条、左右边缘渐隐、表格上方浮窗。全部几何由 `tableInteractionMixin` 算好塞进
 * `state`，这里只负责「按 state 重画」+ 把指针手势翻译成回调，不读 ProseMirror state。
 *
 * 结构约定（不进 verify-browser-table-tools 的断言面，是独立新增层）：
 *   div.lark-doc-table-overlay[aria-hidden=true]     ← 盒子 = `.tableWrapper` 可视区
 *     .lark-doc-table-edge.is-left / .is-right
 *     .lark-doc-table-scrollbar > .lark-doc-table-scrollbar-thumb
 *     .lark-doc-table-drop-line / .lark-doc-table-snap
 *     .lark-doc-table-drag-card > head + body
 *     .lark-doc-table-float > button
 *     .lark-doc-table-selector-layer > .lark-doc-table-selector[is-column|is-row]
 *
 * 🔴 根节点 `pointer-events: none`，只有选择条 / 滚动条 / 浮窗自己开 `auto`：
 *    否则会盖住单元格，边界条的 hover 判定（`updateTableBoundaryHover`）与 ProseMirror
 *    的 `posAtCoords` 都会失效。
 */
import { applyStyle, mountNode, syncChildren } from './dom'

const SEP = '\u0001'

const FLOAT_ACTIONS = [
  { id: 'toggleBold', label: 'B', title: '加粗' },
  { id: 'toggleItalic', label: 'I', title: '斜体' },
  { id: 'toggleStrike', label: 'S', title: '删除线' },
  { id: 'addRowAfter', label: '＋行', title: '在下方插入行' },
  { id: 'addColumnAfter', label: '＋列', title: '在右侧插入列' },
]

function makeNode(className) {
  const node = document.createElement('div')
  node.className = className
  return node
}

/**
 * @param {object} options
 * @param {HTMLElement} options.host 挂载点（在 `.lark-doc-paper` 里，`display: contents`）
 * @param {{onSelect?: Function, onReorderMove?: Function, onReorderEnd?: Function,
 *          onReorderCancel?: Function, onScrollRatio?: Function, onAction?: Function}} [options.handlers]
 * @returns {{ el: HTMLElement, update(state: object): void, destroy(): void }}
 */
export function createTableOverlays({ host, handlers = {} }) {
  const el = makeNode('lark-doc-table-overlay')
  // ⚠️ 根节点不能 aria-hidden：浮窗按钮 / 行列选择条 / 自绘滚动条都是可聚焦控件，
  //    根节点一隐藏会把它们整棵从无障碍树里抹掉（Tab 得到但读屏读不到）。
  //    只给纯装饰件单独隐藏，交互件保留可访问名。

  const edgeLeft = makeNode('lark-doc-table-edge is-left')
  const edgeRight = makeNode('lark-doc-table-edge is-right')
  const scrollbar = makeNode('lark-doc-table-scrollbar')
  const thumb = makeNode('lark-doc-table-scrollbar-thumb')
  scrollbar.appendChild(thumb)
  const dropLine = makeNode('lark-doc-table-drop-line')
  const snap = makeNode('lark-doc-table-snap')
  const dragCard = makeNode('lark-doc-table-drag-card')
  const cardHead = makeNode('lark-doc-table-drag-card-head')
  const cardBody = makeNode('lark-doc-table-drag-card-body')
  dragCard.appendChild(cardHead)
  dragCard.appendChild(cardBody)
  const float = makeNode('lark-doc-table-float')
  const selectorLayer = makeNode('lark-doc-table-selector-layer')
  ;[edgeLeft, edgeRight, dropLine, snap, dragCard].forEach((node) => node.setAttribute('aria-hidden', 'true'))
  scrollbar.setAttribute('role', 'scrollbar')
  scrollbar.setAttribute('aria-label', '表格横向滚动')
  scrollbar.setAttribute('aria-orientation', 'horizontal')
  scrollbar.setAttribute('aria-valuemin', '0')
  scrollbar.setAttribute('aria-valuemax', '100')
  scrollbar.setAttribute('tabindex', '-1')

  FLOAT_ACTIONS.forEach((action) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = action.label
    button.setAttribute('title', action.title)
    button.setAttribute('aria-label', action.title)
    // 与工具条同义：不抢焦点，否则单元格选区会被浏览器清掉。
    button.addEventListener('mousedown', (event) => event.preventDefault())
    button.addEventListener('click', () => { if (handlers.onAction) handlers.onAction(action.id) })
    float.appendChild(button)
  })

  el.appendChild(edgeLeft)
  el.appendChild(edgeRight)
  el.appendChild(scrollbar)
  el.appendChild(dropLine)
  el.appendChild(snap)
  el.appendChild(dragCard)
  el.appendChild(float)
  el.appendChild(selectorLayer)

  let current = { columns: [], rows: [] }
  let columns = []
  let columnSignature = ''
  let rows = []
  let rowSignature = ''

  // 自绘滚动条的键盘等价：方向键 / Home / End / PageUp / PageDown。
  // 原生滚动条被 CSS 藏了，不给键盘入口就等于超宽表格无法用键盘浏览。
  scrollbar.addEventListener('keydown', (event) => {
    if (!current.scrollVisible) return
    const step = event.key === 'PageUp' || event.key === 'PageDown' ? 0.3 : 0.08
    let ratio = current.scrollRatio || 0
    switch (event.key) {
      case 'ArrowLeft':
      case 'PageUp': ratio -= step; break
      case 'ArrowRight':
      case 'PageDown': ratio += step; break
      case 'Home': ratio = 0; break
      case 'End': ratio = 1; break
      default: return
    }
    event.preventDefault()
    if (handlers.onScrollRatio) handlers.onScrollRatio(Math.max(0, Math.min(1, ratio)))
  })

  /** 选择条：点 = 选整行/整列；按住拖 = 重排。两者共用一个 pointerdown 起点。 */
  function makeSelector(axis, index) {
    const node = document.createElement('div')
    node.className = `lark-doc-table-selector is-${axis}`
    node.setAttribute('role', 'button')
    node.setAttribute('tabindex', '0')
    node.setAttribute('aria-pressed', 'false')
    node.setAttribute('aria-label', axis === 'column' ? `选择第 ${index + 1} 列` : `选择第 ${index + 1} 行`)
    node.addEventListener('pointerdown', (event) => startDrag(event, axis, index))
    // 键盘等价：Enter / Space 选中整行整列（与指针单击同一个 handler）。
    node.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      if (handlers.onSelect) handlers.onSelect(axis, index)
    })
    return { node, index }
  }

  function rebuild(kind, items) {
    const signature = items.map((item) => `${item.index}:${Math.round(item.left ?? item.top)}:${Math.round(item.width ?? item.height)}`).join(SEP)
    const bag = kind === 'column' ? { list: columns, sig: columnSignature } : { list: rows, sig: rowSignature }
    if (signature === bag.sig) return bag.list
    const next = items.map((item) => makeSelector(kind, item.index))
    if (kind === 'column') { columns = next; columnSignature = signature }
    else { rows = next; rowSignature = signature }
    return next
  }

  let drag = null
  let cleanupDrag = null
  let cleanupScroll = null
  function startDrag(event, axis, index) {
    // 触屏 / 触控笔的 pointerdown 不保证 button === 0（部分 Safari 版本给 -1），
    // 无条件校验主键会把触屏点选择条整个吞掉；只对鼠标保留主键判断。
    if (drag || (event.pointerType === 'mouse' && event.button !== 0)) return
    event.preventDefault()
    const win = el.ownerDocument.defaultView
    if (!win) return
    drag = { axis, index, startX: event.clientX, startY: event.clientY, moved: false, to: index }
    // 触屏有 implicit pointer capture：节点一旦在拖拽中被摘掉，后续 pointermove 就断了。
    // 显式 capture 到命中节点并在 detach 时 release，保证整套手势完整；合成事件
    // （浏览器验收里手工 dispatch）没有 active pointer，setPointerCapture 会抛，忽略即可。
    const captureTarget = event.currentTarget
    let captured = false
    try {
      if (captureTarget?.setPointerCapture && event.pointerId != null) {
        captureTarget.setPointerCapture(event.pointerId)
        captured = true
      }
    } catch { captured = false }

    const onMove = (moveEvent) => {
      if (!drag) return
      const dx = moveEvent.clientX - drag.startX
      const dy = moveEvent.clientY - drag.startY
      if (!drag.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return
      drag.moved = true
      const rect = el.getBoundingClientRect()
      const point = axis === 'column' ? moveEvent.clientX - rect.left : moveEvent.clientY - rect.top
      const items = axis === 'column' ? current.columns : current.rows
      let target = items.length - 1
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i]
        const start = axis === 'column' ? item.left : item.top
        const size = axis === 'column' ? item.width : item.height
        if (point < start + size / 2) { target = i; break }
      }
      drag.to = target
      if (handlers.onReorderMove) handlers.onReorderMove(axis, drag.index, target, moveEvent.clientX, moveEvent.clientY)
    }
    const detach = () => {
      if (captured) {
        try { captureTarget.releasePointerCapture(event.pointerId) } catch { /* pointerup 后浏览器已自动释放 */ }
        captured = false
      }
      win.removeEventListener('pointermove', onMove, true)
      win.removeEventListener('pointerup', onUp, true)
      win.removeEventListener('pointercancel', onCancel, true)
      cleanupDrag = null
    }
    const onCancel = () => {
      detach()
      drag = null
      if (handlers.onReorderCancel) handlers.onReorderCancel()
    }
    const onUp = () => {
      detach()
      const done = drag
      drag = null
      if (!done) return
      if (done.moved) {
        if (handlers.onReorderEnd) handlers.onReorderEnd(done.axis, done.index, done.to)
        if (handlers.onReorderCancel) handlers.onReorderCancel()
      } else if (handlers.onSelect) handlers.onSelect(done.axis, done.index)
    }
    win.addEventListener('pointermove', onMove, true)
    win.addEventListener('pointerup', onUp, true)
    win.addEventListener('pointercancel', onCancel, true)
    cleanupDrag = () => {
      detach()
      drag = null
      if (handlers.onReorderCancel) handlers.onReorderCancel()
    }
  }

  scrollbar.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    // 上一次手势若因窗口失焦没收到 pointerup/cancel，先拆掉再加，避免监听叠加。
    cleanupScroll?.()
    event.preventDefault()
    const win = el.ownerDocument.defaultView
    if (!win) return
    const rect = scrollbar.getBoundingClientRect()
    const captureTarget = scrollbar
    let captured = false
    try {
      if (captureTarget.setPointerCapture && event.pointerId != null) {
        captureTarget.setPointerCapture(event.pointerId)
        captured = true
      }
    } catch { captured = false }

    const thumbWidth = current.thumbWidth || 28
    const apply = (clientX) => {
      const span = Math.max(1, rect.width - thumbWidth)
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left - thumbWidth / 2) / span))
      if (handlers.onScrollRatio) handlers.onScrollRatio(ratio)
    }
    apply(event.clientX)
    const onMove = (moveEvent) => apply(moveEvent.clientX)
    const detach = () => {
      if (captured) {
        try { captureTarget.releasePointerCapture(event.pointerId) } catch { /* 已自动释放 */ }
        captured = false
      }
      win.removeEventListener('pointermove', onMove, true)
      win.removeEventListener('pointerup', onUp, true)
      win.removeEventListener('pointercancel', onUp, true)
      cleanupScroll = null
    }
    const onUp = () => detach()
    win.addEventListener('pointermove', onMove, true)
    win.addEventListener('pointerup', onUp, true)
    win.addEventListener('pointercancel', onUp, true)
    cleanupScroll = () => detach()
  })

  function update(state = {}) {
    if (!state.open) {
      mountNode(host, el, false)
      return
    }
    current = state
    applyStyle(el, state.style)
    el.classList.toggle('is-visible', true)
    el.classList.toggle('has-left', !!state.hasLeft)
    el.classList.toggle('has-right', !!state.hasRight)
    el.classList.toggle('is-scroll-visible', !!state.scrollVisible)
    el.classList.toggle('is-reordering', !!state.drop)
    el.classList.toggle('is-snapped', !!state.snap)

    const colItems = state.columns || []
    const rowItems = state.rows || []
    const colNodes = rebuild('column', colItems)
    const rowNodes = rebuild('row', rowItems)
    const markSelected = (node, on) => {
      node.classList.toggle('is-selected', on)
      node.setAttribute('aria-pressed', on ? 'true' : 'false')
    }
    colNodes.forEach((entry, i) => {
      const item = colItems[i]
      if (!item) return
      applyStyle(entry.node, { left: `${item.left}px`, width: `${item.width}px` })
      markSelected(entry.node, state.selected?.axis === 'column' && state.selected.index === item.index)
    })
    rowNodes.forEach((entry, i) => {
      const item = rowItems[i]
      if (!item) return
      applyStyle(entry.node, { top: `${item.top}px`, height: `${item.height}px` })
      markSelected(entry.node, state.selected?.axis === 'row' && state.selected.index === item.index)
    })
    scrollbar.setAttribute('tabindex', state.scrollVisible ? '0' : '-1')
    scrollbar.setAttribute('aria-hidden', state.scrollVisible ? 'false' : 'true')
    scrollbar.setAttribute('aria-valuenow', String(Math.round((state.scrollRatio || 0) * 100)))
    syncChildren(selectorLayer, [...colNodes, ...rowNodes].map((entry) => ({ node: entry.node, on: true })))

    applyStyle(thumb, { left: `${state.thumbLeft || 0}px`, width: `${state.thumbWidth || 0}px` })

    if (state.drop) {
      dropLine.className = `lark-doc-table-drop-line is-${state.drop.axis}`
      applyStyle(dropLine, state.drop.axis === 'column'
        ? { left: `${state.drop.offset}px`, top: '', width: '', height: '' }
        : { top: `${state.drop.offset}px`, left: '', width: '', height: '' })
      applyStyle(snap, { left: `${state.drop.snapLeft ?? state.drop.offset}px`, top: `${state.drop.snapTop ?? 0}px` })
    }
    if (state.card) {
      applyStyle(dragCard, { left: `${state.card.x}px`, top: `${state.card.y}px` })
      const head = state.card.axis === 'column' ? '移动整列' : '移动整行'
      if (cardHead.textContent !== head) cardHead.textContent = head
      if (cardBody.textContent !== state.card.text) cardBody.textContent = state.card.text
    }
    mountNode(host, el, true)
  }

  return {
    el,
    update,
    destroy() {
      cleanupDrag?.()
      cleanupScroll?.()
      if (el.parentNode) el.parentNode.removeChild(el)
    },
  }
}
