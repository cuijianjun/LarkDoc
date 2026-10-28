/**
 * bubbleMenuMixin — 划词浮动工具条（对齐飞书：AI 入口 → 标题级别 → 对齐缩进 →
 * 行内格式 → 高亮取色 → 复制）。
 *
 * 通过 this.editor、this.writable()、this.changeIndent()/this.setAlign()/this.toggleMark()
 * （主组件方法）协作；selectionPacingMixin 的 onSelectionUpdate 会读写 bubbleVisible 并调用
 * closeBubbleAlignMenu / closeBubbleHeadingMenu。
 * 采用 mixin 而非子组件：气泡与子菜单模板留在主 SFC，依赖 Vue 2 选项合并语义。
 */
import { computeOrderedListNumbers, maxIndentAt } from '../documentOperations'

// 飞书气泡条的行内格式顺序：加粗 → 删除线 → 斜体 → 下划线 → 行内代码 → 高亮（带取色）。
const BUBBLE_MARK_ORDER = [
  { id: 'bold', icon: 'mark-bold', label: '加粗' },
  { id: 'strike', icon: 'mark-strike', label: '删除线' },
  { id: 'italic', icon: 'mark-italic', label: '斜体' },
  { id: 'underline', icon: 'mark-underline', label: '下划线' },
  { id: 'code', icon: 'inlineCode', label: '行内代码' },
]

// 气泡条的标题级别下拉与工具栏共用 LarkDocHeadingMenu（同一份选项与观感），
// 这里不再维护自己的 opt 列表——两处各写一份就会像以前那样慢慢分叉。

export default {
  data() { return {
    bubbleVisible: false, bubblePosition: { left: 20, top: 120 }, bubbleAlignOpen: false, bubbleAlignMenuStyle: {},
    bubbleHeadingOpen: false, bubbleHeadingMenuStyle: {},
    // 气泡条下拉的 hover 关闭定时器：鼠标离开触发器/弹层后延时关闭（跨 6px 间隙不误关）。
    bubbleCloseTimer: null,
  } },
  computed: {
    bubbleStyle() { return { left: `${this.bubblePosition.left}px`, top: `${this.bubblePosition.top}px` } },
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
  methods: {
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
      if (this.bubbleAlignOpen) { this.$nextTick(() => this.positionBubbleAlignMenu()); return }
      this.closeBubbleHeadingMenu()
      this.bubbleAlignOpen = true
      this.bubbleAlignMenuStyle = {}
      this.$nextTick(() => this.positionBubbleAlignMenu())
    },
    closeBubbleAlignMenu() {
      this.cancelBubbleHoverClose()
      this.bubbleAlignOpen = false
      this.bubbleAlignMenuStyle = {}
    },
    positionBubbleAlignMenu() {
      if (!this.bubbleAlignOpen) return
      const root = this.$refs.root
      const trigger = root?.querySelector('.lark-doc-bubble-align-trigger')
      const menu = root?.querySelector('.lark-doc-bubble-align-menu')
      if (!trigger || !menu) return
      const margin = 8
      const gap = 6
      // 下界不能是视口 8px：sticky 工具栏会盖住顶部，菜单要排在它下面。
      const minTop = this.bubbleSafeTop()
      const triggerRect = trigger.getBoundingClientRect()
      const menuRect = menu.getBoundingClientRect()
      const width = menuRect.width || 230
      const below = Math.max(0, window.innerHeight - triggerRect.bottom - margin)
      const above = Math.max(0, triggerRect.top - minTop)
      const useAbove = below < menuRect.height && above > below
      const naturalTop = useAbove ? triggerRect.top - menuRect.height - gap : triggerRect.bottom + gap
      const left = Math.max(margin, Math.min(window.innerWidth - width - margin, triggerRect.left))
      const top = Math.max(minTop, Math.min(window.innerHeight - menuRect.height - margin, naturalTop))
      this.bubbleAlignMenuStyle = { left: `${Math.round(left)}px`, top: `${Math.round(top)}px` }
    },
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
      if (this.bubbleHeadingOpen) { this.$nextTick(() => this.positionBubbleHeadingMenu()); return }
      this.closeBubbleAlignMenu()
      this.bubbleHeadingOpen = true
      this.bubbleHeadingMenuStyle = {}
      this.$nextTick(() => this.positionBubbleHeadingMenu())
    },
    toggleBubbleHeadingMenu() {
      if (!this.writable()) return
      this.closeBubbleAlignMenu()
      this.cancelBubbleHoverClose()
      this.bubbleHeadingOpen = !this.bubbleHeadingOpen
      this.bubbleHeadingMenuStyle = {}
      if (this.bubbleHeadingOpen) this.$nextTick(() => this.positionBubbleHeadingMenu())
    },
    closeBubbleHeadingMenu() { this.cancelBubbleHoverClose(); this.bubbleHeadingOpen = false; this.bubbleHeadingMenuStyle = {} },
    positionBubbleHeadingMenu() {
      if (!this.bubbleHeadingOpen) return
      const root = this.$refs.root
      const trigger = root?.querySelector('.lark-doc-bubble-heading-trigger')
      const menu = root?.querySelector('.lark-doc-bubble-heading .lark-doc-heading-menu')
      if (!trigger || !menu) return
      const margin = 8
      const gap = 6
      // 下界不能是视口 8px：sticky 工具栏会盖住顶部，菜单要排在它下面。
      const minTop = this.bubbleSafeTop()
      const rect = trigger.getBoundingClientRect()
      const box = menu.getBoundingClientRect()
      const below = window.innerHeight - rect.bottom - margin
      const above = rect.top - minTop
      const useAbove = below < box.height && above > below
      const left = Math.max(margin, Math.min(window.innerWidth - box.width - margin, rect.left))
      const naturalTop = useAbove ? rect.top - box.height - gap : rect.bottom + gap
      const top = Math.max(minTop, Math.min(window.innerHeight - box.height - margin, naturalTop))
      this.bubbleHeadingMenuStyle = { left: `${Math.round(left)}px`, top: `${Math.round(top)}px` }
    },
    /** @param {number|null} level 标题级别（null = 正文），由 LarkDocHeadingMenu 的 choose 事件传入。 */
    bubbleHeadingAction(level) {
      if (!this.writable()) return
      const { state } = this.editor
      const target = Number.isInteger(level) ? level : null
      const targetType = target == null ? state.schema.nodes.paragraph : state.schema.nodes.heading
      if (!targetType) { this.bubbleHeadingOpen = false; return }
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
      this.bubbleHeadingOpen = false
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
