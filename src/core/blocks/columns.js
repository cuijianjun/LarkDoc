/** Editable column layouts; document children and widths remain the source of truth. */
import { Node, mergeAttributes } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
import { wrapContainerAllowed } from './container-depth'
import { validateAttribute } from './shared'
import { getNodeView } from '../nodeviews/registry'
import { createColumnsNodeView, createColumnNodeView, validColumnWidth, columnLayoutWritable } from '../nodeviews/columns'

function columnContext(state, pos) {
  try {
    const $pos = state.doc.resolve(pos)
    const parent = $pos.parent
    if (parent.type.name !== 'columns' || parent.child($pos.index()).type.name !== 'column') return null
    return { parent, index: $pos.index(), start: $pos.start() - 1 }
  } catch (_) { return null }
}

function normalizedColumns(columns) {
  const total = columns.reduce((sum, column) => sum + column.attrs.width, 0)
  return columns.map(column => column.type.create({ ...column.attrs, width: total > 0 ? column.attrs.width / total * 100 : 100 / columns.length }, column.content, column.marks))
}

const Columns = Node.create({
  name: 'columns', group: 'block', content: 'column{2,}', defining: true, isolating: true,
  addOptions() { return { isEnabled: () => true } },
  addStorage() {
    const refreshers = new Set()
    return { refreshers, refresh: () => refreshers.forEach(refresh => refresh()) }
  },
  parseHTML() { return [{ tag: 'div[data-type="columns"]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'columns' }), 0] },
  addNodeView() { return getNodeView('columns') || createColumnsNodeView },
  addCommands() {
    return {
      insertColumns: (count = 2) => ({ editor, state, dispatch }) => {
        if (!columnLayoutWritable(editor) || !Number.isInteger(count) || count < 2 || count > 1000) return false
        const { $from, $to } = state.selection, range = $from.blockRange($to)
        if (!range || !wrapContainerAllowed(state, range.start, range.end, 1) || !range.parent.canReplaceWith(range.startIndex, range.endIndex, state.schema.nodes.columns)) return false
        if (dispatch) {
          const content = state.doc.slice(range.start, range.end).content
          const children = Array.from({ length: count }, (_, index) => state.schema.nodes.column.create({ width: 100 / count }, index === 0 ? content : state.schema.nodes.paragraph.create()))
          const grid = state.schema.nodes.columns.create(null, children)
          const tr = closeHistory(state.tr).replaceWith(range.start, range.end, grid)
          tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(tr.doc.content.size, state.selection.from + 2))))
          dispatch(tr.scrollIntoView())
        }
        return true
      },
      addLayoutColumn: pos => ({ editor, state, dispatch }) => {
        const context = columnContext(state, pos)
        if (!columnLayoutWritable(editor) || !context) return false
        const { parent, index, start } = context
        if (dispatch) {
          const previous = []
          parent.forEach(column => previous.push(column))
          const children = normalizedColumns(previous).map(column => column.type.create({ ...column.attrs, width: column.attrs.width * parent.childCount / (parent.childCount + 1) }, column.content, column.marks))
          children.splice(index + 1, 0, state.schema.nodes.column.create({ width: 100 / (parent.childCount + 1) }, state.schema.nodes.paragraph.create()))
          const normalized = normalizedColumns(children)
          const tr = closeHistory(state.tr).replaceWith(start, start + parent.nodeSize, parent.type.create(parent.attrs, normalized))
          const cursor = start + 3 + normalized.slice(0, index + 1).reduce((sum, column) => sum + column.nodeSize, 0)
          tr.setSelection(TextSelection.near(tr.doc.resolve(cursor)))
          dispatch(tr.scrollIntoView())
        }
        return true
      },
      removeEmptyLayoutColumn: () => ({ editor, state, dispatch }) => {
        const { $from, empty } = state.selection
        if (!columnLayoutWritable(editor) || !empty) return false
        let depth = $from.depth
        while (depth > 0 && $from.node(depth).type.name !== 'column') depth -= 1
        if (!depth) return false
        const column = $from.node(depth), context = columnContext(state, $from.before(depth))
        if (!context || column.childCount !== 1 || column.firstChild.type.name !== 'paragraph' || column.firstChild.content.size) return false
        if (dispatch) {
          const { parent, index, start } = context, children = []
          parent.forEach((child, _, childIndex) => { if (childIndex !== index) children.push(child) })
          const replacement = children.length === 1 ? children[0].content : parent.type.create(parent.attrs, normalizedColumns(children))
          const tr = closeHistory(state.tr).replaceWith(start, start + parent.nodeSize, replacement)
          const cursor = children.length === 1 ? start + 1 : start + 3 + children.slice(0, Math.min(index, children.length - 1)).reduce((sum, child) => sum + child.nodeSize, 0)
          tr.setSelection(TextSelection.near(tr.doc.resolve(cursor)))
          dispatch(tr.scrollIntoView())
        }
        return true
      },
    }
  },
  addKeyboardShortcuts() { return { Backspace: () => this.editor.commands.removeEmptyLayoutColumn() } },
})

const Column = Node.create({
  name: 'column', content: 'block+', isolating: true,
  addAttributes() {
    return { width: {
      default: 50,
      validate: validateAttribute('column.width', validColumnWidth),
      parseHTML: (el) => { const width = Number(el.getAttribute('data-width')); return validColumnWidth(width) ? width : 50 },
      renderHTML: ({ width }) => ({ 'data-width': width, style: `flex-grow: ${validColumnWidth(width) ? width : 50}` }),
    } }
  },
  parseHTML() { return [{ tag: 'div[data-type="column"]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'column' }), ['div', { class: 'lark-doc-column-content' }, 0]] },
  addNodeView() { return getNodeView('column') || createColumnNodeView },
})

export { Columns, Column }
