// E1 injected browser HTTP/identity ports; not real SSO, company identity, mTLS, PG, or production expiry acceptance.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash, webcrypto } from 'node:crypto'
import { createHttpIdentityProvider, createIdentityProvider } from '../../src/providers/identity'
import { createDocumentSession } from '../../src/session/DocumentSession'
import commentsMixin from '../../src/components/lark-doc/editor/commentsMixin'
const code = 'fixture-only-opaque-code', operationId = 'login-original', csrf = 'A'.repeat(43)
const sha = value => 'sha256:' + createHash('sha256').update(value, 'utf8').digest('hex')
const authenticated = (extra = {}) => ({ status: 'authenticated', principalId: 'alice', canCreate: false, csrfToken: csrf, refreshAfterMs: 1000, expiresInMs: 4000, ...extra })
const response = (status, data) => ({ status, headers: { get: name => name.toLowerCase() === 'content-type' ? 'application/json' : null }, json: async () => data })
const held = () => { let release; const promise = new Promise(resolve => { release = resolve }); return { promise, release } }
const owned = new Set()
const client = request => { const provider = createHttpIdentityProvider({ baseUrl: '/api', tenantId: 'tenant', docId: 'doc', request }); owned.add(provider); return provider }
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100000); vi.stubGlobal('crypto', webcrypto) })
afterEach(async () => { for (const value of Array.from(owned).reverse()) await value.dispose(); owned.clear(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('显式恢复公共链接Cookie会话', () => {
  it('正常已认证身份必须先取得代际绑定许可，期间不刷新Cookie；成功仍只信服务器/current', async () => {
    const gate = held(), request = vi.fn().mockResolvedValueOnce(response(200, authenticated())).mockImplementation(() => gate.promise), port = client(request)
    await port.login({ operationId, loginCode: code })
    await expect(port.resumeCurrentSession({ csrfToken: csrf })).rejects.toMatchObject({ code: 'IDENTITY_ORIGINAL_KEY_REQUIRED' })
    const permit = port.prepareShareLinkAccess(); expect(permit.current()).toBe(true)
    await vi.advanceTimersByTimeAsync(1000); expect(request).toHaveBeenCalledOnce()
    await expect(port.refresh()).rejects.toMatchObject({ code: 'IDENTITY_SHARE_LINK_PENDING' })
    const nextCsrf = 'B'.repeat(43), pending = permit.resumeCurrentSession({ csrfToken: nextCsrf })
    expect(port.getState()).toMatchObject({ status: 'authenticating', principalId: null }); expect(permit.current()).toBe(false)
    expect(request.mock.calls[1][0]).toMatch(/\/current$/); expect(request.mock.calls[1][1].headers['X-CSRF-Token']).toBe(nextCsrf)
    gate.release(response(200, authenticated({ principalId: 'guest-link-' + 'a'.repeat(40), csrfToken: nextCsrf })))
    await expect(pending).resolves.toMatchObject({ status: 'authenticated', principalId: 'guest-link-' + 'a'.repeat(40) })
    await expect(permit.resumeCurrentSession({ csrfToken: nextCsrf })).rejects.toMatchObject({ code: 'IDENTITY_CONTEXT_CHANGED' })
  })
  it('未决login、authenticating及在途refresh在unlock前拒绝；不得退休原登录键', async () => {
    const unknown = client(async () => response(503, { status: 'unknown', code: 'COMMIT_UNKNOWN', operationId }))
    await unknown.login({ operationId, loginCode: code }); expect(() => unknown.prepareShareLinkAccess()).toThrow('ORIGINAL_KEY_REQUIRED')
    expect(unknown.getState().operations).toEqual([{ operationId, codeHash: sha(code), status: 'unknown' }])
    const gate = held(), reached = held(), request = vi.fn().mockResolvedValueOnce(response(200, authenticated())).mockImplementation(() => { reached.release(); return gate.promise }), port = client(request)
    await port.login({ operationId, loginCode: code }); const refreshing = port.refresh(); await reached.promise
    expect(() => port.prepareShareLinkAccess()).toThrow('ORIGINAL_KEY_REQUIRED'); gate.release(response(200, authenticated())); await refreshing
    const opening = client(() => new Promise(() => {})); void opening.resumeCurrentSession({ csrfToken: csrf }).catch(() => {})
    expect(() => opening.prepareShareLinkAccess()).toThrow('ORIGINAL_KEY_REQUIRED')
  })
  it('许可不延长原lease，销毁和取消后均不能复用', async () => {
    const request = vi.fn(async () => response(200, authenticated())), port = client(request)
    await port.login({ operationId, loginCode: code }); const expired = port.prepareShareLinkAccess()
    await vi.advanceTimersByTimeAsync(4000); expect(expired.current()).toBe(false); expect(port.getState().status).toBe('unknown')
    await expect(expired.resumeCurrentSession({ csrfToken: csrf })).rejects.toMatchObject({ code: 'IDENTITY_CONTEXT_CHANGED' })
    await port.login({ operationId: 'fresh', loginCode: 'fresh-code' }); const cancelled = port.prepareShareLinkAccess(); cancelled.cancel(true)
    expect(cancelled.current()).toBe(false); await vi.advanceTimersByTimeAsync(1000); expect(request.mock.calls.at(-1)[0]).toMatch(/\/current$/)
    const retired = port.prepareShareLinkAccess(); port.dispose(); expect(retired.current()).toBe(false)
    await expect(retired.resumeCurrentSession({ csrfToken: csrf })).rejects.toMatchObject({ code: 'IDENTITY_CONTEXT_CHANGED' })
  })
  it('同provider正常登录A→B→A也使旧许可失效，不能通过相同最终主体复用', async () => {
    let who = 'alice'
    const request = vi.fn(async () => response(200, authenticated({ principalId: who }))), port = client(request)
    await port.login({ operationId, loginCode: code }); const permit = port.prepareShareLinkAccess()
    who = 'bob'; await port.login({ operationId: 'login-bob', loginCode: 'bob-code' })
    who = 'alice'; await port.login({ operationId: 'login-alice-again', loginCode: 'alice-code' })
    expect(port.getState().principalId).toBe('alice'); expect(permit.current()).toBe(false)
    await expect(permit.resumeCurrentSession({ csrfToken: csrf })).rejects.toMatchObject({ code: 'IDENTITY_CONTEXT_CHANGED' })
    expect(request.mock.calls.every(([url]) => !url.endsWith('/current'))).toBe(true)
  })
  it('只提交CSRF，等待服务端当前会话核对后才公开身份', async () => {
    const gate = held(), request = vi.fn(() => gate.promise), port = client(request)
    const pending = port.resumeCurrentSession({ csrfToken: csrf })
    expect(port.getState().status).toBe('authenticating'); expect(port.getState().principalId).toBeNull()
    expect(request.mock.calls[0][0]).toMatch(/\/sessions\/current$/)
    expect(request.mock.calls[0][1]).toMatchObject({ credentials: 'include', headers: { 'X-CSRF-Token': csrf } })
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ docId: 'doc' })
    gate.release(response(200, authenticated({ principalId: 'guest-opaque' })))
    await expect(pending).resolves.toMatchObject({ status: 'authenticated', principalId: 'guest-opaque' })
    expect(JSON.stringify(port.getState())).not.toContain(csrf)
    await expect(port.resumeCurrentSession({ csrfToken: csrf })).rejects.toMatchObject({ code: 'IDENTITY_ORIGINAL_KEY_REQUIRED' })
  })
  it('旧登录原操作未知时不可用新bootstrap替换；拒绝伪造主体或能力', async () => {
    const request = vi.fn(async() => response(503, { status: 'unknown', code: 'COMMIT_UNKNOWN', operationId })), port = client(request)
    await port.login({ operationId, loginCode: code })
    await expect(port.resumeCurrentSession({ csrfToken: csrf })).rejects.toMatchObject({ code: 'IDENTITY_ORIGINAL_KEY_REQUIRED' })
    await expect(port.resumeCurrentSession({ csrfToken: csrf, principalId: 'forged' })).rejects.toMatchObject({ code: 'IDENTITY_CSRF_REQUIRED' })
    expect(request).toHaveBeenCalledOnce()
  })
  it('撤销的guest Cookie仅得到denied；销毁后迟成功不能回填', async () => {
    const denied = client(async() => response(401, { status: 'denied', code: 'IDENTITY_DENIED' }))
    await expect(denied.resumeCurrentSession({ csrfToken: csrf })).resolves.toMatchObject({ status: 'denied', principalId: null })
    const gate = held(), late = client(() => gate.promise), pending = late.resumeCurrentSession({ csrfToken: csrf })
    late.dispose(); gate.release(response(200, authenticated({ principalId: 'guest-opaque' })))
    await expect(pending).rejects.toMatchObject({ code: 'IDENTITY_CONTEXT_CHANGED' })
    expect(late.getState().status).toBe('disposed')
  })
})

describe('production identity client original-key and short-lease lifecycle', () => {
  it('exchanges a real code SHA exactly once with Cookie semantics, exposes no code/token/CSRF in public state, and exports the optional normalizer', async () => {
    const request = vi.fn(async () => response(200, authenticated())), port = client(request), states = []; port.subscribe(value => states.push(value))
    expect(createIdentityProvider(port)).toBe(port); expect(() => createIdentityProvider({})).toThrow(/identity Provider/)
    await expect(port.login({ operationId, loginCode: code })).resolves.toMatchObject({ status: 'authenticated', principalId: 'alice' })
    expect(request).toHaveBeenCalledOnce(); expect(request.mock.calls[0][0]).toBe('/api/editor/v1/tenants/tenant/sessions')
    expect(request.mock.calls[0][1]).toMatchObject({ method: 'POST', credentials: 'include', cache: 'no-store', redirect: 'error', headers: { 'Content-Type': 'application/json' } })
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ docId: 'doc', operationId, loginCode: code })
    expect(port.getState().operations).toEqual([{ operationId, codeHash: sha(code), status: 'authenticated' }]); expect(port.getCsrfToken()).toBe(csrf)
    expect(JSON.stringify(states)).not.toContain(code); expect(JSON.stringify(states)).not.toContain(csrf); expect(JSON.stringify(states)).not.toContain('sessionToken')
    expect(Object.isFrozen(port.getState())).toBe(true); expect(Object.isFrozen(port.getState().operations[0])).toBe(true)
  })
  it('unknown string login keeps the original operation and hashes the code but only queries; different intent requires an explicit new ID', async () => {
    const request = vi.fn().mockResolvedValueOnce(response(503, { status: 'unknown', code: 'COMMIT_UNKNOWN', operationId })).mockResolvedValue(response(200, authenticated()))
    const port = client(request); await expect(port.login({ operationId, loginCode: code })).resolves.toMatchObject({ status: 'unknown', operationId })
    await expect(port.login('different-code')).rejects.toMatchObject({ code: 'IDEMPOTENCY_MISMATCH' }); expect(request).toHaveBeenCalledOnce()
    await port.login(code)
    expect(request.mock.calls[1][0]).toMatch(/\/sessions\/query$/); expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({ docId: 'doc', operationId, codeHash: sha(code) })
    expect(request.mock.calls[1][1].body).not.toContain(code)
    await port.login({ operationId: 'login-new', loginCode: 'new-fixture-code' }); expect(JSON.parse(request.mock.calls[2][1].body).operationId).toBe('login-new')
  })
  it('preserves a permitted opaque mapped principal rather than imposing tenant/op identifier syntax', async () => {
    const port = client(async () => response(200, authenticated({ principalId: 'staff:用户' })))
    await expect(port.login({ operationId, loginCode: code })).resolves.toMatchObject({ status: 'authenticated', principalId: 'staff:用户' })
  })
  it('a fresh provider can query only the original operation/hash and cannot accept a changed codeHash or resend code', async () => {
    const request = vi.fn(async () => response(200, authenticated())), port = client(request)
    await port.queryLogin({ operationId, codeHash: sha(code) }); expect(request.mock.calls[0][0]).toMatch(/\/query$/)
    await expect(port.queryLogin({ operationId, codeHash: sha('changed') })).rejects.toMatchObject({ code: 'IDEMPOTENCY_MISMATCH' })
    await expect(port.queryLogin({ operationId, codeHash: sha(code), loginCode: code })).rejects.toMatchObject({ code: 'IDENTITY_ORIGINAL_KEY_REQUIRED' })
    expect(request).toHaveBeenCalledOnce()
  })
  it('timer refresh uses only CSRF/docId, unknown stops all automatic calls, last CSRF is reserved for explicit logout', async () => {
    const request = vi.fn().mockResolvedValueOnce(response(200, authenticated({ refreshAfterMs: 250 }))).mockResolvedValueOnce(response(503, { status: 'unknown', code: 'IDENTITY_UNKNOWN' })).mockResolvedValue(response(200, { status: 'signed-out' }))
    const port = client(request); await port.login({ operationId, loginCode: code }); await vi.advanceTimersByTimeAsync(250)
    expect(request.mock.calls[1][0]).toMatch(/\/current$/); expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({ docId: 'doc' }); expect(request.mock.calls[1][1].headers['X-CSRF-Token']).toBe(csrf)
    expect(port.getState().status).toBe('unknown'); expect(port.getCsrfToken()).toBeNull(); await vi.advanceTimersByTimeAsync(5000); expect(request).toHaveBeenCalledTimes(2)
    await expect(port.logout()).resolves.toMatchObject({ status: 'signed-out' }); expect(request.mock.calls[2][0]).toMatch(/\/logout$/); expect(request.mock.calls[2][1].headers['X-CSRF-Token']).toBe(csrf)
    expect(port.getCsrfToken()).toBeNull()
  })
  it('denied is inactive immediately and does not run another timer refresh', async () => {
    const request = vi.fn().mockResolvedValueOnce(response(200, authenticated())).mockResolvedValue(response(401, { status: 'denied', code: 'IDENTITY_DENIED' })), port = client(request)
    await port.login({ operationId, loginCode: code }); await expect(port.refresh()).resolves.toMatchObject({ status: 'denied', principalId: null, requiresLogin: true }); expect(port.getCsrfToken()).toBeNull()
    await vi.advanceTimersByTimeAsync(5000); expect(request).toHaveBeenCalledTimes(2)
  })
  it('query cannot extend a known lease, local expiry cannot be revived by query, and a new SSO intent remains explicit', async () => {
    const request = vi.fn().mockResolvedValueOnce(response(200, authenticated({ expiresInMs: 1000, refreshAfterMs: 250 }))).mockResolvedValueOnce(response(503, { status: 'unknown', code: 'IDENTITY_UNKNOWN' })).mockResolvedValue(response(200, authenticated()))
    const port = client(request); await port.login({ operationId, loginCode: code }); await vi.advanceTimersByTimeAsync(100); await port.refresh(); await port.queryLogin(operationId)
    expect(port.getState().status).toBe('authenticated'); expect(port.getState().expiresInMs).toBeLessThanOrEqual(900)
    // Stop the automatic current call before advancing beyond the original lease.
    request.mockResolvedValueOnce(response(503, { status: 'unknown', code: 'IDENTITY_UNKNOWN' })); await vi.advanceTimersByTimeAsync(1000)
    await port.queryLogin(operationId); expect(port.getState()).toMatchObject({ status: 'unknown', requiresLogin: true }); expect(port.getCsrfToken()).toBeNull()
    await port.login({ operationId: 'new-sso-after-expiry', loginCode: 'fresh-fixture-code' }); expect(port.getState().status).toBe('authenticated')
  })
  it('subtracts the whole request round trip and refuses an authenticated DTO with zero remaining lifetime', async () => {
    const wait = held(), entered = held(), request = vi.fn(() => { entered.release(); return wait.promise }), port = client(request)
    const pending = port.login({ operationId, loginCode: code }); await entered.promise; await vi.advanceTimersByTimeAsync(1100); wait.release(response(200, authenticated({ expiresInMs: 1000, refreshAfterMs: 250 })))
    await expect(pending).resolves.toMatchObject({ status: 'unknown', requiresLogin: true }); expect(port.getCsrfToken()).toBeNull(); expect(request).toHaveBeenCalledOnce()
  })
  it.each([
    { expiresInMs: undefined }, { expiresInMs: 999 }, { expiresInMs: 4001 }, { expiresInMs: 1000, refreshAfterMs: 334 }, { refreshAfterMs: 249 },
    { principalId: 'other\n' }, { csrfToken: 'fake' }, { canCreate: true }, { accessToken: 'never-store' },
  ])('strict authenticated DTO rejects old/malformed fields %j without emitting an identity', async extra => {
    const value = authenticated(extra); if (extra.expiresInMs === undefined && Object.prototype.hasOwnProperty.call(extra, 'expiresInMs')) delete value.expiresInMs
    const port = client(async () => response(200, value)), states = []; port.subscribe(state => states.push(state))
    await expect(port.login({ operationId, loginCode: code })).rejects.toMatchObject({ code: 'IDENTITY_REQUEST_UNKNOWN' }); expect(states.some(state => state.status === 'authenticated')).toBe(false)
  })
  it('rejects invalid scope/base/extra credentials, real UTF8 oversize, and malformed query hashes before transport', async () => {
    const request = vi.fn(), port = client(request)
    for (const baseUrl of ['//other', 'https://u:p@other', 'http://other.example', '/api/../x', '/api?secret=1']) expect(() => createHttpIdentityProvider({ tenantId: 'tenant', docId: 'doc', baseUrl, request })).toThrow()
    expect(() => createHttpIdentityProvider({ tenantId: 'tenant/other', docId: 'doc', request })).toThrow()
    for (const extra of [{ loginCode: 'é'.repeat(2049) }, { operationId: 'bad\n' }, { principalId: 'forged' }, { headers: { Cookie: 'secret' } }, { loginCode: '\ud800' }]) await expect(port.login({ operationId, loginCode: code, ...extra })).rejects.toBeInstanceOf(Error)
    await expect(port.queryLogin({ operationId, codeHash: sha(code) + '\n' })).rejects.toBeInstanceOf(Error); expect(request).not.toHaveBeenCalled()
  })
  it('rejects bad MIME, redirects, HTTP/status mismatch and a mismatched original unknown key', async () => {
    for (const raw of [response(200, { status: 'unknown', code: 'IDENTITY_UNKNOWN' }), response(503, { status: 'unknown', code: 'IDENTITY_UNKNOWN', operationId: 'other' }), response(401, authenticated()),
      { ...response(200, authenticated()), redirected: true }, { ...response(200, authenticated()), headers: { get: () => 'text/html' } }]) {
      const port = client(async () => raw); await expect(port.login({ operationId, loginCode: code })).rejects.toMatchObject({ code: 'IDENTITY_REQUEST_UNKNOWN' }); expect(port.getState().status).toBe('unknown'); expect(port.getCsrfToken()).toBeNull()
    }
  })
  it('accepts a code exactly at the real UTF8 limit and captures caller code/key before await', async () => {
    const entered = held(), release = held(), text = 'é'.repeat(2048), original = { operationId, loginCode: text }
    const request = vi.fn((url, init) => { entered.release(); return release.promise }), port = client(request), pending = port.login(original)
    original.loginCode = 'mutated'; original.operationId = 'mutated'
    await entered.promise; expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ docId: 'doc', operationId, loginCode: text }); release.release(response(200, authenticated())); await pending
    expect(port.getState().operations).toEqual([{ operationId, codeHash: sha(text), status: 'authenticated' }])
  })
  it.each(['request', 'json'])('dispose while awaiting %s drops old success, aborts transport and never exposes credentials in state', async phase => {
    const wait = held(), entered = held(), raw = response(200, authenticated())
    if (phase === 'json') raw.json = () => { entered.release(); return wait.promise }
    const request = vi.fn((url, init) => { if (phase === 'request') { entered.release(); return wait.promise } return raw }), port = client(request), states = []; port.subscribe(value => states.push(value))
    const pending = port.login({ operationId, loginCode: code }).catch(error => error); await entered.promise; port.dispose(); wait.release(phase === 'request' ? raw : authenticated())
    expect(await pending).toMatchObject({ code: 'IDENTITY_CONTEXT_CHANGED' }); expect(request.mock.calls[0][1].signal.aborted).toBe(true); expect(port.getState()).toMatchObject({ status: 'disposed', principalId: null, operations: [] })
    expect(states.some(value => value.status === 'authenticated')).toBe(false)
  })
  it('reentrant logout suppresses the old authenticated state for later subscribers and the login caller', async () => {
    const port = client(vi.fn().mockResolvedValueOnce(response(200, authenticated())).mockResolvedValue(response(200, { status: 'signed-out' }))), later = []
    port.subscribe(state => { if (state.status === 'authenticated') void port.logout().catch(() => {}) }); port.subscribe(state => later.push(state))
    await expect(port.login({ operationId, loginCode: code })).rejects.toMatchObject({ code: 'IDENTITY_CONTEXT_CHANGED' }); expect(later.some(state => state.status === 'authenticated')).toBe(false)
  })
})

const capabilities = { canView: true, canEdit: true, canComment: true, canResolveComment: true, canCreateVersion: true, canRestoreVersion: true, canExport: false, canManagePermission: false }
function identity(initial = 'alice') {
  const listeners = new Set(); let generation = 1, value = initial ? { ...authenticated({ principalId: initial }), generation } : { status: 'unknown', principalId: null, generation }
  const port = { getState: () => value, getCsrfToken: () => value.status === 'authenticated' ? csrf : null, login: vi.fn(), queryLogin: vi.fn(), refresh: vi.fn(), logout: vi.fn(),
    subscribe(listener) { listeners.add(listener); listener(value); return () => listeners.delete(listener) },
    publish(principalId, same = false) { if (!same) generation++; value = principalId ? { ...authenticated({ principalId }), generation } : { status: 'unknown', principalId: null, generation }; listeners.forEach(listener => listener(value)) },
    dispose: vi.fn(() => { listeners.clear() }) }
  owned.add(port); return port
}
async function session(extra = {}) {
  const proof = extra.identity || identity(), authorizer = extra.authorization || { getCapabilities: vi.fn(async () => capabilities), reset: vi.fn(), dispose: vi.fn() }
  const value = createDocumentSession({ documentId: 'doc', user: { id: 'forged-host' }, identity: proof, authorization: authorizer, ...extra }); owned.add(value); await value._capabilitiesPromise
  return { value, proof, authorizer }
}
const comments = extra => ({ list: vi.fn(async () => []), createThread: vi.fn(), reply: vi.fn(), resolve: vi.fn(), reopen: vi.fn(), reset: vi.fn(), dispose: vi.fn(), ...extra })
const versionsPort = extra => ({ list: vi.fn(), createSnapshot: vi.fn(), get: vi.fn(), restore: vi.fn(), resetConversions: vi.fn(), ...extra })
const assetsPort = extra => ({ begin: vi.fn(), complete: vi.fn(), getStatus: vi.fn(), getContent: vi.fn(), reset: vi.fn(), ...extra })
const resourcesPort = extra => ({ createOrBind: vi.fn(), queryBinding: vi.fn(), unbind: vi.fn(), requestDeletion: vi.fn(), queryOperation: vi.fn(), ...extra })

describe('DocumentSession production identity boundary', () => {
  it('uses only authenticated principal, ignores host initial user/caps, rejects host replacement, and leaves no-identity local compatibility intact', async () => {
    const { value, proof, authorizer } = await session()
    expect(value.user).toEqual({ id: 'alice' }); expect(Object.isFrozen(value.user)).toBe(true); expect(() => { value.user = { id: 'forged' } }).toThrow('IDENTITY_USER_IS_SERVER_MANAGED')
    expect(authorizer.getCapabilities.mock.calls[0][0].user).toEqual({ id: 'alice' }); expect(value.can('canEdit')).toBe(true)
    proof.publish(null); expect(value.user).toBeNull(); expect(value.can('canView')).toBe(false)
    const local = createDocumentSession({ user: { id: 'host' } }); owned.add(local); local.user = { id: 'other' }; expect(local.user.id).toBe('other'); expect(local.can('canEdit')).toBe(true)
    const inactive = createDocumentSession({ identity: identity(null), user: { id: 'forged' }, capabilities }); owned.add(inactive); expect(inactive.user).toBeNull(); expect(inactive.can('canEdit')).toBe(false)
  })
  it('synchronously clears private translation/source/resource views, resets controllers and disconnects on unknown; stable current does not reset work', async () => {
    const collab = { connect: vi.fn(), disconnect: vi.fn(async () => {}) }, remote = comments(), assets = assetsPort(), versioning = versionsPort()
    const { value, proof, authorizer } = await session({ collaboration: collab, comments: remote, assets, versioning })
    const vm = { ...commentsMixin.data(), ...commentsMixin.methods, session: value, editor: null, refreshCommentDecorations: vi.fn(), loadComments: vi.fn(async () => []) }
    vm.bindCommentSession(); vm.commentThreads = [{ id: 'private' }]; vm.commentSourceThreads = [{ id: 'private' }]; vm.commentTranslationState = { translatedText: 'Alice private text' }; vm.commentPendingTranslationOperation = 'old-key'
    value._resourceOperations.set('old', { result: { private: 'old' } }); assets.reset.mockClear(); collab.disconnect.mockClear(); proof.publish('alice', true)
    expect(assets.reset).not.toHaveBeenCalled(); proof.publish(null)
    expect(value.can('canView')).toBe(false); expect(vm.commentTranslationState).toBeNull(); expect(vm.commentThreads).toEqual([]); expect(vm.commentPendingTranslationOperation).toBe(''); expect(value._resourceOperations.size).toBe(0)
    expect(remote.reset).toHaveBeenCalled(); expect(authorizer.reset).toHaveBeenCalled(); expect(assets.reset).toHaveBeenCalled(); expect(versioning.resetConversions).toHaveBeenCalled(); expect(collab.disconnect).toHaveBeenCalled()
  })
  it('an old capability refresh cannot restore permissions across identity A-B-A even with the same provider', async () => {
    const deferred = held(), entered = held(), getCapabilities = vi.fn(async () => capabilities), authorization = { getCapabilities, reset: vi.fn() }
    const { value, proof } = await session({ authorization })
    getCapabilities.mockImplementationOnce(() => { entered.release(); return deferred.promise })
    const pending = value.refreshCapabilities().catch(error => error); await entered.promise; proof.publish('bob'); proof.publish('alice'); await value._capabilitiesPromise
    deferred.release({ ...capabilities, canExport: true }); expect(await pending).toMatchObject({ code: 'IDENTITY_CONTEXT_CHANGED' }); expect(value.can('canExport')).toBe(false); expect(value.user.id).toBe('alice')
  })
  it('all principal-bound asynchronous read/command return boundaries reject late private results after ABA', async () => {
    for (const kind of ['comments', 'authorization', 'version', 'diff', 'notification', 'binding', 'conversion', 'asset']) {
      const deferred = held(), entered = held(), work = vi.fn(() => { entered.release(); return deferred.promise }), extra = {}
      if (kind === 'comments') extra.comments = comments({ list: work })
      if (kind === 'authorization') extra.authorization = { getCapabilities: async () => capabilities, resolveMentions: work, reset: vi.fn() }
      if (kind === 'version' || kind === 'diff' || kind === 'conversion') extra.versioning = versionsPort({ createSnapshot: work, diff: work, requestExport: work })
      if (kind === 'notification') extra.notifications = { snapshot: work, subscribe: vi.fn(() => () => {}), markRead: vi.fn(), setMuted: vi.fn(), reset: vi.fn(), dispose: vi.fn() }
      if (kind === 'binding') extra.resources = resourcesPort({ queryBinding: work })
      if (kind === 'asset') extra.assets = assetsPort({ getStatus: work })
      const { value, proof } = await session(extra), events = vi.fn(); value.on('comments', events); value.on('authorization-operation', events)
      if (kind === 'version') value.getDocumentRecord = () => ({ documentId: 'doc' })
      if (kind === 'conversion') value._capabilities.canExport = true
      const call = { comments: () => value.listComments(), authorization: () => value.resolveMentions({}), version: () => value.createVersion(), diff: () => value.diffVersions('a', 'b'), notification: () => value.refreshNotifications(), binding: () => value.queryResourceBinding({ sourceSystem: 'fixture', externalResourceId: 'one' }), conversion: () => value.requestExport({}), asset: () => value.getAssetStatus('asset') }[kind]
      const pending = call().then(result => ({ result }), error => ({ error })); await entered.promise; proof.publish('bob'); proof.publish('alice'); await value._capabilitiesPromise
      deferred.release({ private: 'Alice-only-result' }); const outcome = await pending
      expect(outcome.result).toBeUndefined(); expect(outcome.error.code).toBe('IDENTITY_CONTEXT_CHANGED'); expect(JSON.stringify(outcome.error)).not.toContain('Alice-only-result'); expect(events).not.toHaveBeenCalled()
      await value.dispose()
    }
  })
  it('late connect is disconnected again and never emits connected or returns an old handshake', async () => {
    const deferred = held(), entered = held(), collaboration = { connect: vi.fn(() => { entered.release(); return deferred.promise }), disconnect: vi.fn(async () => {}) }
    const { value, proof } = await session({ mode: 'collaborative', collaboration }), events = vi.fn(); value.on('connection', events); collaboration.disconnect.mockClear()
    const pending = value.connect().catch(error => error); await entered.promise; proof.publish(null); deferred.release({ status: 'connected', private: 'old-room' })
    expect(await pending).toMatchObject({ code: 'IDENTITY_CONTEXT_CHANGED' }); expect(collaboration.disconnect.mock.calls.length).toBeGreaterThanOrEqual(2); expect(events).not.toHaveBeenCalled()
  })
  it('private chunk callbacks and resource outcomes cannot slip through after identity invalidation or repopulate a cleared ledger', async () => {
    let captured; const deferred = held(), entered = held(), chunks = vi.fn(), assets = assetsPort({ getContent: vi.fn(input => { captured = input.onChunk; entered.release(); return deferred.promise }) })
    const { value, proof } = await session({ assets }), pending = value.getAssetContent({ assetId: 'asset', onChunk: chunks }).catch(error => error); await entered.promise; proof.publish(null)
    expect(() => captured(new Uint8Array([1]), {})).toThrow('IDENTITY_CONTEXT_CHANGED'); deferred.release({ status: 'completed' }); expect(await pending).toMatchObject({ code: 'IDENTITY_CONTEXT_CHANGED' }); expect(chunks).not.toHaveBeenCalled()
    const waiting = held(), called = held(), { value: scoped, proof: principal } = await session({ resources: resourcesPort({ createOrBind: vi.fn(() => { called.release(); return waiting.promise }) }) })
    const result = scoped.createOrBindResource({ mode: 'create', operationId: 'resource-old', sourceSystem: 'fixture', externalResourceId: 'private' }).catch(error => error); await called.promise; principal.publish(null); waiting.release({ httpStatus: 201, data: { private: 'old' } })
    expect(await result).toMatchObject({ code: 'IDENTITY_CONTEXT_CHANGED' }); expect(scoped._resourceOperations.size).toBe(0)
  })
  it('reentrant subscribers cannot receive or return an old comment result after another subscriber switches identity', async () => {
    const { value, proof } = await session({ comments: comments({ list: async () => [{ private: 'Alice-only' }] }) }), later = vi.fn()
    value.on('comments', () => { proof.publish('bob') }); value.on('comments', later)
    await expect(value.listComments()).rejects.toMatchObject({ code: 'IDENTITY_CONTEXT_CHANGED' }); expect(later).not.toHaveBeenCalled()
  })
  it('identity provider replacement/removal disposes old refresh work and never falls back to host identity/capabilities', async () => {
    const { value, proof } = await session(), next = identity('bob'), changed = vi.fn(); value.on('provider-changed', changed); value.setProvider('identity', next); await value._capabilitiesPromise
    expect(changed).toHaveBeenCalledWith({ name: 'identity' })
    expect(proof.dispose).toHaveBeenCalled(); expect(value.user.id).toBe('bob'); proof.publish('alice'); expect(value.user.id).toBe('bob')
    value.setProvider('identity', null); expect(value.user).toBeNull(); expect(value.can('canView')).toBe(false); expect(() => { value.user = { id: 'host' } }).toThrow('IDENTITY_USER_IS_SERVER_MANAGED')
  })
})
