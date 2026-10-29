/**
 * 命令式入口：`new LarkDoc(...)`。
 *
 * 这一层不实现任何编辑器逻辑，只做五件事：
 * 1. 把 AiEditor 风格的扁平配置翻译成内部的 `createLarkDocConfig` 结构；
 * 2. 通过 mount/ 渲染适配层挂载 Workspace（默认 Vue 2，可替换），本文件不 import 任何 UI 框架；
 * 3. 把实例方法转发给 Workspace / Editor；
 * 4. 解析并透传协同 / 权限会话（session 或 providers 快捷项）；
 * 5. 按固定顺序销毁，保证 AI 流、会话和监听器都被释放。
 */
import { createRenderer } from './mount'
import { createLarkDocConfig } from './components/lark-doc/larkDocConfig'
import { normalizeAIProvider } from './components/lark-doc/ai'
import { resolveToolbarKeys } from './toolbarKeys'
import { createNetworkPolicy } from './networkPolicy'
import { createDocumentSession } from './session/DocumentSession'
import { migrateRecordContent } from './core/migrations'
import { createThemeController } from './theme'
import { createUploadProvider } from './core/media/upload'

const EVENT_NAMES = Object.freeze(['ready', 'update', 'change', 'save', 'title-change', 'error', 'destroy', 'import-report', 'themeChange'])

const DEFAULTS = Object.freeze({
  title: '',
  content: '',
  placeholder: '输入正文，或输入 / 插入内容',
  readonly: false,
  theme: 'light',
  // 正文双轨：auto = 跟随 theme 解析结果；不接受 'system'（11 §3.2）。
  contentTheme: 'auto',
  // 'local' 才读写 localStorage（键 lark-doc:theme / lark-doc:content-theme）。
  themeStorage: 'none',
  storage: 'none',
  autofocus: false,
  // 'auto' 按指纹识别 Vditor getHTML() 产物；'vditor' 强制归一化；'html' 跳过归一化。
  contentFormat: 'auto',
  // 保存时是否在 record 里附带 html 字段（默认 false，仅存 json 结构化数据）。
  saveHtml: false,
})

function resolveElement(element) {
  if (!element) throw new Error('LarkDoc: 缺少 element 配置')
  // 兼容 Vue 组件的 this.$refs.xxx 传进来的组件实例。
  const target = element.$el || element
  if (typeof target === 'string') {
    const found = document.querySelector(target)
    if (!found) throw new Error(`LarkDoc: 未找到挂载节点 ${target}`)
    return found
  }
  if (typeof target === 'object' && target.nodeType === 1) return target
  throw new Error('LarkDoc: element 必须是选择器、DOM 节点或组件实例')
}

/**
 * 统一 content 入参：
 * - HTML 字符串
 * - Tiptap JSON（type: 'doc'）
 * - 文档信封 DocumentRecord（含 documentId/schemaVersion/content）
 */
function normalizeDocumentInput(input) {
  if (input == null || input === '') return { title: null, content: null }
  if (typeof input === 'string') return { title: null, content: input }
  if (typeof input !== 'object') return { title: null, content: null }
  if (input.content && typeof input.content === 'object' && (input.schemaVersion || input.documentId)) {
    // 版本化信封：老版本正文（v1 扁平）先迁移到当前版本再进编辑器（P1-04）。
    return { title: input.title == null ? null : String(input.title), content: migrateRecordContent(input.content, input.schemaVersion) }
  }
  if (input.type === 'doc') return { title: null, content: input }
  return { title: input.title == null ? null : String(input.title), content: null }
}

export class LarkDoc {
  constructor(options = {}) {
    const source = options && typeof options === 'object' ? options : {}
    this.options = { ...DEFAULTS, ...source }
    this.element = resolveElement(source.element)
    this._destroyed = false
    this._handlers = Object.create(null)
    EVENT_NAMES.forEach((name) => { this._handlers[name] = [] })
    // 主题控制器：首次 _applyHostAttributes() 时懒创建（需要挂载后的根容器）。
    // _themeEventsReady 闸门：构造期首次应用不算变更，不向宿主派发 themeChange。
    this._themeController = null
    this._themeEventsReady = false
    this._hostSkin = source.hostSkin && typeof source.hostSkin === 'object' ? source.hostSkin : null

    const documentInput = normalizeDocumentInput(source.content)
    this.config = this._buildConfig(source)
    this.networkPolicy = createNetworkPolicy(this.config.network)
    this._ownsSession = false
    this._session = this._resolveSession(source)

    this._renderer = createRenderer()
    this._handle = this._renderer.mount({
      element: this.element,
      props: {
        config: this.config,
        initialTitle: documentInput.title != null ? documentInput.title : String(this.options.title || ''),
        initialContent: documentInput.content,
        contentFormat: this.options.contentFormat,
        readonly: Boolean(source.readonly),
        persistence: this._resolvePersistence(source),
        saveHtml: this.options.saveHtml === true,
        uploadImage: this._resolveUploader(source),
        uploadFile: this._resolveFileUploader(source),
        resolveFileUrl: this._resolveFileUrlResolver(source),
        // `ai` 支持四种写法：地址字符串、{endpoint}、{protocol:'openai',baseURL}、
        // 以及旧的 {stream(args){}} 钩子。这里统一收敛成标准 provider，Workspace 只认一种契约。
        aiProvider: normalizeAIProvider(source.ai),
        session: this._session,
        // P3-07：内嵌内容的宿主回调与 iframe 覆盖通道（iframe 桥 / 卡片动作 / URL 卡抓取）。
        ...this._resolveEmbedOptions(source),
      },
      on: {
        ready: () => {
          this._applyHostAttributes()
          if (this.options.autofocus && !this.isReadonly()) this.focus()
          this._emit('ready', { document: this, editor: this.getEditor(), workspace: this.getWorkspace() })
        },
        update: (payload) => {
          this._emit('update', payload)
          const title = this.getTitle()
          if (title !== this._lastTitle) {
            this._lastTitle = title
            this._emit('title-change', title)
          }
        },
        change: (payload) => this._emit('change', payload),
        'import-report': (report) => {
          this.lastImportReport = report
          this._emit('import-report', report)
        },
        save: (payload) => this._emit('save', payload),
        error: (error) => this._emit('error', error),
      },
    })
    this._lastTitle = this.options.title || ''
    this._applyHostAttributes()
    this._themeEventsReady = true
  }

  /* ------------------------------------------------------------------ */
  /* 初始化辅助                                                          */
  /* ------------------------------------------------------------------ */

  _buildConfig(source) {
    const raw = { ...(source.config || {}) }
    if (source.features && typeof source.features === 'object') {
      raw.features = { ...(raw.features || {}) }
      Object.keys(source.features).forEach((key) => {
        if (typeof source.features[key] === 'boolean') raw.features[key] = source.features[key]
      })
    }
    if (source.layout && typeof source.layout === 'object') raw.layout = { ...(raw.layout || {}), ...source.layout }
    if (source.limits && typeof source.limits === 'object') raw.limits = { ...(raw.limits || {}), ...source.limits }
    if (source.network && typeof source.network === 'object') raw.network = { ...(raw.network || {}), ...source.network }

    // 工具栏：toolbarKeys / toolbarExcludes 为权威；未传时保留 config.toolbar。
    if (source.toolbarKeys || source.toolbarExcludes) {
      const resolved = resolveToolbarKeys({ toolbarKeys: source.toolbarKeys, toolbarExcludes: source.toolbarExcludes })
      raw.toolbar = { ...(raw.toolbar || {}), ...resolved.toolbar, marksAllow: resolved.marksAllow }
      this.unknownToolbarKeys = resolved.unknown
    }

    // 控制器默认不写 localStorage：宿主明确给 storage: 'local' 才开启本地草稿。
    if (this.options.storage !== 'local') {
      raw.features = { ...(raw.features || {}) }
      if (raw.features.persistence === undefined) raw.features.persistence = false
    }
    if (source.ai && source.ai.enabled === false) raw.features = { ...(raw.features || {}), ai: false }

    if (this.options.placeholder) raw.text = { ...(raw.text || {}), placeholder: this.options.placeholder }

    return createLarkDocConfig(raw)
  }

  _resolvePersistence(source) {
    if (source.persistence && typeof source.persistence === 'object') return source.persistence
    return null
  }

  /**
   * 解析协同/权限会话：
   * - 宿主直接给 `session`（DocumentSession 实例）→ 原样复用，生命周期归宿主；
   * - 宿主给 `providers` 或 collaboration / authorization 等单项 → 由门面创建并持有，
   *   destroy 时随实例一起释放；
   * - 都没传 → 返回 null，Workspace 内部会创建默认本地会话。
   */
  _resolveSession(source) {
    if (source.session) return source.session
    const hasProviders = source.providers || source.collaboration || source.authorization || source.versioning || source.comments
    if (!hasProviders) return null
    this._ownsSession = true
    return createDocumentSession({
      documentId: source.documentId == null ? null : String(source.documentId),
      user: source.user || null,
      mode: source.mode || (source.collaboration ? 'collaborative' : 'local'),
      providers: source.providers || {
        collaboration: source.collaboration,
        authorization: source.authorization,
        versioning: source.versioning,
        comments: source.comments,
      },
      capabilities: source.capabilities,
    })
  }

  /**
   * 上传通道归一（P2-02）。三种宿主写法 → 同一个 `(file, ctx?) => Promise<result>`：
   *   `uploader: { upload, limits?, retry?, chunked?, chunkSize? }` / `uploader: fn` / `uploadImage: fn`。
   *
   * 注意 `limits` 默认是 null（= 不在 provider 层拦）：图片块自己已有 imageMaxSize
   * 这道校验，两处都设上限容易出现「宿主放宽到 30 MB 却被门面按 20 MB 拒掉」。
   * 想统一口径就显式传 `uploader.limits`。
   */
  _resolveUploader(source) {
    const uploader = source.uploader
    const isObject = uploader && typeof uploader.upload === 'function'
    const upload = isObject ? uploader.upload.bind(uploader) : typeof uploader === 'function' ? uploader : null
    if (upload) {
      return createUploadProvider({
        upload,
        limits: uploader.limits === undefined ? null : uploader.limits,
        retry: uploader.retry,
        chunked: uploader.chunked,
        chunkSize: uploader.chunkSize,
        getDocumentId: () => (source.documentId == null ? null : String(source.documentId)),
      }).upload
    }
    if (typeof source.uploadImage === 'function') {
      return createUploadProvider({ upload: source.uploadImage, limits: null, getDocumentId: () => (source.documentId == null ? null : String(source.documentId)) }).upload
    }
    return null
  }

  /**
   * 文件上传通道归一（P2-04）。附件块和图片块**不共用**解析结果：
   * 图片侧允许回落到 `uploader`，文件侧优先 `uploadFile`，其次 `uploader`，
   * 但**绝不**回落到 `uploadImage`——图片上传实现普遍会按 MIME 白名单拒掉 mp4/pdf。
   *
   * 返回值刻意是裸函数而不是 upload provider：文件块需要的只是一张
   * `(file) => ({ token?, url?, name?, size?, mimeType? })` 的票，进度/重试/分片
   * 属于宿主自己的事（02 §19.5 没有上传中态）。
   */
  _resolveFileUploader(source) {
    const explicit = source.uploadFile
    if (typeof explicit === 'function') return explicit
    if (explicit && typeof explicit.upload === 'function') return explicit.upload.bind(explicit)
    const uploader = source.uploader
    if (uploader && typeof uploader.upload === 'function') return uploader.upload.bind(uploader)
    if (typeof uploader === 'function') return uploader
    return null
  }

  /**
   * token → 可播放/可预览 URL 的换票器。本仓库不带飞书预览 SDK，
   * 只要宿主存了 token 而不是直链，就必须由宿主补这一层，否则文件块只能停在失败态。
   */
  _resolveFileUrlResolver(source) {
    if (typeof source.resolveFileUrl === 'function') return source.resolveFileUrl
    if (source.file && typeof source.file.resolveUrl === 'function') return source.file.resolveUrl.bind(source.file)
    return null
  }

  /**
   * 内嵌内容的宿主接线点（0.12 P3 三个出口，P3-07 补齐）。
   *
   * 前六项是回调，全部**可选**，不传就退回 core 的默认行为：标题不同步、
   * iframe 存盘只回 `{ ok: true }`、卡片动作按钮自己 `window.open`、URL 卡只显示域名。
   * core 不认识宿主，所有「要不要发请求 / 存到哪」的判断都留在这一层之外。
   *
   * 之所以逐项校验而不是整包透传：宿主最容易把 `onSave`（文档 save 事件）当成
   * `onEmbedSave`（iframe 内的存盘）传进来 —— 那会把「每次敲字都存盘」挂到
   * iframe 的 save 帧上。非函数一律丢弃，宁可退回默认行为。
   *
   * 后两项 `embedSandbox` / `embedAllow` 是 iframe 的**覆盖通道**，不是新默认值：
   * 不传仍是 `core/embed/web-embed.js` 的安全基线（无 `allow-same-origin`）。
   * 但基线同时意味着 iframe 是**不透明源**，`event.origin` 恒为 `"null"`，
   * 桥的 origin 严格校验（09 §3.4.2 规则①）会全部拒收 —— 想让桥真正握手，
   * 宿主必须对自己**信任的自有页面**显式声明含 `allow-same-origin` 的组合。
   * 第三方站点不要开这一项：同源 + 脚本 = 沙箱可被自己摘掉。
   */
  _resolveEmbedOptions(source) {
    const fn = (name) => (typeof source[name] === 'function' ? source[name] : null)
    const str = (name) => (typeof source[name] === 'string' && source[name] ? source[name] : null)
    return {
      onEmbedTitle: fn('onEmbedTitle'),
      onEmbedSave: fn('onEmbedSave'),
      onEmbedCardAction: fn('onEmbedCardAction'),
      // `providers` 是 providerId 白名单数组，null = 全认（`core/embed/card.js`）。
      embedProviders: Array.isArray(source.embedProviders) ? source.embedProviders.slice() : null,
      onBookmarkOpen: fn('onBookmarkOpen'),
      unfurlProvider: fn('unfurlProvider'),
      embedSandbox: str('embedSandbox'),
      embedAllow: str('embedAllow'),
    }
  }

  /**
   * 主题落盘入口：懒创建 theme controller 并把解析结果写到根容器。
   * 历史上这里是「theme 两态 + data-theme」的直写实现，0.12 起全部转调
   * src/theme.js（四态 × contentTheme 双轨），DOM 契约见 requirements/11 §3.3。
   */
  _applyHostAttributes() {
    if (!this._themeController) {
      this._themeController = createThemeController({
        theme: this.options.theme,
        contentTheme: this.options.contentTheme,
        hostSkin: this._hostSkin,
        themeStorage: this.options.themeStorage,
        getRoot: () => (this._renderer && this._handle ? this._renderer.getRoot(this._handle) : null),
        onChange: (state) => {
          if (this._themeEventsReady && !this._destroyed) this._emit('themeChange', state)
        },
      })
    }
    this._themeController.applyToRoot()
  }

  /* ------------------------------------------------------------------ */
  /* 事件                                                                */
  /* ------------------------------------------------------------------ */

  on(name, handler) {
    if (this._handlers[name] && typeof handler === 'function') this._handlers[name].push(handler)
    return this
  }

  off(name, handler) {
    const list = this._handlers[name]
    if (!list) return this
    if (!handler) this._handlers[name] = []
    else this._handlers[name] = list.filter((item) => item !== handler)
    return this
  }

  _emit(name, payload) {
    const list = this._handlers[name] || []
    list.slice().forEach((handler) => {
      try { handler(payload) } catch (error) { if (typeof console !== 'undefined') console.error(`[LarkDoc] ${name} 回调异常`, error) }
    })
    if (name === 'update' && this.options.onUpdate) this._safeCall(this.options.onUpdate, payload)
    if (name === 'change' && this.options.onChange) this._safeCall(this.options.onChange, payload)
    if (name === 'import-report' && this.options.onImportReport) this._safeCall(this.options.onImportReport, payload)
    if (name === 'ready' && this.options.onReady) this._safeCall(this.options.onReady, payload)
    if (name === 'error' && this.options.onError) this._safeCall(this.options.onError, payload)
    if (name === 'save' && this.options.onSave) this._safeCall(this.options.onSave, payload)
    if (name === 'destroy' && this.options.onDestroy) this._safeCall(this.options.onDestroy, payload)
    if (name === 'themeChange' && this.options.onThemeChange) this._safeCall(this.options.onThemeChange, payload)
  }

  _safeCall(fn, payload) {
    try { fn(payload) } catch (error) { if (typeof console !== 'undefined') console.error('[LarkDoc] 回调异常', error) }
  }

  /* ------------------------------------------------------------------ */
  /* 实例方法                                                            */
  /* ------------------------------------------------------------------ */

  getWorkspace() {
    if (!this._renderer || !this._handle) return null
    return this._renderer.getInstance(this._handle)
  }

  getEditor() {
    const workspace = this.getWorkspace()
    return workspace ? workspace.getEditor() : null
  }

  getConfig() { return this.config }

  /** 返回会话（协同 / 权限 / 版本 / 评论 Provider 的宿主）；未配置时为内部默认会话或 null。 */
  getSession() {
    const workspace = this.getWorkspace()
    if (workspace && typeof workspace.getSession === 'function') return workspace.getSession()
    return this._session
  }

  /** 权限能力查询：未配置授权 Provider 时默认放行，服务端仍是最终授权方。 */
  can(capability) {
    const session = this.getSession()
    return session && typeof session.can === 'function' ? session.can(capability) : true
  }

  /** 连接协同服务（collaborative 模式才有实际连接）；返回连接结果或 { status: 'local' }。 */
  async connectCollaboration() {
    const session = this.getSession()
    if (!session) return { status: 'local' }
    return session.connect()
  }

  /** 断开协同连接；本地模式安全空操作。 */
  async disconnectCollaboration() {
    const session = this.getSession()
    if (session) await session.disconnect()
  }

  getHTML() {
    const workspace = this.getWorkspace()
    return workspace ? workspace.getHTML() : ''
  }

  getJSON() {
    const workspace = this.getWorkspace()
    return workspace ? workspace.getJSON() : null
  }

  getText() {
    const workspace = this.getWorkspace()
    return workspace ? workspace.getText() : ''
  }

  getTitle() {
    const workspace = this.getWorkspace()
    return workspace ? workspace.getTitle() : this.options.title
  }

  setTitle(value) {
    const workspace = this.getWorkspace()
    if (workspace) workspace.setTitle(value)
    return this
  }

  /** 接受 HTML / Tiptap JSON / DocumentRecord；返回是否写入成功。 */
  setContent(content, options = {}) {
    const workspace = this.getWorkspace()
    if (!workspace) return false
    const normalized = normalizeDocumentInput(content)
    if (normalized.title != null) workspace.setTitle(normalized.title)
    if (normalized.content == null) return false
    const format = options.format || this.options.contentFormat || 'auto'
    return workspace.setContent(normalized.content, { format: format === 'wangeditor' ? 'auto' : format })
  }

  /**
   * 导入 Vditor（`getHTML()`）导出的 HTML。
   * 与 setContent 的区别：不依赖指纹检测，强制按 Vditor 结构归一化。
   */
  importVditor(html, options = {}) {
    return this.setContent(html, { ...options, format: 'vditor' })
  }

  /** 最近一次旧数据转换报告；非旧数据为 null。 */
  getImportReport() {
    const workspace = this.getWorkspace()
    if (workspace && typeof workspace.getImportReport === 'function') return workspace.getImportReport()
    return this.lastImportReport || null
  }

  insert(content) {
    const workspace = this.getWorkspace()
    return workspace ? workspace.insertContent(content) : false
  }

  insertText(text) {
    const workspace = this.getWorkspace()
    return workspace ? workspace.insertText(text) : false
  }

  focus() {
    const workspace = this.getWorkspace()
    if (workspace) workspace.focus()
    return this
  }

  /**
   * 热更新渲染层 props（Web Component 属性变化时调用）。
   * 只有 Workspace 声明过的 prop 会被写入；未挂载或已销毁时返回 false。
   */
  patchProps(props) {
    if (this._destroyed || !this._renderer || !this._handle) return false
    if (props && typeof props === 'object') this._renderer.update(this._handle, props)
    return true
  }

  setReadonly(value) {
    const workspace = this.getWorkspace()
    if (workspace) workspace.setReadonly(value === true)
    return this
  }

  isReadonly() {
    const workspace = this.getWorkspace()
    return workspace ? workspace.isReadonly() : Boolean(this.options.readonly)
  }

  /**
   * 设置主题：theme ∈ light/dark/system/host；contentTheme ∈ auto/light/dark（省略 = 保持现值）。
   * 变更生效后派发 themeChange 事件（含 onThemeChange 选项回调）；
   * options 同步更新，宿主重建实例或读 options 时拿到的都是最新值。
   */
  setTheme(theme, contentTheme) {
    if (this._destroyed) return this
    this._applyHostAttributes()
    const snapshot = this._themeController.setTheme(theme, contentTheme)
    this.options.theme = snapshot.theme
    this.options.contentTheme = snapshot.contentTheme
    return this
  }

  /** 返回 { theme, contentTheme, resolved: { theme, contentTheme }, source }；resolved 为已解析生效值。 */
  getTheme() {
    if (this._destroyed) return null
    this._applyHostAttributes()
    return this._themeController.getTheme()
  }

  undo() {
    const workspace = this.getWorkspace()
    return workspace ? workspace.undo() : false
  }

  redo() {
    const workspace = this.getWorkspace()
    return workspace ? workspace.redo() : false
  }

  /** 交给宿主持久化适配器保存；未配置时解析为 null。 */
  save() {
    const workspace = this.getWorkspace()
    return workspace ? workspace.save() : Promise.resolve(null)
  }

  destroy() {
    if (this._destroyed) return
    this._destroyed = true
    this._emit('destroy', { document: this })
    const workspace = this.getWorkspace()
    if (workspace && typeof workspace.stopAI === 'function') {
      try { workspace.stopAI() } catch (error) { /* 已在销毁流程中，忽略 */ }
    }
    // 门面自建的会话随实例释放；宿主传入的会话由宿主自行管理。
    if (this._ownsSession && this._session) {
      Promise.resolve(this._session.dispose()).catch((error) => {
        if (typeof console !== 'undefined') console.error('[LarkDoc] 会话释放异常', error)
      })
    }
    this._session = null
    // 主题监听器（matchMedia / MutationObserver / storage）随实例释放。
    if (this._themeController) {
      this._themeController.destroy()
      this._themeController = null
    }
    if (this._renderer && this._handle) this._renderer.destroy(this._handle)
    this._handle = null
    this._renderer = null
    EVENT_NAMES.forEach((name) => { this._handlers[name] = [] })
    this.config = null
    this.networkPolicy = null
    this.element = null
  }
}

/** 支持不带 new 调用：LarkDoc({...})。 */
export function createLarkDoc(options) {
  return new LarkDoc(options)
}

export default LarkDoc
