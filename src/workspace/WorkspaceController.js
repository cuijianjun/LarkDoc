import { DOMParser as ProseMirrorDOMParser } from '@tiptap/pm/model'
import { CellSelection } from '@tiptap/pm/tables'
import { createPersistenceWorkspace, detectBrowserStorage } from '../providers/persistence'
import { AI_ACTIONS, AI_CONTEXTS, streamMock, createContextSnapshot, createReviewResult, createToolProposal, mapAnchor, anchorValid } from '../components/lark-doc/mockAI'
import { normalizeAIProvider, previewToHtml, singleParagraphInner, looksLikeMarkdown } from '../components/lark-doc/ai'
import { TEMPLATES } from '../components/lark-doc/templates'
import {
  createLarkDocConfig, isAutoSaveEnabled, resolveAutoSaveDelay,
  isImportEnabled, isExportEnabled, resolveImportFormatId, resolveMediaOptions,
} from '../components/lark-doc/larkDocConfig'
import { applyMediaHtmlMode } from '../core/media/htmlMode'
import { sanitizeHTML, validateDocument } from '../components/lark-doc/documentOperations'
import { migrateRecordContent } from '../core/migrations'
import { createDerivedSnapshot, validateDerivedSnapshot } from '../core/derive/snapshot'
import { DOCUMENT_SCHEMA_VERSION } from '../core/documentSchema'
import { logger } from '../utils/logger'
import { loadFeature } from '../core/features/registry'
import { createDocumentSession } from '../session/DocumentSession'
import { cropImageBlob, normalizeImageCrop, FULL_IMAGE_CROP } from '../core/media/image-crop'
import { createNetworkPolicy } from '../core/policy/network'
import { flattenHeadingContainers, safeUrl } from '../core/documentOperations'

const nextPaintFrame = () => (typeof requestAnimationFrame === 'function'
  ? new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  : Promise.resolve())

function aiNetworkAllows(value, network, base, image = false) {
  if (typeof value !== 'string' || !value || /[\\\s]/.test(value)) return false
  let target = value
  if (target.startsWith('//')) {
    if (image) return false
    try { target = new URL(target, base || 'https://local.invalid/').href } catch (_) { return false }
  }
  if (image ? !safeUrl(value, true) : (/^[a-z][a-z\d+.-]*:/i.test(target) && (!/^https?:\/\//i.test(target) || !safeUrl(target, true)))) return false
  return network.allows(target)
}

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
    })
    return this.state.sessionInstance
  }

  getSession() { return this.state.sessionInstance || this.props.session }

  async onReady() {
    this.getSession()?.attachEditor(this.getEditor(), this.host.getDocumentAccess?.())
    if (this.props.initialContent && typeof this.props.initialContent === 'object' && !this._contentSeeded) {
      this._contentSeeded = true
      try { this.setContent(this.props.initialContent) } catch (error) { this.storageFailure(error) }
    }
    if (this.featureEnabled('persistence')) {
      try {
        const draft = await this.callWorkspace('load')
        if (this._disposed) return
        const preserved = this.props._preserveRuntimeState || {}
        const restoreDraft = draft && (!preserved.content || !preserved.title)
        if (draft && !preserved.content) {
          const editor = this.getEditor()
          const content = validateDocument(migrateRecordContent(draft.json, draft.schemaVersion), editor.schema)
          if (this.host.hydrateOutline && this.host.hydrateOutline(validateDerivedSnapshot(draft.derived, content)?.outline)) await nextPaintFrame()
          if (this._disposed) return
          this.setContent(content)
        }
        if (draft && !preserved.title) this.state.title = draft.title
        this.state.saveStatus = restoreDraft
          ? `已恢复${this.persistenceLabel()}草稿`
          : (this.props.persistence ? '宿主适配器 · 尚未保存' : '本地示例 · 尚未保存')
      } catch (error) { this.storageFailure(error) }
    } else this.state.saveStatus = '本地保存已关闭'
    this.state.initialized = true
    const editor = this.getEditor()
    if (editor && this.host.bindAITransaction) this.host.bindAITransaction(this.mapAI)
    if (this.host.addBeforeUnload) this.host.addBeforeUnload(this.flushOnLeave)
    logger.info('lifecycle', 'lark-doc.workspace.ready', { status: this.props.persistence ? 'host' : 'local' })
    // `ready` 必须在 `new LarkDoc()` 返回之后派发：宿主常在回调里访问刚创建的门面实例
    // （例如 instance.getHTML() 写宿主草稿）。关掉 persistence 后 onReady() 内没有
    // `await load()`，若这里同步 emit，回调会在构造函数执行期间触发，宿主拿到的还是 null。
    // 统一补一个微任务边界，让两种持久化配置下的 ready 时序一致。
    await Promise.resolve()
    if (this._disposed) return
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

  /**
   * 按当前 autosave 配置排一次落盘。返回是否真的排了定时器。
   * queueSave() 与 setAutoSave() 共用，保证「构造期配置」和「运行中热更」
   * 走的是同一套判定与延迟，不会出现两套口径。
   */
  _scheduleSaveTimer() {
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null }
    if (!this.featureEnabled('persistence') || !this.state.initialized || this.state.storageError || this._disposed) return false
    if (!isAutoSaveEnabled(this.state.editorConfig)) return false
    this.state.saveStatus = '等待本地保存…'
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null
      void this.saveNow()
    }, resolveAutoSaveDelay(this.state.editorConfig))
    return true
  }

  queueSave() {
    if (!this.featureEnabled('persistence') || !this.state.initialized || this.state.storageError || this._disposed) return
    if (!this._scheduleSaveTimer()) this.state.saveStatus = '自动保存已关闭'
  }

  /**
   * 运行时调整自动保存：{ enabled?: boolean, delay?: number }。
   *
   * 只改 autosave 段，归一化复用构造期同一套 createLarkDocConfig（非法 delay
   * 回落 650、enabled 非 false 即 true）。已排队的定时器必须一起处理：
   * - 关掉时直接取消，否则「刚关闭却仍落一次盘」；
   * - 改延迟时从当前时刻按新值重新计时，否则新配置要等下一次编辑才生效。
   * 手动 save() / 离页 flush 不受影响。
   */
  setAutoSave(options = {}) {
    if (this._disposed) return this.getAutoSave()
    const patch = options && typeof options === 'object' ? options : {}
    const current = this.state.editorConfig?.autosave || {}
    this.state.editorConfig.autosave = createLarkDocConfig({ autosave: { ...current, ...patch } }).autosave
    // 只有在确实有待执行定时器时才动它：空闲状态改配置不该产生一次多余的落盘。
    if (this._saveTimer) {
      if (!this._scheduleSaveTimer()) this.state.saveStatus = '自动保存已关闭'
    }
    return this.getAutoSave()
  }

  /** 返回 { enabled（配置值）, delay, effective（叠加持久化总闸后的实际生效值） }。 */
  getAutoSave() {
    const config = this.state.editorConfig
    const autosave = config?.autosave || {}
    return {
      enabled: autosave.enabled !== false,
      delay: resolveAutoSaveDelay(config),
      effective: isAutoSaveEnabled(config),
    }
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

  applyTemplate(id) {
    if (!this.featureEnabled('templates') || !id || !this.writable()) return false
    const template = this.state.templateItems.find(item => item.id === id)
    if (!template || !this.confirm('替换当前正文？可用撤销恢复正文；建议先保存快照。')) return false
    this.closeAI()
    this.setContent(template.html)
    this.state.title = template.title
    this.queueSave()
    return true
  }

  openTemplatePicker() {
    if (!this.featureEnabled('templates') || !this.writable()) return
    this.state.historyOpen = false
    this.state.aiOpen = false
    this.state.templateQuery = ''
    this.state.templateOpen = true
    if (this.host.nextTick) this.host.nextTick(() => this.host.focusTemplateSearch?.())
  }

  closeTemplatePicker() {
    this.state.templateOpen = false
    this.state.templateQuery = ''
    this.focus()
  }

  chooseTemplate(id) {
    if (this.applyTemplate(id)) this.closeTemplatePicker()
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
    if (!isImportEnabled(this.state.editorConfig)) return
    const file = event.target.files && event.target.files[0]
    event.target.value = ''
    if (!file || !this.writable()) return
    // `state.importing` is reflected by the editor host as a temporary lock while the
    // file is being read. Capture the editor before that lock so the post-read guard
    // can distinguish a real readonly transition from our own import busy state.
    const importingEditor = this.getEditor()
    if (!importingEditor || !importingEditor.isEditable) return
    if (file.size > 10 * 1024 * 1024) { this.state.notice = '导入文件不能超过 10 MB'; return }
    const format = resolveImportFormatId(this.state.editorConfig, file.name.split('.').pop())
    if (!format) {
      this.state.notice = `不支持的文件格式，可导入：${this.state.editorConfig.importExport.importFormats.join(' / ').toUpperCase()}`
      return
    }
    this.state.importing = true
    try {
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
        } else if (format === 'html') content = sanitizeHTML(text)
        else if (format === 'md') {
          const { markdownToHtml } = await import(/* webpackChunkName: "import-export" */ '../utils/importExport')
          content = sanitizeHTML(await markdownToHtml(text))
        } else throw new Error('只支持 HTML / JSON / Markdown / DOCX')
      }
      const activeEditor = this.getEditor()
      // The host aliases `readonly` to `source.importing`, so `effectiveReadonly` is
      // intentionally true during this read. Only abort for an actual read mode or a
      // forced readonly prop; otherwise every import would self-cancel here.
      const actuallyReadonly = this.state.mode === 'read' || this.state.forcedReadonly
      if (this._disposed || !activeEditor || activeEditor.isDestroyed || actuallyReadonly) return
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
      this.state.notice = format === 'docx' || format === 'md' ? '导入完成；复杂布局按正文格式降级，请检查内容' : '导入完成'
      logger.info('import', 'lark-doc.document.imported', { format, status: 'success' })
    } catch (error) {
      if (!this._disposed) this.state.notice = `导入失败，原正文未替换：${error.message}`
      logger.warn('import', 'lark-doc.document.rejected', { status: 'failed' })
    } finally { if (!this._disposed) this.state.importing = false }
  }

  async exportDocument(format) {
    if (!isExportEnabled(this.state.editorConfig) || !format) return
    if (!this.state.editorConfig.importExport.exportFormats.includes(format)) return
    if (format === 'docx') return this.exportWordDocument()
    try {
      const { downloadText, htmlToMarkdown, safeFileName } = await import(/* webpackChunkName: "import-export" */ '../utils/importExport')
      const filename = safeFileName(this.state.title)
      if (format === 'html') downloadText(this.getExportHTML(), `${filename}.html`, 'text/html;charset=utf-8')
      else if (format === 'json') downloadText(JSON.stringify({ schemaVersion: DOCUMENT_SCHEMA_VERSION, title: this.state.title, document: this.getJSON() }, null, 2), `${filename}.json`, 'application/json')
      else if (format === 'txt') downloadText(this.getText(), `${filename}.txt`, 'text/plain;charset=utf-8')
      else if (format === 'md') {
        downloadText(await htmlToMarkdown(this.getExportHTML()), `${filename}.md`, 'text/markdown;charset=utf-8')
        this.state.notice = 'Markdown 为简化导出，字体、分栏、公式和图片裁剪布局可能降级；JSON 可保留完整正文'
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

  async exportWordDocument() {
    const editor = this.getEditor(), session = this.getSession()
    const sourceDoc = editor?.state?.doc
    const documentId = this.props.documentId, sessionDocumentId = session?.documentId
    const networkKey = JSON.stringify(this.state.editorConfig.network)
    const current = () => !this._disposed && !editor?.isDestroyed && !session?._destroyed
      && this.getEditor() === editor && this.getSession() === session
      && this.props.documentId === documentId && session?.documentId === sessionDocumentId
      && editor?.state?.doc === sourceDoc
    const allowed = () => current() && isExportEnabled(this.state.editorConfig)
      && this.state.editorConfig.importExport.exportFormats.includes('docx')
      && (typeof session?.can !== 'function' || (session.can('canView') && session.can('canExport')))
      && JSON.stringify(this.state.editorConfig.network) === networkKey
    try {
      if (!current()) return false
      if (!allowed()) throw new Error('当前用户没有导出权限或导出已关闭')
      const title = this.state.title
      const doc = flattenHeadingContainers(JSON.parse(JSON.stringify(this.getJSON())))
      if (!doc || doc.type !== 'doc' || !Array.isArray(doc.content)) throw new Error('没有可导出的正文结构')
      const network = createNetworkPolicy(this.state.editorConfig.network)
      const sources = new Set()
      const visit = node => {
        if (node.type === 'image' && typeof node.attrs?.src === 'string' && node.attrs.src) sources.add(node.attrs.src)
        if (Array.isArray(node.content)) node.content.forEach(visit)
      }
      visit(doc)
      const { exportDocx } = await import(/* webpackChunkName: "import-export" */ '../utils/export/index.js')
      const images = {}, failed = new Set()
      const viewWindow = this.getWindow()
      const fetchImage = viewWindow.fetch || (typeof fetch === 'function' ? fetch : null)
      for (const src of sources) {
        if (!allowed()) throw new Error('导出期间文档、权限或网络策略已改变，请重新导出')
        // Never let collectImages implicitly fetch an off-policy resource or follow redirects.
        if (src.includes('\\') || !safeUrl(src, true) || !network.allows(src) || !fetchImage) { failed.add(src); continue }
        try {
          const response = await fetchImage(src, { credentials: 'same-origin', redirect: 'error' })
          if (!allowed()) throw new Error('导出条件已改变')
          if (!response.ok) throw new Error('图片读取失败')
          images[src] = new Uint8Array(await response.arrayBuffer())
        } catch (_) { failed.add(src) }
      }
      if (!allowed()) throw new Error('导出期间文档、权限或网络策略已改变，请重新导出')
      // Supplying even an empty map keeps the canonical exporter from fetching on its own.
      const result = await exportDocx(doc, { fileName: title, title, scope: 'contentOnly', images, shouldDownload: allowed })
      for (const src of result?.failedImages || []) failed.add(src)
      if (allowed()) this.state.notice = failed.size
        ? `Word 已导出；${failed.size} 张图片因网络策略或读取失败未导出`
        : 'Word 已导出'
      return result
    } catch (error) {
      if (current()) this.state.notice = `导出失败：${error.message}`
      return false
    }
  }

  mapAI({ transaction }) {
    if ((this.state.aiImageChat || this.state.aiSelectionChat) && transaction.docChanged) {
      let replaced = false
      transaction.mapping.maps?.forEach(map => map.forEach((from, to) => { if (from === 0 && to >= transaction.before?.content.size) replaced = true }))
      if (replaced) { this.closeAI(false); return }
    }
    mapAnchor(this._aiAnchor, transaction)
    const reference = this._aiSelectionReference
    if (reference && transaction.docChanged) {
      try {
        const previous = reference.bookmark.resolve(transaction.before)
        if (previous.ranges.some(range => transaction.mapping.mapResult(range.$from.pos, 1).deleted || transaction.mapping.mapResult(range.$to.pos, -1).deleted)) throw new Error('deleted reference')
        reference.bookmark = reference.bookmark.map(transaction.mapping)
        if (reference.cells) reference.cells = reference.cells.map(cell => ({ ...cell, pos: transaction.mapping.mapResult(cell.pos, 1).pos }))
        if (!this.selectionAIReferenceValid(reference, transaction.doc)) throw new Error('changed reference')
      } catch (_) { this.removeAIReference('引用的内容已改变，请重新选择后提问。') }
    }
    if (this.state.aiImage && transaction.docChanged) {
      const mapped = transaction.mapping.mapResult(this.state.aiImage.pos, 1)
      this.state.aiImage = { ...this.state.aiImage, pos: mapped.pos }
      // setNodeMarkup can mark an unchanged leaf as deleted while resizing/aligning it.
      if (!this.imageAIValid()) {
        this.removeAIImage()
        this.state.aiError = '引用的图片已改变，请重新添加图片。'
      }
    }
    this.syncImageAI()
  }

  createAIChatScope() {
    const session = this.getSession()
    return { editor: this.getEditor(), session, sessionDocumentId: session?.documentId, documentId: this.props.documentId,
      provider: this.host.getAIProvider ? this.host.getAIProvider() : this.props.aiProvider, network: JSON.stringify(this.state.editorConfig.network) }
  }

  aiChatScopeValid(scope) {
    const session = this.getSession()
    return !!scope?.editor?.state && !this._disposed && !scope.editor.isDestroyed && !session?._destroyed
      && this.writable() && this.featureEnabled('ai') && this.getEditor() === scope.editor
      && session === scope.session && session?.documentId === scope.sessionDocumentId && this.props.documentId === scope.documentId
      && (typeof session?.can !== 'function' || (session.can('canView') && session.can('canEdit')))
      && scope.provider === (this.host.getAIProvider ? this.host.getAIProvider() : this.props.aiProvider)
      && scope.network === JSON.stringify(this.state.editorConfig.network)
  }

  getAIChatAdapter() {
    const adapter = this.getAIAdapter()
    if (adapter?.kind === 'endpoint' && !aiNetworkAllows(adapter.endpoint || adapter.baseURL, createNetworkPolicy(this.state.editorConfig.network), this.getWindow().location?.href)) return null
    return adapter
  }

  openSelectionAI() {
    const scope = this.createAIChatScope()
    if (!this.aiChatScopeValid(scope)) return false
    const selection = scope.editor.state.selection
    let reference = null
    if (!selection.empty) {
      const cells = []
      if (selection instanceof CellSelection) selection.forEachCell((node, pos) => cells.push({ node, pos }))
      cells.sort((a, b) => a.pos - b.pos)
      const text = cells.length ? cells.map(cell => cell.node.textContent).join('\n') : scope.editor.state.doc.textBetween(selection.from, selection.to, '\n')
      reference = { kind: cells.length ? 'table' : 'text', replaceable: this.aiSelectionReplaceable(selection), bookmark: selection.getBookmark(), slice: selection.content(), cells: cells.length ? cells : null, text }
    }
    this.closeAI(false)
    this._aiChatScope = scope
    this._aiSelectionReference = reference
    this.state.aiOpen = true
    this.state.aiSelectionChat = true
    this.state.aiReference = reference ? { kind: reference.kind, text: reference.text, replaceable: reference.replaceable, label: reference.kind === 'table' ? '[表格选区]' : reference.text || '[选区]' } : null
    this.state.aiContextSummary = reference ? `${reference.kind === 'table' ? '所选单元格' : '当前选区'} · ${reference.text.length} 字` : '无上下文'
    this.state.aiPrompt = ''
    this.state.aiPreview = ''
    this.state.aiMessages = []
    this.state.aiError = ''
    this.state.aiStatus = ''
    this.host.focusImageAI?.()
    return true
  }

  selectionAIReferenceValid(reference = this._aiSelectionReference, doc = this.getEditor()?.state.doc) {
    if (!reference || !doc) return !reference
    try {
      const selection = reference.bookmark.resolve(doc)
      return (selection instanceof CellSelection) === (reference.kind === 'table') && selection.content().eq(reference.slice)
        && (!reference.cells || reference.cells.every(cell => doc.nodeAt(cell.pos) === cell.node))
    } catch (_) { return false }
  }

  aiSelectionReplaceable(selection) {
    if (selection instanceof CellSelection) return false
    const cellAt = position => {
      for (let depth = position.depth; depth > 0; depth -= 1) {
        if (['tableCell', 'tableHeader'].includes(position.node(depth).type.name)) return position.before(depth)
      }
      return null
    }
    if (cellAt(selection.$from) !== cellAt(selection.$to)) return false
    let table = false
    this.getEditor().state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
      if (node.type.name === 'table' && pos >= selection.from && pos + node.nodeSize <= selection.to) table = true
    })
    return !table
  }

  aiChatInsertionPoint(selection, outsideTable) {
    const end = selection instanceof CellSelection ? selection.$headCell : selection.$to
    if (outsideTable || selection instanceof CellSelection) {
      for (let depth = 1; depth <= end.depth; depth += 1) {
        if (end.node(depth).type.name === 'table') return { pos: end.after(depth), block: true }
      }
    }
    return { pos: selection.to, block: !selection.$to.parent.isTextblock }
  }

  selectionAIContext() {
    const reference = this._aiSelectionReference
    if (!reference) return { scope: 'none', from: 0, to: 0, source: '', text: '', summary: '无上下文' }
    const selection = reference.bookmark.resolve(this.getEditor().state.doc)
    return { scope: 'selection', kind: reference.kind, from: selection.from, to: selection.to, source: reference.text,
      text: reference.text.slice(0, 4000), summary: this.state.aiContextSummary, truncated: reference.text.length > 4000, budgetExceeded: reference.text.length > 4000,
      ...(reference.kind === 'table' ? { ranges: reference.cells.map(cell => ({ from: cell.pos, to: cell.pos + cell.node.nodeSize })), ...(reference.text.length <= 4000 ? { content: reference.slice.toJSON() } : {}) } : {}) }
  }

  removeAIReference(error = '') {
    this.stopAI()
    this._aiSelectionReference = null
    this._aiLastChat = null
    this._aiAnchor = null
    this._aiContext = null
    this.state.aiReference = null
    this.state.aiPreview = ''
    this.state.aiContextSummary = '无上下文'
    this.state.aiError = error
    this.state.aiStatus = ''
  }

  imageAIValid(image = this.state.aiImage) {
    if (!image) return false
    let node
    try { node = this.getEditor()?.state.doc.nodeAt(image.pos) } catch (_) { return false }
    return node?.type.name === 'image' && node.attrs.blockId === image.blockId
      && node.attrs.src === image.src
      && JSON.stringify(normalizeImageCrop(node.attrs.crop)) === JSON.stringify(normalizeImageCrop(image.crop))
  }

  openImageAI(image) {
    if (this._disposed || !this.featureEnabled('ai') || !this.featureEnabled('images') || !this.writable() || !this.imageAIValid(image)) return false
    if (!aiNetworkAllows(image.src, createNetworkPolicy(this.state.editorConfig.network), this.getWindow().location?.href, true)) return false
    this.closeAI(false)
    this.state.aiOpen = true
    this.state.aiImageChat = true
    this.state.aiImage = { pos: image.pos, blockId: image.blockId, src: image.src, crop: normalizeImageCrop(image.crop), alt: image.alt || '' }
    this._aiImageScope = this.createAIChatScope()
    this.state.aiPrompt = ''
    this.state.aiPreview = ''
    this.state.aiMessages = []
    this.state.aiError = ''
    this.state.aiStatus = ''
    this._aiAnchor = null
    this.host.focusImageAI?.()
    return true
  }

  syncImageAI() {
    if (this.state.aiSelectionChat) {
      if (!this.aiChatScopeValid(this._aiChatScope)) this.closeAI(false)
      else if (!this.selectionAIReferenceValid()) this.removeAIReference('引用的内容已改变，请重新选择后提问。')
      return
    }
    if (!this.state.aiImageChat || !this._aiImageScope) return
    const scope = this._aiImageScope
    if (!this.aiChatScopeValid(scope) || !this.featureEnabled('images')) this.closeAI(false)
  }

  removeAIImage() {
    this.stopAI()
    this.state.aiImage = null
    this.state.aiError = ''
    this.state.aiStatus = ''
    this._aiLastChat = null
  }

  async prepareAIImage(image, signal) {
    if (!this.imageAIValid(image) || !aiNetworkAllows(image.src, createNetworkPolicy(this.state.editorConfig.network), this.getWindow().location?.href, true)) throw new Error('无法读取引用的图片')
    const viewWindow = this.getWindow()
    const response = await (viewWindow.fetch || fetch)(image.src, { signal, credentials: 'same-origin', redirect: 'error' })
    if (!response.ok) throw new Error('读取图片失败，请重试')
    let blob = await response.blob()
    if (blob.size > 20 * 1024 * 1024) throw new Error('图片超过 20 MB，请使用较小的图片')
    // Encode the visible crop only. Never send originalSrc or hidden pixels to an AI provider.
    blob = await cropImageBlob(blob, image.crop || FULL_IMAGE_CROP)
    if (blob.size > 20 * 1024 * 1024) throw new Error('图片超过 20 MB，请使用较小的图片')
    if (signal.aborted) throw new Error('已停止')
    const url = await new Promise((resolve, reject) => {
      const reader = new (viewWindow.FileReader || FileReader)()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => reject(new Error('读取图片失败，请重试'))
      reader.readAsDataURL(blob)
    })
    return { url, blockId: image.blockId, alt: image.alt }
  }

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
    if ((this.state.aiImageChat || this.state.aiSelectionChat) && !options.context) this.closeAI(false)
    this.stopAI()
    const allowed = AI_ACTIONS.some(item => item.value === action)
    const previewAction = action === 'chat' ? 'chat' : (allowed ? action : 'rewrite')
    if (previewAction !== 'chat') this.state.aiAction = previewAction
    this._aiPreviewAction = previewAction
    const context = options.context || this.currentAIContext()
    this._aiContext = context
    this.state.aiBudgetExceeded = Boolean(context.budgetExceeded)
    this.state.aiGeneratedAction = previewAction
    this.state.aiContextSummary = context.summary
    this._aiAnchor = context.kind === 'table' ? null : { from: context.from, to: context.to, source: context.source, valid: true }
    this.state.aiOpen = true
    this.state.aiRunning = true
    this.state.aiPreview = ''
    this.state.aiError = ''
    this.state.aiStatus = '准备生成…'
    this.state.aiReviewIssues = []
    this.state.aiProposal = null
    const generation = this._aiGeneration
    let settled = false
    const chatScope = options.chatScope
    const reference = this._aiSelectionReference
    const current = () => {
      if (settled || this._disposed || generation !== this._aiGeneration) return false
      if (chatScope && !this.aiChatScopeValid(chatScope)) { this.closeAI(false); return false }
      if (chatScope && reference && !this.selectionAIReferenceValid(reference)) { this.removeAIReference('引用的内容已改变，请重新选择后提问。'); return false }
      return true
    }
    const callbacks = {
      onStart: () => { if (current()) this.state.aiStatus = '生成中…' },
      onChunk: chunk => { if (current()) { this.state.aiPreview += chunk; this.state.aiStatus = '生成中…' } },
      onDone: () => {
        if (!current()) return
        settled = true
        this.state.aiRunning = false
        this.state.aiStatus = '已完成，等待确认'
        if (this._aiPreviewAction === 'proofread') this.state.aiReviewIssues = createReviewResult(context.text).issues
        if (this._aiPreviewAction === 'outline') this.state.aiProposal = createToolProposal(context, this._aiAnchor)
        if (this._aiPreviewAction === 'chat' && options.appendMessage) this.state.aiMessages.push({ id: `ai-${Date.now()}`, role: 'assistant', text: this.state.aiPreview })
      },
      onCancelled: () => { if (current()) { settled = true; this.state.aiRunning = false; this.state.aiStatus = '已停止' } },
      onError: error => { if (current()) { settled = true; this.state.aiRunning = false; this.state.aiError = error?.message || 'AI 生成失败'; this.state.aiStatus = '失败' } },
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
          ...(options.images?.length ? { images: options.images } : {}),
          ...callbacks,
        })
        const stream = typeof handle === 'function' ? { cancel: handle } : (handle || { cancel() {} })
        // Provider errors are displayed by onError; consume the optional completion promise.
        stream.done?.catch?.(() => {})
        if (this._disposed || generation !== this._aiGeneration || !this.state.aiOpen) stream.cancel?.()
        else this._aiStream = stream
      } catch (error) { callbacks.onError(error) }
    } else if (options.requireProvider) {
      callbacks.onError(new Error('请先配置 AI 服务。'))
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

  async sendAIChat(options = {}) {
    const prompt = this.state.aiPrompt.trim()
    if (!prompt || this.state.aiRunning || !this.writable() || !this.featureEnabled('ai')) return
    if (this.state.aiImageChat) {
      this.syncImageAI()
      if (!this.state.aiOpen) return
      const adapter = this.getAIChatAdapter()
      if (!adapter || (this.state.aiImage && !adapter.supportsImages)) {
        this.state.aiError = this.state.aiImage ? '请配置支持图片的 AI 服务后发送。' : '请先配置 AI 服务。'
        return
      }
      const image = this.state.aiImage
      if (image && !this.imageAIValid(image)) { this.removeAIImage(); this.state.aiError = '引用的图片已改变，请重新添加图片。'; return }
      this.stopAI()
      const generation = this._aiGeneration
      const abort = this._aiImageAbort = new AbortController()
      this.state.aiRunning = true
      this.state.aiError = ''
      this.state.aiStatus = image ? '正在准备图片…' : '准备生成…'
      try {
        const images = image ? [await this.prepareAIImage(image, abort.signal)] : []
        this.syncImageAI()
        if (this._disposed || generation !== this._aiGeneration || !this.state.aiOpen || (image && !this.imageAIValid())) {
          if (generation === this._aiGeneration) this.stopAI()
          return
        }
        this._aiImageAbort = null
        if (!options.retry) this.state.aiMessages.push({ id: `user-${Date.now()}`, role: 'user', text: image ? `[图片]\n${prompt}` : prompt })
        this._aiLastChat = { prompt }
        this.startAI('chat', { prompt, appendMessage: true, images, requireProvider: true, chatScope: this._aiImageScope, context: { scope: 'image', from: 0, to: 0, source: '', text: '', summary: image ? '引用的图片' : '无上下文' } })
        this.state.aiPrompt = ''
      } catch (error) {
        if (generation === this._aiGeneration && !this._disposed) { this.state.aiRunning = false; this.state.aiError = error.message || '图片准备失败'; this.state.aiStatus = '失败' }
      }
      return
    }
    if (this.state.aiSelectionChat) {
      const reference = this._aiSelectionReference
      this.syncImageAI()
      if (!this.state.aiOpen || !this.aiChatScopeValid(this._aiChatScope)) return
      if (reference && reference !== this._aiSelectionReference) return
      if (!this.getAIChatAdapter()) { this.state.aiError = '请先配置当前网络策略允许的 AI 服务。'; return }
      if (!this.selectionAIReferenceValid()) { this.removeAIReference('引用的内容已改变，请重新选择后提问。'); return }
      const context = this.selectionAIContext()
      if (!options.retry) this.state.aiMessages.push({ id: `user-${Date.now()}`, role: 'user', text: prompt })
      this._aiLastChat = { prompt }
      this.startAI('chat', { prompt, appendMessage: true, requireProvider: true, chatScope: this._aiChatScope, context })
      this.state.aiPrompt = ''
      return
    }
    this.state.aiMessages.push({ id: `user-${Date.now()}`, role: 'user', text: prompt })
    this.startAI('chat', { prompt, appendMessage: true })
    this.state.aiPrompt = ''
  }

  regenerateAI() {
    if (this.state.aiRunning) return
    if (this.state.aiImageChat || this.state.aiSelectionChat) {
      if (!this._aiLastChat) return
      this.state.aiPrompt = this._aiLastChat.prompt
      if (this.state.aiMessages[this.state.aiMessages.length - 1]?.role === 'assistant') this.state.aiMessages.pop()
      return this.sendAIChat({ retry: true })
    }
    this.startAI(this.state.aiAction, { prompt: this.state.aiPrompt })
  }

  stopAI() {
    this._aiGeneration += 1
    this._aiImageAbort?.abort()
    this._aiImageAbort = null
    if (this._aiStream && typeof this._aiStream.cancel === 'function') {
      try { this._aiStream.cancel() } catch (error) { /* 宿主流已关闭时忽略 */ }
    }
    this._aiStream = null
    this.state.aiRunning = false
    if (this.state.aiOpen && !this.state.aiStatus.includes('完成')) this.state.aiStatus = '已停止'
  }

  closeAI(focus = true) {
    this.stopAI()
    this.state.aiChatEpoch = Number(this.state.aiChatEpoch || 0) + 1
    if (this.state.aiImageChat || this.state.aiSelectionChat) {
      this.state.aiMessages = []
      this.state.aiPrompt = ''
      this.state.aiPreview = ''
      this.state.aiError = ''
    }
    this.state.aiOpen = false
    this.state.aiImageChat = false
    this.state.aiImage = null
    this.state.aiSelectionChat = false
    this.state.aiReference = null
    this._aiSelectionReference = null
    this._aiChatScope = null
    this._aiLastChat = null
    this._aiImageScope = null
    this._aiAnchor = null
    this._aiPreviewAction = null
    this._aiContext = null
    this.state.aiBudgetExceeded = false
    this.state.aiGeneratedAction = null
    this.state.aiReviewIssues = []
    this.state.aiProposal = null
    this.state.aiStatus = ''
    if (!this._disposed && focus) this.focus()
  }

  async copyAIPreview() {
    if (!this.state.aiPreview) return
    const generation = this._aiGeneration, scope = this._aiChatScope || this._aiImageScope
    const current = () => !this._disposed && generation === this._aiGeneration && (!scope || this.aiChatScopeValid(scope))
    if (!current()) { if (scope) this.closeAI(false); return }
    try {
      const clipboard = this.getNavigator().clipboard
      if (clipboard?.writeText) await clipboard.writeText(this.state.aiPreview)
      else throw new Error('clipboard unavailable')
      if (current()) this.state.notice = 'AI 结果已复制'
    } catch (_) { if (current()) this.state.aiError = '无法访问剪贴板，请手动选择复制' }
  }

  acceptAI(mode = 'replace') {
    if (this.state.aiImageChat) return
    if (this.state.aiSelectionChat) {
      this.syncImageAI()
      if (!this.state.aiOpen || !this.aiChatScopeValid(this._aiChatScope) || this.state.aiRunning || !this.state.aiPreview || !this.selectionAIReferenceValid()) return false
      const editor = this.getEditor(), reference = this._aiSelectionReference
      const selection = reference?.bookmark.resolve(editor.state.doc)
      if (mode !== 'insert' && (!reference?.replaceable || !this.aiSelectionReplaceable(selection) || this.state.aiBudgetExceeded)) { this.state.aiError = '当前回复可插入正文；替换需要有效且不跨单元格的文字选区。'; return false }
      let applied
      if (mode === 'insert' || !selection) {
        const target = this.aiChatInsertionPoint(selection || editor.state.selection, !reference?.replaceable)
        if (target.block && this.state.aiContentFormat === 'text' && !looksLikeMarkdown(this.state.aiPreview)) {
          applied = editor.chain().focus().insertContentAt(target.pos, { type: 'paragraph', content: [{ type: 'text', text: this.state.aiPreview }] }).run()
        } else applied = this.insertAIResult(editor, target.pos, target.pos)
      } else {
        applied = this.insertAIResult(editor, selection.from, selection.to)
      }
      if (applied === false) { this.state.aiError = '回复未写入，请检查正文长度限制或编辑权限。'; return false }
      this.closeAI()
      return true
    }
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
    const fallback = () => {
      const before = editor.state.doc
      editor.view.dispatch(editor.state.tr.insertText(this.state.aiPreview, from, to).scrollIntoView())
      return editor.state.doc !== before
    }
    const format = this.state.aiContentFormat || 'auto'
    if (format !== 'html' && format !== 'markdown' && !looksLikeMarkdown(this.state.aiPreview)) return fallback()
    const html = previewToHtml(this.state.aiPreview, format)
    if (!html) return fallback()
    const inline = singleParagraphInner(html)
    try {
      return editor.chain().focus().insertContentAt({ from, to }, inline === null ? html : inline, { updateSelection: true }).scrollIntoView().run()
    } catch (error) { return fallback() }
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
    this.closeAI(false)
    void this.saveNow()
    clearTimeout(this._saveTimer)
    if (this.host.removeBeforeUnload) this.host.removeBeforeUnload(this.flushOnLeave)
    if (this.host.unbindAITransaction) this.host.unbindAITransaction(this.mapAI)
    if (!this.props.session) void this.getSession()?.dispose()
  }
}
