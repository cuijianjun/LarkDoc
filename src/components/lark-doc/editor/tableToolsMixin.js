/**
 * tableToolsMixin — 表格工具条、表格边界高亮、行列插入/删除等表格操作与列宽拖拽。
 * 通过 this.editor、this.writable()、this.run()、this.$refs.root 与主组件协作；
 * selectionPacingMixin 的 onSelectionUpdate 与主组件的 onDocumentScroll 会调用 updateTableBoundary/clearTableBoundaryHover。
 * 采用 mixin 而非子组件：表格边界 overlay 与工具条模板留在主 SFC，依赖 Vue 2 选项合并语义。
 */
import { closeHistory } from '@tiptap/pm/history'
import { selectedRect } from '@tiptap/pm/tables'
import { TextSelection } from '@tiptap/pm/state'
import { tableActions } from './constants'

export default {
  data() { return {
    tableToolsOpen: false, tablePicker: false, tablePickerHover: { rows: 3, cols: 3 },
    // v4（WorkBuddy `nearestIdx` 1:1）：一条**内部**边线 = 一颗 ＋。`actionId` 由最近的
    // 内部边线决定（统一 `addColumnAfter` / `addRowAfter`，光标落在边线左/上侧单元格）。
    // `plusActive` 只在 ＋ 被 hover / focus 时为真 —— hover line 仅在此时挂进 DOM
    // （真源 `Ee && ye` / `_e &&`）。线长由 `tableToolsUiMixin` 按表格内部尺寸算，
    // 严格不越过表格。表格最左 / 最上**外边缘**不产生 ＋。
    // `columnSide` / `rowSide` 双按钮语义已废除。
    tableBoundary: { visible: false, hover: null, actionId: 'addColumnAfter', plusActive: false, rowIndex: -1, columnIndex: -1, rowSpan: 1, columnSpan: 1, cellPosition: null, style: { top: '0px', left: '0px', width: '0px', height: '0px' }, columnLineLeft: 0, rowLineTop: 0, plusUp: 28, plusDown: 20 },
    tableActions,
  } },
  computed: {
    visibleTableActions() { return this.larkDocConfig.features.tables ? this.tableActions : [] },
    tableHeaderState() {
      if (!this.editor || !this.editor.isActive('table')) return { row: false, column: false }
      const table = this.activeTableNode()
      if (!table || !table.childCount) return { row: false, column: false }
      const row = table.child(0)
      const rowHeader = row.childCount > 0 && Array.from({ length: row.childCount }, (_, index) => row.child(index).type.name === 'tableHeader').every(Boolean)
      const columnHeader = Array.from({ length: table.childCount }, (_, index) => {
        const current = table.child(index)
        return current.childCount > 0 && current.child(0).type.name === 'tableHeader'
      }).every(Boolean)
      return { row: rowHeader, column: columnHeader }
    },
  },
  mounted() {
    // 首屏没有事务，溢出态得自己量一次（rAF 那一发兜「字体晚到导致宽了一帧」）。
    this.$nextTick(() => {
      this.syncTableClip()
      requestAnimationFrame(() => this.syncTableClip())
    })
    // 窗口变宽后原本溢出的表格不再溢出，得把 is-clipped 摘掉。
    window.addEventListener('resize', this.syncTableClip)
  },
  beforeDestroy() { window.removeEventListener('resize', this.syncTableClip) },
  methods: {
    // P0-03：工具栏表格按钮的三态行为收敛为方法——拆出的子组件模板经 ed. 调用，避免 vue/no-mutating-props。
    onTableToolbarClick() {
      if (!this.writable() || !this.featureEnabled('tables')) return
      if (!this.isActive('table')) return this.insertTable()
      if (this.blockMenuOpen && this.handleIsTable) return this.closeBlockMenu()
      this.positionBlockHandle(this.currentBlockRange())
      this.openBlockMenu()
    },
    previewTableSize(rows, cols) { if (!this.tablePicker) return; this.tablePickerHover = { rows, cols } },
    insertTable(rows = 2, cols = 3) { if (!this.writable() || !this.featureEnabled('tables')) return false; this.tablePicker = false; this.tablePickerHover = { rows: 2, cols: 3 }; const inserted = this.run('insertLarkDocTable', { rows, cols }); this.$nextTick(() => this.updateTableBoundary()); return inserted },
    activeTableElement() {
      if (!this.editor || !this.editor.isActive('table')) return null
      const { $from } = this.editor.state.selection
      for (let depth = $from.depth; depth > 0; depth -= 1) {
        if ($from.node(depth).type.name !== 'table') continue
        const element = this.editor.view.nodeDOM($from.before(depth))
        return element instanceof HTMLElement ? element : null
      }
      return null
    },
    /**
     * 边界几何专用：自定义 table nodeview 的 `nodeDOM()` 返回的是 `.tableWrapper`
     * 容器，宽度 = 纸张内容区（可远大于内部 <table> 的实际宽度）。用户实测
     * 「高亮线超过表格」正是把 wrapper 宽当成了表格宽，横线一路画到纸外。
     * ＋ / hover line / 热区必须全部对齐**内部 <table>** 的 rect。
     */
    /**
     * 纯 hover（还没点进表格）时按指针位置反查内部 <table>。选区在表格外的正文里，
     * `activeTableElement()` 返回 null，旧实现会让 ＋ / hover line 完全不出现；而用户
     * 口径是「鼠标悬浮在两个单元格交接处，交界处就要高亮并且有 + 号」，与光标位置无关。
     * column-resize-handle / overlay 可能盖在表格上方，所以命中不到 table 时再按 rect 兜底。
     */
    tableVisibleHorizontalBounds(table) {
      const rect = table.getBoundingClientRect()
      const wrapper = table.closest('.tableWrapper')
      const view = wrapper?.getBoundingClientRect()
      const left = Math.max(0, rect.left, view ? view.left + wrapper.clientLeft : rect.left)
      const right = Math.min(window.innerWidth || Infinity, rect.right, view ? view.left + wrapper.clientLeft + (wrapper.clientWidth || view.width) : rect.right)
      return { left, right: Math.max(left, right) }
    },
    tableRectElementAtPoint(event) {
      const x = event?.clientX
      const y = event?.clientY
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null
      const root = this.$refs.root
      const doc = root?.ownerDocument
      if (!doc) return null
      const hit = doc.elementFromPoint(x, y)
      const table = hit?.closest?.('table')
      if (table && root.contains(table)) return table
      const pad = 44
      for (const candidate of root.querySelectorAll('.ProseMirror table')) {
        const r = candidate.getBoundingClientRect()
        const visible = this.tableVisibleHorizontalBounds(candidate)
        if (x >= visible.left - pad && x <= visible.right + pad && y >= r.top - pad && y <= r.bottom + pad) return candidate
      }
      return null
    },
    activeTableRectElement(event) {
      if (event) return this.tableRectElementAtPoint(event)
      if (this.tableBoundary.hover && this._tableBoundaryHoverTable && this.$refs.root?.contains(this._tableBoundaryHoverTable)) return this._tableBoundaryHoverTable
      const el = this.activeTableElement()
      if (el) {
        const table = (typeof HTMLTableElement !== 'undefined' && el instanceof HTMLTableElement)
          ? el : (el.querySelector?.('table') || el)
        if (table) return table
      }
      // 选区不在表格内：用当前指针所在表格（或上一次 hover 的表格）保持几何，
      // 否则 `updateTableBoundary()` 会把 visible 收成 false。
      return this._tableBoundaryHoverTable || null
    },
    updateTableBoundary(table = this.activeTableRectElement()) {
      if (!this.writable()) { this.tableBoundary.visible = false; return }
      const paper = this.$refs.root?.querySelector('.lark-doc-paper')
      if (!table || !paper) { this.tableBoundary.visible = false; return }
      const tableRect = table.getBoundingClientRect()
      const visible = this.tableVisibleHorizontalBounds(table)
      if (tableRect.width < 1 || tableRect.height < 1) {
        this.tableBoundary.visible = false
        if (!this._tableBoundaryRetry) {
          this._tableBoundaryRetry = true
          requestAnimationFrame(() => { this._tableBoundaryRetry = false; this.updateTableBoundary() })
        }
        return
      }
      // 边界 ＋ 是 fixed 浮层，不受宿主 overflow 裁切，但仍必须落在视口内。
      // 28px 让 32px 热区刚好避开 12px 列选择条；20px 避开 14px 自绘滚动条。
      // 余量不足时允许取负值：＋ 顺着表格边线回退到视口内。表格本身比视口高、
      // 或增删行列把表格撑高时，若把下限锁死在 0，下方 ＋ 会整个落到视口外，
      // elementsFromPoint 拿不到元素、按钮也就点不到（真实可复现）。
      // 12px = 18px 圆点半高 9px + 3px 安全余量，上下两侧共用。
      const viewportH = window.innerHeight || document.documentElement.clientHeight || 0
      const edge = 12
      const plusUp = viewportH ? Math.min(28, tableRect.top - edge) : 28
      const plusDown = viewportH ? Math.min(20, viewportH - tableRect.bottom - edge) : 20
      const domAtSelection = this.editor.view.domAtPos(this.editor.state.selection.from).node
      const selectionElement = domAtSelection?.nodeType === 1 ? domAtSelection : domAtSelection?.parentElement
      const cell = selectionElement?.closest?.('td,th')
      const cellRect = cell?.getBoundingClientRect?.()
      const prev = this.tableBoundary
      // hover 已选中某条内部边线时，表格几何刷新（transaction / scroll 会反复调这里）
      // 不能把边线位置覆盖成「当前单元格中心」，否则 ＋ 会跳回列中央。
      const keepLine = !!prev.hover
      const hoveredCell = this._tableBoundaryHoverCell
      const liveRect = hoveredCell && table.contains(hoveredCell) ? hoveredCell.getBoundingClientRect() : null
      const hover = keepLine && hoveredCell && (!liveRect?.width || !liveRect.height) ? null : prev.hover
      let cellPosition = prev.cellPosition
      if (hover && liveRect) {
        const paragraph = hoveredCell.querySelector('p,h1,h2,h3,h4,h5,h6,h7,h8,h9,pre')
        try { cellPosition = this.editor.view.posAtDOM(paragraph || hoveredCell, 0) } catch { cellPosition = null }
      }
      this.tableBoundary = {
        ...prev,
        hover,
        cellPosition,
        ...(hover && liveRect ? {
          rowIndex: Array.from(table.querySelectorAll('tr')).indexOf(hoveredCell.parentElement),
          columnIndex: hoveredCell.cellIndex,
          rowSpan: Math.max(1, hoveredCell.rowSpan || 1),
          columnSpan: Math.max(1, hoveredCell.colSpan || 1),
        } : {}),
        visible: true,
        // 边界条根节点是 fixed 浮层（与 .lark-doc-table-overlay 同层），坐标必须是
        // viewport 值。旧写法减掉 paperRect 是给 absolute 用的：宿主固定高度 +
        // overflow:hidden 时表格下方的 ＋ 会被裁掉，滚动后还会与表格错位。
        style: {
          top: `${tableRect.top}px`,
          left: `${tableRect.left}px`,
          width: `${tableRect.width}px`,
          height: `${tableRect.height}px`,
        },
        columnLineLeft: keepLine ? (liveRect ? liveRect.right - tableRect.left : prev.columnLineLeft)
          : (cellRect ? cellRect.left - tableRect.left + cellRect.width / 2 : tableRect.width / 2),
        rowLineTop: keepLine ? (liveRect ? liveRect.bottom - tableRect.top : prev.rowLineTop)
          : (cellRect ? cellRect.top - tableRect.top + cellRect.height / 2 : tableRect.height / 2),
        plusUp,
        plusDown,
        rowLineLeft: visible.left - tableRect.left,
        rowLineLength: visible.right - visible.left,
      }
    },
    clearTableBoundaryHover() {
      this._tableBoundaryHoverCell = null
      const boundary = this.tableBoundary
      // 整体替换触发 `tableBoundary` 的 deep watch，让 hover line 与 ＋ 一起收起。
      if (boundary.hover || boundary.plusActive) this.tableBoundary = { ...boundary, hover: null, plusActive: false }
    },
    keepTableBoundaryHover() {
      // 纯 hover 出来的 ＋，鼠标移到按钮上时选区仍在表格外；不能因此把 hover 清掉，
      // 否则按钮在能被点到之前就自己消失了。
      if (this.writable() && (this.editor?.isActive('table') || this._tableBoundaryHoverTable)) return
      this.clearTableBoundaryHover()
    },
    /**
     * v4 / WorkBuddy `nearestIdx` 单选模型（1:1）：
     * - 候选边线只取**内部**边线：单元格的右边界（列 ＋）/ 下边界（行 ＋）。
     *   表格最左 / 最上**外边缘**不是任何单元格的右 / 下边界，天然不产生 ＋
     *   —— 用户实测「最左边、最上面悬浮上去是没有 + 号的」。
     * - 一条边线只对应一颗 ＋：列 ＋ 固定在表格上方、行 ＋ 固定在表格左侧
     *   （真源 `.sc-table-col-plus-zone{top:-28px}` / `.sc-table-row-plus-zone{left:-14px}`）。
     * - 插入动作统一 `addColumnAfter` / `addRowAfter`：把光标落到「产生这条边线」
     *   的那个单元格，Tiptap 就正好在这条边线上插入，不需要 before/after 双按钮。
     */
    updateTableBoundaryHover(event) {
      // 不再要求 `editor.isActive('table')`：那是「光标在表格内」，而用户是在**纯 hover**
      // 状态下悬浮单元格交界处，光标可能还在表格外的正文里（反馈⑦）。
      if (!this.writable() || !this.featureEnabled('tables')) { this.clearTableBoundaryHover(); return }
      // 指针已经移到 ＋ / hover line 上时保持当前状态：重算会按 viewport 坐标把
      // 表格外侧的按钮判成「离开表格」，把刚要点的 ＋ 自己清掉。
      if (event.target?.closest?.('.lark-doc-table-boundary-tools')) return
      const table = this.activeTableRectElement(event)
      if (!table) { this.clearTableBoundaryHover(); return }
      this._tableBoundaryHoverTable = table
      const tableRect = table.getBoundingClientRect()
      if (!tableRect.width || !tableRect.height) { this.clearTableBoundaryHover(); return }
      // 纯 hover 时没有 selection 事务来跑 `updateTableBoundary()`，visible / style
      // 会是上一次（或初始 false）的值。几何不匹配就补算一次，让边界层真正挂出来。
      const current = this.tableBoundary
      const top = Number.parseFloat(current.style?.top)
      const left = Number.parseFloat(current.style?.left)
      const width = Number.parseFloat(current.style?.width)
      const height = Number.parseFloat(current.style?.height)
      if (!current.visible || !Number.isFinite(width) || !Number.isFinite(height)
        || Math.abs(width - tableRect.width) > 1 || Math.abs(height - tableRect.height) > 1
        || Math.abs(left - tableRect.left) > 1 || Math.abs(top - tableRect.top) > 1) {
        this.updateTableBoundary(table)
      }
      const x = event.clientX
      const y = event.clientY
      const threshold = 9
      // 44px 覆盖表格上方 -28px 的列 ＋ 与左侧行 ＋ 热区；超出即视为离开表格块。
      const pad = 44
      const visible = this.tableVisibleHorizontalBounds(table)
      if (x < visible.left - pad || x > visible.right + pad
        || y < tableRect.top - pad || y > tableRect.bottom + pad) {
        this.clearTableBoundaryHover()
        return
      }
      // 真源 `.sc-table-col-plus-zone{top:-28px}` / `.sc-table-row-plus-zone{left:-14px}`：
      // 表格上方 / 左侧各有一条 28px 的 ＋ 热区，鼠标从那两条带靠近时也必须出 ＋，
      // 否则 ＋ 只在表格内部边线上出现、用户从表格外侧根本点不到。
      // 上方带只认列线、左侧带只认行线，避免在表格外空白同时算出两条线。
      const above = y < tableRect.top
      const leftOf = x < tableRect.left
      const inVerticalBand = y >= tableRect.top - 28 && y <= tableRect.bottom + threshold
      const inHorizontalBand = x >= visible.left - 28 && x <= visible.right + threshold
      let colLine = null
      let rowLine = null
      // 真源 bundle 里确实还有 `is-leftmost` / `is-topmost` 两个特殊 zone，但用户对照
      // 截图明确指出「最左边、最上面悬浮上去是没有 + 号的」，且 `h$18()` 的内部边线
      // 选择本身也跳过 `leftColIndex < 0`。以可见交互为准：**不把表格最左 / 最上
      // 外边缘当候选边线**，只收单元格的右 / 下边界。要在首列左侧 / 首行上方插入，
      // 走表格工具条的「左侧加列 / 上方加行」。
      table.querySelectorAll('td,th').forEach((candidate) => {
        const r = candidate.getBoundingClientRect()
        if (!r.width || !r.height) return
        if (!leftOf && inVerticalBand) {
          const dist = Math.abs(x - r.right)
          if (dist <= threshold && (!colLine || dist < colLine.dist)) {
            colLine = { dist, pos: r.right - tableRect.left, cell: candidate }
          }
        }
        if (!above && inHorizontalBand) {
          const dist = Math.abs(y - r.bottom)
          if (dist <= threshold && (!rowLine || dist < rowLine.dist)) {
            rowLine = { dist, pos: r.bottom - tableRect.top, cell: candidate }
          }
        }
      })
      // 等距时列优先（与旧实现 `verticalDistance <= horizontalDistance` 一致）。
      const useColumn = !!(colLine && (!rowLine || colLine.dist <= rowLine.dist))
      const line = useColumn ? colLine : rowLine
      if (!line) { this.clearTableBoundaryHover(); return }
      const cell = line.cell
      this._tableBoundaryHoverCell = cell
      const paragraph = cell.querySelector('p')
      let cellPosition = null
      if (paragraph) {
        try { cellPosition = this.editor.view.posAtDOM(paragraph, 0) } catch { cellPosition = null }
      }
      const row = cell.parentElement
      const rowIndex = row ? Array.from(table.querySelectorAll('tr')).indexOf(row) : -1
      const columnIndex = Number.isInteger(cell.cellIndex) ? cell.cellIndex : -1
      const prev = this.tableBoundary
      this.tableBoundary = {
        ...prev,
        hover: useColumn ? 'column' : 'row',
        actionId: line.actionId || (useColumn ? 'addColumnAfter' : 'addRowAfter'),
        rowIndex,
        columnIndex,
        rowSpan: Math.max(1, cell.rowSpan || 1),
        columnSpan: Math.max(1, cell.colSpan || 1),
        cellPosition,
        columnLineLeft: useColumn ? line.pos : prev.columnLineLeft,
        rowLineTop: useColumn ? prev.rowLineTop : line.pos,
      }
    },
    tableBoundaryAction(id) {
      if (!this.writable()) return
      const boundary = { ...this.tableBoundary }
      if (Number.isInteger(boundary.cellPosition)) this.editor.commands.setTextSelection(boundary.cellPosition)
      if (!this.editor.isActive('table')) return
      const rect = selectedRect(this.editor.state)
      // Resolve logical coordinates after restoring the live cell. DOM cellIndex
      // excludes cells spanning from earlier rows and cannot locate the new cell.
      Object.assign(boundary, { rowIndex: rect.top, columnIndex: rect.left, rowSpan: rect.bottom - rect.top, columnSpan: rect.right - rect.left })
      this.clearTableBoundaryHover()
      // 行/列操作要和相邻的表格变更分开记录，确保每次点击都对应一次撤销。
      this.editor.view.dispatch(closeHistory(this.editor.state.tr))
      this.tableAction(id)
      // Close the structural transaction after it is applied as well, so text typed
      // into the newly created cell starts its own undo group.
      this.editor.view.dispatch(closeHistory(this.editor.state.tr))
      this.$nextTick(() => {
        this.focusTableBoundaryCell(id, boundary)
        this.updateTableBoundary()
      })
    },
    focusTableBoundaryCell(id, boundary) {
      if (!this.writable() || !boundary || boundary.rowIndex < 0 || boundary.columnIndex < 0) return
      if (!this.editor.isActive('table')) return
      const state = this.editor.state
      const { table, tableStart, map } = selectedRect(state)
      const rowOffset = id === 'addRowAfter' ? boundary.rowSpan : 0
      const columnOffset = id === 'addColumnAfter' ? boundary.columnSpan : 0
      const row = boundary.rowIndex + rowOffset
      const column = boundary.columnIndex + columnOffset
      if (row >= map.height || column >= map.width) return
      const position = tableStart + map.positionAt(row, column, table) + 1
      this.editor.view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(position))))
    },
    tableAction(id) {
      if (!this.writable() || !this.featureEnabled('tables')) return
      if (['addRowBefore', 'addRowAfter', 'deleteRow', 'addColumnBefore', 'addColumnAfter', 'deleteColumn', 'mergeCells', 'splitCell', 'toggleHeaderRow', 'toggleHeaderColumn', 'clearCellContent', 'distributeColumns', 'deleteTable'].includes(id)) this.editor.view.dispatch(closeHistory(this.editor.state.tr))
      const rect = this.editor.isActive('table') ? selectedRect(this.editor.state) : null
      if (id === 'clearCellContent') this.clearCellContent()
      else if (id === 'distributeColumns') this.distributeColumns()
      else if (id === 'deleteRow' && (this.activeTableNode()?.childCount <= 1 || (rect && rect.top === 0 && rect.bottom === rect.map.height))) this.deleteActiveTable()
      else if (id === 'deleteColumn' && (rect?.map.width <= 1 || (rect && rect.left === 0 && rect.right === rect.map.width))) this.deleteActiveTable()
      else this.run(id)
      if (id === 'deleteTable') { this.tableToolsOpen = false; this.tableBoundary.visible = false }
      this.$nextTick(() => this.updateTableBoundary())
    },
    activeTableNode() {
      if (!this.editor || !this.editor.isActive('table')) return null
      const { $from } = this.editor.state.selection
      for (let depth = $from.depth; depth > 0; depth -= 1) if ($from.node(depth).type.name === 'table') return $from.node(depth)
      return null
    },
    /**
     * P5-01：表格超宽是**裁切**不是滚动（02 §10 ⑦-5 / A20 定判），右端渐隐由 CSS 画。
     * 渐隐只在真溢出时才挂：`overflow-x: hidden` 下 CSS 无从判断溢出，必须量
     * `scrollWidth > clientWidth`（hidden 不影响 scrollWidth 反映内容宽）。
     * 直接改 wrapper 的 class 而不进文档 —— 这是纯视觉态，落进 JSON 就是脏数据。
     * 列宽拖拽结束会 dispatch 事务，所以挂 onTransaction 就够，不用另监听 pointerup。
     */
    syncTableClip() {
      const editorDom = this.editor && this.editor.view && this.editor.view.dom
      if (!editorDom || typeof editorDom.querySelectorAll !== 'function') return
      editorDom.querySelectorAll('.tableWrapper').forEach((wrapper) => {
        const clipped = wrapper.scrollWidth > wrapper.clientWidth + 1
        if (clipped === wrapper.classList.contains('is-clipped')) return
        wrapper.classList.toggle('is-clipped', clipped)
      })
    },
    deleteActiveTable() {
      if (!this.writable() || !this.editor.isActive('table')) return false
      const { $from } = this.editor.state.selection
      for (let depth = $from.depth; depth > 0; depth -= 1) {
        if ($from.node(depth).type.name !== 'table') continue
        const deleted = this.deleteBlockRange({ from: $from.before(depth), to: $from.after(depth) })
        this.tableToolsOpen = false
        this.tableBoundary.visible = false
        return deleted
      }
      return false
    },
    clearCellContent() {
      if (!this.writable() || !this.editor.isActive('table')) return false
      const state = this.editor.state
      const selected = selectedRect(state)
      const cellPositions = selected.map.cellsInRect(selected)
      const paragraph = this.editor.schema.nodes.paragraph?.createAndFill()
      if (!paragraph) return false
      const tr = state.tr
      cellPositions.sort((a, b) => b - a).forEach((cellPos) => {
        const cell = selected.table.nodeAt(cellPos)
        if (!cell || !cell.content.size) return
        const from = selected.tableStart + cellPos + 1
        tr.replaceWith(from, from + cell.content.size, paragraph)
      })
      if (tr.docChanged) this.editor.view.dispatch(tr)
      return tr.docChanged
    },
    distributeColumns() {
      if (!this.writable() || !this.editor.isActive('table')) return false
      const table = this.activeTableNode()
      const selected = selectedRect(this.editor.state)
      if (!table || !selected.map.width) return false
      const tableElement = this.activeTableElement()
      const { map } = selected
      const columns = Array.from(tableElement?.querySelectorAll('colgroup > col') || [])
      const widths = Array.from({ length: map.width }, (_, column) => {
        for (let row = 0; row < map.height; row += 1) {
          const pos = map.map[row * map.width + column]
          const cell = table.nodeAt(pos)
          const value = cell?.attrs.colwidth?.[column - map.findCell(pos).left]
          if (value > 0) return value
        }
        return columns[column]?.getBoundingClientRect().width || (tableElement?.clientWidth || map.width * 120) / map.width
      })
      const width = Math.max(70, Math.round(widths.slice(selected.left, selected.right).reduce((sum, value) => sum + value, 0) / (selected.right - selected.left)))
      const tr = this.editor.state.tr
      const cellPositions = [...new Set(selected.map.map)]
      cellPositions.forEach((cellPos) => {
        const cell = table.nodeAt(cellPos)
        const rect = map.findCell(cellPos)
        if (!cell || rect.right <= selected.left || rect.left >= selected.right) return
        const colwidth = Array.from({ length: cell.attrs.colspan || 1 }, (_, index) => {
          const column = rect.left + index
          return column >= selected.left && column < selected.right ? width : cell.attrs.colwidth?.[index] || widths[column]
        })
        tr.setNodeMarkup(selected.tableStart + cellPos, undefined, { ...cell.attrs, colwidth })
      })
      if (tr.docChanged) this.editor.view.dispatch(tr)
      return tr.docChanged
    },

  },
}
