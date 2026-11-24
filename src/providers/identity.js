/* global globalThis */
const methods = ['login', 'queryLogin', 'refresh', 'logout', 'getState', 'getCsrfToken', 'subscribe', 'dispose']
export function createIdentityProvider(provider) {
  if (provider == null) return null
  const missing = methods.filter(key => typeof provider[key] !== 'function')
  if (missing.length) throw new Error(`identity Provider 缺少方法：${missing.join(', ')}`)
  return provider
}
const id = value => typeof value === 'string' && /^[A-Za-z0-9._-]{1,128}(?![\s\S])/.test(value)
export const isIdentityPrincipal = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !Array.from(value).some(character => { const code = character.codePointAt(0); return code < 32 || (code >= 127 && code <= 159) || (code >= 0xd800 && code <= 0xdfff) }) && typeof globalThis.TextEncoder === 'function' && new globalThis.TextEncoder().encode(value).byteLength <= 256
const principal = isIdentityPrincipal
const hash = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}(?![\s\S])/.test(value)
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key))
const fail = (code, operationId) => Object.assign(new Error(code), { code, status: 'unknown', operationId })
const monotonic = () => typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : Date.now()
function base(value) {
  if (value === undefined || value === '') return ''
  if (typeof value !== 'string' || (Array.from(value).some(character => character.codePointAt(0) <= 32 || character.codePointAt(0) === 127) || /[\\?#]/.test(value)) || value.startsWith('//')) throw fail('IDENTITY_BASE_INVALID')
  const relative = value.startsWith('/'), url = new URL(value, 'https://identity.invalid')
  if (url.username || url.password || (!relative && (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) ||
    (relative && url.origin !== 'https://identity.invalid') || url.pathname !== value.replace(/^https?:\/\/[^/]+/, '').replace(/\/+$/, '') && url.pathname.replace(/\/+$/, '') !== value.replace(/^https?:\/\/[^/]+/, '').replace(/\/+$/, '')) throw fail('IDENTITY_BASE_INVALID')
  return value.replace(/\/+$/, '')
}
/** Cookie-only identity exchange. Codes live only in the current request; the ledger retains hashes and original operation IDs. */
export function createHttpIdentityProvider(options = {}) {
  const { tenantId, docId } = options
  if (!id(tenantId) || !id(docId)) throw fail('IDENTITY_SCOPE_REQUIRED')
  const root = `${base(options.baseUrl)}/editor/v1/tenants/${encodeURIComponent(tenantId)}/sessions`
  const request = options.request || (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null)
  if (typeof request !== 'function') throw fail('IDENTITY_REQUEST_REQUIRED')
  const operations = new Map(), controllers = new Set(), listeners = new Set()
  let status = 'idle', principalId = null, csrf = null, lastCsrf = null, code = null, operationId = null
  let generation = 0, epoch = 0, disposed = false, requiresLogin = false, refreshAfterMs = null
  let leaseWall = 0, leaseMono = 0, leaseStarted = 0, refreshTimer, expiryTimer, refreshing = null, shareAccess = null
  const stopTimers = () => { clearTimeout(refreshTimer); clearTimeout(expiryTimer); refreshTimer = expiryTimer = null }
  const remaining = () => Math.floor(Math.min(leaseWall - Date.now(), leaseMono - monotonic()))
  function state() {
    expire()
    // 续租在途时租约按 1ms 报，别报 0：session 的 `_applyIdentity` 用 `expiresInMs > 0`
    // 判定 authenticated，报 0 等于自己把身份降级、能力清空，正好撞上上面那条例外。
    return Object.freeze({ status, principalId, canCreate: false, refreshAfterMs, expiresInMs: status === 'authenticated' ? Math.max(refreshing ? 1 : 0, remaining()) : 0,
      code, operationId, generation, requiresLogin, operations: Object.freeze(Array.from(operations.values(), value => Object.freeze({ ...value }))) })
  }
  const notify = () => { const value = state(), currentEpoch = epoch; listeners.forEach(listener => { if (currentEpoch !== epoch) return; try { listener(value) } catch (_) { /* One consumer cannot prevent another from denying access. */ } }) }
  function clear(next, nextCode = null, key = operationId) {
    shareAccess = null
    epoch++; generation++; stopTimers(); controllers.forEach(controller => controller.abort()); controllers.clear()
    status = next; principalId = null; csrf = null; refreshAfterMs = null; code = nextCode; operationId = key; refreshing = null
    if (['denied', 'signed-out', 'disposed'].includes(next)) { lastCsrf = null; requiresLogin = true; leaseWall = leaseMono = 0 }
    notify()
  }
  function expire() {
    // 续租在途时不能自毁：`clear()` 会 `controllers.abort()` 掐掉那个正在飞的
    // `/sessions/current`，再 `epoch++` 让回来的 200 被 guard 丢掉。本地合成租约只有
    // 3 秒（expiresInMs=3000 / refreshAfterMs=1000），主线程被协作握手或图表渲染占住
    // 一次就撞上，于是每轮都变成 unknown → authenticating → 401 → 重新登录。
    // 让这一枪先跑完：成功就续上，失败由 `execute` 自己 clear（`send` 有 15s abort 兜底）。
    if (refreshing) return
    if (leaseWall && (remaining() <= 0 || Date.now() < leaseStarted)) { requiresLogin = true; if (status === 'authenticated') clear('unknown', 'IDENTITY_UNKNOWN') }
  }
  const guard = value => { expire(); if (disposed || value !== epoch) throw fail('IDENTITY_CONTEXT_CHANGED', operationId) }
  const newId = () => {
    if (typeof globalThis.crypto?.getRandomValues !== 'function') throw fail('IDENTITY_CRYPTO_REQUIRED')
    return 'identity-' + Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')
  }
  async function digest(value) {
    if (!globalThis.crypto?.subtle || typeof globalThis.TextEncoder !== 'function') throw fail('IDENTITY_CRYPTO_REQUIRED')
    const result = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new globalThis.TextEncoder().encode(value)))
    if (result.length !== 32) throw fail('IDENTITY_CRYPTO_REQUIRED')
    return 'sha256:' + Array.from(result, byte => byte.toString(16).padStart(2, '0')).join('')
  }
  async function send(path, body, token, currentEpoch) {
    const controller = new AbortController(); controllers.add(controller)
    const started = { wall: Date.now(), mono: monotonic() }
    let timer, response
    const cancelled = new Promise((resolve, reject) => {
      controller.signal.addEventListener('abort', () => reject(fail('IDENTITY_REQUEST_UNKNOWN', body.operationId)), { once: true })
      timer = setTimeout(() => controller.abort(), 15000)
    })
    cancelled.catch(() => {})
    const stage = async work => { guard(currentEpoch); const value = await Promise.race([work(), cancelled]); guard(currentEpoch); return value }
    try {
      response = await stage(() => request(root + path, { method: 'POST', credentials: 'include', cache: 'no-store', redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(token ? { 'X-CSRF-Token': token } : {}) }, body: JSON.stringify(body) }))
      if (!response || !Number.isInteger(response.status) || response.redirected || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(response.headers?.get?.('Content-Type') || '')) throw fail('IDENTITY_RESULT_UNKNOWN', body.operationId)
      const data = await stage(() => response.json())
      if (response.status === 200 && data?.status === 'authenticated' && exact(data, ['status', 'principalId', 'canCreate', 'csrfToken', 'refreshAfterMs', 'expiresInMs']) && principal(data.principalId) && data.canCreate === false &&
        typeof data.csrfToken === 'string' && /^[A-Za-z0-9_-]{43}(?![\s\S])/.test(data.csrfToken) && Number.isInteger(data.expiresInMs) && data.expiresInMs >= 1000 && data.expiresInMs <= 4000 &&
        Number.isInteger(data.refreshAfterMs) && data.refreshAfterMs >= 250 && data.refreshAfterMs <= Math.min(1000, Math.floor(data.expiresInMs / 3)) && path !== '/logout') return { data, started }
      if (response.status === 503 && data?.status === 'unknown' && ['IDENTITY_UNKNOWN', 'COMMIT_UNKNOWN'].includes(data.code) &&
        exact(data, ['status', 'code', ...(data.operationId === undefined ? [] : ['operationId'])]) &&
        (data.operationId === undefined || body.operationId && data.operationId === body.operationId)) return { data, started }
      if (response.status === 401 && exact(data, ['status', 'code']) && data.status === 'denied' && data.code === 'IDENTITY_DENIED') return { data, started }
      if (response.status === 200 && path === '/logout' && exact(data, ['status']) && data.status === 'signed-out') return { data, started }
      throw fail('IDENTITY_RESULT_UNKNOWN', body.operationId)
    } finally {
      clearTimeout(timer); controllers.delete(controller); controller.abort()
      try { const closing = response?.body?.cancel?.(); if (closing) Promise.resolve(closing).catch(() => {}) } catch (_) { /* Already consumed bodies can be locked. */ }
    }
  }
  function accept(data, started, query, currentEpoch) {
    guard(currentEpoch)
    if (query && requiresLogin) { clear('unknown', 'IDENTITY_UNKNOWN'); return state() }
    let wall = started.wall + data.expiresInMs, mono = started.mono + data.expiresInMs
    if (query && leaseWall) { wall = Math.min(wall, leaseWall); mono = Math.min(mono, leaseMono) }
    if (Math.floor(Math.min(wall - Date.now(), mono - monotonic())) <= 0 || Date.now() < started.wall) {
      requiresLogin = true; clear('unknown', 'IDENTITY_UNKNOWN'); return state()
    }
    const changed = status !== 'authenticated' || principalId !== data.principalId || csrf !== data.csrfToken
    stopTimers(); if (changed) generation++
    status = 'authenticated'; principalId = data.principalId; csrf = lastCsrf = data.csrfToken; code = null; refreshAfterMs = data.refreshAfterMs
    leaseWall = wall; leaseMono = mono; leaseStarted = started.wall; requiresLogin = false
    expiryTimer = setTimeout(expire, remaining())
    refreshTimer = setTimeout(() => { if (!disposed) void refresh().catch(() => {}) }, Math.min(refreshAfterMs, Math.max(1, Math.floor(remaining() / 3))))
    notify(); guard(currentEpoch); return state()
  }
  async function execute(path, body, token, currentEpoch, record, query = false) {
    try {
      const { data, started } = await send(path, body, token, currentEpoch); guard(currentEpoch)
      if (record) record.status = data.status
      if (data.status === 'authenticated') return accept(data, started, query, currentEpoch)
      clear(data.status, data.code || null, record ? record.operationId : operationId)
      return state()
    } catch (_) {
      if (disposed || currentEpoch !== epoch) throw fail('IDENTITY_CONTEXT_CHANGED', record && record.operationId)
      if (record) record.status = 'unknown'
      clear('unknown', 'IDENTITY_UNKNOWN', record ? record.operationId : operationId)
      throw fail('IDENTITY_REQUEST_UNKNOWN', record && record.operationId)
    }
  }
  async function login(input) {
    if (disposed) throw fail('IDENTITY_DISPOSED')
    const value = typeof input === 'string' ? { loginCode: input } : input
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['loginCode', 'operationId'].includes(key)) || typeof value.loginCode !== 'string' ||
      !value.loginCode.length || /[\ud800-\udfff]/u.test(value.loginCode) || typeof globalThis.TextEncoder !== 'function' || new globalThis.TextEncoder().encode(value.loginCode).byteLength > 4096) throw fail('IDENTITY_LOGIN_INVALID')
    let loginCode = value.loginCode
    const explicit = value.operationId !== undefined
    const latest = operations.get(operationId)
    const pending = latest && ['pending', 'unknown'].includes(latest.status) ? latest : Array.from(operations.values()).find(record => ['pending', 'unknown'].includes(record.status))
    const key = value.operationId === undefined ? pending?.operationId || newId() : value.operationId
    if (!id(key)) throw fail('IDENTITY_OPERATION_REQUIRED')
    const prior = operations.get(key), record = prior || { operationId: key, codeHash: null, status: 'pending' }
    operations.set(key, record); clear('authenticating', null, key); const currentEpoch = epoch
    try {
      const codeHash = await digest(loginCode); guard(currentEpoch)
      if (record.codeHash && record.codeHash !== codeHash) throw fail('IDEMPOTENCY_MISMATCH', key)
      const reused = Array.from(operations.values()).find(other => other !== record && other.codeHash === codeHash)
      if (reused) {
        operations.delete(key)
        if (explicit) throw fail('IDENTITY_CODE_REUSED', key)
        return queryLogin(reused.operationId)
      }
      record.codeHash = codeHash
      if (prior) { loginCode = null; return execute('/query', { docId, operationId: key, codeHash }, null, currentEpoch, record, true) }
      requiresLogin = false; leaseWall = leaseMono = 0
      const body = { docId, operationId: key, loginCode }; loginCode = null
      return execute('', body, null, currentEpoch, record)
    } catch (error) {
      loginCode = null
      if (disposed || currentEpoch !== epoch) throw fail('IDENTITY_CONTEXT_CHANGED', key)
      record.status = 'unknown'; clear('unknown', 'IDENTITY_UNKNOWN', key); throw error
    }
  }
  function queryLogin(input) {
    if (disposed) return Promise.reject(fail('IDENTITY_DISPOSED'))
    const value = typeof input === 'string' ? { operationId: input } : input
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['operationId', 'codeHash'].includes(key)) || !id(value.operationId)) return Promise.reject(fail('IDENTITY_ORIGINAL_KEY_REQUIRED'))
    const prior = operations.get(value.operationId), codeHash = value.codeHash === undefined ? prior?.codeHash : value.codeHash
    if (!hash(codeHash) || prior?.codeHash && prior.codeHash !== codeHash) return Promise.reject(fail('IDEMPOTENCY_MISMATCH', value.operationId))
    const record = prior || { operationId: value.operationId, codeHash, status: 'unknown' }; operations.set(record.operationId, record)
    clear('authenticating', null, record.operationId)
    return execute('/query', { docId, operationId: record.operationId, codeHash }, null, epoch, record, true)
  }
  // A public-link exchange supplies only a CSRF bootstrap value; the Cookie is always revalidated by the server.
  const hasLoginPending = () => Array.from(operations.values()).some(record => ['pending', 'unknown'].includes(record.status))
  function prepareShareLinkAccess() {
    expire()
    if (disposed) throw fail('IDENTITY_DISPOSED')
    if (shareAccess || refreshing || ['authenticating', 'signing-out'].includes(status) || hasLoginPending()) throw fail('IDENTITY_ORIGINAL_KEY_REQUIRED')
    const permit = { epoch, generation }
    shareAccess = permit
    // Keep the expiry barrier. An old automatic /current must not race the unlock Cookie.
    clearTimeout(refreshTimer); refreshTimer = null
    const current = () => {
      expire()
      return !disposed && shareAccess === permit && epoch === permit.epoch && generation === permit.generation && !hasLoginPending()
    }
    return Object.freeze({
      current,
      cancel(confirmedUnsentOrRejected = false) {
        if (shareAccess !== permit) return
        shareAccess = null
        if (confirmedUnsentOrRejected && status === 'authenticated' && remaining() > 0) {
          refreshTimer = setTimeout(() => { if (!disposed) void refresh().catch(() => {}) }, Math.min(refreshAfterMs, Math.max(1, Math.floor(remaining() / 3))))
        }
      },
      resumeCurrentSession(input) {
        if (!current()) return Promise.reject(fail('IDENTITY_CONTEXT_CHANGED'))
        if (!exact(input, ['csrfToken']) || typeof input.csrfToken !== 'string' || !/^[A-Za-z0-9_-]{43}(?![\s\S])/.test(input.csrfToken)) return Promise.reject(fail('IDENTITY_CSRF_REQUIRED'))
        requiresLogin = false; leaseWall = leaseMono = 0; clear('authenticating', null, null)
        return execute('/current', { docId }, input.csrfToken, epoch)
      },
    })
  }
  function resumeCurrentSession(input) {
    if (disposed) return Promise.reject(fail('IDENTITY_DISPOSED'))
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1 ||
      typeof input.csrfToken !== 'string' || !/^[A-Za-z0-9_-]{43}(?![\s\S])/.test(input.csrfToken)) return Promise.reject(fail('IDENTITY_CSRF_REQUIRED'))
    if (shareAccess || ['authenticated', 'authenticating'].includes(status) || hasLoginPending()) return Promise.reject(fail('IDENTITY_ORIGINAL_KEY_REQUIRED'))
    requiresLogin = false; leaseWall = leaseMono = 0; clear('authenticating', null, null)
    return execute('/current', { docId }, input.csrfToken, epoch)
  }
  function refresh() {
    expire()
    if (disposed || status !== 'authenticated' || !csrf) return Promise.reject(fail('IDENTITY_AUTHENTICATION_REQUIRED'))
    if (shareAccess) return Promise.reject(fail('IDENTITY_SHARE_LINK_PENDING'))
    if (refreshing) return refreshing
    const currentEpoch = epoch
    const work = execute('/current', { docId }, csrf, currentEpoch)
    refreshing = work; work.finally(() => { if (refreshing === work) refreshing = null }).catch(() => {})
    return work
  }
  function logout() {
    if (disposed) return Promise.reject(fail('IDENTITY_DISPOSED'))
    const token = lastCsrf; requiresLogin = true; leaseWall = leaseMono = 0; clear('signing-out')
    if (!token) { clear('unknown', 'IDENTITY_UNKNOWN'); return Promise.reject(fail('IDENTITY_CSRF_REQUIRED')) }
    return execute('/logout', { docId }, token, epoch)
  }
  return { isRemote: true, login, queryLogin, prepareShareLinkAccess, resumeCurrentSession, refresh, logout, getState: state, getCsrfToken() { expire(); return status === 'authenticated' ? csrf : null },
    subscribe(listener) { if (disposed || typeof listener !== 'function') throw fail('IDENTITY_SUBSCRIPTION_INVALID'); listeners.add(listener); listener(state()); return () => listeners.delete(listener) },
    dispose() { if (disposed) return; disposed = true; operations.clear(); clear('disposed', null, null); listeners.clear() } }
}
