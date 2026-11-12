/* global globalThis */
/** 当前文档的站内通知。游标仅作服务端不透明续流凭据，不表示外部送达。 */
const decimal = value => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)
const text = value => typeof value === 'string' && value.length > 0 && !value.includes('\0')
const opaque = value => text(value) && !value.includes('\r') && !value.includes('\n')
const copy = value => JSON.parse(JSON.stringify(value))
const fail = (code, status) => Object.assign(new Error(code), { code, status })
const atLeast = (value, minimum) => value.length > minimum.length || (value.length === minimum.length && value >= minimum)
const hash = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value)
function increment(value) {
  const digits = value.split('')
  let carry = 1
  for (let i = digits.length - 1; i >= 0 && carry; i--) {
    const next = Number(digits[i]) + carry
    digits[i] = String(next % 10); carry = next > 9 ? 1 : 0
  }
  return `${carry ? '1' : ''}${digits.join('')}`
}
function newId() {
  if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== 'function') throw fail('NOTIFICATION_RANDOM_UNAVAILABLE')
  return `notification-${Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')}`
}

/** 宿主注入的兼容通知契约；HTTP Provider 另走 snapshot/markRead 端口。 */
export const NOTIFICATION_METHODS = ['list', 'markAllRead', 'setMuted']
const HTTP_NOTIFICATION_METHODS = ['snapshot', 'subscribe', 'markRead', 'setMuted']
export function createNotificationsProvider(provider) {
  if (provider == null) return null
  const methods = typeof provider.snapshot === 'function' || typeof provider.markRead === 'function'
    ? HTTP_NOTIFICATION_METHODS : NOTIFICATION_METHODS
  const missing = methods.filter(method => typeof provider[method] !== 'function')
  if (missing.length) throw new Error(`notifications Provider 缺少方法：${missing.join(', ')}`)
  return provider
}

export function createHttpNotificationsProvider(options = {}) {
  const { tenantId, docId } = options
  if (!text(tenantId) || !text(docId)) throw new TypeError('notifications: 需要固定tenantId/docId')
  const root = `${options.baseUrl == null ? '' : String(options.baseUrl).replace(/\/+$/, '')}/editor/v1/tenants/${encodeURIComponent(tenantId)}`
  const documentUrl = `${root}/documents/${encodeURIComponent(docId)}`
  const request = options.request || (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null)
  if (typeof request !== 'function') throw new TypeError('notifications: 需要fetch-compatible request')
  const items = new Map(), eventIds = new Map(), listeners = new Set(), requests = new Set(), operations = new Map(), retiredOperations = new Set()
  let order = [], generation = 0, contextGeneration = 0, destroyed = false, status = 'idle', connection = 'idle', reason = null
  let principalId = null, preference = null, cursor = null, pageCursor = null, hasMore = false, unreadCount = null
  let stream = null, reconnectTimer = null, retries = 0, resetRequired = false, historyBusy = false
  const canView = () => typeof options.getCapabilities === 'function' && options.getCapabilities()?.canView === true
  const current = value => {
    if (destroyed || value !== generation) return false
    if (!canView()) { clear('authorization-required', 'denied', true); return false }
    return !destroyed && value === generation
  }
  const state = () => ({ status, connection, reason, generation, resetRequired, items: order.map(id => copy(items.get(id))),
    unreadCount, preference: preference && copy(preference), principalId, cursor, pageCursor, hasMore, historyBusy })
  const emit = () => listeners.forEach(listener => listener(state()))
  const contextChanged = () => fail('NOTIFICATION_CONTEXT_CHANGED')
  function checkContext(context) { if (destroyed || context !== contextGeneration) throw contextChanged() }
  function checkRecord(record, context) { checkContext(context); if (operations.get(record.operationId) !== record) throw contextChanged() }
  function invalidateOperations(reason) {
    contextGeneration++
    if (reason === 'authorization-required') {
      operations.forEach(record => { if (['pending', 'unknown'].includes(record.status) || record.status === 'committed' && !record.settled) record.status = 'unknown' })
      return
    }
    operations.forEach((record, id) => retiredOperations.add(id)); operations.clear()
  }
  function clear(nextReason = 'reset', nextStatus = 'idle', notifyReset = false) {
    generation++
    if (nextStatus === 'denied' || ['authorization-required', 'disposed', 'unsubscribed'].includes(nextReason)) invalidateOperations(nextReason === 'disposed' ? 'disposed' : 'authorization-required')
    if (stream) stream.abort()
    stream = null
    clearTimeout(reconnectTimer); reconnectTimer = null
    requests.forEach(controller => controller.abort()); requests.clear()
    items.clear(); eventIds.clear(); order = []; preference = null; principalId = null
    cursor = null; pageCursor = null; hasMore = false; unreadCount = null; historyBusy = false
    status = nextStatus; connection = 'stopped'; reason = nextReason; resetRequired = notifyReset
    emit()
  }
  function requireView() {
    if (destroyed) throw fail('NOTIFICATION_DISPOSED')
    if (!canView()) { clear('authorization-required', 'denied', true); throw fail('NOTIFICATION_NOT_VISIBLE', 404) }
  }
  async function deadline(work, controller) {
    let timer, abort
    const cancelled = new Promise((resolve, reject) => {
      abort = () => reject(fail('NOTIFICATION_REQUEST_ABORTED'))
      controller.signal.addEventListener('abort', abort)
      if (controller.signal.aborted) abort()
    })
    try {
      return await Promise.race([work, cancelled, new Promise((resolve, reject) => {
        timer = setTimeout(() => { reject(fail('NOTIFICATION_TIMEOUT')); controller.abort() }, 15000)
      })])
    } finally { clearTimeout(timer); controller.signal.removeEventListener('abort', abort) }
  }
  async function json(url, body) {
    const context = contextGeneration; checkContext(context)
    const headers = { Accept: 'application/json' }
    if (body) {
      const csrf = typeof options.csrfToken === 'function' ? options.csrfToken() : options.csrfToken
      if (!text(csrf)) throw fail('NOTIFICATION_CSRF_REQUIRED')
      Object.assign(headers, { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, 'Idempotency-Key': body.operationId })
    }
    checkContext(context)
    const controller = new AbortController(); requests.add(controller)
    try {
      return await deadline((async () => {
        const response = await request(url, { method: body ? 'POST' : 'GET', headers, credentials: 'include', cache: 'no-store', redirect: 'error',
          signal: controller.signal, ...(body ? { body: JSON.stringify(body) } : {}) })
        checkContext(context)
        if (!response || !Number.isInteger(response.status)) throw fail('NOTIFICATION_INVALID_RESPONSE')
        let data
        try { data = await response.json() } catch { throw fail('NOTIFICATION_INVALID_RESPONSE', response.status) }
        checkContext(context)
        return { status: response.status, data }
      })(), controller)
    } catch (error) { checkContext(context); throw error } finally { requests.delete(controller) }
  }
  function count(value) {
    if (!Number.isSafeInteger(value) || value < 0) throw fail('NOTIFICATION_INVALID_COUNT')
    return value
  }
  function item(raw) {
    if (!raw || !text(raw.notificationId) || !text(raw.eventId) || raw.resourceRef !== docId || !text(raw.type) ||
      typeof raw.read !== 'boolean' || !decimal(raw.readRevision) || (raw.threadId !== undefined && !text(raw.threadId))) throw fail('NOTIFICATION_INVALID_ITEM')
    return { notificationId: raw.notificationId, eventId: raw.eventId, resourceRef: docId, type: raw.type,
      read: raw.read, readRevision: raw.readRevision, ...(raw.threadId === undefined ? {} : { threadId: raw.threadId }) }
  }
  function pref(raw, expectedPrincipal = principalId) {
    if (!raw || raw.tenantId !== tenantId || raw.docId !== docId || !text(raw.principalId) ||
      (expectedPrincipal && raw.principalId !== expectedPrincipal) || typeof raw.muted !== 'boolean' || !decimal(raw.preferenceRevision)) throw fail('NOTIFICATION_IDENTITY_MISMATCH')
    return { tenantId, docId, principalId: raw.principalId, muted: raw.muted, preferenceRevision: raw.preferenceRevision }
  }
  function upsert(value, history = false) {
    const prior = items.get(value.notificationId)
    if (prior && (prior.eventId !== value.eventId || prior.type !== value.type || prior.threadId !== value.threadId)) throw fail('NOTIFICATION_IDENTITY_MISMATCH')
    if (prior && prior.readRevision === value.readRevision && prior.read !== value.read) throw fail('NOTIFICATION_INVALID_ITEM')
    if (eventIds.has(value.eventId) && eventIds.get(value.eventId) !== value.notificationId) return
    if (prior && !atLeast(value.readRevision, prior.readRevision)) return
    if (!prior) { if (history) order.push(value.notificationId); else order.unshift(value.notificationId) }
    items.set(value.notificationId, value); eventIds.set(value.eventId, value.notificationId)
  }
  function applyPreference(value) {
    if (!preference || atLeast(value.preferenceRevision, preference.preferenceRevision)) preference = value
  }
  function validatePage(raw) {
    if (!raw || !Array.isArray(raw.items) || typeof raw.hasMore !== 'boolean' || (raw.hasMore && !opaque(raw.pageCursor)) ||
      (raw.pageCursor != null && !opaque(raw.pageCursor))) throw fail('NOTIFICATION_INVALID_RESPONSE')
    return raw.items.map(item)
  }
  async function snapshot(nextReason = 'snapshot') {
    requireView()
    clear(nextReason, 'loading')
    const run = generation, context = contextGeneration
    try {
      const result = await json(`${documentUrl}/notifications`)
      checkContext(context)
      if (!current(run)) { checkContext(context); return state() }
      if (result.status !== 200) throw fail([401, 403, 404].includes(result.status) ? 'NOTIFICATION_NOT_VISIBLE' : 'NOTIFICATION_SNAPSHOT_FAILED', result.status)
      const values = validatePage(result.data), nextPreference = pref(result.data.preference, null)
      if ([...operations.values()].some(record => record.principalId !== nextPreference.principalId)) {
        invalidateOperations('identity-changed'); clear('identity-changed', 'denied', true); throw contextChanged()
      }
      const nextCount = count(result.data.unreadCount)
      if (!opaque(result.data.cursor)) throw fail('NOTIFICATION_INVALID_CURSOR')
      principalId = nextPreference.principalId; preference = nextPreference
      values.forEach(value => upsert(value, true))
      unreadCount = nextCount; cursor = result.data.cursor; pageCursor = result.data.pageCursor || null; hasMore = result.data.hasMore
      status = 'ready'; connection = 'idle'; reason = null; resetRequired = false; retries = 0; emit()
      checkContext(context)
      if (listeners.size) void connect(run)
      return state()
    } catch (error) {
      checkContext(context)
      if (!destroyed && run === generation) clear(error.code || 'NOTIFICATION_SNAPSHOT_FAILED', [401, 403, 404].includes(error.status) ? 'denied' : 'error', true)
      throw error
    }
  }
  function receive(frame, run) {
    if (!current(run)) throw fail('NOTIFICATION_STALE_STREAM')
    if (frame.event === 'reset-required' || frame.event === 'authorization-required') {
      const data = frame.data ? JSON.parse(frame.data) : {}
      if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length !== 1 ||
        data.code !== (frame.event === 'reset-required' ? 'CURSOR_EXPIRED' : 'AUTHORIZATION_REQUIRED')) throw fail('NOTIFICATION_INVALID_FRAME')
      const nextReason = frame.event
      clear(nextReason, 'loading', true)
      void snapshot(nextReason).catch(() => {})
      return
    }
    if (!opaque(frame.id)) throw fail('NOTIFICATION_INVALID_CURSOR')
    const data = JSON.parse(frame.data || '{}')
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw fail('NOTIFICATION_INVALID_FRAME')
    const nextCount = count(data.unreadCount)
    if (frame.event === 'notification') upsert(item(data.notification))
    else if (frame.event === 'preference') applyPreference(pref(data.preference))
    else if (frame.event !== 'checkpoint') throw fail('NOTIFICATION_INVALID_FRAME')
    unreadCount = nextCount; cursor = frame.id; emit()
  }
  async function readStream(response, controller, run) {
    if (!response.body || typeof response.body.getReader !== 'function') throw fail('NOTIFICATION_STREAM_UNAVAILABLE')
    const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true })
    let pending = '', event = '', id = '', data = [], frameSize = 0
    let rejectAbort
    const aborted = new Promise((resolve, reject) => { rejectAbort = reject })
    const abort = () => { rejectAbort(fail('NOTIFICATION_STREAM_ABORTED')); void reader.cancel().catch(() => {}) }
    controller.signal.addEventListener('abort', abort)
    try {
      if (controller.signal.aborted) throw fail('NOTIFICATION_STREAM_ABORTED')
      for (;;) {
        const part = await Promise.race([reader.read(), aborted])
        if (part.done) throw fail('NOTIFICATION_STREAM_ENDED')
        try { pending += decoder.decode(part.value, { stream: true }) } catch { throw fail('NOTIFICATION_INVALID_FRAME') }
        if (pending.length > 262144) throw fail('NOTIFICATION_FRAME_TOO_LARGE')
        for (;;) {
          const at = pending.search(/[\r\n]/)
          if (at < 0 || (pending[at] === '\r' && at === pending.length - 1)) break
          const line = pending.slice(0, at)
          pending = pending.slice(at + (pending[at] === '\r' && pending[at + 1] === '\n' ? 2 : 1))
          if (!line) {
            if (event || data.length || id) receive({ event: event || 'message', id, data: data.join('\n') }, run)
            event = ''; id = ''; data = []; frameSize = 0
            if (!current(run)) return
          } else if (line[0] !== ':') {
            frameSize += line.length
            if (frameSize > 262144) throw fail('NOTIFICATION_FRAME_TOO_LARGE')
            const colon = line.indexOf(':')
            const key = colon < 0 ? line : line.slice(0, colon)
            const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '')
            if (key === 'event') event = value
            else if (key === 'id') id = value
            else if (key === 'data') data.push(value)
          }
        }
      }
    } finally {
      controller.signal.removeEventListener('abort', abort)
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  }
  async function connect(run) {
    if (!current(run) || !listeners.size || stream || !cursor) return
    const controller = new AbortController(); stream = controller
    connection = retries ? 'reconnecting' : 'connecting'; emit()
    try {
      let sourceGap = false
      const response = await deadline((async () => {
        const value = await request(`${documentUrl}/events`, { method: 'GET', headers: { Accept: 'text/event-stream', 'Last-Event-ID': cursor },
          credentials: 'include', cache: 'no-store', redirect: 'error', signal: controller.signal })
        if (value.status === 503 && typeof value.json === 'function') {
          try { sourceGap = (await value.json())?.code === 'PG_PERMISSION_SOURCE_GAP' } catch { /* 普通服务错误仍按有界断流重连处理。 */ }
        }
        return value
      })(), controller)
      if (!current(run)) return
      // 流开启前无法发送SSE控制帧；只将明确的权限来源缺口作同一失权处理。
      if (sourceGap) { clear('authorization-required', 'loading', true); void snapshot('authorization-required').catch(() => {}); return }
      if (response.status === 410) { clear('cursor-expired', 'loading', true); void snapshot('cursor-expired').catch(() => {}); return }
      if (response.status !== 200) throw fail([401, 403, 404].includes(response.status) ? 'NOTIFICATION_NOT_VISIBLE' : 'NOTIFICATION_STREAM_FAILED', response.status)
      const contentType = response.headers && response.headers.get('Content-Type')
      if (!contentType || !/^text\/event-stream(?:;|$)/i.test(contentType)) throw fail('NOTIFICATION_INVALID_STREAM')
      connection = 'connected'; emit()
      await readStream(response, controller, run)
    } catch (error) {
      if (!current(run)) return
      if ([401, 403, 404].includes(error.status) || ['NOTIFICATION_IDENTITY_MISMATCH', 'NOTIFICATION_INVALID_FRAME', 'NOTIFICATION_INVALID_COUNT', 'NOTIFICATION_INVALID_CURSOR', 'NOTIFICATION_INVALID_ITEM', 'NOTIFICATION_INVALID_STREAM', 'NOTIFICATION_STREAM_UNAVAILABLE', 'NOTIFICATION_FRAME_TOO_LARGE'].includes(error.code) || error instanceof SyntaxError) {
        clear(error.code || 'NOTIFICATION_STREAM_REJECTED', 'error', true); return
      }
      connection = 'reconnecting'; reason = error.code || 'NOTIFICATION_STREAM_LOST'; emit()
      if (++retries > 5) { clear('NOTIFICATION_RECONNECT_EXHAUSTED', 'error', true); return }
      reconnectTimer = setTimeout(() => { reconnectTimer = null; void connect(run) }, Math.min(8000, 500 * (2 ** (retries - 1))))
    } finally { if (stream === controller) stream = null }
  }
  async function execute(record, querying = false) {
    requireView()
    const run = generation, context = contextGeneration
    checkRecord(record, context)
    try {
      const { data, status: httpStatus } = await json(querying ? `${root}/operations/${encodeURIComponent(record.operationId)}?${new URLSearchParams({ commandType: 'notification', ...(record.requestHash ? { requestHash: record.requestHash } : {}) })}`
        : `${documentUrl}/notification-operations`, querying ? undefined : record.body)
      checkRecord(record, context)
      if (!querying && httpStatus >= 400 && httpStatus < 500) record.status = 'rejected'
      if (data?.status === 'unknown' && data.operationId === record.operationId && data.requestHash !== undefined) {
        if (!hash(data.requestHash) || (record.requestHash && record.requestHash !== data.requestHash)) throw fail('NOTIFICATION_RESULT_UNKNOWN')
        record.requestHash = data.requestHash
      }
      if (![200, 201].includes(httpStatus) || !data || data.status !== 'committed') throw fail([401, 403, 404].includes(httpStatus) ? 'NOTIFICATION_NOT_VISIBLE' : 'NOTIFICATION_RESULT_UNKNOWN', httpStatus)
      if (data.operationId !== record.operationId || !hash(data.requestHash) || (record.requestHash && data.requestHash !== record.requestHash) ||
        (record.body.kind === 'read-all' ? !decimal(data.committedRevision) || data.committedRevision === '0' : data.committedRevision !== increment(record.body.expectedRevision))) throw fail('NOTIFICATION_RESULT_UNKNOWN')
      const nextPreference = pref(data.preference, record.principalId), nextCount = count(data.unreadCount)
      let nextItem = null
      if (record.body.kind === 'read') {
        nextItem = item(data.notification)
        if (nextItem.notificationId !== record.body.notificationId || !atLeast(nextItem.readRevision, data.committedRevision) ||
          (nextItem.readRevision === data.committedRevision && nextItem.read !== record.body.value)) throw fail('NOTIFICATION_RESULT_UNKNOWN')
      } else if (record.body.kind === 'read-all') {
        if (data.notification !== null || !data.readAll || !decimal(data.readAll.revision) || !atLeast(data.readAll.revision, data.committedRevision)) throw fail('NOTIFICATION_RESULT_UNKNOWN')
      } else if (data.notification !== null || !atLeast(nextPreference.preferenceRevision, data.committedRevision) ||
        (nextPreference.preferenceRevision === data.committedRevision && nextPreference.muted !== record.body.value)) throw fail('NOTIFICATION_RESULT_UNKNOWN')
      record.status = 'committed'; record.requestHash = data.requestHash; record.committedRevision = data.committedRevision
      let viewRefreshRequired = true
      if (!destroyed && context === contextGeneration && canView()) {
        // HTTP确认和旧SSE可跨连接乱序。先废弃旧流，再取提交之后的当前快照；
        // opaque cursor不可排序，不能靠拒绝旧item来证明count也是新的。
        try {
          const projection = await snapshot('committed-view-refresh')
          checkRecord(record, context)
          viewRefreshRequired = projection.status !== 'ready' || projection.principalId !== record.principalId
        } catch { /* 数据库已确认；视图刷新失败不能降为unknown或重发POST。 */ }
      }
      checkRecord(record, context)
      record.viewRefreshRequired = viewRefreshRequired; record.settled = true
      return { status: 'committed', operationId: record.operationId, requestHash: data.requestHash, committedRevision: data.committedRevision,
        notification: nextItem, preference: nextPreference, unreadCount: nextCount, ...(record.body.kind === 'read-all' ? { readAll: { revision: data.readAll.revision } } : {}), replayed: data.replayed === true, viewRefreshRequired }
    } catch (error) {
      checkRecord(record, context)
      if (!['committed', 'rejected'].includes(record.status)) record.status = 'unknown'
      if (!destroyed && run === generation) {
        if ([401, 403, 404].includes(error.status) || error.code === 'NOTIFICATION_IDENTITY_MISMATCH') clear('authorization-required', 'denied', true)
        else if (['NOTIFICATION_INVALID_ITEM', 'NOTIFICATION_INVALID_COUNT'].includes(error.code)) clear(error.code, 'error', true)
      }
      throw Object.assign(error, { operationId: record.operationId, httpStatus: typeof error.status === 'number' ? error.status : null,
        status: record.status === 'committed' ? 'unavailable' : record.status })
    }
  }
  function write(kind, input = {}) {
    const context = contextGeneration
    requireView()
    if (kind === 'read-all') {
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['operationId'].includes(key))) throw fail('NOTIFICATION_INVALID_INPUT')
      input = { ...input, value: true, expectedRevision: '0' }
    }
    if (typeof input.value !== 'boolean' || (kind === 'read' && !text(input.notificationId))) throw fail('NOTIFICATION_INVALID_INPUT')
    const id = input.operationId === undefined ? newId() : input.operationId
    if (!text(id)) throw fail('NOTIFICATION_OPERATION_REQUIRED')
    if (retiredOperations.has(id)) throw contextChanged()
    const prior = operations.get(id)
    if (prior) {
      if (prior.body.kind !== kind || prior.body.value !== input.value || (kind === 'read' && prior.body.notificationId !== input.notificationId) ||
        (input.expectedRevision !== undefined && prior.body.expectedRevision !== input.expectedRevision)) throw fail('IDEMPOTENCY_MISMATCH', 409)
      return execute(prior, true)
    }
    const unresolved = [...operations.values()].find(record => record.body.kind === 'read-all' && ['pending', 'unknown'].includes(record.status))
    if (unresolved && kind === 'read-all') throw Object.assign(fail('NOTIFICATION_QUERY_REQUIRED', 'unknown'), { operationId: unresolved.operationId })
    if (status !== 'ready' || !preference || !principalId) throw fail('NOTIFICATION_NOT_READY')
    const value = kind === 'read' ? items.get(input.notificationId) : preference
    if (!value) throw fail('NOTIFICATION_NOT_VISIBLE', 404)
    const expectedRevision = input.expectedRevision === undefined ? value[kind === 'read' ? 'readRevision' : 'preferenceRevision'] : input.expectedRevision
    if (!decimal(expectedRevision)) throw fail('NOTIFICATION_REVISION_REQUIRED')
    const body = Object.freeze({ operationId: id, kind, ...(kind === 'read' ? { notificationId: input.notificationId } : {}), value: input.value, expectedRevision })
    checkContext(context)
    const record = { operationId: id, principalId, body, requestHash: null, status: 'pending' }; operations.set(id, record)
    return execute(record)
  }
  const provider = {
    isRemote: true,
    getState() { if (!destroyed && !canView() && status !== 'denied') clear('authorization-required', 'denied', true); return state() },
    snapshot, list: () => snapshot(),
    reset: reason => { if (!destroyed) { if (reason !== 'authorization-required') invalidateOperations(reason); clear(reason, reason === 'authorization-required' ? 'denied' : 'idle', true) } },
    resume() { if (!destroyed && canView() && listeners.size && !['ready', 'loading'].includes(status)) void snapshot().catch(() => {}) },
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('notifications: listener必须是函数')
      if (destroyed) throw fail('NOTIFICATION_DISPOSED')
      listeners.add(listener); listener(state())
      if (listeners.size === 1) { if (status === 'ready') void connect(generation); else void snapshot().catch(() => {}) }
      let active = true
      return () => { if (!active) return; active = false; listeners.delete(listener); if (!listeners.size && !destroyed) clear('unsubscribed') }
    },
    async loadMore() {
      requireView()
      if (!hasMore || !pageCursor || historyBusy || status !== 'ready') return state()
      const run = generation, context = contextGeneration, expectedPrincipal = principalId, requestedCursor = pageCursor
      historyBusy = true; emit()
      try {
        const { data, status: httpStatus } = await json(`${documentUrl}/notifications?${new URLSearchParams({ historyCursor: requestedCursor })}`)
        checkContext(context)
        if (!current(run) || principalId !== expectedPrincipal) { checkContext(context); return state() }
        if (httpStatus === 410) { await snapshot('history-cursor-expired'); checkContext(context); return state() }
        if (httpStatus !== 200) throw fail([401, 403, 404].includes(httpStatus) ? 'NOTIFICATION_NOT_VISIBLE' : 'NOTIFICATION_HISTORY_FAILED', httpStatus)
        validatePage(data).forEach(value => upsert(value, true))
        hasMore = data.hasMore; pageCursor = data.pageCursor || null
        return state()
      } catch (error) {
        checkContext(context)
        if (current(run)) clear(error.code || 'NOTIFICATION_HISTORY_FAILED', 'error', true)
        throw error
      } finally { if (run === generation) { historyBusy = false; emit() } }
    },
    markAllRead: input => write('read-all', input), markRead: input => write('read', input), setMuted: input => write('mute', input),
    queryOperation(id) {
      if (retiredOperations.has(id)) throw contextChanged()
      const record = operations.get(id)
      if (!record) throw fail('NOTIFICATION_OPERATION_NOT_FOUND')
      return execute(record, true)
    },
    getOperation: id => operations.has(id) ? copy(operations.get(id)) : null,
    getPendingOperation() {
      if (destroyed || !canView() || status !== 'ready' || !principalId) return null
      const record = [...operations.values()].find(value => value.principalId === principalId && ['pending', 'unknown'].includes(value.status))
      return record ? { operationId: record.operationId, status: 'unknown' } : null
    },
    async openThread(id) {
      requireView()
      const run = generation, context = contextGeneration, expectedPrincipal = principalId
      const value = items.get(id), comments = typeof options.comments === 'function' ? options.comments() : options.comments
      if (!value || !value.threadId || !comments || typeof comments.getLink !== 'function' || typeof comments.openLink !== 'function') throw fail('NOTIFICATION_TARGET_UNAVAILABLE')
      const link = await comments.getLink(value.threadId)
      checkContext(context)
      if (!current(run) || principalId !== expectedPrincipal) { checkContext(context); throw fail('NOTIFICATION_STALE_TARGET') }
      const result = await comments.openLink(link)
      checkContext(context)
      if (!current(run) || principalId !== expectedPrincipal) throw fail('NOTIFICATION_STALE_TARGET')
      return result
    },
    dispose() { if (destroyed) return; destroyed = true; clear('disposed', 'disposed'); listeners.clear() },
  }
  for (const name of ['loadMore', 'markRead', 'setMuted', 'queryOperation', 'openThread']) {
    const method = provider[name]
    provider[name] = (...args) => {
      const context = contextGeneration
      const result = method(...args)
      if (!result || typeof result.then !== 'function') { checkContext(context); return result }
      return result.then(value => { checkContext(context); return value }, error => { checkContext(context); throw error })
    }
  }
  return provider
}
