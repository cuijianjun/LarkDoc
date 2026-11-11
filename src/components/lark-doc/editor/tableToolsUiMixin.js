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
 *      v12c 用户口径：「复制选区链接」「评论」无实际功能，三态一律不展示。
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
      // v11：统一一条飞书工具条，所有按钮（含下拉）走同一个 onCommand 分发。
      this._tableToolsUi = createTableTools({
        host: toolsHost,
        handlers: { onCommand: (id, value) => this.tableToolbarCommand(id, value) },
      })
      this._tableBoundaryUi = createTableBoundaryTools({
        host: boundaryHost,
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
      })
      // md 风格交互层（选择条 / 重排 / 横滚）与两条工具条共用挂载时机，
      // 由 tableInteractionMixin 提供实现，这里只负责拉起和销毁。
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
      if (this.effectiveReadonly || !this.featureEnabled('tables')) return { open: false }
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

      // 飞书 `menu-item-actived`：按钮按下沉态 = 该格式在当前选区已生效。
      const active = {}
      for (const mark of ['bold', 'strike', 'italic', 'underline', 'code']) {
        try { active[mark] = !!this.editor.isActive(mark) } catch { active[mark] = false }
      }
      // 依赖上下文的命令（合并/拆分需 CellSelection、缩进受前块上限、转换为需非空块）：
      // 把适用性算进 state，菜单里不适用项置灰 + 当前块类型回填 pressed，
      // 而不是让用户点一颗「看起来能点、点了没反应」的按钮。
      const parent = selection.$from?.parent
      const parentName = parent?.type?.name
      // 「拆分单元格」只对已合并的单元格有意义；没有 colspan/rowspan>1 时置灰，
      // 避免用户点到一颗命令合法、但当前文档里什么都拆不了的按钮（v11 全量审计发现）。
      let canSplitCell = false
      try {
        for (let depth = selection.$from.depth; depth > 0; depth -= 1) {
          if (selection.$from.node(depth).type.name !== 'table') continue
          selection.$from.node(depth).descendants((node) => {
            if ((node.type.name === 'tableCell' || node.type.name === 'tableHeader')
              && (Number(node.attrs.colspan || 1) > 1 || Number(node.attrs.rowspan || 1) > 1)) canSplitCell = true
          })
          break
        }
      } catch { /* 扩展未注册 / 非表格态：按「无可拆分单元格」处理 */ }
      let hasTextColor = false
      let hasCellBg = false
      try {
        const textStyle = this.editor?.getAttributes?.('textStyle') || {}
        hasTextColor = !!(textStyle.color || textStyle.backgroundColor) || !!this.editor?.isActive?.('highlight')
        const cell = this.editor?.getAttributes?.('tableCell') || {}
        const head = this.editor?.getAttributes?.('tableHeader') || {}
        hasCellBg = !!(cell.backgroundColor || head.backgroundColor)
      } catch { /* 扩展未注册 / 非表格态：按「无可清除内容」处理 */ }
      return {
        open: true,
        anchor,
        active,
        tableContext: true,
        header: this.tableHeaderState,
        textAlign: this.cellAlignState?.textAlign,
        verticalAlign: this.cellAlignState?.verticalAlign,
        cellTextAlignOptions: this.cellTextAlignOptions,
        cellVerticalAlignOptions: this.cellVerticalAlignOptions,
        cellSelection: selection instanceof CellSelection,
        cellKind,
        canSplitCell,
        canIndentIn: !!this.canIncreaseIndent?.(),
        canIndentOut: Number(this.blockIndentLevel?.() || 0) > 0,
        hasTextColor,
        hasCellBg,
        blockType: parentName === 'heading' ? `heading${parent.attrs?.level || 1}` : parentName,
      }
    },
    /**
     * v11 统一工具条命令分发。菜单里只留项目真能承接的能力：编辑器命令直接执行，
     * AI / 搜索走项目已有的面板与事件；v10 那些靠 localStorage / window.open
     * 伪造的「模板 / 词典 / 子文档 / 网页搜索」已按用户口径从 UI 移除，这里也不再留分支。
     * ⚠️ v12c：「复制选区链接」（只写 `#pos=` 假链接、无 hash 解析 / 无宿主接线）与
     *    「评论」（无 Provider 时只落本地 comment mark、没有评论面板 / 输入框 / 线程）
     *    两颗按钮从 UI 摘除，这里对应的假实现分支也一并删除 —— 不留下「从别处还能
     *    调到、但其实没功能」的死命令。`commentsMixin` 的 Provider 链路仍完整保留，
     *    等宿主接了真实评论后端再由它自己的入口启用。
     * 飞书功能栏没有「表格操作」按钮，结构命令由边界 ＋、块句柄菜单与各表格下拉承接。
     */
    tableToolbarCommand(id, value) {
      if (!this.writable()) return false
      const state = this.editor?.state
      const selection = state?.selection
      const text = selection && !selection.empty
        ? state.doc.textBetween(selection.from, selection.to, ' ') : ''
      const emit = (action, extra = {}) => {
        const detail = {
          action, text, from: selection?.from, to: selection?.to, value, ...extra,
        }
        // `$emit` 在 native host 只转给构造时传入的 on{} 回调；未接线的宿主**收不到**，
        // 等于点了没反应。同步再抛一份 bubbling+composed 的 DOM 事件，宿主在任意祖先
        // 节点都能委托监听（Web Component / Shadow DOM 同样可达）。
        this.$emit?.('lark-doc-toolbar-action', detail)
        this.dispatchToolbarAction?.('lark-doc-toolbar-action', detail)
      }
      const setCellBg = (color) => {
        if (!color) this.run('setCellAttribute', 'backgroundColor', null)
        else this.cellAttribute?.('backgroundColor', color)
      }

      switch (id) {
        case 'bold': case 'strike': case 'italic': case 'underline': case 'code':
          this.toggleMark?.(id); return true
        case 'link': this.openLinkDialog?.(true); return true
        case 'table-header': case 'merge-cell': this.tableAction?.(value); return true
        case 'cell-bg':
          setCellBg(String(value || '').startsWith('cellbg:') ? String(value).slice(7) : value)
          return true
        case 'turninto': {
          const id = String(value || '')
          // ⚠️ 不能复用 `blockTypeAction(id)`：那条链路读「块拖拽句柄」的 handleRange，
          // 浮窗点击时句柄未激活 → range 为空 → 函数提前 return，命令根本没执行
          // （v10 独立自测 S12f 实测：heading1 点了但块还是 P）。这里与命令菜单
          // `executeCommand` 同口径，直接以**当前选区**走 `this.run()`。
          // 飞书「转换为」12 项逐项落真实命令，不留下只有事件、没有效果的死按钮。
          const commands = {
            paragraph: ['setParagraph'],
            heading1: ['setHeading', { level: 1 }],
            heading2: ['setHeading', { level: 2 }],
            heading3: ['setHeading', { level: 3 }],
            orderedList: ['toggleOrderedList'],
            bulletList: ['toggleBulletList'],
            taskList: ['toggleTaskList'],
            codeBlock: ['setCodeBlock'],
            blockquote: ['toggleBlockquote'],
            callout: ['wrapIn', 'callout'],
            synced: ['setReferenceCard', { kind: 'source_synced' }],
          }
          const cmd = commands[id]
          if (!cmd) { emit(`turninto:${id}`); return true }
          let applied = false
          try { applied = !!this.run(cmd[0], ...cmd.slice(1)) } catch { applied = false }
          // 表格单元格里 wrapIn 可能因 schema 约束失败，退回插入空高亮块（与命令菜单同款）。
          if (!applied && id === 'callout') {
            try { applied = !!this.run('insertContent', { type: 'callout', content: [{ type: 'paragraph' }] }) } catch { /* 保持 applied=false */ }
          }
          emit(`turninto:${id}`, { applied })
          return true
        }
        case 'align': {
          const [kind, val] = String(value || '').split(':')
          if (kind === 'align') this.setAlign?.(val)
          else if (kind === 'valign') this.applyCellAlign?.('verticalAlign', val)
          else if (kind === 'indent') this.changeIndent?.(Number(val))
          return true
        }
        case 'highlight': {
          const [kind, ...rest] = String(value || '').split(':')
          const color = rest.join(':')
          if (value === 'highlight:clear') { this.run('unsetColor'); this.run('unsetHighlight') }
          else if (kind === 'color') this.applyTextColor?.(color)
          else if (kind === 'bg') this.applyTextBackground?.(color)
          return true
        }
        case 'more': {
          if (value === 'translate') { emit('translate'); this.$emit?.('ai-request', 'translate') }
          else if (value === 'larkSearch') {
            emit('larkSearch')
            // 走包内真实搜索面板（与 ⌘F / 顶部「查找」同一个入口），不再用 window.find 造效果。
            this.openSearch?.('find')
            if (text) { this.setSearchQuery?.(text); this.scheduleSearchUpdate?.() }
          }
          return true
        }
        case 'remove': {
          // v12：整行 / 整列选区统一走 tableInteractionMixin.deleteSelectedTableLine()，
          // 只读真实 selectedRect 直接 dispatch，不经过 `this.run()` 的 focus 链，
          // 也不再靠 `tableSelectedLine.axis` 猜删行还是删列（用户实测会删掉相邻列）。
          // 局部框选（非完整行列）退回 deleteSelection：CellSelection 会清空单元格内容。
          if (selection instanceof CellSelection && this.deleteSelectedTableLine?.()) return true
          this.run('deleteSelection')
          return true
        }
        default: emit(`unknown:${id}`); return false
      }
    },
    /**
     * 抛一份宿主可委托监听的 DOM 事件。native host 的 `$emit` 只认识构造时传入的
     * `on{}` 白名单，v10 新增的 `lark-doc-toolbar-action` 不在其中 —— 只 $emit
     * 会让宿主完全收不到，按钮看起来就是死的。
     */
    dispatchToolbarAction(name, detail) {
      try {
        const root = this.$refs?.root
        const target = root || (typeof document !== 'undefined' ? document : null)
        const Ctor = target?.ownerDocument?.defaultView?.CustomEvent
          || (typeof CustomEvent !== 'undefined' ? CustomEvent : null)
        if (!target?.dispatchEvent || !Ctor) return
        target.dispatchEvent(new Ctor(name, { bubbles: true, composed: true, detail }))
      } catch { /* 非 DOM 环境（单测 / SSR）保持静默 */ }
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
      const fullColumn = rect.right - rect.left === 1 && rect.top === 0 && rect.bottom === map.height
      const fullRow = rect.bottom - rect.top === 1 && rect.left === 0 && rect.right === map.width
      return fullColumn || fullRow ? 'line' : 'multi'
    },
    /** line 态锚点所需的 `{axis,index}`：`tableSelectedLine` 缺失时从真实 rect 反推。 */
    tableCellLineFromRect(selection) {
      const editor = this.editor
      if (!editor?.state || !(selection instanceof CellSelection)) return null
      let rect
      try { rect = selectedRect(editor.state) } catch { return null }
      const { map } = rect
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
      if (selected.axis === 'column') {
        const cells = table.querySelector('tr')?.cells
        const cell = cells?.[selected.index] || cells?.[0]
        const cr = cell?.getBoundingClientRect()
        return {
          x: cr ? cr.left + cr.width / 2 : rect.left + rect.width / 2,
          y: rect.top,
          placement: 'top',
        }
      }
      const row = table.querySelectorAll('tr')[selected.index]
      const rr = row?.getBoundingClientRect()
      return {
        x: rect.left,
        y: rr ? rr.top + rr.height / 2 : rect.top + rect.height / 2,
        placement: 'left',
      }
    },
    refreshTableTools() {
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
      return {
        open: true,
        kind: boundary.hover,
        style: boundary.style,
        columnLineLeft: boundary.columnLineLeft,
        rowLineTop: boundary.rowLineTop,
        plusUp: boundary.plusUp,
        plusDown: boundary.plusDown,
        // `nearestIdx` 选出的那条内部边线决定插入命令（before / after）。
        actionId: boundary.actionId,
        // v6：hover 内部边线即亮线（用户口径「交界处需要高亮，并且有 + 号」）。
        // 旧实现 lineVisible 只认 plusActive（＋ 被 hover 才挂线），悬浮交界处只见
        // ＋ 不见线 —— open 闸门已保证只在 hover 边线时进入本分支，这里恒亮。
        lineVisible: true,
        lineLength: boundary.hover === 'row' ? tableWidth : tableHeight,
      }
    },
    refreshTableBoundary() {
      if (!this._tableBoundaryUi) return
      this._tableBoundaryUi.update(this.buildTableBoundaryState())
    },
    destroyTableTools() {
      if (this._tableToolsUi) this._tableToolsUi.destroy()
      if (this._tableBoundaryUi) this._tableBoundaryUi.destroy()
      this.destroyTableOverlays?.()
      this._tableToolsUi = null
      this._tableBoundaryUi = null
    },
  },
}
