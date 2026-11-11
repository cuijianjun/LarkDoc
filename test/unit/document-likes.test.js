import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { createDocumentSession } from '../../src/session/DocumentSession'
import { createDocumentInformationPort } from '../../src/providers/document-information'
import { createDurablePresence } from '../../src/collab/presence'
import { readFileSync } from 'node:fs'
const LikeBar = new Function(readFileSync(new URL('../../src/components/lark-doc/DocumentLikeBar.vue', import.meta.url), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1].replace('export default', 'return'))()

const decimal = value => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)
const hash = 'sha256:' + 'a'.repeat(64)
const like = (revision = '0', liked = false, total = '0') => ({ tenantId: 'tenant', docId: 'doc', revision, liked, total })
const ack = (snapshot = like('1', true, '1')) => ({ status: 'committed', operationId: 'like-one', requestHash: hash, committedRevision: '1', like: snapshot, replayed: false })
function port(send) {
  return createDocumentInformationPort({ tenantId: 'tenant', docId: 'doc', send, tenantUrl: '/tenant', decimal, digest: value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value),
    nextRevision: value => String(BigInt(value) + 1n), operationId: () => 'like-one', requireCapability() {},
    error: (code, status) => Object.assign(Error(code), { code, status }), contextChanged: () => Error('CONTEXT_CHANGED') })
}

describe('文档点赞原键与当前快照', () => {
  it('当前阅读权限可点赞，flat ACK与新信息不依赖privacy代际', async () => {
    const send = vi.fn(async(path, body) => body ? { status: 200, data: ack() } : like()), p = port(send)
    p.observeGeneration('999')
    expect(await p.read('likes')).toEqual(like())
    expect(await p.request({ kind: 'like', expectedRevision: '0', liked: true })).toEqual(ack())
    expect(send.mock.calls[1]).toEqual(['document-like-operations', { operationId: 'like-one', expectedRevision: '0', liked: true }, true])
  })
  it('续权保留committed事实而不把成功点赞重新列待确认', async () => {
    const p = port(async(path, body) => body ? { status: 200, data: ack() } : like('1', true, '1'))
    await p.request({ kind: 'like', expectedRevision: '0', liked: true }); p.reset('authorization-required')
    expect(p.operation('like')).toBeNull(); expect(await p.read('likes')).toEqual(like('1', true, '1'))
    expect(p.canRecover('like-one')).toBe(true)
  })
  it('unknown阻新POST；历史原GET可带更新状态，不回退已读快照', async () => {
    const send = vi.fn(async(path, body) => { if (body) throw Error('lost'); return { status: 200, data: ack(like('3', false, '2')) } }), p = port(send)
    await expect(p.request({ kind: 'like', expectedRevision: '0', liked: true })).rejects.toMatchObject({ status: 'unknown', operationId: 'like-one' })
    expect(() => p.request({ kind: 'like', operationId: 'other', expectedRevision: '0', liked: true })).toThrow('QUERY_REQUIRED')
    await expect(p.query('like-one')).resolves.toMatchObject({ committedRevision: '1', like: like('3', false, '2') })
    expect(send.mock.calls.filter(([, body]) => body)).toHaveLength(1)
    expect(send.mock.calls[1][0]).toContain('commandType=document-like')
    send.mockResolvedValue(like('2', true, '2')); await expect(p.read('likes')).rejects.toThrow('STALE')
  })
  it('503已知请求hash绑定原GET，异hash不能确认', async () => {
    const otherHash = 'sha256:' + 'b'.repeat(64)
    const send = vi.fn(async(path, body) => body ? { status: 503, data: { status: 'unknown', operationId: 'like-one', requestHash: hash } }
      : { status: 200, data: { ...ack(), requestHash: otherHash } }), p = port(send)
    await expect(p.request({ kind: 'like', expectedRevision: '0', liked: true })).rejects.toMatchObject({ status: 'unknown' })
    await expect(p.query('like-one')).rejects.toThrow('INVALID')
    expect(send.mock.calls[1][0]).toContain(encodeURIComponent(hash))
    expect(p.operation('like')).toMatchObject({ operationId: 'like-one', status: 'unknown' })
  })
  it('乱序确认仍确认原提交，但不能降低快照水位；身份重置拒绝迟结果', async () => {
    let finish
    const send = vi.fn(async(path, body) => body ? new Promise(resolve => { finish = resolve }) : like('5', false, '2')), p = port(send)
    const pending = p.request({ kind: 'like', expectedRevision: '0', liked: true })
    await p.read('likes'); finish({ status: 200, data: ack() })
    await expect(pending).resolves.toMatchObject({ status: 'committed' })
    send.mockResolvedValue(like('4', true, '3')); await expect(p.read('likes')).rejects.toThrow('STALE')
    const other = port(send); send.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const late = other.request({ kind: 'like', expectedRevision: '0', liked: true }); other.reset('identity-changed')
    finish({ status: 200, data: ack() }); await expect(late).rejects.toThrow('CONTEXT_CHANGED')
  })
  it.each([like('0', true, '0'), { ...like(), docId: 'elsewhere' }, { ...like(), total: 0 }, { ...like(), revision: '01' }])('拒绝越域或伪造快照 %#', async value => {
    await expect(port(async() => value).read('likes')).rejects.toThrow('INVALID')
  })
  it('旧informationRevision迟到失败，独立privacyGeneration不能冒充信息更新', async () => {
    const raw = { tenantId: 'tenant', docId: 'doc', privacyGeneration: '7', informationRevision: '1', ownerId: 'alice', creatorId: null, createdAt: null, updatedAt: null,
      interaction: { visitors: '0', visits: '0', todayVisits: '0', comments: '0', likes: '0' }, coverage: { likes: 'current-document' } }
    const p = port(async() => raw); p.observeInformationRevision('2'); await expect(p.read('information')).rejects.toThrow('STALE')
    raw.informationRevision = '100'; raw.privacyGeneration = '6'; p.observeGeneration('7')
    await expect(p.read('information')).rejects.toThrow('STALE')
    raw.informationRevision = '2'; raw.privacyGeneration = '7'; expect(await p.read('information')).toEqual(raw)
  })
})

describe('点赞失效元数据不干扰协同', () => {
  it('informationRevision独立递增；旧信息帧仍接收新光标，正文不变', () => {
    const doc = new Y.Doc(), before = Y.encodeStateAsUpdate(doc), presence = createDurablePresence(doc, () => {}, () => ({ epoch: '1', status: 'ready' }))
    try {
      presence.ready('cursor-v1'); const updated = vi.fn(); presence.awareness.on('information-revision', updated)
      const peer = { peerId: 'peer', principalId: 'bob', cursor: null, avatarVisible: true, privacyRevision: '0' }
      presence.receive({ epoch: '1', peers: [peer], privacyGeneration: '3', informationRevision: '7' })
      expect(updated).toHaveBeenCalledWith('7'); expect(presence.awareness.privacyGeneration).toBe('3')
      presence.receive({ epoch: '1', peers: [{ ...peer, principalId: 'carol' }], privacyGeneration: '3', informationRevision: '2' })
      expect(updated).toHaveBeenCalledTimes(1)
      expect([...presence.awareness.getStates().values()].some(state => state.user?.id === 'carol')).toBe(true)
      expect(presence.awareness.informationRevision).toBe('7'); expect(Y.encodeStateAsUpdate(doc)).toEqual(before)
    } finally { presence.destroy(); doc.destroy() }
  })
  it('Session销毁/文档替换/身份ABA后拒绝保留的绑定', () => {
    const provider = {}, session = { documentId: 'doc', user: { id: 'alice' }, _privateIdentityGeneration: 1, _identityGeneration: 1, can: () => true, getProvider: () => provider }
    const binding = { session, provider, principal: 'alice', identity: 1, identityGeneration: 1, documentId: 'doc' }, vm = { _binding: binding, ed: { session } }
    expect(LikeBar.methods.current.call(vm, binding)).toBe(true)
    session._destroyed = true; expect(LikeBar.methods.current.call(vm, binding)).toBe(false)
    session._destroyed = false; session.documentId = 'other'; expect(LikeBar.methods.current.call(vm, binding)).toBe(false)
    session.documentId = 'doc'; session._identityGeneration = 3; expect(LikeBar.methods.current.call(vm, binding)).toBe(false)
  })
  it('LikeBar仅采用不旧于当前的快照', () => {
    const vm = { snapshot: like('9', false, '10') }; LikeBar.methods.accept.call(vm, like('2', true, '1'))
    expect(vm.snapshot).toEqual(like('9', false, '10'))
    LikeBar.methods.accept.call(vm, like('10', true, '11')); expect(vm.snapshot.total).toBe('11')
  })
})


describe('真实 Session 与点赞监听的权限失效广播', () => {
  it('同步移除并重新订阅不会在同一广播再次执行', async () => {
    const session = createDocumentSession({ documentId: 'doc', user: { id: 'alice' }, capabilities: { canView: false } })
    const vm = { ...LikeBar.data(), ed: { session } }; let binds = 0
    for (const [name, fn] of Object.entries(LikeBar.methods)) vm[name] = fn.bind(vm)
    const bind = vm.bind; vm.bind = () => { if (++binds > 3) throw Error('SYNCHRONOUS_REBIND_LOOP'); bind() }
    try {
      vm.bind(); expect(() => session.emit('capabilities', session.getCapabilities())).not.toThrow(); expect(binds).toBe(2)
      expect(session._listeners.get('capabilities').size).toBe(1)
      expect(() => session.emit('identity', {})).not.toThrow(); expect(binds).toBe(3)
    } finally { vm.unbind(); await session.dispose() }
  })
  it('本次广播跳过已移除监听，新订阅只在下一次广播执行', async () => {
    const session = createDocumentSession(), removed = vi.fn(), added = vi.fn(); let remove
    session.on('capabilities', () => { remove(); session.on('capabilities', added) }); remove = session.on('capabilities', removed)
    try { session.emit('capabilities', {}); expect(removed).not.toHaveBeenCalled(); expect(added).not.toHaveBeenCalled(); session.emit('capabilities', {}); expect(added).toHaveBeenCalledOnce() } finally { await session.dispose() }
  })
})
