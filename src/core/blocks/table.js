import { Table } from '@tiptap/extension-table'

/** Native table command used by the menu, toolbar and size picker. */
export const LarkDocTable = Table.extend({
  addOptions() { return { ...this.parent?.(), canInsert: () => true } },
  addCommands() {
    return {
      ...this.parent?.(),
      insertLarkDocTable: (options = {}) => ({ chain, dispatch, editor }) => {
        const { rows = 2, cols = 3 } = options || {}
        if (!editor.isEditable || this.options.canInsert() === false || ![rows, cols].every(value => Number.isInteger(value) && value > 0 && value <= 100)) return false
        if (!dispatch) return true
        return chain().insertTable({ rows, cols, withHeaderRow: false }).command(({ tr }) => {
          const { $from } = tr.selection
          let depth = $from.depth
          while (depth > 0 && $from.node(depth).type.name !== 'table') depth--
          if (!depth) return false
          const start = $from.before(depth)
          $from.node(depth).descendants((node, offset) => {
            if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') tr.setNodeMarkup(start + offset + 1, undefined, { ...node.attrs, colwidth: Array(node.attrs.colspan || 1).fill(100) })
          })
          return true
        }).run()
      },
    }
  },
})
