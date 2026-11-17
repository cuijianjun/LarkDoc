import { TEMPLATES } from '../components/lark-doc/templates'
import { AI_ACTIONS, AI_CONTEXTS } from '../components/lark-doc/mockAI'
import { normalizeAIProvider } from '../components/lark-doc/ai'
import { createLarkDocConfig, resolveMediaOptions } from '../components/lark-doc/larkDocConfig'
import { applyMediaHtmlMode } from '../core/media/htmlMode'
import { validateDocument } from '../components/lark-doc/documentOperations'
import { migrateRecordContent } from '../core/migrations'
import { validateDerivedSnapshot } from '../core/derive/snapshot'
import { logger } from '../utils/logger'
import { createDocumentSession } from '../session/DocumentSession'
import { persistenceMethods } from './workspacePersistenceMethods'
import { templateMethods } from './workspaceTemplateMethods'
import { transferMethods } from './workspaceTransferMethods'
import { aiContextMethods } from './workspaceAIContextMethods'
import { aiRunMethods } from './workspaceAIRunMethods'
import { nextPaintFrame } from './workspaceShared'

export function createWorkspaceState({ initialContent, initialTitle, templates, config }) {
  const templateItems = Array.isArray(templates) ? templates : TEMPLATES
  const firstTemplate = templateItems[0] || { html: '<p></p>', title: '未命名文档' }
  return {
    html: typeof initialContent === 'string' ? initialContent : firstTemplate.html,
    title: initialTitle != null ? initialTitle : firstTemplate.title,
    templateItems,
    forcedReadonly: false,
    mode: 'edit',
    modeMenuOpen: false,
    modeToast: '',
    headerMenuOpen: false,
    searchOpen: false,
    slides: false,
    slideIndex: 0,
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
    aiImageChat: false,
    aiImage: null,
    aiSelectionChat: false,
    aiReference: null,
    aiChatEpoch: 0,
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
    // Reports are public payloads: keep their identity outside reactive view state.
    this._importReport = state.importReport || null
    this._disposed = false
    this.flushOnLeave = this.flushOnLeave.bind(this)
    this.mapAI = this.mapAI.bind(this)
  }

  isDisposed() { return this._disposed }

  getEditor() { return this.host.getEditor ? this.host.getEditor() : null }

  featureEnabled(name) { return !this.state.editorConfig?.features || this.state.editorConfig.features[name] !== false }

  writable() { return this.host.writable ? this.host.writable() : Boolean(this.getEditor()?.isEditable && !this.state.importing) }

  emit(...args) { if (this.host.emit) this.host.emit(...args) }

  confirm(message) { return this.host.confirm ? this.host.confirm(message) : true }

  setContent(content, options) { return this.host.setContent ? this.host.setContent(content, options) : false }

  async setContentAsync(content, options) {
    const pendingFile = this._fileImportIntent
    if (pendingFile && options?.signal !== pendingFile.abort.signal) pendingFile.retire()
    const fileIntent = this._fileImportIntent
    const previous = this._asyncImport?.fileIntent === fileIntent ? this._asyncImport?.previous : undefined
    const job = { previous: previous ?? this.state.importing, fileIntent }
    this._asyncImport = job
    this.state.importing = true
    try { return await (this.host.setContentAsync ? this.host.setContentAsync(content, options) : this.setContent(content, options)) }
    finally { if (this._asyncImport === job) { this._asyncImport = null; if (!this._disposed && (!fileIntent || this._fileImportIntent === fileIntent)) this.state.importing = job.previous } }
  }

  focus() { if (this.host.focus) this.host.focus() }

  getHTML() { return this.host.getHTML ? this.host.getHTML() : '' }

  getExportHTML() { return applyMediaHtmlMode(this.getHTML(), resolveMediaOptions(this.state.editorConfig)) }

  getJSON() { return this.host.getJSON ? this.host.getJSON() : null }

  getText() { return this.host.getText ? this.host.getText() : '' }

  getImportReport() { return this._importReport }

  onImportReport(report) {
    this._importReport = report || null
    this.state.importReport = this._importReport
    if (report) this.emit('import-report', report)
  }

  getWindow() { return this.host.getWindow ? this.host.getWindow() : (typeof window !== 'undefined' ? window : {}) }

  getNavigator() { return this.host.getNavigator ? this.host.getNavigator() : (typeof navigator !== 'undefined' ? navigator : {}) }

  getAIAdapter() { return normalizeAIProvider(this.host.getAIProvider ? this.host.getAIProvider() : this.props.aiProvider) }

  getTitle() { return this.state.title }

  setTitle(value) {
    if (this.isReadonly()) return false
    this.state.title = value == null ? '' : String(value)
    this.queueSave()
    return true
  }

  setReadonly(value) {
    this.state.forcedReadonly = value === true
    if (this.host.setReadonly) return this.host.setReadonly(this.isReadonly())
    return true
  }

  isReadonly() { return Boolean(this.props.readonly || this.state.forcedReadonly || this.state.effectiveReadonly) }

  insertContent(content) {
    const editor = this.getEditor()
    if (!editor || !this.writable()) return false
    return editor.chain().focus().insertContent(content).run()
  }

  insertText(text) { return this.insertContent(String(text == null ? '' : text)) }

  undo() { const editor = this.getEditor(); return editor ? editor.storage?.imageUploadTasks?.undoPending() || editor.chain().focus().undo().run() : false }

  redo() { const editor = this.getEditor(); return editor ? editor.storage?.imageUploadTasks?.redoPending() || editor.chain().focus().redo().run() : false }

  save() { return this.saveNow(true) }

  initializeSession() {
    this.state.sessionInstance = this.props.session || createDocumentSession({
      documentId: this.props.documentId || 'local',
      mode: 'local',
      user: this.props.user,
      capabilities: this.props.capabilities || {},
      persistence: this.props.persistence,
      autoVersion: this.props.autoVersion,
    })
    return this.state.sessionInstance
  }

  getSession() { return this.state.sessionInstance || this.props.session }

  checkInitialization() { this._initialPersistenceLoad?.check() }

  async onReady() {
    this._initialPersistenceLoad?.retire()
    this.getSession()?.attachEditor(this.getEditor(), this.host.getDocumentAccess?.())
    if (this.props.initialContent && typeof this.props.initialContent === 'object' && !this._contentSeeded) {
      this._contentSeeded = true
      try { this.setContent(this.props.initialContent) } catch (error) { this.storageFailure(error) }
    }
    const scope = this._capturePersistenceScope(), initialEditor = this.getEditor(), initialDoc = initialEditor?.state.doc, initialTitle = this.state.title
    const retired = Symbol('retired draft load'), stops = []
    let cancelLoad
    const cancellation = new Promise(resolve => { cancelLoad = () => resolve(retired) })
    const load = { completed: false, retired: false,
      check: () => { if (!scope.current()) load.retire() },
      retire: () => {
        if (load.retired) return
        load.retired = true; cancelLoad()
        // The old provider may never settle. Finish this live instance's setup,
        // while the race below prevents its draft from becoming current again.
        finish()?.catch(() => {})
      },
    }
    const finish = () => {
      if (load.completed) return load.completion
      load.completed = true
      load.completion = (async () => {
        if (this._disposed || this._initialPersistenceLoad !== load || this.getEditor()?.isDestroyed) return
        this.state.initialized = true
        const editor = this.getEditor()
        if (editor && this.host.bindAITransaction) this.host.bindAITransaction(this.mapAI)
        if (this.host.addBeforeUnload) this.host.addBeforeUnload(this.flushOnLeave)
        logger.info('lifecycle', 'lark-doc.workspace.ready', { status: this.props.persistence ? 'host' : 'local' })
        // Always dispatch after construction, including disabled or retired loads.
        await Promise.resolve()
        if (!this._disposed && this._initialPersistenceLoad === load && !this.getEditor()?.isDestroyed) this.emit('ready', { editor: this.getEditor(), document: this.host.documentApi || this })
      })()
      return load.completion
    }
    this._initialPersistenceLoad = load
    for (const event of ['identity', 'comments-reset', 'capabilities', 'provider-changed', 'connection']) {
      const stop = scope.session?.on?.(event, load.check)
      if (typeof stop === 'function') stops.push(stop)
    }
    const stopEditor = scope.session?.on?.('editor', editor => { if (editor !== initialEditor) load.retire(); else load.check() })
    if (typeof stopEditor === 'function') stops.push(stopEditor)
    initialEditor?.on?.('destroy', load.retire)
    stops.push(() => initialEditor?.off?.('destroy', load.retire))
    try {
      if (scope.enabled) {
        try {
          const draft = await Promise.race([this.callWorkspace('load'), cancellation])
          if (draft === retired || load.retired || !scope.current()) return
          const preserved = this.props._preserveRuntimeState || {}
          let restored = false
          if (draft && !preserved.content && this.getEditor()?.state.doc === initialDoc) {
            const editor = this.getEditor()
            const content = validateDocument(migrateRecordContent(draft.json, draft.schemaVersion), editor.schema)
            if (this.host.hydrateOutline && this.host.hydrateOutline(validateDerivedSnapshot(draft.derived, content)?.outline)) await nextPaintFrame()
            if (!scope.current()) return
            if (editor.state.doc === initialDoc) { this.setContent(content); restored = true }
          }
          if (!scope.current()) return
          if (draft && !preserved.title && this.state.title === initialTitle) { this.state.title = draft.title; restored = true }
          if (!scope.current()) return
          this.state.saveStatus = restored
            ? `已恢复${this.persistenceLabel()}草稿`
            : (this.props.persistence ? '宿主适配器 · 尚未保存' : '本地示例 · 尚未保存')
        } catch (error) { if (scope.current()) this.storageFailure(error) }
      } else this.state.saveStatus = '本地保存已关闭'
    } finally {
      try { await finish() }
      finally { stops.splice(0).forEach(stop => stop()); scope.release(); if (this._initialPersistenceLoad === load) this._initialPersistenceLoad = null }
    }
  }

  dispose() {
    if (this._disposed) return
    this._disposed = true
    this._initialPersistenceLoad?.retire()
    this.closeAI(false)
    void this.saveNow()
    clearTimeout(this._saveTimer)
    if (this.host.removeBeforeUnload) this.host.removeBeforeUnload(this.flushOnLeave)
    if (this.host.unbindAITransaction) this.host.unbindAITransaction(this.mapAI)
    if (!this.props.session) void this.getSession()?.dispose()
  }
}

// 方法域按对象字面量并回原型：方法体、执行顺序与 `this` 绑定都没有变化，
// 拆开的只是「哪些方法与哪些状态住在一起」这一层阅读负担。
Object.assign(WorkspaceController.prototype,
  persistenceMethods,
  templateMethods,
  transferMethods,
  aiContextMethods,
  aiRunMethods,
)

