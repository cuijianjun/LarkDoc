// Optional Java resource result validation; unchanged original-key and response semantics.
export function resourceOutcome(record, response, query) {
    const data = response && response.data
    const httpStatus = response && response.httpStatus
    const current = this.getResourceOperation(record.operationId, record.commandType)
    const knownHash = (current && current.requestHash) || record.requestHash
    const invalid = () => this._recordResourceOperation({ ...record, requestHash: knownHash,
      status: 'unknown', code: 'RESOURCE_INVALID_RESPONSE', result: null })
    if (!data || typeof data !== 'object' || Array.isArray(data) || !Number.isInteger(httpStatus) ||
      (data.operationId !== undefined && data.operationId !== record.operationId) ||
      (data.commandType !== undefined && data.commandType !== record.commandType)) return invalid()
    if (httpStatus < 200 || httpStatus >= 300) {
      return this._recordResourceOperation({ ...record, requestHash: knownHash, httpStatus,
        status: httpStatus >= 400 && httpStatus < 500 && !query ? 'rejected' : 'unknown', code: data.code || null, result: null })
    }
    if (data.operationId !== record.operationId || data.commandType !== record.commandType) return invalid()
    if (data.status === 'unknown' || data.status === 'pending') {
      if (knownHash && data.requestHash !== undefined && data.requestHash !== knownHash) return invalid()
      return this._recordResourceOperation({ ...record, requestHash: knownHash, status: data.status, httpStatus, code: data.code || null, result: null })
    }
    const result = query ? data.result : data
    const expectedStatus = { create: 'bound', bind: 'bound', unbind: 'unbound', 'deletion-intent': 'deleted' }[record.commandType]
    const expectedHttp = record.commandType === 'create' ? 201 : record.commandType === 'deletion-intent' ? 202 : 200
    const docId = record.request ? record.request.docId : this.documentId
    const hash = /^sha256:[0-9a-f]{64}$/
    const integer = value => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)
    if (!result || typeof result !== 'object' || Array.isArray(result) || result.operationId !== record.operationId ||
      result.commandType !== record.commandType || result.docId !== docId || typeof result.requestHash !== 'string' ||
      !hash.test(result.requestHash) || (knownHash && result.requestHash !== knownHash) || result.physicalDelete !== false ||
      result.status !== expectedStatus || result.httpStatus !== expectedHttp || typeof result.bindingId !== 'string' || !result.bindingId ||
      typeof result.sourceSystem !== 'string' || !result.sourceSystem || typeof result.externalResourceId !== 'string' || !result.externalResourceId ||
      ![result.bindingRevision, result.sourceRevision, result.authzVersion].every(integer)) return invalid()
    if (record.request && ((record.request.bindingId && result.bindingId !== record.request.bindingId) ||
      (record.request.sourceSystem && result.sourceSystem !== record.request.sourceSystem) ||
      (record.request.externalResourceId && result.externalResourceId !== record.request.externalResourceId))) return invalid()
    if (query ? httpStatus !== 200 || data.status !== 'committed' || data.requestHash !== result.requestHash : httpStatus !== expectedHttp) return invalid()
    return this._recordResourceOperation({ ...record, httpStatus, code: data.code || null,
      status: !query && httpStatus === 202 ? 'pending' : 'committed', requestHash: result.requestHash, result })
  }

// Original-key recovery is optional and never writes a business command.
export async function queryResourceOperation(operationId, commandType, provider, identityGeneration, authorization) {
    this._assertResourceCurrent(identityGeneration, authorization)
    const prior = this.getResourceOperation(operationId, commandType)
    const type = prior ? prior.commandType : commandType
    if (typeof operationId !== 'string' || !operationId || !['create', 'bind', 'unbind', 'deletion-intent'].includes(type)) throw new Error('RESOURCE_ORIGINAL_KEY_REQUIRED')
    const record = prior || { operationId, commandType: type, request: null,
      status: 'unknown', httpStatus: null, code: null, requestHash: null, result: null }
    const query = { docId: this.documentId, operationId, commandType: type }
    if (record.requestHash) query.requestHash = record.requestHash
    try {
      const response = await this._identityAction(() => provider.queryOperation(query), identityGeneration); this._assertResourceCurrent(identityGeneration, authorization)
      const result = await this._resourceOutcome(record, response, true, authorization); this._assertResourceCurrent(identityGeneration, authorization); return result
    } catch { this._assertResourceCurrent(identityGeneration, authorization); return this._recordResourceOperation({ ...record, status: 'unknown', code: 'RESOURCE_QUERY_UNKNOWN', result: null }) }
  }
