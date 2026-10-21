<template>
  <feishu-document-editor
    ref="document"
    v-model="html"
    :title.sync="title"
    :config="editorConfig"
    :templates="templateItems"
    :session="getSession()"
    :readonly="readonly || forcedReadonly"
    :content-format="contentFormat"
    :upload-image="uploadImage"
    @change="onChange"
    @import-report="onImportReport"
    @ready="onReady"
    @mode-change="effectiveReadonly = $event.readonly"
    @ai-request="startAI"
  >
    <template #header-actions>
      <span class="feishu-local-badge">本地 Demo</span>
      <select
        v-model.number="editorConfig.limits.maxLength"
        aria-label="字数上限"
        title="字数上限"
      >
        <option :value="0">
          不限字数
        </option>
        <option :value="200">
          200 字（ECS）
        </option>
      </select>
      <span
        class="feishu-save-status"
        :class="{ 'is-error': storageError }"
        role="status"
      >{{ saveStatus }}</span>
      <button
        v-if="featureEnabled('persistence')"
        type="button"
        :title="`保存到${persistenceLabel()}`"
        :disabled="effectiveReadonly || importing"
        @click="saveNow(true)"
      >
        保存
      </button>
      <select
        v-if="featureEnabled('templates')"
        ref="templateSelect"
        aria-label="选择文档模板"
        title="选择本地模板"
        :disabled="effectiveReadonly || importing"
        :value="''"
        @change="applyTemplate($event.target.value); $event.target.value = ''"
      >
        <option value="">
          模板
        </option>
        <option
          v-for="item in templateItems"
          :key="item.id"
          :value="item.id"
        >
          {{ item.label }}
        </option>
      </select>
      <button
        v-if="featureEnabled('importExport')"
        type="button"
        :title="importing ? '导入中' : '导入文档'"
        :disabled="effectiveReadonly || importing"
        @click="$refs.importFile.click()"
      >
        {{ importing ? '导入中…' : '导入' }}
      </button>
      <input
        v-if="featureEnabled('importExport')"
        ref="importFile"
        class="feishu-file-input"
        type="file"
        accept=".html,.htm,.json,.md,.markdown,.docx"
        aria-label="导入文档"
        @change="importDocument"
      >
      <select
        v-if="featureEnabled('importExport')"
        aria-label="导出文档格式"
        title="导出文档"
        :value="''"
        @change="exportDocument($event.target.value); $event.target.value = ''"
      >
        <option value="">
          导出
        </option>
        <option value="html">
          HTML
        </option>
        <option value="json">
          JSON（完整正文）
        </option>
        <option value="md">
          Markdown（简化）
        </option>
        <option value="txt">
          纯文本
        </option>
        <option value="docx">
          Word（简化）
        </option>
        <option value="print">
          打印 / PDF
        </option>
      </select>
      <button
        v-if="featureEnabled('history')"
        type="button"
        :aria-expanded="historyOpen ? 'true' : 'false'"
        title="本地快照"
        @click="toggleHistory"
      >
        本地快照
      </button>
    </template>
    <template #side-panel>
      <section
        v-if="templateOpen && featureEnabled('templates')"
        class="feishu-side-panel feishu-template-panel"
        role="dialog"
        aria-label="模板"
        @keydown.esc="closeTemplatePicker"
      >
        <div class="feishu-panel-heading">
          <h2>模板</h2>
          <button
            type="button"
            aria-label="关闭模板"
            @click="closeTemplatePicker"
          >
            ×
          </button>
        </div>
        <input
          ref="templateSearch"
          v-model="templateQuery"
          type="search"
          aria-label="搜索模板"
          placeholder="搜索模板"
        >
        <p v-if="!filteredTemplates.length">
          没有匹配的模板
        </p>
        <div
          v-else
          class="feishu-template-list"
          role="listbox"
          aria-label="模板列表"
        >
          <button
            v-for="item in filteredTemplates"
            :key="item.id"
            type="button"
            role="option"
            :aria-label="item.label"
            @click="chooseTemplate(item.id)"
          >
            <strong>{{ item.label }}</strong>
            <small>{{ item.title }}</small>
          </button>
        </div>
      </section>
      <section
        v-if="historyOpen && featureEnabled('history')"
        class="feishu-side-panel"
        aria-label="本地快照"
        @keydown.esc="historyOpen = false"
      >
        <div class="feishu-panel-heading">
          <h2>本地快照</h2>
          <button
            type="button"
            aria-label="关闭本地快照"
            @click="historyOpen = false; $refs.document.focus()"
          >
            ×
          </button>
        </div>
        <p>仅保存在{{ persistenceLabel() }}，最多 {{ editorConfig.limits.maxSnapshots }} 份。</p>
        <button
          type="button"
          :disabled="effectiveReadonly"
          @click="createSnapshot"
        >
          保存当前快照
        </button>
        <p v-if="!snapshots.length">
          暂无本地快照
        </p>
        <ul class="feishu-snapshot-list">
          <li
            v-for="item in snapshots"
            :key="item.id"
          >
            <span>{{ item.title || '未命名文档' }}</span>
            <small>{{ new Date(item.updatedAt).toLocaleString() }}</small>
            <button
              type="button"
              :disabled="effectiveReadonly"
              @click="restoreSnapshot(item.id)"
            >
              恢复
            </button>
          </li>
        </ul>
      </section>
      <section
        v-if="aiOpen && featureEnabled('ai')"
        class="feishu-side-panel feishu-ai-panel"
        aria-label="AI 模拟预览"
        @keydown.esc="closeAI"
      >
        <div class="feishu-panel-heading">
          <h2>AI 助手 <small>本地 Mock</small></h2>
          <button
            type="button"
            aria-label="关闭 AI 预览"
            @click="closeAI"
          >
            ×
          </button>
        </div>
        <p>单人本地工作区，不调用模型；只有明确接受、插入或替换才修改正文。</p>
        <div class="feishu-ai-context">
          <label for="feishu-ai-context">上下文范围</label>
          <select
            id="feishu-ai-context"
            v-model="aiContextScope"
            :disabled="aiRunning || effectiveReadonly"
            @change="resetAIPreview"
          >
            <option
              v-for="item in aiContextOptions"
              :key="item.value"
              :value="item.value"
            >
              {{ item.label }}
            </option>
          </select>
          <small class="feishu-ai-context-summary">{{ aiContextSummary }}</small>
        </div>
        <label for="feishu-ai-action">操作</label>
        <select
          id="feishu-ai-action"
          v-model="aiAction"
          :disabled="effectiveReadonly"
        >
          <option
            v-for="item in aiActions"
            :key="item.value"
            :value="item.value"
          >
            {{ item.label }}
          </option>
        </select>
        <label
          v-if="aiAction === 'translate'"
          for="feishu-ai-language"
        >目标语言</label>
        <select
          v-if="aiAction === 'translate'"
          id="feishu-ai-language"
          v-model="aiLanguage"
          :disabled="aiRunning || effectiveReadonly"
        >
          <option value="en">
            英语
          </option>
          <option value="zh">
            中文
          </option>
          <option value="ja">
            日语
          </option>
        </select>
        <label for="feishu-ai-prompt">给 AI 的要求（可选）</label>
        <textarea
          id="feishu-ai-prompt"
          v-model="aiPrompt"
          rows="2"
          :disabled="aiRunning || effectiveReadonly"
          placeholder="例如：请用更简洁的语气重写"
        />
        <ul
          v-if="aiMessages.length"
          class="feishu-ai-messages"
          aria-label="AI 对话记录"
        >
          <li
            v-for="(message, index) in aiMessages"
            :key="`${message.id}-${index}`"
            :class="`is-${message.role}`"
          >
            <strong>{{ message.role === 'user' ? '你' : 'AI' }}</strong>
            <span>{{ message.text }}</span>
          </li>
        </ul>
        <div class="feishu-panel-buttons">
          <button
            type="button"
            :disabled="effectiveReadonly || aiRunning"
            @click="startAI(aiAction)"
          >
            {{ aiRunning ? '重新生成' : '生成预览' }}
          </button>
          <button
            v-if="aiRunning"
            type="button"
            @click="stopAI"
          >
            停止
          </button>
          <button
            type="button"
            :disabled="effectiveReadonly || aiRunning || !aiPrompt.trim()"
            @click="sendAIChat"
          >
            发送对话
          </button>
        </div>
        <p
          v-if="aiStatus"
          class="feishu-ai-status"
          role="status"
        >{{ aiStatus }}</p>
        <pre
          class="feishu-ai-result"
          aria-live="polite"
        >{{ aiPreview || '选择正文或将光标放入段落，再生成预览。' }}</pre>
        <ul
          v-if="aiReviewIssues.length"
          class="feishu-ai-review-list"
          aria-label="AI 审阅建议"
        >
          <li
            v-for="issue in aiReviewIssues"
            :key="issue.id"
          >
            <strong>{{ issue.kind }} · {{ issue.severity }}</strong>
            <span>{{ issue.message }}</span>
            <small>建议：{{ issue.suggestion }}</small>
            <button
              type="button"
              :disabled="effectiveReadonly || aiRunning"
              @click="acceptReviewIssue(issue)"
            >
              接受建议
            </button>
            <button
              type="button"
              :disabled="aiRunning"
              @click="ignoreReviewIssue(issue.id)"
            >
              忽略
            </button>
          </li>
        </ul>
        <div
          v-if="aiProposal"
          class="feishu-ai-proposal"
          role="region"
          aria-label="AI 修改提案"
        >
          <strong>{{ aiProposal.title }}</strong>
          <p>{{ aiProposal.summary }}</p>
          <pre>{{ aiProposal.operations[0].content }}</pre>
          <div class="feishu-panel-buttons">
            <button
              type="button"
              class="feishu-primary"
              :disabled="effectiveReadonly || aiRunning"
              @click="applyAIProposal"
            >
              确认提案
            </button>
            <button
              type="button"
              :disabled="aiRunning"
              @click="aiProposal = null"
            >
              取消提案
            </button>
          </div>
        </div>
        <p
          v-if="aiError"
          class="feishu-error"
          role="alert"
        >
          {{ aiError }}
        </p>
        <div class="feishu-panel-buttons">
          <button
            type="button"
            :disabled="!aiPreview || aiRunning"
            @click="copyAIPreview"
          >
            复制
          </button>
          <button
            type="button"
            :disabled="!aiPreview || aiRunning || effectiveReadonly"
            @click="acceptAI('insert')"
          >
            插入到光标
          </button>
          <button
            type="button"
            :disabled="!aiPreview || aiRunning || effectiveReadonly || aiReplaceDisabled"
            :title="aiReplaceDisabled ? '上下文超预算时只能插入到光标' : '替换生成时的上下文范围'"
            @click="acceptAI('replace')"
          >
            替换范围
          </button>
          <button
            type="button"
            :disabled="effectiveReadonly || aiRunning"
            @click="regenerateAI"
          >
            重新生成
          </button>
          <button
            type="button"
            class="feishu-primary"
            :disabled="!aiPreview || aiRunning || effectiveReadonly || aiReplaceDisabled"
            @click="acceptAI"
          >
            接受结果
          </button>
          <button
            type="button"
            @click="closeAI"
          >
            拒绝
          </button>
        </div>
      </section>
      <div
        v-if="notice"
        class="feishu-notice"
        role="status"
      >
        <span>{{ notice }}</span>
        <button
          type="button"
          aria-label="关闭提示"
          @click="notice = ''"
        >
          ×
        </button>
      </div>
    </template>
  </feishu-document-editor>
</template>

<script>
import { DOMParser as ProseMirrorDOMParser } from '@tiptap/pm/model'
import FeishuDocumentEditor from './FeishuDocumentEditor.vue'
import { createWorkspace } from './workspace'
import { AI_ACTIONS, AI_CONTEXTS, streamMock, createContextSnapshot, createReviewResult, createToolProposal, mapAnchor, anchorValid } from './mockAI'
import { TEMPLATES } from './templates'
import { createFeishuConfig } from './feishuConfig'
import { sanitizeHTML, validateDocument } from './documentOperations'
import { logger } from '../../utils/logger'
import { createDocumentSession } from '../../session/DocumentSession'

export default {
  name: 'FeishuDocumentWorkspace',
  components: { FeishuDocumentEditor },
  props: {
    // The route keeps the local Demo defaults, while hosts may reuse this
    // shell with the same editor strategy and their own data sources.
    config: { type: Object, default: () => ({}) },
    templates: { type: Array, default: null },
    persistence: { type: Object, default: null },
    session: { type: Object, default: null },
    documentId: { type: [String, Number], default: null },
    user: { type: Object, default: null },
    capabilities: { type: Object, default: null },
    // 命令式入口（new FeishuDocument）通过这两个可选属性注入初始文档。
    initialTitle: { type: String, default: null },
    initialContent: { type: [String, Object], default: null },
    // 'auto' 按指纹识别 Vditor HTML；'vditor' 强制归一化；'html' 明确跳过归一化。
    contentFormat: { type: String, default: 'auto' },
    readonly: { type: Boolean, default: false },
    // 宿主侧能力注入：图片上传钩子与 AI 流式生成钩子。
    uploadImage: { type: Function, default: null },
    aiProvider: { type: Object, default: null },
  },
  data() {
    const templateItems = Array.isArray(this.templates) ? this.templates : TEMPLATES
    const firstTemplate = templateItems[0] || { html: '<p></p>', title: '未命名文档' }
    return {
      html: typeof this.initialContent === 'string' ? this.initialContent : firstTemplate.html,
      title: this.initialTitle != null ? this.initialTitle : firstTemplate.title,
      templateItems,
      forcedReadonly: false,
      editorConfig: createFeishuConfig(this.config),
      effectiveReadonly: false, importing: false, initialized: false,
      saveStatus: '初始化…', storageError: false, notice: '',
      historyOpen: false, snapshots: [], aiActions: AI_ACTIONS, aiContextOptions: AI_CONTEXTS, aiAction: 'rewrite', aiContextScope: 'selection', aiLanguage: 'en', aiPrompt: '', aiMessages: [],
      aiOpen: false, aiRunning: false, aiPreview: '', aiError: '', aiStatus: '', aiReviewIssues: [], aiProposal: null, aiContextSummary: '当前选区 · 0 字', aiBudgetExceeded: false, aiGeneratedAction: null,
      templateOpen: false, templateQuery: '',
      importReport: null,
      sessionInstance: null,
    }
  },
  computed: {
    filteredTemplates() {
      const query = String(this.templateQuery || '').trim().toLocaleLowerCase()
      if (!query) return this.templateItems
      return this.templateItems.filter((item) => `${item.label} ${item.title} ${item.id}`.toLocaleLowerCase().includes(query))
    },
    aiReplaceDisabled() { return Boolean(this.aiBudgetExceeded && this.aiGeneratedAction !== 'title') },
  },
  watch: {
    title() { this.queueSave() },
    config: { deep: true, handler(value) { this.editorConfig = createFeishuConfig(value) } },
    templates(value) { this.templateItems = Array.isArray(value) ? value : TEMPLATES },
  },
  created() {
    // 宿主传入 Session 时由宿主管理生命周期；否则工作台创建本地会话。
    this.sessionInstance = this.session || createDocumentSession({
      documentId: this.documentId || 'local',
      mode: 'local',
      user: this.user,
      capabilities: this.capabilities || {},
      persistence: this.persistence,
    })
  },
  beforeDestroy() {
    this._disposed = true
    this.stopAI()
    void this.saveNow()
    clearTimeout(this._saveTimer)
    window.removeEventListener('beforeunload', this.flushOnLeave)
    const editor = this.getEditor()
    if (editor) editor.off('transaction', this.mapAI)
    if (!this.session) void this.sessionInstance?.dispose()
  },
  methods: {
    featureEnabled(name) { return !this.editorConfig?.features || this.editorConfig.features[name] !== false },
    // 公式样式随包样式入口一次性引入，运行时不再动态加载任何样式资源。
    getEditor() { return this.$refs.document && this.$refs.document.getEditor() },
    getSession() { return this.sessionInstance || this.session },
    writable() { const editor = this.getEditor(); return editor && editor.isEditable && !this.importing },
    record() {
      const session = this.getSession()
      const record = session ? session.getDocumentRecord({ title: this.title }) : null
      return record ? { title: record.title, json: record.content, documentId: record.documentId, schemaVersion: record.schemaVersion, revisionId: record.revisionId, updatedAt: record.updatedAt } : { title: this.title, json: this.$refs.document.getJSON() }
    },
    persistenceLabel() { return this.persistence ? '宿主' : '本浏览器' },
    getWorkspace() {
      if (!this._workspace) {
        this._workspace = this.getSession()?.getProvider('persistence') || this.persistence || createWorkspace(window.localStorage, { maxSnapshots: this.editorConfig.limits.maxSnapshots })
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
            this.$refs.document.setContent(validateDocument(draft.json, this.getEditor().schema))
            this.title = draft.title
          }
          this.saveStatus = draft ? `已恢复${this.persistenceLabel()}草稿` : (this.persistence ? '宿主适配器 · 尚未保存' : '本地示例 · 尚未保存')
        } catch (error) { this.storageFailure(error) }
      } else this.saveStatus = '本地保存已关闭'
      this.initialized = true
      this.getEditor().on('transaction', this.mapAI)
      window.addEventListener('beforeunload', this.flushOnLeave)
      logger.info('lifecycle', 'feishu.workspace.ready', { status: this.persistence ? 'host' : 'local' })
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
      this.saveStatus = '等待本地保存…'
      this._saveTimer = setTimeout(() => { void this.saveNow() }, 650)
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
        this.storageError = false
        this.saveStatus = `已保存到${this.persistenceLabel()} ${new Date().toLocaleTimeString()}`
        logger.info('storage', 'feishu.draft.saved', { status: this.persistence ? 'host' : 'local' })
        this.$emit('save', { status: 'saved', manual, target: this.persistenceLabel(), savedAt: Date.now() })
      } catch (error) { if (generation === this._saveGeneration && !this._disposed) this.storageFailure(error) }
    },
    storageFailure(error) {
      this.storageError = true
      this.saveStatus = error.message || '本地存储不可用，请导出当前文档'
      logger.warn('storage', 'feishu.storage.failed', { status: 'failed' })
      this.$emit('save', { status: 'failed', message: this.saveStatus })
      this.$emit('error', error)
    },
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
      this.$nextTick(() => this.$refs.templateSearch?.focus())
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
        logger.info('storage', 'feishu.snapshot.created', { itemCount: this.snapshots.length })
      } catch (error) { this.storageFailure(error) }
    },
    async restoreSnapshot(id) {
      if (!this.featureEnabled('history') || !this.writable()) return
      try {
        const entry = await this.callWorkspace('restore', id)
        const json = validateDocument(entry.json, this.getEditor().schema)
        if (!window.confirm('恢复此快照并替换当前正文？恢复后可撤销正文。')) return
        this.closeAI()
        this.$refs.document.setContent(json)
        this.title = entry.title
        this.notice = '已恢复快照，可撤销正文'
      } catch (error) { this.notice = error.message }
    },
    async importDocument(event) {
      if (!this.featureEnabled('importExport')) return
      const file = event.target.files && event.target.files[0]
      event.target.value = ''
      if (!file || !this.writable()) return
      if (file.size > 10 * 1024 * 1024) { this.notice = '导入文件不能超过 10 MB'; return }
      this.importing = true
      try {
        const format = file.name.split('.').pop().toLowerCase()
        let content
        let importedTitle
        if (format === 'docx') {
          const mammoth = await import('mammoth/mammoth.browser')
          const result = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() })
          content = sanitizeHTML(result.value)
        } else {
          const text = await file.text()
          if (format === 'json') {
            const value = JSON.parse(text)
            content = validateDocument(value.document || value, this.getEditor().schema)
            if (typeof value.title === 'string') importedTitle = value.title
          } else if (format === 'html' || format === 'htm') content = sanitizeHTML(text)
          else if (format === 'md' || format === 'markdown') {
            const { markdownToHtml } = await import('../../utils/importExport')
            content = sanitizeHTML(markdownToHtml(text))
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
        this.notice = format === 'docx' || format === 'md' || format === 'markdown' ? '导入完成；复杂布局按正文格式降级，请检查内容' : '导入完成'
        logger.info('import', 'feishu.document.imported', { format, status: 'success' })
      } catch (error) {
        if (!this._disposed) this.notice = `导入失败，原正文未替换：${error.message}`
        logger.warn('import', 'feishu.document.rejected', { status: 'failed' })
      } finally { if (!this._disposed) this.importing = false }
    },
    async exportDocument(format) {
      if (!this.featureEnabled('importExport') || !format) return
      const component = this.$refs.document
      try {
        const { downloadText, exportDocx, htmlToMarkdown, safeFileName } = await import('../../utils/importExport')
        const filename = safeFileName(this.title)
        if (format === 'html') downloadText(component.getHTML(), `${filename}.html`, 'text/html;charset=utf-8')
        else if (format === 'json') downloadText(JSON.stringify({ schemaVersion: 1, title: this.title, document: component.getJSON() }, null, 2), `${filename}.json`, 'application/json')
        else if (format === 'txt') downloadText(component.getText(), `${filename}.txt`, 'text/plain;charset=utf-8')
        else if (format === 'md') {
          downloadText(htmlToMarkdown(component.getHTML()), `${filename}.md`, 'text/markdown;charset=utf-8')
          this.notice = 'Markdown 为简化导出，字体、分栏、公式和图片裁剪布局可能降级；JSON 可保留完整正文'
        } else if (format === 'docx') {
          await exportDocx(this.title, component.getText())
          this.notice = 'Word 为纯文本段落导出，不保留复杂块、表格和媒体布局；JSON 可保留完整正文'
        } else if (format === 'print') {
          const editor = this.getEditor()
          const folded = Array.from(editor.storage.feishuDocument.folded)
          folded.forEach(pos => editor.commands.toggleFeishuFold(pos))
          this.$nextTick(() => {
            window.print()
            if (!this._disposed) folded.forEach(pos => editor.commands.toggleFeishuFold(pos))
          })
        }
      } catch (error) { this.notice = `导出失败：${error.message}` }
    },
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
      // 宿主提供 stream 钩子时完全接管生成；否则退回本地 Mock，保证 Demo 与离线可用。
      if (this.aiProvider && typeof this.aiProvider.stream === 'function') {
        try {
          const handle = this.aiProvider.stream({
            action: this._aiPreviewAction,
            text: context.text,
            prompt: options.prompt || this.aiPrompt,
            language: this.aiLanguage,
            range: { from: context.from, to: context.to, source: context.source },
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
      logger.info('ai', 'feishu.mock.started', { action: previewAction, status: 'local' })
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
        logger.info('ai', 'feishu.mock.rejected', { status: 'stale' })
        return
      }
      if (this._aiPreviewAction === 'title') this.title = this.aiPreview
      else {
        const { from, to } = this._aiAnchor
        const insertFrom = mode === 'insert' ? editor.state.selection.from : (this._aiPreviewAction === 'continue' ? to : from)
        const insertTo = mode === 'insert' ? editor.state.selection.from : to
        editor.view.dispatch(editor.state.tr.insertText(this.aiPreview, insertFrom, insertTo).scrollIntoView())
      }
      this.closeAI()
      logger.info('ai', 'feishu.mock.accepted', { status: 'accepted' })
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
