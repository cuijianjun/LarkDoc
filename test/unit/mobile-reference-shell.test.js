// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTopBar } from '../../src/ui/topBar'
import { createBlockHandle } from '../../src/ui/blockHandle'
import blockHandleUi from '../../src/components/lark-doc/editor/blockHandleUiMixin'
import blockHandle from '../../src/components/lark-doc/editor/blockHandleMixin'
import blockMenu from '../../src/components/lark-doc/editor/blockMenuMixin'
import toolbarUi from '../../src/components/lark-doc/editor/toolbarUiMixin'
import { LarkDoc } from '../../src/LarkDoc'
import { Schema } from '@tiptap/pm/model'
import { registerFeature } from '../../src/core/features/registry'

const fixtureSchema = new Schema({ nodes: { doc: { content: 'block+' }, paragraph: { group: 'block', content: 'text*' }, text: { group: 'inline' } } })

const originalWidth = window.innerWidth, mounted = []
afterEach(() => {
  mounted.splice(0).reverse().forEach(ui => ui.destroy())
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
  document.body.replaceChildren(); vi.restoreAllMocks()
})

describe('mobile block AI availability', () => {
  function blockAi(provider, network = { mode: 'open' }) {
    const target = fixtureSchema.node('doc', null, [fixtureSchema.node('paragraph', null, fixtureSchema.text('AI target'))])
    const owner = { ...blockMenu.methods, aiProvider: provider, larkDocConfig: { network }, featureEnabled: () => true, writable: () => true,
      $refs: { root: document.body }, $emit: vi.fn(), editor: { state: { doc: target }, commands: { setTextSelection: vi.fn() }, view: { focus: vi.fn() } },
      handleRange: { from: 0, to: target.content.size }, shareCan: () => false, templateSaveAllowed: () => false,
      blockMenuOpen: true, visibleBlockTypeActions: [], visibleBlockListActions: [{ id: 'translate', label: '翻译', icon: 'translate' }],
      isBlockActionEnabled: () => true, handleTableHeaderState: () => ({}), colorPaletteOptions: [],
      blockAlignValue: () => 'left', blockAlignIndent: () => 0, blockAlignCanIncrease: () => false,
      closeBlockMenu: vi.fn(), handleActionRange: () => ({ from: 0, to: target.content.size }) }
    const emitAiRequest = blockHandleUi.methods.blockHandleHandlers.call(owner).emitAiRequest
    const ui = createBlockHandle({ host: document.body, handlers: {
      blockAction: id => blockMenu.methods.blockAction.call(owner, id), emitAiRequest,
    } }); mounted.push(ui)
    const paint = () => ui.updateMenu(blockHandleUi.methods.buildBlockMenuState.call(owner))
    ui.updateChrome({ visible: true, mobile: true, buttonKind: 'main' }); paint()
    const translate = () => [...ui.el.querySelectorAll('.lark-doc-block-menu-row')].find(button => button.textContent === '翻译')
    return { owner, ui, paint, translate, emitAiRequest }
  }

  it.each([
    { label: 'missing', provider: undefined }, { label: 'null', provider: null }, { label: 'false', provider: false },
    { label: 'invalid', provider: {} }, { label: 'disabled', provider: { enabled: false } },
    { label: 'offline endpoint', provider: { endpoint: 'https://blocked.example.test/ai' }, network: { mode: 'offline' } },
    { label: 'offline string', provider: 'https://blocked.example.test/ai', network: { mode: 'offline' } },
  ])('disables translate and AI without a usable allowed adapter ($label)', ({ provider, network }) => {
    const { owner, ui, translate, emitAiRequest } = blockAi(provider, network)
    expect(translate().disabled).toBe(true)
    expect(translate().title).toContain('服务')
    expect(ui.el.querySelector('.lark-doc-block-menu-ai').disabled).toBe(true)
    translate().click(); ui.el.querySelector('.lark-doc-block-menu-ai').click()
    blockMenu.methods.blockAction.call(owner, 'translate'); emitAiRequest('rewrite')
    expect(owner.$emit).not.toHaveBeenCalled(); expect(owner.editor.view.focus).not.toHaveBeenCalled()
  })

  it('keeps both existing routes for an actual allowed adapter without generating while rendering', () => {
    const stream = vi.fn(), { owner, ui, translate } = blockAi({ stream })
    expect(translate().disabled).toBe(false)
    expect(ui.el.querySelector('.lark-doc-block-menu-ai').disabled).toBe(false)
    translate().click(); ui.el.querySelector('.lark-doc-block-menu-ai').click()
    expect(owner.$emit.mock.calls).toEqual([['ai-request', 'translate'], ['ai-request', 'rewrite']])
    expect(owner.editor.commands.setTextSelection).toHaveBeenCalledTimes(2)
    expect(owner.editor.commands.setTextSelection).toHaveBeenLastCalledWith({ from: 1, to: owner.editor.state.doc.content.size - 1 })
    expect(owner.editor.view.focus).toHaveBeenCalledOnce(); expect(stream).not.toHaveBeenCalled()
  })

  it.each(['provider', 'network'])('rejects old enabled buttons when the %s is retired', reason => {
    const { owner, ui, paint, translate } = blockAi({ endpoint: 'https://allowed.example.test/ai' })
    const oldTranslate = translate(), oldAi = ui.el.querySelector('.lark-doc-block-menu-ai')
    if (reason === 'provider') owner.aiProvider = null
    else owner.larkDocConfig.network = { mode: 'offline' }
    oldTranslate.click(); oldAi.click()
    expect(owner.$emit).not.toHaveBeenCalled()
    paint(); expect(translate().disabled).toBe(true); expect(oldAi.disabled).toBe(true)
  })
})
async function dismissInsertPicker(element) {
  await vi.waitFor(() => expect(element.querySelector('.lark-doc-command-menu')).not.toBeNull())
  element.querySelector('.lark-doc-command-menu').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  await vi.waitFor(() => expect(element.querySelector('.lark-doc-command-menu')).toBeNull())
}
function phone() { Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 }) }
function stubRanges() {
  const createRange = document.createRange.bind(document)
  vi.spyOn(document, 'createRange').mockImplementation(() => Object.assign(createRange(), {
    getClientRects: () => [], getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }),
  }))
}
function shell(extra = {}) {
  phone()
  const host = document.createElement('section'), paper = document.createElement('div'), body = document.createElement('div')
  host.className = 'lark-doc'; paper.className = 'lark-doc-paper'; body.className = 'lark-doc-editor-content'
  paper.append(body); host.append(paper); document.body.append(host)
  let state = { referenceMobileMenu: true, title: 'Document title', headerVisible: true, homeEnabled: true, membersEnabled: true,
    libraryEnabled: false, outlineVisible: true, outlineOpen: false, currentDocumentId: 'doc-a', mobileContextKey: 'doc-a|viewer',
    currentUser: { id: 'viewer', name: 'Current viewer' }, ...extra }
  const onHeading = vi.fn(), onStart = vi.fn(), onMembers = vi.fn(), onMore = vi.fn(), onMoreItem = vi.fn()
  const ui = createTopBar({ host, paperHost: paper, overlayHost: host,
    handlers: { openMembers: onMembers, toggleTopbarMore: onMore, topbarMoreItem: onMoreItem,
      toggleOutline: () => { state = { ...state, outlineOpen: !state.outlineOpen }; paint() } } })
  const paint = () => ui.update({ ...state, onOutlineHeading: onHeading, onOutlineStart: onStart })
  paint(); mounted.push(ui)
  return { ui, host, paper, body, onHeading, onMembers, onMore, onMoreItem, set: patch => { state = { ...state, ...patch }; paint() } }
}

describe('mobile topbar more dismissal', () => {
  async function coldMenuFixture() {
    phone()
    let resolve
    const pending = new Promise(yes => { resolve = yes }), loader = vi.fn(() => pending), instances = []
    const off = registerFeature('ui', loader), offReady = registerFeature('ui.ready', () => null)
    vi.doMock('../../src/ui/topBarMenus', async () => {
      const { createDeferredUi } = await import('../../src/features/element-ui')
      return { createTopBarMenus: options => createDeferredUi('createTopBarMenus', options,
        state => state.headerVisible !== false && ((state.createMenuOpen && !state.readonly) || (state.topbarMoreOpen && !state.moreDismissed))) }
    })
    const { createTopBar: createColdTopBar } = await import('../../src/ui/topBar?cold-topbar-menus')
    const settle = async () => { for (let i = 0; i < 24; i += 1) await Promise.resolve() }
    return {
      loader, settle, resolve: async () => { resolve(await vi.importActual('../../src/ui/topBarMenus')); await settle() },
      create(extra = {}) {
        const host = document.createElement('section'); host.className = 'lark-doc'; document.body.append(host)
        const refs = {}, closeTopbarMore = vi.fn(), closeCreateMenu = vi.fn(), onMenusReady = vi.fn()
        const ui = createColdTopBar({ host, overlayHost: host, refs, onMenusReady,
          ...extra, handlers: { closeTopbarMore, closeCreateMenu, ...extra.handlers } })
        instances.push(ui)
        return { ui, host, refs, closeTopbarMore, closeCreateMenu, onMenusReady }
      },
      cleanup() { instances.forEach(ui => ui.destroy()); off(); offReady(); vi.doUnmock('../../src/ui/topBarMenus') },
    }
  }

  it('cancels a cold More request from Escape before its real renderer loads', async () => {
    const fixture = await coldMenuFixture()
    try {
      const { ui, host, closeTopbarMore, onMenusReady } = fixture.create()
      const state = { headerVisible: true, referenceMobileMenu: true, topbarMoreOpen: true,
        topbarMoreRows: [{ id: 'late', label: '不得晚显' }] }
      ui.update({ ...state, topbarMoreOpen: false }); await fixture.settle()
      expect(fixture.loader).not.toHaveBeenCalled()
      ui.update(state); await fixture.settle()
      expect(fixture.loader).toHaveBeenCalledOnce()
      expect(host.querySelector('.lark-doc-topbar-more')).toBeNull()
      const foreign = document.createElement('section'); foreign.setAttribute('role', 'dialog'); host.append(foreign)
      for (const [target, composing, prevented] of [[document.body, true, false], [foreign, false, false], [document.body, false, true]]) {
        const event = new KeyboardEvent('keydown', { key: 'Escape', isComposing: composing, bubbles: true, cancelable: true })
        if (prevented) event.preventDefault()
        target.dispatchEvent(event)
        expect(closeTopbarMore).not.toHaveBeenCalled()
      }
      const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      document.body.dispatchEvent(escape)
      expect(escape.defaultPrevented).toBe(true); expect(closeTopbarMore).toHaveBeenCalledOnce()
      ui.update(state); await fixture.resolve()
      expect(host.querySelector('.lark-doc-topbar-more')).toBeNull()
      expect(host.querySelector('.lark-doc-mobile-actions-toggle').getAttribute('aria-expanded')).toBe('false')
      expect(onMenusReady).not.toHaveBeenCalled()
    } finally { fixture.cleanup() }
  })

  it.each(['outside', 'hidden', 'destroy', 'create-escape', 'create-readonly'])('retires the cold %s intent before it can mount', async action => {
    const fixture = await coldMenuFixture()
    try {
      const { ui, host, closeTopbarMore, closeCreateMenu, onMenusReady } = fixture.create()
      const create = action.startsWith('create-')
      const state = { headerVisible: true, topbarMoreOpen: !create, createMenuOpen: create,
        topbarMoreRows: [{ id: 'late', label: '旧更多' }], createMenuRows: [{ id: 'late-create', label: '旧新建' }] }
      ui.update(state); await fixture.settle()
      expect(fixture.loader).toHaveBeenCalledOnce()
      if (action === 'outside') document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
      if (action === 'hidden') ui.update({ ...state, headerVisible: false })
      if (action === 'destroy') ui.destroy()
      if (action === 'create-escape') host.querySelector('.lark-doc-create-btn').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      if (action === 'create-readonly') ui.update({ ...state, readonly: true })
      await fixture.resolve()
      expect(host.querySelector('.lark-doc-topbar-more, .lark-doc-create-menu')).toBeNull()
      expect(onMenusReady).not.toHaveBeenCalled()
      expect(closeTopbarMore).toHaveBeenCalledTimes(action === 'outside' ? 1 : 0)
      expect(closeCreateMenu).toHaveBeenCalledTimes(action === 'create-escape' ? 1 : 0)
    } finally { fixture.cleanup() }
  })

  it('uses live menu state after cold loading and publishes refs before remeasurement', async () => {
    const fixture = await coldMenuFixture()
    try {
      const onItem = vi.fn(), ready = vi.fn()
      const current = fixture.create({ handlers: { topbarMoreItem: onItem }, onMenusReady: ready })
      ready.mockImplementation(() => expect(current.refs.topbarMoreMenu.isConnected).toBe(true))
      const state = { headerVisible: true, topbarMoreOpen: true, topbarMoreRows: [{ id: 'alice', label: 'Alice旧项' }] }
      current.ui.update(state); await fixture.settle()
      current.ui.update({ ...state, mobileContextKey: 'Bob', topbarMoreRows: [{ id: 'download-as', label: '无权操作', enabled: false }, { id: 'bob', label: 'Bob当前项' }] })
      await fixture.resolve()
      expect(current.host.textContent).not.toContain('Alice旧项')
      const blocked = current.host.querySelector('[data-topbar-more-id="download-as"]')
      expect(blocked.disabled).toBe(true); expect(blocked.dataset.capability).toBe('canExport')
      current.host.querySelector('[data-topbar-more-id="bob"]').click()
      expect(onItem).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'bob' }), expect.any(Event))
      expect(ready).toHaveBeenCalledOnce()
    } finally { fixture.cleanup() }
  })

  it('keeps a newer keyboard focus in another editor when a cold More renderer arrives', async () => {
    const fixture = await coldMenuFixture()
    try {
      const first = fixture.create(), second = fixture.create()
      first.ui.update({ topbarMoreOpen: true, topbarMoreRows: [{ id: 'row', label: '操作' }] })
      await fixture.settle()
      const input = document.createElement('input'); second.host.append(input); input.focus()
      expect(document.activeElement).toBe(input)
      await fixture.resolve()
      expect(first.host.querySelector('.lark-doc-topbar-more')).not.toBeNull()
      expect(document.activeElement).toBe(input)
    } finally { fixture.cleanup() }
  })

  it.each(['escape', 'outside'])('shares pending More ownership across editors when closing from %s', async action => {
    const fixture = await coldMenuFixture()
    try {
      const first = fixture.create(), second = fixture.create()
      const state = { topbarMoreOpen: true, topbarMoreRows: [{ id: 'row', label: '操作' }] }
      first.ui.update(state); second.ui.update(state); await fixture.settle()
      document.body.dispatchEvent(action === 'escape'
        ? new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
        : new MouseEvent('pointerdown', { bubbles: true }))
      expect(first.closeTopbarMore).toHaveBeenCalledTimes(action === 'escape' ? 0 : 1)
      expect(second.closeTopbarMore).toHaveBeenCalledOnce()
      await fixture.resolve()
      expect(!!first.host.querySelector('.lark-doc-topbar-more')).toBe(action === 'escape')
      expect(second.host.querySelector('.lark-doc-topbar-more')).toBeNull()
    } finally { fixture.cleanup() }
  })

  async function nativeMenu() {
    phone(); stubRanges()
    const element = document.createElement('div'); document.body.append(element)
    const doc = new LarkDoc({ element, storage: 'none', documentId: 'menu-doc', providers: {}, capabilities: { canManagePermission: true },
      title: 'Menu document', content: '<h2>Section</h2><p>Body</p>',
      config: { layout: { headerVisible: true, outlineVisible: true, toolbarVisible: false } } }); mounted.push(doc)
    const trigger = element.querySelector('.lark-doc-mobile-actions-toggle')
    trigger.click()
    await vi.waitFor(() => expect(element.querySelector('.lark-doc-topbar-more')).not.toBeNull())
    return { doc, element, trigger, host: doc._handle.nativeHost.host }
  }
  const touch = target => {
    const event = new MouseEvent('pointerdown', { bubbles: true, cancelable: true })
    target.dispatchEvent(event); return event
  }

  it('focuses the real menu, closes from BODY Escape and returns to the same native trigger', async () => {
    const { element, trigger, host } = await nativeMenu()
    const menu = element.querySelector('.lark-doc-topbar-more')
    expect(menu.contains(document.activeElement)).toBe(true)
    document.activeElement.blur(); expect(document.activeElement).toBe(document.body)
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(menu.isConnected).toBe(false))
    expect(host.topbarMoreOpen).toBe(false); expect(document.activeElement).toBe(trigger)
    touch(trigger); trigger.click()
    await vi.waitFor(() => expect(menu.isConnected).toBe(true))
  })

  it.each([
    ['share', '.lark-doc-mobile-members', '.lark-doc-share-popover'],
    ['outline', '.lark-doc-document-outline-trigger', '.lark-doc-document-outline-popover'],
  ])('outside touch closes the native parent and preserves the following %s click', async (_, selector, popup) => {
    const { doc, element, host } = await nativeMenu(), before = doc.getJSON()
    const menu = element.querySelector('.lark-doc-topbar-more'), next = element.querySelector(selector)
    expect(touch(next).defaultPrevented).toBe(false)
    next.click()
    await vi.waitFor(() => { expect(menu.isConnected).toBe(false); expect(element.querySelector(popup)).not.toBeNull() })
    expect(host.topbarMoreOpen).toBe(false); expect(doc.getJSON()).toEqual(before)
  })

  it('a second native trigger tap closes once without reopening on the following click', async () => {
    const { element, trigger, host } = await nativeMenu()
    const menu = element.querySelector('.lark-doc-topbar-more')
    touch(trigger); trigger.click()
    await vi.waitFor(() => expect(menu.isConnected).toBe(false))
    expect(host.topbarMoreOpen).toBe(false)
  })

  it('keeps child Escape and other instances separate, rejects late reopen state and removes listeners on destroy', () => {
    phone()
    const first = shell({ topbarMoreOpen: true, topbarMoreRows: [{ id: 'first', label: 'First' }] })
    const second = shell({ topbarMoreOpen: true, topbarMoreRows: [{ id: 'second', label: 'Second' }] })
    const firstMenu = first.host.querySelector('.lark-doc-topbar-more'), secondMenu = second.host.querySelector('.lark-doc-topbar-more')
    const child = document.createElement('div'); child.setAttribute('role', 'dialog')
    child.addEventListener('keydown', event => { event.preventDefault(); event.stopPropagation(); child.remove() })
    second.host.appendChild(child)
    child.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(secondMenu.isConnected).toBe(true); expect(firstMenu.isConnected).toBe(true)
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(secondMenu.isConnected).toBe(false); expect(firstMenu.isConnected).toBe(true)
    second.set({ topbarMoreOpen: true }); expect(secondMenu.isConnected).toBe(false)
    second.set({ topbarMoreOpen: false }); second.set({ topbarMoreOpen: true })
    expect(secondMenu.isConnected).toBe(true)
    second.ui.destroy(); second.set({ topbarMoreOpen: true })
    touch(first.host); expect(firstMenu.isConnected).toBe(false); expect(secondMenu.isConnected).toBe(false)
  })
})

describe('mobile block write focus', () => {
  async function nativeBlock() {
    const element = document.createElement('div'); document.body.append(element)
    const doc = new LarkDoc({ element, storage: 'none', content: '<p>First</p><p>Second</p>' }); mounted.push(doc)
    const editor = doc.getEditor(), host = doc._handle.nativeHost.host
    host.handleRange = { from: 0, to: editor.state.doc.firstChild.nodeSize }
    await vi.waitFor(() => expect(element.querySelector('.lark-doc-block-handle-main')).not.toBeNull())
    const trigger = element.querySelector('.lark-doc-block-handle-main')
    trigger.focus(); trigger.click()
    await vi.waitFor(() => expect(element.querySelector('.lark-doc-block-menu')).not.toBeNull())
    return { doc, element, editor, host, trigger, add: element.querySelector('[title="在下方添加"]') }
  }

  it('focuses the inserted paragraph and sends one keyboard Undo to the actual editor', async () => {
    phone(); stubRanges()
    const { doc, editor, element, add } = await nativeBlock(), before = doc.getJSON()
    add.click()
    await dismissInsertPicker(element)
    await vi.waitFor(() => expect(element.querySelector('.lark-doc-block-menu')).toBeNull())
    expect(document.activeElement).toBe(editor.view.dom); expect(editor.isFocused).toBe(true)
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph')
    expect(editor.state.selection.$from.parent.content.size).toBe(0)
    const modifier = /Mac|iP(hone|[oa]d)/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true }
    const undo = new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', bubbles: true, cancelable: true, ...modifier })
    document.activeElement.dispatchEvent(undo)
    expect(undo.defaultPrevented).toBe(true); expect(doc.getJSON()).toEqual(before)
  })

  it('cancels with Escape back to the same connected handle without writing', async () => {
    phone(); stubRanges()
    const { doc, element, trigger } = await nativeBlock(), before = doc.getJSON()
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(element.querySelector('.lark-doc-block-menu')).toBeNull())
    expect(document.activeElement).toBe(trigger); expect(doc.getJSON()).toEqual(before)
  })

  it.each(['readonly', 'destroyed'])('a %s action cannot write or steal another editor focus', async reason => {
    phone(); stubRanges()
    const first = await nativeBlock(), second = await nativeBlock(), before = first.editor.state.doc.toJSON()
    if (reason === 'readonly') first.doc.setReadonly(true)
    else first.doc.destroy()
    second.editor.view.focus(); first.add.click(); first.host.blockAction('addBelow')
    await Promise.resolve()
    expect(document.activeElement).toBe(second.editor.view.dom)
    expect(first.editor.state.doc.toJSON()).toEqual(before)
  })

  it('does not move focus from a different instance during a direct write action', async () => {
    phone(); stubRanges()
    const first = await nativeBlock(), second = await nativeBlock()
    second.editor.view.focus(); first.host.blockAction('addBelow')
    await Promise.resolve()
    expect(first.editor.state.doc.childCount).toBe(3)
    expect(document.activeElement).toBe(second.editor.view.dom)
  })
})

describe('mobile reference document shell', () => {
  it('keeps home, library breadcrumb, modification status, blue-share entry and more in the header', () => {
    const { host, onMembers, onMore } = shell()
    expect(host.querySelector('.lark-doc-mobile-header-divider')).not.toBeNull()
    expect(host.querySelector('.lark-doc-mobile-breadcrumb .lark-doc-mobile-outline')).not.toBeNull()
    expect(host.querySelector('.lark-doc-mobile-breadcrumb input').value).toBe('Document title')
    expect(host.querySelector('.lark-doc-mobile-modified').textContent).toBe('最近修改：未提供')
    const share = host.querySelector('.lark-doc-mobile-members')
    expect(share.textContent).toBe('分享'); share.click(); expect(onMembers).toHaveBeenCalledOnce()
    host.querySelector('.lark-doc-mobile-actions-toggle').click(); expect(onMore).toHaveBeenCalledOnce()
    expect(host.querySelector('.lark-doc-mobile-reference-menu')).toBeNull()
  })

  it('uses only document-scoped author metadata, never the viewing user or the record export clock', () => {
    const { host, set } = shell()
    expect(host.querySelector('.lark-doc-mobile-document-meta').textContent).toContain('作者未提供')
    expect(host.querySelector('.lark-doc-mobile-document-meta').textContent).not.toContain('Current viewer')
    set({ documentMetadata: { author: { name: 'Document author' }, modifiedAt: Date.now() - 60_000 } })
    expect(host.querySelector('.lark-doc-mobile-document-meta').textContent).toContain('Document author')
    expect(host.querySelector('.lark-doc-mobile-document-meta').textContent).not.toContain('Current viewer')
    const handler = () => {}; handler.documentMetadata = { documentId: 'old-document', author: { name: 'Wrong author' }, modifiedAt: Date.now() }
    const owner = { session: { documentId: 'doc-a', user: { id: 'viewer' }, can: () => true, getProvider: () => null },
      onDocumentAction: handler, larkDocConfig: { layout: {} }, modesConfig: {}, featureEnabled: () => true }
    expect(toolbarUi.methods.buildTopBarState.call(owner).documentMetadata).toBeNull()
    handler.documentMetadata = { ...handler.documentMetadata, documentId: 'doc-a' }
    expect(toolbarUi.methods.buildTopBarState.call(owner).documentMetadata.author.name).toBe('Wrong author')
    for (const session of [null, { ...owner.session, documentId: undefined }, { ...owner.session, documentId: '' }]) {
      expect(toolbarUi.methods.buildTopBarState.call({ ...owner, session }).documentMetadata).toBeNull()
    }
  })

  it('renders the shared more rows with icons, checked state, disabled reasons and original events', () => {
    const follow = { id: 'follow', label: '关注文档', kind: 'switch', checked: true, icon: 'bell', enabled: true }
    const blocked = { id: 'blocked', label: '未接入功能', icon: 'doc', enabled: false, title: '当前宿主未配置服务' }
    const { host, onMoreItem, set } = shell({ topbarMoreOpen: true, topbarMoreRows: [{ kind: 'item', item: follow }, { kind: 'item', item: blocked }] })
    const button = host.querySelector('[data-topbar-more-id="follow"]')
    expect(button.querySelector('.lark-doc-topbar-more-item-icon svg')).not.toBeNull()
    expect(button.getAttribute('aria-checked')).toBe('true')
    button.click(); expect(onMoreItem).toHaveBeenCalledExactlyOnceWith(follow, expect.any(Event))
    const disabled = host.querySelector('[data-topbar-more-id="blocked"]')
    expect(disabled.title).toBe('当前宿主未配置服务'); disabled.click(); expect(onMoreItem).toHaveBeenCalledOnce()
    set({ topbarMoreRows: [{ kind: 'item', item: { ...follow, checked: false } }] })
    expect(button.getAttribute('aria-checked')).toBe('false')
  })

  it('shows the Feishu follow guide on hover and renders the document toast', () => {
    const follow = { id: 'follow', label: '关注文档更新', kind: 'switch', checked: false, icon: 'subscribe', enabled: true }
    const { host, set } = shell({ topbarMoreOpen: true, topbarMoreRows: [{ kind: 'item', item: follow }] })
    host.querySelector('[data-topbar-more-id="follow"]').dispatchEvent(new MouseEvent('mouseenter'))
    const tip = host.querySelector('.lark-doc-follow-tip')
    expect(tip?.textContent).toContain('云文档助手')
    expect(tip?.textContent).toContain('开启后，云文档助手将在文档更新时通知你，时刻掌握文档动态。')
    expect(tip?.textContent).toContain('查看变更详情')
    set({ docToast: '已关注，你将会收到该文档的内容更新提醒' })
    expect(host.querySelector('.lark-doc-doc-toast')?.textContent).toContain('已关注，你将会收到该文档的内容更新提醒')
    set({ docToast: '' })
    expect(host.querySelector('.lark-doc-doc-toast')).toBeNull()
  })

  it('renders stacked Feishu success toasts with outlined style and status icon', () => {
    const { host, set } = shell({})
    set({ docToasts: [
      { id: 1, text: '已取消关注，你将不再收到该文档的内容更新提醒。' },
      { id: 2, text: '已关注，你将会收到该文档的内容更新提醒' },
    ] })
    const stack = host.querySelector('.lark-doc-toast-stack')
    const bars = stack.querySelectorAll('.lark-doc-doc-toast')
    expect(bars).toHaveLength(2)
    expect(bars[0].textContent).toContain('已取消关注')
    expect(bars[1].textContent).toContain('已关注')
    expect(bars[0].querySelector('.lark-doc-doc-toast-icon svg circle')).not.toBeNull()
    expect(bars[0].getAttribute('role')).toBe('status')
    set({ docToasts: [] })
    expect(host.querySelector('.lark-doc-doc-toast')).toBeNull()
  })

  it('opens a heading popup beside the body title independently of the document library', () => {
    const { host, onHeading } = shell({ outlineItems: [{ pos: 10, level: 2, text: 'Section two' }, { pos: 30, level: 1, text: 'Next section' }] })
    host.querySelector('.lark-doc-document-outline-trigger').click()
    const popup = host.querySelector('.lark-doc-document-outline-popover')
    expect(popup).not.toBeNull(); expect(popup.textContent).toContain('Document title')
    expect(popup.textContent).toContain('Section two'); expect(host.querySelector('.lark-doc-mobile-library')).toBeNull()
    const row = popup.querySelector('[data-heading-pos="10"]'); row.click()
    expect(onHeading).toHaveBeenCalledExactlyOnceWith(10)
    expect(host.querySelector('.lark-doc-document-outline-popover')).toBeNull()
    row.click(); expect(onHeading).toHaveBeenCalledOnce()
  })

  it('keeps a mobile six-dot handle in the left gutter and preserves desktop empty-block insertion', () => {
    phone()
    const owner = { editor: {}, effectiveReadonly: false, handleRange: { from: 0, to: 2 }, handleIsEmptyParagraph: true,
      featureEnabled: () => true, handleBlockNode: () => null }
    const state = blockHandleUi.methods.buildBlockHandleState.call(owner)
    expect(state.visible).toBe(true); expect(state.mobile).toBe(true); expect(state.buttonKind).toBe('main')
    const openBlockMenu = vi.fn(), ui = createBlockHandle({ host: document.body, handlers: { openBlockMenu } }); mounted.push(ui)
    ui.updateChrome(state)
    expect(ui.el.querySelector('.lark-doc-empty-block-insert')).toBeNull()
    expect(ui.el.querySelectorAll('.lark-doc-block-handle-dots circle')).toHaveLength(6)
    ui.el.querySelector('.lark-doc-block-handle-main').click(); expect(openBlockMenu).toHaveBeenCalledOnce()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 })
    expect(blockHandleUi.methods.buildBlockHandleState.call(owner).buttonKind).toBe('empty')
  })

  it.each([false, true])('positions the compact handle before the text and fold toggle (fold=%s)', fold => {
    phone()
    const root = document.createElement('section'), paper = document.createElement('div'), node = document.createElement('p')
    paper.className = 'lark-doc-paper'; root.append(paper); paper.append(node); document.body.append(root)
    const rect = { left: 48, right: 345, top: 100, bottom: 126 }
    node.getBoundingClientRect = () => rect
    paper.getBoundingClientRect = () => ({ left: 0, right: 393, top: 0 })
    if (fold) { const toggle = document.createElement('span'); toggle.className = 'lark-doc-heading-fold-toggle'; node.append(toggle)
      toggle.getBoundingClientRect = () => ({ left: 26, right: 44, top: 100, bottom: 126 }) }
    const owner = { ...blockHandle.methods, $refs: { root },
      editor: { state: { doc: fixtureSchema.node('doc', null, [fixtureSchema.node('paragraph')]) }, view: { dom: paper, nodeDOM: () => node } },
      clearBlockMenuCloseTimer() {}, blockShellElement: () => null, highlightStartBounds: () => rect, firstLineInkBounds: () => rect }
    blockHandle.methods.positionBlockHandle.call(owner, { from: 0, to: 2 })
    expect(owner.blockHandlePosition.left).toBe(fold ? 4 : 16)
    expect(owner.blockHandlePosition.left + 20).toBeLessThanOrEqual(fold ? 26 : 48)
  })

  it('retires the title outline and refuses late updates after teardown', () => {
    const { ui, host, paper, set, onHeading } = shell({ outlineItems: [{ pos: 10, level: 1, text: 'Section' }] })
    const trigger = host.querySelector('.lark-doc-document-outline-trigger')
    trigger.click(); ui.destroy(); set({ title: 'Late title', outlineOpen: true })
    window.dispatchEvent(new Event('resize')); trigger.click()
    expect(paper.querySelector('.lark-doc-mobile-document-header')).toBeNull()
    expect(host.querySelector('.lark-doc-topbar')).toBeNull(); expect(onHeading).not.toHaveBeenCalled()
  })

  it('connects the real native host title, scoped metadata and heading navigation', async () => {
    phone()
    stubRanges()
    const element = document.createElement('div'); document.body.append(element)
    const onDocumentAction = () => false
    onDocumentAction.documentMetadata = { documentId: 'shell-doc', author: { name: 'Actual author' }, modifiedAt: Date.now() - 60_000 }
    const doc = new LarkDoc({ element, storage: 'none', documentId: 'shell-doc', title: 'Host document',
      user: { id: 'viewer', name: 'Viewing user' }, onDocumentAction,
      config: { layout: { headerVisible: true, outlineVisible: true, toolbarVisible: false } }, content: '<h2>Actual heading</h2><p>Body</p>' })
    mounted.push(doc)
    await vi.waitFor(() => expect(element.querySelector('.lark-doc-mobile-document-meta').textContent).toContain('Actual author'))
    const editor = doc.getEditor(), dispatch = vi.spyOn(editor.view, 'dispatch')
    element.querySelector('.lark-doc-document-outline-trigger').click()
    await vi.waitFor(() => expect(element.querySelector('.lark-doc-document-outline-popover')).not.toBeNull())
    element.querySelector('.lark-doc-document-outline-popover [data-heading-pos="0"]').click()
    expect(editor.state.selection.from).toBe(1)
    expect(dispatch.mock.calls.some(([transaction]) => transaction.scrolledIntoView && transaction.selection.from === 1)).toBe(true)
    expect(element.querySelector('.lark-doc-document-outline-popover')).toBeNull()
  })

  it.each(['empty', 'task'])('opens the real six-dot menu and inserts a paragraph with one undo (%s)', async kind => {
    phone(); stubRanges()
    const element = document.createElement('div'); document.body.append(element)
    const content = kind === 'empty' ? '<p></p>' : { type: 'doc', content: [{ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Task' }] }] }] }] }
    const doc = new LarkDoc({ element, storage: 'none', content }); mounted.push(doc)
    const editor = doc.getEditor(), host = doc._handle.nativeHost.host
    host.handleRange = { from: 0, to: editor.state.doc.firstChild.nodeSize }
    await vi.waitFor(() => expect(element.querySelector('.lark-doc-block-handle-main')).not.toBeNull())
    const before = doc.getJSON(), count = editor.state.doc.childCount
    element.querySelector('.lark-doc-block-handle-main').click()
    await vi.waitFor(() => expect(element.querySelector('.lark-doc-block-menu')).not.toBeNull())
    element.querySelector('.lark-doc-block-menu [title="在下方添加"]').click()
    await dismissInsertPicker(element)
    expect(editor.state.doc.childCount).toBe(count + 1)
    expect(editor.state.selection.$from.parent.isTextblock).toBe(true)
    expect(doc.undo()).toBe(true); expect(doc.getJSON()).toEqual(before)
  })

  it.each(['hidden', 'destroyed'])('retires six-dot events and rejects remount updates (%s)', kind => {
    const openBlockMenu = vi.fn(), pressHandle = vi.fn()
    const ui = createBlockHandle({ host: document.body, handlers: { openBlockMenu, pressHandle } }); mounted.push(ui)
    ui.updateChrome({ visible: true, mobile: true, buttonKind: 'main' })
    const button = ui.mainEl
    if (kind === 'hidden') ui.updateChrome({ visible: false })
    else { ui.destroy(); ui.updateChrome({ visible: true, mobile: true, buttonKind: 'main' }) }
    ui.updateMenu({ menuOpen: true })
    button.click(); button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    expect(ui.el.isConnected).toBe(false); expect(openBlockMenu).not.toHaveBeenCalled(); expect(pressHandle).not.toHaveBeenCalled()
  })

  it.each(['readonly', 'feature'])('real native guards reject late six-dot actions after %s retirement', async kind => {
    phone(); stubRanges()
    const element = document.createElement('div'); document.body.append(element)
    const doc = new LarkDoc({ element, storage: 'none', content: '<p>Body</p>' }); mounted.push(doc)
    const editor = doc.getEditor(), host = doc._handle.nativeHost.host
    host.handleRange = { from: 0, to: editor.state.doc.firstChild.nodeSize }
    await vi.waitFor(() => expect(element.querySelector('.lark-doc-block-handle-main')).not.toBeNull())
    const button = element.querySelector('.lark-doc-block-handle-main'), before = doc.getJSON()
    if (kind === 'readonly') doc.setReadonly(true)
    else doc.patchProps({ config: { features: { blockHandle: false } } })
    await vi.waitFor(() => expect(element.querySelector('.lark-doc-block-handle')).toBeNull())
    button.click(); button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    host.openBlockMenu()
    expect(host.blockMenuOpen).toBe(false); expect(doc.getJSON()).toEqual(before)
  })
})
