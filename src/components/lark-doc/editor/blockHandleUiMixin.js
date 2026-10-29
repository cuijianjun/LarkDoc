/**
 * blockHandleUiMixin — 区块句柄 + 块菜单（阶段 5 批次 3 原生化接线层）。
 *
 * 与批次 1/2 的 `bubbleMenuMixin` / `toolbarUiMixin` 同一套范式：**渲染层已不是模板**，
 * DOM 由 `src/ui/blockHandle.js`（纯 DOM、零框架）创建，本 mixin 只做
 * 「把状态算成一份 state → 推给 UI」。
 *
 * 三条必须守住的线：
 *
 * 1. **两段式**：`refreshBlockHandle()` 只写句柄本体（`pointermove` 热路径，
 *    每秒几十次，绝不能顺带重算 9 项类型网格）；`refreshBlockMenu()` 才重算菜单内容。
 *    两者都会重排根节点子节点（菜单的挂/摘由同一份 state 决定）。
 * 2. **`handleRange` 是句柄的开关**：`v-if` 时代它一变模板就重画。原生层靠
 *    `watch: handleRange` 兜底 —— 全仓有 5 处直接写 `this.handleRange = null`
 *    （`scheduleHandleHide` / 正文替换 / callout 展开…），逐个补 refresh 必漏。
 * 3. **同步定位**：`openBlockMenu()` 先渲染菜单再 `positionBlockMenu()`，
 *    `getBoundingClientRect()` 当场可量 —— SFC 里那串 `$nextTick` 就此消失。
 */
import { createBlockHandle } from '../../../ui/blockHandle'

export default {
  watch: {
    handleRange() { this.refreshBlockHandle() },
    effectiveReadonly() { this.refreshBlockHandle(); this.refreshBlockMenu() },
    larkDocConfig() { this.refreshBlockHandle(); this.refreshBlockMenu() },
    // 颜色子菜单的色板来自内容主题（深/浅色），主题一换选项就换。
    contentTheme() { this.refreshBlockMenu() },
    alignNames: { deep: true, handler() { this.refreshBlockMenu() } },
    alignGlyphs: { deep: true, handler() { this.refreshBlockMenu() } },
    // —— 开合与定位：SFC 时代这些是模板插值，Vue 渲染 watcher 自动跟进；原生层必须显式推。
    // 时序也与 SFC 等价：watcher 在 DOM flush 前跑（菜单因此入 DOM），mixin 里
    // `positionBlockMenu` 包的 `$nextTick` 回调晚于 flush，量的就是已布局好的盒子。
    blockMenuOpen() { this.refreshBlockMenu() },
    blockAlignMenuOpen() { this.refreshBlockMenu() },
    blockColorMenuOpen() { this.refreshBlockMenu() },
    blockMenuStyle() { this.refreshBlockMenu() },
    blockAlignMenuStyle() { this.refreshBlockMenu() },
    blockColorMenuStyle() { this.refreshBlockMenu() },
    // 句柄坐标：`blockHandleStyle` 是 computed，只有 `blockHandlePosition` 会变。
    blockHandlePosition: { deep: true, handler() { this.refreshBlockHandle() } },
  },
  methods: {
    /**
     * 挂载原生句柄（由主组件 `mounted` 调用）。
     *
     * `ref="blockHandleHost"` 只是**锚点**：句柄节点插在它**前面**，作为
     * `.lark-doc-paper` 的直接子节点。位置必须在 `.lark-doc-drop-line` 与
     * `#lark-doc-editor` 之前 —— 落点线是 `top: Npx` 的绝对定位，句柄插到它后面
     * 会让同时出现时的层叠顺序与 SFC 不一致。
     */
    mountBlockHandle() {
      if (this._blockHandleUi) return
      const anchor = this.$refs.blockHandleHost
      if (!anchor || !anchor.parentNode) return
      this._blockHandleUi = createBlockHandle({
        host: anchor.parentNode,
        anchor,
        handlers: this.blockHandleHandlers(),
      })
      this.refreshBlockHandle()
      this.refreshBlockMenu()
    },
    destroyBlockHandle() {
      if (!this._blockHandleUi) return
      this._blockHandleUi.destroy()
      this._blockHandleUi = null
    },

    /**
     * handler 全表（键名与 `BlockHandleMenu.vue` 里的 `ed.xxx` 一一对应）。
     *
     * 三处**刻意对齐 Vue 的调用形态**：
     * - `openEmptyBlockInsertMenu` / `openBlockMenu`：SFC 是方法引用写法，Vue 把原生
     *   事件当第一参传入。`openEmptyBlockInsertMenu` 靠 `event.currentTarget` 取
     *   rect 定位命令菜单，事件必须原样透传。
     * - `emitAiRequest`：SFC 是内联表达式 `ed.$emit('ai-request','rewrite')`，
     *   没有对应方法，所以直接在这里 emit。
     * - `pressHandle` / `endBlockDrag`：不带参数的方法，别塞事件进去。
     */
    blockHandleHandlers() {
      return {
        onHandleEnter: (event) => this.onBlockHandleEnter(event),
        onHandleLeave: (event) => this.onBlockHandleLeave(event),
        openEmptyBlockInsertMenu: (event) => this.openEmptyBlockInsertMenu(event),
        openBlockMenuOnHover: (event) => this.openBlockMenuOnHover(event),
        openBlockMenu: (event) => this.openBlockMenu(event),
        pressHandle: () => this.pressHandle(),
        startBlockDrag: (event) => this.startBlockDrag(event),
        endBlockDrag: () => this.endBlockDrag(),
        onBlockMenuEnter: () => this.onBlockMenuEnter(),
        onBlockMenuLeave: (event) => this.onBlockMenuLeave(event),
        onBlockMenuFocusIn: () => this.onBlockMenuFocusIn(),
        onBlockMenuFocusOut: (event) => this.onBlockMenuFocusOut(event),
        emitAiRequest: (kind) => this.$emit('ai-request', kind),
        blockTypeAction: (id) => this.blockTypeAction(id),
        blockAction: (id) => this.blockAction(id),
        openBlockAlignMenuOnHover: (event) => this.openBlockAlignMenuOnHover(event),
        openBlockColorMenuOnHover: (event) => this.openBlockColorMenuOnHover(event),
        blockColorAction: (value) => this.blockColorAction(value),
        tableHandleAction: (id) => this.tableHandleAction(id),
        blockAlignAction: (id) => this.blockAlignAction(id),
      }
    },

    /** 句柄本体 state（热路径，字段越少越好）。 */
    buildBlockHandleState() {
      const blockStyle = this.featureEnabled('blockStyle')
      return {
        // 模板条件：`ed.editor && !ed.effectiveReadonly && featureEnabled('blockHandle') && handleRange`
        visible: !!(this.editor && !this.effectiveReadonly && this.featureEnabled('blockHandle') && this.handleRange),
        style: this.blockHandleStyle,
        menuOpen: this.blockMenuOpen,
        alignOpen: !!this.blockAlignMenuOpen && blockStyle,
        blockStyle,
        buttonKind: this.handleIsEmptyParagraph ? 'empty' : this.handleIsTaskList ? 'none' : 'main',
        glyph: this.handleGlyph,
        isCallout: this.handleBlockNode()?.type?.name === 'callout',
        draggable: this.featureEnabled('blockDrag'),
      }
    },

    /** 菜单内容 state（只在开合、配置、文档/选区变化时算）。 */
    buildBlockMenuState() {
      const blockStyle = this.featureEnabled('blockStyle')
      return {
        menuOpen: this.blockMenuOpen,
        alignOpen: !!this.blockAlignMenuOpen && blockStyle,
        colorOpen: !!this.blockColorMenuOpen && blockStyle,
        blockStyle,
        features: {
          ai: this.featureEnabled('ai'),
          blockStyle,
          tables: this.featureEnabled('tables'),
        },
        typeActions: this.visibleBlockTypeActions.map((item) => ({
          id: item.id,
          label: item.label,
          icon: item.icon,
          active: this.blockTypeActive(item.id),
        })),
        listActions: this.visibleBlockListActions.map((item) => ({ id: item.id, label: item.label, icon: item.icon })),
        table: this.handleIsTable,
        tableHeader: this.handleTableHeaderState(),
        canDuplicate: this.isBlockActionEnabled('duplicate'),
        canAddBelow: this.isBlockActionEnabled('addBelow'),
        menuStyle: this.blockMenuStyle,
        alignMenuStyle: this.blockAlignMenuStyle,
        colorMenuStyle: this.blockColorMenuStyle,
        colors: this.colorPaletteOptions.map((color) => ({ value: color.value, label: color.label })),
        align: {
          value: this.blockAlignValue(),
          indent: this.blockAlignIndent(),
          canIncrease: this.blockAlignCanIncrease(),
        },
        alignGlyphs: this.alignGlyphs,
        alignNames: this.alignNames,
      }
    },

    refreshBlockHandle() {
      const ui = this._blockHandleUi
      if (!ui) return
      ui.updateChrome(this.buildBlockHandleState())
    },

    refreshBlockMenu() {
      const ui = this._blockHandleUi
      if (!ui) return
      ui.updateMenu(this.buildBlockMenuState())
    },
  },
}
