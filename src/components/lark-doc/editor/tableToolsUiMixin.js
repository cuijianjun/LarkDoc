/**
 * tableToolsUiMixin — 表格工具条 + 表格边界操作条（阶段 5 批次 5G 原生化接线层）。
 *
 * 与批次 2 的 `toolbarUiMixin` 同一套范式：DOM 由 `src/ui/tableTools.js` 建，本 mixin
 * 只做「把状态算成一份 state → 推给 UI」。两条浮动条的状态来源差别很大，别混：
 *
 * 1. **表格工具条的显隐靠 `isActive('table')`** —— 读的是编辑器实时 state，不是响应式
 *    数据，watcher 抓不到。主组件的 `onTransaction` / `onSelectionUpdate` 显式调
 *    `refreshTableTools()` 兜底（与 `refreshToolbar()` 同一处，别只加一边）。
 *    `tableHeaderState`（表头行的 `aria-pressed`）同理，也是实时 state。
 * 2. **边界条的显隐靠 `tableBoundary`** —— 那是 data（`tableToolsMixin` 每次整体替换
 *    对象），所以 `deep: true` 的 watch 就够，不需要事务钩子。
 *
 * `buildXxxState()` 都**先算显隐、不成立就直接返回 `{ open: false }`**：非表格态下
 * 每按一个键都会调到这里，别顺手去算 `tableHeaderState`（要遍历表格节点）。
 */
import { createTableTools, createTableBoundaryTools } from '../../../ui/tableTools'

export default {
  watch: {
    tableBoundary: { deep: true, handler() { this.refreshTableBoundary() } },
    // `applyCellAlign` 是按键写（`this.cellAlignState[key] = value`），浅比较抓不到。
    cellAlignState: { deep: true, handler() { this.refreshTableTools() } },
    effectiveReadonly() { this.refreshTableTools(); this.refreshTableBoundary() },
    // `larkDocConfig` 是 computed：features.tables 被关掉时两条都得立刻消失。
    larkDocConfig() { this.refreshTableTools(); this.refreshTableBoundary() },
  },
  methods: {
    /** 挂载两条浮动条（由主组件 `mounted` 调用；`isActive` 对空编辑器是安全的）。 */
    mountTableTools() {
      if (this._tableToolsUi) return
      const toolsHost = this.$refs.tableToolsHost
      const boundaryHost = this.$refs.tableBoundaryHost
      if (!toolsHost || !boundaryHost) return
      this._tableToolsUi = createTableTools({
        host: toolsHost,
        handlers: {
          onAction: (id) => this.tableAction(id),
          onBackground: (value) => this.cellAttribute('backgroundColor', value),
          onAlign: (key, value) => this.applyCellAlign(key, value),
        },
      })
      this._tableBoundaryUi = createTableBoundaryTools({
        host: boundaryHost,
        handlers: {
          onAction: (id) => this.tableBoundaryAction(id),
          onKeep: () => this.keepTableBoundaryHover(),
          onClear: () => this.clearTableBoundaryHover(),
        },
      })
      this.refreshTableTools()
      this.refreshTableBoundary()
    },
    buildTableToolsState() {
      const open = !this.effectiveReadonly && this.featureEnabled('tables') && this.isActive('table')
      if (!open) return { open: false }
      return {
        open: true,
        actions: this.visibleTableActions,
        header: this.tableHeaderState,
        textAlign: this.cellAlignState.textAlign,
        verticalAlign: this.cellAlignState.verticalAlign,
        textAlignOptions: this.cellTextAlignOptions,
        verticalAlignOptions: this.cellVerticalAlignOptions,
      }
    },
    refreshTableTools() {
      if (!this._tableToolsUi) return
      this._tableToolsUi.update(this.buildTableToolsState())
    },
    buildTableBoundaryState() {
      const boundary = this.tableBoundary
      const open = this.featureEnabled('tables') && boundary.visible && !!boundary.hover && !this.effectiveReadonly
      if (!open) return { open: false }
      return {
        open: true,
        kind: boundary.hover,
        style: boundary.style,
        columnLineLeft: boundary.columnLineLeft,
        rowLineTop: boundary.rowLineTop,
      }
    },
    refreshTableBoundary() {
      if (!this._tableBoundaryUi) return
      this._tableBoundaryUi.update(this.buildTableBoundaryState())
    },
    destroyTableTools() {
      if (this._tableToolsUi) this._tableToolsUi.destroy()
      if (this._tableBoundaryUi) this._tableBoundaryUi.destroy()
      this._tableToolsUi = null
      this._tableBoundaryUi = null
    },
  },
}
