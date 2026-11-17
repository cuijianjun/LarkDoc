/* global globalThis */
import { describe, it, expect, vi } from 'vitest'
import { createShareLinkPort, createShareLinkAccessPort, remoteShareLinkAction, shareLinkUrl } from '../../src/providers/share-links'
import shareMixin, { isPasswordValid } from '../../src/components/lark-doc/editor/shareMixin'
const hash = 'sha256:' + 'a'.repeat(64), linkId = 'sl_' + 'b'.repeat(43), csrfToken = 'c'.repeat(43)
const state = extra => ({ tenantId: 'tenant', docId: 'doc', revision: '1', audience: 'public', enabled: true, permission: 'read', linkId, password: 'Aa23!678', passwordAvailable: true, cryptoReady: true, canManage: true, organizationBypass: 'unavailable', ...extra })
const ack = extra => ({ status: 'committed', operationId: 'original', requestHash: hash, committedRevision: '1', link: state(), replayed: false, ...extra })
const error = (code, status) => Object.assign(Error(code), { code, status })
const decimal = v => typeof v === 'string' && /^(0|[1-9][0-9]*)(?![\s\S])/.test(v), digest = v => typeof v === 'string' && /^sha256:[a-f0-9]{64}(?![\s\S])/.test(v)
describe('document feature share namespaces', () => {
  it('registers both original namespaces without constructing a default transport or issuing a request', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch'), request = vi.fn()
    const readFetch = vi.fn(() => request)
    Object.defineProperty(globalThis, 'fetch', { configurable: true, get: readFetch })
    try {
      const [links, access, { loadFeature }] = await Promise.all([
        import('../../src/providers/share-links'), import('../../src/providers/share-link-access'), import('../../src/core/features/registry'),
      ])
      await import('../../src/features/document')
      const [registeredLinks, registeredAccess] = await Promise.all([
        loadFeature('document.shareLinks'), loadFeature('document.shareLinkAccess'),
      ])
      expect(registeredLinks).toBe(links)
      expect(registeredAccess).toBe(access)
      expect(Object.keys(registeredLinks).sort()).toEqual(['createShareLinkAccessPort', 'createShareLinkPort', 'remoteShareLinkAction', 'shareLinkUrl'])
      expect(Object.keys(registeredAccess)).toEqual(['createHttpShareLinkAccessProvider'])
      expect('then' in registeredLinks).toBe(false); expect('then' in registeredAccess).toBe(false)
      expect(readFetch).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled()
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'fetch', descriptor)
      else delete globalThis.fetch
    }
  })

  it('keeps the original wrapper factory synchronous with its static port dependency and zero eager requests', async () => {
    const { loadFeature } = await import('../../src/core/features/registry')
    await import('../../src/features/document')
    const { createHttpShareLinkAccessProvider } = await loadFeature('document.shareLinkAccess'), request = vi.fn()
    expect(() => createHttpShareLinkAccessProvider({ tenantId: 'tenant', docId: '', request })).toThrow('SHARE_LINK_CONFIGURATION')
    const port = createHttpShareLinkAccessProvider({ tenantId: 'tenant', docId: 'doc', baseUrl: '/tenant', request })
    expect(port).not.toBeInstanceOf(Promise)
    expect(port.operation()).toBeNull(); expect(port.getPending()).toBeNull()
    expect(request).not.toHaveBeenCalled()
    port.dispose()
    expect(request).not.toHaveBeenCalled()
  })
})

function manager(send) {
  let allowed = true
  const port = createShareLinkPort({ tenantId: 'tenant', docId: 'doc', send, tenantUrl: '/tenant', requireCapability: () => { if (!allowed) throw error('DENIED') }, operationId: () => 'original', error, contextChanged: operationId => Object.assign(error('CONTEXT_CHANGED'), { operationId }), decimal, digest, nextRevision: v => String(globalThis.BigInt(v) + 1n) })
  return { port, deny: () => { allowed = false } }
}
describe('真实链接经理冷端口', () => {
  it('unknown只查原键，历史回执不回退快照，request不重复POST且不公开password body', async () => {
    const send = vi.fn(async (path, body) => body ? { status: 503, data: { status: 'unknown', operationId: 'original', requestHash: hash, code: 'COMMIT_UNKNOWN' } } : { status: 200, data: ack({ link: state({ revision: '3', permission: 'edit' }), replayed: true }) }), { port } = manager(send)
    const input = { expectedRevision: '0', changes: { enabled: true, password: 'Aa23!678' } }
    await expect(port.request(input)).rejects.toMatchObject({ status: 'unknown', operationId: 'original' })
    expect(port.operation()).toEqual({ operationId: 'original', requestHash: hash, status: 'unknown' }); expect(JSON.stringify(port.operation())).not.toContain('Aa23!678')
    expect(() => port.request(input)).toThrow('QUERY_REQUIRED')
    expect((await port.query('original')).link.revision).toBe('3'); expect(send.mock.calls.filter(([, body]) => body)).toHaveLength(1)
    expect(send.mock.calls[1][0]).toContain('commandType=share-link')
    send.mockResolvedValue(state({ revision: '2' })); await expect(port.get()).rejects.toThrow('STALE')
  })
  it('当前经理、scope、版本和密码可用性均严格校验', async () => {
    const send = vi.fn(async () => state()), { port, deny } = manager(send)
    for (const bad of [state({ tenantId: 'other' }), state({ enabled: false }), state({ passwordAvailable: false }), state({ audience: 'organization' }), state({ linkId: linkId + '\n' })]) {
      send.mockResolvedValue(bad); await expect(port.get()).rejects.toThrow('INVALID')
    }
    send.mockResolvedValue(state({ password: null, passwordAvailable: false, cryptoReady: false })); await expect(port.get()).resolves.toMatchObject({ cryptoReady: false, password: null })
    deny(); await expect(port.get()).rejects.toThrow('DENIED')
  })
  it('已交付的成功键可跨同主体续权查询，但不会把历史成功重新排成pending阻塞读取', async () => {
    const send = vi.fn(async (path, body) => body || path.startsWith('operations/') ? { status: 200, data: ack() } : state()), { port } = manager(send)
    await port.request({ expectedRevision: '0', changes: { enabled: true, password: 'Aa23!678' } }); port.reset('authorization-required')
    expect(port.canRecover('original')).toBe(true); expect(port.operation()).toBeNull(); await expect(port.get()).resolves.toMatchObject({ revision: '1' }); await expect(port.query('original')).resolves.toMatchObject({ status: 'committed' })
  })
  it('正文/actor不进请求，首await前复制；身份ABA退休原键，旧同主体授权刷新只保原GET', async () => {
    let finish
    const send = vi.fn((path, body) => body ? new Promise(resolve => { finish = resolve }) : Promise.resolve({ status: 200, data: ack() })), { port } = manager(send)
    const input = { expectedRevision: '0', changes: { password: 'Aa23!678' } }, pending = port.request(input); input.changes.password = 'Other!123'
    expect(send.mock.calls[0][1].changes.password).toBe('Aa23!678')
    port.reset('authorization-required'); finish({ status: 200, data: ack() }); await expect(pending).rejects.toThrow('CONTEXT_CHANGED')
    expect(port.canRecover('original')).toBe(true); await expect(port.query('original')).resolves.toMatchObject({ status: 'committed' }); expect(send.mock.calls[1][1]).toBeUndefined()
    port.reset('identity-changed'); expect(() => port.query('original')).toThrow('CONTEXT_CHANGED')
    expect(() => port.request({ expectedRevision: '1', changes: { actor: 'bob' } })).toThrow('INVALID')
  })
  it('public URL只保留host文档定位字段，不把密码或API目标当入口', () => {
    const url = shareLinkUrl('https://host.example/doc#larkDocument=1&tenantId=tenant&docId=doc', linkId)
    expect(new URL(url).hash).toContain('shareLink='); expect(url).not.toContain('Aa23!678')
    for (const bad of ['javascript:alert(1)', 'https://host.example/editor/v1/tenants/tenant/documents/doc#larkDocument=1&tenantId=tenant&docId=doc', 'https://user:pass@host.example/doc#larkDocument=1&tenantId=tenant&docId=doc', 'https://host.example/doc#wrong=1']) expect(() => shareLinkUrl(bad, linkId)).toThrow()
  })
})
describe('访客明确访问与原键恢复', () => {
  const accessAck = extra => ({ status: 'committed', operationId: 'access-original', requestHash: hash, principalId: 'guest-link-' + 'a'.repeat(40), expiresAt: '2099-01-01T00:00:00.000Z', linkRevision: '1', csrfToken, ...extra })
  const factory = send => createShareLinkAccessPort({ send, operationId: () => 'access-original', error, decimal, digest })
  it('首HTTP整个回包丢失仍可无hash原GET，成功只交csrf而不接收token/能力', async () => {
    const send = vi.fn(async (path, body) => { if (body) throw Error('response lost'); return { status: 200, data: accessAck() } }), port = factory(send)
    await expect(port.request({ linkId, password: 'Aa23!678' })).rejects.toMatchObject({ status: 'unknown' })
    expect(() => port.request({ linkId })).toThrow('QUERY_REQUIRED'); const value = await port.query()
    expect(send.mock.calls[1][1]).toBeUndefined(); expect(send.mock.calls[1][0]).not.toContain('requestHash=')
    expect(value.csrfToken).toBe(csrfToken); expect(value.token).toBeUndefined(); expect(value.capabilities).toBeUndefined(); expect(send.mock.calls.filter(([, body]) => body)).toHaveLength(1)
  })
  it('unknown不冒充拒绝；错误密码已确认deny才允许用户新动作', async () => {
    const send = vi.fn(async () => ({ status: 503, data: { status: 'unknown', code: 'COMMIT_UNKNOWN', operationId: 'access-original', requestHash: hash } })), port = factory(send)
    await expect(port.request({ linkId, password: 'wrong' })).rejects.toMatchObject({ status: 'unknown' })
    send.mockResolvedValue({ status: 404, data: { status: 'denied', code: 'SHARE_LINK_DENIED', operationId: 'access-original', requestHash: hash } })
    await expect(port.query()).rejects.toMatchObject({ status: 'rejected' }); expect(port.operation().status).toBe('rejected')
  })
  it('缺配置单独blocked；缺csrf/伪token/主体/已知hash不符不能emit已认证', async () => {
    const blocked = factory(vi.fn(async () => ({ status: 503, data: { code: 'SHARE_LINK_CRYPTO_UNAVAILABLE' } })))
    await expect(blocked.request({ linkId })).rejects.toMatchObject({ status: 'rejected', code: 'SHARE_LINK_CRYPTO_UNAVAILABLE' })
    for (const data of [accessAck({ csrfToken: undefined }), accessAck({ token: 'must-not-return' }), accessAck({ principalId: 'manager' }), accessAck({ csrfToken: csrfToken + '\n' })]) {
      const port = factory(vi.fn(async () => ({ status: 200, data }))); await expect(port.request({ linkId })).rejects.toMatchObject({ status: 'unknown' })
    }
  })
  it('host换端口/入口后迟到结果退休，不认旧guest候选', async () => {
    let finish; const port = factory(() => new Promise(resolve => { finish = resolve })), pending = port.request({ linkId })
    port.reset(); finish({ status: 200, data: accessAck() }); await expect(pending).rejects.toThrow('CONTEXT_CHANGED'); expect(port.operation()).toBeNull()
  })
})
describe('分享UI当前owner与真实意图', () => {
  function linkHost(overrides = {}) {
    const events = new Map(), allowed = { canView: true, canManagePermission: true }
    const provider = { isRemote: true, shareLink: vi.fn(async method => method === 'operation' ? null : state()) }
    const session = { documentId: 'doc', user: { id: 'manager' }, _privateIdentityGeneration: 1, _authorizationGeneration: 1,
      getProvider: kind => kind === 'authorization' ? provider : null, can: key => allowed[key] !== false,
      on: (name, fn) => { events.set(name, fn); return () => events.delete(name) }, refreshCapabilities: vi.fn() }
    const ed = { ...shareMixin.data(), ...shareMixin.methods, session, sharePopoverOpen: true, showShareToast: vi.fn(), ...overrides }
    Object.entries(shareMixin.computed).forEach(([key, getter]) => Object.defineProperty(ed, key, { configurable: true, get: () => getter.call(ed) }))
    return { ed, provider, session, allowed, events }
  }
  it('wires authoritative manager state and CAS permission/scope changes independently of crypto availability', async () => {
    const { ed, provider } = linkHost()
    const initial = state({ revision: '7', audience: 'collaborators', enabled: false, linkId: null, password: null, passwordAvailable: false, cryptoReady: false })
    let finish
    provider.shareLink.mockImplementation(async (method, input) => method === 'operation' ? null : method === 'get' ? initial : new Promise(resolve => { finish = () => resolve({ status: 'committed', link: state({ revision: '8', permission: input.changes.permission || 'read', enabled: false, password: null, passwordAvailable: false, cryptoReady: false }) }) }))
    await ed.loadShareLink()
    expect(ed.shareLinkState).toEqual(initial)
    const write = ed.setShareLinkPerm('可编辑'); await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    expect(provider.shareLink).toHaveBeenLastCalledWith('request', { expectedRevision: '7', changes: { permission: 'edit' } })
    expect(ed.shareLinkPerm).toBe('可阅读')
    finish(); await write
    expect(ed.shareLinkState.revision).toBe('8'); expect(ed.shareLinkPerm).toBe('可编辑')
    finish = null
    const scope = ed.setShareLinkAudience('collaborators'); await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    expect(provider.shareLink).toHaveBeenLastCalledWith('request', { expectedRevision: '8', changes: { audience: 'collaborators', enabled: false } })
    finish(); await scope
  })
  it('retains an unknown write under its original key and queries before allowing any new share-link mutation', async () => {
    const { ed, provider } = linkHost()
    provider.shareLink.mockImplementation(async method => {
      if (method === 'operation') return null
      if (method === 'get') return state()
      if (method === 'request') throw Object.assign(Error('lost'), { status: 'unknown', operationId: 'original-link-write' })
      return { status: 'committed', link: state({ revision: '4', permission: 'edit' }) }
    })
    await ed.loadShareLink(); await ed.setShareLinkPerm('可编辑')
    expect(ed.shareLinkPending).toBe('original-link-write'); expect(ed.shareLinkState).toBeNull()
    await ed.setShareLinkAudience('collaborators')
    expect(provider.shareLink.mock.calls.filter(([method]) => method === 'request')).toHaveLength(1)
    await ed.queryShareLink()
    expect(provider.shareLink).toHaveBeenLastCalledWith('query', 'original-link-write')
    expect(ed.shareLinkPending).toBe(''); expect(ed.shareLinkState.revision).toBe('4')
  })
  it('does not resubmit a CAS conflict until the manager reloads an authoritative revision', async () => {
    const { ed, provider } = linkHost()
    provider.shareLink.mockImplementation(async method => {
      if (method === 'operation') return null
      if (method === 'get') return state({ revision: '9' })
      throw Object.assign(Error('conflict'), { status: 'rejected', httpStatus: 409, code: 'SHARE_LINK_CONFLICT' })
    })
    await ed.loadShareLink(); await ed.setShareLinkPerm('可编辑')
    expect(ed.shareLinkState).toBeNull(); expect(ed.shareLinkPending).toBe(''); expect(ed.shareLinkError).toContain('版本')
    await ed.setShareLinkPerm('可编辑')
    expect(provider.shareLink.mock.calls.filter(([method]) => method === 'request')).toHaveLength(1)
    await ed.loadShareLink()
    expect(ed.shareLinkState.revision).toBe('9')
  })
  it.each(['identity', 'actor', 'authorization', 'session', 'provider', 'permission', 'close', 'destroy'])('does not repopulate link/password state after %s changes during loading', async change => {
    const { ed, provider, session, allowed } = linkHost()
    let finish
    provider.shareLink.mockImplementation(async method => method === 'operation' ? null : new Promise(resolve => { finish = resolve }))
    const loading = ed.loadShareLink(); await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    if (change === 'identity') session._privateIdentityGeneration++
    if (change === 'actor') session.user.id = 'other-manager'
    if (change === 'authorization') session._authorizationGeneration++
    if (change === 'session') ed.session = { ...session }
    if (change === 'provider') session.getProvider = () => ({ isRemote: true })
    if (change === 'permission') allowed.canManagePermission = false
    if (change === 'close') ed.closeSharePopover()
    if (change === 'destroy') ed._shareReadsDisposed = true
    finish(state()); await loading
    expect(ed.shareLinkState).toBeNull(); expect(ed.secureLinkPassword).toBe('')
    expect(ed.showShareToast).not.toHaveBeenCalled()
  })
  it('does not simulate a local permission/password success without the remote manager port', async () => {
    const { ed, provider } = linkHost(); delete provider.shareLink
    await ed.loadShareLink(); await ed.setShareLinkPerm('可编辑'); await ed.confirmSecureLink()
    expect(ed.shareLinkState).toBeNull(); expect(ed.secureLinkEnabled).toBe(false); expect(ed.secureLinkPassword).toBe('')
    expect(ed.shareLinkError).toMatch(/未接入|未配置|不可用/)
  })
  it('keeps the readonly document-link downgrade on its authoritative port without invoking the manager endpoint', async () => {
    const { ed, session, provider, allowed } = linkHost(); ed.sharePopoverOpen = false; allowed.canManagePermission = false
    const writeText = vi.fn().mockResolvedValue(undefined)
    session.getShareLink = vi.fn(async () => 'https://host.example/doc#larkDocument=1&tenantId=tenant&docId=doc')
    ed.shareClipboardWriter = () => ({ writeText })
    expect(await ed.copyShareLink()).toBe(true)
    expect(session.getShareLink).toHaveBeenCalledOnce(); expect(writeText).toHaveBeenCalledOnce(); expect(provider.shareLink).not.toHaveBeenCalled()
  })
  it('never copies a late document link after the downgraded actor changes', async () => {
    const { ed, session, allowed } = linkHost(); ed.sharePopoverOpen = false; allowed.canManagePermission = false
    let finish
    const writeText = vi.fn().mockResolvedValue(undefined)
    session.getShareLink = vi.fn(() => new Promise(resolve => { finish = resolve }))
    ed.shareClipboardWriter = () => ({ writeText })
    const copied = ed.copyShareLink(); session.user.id = 'other'; finish('https://host.example/doc'); await copied
    expect(writeText).not.toHaveBeenCalled(); expect(ed.showShareToast).not.toHaveBeenCalled()
  })
  it('迟到经理GET不能把密码回填给下一身份', async () => {
    let owned = true, finish
    const provider = { shareLink: vi.fn(async method => method === 'operation' ? null : new Promise(resolve => { finish = resolve })) }, ed = { shareLinkBusy: false, shareLinkState: null, remoteShareScope: () => ({ provider, owner: () => owned, current: () => owned }), showShareToast: vi.fn() }
    const pending = remoteShareLinkAction(ed, 'load'); await Promise.resolve(); owned = false; ed._shareLinkToken = null; ed.shareLinkState = { marker: 'new identity' }; finish(state()); await pending
    expect(ed.shareLinkState).toEqual({ marker: 'new identity' }); expect(ed.secureLinkPassword).toBeUndefined()
  })
  it('确认/随机填入规则合法的CSPRNG密码，随机按钮不POST', async () => {
    const provider = { shareLink: vi.fn() }, ed = { passwordDialogOpen: true, remoteShareScope: () => ({ provider, owner: () => true, current: () => true }) }
    await remoteShareLinkAction(ed, 'random'); expect(ed.passwordDraft).toHaveLength(8); expect(isPasswordValid(ed.passwordDraft)).toBe(true); expect(provider.shareLink).not.toHaveBeenCalled()
  })
  it('权限申请只在真实host入口返回true时消费，否则沿原回调', () => {
    const fallback = vi.fn(), ed = { openDocumentAccessRequests: vi.fn(() => true), onRequestAccess: fallback }
    shareMixin.methods.requestShareAccess.call(ed); expect(fallback).not.toHaveBeenCalled(); ed.openDocumentAccessRequests.mockReturnValue(false); shareMixin.methods.requestShareAccess.call(ed); expect(fallback).toHaveBeenCalledOnce()
  })
  it('邀请unknown保留原键，取消与再次发送均不重发，回查后按真实成员来源确认', async () => {
    const { ed, provider, session } = linkHost()
    provider.listMembers = vi.fn()
    session.listMembers = vi.fn(async () => ({ members: [], authzVersion: '1' }))
    ed.shareDirectory = { status: 'ready', items: [{ principalId: 'guest', displayName: 'Guest' }] }
    expect(await ed.selectShareInviteCandidate('guest')).toBe(true)
    const original = ed.shareInvitation
    let rejectWrite
    session.requestShare = vi.fn(() => new Promise((_, reject) => { rejectWrite = reject }))
    const pending = ed.submitShareInvitation()
    expect(pending).toBeInstanceOf(Promise)
    expect(ed.shareInvitation.status).toBe('sending')
    expect(session.requestShare).toHaveBeenCalledWith(expect.objectContaining({ operationId: original.operationId, sourceGrantKey: original.sourceGrantKey }))
    rejectWrite(error('COMMIT_UNKNOWN', 'unknown'))
    expect(await pending).toBe(false)
    ed.cancelShareInvitation()
    expect(ed.shareInvitation).toMatchObject({ status: 'unknown', operationId: original.operationId })
    expect(await ed.submitShareInvitation()).toBe(false)
    expect(session.requestShare).toHaveBeenCalledOnce()
    session.queryShareOperation = vi.fn(async () => ({ status: 'committed', operationId: original.operationId }))
    session.listMembers.mockResolvedValue({ authzVersion: '2', members: [{ principalId: 'guest', sources: [{ originType: 'share', sourceGrantKey: original.sourceGrantKey, sourceRevision: '1', scopes: ['document.read', 'version.read'] }] }] })
    expect(await ed.queryShareInvitation()).toBe(true)
    expect(session.queryShareOperation).toHaveBeenCalledWith(original.operationId)
    expect(ed.shareInvitation).toMatchObject({ status: 'committed', operationId: original.operationId, verified: true })
  })
  it('邀请发送同步进入忙态，换actor后的迟到ACK不回读或投影成员', async () => {
    const { ed, session } = linkHost()
    ed.shareInvitation = { status: 'confirm', candidate: { principalId: 'guest' }, role: 'read', operationId: 'original', sourceGrantKey: 'source', expectedRevision: '1' }
    ed._shareInviteCurrent = ed.shareReadCurrent('invitation', false)
    let finishWrite
    session.requestShare = vi.fn(() => new Promise(resolve => { finishWrite = resolve }))
    const finish = vi.spyOn(ed, 'finishShareInvitation')
    const pending = ed.submitShareInvitation()
    expect(ed.shareInvitation.status).toBe('sending')
    expect(session.requestShare).toHaveBeenCalledOnce()
    session.user = { id: 'next-actor' }
    finishWrite({ status: 'committed' })
    expect(await pending).toBe(false)
    expect(finish).not.toHaveBeenCalled()
  })
  it('图片发送保留原Promise入口与同步busy，取消后的旧结果不关闭新面板', async () => {
    const { ed } = linkHost()
    const image = { type: { name: 'image' }, attrs: { blockId: 'picture', src: 'https://example.test/image.png' } }
    ed.editor = { state: { doc: { nodeAt: () => image } } }
    ed.shareDocumentLink = () => 'https://example.test/doc'
    ed.imageShare = { image: { pos: 1, ...image.attrs }, recipients: [{ id: 'guest', kind: 'user' }], message: '' }
    let finishSend
    ed.onImageShare = vi.fn(() => new Promise(resolve => { finishSend = resolve }))
    const pending = ed.submitImageShare()
    expect(pending).toBeInstanceOf(Promise)
    expect(ed.imageShare.sending).toBe(true)
    expect(ed.onImageShare).toHaveBeenCalledOnce()
    const signal = ed.onImageShare.mock.calls[0][0].signal
    ed.closeImageShareDialog()
    expect(signal.aborted).toBe(true)
    const next = ed.imageShare = { recipients: [], message: 'next' }
    finishSend(true)
    expect(await pending).toBe(false)
    expect(ed.imageShare).toBe(next)
    expect(ed.showShareToast).not.toHaveBeenCalled()
  })
})
