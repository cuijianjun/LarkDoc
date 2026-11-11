/* global globalThis */
/**
 * editor-crdt-v1 持久协作桥。Hocuspocus 只承载鉴权和 stateless 帧；
 * 禁用默认 sync/update，只有匹配数据库 receipt 才能清除本地 pending。
 */
import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { createDurablePresence, PRESENCE_PROTOCOL } from './presence'

export const DURABLE_PROTOCOL_VERSION = 'editor-crdt-v1'
const integer = value => typeof value === 'string' && /^(0|[1-9][0-9]*)(?![\s\S])/.test(value)
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9._-]{1,128}(?![\s\S])/.test(value)
const hashPattern = /^sha256:[0-9a-f]{64}(?![\s\S])/
const principal = value => typeof value === 'string' && value.length > 0 && !value.includes('\0')
const pendingSchema = 'pending-snapshot-v1'
const latest = (left, right) => left.length > right.length || (left.length === right.length && left > right) ? left : right

function toBase64(bytes) {
  let text = ''
  for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i])
  return globalThis.btoa(text)
}
function fromBase64(text) {
  if (typeof text !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) {
    throw new Error('INVALID_BASE64')
  }
  return Uint8Array.from(globalThis.atob(text), char => char.charCodeAt(0))
}
async function payloadHash(bytes) {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))
  return 'sha256:' + Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')
}
function updateId() {
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')
}

class DurableProvider extends HocuspocusProvider {
  awarenessUpdateHandler() { /* 禁止stock awareness广播；只走下方受控临时状态。 */ }
  startSync() { this.configuration.durable.start() }
  forceSync() { this.configuration.durable.start() }
  documentUpdateHandler(update, origin) {
    if (origin !== this) this.configuration.durable.local(update)
  }
  onClose(payload) {
    super.onClose()
    this.configuration.durable.closed(payload && payload.event && payload.event.code)
  }
  onMessage(event) {
    try {
      super.onMessage(event)
    } catch (error) {
      this.configuration.durable.fail(error.message === 'UNCONTROLLED_FRAME' ? error.message : 'INVALID_FRAME')
    }
  }
}

export function createDurableCollaborationBridge(options = {}) {
  const { url, tenantId, docId } = options
  if (typeof url !== 'string' || !/^wss?:\/\//.test(url) || !identifier(tenantId) || !identifier(docId)) {
    throw new TypeError('持久协作桥需要 url、tenantId 和 docId')
  }
  const ydoc = new Y.Doc({ gc: false })
  const pending = new Map()
  const receipts = new Map()
  const recovered = new Set(), queriedRecovered = new Set()
  let provider, destroyed = false, status = 'connecting', epoch = null, revision = '0', lastSeq = '0'
  let principalId = null, helloStarted = false, restoring = false, restoredScope = false
  let canWrite = false, outgoing = Promise.resolve(), incoming = Promise.resolve(), resolveReady, rejectReady
  let commentsEnabled = false
  let authorizationNotified = false, authorizationAttempts = 0, authorizationTimer = null, connecting = null, failureCode = null
  const closeWaiters = new Set()
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
  // 宿主可以稍后等待 ready；先挂拒绝处理，避免网络事件触发未处理 Promise。
  ready.catch(() => {})
  const state = () => ({ status, epoch, revision, lastSeq, canWrite,
    pending: Array.from(pending.values(), item => ({ updateId: item.updateId, status: item.status, epoch: item.epoch })),
    lastReceipt: Array.from(receipts.values()).slice(-1)[0] || null })
  const changed = () => { if (options.onState) options.onState(state()) }
  const send = message => provider.sendStateless(JSON.stringify({ protocolVersion: DURABLE_PROTOCOL_VERSION, tenantId, docId, ...message }))
  const presence = options.presence === true ? createDurablePresence(ydoc, send, state) : null
  function clearAuthorizationTimer() { clearTimeout(authorizationTimer); authorizationTimer = null }
  function requireAuthorization() {
    if (!options.onAuthorizationRequired || authorizationNotified || destroyed || status === 'quarantined') return
    authorizationNotified = true
    // A failed handshake cannot be reused by the new authorization attempt.
    connecting = null
    if (++authorizationAttempts > 3) return fail('TICKET_RENEWAL_LIMIT')
    if (!authorizationTimer) authorizationTimer = setTimeout(() => fail('TICKET_RENEWAL_TIMEOUT'), 15000)
    options.onAuthorizationRequired()
  }
  function renewAuthorization() {
    if (!options.onAuthorizationRequired) return fail('AUTHENTICATION_REQUIRED')
    if (destroyed || status === 'quarantined') return
    // A current-admission failure can arrive as a stateless ERROR before the close frame.
    // Keep the original pending keys and the same bounded renewal path as ticket denial.
    provider.configuration.websocketProvider.disconnect()
    durable.closed(4403)
  }
  function fail(code) {
    if (destroyed || status === 'quarantined') return
    status = 'quarantined'; canWrite = false; failureCode = code
    clearAuthorizationTimer()
    presence?.closed()
    commentsEnabled = false
    if (/AUTHENTICATION|AUTHORIZATION|SESSION_DENIED|DOCUMENT_DENIED|RESOURCE_NOT_FOUND/.test(code) && options.onAuthorizationRequired) options.onAuthorizationRequired()
    const error = new Error(code); error.code = code
    rejectReady(error)
    provider.configuration.websocketProvider.disconnect()
    changed()
    if (options.onError) options.onError(error)
  }
  function validateReceipt(receipt) {
    if (!receipt || receipt.tenantId !== tenantId || receipt.docId !== docId ||
      receipt.protocolVersion !== DURABLE_PROTOCOL_VERSION || receipt.status !== 'durable' ||
      receipt.epoch !== epoch || typeof receipt.updateId !== 'string' || !hashPattern.test(receipt.payloadHash) ||
      !integer(receipt.seq) || !integer(receipt.contentRevision) ||
      typeof receipt.committedAt !== 'string' || !Number.isFinite(Date.parse(receipt.committedAt))) throw new Error('INVALID_RECEIPT')
    const item = pending.get(receipt.updateId)
    if (item && ((item.payloadHash !== receipt.payloadHash && !(recovered.has(item.updateId) && item.payloadHash == null)) ||
      item.epoch !== receipt.epoch)) throw new Error('RECEIPT_MISMATCH')
    const prior = receipts.get(receipt.updateId)
    if (prior && Object.keys(prior).some(key => prior[key] !== receipt[key])) throw new Error('RECEIPT_MISMATCH')
    return item
  }
  function acknowledge(receipt, fromQuery = false) {
    const item = validateReceipt(receipt)
    revision = latest(revision, receipt.contentRevision); lastSeq = latest(lastSeq, receipt.seq)
    receipts.set(receipt.updateId, Object.freeze({ ...receipt }))
    if (item && (!recovered.has(item.updateId) || (fromQuery && queriedRecovered.has(item.updateId)))) {
      pending.delete(item.updateId)
      recovered.delete(item.updateId); queriedRecovered.delete(item.updateId)
      if (options.onReceipt) options.onReceipt(receipt)
    }
  }
  async function receive(text) {
    if (destroyed || status === 'quarantined') return
    const message = JSON.parse(text)
    if (message.protocolVersion !== DURABLE_PROTOCOL_VERSION || message.tenantId !== tenantId || message.docId !== docId) throw new Error('PROTOCOL_MISMATCH')
    if (message.type === 'READY') {
      if (!integer(message.epoch) || !integer(message.revision) || !integer(message.lastSeq) ||
        message.field !== 'default' || typeof message.canWrite !== 'boolean' || !principal(message.principalId)) throw new Error('INVALID_READY')
      if (epoch !== null && message.epoch !== epoch) throw new Error('EPOCH_MISMATCH')
      if (principalId !== null && message.principalId !== principalId) throw new Error('PRINCIPAL_MISMATCH')
      if (epoch === null && pending.size) throw new Error('PRE_READY_PENDING')
      epoch = message.epoch; principalId = message.principalId
      Y.applyUpdate(ydoc, fromBase64(message.payloadBase64), provider)
      revision = latest(revision, message.revision); lastSeq = latest(lastSeq, message.lastSeq); canWrite = message.canWrite
      status = pending.size ? 'blocked' : 'ready'
      clearAuthorizationTimer(); authorizationNotified = false; authorizationAttempts = 0
      if (pending.size) canWrite = false
      presence?.ready(message.presenceProtocol)
      commentsEnabled = message.commentsProtocol === 'comments-v1' && typeof options.onCommentsChanged === 'function'
      resolveReady(state())
      // 断线不证明未提交，不能自动重发。只有知道原 expectedRevision 才能 QUERY。
      changed()
    } else if (message.type === 'COMMENTS_CHANGED') {
      if (!commentsEnabled || !['ready', 'blocked'].includes(status) || message.epoch !== epoch) throw new Error('INVALID_COMMENT_SIGNAL')
      options.onCommentsChanged()
    } else if (message.type === 'PRESENCE') {
      if (!presence || !['ready', 'blocked'].includes(status)) throw new Error('INVALID_PRESENCE')
      presence.receive(message)
    } else if (message.type === 'ACCEPTED') {
      const item = Array.from(pending.values()).find(value => value.operationId === message.operationId)
      if (!item || message.updateId !== item.updateId || !integer(message.expectedRevision) ||
        recovered.has(item.updateId) || (item.expectedRevision !== undefined && item.expectedRevision !== message.expectedRevision)) throw new Error('INVALID_ACCEPTED')
      item.expectedRevision = message.expectedRevision; item.status = 'accepted'
      changed()
    } else if (message.type === 'COMMITTED') {
      if (status !== 'ready' && status !== 'blocked') throw new Error('NOT_READY')
      const bytes = fromBase64(message.payloadBase64)
      if (!message.receipt || await payloadHash(bytes) !== message.receipt.payloadHash) throw new Error('PAYLOAD_HASH_MISMATCH')
      // 无效元数据不能修改正文，应用失败也不能清除本地 pending。
      validateReceipt(message.receipt)
      Y.applyUpdate(ydoc, bytes, provider)
      acknowledge(message.receipt)
      changed()
    } else if (message.type === 'RECEIPT') {
      if (status !== 'ready' && status !== 'blocked') throw new Error('NOT_READY')
      const item = message.receipt && pending.get(message.receipt.updateId)
      if (item && recovered.has(item.updateId)) {
        if (!queriedRecovered.has(item.updateId)) return
        if (message.operationId !== item.operationId || item.expectedRevision === undefined ||
          message.expectedRevision !== item.expectedRevision || !hashPattern.test(item.payloadHash)) throw new Error('RECEIPT_MISMATCH')
      }
      if (item && message.expectedRevision !== undefined && message.expectedRevision !== item.expectedRevision) throw new Error('RECEIPT_MISMATCH')
      acknowledge(message.receipt, true); changed()
    } else if (message.type === 'ERROR') {
      if (message.code === 'AUTHENTICATION_REQUIRED') return renewAuthorization()
      const item = Array.from(pending.values()).find(value => value.operationId === message.operationId)
      if (!item) throw new Error(typeof message.code === 'string' ? message.code : 'SERVER_ERROR')
      queriedRecovered.delete(item.updateId)
      item.status = message.status === 'unknown' ? 'unknown' : 'failed'
      status = 'blocked'; canWrite = false
      changed()
      if (options.onError) options.onError(Object.assign(new Error(message.code || 'SERVER_ERROR'), { code: message.code || 'SERVER_ERROR' }))
    } else throw new Error('UNKNOWN_MESSAGE')
  }
  const durable = {
    start() {
      if (destroyed || status === 'quarantined') return
      if (restoring) return fail('PENDING_RECOVERY_IN_PROGRESS')
      if (restoredScope && (epoch === null || principalId === null || Array.from(pending.values()).some(item => item.epoch === null))) {
        return fail('PENDING_RECOVERY_SCOPE_UNKNOWN')
      }
      helloStarted = true; queriedRecovered.clear()
      send({ type: 'HELLO', epoch: epoch === null ? undefined : epoch, ...(presence ? { presenceProtocol: PRESENCE_PROTOCOL } : {}), ...(typeof options.onCommentsChanged === 'function' ? { commentsProtocol: 'comments-v1' } : {}) })
    },
    closed(code) {
      if (destroyed || status === 'quarantined') return
      status = 'disconnected'; canWrite = false
      presence?.closed()
      commentsEnabled = false
      if ([4401, 4403].includes(code)) requireAuthorization()
      queriedRecovered.clear()
      for (const item of pending.values()) if (item.status === 'pending' || item.status === 'accepted') item.status = 'unknown'
      changed()
    },
    local(update) {
      if (destroyed || status === 'quarantined') return
      const id = updateId(), bytes = Uint8Array.from(update)
      const item = { operationId: id, updateId: id, epoch, payloadBase64: toBase64(bytes), payloadHash: null,
        status: status === 'ready' ? 'pending' : 'unknown' }
      pending.set(id, item); changed()
      outgoing = outgoing.then(async () => {
        item.payloadHash = await payloadHash(bytes)
        if (destroyed || status === 'quarantined') return
        if (status === 'ready' && canWrite && item.epoch === epoch && item.status === 'pending') send({ type: 'UPDATE', ...item, status: undefined })
        else if (status === 'ready' && !canWrite) fail('WRITE_FORBIDDEN')
      }).catch(error => fail(error.message))
      // Y.Doc已发生修改：先保留原bytes/hash队列，再隔离并使整包导入失败。
      if (restoring) fail('PENDING_RECOVERY_IN_PROGRESS')
    },
    fail,
  }
  provider = new DurableProvider({
    url, name: `${tenantId}/${docId}`, document: ydoc, awareness: presence ? presence.awareness : null, token: options.ticket || '', durable, sessionAwareness: false,
    autoConnect: false, WebSocketPolyfill: options.WebSocketPolyfill,
    maxAttempts: 5, timeout: 15000,
    onMessage: ({ message }) => {
      // 配置也传给socket层，其原始事件尚无message；随后provider层才做帧校验。
      if (!message) return
      // Hocuspocus 4.7.1 在 MessageReceiver.apply 前同步发此事件；抛错阻止 stock sync 应用。
      if (message.readVarString() !== `${tenantId}/${docId}` || ![2, 5, 7].includes(message.readVarUint())) {
        throw new Error('UNCONTROLLED_FRAME')
      }
    },
    onStateless: ({ payload }) => {
      incoming = incoming.then(() => receive(payload)).catch(error => fail(error.message))
    },
    onAuthenticationFailed: renewAuthorization,
  })
  if (options.autoConnect !== false) provider.configuration.websocketProvider.connect().catch(() => fail('CONNECTION_UNAVAILABLE'))
  const api = {
    ydoc, provider, ready, getState: state,
    exportPending: () => Array.from(pending.values(), item => ({ ...item })),
    async exportPendingSnapshot() {
      if (restoring) throw new Error('PENDING_RECOVERY_IN_PROGRESS')
      await outgoing
      return Object.freeze({ schemaVersion: pendingSchema, protocolVersion: DURABLE_PROTOCOL_VERSION, tenantId, docId,
        epoch, principalId, pending: Object.freeze(Array.from(pending.values(), item => Object.freeze({ ...item }))) })
    },
    async restorePending(snapshot) {
      if (options.autoConnect !== false || helloStarted || destroyed || restoring || pending.size || status !== 'connecting') {
        throw new Error('PENDING_RECOVERY_NOT_ALLOWED')
      }
      const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
      const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
      const fields = ['schemaVersion','protocolVersion','tenantId','docId','epoch','principalId','pending']
      if (!object(snapshot) || Object.keys(snapshot).length !== fields.length || Object.keys(snapshot).some(key => !fields.includes(key)) ||
        snapshot.schemaVersion !== pendingSchema || snapshot.protocolVersion !== DURABLE_PROTOCOL_VERSION || snapshot.tenantId !== tenantId || snapshot.docId !== docId ||
        (snapshot.epoch !== null && !integer(snapshot.epoch)) || (snapshot.principalId !== null && !principal(snapshot.principalId)) || !Array.isArray(snapshot.pending)) {
        throw new Error('INVALID_PENDING_SNAPSHOT')
      }
      const snapshotEpoch = snapshot.epoch, snapshotPrincipal = snapshot.principalId
      const ids = new Set(), operations = new Set()
      const records = snapshot.pending.map(item => {
        if (!object(item) || Object.keys(item).some(key => !['operationId','updateId','epoch','payloadBase64','payloadHash','expectedRevision','status'].includes(key)) ||
          !identifier(item.operationId) || !identifier(item.updateId) || ids.has(item.updateId) || operations.has(item.operationId) ||
          (item.epoch !== null && (!integer(item.epoch) || item.epoch !== snapshotEpoch)) ||
          (own(item, 'payloadHash') && item.payloadHash !== null && (typeof item.payloadHash !== 'string' || !hashPattern.test(item.payloadHash))) ||
          (own(item, 'expectedRevision') && !integer(item.expectedRevision))) throw new Error('INVALID_PENDING_SNAPSHOT')
        const bytes = fromBase64(item.payloadBase64)
        if (!bytes.length || bytes.length > 256 * 1024 || toBase64(bytes) !== item.payloadBase64) throw new Error('INVALID_PENDING_SNAPSHOT')
        const copy = { operationId: item.operationId, updateId: item.updateId, epoch: item.epoch, payloadBase64: item.payloadBase64,
          ...(own(item, 'payloadHash') ? { payloadHash: item.payloadHash } : {}),
          ...(own(item, 'expectedRevision') ? { expectedRevision: item.expectedRevision } : {}), status: 'unknown' }
        if (new TextEncoder().encode(JSON.stringify({ type: 'UPDATE', protocolVersion: DURABLE_PROTOCOL_VERSION, tenantId, docId, ...copy })).length > 390 * 1024) {
          throw new Error('INVALID_PENDING_SNAPSHOT')
        }
        ids.add(copy.updateId); operations.add(copy.operationId)
        return { copy, bytes }
      })
      restoring = true
      try {
        for (const { copy, bytes } of records) if (copy.payloadHash != null && await payloadHash(bytes) !== copy.payloadHash) {
          throw new Error('PENDING_PAYLOAD_HASH_MISMATCH')
        }
        if (destroyed || helloStarted || pending.size || status !== 'connecting') throw new Error('PENDING_RECOVERY_INTERRUPTED')
        epoch = snapshotEpoch; principalId = snapshotPrincipal; restoredScope = true
        for (const { copy } of records) { pending.set(copy.updateId, copy); recovered.add(copy.updateId) }
      } finally { restoring = false }
      changed()
      return state()
    },
    queryPending() {
      if (destroyed || (status !== 'ready' && status !== 'blocked')) return 0
      let sent = 0
      for (const item of pending.values()) if (typeof item.payloadHash === 'string' && hashPattern.test(item.payloadHash) && item.expectedRevision !== undefined && item.epoch === epoch) {
        send({ type: 'QUERY', operationId: item.operationId, updateId: item.updateId,
          payloadHash: item.payloadHash, epoch: item.epoch, expectedRevision: item.expectedRevision })
        if (recovered.has(item.updateId)) queriedRecovered.add(item.updateId)
        sent++
      }
      return sent
    },
    // Explicit current-authority recovery; corruption/epoch quarantine is never recoverable here.
    resumeAuthorization() {
      if (status === 'quarantined' && ['TICKET_RENEWAL_LIMIT', 'TICKET_RENEWAL_TIMEOUT', 'AUTHENTICATION_REQUIRED', 'PG_SESSION_DENIED', 'PG_DOCUMENT_DENIED', 'PG_PERMISSION_NOT_FOUND', 'RESOURCE_NOT_FOUND'].includes(failureCode)) {
        status = 'disconnected'; failureCode = null
      }
      clearAuthorizationTimer(); authorizationAttempts = 0; authorizationNotified = false
      return api.connect()
    },
    connect() {
      if (restoring) return Promise.reject(new Error('PENDING_RECOVERY_IN_PROGRESS'))
      if (destroyed || status === 'quarantined') return Promise.reject(new Error('COLLABORATION_ISOLATED'))
      if (connecting) return connecting
      const transport = provider.configuration.websocketProvider
      const work = (async () => {
        const socket = transport.webSocket
        if (socket?.readyState === 2) await new Promise((resolve, reject) => {
          let timer
          const finish = error => { clearTimeout(timer); socket.removeEventListener('close', closed); closeWaiters.delete(cancel); error ? reject(error) : resolve() }
          const closed = () => finish(), cancel = () => finish(new Error('DESTROYED'))
          closeWaiters.add(cancel); socket.addEventListener('close', closed, { once: true })
          timer = setTimeout(() => finish(new Error('SOCKET_CLOSE_TIMEOUT')), 5000)
          if (socket.readyState === 3) closed()
        })
        if (destroyed || status === 'quarantined') throw new Error('COLLABORATION_ISOLATED')
        authorizationNotified = false
        return transport.connect()
      })()
      connecting = work
      const clear = () => { if (connecting === work) connecting = null }
      work.then(clear, clear)
      return work
    },
    disconnect: () => provider.configuration.websocketProvider.disconnect(),
    // 显式恢复/代际屏障：只隔离旧连接，绝不重写epoch或把旧pending合到新baseline。
    isolateEpoch: (reason = 'EPOCH_MISMATCH') => fail(reason),
    destroy() {
      if (destroyed) return
      destroyed = true; status = 'destroyed'; canWrite = false
      clearAuthorizationTimer(); closeWaiters.forEach(cancel => cancel())
      rejectReady(new Error('DESTROYED'))
      presence?.destroy()
      provider.destroy(); ydoc.destroy(); changed()
    },
  }
  return api
}
