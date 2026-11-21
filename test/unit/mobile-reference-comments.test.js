// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LarkDoc } from '../../src/LarkDoc'
import { createMemoryCommentsProvider } from '../../src/core/comments/memory-provider'
import { createCommentPanel } from '../../src/ui/panels'
import { createCommentComposer } from '../../src/ui/commentComposer'
import commentsMixin from '../../src/components/lark-doc/editor/commentsMixin'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss from 'postcss'

const mounted = [], width = window.innerWidth, originalMedia = window.matchMedia
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
  window.matchMedia = () => Object.assign(new EventTarget(), { matches: true })
  vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => ({ left: 0, right: 1, top: 0, bottom: 1, width: 1, height: 1 }) })
})
afterEach(() => {
  mounted.splice(0).forEach(value => value.destroy())
  document.body.replaceChildren(); vi.restoreAllMocks()
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width }); window.matchMedia = originalMedia
})

async function nativeComments(threads = []) {
  const element = document.createElement('div'); document.body.appendChild(element)
  const comments = createMemoryCommentsProvider({ threads })
  const doc = new LarkDoc({ element, storage: 'none', comments, user: { id: 'alice', name: 'Alice' }, content: '<p>正文目标</p>' }); mounted.push(doc)
  const host = doc._handle.nativeHost.host, editor = doc.getEditor()
  await host.loadComments()
  return { doc, element, host, editor, comments }
}

describe('persistent mobile comment launcher', () => {
  it('opens the side surface from the visible native reading control and restores it on collapse', async () => {
    const { doc, element, host } = await nativeComments()
    doc.setReadonly(true)
    host.refreshPanels()
    await vi.waitFor(() => expect(element.querySelector('[aria-label="展开评论"]')).not.toBeNull())
    const launch = element.querySelector('[aria-label="展开评论"]')
    launch.click()
    await vi.waitFor(() => expect(element.querySelector('.is-reference-drawer')).not.toBeNull())
    expect(host.commentMobileScope).toBe('selection')
    expect(element.querySelector('[aria-label="展开评论"]')).toBeNull()
    expect(document.body.style.overflow).not.toBe('hidden')
    element.querySelector('[aria-label="折叠评论"]').click()
    await vi.waitFor(() => expect(element.querySelector('[aria-label="展开评论"]')).not.toBeNull())
    expect(element.querySelector('.is-reference-drawer')).toBeNull()
  })

  it.each(['provider', 'view', 'feature'])('removes and rejects the old native launcher after %s loss', async reason => {
    const { element, host } = await nativeComments()
    host.refreshPanels()
    await vi.waitFor(() => expect(element.querySelector('[aria-label="展开评论"]')).not.toBeNull())
    const retired = element.querySelector('[aria-label="展开评论"]')
    if (reason === 'provider') host.session.providers.comments = null
    if (reason === 'view') vi.spyOn(host.session, 'can').mockImplementation(capability => capability !== 'canView')
    if (reason === 'feature') host.editorConfig.features.comments = false
    retired.click()
    expect(host.commentSidebarOpen).toBe(false)
    host.refreshPanels()
    expect(element.querySelector('[aria-label="展开评论"]')).toBeNull()
    retired.click(); expect(host.commentSidebarOpen).toBe(false)
  })

  it('projects a visible embedded header and falls back to the root when the header is hidden', async () => {
    const { element, host } = await nativeComments()
    const root = host.$refs.root, header = root.querySelector('.lark-doc-topbar')
    root.getBoundingClientRect = () => ({ top: 120, right: 360, left: 0, bottom: 972, height: 852, width: 360 })
    header.getBoundingClientRect = () => ({ top: 120, bottom: 184, height: 64 })
    host.refreshPanels()
    await vi.waitFor(() => expect(element.querySelector('.lark-doc-comment-launcher')?.style.top).toBe('184px'))
    expect(element.querySelector('.lark-doc-comment-launcher').style.right).toBe('33px')
    header.style.display = 'none'; host.refreshPanels()
    expect(element.querySelector('.lark-doc-comment-launcher').style.top).toBe('120px')
  })

  it('rejects the detached control and late updates after destruction without locking scroll', () => {
    const root = document.createElement('section'); root.className = 'lark-doc'
    const paper = document.createElement('div'), host = document.createElement('div'); root.append(paper, host); document.body.append(root)
    const onToggleSidebar = vi.fn(), ui = createCommentPanel({ host, inlineHost: paper, handlers: { onToggleSidebar } }); mounted.push(ui)
    const state = { launcher: { visible: true, top: 88, right: 0 } }
    ui.update(state)
    const button = root.querySelector('[aria-label="展开评论"]')
    expect(button).not.toBeNull(); button.click(); expect(onToggleSidebar).toHaveBeenCalledOnce()
    ui.update({ open: true, sidebarOpen: true, mobileOpen: true, mobileScope: 'selection' })
    button.click(); expect(onToggleSidebar).toHaveBeenCalledOnce()
    ui.destroy(); ui.update(state); button.click()
    expect(root.querySelector('[aria-label="展开评论"]')).toBeNull()
    expect(onToggleSidebar).toHaveBeenCalledOnce()
    expect(document.body.style.overflow).not.toBe('hidden')
  })
})

describe('reference page six document comments', () => {
  it('renders the real local footer and keeps unsupported document likes honest', async () => {
    const { element } = await nativeComments([{ id: 'document-thread', scope: 'document', author: { id: 'alice', name: 'Alice' },
      replies: [{ id: 'document-reply', author: { id: 'alice', name: 'Alice' }, content: '你好', createdAt: Date.now() }] }])
    await vi.waitFor(() => expect(element.querySelector('[role="region"][aria-label="全文评论"]')).not.toBeNull())
    const footer = element.querySelector('.is-inline-document')
    expect(footer.textContent).toContain('真诚点赞，手留余香')
    expect(footer.querySelector('.lark-doc-document-comment-heading').textContent).toBe('全文评论')
    expect(footer.querySelector('[data-comment-thread="document-thread"]').textContent).toContain('你好')
    expect(footer.querySelector('.lark-doc-comment-avatar').textContent).toBe('A')
    const like = footer.querySelector('[aria-label="点赞文档"]')
    expect(like.disabled).toBe(true); expect(like.title).toContain('未配置')
    expect(footer.querySelector('[aria-label="全文评论插入图片"]')).not.toBeNull()
    expect(footer.querySelector('[aria-label="全文评论"]').getAttribute('aria-readonly')).toBe('false')
    expect(footer.querySelector('[aria-label="更多全文评论操作"]')).not.toBeNull()
    expect(footer.querySelector('[aria-label="返回顶部"]')).not.toBeNull()
    expect(document.body.style.overflow).not.toBe('hidden')
  })

  it('preserves authoritative image and mention content in the flat footer', () => {
    const paper = document.createElement('div'), host = document.createElement('div'); document.body.append(paper, host)
    const onPreviewAttachment = vi.fn(), onBackToTop = vi.fn()
    const ui = createCommentPanel({ host, inlineHost: paper, composerFactory: createCommentComposer, handlers: { onPreviewAttachment, onBackToTop } }); mounted.push(ui)
    ui.update({ documentInline: true, documentComposer: { open: true, value: '', canUploadImage: true }, items: [{ id: 'doc', documentOnly: true,
      replies: [{ id: 'reply', name: '崔健军', time: '11月12日 15:51', segments: [{ text: '@崔健军', principalId: 'alice', isSelf: true }, { text: ' 你好' }],
        attachments: [{ attchId: 'image', name: 'photo.png', url: '/fixtures/photo.png' }] }] }] })
    expect(ui.el.querySelector('.lark-doc-comment-avatar').textContent).toBe('健军')
    expect(ui.el.querySelector('[data-comment-mention]')?.textContent).toBe('@崔健军')
    // 已存附件与基线同口径：图包在 `.lark-doc-comment-attachment-preview` 按钮里，
    // aria 是「预览评论图片N」，且绑的是 mousedown（`onMouseDownPrevent`），不是 click。
    const preview = ui.el.querySelector('[aria-label="预览评论图片1"]')
    expect(preview.className).toBe('lark-doc-comment-attachment-preview')
    preview.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(onPreviewAttachment).toHaveBeenCalledWith('doc', 'reply', 0)
    ui.el.querySelector('[aria-label="返回顶部"]').click(); expect(onBackToTop).toHaveBeenCalledOnce()
    ui.update({ identityGeneration: 2, documentInline: false, open: false, items: [], documentComposer: { open: false } })
    expect(ui.el.textContent).not.toContain('@崔健军')
    expect(document.body.style.overflow).not.toBe('hidden')
  })

  it('retires footer controls and refuses a late update after destruction', () => {
    const host = document.createElement('div'), paper = document.createElement('div'); document.body.append(host, paper)
    const onDocumentComposerSubmit = vi.fn(), ui = createCommentPanel({ host, inlineHost: paper, handlers: { onDocumentComposerSubmit } }); mounted.push(ui)
    const state = { documentInline: true, documentComposer: { open: true, value: 'draft', canSubmit: true } }
    ui.update(state)
    const send = ui.el.querySelector('[aria-label="发送全文评论"]')
    ui.update({ documentInline: false, open: true, sidebarOpen: true, mobileScope: 'selection', documentComposer: { open: false } })
    send.click(); expect(onDocumentComposerSubmit).not.toHaveBeenCalled()
    ui.destroy(); ui.update(state); send.click()
    expect(ui.el.isConnected).toBe(false); expect(onDocumentComposerSubmit).not.toHaveBeenCalled()
    expect(document.body.style.overflow).not.toBe('hidden')
  })

  it('submits a local document comment through the visible native footer without changing body content', async () => {
    const { element, host, editor, comments } = await nativeComments()
    const baseline = editor.getJSON()
    host.setCommentDocumentDraft('@Bob doc', [{ principalId: 'bob', from: 0, to: 4 }], [{ docId: 'doc', from: 5, to: 8 }])
    await vi.waitFor(() => expect(element.querySelector('[aria-label="发送全文评论"]')?.disabled).toBe(false))
    element.querySelector('[aria-label="发送全文评论"]').click()
    await vi.waitFor(() => expect(host.commentDocumentDraft).toBe(''))
    expect(await comments.list()).toMatchObject([{ scope: 'document', anchor: null, blockId: null,
      replies: [{ content: '@Bob doc', mentions: [{ principalId: 'bob', from: 0, to: 4 }], references: [{ docId: 'doc', from: 5, to: 8 }] }] }])
    expect(editor.getJSON()).toEqual(baseline)
    await vi.waitFor(() => expect(element.querySelector('.is-inline-document [data-comment-mention]')?.textContent).toBe('@Bob'))
  })

  it('keeps a local private selection draft unsent when the service cannot protect it', async () => {
    const { host, editor, comments } = await nativeComments()
    editor.commands.setTextSelection({ from: 1, to: 3 })
    expect(host.openSelectionComment()).toBe(true)
    const create = vi.spyOn(comments, 'createThread')
    expect(await host.createCommentFromSelection('私有选区草稿', 'private')).toBeNull()
    expect(create).not.toHaveBeenCalled()
    expect(host.commentCreateDraft).toBe('私有选区草稿')
    expect(host.commentMessage).toContain('全文私有评论')
  })

  it('projects local private document threads only for their real author or listed participant', async () => {
    const row = (id, participants) => ({ id, scope: 'document', visibility: 'private', participants, author: { id: 'bob', name: 'Bob' },
      replies: [{ id: 'reply-' + id, author: { id: 'bob', name: 'Bob' }, content: id }] })
    const { host, element } = await nativeComments([row('hidden-private', []), row('allowed-private', ['alice'])])
    await vi.waitFor(() => expect(element.querySelector('[data-comment-thread="allowed-private"]')).not.toBeNull())
    expect(host.commentThreads.map(thread => thread.id)).toEqual(['allowed-private'])
    expect(element.textContent).not.toContain('hidden-private')
    expect(host.commentPrivate('allowed-private')).toBe(true)
  })

  it.each(['provider', 'document'])('rejects a late local document acknowledgement after %s changes', async reason => {
    const { host, comments } = await nativeComments()
    const create = comments.createThread; let complete
    comments.createThread = input => new Promise(resolve => { complete = async () => resolve(await create(input)) })
    const pending = host.createDocumentComment('old private draft', 'private')
    if (reason === 'provider') host.session.setProvider('comments', createMemoryCommentsProvider())
    else host.session.documentId = 'different-document'
    await complete()
    expect(await pending).toBeNull()
    expect(host.commentThreads.some(thread => thread.replies.some(reply => reply.content === 'old private draft'))).toBe(false)
  })
})

describe('reference page seven anchored comments drawer', () => {
  it('keeps the sticky drawer header above every card stacking context without changing desktop stacking', () => {
    // jsdom cannot hit-test a scrolled sticky element. Guard the actual cascade
    // relationship responsible for reply text covering the native reader button.
    const css = postcss.parse(readFileSync(resolve(__dirname, '../../src/styles/comments.css'), 'utf8'))
    const rules = new Map()
    css.walkRules(rule => rules.set(rule.selector, rule))
    const base = rules.get('.lark-doc .lark-doc-comment-panel')
    const card = rules.get('.lark-doc .lark-doc-comment-layer.is-reference-drawer .lark-doc-comment-panel')
    const header = rules.get('.lark-doc .lark-doc-comment-layer.is-reference-drawer > .lark-doc-comment-sidebar-head')
    const value = (rule, prop) => rule.nodes.filter(node => node.type === 'decl' && node.prop === prop).at(-1)?.value
    expect(card.parent.name).toBe('media')
    expect(card.parent.params).toContain('max-width: 760px')
    expect(value(header, 'position')).toBe('sticky')
    expect(value(card, 'position')).toBe('relative')
    const cardLayer = Number(value(card, 'z-index') ?? value(base, 'z-index'))
    expect(Number(value(header, 'z-index'))).toBeGreaterThan(cardLayer)
    expect(Number.isFinite(Number(value(card, 'z-index')))).toBe(true)
  })
  it('opens an anchored vertical reader, scrolls quote with long replies and changes anchor only from its edge', () => {
    const host = document.createElement('section'); host.className = 'lark-doc'; document.body.append(host)
    const onActivate = vi.fn(), ui = createCommentPanel({ host, handlers: { onActivate } }); mounted.push(ui)
    const items = ['first', 'second', 'third'].map(id => ({ id, quote: id, replies: [{ id: `${id}-reply`, name: '作者', content: '长评论'.repeat(100) }], draft: '', style: { marginTop: '190.5px' } }))
    const state = { open: true, sidebarOpen: true, mobileOpen: true, mobileScope: 'selection', activeThreadId: 'second', items }
    ui.update(state)
    expect(ui.el.querySelector('[data-comment-thread="second"]').style.marginTop).toBe('190.5px')
    ui.el.querySelector('[aria-label="逐条查看评论"]').click()
    expect(ui.el.querySelector('[data-comment-thread="second"]').style.marginTop).toBe('0px')
    const scroller = ui.el.querySelector('[data-comment-thread="second"] .lark-doc-comment-thread-scroll')
    expect(scroller.querySelector('.lark-doc-comment-head')).not.toBeNull()
    expect(scroller.querySelector('.lark-doc-comment-replies')).not.toBeNull()
    expect(scroller.querySelector('.lark-doc-comment-textarea')).toBeNull()
    Object.defineProperties(scroller, { clientHeight: { value: 200 }, scrollHeight: { value: 700 } })
    const touch = (type, y) => { const e = new Event(type, { bubbles: true, cancelable: true }); Object.defineProperty(e, type === 'touchend' ? 'changedTouches' : 'touches', { value: [{ clientY: y, clientX: 100 }] }); scroller.dispatchEvent(e) }
    scroller.scrollTop = 100; touch('touchstart', 300); touch('touchend', 120)
    expect(onActivate).not.toHaveBeenCalled()
    scroller.scrollTop = 500; touch('touchstart', 300); touch('touchend', 120)
    expect(onActivate).toHaveBeenLastCalledWith('third')
    ui.update({ ...state, activeThreadId: 'third' }); ui.update(state)
    expect(scroller.scrollTop).toBe(0)
    ui.el.querySelector('[aria-label="关闭评论"]').click()
    expect(ui.el.classList.contains('is-reference-drawer')).toBe(true)
    expect(ui.el.querySelector('[data-comment-thread="second"]').style.marginTop).toBe('190.5px')
  })
  it('reveals reply tools only after activating a card and retains its draft across deactivation and collapse', async () => {
    const { element, host, editor, comments } = await nativeComments()
    const blockId = editor.state.doc.firstChild.attrs.blockId, author = { id: 'alice', name: 'Alice' }
    const first = await comments.createThread({ blockId, author, content: 'First comment', quote: '正文' })
    const second = await comments.createThread({ blockId, author, content: 'Second comment', quote: '目标' })
    await host.loadComments(); host.refreshPanels()
    await vi.waitFor(() => expect(element.querySelector('[aria-label="展开评论"]')).not.toBeNull())
    const baseline = editor.getJSON()
    element.querySelector('[aria-label="展开评论"]').click()
    const card = id => element.querySelector(`[data-comment-thread="${id}"]`)
    await vi.waitFor(() => expect(card(first.id)).not.toBeNull())
    expect(card(first.id).querySelector('.lark-doc-comment-textarea')).toBeNull()
    expect(card(first.id).querySelector('.lark-doc-comment-reply-controls')).toBeNull()
    card(first.id).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(card(first.id).querySelector('.lark-doc-comment-textarea')).toBeNull()
    card(first.id).click()
    await vi.waitFor(() => expect(card(first.id).querySelector('[aria-label="回复"]')).not.toBeNull())
    const input = card(first.id).querySelector('[aria-label="回复"]')
    host.setCommentDraft(first.id, 'Retained reply draft')
    await vi.waitFor(() => expect(input.textContent).toBe('Retained reply draft'))
    expect(card(first.id).querySelector('.lark-doc-comment-reply-controls')).not.toBeNull()
    card(second.id).click()
    await vi.waitFor(() => expect(card(first.id).querySelector('.lark-doc-comment-textarea')).toBeNull())
    expect(host.commentDrafts[first.id]).toBe('Retained reply draft')
    card(first.id).click()
    await vi.waitFor(() => expect(card(first.id).querySelector('[aria-label="回复"]')).toBe(input))
    element.querySelector('[aria-label="折叠评论"]').click()
    await vi.waitFor(() => expect(element.querySelector('[aria-label="展开评论"]')).not.toBeNull())
    element.querySelector('[aria-label="展开评论"]').click()
    await vi.waitFor(() => expect(card(first.id)).not.toBeNull())
    expect(card(first.id).querySelector('.lark-doc-comment-textarea')).toBeNull()
    card(first.id).click()
    await vi.waitFor(() => expect(card(first.id).querySelector('[aria-label="回复"]').textContent).toBe('Retained reply draft'))
    expect(editor.getJSON()).toEqual(baseline)
  })

  it('shows a counted nonmodal side region, collapses back to the footer and retains local composer cancellation', async () => {
    const { element, host, editor } = await nativeComments()
    Object.defineProperty(host.$refs.paper, 'scrollHeight', { configurable: true, value: 1200 })
    editor.commands.setTextSelection({ from: 1, to: 3 })
    await host.createCommentFromSelection('选区评论')
    await vi.waitFor(() => expect(element.querySelector('.is-reference-drawer')).not.toBeNull())
    const drawer = element.querySelector('.is-reference-drawer')
    expect(drawer.getAttribute('role')).toBe('complementary')
    expect(drawer.parentElement).toBe(element.querySelector('.lark-doc-main'))
    expect(drawer.style.minHeight).toBe('1200px')
    expect(drawer.textContent).toContain('评论 (1)')
    expect(drawer.querySelector('.lark-doc-comment-mobile-sheet')).toBeNull()
    expect(element.querySelector('.lark-doc-paper .is-drawer-document [aria-label="全文评论"]')).not.toBeNull()
    expect(document.body.style.overflow).not.toBe('hidden')
    drawer.querySelector('[aria-label="折叠评论"]').click()
    await vi.waitFor(() => expect(element.querySelector('.is-inline-document')).not.toBeNull())
    expect(element.querySelector('.is-reference-drawer')).toBeNull()
    editor.commands.setTextSelection({ from: 1, to: 3 })
    expect(host.openSelectionComment()).toBe(true); host.setCommentCreateDraft('保留草稿')
    await vi.waitFor(() => expect(element.querySelector('[aria-label="输入评论"]')).not.toBeNull())
    element.querySelector('[aria-label="取消新评论"]').click()
    await vi.waitFor(() => expect(element.querySelector('[aria-label="输入评论"]')).toBeNull())
    expect(host.commentCreateDraft).toBe('保留草稿')
  })

  it('keeps quoted anchors and actual reaction users actionable without inventing a fixed count', () => {
    const host = document.createElement('div'); document.body.append(host)
    const onLocate = vi.fn(), onReaction = vi.fn()
    const ui = createCommentPanel({ host, handlers: { onLocate, onReaction } }); mounted.push(ui)
    ui.update({ open: true, sidebarOpen: true, mobileOpen: true, mobileScope: 'selection', title: '评论 (2)', items: [
      { id: 'image', quote: '[图片]', replies: [{ id: 'r1', name: '崔健军', body: '你好', reactions: [{ emoji: '👍', count: 1, people: '崔健军', canReact: true }] }] },
      { id: 'heading', quote: 'H1 下一节核验标题', replies: [{ id: 'r2', name: 'Alice', body: '标题评论' }] },
    ] })
    const quote = ui.el.querySelector('.lark-doc-comment-quote'); quote.click()
    expect(onLocate).toHaveBeenCalledWith('image')
    const reaction = ui.el.querySelector('.lark-doc-comment-reaction')
    expect(reaction.textContent).toContain('👍｜崔健军'); reaction.click()
    expect(onReaction).toHaveBeenCalledWith('image', 'r1', '👍', true)
    expect(ui.el.textContent).toContain('评论 (2)'); expect(ui.el.textContent).not.toContain('评论 (3)')
    expect(document.body.style.overflow).not.toBe('hidden')
  })

  it('uses real source block positions in the shared scroller to space anchored cards', () => {
    const main = { scrollTop: 200, getBoundingClientRect: () => ({ top: 64 }) }
    const owner = { _mobileEditorMedia: { matches: true }, commentSidebarOpen: true, commentComposerOpen: false,
      commentPanels: [{ id: 'image', blockId: 'image' }, { id: 'heading', blockId: 'heading' }],
      $refs: { root: { querySelector: () => main } }, $el: { querySelector: () => null }, updateCommentLayerBounds: vi.fn(),
      commentBlockPos: id => id === 'image' ? 1 : 2, commentPanelHeightOf: () => 100,
      // 重排结果经 `commitCommentPanels` 写回（生产由 `commentsMixin.methods` 合并进来），
      // 手工 owner 直接取真实现，免得再抄一份「只在变了才写」的比较逻辑。
      commitCommentPanels: commentsMixin.methods.commitCommentPanels,
      editor: { view: { nodeDOM: pos => ({ getBoundingClientRect: () => ({ top: pos === 1 ? 400 : 600 }) }) } } }
    commentsMixin.methods.placeCommentPanels.call(owner)
    expect(owner.commentPanels.map(item => ({ top: item.top, gap: item.gap }))).toEqual([{ top: 536, gap: 471 }, { top: 736, gap: 64 }])
  })
})

describe('document likes use the existing authoritative information port', () => {
  function owner(provider) {
    const session = { user: { id: 'alice' }, _privateIdentityGeneration: 1, _authorizationGeneration: 1, getProvider: () => provider }
    return { ...commentsMixin.data(), ...commentsMixin.methods, session, commentCan: () => true }
  }
  it('queries an unknown original operation before accepting a committed like', async () => {
    const documentInformation = vi.fn(async (action, input) => {
      if (action === 'operation') return null
      if (action === 'read') return { revision: '1', total: '0', liked: false }
      if (action === 'request') throw Object.assign(new Error('unknown'), { status: 'unknown', operationId: 'original-like' })
      if (action === 'query' && input === 'original-like') return { status: 'committed', like: { revision: '2', total: '1', liked: true } }
    })
    const host = owner({ isRemote: true, documentInformation })
    await host.loadDocumentCommentLikes(); expect(await host.toggleDocumentCommentLike()).toBe(false)
    expect(host.commentDocumentLike.snapshot.liked).toBe(false)
    expect(host.commentDocumentLike.pending).toBe('original-like')
    expect(await host.toggleDocumentCommentLike()).toBe(true)
    expect(host.commentDocumentLike.snapshot.liked).toBe(true)
    expect(documentInformation.mock.calls.filter(call => call[0] === 'request')).toHaveLength(1)
    expect(documentInformation).toHaveBeenCalledWith('query', 'original-like')
  })
  it('drops a late like read after the principal changes', async () => {
    let finish
    const host = owner({ isRemote: true, documentInformation: (action) => action === 'operation' ? null : new Promise(resolve => { finish = resolve }) })
    const pending = host.loadDocumentCommentLikes()
    await Promise.resolve(); host.session._privateIdentityGeneration++
    finish({ revision: '9', total: '999', liked: true }); await pending
    expect(host.commentDocumentLike.snapshot).toBeNull()
  })
})

describe('document comment read ownership', () => {
  it.each(['resolve', 'reject'])('does not publish an old document read after same-session document change (%s)', async outcome => {
    let finish, fail
    const provider = { list: () => new Promise((resolve, reject) => { finish = resolve; fail = reject }) }
    const session = { documentId: 'old-document', user: { id: 'alice' }, getProvider: () => provider }
    const host = { ...commentsMixin.data(), ...commentsMixin.methods, session, commentCan: () => true, commentAuthor: { id: 'alice' },
      resetCommentImages: vi.fn(), closeCommentReaction: vi.fn(), syncCommentImages: vi.fn(), installCommentDecorations: vi.fn(),
      refreshCommentDecorations: vi.fn(), updateCommentPanels: vi.fn() }
    const pending = host.loadComments().catch(error => error)
    session.documentId = 'new-document'
    const current = [{ id: 'current-thread' }]
    host.commentThreads = current; host.commentSourceThreads = current; host.commentMessage = 'current document notice'
    if (outcome === 'resolve') finish([{ id: 'old-private', scope: 'document', visibility: 'private', author: { id: 'alice' }, replies: [{ content: 'old document secret' }] }])
    else fail(new Error('old document read failed'))
    expect(await pending).toEqual([])
    expect(host.commentThreads).toBe(current); expect(host.commentSourceThreads).toBe(current)
    expect(host.commentMessage).toBe('current document notice')
    expect(host.refreshCommentDecorations).not.toHaveBeenCalled()
  })
})


describe('comment drawer root input belongs to document flow', () => {
  function surface(patch = {}) {
    const root = document.createElement('section'), main = document.createElement('main'), paper = document.createElement('div'), host = document.createElement('div')
    root.className = 'lark-doc'; main.className = 'lark-doc-main'; paper.className = 'lark-doc-paper'
    root.append(main, host); main.append(paper); document.body.append(root)
    const handlers = { onCloseMobile: vi.fn(), onComposerCancel: vi.fn(), onDocumentComposerSubmit: vi.fn() }
    const ui = createCommentPanel({ host, inlineHost: paper, handlers }); mounted.push(ui)
    ui.update({ open: true, sidebarOpen: true, mobileOpen: true, mobileScope: 'selection', activeThreadId: 'first',
      items: [{ id: 'first', quote: '图片引用', replies: [{ id: 'reply', name: '作者', content: '长评论'.repeat(100) }], draft: '' }], ...patch })
    return { ui, handlers }
  }
  function rootScroll(ui, type) {
    const event = new Event(type, { bubbles: true, cancelable: true })
    ui.el.dispatchEvent(event)
    return event.defaultPrevented
  }
  function rootPress(ui) {
    const event = new MouseEvent('pointerdown', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'pointerId', { value: 1 })
    ui.el.dispatchEvent(event)
  }
  function rootClick(ui) { ui.el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) }
  it.each([false, true])('drawer blank root preserves touch/wheel scrolling and never dismisses (readonly=%s)', readonly => {
    const { ui, handlers } = surface({ documentComposer: { open: true, readonly } })
    expect(ui.el.classList.contains('is-reference-drawer')).toBe(true)
    expect(ui.el.getAttribute('role')).toBe('complementary')
    expect(rootScroll(ui, 'touchmove')).toBe(false)
    expect(rootScroll(ui, 'wheel')).toBe(false)
    rootPress(ui); rootClick(ui)
    expect(handlers.onCloseMobile).not.toHaveBeenCalled()
    expect(handlers.onComposerCancel).not.toHaveBeenCalled()
    expect(handlers.onDocumentComposerSubmit).not.toHaveBeenCalled()
    expect(ui.el.classList.contains('is-reference-drawer')).toBe(true)
    expect(document.body.style.overflow).not.toBe('hidden')
  })
  it('real modal root still blocks backdrop scrolling and dismisses a gesture started on the mask', () => {
    const { ui, handlers } = surface({ composer: { open: true, value: 'draft' } })
    expect(ui.el.classList.contains('is-reference-drawer')).toBe(false)
    expect(rootScroll(ui, 'touchmove')).toBe(true)
    expect(rootScroll(ui, 'wheel')).toBe(true)
    rootPress(ui); rootClick(ui)
    expect(handlers.onComposerCancel).toHaveBeenCalledOnce()
    expect(handlers.onCloseMobile).toHaveBeenCalledOnce()
  })
  it('native thread root remains a mask and closes back to the drawer', () => {
    const { ui, handlers } = surface()
    ui.el.querySelector('[aria-label="逐条查看评论"]').click()
    expect(ui.el.classList.contains('is-reference-drawer')).toBe(false)
    expect(rootScroll(ui, 'touchmove')).toBe(true)
    expect(rootScroll(ui, 'wheel')).toBe(true)
    rootPress(ui); rootClick(ui)
    expect(ui.el.classList.contains('is-reference-drawer')).toBe(true)
    expect(handlers.onCloseMobile).not.toHaveBeenCalled()
    expect(document.body.style.overflow).not.toBe('hidden')
  })
  it('inline document root keeps its existing scroll and blank-click behavior', () => {
    const { ui, handlers } = surface({ open: false, sidebarOpen: false, mobileScope: 'document', documentInline: true })
    expect(ui.el.classList.contains('is-inline-document')).toBe(true)
    expect(rootScroll(ui, 'touchmove')).toBe(false)
    expect(rootScroll(ui, 'wheel')).toBe(false)
    rootPress(ui); rootClick(ui)
    expect(handlers.onCloseMobile).not.toHaveBeenCalled()
  })
  it('a press begun on drawer flow cannot become a mask-dismiss click after a mode change', () => {
    const { ui, handlers } = surface()
    rootPress(ui)
    ui.update({ composer: { open: true, value: 'new draft' } })
    rootClick(ui)
    expect(handlers.onCloseMobile).not.toHaveBeenCalled()
    expect(handlers.onComposerCancel).not.toHaveBeenCalled()
    rootPress(ui); rootClick(ui)
    expect(handlers.onCloseMobile).toHaveBeenCalledOnce()
    expect(handlers.onComposerCancel).toHaveBeenCalledOnce()
  })
})


it('retires document-menu density when only the cached thread documentOnly flag changes', () => {
  const host = document.createElement('div'), main = document.createElement('div'), inlineHost = document.createElement('div')
  host.className = 'lark-doc'; main.className = 'lark-doc-main'; main.append(inlineHost); host.append(main); document.body.append(host)
  const onMobileMenuItem = vi.fn(), ui = createCommentPanel({ host, inlineHost, handlers: { onMobileMenuItem } }); mounted.push(ui)
  const menus = Array.from({ length: 9 }, (_, index) => ({ id: `menu-${index}`, label: `操作${index}`, visible: true, icon: 'copy' }))
  const replies = [{ id: 'same-reply', name: '作者', body: '相同评论', menuOpen: true, mobileMenu: true, menuScope: { current: () => true }, menus }]
  const state = { open: true, sidebarOpen: true, documentInline: true, mobileScope: 'selection', mobileOpen: true,
    activeThreadId: 'same-thread', replyControls: [{ id: 'more', label: '更多' }] }
  const render = documentOnly => {
    ui.update({ ...state, items: [{ id: 'same-thread', documentOnly, replies }] })
    return host.querySelector('.lark-doc-comment-reply-menu')
  }
  const original = render(true), oldRow = original.querySelector('[role="menuitem"]')
  expect(original.isConnected).toBe(true)
  expect(original.classList.contains('is-mobile-document-menu')).toBe(true)
  expect(original.style.maxWidth).toBe('326px')
  const anchored = render(false)
  expect(anchored.isConnected).toBe(true)
  expect(anchored.classList.contains('is-mobile-document-menu')).toBe(false)
  expect(anchored.style.maxWidth).toBe('328px')
  expect(original.isConnected).toBe(false)
  oldRow.click(); expect(onMobileMenuItem).not.toHaveBeenCalled()
  anchored.querySelector('[role="menuitem"]').click(); expect(onMobileMenuItem).toHaveBeenCalledTimes(1)
})

it('limits document-menu density to the current mobile nine-action surface and clears it when the same reply is reused', () => {
  const host = document.createElement('div'); document.body.append(host)
  const onMobileMenuItem = vi.fn(), ui = createCommentPanel({ host, handlers: { onMobileMenuItem } }); mounted.push(ui)
  const labels = ['回复', '复制', '解决并隐藏', '编辑', '转发', '复制链接', '翻译', '删除', '举报']
  const menus = labels.map((label, index) => ({ id: `menu-${index}`, label, visible: true, icon: 'copy' }))
  const item = { id: 'density-thread', documentOnly: true, replies: [{ id: 'density-reply', name: '作者', body: '正文', menuOpen: true,
    mobileMenu: true, menuScope: { current: () => true }, menus }] }
  const render = (documentOnly, mobileMenu, count) => {
    ui.update({ open: true, sidebarOpen: !documentOnly, documentInline: documentOnly, mobileScope: documentOnly ? 'document' : 'selection', mobileOpen: true, activeThreadId: item.id,
      replyControls: [{ id: 'more', label: '更多' }], items: [{ ...item, documentOnly,
        replies: [{ ...item.replies[0], mobileMenu, menus: menus.slice(0, count) }] }] })
    return host.querySelector('.lark-doc-comment-reply-menu')
  }
  const documentMenu = render(true, true, 9), retiredCopy = documentMenu.querySelector('[role="menuitem"]')
  expect(documentMenu.classList.contains('is-mobile-document-menu')).toBe(true)
  expect(documentMenu.querySelectorAll('[role="menuitem"]')).toHaveLength(9)
  const anchored = render(false, true, 6)
  expect(anchored.classList.contains('is-mobile-menu')).toBe(true)
  expect(anchored.classList.contains('is-mobile-document-menu')).toBe(false)
  expect(host.querySelector('.is-mobile-document-menu')).toBeNull()
  retiredCopy.click(); expect(onMobileMenuItem).not.toHaveBeenCalled()
  const desktop = render(true, false, 4)
  expect(desktop.classList.contains('is-mobile-menu')).toBe(false)
  expect(desktop.classList.contains('is-mobile-document-menu')).toBe(false)
  expect(desktop.querySelector('[data-comment-quick-reaction]')).toBeNull()
  expect(render(true, true, 6).classList.contains('is-mobile-document-menu')).toBe(false)
  expect(render(true, true, 9).classList.contains('is-mobile-document-menu')).toBe(true)
})

it('keeps the nine-action density scoped to the document variant and leaves the six-action and desktop rows alone', () => {
  // Numbers come from the real-device capture native-comment-more-verified
  // (1080×2400 @2.75 → 393 CSS px) and its XML bounds: label rows 91.3 CSS
  // apart, first label 52 CSS below the card top, 11px/15px labels.
  const css = postcss.parse(readFileSync(resolve(__dirname, '../../src/styles/comments.css'), 'utf8'))
  const rules = new Map()
  css.walkRules(rule => rules.set(rule.selector, rule))
  const value = (selector, prop) => rules.get(selector)?.nodes.filter(node => node.type === 'decl' && node.prop === prop).at(-1)?.value
  const box = '.lark-doc .lark-doc-comment-reply-menu.is-mobile-menu.is-mobile-document-menu'
  const list = '.lark-doc .is-mobile-document-menu .lark-doc-comment-menu-list[role="menu"]'
  const item = '.lark-doc .is-mobile-document-menu .lark-doc-comment-menu-item'
  expect(value(box, 'width')).toBe('326px')
  expect(value(box, 'max-width')).toBe('326px')
  // 19px top inset puts the first label 52px below the card top (native 143/2.75).
  expect(value(box, 'padding')).toBe('19px 4px 2px')
  expect(value(list, 'row-gap')).toBe('27px')
  expect(value(list, 'column-gap')).toBe('2px')
  expect(value(item, 'padding')).toBe('0 1px')
  expect(value(item, 'gap')).toBe('12px')
  expect(value(item, 'font-size')).toBe('11px')
  expect(value(item, 'line-height')).toBe('15px')
  expect(value('.lark-doc .is-mobile-document-menu .lark-doc-comment-quick-reactions', 'margin-top')).toBe('0px')
  // Row pitch: native 1377→1628 device = 91.3 CSS; the phone item min-height is
  // 64px, so the 27px row gap is what reproduces it.
  expect(value('.lark-doc .is-mobile-menu .lark-doc-comment-menu-item', 'min-height')).toBe('64px')
  expect(64 + 27).toBe(91)
  // Label box: 326 − 8 padding − 5×2 column gaps = 318 → 51.33 per column, minus
  // the 1px item insets. Four 11px glyphs (复制链接) fit, five (解决并隐藏) wrap 4+1.
  const column = (326 - 2 * 4 - 5 * 2) / 6
  const labelBox = column - 2 * 1
  expect(labelBox).toBeGreaterThanOrEqual(4 * 11)
  expect(labelBox).toBeLessThan(5 * 11)
  // Untouched surfaces: the anchored six-action phone row and the base card.
  expect(value('.lark-doc .lark-doc-comment-reply-menu.is-mobile-menu', 'width')).toBe('328px')
  expect(value('.lark-doc .is-mobile-menu .lark-doc-comment-menu-item', 'font-size')).toBe('12px')
  expect(value('.lark-doc .is-mobile-menu .lark-doc-comment-menu-item', 'line-height')).toBe('16px')
})

describe('M20 mobile reply More actions', () => {
  const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  afterEach(() => { if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard); else delete navigator.clipboard })
  const row = (author = 'alice', content = '你好\n@Bob 原文') => ({ id: 'm20', scope: 'document', author: { id: author, name: author },
    replies: [{ id: 'm20-reply', author: { id: author, name: author }, content, createdAt: Date.now() }] })
  const more = async element => {
    await vi.waitFor(() => expect(element.querySelector('[data-comment-reply="m20-reply"] [data-comment-reply-control="more"]')).not.toBeNull())
    element.querySelector('[data-comment-reply="m20-reply"] [data-comment-reply-control="more"]').click()
    await vi.waitFor(() => expect(element.querySelector('[data-comment-reply="m20-reply"] [role="menu"]')).not.toBeNull())
    return element.querySelector('[data-comment-reply="m20-reply"] [role="menu"]')
  }
  const action = (menu, name) => [...menu.querySelectorAll('[role="menuitem"]')].find(node => node.querySelector('.lark-doc-comment-menu-label')?.textContent === name)

  it('projects nine full-document actions, six real reactions and the existing picker while keeping drafts on reply', async () => {
    const { element, host, comments, editor } = await nativeComments([row()])
    host.commentReactionCatalog = { items: [] }
    const baseline = editor.getJSON(), react = vi.spyOn(comments, 'react')
    host.setCommentDocumentDraft('保留草稿')
    let menu = await more(element)
    expect([...menu.querySelectorAll('[role="menuitem"]')].map(node => node.querySelector('.lark-doc-comment-menu-label')?.textContent)).toEqual(['回复', '复制', '解决并隐藏', '编辑', '转发', '复制链接', '翻译', '删除', '举报'])
    expect(action(menu, '转发').getAttribute('aria-disabled')).toBe('true')
    expect(action(menu, '转发').title).toContain('未接入')
    expect(action(menu, '复制链接').getAttribute('aria-disabled')).toBe('true')
    expect(action(menu, '翻译').title).toContain('未接通')
    expect(action(menu, '举报').title).toBe('举报服务未接入')
    const reportIcon = action(menu, '举报').querySelector('[data-comment-menu-glyph]')
    expect(reportIcon?.textContent).toBe('⚠︎'); expect(reportIcon?.getAttribute('aria-hidden')).toBe('true')
    const quick = menu.parentElement.querySelectorAll('[data-comment-quick-reaction]')
    expect(quick).toHaveLength(6)
    quick[0].click(); quick[0].click()
    await vi.waitFor(async () => expect((await comments.list())[0].replies[0].reactions[0].users).toEqual(['alice']))
    await vi.waitFor(() => expect(host.commentBusy).toBe(false))
    expect(react).toHaveBeenCalledOnce()
    menu = await more(element)
    const mine = menu.parentElement.querySelector('[data-comment-quick-reaction]')
    expect(mine.getAttribute('aria-pressed')).toBe('true'); mine.click()
    await vi.waitFor(async () => expect((await comments.list())[0].replies[0].reactions).toEqual([]))
    expect(react).toHaveBeenCalledTimes(2)
    menu = await more(element)
    menu.parentElement.querySelector('[aria-label="更多表情回复"]').click()
    await vi.waitFor(() => expect(host.commentReactionContext).toMatchObject({ threadId: 'm20', replyId: 'm20-reply' }))
    host.closeCommentReaction(); host.refreshPanels()
    menu = await more(element)
    action(menu, '回复').click()
    await vi.waitFor(() => expect(document.activeElement?.classList.contains('lark-doc-document-composer-input')).toBe(true))
    expect(host.commentDocumentDraft).toBe('保留草稿')
    expect(host.commentDocumentReplyTarget).toMatchObject({ principalId: 'alice' })
    expect(editor.getJSON()).toEqual(baseline)
  })

  it('copies only visible reply text synchronously, handles rejection and ignores a late success after actor retirement', async () => {
    let finish
    const writeText = vi.fn(() => new Promise(resolve => { finish = resolve }))
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const { element, host } = await nativeComments([row()])
    const menu = await more(element)
    action(menu, '复制').click()
    expect(writeText).toHaveBeenCalledExactlyOnceWith('你好\n@Bob 原文')
    host.session.user = { id: 'other' }
    finish(); await Promise.resolve(); await Promise.resolve()
    expect(host.commentMessage).not.toContain('已复制')
    const second = await nativeComments([row()])
    writeText.mockRejectedValueOnce(new Error('clipboard denied'))
    action(await more(second.element), '复制').click()
    await vi.waitFor(() => expect(second.host.commentMessage).toContain('复制未完成'))
  })

  it('confirms mobile deletion in owned DOM, cancels without writes and confirms exactly once', async () => {
    const { element, host, comments, editor } = await nativeComments([row()])
    const remove = vi.spyOn(comments, 'deleteReply'), baseline = editor.getJSON()
    host.setCommentDocumentDraft('不能清空')
    action(await more(element), '删除').click()
    const dialog = element.querySelector('[role="alertdialog"][aria-label="删除评论"]')
    expect(dialog).not.toBeNull(); expect(remove).not.toHaveBeenCalled()
    dialog.querySelector('[aria-label="取消删除评论"]').click()
    expect(remove).not.toHaveBeenCalled(); expect(host.commentDocumentDraft).toBe('不能清空')
    action(await more(element), '删除').click()
    const confirm = element.querySelector('[aria-label="确认删除评论"]')
    confirm.click(); confirm.click()
    await vi.waitFor(() => expect(remove).toHaveBeenCalledOnce())
    expect(host.commentDocumentDraft).toBe('不能清空')
    expect(editor.getJSON()).toEqual(baseline)
  })

  it('retires the delete confirmation and copy action on scope or permission changes', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const { element, host, comments } = await nativeComments([row()])
    const remove = vi.spyOn(comments, 'deleteReply')
    let menu = await more(element), copy = action(menu, '复制')
    action(menu, '删除').click()
    const confirm = element.querySelector('[aria-label="确认删除评论"]')
    host.session._authorizationGeneration++
    confirm.click(); copy.click()
    expect(remove).not.toHaveBeenCalled(); expect(writeText).not.toHaveBeenCalled()
    menu = await more(element); copy = action(menu, '复制')
    vi.spyOn(host, 'commentCan').mockReturnValue(false)
    copy.click(); expect(writeText).not.toHaveBeenCalled()
  })

  it('keeps all mobile action labels with truthful disabled reasons for other authors and empty text', async () => {
    const { element } = await nativeComments([row('bob', '')])
    const menu = await more(element)
    expect(action(menu, '编辑').getAttribute('aria-disabled')).toBe('true')
    expect(action(menu, '编辑').title).toContain('权限')
    expect(action(menu, '复制').getAttribute('aria-disabled')).toBe('true')
    expect(action(menu, '复制').title).toContain('内容')
    expect(action(menu, '举报').title).toContain('未接入')
  })

  it('keeps anchored More at six actions and replies through the real local thread without quoting over a draft', async () => {
    const { element, host, editor, comments } = await nativeComments()
    const blockId = editor.state.doc.firstChild.attrs.blockId
    const thread = await comments.createThread({ blockId, anchor: { blockId, offset: 0, length: 2 }, quote: '正文', author: { id: 'alice', name: 'Alice' }, content: '锚点回复' })
    await host.loadComments(); host.activateComment(thread.id); host.setCommentDraft(thread.id, '锚点草稿'); host.refreshPanels()
    const findReply = () => [...element.querySelectorAll('[data-comment-thread]')].find(node => node.dataset.commentThread === thread.id)
    await vi.waitFor(() => expect(findReply()?.querySelector('[data-comment-reply-control="more"]')).not.toBeNull())
    findReply().querySelector('[data-comment-reply-control="more"]').click()
    await vi.waitFor(() => expect(findReply()?.querySelector('[role="menu"]')).not.toBeNull())
    let menu = findReply().querySelector('[role="menu"]')
    expect([...menu.querySelectorAll('[role="menuitem"]')].map(node => node.querySelector('.lark-doc-comment-menu-label')?.textContent)).toEqual(['回复', '复制', '编辑', '翻译', '删除', '举报'])
    const layer = element.querySelector('.is-reference-drawer')
    layer.querySelector('[aria-label="逐条查看评论"]').click()
    menu = findReply().querySelector('[role="menu"]')
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true }))
    await host.$nextTick()
    expect(layer.classList.contains('is-reference-drawer')).toBe(false)
    expect(findReply().querySelector('[role="menu"]')).toBeNull()
    layer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true }))
    expect(layer.classList.contains('is-reference-drawer')).toBe(true)
    findReply().querySelector('[data-comment-reply-control="more"]').click()
    await vi.waitFor(() => expect(findReply().querySelector('[role="menu"]')).not.toBeNull())
    action(findReply().querySelector('[role="menu"]'), '回复').click()
    await vi.waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('回复'))
    expect(host.commentDraftOf(thread.id)).toBe('锚点草稿')
  })

  it.each(['touch', 'mouse'])('resolves the anchored thread with the correct confirmation for %s', async input => {
    if (input === 'mouse') {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 700 })
      window.matchMedia = () => Object.assign(new EventTarget(), { matches: false })
    }
    const { element, host, editor, comments } = await nativeComments()
    const blockId = editor.state.doc.firstChild.attrs.blockId
    const thread = await comments.createThread({ blockId, anchor: { blockId, offset: 0, length: 2 }, quote: '正文',
      author: { id: 'alice', name: 'Alice' }, content: '待处理评论' })
    const resolveComment = vi.spyOn(comments, 'resolve')
    await host.loadComments(); host.activateComment(thread.id)
    host.commentSidebarOpen = true; host.commentMobileOpen = true; host.commentMobileScope = 'selection'; host.refreshPanels()
    const menuTrigger = element.querySelector('[aria-label="评论操作"]')
    if (input === 'touch') {
      const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
      expect(menuTrigger.dispatchEvent(press)).toBe(false)
    }
    menuTrigger?.click()
    const trigger = element.querySelector('[data-comment-thread] [aria-label="解决评论"]')
    trigger.click()
    const sheet = () => element.querySelector('[role="alertdialog"][aria-label="解决并隐藏"]')
    if (input === 'touch') {
      expect(resolveComment).not.toHaveBeenCalled()
      expect(sheet()).not.toBeNull()
      sheet().querySelector('[aria-label="取消解决评论"]').click()
      expect(sheet()).toBeNull()
      expect(document.activeElement).toBe(trigger)
      trigger.click()
      const confirm = sheet().querySelector('[aria-label="确认解决并隐藏"]')
      confirm.click(); confirm.click()
    } else expect(sheet()).toBeNull()
    await vi.waitFor(async () => expect((await comments.list())[0].resolved).toBe(true))
    expect(resolveComment).toHaveBeenCalledOnce()
  })

  it('clamps the measured nine-action menu to the visible viewport and repositions after viewport scrolling', async () => {
    const viewport = Object.assign(new EventTarget(), { width: 393, height: 400, offsetLeft: 0, offsetTop: 120 })
    const prior = Object.getOwnPropertyDescriptor(window, 'visualViewport')
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
    let triggerTop = 470
    const rect = Element.prototype.getBoundingClientRect
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this.classList.contains('is-mobile-menu')) return { left: 0, top: 0, right: 328, bottom: 220, width: 328, height: 220 }
      if (this.dataset.commentReplyControl === 'more') return { left: 340, top: triggerTop, right: 364, bottom: triggerTop + 24, width: 24, height: 24 }
      return rect.call(this)
    })
    try {
      const { element } = await nativeComments([row()])
      // `placeMenu` 定位的就是 `.lark-doc-comment-reply-menu.is-mobile-menu` 这个盒子本身
      //（上面 mock 的 328×220 也是它的 rect），父节点是回复容器，不参与定位。
      const menu = await more(element)
      expect(menu.style.top).toBe('244px'); expect(menu.style.left).toBe('38px')
      expect(menu.style.maxWidth).toBe('326px')
      const css = postcss.parse(readFileSync(resolve(__dirname, '../../src/styles/comments.css'), 'utf8')), rules = new Map()
      css.walkRules(rule => rules.set(rule.selector, rule))
      const value = (selector, prop) => rules.get(selector)?.nodes.findLast(node => node.type === 'decl' && node.prop === prop)?.value
      expect(value('.lark-doc .lark-doc-comment-reply-menu.is-mobile-menu', 'width')).toBe('328px')
      expect(value('.lark-doc .is-mobile-menu .lark-doc-comment-menu-item', 'font-size')).toBe('12px')
      expect(value('.lark-doc .lark-doc-comment-reply-menu', 'width')).toBe('152px')
      expect(menu.style.maxHeight).toBe('384px'); expect(parseFloat(menu.style.top) + 220).toBeLessThanOrEqual(512)
      triggerTop = 130; viewport.dispatchEvent(new Event('scroll'))
      expect(menu.style.top).toBe('160px')
      viewport.width = 300; viewport.dispatchEvent(new Event('resize'))
      expect(menu.style.maxWidth).toBe('284px'); expect(menu.style.left).toBe('8px')
    } finally { if (prior) Object.defineProperty(window, 'visualViewport', prior); else delete window.visualViewport }
  })

  it('closes Escape at the menu and confirmation layer, restores only owned focus and keeps retired confirms inert', async () => {
    const { element, host, comments } = await nativeComments([row()])
    const remove = vi.spyOn(comments, 'deleteReply')
    let menu = await more(element)
    action(menu, '复制').focus()
    for (const flags of [{ isComposing: true }, { keyCode: 229 }]) {
      const composing = new KeyboardEvent('keydown', { key: 'Escape', ...flags, bubbles: true, cancelable: true })
      menu.dispatchEvent(composing); expect(composing.defaultPrevented).toBe(false); expect(menu.isConnected).toBe(true)
      expect(remove).not.toHaveBeenCalled()
    }
    const escape = new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true })
    menu.dispatchEvent(escape)
    await host.$nextTick()
    expect(escape.defaultPrevented).toBe(true)
    await vi.waitFor(() => expect(document.activeElement?.dataset.commentReplyControl).toBe('more'))
    expect(element.querySelector('[data-comment-reply="m20-reply"] [role="menu"]')).toBeNull()
    menu = await more(element); action(menu, '删除').click()
    const dialog = element.querySelector('[role="alertdialog"]'), confirm = dialog.querySelector('[aria-label="确认删除评论"]')
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(element.querySelector('[role="alertdialog"]')).toBeNull(); expect(remove).not.toHaveBeenCalled()
    confirm.click(); expect(remove).not.toHaveBeenCalled()
    menu = await more(element); action(menu, '删除').click()
    host.session.user = { id: 'retired' }; host.refreshPanels()
    expect(element.querySelector('[role="alertdialog"]')).toBeNull()
    expect(remove).not.toHaveBeenCalled()
  })

  it('does not copy stale or tombstoned text and disables reaction controls when their capability is unavailable', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const { element, host } = await nativeComments([row()])
    let menu = await more(element)
    const copy = action(menu, '复制')
    host.commentLoadGeneration++; copy.click(); expect(writeText).not.toHaveBeenCalled()
    host.refreshPanels()
    menu = element.querySelector('[data-comment-reply="m20-reply"] [role="menu"]')
    action(menu, '复制').click(); expect(writeText).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(host.commentMessage).toContain('内容已复制'))
    const allowed = host.commentAllowed.bind(host)
    vi.spyOn(host, 'commentAllowed').mockImplementation((action, ...args) => action === 'react' ? false : allowed(action, ...args))
    menu = await more(element)
    expect([...menu.parentElement.querySelectorAll('.lark-doc-comment-quick-reactions button')].every(button => button.disabled && button.title.includes('权限'))).toBe(true)
    const oldCopy = action(menu, '复制')
    host.commentThreads[0].replies[0].tombstone = true
    oldCopy.click(); expect(writeText).toHaveBeenCalledOnce()
  })

  it.each(['provider', 'document', 'privateIdentity', 'view'])('blocks a displayed copy and delete confirmation after %s changes', async reason => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const { element, host, comments } = await nativeComments([row()])
    const remove = vi.spyOn(comments, 'deleteReply'), menu = await more(element), copy = action(menu, '复制')
    action(menu, '删除').click()
    const confirm = element.querySelector('[aria-label="确认删除评论"]')
    if (reason === 'provider') host.session.providers.comments = createMemoryCommentsProvider()
    if (reason === 'document') host.session.documentId = 'another-document'
    if (reason === 'privateIdentity') host.session._privateIdentityGeneration++
    if (reason === 'view') vi.spyOn(host, 'commentCan').mockImplementation(capability => capability !== 'canView')
    copy.click(); confirm.click()
    expect(writeText).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled()
    expect(element.querySelector('[role="alertdialog"]')).toBeNull()
  })

  it('allows readonly viewing to copy text and never steals focus after a queued reply action', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const { doc, element, host } = await nativeComments([row()])
    doc.setReadonly(true); host.refreshPanels()
    action(await more(element), '复制').click()
    expect(writeText).toHaveBeenCalledExactlyOnceWith('你好\n@Bob 原文')
    doc.setReadonly(false); host.refreshPanels()
    const menu = await more(element), next = []
    vi.spyOn(host, '$nextTick').mockImplementation(fn => { if (fn) next.push(fn); return Promise.resolve() })
    action(menu, '回复').click()
    const foreign = document.createElement('button'); document.body.append(foreign); foreign.focus()
    next.forEach(fn => fn())
    expect(document.activeElement).toBe(foreign)
  })

  it('does not consume a foreign editor Escape or steal its focus through an open mobile menu', async () => {
    const { element, host } = await nativeComments([row()])
    await more(element)
    const foreign = document.createElement('textarea'); document.body.append(foreign); foreign.focus()
    const escape = new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true })
    foreign.dispatchEvent(escape)
    await host.$nextTick()
    expect(escape.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(foreign)
  })

  it('copies the rendered rich reply text and resolves the full-document comment through the existing port', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const { element, host, comments, editor } = await nativeComments([row()])
    host.commentThreads[0].replies[0].richContent = { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: '富文本', marks: [{ type: 'bold' }] }, { type: 'commentMention', attrs: { text: '@Bob', principalId: 'bob' } }] },
      { type: 'paragraph', content: [{ type: 'text', text: '第二段' }] },
    ] }
    host.refreshPanels()
    const before = editor.getJSON(), menu = await more(element)
    expect(element.querySelector('[data-comment-reply="m20-reply"] .lark-doc-comment-body').textContent).toBe('富文本@Bob\n第二段')
    action(menu, '复制').click()
    expect(writeText).toHaveBeenCalledExactlyOnceWith('富文本@Bob\n第二段')
    action(await more(element), '解决并隐藏').click()
    await vi.waitFor(async () => expect((await comments.list())[0].resolved).toBe(true))
    await vi.waitFor(() => expect(element.querySelector('[data-comment-thread="m20"]')).toBeNull())
    expect(editor.getJSON()).toEqual(before)
  })

  it('keeps the desktop four-item menu and immediate delete behavior', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 })
    window.matchMedia = () => Object.assign(new EventTarget(), { matches: false })
    const { element, host } = await nativeComments([row()])
    host.commentSidebarOpen = true; host.commentMobileScope = 'document'; host.refreshPanels()
    const menu = await more(element)
    expect([...menu.querySelectorAll('[role="menuitem"]')].map(node => node.querySelector('.lark-doc-comment-menu-label')?.textContent)).toEqual(['编辑', '翻译为英语', '删除', '举报'])
    expect(menu.parentElement.querySelector('[data-comment-quick-reaction]')).toBeNull()
    const remove = vi.spyOn(host, 'deleteCommentReply')
    action(menu, '删除').click()
    expect(remove).toHaveBeenCalledExactlyOnceWith('m20', 'm20-reply')
    expect(element.querySelector('[role="alertdialog"]')).toBeNull()
  })
})


describe('M20 delete confirmation ownership and scroll locks', () => {
  function surface(mode = 'inline', shadowMode = null) {
    const outer = document.createElement('div'); document.body.append(outer)
    const tree = shadowMode ? outer.attachShadow({ mode: shadowMode }) : outer
    const root = document.createElement('section'), main = document.createElement('main'), paper = document.createElement('div'), host = document.createElement('div')
    root.className = 'lark-doc'; main.className = 'lark-doc-main'; main.style.overflow = 'scroll'
    root.append(main, host); main.append(paper); tree.append(root)
    document.body.style.overflow = 'auto'
    let live = true
    const reply = { id: 'reply', name: '作者', body: '评论', mobileMenu: true, menuOpen: false, menuScope: { current: () => live },
      menus: [{ id: 'delete', label: '删除', icon: 'trash', mobile: true, visible: true }] }
    const item = { id: 'thread', documentOnly: mode === 'inline', quote: '引用', replies: [reply] }
    const confirm = vi.fn(), handlers = {
      onReplyControl: () => { reply.menuOpen = !reply.menuOpen; ui.update({ items: [item] }) },
      onCloseMenus: () => { reply.menuOpen = false; ui.update({ items: [item] }) },
      onRequestDelete: () => ({ current: () => live, confirm }),
    }
    const ui = createCommentPanel({ host, inlineHost: paper, handlers }); mounted.push(ui)
    ui.update({ open: mode !== 'inline', sidebarOpen: mode !== 'inline', mobileOpen: true,
      mobileScope: mode === 'inline' ? 'document' : 'selection', documentInline: mode === 'inline', activeThreadId: 'thread',
      replyControls: [{ id: 'more', label: '更多菜单' }], items: [item] })
    const open = () => {
      root.querySelector('[data-comment-reply-control="more"]').click()
      root.querySelector('[role="menuitem"]').click()
      const dialog = root.querySelector('[role="alertdialog"]'); expect(dialog).not.toBeNull()
      return dialog
    }
    return { ui, root, tree, host, main, open, confirm, retire: () => { live = false; ui.update({}) } }
  }
  it('matches the native bottom two-action confirmation without visible title or message', () => {
    const { open } = surface('inline'), dialog = open()
    expect(dialog.getAttribute('aria-label')).toBe('删除评论')
    expect([...dialog.children].map(node => node.tagName)).toEqual(['BUTTON', 'BUTTON'])
    expect([...dialog.querySelectorAll('button')].map(button => button.textContent)).toEqual(['删除评论', '取消'])
    expect(dialog.querySelector('[aria-label="确认删除评论"]')).not.toBeNull()
    expect(document.activeElement).toBe(dialog.querySelector('[aria-label="取消删除评论"]'))
    const css = postcss.parse(readFileSync(resolve(__dirname, '../../src/styles/comments.css'), 'utf8')), rules = new Map()
    css.walkRules(rule => rules.set(rule.selector, rule))
    const value = (selector, prop) => rules.get(selector)?.nodes.findLast(node => node.type === 'decl' && node.prop === prop)?.value
    const mask = '.lark-doc .lark-doc-comment-delete-mask', wrapper = '.lark-doc .lark-doc-comment-delete-dialog', button = wrapper + ' button'
    expect(value(mask, 'flex-direction')).toBe('column'); expect(value(mask, 'justify-content')).toBe('flex-end')
    expect(value(mask, 'padding')).toContain('12px'); expect(value(mask, 'padding')).toContain('safe-area-inset-bottom')
    expect(value(wrapper, 'background')).toBe('transparent'); expect(value(wrapper, 'border')).toBe('0')
    expect(value(wrapper, 'box-shadow')).toBe('none'); expect(value(wrapper, 'gap')).toBe('12px')
    expect(value(button, 'width')).toBe('100%'); expect(value(button, 'min-height')).toBe('52px'); expect(value(button, 'border-radius')).toBe('12px')
    expect(value(button, 'font-size')).toBe('18px'); expect(value(button, 'line-height')).toBe('24px')
  })
  it('puts the actual root-owned confirmation mask above the native comment layer', () => {
    const { open, host } = surface('drawer'), dialog = open()
    expect(dialog.parentElement.parentElement).toBe(host)
    const css = postcss.parse(readFileSync(resolve(__dirname, '../../src/styles/comments.css'), 'utf8'))
    let mask, layer
    css.walkRules(rule => {
      const z = rule.nodes.find(node => node.type === 'decl' && node.prop === 'z-index')?.value
      if (rule.selector === '.lark-doc .lark-doc-comment-delete-mask') mask = Number(z)
      if (rule.selector.split(',').some(selector => selector.trim() === '.lark-doc .lark-doc-comment-layer.is-mobile') && z) layer = Number(z)
    })
    expect(Number.isFinite(mask)).toBe(true); expect(layer).toBe(1100); expect(mask).toBeGreaterThan(layer)
  })
  it.each(['inline', 'drawer'])('locks body and its own main for %s confirmation and releases on every exit', mode => {
    for (const exit of ['cancel', 'confirm', 'retire', 'destroy']) {
      const { open, main, ui, retire, confirm } = surface(mode), dialog = open()
      expect(document.body.style.overflow).toBe('hidden'); expect(main.style.overflow).toBe('hidden')
      if (exit === 'cancel') dialog.querySelector('[aria-label="取消删除评论"]').click()
      if (exit === 'confirm') dialog.querySelector('[aria-label="确认删除评论"]').click()
      if (exit === 'retire') retire()
      if (exit === 'destroy') ui.destroy()
      expect(dialog.isConnected).toBe(false)
      expect(document.body.style.overflow).toBe('auto'); expect(main.style.overflow).toBe('scroll')
      expect(confirm).toHaveBeenCalledTimes(exit === 'confirm' ? 1 : 0)
      ui.destroy()
    }
  })
  it('releases only the confirmation lock while the native reader keeps its existing lock', () => {
    const { ui, main, open } = surface('drawer')
    ui.el.querySelector('[aria-label="逐条查看评论"]').click()
    expect(document.body.style.overflow).toBe('hidden'); expect(main.style.overflow).toBe('hidden')
    const dialog = open(); dialog.querySelector('[aria-label="取消删除评论"]').click()
    expect(document.body.style.overflow).toBe('hidden'); expect(main.style.overflow).toBe('hidden')
    ui.destroy()
    expect(document.body.style.overflow).toBe('auto'); expect(main.style.overflow).toBe('scroll')
  })
  it.each(['open', 'closed'])('uses real %s Shadow focus for Tab and cancellation back to More', mode => {
    const { tree, open } = surface('inline', mode), dialog = open()
    const cancel = dialog.querySelector('[aria-label="取消删除评论"]'), confirm = dialog.querySelector('[aria-label="确认删除评论"]')
    expect(tree.activeElement).toBe(cancel)
    cancel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true, composed: true }))
    expect(tree.activeElement).toBe(confirm)
    confirm.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true, composed: true }))
    expect(tree.activeElement).toBe(cancel)
    cancel.click()
    expect(tree.activeElement?.dataset.commentReplyControl).toBe('more')
    expect(document.body.style.overflow).toBe('auto')
  })
  it.each(['open', 'closed'])('does not take focus back from a sibling in the same %s Shadow host', mode => {
    const { tree, root, open } = surface('inline', mode), dialog = open()
    const foreign = document.createElement('button'); root.append(foreign); foreign.focus()
    dialog.querySelector('[aria-label="取消删除评论"]').click()
    expect(tree.activeElement).toBe(foreign)
    expect(document.body.style.overflow).toBe('auto')
  })
})
