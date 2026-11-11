/* 四项文档分享策略的延迟端口；网络、会话、超时与CSRF沿用authorization的send。 */
export function createSharingSettingsPort(context) {
  const { tenantId, docId, send, tenantUrl, requireCapability, operationId, error, contextChanged, decimal, digest, nextRevision } = context
  const fields = ['collaborators', 'copy', 'duplicate', 'comment', 'visitorAvatar']
  const codes = ['readers', 'editors', 'managers']
  const records = new Map(), recoverable = new Map(), retired = new Set()
  const invalid = () => error('SHARING_SETTINGS_INVALID')
  const pending = () => [...records.values(), ...recoverable.values()].find(value => ['pending', 'unknown'].includes(value.status))
  const queryRequired = record => Object.assign(error('SHARING_SETTINGS_QUERY_REQUIRED', 'unknown'), { operationId: record.operationId })

  function snapshot(raw) {
    if (!raw || raw.tenantId !== tenantId || raw.docId !== docId || !decimal(raw.settingsRevision) || !decimal(raw.authzVersion) ||
      typeof raw.canManage !== 'boolean' || !raw.values || !raw.supported) throw invalid()
    const values = {}, supported = {}
    fields.forEach(key => {
      if (key === 'visitorAvatar' && raw.supported[key] === undefined && raw.values[key] === undefined) return
      const allowed = raw.supported[key], known = key === 'comment' ? codes.slice(0, 2) : codes
      if (!Array.isArray(allowed) || !allowed.length || new Set(allowed).size !== allowed.length ||
        allowed.some(value => !known.includes(value)) || !allowed.includes(raw.values[key])) throw invalid()
      values[key] = raw.values[key]; supported[key] = allowed.slice()
    })
    return { tenantId, docId, settingsRevision: raw.settingsRevision, authzVersion: raw.authzVersion, values, supported, canManage: raw.canManage }
  }
  function current(record) {
    if (records.get(record.operationId) !== record) throw contextChanged(record.operationId)
  }
  function acknowledged(record, raw) {
    const result = snapshot(raw)
    if (raw.status !== 'committed' || raw.operationId !== record.operationId || !digest(raw.requestHash) ||
      (record.requestHash && record.requestHash !== raw.requestHash) || typeof raw.replayed !== 'boolean' ||
      result.settingsRevision !== nextRevision(record.body.expectedRevision) ||
      Object.keys(record.body.changes).some(key => result.values[key] !== record.body.changes[key])) throw invalid()
    record.status = 'committed'; record.requestHash = raw.requestHash; recoverable.delete(record.operationId)
    return { ...result, status: 'committed', operationId: raw.operationId, requestHash: raw.requestHash, replayed: raw.replayed }
  }
  async function execute(record, querying) {
    current(record)
    try {
      requireCapability('canManagePermission')
      const path = `operations/${encodeURIComponent(record.operationId)}?commandType=sharing-settings`
      const { data, status } = querying ? await send(path, undefined, true, tenantUrl) : await send('sharing-setting-operations', record.body, true)
      current(record)
      if (!querying && status >= 400 && status < 500) throw error(data?.code || 'SHARING_SETTINGS_REJECTED', status)
      if (status === 200 && data?.status === 'committed') {
        if (querying && (data.operationId !== record.operationId || !digest(data.requestHash) || data.requestHash !== data.result?.requestHash)) throw invalid()
        return acknowledged(record, querying ? data.result : data)
      }
      if (data?.status === 'unknown' && data.operationId === record.operationId && data.requestHash !== undefined) {
        if (!digest(data.requestHash) || (record.requestHash && record.requestHash !== data.requestHash)) throw invalid()
        record.requestHash = data.requestHash
      }
      throw error('SHARING_SETTINGS_UNKNOWN', status)
    } catch (cause) {
      if (records.get(record.operationId) !== record) throw contextChanged(record.operationId)
      const httpStatus = cause.status
      record.status = !querying && httpStatus >= 400 && httpStatus < 500 ? 'rejected' : 'unknown'
      throw Object.assign(cause, { operationId: record.operationId, httpStatus, status: record.status })
    }
  }
  return {
    async get() {
      requireCapability('canView')
      const unresolved = pending(); if (unresolved) throw queryRequired(unresolved)
      const result = await send('sharing-settings'); requireCapability('canView')
      return snapshot(result)
    },
    request(input = {}) {
      requireCapability('canManagePermission')
      const unresolved = pending()
      if (unresolved && input.operationId !== unresolved.operationId) throw queryRequired(unresolved)
      const id = input.operationId === undefined ? operationId('sharing-settings') : input.operationId
      if (typeof id !== 'string' || !id || id.includes('\0')) throw invalid()
      if (retired.has(id)) throw contextChanged(id)
      if (recoverable.has(id)) throw error('SHARING_SETTINGS_QUERY_REQUIRED', 409)
      const changes = input.changes
      if (!decimal(input.expectedRevision) || !changes || typeof changes !== 'object' || Array.isArray(changes) || !Object.keys(changes).length ||
        Object.keys(changes).some(key => !fields.includes(key) || !(key === 'comment' ? codes.slice(0, 2) : codes).includes(changes[key]))) throw invalid()
      const body = { operationId: id, expectedRevision: input.expectedRevision,
        changes: Object.fromEntries(fields.filter(key => Object.prototype.hasOwnProperty.call(changes, key)).map(key => [key, changes[key]])) }
      const prior = records.get(id)
      if (prior) {
        if (JSON.stringify(body) !== JSON.stringify(prior.body)) throw error('IDEMPOTENCY_MISMATCH', 409)
        return execute(prior, true)
      }
      const record = { operationId: id, body, requestHash: null, status: 'pending' }
      records.set(id, record)
      return execute(record, false)
    },
    query(id) {
      let record = records.get(id) || recoverable.get(id)
      if (!record) { if (retired.has(id)) throw contextChanged(id); throw error('SHARING_SETTINGS_OPERATION_NOT_FOUND') }
      if (!records.has(id)) { record = { ...record }; records.set(id, record) }
      return execute(record, true)
    },
    operation(id) {
      const record = id ? records.get(id) || recoverable.get(id) : pending()
      return record ? { operationId: record.operationId, status: record.status, requestHash: record.requestHash } : null
    },
    canRecover: id => recoverable.has(id),
    reset(reason) {
      const keep = reason === 'authorization-required'
      if (!keep) { recoverable.forEach((_, id) => retired.add(id)); recoverable.clear() }
      records.forEach((record, id) => {
        if (keep && ['pending', 'unknown', 'committed'].includes(record.status)) recoverable.set(id, { ...record, status: record.status === 'committed' ? 'committed' : 'unknown' })
        else retired.add(id)
      })
      records.clear()
    },
  }
}
