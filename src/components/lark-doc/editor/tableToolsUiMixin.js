/**
 * tableToolsUiMixin — 表格工具条 + 表格边界操作条（阶段 5 批次 5G 原生化接线层）。
 *
 * 与批次 2 的 `toolbarUiMixin` 同一套范式：DOM 由 `src/ui/tableTools.js` 建，本 mixin
 * 只做「把状态算成一份 state → 推给 UI」。两条浮动条的状态来源差别很大，别混：
 *
 * 1. **唯一浮窗 `.lark-doc-table-tools`（v11）**：全页面只有一个 DOM 节点，以飞书浮窗
 *    1:1 为准；不是两套 mode、不是两个浮窗。同一条 bar 按选区上下文用 `syncChildren`
 *    真摘除/插入按钮（真源 contributor 模型）：
 *      A. 表格内**非空 TextSelection** → 文字态 10 项（转换为 / 对齐 /
 *         B S I U 链接 行内代码 高亮 / 更多）
 *      B. 点列/行选择条产生 `CellSelection` → 选择条态 13 项（前面插标题行列 /
 *         合并拆分 / 单元格背景三颗表格专属按钮，去掉链接，末尾删除）
 *      C. 拖选两个及以上单元格 → multi 态 11 项（无标题行列、末尾无删除）
 *      评论现按真实 Provider/能力接入；未接通的分享入口仍不展示。
 *    用户初轮口径「选中 table 的文字 和 点击最上边/最左边 出来的弹窗 功能操作栏是
 *    不一样的」在 B 态差异里兑现；「统一成一个浮窗」在唯一 DOM 节点里兑现。
 *    显隐只认 `tableToolsDismissed()`（点其它地方 / Escape 的**离散点击**闸门），
 *    v6 起不再叠加 hover 型 `tableUiActive()` 闸门：用户口径是「浮窗点其他地方才
 *    消失」，鼠标移开（未点击）必须保持。只读、非表格态、折叠选区、NodeSelection /
 *    AllSelection 一律 `{ open: false }`（默认不常驻）。
 *    它读编辑器实时 state，watcher 抓不到，靠主组件的 `onTransaction` /
 *    `onSelectionUpdate` 显式调 `refreshTableTools()` 兜底；锚点从实时 DOM 几何算。
 * 2. **边界条的显隐靠 `tableBoundary`** —— 那是 data（`tableToolsMixin` 每次整体替换
 *    对象），所以 `deep: true` 的 watch 就够，不需要事务钩子。
 *
 * `buildXxxState()` 都**先算显隐、不成立就直接返回 `{ open: false }`**：非表格态下
 * 每按一个键都会调到这里，别顺手去算 `tableHeaderState`（要遍历表格节点）。
 */
import { CellSelection, selectedRect } from '@tiptap/pm/tables'
import { TextSelection } from '@tiptap/pm/state'

import { createCellPlusTools } from '../../../ui/cellPlusTools'
import { createTableTools, createTableBoundaryTools } from '../../../ui/tableTools'
import { closeHistory } from '@tiptap/pm/history'
import { isCommandEnabled } from '../larkDocConfig'
import { createTablePresentation } from './tablePresentation'

const tablePresentation = createTablePresentation({ CellSelection, TextSelection, selectedRect, closeHistory, isCommandEnabled })

export default {
  watch: {
    tableBoundary: { deep: true, handler() { this.refreshTableBoundary() } },
    effectiveReadonly() { this.refreshTableTools(); this.refreshTableBoundary() },
    blockMenuOpen() { this.refreshTableTools() },
    commentEntryVisible() { this.refreshTableTools() },
    selectionShareEntryAvailable() { this.refreshTableTools() },
    commentEntryAvailable() { this.refreshTableTools() },
    commentContextEpoch() { this.refreshTableTools() },
    // `larkDocConfig` 是 computed：features.tables 被关掉时两条都得立刻消失。
    larkDocConfig() { this.refreshTableTools(); this.refreshTableBoundary() },
  },
  methods: {
    ...tablePresentation.methods,
    /** 挂载两条浮动条（由主组件 `mounted` 调用；`isActive` 对空编辑器是安全的）。 */
    mountTableTools() {
      if (this._tableToolsUi) return
      const toolsHost = this.$refs.tableToolsHost
      const boundaryHost = this.$refs.tableBoundaryHost
      if (!toolsHost || !boundaryHost) return
      let tools, boundary, cellPlus
      const onReady = () => {
        if (!tools || this._tableToolsUi !== tools || this._tableBoundaryUi !== boundary || this._cellPlusUi !== cellPlus
          || this._isDestroyed || this._isBeingDestroyed) return
        this.refreshTableTools()
        this.refreshTableBoundary()
      }
      // v11：统一一条飞书工具条，所有按钮（含下拉）走同一个 onCommand 分发。
      tools = this._tableToolsUi = createTableTools({
        host: toolsHost, onReady,
        handlers: { onCommand: (id, value) => this.tableToolbarCommand(id, value) },
      })
      boundary = this._tableBoundaryUi = createTableBoundaryTools({
        host: boundaryHost, onReady,
        handlers: {
          onAction: (id) => this.tableBoundaryAction(id),
          // v6：hover line 跟随边界 hover 常亮（见 buildTableBoundaryState.lineVisible）。
          // 整体替换 `tableBoundary` 触发 deep watch → refreshTableBoundary 重画。
          onPlusHover: (on) => {
            if (this.tableBoundary.plusActive === on) return
            this.tableBoundary = { ...this.tableBoundary, plusActive: on }
          },
          onKeep: () => this.keepTableBoundaryHover(),
          onClear: () => this.clearTableBoundaryHover(),
        },
      }, { onError: () => { this.error = '界面暂时无法打开，请关闭后重试' } })
      // md 风格交互层（选择条 / 重排 / 横滚）与两条工具条共用挂载时机，
      // 由 tableInteractionMixin 提供实现，这里只负责拉起和销毁。
      cellPlus = this._cellPlusUi = createCellPlusTools({
        host: toolsHost, onReady,
        handlers: { onOpen: (button) => {
          if (this.buildCellPlusState().visible) this.openCommandMenu('plus', { currentTarget: button })
        } },
      }, { onError: () => { this.error = '界面暂时无法打开，请关闭后重试' }, isOpen: state => !!state.visible })
      this.mountTableOverlays?.()
      this.refreshTableTools()
      this.refreshTableBoundary()
    },
    /**
     * v5：唯一浮窗的 mode + 显隐。⚠️ 必须直接读 `editor.state.selection`：
     *    `nativeEditorHost` 在 selectionUpdate 里**先同步**调 refreshTableTools，再
     *    `$nextTick` 才跑 refreshTableOverlays 清 tableSelectedLine。只看后者会晚一帧，
     *    表现为「点了正文浮窗还在」，正是用户反馈的「消失逻辑不对」。
     */
    buildTableToolsState() {
      const visibility = this.buildTableToolsVisibility()
      return visibility.open ? this.buildTableToolsPresentation(visibility) : visibility
    },
    /** Shared eager gate: selection pacing and the bubble must agree before optional UI loads. */
    buildTableToolsVisibility() {
      if (this.effectiveReadonly || this.writable?.() === false || !this.featureEnabled('tables')) return { open: false }
      // v6：只认离散点击闸门。不再叠加 `tableUiActive() === false` 的 hover 闸门 ——
      // 否则点选择条出浮窗后鼠标移开表格，浮窗会在没有任何点击的情况下自己收起，
      // 与「点击任何其他地方才可以消失」的用户口径不符。dismiss 后点回表格 /
      // 点选择条由 tableInteractionMixin 的 pointerdown 钩子复位闸门。
      if (this.tableToolsDismissed?.() === true) return { open: false }
      const selection = this.editor?.state?.selection
      if (!selection) return { open: false }

      // v11：两种选区共用**同一条**飞书工具条（同一 DOM 节点），items 按上下文增删。
      // v12：CellSelection 再按真实 `selectedRect` 分两态 ——
      //   `line`  整行 / 整列（点选择条；标题行列 + 末尾删除）
      //   `multi` 拖选两个及以上单元格（飞书形态 E：合并 背景 开头，无标题行列、无删除、无评论）
      // ⚠️ 不再依赖 `tableSelectedLine` 判活：拖选产生的 CellSelection 没有选择条记录，
      //    旧实现直接 `{ open: false }`，浮窗形态/锚点全错（用户截图实测「按钮不对」）。
      //    只用 `tableSelectedLine` 校准 line 态锚点，且必须与真实 rect 一致才采信。
      let cellKind = null
      let anchor = null
      if (selection instanceof CellSelection) {
        cellKind = this.tableCellSelectionKind(selection)
        if (!cellKind) return { open: false }
        if (cellKind === 'line') {
          const fromRect = this.tableCellLineFromRect(selection)
          if (!fromRect) return { open: false }
          const line = this.tableSelectedLine
          // `tableSelectedLine` 只有在 axis/index 与真实 rect 完全一致时才采信，
          // 防止残留标记把浮窗锚到旧行列上。
          const trusted = !!line && line.axis === fromRect.axis && line.index === fromRect.index
          anchor = this.tableToolbarAnchor(trusted ? line : fromRect)
        } else {
          anchor = this.tableCellMultiAnchor(selection)
        }
      } else if (selection instanceof TextSelection && !selection.empty) {
        if (!this.tableTextSelectionInTable(selection)) return { open: false }
        anchor = this.tableTextAnchor(selection)
      }
      if (!anchor) return { open: false }

      return { open: true, anchor, cellKind, cellSelection: selection instanceof CellSelection, tableContext: true, selection }
    },
    /** 选区两端都落在**同一张**表格内：跨表框选、正文里框选都不算表格内选中文字。 */
    tableTextSelectionInTable(selection) {
      const tableDepth = ($pos) => {
        for (let depth = $pos.depth; depth > 0; depth -= 1) {
          if ($pos.node(depth).type.name === 'table') return depth
        }
        return 0
      }
      const fromDepth = tableDepth(selection.$from)
      const toDepth = tableDepth(selection.$to)
      if (!fromDepth || !toDepth) return false
      return selection.$from.before(fromDepth) === selection.$to.before(toDepth)
    },
    /**
     * v12：CellSelection 的两种浮窗形态判定（飞书真源形态 C/D/E/F/G/H，见
     * requirements/02 §⑦-3 ★）。只读**真实选区** `selectedRect`：
     *   - 恰好覆盖完整一列（top=0,bottom=height）或完整一行（left=0,right=width）→ `line`
     *     （点列/行选择条、或拖出完整行列都算，飞书形态 D/H，v12c 13 项、末尾删除）；
     *   - 其余 CellSelection（拖选两个及以上单元格、Shift+Click 单格/多格）→ `multi`
     *     （飞书形态 E/G；v12c 去掉复制链接 / 评论后 11 项：合并 背景 | … | 更多）。
     * 判据是选区覆盖范围本身，不依赖 `tableSelectedLine` —— 那个 transient 标记在
     * 拖选/键盘选区下是 null 或残留旧值，正是「浮窗按钮不对」的根因。
     */
    tableCellSelectionKind(selection) {
      const editor = this.editor
      if (!editor?.state || !(selection instanceof CellSelection)) return null
      let rect
      try { rect = selectedRect(editor.state) } catch { return null }
      const { map } = rect
      if (!map || !map.width || !map.height) return null
      const fullColumn = rect.top === 0 && rect.bottom === map.height
      const fullRow = rect.left === 0 && rect.right === map.width
      if (fullColumn && fullRow && this.tableSelectedLine?.axis === 'row') return rect.bottom - rect.top === 1 ? 'line' : 'rows'
      if (fullColumn) return rect.right - rect.left === 1 ? 'line' : 'columns'
      if (fullRow) return rect.bottom - rect.top === 1 ? 'line' : 'rows'
      return 'multi'
    },
    /** line 态锚点所需的 `{axis,index}`：`tableSelectedLine` 缺失时从真实 rect 反推。 */
    tableCellLineFromRect(selection) {
      const editor = this.editor
      if (!editor?.state || !(selection instanceof CellSelection)) return null
      let rect
      try { rect = selectedRect(editor.state) } catch { return null }
      const { map } = rect
      if (map.width === 1 && map.height === 1 && this.tableSelectedLine?.axis === 'row') return { axis: 'row', index: 0 }
      if (rect.right - rect.left === 1 && rect.top === 0 && rect.bottom === map.height) {
        return { axis: 'column', index: rect.left }
      }
      if (rect.bottom - rect.top === 1 && rect.left === 0 && rect.right === map.width) {
        return { axis: 'row', index: rect.top }
      }
      return null
    },
    /**
     * multi 态（形态 E）锚点：取 anchor/head 两个单元格 DOM 的包围盒，浮在选区上方
     * 居中。与文字态同款「抬到表格顶边 -12px」处理，避免横向压住列选择条。
     */
    tableCellMultiAnchor(selection) {
      const view = this.editor?.view
      if (!view || typeof view.nodeDOM !== 'function') return null
      try {
        const nodeAt = ($cell) => {
          const dom = view.nodeDOM($cell.pos)
          return dom?.getBoundingClientRect ? dom.getBoundingClientRect() : null
        }
        const ra = nodeAt(selection.$anchorCell)
        const rb = nodeAt(selection.$headCell)
        if (!ra || !rb || !ra.width || !rb.width) return null
        const left = Math.min(ra.left, rb.left)
        const right = Math.max(ra.right, rb.right)
        const top = Math.min(ra.top, rb.top)
        let y = top
        const wrapper = this.tableOverlayWrapper?.()?.getBoundingClientRect()
        if (wrapper && wrapper.width) y = Math.min(y, wrapper.top - 12)
        return { x: (left + right) / 2, y, placement: 'top' }
      } catch { return null }
    },
    /**
     * 状态 A 锚点：`view.coordsAtPos` 的视口坐标，水平居中于选区、浮在选区上方。
     * ⚠️ 把 y 抬到表格顶边 -12px 之上：`placeFloatingToolbar` 的浮窗底边 = y - 12，
     *    不抬的话浮窗会横向压住 12px 列选择条（[top-12, top]），B 状态就点不中了。
     *    代价是浮窗固定在表格上方而非紧贴选区，但这正是 v4 真源截图的观感。
     */
    tableTextAnchor(selection) {
      const view = this.editor?.view
      if (!view || typeof view.coordsAtPos !== 'function') return null
      try {
        const from = view.coordsAtPos(selection.from)
        const to = view.coordsAtPos(selection.to)
        const x = (Math.min(from.left, to.left) + Math.max(from.right, to.right)) / 2
        let y = Math.min(from.top, to.top)
        const rect = this.tableOverlayWrapper?.()?.getBoundingClientRect()
        if (rect && rect.width) y = Math.min(y, rect.top - 12)
        return { x, y, placement: 'top' }
      } catch { return null }
    },
    /**
     * 状态 B 的锚点（真源 `Q/fe/pe/me/$` 的 anchorRect）：viewport 坐标。
     * 整列选中 → 浮在第 index 列选择条**上方**；整行选中 → 浮在表格**左侧**、与第 index
     * 行中心齐平。具体 left/top 与视口裁剪交给 `placeFloatingToolbar`（要挂载后量尺寸）。
     */
    tableToolbarAnchor(selected) {
      const wrapper = this.tableOverlayWrapper?.()
      if (!wrapper) return null
      const rect = wrapper.getBoundingClientRect()
      if (!rect.width || !rect.height) return null
      const table = wrapper.querySelector('table')
      if (!table) return null
      const selectorTop = rect.top - (this._mobileEditorMedia?.matches ? 16 : 0)
      let safeTop = this._mobileEditorMedia?.matches ? this.bubbleSafeTop?.() ?? 8 : 8
      const fallbackSafeTop = safeTop
      if (this._mobileEditorMedia?.matches) {
        const main = wrapper.closest?.('.lark-doc-main') || this.$refs?.main || this.$refs?.root?.querySelector('.lark-doc-main')
        if (main?.isConnected) {
          const mainRect = main.getBoundingClientRect()
          const win = main.ownerDocument.defaultView
          const style = win?.getComputedStyle(main)
          const toolbar = this._tableToolsUi?.el
          const measuredHeight = toolbar?.isConnected ? toolbar.getBoundingClientRect().height : 0
          const toolbarHeight = Number.isFinite(measuredHeight) && measuredHeight > 0 ? measuredHeight : 56
          const chromeSafeTop = Math.max(safeTop, mainRect.top + 6)
          if (mainRect.width > 0 && mainRect.height > 0 && mainRect.bottom > 0 && mainRect.top < (win?.innerHeight || Infinity)
            && style?.display !== 'none' && !['hidden', 'collapse'].includes(style?.visibility)
            && chromeSafeTop + toolbarHeight <= (win?.innerHeight || 0) - 8) safeTop = chromeSafeTop
        }
      }
      const avoid = this._mobileEditorMedia?.matches ? [
        { left: rect.left, right: rect.right, top: selectorTop, bottom: rect.top },
        { left: rect.left - 16, right: rect.left, top: rect.top, bottom: rect.bottom },
      ] : null
      if (selected.axis === 'column') {
        const cells = table.querySelector('tr')?.cells
        const cell = cells?.[selected.index] || cells?.[0]
        const cr = cell?.getBoundingClientRect()
        return {
          x: cr ? cr.left + cr.width / 2 : rect.left + rect.width / 2,
          y: selectorTop,
          placement: 'top',
          safeTop,
          ...(safeTop > fallbackSafeTop ? { fallbackSafeTop } : {}),
          avoid,
        }
      }
      const row = table.querySelectorAll('tr')[selected.index]
      const rr = row?.getBoundingClientRect()
      return {
        x: rect.left,
        y: rr ? rr.top + rr.height / 2 : rect.top + rect.height / 2,
        fallbackX: rect.left + 2,
        fallbackY: selectorTop,
        placement: 'left',
        safeTop,
        ...(safeTop > fallbackSafeTop ? { fallbackSafeTop } : {}),
        avoid,
      }
    },
    buildCellPlusState() {
      const selection = this.editor?.state.selection
      if (this.blockMenuOpen || this.effectiveReadonly || this.writable?.() === false || !this.featureEnabled('tables') || !this.featureEnabled('insert') || !(selection instanceof TextSelection) || !selection.empty) return { visible: false }
      const $pos = selection.$from
      if ($pos.parent.type.name !== 'paragraph' || $pos.parent.content.size) return { visible: false }
      for (let depth = $pos.depth; depth > 0; depth -= 1) {
        if (!['tableCell', 'tableHeader'].includes($pos.node(depth).type.name)) continue
        const dom = this.editor.view.nodeDOM($pos.before(depth))
        const rect = dom?.getBoundingClientRect?.()
        if (!rect?.width || !rect.height) return { visible: false }
        const offset = selectedRect(this.editor.state).left === 0 ? 48 : 36
        return { visible: true, left: rect.left - offset, top: rect.top + Math.max(0, (rect.height - 26) / 2) }
      }
      return { visible: false }
    },
    refreshTableTools() {
      this._cellPlusUi?.update(this.buildCellPlusState())
      this.refreshBlockHandle?.()
      if (!this._tableToolsUi) return
      this._tableToolsUi.update(this.buildTableToolsState())
      // v7：唯一表格浮窗一开一关，通用划词气泡条都要同步重算（bubbleMenuMixin
      // 里按 buildTableToolsState().open 让位），杜绝「点选择条那一帧」两窗并存。
      this.refreshBubbleBar?.()
      // v5：不再回调 `refreshTableOverlays()`。那边清掉 tableSelectedLine 后会反过来
      // 调 refreshTableTools，两边互调会成环；浮窗定位统一由 refreshTableUiVisibility /
      // selectionUpdate / scroll 刷新。
    },
    buildTableBoundaryState() {
      const boundary = this.tableBoundary
      // 边界 ＋ 与 md 浮层共用同一个活跃闸门：鼠标移开表格邻域后边线 / ＋ 一起收起。
      const open = this.featureEnabled('tables') && boundary.visible && !!boundary.hover
        && !this.effectiveReadonly && this.tableUiActive?.() !== false
      if (!open) return { open: false }
      // 线长严格取表格**内部**尺寸（WorkBuddy `t$32` 的 `height:ee` / `width:ee`）：
      // 列线 height = 表格高、行线 width = 表格宽，绝不越过表格边界。
      const tableWidth = Number.parseFloat(boundary.style?.width) || 0
      const tableHeight = Number.parseFloat(boundary.style?.height) || 0
      const rowLineLeft = boundary.rowLineLeft || 0
      const rowLineLength = Number.isFinite(boundary.rowLineLength) ? boundary.rowLineLength : tableWidth
      if (!tableWidth || !tableHeight || !rowLineLength
        || (boundary.hover === 'column' && (!Number.isFinite(boundary.columnLineLeft) || boundary.columnLineLeft < rowLineLeft || boundary.columnLineLeft > rowLineLeft + rowLineLength))
        || (boundary.hover === 'row' && (!Number.isFinite(boundary.rowLineTop) || boundary.rowLineTop < 0 || boundary.rowLineTop > tableHeight))) return { open: false }
      return {
        open: true,
        kind: boundary.hover,
        style: boundary.style,
        columnLineLeft: boundary.columnLineLeft,
        rowLineTop: boundary.rowLineTop,
        rowLineLeft,
        plusUp: boundary.plusUp,
        plusDown: boundary.plusDown,
        // `nearestIdx` 选出的那条内部边线决定插入命令（before / after）。
        actionId: boundary.actionId,
        // v6：hover 内部边线即亮线（用户口径「交界处需要高亮，并且有 + 号」）。
        // 旧实现 lineVisible 只认 plusActive（＋ 被 hover 才挂线），悬浮交界处只见
        // ＋ 不见线 —— open 闸门已保证只在 hover 边线时进入本分支，这里恒亮。
        lineVisible: true,
        lineLength: boundary.hover === 'row' ? rowLineLength : tableHeight,
      }
    },
    refreshTableBoundary() {
      if (!this._tableBoundaryUi) return
      this._tableBoundaryUi.update(this.buildTableBoundaryState())
    },
    destroyTableTools() {
      this._cellPlusUi?.destroy()
      this._cellPlusUi = null
      if (this._tableToolsUi) this._tableToolsUi.destroy()
      if (this._tableBoundaryUi) this._tableBoundaryUi.destroy()
      this.destroyTableOverlays?.()
      this._tableToolsUi = null
      this._tableBoundaryUi = null
    },
  },
}
