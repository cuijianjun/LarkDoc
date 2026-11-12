/** Local meeting agendas, based on requirements/02 §29. No calendar service is needed. */
import { Node, mergeAttributes } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import { Plugin } from '@tiptap/pm/state'
import { createBlockId, BLOCK_ID_PATTERN } from '../documentOperations'
import { validateAttribute } from './shared'
import { getNodeView } from '../nodeviews/registry'
import { createAgendaItemNodeView, agendaWritable, validAgendaDuration } from '../nodeviews/agenda'
export { agendaWritable, validAgendaDuration } from '../nodeviews/agenda'

const AGENDA_HISTORY = 'larkDocAgendaHistory'
const stopCapturing = editor => editor.state.plugins.forEach(plugin => plugin.getState(editor.state)?.undoManager?.stopCapturing?.())
function agendaHistory(editor, tr) {
  stopCapturing(editor)
  return closeHistory(tr).setMeta(AGENDA_HISTORY, true)
}

export const Agenda = Node.create({
  name: 'agenda', group: 'block', content: 'agendaItem*', defining: true, isolating: true,
  addOptions() { return { isEnabled: () => true } },
  addStorage() {
    const refreshers = new Set()
    return { refreshers, refresh: () => refreshers.forEach(refresh => refresh()) }
  },
  onTransaction({ transaction }) { if (transaction.getMeta(AGENDA_HISTORY)) stopCapturing(this.editor) },
  addProseMirrorPlugins() {
    return [new Plugin({ appendTransaction: (transactions, _old, state) => transactions.some(tr => tr.docChanged && tr.getMeta(AGENDA_HISTORY)) ? closeHistory(state.tr).setMeta('addToHistory', false) : null })]
  },
  parseHTML() { return [{ tag: 'div[data-type="agenda"]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'agenda', 'aria-label': '会议议程' }), 0] },
  addCommands() {
    return {
      insertAgenda: () => ({ editor, state, tr, commands, dispatch }) => {
        if (!agendaWritable(editor)) return false
        const { $from } = state.selection
        for (let depth = $from.depth; depth > 0; depth -= 1) if ($from.node(depth).type.name === 'agenda') return false
        if (dispatch) agendaHistory(editor, tr)
        return commands.insertContent([{
          type: 'agenda', content: [20, 10].map(durationMinutes => ({
            type: 'agendaItem', attrs: { itemId: createBlockId(), durationMinutes },
            content: [{ type: 'agendaTitle' }, { type: 'agendaContent', content: [{ type: 'paragraph' }] }],
          })),
        }, { type: 'paragraph' }])
      },
      setAgendaDuration: (pos, durationMinutes) => ({ editor, state, tr, dispatch }) => {
        if (!agendaWritable(editor) || !Number.isInteger(pos) || pos < 0 || pos >= state.doc.content.size || !validAgendaDuration(durationMinutes)) return false
        const item = state.doc.nodeAt(pos)
        if (item?.type.name !== 'agendaItem') return false
        if (dispatch && item.attrs.durationMinutes !== durationMinutes) agendaHistory(editor, tr).setNodeMarkup(pos, undefined, { ...item.attrs, durationMinutes })
        return true
      },
      removeAgendaItem: pos => ({ editor, state, tr, dispatch }) => {
        if (!agendaWritable(editor) || !Number.isInteger(pos) || pos < 0 || pos >= state.doc.content.size) return false
        const item = state.doc.nodeAt(pos)
        if (item?.type.name !== 'agendaItem') return false
        if (dispatch) agendaHistory(editor, tr).delete(pos, pos + item.nodeSize)
        return true
      },
    }
  },
})

export const AgendaItem = Node.create({
  name: 'agendaItem', content: 'agendaTitle agendaContent', defining: true, isolating: true,
  addAttributes() {
    return {
      itemId: {
        default: null, validate: validateAttribute('agendaItem.itemId', value => value === null || typeof value === 'string' && BLOCK_ID_PATTERN.test(value)),
        parseHTML: element => element.getAttribute('data-item-id'),
        renderHTML: attrs => attrs.itemId ? { 'data-item-id': attrs.itemId } : {},
      },
      durationMinutes: {
        default: 20, validate: validateAttribute('agendaItem.durationMinutes', validAgendaDuration),
        parseHTML: element => { const value = Number(element.getAttribute('data-duration-minutes')); return validAgendaDuration(value) ? value : 20 },
        renderHTML: attrs => ({ 'data-duration-minutes': attrs.durationMinutes }),
      },
    }
  },
  parseHTML() { return [{ tag: 'div[data-type="agenda-item"]', contentElement: element => element.querySelector('[data-type="agenda-fields"]') || element }] },
  renderHTML({ node, HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'agenda-item' }),
      ['div', { class: 'lark-doc-agenda-duration-label', contenteditable: 'false' }, `${node.attrs.durationMinutes} 分钟`],
      ['div', { class: 'lark-doc-agenda-fields', 'data-type': 'agenda-fields' }, 0]]
  },
  addNodeView() { return getNodeView('agendaItem') || createAgendaItemNodeView },
})

export const AgendaTitle = Node.create({
  name: 'agendaTitle', content: 'inline*', defining: true,
  parseHTML() { return [{ tag: 'div[data-type="agenda-title"]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'agenda-title', 'data-placeholder': '请输入议程标题' }), 0] },
  addKeyboardShortcuts() {
    return { Enter: () => {
      const { $from } = this.editor.state.selection
      if ($from.parent.type.name !== this.name) return false
      return this.editor.commands.setTextSelection($from.after() + 2)
    } }
  },
})

export const AgendaContent = Node.create({
  name: 'agendaContent', content: 'block+', defining: true, isolating: true,
  parseHTML() { return [{ tag: 'div[data-type="agenda-content"]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'agenda-content' }), 0] },
})
