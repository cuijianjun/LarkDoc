/** Async server-frame processing; the synchronous bridge owns admission and pending bytes. */
/* global globalThis */
import * as Y from 'yjs'
import { createDurablePresence, validRevision as integer } from './presence'
import { laterRevision, validResourceId as identifier, own, matches, project, payloadHash, sendFrame } from './protocol'

const hashPattern = /^sha256:[0-9a-f]{64}(?![\s\S])/
const principal = value => typeof value === 'string' && value.length > 0 && !value.includes('\0')
const latest = (left, right) => laterRevision(left, right) ? left : right
function fromBase64(text) {
  if (typeof text !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) {
    throw new Error('INVALID_BASE64')
  }
  return Uint8Array.from(globalThis.atob(text), char => char.charCodeAt(0))
}

const queryFields = ['operationId', 'updateId', 'payloadHash', 'epoch', 'expectedRevision']

export function createDurableOperations(context) {
  const { data, options, pending, scope, active, changed, ydoc, provider, awareness, state, resolveReady, renewAuthorization, authorized, authority, closeWaiters, fail } = context
  const receipts = new Map(), recovered = new Set(), queriedRecovered = new Set()
  const send = message => sendFrame(provider, scope, message)
  const presence = awareness ? createDurablePresence(ydoc, send, state, awareness) : null
  const pendingOperation = operationId => {
    for (const item of pending.values()) if (item.operationId === operationId) return item
  }
  function validateReceipt(receipt) {
    if (!receipt || !matches(receipt, { ...scope, status: 'durable', epoch: data.epoch }) ||
      typeof receipt.updateId !== 'string' || !hashPattern.test(receipt.payloadHash) ||
      !integer(receipt.seq) || !integer(receipt.contentRevision) ||
      typeof receipt.committedAt !== 'string' || !Number.isFinite(Date.parse(receipt.committedAt))) throw new Error('INVALID_RECEIPT')
    const item = pending.get(receipt.updateId)
    if (item && ((item.payloadHash !== receipt.payloadHash && !(recovered.has(item.updateId) && item.payloadHash == null)) ||
      item.epoch !== receipt.epoch)) throw new Error('RECEIPT_MISMATCH')
    const prior = receipts.get(receipt.updateId)
    if (prior && !matches(receipt, prior)) throw new Error('RECEIPT_MISMATCH')
    return item
  }
  function acknowledge(receipt, fromQuery = false) {
    const item = validateReceipt(receipt)
    data.revision = latest(data.revision, receipt.contentRevision); data.lastSeq = latest(data.lastSeq, receipt.seq)
    receipts.set(receipt.updateId, Object.freeze({ ...receipt }))
    if (item && (!recovered.has(item.updateId) || (fromQuery && queriedRecovered.has(item.updateId)))) {
      pending.delete(item.updateId)
      recovered.delete(item.updateId); queriedRecovered.delete(item.updateId)
      if (options.onReceipt) options.onReceipt(receipt)
    }
  }
  async function receive(text, current) {
    if (!current()) return
    const message = JSON.parse(text)
    if (!matches(message, scope)) throw new Error('PROTOCOL_MISMATCH')
    if (message.type === 'READY') {
      if (!integer(message.epoch) || !integer(message.revision) || !integer(message.lastSeq) ||
        message.field !== 'default' || typeof message.canWrite !== 'boolean' || !principal(message.principalId)) throw new Error('INVALID_READY')
      if (data.epoch !== null && message.epoch !== data.epoch) throw new Error('EPOCH_MISMATCH')
      if (data.principalId !== null && message.principalId !== data.principalId) throw new Error('PRINCIPAL_MISMATCH')
      if (data.epoch === null && pending.size) throw new Error('PRE_READY_PENDING')
      data.epoch = message.epoch; data.principalId = message.principalId
      Y.applyUpdate(ydoc, fromBase64(message.payloadBase64), provider)
      data.revision = latest(data.revision, message.revision); data.lastSeq = latest(data.lastSeq, message.lastSeq); data.canWrite = message.canWrite
      data.status = pending.size ? 'blocked' : 'ready'
      authorized()
      if (pending.size) data.canWrite = false
      if (presence) presence.ready(message.presenceProtocol)
      data.commentsEnabled = message.commentsProtocol === 'comments-v1' && typeof options.onCommentsChanged === 'function'
      resolveReady(state())
      // 断线不证明未提交，不能自动重发。只有知道原 expectedRevision 才能 QUERY。
      changed()
    } else if (message.type === 'COMMENTS_CHANGED') {
      if (!data.commentsEnabled || !active() || message.epoch !== data.epoch) throw new Error('INVALID_COMMENT_SIGNAL')
      options.onCommentsChanged()
    } else if (message.type === 'PRESENCE') {
      if (!presence || !active()) throw new Error('INVALID_PRESENCE')
      presence.receive(message)
    } else if (message.type === 'ACCEPTED') {
      const item = pendingOperation(message.operationId)
      if (!item || message.updateId !== item.updateId || !integer(message.expectedRevision) ||
        recovered.has(item.updateId) || (item.expectedRevision !== undefined && item.expectedRevision !== message.expectedRevision)) throw new Error('INVALID_ACCEPTED')
      item.expectedRevision = message.expectedRevision; item.status = 'accepted'
      changed()
    } else if (message.type === 'COMMITTED') {
      if (!active()) throw new Error('NOT_READY')
      const bytes = fromBase64(message.payloadBase64)
      if (!message.receipt || await payloadHash(bytes) !== message.receipt.payloadHash) throw new Error('PAYLOAD_HASH_MISMATCH')
      if (!current()) return
      // 无效元数据不能修改正文，应用失败也不能清除本地 pending。
      validateReceipt(message.receipt)
      Y.applyUpdate(ydoc, bytes, provider)
      acknowledge(message.receipt)
      changed()
    } else if (message.type === 'RECEIPT') {
      if (!active()) throw new Error('NOT_READY')
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
      const item = pendingOperation(message.operationId)
      if (!item) throw new Error(typeof message.code === 'string' ? message.code : 'SERVER_ERROR')
      queriedRecovered.delete(item.updateId)
      item.status = message.status === 'unknown' ? 'unknown' : 'failed'
      data.status = 'blocked'; data.canWrite = false
      changed()
      if (options.onError) options.onError(Object.assign(new Error(message.code || 'SERVER_ERROR'), { code: message.code || 'SERVER_ERROR' }))
    } else throw new Error('UNKNOWN_MESSAGE')
  }
  function queryPending() {
      let sent = 0
      for (const item of pending.values()) if (typeof item.payloadHash === 'string' && hashPattern.test(item.payloadHash) && item.expectedRevision !== undefined && item.epoch === data.epoch) {
        send({ type: 'QUERY', ...project(item, queryFields) })
        if (recovered.has(item.updateId)) queriedRecovered.add(item.updateId)
        sent++
      }
      return sent
  }
  async function connect(current) {
    const transport = provider.configuration.websocketProvider
    const socket = transport.webSocket
    if (socket && socket.readyState === 2) await new Promise((resolve, reject) => {
      let timer
      const finish = error => { clearTimeout(timer); socket.removeEventListener('close', closed); closeWaiters.delete(cancel); error ? reject(error) : resolve() }
      const closed = () => finish(), cancel = () => finish(new Error('DESTROYED'))
      closeWaiters.add(cancel); socket.addEventListener('close', closed, { once: true })
      timer = setTimeout(() => finish(new Error('SOCKET_CLOSE_TIMEOUT')), 5000)
      if (socket.readyState === 3) closed()
    })
    if (!current()) throw new Error('COLLABORATION_ISOLATED')
    authority.notified = false
    return transport.connect()
  }
  function sendLocal(item) {
    if (data.status === 'ready' && data.canWrite && item.epoch === data.epoch && item.status === 'pending') send({ type: 'UPDATE', ...item, status: undefined })
    else if (data.status === 'ready' && !data.canWrite) fail('WRITE_FORBIDDEN')
  }
  return { receive, queryPending, presence, connect, sendLocal,
    lastReceipt: () => Array.from(receipts.values()).slice(-1)[0] || null,
    retireQueries: () => queriedRecovered.clear(),
    recover(records) { for (const copy of records) { pending.set(copy.updateId, copy); recovered.add(copy.updateId) } },
  }
}

export async function preparePendingSnapshot(snapshot, scope, toBase64) {
  if ((snapshot.epoch !== null && !integer(snapshot.epoch)) || (snapshot.principalId !== null && !principal(snapshot.principalId))) throw new Error('INVALID_PENDING_SNAPSHOT')
  const ids = new Set(), operations = new Set()
  const records = snapshot.pending.map(copy => {
    if (!identifier(copy.operationId) || !identifier(copy.updateId) || ids.has(copy.updateId) || operations.has(copy.operationId) ||
      (copy.epoch !== null && (!integer(copy.epoch) || copy.epoch !== snapshot.epoch)) ||
      (own(copy, 'payloadHash') && copy.payloadHash !== null && (typeof copy.payloadHash !== 'string' || !hashPattern.test(copy.payloadHash))) ||
      (own(copy, 'expectedRevision') && !integer(copy.expectedRevision))) throw new Error('INVALID_PENDING_SNAPSHOT')
    const bytes = fromBase64(copy.payloadBase64)
    if (!bytes.length || bytes.length > 256 * 1024 || toBase64(bytes) !== copy.payloadBase64 ||
      new TextEncoder().encode(JSON.stringify({ ...scope, type: 'UPDATE', ...copy })).length > 390 * 1024) throw new Error('INVALID_PENDING_SNAPSHOT')
    ids.add(copy.updateId); operations.add(copy.operationId)
    return { copy, bytes }
  })
  for (const { copy, bytes } of records) if (copy.payloadHash != null && await payloadHash(bytes) !== copy.payloadHash) throw new Error('PENDING_PAYLOAD_HASH_MISMATCH')
  return records.map(record => record.copy)
}
