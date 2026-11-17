/* global globalThis */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash, webcrypto } from 'node:crypto'
import { createHttpAssetProvider } from '../../src/providers/upload'
import { createHttpCommentsProvider } from '../../src/providers/comments'
import { createHttpIdentityProvider } from '../../src/providers/identity'
import { createDocumentSession } from '../../src/session/DocumentSession'
import { bindThreads } from '../../src/core/comments/binding'
import commentsMixin from '../../src/components/lark-doc/editor/commentsMixin'
import { createCommentInteraction } from '../../src/components/lark-doc/editor/commentInteraction'
import { commentPanelComputed, commentPanelMethods } from '../../src/components/lark-doc/editor/commentPanelView'

const HASH = `sha256:${'a'.repeat(64)}`
const AT = '2026-11-07T01:00:00.000Z'
const FLAGS = { canView: true, canEdit: false, canComment: true, canResolveComment: true }
const anchor = { kind: 'y', blockId: 'block1', offset: 0, length: 1, from: 'AQ==', to: 'Ag==' }
function thread(overrides = {}) {
  return { tenantId: 'tenant1', docId: 'doc1', id: 'thread:1', creator: 'alice', author: { id: 'alice', name: 'Alice' },
    scope: 'document', visibility: 'private', blockId: null, anchor: null, rawAnchor: null, sourceEpoch: null, sourceSeq: null,
    anchorStatus: 'document', participants: ['alice', 'bob'], threadRevision: '1', resolved: false, tombstone: false,
    createdAt: AT, updatedAt: AT, capabilities: { canReply: true, canResolve: true, canReopen: false, canManageParticipants: true, canChangeVisibility: true },
    replies: [{ id: 'reply:1', author: { id: 'alice', name: 'Alice' }, content: 'private text', replyRevision: '1',
      createdAt: AT, editedAt: null, deletedAt: null, tombstone: false, capabilities: { canEdit: true, canDelete: true } }], ...overrides }
}
const response = (status, data) => ({ status, json: async () => data })
const committed = (operationId, value = thread(), committedRevision = '1') => response(201, { status: 'committed', operationId, requestHash: HASH, committedRevision, thread: value, replayed: false })
function provider(request, extra = {}) {
  return createHttpCommentsProvider({ tenantId: 'tenant1', docId: 'doc1', csrfToken: () => 'csrf', request,
    getCapabilities: () => FLAGS, getState: () => ({ status: 'ready', epoch: '9007199254740993', lastSeq: '7', pending: [], canWrite: false }), ...extra })
}
function ctx(extra = {}) {
  const vm = { ...commentsMixin.data(), ...commentsMixin.methods, commentAuthor: { id: 'alice', name: 'Alice' },
    $set: (object, key, value) => { object[key] = value }, $nextTick: () => {}, ...extra }
  const panel = { ed: vm, ...commentPanelMethods }
  Object.keys(commentPanelMethods).forEach(name => { if (typeof vm[name] !== 'function') vm[name] = (...args) => panel[name](...args) })
  return vm
}
afterEach(() => vi.useRealTimers())

describe('Session private reset integration boundaries (E1)', () => {
  it('同身份授权复核打断提交时自动GET原键，普通unknown仍保留人工核对且不二POST', async () => {
    for (const code of ['COMMENT_CONTEXT_CHANGED', 'NETWORK_UNKNOWN']) {
      const port = { setParticipants: vi.fn(async () => { throw { code, status: 'unknown', operationId: 'original-key' } }), queryOperation: vi.fn(async () => thread()) }
      const vm = ctx({ commentRemote: true, commentCan: () => true, commentProvider: () => port, commentOperationCurrent: () => () => true, clearUnavailableCommentView: async () => {}, loadComments: async () => [] })
      await vm.runCommentWrite('setParticipants', { threadId: 'thread:1', participants: [] })
      await vi.waitFor(() => expect(port.queryOperation).toHaveBeenCalledTimes(code === 'COMMENT_CONTEXT_CHANGED' ? 1 : 0))
      expect(port.setParticipants).toHaveBeenCalledTimes(1)
      expect(vm.commentPendingOperation).toBe(code === 'COMMENT_CONTEXT_CHANGED' ? '' : 'original-key')
    }
  })
  it('读请求进行中收到多次推送只再读一次，绝不定时轮询', async () => {
    let release
    const gate = new Promise(resolve => { release = resolve })
    const load = vi.fn().mockImplementationOnce(() => gate).mockResolvedValue([])
    const vm = ctx({ commentRemote: true, commentCan: () => true, loadComments: load })
    const first = vm.refreshCommentsFromSignal()
    vm.refreshCommentsFromSignal(); vm.refreshCommentsFromSignal()
    expect(load).toHaveBeenCalledTimes(1)
    release([]); await first
    expect(load).toHaveBeenCalledTimes(2)
  })
  it.each(['user', 'permissions', 'dispose', 'replace'])('Session private reset comments: %s clears real HTTP records before they can be reused', async boundary => {
    let allowed = true, session
    const id = 'session-private-comment', request = vi.fn(async (url, init) => init.method === 'GET' ? response(200, thread()) : committed(id))
    const port = provider(request, { getCapabilities: () => session?.getCapabilities() || FLAGS })
    session = createDocumentSession({ documentId: 'doc1', user: { id: 'alice' }, comments: port,
      authorization: { async getCapabilities() { return allowed ? FLAGS : { canView: false, canComment: false } } } })
    try {
      await session._capabilitiesPromise
      await session.createCommentThread({ operationId: id, scope: 'document', visibility: 'private', content: 'private text' })
      expect(port.getOperation(id)).not.toBeNull()
      if (boundary === 'user') session.user = { id: 'bob' }
      else if (boundary === 'permissions') { allowed = false; await session.refreshCapabilities() }
      else if (boundary === 'dispose') await session.dispose()
      else session.setProvider('comments', provider(async () => response(404, { code: 'PG_COMMENT_NOT_FOUND' })))
      expect(port.getOperation(id)).toBeNull()
      if (boundary === 'permissions') { allowed = true; await session.refreshCapabilities(); expect(session.getCommentOperation(id)).toBeNull() }
      const before = request.mock.calls.length
      await expect(Promise.resolve().then(() => port.createThread({ operationId: id, scope: 'document', visibility: 'private', content: 'private text' }))).rejects.toBeInstanceOf(Error)
      expect(request).toHaveBeenCalledTimes(before)
    } finally { await session.dispose(); port.dispose() }
  })
  it('Session private reset comments: legacy A-B-A aborts an actual private read and emits no late source', async () => {
    let release, entered, signal
    const waiting = new Promise(resolve => { release = resolve }), reached = new Promise(resolve => { entered = resolve })
    const request = vi.fn(async (url, init) => { signal = init.signal; entered(); return waiting }), port = provider(request)
    const session = createDocumentSession({ documentId: 'doc1', user: { id: 'alice' }, comments: port, capabilities: FLAGS }), emitted = vi.fn()
    session.on('comments', emitted)
    try {
      const pending = session.getCommentThread('thread:1').then(value => ({ value }), error => ({ error }))
      await reached; session.user = { id: 'bob' }; session.user = { id: 'alice' }
      expect(signal.aborted).toBe(true); release(response(200, thread()))
      const result = await pending; expect(result.value).toBeUndefined(); expect(result.error).toBeInstanceOf(Error); expect(emitted).not.toHaveBeenCalled()
      expect(JSON.stringify(result)).not.toContain('private text')
    } finally { release?.(response(200, thread())); await session.dispose(); port.dispose() }
  })
})

describe('真实HTTP评论端口契约（E1注入端口，不代表PG/浏览器验收）', () => {
  it('只发送业务命令与Cookie/CSRF，不把宿主author/actor当可信身份', async () => {
    const request = vi.fn(async () => committed('op1'))
    const port = provider(request)
    const result = await port.createThread({ operationId: 'op1', scope: 'document', visibility: 'private', content: 'private text', author: { id: 'forged' }, actor: 'root' })
    const [url, init] = request.mock.calls[0]
    expect(url).toBe('/editor/v1/tenants/tenant1/documents/doc1/comment-threads')
    expect(init).toMatchObject({ method: 'POST', credentials: 'include', cache: 'no-store', redirect: 'error', headers: { 'X-CSRF-Token': 'csrf', 'Idempotency-Key': 'op1' } })
    expect(JSON.parse(init.body)).toEqual({ operationId: 'op1', expectedRevision: '0', scope: 'document', visibility: 'private', content: 'private text', blockId: null, anchor: null, sourceEpoch: null, sourceSeq: null })
    expect(result.createdAt).toBe(Date.parse(AT))
    expect(result.anchor).toBeNull()
    expect(port.getOperation('op1')).toMatchObject({ status: 'committed', requestHash: HASH })
  })

  it('comment-only使用已durable来源和二进制相对位置端点编码，不要求document.write', async () => {
    const selected = thread({ scope: 'selection', blockId: 'block1', anchor, rawAnchor: anchor, anchorStatus: 'attached', sourceEpoch: '9007199254740993', sourceSeq: '7' })
    const request = vi.fn(async () => committed('op1', selected))
    const port = provider(request)
    const result = await port.createThread({ operationId: 'op1', content: 'private text', anchor: { ...anchor, from: new Uint8Array([1]), to: new Uint8Array([2]) } })
    expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({ sourceEpoch: '9007199254740993', sourceSeq: '7', anchor })
    expect(result.anchor.from).toBeInstanceOf(Uint8Array)
    expect(result.rawAnchor.from).toBe('AQ==')
  })

  it('plain锚点、未确认正文或缺失当前权限均在请求前拒绝', async () => {
    const request = vi.fn()
    await expect(provider(request).createThread({ operationId: 'plain', content: 'text', anchor: { blockId: 'block1', offset: 0, length: 1 } })).rejects.toMatchObject({ code: 'COMMENT_ANCHOR_REQUIRED' })
    await expect(provider(request, { getState: () => ({ status: 'ready', epoch: '1', lastSeq: '1', pending: [{ updateId: 'unconfirmed' }] }) }).createThread({ operationId: 'pending', content: 'text', anchor })).rejects.toMatchObject({ code: 'COMMENT_SOURCE_NOT_DURABLE' })
    await expect(provider(request, { getCapabilities: () => undefined }).createThread({ operationId: 'denied', scope: 'document', content: 'text' })).rejects.toMatchObject({ code: 'COMMENT_FORBIDDEN' })
    expect(request).not.toHaveBeenCalled()
  })

  it.each([{}, { status: 'unknown', operationId: 'op1' }, { status: 'committed', operationId: 'other', requestHash: HASH, committedRevision: '1', thread: thread() }])('2xx畸形/未知/异原键不假成功 %j', async data => {
    const port = provider(async () => response(200, data))
    await expect(port.createThread({ operationId: 'op1', scope: 'document', content: 'text' })).rejects.toMatchObject({ operationId: 'op1', status: 'unknown' })
    expect(port.getOperation('op1').status).toBe('unknown')
  })

  it('202仍unknown，网络异常不重发；原键查询可返回更高revision的当前复权视图', async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error('connection lost')).mockResolvedValueOnce(committed('op1', thread({ threadRevision: '5' })))
    const port = provider(request)
    await expect(port.createThread({ operationId: 'op1', scope: 'document', content: 'text' })).rejects.toMatchObject({ status: 'unknown', operationId: 'op1' })
    expect(request).toHaveBeenCalledTimes(1)
    const result = await port.queryOperation('op1')
    expect(result.threadRevision).toBe('5')
    expect(request.mock.calls[1][0]).toBe('/editor/v1/tenants/tenant1/operations/op1?commandType=comment')
    expect(request.mock.calls[1][1].method).toBe('GET')
    const pending = provider(async () => response(202, { status: 'committed', operationId: 'op2', requestHash: HASH, thread: thread(), committedRevision: '1' }))
    await expect(pending.createThread({ operationId: 'op2', scope: 'document', content: 'text' })).rejects.toMatchObject({ status: 'unknown' })
  })

  it('同id异内容/动作/CAS/参与者均本地拒绝，不POST也不QUERY', async () => {
    const request = vi.fn(async () => committed('op1'))
    const port = provider(request)
    const input = { operationId: 'op1', scope: 'document', content: 'text', participants: ['alice'] }
    await port.createThread(input)
    for (const changed of [{ ...input, content: 'changed' }, { ...input, expectedRevision: '1' }, { ...input, participants: ['bob'] }, { ...input, visibility: 'private' }]) {
      await expect(port.createThread(changed)).rejects.toMatchObject({ code: 'IDEMPOTENCY_MISMATCH' })
    }
    await expect(port.reply({ ...input, threadId: 'thread:1' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_MISMATCH' })
    expect(request).toHaveBeenCalledTimes(1)
    await port.createThread(input)
    expect(request.mock.calls[1][1].method).toBe('GET')
  })

  it('同意图重入沿原source/CAS，不读取后来bridge水位；修改端点本地拒绝', async () => {
    let state = { status: 'ready', epoch: '2', lastSeq: '8', pending: [] }
    const selected = thread({ scope: 'selection', blockId: 'block1', anchor, rawAnchor: anchor, anchorStatus: 'attached', sourceEpoch: '2', sourceSeq: '8' })
    const request = vi.fn(async () => committed('op1', selected))
    const port = provider(request, { getState: () => state })
    const input = { operationId: 'op1', content: 'text', anchor }
    await port.createThread(input)
    state = { status: 'blocked', epoch: '3', lastSeq: '100', pending: [{ updateId: 'local' }] }
    await port.createThread(input)
    expect(request.mock.calls[1][1].method).toBe('GET')
    await expect(port.createThread({ ...input, anchor: { ...anchor, from: 'Aw==' } })).rejects.toMatchObject({ code: 'IDEMPOTENCY_MISMATCH' })
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('查询不能替换已知requestHash，异文档thread不能成为成功', async () => {
    const request = vi.fn().mockResolvedValueOnce(committed('op1')).mockResolvedValueOnce(response(200, { status: 'committed', operationId: 'op1', requestHash: `sha256:${'b'.repeat(64)}`, committedRevision: '1', thread: thread() }))
    const port = provider(request)
    await port.createThread({ operationId: 'op1', scope: 'document', content: 'text' })
    await expect(port.queryOperation('op1')).rejects.toMatchObject({ status: 'unknown' })
    await expect(provider(async () => committed('op2', thread({ docId: 'another' }))).createThread({ operationId: 'op2', scope: 'document', content: 'text' })).rejects.toMatchObject({ status: 'unknown' })
  })

  it('服务端逐动作能力为上限，返回副本篡改不能提升后续edit权限', async () => {
    const denied = thread(); denied.replies[0].capabilities.canEdit = false
    const request = vi.fn(async () => response(200, [denied]))
    const port = provider(request)
    const list = await port.list()
    list[0].replies[0].capabilities.canEdit = true
    await expect(port.editReply({ operationId: 'op1', threadId: denied.id, replyId: 'reply:1', content: 'changed' })).rejects.toMatchObject({ code: 'COMMENT_FORBIDDEN' })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('15秒总deadline同时覆盖response.json，超时保unknown无自动重试', async () => {
    vi.useFakeTimers()
    const request = vi.fn(async () => ({ status: 200, json: () => new Promise(() => {}) }))
    const port = provider(request)
    const result = port.createThread({ operationId: 'op1', scope: 'document', content: 'text' }).catch(error => error)
    await vi.advanceTimersByTimeAsync(15000)
    expect(await result).toMatchObject({ code: 'COMMENT_TIMEOUT', status: 'unknown', operationId: 'op1' })
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0][1].signal.aborted).toBe(true)
  })
})

describe('评论视图/Session隔离（E1）', () => {
  it('document评论不造锚点；服务端orphaned保raw不按旧block吸附', () => {
    const raw = thread({ scope: 'selection', blockId: 'block1', anchor, rawAnchor: anchor, anchorStatus: 'orphaned', sourceEpoch: '1', sourceSeq: '1' })
    const values = bindThreads(['block1'], [thread(), raw], { encode: value => value, decode: () => ({ blockId: 'block1', offset: 0, length: 1 }) })
    expect(values[0]).toMatchObject({ scope: 'document', anchor: null, blockId: null, anchorStatus: 'document' })
    expect(values[1]).toMatchObject({ bound: false, anchorStatus: 'orphaned', rawAnchor: anchor, visibility: 'private', threadRevision: '1' })
    expect(raw.anchor).toBe(anchor)
  })

  it('远端评论绝不落公共mark，comment-only仍能通过真实codec发起', async () => {
    const remote = { isRemote: true }
    const create = vi.fn(async () => ({ id: 'thread:1' }))
    const context = ctx({ session: { can: () => true, getProvider: () => remote }, writable: () => false,
      editor: { commands: { setComment: vi.fn() } },
      commentSelectionRange: () => ({ blockId: 'block1', offset: 0, length: 1, from: 1, to: 2, text: 'x' }),
      commentAnchorCodec: { encode: () => ({ ...anchor, from: new Uint8Array([1]), to: new Uint8Array([2]) }), decode: () => null },
      runCommentWrite: create, activateComment: vi.fn() })
    await context.createCommentFromSelection('text')
    expect(create.mock.calls[0][1].anchor.kind).toBe('y')
    expect(context.applyCommentMark('private-id', 1, 2)).toBe(false)
    expect(context.editor.commands.setComment).not.toHaveBeenCalled()
  })

  it('unknown保留原草稿/操作号，不本地增回复或再POST', async () => {
    const remote = { isRemote: true, reply: vi.fn(async () => { throw Object.assign(new Error('lost'), { status: 'unknown', operationId: 'original' }) }) }
    const context = ctx({ session: { can: () => true, getProvider: () => remote },
      commentThreads: [{ id: 'thread:1', replies: [], capabilities: { canReply: true } }], commentDrafts: { 'thread:1': 'retained' } })
    await context.submitCommentDraft('thread:1')
    expect(context.commentPendingOperation).toBe('original')
    expect(context.commentDrafts['thread:1']).toBe('retained')
    expect(context.commentThreads[0].replies).toEqual([])
    await context.submitCommentDraft('thread:1')
    expect(remote.reply).toHaveBeenCalledTimes(1)
  })

  it('Session评论不借用canEdit，权限加载失败仍关闭全部写入口', async () => {
    const remote = provider(async () => committed('op1'))
    const session = createDocumentSession({ documentId: 'doc1', comments: remote, capabilities: FLAGS })
    expect(session.can('canEdit')).toBe(false)
    await expect(session.createCommentThread({ operationId: 'op1', scope: 'document', content: 'text' })).resolves.toMatchObject({ id: 'thread:1' })
    session.setProvider('authorization', { getCapabilities: async () => { throw new Error('unavailable') } })
    await expect(session.createCommentThread({ operationId: 'op2', scope: 'document', content: 'text' })).rejects.toThrow('没有评论操作权限')
    await session.dispose()
  })

  it('晚到的列表不能在权限撤销/销毁后恢复私密数据', async () => {
    let finish
    const remote = { isRemote: true, list: () => new Promise(resolve => { finish = resolve }) }
    const context = ctx({ editor: null, session: { can: () => true, getProvider: () => remote } })
    const pending = context.loadComments()
    context.commentDisposed = true; context.commentLoadGeneration++
    finish([thread()])
    await pending
    expect(context.commentThreads).toEqual([])
    expect(context.commentSourceThreads).toEqual([])
  })
})

const preference = (extra = {}) => ({ tenantId: 'tenant1', docId: 'doc1', threadId: 'thread:1', principalId: 'alice',
  following: false, muted: false, preferenceRevision: '0', ...extra })
const followResult = (operationId, value, committedRevision = '1') => response(200, { status: 'committed', operationId,
  requestHash: HASH, committedRevision, preference: value, replayed: false })

describe('真实HTTP身份链的评论凭据轮换（E1，不代表浏览器或PG验收）', () => {
  const owned = [], releases = []
  const deferred = () => {
    let resolve
    const promise = new Promise(yes => { resolve = yes })
    return { promise, resolve }
  }
  beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('crypto', webcrypto) })
  afterEach(async () => {
    releases.splice(0).forEach(release => release(response(404, {})))
    for (const value of owned.splice(0).reverse()) await value.dispose()
    vi.unstubAllGlobals()
  })
  async function harness(action, preparing = false) {
    const following = action.includes('follow'), querying = action.startsWith('query-')
    const waiting = deferred(), reached = deferred()
    releases.push(waiting.resolve)
    let stage = querying ? 'seed' : 'hold', originalId, signal, allowed = true
    let principalId = 'alice', csrfToken = 'A'.repeat(43), denied = false, session
    const identityRequest = vi.fn(async () => ({ status: denied ? 401 : 200,
      headers: { get: name => name.toLowerCase() === 'content-type' ? 'application/json' : null },
      json: async () => denied ? { status: 'denied', code: 'IDENTITY_DENIED' } : {
        status: 'authenticated', principalId, csrfToken, canCreate: false, refreshAfterMs: 1000, expiresInMs: 4000,
      } }))
    const identity = createHttpIdentityProvider({ tenantId: 'tenant1', docId: 'doc1', request: identityRequest })
    owned.push(identity)
    await identity.login({ operationId: 'comment-credential-login', loginCode: 'comment-credential-code' })
    const receipt = () => following ? followResult(originalId, preference({ following: true, preferenceRevision: '1' })) : committed(originalId)
    const hold = init => { signal = init.signal; reached.resolve(); return waiting.promise }
    const request = vi.fn(async (url, init) => {
      if (init.method === 'GET' && url.endsWith('/follow-preference')) {
        return preparing && stage === 'hold' ? hold(init) : response(200, preference())
      }
      if (init.method === 'POST') {
        originalId = JSON.parse(init.body).operationId
        if (stage === 'seed') return response(503, { status: 'unknown', code: 'COMMIT_UNKNOWN', operationId: originalId })
        return hold(init)
      }
      if (url.includes('/operations/')) return stage === 'hold' ? hold(init) : receipt()
      throw new Error('unexpected comment request')
    })
    const port = provider(request, { csrfToken: () => identity.getCsrfToken(), getCapabilities: () => session?.getCapabilities() || FLAGS })
    owned.push(port)
    session = createDocumentSession({ documentId: 'doc1', identity, comments: port,
      authorization: { async getCapabilities() { return allowed ? FLAGS : { canView: false, canComment: false } } } })
    owned.push(session)
    await session._capabilitiesPromise
    const published = vi.fn(); session.on('comments', published)
    const submit = operationId => following ? session.followComment({ threadId: 'thread:1', ...(operationId ? { operationId } : {}) })
      : session.createCommentThread({ scope: 'document', visibility: 'private', content: 'held private draft', ...(operationId ? { operationId } : {}) })
    const query = () => following ? session.queryCommentFollowOperation(originalId) : session.queryCommentOperation(originalId)
    if (querying) {
      await expect(submit('comment-credential-original')).rejects.toMatchObject({ status: 'unknown', operationId: 'comment-credential-original' })
      stage = 'hold'
    }
    return { session, identity, port, request, identityRequest, published, reached, waiting, submit, query,
      start: () => querying ? query() : submit(), get originalId() { return originalId }, get signal() { return signal },
      recover() { stage = 'recover' },
      async rotate(extra = {}) {
        principalId = extra.principalId || principalId
        csrfToken = extra.csrfToken || 'B'.repeat(43)
        if (extra.allowed !== undefined) allowed = extra.allowed
        denied = extra.denied === true
        await identity.refresh(); await session._capabilitiesPromise
      } }
  }
  it.each(['write', 'follow', 'query-write', 'query-follow'])('%s在真实同主体CSRF轮换后保原键，恢复只GET且不发布旧正文', async action => {
    const h = await harness(action), before = h.session._identityGeneration, owner = h.session._privateIdentityGeneration
    const pending = h.start().then(value => ({ value }), error => ({ error }))
    await h.reached.promise
    const originalId = h.originalId
    expect(originalId).toBeTruthy()
    await h.rotate()
    expect(h.identity.getState()).toMatchObject({ status: 'authenticated', principalId: 'alice' })
    expect(h.identityRequest.mock.calls.at(-1)[0]).toMatch(/\/sessions\/current$/)
    expect(h.session._identityGeneration).toBeGreaterThan(before)
    expect(h.session._privateIdentityGeneration).toBe(owner)
    expect(h.signal.aborted).toBe(true)
    const result = await pending
    expect(result.value).toBeUndefined()
    expect(result.error).toMatchObject({ code: 'IDENTITY_CONTEXT_CHANGED', status: 'unknown', operationId: originalId })
    expect(JSON.stringify(result)).not.toContain('held private draft')
    expect(h.published).not.toHaveBeenCalled()
    h.recover()
    await expect(h.query()).resolves.toMatchObject(action.includes('follow') ? { following: true } : { id: 'thread:1' })
    expect(h.request.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1)
    const confirmations = h.request.mock.calls.filter(([url]) => url.includes('/operations/'))
    expect(confirmations).toHaveLength(action.startsWith('query-') ? 2 : 1)
    expect(confirmations.every(([url, init]) => url.includes(`/operations/${encodeURIComponent(originalId)}?`) && init.method === 'GET' && init.body === undefined)).toBe(true)
  })
  it('真实关注预读尚未POST时轮换保submitted:false，不误置为unknown或发送新POST', async () => {
    const h = await harness('follow', true)
    const pending = h.submit('comment-preparation-original').then(value => ({ value }), error => ({ error }))
    await h.reached.promise; await h.rotate()
    const result = await pending
    expect(result.value).toBeUndefined()
    expect(result.error).toMatchObject({ code: 'IDENTITY_CONTEXT_CHANGED', status: 'rejected', submitted: false, operationId: 'comment-preparation-original' })
    expect(h.signal.aborted).toBe(true); expect(h.published).not.toHaveBeenCalled()
    await expect(h.session.queryCommentFollowOperation('comment-preparation-original')).rejects.toMatchObject({ code: 'COMMENT_CONTEXT_CHANGED' })
    expect(h.request.mock.calls.map(([, init]) => init.method)).toEqual(['GET'])
  })
  it('真实身份A→B→A继续退休旧键，迟到成功和原GET均不能返回旧私密正文', async () => {
    const h = await harness('write'), owner = h.session._privateIdentityGeneration
    const pending = h.start().then(value => ({ value }), error => ({ error }))
    await h.reached.promise
    const originalId = h.originalId
    await h.rotate({ principalId: 'bob' }); await h.rotate({ principalId: 'alice', csrfToken: 'C'.repeat(43) })
    h.waiting.resolve(committed(originalId))
    const result = await pending
    expect(result.value).toBeUndefined(); expect(result.error).toMatchObject({ code: 'IDENTITY_CONTEXT_CHANGED', operationId: originalId })
    expect(h.session._privateIdentityGeneration).toBeGreaterThan(owner)
    expect(h.published).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain('private text')
    const count = h.request.mock.calls.length
    await expect(h.query()).rejects.toMatchObject({ code: 'COMMENT_CONTEXT_CHANGED' })
    expect(h.request).toHaveBeenCalledTimes(count)
  })
  it('同主体轮换后read被撤销时不能GET确认，复权仍仅查原键', async () => {
    const h = await harness('write')
    const pending = h.start().then(value => ({ value }), error => ({ error }))
    await h.reached.promise; await h.rotate({ allowed: false })
    const result = await pending
    expect(result.value).toBeUndefined(); expect(result.error).toMatchObject({ status: 'unknown', operationId: h.originalId })
    expect(h.session.can('canView')).toBe(false); expect(h.published).not.toHaveBeenCalled()
    const count = h.request.mock.calls.length
    await expect(h.query()).rejects.toBeInstanceOf(Error)
    expect(h.request).toHaveBeenCalledTimes(count)
    await h.rotate({ allowed: true, csrfToken: 'C'.repeat(43) }); h.recover()
    await expect(h.query()).resolves.toMatchObject({ id: 'thread:1' })
    expect(h.request.mock.calls.map(([, init]) => init.method)).toEqual(['POST', 'GET'])
  })
  it('真实/current拒绝身份后退休私有操作，不能借旧键恢复读权限', async () => {
    const h = await harness('write'), owner = h.session._privateIdentityGeneration
    const pending = h.start().then(value => ({ value }), error => ({ error }))
    await h.reached.promise; await h.rotate({ denied: true })
    const result = await pending
    expect(result.value).toBeUndefined(); expect(result.error).toMatchObject({ code: 'IDENTITY_CONTEXT_CHANGED', operationId: h.originalId })
    expect(h.identity.getState().status).toBe('denied')
    expect(h.session._privateIdentityGeneration).toBeGreaterThan(owner)
    expect(h.session.can('canView')).toBe(false); expect(h.published).not.toHaveBeenCalled()
    const count = h.request.mock.calls.length
    await expect(h.query()).rejects.toBeInstanceOf(Error)
    expect(h.request).toHaveBeenCalledTimes(count)
  })
})

describe('评论异步操作的身份归属', () => {
  it('远程翻译入口不在请求前谎报依赖未接通', () => {
    expect(commentPanelComputed.commentMenuItems.call({ ed: { commentRemote: true } }).find(item => item.id === 'translate')).toMatchObject({ label: '翻译', submenu: false })
  })
  const held = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
  function view() {
    const wait = held()
    const port = { isRemote: true, list: async () => [], createThread: vi.fn(() => wait.promise), reply: async () => {}, resolve: async () => {}, reopen: async () => {},
      follow: vi.fn(() => wait.promise), getFollowPreference: async () => preference(), queryOperation: vi.fn(() => wait.promise), queryFollowOperation: vi.fn(() => wait.promise) }
    const session = createDocumentSession({ documentId: 'doc1', user: { id: 'alice' }, comments: port, capabilities: FLAGS })
    const vm = ctx({ session, refreshCommentDecorations: vi.fn(), loadComments: vi.fn(async () => []) })
    vm.bindCommentSession(); vm.commentFollowPreferences['thread:1'] = preference()
    return { vm, session, port, wait }
  }
  it.each(['write', 'follow', 'query-write', 'query-follow'])('%s的迟到unknown不能写入切换后的身份视图或解除其busy', async action => {
    const h = view(), { vm, session, wait } = h
    if (action === 'query-write') vm.commentPendingOperation = 'old-operation'
    if (action === 'query-follow') vm.commentPendingFollowOperation = 'old-operation'
    const pending = action === 'write' ? vm.createDocumentComment('old draft') : action === 'follow' ? vm.changeCommentFollow('thread:1', 'follow')
      : action === 'query-write' ? vm.queryPendingComment() : vm.queryPendingCommentFollow()
    session.user = { id: 'bob' }
    vm.commentCreateDraft = 'new identity draft'; vm.commentMessage = 'new identity message'
    vm.commentBusy = true; vm.commentFollowBusy = true
    wait.reject(Object.assign(new Error('lost old response'), { status: 'unknown', operationId: 'old-operation' }))
    await pending
    expect(vm.commentPendingOperation).toBe(''); expect(vm.commentPendingFollowOperation).toBe('')
    expect(vm.commentCreateDraft).toBe('new identity draft'); expect(vm.commentMessage).toBe('new identity message')
    expect(vm.commentBusy).toBe(true); expect(vm.commentFollowBusy).toBe(true)
    await session.dispose()
  })
  it('同provider A-B-A切换后的旧成功不能清掉新草稿或刷新新视图', async () => {
    const { vm, session, wait } = view()
    const pending = vm.createDocumentComment('old draft')
    session.user = { id: 'bob' }; session.user = { id: 'alice' }
    vm.commentCreateDraft = 'new Alice draft'
    wait.resolve(thread())
    expect(await pending).toBeNull()
    expect(vm.commentCreateDraft).toBe('new Alice draft'); expect(vm.loadComments).not.toHaveBeenCalled()
    await session.dispose()
  })
  it('身份切换同步清理已存在的旧unknown，不阻塞新身份', async () => {
    const { vm, session, port } = view()
    vm.commentPendingOperation = 'old-write'; vm._commentPendingProvider = port; vm.commentBusy = true
    vm.commentPendingFollowOperation = 'old-follow'; vm._commentPendingFollowProvider = port; vm.commentFollowBusy = true
    session.user = { id: 'bob' }
    expect(vm.commentPendingOperation).toBe(''); expect(vm._commentPendingProvider).toBeNull(); expect(vm.commentBusy).toBe(false)
    expect(vm.commentPendingFollowOperation).toBe(''); expect(vm._commentPendingFollowProvider).toBeNull(); expect(vm.commentFollowBusy).toBe(false)
    await session.dispose()
  })
  it.each(['write', 'follow'])('同身份刷新权限时%s的unknown仍保原键，权限恢复后不永久busy', async action => {
    const { vm, session, wait } = view(), permissions = held()
    const pending = action === 'write' ? vm.createDocumentComment('draft') : vm.changeCommentFollow('thread:1', 'follow')
    session.providers.authorization = { getCapabilities: () => permissions.promise }
    const refreshing = session.refreshCapabilities()
    expect(session.can('canView')).toBe(false)
    wait.reject(Object.assign(new Error('lost'), { status: 'unknown', operationId: 'original' })); await pending
    expect(vm.commentBusy).toBe(false); expect(vm.commentFollowBusy).toBe(false)
    expect(action === 'write' ? vm.commentPendingOperation : vm.commentPendingFollowOperation).toBe('original')
    permissions.resolve(FLAGS); await refreshing
    expect(session.can('canView')).toBe(true)
    expect(action === 'write' ? vm.commentPendingOperation : vm.commentPendingFollowOperation).toBe('original')
    await session.dispose()
  })
  it.each(['write', 'follow', 'query-write', 'query-follow'])('同主体凭据轮换不会永久锁住%s，迟到结果仍只保原键', async action => {
    const { vm, session, wait } = view()
    if (action === 'query-write') vm.commentPendingOperation = 'original'
    if (action === 'query-follow') vm.commentPendingFollowOperation = 'original'
    const pending = action === 'write' ? vm.createDocumentComment('draft') : action === 'follow' ? vm.changeCommentFollow('thread:1', 'follow')
      : action === 'query-write' ? vm.queryPendingComment() : vm.queryPendingCommentFollow()
    session._identityGeneration++
    session._clearPrivateIdentityView('authorization-required')
    wait.reject(Object.assign(new Error('credential rotated'), { code: 'IDENTITY_CONTEXT_CHANGED', status: 'unknown', operationId: 'original' }))
    await pending
    expect(vm.commentBusy).toBe(false); expect(vm.commentFollowBusy).toBe(false)
    expect(action === 'write' || action === 'query-write' ? vm.commentPendingOperation : vm.commentPendingFollowOperation).toBe('original')
    await session.dispose()
  })
  it.each(['write', 'follow'])('同身份切换provider不放开在途%s，unknown仍只查询原provider原键', async action => {
    const { vm, session, port, wait } = view(), next = { ...port, createThread: vi.fn(), follow: vi.fn() }
    const pending = action === 'write' ? vm.createDocumentComment('draft') : vm.changeCommentFollow('thread:1', 'follow')
    session.setProvider('comments', next)
    expect(action === 'write' ? vm.commentBusy : vm.commentFollowBusy).toBe(true)
    expect(await (action === 'write' ? vm.createDocumentComment('must not send') : vm.changeCommentFollow('thread:1', 'follow'))).toBeNull()
    expect(action === 'write' ? next.createThread : next.follow).not.toHaveBeenCalled()
    wait.reject(Object.assign(new Error('lost'), { status: 'unknown', operationId: 'original' })); await pending
    expect(action === 'write' ? vm.commentPendingOperation : vm.commentPendingFollowOperation).toBe('original')
    port.queryOperation.mockResolvedValue(thread()); port.queryFollowOperation.mockResolvedValue(preference())
    await (action === 'write' ? vm.queryPendingComment() : vm.queryPendingCommentFollow())
    expect(action === 'write' ? port.queryOperation : port.queryFollowOperation).toHaveBeenCalledWith('original')
    expect(action === 'write' ? vm.commentPendingOperation : vm.commentPendingFollowOperation).toBe('')
    await session.dispose()
  })
  it.each(['authorization-required', 'provider-replaced'])('真实HTTP端口%s清正文后，原键只GET查询，身份切换则失效', async reason => {
    const request = vi.fn().mockRejectedValueOnce(new Error('lost')).mockResolvedValue(response(200, { status: 'committed', operationId: 'op1', requestHash: HASH, committedRevision: '1', thread: thread() }))
    const port = provider(request)
    await expect(port.createThread({ operationId: 'op1', scope: 'document', content: 'private secret' })).rejects.toMatchObject({ status: 'unknown' })
    port.reset(reason); expect(port.getOperation('op1')).toBeNull()
    await expect(port.createThread({ operationId: 'op1', scope: 'document', content: 'private secret' })).rejects.toMatchObject({ code: 'COMMENT_CONTEXT_CHANGED' })
    await expect(port.queryOperation('op1')).resolves.toMatchObject({ id: 'thread:1' })
    expect(request.mock.calls.map(([, init]) => init.method)).toEqual(['POST', 'GET'])
    expect(port.getOperation('op1').body).toEqual({ expectedRevision: '0' })
    port.reset('identity-changed')
    await expect(Promise.resolve().then(() => port.queryOperation('op1'))).rejects.toMatchObject({ code: 'COMMENT_CONTEXT_CHANGED' })
    expect(request).toHaveBeenCalledTimes(2); port.dispose()
  })
  it('真实关注HTTP在授权刷新后按原主体和原CAS只GET确认', async () => {
    const request = vi.fn().mockResolvedValueOnce(response(200, preference())).mockRejectedValueOnce(new Error('lost'))
      .mockResolvedValue(followResult('follow1', preference({ following: true, preferenceRevision: '1' })))
    const port = provider(request)
    await expect(port.follow('thread:1', { operationId: 'follow1' })).rejects.toMatchObject({ status: 'unknown' })
    port.reset('authorization-required'); expect(port.getFollowOperation('follow1')).toBeNull()
    await expect(port.queryFollowOperation('follow1')).resolves.toMatchObject({ following: true })
    expect(request.mock.calls.map(([, init]) => init.method)).toEqual(['GET', 'POST', 'GET'])
    port.reset('identity-changed'); await expect(Promise.resolve().then(() => port.queryFollowOperation('follow1'))).rejects.toMatchObject({ code: 'COMMENT_CONTEXT_CHANGED' })
    expect(request).toHaveBeenCalledTimes(3); port.dispose()
  })
  it.each(['write', 'follow'])('原%s查询在GET途中失权保原键且不返回旧数据，恢复后可再查询', async action => {
    const { vm, session, port, wait } = view(), permissions = held()
    if (action === 'write') vm.commentPendingOperation = 'original'
    else vm.commentPendingFollowOperation = 'original'
    const pending = action === 'write' ? vm.queryPendingComment() : vm.queryPendingCommentFollow()
    session.providers.authorization = { getCapabilities: () => permissions.promise }
    const refreshing = session.refreshCapabilities()
    wait.resolve(action === 'write' ? thread() : preference())
    expect(await pending).toBeNull()
    expect(action === 'write' ? vm.commentPendingOperation : vm.commentPendingFollowOperation).toBe('original')
    expect(vm.commentMessage).not.toMatch(/已确认/)
    permissions.resolve(FLAGS); await refreshing
    port.queryOperation.mockResolvedValue(thread()); port.queryFollowOperation.mockResolvedValue(preference())
    expect(await (action === 'write' ? vm.queryPendingComment() : vm.queryPendingCommentFollow())).not.toBeNull()
    expect(action === 'write' ? vm.commentPendingOperation : vm.commentPendingFollowOperation).toBe('')
    await session.dispose()
  })
  it.each(['identity', 'dispose'])('更换过的旧HTTP provider也随Session %s清理恢复元数据', async boundary => {
    const request = vi.fn().mockRejectedValueOnce(new Error('lost')), old = provider(request)
    const session = createDocumentSession({ documentId: 'doc1', user: { id: 'alice' }, comments: old, capabilities: FLAGS })
    await expect(session.createCommentThread({ operationId: 'op1', scope: 'document', content: 'private secret' })).rejects.toMatchObject({ status: 'unknown' })
    session.setProvider('comments', provider(async () => response(200, [])))
    expect(old.getOperation('op1')).toBeNull()
    if (boundary === 'identity') session.user = { id: 'bob' }
    else await session.dispose()
    await expect(Promise.resolve().then(() => old.queryOperation('op1'))).rejects.toMatchObject({ code: 'COMMENT_CONTEXT_CHANGED' })
    expect(request).toHaveBeenCalledOnce(); await session.dispose(); old.dispose()
  })
  it('身份服务Session在准备GET中刷新权限，未POST的显式原键不冒充unknown', async () => {
    const read = held(), entered = held(), permissions = held()
    const request = vi.fn(() => { entered.resolve(); return read.promise }), port = provider(request)
    const follow = port.follow; port.follow = vi.fn(input => follow(input))
    const state = { status: 'authenticated', principalId: 'alice', canCreate: false, expiresInMs: 4000, generation: 1 }
    const identity = { getState: () => state, getCsrfToken: () => 'csrf', subscribe(listener) { listener(state); return () => {} },
      async login() {}, async queryLogin() {}, async refresh() {}, async logout() {}, dispose() {} }
    const authorization = { getCapabilities: vi.fn(async () => FLAGS) }
    const session = createDocumentSession({ documentId: 'doc1', identity, authorization, comments: port })
    await session._capabilitiesPromise
    const pending = session.followComment({ operationId: 'not-posted', threadId: 'thread:1' }).catch(error => error)
    await entered.promise
    authorization.getCapabilities.mockImplementation(() => permissions.promise)
    const refreshing = session.refreshCapabilities()
    read.resolve(response(200, preference()))
    const providerError = await port.follow.mock.results[0].value.catch(error => error)
    expect(providerError).toMatchObject({ submitted: false })
    expect(await pending).toMatchObject({ status: 'rejected', submitted: false })
    expect(request.mock.calls.map(([, init]) => init.method)).toEqual(['GET'])
    permissions.resolve(FLAGS); await refreshing; await session.dispose()
  })
  it.each([null, undefined, 'failed', Object.freeze(Object.assign(new Error('denied'), { status: 403 }))])('准备GET拒绝%j也会结束，保留HTTP拒绝状态', async rejection => {
    const request = vi.fn().mockRejectedValue(rejection), port = provider(request)
    const error = await port.follow('thread:1', { operationId: 'not-posted' }).catch(value => value)
    expect(error).toBeInstanceOf(Error); expect(error.submitted).toBe(false)
    if (rejection && rejection.status) expect(error.status).toBe(rejection.status)
    expect(request.mock.calls.map(([, init]) => init.method)).toEqual(['GET']); port.dispose()
  }, 1000)
  it.each([null, undefined, Object.freeze(new Error('lost')), Object.assign(new Error('untrusted hint'), { submitted: false })])('POST拒绝%j仍保评论和关注原键unknown，确认只GET不二次POST', async rejection => {
    const commentRequest = vi.fn().mockRejectedValueOnce(rejection).mockResolvedValue(committed('op1'))
    const comment = provider(commentRequest)
    await expect(comment.createThread({ operationId: 'op1', scope: 'document', content: 'draft' })).rejects.toMatchObject({ status: 'unknown', operationId: 'op1', submitted: true })
    await expect(comment.queryOperation('op1')).resolves.toMatchObject({ id: 'thread:1' })
    expect(commentRequest.mock.calls.map(([, init]) => init.method)).toEqual(['POST', 'GET'])
    const followRequest = vi.fn().mockResolvedValueOnce(response(200, preference())).mockRejectedValueOnce(rejection)
      .mockResolvedValue(followResult('follow1', preference({ following: true, preferenceRevision: '1' })))
    const follow = provider(followRequest)
    await expect(follow.follow('thread:1', { operationId: 'follow1' })).rejects.toMatchObject({ status: 'unknown', operationId: 'follow1', submitted: true })
    await expect(follow.queryFollowOperation('follow1')).resolves.toMatchObject({ following: true })
    expect(followRequest.mock.calls.map(([, init]) => init.method)).toEqual(['GET', 'POST', 'GET'])
    comment.dispose(); follow.dispose()
  }, 1000)
  it('同身份列表刷新后，关注提交回读最新偏好而非丢弃已保存状态', async () => {
    const { vm, session, wait } = view()
    vm.loadCommentFollowPreference = vi.fn(async () => preference({ muted: true, following: true, preferenceRevision: '2' }))
    const pending = vm.changeCommentFollow('thread:1', 'follow')
    vm.commentLoadGeneration++
    wait.resolve(preference({ following: true, preferenceRevision: '1' })); await pending
    expect(vm.loadCommentFollowPreference).toHaveBeenCalledWith('thread:1')
    expect(vm.commentFollowBusy).toBe(false); await session.dispose()
  })
  // Source contract simulation of the compiled pre-ui stub: every cold key returns false.
  // This does not replace the main agent's generated-stub / artifact verification.
  function withoutColdCommentUi(vm) {
    for (const name of Object.keys(createCommentInteraction({}).methods)) vm[name] = vi.fn(() => false)
  }
  it.each(['', 'thread:1'])('无冷UI时权限恢复继续原link/reconcile，More ID=%j仅按需GET偏好', async moreId => {
    const { vm, session, port } = view(), likes = held()
    withoutColdCommentUi(vm)
    vm.commentMoreThreadId = moreId
    vm.commentPendingFollowOperation = 'original-follow-key'
    const getPreference = vi.spyOn(port, 'getFollowPreference')
    const openLink = vi.spyOn(vm, 'openCommentLink'), recover = vi.spyOn(vm, 'recoverCommentAfterAuthorization')
    vm.loadComments.mockImplementation(async () => { vm.commentThreads = [thread()]; return vm.commentThreads })
    vm.loadDocumentCommentLikes = vi.fn(() => likes.promise)
    try {
      session.emit('capabilities', FLAGS)
      await vi.waitFor(() => expect(recover).toHaveBeenCalledOnce())
      expect(getPreference).toHaveBeenCalledTimes(moreId ? 1 : 0)
      if (moreId) expect(getPreference).toHaveBeenCalledWith('thread:1')
      expect(vm.loadDocumentCommentLikes).toHaveBeenCalledOnce()
      expect(openLink).toHaveBeenCalledOnce()
      expect(vm.commentPendingFollowOperation).toBe('original-follow-key')
      expect(port.queryFollowOperation).not.toHaveBeenCalled()
    } finally { likes.resolve(null); await session.dispose() }
  })
  it('无冷UI时原偏好GET同步启动并返回Promise，actor退休后不发布迟到偏好', async () => {
    const { vm, session, port } = view(), reading = held()
    withoutColdCommentUi(vm)
    port.getFollowPreference = vi.fn(() => reading.promise)
    try {
      const result = vm.loadCommentFollowPreference('thread:1')
      expect(result).toBeInstanceOf(Promise)
      expect(port.getFollowPreference).toHaveBeenCalledExactlyOnceWith('thread:1')
      expect(vm.commentFollowPreferences['thread:1']).toBeNull()
      session.user = { id: 'bob' }
      reading.resolve(preference())
      expect(await result).toBeNull()
      expect(vm.commentFollowPreferences).toEqual({})
    } finally { reading.resolve(preference()); await session.dispose() }
  })
  it('无冷UI时权限恢复列表迟到不会为退休actor启动后续读取', async () => {
    const { vm, session, port } = view(), listing = held()
    withoutColdCommentUi(vm)
    vm.commentMoreThreadId = 'thread:1'
    vm.loadComments.mockImplementation(() => listing.promise)
    vm.loadDocumentCommentLikes = vi.fn(async () => null)
    const getPreference = vi.spyOn(port, 'getFollowPreference'), openLink = vi.spyOn(vm, 'openCommentLink')
    try {
      session.emit('capabilities', FLAGS)
      session.user = { id: 'bob' }
      listing.resolve(vm.commentThreads = [thread()])
      await Promise.resolve(); await Promise.resolve()
      expect(getPreference).not.toHaveBeenCalled()
      expect(vm.loadDocumentCommentLikes).not.toHaveBeenCalled()
      expect(openLink).not.toHaveBeenCalled()
    } finally { listing.resolve([]); await session.dispose() }
  })
  it('权限恢复后保持打开的更多菜单重新获取偏好', async () => {
    const { vm, session } = view()
    vm.commentThreads = [thread()]; vm.commentMoreThreadId = 'thread:1'
    const likes = held()
    vm.loadDocumentCommentLikes = vi.fn(() => likes.promise)
    vm.openCommentLink = vi.fn(async () => null); vm.loadCommentFollowPreference = vi.fn(async () => preference())
    vm.loadComments.mockImplementation(async () => { vm.commentThreads = [thread()]; return vm.commentThreads })
    session.emit('capabilities', FLAGS)
    // 点赞读独立于线程偏好；点赞服务迟迟不返回也不能阻塞已打开菜单。
    await vi.waitFor(() => expect(vm.loadCommentFollowPreference).toHaveBeenCalledWith('thread:1'))
    expect(vm.loadDocumentCommentLikes).toHaveBeenCalledOnce()
    likes.resolve(null); await session.dispose()
  })
  it('权限恢复列表迟到时，不为已退役身份启动菜单偏好或点赞读取', async () => {
    const { vm, session } = view(), listing = held()
    vm.commentMoreThreadId = 'thread:1'
    vm.loadComments.mockImplementation(() => listing.promise)
    vm.loadDocumentCommentLikes = vi.fn(async () => null)
    vm.loadCommentFollowPreference = vi.fn(async () => preference())
    session.emit('capabilities', FLAGS)
    session.user = { id: 'bob' }
    vm.commentThreads = [thread()]
    listing.resolve(vm.commentThreads)
    await Promise.resolve(); await Promise.resolve()
    expect(vm.loadDocumentCommentLikes).not.toHaveBeenCalled()
    expect(vm.loadCommentFollowPreference).not.toHaveBeenCalled()
    await session.dispose()
  })
  it.each(['write', 'query'])('%s成功后，先发后到的偏好GET不能回退已确认状态', async action => {
    const { vm, session, port, wait } = view(), read = held()
    port.getFollowPreference = () => read.promise
    if (action === 'query') vm.commentPendingFollowOperation = 'original'
    const posting = action === 'write' ? vm.changeCommentFollow('thread:1', 'follow') : vm.queryPendingCommentFollow()
    const reading = vm.loadCommentFollowPreference('thread:1')
    wait.resolve(preference({ following: true, muted: true, preferenceRevision: '2' })); await posting
    read.resolve(preference({ following: false, muted: false, preferenceRevision: '0' })); await reading
    expect(vm.commentFollowPreference('thread:1')).toMatchObject({ following: true, muted: true, preferenceRevision: '2' })
    await session.dispose()
  })
  it('滚动把更多按钮带入可视区时，不会立即关闭刚打开的固定回复菜单', () => {
    vi.stubGlobal('window', { innerWidth: 768, innerHeight: 600 })
    try {
      const anchor = { isConnected: true, getBoundingClientRect: () => ({ left: 500, right: 514, top: 300, bottom: 314 }) }
      const vm = ctx({ commentRemote: true, commentMenuThreadId: 'thread:1', commentMenuCommentId: 'reply:1',
        _commentReplyMenuAnchor: anchor, commentPanels: [], updateCommentLayerBounds: vi.fn() })
      vm.onCommentViewportChange({ type: 'scroll', target: {} })
      expect(vm.commentMenuThreadId).toBe('thread:1'); expect(vm.commentMenuCommentId).toBe('reply:1')
      expect(vm.commentReplyMenuPosition.top).toBeGreaterThan(125)
      anchor.isConnected = false; vm.onCommentViewportChange({ type: 'scroll', target: {} })
      expect(vm.commentMenuThreadId).toBe('')
    } finally { vi.unstubAllGlobals() }
  })
  it('软键盘引起的视口抖动不关闭刚打开的表情选择器，只把固定位置收敛回可视区', () => {
    vi.stubGlobal('window', { innerWidth: 393, innerHeight: 480 })
    try {
      const picker = { getBoundingClientRect: () => ({ left: 22, top: 300, width: 328, height: 340 }), style: { removeProperty: vi.fn() } }
      const vm = ctx({ commentReactionContext: { threadId: 'thread:1', replyId: 'reply:1', position: { left: 22, top: 300 } },
        _commentReactionAnchor: { isConnected: true }, $el: { querySelector: () => picker },
        refreshPanels: vi.fn(), updateCommentLayerBounds: vi.fn() })
      vm.onCommentViewportChange({ type: 'resize', target: window })
      expect(vm.commentReactionContext).not.toBeNull()
      expect(vm.refreshPanels).toHaveBeenCalledOnce()
      expect(vm.commentReactionContext.position).toEqual({ left: 22, top: 132 })
      // 已经收敛回可视区后不再重复刷新，避免 resize 抖动期间反复点名渲染。
      vm.refreshPanels.mockClear()
      vm.onCommentViewportChange({ type: 'resize', target: window })
      expect(vm.refreshPanels).not.toHaveBeenCalled()
      // 真正的滚动仍按原语义关闭选择器。
      vm.onCommentViewportChange({ type: 'scroll', target: {} })
      expect(vm.commentReactionContext).toBeNull()
    } finally { vi.unstubAllGlobals() }
  })
})
const target = (extra = {}) => ({ tenantId: 'tenant1', docId: 'doc1', threadId: 'thread:1', scope: 'document', blockId: null,
  anchor: null, anchorStatus: 'document', ...extra })

describe('US5关注与受控链接端口（E1，未执行真实账号/PG验收）', () => {
  it('只读reader按当前偏好CAS真实关注，不借comment.write、不发授权命令', async () => {
    const request = vi.fn().mockResolvedValueOnce(response(200, preference())).mockResolvedValueOnce(followResult('follow1', preference({ following: true, preferenceRevision: '1' })))
    const port = provider(request, { getCapabilities: () => ({ canView: true, canComment: false, canEdit: false }) })
    const session = createDocumentSession({ documentId: 'doc1', comments: port, capabilities: { canView: true, canComment: false, canEdit: false } })
    const result = await session.followComment({ threadId: 'thread:1', operationId: 'follow1' })
    expect(result.following).toBe(true)
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      '/editor/v1/tenants/tenant1/documents/doc1/comment-threads/thread%3A1/follow-preference',
      '/editor/v1/tenants/tenant1/documents/doc1/comment-threads/thread%3A1/follow-preference',
    ])
    expect(request.mock.calls[1][1]).toMatchObject({ method: 'POST', credentials: 'include', headers: { 'Idempotency-Key': 'follow1', 'X-CSRF-Token': 'csrf' } })
    expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({ operationId: 'follow1', expectedRevision: '0', kind: 'follow', value: true })
    expect(session.can('canView')).toBe(true)
    await session.dispose()
  })

  it('取消关注/静音只有各自偏好命令，不撤销独立read或增加private参与者', async () => {
    const request = vi.fn().mockResolvedValueOnce(response(200, preference({ following: true, preferenceRevision: '4' })))
      .mockResolvedValueOnce(followResult('unfollow', preference({ preferenceRevision: '5' }), '5'))
      .mockResolvedValueOnce(response(200, preference({ preferenceRevision: '5' })))
      .mockResolvedValueOnce(followResult('mute', preference({ muted: true, preferenceRevision: '6' }), '6'))
    const port = provider(request)
    await port.unfollow('thread:1', { operationId: 'unfollow' })
    await port.setMuted('thread:1', true, { operationId: 'mute' })
    expect(request.mock.calls.filter(([, init]) => init.method === 'POST').map(([, init]) => JSON.parse(init.body))).toEqual([
      { operationId: 'unfollow', expectedRevision: '4', kind: 'follow', value: false },
      { operationId: 'mute', expectedRevision: '5', kind: 'mute', value: true },
    ])
    expect(request.mock.calls.every(([url]) => !/grant|participants/.test(url))).toBe(true)
  })

  it('关注未知仅查原键，允许更高当前revision；同id改value/kind/CAS/thread不得发请求', async () => {
    const request = vi.fn().mockResolvedValueOnce(response(200, preference())).mockRejectedValueOnce(new Error('lost'))
      .mockResolvedValueOnce(followResult('follow1', preference({ following: true, preferenceRevision: '9' })))
    const port = provider(request)
    await expect(port.follow('thread:1', { operationId: 'follow1' })).rejects.toMatchObject({ operationId: 'follow1', status: 'unknown' })
    expect(port.getFollowOperation('follow1')).toMatchObject({ status: 'unknown', body: { expectedRevision: '0' } })
    await expect(port.unfollow('thread:1', { operationId: 'follow1' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_MISMATCH' })
    await expect(port.setMuted('thread:1', true, { operationId: 'follow1' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_MISMATCH' })
    await expect(port.follow('thread:1', { operationId: 'follow1', expectedRevision: '7' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_MISMATCH' })
    await expect(port.follow('another', { operationId: 'follow1' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_MISMATCH' })
    expect(request).toHaveBeenCalledTimes(2)
    await expect(port.queryFollowOperation('follow1')).resolves.toMatchObject({ preferenceRevision: '9' })
    expect(request.mock.calls[2][0]).toBe('/editor/v1/tenants/tenant1/operations/follow1?commandType=follow')
    expect(request.mock.calls[2][1].method).toBe('GET')
  })

  it.each([
    { status: 'committed', operationId: 'other', requestHash: HASH, committedRevision: '1', preference: preference({ preferenceRevision: '1' }) },
    { status: 'committed', operationId: 'follow1', requestHash: HASH, committedRevision: '1', preference: preference({ principalId: 'bob', preferenceRevision: '1' }) },
    { status: 'committed', operationId: 'follow1', requestHash: HASH, committedRevision: '2', preference: preference({ preferenceRevision: '2' }) },
  ])('异原键/主体/CAS水位不是已保存 %j', async data => {
    const request = vi.fn().mockResolvedValueOnce(response(200, preference())).mockResolvedValueOnce(response(200, data))
    const port = provider(request)
    await expect(port.follow('thread:1', { operationId: 'follow1' })).rejects.toMatchObject({ status: 'unknown' })
  })

  it('稳定链接只含定位身份，复制先复权，打开不复用缓存并再次复权', async () => {
    const request = vi.fn(async url => url.endsWith('/link-target') ? response(200, target()) : response(200, thread()))
    const port = provider(request, { documentUrl: 'https://app.example/documents/doc1' })
    const link = await port.getLink('thread:1')
    const url = new URL(link)
    expect(url.search).toBe('')
    expect(Array.from(new URLSearchParams(url.hash.slice(1)).entries())).toEqual([
      ['larkComment', '1'], ['tenantId', 'tenant1'], ['docId', 'doc1'], ['threadId', 'thread:1'],
    ])
    expect(link).not.toMatch(/ticket|token|csrf|private.text|quote|cookie/i)
    expect(request.mock.calls[0][0]).toMatch(/\/link-target$/)
    await port.openLink(link)
    expect(request.mock.calls.slice(1).map(([path]) => path)).toEqual([
      '/editor/v1/tenants/tenant1/documents/doc1/comment-threads/thread%3A1',
      '/editor/v1/tenants/tenant1/documents/doc1/comment-threads/thread%3A1/link-target',
    ])
    request.mockImplementation(async () => response(404, { code: 'COMMENT_NOT_FOUND' }))
    await expect(port.openLink(link)).rejects.toMatchObject({ code: 'COMMENT_NOT_VISIBLE', status: 404 })
  })

  it('异租户/文档/凭据参数与未配置路由不能变成假成功链接', async () => {
    const request = vi.fn()
    const port = provider(request, { documentUrl: 'https://app.example/documents/doc1' })
    await expect(port.openLink('https://app.example/documents/doc1#larkComment=1&tenantId=other&docId=doc1&threadId=t1')).rejects.toMatchObject({ code: 'COMMENT_LINK_SCOPE_MISMATCH' })
    await expect(port.openLink('https://app.example/documents/doc1#larkComment=1&tenantId=tenant1&docId=doc1&threadId=t1&ticket=secret')).rejects.toMatchObject({ code: 'COMMENT_LINK_SCOPE_MISMATCH' })
    for (const documentUrl of ['https://app.example/view?docId=doc1', 'https://user:secret@app.example/doc1', 'javascript:alert(1)', 'https://app.example/#/doc/doc1']) {
      await expect(provider(request, { documentUrl }).getLink('thread:1')).rejects.toMatchObject({ code: 'COMMENT_DOCUMENT_URL_REQUIRED' })
    }
    expect(request).not.toHaveBeenCalled()
  })

  it('orphaned链接只点亮侧栏、不按重用block跳转；readonly可操作follow菜单', async () => {
    const remote = { isRemote: true, openLink: async () => ({ target: target({ anchorStatus: 'orphaned' }), thread: thread() }) }
    const context = ctx({ session: { can: capability => capability === 'canView', getProvider: () => remote },
      commentThreads: [{ id: 'thread:1', blockId: 'reused', anchorStatus: 'orphaned', bound: false }],
      loadComments: async () => {}, activateComment: vi.fn(), scrollCommentIntoView: vi.fn() })
    await context.openCommentLink('https://app.example/doc1#larkComment=1')
    expect(context.activateComment).toHaveBeenCalledWith('thread:1')
    expect(context.scrollCommentIntoView).not.toHaveBeenCalled()
    expect(context.commentMessage).toMatch(/原引用已删除/)
    context.commentFollowPreferences['thread:1'] = preference()
    expect(context.commentFollowAllowed('thread:1')).toBe(true)
    expect(context.commentAllowed('reply', 'thread:1')).toBe(false)
  })
})

const blockedTranslation = (extra = {}) => ({ status: 'blocked', code: 'DEPENDENCY_BLOCKED', dependency: 'internal-translation',
  batchBlocked: true, operationId: 'translation1', threadId: 'thread:1', replyId: 'reply:1', sourceRevision: '1',
  targetLanguage: 'zh-CN', persisted: false, taskId: null, ...extra })

describe('US6真实依赖阻塞的HTTP/UI契约（E1，不是翻译供给验收）', () => {
  it('reader发真实请求，503 blocked保持阻塞事实，不造任务/译文/成功回执', async () => {
    const request = vi.fn(async url => url.endsWith('/translations') ? response(503, blockedTranslation()) : response(200, thread()))
    const port = provider(request, { getCapabilities: () => ({ canView: true, canComment: false, canEdit: false }) })
    const session = createDocumentSession({ documentId: 'doc1', comments: port, capabilities: { canView: true, canComment: false, canEdit: false } })
    const result = await session.requestCommentTranslation({ operationId: 'translation1', threadId: 'thread:1', replyId: 'reply:1', sourceRevision: '1', targetLanguage: 'zh-CN', actor: 'forged' })
    expect(result).toEqual(blockedTranslation())
    expect(result).not.toHaveProperty('translatedText')
    expect(request).toHaveBeenCalledTimes(2)
    const [url, init] = request.mock.calls[1]
    expect(url).toBe('/editor/v1/tenants/tenant1/documents/doc1/comment-threads/thread%3A1/replies/reply%3A1/translations')
    expect(init).toMatchObject({ method: 'POST', credentials: 'include', cache: 'no-store', headers: { 'X-CSRF-Token': 'csrf' } })
    expect(JSON.parse(init.body)).toEqual({ operationId: 'translation1', sourceRevision: '1', targetLanguage: 'zh-CN' })
    expect(port.getTranslationOperation('translation1')).toMatchObject({ status: 'blocked', body: { sourceRevision: '1' } })
    await session.dispose()
  })

  it('未知仅GET原scope/rev/lang，GET blocked不是持久任务或原POST入队证明', async () => {
    const request = vi.fn().mockResolvedValueOnce(response(200, thread())).mockRejectedValueOnce(new Error('lost'))
      .mockResolvedValueOnce(response(200, thread())).mockResolvedValueOnce(response(503, blockedTranslation()))
    const port = provider(request)
    const input = { operationId: 'translation1', threadId: 'thread:1', replyId: 'reply:1', sourceRevision: '1', targetLanguage: 'zh-CN' }
    await expect(port.requestTranslation(input)).rejects.toMatchObject({ status: 'unknown', operationId: 'translation1' })
    expect(port.getTranslationOperation('translation1').status).toBe('unknown')
    await expect(port.requestTranslation({ ...input, sourceRevision: '2' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_MISMATCH' })
    // 查询参数冲突在发起异步HTTP前同步拒绝，原来源/语言不可变。
    expect(() => port.queryTranslation({ operationId: 'translation1', targetLanguage: 'en' })).toThrowError('IDEMPOTENCY_MISMATCH')
    expect(() => port.queryTranslation({ operationId: 'translation1', replyId: 'other' })).toThrowError('IDEMPOTENCY_MISMATCH')
    expect(() => port.queryTranslation({ operationId: 'translation1', sourceRevision: '2' })).toThrowError('IDEMPOTENCY_MISMATCH')
    expect(port.getTranslationOperation('translation1').body).toEqual({ operationId: 'translation1', sourceRevision: '1', targetLanguage: 'zh-CN' })
    expect(request).toHaveBeenCalledTimes(2)
    const result = await port.queryTranslation('translation1')
    expect(result).toMatchObject({ status: 'blocked', persisted: false, taskId: null, batchBlocked: true })
    const [url, init] = request.mock.calls[3]
    expect(init.method).toBe('GET')
    expect(new URL(`https://local.invalid${url}`).searchParams.get('operationId')).toBe('translation1')
    expect(new URL(`https://local.invalid${url}`).searchParams.get('sourceRevision')).toBe('1')
    expect(new URL(`https://local.invalid${url}`).searchParams.get('targetLanguage')).toBe('zh-CN')
    expect(request.mock.calls.filter(([, item]) => item.method === 'POST')).toHaveLength(1)
  })

  it.each([
    response(200, { status: 'completed', translatedText: 'fabricated', taskId: 'fake' }),
    response(202, { status: 'queued', taskId: 'fake' }),
    response(503, blockedTranslation({ persisted: true })),
    response(503, blockedTranslation({ taskId: 'fake' })),
    response(503, blockedTranslation({ sourceRevision: 'other' })),
    response(503, blockedTranslation({ batchBlocked: false })),
  ])('意外成功/入队/畸形blocked不能投影成翻译成功 %j', async incoming => {
    const request = vi.fn().mockResolvedValueOnce(response(200, thread())).mockResolvedValueOnce(incoming)
    const port = provider(request)
    await expect(port.requestTranslation({ operationId: 'translation1', threadId: 'thread:1', replyId: 'reply:1', targetLanguage: 'zh-CN' })).rejects.toMatchObject({ status: 'unknown' })
    expect(JSON.stringify(port.getTranslationOperation('translation1'))).not.toMatch(/fabricated|fake|translatedText/)
  })

  it('源修订不自动升级，删除/失权当前不可见；未发翻译POST', async () => {
    const changed = thread(); changed.replies[0].replyRevision = '2'
    const request = vi.fn(async () => response(200, changed))
    const port = provider(request)
    await expect(port.requestTranslation({ operationId: 'translation1', threadId: 'thread:1', replyId: 'reply:1', sourceRevision: '1', targetLanguage: 'en' })).rejects.toMatchObject({ code: 'TRANSLATION_SOURCE_STALE', status: 'rejected' })
    expect(port.getTranslationOperation('translation1').body.sourceRevision).toBe('1')
    expect(request.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true)
    const deleted = thread(); Object.assign(deleted.replies[0], { tombstone: true, content: '', deletedAt: AT })
    await expect(provider(async () => response(200, deleted)).requestTranslation({ operationId: 'deleted', threadId: 'thread:1', replyId: 'reply:1', targetLanguage: 'en' })).rejects.toMatchObject({ code: 'COMMENT_NOT_VISIBLE' })
    await expect(provider(async () => response(404, { code: 'COMMENT_NOT_FOUND' })).requestTranslation({ operationId: 'hidden', threadId: 'thread:1', replyId: 'reply:1', targetLanguage: 'en' })).rejects.toMatchObject({ code: 'COMMENT_NOT_VISIBLE' })
  })

  it('语言只校验语法，不声称已有服务supported名单', async () => {
    const request = vi.fn()
    const port = provider(request)
    for (const targetLanguage of ['', ' zh-CN', 'en<script>', 'a', 'en--US', 'en-123456789']) {
      await expect(port.requestTranslation({ operationId: `bad-${targetLanguage}`, threadId: 'thread:1', replyId: 'reply:1', targetLanguage })).rejects.toBeDefined()
    }
    expect(request).not.toHaveBeenCalled()
    expect(port.supportedLanguages).toBeUndefined()
  })

  it('readonly菜单可检查依赖；仅呈现阻塞元数据，不覆盖评论原文', async () => {
    const remote = { isRemote: true, requestTranslation: vi.fn(async () => blockedTranslation()) }
    const original = thread()
    const context = ctx({ session: { can: capability => capability === 'canView', getProvider: () => remote },
      commentRemote: true, commentThreads: [original], loadComments: async () => {} })
    context.beginCommentTranslation('thread:1', 'reply:1')
    await context.submitCommentTranslation()
    expect(remote.requestTranslation).toHaveBeenCalledOnce()
    expect(context.commentTranslationState).toMatchObject({ status: 'blocked', persisted: false, batchBlocked: true, taskId: null })
    expect(context.commentMessage).toMatch(/整批验收仍受阻/)
    expect(original.replies[0].content).toBe('private text')
    original.replies[0].replyRevision = '2'
    expect(context.commentTranslationIsCurrent(context.commentTranslationState)).toBe(false)
  })

  it('失权响应先清旧私密视图，再只读刷新，不把旧blocked投影为当前', async () => {
    const remote = { isRemote: true, list: vi.fn(async () => []) }
    const context = ctx({ editor: null, session: { can: () => true, getProvider: () => remote }, commentThreads: [thread()],
      commentSourceThreads: [thread()], commentTranslationState: blockedTranslation(), commentTranslationContext: { threadId: 'thread:1' } })
    await context.clearUnavailableCommentView(Object.assign(new Error('not visible'), { code: 'COMMENT_NOT_VISIBLE', httpStatus: 404 }))
    expect(context.commentThreads).toEqual([])
    expect(context.commentSourceThreads).toEqual([])
    expect(context.commentTranslationState).toBeNull()
    expect(context.commentTranslationContext).toBeNull()
    expect(remote.list).toHaveBeenCalledOnce()
  })
})

const preparingCases = [
  { name: '评论', input: { operationId: 'preparing', threadId: 'thread:1', content: 'original' },
    invoke: (port, input) => port.reply(input), inspect: port => port.getOperation('preparing'),
    read: () => response(200, thread()), result: () => committed('preparing', thread({ threadRevision: '2' }), '2'),
    revision: 'expectedRevision', captured: '1', changed: { content: 'changed' }, mutable: 'content' },
  { name: '关注', input: { operationId: 'preparing', threadId: 'thread:1' },
    invoke: (port, input) => port.follow(input), inspect: port => port.getFollowOperation('preparing'),
    read: () => response(200, preference()), result: () => followResult('preparing', preference({ following: true, preferenceRevision: '1' })),
    revision: 'expectedRevision', captured: '0', changed: { threadId: 'other' }, mutable: 'threadId' },
  { name: '翻译', input: { operationId: 'preparing', threadId: 'thread:1', replyId: 'reply:1', targetLanguage: 'en' },
    invoke: (port, input) => port.requestTranslation(input), inspect: port => port.getTranslationOperation('preparing'),
    read: () => response(200, thread()), result: () => response(503, blockedTranslation({ operationId: 'preparing', targetLanguage: 'en' })),
    revision: 'sourceRevision', captured: '1', changed: { targetLanguage: 'fr' }, mutable: 'targetLanguage' },
]

describe('首次读取期间固定原操作意图（E1注入HTTP，不是翻译供给验收）', () => {
  for (const sample of preparingCases) {
    it(`${sample.name}首次读取同id共享准备和POST，异意图409且显式captured revision不误冲突`, async () => {
      let release
      const held = new Promise(resolve => { release = resolve })
      const request = vi.fn(async (url, init) => init.method === 'POST' || url.includes('/operations/') || url.includes('/translations?') ? sample.result() : held)
      const port = provider(request)
      const first = sample.invoke(port, { ...sample.input })
      const same = sample.invoke(port, { ...sample.input, [sample.revision]: sample.captured })
      const changed = sample.invoke(port, { ...sample.input, ...sample.changed }).catch(error => error)
      const wrongRevision = sample.invoke(port, { ...sample.input, [sample.revision]: '99' }).catch(error => error)
      expect(sample.inspect(port)).toBeNull()
      release(sample.read())
      const [a, b, mismatch, stale] = await Promise.all([first, same, changed, wrongRevision])
      expect(b).toEqual(a)
      expect(mismatch).toMatchObject({ code: 'IDEMPOTENCY_MISMATCH', status: 409, operationId: 'preparing' })
      expect(stale).toMatchObject({ code: 'IDEMPOTENCY_MISMATCH', status: 409, operationId: 'preparing' })
      expect(request.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1)
      expect(request.mock.calls.filter(([url, init]) => init.method === 'GET' && !url.includes('/operations/') && !url.includes('/translations?'))).toHaveLength(1)
      const record = sample.inspect(port)
      expect(record.body[sample.revision]).toBe(sample.captured)
      for (const key of ['intent', 'ready', 'result', 'promise']) expect(record).not.toHaveProperty(key)
      await sample.invoke(port, { ...sample.input })
      expect(request.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1)
    })

    it(`${sample.name}首次读取期间调用方修改输入不能改变原POST`, async () => {
      let release
      const held = new Promise(resolve => { release = resolve })
      const request = vi.fn(async (url, init) => init.method === 'POST' ? sample.result() : held)
      const port = provider(request), input = { ...sample.input }
      const first = sample.invoke(port, input)
      input[sample.mutable] = 'mutated'
      release(sample.read())
      await first
      const [url, init] = request.mock.calls.find(([, init]) => init.method === 'POST')
      if (sample.mutable === 'threadId') expect(url).toContain('/thread%3A1/')
      else expect(JSON.parse(init.body)[sample.mutable]).toBe(sample.input[sample.mutable])
    })

    it(`${sample.name}首次读取失败共享原错误，不POST或隐藏失败`, async () => {
      let release
      const held = new Promise(resolve => { release = resolve })
      const request = vi.fn(async () => held), port = provider(request)
      const results = [sample.invoke(port, { ...sample.input }), sample.invoke(port, { ...sample.input })].map(value => value.catch(error => error))
      release(response(404, { code: 'COMMENT_NOT_FOUND' }))
      for (const error of await Promise.all(results)) expect(error).toMatchObject({ code: 'COMMENT_NOT_VISIBLE' })
      expect(request).toHaveBeenCalledTimes(1)
      expect(sample.inspect(port)).toBeNull()
    })

    it(`${sample.name}首次POST丢响应共享unknown，后续仅查询原键`, async () => {
      let release
      const held = new Promise(resolve => { release = resolve })
      const request = vi.fn(async (url, init) => {
        if (init.method === 'POST') throw new Error('lost original confirmation')
        return url.includes('/operations/') || url.includes('/translations?') ? sample.result() : held
      })
      const port = provider(request)
      const results = [sample.invoke(port, { ...sample.input }), sample.invoke(port, { ...sample.input })].map(value => value.catch(error => error))
      release(sample.read())
      for (const error of await Promise.all(results)) expect(error).toMatchObject({ status: 'unknown', operationId: 'preparing' })
      expect(request.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1)
      expect(sample.inspect(port).status).toBe('unknown')
      await sample.invoke(port, { ...sample.input })
      expect(request.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1)
    })

    it(`${sample.name}首次读取后失权不能沿准备前资格POST`, async () => {
      let release
      const held = new Promise(resolve => { release = resolve })
      let flags = FLAGS
      const request = vi.fn(async () => held), port = provider(request, { getCapabilities: () => flags })
      const first = sample.invoke(port, { ...sample.input }).catch(error => error)
      flags = { canView: false, canComment: false, canResolveComment: false }
      release(sample.read())
      expect(await first).toMatchObject({ code: sample.name === '评论' ? 'COMMENT_FORBIDDEN' : 'COMMENT_NOT_VISIBLE' })
      expect(request.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(0)
    })
  }
})


// 当前仅有blocked/unknown契约；这些E1晚回用例不表示内部翻译成功或T083浏览器验收。
describe('[T079/T080/T082/T083] 翻译晚回保持当前来源、身份和弹窗边界', () => {
  const changes = [
    ['source revision', context => { context.commentThreads[0].replies[0].replyRevision = '2' }],
    ['permission revoked', (context, live) => { live.visible = false }],
    ['dialog closed', context => context.closeCommentTranslation()],
    ['language changed', context => context.setCommentTranslationLanguage('en')],
    ['provider replaced', (context, live) => { live.provider = { isRemote: true } }],
    ['identity switched', context => { context.session.user = { id: 'bob' } }],
    ['disposed', context => { context.commentDisposed = true; context.commentLoadGeneration++ }],
    ['new list generation', context => { context.commentLoadGeneration++ }],
  ]
  const keepsOriginalKey = name => !['provider replaced', 'identity switched', 'disposed'].includes(name)
  function translationContext(remote) {
    const live = { provider: remote, visible: true }
    const context = ctx({ editor: null, commentRemote: true, commentThreads: [thread()], commentSourceThreads: [thread()],
      session: { user: { id: 'alice' }, can: () => live.visible, getProvider: () => live.provider },
      loadComments: vi.fn(async function () { this.commentLoadGeneration++ }), refreshCommentDecorations: vi.fn() })
    context.beginCommentTranslation('thread:1', 'reply:1')
    return { context, live }
  }
  for (const method of ['submitCommentTranslation', 'queryPendingCommentTranslation']) {
    for (const phase of ['provider', 'list']) {
      it.each(changes)(`${method} blocked在${phase}等待中发生%s，不复活旧视图或确认原pending`, async (name, change) => {
        let release, entered
        const held = new Promise(resolve => { release = resolve })
        const waiting = new Promise(resolve => { entered = resolve })
        const remote = { isRemote: true, requestTranslation: vi.fn(async () => blockedTranslation()), queryTranslation: vi.fn(async () => blockedTranslation()) }
        const { context, live } = translationContext(remote)
        if (method === 'queryPendingCommentTranslation') {
          context.commentPendingTranslationOperation = 'translation1'; context._commentPendingTranslationProvider = remote
        }
        if (phase === 'provider') remote[method === 'submitCommentTranslation' ? 'requestTranslation' : 'queryTranslation'] = vi.fn(() => { entered(); return held })
        else context.loadComments = vi.fn(function () { this.commentLoadGeneration++; entered(); return held })
        const pending = context[method]()
        await waiting
        change(context, live)
        context.commentMessage = 'current view'
        const expectedContext = context.commentTranslationContext, expectedLanguage = context.commentTranslationLanguage
        release(phase === 'provider' ? blockedTranslation() : undefined)
        expect(await pending).toBeNull()
        expect(context.commentTranslationState).toBeNull()
        expect(context.commentTranslationContext).toBe(expectedContext)
        expect(context.commentTranslationLanguage).toBe(expectedLanguage)
        expect(context.commentMessage).toBe('current view')
        expect(context.commentPendingTranslationOperation).toBe(method === 'queryPendingCommentTranslation' ? 'translation1' : '')
        if (phase === 'provider') expect(context.loadComments).not.toHaveBeenCalled()
        if (method === 'queryPendingCommentTranslation') {
          expect(remote.queryTranslation).toHaveBeenCalledWith('translation1')
          expect(remote.requestTranslation).not.toHaveBeenCalled()
        }
      })
    }
    it.each(changes)(`${method} unknown晚error遇%s，保留同身份原key但不恢复旧视图或提示`, async (name, change) => {
      let reject
      const held = new Promise((resolve, fail) => { reject = fail })
      const remote = { isRemote: true, requestTranslation: vi.fn(() => held), queryTranslation: vi.fn(() => held) }
      const { context, live } = translationContext(remote)
      if (method === 'queryPendingCommentTranslation') {
        context.commentPendingTranslationOperation = 'translation1'; context._commentPendingTranslationProvider = remote
      }
      const pending = context[method]()
      change(context, live); context.commentMessage = 'current view'
      reject(Object.assign(new Error('lost'), { status: 'unknown', operationId: 'translation1' }))
      expect(await pending).toBeNull()
      expect(context.commentTranslationState).toBeNull()
      expect(context.commentMessage).toBe('current view')
      const retained = method === 'queryPendingCommentTranslation' || keepsOriginalKey(name)
      expect(context.commentPendingTranslationOperation).toBe(retained ? 'translation1' : '')
      if (retained) expect(context._commentPendingTranslationProvider).toBe(remote)
      expect(context.loadComments).not.toHaveBeenCalled()
    })
    it.each(changes)(`${method}错误清理await期间发生%s，不让旧catch恢复新上下文`, async (name, change) => {
      let release, entered
      const held = new Promise(resolve => { release = resolve }), waiting = new Promise(resolve => { entered = resolve })
      const error = Object.assign(new Error('lost'), { status: 'unknown', operationId: 'translation1' })
      const remote = { isRemote: true, requestTranslation: vi.fn(async () => { throw error }), queryTranslation: vi.fn(async () => { throw error }) }
      const { context, live } = translationContext(remote)
      context.clearUnavailableCommentView = vi.fn(() => { entered(); return held })
      if (method === 'queryPendingCommentTranslation') {
        context.commentPendingTranslationOperation = 'translation1'; context._commentPendingTranslationProvider = remote
      }
      const pending = context[method](); await waiting
      change(context, live); context.commentMessage = 'current view'; release()
      expect(await pending).toBeNull()
      expect(context.commentTranslationState).toBeNull(); expect(context.commentMessage).toBe('current view')
      const retained = method === 'queryPendingCommentTranslation' || keepsOriginalKey(name)
      expect(context.commentPendingTranslationOperation).toBe(retained ? 'translation1' : '')
      if (retained) expect(context._commentPendingTranslationProvider).toBe(remote)
    })
  }
  it.each(changes.filter(([name]) => name === 'dialog closed' || name === 'language changed'))('T080/T082 unknown晚到%s后阻止再POST，仅显式查原key', async (name, change) => {
    let reject
    const held = new Promise((resolve, fail) => { reject = fail })
    const remote = { isRemote: true, requestTranslation: vi.fn(() => held), queryTranslation: vi.fn(async () => blockedTranslation()) }
    const { context, live } = translationContext(remote)
    const pending = context.submitCommentTranslation(); change(context, live)
    reject(Object.assign(new Error('lost'), { status: 'unknown', operationId: 'translation1' }))
    await pending
    expect(context.commentTranslationState).toBeNull()
    expect(context.commentPendingTranslationOperation).toBe('translation1')
    context.beginCommentTranslation('thread:1', 'reply:1')
    await expect(context.submitCommentTranslation()).resolves.toBeNull()
    expect(remote.requestTranslation).toHaveBeenCalledOnce()
    await expect(context.queryPendingCommentTranslation()).resolves.toMatchObject({ status: 'blocked', persisted: false, taskId: null })
    expect(remote.queryTranslation).toHaveBeenCalledWith('translation1')
    expect(remote.requestTranslation).toHaveBeenCalledOnce()
  })
  it('T079/T080 原GET确认旧source已失效后解除原pending，不升级原revision或重POST', async () => {
    const remote = { isRemote: true, requestTranslation: vi.fn(), queryTranslation: vi.fn(async () => {
      throw Object.assign(new Error('source stale'), { code: 'TRANSLATION_SOURCE_STALE', status: 'rejected', httpStatus: 409, operationId: 'translation1' })
    }) }
    const { context } = translationContext(remote)
    context.commentPendingTranslationOperation = 'translation1'; context._commentPendingTranslationProvider = remote
    context.commentThreads[0].replies[0].replyRevision = '2'
    await expect(context.queryPendingCommentTranslation()).resolves.toBeNull()
    expect(context.commentPendingTranslationOperation).toBe('')
    expect(context.commentTranslationContext).toBeNull(); expect(context.commentTranslationState).toBeNull()
    expect(context.commentMessage).toMatch(/原来源已失效/)
    expect(remote.queryTranslation).toHaveBeenCalledWith('translation1')
    expect(remote.requestTranslation).not.toHaveBeenCalled()
  })
  it('T079/T082 当前unknown保留原key，T080/T083 UI查询实际HTTP仅GET原scope/rev/lang而不二次POST', async () => {
    let body
    const request = vi.fn(async (url, init) => {
      if (init.method === 'POST') { body = JSON.parse(init.body); throw new Error('lost') }
      if (url.includes('/translations?')) return response(503, blockedTranslation({ operationId: body.operationId }))
      return response(200, thread())
    })
    const remote = provider(request), { context } = translationContext(remote)
    await context.submitCommentTranslation()
    expect(context.commentTranslationState).toMatchObject({ status: 'unknown', operationId: body.operationId, sourceRevision: '1', targetLanguage: 'zh-CN' })
    expect(context.commentPendingTranslationOperation).toBe(body.operationId)
    const originalBody = { ...body }
    await expect(context.queryPendingCommentTranslation()).resolves.toMatchObject({ status: 'blocked', persisted: false, taskId: null, batchBlocked: true })
    expect(context.commentPendingTranslationOperation).toBe('')
    expect(context.commentTranslationState).toMatchObject({ status: 'blocked', persisted: false, taskId: null })
    expect(context.commentMessage).toMatch(/整批验收仍受阻/)
    expect(request.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1)
    const [url, init] = request.mock.calls.find(([url]) => url.includes('/translations?'))
    expect(init.method).toBe('GET')
    const params = new URL(url, 'https://local.invalid').searchParams
    for (const key of ['operationId', 'sourceRevision', 'targetLanguage']) expect(params.get(key)).toBe(originalBody[key])
    expect(context.commentThreads[0].replies[0].content).toBe('private text')
    expect(context.commentTranslationState).not.toHaveProperty('translatedText')
  })
})


// Current configured DTO only; E1 does not establish real translation-provider or browser/PG acceptance.
describe('T082 configured translation frontend lifecycle', () => {
  const sourceHash = 'sha256:' + createHash('sha256').update('private text', 'utf8').digest('hex')
  const requestHash = 'sha256:' + 'b'.repeat(64)
  const intent = { operationId: 'translation1', threadId: 'thread:1', replyId: 'reply:1', sourceRevision: '1', targetLanguage: 'zh-CN' }
  const task = (status, extra = {}) => ({ ...intent, tenantId: 'tenant1', docId: 'doc1', status, requestHash, sourceHash,
    taskId: 'translation-actual1', persisted: true, batchBlocked: false,
    translatedText: status === 'ready' ? '<img src=x onerror=alert(1)>真实译文' : null,
    code: status === 'unknown' ? 'OPERATION_UNKNOWN' : status === 'failed' ? 'TRANSLATION_FAILED' : null, ...extra })
  const statusFor = status => status === 'pending' ? 202 : status === 'unknown' ? 503 : 200
  const stateReply = value => response(statusFor(value.status), value)
  function ui(remote) {
    const live = { provider: remote, visible: true }, original = thread()
    const session = { user: { id: 'alice' }, can: () => live.visible, getProvider: () => live.provider }
    const vm = ctx({ editor: null, commentRemote: true, session, commentThreads: [original], commentSourceThreads: [original],
      loadComments: vi.fn(async function () { this.commentLoadGeneration++ }) })
    vm.beginCommentTranslation('thread:1', 'reply:1')
    return { vm, session, live, original }
  }
  it('pending -> pure GET ready binds original hashes, verifies actual current source, and never caches translated text or repeats POST', async () => {
    let posted = false
    const request = vi.fn(async (url, init) => {
      if (!url.includes('/translations')) return response(200, thread())
      if (init.method === 'POST') { posted = true; return stateReply(task('pending')) }
      expect(posted).toBe(true); return stateReply(task('ready'))
    }), port = provider(request)
    await expect(port.requestTranslation(intent)).resolves.toMatchObject({ status: 'pending', requestHash, sourceHash })
    const confirmed = await port.requestTranslation({ ...intent })
    expect(confirmed).toEqual(task('ready')); expect(Object.isFrozen(confirmed)).toBe(true)
    const operations = request.mock.calls.filter(([url]) => url.includes('/translations'))
    expect(operations.map(([, init]) => init.method)).toEqual(['POST', 'GET'])
    expect(new URL(operations[1][0], 'https://local').searchParams.get('sourceRevision')).toBe('1')
    expect(port.getTranslationOperation('translation1')).toMatchObject({ status: 'ready', requestHash, sourceHash, taskId: 'translation-actual1' })
    expect(JSON.stringify(port.getTranslationOperation('translation1'))).not.toContain(task('ready').translatedText)
    expect(() => port.queryTranslation({ operationId: 'translation1', targetLanguage: 'en' })).toThrow('IDEMPOTENCY_MISMATCH')
    await expect(port.requestTranslation({ ...intent, sourceRevision: '2' })).rejects.toThrow('IDEMPOTENCY_MISMATCH')
  })
  it.each([
    { ...intent, status: 'unknown', code: 'COMMIT_UNKNOWN', taskId: null, persisted: null, batchBlocked: false, translatedText: null },
    { ...intent, status: 'unknown', code: 'OPERATION_UNKNOWN', taskId: null, persisted: false, batchBlocked: false, translatedText: null, requestHash, sourceHash },
    task('unknown'),
  ])('defined unknown %j retains original operation and only GETs until confirmed', async unknown => {
    const request = vi.fn(async (url, init) => !url.includes('/translations') ? response(200, thread()) : init.method === 'POST' ? stateReply(unknown) : stateReply(task('ready')))
    const port = provider(request)
    await expect(port.requestTranslation(intent)).resolves.toEqual(unknown)
    await expect(port.requestTranslation({ ...intent, targetLanguage: 'en' })).rejects.toThrow('IDEMPOTENCY_MISMATCH')
    await expect(port.queryTranslation('translation1')).resolves.toEqual(task('ready'))
    expect(request.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1)
  })
  it('known requestHash/sourceHash/taskId cannot be replaced by a later response or minimal COMMIT_UNKNOWN', async () => {
    let next = task('pending')
    const request = vi.fn(async url => url.includes('/translations') ? stateReply(next) : response(200, thread())), port = provider(request)
    await port.requestTranslation(intent)
    for (const changed of [{ requestHash: HASH }, { sourceHash: HASH }, { taskId: 'translation-other' }]) {
      next = task('ready', changed)
      await expect(port.queryTranslation('translation1')).rejects.toMatchObject({ status: 'unknown' })
      expect(port.getTranslationOperation('translation1')).toMatchObject({ requestHash, sourceHash, taskId: 'translation-actual1' })
    }
    next = { ...intent, status: 'unknown', code: 'COMMIT_UNKNOWN', persisted: null, batchBlocked: false, taskId: null, translatedText: null }
    await expect(port.queryTranslation('translation1')).resolves.toEqual(next)
    expect(port.getTranslationOperation('translation1')).toMatchObject({ requestHash, sourceHash })
  })
  it.each([
    [200, task('ready', { tenantId: 'other' })], [200, task('ready', { docId: 'other' })],
    [200, task('ready', { operationId: 'other' })], [200, task('ready', { replyId: 'other' })],
    [200, task('ready', { sourceRevision: '2' })], [200, task('ready', { targetLanguage: 'en' })],
    [200, task('ready', { sourceHash: HASH })], [200, task('ready', { requestHash: requestHash + '\n' })],
    [200, task('ready', { taskId: 'fake' })], [200, task('ready', { extra: true })],
    [200, task('ready', { translatedText: '' })], [200, task('ready', { translatedText: 'a\0b' })],
    [202, task('ready')], [200, task('pending')], [200, task('unknown')],
    [200, task('failed', { translatedText: 'fake' })], [200, task('ready', { code: 'TRANSLATION_FAILED' })],
    [503, { ...intent, status: 'unknown', code: 'COMMIT_UNKNOWN', taskId: null, persisted: null, batchBlocked: false, translatedText: null, requestHash: undefined, sourceHash: undefined }],
    [503, { ...intent, status: 'unknown', code: 'COMMIT_UNKNOWN', taskId: null, persisted: null, batchBlocked: false, translatedText: null, tenantId: undefined, docId: undefined }],
  ])('malformed DTO, actual source/hash, or HTTP/status mismatch %s stays unknown', async (status, data) => {
    const port = provider(async url => url.includes('/translations') ? response(status, data) : response(200, thread()))
    await expect(port.requestTranslation(intent)).rejects.toMatchObject({ status: 'unknown', operationId: 'translation1' })
    expect(port.getTranslationOperation('translation1').status).toBe('unknown')
    expect(port.getTranslationOperation('translation1').requestHash).toBeUndefined()
  })
  it('concurrent late source SHA cannot replace the first committed requestHash binding', async () => {
    let release, entered
    const held = new Promise(resolve => { release = resolve }), waiting = new Promise(resolve => { entered = resolve })
    const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle), laterHash = 'sha256:' + 'c'.repeat(64)
    const spy = vi.spyOn(globalThis.crypto.subtle, 'digest').mockImplementation((...args) => digest(...args)).mockImplementationOnce(async (...args) => { entered(); await held; return digest(...args) })
    const port = provider(async (url, init) => !url.includes('/translations') ? response(200, thread()) : stateReply(init.method === 'POST' ? task('pending') : task('ready', { requestHash: laterHash })))
    try {
      const first = port.requestTranslation(intent).then(value => ({ value }), error => ({ error }))
      expect(await Promise.race([waiting.then(() => true), first.then(() => false)])).toBe(true)
      await expect(port.queryTranslation('translation1')).resolves.toMatchObject({ status: 'ready', requestHash: laterHash })
      release(); expect((await first).error).toMatchObject({ status: 'unknown', operationId: 'translation1' })
      expect(port.getTranslationOperation('translation1').requestHash).toBe(laterHash)
    } finally { release(); spy.mockRestore() }
  })
  it('permission revoked while actual source SHA is awaited prevents ready and hash binding', async () => {
    let visible = true
    const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle)
    const spy = vi.spyOn(globalThis.crypto.subtle, 'digest').mockImplementation(async (...args) => { const value = await digest(...args); visible = false; return value })
    const port = provider(async url => url.includes('/translations') ? stateReply(task('ready')) : response(200, thread()), { getCapabilities: () => ({ canView: visible }) })
    try { await expect(port.requestTranslation(intent)).rejects.toMatchObject({ code: 'COMMENT_NOT_VISIBLE', status: 'rejected' }); expect(port.getTranslationOperation('translation1').requestHash).toBeUndefined() }
    finally { spy.mockRestore() }
  })
  it.each(['pending', 'unknown'])('%s keeps the UI original ID through unresolved GET; later ready shows actual text without editing the reply', async status => {
    const remote = { isRemote: true, requestTranslation: vi.fn(async () => task(status)), queryTranslation: vi.fn().mockResolvedValueOnce(task(status)).mockResolvedValueOnce(task('ready')) }
    const { vm, original } = ui(remote)
    await vm.submitCommentTranslation(); expect(vm.commentPendingTranslationOperation).toBe('translation1')
    expect(vm.commentMessage).toMatch(status === 'pending' ? /任务处理中/ : /尚未确认/)
    await vm.submitCommentTranslation(); expect(remote.requestTranslation).toHaveBeenCalledOnce()
    await expect(vm.queryPendingCommentTranslation()).resolves.toEqual(task(status)); expect(vm.commentPendingTranslationOperation).toBe('translation1')
    await vm.submitCommentTranslation(); expect(remote.requestTranslation).toHaveBeenCalledOnce()
    await expect(vm.queryPendingCommentTranslation()).resolves.toEqual(task('ready'))
    expect(vm.commentPendingTranslationOperation).toBe(''); expect(vm.commentTranslationState.translatedText).toBe(task('ready').translatedText)
    expect(original.replies[0].content).toBe('private text'); expect(remote.queryTranslation).toHaveBeenCalledTimes(2); expect(remote.queryTranslation).toHaveBeenCalledWith('translation1')
  })
  it('failed clears the pending gate, permitting a new explicit language intent and operation', async () => {
    const bodies = [], request = vi.fn(async (url, init) => {
      if (!url.includes('/translations')) return response(200, thread())
      bodies.push(JSON.parse(init.body)); const body = bodies[bodies.length - 1]
      return stateReply(task('failed', { operationId: body.operationId, targetLanguage: body.targetLanguage }))
    }), remote = provider(request), { vm, original } = ui(remote)
    await vm.submitCommentTranslation(); expect(vm.commentTranslationState.status).toBe('failed'); expect(vm.commentPendingTranslationOperation).toBe('')
    vm.setCommentTranslationLanguage('en'); await vm.submitCommentTranslation()
    expect(bodies).toHaveLength(2); expect(bodies[0].operationId).not.toBe(bodies[1].operationId); expect(bodies[1].targetLanguage).toBe('en')
    expect(original.replies[0].content).toBe('private text')
  })
  it.each(['submit', 'query'])('new ready during %s source reload cannot revive a closed or retargeted view', async action => {
    for (const change of ['close', 'language', 'source', 'identity', 'provider', 'dispose']) {
      let finish, entered
      const waiting = new Promise(resolve => { entered = resolve }), held = new Promise(resolve => { finish = resolve })
      const remote = { isRemote: true, requestTranslation: vi.fn(async () => task('ready')), queryTranslation: vi.fn(async () => task('ready')) }
      const { vm, session, original, live } = ui(remote)
      vm.loadComments = vi.fn(function () { this.commentLoadGeneration++; entered(); return held })
      if (action === 'query') { vm.commentPendingTranslationOperation = 'translation1'; vm._commentPendingTranslationProvider = remote }
      const pending = action === 'query' ? vm.queryPendingCommentTranslation() : vm.submitCommentTranslation(); await waiting
      if (change === 'close') vm.closeCommentTranslation()
      if (change === 'language') vm.setCommentTranslationLanguage('en')
      if (change === 'source') original.replies[0].replyRevision = '2'
      if (change === 'identity') session.user = { id: 'bob' }
      if (change === 'provider') live.provider = { isRemote: true }
      if (change === 'dispose') vm.commentDisposed = true
      vm.commentMessage = 'current view'; finish()
      expect(await pending).toBeNull(); expect(vm.commentTranslationState).toBeNull(); expect(vm.commentMessage).toBe('current view')
    }
  })
  it('late pending/unknown keeps same-owner original metadata after close without reopening UI; explicit query is still required', async () => {
    for (const status of ['pending', 'unknown']) {
      let finish
      const held = new Promise(resolve => { finish = resolve }), remote = { isRemote: true, requestTranslation: vi.fn(() => held), queryTranslation: vi.fn(async () => task('ready')) }
      const { vm } = ui(remote), pending = vm.submitCommentTranslation(); vm.closeCommentTranslation(); vm.commentMessage = 'closed'
      finish(task(status)); expect(await pending).toBeNull(); expect(vm.commentPendingTranslationOperation).toBe('translation1')
      expect(vm.commentTranslationContext).toBeNull(); expect(vm.commentTranslationState).toBeNull(); expect(vm.commentMessage).toBe('closed')
      await vm.submitCommentTranslation(); expect(remote.requestTranslation).toHaveBeenCalledOnce()
    }
  })
})


// Real DocumentSession lifecycle with injected providers (E1); no real identity-provider acceptance is implied.
describe('T082 translation identity generation and Session delivery boundary', () => {
  const intent = { operationId: 'translation1', threadId: 'thread:1', replyId: 'reply:1', sourceRevision: '1', targetLanguage: 'zh-CN' }
  const privateText = 'Alice private translation'
  const task = (status = 'ready') => ({ ...intent, tenantId: 'tenant1', docId: 'doc1', status, requestHash: HASH, sourceHash: HASH,
    taskId: 'translation-real-session', persisted: true, batchBlocked: false, translatedText: status === 'ready' ? privateText : null,
    code: status === 'unknown' ? 'OPERATION_UNKNOWN' : null })
  function remoteProvider(extra = {}) {
    return { isRemote: true, list: vi.fn(async () => [thread()]), createThread: vi.fn(), reply: vi.fn(), resolve: vi.fn(), reopen: vi.fn(),
      requestTranslation: vi.fn(async () => task()), queryTranslation: vi.fn(async () => task()), ...extra }
  }
  function setup(remote = remoteProvider()) {
    const session = createDocumentSession({ documentId: 'doc1', user: { id: 'alice' }, comments: remote, capabilities: FLAGS })
    const vm = ctx({ session, editor: null, commentRemote: true, commentThreads: [thread()], commentSourceThreads: [thread()],
      refreshCommentDecorations: vi.fn(), loadComments: vi.fn(async function () { this.commentLoadGeneration++; return [] }) })
    vm.bindCommentSession(); vm.beginCommentTranslation('thread:1', 'reply:1')
    return { session, vm, remote }
  }
  const clean = vm => {
    expect(vm.commentTranslationState).toBeNull(); expect(vm.commentTranslationContext).toBeNull()
    expect(vm.commentPendingTranslationOperation).toBe(''); expect(vm._commentPendingTranslationProvider).toBeNull()
    expect(vm.commentSourceThreads).toEqual([]); expect(vm.commentThreads).toEqual([]); expect(vm.commentPanels).toEqual([])
  }
  it.each(['ready', 'pending', 'unknown'])('real Session user change synchronously clears existing %s and private sources before another tick', async status => {
    const { session, vm } = setup(remoteProvider({ requestTranslation: vi.fn(async () => task(status)) }))
    await vm.submitCommentTranslation(); expect(vm.commentTranslationState.status).toBe(status)
    session.user = { id: 'bob' }
    clean(vm); expect(vm.commentMessage).toBe(''); expect(vm.commentTranslationBusy).toBe(false)
    await session.dispose()
  })
  it.each(['provider', 'dispose'])('real Session %s synchronously clears an already displayed ready', async change => {
    const { session, vm } = setup()
    await vm.submitCommentTranslation(); expect(vm.commentTranslationState.translatedText).toBe(privateText)
    if (change === 'provider') session.setProvider('comments', remoteProvider())
    else { const closing = session.dispose(); clean(vm); await closing }
    clean(vm); expect(vm.commentTranslationIsCurrent(task())).toBe(false)
    await session.dispose()
  })
  it.each(['requestCommentTranslation', 'queryCommentTranslation'])('%s never returns or emits ready after identity, ABA, provider, disposal, or authorization invalidation', async method => {
    for (const change of ['identity', 'identity ABA', 'provider', 'provider ABA', 'dispose', 'authorization ABA']) {
      let release
      const held = new Promise(resolve => { release = resolve }), remote = remoteProvider({ [method === 'requestCommentTranslation' ? 'requestTranslation' : 'queryTranslation']: vi.fn(() => held) })
      const session = createDocumentSession({ documentId: 'doc1', user: { id: 'alice' }, comments: remote, capabilities: FLAGS })
      const comments = vi.fn(), errors = vi.fn(); session.on('comments', comments); session.on('error', errors)
      const pending = session[method](method === 'requestCommentTranslation' ? intent : 'translation1').then(value => ({ value }), error => ({ error }))
      if (change.startsWith('identity')) { session.user = { id: 'bob' }; if (change.endsWith('ABA')) session.user = { id: 'alice' } }
      if (change.startsWith('provider')) { session.setProvider('comments', remoteProvider()); if (change.endsWith('ABA')) session.setProvider('comments', remote) }
      if (change === 'dispose') await session.dispose()
      if (change === 'authorization ABA') { session.setProvider('authorization', { getCapabilities: async () => FLAGS }); await session._capabilitiesPromise; expect(session.can('canView')).toBe(true) }
      release(task()); const outcome = await pending
      expect(outcome.value).toBeUndefined(); expect(outcome.error).toMatchObject({ code: 'COMMENT_TRANSLATION_INVALIDATED', status: 'unknown', operationId: 'translation1' })
      expect(outcome.error).not.toHaveProperty('translatedText'); expect(JSON.stringify(outcome.error)).not.toContain(privateText)
      expect(comments).not.toHaveBeenCalled(); expect(errors).not.toHaveBeenCalled(); await session.dispose()
    }
  })
  it.each(['requestCommentTranslation', 'queryCommentTranslation'])('%s sanitizes a late private error and guards reentrant Session subscribers', async method => {
    let reject
    const held = new Promise((resolve, fail) => { reject = fail }), providerMethod = method === 'requestCommentTranslation' ? 'requestTranslation' : 'queryTranslation'
    const remote = remoteProvider({ [providerMethod]: vi.fn(() => held) })
    const session = createDocumentSession({ documentId: 'doc1', user: { id: 'alice' }, comments: remote, capabilities: FLAGS })
    const errors = vi.fn(); session.on('error', errors)
    const pending = session[method](method === 'requestCommentTranslation' ? intent : 'translation1').then(value => ({ value }), error => ({ error }))
    session.user = { id: 'bob' }; session.user = { id: 'alice' }
    reject(Object.assign(new Error(privateText), { status: 'unknown', operationId: 'translation1', translatedText: privateText }))
    const outcome = await pending
    expect(outcome.error.message).toBe('COMMENT_TRANSLATION_INVALIDATED'); expect(outcome.error).not.toHaveProperty('translatedText'); expect(errors).not.toHaveBeenCalled()
    remote[providerMethod] = vi.fn(async () => task())
    const later = vi.fn(); session.on('comments', () => { session.user = { id: 'bob' } }); session.on('comments', later)
    await expect(session[method](method === 'requestCommentTranslation' ? intent : 'translation1')).rejects.toMatchObject({ code: 'COMMENT_TRANSLATION_INVALIDATED' })
    expect(later).not.toHaveBeenCalled(); await session.dispose()
  })
  it.each(['ready', 'pending', 'unknown'])('real Session A-B-A cannot revive late %s or release a new view busy flag', async status => {
    for (const phase of ['provider', 'list']) {
      let release, entered
      const held = new Promise(resolve => { release = resolve }), waiting = new Promise(resolve => { entered = resolve })
      const { session, vm, remote } = setup()
      if (phase === 'provider') remote.requestTranslation = vi.fn(() => { entered(); return held })
      else { remote.requestTranslation = vi.fn(async () => task(status)); vm.loadComments = vi.fn(function () { this.commentLoadGeneration++; entered(); return held }) }
      const pending = vm.submitCommentTranslation(); await waiting
      session.user = { id: 'bob' }; session.user = { id: 'alice' }
      vm.commentMessage = 'new current view'; vm.commentTranslationBusy = true
      release(task(status)); expect(await pending).toBeNull(); clean(vm)
      expect(vm.commentMessage).toBe('new current view'); expect(vm.commentTranslationBusy).toBe(true)
      vm.commentTranslationBusy = false; await session.dispose()
    }
  })
  it('render guard binds ready to its Session owner even without a mounted lifecycle listener', async () => {
    const { session, vm } = setup()
    vm._commentStopReset(); await vm.submitCommentTranslation()
    const ready = vm.commentTranslationState
    expect(vm.commentTranslationIsCurrent(ready)).toBe(true)
    session.user = { id: 'bob' }; expect(vm.commentTranslationIsCurrent(ready)).toBe(false)
    session.user = { id: 'alice' }; expect(vm.commentTranslationIsCurrent(ready)).toBe(false)
    await session.dispose()
  })
  it('late invalidation captures the original request key before the caller mutates its input', async () => {
    let reject
    const held = new Promise((resolve, fail) => { reject = fail }), remote = remoteProvider({ requestTranslation: vi.fn(() => held) })
    const session = createDocumentSession({ documentId: 'doc1', user: { id: 'alice' }, comments: remote, capabilities: FLAGS }), input = { ...intent }
    const pending = session.requestCommentTranslation(input).then(value => ({ value }), error => ({ error }))
    input.operationId = 'new-intent'; session.user = { id: 'bob' }; reject(new Error(privateText))
    expect((await pending).error).toMatchObject({ code: 'COMMENT_TRANSLATION_INVALIDATED', operationId: 'translation1' })
    await session.dispose()
  })

})


// E1 provider lifecycle only: reset must isolate identity even when an injected fetch ignores AbortSignal.
describe('HTTP comments private context reset', () => {
  const intent = { operationId: 'reset-comment', scope: 'document', visibility: 'private', content: 'private text' }
  const translation = { operationId: 'reset-translation', threadId: 'thread:1', replyId: 'reply:1', sourceRevision: '1', targetLanguage: 'en' }
  const preference = { tenantId: 'tenant1', docId: 'doc1', threadId: 'thread:1', principalId: 'alice', following: false, muted: false, preferenceRevision: '0' }
  const translated = { ...translation, tenantId: 'tenant1', docId: 'doc1', status: 'ready', requestHash: HASH,
    sourceHash: 'sha256:' + createHash('sha256').update('private text').digest('hex'), taskId: 'translation-reset', persisted: true, batchBlocked: false, translatedText: 'private translated text', code: null }
  const held = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
  const observe = promise => promise.then(value => ({ value }), error => ({ error }))
  it('reset removes comment/follow/translation metadata and cached source; retired IDs cannot become POSTs', async () => {
    let denied = false
    const request = vi.fn(async (url, init) => {
      if (denied) return response(404, { code: 'PG_COMMENT_NOT_FOUND' })
      if (url.includes('/translations')) return response(200, translated)
      if (url.endsWith('/follow-preference')) return init.method === 'GET' ? response(200, preference) : response(200, {
        status: 'committed', operationId: 'reset-follow', requestHash: HASH, committedRevision: '1', preference: { ...preference, following: true, preferenceRevision: '1' } })
      return init.method === 'GET' ? response(200, thread()) : committed(intent.operationId)
    }), port = provider(request)
    await port.createThread(intent)
    await port.follow({ operationId: 'reset-follow', threadId: 'thread:1' })
    await port.requestTranslation(translation)
    expect(port.getOperation(intent.operationId)).not.toBeNull(); expect(port.getFollowOperation('reset-follow')).not.toBeNull(); expect(port.getTranslationOperation(translation.operationId)).not.toBeNull()
    port.reset('identity-changed'); denied = true
    expect(port.getOperation(intent.operationId)).toBeNull(); expect(port.getFollowOperation('reset-follow')).toBeNull(); expect(port.getTranslationOperation(translation.operationId)).toBeNull()
    const before = request.mock.calls.length
    for (const work of [() => port.createThread(intent), () => port.follow({ operationId: 'reset-follow', threadId: 'thread:1' }),
      () => port.requestTranslation(translation), () => port.queryOperation(intent.operationId), () => port.queryFollowOperation('reset-follow'), () => port.queryTranslation(translation.operationId)]) {
      await expect(Promise.resolve().then(work)).rejects.toMatchObject({ code: 'COMMENT_CONTEXT_CHANGED' })
    }
    expect(request).toHaveBeenCalledTimes(before)
    await expect(port.reply({ operationId: 'new-identity-comment', threadId: 'thread:1', content: 'new content' })).rejects.toMatchObject({ code: 'COMMENT_NOT_VISIBLE' })
    expect(request.mock.calls.at(-1)[1].method).toBe('GET'); port.dispose()
  })
  it.each(['response', 'json'])('reset aborts actual %s work immediately and ignores its late private result/error', async phase => {
    for (const late of ['result', 'error']) {
      const waiting = held(), entered = held(); let signal
      const request = vi.fn(async (_url, init) => { signal = init.signal; entered.resolve(); return phase === 'response' ? waiting.promise : { status: 200, json: () => waiting.promise } })
      const port = provider(request), pending = observe(port.getThread('thread:1')); await entered.promise
      if (phase === 'json') await Promise.resolve()
      port.reset(); expect(signal.aborted).toBe(true)
      const outcome = await pending; expect(outcome.value).toBeUndefined(); expect(outcome.error).toMatchObject({ code: 'COMMENT_CONTEXT_CHANGED' })
      expect(JSON.stringify(outcome.error)).not.toContain('private text')
      if (late === 'result') waiting.resolve(phase === 'response' ? response(200, thread()) : thread())
      else waiting.reject(Object.assign(new Error('private text'), { translatedText: 'private text' }))
      await Promise.resolve(); await Promise.resolve(); expect(port.getOperation('late')).toBeNull(); port.dispose()
    }
  })
  it.each(['comment', 'follow', 'translation'])('reset during %s preparation reserves its old ID without posting an old intent', async kind => {
    const waiting = held(), entered = held()
    const request = vi.fn(async (_url, init) => { entered.resolve(init); return waiting.promise }), port = provider(request)
    const input = kind === 'comment' ? { operationId: 'preparing-id', threadId: 'thread:1', content: 'private text' }
      : kind === 'follow' ? { operationId: 'preparing-id', threadId: 'thread:1' } : { ...translation, operationId: 'preparing-id' }
    const work = () => kind === 'comment' ? port.reply(input) : kind === 'follow' ? port.follow(input) : port.requestTranslation(input)
    const pending = observe(work()), init = await entered.promise; port.reset(); expect(init.signal.aborted).toBe(true)
    expect((await pending).error).toMatchObject({ code: 'COMMENT_CONTEXT_CHANGED' })
    waiting.resolve(response(200, kind === 'follow' ? preference : thread())); await Promise.resolve()
    await expect(Promise.resolve().then(work)).rejects.toMatchObject({ code: 'COMMENT_CONTEXT_CHANGED' })
    expect(request.mock.calls.every(([, request]) => request.method === 'GET')).toBe(true); port.dispose()
  })
  it('reset while source SHA is awaited never binds or returns the old translated text', async () => {
    const waiting = held(), entered = held(), native = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle)
    const spy = vi.spyOn(globalThis.crypto.subtle, 'digest').mockImplementationOnce(() => { entered.resolve(); return waiting.promise })
    const request = vi.fn(async url => url.includes('/translations') ? response(200, translated) : response(200, thread())), port = provider(request)
    try {
      const pending = observe(port.requestTranslation(translation)); await entered.promise; port.reset()
      waiting.resolve(await native('SHA-256', new TextEncoder().encode('private text')))
      const outcome = await pending; expect(outcome.error).toMatchObject({ code: 'COMMENT_CONTEXT_CHANGED' }); expect(outcome.error).not.toHaveProperty('translatedText')
      expect(port.getTranslationOperation(translation.operationId)).toBeNull()
      await expect(port.requestTranslation(translation)).rejects.toMatchObject({ code: 'COMMENT_CONTEXT_CHANGED' })
    } finally { waiting.resolve(new Uint8Array(32).buffer); spy.mockRestore(); port.dispose() }
  })
  it('dispose is terminal; repeated reset cannot reveal private records or enable another request', async () => {
    const request = vi.fn(async () => committed(intent.operationId)), port = provider(request)
    await port.createThread(intent); port.dispose(); port.reset(); expect(port.getOperation(intent.operationId)).toBeNull()
    for (const work of [() => port.list(), () => port.getThread('thread:1'), () => port.createThread({ ...intent, operationId: 'new-id' }), () => port.getLink('thread:1')]) {
      await expect(Promise.resolve().then(work)).rejects.toMatchObject({ code: 'COMMENT_CONTEXT_CHANGED' })
    }
    expect(request).toHaveBeenCalledOnce()
  })
})


describe('comment reaction desired state', () => {
  const reactionThread = (revision = '1', mine = false) => {
    const value = thread({ threadRevision: revision })
    Object.assign(value.replies[0], { reactions: mine ? [{ emoji: '👍', count: '1', reactedByMe: true }] : [],
      capabilities: { canEdit: true, canDelete: true, canReact: true } })
    return value
  }
  it('uses canonical emoji and desired state; unknown ACK only queries the original key', async () => {
    let posts = 0
    const request = vi.fn(async (url, init) => {
      if (init.method === 'POST') { posts++; throw new Error('lost ACK') }
      return url.includes('/operations/') ? committed('react-1', reactionThread('2', true), '2') : response(200, reactionThread())
    })
    const port = provider(request)
    await port.getThread('thread:1')
    const input = { operationId: 'react-1', threadId: 'thread:1', replyId: 'reply:1', emoji: '👍️', active: true }
    await expect(port.react(input)).rejects.toMatchObject({ status: 'unknown', operationId: 'react-1' })
    const value = await port.react({ ...input, emoji: '👍' })
    expect(value.replies[0].reactions).toEqual([{ emoji: '👍', count: '1', reactedByMe: true }])
    expect(posts).toBe(1)
    expect(JSON.parse(request.mock.calls.find(([, init]) => init.method === 'POST')[1].body)).toMatchObject({ kind: 'reaction', emoji: '👍', active: true })
    expect(value.replies[0].capabilities.canReact).toBe(true)
  })
  it('does not trust mutated capabilities or allow unknown glyphs before IO', async () => {
    const value = reactionThread(); value.replies[0].capabilities.canReact = false
    const request = vi.fn(async () => response(200, value)), port = provider(request)
    const view = await port.getThread('thread:1'); view.replies[0].capabilities.canReact = true
    await expect(port.react({ threadId: 'thread:1', replyId: 'reply:1', emoji: '👍', active: true })).rejects.toMatchObject({ code: 'COMMENT_FORBIDDEN' })
    await expect(port.react({ threadId: 'thread:1', replyId: 'reply:1', emoji: 'arbitrary', active: true })).rejects.toMatchObject({ code: 'COMMENT_INVALID_REACTION' })
    expect(request).toHaveBeenCalledTimes(1)
  })
  it.each(['zero', 'duplicate', 'tombstone', 'missing-capability'])('rejects malformed reaction projection: %s', async kind => {
    const value = reactionThread('1', true), reply = value.replies[0]
    if (kind === 'zero') reply.reactions[0].count = '0'
    if (kind === 'duplicate') reply.reactions.push({ ...reply.reactions[0] })
    if (kind === 'tombstone') { reply.tombstone = true; reply.content = '' }
    if (kind === 'missing-capability') delete reply.capabilities.canReact
    await expect(provider(async () => response(200, value)).getThread('thread:1')).rejects.toMatchObject({ code: 'COMMENT_INVALID_RESPONSE' })
  })
})


describe('comment reaction picker lifecycle', () => {
  const value = () => thread({ replies: [{ ...thread().replies[0], reactions: [], capabilities: { canReact: true } }] })
  it('opens on the current reply, sends explicit desired state without optimistic counts', async () => {
    const run = vi.fn(async () => null)
    const vm = ctx({ commentRemote: true, commentCan: () => true, commentProvider: () => ({ isRemote: true, react() {} }),
      commentThreads: [value()], commentMenuPosition: () => ({ left: 8, top: 8 }), runCommentWrite: run, loadComments: async () => [] })
    vm.openCommentReaction('thread:1', 'reply:1', { currentTarget: {} })
    expect(vm.commentReactionContext).toMatchObject({ threadId: 'thread:1', replyId: 'reply:1' })
    await vm.chooseCommentReaction('👍️')
    expect(run).toHaveBeenCalledWith('react', { threadId: 'thread:1', replyId: 'reply:1', emoji: '👍', active: true, expectedRevision: '1' }, 'reactToComment')
    expect(vm.commentThreads[0].replies[0].reactions).toEqual([])
    expect(vm.commentReactionContext).toBeNull()
  })
  it('closes on Escape/outside and identity reset, with no writes', () => {
    const run = vi.fn(), vm = ctx({ runCommentWrite: run, cancelCommentEdit: () => {}, refreshCommentDecorations: () => {},
      $nextTick: fn => fn(), $el: { querySelectorAll: () => [], contains: node => node === anchor }, commentOperationCurrent: () => () => true, commentCan: () => true })
    const anchor = { isConnected: true, focus: vi.fn() }
    vm.commentReactionContext = {}; vm._commentReactionAnchor = anchor
    const event = { key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() }
    vm.onCommentReactionKeydown(event); expect(anchor.focus).toHaveBeenCalledOnce(); expect(vm.commentReactionContext).toBeNull()
    vm.commentReactionContext = {}; vm.onCommentReactionOutside({ target: { closest: () => null } }); expect(vm.commentReactionContext).toBeNull()
    vm.commentReactionContext = {}; vm.commentReactionQuery = 'private'; vm.resetCommentIdentityView(true)
    expect(vm.commentReactionContext).toBeNull(); expect(vm.commentReactionQuery).toBe(''); expect(run).not.toHaveBeenCalled()
  })
  it.each(['owner', 'permission'])('does not restore delayed picker focus after %s invalidation', kind => {
    let restore, current = true, visible = true
    const run = vi.fn(), anchor = { isConnected: true, focus: vi.fn() }
    const vm = ctx({ runCommentWrite: run, $nextTick: fn => { restore = fn }, $el: { querySelectorAll: () => [] },
      commentOperationCurrent: () => () => current, commentCan: () => visible })
    vm.commentReactionContext = { threadId: 'thread:1', replyId: 'reply:1' }; vm._commentReactionAnchor = anchor
    vm.onCommentReactionKeydown({ key: 'Escape', preventDefault() {}, stopPropagation() {} })
    if (kind === 'owner') current = false
    else visible = false
    restore()
    expect(anchor.focus).not.toHaveBeenCalled(); expect(run).not.toHaveBeenCalled(); expect(vm.commentReactionContext).toBeNull()
  })
})


it('loadComments retains reactions through real bindThreads normalization', async () => {
  const raw = thread(); raw.replies[0].reactions = [{ emoji: '👍', count: '2', reactedByMe: true }]; raw.replies[0].capabilities.canReact = true
  const port = provider(async () => response(200, [raw]))
  const vm = ctx({ commentCan: () => true, commentProvider: () => port, commentAnchorCodec: null,
    installCommentDecorations() {}, refreshCommentDecorations() {}, updateCommentPanels() {} })
  await vm.loadComments()
  expect(vm.commentThreads[0].replies[0].reactions).toEqual(raw.replies[0].reactions)
  expect(vm.commentThreads[0].replies[0].capabilities.canReact).toBe(true)
})


describe('comment images DTO and private byte lifecycle', () => {
  const asset = { assetId: 'asset-image-1', fileName: 'comment.png', mimeType: 'image/png', sizeBytes: '3', checksum: HASH }
  it('sends an image-only comment and retains verified metadata through loadComments/bindThreads', async () => {
    const raw = thread(); raw.replies[0].content = ''; raw.replies[0].attachments = [asset]
    const request = vi.fn(async (url, init) => init.method === 'POST' ? committed('image-create', raw) : response(200, [raw]))
    const port = provider(request)
    await port.createThread({ operationId: 'image-create', scope: 'document', content: '', assetIds: [asset.assetId] })
    expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({ content: '', assetIds: [asset.assetId] })
    const vm = ctx({ commentCan: () => true, commentProvider: () => port, commentAnchorCodec: null, syncCommentImages: vi.fn(),
      installCommentDecorations() {}, refreshCommentDecorations() {}, updateCommentPanels() {} })
    await vm.loadComments(); expect(vm.commentThreads[0].replies[0].attachments).toEqual([asset]); expect(vm.syncCommentImages).toHaveBeenCalledOnce()
  })
  it('accepts legacy read projections over the new write limit but rejects duplicate/new malformed images', async () => {
    const raw = thread(); raw.replies[0].attachments = Array.from({ length: 10 }, (_, i) => ({ ...asset, assetId: 'asset-legacy-' + i }))
    expect((await provider(async () => response(200, raw)).getThread(raw.id)).replies[0].attachments).toHaveLength(10)
    await expect(provider(vi.fn()).createThread({ content: '', scope: 'document', assetIds: Array(10).fill('asset-a') })).rejects.toMatchObject({ code: 'COMMENT_INVALID_ATTACHMENTS' })
    raw.replies[0].attachments = [{ ...asset, mimeType: 'image/svg+xml' }]
    await expect(provider(async () => response(200, raw)).getThread(raw.id)).rejects.toMatchObject({ code: 'COMMENT_INVALID_RESPONSE' })
  })
  it('aborts and never creates a Blob URL from late bytes after private reset', async () => {
    let release, signal
    const pending = new Promise(resolve => { release = resolve })
    const raw = thread(); raw.replies[0].attachments = [asset]
    const get = vi.fn(async input => { signal = input.signal; await pending; input.onChunk(new Uint8Array([1,2,3]), { mimeType: 'image/png' }); return { status: 'completed', mimeType: 'image/png' } })
    const vm = ctx({ commentThreads: [raw], session: { getAssetContent: get }, commentCan: () => true })
    vm.syncCommentImages(); await vi.waitFor(() => expect(get).toHaveBeenCalledOnce()); vm.resetCommentImages(); expect(signal.aborted).toBe(true)
    release(); await new Promise(resolve => setTimeout(resolve, 0)); expect(vm.commentImageUrls).toEqual({}); expect(vm.commentImageErrors).toEqual({})
  })
  it('clears image drafts on identity reset and retains only original query IDs on auth refresh', () => {
    const vm = ctx({ cancelCommentEdit() {}, refreshCommentDecorations() {} })
    vm.commentImageDrafts.document = [{ ...asset }]; vm._commentImageInFlight = { operationId: 'complete-original', beginOperationId: 'begin-original' }
    vm.resetCommentIdentityView(true)
    expect(vm.commentImageDrafts).toEqual({}); expect(vm.commentPendingImage).toEqual({ operationId: 'complete-original', beginOperationId: 'begin-original', kind: 'complete', scope: null })
    vm.resetCommentIdentityView(false); expect(vm.commentPendingImage).toBeNull()
  })
})


describe('comment media ownership regressions', () => {
  const image = { assetId: 'asset-confirmed', fileName: 'ready.png', mimeType: 'image/png', sizeBytes: '3', checksum: HASH }
  it('never clears original complete from a committed begin fallback', async () => {
    const query = vi.fn(async input => input.kind === 'begin' ? { status: 'committed', operation: 'begin' } : { status: 'unknown', operation: 'complete' })
    const vm = ctx({ session: { queryAssetOperation: query }, commentCan: () => true })
    vm.commentPendingImage = { operationId: 'complete-original', beginOperationId: 'begin-original', kind: 'complete', scope: null }
    await vm.queryPendingCommentImage()
    expect(vm.commentPendingImage.operationId).toBe('complete-original'); expect(query).toHaveBeenCalledTimes(1)
  })
  it('does not attach a late successful upload to a cancelled and reopened selection', async () => {
    let release; const waiting = new Promise(resolve => { release = resolve })
    const port = { uploadCommentImage() {} }, session = { user: { id: 'alice' }, getProvider: () => port,
      uploadCommentImage: vi.fn(async () => { await waiting; return { status: 'committed', ready: true, asset: { ...image, ready: true }, assetId: image.assetId } }) }
    const vm = ctx({ session, commentRemote: true, commentCan: () => true, commentCanUploadImage: () => true, commentComposerOpen: true, commentComposerContext: { text: 'A' } })
    const work = vm.uploadCommentImageFiles('selection', { target: { value: '', files: [{ type: 'image/png', size: 3 }] } })
    await vi.waitFor(() => expect(session.uploadCommentImage).toHaveBeenCalledOnce())
    vm.clearCommentDraftImages('selection'); vm.commentComposerContext = { text: 'B' }
    release(); await work; expect(vm.commentDraftImages('selection')).toEqual([]); expect(vm.commentPendingImage).toBeNull()
  })
  it('recovers edit upload only into the same active reply revision without another upload', async () => {
    const raw = thread(); const edit = { threadId: raw.id, replyId: raw.replies[0].id, originalReplyRevision: '1' }
    const query = vi.fn(async () => ({ status: 'committed', operation: 'complete', ready: true, asset: image }))
    const vm = ctx({ session: { queryAssetOperation: query }, commentCan: () => true, commentThreads: [raw], commentEditingReply: edit })
    const scope = 'edit/' + edit.threadId + '/' + edit.replyId
    vm.commentPendingImage = { operationId: 'original-image', kind: 'complete', scope, draftGeneration: 0, context: edit }
    await vm.queryPendingCommentImage(); expect(vm.commentDraftImages(scope)).toEqual([image]); expect(query).toHaveBeenCalledOnce()
    vm.clearCommentDraftImages(scope); raw.replies[0].replyRevision = '2'
    vm.commentPendingImage = { operationId: 'stale-image', kind: 'complete', scope, draftGeneration: 1, context: edit }
    await vm.queryPendingCommentImage(); expect(vm.commentDraftImages(scope)).toEqual([])
  })
  it('clearing text keeps the existing image in the edit command', async () => {
    const raw = thread(); raw.replies[0].attachments = [image]
    const port = { isRemote: true, editReply() {} }, run = vi.fn(async () => raw)
    const vm = ctx({ commentThreads: [raw], commentCan: () => true, commentProvider: () => port, runCommentWrite: run })
    vm.beginEditComment(raw.id, raw.replies[0].id); vm.commentEditContent = ''; await vm.saveEditedComment()
    expect(run.mock.calls[0][1]).toMatchObject({ content: '', assetIds: [image.assetId] })
  })
  it('assets provider replacement revokes old URLs/requests and never queries new provider for old keys', () => {
    const handlers = {}, old = { queryOperation: vi.fn() }, next = { queryOperation: vi.fn() }; let active = old
    const session = { on: (name, handler) => { handlers[name] = handler; return () => {} }, getProvider: () => active }
    const vm = ctx({ session, syncCommentImages: vi.fn(), commentCan: () => true })
    const controller = new AbortController(); vm._commentImageEntries = new Map([['old', { controller, url: '' }]])
    vm.commentImageViewer = { key: 'old' }; vm.commentPendingImage = { operationId: 'old-image', kind: 'complete', scope: null }
    vm.bindCommentSession(); active = next; handlers['provider-changed']({ name: 'assets' })
    expect(controller.signal.aborted).toBe(true); expect(vm.commentImageViewer).toBeNull(); expect(vm.commentPendingImage).toBeNull()
    expect(next.queryOperation).not.toHaveBeenCalled(); expect(vm.commentMessage).toContain('原服务')
  })
})


it('cancelled byte preparation never dispatches upload or leaves a fictitious pending operation', async () => {
  let release
  const bytes = new Promise(resolve => { release = resolve }), request = vi.fn()
  const port = createHttpAssetProvider({ tenantId: 'tenant1', docId: 'doc1', getCapabilities: () => FLAGS, csrfToken: () => 'csrf', request })
  const session = { getProvider: () => port, uploadCommentImage: input => port.uploadCommentImage(input) }
  const vm = ctx({ session, commentCanUploadImage: () => true, commentCan: () => true, commentComposerOpen: true, commentComposerContext: { text: 'A' } })
  const pending = vm.uploadCommentImageFiles('selection', { target: { files: [{ name: 'image.png', type: 'image/png', size: 3, arrayBuffer: () => bytes }], value: '' } })
  vm.cancelCommentImageUpload(); vm.commentComposerContext = { text: 'B' }; release(new Uint8Array([1,2,3]).buffer); await pending
  expect(request).not.toHaveBeenCalled(); expect(vm.commentImageBusy).toBe(false); expect(vm.commentPendingImage).toBeNull(); expect(vm.commentDraftImages('selection')).toEqual([])
})


it('late comment-link response cannot replace a new identity view or copy old link', async () => {
  let release
  const held = new Promise(resolve => { release = resolve }), clear = vi.fn()
  const port = { getLink: () => held }
  const vm = ctx({ commentCan: () => true, commentProvider: () => port, clearUnavailableCommentView: clear })
  const pending = vm.copyRemoteCommentLink('thread:1'); vm.commentLoadGeneration++; vm.commentMessage = 'new view'
  release('https://example.test/document#private-thread'); expect(await pending).toBe(false)
  expect(vm.commentMessage).toBe('new view'); expect(clear).not.toHaveBeenCalled()
})


describe('comment mention wire metadata', () => {
  it('freezes only canonical ids/ranges before preparation, preserves content whitespace and validates server display names', async () => {
    const text = '  😀 @Alice ', source = [{ principalId: 'alice', from: 5, to: 11, displayName: 'client-forged' }]
    const value = thread(); value.replies[0].content = text
    value.replies[0].mentions = [{ principalId: 'alice', from: 5, to: 11, displayName: 'Alice' }]
    const request = vi.fn(async () => committed('mention-comment', value)), port = provider(request)
    const pending = port.createThread({ operationId: 'mention-comment', scope: 'document', content: text, mentions: source })
    source[0].principalId = 'forged'; source.push({ principalId: 'other', from: 0, to: 1 })
    const result = await pending
    expect(JSON.parse(request.mock.calls[0][1].body).mentions).toEqual([{ principalId: 'alice', from: 5, to: 11 }])
    expect(JSON.parse(request.mock.calls[0][1].body).content).toBe(text)
    expect(result.replies[0].mentions[0].displayName).toBe('Alice')
    port.dispose()
  })
  it('legacy payloads omit mentions rather than changing an existing request hash; old replies default to no metadata', async () => {
    const request = vi.fn(async () => committed('legacy-no-mentions')), port = provider(request)
    const result = await port.createThread({ operationId: 'legacy-no-mentions', scope: 'document', content: 'legacy' })
    expect(JSON.parse(request.mock.calls[0][1].body)).not.toHaveProperty('mentions')
    expect(result.replies[0].mentions).toEqual([]); port.dispose()
  })
  it('range changes under one key never POST again and malformed incoming ranges are rejected', async () => {
    const request = vi.fn(async () => committed('ranges')), port = provider(request)
    const input = { operationId: 'ranges', scope: 'document', content: '@Alice', mentions: [{ principalId: 'alice', from: 0, to: 6 }] }
    await port.createThread(input)
    await expect(port.createThread({ ...input, mentions: [] })).rejects.toMatchObject({ code: 'IDEMPOTENCY_MISMATCH' })
    expect(request).toHaveBeenCalledOnce(); port.dispose()
    const bad = thread(); bad.replies[0].mentions = [{ principalId: 'alice', from: 0, to: 99, displayName: 'Alice' }]
    const invalid = provider(async () => response(200, [bad]))
    await expect(invalid.list()).rejects.toMatchObject({ code: 'COMMENT_INVALID_RESPONSE' }); invalid.dispose()
  })
  it('canonical ranges are frozen while a reply waits for its actual thread/CAS baseline', async () => {
    let release
    const waiting = new Promise(resolve => { release = resolve }), source = [{ principalId: 'alice', from: 0, to: 6, displayName: 'client-forged' }]
    const request = vi.fn(async (_url, init) => init.method === 'GET' ? waiting : committed('mention-reply', thread({ threadRevision: '2' }), '2'))
    const port = provider(request), pending = port.reply({ operationId: 'mention-reply', threadId: 'thread:1', content: '@Alice', mentions: source })
    source[0].from = 100; source[0].principalId = 'forged'; release(response(200, thread()))
    await pending
    expect(JSON.parse(request.mock.calls.find(([, init]) => init.method === 'POST')[1].body).mentions).toEqual([{ principalId: 'alice', from: 0, to: 6 }])
    port.dispose()
  })
  it('a full-comment reply action only carries a trusted author into the global draft; sending still creates a whole comment', async () => {
    const created = vi.fn(async () => ({ id: 'new-whole' })), vm = ctx({ commentThreads: [thread()], commentAllowed: () => true,
      createDocumentComment: created, commentDraftImages: () => [], clearCommentDraftImages: () => {} })
    expect(vm.beginDocumentCommentReply('thread:1', 'reply:1')).toBe(true)
    expect(vm.commentDocumentReplyTarget).toMatchObject({ principalId: 'alice', displayName: 'Alice', visibility: 'private' })
    vm.setCommentDocumentDraft(' @Alice ', [{ principalId: 'alice', from: 1, to: 7 }])
    await vm.submitDocumentComment('private')
    expect(created).toHaveBeenCalledWith(' @Alice ', 'private', [], [{ principalId: 'alice', from: 1, to: 7 }])
    expect(vm.commentDocumentMentions).toEqual([])
  })
  it('editing retains canonical metadata, recomputes moved ranges, preserves exact text and clears metadata for plain edits', async () => {
    const raw = thread(); raw.replies[0].content = ' @Alice '
    raw.replies[0].mentions = [{ principalId: 'alice', from: 1, to: 7, displayName: 'Alice' }]
    const run = vi.fn(async () => raw), vm = ctx({ commentThreads: [raw], commentAllowed: () => true, runCommentWrite: run,
      commentDraftImages: () => [], clearCommentDraftImages: () => {}, commentImageUrl: () => '' })
    vm.beginEditComment(raw.id, raw.replies[0].id)
    expect(vm.commentEditMentions).toEqual([{ principalId: 'alice', from: 1, to: 7 }])
    vm.setCommentEditContent('  @Alice\n', [{ principalId: 'alice', from: 2, to: 8 }])
    await vm.saveEditedComment()
    expect(run.mock.calls[0][1]).toMatchObject({ content: '  @Alice\n', mentions: [{ principalId: 'alice', from: 2, to: 8 }] })
    expect(vm.commentEditMentions).toEqual([])
    vm.beginEditComment(raw.id, raw.replies[0].id); vm.setCommentEditContent('@Bob')
    await vm.saveEditedComment()
    expect(run.mock.calls[1][1]).toMatchObject({ content: '@Bob', mentions: [] })
  })
  it('unknown edit retains the rich draft and mention ranges until the original command is confirmed', async () => {
    const raw = thread(), vm = ctx({ commentThreads: [raw], commentAllowed: () => true, runCommentWrite: async () => null,
      commentDraftImages: () => [], clearCommentDraftImages: () => {}, commentImageUrl: () => '' })
    vm.beginEditComment(raw.id, raw.replies[0].id)
    vm.setCommentEditContent('@Alice', [{ principalId: 'alice', from: 0, to: 6 }]); await vm.saveEditedComment()
    expect(vm.commentEditingReply.replyId).toBe(raw.replies[0].id)
    expect(vm.commentEditContent).toBe('@Alice'); expect(vm.commentEditMentions).toEqual([{ principalId: 'alice', from: 0, to: 6 }])
    vm.cancelCommentEdit(); expect(vm.commentEditMentions).toEqual([])
  })
})


describe('comment document-reference wire and edit boundaries', () => {
  const reference = () => ({ docId: 'plan', from: 0, to: 4, displayName: 'Plan', readable: false })
  it('freezes references before the reply CAS read and strips client title/readability', async () => {
    let release
    const waiting = new Promise(resolve => { release = resolve }), refs = [{ ...reference(), displayName: 'forged' }], raw = thread({ threadRevision: '2' })
    raw.replies[0].content = 'Plan'; raw.replies[0].references = [reference()]
    const request = vi.fn(async (_url, init) => init.method === 'GET' ? waiting : committed('reference-reply', raw, '2')), port = provider(request)
    const pending = port.reply({ operationId: 'reference-reply', threadId: 'thread:1', content: 'Plan', references: refs })
    refs[0].docId = 'forged'; refs.push({ docId: 'other', from: 0, to: 1 }); release(response(200, thread()))
    const result = await pending, body = JSON.parse(request.mock.calls.find(([, init]) => init.method === 'POST')[1].body)
    expect(body.references).toEqual([{ docId: 'plan', from: 0, to: 4 }]); expect(body).not.toHaveProperty('mentions')
    expect(result.replies[0].references).toEqual([reference()]); port.dispose()
  })
  it('keeps missing references out of old bodies and rejects altered ranges under the original key', async () => {
    const request = vi.fn(async () => committed('reference-key')), port = provider(request), input = { operationId: 'reference-key', scope: 'document', content: 'legacy' }
    const result = await port.createThread(input)
    expect(JSON.parse(request.mock.calls[0][1].body)).not.toHaveProperty('references'); expect(result.replies[0].references).toEqual([])
    await expect(port.createThread({ ...input, references: [] })).rejects.toMatchObject({ code: 'IDEMPOTENCY_MISMATCH' })
    expect(request).toHaveBeenCalledOnce(); port.dispose()
  })
  it('rejects cross-collection overlap on both write and an otherwise valid list response', async () => {
    const request = vi.fn(), port = provider(request), mentions = [{ principalId: 'alice', from: 0, to: 6 }], references = [{ docId: 'plan', from: 1, to: 6 }]
    await expect(port.createThread({ scope: 'document', content: '@Alice', mentions, references })).rejects.toThrow('OVERLAP')
    expect(request).not.toHaveBeenCalled(); port.dispose()
    const raw = thread(); raw.replies[0].content = '@Alice'; raw.replies[0].mentions = [{ ...mentions[0], displayName: 'Alice' }]
    raw.replies[0].references = [{ ...references[0], displayName: 'Alice', readable: true }]
    const invalid = provider(async () => response(200, [raw]))
    await expect(invalid.list()).rejects.toMatchObject({ code: 'COMMENT_INVALID_RESPONSE' }); invalid.dispose()
  })
  it('private creates derive recipients only from personnel and retain both metadata collections on unknown', async () => {
    const created = vi.fn(async () => null), value = ctx({ commentAllowed: () => true, createDocumentComment: created, commentDraftImages: () => [], clearCommentDraftImages: () => {} }),
      mentions = [{ principalId: 'bob', from: 0, to: 4 }], references = [{ docId: 'plan', from: 5, to: 9 }]
    value.setCommentDocumentDraft('@Bob Plan', mentions, references); await value.submitDocumentComment('private')
    expect(created).toHaveBeenCalledWith('@Bob Plan', 'private', ['bob'], mentions, references)
    expect(value.commentDocumentReferences).toEqual(references); expect(value.commentDocumentMentions).toEqual(mentions)
    value.cancelDocumentCommentDraft(); expect(value.commentDocumentReferences).toEqual([]); expect(value.commentDocumentMentions).toEqual([])
  })
  it('edits reconstruct trusted references, preserve exact text and explicitly clear removed references', async () => {
    const raw = thread(); raw.replies[0].content = 'Plan'; raw.replies[0].references = [reference()]
    const run = vi.fn(async () => raw), value = ctx({ commentThreads: [raw], commentAllowed: () => true, runCommentWrite: run, commentDraftImages: () => [], clearCommentDraftImages: () => {}, commentImageUrl: () => '' })
    value.beginEditComment(raw.id, raw.replies[0].id)
    expect(value.commentEditReferences).toEqual([{ docId: 'plan', from: 0, to: 4, readable: false }])
    value.setCommentEditContent('  Plan ', [], [{ docId: 'plan', from: 2, to: 6 }]); await value.saveEditedComment()
    expect(run.mock.calls[0][1]).toMatchObject({ content: '  Plan ', references: [{ docId: 'plan', from: 2, to: 6 }] })
    value.beginEditComment(raw.id, raw.replies[0].id); value.setCommentEditContent('plain'); await value.saveEditedComment()
    expect(run.mock.calls[1][1].references).toEqual([]); expect(value.commentEditReferences).toEqual([])
  })
})
