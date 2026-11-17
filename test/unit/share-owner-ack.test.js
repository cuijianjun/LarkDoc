/* global globalThis */
/**
 * T090 接收人面板 / 查询 / 发送 ACK 的 owner 绑定。
 *
 * 只用本地声明端口受控 ACK：`request` 是本进程内的函数，路径全部落在
 * `/editor/v1/...` 的本地声明端口上，不伪造任何真实联系人投递。
 */
import { describe, it, expect, vi } from 'vitest'
import { createHttpAuthorizationProvider } from '../../src/providers/authorization'
import { createDocumentSession } from '../../src/session/DocumentSession'
import shareMixin from '../../src/components/lark-doc/editor/shareMixin'

const HASH = `sha256:${'a'.repeat(64)}`
const SCOPES = ['document.read', 'document.write', 'comment.write', 'comment.resolve', 'version.read', 'version.create', 'version.restore', 'document.export', 'grant.manage']
const READ = ['document.read', 'version.read']
const response = (status, data) => ({ status, json: async () => data })

const bobMember = sourceGrantKey => ({
  principalId: 'bob', scopes: READ.slice(),
  sources: [{ originType: 'share', sourceGrantKey, sourceRevision: '1', scopes: READ.slice(), revoked: false, sourceGap: false }],
})

/** 本地受控 ACK 端口：所有响应由测试逐条放行，绝不出网。 */
function localAckPort() {
  const calls = [], held = [], share = { operationId: '', sourceGrantKey: '' }
  const state = { members: [], authzVersion: '37', commitPost: false, mirror: false }
  const queryAck = () => ({
    status: 'committed', operationId: share.operationId, requestHash: HASH,
    result: { tenantId: 'tenant1', docId: 'doc1', operationId: share.operationId, subject: 'bob', originType: 'share',
      sourceGrantKey: share.sourceGrantKey, requestHash: HASH, status: 'committed', code: 'ok', authzVersion: '38',
      sourceRevision: '1', observedRevision: '1', sourceGap: false, replayed: false },
  })
  const answer = (url, init) => {
    if (/\/capabilities$/.test(url)) return response(200, { scopes: SCOPES.slice() })
    if (/\/members$/.test(url)) return response(200, { tenantId: 'tenant1', docId: 'doc1', authzVersion: state.authzVersion,
      members: state.mirror ? [bobMember(share.sourceGrantKey)] : state.members })
    if (/\/share-operations$/.test(url)) {
      const body = JSON.parse(init.body)
      Object.assign(share, { operationId: body.operationId, sourceGrantKey: body.sourceGrantKey })
      if (!state.commitPost) return response(503, { status: 'unknown', operationId: share.operationId, requestHash: HASH, code: 'COMMIT_UNKNOWN' })
      return response(200, { tenantId: 'tenant1', docId: 'doc1', operationId: body.operationId, subject: body.subject, originType: 'share',
        sourceGrantKey: body.sourceGrantKey, requestHash: HASH, status: 'committed', code: 'ok', authzVersion: String(globalThis.BigInt(body.expectedRevision) + 1n),
        sourceRevision: '1', observedRevision: '1', sourceGap: false, replayed: false })
    }
    if (/\/operations\//.test(url)) return response(200, queryAck())
    throw new Error(`unexpected local path ${url}`)
  }
  const capabilities = Object.fromEntries(['canView', 'canEdit', 'canComment', 'canResolveComment', 'canCreateVersion', 'canRestoreVersion', 'canExport', 'canManagePermission', 'canCopy'].map(key => [key, true]))
  const request = vi.fn((url, init) => new Promise((resolve, reject) => {
    calls.push({ url, init })
    // 只有跨代次的迟到 ACK 需要人工放行；其它读取即时返回。
    if (state.holdQuery && /\/operations\//.test(url)) held.push({ resolve: () => resolve(answer(url, init)), reject })
    else resolve(answer(url, init))
  }))
  const provider = createHttpAuthorizationProvider({ tenantId: 'tenant1', docId: 'doc1', csrfToken: () => 'csrf',
    request, getCapabilities: () => capabilities })
  return { request, calls, held, state, share, provider }
}

function host(session, extra = {}) {
  const toast = vi.fn()
  const vm = { ...shareMixin.data(), ...shareMixin.methods, session, showShareToast: toast,
    shareDocumentLink: () => 'https://example.test/doc1', ...extra }
  return { vm, toast }
}

async function ready() {
  const port = localAckPort(), session = createDocumentSession({ documentId: 'doc1', user: { id: 'alice' }, authorization: port.provider })
  await session._capabilitiesPromise
  const { vm, toast } = host(session)
  vm.bindShareReads()
  vm.shareDirectory = { status: 'ready', items: [{ principalId: 'bob', displayName: 'Bob', kind: 'user' }], error: '' }
  return { port, session, vm, toast }
}

/** 走到「已提交但结果未知」的原操作，并把查询 ACK 挂起。 */
async function pendingInvitation(ctx) {
  expect(await ctx.vm.selectShareInviteCandidate('bob')).toBe(true)
  const before = ctx.vm.shareInvitation
  expect(await ctx.vm.submitShareInvitation()).toBe(false)
  expect(ctx.vm.shareInvitation.status).toBe('unknown')
  ctx.port.state.holdQuery = true
  const inviteCurrent = ctx.vm._shareInviteCurrent
  const query = ctx.vm.queryShareInvitation()
  await vi.waitFor(() => expect(ctx.port.held).toHaveLength(1))
  return { before, inviteCurrent, query }
}

describe('T090 接收人 ACK 只归属发起它的 actor 与身份授权代次', () => {
  it('授权代次轮换后迟到的邀请 ACK 必须退休：不落 verified、不改成员面板', async () => {
    const ctx = await ready()
    const { query } = await pendingInvitation(ctx)
    // 同 actor、同 provider，仅授权复核推进代次（能力复核后仍全开）
    await ctx.session.refreshCapabilities()
    expect(ctx.session.user.id).toBe('alice')
    expect(ctx.session.can('canManagePermission')).toBe(true)
    ctx.port.state.members = [bobMember(ctx.port.share.sourceGrantKey)]
    ctx.port.state.authzVersion = '38'
    ctx.port.held.splice(0).forEach(entry => entry.resolve())
    expect(await query).toBe(false)
    expect(ctx.vm.shareInvitation.verified).not.toBe(true)
    expect(ctx.vm.shareInvitation.status).not.toBe('committed')
    await ctx.session.dispose()
  })

  it('凭据轮换（同 actor 同授权代次口径内的身份代次）同样让迟到 ACK 退休', async () => {
    const ctx = await ready()
    const { query } = await pendingInvitation(ctx)
    ctx.session._identityGeneration++
    ctx.session._clearPrivateIdentityView('authorization-required')
    ctx.port.state.members = [bobMember(ctx.port.share.sourceGrantKey)]
    ctx.port.state.authzVersion = '38'
    ctx.port.held.splice(0).forEach(entry => entry.resolve())
    expect(await query).toBe(false)
    expect(ctx.vm.shareInvitation.verified).not.toBe(true)
    await ctx.session.dispose()
  })

  it('接收人面板的在途成员读取跨授权代次后不得落地为 ready', async () => {
    const ctx = await ready()
    ctx.port.state.members = [bobMember('ui-share-old')]
    ctx.port.state.holdQuery = true
    const read = ctx.vm.loadShareMembers()
    expect(ctx.vm.shareMembers.status).toBe('loading')
    await ctx.session.refreshCapabilities()
    ctx.port.held.splice(0).forEach(entry => entry.resolve())
    await read
    expect(ctx.vm.shareMembers.status).not.toBe('ready')
    expect(ctx.vm.shareMembers.items).toEqual([])
    await ctx.session.dispose()
  })

  it('换人后旧面板的迟到 ACK 退休，且当前 owner 的新邀请仍可提交并用受控 ACK 回读校验', async () => {
    const ctx = await ready()
    const { inviteCurrent, query } = await pendingInvitation(ctx)
    ctx.session.user = { id: 'dave' }
    expect(inviteCurrent()).toBe(false)
    // 旧接收人面板在换人时即退休：候选草稿与 A 的目录搜索结果都不残留
    expect(ctx.vm.shareInvitation).toMatchObject({ status: 'idle', candidate: null })
    expect(ctx.vm.shareDirectory).toMatchObject({ status: 'idle', items: [] })
    ctx.port.state.members = [bobMember(ctx.port.share.sourceGrantKey)]
    ctx.port.held.splice(0).forEach(entry => entry.resolve())
    expect(await query).toBe(false)
    expect(ctx.vm.shareInvitation.verified).not.toBe(true)

    // 正控制：当前 owner 重新发起，POST 到本地声明端口，ACK 与成员回读一致才算 verified
    ctx.port.state.holdQuery = false; ctx.port.state.commitPost = true; ctx.port.state.authzVersion = '38'
    ctx.port.state.members = [{ principalId: 'carol', scopes: READ.slice(), sources: [] }]
    ctx.vm.shareDirectory = { status: 'ready', items: [{ principalId: 'bob', displayName: 'Bob', kind: 'user' }], error: '' }
    expect(await ctx.vm.selectShareInviteCandidate('bob')).toBe(true)
    // 成员回读只认本次邀请写入的 share source（提交后才可见）
    ctx.port.state.mirror = true
    expect(await ctx.vm.submitShareInvitation()).toBe(true)
    expect(ctx.vm.shareInvitation).toMatchObject({ status: 'committed', verified: true })
    const post = ctx.port.calls.filter(call => /\/share-operations$/.test(call.url))
    expect(post).toHaveLength(2)
    expect(post[1].init).toMatchObject({ method: 'POST', credentials: 'include', headers: { 'X-CSRF-Token': 'csrf' } })
    expect(JSON.parse(post[1].init.body)).toMatchObject({ originType: 'share', subject: 'bob', sourceRevision: '1', scopes: READ })
    // 全程只打本地声明端口，没有任何真实投递
    expect(ctx.port.calls.every(call => call.url.startsWith('/editor/v1/tenants/tenant1/'))).toBe(true)
    await ctx.session.dispose()
  })

  it('取消保留当前 owner 的可用性：不产生新的发送请求', async () => {
    const ctx = await ready()
    expect(await ctx.vm.selectShareInviteCandidate('bob')).toBe(true)
    const before = ctx.port.calls.filter(call => /\/share-operations$/.test(call.url)).length
    ctx.vm.cancelShareInvitation()
    expect(ctx.vm.shareInvitation).toMatchObject({ status: 'idle', candidate: null })
    expect(ctx.port.calls.filter(call => /\/share-operations$/.test(call.url))).toHaveLength(before)
    await ctx.session.dispose()
  })
})
