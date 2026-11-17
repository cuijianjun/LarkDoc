// 延迟加载的文档信息端口：沿用授权传输，提交不明只核对原操作。
export function createDocumentInformationPort(context) {
  const { tenantId, docId, send, tenantUrl, requireCapability, operationId, error, contextChanged, decimal, digest, nextRevision } = context
  const records = new Map(), recovery = new Map(), retired = new Set()
  let knownGeneration = '0', likeRevision = '0', informationRevision = '0'
  const invalid = () => error('DOCUMENT_INFORMATION_INVALID')
  const id = value => typeof value === 'string' && value.length > 0 && value.length <= 256
  const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
  const compare = (a, b) => a.length === b.length ? (a < b ? -1 : a === b ? 0 : 1) : a.length < b.length ? -1 : 1
  const categories = ['all', 'share', 'duplicate', 'download', 'settings']
  function fresh(value) {
    if (!value || !decimal(value.privacyGeneration)) throw invalid()
    if (compare(value.privacyGeneration, knownGeneration) < 0) throw error('DOCUMENT_INFORMATION_STALE')
    knownGeneration = value.privacyGeneration
    return value
  }
  function snapshot(kind, value, historical = false) {
    if (!value || value.tenantId !== tenantId || (kind !== 'privacy' && value.docId !== docId)) throw invalid()
    if (kind === 'likes') {
      if (!decimal(value.revision) || !decimal(value.total) || typeof value.liked !== 'boolean' || value.liked && value.total === '0') throw invalid()
      if (compare(value.revision, likeRevision) < 0) { if (historical) return value; throw error('DOCUMENT_INFORMATION_STALE') }
      likeRevision = value.revision; return value
    }
    if (kind === 'privacy' && (!id(value.principalId) || !decimal(value.revision) || typeof value.showVisitRecords !== 'boolean' || typeof value.showVisitAvatars !== 'boolean')) throw invalid()
    if (['visits', 'operations'].includes(kind) && (!Array.isArray(value.items) || value.items.length > 100 || typeof value.truncated !== 'boolean' ||
      (value.coverageSince !== null && !date(value.coverageSince)) || value.items.some(row => !row || typeof row !== 'object' || (kind === 'visits' ? !id(row.principalId) || !date(row.lastVisitedAt) : !id(row.actorId) || !id(row.kind) || !date(row.occurredAt))))) throw invalid()
    if (kind === 'operations' && (value.category !== undefined || value.supportedCategories !== undefined) &&
      (!categories.includes(value.category) || !Array.isArray(value.supportedCategories) || !value.supportedCategories.includes('all') ||
        !value.supportedCategories.includes(value.category) || value.supportedCategories.some(item => !categories.includes(item)) || new Set(value.supportedCategories).size !== value.supportedCategories.length)) throw invalid()
    if (kind === 'operations' && value.category !== undefined && value.category !== 'all' &&
      value.items.some(row => row.kind !== ({ share: 'permissions', duplicate: 'duplicate', download: 'download', settings: 'sharing-settings' })[value.category])) throw invalid()
    if (kind === 'information' && ([value.ownerId, value.creatorId].some(item => item !== null && !id(item)) ||
      [value.createdAt, value.updatedAt].some(item => item !== null && !date(item)) || !value.interaction ||
      ['visitors', 'visits', 'todayVisits', 'comments'].some(key => !decimal(value.interaction[key])) || (value.interaction.likes !== null && !decimal(value.interaction.likes)) || !value.coverage || (value.interaction.likes !== null && value.coverage.likes !== 'current-document') ||
      (value.informationRevision !== undefined && !decimal(value.informationRevision)))) throw invalid()
    if (kind === 'information' && value.informationRevision !== undefined) {
      if (compare(value.informationRevision, informationRevision) < 0) throw error('DOCUMENT_INFORMATION_STALE')
    }
    if (historical) {
      if (!value || !decimal(value.privacyGeneration)) throw invalid()
      if (compare(value.privacyGeneration, knownGeneration) > 0) knownGeneration = value.privacyGeneration
    } else fresh(value)
    if (kind === 'information' && value.informationRevision !== undefined) informationRevision = value.informationRevision
    return value
  }
  const paths = { likes: 'document-likes', information: 'information', visits: 'visits', operations: 'operation-records', privacy: 'document-privacy' }
  function current(record) { if (records.get(record.operationId) !== record) throw contextChanged(record.operationId) }
  function pending(kind) { return [...records.values(), ...recovery.values()].find(record => record.kind === kind && ['pending', 'unknown'].includes(record.status)) }
  async function execute(record, querying) {
    current(record); requireCapability('canView')
    try {
      const result = querying ? await send(`operations/${encodeURIComponent(record.operationId)}?${new URLSearchParams({ commandType: record.kind === 'like' ? 'document-like' : record.kind === 'privacy' ? 'document-privacy' : 'document-visit', ...(record.requestHash ? { requestHash: record.requestHash } : {}) })}`, undefined, true, tenantUrl) :
        await send(record.kind === 'like' ? 'document-like-operations' : record.kind === 'privacy' ? 'document-privacy-operations' : 'visit-operations', record.body, true)
      current(record); requireCapability('canView')
      if (!querying && result.status >= 400 && result.status < 500) throw error(result.data?.code || 'DOCUMENT_INFORMATION_REJECTED', result.status)
      const wrapper = result.data, value = querying && record.kind !== 'like' ? wrapper?.result : wrapper
      if (wrapper?.status === 'unknown' && wrapper.operationId === record.operationId && wrapper.requestHash !== undefined) {
        if (!digest(wrapper.requestHash) || (record.requestHash && wrapper.requestHash !== record.requestHash)) throw invalid()
        record.requestHash = wrapper.requestHash
      }
      if (result.status !== 200 || wrapper?.status !== 'committed') throw error('DOCUMENT_INFORMATION_UNKNOWN', result.status)
      if (wrapper.operationId !== record.operationId || !digest(wrapper.requestHash) || (querying && wrapper.requestHash !== value?.requestHash) ||
        value?.operationId !== record.operationId || value.status !== 'committed' || typeof value.replayed !== 'boolean' ||
        (record.requestHash && value.requestHash !== record.requestHash)) throw invalid()
      if (record.kind === 'like') {
        if (value.committedRevision !== nextRevision(record.body.expectedRevision) || !decimal(value.like?.revision) || compare(value.like.revision, value.committedRevision) < 0 ||
          (value.like.revision === value.committedRevision && value.like.liked !== record.body.liked)) throw invalid()
        snapshot('likes', value.like, true)
      } else if (record.kind === 'privacy') {
        if (value.revision !== nextRevision(record.body.expectedRevision) || Object.keys(record.body.changes).some(key => value[key] !== record.body.changes[key])) throw invalid()
        snapshot('privacy', value, true)
      } else {
        if (value.tenantId !== tenantId || value.docId !== docId || !decimal(value.privacyGeneration) || typeof value.recorded !== 'boolean' ||
          !['recorded', 'privacy-disabled', 'owner-unavailable'].includes(value.reason) || value.recorded !== (value.reason === 'recorded') ||
          (value.recorded ? !date(value.visitedAt) : value.visitedAt !== null)) throw invalid()
        if (compare(value.privacyGeneration, knownGeneration) > 0) knownGeneration = value.privacyGeneration
      }
      record.requestHash = value.requestHash; record.status = 'committed'; recovery.delete(record.operationId)
      return value
    } catch (cause) {
      current(record)
      const httpStatus = cause.status
      record.status = !querying && httpStatus >= 400 && httpStatus < 500 ? 'rejected' : 'unknown'
      throw Object.assign(cause, { operationId: record.operationId, httpStatus, status: record.status })
    }
  }
  return {
    async read(input) {
      requireCapability('canView')
      const object = input && typeof input === 'object' && !Array.isArray(input)
      if (!object && typeof input !== 'string' || object && (Object.keys(input).length !== 2 || Object.keys(input).some(key => !['kind', 'category'].includes(key)) || input.kind !== 'operations' || !categories.includes(input.category))) throw invalid()
      const kind = object ? input.kind : input, category = object ? input.category : kind === 'operations' ? 'all' : null
      if (!Object.prototype.hasOwnProperty.call(paths, kind)) throw invalid()
      const path = paths[kind] + (object && category ? '?category=' + encodeURIComponent(category) : kind === 'information' ? '?timeZone=' + encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC') : '')
      const value = await send(path); requireCapability('canView')
      if (kind === 'operations' && category && value?.category !== undefined && value.category !== category) throw invalid()
      return snapshot(kind, value)
    },
    request(input) {
      requireCapability('canView')
      const kind = input?.kind
      if (!['privacy', 'visit', 'like'].includes(kind)) throw invalid()
      const unresolved = pending(kind)
      if (unresolved && input.operationId !== unresolved.operationId) throw Object.assign(error('DOCUMENT_INFORMATION_QUERY_REQUIRED', 'unknown'), { operationId: unresolved.operationId })
      const id = input.operationId === undefined ? operationId(`document-${kind}`) : input.operationId
      if (typeof id !== 'string' || !id || id.includes('\0')) throw invalid()
      if (retired.has(id)) throw contextChanged(id)
      const body = { operationId: id }
      if (kind === 'like') {
        if (!decimal(input.expectedRevision) || typeof input.liked !== 'boolean') throw invalid()
        body.expectedRevision = input.expectedRevision; body.liked = input.liked
      } else if (kind === 'privacy') {
        if (!decimal(input.expectedRevision) || !input.changes || typeof input.changes !== 'object' || Array.isArray(input.changes) || !Object.keys(input.changes).length ||
          Object.keys(input.changes).some(key => !['showVisitRecords', 'showVisitAvatars'].includes(key) || typeof input.changes[key] !== 'boolean')) throw invalid()
        body.expectedRevision = input.expectedRevision
        body.changes = Object.fromEntries(['showVisitRecords', 'showVisitAvatars'].filter(key => Object.prototype.hasOwnProperty.call(input.changes, key)).map(key => [key, input.changes[key]]))
      }
      const previous = records.get(id) || recovery.get(id)
      if (previous) {
        if (previous.kind !== kind || JSON.stringify(body) !== JSON.stringify(previous.body)) throw error('IDEMPOTENCY_MISMATCH', 409)
        return this.query(id)
      }
      const record = { operationId: id, kind, body, status: 'pending', requestHash: null }
      records.set(id, record)
      return execute(record, false)
    },
    query(id) {
      let record = records.get(id) || recovery.get(id)
      if (!record) { if (retired.has(id)) throw contextChanged(id); throw error('DOCUMENT_INFORMATION_OPERATION_NOT_FOUND') }
      if (!records.has(id)) { record = { ...record }; records.set(id, record) }
      return execute(record, true)
    },
    operation(kind) {
      const value = pending(kind)
      return value ? { operationId: value.operationId, status: value.status, kind: value.kind } : null
    },
    canRecover: id => recovery.has(id),
    observeInformationRevision(value) { if (!decimal(value)) throw invalid(); if (compare(value, informationRevision) > 0) informationRevision = value },
    observeGeneration(value) { if (!decimal(value)) throw invalid(); if (compare(value, knownGeneration) > 0) knownGeneration = value },
    reset(reason) {
      const keep = reason === 'authorization-required'
      if (!keep) { recovery.forEach((_, id) => retired.add(id)); recovery.clear() }
      records.forEach((record, id) => {
        if (keep && ['pending', 'unknown', 'committed'].includes(record.status)) recovery.set(id, { ...record, status: record.status === 'committed' ? 'committed' : 'unknown' })
        else retired.add(id)
      }); records.clear()
    },
  }
}
