import { afterEach, describe, expect, it, vi } from 'vitest'
import { commentDraftDocument, serializeCommentDocument, normalizeCommentReferences, normalizeCommentMetadata, commentMentionSegments } from '../../src/core/comments/mentions'
import { normalizeReply } from '../../src/core/comments/thread'
import { openCommentDocumentTarget, commentPanelMethods } from '../../src/components/lark-doc/editor/commentPanelView'

afterEach(() => vi.unstubAllGlobals())

describe('comment document references share exact UTF-16 text without becoming recipients', () => {
  it('round trips mixed atoms, astral characters, whitespace and line breaks', () => {
    const content = '😀 @Alice 文档\n另', mentions = [{ principalId: 'alice', from: 3, to: 9 }], references = [{ docId: 'plan', from: 10, to: 12 }]
    const doc = commentDraftDocument(content, mentions, references)
    expect(doc.content[0].content.find(node => node.type === 'commentDocumentReference').attrs).toMatchObject({ docId: 'plan', text: '文档' })
    expect(serializeCommentDocument(doc)).toEqual({ content, mentions, references })
    expect(serializeCommentDocument(commentDraftDocument('@Alice', [{ principalId: 'alice', from: 0, to: 6 }]))).not.toHaveProperty('references')
    expect(serializeCommentDocument(commentDraftDocument('文档')).references).toBeUndefined()
  })
  it('strips client title/readability from wire metadata and only projects exact server titles', () => {
    const reference = { docId: 'plan', from: 0, to: 4, displayName: 'Plan', readable: false }
    expect(normalizeCommentReferences('Plan', [reference])).toEqual([{ docId: 'plan', from: 0, to: 4 }])
    expect(commentMentionSegments('Plan', [], [reference])).toEqual([{ ...reference, text: 'Plan' }])
    expect(commentMentionSegments('Plan', [], [{ ...reference, displayName: 'Forged' }])).toEqual([{ text: 'Plan' }])
    expect(() => normalizeCommentReferences('@Plan', [{ ...reference, to: 5 }], true)).toThrow()
    expect(serializeCommentDocument(commentDraftDocument('Plan', [], [reference])).references[0].readable).toBe(false)
    expect(normalizeReply({ content: 'Plan', references: [reference] }).references).toEqual([reference])
  })
  it('rejects overlap across both collections, split surrogate boundaries and a combined count above 100', () => {
    expect(() => normalizeCommentMetadata('@Alice', [{ principalId: 'alice', from: 0, to: 6 }], [{ docId: 'plan', from: 1, to: 4 }])).toThrow('OVERLAP')
    expect(() => normalizeCommentReferences('😀', [{ docId: 'plan', from: 0, to: 1 }])).toThrow()
    const content = '@A '.repeat(101), mentions = Array.from({ length: 51 }, (_, index) => ({ principalId: 'a', from: index * 3, to: index * 3 + 2 })),
      references = Array.from({ length: 50 }, (_, index) => ({ docId: 'plan', from: (index + 51) * 3, to: (index + 51) * 3 + 2 }))
    expect(() => normalizeCommentMetadata(content, mentions, references)).toThrow('OVERLAP')
    expect(commentMentionSegments('@Alice', [{ principalId: 'alice', from: 0, to: 6, displayName: 'Alice' }], [{ docId: 'plan', from: 1, to: 6, displayName: 'Alice', readable: true }])).toEqual([{ text: '@Alice' }])
  })
})

function navigation() {
  const business = {}, session = { documentId: 'source', user: { id: 'alice' }, _privateIdentityGeneration: 1, _authorizationGeneration: 1, getProvider: () => business },
    ed = { session, commentCan: () => true, commentOperationCurrent: () => () => ed.session === session, commentMessage: '' }
  vi.stubGlobal('window', { location: { href: 'https://app.example/docs/source' }, open: vi.fn() })
  return { ed, business, session }
}

describe('document reference navigation uses an actual host entry only', () => {
  it.each(['https://app.example/docs/source', 'https://app.example/editor/v1/tenants/t/documents/target', 'https://other.example/docs/target', 'javascript:alert(1)'])('refuses unsafe or false target mapper %s', async url => {
    const { ed, business } = navigation(); business.getDocumentUrl = () => url
    expect(await openCommentDocumentTarget(ed, 'target')).toBe(false); expect(window.open).not.toHaveBeenCalled()
  })
  it('opens the configured same-origin document page and never invents a URL when no entry exists', async () => {
    const { ed, business } = navigation()
    expect(await openCommentDocumentTarget(ed, 'target')).toBe(false); expect(window.open).not.toHaveBeenCalled(); expect(ed.commentMessage).not.toBe('')
    business.getDocumentUrl = () => 'https://app.example/docs/target'
    expect(await openCommentDocumentTarget(ed, 'target')).toBe(true)
    expect(window.open).toHaveBeenCalledWith('https://app.example/docs/target', '_blank', 'noopener')
  })
  it('dispatches only canonical IDs to an existing callback and requires explicit handling acknowledgement', async () => {
    const { ed } = navigation(); ed.onDocumentAction = vi.fn(async () => true)
    expect(await openCommentDocumentTarget(ed, 'target')).toBe(true)
    expect(ed.onDocumentAction).toHaveBeenCalledWith({ action: 'open-document-reference', target: 'document', documentId: 'target', sourceDocumentId: 'source', actorId: 'alice' })
    expect(Object.isFrozen(ed.onDocumentAction.mock.calls[0][0])).toBe(true)
    ed.onDocumentAction.mockResolvedValue(undefined); expect(await openCommentDocumentTarget(ed, 'target')).toBe(false)
    expect(await openCommentDocumentTarget(ed, 'https://evil.example')).toBe(false)
    expect(ed.onDocumentAction).toHaveBeenCalledTimes(2)
  })
  it('does not accept a late old-identity host acknowledgement', async () => {
    const { ed, session } = navigation(); let finish
    ed.onDocumentAction = () => new Promise(resolve => { finish = resolve })
    const pending = openCommentDocumentTarget(ed, 'target'); session._privateIdentityGeneration++; finish(true)
    expect(await pending).toBe(false); expect(ed.commentMessage).toBe('')
  })
  it('rejects an old rendered span after the current reply metadata changed, while unreadable is a visual state', async () => {
    const { ed } = navigation(), reference = { docId: 'target', from: 0, to: 4, displayName: 'Plan', readable: false, text: 'Plan' }
    ed.onDocumentAction = vi.fn(async () => true); ed.commentThreads = [{ id: 'thread', replies: [{ id: 'reply', content: 'Plan', mentions: [], references: [reference] }] }]
    expect(await commentPanelMethods.openCommentDocumentReference.call({ ed }, 'thread', 'reply', reference)).toBe(true)
    ed.commentThreads[0].replies[0].references = []
    expect(commentPanelMethods.openCommentDocumentReference.call({ ed }, 'thread', 'reply', reference)).toBe(false)
    expect(ed.onDocumentAction).toHaveBeenCalledOnce()
  })
})
