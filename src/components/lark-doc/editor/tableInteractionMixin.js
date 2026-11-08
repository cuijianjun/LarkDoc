/**
 * tableInteractionMixin — WorkBuddy md 表格交互在 lark-doc 的 1:1 落地层
 * （feat/md-table-interaction · A + B 全部实现）。
 *
 * 分工：
 * - `src/ui/tableOverlays.js` 只按 state 画几何、把手势翻成回调，不碰 ProseMirror；
 * - 本 mixin 负责把「编辑器状态 + DOM 实测几何」算成那份 state，并把回调落到
 *   ProseMirror 命令（整行/整列 CellSelection、moveTableRow / moveTableColumn）。
 *
 * 三条硬约束（改之前先读）：
 * 1. **不改 schema / colgroup / 导出语义**：只在 view 层量 DOM、发命令，落库格式原样。
 * 2. **不新增颜色字面值**：所有颜色在 CSS 里走 `--ld-table-*` → 已有 `--ld-*` token，
 *    深色档由 theme-dark.css 覆盖底层 token 自动继承（见 lark-doc.css 末段）。
 * 3. **不干扰既有边界条**：`.lark-doc-table-overlay` 根 `pointer-events: none`，
 *    只有选择条 / 滚动条 / 浮窗自己开 `auto`，否则 `updateTableBoundaryHover()` 的
 *    `posAtCoords` 会被吞掉，＋按钮全失效。
 *
 * 定位用 `position: fixed` + viewport 坐标：表格可能在任意滚动容器里，用相对 paper
 * 的 offset 会随滚动漂移；fixed + 每次 scroll / transaction 重算最稳。
 */
import { CellSelection, TableMap, selectedRect, deleteRow, deleteColumn, moveTableRow, moveTableColumn } from '@tiptap/pm/tables'
import { createTableOverlays } from '../../../ui/tableOverlays'

const MIN_THUMB = 28

export default {
  data() {
    return {
      tableSelectedLine: null,
    }
  },
  mounted() {
    const editorEl = this.$refs.editorEl
    if (!editorEl) return
    this._tableOverlayHover = null
    this._tableOverlayScrollTarget = editorEl
    // md 浮层的「活跃」闸门：鼠标在表格邻域 / 焦点在浮层内 / 正在键盘编辑表格。
    // 旧实现只看 activeTableElement()（光标在表格内），于是「点过一次表格后鼠标移开、
    // 甚至点了页面别处让编辑器失焦」，胶囊、选择条、滚动条仍永久挂着 —— 与 WorkBuddy
    // 「hover 表格块才浮出胶囊」的 1:1 语义不符。这里统一收口，Escape 可主动收起。
    this._tableUiPointerInside = false
    // undefined = 还没收到过任何指针事件；收到后才知道指针是否移出了整个组件。
    this._tableUiPointerInRoot = undefined
    this._tableUiKeyboardMode = false
    this._tableUiEscape = false
    this._tableUiHideTimer = null
    this._tableUiFocusTimer = null
    this._tableUiOnPointerMove = (event) => {
      this._tableUiKeyboardMode = false
      const target = event.target
      const near = this.tableUiPointInRegion(event.clientX, event.clientY)
      const inside = this.tableUiContainsPointer(target) || near
      const root = this.$refs.root
      const isNode = !!(target && typeof target.nodeType === 'number')
      const inRoot = (isNode && !!root && (target === root || root.contains(target))) || near
      this._tableUiPointerInRoot = inRoot
      // Escape 只收起「这一次」：指针先离开表格邻域再回来即视为新的一次交互。
      if (!inside && this._tableUiPointerInside) this._tableUiEscape = false
      if (inside === this._tableUiPointerInside) return
      this._tableUiPointerInside = inside
      this.scheduleTableUiRefresh(inside)
    }
    this._tableUiOnFocus = (event) => {
      clearTimeout(this._tableUiHideTimer)
      const doc = editorEl.ownerDocument
      const active = doc?.activeElement
      if (event?.type === 'focusin') {
        if (active && editorEl.contains(active)) {
          this._tableUiEscape = false
          this._tableUiKeyboardMode = true
        }
        this.refreshTableUiVisibility()
        return
      }
      // focusout / window blur 的这一刻 activeElement 可能仍是旧节点，下一个宏任务再判，
      // 否则「点页面标题让编辑器失焦」会被误判成焦点还在组件里。
      clearTimeout(this._tableUiFocusTimer)
      this._tableUiFocusTimer = setTimeout(() => {
        this._tableUiFocusTimer = null
        if (this._tableUiWindow) this.refreshTableUiVisibility()
      }, 0)
    }
    this._tableUiOnKeydown = (event) => {
      if (event.key === 'Escape') {
        this._tableUiEscape = true
        this._tableUiKeyboardMode = false
        this.refreshTableUiVisibility()
        return
      }
      // 后续任何键盘操作都算新交互：解除 Escape，并回到键盘模式以保留浮层的键盘可达性。
      this._tableUiEscape = false
      this._tableUiKeyboardMode = true
    }
    const win = editorEl.ownerDocument.defaultView
    if (win) {
      this._tableUiWindow = win
      // capture 阶段挂 window：pointermove 不冒泡，且浮层挂在 editorEl 之外的独立宿主上，
      // 只在 editorEl 上监听会漏掉「从表格移进浮窗再移出去」这条路径。
      win.addEventListener('pointermove', this._tableUiOnPointerMove, true)
      win.addEventListener('focusin', this._tableUiOnFocus, true)
      win.addEventListener('focusout', this._tableUiOnFocus, true)
      win.addEventListener('keydown', this._tableUiOnKeydown, true)
      win.addEventListener('blur', this._tableUiOnFocus, true)
    }
    this._tableOverlayOnPointerOver = (event) => {
      const wrapper = event.target?.closest?.('.tableWrapper')
      if (wrapper === this._tableOverlayHover) return
      this._tableOverlayHover = wrapper || null
      this.refreshTableOverlays()
    }
    this._tableOverlayOnPointerOut = (event) => {
      if (!this._tableOverlayHover) return
      const next = event.relatedTarget?.closest?.('.tableWrapper')
      if (next === this._tableOverlayHover) return
      // overlay 挂在独立的 tableOverlayHost，不在 .tableWrapper 内。鼠标从表格移向
      // 浮窗按钮 / 选择条 / 自绘滚动条时，若在这里清掉 hover，「只 hover、还没点进
      // 表格」的场景下浮窗会在鼠标靠近的瞬间自己消失，按钮根本点不到（与既有
      // keepTableBoundaryHover 同一类问题）。保留 hover，真正移出后再由 pointerover 复位。
      const overlay = this._tableOverlaysUi?.el
      const related = event.relatedTarget
      // 指针移出浏览器窗口等场景下 relatedTarget 可能是 Window / null，不是 Node；
      // 直接丢给 contains() 会抛 TypeError，先做 Node 判定。
      if (overlay && related && typeof related.nodeType === 'number' && overlay.contains(related)) return
      this._tableOverlayHover = null
      this.refreshTableOverlays()
    }
    this._tableOverlayOnScroll = () => this.refreshTableOverlays()
    editorEl.addEventListener('pointerover', this._tableOverlayOnPointerOver)
    editorEl.addEventListener('pointerout', this._tableOverlayOnPointerOut)
    // scroll 不冒泡，必须 capture 才能接到 .tableWrapper 自己的横滚。
    editorEl.addEventListener('scroll', this._tableOverlayOnScroll, true)
  },
  beforeDestroy() {
    const editorEl = this._tableOverlayScrollTarget
    if (!editorEl) return
    editorEl.removeEventListener('pointerover', this._tableOverlayOnPointerOver)
    editorEl.removeEventListener('pointerout', this._tableOverlayOnPointerOut)
    editorEl.removeEventListener('scroll', this._tableOverlayOnScroll, true)
    const win = this._tableUiWindow
    if (win) {
      win.removeEventListener('pointermove', this._tableUiOnPointerMove, true)
      win.removeEventListener('focusin', this._tableUiOnFocus, true)
      win.removeEventListener('focusout', this._tableUiOnFocus, true)
      win.removeEventListener('keydown', this._tableUiOnKeydown, true)
      win.removeEventListener('blur', this._tableUiOnFocus, true)
    }
    clearTimeout(this._tableUiHideTimer)
    clearTimeout(this._tableUiFocusTimer)
    this._tableUiHideTimer = null
    this._tableUiFocusTimer = null
    this._tableUiWindow = null
    this._tableOverlayScrollTarget = null
    this._tableOverlayHover = null
  },
  methods: {
    /** 真实指针事件的 target 判定：表格块 / md overlay / 边界 ＋ / 顶部表格工具条。 */
    tableUiContainsPointer(target) {
      if (!target || typeof target.closest !== 'function') return false
      return !!target.closest('.tableWrapper, .lark-doc-table-overlay, .lark-doc-table-boundary-tools, .lark-doc-table-tools')
    },
    /**
     * 几何兜底：合成 PointerEvent（触屏验收）与 pointer capture 期间 target 会漂到
     * body 或捕获元素上，只看 target 会把真实落在浮层上的手势误判成「移出」。
     * 上下各留 56 / 28px 覆盖胶囊浮窗、12px 选择条、14px 自绘滚动条与边界 ＋。
     */
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
    /** 三条浮层（md overlay / 顶部工具条 / 边界 ＋）是否都该收起或刷新。 */
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
    /**
     * md 浮层的可见闸门。拖拽 / 选中重排期间必须保持打开，否则 overlay 节点被摘掉，
     * pointer capture 与预览卡会断；焦点在浮层内则保留键盘可达性。
     */
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
    /**
     * 顶部表格工具条是参与布局的 86px 横条：不能用 hover 开合（表格会被推下移 →
     * 指针脱离 → 再收起，来回抖）。所以它只在两类**离散**事件下收起：组件整体失焦、
     * 指针移出整个组件；外加 Escape 主动收起。isActive('table') 的原语义保留。
     */
    tableToolsFocused() {
      if (this._tableUiEscape) return false
      if (this._tableUiPointerInRoot === false && !this._tableUiKeyboardMode) return false
      const doc = this._tableUiWindow?.document || this.$refs.root?.ownerDocument || document
      const root = this.$refs.root
      // root 缺失（早期挂载 / SSR）时退回原语义，不额外收口。
      if (!root) return true
      const active = doc?.activeElement
      return !!(active && root.contains(active))
    },
    /** 由 tableToolsUiMixin.mountTableTools() 一并挂载，避免多一个 UI domain 生命周期。 */
    mountTableOverlays() {
      if (this._tableOverlaysUi) return
      const host = this.$refs.tableOverlayHost
      if (!host) return
      this._tableOverlaysUi = createTableOverlays({
        host,
        handlers: {
          onSelect: (axis, index) => this.onTableSelectLine(axis, index),
          onReorderMove: (axis, from, to, x, y) => this.onTableReorderMove(axis, from, to, x, y),
          onReorderEnd: (axis, from, to) => this.onTableReorderEnd(axis, from, to),
          onReorderCancel: () => this.onTableReorderCancel(),
          onScrollRatio: (ratio) => this.onTableScrollRatio(ratio),
          onAction: (id) => this.onTableFloatAction(id),
        },
      })
      // Delete / Backspace 删整行整列：绑 window 的 capture 阶段。条件命中时
      // stopPropagation 让事件根本到不了 view.dom，ProseMirror 自带的
      // deleteCellSelection（只清空单元格内容）就不会抢先执行。
      // 用 window 而不是 editorEl：选择条在独立的 tableOverlayHost 里，键盘选中后
      // 焦点在 overlay 上，绑 editorEl 会漏掉这条路径。
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
    /** 当前要服务的表格块：光标所在优先，其次 hover 到的那个。 */
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
    /**
     * 核心：把 DOM 实测几何算成 overlay state。
     * 单元格 / 行的 rect 都是 viewport 坐标，减掉 wrapper 的 left/top 就是相对坐标；
     * 横滚时 cell rect 会跑出可视区，选择条只保留与可视区相交的那部分（否则会画到纸外）。
     */
    refreshTableOverlays() {
      const ui = this._tableOverlaysUi
      if (!ui) return
      // 选区不再是 CellSelection（点回正文、删完行列、光标进单元格）时清掉选中高亮，
      // 否则 overlay 会一直画着蓝色选择条，Delete 判定也会失去真实选区依据。
      if (this.tableSelectedLine && !(this.editor?.state?.selection instanceof CellSelection)) {
        this.tableSelectedLine = null
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
      const firstRow = table.querySelector('tr')
      const headCells = firstRow ? Array.from(firstRow.cells) : []
      const rowEls = Array.from(table.querySelectorAll('tr'))
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

      const columns = headCells.map((cell, index) => {
        const cellRect = cell.getBoundingClientRect()
        return { index, left: cellRect.left - rect.left, width: cellRect.width }
      })
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
          width: Math.max(12, Math.min(item.width, viewWidth - Math.max(0, item.left))),
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

      ui.update({
        open: true,
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
        columns: visibleColumns,
        rows: visibleRows,
        selected: this.tableSelectedLine,
        drop,
        snap: !!drop,
        card,
      })
    },
    /** 找到表格节点的起始 pos（table node 之前）。 */
    tableOverlayTablePos() {
      const editor = this.editor
      if (!editor) return null
      const $from = editor.state.selection.$from
      for (let depth = $from.depth; depth > 0; depth -= 1) {
        if ($from.node(depth).type.name === 'table') {
          return { pos: $from.before(depth), node: $from.node(depth) }
        }
      }
      // hover 但光标不在表内：从 DOM 反查 pos。
      const table = this._tableOverlayHover?.querySelector('table')
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
    /** 整行 / 整列 CellSelection：moveTableRow/Column 与 deleteRow/Column 都依赖它。 */
    selectTableLine(axis, index) {
      const editor = this.editor
      const found = this.tableOverlayTablePos()
      if (!editor || !found) return false
      const map = TableMap.get(found.node)
      if ((axis === 'column' && index >= map.width) || (axis === 'row' && index >= map.height)) return false
      const offsets = []
      if (axis === 'column') {
        for (let row = 0; row < map.height; row += 1) offsets.push(map.map[row * map.width + index])
      } else {
        for (let col = 0; col < map.width; col += 1) offsets.push(map.map[index * map.width + col])
      }
      // ⚠️ 这里必须是「单元格节点边界」位置（tableStart + mapOffset），不能 +1 进单元格内容：
      // pointsAtCell() 要求 $pos.parent 是 tableRow 且 $pos.nodeAfter 是 cell，
      // 传内容位置会让 rectBetween/findCell 抛 RangeError，被 catch 吞掉后表现为「点了没反应」。
      const start = found.pos + 1
      try {
        const doc = editor.state.doc
        const $anchor = doc.resolve(start + offsets[0])
        const $head = doc.resolve(start + offsets[offsets.length - 1])
        const selection = axis === 'column'
          ? CellSelection.colSelection($anchor, $head)
          : CellSelection.rowSelection($anchor, $head)
        editor.view.dispatch(editor.state.tr.setSelection(selection))
        return true
      } catch {
        return false
      }
    },
    onTableSelectLine(axis, index) {
      if (!this.writable() || !this.selectTableLine(axis, index)) return
      this.tableSelectedLine = { axis, index }
      this.refreshTableOverlays()
    },
    /**
     * 验收项「选择条点选后 Delete 能删」：prosemirror-tables 自带的 keydown 把
     * Backspace/Delete 映射成 deleteCellSelection（只清空选中单元格内容），不会删行列。
     * 这里只在 CellSelection 恰好覆盖完整一行 / 一列时接管，其余情况（普通光标、
     * 局部框选）一律放行给 ProseMirror 原行为，不改变单元格内退格语义。
     */
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
      let rect
      try { rect = selectedRect(state) } catch { return }
      const { map } = rect
      const fullColumn = rect.right - rect.left === 1 && rect.top === 0 && rect.bottom === map.height
      const fullRow = rect.bottom - rect.top === 1 && rect.left === 0 && rect.right === map.width
      if (!fullColumn && !fullRow) return
      // deleteColumn/deleteRow 在「会删掉整张表」时会失败，此时不接管，
      // 让 ProseMirror 退回清空内容，避免整张表凭空消失。
      if ((fullColumn && map.width <= 1) || (fullRow && map.height <= 1)) return
      const command = fullColumn ? deleteColumn : deleteRow
      if (!command(state)) return
      // window capture 阶段 stopPropagation：事件到不了 view.dom，
      // prosemirror-keymap 的 deleteCellSelection 就不会抢先清空单元格。
      event.preventDefault()
      event.stopPropagation()
      let applied = false
      try { applied = command(state, editor.view.dispatch) } catch { applied = false }
      if (applied) this.tableSelectedLine = null
      this.$nextTick(() => {
        this.updateTableBoundary?.()
        this.refreshTableOverlays()
      })
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
    onTableScrollRatio(ratio) {
      const wrapper = this.tableOverlayWrapper()
      if (!wrapper) return
      const overflow = wrapper.scrollWidth - wrapper.clientWidth
      if (overflow <= 0) return
      wrapper.scrollLeft = ratio * overflow
      this.refreshTableOverlays()
    },
    onTableFloatAction(id) {
      if (!this.writable()) return
      // 只 hover、还没点进表格时，先把光标落进首个单元格，否则 tableAction 的
      // isActive('table') / selectedRect 会拿到表外的选区。
      if (!this.editor.isActive('table')) {
        const table = this._tableOverlayHover?.querySelector('table')
        const paragraph = table?.querySelector('td p, th p')
        if (paragraph) {
          try {
            const pos = this.editor.view.posAtDOM(paragraph, 0)
            if (Number.isInteger(pos)) this.editor.commands.setTextSelection(pos)
          } catch { /* 忽略：后续命令自身会安全失败 */ }
        }
      }
      if (id === 'addRowAfter' || id === 'addColumnAfter') this.tableAction(id)
      else this.run(id)
    },
  },
}
