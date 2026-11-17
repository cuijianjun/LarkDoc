// @vitest-environment jsdom
/**
 * P6b-01 评论的**纯 Node 部分** —— requirements/04 §3.1、05 §5.5。
 *
 * 只测不碰 DOM 的三块：
 *   1. `core/blocks/comment.js` —— 收集 / 区间 / 定位 / 高度 / mark 契约；
 *   2. `core/comments/binding.js` —— 块表抽取、协同态探测、重绑（块没了只降级）；
 *   3. `editor/commentsMixin.js` 的导出纯函数 + capability 闸门（用假 `this` 调方法，
 *      不挂 Vue 实例 —— 组件渲染交给浏览器侧用例）。
 *
 * 刻意不测的：面板 DOM、像素、hover 菜单的展开。那部分要靠 jsdom 与真实编辑器，
 * 放进来只会把「逻辑回归」和「视觉回归」搅在一起。
 *
 * 文档对象一律用**最小替身**（只有 `descendants`）：`collectComments` 只承诺读
 * `node.isText / marks / nodeSize / text / pos`，造一个真 ProseMirror 文档要拖进
 * 整张 schema，反而把这条契约测糊了。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LarkDoc } from '../../src/LarkDoc'
import { createDocumentSession } from '../../src/session/DocumentSession'
import { createMemoryCommentsProvider } from '../../src/core/comments/memory-provider'
import { CellSelection } from '@tiptap/pm/tables'
import { applyBlockIdFixes } from '../../src/core/blocks/block-fixes'
import {
  COMMENT_CONTROL_IDS,
  COMMENT_HEIGHTS,
  COMMENT_PANEL,
  COMMENT_REPLY_MENU_IDS,
  LarkDocComment,
  collectComments,
  commentAt,
  commentMarkOf,
  commentPanelHeight,
  commentRanges,
  normalizeComment,
  partitionCommentThreads,
  readComment,
} from '../../src/core/blocks/comment'
import {
  bindThreads,
  collabYdocOf,
  documentBlockIds,
  resolveAnchorCodec,
} from '../../src/core/comments/binding'
import { plainAnchorCodec } from '../../src/core/comments/anchor'
import { commentPanelMethods } from '../../src/components/lark-doc/editor/commentPanelView'
import commentsMixin, {
  COMMENT_GATES,
  commentDraftText,
  commentGate,
  commentRelativeTime,
} from '../../src/components/lark-doc/editor/commentsMixin'

async function withCommentDocument(run, options = {}) {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const provider = options.provider || createMemoryCommentsProvider()
  const session = createDocumentSession({ documentId: 'comments_lifecycle', user: { id: 'comment-owner', name: '我' }, providers: { comments: provider } })
  const thread = await provider.createThread({ blockId: 'comment_body', author: { id: 'comment-owner', name: '我' }, content: '原评论', quote: '评论原文', anchor: options.anchor || { blockId: 'comment_body', offset: 0, length: 4 } })
  const doc = new LarkDoc({ element, session, storage: 'none', ...options.props, content: options.content || '<p data-block-id="comment_body">评论原文</p>' })
  try {
    const host = doc._handle.nativeHost.host
    await host.loadComments()
    return await run({ doc, host, provider, session, thread, reply: thread.replies[0] })
  } finally { doc.destroy(); element.remove() }
}

// A controlled DTO port exercises the real Session/native UI without pretending
// that memory comments implement the remote assets or translation protocols.
const commentAsset = { assetId: 'asset-comment', fileName: 'comment.png', mimeType: 'image/png', sizeBytes: '3', checksum: `sha256:${'a'.repeat(64)}` }
async function withControlledCommentDocument(run, props = {}) {
  const clone = value => JSON.parse(JSON.stringify(value))
  const author = { id: 'comment-owner', name: '我' }
  const thread = { id: 'thread-controlled', docId: 'comments_lifecycle', tenantId: 'tenant1', scope: 'document', visibility: 'document',
    blockId: null, anchor: null, rawAnchor: null, anchorStatus: 'document', threadRevision: '1', creator: author.id, author,
    createdAt: Date.now(), resolved: false, tombstone: false, participants: [],
    capabilities: { canReply: true, canResolve: true, canReopen: false },
    replies: [{ id: 'reply-controlled', author, content: '原评论', createdAt: Date.now(), replyRevision: '1', tombstone: false,
      capabilities: { canEdit: true, canDelete: true, canReact: true } }] }
  const provider = { isRemote: true, list: async () => [clone(thread)], createThread: vi.fn(async () => { throw new Error('fixture create unavailable') }),
    resolve: vi.fn(async () => { thread.resolved = true; thread.capabilities = { canReply: false, canResolve: false, canReopen: true }; return clone(thread) }),
    reopen: vi.fn(async () => { thread.resolved = false; thread.capabilities = { canReply: true, canResolve: true, canReopen: false }; return clone(thread) }),
    reply: vi.fn(async input => { thread.replies.push({ ...thread.replies[0], id: 'reply-saved', content: input.content, ...(input.assetIds?.length ? { attachments: [clone(commentAsset)] } : {}) }); return clone(thread) }),
    editReply: vi.fn(async input => { const reply = thread.replies.find(item => item.id === input.replyId); Object.assign(reply, { content: input.content, replyRevision: String(Number(reply.replyRevision) + 1) }); if (input.assetIds) reply.attachments = input.assetIds.map(() => clone(commentAsset)); return clone(thread) }),
    deleteReply: vi.fn(async input => { const reply = thread.replies.find(item => item.id === input.commentId); reply.tombstone = true; reply.content = ''; return clone(thread) }),
    getFollowPreference: async () => ({ following: false, muted: false, preferenceRevision: '1' }),
  }
  const element = document.createElement('div'); document.body.appendChild(element)
  const session = createDocumentSession({ documentId: 'comments_lifecycle', user: author, comments: provider })
  const doc = new LarkDoc({ element, session, storage: 'none', content: '<p data-block-id="comment_body">评论原文</p>', ...props })
  const createUrl = Object.getOwnPropertyDescriptor(URL, 'createObjectURL'), revokeUrl = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:comment-image') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  try { const host = doc._handle.nativeHost.host; await host.loadComments(); return await run({ doc, host, provider, session, thread, reply: thread.replies[0] }) }
  finally {
    doc.destroy(); element.remove()
    for (const [key, descriptor] of [['createObjectURL', createUrl], ['revokeObjectURL', revokeUrl]]) { if (descriptor) Object.defineProperty(URL, key, descriptor); else delete URL[key] }
  }
}
const readyCommentAsset = () => ({ status: 'committed', ready: true, assetId: commentAsset.assetId, asset: { ...commentAsset, ready: true } })
const imageEvent = (...files) => ({ target: { value: 'chosen', files } })
const commentAssets = uploadCommentImage => ({ uploadCommentImage, begin() {}, complete() {}, getStatus() {}, async getContent() { throw new Error('fixture bytes unavailable') } })

async function commentReplyInput() {
  return vi.waitFor(() => {
    const input = document.querySelector('.lark-doc-comment-panel:not(.lark-doc-comment-composer) .lark-doc-comment-input-zone')
    expect(input).not.toBeNull()
    return input
  })
}

describe('评论剩余闭环', () => {
  describe('rich comment submit shortcuts', () => {
    const rangeGeometry = ['getClientRects', 'getBoundingClientRect'].map(name => [name, Object.getOwnPropertyDescriptor(Range.prototype, name)])
    let scrollBy
    beforeEach(() => {
      scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
      Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
      Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => ({ left: 0, right: 1, top: 0, bottom: 1, width: 1, height: 1 }) })
    })
    afterEach(() => {
      scrollBy.mockRestore()
      rangeGeometry.forEach(([name, descriptor]) => {
        if (descriptor) Object.defineProperty(Range.prototype, name, descriptor)
        else delete Range.prototype[name]
      })
    })
    const shortcut = (input, modifiers = {}) => {
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...modifiers })
      input.dispatchEvent(event)
      return event
    }
    const pasteCommentText = (input, text) => {
      expect(input.getAttribute('role')).toBe('textbox')
      expect(input.getAttribute('aria-readonly')).toBe('false')
      input.focus()
      expect(input.contentEditable).toBe('true')
      expect(input.classList.contains('ProseMirror')).toBe(true)
      const event = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'clipboardData', { value: { getData: type => type === 'text/plain' ? text : '' } })
      input.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
    }
    it.each(['metaKey', 'ctrlKey'])('%s+Enter submits the rich reply once and ignores composition', key => withCommentDocument(async ({ host, provider, thread }) => {
      host.activateComment(thread.id)
      await vi.dynamicImportSettled()
      const input = await commentReplyInput(), reply = vi.spyOn(provider, 'reply')
      pasteCommentText(input, '快捷键回复')
      await host.$nextTick()
      shortcut(input, { [key]: true, isComposing: true })
      shortcut(input, { [key]: true, keyCode: 229 })
      expect(reply).not.toHaveBeenCalled()
      expect((await provider.list())[0].replies).toHaveLength(1)
      expect(shortcut(input, { [key]: true }).defaultPrevented).toBe(true)
      shortcut(input, { [key]: true })
      await vi.waitFor(async () => expect((await provider.list())[0].replies.map(item => item.content)).toEqual(['原评论', '快捷键回复']))
      expect(reply).toHaveBeenCalledOnce()
      shortcut(input, { [key]: true })
      await host.$nextTick()
      expect(reply).toHaveBeenCalledOnce()
    }))
    it('Cmd+Enter submits a new rich comment once and keeps plain Enter as input', () => withCommentDocument(async ({ doc, host, provider }) => {
      doc.getEditor().commands.setTextSelection({ from: 1, to: 5 })
      expect(host.openSelectionComment()).toBe(true)
      const input = await vi.waitFor(() => {
        const current = document.querySelector('.lark-doc-comment-composer .lark-doc-comment-input-zone[role="textbox"]')
        expect(current).not.toBeNull()
        return current
      })
      const create = vi.spyOn(provider, 'createThread')
      pasteCommentText(input, '快捷键新评论')
      await host.$nextTick()
      shortcut(input, { metaKey: true, isComposing: true })
      shortcut(input, { metaKey: true, keyCode: 229 })
      expect(create).not.toHaveBeenCalled()
      expect(shortcut(input).defaultPrevented).toBe(true)
      pasteCommentText(input, '第二行')
      await host.$nextTick()
      expect(await provider.list()).toHaveLength(1)
      expect(shortcut(input, { metaKey: true }).defaultPrevented).toBe(true)
      shortcut(input, { metaKey: true })
      await vi.waitFor(async () => {
        const threads = await provider.list()
        expect(threads).toHaveLength(2)
        expect(threads.flatMap(item => item.replies).map(item => item.content)).toContain('快捷键新评论\n第二行')
      })
      expect(create).toHaveBeenCalledOnce()
    }))
    it.each(['readonly', 'retired'])('rich comment shortcut rejects a %s input', reason => withCommentDocument(async ({ doc, host, provider, session, thread }) => {
      host.activateComment(thread.id)
      await vi.dynamicImportSettled()
      const input = await commentReplyInput(), reply = vi.spyOn(provider, 'reply')
      pasteCommentText(input, '不可提交的草稿')
      await host.$nextTick()
      if (reason === 'readonly') {
        session.setProvider('authorization', { getCapabilities: async () => ({ canView: true, canEdit: false, canComment: false }) })
        await session.refreshCapabilities()
        await vi.waitFor(() => expect(input.getAttribute('aria-readonly')).toBe('true'))
      } else { doc.destroy(); expect(input.isConnected).toBe(false) }
      shortcut(input, { metaKey: true })
      shortcut(input, { ctrlKey: true })
      await Promise.resolve()
      expect(reply).not.toHaveBeenCalled()
      expect((await provider.list())[0].replies.map(item => item.content)).toEqual(['原评论'])
    }))
    it('memory image comment More disables unavailable translation with a reason instead of consuming the action', async () => {
      const width = window.innerWidth, media = window.matchMedia
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
      window.matchMedia = query => Object.assign(new EventTarget(), { media: query, matches: /max-width|pointer: coarse|hover: none/.test(query) })
      try {
        await withCommentDocument(async ({ doc, host, provider, thread, reply }) => {
          const editor = doc.getEditor(), before = doc.getJSON()
          editor.commands.setNodeSelection(0); editor.view.nodeDOM(0).querySelector('img').click()
          const viewer = document.querySelector('[aria-label="图片预览"]')
          viewer.querySelector('[data-viewer-action="comment"]').click(); await vi.dynamicImportSettled()
          const more = viewer.querySelector('[data-comment-reply-control="more"]')
          expect(more).not.toBeNull(); more.click()
          const translate = await vi.waitFor(() => {
            const node = [...viewer.querySelectorAll('[role="menuitem"]')].find(item => item.textContent === '翻译')
            expect(node).toBeDefined(); return node
          })
          expect(provider.isRemote).toBeUndefined(); expect(provider.requestTranslation).toBeUndefined()
          expect(reply.replyRevision).toBeUndefined()
          expect(translate.getAttribute('aria-disabled')).toBe('true')
          expect(translate.title).toMatch(/翻译.*服务|服务.*翻译/)
          expect(translate.getAttribute('aria-description')).toBe(translate.title)
          translate.click(); translate.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }))
          expect(translate.isConnected).toBe(true)
          expect(host.runCommentMenuItem('translate', thread.id, reply.id)).toBe(false)
          expect(host.commentMessage).toMatch(/翻译.*服务|服务.*翻译/)
          expect(host.commentTranslationContext).toBeNull(); expect(host.commentTranslationState).toBeNull()
          expect((await provider.list())[0].replies[0].content).toBe('原评论')
          expect(doc.getJSON()).toEqual(before)
        }, { content: { type: 'doc', content: [{ type: 'image', attrs: { blockId: 'comment_body', src: '/comment-menu-image.png' } }] },
          anchor: { blockId: 'comment_body', offset: 0, length: 0 } })
      } finally { Object.defineProperty(window, 'innerWidth', { configurable: true, value: width }); window.matchMedia = media }
    })
  })
  const picture = (type = 'image/png') => new File(['png'], 'comment.png', { type })
  describe('评论更多菜单的指针协议', () => {
    const width = window.innerWidth, media = window.matchMedia
    const pointerEnvironment = ({ mobile = false, coarse = false, hover = true } = {}) => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: mobile ? 393 : 1280 })
      window.matchMedia = query => Object.assign(new EventTarget(), { media: query, matches: query.includes('pointer: coarse') ? coarse : query.includes('hover: hover') ? hover : query.includes('hover: none') ? !hover : query.includes('max-width') ? mobile : false })
    }
    beforeEach(() => pointerEnvironment())
    afterEach(() => { Object.defineProperty(window, 'innerWidth', { configurable: true, value: width }); window.matchMedia = media })
    const moreButton = () => document.querySelector('[aria-label="更多菜单"]')
    it('桌面更多菜单悬停打开、点击收起、移开后关闭', () => withCommentDocument(async ({ host, thread, reply }) => {
      host.activateComment(thread.id)
      await vi.waitFor(() => expect(moreButton()).not.toBeNull())
      moreButton().dispatchEvent(new MouseEvent('mouseenter'))
      await vi.waitFor(() => expect(host.commentMenuCommentId).toBe(reply.id))
      moreButton().click(); expect(host.commentMenuCommentId).toBe('')
      await host.$nextTick()
      // A rebuilt button under the same stationary pointer must not reopen it.
      moreButton().dispatchEvent(new MouseEvent('mouseenter')); expect(host.commentMenuCommentId).toBe('')
      moreButton().dispatchEvent(new MouseEvent('mouseleave'))
      moreButton().dispatchEvent(new MouseEvent('mouseenter'))
      await vi.waitFor(() => expect(host.commentMenuCommentId).toBe(reply.id))
      moreButton().dispatchEvent(new MouseEvent('mouseleave'))
      await vi.waitFor(() => expect(host.commentMenuCommentId).toBe(''))
    }))
    it('桌面指针可以从按钮进入菜单，悬停不夺走正在输入的焦点', () => withCommentDocument(async ({ host, thread, reply }) => {
      host.activateComment(thread.id); await vi.waitFor(() => expect(moreButton()).not.toBeNull())
      const field = document.createElement('input'); document.body.appendChild(field); field.value = '未提交组合文本'; field.focus()
      field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      moreButton().dispatchEvent(new MouseEvent('mouseenter')); await vi.waitFor(() => expect(host.commentMenuCommentId).toBe(reply.id))
      const menu = document.querySelector('.lark-doc-comment-reply-menu')
      moreButton().dispatchEvent(new MouseEvent('mouseleave', { relatedTarget: menu })); menu.dispatchEvent(new MouseEvent('mouseenter'))
      await new Promise(resolve => setTimeout(resolve, 180))
      expect(host.commentMenuCommentId).toBe(reply.id); expect(document.activeElement).toBe(field); expect(field.value).toBe('未提交组合文本')
      menu.dispatchEvent(new MouseEvent('mouseleave', { relatedTarget: document.body }))
      await vi.waitFor(() => expect(host.commentMenuCommentId).toBe(''))
      expect(document.activeElement).toBe(field); field.remove()
    }))
    it.each([{ coarse: true }, { hover: false }, { mobile: true }])('coarse/no-hover/手机不受合成hover干扰，仍真实点击切换 %j', environment => {
      pointerEnvironment(environment)
      return withCommentDocument(async ({ host, thread, reply }) => {
        host.activateComment(thread.id); await vi.waitFor(() => expect(moreButton()).not.toBeNull())
        moreButton().dispatchEvent(new MouseEvent('mouseenter')); expect(host.commentMenuCommentId).toBe('')
        moreButton().click(); await vi.waitFor(() => expect(host.commentMenuCommentId).toBe(reply.id))
        moreButton().dispatchEvent(new MouseEvent('mouseleave')); await new Promise(resolve => setTimeout(resolve, 180))
        expect(host.commentMenuCommentId).toBe(reply.id)
        moreButton().click(); expect(host.commentMenuCommentId).toBe('')
      })
    })
    it.each(['identity', 'view', 'destroy'])('旧按钮和延迟leave在%s退役后不能重开或关闭新菜单', reason => withCommentDocument(async ({ doc, host, provider, session, thread, reply }) => {
      host.activateComment(thread.id); await vi.waitFor(() => expect(moreButton()).not.toBeNull())
      moreButton().dispatchEvent(new MouseEvent('mouseenter')); await vi.waitFor(() => expect(host.commentMenuCommentId).toBe(reply.id))
      const retired = moreButton(); retired.dispatchEvent(new MouseEvent('mouseleave'))
      if (reason === 'identity') session.setProvider('comments', createMemoryCommentsProvider({ threads: await provider.list() }))
      else if (reason === 'view') { session.setProvider('authorization', { getCapabilities: async () => ({ canView: false }) }); await session.refreshCapabilities() }
      else doc.destroy()
      if (reason === 'identity') {
        await host.loadComments(); host.activateComment(thread.id); await vi.waitFor(() => expect(moreButton()).not.toBeNull())
        moreButton().click(); await vi.waitFor(() => expect(host.commentMenuCommentId).toBe(reply.id))
      }
      const expected = host.commentMenuCommentId
      retired.dispatchEvent(new MouseEvent('mouseenter')); retired.click()
      await new Promise(resolve => setTimeout(resolve, 180))
      expect(host.commentMenuCommentId).toBe(expected)
      if (reason === 'view') expect(expected).toBe('')
      if (reason === 'destroy') expect(retired.isConnected).toBe(false)
    }))
  })
  it('解决线程后，旧多图队列不能继续启动第二张上传', () => withControlledCommentDocument(async ({ host, session, thread }) => {
    let finish
    const upload = vi.fn(() => new Promise(resolve => { finish = resolve }))
    session.setProvider('assets', commentAssets(upload))
    const batch = host.uploadCommentImageFiles(thread.id, imageEvent(picture(), picture()))
    await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce())
    // A separate resolver changes the thread while the upload is pending.
    await host.commentProvider().resolve(thread.id); await host.loadComments()
    finish(readyCommentAsset()); await batch
    expect(upload).toHaveBeenCalledOnce(); expect(host.commentDraftImages(thread.id)).toEqual([])
  }))
  it('版本历史关闭时，文档更多操作仍可打开评论历史', () => withControlledCommentDocument(async ({ host }) => {
    const trigger = document.querySelector('.lark-doc-more-btn'); expect(trigger).not.toBeNull(); trigger.click()
    const option = await vi.waitFor(() => { const node = [...document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent === '历史评论'); expect(node).toBeDefined(); return node })
    option.click(); await vi.waitFor(() => expect(host.commentHistorical).toBe(true))
    expect(host.commentSidebarOpen).toBe(true)
  }, { config: { features: { history: false } } }))
  it('更换资产Provider停止旧多图队列，不自动向新服务重发', () => withControlledCommentDocument(async ({ host, session, thread }) => {
    let finish
    const oldUpload = vi.fn(() => new Promise(resolve => { finish = resolve })), newUpload = vi.fn(async () => readyCommentAsset())
    session.setProvider('assets', commentAssets(oldUpload))
    const batch = host.uploadCommentImageFiles(thread.id, imageEvent(picture(), picture()))
    await vi.waitFor(() => expect(oldUpload).toHaveBeenCalledOnce())
    session.setProvider('assets', commentAssets(newUpload)); finish(readyCommentAsset()); await batch
    expect(newUpload).not.toHaveBeenCalled(); expect(host.commentDraftImages(thread.id)).toEqual([])
    expect(host.commentPendingImage).toBeNull()
    await host.uploadCommentImageFiles(thread.id, imageEvent(picture()))
    expect(newUpload).toHaveBeenCalledOnce(); expect(host.commentDraftImages(thread.id)).toHaveLength(1)
  }))
  it('图文回复可编辑为已确认资产的纯图，纯文字回复不能保存为空', () => withControlledCommentDocument(async ({ host, provider, thread, reply }) => {
    const withImage = { ...reply, id: 'reply-image', content: '图文说明', attachments: [{ ...commentAsset }] }; thread.replies.push(withImage)
    await host.loadComments(); host.beginEditComment(thread.id, withImage.id); host.setCommentEditContent('')
    expect(await host.saveEditedComment()).toBeTruthy()
    expect(provider.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: '', assetIds: [commentAsset.assetId] }))
    expect((await provider.list())[0].replies.find(item => item.id === withImage.id).attachments).toEqual([commentAsset])
    host.beginEditComment(thread.id, reply.id); host.setCommentEditContent('')
    expect(await host.saveEditedComment()).toBeNull(); expect((await provider.list())[0].replies[0].content).toBe('原评论')
  }))
  it('删除等待期间撤销评论能力后，旧确认不能清除当前线程视图', () => withControlledCommentDocument(async ({ host, provider, session, thread, reply }) => {
    let finish
    provider.deleteReply = vi.fn(() => new Promise(resolve => { finish = resolve }))
    const pending = host.deleteCommentReply(thread.id, reply.id)
    session.setProvider('authorization', { getCapabilities: async () => ({ canView: true, canEdit: true, canComment: false }) }); await session.refreshCapabilities()
    finish(thread); expect(await pending).toBeNull()
    await vi.waitFor(() => expect(host.commentThreads.some(item => item.id === thread.id)).toBe(true))
    expect(host.commentThreads[0].replies[0].content).toBe('原评论')
  }))
  it('历史评论可在阅读模式查看，重开走Provider，撤销解决权限后拒绝重开', () => withControlledCommentDocument(async ({ doc, host, provider, session, thread }) => {
    await host.resolveComment(thread.id); doc.setReadonly(true)
    host.openHistoricalComments(); expect(host.commentHistorical).toBe(true); expect(host.commentSidebarOpen).toBe(true)
    await host.reopenComment(thread.id); expect((await provider.list())[0].resolved).toBe(false)
    session.setProvider('authorization', { getCapabilities: async () => ({ canResolveComment: false, canComment: true, canView: true }) }); await session.refreshCapabilities()
    expect(await host.reopenComment(thread.id)).toBeNull(); expect(provider.reopen).toHaveBeenCalledOnce()
    // Viewing history depends on canView; it does not require body edit rights.
    host.openHistoricalComments(); expect(host.commentHistorical).toBe(true)
  }))
  it('图片pending不发送，durable ready后纯图回复通过assetIds持久化并清理草稿', () => withControlledCommentDocument(async ({ host, provider, session, thread }) => {
    let finish
    session.setProvider('assets', commentAssets(() => new Promise(resolve => { finish = resolve })))
    const upload = host.uploadCommentImageFiles(thread.id, imageEvent(picture()))
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    expect(await host.submitCommentDraft(thread.id)).toBeNull(); expect(provider.reply).not.toHaveBeenCalled()
    finish(readyCommentAsset()); await upload
    expect(host.commentDraftImages(thread.id)[0]).toMatchObject(commentAsset)
    await host.submitCommentDraft(thread.id)
    expect(provider.reply).toHaveBeenCalledWith(expect.objectContaining({ content: '', assetIds: [commentAsset.assetId] }))
    const saved = (await provider.list())[0].replies[1]; expect(saved.attachments).toEqual([commentAsset])
    saved.attachments[0].fileName = 'mutated'; expect((await provider.list())[0].replies[1].attachments[0].fileName).toBe('comment.png')
    expect(host.commentDraftImages(thread.id)).toEqual([])
  }))
  it.each(['image/svg+xml', 'application/octet-stream'])('禁用类型 %s 不进入资产上传', mime => withControlledCommentDocument(async ({ host, session, thread }) => {
    const upload = vi.fn(async () => readyCommentAsset()); session.setProvider('assets', commentAssets(upload))
    await host.uploadCommentImageFiles(thread.id, imageEvent(picture(mime)))
    expect(upload).not.toHaveBeenCalled(); expect(host.commentDraftImages(thread.id)).toEqual([]); expect(host.commentMessage).toContain('PNG')
  }))
  it('WebP属于当前明确支持的评论图片格式', () => withControlledCommentDocument(async ({ host, session, thread }) => {
    const upload = vi.fn(async () => readyCommentAsset()); session.setProvider('assets', commentAssets(upload))
    await host.uploadCommentImageFiles(thread.id, imageEvent(picture('image/webp'))); expect(upload).toHaveBeenCalledOnce()
  }))
  it('清除草稿abort上传且拒绝晚结果；缺assets服务时不调用正文旧上传器', () => withControlledCommentDocument(async ({ doc, host, session, thread }) => {
    let finish, signal
    const upload = vi.fn(input => new Promise(resolve => { finish = resolve; signal = input.signal }))
    session.setProvider('assets', commentAssets(upload))
    const pending = host.uploadCommentImageFiles(thread.id, imageEvent(picture()))
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    host.clearCommentDraftImages(thread.id); expect(signal.aborted).toBe(true); finish(readyCommentAsset()); await pending
    expect(host.commentDraftImages(thread.id)).toEqual([])
    session.setProvider('assets', null); const legacy = vi.fn(); doc.patchProps({ uploadImage: legacy })
    await host.uploadCommentImageFiles(thread.id, imageEvent(picture()))
    expect(upload).toHaveBeenCalledOnce(); expect(legacy).not.toHaveBeenCalled(); expect(host.commentCanUploadImage(thread.id)).toBe(false)
  }))
  it('翻译只改变阅读视图；未接通服务不伪造译文，关闭后晚译文不呈现', () => withControlledCommentDocument(async ({ host, provider, thread, reply }) => {
    const result = { threadId: thread.id, replyId: reply.id, sourceRevision: reply.replyRevision, targetLanguage: 'zh-CN', operationId: 'translation-original', status: 'ready', translatedText: 'Translated reply' }
    provider.requestTranslation = vi.fn(async () => result)
    host.beginCommentTranslation(thread.id, reply.id); expect(await host.submitCommentTranslation()).toMatchObject({ status: 'ready' })
    expect(host.commentTranslationState.translatedText).toBe('Translated reply'); expect(thread.replies[0].content).toBe('原评论')
    provider.requestTranslation = vi.fn(async () => ({ ...result, status: 'blocked', persisted: false, batchBlocked: true, taskId: null, translatedText: '' }))
    host.closeCommentTranslation(); host.beginCommentTranslation(thread.id, reply.id); await host.submitCommentTranslation()
    expect(host.commentTranslationState).toMatchObject({ status: 'blocked', persisted: false }); expect(host.commentMessage).toContain('未接通')
    let finish
    provider.requestTranslation = () => new Promise(resolve => { finish = resolve })
    host.closeCommentTranslation(); host.beginCommentTranslation(thread.id, reply.id); const pending = host.submitCommentTranslation()
    host.closeCommentTranslation(); finish(result); expect(await pending).toBeNull(); expect(host.commentTranslationState).toBeNull()
  }))
  it('remote comment translation More remains enabled with the declared port and preserves its original pending query', () => withControlledCommentDocument(async ({ host, provider, thread, reply }) => {
    provider.requestTranslation = vi.fn(async () => ({ threadId: thread.id, replyId: reply.id, sourceRevision: reply.replyRevision,
      targetLanguage: 'zh-CN', operationId: 'translation-menu-original', status: 'pending' }))
    provider.queryTranslation = vi.fn(async operationId => ({ threadId: thread.id, replyId: reply.id, sourceRevision: reply.replyRevision,
      targetLanguage: 'zh-CN', operationId, status: 'ready', translatedText: 'Translated reply' }))
    host.toggleCommentSidebar()
    const more = await vi.waitFor(() => { const node = document.querySelector('[data-comment-reply-control="more"]'); expect(node).not.toBeNull(); return node })
    more.click()
    const translate = await vi.waitFor(() => {
      const node = [...document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent === '翻译')
      expect(node).toBeDefined(); return node
    })
    expect(translate.getAttribute('aria-disabled')).toBe('false')
    expect(translate.title).toBe('')
    translate.click()
    expect(host.commentTranslationContext).toEqual({ threadId: thread.id, replyId: reply.id, sourceRevision: '1' })
    expect(await host.submitCommentTranslation()).toMatchObject({ status: 'pending', operationId: 'translation-menu-original' })
    expect(host.commentPendingTranslationOperation).toBe('translation-menu-original')
    expect(await host.queryPendingCommentTranslation()).toMatchObject({ status: 'ready', translatedText: 'Translated reply' })
    expect(provider.requestTranslation).toHaveBeenCalledOnce()
    expect(provider.queryTranslation).toHaveBeenCalledWith('translation-menu-original')
  }))
  it('举报仅交给显式宿主端口，未配置或已撤权不伪造导航成功', () => withControlledCommentDocument(async ({ doc, host, session, thread, reply }) => {
    reply.author = { id: 'other', name: '其他人' }; await host.loadComments()
    expect(await host.reportCommentReply(thread.id, reply.id)).toBe(false)
    const action = vi.fn(async () => true); action.supportedActions = ['report-comment']; doc.patchProps({ onDocumentAction: action })
    expect(await host.runCommentMenuItem('report', thread.id, reply.id)).toBe(true)
    expect(action).toHaveBeenCalledWith(Object.freeze({ action: 'report', target: 'comment', documentId: session.documentId, actorId: session.user.id, threadId: thread.id, replyId: reply.id }))
    action.mockResolvedValueOnce(false); expect(await host.reportCommentReply(thread.id, reply.id)).toBe(false)
    session.setProvider('authorization', { getCapabilities: async () => ({ canView: false }) }); await session.refreshCapabilities()
    expect(await host.reportCommentReply(thread.id, reply.id)).toBe(false); expect(action).toHaveBeenCalledTimes(2)
  }))
  it('comment report menu explains missing service, own-author restriction and withdrawn permission', () => withControlledCommentDocument(async ({ doc, host, session, thread, reply }) => {
    reply.author = { id: 'other', name: '其他人' }; await host.loadComments()
    host.toggleCommentSidebar()
    const more = () => document.querySelector('[data-comment-reply-control="more"]')
    const menu = label => [...document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent === label)
    await vi.waitFor(() => expect(more()).not.toBeNull()); more().click()
    await vi.waitFor(() => expect(menu('举报')).toBeDefined())
    expect(menu('举报').getAttribute('aria-disabled')).toBe('true')
    expect(menu('举报').title).toBe('举报服务未接入')
    expect(menu('翻译').getAttribute('aria-disabled')).toBe('true')
    expect(menu('翻译').title).toContain('翻译')
    const action = vi.fn(async () => true); action.supportedActions = ['report-comment']
    doc.patchProps({ onDocumentAction: action })
    await vi.waitFor(() => expect(menu('举报').getAttribute('aria-disabled')).toBe('false'))
    expect(menu('举报').title).toBe('')
    menu('举报').click(); await vi.waitFor(() => expect(action).toHaveBeenCalledOnce())
    reply.author = { ...session.user }; await host.loadComments()
    more().click(); await vi.waitFor(() => expect(menu('举报')).toBeDefined())
    const ownReport = menu('举报')
    expect(ownReport.getAttribute('aria-disabled')).toBe('true')
    expect(ownReport.title).toBe('不能举报自己的评论')
    ownReport.click(); expect(action).toHaveBeenCalledOnce()
    session.setProvider('authorization', { getCapabilities: async () => ({ canView: false }) }); await session.refreshCapabilities()
    expect(host.commentMenuDisabledReason({ id: 'report' }, reply)).toBe('当前无权访问评论')
    ownReport.click(); expect(await host.runCommentMenuItem('report', thread.id, reply.id)).toBe(false)
    expect(action).toHaveBeenCalledOnce()
  }))
  it('删除回复等待ack且防重复；失败保留，成功仅删除目标回复', () => withControlledCommentDocument(async ({ host, provider, thread, reply }) => {
    const actual = provider.deleteReply; let finish
    provider.deleteReply = vi.fn(() => new Promise((resolve, reject) => { finish = reject }))
    const pending = host.deleteCommentReply(thread.id, reply.id); expect(await host.deleteCommentReply(thread.id, reply.id)).toBeNull(); expect(provider.deleteReply).toHaveBeenCalledOnce()
    finish(new Error('delete failed')); expect(await pending).toBeNull(); expect(thread.replies[0].tombstone).toBe(false)
    provider.deleteReply = actual; expect(await host.deleteCommentReply(thread.id, reply.id)).toBeTruthy(); expect(thread.replies[0].tombstone).toBe(true)
  }))
})

describe('表格与链接真实评论入口', () => {
  const table = { type: 'table', attrs: { blockId: 'comment_table' }, content: Array.from({ length: 3 }, (_, row) => ({ type: 'tableRow', content: Array.from({ length: 3 }, (_, col) => ({ type: 'tableCell', content: [{ type: 'paragraph', attrs: { blockId: `cell_${row}_${col}` }, content: [{ type: 'text', text: `${'ABC'[col]}${row + 1}` }] }] })) })) }
  function selectRectangle(editor) {
    const cells = []
    editor.state.doc.descendants((node, pos) => { if (node.type.name === 'tableCell') cells.push(pos) })
    editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, cells[0], cells[4])))
  }
  it.each(['text', 'cells'])('批量补号保留 %s 评论草稿和 Provider 等待中的原引用', kind => withCommentDocument(async ({ doc, host, provider }) => {
    const editor = doc.getEditor()
    editor.commands.setContent({ type: 'doc', content: [kind === 'cells' ? table : { type: 'paragraph', attrs: { blockId: 'comment_body' }, content: [{ type: 'text', text: '评论原文' }] },
      ...Array.from({ length: 40 }, () => ({ type: 'paragraph', content: [{ type: 'text', text: '补号正文' }] })),
    ] })
    if (kind === 'cells') selectRectangle(editor)
    else editor.commands.setTextSelection({ from: 1, to: 5 })
    expect(host.openSelectionComment()).toBe(true)
    const quote = host.commentComposerContext.text
    host.setCommentCreateDraft('保留原引用')
    const fixes = []
    editor.state.doc.forEach((node, pos, index) => { if (index > 0) fixes.push({ pos, id: `normalized_tail_${index}` }) })
    const normalized = editor.state.tr
    applyBlockIdFixes(normalized, fixes)
    editor.view.dispatch(normalized)
    expect(host.commentCreateDraft).toBe('保留原引用')
    expect(host.commentComposerContext.bookmark.resolve(editor.state.doc).eq(editor.state.selection)).toBe(true)
    const actual = provider.createThread.bind(provider)
    let complete
    provider.createThread = input => new Promise(resolve => { complete = () => resolve(actual(input)) })
    const pending = host.createCommentFromSelection(host.commentCreateDraft)
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'))
    const again = editor.state.tr
    applyBlockIdFixes(again, fixes.map((fix, index) => ({ ...fix, id: `normalized_again_${index}` })))
    editor.view.dispatch(again)
    expect(host.commentBusy).toBe(true)
    complete()
    const saved = await pending
    expect(saved).toBeTruthy()
    expect(saved.quote).toBe(quote)
    expect(saved.blockId).toBe(kind === 'cells' ? 'comment_table' : 'comment_body')
    expect(host.commentComposerContext).toBeNull()
  }))
  it('矩形评论引用只含所选四格，稳定锚点属于表格而非首格段落', () => withCommentDocument(async ({ doc, host, provider, thread: seed }) => {
    const editor = doc.getEditor()
    editor.commands.setContent({ type: 'doc', content: [table] })
    selectRectangle(editor)
    expect(host.openSelectionComment()).toBe(true)
    expect(host.commentComposerContext.text).toBe('A1 B1 A2 B2')
    host.setCommentCreateDraft('矩形选区评论')
    const thread = await host.createCommentFromSelection(host.commentCreateDraft)
    expect(thread.id).not.toBe(seed.id)
    expect(thread.blockId).toBe('comment_table')
    expect(thread.anchor.blockId).toBe('comment_table')
    expect(thread.anchor.offset + thread.anchor.length).toBeLessThanOrEqual(editor.state.doc.firstChild.content.size)
    const marked = []
    editor.state.doc.descendants(node => { if (node.isText && node.marks.some(mark => mark.type.name === 'comment' && mark.attrs.threadId === thread.id)) marked.push(node.text) })
    expect(marked).toEqual(['A1', 'B1', 'A2', 'B2'])
    const json = doc.getJSON()
    editor.commands.setContent(json)
    await host.loadComments()
    expect(host.commentThreads.find(item => item.id === thread.id).bound).toBe(true)
    expect((await provider.list()).find(item => item.id === thread.id).quote).toBe('A1 B1 A2 B2')
  }))
  it.each(['insert-before', 'replace-table'])('等待评论服务期间 %s 不能把矩形标到旧全文坐标', change => withCommentDocument(async ({ doc, host, provider }) => {
    const editor = doc.getEditor()
    editor.commands.setContent({ type: 'doc', content: [table] })
    selectRectangle(editor)
    let finish
    const create = provider.createThread.bind(provider)
    provider.createThread = input => new Promise(resolve => { finish = async () => resolve(await create(input)) })
    const pending = host.createCommentFromSelection('异步矩形评论')
    if (change === 'insert-before') editor.commands.insertContentAt(0, '<p>新增前文</p>')
    else editor.commands.setContent('<p data-block-id="other_target">替换正文</p>')
    await finish()
    const thread = await pending
    const marked = []
    editor.state.doc.descendants(node => { if (node.isText && node.marks.some(mark => mark.type.name === 'comment')) marked.push(node.text) })
    if (change === 'insert-before') {
      expect(thread).toBeTruthy()
      expect(marked).toEqual(['A1', 'B1', 'A2', 'B2'])
    } else { expect(thread).toBeNull(); expect(marked).toEqual([]) }
  }))
  it.each([
    ['linkEmbed', { href: 'https://www.barenkeji.com', view: 'preview' }, '[网页]'],
    ['bookmark', { url: 'https://www.barenkeji.com', title: '鹊桥每日征婚平台' }, '[网页卡片]'],
  ])('%s 块评论使用飞书固定引用文案', (type, attrs, quote) => withCommentDocument(async ({ doc, host }) => {
    doc.getEditor().commands.setContent({ type: 'doc', content: [{ type, attrs: { ...attrs, blockId: 'link_comment' } }] })
    doc.getEditor().commands.setNodeSelection(0)
    expect(host.openSelectionComment()).toBe(true)
    expect(host.commentComposerContext.text).toBe(quote)
    host.setCommentCreateDraft('链接块评论')
    const thread = await host.createCommentFromSelection(host.commentCreateDraft)
    expect(thread.quote).toBe(quote)
    expect(thread.blockId).toBe('link_comment')
  }))
})

describe('real comment reaction and reply lifecycle', () => {
  it('keeps an unknown provider reaction read as plain text without injecting markup', () => withCommentDocument(async ({ host, provider }) => {
    const list = provider.list.bind(provider)
    provider.list = async () => { const rows = await list(); rows[0].replies[0].reactions = [{ emoji: 'future_reaction', users: ['comment-owner'] }]; return rows }
    await host.loadComments()
    const chip = await vi.waitFor(() => { const node = document.querySelector('.lark-doc-comment-reaction'); expect(node).not.toBeNull(); return node })
    expect(chip.textContent).toContain('future_reaction'); expect(chip.querySelector('img, svg')).toBeNull()
  }))
  it('opens the current Unicode reaction picker and renders persisted reaction chips', () => withCommentDocument(async ({ host, provider, thread, reply }) => {
    await host.runCommentReplyControl('emoji', thread.id, reply.id)
    const palette = await vi.waitFor(() => { const node = document.querySelector('[aria-label="选择表情回复"]'); expect(node).not.toBeNull(); return node })
    expect(host.commentReactionItems).toHaveLength(8)
    const applaud = [...palette.querySelectorAll('.lark-doc-comment-reaction-grid button')].find(node => node.textContent === '👏'); expect(applaud).toBeDefined(); applaud.click()
    await vi.waitFor(async () => expect((await provider.list())[0].replies[0].reactions).toEqual([{ emoji: '👏', users: ['comment-owner'] }]))
    await vi.waitFor(() => expect(document.querySelector('.lark-doc-comment-reaction')?.disabled).toBe(false)); document.querySelector('.lark-doc-comment-reaction').click()
    await vi.waitFor(async () => expect((await provider.list())[0].replies[0].reactions).toEqual([]))
  }))
  it('quotes the referenced author, preserves an existing rich draft and submits the existing plain-text wire', () => withControlledCommentDocument(async ({ host, provider, thread, reply }) => {
    host.setCommentDraft(thread.id, '已有草稿'); host.runCommentReplyControl('quote', thread.id, reply.id)
    expect(host.commentDraftOf(thread.id)).toBe('> 我：原评论\n\n已有草稿')
    await host.submitCommentDraft(thread.id)
    expect(provider.reply).toHaveBeenCalledWith(expect.objectContaining({ content: '> 我：原评论\n\n已有草稿', threadId: thread.id }))
    expect(host.commentDraftOf(thread.id)).toBe('')
  }))
  it('rejects a late picker after the comment provider changes', () => withCommentDocument(async ({ host, session, thread, reply }) => {
    const pending = host.runCommentReplyControl('emoji', thread.id, reply.id)
    session.setProvider('comments', createMemoryCommentsProvider()); await pending
    expect(host.commentReactionContext).toBeNull(); expect(document.querySelector('[aria-label="选择表情回复"]')).toBeNull()
  }))
  it('retains the referenced message when submitting only a quote', () => withControlledCommentDocument(async ({ host, provider, thread, reply }) => {
    host.runCommentReplyControl('quote', thread.id, reply.id); await host.submitCommentDraft(thread.id)
    expect(provider.reply).toHaveBeenCalledWith(expect.objectContaining({ content: '> 我：原评论', threadId: thread.id }))
  }))
  it('keeps the picker during internal scrolling and closes it on document scrolling', () => withCommentDocument(async ({ host, thread, reply }) => {
    host.openCommentReaction(thread.id, reply.id)
    const palette = await vi.waitFor(() => { const node = document.querySelector('.lark-doc-comment-reaction-picker'); expect(node).not.toBeNull(); return node })
    palette.querySelector('.lark-doc-comment-reaction-grid').dispatchEvent(new Event('scroll'))
    expect(host.commentReactionContext).not.toBeNull(); window.dispatchEvent(new Event('scroll')); expect(host.commentReactionContext).toBeNull()
  }))
  it('copies a provider-authorized comment permalink and rechecks its target when opened', () => withControlledCommentDocument(async ({ host, provider, thread }) => {
    const link = `https://docs.example/doc?comment_id=${thread.id}`
    provider.getLink = vi.fn(async () => link)
    provider.openLink = vi.fn(async value => ({ target: { threadId: thread.id, anchorStatus: 'document' }, value }))
    const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard'), writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    try {
      expect(await host.runCommentControl('copyAnchor', thread.id)).toBe(true); expect(writeText).toHaveBeenCalledWith(link)
      host.commentActiveThreadId = ''; expect(await host.openCommentLink(link)).toBeTruthy()
      expect(provider.openLink).toHaveBeenCalledWith(link); expect(host.commentActiveThreadId).toBe(thread.id)
    } finally { if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard); else delete navigator.clipboard }
  }))

  it('rejects late composition events when a replacement provider reuses the same thread id', () => withCommentDocument(async ({ host, session, provider, thread }) => {
    const oldInput = await commentReplyInput()
    oldInput.dispatchEvent(new Event('compositionstart'))
    oldInput.textContent = '旧文档私有组合草稿'
    oldInput.dispatchEvent(new Event('input', { bubbles: true }))
    const nextProvider = createMemoryCommentsProvider({ threads: await provider.list() })
    session.setProvider('comments', nextProvider)
    oldInput.dispatchEvent(new Event('compositionend', { bubbles: true }))
    await host.loadComments()
    const input = await vi.waitFor(async () => {
      const node = await commentReplyInput()
      expect(node).not.toBe(oldInput)
      return node
    })
    expect(input).not.toBe(oldInput)
    expect(input.textContent).toBe('')
    expect(host.commentDraftOf(thread.id)).toBe('')
  }))

  it.each([false, true])('refuses paste ranges that extend outside the reply field (backward=%s)', backward => withCommentDocument(async ({ host, thread }) => {
    host.setCommentDraft(thread.id, 'reply field')
    const input = await commentReplyInput()
    await vi.waitFor(() => expect(input.textContent).toBe('reply field'))
    const outside = document.createElement('span')
    outside.textContent = 'outside editable guard'
    input.parentElement.appendChild(outside)
    const selection = document.getSelection()
    if (backward) selection.setBaseAndExtent(outside.firstChild, 7, input.querySelector('p').firstChild, 2)
    else selection.setBaseAndExtent(input.querySelector('p').firstChild, 2, outside.firstChild, 7)
    const paste = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(paste, 'clipboardData', { value: { getData: () => 'safe text' } })
    input.dispatchEvent(paste)
    expect(outside.textContent).toBe('outside editable guard')
    expect(host.commentDraftOf(thread.id)).toBe('reply field')
    expect(input.textContent).toBe('reply field')
  }))
})

/** 造一个只带 comment mark 的文本节点替身。 */
function textNode(text, pos, threadId) {
  return {
    isText: true,
    text,
    nodeSize: text.length,
    marks: threadId ? [{ type: { name: 'comment' }, attrs: { threadId } }] : [],
    attrs: {},
  }
}

/**
 * 把若干 `[text, threadId]` 拼成有 `descendants` 的假文档。
 *
 * 全部文本节点按**同一段落内的连续文本**排布：pos 从 1 起（父节点内 +1），后一段紧贴
 * 前一段末尾。ProseMirror 划词跨 mark 边界时就是这样一串相邻文本节点 —— 合并逻辑
 * 真正要覆盖的就是这种形态（跨段落的片段本来就不该并成一条）。
 */
function fakeDoc(segments) {
  let pos = 1
  const nodes = segments.map(([text, threadId]) => {
    const node = textNode(text, pos, threadId)
    node.start = pos
    pos += text.length
    return node
  })
  return {
    descendants(visit) {
      nodes.forEach((node) => visit(node, node.start))
    },
  }
}

/**
 * 造一个能调 mixin 方法的假 `this`。
 *
 * 必须把 methods 整体摊上去：闸门是两层的（`commentAllowed` → `commentCan`），只塞
 * `session` 会让内层调用 undefined。摊完再覆盖需要的字段（如 `commentAuthor`）。
 */
function mixinCtx(extra) {
  const ctx = { ...commentsMixin.data(), $set: (object, key, value) => { object[key] = value }, $nextTick: () => {}, ...extra }
  const methods = commentsMixin.methods
  Object.keys(methods).forEach((key) => {
    if (typeof ctx[key] !== 'function') ctx[key] = methods[key]
  })
  const panel = { ed: ctx, ...commentPanelMethods }
  Object.keys(commentPanelMethods).forEach(name => { if (typeof ctx[name] !== 'function') ctx[name] = (...args) => panel[name](...args) })
  return ctx
}

describe('comment provider response identity', () => {
  it('acknowledges a successful reply even when subsequent list refresh fails', async () => {
    const provider = { reply: vi.fn(async () => ({ id: 'saved' })) }
    const ctx = mixinCtx({ session: { can: () => true, getProvider: () => provider }, commentAuthor: { id: 'me' }, commentDrafts: { thread: '正文' }, $set: (object, key, value) => { object[key] = value }, loadComments: vi.fn(async () => { throw new Error('refresh failed') }) })
    expect(await ctx.submitCommentDraft('thread')).toEqual({ id: 'saved' })
    expect(ctx.commentDrafts.thread).toBe('')
    expect(ctx.commentMessage).toContain('已提交')
    await ctx.submitCommentDraft('thread')
    expect(provider.reply).toHaveBeenCalledTimes(1)
  })
  it('does not pretend to delete when the provider cannot persist deletion', async () => {
    const threads = [{ id: 'thread', replies: [{ id: 'reply', content: '保留' }] }]
    const ctx = mixinCtx({ session: { can: () => true, getProvider: () => ({ list: async () => threads }) }, commentThreads: threads })
    expect(await ctx.deleteCommentReply('thread', 'reply')).toBeNull()
    expect(ctx.commentThreads).toBe(threads)
    expect(ctx.commentMessage).toContain('不支持')
  })

  it('does not clear a new draft typed while its previous reply is being sent', async () => {
    let complete
    const provider = { reply: () => new Promise(resolve => { complete = resolve }) }
    const ctx = mixinCtx({ session: { can: () => true, getProvider: () => provider }, commentAuthor: { id: 'me' }, commentDrafts: { thread: '已发内容' }, $set: (object, key, value) => { object[key] = value }, loadComments: vi.fn(async () => []) })
    const pending = ctx.submitCommentDraft('thread')
    ctx.commentDrafts.thread = '新的草稿'
    complete({ id: 'reply' })
    expect(await pending).toEqual({ id: 'reply' })
    expect(ctx.commentDrafts.thread).toBe('新的草稿')
  })

  it.each(['newer-load', 'provider', 'session', 'destroy'])('does not paint a late list after %s', async action => {
    let complete
    const provider = { list: vi.fn().mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
      .mockResolvedValue([{ id: 'fresh-thread', blockId: 'b-fresh' }]) }
    const session = { getProvider: () => provider }
    const ctx = mixinCtx({ session, editor: { state: { doc: fakeDoc([]) } }, commentThreads: [], updateCommentPanels: vi.fn() })
    const pending = ctx.loadComments()
    if (action === 'provider') session.getProvider = () => ({ list: async () => [] })
    if (action === 'session') ctx.session = { getProvider: () => provider }
    if (action === 'destroy') ctx.editor.isDestroyed = true
    if (action === 'newer-load') await ctx.loadComments()
    complete([{ id: 'old-thread', blockId: 'b-old' }])
    await pending
    expect(ctx.commentThreads.map(thread => thread.id)).toEqual(action === 'newer-load' ? ['fresh-thread'] : [])
    expect(ctx.updateCommentPanels).toHaveBeenCalledTimes(action === 'newer-load' ? 1 : 0)
  })
})

describe('comment mark 契约', () => {
  it('mark 名与 inclusive 都是写死的，改了会让旧文档里的高亮跟着新打字延伸', () => {
    expect(LarkDocComment.name).toBe('comment')
    // Tiptap 把 create() 的入参留在 `.config` 上（不是 `.options`），与 addAttributes 同源。
    expect(LarkDocComment.config.inclusive).toBe(false)
  })

  it('属性只有 threadId，不带坐标（05 §5.5⑥：位置走 blockId + 块内偏移）', () => {
    const attrs = LarkDocComment.config.addAttributes.call({})
    expect(Object.keys(attrs)).toEqual(['threadId'])
  })

  it('normalizeComment 给空 threadId 兜一个本地 id，非空则原样返回', () => {
    expect(normalizeComment({ threadId: 't-1' }).threadId).toBe('t-1')
    expect(normalizeComment({}).threadId).not.toBe('')
    expect(normalizeComment(null).threadId).not.toBe('')
  })

  it('readComment 只认 comment mark；commentMarkOf 取第一条', () => {
    const mark = { type: { name: 'comment' }, attrs: { threadId: 't-9' } }
    expect(readComment(mark).threadId).toBe('t-9')
    expect(readComment({ type: { name: 'bold' }, attrs: {} })).toBeNull()
    const node = { marks: [{ type: { name: 'bold' }, attrs: {} }, mark] }
    expect(commentMarkOf(node)).toBe(mark)
    expect(commentMarkOf({ marks: [] })).toBeNull()
  })
})

describe('collectComments / commentRanges / commentAt', () => {
  it('同 threadId 且位置相邻的片段合并成一条（划词跨 mark 边界会被拆成多个文本节点）', () => {
    const doc = fakeDoc([['第一段', 't-1'], ['接着', 't-1'], ['别的', 't-2']])
    const items = collectComments(doc)
    expect(items).toHaveLength(2)
    expect(items[0].threadId).toBe('t-1')
    expect(items[0].text).toBe('第一段接着')
    // 相邻文本节点之间不留空位：上一条的 to 就是下一条的 from。
    expect(items[0].to).toBe(items[1].from)
  })

  it('同 threadId 但中间隔着别的文本时不合并（两段各自成条）', () => {
    const doc = fakeDoc([['甲', 't-1'], ['夹', 't-2'], ['乙', 't-1']])
    expect(collectComments(doc)).toHaveLength(3)
  })

  it('结果按文档序，不按 threadId 排序', () => {
    const doc = fakeDoc([['一', 't-2'], ['二', 't-1']])
    expect(collectComments(doc).map((item) => item.threadId)).toEqual(['t-2', 't-1'])
  })

  it('commentRanges 只返回该 threadId 的区间', () => {
    const doc = fakeDoc([['甲', 't-1'], ['乙', 't-2'], ['丙', 't-1']])
    expect(commentRanges(doc, 't-1')).toHaveLength(2)
    expect(commentRanges(doc, 't-3')).toEqual([])
  })

  it('commentAt：to 是开区间（光标停在标记末尾不算「在评论里」）', () => {
    const doc = fakeDoc([['甲乙丙', 't-1']])
    const [range] = commentRanges(doc, 't-1')
    expect(commentAt(doc, range.from)).toBe('t-1')
    expect(commentAt(doc, range.to - 1)).toBe('t-1')
    expect(commentAt(doc, range.to)).toBe('')
    expect(commentAt(doc, range.from - 1)).toBe('')
  })

  it('空文档 / 替身不合规时不抛', () => {
    expect(collectComments(null)).toEqual([])
    expect(collectComments({})).toEqual([])
    expect(commentAt(null, 0)).toBe('')
  })
})

describe('面板几何常量与高度', () => {
  it('宽度恒定 270、x 常驻 1214（04 §3.1④）', () => {
    expect(COMMENT_PANEL.width).toBe(270)
    expect(COMMENT_PANEL.x).toBe(1214)
    expect(COMMENT_PANEL.headerWidth).toBe(268)
    expect(COMMENT_PANEL.headerHeight).toBe(35)
    expect(COMMENT_PANEL.replyHeight).toBe(61)
    expect(COMMENT_PANEL.buttonGroupWidth).toBe(96)
  })

  it('三态高度：空 150 / 输入中 238 / 已提交 1 条 156', () => {
    expect(commentPanelHeight(0, false)).toBe(COMMENT_HEIGHTS.empty)
    expect(commentPanelHeight(1, true)).toBe(COMMENT_HEIGHTS.drafting)
    expect(commentPanelHeight(1, false)).toBe(COMMENT_HEIGHTS.submittedOne)
  })

  it('每条新增回复 +61（旧记 55 已作废）', () => {
    expect(commentPanelHeight(2, false) - commentPanelHeight(1, false)).toBe(61)
    expect(commentPanelHeight(3, true) - commentPanelHeight(2, true)).toBe(61)
  })

  it('头部六控件的顺序不可颠倒；回复行菜单四项顺序固定', () => {
    expect(COMMENT_CONTROL_IDS).toEqual(['go-next', 'go-previous', 'split', 'copyAnchor', 'resolve', 'more'])
    expect(COMMENT_REPLY_MENU_IDS).toEqual(['edit', 'translate', 'delete', 'report'])
  })
})

describe('bindThreads（块没了只降级，不吸附）', () => {
  it('没有评论时不扫描文档', () => {
    const doc = { descendants() { throw new Error('无评论不应扫描全文') } }
    expect(bindThreads(doc, [], plainAnchorCodec)).toEqual([])
    expect(bindThreads(doc, undefined, plainAnchorCodec)).toEqual([])
  })
  it('块还在就是 bound，块被删只标 unbound —— 绝不就近挂到别的块', () => {
    const threads = [
      { id: 't-1', blockId: 'b-1', replies: [] },
      { id: 't-2', blockId: 'b-gone', replies: [] },
    ]
    const result = bindThreads(['b-1', 'b-2'], threads, plainAnchorCodec)
    expect(result).toHaveLength(2)
    expect(result[0].bound).toBe(true)
    expect(result[1].bound).toBe(false)
    // 降级的那条 blockId 必须原样留着，不能变成 b-1 / b-2。
    expect(result[1].blockId).toBe('b-gone')
  })

  it('脏条目（null / 数组）被过滤，不抛', () => {
    expect(bindThreads(['b-1'], [null, 42, []], plainAnchorCodec)).toEqual([])
  })

  it('不改入参（Provider 的返回值常被直接丢进来）', () => {
    const threads = [{ id: 't-1', blockId: 'b-1', replies: [] }]
    bindThreads(['b-1'], threads, plainAnchorCodec)
    expect(threads[0].bound).toBeUndefined()
  })

  it('传 ProseMirror 文档时从文档里抽 blockId 集合', () => {
    const doc = {
      descendants(visit) {
        visit({ attrs: { blockId: 'b-1' } }, 1)
        visit({ attrs: {} }, 3)
        visit({ attrs: { blockId: '' } }, 5)
      },
    }
    expect(Array.from(documentBlockIds(doc))).toEqual(['b-1'])
  })
})

describe('resolveAnchorCodec（core 不 import yjs，靠注入）', () => {
  const fakeYdoc = { get: () => ({}) }

  it('没注入工厂 → plain（单机模式的合法路径）', () => {
    expect(resolveAnchorCodec(null, {})).toBe(plainAnchorCodec)
    expect(resolveAnchorCodec(null)).toBe(plainAnchorCodec)
  })

  it('注入了工厂但拿不到 ydoc → 仍是 plain，不抛', () => {
    const factory = () => ({ encode: (a) => a, decode: (p) => p })
    expect(resolveAnchorCodec({ state: { plugins: [] } }, { createYjsCodec: factory })).toBe(plainAnchorCodec)
  })

  it('工厂抛错也退回 plain，不让「加一条评论」整体失败', () => {
    const factory = () => { throw new Error('yjs 未安装') }
    expect(resolveAnchorCodec(null, { createYjsCodec: factory, ydoc: fakeYdoc })).toBe(plainAnchorCodec)
  })

  it('拿到 ydoc 时用工厂产出的 codec', () => {
    const codec = { encode: (a) => a, decode: (p) => p }
    const factory = (options) => {
      expect(options.ydoc).toBe(fakeYdoc)
      return codec
    }
    const result = resolveAnchorCodec(null, { createYjsCodec: factory, ydoc: fakeYdoc })
    expect(result).not.toBe(plainAnchorCodec)
    expect(typeof result.encode).toBe('function')
  })

  it('collabYdocOf 只认 y-sync 插件，其它插件带 .doc 也不算协同文档', () => {
    const ydoc = { get: () => ({}) }
    const editor = {
      state: {
        plugins: [
          { spec: { key: { key: 'otherPlugin' } }, getState: () => ({ doc: ydoc }) },
          { spec: { key: { key: 'y-sync$' } }, getState: () => ({ binding: { doc: ydoc } }) },
        ],
      },
    }
    expect(collabYdocOf(editor)).toBe(ydoc)
    expect(collabYdocOf({ state: { plugins: [] } })).toBeNull()
    expect(collabYdocOf(null)).toBeNull()
    // 插件状态里没有 Y.Doc 形态（没有 get）→ 不算。
    expect(collabYdocOf({
      state: { plugins: [{ spec: { key: { key: 'y-sync$' } }, getState: () => ({ binding: { doc: {} } }) }] },
    })).toBeNull()
  })
})

describe('partitionCommentThreads 复用数据层判定（不另写一份）', () => {
  it('bound / unbound 与 partitionThreads 一致', () => {
    const threads = [
      { id: 't-1', blockId: 'b-1', replies: [] },
      { id: 't-2', blockId: 'b-x', replies: [] },
    ]
    const result = partitionCommentThreads(threads, ['b-1'])
    expect(result.bound.map((item) => item.id)).toEqual(['t-1'])
    expect(result.unbound.map((item) => item.id)).toEqual(['t-2'])
  })
})

describe('capability 闸门（只走 capability，不自判角色）', () => {
  it('动作 → capability 的映射表', () => {
    expect(COMMENT_GATES.create).toBe('canComment')
    expect(COMMENT_GATES.reply).toBe('canComment')
    expect(COMMENT_GATES.remove).toBe('canComment')
    expect(COMMENT_GATES.resolve).toBe('canResolveComment')
    expect(COMMENT_GATES.reopen).toBe('canResolveComment')
  })

  it('不在表里的动作返回空串 —— 别默认放行', () => {
    expect(commentGate('copyAnchor')).toBe('')
    expect(commentGate('')).toBe('')
  })

  it('没配 session 时保留默认 capability，但创建仍要求真实评论服务', () => {
    const ctx = mixinCtx({ session: null })
    expect(ctx.commentCan('canComment')).toBe(true)
    expect(ctx.commentAllowed('create')).toBe(false)
  })

  it('canComment=false 时建/回复/删除都被拦，解决仍走自己的钥匙', () => {
    const ctx = mixinCtx({ session: { can: (cap) => cap !== 'canComment' } })
    expect(ctx.commentAllowed('create')).toBe(false)
    expect(ctx.commentAllowed('reply')).toBe(false)
    expect(ctx.commentAllowed('remove')).toBe(false)
    expect(ctx.commentAllowed('resolve')).toBe(true)
  })

  it('canResolveComment=false 只拦解决/重开，不拦回复', () => {
    const ctx = mixinCtx({ session: { can: (cap) => cap !== 'canResolveComment' } })
    expect(ctx.commentAllowed('resolve')).toBe(false)
    expect(ctx.commentAllowed('reopen')).toBe(false)
    expect(ctx.commentAllowed('reply')).toBe(true)
  })

  it('无权限时写操作直接返回 null，不落任何状态', async () => {
    let replied = 0
    const ctx = mixinCtx({
      session: { can: () => false, getProvider: () => ({ reply: async () => { replied += 1 } }) },
      commentDrafts: { 't-1': '你好' },
    })
    expect(await ctx.submitCommentDraft('t-1')).toBeNull()
    expect(replied).toBe(0)
    expect(await ctx.resolveComment('t-1')).toBeNull()
  })

  it('草稿写了字但无 canComment 时，setCommentDraft 不写草稿', () => {
    const written = {}
    const ctx = mixinCtx({ session: { can: () => false }, commentDrafts: {}, $set: (o, k, v) => { written[k] = v } })
    ctx.setCommentDraft('t-1', '文本')
    expect(ctx.commentDrafts['t-1']).toBeUndefined()
    expect(written['t-1']).toBeUndefined()
  })
})

describe('面板取值纯函数', () => {
  it('草稿：没写过是空串（空串 = 不浮出取消/发送）', () => {
    expect(commentDraftText({}, 't-1')).toBe('')
    expect(commentDraftText({ 't-1': '' }, 't-1')).toBe('')
    expect(commentDraftText({ 't-1': 'abc' }, 't-1')).toBe('abc')
    expect(commentDraftText(null, 't-1')).toBe('')
    expect(commentDraftText({ 't-1': 42 }, 't-1')).toBe('')
  })

  it('相对时间：刚刚 / N 分钟前 / N 小时前 / M-D', () => {
    const now = new Date(2026, 9, 27, 12, 0, 0).getTime()
    expect(commentRelativeTime(now, now)).toBe('刚刚')
    expect(commentRelativeTime(now, now - 59000)).toBe('刚刚')
    expect(commentRelativeTime(now, now - 120000)).toBe('2 分钟前')
    expect(commentRelativeTime(now, now - 7200000)).toBe('2 小时前')
    expect(commentRelativeTime(now, new Date(2026, 9, 25, 8, 0, 0).getTime())).toBe('10-25')
    expect(commentRelativeTime(now, 0)).toBe('')
  })

  it('菜单可见性：编辑只给自己的；当前源界面也允许打开自己评论的举报页', () => {
    const ctx = mixinCtx({ commentAuthor: { id: 'u-1', name: '我' } })
    const visible = ctx.commentMenuVisible.bind(ctx)
    const mine = { author: { id: 'u-1' } }
    const other = { author: { id: 'u-2' } }
    expect(visible({ id: 'edit' }, mine)).toBe(true)
    expect(visible({ id: 'edit' }, other)).toBe(false)
    expect(visible({ id: 'report' }, other)).toBe(true)
    expect(visible({ id: 'report' }, mine)).toBe(true)
    expect(visible({ id: 'delete' }, other)).toBe(true)
    // 作者 id 缺失时不能编辑。
    expect(visible({ id: 'edit' }, { author: { id: '' } })).toBe(false)
  })

  it('头部按钮禁用：到头灰掉，无权限灰掉，其余不灰', () => {
    const ctx = mixinCtx({
      commentPanels: [{ id: 't-1' }, { id: 't-2' }],
      session: { can: () => false },
    })
    expect(ctx.commentControlDisabled('go-previous', 't-1')).toBe(true)
    expect(ctx.commentControlDisabled('go-next', 't-2')).toBe(true)
    expect(ctx.commentControlDisabled('go-next', 't-1')).toBe(false)
    expect(ctx.commentControlDisabled('resolve', 't-1')).toBe(true)
    // 「更多」是本地 UI 态（私有评论开关），不看 capability —— 无权限也不灰。
    expect(ctx.commentControlDisabled('more', 't-1')).toBe(false)
    // 不在面板里的线程：跳转键灰掉。
    expect(ctx.commentControlDisabled('go-next', 't-9')).toBe(true)
  })
})
