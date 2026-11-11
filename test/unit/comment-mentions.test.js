import { describe, expect, it } from 'vitest'
import { normalizeCommentMentions, commentDraftDocument, serializeCommentDocument, commentMentionSegments } from '../../src/core/comments/mentions'
import commentsMixin from '../../src/components/lark-doc/editor/commentsMixin'
import { commentPanelMethods, commentPanelComputed } from '../../src/components/lark-doc/editor/commentPanelView'
import { normalizeReply } from '../../src/core/comments/thread'

describe('comment mention UTF-16 metadata and safe text projections', () => {
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
})


describe('whole document reply action uses the shared rich composer', () => {
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
    const vm = {commentAuthor:{id:'alice'},commentDocumentDraft:content,commentDocumentMentions:mentions,commentDraftImages:()=>[],commentDocumentCanSubmit:()=>true,
      createDocumentComment:async(...args)=>{calls.push(args);return {}},cancelDocumentCommentDraft() {}}
    await commentsMixin.methods.submitDocumentComment.call(vm,'private')
    expect(calls[0]).toEqual([content,'private',['bob'],mentions])
    await commentsMixin.methods.submitDocumentComment.call(vm,'document')
    expect(calls[1]).toEqual([content,'document',[],mentions])
  })
})
