import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { ReadableStream } from 'node:stream/web'
import { TextEncoder } from 'node:util'
import { createHttpDocumentBusinessProvider } from '../../src/providers/document-business-http'
import { documentMenuChildren, documentMenuItems, runDocumentMenuAction } from '../../src/components/lark-doc/editor/documentMenuView'

const hash = 'sha256:' + 'a'.repeat(64)
const response = (status, data) => ({ status, json: async () => data })
const state = (extra = {}) => ({ tenantId: 'tenant', docId: 'doc', principalId: 'alice', ownerId: 'alice', status: 'active', revision: '8', preferenceRevision: '2',
  authzVersion: '6', ownershipEligibilityRevision: 'approved-org-v1', epoch: '1', contentRevision: '1', followed: false, favorite: false, pinned: false, shortcuts: [],
  capabilities: Object.fromEntries(['canFollow', 'canFavorite', 'canPin', 'canShortcut', 'canTransferOwnership', 'canMove', 'canDuplicate', 'canDelete', 'canRestore'].map(name => [name, true])), ...extra })
const transfer = { kind: 'transfer-ownership', operationId: 'transfer-original', expectedRevision: '8', expectedAuthzVersion: '6', expectedEligibilityRevision: 'approved-org-v1',
  targetPrincipalId: 'bob', removeOldOwner: false, oldOwnerPerm: 'full_access', stayPut: true }
const acknowledgement = (command, extra = {}) => ({ status: 'committed', kind: command.kind, operationId: command.operationId, requestHash: hash,
  revision: String(BigInt(command.expectedRevision) + BigInt(1)), replayed: false, ...(command.kind === 'pin' ? { pinned: command.value } : command.kind === 'shortcut' ? { folderId: command.folderId, shortcutId: 'shortcut-one' } :
    { ownerId: command.targetPrincipalId, targetPrincipalId: command.targetPrincipalId, oldOwnerId: 'alice', authzVersion: '7', removeOldOwner: command.removeOldOwner, oldOwnerPerm: command.oldOwnerPerm, stayPut: true }), ...extra })
function port(request) {
  let identity = { authenticated: true, principalId: 'alice', generation: 1 }
  const value = createHttpDocumentBusinessProvider({ tenantId: 'tenant', docId: 'doc', csrfToken: () => 'csrf', request })
  value.bindContext(() => identity)
  return { value, replace: next => { identity = next } }
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('business projections keep current authority and directory privacy', () => {
  it('older or missing advertised authzVersion cannot restore capabilities', async () => {
    const safe = state({ capabilities: { ...state().capabilities, canMove: false } }), request = vi.fn().mockResolvedValueOnce(response(200, safe)).mockResolvedValueOnce(response(200, state({ authzVersion: '5' })))
    const { value } = port(request); await value.load(); await value.load()
    expect(value.getState().authzVersion).toBe('6'); expect(value.getState().capabilities.canMove).toBe(false)
    const legacy = state({ capabilities: { ...state().capabilities, canTransferOwnership: false } }); delete legacy.authzVersion; delete legacy.ownershipEligibilityRevision
    request.mockResolvedValueOnce(response(200, legacy)); await value.load(); expect(value.getState().authzVersion).toBe('6'); value.reset('disposed')
  })
  it('same-revision folder revocation SSE wins over an already in-flight REST response', async () => {
    let publish, finish, loads = 0
    const wire = { status: 200, headers: { get: () => 'text/event-stream' }, body: new ReadableStream({ start(controller) { publish = controller } }) }
    const privateView = state({ shortcuts: [{ id: 'shortcut-one', folderId: 'folder-one', folderName: 'Synthetic private folder' }] }), safe = state({ shortcuts: [] })
    const request = vi.fn(async url => url.endsWith('/business-events') ? wire : ++loads === 1 ? response(200, privateView) : new Promise(resolve => { finish = resolve }))
    const { value } = port(request); await value.load(); const stop = value.subscribe(() => {}); await Promise.resolve(); await Promise.resolve()
    const old = value.load(); publish.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({ document: safe, foldersChanged: true }) + '\n\n'))
    for (let i = 0; i < 20 && value.getState().shortcuts.length; i++) await Promise.resolve()
    expect(value.getState().shortcuts).toEqual([]); finish(response(200, privateView)); await old
    expect(value.getState().shortcuts).toEqual([]); stop(); value.reset('disposed')
  })
  it('a newer denied load clears private folder state before an older successful load returns', async () => {
    let finish, count = 0
    const privateView = state({ shortcuts: [{ id: 'shortcut-one', folderId: 'private', folderName: 'Synthetic private folder' }] })
    const { value } = port(async () => ++count === 1 ? response(200, privateView) : count === 2 ? new Promise(resolve => { finish = resolve }) : response(404, { code: 'PG_BUSINESS_NOT_FOUND' }))
    await value.load(); const old = value.load(); await expect(value.load()).rejects.toThrow()
    expect(value.getState()).toBeNull(); finish(response(200, privateView)); await old
    expect(value.getState()).toBeNull(); value.reset('disposed')
  })
  it('a queued frame from an aborted stream never restores a hidden folder', async () => {
    let publish
    const wire = { status: 200, headers: { get: () => 'text/event-stream' }, body: new ReadableStream({ start(controller) { publish = controller } }) }
    const { value } = port(async url => url.endsWith('/business-events') ? wire : response(200, state()))
    await value.load(); const stop = value.subscribe(() => {}); await Promise.resolve(); await Promise.resolve()
    publish.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({ document: state({ shortcuts: [{ id: 'old', folderId: 'private', folderName: 'Synthetic stale folder' }] }) }) + '\n\n')); stop()
    for (let i = 0; i < 10; i++) await Promise.resolve()
    expect(value.getState().shortcuts).toEqual([]); value.reset('disposed')
  })
})

describe('persisted pin, shortcut and ownership command contracts', () => {
  it.each([{ kind: 'pin', operationId: 'pin-one', expectedRevision: '2', value: true },
    { kind: 'shortcut', operationId: 'shortcut-one', expectedRevision: '2', folderId: 'folder-one' }, transfer])('unknown %s only queries its immutable original key', async command => {
    const request = vi.fn(async (_url, init) => init.method === 'POST' ? Promise.reject(Error('lost ACK')) : response(200, acknowledgement(command)))
    const { value } = port(request)
    expect(await value.execute(command)).toMatchObject({ status: 'unknown', operationId: command.operationId })
    await expect(value.execute(command)).rejects.toThrow('BUSINESS_QUERY_REQUIRED')
    expect(await value.query(command.operationId)).toMatchObject({ status: 'committed', kind: command.kind })
    expect(request.mock.calls.map(([, init]) => init.method)).toEqual(['POST', 'GET'])
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual(command)
    value.reset('disposed')
  })
  it.each([{ value: 'true' }, { value: true, actorId: 'forged' }])('rejects malformed pin %j before transport', async extra => {
    const request = vi.fn(), { value } = port(request)
    await expect(value.execute({ kind: 'pin', operationId: 'pin-one', expectedRevision: '0', ...extra })).rejects.toThrow('BUSINESS_INVALID_INPUT')
    expect(request).not.toHaveBeenCalled(); value.reset('disposed')
  })
  it.each([{ removeOldOwner: 'true' }, { oldOwnerPerm: 'read' }, { stayPut: false }, { expectedAuthzVersion: 6 }, { targetPrincipalId: 'bob\n' }])('never silently changes the explicit ownership policy %j', async extra => {
    const request = vi.fn(), { value } = port(request)
    await expect(value.execute({ ...transfer, ...extra })).rejects.toThrow('BUSINESS_INVALID_INPUT')
    expect(request).not.toHaveBeenCalled(); value.reset('disposed')
  })
  it('does not accept another target, authority cut, or personal revision as a committed ACK', async () => {
    for (const extra of [{ ownerId: 'carol' }, { authzVersion: '8' }, { revision: '8' }, { stayPut: false }]) {
      const { value } = port(async () => response(200, acknowledgement(transfer, extra)))
      expect(await value.execute(transfer)).toMatchObject({ status: 'unknown' }); expect(value.getPending()).toHaveLength(1); value.reset('disposed')
    }
  })
  it('treats historical ownership ACK as a fact and refreshes current state separately', async () => {
    const request = vi.fn(async (url, init) => init.method === 'POST' ? response(503, { status: 'unknown' }) : url.endsWith('/business') ?
      response(200, state({ ownerId: 'carol', revision: '10', authzVersion: '8', capabilities: { ...state().capabilities, canTransferOwnership: false } })) : response(200, acknowledgement(transfer)))
    const { value } = port(request); await value.execute(transfer)
    expect((await value.query(transfer.operationId)).ownerId).toBe('bob'); expect(value.getState()).toBeNull()
    expect((await value.load()).ownerId).toBe('carol'); value.reset('disposed')
  })
  it('legacy snapshots never advertise native actions they do not support', async () => {
    const legacy = state(); delete legacy.pinned; delete legacy.shortcuts; delete legacy.authzVersion; delete legacy.ownershipEligibilityRevision
    delete legacy.capabilities.canPin; delete legacy.capabilities.canShortcut; delete legacy.capabilities.canTransferOwnership
    const { value } = port(async () => response(200, legacy)); const loaded = await value.load()
    expect(loaded.capabilities).toMatchObject({ canPin: false, canShortcut: false, canTransferOwnership: false }); value.reset('disposed')
  })
  it('a stalled response body reaches the finite deadline and retains only the original query path', async () => {
    vi.useFakeTimers()
    const request = vi.fn(async () => ({ status: 200, json: () => new Promise(() => {}) })), { value } = port(request)
    const pending = value.execute(transfer)
    await vi.advanceTimersByTimeAsync(15000)
    expect(await pending).toMatchObject({ status: 'unknown', operationId: transfer.operationId })
    expect(value.getPending()).toEqual([{ operationId: transfer.operationId, kind: 'transfer-ownership' }]); expect(request).toHaveBeenCalledOnce(); value.reset('disposed')
  })
  it('validates frozen current-owner candidates and ignores a late identity ABA', async () => {
    let finish; const { value, replace } = port(() => new Promise(resolve => { finish = resolve }))
    const pending = value.ownershipCandidates(); value.reset('identity-changed'); replace({ authenticated: true, principalId: 'alice', generation: 3 })
    finish(response(200, { tenantId: 'tenant', docId: 'doc', ownerId: 'alice', revision: '8', authzVersion: '6', eligibilityRevision: 'approved-org-v1', items: [{ principalId: 'bob', displayName: 'Bob' }] }))
    await expect(pending).rejects.toThrow('BUSINESS_CONTEXT_CHANGED'); expect(value.getState()).toBeNull(); value.reset('disposed')
  })
})

const source = readFileSync(new URL('../../src/components/lark-doc/DocumentBusinessDialog.vue', import.meta.url), 'utf8')
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '').replace('export default', 'return')
const component = new Function('LarkDocIcon', script)({})
function dialog(action) {
  const value = { ...component.data(), ...component.methods, action, state: state(), baseline: state(), ed: { localTitle: 'Document' },
    current: () => true, $emit: vi.fn(), $nextTick: fn => fn(), provider: { load: vi.fn(async () => state()) } }
  for (const name of ['selectedOwner', 'selectedFolder', 'canSubmit', 'canCreateFolder', 'retentionSummary', 'deleted', 'visible', 'title']) Object.defineProperty(value, name, { get: () => component.computed[name].call(value) })
  return value
}
describe('native document business interactions', () => {
  it('routes pin and shortcut to the native provider without a host callback', async () => {
    const business = state(), provider = { getState: () => business, ownershipCandidates() {} }, ed = { session: { can: () => true, getProvider: () => provider },
      toolbarEnabled: () => true, featureEnabled: () => true, shareCan: () => true, closeHeaderMenu: vi.fn() }
    expect(documentMenuItems(ed).find(item => item.id === 'pin')).toMatchObject({ kind: 'business', disabled: false })
    expect(await runDocumentMenuAction(ed, 'shortcut')).toBe('business:shortcut')
    expect(await runDocumentMenuAction(ed, 'transfer-ownership')).toBe('business:transfer-ownership')
    expect(documentMenuChildren(ed, 'permissions', null, { ...business, capabilities: { ...business.capabilities, canTransferOwnership: false } }).find(item => item.id === 'transfer-ownership').disabled).toBe(true)
  })
  it('uses preferenceRevision for pin and shortcut without moving source metadata', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'synthetic-operation' })
    const pin = dialog('pin'); pin.perform = vi.fn(); await pin.submit('pin')
    expect(pin.perform).toHaveBeenCalledWith({ kind: 'pin', operationId: 'business-synthetic-operation', expectedRevision: '2', value: true })
    const shortcut = dialog('shortcut'); shortcut.selected = 'folder-one'; shortcut.folders = [{ id: 'folder-one', canWrite: true }]; shortcut.perform = vi.fn(); await shortcut.submit('shortcut')
    expect(shortcut.perform).toHaveBeenCalledWith({ kind: 'shortcut', operationId: 'business-synthetic-operation', expectedRevision: '2', folderId: 'folder-one' })
  })
  it('requires a selected current candidate and a second explicit confirmation before transfer', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'synthetic-operation' })
    const value = dialog('transfer-ownership'); value.candidates = [{ principalId: 'bob', displayName: 'Bob' }]; value.perform = vi.fn()
    value.confirmTransfer(); expect(value.perform).not.toHaveBeenCalled()
    value.selectOwner('bob'); value.confirmTransfer(); expect(value.transferConfirm).toBe(true); expect(value.perform).not.toHaveBeenCalled()
    await value.confirmTransfer()
    expect(value.perform).toHaveBeenCalledWith({ ...transfer, operationId: 'business-synthetic-operation' })
    value.selectOwner('bob'); expect(value.transferConfirm).toBe(false)
    expect(value.retentionSummary).toBe('原所有者保留可管理权限，文档位置保持不变。')
  })
  it.each([{ removeOldOwner: false, oldOwnerPerm: 'full_access' }, { removeOldOwner: false, oldOwnerPerm: 'edit' }, { removeOldOwner: false, oldOwnerPerm: 'view' }, { removeOldOwner: true, oldOwnerPerm: 'full_access' }])('retention %j keeps unknown query-only and verifies the selected policy in ACK', async retention => {
    const input = { ...transfer, ...retention }, request = vi.fn(async (url, init) => init.method === 'POST' ? response(503, { status: 'unknown', operationId: input.operationId }) : response(200, acknowledgement(input))), { value } = port(request)
    expect(await value.execute(input)).toMatchObject({ status: 'unknown' }); await expect(value.execute(input)).rejects.toThrow('QUERY_REQUIRED')
    expect(await value.query(input.operationId)).toMatchObject(retention); expect(request.mock.calls.map(([, init]) => init.method)).toEqual(['POST', 'GET']); value.reset('disposed')
    const wrong = port(async () => response(200, acknowledgement(input, { removeOldOwner: !input.removeOldOwner }))).value
    expect(await wrong.execute(input)).toMatchObject({ status: 'unknown' }); expect(wrong.getPending()).toHaveLength(1); wrong.reset('disposed')
  })
  it.each(['full_access', 'edit', 'view'])('requires a fresh confirmation after changing retention to %s', async permission => {
    vi.stubGlobal('crypto', { randomUUID: () => 'retention-operation' })
    const value = dialog('transfer-ownership'); value.candidates = [{ principalId: 'bob', displayName: 'Bob' }]; value.selectOwner('bob'); value.perform = vi.fn()
    value.confirmTransfer(); expect(value.transferConfirm).toBe(true); value.setOldOwnerPerm(permission); expect(value.transferConfirm).toBe(false)
    value.confirmTransfer(); expect(value.perform).not.toHaveBeenCalled(); await value.confirmTransfer()
    expect(value.perform).toHaveBeenCalledWith({ ...transfer, operationId: 'business-retention-operation', oldOwnerPerm: permission })
  })
  it('remove selection changes only the explicit intent; cancelling never submits or changes existing authority', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'remove-operation' })
    const value = dialog('transfer-ownership'); value.candidates = [{ principalId: 'bob', displayName: 'Bob' }]; value.selectOwner('bob'); value.perform = vi.fn()
    value.confirmTransfer(); value.setRetention(true); expect(value.transferConfirm).toBe(false); expect(value.retentionSummary).toContain('不保留原所有者')
    value.close(); expect(value.$emit).toHaveBeenCalledWith('close'); expect(value.perform).not.toHaveBeenCalled(); expect(value.state.ownerId).toBe('alice')
    const reopened = dialog('transfer-ownership'); reopened.candidates = value.candidates; reopened.selectOwner('bob'); reopened.setRetention(true); reopened.perform = vi.fn()
    reopened.confirmTransfer(); await reopened.confirmTransfer(); expect(reopened.perform).toHaveBeenCalledWith({ ...transfer, operationId: 'business-remove-operation', removeOldOwner: true })
  })
  it('a late receiver list cannot restore a transfer draft after current ownership permission is lost', async () => {
    let finish
    const value = dialog('transfer-ownership'); value.provider.ownershipCandidates = vi.fn(() => new Promise(resolve => { finish = resolve })); value.perform = vi.fn()
    const pending = value.loadOwnershipCandidates()
    value.state = state({ capabilities: { ...state().capabilities, canTransferOwnership: false } })
    component.watch['state.capabilities.canTransferOwnership'].call(value, false)
    finish({ revision: '8', authzVersion: '6', eligibilityRevision: 'approved-org-v1', items: [{ principalId: 'bob', displayName: 'Bob' }] }); await pending
    expect(value.candidates).toEqual([]); expect(value.targetPrincipalId).toBe(''); expect(value.candidatesLoading).toBe(false); expect(value.canSubmit).toBe(false)
    value.confirmTransfer(); await value.submit('transfer-ownership'); expect(value.perform).not.toHaveBeenCalled()
  })
})

const menuSource = readFileSync(new URL('../../src/components/lark-doc/DocumentMenu.vue', import.meta.url), 'utf8')
const menuScript = menuSource.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '').replace('export default', 'return')
const menuComponent = new Function('LarkDocIcon', 'documentMenuRequestMethods', menuScript)({}, {})
const originalRemoval = { operationId: 'self-removal-original', kind: 'transfer-ownership' }
function confirmationDialog(provider, original = originalRemoval) {
  const value = dialog(original.kind), session = { documentId: 'doc', user: { id: 'alice' }, _privateIdentityGeneration: 1, can: () => false, getProvider: () => provider }
  Object.assign(value, { state: null, confirmationOnly: true, originalOperation: original, provider, current: component.methods.current,
    ed: { session, localTitle: 'Document' }, $refs: { dialog: { focus: vi.fn() } } })
  component.mounted.call(value)
  return value
}
function confirmationPort() {
  const pending = [originalRemoval]
  return { pending, getPending: () => pending, load: vi.fn(), folders: vi.fn(), ownershipCandidates: vi.fn(), execute: vi.fn(), query: vi.fn() }
}
function confirmationMenu(provider) {
  const session = { documentId: 'doc', user: { id: 'alice' }, _privateIdentityGeneration: 1, getProvider: () => provider,
    on: () => vi.fn(), can: () => false, emit: vi.fn(), refreshCapabilities: vi.fn() }
  const value = { ...menuComponent.data(), ...menuComponent.methods, ed: { session, setDocumentBusinessDeleted: vi.fn() }, $refs: {}, $nextTick: fn => fn() }
  return { value, session }
}
describe('self-removal confirms only its own historical operation without a current document view', () => {
  it.each([true, false])('clears populated projections when the same session changes document (advertised scope %s)', advertised => {
    let oldPublish
    const provider = { ...confirmationPort(), getState: () => state(), subscribe: callback => { oldPublish = callback; return vi.fn() },
      ...(advertised ? { getScope: () => ({ tenantId: 'tenant', docId: 'doc' }) } : {}) }
    const { value, session } = confirmationMenu(provider); value.invalidateRequest = vi.fn()
    value.bindBusiness(); expect(value.businessState.ownerId).toBe('alice'); expect(value.businessPending).toEqual(originalRemoval)
    session.documentId = 'different-doc'; menuComponent.watch['ed.session.documentId'].call(value)
    expect(value.businessProvider).toBeNull(); expect(value.businessState).toBeNull(); expect(value.businessPending).toBeNull()
    oldPublish({ document: state(), foldersChanged: true }); expect(value.businessState).toBeNull()
    expect(value.ed.setDocumentBusinessDeleted).toHaveBeenLastCalledWith(false)
  })
  it('rejects an old tenant projection even when document and principal identifiers match', () => {
    const provider = { ...confirmationPort(), getScope: () => ({ tenantId: 'old-tenant', docId: 'doc' }), getState: vi.fn(() => state()), subscribe: vi.fn() }
    const { value, session } = confirmationMenu(provider)
    session.getProvider = name => name === 'authorization' ? { getScope: () => ({ tenantId: 'new-tenant', docId: 'doc' }) } : provider
    value.bindBusiness(); expect(value.businessState).toBeNull(); expect(value.businessPending).toBeNull(); expect(provider.subscribe).not.toHaveBeenCalled(); expect(provider.getState).not.toHaveBeenCalled()
  })
  it('keeps the real pending key across a denied current read and same-identity authorization reset', async () => {
    const input = { ...transfer, removeOldOwner: true }, request = vi.fn(async (url, init) => init.method === 'POST' ? response(503, { status: 'unknown' }) :
      url.endsWith('/business') ? response(404, { code: 'PG_BUSINESS_NOT_FOUND' }) : response(200, acknowledgement(input))), { value, replace } = port(request)
    await value.execute(input); await expect(value.load()).rejects.toThrow('PG_BUSINESS_NOT_FOUND'); expect(value.getState()).toBeNull()
    value.reset('authorization-required'); expect(value.getPending()).toEqual([{ operationId: input.operationId, kind: input.kind }])
    expect(await value.query(input.operationId)).toMatchObject({ status: 'committed', removeOldOwner: true }); expect(value.getState()).toBeNull()
    expect(request.mock.calls.map(([, init]) => init.method)).toEqual(['POST', 'GET', 'GET'])
    value.reset('identity-changed'); replace({ authenticated: true, principalId: 'alice', generation: 3 })
    expect(value.getPending()).toEqual([]); await expect(value.query(input.operationId)).rejects.toThrow('BUSINESS_OPERATION_NOT_FOUND'); value.reset('disposed')
  })
  it('re-enters with no snapshot, directory, restore or write controls and queries only the existing key', async () => {
    const provider = confirmationPort(); provider.query.mockResolvedValueOnce({ status: 'unknown', ...originalRemoval })
    const first = confirmationDialog(provider)
    expect(first.visible).toBe(true); expect(first.deleted).toBe(false); expect(first.title).toBe('确认操作结果'); expect(first.baseline).toBeNull(); expect(first.canSubmit).toBe(false)
    await first.loadFolders(); await first.loadOwnershipCandidates(); await first.createFolder(); await first.submit('restore'); await first.perform(transfer)
    expect(provider.folders).not.toHaveBeenCalled(); expect(provider.ownershipCandidates).not.toHaveBeenCalled(); expect(provider.execute).not.toHaveBeenCalled(); expect(provider.load).not.toHaveBeenCalled()
    await first.query(); expect(provider.query).toHaveBeenCalledExactlyOnceWith(originalRemoval.operationId); expect(first.pending).toEqual(originalRemoval); expect(first.notice).toContain('尚未确认')
    first.close(); component.beforeDestroy.call(first)
    const reopened = confirmationDialog(provider), receipt = acknowledgement({ ...transfer, ...originalRemoval, removeOldOwner: true })
    provider.query.mockImplementationOnce(async () => { provider.pending.length = 0; return receipt })
    await reopened.query(); expect(reopened.$emit).toHaveBeenCalledWith('complete', receipt); expect(reopened.state).toBeNull(); expect(reopened.pending).toBeNull()
    expect(provider.query.mock.calls).toEqual([[originalRemoval.operationId], [originalRemoval.operationId]]); expect(provider.execute).not.toHaveBeenCalled(); expect(provider.load).not.toHaveBeenCalled()
  })
  it.each([{ ...originalRemoval, operationId: 'not-current' }, { ...originalRemoval, kind: 'restore' }])('cannot turn stale original metadata %j into a query or new command', async original => {
    const provider = confirmationPort(), value = confirmationDialog(provider, original)
    expect(value.pending).toBeNull(); value.pending = original; await value.query(); await value.submit('restore')
    expect(provider.query).not.toHaveBeenCalled(); expect(provider.execute).not.toHaveBeenCalled(); expect(value.error).toContain('没有可核对')
  })
  it.each(['identity-ABA', 'principal', 'document', 'session', 'provider', 'destroy'])('retires a late confirmation after %s changes', async change => {
    let finish
    const provider = confirmationPort(); provider.query.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const value = confirmationDialog(provider), pending = value.query()
    if (change === 'identity-ABA') value.ed.session._privateIdentityGeneration = 3
    if (change === 'principal') value.ed.session.user = { id: 'bob' }
    if (change === 'document') value.ed.session.documentId = 'other-document'
    if (change === 'session') value.ed.session = { ...value.ed.session }
    if (change === 'provider') value.ed.session.getProvider = () => ({})
    if (change === 'destroy') component.beforeDestroy.call(value)
    finish(acknowledgement({ ...transfer, ...originalRemoval, removeOldOwner: true })); await pending
    expect(value.$emit).not.toHaveBeenCalled(); expect(value.state).toBeNull()
    await value.query(); expect(provider.query).toHaveBeenCalledOnce()
  })
  it('rebuilds a query-only menu entry from current pending metadata and does not publish a receipt as current state', async () => {
    let publish
    const provider = { ...confirmationPort(), getState: () => null, subscribe: callback => { publish = callback; return vi.fn() } }, { value, session } = confirmationMenu(provider)
    value.bindBusiness(); expect(value.businessState).toBeNull(); expect(value.businessPending).toEqual(originalRemoval); expect(value.ed.setDocumentBusinessDeleted).toHaveBeenLastCalledWith(false)
    value.closeBusiness(); expect(value.businessDismissed).toBe(true); value.businessDismissed = false
    publish({ document: null, foldersChanged: true }); expect(value.businessState).toBeNull(); expect(value.businessAction).toBe('')
    await value.completeBusiness(acknowledgement({ ...transfer, ...originalRemoval, removeOldOwner: true }))
    expect(value.businessState).toBeNull(); expect(value.businessPending).toBeNull(); expect(value.businessNotice).toBe('所有权已转移'); expect(session.emit).not.toHaveBeenCalled(); expect(provider.load).not.toHaveBeenCalled()
  })
  it.each(['identity-ABA', 'document', 'provider', 'rebind'])('ignores an old business subscription after %s', change => {
    const callbacks = [], provider = { ...confirmationPort(), getState: () => null, subscribe: callback => { callbacks.push(callback); return vi.fn() } }, { value, session } = confirmationMenu(provider)
    value.bindBusiness()
    if (change === 'identity-ABA') session._privateIdentityGeneration = 3
    if (change === 'document') session.documentId = 'other-document'
    if (change === 'provider') session.getProvider = () => ({})
    if (change === 'rebind') value.bindBusiness()
    callbacks[0]({ document: state(), foldersChanged: true }); expect(value.businessState).toBeNull(); expect(session.refreshCapabilities).not.toHaveBeenCalled()
  })
})
