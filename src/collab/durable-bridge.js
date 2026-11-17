/* global globalThis */
/**
 * editor-crdt-v1 持久协作桥。Hocuspocus 只承载鉴权和 stateless 帧；
 * 禁用默认 sync/update，只有匹配数据库 receipt 才能清除本地 pending。
 */
import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { Awareness, removeAwarenessStates } from 'y-protocols/awareness'
import { validResourceId as identifier, own, matches, project, hex, payloadHash, isRecord, sendFrame, PRESENCE_PROTOCOL } from './protocol'

export const DURABLE_PROTOCOL_VERSION = 'editor-crdt-v1'
const pendingSchema = 'pending-snapshot-v1'

function toBase64(bytes) {
  let text = ''
  for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i])
  return globalThis.btoa(text)
}
function updateId() {
  return hex(globalThis.crypto.getRandomValues(new Uint8Array(16)))
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
  const scope = { protocolVersion: DURABLE_PROTOCOL_VERSION, tenantId, docId }
  const pending = new Map()
  const data = { status: 'connecting', epoch: null, revision: '0', lastSeq: '0', canWrite: false, principalId: null, commentsEnabled: false }
  let provider, operations, transportGeneration = 0
  let helloStarted = false, restoring = false, restoredScope = false
  let outgoing = Promise.resolve(), incoming = Promise.resolve(), resolveReady, rejectReady
  const authority = { notified: false, attempts: 0, timer: null }
  let connecting = null, failureCode = null, connectionGeneration = 0
  const closeWaiters = new Set()
  const isolated = () => data.status === 'destroyed' || data.status === 'quarantined'
  const active = () => data.status === 'ready' || data.status === 'blocked'
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
  // 宿主可以稍后等待 ready；先挂拒绝处理，避免网络事件触发未处理 Promise。
  ready.catch(() => {})
  const state = () => ({ status: data.status, epoch: data.epoch, revision: data.revision, lastSeq: data.lastSeq, canWrite: data.canWrite,
    pending: Array.from(pending.values(), item => project(item, ['updateId', 'status', 'epoch'])),
    lastReceipt: operations ? operations.lastReceipt() : null })
  const changed = () => { if (options.onState) options.onState(state()) }
  const resetConnection = () => { connectionGeneration++; connecting = null }
  const awareness = options.presence === true ? new Awareness(ydoc) : null
  let presence
  const closePresence = () => {
    if (presence) return presence.closed()
    if (!awareness) return
    removeAwarenessStates(awareness, [...awareness.getStates().keys()].filter(id => id !== ydoc.clientID), 'server')
    for (const id of awareness.meta.keys()) if (id !== ydoc.clientID) awareness.meta.delete(id)
  }
  function clearAuthorizationTimer() { clearTimeout(authority.timer); authority.timer = null }
  function requireAuthorization() {
    if (!options.onAuthorizationRequired || authority.notified || isolated()) return
    authority.notified = true
    // A failed handshake cannot be reused by the new authorization attempt.
    resetConnection()
    if (++authority.attempts > 3) return fail('TICKET_RENEWAL_LIMIT')
    if (!authority.timer) authority.timer = setTimeout(() => fail('TICKET_RENEWAL_TIMEOUT'), 15000)
    options.onAuthorizationRequired()
  }
  function renewAuthorization() {
    if (!options.onAuthorizationRequired) return fail('AUTHENTICATION_REQUIRED')
    if (isolated()) return
    // A current-admission failure can arrive as a stateless ERROR before the close frame.
    // Keep the original pending keys and the same bounded renewal path as ticket denial.
    provider.configuration.websocketProvider.disconnect()
    durable.closed(4403)
  }
  function fail(code) {
    if (isolated()) return
    resetConnection(); transportGeneration++; data.status = 'quarantined'; data.canWrite = false; failureCode = code
    clearAuthorizationTimer()
    closePresence()
    data.commentsEnabled = false
    if (/AUTHENTICATION|AUTHORIZATION|SESSION_DENIED|DOCUMENT_DENIED|RESOURCE_NOT_FOUND/.test(code) && options.onAuthorizationRequired) options.onAuthorizationRequired()
    const error = new Error(code); error.code = code
    rejectReady(error)
    provider.configuration.websocketProvider.disconnect()
    changed()
    if (options.onError) options.onError(error)
  }
  async function prepareOperations(current) {
    if (operations) return operations
    let module
    try { module = await import('./durable-operations') }
    catch (cause) {
      const error = Object.assign(new Error(cause && cause.message || String(cause)), { code: 'COLLABORATION_MODULE_UNAVAILABLE', cause })
      if (!restoring && !isolated() && (!current || current())) {
        resetConnection(); clearAuthorizationTimer()
        try { provider.configuration.websocketProvider.disconnect() }
        finally { durable.closed() }
        if (options.onError) options.onError(error)
      }
      throw error
    }
    if (isolated() || (current && !current())) return null
    if (!operations) {
      operations = module.createDurableOperations({ data, options, pending, scope, active, changed, ydoc, provider, awareness, state, resolveReady, renewAuthorization, authority, closeWaiters, fail,
        authorized() { clearAuthorizationTimer(); authority.notified = false; authority.attempts = 0 },
      })
      presence = operations.presence
    }
    return operations
  }
  const durable = {
    start() {
      if (isolated()) return
      if (restoring) return fail('PENDING_RECOVERY_IN_PROGRESS')
      if (restoredScope && (data.epoch === null || data.principalId === null || Array.from(pending.values()).some(item => item.epoch === null))) {
        return fail('PENDING_RECOVERY_SCOPE_UNKNOWN')
      }
      transportGeneration++; helloStarted = true
      if (operations) operations.retireQueries()
      sendFrame(provider, scope, { type: 'HELLO', epoch: data.epoch === null ? undefined : data.epoch, ...(awareness ? { presenceProtocol: PRESENCE_PROTOCOL } : {}), ...(typeof options.onCommentsChanged === 'function' ? { commentsProtocol: 'comments-v1' } : {}) })
    },
    closed(code) {
      if (isolated()) return
      transportGeneration++; data.status = 'disconnected'; data.canWrite = false
      closePresence()
      data.commentsEnabled = false
      if ([4401, 4403].includes(code)) requireAuthorization()
      if (operations) operations.retireQueries()
      for (const item of pending.values()) if (item.status === 'pending' || item.status === 'accepted') item.status = 'unknown'
      changed()
    },
    local(update) {
      if (isolated()) return
      const id = updateId(), bytes = Uint8Array.from(update)
      const item = { operationId: id, updateId: id, epoch: data.epoch, payloadBase64: toBase64(bytes), payloadHash: null,
        status: data.status === 'ready' ? 'pending' : 'unknown' }
      pending.set(id, item); changed()
      outgoing = outgoing.then(async () => {
        item.payloadHash = await payloadHash(bytes)
        if (isolated()) return
        if (data.status === 'ready') operations.sendLocal(item)
      }).catch(error => fail(error.message))
      // Y.Doc已发生修改：先保留原bytes/hash队列，再隔离并使整包导入失败。
      if (restoring) fail('PENDING_RECOVERY_IN_PROGRESS')
    },
    fail,
  }
  provider = new DurableProvider({
    url, name: `${tenantId}/${docId}`, document: ydoc, awareness, token: options.ticket || '', durable, sessionAwareness: false,
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
      const generation = transportGeneration
      const current = () => generation === transportGeneration && !isolated()
      incoming = incoming.then(async () => {
        if (!current()) return
        const operations = await prepareOperations(current)
        if (current()) return operations.receive(payload, current)
      }).catch(error => { if (current()) fail(error.message) })
    },
    onAuthenticationFailed: renewAuthorization,
  })
  const api = {
    ydoc, provider, ready, getState: state,
    exportPending: () => Array.from(pending.values(), item => ({ ...item })),
    async exportPendingSnapshot() {
      if (restoring) throw new Error('PENDING_RECOVERY_IN_PROGRESS')
      await outgoing
      return Object.freeze({ schemaVersion: pendingSchema, ...scope, epoch: data.epoch, principalId: data.principalId,
        pending: Object.freeze(Array.from(pending.values(), item => Object.freeze({ ...item }))) })
    },
    async restorePending(snapshot) {
      if (options.autoConnect !== false || helloStarted || restoring || pending.size || data.status !== 'connecting') {
        throw new Error('PENDING_RECOVERY_NOT_ALLOWED')
      }
      const fields = ['schemaVersion','protocolVersion','tenantId','docId','epoch','principalId','pending']
      if (!isRecord(snapshot) || Object.keys(snapshot).length !== fields.length || Object.keys(snapshot).some(key => !fields.includes(key)) ||
        !matches(snapshot, { schemaVersion: pendingSchema, ...scope }) || !Array.isArray(snapshot.pending)) throw new Error('INVALID_PENDING_SNAPSHOT')
      // Capture caller-owned fields before loading; input mutation cannot retarget recovery.
      const captured = { ...snapshot, pending: snapshot.pending.map(item => {
        if (!isRecord(item) || Object.keys(item).some(key => !['operationId','updateId','epoch','payloadBase64','payloadHash','expectedRevision','status'].includes(key))) throw new Error('INVALID_PENDING_SNAPSHOT')
        return { ...project(item, ['operationId', 'updateId', 'epoch', 'payloadBase64']),
          ...(own(item, 'payloadHash') ? { payloadHash: item.payloadHash } : {}),
          ...(own(item, 'expectedRevision') ? { expectedRevision: item.expectedRevision } : {}), status: 'unknown' }
      }) }
      restoring = true
      try {
        const module = await import('./durable-operations')
        const records = await module.preparePendingSnapshot(captured, scope, toBase64)
        const control = await prepareOperations()
        if (helloStarted || pending.size || data.status !== 'connecting') throw new Error('PENDING_RECOVERY_INTERRUPTED')
        data.epoch = captured.epoch; data.principalId = captured.principalId; restoredScope = true
        control.recover(records)
      } finally { restoring = false }
      changed()
      return state()
    },
    queryPending() {
      if (!active()) return 0
      return operations.queryPending()
    },
    // Explicit current-authority recovery; corruption/epoch quarantine is never recoverable here.
    resumeAuthorization() {
      if (data.status === 'quarantined' && ['TICKET_RENEWAL_LIMIT', 'TICKET_RENEWAL_TIMEOUT', 'AUTHENTICATION_REQUIRED', 'PG_SESSION_DENIED', 'PG_DOCUMENT_DENIED', 'PG_PERMISSION_NOT_FOUND', 'RESOURCE_NOT_FOUND'].includes(failureCode)) {
        data.status = 'disconnected'; failureCode = null
      }
      clearAuthorizationTimer(); authority.attempts = 0; authority.notified = false
      return api.connect()
    },
    connect() {
      if (restoring) return Promise.reject(new Error('PENDING_RECOVERY_IN_PROGRESS'))
      if (isolated()) return Promise.reject(new Error('COLLABORATION_ISOLATED'))
      if (connecting) return connecting
      const attempt = connectionGeneration
      const socket = provider.configuration.websocketProvider.webSocket
      const closing = socket && socket.readyState === 2
      const current = () => attempt === connectionGeneration && !isolated()
      const work = (async () => {
        const control = await prepareOperations(current)
        if (!control || !current()) throw new Error(closing && data.status === 'destroyed' ? 'DESTROYED' : 'COLLABORATION_ISOLATED')
        return control.connect(current)
      })()
      connecting = work
      const clear = () => { if (connecting === work) connecting = null }
      work.then(clear, clear)
      return work
    },
    disconnect() {
      resetConnection()
      try { return provider.configuration.websocketProvider.disconnect() }
      finally { durable.closed() }
    },
    // 显式恢复/代际屏障：只隔离旧连接，绝不重写epoch或把旧pending合到新baseline。
    isolateEpoch: (reason = 'EPOCH_MISMATCH') => fail(reason),
    destroy() {
      if (data.status === 'destroyed') return
      resetConnection(); transportGeneration++; data.status = 'destroyed'; data.canWrite = false
      clearAuthorizationTimer(); closeWaiters.forEach(cancel => cancel())
      rejectReady(new Error('DESTROYED'))
      if (presence) presence.destroy()
      else if (awareness) { closePresence(); awareness.destroy() }
      provider.destroy(); ydoc.destroy(); changed()
    },
  }
  if (options.autoConnect !== false) {
    const generation = connectionGeneration
    api.connect().catch(() => { if (generation === connectionGeneration) fail('CONNECTION_UNAVAILABLE') })
  }
  return api
}
