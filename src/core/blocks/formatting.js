/**
 * 块级格式化：缩进（margin-left 实现）+ 行高 + 表格单元格底色/对齐。
 * Tab / Shift-Tab / Mod-] / Mod-[ 快捷键也挂在这个扩展上。
 */
import { Extension } from '@tiptap/core'
import { clampBlockIndent, INDENT_STEP_PX, MAX_BLOCK_INDENT, safeColor, stepBlockIndent } from '../documentOperations'

/**
 * 块级缩进的下一步层级。
 *
 * 增加：受「前一个兄弟块」限制（飞书的块缩进就是「成为上一个块的子块」），
 * 第一个块没有前兄弟 → 一级都缩不了；前块 2 级 → 最多到 3 级。
 * 减少：只受 0 下限限制，可以一路减回文档开头（真飞书实测）。
 */
export function nextBlockIndent(doc, $from, currentIndent, delta) {
  const pos = $from.depth > 0 ? $from.before($from.depth) : 0
  return stepBlockIndent(doc, pos, currentIndent, delta)
}

const Formatting = Extension.create({
  name: 'larkDocFormatting',
  addGlobalAttributes() {
    return [
      { types: ['paragraph', 'heading'], attributes: {
        // 缩进缩的是整块（飞书是块的外框右移、宽度变窄），所以用 margin 而不是 padding：
        // padding 只把文字推右，块盒子仍是整列宽，悬停高亮与句柄位置会跟飞书对不上。
        indent: { default: 0, parseHTML: (el) => clampBlockIndent(el.getAttribute('data-indent')), renderHTML: ({ indent }) => (clampBlockIndent(indent) ? { 'data-indent': clampBlockIndent(indent), style: `margin-left: ${clampBlockIndent(indent) * INDENT_STEP_PX}px` } : {}) },
        lineHeight: { default: null, parseHTML: (el) => /^(normal|[1-4](\.\d{1,2})?)$/.test(el.style.lineHeight) ? el.style.lineHeight : null, renderHTML: ({ lineHeight }) => lineHeight && /^(normal|[1-4](\.\d{1,2})?)$/.test(String(lineHeight)) ? { style: `line-height: ${lineHeight}` } : {} },
      } },
      { types: ['tableCell', 'tableHeader'], attributes: {
        backgroundColor: { default: null, parseHTML: (el) => safeColor(el.style.backgroundColor) ? el.style.backgroundColor : null, renderHTML: ({ backgroundColor }) => backgroundColor && safeColor(backgroundColor) ? { style: `background-color: ${backgroundColor}` } : {} },
        textAlign: { default: null, parseHTML: (el) => ['left', 'center', 'right', 'justify'].includes(el.style.textAlign) ? el.style.textAlign : null, renderHTML: ({ textAlign }) => ['left', 'center', 'right', 'justify'].includes(textAlign) ? { style: `text-align: ${textAlign}` } : {} },
        verticalAlign: { default: null, parseHTML: (el) => ['top', 'middle', 'bottom'].includes(el.style.verticalAlign) ? el.style.verticalAlign : null, renderHTML: ({ verticalAlign }) => ['top', 'middle', 'bottom'].includes(verticalAlign) ? { style: `vertical-align: ${verticalAlign}` } : {} },
      } },
    ]
  },
  addKeyboardShortcuts() {
    // 列表缩进和块缩进共用同一个上限：飞书最深层就是 5 级，列表再按 Tab 也不会无限下沉。
    const listDepth = () => {
      const { $from } = this.editor.state.selection
      let depth = 0
      for (let level = $from.depth; level > 0; level -= 1) {
        if (['listItem', 'taskItem'].includes($from.node(level).type.name)) depth += 1
      }
      return depth
    }
    const listCommand = (command) => {
      if (!this.editor.isEditable || this.editor.view.composing) return false
      if (command === 'sinkListItem' && listDepth() >= MAX_BLOCK_INDENT) return true
      const type = this.editor.isActive('taskItem') ? 'taskItem' : 'listItem'
      return this.editor.commands[command](type)
    }
    const indentCommand = (delta) => {
      if (!this.editor.isEditable || this.editor.view.composing) return false
      if (this.editor.isActive('taskItem') || this.editor.isActive('listItem')) return listCommand(delta > 0 ? 'sinkListItem' : 'liftListItem')

      const { selection } = this.editor.state
      if (['table', 'tableCell', 'tableHeader'].some((type) => this.editor.isActive(type))) return false
      // 代码块里 Tab 是缩进代码（飞书同样是插入空格），块级缩进走菜单或 ⌘] / ⌘[。
      if (this.editor.isActive('codeBlock')) {
        if (delta < 0) return false
        return this.editor.commands.insertContent('  ')
      }

      const blockType = selection.$from.parent.type.name
      if (!['paragraph', 'heading'].includes(blockType)) return false

      const currentIndent = Number(this.editor.getAttributes(blockType).indent) || 0
      const nextIndent = nextBlockIndent(this.editor.state.doc, selection.$from, currentIndent, delta)
      if (nextIndent === currentIndent) return true
      return this.editor.chain().focus().updateAttributes(blockType, { indent: nextIndent }).run()
    }
    // 飞书的块级缩进快捷键；Tab 在代码块里留给「插入空格」。
    const blockIndentCommand = (delta) => {
      if (!this.editor.isEditable || this.editor.view.composing) return false
      const { selection } = this.editor.state
      const node = selection.$from.parent
      if (!Number.isInteger(node.attrs?.indent)) return false
      const currentIndent = Number(node.attrs.indent) || 0
      const nextIndent = nextBlockIndent(this.editor.state.doc, selection.$from, currentIndent, delta)
      if (nextIndent === currentIndent) return true
      return this.editor.chain().focus().updateAttributes(node.type.name, { indent: nextIndent }).run()
    }
    return { Tab: () => indentCommand(1), 'Shift-Tab': () => indentCommand(-1), 'Mod-]': () => blockIndentCommand(1), 'Mod-[': () => blockIndentCommand(-1) }
  },
})

export { Formatting }
