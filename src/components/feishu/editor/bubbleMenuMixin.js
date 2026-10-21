/**
 * bubbleMenuMixin — 选区气泡菜单（对齐/缩进子菜单）的显示定位与动作。
 * 通过 this.editor、this.writable()、this.changeIndent()/this.setAlign()（主组件方法）协作；
 * 主组件的 onSelectionUpdate/toggleMark 会读写 bubbleVisible 并调用 closeBubbleAlignMenu。
 * 采用 mixin 而非子组件：气泡与子菜单模板留在主 SFC，依赖 Vue 2 选项合并语义。
 */
export default {
  data() { return {
    bubbleVisible: false, bubblePosition: { left: 20, top: 120 }, bubbleAlignOpen: false, bubbleAlignMenuStyle: {},
  } },
  computed: {
    bubbleStyle() { return { left: `${this.bubblePosition.left}px`, top: `${this.bubblePosition.top}px` } },
  },
  methods: {
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
    bubbleAlignTooltip(id) {
      const shortcuts = { left: '⌘ + Shift + L', center: '⌘ + Shift + E', right: '⌘ + Shift + R', justify: '⌘ + Shift + J' }
      if (shortcuts[id]) return shortcuts[id]
      if (id === 'increaseIndent' && this.bubbleAlignIndent() >= 8) return '当前内容块已达最大缩进层级'
      if (id === 'decreaseIndent' && this.bubbleAlignIndent() <= 0) return '当前内容块已达最小缩进层级'
      return id === 'increaseIndent' ? '增加缩进' : '减少缩进'
    },
    openBubbleAlignMenu() {
      if (!this.bubbleVisible || !this.writable()) return
      if (this.bubbleAlignOpen) { this.$nextTick(() => this.positionBubbleAlignMenu()); return }
      this.bubbleAlignOpen = true
      this.bubbleAlignMenuStyle = {}
      this.$nextTick(() => this.positionBubbleAlignMenu())
    },
    closeBubbleAlignMenu() {
      this.bubbleAlignOpen = false
      this.bubbleAlignMenuStyle = {}
    },
    positionBubbleAlignMenu() {
      if (!this.bubbleAlignOpen) return
      const root = this.$refs.root
      const trigger = root?.querySelector('.feishu-bubble-align-trigger')
      const menu = root?.querySelector('.feishu-bubble-align-menu')
      if (!trigger || !menu) return
      const margin = 8
      const gap = 6
      const triggerRect = trigger.getBoundingClientRect()
      const menuRect = menu.getBoundingClientRect()
      const width = menuRect.width || 230
      const below = Math.max(0, window.innerHeight - triggerRect.bottom - margin)
      const above = Math.max(0, triggerRect.top - margin)
      const useAbove = below < menuRect.height && above > below
      const naturalTop = useAbove ? triggerRect.top - menuRect.height - gap : triggerRect.bottom + gap
      const left = Math.max(margin, Math.min(window.innerWidth - width - margin, triggerRect.left))
      const top = Math.max(margin, Math.min(window.innerHeight - menuRect.height - margin, naturalTop))
      this.bubbleAlignMenuStyle = { left: `${Math.round(left)}px`, top: `${Math.round(top)}px` }
    },
    bubbleAlignAction(id) {
      if (!this.writable()) return
      if (id === 'increaseIndent') this.changeIndent(1)
      else if (id === 'decreaseIndent') this.changeIndent(-1)
      else this.setAlign(id)
      this.closeBubbleAlignMenu()
    },
  },
}
