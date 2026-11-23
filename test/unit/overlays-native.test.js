// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOverlays } from '../../src/ui/overlays'
import { createNotifications, formatNotifyTime, NOTIFY_ACTIONS } from '../../src/ui/notifications'
import { createCommentPanel as createPlainCommentPanel, createVersionPanel } from '../../src/ui/panels'
import { NOTIFY_BRAND_BLUE, NOTIFY_CARD, NOTIFY_TEAL } from '../../src/ui/palette'
import overlaysUiMixin from '../../src/components/lark-doc/editor/overlaysUiMixin'
import panelsUiMixin from '../../src/components/lark-doc/editor/panelsUiMixin'
import commentsMixin from '../../src/components/lark-doc/editor/commentsMixin'
import notifyMixin from '../../src/components/lark-doc/editor/notifyMixin'
import shareMixin from '../../src/components/lark-doc/editor/shareMixin'
import exportMixin from '../../src/components/lark-doc/editor/exportMixin'
import { createNativeOptionsHost } from '../../src/editor/nativeOptionsHost'
import { createDocumentSession } from '../../src/session/DocumentSession'

import { createCommentComposer } from '../../src/ui/commentComposer'

const createCommentPanel = options => createPlainCommentPanel({ ...options, composerFactory: createCommentComposer })
const cleanups = []
function hostNode() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  return host
}
function pasteRich(input, text) {
  vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
  input.focus()
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', ctrlKey: true, bubbles: true, cancelable: true }))
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } })
  // JSDOM has no layout Range API; this test covers the renderer callback.
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [{ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }] })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => ({ left: 0, right: 1, top: 0, bottom: 1, width: 1, height: 1 }) })
  input.dispatchEvent(event)
}
afterEach(() => {
  cleanups.splice(0).reverse().forEach(cleanup => cleanup())
  document.body.textContent = ''
  vi.restoreAllMocks()
})
function runtimeFor(session) {
  const host = hostNode()
  const runtime = createNativeOptionsHost({
    options: { mixins: [shareMixin, exportMixin, notifyMixin, overlaysUiMixin], methods: { featureEnabled: () => true } },
    state: { sessionInstance: session, error: '' },
    aliases: { session: { get: (_host, state) => state.sessionInstance } },
    refs: { overlayHost: host },
    emit: vi.fn(),
  })
  cleanups.push(() => { runtime.host.destroyOverlays(); runtime.destroy() })
  runtime.host.mountOverlays()
  return { ...runtime, container: host }
}

describe('authoritative share link manager overlay', () => {
  const snapshot = extra => ({ tenantId: 'tenant', docId: 'doc', revision: '7', audience: 'public', enabled: false, permission: 'read',
    linkId: 'sl_' + 'b'.repeat(43), password: null, passwordAvailable: false, cryptoReady: true, canManage: true, organizationBypass: 'unavailable', ...extra })
  const settleLinks = async vm => { for (let i = 0; i < 20; i++) await Promise.resolve(); await vm.$nextTick() }
  function managerRuntime() {
    let value = snapshot()
    const provider = { isRemote: true, shareLink: vi.fn(async (method, input) => {
      if (method === 'operation') return null
      if (method === 'get') return value
      value = snapshot({ ...value, ...input.changes, revision: String(Number(value.revision) + 1),
        ...(input.changes.audience === 'collaborators' ? { enabled: false, linkId: null, password: null, passwordAvailable: false } : {}),
        ...(input.changes.audience === 'public' ? { linkId: 'sl_' + 'b'.repeat(43) } : {}),
        ...(input.changes.enabled === false ? { password: null, passwordAvailable: false } : {}),
        ...(input.changes.password ? { passwordAvailable: true } : {}) })
      return { status: 'committed', link: value }
    }) }
    const session = { documentId: 'doc', user: { id: 'manager' }, can: () => true, getProvider: name => name === 'authorization' ? provider : null,
      refreshCapabilities: vi.fn(), getShareLink: vi.fn(async () => 'https://host.example/doc#larkDocument=1&tenantId=tenant&docId=doc') }
    const runtime = runtimeFor(session)
    runtime.host.sharePopoverOpen = true
    return { ...runtime, provider }
  }
  it('loads then applies scope/read-edit from native controls without simulating unavailable organization settings', async () => {
    const { host: vm, provider, container } = managerRuntime()
    await vm.loadShareLink(); await settleLinks(vm)
    const scope = container.querySelector('[aria-label="链接范围"]'), permission = container.querySelector('[aria-label="链接权限"]')
    expect(scope.disabled).toBe(false); expect(permission.disabled).toBe(false)
    // 这两颗已换成共享下拉原语（无原生 select），走「点开触发按钮 → 点选项」。
    const pick = (trigger, label) => {
      trigger.click()
      const option = [...trigger.closest('.lark-doc-select').querySelectorAll('[role="option"]')]
        .find(node => node.getAttribute('aria-disabled') !== 'true' && node.textContent.includes(label))
      option.click()
    }
    pick(permission, '可编辑'); await settleLinks(vm)
    expect(provider.shareLink).toHaveBeenCalledWith('request', { expectedRevision: '7', changes: { permission: 'edit' } })
    expect(vm.shareLinkState.permission).toBe('edit')
    pick(scope, '仅协作者'); await settleLinks(vm)
    expect(provider.shareLink).toHaveBeenCalledWith('request', { expectedRevision: '8', changes: { audience: 'collaborators', enabled: false } })
    expect(vm.shareLinkState.audience).toBe('collaborators')
    vm.openPermissionDialog(); await settleLinks(vm)
    // 组织权限服务未接入：下拉放开为「mock 本地组织」——能点开三档菜单、选中只写本地值。
    const copySelect = container.querySelector('[aria-label="谁可以复制内容"]')
    expect(copySelect.disabled).toBe(false)
    const callsBeforeCopy = provider.shareLink.mock.calls.length
    copySelect.click()
    const copyOption = [...container.querySelectorAll('.lark-doc-select-list [role="option"]')]
      .find(node => node.textContent.includes('可编辑的用户'))
    copyOption.click(); await settleLinks(vm)
    expect(vm.permissionValues.copy).toBe('可编辑的用户')
    expect(provider.shareLink).toHaveBeenCalledTimes(callsBeforeCopy)
    vm.toggleAdvancedSettings(); await settleLinks(vm)
    expect(container.querySelectorAll('.lark-doc-permission-switch')[1].disabled).toBe(true)
    const calls = provider.shareLink.mock.calls.length
    vm.setPermissionValue('ownerLeaderAutoPass', true)
    expect(provider.shareLink).toHaveBeenCalledTimes(calls)
  })
  it('enables password through confirmation and saves a changed password only after authoritative acknowledgement', async () => {
    const { host: vm, provider, container } = managerRuntime()
    await vm.loadShareLink(); vm.openPermissionDialog(); await settleLinks(vm)
    container.querySelector('[aria-label="启用加密链接"]').click(); await settleLinks(vm)
    expect(vm.secureLinkConfirmOpen).toBe(true); expect(vm.secureLinkEnabled).toBe(false)
    const calls = provider.shareLink.mock.calls.filter(([method]) => method === 'request').length
    const confirm = container.querySelector('.lark-doc-share-confirm .lark-doc-share-btn-filled'); confirm.click(); await settleLinks(vm)
    expect(provider.shareLink.mock.calls.filter(([method]) => method === 'request')).toHaveLength(calls + 1)
    expect(vm.secureLinkEnabled).toBe(true); expect(vm.secureLinkPassword).toHaveLength(8)
    container.querySelector('[aria-label="修改密码"]').click(); await settleLinks(vm)
    const input = container.querySelector('[aria-label="请输入新密码"]'); input.value = 'Next!234'; input.dispatchEvent(new Event('input', { bubbles: true }))
    await settleLinks(vm)
    container.querySelector('.lark-doc-share-password .lark-doc-share-btn-filled').click(); await settleLinks(vm)
    expect(provider.shareLink).toHaveBeenCalledWith('request', { expectedRevision: '8', changes: { password: 'Next!234' } })
    expect(vm.secureLinkPassword).toBe('Next!234'); expect(vm.passwordDialogOpen).toBe(false)
    const written = provider.shareLink.mock.calls.filter(([method]) => method === 'request').length
    confirm.click(); input.dispatchEvent(new Event('input', { bubbles: true }))
    await settleLinks(vm)
    expect(provider.shareLink.mock.calls.filter(([method]) => method === 'request')).toHaveLength(written)
    container.querySelector('[aria-label="启用加密链接"]').click(); await settleLinks(vm)
    expect(provider.shareLink).toHaveBeenCalledWith('request', { expectedRevision: '9', changes: { enabled: false } })
    expect(vm.secureLinkEnabled).toBe(false); expect(vm.secureLinkPassword).toBe('')
  })
  it('queries the original unknown write from the visible recovery control instead of submitting another request', async () => {
    const { host: vm, provider, container } = managerRuntime()
    await vm.loadShareLink(); await settleLinks(vm)
    const original = provider.shareLink.getMockImplementation()
    provider.shareLink.mockImplementation(async (method, input) => {
      if (method === 'request') throw Object.assign(Error('response lost'), { status: 'unknown', operationId: 'visible-original' })
      if (method === 'query') return { status: 'committed', link: snapshot({ revision: '8', permission: 'edit' }) }
      return original(method, input)
    })
    await vm.setShareLinkPerm('可编辑'); await settleLinks(vm)
    expect(container.querySelector('[aria-label="链接权限"]').disabled).toBe(true)
    const query = [...container.querySelectorAll('button')].find(node => node.textContent === '查询原操作')
    expect(query).toBeTruthy(); query.click(); await settleLinks(vm)
    expect(provider.shareLink).toHaveBeenCalledWith('query', 'visible-original')
    expect(provider.shareLink.mock.calls.filter(([method]) => method === 'request')).toHaveLength(1)
    expect(vm.shareLinkState.permission).toBe('edit')
  })
  it('toggles the authoritative public audience to collaborators and back through two distinct CAS acknowledgements', async () => {
    const { host: vm, provider, container } = managerRuntime()
    await vm.loadShareLink(); vm.openPermissionDialog(); await settleLinks(vm)
    const toggle = container.querySelector('[aria-label="允许内容被分享到组织外"]')
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    toggle.click(); await settleLinks(vm)
    expect(provider.shareLink).toHaveBeenCalledWith('request', { expectedRevision: '7', changes: { audience: 'collaborators', enabled: false } })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    toggle.click(); await settleLinks(vm)
    expect(provider.shareLink).toHaveBeenCalledWith('request', { expectedRevision: '8', changes: { audience: 'public' } })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
  })
  it('rejects a retired audience switch after only the permission child closes while its share popover remains open', async () => {
    const { host: vm, provider, container } = managerRuntime()
    await vm.loadShareLink(); vm.openPermissionDialog(); await settleLinks(vm)
    const retired = container.querySelector('[aria-label="允许内容被分享到组织外"]')
    vm.closePermissionDialog(); await settleLinks(vm)
    expect(vm.sharePopoverOpen).toBe(true); expect(retired.isConnected).toBe(false)
    const calls = provider.shareLink.mock.calls.length
    retired.click(); await settleLinks(vm)
    expect(provider.shareLink).toHaveBeenCalledTimes(calls)
  })
})

describe('phone recipient share layout', () => {
  function recipientView({ mobile = true, available = true } = {}) {
    const media = Object.assign(new EventTarget(), { matches: mobile })
    const descriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia')
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => media })
    cleanups.push(() => { if (descriptor) Object.defineProperty(window, 'matchMedia', descriptor); else delete window.matchMedia })
    let share = { target: 'selection', selection: { type: 'text', text: 'chosen text' },
      preview: { width: 120, height: 24 }, excerpt: { before: { text: 'before' }, after: { text: 'after' } },
      query: '', recipients: [], results: [{ id: 'bob', kind: 'user', name: 'Bob' }, { id: 'team', kind: 'chat', name: 'Team' }],
      message: '', error: '', loading: false, sending: false }
    const onImageShareSend = vi.fn(), onImageShareClose = vi.fn()
    const onImageShareRecipient = vi.fn((id, kind) => {
      const selected = share.recipients.some(item => item.id === id && item.kind === kind)
      share = { ...share, recipients: selected ? share.recipients.filter(item => item.id !== id || item.kind !== kind)
        : [...share.recipients, share.results.find(item => item.id === id && item.kind === kind)] }
      paint()
    })
    const host = hostNode()
    const ui = createOverlays({ host, handlers: {
      onImageShareSend, onImageShareClose, onImageShareRecipient,
      onImageShareQuery: query => { share = { ...share, query }; paint() },
    } })
    const paint = () => ui.update({ imageShare: share, imageShareAvailable: available })
    paint(); cleanups.push(() => ui.destroy())
    return { ui, host, media, onImageShareSend, onImageShareClose, onImageShareRecipient, paint,
      set: patch => { share = { ...share, ...patch }; paint() } }
  }

  it('opens the phone recipient page with observed results, without preview or send controls', async () => {
    const { host } = recipientView()
    await Promise.resolve()
    expect(host.querySelector('.lark-doc-image-share-dialog.is-mobile')).not.toBeNull()
    expect(host.querySelector('.lark-doc-image-share-header strong').textContent).toBe('分享给')
    expect(host.querySelector('.lark-doc-image-share-header [aria-label="多选接收人"]')).not.toBeNull()
    expect(host.querySelector('.lark-doc-image-share-results').hidden).toBe(false)
    expect([...host.querySelectorAll('.lark-doc-image-share-result-name')].map(node => node.textContent)).toEqual(['Bob', 'Team'])
    expect(host.querySelector('.lark-doc-image-share-create-group').disabled).toBe(true)
    expect(host.querySelector('.lark-doc-image-share-create-group').title).toContain('未配置')
    expect(host.querySelector('.lark-doc-image-share-preview')).toBeNull()
    expect(host.querySelector('.lark-doc-image-share-message')).toBeNull()
    expect(host.querySelector('.lark-doc-image-share-footer')).toBeNull()
    expect(document.activeElement).not.toBe(host.querySelector('input'))
  })

  it('requires explicit confirmation after choosing, and returns to recipients without sending', () => {
    const { host, onImageShareSend } = recipientView()
    const retiredChoice = host.querySelectorAll('.lark-doc-image-share-result')[1]
    host.querySelector('.lark-doc-image-share-result').click()
    expect(host.querySelector('.lark-doc-image-share-dialog').classList.contains('is-confirming')).toBe(true)
    expect(host.querySelector('.lark-doc-image-share-preview').textContent).toContain('chosen text')
    expect(host.querySelector('.lark-doc-image-share-summary').textContent).toContain('Bob')
    retiredChoice.click()
    expect(host.querySelector('.lark-doc-image-share-summary').textContent).not.toContain('Team')
    expect(onImageShareSend).not.toHaveBeenCalled()
    host.querySelector('[aria-label="返回接收人"]').click()
    expect(host.querySelector('.lark-doc-image-share-preview')).toBeNull()
    expect(host.querySelector('.lark-doc-image-share-results').hidden).toBe(false)
    expect(onImageShareSend).not.toHaveBeenCalled()
    host.querySelector('[aria-label="多选接收人"]').click()
    host.querySelectorAll('.lark-doc-image-share-result')[1].click()
    expect(host.querySelector('.lark-doc-image-share-preview')).toBeNull()
    host.querySelector('[aria-label="确认接收人"]').click()
    host.querySelector('.lark-doc-image-share-footer .is-primary').click()
    expect(onImageShareSend).toHaveBeenCalledOnce()
  })

  it('keeps unavailable sharing and sending controls gated on the recipient page', () => {
    const { host, set, onImageShareSend } = recipientView({ available: false })
    host.querySelector('[aria-label="多选接收人"]').click()
    host.querySelector('.lark-doc-image-share-result').click()
    host.querySelector('.lark-doc-image-share-dialog').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))
    expect(onImageShareSend).not.toHaveBeenCalled()
    host.querySelector('[aria-label="确认接收人"]').click()
    const staleSend = host.querySelector('.lark-doc-image-share-footer .is-primary')
    expect(staleSend.disabled).toBe(true)
    set({ sending: true })
    staleSend.click()
    expect(onImageShareSend).not.toHaveBeenCalled()
  })

  it('restores the desktop preview and focus contract on media change and releases mobile teardown', async () => {
    const { ui, host, media } = recipientView({ mobile: false })
    await Promise.resolve()
    expect(host.querySelector('.lark-doc-image-share-preview')).not.toBeNull()
    expect(host.querySelector('.lark-doc-image-share-footer')).not.toBeNull()
    expect(document.activeElement).toBe(host.querySelector('.lark-doc-image-share-selector input'))
    media.matches = true; media.dispatchEvent(new Event('change'))
    expect(host.querySelector('.lark-doc-image-share-dialog.is-mobile')).not.toBeNull()
    expect(host.querySelector('.lark-doc-image-share-preview')).toBeNull()
    expect(document.body.style.overflow).toBe('hidden')
    media.matches = false; media.dispatchEvent(new Event('change'))
    expect(host.querySelector('.lark-doc-image-share-preview')).not.toBeNull()
    expect(host.querySelector('.lark-doc-image-share-footer')).not.toBeNull()
    expect(host.querySelector('.lark-doc-image-share-selector > input')).not.toBeNull()
    expect(document.body.style.overflow).not.toBe('hidden')
    media.matches = true; media.dispatchEvent(new Event('change'))
    ui.destroy()
    expect(document.body.style.overflow).not.toBe('hidden')
    media.matches = false; media.dispatchEvent(new Event('change'))
    expect(host.querySelector('.lark-doc-image-share-dialog')).toBeNull()
  })

  it('rejects late updates and retired controls after destroy without relocking page scroll', () => {
    const { ui, host, set, onImageShareRecipient, onImageShareSend } = recipientView()
    const candidate = host.querySelector('.lark-doc-image-share-result')
    candidate.click()
    const send = host.querySelector('.lark-doc-image-share-footer .is-primary')
    expect(onImageShareRecipient).toHaveBeenCalledOnce()
    ui.destroy()
    const overflow = document.body.style.overflow
    set({ query: 'late response' })
    expect.soft(host.querySelector('.lark-doc-image-share-dialog')).toBeNull()
    candidate.click(); send.click()
    expect.soft(onImageShareRecipient).toHaveBeenCalledOnce()
    expect.soft(onImageShareSend).not.toHaveBeenCalled()
    expect.soft(document.body.style.overflow).toBe(overflow)
    ui.destroy()
  })
})

describe('原生浮层迁移契约', () => {
  function invitationHost() {
    const provider = { listMembers: vi.fn(), requestShare: vi.fn(), queryShareOperation: vi.fn() }
    const session = { documentId: 'doc', user: { id: 'alice' }, _privateIdentityGeneration: 1,
      getProvider: () => provider, listMembers: vi.fn().mockResolvedValue({ authzVersion: '37', members: [] }),
      requestShare: vi.fn(), queryShareOperation: vi.fn() }
    const ed = { ...shareMixin.data(), ...shareMixin.methods, session, shareCan: () => true }
    ed.shareDirectory = { status: 'ready', items: [{ principalId: 'bob', displayName: 'Bob' }] }
    return { ed, session }
  }

  it('prepares only an observed collaborator and submits a new share source with the current authz CAS', async () => {
    const { ed, session } = invitationHost()
    expect(await ed.selectShareInviteCandidate('forged')).toBe(false)
    expect(session.listMembers).not.toHaveBeenCalled()
    expect(await ed.selectShareInviteCandidate('bob')).toBe(true)
    ed.shareInvitation.operationId = 'share-original'
    ed.setShareInviteRole('edit')
    let finish
    session.requestShare.mockImplementation(input => new Promise(resolve => { finish = () => resolve({ status: 'committed', operationId: 'share-original', authzVersion: '38', sourceGrantKey: input.sourceGrantKey }) }))
    const pending = ed.submitShareInvitation()
    await ed.submitShareInvitation()
    expect(session.requestShare).toHaveBeenCalledOnce()
    expect(session.requestShare.mock.calls[0][0]).toMatchObject({ subject: 'bob', originType: 'share', expectedRevision: '37', sourceRevision: '1', scopes: ['document.read', 'document.write', 'comment.write', 'comment.resolve', 'version.read', 'version.create', 'document.export'] })
    expect(session.requestShare.mock.calls[0][0].sourceGrantKey).toMatch(/^ui-share-[a-z0-9-]+$/)
    const input = session.requestShare.mock.calls[0][0]
    session.listMembers.mockResolvedValue({ authzVersion: '38', members: [{ principalId: 'bob', sources: [{ originType: 'share', sourceGrantKey: input.sourceGrantKey, sourceRevision: '1', scopes: input.scopes, revoked: false, sourceGap: false }] }] })
    finish(); await pending
    expect(ed.shareInvitation).toMatchObject({ status: 'committed', operationId: 'share-original', verified: true })
    expect(session.listMembers).toHaveBeenCalledTimes(2)
  })

  it('keeps an unknown invitation across dismissal and queries the original operation without a new POST', async () => {
    const { ed, session } = invitationHost()
    await ed.selectShareInviteCandidate('bob')
    ed.shareInvitation.operationId = 'share-original'
    session.requestShare.mockRejectedValue(Object.assign(new Error('lost'), { status: 'unknown', operationId: 'share-original' }))
    await ed.submitShareInvitation(); ed.closeSharePopover()
    expect(ed.shareInvitation).toMatchObject({ status: 'unknown', operationId: 'share-original' })
    await ed.submitShareInvitation()
    expect(session.requestShare).toHaveBeenCalledOnce()
    session.queryShareOperation.mockResolvedValue({ status: 'committed', operationId: 'share-original', authzVersion: '38' })
    await ed.queryShareInvitation()
    expect(session.queryShareOperation).toHaveBeenCalledExactlyOnceWith('share-original')
    expect(ed.shareInvitation.status).toBe('committed')
  })

  it('does not add another source for an existing member or lose the original ID during a temporary permission loss', async () => {
    const { ed, session } = invitationHost()
    session.listMembers.mockResolvedValueOnce({ authzVersion: '37', members: [{ principalId: 'bob', scopes: ['document.write'] }] })
    expect(await ed.selectShareInviteCandidate('bob')).toBe(false)
    expect(ed.shareInvitation.error).toContain('已是协作者')
    await ed.selectShareInviteCandidate('bob'); const originalId = ed.shareInvitation.operationId
    session.requestShare.mockRejectedValue(new Error('identity temporarily unavailable'))
    await ed.submitShareInvitation()
    ed.shareCan = () => false; ed.closeSharePopover(); await ed.queryShareInvitation()
    expect(session.queryShareOperation).not.toHaveBeenCalled()
    ed.shareCan = () => true; session.queryShareOperation.mockResolvedValue({ status: 'committed', operationId: originalId })
    await ed.queryShareInvitation()
    expect(session.queryShareOperation).toHaveBeenCalledExactlyOnceWith(originalId)
    expect(session.requestShare).toHaveBeenCalledOnce()
  })

  it.each([
    [{ revoked: true, sourceGap: false }, true],
    [{ revoked: true, sourceGap: true }, false],
    [{ revoked: false, sourceGap: false }, false],
  ])('only reinvites a completely revoked member with no source gap (%j)', async (source, expected) => {
    const { ed, session } = invitationHost()
    session.listMembers.mockResolvedValue({ authzVersion: '37', members: [{ principalId: 'bob', scopes: [], sources: [source] }] })
    expect(await ed.selectShareInviteCandidate('bob')).toBe(expected)
    expect(session.requestShare).not.toHaveBeenCalled()
  })

  it('discards late invitation responses after actor or permission invalidation', async () => {
    const { ed, session } = invitationHost()
    await ed.selectShareInviteCandidate('bob')
    let finish
    session.requestShare.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const pending = ed.submitShareInvitation()
    session._privateIdentityGeneration++; ed.clearShareReads()
    finish({ status: 'committed', operationId: 'private-alice' }); await pending
    expect(ed.shareInvitation.status).toBe('idle')
    ed.shareCan = () => false
    await ed.submitShareInvitation(); await ed.queryShareInvitation()
    expect(session.requestShare).toHaveBeenCalledOnce(); expect(session.queryShareOperation).not.toHaveBeenCalled()
  })

  it('mobile invitation uses selectable directory results, explicit confirmation and original-operation query controls', () => {
    const width = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    const host = hostNode(), select = vi.fn(), send = vi.fn(), query = vi.fn(), role = vi.fn()
    const ui = createOverlays({ host, handlers: { onSelectShareInviteCandidate: select, onSubmitShareInvitation: send, onQueryShareInvitation: query, onSetShareInviteRole: role } })
    cleanups.push(() => { ui.destroy(); Object.defineProperty(window, 'innerWidth', { configurable: true, value: width }) })
    ui.update({ sharePopoverOpen: true, shareCanManagePermission: true, shareDirectory: { status: 'ready', items: [{ principalId: 'bob', displayName: 'Bob' }] } })
    host.querySelector('.lark-doc-share-mobile [aria-label="邀请协作者"]').click()
    const candidate = host.querySelector('[aria-label="选择协作者 Bob"]'); candidate.focus(); candidate.click(); expect(select).toHaveBeenCalledExactlyOnceWith('bob')
    const invitation = { candidate: { principalId: 'bob', displayName: 'Bob' }, status: 'confirm', role: 'read' }
    ui.update({ shareInvitation: { ...invitation, status: 'preparing' } })
    expect(document.activeElement).toBe(host.querySelector('.lark-doc-share-mobile-confirm [role="status"]'))
    ui.update({ shareInvitation: invitation })
    const roleSelect = host.querySelector('[aria-label="邀请权限"]'); roleSelect.value = 'edit'; roleSelect.dispatchEvent(new Event('change', { bubbles: true })); expect(role).toHaveBeenCalledExactlyOnceWith('edit')
    expect(document.activeElement).toBe(roleSelect)
    const submit = host.querySelector('.lark-doc-share-mobile-send'); submit.click(); expect(send).toHaveBeenCalledOnce()
    ui.update({ shareInvitation: { ...invitation, status: 'unknown', operationId: 'original' } })
    expect(document.activeElement.textContent).toBe('查询原邀请操作')
    expect(submit.hidden).toBe(true); expect(submit.disabled).toBe(true)
    host.querySelector('.lark-doc-share-mobile-confirm .lark-doc-share-mobile-retry').click(); expect(query).toHaveBeenCalledOnce()
  })

  it('mobile permission Escape closes the child before editor focus and restores the settings entry', () => {
    const width = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    const host = hostNode(), body = document.createElement('button'); host.append(body)
    host.addEventListener('keydown', event => { if (event.key === 'Escape') body.focus() })
    const state = { sharePopoverOpen: true, shareCanManagePermission: true }
    const ui = createOverlays({ host, handlers: { onOpenPermissionDialog: () => ui.update({ ...state, permissionDialogOpen: true }), onClosePermissionDialog: () => ui.update({ ...state, permissionDialogOpen: false }) } })
    cleanups.push(() => { ui.destroy(); Object.defineProperty(window, 'innerWidth', { configurable: true, value: width }) })
    ui.update(state)
    const trigger = host.querySelector('.lark-doc-share-perm-btn'); trigger.focus(); trigger.click()
    const close = host.querySelector('.lark-doc-permission-dialog [aria-label="关闭"]')
    expect(document.activeElement).toBe(close)
    close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(host.querySelector('.lark-doc-permission-dialog')).toBeNull()
    expect(host.querySelector('[aria-label="分享文档"]')).not.toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('loads actual authorized members and discards a late result from a replaced actor', async () => {
    let finish
    const provider = { listMembers: vi.fn() }, session = { documentId: 'doc', user: { id: 'alice' }, _privateIdentityGeneration: 1,
      getProvider: () => provider, listMembers: vi.fn(() => new Promise(resolve => { finish = resolve })) }
    const ed = { ...shareMixin.data(), ...shareMixin.methods, session, shareCan: () => true }
    const pending = ed.loadShareMembers()
    expect(ed.shareMembers.status).toBe('loading')
    session.user = { id: 'bob' }; session._privateIdentityGeneration++
    ed.clearShareReads()
    finish({ authzVersion: '7', members: [{ principalId: 'private-alice', scopes: [] }] }); await pending
    expect(ed.shareMembers).toEqual({ status: 'idle', items: [], authzVersion: '' })
    session.listMembers.mockResolvedValue({ authzVersion: '8', members: [{ principalId: 'bob', scopes: ['document.read'] }] })
    await ed.loadShareMembers()
    expect(ed.shareMembers).toMatchObject({ status: 'ready', authzVersion: '8', items: [{ principalId: 'bob' }] })
    ed.shareCan = () => false; await ed.loadShareMembers(); expect(session.listMembers).toHaveBeenCalledTimes(2)
  })

  it('debounces directory reads, never grants membership from a candidate, and ignores replaced queries', async () => {
    vi.useFakeTimers()
    try {
      let finish
      const provider = { resolveMentions: vi.fn() }, session = { documentId: 'doc', user: { id: 'alice' }, getProvider: () => provider,
        resolveMentions: vi.fn(() => new Promise(resolve => { finish = resolve })), requestShare: vi.fn() }
      const ed = { ...shareMixin.data(), ...shareMixin.methods, session, shareCan: () => true }
      ed.setShareInviteQuery('B'); ed.setShareInviteQuery('Bob')
      await vi.advanceTimersByTimeAsync(250)
      expect(session.resolveMentions).toHaveBeenCalledOnce(); expect(session.resolveMentions).toHaveBeenCalledWith({ query: 'Bob', kinds: ['user'] })
      ed.setShareInviteQuery('Alice')
      finish({ status: 'resolved', candidates: [{ principalId: 'bob', displayName: 'Bob' }] }); await Promise.resolve()
      expect(ed.shareDirectory.items).toEqual([])
      session.resolveMentions.mockResolvedValue({ status: 'resolved', candidates: [{ principalId: 'alice', displayName: 'Alice' }] })
      await vi.advanceTimersByTimeAsync(250)
      expect(ed.shareDirectory).toMatchObject({ status: 'ready', items: [{ principalId: 'alice', displayName: 'Alice' }] })
      expect(session.requestShare).not.toHaveBeenCalled()
      ed.clearShareReads()
    } finally { vi.useRealTimers() }
  })

  it('mobile document share card navigates into members and invite, and restores focus on dismissal', () => {
    const width = window.innerWidth, overflow = document.body.style.overflow
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    const host = hostNode(), trigger = document.createElement('button'); host.append(trigger); trigger.focus()
    const onMembers = vi.fn(), onQuery = vi.fn(), onClose = vi.fn(() => ui.update({ sharePopoverOpen: false }))
    const ui = createOverlays({ host, handlers: { onLoadShareMembers: onMembers, onSetShareInviteQuery: onQuery, onCloseSharePopover: onClose } })
    cleanups.push(() => { ui.destroy(); Object.defineProperty(window, 'innerWidth', { configurable: true, value: width }); document.body.style.overflow = overflow })
    ui.update({ sharePopoverOpen: true, shareCanManagePermission: true, shareMembers: { status: 'idle', items: [] }, shareDirectory: { status: 'idle', items: [] } })
    const landing = host.querySelector('[aria-label="分享文档"]')
    expect(landing).not.toBeNull(); expect(landing.getAttribute('aria-modal')).toBeNull()
    expect(document.body.style.overflow).toBe(overflow)
    landing.querySelector('[aria-label="查看协作者"]').click(); expect(onMembers).toHaveBeenCalledOnce()
    ui.update({ shareMembers: { status: 'ready', items: [{ principalId: 'alice', scopes: ['grant.manage'] }] } })
    expect(host.querySelector('.lark-doc-share-mobile-members').textContent).toContain('alice')
    host.querySelector('[aria-label="返回协作者"]').click()
    host.querySelector('[aria-label="添加协作者"]').click()
    const input = host.querySelector('.lark-doc-share-mobile input')
    expect(document.activeElement).toBe(input)
    input.value = 'Bob'; input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(onQuery).toHaveBeenCalledWith('Bob')
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(host.querySelector('[aria-label="查看协作者"]')).not.toBeNull()
    host.querySelector('[aria-label="添加协作者"]').click()
    host.querySelector('[aria-label="关闭协作者"]').click()
    expect(onClose).toHaveBeenCalledOnce(); expect(document.body.style.overflow).toBe(overflow); expect(document.activeElement).toBe(trigger)
  })

  it('原生分享已打开时 resize 保持顶部文档卡并刷新实际浮层', () => {
    const width = window.innerWidth, height = window.innerHeight
    try {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 852 })
      const runtime = runtimeFor(createDocumentSession({ capabilities: { canManagePermission: true } }))
      runtime.mount()
      runtime.host.toggleSharePopover({ currentTarget: { getBoundingClientRect: () => ({ left: 279, right: 339, top: 16, bottom: 48, width: 60 }) } })
      runtime.flush()
      const popover = runtime.container.querySelector('.lark-doc-share-popover')
      expect(popover.style.bottom).toBe(''); expect(popover.style.top).toBe('54px'); expect(popover.style.left).toBe('24px')
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 520 })
      window.dispatchEvent(new Event('resize'))
      runtime.flush()
      expect(popover.style.bottom).toBe(''); expect(popover.style.top).toBe('54px'); expect(popover.style.left).toBe('24px')
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
    }
  })
  it('手机分享入口使用顶部文档卡，桌面仍右对齐并清除移动定位', () => {
    const width = window.innerWidth, height = window.innerHeight
    const vm = { shareEntryMode: 'manage', sharePopoverOpen: false, shareCan: () => false, loadShareLink: vi.fn() }
    shareMixin.methods.toggleSharePopover.call(vm)
    expect(vm.sharePopoverOpen).toBe(false)
    expect(vm.loadShareLink).not.toHaveBeenCalled()
    vm.shareCan = () => true
    try {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 852 })
      shareMixin.methods.toggleSharePopover.call(vm, { currentTarget: { getBoundingClientRect: () => ({ left: 279, right: 339, top: 16, bottom: 48, width: 60 }) } })
      expect(shareMixin.methods.sharePopoverStyle.call(vm)).toEqual({ left: '24px', right: '0px', top: '54px', bottom: '' })
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 520 })
      expect(shareMixin.methods.sharePopoverStyle.call(vm)).toEqual({ left: '24px', right: '0px', top: '54px', bottom: '' })
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
      vm.sharePopoverOpen = false
      shareMixin.methods.toggleSharePopover.call(vm, { currentTarget: { getBoundingClientRect: () => ({ left: 996, right: 1076, top: 16, bottom: 48, width: 80 }) } })
      expect(shareMixin.methods.sharePopoverStyle.call(vm)).toEqual({ left: '', bottom: '', top: '52px', right: '364px' })
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
    }
  })
  it.each(['reply', 'document', 'edit/thread/reply'])('原生 Proxy 宿主异步 %s mentions 更新候选并刷新面板', async scope => {
    let refreshes = 0
    const runtime = createNativeOptionsHost({ options: { data: commentsMixin.data,
      methods: { ...commentsMixin.methods, commentCan: () => true, commentAllowed: () => true, refreshPanels() { refreshes++ } }, watch: panelsUiMixin.watch },
    state: { commentRemote: true, session: { resolveMentions: async () => ({ status: 'resolved', candidates: [{ principalId: 'bob', displayName: 'Bob' }] }) } } })
    cleanups.push(() => runtime.destroy())
    const vm = runtime.host
    if (scope === 'reply') await vm.updateCommentMentionPicker('thread', '@Bo', 3)
    else await vm.updateDocumentMentionPicker(scope, '@Bo', 3)
    runtime.flush()
    expect(vm.commentMentionPicker.candidates).toEqual([{ principalId: 'bob', displayName: 'Bob' }])
    expect(refreshes).toBeGreaterThan(0)
  })
  it('编辑图片草稿显示可移除预览', () => {
    const onRemoveAttachment = vi.fn()
    const ui = createCommentPanel({ host: hostNode(), handlers: { onRemoveAttachment } })
    cleanups.push(() => ui.destroy())
    // 编辑态长在被编辑的那条回复里（飞书同款）：replyId 指向真实回复节点，
    // 没有这条回复时整个编辑块会被摘掉。
    ui.update({ open: true, remote: true, items: [{ id: 'thread', replies: [{ id: 'reply', body: '原文' }], edit: { replyId: 'reply', value: '', draftImages: [{ id: 'asset', name: 'draft.png', previewUrl: 'blob:preview' }] } }] })
    // 草稿附件与基线同口径：`.lark-doc-comment-attachment.is-draft` 里那颗 × 才是移除按钮，
    // aria 固定「移除评论图片」（不拼文件名），回调拿的是上传 id。
    const chip = ui.el.querySelector('.lark-doc-comment-edit .lark-doc-comment-attachments .lark-doc-comment-attachment.is-draft')
    expect(chip.querySelector('img').getAttribute('src')).toBe('blob:preview')
    const remove = chip.querySelector('[aria-label="移除评论图片"]')
    expect(remove).not.toBeNull()
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    remove.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
    remove.click()
    expect(onRemoveAttachment).toHaveBeenCalledWith('edit/thread/reply', 'asset')
  })
  it('编辑输入可删除已有mention字符，失效范围退回纯文本', () => {
    const vm = { ...commentsMixin.data(), ...commentsMixin.methods, commentEditingReply: { threadId: 'thread', replyId: 'reply' }, commentEditContent: '@Alice',
      commentEditMentions: [{ principalId: 'alice', from: 0, to: 6 }], updateDocumentMentionPicker: vi.fn() }
    panelsUiMixin.methods.panelsHandlers.call(vm).comment.onEditDraft('thread', 'reply', '@Alic', { target: { selectionStart: 5 } })
    expect(vm.commentEditContent).toBe('@Alic')
    expect(vm.commentEditMentions).toEqual([])
  })
  it('删除态富文本不泄漏旧正文，edit候选不投影到普通回复', () => {
    const owner = { commentRemote: true, commentSidebarOpen: true, commentPanels: [],
      commentDocumentThreads: [{ id: 'thread', replies: [{ id: 'reply', tombstone: true, content: 'old secret', richContent: { type: 'text', text: 'old secret' } }, { id: 'alive', content: 'visible', reactions: [{ emoji: '❤', users: ['alice'] }] }] }],
      commentAuthor: { id: 'alice' },
      commentMentionPicker: { scope: 'edit/thread/reply', threadId: 'thread', candidates: [{ principalId: 'bob', displayName: 'Bob' }] },
      commentDraftImages: () => [], commentAuthorName: () => 'Alice', commentAllowed: () => false, commentCan: () => true,
      commentStateText: () => '', commentPrivate: () => false, commentTimeAt: () => '', commentDraftOf: () => '', commentTextareaHeight: () => 50, commentHasDraft: () => false }
    const state = panelsUiMixin.methods.buildCommentState.call(owner)
    expect(state.items[0].mentionPicker).toBeNull()
    expect(state.items[0].replies[0].richSegments).toBeNull()
    expect(state.items[0].replies[1].reactions[0]).toMatchObject({ count: 1, reactedByMe: true })
    const ui = createCommentPanel({ host: hostNode() }); cleanups.push(() => ui.destroy())
    ui.update(state)
    expect(ui.el.textContent).toContain('评论已删除')
    expect(ui.el.textContent).not.toContain('old secret')
  })
  it('pending 翻译的源 panel 消失后仍可查询原操作，失权时禁用', () => {
    const onQueryTranslation = vi.fn()
    const ui = createCommentPanel({ host: hostNode(), handlers: { onQueryTranslation } })
    cleanups.push(() => ui.destroy())
    const owner = {
      commentRemote: true, commentSidebarOpen: true, commentPanels: [], commentDocumentThreads: [],
      commentPendingTranslationOperation: 'original-translation', commentTranslationContext: { threadId: 'missing-thread', replyId: 'r1', sourceRevision: '2' },
      commentDraftImages: () => [], commentAuthorName: () => 'Alice', commentAllowed: () => false, commentCan: () => true,
    }
    ui.update(panelsUiMixin.methods.buildCommentState.call(owner))
    const query = ui.el.querySelector('[aria-label="查询翻译结果"]')
    expect(query).not.toBeNull()
    query.click()
    expect(onQueryTranslation).toHaveBeenCalledOnce()
    owner.commentCan = () => false
    ui.update(panelsUiMixin.methods.buildCommentState.call(owner))
    expect(ui.el.querySelector('[aria-label="查询翻译结果"]').disabled).toBe(true)
    ui.el.querySelector('[aria-label="查询翻译结果"]').click()
    expect(onQueryTranslation).toHaveBeenCalledOnce()
  })
  it('翻译 pending 保留原操作查询入口，忙碌时禁用，ready 后显示译文', () => {
    const onQueryTranslation = vi.fn(), onSubmitTranslation = vi.fn()
    const ui = createCommentPanel({ host: hostNode(), handlers: { onQueryTranslation, onSubmitTranslation } })
    cleanups.push(() => ui.destroy())
    const render = translation => ui.update({ open: true, remote: true, items: [{ id: 't1', replies: [], translation }] })
    render({ sourceRevision: '2', language: 'en', current: true, pending: true, busy: false, status: 'pending' })
    const query = ui.el.querySelector('[aria-label="查询翻译结果"]')
    expect(query).not.toBeNull()
    query.click()
    expect(onQueryTranslation).toHaveBeenCalledOnce()
    expect(onSubmitTranslation).not.toHaveBeenCalled()
    render({ sourceRevision: '2', language: 'en', current: true, pending: true, busy: true })
    expect(ui.el.querySelector('[aria-label="查询翻译结果"]').disabled).toBe(true)
    ui.el.querySelector('[aria-label="查询翻译结果"]').click()
    expect(onQueryTranslation).toHaveBeenCalledOnce()
    render({ sourceRevision: '2', language: 'en', current: true, pending: false, busy: false, status: 'ready', translatedText: 'Translated' })
    expect(ui.el.querySelector('[aria-label="查询翻译结果"]')).toBeNull()
    expect(ui.el.querySelector('.lark-doc-comment-translation').textContent).toContain('Translated')
    ui.update({ items: [], translationRecovery: { pending: true, canQuery: true } })
    ui.el.querySelector('[aria-label="查询翻译结果"]').click()
    expect(onQueryTranslation).toHaveBeenCalledTimes(2)
    ui.update({ translationRecovery: { pending: false, canQuery: false } })
    expect(ui.el.querySelector('[aria-label="查询翻译结果"]')).toBeNull()
  })
  it('通知空态、加载、失败和列表互斥，文本不作为 HTML 执行', () => {
    const host = hostNode()
    const ui = createNotifications({ host })
    cleanups.push(() => ui.destroy())
    const state = { open: true, style: { left: 8, top: 30 }, items: [], empty: true, allReadDisabled: true, muteLabel: '关闭通知' }
    ui.update(state)
    expect(ui.el.getAttribute('role')).toBe('dialog')
    expect(ui.el.getAttribute('aria-label')).toBe('当前文档通知')
    expect(ui.el.querySelector('.lark-doc-notify-loading-nested > .lark-doc-notify-loading-container > .lark-doc-notify-content')).not.toBeNull()
    expect(ui.el.querySelector('.lark-doc-notify-header-desc').textContent).toBe('当前文档通知')
    expect(ui.el.querySelector('.lark-doc-notify-mute-text').textContent).toBe('关闭通知')
    // 飞书真身（截图 970×1264）：铃铛紧贴标题右侧（16×16，ink 102.5..112），
    // 右侧「关闭通知」「全部已读」都是纯文字，不带图标。
    expect(ui.el.querySelector('.lark-doc-notify-header-desc .lark-doc-icon')).toBeNull()
    expect(ui.el.querySelector('.lark-doc-notify-status .lark-doc-icon').style.width).toBe('16px')
    expect(ui.el.querySelector('.lark-doc-notify-mute .lark-doc-icon')).toBeNull()
    // 「全部已读」禁用态在源码里只渲染 span.disable-text，不带图标。
    expect(ui.el.querySelector('.lark-doc-notify-readall .lark-doc-icon')).toBeNull()
    expect(ui.el.querySelector('.lark-doc-notify-empty-img svg').getAttribute('width')).toBe('120')
    // 空态插图是多色图标资源，取色统一由 palette.js 供给（12 T0-05 禁止组件里写字面色），
    // 断言插值后确实落到 SVG 属性上，避免以后改回字面 hex。
    const emptySvg = ui.el.querySelector('.lark-doc-notify-empty-img svg')
    expect(emptySvg.querySelector('path').getAttribute('stroke')).toBe(NOTIFY_TEAL)
    expect(emptySvg.querySelector('rect').getAttribute('fill')).toBe(NOTIFY_CARD)
    expect(emptySvg.querySelector('circle').getAttribute('fill')).toBe(NOTIFY_BRAND_BLUE)
    expect(host.textContent).toContain('当有人在当前文档提及你')
    expect(ui.el.querySelector('.lark-doc-notify-readall').disabled).toBe(true)
    expect(ui.el.querySelector('.lark-doc-notify-readall').classList.contains('is-disabled')).toBe(true)
    expect(host.textContent).toContain('暂无通知')
    expect(ui.el.style.left).toBe('8px')
    ui.update({ ...state, empty: false, loading: true })
    expect(ui.el.getAttribute('aria-busy')).toBe('true')
    expect(host.textContent).not.toContain('暂无通知')
    expect(host.querySelector('[role="alert"]')).toBeNull()
    ui.update({ ...state, empty: false, loadError: '离线，请重试' })
    expect(host.querySelector('[role="alert"]').textContent).toContain('离线，请重试')
    expect(host.textContent).not.toContain('暂无通知')
    const items = [{ id: 'n1', title: '<img src=x onerror=alert(1)>', body: '正文', readAt: null }]
    ui.update({ ...state, empty: false, items })
    const row = host.querySelector('.lark-doc-notify-item')
    expect(row.textContent).toContain('<img')
    expect(row.querySelector('img')).toBeNull()
    ui.update({ ...state, empty: false, items: [{ ...items[0], readAt: 123 }] })
    expect(host.querySelector('.lark-doc-notify-item')).toBe(row)
    expect(row.classList.contains('is-unread')).toBe(false)
    ui.update({ open: false })
    expect(host.querySelector('.lark-doc-notify-popover')).toBeNull()
  })

  it('通知时间行与类型文案表对齐飞书（刚刚 / N 分钟前 / HH:mm / 昨天 / 日期）', () => {
    const now = new Date(2026, 10, 22, 15, 30, 0).getTime()
    expect(formatNotifyTime(now - 20 * 1000, now)).toBe('刚刚')
    expect(formatNotifyTime(now - 8 * 60 * 1000, now)).toBe('8 分钟前')
    expect(formatNotifyTime(new Date(2026, 10, 22, 9, 5).getTime(), now)).toBe('09:05')
    expect(formatNotifyTime(new Date(2026, 10, 21, 20, 41).getTime(), now)).toBe('昨天 20:41')
    expect(formatNotifyTime(new Date(2026, 8, 3, 10, 0).getTime(), now)).toBe('9月3日')
    expect(formatNotifyTime(new Date(2025, 11, 31, 10, 0).getTime(), now)).toBe('2025年12月31日')
    expect(formatNotifyTime(null, now)).toBe('')
    // 源码 notice_type 的主干类型都要有确定文案，缺一个就会掉回「文档有新动态」。
    for (const type of ['comment', 'mention', 'mention-comment', 'reply', 'whole-comment', 'reaction',
      'content-reaction', 'resolved', 'whole-resolved', 'reopened', 'whole-reopened', 'suggestion',
      'suggestion-accepted', 'suggestion-rejected', 'deleted', 'share', 'permission', 'resource-binding']) {
      expect(NOTIFY_ACTIONS[type], type).toBeTruthy()
    }
  })

  it('通知操作阻止焦点丢失，忙碌时不重复派发', () => {
    const onToggleMute = vi.fn()
    const onMarkAllRead = vi.fn()
    const ui = createNotifications({ host: hostNode(), handlers: { onToggleMute, onMarkAllRead } })
    cleanups.push(() => ui.destroy())
    const state = { open: true, style: { left: 0, top: 0 }, items: [], allReadDisabled: false }
    ui.update(state)
    const mute = ui.el.querySelector('.lark-doc-notify-mute')
    const readAll = ui.el.querySelector('.lark-doc-notify-readall')
    // 标题后的静音态铃铛：开=三段路径（钟身 + 裙边 + 铃舌），关=四段（多一道斜杠）。
    const statusPaths = () => ui.el.querySelectorAll('.lark-doc-notify-status svg path').length
    expect(statusPaths()).toBe(3)
    const event = new MouseEvent('mousedown', { cancelable: true })
    mute.dispatchEvent(event)
    readAll.dispatchEvent(new MouseEvent('mousedown'))
    expect(event.defaultPrevented).toBe(true)
    expect(onToggleMute).not.toHaveBeenCalled()
    expect(onMarkAllRead).not.toHaveBeenCalled()
    mute.click()
    readAll.click()
    expect(onToggleMute).toHaveBeenCalledTimes(1)
    expect(onMarkAllRead).toHaveBeenCalledTimes(1)
    // Native buttons generate click for Enter/Space and assistive activation.
    for (const key of ['Enter', ' ']) {
      mute.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
      mute.dispatchEvent(new MouseEvent('click', { detail: 0, bubbles: true }))
    }
    expect(onToggleMute).toHaveBeenCalledTimes(3)
    for (const busy of [{ loading: true }, { writing: true }]) {
      ui.update({ ...state, ...busy, allReadDisabled: true })
      expect(ui.el.getAttribute('aria-busy')).toBe('true')
      expect(mute.disabled).toBe(true)
      expect(readAll.disabled).toBe(true)
      mute.dispatchEvent(new MouseEvent('mousedown'))
      readAll.dispatchEvent(new MouseEvent('mousedown'))
      mute.click(); readAll.click()
      expect(onToggleMute).toHaveBeenCalledTimes(3)
      expect(onMarkAllRead).toHaveBeenCalledTimes(1)
    }
    ui.update({ ...state, muteLabel: '开启通知' })
    expect(ui.el.getAttribute('aria-busy')).toBe('false')
    expect(mute.textContent).toBe('开启通知')
    expect(statusPaths()).toBe(4)
    expect(mute.disabled).toBe(false)
    expect(readAll.classList.contains('is-disabled')).toBe(false)
  })

  it('通知条目复刻飞书 nf-feed-message：头像 + 标题 + 灰卡 + 时间 + 未读红点', () => {
    const host = hostNode(), ui = createNotifications({ host }); cleanups.push(() => ui.destroy())
    const state = { open: true, style: { left: 0, top: 0 }, allReadDisabled: true }
    // 评论类：actor + 类型 ⇒ 标题「张三 评论了你编辑的内容」，正文进灰卡，带作者与剩余条数。
    ui.update({ ...state, items: [{
      id: 'c1', type: 'comment', actor: '张三', excerpt: '这段建议再补个例子', excerptAuthor: '张三',
      quote: '被引用的原文', restCount: 2, createdAt: Date.now(), read: false,
    }] })
    const row = host.querySelector('.lark-doc-notify-item')
    expect(row.classList.contains('is-unread')).toBe(true)
    expect(row.querySelector('.lark-doc-notify-item-title').textContent).toBe('张三 评论了你编辑的内容')
    expect(row.querySelector('.lark-doc-notify-item-avatar').textContent.slice(0, 1)).toBe('张')
    expect(row.querySelector('.lark-doc-notify-item-quote').textContent).toBe('被引用的原文')
    expect(row.querySelector('.lark-doc-notify-item-card-name').textContent).toBe('张三:')
    expect(row.querySelector('.lark-doc-notify-item-card-text').textContent).toBe('这段建议再补个例子')
    expect(row.querySelector('.lark-doc-notify-item-rest').textContent).toBe('查看剩余 2 条评论')
    expect(row.querySelector('.lark-doc-notify-item-time').textContent).toBe('刚刚')
    // 系统通知（无正文、无引用）：走 is-line —— 无头像、单行灰字、不带时间（飞书真身同款）。
    ui.update({ ...state, items: [{ id: 'p1', type: 'permission', actor: '李四', readAt: 1 }] })
    const plain = host.querySelector('.lark-doc-notify-item')
    expect(plain.classList.contains('is-line')).toBe(true)
    expect(plain.querySelector('.lark-doc-notify-item-avatar')).toBeNull()
    expect(plain.querySelector('.lark-doc-notify-item-time')).toBeNull()
    expect(plain.querySelector('.lark-doc-notify-item-title').textContent).toBe('李四 更新了文档权限')
    expect(plain.classList.contains('is-unread')).toBe(false)
    // 带引用的非评论通知：引用挂在卡片**外**（源码 `_quote` 与 `_summary-wrapper` 是两个分支）。
    ui.update({ ...state, items: [{ id: 'p2', type: 'permission', actor: '李四', quote: '权限已变更', readAt: 1 }] })
    const quoted = host.querySelector('.lark-doc-notify-item')
    expect(quoted.classList.contains('is-line')).toBe(false)
    expect(quoted.querySelector('.lark-doc-notify-item-card')).toBeNull()
    expect(quoted.querySelector('.lark-doc-notify-item-quote').textContent).toBe('权限已变更')
    // 每种类型都有确定文案，不落回「文档有新动态」。
    const kinds = [['mention', '在文档中提及了你'], ['reply', '回复了你的评论'], ['whole-comment', '发表了全文评论'], ['share', '分享文档给你']]
    for (const [type, text] of kinds) {
      ui.update({ ...state, items: [{ id: type, type, actor: '王五', readAt: 1 }] })
      expect(host.querySelector('.lark-doc-notify-item-title').textContent).toBe(`王五 ${text}`)
    }
    // 宿主显式给 title 时以宿主为准（老宿主注入的字段仍然通）。
    ui.update({ ...state, items: [{ id: 'legacy', title: '宿主标题', body: '正文', readAt: 1 }] })
    expect(host.querySelector('.lark-doc-notify-item-title').textContent).toBe('宿主标题')
    expect(host.querySelector('.lark-doc-notify-item-card-text').textContent).toBe('正文')
  })

  it('new notification popover owns focus while loading and exposes keyboard actions after loading', () => {
    const host = hostNode(), ui = createNotifications({ host }); cleanups.push(() => ui.destroy())
    const state = { open: true, loading: true, style: { left: 8, top: 48 }, items: [], allReadDisabled: true }
    ui.update(state); expect(document.activeElement).toBe(ui.el)
    ui.update({ ...state, loading: false }); expect(document.activeElement).toBe(ui.el.querySelector('.lark-doc-notify-mute'))
    ui.update({ ...state, loading: false, writing: true }); expect(document.activeElement).toBe(ui.el)
    ui.update({ ...state, loading: false, writing: false }); expect(document.activeElement).toBe(ui.el.querySelector('.lark-doc-notify-mute'))
  })

  it('通知行与历史分页提供原生按钮、忙碌闸门和可重试错误', () => {
    const onOpenItem = vi.fn(), onLoadMore = vi.fn()
    const ui = createNotifications({ host: hostNode(), handlers: { onOpenItem, onLoadMore } })
    cleanups.push(() => ui.destroy())
    const state = { open: true, style: { left: 0, top: 0 }, items: [{ id: 'n1', title: '回复', body: '正文', read: false }], hasMore: true }
    ui.update(state)
    const item = ui.el.querySelector('.lark-doc-notify-item-action')
    const more = ui.el.querySelector('.lark-doc-notify-more')
    expect(item.tagName).toBe('BUTTON')
    item.click(); more.click()
    expect(onOpenItem).toHaveBeenCalledWith('n1')
    expect(onLoadMore).toHaveBeenCalledOnce()
    ui.update({ ...state, historyLoading: true, openingId: 'n1' })
    expect(item.disabled).toBe(true); expect(more.disabled).toBe(true)
    item.click(); more.click()
    expect(onOpenItem).toHaveBeenCalledOnce(); expect(onLoadMore).toHaveBeenCalledOnce()
    ui.update({ ...state, historyError: '历史读取失败，请重试', items: [{ ...state.items[0], read: true }] })
    expect(ui.el.textContent).toContain('历史读取失败，请重试')
    expect(ui.el.querySelector('.is-unread')).toBeNull()
    expect(more.disabled).toBe(false)
    ui.update({ ...state, hasMore: false })
    expect(more.isConnected).toBe(false)
  })

  it('宿主注入read布尔值时全部已读同步计数和可见状态', async () => {
    const { host: vm, container } = runtimeFor(null)
    vm.setNotifications([{ id: 'local', title: '宿主通知', read: false }])
    vm.notifyOpen = true; await vm.$nextTick()
    container.querySelector('.lark-doc-notify-readall').click()
    expect(vm.notifyUnreadCount).toBe(0)
    await vm.$nextTick()
    expect(container.querySelector('.is-unread')).toBeNull()
  })

  it('真实原生宿主通知点击等单条回执/回读后才跳转，分页保留列表并支持重试', async () => {
    let items = [{ id: 'n1', notificationId: 'n1', threadId: 't1', title: '回复', read: false }]
    let finishRead, finishMore
    const provider = { list: vi.fn(async () => ({ items, hasMore: true })),
      markRead: vi.fn(() => new Promise(resolve => { finishRead = () => { items = [{ ...items[0], read: true }]; resolve({ status: 'committed', viewRefreshRequired: false }) } })),
      openThread: vi.fn(async () => true), loadMore: vi.fn(() => new Promise(resolve => { finishMore = resolve })) }
    const session = { documentId: 'doc', user: { id: 'alice' }, can: () => true, getProvider: name => name === 'notifications' ? provider : null }
    const runtime = runtimeFor(session), vm = runtime.host
    await vm.bindNotifications(); vm.notifyOpen = true; await vm.$nextTick()
    runtime.container.querySelector('.lark-doc-notify-item-action').click()
    expect(provider.markRead).toHaveBeenCalledWith(expect.objectContaining({ notificationId: 'n1', value: true }))
    expect(provider.openThread).not.toHaveBeenCalled()
    finishRead()
    await vi.waitFor(() => expect(provider.openThread).toHaveBeenCalledWith('n1'))
    await vm.$nextTick()
    expect(runtime.container.querySelector('.is-unread')).toBeNull()
    vm.notifyOpen = true; await vm.$nextTick()
    runtime.container.querySelector('.lark-doc-notify-more').click()
    expect(provider.loadMore).toHaveBeenCalledOnce()
    finishMore({ items: [...items, { id: 'n0', title: '历史', read: true }], hasMore: false })
    await vi.waitFor(() => expect(vm.notifyItems).toHaveLength(2))
    expect(vm.notifyHasMore).toBe(false)
    vm.notifyHasMore = true
    provider.loadMore.mockRejectedValueOnce(new Error('offline'))
    await vm.loadMoreNotifications()
    expect(vm.notifyItems).toHaveLength(2)
    expect(vm.notifyHistoryError).toContain('重试')
    provider.loadMore.mockResolvedValueOnce({ items, hasMore: false })
    await vm.loadMoreNotifications()
    expect(vm.notifyHistoryError).toBe('')
  })

  it('未知通知写入只查询原操作并在确认后解除入口，不重放写入', async () => {
    let pending = { operationId: 'original-notify-op', status: 'unknown' }
    const snapshot = () => ({ status: 'ready', items: [{ id: 'n1', title: '通知', read: true }], hasMore: false })
    const provider = { list: vi.fn(async () => snapshot()), getState: snapshot, getPendingOperation: () => pending,
      markRead: vi.fn(), setMuted: vi.fn(), markAllRead: vi.fn(), queryOperation: vi.fn(async id => { expect(id).toBe('original-notify-op'); pending = null; return { status: 'committed', viewRefreshRequired: false } }) }
    const session = { documentId: 'doc', user: { id: 'alice' }, can: () => true, getProvider: name => name === 'notifications' ? provider : null }
    const runtime = runtimeFor(session), vm = runtime.host
    await vm.bindNotifications(); vm.notifyOpen = true; await vm.$nextTick()
    const button = runtime.container.querySelector('.lark-doc-notify-query')
    expect(button).not.toBeNull(); button.click()
    await vi.waitFor(() => expect(vm.notifyPendingId).toBe(''))
    expect(provider.queryOperation).toHaveBeenCalledOnce()
    expect(provider.markRead).not.toHaveBeenCalled(); expect(provider.setMuted).not.toHaveBeenCalled(); expect(provider.markAllRead).not.toHaveBeenCalled()
    expect(runtime.container.querySelector('.lark-doc-notify-query')).toBeNull()
  })

  it('远端通知按钮使用既有结构化写入契约，Escape 不落回正文或隐藏触发器', async () => {
    let muted = false, items = [{ notificationId: 'n1', title: '回复', read: false }]
    const snapshot = () => ({ items, preference: { muted }, hasMore: false })
    const provider = { isRemote: true, snapshot: vi.fn(async () => snapshot()), list: vi.fn(async () => snapshot()),
      subscribe: callback => { callback(snapshot()); return () => {} },
      markRead: vi.fn(), markAllRead: vi.fn(async input => { expect(input).toEqual({}); items = [{ ...items[0], read: true }]; return { status: 'committed', viewRefreshRequired: false } }),
      setMuted: vi.fn(async input => { expect(input).toEqual({ value: true }); muted = true; return { status: 'committed', viewRefreshRequired: false } }) }
    const runtime = runtimeFor(createDocumentSession({ notifications: provider })), vm = runtime.host
    await vm.bindNotifications(); vm.notifyOpen = true; await vm.$nextTick()
    runtime.container.querySelector('.lark-doc-notify-readall').click()
    await vi.waitFor(() => expect(vm.notifyUnreadCount).toBe(0))
    await vi.waitFor(() => expect(vm.notifyWriting).toBe(false))
    runtime.container.querySelector('.lark-doc-notify-mute').click()
    await vi.waitFor(() => expect(vm.notifyMuted).toBe(true))
    const root = document.createElement('section'), mobile = document.createElement('button'), hidden = document.createElement('button')
    mobile.className = 'lark-doc-mobile-actions-toggle'; hidden.hidden = true
    root.append(mobile, hidden, runtime.container); document.body.append(root); vm.$refs.root = root
    const width = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    try {
      vm.notifyOpen = false
      vm.toggleNotify({ currentTarget: hidden }); await vm.$nextTick()
      const bubble = vi.fn(); root.addEventListener('keydown', bubble)
      const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      runtime.container.querySelector('.lark-doc-notify-mute').dispatchEvent(escape)
      expect(escape.defaultPrevented).toBe(true); expect(bubble).not.toHaveBeenCalled()
      expect(document.activeElement).toBe(mobile)
      expect(vm.notifyOpen).toBe(false)
    } finally { Object.defineProperty(window, 'innerWidth', { configurable: true, value: width }); root.remove() }
  })

  it('通知原请求未确认时不重发写入，跳转目标经当前评论视图接线', async () => {
    const pending = { operationId: 'original' }
    const provider = { list: vi.fn(async () => [{ id: 'n1', threadId: 't1', title: '回复', read: false }]),
      markRead: vi.fn(), openThread: vi.fn(async () => ({ target: { threadId: 't1' } })), getPendingOperation: vi.fn(() => pending) }
    const { host: vm } = runtimeFor({ user: { id: 'alice' }, can: () => true, getProvider: name => name === 'notifications' ? provider : null })
    await vm.bindNotifications()
    expect(await vm.openNotification('n1')).toBeNull()
    expect(provider.markRead).not.toHaveBeenCalled(); expect(provider.openThread).not.toHaveBeenCalled()
    expect(vm.notifyActionError).toContain('原请求')
    provider.getPendingOperation.mockReturnValue(null)
    vm.notifyItems = [{ ...vm.notifyItems[0], read: true }]
    const comments = {}
    vm.commentProvider = () => comments
    vm.loadComments = vi.fn(async () => { vm.commentThreads = [{ id: 't1', scope: 'selection', bound: true, blockId: 'b1' }] })
    vm.activateComment = vi.fn(); vm.scrollCommentIntoView = vi.fn()
    expect(await vm.openNotification('n1')).toBe(true)
    expect(vm.activateComment).toHaveBeenCalledWith('t1')
    expect(vm.scrollCommentIntoView).toHaveBeenCalledWith('b1')
  })

  it('分页迟到响应不覆盖较新读取，Provider重置后仍能从错误按钮重新读取', async () => {
    let finish
    const provider = { list: vi.fn(async () => ({ items: [{ id: 'new', title: '当前' }], hasMore: true })), loadMore: vi.fn(() => new Promise(resolve => { finish = resolve })) }
    const { host: vm } = runtimeFor({ user: { id: 'alice' }, can: () => true, getProvider: name => name === 'notifications' ? provider : null })
    await vm.bindNotifications()
    const old = vm.loadMoreNotifications()
    await vm.loadNotifications()
    finish({ items: [{ id: 'old' }], hasMore: false })
    expect(await old).toBeNull(); expect(vm.notifyItems[0].id).toBe('new')
    vm.notifyHasMore = false; vm.notifyHistoryError = '历史读取失败'
    await vm.loadMoreNotifications()
    expect(vm.notifyHistoryError).toBe(''); expect(vm.notifyItems[0].id).toBe('new')
  })

  it.each(['identity', 'provider', 'permission', 'destroy'])('单条通知写入期间 %s 变化不继续旧跳转或回填', async change => {
    let finish, allowed = true
    const original = { list: vi.fn(async () => [{ id: 'n1', threadId: 't1', title: '回复', read: false }]),
      markRead: vi.fn(() => new Promise(resolve => { finish = resolve })), openThread: vi.fn(async () => true) }
    let provider = original
    const session = { documentId: 'doc', user: { id: 'alice' }, can: () => allowed, getProvider: name => name === 'notifications' ? provider : null }
    const { host: vm } = runtimeFor(session)
    await vm.bindNotifications()
    const opening = vm.openNotification('n1')
    if (change === 'identity') session.user = { id: 'bob' }
    if (change === 'provider') provider = { ...original }
    if (change === 'permission') allowed = false
    if (change === 'destroy') vm._notifyDisposed = true
    vm.notifyItems = [{ id: 'current' }]; vm.error = 'current'
    finish({ status: 'succeeded' })
    await opening
    expect(original.openThread).not.toHaveBeenCalled()
    expect(vm.notifyItems).toEqual([{ id: 'current' }])
    expect(vm.error).toBe('current')
  })

  it('原生挂载、宿主注入、测量纠偏和关闭都无需 SFC ref', async () => {
    const runtime = runtimeFor(null)
    const vm = runtime.host
    vm.setNotifications([{ id: 'n1', title: '通知' }])
    vm.toggleNotify({ currentTarget: { getBoundingClientRect: () => ({ left: 700, right: 730, top: 10, bottom: 40, width: 30, height: 30 }) } })
    await vm.$nextTick()
    const el = runtime.container.querySelector('.lark-doc-notify-popover')
    expect(el).toBe(vm._notificationsUi.el)
    const measure = vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ width: 402, height: 555 })
    vm.measureNotify()
    expect(measure).toHaveBeenCalledTimes(1)
    expect(vm.notifyContains(el.firstChild)).toBe(true)
    vm.markAllNotifyRead()
    await vm.$nextTick()
    expect(el.querySelector('.is-unread')).toBeNull()
    vm.closeNotify()
    await vm.$nextTick()
    expect(runtime.container.querySelector('.lark-doc-notify-popover')).toBeNull()
    expect(runtime.container.querySelector('.lark-doc-p6b-layer')).not.toBeNull()
  })

  it('读取失败不冒充空态，Provider 恢复后原生视图刷新', async () => {
    const provider = { list: vi.fn().mockRejectedValueOnce(new Error('离线')).mockResolvedValue([]), markAllRead: vi.fn(), setMuted: vi.fn() }
    const runtime = runtimeFor(createDocumentSession({ notifications: provider }))
    const vm = runtime.host
    await vm.bindNotifications()
    vm.notifyOpen = true
    await vm.$nextTick()
    expect(runtime.container.querySelector('[role="alert"]').textContent).toContain('读取失败')
    await vm.loadNotifications()
    await vm.$nextTick()
    expect(runtime.container.querySelector('[role="alert"]')).toBeNull()
    expect(runtime.container.textContent).toContain('暂无通知')
  })

  it('无 canView 不打开通知，失权后隐藏权限敏感浮层', async () => {
    const session = createDocumentSession({ capabilities: { canView: false, canManagePermission: true } })
    const runtime = runtimeFor(session)
    const vm = runtime.host
    vm.toggleNotify({ currentTarget: { getBoundingClientRect: vi.fn() } })
    expect(vm.notifyOpen).toBe(false)
    session._capabilities.canView = true
    vm.$forceUpdate()
    await vm.$nextTick()
    vm.sharePopoverOpen = true
    vm.permissionDialogOpen = true
    await vm.$nextTick()
    expect(runtime.container.querySelector('.lark-doc-permission-dialog')).not.toBeNull()
    session._capabilities.canManagePermission = false
    vm.$forceUpdate()
    await vm.$nextTick()
    expect(runtime.container.querySelector('.lark-doc-permission-dialog')).toBeNull()
    expect(runtime.container.querySelector('.lark-doc-share-popover')).toBeNull()
  })

  it('keeps explicit export routes and pending query reachable after close while rejecting retired controls', () => {
    const route = vi.fn(), query = vi.fn(), submit = vi.fn()
    const ui = createOverlays({ host: hostNode(), handlers: { onSelectExportRoute: route, onQueryRemoteExport: query, onSubmitExport: submit } })
    cleanups.push(() => ui.destroy())
    const state = { exportOpen: true, exportPanelTitle: '导出Word', exportCanExport: true, exportSubmitDisabled: false,
      exportRoute: 'remote', exportRemoteAvailable: true, exportRouteDescription: '已保存版本', exportScopeOptions: [{ value: 'contentOnly', label: '不可变正文' }] }
    ui.update(state)
    const select = ui.el.querySelector('[aria-label="导出方式"]'), retired = ui.el.querySelector('.lark-doc-export-submit')
    expect(select.value).toBe('remote')
    select.value = 'local'; select.dispatchEvent(new Event('change', { bubbles: true }))
    expect(route).toHaveBeenCalledWith('local')
    ui.update({ ...state, exportOpen: false, exportToast: '结果未确认', exportPendingOperationId: 'export-original' })
    const button = ui.el.querySelector('.lark-doc-export-query')
    expect(button.isConnected).toBe(true)
    button.click(); expect(query).toHaveBeenCalledTimes(1)
    ui.update({ ...state, exportOpen: false, exportToast: '', exportPendingOperationId: 'export-original' })
    expect(button.isConnected).toBe(true)
    expect(ui.el.textContent).toContain('原导出请求待查询')
    retired.click(); select.dispatchEvent(new Event('change', { bubbles: true }))
    expect(submit).not.toHaveBeenCalled(); expect(route).toHaveBeenCalledTimes(1)
    ui.update({ ...state, exportOpen: false, exportCanExport: false, exportToast: '无权限', exportPendingOperationId: 'export-original' })
    expect(button.disabled).toBe(true); button.click(); expect(query).toHaveBeenCalledTimes(1)
    ui.destroy(); button.click(); expect(query).toHaveBeenCalledTimes(1)
  })

  it('导出权限和水印属性迁移，关闭弹窗后仍保留异步 toast', () => {
    const ui = createOverlays({ host: hostNode() })
    cleanups.push(() => ui.destroy())
    const state = { exportOpen: true, exportPanelTitle: '导出', exportCanExport: false, exportSubmitDisabled: true,
      outputWatermarkAttributes: { 'data-watermark': 'visible', 'data-watermark-text': '内部' },
      exportScopeOptions: [{ value: 'all', label: '全部内容' }] }
    ui.update(state)
    const panel = ui.el.querySelector('.lark-doc-export-panel')
    expect(panel.getAttribute('data-watermark-text')).toBe('内部')
    expect(panel.querySelector('[data-capability="canExport"]').getAttribute('aria-disabled')).toBe('true')
    expect(panel.querySelector('input').disabled).toBe(true)
    ui.update({ ...state, outputWatermarkAttributes: {}, exportOpen: false, exportToast: '正在导出文档' })
    expect(ui.el.querySelector('.lark-doc-export-panel')).toBeNull()
    expect(ui.el.querySelector('[role="status"]').textContent).toContain('正在导出文档')
    ui.update({ ...state, outputWatermarkAttributes: {} })
    expect(panel.hasAttribute('data-watermark')).toBe(false)
    expect(panel.hasAttribute('data-watermark-text')).toBe(false)
  })

  it('水印由当前安全策略生成，不读旧 Vue 中不存在的 computed', () => {
    const runtime = runtimeFor({ can: () => true, getProvider: name => name === 'security' ? { policy: { watermark: 'visible', watermarkText: '内部' } } : null })
    expect(runtime.host.buildOverlaysState().outputWatermarkAttributes).toEqual({ 'data-watermark': 'visible', 'data-watermark-text': '内部' })
  })

  it('权限按钮和开关保留 capability、disabled 与 aria 标记', () => {
    const ui = createOverlays({ host: hostNode() })
    cleanups.push(() => ui.destroy())
    ui.update({ sharePopoverOpen: true, permissionDialogOpen: true, shareCanManagePermission: false })
    const button = ui.el.querySelector('.lark-doc-share-perm-btn')
    const toggle = ui.el.querySelector('.lark-doc-permission-switch')
    for (const el of [button, toggle]) {
      expect(el.disabled).toBe(true)
      expect(el.getAttribute('data-capability')).toBe('canManagePermission')
      expect(el.getAttribute('aria-disabled')).toBe('true')
    }
  })

  it('版本回收站完整渲染并派发动作，busy 时阻止重复操作', () => {
    const handlers = { onOpenTrash: vi.fn(), onCloseTrash: vi.fn(), onRestoreDeleted: vi.fn(), onPurgeDeleted: vi.fn() }
    const ui = createVersionPanel({ host: hostNode(), handlers })
    cleanups.push(() => ui.destroy())
    const trash = { open: true, canManage: true, busy: false, items: [{ id: 'v1', name: '10月27日', label: '版本' }] }
    ui.update({ open: true, trash })
    // 飞书历史记录头部只有「历史记录 + 圆圈问号」：面板内既没有回收站按钮，也没有
    // chevronDown。回收站入口在「已存版本」子菜单末尾（documentMenuView.js:195 直连
    // `openVersionTrash()`），因此面板这一层不再派发 onOpenTrash。
    expect(ui.el.querySelector('.lark-doc-version-trash-toggle')).toBeNull()
    expect(ui.el.querySelector('.lark-doc-version-right-icon')).toBeNull()
    const actions = ui.el.querySelectorAll('.lark-doc-version-trash-list button')
    actions[0].click()
    actions[1].click()
    expect(handlers.onOpenTrash).not.toHaveBeenCalled()
    expect(handlers.onRestoreDeleted).toHaveBeenCalledWith('v1')
    expect(handlers.onPurgeDeleted).toHaveBeenCalledWith('v1')
    expect(ui.el.querySelector('.lark-doc-version-restore').getAttribute('data-capability')).toBe('canRestoreVersion')
    ui.update({ trash: { ...trash, busy: true } })
    expect([...ui.el.querySelectorAll('.lark-doc-version-trash-list button')].every(button => button.disabled)).toBe(true)
    ui.update({ trash: { ...trash, items: [] } })
    expect(ui.el.querySelector('.lark-doc-version-trash').textContent).toContain('回收站为空')
    ui.update({ trash: { ...trash, open: false } })
    expect(ui.el.querySelector('.lark-doc-version-trash')).toBeNull()
  })

  it('评论与历史版本保留 dev 的权限语义', () => {
    const comment = createCommentPanel({ host: hostNode() })
    const version = createVersionPanel({ host: hostNode() })
    cleanups.push(() => { comment.destroy(); version.destroy() })
    comment.update({ open: true, controls: [{ id: 'resolve', label: '解决' }], items: [{ id: 't1', disabled: ['resolve'], textarea: { height: 50 } }] })
    const resolve = comment.el.querySelector('.lark-doc-comment-btn')
    expect(resolve.getAttribute('data-capability')).toBe('canResolveComment')
    expect(resolve.getAttribute('aria-disabled')).toBe('true')
    version.update({ open: true, restore: { disabled: true, title: '' } })
    const restore = version.el.querySelector('.lark-doc-version-restore')
    expect(restore.getAttribute('data-capability')).toBe('canRestoreVersion')
    expect(restore.getAttribute('aria-disabled')).toBe('true')
  })
  it('评论操作支持原生 click 和键盘激活，鼠标按下只保留焦点且禁用不执行', () => {
    const onSubmit = vi.fn(), onChooseImage = vi.fn(), onControl = vi.fn()
    const ui = createCommentPanel({ host: hostNode(), handlers: { onSubmit, onChooseImage, onControl } })
    cleanups.push(() => ui.destroy())
    const item = { id: 't1', hasDraft: true, allowedReply: true, canUploadImage: true, textarea: { value: '回复', height: 50 } }
    ui.update({ open: true, controls: [{ id: 'resolve', label: '解决' }], items: [item] })
    const send = ui.el.querySelector('.lark-doc-comment-action.is-filled')
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    send.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
    expect(onSubmit).not.toHaveBeenCalled()
    send.click()
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('t1')
    ui.el.querySelector('.lark-doc-comment-operation').click()
    expect(onChooseImage).toHaveBeenCalledExactlyOnceWith('t1')
    ui.el.querySelector('.lark-doc-comment-btn').click()
    expect(onControl).toHaveBeenCalledExactlyOnceWith('resolve', 't1')
    ui.update({ items: [{ ...item, allowedReply: false, canUploadImage: false, disabled: ['resolve'] }] })
    send.click()
    ui.el.querySelector('.lark-doc-comment-operation').click()
    ui.el.querySelector('.lark-doc-comment-btn').click()
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onChooseImage).toHaveBeenCalledTimes(1)
    expect(onControl).toHaveBeenCalledTimes(1)
  })

  it('评论图片区分可预览与不可见占位，图片草稿可移除，刷新保留回复输入光标', () => {
    const onPreviewAttachment = vi.fn(), onRemoveAttachment = vi.fn()
    const ui = createCommentPanel({ host: hostNode(), handlers: { onPreviewAttachment, onRemoveAttachment } })
    cleanups.push(() => ui.destroy())
    const item = { id: 't1', hasDraft: true, allowedReply: true, textarea: { value: '继续输入', height: 80 },
      draftImages: [{ id: 'draft', name: '草稿.png', previewUrl: 'blob:draft' }],
      replies: [{ id: 'r1', body: '图片', attachments: [
        { attchId: 'blocked', name: '加载.png', url: '', blocked: true, blockedReason: '图片被当前网络策略拦截' },
        { attchId: 'ready', name: '已就绪.png', url: 'blob:ready' },
      ] }] }
    ui.update({ open: true, items: [item] })
    const input = ui.el.querySelector('[role="textbox"][aria-label="回复"]')
    input.focus()
    document.getSelection().collapse(input.querySelector('p').firstChild, 2)
    // 已存附件：有 url 的包进 `.lark-doc-comment-attachment-preview`（aria「预览评论图片N」，
    // mousedown 触发），没有 url 的只留一行原因 —— 已存图片没有重试入口，重试只活在草稿里。
    const previews = ui.el.querySelectorAll('[data-comment-thread="t1"] .lark-doc-comment-body-attachments button')
    expect(previews).toHaveLength(1)
    expect(previews[0].getAttribute('aria-label')).toBe('预览评论图片2')
    expect(previews[0].querySelector('img').getAttribute('src')).toBe('blob:ready')
    previews[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    expect(onPreviewAttachment).toHaveBeenCalledWith('t1', 'r1', 1)
    expect(ui.el.querySelector('[data-comment-thread="t1"] .lark-doc-comment-body-attachments').textContent).toContain('图片被当前网络策略拦截')
    // 草稿上的 × 和 × 一样走 `onMouseDownPrevent`：只认 mousedown，不认 click。
    ui.el.querySelector('[data-comment-thread="t1"] .lark-doc-comment-attachments [aria-label="移除评论图片"]')
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    expect(onRemoveAttachment).toHaveBeenCalledExactlyOnceWith('t1', 'draft')
    ui.update({ items: [{ ...item, draftImages: [] }] })
    expect(ui.el.querySelector('[role="textbox"][aria-label="回复"]')).toBe(input)
    expect(document.getSelection().anchorOffset).toBe(2)
    expect(ui.el.querySelectorAll('.lark-doc-comment-attachments .lark-doc-comment-attachment')).toHaveLength(0)
  })

  it('图片预览可关闭并约束键盘焦点，上传未知状态可查询原操作', () => {
    const onCloseImage = vi.fn(), onCancelImageUpload = vi.fn(), onQueryImage = vi.fn()
    const ui = createCommentPanel({ host: hostNode(), handlers: { onCloseImage, onCancelImageUpload, onQueryImage } })
    cleanups.push(() => ui.destroy())
    ui.update({ open: true, imageViewer: { url: 'blob:ready', fileName: '评论.png' }, imageStatus: { busy: true, canCancel: true, pending: true, canQuery: false } })
    const viewer = ui.el.querySelector('[aria-label="评论图片预览"]')
    expect(viewer.querySelector('img').getAttribute('src')).toBe('blob:ready')
    viewer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(viewer.querySelector('button'))
    viewer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(onCloseImage).toHaveBeenCalledExactlyOnceWith(true)
    ui.el.querySelector('[aria-label="取消评论图片上传"]').click()
    expect(onCancelImageUpload).toHaveBeenCalledTimes(1)
    const query = ui.el.querySelector('[aria-label="查询原图片操作"]')
    expect(query.disabled).toBe(true)
    ui.update({ imageViewer: null, imageStatus: { busy: false, pending: true, canQuery: true } })
    expect(ui.el.querySelector('[aria-label="评论图片预览"]')).toBeNull()
    query.click()
    expect(onQueryImage).toHaveBeenCalledTimes(1)
  })

  it('评论原生面板投影 mention/文档引用、reaction picker、编辑翻译和全文 composer', () => {
    const calls = {
      onDocumentReference: vi.fn(), onReaction: vi.fn(), onChooseReaction: vi.fn(), onReactionQuery: vi.fn(),
      onReactionCategory: vi.fn(), onMoreReaction: vi.fn(), onReplyControl: vi.fn(), onEditDraft: vi.fn(), onCancelEdit: vi.fn(),
      onSaveEdit: vi.fn(), onTranslationLanguage: vi.fn(), onCloseTranslation: vi.fn(), onSubmitTranslation: vi.fn(),
      onDocumentComposerDraft: vi.fn(), onDocumentComposerCancel: vi.fn(), onDocumentComposerPrivate: vi.fn(), onDocumentComposerSubmit: vi.fn(),
      onDraft: vi.fn(), onMentionKeydown: vi.fn(), onChooseMention: vi.fn(),
    }
    const ui = createCommentPanel({ host: hostNode(), handlers: calls })
    cleanups.push(() => ui.destroy())
    ui.update({ open: true, remote: true, replyControls: [{ id: 'emoji', label: '添加表情回复', icon: 'sparkle' }],
      items: [{ id: 't1', textarea: { height: 50 }, replies: [{ id: 'r1', body: 'ignored', segments: [
        { text: '@Alice', principalId: 'alice', isSelf: false }, { text: ' 参见计划 ' }, { text: 'Plan', docId: 'doc-2', readable: true },
      ], reactions: [{ emoji: '👍', count: '2', reactedByMe: true, label: '点赞', canReact: true }] }],
      mentionPicker: { query: 'Al', candidates: [{ principalId: 'alice', displayName: 'Alice' }], index: 0 },
      edit: { replyId: 'r1', value: '编辑中', readonly: false, canUploadImage: true, draftImages: [] },
      translation: { sourceRevision: '3', language: 'zh-CN', current: true, busy: false, pending: false, message: '译文已返回；原文未被改写。', translatedText: '计划' } }],
      // 选择器网格来自离线表情目录（`commentReactionCatalog`），不是内联列表：
      // 按钮 aria 取 `item.name`，回调给的是 `item.id`。
      reactionPicker: { open: true, recent: [], catalog: { sprite: 'blob:sprite', items: [
        { id: 'tada_v2', name: '庆祝', pos: '0px 0px', size: '24px 24px', width: 24, height: 24 },
        { id: 'thumbsup_v2', name: '赞', pos: '-24px 0px', size: '24px 24px', width: 24, height: 24 },
      ] } },
      documentComposer: { open: true, value: '@Bob', segments: [{ text: '@Bob', principalId: 'bob' }], readonly: false, canSubmit: true, canUploadImage: true, privateOn: false, hasImages: false, draftImages: [], replyTarget: { displayName: 'Alice' } },
    })
    expect(ui.el.querySelector('[data-comment-mention="alice"]')).not.toBeNull()
    const reference = ui.el.querySelector('[data-comment-reference="doc-2"]')
    expect(reference).not.toBeNull(); reference.click()
    expect(calls.onDocumentReference).toHaveBeenCalledWith('t1', 'r1', expect.objectContaining({ docId: 'doc-2' }), expect.anything())
    const reaction = ui.el.querySelector('.lark-doc-comment-reaction')
    expect(reaction.getAttribute('aria-pressed')).toBe('true'); reaction.click()
    expect(calls.onReaction).toHaveBeenCalledWith('t1', 'r1', '👍', false)
    const replyControl = ui.el.querySelector('[aria-label="添加表情回复"]')
    replyControl.click()
    expect(calls.onReplyControl).toHaveBeenCalledWith('emoji', 't1', 'r1', expect.any(Event))
    calls.onReplyControl.mockClear()
    const touchUp = new Event('pointerup', { bubbles: true, cancelable: true })
    Object.defineProperty(touchUp, 'pointerType', { value: 'touch' })
    replyControl.dispatchEvent(touchUp)
    // Keep the original hit target mounted until the browser's compatibility
    // click; opening a picker on pointerup can retarget that click into it.
    expect(calls.onReplyControl).not.toHaveBeenCalled()
    replyControl.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(calls.onReplyControl).toHaveBeenCalledTimes(1)
    ui.el.querySelector('.lark-doc-comment-reaction-grid button[aria-label="庆祝"]').click()
    expect(calls.onChooseReaction).toHaveBeenCalledWith('tada_v2')
    const editInput = ui.el.querySelector('.lark-doc-comment-edit [role="textbox"]')
    pasteRich(editInput, '已编辑')
    expect(calls.onEditDraft).toHaveBeenCalledWith('t1', 'r1', '已编辑', expect.any(Event))
    ui.el.querySelector('.lark-doc-comment-edit-actions button:last-child').click()
    expect(calls.onSaveEdit).toHaveBeenCalledTimes(1)
    ui.el.querySelector('.lark-doc-comment-translation select').value = 'en'
    ui.el.querySelector('.lark-doc-comment-translation select').dispatchEvent(new Event('change', { bubbles: true }))
    expect(calls.onTranslationLanguage).toHaveBeenCalledWith('en')
    ui.el.querySelector('.lark-doc-comment-translation-actions button:last-child').click()
    expect(calls.onSubmitTranslation).toHaveBeenCalledTimes(1)
    const mention = ui.el.querySelector('.lark-doc-comment-mention-picker button')
    expect(mention.getAttribute('role')).toBe('option'); mention.click()
    expect(calls.onChooseMention).toHaveBeenCalledWith({ principalId: 'alice', displayName: 'Alice' })
    const replyInput = ui.el.querySelector('.lark-doc-comment-input-zone')
    replyInput.focus()
    replyInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    expect(calls.onMentionKeydown).toHaveBeenCalledWith('t1', 'ArrowDown')
    const documentInput = ui.el.querySelector('.lark-doc-document-composer-input')
    expect(ui.el.classList.contains('is-remote')).toBe(true)
    expect(documentInput.closest('.lark-doc-document-comment-input')).not.toBeNull()
    expect(ui.el.querySelector('.lark-doc-document-composer-actions').hidden).toBe(false)
    pasteRich(documentInput, '全文')
    expect(calls.onDocumentComposerDraft).toHaveBeenCalledWith('全文', expect.any(Event))
    ui.el.querySelector('.lark-doc-document-composer-actions button:last-child').click()
    expect(calls.onDocumentComposerSubmit).toHaveBeenCalledTimes(1)
  })

  it('桌面「查看协作者」打开管理协作者弹窗并展示成员角色', () => {
    const width = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 })
    const host = hostNode()
    const onManage = vi.fn(), onAdd = vi.fn()
    const ui = createOverlays({ host, handlers: { onOpenCollaboratorManage: onManage, onOpenCollaboratorAdd: onAdd } })
    cleanups.push(() => { ui.destroy(); Object.defineProperty(window, 'innerWidth', { configurable: true, value: width }) })
    ui.update({ sharePopoverOpen: true, shareCanManagePermission: true })
    host.querySelector('.lark-doc-share-avatars').click()
    expect(onManage).toHaveBeenCalledOnce()
    ui.update({ collaboratorManageOpen: true, shareMembers: { status: 'ready', items: [{ principalId: 'bob', scopes: ['grant.manage'] }] } })
    const dialog = host.querySelector('.lark-doc-collab-manage')
    expect(dialog).not.toBeNull()
    expect(dialog.querySelector('.lark-doc-collab-title').textContent).toBe('管理协作者')
    expect(dialog.querySelector('.lark-doc-collab-name').textContent).toBe('bob')
    expect(dialog.querySelector('.lark-doc-collab-role').textContent).toBe('可管理')
    dialog.querySelector('[aria-label="添加协作者"]').click()
    expect(onAdd).toHaveBeenCalledOnce()
  })

  it('添加协作者弹窗渲染表单并锁定未选人时的发送按钮', () => {
    const host = hostNode()
    const onSelect = vi.fn(), onSend = vi.fn(), onNote = vi.fn()
    const ui = createOverlays({ host, handlers: { onSelectShareInviteCandidate: onSelect, onSubmitShareInvitation: onSend, onSetCollaboratorNote: onNote } })
    cleanups.push(() => ui.destroy())
    ui.update({ collaboratorAddOpen: true, shareDirectory: { status: 'ready', items: [{ principalId: 'bob', displayName: 'Bob' }] } })
    const dialog = host.querySelector('.lark-doc-collab-add')
    expect(dialog).not.toBeNull()
    expect(dialog.querySelector('[aria-label="搜索用户、群组、部门、用户组或智能体"]')).not.toBeNull()
    expect(dialog.querySelectorAll('.lark-doc-collab-checkbox').length).toBe(2)
    const send = dialog.querySelector('.lark-doc-collab-btn-filled')
    expect(send.textContent).toBe('发送')
    expect(send.disabled).toBe(true)
    dialog.querySelector('.lark-doc-collab-candidate').click()
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('bob')
    ui.update({ shareInvitation: { candidate: { principalId: 'bob' }, status: 'confirm' } })
    expect(host.querySelector('.lark-doc-collab-add .lark-doc-collab-btn-filled').disabled).toBe(false)
    host.querySelector('.lark-doc-collab-add .lark-doc-collab-btn-filled').click()
    expect(onSend).toHaveBeenCalledOnce()
    const note = dialog.querySelector('textarea')
    note.value = 'hello'; note.dispatchEvent(new Event('input', { bubbles: true }))
    expect(onNote).toHaveBeenCalledWith('hello')
  })

})
