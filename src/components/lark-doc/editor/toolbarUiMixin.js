/**
 * toolbarUiMixin — 顶栏 + 工具栏（阶段 5 批次 2 原生化接线层）。
 *
 * 与批次 1 的 `bubbleMenuMixin` 同一套范式：**渲染层已不是模板**，DOM 由
 * `src/ui/topBar.js` / `src/ui/toolbar.js`（纯 DOM、零框架）创建，本 mixin 只做
 * 「把散落在十几个 mixin 里的状态算成一份 state → 推给 UI」。
 *
 * 三条必须守住的线：
 *
 * 1. **DOM 不再由 Vue 驱动**，所以任何一处改了状态都不会自动重画 —— 每个输入字段
 *    都要在 `watch` 里落到 `refreshToolbar()` / `refreshTopBar()`。漏一个就是
 *    「点了没反应」。
 * 2. **`isActive()` / `currentBlockLabel` / `blockIndentLevel()` 读的是编辑器实时
 *    state，不是响应式数据**，watcher 抓不到。它们靠 `onTransaction` 与
 *    `onSelectionUpdate`（主组件里显式调用 `refreshToolbar()`）兜底 ——
 *    `selectionPacingMixin.runSelectionLayout()` 确认不刷工具栏，别指望它。
 * 3. **`header-actions` 是 Vue 插槽**，原生层接不住：主组件持有一个常驻宿主节点
 *    （模板里的隐藏 `ref="actionsHost"`，内部仍是 `<slot name="header-actions" />`，
 *    内容照旧由 Vue 渲染），工具栏/顶栏只负责把它搬进自己的容器。关菜单后宿主
 *    自动回到停泊位（`topBar.js` 每次 update 都会比对父节点），插槽内容不受影响。
 */
import { createToolbar } from '../../../ui/toolbar'
import { createTopBar } from '../../../ui/topBar'

export default {
  // 原生化之后这些字段就是 UI 的唯一输入。Vue 的 watcher 在渲染帧前批量触发，
  // 节奏与过去模板重渲染一致。
  watch: {
    /* ---------- 工具栏：分组折叠 ---------- */
    collapsedGroups() { this.refreshToolbar() },
    /* ---------- 工具栏：四个下拉 ---------- */
    headingOpen() { this.refreshToolbar() },
    headingStyle() { this.refreshToolbar() },
    headerMenuOpen() { this.refreshToolbar() },
    headerMenuStyle() { this.refreshToolbar() },
    diagramMenuOpen() { this.refreshToolbar() },
    diagramMenuStyle() { this.refreshToolbar() },
    moreMenuOpen() { this.refreshToolbar() },
    moreMenuStyle() { this.refreshToolbar() },
    /* ---------- 工具栏：取色面板 ---------- */
    colorPaletteOpen() { this.refreshToolbar() },
    // `appliedTextStyle` 是**按键写**的（`this.appliedTextStyle.textColor = x`），
    // 浅比较抓不到，必须 deep。
    appliedTextStyle: { deep: true, handler() { this.refreshToolbar() } },
    /* ---------- 工具栏：只读 / 视图态 ---------- */
    effectiveReadonly() { this.refreshToolbar(); this.refreshTopBar() },
    widthMode() { this.refreshToolbar() },
    outlineOpen() { this.refreshToolbar() },
    reading() { this.refreshToolbar() },
    fullscreen() { this.refreshToolbar() },
    slides() { this.refreshToolbar() },
    helpOpen() { this.refreshToolbar() },
    // 对齐按钮的文案来自 alignNames（宿主可换语言），换配置要跟着变。
    alignNames: { deep: true, handler() { this.refreshToolbar() } },
    // `larkDocConfig` 是 computed，配置一变就是新对象：分组显隐（toolbarEnabled）、
    // 「文档操作」按钮（layout.headerVisible）全在它身上。
    larkDocConfig() { this.refreshToolbar(); this.refreshTopBar() },
    /* ---------- 顶栏 ---------- */
    mode() { this.refreshTopBar() },
    modeMenuOpen() { this.refreshTopBar() },
    modeMenuPos() { this.refreshTopBar() },
    localTitle() { this.refreshTopBar() },
  },
  methods: {
    /**
     * 挂载原生工具栏（由主组件 `mounted` 调用）。
     *
     * 模板里的 `<div ref="toolbarHost" />` 只是**锚点**：原生节点插在它**前面**、做
     * `<section class="lark-doc">` 的直接子节点，而不是塞进锚点里。原因很硬：
     * `position: sticky` 只在「包含块内部还有可移动余量」时才吸附，套一层恰好的
     * 包裹 div 会让工具栏的包含块只有 45px 高 —— 表面 `computedStyle` 还是 sticky，
     * 滚动时却跟着内容一起滚走（批次 2 踩过）。
     */
    mountToolbarBar() {
      if (this._toolbarUi) return
      const anchor = this.$refs.toolbarHost
      if (!anchor || !anchor.parentNode) return
      this._toolbarUi = createToolbar({
        handlers: this.toolbarHandlers(),
        actionsHost: this.$refs.actionsHost || null,
        alignNames: this.alignNames,
      })
      anchor.parentNode.insertBefore(this._toolbarUi.el, anchor)
      this.refreshToolbar()
      // 折叠测量（`toolbarCollapseMixin`）依赖 `.lark-doc-toolbar` 真实节点：
      // mixin 的 `mounted` 早于本组件的 `mounted`，那时工具栏还不存在，
      // 所以 ResizeObserver 必须在这里补挂。
      if (typeof this.attachToolbarResizeObserver === 'function') this.attachToolbarResizeObserver()
      if (typeof this.evaluateToolbarFit === 'function') this.scheduleToolbarFit()
    },
    destroyToolbarBar() {
      if (!this._toolbarUi) return
      this._toolbarUi.destroy()
      this._toolbarUi = null
    },
    /**
     * 挂载原生顶栏（由主组件 `mounted` 调用）。
     * 顶栏整行是 `v-if`（`layout.headerVisible === false` 时真的不在 DOM 里），
     * 显隐由 `topBar.update()` 自己管，所以这里只给挂载点、不给条件。
     * 与工具栏同理：`host` 是 `<section class="lark-doc">` 本身、`anchor` 是模板里那个
     * 空 div —— 插在锚点前面，避免多包一层让 sticky 失效。
     */
    mountTopBar() {
      if (this._topBarUi) return
      const anchor = this.$refs.topBarHost
      if (!anchor || !anchor.parentNode) return
      this._topBarUi = createTopBar({
        host: anchor.parentNode,
        anchor,
        handlers: {
          updateTitle: (value) => this.updateTitle(value),
          toggleModeMenu: (anchorEl) => this.toggleModeMenu(anchorEl),
          setMode: (id) => this.setMode(id),
        },
        actionsHost: this.$refs.actionsHost || null,
      })
      this.refreshTopBar()
    },
    destroyTopBar() {
      if (!this._topBarUi) return
      this._topBarUi.destroy()
      this._topBarUi = null
    },

    /**
     * 工具栏 handler 全表（键名与 `ToolbarBar.vue` 里的 `ed.xxx` 一一对应）。
     *
     * 两处**刻意对齐 Vue 的调用形态**，不能想当然简化：
     * - `rememberSelection`：SFC 是 `@mousedown="ed.rememberSelection"`（方法引用，
     *   Vue 把原生事件当第一参 → `includeCursor` 恒为真）。若这里不传 `true`，
     *   空选区时不会刷新 `savedSelection`，后续 `run()` 的 `restoreSelection()`
     *   就会把光标拉回上一次的旧范围。
     * - `openColorPaletteOnHover` / `toggleColorPalette`：面板定位靠
     *   `event.currentTarget.getBoundingClientRect()`，事件必须原样透传。
     */
    toolbarHandlers() {
      return {
        /* ---------- 历史 ---------- */
        run: (command, ...args) => this.run(command, ...args),
        /* ---------- 标题级别 ---------- */
        rememberSelection: () => this.rememberSelection(true),
        openHeadingMenuOnHover: () => this.openHeadingMenuOnHover(),
        scheduleHeadingMenuClose: () => this.scheduleHeadingMenuClose(),
        toggleHeadingMenu: () => this.toggleHeadingMenu(),
        setHeading: (level) => this.setHeading(level),
        cancelPopupHoverClose: () => this.cancelPopupHoverClose(),
        /* ---------- 行内格式 ---------- */
        toggleMark: (id) => this.toggleMark(id),
        /* ---------- 文字样式 ---------- */
        openLinkDialog: () => this.openLinkDialog(),
        applyTextStyle: (key, value) => this.applyTextStyle(key, value),
        openColorPaletteOnHover: (event) => this.openColorPaletteOnHover(event),
        scheduleColorPaletteClose: () => this.scheduleColorPaletteClose(),
        toggleColorPalette: (target, event) => this.toggleColorPalette(target, event),
        applyTextColor: (value) => this.applyTextColor(value),
        applyTextBackground: (value) => this.applyTextBackground(value),
        /* ---------- 段落样式 ---------- */
        applyLineHeight: (value) => this.applyLineHeight(value),
        setAlign: (value) => this.setAlign(value),
        changeIndent: (delta) => this.changeIndent(delta),
        clearFormatting: () => this.clearFormatting(),
        /* ---------- 插入 / 表格 / 图表 / AI ---------- */
        openCommandMenu: (kind, event) => this.openCommandMenu(kind, event),
        onTableToolbarClick: () => this.onTableToolbarClick(),
        toggleDiagramMenu: () => this.toggleDiagramMenu(),
        insertDiagramType: (id) => this.insertDiagramType(id),
        // SFC 是内联表达式 `ed.$emit('ai-request', 'rewrite')`，没有对应方法。
        emitAiRequest: (kind) => this.$emit('ai-request', kind),
        /* ---------- 收尾：视图与工具 ---------- */
        // SFC 是 `ed.toggleSearchOpen(); ed.$nextTick(() => ed.$refs.searchInput?.focus())`
        // 这条内联表达式 —— 两件事都要做，不能只留一件。
        openSearchPanel: () => {
          this.toggleSearchOpen()
          this.$nextTick(() => this.$refs.searchInput?.focus())
        },
        toggleOutlineOpen: () => this.toggleOutlineOpen(),
        setWidthMode: (value) => this.setWidthMode(value),
        toggleReading: () => this.toggleReading(),
        toggleFullscreen: () => this.toggleFullscreen(),
        toggleSlides: () => this.toggleSlides(),
        toggleHelpOpen: () => this.toggleHelpOpen(),
        /* ---------- 收尾：文档操作 / 更多 ---------- */
        toggleHeaderMenu: () => this.toggleHeaderMenu(),
        openMoreMenuOnHover: () => this.openMoreMenuOnHover(),
        scheduleMoreMenuClose: () => this.scheduleMoreMenuClose(),
        toggleMoreMenuGuarded: () => this.toggleMoreMenuGuarded(),
        runMoreItem: (item, event) => this.runMoreItem(item, event),
      }
    },

    /**
     * 工具栏 DOM 的唯一写入口：分组显隐、折叠、选中态、四个下拉、取色、宽度模式
     * 一次推平。纯读状态，不碰文档。
     */
    refreshToolbar() {
      const ui = this._toolbarUi
      if (!ui) return
      ui.update(this.buildToolbarState())
      this.parkActionsHost()
    },
    refreshTopBar() {
      const ui = this._topBarUi
      if (!ui) return
      ui.update(this.buildTopBarState())
      this.parkActionsHost()
    },
    /**
     * `header-actions` 宿主的归属只有一个真相：**在 DOM 里就行**。
     * 顶栏可见 → 在顶栏右侧；「⋯」菜单开 → 在下拉里；两者都不成立（顶栏被隐藏、
     * 菜单又没开）→ 宿主的祖先已被整体摘掉，这时搬回停泊位，让 Vue 的插槽内容
     * 始终落在一个挂着的子树里（否则宿主的 DOM 更新会落进游离节点）。
     */
    parkActionsHost() {
      const host = this.$refs.actionsHost
      if (!host) return
      const park = this.$refs.actionsPark
      if (!park) return
      if (host.parentNode === park) return
      if (typeof document === 'undefined' || !document.contains(host)) park.appendChild(host)
    },

    /**
     * 顶栏 state —— 与 `TopBar.vue` 读的 `ed.xxx` 逐字段对应。
     */
    buildTopBarState() {
      return {
        headerVisible: this.larkDocConfig.layout.headerVisible !== false,
        title: this.localTitle,
        titleLength: this.titleLength,
        readonly: this.effectiveReadonly,
        mode: this.mode,
        modeLabel: this.modeLabel,
        modeIcon: this.modeIcon,
        modeMenuOpen: this.modeMenuOpen,
        modeMenuStyle: this.modeMenuStyle,
        modeOptions: this.modeOptions,
      }
    },

    /**
     * 工具栏 state —— 与 `ToolbarBar.vue` 的模板表达式逐条对应。
     *
     * 注意三处**条件不是单字段**，照抄模板：
     * - `insert` 分组的 `v-if` 是 `insert || tables || ai` 三者取或；
     * - 图表按钮要 `toolbarEnabled('insert')` **且** `features.diagram`；
     * - 「文档操作」按钮要 `!headerVisible` **且** 宿主真的传了 `header-actions` 插槽。
     */
    buildToolbarState() {
      const layout = this.larkDocConfig.layout
      const docOps = !layout.headerVisible && !!this.$slots['header-actions']

      const marks = this.visibleMarks
      const active = {}
      marks.forEach((item) => { active[item.id] = this.isActive(item.id) })
      active.link = this.isActive('link')
      active.table = this.isActive('table')

      return {
        groups: {
          history: this.toolbarEnabled('history'),
          headings: this.toolbarEnabled('headings'),
          marks: this.toolbarEnabled('marks'),
          textStyle: this.toolbarEnabled('textStyle'),
          blockStyle: this.toolbarEnabled('blockStyle'),
          insert: this.toolbarEnabled('insert') || this.toolbarEnabled('tables') || this.toolbarEnabled('ai'),
        },
        readonly: this.effectiveReadonly,
        collapsed: this.collapsedGroups,
        alignNames: this.alignNames,
        heading: {
          open: this.headingOpen,
          label: this.currentBlockLabel,
          level: this.headingActiveLevel,
          style: this.headingStyle,
        },
        marks,
        active,
        // 链接按钮的可用性：`effectiveReadonly || !hasTextSelection` 时禁用。
        // `hasTextSelection` 读编辑器实时选区，非响应式 —— 选区变化由主组件显式刷新。
        hasSelection: this.hasTextSelection,
        textStyle: this.appliedTextStyle,
        colorOpenFor: this.colorPaletteOpen,
        options: {
          fontFamily: this.fontFamilyOptions,
          fontSize: this.fontSizeOptions,
          lineHeight: this.lineHeightOptions,
          widthMode: this.widthModeOptions,
        },
        indent: {
          level: this.blockIndentLevel(),
          canIncrease: this.canIncreaseIndent(),
        },
        features: {
          insert: this.toolbarEnabled('insert'),
          tables: this.toolbarEnabled('tables'),
          diagram: this.toolbarEnabled('insert') && !!this.larkDocConfig.features.diagram,
          ai: this.toolbarEnabled('ai'),
          search: this.toolbarEnabled('search'),
          outline: this.toolbarEnabled('outline'),
          viewModes: this.toolbarEnabled('viewModes'),
          shortcuts: this.toolbarEnabled('shortcuts'),
          docOps,
        },
        diagram: {
          open: this.diagramMenuOpen,
          style: this.diagramMenuStyle,
          types: this.diagramTypes,
        },
        view: {
          reading: this.reading,
          fullscreen: this.fullscreen,
          slides: this.slides,
          outlineOpen: this.outlineOpen,
        },
        widthMode: this.widthMode,
        headerMenu: { open: this.headerMenuOpen, style: this.headerMenuStyle },
        more: {
          visible: this.collapsedGroups.length > 0,
          open: this.moreMenuOpen,
          // `visibleToolbarSections` 是 computed，而里面的 `isActive()` 读编辑器实时
          // state（非响应式）—— 缓存值在选区变化后是旧的。所以只在弹层打开时取：
          // 打开动作一定会让 `moreMenuOpen` 变化并重新触发本方法，而弹层内的勾选态
          // 只会随「点某一项」变化，那一下本来就会关掉弹层。
          sections: this.moreMenuOpen ? this.visibleToolbarSections : [],
          style: this.moreMenuStyle,
        },
      }
    },
  },
  beforeDestroy() {
    // mixin 的 `beforeDestroy` 早于组件自身的 `beforeDestroy`：这时 editor 还活着，
    // 拆 DOM 不会读到已置空的 `this.editor`。
    this.destroyToolbarBar()
    this.destroyTopBar()
  },
}
