/**
 * 表格交互 —— 几何域：把 DOM 实测 rel 到 wrapper，算成 overlay 的 state。
 *
 * 全部用 viewport 坐标 + `position: fixed`：表格可能在任意滚动容器里，相对 paper 的
 * offset 会随滚动漂移。列的宽度优先读 `colgroup > col`；WebKit 上 col 可能没有布局盒，
 * 那时用真实单元格边界还原逻辑列（colspan 不能当成一列）。
 */
import { CellSelection, TableMap, selectedRect } from '@tiptap/pm/tables'

const MIN_THUMB = 28

export const tableOverlayMethods = {
  syncTableResizeGuide() {
    const root = this.$refs.root
    if (!root) return
    const dragging = root.querySelectorAll('.ProseMirror .column-resize-dragging')
    let guide = this._tableResizeGuideEl
    if (!dragging.length) {
      if (guide) guide.style.display = 'none'
      return
    }
    if (!guide || !guide.isConnected) {
      const doc = root.ownerDocument
      guide = doc.createElement('div')
      guide.className = 'lark-doc-table-resize-guide'
      guide.setAttribute('aria-hidden', 'true')
      root.appendChild(guide)
      this._tableResizeGuideEl = guide
    }
    let right = null
    let top = Infinity
    let bottom = -Infinity
    dragging.forEach((cell) => {
      const r = cell.getBoundingClientRect()
      right = r.right
      if (r.top < top) top = r.top
      if (r.bottom > bottom) bottom = r.bottom
    })
    if (right == null || !Number.isFinite(top) || !Number.isFinite(bottom)) return
    guide.style.display = 'block'
    guide.style.left = `${Math.round(right) - 1}px`
    guide.style.top = `${Math.round(top)}px`
    guide.style.height = `${Math.max(1, Math.round(bottom - top))}px`
  },

  fireTableResizeMouse(type, x, y, target) {
    const win = this._tableUiWindow
    if (!win || !Number.isFinite(x) || !Number.isFinite(y)) return null
    const event = new win.MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: win,
      detail: 1,
      clientX: x,
      clientY: y,
      button: 0,
      buttons: type === 'mouseup' ? 0 : 1,
    })
    try { Object.defineProperty(event, 'which', { value: 1 }) } catch (err) { /* 只读实现下交给引擎 */ }
    const host = target || win
    host.dispatchEvent(event)
    return event
  },

  tableOverlayWrapper() {
    const editor = this.editor
    if (!editor?.view?.dom) return null
    let table = this.activeTableElement?.()
    if (!table && this._tableOverlayHover?.isConnected) {
      table = this._tableOverlayHover.querySelector('table')
    }
    if (!table || !table.isConnected) return null
    return table.closest('.tableWrapper') || null
  },

  refreshTableOverlays() {
    const ui = this._tableOverlaysUi
    if (!ui) return
    // 选区不再是 CellSelection（点回正文、删完行列、光标进单元格）时清掉选中高亮，
    // 否则 overlay 会一直画着蓝色选择条，Delete 判定也会失去真实选区依据。
    // v12 加强：selection 仍是 CellSelection、但真实 rect 已不匹配 `tableSelectedLine`
    // 时也要清 —— 用户先点选择条再**拖选其他单元格**，选区变了而标记残留，
    // 浮窗形态 / 锚点 / 删除目标全都会按旧标记走（「按钮不对」「删了相邻列」的根因之一）。
    if (this.tableSelectedLine) {
      const sel = this.editor?.state?.selection
      let stillLine = false
      if (sel instanceof CellSelection) {
        try {
          const rect = selectedRect(this.editor.state)
          const { map } = rect
          const l = this.tableSelectedLine
          const start = l.from ?? Math.min(l.index, l.endIndex ?? l.index)
          const end = l.to ?? Math.max(l.index, l.endIndex ?? l.index) + 1
          stillLine = l.axis === 'column'
            ? rect.top === 0 && rect.bottom === map.height && rect.left === start && rect.right === end
            : rect.left === 0 && rect.right === map.width && rect.top === start && rect.bottom === end
        } catch { stillLine = false }
      }
      if (!stillLine) this.tableSelectedLine = null
    }
    // 活跃闸门：光标在表格内只是「候选」，还要指针在表格邻域 / 正在键盘操作 /
    // 拖拽中 / 未主动 Escape。否则点过一次表格后浮层会永久挂着（与 WorkBuddy
    // 「hover 表格块才浮出」的语义不符）。拖拽与列宽拖拽期间必须强制保留。
    if (!this.tableUiActive()) {
      ui.update({ open: false })
      return
    }
    const wrapper = this.tableOverlayWrapper()
    if (!wrapper || this.effectiveReadonly || !this.featureEnabled('tables')) {
      ui.update({ open: false })
      return
    }
    const rect = wrapper.getBoundingClientRect()
    if (!rect.width || !rect.height) {
      ui.update({ open: false })
      return
    }
    const table = wrapper.querySelector('table')
    if (!table) {
      ui.update({ open: false })
      return
    }
    const columnElements = Array.from(table.querySelectorAll('colgroup > col')).filter(col => col.closest('table') === table)
    const rowEls = Array.from(table.querySelectorAll('tr')).filter(row => row.closest('table') === table)
    const viewWidth = wrapper.clientWidth
    const scrollWidth = wrapper.scrollWidth
    const scrollLeft = wrapper.scrollLeft
    const overflow = Math.max(0, scrollWidth - viewWidth)
    const thumbWidth = overflow > 0
      ? Math.max(MIN_THUMB, Math.round((viewWidth / scrollWidth) * viewWidth))
      : viewWidth
    const thumbLeft = overflow > 0
      ? Math.round((scrollLeft / overflow) * (viewWidth - thumbWidth))
      : 0

    let columns = columnElements.map((cell, index) => {
      const cellRect = cell.getBoundingClientRect()
      return { index, left: cellRect.left - rect.left, width: cellRect.width }
    })
    const found = this.tableOverlayTablePos(table), map = found && TableMap.get(found.node)
    const tableRect = table.getBoundingClientRect()
    const validColumns = map && columns.length === map.width && columns.every(item => Number.isFinite(item.left) && Number.isFinite(item.width) && item.width > 0)
      && Math.abs(columns[0].left - (tableRect.left - rect.left)) < 2
    if (!validColumns && map) {
      // WebKit 的 col 可能没有可用布局盒。用真实单元格边界还原逻辑列，不能把 colspan 当成一列。
      const edges = new Array(map.width + 1)
      const weights = Array.from({ length: map.width }, (_, i) => {
        const value = parseFloat(columnElements[i]?.style.width)
        return Number.isFinite(value) && value > 0 ? value : 0
      })
      for (const offset of new Set(map.map)) {
        const cell = this.editor.view.nodeDOM(found.pos + 1 + offset)
        if (!(cell instanceof Element) || cell.closest('table') !== table) continue
        const bounds = cell.getBoundingClientRect()
        if (!Number.isFinite(bounds.left) || !Number.isFinite(bounds.width) || bounds.width <= 0) continue
        const span = map.findCell(offset), node = found.node.nodeAt(offset)
        edges[span.left] = bounds.left - rect.left
        edges[span.right] = bounds.right - rect.left
        for (let column = span.left; column < span.right; column++) {
          const value = Number(node.attrs.colwidth?.[column - span.left])
          if (!weights[column] && Number.isFinite(value) && value > 0) weights[column] = value
        }
      }
      // 所有真实边界收齐后，只在相邻已知边界之间补未知跨度，估算值不覆盖真实边界。
      for (let start = 0; start < map.width;) {
        if (!Number.isFinite(edges[start])) { start++; continue }
        let end = start + 1
        while (end <= map.width && !Number.isFinite(edges[end])) end++
        if (end > map.width) break
        const width = edges[end] - edges[start], segment = weights.slice(start, end)
        const known = segment.reduce((sum, value) => sum + value, 0), missing = segment.filter(value => !value).length
        const fallback = missing ? Math.max(1, (width - known) / missing) : 1
        const widths = segment.map(value => value || fallback), total = widths.reduce((sum, value) => sum + value, 0)
        let left = edges[start]
        for (let column = start; column < end - 1; column++) {
          left += width * widths[column - start] / total
          edges[column + 1] = left
        }
        start = end
      }
      columns = Array.from({ length: map.width }, (_, index) => ({ index, left: edges[index], width: edges[index + 1] - edges[index] }))
        .filter(item => Number.isFinite(item.left) && Number.isFinite(item.width) && item.width > 0)
    }
    const rows = rowEls.map((row, index) => {
      const rowRect = row.getBoundingClientRect()
      return { index, top: rowRect.top - rect.top, height: rowRect.height }
    })
    // 只渲染与可视区相交的选择条，并把超出部分裁到边界内。
    const visibleColumns = columns
      .filter((item) => item.left + item.width > 0 && item.left < viewWidth)
      .map((item) => ({
        index: item.index,
        left: Math.max(0, item.left),
        width: Math.min(viewWidth, item.left + item.width) - Math.max(0, item.left),
      }))
    const visibleRows = rows
      .filter((item) => item.top + item.height > 0 && item.top < rect.height)
      .map((item) => ({ ...item }))

    const reorder = this._tableReorder
    let drop = null
    let card = null
    if (reorder) {
      const line = reorder.axis === 'column'
        ? visibleColumns.find((item) => item.index === reorder.to)
        : visibleRows.find((item) => item.index === reorder.to)
      const items = reorder.axis === 'column' ? columns : rows
      const raw = items.find((item) => item.index === reorder.to)
      if (raw) {
        const after = reorder.to > reorder.from
        const offset = reorder.axis === 'column'
          ? (after ? raw.left + raw.width : raw.left)
          : (after ? raw.top + raw.height : raw.top)
        drop = {
          axis: reorder.axis,
          offset,
          snapLeft: Math.max(0, Math.min(viewWidth - 3, offset)),
          snapTop: reorder.axis === 'column' ? 0 : Math.max(0, offset - 5),
        }
      }
      card = {
        x: Math.max(0, Math.min(viewWidth - 120, reorder.x - rect.left + 12)),
        y: Math.max(-24, reorder.y - rect.top + 12),
        text: line
          ? (reorder.axis === 'column'
            ? `第 ${reorder.from + 1} 列 → 第 ${reorder.to + 1} 列`
            : `第 ${reorder.from + 1} 行 → 第 ${reorder.to + 1} 行`)
          : '移动到此处',
        axis: reorder.axis,
      }
    }

    // 选择条点击闸门（v6）：高亮块只在「点过表格」后才画。键盘模式（Tab 到选择条）
    // 与已有整行整列 CellSelection（点完选择条后指针移开、或键盘 Shift+方向选区）
    // 必须放行，否则选择条消失后重排 / Delete 判定失去交互入口。
    const showSelectors = this._tableUiClicked === true || this._tableUiKeyboardMode === true
      || this.tableSelectedLine != null
      || this.editor?.state?.selection instanceof CellSelection

    ui.update({
      open: true,
      tableKey: wrapper,
      documentKey: this.editor.state.doc,
      style: {
        position: 'fixed',
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      },
      hasLeft: overflow > 0 && scrollLeft > 1,
      hasRight: overflow > 0 && scrollLeft < overflow - 1,
      scrollVisible: overflow > 1,
      thumbLeft,
      thumbWidth,
      scrollRatio: overflow > 0 ? scrollLeft / overflow : 0,
      columns: showSelectors ? visibleColumns : [],
      rows: showSelectors ? visibleRows : [],
      selected: this.tableSelectedLine,
      drop,
      snap: !!drop,
      card,
    })
  },

  tableOverlayTablePos(targetTable) {
    const editor = this.editor
    if (!editor) return null
    if (!targetTable) {
      const $from = editor.state.selection.$from
      for (let depth = $from.depth; depth > 0; depth -= 1) {
        if ($from.node(depth).type.name === 'table') {
          return { pos: $from.before(depth), node: $from.node(depth) }
        }
      }
    }
    // hover 但光标不在表内：从 DOM 反查 pos。
    const table = targetTable || this._tableOverlayHover?.querySelector('table')
    if (!table) return null
    try {
      const pos = editor.view.posAtDOM(table, 0)
      const $pos = editor.state.doc.resolve(pos)
      for (let depth = $pos.depth; depth > 0; depth -= 1) {
        if ($pos.node(depth).type.name === 'table') return { pos: $pos.before(depth), node: $pos.node(depth) }
      }
    } catch { /* DOM 与 state 短暂不同步，放弃本次操作即可 */ }
    return null
  },

  onTableScrollRatio(ratio) {
    const wrapper = this.tableOverlayWrapper()
    if (!wrapper) return
    const overflow = wrapper.scrollWidth - wrapper.clientWidth
    if (overflow <= 0) return
    wrapper.scrollLeft = ratio * overflow
    this.refreshTableOverlays()
  },
}
