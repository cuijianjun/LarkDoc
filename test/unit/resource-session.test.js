import { describe, expect, it, vi } from 'vitest'
import { createHttpResourceProvider, createResourceProvider } from '../../src/providers/resources'
import { createDocumentSession } from '../../src/session/DocumentSession'

const response = (httpStatus, data) => ({ httpStatus, data })
const original = { mode: 'create', sourceSystem: 'java', externalResourceId: 'resource/1', operationId: 'create-1' }
const requestHash = 'sha256:' + 'a'.repeat(64)
const resourceResult = (commandType = 'create', operationId = 'create-1') => ({
  operationId, commandType, requestHash, docId: 'doc', bindingId: 'binding:abc', sourceSystem: 'java', externalResourceId: 'resource/1',
  status: commandType === 'unbind' ? 'unbound' : commandType === 'deletion-intent' ? 'deleted' : 'bound',
  bindingRevision: '1', sourceRevision: '1', authzVersion: '1', physicalDelete: false,
  httpStatus: commandType === 'create' ? 201 : commandType === 'deletion-intent' ? 202 : 200,
})
const queried = value => ({ status: 'committed', operationId: value.operationId, commandType: value.commandType, requestHash: value.requestHash, result: value })
function provider(overrides = {}) {
  return Object.fromEntries(['createOrBind', 'queryBinding', 'unbind', 'requestDeletion', 'queryOperation']
    .map(method => [method, overrides[method] || vi.fn(async () => response(200, {}))]))
}
const session = resources => createDocumentSession({ documentId: 'doc', providers: { resources } })

describe('C01 HTTP resource provider', () => {
  it('验证最小契约，可从统一 provider 出口使用', async () => {
    expect(createResourceProvider(null)).toBeNull()
    expect(() => createResourceProvider({ createOrBind() {} })).toThrow(/queryBinding/)
    const entry = await import('../../src/providers')
    expect(entry.createHttpResourceProvider).toBe(createHttpResourceProvider)
  })

  it('使用Cookie、每次当前CSRF和原幂等键，正文只含白名单字段', async () => {
    const calls = []
    let csrf = 'csrf-one'
    const http = createHttpResourceProvider({ baseUrl: 'http://127.0.0.1:33011/', tenantId: 'tenant', docId: 'doc',
      csrfToken: () => csrf, request: async (url, init) => {
        calls.push({ url, init })
        return { status: 201, json: async () => ({ operationId: 'create-1', docId: 'doc', bindingId: 'binding:abc' }) }
      } })
    expect(await http.createOrBind({ ...original, actor: 'forged', owner: 'forged', tenantId: 'other',
      grantIntent: { subject: 'bob', scopes: ['document.read'], actor: 'forged' } })).toMatchObject({ httpStatus: 201 })
    expect(calls[0].url).toBe('http://127.0.0.1:33011/editor/integration/v1/tenants/tenant/resource-bindings')
    expect(calls[0].init).toMatchObject({ credentials: 'include', cache: 'no-store', method: 'POST',
      headers: { 'X-CSRF-Token': 'csrf-one', 'Idempotency-Key': 'create-1' } })
    expect(JSON.parse(calls[0].init.body)).toEqual({ ...original, docId: 'doc', grantIntent: { subject: 'bob', scopes: ['document.read'] } })
    csrf = 'csrf-two'
    await http.unbind({ bindingId: 'binding:abc/one', expectedRevision: '90071992547409931234', operationId: 'unbind-1' })
    expect(calls[1].url).toContain('/resource-bindings/binding%3Aabc%2Fone/unbind-operations')
    expect(calls[1].init.headers['X-CSRF-Token']).toBe('csrf-two')
    expect(JSON.parse(calls[1].init.body).expectedRevision).toBe('90071992547409931234')
  })

  it('查询按原key编码，无服务票据；不允许切换配置文档或缺少CSRF', async () => {
    const request = vi.fn(async () => ({ status: 200, json: async () => ({}) }))
    const http = createHttpResourceProvider({ tenantId: 'tenant', docId: 'doc', csrfToken: 'csrf', request })
    await http.queryBinding({ sourceSystem: 'java service', externalResourceId: 'a/b?c=1' })
    const bindingUrl = new URL(request.mock.calls[0][0], 'http://localhost')
    expect(bindingUrl.searchParams.get('externalResourceId')).toBe('a/b?c=1')
    await http.queryOperation({ operationId: 'delete:intent/1', commandType: 'deletion-intent', requestHash: 'original-hash' })
    const [url, init] = request.mock.calls[1]
    expect(url).toContain('/operations/delete%3Aintent%2F1?')
    expect(new URL(url, 'http://localhost').searchParams.get('commandType')).toBe('deletion-intent')
    expect(init.headers).toEqual({ Accept: 'application/json' })
    expect(() => http.createOrBind({ ...original, docId: 'another-doc' })).toThrow('RESOURCE_DOCUMENT_MISMATCH')
    expect(() => createHttpResourceProvider({ tenantId: 'tenant', docId: 'doc', request })).toThrow(/csrfToken/)
    expect(request).toHaveBeenCalledTimes(2)
  })

  it.each(['request', 'json'])('15秒总等待覆盖%s，超时中止请求且没有隐藏重试', async phase => {
    vi.useFakeTimers()
    try {
      let signal
      const request = vi.fn((url, init) => {
        signal = init.signal
        return phase === 'request' ? new Promise(() => {}) : Promise.resolve({
          status: 200, json: () => new Promise(() => {}),
        })
      })
      const http = createHttpResourceProvider({ tenantId: 'tenant', docId: 'doc', csrfToken: 'csrf', request })
      const pending = http.queryBinding({ sourceSystem: 'java', externalResourceId: 'resource' })
      const assertion = expect(pending).rejects.toThrow('RESOURCE_REQUEST_TIMEOUT')
      await vi.advanceTimersByTimeAsync(15000)
      await assertion
      expect(signal.aborted).toBe(true)
      expect(request).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })
})

describe('C01 DocumentSession 原操作状态', () => {
  it('构造时验证resources provider，绑定单文档且不向provider传actor/owner', async () => {
    expect(() => session({})).toThrow(/resources Provider/)
    const resources = provider({ createOrBind: vi.fn(async () => response(201, resourceResult())) })
    const s = session(resources)
    const result = await s.createOrBindResource({ ...original, docId: 'other', actor: 'forged', owner: 'forged' })
    expect(resources.createOrBind).toHaveBeenCalledWith({ ...original, docId: 'doc' })
    expect(s.documentId).toBe('doc')
    expect(result.status).toBe('committed')
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.request)).toBe(true)
  })

  it('网络结果不明保留原不可变请求；重复调用不重发，只显式查询原键', async () => {
    const resources = provider({
      createOrBind: vi.fn(async () => { throw new Error('connection lost') }),
      queryOperation: vi.fn(async () => response(200, queried(resourceResult()))),
    })
    const s = session(resources)
    const input = { ...original, grantIntent: { subject: 'bob', scopes: ['document.read'] } }
    const first = await s.createOrBindResource(input)
    expect(first.status).toBe('unknown')
    input.grantIntent.scopes.push('document.write')
    expect(first.request.grantIntent.scopes).toEqual(['document.read'])
    expect(await s.createOrBindResource({ ...original, grantIntent: { subject: 'bob', scopes: ['document.read'] } })).toBe(first)
    expect(resources.createOrBind).toHaveBeenCalledTimes(1)
    await expect(s.createOrBindResource({ ...original, externalResourceId: 'different' })).rejects.toThrow('IDEMPOTENCY_MISMATCH')
    const found = await s.queryResourceOperation('create-1', 'create')
    expect(resources.queryOperation).toHaveBeenCalledWith({ docId: 'doc', operationId: 'create-1', commandType: 'create' })
    expect(found.status).toBe('committed')
    expect(first.status).toBe('unknown')
    await s.queryResourceOperation('create-1', 'create')
    expect(resources.queryOperation).toHaveBeenLastCalledWith({ docId: 'doc', operationId: 'create-1', commandType: 'create', requestHash })
    expect(resources.createOrBind).toHaveBeenCalledTimes(1)
  })

  it('503和未知查询不变成未提交；刷新后仅按原key查询，不创建第二正文', async () => {
    const resources = provider({
      createOrBind: vi.fn(async () => response(503, { code: 'COMMIT_UNKNOWN', operationId: 'create-1' })),
      queryOperation: vi.fn(async () => response(404, { code: 'RESOURCE_NOT_FOUND' })),
    })
    const s = session(resources)
    expect((await s.createOrBindResource(original)).status).toBe('unknown')
    expect((await s.queryResourceOperation('create-1', 'create')).status).toBe('unknown')
    const refreshed = session(resources)
    expect((await refreshed.queryResourceOperation('create-1', 'create')).status).toBe('unknown')
    expect(resources.createOrBind).toHaveBeenCalledTimes(1)
    expect(refreshed.documentId).toBe('doc')
  })

  it('解绑与202处置意图仅产生资源记录，不销毁正文、不清协作pending或发保存事件', async () => {
    const resources = provider({
      unbind: vi.fn(async () => response(200, resourceResult('unbind', 'unbind-1'))),
      requestDeletion: vi.fn(async () => response(202, resourceResult('deletion-intent', 'delete-1'))),
    })
    const s = session(resources)
    const editor = { destroy: vi.fn(), commands: { setContent: vi.fn() } }
    s.attachEditor(editor)
    const saved = vi.fn()
    s.on('save', saved)
    s.on('receipt', saved)
    const unbound = await s.unbindResource('binding:abc', { expectedRevision: '2', sourceRevision: '4', operationId: 'unbind-1' })
    expect(unbound.status).toBe('committed')
    const deletion = await s.requestResourceDeletion('binding:abc', { sourceRevision: '4', operationId: 'delete-1' })
    expect(deletion.status).toBe('pending')
    expect(deletion.result.physicalDelete).toBe(false)
    expect(s.getEditor()).toBe(editor)
    expect(editor.destroy).not.toHaveBeenCalled()
    expect(editor.commands.setContent).not.toHaveBeenCalled()
    expect(saved).not.toHaveBeenCalled()
  })

  it.each([
    {}, { status: 'rejected' }, { ...resourceResult(), operationId: 'another' }, { ...resourceResult(), docId: 'another' },
    { ...resourceResult(), commandType: 'bind' }, { ...resourceResult(), requestHash: 'not-a-hash' },
    { ...resourceResult(), physicalDelete: true }, { ...resourceResult(), status: 'rejected' }, { ...resourceResult(), httpStatus: 202 },
  ])('畸形或异原键的2xx结果不确认成功：%j', async data => {
    const resources = provider({ createOrBind: vi.fn(async () => response(201, data)) })
    const recorded = await session(resources).createOrBindResource(original)
    expect(recorded.status).toBe('unknown')
    expect(recorded.result).toBeNull()
  })

  it.each([
    { ...queried(resourceResult()), requestHash: 'sha256:' + 'b'.repeat(64) },
    { ...queried(resourceResult()), result: { ...resourceResult(), operationId: 'another' } },
    { ...queried(resourceResult()), result: { ...resourceResult(), commandType: 'bind' } },
    { ...queried(resourceResult()), result: { ...resourceResult(), docId: 'another' } },
    { ...queried(resourceResult()), result: { ...resourceResult(), requestHash: 'sha256:' + 'b'.repeat(64) } },
    { ...queried(resourceResult()), result: null },
  ])('原操作查询必须核对wrapper与嵌套原结果，不能替换已知hash：%j', async data => {
    const resources = provider({ createOrBind: vi.fn(async () => response(201, resourceResult())),
      queryOperation: vi.fn(async () => response(200, data)) })
    const s = session(resources)
    expect((await s.createOrBindResource(original)).status).toBe('committed')
    const recorded = await s.queryResourceOperation(original.operationId, 'create')
    expect(recorded.status).toBe('unknown')
    expect(recorded.requestHash).toBe(requestHash)
    expect(recorded.result).toBeNull()
  })

  it('202处置意图经精确原操作QUERY200确认后仅确认意图提交，仍禁止物理删除', async () => {
    const value = resourceResult('deletion-intent', 'delete-1')
    const resources = provider({ requestDeletion: vi.fn(async () => response(202, value)),
      queryOperation: vi.fn(async () => response(200, queried(value))) })
    const s = session(resources)
    expect((await s.requestResourceDeletion('binding:abc', { sourceRevision: '0', operationId: 'delete-1' })).status).toBe('pending')
    const recorded = await s.queryResourceOperation('delete-1', 'deletion-intent')
    expect(recorded.status).toBe('committed')
    expect(recorded.result.physicalDelete).toBe(false)
    expect(recorded.result.status).toBe('deleted') // 仅资源binding tombstone，不是正文物理删除。
  })
})

describe('US13 Session附件原操作与生命周期（E1）', () => {
  const assetPort = overrides => ({ begin: vi.fn(), complete: vi.fn(), getStatus: vi.fn(), getContent: vi.fn(),
    queryOperation: vi.fn(async () => ({ status: 'unknown', operationId: 'asset-original' })),
    getOperation: vi.fn(() => ({ operationId: 'asset-original' })), reset: vi.fn(), dispose: vi.fn(), ...overrides })

  it('显式查询原operation只调用query，不重新begin/complete；当前不可见不泄露缓存', async () => {
    const assets = assetPort(), s = createDocumentSession({ documentId: 'doc', assets })
    const input = { operationId: 'asset-original', kind: 'complete', requestHash }
    await expect(s.queryAssetOperation(input)).resolves.toMatchObject({ status: 'unknown' })
    expect(assets.queryOperation).toHaveBeenCalledWith(input)
    expect(assets.begin).not.toHaveBeenCalled(); expect(assets.complete).not.toHaveBeenCalled()
    expect(s.getAssetOperation('asset-original')).toMatchObject({ operationId: 'asset-original' })
    s.setProvider('authorization', null)
    expect(assets.reset).toHaveBeenCalledWith('authorization-required')
    expect(s.getAssetOperation('asset-original')).toBeNull()
    await expect(s.queryAssetOperation(input)).rejects.toThrow('附件操作权限')
    expect(assets.queryOperation).toHaveBeenCalledOnce()
    await s.dispose()
  })

  it.each(['identity', 'provider', 'authorization', 'dispose'])('%s变化清理资产并拒绝忽略取消的迟到回包', async change => {
    let resolve
    const assets = assetPort({ begin: vi.fn(() => new Promise(done => { resolve = done })) })
    const s = createDocumentSession({ documentId: 'doc', user: { id: 'alice' }, assets })
    const pending = s.beginAssetUpload({ operationId: 'asset-original' })
    s.user = { id: 'alice', name: 'display-only' }
    s.setProvider('assets', assets)
    expect(assets.reset).not.toHaveBeenCalled()
    if (change === 'identity') s.user = { id: 'bob' }
    if (change === 'provider') s.setProvider('assets', assetPort())
    if (change === 'authorization') s.setProvider('authorization', { getCapabilities: async () => ({ canView: true, canEdit: true }) })
    if (change === 'dispose') await s.dispose()
    if (change === 'dispose') expect(assets.dispose).toHaveBeenCalledOnce()
    else expect(assets.reset).toHaveBeenCalledWith(change === 'identity' ? 'identity-changed' : change === 'provider' ? 'provider-replaced' : 'authorization-required')
    resolve({ status: 'committed', ready: true })
    await expect(pending).rejects.toMatchObject({ code: 'ASSET_SESSION_CHANGED', retryable: false })
    if (change !== 'dispose') await s.dispose()
    expect(s.getAssetOperation('asset-original')).toBeNull()
    expect(() => s.setProvider('assets', assets)).toThrow('已销毁')
  })
})


// Business provider regression: exact original keys and current private identity own every result.
import { createHttpDocumentBusinessProvider as httpBusiness } from '../../src/providers/document-business-http'
import { createDocumentBusinessProvider } from '../../src/providers/document-business'
const bizSnapshot = (revision = '0', extra = {}) => ({ tenantId: 'tenant', docId: 'doc', principalId: 'alice', status: 'active', revision, preferenceRevision: '0', epoch: '1', contentRevision: '1', followed: false, favorite: false, capabilities: Object.fromEntries(['canFollow', 'canFavorite', 'canMove', 'canDuplicate', 'canDelete', 'canRestore'].map(k => [k, true])), ...extra })
const jsonBusiness = (status, data) => ({ status, json: async () => data })
const bizCommand = { kind: 'favorite', operationId: 'original-favorite', expectedRevision: '0', value: true }
function business(request, overrides = {}) {
  const provider = httpBusiness({ tenantId: 'tenant', docId: 'doc', csrfToken: () => 'csrf', request, ...overrides })
  let context = { authenticated: true, generation: 1, principalId: 'alice' }
  provider.bindContext(() => context)
  return { provider, change: value => { context = value } }
}
describe('document business original key and push state', () => {
  it('requires a complete replaceable contract', () => { expect(createDocumentBusinessProvider(null)).toBeNull(); expect(() => createDocumentBusinessProvider({})).toThrow(/契约/); const { provider } = business(vi.fn()); expect(createDocumentBusinessProvider(provider)).toBe(provider); provider.reset('disposed') })
  it.each([401, 403, 404, 503])('query %s keeps original unknown and never repeats POST', async status => {
    const request = vi.fn(async (url, init) => init.method === 'POST' ? Promise.reject(Error('lost ACK')) : jsonBusiness(status, { code: 'CURRENT_QUERY_DENIED' }))
    const { provider } = business(request)
    expect((await provider.execute(bizCommand)).status).toBe('unknown')
    await expect(provider.query(bizCommand.operationId)).rejects.toMatchObject({ status })
    expect(provider.getPending()).toEqual([{ operationId: bizCommand.operationId, kind: 'favorite' }])
    await expect(provider.execute(bizCommand)).rejects.toThrow('BUSINESS_QUERY_REQUIRED')
    expect(request.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1)
    provider.reset('disposed')
  })
  it('preparation failure is unsent, without an unknown pending operation', async () => {
    const request = vi.fn(), { provider } = business(request, { csrfToken: () => { throw Error('CSRF unavailable') } })
    await expect(provider.execute(bizCommand)).rejects.toThrow('CSRF unavailable'); expect(request).not.toHaveBeenCalled(); expect(provider.getPending()).toEqual([]); provider.reset('disposed')
  })
  it('does not regress a newer authorized projection when an old read arrives late', async () => {
    let release
    const request = vi.fn().mockImplementationOnce(() => new Promise(resolve => { release = resolve })).mockResolvedValueOnce(jsonBusiness(200, bizSnapshot('2', { status: 'deleted' })))
    const { provider } = business(request), old = provider.load()
    await provider.load(); release(jsonBusiness(200, bizSnapshot('1'))); await old
    expect(provider.getState().revision).toBe('2'); expect(provider.getState().status).toBe('deleted'); provider.reset('disposed')
  })
  it('discards late private state and original operations across identity replacement', async () => {
    let release
    const { provider, change } = business(() => new Promise(resolve => { release = resolve }))
    const read = provider.load(); provider.reset('identity-changed'); change({ authenticated: true, principalId: 'bob', generation: 2 }); release(jsonBusiness(200, bizSnapshot()))
    await expect(read).rejects.toThrow('BUSINESS_CONTEXT_CHANGED'); expect(provider.getState()).toBeNull(); expect(provider.getPending()).toEqual([]); provider.reset('disposed')
  })
})


describe('document business lifecycle boundaries', () => {
  it('blocks replacing a transport while its original unknown still needs querying', async () => {
    const first = business(async () => { throw Error('ACK lost') }).provider
    const session = createDocumentSession({ documentId: 'doc', user: { id: 'alice' }, providers: { documentBusiness: first } })
    await first.execute(bizCommand)
    const next = business(vi.fn()).provider
    expect(() => session.setProvider('documentBusiness', next)).toThrow('BUSINESS_PENDING_QUERY_REQUIRED')
    expect(session.getProvider('documentBusiness')).toBe(first); expect(first.getPending()).toHaveLength(1); await session.dispose(); next.reset('disposed')
  })
  it('keeps a newer SSE projection over a delayed GET', async () => {
    let release, deliver
    const reader = { read: () => new Promise(resolve => { deliver = resolve }), cancel: async () => {} }
    const request = (url) => url.endsWith('/business-events') ? Promise.resolve({ status: 200, headers: { get: () => 'text/event-stream' }, body: { getReader: () => reader } }) : new Promise(resolve => { release = resolve })
    const { provider } = business(request), old = provider.load(), off = provider.subscribe(() => {})
    await vi.waitFor(() => expect(deliver).toBeTypeOf('function'))
    deliver({ done: false, value: new TextEncoder().encode('event: document\ndata: ' + JSON.stringify({ document: bizSnapshot('3', { followed: true, preferenceRevision: '2' }) }) + '\n\n') })
    await vi.waitFor(() => expect(provider.getState()?.revision).toBe('3'))
    release(jsonBusiness(200, bizSnapshot('1'))); await old; expect(provider.getState().followed).toBe(true); expect(provider.getState().revision).toBe('3'); off(); provider.reset('disposed')
  })
})


it.each([{status:'ready',epoch:'1',revision:'1',pending:[{updateId:'original'}]},{status:'disconnected',epoch:'1',revision:'1',pending:[]},{status:'ready',epoch:'1',revision:'2',pending:[]}])('does not copy unconfirmed or a different local cut: %j',async live=>{
 const request=vi.fn(),{provider}=business(request,{getState:()=>live});await expect(provider.execute({kind:'duplicate',operationId:'copy-pending',expectedRevision:'0',folderId:'home',name:'copy',sourceEpoch:'1',sourceRevision:'1'})).rejects.toThrow('BUSINESS_BODY_NOT_CURRENT');expect(request).not.toHaveBeenCalled();expect(provider.getPending()).toEqual([]);provider.reset('disposed')
})


it('does not publish a late resource ACK across a current-authority refresh',async()=>{
 let release;const resources=provider({createOrBind:()=>new Promise(resolve=>{release=resolve})}),s=createDocumentSession({documentId:'doc',user:{id:'alice'},providers:{resources,authorization:{getCapabilities:async()=>({canView:true,canEdit:true})}}});
 await s.refreshCapabilities();const events=[];s.on('resource-operation',value=>events.push(value));const pending=s.createOrBindResource({...original}),count=events.length;await s.refreshCapabilities();release(response(201,resourceResult()));await expect(pending).rejects.toThrow('IDENTITY_CONTEXT_CHANGED');expect(s.getResourceOperation('create-1','create')).toBeNull();expect(events).toHaveLength(count);await s.dispose()
})
