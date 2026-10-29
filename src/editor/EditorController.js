import { DOMParser as ProseMirrorDOMParser } from '@tiptap/pm/model'
import { closeHistory } from '@tiptap/pm/history'
import { aggregateHeadingContainers, restoreUnknownBlocks, validateDocument } from '../components/lark-doc/documentOperations'
import { setTransactionMetadata, TRANSACTION_ORIGINS } from '../core/transactionMetadata'
import { createNetworkPolicy } from '../networkPolicy'

export function createEditorController(options = {}) {
  return new EditorController(options)
}

export class EditorController {
  constructor(options = {}) {
    this.editor = options.editor || null
    this.session = options.session || null
    this.title = options.title == null ? '' : options.title
    this.prepareHTML = typeof options.prepareHTML === 'function' ? options.prepareHTML : content => content
    this.getMaxLength = typeof options.getMaxLength === 'function' ? options.getMaxLength : () => 0
    this.getNetwork = typeof options.getNetwork === 'function' ? options.getNetwork : () => null
    this.onBeforeContentReplace = typeof options.onBeforeContentReplace === 'function' ? options.onBeforeContentReplace : null
    this.onAfterContentReplace = typeof options.onAfterContentReplace === 'function' ? options.onAfterContentReplace : null
    this._destroyed = false
  }

  setEditor(editor) {
    this.editor = editor || null
    return this.editor
  }

  getEditor() { return this.editor }
  getHTML() { return this.editor?.getHTML() || '' }
  getJSON() { return this.editor ? aggregateHeadingContainers(restoreUnknownBlocks(this.editor.getJSON())) : null }
  getText() { return this.editor ? (this.editor.getText() || '') : '' }
  focus() { this.editor?.commands.focus() }
  getTitle() { return this.title }
  setTitle(value) { this.title = value; return this.title }

  setReadonly(readonly) {
    if (!this.editor) return false
    const editable = !readonly
    this.editor.setEditable(editable)
    this.editor.emit('editableUpdate', { editable })
    return true
  }

  setContent(content, options = {}) {
    if (!this.editor) return false
    const schema = this.editor.schema
    let json
    if (typeof content === 'string') {
      const safe = this.prepareHTML(content, options.format)
      const container = document.createElement('div')
      container.innerHTML = safe
      json = ProseMirrorDOMParser.fromSchema(schema).parse(container).toJSON()
    } else json = validateDocument(content, schema)
    const network = this.editor.storage.larkDoc?.network || this.getNetwork() || createNetworkPolicy()
    json = network.applyDocument(json)
    const next = schema.nodeFromJSON(validateDocument(json, schema))
    const maxLength = Number(this.getMaxLength()) || 0
    if (maxLength > 0 && this.editor.storage.characterCount.characters({ node: next }) > maxLength) throw new Error(`正文不能超过 ${maxLength} 字`)
    if (next.eq(this.editor.state.doc)) return false
    if (this.onBeforeContentReplace) this.onBeforeContentReplace()
    const tr = this.editor.state.tr.replaceWith(0, this.editor.state.doc.content.size, next.content)
    this.editor.view.dispatch(setTransactionMetadata(tr, { origin: TRANSACTION_ORIGINS.HOST }))
    if (this.editor.commands && typeof this.editor.commands.resetLarkDocFolds === 'function') this.editor.commands.resetLarkDocFolds()
    if (this.editor.commands && typeof this.editor.commands.ensureLarkDocBlockIds === 'function') this.editor.commands.ensureLarkDocBlockIds()
    if (this.editor.commands && typeof this.editor.commands.normalizeLarkDocIndents === 'function') this.editor.commands.normalizeLarkDocIndents()
    if (this.onAfterContentReplace) this.onAfterContentReplace()
    this.editor.view.dispatch(closeHistory(this.editor.state.tr))
    return true
  }

  destroy(cleanup) {
    if (this._destroyed) return
    this._destroyed = true
    if (this.session && this.editor) this.session.detachEditor(this.editor)
    this.editor?.destroy()
    this.editor = null
    if (typeof cleanup === 'function') cleanup()
  }
}
