import { describe, expect, it, vi } from 'vitest'
import { normalizeCommentMentions, commentDraftDocument, serializeCommentDocument, commentMentionSegments, commentRichContentSegments } from '../../src/core/comments/mentions'
import commentsMixin from '../../src/components/lark-doc/editor/commentsMixin'
import { commentPanelMethods, commentPanelComputed } from '../../src/components/lark-doc/editor/commentPanelView'
import { normalizeReply } from '../../src/core/comments/thread'
import { createMemoryCommentsProvider } from '../../src/core/comments/memory-provider'

describe('document mention lookup state', () => {
  it.each(['document', 'reply'])('queries the original unknown %s operation without another submit', async scope => {
    const resolveMentions = vi.fn(async () => { throw Object.assign(new Error('lost response'), { operationId: 'mention-original', status: 'unknown' }) })
    const queryMentionResolution = vi.fn(async () => ({ status: 'resolved', operationId: 'mention-original', candidates: [{ principalId: 'bob', displayName: 'Bob' }] }))
    const vm = { ...commentsMixin.data(), ...commentsMixin.methods, commentRemote: true, commentCan: () => true, commentAllowed: () => true, session: { resolveMentions, queryMentionResolution } }
    await (scope === 'document' ? vm.updateDocumentMentionPicker('document', '@Bo', 3) : vm.updateCommentMentionPicker('thread', '@Bo', 3))
    expect(vm.commentMentionPicker.status).toBe('unknown')
    await vm.retryCommentMentionPicker(scope === 'document' ? 'document' : 'reply/thread')
    expect(queryMentionResolution).toHaveBeenCalledWith({ operationId: 'mention-original' }); expect(resolveMentions).toHaveBeenCalledOnce()
    expect(vm.commentMentionPicker.status).toBe('ready')
  })
  it('discards a retry after cancellation or provider authority changes', async () => {
    let finish
    const pending = new Promise(resolve => { finish = resolve })
    const vm = { ...commentsMixin.data(), ...commentsMixin.methods, commentRemote: true, commentCan: () => true, session: { resolveMentions: () => pending, _authorizationGeneration: 1 } }
    const request = vm.updateDocumentMentionPicker('document', '@Bo', 3)
    const token = vm.commentMentionPicker; vm.session._authorizationGeneration++
    finish({ status: 'resolved', candidates: [{ principalId: 'secret', displayName: 'Old result' }] })
    expect(await request).toBeNull(); expect(token.candidates).toEqual([])
    vm.commentMentionPicker = null
    expect(await token.retry()).toBeNull()
  })
  it('exposes lookup loading and failure while retaining the query for an explicit retry', async () => {
    let reject
    const pending = new Promise((_, fail) => { reject = fail })
    const vm = { ...commentsMixin.data(), ...commentsMixin.methods, commentRemote: true, commentCan: () => true,
      session: { resolveMentions: vi.fn(() => pending) } }
    const request = vm.updateDocumentMentionPicker('document', '@Bo', 3)
    expect(vm.commentMentionPicker.status).toBe('loading')
    reject(new Error('unavailable')); await request
    expect(vm.commentMentionPicker.status).toBe('error')
    expect(vm.commentMentionPicker.query).toBe('Bo')
  })
})

describe('comment mention UTF-16 metadata and safe text projections', () => {
  it('rich reference navigation matches authoritative UTF-16 metadata before invoking the host', async () => {
    const content = '@Bob Plan', mentions = [{ principalId: 'bob', from: 0, to: 4 }], references = [{ docId: 'plan', from: 5, to: 9 }], calls = []
    const reference = commentRichContentSegments(commentDraftDocument(content, mentions, references)).find(value => value.docId)
    const ed = { session: { documentId: 'source', user: { id: 'alice' } }, commentCan: () => true, commentOperationCurrent: () => () => true,
      commentThreads: [{ id: 'thread', replies: [{ id: 'reply', content, mentions, references }] }], onDocumentAction: async input => { calls.push(input); return true } }
    expect(await commentPanelMethods.openCommentDocumentReference.call({ ed }, 'thread', 'reply', reference)).toBe(true)
    expect(calls[0]).toMatchObject({ action: 'open-document-reference', documentId: 'plan' })
    expect(commentPanelMethods.openCommentDocumentReference.call({ ed }, 'thread', 'reply', { ...reference, from: 0 })).toBe(false)
    expect(calls).toHaveLength(1)
  })
  it('local UI reaction gate and write include the current actor and support removal', async () => {
    const provider = createMemoryCommentsProvider(), author = { id: 'alice' }
    const thread = await provider.createThread({ blockId: 'b1', author, content: 'text' })
    const ed = { ...commentsMixin.data(), ...commentsMixin.methods, commentThreads: [thread], commentAuthor: author,
      commentProvider: () => provider, commentCan: () => true, commentOperationCurrent: () => () => true,
      runCommentWrite: (method, input) => provider[method](input) }
    expect(ed.commentAllowed('react', thread.id, thread.replies[0].id)).toBe(true)
    await commentPanelMethods.setCommentReaction.call({ ed }, thread.id, thread.replies[0].id, '👍', true)
    expect((await provider.list())[0].replies[0].reactions[0].users).toEqual(['alice'])
    await commentPanelMethods.setCommentReaction.call({ ed }, thread.id, thread.replies[0].id, '👍', false)
    expect((await provider.list())[0].replies[0].reactions).toEqual([])
  })
  it('rich projection preserves mention/reference text, hard breaks and paragraph boundaries', () => {
    const content = '  @Bob\nPlan  '
    const document = commentDraftDocument(content, [{ principalId: 'bob', from: 2, to: 6 }], [{ docId: 'plan', from: 7, to: 11, readable: false }])
    const segments = commentRichContentSegments(document)
    expect(segments.map(value => value.text).join('')).toBe(content)
    expect(segments.find(value => value.docId)).toMatchObject({ text: 'Plan', docId: 'plan', readable: false, from: 7, to: 11 })
    expect(commentRichContentSegments({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }, { type: 'paragraph' }, { type: 'paragraph', content: [{ type: 'text', text: 'B' }] }] }).map(value => value.text).join('')).toBe('A\n\nB')
  })
  it.each([false, true])('save edit supplies current author only to a local provider (remote=%s)', async remote => {
    let sent
    const vm = { ...commentsMixin.data(), ...commentsMixin.methods, commentAuthor: { id: 'alice' }, commentEditingReply: { threadId: 'thread', replyId: 'reply' },
      commentEditContent: 'changed', commentAllowed: () => true, commentDraftImages: () => [], commentProvider: () => ({ isRemote: remote }),
      runCommentWrite: async (_method, input) => { sent = input; return null } }
    await vm.saveEditedComment()
    expect(sent.author).toEqual(remote ? undefined : { id: 'alice' })
  })
  it('choosing a reply mention shifts following references and ignores edit scopes', () => {
    const vm = { ...commentsMixin.data(), ...commentsMixin.methods, commentAllowed: () => true, $set: (object, key, value) => { object[key] = value } }
    vm.setCommentDraft('thread', '@B Plan', [], [{ docId: 'plan', from: 3, to: 7 }])
    vm.commentMentionPicker = { threadId: 'thread', from: 0, to: 2 }
    expect(vm.chooseCommentMention({ principalId: 'bob', displayName: 'Bob' })).toBe(true)
    expect(vm.commentDrafts.thread).toBe('@Bob Plan')
    expect(vm.commentDraftReferences.thread).toEqual([{ docId: 'plan', from: 5, to: 9 }])
    vm.commentMentionPicker = { scope: 'edit/thread/reply', threadId: 'thread', from: 0, to: 2 }
    expect(vm.chooseCommentMention({ principalId: 'alice', displayName: 'Alice' })).toBe(false)
  })
  it.each(['mention', 'reference'])('edit scope resolves %s without mutating the document composer', async kind => {
    const candidate = kind === 'mention' ? { principalId: 'bob', displayName: 'Bob' } : { docId: 'plan', displayName: 'Plan', readable: true }
    const value = kind === 'mention' ? '@Bo' : '[[Plan'
    const vm = { ...commentsMixin.data(), ...commentsMixin.methods, commentRemote: true, commentCan: () => true,
      commentDocumentDraft: 'unchanged', commentEditContent: value,
      $set: (object, key, next) => { object[key] = next },
      session: { resolveMentions: async () => ({ status: 'resolved', candidates: [candidate] }) },
      onDocumentAction: async () => ({ status: 'resolved', candidates: [candidate] }) }
    await vm.updateDocumentMentionPicker('edit/thread/reply', value, value.length)
    expect(vm.commentMentionPicker?.candidates).toEqual([candidate])
    expect(vm.chooseDocumentMention(candidate)).toBe(true)
    expect(vm.commentDocumentDraft).toBe('unchanged')
    expect(vm.commentEditContent).toBe(kind === 'mention' ? '@Bob' : 'Plan')
    expect(kind === 'mention' ? vm.commentEditMentions : vm.commentEditReferences).toEqual([kind === 'mention' ? { principalId: 'bob', from: 0, to: 4 } : { docId: 'plan', from: 0, to: 4 }])
  })
  it.each(['mentions', 'references'])('reply preserves whitespace and UTF-16 offsets with %s', async field => {
    const content = field === 'mentions' ? '  @Bob  ' : '  Plan  '
    let sent
    const metadata = field === 'mentions' ? { principalId: 'bob', from: 2, to: 6 } : { docId: 'plan', from: 2, to: 6 }
    const vm = { ...commentsMixin.data(), ...commentsMixin.methods, commentDrafts: { thread: content }, commentAllowed: () => true,
      commentDraftImages: () => [], clearCommentDraft() {}, runCommentWrite: async (_method, input) => { sent = input; return {} } }
    vm[field === 'mentions' ? 'commentDraftMentions' : 'commentDraftReferences'].thread = [metadata]
    await vm.submitCommentDraft('thread')
    expect(sent.content).toBe(content)
    expect(sent[field]).toEqual([metadata])
  })
  it('reply draft @ lookup selects a directory candidate and submits structured metadata', async () => {
    const vm = { ...commentsMixin.data(), ...commentsMixin.methods, commentRemote: true, commentAuthor: { id: 'alice', name: 'Alice' },
      commentThreads: [{ id: 'thread', capabilities: { canReply: true }, replies: [] }], commentAllowed: action => action === 'reply',
      $set: (object, key, value) => { object[key] = value }, session: { resolveMentions: async () => ({ status: 'resolved', candidates: [{ principalId: 'bob', displayName: 'Bob' }] }) } }
    vm.setCommentDraft('thread', '@Bo')
    await vm.updateCommentMentionPicker('thread', '@Bo', 3)
    expect(vm.commentMentionPicker.candidates).toEqual([{ principalId: 'bob', displayName: 'Bob' }])
    expect(vm.chooseCommentMention(vm.commentMentionPicker.candidates[0])).toBe(true)
    expect(vm.commentDrafts.thread).toBe('@Bob')
    expect(vm.commentDraftMentions.thread).toEqual([{ principalId: 'bob', from: 0, to: 4 }])
  })
  it.each(['mention', 'reference'])('cancelling the document draft invalidates pending %s candidates', async kind => {
    let finish
    const lookup = new Promise(resolve => { finish = resolve })
    const vm = { ...commentsMixin.data(), ...commentsMixin.methods, commentRemote: true, commentCan: () => true,
      clearCommentDraftImages: vi.fn(), session: { resolveMentions: () => lookup }, onDocumentAction: () => lookup }
    const value = kind === 'mention' ? '@Bo' : '[[Plan'
    vm.setCommentDocumentDraft(value)
    const pending = vm.updateDocumentMentionPicker('document', value, value.length)
    vm.cancelDocumentCommentDraft()
    expect(vm.commentMentionPicker).toBeNull()
    finish({ status: 'resolved', candidates: [kind === 'mention' ? { principalId: 'bob', displayName: 'Bob' } : { docId: 'plan', displayName: 'Plan', readable: true }] })
    expect(await pending).toBeNull()
    expect(vm.commentDocumentDraft).toBe('')
    const otherScope = { scope: 'edit/thread/reply', candidates: [] }
    vm.commentMentionPicker = otherScope; vm.cancelDocumentCommentDraft()
    expect(vm.commentMentionPicker).toBe(otherScope)
  })
  it('document composer [[ lookup resolves a host document candidate and stores reference metadata', async () => {
    const vm = { ...commentsMixin.data(), ...commentsMixin.methods, commentRemote: true, commentCan: () => true,
      $set: (object, key, value) => { object[key] = value }, session: { documentId: 'source', user: { id: 'alice' } },
      onDocumentAction: async input => input.action === 'resolve-document-references' ? { status: 'resolved', candidates: [{ docId: 'plan', displayName: 'Plan', readable: true }] } : false }
    vm.setCommentDocumentDraft('[[Plan')
    await vm.updateDocumentMentionPicker('document', '[[Plan', 6)
    expect(vm.commentMentionPicker.kind).toBe('reference')
    expect(vm.chooseDocumentMention(vm.commentMentionPicker.candidates[0])).toBe(true)
    expect(vm.commentDocumentDraft).toBe('Plan')
    expect(vm.commentDocumentReferences).toEqual([{ docId: 'plan', from: 0, to: 4 }])
  })
  it('preserves whitespace, hard breaks, astral text and repeated targets without regex inference', () => {
    const content = '  😀 @Alice\n@Alice  ', mentions = [{ principalId: 'alice', from: 5, to: 11 }, { principalId: 'alice', from: 12, to: 18 }]
    expect(serializeCommentDocument(commentDraftDocument(content, mentions))).toEqual({ content, mentions })
    expect(serializeCommentDocument(commentDraftDocument('@alice typed manually')).mentions).toEqual([])
  })
  it.each([
    [{ principalId: 'alice', from: -1, to: 3 }],
    [{ principalId: 'alice', from: 0, to: 2 }],
    [{ principalId: 'alice', from: 1, to: 4 }],
    [{ principalId: 'alice', from: 3, to: 20 }],
    [{ principalId: 'bad\n', from: 3, to: 5 }],
    [{ principalId: 'alice', from: 3, to: 5 }, { principalId: 'bob', from: 3, to: 5 }],
  ])('rejects invalid/split-surrogate/overlapping ranges %j', mentions => {
    expect(() => normalizeCommentMentions('😀 @A', mentions)).toThrow('COMMENT_MENTIONS_INVALID')
  })
  it('outbound DTO strips client labels; safe rendering uses only validated server metadata', () => {
    const content = 'hi @<script>alert(1)</script>', mention = { principalId: 'alice', from: 3, to: content.length, displayName: '<script>alert(1)</script>' }
    expect(normalizeCommentMentions(content, [mention])).toEqual([{ principalId: 'alice', from: 3, to: content.length }])
    expect(commentMentionSegments(content, [mention])).toEqual([{ text: 'hi ' }, { ...mention, text: content.slice(3) }])
    expect(commentMentionSegments(content, [{ ...mention, to: 1000 }])).toEqual([{ text: content }])
    expect(commentMentionSegments('@Bob', [{ principalId: 'alice', from: 0, to: 4, displayName: 'Alice' }])).toEqual([{ text: '@Bob' }])
    expect(commentMentionSegments('@alice', [])).toEqual([{ text: '@alice' }])
  })
  it('normalizing a current reply preserves authoritative metadata rather than dropping chips', () => {
    const mentions = [{ principalId: 'alice', from: 0, to: 6, displayName: 'Alice' }]
    expect(normalizeReply({ content: '@Alice', mentions }).mentions).toEqual(mentions)
  })
  it('preserves richContent for a safe marked-text UI projection', () => {
    const richContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bold', marks: [{ type: 'bold' }] }, { type: 'text', text: ' link', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] }] }] }
    expect(normalizeReply({ id: 'reply', author: { id: 'alice' }, content: richContent }).richContent).toEqual(richContent)
    expect(commentRichContentSegments(richContent)).toEqual([{ text: 'Bold', marks: [{ type: 'bold' }] }, { text: ' link', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] }])
  })
})


describe('whole document reply action uses the shared rich composer', () => {
  it('local reaction users project an active state and selecting it requests removal', () => {
    const calls = [], reply = { id: 'reply', reactions: [{ emoji: '👍', users: ['alice'] }] }, thread = { id: 'thread', replies: [reply] }
    const ed = { commentAuthor: { id: 'alice' }, commentReactionContext: { threadId: 'thread', replyId: 'reply' }, commentThreads: [thread], setCommentReaction: (...args) => calls.push(args) }
    commentPanelMethods.chooseCommentReaction.call({ ed }, '👍')
    expect(calls[0]).toEqual(['thread', 'reply', '👍', false])
    expect(commentPanelMethods.documentControlLabel.call({ ed }, { id: 'thumb', label: '点赞' }, thread, reply)).toBe('取消点赞')
  })
  it('offers the native four hover actions and inserts an author intent without touching a per-thread reply draft', () => {
    const thread = { id: 'thread', visibility: 'private', replies: [{ id: 'reply', author: { id: 'alice', name: 'Alice' } }] }
    const ed = { commentThreads: [thread], commentCan: () => true, commentAllowed: action => action === 'create' }
    expect(commentPanelComputed.commentReplyControls.call({ documentOnly: true }).map(value => value.id)).toEqual(['thumb', 'document-reply', 'resolve', 'more'])
    expect(commentsMixin.methods.beginDocumentCommentReply.call(ed, 'thread', 'reply')).toBe(true)
    expect(ed.commentDocumentReplyTarget).toEqual({ principalId: 'alice', displayName: 'Alice', visibility: 'private' })
    expect(ed.commentDrafts).toBeUndefined()
    ed.commentAllowed = () => false
    expect(commentsMixin.methods.beginDocumentCommentReply.call(ed, 'thread', 'reply')).toBe(false)
  })
  it('Enter while editing saves, while IME/modifier keys never save', () => {
    let saves = 0; const vm = { ed: { saveEditedComment() { saves++ } } }
    for (const key of [{ key: 'Enter', isComposing: true }, { key: 'Enter', ctrlKey: true }, { key: 'Enter', shiftKey: true }]) commentPanelMethods.onDocumentEditKeydown.call(vm, key)
    expect(saves).toBe(0)
    commentPanelMethods.onDocumentEditKeydown.call(vm, { key: 'Enter', preventDefault() {} })
    expect(saves).toBe(1)
  })
})


describe('explicit private comment audiences', () => {
  it('submits selected targets as an explicit private audience, separately from mention ranges', async () => {
    const content = '@Bob @Bob @Alice', mentions = [{principalId:'bob',from:0,to:4},{principalId:'bob',from:5,to:9},{principalId:'alice',from:10,to:16}], calls=[]
    const vm = {...commentsMixin.methods,commentAuthor:{id:'alice'},commentDocumentDraft:content,commentDocumentMentions:mentions,commentDocumentCanSubmit:()=>true,
      createDocumentComment:async(...args)=>{calls.push(args);return {}},cancelDocumentCommentDraft() {}}
    await commentsMixin.methods.submitDocumentComment.call(vm,'private')
    expect(calls[0]).toEqual([content,'private',['bob'],mentions])
    await commentsMixin.methods.submitDocumentComment.call(vm,'document')
    expect(calls[1]).toEqual([content,'document',[],mentions])
  })
})
