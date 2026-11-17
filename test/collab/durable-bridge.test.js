import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { createEncoder, writeVarString, writeVarUint, toUint8Array } from 'lib0/encoding'
import { createDecoder, readVarString, readVarUint } from 'lib0/decoding'
import { createDurableCollaborationBridge } from '../../src/collab/durable-bridge'
import * as collabEntry from '../../src/collab'

const bridges = []
afterEach(() => {
  bridges.splice(0).forEach(bridge => bridge.destroy())
  vi.restoreAllMocks()
})

function mount(options = {}) {
  // 使用真实 Hocuspocus provider；仅禁用自动拨号。真实网络由后端浏览器 E2E 验证。
  const bridge = createDurableCollaborationBridge({
    url: 'ws://127.0.0.1:33333', tenantId: 'tenant', docId: 'doc',
    autoConnect: false, ...options,
  })
  bridges.push(bridge)
  return bridge
}

const base64 = bytes => Buffer.from(bytes).toString('base64')
const ready = (bridge, extra = {}) => bridge.provider.receiveStateless(JSON.stringify({
  type: 'READY', protocolVersion: 'editor-crdt-v1', tenantId: 'tenant', docId: 'doc',
  epoch: '1', revision: '0', lastSeq: '0', canWrite: true, principalId: 'alice',
  field: 'default', payloadBase64: base64(Y.encodeStateAsUpdate(new Y.Doc())), ...extra,
}))
const matchingReceipt = pending => ({
  tenantId: 'tenant', docId: 'doc', updateId: pending.updateId,
  payloadHash: pending.payloadHash, epoch: '1', protocolVersion: 'editor-crdt-v1',
  seq: '1', contentRevision: '1', committedAt: '2026-11-07T12:00:00Z', status: 'durable',
})

async function pendingSnapshot(overrides = {}) {
  const source = new Y.Doc({ gc: false })
  source.getText('test').insert(0, '隔离待对账内容')
  const payload = Y.encodeStateAsUpdate(source)
  source.destroy()
  return {
    schemaVersion: 'pending-snapshot-v1', protocolVersion: 'editor-crdt-v1', tenantId: 'tenant', docId: 'doc',
    epoch: '1', principalId: 'alice', pending: [{ operationId: 'original-operation', updateId: 'original-update',
      epoch: '1', payloadBase64: base64(payload),
      payloadHash: 'sha256:' + Buffer.from(await crypto.subtle.digest('SHA-256', payload)).toString('hex'),
      expectedRevision: '0', status: 'accepted' }], ...overrides,
  }
}
function messages(bridge) {
  const sent = []
  bridge.provider.on('outgoingMessage', ({ message }) => {
    const decoder = createDecoder(message.toUint8Array())
    readVarString(decoder)
    if (readVarUint(decoder) === 5) sent.push(JSON.parse(readVarString(decoder)))
  })
  return sent
}
const response = (bridge, type, extra) => bridge.provider.receiveStateless(JSON.stringify({
  protocolVersion: 'editor-crdt-v1', tenantId: 'tenant', docId: 'doc', type, ...extra,
}))
const settle = () => new Promise(resolve => setTimeout(resolve, 0))
async function prepareConnection(bridge) {
  const connect = vi.spyOn(bridge.provider.configuration.websocketProvider, 'connect').mockResolvedValue()
  await bridge.connect()
  return connect
}

describe('持久协作桥（真实 provider，注入消息测试）', () => {
  it('公开真实provider的forceSync在connect前仍同步发送原HELLO', () => {
    const bridge = mount(), sent = messages(bridge)
    bridge.provider.forceSync()
    expect(sent).toEqual([{ protocolVersion: 'editor-crdt-v1', tenantId: 'tenant', docId: 'doc', type: 'HELLO' }])
    expect(bridge.getState()).toMatchObject({ status: 'connecting', pending: [] })
  })
  it('公开真实provider的入场拒绝在connect前仍同步请求当前授权', () => {
    const onAuthorizationRequired = vi.fn(), bridge = mount({ onAuthorizationRequired })
    bridge.provider.permissionDeniedHandler('stale ticket')
    expect(bridge.getState().status).toBe('disconnected')
    expect(onAuthorizationRequired).toHaveBeenCalledOnce()
  })
  it('autoConnect 加载期旧票据退休不能让旧Promise隔离新的授权连接', async () => {
    let reconnect
    const onError = vi.fn(), onAuthorizationRequired = vi.fn(() => { reconnect = bridge.connect() })
    const bridge = mount({ autoConnect: true, onError, onAuthorizationRequired })
    const connect = vi.spyOn(bridge.provider.configuration.websocketProvider, 'connect').mockResolvedValue()
    bridge.provider.permissionDeniedHandler('retired during module loading')
    expect(onAuthorizationRequired).toHaveBeenCalledOnce()
    await expect(reconnect).resolves.toBeUndefined()
    ready(bridge); await bridge.ready
    expect(connect).toHaveBeenCalledOnce()
    expect(onError).not.toHaveBeenCalled()
    expect(bridge.getState().status).toBe('ready')
  })
  it('disconnect 同步保留宿主 transport 的原返回值', () => {
    const bridge = mount(), result = {}
    vi.spyOn(bridge.provider.configuration.websocketProvider, 'disconnect').mockReturnValue(result)
    expect(bridge.disconnect()).toBe(result)
  })
  it('disconnect 返回前已收回写入准入，之后本地字节只缓存unknown而不排队UPDATE', async () => {
    const bridge = mount()
    ready(bridge); await bridge.ready
    const sent = messages(bridge)
    bridge.disconnect()
    expect(bridge.getState()).toMatchObject({ status: 'disconnected', canWrite: false })
    bridge.ydoc.getText('offline').insert(0, 'keep local after disconnect')
    const snapshot = await bridge.exportPendingSnapshot()
    expect(snapshot.pending).toHaveLength(1)
    expect(snapshot.pending[0].status).toBe('unknown')
    expect(sent.filter(message => message.type === 'UPDATE')).toEqual([])
    expect(bridge.queryPending()).toBe(0)
  })
  it.each(['destroy', 'disconnect'])('connect 保持同步真实状态与同一Promise，%s 在加载前取消则零socket', async method => {
    const bridge = mount(), transport = bridge.provider.configuration.websocketProvider
    const connect = vi.spyOn(transport, 'connect').mockResolvedValue()
    const pending = bridge.connect()
    expect(bridge.connect()).toBe(pending)
    expect(bridge.getState()).toMatchObject({ status: 'connecting', pending: [], canWrite: false })
    bridge[method]()
    await expect(pending).rejects.toThrow(/DESTROYED|COLLABORATION_ISOLATED/)
    expect(connect).not.toHaveBeenCalled()
  })
  it.each([
    ['isolateEpoch', bridge => bridge.isolateEpoch()], ['destroy', bridge => bridge.destroy()],
    ['closed', bridge => bridge.provider.onClose()], ['authorization', bridge => bridge.provider.permissionDeniedHandler('retired ticket')],
  ])('COMMITTED 哈希等待期间 %s 后，迟到正文及 receipt 均不得应用', async (_label, retire) => {
    const bridge = mount({ onAuthorizationRequired: vi.fn() })
    bridge.provider.configuration.durable.start()
    ready(bridge); await bridge.ready
    const remote = new Y.Doc(), digest = crypto.subtle.digest.bind(crypto.subtle)
    remote.getText('late').insert(0, 'late committed payload')
    const payload = Y.encodeStateAsUpdate(remote), receipt = matchingReceipt({ updateId: 'remote-update',
      payloadHash: 'sha256:' + Buffer.from(await digest('SHA-256', payload)).toString('hex') })
    let finish
    vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    response(bridge, 'COMMITTED', { payloadBase64: base64(payload), receipt })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    retire(bridge)
    const before = bridge.getState()
    finish(await digest('SHA-256', payload)); await settle(); await settle()
    expect(bridge.ydoc.getText('late').toString()).toBe('')
    expect(bridge.getState()).toEqual(before)
    expect(bridge.getState().lastReceipt).toBe(null)
    remote.destroy()
  })
  it('旧入场的异步无效帧不能隔离已经开始的新授权入场', async () => {
    const onError = vi.fn(), bridge = mount({ onError })
    ready(bridge); await bridge.ready
    const remote = new Y.Doc(), digest = crypto.subtle.digest.bind(crypto.subtle)
    remote.getText('late').insert(0, 'retired frame')
    const payload = Y.encodeStateAsUpdate(remote), receipt = matchingReceipt({ updateId: 'retired-update',
      payloadHash: 'sha256:' + Buffer.from(await digest('SHA-256', payload)).toString('hex') })
    let finish
    vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    response(bridge, 'COMMITTED', { payloadBase64: base64(payload), receipt })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    bridge.provider.onClose()
    ready(bridge, { canWrite: false })
    finish(new Uint8Array(32).buffer)
    await vi.waitFor(() => expect(bridge.getState()).toMatchObject({ status: 'ready', canWrite: false }))
    expect(bridge.ydoc.getText('late').toString()).toBe('')
    expect(onError).not.toHaveBeenCalled()
    remote.destroy()
  })
  it('恢复查询资格不泄漏到公开快照，修改导出副本不能伪造已查询', async () => {
    const snapshot = await pendingSnapshot(), bridge = mount()
    await bridge.restorePending(snapshot)
    const exported = bridge.exportPending()
    expect(exported).toEqual(snapshot.pending.map(item => ({ ...item, status: 'unknown' })))
    expect(Object.keys(exported[0])).not.toContain('recovery')
    exported[0].recovery = 'queried'
    ready(bridge); await bridge.ready
    response(bridge, 'RECEIPT', { receipt: matchingReceipt(exported[0]),
      operationId: exported[0].operationId, expectedRevision: exported[0].expectedRevision })
    await settle()
    expect(bridge.exportPending()).toHaveLength(1)
    expect(await bridge.exportPendingSnapshot()).toEqual({ ...snapshot,
      pending: snapshot.pending.map(item => ({ ...item, status: 'unknown' })) })
    expect(bridge.queryPending()).toBe(1)
    response(bridge, 'RECEIPT', { receipt: matchingReceipt(exported[0]),
      operationId: exported[0].operationId, expectedRevision: exported[0].expectedRevision })
    await vi.waitFor(() => expect(bridge.exportPending()).toEqual([]))
  })
  it('a denied in-flight connection cannot absorb the replacement authorization attempt', async () => {
    const bridge = mount({ onAuthorizationRequired: vi.fn() }), transport = bridge.provider.configuration.websocketProvider
    let finishOld, finishCurrent
    const connect = vi.spyOn(transport, 'connect').mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
      .mockImplementationOnce(() => new Promise(resolve => { finishCurrent = resolve }))
    const old = bridge.connect()
    await vi.waitFor(() => expect(connect).toHaveBeenCalledOnce())
    bridge.provider.permissionDeniedHandler('the in-flight ticket is stale')
    const current = bridge.connect()
    expect(current).not.toBe(old)
    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(2))
    finishOld(); await old
    expect(bridge.connect()).toBe(current)
    finishCurrent(); await current; ready(bridge); await settle()
    expect(bridge.getState().status).toBe('ready')
  })
  it('initial stale ticket keeps the first ready await usable after current authorization succeeds', async () => {
    const onAuthorizationRequired = vi.fn(), bridge = mount({ onAuthorizationRequired })
    const first = bridge.ready.then(value => ({ value }), error => ({ error }))
    await prepareConnection(bridge)
    bridge.provider.permissionDeniedHandler('stale initial ticket')
    expect(bridge.getState().status).toBe('disconnected'); expect(onAuthorizationRequired).toHaveBeenCalledOnce()
    ready(bridge)
    expect(await first).toMatchObject({ value: { status: 'ready' } })
  })
  it('waits for an actual closing socket before a fast authorization callback can reconnect, and coalesces callers', async () => {
    const bridge = mount(), transport = bridge.provider.configuration.websocketProvider, socket = new EventTarget()
    socket.readyState = 2; socket.close = vi.fn(); transport.webSocket = socket
    const connect = vi.spyOn(transport, 'connect').mockResolvedValue()
    try {
      const first = bridge.connect(), second = bridge.connect()
      expect(first).toBe(second); expect(connect).not.toHaveBeenCalled()
      socket.readyState = 3; socket.dispatchEvent(new Event('close')); await first
      expect(connect).toHaveBeenCalledOnce()
    } finally { transport.webSocket = null }
  })
  it('bounds repeated denied ticket renewal and merges duplicate close notifications without replay', async () => {
    const onAuthorizationRequired = vi.fn(), onError = vi.fn(), bridge = mount({ onAuthorizationRequired, onError })
    const transport = bridge.provider.configuration.websocketProvider
    vi.spyOn(transport, 'connect').mockResolvedValue()
    await bridge.connect()
    for (let attempt = 0; attempt < 4; attempt++) {
      bridge.provider.permissionDeniedHandler('ticket service unavailable')
      bridge.provider.onClose({ event: { code: 4403 } })
      if (attempt < 3) await bridge.connect()
    }
    expect(onAuthorizationRequired).toHaveBeenCalledTimes(3)
    expect(onError).toHaveBeenCalledOnce(); expect(onError.mock.calls[0][0].code).toBe('TICKET_RENEWAL_LIMIT')
    expect(bridge.getState()).toMatchObject({ status: 'quarantined', canWrite: false, pending: [] })
  })
  it('destroy cancels a held close waiter and a later close cannot reconnect', async () => {
    const bridge = mount(), transport = bridge.provider.configuration.websocketProvider, socket = new EventTarget()
    socket.readyState = 2; socket.close = vi.fn(); transport.webSocket = socket
    const connect = vi.spyOn(transport, 'connect').mockResolvedValue(), pending = bridge.connect().catch(error => error)
    transport.webSocket = null; bridge.destroy()
    expect((await pending).message).toBe('DESTROYED')
    socket.readyState = 3; socket.dispatchEvent(new Event('close')); await settle()
    expect(connect).not.toHaveBeenCalled(); expect(bridge.getState().status).toBe('destroyed')
  })
  it('initial authorization recovery has a finite deadline even if the host never reconnects', async () => {
    vi.useFakeTimers()
    const onAuthorizationRequired = vi.fn(), onError = vi.fn(), bridge = mount({ onAuthorizationRequired, onError })
    try {
      const pending = bridge.ready.catch(error => error)
      bridge.provider.permissionDeniedHandler('stale initial ticket')
      await vi.advanceTimersByTimeAsync(15000)
      expect((await pending).code).toBe('TICKET_RENEWAL_TIMEOUT')
      expect(onAuthorizationRequired).toHaveBeenCalledOnce(); expect(onError).toHaveBeenCalledOnce()
      expect(bridge.getState()).toMatchObject({ status: 'quarantined', canWrite: false })
    } finally { bridge.destroy(); vi.useRealTimers() }
  })
  it('a stale ticket denial requests fresh authorization without quarantining or replaying pending edits', async () => {
    const onAuthorizationRequired = vi.fn(), bridge = mount({ onAuthorizationRequired }), sent = messages(bridge)
    ready(bridge); await bridge.ready
    bridge.ydoc.getText('draft').insert(0, 'original pending'); await settle(); await settle()
    const before = bridge.exportPending().map(item => ({ ...item }))
    bridge.provider.permissionDeniedHandler('ticket no longer current')
    expect(onAuthorizationRequired).toHaveBeenCalledOnce(); expect(bridge.getState().status).toBe('disconnected')
    expect(bridge.exportPending().map(item => item.updateId)).toEqual(before.map(item => item.updateId))
    expect(bridge.exportPending().every(item => item.status === 'unknown')).toBe(true)
    const writes = sent.filter(item => item.type === 'UPDATE').length
    ready(bridge); await settle()
    expect(bridge.getState()).toMatchObject({ status: 'blocked', canWrite: false })
    expect(sent.filter(item => item.type === 'UPDATE')).toHaveLength(writes)
  })
  it.each([false, true])('stateless authentication expiry renews current admission without isolating or replaying pending (%s)', async withPending => {
    const onAuthorizationRequired = vi.fn(), onError = vi.fn(), bridge = mount({ onAuthorizationRequired, onError }), sent = messages(bridge)
    ready(bridge); await bridge.ready
    if (withPending) { bridge.ydoc.getText('draft').insert(0, 'preserve original'); await settle(); await settle() }
    const before = bridge.exportPending(), writes = sent.filter(item => item.type === 'UPDATE').length
    response(bridge, 'ERROR', { code: 'AUTHENTICATION_REQUIRED', ...(withPending ? { operationId: before[0].operationId } : {}) }); await settle()
    expect(bridge.getState()).toMatchObject({ status: 'disconnected', canWrite: false })
    bridge.provider.permissionDeniedHandler('same expired admission')
    bridge.provider.onClose({ event: { code: 4403 } })
    expect(onAuthorizationRequired).toHaveBeenCalledOnce(); expect(onError).not.toHaveBeenCalled()
    expect(bridge.exportPending().map(item => item.updateId)).toEqual(before.map(item => item.updateId))
    expect(bridge.exportPending().every(item => item.status === 'unknown')).toBe(true)
    ready(bridge); await settle()
    expect(bridge.getState().status).toBe(withPending ? 'blocked' : 'ready')
    expect(sent.filter(item => item.type === 'UPDATE')).toHaveLength(writes)
  })
  it.each([
    ['missing recovery callback', false, 'AUTHENTICATION_REQUIRED', false, 'AUTHENTICATION_REQUIRED'],
    ['resource denial', true, 'RESOURCE_NOT_FOUND', false, 'RESOURCE_NOT_FOUND'],
    ['wrong document', true, 'AUTHENTICATION_REQUIRED', true, 'PROTOCOL_MISMATCH'],
  ])('stateless recovery keeps permanent isolation for %s', async (_label, host, code, wrongDocument, expected) => {
    const onAuthorizationRequired = vi.fn(), onError = vi.fn(), bridge = mount({ ...(host ? { onAuthorizationRequired } : {}), onError })
    ready(bridge); await bridge.ready
    response(bridge, 'ERROR', { code, ...(wrongDocument ? { docId: 'other' } : {}) }); await settle()
    expect(bridge.getState()).toMatchObject({ status: 'quarantined', canWrite: false })
    expect(onError).toHaveBeenCalledOnce(); expect(onError.mock.calls[0][0].code).toBe(expected)
    if (wrongDocument) expect(onAuthorizationRequired).not.toHaveBeenCalled()
  })
  it('授权性关闭同步请求能力复核，普通断线不伪造授权撤销', async () => {
    const onAuthorizationRequired = vi.fn(), bridge = mount({ onAuthorizationRequired })
    ready(bridge); await bridge.ready
    bridge.provider.onClose({ event: { code: 1006 } })
    expect(onAuthorizationRequired).not.toHaveBeenCalled()
    ready(bridge); await settle()
    bridge.provider.onClose({ event: { code: 4403 } })
    expect(onAuthorizationRequired).toHaveBeenCalledTimes(1)
    expect(bridge.getState().status).toBe('disconnected')
  })
  it('评论信号只触发当前epoch的读刷新，不创建pending或定时轮询', async () => {
    const onCommentsChanged = vi.fn(), bridge = mount({ onCommentsChanged }), sent = messages(bridge)
    await prepareConnection(bridge)
    bridge.provider.startSync()
    expect(sent[0].commentsProtocol).toBe('comments-v1')
    ready(bridge, { commentsProtocol: 'comments-v1' }); await bridge.ready
    response(bridge, 'COMMENTS_CHANGED', { epoch: '1' }); await settle()
    expect(onCommentsChanged).toHaveBeenCalledTimes(1)
    expect(bridge.exportPending()).toEqual([])
    bridge.provider.onClose()
    response(bridge, 'COMMENTS_CHANGED', { epoch: '1' }); await settle()
    expect(onCommentsChanged).toHaveBeenCalledTimes(1)
  })
  it('临时光标的跨根位置被拒绝，反复加入退出不遗留Awareness元数据', async () => {
    const bridge = mount({ presence: true })
    ready(bridge, { presenceProtocol: 'cursor-v1' }); await bridge.ready
    const cursor = { anchor: { tname: 'default', assoc: 0 }, head: { tname: 'default', assoc: 0 } }
    for (let index = 0; index < 90; index++) {
      response(bridge, 'PRESENCE', { epoch: '1', peers: [{ peerId: `peer-${index}`, principalId: 'bob', cursor }] }); await settle()
      response(bridge, 'PRESENCE', { epoch: '1', peers: [] }); await settle()
    }
    expect(bridge.provider.awareness.meta.size).toBe(1)
    response(bridge, 'PRESENCE', { epoch: '1', peers: [{ peerId: 'attack', principalId: 'bob', cursor: { anchor: { tname: 'attack' }, head: { tname: 'attack' } } }] }); await settle()
    expect(bridge.ydoc.share.has('attack')).toBe(false)
    expect(bridge.exportPending()).toEqual([])
  })
  it.each(['privacyGeneration', 'informationRevision', 'privacyRevision'])('PRESENCE 的 %s 不能把尾换行当作十进制水位', async field => {
    const bridge = mount({ presence: true })
    ready(bridge, { presenceProtocol: 'cursor-v1' }); await bridge.ready
    const cursor = { anchor: { tname: 'default' }, head: { tname: 'default' } }
    const peer = { peerId: 'peer', principalId: 'bob', cursor }
    const message = { epoch: '1', peers: [peer] }
    if (field === 'privacyRevision') peer[field] = '9007199254740993\n'
    else message[field] = '9007199254740993\n'
    response(bridge, 'PRESENCE', message)
    await vi.waitFor(() => expect(bridge.getState().status).toBe('quarantined'))
    expect(bridge.provider.awareness.getStates().size).toBe(1)
    expect(bridge.exportPending()).toEqual([])
  })
  it.each(['epoch', 'revision', 'lastSeq'])('READY 的 %s 共用十进制校验也拒绝尾换行', async field => {
    const bridge = mount()
    ready(bridge, { [field]: '9007199254740993\n' })
    await expect(bridge.ready).rejects.toMatchObject({ code: 'INVALID_READY' })
    expect(bridge.exportPending()).toEqual([])
  })
  it('ACCEPTED 非规范expectedRevision不覆盖原pending或赋予查询资格', async () => {
    const bridge = mount()
    ready(bridge); await bridge.ready
    bridge.ydoc.getText('draft').insert(0, 'keep original pending')
    await vi.waitFor(() => expect(bridge.exportPending()[0].payloadHash).toBeTypeOf('string'))
    const original = bridge.exportPending()[0]
    response(bridge, 'ACCEPTED', { operationId: original.operationId, updateId: original.updateId, expectedRevision: '0\n' })
    await vi.waitFor(() => expect(bridge.getState().status).toBe('quarantined'))
    expect(bridge.exportPending()).toEqual([original])
    expect(bridge.queryPending()).toBe(0)
  })
  it.each(['seq', 'contentRevision'])('receipt 的 %s 尾换行不能确认原pending或提高水位', async field => {
    const bridge = mount()
    ready(bridge); await bridge.ready
    bridge.ydoc.getText('draft').insert(0, 'keep original receipt proof')
    await vi.waitFor(() => expect(bridge.exportPending()[0].payloadHash).toBeTypeOf('string'))
    const original = bridge.exportPending()[0]
    response(bridge, 'RECEIPT', { receipt: { ...matchingReceipt(original), [field]: '1\n' } })
    await vi.waitFor(() => expect(bridge.getState().status).toBe('quarantined'))
    expect(bridge.exportPending()).toEqual([original])
    expect(bridge.getState()).toMatchObject({ revision: '0', lastSeq: '0', lastReceipt: null })
  })
  it.each(['snapshotEpoch', 'recordEpoch', 'expectedRevision'])('恢复包 %s 尾换行在提交前原子拒绝', async field => {
    const snapshot = await pendingSnapshot(), bridge = mount(), sent = messages(bridge)
    if (field === 'snapshotEpoch') snapshot.epoch = '1\n'
    else snapshot.pending[0][field === 'recordEpoch' ? 'epoch' : field] = '1\n'
    await expect(bridge.restorePending(snapshot)).rejects.toThrow('INVALID_PENDING_SNAPSHOT')
    expect(bridge.exportPending()).toEqual([])
    expect(bridge.getState()).toMatchObject({ status: 'connecting', epoch: null })
    expect(bridge.ydoc.getText('test').toString()).toBe('')
    expect(sent).toEqual([])
  })
  it.each(['epoch', 'hash', 'server-code'])('%s 隔离不能被当成本地模块加载失败恢复', async kind => {
    const onError = vi.fn(), bridge = mount({ onError })
    ready(bridge); await bridge.ready
    bridge.ydoc.getText('draft').insert(0, 'retain the original key')
    await vi.waitFor(() => expect(bridge.exportPending()[0].payloadHash).toBeTypeOf('string'))
    const original = bridge.exportPending()[0]
    if (kind === 'epoch') ready(bridge, { epoch: '2' })
    else if (kind === 'hash') response(bridge, 'COMMITTED', { payloadBase64: original.payloadBase64,
      receipt: matchingReceipt({ ...original, payloadHash: 'sha256:' + '0'.repeat(64) }) })
    else response(bridge, 'ERROR', { code: 'COLLABORATION_MODULE_UNAVAILABLE' })
    await vi.waitFor(() => expect(bridge.getState().status).toBe('quarantined'))
    await expect(bridge.connect()).rejects.toThrow('COLLABORATION_ISOLATED')
    await expect(bridge.resumeAuthorization()).rejects.toThrow('COLLABORATION_ISOLATED')
    expect(onError.mock.calls[0][0].code).toBe(kind === 'epoch' ? 'EPOCH_MISMATCH' : kind === 'hash' ? 'PAYLOAD_HASH_MISMATCH' : 'COLLABORATION_MODULE_UNAVAILABLE')
    expect(bridge.exportPending()).toEqual([original])
  })
  it('光标通过受控临时状态发送，远端身份来自服务端且不产生正文pending', async () => {
    const bridge = mount({ presence: true }), sent = messages(bridge)
    const awareness = bridge.provider.awareness
    const cursor = { anchor: { tname: 'default', assoc: 0 }, head: { tname: 'default', assoc: 0 } }
    expect(awareness).toBeTruthy()
    awareness.setLocalStateField('cursor', cursor)
    ready(bridge, { presenceProtocol: 'cursor-v1' }); await bridge.ready
    expect(bridge.provider.awareness).toBe(awareness)
    expect(awareness.getLocalState().cursor).toEqual(cursor)
    bridge.provider.awareness.setLocalStateField('cursor', cursor)
    await vi.waitFor(() => expect(sent.some(item => item.type === 'PRESENCE' && item.cursor)).toBe(true))
    expect(sent.every(item => item.type === 'PRESENCE')).toBe(true)
    response(bridge, 'PRESENCE', { epoch: '1', peers: [{ peerId: 'peer-bob', principalId: 'bob', cursor }] })
    await vi.waitFor(() => expect([...bridge.provider.awareness.getStates().values()].some(item => item.user?.name === 'bob')).toBe(true))
    expect(bridge.exportPending()).toEqual([])
    expect(bridge.ydoc.getXmlFragment('default').length).toBe(0)
    const before = sent.length
    await settle(); expect(sent.length).toBe(before)
    bridge.provider.onClose()
    expect([...bridge.provider.awareness.getStates().keys()]).toEqual([bridge.ydoc.clientID])
  })

  it('隐私代际在写入前拒绝旧/缺失快照；隐藏头像不移除光标和选区', async () => {
    const bridge = mount({ presence: true })
    ready(bridge, { presenceProtocol: 'cursor-v1' }); await bridge.ready
    const awareness = bridge.provider.awareness, changed = vi.fn(), cursor = { anchor: { tname: 'default', assoc: 0 }, head: { tname: 'default', assoc: 1 } }
    awareness.on('privacy-generation', changed)
    const peer = { peerId: 'peer-bob', principalId: 'bob', cursor, privacyRevision: '1' }
    const remote = () => [...awareness.getStates().values()].find(value => value.user?.id === 'bob')
    response(bridge, 'PRESENCE', { epoch: '1', privacyGeneration: '8', peers: [{ ...peer, avatarVisible: false }] }); await settle()
    expect(remote().user.avatarVisible).toBe(false); expect(remote().cursor).toEqual(cursor)
    for (const extra of [{ privacyGeneration: '7' }, {}]) {
      response(bridge, 'PRESENCE', { epoch: '1', ...extra, peers: [{ ...peer, avatarVisible: true, cursor: null }] }); await settle()
      expect(remote().user.avatarVisible).toBe(false); expect(remote().cursor).toEqual(cursor)
    }
    response(bridge, 'PRESENCE', { epoch: '1', privacyGeneration: '9', peers: [peer] }); await settle()
    expect(remote().user.avatarVisible).toBe(false); expect(remote().cursor).toEqual(cursor)
    response(bridge, 'PRESENCE', { epoch: '1', privacyGeneration: '10', peers: [] }); await settle()
    expect(awareness.privacyGeneration).toBe('10'); expect(changed.mock.calls.map(([value]) => value)).toEqual(['8', '9', '10'])
    expect(bridge.exportPending()).toEqual([])
  })

  it('AC03Q宿主恢复包在新bridge保留原pending，只用服务器baseline且不自动重发', async () => {
    const snapshot = await pendingSnapshot()
    const bridge = mount()
    const sent = messages(bridge)
    await bridge.restorePending(snapshot)
    expect(bridge.exportPending()).toEqual([{ ...snapshot.pending[0], status: 'unknown' }])
    expect(bridge.ydoc.getText('test').toString()).toBe('')
    await prepareConnection(bridge)
    bridge.provider.startSync()
    expect(sent).toEqual([{ type: 'HELLO', protocolVersion: 'editor-crdt-v1', tenantId: 'tenant', docId: 'doc', epoch: '1' }])
    ready(bridge)
    await bridge.ready
    expect(bridge.getState()).toMatchObject({ status: 'blocked', canWrite: false, epoch: '1' })
    expect(bridge.ydoc.getText('test').toString()).toBe('')
    const exported = await bridge.exportPendingSnapshot()
    expect(exported).toEqual({ ...snapshot, pending: [{ ...snapshot.pending[0], status: 'unknown' }] })
    expect(sent).toHaveLength(1)
    expect(Object.isFrozen(exported)).toBe(true)
    expect(Object.isFrozen(exported.pending)).toBe(true)
    expect(Object.isFrozen(exported.pending[0])).toBe(true)
  })

  it('恢复pending不由广播或旧RECEIPT清除，原QUERY精确命中后仍需显式HELLO复权', async () => {
    const snapshot = await pendingSnapshot(), item = snapshot.pending[0], bridge = mount(), sent = messages(bridge)
    await bridge.restorePending(snapshot)
    ready(bridge); await bridge.ready
    const receipt = matchingReceipt(item)
    response(bridge, 'RECEIPT', { receipt, operationId: item.operationId, expectedRevision: item.expectedRevision })
    await settle()
    expect(bridge.exportPending()).toHaveLength(1)
    response(bridge, 'COMMITTED', { receipt, payloadBase64: item.payloadBase64 })
    await vi.waitFor(() => expect(bridge.ydoc.getText('test').toString()).toBe('隔离待对账内容'))
    expect(bridge.exportPending()).toHaveLength(1)
    expect(bridge.queryPending()).toBe(1)
    expect(sent).toEqual([{ type: 'QUERY', protocolVersion: 'editor-crdt-v1', tenantId: 'tenant', docId: 'doc',
      operationId: item.operationId, updateId: item.updateId, epoch: item.epoch, payloadHash: item.payloadHash, expectedRevision: item.expectedRevision }])
    response(bridge, 'RECEIPT', { receipt, operationId: item.operationId, expectedRevision: item.expectedRevision })
    await vi.waitFor(() => expect(bridge.exportPending()).toHaveLength(0))
    expect(bridge.getState()).toMatchObject({ status: 'blocked', canWrite: false })
    bridge.provider.forceSync()
    expect(sent[1]).toMatchObject({ type: 'HELLO', epoch: '1' })
    ready(bridge)
    await vi.waitFor(() => expect(bridge.getState()).toMatchObject({ status: 'ready', canWrite: true }))
    expect(sent.some(message => message.type === 'UPDATE')).toBe(false)
  })

  it('恢复unknown与缺原hash/revision继续原样导出，synced和QUERY未知不能清除', async () => {
    const snapshot = await pendingSnapshot(), original = snapshot.pending[0]
    const noRevision = { ...original, operationId: 'unknown-revision', updateId: 'unknown-revision' }; delete noRevision.expectedRevision
    const noHash = { ...original, operationId: 'unknown-hash', updateId: 'unknown-hash' }; delete noHash.payloadHash
    const nullHash = { ...original, operationId: 'null-hash', updateId: 'null-hash', payloadHash: null }
    snapshot.pending = [original, noRevision, noHash, nullHash]
    const bridge = mount(), sent = messages(bridge)
    await bridge.restorePending(snapshot); ready(bridge); await bridge.ready
    expect(bridge.queryPending()).toBe(1)
    response(bridge, 'ERROR', { operationId: original.operationId, updateId: original.updateId, status: 'unknown', code: 'OPERATION_UNKNOWN' })
    await settle()
    response(bridge, 'RECEIPT', { operationId: original.operationId, expectedRevision: original.expectedRevision, receipt: matchingReceipt(original) })
    bridge.provider.synced = true
    await settle()
    expect(bridge.exportPending()).toEqual(snapshot.pending.map(item => ({ ...item, status: 'unknown' })))
    expect((await bridge.exportPendingSnapshot()).pending).toEqual(bridge.exportPending())
    expect(bridge.getState()).toMatchObject({ status: 'blocked', canWrite: false })
    expect(sent.map(message => message.type)).toEqual(['QUERY'])
  })

  it.each([
    ['旧epoch', { epoch: '2' }, 'EPOCH_MISMATCH'],
    ['其他principal', { principalId: 'bob' }, 'PRINCIPAL_MISMATCH'],
  ])('%s恢复会话在apply新baseline前隔离，原scope及pending可再次导出', async (_label, extra, code) => {
    const snapshot = await pendingSnapshot(), bridge = mount()
    await bridge.restorePending(snapshot)
    ready(bridge, { payloadBase64: snapshot.pending[0].payloadBase64, ...extra })
    await expect(bridge.ready).rejects.toMatchObject({ code })
    expect(bridge.ydoc.getText('test').toString()).toBe('')
    expect(await bridge.exportPendingSnapshot()).toEqual({ ...snapshot, pending: snapshot.pending.map(item => ({ ...item, status: 'unknown' })) })
    expect(bridge.queryPending()).toBe(0)
  })

  it('恢复包principal保留Unicode原文，不按资源ID规则改写身份', async () => {
    const snapshot = await pendingSnapshot({ principalId: '用户:甲/公司' }), bridge = mount()
    await bridge.restorePending(snapshot); ready(bridge, { principalId: snapshot.principalId }); await bridge.ready
    expect((await bridge.exportPendingSnapshot()).principalId).toBe(snapshot.principalId)
    expect(bridge.getState()).toMatchObject({ status: 'blocked', canWrite: false })
  })

  it.each(['snapshot','record'])('未知%s epoch可保留原字节导出，但首次HELLO不能把它自动升级', async scope => {
    const snapshot = await pendingSnapshot()
    snapshot.pending[0].epoch = null
    if (scope === 'snapshot') { snapshot.epoch = null; snapshot.principalId = null }
    const bridge = mount(), sent = messages(bridge)
    await bridge.restorePending(snapshot); bridge.provider.startSync()
    await expect(bridge.ready).rejects.toMatchObject({ code: 'PENDING_RECOVERY_SCOPE_UNKNOWN' })
    expect(sent).toEqual([])
    expect(bridge.ydoc.getText('test').toString()).toBe('')
    expect((await bridge.exportPendingSnapshot()).pending).toEqual(snapshot.pending.map(item => ({ ...item, status: 'unknown' })))
  })

  it('恢复包schema、scope、canonical字段、重复原键和实际payload SHA全部先验且all-or-nothing', async () => {
    const original = await pendingSnapshot()
    const invalid = [
      value => { value.schemaVersion = 'future' }, value => { value.protocolVersion = 'other' },
      value => { value.tenantId = 'other' }, value => { value.docId = 'other' },
      value => { value.epoch = '01' }, value => { value.epoch = '1\n' }, value => { value.extra = 'forbidden' },
      value => { value.pending[0].updateId += '\n' }, value => { value.pending[0].epoch = '2' },
      value => { value.pending[0].expectedRevision = 0 }, value => { value.pending[0].expectedRevision = '0\n' },
      value => { value.pending[0].payloadHash += '\n' }, value => { value.pending[0].payloadBase64 += '\n' },
      value => { value.pending[0].payloadBase64 = 'not base64' }, value => { value.pending[0].actor = 'alice' },
      value => { value.pending.push({ ...value.pending[0], operationId: 'different-operation' }) },
      value => { value.pending.push({ ...value.pending[0], updateId: 'different-update' }) },
      value => { value.pending.push({ ...value.pending[0], operationId: 'second-operation', updateId: 'second-update', payloadHash: 'sha256:' + '0'.repeat(64) }) },
    ]
    for (const change of invalid) {
      const snapshot = JSON.parse(JSON.stringify(original)); change(snapshot)
      const bridge = mount()
      await expect(bridge.restorePending(snapshot)).rejects.toThrow()
      expect(bridge.exportPending()).toEqual([])
      expect(bridge.getState()).toMatchObject({ epoch: null, status: 'connecting' })
      expect(bridge.ydoc.getText('test').toString()).toBe('')
    }
    const bridge = mount(), oversized = JSON.parse(JSON.stringify(original))
    oversized.pending[0].payloadBase64 = base64(new Uint8Array(256 * 1024 + 1))
    await expect(bridge.restorePending(oversized)).rejects.toThrow('INVALID_PENDING_SNAPSHOT')
    expect(bridge.exportPending()).toEqual([])
    await bridge.restorePending(original)
    expect(bridge.exportPending()).toHaveLength(1)
  })

  it('异步SHA验证复制输入且手动connect不能越过入场，外部修改不改变原键或payload', async () => {
    const snapshot = await pendingSnapshot(), expected = JSON.parse(JSON.stringify(snapshot)), bridge = mount()
    const digest = crypto.subtle.digest.bind(crypto.subtle)
    let release
    vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const importing = bridge.restorePending(snapshot)
    snapshot.principalId = 'bob'; snapshot.epoch = '2'; snapshot.pending[0].payloadBase64 = 'AAA='; snapshot.pending[0].operationId = 'mutated'
    const connect = vi.spyOn(bridge.provider.configuration.websocketProvider, 'connect')
    try {
      await expect(bridge.connect()).rejects.toThrow('PENDING_RECOVERY_IN_PROGRESS')
      await expect(bridge.restorePending(expected)).rejects.toThrow('PENDING_RECOVERY_NOT_ALLOWED')
      expect(connect).not.toHaveBeenCalled()
      await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    } finally { release(await digest('SHA-256', Buffer.from(expected.pending[0].payloadBase64, 'base64'))) }
    await importing
    expect(bridge.exportPending()).toEqual(expected.pending.map(item => ({ ...item, status: 'unknown' })))
    expect(await bridge.exportPendingSnapshot()).toEqual({ ...expected, pending: bridge.exportPending() })
  })

  it('导入验证中直接startSync明确隔离，不能先HELLO或留下部分pending', async () => {
    const snapshot = await pendingSnapshot(), bridge = mount(), sent = messages(bridge)
    const digest = crypto.subtle.digest.bind(crypto.subtle)
    let release
    vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const importing = bridge.restorePending(snapshot)
    try { bridge.provider.startSync(); expect(sent).toEqual([]); await vi.waitFor(() => expect(release).toBeTypeOf('function')) }
    finally { release(await digest('SHA-256', Buffer.from(snapshot.pending[0].payloadBase64, 'base64'))) }
    await expect(importing).rejects.toThrow('PENDING_RECOVERY_INTERRUPTED')
    await expect(bridge.ready).rejects.toMatchObject({ code: 'PENDING_RECOVERY_IN_PROGRESS' })
    expect(bridge.exportPending()).toEqual([])
  })

  it('导入SHA校验中真实Yjs本地编辑仍保留原bytes为unknown导出，原导入原子拒绝且零UPDATE', async () => {
    const snapshot = await pendingSnapshot(), bridge = mount(), sent = messages(bridge)
    const digest = crypto.subtle.digest.bind(crypto.subtle)
    let release, localBytes
    const importedBytes = Buffer.from(snapshot.pending[0].payloadBase64, 'base64')
    vi.spyOn(crypto.subtle, 'digest').mockImplementation((algorithm, bytes) => {
      if (!release && Buffer.from(bytes).equals(importedBytes)) return new Promise(resolve => { release = resolve })
      return digest(algorithm, bytes)
    })
    const importing = bridge.restorePending(snapshot)
    bridge.ydoc.on('update', bytes => { localBytes = Uint8Array.from(bytes) })
    try {
      bridge.ydoc.getText('test').insert(0, '校验中的真实本地修改')
      expect(localBytes).toBeInstanceOf(Uint8Array)
      await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    } finally { release(await digest('SHA-256', Buffer.from(snapshot.pending[0].payloadBase64, 'base64'))) }
    await expect(importing).rejects.toThrow('PENDING_RECOVERY_INTERRUPTED')
    await expect(bridge.ready).rejects.toMatchObject({ code: 'PENDING_RECOVERY_IN_PROGRESS' })
    const exported = await bridge.exportPendingSnapshot()
    expect(exported.pending).toHaveLength(1)
    expect(exported.pending[0]).toMatchObject({ status: 'unknown', epoch: null, payloadBase64: base64(localBytes),
      payloadHash: 'sha256:' + Buffer.from(await digest('SHA-256', localBytes)).toString('hex') })
    expect(exported.pending[0].updateId).not.toBe(snapshot.pending[0].updateId)
    expect(bridge.ydoc.getText('test').toString()).toBe('校验中的真实本地修改')
    expect(sent).toEqual([])
  })

  it('已HELLO、有本地pending或destroy后不能导入覆盖当前会话', async () => {
    const snapshot = await pendingSnapshot()
    const hello = mount(); hello.provider.startSync()
    await expect(hello.restorePending(snapshot)).rejects.toThrow('PENDING_RECOVERY_NOT_ALLOWED')
    const local = mount(); local.ydoc.getText('test').insert(0, '本地已存在')
    const before = local.exportPending()
    await expect(local.restorePending(snapshot)).rejects.toThrow('PENDING_RECOVERY_NOT_ALLOWED')
    expect(local.exportPending()).toEqual(before)
    const destroyed = mount(); destroyed.destroy()
    await expect(destroyed.restorePending(snapshot)).rejects.toThrow('PENDING_RECOVERY_NOT_ALLOWED')
  })

  it('快照导出等原outgoing SHA完成，返回冻结副本且不影响原数组导出', async () => {
    const bridge = mount(); ready(bridge); await bridge.ready
    const digest = crypto.subtle.digest.bind(crypto.subtle)
    let release, hashingBytes
    vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce((_algorithm, bytes) => {
      hashingBytes = Uint8Array.from(bytes)
      return new Promise(resolve => { release = resolve })
    })
    bridge.ydoc.getText('test').insert(0, '等原哈希')
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    let completed = false
    const exporting = bridge.exportPendingSnapshot().then(value => { completed = true; return value })
    try { await settle(); expect(completed).toBe(false) }
    finally { release(await digest('SHA-256', hashingBytes)) }
    const snapshot = await exporting
    expect(snapshot.pending[0].payloadHash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(Object.isFrozen(snapshot.pending[0])).toBe(true)
    const legacy = bridge.exportPending(); legacy[0].payloadBase64 = 'changed'
    expect(bridge.exportPending()[0].payloadBase64).toBe(snapshot.pending[0].payloadBase64)
  })

  it.each([
    ['hash', value => { value.receipt.payloadHash = 'sha256:' + '0'.repeat(64) }],
    ['epoch', value => { value.receipt.epoch = '2' }],
    ['protocol', value => { value.receipt.protocolVersion = 'other' }],
    ['operation', value => { value.operationId = 'other-operation' }],
    ['revision', value => { value.expectedRevision = '1' }],
  ])('恢复原QUERY后%s不匹配的RECEIPT仍不清pending', async (_name, change) => {
    const snapshot = await pendingSnapshot(), item = snapshot.pending[0], bridge = mount()
    await bridge.restorePending(snapshot); ready(bridge); await bridge.ready
    expect(bridge.queryPending()).toBe(1)
    const value = { operationId: item.operationId, expectedRevision: item.expectedRevision, receipt: matchingReceipt(item) }; change(value)
    response(bridge, 'RECEIPT', value)
    await vi.waitFor(() => expect(bridge.getState().status).toBe('quarantined'))
    expect(bridge.exportPending()).toHaveLength(1)
  })

  it('恢复QUERY资格不跨断线复用，重连后旧receipt不能替新显式QUERY', async () => {
    const snapshot = await pendingSnapshot(), item = snapshot.pending[0], bridge = mount()
    await bridge.restorePending(snapshot); ready(bridge); await bridge.ready
    expect(bridge.queryPending()).toBe(1)
    bridge.provider.onClose(); ready(bridge)
    await vi.waitFor(() => expect(bridge.getState().status).toBe('blocked'))
    const value = { receipt: matchingReceipt(item), operationId: item.operationId, expectedRevision: item.expectedRevision }
    response(bridge, 'RECEIPT', value); await settle()
    expect(bridge.exportPending()).toHaveLength(1)
    expect(bridge.queryPending()).toBe(1)
    response(bridge, 'RECEIPT', value)
    await vi.waitFor(() => expect(bridge.exportPending()).toHaveLength(0))
  })
  it('可选协作子入口导出持久桥，保留原协议常量', () => {
    expect(collabEntry.createDurableCollaborationBridge).toBe(createDurableCollaborationBridge)
    expect(collabEntry.DURABLE_PROTOCOL_VERSION).toBe('editor-crdt-v1')
    expect(collabEntry.COLLAB_PROTOCOL_VERSION).toBe(1)
  })

  it('仅发送 HELLO 和受控 UPDATE，不发默认同步；精确 receipt 才确认本地 pending', async () => {
    const onReceipt = vi.fn()
    const bridge = mount({ onReceipt })
    const outgoing = []
    bridge.provider.on('outgoingMessage', ({ message }) => {
      const decoder = createDecoder(message.toUint8Array())
      readVarString(decoder)
      outgoing.push({ type: readVarUint(decoder), payload: readVarString(decoder) })
    })
    await prepareConnection(bridge)
    bridge.provider.startSync()
    expect(outgoing.map(x => x.type)).toEqual([5])
    expect(JSON.parse(outgoing[0].payload).type).toBe('HELLO')
    ready(bridge)
    await bridge.ready
    bridge.ydoc.getText('test').insert(0, '真实本地更改')
    await vi.waitFor(() => expect(outgoing).toHaveLength(2))
    const envelope = JSON.parse(outgoing[1].payload)
    expect(envelope.type).toBe('UPDATE')
    expect(envelope.payloadHash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(bridge.getState().pending).toHaveLength(1)
    // Hocuspocus 的布尔同步状态不能清理任何持久化 pending。
    bridge.provider.synced = true
    expect(bridge.getState().pending).toHaveLength(1)
    const receipt = matchingReceipt(envelope)
    bridge.provider.receiveStateless(JSON.stringify({
      type: 'RECEIPT', protocolVersion: 'editor-crdt-v1', tenantId: 'tenant', docId: 'doc', receipt,
    }))
    await vi.waitFor(() => expect(bridge.getState().pending).toHaveLength(0))
    expect(onReceipt).toHaveBeenCalledTimes(1)
    bridge.provider.receiveStateless(JSON.stringify({
      type: 'RECEIPT', protocolVersion: 'editor-crdt-v1', tenantId: 'tenant', docId: 'doc', receipt,
    }))
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(onReceipt).toHaveBeenCalledTimes(1)
  })

  it('伪造 receipt 的 hash 不清 pending，并隔离连接', async () => {
    const onError = vi.fn()
    const bridge = mount({ onError })
    ready(bridge)
    await bridge.ready
    bridge.ydoc.getText('test').insert(0, '未确认')
    await vi.waitFor(() => expect(bridge.exportPending()[0].payloadHash).toBeTruthy())
    const receipt = { ...matchingReceipt(bridge.exportPending()[0]), payloadHash: 'sha256:' + '0'.repeat(64) }
    bridge.provider.receiveStateless(JSON.stringify({
      type: 'RECEIPT', protocolVersion: 'editor-crdt-v1', tenantId: 'tenant', docId: 'doc', receipt,
    }))
    await vi.waitFor(() => expect(bridge.getState().status).toBe('quarantined'))
    expect(bridge.exportPending()).toHaveLength(1)
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('commit 广播校验真实字节，不会把远端更新当成本地待发送修改', async () => {
    const bridge = mount()
    ready(bridge)
    await bridge.ready
    const remote = new Y.Doc({ gc: false })
    remote.getText('test').insert(0, '另一用户')
    const payload = Y.encodeStateAsUpdate(remote)
    const hash = 'sha256:' + Buffer.from(await crypto.subtle.digest('SHA-256', payload)).toString('hex')
    bridge.provider.receiveStateless(JSON.stringify({
      type: 'COMMITTED', protocolVersion: 'editor-crdt-v1', tenantId: 'tenant', docId: 'doc',
      payloadBase64: base64(payload), receipt: matchingReceipt({ updateId: 'other-user-update', payloadHash: hash }),
    }))
    await vi.waitFor(() => expect(bridge.ydoc.getText('test').toString()).toBe('另一用户'))
    expect(bridge.getState().pending).toHaveLength(0)
    remote.destroy()
  })

  it('重连 epoch 变化保留旧 pending，只允许导出，不合并新基线', async () => {
    const bridge = mount()
    ready(bridge)
    await bridge.ready
    bridge.ydoc.getText('test').insert(0, '离线内容')
    await vi.waitFor(() => expect(bridge.exportPending()[0].payloadHash).toBeTruthy())
    bridge.provider.onClose()
    bridge.provider.receiveStateless(JSON.stringify({
      type: 'READY', protocolVersion: 'editor-crdt-v1', tenantId: 'tenant', docId: 'doc',
      epoch: '2', revision: '1', lastSeq: '1', canWrite: true, principalId: 'alice',
      field: 'default', payloadBase64: base64(Y.encodeStateAsUpdate(new Y.Doc())),
    }))
    await vi.waitFor(() => expect(bridge.getState().status).toBe('quarantined'))
    expect(bridge.exportPending()[0].epoch).toBe('1')
    expect(bridge.ydoc.getText('test').toString()).toBe('离线内容')
  })

  it('拒绝 stock Sync/SyncStatus 入站，不让服务端绕过受控协议修改正文', async () => {
    const bridge = mount()
    const encoder = createEncoder()
    writeVarString(encoder, 'tenant/doc')
    writeVarUint(encoder, 8)
    writeVarUint(encoder, 1)
    bridge.provider.onMessage({ data: toUint8Array(encoder) })
    await expect(bridge.ready).rejects.toMatchObject({ code: 'UNCONTROLLED_FRAME' })
    expect(bridge.getState().status).toBe('quarantined')
  })

  it('经真实 WebSocket 事件路由到 Provider 帧门，区分两层 onMessage 参数', async () => {
    const bridge = mount()
    const frame = (type, payload) => {
      const encoder = createEncoder()
      writeVarString(encoder, 'tenant/doc')
      writeVarUint(encoder, type)
      writeVarString(encoder, payload)
      return { data: toUint8Array(encoder) }
    }
    const baseline = new Y.Doc()
    const payload = JSON.stringify({
      type: 'READY', protocolVersion: 'editor-crdt-v1', tenantId: 'tenant', docId: 'doc',
      epoch: '1', revision: '0', lastSeq: '0', canWrite: true, principalId: 'alice',
      field: 'default', payloadBase64: base64(Y.encodeStateAsUpdate(baseline)),
    })
    baseline.destroy()
    const socket = bridge.provider.configuration.websocketProvider
    expect(() => socket.emit('message', frame(5, payload))).not.toThrow()
    await bridge.ready
    expect(bridge.getState().status).toBe('ready')
    // 跳过原始socket回调不能跳过随后provider层的协议门。
    expect(() => socket.emit('message', frame(8, ''))).not.toThrow()
    expect(bridge.getState().status).toBe('quarantined')
  })

  it('ACCEPTED 不能确认持久化；断线保留原键，显式 QUERY 只能使用原 expectedRevision', async () => {
    const bridge = mount()
    const sent = []
    bridge.provider.on('outgoingMessage', ({ message }) => {
      const decoder = createDecoder(message.toUint8Array())
      readVarString(decoder)
      if (readVarUint(decoder) === 5) sent.push(JSON.parse(readVarString(decoder)))
    })
    ready(bridge)
    await bridge.ready
    bridge.ydoc.getText('test').insert(0, '等待数据库')
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    const original = sent[0]
    bridge.provider.receiveStateless(JSON.stringify({
      type: 'ACCEPTED', protocolVersion: 'editor-crdt-v1', tenantId: 'tenant', docId: 'doc',
      operationId: original.updateId, updateId: original.updateId, expectedRevision: '0',
    }))
    await vi.waitFor(() => expect(bridge.exportPending()[0].expectedRevision).toBe('0'))
    expect(bridge.getState().pending).toHaveLength(1)
    bridge.provider.onClose()
    ready(bridge)
    await vi.waitFor(() => expect(bridge.getState().status).toBe('blocked'))
    expect(bridge.getState().canWrite).toBe(false)
    expect(sent).toHaveLength(1)
    expect(bridge.queryPending()).toBe(1)
    expect(sent[1]).toMatchObject({ type: 'QUERY', operationId: original.operationId,
      updateId: original.updateId, epoch: original.epoch, payloadHash: original.payloadHash, expectedRevision: '0' })
    bridge.provider.receiveStateless(JSON.stringify({
      type: 'ERROR', protocolVersion: 'editor-crdt-v1', tenantId: 'tenant', docId: 'doc',
      operationId: original.updateId, status: 'unknown', code: 'OPERATION_UNKNOWN',
    }))
    await vi.waitFor(() => expect(bridge.getState().status).toBe('blocked'))
    expect(bridge.exportPending()[0].status).toBe('unknown')
    expect(bridge.queryPending()).toBe(1)
  })

  it('显式epoch隔离立即只读并保留原pending和epoch，不接新baseline或丢导出', async () => {
    const bridge = mount()
    ready(bridge)
    await bridge.ready
    bridge.ydoc.getText('test').insert(0, '尚未确认')
    await vi.waitFor(() => expect(bridge.exportPending()[0].payloadHash).toBeTruthy())
    const pending = bridge.exportPending()
    bridge.isolateEpoch('RESTORE_RESULT_UNKNOWN')
    expect(bridge.getState()).toMatchObject({ status: 'quarantined', epoch: '1', canWrite: false })
    expect(bridge.exportPending()).toEqual(pending)
    bridge.provider.receiveStateless(JSON.stringify({
      type: 'READY', protocolVersion: 'editor-crdt-v1', tenantId: 'tenant', docId: 'doc', epoch: '2',
      revision: '1', lastSeq: '1', canWrite: true, principalId: 'alice', field: 'default', payloadBase64: 'AAA=',
    }))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(bridge.getState().epoch).toBe('1')
    expect(bridge.exportPending()).toEqual(pending)
  })
})


describe('explicit authorization recovery preserves durable facts',()=>{
 it('retries only a fresh authorization handshake and never emits UPDATE for original unknown pending',async()=>{
  vi.useFakeTimers();const bridge=mount({onAuthorizationRequired:vi.fn()});try{
   ready(bridge);await bridge.ready;bridge.ydoc.getXmlFragment('default').insert(0,[new Y.XmlElement('paragraph')]);await Promise.resolve();
   bridge.provider.permissionDeniedHandler('revoked');await vi.advanceTimersByTimeAsync(15000);expect(bridge.getState().status).toBe('quarantined');
   const before=await bridge.exportPendingSnapshot(),sent=messages(bridge),transport=bridge.provider.configuration.websocketProvider;
   vi.spyOn(transport,'connect').mockResolvedValue();await bridge.resumeAuthorization();expect(bridge.getState().status).toBe('disconnected');expect(await bridge.exportPendingSnapshot()).toEqual(before);expect(sent.filter(v=>v.type==='UPDATE')).toEqual([]);
  }finally{bridge.destroy();vi.useRealTimers();}
 })
 it('never resumes epoch or receipt quarantine',async()=>{const bridge=mount();bridge.isolateEpoch('EPOCH_MISMATCH');await expect(bridge.resumeAuthorization()).rejects.toThrow('COLLABORATION_ISOLATED');expect(bridge.getState().status).toBe('quarantined')})
})
