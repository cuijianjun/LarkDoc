import { describe, it, expect, vi } from 'vitest'
import { createShareLinkPort, createShareLinkAccessPort, remoteShareLinkAction, shareLinkUrl } from '../../src/providers/share-links'
import shareMixin, { isPasswordValid } from '../../src/components/lark-doc/editor/shareMixin'
const hash = 'sha256:' + 'a'.repeat(64), linkId = 'sl_' + 'b'.repeat(43), csrfToken = 'c'.repeat(43)
const state = extra => ({ tenantId: 'tenant', docId: 'doc', revision: '1', audience: 'public', enabled: true, permission: 'read', linkId, password: 'Aa23!678', passwordAvailable: true, cryptoReady: true, canManage: true, organizationBypass: 'unavailable', ...extra })
const ack = extra => ({ status: 'committed', operationId: 'original', requestHash: hash, committedRevision: '1', link: state(), replayed: false, ...extra })
const error = (code, status) => Object.assign(Error(code), { code, status })
const decimal = v => typeof v === 'string' && /^(0|[1-9][0-9]*)(?![\s\S])/.test(v), digest = v => typeof v === 'string' && /^sha256:[a-f0-9]{64}(?![\s\S])/.test(v)
function manager(send) {
  let allowed = true
  const port = createShareLinkPort({ tenantId: 'tenant', docId: 'doc', send, tenantUrl: '/tenant', requireCapability: () => { if (!allowed) throw error('DENIED') }, operationId: () => 'original', error, contextChanged: operationId => Object.assign(error('CONTEXT_CHANGED'), { operationId }), decimal, digest, nextRevision: v => String(BigInt(v) + 1n) })
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
})
