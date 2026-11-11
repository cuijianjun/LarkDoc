import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createDocumentAccessPort } from '../../src/providers/document-access'
const Dialog = new Function(readFileSync(new URL('../../src/components/lark-doc/DocumentAccessDialog.vue', import.meta.url), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1].replace('export default', 'return'))()
const digest = 'sha256:' + 'a'.repeat(64), otherDigest = 'sha256:' + 'b'.repeat(64), at = '2026-11-10T00:00:00Z'
const row = extra => ({ requestId: 'req-one', requesterId: 'alice', role: 'reader', message: 'draft', status: 'pending', revision: '1', createdAt: at, updatedAt: at, decidedBy: null, reason: '', ...extra })
const list = extra => ({ tenantId: 'tenant', docId: 'doc', principalId: 'alice', canRead: false, canReview: false, items: [row()], ...extra })
const ack = extra => ({ tenantId: 'tenant', docId: 'doc', status: 'committed', operationId: 'op-one', requestHash: digest, kind: 'request', committedRevision: '1', request: row(), granted: false, replayed: false, deduplicated: false, ...extra })
const input = extra => ({ kind: 'request', operationId: 'op-one', expectedRevision: '0', role: 'reader', message: 'draft', ...extra })
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function port(send) {
  const identity = { current: true }, requireIdentity = vi.fn(() => { if (!identity.current) throw Error('IDENTITY_REQUIRED') })
  return { identity, requireIdentity, value: createDocumentAccessPort({ tenantId: 'tenant', docId: 'doc', send, requireIdentity, operationId: () => 'op-one',
    decimal: value => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value), digest: value => /^sha256:[a-f0-9]{64}$/.test(value), nextRevision: value => String(BigInt(value) + 1n),
    error: (code, status) => Object.assign(Error(code), { code, status }), contextChanged: operationId => Object.assign(Error('CONTEXT_CHANGED'), { operationId, status: 'unknown' }) }) }
}
function uiFixture(handler = async method => method === 'operation' ? null : method === 'list' ? list() : ack()) {
  const events = new Map(), provider = { documentAccess: vi.fn(handler) }, providers = { authorization: provider }
  const session = { user: { id: 'alice' }, documentId: 'doc', _identityGeneration: 1, _privateIdentityGeneration: 1, _authorizationGeneration: 1, isAuthenticated: true,
    _identityCurrent() { return this.isAuthenticated }, can: () => false, getProvider: key => providers[key],
    on(name, fn) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(fn); return () => events.get(name).delete(fn) }, emit(name, value) { for (const fn of events.get(name) || []) fn(value) } }
  const vm = { ...Dialog.data(), ed: { session }, scope: 'self', $emit: vi.fn(), $nextTick: fn => fn() }
  for (const [key, fn] of Object.entries(Dialog.methods)) vm[key] = fn.bind(vm)
  for (const [key, fn] of Object.entries(Dialog.computed)) Object.defineProperty(vm, key, { get: fn.bind(vm) })
  return { vm, session, provider, providers, events }
}
afterEach(() => vi.unstubAllGlobals())

describe('无阅读权限的当前认证申请端口', () => {
  it('不要求canView，只发认证作用域GET；无身份前后都不能交付', async () => {
    const send = vi.fn(async () => list()), { value, identity, requireIdentity } = port(send)
    expect(await value.list()).toEqual(list()); expect(send).toHaveBeenCalledWith('access-requests?scope=self'); expect(requireIdentity).toHaveBeenCalledTimes(2)
    identity.current = false; await expect(value.list()).rejects.toThrow('IDENTITY_REQUIRED'); expect(send).toHaveBeenCalledOnce()
    identity.current = true; const gate = deferred(); send.mockReturnValue(gate.promise); const pending = value.list(); identity.current = false; gate.resolve(list()); await expect(pending).rejects.toThrow('IDENTITY_REQUIRED')
  })
  it.each([input({ actor: 'owner' }), input({ role: 'manager' }), input({ expectedRevision: '1' }), input({ message: 'x'.repeat(501) }), input({ message: '\0' }), input({ message: '\ud800' }), input({ operationId: 'bad\n' }), { kind: 'approve', operationId: 'x', expectedRevision: '1', requestId: 'r', role: 'editor' }])('拒绝注入/越角色/非法范围 %#', body => {
    const send = vi.fn(), { value } = port(send); expect(() => value.request(body)).toThrow('INVALID'); expect(send).not.toHaveBeenCalled()
  })
  it('unknown固定原key/hash，挡新POST，只原GET核对，不读/授予任意actor', async () => {
    const send = vi.fn().mockResolvedValueOnce({ status: 503, data: { status: 'unknown', operationId: 'op-one', requestHash: digest } }).mockResolvedValue({ status: 200, data: ack() }), { value } = port(send)
    const body = input(), pending = value.request(body); body.message = 'changed after submit'
    await expect(pending).rejects.toMatchObject({ status: 'unknown', operationId: 'op-one' })
    expect(() => value.request(input({ operationId: 'other' }))).toThrow('QUERY_REQUIRED')
    expect(send.mock.calls[0][1].message).toBe('draft'); await expect(value.query('op-one')).resolves.toEqual(ack())
    expect(send.mock.calls[1]).toEqual(['access-request-operations/op-one?requestHash=' + encodeURIComponent(digest), undefined, true]); expect(send.mock.calls.filter(([, body]) => body)).toHaveLength(1)
  })
  it('相同key异intent拒绝；已知hash不匹配保持unknown而不清pending', async () => {
    const send = vi.fn().mockResolvedValueOnce({ status: 503, data: { status: 'unknown', operationId: 'op-one', requestHash: digest } }).mockResolvedValue({ status: 200, data: ack({ requestHash: otherDigest }) }), { value } = port(send)
    await expect(value.request(input())).rejects.toMatchObject({ status: 'unknown' })
    expect(() => value.request(input({ role: 'editor' }))).toThrow('IDEMPOTENCY_MISMATCH')
    await expect(value.query('op-one')).rejects.toMatchObject({ status: 'unknown' }); expect(value.operation().operationId).toBe('op-one')
  })
  it.each([{ tenantId: 'other' }, { docId: 'elsewhere' }])('跨作用域ACK不能确认原申请 %#', async extra => {
    const { value } = port(async () => ({ status: 200, data: ack(extra) }))
    await expect(value.request(input())).rejects.toMatchObject({ status: 'unknown' }); expect(value.operation().operationId).toBe('op-one')
  })
  it('authorization-required保原票据；身份/服务换代退休旧key，迟回执不发布', async () => {
    const gate = deferred(), send = vi.fn(() => gate.promise), { value } = port(send)
    const late = value.request(input()); value.reset('authorization-required'); gate.resolve({ status: 200, data: ack() }); await expect(late).rejects.toThrow('CONTEXT_CHANGED')
    expect(value.operation().operationId).toBe('op-one'); send.mockResolvedValue({ status: 200, data: ack() }); await value.query('op-one'); expect(send.mock.calls[1][1]).toBeUndefined()
    value.reset('identity-changed'); expect(() => value.query('op-one')).toThrow('CONTEXT_CHANGED'); expect(() => value.request(input())).toThrow('CONTEXT_CHANGED')
  })
  it('历史ACK能确认原申请，不能降低已读状态水位；坏列表不污染水位', async () => {
    const send = vi.fn(async (path, body) => body ? { status: 503, data: { status: 'unknown', operationId: 'op-one' } } : path.startsWith('access-request-operations') ? { status: 200, data: ack() } : list({ items: [row({ revision: '2', status: 'approved', decidedBy: 'owner' })], canRead: true })), { value } = port(send)
    await expect(value.request(input())).rejects.toMatchObject({ status: 'unknown' }); await value.list(); await expect(value.query('op-one')).resolves.toMatchObject({ committedRevision: '1' })
    send.mockResolvedValue(list()); await expect(value.list()).rejects.toThrow('STALE')
    const other = port(async () => list({ tenantId: 'other', items: [row({ revision: '99' })] })).value; await expect(other.list()).rejects.toThrow('INVALID')
  })
  it.each([list({ tenantId: 'other' }), list({ docId: 'other' }), list({ items: [row({ requesterId: 'bob' })] }), list({ canReview: true, canRead: false }), list({ items: [row(), row()] }), list({ items: [row({ message: 'x'.repeat(501) })] })])('越域/别人历史/非法列表不发布 %#', async raw => {
    await expect(port(async () => raw).value.list()).rejects.toThrow('INVALID')
  })
})

describe('申请/审批组件父级与原GET边界', () => {
  it('canView=false仍能读取自己状态；只有当前认证身份可提交', async () => {
    const { vm, provider, session } = uiFixture(); await vm.bind(); expect(vm.authenticated).toBe(true); expect(vm.snapshot.canRead).toBe(false)
    vm.snapshot = list({ items: [] }); vm.message = 'draft'; await vm.submitRequest(); expect(provider.documentAccess).toHaveBeenCalledWith('request', { kind: 'request', expectedRevision: '0', role: 'reader', message: 'draft' })
    session.isAuthenticated = false; provider.documentAccess.mockClear(); await vm.submitRequest(); expect(provider.documentAccess).not.toHaveBeenCalled()
  })
  it('unknown保draft并挡再次提交，确认只原GET后刷新；关闭不伪造成功', async () => {
    let pending = null; const { vm, provider } = uiFixture(async method => {
      if (method === 'operation') return pending
      if (method === 'list') return list({ items: [] })
      if (method === 'request') { pending = { operationId: 'original' }; throw Object.assign(Error('lost'), { status: 'unknown', operationId: 'original' }) }
      if (method === 'query') { pending = null; return ack({ operationId: 'original', request: row({ message: 'keep draft' }) }) }
    }); await vm.bind(); vm.message = 'keep draft'; await vm.submitRequest(); expect(vm.pending).toBe('original'); expect(vm.message).toBe('keep draft')
    await vm.submitRequest(); expect(provider.documentAccess.mock.calls.filter(([method]) => method === 'request')).toHaveLength(1)
    await vm.confirm(); expect(provider.documentAccess).toHaveBeenCalledWith('query', 'original'); expect(vm.pending).toBe('')
  })
  it.each(['identityABA', 'providerABA', 'document', 'destroy'])('迟列表和错误在 %s 后不回填', async boundary => {
    const gate = deferred(), { vm, session, providers } = uiFixture(async method => method === 'operation' ? null : gate.promise)
    const loading = vm.bind()
    await Promise.resolve()
    if (boundary === 'identityABA') { session.user.id = 'bob'; session._privateIdentityGeneration++; session.user.id = 'alice'; session._privateIdentityGeneration++ }
    if (boundary === 'providerABA') { providers.authorization = {}; session._privateIdentityGeneration++; providers.authorization = vm._binding.provider; session._privateIdentityGeneration++ }
    if (boundary === 'document') session.documentId = 'other'
    if (boundary === 'destroy') Dialog.beforeDestroy.call(vm)
    gate.resolve(list()); await loading; expect(vm.snapshot).toBeNull()
  })
  it('处理入口只能操作当前列表pending row，不能改role或取消别人的申请', async () => {
    let approved = false
    const { vm, provider } = uiFixture(async method => {
      if (method === 'operation') return null
      if (method === 'request') { approved = true; return ack({ kind: 'approve', granted: true, committedRevision: '2', request: row({ requesterId: 'bob', status: 'approved', revision: '2', decidedBy: 'alice' }) }) }
      return list({ canRead: true, canReview: true, items: approved ? [] : [row({ requesterId: 'bob' })] })
    }); vm.scope = 'pending'; await vm.bind()
    const item = vm.items[0]; await vm.decide('cancel', item); await vm.decide('approve', { ...item }); expect(provider.documentAccess.mock.calls.some(([method]) => method === 'request')).toBe(false)
    await vm.decide('approve', item); expect(provider.documentAccess).toHaveBeenCalledWith('request', { kind: 'approve', requestId: item.requestId, expectedRevision: '1', reason: '' })
  })
  it('已获读仅通知父级刷新权限，不自行grant；解绑全部监听器', async () => {
    const { vm, events } = uiFixture(async method => method === 'operation' ? null : list({ canRead: true })); await vm.bind(); expect(vm.$emit).toHaveBeenCalledWith('read-available', 'reader')
    Dialog.beforeDestroy.call(vm); expect([...events.values()].every(value => value.size === 0)).toBe(true)
  })
  it('当前读取/处理被撤权后清他人申请缓存，原unknown key仍只允许GET', async () => {
    let deny = false
    const { vm } = uiFixture(async method => {
      if (method === 'operation') return { operationId: 'original', kind: 'approve' }
      if (deny) throw Object.assign(Error('denied'), { httpStatus: 404, status: 'unknown' })
      return list({ canRead: true, canReview: true, items: [row({ requesterId: 'bob' })] })
    }); vm.scope = 'pending'; await vm.bind(); expect(vm.items[0].requesterId).toBe('bob'); vm.decisionReasons = { 'req-one': 'my note' }
    deny = true; await vm.confirm(); expect(vm.snapshot).toBeNull(); expect(vm.decisionReasons).toEqual({}); expect(vm.pending).toBe('original')
    await vm.load(); expect(vm.snapshot).toBeNull(); expect(vm.pending).toBe('original')
  })
  it('opaque guest 403要求正常登录，不自动换身份、重POST或升级来源', async () => {
    const { vm, provider } = uiFixture(async method => {
      if (method === 'operation') return null
      if (method === 'list') return list({ items: [] })
      throw Object.assign(Error('login'), { code: 'PG_ACCESS_LOGIN_REQUIRED', httpStatus: 403, status: 'rejected' })
    }); await vm.bind(); vm.message = 'keep personal draft'; await vm.submitRequest()
    expect(vm.loginRequired).toBe(true); expect(vm.snapshot).toBeNull(); expect(vm.message).toBe('keep personal draft'); expect(vm.$emit).not.toHaveBeenCalled()
    await vm.submitRequest(); expect(provider.documentAccess.mock.calls.filter(([method]) => method === 'request')).toHaveLength(1)
  })
  it('Tab留在弹窗、Esc尊重组合输入；销毁只返焦仍连接的触发器', () => {
    const { vm } = uiFixture(), first = { focus: vi.fn() }, last = { focus: vi.fn() }, dialog = { querySelectorAll: () => [first, last] }, trigger = { isConnected: true, focus: vi.fn() }
    vm.$refs = { dialog }; vm._returnFocus = trigger
    vi.stubGlobal('document', { activeElement: first })
    const backwards = { key: 'Tab', shiftKey: true, preventDefault: vi.fn() }; vm.keydown(backwards); expect(last.focus).toHaveBeenCalled(); expect(backwards.preventDefault).toHaveBeenCalled()
    vm.keydown({ key: 'Escape', isComposing: true, preventDefault: vi.fn() }); expect(vm.$emit).not.toHaveBeenCalled()
    vm.keydown({ key: 'Escape', preventDefault: vi.fn() }); expect(vm.$emit).toHaveBeenCalledWith('close')
    Dialog.beforeDestroy.call(vm); expect(trigger.focus).toHaveBeenCalledWith({ preventScroll: true })
  })
})


describe('approval history and current effective access', () => {
  it('a revoked historical editor approval refreshes once per fact and explicit refresh remains available', async () => {
    const approved = row({ status: 'approved', role: 'editor', revision: '2', decidedBy: 'owner' })
    const { vm } = uiFixture(async method => method === 'operation' ? null : list({ canRead: true, items: [approved] }))
    vm.ed.session.can = name => name === 'canView'; await vm.bind(); await vm.load(); await vm.load()
    expect(vm.$emit).toHaveBeenCalledTimes(1); expect(vm.$emit).toHaveBeenCalledWith('read-available', 'editor')
    await vm.load(true); expect(vm.$emit).toHaveBeenCalledTimes(2)
    Dialog.beforeDestroy.call(vm)
  })
  it('same-identity renewal keeps a confirmed original receipt settled', async () => {
    const { value } = port(async () => ({ status: 200, data: ack() })); await value.request(input()); value.reset('authorization-required'); expect(value.operation()).toBeNull()
  })
})
