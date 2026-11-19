// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { UndoRedo } from '@tiptap/extensions'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { LarkDocMention } from '../../src/core/blocks/mention'
import { createMentionPanel } from '../../src/ui/mention'
import mentionMixin from '../../src/components/lark-doc/editor/mentionMixin'
import mentionUiMixin from '../../src/components/lark-doc/editor/mentionUiMixin'

const cleanups = []
afterEach(() => {
  cleanups.splice(0).reverse().forEach(cleanup => cleanup())
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const directory = [
  { id: 'alice', name: 'Alice', kind: 'user', department: 'Team' },
  { id: 'plan', name: 'Plan', kind: 'page' },
  { id: 'group', name: 'Group', kind: 'chat' },
]
function panel({ mobile = true, source = directory, session = null, history = false } = {}) {
  const element = document.createElement('div'); document.body.append(element)
  const editor = new Editor({ element, extensions: [Document, Paragraph, Text, LarkDocMention, ...(history ? [UndoRedo] : [])], content: '<p>@</p>' })
  const host = document.createElement('div'); document.body.append(host)
  const onChoose = vi.fn()
  let ui
  const vm = { ...mentionMixin.data(), ...mentionMixin.methods, ...mentionUiMixin.methods,
    editor, session, mentionSource: source, _mobileEditorMedia: { matches: mobile }, _mentionToken: 0,
    writable: () => editor.isEditable, $refs: { root: host }, larkDocConfig: {},
    mentionStyleAt: () => ({}), positionMentionPanel() {},
    $nextTick(callback) { callback(); render() },
  }
  Object.defineProperties(vm, {
    mentionDirectory: { get: () => mentionMixin.computed.mentionDirectory.call(vm) },
    mentionRemote: { get: () => mentionMixin.computed.mentionRemote.call(vm) },
  })
  mentionMixin.created.call(vm)
  function render() { ui?.update(vm.buildMentionPanelState()) }
  ui = createMentionPanel({ host, handlers: {
    onKind(kind) { vm.setMentionKind(kind); render() },
    onNotify(value) { vm.setMentionNotify(value); render() },
    onCancel() { vm.closeMentionPanel(); render() },
    onQuery() { void vm.queryPendingMention().then(render) },
    onRetry() { vm.refreshMentionItems(); render() },
    onChoose,
  } })
  cleanups.push(() => { ui.destroy(); editor.destroy() })
  vm.onMention({ from: 1, to: 2, query: '' }); render()
  return { vm, ui, host, editor, render, onChoose }
}
function tab(view, label) {
  const node = [...view.host.querySelectorAll('[role="tab"]')].find(item => item.textContent === label)
  expect(node, `tab ${label}`).toBeTruthy()
  if (view.vm._mobileEditorMedia.matches) node.click()
  else node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
}
function pointer(target, type, x, y) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 })
  Object.defineProperties(event, { pointerType: { value: 'touch' }, pointerId: { value: 1 } })
  target.dispatchEvent(event)
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

describe('phone body mention categories', () => {
  async function remoteView() {
    const createRange = document.createRange.bind(document)
    vi.spyOn(document, 'createRange').mockImplementation(() => Object.assign(createRange(), {
      getClientRects: () => [], getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }),
    }))
    const result = candidates => ({ status: 'resolved', operationId: 'mention-lookup', requestHash: 'sha256:' + 'a'.repeat(64),
      tenantId: 'tenant', docId: 'doc', sourceEpoch: '1', sourceSeq: '0', persisted: true, notified: false, shared: false, replayed: false, candidates })
    const candidate = kind => kind === 'page' ? { kind, docId: 'plan', displayName: 'Plan' } : { kind: 'user', principalId: 'alice', displayName: 'Alice' }
    let current = result([candidate('user')])
    const resolveMentions = vi.fn(async ({ kinds = ['user'] }) => (current = result(kinds.map(candidate))))
    const queryMentionResolution = vi.fn(async () => current)
    const authority = { isRemote: true, resolveMentions, getScope: () => ({ tenantId: 'tenant', docId: 'doc' }) }
    const session = { documentId: 'doc', user: { id: 'manager' }, _privateIdentityGeneration: 1, _authorizationGeneration: 1,
      can: () => true, getProvider: () => authority, resolveMentions, queryMentionResolution }
    const view = panel({ session, history: true }); await settle(); view.render()
    view.editor.view.focus(); view.editor.isFocused = true
    vi.spyOn(view.editor.view, 'hasFocus').mockReturnValue(true)
    return { ...view, session, authority, result, candidate }
  }
  it('requests and rechecks authoritative remote page candidates before inserting a non-notifying document entity', async () => {
    const view = await remoteView()
    view.vm.mentionNotify = true
    tab(view, '云文档'); await settle(); view.render()
    expect(view.session.resolveMentions).toHaveBeenLastCalledWith({ query: '', kinds: ['page'] })
    expect(view.vm.mentionItems).toEqual([{ kind: 'page', id: 'plan', name: 'Plan' }])
    expect(view.host.querySelector('.lark-doc-mention-notify')).toBeNull()
    expect(await view.vm.chooseRemoteMention(view.vm.mentionItems[0])).toBe(true)
    expect(view.session.queryMentionResolution).toHaveBeenCalledExactlyOnceWith('mention-lookup')
    expect(view.editor.getJSON().content[0].content[0]).toMatchObject({ type: 'mention', attrs: { kind: 'page', id: 'plan', name: 'Plan', notify: false } })
  })
  it('keeps remote entity insertion as one exact undo and stops both sides of a Yjs capture boundary', async () => {
    const view = await remoteView(), stopCapturing = vi.fn()
    view.editor.registerPlugin(new Plugin({ key: new PluginKey('mention-capture'), state: { init: () => ({ undoManager: { stopCapturing } }), apply: (_tr, value) => value } }))
    view.editor.commands.setTextSelection(2); view.editor.commands.insertContent('q')
    view.vm.onMention({ from: 1, to: 3, query: 'q' }); await settle(); view.render()
    const before = view.editor.getJSON()
    expect(await view.vm.chooseRemoteMention(view.vm.mentionItems[0])).toBe(true)
    expect(view.editor.commands.undo()).toBe(true)
    expect(view.editor.getJSON()).toEqual(before)
    expect(stopCapturing).toHaveBeenCalledTimes(2)
  })
  it('preserves a remote document title beyond the people-name limit without carrying a people notification intent', async () => {
    const view = await remoteView(), name = '云文档标题'.repeat(30)
    const result = view.result([{ kind: 'page', docId: 'plan', displayName: name }])
    view.session.resolveMentions.mockResolvedValue(result); view.session.queryMentionResolution.mockResolvedValue(result)
    view.vm.mentionNotify = true; tab(view, '云文档'); await settle(); view.render()
    expect(await view.vm.chooseRemoteMention(view.vm.mentionItems[0])).toBe(true)
    expect(view.editor.getJSON().content[0].content[0].attrs).toMatchObject({ kind: 'page', name, notify: false })
  })
  it.each(['wrong-kind', 'invalid-id', 'blank-name', 'control-name', 'wrong-document', 'duplicate', 'missing-kind', 'invalid-hash', 'array-candidate'])('rejects malformed remote page proof before presenting any entity (%s)', async failure => {
    const view = await remoteView(), result = view.result([view.candidate('page')]), candidate = result.candidates[0]
    if (failure === 'wrong-kind') result.candidates = [view.candidate('user')]
    if (failure === 'invalid-id') candidate.docId = '/outside'
    if (failure === 'blank-name') candidate.displayName = ' '
    if (failure === 'control-name') candidate.displayName = 'unsafe\nname'
    if (failure === 'wrong-document') result.docId = 'other'
    if (failure === 'duplicate') result.candidates.push({ ...candidate })
    if (failure === 'missing-kind') delete candidate.kind
    if (failure === 'invalid-hash') result.requestHash = 'unconfirmed'
    if (failure === 'array-candidate') result.candidates = [Object.assign([], candidate)]
    view.session.resolveMentions.mockResolvedValue(result)
    tab(view, '云文档'); await settle(); view.render()
    expect(view.vm.mentionItems).toEqual([]); expect(view.vm.mentionRequestState).toBeNull()
    expect(view.vm.mentionMessage).not.toContain('候选已确认')
    expect(view.editor.getJSON().content[0].content[0]).toMatchObject({ type: 'text', text: '@' })
  })
  it.each(['operationId', 'tenantId', 'docId', 'sourceEpoch', 'sourceSeq'].flatMap(field => ['numeric', 'array'].map(type => [field, type])))('rejects a custom authorization %s proof with %s type before entity mapping', async (field, type) => {
    const view = await remoteView(), result = view.result([view.candidate('page')])
    delete view.authority.getScope; delete view.session.documentId
    result[field] = type === 'array' ? [result[field]] : 7
    view.session.resolveMentions.mockResolvedValue(result)
    tab(view, '云文档'); await settle(); view.render()
    expect(view.vm.mentionRequestState).toBeNull(); expect(view.vm.mentionItems).toEqual([])
  })
  it('rejects an array-shaped authorization proof even when it carries valid-looking fields', async () => {
    const view = await remoteView(), result = Object.assign([], view.result([view.candidate('page')]))
    view.session.resolveMentions.mockResolvedValue(result)
    tab(view, '云文档'); await settle(); view.render()
    expect(view.vm.mentionRequestState).toBeNull(); expect(view.vm.mentionItems).toEqual([])
  })
  it.each(['hash', 'watermark', 'document', 'actor', 'identity', 'authorization', 'provider', 'range', 'readonly', 'focus', 'cancel'])('drops a delayed remote page insertion after %s changes', async change => {
    const view = await remoteView(); tab(view, '云文档'); await settle(); view.render()
    let finish
    view.session.queryMentionResolution.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const pending = view.vm.chooseRemoteMention(view.vm.mentionItems[0])
    expect(finish).toBeTypeOf('function')
    const result = view.result([view.candidate('page')])
    if (change === 'hash') result.requestHash = 'sha256:' + 'b'.repeat(64)
    if (change === 'watermark') result.sourceSeq = '1'
    if (change === 'document') view.editor.commands.insertContent('changed')
    if (change === 'actor') view.session.user.id = 'other'
    if (change === 'identity') view.session._privateIdentityGeneration++
    if (change === 'authorization') view.session._authorizationGeneration++
    if (change === 'provider') view.session.getProvider = () => ({ ...view.authority })
    if (change === 'range') view.editor.commands.setTextSelection(2)
    if (change === 'readonly') view.editor.setEditable(false)
    if (change === 'focus') view.editor.view.hasFocus.mockReturnValue(false)
    if (change === 'cancel') view.vm.closeMentionPanel()
    const current = view.editor.getJSON(); finish(result); await pending
    expect(view.editor.getJSON()).toEqual(current)
    expect(view.editor.getJSON().content[0].content.some(node => node.type === 'mention')).toBe(false)
  })
  it('queries an unknown lookup by its original key from the visible control before retrying the current category', async () => {
    const view = await remoteView()
    view.session.resolveMentions.mockClear().mockRejectedValueOnce(Object.assign(Error('response lost'), { status: 'unknown', operationId: 'original-lookup' }))
    view.vm.refreshMentionItems(); await settle(); view.render()
    expect(view.vm.mentionPendingOperation).toBe('original-lookup')
    tab(view, '云文档'); await settle(); view.render()
    expect(view.session.resolveMentions).toHaveBeenCalledTimes(1)
    view.session.queryMentionResolution.mockResolvedValue({ ...view.result([view.candidate('user')]), operationId: 'original-lookup' })
    const query = [...view.host.querySelectorAll('button')].find(node => node.textContent === '查询原请求')
    expect(query).toBeTruthy(); query.click(); await settle(); view.render()
    expect(view.session.queryMentionResolution).toHaveBeenCalledExactlyOnceWith('original-lookup')
    expect(view.vm.mentionPendingOperation).toBe(''); expect(view.session.resolveMentions).toHaveBeenCalledTimes(1)
    view.session.resolveMentions.mockResolvedValue(view.result([view.candidate('page')]))
    ;[...view.host.querySelectorAll('button')].find(node => node.textContent === '重新查询').click(); await settle(); view.render()
    expect(view.session.resolveMentions).toHaveBeenLastCalledWith({ query: '', kinds: ['page'] })
    expect(view.vm.mentionItems).toEqual([{ kind: 'page', id: 'plan', name: 'Plan' }])
    expect(view.editor.getText()).toBe('@')
  })
  it.each([undefined, 503, 409])('retires an original pending lookup only for an explicit source-conflict HTTP 409 (%s)', async httpStatus => {
    const view = await remoteView()
    view.session.resolveMentions.mockRejectedValueOnce(Object.assign(Error('lost'), { status: 'unknown', operationId: 'original-lookup' }))
    view.vm.refreshMentionItems(); await settle(); view.render()
    view.session.queryMentionResolution.mockRejectedValue(Object.assign(Error('source conflict'), { code: 'MENTION_SOURCE_CONFLICT', status: 'rejected', httpStatus }))
    await view.vm.queryPendingMention()
    expect(view.vm.mentionPendingOperation).toBe(httpStatus === 409 ? '' : 'original-lookup')
    expect(view.editor.getText()).toBe('@')
  })
  it.each(['unknown', 'invalid-resolved'])('retains the original lookup key after a same-key %s query result and never opens a fresh resolve', async status => {
    const view = await remoteView()
    view.session.resolveMentions.mockClear().mockRejectedValueOnce(Object.assign(Error('lost'), { status: 'unknown', operationId: 'original-lookup' }))
    view.vm.refreshMentionItems(); await settle(); view.render()
    const originalKinds = view.vm._mentionPendingKinds, originalOwner = view.vm._mentionPendingOwner
    const invalid = status === 'unknown' ? { status: 'unknown', operationId: 'original-lookup' }
      : { ...view.result([view.candidate('user')]), operationId: 'original-lookup', requestHash: 'invalid' }
    view.session.queryMentionResolution.mockResolvedValue(invalid)
    await view.vm.queryPendingMention(); view.render()
    expect(view.vm.mentionPendingOperation).toBe('original-lookup')
    expect(view.vm._mentionPendingKinds).toBe(originalKinds); expect(view.vm._mentionPendingOwner).toBe(originalOwner)
    view.vm.refreshMentionItems(); tab(view, '云文档'); tab(view, '人员'); await settle(); view.render()
    expect(view.session.resolveMentions).toHaveBeenCalledTimes(1)
    await view.vm.queryPendingMention()
    expect(view.session.queryMentionResolution.mock.calls).toEqual([['original-lookup'], ['original-lookup']])
    expect(view.vm.mentionPendingOperation).toBe('original-lookup')
    expect(view.editor.getText()).toBe('@')
  })
  it.each([
    [400, 0, 400, 452],
    [400, 80, 400, 372],
    [180, 120, 180, 552],
    [852, 0, 553.8, 0],
  ])('fits a %spx visible viewport at offset %s without clipping the sheet above it', (visibleHeight, offsetTop, height, bottom) => {
    vi.stubGlobal('innerHeight', 852)
    vi.stubGlobal('visualViewport', { height: visibleHeight, offsetTop })
    const view = panel(), before = view.editor.getJSON(), state = view.vm.buildMentionPanelState()
    expect(parseFloat(state.style.height)).toBeCloseTo(height)
    expect(parseFloat(state.style.maxHeight)).toBeCloseTo(height)
    expect(parseFloat(state.style.bottom)).toBe(bottom)
    expect(852 - parseFloat(state.style.bottom) - parseFloat(state.style.height)).toBeGreaterThanOrEqual(offsetTop)
    expect(view.editor.getJSON()).toEqual(before)
    view.vm._mobileEditorMedia.matches = false
    view.vm.mentionStyle = { left: '12px', top: '34px' }
    expect(view.vm.buildMentionPanelState().style).toEqual({ left: '12px', top: '34px' })
  })

  it('refreshes visible viewport resize/scroll without resetting list position and removes closed/destroyed listeners', async () => {
    vi.stubGlobal('innerHeight', 852)
    const viewport = Object.assign(new window.EventTarget(), { height: 400, offsetTop: 0 })
    const media = Object.assign(new window.EventTarget(), { matches: true })
    vi.stubGlobal('visualViewport', viewport)
    vi.stubGlobal('matchMedia', () => media)
    const viewportAdd = vi.spyOn(viewport, 'addEventListener'), viewportRemove = vi.spyOn(viewport, 'removeEventListener')
    const mediaRemove = vi.spyOn(media, 'removeEventListener'), windowRemove = vi.spyOn(window, 'removeEventListener')
    const view = panel(), before = view.editor.getJSON()
    view.ui.destroy()
    view.vm.$refs.mentionHost = view.host
    view.vm.mountMentionPanel()
    cleanups.push(() => view.vm.destroyMentionPanel())
    await vi.dynamicImportSettled()
    const list = view.host.querySelector('[role="listbox"]')
    list.scrollTop = 125; list.dispatchEvent(new Event('scroll'))
    viewport.height = 200
    viewport.dispatchEvent(new Event('resize'))
    expect(view.vm._mentionUi.el.style.height).toBe('200px')
    expect(list.scrollTop).toBe(125)
    viewport.offsetTop = 60
    viewport.dispatchEvent(new Event('scroll'))
    expect(view.vm._mentionUi.el.style.bottom).toBe('592px')
    expect(list.scrollTop).toBe(125)
    expect(view.editor.getJSON()).toEqual(before)
    const refresh = viewportAdd.mock.calls.find(([type]) => type === 'resize')[1]
    view.vm.closeMentionPanel(); view.vm.refreshMentionPanel()
    expect(viewportRemove).toHaveBeenCalledWith('resize', refresh)
    expect(viewportRemove).toHaveBeenCalledWith('scroll', refresh)
    expect(mediaRemove).toHaveBeenCalledWith('change', refresh)
    expect(windowRemove).toHaveBeenCalledWith('resize', refresh)
    view.vm.onMention({ from: 1, to: 2, query: '' }); view.vm.refreshMentionPanel()
    expect(viewportAdd.mock.calls.filter(([type]) => type === 'resize')).toHaveLength(2)
    view.vm.destroyMentionPanel()
    expect(viewportRemove.mock.calls.filter(([type]) => type === 'resize')).toHaveLength(2)
    expect(view.host.querySelector('[role="dialog"]')).toBeNull()
  })

  it('keeps keyboard selection on the displayed category even when a source ignores its category filter', async () => {
    const view = panel({ source: { search: () => directory } })
    tab(view, '云文档'); await settle(); view.render()
    expect(view.vm.mentionItems.map(item => item.id)).toEqual(['plan'])
    expect(view.host.querySelector('[role="option"]').textContent).toContain('Plan')
    view.vm.onMentionKeydown(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(view.editor.getJSON().content[0].content[0]).toMatchObject({ type: 'mention', attrs: { id: 'plan', kind: 'page' } })
  })
  it('opens three phone categories with a current heading and Cancel preserves literal @', () => {
    const view = panel(), before = view.editor.getJSON()
    expect([...view.host.querySelectorAll('[role="tab"]')].map(node => node.textContent)).toEqual(['人员', '云文档', '群名片'])
    expect(view.host.querySelector('h3')?.textContent).toBe('你可能想提及的人员')
    tab(view, '云文档')
    expect(view.host.querySelector('h3')?.textContent).toBe('你可能想提及的云文档')
    tab(view, '群名片')
    expect(view.host.querySelector('h3')?.textContent).toBe('你可能想插入的群名片')
    view.host.querySelector('[aria-label="取消提及"]').click()
    expect(view.vm.mentionOpen).toBe(false)
    expect(view.editor.getJSON()).toEqual(before)
    expect(view.host.querySelector('[role="dialog"]')).toBeNull()
  })

  it('keeps the desktop All category and original direct mouse selection', () => {
    const view = panel({ mobile: false })
    expect([...view.host.querySelectorAll('[role="tab"]')].map(node => node.textContent)).toEqual(['全部', '人', '云文档', '群名片'])
    expect(view.host.querySelector('[aria-label="取消提及"]')).toBeNull()
    view.host.querySelector('[role="option"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    expect(view.onChoose).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'alice', kind: 'user' }))
  })

  it('keeps the editor focused through a phone tab pointer and compatibility mouse sequence', () => {
    const view = panel(), before = view.editor.getJSON()
    view.editor.commands.setTextSelection(2)
    view.editor.view.focus()
    const selection = view.editor.state.selection
    for (const [label, kind] of [['云文档', 'page'], ['群名片', 'chat'], ['人员', 'user']]) {
      const node = [...view.host.querySelectorAll('[role="tab"]')].find(tab => tab.textContent === label)
      pointer(node, 'pointerdown', 100, 100)
      pointer(node, 'pointerup', 100, 100)
      const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
      node.dispatchEvent(mouseDown)
      // Mirror the observed browser sequence; jsdom does not apply the mousedown focus default.
      if (!mouseDown.defaultPrevented) node.focus()
      node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }))
      node.click()
      expect(document.activeElement).toBe(view.editor.view.dom)
      expect(view.vm.mentionOpen).toBe(true)
      expect(view.vm.mentionKind).toBe(kind)
      expect(node.getAttribute('aria-selected')).toBe('true')
      expect([...view.host.querySelectorAll('.lark-doc-mention-row-name')].map(node => node.textContent))
        .toEqual(kind === 'page' ? ['Plan'] : kind === 'chat' ? ['Group'] : ['Alice'])
      expect(view.editor.state.selection.eq(selection)).toBe(true)
      expect(view.editor.getJSON()).toEqual(before)
    }
    expect(view.onChoose).not.toHaveBeenCalled()
  })

  it('ignores a candidate compatibility click after list pointercancel and accepts the next fresh touch', () => {
    const view = panel(), node = view.host.querySelector('[role="option"]'), before = view.editor.getJSON()
    pointer(node, 'pointerdown', 100, 100)
    pointer(node, 'pointercancel', 100, 100)
    node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }))
    node.click()
    expect(view.onChoose).not.toHaveBeenCalled()
    expect(view.vm.mentionOpen).toBe(true)
    expect(view.editor.getJSON()).toEqual(before)
    pointer(node, 'pointerdown', 100, 100)
    pointer(node, 'pointerup', 100, 100)
    node.click()
    expect(view.onChoose).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'alice', kind: 'user' }))
  })

  it('retains independent category scroll offsets and resets them for a new query/open', () => {
    const view = panel(), list = view.host.querySelector('[role="listbox"]')
    list.scrollTop = 125; list.dispatchEvent(new Event('scroll'))
    tab(view, '云文档'); list.scrollTop = 60; list.dispatchEvent(new Event('scroll'))
    tab(view, '群名片'); list.scrollTop = 245; list.dispatchEvent(new Event('scroll'))
    tab(view, '人员'); expect(list.scrollTop).toBe(125)
    tab(view, '群名片'); expect(list.scrollTop).toBe(245)
    tab(view, '云文档'); expect(list.scrollTop).toBe(60)
    view.vm.mentionQuery = 'Plan'; view.vm.refreshMentionItems(); view.render()
    expect(list.scrollTop).toBe(0)
    view.vm.closeMentionPanel(); view.render()
    view.vm.onMention({ from: 1, to: 2, query: '' }); view.render()
    expect(list.scrollTop).toBe(0)
  })

  it('swipes categories horizontally without selecting a candidate, and leaves vertical gestures to the list', () => {
    const view = panel(), list = view.host.querySelector('[role="listbox"]'), before = view.editor.getJSON()
    pointer(list, 'pointerdown', 280, 100); pointer(list, 'pointermove', 80, 105); pointer(list, 'pointerup', 80, 105)
    expect(view.vm.mentionKind).toBe('page')
    view.host.querySelector('[role="option"]').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    expect(view.onChoose).not.toHaveBeenCalled()
    pointer(list, 'pointerdown', 100, 180); pointer(list, 'pointermove', 103, 70); pointer(list, 'pointerup', 103, 70)
    expect(view.vm.mentionKind).toBe('page')
    view.host.querySelector('[role="option"]').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    expect(view.onChoose).not.toHaveBeenCalled()
    pointer(list, 'pointerdown', 100, 90); pointer(list, 'pointerup', 100, 90)
    view.host.querySelector('[role="option"]').click()
    expect(view.onChoose).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'plan', kind: 'page' }))
    expect(view.editor.getJSON()).toEqual(before)
  })

  it('shows notification only on people and retains a label toggle across category changes', () => {
    const view = panel()
    view.host.querySelector('.lark-doc-mention-notify').click()
    expect(view.vm.mentionNotify).toBe(true)
    tab(view, '云文档')
    expect(view.host.querySelector('.lark-doc-mention-notify')).toBeNull()
    tab(view, '人员')
    expect(view.host.querySelector('input[type="checkbox"]').checked).toBe(true)
    view.host.querySelector('.lark-doc-mention-notify').click()
    expect(view.vm.mentionNotify).toBe(false)
  })

  it('prevents a phone notification press from taking editor focus while still toggling', () => {
    const view = panel(), before = view.editor.getJSON()
    const label = view.host.querySelector('.lark-doc-mention-notify')
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    label.dispatchEvent(press)
    expect(press.defaultPrevented).toBe(true)
    label.click()
    expect(view.vm.mentionNotify).toBe(true)
    expect(view.editor.getJSON()).toEqual(before)
  })

  it.each(['identity', 'permission'])('retires a configured-source lookup after %s changes', async change => {
    let finish
    const source = { search: () => new Promise(resolve => { finish = resolve }) }
    const session = { user: { id: 'alice' }, can: () => true, getProvider: () => null }
    const view = panel({ source, session })
    if (change === 'identity') {
      session.user.id = 'bob'
      mentionMixin.watch['session.user.id'].call(view.vm, 'bob', 'alice')
    } else {
      view.vm.effectiveReadonly = true
      mentionMixin.watch.effectiveReadonly.call(view.vm, true)
    }
    expect(view.vm.mentionOpen).toBe(false)
    finish([{ id: 'alice', name: 'Alice', kind: 'user' }]); await settle(); view.render()
    expect(view.vm.mentionItems).toEqual([])
    expect(view.host.querySelector('[role="dialog"]')).toBeNull()
  })

  it('keeps remote chat unavailable while a page request and its late result retain their own category', async () => {
    let finish
    const resolveMentions = vi.fn(() => new Promise(resolve => { finish = resolve }))
    const authority = { isRemote: true, resolveMentions }
    const session = { user: { id: 'alice' }, can: () => true, getProvider: () => authority, resolveMentions }
    const view = panel({ session })
    tab(view, '云文档')
    expect(resolveMentions).toHaveBeenLastCalledWith({ query: '', kinds: ['page'] })
    expect(resolveMentions).toHaveBeenCalledTimes(2)
    tab(view, '群名片')
    expect(view.host.querySelector('[role="status"]')?.textContent || '').toMatch(/群名片.*(?:不可用|尚未|未提供)/)
    expect(resolveMentions).toHaveBeenCalledTimes(2)
    finish({ status: 'resolved', candidates: [{ principalId: 'alice', displayName: 'Alice' }] }); await settle(); view.render()
    expect(view.host.querySelector('[role="option"]')).toBeNull()
  })

  it('retains an unknown people lookup across tabs without submitting another operation', async () => {
    const resolveMentions = vi.fn(async () => { throw Object.assign(new Error('response lost'), { status: 'unknown', operationId: 'original-lookup' }) })
    const authority = { isRemote: true, resolveMentions }
    const session = { user: { id: 'alice' }, can: () => true, getProvider: () => authority, resolveMentions }
    const view = panel({ session }); await settle(); view.render()
    expect(view.vm.mentionPendingOperation).toBe('original-lookup')
    tab(view, '群名片'); tab(view, '人员')
    expect(view.vm.mentionPendingOperation).toBe('original-lookup')
    expect(resolveMentions).toHaveBeenCalledTimes(1)
    expect(view.host.querySelector('[role="status"]')?.textContent).toContain('原目录请求')
  })

  it('ignores a late result and retired controls after Cancel', async () => {
    let finish
    const resolveMentions = () => new Promise(resolve => { finish = resolve })
    const authority = { isRemote: true, resolveMentions }
    const session = { user: { id: 'alice' }, can: () => true, getProvider: () => authority, resolveMentions }
    const view = panel({ session }), retiredTab = view.host.querySelector('[role="tab"]'), before = view.editor.getJSON()
    const cancel = view.host.querySelector('[aria-label="取消提及"]'); expect(cancel).toBeTruthy(); cancel.click()
    retiredTab.click()
    finish({ status: 'resolved', candidates: [{ principalId: 'alice', displayName: 'Alice' }] }); await settle(); view.render()
    expect(view.vm.mentionOpen).toBe(false)
    expect(view.vm.mentionItems).toEqual([])
    expect(view.editor.getJSON()).toEqual(before)
    expect(view.host.querySelector('[role="dialog"]')).toBeNull()
  })
})
