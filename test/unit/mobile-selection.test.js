// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TextSelection } from '@tiptap/pm/state'
import { createBubbleBar } from '../../src/ui/bubbleBar'
import bubbleMenuMixin from '../../src/components/lark-doc/editor/bubbleMenuMixin'
import selectionPacingMixin from '../../src/components/lark-doc/editor/selectionPacingMixin'
import { copySelection } from '../../src/utils/contentClipboard'
import { createOpenAICompatibleProvider } from '../../src/providers/ai'
import { createSelectionTranslationDialog } from '../../src/ui/dialogs'
import { ACTION_PROMPTS, resolveSystemPrompt } from '../../src/components/lark-doc/ai/prompt'
import { LarkDoc } from '../../src/LarkDoc'
import { createDocumentSession } from '../../src/session/DocumentSession'
import { DEFAULT_CAPABILITIES } from '../../src/providers/authorization'

const editors = [], surfaces = []
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
afterEach(() => {
  surfaces.splice(0).forEach(ui => ui.destroy())
  editors.splice(0).forEach(editor => editor.destroy())
  document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks()
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard)
  else delete navigator.clipboard
})

describe('selection translation network review', () => {
  it.each([
    { mode: 'offline', endpoint: 'https://denied.example.test/ai' },
    { mode: 'allowlist', endpoint: 'https://denied.example.test/ai' },
    { mode: 'offline', endpoint: '//denied.example.test/ai' },
    { mode: 'allowlist', endpoint: '/' + String.fromCharCode(92) + 'denied.example.test/ai' },
  ])('blocks $mode endpoint $endpoint without calling its stream', async ({ mode, endpoint }) => {
    const { owner } = ownerOf(), stream = vi.fn(() => ({ cancel() {} }))
    owner.larkDocConfig = { network: { mode, allowlist: ['allowed.example.test'] } }
    owner.aiProvider = { kind: 'endpoint', endpoint, stream }
    expect(await owner.openSelectionTranslation()).toBe(true)
    expect(stream).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('网络策略')
  })
  it.each(['offline', 'allowlist'])('keeps an allowed relative endpoint usable under %s', async mode => {
    const { owner } = ownerOf(), stream = vi.fn(() => ({ cancel() {} }))
    owner.larkDocConfig = { network: { mode, allowlist: [] } }
    owner.aiProvider = { kind: 'endpoint', endpoint: '/api/ai', stream }
    expect(await owner.openSelectionTranslation()).toBe(true)
    expect(stream).toHaveBeenCalledOnce()
  })
  it.each(['offline', 'allowlist'])('cancels pending output when network changes to %s and rejects late chunks', async mode => {
    const { owner } = ownerOf(), cancel = vi.fn(); let args
    owner.larkDocConfig = { network: { mode: 'open', allowlist: [] } }
    owner.aiProvider = { kind: 'endpoint', endpoint: 'https://denied.example.test/ai', stream: value => { args = value; return { cancel } } }
    expect(await owner.openSelectionTranslation()).toBe(true)
    owner.larkDocConfig.network = { mode, allowlist: ['allowed.example.test'] }
    bubbleMenuMixin.watch.larkDocConfig.call(owner)
    expect(cancel).toHaveBeenCalledOnce(); expect(owner._selectionTranslation).toBeNull()
    args.onChunk('late selection leak'); args.onDone()
    expect(document.body.textContent).not.toContain('late selection leak')
    expect(document.querySelector('[aria-label="翻译"]')).toBeNull()
  })
  it('passes actual target-language instructions through createOpenAICompatibleProvider request payload', async () => {
    const { owner } = ownerOf(), payloads = []
    owner.larkDocConfig = { network: { mode: 'allowlist', allowlist: ['allowed.example.test'] } }
    owner.aiProvider = createOpenAICompatibleProvider({ baseUrl: 'https://allowed.example.test/v1', request: async (_url, init) => {
      payloads.push(JSON.parse(init.body)); return { ok: true, body: 'data: {"choices":[{"delta":{"content":"fixture translation"}}]}\n\ndata: [DONE]\n\n' }
    } })
    expect(await owner.openSelectionTranslation()).toBe(true)
    await owner._selectionTranslation.stream.done
    expect(payloads[0].messages[0].content).toContain('翻译成英文')
    expect(payloads[0].messages[1].content).toContain('翻译'); expect(payloads[0].messages[1].content).toContain('lect')
    document.querySelectorAll('.lark-doc-selection-translation-action')[1].click()
    document.querySelector('[data-language="ja"]').click()
    await owner._selectionTranslation.stream.done
    expect(payloads).toHaveLength(2); expect(payloads[1].messages[0].content).toContain('翻译成日文')
    expect(payloads[1].messages[1].content).toContain('lect')
  })
})
function ownerOf() {
  const editor = new Editor({ extensions: [StarterKit], content: '<p>before <strong>selected</strong> after</p>' }); editors.push(editor)
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 10, 14)))
  const providers = { authorization: {}, security: { policy: {} } }, listeners = new Map()
  const session = { user: { id: 'user' }, documentId: 'doc', _privateIdentityGeneration: 1, _authorizationGeneration: 1,
    can: () => true, getProvider: name => providers[name], on: (event, handler) => {
      if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(handler)
      return () => listeners.get(event).delete(handler)
    } }
  const owner = { ...bubbleMenuMixin.methods, editor, session, $refs: { root: document.body }, writable: () => true,
    featureEnabled: () => true, $emit: vi.fn(), $nextTick: fn => Promise.resolve().then(fn) }
  surfaces.push({ destroy: () => owner.closeSelectionTranslation() })
  return { owner, providers, emit: event => listeners.get(event)?.forEach(fn => fn()) }
}
function clipboard(write) {
  class Item { constructor(values) { this.values = values } }
  vi.stubGlobal('ClipboardItem', Item); window.ClipboardItem = Item
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write } })
}

describe('selection share identity ownership', () => {
  async function withShare(run, options = {}) {
    vi.stubGlobal('innerWidth', 393)
    vi.stubGlobal('matchMedia', query => ({ matches: /max-width|pointer:\s*coarse|hover:\s*none/.test(query), addEventListener() {}, removeEventListener() {} }))
    const createRange = document.createRange.bind(document)
    vi.spyOn(document, 'createRange').mockImplementation(() => Object.assign(createRange(), {
      getClientRects: () => [], getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    }))
    const session = createDocumentSession({ documentId: 'selection-share-owner', user: { id: 'owner-a' },
      authorization: options.authorization ? { getCapabilities: async () => ({ ...DEFAULT_CAPABILITIES }) } : null })
    const recipient = actor => ({ id: `recipient-${actor}`, kind: 'user', name: `Recipient ${actor}` })
    const onSelectionShare = Object.prototype.hasOwnProperty.call(options, 'send') ? options.send : vi.fn(async () => true)
    const search = options.search || ((_query, actor) => [recipient(actor)])
    const element = document.createElement('div'); document.body.append(element)
    const doc = new LarkDoc({ element, storage: 'none', session, shareLink: 'https://example.test/doc/selection-share-owner',
      onSelectionShare, mentionSource: query => search(query, session.user.id),
      content: '<p data-block-id="shared_owner_block">分享正文</p>' })
    try {
      await vi.waitFor(() => expect(doc._handle.state.initialized).toBe(true))
      const host = doc._handle.nativeHost.host, editor = doc.getEditor()
      const open = async () => {
        if (!host.imageShare) await vi.waitFor(() => expect(element.querySelector('[role="dialog"][aria-label="分享给"]')).toBeNull())
        editor.commands.setTextSelection({ from: 1, to: 3 })
        expect(host.openSelectionShareDialog()).toBe(true)
        await vi.waitFor(() => expect(host.imageShare?.loading).toBe(false))
        await vi.waitFor(() => expect(element.querySelector('[role="dialog"][aria-label="分享给"]')).not.toBeNull())
        return element.querySelector('[role="dialog"][aria-label="分享给"]')
      }
      const choose = async dialog => {
        dialog.querySelector('.lark-doc-image-share-result').click()
        await vi.waitFor(() => expect(dialog.querySelector('textarea')).not.toBeNull())
      }
      const message = (dialog, value) => { const input = dialog.querySelector('textarea'); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })) }
      const send = dialog => dialog.querySelector('.lark-doc-image-share-footer button.is-primary')
      const cancel = dialog => (dialog.querySelector('.lark-doc-image-share-footer button:not(.is-primary)') || dialog.querySelector('[aria-label="关闭分享"]')).click()
      return await run({ doc, host, session, element, recipient, onSelectionShare, open, choose, message, send, cancel })
    } finally { doc.destroy(); await session.dispose(); element.remove() }
  }
  it('retires old recipients, draft and Send on same-session A to B while keeping B sending and cancellation available', () => withShare(async ({ doc, host, session, onSelectionShare, open, choose, message, send, cancel }) => {
    const before = doc.getJSON(), old = await open()
    await choose(old); message(old, 'A private draft')
    const oldSend = send(old)
    expect(oldSend.disabled).toBe(false)
    session.user = { id: 'owner-b' }
    expect(session.can('canView')).toBe(true); expect(session.can('canExport')).toBe(true)
    expect(host.imageShare).toBeNull()
    oldSend.click()
    expect(onSelectionShare).not.toHaveBeenCalled()
    const current = await open()
    expect(host.imageShare).toMatchObject({ message: '', recipients: [], results: [{ id: 'recipient-owner-b' }] })
    await choose(current); message(current, 'B current draft'); send(current).click()
    await vi.waitFor(() => expect(onSelectionShare).toHaveBeenCalledOnce())
    expect(onSelectionShare.mock.calls[0][0]).toMatchObject({ recipients: [{ id: 'recipient-owner-b' }], message: 'B current draft' })
    await vi.waitFor(() => expect(host.imageShare).toBeNull())
    expect(host.shareToast).toMatchObject({ kind: 'success' })
    const reopened = await open(); cancel(reopened)
    expect(host.imageShare).toBeNull(); expect(doc.getJSON()).toEqual(before)
  }))
  it.each(['actor', 'aba'])('aborts the old send and ignores its late ACK after %s without clearing a new owner draft', reason => {
    let acknowledge, signal
    const callback = vi.fn(input => { signal = input.signal; return new Promise(resolve => { acknowledge = resolve }) })
    return withShare(async ({ doc, host, session, open, choose, message, send, cancel }) => {
      const before = doc.getJSON(), old = await open(), target = host._selectionShareTarget
      const submit = vi.spyOn(host, 'submitSelectionShare'), toast = vi.spyOn(host, 'showShareToast')
      await choose(old); message(old, 'A pending draft'); send(old).click()
      await vi.waitFor(() => expect(callback).toHaveBeenCalledOnce())
      const pending = submit.mock.results[0].value
      session.user = { id: 'owner-b' }
      if (reason === 'aba') session.user = { id: 'owner-a' }
      expect(signal.aborted).toBe(true); expect(host.imageShare).toBeNull()
      expect(host.selectionShareTargetValid(target)).toBe(false)
      const current = await open(); await choose(current); message(current, 'Current owner draft')
      const state = host.imageShare
      acknowledge(true)
      expect(await pending).toBe(false)
      expect(host.imageShare).toBe(state)
      expect(host.imageShare.message).toBe('Current owner draft')
      expect(toast.mock.calls.filter(([kind]) => kind === 'success')).toEqual([])
      cancel(current); expect(host.imageShare).toBeNull(); expect(doc.getJSON()).toEqual(before)
    }, { send: callback })
  })
  it('does not publish an A recipient search into the B dialog after real Session identity reset', () => {
    let finishOld
    return withShare(async ({ host, session, recipient, open, cancel }) => {
      const old = await open(), search = vi.spyOn(host, 'searchImageShareRecipients'), input = old.querySelector('[aria-label="搜索接收人或会话"]')
      input.value = 'private-A-query'; input.dispatchEvent(new Event('input', { bubbles: true }))
      await vi.waitFor(() => expect(finishOld).toBeTypeOf('function'))
      const pending = search.mock.results[0].value
      session.user = { id: 'owner-b' }
      expect(host.imageShare).toBeNull()
      const current = await open(), state = host.imageShare
      finishOld([recipient('owner-a')]); await pending
      expect(host.imageShare).toBe(state)
      expect(host.imageShare).toMatchObject({ query: '', recipients: [], results: [{ id: 'recipient-owner-b' }] })
      cancel(current)
    }, { search: (query, actor) => query === 'private-A-query' ? new Promise(resolve => { finishOld = resolve }) : [{ id: `recipient-${actor}`, kind: 'user', name: actor }] })
  })
  it('keeps sending visibly unavailable without a declared selection-share service', () => withShare(async ({ host, open, choose, send, cancel }) => {
    const dialog = await open(); await choose(dialog)
    expect(send(dialog).disabled).toBe(true)
    expect(dialog.textContent).toContain('尚未配置选区分享服务')
    send(dialog).click(); expect(host.imageShare).not.toBeNull()
    cancel(dialog); expect(host.imageShare).toBeNull()
  }, { send: null }))
  it('retires the captured authorization generation even after the same actor regains the same capabilities', () => withShare(async ({ host, session, open }) => {
    await open()
    const target = host._selectionShareTarget
    expect(host.selectionShareTargetValid(target)).toBe(true)
    await session.refreshCapabilities()
    expect(session.user.id).toBe('owner-a')
    expect(session.can('canView')).toBe(true); expect(session.can('canExport')).toBe(true)
    expect(host.imageShare).toBeNull()
    expect(host.selectionShareTargetValid(target)).toBe(false)
  }, { authorization: true }))
})
describe('selection translation language page review', () => {
  const labels = ['简体中文', '英语', '日语', '泰语', '印地语', '印度尼西亚语', '繁体中文', '法语', '西班牙语', '葡萄牙语', '韩语', '越南语', '俄语', '德语', '意大利语', '阿拉伯语', '波兰语', '菲律宾语', '马来语', '土耳其语', '匈牙利语', '缅甸语', '孟加拉语', '高棉文']
  const codes = ['zh-CN', 'en', 'ja', 'th', 'hi', 'id', 'zh-TW', 'fr', 'es', 'pt', 'ko', 'vi', 'ru', 'de', 'it', 'ar', 'pl', 'fil', 'ms', 'tr', 'hu', 'my', 'bn', 'km']
  const languageEntry = () => [...document.querySelectorAll('.lark-doc-selection-translation-action')].find(button => button.textContent === '切换语种')
  it('resolves all 24 language codes and retains the existing Chinese aliases and unknown fallback', () => {
    for (const code of codes) {
      expect(resolveSystemPrompt('translate', code)).toContain('翻译成')
      expect(resolveSystemPrompt('translate', code)).not.toContain('目标语言')
    }
    expect(resolveSystemPrompt('translate', 'zh')).toContain('翻译成简体中文')
    expect(resolveSystemPrompt('translate', 'zh-CN')).toBe(resolveSystemPrompt('translate', 'zh-cn'))
    expect(resolveSystemPrompt('translate', 'zh-TW')).toContain('翻译成繁体中文')
    expect(resolveSystemPrompt('translate', 'unknown')).toContain('翻译成unknown')
    expect(resolveSystemPrompt('translate')).toBe(ACTION_PROMPTS.translate)
  })
  it('shows all 24 observed languages in order as plain wide rows without a native select', () => {
    const ui = createSelectionTranslationDialog({ host: document.body }); surfaces.push(ui)
    ui.update({ source: 'source', result: 'result', language: 'en' }); languageEntry().click()
    const page = document.querySelector('[role="dialog"][aria-label="将内容翻译为"]')
    expect(page).not.toBeNull(); expect(document.querySelector('select')).toBeNull()
    const rows = [...page.querySelectorAll('[data-language]')]
    expect(rows.map(row => row.textContent)).toEqual(labels); expect(rows.map(row => row.dataset.language)).toEqual(codes)
    expect(rows.every(row => !row.querySelector('svg'))).toBe(true)
    expect(document.querySelector('[aria-label="翻译"]').hidden).toBe(true)
  })
  it('cancel and Escape return to the original result without requesting a new translation', () => {
    const onLanguage = vi.fn(), onClose = vi.fn(), ui = createSelectionTranslationDialog({ host: document.body, handlers: { onLanguage, onClose } }); surfaces.push(ui)
    ui.update({ source: 'source', result: 'kept result', language: 'en' }); languageEntry().click()
    document.querySelector('[aria-label="关闭语种选择"]').click()
    expect(document.querySelector('[aria-label="将内容翻译为"]')).toBeNull()
    expect(document.querySelector('[aria-label="翻译"]').hidden).toBe(false)
    expect(document.body.textContent).toContain('kept result'); expect(onLanguage).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled()
    languageEntry().click(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
    expect(document.querySelector('[aria-label="将内容翻译为"]')).toBeNull(); expect(onLanguage).not.toHaveBeenCalled()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })); expect(onClose).toHaveBeenCalledOnce()
  })
  it('clicking a retired language row after cancel or destroy never requests translation', () => {
    const onLanguage = vi.fn(), ui = createSelectionTranslationDialog({ host: document.body, handlers: { onLanguage } }); surfaces.push(ui)
    ui.update({ source: 'source', result: 'result', language: 'en' }); languageEntry().click()
    const row = document.querySelector('[data-language="th"]')
    document.querySelector('[aria-label="关闭语种选择"]').click(); row.click(); expect(onLanguage).not.toHaveBeenCalled()
    languageEntry().click(); ui.destroy(); row.click(); expect(onLanguage).not.toHaveBeenCalled()
  })
  it('returns to the result sheet and sends an actual Thai payload only after selecting Thai', async () => {
    const { owner } = ownerOf(), payloads = [], before = owner.editor.getJSON()
    owner.aiProvider = createOpenAICompatibleProvider({ baseUrl: 'https://allowed.example.test/v1', request: async (_url, init) => {
      payloads.push(JSON.parse(init.body)); return { ok: true, body: 'data: {"choices":[{"delta":{"content":"fixture result"}}]}\n\ndata: [DONE]\n\n' }
    } })
    await owner.openSelectionTranslation(); await owner._selectionTranslation.stream.done
    languageEntry().click(); document.querySelector('[aria-label="关闭语种选择"]').click()
    expect(payloads).toHaveLength(1)
    languageEntry().click(); document.querySelector('[data-language="th"]').click(); await owner._selectionTranslation.stream.done
    expect(payloads).toHaveLength(2); expect(payloads[1].messages[0].content).toContain('翻译成泰语')
    expect(payloads[1].messages[0].content).not.toContain('目标语言'); expect(payloads[1].messages[1].content).toContain('lect')
    expect(document.querySelector('[aria-label="将内容翻译为"]')).toBeNull(); expect(document.querySelector('[aria-label="翻译"]').hidden).toBe(false)
    expect(owner.editor.getJSON()).toEqual(before)
  })
  it('retiring network policy while the language page is open removes it and ignores its old row', async () => {
    const { owner } = ownerOf(), stream = vi.fn(() => ({ cancel() {} }))
    owner.larkDocConfig = { network: { mode: 'open' } }; owner.aiProvider = { kind: 'endpoint', endpoint: 'https://allowed.example.test/ai', stream }
    await owner.openSelectionTranslation(); languageEntry().click(); const row = document.querySelector('[data-language="th"]')
    owner.larkDocConfig.network.mode = 'offline'; bubbleMenuMixin.watch.larkDocConfig.call(owner)
    row.click(); expect(stream).toHaveBeenCalledOnce(); expect(document.querySelector('[aria-label="将内容翻译为"]')).toBeNull()
  })
  it('switching language without a configured provider retains the clear unavailable state', async () => {
    const { owner } = ownerOf(); await owner.openSelectionTranslation(); languageEntry().click()
    document.querySelector('[data-language="th"]').click()
    expect(document.querySelector('[aria-label="将内容翻译为"]')).toBeNull()
    expect(document.body.textContent).toContain('未配置翻译服务'); expect(owner._selectionTranslation.result).toBe('')
  })
})
describe('phone copy acknowledgement review', () => {
  it('hides the phone popup after successful copy and preserves the selection/document', async () => {
    const { owner } = ownerOf(), selection = owner.editor.state.selection, before = owner.editor.getJSON()
    owner._mobileEditorMedia = { matches: true }; owner.bubbleVisible = true
    clipboard(vi.fn(async () => {}))
    expect(await owner.bubbleCopy()).toBe(true); expect(owner.bubbleVisible).toBe(false)
    expect(owner.editor.state.selection.eq(selection)).toBe(true); expect(owner.editor.getJSON()).toEqual(before)
  })
  it('keeps the phone popup after clipboard failure', async () => {
    const { owner } = ownerOf(); owner._mobileEditorMedia = { matches: true }; owner.bubbleVisible = true
    clipboard(vi.fn(async () => { throw new Error('clipboard unavailable') }))
    expect(await owner.bubbleCopy()).toBe(false); expect(owner.bubbleVisible).toBe(true)
  })
  it('never hides a new popup after a retired identity or a changed selection', async () => {
    for (const change of ['identity', 'selection']) {
      const { owner } = ownerOf(); let finish
      owner._mobileEditorMedia = { matches: true }; owner.bubbleVisible = true
      const write = vi.fn(() => new Promise(resolve => { finish = resolve })); clipboard(write)
      const pending = owner.bubbleCopy(); await vi.waitFor(() => expect(write).toHaveBeenCalledOnce())
      if (change === 'identity') owner.session._privateIdentityGeneration++
      else owner.editor.commands.setTextSelection({ from: 1, to: 4 })
      owner.bubbleVisible = true; finish()
      expect(await pending).toBe(false); expect(owner.bubbleVisible).toBe(true)
    }
  })
  it('keeps the readonly AI entry visibly disabled when no readonly question port exists', () => {
    const onAi = vi.fn(), ui = createBubbleBar(document.body, { config: { mobile: true, readonly: true, ai: true, canAi: false,
      aiUnavailableReason: '当前文档未配置只读问答服务' }, handlers: { onAi } }); surfaces.push(ui)
    ui.update({ left: 8, top: 80 })
    const button = ui.el.querySelector('[aria-label="问问AI"]')
    expect(button.disabled).toBe(true); expect(button.title).toBe('当前文档未配置只读问答服务')
    button.click(); expect(onAi).not.toHaveBeenCalled()
  })
})
describe('phone body selection', () => {
  it('recognizes a native readonly phone selection without editor focus', () => {
    const { owner } = ownerOf()
    document.body.appendChild(owner.editor.view.dom)
    owner.editor.setEditable(false)
    owner.effectiveReadonly = true; owner._mobileEditorMedia = { matches: true }
    Object.assign(owner, selectionPacingMixin.methods, { positionBlockHandle() {}, currentBlockRange() {}, updateTableBoundary() {}, updateCalloutTools() {},
      bubbleBarPosition: () => ({ left: 8, top: 40 }) })
    const text = owner.editor.view.dom.querySelector('strong').firstChild, range = document.createRange()
    range.setStart(text, 2); range.setEnd(text, 6); document.getSelection().removeAllRanges(); document.getSelection().addRange(range)
    expect(owner.editor.isFocused).toBe(false); expect(owner.selectionHasFocus()).toBe(true)
    owner.runSelectionLayout(); expect(owner.bubbleVisible).toBe(true)
    owner._mobileEditorMedia.matches = false; owner.runSelectionLayout(); expect(owner.bubbleVisible).toBe(false)
    owner._mobileEditorMedia.matches = true
    const outside = document.createElement('p'); outside.textContent = 'outside'; document.body.appendChild(outside)
    range.selectNodeContents(outside); document.getSelection().removeAllRanges(); document.getSelection().addRange(range)
    expect(owner.selectionHasFocus()).toBe(false)
  })
  it('uses native action order and retires hidden controls', () => {
    const onCut = vi.fn(), ui = createBubbleBar(document.body, { config: { mobile: true, canCopy: true, canComment: true, canShare: true }, handlers: { onCut } }); surfaces.push(ui)
    ui.update({ left: 8, top: 80 })
    expect([...ui.el.querySelectorAll(':scope > button')].map(button => button.textContent)).toEqual(['剪切', '复制', '评论', '分享', '翻译', '⋮'])
    const cut = ui.el.querySelector('[aria-label="剪切选中文字"]')
    cut.click(); expect(onCut).toHaveBeenCalledOnce()
    ui.hide(); cut.click(); expect(onCut).toHaveBeenCalledOnce()
  })
  it('copies only the selected partial slice as rich HTML and plain text', async () => {
    const { owner } = ownerOf(), write = vi.fn(async () => {}); clipboard(write)
    const range = owner.editor.state.selection
    expect(await copySelection(owner.contentCopyContext(), range)).toBe(true)
    const values = write.mock.calls[0][0][0].values
    const html = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(values['text/html']) })
    expect(html).toContain('<strong>lect</strong>'); expect(html).not.toContain('before'); expect(html).not.toContain('after')
  })
  it('cuts only after clipboard success and supports one normal undo', async () => {
    const { owner } = ownerOf(), before = owner.editor.getJSON(); clipboard(vi.fn(async () => {}))
    expect(await copySelection(owner.contentCopyContext(), owner.editor.state.selection, true)).toBe(true)
    expect(owner.editor.getText()).toBe('before seed after')
    expect(owner.editor.commands.undo()).toBe(true); expect(owner.editor.getJSON()).toEqual(before)
  })
  it.each(['failed', 'document', 'range', 'identity', 'auth', 'provider', 'security', 'readonly', 'policy'])('does not delete selected text after clipboard becomes unsafe (%s)', async reason => {
    const { owner, providers } = ownerOf(), before = owner.editor.getJSON()
    let finish, reject
    clipboard(vi.fn(() => new Promise((resolve, fail) => { finish = resolve; reject = fail })))
    const pending = copySelection(owner.contentCopyContext(), owner.editor.state.selection, true)
    if (reason === 'failed') reject(new Error('denied'))
    if (reason === 'document') owner.editor.commands.insertContentAt(1, 'X')
    if (reason === 'range') owner.editor.commands.setTextSelection({ from: 1, to: 4 })
    if (reason === 'identity') owner.session._privateIdentityGeneration += 1
    if (reason === 'auth') owner.session._authorizationGeneration += 1
    if (reason === 'provider') providers.authorization = {}
    if (reason === 'security') providers.security = { policy: {} }
    if (reason === 'readonly') owner.writable = () => false
    if (reason === 'policy') providers.security.policy.canCopy = false
    const afterChange = owner.editor.getJSON()
    finish()
    expect(await pending).toBe(false); expect(owner.editor.getJSON()).toEqual(afterChange)
    if (reason !== 'document') expect(owner.editor.getJSON()).toEqual(before)
  })
  it('preserves selection focus on a touch press and rejects detached mobile buttons', () => {
    const onCopy = vi.fn(), ui = createBubbleBar(document.body, { config: { mobile: true, canCopy: true }, handlers: { onCopy } }); surfaces.push(ui)
    ui.update({ left: 8, top: 80 })
    const copy = ui.el.querySelector('[aria-label="复制选中文字"]')
    const event = new MouseEvent('pointerdown', { cancelable: true, bubbles: true }); Object.defineProperty(event, 'pointerType', { value: 'touch' })
    copy.dispatchEvent(event); expect(event.defaultPrevented).toBe(true)
    ui.setConfig({ mobile: true, canCopy: false }); copy.click(); expect(onCopy).not.toHaveBeenCalled()
    expect(ui.el.querySelector('[aria-label="复制选中文字"]').disabled).toBe(true)
  })
  it('readonly uses the AI entry and truthful more actions without edit controls', () => {
    const onSelectAll = vi.fn(), ui = createBubbleBar(document.body, { config: { mobile: true, readonly: true, ai: true }, handlers: { onSelectAll } }); surfaces.push(ui)
    ui.update({ left: 8, top: 80 })
    expect(ui.el.firstChild.textContent).toBe('问问AI'); expect(ui.el.querySelector('[aria-label="剪切选中文字"]')).toBeNull()
    ui.el.querySelector('[aria-label="更多选区操作"]').click()
    expect([...ui.el.children].map(button => button.textContent)).toEqual(['飞书内搜索', '网页搜索', '复制选区链接', '全选', '‹'])
    expect([...ui.el.children].slice(0, 3).every(button => button.disabled)).toBe(true)
    ui.el.querySelector('[aria-label="全选正文"]').click(); expect(onSelectAll).toHaveBeenCalledOnce()
    const selectAll = ui.el.querySelector('[aria-label="全选正文"]')
    ui.hide(); ui.update({ left: 8, top: 80 }); selectAll.click(); expect(onSelectAll).toHaveBeenCalledOnce()
    expect(ui.el.querySelector('[aria-label="更多选区操作"]')).not.toBeNull()
    const copy = ui.el.querySelector('[aria-label="复制选中文字"]'); ui.destroy(); copy.click()
    ui.update({ left: 8, top: 80 }); expect(ui.el.isConnected).toBe(false)
  })
  it('shows missing translation service truthfully and never writes the document', async () => {
    const { owner } = ownerOf(), before = owner.editor.getJSON()
    expect(await owner.openSelectionTranslation()).toBe(true)
    expect(document.body.textContent).toContain('未配置翻译服务')
    expect(document.body.textContent).toContain('原文lect译文')
    expect(document.querySelector('.lark-doc-selection-translation-action').disabled).toBe(true)
    expect(owner.editor.getJSON()).toEqual(before)
  })
  it('readonly streams, switches language, copies real result and drops previous replies', async () => {
    const { owner } = ownerOf(), requests = [], cancellations = []
    owner.writable = () => false; owner.effectiveReadonly = true
    owner.aiProvider = { stream: args => { requests.push(args); const cancel = vi.fn(); cancellations.push(cancel); return { cancel } } }
    const before = owner.editor.getJSON()
    expect(await owner.openSelectionTranslation()).toBe(true)
    expect(requests[0]).toMatchObject({ action: 'translate', text: 'lect', language: 'en', range: { from: 10, to: 14, source: 'selection' } })
    requests[0].onChunk('English'); requests[0].onDone()
    document.querySelectorAll('.lark-doc-selection-translation-action')[1].click()
    document.querySelector('[data-language="ja"]').click()
    expect(cancellations[0]).toHaveBeenCalledOnce(); expect(requests[1].language).toBe('ja')
    requests[0].onChunk('stale'); expect(document.body.textContent).not.toContain('stale')
    requests[1].onChunk('日本語'); requests[1].onDone()
    const writeText = vi.fn(async () => {}); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    expect(await owner.copySelectionTranslationResult(owner._selectionTranslation)).toBe(true)
    expect(writeText).toHaveBeenCalledExactlyOnceWith('日本語')
    expect(document.body.textContent).toContain('已复制译文'); expect(owner.editor.getJSON()).toEqual(before)
  })
  it.each(['close', 'document', 'identity', 'auth', 'provider', 'security', 'ai', 'destroy'])('cancels translation and ignores late callbacks on %s', async reason => {
    const { owner, providers, emit } = ownerOf(), cancel = vi.fn(); let args
    owner.aiProvider = { stream: request => { args = request; return { cancel } } }
    expect(await owner.openSelectionTranslation()).toBe(true)
    if (reason === 'close') owner.closeSelectionTranslation()
    if (reason === 'document') owner.editor.commands.insertContentAt(1, 'X')
    if (reason === 'identity') { owner.session._privateIdentityGeneration++; emit('identity') }
    if (reason === 'auth') { owner.session._authorizationGeneration++; emit('capabilities') }
    if (reason === 'provider') { providers.authorization = {}; emit('provider-changed') }
    if (reason === 'security') { providers.security = { policy: {} }; emit('provider-changed') }
    if (reason === 'ai') { owner.aiProvider = {}; bubbleMenuMixin.watch.aiProvider.call(owner) }
    if (reason === 'destroy') owner.destroyBubbleBar()
    expect(cancel).toHaveBeenCalledOnce(); expect(document.querySelector('[aria-label="翻译"]')).toBeNull()
    args.onChunk('late'); args.onDone(); args.onError(new Error('late'))
    expect(document.body.textContent).not.toContain('late'); expect(owner._selectionTranslation).toBeNull()
  })
  it('a closed translation import cannot mount after another selection opens', async () => {
    const { owner } = ownerOf()
    const first = owner.openSelectionTranslation(); owner.closeSelectionTranslation()
    const second = owner.openSelectionTranslation()
    expect(await first).toBe(false); expect(await second).toBe(true)
    expect(document.querySelectorAll('[aria-label="翻译"]')).toHaveLength(1)
  })
  it('translation errors clear partial output and feedback never pretends to send', async () => {
    const { owner } = ownerOf(); let args
    owner.aiProvider = { stream: value => { args = value; return { cancel() {} } } }
    await owner.openSelectionTranslation(); args.onChunk('partial'); args.onError(new Error('private server address'))
    expect(document.body.textContent).not.toContain('partial'); expect(document.body.textContent).not.toContain('private server address')
    expect(document.body.textContent).toContain('翻译失败')
    document.querySelectorAll('.lark-doc-selection-translation-action')[2].click()
    expect(document.body.textContent).toContain('未配置翻译反馈服务')
  })
  it('feature revocation cancels a pending translation and blocks later calls', async () => {
    const { owner } = ownerOf(), cancel = vi.fn(), stream = vi.fn(() => ({ cancel }))
    owner.aiProvider = { stream }; await owner.openSelectionTranslation()
    owner.featureEnabled = () => false; bubbleMenuMixin.watch.larkDocConfig.call(owner)
    expect(cancel).toHaveBeenCalledOnce(); expect(owner._selectionTranslation).toBeNull()
    expect(await owner.openSelectionTranslation()).toBe(false); expect(stream).toHaveBeenCalledOnce()
  })
  it('a broken provider cancellation cannot retain the old translation surface', async () => {
    const { owner } = ownerOf(); let args
    owner.aiProvider = { stream: value => { args = value; return { cancel() { throw new Error('provider cancel failed') } } } }
    await owner.openSelectionTranslation()
    expect(() => owner.closeSelectionTranslation()).not.toThrow()
    args.onChunk('late'); expect(document.querySelector('[aria-label="翻译"]')).toBeNull()
  })
  it('closing a translation while clipboard is pending rejects the late acknowledgement', async () => {
    const { owner } = ownerOf(); let args, finish
    owner.aiProvider = { stream: value => { args = value; return { cancel() {} } } }
    await owner.openSelectionTranslation(); args.onChunk('result'); args.onDone()
    const writeText = vi.fn(() => new Promise(resolve => { finish = resolve }))
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const pending = owner.copySelectionTranslationResult(owner._selectionTranslation)
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledOnce())
    owner.closeSelectionTranslation(); finish()
    expect(await pending).toBe(false); expect(document.querySelector('[aria-label="翻译"]')).toBeNull()
  })
})
