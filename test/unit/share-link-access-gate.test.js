import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import { createHttpShareLinkAccessProvider } from '../../src/providers/share-link-access'
import { createHttpIdentityProvider } from '../../src/providers/identity'
import { createDocumentSession } from '../../src/session/DocumentSession'

const linkId = 'sl_' + 'a'.repeat(43), principalId = 'guest-link-' + 'b'.repeat(40), csrfToken = 'c'.repeat(43), hash = 'sha256:' + 'd'.repeat(64)
const fragment = `larkDocument=1&tenantId=tenant&docId=doc&shareLink=${linkId}`
const response = (status, data) => ({ status, redirected: false, json: async () => data })
const ack = operationId => ({ status: 'committed', operationId, requestHash: hash, principalId, csrfToken, linkRevision: '1', expiresAt: '2099-01-01T00:00:00Z' })
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function factory(request, extra = {}) {
  let sequence = 0
  vi.stubGlobal('crypto', { getRandomValues: bytes => bytes.fill(++sequence) })
  return createHttpShareLinkAccessProvider({ tenantId: 'tenant', docId: 'doc', request, ...extra })
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('public Cookie transport and original unlock operation', () => {
  it('creates the preauth Cookie before one POST, preserving supported API paths and keeping credentials out of JSON state', async () => {
    const request = vi.fn(async (url, init) => init.method === 'POST' ? response(200, ack(JSON.parse(init.body).operationId)) : response(200, { ready: true }))
    const port = factory(request, { baseUrl: 'https://api.example.test/api/v2/' })
    const result = await port.request({ linkId, password: 'Aa23!678' })
    expect(result).toMatchObject({ status: 'committed', csrfToken }); expect(result.token).toBeUndefined()
    expect(request.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      ['https://api.example.test/api/v2/editor/v1/tenants/tenant/documents/doc/share-link-access/context', 'GET'],
      ['https://api.example.test/api/v2/editor/v1/tenants/tenant/documents/doc/share-link-access-operations', 'POST'],
    ])
    for (const [, init] of request.mock.calls) expect(init).toMatchObject({ credentials: 'include', cache: 'no-store', redirect: 'error' })
    const post = request.mock.calls[1][1]; expect(post.headers['Idempotency-Key']).toBe(result.operationId); expect(post.headers['X-CSRF-Token']).toBeUndefined()
    expect(JSON.stringify(port.operation())).not.toContain('Aa23!678'); expect(port.getPending()).toBeNull(); port.dispose()
  })
  it.each(['http://remote.test/api', 'https://user:pass@example.test/api', '//example.test/api', '/api?x=1', '/api#secret', '/api/../other', '/api\\other'])('rejects ambiguous or insecure API base %s', baseUrl => {
    expect(() => factory(vi.fn(), { baseUrl })).toThrow('CONFIGURATION')
  })
  it.each(['/api/v2', 'http://127.0.0.1:3000/api/v2', 'http://localhost:3000/api/v2'])('preserves allowed API base %s', async baseUrl => {
    const request = vi.fn(async (url, init) => init.method === 'POST' ? response(200, ack(JSON.parse(init.body).operationId)) : response(200, { ready: true })), port = factory(request, { baseUrl })
    await port.request({ linkId }); expect(request.mock.calls[0][0]).toBe(baseUrl + '/editor/v1/tenants/tenant/documents/doc/share-link-access/context'); port.dispose()
  })
  it.each(['unconfigured', 'network', 'invalid'])('context %s failure is confirmed unsent and permits a fresh user action', async failure => {
    let available = false
    const request = vi.fn(async (url, init) => {
      if (init.method === 'POST') return response(200, ack(JSON.parse(init.body).operationId))
      if (available) return response(200, { ready: true })
      if (failure === 'network') throw Error('disconnected')
      return failure === 'unconfigured' ? response(503, { code: 'SHARE_LINK_CRYPTO_UNAVAILABLE' }) : response(200, { ready: false })
    }), port = factory(request)
    await expect(port.request({ linkId })).rejects.toMatchObject({ status: 'rejected' })
    expect(port.getPending()).toBeNull(); expect(request.mock.calls.some(([, init]) => init.method === 'POST')).toBe(false)
    available = true; await expect(port.request({ linkId })).resolves.toMatchObject({ status: 'committed' }); port.dispose()
  })
  it('a lost POST keeps its original key and optional hash, and recovery only GETs that operation', async () => {
    let operationId
    const request = vi.fn(async (url, init) => {
      if (url.endsWith('/context')) return response(200, { ready: true })
      if (init.method === 'POST') { operationId = JSON.parse(init.body).operationId; throw Error('ACK lost') }
      return response(200, ack(operationId))
    }), port = factory(request)
    await expect(port.request({ linkId, password: 'Aa23!678' })).rejects.toMatchObject({ status: 'unknown' })
    expect(port.getPending().operationId).toBe(operationId)
    expect(() => port.request({ linkId })).toThrow('QUERY_REQUIRED')
    await expect(port.query()).resolves.toMatchObject({ operationId, status: 'committed' })
    expect(request.mock.calls.map(([, init]) => init.method)).toEqual(['GET', 'POST', 'GET'])
    expect(request.mock.calls[2][0]).toContain(`/share-link-access-operations/${operationId}?linkId=`); expect(request.mock.calls[2][0]).not.toContain('requestHash='); port.dispose()
  })
  it('a stalled response body has a finite deadline; preflight timeout sends zero POSTs', async () => {
    vi.useFakeTimers()
    const request = vi.fn(async () => ({ status: 200, json: () => new Promise(() => {}) })), port = factory(request)
    const outcome = port.request({ linkId }).catch(error => error)
    await vi.advanceTimersByTimeAsync(15000)
    expect(await outcome).toMatchObject({ status: 'rejected' }); expect(request).toHaveBeenCalledOnce(); expect(port.getPending()).toBeNull(); port.dispose()
  })
  it('rechecks the supplied switch guard after context and before the only Cookie-changing POST', async () => {
    const entered = deferred(), context = deferred(), beforeUnlock = vi.fn(() => { throw Error('draft added') })
    const request = vi.fn(async () => { entered.resolve(); return context.promise }), port = factory(request, { beforeUnlock })
    const pending = port.request({ linkId }).catch(error => error); await entered.promise
    expect(beforeUnlock).not.toHaveBeenCalled(); context.resolve(response(200, { ready: true }))
    expect(await pending).toMatchObject({ status: 'rejected' }); expect(beforeUnlock).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledOnce(); expect(port.getPending()).toBeNull(); port.dispose()
  })
  it('reset aborts a true POST and retires its late receipt; JSON session tokens never reach the consumer', async () => {
    const late = deferred(), reached = deferred(); let operationId
    const request = vi.fn(async (url, init) => {
      if (url.endsWith('/context')) return response(200, { ready: true })
      operationId = JSON.parse(init.body).operationId; reached.resolve(); return late.promise
    }), port = factory(request), outcome = port.request({ linkId }).catch(error => error)
    await reached.promise
    const signal = request.mock.calls[1][1].signal
    port.reset(); expect(signal.aborted).toBe(true); expect((await outcome).code).toBe('SHARE_LINK_CONTEXT_CHANGED')
    late.resolve(response(200, ack(operationId))); await Promise.resolve(); expect(port.operation()).toBeNull(); port.dispose()
    const forged = factory(async (url, init) => url.endsWith('/context') ? response(200, { ready: true }) : response(200, { ...ack(JSON.parse(init.body).operationId), token: 'not-allowed' }))
    await expect(forged.request({ linkId })).rejects.toMatchObject({ status: 'unknown' }); expect(forged.getPending()).not.toBeNull(); forged.dispose()
  })
})

const source = readFileSync(new URL('../../src/components/lark-doc/ShareLinkAccessGate.vue', import.meta.url), 'utf8')
const Gate = new Function('ShareLinkAccess', source.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '').replace('export default', 'return'))({})
const flush = async () => { await Promise.resolve(); await Promise.resolve() }
function gateFixture({ hashValue = fragment, initialPrincipal = null, canView = false, factoryGate, bodyState = { known: true, pending: 0 } } = {}) {
  const events = new Map(), locationEvents = new Map(), location = { href: 'https://host.test/editor#' + hashValue }
  const history = { state: { retained: true }, replaceState: vi.fn((state, title, target) => { location.href = new URL(target, location.href).href }) }
  vi.stubGlobal('window', { location, history, addEventListener: (name, fn) => locationEvents.set(name, fn), removeEventListener: (name, fn) => { if (locationEvents.get(name) === fn) locationEvents.delete(name) } })
  let state = { status: initialPrincipal ? 'authenticated' : 'idle', principalId: initialPrincipal, generation: 1 }, view = canView
  const raw = { request: vi.fn(async () => ack('unlock')), query: vi.fn(async () => ack('unlock')), operation: vi.fn(() => null), reset: vi.fn(), dispose: vi.fn() }
  const authorization = { getScope: vi.fn(() => ({ tenantId: 'tenant', docId: 'doc' })), getShareLinkAccessState: vi.fn(() => bodyState), createShareLinkAccess: vi.fn(() => factoryGate ? factoryGate.promise : Promise.resolve(raw)) }
  const identity = { getState: vi.fn(() => state), resumeCurrentSession: vi.fn() }, providers = { authorization, identity }
  const session = { documentId: 'doc', user: initialPrincipal ? { id: initialPrincipal } : null, _identityGeneration: 1, _privateIdentityGeneration: 1,
    getProvider: name => providers[name], can: () => view, _identityCurrent: () => state.status === 'authenticated' && state.principalId === session.user?.id,
    on(name, fn) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(fn); return () => events.get(name).delete(fn) }, emit(name) { for (const fn of events.get(name) || []) fn() } }
  const change = (status, who = null) => { state = { status, principalId: who, generation: state.generation + 1 }; session.user = who ? { id: who } : null; session._identityGeneration++; session._privateIdentityGeneration++; session.emit('capabilities'); session.emit('identity') }
  identity.resumeCurrentSession.mockImplementation(async () => { change('authenticating'); change('authenticated', principalId); return state })
  identity.prepareShareLinkAccess = vi.fn(() => ({ current: () => true, cancel: vi.fn(), resumeCurrentSession: input => identity.resumeCurrentSession(input) }))
  const vm = { ...Gate.data(), ed: { session }, $refs: { dialog: { querySelector: () => ({ focus: vi.fn() }) } }, $nextTick: fn => fn() }
  for (const [name, fn] of Object.entries(Gate.methods)) vm[name] = fn.bind(vm)
  return { vm, session, providers, authorization, identity, raw, history, location, locationEvents, events, change, state: () => state, view: value => { view = value; session.emit('capabilities') } }
}

describe('share-link fragment, identity and editor gate', () => {
  it.each([
    fragment + '&shareLink=' + linkId, fragment + '&other=1', fragment.replace('tenantId=tenant', 'tenantId=else'),
    fragment.replace('docId=doc', 'docId=else'), fragment.replace('larkDocument=1', 'larkDocument=2'), fragment.replace(linkId, linkId + '%0A'),
    fragment.replace('&shareLink=' + linkId, ''),
  ])('does not consume duplicate, extra, invalid or foreign fragment %#', async hashValue => {
    const h = gateFixture({ hashValue }); h.vm.bind(); await flush()
    expect(h.history.replaceState).not.toHaveBeenCalled(); expect(h.authorization.createShareLinkAccess).not.toHaveBeenCalled(); expect(h.vm.visible).toBe(false)
  })
  it('consumes only the fourth field and keeps an authenticated authorized editor without unlocking or replacing its Cookie', async () => {
    const h = gateFixture({ initialPrincipal: 'alice', canView: true }); h.vm.bind(); await flush()
    expect(h.location.href).toBe('https://host.test/editor#larkDocument=1&tenantId=tenant&docId=doc')
    expect(h.history.replaceState.mock.calls[0][0]).toEqual({ retained: true }); expect(h.vm.visible).toBe(false)
    expect(h.authorization.createShareLinkAccess).not.toHaveBeenCalled(); expect(h.identity.resumeCurrentSession).not.toHaveBeenCalled()
  })
  it('prepares the explicit form without an automatic unlock, and closes only after server resume confirms the same guest', async () => {
    const h = gateFixture(); h.vm.bind(); await flush()
    expect(h.vm.visible).toBe(true); expect(h.vm.linkId).toBe(linkId); expect(h.raw.request).not.toHaveBeenCalled(); expect(h.identity.resumeCurrentSession).not.toHaveBeenCalled()
    const result = await h.vm.accessPort.request({ linkId }); await h.vm.authenticated(result)
    expect(h.identity.resumeCurrentSession).toHaveBeenCalledWith({ csrfToken }); expect(h.vm.visible).toBe(false); expect(h.state().principalId).toBe(principalId)
    expect(h.session.can('canView')).toBe(false) // This component never grants capabilities or writes editor content.
  })
  it('can consume an untouched fragment after the authorization provider becomes available', async () => {
    const h = gateFixture(); h.providers.authorization = {}; h.vm.bind()
    expect(h.history.replaceState).not.toHaveBeenCalled()
    h.providers.authorization = h.authorization; h.session.emit('provider-changed'); await flush()
    expect(h.vm.linkId).toBe(linkId); expect(h.vm.accessPort).not.toBeNull(); expect(h.raw.request).not.toHaveBeenCalled()
  })
  it.each(['missing', 'rejected', 'wrong-principal', 'unconfirmed'])('resume %s never claims successful access', async failure => {
    const h = gateFixture()
    if (failure === 'missing') delete h.identity.prepareShareLinkAccess
    else h.identity.resumeCurrentSession.mockImplementation(async () => {
      if (failure === 'rejected') throw Error('unavailable')
      if (failure === 'wrong-principal') h.change('authenticated', 'guest-link-' + 'e'.repeat(40))
      return { status: 'authenticated', principalId }
    })
    h.vm.bind(); await flush()
    if (failure !== 'missing') { await h.vm.accessPort.request({ linkId }); await h.vm.authenticated(ack('unlock')) }
    expect(h.vm.visible).toBe(true); expect(h.vm.accessPort).toBeNull(); expect(h.vm.message).not.toBe('')
  })
  it.each(['identityABA', 'providerABA', 'document', 'session', 'destroy'])('retires a delayed factory across %s', async boundary => {
    const factoryGate = deferred(), h = gateFixture({ factoryGate }); h.vm.bind()
    if (boundary === 'identityABA') { h.change('authenticated', 'alice'); h.change('idle') }
    if (boundary === 'providerABA') { h.providers.authorization = {}; h.session.emit('provider-changed'); h.providers.authorization = h.authorization }
    if (boundary === 'document') h.session.documentId = 'else'
    if (boundary === 'session') h.vm.ed.session = { ...h.session }
    if (boundary === 'destroy') Gate.beforeDestroy.call(h.vm)
    factoryGate.resolve(h.raw); await flush()
    expect(h.vm.accessPort).toBeNull(); expect(h.raw.dispose).toHaveBeenCalled(); expect(h.raw.request).not.toHaveBeenCalled()
  })
  it('a delayed unlock cannot resume an identity after the document changes', async () => {
    const h = gateFixture(), late = deferred(); h.raw.request.mockReturnValue(late.promise); h.vm.bind(); await flush()
    const pending = h.vm.accessPort.request({ linkId }).catch(error => error); h.session.documentId = 'else'; late.resolve(ack('unlock'))
    expect((await pending).message).toBe('SHARE_LINK_CONTEXT_CHANGED'); expect(h.identity.resumeCurrentSession).not.toHaveBeenCalled(); expect(h.vm.visible).toBe(false)
  })
  it('a different identity during server resume cannot be replaced by a late guest receipt', async () => {
    const h = gateFixture(), late = deferred(); h.identity.resumeCurrentSession.mockImplementation(() => { h.change('authenticating'); return late.promise })
    h.vm.bind(); await flush(); await h.vm.accessPort.request({ linkId }); const pending = h.vm.authenticated(ack('unlock'))
    h.change('authenticated', 'alice'); h.change('authenticated', principalId); late.resolve({ status: 'authenticated', principalId }); await pending
    expect(h.vm.accessPort).toBeNull(); expect(h.raw.dispose).toHaveBeenCalled(); expect(h.vm.visible).toBe(true)
  })
  it('cleans listeners and a retired transport on destroy', async () => {
    const h = gateFixture(); Gate.mounted.call(h.vm); await flush(); Gate.beforeDestroy.call(h.vm)
    expect([...h.events.values()].every(set => set.size === 0)).toBe(true); expect(h.locationEvents.size).toBe(0); expect(h.raw.dispose).toHaveBeenCalled()
  })
  it.each([
    ['body pending', { known: true, pending: 1 }], ['unknown body', { known: false, pending: undefined }],
  ])('an authenticated denied reader cannot unlock with %s', async (name, bodyState) => {
    const h = gateFixture({ initialPrincipal: 'alice', bodyState }); h.vm.bind(); await flush()
    await expect(h.vm.accessPort.request({ linkId })).rejects.toThrow('SWITCH_BLOCKED')
    expect(h.raw.request).not.toHaveBeenCalled(); expect(h.identity.prepareShareLinkAccess).not.toHaveBeenCalled()
    expect(h.vm.message).not.toBe('')
  })
  it.each([
    ['commentDocumentDraft', 'hidden text'], ['commentCreateDraft', ' '], ['commentEditContent', 'edit draft'],
    ['commentDrafts', { hidden: 'reply draft' }], ['commentImageDrafts', { hidden: [{ assetId: 'image' }] }],
    ['commentPendingOperation', 'original'], ['commentPendingImage', { operationId: 'original-image' }], ['pendingHTML', '<p>unsent</p>'],
  ])('hidden %s prevents Cookie exchange even for a signed-out editor', async (key, value) => {
    const h = gateFixture(); h.vm.ed[key] = value; h.vm.bind(); await flush()
    await expect(h.vm.accessPort.request({ linkId })).rejects.toThrow('SWITCH_BLOCKED')
    expect(h.raw.request).not.toHaveBeenCalled(); expect(h.vm.ed[key]).toEqual(value)
  })
  it('a clean signed-out reader may unlock without inventing a body baseline', async () => {
    const h = gateFixture({ bodyState: { known: false } }); h.vm.bind(); await flush()
    await h.vm.accessPort.request({ linkId }); expect(h.raw.request).toHaveBeenCalledOnce()
  })
  it('a login original key is checked before the first unlock, and a newly authorized reader performs zero unlocks', async () => {
    const h = gateFixture(); h.identity.prepareShareLinkAccess.mockImplementation(() => { throw Error('IDENTITY_ORIGINAL_KEY_REQUIRED') }); h.vm.bind(); await flush()
    await expect(h.vm.accessPort.request({ linkId })).rejects.toThrow('SWITCH_BLOCKED'); expect(h.raw.request).not.toHaveBeenCalled()
    const other = gateFixture({ initialPrincipal: 'alice' }); other.vm.bind(); await flush(); const port = other.vm.accessPort
    other.view(true); await expect(port.request({ linkId })).rejects.toThrow('CONTEXT_CHANGED'); expect(other.raw.request).not.toHaveBeenCalled()
  })
  it('the cold factory guard checks draft/pending again immediately before unlock POST', async () => {
    const h = gateFixture({ initialPrincipal: 'alice' }); h.vm.bind(); await flush()
    const beforeUnlock = h.authorization.createShareLinkAccess.mock.calls[0][0]
    h.vm.ed.commentDocumentDraft = 'arrived while context was loading'
    expect(() => beforeUnlock()).toThrow('SWITCH_BLOCKED'); expect(h.raw.request).not.toHaveBeenCalled()
    h.vm.ed.commentDocumentDraft = ''; h.authorization.getShareLinkAccessState.mockReturnValue({ known: true, pending: 1 })
    expect(() => beforeUnlock()).toThrow('SWITCH_BLOCKED'); expect(h.identity.prepareShareLinkAccess).not.toHaveBeenCalled()
  })
  it('keeps one preparation through unknown and original GET, then restores normal refresh only after a confirmed rejection', async () => {
    const h = gateFixture(), permit = { current: () => true, cancel: vi.fn(), resumeCurrentSession: vi.fn() }
    h.identity.prepareShareLinkAccess.mockReturnValue(permit); h.raw.operation.mockReturnValue({ operationId: 'original', status: 'unknown' })
    h.raw.request.mockRejectedValue(Object.assign(Error('unknown'), { status: 'unknown' })); h.vm.bind(); await flush()
    await expect(h.vm.accessPort.request({ linkId })).rejects.toMatchObject({ status: 'unknown' })
    await h.vm.accessPort.query(); expect(h.identity.prepareShareLinkAccess).toHaveBeenCalledOnce(); expect(permit.cancel).not.toHaveBeenCalled()
    h.raw.query.mockRejectedValue(Error('denied')); h.raw.operation.mockReturnValue({ operationId: 'original', status: 'rejected' })
    await expect(h.vm.accessPort.query()).rejects.toThrow('denied'); expect(permit.cancel).toHaveBeenCalledWith(true)
  })
})

describe('real identity provider and DocumentSession share Cookie handoff', () => {
  it('switches a clean authenticated denied reader only after server /current, preserving actual capabilities-before-identity ordering', async () => {
    vi.useFakeTimers(); vi.stubGlobal('crypto', webcrypto)
    const h = gateFixture(), current = deferred(), entered = deferred(), events = [], seen = []
    const dto = who => ({ status: 'authenticated', principalId: who, canCreate: false, csrfToken: who === 'alice' ? 'A'.repeat(43) : csrfToken, refreshAfterMs: 1000, expiresInMs: 4000 })
    const request = vi.fn(async (url, init) => {
      if (url.endsWith('/current')) { entered.resolve(); return current.promise }
      return { ...response(200, dto('alice')), headers: { get: () => 'application/json' } }
    })
    const identity = createHttpIdentityProvider({ tenantId: 'tenant', docId: 'doc', request })
    let session
    const authorization = { ...h.authorization, reset: vi.fn(), getCapabilities: vi.fn(async () => ({ canView: identity.getState().principalId === principalId })) }
    try {
      await identity.login({ operationId: 'normal-login', loginCode: 'normal-code' })
      session = createDocumentSession({ documentId: 'doc', identity, authorization }); await session._capabilitiesPromise
      h.vm.ed.session = session; session.on('capabilities', () => events.push(['capabilities', identity.getState().status])); session.on('identity', value => events.push(['identity', value.status]))
      identity.subscribe(value => seen.push(value.principalId)); h.vm.bind(); await flush()
      expect(session.user.id).toBe('alice'); expect(session.can('canView')).toBe(false)
      const result = await h.vm.accessPort.request({ linkId }), pending = h.vm.authenticated(result); await entered.promise
      expect(session.user).toBeNull(); expect(h.vm.resuming).toBe(true); expect(h.vm.message).toBe('')
      expect(request.mock.calls[1][1]).toMatchObject({ credentials: 'include', headers: { 'X-CSRF-Token': csrfToken } })
      expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({ docId: 'doc' })
      current.resolve({ ...response(200, dto(principalId)), headers: { get: () => 'application/json' } }); await pending; await session._capabilitiesPromise
      expect(identity.getState().principalId).toBe(principalId); expect(session.user.id).toBe(principalId); expect(session.can('canView')).toBe(true)
      expect(h.vm.visible).toBe(false); expect(h.vm.message).toBe(''); expect(seen).toContain(null)
      expect(events.slice(0, 2)).toEqual([['capabilities', 'authenticating'], ['identity', 'authenticating']])
      expect(events).toContainEqual(['identity', 'authenticated']); expect(h.raw.request).toHaveBeenCalledOnce()
    } finally { Gate.beforeDestroy.call(h.vm); await session?.dispose(); identity.dispose() }
  })
})
