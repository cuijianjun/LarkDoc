import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHttpAuthorizationProvider, DEFAULT_CAPABILITIES, DENIED_CAPABILITIES } from '../../src/providers/authorization'
import { createDocumentSession } from '../../src/session/DocumentSession'
import mentionMixin from '../../src/components/lark-doc/editor/mentionMixin'
import shareMixin from '../../src/components/lark-doc/editor/shareMixin'

const full = Object.fromEntries(Object.keys(DEFAULT_CAPABILITIES).map(key => [key, true]))

describe('文档信息操作记录的分类列表（组件方法，不代表真实DOM几何验收）', () => {
  const source = readFileSync(new URL('../../src/components/lark-doc/DocumentInformationDialog.vue', import.meta.url), 'utf8')
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '').replace('export default', 'return')
  const dialog = new Function('LarkDocIcon', script)({})
  const row = (kind, actorId = 'alice') => ({ kind, actorId, occurredAt: '2026-11-10T01:00:00Z' })
  const records = (extra = {}) => ({ tenantId: 'tenant', docId: 'doc', privacyGeneration: '1', coverageSince: null, truncated: false,
    category: 'all', supportedCategories: ['all', 'share', 'duplicate', 'settings'], items: [row('permissions'), row('duplicate')], ...extra })
  const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes }); return { promise, resolve } }
  function view(provider = { documentInformation: vi.fn(async method => method === 'operation' ? null : records()) }) {
    const session = { documentId: 'doc', user: { id: 'alice', name: 'Alice' }, _privateIdentityGeneration: 1, _authorizationGeneration: 1,
      can: () => true, getProvider: vi.fn(() => provider), on: vi.fn(() => () => {}) }
    const focus = vi.fn()
    const vm = { ...dialog.data(), ...dialog.methods, ed: { session, collaborationUsers: [{ id: 'bob', name: 'Bob' }] },
      $refs: { operationFilters: { querySelector: () => ({ focus }) }, operationFeed: { scrollTop: 73 } },
      $nextTick: callback => callback(), $emit: vi.fn(), tab: 'operations' }
    Object.keys(dialog.computed).forEach(key => Object.defineProperty(vm, key, { get: () => dialog.computed[key].call(vm) }))
    return { vm, session, provider, focus }
  }
  it('五个真实分类使用稳定ID；下载只按显式supportedCategories启用', () => {
    const { vm } = view()
    expect(vm.operationCategories.map(({ id, label }) => [id, label])).toEqual([
      ['all', '全部'], ['share', '分享授权'], ['duplicate', '创建副本'], ['download', '下载'], ['settings', '权限设置变更'],
    ])
    expect(vm.operationSupport).toEqual(['all'])
    expect(vm.operationSupportFor({ supportedKinds: ['permissions', 'duplicate', 'sharing-settings', 'download'] })).toEqual(['all', 'share', 'duplicate', 'settings'])
    expect(vm.operationSupportFor({ supportedCategories: ['all', 'download'], supportedKinds: ['permissions'] })).toEqual(['all', 'download'])
    expect(vm.operationSupportFor({})).toEqual(['all'])
  })
  it('兼容旧slice时只按已知kind分类；截断后的筛空不声称全历史无记录', () => {
    const { vm } = view()
    vm.records = { items: [row('create'), row('permissions'), row('duplicate'), row('sharing-settings')], truncated: true,
      supportedKinds: ['create', 'permissions', 'duplicate', 'sharing-settings'] }
    expect(vm.operationRows).toHaveLength(4)
    for (const [category, kind] of [['share', 'permissions'], ['duplicate', 'duplicate'], ['settings', 'sharing-settings']]) {
      vm.operationCategory = category; expect(vm.operationRows.map(item => item.kind)).toEqual([kind])
    }
    vm.records.items = []; expect(vm.operationEmptyText).toContain('当前已加载记录')
    expect(vm.operationCoverageNote).toContain('未显示的历史记录')
    vm.records.truncated = false; expect(vm.operationCoverageNote).toContain('仅筛选已加载')
  })
  it('操作记录走独立category端口，不复用visits或privacy读取；无虚构目标字段', async () => {
    const { vm, provider } = view()
    await vm.load()
    expect(provider.documentInformation.mock.calls).toEqual([['operation', 'privacy'], ['read', { kind: 'operations', category: 'all' }]])
    expect(vm.operationSupport).toEqual(['all', 'share', 'duplicate', 'settings'])
    expect(vm.operationRows).toEqual(records().items)
    expect(vm.person('alice')).toBe('Alice'); expect(vm.person('bob')).toBe('Bob'); expect(vm.person('unknown')).toBe('unknown')
    expect(vm.operationText('permissions')).toBe('更改权限')
    expect(vm.records.items.every(item => Object.keys(item).sort().join(',') === 'actorId,kind,occurredAt')).toBe(true)
  })
  it('禁用或重复分类不发请求；选择启用分类清旧rows并重置独立滚动位置', async () => {
    const { vm, provider } = view()
    await vm.load(); provider.documentInformation.mockClear()
    expect(vm.selectOperationCategory('download')).toBeUndefined()
    expect(vm.selectOperationCategory('all')).toBeUndefined()
    expect(provider.documentInformation).not.toHaveBeenCalled()
    const waiting = deferred(), entered = deferred()
    provider.documentInformation.mockImplementation(async (method, input) => {
      if (method === 'operation') return null
      expect(input).toEqual({ kind: 'operations', category: 'duplicate' }); entered.resolve(); return waiting.promise
    })
    const pending = vm.selectOperationCategory('duplicate')
    expect(vm.records).toBeNull(); expect(vm.$refs.operationFeed.scrollTop).toBe(0)
    await entered.promise; waiting.resolve(records({ category: 'duplicate', items: [row('duplicate')] })); await pending
    expect(vm.operationRows.map(item => item.kind)).toEqual(['duplicate'])
  })
  it('左右/Home/End只轮转受支持分类并把焦点交回选中项，Tab可进入独立滚动区', () => {
    const { vm, focus } = view()
    vm.operationSupport = ['all', 'share', 'duplicate', 'settings']
    vm.load = vi.fn(async () => {})
    vm.moveOperationCategory(1); expect(vm.operationCategory).toBe('share')
    vm.moveOperationCategory(-1); expect(vm.operationCategory).toBe('all')
    vm.moveOperationCategory(-1); expect(vm.operationCategory).toBe('settings')
    vm.moveOperationCategory(0, 'first'); expect(vm.operationCategory).toBe('all')
    vm.moveOperationCategory(0, 'last'); expect(vm.operationCategory).toBe('settings')
    expect(focus).toHaveBeenCalledTimes(5)
    expect(vm.operationCategory).not.toBe('download')
    const first = { focus: vi.fn() }, last = { focus: vi.fn() }, preventDefault = vi.fn()
    vm.$refs.dialog = { querySelectorAll: selector => { expect(selector).toContain('[tabindex="0"]'); return [first, last] } }
    const prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
    try {
      Object.defineProperty(globalThis, 'document', { value: { activeElement: last }, configurable: true })
      vm.trapFocus({ shiftKey: false, preventDefault }); expect(first.focus).toHaveBeenCalledOnce(); expect(preventDefault).toHaveBeenCalledOnce()
      globalThis.document.activeElement = first
      vm.trapFocus({ shiftKey: true, preventDefault }); expect(last.focus).toHaveBeenCalledOnce()
    } finally { if (prior) Object.defineProperty(globalThis, 'document', prior); else delete globalThis.document }
  })
  it('旧分类迟响应不能覆盖新分类或结束其loading；回包category不匹配也不展示', async () => {
    const old = deferred(), fresh = deferred(), entered = deferred()
    const provider = { documentInformation: vi.fn(async (method, input) => {
      if (method === 'operation') return null
      if (input.category === 'all') { entered.resolve(); return old.promise }
      return fresh.promise
    }) }, { vm } = view(provider)
    vm.operationSupport = ['all', 'duplicate']
    const first = vm.load(); await entered.promise
    const second = vm.selectOperationCategory('duplicate')
    old.resolve(records()); await first
    expect(vm.records).toBeNull(); expect(vm.loading).toBe(true)
    fresh.resolve(records({ category: 'duplicate', items: [row('duplicate', 'bob')] })); await second
    expect(vm.operationRows).toEqual([row('duplicate', 'bob')]); expect(vm.loading).toBe(false)
    provider.documentInformation.mockImplementation(async method => method === 'operation' ? null : records({ category: 'share' }))
    await vm.load(); expect(vm.records).toBeNull(); expect(vm.error).toContain('无法加载')
  })
  it('切离操作页后旧回包不冒充访问或隐私数据，其他页沿原read端口', async () => {
    const old = deferred(), entered = deferred(), visits = { items: [], truncated: false }
    const provider = { documentInformation: vi.fn(async (method, input) => {
      if (method === 'operation') return null
      if (method === 'read' && input?.kind === 'operations') { entered.resolve(); return old.promise }
      return input === 'visits' ? visits : { principalId: 'alice', revision: '2' }
    }) }, { vm } = view(provider)
    const first = vm.load(); await entered.promise
    vm.tab = 'visits'; await vm.load(); old.resolve(records()); await first
    expect(vm.records).toBe(visits)
    vm.tab = 'privacy'; await vm.load(); expect(vm.privacy).toMatchObject({ principalId: 'alice', revision: '2' })
    expect(provider.documentInformation.mock.calls).toContainEqual(['read', 'visits'])
    expect(provider.documentInformation.mock.calls).toContainEqual(['read', 'privacy'])
  })
  it.each(['principal', 'provider', 'generation', 'authorization', 'destroy'])('%s变化使在途分类回包失效', async boundary => {
    const old = deferred(), entered = deferred(), provider = { documentInformation: vi.fn(async method => {
      if (method === 'operation') return null
      entered.resolve(); return old.promise
    }) }, { vm, session } = view(provider)
    const pending = vm.load(); await entered.promise
    if (boundary === 'principal') session.user = { id: 'bob' }
    else if (boundary === 'provider') session.getProvider.mockReturnValue({ documentInformation: vi.fn() })
    else if (boundary === 'generation') session._privateIdentityGeneration++
    else if (boundary === 'authorization') session._authorizationGeneration++
    else vm._isBeingDestroyed = true
    old.resolve(records()); await pending
    expect(vm.records).toBeNull(); expect(vm.error).toBe('')
  })
  it('重绑身份清分类能力与记录；未决privacy只先GET原键再读取该分类', async () => {
    const provider = { documentInformation: vi.fn(async method => method === 'operation' ? { operationId: 'privacy-original' } : method === 'query' ? {} : records()) }
    const { vm } = view(provider)
    vm.operationCategory = 'settings'; vm.operationSupport = ['all', 'settings', 'download']; vm.records = records()
    const load = vm.load; vm.load = vi.fn()
    vm.bind(); expect(vm.operationCategory).toBe('all'); expect(vm.operationSupport).toEqual(['all']); expect(vm.records).toBeNull()
    vm.load = load; await vm.load()
    expect(provider.documentInformation.mock.calls).toEqual([['operation', 'privacy'], ['query', 'privacy-original'], ['read', { kind: 'operations', category: 'all' }]])
  })
})

describe('文档信息/访问/隐私的延迟端口', () => {
  const decimal = value => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)
  const privacy = extra => ({ tenantId: 'tenant', principalId: 'alice', revision: '1', privacyGeneration: '1', showVisitRecords: false, showVisitAvatars: true, ...extra })
  const ack = extra => ({ ...privacy(), status: 'committed', operationId: 'privacy-one', requestHash: 'sha256:' + 'a'.repeat(64), replayed: false, ...extra })
  function harness(send) {
    const allow = { value: true }
    const port = createDocumentInformationPort({ tenantId: 'tenant', docId: 'doc', tenantUrl: '/tenant', send, decimal,
      digest: value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value), nextRevision: value => String(BigInt(value) + 1n),
      requireCapability: () => { if (!allow.value) throw Error('DENIED') }, operationId: () => 'privacy-one',
      error: (code, status) => Object.assign(Error(code), { code, status }), contextChanged: id => Object.assign(Error('CONTEXT_CHANGED'), { operationId: id }) })
    return { port, allow }
  }
  it('隐私通知使旧快照失效；旧操作回执仍可确认，随后读取当前值', async () => {
    const send = vi.fn(async(path, body) => {
      if (body) throw Error('response lost')
      if (path.startsWith('operations/')) return { status: 200, data: { status: 'committed', operationId: 'privacy-one', requestHash: ack().requestHash, result: ack() } }
      return privacy({ privacyGeneration: '2', revision: '2', showVisitRecords: true })
    })
    const { port } = harness(send)
    await expect(port.request({ kind: 'privacy', expectedRevision: '0', changes: { showVisitRecords: false } })).rejects.toMatchObject({ status: 'unknown' })
    port.observeGeneration('2')
    const confirmed = await port.query('privacy-one'); expect(confirmed.privacyGeneration).toBe('1')
    const current = await port.read('privacy'); expect(current.revision).toBe('2'); expect(current.showVisitRecords).toBe(true)
    expect(send.mock.calls.filter(([, body]) => body)).toHaveLength(1)
    send.mockResolvedValue(privacy({ privacyGeneration: '1' })); await expect(port.read('privacy')).rejects.toThrow('STALE')
  })
  it('unknown阻新操作，原键相同请求只GET；错误主体和代际不能恢复', async () => {
    const send = vi.fn(async() => { throw Error('lost') }), { port } = harness(send)
    const input = { kind: 'privacy', operationId: 'privacy-one', expectedRevision: '0', changes: { showVisitRecords: false } }
    await expect(port.request(input)).rejects.toMatchObject({ status: 'unknown' })
    expect(() => port.request({ ...input, operationId: 'two' })).toThrow('QUERY_REQUIRED'); expect(send).toHaveBeenCalledOnce()
    port.reset('authorization-required'); expect(port.operation('privacy').operationId).toBe('privacy-one')
    send.mockResolvedValue({ status: 200, data: { status: 'committed', operationId: 'privacy-one', requestHash: ack().requestHash, result: ack() } })
    await expect(port.request(input)).resolves.toMatchObject({ status: 'committed' }); expect(send.mock.calls[1][1]).toBeUndefined()
    port.reset('identity-changed'); await expect(Promise.resolve().then(() => port.query('privacy-one'))).rejects.toThrow('CONTEXT_CHANGED')
  })
  it('换主体后迟到回执不能覆盖当前作用域，拒绝不匹配的文档快照', async () => {
    let finish
    const send = vi.fn(() => new Promise(resolve => { finish = resolve })), { port } = harness(send)
    const pending = port.request({ kind: 'privacy', expectedRevision: '0', changes: { showVisitRecords: false } })
    port.reset('identity-changed'); finish({ status: 200, data: ack() }); await expect(pending).rejects.toThrow('CONTEXT_CHANGED')
    send.mockResolvedValue({ tenantId: 'other', docId: 'doc', items: [], truncated: false, privacyGeneration: '1' })
    await expect(port.read('visits')).rejects.toThrow('INVALID')
  })
  it('读取权限、布尔变更和修订值严格校验', async () => {
    const send = vi.fn(async() => privacy()), { port, allow } = harness(send)
    for (const changes of [{ showVisitRecords: 'false' }, { unknown: true }, {}]) expect(() => port.request({ kind: 'privacy', expectedRevision: '0', changes })).toThrow('INVALID')
    expect(() => port.request({ kind: 'privacy', expectedRevision: 0, changes: { showVisitRecords: false } })).toThrow('INVALID')
    allow.value = false; await expect(port.read('privacy')).rejects.toThrow('DENIED'); expect(send).not.toHaveBeenCalled()
  })
  it('分类原语冻结为严格query，旧string读取仍保留原URL', async () => {
    const response = category => ({ tenantId: 'tenant', docId: 'doc', privacyGeneration: '1', coverageSince: null, items: [], truncated: false,
      category, supportedCategories: ['all', 'share', 'duplicate', 'settings'] })
    const send = vi.fn(async path => response(path.includes('category=share') ? 'share' : 'all')), { port } = harness(send)
    await port.read('operations'); expect(send).toHaveBeenLastCalledWith('operation-records')
    const input = { kind: 'operations', category: 'share' }, pending = port.read(input); input.category = 'settings'; await pending
    expect(send).toHaveBeenLastCalledWith('operation-records?category=share')
    const count = send.mock.calls.length
    for (const invalid of [null, [], ['operations'], 'toString', { kind: 'operations', category: 'anything' }, { kind: 'operations', category: 'share', actor: 'bob' }, { kind: 'privacy', category: 'all' }]) await expect(port.read(invalid)).rejects.toThrow('INVALID')
    expect(send).toHaveBeenCalledTimes(count)
  })
  it('不匹配分类或半个advertisement不推进隐私floor，也不作为成功分类返回', async () => {
    const response = { tenantId: 'tenant', docId: 'doc', privacyGeneration: '99', coverageSince: null, items: [], truncated: false,
      category: 'settings', supportedCategories: ['all', 'share', 'duplicate', 'settings'] }
    const send = vi.fn(async () => response), { port } = harness(send)
    await expect(port.read({ kind: 'operations', category: 'share' })).rejects.toThrow('INVALID')
    send.mockResolvedValue({ ...response, category: 'share' }); await expect(port.read('operations')).rejects.toThrow('INVALID')
    send.mockResolvedValue({ ...response, category: 'share', items: [{ actorId: 'alice', kind: 'duplicate', occurredAt: '2026-11-10T00:00:00Z' }] })
    await expect(port.read({ kind: 'operations', category: 'share' })).rejects.toThrow('INVALID')
    for (const bad of [{ ...response, supportedCategories: undefined }, { ...response, category: undefined }, { ...response, supportedCategories: ['all', 'settings', 'settings'] }]) {
      send.mockResolvedValue(bad); await expect(port.read('operations')).rejects.toThrow('INVALID')
    }
    send.mockResolvedValue(privacy()); await expect(port.read('privacy')).resolves.toMatchObject({ privacyGeneration: '1' })
  })
  it('分类读取迟响应仍在当前阅读权限门之后，不缓存失权记录', async () => {
    let finish
    const send = vi.fn(() => new Promise(resolve => { finish = resolve })), { port, allow } = harness(send)
    const pending = port.read({ kind: 'operations', category: 'all' }); allow.value = false
    finish({ tenantId: 'tenant', docId: 'doc', privacyGeneration: '1', coverageSince: null, items: [], truncated: false, category: 'all', supportedCategories: ['all'] })
    await expect(pending).rejects.toThrow('DENIED')
  })
  it('坏响应不推进隐私floor；访问原回执不能跨tenant/doc', async () => {
    const send = vi.fn(async() => privacy({ tenantId: 'other', privacyGeneration: '99' })), { port } = harness(send)
    await expect(port.read('privacy')).rejects.toThrow('INVALID')
    send.mockResolvedValue(privacy()); await expect(port.read('privacy')).resolves.toMatchObject({ privacyGeneration: '1' })
    send.mockResolvedValue({ tenantId: 'tenant', docId: 'doc', privacyGeneration: '99', coverageSince: null, truncated: false, items: [null] })
    await expect(port.read('visits')).rejects.toThrow('INVALID')
    send.mockResolvedValue(privacy()); await expect(port.read('privacy')).resolves.toMatchObject({ privacyGeneration: '1' })
    send.mockResolvedValue({ status: 200, data: { ...ack(), tenantId: 'other', docId: 'doc', recorded: true, reason: 'recorded', visitedAt: '2026-11-10T00:00:00Z' } })
    await expect(port.request({ kind: 'visit' })).rejects.toThrow('INVALID')
  })
  it('同挂载首次unknown在恢复时只GET原键，确认后租约不重复计次', async () => {
    let pending = null, confirmed = false
    const calls = []
    const provider = { isRemote: true, async documentInformation(method, input) {
      calls.push([method, input])
      if (method === 'operation') return pending
      if (method === 'request') { pending = { operationId: 'visit-original', status: 'unknown' }; throw Object.assign(Error('unknown'), { status: 'unknown' }) }
      if (method === 'query') { confirmed = true; pending = null; return { status: 'committed' } }
    } }
    const session = { user: { id: 'alice' }, _privateIdentityGeneration: 1, can: () => true, getProvider: () => provider }, ed = { session, editor: { isDestroyed: false } }
    await recordEditorVisit(ed); expect(ed._documentVisit.status).toBe('unknown')
    await recordEditorVisit(ed); await recordEditorVisit(ed)
    expect(confirmed).toBe(true); expect(calls.filter(([method]) => method === 'request')).toHaveLength(1)
    expect(calls.filter(([method]) => method === 'query')).toEqual([['query', 'visit-original']])
  })
  it('同挂载反复刷新租约只记录一次；下一身份不带入旧访问', async () => {
    const provider = { isRemote: true, documentInformation: vi.fn(async method => method === 'operation' ? null : {}) }
    const session = { user: { id: 'alice' }, _privateIdentityGeneration: 1, can: () => true, getProvider: () => provider }
    const ed = { session, editor: { isDestroyed: false } }
    await recordEditorVisit(ed); await recordEditorVisit(ed); await recordEditorVisit(ed)
    expect(provider.documentInformation.mock.calls.filter(([method]) => method === 'request')).toHaveLength(1)
    session.user = { id: 'bob' }; session._privateIdentityGeneration++
    await recordEditorVisit(ed); expect(provider.documentInformation.mock.calls.filter(([method]) => method === 'request')).toHaveLength(2)
    ed._isDestroyed = true; await recordEditorVisit(ed)
    expect(provider.documentInformation.mock.calls.filter(([method]) => method === 'request')).toHaveLength(2)
  })
})
const scopes = ['document.read', 'document.write', 'comment.write', 'comment.resolve', 'version.read',
  'version.create', 'version.restore', 'document.export', 'grant.manage']
const fetchResult = (data, status = 200) => ({ status, json: async () => data })
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const httpProvider = request => createHttpAuthorizationProvider({ tenantId: 'tenant', docId: 'doc', request })
const createSession = authorization => createDocumentSession({ documentId: 'doc', providers: { authorization } })
const ticket = () => ({ ticket: 'synthetic-opaque-ticket', tenantId: 'tenant', docId: 'doc', principalId: 'alice',
  authzVersion: '2', epoch: '1', expiresAt: '2026-11-07T13:00:00Z', protocolVersion: 'editor-crdt-v1', scopes: ['document.read'] })

const mentionBlocked = (extra = {}) => ({ status: 'blocked', code: 'DEPENDENCY_BLOCKED', dependency: 'internal-directory',
  operationId: 'mention1', sourceEpoch: '9007199254740993', sourceSeq: '7', persisted: false, taskId: null, notified: false, shared: false, ...extra })
const readySource = () => ({ status: 'ready', epoch: '9007199254740993', lastSeq: '7', pending: [] })
const enhancement = (request, extra = {}) => createHttpAuthorizationProvider({ tenantId: 'tenant', docId: 'doc', csrfToken: 'csrf',
  getCapabilities: () => full, getState: readySource, documentUrl: 'https://app.example/docs/doc', request, ...extra })

describe('只读云文档搜索', () => {
  const snapshot = extra => ({ tenantId: 'tenant', docId: 'doc', items: [{ kind: 'page', docId: 'target', displayName: '获准文档' }], ...extra })
  it('空查询和编码查询只发GET，不读正文seq或写mention动作', async () => {
    const request = vi.fn(async() => fetchResult(snapshot())), state = vi.fn(() => { throw Error('must not read body state') })
    const provider = enhancement(request, { getState: state })
    await expect(provider.searchDocuments({ query: '' })).resolves.toEqual(snapshot())
    await provider.searchDocuments({ query: 'a & 中文' })
    expect(request.mock.calls.map(([url, init]) => [url, init.method, init.body])).toEqual([
      ['/editor/v1/tenants/tenant/documents/doc/document-search?query=', 'GET', undefined],
      ['/editor/v1/tenants/tenant/documents/doc/document-search?query=a%20%26%20%E4%B8%AD%E6%96%87', 'GET', undefined],
    ])
    expect(state).not.toHaveBeenCalled()
    expect(request.mock.calls[0][1]).toMatchObject({ credentials: 'include', cache: 'no-store', redirect: 'error' })
  })
  it.each([undefined, null, 42, 'x'.repeat(129), 'bad\0query'])('拒绝无效query %s，不触网络', async query => {
    const request = vi.fn(), provider = enhancement(request)
    await expect(provider.searchDocuments({ query })).rejects.toMatchObject({ code: 'DOCUMENT_SEARCH_QUERY_INVALID' })
    expect(request).not.toHaveBeenCalled()
  })
  it.each([
    { tenantId: 'other' }, { docId: 'other' }, { items: null }, { items: Array.from({ length: 21 }, (_, index) => ({ kind: 'page', docId: `d${index}`, displayName: 'd' })) },
    { items: [{ kind: 'user', docId: 'target', displayName: 'd' }] }, { items: [{ kind: 'page', docId: '../bad', displayName: 'd' }] },
    { items: [{ kind: 'page', docId: 'target\n', displayName: 'd' }] }, { items: [{ kind: 'page', docId: 'target', displayName: '' }] },
    { items: [{ kind: 'page', docId: 'target', displayName: 'x'.repeat(256) }] }, { items: [{ kind: 'page', docId: 'target', displayName: 'bad\0title' }] },
    { items: [{ kind: 'page', docId: 'same', displayName: 'A' }, { kind: 'page', docId: 'same', displayName: 'B' }] },
  ])('拒绝越域/无类型/重复/超限DTO %s', async extra => {
    const provider = enhancement(async() => fetchResult(snapshot(extra)))
    await expect(provider.searchDocuments({ query: '' })).rejects.toMatchObject({ code: 'DOCUMENT_SEARCH_INVALID_RESPONSE' })
  })
  it('响应只投影受支持元数据，权限撤销后不交付标题', async () => {
    const request = vi.fn(async() => fetchResult(snapshot({ items: [{ kind: 'page', docId: 'target', displayName: '文档', body: 'must not project' }] })))
    const flags = { ...full }, provider = enhancement(request, { getCapabilities: () => flags })
    const value = await provider.searchDocuments({ query: '' })
    expect(value.items[0]).toEqual({ kind: 'page', docId: 'target', displayName: '文档' })
    const gate = deferred(); request.mockImplementation(() => gate.promise)
    const pending = provider.searchDocuments({ query: '' }); flags.canView = false; gate.resolve(fetchResult(snapshot()))
    await expect(pending).rejects.toMatchObject({ code: 'AUTHORIZATION_NOT_VISIBLE' })
    request.mockClear(); await expect(provider.searchDocuments({ query: '' })).rejects.toMatchObject({ code: 'AUTHORIZATION_NOT_VISIBLE' }); expect(request).not.toHaveBeenCalled()
  })
  it.each(['identity-changed', 'authorization-required', 'provider-replaced'])('reset %s 后迟响应不返回，下一查询独立GET', async reason => {
    const gate = deferred(), request = vi.fn(() => gate.promise), provider = enhancement(request)
    const pending = provider.searchDocuments({ query: 'old' }); provider.reset(reason); gate.resolve(fetchResult(snapshot()))
    await expect(pending).rejects.toMatchObject({ code: 'AUTHORIZATION_CONTEXT_CHANGED' })
    request.mockImplementation(async() => fetchResult(snapshot({ items: [] })))
    await expect(provider.searchDocuments({ query: 'new' })).resolves.toMatchObject({ items: [] })
    expect(request.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true)
  })
  it('只读失败可显式重试同查询，不创建幂等操作', async () => {
    const request = vi.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValue(fetchResult(snapshot())), provider = enhancement(request)
    await expect(provider.searchDocuments({ query: '' })).rejects.toThrow('offline')
    await expect(provider.searchDocuments({ query: '' })).resolves.toEqual(snapshot())
    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls.every(([, init]) => init.method === 'GET' && !init.headers['Idempotency-Key'])).toBe(true)
  })
})
const SHARE_HASH = `sha256:${'d'.repeat(64)}`
const shareInput = () => ({ operationId: 'share1', subject: 'bob', sourceGrantKey: 'business-share-1', scopes: ['document.read'], expectedRevision: '2', sourceRevision: '1' })
const shareResult = (extra = {}) => ({ tenantId: 'tenant', docId: 'doc', operationId: 'share1', subject: 'bob', originType: 'share',
  sourceGrantKey: 'business-share-1', status: 'committed', code: 'ok', requestHash: SHARE_HASH, authzVersion: '3', sourceRevision: '1',
  observedRevision: '1', sourceGap: false, replayed: false, ...extra })

const MENTION_HASH = `sha256:${'a'.repeat(64)}`
const settingsSnapshot = (extra = {}) => ({ tenantId: 'tenant', docId: 'doc', settingsRevision: '9007199254740993', authzVersion: '31',
  values: { collaborators: 'readers', copy: 'readers', duplicate: 'readers', comment: 'readers' },
  supported: { collaborators: ['readers', 'editors', 'managers'], copy: ['readers', 'editors', 'managers'], duplicate: ['readers', 'editors', 'managers'], comment: ['readers', 'editors'] },
  canManage: true, ...extra })
const settingsInput = () => ({ operationId: 'settings1', expectedRevision: '9007199254740993', changes: { copy: 'managers' } })
const settingsAck = (extra = {}) => ({ ...settingsSnapshot({ settingsRevision: '9007199254740994', authzVersion: '32',
  values: { ...settingsSnapshot().values, copy: 'managers' } }), status: 'committed', operationId: 'settings1', requestHash: SHARE_HASH, replayed: false, ...extra })

describe('头像策略的五字段当前投影及四字段历史回执兼容', () => {
  it('旧四项回执仍确认；当前明确公布的visitorAvatar才被展示', async () => {
    const old = settingsSnapshot(), current = settingsSnapshot({ values: { ...old.values, visitorAvatar: 'editors' }, supported: { ...old.supported, visitorAvatar: ['readers', 'editors', 'managers'] } })
    const request = vi.fn(async(url, init) => fetchResult(init.method === 'POST' ? settingsAck() : current)), p = enhancement(request)
    expect((await p.getSharingSettings()).values.visitorAvatar).toBe('editors')
    await expect(p.requestSharingSettings(settingsInput())).resolves.toEqual(settingsAck())
    expect(JSON.parse(request.mock.calls[1][1].body).changes).toEqual(settingsInput().changes)
    p.dispose()
  })
})

describe('document sharing settings: confirmed snapshot and original-operation recovery', () => {
  it('uses existing cookie/CSRF transport, exact decimal CAS and confirmed values', async () => {
    const request = vi.fn(async (_url, init) => fetchResult(init.method === 'POST' ? settingsAck() : settingsSnapshot()))
    const port = enhancement(request)
    expect(await port.getSharingSettings()).toEqual(settingsSnapshot())
    expect(await port.requestSharingSettings(settingsInput())).toEqual(settingsAck())
    const [url, init] = request.mock.calls[1]
    expect(url).toMatch(/\/documents\/doc\/sharing-setting-operations$/)
    expect(init).toMatchObject({ method: 'POST', credentials: 'include', cache: 'no-store', headers: { 'X-CSRF-Token': 'csrf', 'Idempotency-Key': 'settings1' } })
    expect(JSON.parse(init.body)).toEqual(settingsInput())
    port.dispose()
  })
  it('unknown keeps the original key across reauthentication and uses only GET; identity ABA retires it', async () => {
    const request = vi.fn(async (_url, init) => init.method === 'POST'
      ? fetchResult({ status: 'unknown', code: 'COMMIT_UNKNOWN', operationId: 'settings1' }, 503)
      : fetchResult({ status: 'committed', operationId: 'settings1', requestHash: SHARE_HASH, result: settingsAck() }))
    const port = enhancement(request)
    await expect(port.requestSharingSettings(settingsInput())).rejects.toMatchObject({ status: 'unknown', operationId: 'settings1' })
    await expect(port.requestSharingSettings({ ...settingsInput(), operationId: 'replacement-key' })).rejects.toMatchObject({ code: 'SHARING_SETTINGS_QUERY_REQUIRED', operationId: 'settings1' })
    await expect(port.getSharingSettings()).rejects.toMatchObject({ code: 'SHARING_SETTINGS_QUERY_REQUIRED', operationId: 'settings1' })
    port.reset('authorization-required')
    expect(await port.getSharingSettingsOperation()).toMatchObject({ operationId: 'settings1', status: 'unknown' })
    await expect(port.requestSharingSettings(settingsInput())).rejects.toMatchObject({ code: 'SHARING_SETTINGS_QUERY_REQUIRED' })
    expect(await port.querySharingSettingsOperation('settings1')).toEqual(settingsAck())
    expect(request.mock.calls.map(call => call[1].method)).toEqual(['POST', 'GET'])
    expect(request.mock.calls[1][0]).toContain('commandType=sharing-settings')
    port.reset('identity-changed')
    await expect(port.querySharingSettingsOperation('settings1')).rejects.toMatchObject({ code: 'AUTHORIZATION_CONTEXT_CHANGED' })
    expect(request).toHaveBeenCalledTimes(2); port.dispose()
  })
  it('aborted POST remains queryable, and late old acknowledgement cannot fill a replacement context', async () => {
    const gate = deferred(), entered = deferred()
    const port = enhancement(async (_url, init) => { if (init.method === 'POST') { entered.resolve(); return gate.promise } return fetchResult({ status: 'unknown', operationId: 'settings1' }) })
    const pending = port.requestSharingSettings(settingsInput()).catch(error => error)
    await entered.promise; port.reset('authorization-required')
    expect(await pending).toMatchObject({ operationId: 'settings1', status: 'unknown' })
    expect(await port.getSharingSettingsOperation()).toMatchObject({ operationId: 'settings1', status: 'unknown' })
    port.reset('identity-changed'); gate.resolve(fetchResult(settingsAck())); await Promise.resolve()
    expect(await port.getSharingSettingsOperation()).toBeNull(); port.dispose()
  })
  it.each(['scope', 'revision', 'value', 'document', 'hash'])('does not accept a malformed %s acknowledgement', async kind => {
    const data = settingsAck()
    if (kind === 'scope') data.supported = { ...data.supported, comment: ['readers', 'editors', 'managers'] }
    if (kind === 'revision') data.settingsRevision = '9007199254740995'
    if (kind === 'value') data.values = { ...data.values, copy: 'readers' }
    if (kind === 'document') data.docId = 'another'
    if (kind === 'hash') data.requestHash = 'not-a-hash'
    const port = enhancement(async () => fetchResult(data))
    await expect(port.requestSharingSettings(settingsInput())).rejects.toMatchObject({ operationId: 'settings1', status: 'unknown' })
    expect(await port.getSharingSettingsOperation()).toMatchObject({ operationId: 'settings1', status: 'unknown' }); port.dispose()
  })
  it('remote canCopy is a ninth explicit boolean; absent bits remain denied even with readable scopes', async () => {
    const missing = { ...full }; delete missing.canCopy
    const port = enhancement(async () => fetchResult({ scopes, capabilities: missing }))
    expect((await port.getCapabilities()).canCopy).toBe(false); port.dispose()
    const allowed = enhancement(async () => fetchResult({ scopes, capabilities: full }))
    expect((await allowed.getCapabilities()).canCopy).toBe(true); allowed.dispose()
    const legacy = enhancement(async () => fetchResult({ scopes }))
    expect((await legacy.getCapabilities()).canCopy).toBe(false); legacy.dispose()
  })
})

const mentionResolved = (extra = {}) => ({ status: 'resolved', tenantId: 'tenant', docId: 'doc', operationId: 'mention1',
  sourceEpoch: '9007199254740993', sourceSeq: '7', requestHash: MENTION_HASH,
  candidates: [{ principalId: 'bob', displayName: '真实 Bob', kind: 'user' }], persisted: true, notified: false, shared: false, replayed: false, ...extra })

describe('same identity share acknowledgement recovery', () => {
  it('refresh drops private data, aborts POST and allows only original GET; identity switch retires it', async () => {
    const gate = deferred(), entered = deferred()
    const request = vi.fn(async (_url, init) => { if (init.method === 'POST') { entered.resolve(); return gate.promise } return fetchResult({ status: 'committed', operationId: 'share1', requestHash: SHARE_HASH, result: shareResult() }) })
    const port = enhancement(request), pending = port.requestShare(shareInput()).catch(error => error)
    await entered.promise; port.reset('authorization-required')
    expect(await pending).toMatchObject({ status: 'unknown', operationId: 'share1' })
    expect(port.getShareOperation('share1')).toBeNull()
    expect(() => port.requestShare(shareInput())).toThrow('SHARE_QUERY_REQUIRED')
    expect(await port.queryShareOperation('share1')).toMatchObject({ status: 'committed', operationId: 'share1' })
    gate.resolve(fetchResult(shareResult())); await Promise.resolve()
    expect(request.mock.calls.map(call => call[1].method)).toEqual(['POST', 'GET'])
    port.reset('identity-changed'); expect(() => port.queryShareOperation('share1')).toThrow('AUTHORIZATION_CONTEXT_CHANGED')
    port.dispose()
  })
})

describe('current managed member snapshot', () => {
  const snapshot = () => ({ tenantId: 'tenant', docId: 'doc', authzVersion: '9007199254740993', members: [{ principalId: 'bob', scopes: ['document.read'],
    sources: [{ originType: 'share', sourceGrantKey: 'editor-share-one', sourceRevision: '999999999999999999', scopes: ['document.read'], revoked: false, sourceGap: false }] }] })
  it('reads current manager-only source revisions without turning them into editable roles or capabilities', async () => {
    const request = vi.fn(async () => fetchResult(snapshot())), port = enhancement(request)
    expect(await port.listMembers()).toEqual(snapshot())
    expect(request.mock.calls[0][0]).toMatch(/\/documents\/doc\/members$/)
    expect(request.mock.calls[0][1]).toMatchObject({ method: 'GET', credentials: 'include', cache: 'no-store' })
    port.dispose()
  })
  it.each(['tenant', 'duplicate', 'scope', 'source'])('rejects malformed %s projections', async kind => {
    const data = snapshot()
    if (kind === 'tenant') data.tenantId = 'other'
    if (kind === 'duplicate') data.members.push(data.members[0])
    if (kind === 'scope') data.members[0].scopes.push('superuser')
    if (kind === 'source') data.members[0].sources[0].sourceRevision = 12
    const port = enhancement(async () => fetchResult(data)); await expect(port.listMembers()).rejects.toMatchObject({ code: 'MEMBERS_RESULT_INVALID' }); port.dispose()
  })
  it('denies before I/O and aborts a late prior authorization snapshot', async () => {
    let allowed = false
    const gate = deferred(), entered = deferred(), request = vi.fn(async () => { entered.resolve(); return gate.promise })
    const port = enhancement(request, { getCapabilities: () => ({ ...full, canManagePermission: allowed }) })
    await expect(port.listMembers()).rejects.toBeInstanceOf(Error); expect(request).not.toHaveBeenCalled()
    allowed = true; const pending = port.listMembers().catch(error => error); await entered.promise; port.reset('identity-changed')
    expect(await pending).toMatchObject({ code: 'AUTHORIZATION_CONTEXT_CHANGED' }); gate.resolve(fetchResult(snapshot())); port.dispose()
  })
})

describe('Session authorization reset integration boundaries (E1)', () => {
  it.each(['user', 'permissions', 'dispose', 'replace'])('Session private reset authorization: %s removes actual mention/share metadata', async boundary => {
    let allowed = true, session
    const request = vi.fn(async url => url.endsWith('/capabilities') ? fetchResult({ scopes: allowed ? scopes : [] }) :
      fetchResult(url.includes('mention-resolution-operations') ? mentionResolved() : shareResult()))
    const port = enhancement(request, { getCapabilities: () => session?.getCapabilities() || full })
    session = createDocumentSession({ documentId: 'doc', user: { id: 'alice' }, authorization: port })
    try {
      await session._capabilitiesPromise
      await session.resolveMentions({ operationId: 'mention1', query: 'bob' }); await session.requestShare(shareInput())
      expect(port.getMentionOperation('mention1')).not.toBeNull(); expect(port.getShareOperation('share1')).not.toBeNull()
      if (boundary === 'user') session.user = { id: 'bob' }
      else if (boundary === 'permissions') { allowed = false; await session.refreshCapabilities() }
      else if (boundary === 'dispose') await session.dispose()
      else { session.setProvider('authorization', { async getCapabilities() { return full } }); await session._capabilitiesPromise }
      expect(port.getMentionOperation('mention1')).toBeNull(); expect(port.getShareOperation('share1')).toBeNull()
      if (boundary === 'permissions') { allowed = true; await session.refreshCapabilities(); expect(session.getMentionOperation('mention1')).toBeNull(); expect(session.getShareOperation('share1')).toBeNull() }
      const before = request.mock.calls.length
      for (const work of [() => port.resolveMentions({ operationId: 'mention1', query: 'bob' }), () => port.requestShare(shareInput())]) await expect(Promise.resolve().then(work)).rejects.toBeInstanceOf(Error)
      expect(request).toHaveBeenCalledTimes(before)
    } finally { await session.dispose(); port.dispose() }
  })
})
function remoteMentionVm(query = async () => mentionResolved({ replayed: true })) {
  const chain = { focus: vi.fn(), deleteRange: vi.fn(), setMention: vi.fn(), run: vi.fn(() => true) }
  for (const method of ['focus', 'deleteRange', 'setMention']) chain[method].mockReturnValue(chain)
  const editor = { isFocused: true, state: { doc: {}, selection: { from: 4, to: 4 } },
    view: { hasFocus: () => editor.isFocused }, chain: vi.fn(() => chain) }
  const authorization = { isRemote: true, resolveMentions: vi.fn() }
  const session = { can: vi.fn(() => true), getProvider: vi.fn(() => authorization),
    resolveMentions: vi.fn(async () => mentionResolved()), queryMentionResolution: vi.fn(query) }
  const vm = { ...mentionMixin.data(), ...mentionMixin.methods, mentionRemote: true, _mentionToken: 0, mentionOpen: true,
    mentionQuery: 'bob', mentionRange: { from: 1, to: 4 }, mentionItems: [{ id: 'bob', name: '真实 Bob', kind: 'user' }],
    mentionRequestState: mentionResolved(), mentionNotify: false, session, editor, writable: () => true,
    $nextTick: callback => callback(), positionMentionPanel: vi.fn() }
  return { vm, chain, authorization }
}

describe('T101 真实目录resolved接线（注入HTTP/UI，不是公司目录或通知验收）', () => {
  it('T101 resolved严格DTO作为持久候选返回，选择不代表通知或分享', async () => {
    const request = vi.fn(async () => fetchResult(mentionResolved())), provider = enhancement(request)
    expect(await provider.resolveMentions({ operationId: 'mention1', query: 'bob' })).toEqual(mentionResolved())
    expect(provider.getMentionOperation('mention1')).toMatchObject({ status: 'resolved', requestHash: MENTION_HASH })
    await provider.resolveMentions({ operationId: 'mention1', query: 'bob' })
    expect(request.mock.calls.map(([, init]) => init.method)).toEqual(['POST', 'GET'])
  })

  it('T101 remote resolved面板只展示真实user候选而不回落示例', async () => {
    const { vm } = remoteMentionVm()
    vm._mentionProvider = { search: vi.fn() }
    vm.refreshMentionItems(); await Promise.resolve(); await Promise.resolve()
    expect(vm.mentionItems).toEqual([{ id: 'bob', name: '真实 Bob', kind: 'user' }])
    expect(vm._mentionProvider.search).not.toHaveBeenCalled()
    expect(vm.mentionMessage).toMatch(/未发送通知/)
  })

  it('T101 remote选择先QUERY原解析，确认前零插入且不使用传入假name或抢焦点', async () => {
    const gate = deferred(), { vm, chain } = remoteMentionVm(() => gate.promise)
    const pending = vm.chooseMention({ id: 'bob', name: '伪造显示名', kind: 'page' })
    try {
      expect(vm.session.queryMentionResolution).toHaveBeenCalledWith('mention1')
      expect(vm.editor.chain).not.toHaveBeenCalled()
    } finally { gate.resolve(mentionResolved({ replayed: true })) }
    await pending
    expect(chain.setMention).toHaveBeenCalledWith(expect.objectContaining({ id: 'bob', name: '真实 Bob', kind: 'user', notify: false }))
    expect(chain.deleteRange).toHaveBeenCalledWith({ from: 1, to: 4 })
    expect(chain.focus).not.toHaveBeenCalled()
  })

  it.each([
    { tenantId: 'other' }, { docId: 'other' }, { operationId: 'other' }, { sourceEpoch: '1' }, { sourceSeq: '8' },
    { requestHash: 'invalid' }, { requestHash: MENTION_HASH + '\n' }, { persisted: false }, { notified: true }, { shared: true },
    { replayed: 'true' }, { taskId: null }, { candidates: null },
    { candidates: [{ principalId: 'bob', displayName: 'Bob', kind: 'page' }] },
    { candidates: [{ principalId: 'bad id', displayName: 'Bob', kind: 'user' }] },
    { candidates: [{ principalId: 'bob', displayName: '', kind: 'user' }] },
    { candidates: [{ principalId: 'bob', displayName: 'a'.repeat(65), kind: 'user' }] },
    { candidates: [{ principalId: 'bob', displayName: 'Bob\n', kind: 'user' }] },
    { candidates: [{ principalId: 'bob', displayName: 'Bob', kind: 'user', email: 'private' }] },
    { candidates: Array.from({ length: 2 }, () => ({ principalId: 'bob', displayName: 'Bob', kind: 'user' })) },
    { candidates: Array.from({ length: 101 }, (_, i) => ({ principalId: `user-${i}`, displayName: 'Bob', kind: 'user' })) },
  ])('T101 scope/hash/候选形态错误不成为成功 %j', async invalid => {
    const provider = enhancement(async () => fetchResult(mentionResolved(invalid)))
    await expect(provider.resolveMentions({ operationId: 'mention1', query: 'bob' })).rejects.toMatchObject({ code: 'MENTION_RESULT_UNKNOWN', status: 'unknown' })
    expect(provider.getMentionOperation('mention1')).not.toHaveProperty('candidates')
  })

  it('T101 空候选和100条规范候选合法，未声明通知或分享成功', async () => {
    for (const count of [0, 100]) {
      const candidates = Array.from({ length: count }, (_, i) => ({ principalId: `user-${i}`, displayName: '当前人员', kind: 'user' }))
      const result = await enhancement(async () => fetchResult(mentionResolved({ candidates }))).resolveMentions({ operationId: 'mention1', query: 'bob' })
      expect(result.candidates).toHaveLength(count); expect(result).toMatchObject({ notified: false, shared: false })
    }
  })

  it('T101 unknown不能覆盖已确认hash，修改导出副本不影响后续原键GET', async () => {
    const unknown = { status: 'unknown', code: 'COMMIT_UNKNOWN', operationId: 'mention1', sourceEpoch: readySource().epoch, sourceSeq: '7' }
    const request = vi.fn().mockResolvedValueOnce(fetchResult(mentionResolved()))
      .mockResolvedValueOnce(fetchResult({ ...unknown, requestHash: SHARE_HASH }, 503))
      .mockResolvedValueOnce(fetchResult(unknown, 503)).mockResolvedValueOnce(fetchResult(mentionResolved({ replayed: true })))
    const provider = enhancement(request)
    await provider.resolveMentions({ operationId: 'mention1', query: 'bob' })
    provider.getMentionOperation('mention1').requestHash = SHARE_HASH
    for (let i = 0; i < 2; i++) {
      await expect(provider.queryMentionResolution('mention1')).rejects.toMatchObject({ status: 'unknown' })
      expect(provider.getMentionOperation('mention1').requestHash).toBe(MENTION_HASH)
    }
    expect(await provider.resolveMentions({ operationId: 'mention1', query: 'bob' })).toMatchObject({ requestHash: MENTION_HASH, replayed: true })
    expect(request.mock.calls.map(([, init]) => init.method)).toEqual(['POST', 'GET', 'GET', 'GET'])
  })

  it.each(['permission', 'epoch', 'seq', 'pending'])('T101 fetch后%s改变拒绝resolved且不保存候选hash', async change => {
    let flags = full, state = readySource()
    const gate = deferred(), provider = enhancement(() => gate.promise, { getCapabilities: () => flags, getState: () => state })
    const pending = provider.resolveMentions({ operationId: 'mention1', query: 'bob' })
    if (change === 'permission') flags = DENIED_CAPABILITIES
    if (change === 'epoch') state = { ...state, epoch: '2' }
    if (change === 'seq') state = { ...state, lastSeq: '8' }
    if (change === 'pending') state = { ...state, pending: [{ updateId: 'unconfirmed' }] }
    gate.resolve(fetchResult(mentionResolved()))
    await expect(pending).rejects.toMatchObject({ status: 'rejected' })
    expect(provider.getMentionOperation('mention1').requestHash).toBeNull()
  })

  it.each(['close', 'range', 'selection', 'doc', 'focus', 'readonly', 'write', 'permission', 'provider', 'session', 'destroy'])('T101 QUERY期间%s改变不插入不抢focus', async change => {
    const gate = deferred(), { vm, chain } = remoteMentionVm(() => gate.promise)
    const pending = vm.chooseMention({ id: 'bob' })
    expect(vm.session.queryMentionResolution).toHaveBeenCalledTimes(1)
    expect(vm.editor.chain).not.toHaveBeenCalled()
    if (change === 'close') vm.closeMentionPanel()
    if (change === 'range') vm.mentionRange.from++
    if (change === 'selection') vm.editor.state.selection = { from: 3, to: 3 }
    if (change === 'doc') vm.editor.state.doc = {}
    if (change === 'focus') vm.editor.isFocused = false
    if (change === 'readonly') vm.effectiveReadonly = true
    if (change === 'write') vm.writable = () => false
    if (change === 'permission') vm.session.can = () => false
    if (change === 'provider') vm.session.getProvider = () => ({ isRemote: true })
    if (change === 'session') vm.session = { ...vm.session }
    if (change === 'destroy') mentionMixin.beforeDestroy.call(vm)
    gate.resolve(mentionResolved({ replayed: true })); await pending
    expect(chain.run).not.toHaveBeenCalled(); expect(chain.focus).not.toHaveBeenCalled()
    expect(vm.mentionItems).toEqual([])
  })

  it('T101 任意item不发QUERY，等待期间调用方不能替换已选择principal', async () => {
    const gate = deferred(), { vm, chain } = remoteMentionVm(() => gate.promise)
    await vm.chooseMention({ id: 'invented' })
    expect(vm.session.queryMentionResolution).not.toHaveBeenCalled()
    const item = { id: 'bob' }, pending = vm.chooseMention(item); item.id = 'alice'
    gate.resolve(mentionResolved({ candidates: [...mentionResolved().candidates, { principalId: 'alice', displayName: 'Alice', kind: 'user' }] }))
    await pending
    expect(chain.setMention).toHaveBeenCalledWith(expect.objectContaining({ id: 'bob', name: '真实 Bob', notify: false }))
  })

  it.each([{ candidates: [] }, { requestHash: SHARE_HASH }, { sourceSeq: '8' }, { docId: 'other' }, { status: 'blocked' }])('T101 当前QUERY不再匹配时零插入 %j', async invalid => {
    const { vm, chain } = remoteMentionVm(async () => mentionResolved(invalid))
    await vm.chooseMention({ id: 'bob' })
    expect(chain.run).not.toHaveBeenCalled(); expect(vm.mentionItems).toEqual([])
  })

  it('T101 选择复核unknown可原QUERY恢复候选，不重新resolve或报通知成功', async () => {
    const { vm, chain } = remoteMentionVm()
    vm.session.queryMentionResolution.mockRejectedValueOnce(Object.assign(new Error('lost'), { status: 'unknown' }))
    await vm.chooseMention({ id: 'bob' })
    expect(chain.run).not.toHaveBeenCalled(); expect(vm.mentionPendingOperation).toBe('mention1')
    await vm.queryPendingMention()
    expect(vm.mentionItems).toEqual([{ id: 'bob', name: '真实 Bob', kind: 'user' }])
    expect(vm.session.resolveMentions).not.toHaveBeenCalled()
    expect(vm.mentionMessage).toMatch(/未发送通知/)
  })

  it('T101 capability事件和readonly变化清掉远端候选；本地选择保留旧focus与notify行为', () => {
    const { vm } = remoteMentionVm(); let invalidate
    const stop = vi.fn(); vm.session.on = vi.fn((event, callback) => { invalidate = callback; return stop })
    mentionMixin.mounted.call(vm); invalidate()
    expect(vm.mentionItems).toEqual([]); expect(vm.mentionOpen).toBe(false)
    mentionMixin.beforeDestroy.call(vm); expect(stop).toHaveBeenCalledOnce()
    const local = remoteMentionVm(); local.vm.mentionRemote = false; local.vm.mentionNotify = true
    local.vm.chooseMention({ id: 'local', name: '本地人员', kind: 'user' })
    expect(local.chain.focus).toHaveBeenCalledOnce()
    expect(local.chain.setMention).toHaveBeenCalledWith(expect.objectContaining({ id: 'local', notify: true }))
    expect(local.vm.session.queryMentionResolution).not.toHaveBeenCalled()
  })
})

describe('C02 真实 HTTP authorization adapter（注入fetch行为，非PG/WS）', () => {
  it('固定文档GET使用Cookie和no-store，不发送actor、服务票据或CSRF', async () => {
    const request = vi.fn(async () => fetchResult({ scopes, authzVersion: '1' }))
    const provider = createHttpAuthorizationProvider({ baseUrl: 'http://localhost:33011/', tenantId: 'tenant/a', docId: 'doc:one', request })
    expect(await provider.getCapabilities({ tenantId: 'other', docId: 'other', actor: 'forged' })).toEqual({ ...full, canCopy: false })
    const [url, init] = request.mock.calls[0]
    expect(url).toBe('http://localhost:33011/editor/v1/tenants/tenant%2Fa/documents/doc%3Aone/capabilities')
    expect(init).toMatchObject({ method: 'GET', credentials: 'include', cache: 'no-store', redirect: 'error', headers: { Accept: 'application/json' } })
    expect(init.body).toBeUndefined()
    expect(init.signal.aborted).toBe(false)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('scopes映射必须先可见文档，管理员和未知scope没有private豁免', async () => {
    const provider = httpProvider(async () => fetchResult({ scopes: ['grant.manage', 'comment.write', 'version.restore', 'everything'] }))
    expect(await provider.getCapabilities()).toEqual(DENIED_CAPABILITIES)
    const readOnly = await httpProvider(async () => fetchResult({ scopes: ['document.read', 'comment.write', 'version.restore', 'document.export'] })).getCapabilities()
    expect(readOnly).toMatchObject({ canView: true, canEdit: false, canComment: true, canResolveComment: false, canRestoreVersion: false, canExport: true })
  })

  it('显式capabilities不能越过实际scope；缺项、非boolean与缺scopes全关闭', async () => {
    const actual = await httpProvider(async () => fetchResult({ scopes: ['document.read'], capabilities: { ...full, canView: true, canExport: 'yes' }, canOwnEverything: true })).getCapabilities()
    expect(actual).toEqual({ ...DENIED_CAPABILITIES, canView: true, canCopy: true })
    expect(Object.keys(actual)).toEqual(Object.keys(DEFAULT_CAPABILITIES))
    expect(await httpProvider(async () => fetchResult({ scopes, capabilities: { canEdit: true } })).getCapabilities()).toEqual(DENIED_CAPABILITIES)
    expect(await httpProvider(async () => fetchResult({ capabilities: full })).getCapabilities()).toEqual(DENIED_CAPABILITIES)
  })

  it('非2xx有稳定code/status；unknown和错误JSON拒绝，不宽松回退', async () => {
    await expect(httpProvider(async () => fetchResult({ code: 'DEPENDENCY_BLOCKED' }, 503)).getCapabilities()).rejects.toMatchObject({ code: 'DEPENDENCY_BLOCKED', status: 503 })
    await expect(httpProvider(async () => fetchResult({ scopes, status: 'unknown' })).getCapabilities()).rejects.toMatchObject({ code: 'AUTHORIZATION_UNKNOWN' })
    await expect(httpProvider(async () => ({ status: 403, json: async () => { throw new Error('not json') } })).getCapabilities()).rejects.toMatchObject({ code: 'AUTHORIZATION_REQUEST_FAILED', status: 403 })
  })

  it.each(['request', 'json'])('15秒总deadline覆盖%s，不隐藏重试并清timer', async phase => {
    vi.useFakeTimers()
    try {
      let signal
      const request = vi.fn((url, init) => {
        signal = init.signal
        return phase === 'request' ? new Promise(() => {}) : Promise.resolve({ status: 200, json: () => new Promise(() => {}) })
      })
      const assertion = expect(httpProvider(request).getCapabilities()).rejects.toMatchObject({ code: 'AUTHORIZATION_TIMEOUT' })
      await vi.advanceTimersByTimeAsync(15000)
      await assertion
      expect(signal.aborted).toBe(true)
      expect(request).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })

  it('协作票据POST只传请求scope和协议，使用当前CSRF，不携带幂等键或actor', async () => {
    let csrf = 'csrf-1'
    const request = vi.fn(async () => fetchResult(ticket(), 201))
    const provider = createHttpAuthorizationProvider({ tenantId: 'tenant', docId: 'doc', csrfToken: () => csrf, request })
    const issued = await provider.issueCollaborationTicket({ requestedScopes: ['document.read'], actor: 'forged', owner: 'forged' })
    expect(issued).toEqual(ticket())
    const [url, init] = request.mock.calls[0]
    expect(url).toBe('/editor/v1/tenants/tenant/documents/doc/collaboration-tickets')
    expect(JSON.parse(init.body)).toEqual({ requestedScopes: ['document.read'], protocolVersion: 'editor-crdt-v1' })
    expect(init.headers['X-CSRF-Token']).toBe('csrf-1')
    expect(init.headers['Idempotency-Key']).toBeUndefined()
    csrf = 'csrf-2'
    await provider.issueCollaborationTicket({ requestedScopes: ['document.read'] })
    expect(request.mock.calls[1][1].headers['X-CSRF-Token']).toBe('csrf-2')
  })

  it.each([
    { tenantId: 'another' }, { docId: 'another' }, { protocolVersion: 'unknown' }, { scopes: ['document.write'] },
    { scopes: ['unknown.scope'] }, { expiresAt: 'invalid' }, { epoch: 1 }, { authzVersion: '01' },
  ])('拒绝不匹配/无效票据字段%j', async invalid => {
    const provider = createHttpAuthorizationProvider({ tenantId: 'tenant', docId: 'doc', csrfToken: 'csrf', request: async () => fetchResult({ ...ticket(), ...invalid }, 201) })
    await expect(provider.issueCollaborationTicket({ requestedScopes: ['document.read'] })).rejects.toMatchObject({ code: 'AUTHORIZATION_INVALID_TICKET' })
  })
})

describe('DocumentSession 远端授权生命周期', () => {
  it('本地无授权保留原默认；远端loading全关闭，缺失和未知能力不能开放', async () => {
    expect(createDocumentSession().getCapabilities()).toEqual(DEFAULT_CAPABILITIES)
    const load = deferred()
    const s = createSession({ getCapabilities: () => load.promise })
    expect(s.getCapabilities()).toEqual(DENIED_CAPABILITIES)
    expect(s.can('unknownCapability')).toBe(false)
    load.resolve({ canView: true, canEdit: true, canExport: 'true', invented: true })
    await s._capabilitiesPromise
    expect(s.getCapabilities()).toEqual({ ...DENIED_CAPABILITIES, canView: true, canEdit: true })
  })

  it('刷新失败不保留旧权限，错误promise可catch且广播关闭能力和error', async () => {
    const getCapabilities = vi.fn().mockResolvedValueOnce(full).mockRejectedValueOnce(new Error('service unavailable'))
    const s = createSession({ getCapabilities })
    await s._capabilitiesPromise
    expect(s.can('canEdit')).toBe(true)
    const capabilities = vi.fn(), error = vi.fn()
    s.on('capabilities', capabilities); s.on('error', error)
    const refresh = s.refreshCapabilities()
    expect(s.getCapabilities()).toEqual(DENIED_CAPABILITIES)
    await expect(refresh).rejects.toThrow('service unavailable')
    expect(s.getCapabilities()).toEqual(DENIED_CAPABILITIES)
    expect(capabilities).toHaveBeenLastCalledWith(DENIED_CAPABILITIES)
    expect(error).toHaveBeenCalledTimes(1)
  })

  it.each([{ status: 'unknown', ...full }, { revoked: true, ...full }])('unknown/revoked返回不能保留旧能力', async value => {
    const getCapabilities = vi.fn().mockResolvedValueOnce(full).mockResolvedValueOnce(value)
    const s = createSession({ getCapabilities })
    await s._capabilitiesPromise
    await expect(s.refreshCapabilities()).rejects.toThrow('AUTHORIZATION_UNKNOWN')
    expect(s.getCapabilities()).toEqual(DENIED_CAPABILITIES)
  })

  it('并发刷新只允许最后一次返回生效，晚到的旧allow不能恢复写权限', async () => {
    const older = deferred(), newer = deferred()
    const getCapabilities = vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
    const s = createSession({ getCapabilities })
    const initial = s._capabilitiesPromise
    const refresh = s.refreshCapabilities()
    newer.resolve({ canView: true, canEdit: false })
    await refresh
    older.resolve(full)
    await initial
    expect(s.getCapabilities()).toEqual({ ...DENIED_CAPABILITIES, canView: true })
  })

  it.each(['resolve', 'reject'])('替换provider后旧请求%s不写状态或发旧回调', async completion => {
    const older = deferred()
    const s = createSession({ getCapabilities: () => older.promise })
    const initial = s._capabilitiesPromise
    s.setProvider('authorization', { getCapabilities: async () => ({ canView: true }) })
    await s._capabilitiesPromise
    const capabilities = vi.fn(), error = vi.fn()
    s.on('capabilities', capabilities); s.on('error', error)
    older[completion](completion === 'resolve' ? full : new Error('stale failure'))
    await initial
    expect(s.getCapabilities()).toEqual({ ...DENIED_CAPABILITIES, canView: true })
    expect(capabilities).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  it('移除provider使原请求失效，不静默恢复本地全开默认', async () => {
    const pending = deferred()
    const s = createSession({ getCapabilities: () => pending.promise })
    const initial = s._capabilitiesPromise
    s.setProvider('authorization', null)
    pending.resolve(full)
    await initial
    expect(s.getCapabilities()).toEqual(DENIED_CAPABILITIES)
  })

  it('dispose后的授权返回不写状态或发callbacks', async () => {
    const pending = deferred()
    const s = createSession({ getCapabilities: () => pending.promise })
    const initial = s._capabilitiesPromise
    const capabilities = vi.fn(), error = vi.fn()
    s.on('capabilities', capabilities); s.on('error', error)
    const before = s.getCapabilities()
    await s.dispose()
    pending.resolve(full)
    await initial
    expect(s.getCapabilities()).toEqual(before)
    expect(s.can('canView')).toBe(false)
    expect(capabilities).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })
})

describe('US11真实目录阻塞与share薄入口（E1注入端口，非公司目录/PG验收）', () => {
  it('目录合法503保留blocked事实，body只原source/query/op，不造通知或任务', async () => {
    const request = vi.fn(async () => fetchResult(mentionBlocked(), 503))
    const provider = enhancement(request)
    const result = await provider.resolveMentions({ operationId: 'mention1', query: ' 张三 ', actor: 'root', tenantId: 'forged' })
    expect(result).toEqual(mentionBlocked())
    const [url, init] = request.mock.calls[0]
    expect(url).toBe('/editor/v1/tenants/tenant/documents/doc/mention-resolution-operations')
    expect(init).toMatchObject({ method: 'POST', credentials: 'include', cache: 'no-store', headers: { 'X-CSRF-Token': 'csrf' } })
    expect(JSON.parse(init.body)).toEqual({ operationId: 'mention1', sourceEpoch: '9007199254740993', sourceSeq: '7', query: ' 张三 ' })
    expect(provider.getMentionOperation('mention1').status).toBe('blocked')
  })

  it('目录未知只GET原键，异query/source网络前拒，GET不称持久任务回执', async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce(fetchResult(mentionBlocked(), 503))
    const provider = enhancement(request)
    await expect(provider.resolveMentions({ operationId: 'mention1', query: '' })).rejects.toMatchObject({ status: 'unknown', operationId: 'mention1' })
    expect(() => provider.resolveMentions({ operationId: 'mention1', query: 'changed' })).toThrow('IDEMPOTENCY_MISMATCH')
    expect(() => provider.queryMentionResolution({ operationId: 'mention1', sourceSeq: '8' })).toThrow('IDEMPOTENCY_MISMATCH')
    expect(request).toHaveBeenCalledTimes(1)
    expect(await provider.queryMentionResolution('mention1')).toMatchObject({ status: 'blocked', persisted: false, taskId: null, notified: false, shared: false })
    const [url, init] = request.mock.calls[1]
    expect(init.method).toBe('GET')
    const params = new URL(`https://local.invalid${url}`).searchParams
    expect(params.get('query')).toBe('')
    expect(params.get('sourceEpoch')).toBe('9007199254740993')
    expect(request.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1)
  })

  it.each([
    fetchResult({ status: 'completed', targets: [{ id: 'fake', name: 'Invented Person' }] }),
    fetchResult(mentionBlocked({ persisted: true }), 503), fetchResult(mentionBlocked({ notified: true }), 503),
    fetchResult(mentionBlocked({ shared: true }), 503), fetchResult(mentionBlocked({ sourceEpoch: 'old' }), 503),
  ])('意外目录成功或畸形blocked不能提升为真实候选 %j', async incoming => {
    const provider = enhancement(async () => incoming)
    await expect(provider.resolveMentions({ operationId: 'mention1', query: '' })).rejects.toMatchObject({ status: 'unknown' })
    expect(JSON.stringify(provider.getMentionOperation('mention1'))).not.toMatch(/Invented Person|targets/)
  })

  it('恢复/来源推进使晚到blocked失效，原source记录不可自动改写', async () => {
    let state = readySource()
    const reply = deferred()
    const provider = enhancement(() => reply.promise, { getState: () => state })
    const pending = provider.resolveMentions({ operationId: 'mention1', query: 'A' })
    state = { ...readySource(), epoch: '9007199254740994' }
    reply.resolve(fetchResult(mentionBlocked(), 503))
    await expect(pending).rejects.toMatchObject({ code: 'MENTION_SOURCE_CONFLICT', status: 'rejected' })
    expect(provider.getMentionOperation('mention1').body.sourceEpoch).toBe('9007199254740993')
  })

  it('远端@绝不回落host示例人物，也不能直接选择假chip；本地模式不受影响', async () => {
    const search = vi.fn(async () => [{ id: 'fake', name: 'Example User' }]), chain = vi.fn()
    const vm = { ...mentionMixin.data(), ...mentionMixin.methods, mentionRemote: true, _mentionToken: 0, mentionOpen: true,
      mentionDirectory: [{ id: 'fake', name: 'Example User' }], _mentionProvider: { search },
      session: { can: () => true, resolveMentions: vi.fn(async () => mentionBlocked()) }, editor: { chain },
      $nextTick: () => {}, positionMentionPanel: () => {} }
    vm.refreshMentionItems(); await Promise.resolve(); await Promise.resolve()
    expect(vm.session.resolveMentions).toHaveBeenCalledWith({ query: '' })
    expect(search).not.toHaveBeenCalled()
    expect(vm.mentionItems).toEqual([])
    vm.chooseMention({ id: 'fake', name: 'Example User' })
    expect(chain).not.toHaveBeenCalled()
    expect(vm.mentionMessage).toMatch(/尚未验证真实提及目标/)
  })

  it('share强制独立share来源，忽略actor/private字段且只原CAS提交', async () => {
    const request = vi.fn(async () => fetchResult(shareResult()))
    const provider = enhancement(request)
    expect(await provider.requestShare({ ...shareInput(), actor: 'root', participants: ['fake-private'], originType: 'share' })).toEqual(shareResult())
    expect(request.mock.calls[0][0]).toBe('/editor/v1/tenants/tenant/documents/doc/share-operations')
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ ...shareInput(), originType: 'share', revoked: false })
    expect(() => provider.requestShare({ ...shareInput(), originType: 'binding' })).toThrow('SHARE_ORIGIN_INVALID')
    expect(() => provider.requestShare({ ...shareInput(), resync: true })).toThrow('SHARE_INPUT_INVALID')
    expect(() => provider.requestShare({ ...shareInput(), subject: 'different' })).toThrow('IDEMPOTENCY_MISMATCH')
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('分享未知查原permission操作；SOURCE_GAP是阻塞，不当授权成功', async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce(fetchResult({ status: 'committed', operationId: 'share1', requestHash: SHARE_HASH, result: shareResult() }))
    const provider = enhancement(request)
    await expect(provider.requestShare(shareInput())).rejects.toMatchObject({ status: 'unknown', operationId: 'share1' })
    expect(await provider.queryShareOperation('share1')).toMatchObject({ status: 'committed', originType: 'share' })
    expect(request.mock.calls[1][0]).toBe('/editor/v1/tenants/tenant/operations/share1?commandType=permission')
    expect(request.mock.calls[1][1].method).toBe('GET')
    const gap = enhancement(async () => fetchResult(shareResult({ status: 'blocked', code: 'SOURCE_GAP', sourceGap: true, sourceRevision: '0', observedRevision: '3' }), 503))
    expect(await gap.requestShare({ ...shareInput(), sourceRevision: '3' })).toMatchObject({ status: 'blocked', sourceGap: true })
    expect(gap.getShareOperation('share1').status).toBe('blocked')
  })

  it.each([{ subject: 'other' }, { originType: 'direct' }, { authzVersion: '4' }, { sourceRevision: '9' }])('不匹配分享receipt不可确认 %j', async invalid => {
    const provider = enhancement(async () => fetchResult(shareResult(invalid)))
    await expect(provider.requestShare(shareInput())).rejects.toMatchObject({ status: 'unknown' })
  })

  it('远端本地权限/密码控件不冒服务器设置成功，复制链接需当前复权和规范路由', async () => {
    const vm = { ...shareMixin.data(), ...shareMixin.methods, shareRemote: true, showShareToast: vi.fn(), shareCan: () => true }
    const before = vm.permissionValues.comment
    vm.setPermissionValue('comment', 'everyone'); vm.applySecureLink(true)
    expect(vm.permissionValues.comment).toBe(before)
    expect(vm.secureLinkEnabled).toBe(false)
    expect(vm.showShareToast).toHaveBeenCalledWith('warning', expect.stringMatching(/未作更改/))
    const request = vi.fn(async () => fetchResult({ scopes }))
    const provider = enhancement(request)
    const link = new URL(await provider.getShareLink())
    expect(link.search).toBe('')
    expect(new URLSearchParams(link.hash.slice(1)).get('docId')).toBe('doc')
    expect(request.mock.calls[0][0]).toMatch(/\/capabilities$/)
    await expect(enhancement(request, { documentUrl: 'https://app.example/view?docId=doc&ticket=secret' }).getShareLink()).rejects.toMatchObject({ code: 'SHARE_DOCUMENT_URL_REQUIRED' })
  })
})


// 用户notify只是正文意图；目录QUERY的notified:false仍必须成立，不代表C09已送达。
describe('T101/C09 remote提及通知意图接续（E1）', () => {
  it.each([true, false])('用户notify=%s捕获后写入真实mention attrs，不向目录QUERY伪造通知成功', async notify => {
    const gate = deferred(), { vm, chain } = remoteMentionVm(() => gate.promise)
    vm.setMentionNotify(notify)
    const pending = vm.chooseMention({ id: 'bob' })
    expect(chain.run).not.toHaveBeenCalled()
    expect(vm.session.queryMentionResolution).toHaveBeenCalledWith('mention1')
    gate.resolve(mentionResolved({ replayed: true })); await pending
    expect(chain.setMention).toHaveBeenCalledWith(expect.objectContaining({ id: 'bob', notify }))
    expect(chain.focus).not.toHaveBeenCalled()
    expect(vm.mentionMessage).not.toMatch(/已发送|已送达|已分享/)
    expect(vm.mentionMessage).toMatch(notify ? /等待正文确认与通知处理/ : /未请求通知/)
  })
  it.each(['notify', 'identity'])('QUERY等待时%s变更不插入旧意图，也不由晚unknown恢复旧UI', async change => {
    for (const outcome of ['blocked', 'unknown']) {
      const gate = deferred(), { vm, chain } = remoteMentionVm(() => gate.promise)
      vm.session.user = { id: 'alice' }; vm.setMentionNotify(true)
      const pending = vm.chooseMention({ id: 'bob' })
      if (change === 'notify') vm.setMentionNotify(false)
      else vm.session.user = { id: 'carol' }
      vm.mentionMessage = 'current intent'
      if (outcome === 'blocked') gate.resolve(mentionResolved({ status: 'blocked' }))
      else gate.reject(Object.assign(new Error('lost'), { status: 'unknown' }))
      await pending
      expect(chain.run).not.toHaveBeenCalled(); expect(vm.mentionPendingOperation).toBe('')
      expect(vm.mentionMessage).toBe('current intent')
    }
  })
  it('目录blocked无候选，即使勾选通知仍不能插入或声称送达', async () => {
    const { vm, chain } = remoteMentionVm()
    vm.setMentionNotify(true); vm.applyRemoteMentionResult(mentionBlocked())
    await vm.chooseMention({ id: 'bob' })
    expect(chain.run).not.toHaveBeenCalled(); expect(vm.session.queryMentionResolution).not.toHaveBeenCalled()
    expect(vm.mentionMessage).not.toMatch(/已发送|已送达/)
  })
  it('原键重查候选不覆盖已勾选notify，本地默认行为仍独立', async () => {
    const { vm } = remoteMentionVm()
    vm.setMentionNotify(true); vm.applyRemoteMentionResult(mentionResolved())
    expect(vm.mentionNotify).toBe(true)
    expect(vm.mentionRequestState).toMatchObject({ notified: false, shared: false })
    expect(mentionMixin.data().mentionNotify).toBe(true)
  })
})


describe('T101候选读取跨身份晚回隔离', () => {
  it.each(['refresh', 'query'])('%s晚resolved/unknown不能显示上一身份候选或pending', async path => {
    for (const outcome of ['resolved', 'unknown']) {
      const gate = deferred(), { vm } = remoteMentionVm(() => gate.promise)
      vm.session.user = { id: 'alice' }
      vm.session.resolveMentions = () => gate.promise
      let pending
      if (path === 'query') { vm.mentionPendingOperation = 'mention1'; pending = vm.queryPendingMention() }
      else vm.refreshMentionItems()
      vm.session.user = { id: 'bob' }; vm.mentionMessage = 'current view'
      if (outcome === 'resolved') gate.resolve(mentionResolved())
      else gate.reject(Object.assign(new Error('lost'), { status: 'unknown', operationId: 'mention1' }))
      await pending; await Promise.resolve(); await Promise.resolve()
      expect(vm.mentionItems).toEqual([]); expect(vm.mentionRequestState).toBeNull()
      expect(vm.mentionMessage).toBe('current view')
      expect(vm.mentionPendingOperation).toBe(path === 'query' ? 'mention1' : '')
    }
  })
  it('Vue身份watch清已有候选/原键并关闭面板，不影响同id刷新', () => {
    const { vm } = remoteMentionVm()
    vm.mentionPendingOperation = 'mention1'
    mentionMixin.watch['session.user.id'].call(vm, 'alice', 'alice')
    expect(vm.mentionOpen).toBe(true)
    mentionMixin.watch['session.user.id'].call(vm, 'bob', 'alice')
    expect(vm.mentionOpen).toBe(false); expect(vm.mentionItems).toEqual([])
    expect(vm.mentionPendingOperation).toBe(''); expect(vm.mentionRequestState).toBeNull()
  })
})


// E1 lifecycle isolation, not real IdP/service acceptance.
describe('HTTP authorization private context reset', () => {
  const observe = promise => promise.then(value => ({ value }), error => ({ error }))
  it('reset synchronously removes mention/share metadata and retired IDs never POST again', async () => {
    const request = vi.fn(async url => url.includes('mention-resolution') ? fetchResult(mentionResolved()) : fetchResult(shareResult()))
    const port = enhancement(request)
    await port.resolveMentions({ operationId: 'mention1', query: 'private directory query' }); await port.requestShare(shareInput())
    expect(port.getMentionOperation('mention1')).not.toBeNull(); expect(port.getShareOperation('share1')).not.toBeNull()
    port.reset('identity-changed'); expect(port.getMentionOperation('mention1')).toBeNull(); expect(port.getShareOperation('share1')).toBeNull()
    for (const work of [() => port.resolveMentions({ operationId: 'mention1', query: 'private directory query' }), () => port.requestShare(shareInput()),
      () => port.queryMentionResolution('mention1'), () => port.queryShareOperation('share1')]) {
      await expect(Promise.resolve().then(work)).rejects.toMatchObject({ code: 'AUTHORIZATION_CONTEXT_CHANGED' })
    }
    expect(request).toHaveBeenCalledTimes(2); port.dispose()
  })
  it.each(['capabilities', 'ticket', 'mention', 'share'])('reset aborts in-flight %s and rejects an old result without resurrecting permission data', async kind => {
    for (const phase of ['response', 'json']) {
      const waiting = deferred(), entered = deferred(); let signal
      const request = vi.fn(async (_url, init) => { signal = init.signal; entered.resolve(); return phase === 'response' ? waiting.promise : { status: 200, json: () => waiting.promise } })
      const port = enhancement(request)
      const work = () => kind === 'capabilities' ? port.getCapabilities() : kind === 'ticket' ? port.issueCollaborationTicket({ requestedScopes: ['document.read'] })
        : kind === 'mention' ? port.resolveMentions({ operationId: 'mention1', query: 'private query' }) : port.requestShare(shareInput())
      const pending = observe(work()); await entered.promise; if (phase === 'json') await Promise.resolve()
      port.reset(); expect(signal.aborted).toBe(true)
      const outcome = await pending; expect(outcome.value).toBeUndefined(); expect(outcome.error).toMatchObject({ code: 'AUTHORIZATION_CONTEXT_CHANGED' })
      expect(JSON.stringify(outcome.error)).not.toContain('synthetic-opaque-ticket')
      const value = kind === 'ticket' ? ticket() : kind === 'capabilities' ? { scopes, capabilities: full } : kind === 'mention' ? mentionResolved() : shareResult()
      waiting.resolve(phase === 'response' ? fetchResult(value) : value); await Promise.resolve(); await Promise.resolve()
      expect(port.getMentionOperation('mention1')).toBeNull(); expect(port.getShareOperation('share1')).toBeNull(); port.dispose()
    }
  })
  it('late private failures are sanitized and a new capabilities read cannot reuse the old ticket or scopes', async () => {
    const waiting = deferred(), entered = deferred(); let first = true
    const request = vi.fn(async () => { if (first) { first = false; entered.resolve(); return waiting.promise } return fetchResult({ scopes: [], capabilities: DENIED_CAPABILITIES }) })
    const port = enhancement(request), pending = observe(port.getCapabilities()); await entered.promise; port.reset()
    waiting.reject(Object.assign(new Error('private directory secret'), { ticket: 'synthetic-opaque-ticket', candidates: [{ displayName: 'private name' }] }))
    const outcome = await pending; expect(outcome.error).toMatchObject({ code: 'AUTHORIZATION_CONTEXT_CHANGED' }); expect(JSON.stringify(outcome.error)).not.toContain('private')
    expect(await port.getCapabilities()).toEqual(DENIED_CAPABILITIES); expect(request).toHaveBeenCalledTimes(2); port.dispose()
  })
  it('dispose is terminal and no fresh capabilities/ticket/mention/share request can start', async () => {
    const request = vi.fn(), port = enhancement(request); port.dispose(); port.reset()
    for (const work of [() => port.getCapabilities(), () => port.issueCollaborationTicket({ requestedScopes: ['document.read'] }),
      () => port.resolveMentions({ operationId: 'fresh', query: 'q' }), () => port.requestShare({ ...shareInput(), operationId: 'fresh' }), () => port.getShareLink()]) {
      await expect(Promise.resolve().then(work)).rejects.toMatchObject({ code: 'AUTHORIZATION_CONTEXT_CHANGED' })
    }
    expect(request).not.toHaveBeenCalled(); expect(port.getMentionOperation('mention1')).toBeNull(); expect(port.getShareOperation('share1')).toBeNull()
  })
})
import { createDocumentInformationPort, recordEditorVisit } from '../../src/providers/document-information'


describe('typed user and document mention resolution', () => {
  const mixed = () => mentionResolved({ candidates: [{ kind: 'user', principalId: 'same', displayName: 'User' }, { kind: 'page', docId: 'same', displayName: 'Plan' }] })
  it('freezes canonical requested kinds, keeps typed identities distinct and queries only the original key', async () => {
    const request = vi.fn(async () => fetchResult(mixed())), port = enhancement(request), kinds = ['page', 'user']
    const pending = port.resolveMentions({ operationId: 'mention1', query: 'plan', kinds }); kinds[0] = 'invalid'
    expect((await pending).candidates).toEqual(mixed().candidates)
    expect(JSON.parse(request.mock.calls[0][1].body).kinds).toEqual(['user', 'page'])
    await port.queryMentionResolution('mention1')
    expect(new URL(request.mock.calls[1][0], 'https://app.example').searchParams.get('kinds')).toBe('user,page')
    expect(request.mock.calls.map(([, init]) => init.method)).toEqual(['POST', 'GET'])
    await expect(Promise.resolve().then(() => port.resolveMentions({ operationId: 'mention1', query: 'plan', kinds: ['page'] }))).rejects.toMatchObject({ code: 'IDEMPOTENCY_MISMATCH' })
    await expect(Promise.resolve().then(() => port.resolveMentions({ operationId: 'mention1', query: 'plan' }))).rejects.toMatchObject({ code: 'IDEMPOTENCY_MISMATCH' })
    expect(request).toHaveBeenCalledTimes(2); port.dispose()
  })
  it('preserves the old user-only body and does not accept page candidates for that old intent', async () => {
    const request = vi.fn(async () => fetchResult(mentionResolved())), port = enhancement(request)
    await port.resolveMentions({ operationId: 'mention1', query: 'bob' })
    expect(JSON.parse(request.mock.calls[0][1].body)).not.toHaveProperty('kinds'); port.dispose()
    const invalid = enhancement(async () => fetchResult(mixed()))
    await expect(invalid.resolveMentions({ operationId: 'mention1', query: 'plan' })).rejects.toMatchObject({ status: 'unknown' }); invalid.dispose()
  })
  it('accepts bounded page-only titles while rejecting malformed, wrong-kind and excessive typed results', async () => {
    const valid = enhancement(async () => fetchResult(mentionResolved({ candidates: [{ kind: 'page', docId: 'plan', displayName: '文'.repeat(255) }] })))
    expect((await valid.resolveMentions({ operationId: 'mention1', query: '', kinds: ['page'] })).candidates[0].displayName).toHaveLength(255); valid.dispose()
    for (const candidates of [
      [{ kind: 'page', principalId: 'plan', displayName: 'Plan' }],
      [{ kind: 'page', docId: 'plan', displayName: 'x'.repeat(256) }],
      [{ kind: 'user', principalId: 'bob', displayName: 'Bob' }],
      Array.from({ length: 21 }, (_, index) => ({ kind: 'page', docId: 'plan-' + index, displayName: 'Plan' })),
    ]) {
      const port = enhancement(async () => fetchResult(mentionResolved({ candidates })))
      await expect(port.resolveMentions({ operationId: 'mention1', query: '', kinds: ['page'] })).rejects.toMatchObject({ code: 'MENTION_RESULT_UNKNOWN' }); port.dispose()
    }
  })
  it('keeps an unknown mixed request query-only without changing its kinds', async () => {
    const request = vi.fn(async (_url, init) => init.method === 'POST' ? fetchResult({ status: 'unknown', code: 'COMMIT_UNKNOWN', operationId: 'mention1', sourceEpoch: '9007199254740993', sourceSeq: '7', requestHash: MENTION_HASH }, 503) : fetchResult(mixed())),
      port = enhancement(request), input = { operationId: 'mention1', query: 'plan', kinds: ['user', 'page'] }
    await expect(port.resolveMentions(input)).rejects.toMatchObject({ status: 'unknown' })
    await port.resolveMentions(input)
    expect(request.mock.calls.map(([, init]) => init.method)).toEqual(['POST', 'GET']); port.dispose()
  })
})
