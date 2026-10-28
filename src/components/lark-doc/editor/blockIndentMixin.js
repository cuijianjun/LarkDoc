/**
 * 块缩进（P0-03 持续瘦身：从 LarkDocEditor.vue 原样下沉，逻辑零改动）。
 *
 * 为什么单独一个 mixin 而不是塞进 blockMenuMixin：这五个方法不是「块菜单」专属——
 * 工具栏（ToolbarBar 的增/减缩进按钮）、气泡条（bubbleMenuMixin 的 increaseIndent /
 * decreaseIndent）、快捷键（toolbarCollapseMixin）三处都在调，块菜单只是第四个入口。
 * 归到 blockMenuMixin 会让「谁能用缩进」和「块菜单开没开」错误地耦合在一起。
 *
 * 🔴 缩进规则的唯一出口是 `stepBlockIndent`（core 侧纯函数）：
 * 上限 = 前一个块的缩进 + 1，硬顶 `limits.maxIndent`；减少只受 0 下限。
 * 别在这里再写一遍 clamp —— `setBlockAttribute('indent')` 里的 clampBlockIndent
 * 只是兜底，真正的「能不能加」由 `changeIndent` 先算完。
 */
import { maxIndentAt, stepBlockIndent } from '../documentOperations'

export default {
  methods: {
    // 当前块的缩进载体（段落 / 标题 / 代码块都带 indent 属性），菜单与工具栏据此判断上限。
    blockIndentLevel() { return Number(this.blockIndentNode()?.attrs?.indent) || 0 },
    blockIndentNode() {
      if (!this.editor) return null
      const { $from } = this.editor.state.selection
      for (let depth = $from.depth; depth > 0; depth -= 1) {
        const node = $from.node(depth)
        if (Number.isInteger(node.attrs?.indent)) return node
      }
      return null
    },
    blockIndentPos() {
      if (!this.editor) return -1
      const { $from } = this.editor.state.selection
      for (let depth = $from.depth; depth > 0; depth -= 1) {
        if (Number.isInteger($from.node(depth).attrs?.indent)) return $from.before(depth)
      }
      return -1
    },
    // 增加缩进的上限由「前一个块」决定：飞书的缩进就是成为上一个块的子块，
    // 所以第一个块一级都缩不了（真飞书菜单里也是灰的）。
    blockIndentLimit() {
      if (!this.editor) return 0
      return maxIndentAt(this.editor.state.doc, this.blockIndentPos(), this.maxBlockIndent)
    },
    canIncreaseIndent() { return this.blockIndentLevel() < this.blockIndentLimit() },
    changeIndent(delta) {
      if (!this.writable()) return
      const node = this.blockIndentNode()
      if (!node) return
      const current = Number(node.attrs.indent) || 0
      // 增加受「前一个块」限制，减少只受 0 下限（可以一路减回文档开头）。
      const next = stepBlockIndent(this.editor.state.doc, this.blockIndentPos(), current, delta, this.maxBlockIndent)
      // 到顶/到底时不再派发事务，避免产生「看起来能一直点」的空操作。
      if (next === current) return
      this.setBlockAttribute('indent', next, node.type.name)
    },
  },
}
