/**
 * 文档会话 —— 身份与能力域。
 *
 * 身份代际（generation）是这一层的核心：所有异步动作都带着发起时的代际走，回来时
 * 代际不符就当作「已经换人了」直接作废。能力（capability）永远跟随身份，身份一换
 * 就整片重置，因此两者放在同一个文件里读。
 */
import { isIdentityPrincipal } from '../providers/identity'
import { normalizeRemoteCapabilities } from '../providers/authorization'
import { DENIED_CAPABILITIES } from '../providers/authorization'

export const identityMethods = {
  _clearPrivateIdentityView(reason) {
    if (reason !== 'authorization-required') this._privateIdentityGeneration++
    this._retiredCommentProviders.forEach(provider => provider.reset?.(reason))
    if (reason !== 'authorization-required') this._retiredCommentProviders.clear()
    this._commentGeneration++; this.emit('comments-reset', reason)
    this._resetAssets(reason); this._resetVersions(reason)
    if (this.providers.notifications) { this.providers.notifications.reset?.(reason); if (reason !== 'authorization-required') this.emit('notifications-identity', null) }
    this._resourceOperations.clear(); if (reason !== 'authorization-required') this._notificationSubscriptions.forEach(stop => stop())
    this.providers.comments?.reset?.(reason); this.providers.authorization?.reset?.(reason); this.providers.resources?.reset?.(reason); if (reason !== 'authorization-required') this.providers.documentBusiness?.reset(reason)
  },

  _identityError() { return Object.assign(new Error('IDENTITY_CONTEXT_CHANGED'), { code: 'IDENTITY_CONTEXT_CHANGED', status: 'unknown' }) },

  _identityCurrent(generation = this._identityGeneration) {
    if (!this._identityRequired) return true
    const provider = this.providers.identity
    if (this._destroyed || !provider) return false
    let state
    try { state = provider.getState() } catch (_) { this._applyIdentity({ status: 'unknown' }, provider); return false }
    if (state?.status !== this._identityState?.status || state?.principalId !== this._identityState?.principalId || state?.generation !== this._identityState?.generation) this._applyIdentity(state, provider)
    return generation === this._identityGeneration && this._identityState?.status === 'authenticated'
  },

  _assertIdentity(generation) { if (this._identityRequired && !this._identityCurrent(generation)) throw this._identityError() },

  _identityAction(work, generation = this._identityGeneration) {
    if (!this._identityRequired) return work()
    this._assertIdentity(generation)
    return (async () => { try { const value = await work(); this._assertIdentity(generation); return value } catch (error) { this._assertIdentity(generation); throw error } })()
  },

  _emitIdentityBound(event, value, generation) {
    if (!this._identityRequired) return this.emit(event, value)
    const listeners = this._listeners.get(event)
    if (listeners) Array.from(listeners).forEach(listener => { if (listeners.has(listener) && this._identityCurrent(generation)) listener(value) })
  },

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
  },

  _bindIdentityProvider() {
    this._identityStop?.(); this._identityStop = null
    const provider = this.providers.identity
    this._identityRequired = true; this._applyIdentity({ status: 'unknown' }, provider, true)
    if (!provider) return
    this._identityStop = provider.subscribe(value => this._applyIdentity(value, provider))
    this._applyIdentity(provider.getState(), provider)
  },

  /** 返回副本，避免宿主直接修改 Session 内部权限状态。 */
  getCapabilities() { return { ...this._capabilities } },

  /** UI 只用能力控制交互，服务端仍是最终授权方。 */
  can(capability) { return !this._destroyed && this._identityCurrent() && this._capabilities[capability] === true },

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
}
