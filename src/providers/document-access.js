// This port intentionally has no document.read gate: only the authenticated caller may request access.
export function createDocumentAccessPort(context) {
  const { tenantId, docId, send, requireIdentity, operationId, error, contextChanged, decimal, digest, nextRevision } = context
  const records = new Map(), recovery = new Map(), retired = new Set(), rows = new Map()
  let generation = 0
  const invalid = () => error('DOCUMENT_ACCESS_INVALID')
  const id = value => typeof value === 'string' && /^[A-Za-z0-9._-]{1,128}(?![\s\S])/.test(value)
  const text = value => typeof value === 'string' && value.length <= 500 && !value.includes('\0') && Array.from(value).every(char => char.length === 2 || char.charCodeAt(0) < 0xd800 || char.charCodeAt(0) > 0xdfff)
  const compare = (a, b) => a.length === b.length ? (a < b ? -1 : a === b ? 0 : 1) : a.length < b.length ? -1 : 1
  const exact = (value, keys) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) throw invalid()
  }
  function row(value, historical = false) {
    exact(value, ['requestId', 'requesterId', 'role', 'message', 'status', 'revision', 'createdAt', 'updatedAt', 'decidedBy', 'reason'])
    if (!id(value.requestId) || !id(value.requesterId) || !['reader', 'editor'].includes(value.role) || !text(value.message) || !text(value.reason) ||
      !['pending', 'approved', 'rejected', 'cancelled'].includes(value.status) || !decimal(value.revision) || value.revision === '0' ||
      ![value.createdAt, value.updatedAt].every(date => typeof date === 'string' && Number.isFinite(Date.parse(date))) ||
      (value.status === 'pending' ? value.decidedBy !== null : !id(value.decidedBy))) throw invalid()
    const previous = rows.get(value.requestId)
    if (previous && compare(value.revision, previous) < 0) { if (!historical) throw error('DOCUMENT_ACCESS_STALE'); return { ...value } }
    return { ...value }
  }
  function remember(value) {
    const previous = rows.get(value.requestId)
    if (!previous || compare(value.revision, previous) >= 0) rows.set(value.requestId, value.revision)
  }
  function body(input, key) {
    const kind = input.kind, fields = kind === 'request' ? ['kind', 'operationId', 'expectedRevision', 'role', 'message'] : ['kind', 'operationId', 'expectedRevision', 'requestId', 'reason']
    if (Object.keys(input).some(field => !fields.includes(field)) || !id(key) || !decimal(input.expectedRevision) || !['request', 'approve', 'reject', 'cancel'].includes(kind)) throw invalid()
    if (kind === 'request') {
      if (input.expectedRevision !== '0' || !['reader', 'editor'].includes(input.role) || input.message !== undefined && !text(input.message)) throw invalid()
      return Object.freeze({ operationId: key, kind, expectedRevision: input.expectedRevision, role: input.role, message: input.message === undefined ? '' : input.message })
    }
    if (!id(input.requestId) || input.reason !== undefined && !text(input.reason)) throw invalid()
    return Object.freeze({ operationId: key, kind, expectedRevision: input.expectedRevision, requestId: input.requestId, reason: input.reason === undefined ? '' : input.reason })
  }
  const pending = () => [...records.values(), ...recovery.values()].find(record => ['pending', 'unknown'].includes(record.status))
  const check = record => { if (records.get(record.operationId) !== record) throw contextChanged(record.operationId); requireIdentity() }
  async function execute(record, querying) {
    check(record)
    try {
      const path = `access-request-operations/${encodeURIComponent(record.operationId)}${record.requestHash ? '?requestHash=' + encodeURIComponent(record.requestHash) : ''}`
      const { status, data } = querying ? await send(path, undefined, true) : await send('access-request-operations', record.body, true)
      check(record)
      if (!querying && status >= 400 && status < 500) throw error(data?.code || 'DOCUMENT_ACCESS_REJECTED', status)
      if (data?.status === 'unknown' && data.operationId === record.operationId && data.requestHash !== undefined) {
        if (!digest(data.requestHash) || record.requestHash && record.requestHash !== data.requestHash) throw invalid()
        record.requestHash = data.requestHash
      }
      if (status !== 200 || data?.status !== 'committed') throw error('DOCUMENT_ACCESS_UNKNOWN', status)
      exact(data, ['tenantId', 'docId', 'status', 'operationId', 'requestHash', 'kind', 'committedRevision', 'request', 'granted', 'replayed', 'deduplicated'])
      if (data.tenantId !== tenantId || data.docId !== docId || data.operationId !== record.operationId || data.kind !== record.body.kind || !digest(data.requestHash) || record.requestHash && record.requestHash !== data.requestHash ||
        !decimal(data.committedRevision) || data.committedRevision === '0' || typeof data.replayed !== 'boolean' || typeof data.deduplicated !== 'boolean' ||
        typeof data.granted !== 'boolean' || data.granted !== (data.kind === 'approve') || data.deduplicated && data.kind !== 'request') throw invalid()
      const request = row(data.request, true)
      if (compare(request.revision, data.committedRevision) < 0 || (data.kind === 'request' ? request.role !== record.body.role || request.message !== record.body.message || !data.deduplicated && data.committedRevision !== '1' :
        request.requestId !== record.body.requestId || data.committedRevision !== nextRevision(record.body.expectedRevision))) throw invalid()
      const expectedStatus = { request: 'pending', approve: 'approved', reject: 'rejected', cancel: 'cancelled' }[data.kind]
      if (request.revision === data.committedRevision && request.status !== expectedStatus) throw invalid()
      remember(request); record.requestHash = data.requestHash; record.status = 'committed'; recovery.delete(record.operationId)
      return { ...data, request }
    } catch (cause) {
      check(record)
      const httpStatus = cause.status
      record.status = !querying && httpStatus >= 400 && httpStatus < 500 ? 'rejected' : 'unknown'
      throw Object.assign(cause, { operationId: record.operationId, httpStatus, status: record.status })
    }
  }
  return {
    async list(scope = 'self') {
      requireIdentity(); if (!['self', 'pending'].includes(scope)) throw invalid(); const epoch = generation
      const data = await send('access-requests?scope=' + scope)
      requireIdentity(); if (epoch !== generation) throw contextChanged()
      exact(data, ['tenantId', 'docId', 'principalId', 'canRead', 'canReview', 'items'])
      if (data.tenantId !== tenantId || data.docId !== docId || !id(data.principalId) || typeof data.canRead !== 'boolean' || typeof data.canReview !== 'boolean' || data.canReview && !data.canRead ||
        !Array.isArray(data.items) || data.items.length > 100 || scope === 'pending' && !data.canReview) throw invalid()
      const seen = new Set(), items = data.items.map(value => {
        const item = row(value)
        if (seen.has(item.requestId) || scope === 'self' && item.requesterId !== data.principalId || scope === 'pending' && item.status !== 'pending') throw invalid()
        seen.add(item.requestId); return item
      })
      items.forEach(remember)
      return { ...data, items }
    },
    request(input = {}) {
      requireIdentity(); if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid()
      const unresolved = pending()
      if (unresolved && input.operationId !== unresolved.operationId) throw Object.assign(error('DOCUMENT_ACCESS_QUERY_REQUIRED', 'unknown'), { operationId: unresolved.operationId })
      const key = input.operationId === undefined ? operationId('access-request') : input.operationId
      if (retired.has(key)) throw contextChanged(key)
      const request = body(input, key), previous = records.get(key) || recovery.get(key)
      if (previous) {
        if (JSON.stringify(previous.body) !== JSON.stringify(request)) throw error('IDEMPOTENCY_MISMATCH', 409)
        return this.query(key)
      }
      const record = { operationId: key, body: request, requestHash: null, status: 'pending' }; records.set(key, record)
      return execute(record, false)
    },
    query(key) {
      requireIdentity(); let record = records.get(key) || recovery.get(key)
      if (!record) { if (retired.has(key)) throw contextChanged(key); throw error('DOCUMENT_ACCESS_OPERATION_NOT_FOUND') }
      if (!records.has(key)) { record = { ...record }; records.set(key, record) }
      return execute(record, true)
    },
    operation() { const record = pending(); return record ? { operationId: record.operationId, kind: record.body.kind, status: record.status, requestHash: record.requestHash } : null },
    canRecover: key => recovery.has(key),
    reset(reason) {
      generation++; const keep = reason === 'authorization-required'
      if (!keep) { recovery.forEach((_, key) => retired.add(key)); recovery.clear(); rows.clear() }
      records.forEach((record, key) => { if (keep && ['pending', 'unknown', 'committed'].includes(record.status)) recovery.set(key, { ...record, status: record.status === 'committed' ? 'committed' : 'unknown' }); else retired.add(key) })
      records.clear()
    },
  }
}
