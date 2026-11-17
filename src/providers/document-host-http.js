/* global globalThis */
const id = value => typeof value === 'string' && /^[A-Za-z0-9._-]{1,128}(?![\s\S])/.test(value)
const nodeId = value => typeof value === 'string' && /^[df]-[a-f0-9]{64}(?![\s\S])/.test(value)
const hash = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}(?![\s\S])/.test(value)
const fail = (code, extra = {}) => Object.assign(new Error(code), { code, ...extra })
const nonce = () => {
  if (typeof globalThis.crypto?.getRandomValues !== 'function') throw fail('HOST_CRYPTO_REQUIRED')
  return [...globalThis.crypto.getRandomValues(new Uint8Array(16))].map(value => value.toString(16).padStart(2, '0')).join('')
}
export const DOCUMENT_REPORT_REASONS = Object.freeze([
  ['fraud', '欺诈'], ['illegal', '违规行为及违禁品'], ['political-rumor', '涉政谣言'], ['pornography', '色情低俗'],
  ['terror', '恐怖暴力'], ['religion', '非法宗教活动'], ['harassment', '引流/骚扰'], ['other', '其他'],
].map(([value, label]) => Object.freeze({ value, label })))

/** 当前身份下的目录读取和举报原操作；不把客户端身份字段送入写入请求。 */
export function createHttpDocumentHostProvider(options = {}) {
  if (!id(options.tenantId) || !id(options.docId) || typeof options.csrfToken !== 'function' || typeof options.getIdentityState !== 'function') throw fail('HOST_CONFIGURATION')
  const request = options.request || globalThis.fetch?.bind(globalThis)
  if (typeof request !== 'function') throw fail('HOST_CONFIGURATION')
  const base = `${String(options.baseUrl || '').replace(/\/+$/, '')}/editor/v1/tenants/${options.tenantId}/documents/${options.docId}`
  const pending = new Map(), controllers = new Set()
  let generation = 0, disposed = false
  const capture = () => {
    const identity = options.getIdentityState(), session = options.getSession?.()
    if (disposed || identity?.status !== 'authenticated' || !id(identity.principalId) || options.getCapabilities?.()?.canView === false || session?._destroyed) throw fail('HOST_IDENTITY_REQUIRED')
    return { actor: identity.principalId, identity: identity.generation, session, privateIdentity: session?._privateIdentityGeneration, authorization: session?._authorizationGeneration, generation }
  }
  const current = scope => {
    try { const next = capture(); return Object.keys(scope).every(key => next[key] === scope[key]) } catch { return false }
  }
  async function json(path, body) {
    const scope = capture(), controller = new AbortController(); controllers.add(controller)
    const timer = setTimeout(() => controller.abort(), 10000)
    try {
      const headers = { Accept: 'application/json' }
      if (body) Object.assign(headers, { 'Content-Type': 'application/json', 'X-CSRF-Token': options.csrfToken(), 'Idempotency-Key': body.operationId })
      const response = await request(base + path, { method: body ? 'POST' : 'GET', headers, credentials: 'include', cache: 'no-store', redirect: 'error', signal: controller.signal, ...(body ? { body: JSON.stringify(body) } : {}) })
      if (response.redirected || !/^application\/json(?:\s*;|$)/i.test(response.headers?.get('content-type') || '')) throw fail('HOST_RESULT_UNKNOWN')
      const data = await response.json()
      if (!current(scope) || controller.signal.aborted) throw fail('HOST_CONTEXT_CHANGED')
      return { data, status: response.status, actor: scope.actor }
    } finally { clearTimeout(timer); controllers.delete(controller) }
  }
  function result(record, response) {
    const { data: v, status, actor } = response
    if (status === 200 && v?.status === 'committed' && Object.keys(v).length === 10 && v.tenantId === options.tenantId && v.docId === options.docId && v.principalId === actor &&
      v.operationId === record.operationId && hash(v.requestHash) && /^report-[a-f0-9]{64}$/.test(v.reportId) && v.reviewStatus === 'received' &&
      typeof v.receivedAt === 'string' && /^\d{4}-\d\d-\d\dT/.test(v.receivedAt) && Number.isFinite(Date.parse(v.receivedAt)) && typeof v.replayed === 'boolean') {
      if (record.requestHash && record.requestHash !== v.requestHash) throw fail('HOST_RESULT_UNKNOWN')
      record.status = 'committed'; record.requestHash = v.requestHash; return Object.freeze({ ...v })
    }
    // A command may commit before the final current-permission receipt read is denied.
    // HTTP rejection alone cannot prove that the original write did not happen.
    if (status >= 400 && status < 500) throw fail(v?.code || 'HOST_REJECTED', { status })
    if (v?.status === 'unknown' && v.operationId === record.operationId && hash(v.requestHash)) { if (record.requestHash && record.requestHash !== v.requestHash) throw fail('HOST_RESULT_UNKNOWN'); record.requestHash = v.requestHash }
    record.status = 'unknown'; throw fail('HOST_RESULT_UNKNOWN', { operationId: record.operationId })
  }
  const owned = operationId => {
    const record = pending.get(operationId)
    if (!record || record.actor !== capture().actor) throw fail('HOST_ORIGINAL_OPERATION_REQUIRED')
    return record
  }
  return {
    capture, current,
    async library() {
      const scope = capture(), nodes = new Map(), cursors = new Set(); let cursor
      do {
        const { data, status } = await json('/knowledge-library' + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''))
        if (!current(scope)) throw fail('HOST_CONTEXT_CHANGED')
        if (status !== 200 || data?.tenantId !== options.tenantId || data.docId !== options.docId || data.principalId !== scope.actor ||
          !Array.isArray(data.items) || data.items.length > 50 || (data.nextCursor !== null && (!nodeId(data.nextCursor) || data.items.length !== 50))) throw fail('HOST_LIBRARY_UNAVAILABLE')
        for (const value of data.items) {
          if (!value || !nodeId(value.id) || nodes.has(value.id) || (value.parentId !== null && (!nodeId(value.parentId) || !value.parentId.startsWith('f-'))) ||
            (value.id.startsWith('d-') ? !id(value.docId) : value.docId !== undefined) || typeof value.displayName !== 'string' || !value.displayName || value.displayName.length > 255 || /[\p{Cc}]/u.test(value.displayName)) throw fail('HOST_LIBRARY_INVALID')
          if (nodes.size >= 200) throw fail('LIBRARY_LIMIT')
          nodes.set(value.id, { ...value })
        }
        cursor = data.nextCursor
        if (cursor && (cursors.has(cursor) || data.items.at(-1)?.id !== cursor)) throw fail('HOST_LIBRARY_INVALID')
        if (cursor) cursors.add(cursor)
      } while (cursor)
      const build = (node, seen = new Set()) => {
        if (seen.has(node.id) || seen.size > 8) throw fail('HOST_LIBRARY_INVALID')
        const ancestry = new Set([...seen, node.id]), children = [...nodes.values()].filter(child => child.parentId === node.id).map(child => build(child, ancestry))
        return { id: node.id, displayName: node.displayName, ...(node.docId ? { docId: node.docId } : {}), ...(!node.docId || children.length ? { children } : {}) }
      }
      // Validate every path, including disconnected cycles, before any names are published.
      for (const node of nodes.values()) { const seen = new Set(); let at = node; while (at) { if (seen.has(at.id) || seen.size > 8) throw fail('HOST_LIBRARY_INVALID'); seen.add(at.id); at = nodes.get(at.parentId) } }
      return { status: 'resolved', items: [...nodes.values()].filter(node => !nodes.has(node.parentId)).map(node => build(node)) }
    },
    async submitReport({ reason, description = '' }) {
      const scope = capture()
      if (!DOCUMENT_REPORT_REASONS.some(item => item.value === reason) || typeof description !== 'string' || description.length > 200 || description.includes('\0')) throw fail('HOST_REPORT_INVALID')
      if ([...pending.values()].some(record => record.actor === scope.actor && record.status === 'unknown')) throw fail('HOST_ORIGINAL_OPERATION_REQUIRED')
      const operationId = 'report-' + nonce()
      const record = { actor: scope.actor, operationId, status: 'unknown' }; pending.set(operationId, record)
      options.onPending?.({ operationId })
      try { return result(record, await json('/report-operations', { operationId, reason, description })) }
      catch (error) { throw Object.assign(error, { operationId, unknown: record.status === 'unknown' }) }
    },
    async queryReport(operationId) {
      const record = owned(operationId)
      try { return result(record, await json('/report-operations/' + operationId + (record.requestHash ? `?requestHash=${record.requestHash}` : ''))) }
      catch (error) { throw Object.assign(error, { operationId, unknown: record.status === 'unknown' }) }
    },
    resumeReport(value) {
      if (!value || !id(value.operationId) || (value.requestHash !== undefined && !hash(value.requestHash))) throw fail('HOST_ORIGINAL_OPERATION_REQUIRED')
      if (!pending.has(value.operationId)) pending.set(value.operationId, { ...value, actor: capture().actor, status: 'unknown' })
    },
    getPending() { try { const actor = capture().actor; return [...pending.values()].filter(record => record.actor === actor && record.status === 'unknown').map(record => ({ operationId: record.operationId, requestHash: record.requestHash })) } catch { return [] } },
    reset() { generation++; controllers.forEach(controller => controller.abort()); controllers.clear() },
    destroy() { this.reset(); disposed = true; pending.clear() },
  }
}

/** 宿主桥接保留真实用户激活；窗口创建失败不返回成功。飞书只是参照，不自动绑定本地文档。 */
export function createHttpDocumentHost(options) {
  const provider = createHttpDocumentHostProvider(options), open = options.openWindow || ((url) => globalThis.open(url, '_blank'))
  const channels = new Set()
  const navigate = target => {
    const scope = provider.capture()
    const url = new URL(target, globalThis.location.href)
    if (url.origin !== globalThis.location.origin || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw fail('HOST_TARGET_INVALID')
    const key = nonce(), fragment = new URLSearchParams(url.hash.slice(1)); fragment.set('handoff', key); url.hash = fragment.toString()
    const channel = new globalThis.BroadcastChannel('larkdoc-host-' + key)
    let popup
    const close = () => { clearInterval(timer); channel.close(); channels.delete(close) }
    const timer = setInterval(() => { if (popup?.closed) close() }, 10000); channels.add(close)
    channel.onmessage = event => {
      if (event.data?.type !== 'identity-request') return
      try {
        const current = provider.capture()
        if (current.actor === scope.actor) channel.postMessage({ type: 'identity', principalId: current.actor, csrfToken: options.csrfToken() })
      } catch { /* A denied source cannot authorize a child page. */ }
    }
    popup = open(url.href)
    if (!popup) { close(); throw fail('HOST_POPUP_BLOCKED') }
    popup.opener = null; return true
  }
  return {
    provider,
    handleAction(event) {
      provider.capture()
      if (event.action === 'list-knowledge-library') return provider.library()
      if (event.action === 'report') return !event.target || event.target === 'document' ? navigate(options.reportUrl()) : false
      if (event.action === 'open-document-reference') return navigate(options.documentUrl(event.documentId))
      if (event.action === 'open-in-app') {
        if (typeof options.openInApp === 'function') return options.openInApp(event)
        return navigate(options.documentUrl(options.docId, { standalone: true }))
      }
      return false
    },
    destroy() { channels.forEach(close => close()); provider.destroy() },
  }
}

/** 同源新页交接：URL 只含随机通道标识，不存 Cookie、CSRF 或身份；源页关闭即结束。 */
export function receiveHttpDocumentHostIdentity() {
  const url = new URL(globalThis.location.href), fragment = new URLSearchParams(url.hash.slice(1)), key = fragment.get('handoff')
  if (!/^[a-f0-9]{32}$/.test(key || '')) return Promise.reject(fail('HOST_HANDOFF_REQUIRED'))
  return new Promise((resolve, reject) => {
    const channel = new globalThis.BroadcastChannel('larkdoc-host-' + key)
    const finish = (error, value) => { clearTimeout(timer); channel.close(); if (error) reject(error); else resolve(value) }
    const timer = setTimeout(() => finish(fail('HOST_HANDOFF_EXPIRED')), 5000)
    channel.onmessage = event => {
      const value = event.data
      if (value?.type !== 'identity' || !id(value.principalId) || !/^[A-Za-z0-9_-]{43}$/.test(value.csrfToken || '')) return
      finish(null, { principalId: value.principalId, csrfToken: value.csrfToken })
    }
    channel.postMessage({ type: 'identity-request' })
  })
}

export async function mountHttpDocumentReport(options) {
  const { createDocumentReport } = await import('../ui/documentHost')
  return createDocumentReport(options)
}
