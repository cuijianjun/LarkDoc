import { DOMParser as ProseMirrorDOMParser } from '@tiptap/pm/model'
import { closeHistory } from '@tiptap/pm/history'
import { aggregateHeadingContainers, restoreUnknownBlocks, validateDocument } from '../components/lark-doc/documentOperations'
import { setTransactionMetadata, TRANSACTION_ORIGINS } from '../core/transactionMetadata'
import { applyMediaHtmlMode } from '../core/media/htmlMode'
import { createNetworkPolicy } from '../networkPolicy'
import { createDocumentSnapshotReader } from './documentSnapshot'

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
    this.onImportReport = typeof options.onImportReport === 'function' ? options.onImportReport : null
    this.lastImportReport = null
    // A single editor state can be read by change publication, autosave and
    // host callbacks in the same turn. Keep one serialization per state so a
    // large document is not converted to HTML/JSON/text three times.
    this._snapshotState = null
    this._snapshot = null
    this._snapshotReader = null
    this._destroyed = false
  }

  setEditor(editor) {
    this.editor = editor || null
    this._snapshotState = null
    this._snapshot = null
    return this.editor
  }

  getEditor() { return this.editor }
  /**
   * 序列化正文。
   *
   * 默认返回 schema 原生产物（媒体直出本体），`options.media.mode === 'link'` 时额外把
   * 图片 / 文件 / 音视频改写成纯地址链接（`config.media.htmlMode`，见 core/media/htmlMode）。
   * **默认不读全局配置**：v-model 往返靠「字符串是否等于 `editor.getHTML()`」判定是否回灌，
   * 在这里默认改写会让每次赋值都把媒体冲成链接。要按配置输出请显式传 `media`。
   */
  getHTML(options = {}) {
    const html = this._readSnapshot('html')
    const media = options && options.media
    return media && media.mode === 'link' ? applyMediaHtmlMode(html, media) : html
  }
  getJSON() {
    const json = this._readSnapshot('json')
    // Public snapshots are caller-owned. A host may edit an exported object;
    // it must never mutate the cached snapshot used by the next autosave.
    return json === null ? null : JSON.parse(JSON.stringify(json))
  }
  getText() { return this._readSnapshot('text') }

  _readSnapshot(format) {
    if (!this.editor) return format === 'json' ? null : ''
    const state = this.editor.state?.doc || this.editor.state || this.editor
    if (this._snapshotState !== state || !this._snapshot) {
      this._snapshotState = state
      this._snapshot = {}
    }
    if (!Object.prototype.hasOwnProperty.call(this._snapshot, format)) {
      this._snapshot[format] = format === 'json'
        ? aggregateHeadingContainers(restoreUnknownBlocks(this.editor.getJSON()))
        : format === 'html' ? this.editor.getHTML() || '' : this.editor.getText() || ''
    }
    return this._snapshot[format]
  }
  async getSnapshotAsync(options) {
    if (!this.editor || this._destroyed) return null
    if (!this._snapshotReader) this._snapshotReader = createDocumentSnapshotReader()
    return this._snapshotReader.read(this.editor, options)
  }
  getImportReport() { return this.lastImportReport }
  setImportReport(report) {
    this.lastImportReport = report || null
    if (this.onImportReport) this.onImportReport(this.lastImportReport)
  }
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
    return this.applyPreparedContent(this.prepareContent(content, options), options)
  }

  /** Preflight snapshots before requesting an immutable restore from the provider. */
  prepareContent(content, options = {}) {
    if (!this.editor || this._destroyed) throw new Error('编辑器已失效')
    const schema = this.editor.schema
    let json
    let report = null
    if (typeof content === 'string') {
      const prepared = this.prepareHTML(content, options.format)
      const safe = typeof prepared === 'string' ? prepared : prepared.html
      if (typeof prepared !== 'string' && prepared.converted) report = prepared.report
      const container = document.createElement('div')
      container.innerHTML = safe
      json = ProseMirrorDOMParser.fromSchema(schema).parse(container).toJSON()
    } else json = validateDocument(content, schema)
    const network = this.getNetwork() || this.editor.storage.larkDoc?.network || createNetworkPolicy()
    json = network.applyDocument(json)
    const next = schema.nodeFromJSON(validateDocument(json, schema))
    const maxLength = Number(this.getMaxLength()) || 0
    if (maxLength > 0 && this.editor.storage.characterCount.characters({ node: next }) > maxLength) throw new Error(`正文不能超过 ${maxLength} 字`)
    return { next, report }
  }

  applyPreparedContent({ next, report }, options = {}) {
    if (!this.editor || this._destroyed) throw new Error('编辑器已失效')
    if (next.eq(this.editor.state.doc)) {
      this.setImportReport(report)
      return false
    }
    if (this.onBeforeContentReplace) this.onBeforeContentReplace()
    const before = this.editor.state.doc
    const tr = closeHistory(this.editor.state.tr).replaceWith(0, this.editor.state.doc.content.size, next.content)
    this.editor.view.dispatch(setTransactionMetadata(tr, { origin: options.origin || TRANSACTION_ORIGINS.HOST }))
    if (this.editor.state.doc === before) throw new Error('当前编辑器拒绝替换正文')
    if (this.editor.commands && typeof this.editor.commands.resetLarkDocFolds === 'function') this.editor.commands.resetLarkDocFolds()
    if (this.editor.commands && typeof this.editor.commands.ensureLarkDocBlockIds === 'function') this.editor.commands.ensureLarkDocBlockIds()
    if (this.editor.commands && typeof this.editor.commands.normalizeLarkDocIndents === 'function') this.editor.commands.normalizeLarkDocIndents()
    if (this.onAfterContentReplace) this.onAfterContentReplace()
    this.editor.view.dispatch(closeHistory(this.editor.state.tr))
    this.setImportReport(report)
    return true
  }

  destroy(cleanup) {
    if (this._destroyed) return
    this._destroyed = true
    if (this.session && this.editor) this.session.detachEditor(this.editor)
    this.editor?.destroy()
    this.editor = null
    this._snapshot = null
    this._snapshotReader = null
    if (typeof cleanup === 'function') cleanup()
  }
}
