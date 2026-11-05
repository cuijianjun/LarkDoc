/**
 * bubbleMenuMixin — 划词浮动工具条（对齐飞书：AI 入口 → 标题级别 → 对齐缩进 →
 * 行内格式 → 高亮取色 → 复制）。
 *
 * 通过 this.editor、this.writable()、this.changeIndent()/this.setAlign()/this.toggleMark()
 * （主组件方法）协作；selectionPacingMixin 的 onSelectionUpdate 会读写 bubbleVisible 并调用
 * closeBubbleAlignMenu / closeBubbleHeadingMenu。
 *
 * 阶段 5 批次 1 起**渲染层已原生化**：`editor/BubbleBar.vue` 删掉了，DOM 由
 * `src/ui/bubbleBar.js`（纯 DOM、零框架）创建，本 mixin 只负责「算状态 → 推给 UI」。
 * 因此：模板不再驱动显隐/定位，任何入口改完状态都必须落到 `refreshBubbleBar()`；
 * 对外口子（`bubbleVisible` / `bubblePosition` / `bubbleSafeTop()` / `closeBubbleAlignMenu()`
 * / `closeBubbleHeadingMenu()` / `positionBubbleAlignMenu()`）一个都不能少 ——
 * `selectionPacingMixin`、`overlayDismissMixin`、`readingModeMixin` 与单测都在用。
 */
import { computeOrderedListNumbers, maxIndentAt } from '../documentOperations'
import { createBubbleBar } from '../../../ui/bubbleBar'

// 飞书气泡条的行内格式顺序：加粗 → 删除线 → 斜体 → 下划线 → 行内代码 → 高亮（带取色）。
const BUBBLE_MARK_ORDER = [
  { id: 'bold', icon: 'mark-bold', label: '加粗' },
  { id: 'strike', icon: 'mark-strike', label: '删除线' },
  { id: 'italic', icon: 'mark-italic', label: '斜体' },
  { id: 'underline', icon: 'mark-underline', label: '下划线' },
  { id: 'code', icon: 'inlineCode', label: '行内代码' },
]

// 对齐四项的顺序（与 `bubbleBar.js` 里的 `ALIGN_ORDER` 一致，UI 按下标对号入座）。
const BUBBLE_ALIGN_ORDER = ['left', 'center', 'right', 'justify']

// 气泡条的标题级别下拉与工具栏共用 LarkDocHeadingMenu（同一份选项与观感），
// 这里不再维护自己的 opt 列表——两处各写一份就会像以前那样慢慢分叉。

export default {
  data() { return {
    bubbleVisible: false, bubblePosition: { left: 20, top: 120 }, bubbleAlignOpen: false,
    bubbleHeadingOpen: false,
    // 气泡条下拉的 hover 关闭定时器：鼠标离开触发器/弹层后延时关闭（跨 6px 间隙不误关）。
    bubbleCloseTimer: null,
  } },
  computed: {
    bubbleMarkItems() {
      if (!this.larkDocConfig.features.marks) return []
      const allow = this.larkDocConfig.toolbar.marksAllow
      const allowSet = Array.isArray(allow) ? allow : null
      return BUBBLE_MARK_ORDER.filter((item) => !allowSet || allowSet.includes(item.id))
    },
    bubbleHighlightAllowed() {
      if (!this.larkDocConfig.features.marks) return false
      const allow = this.larkDocConfig.toolbar.marksAllow
      return !Array.isArray(allow) || allow.includes('highlight')
    },
  },
  // 原生化之后 DOM 不再由模板驱动：这四个字段是气泡条的全部输入，
  // 任何一处变化都要重新算 state 推给 `src/ui/bubbleBar.js`。
  // Vue 的 watcher 在渲染帧前批量触发，节奏与过去模板重渲染一致。
  watch: {
    bubbleVisible() { this.refreshBubbleBar() },
    bubblePosition() { this.refreshBubbleBar() },
    bubbleAlignOpen() { this.refreshBubbleBar() },
    bubbleHeadingOpen() { this.refreshBubbleBar() },
  },
  methods: {
    /**
     * 挂载原生气泡条（由主组件 `mounted` 调用）。
     * 宿主是模板里 `<div ref="bubbleHost" />` 那个空 div —— 它必须在
     * `ref="root"` 的 `<section class="lark-doc">` 内：气泡条所有样式都带
     * `.lark-doc ` 前缀，挂在外面等于全部失效。
     */
    mountBubbleBar() {
      if (this._bubbleUi) return
      const host = this.$refs.bubbleHost
      if (!host) return
      this._bubbleUi = createBubbleBar(host, {
        config: this.bubbleBarConfig(),
        handlers: {
          safeTop: () => this.bubbleSafeTop(),
          onAi: () => this.$emit('ai-request', 'rewrite'),
          onCancelHoverClose: () => this.cancelBubbleHoverClose(),
          onHeadingOpen: () => this.openBubbleHeadingMenu(),
          onHeadingLeave: () => this.scheduleBubbleHeadingClose(),
          onHeadingChoose: (level) => this.bubbleHeadingAction(level),
          onAlignOpen: () => this.openBubbleAlignMenu(),
          onAlignLeave: () => this.scheduleBubbleAlignClose(),
          onAlignAction: (id) => this.bubbleAlignAction(id),
          onToggleMark: (id) => this.toggleMark(id),
          // 透传原事件：`toggleColorPalette` 要靠 `currentTarget` 定位取色面板。
          onPalette: (event) => this.toggleColorPalette('textBackground', event),
          onCopy: () => this.bubbleCopy(),
        },
      })
      this.refreshBubbleBar()
    },
    destroyBubbleBar() {
      if (!this._bubbleUi) return
      this._bubbleUi.destroy()
      this._bubbleUi = null
    },
    /** 特性快照：气泡条哪几段存在由它决定（段序断言依赖于此）。 */
    bubbleBarConfig() {
      return {
        ai: this.featureEnabled('ai'),
        blockStyle: this.featureEnabled('blockStyle'),
        marks: this.bubbleMarkItems,
        highlightAllowed: this.bubbleHighlightAllowed,
      }
    },
    /**
     * 气泡条 DOM 的唯一写入口：显隐、位置、按钮选中态、菜单开合一次推平。
     * 隐藏态走最便宜的分支（只比对布尔，不碰文档）。
     */
    refreshBubbleBar() {
      const bar = this._bubbleUi
      if (!bar) return
      if (!this.bubbleVisible || this.effectiveReadonly) { bar.hide(); return }
      bar.setConfig(this.bubbleBarConfig())
      const alignValue = this.bubbleAlignValue()
      bar.update({
        left: this.bubblePosition.left,
        top: this.bubblePosition.top,
        headingValue: this.bubbleHeadingValue(),
        headingOpen: this.bubbleHeadingOpen,
        headingLevel: this.bubbleHeadingLevel(),
        alignOpen: this.bubbleAlignOpen,
        alignValue,
        alignItems: BUBBLE_ALIGN_ORDER.map((id) => ({ id, glyph: this.alignGlyphs[id], name: this.alignNames[id], tooltip: this.bubbleAlignTooltip(id), active: alignValue === id })),
        canIncrease: this.bubbleAlignCanIncrease(),
        increaseTooltip: this.bubbleAlignTooltip('increaseIndent'),
        canDecrease: this.bubbleAlignIndent() > 0,
        decreaseTooltip: this.bubbleAlignTooltip('decreaseIndent'),
        marks: this.bubbleMarkItems.map((item) => ({ id: item.id, active: this.isActive(item.id) })),
        highlightActive: this.isActive('highlight'),
      })
    },
    /**
     * 顶部安全线：sticky/fixed 的顶栏（标题栏、工具栏）会盖住视口上沿，
     * 气泡条下拉是 `position: fixed`，必须让下界至少排到这些栏的底边之下，
     * 否则菜单会压到功能栏上（飞书里弹层永远在工具栏下面）。
     */
    bubbleSafeTop() {
      const root = this.$refs.root
      if (!root) return 8
      let bottom = 8
      root.querySelectorAll('.lark-doc-topbar, .lark-doc-toolbar').forEach((bar) => {
        const position = getComputedStyle(bar).position
        if (position !== 'sticky' && position !== 'fixed') return
        const rect = bar.getBoundingClientRect()
        // 只认真正吸在视口上沿的那些栏；正常文档流里的顶栏不该压住弹层。
        if (rect.top <= 1 && rect.bottom > bottom) bottom = rect.bottom
      })
      return Math.round(bottom) + 6
    },
    cancelBubbleHoverClose() { if (this.bubbleCloseTimer) { clearTimeout(this.bubbleCloseTimer); this.bubbleCloseTimer = null } },
    /** 鼠标离开触发器或弹层：延时关闭（进入另一侧会取消，跨间隙不闪）。 */
    scheduleBubbleHoverClose(close) {
      this.cancelBubbleHoverClose()
      this.bubbleCloseTimer = setTimeout(() => { this.bubbleCloseTimer = null; close() }, 160)
    },
    scheduleBubbleHeadingClose() { this.scheduleBubbleHoverClose(() => { if (this.bubbleHeadingOpen) this.closeBubbleHeadingMenu() }) },
    scheduleBubbleAlignClose() { this.scheduleBubbleHoverClose(() => { if (this.bubbleAlignOpen) this.closeBubbleAlignMenu() }) },
    bubbleAlignNode() {
      if (!this.editor || this.editor.state.selection.node) return null
      const { $from } = this.editor.state.selection
      for (let depth = $from.depth; depth > 0; depth -= 1) {
        const node = $from.node(depth)
        if (node.type.name === 'paragraph' || node.type.name === 'heading') return node
      }
      return null
    },
    bubbleAlignValue() { return this.bubbleAlignNode()?.attrs?.textAlign || 'left' },
    bubbleAlignIndent() { return Number(this.bubbleAlignNode()?.attrs?.indent) || 0 },
    bubbleAlignPos() {
      if (!this.editor) return -1
      const { $from } = this.editor.state.selection
      for (let depth = $from.depth; depth > 0; depth -= 1) {
        const node = $from.node(depth)
        if (node.type.name === 'paragraph' || node.type.name === 'heading') return $from.before(depth)
        if (Number.isInteger(node.attrs?.indent)) return $from.before(depth)
      }
      return -1
    },
    // 增加缩进的上限由「前一个块」决定（缩进 = 成为上一个块的子块）。
    bubbleAlignIndentLimit() {
      if (!this.editor) return 0
      return maxIndentAt(this.editor.state.doc, this.bubbleAlignPos(), this.maxBlockIndent)
    },
    bubbleAlignCanIncrease() { return this.bubbleAlignIndent() < this.bubbleAlignIndentLimit() },
    bubbleAlignTooltip(id) {
      const shortcuts = { left: '⌘ + Shift + L', center: '⌘ + Shift + E', right: '⌘ + Shift + R', justify: '⌘ + Shift + J' }
      if (shortcuts[id]) return shortcuts[id]
      if (id === 'increaseIndent' && !this.bubbleAlignCanIncrease()) return '当前内容块已达最大缩进层级'
      if (id === 'decreaseIndent' && this.bubbleAlignIndent() <= 0) return '当前内容块已达最小缩进层级'
      return id === 'increaseIndent' ? '增加缩进' : '减少缩进'
    },
    openBubbleAlignMenu() {
      if (!this.bubbleVisible || !this.writable()) return
      this.cancelBubbleHoverClose()
      // 已经开着：只是位置要跟着选区/滚动重算一次。
      if (this.bubbleAlignOpen) { this.positionBubbleAlignMenu(); return }
      this.closeBubbleHeadingMenu()
      this.bubbleAlignOpen = true
      // 原生 DOM 同步插入即可同步测量，旧版这里的 `$nextTick(() => position…)` 已删除。
      this.refreshBubbleBar()
    },
    closeBubbleAlignMenu() {
      this.cancelBubbleHoverClose()
      if (!this.bubbleAlignOpen) return
      this.bubbleAlignOpen = false
    },
    /** 滚动/尺寸变化时由主组件的 rAF 调用（菜单已开才动）。 */
    positionBubbleAlignMenu() { if (this._bubbleUi) this._bubbleUi.positionAlignMenu() },
    bubbleAlignAction(id) {
      if (!this.writable()) return
      if (id === 'increaseIndent') this.changeIndent(1)
      else if (id === 'decreaseIndent') this.changeIndent(-1)
      else this.setAlign(id)
      this.closeBubbleAlignMenu()
    },
    // —— 标题级别下拉（飞书气泡条第二组：把选中的正文/标题在 H1~H9 与正文之间互转）——
    /** 当前块的标题级别：null = 正文，1~9 = H1~H9（传给共用的 LarkDocHeadingMenu 做选中态）。 */
    bubbleHeadingLevel() {
      const node = this.bubbleAlignNode()
      if (!node || node.type.name !== 'heading') return null
      const level = Number(node.attrs?.level)
      return Number.isInteger(level) ? level : 1
    },
    bubbleHeadingValue() { const level = this.bubbleHeadingLevel(); return level == null ? '正文' : `H${level}` },
    // 飞书口径：标题级别下拉与「缩进和对齐」同构——悬停 / 聚焦 / 点击入口都展开，无需二次点击。
    openBubbleHeadingMenu() {
      if (!this.bubbleVisible || !this.writable()) return
      this.cancelBubbleHoverClose()
      if (this.bubbleHeadingOpen) { this.positionBubbleHeadingMenu(); return }
      this.closeBubbleAlignMenu()
      this.bubbleHeadingOpen = true
      this.refreshBubbleBar()
    },
    toggleBubbleHeadingMenu() {
      if (!this.writable()) return
      this.closeBubbleAlignMenu()
      this.cancelBubbleHoverClose()
      this.bubbleHeadingOpen = !this.bubbleHeadingOpen
      this.refreshBubbleBar()
    },
    closeBubbleHeadingMenu() {
      this.cancelBubbleHoverClose()
      if (!this.bubbleHeadingOpen) return
      this.bubbleHeadingOpen = false
    },
    positionBubbleHeadingMenu() { if (this._bubbleUi) this._bubbleUi.positionHeadingMenu() },
    /** @param {number|null} level 标题级别（null = 正文），由 LarkDocHeadingMenu 的 choose 事件传入。 */
    bubbleHeadingAction(level) {
      if (!this.writable()) return
      const { state } = this.editor
      const target = Number.isInteger(level) ? level : null
      const targetType = target == null ? state.schema.nodes.paragraph : state.schema.nodes.heading
      if (!targetType) { this.closeBubbleHeadingMenu(); return }
      const { blocks, listItems } = this.bubbleHeadingTargets()
      if (blocks.length) {
        const tr = state.tr
        blocks.forEach((pos) => {
          const node = tr.doc.nodeAt(pos)
          if (!node || node.type !== targetType || (target != null && Number(node.attrs?.level) !== target)) {
            tr.setNodeMarkup(pos, targetType, { ...node.attrs, level: target == null ? null : target })
          }
        })
        if (tr.docChanged) this.editor.view.dispatch(tr)
      }
      // 列表项不能直接变标题（listItem 的内容约束是 paragraph + block），先从列表里提出来再改类型。
      // 倒序处理：每提一个位置都会变，靠 blockId 重新定位，不受前面的偏移影响。
      listItems.slice().reverse().forEach((item) => this.convertListItemToBlock(item, target))
      // 只收起下拉、不收起气泡条：选区还在，气泡条跟着选区走（mark 按钮那边才会收起）。
      this.closeBubbleHeadingMenu()
    },
    /** 按 blockId 找当前位置（列表项被提出去后位置会变）。 */
    blockPosById(blockId) {
      if (typeof blockId !== 'string' || !this.editor) return -1
      let found = -1
      this.editor.state.doc.descendants((node, pos) => {
        if (found !== -1) return false
        if (node.attrs && node.attrs.blockId === blockId) { found = pos; return false }
        return true
      })
      return found
    },
    /**
     * 选区里可改块类型的文本块。
     * - `blocks`：直接改类型的块位置（正文 / 标题）
     * - `listItems`：列表里的文本块，要「先提出列表再改类型」，附带是否有序（有序的序号要转成标题编号）
     * 引用 / 高亮块内部的文本块不参与（与飞书一致：气泡条标题下拉不改容器内的块）。
     */
    bubbleHeadingTargets() {
      const { state } = this.editor
      const { from, to } = state.selection
      const blocks = []
      const listItems = []
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isTextblock) return true
        if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return false
        const $pos = state.doc.resolve(pos)
        const parent = $pos.parent
        if (parent?.type?.name === 'listItem' || parent?.type?.name === 'taskItem') {
          listItems.push({ blockId: node.attrs?.blockId, ordered: parent.type.name === 'listItem' })
          return false
        }
        if (['blockquote', 'callout'].includes(parent?.type?.name)) return false
        blocks.push(pos)
        return false
      })
      return { blocks, listItems }
    },
    /**
     * 列表项 → 普通块：`liftListItem` 把它从列表里提出来（列表在前后各留一段），再改成标题 / 正文。
     * 有序列表的序号顺势落到标题编号上（飞书里「2.」变标题后仍是「2.」），
     * 后面那半段列表显式记住起点（index + 1），不至于因为被标题隔开又从 1. 数。
     */
    convertListItemToBlock(item, level) {
      if (!this.editor) return false
      const start = this.blockPosById(item.blockId)
      if (start < 0) return false
      const doc = this.editor.state.doc
      const $start = doc.resolve(start)
      // resolve 在块边界处 depth 会「少一层」，不能靠 $start.depth - 1 定位 listItem；
      // 向上逐层找 listItem，拿到它的 pos 再查编号（computeOrderedListNumbers 的 key 是 listItem pos）。
      let itemPos = -1
      for (let depth = $start.depth; depth > 0; depth -= 1) {
        if ($start.node(depth).type.name === 'listItem') { itemPos = $start.before(depth); break }
      }
      const index = item.ordered ? (computeOrderedListNumbers(doc).get(itemPos)?.index ?? null) : null
      // 提出去之后紧跟的兄弟列表（若还接着数，要把起点写死，否则它会重新从 1 开始）。
      const lifted = this.editor.chain().setTextSelection(start + 1).liftListItem('listItem').run()
      if (!lifted) return false
      const pos = this.blockPosById(item.blockId)
      if (pos < 0) return false
      const node = this.editor.state.doc.nodeAt(pos)
      if (!node) return false
      const type = level == null ? this.editor.state.schema.nodes.paragraph : this.editor.state.schema.nodes.heading
      if (!type) return false
      const attrs = { ...node.attrs }
      if (level != null) {
        attrs.level = level
        attrs.numbering = index != null
        attrs.numberingStart = index == null ? null : index
      } else {
        attrs.numbering = false
        attrs.numberingStart = null
      }
      const tr = this.editor.state.tr.setNodeMarkup(pos, type, attrs)
      // 后面紧邻的列表接着数：写 <ol start>（被标题隔开后无法用 continueFrom 连号）。
      const next = tr.doc.nodeAt(pos + node.nodeSize)
      if (next && next.type.name === 'orderedList' && index != null) {
        const hasOwnStart = Number(next.attrs?.start) > 1 || next.attrs?.continueFrom === true
        if (!hasOwnStart) tr.setNodeMarkup(pos + node.nodeSize, next.type, { ...next.attrs, start: index + 1 })
      }
      this.editor.view.dispatch(tr)
      return true
    },
    /** 复制选中的纯文本（飞书气泡条最右侧的复制入口）。 */
    bubbleCopy() {
      if (!this.editor) return
      const { from, to, empty } = this.editor.state.selection
      if (empty) return
      const text = this.editor.state.doc.textBetween(from, to, '\n')
      const fallback = () => {
        const area = document.createElement('textarea')
        area.value = text
        area.style.position = 'fixed'
        area.style.opacity = '0'
        document.body.appendChild(area)
        area.select()
        try { document.execCommand('copy') } catch (error) { /* 剪贴板不可用时静默 */ }
        document.body.removeChild(area)
      }
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).catch(fallback)
      else fallback()
    },
  },
}
