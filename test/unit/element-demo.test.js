// @vitest-environment jsdom
/* global BigInt */
import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createHttpDocumentBusinessProvider } from '../../src/providers/document-business-http.js'
import { createDemoDocumentBusinessHost } from '../../examples/element-demo-business.js'

const html = fs.readFileSync(path.resolve(__dirname, '../../examples/element-demo.html'), 'utf8')
const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
  .replace(/import[\s\S]*?from\s*['"][^'"]+['"]\s*/g, '')
const settle = async () => { for (let i = 0; i < 24; i++) await Promise.resolve() }
const cleanups = []

function fixture({ initialLocal = false } = {}) {
  document.body.innerHTML = '<button class="h5-demo-controls">测试环境</button><button data-backend-action="login-alice">Alice</button><button data-backend-action="login-bob">Bob</button><button data-backend-action="seed-comment">seed</button><button data-backend-action="query-business">查询原业务操作</button><button data-backend-action="restore-document">恢复文档</button><span id="backend-status"></span><lark-doc id="editor-c"><div class="lark-doc-header-actions"></div></lark-doc>'
  const listeners = new Set(), events = new Map()
  let state = { status: 'idle', principalId: null, generation: 0 }, caps = { canView: false, canComment: false }
  const publish = value => { state = value; listeners.forEach(listener => listener(value)) }
  const session = {
    _authorizationGeneration: 0, _privateIdentityGeneration: 0,
    getProvider: name => session.providers?.[name] || {}, getCapabilities: () => caps,
    can: key => caps[key] === true,
    on: (name, listener) => {
      if (!events.has(name)) events.set(name, new Set())
      events.get(name).add(listener)
      return () => events.get(name)?.delete(listener)
    },
    emit: vi.fn((name, value) => events.get(name)?.forEach(listener => listener(value))),
    createCommentThread: vi.fn(async () => ({ id: 'thread-local' })),
    refreshCapabilities: vi.fn(async () => caps),
  }
  const identity = {
    getState: () => state, getCsrfToken: () => 'csrf',
    refresh: vi.fn(async () => state),
    subscribe: listener => { listeners.add(listener); listener(state); return () => listeners.delete(listener) },
    login: vi.fn(async ({ loginCode }) => {
      publish({ status: 'authenticating', principalId: null, generation: state.generation })
      caps = { canView: true, canComment: true }
      publish({ status: 'authenticated', principalId: loginCode, generation: state.generation + 1 })
      session.emit('capabilities', caps)
      return state
    }),
  }
  let currentSession = initialLocal ? { getCapabilities: () => ({}), on: () => () => {} } : session
  const host = document.getElementById('editor-c')
  let declaredReadonly = false, forcedReadonly = false
  const setReadonly = vi.fn(value => { forcedReadonly = value === true })
  const patchProps = vi.fn(value => {
    if ('readonly' in value) { declaredReadonly = value.readonly === true; setReadonly(value.readonly) }
    if ('onDocumentAction' in value && mountedOptions) mountedOptions.onDocumentAction = value.onDocumentAction
  })
  host.getInstance = () => ({ getSession: () => currentSession, setReadonly, patchProps })
  let mountedOptions
  Object.defineProperty(host, 'options', { configurable: true, get: () => mountedOptions, set: value => {
    mountedOptions = value
    declaredReadonly = value.readonly === true
    currentSession = value.session || currentSession
    queueMicrotask(() => host.dispatchEvent(new Event('lark-doc-ready')))
  } })
  let autoReady = true, nextEpoch = '2', holdReopen = false, failReopen = false
  const bridges = []
  const makeBridge = epoch => {
    let bridgeOptions, bridgeState = { status: 'connecting', epoch: null, revision: '1', lastSeq: '0', pending: [], canWrite: false }
    const setState = value => { bridgeState = { ...bridgeState, ...value }; bridgeOptions?.onState(bridgeState) }
    const ready = () => setState({ status: 'ready', epoch, lastSeq: '1', canWrite: true, principalId: state.principalId })
    const connect = async () => {
      await bridgeOptions.ticket()
      if (failReopen && bridges.indexOf(value)) throw new Error('REOPEN_UNAVAILABLE')
      if (autoReady && (!holdReopen || !bridges.indexOf(value))) ready()
    }
    const value = { ydoc: {}, provider: {}, getState: () => bridgeState,
      connect: vi.fn(connect), resumeAuthorization: vi.fn(connect),
      isolateEpoch: vi.fn(() => setState({ status: 'quarantined', canWrite: false })),
      disconnect: vi.fn(), destroy: vi.fn(() => setState({ status: 'destroyed', canWrite: false })), queryPending: vi.fn(),
      ready, setState, configure: options => { bridgeOptions = options }, requireAuthorization: () => bridgeOptions.onAuthorizationRequired() }
    bridges.push(value); return value
  }
  const bridge = makeBridge('1'), readyBridge = bridge.ready
  const runtime = { createDocumentSession: vi.fn(options => {
    session.providers = options.providers
    options.providers.documentBusiness?.bindContext(() => ({ authenticated: state.status === 'authenticated', principalId: state.principalId, generation: state.generation }))
    return session
  }), createDurableCollaborationBridge: vi.fn(options => {
    const value = runtime.createDurableCollaborationBridge.mock.calls.length === 1 ? bridge : makeBridge(nextEpoch)
    value.configure(options); return value
  }),
    createCollabExtensions: vi.fn(() => [{ name: 'collaboration' }]), isRemoteTransaction: vi.fn(),
    createEditorCommentAnchorCodec: vi.fn(value => value) }
  const providerOptions = []
  const createProvider = options => { providerOptions.push(options); return { issueCollaborationTicket: vi.fn(async () => ({ ticket: 'fixture-ticket' })) } }
  let business, businessUnknown = false, businessDenied = false, holdBusiness = false
  const businessReads = []
  const businessRequests = []
  let businessState = { tenantId: 'local-production', docId: 'local-document', principalId: 'alice', status: 'active', title: '测试文档', ownerId: 'alice',
    revision: '3', preferenceRevision: '4', epoch: '1', contentRevision: '1', authzVersion: '8', ownershipEligibilityRevision: 'org-1',
    followed: false, favorite: false, pinned: false, shortcuts: [], capabilities: { canFollow: true, canFavorite: true, canPin: true, canShortcut: true,
      canMove: true, canDuplicate: true, canDelete: true, canRestore: false, canTransferOwnership: true } }
  let latestOperation
  const businessRequest = async (url, init) => {
    businessRequests.push({ url, ...init })
    const respond = (status, data) => ({ status, json: async () => data })
    if (url.endsWith('/business-stream')) return respond(403, {})
    if (url.endsWith('/business-folders')) return respond(200, { items: [{ id: 'folder-write', name: '<授权目录>', canWrite: true }, { id: 'folder-read', name: '只读目录', canWrite: false }] })
    if (url.endsWith('/business-ownership-candidates')) return respond(200, { tenantId: 'local-production', docId: 'local-document', ownerId: 'alice', revision: '3', authzVersion: '8', eligibilityRevision: 'org-1', items: [{ principalId: 'bob', displayName: '<Bob>' }] })
    if (url.includes('/business-operations/')) return respond(200, latestOperation)
    if (init.method !== 'POST') {
      const result = respond(200, { ...businessState, principalId: state.principalId })
      return holdBusiness ? new Promise(resolve => businessReads.push(() => resolve(result))) : result
    }
    if (businessDenied) return respond(403, { code: 'BUSINESS_FORBIDDEN' })
    const input = JSON.parse(init.body), revision = String(BigInt(input.expectedRevision) + 1n)
    latestOperation = { status: 'committed', kind: input.kind, operationId: input.operationId, revision, requestHash: 'sha256:' + 'a'.repeat(64), replayed: false,
      ...(input.kind === 'pin' ? { pinned: input.value } : {}), ...(input.kind === 'shortcut' ? { shortcutId: 'shortcut-1', folderId: input.folderId } : {}),
      ...(input.kind === 'duplicate' ? { newDocId: 'new-document' } : {}), ...(input.kind === 'transfer-ownership' ? { oldOwnerId: 'alice', ownerId: input.targetPrincipalId, targetPrincipalId: input.targetPrincipalId,
        authzVersion: '9', removeOldOwner: input.removeOldOwner, oldOwnerPerm: input.oldOwnerPerm, stayPut: true } : {}) }
    if (['follow', 'favorite', 'pin', 'shortcut'].includes(input.kind)) businessState.preferenceRevision = revision
    else businessState.revision = revision
    if (['follow', 'favorite', 'pin'].includes(input.kind)) businessState[input.kind === 'follow' ? 'followed' : input.kind === 'favorite' ? 'favorite' : 'pinned'] = input.value
    if (['delete', 'restore'].includes(input.kind)) { businessState.status = input.kind === 'delete' ? 'deleted' : 'active'; businessState.capabilities = { ...businessState.capabilities, canDelete: input.kind === 'restore', canRestore: input.kind === 'delete' } }
    return respond(businessUnknown ? 503 : 200, businessUnknown ? { status: 'unknown', operationId: input.operationId } : latestOperation)
  }
  const createBusiness = options => (business = createHttpDocumentBusinessProvider({ ...options, request: businessRequest }))
  const request = vi.fn(async url => ({ ok: true, json: async () => ({ loginCode: url.split('/').pop() }) }))
  const names = ['createHttpIdentityProvider', 'createHttpAssetProvider', 'createHttpAuthorizationProvider', 'createHttpCommentsProvider', 'createHttpNotificationsProvider', 'createHttpResourceProvider', 'createHttpVersioningProvider', 'createHttpDocumentHost', 'receiveHttpDocumentHostIdentity', 'collaborationRuntime', 'fetch', 'window', 'createHttpDocumentBusinessProvider', 'createDemoDocumentBusinessHost']
  const demoWindow = { addEventListener: (name, listener, options) => {
    window.addEventListener(name, listener, options); cleanups.push(() => window.removeEventListener(name, listener, options))
    if (name === 'pagehide') cleanups.push(() => listener(new Event('pagehide')))
  } }
  new Function(...names, script)(() => identity, ...Array(6).fill(createProvider), () => ({ handleAction: vi.fn(() => false), destroy: vi.fn() }), vi.fn(), runtime, request, demoWindow, createBusiness, createDemoDocumentBusinessHost)
  const tap = name => document.querySelector(`[data-backend-action="${name}"]`).click()
  return { session, identity, request, publish, tap, runtime, bridge, bridges, providerOptions, options: () => mountedOptions,
    business: () => business, businessRequests, businessUnknown: () => { businessUnknown = true }, businessDenied: () => { businessDenied = true },
    businessState: patch => { businessState = { ...businessState, ...patch } },
    holdBusiness: () => { holdBusiness = true }, releaseBusiness: () => { holdBusiness = false; businessReads.splice(0).forEach(resolve => resolve()) },
    advanceAuthorization: () => { session._authorizationGeneration++; session.emit('capabilities', caps) },
    readonly: () => declaredReadonly || forcedReadonly,
    holdBridge: () => { autoReady = false }, readyBridge,
    blockBridge: () => bridge.setState({ status: 'blocked', canWrite: false }),
    requireAuthorization: bridge.requireAuthorization,
    pendingBridge: () => bridge.setState({ pending: [{ updateId: 'pending-original', epoch: '1', status: 'unknown' }] }),
    reopenEpoch: value => { nextEpoch = value }, holdReopen: () => { holdReopen = true }, failReopen: () => { failReopen = true },
    setCaps: value => { caps = value; session.emit('capabilities', caps) },
    replaceSession: () => {
      currentSession = { ...session, on: vi.fn(() => () => {}), emit: vi.fn() }
      document.getElementById('editor-c').dispatchEvent(new Event('lark-doc-ready'))
      return currentSession
    },
    capabilityListeners: () => events.get('capabilities')?.size || 0,
    status: () => document.getElementById('backend-status').textContent }
}

afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); vi.restoreAllMocks(); document.body.innerHTML = ''; document.documentElement.classList.remove('h5-demo', 'h5-auth-required') })

describe('Docker demo 身份与评论入口', () => {
  it('loads the current real business provider and routes follow through its authorized CAS command', async () => {
    const f = fixture(); f.tap('login-alice'); await settle()
    const host = f.options().onDocumentAction
    expect(host.supportedActions).toContain('follow')
    expect(f.businessRequests.filter(value => value.method === 'POST')).toEqual([])
    await host({ action: 'follow', actorId: 'alice', documentId: 'local-document' })
    const writes = f.businessRequests.filter(value => value.method === 'POST')
    expect(writes).toHaveLength(1)
    expect(JSON.parse(writes[0].body)).toMatchObject({ kind: 'follow', expectedRevision: '4', value: true })
    expect(f.business().getState().followed).toBe(true)
  })

  it('retires old business permissions and closes a chooser while a new authorization read is pending', async () => {
    const f = fixture(); f.tap('login-alice'); await settle()
    const moving = f.options().onDocumentAction({ action: 'move', actorId: 'alice', documentId: 'local-document' }); await settle()
    expect(document.querySelector('dialog')).not.toBeNull()
    f.holdBusiness(); f.advanceAuthorization(); await settle()
    expect(document.querySelector('dialog')).toBeNull()
    expect(f.options().onDocumentAction.supportedActions).not.toContain('move')
    await moving
    expect(f.businessRequests.filter(value => value.method === 'POST')).toEqual([])
    f.releaseBusiness(); await settle()
    expect(f.options().onDocumentAction.supportedActions).toContain('move')
  })

  it.each([['move', '3'], ['shortcut', '4'], ['duplicate', '3']])('the %s chooser submits only a writable folder with its actual CAS/source', async (action, expectedRevision) => {
    const f = fixture(); f.tap('login-alice'); await settle()
    const running = f.options().onDocumentAction({ action, actorId: 'alice', documentId: 'local-document' }); await settle()
    const dialog = document.querySelector('dialog'), folders = dialog.querySelector('select[name="folderId"]')
    expect([...folders.options].map(value => value.value)).toEqual(['', 'folder-write'])
    expect(folders.textContent).toContain('<授权目录>')
    expect(folders.querySelector('授权目录')).toBeNull()
    folders.value = 'folder-write'
    dialog.querySelector('button[type="submit"]').click()
    expect(await running).toBe(true)
    const writes = f.businessRequests.filter(value => value.method === 'POST')
    expect(writes).toHaveLength(1)
    expect(JSON.parse(writes[0].body)).toMatchObject({ kind: action, expectedRevision, folderId: 'folder-write',
      ...(action === 'duplicate' ? { name: '测试文档 副本', sourceEpoch: '1', sourceRevision: '1' } : {}) })
  })

  it.each(['move', 'duplicate', 'delete', 'transfer-ownership'])('%s Cancel closes its native chooser with zero writes', async action => {
    const f = fixture(); f.tap('login-alice'); await settle()
    const running = f.options().onDocumentAction({ action }); await settle()
    expect(document.querySelector('dialog')).not.toBeNull()
    document.querySelector('dialog button[type="button"]').click()
    expect(await running).toBe(false)
    expect(document.querySelector('dialog')).toBeNull()
    expect(f.businessRequests.filter(value => value.method === 'POST')).toEqual([])
  })

  it('requires typed delete confirmation and uses the existing owner-authorized restore command', async () => {
    const f = fixture(); f.tap('login-alice'); await settle()
    const deleting = f.options().onDocumentAction({ action: 'delete' }); await settle()
    const dialog = document.querySelector('dialog')
    dialog.querySelector('button[type="submit"]').click(); await settle()
    expect(f.businessRequests.filter(value => value.method === 'POST')).toEqual([])
    expect(document.querySelector('dialog')).toBe(dialog)
    dialog.querySelector('input[name="confirmation"]').value = '删除'
    dialog.querySelector('button[type="submit"]').click()
    expect(await deleting).toBe(true)
    expect(f.business().getState().status).toBe('deleted')
    expect(document.querySelector('[data-backend-action="restore-document"]').hidden).toBe(false)
    f.tap('restore-document'); await settle()
    expect(document.querySelector('dialog').getAttribute('aria-label')).toBe('恢复文档')
    document.querySelector('dialog button[type="submit"]').click(); await settle()
    const writes = f.businessRequests.filter(value => value.method === 'POST').map(value => JSON.parse(value.body))
    expect(writes).toMatchObject([{ kind: 'delete', expectedRevision: '3' }, { kind: 'restore', expectedRevision: '4' }])
    expect(f.business().getState().status).toBe('active')
  })

  it('transfers ownership only to a supplied eligibility target with explicit old-owner policy and typed consent', async () => {
    const f = fixture(); f.tap('login-alice'); await settle()
    const running = f.options().onDocumentAction({ action: 'transfer-ownership' }); await settle()
    const dialog = document.querySelector('dialog'), target = dialog.querySelector('select[name="targetPrincipalId"]')
    expect(target.textContent).toContain('<Bob>'); expect(target.querySelector('bob')).toBeNull()
    target.value = 'bob'
    dialog.querySelector('input[name="removeOldOwner"]').checked = true
    dialog.querySelector('select[name="oldOwnerPerm"]').value = 'view'
    dialog.querySelector('button[type="submit"]').click(); await settle()
    expect(f.businessRequests.filter(value => value.method === 'POST')).toEqual([])
    dialog.querySelector('input[name="confirmation"]').value = '转移'
    dialog.querySelector('button[type="submit"]').click()
    expect(await running).toBe(true)
    expect(JSON.parse(f.businessRequests.find(value => value.method === 'POST').body)).toMatchObject({ kind: 'transfer-ownership', expectedRevision: '3', expectedAuthzVersion: '8',
      expectedEligibilityRevision: 'org-1', targetPrincipalId: 'bob', removeOldOwner: true, oldOwnerPerm: 'view', stayPut: true })
  })

  it('keeps an unknown business operation and queries that original key without issuing a second command', async () => {
    const f = fixture(); f.tap('login-alice'); await settle(); f.businessUnknown()
    expect(await f.options().onDocumentAction({ action: 'follow' })).toBe(false)
    const first = JSON.parse(f.businessRequests.find(value => value.method === 'POST').body)
    expect(document.querySelector('[data-backend-action="query-business"]').hidden).toBe(false)
    expect(f.status()).toMatch(/待确认.*原操作/)
    f.tap('login-bob'); await settle()
    expect(f.identity.login).toHaveBeenCalledOnce()
    const unloading = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unloading)
    expect(unloading.defaultPrevented).toBe(true)
    expect(await f.options().onDocumentAction({ action: 'follow' })).toBe(false)
    f.tap('query-business'); await settle()
    expect(f.businessRequests.filter(value => value.method === 'POST')).toHaveLength(1)
    expect(f.businessRequests.some(value => value.url.endsWith('/business-operations/' + first.operationId))).toBe(true)
    expect(f.business().getPending()).toEqual([])
    expect(f.business().getState().followed).toBe(true)
    expect(document.querySelector('[data-backend-action="query-business"]').hidden).toBe(true)
  })

  it('rejects an actor change and a changed duplicate source before any command, and disposes the owned port on pagehide', async () => {
    const f = fixture(); f.tap('login-alice'); await settle()
    const duplicating = f.options().onDocumentAction({ action: 'duplicate' }); await settle()
    document.querySelector('select[name="folderId"]').value = 'folder-write'
    f.bridge.setState({ revision: '2' })
    document.querySelector('dialog button[type="submit"]').click()
    expect(await duplicating).toBe(false)
    expect(f.businessRequests.filter(value => value.method === 'POST')).toEqual([])
    const moving = f.options().onDocumentAction({ action: 'move' }); await settle()
    f.publish({ status: 'authenticated', principalId: 'bob', generation: 9 }); await settle()
    expect(document.querySelector('dialog')).toBeNull()
    expect(await moving).toBe(false)
    expect(f.businessRequests.filter(value => value.method === 'POST')).toEqual([])
    window.dispatchEvent(new Event('pagehide'))
    expect(f.business().getState()).toBeNull()
    expect(f.options().onDocumentAction.supportedActions).not.toContain('move')
  })

  it('preserves a real permission rejection and leaves unsupported document actions unavailable', async () => {
    const f = fixture(); f.tap('login-alice'); await settle(); f.businessDenied()
    expect(await f.options().onDocumentAction({ action: 'pin' })).toBe(false)
    expect(f.business().getState().pinned).toBe(false)
    expect(f.business().getPending()).toEqual([])
    expect(f.options().onDocumentAction.supportedActions).not.toContain('template')
    expect(await f.options().onDocumentAction({ action: 'template' })).toBe(false)
    expect(f.status()).not.toMatch(/置顶已提交/)
    window.dispatchEvent(new Event('pagehide'))
    expect(f.options().onDocumentAction.supportedActions).not.toContain('follow')
  })
  it('isolates unknown restore without opening a new epoch, then reopens only its committed original operation', async () => {
    const f = fixture(); f.tap('login-alice'); await settle()
    f.setCaps({ canView: true, canEdit: true, canRestoreVersion: true })
    const versioning = f.providerOptions[3]
    await versioning.isolateDocument({ status: 'unknown', operationId: 'restore-original', isolationReason: 'RESTORE_RESULT_UNKNOWN' })
    expect(f.readonly()).toBe(true)
    expect(f.bridge.getState().status).toBe('quarantined')
    expect(f.bridges).toHaveLength(1)
    await expect(versioning.reloadDocument({ status: 'unknown', operationId: 'restore-original' })).rejects.toThrow()
    expect(() => versioning.isolateDocument({ status: 'unknown', operationId: 'another-restore' })).toThrow()
    f.setCaps({ canView: true, canEdit: true, canRestoreVersion: true })
    expect(f.readonly()).toBe(true)
    const committed = { status: 'committed', operationId: 'restore-original', preEpoch: '1', postEpoch: '2', isolationReason: 'EPOCH_MISMATCH' }
    await versioning.isolateDocument(committed)
    await versioning.reloadDocument(committed)
    expect(f.bridges).toHaveLength(2)
    expect(f.options().collab.extensions).toBeDefined()
    expect(f.runtime.createCollabExtensions.mock.lastCall[0].ydoc).toBe(f.bridges[1].ydoc)
    expect(versioning.getState()).toMatchObject({ status: 'ready', epoch: '2', pending: [] })
    expect(f.readonly()).toBe(false)
    expect(f.bridge.destroy).toHaveBeenCalledOnce()
    expect(f.session.createCommentThread).not.toHaveBeenCalled()
  })

  it.each(['wrong-epoch', 'identity', 'capability'])('a %s handoff never unlocks the old editor or publishes a stale bridge', async reason => {
    const f = fixture(); f.tap('login-alice'); await settle()
    f.setCaps({ canView: true, canEdit: true, canRestoreVersion: true })
    const versioning = f.providerOptions[3]
    const committed = { status: 'committed', operationId: 'restore-original', preEpoch: '1', postEpoch: '2', isolationReason: 'EPOCH_MISMATCH' }
    await versioning.isolateDocument(committed)
    if (reason === 'wrong-epoch') f.reopenEpoch('1')
    else f.holdReopen()
    const reopening = versioning.reloadDocument(committed).catch(error => error)
    await settle()
    if (reason === 'identity') f.publish({ status: 'authenticated', principalId: 'bob', generation: 9 })
    if (reason === 'capability') { f.setCaps({ canView: false }); f.setCaps({ canView: true, canEdit: true, canRestoreVersion: true }) }
    f.bridges[1]?.ready()
    const result = await reopening
    expect(result).toBeInstanceOf(Error)
    expect(f.readonly()).toBe(true)
    expect(f.runtime.createCollabExtensions).toHaveBeenCalledTimes(1)
    expect(f.status()).not.toContain('当前文档已重新加载')
  })

  it('retains and fences old-epoch pending updates instead of copying them to the new bridge', async () => {
    const f = fixture(); f.tap('login-alice'); await settle()
    f.setCaps({ canView: true, canEdit: true, canRestoreVersion: true }); f.pendingBridge()
    const versioning = f.providerOptions[3]
    const committed = { status: 'committed', operationId: 'restore-original', preEpoch: '1', postEpoch: '2', isolationReason: 'EPOCH_MISMATCH' }
    await versioning.isolateDocument(committed)
    await versioning.reloadDocument(committed)
    expect(f.bridge.getState().pending).toEqual([{ updateId: 'pending-original', epoch: '1', status: 'unknown' }])
    expect(f.bridge.getState().status).toBe('quarantined')
    expect(f.bridge.destroy).not.toHaveBeenCalled()
    expect(f.bridges[1].getState().pending).toEqual([])
    expect(f.bridge.queryPending).not.toHaveBeenCalled()
    const unloading = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unloading)
    expect(unloading.defaultPrevented).toBe(true)
    f.tap('login-bob'); await settle()
    expect(f.identity.login).toHaveBeenCalledOnce()
  })

  it('a failed reopen keeps the committed fact and readonly editor without retrying a write', async () => {
    const f = fixture(); f.tap('login-alice'); await settle()
    f.setCaps({ canView: true, canEdit: true, canRestoreVersion: true }); f.failReopen()
    const versioning = f.providerOptions[3]
    const committed = { status: 'committed', operationId: 'restore-original', preEpoch: '1', postEpoch: '2', isolationReason: 'EPOCH_MISMATCH' }
    await versioning.isolateDocument(committed)
    await expect(versioning.reloadDocument(committed)).rejects.toThrow('REOPEN_UNAVAILABLE')
    expect(f.readonly()).toBe(true)
    expect(f.status()).toMatch(/恢复已提交.*重新打开尚未完成/)
    expect(f.runtime.createCollabExtensions).toHaveBeenCalledTimes(1)
    expect(f.session.createCommentThread).not.toHaveBeenCalled()
  })
  it('unlocks the declarative readonly gate only for the mounted writable bridge and current edit capability', async () => {
    const f = fixture(); f.tap('login-alice'); await settle()
    expect(f.readonly()).toBe(true)
    f.setCaps({ canView: true, canComment: true, canEdit: true }); await settle()
    expect(f.readonly()).toBe(false)
    f.blockBridge(); await settle()
    expect(f.readonly()).toBe(true)
    f.readyBridge(); await settle()
    expect(f.readonly()).toBe(false)
    f.setCaps({ canView: true, canComment: true, canEdit: false }); await settle()
    expect(f.readonly()).toBe(true)
  })

  it('keeps the test login launcher reachable after the protected header loses view access', async () => {
    document.documentElement.classList.add('h5-demo')
    const f = fixture(); f.tap('login-alice'); await settle()
    const launcher = document.querySelector('.h5-demo-controls')
    expect(launcher.parentElement.className).toBe('lark-doc-header-actions')
    f.publish({ status: 'unknown', principalId: null }); await settle()
    expect(launcher.parentElement).toBe(document.body)
    expect(document.documentElement.classList.contains('h5-auth-required')).toBe(true)
  })

  it('automatic authorization recovery reconnects without resetting the bridge retry budget', async () => {
    const f = fixture(); f.tap('login-alice'); await settle()
    expect(f.bridge.resumeAuthorization).toHaveBeenCalledOnce()
    f.requireAuthorization(); f.requireAuthorization(); await settle()
    expect(f.session.refreshCapabilities).toHaveBeenCalledOnce()
    expect(f.bridge.connect).toHaveBeenCalledOnce()
    expect(f.bridge.resumeAuthorization).toHaveBeenCalledOnce()
  })

  it('uses a real collaboration state/codec and waits for ready before mounting or seeding', async () => {
    const f = fixture({ initialLocal: true }); f.holdBridge(); f.tap('login-alice'); await settle()
    expect(f.session.createCommentThread).not.toHaveBeenCalled()
    expect(f.runtime.createDocumentSession).toHaveBeenCalledWith(expect.objectContaining({ mode: 'collaborative' }))
    expect(f.options()).toBeUndefined()
    f.readyBridge(); await settle()
    expect(f.options().session).toBe(f.session)
    expect(f.options().content).toBe('')
    expect(f.identity.refresh).toHaveBeenCalledOnce()
    expect(f.runtime.createCollabExtensions).toHaveBeenCalledWith(expect.objectContaining({ ydoc: f.bridge.ydoc }))
    const common = f.providerOptions[0]
    expect(common.getState()).toEqual(f.bridge.getState())
    const editor = {}
    common.getAnchorCodec(editor)
    expect(f.runtime.createEditorCommentAnchorCodec).toHaveBeenCalledWith({ editor, ydoc: f.bridge.ydoc })
    f.tap('seed-comment'); await settle()
    expect(f.session.createCommentThread).toHaveBeenCalledOnce()
  })

  it('login connects collaboration without implicitly writing another demo comment', async () => {
    const f = fixture(); f.tap('login-alice'); await settle()
    expect(f.status()).toMatch(/协同正文已连接/)
    expect(f.session.createCommentThread).not.toHaveBeenCalled()
    expect(f.session.emit).toHaveBeenCalledWith('comments-changed', { source: 'editor-mounted' })
    f.tap('seed-comment'); await settle()
    expect(f.session.createCommentThread).toHaveBeenCalledOnce()
  })

  it('does not exchange another actor cookie while original collaboration updates are unconfirmed', async () => {
    const f = fixture(); f.tap('login-alice'); await settle(); f.pendingBridge()
    f.tap('login-bob'); await settle()
    expect(f.identity.login).toHaveBeenCalledOnce()
    expect(document.querySelector('[data-backend-action="login-bob"]').disabled).toBe(true)
    expect(document.querySelector('[data-backend-action="login-bob"]').title).toMatch(/未确认|待确认/)
  })

  it('登录沿用 Session 自动复权，种子提交后通知当前面板刷新', async () => {
    const f = fixture(); f.tap('login-alice'); await settle(); f.tap('seed-comment'); await settle()
    expect(f.identity.login).toHaveBeenCalledOnce()
    expect(f.session.refreshCapabilities).not.toHaveBeenCalled()
    expect(f.session.createCommentThread).toHaveBeenCalledOnce()
    expect(f.session.emit).toHaveBeenCalledWith('comments-changed', expect.any(Object))
    expect(f.status()).toMatch(/alice.*已登录/)
  })

  it('显式重复点击只允许一个登录流程，不能交错 Cookie 身份', async () => {
    const f = fixture(); f.tap('login-alice'); f.tap('login-bob'); await settle()
    expect(f.request).toHaveBeenCalledOnce()
    expect(f.identity.login).toHaveBeenCalledOnce()
  })

  it('短租约失效即时更新文案并关闭种子入口，重新显式登录可恢复', async () => {
    const f = fixture(); f.tap('login-alice'); await settle()
    f.publish({ status: 'unknown', principalId: null }); await settle()
    expect(f.status()).toMatch(/重新登录/)
    expect(document.querySelector('[data-backend-action="seed-comment"]').disabled).toBe(true)
    f.tap('login-bob'); await settle()
    expect(f.status()).toMatch(/bob.*已登录/)
  })

  it('种子创建失败保留已认证事实，不能误报登录失败', async () => {
    const f = fixture(); f.session.createCommentThread.mockRejectedValue(new Error('COMMENT_UNAVAILABLE'))
    f.tap('login-alice'); await settle(); f.tap('seed-comment'); await settle()
    expect(f.status()).toMatch(/alice.*已登录.*评论.*失败/)
    expect(f.status()).not.toContain('登录失败')
  })

  it.each(['resolve', 'reject'])('种子尚未完成就失效，%s 也不能覆盖重新登录提示', async outcome => {
    const f = fixture()
    let complete, fail
    f.session.createCommentThread.mockImplementationOnce(() => new Promise((resolve, reject) => { complete = resolve; fail = reject }))
    f.tap('login-alice'); await settle(); f.session.emit.mockClear(); f.tap('seed-comment'); await settle()
    f.publish({ status: 'unknown', principalId: null })
    if (outcome === 'resolve') complete({ id: 'old-thread' })
    else fail(new Error('COMMENT_UNAVAILABLE'))
    await settle()
    expect(f.status()).toMatch(/重新登录/)
    expect(f.session.emit).not.toHaveBeenCalledWith('comments-changed', expect.any(Object))
  })

  it('同一身份的权限撤回和恢复同步关闭、开放创建入口', async () => {
    const f = fixture(); f.tap('login-alice'); await settle()
    const seed = document.querySelector('[data-backend-action="seed-comment"]')
    f.setCaps({ canView: true, canComment: false })
    expect(seed.disabled).toBe(true)
    f.setCaps({ canView: true, canComment: true })
    expect(seed.disabled).toBe(false)
  })

  it('seed 等待时替换 Session，旧结果不能通知新旧面板且旧订阅被取消', async () => {
    const f = fixture()
    let complete
    f.session.createCommentThread.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
    f.tap('login-alice'); await settle(); f.session.emit.mockClear(); f.tap('seed-comment'); await settle()
    expect(f.capabilityListeners()).toBe(1)
    const next = f.replaceSession()
    expect(f.capabilityListeners()).toBe(0)
    complete({ id: 'old-thread' }); await settle()
    expect(f.session.emit).not.toHaveBeenCalledWith('comments-changed', expect.any(Object))
    expect(next.emit).not.toHaveBeenCalled()
    expect(f.status()).not.toContain('演示评论已创建')
  })
})
