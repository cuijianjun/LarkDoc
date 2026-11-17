/**
 * 表格交互 —— 闸门与浮层挂载域。
 *
 * 「浮层什么时候该在」只有两个判据：几何活跃（`tableUiActive`，hover / 键盘 / 拖拽）
 * 与离散点击 dismiss（`tableToolsDismissed`，必须重新点回表格）。两条刻意分开，
 * 混成一条会让 hover 回表格时旧选区还在、浮窗自己浮出来。
 */
import { createLazyView } from '../../../ui/lazy'

export const tableGateMethods = {
  tableUiContainsPointer(target) {
    if (!target || typeof target.closest !== 'function') return false
    return !!target.closest('.tableWrapper, .lark-doc-table-overlay, .lark-doc-table-boundary-tools, .lark-doc-table-tools')
  },

  tableUiPointInRegion(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false
    const editorEl = this._tableOverlayScrollTarget
    if (!editorEl) return false
    const hit = (node) => {
      if (!node || !node.isConnected) return false
      const r = node.getBoundingClientRect()
      if (!r.width || !r.height) return false
      return x >= r.left - 28 && x <= r.right + 28 && y >= r.top - 56 && y <= r.bottom + 28
    }
    return hit(editorEl.querySelector('.ProseMirror .tableWrapper'))
      || hit(this._tableOverlaysUi?.el)
      || hit(this.$refs.tableBoundaryHost)
  },

  scheduleTableUiRefresh(inside) {
    clearTimeout(this._tableUiHideTimer)
    if (inside) {
      this.refreshTableUiVisibility()
      return
    }
    // 从表格移向浮窗按钮时会短暂经过 paper / 宿主空白，立刻收会让按钮在鼠标到达前消失；
    // 160ms 与 helpFab / blockHandle 的 hover 抖动窗口同一量级。
    this._tableUiHideTimer = setTimeout(() => this.refreshTableUiVisibility(), 160)
  },

  refreshTableUiVisibility() {
    this.refreshTableOverlays()
    this.refreshTableTools?.()
    this.refreshTableBoundary?.()
  },

  tableUiActive() {
    if (this._tableUiEscape) return false
    if (this._tableReorder || this.columnResize) return true
    if (this._tableUiPointerInside) return true
    // 纯键盘：Tab 到选择条 / ＋ 按钮，或在表格单元格里敲键时浮层必须留着。
    // 指针语义下「焦点停在刚点过的按钮上」不算活跃，否则又会变成永久挂着。
    if (!this._tableUiKeyboardMode) return false
    const doc = this._tableUiWindow?.document || this.$refs.root?.ownerDocument
    const active = doc?.activeElement
    if (!active) return false
    const overlay = this._tableOverlaysUi?.el
    if (overlay?.contains(active)) return true
    if (this.$refs.tableBoundaryHost?.contains(active)) return true
    const editorEl = this._tableOverlayScrollTarget
    return !!(editorEl?.contains(active) && this.editor?.isActive('table'))
  },

  tableToolsDismissed() {
    return this._tableUiToolbarDismissed === true || this._tableUiEscape === true
  },

  mountTableOverlays() {
    if (this._tableOverlaysUi) return
    const host = this.$refs.tableOverlayHost
    if (!host) return
    this._tableOverlaysUi = createLazyView(() => import('../../../ui/tableOverlays'), 'createTableOverlays', {
      host,
      handlers: {
        onSelect: (axis, index, event) => this.onTableSelectLine(axis, index, event),
        onReorderMove: (axis, from, to, x, y) => this.onTableReorderMove(axis, from, to, x, y),
        onReorderEnd: (axis, from, to) => this.onTableReorderEnd(axis, from, to),
        onReorderCancel: () => this.onTableReorderCancel(),
        onScrollRatio: (ratio) => this.onTableScrollRatio(ratio),
      },
    }, { onError: () => { this.error = '界面暂时无法打开，请关闭后重试' }, onReady: () => this.refreshTableOverlays() })
    // 飞书删除键清空内容、保留行列结构。overlay 也可获得键盘焦点，故在 window 接线。
    const win = host.ownerDocument.defaultView
    if (win) {
      this._tableOverlayKeydownTarget = win
      this._tableOverlayOnKeydown = (event) => this.onTableDeleteKeyDown(event)
      win.addEventListener('keydown', this._tableOverlayOnKeydown, true)
    }
    this.refreshTableOverlays()
  },

  destroyTableOverlays() {
    this._tableOverlaysUi?.destroy()
    this._tableOverlaysUi = null
    if (this._tableOverlayKeydownTarget && this._tableOverlayOnKeydown) {
      this._tableOverlayKeydownTarget.removeEventListener('keydown', this._tableOverlayOnKeydown, true)
    }
    this._tableOverlayKeydownTarget = null
    this._tableOverlayOnKeydown = null
  },
}
