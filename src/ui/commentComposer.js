import { DOMSerializer, Fragment, Schema, Slice } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { EditorView } from '@tiptap/pm/view'
import { closeHistory, history, redo, undo } from '@tiptap/pm/history'
import { keymap } from '@tiptap/pm/keymap'
import { baseKeymap } from '@tiptap/pm/commands'
import { commentDraftDocument, serializeCommentDocument } from '../core/comments/mentions'

// The wire format remains plain text plus UTF-16 ranges. Only directory-selected
// identities become atoms; pasted HTML is never an authority for an identity.
const schema = new Schema({ nodes: {
  doc: { content: 'paragraph+' },
  paragraph: { content: 'inline*', group: 'block', toDOM: () => ['p', 0] },
  text: { group: 'inline' },
  hardBreak: { inline: true, group: 'inline', selectable: false, toDOM: () => ['br'] },
  commentMention: {
    inline: true, group: 'inline', atom: true,
    attrs: { principalId: {}, text: {} },
    toDOM: node => ['span', { 'data-comment-mention': node.attrs.principalId, 'data-user-id': node.attrs.principalId, class: 'lark-doc-comment-mention', contenteditable: 'false' }, node.attrs.text],
  },
  commentDocumentReference: {
    inline: true, group: 'inline', atom: true,
    attrs: { docId: {}, text: {}, readable: { default: true } },
    toDOM: node => ['span', { 'data-comment-reference': node.attrs.docId, class: 'lark-doc-comment-document-reference', contenteditable: 'false' }, node.attrs.text],
  },
} })

function positionAtOffset(doc, offset) {
  let consumed = 0, result = 1, found = false
  doc.descendants((node, pos) => {
    if (found || !node.isInline) return
    const length = node.isText ? node.text.length : node.type.name === 'hardBreak' ? 1 : node.attrs.text.length
    if (offset <= consumed + length) {
      result = node.isText ? pos + Math.max(0, offset - consumed) : pos + (offset > consumed ? node.nodeSize : 0)
      found = true
    }
    consumed += length
  })
  return found ? result : Math.max(1, doc.content.size - 1)
}

/** A small, lazily mounted PM input; idle comment cards do not allocate editors. */
export function createCommentComposer({ label = '评论', placeholder = '', onChange } = {}) {
  const el = document.createElement('div')
  el.setAttribute('role', 'textbox')
  el.setAttribute('aria-label', label)
  el.setAttribute('aria-multiline', 'true')
  el.setAttribute('data-placeholder', placeholder)
  el.className = 'lark-doc-comment-rich-input'
  el.tabIndex = 0
  let view = null, doc = schema.nodeFromJSON(commentDraftDocument()), readonly = false, scopeKey = '', destroyed = false, compositionEndedAt = -Infinity
  const isCompositionEvent = (event, current = view) => {
    const webkit = /AppleWebKit/.test(navigator.userAgent) && !/Chrome|Chromium|Edg/.test(navigator.userAgent)
    return !!(current?.composing || event.isComposing || event.keyCode === 229 || (webkit && event.timeStamp - compositionEndedAt < 500))
  }
  // The window capture handler must use this input's IME state before PM sees the key.
  Object.defineProperty(el, '__larkDocCommentComposition', { configurable: true, value: event => !destroyed && isCompositionEvent(event) })
  const plugins = () => [history(), keymap({
    'Mod-z': undo, 'Mod-Shift-z': redo, 'Mod-y': redo,
    Enter: (state, dispatch) => { if (dispatch) dispatch(state.tr.replaceSelectionWith(schema.nodes.hardBreak.create()).scrollIntoView()); return true },
  }), keymap(baseKeymap)]
  const getDraft = () => ({ references: [], ...serializeCommentDocument((view?.state.doc || doc).toJSON()) })
  const caret = () => view ? serializeCommentDocument({ content: view.state.doc.slice(0, view.state.selection.head).content.toJSON() }).content.length : getDraft().content.length
  function renderIdle() {
    el.replaceChildren(DOMSerializer.fromSchema(schema).serializeFragment(doc.content))
    el.contentEditable = String(!readonly)
    el.setAttribute('aria-readonly', String(readonly))
    el.dataset.empty = String(!getDraft().content)
  }
  function mount() {
    if (view || destroyed) return
    view = new EditorView({ mount: el }, {
      state: EditorState.create({ doc, plugins: plugins(), selection: TextSelection.atEnd(doc) }),
      editable: () => !readonly,
      handleKeyDown: (_view, event) => readonly && (['Enter', 'Backspace', 'Delete'].includes(event.key) || ((event.metaKey || event.ctrlKey) && ['z', 'y', 'x', 'v'].includes(event.key.toLowerCase()))),
      handleDOMEvents: {
        // Let the picker consume Enter/arrows before the PM keymap. Composition
        // events retain the browser/PM IME path and never submit a comment.
        keydown: (current, event) => {
          if (isCompositionEvent(event, current)) {
            if (event.key === 'Escape') event.stopPropagation()
            return false
          }
          el.dispatchEvent(new CustomEvent('comment-keydown', { detail: event }))
          return event.defaultPrevented
        },
        compositionend: (_view, event) => { compositionEndedAt = event.timeStamp; return false },
      },
      handlePaste: (current, event) => {
        if (readonly) { event.preventDefault(); return true }
        const text = event.clipboardData?.getData('text/plain')
        if (typeof text !== 'string') return false
        event.preventDefault()
        const json = commentDraftDocument(text.replace(/\r\n?/g, '\n')).content[0].content || []
        current.dispatch(current.state.tr.replaceSelection(new Slice(Fragment.fromJSON(schema, json), 0, 0)).scrollIntoView())
        return true
      },
      dispatchTransaction(transaction) {
        view.updateState(view.state.apply(transaction))
        doc = view.state.doc
        el.dataset.empty = String(!getDraft().content)
        if (transaction.docChanged) onChange?.({ ...getDraft(), caret: caret() })
      },
    })
    el.setAttribute('aria-readonly', String(readonly))
  }
  // Build before the browser resolves a tap caret against the idle DOM.
  // Natural focus also needs PM's selection sync, or a previous document range can survive.
  const preparePointer = event => { if (event.button === undefined || event.button === 0) mount() }
  const syncFocus = () => { mount(); if (document.activeElement === el) view?.focus() }
  el.addEventListener('pointerdown', preparePointer)
  el.addEventListener('focus', syncFocus)
  renderIdle()
  return {
    el, get view() { return view }, getDraft, caret,
    focus() { mount(); view?.focus() },
    update(next = {}) {
      if (destroyed) return
      const value = String(next.value ?? '')
      const nextScope = String(next.scopeKey ?? scopeKey)
      const reset = nextScope !== scopeKey
      const nextDoc = schema.nodeFromJSON(commentDraftDocument(value, next.mentions || [], next.references || []))
      const currentValue = getDraft().content, oldCaret = caret()
      readonly = !!next.readonly
      scopeKey = nextScope
      if (view && (reset || (!value && currentValue))) {
        const focused = document.activeElement === el
        view.destroy(); view = null; doc = nextDoc; compositionEndedAt = -Infinity
        renderIdle()
        if (focused) mount()
      }
      if (view) {
        if (!nextDoc.eq(view.state.doc)) {
          const start = view.state.doc.content.findDiffStart(nextDoc.content)
          const end = view.state.doc.content.findDiffEnd(nextDoc.content)
          const overlap = Math.max(0, start - Math.min(end.a, end.b))
          const tr = closeHistory(view.state.tr.replace(start, end.a + overlap, nextDoc.slice(start, end.b + overlap)))
          tr.setSelection(TextSelection.create(tr.doc, positionAtOffset(tr.doc, Math.max(0, oldCaret + value.length - currentValue.length))))
          // Candidate selection is a user edit. A local replacement preserves
          // prior typing history, while an identical echo never makes a step.
          view.updateState(view.state.apply(tr))
        }
        view.setProps({ editable: () => !readonly })
        doc = view.state.doc
        el.setAttribute('aria-readonly', String(readonly))
        el.dataset.empty = String(!getDraft().content)
      } else if (!nextDoc.eq(doc) || reset || el.contentEditable !== String(!readonly)) { doc = nextDoc; renderIdle() }
    },
    destroy() { destroyed = true; delete el.__larkDocCommentComposition; el.removeEventListener('pointerdown', preparePointer); el.removeEventListener('focus', syncFocus); view?.destroy(); view = null; el.remove() },
  }
}
