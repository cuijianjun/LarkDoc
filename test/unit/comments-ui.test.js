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
import { describe, expect, it, vi } from 'vitest'
import { LarkDoc } from '../../src/LarkDoc'
import { createDocumentSession } from '../../src/session/DocumentSession'
import { createMemoryCommentsProvider } from '../../src/core/comments/memory-provider'
import { CellSelection } from '@tiptap/pm/tables'
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
  const thread = await provider.createThread({ blockId: 'comment_body', author: { id: 'comment-owner', name: '我' }, content: '原评论', quote: '评论原文', anchor: { blockId: 'comment_body', offset: 0, length: 4 } })
  const doc = new LarkDoc({ element, session, storage: 'none', ...options.props, content: '<p data-block-id="comment_body">评论原文</p>' })
  try {
    const host = doc._handle.nativeHost.host
    await host.loadComments()
    return await run({ doc, host, provider, session, thread, reply: thread.replies[0] })
  } finally { doc.destroy(); element.remove() }
}

describe('评论剩余闭环', () => {
  const picture = () => new File(['png'], 'comment.png', { type: 'image/png' })
  const url = 'data:image/png;base64,YQ=='
  it('更多菜单悬停打开，点击收起，移开后关闭', () => withCommentDocument(async ({ host, thread, reply }) => {
    host.activateComment(thread.id)
    await vi.waitFor(() => expect(document.querySelector('[aria-label="更多菜单"]')).not.toBeNull())
    document.querySelector('[aria-label="更多菜单"]').dispatchEvent(new MouseEvent('mouseenter'))
    await vi.waitFor(() => expect(host.commentMenuCommentId).toBe(reply.id))
    document.querySelector('[aria-label="更多菜单"]').click()
    expect(host.commentMenuCommentId).toBe('')
    await new Promise(resolve => setTimeout(resolve, 0))
    document.querySelector('[aria-label="更多菜单"]').dispatchEvent(new MouseEvent('mouseenter'))
    await vi.waitFor(() => expect(host.commentMenuCommentId).toBe(reply.id))
    document.querySelector('[aria-label="更多菜单"]').dispatchEvent(new MouseEvent('mouseleave'))
    await vi.waitFor(() => expect(host.commentMenuCommentId).toBe(''))
  }))
  it('解决线程后，旧多图队列不能继续启动第二张上传', () => withCommentDocument(async ({ doc, host, thread }) => {
    let finish
    const upload = vi.fn(() => upload.mock.calls.length === 1 ? new Promise(resolve => { finish = resolve }) : Promise.resolve({ url }))
    doc.patchProps({ uploadImage: upload })
    const batch = host.addCommentAttachments(thread.id, [picture(), picture()])
    await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce())
    await host.resolveComment(thread.id)
    finish({ url })
    await batch
    expect(upload).toHaveBeenCalledOnce()
    expect(host.commentDraftReady(thread.id, '')).toBe(false)
  }))
  it('版本历史关闭时，文档更多操作仍可打开评论历史', () => withCommentDocument(async () => {
    const trigger = document.querySelector('[aria-label="文档更多操作"]')
    expect(trigger).not.toBeNull()
    trigger.click()
    const option = [...document.querySelectorAll('[role="option"]')].find(node => node.textContent.trim() === '历史评论')
    expect(option).toBeDefined()
    option.click()
    await vi.waitFor(() => expect(document.querySelector('.lark-doc-comment-history')).not.toBeNull())
  }, { props: { config: { features: { history: false } } } }))
  it('多图队列在更换上传器后停下，旧第二张只有手动重试才发往新服务', () => withCommentDocument(async ({ doc, host, thread }) => {
    let finish
    const oldUpload = vi.fn(() => new Promise(resolve => { finish = resolve }))
    const newUpload = vi.fn(async () => ({ url }))
    doc.patchProps({ uploadImage: oldUpload })
    const batch = host.addCommentAttachments(thread.id, [picture(), picture()])
    await vi.waitFor(() => expect(oldUpload).toHaveBeenCalledOnce())
    doc.patchProps({ uploadImage: newUpload })
    finish({ url })
    await batch
    expect(newUpload).not.toHaveBeenCalled()
    const queued = host.commentAttachmentsOf(thread.id)[1]
    expect(queued.status).toBe('error')
    await host.retryCommentAttachment(thread.id, queued.id)
    expect(newUpload).toHaveBeenCalledOnce()
    expect(host.commentAttachmentsOf(thread.id)[1].status).toBe('ready')
  }))
  it('图文回复可编辑为纯图，纯文字回复不能保存为空', () => withCommentDocument(async ({ host, provider, thread, reply }) => {
    const withImage = await provider.reply({ threadId: thread.id, author: { id: 'comment-owner', name: '我' }, content: '图文说明', attachments: [{ url }] })
    await host.loadComments()
    host.beginCommentEdit(thread.id, withImage.id)
    expect(await host.confirmCommentEdit(thread.id, withImage.id, '')).toBeTruthy()
    const stored = (await provider.list())[0].replies.find(item => item.id === withImage.id)
    expect(stored.content).toBe('')
    expect(stored.attachments).toEqual([{ url, name: '', mime: '' }])
    host.beginCommentEdit(thread.id, reply.id)
    expect(await host.confirmCommentEdit(thread.id, reply.id, '')).toBe(false)
    expect((await provider.list())[0].replies[0].content).toBe('原评论')
  }))
  it('删除等待期间撤销编辑能力后，旧确认不能清除当前线程视图', () => withCommentDocument(async ({ host, provider, session, thread }) => {
    let finish
    provider.deleteThread = () => new Promise(resolve => { finish = resolve })
    const pending = host.deleteCommentThread(thread.id)
    session.setProvider('authorization', { getCapabilities: async () => ({ canView: true, canEdit: false, canComment: true }) })
    await session.refreshCapabilities()
    finish(true)
    expect(await pending).toBeNull()
    expect(host.commentThreads.some(item => item.id === thread.id)).toBe(true)
  }))
  it('历史重开使用provider，阅读模式仍可查看，撤销编辑权限则关闭并拒绝删线程', () => withCommentDocument(async ({ doc, host, provider, session, thread }) => {
    await host.resolveComment(thread.id)
    doc.setReadonly(true)
    expect(host.commentCanViewHistory()).toBe(true)
    expect(host.openCommentHistory()).toBe(true)
    await vi.waitFor(() => expect(document.querySelector('.lark-doc-comment-history')).not.toBeNull())
    await host.reopenComment(thread.id)
    expect((await provider.list())[0].resolved).toBe(false)
    session.setProvider('authorization', { getCapabilities: async () => ({ canEdit: false, canComment: true, canView: true }) })
    await session.refreshCapabilities()
    await vi.waitFor(() => expect(host.commentHistoryOpen).toBe(false))
    expect(host.openCommentHistory()).toBe(false)
    await host.deleteCommentThread(thread.id)
    expect(await provider.list()).toHaveLength(1)
  }))
  it('图片pending不发送，成功后纯图回复持久化，读取副本不影响存储', () => withCommentDocument(async ({ doc, host, provider, thread }) => {
    let finish
    doc.patchProps({ uploadImage: () => new Promise(resolve => { finish = resolve }) })
    const upload = host.addCommentAttachments(thread.id, [picture()])
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    expect(host.commentDraftReady(thread.id, '')).toBe(false)
    expect(await host.submitCommentDraft(thread.id)).toBeNull()
    finish({ url, attchId: 'comment_attachment' })
    await upload
    expect(host.commentDraftReady(thread.id, '')).toBe(true)
    await host.submitCommentDraft(thread.id)
    const saved = (await provider.list())[0].replies[1]
    expect(saved).toMatchObject({ content: '', attachments: [{ url, attchId: 'comment_attachment' }] })
    saved.attachments[0].url = '/mutated.png'
    expect((await provider.list())[0].replies[1].attachments[0].url).toBe(url)
    expect(host.commentAttachmentsOf(thread.id)).toEqual([])
  }))
  it.each(['image/webp', 'image/svg+xml'])('不把禁用类型 %s 交给上传器', mime => withCommentDocument(async ({ doc, host, thread }) => {
    const upload = vi.fn(async () => ({ url }))
    doc.patchProps({ uploadImage: upload })
    await host.addCommentAttachments(thread.id, [new File(['x'], 'unsupported', { type: mime })])
    expect(upload).not.toHaveBeenCalled()
    expect(host.commentAttachmentsOf(thread.id)[0].status).toBe('error')
    expect(host.commentDraftReady(thread.id, '')).toBe(false)
  }))
  it('移除上传任务会abort且拒绝晚结果，网络不允许时不调用未知上传服务', () => withCommentDocument(async ({ doc, host, thread }) => {
    let finish, signal
    const upload = vi.fn((file, context) => new Promise(resolve => { finish = resolve; signal = context.signal }))
    doc.patchProps({ uploadImage: upload })
    const pending = host.addCommentAttachments(thread.id, [picture()])
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    host.removeCommentAttachment(thread.id, host.commentAttachmentsOf(thread.id)[0].id)
    expect(signal.aborted).toBe(true)
    finish({ url })
    await pending
    expect(host.commentAttachmentsOf(thread.id)).toEqual([])
    doc.patchProps({ config: { network: { mode: 'offline' } } })
    await host.addCommentAttachments(thread.id, [picture()])
    expect(upload).toHaveBeenCalledOnce()
    expect(host.commentAttachmentsOf(thread.id)[0].status).toBe('error')
  }))
  it('翻译只改变阅读视图，空结果失败，取消后晚译文不呈现', () => withCommentDocument(async ({ host, provider, thread, reply }) => {
    provider.translateReply = vi.fn(async () => ({ content: 'Translated reply' }))
    host.activateComment(thread.id)
    expect(await host.runCommentService('translate', thread.id, reply.id)).toBe(true)
    expect((await provider.list())[0].replies[0].content).toBe('原评论')
    expect(host.commentServiceOf(thread.id, reply.id).content).toBe('Translated reply')
    provider.translateReply = async () => ({ content: '' })
    expect(await host.runCommentService('translate', thread.id, reply.id)).toBe(false)
    expect(host.commentServiceOf(thread.id, reply.id).error).toContain('未返回译文')
    let finish, signal
    provider.translateReply = context => new Promise(resolve => { finish = resolve; signal = context.signal })
    const pending = host.runCommentService('translate', thread.id, reply.id)
    host.cancelCommentService(thread.id, reply.id)
    expect(signal.aborted).toBe(true)
    finish({ content: 'late translation' })
    expect(await pending).toBe(false)
    expect(host.commentServiceOf(thread.id, reply.id)).toBeNull()
  }))
  it('举报只导航有效服务URL，危险地址和被阻止的弹窗均失败', () => withCommentDocument(async ({ host, provider, thread, reply }) => {
    const tab = { closed: false, opener: {}, location: { replace: vi.fn() }, close: vi.fn() }
    const open = vi.spyOn(window, 'open').mockReturnValue(tab)
    try {
      provider.reportReply = vi.fn(async () => ({ url: 'https://report.example/form' }))
      expect(await host.runCommentService('report', thread.id, reply.id)).toBe(true)
      expect(tab.opener).toBeNull()
      expect(tab.location.replace).toHaveBeenCalledWith('https://report.example/form')
      provider.reportReply = async () => ({ url: 'javascript:alert(1)' })
      expect(await host.runCommentService('report', thread.id, reply.id)).toBe(false)
      expect(tab.close).toHaveBeenCalledOnce()
      open.mockReturnValue(null)
      provider.reportReply = vi.fn()
      expect(await host.runCommentService('report', thread.id, reply.id)).toBe(false)
      expect(provider.reportReply).not.toHaveBeenCalled()
    } finally { open.mockRestore() }
  }))
  it('线程删除等待ack且防重复；失败保留，成功原子删除全部回复', () => withCommentDocument(async ({ host, provider, thread }) => {
    const actual = provider.deleteThread
    let finish
    provider.deleteThread = vi.fn(() => new Promise(resolve => { finish = resolve }))
    const pending = host.deleteCommentThread(thread.id)
    expect(await host.deleteCommentThread(thread.id)).toBeNull()
    expect(provider.deleteThread).toHaveBeenCalledOnce()
    finish(false)
    expect(await pending).toBeNull()
    expect(await provider.list()).toHaveLength(1)
    provider.deleteThread = actual
    expect(await host.deleteCommentThread(thread.id)).toBe(true)
    expect(await provider.list()).toEqual([])
  }))
})

describe('表格与链接真实评论入口', () => {
  const table = { type: 'table', attrs: { blockId: 'comment_table' }, content: Array.from({ length: 3 }, (_, row) => ({ type: 'tableRow', content: Array.from({ length: 3 }, (_, col) => ({ type: 'tableCell', content: [{ type: 'paragraph', attrs: { blockId: `cell_${row}_${col}` }, content: [{ type: 'text', text: `${'ABC'[col]}${row + 1}` }] }] })) })) }
  function selectRectangle(editor) {
    const cells = []
    editor.state.doc.descendants((node, pos) => { if (node.type.name === 'tableCell') cells.push(pos) })
    editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, cells[0], cells[4])))
  }
  it('矩形评论引用只含所选四格，稳定锚点属于表格而非首格段落', () => withCommentDocument(async ({ doc, host, provider, thread: seed }) => {
    const editor = doc.getEditor()
    editor.commands.setContent({ type: 'doc', content: [table] })
    selectRectangle(editor)
    expect(host.beginCommentComposer()).toBe(true)
    expect(host.commentComposer.quote).toBe('A1 B1 A2 B2')
    host.setCommentComposerDraft('矩形选区评论')
    const thread = await host.submitCommentComposer()
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
    expect(host.beginCommentComposer(0)).toBe(true)
    expect(host.commentComposer.quote).toBe(quote)
    host.setCommentComposerDraft('链接块评论')
    const thread = await host.submitCommentComposer()
    expect(thread.quote).toBe(quote)
    expect(thread.blockId).toBe('link_comment')
  }))
})

describe('real comment reaction and reply lifecycle', () => {
  it('opens the offline source reaction palette and renders persisted reaction chips', () => withCommentDocument(async ({ host, provider, thread, reply }) => {
    await host.runCommentReplyControl('emoji', thread.id, reply.id, { currentTarget: { getBoundingClientRect: () => ({ right: 900, top: 300 }) } })
    expect(host.commentReactionCatalog.items).toHaveLength(188)
    expect(document.querySelector('[aria-label="评论表情回复"]')).not.toBe(null)
    await host.selectCommentReaction('applaud_v2')
    expect((await provider.list())[0].replies[0].reactions).toEqual([{ emoji: 'applaud_v2', users: ['comment-owner'] }])
    await vi.waitFor(() => expect(document.querySelector('.lark-doc-comment-reaction')).not.toBe(null))
    document.querySelector('.lark-doc-comment-reaction').click()
    await vi.waitFor(async () => expect((await provider.list())[0].replies[0].reactions).toEqual([]))
  }))

  it('prefills the referenced author, preserves an existing draft and passes structured reply metadata', () => withCommentDocument(async ({ host, provider, thread, reply }) => {
    host.setCommentDraft(thread.id, '已有草稿')
    host.runCommentReplyControl('quote', thread.id, reply.id)
    expect(host.commentDraftOf(thread.id)).toBe('@我 已有草稿')
    await host.submitCommentDraft(thread.id)
    const replies = (await provider.list())[0].replies
    expect(replies[1].content).toBe('@我 已有草稿')
    expect(replies[1].replyTo).toEqual({ commentId: reply.id, authorId: 'comment-owner', authorName: '我' })
    expect(host.commentDraftOf(thread.id)).toBe('')
    expect(host.commentReplyTargets[thread.id]).toBeUndefined()
  }))

  it('rejects a late palette load after the comment provider changes', () => withCommentDocument(async ({ host, session, thread, reply }) => {
    const pending = host.runCommentReplyControl('emoji', thread.id, reply.id)
    session.setProvider('comments', createMemoryCommentsProvider())
    await pending
    expect(host.commentReaction).toBe(null)
    expect(document.querySelector('[aria-label="评论表情回复"]')).toBe(null)
  }))

  it('retains the reply target when sending only the author mention', () => withCommentDocument(async ({ host, provider, thread, reply }) => {
    host.runCommentReplyControl('quote', thread.id, reply.id)
    await host.submitCommentDraft(thread.id)
    expect((await provider.list())[0].replies[1].replyTo.commentId).toBe(reply.id)
  }))

  it('keeps the palette during internal scrolling and closes it on document scrolling', () => withCommentDocument(async ({ host, thread, reply }) => {
    await host.openCommentReaction(thread.id, reply.id)
    const palette = document.querySelector('.lark-doc-comment-reaction-picker')
    palette.querySelector('.lark-doc-comment-reaction-scroll').dispatchEvent(new Event('scroll'))
    expect(host.commentReaction).not.toBe(null)
    window.dispatchEvent(new Event('scroll'))
    expect(host.commentReaction).toBe(null)
  }))

  it('copies a real comment permalink and opens its target when loaded', () => withCommentDocument(async ({ host, thread }) => {
    const original = window.location.href
    host.copyShareText = vi.fn().mockResolvedValue(true)
    expect(await host.copyCommentAnchor(thread.id)).toBe(true)
    const url = new URL(host.copyShareText.mock.calls[0][0])
    expect(url.searchParams.get('comment_id')).toBe(thread.id)
    expect(url.searchParams.get('comment_type')).toBe('0')
    expect(url.searchParams.get('comment_anchor')).toBe('true')
    try {
      window.history.replaceState(null, '', url.href)
      host.commentActiveThreadId = ''
      expect(host.jumpCommentAnchor()).toBe(true)
      expect(host.commentActiveThreadId).toBe(thread.id)
    } finally { window.history.replaceState(null, '', original) }
  }))

  it('rejects late composition events when a replacement provider reuses the same thread id', () => withCommentDocument(async ({ host, session, provider, thread }) => {
    const oldInput = document.querySelector('.lark-doc-comment-panel:not(.lark-doc-comment-composer) .lark-doc-comment-input-zone')
    oldInput.dispatchEvent(new Event('compositionstart'))
    oldInput.textContent = '旧文档私有组合草稿'
    oldInput.dispatchEvent(new Event('input', { bubbles: true }))
    const nextProvider = createMemoryCommentsProvider({ threads: await provider.list() })
    session.setProvider('comments', nextProvider)
    oldInput.dispatchEvent(new Event('compositionend', { bubbles: true }))
    await host.loadComments()
    const input = document.querySelector('.lark-doc-comment-panel:not(.lark-doc-comment-composer) .lark-doc-comment-input-zone')
    expect(input).not.toBe(oldInput)
    expect(input.textContent).toBe('')
    expect(host.commentDraftOf(thread.id)).toBe('')
  }))

  it.each([false, true])('refuses paste ranges that extend outside the reply field (backward=%s)', backward => withCommentDocument(async ({ host, thread }) => {
    host.setCommentDraft(thread.id, 'reply field')
    const input = document.querySelector('.lark-doc-comment-panel:not(.lark-doc-comment-composer) .lark-doc-comment-input-zone')
    await vi.waitFor(() => expect(input.textContent).toBe('reply field'))
    const outside = document.createElement('span')
    outside.textContent = 'outside editable guard'
    input.parentElement.appendChild(outside)
    const selection = document.getSelection()
    if (backward) selection.setBaseAndExtent(outside.firstChild, 7, input.firstChild, 2)
    else selection.setBaseAndExtent(input.firstChild, 2, outside.firstChild, 7)
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
  const ctx = { ...extra }
  const methods = commentsMixin.methods
  Object.keys(methods).forEach((key) => {
    if (typeof ctx[key] !== 'function') ctx[key] = methods[key]
  })
  return ctx
}

describe('comment provider response identity', () => {
  it('acknowledges a successful reply even when subsequent list refresh fails', async () => {
    const provider = { reply: vi.fn(async () => ({ id: 'saved' })) }
    const ctx = mixinCtx({ session: { can: () => true, getProvider: () => provider }, commentAuthor: { id: 'me' }, commentDrafts: { thread: '正文' }, $set: (object, key, value) => { object[key] = value }, loadComments: vi.fn(async () => { throw new Error('refresh failed') }) })
    expect(await ctx.submitCommentDraft('thread')).toEqual({ id: 'saved' })
    expect(ctx.commentDrafts.thread).toBe('')
    expect(ctx.error).toContain('已保存')
    await ctx.submitCommentDraft('thread')
    expect(provider.reply).toHaveBeenCalledTimes(1)
  })
  it('does not pretend to delete when the provider cannot persist deletion', async () => {
    const threads = [{ id: 'thread', replies: [{ id: 'reply', content: '保留' }] }]
    const ctx = mixinCtx({ session: { can: () => true, getProvider: () => ({ list: async () => threads }) }, commentThreads: threads })
    expect(await ctx.deleteCommentReply('thread', 'reply')).toBeNull()
    expect(ctx.commentThreads).toBe(threads)
    expect(ctx.error).toContain('不支持')
  })

  it('does not clear a new draft typed while its previous reply is being sent', async () => {
    let complete
    const provider = { reply: () => new Promise(resolve => { complete = resolve }) }
    const ctx = mixinCtx({ session: { can: () => true, getProvider: () => provider }, commentAuthor: { id: 'me' }, commentDrafts: { thread: '已发内容' }, $set: (object, key, value) => { object[key] = value }, loadComments: vi.fn() })
    const pending = ctx.submitCommentDraft('thread')
    ctx.commentDrafts.thread = '新的草稿'
    complete({ id: 'reply' })
    await pending
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

  it('没配 session 时按 DEFAULT_CAPABILITIES 放行（八项默认 true）', () => {
    const ctx = mixinCtx({ session: null })
    expect(ctx.commentCan('canComment')).toBe(true)
    expect(ctx.commentAllowed('create')).toBe(true)
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
