
import { createDocumentRecord } from '../core/documentSchema'

import { aggregateHeadingContainers, restoreUnknownBlocks } from '../core/documentOperations'
import { setTransactionMetadata, TRANSACTION_ORIGINS } from '../core/transactionMetadata'
import { createAuthorizationProvider, normalizeCapabilities, DENIED_CAPABILITIES } from '../providers/authorization'
import { createCollaborationProvider } from '../providers/collaboration'
import { createCommentsProvider } from '../providers/comments'
import { createNotificationsProvider } from '../providers/notifications'
import { createPersistenceProvider } from '../providers/persistence'
import { createVersioningProvider } from '../providers/versioning'
import { createDocumentBusinessProvider } from '../providers/document-business'
import { createResourceProvider } from '../providers/resources'
import { createAssetProvider } from '../providers/upload'
import { createIdentityProvider } from '../providers/identity'

const PROVIDER_FACTORIES = {
  persistence: createPersistenceProvider,
  collaboration: createCollaborationProvider,
  versioning: createVersioningProvider,
  comments: createCommentsProvider,
  notifications: createNotificationsProvider,
  authorization: createAuthorizationProvider,
  resources: createResourceProvider,
  documentBusiness: createDocumentBusinessProvider,
  assets: createAssetProvider,
  identity: createIdentityProvider,
}

/**
 * 自动历史版本的节流间隔（毫秒）。
 *
 * 飞书前端**没有**「创建版本」接口（只有 `history/page/list`、`revert` 一类读与还原），
 * 历史版本由服务端在内容提交时持续记录，所以这里不是「定时快照」，而是「正文落定后补一次
 * 提交，交给后端存」。60s 是节流上限：连续编辑的 60 秒内只留一条，否则时间线会退化成
 * 击键日志 —— 而历史面板的价值恰恰在「隔几分钟才有一条可读的记录」。
 */
/**
 * 单文档会话。编辑器和工作台只依赖这层，Provider 可以在本地模式或未来的
 * 协同、版本、评论和权限服务之间替换，而不改变 Vue 组件 API。
 */
import { identityMethods } from './sessionIdentityMethods'
import { versionMethods, AUTO_VERSION_INTERVAL_MS, AUTO_SNAPSHOT_DEBOUNCE_MS } from './sessionVersionMethods'
import { assetMethods } from './sessionAssetMethods'
import { commentMethods } from './sessionCommentMethods'
import { permissionMethods } from './sessionPermissionMethods'
import { notificationMethods } from './sessionNotificationMethods'
import { resourceMethods } from './sessionResourceMethods'

export class DocumentSession {
  constructor(options = {}) {
    this.documentId = options.documentId == null ? null : String(options.documentId)
    this.mode = options.mode || 'local'
    this.user = options.user || null
    this._editor = null
    this._listeners = new Map()
    this._destroyed = false
    this._resourceOperations = new Map()
    this._notificationSubscriptions = new Set()
    this._notificationResetProvider = null
    this._notificationResetGeneration = null
    this._capabilities = normalizeCapabilities(options.capabilities)
    this._authorizationGeneration = 0
    this._assetGeneration = 0
    this._conversionGeneration = 0
    this._versioningProviderGeneration = 0
    this._commentGeneration = 0
    this._retiredCommentProviders = new Set()
    this._identityGeneration = 0
    this._identityRequired = false
    this._privateIdentityGeneration = 0
    this._identityState = null
    this._identityDisconnect = Promise.resolve()
    // 自动历史版本：默认开启（飞书同样没有「手动保存版本」这个动作），
    // 宿主可用 `autoVersion: false` 关掉 —— 例如只读预览或测试。
    this._autoVersionEnabled = options.autoVersion !== false && options.autoSnapshot !== false
    this._autoVersionDebounce = AUTO_SNAPSHOT_DEBOUNCE_MS
    this._autoVersionMinInterval = AUTO_VERSION_INTERVAL_MS
    this._autoVersionTimer = null
    this._autoVersionListener = null
    this._autoVersionRunning = false
    this._autoVersionDirty = false
    this._autoVersionAt = 0
    this._autoVersionSignature = ''
    this.setAutoSnapshot(options.autoSnapshot)
    if (options.autoVersion === false) this.setAutoVersion(false)
    this.providers = {}
    const input = options.providers || {}
    Object.keys(PROVIDER_FACTORIES).forEach((name) => {
      const value = input[name] || options[name]
      this.providers[name] = PROVIDER_FACTORIES[name](value)
    })
    this._businessContext = () => ({ principalId: this.user?.id, generation: this._privateIdentityGeneration, authenticated: this._identityCurrent() })
    this.providers.documentBusiness?.bindContext(this._businessContext)
    if (this.mode === 'collaborative' && !this.providers.collaboration) {
      throw new Error('collaborative 模式必须提供 collaboration Provider')
    }
    if (this.providers.identity) this._bindIdentityProvider()
    else if (this.providers.authorization) {
      // 构造不产生未处理拒绝；refresh本身仍向显式调用者拒绝并关闭旧能力。
      this._capabilitiesPromise = this.refreshCapabilities().catch(() => this.getCapabilities())
    }
  }

  /** 读取一个已验证的 Provider，未配置时返回 null。 */
  getProvider(name) { return this.providers[name] || null }

  get user() { return this._user }

  set user(value) {
    if (this._identityRequired && !this._identityUpdating) throw new Error('IDENTITY_USER_IS_SERVER_MANAGED')
    const priorId = this._user && this._user.id
    this._user = value
    if (!this._destroyed && priorId !== (value && value.id) && this.providers) {
      this._clearPrivateIdentityView('identity-changed')
    }
  }

  /** 在运行时替换 Provider；授权 Provider 替换后立即刷新能力。 */
  setProvider(name, provider) {
    if (['authorization', 'notifications', 'assets', 'versioning', 'comments', 'identity', 'documentBusiness'].includes(name) && this._destroyed) throw new Error('DocumentSession 已销毁')
    const factory = PROVIDER_FACTORIES[name]
    if (!factory) throw new Error(`未知 Provider：${name}`)
    const next = factory(provider)
    if (name === 'documentBusiness' && next !== this.providers[name] && this.providers[name]?.getPending().length) throw new Error('BUSINESS_PENDING_QUERY_REQUIRED')
    if (name === 'identity') {
      if (next === this.providers.identity) return next
      const prior = this.providers.identity; this._identityStop?.(); this._identityStop = null
      this.providers.identity = next; prior?.dispose?.(); this._bindIdentityProvider(); this.emit('provider-changed', { name }); return next
    }
    if (name === 'documentBusiness') {
      if (next === this.providers[name]) return next
      this.providers[name]?.reset('provider-replaced')
      next?.bindContext(this._businessContext)
    }
    if (['notifications', 'assets'].includes(name) && next === this.providers[name]) return next
    if (['comments', 'authorization'].includes(name) && next !== this.providers[name]) {
      if (name === 'comments' && this.providers[name]) this._retiredCommentProviders.add(this.providers[name])
      this.providers[name]?.reset?.('provider-replaced')
    }
    if (name === 'assets') this._resetAssets('provider-replaced')
    if (name === 'versioning') { this._versioningProviderGeneration++; this._resetVersions('provider-replaced') }
    if (name === 'notifications') {
      this._notificationSubscriptions.forEach(stop => stop())
      this.providers.notifications?.reset?.('provider-replaced')
    }
    this.providers[name] = next
    this.emit('provider-changed', { name })
    if (name === 'comments') { this._commentGeneration++; this.emit('comments-provider', this.providers[name]) }
    if (name === 'notifications') this.emit('notifications-provider', this.providers[name])
    if (name === 'authorization') {
      if (this.providers.authorization) this._capabilitiesPromise = this.refreshCapabilities().catch(() => this.getCapabilities())
      else {
        this._authorizationGeneration++
        this._capabilities = { ...DENIED_CAPABILITIES }
        this._clearPrivateIdentityView('authorization-required')
        this.emit('capabilities', this.getCapabilities())
      }
    }
    return this.providers[name]
  }

  /** 绑定 Tiptap 实例，使记录、事务和版本操作共享同一正文。 */
  attachEditor(editor, documentAccess = null) {
    if (this._destroyed) throw new Error('DocumentSession 已销毁')
    if (this._editor && this._editor !== editor) this._unbindAutoVersion(this._editor)
    this._editor = editor || null
    this._documentAccess = documentAccess
    this._currentVersion = null
    this._pendingLocalRestore = null
    this._bindAutoVersion(this._editor)
    this.emit('editor', this._editor)
    return this._editor
  }

  /** 在 Vue 子组件销毁前解除绑定，防止旧编辑器继续接收事件。 */
  detachEditor(editor) {
    if (!editor || this._editor === editor) { this._unbindAutoVersion(this._editor); this._editor = null; this._documentAccess = null; this._currentVersion = null; this._pendingLocalRestore = null }
    this.emit('editor', null)
  }

  /** 返回当前编辑器实例；宿主不应跨 Session 缓存该引用。 */
  getEditor() { return this._editor }

  /** 给一次 ProseMirror dispatch 写入来源、请求和基线修订信息。 */
  dispatch(transaction, metadata = {}) {
    if (this._identityRequired && !this.can('canEdit')) throw this._identityError()
    if (!this._editor || !this._editor.view) throw new Error('DocumentSession 尚未绑定编辑器')
    const next = setTransactionMetadata(transaction, metadata)
    this._editor.view.dispatch(next)
    return next
  }

  /** 以当前编辑器正文生成可保存的版本化记录。 */
  getDocumentRecord(extra = {}) {
    if (this._identityRequired && !this.can('canView')) throw this._identityError()
    const editor = this._editor
    if (!extra.content && editor?.storage?.larkDoc?.pagedImport) throw new Error('导入提交中，暂不可读取部分正文')
    return createDocumentRecord({
      documentId: this.documentId,
      // 内部 ProseMirror 文档恒为扁平模型；记录出口统一聚合为 v2 容器形态
      // （与组件 getJSON 同口径，避免「标 v2 写 v1」）。
      content: extra.content || (editor && editor.getJSON ? aggregateHeadingContainers(restoreUnknownBlocks(editor.getJSON())) : undefined),
      title: extra.title === undefined ? this._documentAccess?.getTitle?.() : extra.title,
      revisionId: extra.revisionId,
      schemaVersion: extra.schemaVersion,
      updatedAt: extra.updatedAt,
    })
  }

  /** 仅 collaborative 模式连接宿主提供的协同适配器。 */
  async connect() {
    if (this._destroyed) throw new Error('DocumentSession 已销毁')
    const provider = this.providers.collaboration, generation = this._identityGeneration
    if (this.mode !== 'collaborative' || !provider) return { status: 'local' }
    if (!this._identityRequired) return this._connectCollaborationProvider(provider, generation)
    this._assertIdentity(generation)
    // A provider-wide disconnect cannot retire one handshake while another is in flight.
    const connections = this._collaborationConnections ||= new WeakMap()
    const connect = () => this._connectCollaborationProvider(provider, generation)
    const pending = (connections.get(provider) || Promise.resolve()).then(connect, connect)
    connections.set(provider, pending)
    try { return await pending }
    finally { if (connections.get(provider) === pending) connections.delete(provider) }
  }

  async _connectCollaborationProvider(provider, generation) {
    if (this._identityRequired) {
      this._assertIdentity(generation)
      await this._identityDisconnect
      if (this._collaborationRetirement?.has(provider)) await this._retireCollaborationProvider(provider)
      this._assertIdentity(generation)
      if (provider !== this.providers.collaboration || !this.can('canView')) throw this._identityError()
    }
    try {
      const result = await this._identityAction(() => provider.connect({ documentId: this.documentId, user: this.user, session: this }), generation)
      this._assertIdentity(generation)
      if (this._identityRequired && !this.can('canView')) throw this._identityError()
      this._emitIdentityBound('connection', result || { status: 'connected' }, generation); this._assertIdentity(generation)
      return result
    } catch (error) {
      if (this._identityRequired && (!this._identityCurrent(generation) || !this.can('canView'))) {
        await this._retireCollaborationProvider(provider)
        throw this._identityError()
      }
      throw error
    }
  }

  async _retireCollaborationProvider(provider) {
    try {
      await provider.disconnect({ documentId: this.documentId, session: this })
      this._collaborationRetirement?.delete(provider)
    } catch (_) {
      (this._collaborationRetirement ||= new WeakSet()).add(provider)
      throw this._identityError()
    }
  }

  /** 断开协同连接；本地模式安全地执行空操作。 */
  async disconnect() {
    const provider = this.providers.collaboration
    if (!provider || typeof provider.disconnect !== 'function') return
    const generation = this._identityGeneration
    await provider.disconnect({ documentId: this.documentId, session: this })
    if (!this._identityRequired || this._identityCurrent(generation)) this.emit('connection', { status: 'disconnected' })
  }

  /** 订阅会话事件并返回可重复调用的取消订阅函数。 */
  on(event, listener) {
    if (typeof listener !== 'function') return () => {}
    const listeners = this._listeners.get(event) || new Set()
    listeners.add(listener)
    this._listeners.set(event, listeners)
    return () => listeners.delete(listener)
  }

  /** 向宿主广播编辑器、能力和连接状态变化。 */
  emit(event, value) {
    const listeners = this._listeners.get(event)
    // 本轮只遍历已有监听；同步解绑再订阅不能让新回调进入同一轮广播。
    if (listeners) Array.from(listeners).forEach(listener => { if (listeners.has(listener)) listener(value) })
  }

  /** 自动历史版本的总闸；关掉只停「自动」这一层，显式 `createVersion()` 仍可用。 */
  /** 自动历史版本的开关。读侧是访问器，必须留在类里：`Object.assign` 复制的是取值结果。 */
  get autoVersion() { return this._autoVersionEnabled }

  /** 按连接、编辑器、监听器顺序释放会话资源。 */
  async dispose() {
    this._retiredCommentProviders.forEach(provider => provider.reset?.('disposed'))
    this._retiredCommentProviders.clear()
    if (this._destroyed) return
    this._destroyed = true
    this._documentAccess = null
    this._currentVersion = null
    this._pendingLocalRestore = null
    if (this._identityRequired) {
      this._identityGeneration++; this._identityStop?.(); this._identityStop = null; this.providers.identity?.dispose?.()
      this._capabilities = { ...DENIED_CAPABILITIES }; this._identityState = null; this._user = null; this._resourceOperations.clear()
      this.emit('capabilities', this.getCapabilities()); this.emit('notifications-identity', null)
    }
    this.providers.comments?.dispose?.(); this.providers.authorization?.dispose?.()
    this._commentGeneration++; this.emit('comments-reset', 'disposed')
    this._authorizationGeneration++
    this._assetGeneration++
    this._notificationSubscriptions.forEach(stop => stop())
    this.providers.documentBusiness?.reset('disposed')
    // notifications Provider 由宿主拥有；Session 销毁只解除本层订阅，不接管其资源生命周期。
    if (typeof this.providers.assets?.dispose === 'function') this.providers.assets.dispose()
    else this.providers.assets?.reset?.('disposed')
    if (typeof this.providers.versioning?.dispose === 'function') this.providers.versioning.dispose()
    else this._resetVersions('disposed')
    await this.disconnect()
    this._unbindAutoVersion(this._editor)
    this._editor = null
    this._listeners.clear()
  }

  get transactionOrigins() { return TRANSACTION_ORIGINS }
}

// 方法域按对象字面量并回原型：方法体、执行顺序与 `this` 绑定都没有变化。
Object.assign(DocumentSession.prototype,
  identityMethods,
  versionMethods,
  assetMethods,
  commentMethods,
  permissionMethods,
  notificationMethods,
  resourceMethods,
)

export { AUTO_VERSION_INTERVAL_MS } from './sessionVersionMethods'

export function createDocumentSession(options) {
  return new DocumentSession(options)
}
