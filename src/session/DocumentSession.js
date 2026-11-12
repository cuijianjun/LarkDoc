import { isIdentityPrincipal } from '../providers/identity'
import { createDocumentRecord } from '../core/documentSchema'
import { aggregateHeadingContainers, restoreUnknownBlocks } from '../core/documentOperations'
import { setTransactionMetadata, TRANSACTION_ORIGINS } from '../core/transactionMetadata'
import { createAuthorizationProvider, normalizeCapabilities, normalizeRemoteCapabilities, DENIED_CAPABILITIES } from '../providers/authorization'
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

function resourceSnapshot(value) {
  const freeze = item => {
    if (item && typeof item === 'object') { Object.values(item).forEach(freeze); Object.freeze(item) }
    return item
  }
  return freeze(JSON.parse(JSON.stringify(value)))
}
const resourceKey = (operationId, commandType) => JSON.stringify([commandType, operationId])

/**
 * 单文档会话。编辑器和工作台只依赖这层，Provider 可以在本地模式或未来的
 * 协同、版本、评论和权限服务之间替换，而不改变 Vue 组件 API。
 */
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

  _clearPrivateIdentityView(reason) {
    if (reason !== 'authorization-required') this._privateIdentityGeneration++
    this._retiredCommentProviders.forEach(provider => provider.reset?.(reason))
    if (reason !== 'authorization-required') this._retiredCommentProviders.clear()
    this._commentGeneration++; this.emit('comments-reset', reason)
    this._resetAssets(reason); this._resetVersions(reason)
    if (this.providers.notifications) { this.providers.notifications.reset?.(reason); if (reason !== 'authorization-required') this.emit('notifications-identity', null) }
    this._resourceOperations.clear(); if (reason !== 'authorization-required') this._notificationSubscriptions.forEach(stop => stop())
    this.providers.comments?.reset?.(reason); this.providers.authorization?.reset?.(reason); this.providers.resources?.reset?.(reason); if (reason !== 'authorization-required') this.providers.documentBusiness?.reset(reason)
  }
  _identityError() { return Object.assign(new Error('IDENTITY_CONTEXT_CHANGED'), { code: 'IDENTITY_CONTEXT_CHANGED', status: 'unknown' }) }
  _identityCurrent(generation = this._identityGeneration) {
    if (!this._identityRequired) return true
    const provider = this.providers.identity
    if (this._destroyed || !provider) return false
    let state
    try { state = provider.getState() } catch (_) { this._applyIdentity({ status: 'unknown' }, provider); return false }
    if (state?.status !== this._identityState?.status || state?.principalId !== this._identityState?.principalId || state?.generation !== this._identityState?.generation) this._applyIdentity(state, provider)
    return generation === this._identityGeneration && this._identityState?.status === 'authenticated'
  }
  _assertIdentity(generation) { if (this._identityRequired && !this._identityCurrent(generation)) throw this._identityError() }
  _identityAction(work, generation = this._identityGeneration) {
    if (!this._identityRequired) return work()
    this._assertIdentity(generation)
    return (async () => { try { const value = await work(); this._assertIdentity(generation); return value } catch (error) { this._assertIdentity(generation); throw error } })()
  }
  _emitIdentityBound(event, value, generation) {
    if (!this._identityRequired) return this.emit(event, value)
    const listeners = this._listeners.get(event)
    if (listeners) Array.from(listeners).forEach(listener => { if (listeners.has(listener) && this._identityCurrent(generation)) listener(value) })
  }
  _applyIdentity(value, provider, force = false) {
    if (this._destroyed || provider !== this.providers.identity) return
    const authenticated = value?.status === 'authenticated' && isIdentityPrincipal(value.principalId) &&
      value.canCreate === false && Number.isFinite(value.expiresInMs) && value.expiresInMs > 0 && value.expiresInMs <= 4000
    const next = { status: authenticated ? 'authenticated' : ['idle', 'authenticating', 'unknown', 'denied', 'signed-out', 'signing-out', 'disposed'].includes(value?.status) ? value.status : 'unknown',
      principalId: authenticated ? value.principalId : null, generation: value?.generation }
    const prior = this._identityState; this._identityState = Object.freeze(next)
    if (!force && prior && prior.status === next.status && prior.principalId === next.principalId && prior.generation === next.generation) return
    const generation = ++this._identityGeneration; this._authorizationGeneration++; this._capabilities = { ...DENIED_CAPABILITIES }
    const priorId = this.user && this.user.id
    this._identityUpdating = true
    try { this.user = authenticated ? Object.freeze({ id: next.principalId }) : null }
    finally { this._identityUpdating = false }
    if (priorId === next.principalId) {
      // 连续认证的同主体凭据轮换仍须复权；未知、登出和主体切换继续退休旧操作。
      const renewed = !force && authenticated && prior?.status === 'authenticated'
      this._clearPrivateIdentityView(renewed ? 'authorization-required' : 'identity-changed')
    }
    this.emit('capabilities', this.getCapabilities()); this.emit('identity', this._identityState)
    if (generation !== this._identityGeneration) return
    const collaboration = this.providers.collaboration
    try { this._identityDisconnect = Promise.resolve(collaboration?.disconnect?.({ documentId: this.documentId, session: this })).catch(() => { throw this._identityError() }) }
    catch (_) { this._identityDisconnect = Promise.reject(this._identityError()) }
    this._identityDisconnect.catch(() => {})
    if (authenticated && this.providers.authorization) this._capabilitiesPromise = this.refreshCapabilities().catch(() => this.getCapabilities())
    else this._capabilitiesPromise = Promise.resolve(this.getCapabilities())
  }
  _bindIdentityProvider() {
    this._identityStop?.(); this._identityStop = null
    const provider = this.providers.identity
    this._identityRequired = true; this._applyIdentity({ status: 'unknown' }, provider, true)
    if (!provider) return
    this._identityStop = provider.subscribe(value => this._applyIdentity(value, provider))
    this._applyIdentity(provider.getState(), provider)
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

  /** 返回副本，避免宿主直接修改 Session 内部权限状态。 */
  getCapabilities() { return { ...this._capabilities } }

  /** UI 只用能力控制交互，服务端仍是最终授权方。 */
  can(capability) { return !this._destroyed && this._identityCurrent() && this._capabilities[capability] === true }

  async refreshCapabilities() {
    if (this._destroyed) throw new Error('DocumentSession 已销毁')
    const provider = this.providers.authorization
    const generation = ++this._authorizationGeneration, identityGeneration = this._identityGeneration
    const current = () => !this._destroyed && generation === this._authorizationGeneration && provider === this.providers.authorization && this._identityCurrent(identityGeneration)
    this._capabilities = { ...DENIED_CAPABILITIES }
    this._clearPrivateIdentityView('authorization-required')
    this.emit('capabilities', this.getCapabilities())
    try {
      if (this._identityRequired) { this._assertIdentity(identityGeneration); await this._identityDisconnect; this._assertIdentity(identityGeneration) }
      if (!provider) throw new Error('未配置 authorization Provider')
      const value = await this._identityAction(() => provider.getCapabilities({ documentId: this.documentId, user: this.user }), identityGeneration)
      if (!current()) { this._assertIdentity(identityGeneration); return this.getCapabilities() }
      if (value && (value.status === 'unknown' || value.status === 'revoked' || value.revoked === true)) throw new Error('AUTHORIZATION_UNKNOWN')
      this._capabilities = normalizeRemoteCapabilities(value)
      this._emitIdentityBound('capabilities', this.getCapabilities(), identityGeneration); this._assertIdentity(identityGeneration)
      if (this.can('canView')) this.providers.notifications?.resume?.()
      return this.getCapabilities()
    } catch (error) {
      this._assertIdentity(identityGeneration)
      if (current()) {
        this._capabilities = { ...DENIED_CAPABILITIES }
        this.emit('capabilities', this.getCapabilities())
        this._emitIdentityBound('error', error, identityGeneration)
      }
      throw error
    }
  }

  /** 绑定 Tiptap 实例，使记录、事务和版本操作共享同一正文。 */
  attachEditor(editor) {
    if (this._destroyed) throw new Error('DocumentSession 已销毁')
    this._editor = editor || null
    this.emit('editor', this._editor)
    return this._editor
  }

  /** 在 Vue 子组件销毁前解除绑定，防止旧编辑器继续接收事件。 */
  detachEditor(editor) {
    if (!editor || this._editor === editor) this._editor = null
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
    return createDocumentRecord({
      documentId: this.documentId,
      // 内部 ProseMirror 文档恒为扁平模型；记录出口统一聚合为 v2 容器形态
      // （与组件 getJSON 同口径，避免「标 v2 写 v1」）。
      content: extra.content || (editor && editor.getJSON ? aggregateHeadingContainers(restoreUnknownBlocks(editor.getJSON())) : undefined),
      title: extra.title,
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
    if (this._identityRequired) { this._assertIdentity(generation); await this._identityDisconnect; this._assertIdentity(generation); if (!this.can('canView')) throw this._identityError() }
    try {
      const result = await this._identityAction(() => provider.connect({ documentId: this.documentId, user: this.user, session: this }), generation)
      this._assertIdentity(generation)
      if (this._identityRequired && !this.can('canView')) throw this._identityError()
      this._emitIdentityBound('connection', result || { status: 'connected' }, generation); this._assertIdentity(generation)
      return result
    } catch (error) {
      if (this._identityRequired && (!this._identityCurrent(generation) || !this.can('canView'))) { try { await provider.disconnect({ documentId: this.documentId, session: this }) } catch (_) { /* Stale handshakes cannot supply an error to the new identity. */ } throw this._identityError() }
      throw error
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

  /** 通过版本 Provider 创建不可变快照。 */
  async createVersion(meta = {}) {
    if (!this.can('canCreateVersion')) throw new Error('当前用户没有创建版本的权限')
    const provider = this.providers.versioning
    if (!provider) throw new Error('未配置 versioning Provider')
    return this._identityAction(() => provider.createSnapshot({ ...this.getDocumentRecord(), ...meta }))
  }

  /** 请求恢复版本；Provider 应把恢复实现为新的 revision。 */
  async restoreVersion(versionId) {
    if (!this.can('canRestoreVersion')) throw new Error('当前用户没有恢复版本的权限')
    const provider = this.providers.versioning
    if (!provider) throw new Error('未配置 versioning Provider')
    return this._identityAction(() => provider.restore(versionId, { documentId: this.documentId }))
  }
  _conversionProvider(capability) {
    if (this._destroyed || !this.can(capability)) throw new Error('当前用户没有该版本或转换操作权限')
    const provider = this.providers.versioning
    if (!provider) throw new Error('未配置 versioning Provider')
    return provider
  }
  diffVersions(fromVersionId, toVersionId) { const provider = this._conversionProvider('canView'); return this._identityAction(() => provider.diff(fromVersionId, toVersionId)) }
  _resetVersions(reason) { this._conversionGeneration++; const port = this.providers.versioning; if (typeof port?.reset === 'function') port.reset(reason); else port?.resetConversions?.(reason) }
  async _conversionAction(method, input, capability) {
    const provider = this._conversionProvider(capability), generation = this._conversionGeneration
    const { sessionConversion } = await import('../utils/remoteConversion')
    return sessionConversion.call(this, method, input, capability, provider, generation)
  }
  requestImport(input) { return this._conversionAction('requestImport', input, 'canEdit') }
  requestExport(input) { return this._conversionAction('requestExport', input, 'canExport') }
  queryConversion(input) {
    return this._conversionAction('queryConversion', input, 'canView')
  }
  downloadConversion(input) { return this._conversionAction('downloadConversion', input, 'canExport') }
  getConversionOperation(id) { return this.can('canView') ? this.providers.versioning?.getConversionOperation?.(id) || null : null }
  _assetProvider(capability) {
    if (this._destroyed || !this.can(capability)) throw new Error('当前用户没有该附件操作权限')
    const provider = this.providers.assets
    if (!provider) throw new Error('内部对象存储尚未接通，未配置assets Provider')
    return provider
  }
  _resetAssets(reason) {
    this._assetGeneration++
    this._conversionGeneration++
    this.providers.assets?.reset?.(reason)
  }
  async _assetAction(method, input, capability) {
    const provider = this._assetProvider(capability), generation = this._assetGeneration, identityGeneration = this._identityGeneration
    if (this._identityRequired && typeof input?.onChunk === 'function') {
      const onChunk = input.onChunk
      input = { ...input, onChunk: (...args) => { this._assertIdentity(identityGeneration); if (generation !== this._assetGeneration || !this.can(capability)) throw this._identityError(); return onChunk(...args) } }
    }
    if (typeof provider[method] !== 'function') throw new Error(`assets Provider 不支持 ${method}`)
    const result = await this._identityAction(() => provider[method](input))
    if (this._destroyed || generation !== this._assetGeneration || provider !== this.providers.assets || !this.can(capability)) {
      throw Object.assign(new Error('ASSET_SESSION_CHANGED'), { code: 'ASSET_SESSION_CHANGED', status: 'unknown', retryable: false })
    }
    return result
  }
  uploadCommentImage(input) { return this._assetAction('uploadCommentImage', input, 'canComment') }
  uploadAssetFile(input) { return this._assetAction('upload', input, 'canEdit') }
  beginAssetUpload(input) { return this._assetAction('begin', input, 'canEdit') }
  completeAssetUpload(input) { return this._assetAction('complete', input, 'canEdit') }
  getAssetStatus(id) { return this._assetAction('getStatus', id, 'canView') }
  getAssetContent(input) { return this._assetAction('getContent', input, 'canView') }
  queryAssetOperation(input) { return this._assetAction('queryOperation', input, 'canView') }
  getAssetOperation(id) { return this.can('canView') ? this.providers.assets?.getOperation?.(id) || null : null }

  async _commentAction(method, input, capability = 'canComment') {
    if (this._destroyed) throw new Error('DocumentSession 已销毁')
    if (!this.can(capability)) throw new Error('当前用户没有评论操作权限')
    const provider = this.providers.comments
    if (!provider || typeof provider[method] !== 'function') throw new Error(`comments Provider 不支持 ${method}`)
    const translation = ['requestTranslation', 'queryTranslation'].includes(method), scoped = translation || this._identityRequired
    const identityGeneration = this._identityGeneration
    const generation = this._commentGeneration, authorization = this._authorizationGeneration, identity = this.user && this.user.id
    const operationId = typeof input === 'string' ? input : input && input.operationId
    const current = () => !this._destroyed && provider === this.providers.comments && this._identityCurrent(identityGeneration) && (!scoped ||
      generation === this._commentGeneration && authorization === this._authorizationGeneration && identity === (this.user && this.user.id) && this.can(capability))
    const invalidated = value => Object.assign(this._identityRequired && !this._identityCurrent(identityGeneration) ? this._identityError() : new Error('COMMENT_TRANSLATION_INVALIDATED'), { code: this._identityRequired && !this._identityCurrent(identityGeneration) ? 'IDENTITY_CONTEXT_CHANGED' : 'COMMENT_TRANSLATION_INVALIDATED', status: value && value.submitted === false ? 'rejected' : 'unknown', ...(value && typeof value.submitted === 'boolean' ? { submitted: value.submitted } : {}),
      operationId: value && value.operationId || operationId })
    const publish = (event, value) => {
      if (!scoped) { this.emit(event, value); return }
      const listeners = this._listeners.get(event)
      if (listeners) Array.from(listeners).forEach(listener => { if (listeners.has(listener) && current()) listener(value) })
    }
    let providerError
    try {
      // The identity guard can replace a rejection; retain only its recovery metadata below.
      const result = await this._identityAction(async () => {
        try { return await provider[method](input) }
        catch (error) { providerError = error; throw error }
      }, identityGeneration)
      if (scoped && !current()) throw invalidated(result)
      if (current()) publish('comments', result)
      if (scoped && !current()) throw invalidated(result)
      return result
    } catch (error) {
      if (scoped && !current()) throw invalidated(providerError || error)
      if (current()) publish('error', error)
      if (scoped && !current()) throw invalidated(providerError || error)
      throw error
    }
  }

  listComments() { return this._commentAction('list', { documentId: this.documentId }, 'canView') }
  getCommentThread(threadId) { return this._commentAction('getThread', threadId, 'canView') }
  createCommentThread(input) { return this._commentAction('createThread', input) }
  replyToComment(input) { return this._commentAction('reply', input) }
  editCommentReply(input) { return this._commentAction('editReply', input) }
  reactToComment(input) { return this._commentAction('react', input) }
  deleteCommentReply(input) { return this._commentAction('deleteReply', input) }
  resolveComment(threadId) { return this._commentAction('resolve', threadId, 'canResolveComment') }
  reopenComment(threadId) { return this._commentAction('reopen', threadId, 'canResolveComment') }
  setCommentParticipants(input) { return this._commentAction('setParticipants', input) }
  setCommentVisibility(input) { return this._commentAction('setVisibility', input) }
  queryCommentOperation(operationId) { return this._commentAction('queryOperation', operationId, 'canView') }
  getCommentOperation(operationId) {
    const provider = this.providers.comments
    return !this._destroyed && (!this._identityRequired || this.can('canView')) && provider && typeof provider.getOperation === 'function' ? provider.getOperation(operationId) : null
  }
  getCommentFollowPreference(threadId) { return this._commentAction('getFollowPreference', threadId, 'canView') }
  followComment(input) { return this._commentAction('follow', input, 'canView') }
  unfollowComment(input) { return this._commentAction('unfollow', input, 'canView') }
  muteComment(input) { return this._commentAction('setMuted', input, 'canView') }
  queryCommentFollowOperation(id) { return this._commentAction('queryFollowOperation', id, 'canView') }
  getCommentFollowOperation(id) {
    const provider = this.providers.comments
    return !this._destroyed && (!this._identityRequired || this.can('canView')) && provider && typeof provider.getFollowOperation === 'function' ? provider.getFollowOperation(id) : null
  }
  getCommentLinkTarget(threadId) { return this._commentAction('getLinkTarget', threadId, 'canView') }
  getCommentLink(threadId) { return this._commentAction('getLink', threadId, 'canView') }
  openCommentLink(value) { return this._commentAction('openLink', value, 'canView') }
  requestCommentTranslation(input) { return this._commentAction('requestTranslation', input, 'canView') }
  queryCommentTranslation(input) { return this._commentAction('queryTranslation', input, 'canView') }
  getCommentTranslationOperation(id) {
    const provider = this.providers.comments
    return !this._destroyed && (!this._identityRequired || this.can('canView')) && provider && typeof provider.getTranslationOperation === 'function' ? provider.getTranslationOperation(id) : null
  }

  async _authorizationAction(method, input, capability) {
    if (this._destroyed || !this.can(capability)) throw new Error('当前用户没有提及或分享操作权限')
    const provider = this.providers.authorization, generation = this._authorizationGeneration, identityGeneration = this._identityGeneration
    if (!provider || typeof provider[method] !== 'function') throw new Error(`authorization Provider 不支持 ${method}`)
    const current = () => !this._destroyed && generation === this._authorizationGeneration && provider === this.providers.authorization && (!this._identityRequired || this._identityCurrent(identityGeneration) && this.can(capability))
    try {
      const result = await this._identityAction(() => provider[method](input), identityGeneration)
      if (this._identityRequired && !current()) throw this._identityError()
      if (current()) this._emitIdentityBound('authorization-operation', { method, result }, identityGeneration)
      this._assertIdentity(identityGeneration); return result
    } catch (error) {
      this._assertIdentity(identityGeneration)
      if (current()) this._emitIdentityBound('error', error, identityGeneration)
      this._assertIdentity(identityGeneration); throw error
    }
  }
  resolveMentions(input) { return this._authorizationAction('resolveMentions', input, 'canView') }
  queryMentionResolution(input) { return this._authorizationAction('queryMentionResolution', input, 'canView') }
  getMentionOperation(id) { return (!this._identityRequired || this.can('canView')) ? this.providers.authorization?.getMentionOperation?.(id) || null : null }
  requestShare(input) { return this._authorizationAction('requestShare', input, 'canManagePermission') }
  listMembers() { return this._authorizationAction('listMembers', undefined, 'canManagePermission') }
  queryShareOperation(id) { return this._authorizationAction('queryShareOperation', id, 'canManagePermission') }
  getShareOperation(id) { return (!this._identityRequired || this.can('canView')) ? this.providers.authorization?.getShareOperation?.(id) || null : null }
  getShareLink() { return this._authorizationAction('getShareLink', undefined, 'canView') }

  _notifications() {
    if (this._destroyed) throw new Error('DocumentSession 已销毁')
    if (!this.can('canView')) throw new Error('当前用户没有通知读取权限')
    const provider = this.providers.notifications
    if (!provider) throw new Error('未配置 notifications Provider')
    return provider
  }
  refreshNotifications() { return this._identityAction(() => this._notifications().snapshot()) }
  loadMoreNotifications() { return this._identityAction(() => this._notifications().loadMore()) }
  markNotificationRead(input) { return this._identityAction(() => this._notifications().markRead(input)) }
  setNotificationsMuted(input) { return this._identityAction(() => this._notifications().setMuted(input)) }
  queryNotificationOperation(id) { return this._identityAction(() => this._notifications().queryOperation(id)) }
  getNotificationOperation(id) { return (!this._identityRequired || this.can('canView')) ? this.providers.notifications?.getOperation?.(id) || null : null }
  openNotificationThread(id) { return this._identityAction(() => this._notifications().openThread(id)) }
  subscribeNotifications(listener) {
    if (this._destroyed) throw new Error('DocumentSession 已销毁')
    if (typeof listener !== 'function') throw new TypeError('notifications listener必须是函数')
    const provider = this.providers.notifications, identityGeneration = this._identityGeneration
    if (!provider) throw new Error('未配置 notifications Provider')
    let active = true
    const unsubscribe = provider.subscribe(value => {
      if (!active || this._destroyed || provider !== this.providers.notifications || !this._identityCurrent(identityGeneration)) return
      if (value.resetRequired && (this._notificationResetProvider !== provider || this._notificationResetGeneration !== value.generation) && value.reason !== 'identity-changed') {
        this._notificationResetProvider = provider; this._notificationResetGeneration = value.generation
        this.emit('notifications-reset', { reason: value.reason })
      }
      listener(value)
    })
    const stop = () => { if (!active) return; active = false; unsubscribe(); this._notificationSubscriptions.delete(stop) }
    this._notificationSubscriptions.add(stop)
    return stop
  }

  _resourceProvider() {
    if (this._destroyed) throw new Error('DocumentSession 已销毁')
    if (this._identityRequired && !this.can('canView')) throw this._identityError()
    if (!this.providers.resources) throw new Error('未配置 resources Provider')
    if (!this.documentId) throw new Error('资源操作需要 documentId')
    return this.providers.resources
  }

  _recordResourceOperation(record) {
    const next = resourceSnapshot(record)
    this._resourceOperations.set(resourceKey(next.operationId, next.commandType), next)
    this._emitIdentityBound('resource-operation', next, this._identityGeneration)
    return next
  }

  /** 资源操作记录与协同正文 pending/receipt 分离，不更新编辑器或持久化状态。 */
  getResourceOperation(operationId, commandType) {
    if (this._identityRequired && !this.can('canView')) return null
    if (commandType) return this._resourceOperations.get(resourceKey(operationId, commandType)) || null
    const matches = Array.from(this._resourceOperations.values()).filter(record => record.operationId === operationId)
    if (matches.length > 1) throw new Error('RESOURCE_COMMAND_TYPE_REQUIRED')
    return matches[0] || null
  }

  _assertResourceCurrent(identity, authorization) {
    this._assertIdentity(identity)
    if (authorization !== this._authorizationGeneration || (this._identityRequired && !this.can('canView'))) throw this._identityError()
  }

  async _resourceOutcome(record, response, query, authorization) {
    const identity = this._identityGeneration
    const { resourceOutcome } = await import(/* webpackChunkName: "resource-outcome" */ './resourceOutcome')
    this._assertResourceCurrent(identity, authorization)
    return resourceOutcome.call(this, record, response, query)
  }

  async _resourceCommand(method, commandType, input) {
    const provider = this._resourceProvider(), identityGeneration = this._identityGeneration, authorization = this._authorizationGeneration
    if (typeof input.operationId !== 'string' || !input.operationId) throw new Error('RESOURCE_OPERATION_ID_REQUIRED')
    const request = resourceSnapshot({ ...input, docId: this.documentId })
    const prior = this.getResourceOperation(request.operationId, commandType)
    if (prior) {
      if (JSON.stringify(prior.request) !== JSON.stringify(request)) throw new Error('IDEMPOTENCY_MISMATCH')
      return prior // unknown只能显式查询，重复调用不得自动POST或生成新operationId。
    }
    this._assertResourceCurrent(identityGeneration, authorization)
    const record = this._recordResourceOperation({ operationId: request.operationId, commandType, request,
      status: 'pending', httpStatus: null, code: null, requestHash: null, result: null })
    try {
      this._assertResourceCurrent(identityGeneration, authorization)
      const response = await this._identityAction(() => provider[method](request), identityGeneration); this._assertResourceCurrent(identityGeneration, authorization)
      const result = await this._resourceOutcome(record, response, false, authorization); this._assertResourceCurrent(identityGeneration, authorization); return result
    } catch { this._assertResourceCurrent(identityGeneration, authorization); return this._recordResourceOperation({ ...record, status: 'unknown', code: 'RESOURCE_REQUEST_UNKNOWN' }) }
  }

  createOrBindResource(input = {}) {
    const request = { mode: input.mode, sourceSystem: input.sourceSystem, externalResourceId: input.externalResourceId,
      operationId: input.operationId }
    if (input.expectedRevision !== undefined) request.expectedRevision = input.expectedRevision
    if (input.grantIntent !== undefined) request.grantIntent = {
      subject: input.grantIntent.subject, scopes: input.grantIntent.scopes,
    }
    if (input.mode !== 'create' && input.mode !== 'bind') throw new Error('RESOURCE_MODE_REQUIRED')
    return this._resourceCommand('createOrBind', input.mode, request)
  }

  queryResourceBinding(input = {}) {
    const provider = this._resourceProvider(), query = { docId: this.documentId, sourceSystem: input.sourceSystem, externalResourceId: input.externalResourceId }
    return this._identityAction(() => provider.queryBinding(query))
  }

  unbindResource(bindingId, input = {}) {
    const request = { bindingId, expectedRevision: input.expectedRevision, operationId: input.operationId }
    if (input.sourceRevision !== undefined) request.sourceRevision = input.sourceRevision
    return this._resourceCommand('unbind', 'unbind', request)
  }

  /** 202只代表处置意图，绝不销毁正文或宣称物理删除成功。 */
  requestResourceDeletion(bindingId, input = {}) {
    return this._resourceCommand('requestDeletion', 'deletion-intent', {
      bindingId, sourceRevision: input.sourceRevision, operationId: input.operationId,
    })
  }

  async queryResourceOperation(operationId, commandType) {
    const provider = this._resourceProvider(), identity = this._identityGeneration, authorization = this._authorizationGeneration
    const { queryResourceOperation } = await import(/* webpackChunkName: "resource-outcome" */ './resourceOutcome')
    this._assertResourceCurrent(identity, authorization)
    if (provider !== this.providers.resources) throw this._identityError()
    return queryResourceOperation.call(this, operationId, commandType, provider, identity, authorization)
  }

  /** 按连接、编辑器、监听器顺序释放会话资源。 */
  async dispose() {
    this._retiredCommentProviders.forEach(provider => provider.reset?.('disposed'))
    this._retiredCommentProviders.clear()
    if (this._destroyed) return
    this._destroyed = true
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
    this._editor = null
    this._listeners.clear()
  }

  get transactionOrigins() { return TRANSACTION_ORIGINS }
}

export function createDocumentSession(options) {
  return new DocumentSession(options)
}
