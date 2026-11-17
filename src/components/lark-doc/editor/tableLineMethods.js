/**
 * 表格交互 —— 行列操作域：整行 / 整列选区、删除、重排、浮窗文本动作。
 *
 * `moveTableRow` / `moveTableColumn` / `deleteRow` / `deleteColumn` 都依赖
 * `selectTableLine` 建出的 CellSelection，所以选区构造与消费放在同一个文件里。
 */
import { CellSelection, TableMap, selectedRect, deleteRow, deleteColumn, deleteCellSelection, moveTableRow, moveTableColumn } from '@tiptap/pm/tables'

export const tableLineMethods = {
  selectTableLine(axis, index, endIndex = index, target) {
    const editor = this.editor
    const found = target || this.tableOverlayTablePos()
    if (!editor || !found || editor.state.doc.nodeAt(found.pos) !== found.node) return false
    const map = TableMap.get(found.node)
    const limit = axis === 'column' ? map.width : map.height
    if (![index, endIndex].every(value => Number.isInteger(value) && value >= 0 && value < limit)) return false
    const anchor = axis === 'column' ? map.map[index] : map.map[index * map.width]
    const head = axis === 'column' ? map.map[(map.height - 1) * map.width + endIndex] : map.map[(endIndex + 1) * map.width - 1]
    // ⚠️ 这里必须是「单元格节点边界」位置（tableStart + mapOffset），不能 +1 进单元格内容：
    // pointsAtCell() 要求 $pos.parent 是 tableRow 且 $pos.nodeAfter 是 cell，
    // 传内容位置会让 rectBetween/findCell 抛 RangeError，被 catch 吞掉后表现为「点了没反应」。
    const start = found.pos + 1
    try {
      const doc = editor.state.doc
      const $anchor = doc.resolve(start + anchor)
      const $head = doc.resolve(start + head)
      const selection = axis === 'column'
        ? CellSelection.colSelection($anchor, $head)
        : CellSelection.rowSelection($anchor, $head)
      editor.view.dispatch(editor.state.tr.setSelection(selection))
      return true
    } catch {
      return false
    }
  },

  onTableSelectLine(axis, index, event = {}) {
    const previous = this.tableSelectedLine
    const anchor = event.shiftKey && previous?.axis === axis ? previous.index : index
    if (!this.writable() || !this.selectTableLine(axis, anchor, index)) return
    const rect = selectedRect(this.editor.state)
    this.tableSelectedLine = { axis, index: anchor, endIndex: index, from: axis === 'column' ? rect.left : rect.top, to: axis === 'column' ? rect.right : rect.bottom }
    // 程序化触发（键盘 / 合成事件）也要解除 dismiss，且必须**显式刷新浮窗**：
    // selectTableLine 的 dispatch 发生在 tableSelectedLine 赋值之前，那一轮
    // selection 钩子读到的还是 null，浮窗不会自己冒出来。
    this._tableUiToolbarDismissed = false
    this._tableUiClicked = true
    this.refreshTableUiVisibility()
  },

  deleteSelectedTableLine() {
    const editor = this.editor
    if (!editor?.view || this.effectiveReadonly || !this.writable()) return false
    const state = editor.state
    if (!(state.selection instanceof CellSelection)) return false
    let rect
    try { rect = selectedRect(state) } catch { return false }
    const { map } = rect
    const fullColumn = rect.top === 0 && rect.bottom === map.height
    const fullRow = rect.left === 0 && rect.right === map.width
    if (!fullColumn && !fullRow) return false
    const command = fullColumn ? deleteColumn : deleteRow
    if (!command(state)) return false
    let applied = false
    try { applied = !!command(state, editor.view.dispatch) } catch { applied = false }
    if (applied) {
      // 删完立刻清掉选择条标记并刷新几何层：否则选择条还标着旧的「选择第 N 列」，
      // 看起来像删错了相邻列（v12 probe-delete2 实测到的状态滞后）。
      this.tableSelectedLine = null
      this.$nextTick(() => {
        this.updateTableBoundary?.()
        this.refreshTableOverlays?.()
        this.refreshTableTools?.()
      })
    }
    return applied
  },

  onTableDeleteKeyDown(event) {
    if (event.key !== 'Delete' && event.key !== 'Backspace') return
    if (event.defaultPrevented || this.effectiveReadonly || !this.writable()) return
    const editor = this.editor
    if (!editor?.view?.dom) return
    const state = editor.state
    if (!(state.selection instanceof CellSelection)) return
    // 焦点必须落在本实例的编辑器或 overlay 内，避免同页多实例 / 外部输入框误删。
    const target = event.target
    const overlay = this._tableOverlaysUi?.el
    if (!editor.view.dom.contains(target) && !(overlay && overlay.contains(target))) return
    if (!deleteCellSelection(state)) return
    event.preventDefault()
    event.stopPropagation()
    deleteCellSelection(state, editor.view.dispatch)
  },

  onTableReorderMove(axis, from, to, x, y) {
    this._tableReorder = { axis, from, to, x, y }
    this.refreshTableOverlays()
  },

  onTableReorderCancel() {
    this._tableReorder = null
    this.refreshTableOverlays()
  },

  onTableReorderEnd(axis, from, to) {
    this._tableReorder = null
    this.tableSelectedLine = null
    if (!this.writable() || from === to || !this.selectTableLine(axis, from)) {
      this.refreshTableOverlays()
      return
    }
    const editor = this.editor
    const command = axis === 'column' ? moveTableColumn : moveTableRow
    const state = editor.state
    const pos = state.selection.from
    // moveRow/moveColumn 内部靠 tr.selection 的 CellSelection 取行/列范围，
    // 所以上面那次 setSelection 不是可选步骤，删掉就会静默 false。
    let applied = false
    try {
      applied = command({ from, to, select: true, pos })(state, editor.view.dispatch)
    } catch {
      applied = false
    }
    if (!applied) this.tableSelectedLine = { axis, index: from }
    this.$nextTick(() => {
      this.updateTableBoundary()
      this.refreshTableOverlays()
    })
    this.refreshTableOverlays()
  },

  tableTextAction(id) {
    if (!this.writable()) return
    if (id === 'ai-edit') { this.$emit('ai-request', 'rewrite'); return }
    if (id === 'link') { this.openLinkDialog?.(true); return }
    if (['bold', 'italic', 'underline', 'strike', 'code'].includes(id)) this.toggleMark(id)
  },
}
