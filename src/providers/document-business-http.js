/* global globalThis, BigInt */
const id = value => typeof value === 'string' && /^[A-Za-z0-9._-]{1,128}(?![\s\S])/.test(value)
const decimal = value => typeof value === 'string' && /^(0|[1-9][0-9]*)(?![\s\S])/.test(value)
const fail = (code, extra = {}) => Object.assign(new Error(code), { code, ...extra })
const flags = ['canFollow', 'canFavorite', 'canMove', 'canDuplicate', 'canDelete', 'canRestore']
export function createHttpDocumentBusinessProvider(options = {}) {
  if (!id(options.tenantId) || !id(options.docId) || typeof options.csrfToken !== 'function') throw fail('BUSINESS_CONFIGURATION')
  const request = options.request || globalThis.fetch?.bind(globalThis)
  if (typeof request !== 'function') throw fail('BUSINESS_CONFIGURATION')
  const base = `${String(options.baseUrl || '').replace(/\/+$/, '')}/editor/v1/tenants/${encodeURIComponent(options.tenantId)}/documents/${encodeURIComponent(options.docId)}`
  let context = () => null, generation = 0, state = null, stateOwner = null, stream = null, reconnect = null, disposed = false, publication = 0
  const listeners = new Set(), requests = new Set(), operations = new Map(), retired = new Set()
  const owner = () => { const v = context(); return v?.authenticated && id(v.principalId) ? JSON.stringify([v.principalId, v.generation]) : null }
  const current = (key, epoch) => !disposed && key !== null && key === owner() && epoch === generation
  const emit = foldersChanged => { for (const listener of listeners) listener({ document: getState(), foldersChanged }) }
  const validate = value => {
    if (!value || value.tenantId !== options.tenantId || value.docId !== options.docId || !id(value.principalId) ||
      !['active', 'deleted'].includes(value.status) || ![value.revision, value.preferenceRevision, value.epoch, value.contentRevision].every(decimal) ||
      typeof value.followed !== 'boolean' || typeof value.favorite !== 'boolean' || flags.some(flag => typeof value.capabilities?.[flag] !== 'boolean')) throw fail('BUSINESS_INVALID_RESPONSE')
    const c = context(); if (value.principalId !== c?.principalId) throw fail('BUSINESS_CONTEXT_CHANGED')
    if (['canPin', 'canShortcut', 'canTransferOwnership'].some(flag => value.capabilities[flag] !== undefined && typeof value.capabilities[flag] !== 'boolean') ||
      (value.pinned !== undefined && typeof value.pinned !== 'boolean') || (value.capabilities.canPin === true && typeof value.pinned !== 'boolean') ||
      (value.capabilities.canShortcut === true && !Array.isArray(value.shortcuts)) || (value.authzVersion !== undefined && !decimal(value.authzVersion)) ||
      (value.capabilities.canTransferOwnership === true && (!decimal(value.authzVersion) || !id(value.ownershipEligibilityRevision) || value.ownerId !== value.principalId))) throw fail('BUSINESS_INVALID_RESPONSE')
    const shortcuts = value.shortcuts === undefined ? [] : value.shortcuts
    if (!Array.isArray(shortcuts) || shortcuts.some(item => !item || Object.keys(item).length !== 3 || !id(item.id) || !id(item.folderId) || typeof item.folderName !== 'string' || !item.folderName) ||
      new Set(shortcuts.map(item => item.id)).size !== shortcuts.length || new Set(shortcuts.map(item => item.folderId)).size !== shortcuts.length) throw fail('BUSINESS_INVALID_RESPONSE')
    return Object.freeze({ ...value, shortcuts: Object.freeze(shortcuts.map(item => Object.freeze({ ...item }))),
      capabilities: Object.freeze({ ...value.capabilities, canPin: value.capabilities.canPin === true, canShortcut: value.capabilities.canShortcut === true,
        canTransferOwnership: value.capabilities.canTransferOwnership === true }) })
  }
  function getState() { return owner() && stateOwner === owner() && state?.principalId === context()?.principalId ? state : null }
  async function json(suffix, body, csrf) {
    const key = owner(), epoch = generation
    if (!key) throw fail('BUSINESS_IDENTITY_REQUIRED')
    const controller = new AbortController(); requests.add(controller)
    let abortListener, rejectCancellation
    const cancelled = new Promise((resolve, reject) => { rejectCancellation = reject; abortListener = () => reject(fail('BUSINESS_CONTEXT_CHANGED')); controller.signal.addEventListener('abort', abortListener, { once: true }) })
    const timeout = setTimeout(() => { rejectCancellation(fail('BUSINESS_TIMEOUT')); controller.abort() }, 15000)
    try {
      const headers = { Accept: 'application/json' }
      if (body) Object.assign(headers, { 'Content-Type': 'application/json', 'Idempotency-Key': body.operationId, 'X-CSRF-Token': csrf })
      return await Promise.race([(async () => {
        const response = await request(base + suffix, { method: body ? 'POST' : 'GET', credentials: 'include', cache: 'no-store', redirect: 'error', headers,
          ...(body ? { body: JSON.stringify(body) } : {}), signal: controller.signal })
        if (!current(key, epoch) || controller.signal.aborted) throw fail('BUSINESS_CONTEXT_CHANGED')
        const data = await response.json()
        if (!current(key, epoch) || controller.signal.aborted) throw fail('BUSINESS_CONTEXT_CHANGED')
        return { status: response.status, data }
      })(), cancelled])
    } finally { requests.delete(controller); clearTimeout(timeout); controller.signal.removeEventListener('abort', abortListener) }
  }
  function publish(input, foldersChanged) {
    const value = validate(input), old = getState()
    if (old && ((old.authzVersion !== undefined && (value.authzVersion === undefined || BigInt(value.authzVersion) < BigInt(old.authzVersion))) || BigInt(value.revision) < BigInt(old.revision) || BigInt(value.preferenceRevision) < BigInt(old.preferenceRevision) ||
      BigInt(value.epoch) < BigInt(old.epoch) || (value.epoch === old.epoch && BigInt(value.contentRevision) < BigInt(old.contentRevision)))) return old
    publication++; state = value; stateOwner = owner(); emit(foldersChanged); return state
  }
  async function load() {
    const started = publication, key = owner(), epoch = generation
    let result
    try { result = await json('/business') } catch (cause) { if (started !== publication && current(key, epoch)) return getState(); throw cause }
    if (started !== publication) return getState()
    const { status, data } = result
    if (status !== 200) { publication++; state = null; emit(false); throw fail(data?.code || 'BUSINESS_UNAVAILABLE', { status }) }
    return publish(data, false)
  }
  function stopStream() { clearTimeout(reconnect); reconnect = null; stream?.abort(); stream = null }
  async function connect() {
    if (stream || disposed || !listeners.size || !owner()) return
    const key = owner(), epoch = generation, controller = new AbortController(); stream = controller
    const live = () => current(key, epoch) && stream === controller && !controller.signal.aborted, started = publication
    let retry = true, reader
    try {
      const response = await request(base + '/business-events', { credentials: 'include', cache: 'no-store', redirect: 'error', headers: { Accept: 'text/event-stream' }, signal: controller.signal })
      if (!live()) return
      if (response.status !== 200 || !/^text\/event-stream(?:;|$)/i.test(response.headers.get('content-type') || '')) {
        retry = response.status >= 500 || started !== publication; if (started === publication) { publication++; state = null; emit(false) } return
      }
      reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''
      while (live()) {
        const chunk = await reader.read(); if (!live()) return; if (chunk.done) break
        buffer += decoder.decode(chunk.value, { stream: true }); if (buffer.length > 131072) throw fail('BUSINESS_INVALID_STREAM')
        let match
        while ((match = /\r?\n\r?\n/.exec(buffer))) {
          const frame = buffer.slice(0, match.index); buffer = buffer.slice(match.index + match[0].length)
          const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
          if (!data) continue
          if (!live()) return
          const value = JSON.parse(data); publish(value.document, value.foldersChanged === true)
        }
      }
    } catch { /* A broken transport reconnects with a fresh authorized baseline, never a POST. */ }
    finally {
      try { await reader?.cancel() } catch { /* closed */ }
      if (stream === controller) stream = null
      if (!controller.signal.aborted && retry && current(key, epoch) && listeners.size) reconnect = setTimeout(() => { reconnect = null; void connect() }, 1000)
    }
  }
  function recordFor(operationId) {
    const record = operations.get(operationId)
    if (!record || record.owner !== owner() || retired.has(operationId)) throw fail('BUSINESS_OPERATION_NOT_FOUND')
    return record
  }
  function outcome(record, status, data) {
    if (record.owner !== owner() || operations.get(record.body.operationId) !== record) throw fail('BUSINESS_CONTEXT_CHANGED')
    const personal = ['pin', 'shortcut', 'transfer-ownership'].includes(record.body.kind)
    if (status === 200 && data?.status === 'committed' && data.operationId === record.body.operationId && data.kind === record.body.kind &&
      /^sha256:[a-f0-9]{64}(?![\s\S])/.test(data.requestHash) && decimal(data.revision) && typeof data.replayed === 'boolean' &&
      (record.body.kind !== 'duplicate' || id(data.newDocId)) && (!personal || (data.revision === String(BigInt(record.body.expectedRevision) + BigInt(1)) &&
        (!record.requestHash || record.requestHash === data.requestHash) && (record.body.kind === 'pin' ? data.pinned === record.body.value : record.body.kind === 'shortcut' ? id(data.shortcutId) && data.folderId === record.body.folderId :
          data.ownerId === record.body.targetPrincipalId && data.targetPrincipalId === record.body.targetPrincipalId && data.oldOwnerId === JSON.parse(record.owner)[0] &&
          data.authzVersion === String(BigInt(record.body.expectedAuthzVersion) + BigInt(1)) && data.removeOldOwner === record.body.removeOldOwner && data.oldOwnerPerm === record.body.oldOwnerPerm && data.stayPut === true)))) {
      record.requestHash = data.requestHash; record.status = 'committed'; record.result = Object.freeze({ ...data }); return record.result
    }
    if (status >= 400 && status < 500) { record.status = 'rejected'; throw fail(data?.code || 'BUSINESS_REJECTED', { status, operationId: record.body.operationId }) }
    record.status = 'unknown'; return { status: 'unknown', operationId: record.body.operationId, code: data?.code || 'COMMIT_UNKNOWN' }
  }
  return {
    bindContext(get) { if (typeof get !== 'function') throw fail('BUSINESS_CONFIGURATION'); context = get },
    getState, load,
    getScope: () => Object.freeze({ tenantId: options.tenantId, docId: options.docId }),
    getDocumentUrl(docId) { if (!id(docId) || typeof options.documentUrl !== 'function') return null; const url = new URL(options.documentUrl(docId), globalThis.location.href); return url.origin === globalThis.location.origin && ['http:', 'https:'].includes(url.protocol) ? url.href : null },
    async folders() { const { status, data } = await json('/business-folders'); if (status !== 200 || !Array.isArray(data?.items) || data.items.some(f => !id(f.id) || typeof f.name !== 'string' || typeof f.canWrite !== 'boolean')) throw fail(data?.code || 'BUSINESS_INVALID_RESPONSE', { status }); return data.items.map(f => Object.freeze({ ...f })) },
    async ownershipCandidates() {
      const { status, data } = await json('/business-ownership-candidates')
      if (status !== 200) throw fail(data?.code || 'BUSINESS_UNAVAILABLE', { status })
      if (!data || Object.keys(data).length !== 7 || data.tenantId !== options.tenantId || data.docId !== options.docId || data.ownerId !== context()?.principalId ||
        !decimal(data.revision) || !decimal(data.authzVersion) || !id(data.eligibilityRevision) || !Array.isArray(data.items) ||
        data.items.some(item => !item || Object.keys(item).length !== 2 || !id(item.principalId) || item.principalId === data.ownerId || typeof item.displayName !== 'string' || !item.displayName || item.displayName.length > 128 || Array.from(item.displayName).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159)) ||
        new Set(data.items.map(item => item.principalId)).size !== data.items.length) throw fail('BUSINESS_INVALID_RESPONSE')
      return Object.freeze({ ...data, items: Object.freeze(data.items.map(item => Object.freeze({ ...item }))) })
    },
    async execute(value) {
      const key = owner(), body = JSON.parse(JSON.stringify(value))
      if (!key || !id(body.operationId) || retired.has(body.operationId) || !decimal(body.expectedRevision)) throw fail('BUSINESS_INVALID_INPUT')
      if ((body.kind === 'pin' && (Object.keys(body).length !== 4 || typeof body.value !== 'boolean')) ||
        (body.kind === 'shortcut' && (Object.keys(body).length !== 4 || !id(body.folderId)))) throw fail('BUSINESS_INVALID_INPUT')
      if (body.kind === 'transfer-ownership' && (Object.keys(body).length !== 9 || !id(body.targetPrincipalId) || !decimal(body.expectedAuthzVersion) || !id(body.expectedEligibilityRevision) ||
        typeof body.removeOldOwner !== 'boolean' || !['full_access', 'edit', 'view'].includes(body.oldOwnerPerm) || body.stayPut !== true)) throw fail('BUSINESS_INVALID_INPUT')
      if (operations.has(body.operationId)) throw fail('BUSINESS_QUERY_REQUIRED', { operationId: body.operationId })
      if (body.kind === 'duplicate') { const live = options.getState?.(); if (live?.status !== 'ready' || !Array.isArray(live.pending) || live.pending.length || live.epoch !== body.sourceEpoch || live.revision !== body.sourceRevision) throw fail('BUSINESS_BODY_NOT_CURRENT') }
      const csrf = options.csrfToken(); if (typeof csrf !== 'string' || !csrf) throw fail('BUSINESS_CSRF_REQUIRED')
      const record = { body: Object.freeze(body), owner: key, status: 'unknown' }; operations.set(body.operationId, record)
      try { const { status, data } = await json('/business-operations', body, csrf); return outcome(record, status, data) }
      catch (error) { if (record.status === 'rejected') throw error; return { status: 'unknown', operationId: body.operationId, code: 'COMMIT_UNKNOWN' } }
    },
    async query(operationId) {
      const record = recordFor(operationId), { status, data } = await json('/business-operations/' + encodeURIComponent(operationId) + (record.requestHash ? '?requestHash=' + encodeURIComponent(record.requestHash) : ''))
      if (status !== 200) throw fail(data?.code || 'BUSINESS_QUERY_UNAVAILABLE', { status, operationId })
      if (data?.status === 'unknown') return { status: 'unknown', operationId, code: 'OPERATION_UNKNOWN' }
      return outcome(record, status, data)
    },
    getPending() { const key = owner(); return key ? [...operations.values()].filter(v => v.owner === key && v.status === 'unknown').map(v => ({ operationId: v.body.operationId, kind: v.body.kind })) : [] },
    subscribe(listener) { if (typeof listener !== 'function') throw fail('BUSINESS_INVALID_LISTENER'); listeners.add(listener); if (getState()) listener({ document: state, foldersChanged: false }); void connect(); return () => { listeners.delete(listener); if (!listeners.size) stopStream() } },
    reset(reason) { generation++; publication++; state = null; stateOwner = null; stopStream(); requests.forEach(c => c.abort()); requests.clear(); if (reason !== 'authorization-required') { operations.forEach((v, key) => retired.add(key)); operations.clear() } if (reason === 'disposed') { disposed = true; listeners.clear() } },
  }
}
