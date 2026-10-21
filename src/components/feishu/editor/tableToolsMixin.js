/**
 * tableToolsMixin — 表格工具条、表格边界高亮、行列插入/删除等表格操作与列宽拖拽。
 * 通过 this.editor、this.writable()、this.run()、this.$refs.root 与主组件协作；
 * 主组件的 onSelectionUpdate/onDocumentScroll 会调用 updateTableBoundary/clearTableBoundaryHover。
 * 采用 mixin 而非子组件：表格边界 overlay 与工具条模板留在主 SFC，依赖 Vue 2 选项合并语义。
 */
import { closeHistory } from '@tiptap/pm/history'
import { selectedRect } from '@tiptap/pm/tables'
import { tableActions } from './constants'

export default {
  data() { return {
    tableToolsOpen: false, tablePicker: false, tablePickerHover: { rows: 3, cols: 3 },
    tableBoundary: { visible: false, hover: null, columnSide: 'before', rowSide: 'before', rowIndex: -1, columnIndex: -1, rowSpan: 1, columnSpan: 1, cellPosition: null, style: { top: '0px', left: '0px', width: '0px', height: '0px' }, columnLineLeft: 0, rowLineTop: 0 },
    columnResize: null, tableActions,
  } },
  computed: {
    visibleTableActions() { return this.feishuConfig.features.tables ? this.tableActions : [] },
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
  methods: {
    previewTableSize(rows, cols) { if (!this.tablePicker) return; this.tablePickerHover = { rows, cols } },
    insertTable(rows, cols) { if (!this.writable() || !this.featureEnabled('tables')) return; this.tablePicker = false; this.tablePickerHover = { rows: 3, cols: 3 }; this.run('insertTable', { rows, cols, withHeaderRow: false }); this.$nextTick(() => this.updateTableBoundary()) },
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
    updateTableBoundary() {
      if (!this.writable()) { this.tableBoundary.visible = false; return }
      const table = this.activeTableElement()
      const paper = this.$refs.root?.querySelector('.feishu-paper')
      if (!table || !paper) { this.tableBoundary.visible = false; return }
      const tableRect = table.getBoundingClientRect()
      const paperRect = paper.getBoundingClientRect()
      if (tableRect.width < 1 || tableRect.height < 1) {
        this.tableBoundary.visible = false
        if (!this._tableBoundaryRetry) {
          this._tableBoundaryRetry = true
          requestAnimationFrame(() => { this._tableBoundaryRetry = false; this.updateTableBoundary() })
        }
        return
      }
      const domAtSelection = this.editor.view.domAtPos(this.editor.state.selection.from).node
      const selectionElement = domAtSelection?.nodeType === 1 ? domAtSelection : domAtSelection?.parentElement
      const cell = selectionElement?.closest?.('td,th')
      const cellRect = cell?.getBoundingClientRect?.()
      this.tableBoundary = {
        visible: true,
        hover: this.tableBoundary.hover,
        columnSide: this.tableBoundary.columnSide,
        rowSide: this.tableBoundary.rowSide,
        style: {
          top: `${tableRect.top - paperRect.top}px`,
          left: `${tableRect.left - paperRect.left}px`,
          width: `${tableRect.width}px`,
          height: `${tableRect.height}px`,
        },
        columnLineLeft: cellRect ? cellRect.left - tableRect.left + cellRect.width / 2 : tableRect.width / 2,
        rowLineTop: cellRect ? cellRect.top - tableRect.top + cellRect.height / 2 : tableRect.height / 2,
      }
    },
    clearTableBoundaryHover() {
      if (this.tableBoundary.hover) this.tableBoundary.hover = null
    },
    keepTableBoundaryHover() {
      if (this.writable() && this.editor?.isActive('table')) return
      this.clearTableBoundaryHover()
    },
    updateTableBoundaryHover(event) {
      if (!this.writable() || !this.editor?.isActive('table')) { this.clearTableBoundaryHover(); return }
      const table = this.activeTableElement()
      const cell = event.target?.closest?.('td,th')
      if (!table || !cell || !table.contains(cell)) { this.clearTableBoundaryHover(); return }
      const rect = cell.getBoundingClientRect()
      const tableRect = table.getBoundingClientRect()
      const threshold = 9
      const x = event.clientX
      const y = event.clientY
      const row = cell.parentElement
      const rows = table.querySelectorAll('tr')
      const rowIndex = row ? Array.from(rows).indexOf(row) : -1
      const columnIndex = Number.isInteger(cell.cellIndex) ? cell.cellIndex : -1
      const paragraph = cell.querySelector('p')
      const cellPosition = paragraph ? this.editor.view.posAtDOM(paragraph, 0) : null
      const rowSpan = Math.max(1, cell.rowSpan || 1)
      const columnSpan = Math.max(1, cell.colSpan || 1)
      const verticalDistance = Math.min(Math.abs(x - rect.left), Math.abs(x - rect.right))
      const horizontalDistance = Math.min(Math.abs(y - rect.top), Math.abs(y - rect.bottom))
      const inVerticalRange = y >= rect.top - threshold && y <= rect.bottom + threshold
      const inHorizontalRange = x >= rect.left - threshold && x <= rect.right + threshold
      if (inVerticalRange && verticalDistance <= threshold && verticalDistance <= horizontalDistance) {
        const left = Math.abs(x - rect.left) <= Math.abs(x - rect.right)
        this.tableBoundary = { ...this.tableBoundary, hover: 'column', columnSide: left ? 'before' : 'after', rowIndex, columnIndex, rowSpan, columnSpan, cellPosition, columnLineLeft: (left ? rect.left : rect.right) - tableRect.left }
        return
      }
      if (inHorizontalRange && horizontalDistance <= threshold) {
        const top = Math.abs(y - rect.top) <= Math.abs(y - rect.bottom)
        this.tableBoundary = { ...this.tableBoundary, hover: 'row', rowSide: top ? 'before' : 'after', rowIndex, columnIndex, rowSpan, columnSpan, cellPosition, rowLineTop: (top ? rect.top : rect.bottom) - tableRect.top }
        return
      }
      this.clearTableBoundaryHover()
    },
    tableBoundaryAction(id) {
      if (!this.writable()) return
      const boundary = { ...this.tableBoundary }
      if (Number.isInteger(boundary.cellPosition)) this.editor.commands.setTextSelection(boundary.cellPosition)
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
      const table = this.activeTableElement()
      if (!table) return
      const rowOffset = id === 'addRowAfter' ? boundary.rowSpan : 0
      const columnOffset = id === 'addColumnAfter' ? boundary.columnSpan : 0
      const row = table.querySelectorAll('tr')[boundary.rowIndex + rowOffset]
      const cell = row?.cells[boundary.columnIndex + columnOffset]
      const paragraph = cell?.querySelector('p')
      if (!paragraph) return
      const position = this.editor.view.posAtDOM(paragraph, 0)
      if (Number.isInteger(position)) this.editor.commands.setTextSelection(position)
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
      const width = Math.max(70, Math.round((tableElement?.clientWidth || selected.map.width * 120) / selected.map.width))
      const tr = this.editor.state.tr
      const cellPositions = [...new Set(selected.map.map)]
      cellPositions.forEach((cellPos) => {
        const cell = table.nodeAt(cellPos)
        if (cell) tr.setNodeMarkup(selected.tableStart + cellPos, undefined, { ...cell.attrs, colwidth: Array(cell.attrs.colspan || 1).fill(width) })
      })
      if (tr.docChanged) this.editor.view.dispatch(tr)
      return tr.docChanged
    },
    onColumnPointerDown(event) {
      if (!this.writable()) return
      const column = event.target.closest('[data-type="column"]')
      const next = column?.nextElementSibling
      if (!next || next.getAttribute('data-type') !== 'column') return
      const rect = column.getBoundingClientRect()
      if (rect.right - event.clientX > 9) return
      const pos = this.editor.view.posAtDOM(column, 0)
      const resolved = this.editor.state.doc.resolve(pos)
      const depth = Array.from({ length: resolved.depth }, (_, index) => index + 1).find((index) => resolved.node(index).type.name === 'column')
      if (!depth) return
      const firstPos = resolved.before(depth)
      const secondPos = firstPos + this.editor.state.doc.nodeAt(firstPos).nodeSize
      this.columnResize = { firstPos, secondPos, firstWidth: this.editor.state.doc.nodeAt(firstPos).attrs.width, secondWidth: this.editor.state.doc.nodeAt(secondPos).attrs.width, startX: event.clientX, pixels: rect.width + next.getBoundingClientRect().width, firstElement: column, secondElement: next, nextWidth: null }
      event.preventDefault()
      window.addEventListener('pointermove', this.onColumnPointerMove)
      window.addEventListener('pointerup', this.onColumnPointerUp, { once: true })
    },
    onColumnPointerMove(event) {
      const resize = this.columnResize
      if (!resize || !this.writable()) return
      const total = resize.firstWidth + resize.secondWidth
      const delta = (event.clientX - resize.startX) / resize.pixels * total
      const first = Math.max(10, Math.min(total - 10, Math.round(resize.firstWidth + delta)))
      resize.nextWidth = first
      resize.firstElement.style.flexBasis = `${first}%`
      resize.secondElement.style.flexBasis = `${total - first}%`
    },
    onColumnPointerUp() {
      const resize = this.columnResize
      this.columnResize = null
      window.removeEventListener('pointermove', this.onColumnPointerMove)
      if (!resize) return
      resize.firstElement.style.flexBasis = ''
      resize.secondElement.style.flexBasis = ''
      if (resize.nextWidth === null || !this.writable()) return
      const tr = this.editor.state.tr
      tr.setNodeMarkup(resize.firstPos, undefined, { width: resize.nextWidth })
      tr.setNodeMarkup(resize.secondPos, undefined, { width: resize.firstWidth + resize.secondWidth - resize.nextWidth })
      this.editor.view.dispatch(tr)
    },
  },
}
