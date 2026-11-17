/**
 * 工作区控制器 —— 持久化域。
 *
 * 落盘判定（feature 闸门 / autosave 配置 / 已初始化 / 存储错误 / 已销毁）、适配器
 * 安装与作用域快照、快照预算、手动与离页落盘、失败上报。方法以对象字面量形式
 * `Object.assign` 回 `WorkspaceController.prototype`，方法体与原来逐字相同。
 */
import { createPersistenceWorkspace, detectBrowserStorage } from '../providers/persistence'
import { createLarkDocConfig, isAutoSaveEnabled, resolveAutoSaveDelay } from '../components/lark-doc/larkDocConfig'
import { createDerivedSnapshot } from '../core/derive/snapshot'
import { DOCUMENT_SCHEMA_VERSION } from '../core/documentSchema'
import { logger } from '../utils/logger'

export const persistenceMethods = {
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
      const derived = createDerivedSnapshot(editor.storage?.larkDoc?.pagedView?.logicalDocument(doc) || doc)
      if (derived) base.derived = derived
    }
    return base
  },

  persistenceLabel() {
    if (this.props.persistence) return '宿主'
    return this.state.storageKind === 'memory' ? '内存' : '本浏览器'
  },

  persistenceCaveat() {
    if (this.props.persistence) return ''
    return this.state.storageKind === 'memory' ? '（刷新即丢失，请先导出）' : ''
  },

  getWorkspace() {
    const session = this.getSession(), provider = session?.getProvider('persistence'), installed = this._workspaceInstalled
    const managed = !!installed && installed.session === session && installed.workspace === provider
    let source = provider || this.props.persistence
    const limit = this.state.editorConfig.limits.maxSnapshots
    if (managed && this.props.persistence !== installed.configured) source = this.props.persistence
    if (managed && installed.generated && limit !== installed.limit) source = null
    if (!source && !session && this._workspaceFallback?.limit === limit) source = this._workspaceFallback.workspace
    const workspace = source || createPersistenceWorkspace({ ...detectBrowserStorage(this.getWindow()), maxSnapshots: limit })
    this._workspace = workspace
    this.state.storageKind = workspace.kind || ''
    if (session && (!provider || managed && workspace !== provider)) {
      session.setProvider('persistence', workspace)
      this._workspaceInstalled = { session, workspace, configured: this.props.persistence, generated: !source, limit }
    } else if (!managed) this._workspaceInstalled = null
    if (!session && !source) this._workspaceFallback = { workspace, limit }
    return workspace
  },

  _capturePersistenceScope() {
    const enabled = this.featureEnabled('persistence'), workspace = enabled ? this.getWorkspace() : null
    const session = this.getSession(), editor = this.getEditor(), provider = session?.getProvider?.('persistence')
    const features = this.state.editorConfig.features, configured = this.props.persistence
    const key = () => JSON.stringify([session?.documentId, this.props.documentId, session?.user?.id, this.props.user?.id,
      session?._identityGeneration, session?._privateIdentityGeneration, session?._authorizationGeneration])
    const captured = key()
    let retired = false
    const stop = session?.on?.('provider-changed', event => { if (event?.name === 'persistence') retired = true })
    return { enabled, workspace, session, current: () => !retired && !this._disposed && !session?._destroyed && !editor?.isDestroyed
      && session === this.getSession() && editor === this.getEditor()
      && provider === session?.getProvider?.('persistence') && configured === this.props.persistence
      && features === this.state.editorConfig.features && enabled === this.featureEnabled('persistence')
      && (typeof session?._identityCurrent !== 'function' || session._identityCurrent())
      && (!enabled || typeof session?.can !== 'function' || session.can('canView')) && captured === key(),
    release: () => { if (typeof stop === 'function') stop() } }
  },

  callWorkspace(method, ...args) {
    const workspace = this.getWorkspace()
    if (!workspace || typeof workspace[method] !== 'function') throw new Error(`持久化适配器缺少 ${method} 方法`)
    return workspace[method](...args)
  },

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
  },

  queueSave() {
    this.checkInitialization()
    if (!this.featureEnabled('persistence') || !this.state.initialized || this.state.storageError || this._disposed) return
    if (!this._scheduleSaveTimer()) this.state.saveStatus = '自动保存已关闭'
  },

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
  },

  /** 返回 { enabled（配置值）, delay, effective（叠加持久化总闸后的实际生效值） }。 */
  getAutoSave() {
    const config = this.state.editorConfig
    const autosave = config?.autosave || {}
    return {
      enabled: autosave.enabled !== false,
      delay: resolveAutoSaveDelay(config),
      effective: isAutoSaveEnabled(config),
    }
  },

  flushOnLeave() { void this.saveNow() },

  async saveNow(manual = false) {
    this.checkInitialization()
    if (!this.featureEnabled('persistence')) return
    clearTimeout(this._saveTimer)
    if (this.state.importing || this.getEditor()?.storage?.larkDoc?.pagedImport) return false
    if (!this.state.initialized || !this.getEditor() || (!manual && this.state.storageError)) return
    const generation = ++this._saveGeneration
    let scope
    try {
      scope = this._capturePersistenceScope()
      await this.callWorkspace('save', this.record())
      if (generation !== this._saveGeneration || !scope.current()) return
      this.state.storageError = false
      this.state.storageKind = this._workspace?.kind || this.state.storageKind
      this.state.saveStatus = `已保存到${this.persistenceLabel()}${this.persistenceCaveat()} ${new Date().toLocaleTimeString()}`
      logger.info('storage', 'lark-doc.draft.saved', { status: this.props.persistence ? 'host' : 'local', kind: this.state.storageKind })
      this.emit('save', { status: 'saved', manual, target: this.persistenceLabel(), kind: this.state.storageKind, savedAt: Date.now() })
    } catch (error) { if (generation === this._saveGeneration && !this._disposed && (!scope || scope.current())) this.storageFailure(error) }
    finally { scope?.release() }
  },

  storageFailure(error) {
    this.state.storageError = true
    this.state.saveStatus = error.message || '本地存储不可用，请导出当前文档'
    logger.warn('storage', 'lark-doc.storage.failed', { status: 'failed' })
    this.emit('save', { status: 'failed', message: this.state.saveStatus })
    this.emit('error', error)
  }
}
