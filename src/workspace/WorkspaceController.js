import { DOMParser as ProseMirrorDOMParser } from '@tiptap/pm/model'
import { createPersistenceWorkspace, detectBrowserStorage } from '../providers/persistence'
import { AI_ACTIONS, AI_CONTEXTS, streamMock, createContextSnapshot, createReviewResult, createToolProposal, mapAnchor, anchorValid } from '../components/lark-doc/mockAI'
import { normalizeAIProvider, previewToHtml, singleParagraphInner, looksLikeMarkdown } from '../components/lark-doc/ai'
import { TEMPLATES } from '../components/lark-doc/templates'
import { createLarkDocConfig } from '../components/lark-doc/larkDocConfig'
import { sanitizeHTML, validateDocument } from '../components/lark-doc/documentOperations'
import { migrateRecordContent } from '../core/migrations'
import { createDerivedSnapshot, validateDerivedSnapshot } from '../core/derive/snapshot'
import { DOCUMENT_SCHEMA_VERSION } from '../core/documentSchema'
import { logger } from '../utils/logger'
import { loadFeature } from '../core/features/registry'
import { createDocumentSession } from '../session/DocumentSession'

const nextPaintFrame = () => (typeof requestAnimationFrame === 'function'
  ? new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  : Promise.resolve())

export function createWorkspaceState({ initialContent, initialTitle, templates, config }) {
  const templateItems = Array.isArray(templates) ? templates : TEMPLATES
  const firstTemplate = templateItems[0] || { html: '<p></p>', title: '未命名文档' }
  return {
    html: typeof initialContent === 'string' ? initialContent : firstTemplate.html,
    title: initialTitle != null ? initialTitle : firstTemplate.title,
    templateItems,
    forcedReadonly: false,
    editorConfig: createLarkDocConfig(config),
    effectiveReadonly: false,
    importing: false,
    initialized: false,
    saveStatus: '初始化…',
    storageError: false,
    storageKind: '',
    notice: '',
    historyOpen: false,
    snapshots: [],
    aiActions: AI_ACTIONS,
    aiContextOptions: AI_CONTEXTS,
    aiAction: 'rewrite',
    aiContextScope: 'selection',
    aiLanguage: 'en',
    aiPrompt: '',
    aiMessages: [],
    aiOpen: false,
    aiRunning: false,
    aiPreview: '',
    aiError: '',
    aiStatus: '',
    aiReviewIssues: [],
    aiProposal: null,
    aiContextSummary: '当前选区 · 0 字',
    aiBudgetExceeded: false,
    aiGeneratedAction: null,
    aiContentFormat: 'text',
    templateOpen: false,
    templateQuery: '',
    importReport: null,
    sessionInstance: null,
    maxLengthOptions: [
      { value: 0, label: '不限字数' },
      { value: 200, label: '200 字（ECS）' },
    ],
    exportOptions: [
      { value: '', label: '导出' },
      { value: 'html', label: 'HTML' },
      { value: 'json', label: 'JSON（完整正文）' },
      { value: 'md', label: 'Markdown（简化）' },
      { value: 'txt', label: '纯文本' },
      { value: 'docx', label: 'Word（简化）' },
      { value: 'print', label: '打印 / PDF' },
    ],
    aiLanguageOptions: [
      { value: 'en', label: '英语' },
      { value: 'zh', label: '中文' },
      { value: 'ja', label: '日语' },
    ],
  }
}

export function createWorkspaceController(options = {}) {
  const controller = new WorkspaceController(options)
  return controller
}

class WorkspaceController {
  constructor({ state, props = {}, host = {} } = {}) {
    this.state = state
    this.props = props
    this.host = host
    this._workspace = null
    this._saveTimer = null
    this._saveGeneration = 0
    this._aiGeneration = 0
    this._aiStream = null
    this._aiAnchor = null
    this._aiPreviewAction = null
    this._aiContext = null
    this._contentSeeded = false
    this._disposed = false
  }

  isDisposed() { return this._disposed }
  getEditor() { return this.host.getEditor ? this.host.getEditor() : null }
  featureEnabled(name) { return !this.state.editorConfig?.features || this.state.editorConfig.features[name] !== false }
  writable() { return this.host.writable ? this.host.writable() : Boolean(this.getEditor()?.isEditable && !this.state.importing) }
  emit(...args) { if (this.host.emit) this.host.emit(...args) }
  confirm(message) { return this.host.confirm ? this.host.confirm(message) : true }
  setContent(content, options) { return this.host.setContent ? this.host.setContent(content, options) : false }
  focus() { if (this.host.focus) this.host.focus() }
  getHTML() { return this.host.getHTML ? this.host.getHTML() : '' }
  getJSON() { return this.host.getJSON ? this.host.getJSON() : null }
  getText() { return this.host.getText ? this.host.getText() : '' }
  getWindow() { return this.host.getWindow ? this.host.getWindow() : (typeof window !== 'undefined' ? window : {}) }
  getNavigator() { return this.host.getNavigator ? this.host.getNavigator() : (typeof navigator !== 'undefined' ? navigator : {}) }
  getAIAdapter() { return normalizeAIProvider(this.host.getAIProvider ? this.host.getAIProvider() : this.props.aiProvider) }

  initializeSession() {
    this.state.sessionInstance = this.props.session || createDocumentSession({
      documentId: this.props.documentId || 'local',
      mode: 'local',
      user: this.props.user,
      capabilities: this.props.capabilities || {},
      persistence: this.props.persistence,
    })
    return this.state.sessionInstance
  }

  getSession() { return this.state.sessionInstance || this.props.session }

  async onReady() {
    this.getSession()?.attachEditor(this.getEditor())
    if (this.props.initialContent && typeof this.props.initialContent === 'object' && !this._contentSeeded) {
      this._contentSeeded = true
      try { this.setContent(this.props.initialContent) } catch (error) { this.storageFailure(error) }
    }
    if (this.featureEnabled('persistence')) {
      try {
        const draft = await this.callWorkspace('load')
        if (this._disposed) return
        if (draft) {
          const editor = this.getEditor()
          const content = validateDocument(migrateRecordContent(draft.json, draft.schemaVersion), editor.schema)
          if (this.host.hydrateOutline && this.host.hydrateOutline(validateDerivedSnapshot(draft.derived, content)?.outline)) await nextPaintFrame()
          if (this._disposed) return
          this.setContent(content)
          this.state.title = draft.title
        }
        this.state.saveStatus = draft
          ? `已恢复${this.persistenceLabel()}草稿`
          : (this.props.persistence ? '宿主适配器 · 尚未保存' : '本地示例 · 尚未保存')
      } catch (error) { this.storageFailure(error) }
    } else this.state.saveStatus = '本地保存已关闭'
    this.state.initialized = true
    const editor = this.getEditor()
    if (editor && this.host.bindAITransaction) this.host.bindAITransaction(this.mapAI)
    if (this.host.addBeforeUnload) this.host.addBeforeUnload(this.flushOnLeave)
    logger.info('lifecycle', 'lark-doc.workspace.ready', { status: this.props.persistence ? 'host' : 'local' })
    this.emit('ready', { editor, document: this.host.documentApi || this })
  }

  record() {
    const session = this.getSession()
    const record = session ? session.getDocumentRecord({ title: this.state.title }) : null
    const base = record
      ? { title: record.title, json: record.content, documentId: record.documentId, schemaVersion: record.schemaVersion, revisionId: record.revisionId, updatedAt: record.updatedAt }
      : { title: this.state.title, json: this.getJSON(), schemaVersion: DOCUMENT_SCHEMA_VERSION }
    if (this.props.saveHtml) base.html = this.getHTML()
    const editor = this.getEditor()
    const doc = editor && editor.state && editor.state.doc
    if (doc) {
      const derived = createDerivedSnapshot(doc)
      if (derived) base.derived = derived
    }
    return base
  }

  persistenceLabel() {
    if (this.props.persistence) return '宿主'
    return this.state.storageKind === 'memory' ? '内存' : '本浏览器'
  }

  persistenceCaveat() {
    if (this.props.persistence) return ''
    return this.state.storageKind === 'memory' ? '（刷新即丢失，请先导出）' : ''
  }

  getWorkspace() {
    if (!this._workspace) {
      this._workspace = this.getSession()?.getProvider('persistence') || this.props.persistence ||
        createPersistenceWorkspace({ ...detectBrowserStorage(this.getWindow()), maxSnapshots: this.state.editorConfig.limits.maxSnapshots })
      this.state.storageKind = this._workspace.kind || ''
      if (!this.getSession()?.getProvider('persistence')) this.getSession()?.setProvider('persistence', this._workspace)
    }
    return this._workspace
  }

  callWorkspace(method, ...args) {
    const workspace = this.getWorkspace()
    if (!workspace || typeof workspace[method] !== 'function') throw new Error(`持久化适配器缺少 ${method} 方法`)
    return workspace[method](...args)
  }

  queueSave() {
    if (!this.featureEnabled('persistence') || !this.state.initialized || this.state.storageError || this._disposed) return
    clearTimeout(this._saveTimer)
    this.state.saveStatus = '等待本地保存…'
    this._saveTimer = setTimeout(() => { void this.saveNow() }, 650)
  }

  flushOnLeave() { void this.saveNow() }

  async saveNow(manual = false) {
    if (!this.featureEnabled('persistence')) return
    clearTimeout(this._saveTimer)
    if (!this.state.initialized || !this.getEditor() || (!manual && this.state.storageError)) return
    const generation = ++this._saveGeneration
    try {
      await this.callWorkspace('save', this.record())
      if (generation !== this._saveGeneration || this._disposed) return
      this.state.storageError = false
      this.state.storageKind = this._workspace?.kind || this.state.storageKind
      this.state.saveStatus = `已保存到${this.persistenceLabel()}${this.persistenceCaveat()} ${new Date().toLocaleTimeString()}`
      logger.info('storage', 'lark-doc.draft.saved', { status: this.props.persistence ? 'host' : 'local', kind: this.state.storageKind })
      this.emit('save', { status: 'saved', manual, target: this.persistenceLabel(), kind: this.state.storageKind, savedAt: Date.now() })
    } catch (error) { if (generation === this._saveGeneration && !this._disposed) this.storageFailure(error) }
  }

  storageFailure(error) {
    this.state.storageError = true
    this.state.saveStatus = error.message || '本地存储不可用，请导出当前文档'
    logger.warn('storage', 'lark-doc.storage.failed', { status: 'failed' })
    this.emit('save', { status: 'failed', message: this.state.saveStatus })
    this.emit('error', error)
  }

  async toggleHistory() {
    if (!this.featureEnabled('history')) return
    this.state.historyOpen = !this.state.historyOpen
    if (!this.state.historyOpen) return
    try { this.state.snapshots = await this.callWorkspace('snapshots') } catch (error) { this.storageFailure(error) }
  }

  async createSnapshot() {
    if (!this.featureEnabled('history') || !this.writable()) return
    try {
      await this.callWorkspace('snapshot', this.record())
      this.state.snapshots = await this.callWorkspace('snapshots')
      this.state.notice = `快照已保存到${this.persistenceLabel()}`
      logger.info('storage', 'lark-doc.snapshot.created', { itemCount: this.state.snapshots.length })
    } catch (error) { this.storageFailure(error) }
  }

  async restoreSnapshot(id) {
    if (!this.featureEnabled('history') || !this.writable()) return
    try {
      const entry = await this.callWorkspace('restore', id)
      const editor = this.getEditor()
      const json = validateDocument(migrateRecordContent(entry.json, entry.schemaVersion), editor.schema)
      if (!this.confirm('恢复此快照并替换当前正文？恢复后可撤销正文。')) return
      if (this.host.hydrateOutline && this.host.hydrateOutline(validateDerivedSnapshot(entry.derived, json)?.outline)) await nextPaintFrame()
      if (this._disposed) return
      this.closeAI()
      this.setContent(json)
      this.state.title = entry.title
      this.state.notice = '已恢复快照，可撤销正文'
    } catch (error) { this.state.notice = error.message }
  }

  async importDocument(event) {
    if (!this.featureEnabled('importExport')) return
    const file = event.target.files && event.target.files[0]
    event.target.value = ''
    if (!file || !this.writable()) return
    if (file.size > 10 * 1024 * 1024) { this.state.notice = '导入文件不能超过 10 MB'; return }
    this.state.importing = true
    try {
      const format = file.name.split('.').pop().toLowerCase()
      let content
      let importedTitle
      if (format === 'docx') {
        const mammoth = await loadFeature('office.mammoth', () => import(/* webpackChunkName: "office" */ 'mammoth/mammoth.browser'))
        const result = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() })
        content = sanitizeHTML(result.value)
      } else {
        const text = await file.text()
        if (format === 'json') {
          const value = JSON.parse(text)
          content = validateDocument(migrateRecordContent(value.document || value, value.schemaVersion), this.getEditor().schema)
          if (typeof value.title === 'string') importedTitle = value.title
        } else if (format === 'html' || format === 'htm') content = sanitizeHTML(text)
        else if (format === 'md' || format === 'markdown') {
          const { markdownToHtml } = await import(/* webpackChunkName: "import-export" */ '../utils/importExport')
          content = sanitizeHTML(await markdownToHtml(text))
        } else throw new Error('只支持 HTML / JSON / Markdown / DOCX')
      }
      if (this._disposed || !this.getEditor().isEditable) return
      if (typeof content === 'string') {
        const container = (this.getWindow().document || document).createElement('div')
        container.innerHTML = content
        const parsed = ProseMirrorDOMParser.fromSchema(this.getEditor().schema).parse(container)
        content = validateDocument(parsed.toJSON(), this.getEditor().schema)
        let hasContent = false
        parsed.descendants(node => { if (node.isText ? node.text.trim() : !node.isTextblock && node.type.name !== 'hardBreak') hasContent = true })
        if (!hasContent) throw new Error('文件未包含可导入的正文或内容块')
      }
      if (!this.confirm('导入并替换当前正文？原正文可通过撤销恢复。')) return
      this.closeAI()
      this.setContent(content)
      if (importedTitle !== undefined) this.state.title = importedTitle
      this.state.notice = format === 'docx' || format === 'md' || format === 'markdown' ? '导入完成；复杂布局按正文格式降级，请检查内容' : '导入完成'
      logger.info('import', 'lark-doc.document.imported', { format, status: 'success' })
    } catch (error) {
      if (!this._disposed) this.state.notice = `导入失败，原正文未替换：${error.message}`
      logger.warn('import', 'lark-doc.document.rejected', { status: 'failed' })
    } finally { if (!this._disposed) this.state.importing = false }
  }

  async exportDocument(format) {
    if (!this.featureEnabled('importExport') || !format) return
    try {
      const { downloadText, exportDocx, htmlToMarkdown, safeFileName } = await import(/* webpackChunkName: "import-export" */ '../utils/importExport')
      const filename = safeFileName(this.state.title)
      if (format === 'html') downloadText(this.getHTML(), `${filename}.html`, 'text/html;charset=utf-8')
      else if (format === 'json') downloadText(JSON.stringify({ schemaVersion: DOCUMENT_SCHEMA_VERSION, title: this.state.title, document: this.getJSON() }, null, 2), `${filename}.json`, 'application/json')
      else if (format === 'txt') downloadText(this.getText(), `${filename}.txt`, 'text/plain;charset=utf-8')
      else if (format === 'md') {
        downloadText(await htmlToMarkdown(this.getHTML()), `${filename}.md`, 'text/markdown;charset=utf-8')
        this.state.notice = 'Markdown 为简化导出，字体、分栏、公式和图片裁剪布局可能降级；JSON 可保留完整正文'
      } else if (format === 'docx') {
        await exportDocx(this.state.title, this.getText())
        this.state.notice = 'Word 为纯文本段落导出，不保留复杂块、表格和媒体布局；JSON 可保留完整正文'
      } else if (format === 'print') {
        const editor = this.getEditor()
        const folded = Array.from(editor.storage.larkDoc.folded)
        folded.forEach(id => editor.commands.toggleLarkDocFoldById(id))
        if (this.host.nextTick) this.host.nextTick(() => {
          this.getWindow().print()
          if (!this._disposed) folded.forEach(id => editor.commands.toggleLarkDocFoldById(id))
        })
      }
    } catch (error) { this.state.notice = `导出失败：${error.message}` }
  }

  mapAI({ transaction }) { mapAnchor(this._aiAnchor, transaction) }

  currentAIContext() {
    const editor = this.getEditor()
    return editor ? createContextSnapshot(editor, this.state.aiContextScope, 4000) : { scope: this.state.aiContextScope, from: 0, to: 0, source: '', text: '', summary: '无上下文', truncated: false, budgetExceeded: false, blockCount: 0 }
  }

  resetAIPreview() {
    if (this.state.aiRunning) this.stopAI()
    this.state.aiPreview = ''
    this.state.aiError = ''
    this.state.aiReviewIssues = []
    this.state.aiProposal = null
    this.state.aiBudgetExceeded = false
    this.state.aiGeneratedAction = null
    this.state.aiContextSummary = this.currentAIContext().summary
  }

  startAI(action = 'rewrite', options = {}) {
    if (!this.featureEnabled('ai') || !this.writable()) return
    this.stopAI()
    const allowed = AI_ACTIONS.some(item => item.value === action)
    const previewAction = action === 'chat' ? 'chat' : (allowed ? action : 'rewrite')
    if (previewAction !== 'chat') this.state.aiAction = previewAction
    this._aiPreviewAction = previewAction
    const context = this.currentAIContext()
    this._aiContext = context
    this.state.aiBudgetExceeded = Boolean(context.budgetExceeded)
    this.state.aiGeneratedAction = previewAction
    this.state.aiContextSummary = context.summary
    this._aiAnchor = { from: context.from, to: context.to, source: context.source, valid: true }
    this.state.aiOpen = true
    this.state.aiRunning = true
    this.state.aiPreview = ''
    this.state.aiError = ''
    this.state.aiStatus = '准备生成…'
    this.state.aiReviewIssues = []
    this.state.aiProposal = null
    const generation = this._aiGeneration
    const callbacks = {
      onStart: () => { if (generation === this._aiGeneration) this.state.aiStatus = '生成中…' },
      onChunk: chunk => { if (!this._disposed && generation === this._aiGeneration) { this.state.aiPreview += chunk; this.state.aiStatus = '生成中…' } },
      onDone: () => {
        if (this._disposed || generation !== this._aiGeneration) return
        this.state.aiRunning = false
        this.state.aiStatus = '已完成，等待确认'
        if (this._aiPreviewAction === 'proofread') this.state.aiReviewIssues = createReviewResult(context.text).issues
        if (this._aiPreviewAction === 'outline') this.state.aiProposal = createToolProposal(context, this._aiAnchor)
        if (this._aiPreviewAction === 'chat' && options.appendMessage) this.state.aiMessages.push({ id: `ai-${Date.now()}`, role: 'assistant', text: this.state.aiPreview })
      },
      onCancelled: () => { if (generation === this._aiGeneration) this.state.aiStatus = '已停止' },
      onError: error => { if (generation === this._aiGeneration) { this.state.aiRunning = false; this.state.aiError = error.message || 'AI 生成失败'; this.state.aiStatus = '失败' } },
    }
    const adapter = this.getAIAdapter()
    this.state.aiContentFormat = adapter ? adapter.contentFormat : 'text'
    if (adapter) {
      try {
        const handle = adapter.stream({
          action: this._aiPreviewAction,
          text: context.text,
          prompt: options.prompt || this.state.aiPrompt,
          language: this.state.aiLanguage,
          range: { from: context.from, to: context.to, source: context.source },
          context,
          ...callbacks,
        })
        this._aiStream = typeof handle === 'function' ? { cancel: handle } : (handle || { cancel() {} })
      } catch (error) { callbacks.onError(error) }
    } else {
      this._aiStream = streamMock(this._aiPreviewAction, context.text, {
        prompt: options.prompt || this.state.aiPrompt,
        language: this.state.aiLanguage,
        delay: 16,
        ...callbacks,
      })
    }
    logger.info('ai', 'lark-doc.mock.started', { action: previewAction, status: 'local' })
  }

  sendAIChat() {
    const prompt = this.state.aiPrompt.trim()
    if (!prompt || this.state.aiRunning || !this.writable()) return
    this.state.aiMessages.push({ id: `user-${Date.now()}`, role: 'user', text: prompt })
    this.startAI('chat', { prompt, appendMessage: true })
    this.state.aiPrompt = ''
  }

  regenerateAI() { if (!this.state.aiRunning) this.startAI(this.state.aiAction, { prompt: this.state.aiPrompt }) }

  stopAI() {
    this._aiGeneration += 1
    if (this._aiStream && typeof this._aiStream.cancel === 'function') {
      try { this._aiStream.cancel() } catch (error) { /* 宿主流已关闭时忽略 */ }
    }
    this._aiStream = null
    this.state.aiRunning = false
    if (this.state.aiOpen && !this.state.aiStatus.includes('完成')) this.state.aiStatus = '已停止'
  }

  closeAI() {
    this.stopAI()
    this.state.aiOpen = false
    this._aiAnchor = null
    this._aiPreviewAction = null
    this._aiContext = null
    this.state.aiBudgetExceeded = false
    this.state.aiGeneratedAction = null
    this.state.aiReviewIssues = []
    this.state.aiProposal = null
    this.state.aiStatus = ''
    if (!this._disposed) this.focus()
  }

  async copyAIPreview() {
    if (!this.state.aiPreview) return
    try {
      const clipboard = this.getNavigator().clipboard
      if (clipboard?.writeText) await clipboard.writeText(this.state.aiPreview)
      else throw new Error('clipboard unavailable')
      this.state.notice = 'AI 结果已复制'
    } catch (_) { this.state.aiError = '无法访问剪贴板，请手动选择复制' }
  }

  acceptAI(mode = 'replace') {
    if (!this.writable() || this.state.aiRunning || !this.state.aiPreview) return
    if (this.state.aiBudgetExceeded && mode !== 'insert' && this.state.aiGeneratedAction !== 'title') {
      this.state.aiError = '上下文超过预算，只能插入到光标；请缩小范围后再替换。'
      return
    }
    const editor = this.getEditor()
    if (!anchorValid(this._aiAnchor, editor.state.doc)) {
      this.state.aiError = '原选区已改变或失效，请重新选择并生成预览。'
      logger.info('ai', 'lark-doc.mock.rejected', { status: 'stale' })
      return
    }
    if (this._aiPreviewAction === 'title') this.state.title = this.state.aiPreview.trim()
    else {
      const { from, to } = this._aiAnchor
      const insertFrom = mode === 'insert' ? editor.state.selection.from : (this._aiPreviewAction === 'continue' ? to : from)
      const insertTo = mode === 'insert' ? editor.state.selection.from : to
      this.insertAIResult(editor, insertFrom, insertTo)
    }
    this.closeAI()
    logger.info('ai', 'lark-doc.mock.accepted', { status: 'accepted' })
  }

  insertAIResult(editor, from, to) {
    const fallback = () => editor.view.dispatch(editor.state.tr.insertText(this.state.aiPreview, from, to).scrollIntoView())
    const format = this.state.aiContentFormat || 'auto'
    if (format !== 'html' && format !== 'markdown' && !looksLikeMarkdown(this.state.aiPreview)) { fallback(); return }
    const html = previewToHtml(this.state.aiPreview, format)
    if (!html) { fallback(); return }
    const inline = singleParagraphInner(html)
    try {
      editor.chain().focus().insertContentAt({ from, to }, inline === null ? html : inline, { updateSelection: true }).scrollIntoView().run()
    } catch (error) { fallback() }
  }

  acceptReviewIssue(issue) {
    if (!issue || !this.writable() || this.state.aiRunning || !this._aiAnchor) return
    const editor = this.getEditor()
    if (!anchorValid(this._aiAnchor, editor.state.doc)) {
      this.state.aiError = '原选区已改变或失效，请重新选择并生成预览。'
      return
    }
    const from = Math.min(this._aiAnchor.to, this._aiAnchor.from + Math.max(0, issue.from || 0))
    const to = Math.min(this._aiAnchor.to, this._aiAnchor.from + Math.max(issue.from || 0, issue.to || 0))
    if (to <= from) { this.state.aiError = '该审阅建议没有可替换的原文。'; return }
    if (typeof issue.expected === 'string' && editor.state.doc.textBetween(from, to, '\n') !== issue.expected) {
      this.state.aiError = '该审阅建议对应的原文已改变，请重新生成。'
      return
    }
    editor.view.dispatch(editor.state.tr.insertText(issue.suggestion || '', from, to).scrollIntoView())
    this.state.aiReviewIssues = this.state.aiReviewIssues.filter(item => item.id !== issue.id)
    this.state.aiStatus = '已接受审阅建议'
  }

  ignoreReviewIssue(id) { this.state.aiReviewIssues = this.state.aiReviewIssues.filter(issue => issue.id !== id) }

  applyAIProposal() {
    if (!this.state.aiProposal || !this.writable()) return
    const content = this.state.aiProposal.operations[0]?.content
    if (!content) return
    const editor = this.getEditor()
    const target = this.state.aiProposal.target
    if (!anchorValid(this._aiAnchor, editor.state.doc) || !target || target.scope !== this._aiContext?.scope || target.source !== this._aiAnchor.source) {
      this.state.aiError = '提案对应的原文已改变或失效，请重新生成。'
      return
    }
    editor.view.dispatch(editor.state.tr.insertText(content, this._aiAnchor.from, this._aiAnchor.from).scrollIntoView())
    this.state.notice = '已应用 AI 提案，可撤销'
    this.state.aiProposal = null
    this.state.aiPreview = ''
    this.state.aiStatus = '提案已应用'
  }

  dispose() {
    if (this._disposed) return
    this._disposed = true
    this.stopAI()
    void this.saveNow()
    clearTimeout(this._saveTimer)
    if (this.host.removeBeforeUnload) this.host.removeBeforeUnload(this.flushOnLeave)
    if (this.host.unbindAITransaction) this.host.unbindAITransaction(this.mapAI)
    if (!this.props.session) void this.getSession()?.dispose()
  }
}
