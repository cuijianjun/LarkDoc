/**
 * 文档会话 —— 资源绑定域。
 *
 * 绑定、查询、解绑、删除请求与操作轮询；`_resourceOutcome` 负责把「本地未知」的
 * 结果交给懒加载的判定模块收口，避免把不确定的成功当成成功。
 */


function resourceSnapshot(value) {
  const freeze = item => {
    if (item && typeof item === 'object') { Object.values(item).forEach(freeze); Object.freeze(item) }
    return item
  }
  return freeze(JSON.parse(JSON.stringify(value)))
}
const resourceKey = (operationId, commandType) => JSON.stringify([commandType, operationId])

export const resourceMethods = {
  _resourceProvider() {
    if (this._destroyed) throw new Error('DocumentSession 已销毁')
    if (this._identityRequired && !this.can('canView')) throw this._identityError()
    if (!this.providers.resources) throw new Error('未配置 resources Provider')
    if (!this.documentId) throw new Error('资源操作需要 documentId')
    return this.providers.resources
  },

  _recordResourceOperation(record) {
    const next = resourceSnapshot(record)
    this._resourceOperations.set(resourceKey(next.operationId, next.commandType), next)
    this._emitIdentityBound('resource-operation', next, this._identityGeneration)
    return next
  },

  /** 资源操作记录与协同正文 pending/receipt 分离，不更新编辑器或持久化状态。 */
  getResourceOperation(operationId, commandType) {
    if (this._identityRequired && !this.can('canView')) return null
    if (commandType) return this._resourceOperations.get(resourceKey(operationId, commandType)) || null
    const matches = Array.from(this._resourceOperations.values()).filter(record => record.operationId === operationId)
    if (matches.length > 1) throw new Error('RESOURCE_COMMAND_TYPE_REQUIRED')
    return matches[0] || null
  },

  _assertResourceCurrent(identity, authorization) {
    this._assertIdentity(identity)
    if (authorization !== this._authorizationGeneration || (this._identityRequired && !this.can('canView'))) throw this._identityError()
  },

  async _resourceOutcome(record, response, query, authorization) {
    const identity = this._identityGeneration
    const { resourceOutcome } = await import(/* webpackChunkName: "resource-outcome" */ './resourceOutcome')
    this._assertResourceCurrent(identity, authorization)
    return resourceOutcome.call(this, record, response, query)
  },

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
  },

  createOrBindResource(input = {}) {
    const request = { mode: input.mode, sourceSystem: input.sourceSystem, externalResourceId: input.externalResourceId,
      operationId: input.operationId }
    if (input.expectedRevision !== undefined) request.expectedRevision = input.expectedRevision
    if (input.grantIntent !== undefined) request.grantIntent = {
      subject: input.grantIntent.subject, scopes: input.grantIntent.scopes,
    }
    if (input.mode !== 'create' && input.mode !== 'bind') throw new Error('RESOURCE_MODE_REQUIRED')
    return this._resourceCommand('createOrBind', input.mode, request)
  },

  queryResourceBinding(input = {}) {
    const provider = this._resourceProvider(), query = { docId: this.documentId, sourceSystem: input.sourceSystem, externalResourceId: input.externalResourceId }
    return this._identityAction(() => provider.queryBinding(query))
  },

  unbindResource(bindingId, input = {}) {
    const request = { bindingId, expectedRevision: input.expectedRevision, operationId: input.operationId }
    if (input.sourceRevision !== undefined) request.sourceRevision = input.sourceRevision
    return this._resourceCommand('unbind', 'unbind', request)
  },

  /** 202只代表处置意图，绝不销毁正文或宣称物理删除成功。 */
  requestResourceDeletion(bindingId, input = {}) {
    return this._resourceCommand('requestDeletion', 'deletion-intent', {
      bindingId, sourceRevision: input.sourceRevision, operationId: input.operationId,
    })
  },

  async queryResourceOperation(operationId, commandType) {
    const provider = this._resourceProvider(), identity = this._identityGeneration, authorization = this._authorizationGeneration
    const { queryResourceOperation } = await import(/* webpackChunkName: "resource-outcome" */ './resourceOutcome')
    this._assertResourceCurrent(identity, authorization)
    if (provider !== this.providers.resources) throw this._identityError()
    return queryResourceOperation.call(this, operationId, commandType, provider, identity, authorization)
  }
}
