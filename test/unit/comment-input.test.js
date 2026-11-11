import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { commentDraftDocument, serializeCommentDocument } from '../../src/core/comments/mentions'

const source = readFileSync(new URL('../../src/components/lark-doc/CommentTextInput.vue', import.meta.url), 'utf8')
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '').replace('export default', 'return')
const component = new Function('Node', 'Extension', 'Editor', 'mergeAttributes', 'commentDraftDocument', 'serializeCommentDocument', script)(
  { create: value => ({ ...value, configure() { return this } }) }, { create: value => value }, function (options) { this.options = options; this.isEmpty = false; this.getJSON = () => commentDraftDocument('private old draft'); }, value => value, commentDraftDocument, serializeCommentDocument)
const resolved = () => ({ status: 'resolved', operationId: 'directory-original', requestHash: 'hash', tenantId: 'tenant', docId: 'doc', sourceEpoch: '1', sourceSeq: '3',
  persisted: true, notified: false, shared: false, candidates: [{ kind: 'user', principalId: 'alice', displayName: 'Alice' }] })
function vm() {
  const provider = {}, session = { user: { id: 'sender' }, documentId: 'doc', _privateIdentityGeneration: 1, _authorizationGeneration: 1,
    getProvider: () => provider, resolveMentions: vi.fn(async () => resolved()), queryMentionResolution: vi.fn(async () => resolved()) }
  const value = { ...component.data(), ...component.methods, readonly: false, mentions: [], ed: { session, commentIdentityGeneration: 1, commentCan: () => true },
    positionMenu: () => {}, $emit: vi.fn(), $nextTick: callback => callback(), _range: { from: 1, to: 3, query: 'A' }, _querySignature: 'original' }
  value.open = true
  return value
}
afterEach(() => vi.useRealTimers())

describe('standalone comment mention directory lifecycle', () => {
  it('retires pending directory state on capability/provider reset and removes prior session listeners', () => {
    const value = vm(), handlers = {}, stops = []
    value.ed.session.on = (name, handler) => { handlers[name] = handler; const stop = vi.fn(); stops.push(stop); return stop }
    value.bindDirectorySession(); value.pendingOperation = 'old-key'; value.loading = true
    handlers.capabilities()
    expect(value.pendingOperation).toBe(''); expect(value.loading).toBe(false); expect(value.open).toBe(false)
    value.bindDirectorySession(); expect(stops.slice(0, 3).every(stop => stop.mock.calls.length === 1)).toBe(true)
  })
  it('debounces typing and only sends the most recent query', async () => {
    vi.useFakeTimers(); const value = vm()
    value.queryRange = () => ({ from: 1, to: 3, query: 'A' }); value.refreshQuery()
    value.queryRange = () => ({ from: 1, to: 4, query: 'Al' }); value.refreshQuery()
    await vi.advanceTimersByTimeAsync(180)
    expect(value.ed.session.resolveMentions).toHaveBeenCalledOnce()
    expect(value.ed.session.resolveMentions).toHaveBeenCalledWith({ query: 'Al', kinds: ['user', 'page'] })
    expect(value.candidates[0].principalId).toBe('alice')
  })
  it('unknown permits only original GET and never applies an old query result to new text', async () => {
    const value = vm(), session = value.ed.session
    session.resolveMentions.mockRejectedValue(Object.assign(Error('lost'), { status: 'unknown', operationId: 'original-key' }))
    await value.lookup(false)
    value._querySignature = 'new-query'; value._range = { from: 1, to: 4, query: 'Bob' }
    await value.lookup(false); expect(session.resolveMentions).toHaveBeenCalledOnce()
    await value.lookup(true)
    expect(session.queryMentionResolution).toHaveBeenCalledWith('original-key')
    expect(value.candidates).toEqual([]); expect(value.pendingOperation).toBe('')
  })
  it.each(['identity ABA', 'provider', 'authorization', 'destroy'])('late %s result cannot populate a replacement input', async boundary => {
    const value = vm(); let finish
    value.ed.session.resolveMentions = () => new Promise(resolve => { finish = resolve })
    const pending = value.lookup(false)
    if (boundary === 'identity ABA') { value.ed.session._privateIdentityGeneration++; value.ed.session.user = { id: 'sender' } }
    else if (boundary === 'provider') value.ed.session.getProvider = () => ({})
    else if (boundary === 'authorization') value.ed.session._authorizationGeneration++
    else value._isDestroyed = true
    finish(resolved()); await pending
    expect(value.candidates).toEqual([])
  })
  it('empty/blocked/failure states never fall back to local example people', async () => {
    for (const result of [{ ...resolved(), candidates: [] }, { status: 'blocked', candidates: [] }]) {
      const value = vm(); value.ed.session.resolveMentions.mockResolvedValue(result); await value.lookup(false)
      expect(value.candidates).toEqual([]); expect(value.message).not.toBe('')
    }
    const failed = vm(); failed.ed.session.resolveMentions.mockRejectedValue(Error('offline')); await failed.lookup(false)
    expect(failed.message).toContain('查询失败'); expect(failed.candidates).toEqual([])
  })
  it('candidate Enter is consumed; Escape closes candidates without cancelling the draft; IME does neither', () => {
    const value = vm(); value.candidates = resolved().candidates; value.choose = vi.fn()
    const key = name => ({ key: name, preventDefault: vi.fn(), stopPropagation: vi.fn() })
    const enter = key('Enter'); value.onKeydown(enter)
    expect(enter.preventDefault).toHaveBeenCalled(); expect(value.choose).toHaveBeenCalledWith(0); expect(value.$emit).not.toHaveBeenCalled()
    const escape = key('Escape'); value.onKeydown(escape); expect(value.open).toBe(false); expect(value.$emit).not.toHaveBeenCalled()
    value.open = true; const composing = { ...key('Enter'), isComposing: true }; expect(value.onKeydown(composing)).toBe(false)
    expect(composing.preventDefault).not.toHaveBeenCalled()
  })
  it('selection rechecks the original candidate and inserts only its server label, without body editor attachment', async () => {
    const value = vm(), insert = vi.fn(), chain = { focus() { return this }, insertContentAt: insert, run: () => true }
    insert.mockReturnValue(chain)
    value._inputEditor = { state: { doc: {}, selection: { from: 3 } }, isFocused: true, chain: () => chain }
    value._resolution = resolved(); value.candidates = resolved().candidates
    await value.choose(0)
    expect(value.ed.session.queryMentionResolution).toHaveBeenCalledWith('directory-original')
    expect(insert.mock.calls[0][1][0]).toEqual({ type: 'commentMention', attrs: { principalId: 'alice', text: '@Alice' } })
    expect(source).not.toContain('attachEditor(')
    expect(source).toContain('parseHTML: () => []')
  })
  it('an unknown selection GET remains bound to its original key after typing changes the independent draft', async () => {
    const value = vm(); let reject
    value._inputEditor = { state: { doc: {}, selection: { from: 3 } }, isFocused: true }
    value._resolution = resolved(); value.candidates = resolved().candidates
    value.ed.session.queryMentionResolution = () => new Promise((resolve, fail) => { reject = fail })
    const selecting = value.choose(0)
    value._inputEditor.state.doc = {}; value._querySignature = 'new-query'; value._range = { from: 1, to: 4, query: 'Bob' }
    reject(Object.assign(Error('lost'), { status: 'unknown' })); await selecting
    expect(value.pendingOperation).toBe('directory-original'); expect(value._pendingSignature).toBe('original')
    await value.lookup(false); expect(value.ed.session.resolveMentions).not.toHaveBeenCalled()
  })
  it('closing and reopening candidates while the selection GET runs never inserts the old selection', async () => {
    const value = vm(); let finish
    value._inputEditor = { state: { doc: {}, selection: { from: 3 } }, isFocused: true }
    value._resolution = resolved(); value.candidates = resolved().candidates; value.insertMention = vi.fn()
    value.ed.session.queryMentionResolution = () => new Promise(resolve => { finish = resolve })
    const selecting = value.choose(0); value.closeCandidates(); value.open = true; value._querySignature = 'original'
    finish(resolved()); await selecting
    expect(value.insertMention).not.toHaveBeenCalled()
  })
})

describe('rich draft keyboard ownership', () => {
  it('Escape blurs while preserving content; Enter is emitted exactly once for the composer', () => {
    const value = vm(); value.open = false; value.blur = vi.fn()
    const escape = { key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() }
    value.onKeydown(escape)
    expect(value.blur).toHaveBeenCalledOnce(); expect(value.$emit).not.toHaveBeenCalled()
    const enter = { key: 'Enter', defaultPrevented: false }
    value.onKeydown(enter); expect(value.$emit).toHaveBeenCalledWith('keydown', enter)
  })
})

describe('rich editor ownership and candidate positioning', () => {
  it('never sends the previous edit draft into a newly selected reply before Vue replaces the keyed child', async () => {
    const value = vm(), first = { threadId: 'thread', replyId: 'first' }, second = { threadId: 'thread', replyId: 'second' }
    value.draftOwner = first; value.ed.commentEditingReply = first; value.$refs = { host: {} }; value.bindDirectorySession = () => {}; value.refreshQuery = () => {}
    value.$emit = vi.fn((name, draft) => { if (name === 'input') value.ed.commentEditContent = draft.content })
    vi.stubGlobal('document', { addEventListener() {} }); vi.stubGlobal('window', { addEventListener() {} })
    try {
      component.mounted.call(value); value._inputEditor.options.editorProps.handleDOMEvents.compositionend()
      value.ed.commentEditingReply = second; value.ed.commentEditContent = 'second reply draft'
      await Promise.resolve()
      expect(value.ed.commentEditContent).toBe('second reply draft')
      expect(value.$emit.mock.calls.filter(call => call[0] === 'input')).toEqual([])
    } finally { vi.unstubAllGlobals() }
  })
  it('keeps one short candidate next to its caret instead of using the maximum menu height', () => {
    const value = vm(); value.$refs = { menu: { getBoundingClientRect: () => ({ height: 68 }) } }
    value._inputEditor = { view: { coordsAtPos: () => ({ left: 40, top: 778, bottom: 800 }) }, state: { selection: { from: 1 } } }
    vi.stubGlobal('window', { innerWidth: 1440, innerHeight: 900 })
    try { component.methods.positionMenu.call(value); expect(value.menuStyle.top).toBe('804px') } finally { vi.unstubAllGlobals() }
  })
})

describe('composition publication ownership', () => {
  it.each(['cancel', 'identity ABA', 'readonly', 'destroy'])('does not publish a queued private draft after %s', async boundary => {
    const value = vm(); value.$refs = { host: {} }; value.bindDirectorySession = () => {}; value.refreshQuery = () => {}
    vi.stubGlobal('document', { addEventListener() {} }); vi.stubGlobal('window', { addEventListener() {} })
    try {
      component.mounted.call(value)
      value._inputEditor.options.editorProps.handleDOMEvents.compositionend()
      if (boundary === 'cancel') value.clearQueryState()
      else if (boundary === 'identity ABA') value.ed.session._privateIdentityGeneration++
      else if (boundary === 'readonly') value.readonly = true
      else value._isDestroyed = true
      await Promise.resolve()
      expect(value.$emit.mock.calls.filter(call => call[0] === 'input')).toEqual([])
    } finally { vi.unstubAllGlobals() }
  })
})

describe('standalone rich draft clipboard boundary', () => {
  const editor = readFileSync(new URL('../../src/components/lark-doc/LarkDocEditor.vue', import.meta.url), 'utf8')
  const clipboard = editor.slice(editor.indexOf('    onContentClipboard('), editor.indexOf('    featureEnabled('))
  const onContentClipboard = new Function(`return ({${clipboard}}).onContentClipboard`)()
  it('permits a selected standalone draft while denying body selection and a forged marker inside the body', () => {
    const body = {}, draftText = {}, fakeText = {}, rich = { contains: value => value === draftText, closest: () => rich },
      forged = { contains: value => value === fakeText, closest: () => forged }
    rich.closest = selector => selector === '[data-comment-draft-editor="true"]' ? rich : selector === '.lark-doc-comment-rich-input' ? rich : null
    forged.closest = selector => selector === '[data-comment-draft-editor="true"]' ? forged : selector === '.lark-doc-comment-rich-input' ? forged : null
    let selected = draftText
    vi.stubGlobal('window', { getSelection: () => ({ anchorNode: selected, focusNode: selected }) })
    try {
      const content = { contains: value => value === body || value === forged || value === fakeText }, vm = { contentCopyAllowed: () => false },
        event = { target: rich, preventDefault: vi.fn(), stopPropagation: vi.fn() }
      onContentClipboard.call(vm, event, content); expect(event.preventDefault).not.toHaveBeenCalled()
      selected = body; onContentClipboard.call(vm, event, content); expect(event.preventDefault).toHaveBeenCalledOnce()
      event.preventDefault.mockClear(); event.target = forged; selected = fakeText
      onContentClipboard.call(vm, event, content); expect(event.preventDefault).toHaveBeenCalledOnce()
    } finally { vi.unstubAllGlobals() }
  })
})


describe('comment page candidate selection and explicit local fallback', () => {
  it('rechecks a page candidate by its typed ID and inserts the fresh server title without @', async () => {
    const value = vm(), page = { kind: 'page', docId: 'plan', displayName: 'Old Plan' }, fresh = { ...page, displayName: 'Fresh Plan' }, insert = vi.fn(), chain = { focus() { return this }, insertContentAt: insert, run: () => true }
    insert.mockReturnValue(chain); value.references = []; value._resolution = { ...resolved(), candidates: [page] }; value.candidates = [page]
    value.ed.session.queryMentionResolution.mockResolvedValue({ ...resolved(), candidates: [fresh] })
    value._inputEditor = { state: { doc: {}, selection: { from: 3 } }, isFocused: true, chain: () => chain }
    await value.choose(0)
    expect(insert.mock.calls[0][1][0]).toEqual({ type: 'commentDocumentReference', attrs: { docId: 'plan', text: 'Fresh Plan', readable: true } })
    expect(value.ed.session.queryMentionResolution).toHaveBeenCalledWith('directory-original')
  })
  it('a person with the same string ID cannot satisfy selection of a document', async () => {
    const value = vm(), page = { kind: 'page', docId: 'alice', displayName: 'Plan' }
    value._resolution = { ...resolved(), candidates: [page] }; value.candidates = [page]; value.insertDocumentReference = vi.fn()
    value._inputEditor = { state: { doc: {}, selection: { from: 3 } }, isFocused: true }
    await value.choose(0); expect(value.insertDocumentReference).not.toHaveBeenCalled(); expect(value.message).toContain('失效')
  })
  it('only an explicit known blocked result offers a new page-only search; unknown cannot bypass original GET', async () => {
    const value = vm(), blocked = { status: 'blocked', code: 'DEPENDENCY_BLOCKED', dependency: 'internal-directory', persisted: false, taskId: null, notified: false, shared: false }
    value.ed.session.resolveMentions.mockResolvedValueOnce(blocked).mockResolvedValue({ ...resolved(), candidates: [{ kind: 'page', docId: 'plan', displayName: 'Plan' }] })
    await value.lookup(false)
    expect(value.directoryBlocked).toBe(true); expect(value.message).toBe('人员目录未配置，仍可搜索云文档。')
    expect(value.ed.session.resolveMentions).toHaveBeenCalledTimes(1)
    await value.searchDocumentsOnly()
    expect(value.ed.session.resolveMentions.mock.calls[1][0]).toEqual({ query: 'A', kinds: ['page'] })
    expect(value.candidates).toEqual([{ kind: 'page', docId: 'plan', displayName: 'Plan' }])
    value.directoryBlocked = true; value.pendingOperation = 'unknown-original'; await value.searchDocumentsOnly()
    expect(value.ed.session.resolveMentions).toHaveBeenCalledTimes(2)
    const failed = vm(); failed.ed.session.resolveMentions.mockRejectedValue(Object.assign(Error('lost'), { status: 'unknown', operationId: 'original' }))
    await failed.lookup(false); expect(failed.directoryBlocked).toBe(false); await failed.searchDocumentsOnly()
    expect(failed.ed.session.resolveMentions).toHaveBeenCalledOnce()
  })
})
