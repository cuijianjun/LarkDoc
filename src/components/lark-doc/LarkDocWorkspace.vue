<template>
  <lark-doc-editor
    ref="document"
    v-model="html"
    :title.sync="title"
    :config="editorConfig"
    :templates="templateItems"
    :session="getSession()"
    :readonly="readonly || forcedReadonly"
    :content-format="contentFormat"
    :fold-persist-key="String(documentId || 'local')"
    :upload-image="uploadImage"
    :on-embed-title="onEmbedTitle"
    :on-embed-save="onEmbedSave"
    :on-embed-card-action="onEmbedCardAction"
    :embed-providers="embedProviders"
    :on-bookmark-open="onBookmarkOpen"
    :unfurl-provider="unfurlProvider"
    :embed-sandbox="embedSandbox"
    :embed-allow="embedAllow"
    @change="onChange"
    @import-report="onImportReport"
    @ready="onReady"
    @mode-change="effectiveReadonly = $event.readonly"
    @ai-request="startAI"
  >
    <!-- 阶段 5 批次 5G：工作台操作区与侧栏由 src/ui/workspace.js 原生渲染。 -->
    <template #header-actions>
      <div ref="workspaceHeaderHost" />
    </template>
    <template #side-panel>
      <div ref="workspacePanelHost" />
    </template>
  </lark-doc-editor>
</template>

<script>
import LarkDocEditor from './LarkDocEditor.vue'
import { DOMParser as ProseMirrorDOMParser } from '@tiptap/pm/model'
import { createPersistenceWorkspace, detectBrowserStorage } from '../../providers/persistence'
import { AI_ACTIONS, streamMock, createContextSnapshot, createReviewResult, createToolProposal, mapAnchor, anchorValid } from './mockAI'
import { normalizeAIProvider, previewToHtml, singleParagraphInner, looksLikeMarkdown } from './ai'
import { TEMPLATES } from './templates'
import { createLarkDocConfig, resolveExportOptions, isImportEnabled, isExportEnabled, resolveImportAccept, resolveImportFormatId, isAutoSaveEnabled, resolveAutoSaveDelay, resolveMediaOptions } from './larkDocConfig'
import { applyMediaHtmlMode } from '../../core/media/htmlMode'
import { sanitizeHTML, validateDocument } from './documentOperations'
import { migrateRecordContent } from '../../core/migrations'
import { createDerivedSnapshot, validateDerivedSnapshot } from '../../core/derive/snapshot'
import { DOCUMENT_SCHEMA_VERSION } from '../../core/documentSchema'
import { logger } from '../../utils/logger'
import { loadFeature } from '../../core/features/registry'
import { createWorkspaceState, createWorkspaceController } from '../../workspace/WorkspaceController'
import { createWorkspace } from '../../ui/workspace'

/**
 * 让浏览器先把「目录已经挂上」画出来一帧，再进 `setContent` 的长任务（2,000 块几十秒）。
 * 不加这一帧的话，Vue 的 DOM 更新和 ProseMirror 建 DOM 排在同一条长任务里，
 * 水合出来的目录根本不会被看到 —— 那就白算了。
 * 无 rAF 的环境（SSR / 单测）直接放行，不阻塞。
 */
const nextPaintFrame = () => (typeof requestAnimationFrame === 'function'
  ? new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  : Promise.resolve())

export default {
  name: 'LarkDocWorkspace',
  components: { LarkDocEditor },
  props: {
    // The route keeps the local Demo defaults, while hosts may reuse this
    // shell with the same editor strategy and their own data sources.
    config: { type: Object, default: () => ({}) },
    templates: { type: Array, default: null },
    persistence: { type: Object, default: null },
    // 保存时是否在 record 里附带 html 字段（默认 false，仅存 json）。
    saveHtml: { type: Boolean, default: false },
    session: { type: Object, default: null },
    documentId: { type: [String, Number], default: null },
    user: { type: Object, default: null },
    capabilities: { type: Object, default: null },
    // 命令式入口（new LarkDoc）通过这两个可选属性注入初始文档。
    initialTitle: { type: String, default: null },
    initialContent: { type: [String, Object], default: null },
    // 'auto' 按指纹识别 Vditor HTML；'vditor' 强制归一化；'html' 明确跳过归一化。
    contentFormat: { type: String, default: 'auto' },
    readonly: { type: Boolean, default: false },
    // 宿主侧能力注入：图片上传钩子与 AI 流式生成钩子。
    uploadImage: { type: Function, default: null },
    // 字符串地址 / { endpoint } / { protocol:'openai', baseURL } / { stream(args) } 都接受，
    // 统一在 aiAdapter 里收敛；识别不出来就回退本地 Mock。
    aiProvider: { type: [Object, String, Function], default: null },
    // P3-07：内嵌内容（iframe 桥 / 卡片动作 / URL 卡抓取）的宿主回调。
    // 本层只做透传，不认识 `lark-embed/1` 协议；判定全在 LarkDoc 门面与扩展装配里。
    onEmbedTitle: { type: Function, default: null },
    onEmbedSave: { type: Function, default: null },
    onEmbedCardAction: { type: Function, default: null },
    embedProviders: { type: Array, default: null },
    onBookmarkOpen: { type: Function, default: null },
    unfurlProvider: { type: Function, default: null },
    // iframe 的 sandbox / allow 覆盖（默认走安全基线；桥要真 origin 时宿主显式放开）。
    embedSandbox: { type: String, default: null },
    embedAllow: { type: String, default: null },
  },
  data() {
    return createWorkspaceState(this)
  },
  computed: {
    templateOptions() {
      return [{ value: '', label: '模板' }].concat(
        this.templateItems.map((item) => ({ value: item.id, label: item.label })),
      )
    },
    filteredTemplates() {
      const query = String(this.templateQuery || '').trim().toLocaleLowerCase()
      if (!query) return this.templateItems
      return this.templateItems.filter((item) => `${item.label} ${item.title} ${item.id}`.toLocaleLowerCase().includes(query))
    },
    aiReplaceDisabled() { return Boolean(this.aiBudgetExceeded && this.aiGeneratedAction !== 'title') },
    // 归一化后的 AI 适配器：{kind, protocol, contentFormat, stream(args)} 或 null。
    // computed 缓存住实例，避免每次生成都重建（auto 协议要跨帧保留判定状态）。
    aiAdapter() { return normalizeAIProvider(this.aiProvider) },
    // 预览区渲染：宿主声明了 markdown/html 或内容本身带 md 语法时按富文本显示，
    // 否则维持原来的纯文本 <pre>，避免把普通文本的换行和空格吃掉。
    aiPreviewHtml() {
      if (!this.aiPreview) return ''
      const format = this.aiContentFormat || 'auto'
      if (format === 'text') return ''
      if (format === 'auto' && !looksLikeMarkdown(this.aiPreview)) return ''
      return previewToHtml(this.aiPreview, format)
    },
  },
  watch: {
    title() { this.queueSave() },
    editorConfig: { deep: true, handler() { this.refreshWorkspaceUI() } },
    effectiveReadonly() { this.refreshWorkspaceUI() },
    importing() { this.refreshWorkspaceUI() },
    saveStatus() { this.refreshWorkspaceUI() },
    storageError() { this.refreshWorkspaceUI() },
    notice() { this.refreshWorkspaceUI() },
    historyOpen() { this.refreshWorkspaceUI() },
    snapshots: { deep: true, handler() { this.refreshWorkspaceUI() } },
    templateOpen() { this.refreshWorkspaceUI() },
    templateQuery() { this.refreshWorkspaceUI() },
    aiOpen() { this.refreshWorkspaceUI() },
    aiRunning() { this.refreshWorkspaceUI() },
    aiPreview() { this.refreshWorkspaceUI() },
    aiError() { this.refreshWorkspaceUI() },
    aiStatus() { this.refreshWorkspaceUI() },
    aiReviewIssues: { deep: true, handler() { this.refreshWorkspaceUI() } },
    aiProposal: { deep: true, handler() { this.refreshWorkspaceUI() } },
    aiContextScope() { this.refreshWorkspaceUI() },
    aiAction() { this.refreshWorkspaceUI() },
    aiLanguage() { this.refreshWorkspaceUI() },
    aiPrompt() { this.refreshWorkspaceUI() },
    aiMessages: { deep: true, handler() { this.refreshWorkspaceUI() } },
    config: { deep: true, handler(value) { this.editorConfig = createLarkDocConfig(value) } },
    templates(value) { this.templateItems = Array.isArray(value) ? value : TEMPLATES },
    // user 只在 created() 进 session 一次；Web Component 的 user 属性热更
    // （patchProps 写 prop）后，session 侧的引用也要跟上，鉴权/协作才用新用户。
    user(value) {
      if (this.sessionInstance && this.sessionInstance.user !== value) this.sessionInstance.user = value
    },
  },
  created() {
    this._controller = createWorkspaceController({
      state: this,
      props: this,
      host: {
        getEditor: () => this.getEditor(),
        getHTML: () => this.$refs.document ? this.$refs.document.getHTML() : '',
        getJSON: () => this.$refs.document ? this.$refs.document.getJSON() : null,
        getText: () => this.$refs.document ? this.$refs.document.getText() : '',
        setContent: (content, options) => this.$refs.document ? this.$refs.document.setContent(content, options) : false,
        focus: () => { if (this.$refs.document) this.$refs.document.focus() },
        writable: () => { const editor = this.$refs.document && this.$refs.document.getEditor(); return editor && editor.isEditable && !this.importing },
        emit: (event, payload) => this.$emit(event, payload),
        confirm: message => window.confirm(message),
        getWindow: () => window,
        getNavigator: () => navigator,
        getAIProvider: () => this.aiProvider,
        hydrateOutline: outline => this.$refs.document.hydrateOutline(outline),
        bindAITransaction: handler => this.getEditor().on('transaction', handler),
        unbindAITransaction: handler => this.getEditor().off('transaction', handler),
        addBeforeUnload: handler => window.addEventListener('beforeunload', handler),
        removeBeforeUnload: handler => window.removeEventListener('beforeunload', handler),
        nextTick: callback => this.$nextTick().then(callback),
        documentApi: this,
      },
    })
    this.sessionInstance = this._controller.initializeSession()
    ;[
      'getSession', 'onReady', 'record', 'getWorkspace', 'callWorkspace', 'queueSave', 'flushOnLeave',
      'saveNow', 'storageFailure', 'toggleHistory', 'createSnapshot', 'restoreSnapshot', 'importDocument',
      'exportDocument', 'mapAI', 'currentAIContext', 'resetAIPreview', 'startAI', 'sendAIChat',
      'regenerateAI', 'stopAI', 'closeAI', 'copyAIPreview', 'acceptAI', 'insertAIResult',
      'acceptReviewIssue', 'ignoreReviewIssue', 'applyAIProposal',
    ].forEach(name => { this[name] = this._controller[name].bind(this._controller) })
  },
  mounted() {
    this.mountWorkspaceUI()
  },
  beforeDestroy() {
    if (this._beforeUnload) {
      window.removeEventListener('beforeunload', this._beforeUnload)
      this._beforeUnload = null
    }
    this._workspaceUi?.destroy()
    this._workspaceUi = null
    this._controller?.dispose()
    this._disposed = true
  },
  methods: {
    workspaceState() {
      return {
        maxLength: this.editorConfig.limits.maxLength,
        maxLengthOptions: this.maxLengthOptions,
        persistenceEnabled: this.featureEnabled('persistence'),
        // 导入 / 导出两个入口分开配置：总闸之下各有分区开关，文案与 accept 也来自 config。
        importEnabled: isImportEnabled(this.editorConfig),
        exportEnabled: isExportEnabled(this.editorConfig),
        importAccept: resolveImportAccept(this.editorConfig),
        importLabel: this.editorConfig.importExport.importLabel,
        exportLabel: this.editorConfig.importExport.exportLabel,
        exportOptions: resolveExportOptions(this.editorConfig),
        saveStatus: this.saveStatus,
        storageError: this.storageError,
        readonly: this.effectiveReadonly,
        importing: this.importing,
        persistenceLabel: this.persistenceLabel(),
        persistenceCaveat: this.persistenceCaveat(),
        maxSnapshots: this.editorConfig.limits.maxSnapshots,
        templateOptions: this.templateOptions,
        templateOpen: this.templateOpen,
        templatesEnabled: this.featureEnabled('templates'),
        templateQuery: this.templateQuery,
        filteredTemplates: this.filteredTemplates,
        historyOpen: this.historyOpen,
        historyEnabled: this.featureEnabled('history'),
        snapshots: this.snapshots,
        aiOpen: this.aiOpen,
        aiEnabled: this.featureEnabled('ai'),
        aiActions: this.aiActions,
        aiContextOptions: this.aiContextOptions,
        aiContextScope: this.aiContextScope,
        aiContextSummary: this.aiContextSummary,
        aiRunning: this.aiRunning,
        aiAction: this.aiAction,
        aiLanguageOptions: this.aiLanguageOptions,
        aiLanguage: this.aiLanguage,
        aiPrompt: this.aiPrompt,
        aiMessages: this.aiMessages,
        aiStatus: this.aiStatus,
        aiPreview: this.aiPreview,
        aiPreviewHtml: this.aiPreviewHtml,
        aiReviewIssues: this.aiReviewIssues,
        aiProposal: this.aiProposal,
        aiError: this.aiError,
        aiReplaceDisabled: this.aiReplaceDisabled,
      }
    },
    workspaceHandlers() {
      return {
        setMaxLength: value => { this.editorConfig.limits.maxLength = value },
        save: () => this.saveNow(true),
        applyTemplate: value => this.applyTemplate(value),
        importDocument: event => this.importDocument(event),
        exportDocument: value => this.exportDocument(value),
        toggleHistory: () => this.toggleHistory(),
        closeTemplate: () => this.closeTemplatePicker(),
        setTemplateQuery: value => { this.templateQuery = value },
        chooseTemplate: id => this.chooseTemplate(id),
        closeHistory: () => { this.historyOpen = false; this.$refs.document?.focus() },
        createSnapshot: () => this.createSnapshot(),
        restoreSnapshot: id => this.restoreSnapshot(id),
        closeAI: () => this.closeAI(),
        setAIContext: value => { this.aiContextScope = value; this.resetAIPreview() },
        setAIAction: value => { this.aiAction = value },
        setAILanguage: value => { this.aiLanguage = value },
        setAIPrompt: value => { this.aiPrompt = value },
        startAI: () => this.startAI(this.aiAction),
        stopAI: () => this.stopAI(),
        sendAIChat: () => this.sendAIChat(),
        copyAIPreview: () => this.copyAIPreview(),
        acceptAI: mode => this.acceptAI(mode),
        regenerateAI: () => this.regenerateAI(),
        acceptReviewIssue: issue => this.acceptReviewIssue(issue),
        ignoreReviewIssue: id => this.ignoreReviewIssue(id),
        applyAIProposal: () => this.applyAIProposal(),
        cancelAIProposal: () => { this.aiProposal = null },
        clearNotice: () => { this.notice = '' },
      }
    },
    mountWorkspaceUI() {
      if (this._workspaceUi) return
      const headerHost = this.$refs.workspaceHeaderHost
      const panelHost = this.$refs.workspacePanelHost
      if (!headerHost || !panelHost) return
      this._workspaceUi = createWorkspace({ headerHost, panelHost, handlers: this.workspaceHandlers() })
      this.refreshWorkspaceUI()
    },
    refreshWorkspaceUI() {
      if (this._workspaceUi) this._workspaceUi.update(this.workspaceState())
    },
    featureEnabled(name) { return !this.editorConfig?.features || this.editorConfig.features[name] !== false },
    // 公式样式随包样式入口一次性引入，运行时不再动态加载任何样式资源。
    getEditor() { return this.$refs.document && this.$refs.document.getEditor() },
    getSession() { return this.sessionInstance || this.session },
    writable() { const editor = this.getEditor(); return editor && editor.isEditable && !this.importing },
    record() {
      const session = this.getSession()
      const record = session ? session.getDocumentRecord({ title: this.title }) : null
      // 本地分支必须**显式**盖版本号：`getJSON()` 吐的就是当前版本形态，缺了版本号
      // 会被载入侧当成 v1 白跑一遍迁移链，早期水合的门槛也会永远判否。
      const base = record
        ? { title: record.title, json: record.content, documentId: record.documentId, schemaVersion: record.schemaVersion, revisionId: record.revisionId, updatedAt: record.updatedAt }
        : { title: this.title, json: this.$refs.document.getJSON(), schemaVersion: DOCUMENT_SCHEMA_VERSION }
      // 可选：附带 HTML 派生副本（宿主后端需要直接渲染、不做 Tiptap 还原时开启）。
      if (this.saveHtml) base.html = this.getHTML()
      // 可选：附带目录快照（P7-03）。载入时正文还没灌进编辑器，就能先用它把目录挂上，
      // 不必等 2,000 块逐块建 DOM 跑完。只做一次纯遍历（不碰 DOM、不碰装饰集），
      // 且只占 meta 里几百字节到几十 KB —— 换 `saveProxyMs` 基线 25ms 是划得来的。
      const editor = this.getEditor()
      const doc = editor && editor.state && editor.state.doc
      if (doc) {
        const derived = createDerivedSnapshot(doc)
        if (derived) base.derived = derived
      }
      return base
    },
    persistenceLabel() {
      if (this.persistence) return '宿主'
      return this.storageKind === 'memory' ? '内存' : '本浏览器'
    },
    // 落不到盘就得说出来：否则状态栏的「已保存」会让人以为刷新之后还在。
    persistenceCaveat() {
      if (this.persistence) return ''
      return this.storageKind === 'memory' ? '（刷新即丢失，请先导出）' : ''
    },
    // —— 持久化：草稿防抖保存，失败即关闸（storageError）避免反复报错 ——
    getWorkspace() {
      if (!this._workspace) {
        // 三级降级：IndexedDB → localStorage → 内存。`storageKind` 记录实际选中
        // 的那条腿，供状态栏如实说明「是否真的落盘」。
        this._workspace = this.getSession()?.getProvider('persistence') || this.persistence ||
          createPersistenceWorkspace({ ...detectBrowserStorage(window), maxSnapshots: this.editorConfig.limits.maxSnapshots })
        this.storageKind = this._workspace.kind || ''
        if (!this.getSession()?.getProvider('persistence')) this.getSession()?.setProvider('persistence', this._workspace)
      }
      return this._workspace
    },
    callWorkspace(method, ...args) {
      const workspace = this.getWorkspace()
      if (!workspace || typeof workspace[method] !== 'function') throw new Error(`持久化适配器缺少 ${method} 方法`)
      return workspace[method](...args)
    },
    // ↓ 命令式入口面向宿主的稳定方法，全部转给内部编辑器；不要在这里放业务逻辑。
    getHTML() { return this.$refs.document ? this.$refs.document.getHTML() : '' },
    getJSON() { return this.$refs.document ? this.$refs.document.getJSON() : null },
    getText() { return this.$refs.document ? this.$refs.document.getText() : '' },
    setContent(content, options) { return this.$refs.document ? this.$refs.document.setContent(content, options) : false },
    focus() { if (this.$refs.document) this.$refs.document.focus() },
    getTitle() { return this.title },
    setTitle(value) { this.title = value == null ? '' : String(value) },
    setReadonly(value) { this.forcedReadonly = value === true },
    isReadonly() { return Boolean(this.readonly || this.forcedReadonly || this.effectiveReadonly) },
    insertContent(content) {
      const editor = this.getEditor()
      if (!editor || !this.writable()) return false
      return editor.chain().focus().insertContent(content).run()
    },
    insertText(text) { return this.insertContent(String(text == null ? '' : text)) },
    undo() { const editor = this.getEditor(); return editor ? editor.chain().focus().undo().run() : false },
    redo() { const editor = this.getEditor(); return editor ? editor.chain().focus().redo().run() : false },
    save() { return this.saveNow(true) },
    // 编辑器就绪后：绑定 Session，恢复宿主/本地草稿（持久化解析失败则降级提示）。
    async onReady() {
      this.getSession()?.attachEditor(this.getEditor())
      // 对象形式的初始内容（Tiptap JSON）在编辑器就绪后写入，字符串已通过 v-model 注入。
      if (this.initialContent && typeof this.initialContent === 'object' && !this._contentSeeded) {
        this._contentSeeded = true
        try { this.$refs.document.setContent(this.initialContent) } catch (error) { this.storageFailure(error) }
      }
      if (this.featureEnabled('persistence')) {
        try {
          const draft = await this.callWorkspace('load')
          if (this._disposed) return
          if (draft) {
            // 老草稿（v1 扁平 / 无版本号）先迁移到当前版本再校验载入（P1-04）。
            const content = validateDocument(migrateRecordContent(draft.json, draft.schemaVersion), this.getEditor().schema)
            // 早期水合（P7-03）：正文灌进去之前先把目录挂上。
            // 比对基准必须是 `content`（迁移+展平+校验之后的**扁平**文档），不能是 `draft.json`：
            // 落库 JSON 是 `getJSON()` 的聚合容器形态（标题把后续块收进 children），
            // 而快照是按编辑器里的扁平文档算的 —— 拿聚合形态去比，带标题的文档全部被判伪。
            // 版本号不另设门槛：迁移过的正文一旦结构变了，指纹自己对不上就整份作废。
            if (this.$refs.document.hydrateOutline(
              validateDerivedSnapshot(draft.derived, content)?.outline,
            )) await nextPaintFrame()
            if (this._disposed) return
            this.$refs.document.setContent(content)
            this.title = draft.title
          }
          this.saveStatus = draft ? `已恢复${this.persistenceLabel()}草稿` : (this.persistence ? '宿主适配器 · 尚未保存' : '本地示例 · 尚未保存')
        } catch (error) { this.storageFailure(error) }
      } else this.saveStatus = '本地保存已关闭'
      this.initialized = true
      this.getEditor().on('transaction', this.mapAI)
      // **必须包一层**：直接把方法引用交给 addEventListener，回调里的 this 是 window，
      // `flushOnLeave()` 里的 `this.saveNow` 就成了 undefined —— 离页落盘一次都不执行，
      // 控制台还会甩一条 `this.saveNow is not a function`（自动保存看起来「偶发丢最后一段」）。
      this._beforeUnload = () => this.flushOnLeave()
      window.addEventListener('beforeunload', this._beforeUnload)
      logger.info('lifecycle', 'lark-doc.workspace.ready', { status: this.persistence ? 'host' : 'local' })
      this.$emit('ready', { editor: this.getEditor(), document: this })
    },
    onChange(value) {
      this.html = value.html
      this.queueSave()
      this.$emit('change', value)
      this.$emit('update', value)
    },
    // 旧数据（Vditor）转换结果：宿主可据此判断是否补传图片或改造结构。
    onImportReport(report) {
      this.importReport = report
      this.$emit('import-report', report)
    },
    getImportReport() { return this.importReport },
    queueSave() {
      if (!this.featureEnabled('persistence') || !this.initialized || this.storageError || this._disposed) return
      clearTimeout(this._saveTimer)
      // 自动保存可关（config.autosave.enabled:false）：关掉后正文改动不再排队落盘，
      // 但保存按钮 / save() 走的 saveNow(true) 不受影响。
      if (!isAutoSaveEnabled(this.editorConfig)) {
        this.saveStatus = '自动保存已关闭'
        return
      }
      this.saveStatus = '等待本地保存…'
      this._saveTimer = setTimeout(() => { void this.saveNow() }, resolveAutoSaveDelay(this.editorConfig))
    },
    flushOnLeave() { void this.saveNow() },
    async saveNow(manual = false) {
      if (!this.featureEnabled('persistence')) return
      clearTimeout(this._saveTimer)
      if (!this.initialized || !this.$refs.document || (!manual && this.storageError)) return
      const generation = (this._saveGeneration || 0) + 1
      this._saveGeneration = generation
      try {
        await this.callWorkspace('save', this.record())
        if (generation !== this._saveGeneration || this._disposed) return
        // 「已保存」只在 Promise 落定后出现：IndexedDB 腿要等事务 oncomplete 才 resolve，
        // 所以这里看到的成功一定已经落盘，不存在「先报成功、后写失败」的窗口。
        this.storageError = false
        this.storageKind = this._workspace?.kind || this.storageKind
        this.saveStatus = `已保存到${this.persistenceLabel()}${this.persistenceCaveat()} ${new Date().toLocaleTimeString()}`
        logger.info('storage', 'lark-doc.draft.saved', { status: this.persistence ? 'host' : 'local', kind: this.storageKind })
        this.$emit('save', { status: 'saved', manual, target: this.persistenceLabel(), kind: this.storageKind, savedAt: Date.now() })
      } catch (error) { if (generation === this._saveGeneration && !this._disposed) this.storageFailure(error) }
    },
    storageFailure(error) {
      this.storageError = true
      this.saveStatus = error.message || '本地存储不可用，请导出当前文档'
      logger.warn('storage', 'lark-doc.storage.failed', { status: 'failed' })
      this.$emit('save', { status: 'failed', message: this.saveStatus })
      this.$emit('error', error)
    },
    // —— 文档操作：模板、本地快照、导入导出；所有入口写入前都做可写与开关校验 ——
    applyTemplate(id) {
      if (!this.featureEnabled('templates') || !id || !this.writable()) return false
      const template = this.templateItems.find(item => item.id === id)
      if (!template || !window.confirm('替换当前正文？可用撤销恢复正文；建议先保存快照。')) return false
      this.closeAI()
      this.$refs.document.setContent(template.html)
      this.title = template.title
      this.queueSave()
      return true
    },
    openTemplatePicker() {
      if (!this.featureEnabled('templates') || !this.writable()) return
      this.historyOpen = false
      this.aiOpen = false
      this.templateQuery = ''
      this.templateOpen = true
      this.$nextTick(() => this._workspaceUi?.focusTemplateSearch())
    },
    closeTemplatePicker() {
      this.templateOpen = false
      this.templateQuery = ''
      this.$nextTick(() => this.$refs.document?.focus())
    },
    chooseTemplate(id) {
      if (this.applyTemplate(id)) this.closeTemplatePicker()
    },
    async toggleHistory() {
      if (!this.featureEnabled('history')) return
      this.historyOpen = !this.historyOpen
      if (!this.historyOpen) return
      try { this.snapshots = await this.callWorkspace('snapshots') } catch (error) { this.storageFailure(error) }
    },
    async createSnapshot() {
      if (!this.featureEnabled('history') || !this.writable()) return
      try {
        await this.callWorkspace('snapshot', this.record())
        this.snapshots = await this.callWorkspace('snapshots')
        this.notice = `快照已保存到${this.persistenceLabel()}`
        logger.info('storage', 'lark-doc.snapshot.created', { itemCount: this.snapshots.length })
      } catch (error) { this.storageFailure(error) }
    },
    async restoreSnapshot(id) {
      if (!this.featureEnabled('history') || !this.writable()) return
      try {
        const entry = await this.callWorkspace('restore', id)
        const json = validateDocument(migrateRecordContent(entry.json, entry.schemaVersion), this.getEditor().schema)
        if (!window.confirm('恢复此快照并替换当前正文？恢复后可撤销正文。')) return
        // 与 onReady 同一套早期水合：恢复一份大文档同样要等 setContent 建 DOM。
        // 比对基准同样是展平后的 `json`，不是落库的聚合容器形态（理由见 onReady）。
        if (this.$refs.document.hydrateOutline(
          validateDerivedSnapshot(entry.derived, json)?.outline,
        )) await nextPaintFrame()
        if (this._disposed) return
        this.closeAI()
        this.$refs.document.setContent(json)
        this.title = entry.title
        this.notice = '已恢复快照，可撤销正文'
      } catch (error) { this.notice = error.message }
    },
    async importDocument(event) {
      if (!isImportEnabled(this.editorConfig)) return
      const file = event.target.files && event.target.files[0]
      event.target.value = ''
      if (!file || !this.writable()) return
      if (file.size > 10 * 1024 * 1024) { this.notice = '导入文件不能超过 10 MB'; return }
      // 格式白名单由 config.importExport.importFormats 决定：不在清单里的扩展名
      // 连解析器都不进，直接按「不支持」拒绝（提示文案也从清单生成）。
      const format = resolveImportFormatId(this.editorConfig, file.name.split('.').pop())
      if (!format) {
        const allowed = this.editorConfig.importExport.importFormats.join(' / ').toUpperCase()
        this.notice = `不支持的文件格式，可导入：${allowed}`
        return
      }
      this.importing = true
      try {
        let content
        let importedTitle
        if (format === 'docx') {
          // 阶段 4：mammoth 走特性注册表 —— lite 构建下 alias 到 stub → reject →
          // 下方 catch 给「导入失败，原正文未替换」；宿主加载 features/office.js 后恢复。
          const mammoth = await loadFeature('office.mammoth', () =>
            import(/* webpackChunkName: "office" */ 'mammoth/mammoth.browser'))
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
            const { markdownToHtml } = await import(/* webpackChunkName: "import-export" */ '../../utils/importExport')
            content = sanitizeHTML(await markdownToHtml(text))
          }
          else throw new Error('只支持 HTML / JSON / Markdown / DOCX')
        }
        if (this._disposed || !this.getEditor().isEditable) return
        if (typeof content === 'string') {
          const container = document.createElement('div')
          container.innerHTML = content
          const parsed = ProseMirrorDOMParser.fromSchema(this.getEditor().schema).parse(container)
          content = validateDocument(parsed.toJSON(), this.getEditor().schema)
          let hasContent = false
          parsed.descendants(node => { if (node.isText ? node.text.trim() : !node.isTextblock && node.type.name !== 'hardBreak') hasContent = true })
          if (!hasContent) throw new Error('文件未包含可导入的正文或内容块')
        }
        if (!window.confirm('导入并替换当前正文？原正文可通过撤销恢复。')) return
        this.closeAI()
        this.$refs.document.setContent(content)
        if (importedTitle !== undefined) this.title = importedTitle
        this.notice = format === 'docx' || format === 'md' ? '导入完成；复杂布局按正文格式降级，请检查内容' : '导入完成'
        logger.info('import', 'lark-doc.document.imported', { format, status: 'success' })
      } catch (error) {
        if (!this._disposed) this.notice = `导入失败，原正文未替换：${error.message}`
        logger.warn('import', 'lark-doc.document.rejected', { status: 'failed' })
      } finally { if (!this._disposed) this.importing = false }
    },
    async exportDocument(format) {
      // 格式白名单由 config.importExport.exportFormats 决定（菜单里没有的也不许调）。
      if (!isExportEnabled(this.editorConfig) || !format) return
      if (!this.editorConfig.importExport.exportFormats.includes(format)) return
      const component = this.$refs.document
      // 导出侧按 config.media.htmlMode 决定媒体直出还是只留地址（默认 inline，与编辑器一致）。
      const exportHTML = () => applyMediaHtmlMode(component.getHTML(), resolveMediaOptions(this.editorConfig))
      try {
        const { downloadText, exportDocx, htmlToMarkdown, safeFileName } = await import(/* webpackChunkName: "import-export" */ '../../utils/importExport')
        const filename = safeFileName(this.title)
        if (format === 'html') downloadText(exportHTML(), `${filename}.html`, 'text/html;charset=utf-8')
        else if (format === 'json') downloadText(JSON.stringify({ schemaVersion: DOCUMENT_SCHEMA_VERSION, title: this.title, document: component.getJSON() }, null, 2), `${filename}.json`, 'application/json')
        else if (format === 'txt') downloadText(component.getText(), `${filename}.txt`, 'text/plain;charset=utf-8')
        else if (format === 'md') {
          downloadText(await htmlToMarkdown(exportHTML()), `${filename}.md`, 'text/markdown;charset=utf-8')
          this.notice = 'Markdown 为简化导出，字体、分栏、公式和图片裁剪布局可能降级；JSON 可保留完整正文'
        } else if (format === 'docx') {
          await exportDocx(this.title, component.getText())
          this.notice = 'Word 为纯文本段落导出，不保留复杂块、表格和媒体布局；JSON 可保留完整正文'
        } else if (format === 'print') {
          const editor = this.getEditor()
          // 折叠集合存的是标题 blockId，打印时按 id 展开、打印后按 id 折回。
          const folded = Array.from(editor.storage.larkDoc.folded)
          folded.forEach(id => editor.commands.toggleLarkDocFoldById(id))
          this.$nextTick(() => {
            window.print()
            if (!this._disposed) folded.forEach(id => editor.commands.toggleLarkDocFoldById(id))
          })
        }
      } catch (error) { this.notice = `导出失败：${error.message}` }
    },
    // —— AI 流：Mock/宿主流式生成、锚点跟随事务，接受与拒绝前校验锚点仍有效 ——
    mapAI({ transaction }) { mapAnchor(this._aiAnchor, transaction) },
    currentAIContext() {
      const editor = this.getEditor()
      return editor ? createContextSnapshot(editor, this.aiContextScope, 4000) : { scope: this.aiContextScope, from: 0, to: 0, source: '', text: '', summary: '无上下文', truncated: false, budgetExceeded: false, blockCount: 0 }
    },
    resetAIPreview() {
      if (this.aiRunning) this.stopAI()
      this.aiPreview = ''
      this.aiError = ''
      this.aiReviewIssues = []
      this.aiProposal = null
      this.aiBudgetExceeded = false
      this.aiGeneratedAction = null
      this.aiContextSummary = this.currentAIContext().summary
    },
    startAI(action = 'rewrite', options = {}) {
      if (!this.featureEnabled('ai') || !this.writable()) return
      this.stopAI()
      const allowed = AI_ACTIONS.some(item => item.value === action)
      const previewAction = action === 'chat' ? 'chat' : (allowed ? action : 'rewrite')
      if (previewAction !== 'chat') this.aiAction = previewAction
      this._aiPreviewAction = previewAction
      const context = this.currentAIContext()
      this._aiContext = context
      this.aiBudgetExceeded = Boolean(context.budgetExceeded)
      this.aiGeneratedAction = previewAction
      this.aiContextSummary = context.summary
      this._aiAnchor = { from: context.from, to: context.to, source: context.source, valid: true }
      this.aiOpen = true
      this.aiRunning = true
      this.aiPreview = ''
      this.aiError = ''
      this.aiStatus = '准备生成…'
      this.aiReviewIssues = []
      this.aiProposal = null
      const generation = this._aiGeneration
      const callbacks = {
        onStart: () => { if (generation === this._aiGeneration) this.aiStatus = '生成中…' },
        onChunk: chunk => { if (!this._disposed && generation === this._aiGeneration) { this.aiPreview += chunk; this.aiStatus = '生成中…' } },
        onDone: () => {
          if (this._disposed || generation !== this._aiGeneration) return
          this.aiRunning = false
          this.aiStatus = '已完成，等待确认'
          if (this._aiPreviewAction === 'proofread') this.aiReviewIssues = createReviewResult(context.text).issues
          if (this._aiPreviewAction === 'outline') this.aiProposal = createToolProposal(context, this._aiAnchor)
          if (this._aiPreviewAction === 'chat' && options.appendMessage) this.aiMessages.push({ id: `ai-${Date.now()}`, role: 'assistant', text: this.aiPreview })
        },
        onCancelled: () => { if (generation === this._aiGeneration) this.aiStatus = '已停止' },
        onError: error => { if (generation === this._aiGeneration) { this.aiRunning = false; this.aiError = error.message || 'AI 生成失败'; this.aiStatus = '失败' } },
      }
      // 宿主注入了 AI 接入（地址 / 协议配置 / 旧 stream 钩子）时接管生成；
      // 否则退回本地 Mock，保证 Demo 与离线可用。
      const adapter = this.aiAdapter
      this.aiContentFormat = adapter ? adapter.contentFormat : 'text'
      if (adapter) {
        try {
          const handle = adapter.stream({
            action: this._aiPreviewAction,
            text: context.text,
            prompt: options.prompt || this.aiPrompt,
            language: this.aiLanguage,
            range: { from: context.from, to: context.to, source: context.source },
            context,
            ...callbacks,
          })
          this._aiStream = typeof handle === 'function' ? { cancel: handle } : (handle || { cancel() {} })
        } catch (error) {
          callbacks.onError(error)
        }
      } else {
        this._aiStream = streamMock(this._aiPreviewAction, context.text, {
          prompt: options.prompt || this.aiPrompt,
          language: this.aiLanguage,
          delay: 16,
          ...callbacks,
        })
      }
      logger.info('ai', 'lark-doc.mock.started', { action: previewAction, status: 'local' })
    },
    sendAIChat() {
      const prompt = this.aiPrompt.trim()
      if (!prompt || this.aiRunning || !this.writable()) return
      this.aiMessages.push({ id: `user-${Date.now()}`, role: 'user', text: prompt })
      this.startAI('chat', { prompt, appendMessage: true })
      this.aiPrompt = ''
    },
    regenerateAI() { if (!this.aiRunning) this.startAI(this.aiAction, { prompt: this.aiPrompt }) },
    stopAI() {
      this._aiGeneration = (this._aiGeneration || 0) + 1
      if (this._aiStream && typeof this._aiStream.cancel === 'function') {
        try { this._aiStream.cancel() } catch (error) { /* 宿主流已关闭时忽略 */ }
      }
      this._aiStream = null
      this.aiRunning = false
      if (this.aiOpen && !this.aiStatus.includes('完成')) this.aiStatus = '已停止'
    },
    closeAI() {
      this.stopAI()
      this.aiOpen = false
      this._aiAnchor = null
      this._aiPreviewAction = null
      this._aiContext = null
      this.aiBudgetExceeded = false
      this.aiGeneratedAction = null
      this.aiReviewIssues = []
      this.aiProposal = null
      this.aiStatus = ''
      if (!this._disposed && this.$refs.document) this.$refs.document.focus()
    },
    async copyAIPreview() {
      if (!this.aiPreview) return
      try {
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(this.aiPreview)
        else throw new Error('clipboard unavailable')
        this.notice = 'AI 结果已复制'
      } catch (_) { this.aiError = '无法访问剪贴板，请手动选择复制' }
    },
    acceptAI(mode = 'replace') {
      if (!this.writable() || this.aiRunning || !this.aiPreview) return
      if (this.aiBudgetExceeded && mode !== 'insert' && this.aiGeneratedAction !== 'title') {
        this.aiError = '上下文超过预算，只能插入到光标；请缩小范围后再替换。'
        return
      }
      const editor = this.getEditor()
      if (!anchorValid(this._aiAnchor, editor.state.doc)) {
        this.aiError = '原选区已改变或失效，请重新选择并生成预览。'
        logger.info('ai', 'lark-doc.mock.rejected', { status: 'stale' })
        return
      }
      if (this._aiPreviewAction === 'title') this.title = this.aiPreview.trim()
      else {
        const { from, to } = this._aiAnchor
        const insertFrom = mode === 'insert' ? editor.state.selection.from : (this._aiPreviewAction === 'continue' ? to : from)
        const insertTo = mode === 'insert' ? editor.state.selection.from : to
        this.insertAIResult(editor, insertFrom, insertTo)
      }
      this.closeAI()
      logger.info('ai', 'lark-doc.mock.accepted', { status: 'accepted' })
    },
    // AI 结果落正文。markdown 结果渲染成真实格式（标题 / 列表 / 粗体），
    // 纯文本仍走 insertText；单段落内容按 inline 插入，避免把光标所在段落切断。
    insertAIResult(editor, from, to) {
      const fallback = () => editor.view.dispatch(editor.state.tr.insertText(this.aiPreview, from, to).scrollIntoView())
      const format = this.aiContentFormat || 'auto'
      if (format !== 'html' && format !== 'markdown' && !looksLikeMarkdown(this.aiPreview)) { fallback(); return }
      const html = previewToHtml(this.aiPreview, format)
      if (!html) { fallback(); return }
      const inline = singleParagraphInner(html)
      try {
        editor.chain().focus().insertContentAt({ from, to }, inline === null ? html : inline, { updateSelection: true }).scrollIntoView().run()
      } catch (error) {
        // 结构过于复杂导致 schema 解析失败时退回纯文本，保证内容不丢。
        fallback()
      }
    },
    acceptReviewIssue(issue) {
      if (!issue || !this.writable() || this.aiRunning || !this._aiAnchor) return
      const editor = this.getEditor()
      if (!anchorValid(this._aiAnchor, editor.state.doc)) {
        this.aiError = '原选区已改变或失效，请重新选择并生成预览。'
        return
      }
      const from = Math.min(this._aiAnchor.to, this._aiAnchor.from + Math.max(0, issue.from || 0))
      const to = Math.min(this._aiAnchor.to, this._aiAnchor.from + Math.max(issue.from || 0, issue.to || 0))
      if (to <= from) {
        this.aiError = '该审阅建议没有可替换的原文。'
        return
      }
      if (typeof issue.expected === 'string' && editor.state.doc.textBetween(from, to, '\n') !== issue.expected) {
        this.aiError = '该审阅建议对应的原文已改变，请重新生成。'
        return
      }
      editor.view.dispatch(editor.state.tr.insertText(issue.suggestion || '', from, to).scrollIntoView())
      this.aiReviewIssues = this.aiReviewIssues.filter(item => item.id !== issue.id)
      this.aiStatus = '已接受审阅建议'
    },
    ignoreReviewIssue(id) { this.aiReviewIssues = this.aiReviewIssues.filter(issue => issue.id !== id) },
    applyAIProposal() {
      if (!this.aiProposal || !this.writable()) return
      const content = this.aiProposal.operations[0]?.content
      if (!content) return
      const editor = this.getEditor()
      const target = this.aiProposal.target
      if (!anchorValid(this._aiAnchor, editor.state.doc) || !target || target.scope !== this._aiContext?.scope || target.source !== this._aiAnchor.source) {
        this.aiError = '提案对应的原文已改变或失效，请重新生成。'
        return
      }
      const position = this._aiAnchor.from
      editor.view.dispatch(editor.state.tr.insertText(content, position, position).scrollIntoView())
      this.notice = '已应用 AI 提案，可撤销'
      this.aiProposal = null
      this.aiPreview = ''
      this.aiStatus = '提案已应用'
    },
  },
}
</script>
