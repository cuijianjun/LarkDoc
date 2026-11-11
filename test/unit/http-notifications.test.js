import { ReadableStream } from 'node:stream/web'
import { TextEncoder } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHttpNotificationsProvider } from '../../src/providers/notifications'
import { createDocumentSession } from '../../src/session/DocumentSession'

const HASH = `sha256:${'c'.repeat(64)}`
const active = []
const json = (status, data) => ({ status, json: async () => data })
const notification = (extra = {}) => ({ notificationId: 'notice1', eventId: 'event1', resourceRef: 'doc1', type: 'comment.reply',
  threadId: 'thread:1', read: false, readRevision: '0', ...extra })
const preference = (extra = {}) => ({ tenantId: 'tenant1', docId: 'doc1', principalId: 'alice', muted: false, preferenceRevision: '0', ...extra })
const snapshot = (extra = {}) => ({ items: [notification()], unreadCount: 11, preference: preference(), cursor: 'opaque-cut',
  hasMore: true, pageCursor: 'opaque-history', ...extra })
function port(request, extra = {}) {
  const provider = createHttpNotificationsProvider({ tenantId: 'tenant1', docId: 'doc1', csrfToken: () => 'csrf',
    getCapabilities: () => ({ canView: true, canEdit: false, canComment: false }), request, ...extra })
  active.push(provider)
  return provider
}
function stream() {
  let controller
  const cancelled = vi.fn()
  const body = new ReadableStream({ start(value) { controller = value }, cancel() { cancelled() } })
  return { response: { status: 200, headers: { get: () => 'text/event-stream; charset=utf-8' }, body },
    send(value) { controller.enqueue(typeof value === 'string' ? new TextEncoder().encode(value) : value) },
    close() { controller.close() }, cancelled }
}
const frame = (event, data, id = 'opaque-next') => `id: ${id}\r\nevent: ${event}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`
async function until(predicate) {
  for (let index = 0; index < 100; index++) { if (predicate()) return; await Promise.resolve() }
  expect(predicate()).toBe(true)
}
const receipt = (extra = {}) => ({ status: 'committed', operationId: 'read1', requestHash: HASH, committedRevision: '1',
  notification: notification({ read: true, readRevision: '1' }), preference: preference(), unreadCount: 10, replayed: false, ...extra })
afterEach(() => { active.splice(0).forEach(provider => provider.dispose()); vi.useRealTimers() })

describe('服务端全部已读', () => {
  it('发送规范read-all而非遍历已加载项，提交后重新读取当前快照', async () => {
    let reads = 0
    const request = vi.fn(async(url, init) => init.method === 'POST'
      ? json(200, receipt({ operationId: 'all-one', notification: null, readAll: { revision: '1' }, unreadCount: 0 }))
      : json(200, ++reads === 1 ? snapshot() : snapshot({ items: [notification({ read: true, readRevision: '1' }), notification({ notificationId: 'arrived-later', eventId: 'new-event' })], unreadCount: 1 })))
    const provider = port(request); await provider.snapshot()
    const result = await provider.markAllRead({ operationId: 'all-one' })
    expect(result).toMatchObject({ status: 'committed', readAll: { revision: '1' } })
    const posts = request.mock.calls.filter(([, init]) => init.method === 'POST')
    expect(posts).toHaveLength(1)
    expect(JSON.parse(posts[0][1].body)).toEqual({ operationId: 'all-one', kind: 'read-all', value: true, expectedRevision: '0' })
    expect(provider.getState().unreadCount).toBe(1)
    expect(provider.getState().items.find(item => item.notificationId === 'arrived-later').read).toBe(false)
  })
  it('同身份续权清投影但保留原GET，成功后续权不产生新的待确认提示', async () => {
    const request = vi.fn(async(url, init) => init.method === 'POST'
      ? json(503, { status: 'unknown', operationId: 'all-one', requestHash: HASH })
      : url.includes('/operations/') ? json(200, receipt({ operationId: 'all-one', notification: null, readAll: { revision: '1' } })) : json(200, snapshot()))
    const provider = port(request); await provider.snapshot()
    await expect(provider.markAllRead({ operationId: 'all-one' })).rejects.toMatchObject({ status: 'unknown' })
    provider.reset('authorization-required'); expect(provider.getState()).toMatchObject({ items: [], unreadCount: null })
    expect(provider.getOperation('all-one')).toMatchObject({ requestHash: HASH, status: 'unknown' })
    await provider.snapshot(); expect(provider.getPendingOperation()).toEqual({ operationId: 'all-one', status: 'unknown' })
    await expect(provider.queryOperation('all-one')).resolves.toMatchObject({ status: 'committed' })
    provider.reset('authorization-required'); await provider.snapshot(); expect(provider.getPendingOperation()).toBeNull()
    expect(request.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1)
    provider.reset('identity-changed'); expect(() => provider.queryOperation('all-one')).toThrow('CONTEXT_CHANGED')
  })
  it('503固定已知hash，原GET必须带同hash并拒绝另一个回执', async () => {
    const request = vi.fn(async(url, init) => init.method === 'POST'
      ? json(503, { status: 'unknown', operationId: 'all-one', requestHash: HASH })
      : url.includes('/operations/') ? json(200, receipt({ operationId: 'all-one', requestHash: 'sha256:' + 'b'.repeat(64), notification: null, readAll: { revision: '1' } }))
        : json(200, snapshot()))
    const provider = port(request); await provider.snapshot()
    await expect(provider.markAllRead({ operationId: 'all-one' })).rejects.toMatchObject({ status: 'unknown' })
    await expect(provider.queryOperation('all-one')).rejects.toMatchObject({ status: 'unknown' })
    expect(request.mock.calls.find(([url]) => url.includes('/operations/'))[0]).toContain(encodeURIComponent(HASH))
    expect(provider.getOperation('all-one').requestHash).toBe(HASH)
  })
  it('结果不明只原GET，不能再发新批次；原键重放接受新代际', async () => {
    const request = vi.fn(async(url, init) => {
      if (init.method === 'POST') throw Error('lost ACK')
      if (url.includes('/operations/')) return json(200, receipt({ operationId: 'all-one', notification: null, readAll: { revision: '5' }, unreadCount: 3, replayed: true }))
      return json(200, snapshot())
    })
    const provider = port(request); await provider.snapshot()
    await expect(provider.markAllRead({ operationId: 'all-one' })).rejects.toMatchObject({ status: 'unknown' })
    expect(() => provider.markAllRead({ operationId: 'all-two' })).toThrow('QUERY_REQUIRED')
    await expect(provider.queryOperation('all-one')).resolves.toMatchObject({ committedRevision: '1', readAll: { revision: '5' } })
    expect(request.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1)
    expect(() => provider.markAllRead({ cut: 'guessed' })).toThrow('INVALID_INPUT')
  })
})

describe('US9 HTTP/SSE端口（E1流注入，不是浏览器或真实PG证据）', () => {
  it('当前快照保服务端全量计数，丢正文/quote/seq，并固定Cookie doc范围', async () => {
    const request = vi.fn(async () => json(200, snapshot({ items: [notification({ quote: 'private quote', body: 'private body', seq: '99' })] })))
    const provider = port(request)
    await provider.snapshot()
    expect(provider.getState()).toMatchObject({ unreadCount: 11, principalId: 'alice', cursor: 'opaque-cut', items: [notification()] })
    expect(JSON.stringify(provider.getState())).not.toMatch(/private quote|private body|"seq"/)
    expect(request.mock.calls[0]).toMatchObject(['/editor/v1/tenants/tenant1/documents/doc1/notifications', { credentials: 'include', cache: 'no-store', redirect: 'error' }])
    expect(provider.getState().items).toHaveLength(1)
  })

  it('分片CRLF/UTF8只在完整SSE帧投影，cursor不作序号推断，重复业务键不增项', async () => {
    const wire = stream()
    const request = vi.fn(async url => url.endsWith('/events') ? wire.response : json(200, snapshot()))
    const provider = port(request); await provider.snapshot()
    const stop = provider.subscribe(() => {})
    await until(() => provider.getState().connection === 'connected')
    const bytes = new TextEncoder().encode(frame('notification', { notification: notification({ notificationId: 'notice2', eventId: 'event2', type: '文档更新' }), unreadCount: 12 }, 'opaque-z'))
    const cut = bytes.findIndex(value => value >= 224)
    wire.send(bytes.slice(0, cut + 1)); wire.send(bytes.slice(cut + 1, bytes.length - 1))
    await until(() => provider.getState().connection === 'connected')
    expect(provider.getState().cursor).toBe('opaque-cut')
    wire.send(bytes.slice(-1))
    await until(() => provider.getState().cursor === 'opaque-z')
    wire.send(frame('notification', { notification: notification({ notificationId: 'notice2', eventId: 'event2', type: '文档更新' }), unreadCount: 12 }, 'opaque-a'))
    await until(() => provider.getState().cursor === 'opaque-a')
    expect(provider.getState().items).toHaveLength(2)
    expect(provider.getState().unreadCount).toBe(12)
    expect(request.mock.calls[1][1]).toMatchObject({ headers: { 'Last-Event-ID': 'opaque-cut' }, credentials: 'include' })
    stop(); expect(wire.cancelled).toHaveBeenCalled()
  })

  it('历史页不覆盖新事件/已读revision，不用分页项猜全量count', async () => {
    const wire = stream(); let finishHistory
    const request = vi.fn(async url => url.endsWith('/events') ? wire.response : url.includes('historyCursor=')
      ? new Promise(resolve => { finishHistory = resolve }) : json(200, snapshot()))
    const provider = port(request); await provider.snapshot(); provider.subscribe(() => {})
    await until(() => provider.getState().connection === 'connected')
    const history = provider.loadMore()
    wire.send(frame('notification', { notification: notification({ read: true, readRevision: '2' }), unreadCount: 10 }))
    await until(() => provider.getState().items[0].readRevision === '2')
    finishHistory(json(200, { items: [notification(), notification({ notificationId: 'notice0', eventId: 'event0' })], hasMore: false, pageCursor: null, unreadCount: 999 }))
    await history
    expect(provider.getState().items.find(value => value.notificationId === 'notice1')).toMatchObject({ read: true, readRevision: '2' })
    expect(provider.getState().items).toHaveLength(2)
    expect(provider.getState().unreadCount).toBe(10)
  })

  it('HTTP410先清旧私密数据再当前快照，不从全局最早重放', async () => {
    const wire = stream(); let snapshots = 0, streams = 0
    const observed = []
    const request = vi.fn(async url => {
      if (url.endsWith('/events')) return ++streams === 1 ? { status: 410 } : wire.response
      return json(200, ++snapshots === 1 ? snapshot() : snapshot({ items: [], unreadCount: 0, cursor: 'fresh-current-cut', hasMore: false, pageCursor: null }))
    })
    const provider = port(request); await provider.snapshot(); provider.subscribe(value => observed.push(value))
    await until(() => provider.getState().connection === 'connected')
    expect(observed.some(value => value.reason === 'cursor-expired' && value.items.length === 0 && value.unreadCount === null)).toBe(true)
    expect(provider.getState()).toMatchObject({ items: [], unreadCount: 0, cursor: 'fresh-current-cut' })
    expect(request.mock.calls.filter(([url]) => url.endsWith('/events')).map(([, init]) => init.headers['Last-Event-ID'])).toEqual(['opaque-cut', 'fresh-current-cut'])
  })

  it('foreign404清cache并停止；当前缺读权不残留快照或继续读旧流', async () => {
    const request = vi.fn(async url => url.endsWith('/events') ? { status: 404 } : json(200, snapshot()))
    const provider = port(request); await provider.snapshot(); provider.subscribe(() => {})
    await until(() => provider.getState().status === 'error')
    expect(provider.getState()).toMatchObject({ items: [], preference: null, unreadCount: null, cursor: null })
    expect(request).toHaveBeenCalledTimes(2)
    let allowed = true
    const another = port(async () => json(200, snapshot()), { getCapabilities: () => ({ canView: allowed }) })
    await another.snapshot(); allowed = false
    expect(another.getState()).toMatchObject({ status: 'denied', items: [], unreadCount: null })
  })

  it('畸形SSE不能保留为当前私密投影', async () => {
    const wire = stream()
    const provider = port(async url => url.endsWith('/events') ? wire.response : json(200, snapshot()))
    await provider.snapshot(); provider.subscribe(() => {})
    await until(() => provider.getState().connection === 'connected')
    wire.send('id: opaque-next\nevent: notification\ndata: null\n\n')
    await until(() => provider.getState().status === 'error')
    expect(provider.getState()).toMatchObject({ items: [], cursor: null, unreadCount: null, reason: 'NOTIFICATION_INVALID_FRAME' })
  })

  it('控制帧清cache重取；Session转发一次reset以刷新旧私密评论读面', async () => {
    const first = stream(), second = stream(); let reads = 0, streams = 0
    const provider = port(async url => url.endsWith('/events') ? (++streams === 1 ? first.response : second.response)
      : json(200, ++reads === 1 ? snapshot() : snapshot({ items: [], unreadCount: 0, cursor: 'new-authz-cut' })))
    const session = createDocumentSession({ documentId: 'doc1', notifications: provider, capabilities: { canView: true } })
    const reset = vi.fn(); session.on('notifications-reset', reset)
    session.subscribeNotifications(() => {})
    await until(() => provider.getState().connection === 'connected')
    first.send('event: reset-required\ndata: {"code":"CURSOR_EXPIRED"}\n\n')
    await until(() => provider.getState().cursor === 'new-authz-cut')
    expect(reset).toHaveBeenCalledOnce()
    expect(provider.getState().items).toEqual([])
    expect(first.cancelled).toHaveBeenCalled()
    await session.dispose()
  })

  it('T089 精确source gap HTTP503立即清旧private投影并当前重取，不等重连耗尽', async () => {
    let reads = 0
    const observed = []
    const request = vi.fn(async url => url.endsWith('/events') ? json(503, { code: 'PG_PERMISSION_SOURCE_GAP' })
      : ++reads === 1 ? json(200, snapshot()) : json(503, { code: 'PG_PERMISSION_SOURCE_GAP' }))
    const provider = port(request); await provider.snapshot(); provider.subscribe(value => observed.push(value))
    await until(() => provider.getState().items.length === 0)
    expect(observed.some(value => value.reason === 'authorization-required' && value.resetRequired && value.items.length === 0 && value.unreadCount === null)).toBe(true)
    expect(provider.getState()).toMatchObject({ items: [], preference: null, principalId: null, cursor: null, unreadCount: null })
    expect(reads).toBe(2)
  })

  it('T089 opened权限控制帧先清缓存再重取；source gap期间不保留quote引用或旧计数', async () => {
    const wire = stream(); let reads = 0
    const observed = []
    const provider = port(async url => url.endsWith('/events') ? wire.response
      : ++reads === 1 ? json(200, snapshot()) : json(503, { code: 'PG_PERMISSION_SOURCE_GAP' }))
    await provider.snapshot(); provider.subscribe(value => observed.push(value))
    await until(() => provider.getState().connection === 'connected')
    wire.send('event: authorization-required\ndata: {"code":"AUTHORIZATION_REQUIRED"}\n\n')
    await until(() => provider.getState().status === 'error')
    expect(observed.some(value => value.reason === 'authorization-required' && value.items.length === 0 && value.cursor === null)).toBe(true)
    expect(provider.getState()).toMatchObject({ items: [], unreadCount: null, preference: null, principalId: null, cursor: null })
    expect(wire.cancelled).toHaveBeenCalled(); expect(reads).toBe(2)
  })

  it('T089 EOF后重连明确source gap即清旧cache，不沿原cursor无限保留', async () => {
    vi.useFakeTimers()
    const wire = stream(); let reads = 0, connections = 0
    const request = vi.fn(async url => url.endsWith('/events')
      ? ++connections === 1 ? wire.response : json(503, { code: 'PG_PERMISSION_SOURCE_GAP' })
      : ++reads === 1 ? json(200, snapshot()) : json(503, { code: 'PG_PERMISSION_SOURCE_GAP' }))
    const provider = port(request); await provider.snapshot(); provider.subscribe(() => {})
    await until(() => provider.getState().connection === 'connected')
    wire.close(); await until(() => provider.getState().connection === 'reconnecting')
    expect(provider.getState().items).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(500)
    expect(provider.getState()).toMatchObject({ items: [], preference: null, unreadCount: null, cursor: null })
    expect(connections).toBe(2); expect(reads).toBe(2)
  })

  it.each(['DATABASE_UNAVAILABLE', 'PG_PERMISSION_SOURCE_GAP_RETRY'])('T089 普通/非精确503 %s不伪装撤权，保留断流重连状态', async code => {
    const observed = []
    const provider = port(async url => url.endsWith('/events') ? json(503, { code }) : json(200, snapshot()))
    await provider.snapshot(); provider.subscribe(value => observed.push(value))
    await until(() => provider.getState().connection === 'reconnecting')
    expect(provider.getState()).toMatchObject({ items: [notification()], unreadCount: 11, cursor: 'opaque-cut', connection: 'reconnecting' })
    expect(observed.some(value => value.resetRequired || value.reason === 'authorization-required')).toBe(false)
  })

  it('丢流按原cursor重连，有界backoff耗尽后要求新快照', async () => {
    vi.useFakeTimers()
    const request = vi.fn(async url => { if (url.endsWith('/events')) throw new Error('network'); return json(200, snapshot()) })
    const provider = port(request); await provider.snapshot(); provider.subscribe(() => {})
    await until(() => provider.getState().connection === 'reconnecting')
    await vi.advanceTimersByTimeAsync(16000)
    expect(provider.getState()).toMatchObject({ status: 'error', reason: 'NOTIFICATION_RECONNECT_EXHAUSTED', items: [] })
    const calls = request.mock.calls.filter(([url]) => url.endsWith('/events'))
    expect(calls).toHaveLength(6)
    expect(calls.every(([, init]) => init.headers['Last-Event-ID'] === 'opaque-cut')).toBe(true)
  })

  it('dispose/替换generation拒绝晚到旧快照，abort连接且不再发callbacks', async () => {
    let finish
    const request = vi.fn(() => new Promise(resolve => { finish = resolve }))
    const provider = port(request)
    const pending = provider.snapshot()
    provider.reset('identity-changed')
    finish(json(200, snapshot()))
    await expect(pending).rejects.toMatchObject({ code: 'NOTIFICATION_CONTEXT_CHANGED' })
    expect(request.mock.calls[0][1].signal.aborted).toBe(true)
    expect(provider.getState().items).toEqual([])
    provider.dispose(); provider.reset('reopen')
    expect(provider.getState().status).toBe('disposed')
  })

  it('15秒deadline包含JSON解析，取消后旧响应不能回填缓存', async () => {
    vi.useFakeTimers()
    const request = vi.fn(async () => ({ status: 200, json: () => new Promise(() => {}) }))
    const provider = port(request)
    const pending = provider.snapshot().catch(error => error)
    await vi.advanceTimersByTimeAsync(15000)
    expect(await pending).toMatchObject({ code: 'NOTIFICATION_TIMEOUT' })
    expect(request.mock.calls[0][1].signal.aborted).toBe(true)
    expect(provider.getState().items).toEqual([])
  })
})

describe('通知read/mute原键确认（E1）', () => {
  it('reader按item CAS真实写，Cookie/CSRF不带actor；同id异intent无网络', async () => {
    let committed = false
    const request = vi.fn(async url => {
      if (url.endsWith('/notifications')) return json(200, committed ? snapshot({ items: [notification({ read: true, readRevision: '1' })], unreadCount: 10 }) : snapshot())
      committed = true; return json(200, receipt())
    })
    const provider = port(request); await provider.snapshot()
    await provider.markRead({ operationId: 'read1', notificationId: 'notice1', value: true, actor: 'root' })
    expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({ operationId: 'read1', kind: 'read', notificationId: 'notice1', value: true, expectedRevision: '0' })
    expect(request.mock.calls[1][1]).toMatchObject({ credentials: 'include', headers: { 'X-CSRF-Token': 'csrf', 'Idempotency-Key': 'read1' } })
    expect(provider.getState()).toMatchObject({ unreadCount: 10, items: [notification({ read: true, readRevision: '1' })] })
    expect(() => provider.markRead({ operationId: 'read1', notificationId: 'notice1', value: false })).toThrow('IDEMPOTENCY_MISMATCH')
    expect(() => provider.setMuted({ operationId: 'read1', value: true })).toThrow('IDEMPOTENCY_MISMATCH')
    expect(() => provider.markRead({ operationId: 'read1', notificationId: 'notice1', value: true, expectedRevision: '2' })).toThrow('IDEMPOTENCY_MISMATCH')
    expect(request).toHaveBeenCalledTimes(3)
  })

  it('unknown只QUERY原键；当前更高revision不会被原watermark倒灌', async () => {
    const request = vi.fn().mockResolvedValueOnce(json(200, snapshot())).mockRejectedValueOnce(new Error('lost'))
      .mockResolvedValueOnce(json(200, receipt({ notification: notification({ read: false, readRevision: '3' }), unreadCount: 11 })))
      .mockResolvedValueOnce(json(200, snapshot({ items: [notification({ read: false, readRevision: '3' })] })))
    const provider = port(request); await provider.snapshot()
    await expect(provider.markRead({ operationId: 'read1', notificationId: 'notice1', value: true })).rejects.toMatchObject({ status: 'unknown', operationId: 'read1' })
    await provider.queryOperation('read1')
    expect(request.mock.calls[2][0]).toBe('/editor/v1/tenants/tenant1/operations/read1?commandType=notification')
    expect(request.mock.calls[2][1].method).toBe('GET')
    expect(provider.getState().items[0]).toMatchObject({ read: false, readRevision: '3' })
    expect(provider.getOperation('read1').status).toBe('committed')
  })

  it.each([
    receipt({ operationId: 'wrong' }), receipt({ committedRevision: '2' }), receipt({ notification: null }),
    receipt({ preference: preference({ principalId: 'bob' }) }), receipt({ status: 'queued' }),
  ])('异原键/水位/主体/空通知不当已读成功 %j', async result => {
    const request = vi.fn().mockResolvedValueOnce(json(200, snapshot())).mockResolvedValueOnce(json(200, result))
    const provider = port(request); await provider.snapshot()
    const pending = provider.markRead({ operationId: 'read1', notificationId: 'notice1', value: true })
    if (result.preference.principalId !== 'alice') {
      await expect(pending).rejects.toMatchObject({ code: 'NOTIFICATION_CONTEXT_CHANGED' })
      expect(provider.getOperation('read1')).toMatchObject({ operationId: 'read1', status: 'unknown' }); expect(provider.getState().items).toEqual([])
    } else {
      await expect(pending).rejects.toMatchObject({ status: 'unknown' })
      expect(provider.getOperation('read1').status).toBe('unknown')
    }
  })

  it('read当前不可见不假成功；明确CAS409也不隐藏重试', async () => {
    const request = vi.fn().mockResolvedValueOnce(json(200, snapshot())).mockResolvedValueOnce(json(409, { code: 'REVISION_CONFLICT' }))
    const provider = port(request); await provider.snapshot()
    await expect(provider.markRead({ operationId: 'read1', notificationId: 'notice1', value: true })).rejects.toMatchObject({ status: 'rejected', httpStatus: 409 })
    expect(request).toHaveBeenCalledTimes(2)
    expect(provider.getOperation('read1').body.expectedRevision).toBe('0')
  })

  it('HTTP/SSE交叉不倒灌旧count，确认原操作后仅重新取快照', async () => {
    const wire = stream(); let finish, snapshots = 0
    const request = vi.fn(async (url, init) => {
      if (url.endsWith('/events')) return wire.response
      if (init.method === 'POST') return new Promise(resolve => { finish = resolve })
      return json(200, ++snapshots === 1 ? snapshot() : snapshot({ items: [notification({ read: true, readRevision: '1' })], unreadCount: 77, cursor: 'post-race-cut' }))
    })
    const provider = port(request); await provider.snapshot(); provider.subscribe(() => {})
    await until(() => provider.getState().connection === 'connected')
    const result = provider.markRead({ operationId: 'read1', notificationId: 'notice1', value: true })
    wire.send(frame('checkpoint', { unreadCount: 12 }))
    await until(() => provider.getState().unreadCount === 12)
    finish(json(200, receipt({ unreadCount: 10 })))
    await result
    await until(() => provider.getState().cursor === 'post-race-cut')
    expect(provider.getState().unreadCount).toBe(77)
    expect(request.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1)
    expect(provider.getOperation('read1').status).toBe('committed')
  })

  it('先enqueue的旧SSE在HTTP确认后才交付，不得写回旧未读数', async () => {
    let releaseOldFrame, reads = 0, streams = 0
    const cancel = vi.fn(async () => {})
    const oldReader = { read: () => new Promise(resolve => { releaseOldFrame = resolve }), cancel, releaseLock: () => {} }
    const next = stream()
    const request = vi.fn(async url => {
      if (url.endsWith('/events')) return ++streams === 1
        ? { status: 200, headers: { get: () => 'text/event-stream' }, body: { getReader: () => oldReader } } : next.response
      if (url.endsWith('/notification-operations')) return json(200, receipt({ unreadCount: 0 }))
      return json(200, ++reads === 1 ? snapshot({ unreadCount: 1 }) : snapshot({ items: [notification({ read: true, readRevision: '1' })], unreadCount: 0, cursor: 'post-commit-cut' }))
    })
    const provider = port(request); await provider.snapshot(); provider.subscribe(() => {})
    await until(() => typeof releaseOldFrame === 'function')
    const queuedBeforeCommit = new TextEncoder().encode(frame('notification', { notification: notification(), unreadCount: 1 }, 'old-enqueued-cut'))
    const result = await provider.markRead({ operationId: 'read1', notificationId: 'notice1', value: true })
    expect(result).toMatchObject({ status: 'committed', viewRefreshRequired: false })
    expect(cancel).toHaveBeenCalled()
    expect(request.mock.calls.find(([url]) => url.endsWith('/events'))[1].signal.aborted).toBe(true)
    releaseOldFrame({ done: false, value: queuedBeforeCommit })
    await until(() => provider.getState().connection === 'connected')
    expect(provider.getState()).toMatchObject({ cursor: 'post-commit-cut', unreadCount: 0, items: [notification({ read: true, readRevision: '1' })] })
    expect(request.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1)
  })

  it('提交后快照失败仍返回committed，只标视图需刷新，不降为unknown或再POST', async () => {
    let reads = 0
    const request = vi.fn(async url => url.endsWith('/notifications') ? (++reads === 1 ? json(200, snapshot()) : json(503, { code: 'TEMPORARILY_UNAVAILABLE' }))
      : json(200, receipt()))
    const provider = port(request); await provider.snapshot()
    await expect(provider.markRead({ operationId: 'read1', notificationId: 'notice1', value: true })).resolves.toMatchObject({ status: 'committed', viewRefreshRequired: true })
    expect(provider.getOperation('read1')).toMatchObject({ status: 'committed', viewRefreshRequired: true, requestHash: HASH })
    expect(provider.getState()).toMatchObject({ status: 'error', items: [], unreadCount: null })
    expect(request.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1)
  })

  it('通知点击借comments端口fresh复权，未读/关注不能绕private资格', async () => {
    const comments = { getLink: vi.fn(async () => 'https://app/doc#thread'), openLink: vi.fn(async () => ({ target: { threadId: 'thread:1', anchorStatus: 'orphaned' } })) }
    const provider = port(async () => json(200, snapshot()), { comments }); await provider.snapshot()
    expect(await provider.openThread('notice1')).toMatchObject({ target: { anchorStatus: 'orphaned' } })
    expect(comments.getLink).toHaveBeenCalledWith('thread:1')
    expect(comments.openLink).toHaveBeenCalledWith('https://app/doc#thread')
    comments.openLink.mockRejectedValueOnce(new Error('not visible'))
    await expect(provider.openThread('notice1')).rejects.toThrow('not visible')
  })
})

describe('Session通知生命周期（E1）', () => {
  it('Session same-identity refresh keeps the original notification subscriber after clearing its old private projection', async () => {
    const flags = { canView: true, canEdit: false, canComment: false }, wires = [], seen = []
    let resolveAuthorization, authorizationCalls = 0, snapshots = 0
    const authorizationPending = new Promise(resolve => { resolveAuthorization = resolve })
    const request = vi.fn(async url => {
      if (url.endsWith('/events')) { const wire = stream(); wires.push(wire); return wire.response }
      snapshots++
      return json(200, snapshots === 1 ? snapshot() : snapshot({ items: [notification({ notificationId: 'notice2', eventId: 'event2' })], unreadCount: 1, cursor: 'fresh-current-cut' }))
    })
    let session
    const provider = port(request, { getCapabilities: () => session?.getCapabilities() || flags })
    session = createDocumentSession({ documentId: 'doc1', user: { id: 'alice' }, notifications: provider,
      authorization: { async getCapabilities() { return ++authorizationCalls === 1 ? flags : authorizationPending } } })
    let stop
    try {
      await session._capabilitiesPromise
      stop = session.subscribeNotifications(value => seen.push(value))
      await until(() => provider.getState().connection === 'connected')
      expect(seen.some(value => value.items.some(item => item.notificationId === 'notice1'))).toBe(true)
      const identityReset = vi.fn(); session.on('notifications-identity', identityReset)
      const refreshed = session.refreshCapabilities()
      expect(provider.getState().items).toEqual([]); expect(seen.at(-1).items).toEqual([])
      resolveAuthorization(flags); await refreshed
      expect(session.user.id).toBe('alice'); expect(session.can('canView')).toBe(true)
      // No component-specific rebinding: the public Session subscription itself must recover.
      await until(() => seen.some(value => value.items.some(item => item.notificationId === 'notice2')))
      expect(provider.getState()).toMatchObject({ principalId: 'alice', cursor: 'fresh-current-cut' })
      expect(identityReset).not.toHaveBeenCalled(); expect(snapshots).toBe(2); expect(wires).toHaveLength(2)
    } finally { resolveAuthorization(flags); stop?.(); await session.dispose() }
  })
  it('仅真实user.id变化清理；displayname变化不冒充当前HTTP身份', async () => {
    const provider = port(async () => json(200, snapshot()))
    const reset = vi.spyOn(provider, 'reset')
    const session = createDocumentSession({ documentId: 'doc1', user: { id: 'alice', name: 'A' }, notifications: provider })
    session.user = { id: 'alice', name: 'New name' }
    expect(reset).not.toHaveBeenCalled()
    session.user = { id: 'bob', name: 'B' }
    expect(reset).toHaveBeenCalledWith('identity-changed')
    expect(provider.getState().items).toEqual([])
    await session.dispose()
    expect(() => session.setProvider('notifications', provider)).toThrow('已销毁')
  })
})


describe('HTTP notifications private context reset', () => {
  const held = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
  const observe = promise => promise.then(value => ({ value }), error => ({ error }))
  it('reset clears committed operation principal/body/hash as well as items, and retired IDs cannot POST', async () => {
    const request = vi.fn(async (url, init) => init.method === 'POST' ? json(200, receipt()) : json(200, snapshot()))
    const provider = port(request); await provider.snapshot(); await provider.markRead({ operationId: 'read1', notificationId: 'notice1', value: true })
    expect(provider.getOperation('read1')).not.toBeNull(); provider.reset('identity-changed')
    expect(provider.getOperation('read1')).toBeNull(); expect(provider.getState().items).toEqual([]); expect(provider.getState().principalId).toBeNull()
    const before = request.mock.calls.length
    for (const work of [() => provider.markRead({ operationId: 'read1', notificationId: 'notice1', value: true }), () => provider.queryOperation('read1')]) await expect(Promise.resolve().then(work)).rejects.toMatchObject({ code: 'NOTIFICATION_CONTEXT_CHANGED' })
    expect(request).toHaveBeenCalledTimes(before)
  })
  it.each(['response', 'json'])('reset aborts in-flight notification receipt %s and cannot refill operation caches', async phase => {
    const waiting = held(), entered = held(); let signal
    const request = vi.fn(async (_url, init) => {
      if (init.method !== 'POST') return json(200, snapshot())
      signal = init.signal; entered.resolve(); return phase === 'response' ? waiting.promise : { status: 200, json: () => waiting.promise }
    }), provider = port(request); await provider.snapshot()
    const pending = observe(provider.markRead({ operationId: 'read1', notificationId: 'notice1', value: true })); await entered.promise
    provider.reset(); expect(signal.aborted).toBe(true)
    const outcome = await pending; expect(outcome.error).toMatchObject({ code: 'NOTIFICATION_CONTEXT_CHANGED' }); expect(provider.getOperation('read1')).toBeNull()
    waiting.resolve(phase === 'response' ? json(200, receipt()) : receipt()); await Promise.resolve(); await Promise.resolve()
    expect(provider.getOperation('read1')).toBeNull(); expect(provider.getState().items).toEqual([])
  })
  it('an old snapshot never returns the next identity state or its late private error', async () => {
    const waiting = held(), entered = held(); let first = true
    const request = vi.fn(async () => { if (first) { first = false; entered.resolve(); return waiting.promise } return json(200, snapshot({ preference: preference({ principalId: 'bob' }) })) })
    const provider = port(request), pending = observe(provider.snapshot()); await entered.promise; provider.reset('identity-changed')
    const fresh = await provider.snapshot(); expect(fresh.principalId).toBe('bob')
    waiting.reject(Object.assign(new Error('Alice private notification'), { notification: notification() }))
    const old = await pending; expect(old.value).toBeUndefined(); expect(old.error).toMatchObject({ code: 'NOTIFICATION_CONTEXT_CHANGED' }); expect(JSON.stringify(old.error)).not.toContain('Alice')
    expect(provider.getState().principalId).toBe('bob')
  })
  it('reset between link awaits cannot start a new identity comments request using an old notification', async () => {
    const waiting = held(), entered = held(), comments = { getLink: vi.fn(() => { entered.resolve(); return waiting.promise }), openLink: vi.fn() }
    const provider = port(async () => json(200, snapshot()), { comments }); await provider.snapshot()
    const pending = observe(provider.openThread('notice1')); await entered.promise; provider.reset(); waiting.resolve('private old link')
    expect((await pending).error).toMatchObject({ code: 'NOTIFICATION_CONTEXT_CHANGED' }); expect(comments.openLink).not.toHaveBeenCalled()
  })
  it('dispose removes operation DTOs and later reset cannot expose the old actor', async () => {
    const request = vi.fn(async (_url, init) => init.method === 'POST' ? json(200, receipt()) : json(200, snapshot())), provider = port(request)
    await provider.snapshot(); await provider.markRead({ operationId: 'read1', notificationId: 'notice1', value: true }); provider.dispose(); provider.reset()
    expect(provider.getOperation('read1')).toBeNull(); expect(provider.getState().items).toEqual([]); expect(provider.getState().principalId).toBeNull()
  })
})


describe('HTTP notification same-identity view refresh', () => {
  it.each(['cursor-expired', 'reset-required', 'history-cursor-expired'])('%s refresh preserves an unknown operation for original GET only', async reason => {
    const request = vi.fn(async (url, init) => {
      if (url.includes('/notifications')) return json(200, snapshot())
      if (init.method === 'POST') throw new Error('lost acknowledgement')
      return json(200, receipt())
    })
    const provider = port(request); await provider.snapshot()
    await expect(provider.markRead({ operationId: 'read1', notificationId: 'notice1', value: true })).rejects.toMatchObject({ status: 'unknown' })
    await provider.snapshot(reason); expect(provider.getOperation('read1')).toMatchObject({ status: 'unknown' })
    expect((await provider.queryOperation('read1')).status).toBe('committed')
    expect(request.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1)
    expect(request.mock.calls.some(([url, init]) => init.method === 'GET' && url.endsWith('/operations/read1?commandType=notification'))).toBe(true)
  })
})
