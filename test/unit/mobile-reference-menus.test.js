// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { referenceDocumentMenuItems, referenceDocumentMenuChildren, runReferenceDocumentMenuAction } from '../../src/components/lark-doc/editor/documentMenuView'
import topbarMoreMixin, { referenceTopbarMoreMenuStyle, topbarMoreMenuStyle } from '../../src/components/lark-doc/editor/topbarMoreMixin'
import exportMixin from '../../src/components/lark-doc/editor/exportMixin'
import { createTopBar } from '../../src/ui/topBar'
import { createMemoryCommentsProvider } from '../../src/core/comments/memory-provider'
import shareMixin from '../../src/components/lark-doc/editor/shareMixin'
import { createOverlays } from '../../src/ui/overlays'
import { LarkDoc } from '../../src/LarkDoc'
import { createMemoryVersioningProvider } from '../../src/core/versioning/provider'

const mounted = [], width = window.innerWidth, originalMedia = window.matchMedia
const originalRangeRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects'), originalRangeBounds = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')
afterEach(() => {
  mounted.splice(0).forEach(ui => ui.destroy()); document.body.replaceChildren()
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width }); window.matchMedia = originalMedia
  for (const [key, descriptor] of [['getClientRects', originalRangeRects], ['getBoundingClientRect', originalRangeBounds]]) {
    if (descriptor) Object.defineProperty(Range.prototype, key, descriptor)
    else delete Range.prototype[key]
  }
  vi.restoreAllMocks()
})
function editorHost() {
  return { _mobileEditorMedia: { matches: true }, session: { user: { id: 'actor' }, documentId: 'document', can: () => true, getProvider: () => null },
    featureEnabled: () => true, toolbarEnabled: () => true, writable: () => true, shareCan: () => true,
    mode: 'edit', modeLabel: '编辑模式', modeOptions: [{ id: 'edit', label: '编辑模式' }, { id: 'read', label: '阅读模式' }],
    notificationContext: () => ({}), notifyCurrent: () => true, toggleNotify: vi.fn(), aiProvider: null,
    versionProvider: {}, versionCanCreate: true, versionList: [], exportCanExport: true,
    createMenuRows: [{ kind: 'item', id: 'document', label: '文档' }], closeHeaderMenu: vi.fn(), setMode: vi.fn(),
    openSearch: vi.fn(), setWidthMode: vi.fn(), openPermissionDialog: vi.fn(), $emit: vi.fn() }
}
function shareState(extra = {}) {
  return { shareEntryVisible: true, shareEntryLabel: '分享', shareCanManagePermission: true, sharePopoverOpen: true,
    sharePopoverStyle: { top: '52px', left: '16px' }, shareMembers: { status: 'ready', items: [{ principalId: 'actor', scopes: ['document.read'] }] },
    shareDirectory: { status: 'idle', items: [] }, shareInvitation: { status: 'idle' }, shareOrgName: '链接范围未配置',
    shareLinkPermLabel: '可阅读', shareLinkPermOptions: ['可阅读', '可编辑'], ...extra }
}
function overlays(handlers = {}) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
  const host = document.createElement('section'); host.className = 'lark-doc'; document.body.appendChild(host)
  const ui = createOverlays({ host, handlers }); mounted.push(ui); return ui
}
describe('phone saved-version menu reads', () => {
  function nativeVersionMenu(provider = createMemoryVersioningProvider({ author: 'menu-version-owner' })) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    window.matchMedia = query => Object.assign(new EventTarget(), { media: query, matches: /max-width|pointer: coarse|hover: none/.test(query) })
    const element = document.createElement('div'); document.body.appendChild(element)
    const doc = new LarkDoc({ element, storage: 'none', documentId: 'menu-versions', user: { id: 'menu-version-owner' },
      versioning: provider, content: '<p data-block-id="menu-version-body">原正文</p>' }); mounted.push(doc)
    const host = doc._handle.nativeHost.host, more = element.querySelector('[aria-label="更多文档操作"]')
    const choose = async id => {
      if (!host.topbarMoreOpen) more.click()
      const item = await vi.waitFor(() => { const node = element.querySelector(`[data-topbar-more-id="${id}"]`); expect(node).not.toBeNull(); return node })
      item.click(); return item
    }
    return { doc, host, element, provider, more, choose }
  }
  it('lists the first automatic version before any history panel was opened', async () => {
    const { doc, host, element, provider, choose } = nativeVersionMenu(), before = doc.getJSON()
    await doc.getSession().createVersion({ purpose: 'auto', label: 'QA 模拟自动记录' })
    const saved = await provider.list({ documentId: 'menu-versions' })
    expect(saved).toHaveLength(1); expect(saved[0]).toMatchObject({ kind: 'auto', label: 'QA 模拟自动记录' })
    expect(host.versionPanelOpen).toBe(false); expect(host.versionList).toEqual([])
    const list = vi.spyOn(provider, 'list')
    await choose('saved-versions')
    await vi.waitFor(() => expect(element.querySelector('[aria-label="更多-saved-versions"]')?.textContent).toContain('QA 模拟自动记录'))
    expect(list).toHaveBeenCalledOnce()
    expect(doc.getJSON()).toEqual(before)
  })
  it.each(['empty', 'error'])('shows an honest %s saved-version submenu', async outcome => {
    const { element, provider, choose } = nativeVersionMenu()
    if (outcome === 'error') vi.spyOn(provider, 'list').mockRejectedValue(new Error('list unavailable'))
    await choose('saved-versions')
    const menu = await vi.waitFor(() => { const node = element.querySelector('[aria-label="更多-saved-versions"]'); expect(node).not.toBeNull(); return node })
    await vi.waitFor(() => expect(menu.textContent).toMatch(outcome === 'empty' ? /暂无已存版本/ : /加载|不可用|失败/))
    expect(menu.querySelector('button').disabled).toBe(true)
    expect(menu.textContent).not.toContain('/code 第 1 版')
  })
  it.each(['close', 'provider', 'actor'])('does not revive a saved-version submenu after a pending %s change', async action => {
    const { doc, host, element, provider, more, choose } = nativeVersionMenu()
    await doc.getSession().createVersion({ label: '旧请求版本' })
    const records = await provider.list({ documentId: 'menu-versions' })
    let finish
    vi.spyOn(provider, 'list').mockImplementation(() => new Promise(resolve => { finish = resolve }))
    await choose('saved-versions'); await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    expect(element.querySelector('[aria-label="更多-saved-versions"]')?.textContent).toMatch(/加载/)
    if (action === 'close') { more.click(); more.click() }
    else if (action === 'provider') doc.getSession().setProvider('versioning', createMemoryVersioningProvider({ author: 'menu-version-owner' }))
    else doc.getSession().user = { id: 'next-menu-owner' }
    finish(records); await vi.dynamicImportSettled(); await host.$nextTick()
    expect(element.querySelector('[aria-label="更多-saved-versions"]')).toBeNull()
    expect(element.textContent).not.toContain('旧请求版本')
  })
})
describe('phone export format picker', () => {
  it('routes declared shortcuts through the real native host and disables undeclared host actions', async () => {
    window.matchMedia = () => Object.assign(new EventTarget(), { matches: true })
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    const action = vi.fn(async () => false); action.supportedActions = ['add-navigation', 'move']
    const element = document.createElement('div'); document.body.appendChild(element)
    const doc = new LarkDoc({ element, storage: 'none', documentId: 'shortcut-doc', user: { id: 'shortcut-actor' }, comments: createMemoryCommentsProvider(), content: '<p>原文</p>', onDocumentAction: action }); mounted.push(doc)
    const more = element.querySelector('[aria-label="更多文档操作"]')
    more.click()
    await vi.waitFor(() => expect(element.querySelector('[data-shortcut="add-navigation"]')).not.toBeNull())
    expect(element.querySelector('[data-shortcut="floating-window"]').disabled).toBe(true)
    element.querySelector('[data-shortcut="add-navigation"]').click()
    await vi.waitFor(() => expect(action).toHaveBeenCalledWith(expect.objectContaining({ action: 'add-navigation', actorId: 'shortcut-actor' })))
    more.click()
    await vi.waitFor(() => expect(element.querySelector('[data-shortcut="move"]')).toBeNull())
    more.click()
    await vi.waitFor(() => expect(element.querySelector('[data-shortcut="move"]')).not.toBeNull())
    expect(element.querySelector('[data-shortcut="move"]').disabled).toBe(false)
    element.querySelector('[data-shortcut="move"]').click()
    await vi.waitFor(() => expect(action).toHaveBeenCalledWith(expect.objectContaining({ action: 'move' })))
    expect(action).toHaveBeenCalledTimes(2)
    expect(doc.getJSON().content[0].content[0].text).toBe('原文')
  })
  it('keeps the More shortcut strip independently scrollable and routes only available actions', () => {
    window.matchMedia = () => ({ matches: true })
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    const host = document.createElement('section'); host.className = 'lark-doc'; document.body.append(host)
    const openMembers = vi.fn(), topbarMoreItem = vi.fn(), ui = createTopBar({ host, overlayHost: host, handlers: { openMembers, topbarMoreItem } }); mounted.push(ui)
    const state = { topbarMoreOpen: true, referenceMobileMenu: true, membersEnabled: true,
      topbarMoreRows: [{ kind: 'item', item: { id: 'move', label: '移动到', enabled: true } }] }
    ui.update(state)
    const strip = host.querySelector('[aria-label="文档快捷操作"]')
    expect(strip).not.toBeNull()
    expect(strip.querySelectorAll('button')).toHaveLength(9)
    strip.scrollLeft = 200; ui.update(state)
    expect(host.querySelector('[aria-label="文档快捷操作"]')).toBe(strip); expect(strip.scrollLeft).toBe(200)
    strip.querySelector('[data-shortcut="share"]').click(); expect(openMembers).toHaveBeenCalledOnce()
    strip.querySelector('[data-shortcut="move"]').click(); expect(topbarMoreItem).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'move' }), expect.any(Event))
    expect(strip.querySelector('[data-shortcut="floating-window"]').disabled).toBe(true)
  })
  it('opens four formats, exposes unsupported image honestly and routes a supported choice without exporting', () => {
    const vm = { ...exportMixin.data(), ...exportMixin.methods, exportCanExport: true }
    vm.openExportFormatPicker()
    expect(vm.exportOpen).toBe(true); expect(vm.exportFormat).toBe('')
    const onChooseExportFormat = vi.fn(), ui = overlays({ onChooseExportFormat })
    ui.update({ exportOpen: true, exportFormatPicker: true, exportCanExport: true })
    const choices = [...ui.el.querySelectorAll('[data-export-format]')]
    expect(choices.map(x => x.textContent)).toEqual(['Word', 'PDF', '图片', 'Markdown'])
    expect(choices[2].disabled).toBe(true); expect(choices[2].title).toContain('未配置')
    choices[2].click(); expect(onChooseExportFormat).not.toHaveBeenCalled()
    choices[3].click(); expect(onChooseExportFormat).toHaveBeenCalledExactlyOnceWith('markdown')
    vm.openExportDialog('markdown'); expect(vm.exportFormat).toBe('markdown'); expect(vm.exportScope).toBe('textOnly')
    vm.exportCanExport = false; vm.closeExportDialog(); vm.openExportFormatPicker(); expect(vm.exportOpen).toBe(false)
  })
})

describe('selection share service disclosure', () => {
  async function nativeSelectionShare(options = {}) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    window.matchMedia = () => Object.assign(new EventTarget(), { matches: true })
    Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => ({ left: 0, right: 1, top: 0, bottom: 1, width: 1, height: 1 }) })
    const element = document.createElement('div'); document.body.appendChild(element)
    const doc = new LarkDoc({ element, storage: 'none', content: '<p>Chosen text</p>', ...options }); mounted.push(doc)
    const editor = doc.getEditor(), host = doc._handle.nativeHost.host
    editor.commands.setTextSelection({ from: 1, to: 7 })
    expect(host.openSelectionShareDialog()).toBe(true)
    await vi.waitFor(() => expect(element.querySelector('.lark-doc-image-share-dialog.is-mobile')).not.toBeNull())
    await vi.waitFor(() => expect(host.imageShare.loading).toBe(false))
    return { doc, element, host }
  }

  it('discloses a missing sender before recipient search instead of presenting the default empty directory as a match failure', async () => {
    const { element, host } = await nativeSelectionShare()
    expect(typeof host.onSelectionShare).not.toBe('function')
    expect(host.buildOverlaysState().imageShareAvailable).toBe(false)
    const notice = element.querySelector('.lark-doc-image-share-service-notice')
    expect(notice?.isConnected).toBe(true); expect(notice.getAttribute('role')).toBe('status')
    expect(notice.textContent).toContain('尚未配置选区分享服务')
    expect(element.querySelector('.lark-doc-image-share-results').textContent).not.toContain('没有匹配结果')
    expect(element.querySelectorAll('[role="option"]')).toHaveLength(0)
    expect(element.querySelector('.lark-doc-image-share-create-group').disabled).toBe(true)
  })

  it('retains real empty searches and directory rows with a sender, and distinguishes permission denial from a missing service', async () => {
    const onSelectionShare = vi.fn(), { element, host } = await nativeSelectionShare({ onSelectionShare,
      mentionSource: [{ id: 'bob', kind: 'user', name: 'Bob' }] })
    await host.searchImageShareRecipients('nobody-matches')
    host.refreshOverlays()
    expect(host.buildOverlaysState().imageShareAvailable).toBe(true)
    expect(element.querySelector('.lark-doc-image-share-service-notice')).toBeNull()
    expect(element.querySelector('.lark-doc-image-share-results').textContent).toContain('没有匹配结果')
    await host.searchImageShareRecipients('Bob'); host.refreshOverlays()
    expect([...element.querySelectorAll('.lark-doc-image-share-result-name')].map(node => node.textContent)).toEqual(['Bob'])
    vi.spyOn(host.session, 'can').mockImplementation(capability => capability !== 'canExport')
    host.refreshOverlays()
    expect(host.buildOverlaysState().imageShareAvailable).toBe(false)
    expect(element.querySelector('.lark-doc-image-share-service-notice').textContent).toContain('当前权限不允许')
    expect(element.querySelector('.lark-doc-image-share-service-notice').textContent).not.toContain('未配置')
    expect(onSelectionShare).not.toHaveBeenCalled()
  })
})
describe('reference mobile menu placement delta', () => {
  const anchor = { left: 351, top: 10.5, right: 385, bottom: 52.5, width: 34, height: 42 }
  it('positions from the visual icon inside the real tap area and reserves the observed bottom gap', () => {
    expect(referenceTopbarMoreMenuStyle(anchor, { width: 186, height: 792 }, { width: 393, height: 852 })).toEqual({ left: 191, top: 49, maxHeight: 776 })
    const shifted = { ...anchor, left: 331, right: 365, top: 20.5, bottom: 62.5 }
    expect(referenceTopbarMoreMenuStyle(shifted, { width: 186, height: 792 }, { width: 393, height: 520 })).toEqual({ left: 171, top: 59, maxHeight: 434 })
  })
  it('limits the actual scroll element after accounting for popup padding/border and clears it on desktop', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    const height = window.innerHeight; Object.defineProperty(window, 'innerHeight', { configurable: true, value: 852 })
    const menu = document.createElement('div'), list = document.createElement('div'); list.className = 'lark-doc-topbar-more-list'; menu.appendChild(list); document.body.appendChild(menu)
    menu.style.padding = '4px'; menu.style.border = '1px solid'; menu.getBoundingClientRect = () => ({ width: 186, height: 792 })
    const owner = { topbarMoreOpen: true, _mobileEditorMedia: { matches: true }, $refs: { topbarMoreMenu: menu }, topbarMoreAnchor: anchor }
    try {
      topbarMoreMixin.methods.measureTopbarMore.call(owner)
      expect(owner.topbarMoreStyle).toEqual({ left: 191, top: 49, maxHeight: 776 })
      expect(list.style.padding).toBe('2px 0px'); expect(list.style.maxHeight).toBe('766px'); expect(list.style.boxSizing).toBe('border-box')
      owner._mobileEditorMedia.matches = false; topbarMoreMixin.methods.measureTopbarMore.call(owner)
      expect(owner.topbarMoreStyle).toEqual(topbarMoreMenuStyle(anchor, { width: 186, height: 792 }, { width: 393, height: 852 }))
      expect(list.style.padding).toBe(''); expect(list.style.maxHeight).toBe('')
    } finally { Object.defineProperty(window, 'innerHeight', { configurable: true, value: height }) }
  })
  it('reserves the mounted shortcut strip and gap so the final More rows stay within the phone menu', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    const height = window.innerHeight; Object.defineProperty(window, 'innerHeight', { configurable: true, value: 852 })
    const menu = document.createElement('div'), shortcuts = document.createElement('div'), list = document.createElement('div')
    shortcuts.className = 'lark-doc-mobile-shortcuts'; list.className = 'lark-doc-topbar-more-list'; menu.append(shortcuts, list); document.body.appendChild(menu)
    menu.style.padding = '4px'; menu.style.border = '1px solid'
    menu.getBoundingClientRect = () => ({ left: 98, top: 49, width: 295, height: 776, bottom: 825 })
    shortcuts.getBoundingClientRect = () => ({ top: 54, height: 120, bottom: 174 })
    list.getBoundingClientRect = () => ({ top: 174, height: parseFloat(list.style.maxHeight) || 766 })
    Object.defineProperty(list, 'scrollHeight', { value: 915 })
    const owner = { topbarMoreOpen: true, _mobileEditorMedia: { matches: true }, $refs: { topbarMoreMenu: menu }, topbarMoreAnchor: anchor }
    try {
      topbarMoreMixin.methods.measureTopbarMore.call(owner)
      const available = parseFloat(list.style.maxHeight)
      expect(174 + available).toBeLessThanOrEqual(825 - 5)
      list.scrollTop = list.scrollHeight - available; list.dispatchEvent(new Event('scroll'))
      expect(174 + list.scrollHeight - list.scrollTop).toBeLessThanOrEqual(852)
      owner.topbarMoreOpen = false; list.style.maxHeight = '123px'
      topbarMoreMixin.methods.measureTopbarMore.call(owner); expect(list.style.maxHeight).toBe('123px')
    } finally { Object.defineProperty(window, 'innerHeight', { configurable: true, value: height }) }
  })
  it('uses the observed default mode title and retains configured custom labels', () => {
    const ed = editorHost(); ed.modeLabel = '编辑'; expect(referenceDocumentMenuItems(ed)[0].label).toBe('编辑模式')
    ed.modeLabel = '只读审阅'; expect(referenceDocumentMenuItems(ed)[0].label).toBe('只读审阅')
  })
  it('rounds the mobile share visual anchor after applying the viewport clamp', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    const height = window.innerHeight; Object.defineProperty(window, 'innerHeight', { configurable: true, value: 852 })
    const owner = { sharePopoverAnchor: { right: 339, bottom: 47.5 } }
    try {
      expect(shareMixin.methods.sharePopoverStyle.call(owner)).toMatchObject({ left: '24px', top: '54px', right: '0px' })
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 320 })
      owner.sharePopoverAnchor.bottom = 310.5
      expect(parseFloat(shareMixin.methods.sharePopoverStyle.call(owner).top)).toBeLessThanOrEqual(60)
    } finally { Object.defineProperty(window, 'innerHeight', { configurable: true, value: height }) }
  })
})
describe('browser reference mobile document menus', () => {
  it('keeps the compact mobile import entry working independently of the desktop upload submenu', async () => {
    const ed = editorHost()
    ed.compactHeader = true
    ed.createMenuRows = [{ kind: 'item', id: 'import', label: '上传及导入', arrow: true, children: [{ id: 'upload-file' }] }]
    ed.larkDocConfig = { importExport: { enabled: true, importEnabled: true, exportEnabled: false } }
    expect(referenceDocumentMenuChildren(ed, 'create')[0]).toMatchObject({ enabled: true, arrow: false, children: undefined })
    await runReferenceDocumentMenuAction(ed, 'create', 'import')
    expect(ed.$emit).toHaveBeenCalledExactlyOnceWith('workspace-import')
    ed.larkDocConfig.importExport.importEnabled = false
    expect(referenceDocumentMenuChildren(ed, 'create')[0].enabled).toBe(false)
    expect(await runReferenceDocumentMenuAction(ed, 'create', 'import')).toBe(false)
    expect(ed.$emit).toHaveBeenCalledOnce()
  })

  it('keeps comment history available on desktop only', async () => {
    const ed = editorHost()
    ed._mobileEditorMedia.matches = false
    ed.commentCanViewHistory = () => true
    ed.openCommentHistory = vi.fn(() => true)
    expect(referenceDocumentMenuItems(ed).find(item => item.id === 'history-comments')?.enabled).toBe(true)
    ed._mobileEditorMedia = { matches: true }
    expect(referenceDocumentMenuItems(ed).some(item => item.id === 'history-comments')).toBe(false)
    expect(await runReferenceDocumentMenuAction(ed, 'history-comments')).toBe(false)
    expect(ed.openCommentHistory).not.toHaveBeenCalled()
  })
  it('keeps the pictured groups and exposes unsupported host operations as disabled', () => {
    const ed = editorHost(), items = referenceDocumentMenuItems(ed)
    expect(items.slice(0, 5).map(item => item.id)).toEqual(['mode', 'ai', 'notifications', 'workspace-search', 'create'])
    expect(items.slice(5, 19).map(item => item.id)).toEqual(['width', 'presentation', 'follow', 'search', 'shortcut', 'move', 'pin', 'favorite', 'template', 'duplicate', 'download', 'translate', 'print', 'saved-versions'])
    for (const id of ['ai', 'workspace-search', 'create', 'follow', 'move', 'template', 'translate']) {
      expect(items.find(item => item.id === id).enabled).toBe(false); expect(items.find(item => item.id === id).title).toContain('未配置')
    }
    expect(items.find(item => item.id === 'follow').kind).toBe('switch')
    expect(items.find(item => item.id === 'template').kind).toBe('switch')
    expect(referenceDocumentMenuChildren(ed, 'mode').map(item => item.value)).toEqual(['edit', 'read'])
  })
  it('runs the existing mode, find, width and permission handlers and never executes a disabled stale item', async () => {
    const ed = editorHost()
    expect(await runReferenceDocumentMenuAction(ed, 'mode', 'read')).toBe(true); expect(ed.setMode).toHaveBeenCalledExactlyOnceWith('read')
    expect(await runReferenceDocumentMenuAction(ed, 'search')).toBe(true); expect(ed.openSearch).toHaveBeenCalledExactlyOnceWith('replace')
    expect(await runReferenceDocumentMenuAction(ed, 'width', 'wide')).toBe(true); expect(ed.setWidthMode).toHaveBeenCalledExactlyOnceWith('wide')
    expect(await runReferenceDocumentMenuAction(ed, 'permission-settings')).toBe(true); expect(ed.openPermissionDialog).toHaveBeenCalledOnce()
    Object.assign(ed, topbarMoreMixin.methods, { topbarMoreOpen: true, $nextTick: fn => fn() })
    const enabled = referenceDocumentMenuItems(ed).find(item => item.id === 'mode')
    ed.session.can = () => false; await ed.onTopbarMoreItem(enabled)
    expect(ed.setMode).toHaveBeenCalledOnce()
  })
  it('uses the existing presentation controller rather than an unimplemented stage intent', async () => {
    const ed = editorHost(); ed.toggleSlides = vi.fn(() => true)
    const item = referenceDocumentMenuItems(ed).find(item => item.id === 'presentation')
    expect(item.kind).toBe('item'); expect(item.affordance).toBe('none')
    expect(await runReferenceDocumentMenuAction(ed, 'presentation')).toBe(true); expect(ed.toggleSlides).toHaveBeenCalledOnce()
  })
  it('uses the built-in information view while missing mentions and ownership UIs remain disabled', () => {
    const ed = editorHost()
    ed.session.getProvider = name => name === 'documentBusiness' ? { getState: () => ({ capabilities: { canTransferOwnership: true, canFollow: true } }), ownershipCandidates() {} } : null
    expect(referenceDocumentMenuItems(ed).find(item => item.id === 'information').enabled).toBe(true)
    for (const id of ['mentions', 'follow']) expect(referenceDocumentMenuItems(ed).find(item => item.id === id).enabled).toBe(false)
    expect(referenceDocumentMenuChildren(ed, 'permissions').find(item => item.id === 'transfer-ownership').enabled).toBe(false)
  })
  it('routes enabled desktop business, version, widget and translation actions', async () => {
    const ed = editorHost()
    ed.compactHeader = true
    ed.$el = document.body
    ed.larkDocConfig = { importExport: { importLabel: '导入', exportFormats: [] } }
    ed.versionCanSave = true
    ed.openSaveVersion = vi.fn(() => true)
    ed.documentWidgetItems = [{ id: 'widgets', value: 'discover', label: '更多小组件' }]
    ed.runDocumentWidget = vi.fn(() => true)
    ed.onDocumentAction = vi.fn(() => true)
    ed.onDocumentAction.supportedActions = ['template', 'translate', 'mentions']
    ed.session.getProvider = name => name === 'documentBusiness' ? { getState: () => ({
      isTemplate: true, capabilities: { canConvertTemplate: true },
    }) } : null
    const items = referenceDocumentMenuItems(ed)
    expect(items.find(item => item.id === 'template')).toMatchObject({ enabled: true, checked: true, kind: 'switch' })
    expect(items.find(item => item.id === 'translate')).toMatchObject({ enabled: true, kind: 'submenu' })
    expect(referenceDocumentMenuChildren(ed, 'translate')).toContainEqual(expect.objectContaining({ value: 'ja', enabled: true }))
    expect(await runReferenceDocumentMenuAction(ed, 'translate', 'invalid')).toBe(false)
    expect(await runReferenceDocumentMenuAction(ed, 'translate', 'ja')).toBe(true)
    expect(ed.onDocumentAction).toHaveBeenCalledWith({ action: 'translate', type: 'ja', documentId: 'document', actorId: 'actor' })
    expect(await runReferenceDocumentMenuAction(ed, 'save-version')).toBe(true)
    expect(ed.openSaveVersion).toHaveBeenCalledOnce()
    expect(await runReferenceDocumentMenuAction(ed, 'widgets', 'discover')).toBe(true)
    expect(ed.runDocumentWidget).toHaveBeenCalledWith('discover', undefined, expect.any(Function))
  })
  it('keeps an offline AI endpoint disabled and never emits a document AI request', async () => {
    const ed = editorHost(); ed.aiProvider = { kind: 'endpoint', endpoint: 'https://external.example.test/ai' }; ed.larkDocConfig = { network: { mode: 'offline' } }
    expect(referenceDocumentMenuItems(ed).find(item => item.id === 'ai').enabled).toBe(false)
    expect(await runReferenceDocumentMenuAction(ed, 'ai')).toBe(false); expect(ed.$emit).not.toHaveBeenCalled()
  })
  it.each([null, false, {}, { enabled: false, endpoint: 'https://external.example.test/ai' }])('rejects missing or malformed AI providers without emitting a mock-capable request (%j)', async provider => {
    const ed = editorHost(); ed.aiProvider = provider
    expect(referenceDocumentMenuItems(ed).find(item => item.id === 'ai').enabled).toBe(false)
    expect(await runReferenceDocumentMenuAction(ed, 'ai')).toBe(false); expect(ed.$emit).not.toHaveBeenCalled()
  })
  it('rejects raw endpoint strings under offline policy before emitting an AI request', async () => {
    const ed = editorHost(); ed.aiProvider = 'https://external.example.test/ai'; ed.larkDocConfig = { network: { mode: 'offline' } }
    expect(referenceDocumentMenuItems(ed).find(item => item.id === 'ai').enabled).toBe(false)
    expect(await runReferenceDocumentMenuAction(ed, 'ai')).toBe(false); expect(ed.$emit).not.toHaveBeenCalled()
  })
  it('honors a declared host action and rejects its late receipt after authorization changes', async () => {
    const ed = editorHost(); let finish
    ed.onDocumentAction = vi.fn(() => new Promise(resolve => { finish = resolve })); ed.onDocumentAction.supportedActions = ['follow']
    const current = () => ed.session.can('canView')
    const pending = runReferenceDocumentMenuAction(ed, 'follow', undefined, undefined, current)
    expect(ed.onDocumentAction).toHaveBeenCalledExactlyOnceWith({ action: 'follow', documentId: 'document', actorId: 'actor' })
    ed.session.can = () => false; finish(true); expect(await pending).toBe(false)
  })
  it('blocks duplicate host writes and does not close a newer menu on a late receipt', async () => {
    const ed = editorHost(); let finish
    Object.assign(ed, topbarMoreMixin.methods, { topbarMoreOpen: true })
    ed.onDocumentAction = vi.fn(() => new Promise(resolve => { finish = resolve })); ed.onDocumentAction.supportedActions = ['follow']
    const pending = ed.runReferenceMoreAction('follow')
    expect(await ed.runReferenceMoreAction('follow')).toBe(false); expect(ed.onDocumentAction).toHaveBeenCalledOnce()
    ed.closeTopbarMore(); ed.topbarMoreOpen = true
    finish(true); expect(await pending).toBe(false); expect(ed.topbarMoreOpen).toBe(true); expect(ed.topbarMoreBusy).toBe(false)
  })
  it('places the document share card below the header and clamps it to the viewport', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    const style = shareMixin.methods.sharePopoverStyle.call({ sharePopoverAnchor: { right: 344, bottom: 48 } })
    expect(style).toMatchObject({ left: '24px', right: '0px', top: '54px', bottom: '' })
    const ui = overlays(); ui.update(shareState())
    const card = ui.el.querySelector('[aria-label="分享文档"]')
    expect(card.classList.contains('is-mobile-reference')).toBe(true)
    expect(card.querySelector('.lark-doc-share-popover-inner').hidden).toBe(false)
    expect(card.querySelector('.lark-doc-share-mobile').hidden).toBe(true)
    expect(card.textContent).toContain('邀请协作者'); expect(card.textContent).toContain('链接分享')
    expect(card.querySelector('.lark-doc-share-pwd-link').textContent).toBe('启用密码')
    expect(ui.el.querySelector('.lark-doc-share-mobile-mask')).toBeNull()
    expect(card.querySelector('[aria-label="链接权限"]').disabled).toBe(true)
    expect(card.textContent).toContain('链接范围与权限服务尚未配置')
    expect([...card.querySelectorAll('.lark-doc-share-org-btn option')].map(option => option.textContent)).toEqual(['未配置'])
    // 飞书真实渠道行：5 个按钮全部可点，按钮顺序与 279 bundle 的 render 一致
    expect(card.querySelectorAll('.lark-doc-share-channel:disabled')).toHaveLength(0)
    expect([...card.querySelectorAll('.lark-doc-share-channel')].map(node => node.getAttribute('data-share-channel')))
      .toEqual(['lark', 'favorite', 'wechat', 'qrcode', 'secure'])
  })
  it('keeps document link copying distinct from selection-recipient sharing', () => {
    const onCopyShareLink = vi.fn(), onSubmitImageShare = vi.fn(), ui = overlays({ onCopyShareLink, onSubmitImageShare })
    ui.update(shareState()); const copy = ui.el.querySelector('.lark-doc-share-copy-link')
    copy.click(); expect(onCopyShareLink).toHaveBeenCalledOnce(); expect(onSubmitImageShare).not.toHaveBeenCalled()
    ui.update(shareState({ sharePopoverOpen: false })); copy.click(); expect(onCopyShareLink).toHaveBeenCalledOnce()
  })
  it('dispatches each Feishu-style channel button through onShareChannel', () => {
    const onShareChannel = vi.fn(), ui = overlays({ onShareChannel })
    ui.update(shareState())
    for (const id of ['lark', 'favorite', 'wechat', 'qrcode', 'secure']) {
      ui.el.querySelector(`[data-share-channel="${id}"]`).click()
      expect(onShareChannel).toHaveBeenCalledWith(id)
    }
    expect(onShareChannel).toHaveBeenCalledTimes(5)
    expect(document.activeElement).toBe(ui.el.querySelector('.lark-doc-share-invite input'))
  })
  it('maps share channels to the Feishu source handlers without Web Share guesses', async () => {
    const showQr = vi.fn(async () => true), setAudience = vi.fn(async () => ({})), openPasswordDialog = vi.fn()
    const subscription = vi.fn(), showShareToast = vi.fn()
    const ed = {
      shareCan: () => true, showShareToast,
      larkDocConfig: { shareMethodConfig: { subscriptionConfig: { enable: true, handler: subscription } } },
      shareLinkState: { audience: 'public', passwordAvailable: false },
      showShareQrCode: showQr, setShareLinkAudience: setAudience, openPasswordDialog,
      handleSharePasswordSetting: shareMixin.methods.handleSharePasswordSetting,
    }
    const invoke = id => shareMixin.methods.shareViaChannel.call(ed, id)
    expect(await invoke('lark')).toBe(true)
    expect(await invoke('favorite')).toBe(true); expect(subscription).toHaveBeenCalledOnce()
    expect(await invoke('wechat')).toBe(true); expect(showQr).toHaveBeenCalledWith('wechat')
    expect(await invoke('secure')).toBe(true); expect(setAudience).not.toHaveBeenCalled()
    expect(openPasswordDialog).toHaveBeenCalledOnce()
    ed.shareLinkState = { audience: 'collaborators', passwordAvailable: false }
    expect(await invoke('secure')).toBe(true); expect(setAudience).toHaveBeenCalledWith('public')
    expect(showShareToast).not.toHaveBeenCalled()
  })
  it('retains the real invitation pending/query path behind the document share card', () => {
    const onQueryShareInvitation = vi.fn(), onSubmitShareInvitation = vi.fn(), ui = overlays({ onQueryShareInvitation, onSubmitShareInvitation })
    const state = shareState({ shareInvitation: { status: 'unknown', candidate: { principalId: 'recipient' }, role: 'read', operationId: 'original-operation' } })
    ui.update(state); ui.el.querySelector('[aria-label="添加协作者"]').click()
    const query = [...ui.el.querySelectorAll('button')].find(button => button.textContent === '查询原邀请操作')
    expect(query.hidden).toBe(false); query.click(); expect(onQueryShareInvitation).toHaveBeenCalledOnce()
    expect(onSubmitShareInvitation).not.toHaveBeenCalled()
  })
})
