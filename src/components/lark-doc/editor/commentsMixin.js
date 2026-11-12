/**
 * Comment state, anchored threads and provider operations.
 * Source rechecked 2026-11-10: hover opens the 346×342 reaction palette,
 * clicking the reaction control toggles Like, and reply prefills the referenced author.
 * Every persisted edit uses the current provider/capability context; stale responses cannot
 * mutate a replacement document. Source assets load in a separate offline catalog chunk.
 */
import {
  COMMENT_CONTROLS,
  COMMENT_HEIGHTS,
  COMMENT_PANEL,
  COMMENT_PRIVATE_SWITCH,
  COMMENT_REPLY_CONTROLS,
  COMMENT_REPLY_CONTROL_IDS,
  COMMENT_REPLY_MENU_ITEMS,
  commentPanelHeight,
} from '../../../core/blocks/comment'
import { unreadCount } from '../../../core/comments/index'
import { bindThreads, resolveAnchorCodec } from '../../../core/comments/binding'
import { normalizeAuthor } from '../../../core/comments/thread'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'
import { safeUrl } from '../../../core/documentOperations'
import { createNetworkPolicy } from '../../../core/policy/network'
import { isAbortError, normalizeUploader, validateUploadFile } from '../../../core/media/upload'
import { createImageViewer } from '../../../core/nodeviews/image-viewer'

/** 面板与正文右缘的间距（实测 1214 - 1202，与修订面板同口径）。 */
const COMMENT_ANCHOR_GUTTER = 12
/** 贴视口边的最小留白，与 isv 面板同口径。 */
const COMMENT_VIEWPORT_MARGIN = 8
/** 两个面板纵向叠放时的间隙。**不属于面板几何**（04 §3.1④ 没测），故不进 `COMMENT_PANEL`。 */
const COMMENT_PANEL_GAP = 8
/** Source comment chooser accepts these five image MIME values, independently of body images. */
const COMMENT_IMAGE_MIME = ['image/gif', 'image/jpg', 'image/jpeg', 'image/bmp', 'image/png']

/**
 * 头部控件 id → 图标键。
 *
 * 「更多」刻意给空串：飞书那颗是三点省略号，图标库里没有对应字形，由 CSS 画圆点
 * （见 `styles/comments.css` 的 `.lark-doc-comment-dots`）—— 不为它去改共享的 `icons.js`。
 */
const COMMENT_CONTROL_ICONS = Object.freeze({
  'go-next': 'rev-next',
  'go-previous': 'rev-prev',
  copyAnchor: 'link',
  resolve: 'rev-accept',
  more: '',
})

/** 回复行 hover 三按钮 id → 图标键（同样没有表情 / 省略号字形，走 CSS 与近似符号）。 */
const COMMENT_REPLY_ICONS = Object.freeze({ emoji: 'comment-reaction', quote: 'comment-reply', more: '' })

/** 控件的无障碍名。不写 `title`：飞书的气泡是组件画的，原生 title 会多一层灰底气泡。 */
const COMMENT_CONTROL_LABELS = Object.freeze({
  'go-next': '下一条评论',
  'go-previous': '上一条评论',
  copyAnchor: '复制锚点',
  resolve: '解决评论',
  more: '更多',
})

const COMMENT_REPLY_CONTROL_LABELS = Object.freeze({ emoji: '添加表情回复', quote: '引用回复', more: '更多菜单' })
let reactionCatalogPromise
const loadReactionCatalog = () => reactionCatalogPromise || (reactionCatalogPromise = import('../../../core/comments/reaction-catalog.json').then(module => module.default || module).catch(error => { reactionCatalogPromise = null; throw error }))

/**
 * 写操作 → 需要哪个 capability。
 * 表在这里是因为「哪些动作归哪把钥匙」只有一处答案，散在各个方法里迟早会漏一个。
 */
export const COMMENT_GATES = Object.freeze({
  create: 'canComment',
  reply: 'canComment',
  remove: 'canComment',
  edit: 'canComment',
  react: 'canComment',
  translate: 'canView',
  report: 'canView',
  resolve: 'canResolveComment',
  reopen: 'canResolveComment',
})

/** 动作 → capability；不在表里的动作返回空串（= 不需要闸门，别默认放行）。 */
export function commentGate(action) {
  return COMMENT_GATES[action] || ''
}

/** 草稿文本：没写过草稿就是空串（空串 = 不浮出「取消 / 发送」，见 04 §3.1⑤）。 */
export function commentDraftText(drafts, threadId) {
  const source = drafts && typeof drafts === 'object' ? drafts : {}
  const value = source[threadId]
  return typeof value === 'string' ? value : ''
}

/** 「刚刚 / N 分钟前 / N 小时前 / M-D」。04 §3.1④ 只实测到「刚刚」，其余按同族口径推。 */
export function commentRelativeTime(now, at) {
  const time = Number.isFinite(at) ? at : 0
  if (!time) return ''
  const delta = Math.max(0, (Number.isFinite(now) ? now : 0) - time)
  if (delta < 60000) return '刚刚'
  if (delta < 3600000) return `${Math.floor(delta / 60000)} 分钟前`
  if (delta < 86400000) return `${Math.floor(delta / 3600000)} 小时前`
  const date = new Date(time)
  return `${date.getMonth() + 1}-${date.getDate()}`
}

export default {
  data() {
    return {
      /** Provider 返回并经 `bindThreads` 绑过的线程（含 resolved，面板自己过滤）。 */
      commentThreads: [],
      /** 点亮 / 展开输入的线程 id。飞书的面板只对一条线程展开输入区。 */
      commentActiveThreadId: '',
      /** threadId → 草稿文本。Vue 2 加新键必须走 `$set`，见 `setCommentDraft`。 */
      commentDrafts: {},
      /** 已读线程 id：未读数按它与 `commentThreads` 做差集。 */
      commentReadIds: [],
      /** 「私有评论」开关为开的线程 id（开关是本地态，Provider 无对应方法）。 */
      commentPrivateIds: [],
      /** 面板头「更多」下拉打开的线程 id（同时只允许一个，关别的靠它互斥）。 */
      commentMoreThreadId: '',
      /** 回复行「更多」菜单：`{ threadId, commentId }`，空串 = 关着。 */
      commentMenuThreadId: '',
      commentMenuCommentId: '',
      commentEditing: null,
      commentComposer: null,
      commentReaction: null,
      commentReactionCatalog: null,
      commentReactionRecent: [],
      commentReplyTargets: {},
      commentHistoryOpen: false,
      commentHistoryStyle: {},
      commentServices: {},
      commentAttachments: {},
      commentSubmitting: {},
      commentDeleting: {},
      commentContextEpoch: 0,
      /** 带几何的面板列表（bound 且未解决），与 `revisionPanels` 同形态。 */
      commentPanels: [],
      /** 协同宿主注入 yjs codec 工厂的入口；不注入就走 plain（core 不 import yjs）。 */
      commentAnchorOptions: {},
    }
  },
  computed: {
    /** 面板的无障碍名（类比修订面板的 `revisionPanelTitle`）。 */
    commentPanelTitle() {
      return '评论'
    },
    /** 「私有评论」的标题与说明：文案在 core 常量里，面板不另抄一份。 */
    commentPrivateTitle() {
      return COMMENT_PRIVATE_SWITCH.title
    },
    commentPrivateHint() {
      return COMMENT_PRIVATE_SWITCH.hint
    },
    /** 头部控件组的六项，顺序来自 core 常量；`split` 走分割条分支。 */
    commentControls() {
      return COMMENT_CONTROLS.filter(item => item.id !== 'more').map((item) => ({
        id: item.id,
        label: COMMENT_CONTROL_LABELS[item.id] || item.id,
        split: item.tone === 'split',
        icon: COMMENT_CONTROL_ICONS[item.id] || '',
        iconSize: item.iconSize,
        tone: item.tone,
      }))
    },
    /** 回复行 hover 的三按钮：每格 14×14、步进 25（04 §3.1④-2）。 */
    commentReplyControls() {
      return COMMENT_REPLY_CONTROL_IDS.map((id) => ({
        id,
        label: COMMENT_REPLY_CONTROL_LABELS[id] || id,
        icon: COMMENT_REPLY_ICONS[id] || '',
        iconSize: COMMENT_REPLY_CONTROLS.size,
      }))
    },
    /** 回复行「更多」菜单的四项，顺序固定（04 §3.1④-3 B）。 */
    commentMenuItems() {
      return COMMENT_REPLY_MENU_ITEMS.map((item) => ({ id: item.id, label: item.label, submenu: Boolean(item.submenu) }))
    },
    /** 未解决且未读的条数（已解决线程不提醒，见 state.js 文件头）。 */
    commentUnread() {
      return unreadCount(this.commentThreads, this.commentReadIds)
    },
    /** 失联线程（块被删）：面板画不出位置，交给宿主提示「原引用已删除」。 */
    commentUnboundThreads() {
      return this.commentThreads.filter((thread) => !thread.bound)
    },
    /** 锚点 codec：协同态由宿主注入工厂，否则 plain。 */
    commentAnchorCodec() {
      return resolveAnchorCodec(this.editor, this.commentAnchorOptions)
    },
    /** 当前用户（写路径的 author）。没有 session 时回落本地作者，`buildReply` 要非空 id。 */
    commentAuthor() {
      const user = this.session && this.session.user ? this.session.user : null
      return normalizeAuthor(user || { id: 'local-user', name: '我' })
    },
    commentEntryVisible() { return !!this.editor && !!this.commentProvider() && this.commentCan('canView') },
    commentEntryAvailable() { return this.commentEntryVisible && this.commentAllowed('create') },
  },
  watch: {
    uploader() { this.reconcileCommentRequests() },
    uploadImage() { this.reconcileCommentRequests() },
    'larkDocConfig.network': { deep: true, handler() { this.reconcileCommentRequests(); this.refreshPanels?.() } },
  },
  mounted() {
    // 宿主的 `mounted` 在本钩子之后才建编辑器 —— 延一帧再拉评论、挂监听。
    this.$nextTick(() => {
      if (!this.editor) return
      this.editor.view.dom.addEventListener('pointerdown', this.onCommentPointerDown)
      this.editor.on('transaction', this.mapCommentComposer)
      this.resetCommentContext()
    })
    window.addEventListener('scroll', this.onCommentViewportChange, true)
    window.addEventListener('resize', this.onCommentViewportChange)
  },
  beforeDestroy() {
    this.commentContextEpoch += 1
    this.cancelCommentServices()
    this.clearCommentAttachments()
    this.closeCommentAttachmentPreview()
    this.closeCommentReaction()
    this._commentLoadToken = (this._commentLoadToken || 0) + 1
    this.cancelCommentComposer()
    window.removeEventListener('scroll', this.onCommentViewportChange, true)
    window.removeEventListener('resize', this.onCommentViewportChange)
    if (this.editor && this.editor.view && this.editor.view.dom) {
      this.editor.view.dom.removeEventListener('pointerdown', this.onCommentPointerDown)
      this.editor.off('transaction', this.mapCommentComposer)
    }
  },
  methods: {
    resetCommentContext() {
      const context = { editor: this.editor, session: this.session, provider: this.commentProvider() }
      const previous = this._commentContext
      if (previous && previous.editor === context.editor && previous.session === context.session && previous.provider === context.provider) return
      this._commentContext = context
      this.commentContextEpoch += 1
      this.cancelCommentServices()
      this.clearCommentAttachments()
      this.closeCommentAttachmentPreview()
      this.commentSubmitting = {}
      this.commentDeleting = {}
      this.commentHistoryOpen = false
      const activeContext = this._commentContext
      this._commentLoadToken = (this._commentLoadToken || 0) + 1
      this.cancelCommentComposer()
      this.commentEditing = null
      this.closeCommentReaction()
      this.commentReplyTargets = {}
      this._commentLinkContext = null
      this.commentDrafts = {}
      this.commentThreads = []
      this.commentPanels = []
      this.commentActiveThreadId = ''
      this.commentReadIds = []
      this.commentPrivateIds = []
      this.closeCommentMenus()
      this.refreshPanels?.()
      if (this._imageCommentTarget?.viewer) this._imageCommentTarget.viewer.querySelector('[data-viewer-action="close"]')?.click()
      this.openImageComments?.(null, false)
      if (!context.editor || context.editor.isDestroyed || !context.provider) return
      this.loadComments().catch(error => {
        if (this._commentContext === activeContext) this.error = error?.message || '评论加载失败，请重试'
      })
    },
    beginCommentComposer(pos, host = null) {
      if (!this.editor || !this.commentCan('canView') || !this.commentAllowed('create')) return false
      if (!this.writable() && !(Number.isInteger(pos) && this.editor.state.doc.nodeAt(pos)?.isAtom)) return false
      if (!this.commentProvider()) { this.error = '尚未配置评论服务'; return false }
      if (Number.isInteger(pos)) this.editor.view.dispatch(this.editor.state.tr.setSelection(NodeSelection.create(this.editor.state.doc, pos)))
      let selection = this.editor.state.selection
      if (selection.empty && selection.$from.parent.isTextblock) {
        const from = selection.$from.start(), to = selection.$from.end()
        if (from === to) { this.error = '请先选择要评论的内容'; return false }
        selection = TextSelection.create(this.editor.state.doc, from, to)
        this.editor.view.dispatch(this.editor.state.tr.setSelection(selection))
      }
      const range = this.commentSelectionRange()
      if (!range) return false
      this._commentComposerAnchor = { bookmark: selection.getBookmark(), editor: this.editor, session: this.session, blockId: range.blockId, ...(range.cells ? { range } : {}) }
      this._commentComposerHost = host
      const bounds = this.editor.view.dom.getBoundingClientRect()
      const target = this.editor.view.nodeDOM(this.commentBlockPos(range.blockId))
      const rect = target?.getBoundingClientRect?.() || bounds
      this.commentComposer = { value: '', quote: range.quote || range.text, busy: false, error: '', style: { left: `${Math.max(8, Math.min(window.innerWidth - 278, bounds.right + 12))}px`, top: `${Math.max(8, Math.min(window.innerHeight - 220, rect.top))}px` } }
      this.$nextTick(() => this._panelsUi?.composer.focusInput())
      return true
    },
    mapCommentComposer({ transaction }) {
      if (transaction.docChanged) {
        this.commentThreads = bindThreads(this.editor?.state.doc, this.commentThreads, this.commentAnchorCodec)
        this.updateCommentPanels()
      }
      const anchor = this._commentComposerAnchor
      if (!anchor || !transaction.docChanged) return
      if (anchor.editor !== this.editor || anchor.session !== this.session || this.commentBlockPos(anchor.blockId) < 0) { this.cancelCommentComposer(); return }
      if (anchor.range?.cells) {
        if (!this.mapCommentCellRange(anchor.range, transaction)) { this.cancelCommentComposer(); return }
        anchor.bookmark = anchor.range.bookmark
        return
      }
      const old = anchor.bookmark.resolve(transaction.before)
      if (transaction.mapping.mapResult(old.from, 1).deletedAcross || transaction.mapping.mapResult(old.to, -1).deletedAcross) { this.cancelCommentComposer(); return }
      anchor.bookmark = anchor.bookmark.map(transaction.mapping)
    },
    cancelCommentComposer() { this.clearCommentAttachments(''); this._commentComposerAnchor = null; this.commentComposer = null },
    setCommentComposerDraft(value) { if (this.commentComposer && !this.commentComposer.busy) this.commentComposer = { ...this.commentComposer, value } },
    async submitCommentComposer() {
      const draft = this.commentComposer, anchor = this._commentComposerAnchor
      if (!draft || !anchor || draft.busy || !this.commentDraftReady('', draft.value)) return null
      if (anchor.editor !== this.editor || anchor.session !== this.session) { this.cancelCommentComposer(); return null }
      this.commentComposer = { ...draft, busy: true, error: '' }
      try {
        this.editor.view.dispatch(this.editor.state.tr.setSelection(anchor.bookmark.resolve(this.editor.state.doc)).setMeta('addToHistory', false))
        const thread = await this.createCommentFromSelection(draft.value, this.commentReadyAttachments(''), anchor.range)
        if (this._commentComposerAnchor !== anchor) return null
        if (thread) this.cancelCommentComposer()
        else this.commentComposer = { ...draft, busy: false, error: '评论未发送，原引用或权限可能已改变' }
        return thread
      } catch (error) {
        if (this._commentComposerAnchor === anchor) this.commentComposer = { ...draft, busy: false, error: error?.message || '评论发送失败，请重试' }
        return null
      }
    },
    // —— 闸门与 Provider ——
    /** 单一判定入口：没配 session 时按 DEFAULT_CAPABILITIES（八项默认 true）放行。 */
    commentCan(capability) {
      const session = this.session
      if (!session || typeof session.can !== 'function') return true
      return session.can(capability)
    },
    /** 写操作的统一闸门；返回 false 时调用方直接 return（UI 侧同步置灰）。 */
    commentAllowed(action) {
      const gate = commentGate(action)
      if (!gate) return false
      return this.commentCan(gate)
    },
    commentProvider() {
      const session = this.session
      if (!session || typeof session.getProvider !== 'function') return null
      return session.getProvider('comments')
    },

    // —— 读取与绑定 ——
    async loadComments() {
      const provider = this.commentProvider()
      const editor = this.editor
      const session = this.session
      const token = this._commentLoadToken = (this._commentLoadToken || 0) + 1
      if (!provider) {
        this.commentThreads = []
        this.commentPanels = []
        return []
      }
      const documentId = this.session && this.session.documentId ? this.session.documentId : ''
      const threads = await provider.list({ documentId })
      if (token !== this._commentLoadToken || this.editor !== editor || editor?.isDestroyed
        || this.session !== session || this.commentProvider() !== provider) return this.commentThreads || []
      this.commentThreads = bindThreads(this.editor ? this.editor.state.doc : null, threads, this.commentAnchorCodec)
      if (!this.commentReactionCatalog && this.commentThreads.some(thread => thread.replies.some(reply => reply.reactions?.length))) {
        try {
          const catalog = await loadReactionCatalog()
          if (token !== this._commentLoadToken || this.editor !== editor || editor?.isDestroyed || this.session !== session || this.commentProvider() !== provider) return this.commentThreads || []
          this.commentReactionCatalog = catalog
        } catch (_) { /* Replies stay readable if an optional icon chunk cannot be loaded. */ }
      }
      this.updateCommentPanels()
      this.jumpCommentAnchor()
      return this.commentThreads
    },

    // —— 写操作（全部过闸门）——
    /**
     * 划词建评论：先建线程（拿到服务端 id），再把 mark 落到选区上。
     *
     * 顺序不能反：mark 的 threadId 就是线程身份，先落 mark 只能先造一个本地 id，
     * 之后还要回头改一遍文档 —— 多一次事务、多一处可能错位。
     */
    async createCommentFromSelection(content, attachments = [], sourceRange = null) {
      if (!this.commentCan('canView') || !this.commentAllowed('create')) return null
      if (!this.editor) return null
      const text = typeof content === 'string' ? content.trim() : ''
      if (!text && !attachments.length) return null
      const range = sourceRange?.cells ? { ...sourceRange, cells: sourceRange.cells.map(cell => ({ ...cell })), ranges: sourceRange.ranges.map(item => ({ ...item })) } : this.commentSelectionRange()
      if (!range) return null
      if (range.cells && !this.commentCellRangeCurrent(range, this.editor.state.doc)) return null
      if (!this.writable() && !range.blockOnly) return null
      const provider = this.commentProvider()
      if (!provider) return null
      if (attachments.length && !this.commentCanAttach()) { this.error = '当前评论服务不支持图片或没有评论权限'; return null }
      const editor = this.editor
      const session = this.session
      let from = range.from
      let to = range.to
      let valid = true
      const anchor = { blockId: range.blockId, offset: range.offset, length: range.length }
      // Keep the selected text attached while the provider is pending. A deleted
      // or replaced target must never attach to whichever text occupies its offset.
      const mapRange = ({ transaction }) => {
        if (!transaction.docChanged) return
        if (range.cells) { valid = valid && this.mapCommentCellRange(range, transaction); return }
        const start = transaction.mapping.mapResult(from, 1)
        const end = transaction.mapping.mapResult(to, -1)
        if (start.deletedAcross || end.deletedAcross || end.pos <= start.pos || range.linkTarget && (start.deletedAfter || end.deletedBefore)) valid = false
        from = start.pos
        to = end.pos
      }
      editor.on('transaction', mapRange)
      let thread
      try {
        thread = await provider.createThread({
          blockId: range.blockId,
          author: this.commentAuthor,
          content: text,
          ...(attachments.length ? { attachments } : {}),
          anchor,
          quote: range.quote || range.text,
        })
      } finally { editor.off('transaction', mapRange) }
      if (!thread?.id || !valid || editor.isDestroyed || this.editor !== editor || this.session !== session
        || this.commentProvider() !== provider || !this.commentCan('canView') || !this.commentAllowed('create') || (!this.writable() || editor.isEditable === false) && !range.blockOnly) return null
      const doc = editor.state.doc
      if (range.cells) {
        if (!this.commentCellRangeCurrent(range, doc) || range.offset !== anchor.offset || range.length !== anchor.length) return null
        const mark = editor.schema.marks.comment
        if (!mark) return null
        const tr = editor.state.tr
        range.ranges.forEach(item => { if (item.to > item.from) tr.addMark(item.from, item.to, mark.create({ threadId: thread.id })) })
        tr.setSelection(TextSelection.near(tr.doc.resolve(range.ranges[range.ranges.length - 1]?.to ?? range.to), -1))
        editor.view.dispatch(tr)
        editor.commands.focus()
      } else {
        if (from < 0 || to > doc.content.size || doc.textBetween(from, to, '\n', ' ') !== range.text) return null
        if (range.linkTarget) {
          const node = doc.nodeAt(from)
          if (node?.type.name !== range.linkTarget.type || (node.attrs.href || node.attrs.url) !== range.linkTarget.href) return null
        }
        const resolved = doc.resolve(from)
        let sameBlock = false
        if (range.blockOnly) sameBlock = doc.nodeAt(from)?.attrs.blockId === range.blockId
        for (let depth = resolved.depth; depth > 0; depth -= 1) {
          if (resolved.node(depth).attrs.blockId === range.blockId) { sameBlock = true; break }
        }
        if (!sameBlock || !range.blockOnly && !this.applyCommentMark(thread.id, from, to)) return null
      }
      try { await this.loadComments() }
      catch (_) { if (this.editor === editor && this.session === session && this.commentProvider() === provider) this.error = '评论已保存，列表刷新失败，请重新打开评论' }
      if (this.editor === editor && this.session === session && this.commentProvider() === provider) this.activateComment(thread.id)
      return thread
    },
    async mutateComment(method, input, action) {
      if (!this.commentAllowed(action)) return null
      const provider = this.commentProvider(), session = this.session, editor = this.editor
      if (!provider || typeof provider[method] !== 'function') { this.error = '当前评论服务不支持此操作'; return null }
      const current = () => this.session === session && this.editor === editor && !editor?.isDestroyed
        && this.commentProvider() === provider && this.commentAllowed(action)
        && (method !== 'deleteThread' || this.commentCanViewHistory())
      try {
        if (!current()) return null
        const result = await provider[method](input)
        if (!current()) return null
        if (method === 'deleteThread' && result !== true) throw new Error('评论服务未确认删除线程')
        try { await this.loadComments() }
        catch (_) { if (current()) this.error = method === 'deleteThread' ? '评论已删除，列表刷新失败，请重新打开历史评论' : '评论已保存，列表刷新失败，请重新打开评论' }
        return current() ? (result === undefined ? true : result) : null
      } catch (error) {
        if (current()) this.error = error?.message || '评论操作失败，请重试'
        return null
      }
    },
    async submitCommentDraft(threadId) {
      if (!this.commentAllowed('reply')) return null
      const draft = commentDraftText(this.commentDrafts, threadId), text = draft.trim()
      if (this.commentSubmitting?.[threadId] || !this.commentDraftReady(threadId, draft)) return null
      const replyTo = this.commentReplyTargets?.[threadId]
      const attachments = this.commentReadyAttachments(threadId)
      if (attachments.length && this.commentProvider()?.supportsAttachments !== true) { this.error = '当前评论服务不支持图片'; return null }
      const sentIds = this.commentAttachmentsOf(threadId).map(item => item.id)
      const pending = Symbol('comment-reply')
      if (!this.commentSubmitting) this.commentSubmitting = {}
      this.$set(this.commentSubmitting, threadId, pending)
      try {
        const reply = await this.mutateComment('reply', { threadId, author: this.commentAuthor, content: text,
          ...(attachments.length ? { attachments } : {}), ...(replyTo && draft.startsWith(`@${replyTo.authorName} `) ? { replyTo } : {}) }, 'reply')
        if (reply) {
          if (commentDraftText(this.commentDrafts, threadId) === draft) {
            this.$set(this.commentDrafts, threadId, '')
            this.commentReplyTargets = Object.fromEntries(Object.entries(this.commentReplyTargets || {}).filter(([id]) => id !== threadId))
          }
          sentIds.forEach(id => this.removeCommentAttachment(threadId, id))
        }
        return reply
      } finally {
        if (this.commentSubmitting[threadId] === pending) this.$set(this.commentSubmitting, threadId, null)
      }
    },
    async resolveComment(threadId) {
      const thread = await this.mutateComment('resolve', threadId, 'resolve')
      if (thread && this.commentActiveThreadId === threadId) this.commentActiveThreadId = ''
      return thread
    },
    async reopenComment(threadId) {
      const thread = await this.mutateComment('reopen', threadId, 'reopen')
      const reopened = this.commentThreads?.find(item => item.id === threadId && item.bound && !item.resolved)
      if (thread && reopened) {
        this.activateComment(threadId)
        this.scrollCommentIntoView(reopened.blockId)
      }
      return thread
    },
    deleteCommentReply(threadId, commentId) {
      return this.mutateComment('deleteReply', { threadId, commentId, author: this.commentAuthor }, 'remove')
    },
    async deleteCommentThread(threadId) {
      if (!threadId || !this.commentCanViewHistory() || !this.commentAllowed('remove') || this.commentDeleting?.[threadId]) return null
      if (typeof this.commentProvider()?.deleteThread !== 'function') { this.error = '当前评论服务不支持删除线程'; return null }
      const pending = Symbol('delete-comment-thread')
      if (!this.commentDeleting) this.commentDeleting = {}
      this.$set(this.commentDeleting, threadId, pending)
      try {
        const result = await this.mutateComment('deleteThread', { threadId, author: this.commentAuthor }, 'remove')
        if (this.commentDeleting[threadId] !== pending || !this.commentCanViewHistory() || !this.commentAllowed('remove')) return null
        if (result === true) {
          this.commentThreads = this.commentThreads.filter(thread => thread.id !== threadId)
          this.updateCommentPanels()
          this.clearCommentDraft(threadId)
          this.reconcileCommentRequests()
        }
        return result
      } finally {
        if (this.commentDeleting[threadId] === pending) this.$set(this.commentDeleting, threadId, null)
      }
    },
    editCommentReply(threadId, commentId, content) {
      return this.mutateComment('editReply', { threadId, commentId, author: this.commentAuthor, content }, 'edit')
    },
    beginCommentEdit(threadId, commentId) {
      const reply = this.commentThreads.find(item => item.id === threadId)?.replies.find(item => item.id === commentId)
      if (!reply || reply.author.id !== this.commentAuthor.id || !this.commentAllowed('edit')) return false
      if (typeof this.commentProvider()?.editReply !== 'function') { this.error = '当前评论服务不支持编辑'; return false }
      this.commentEditing = { threadId, commentId, value: reply.content }
      return true
    },
    async confirmCommentEdit(threadId, commentId, content) {
      const reply = this.commentThreads.find(thread => thread.id === threadId)?.replies.find(reply => reply.id === commentId)
      if (!String(content || '').trim() && !reply?.attachments?.length) return false
      const editing = this.commentEditing
      if (!editing || editing.busy || editing.threadId !== threadId || editing.commentId !== commentId) return false
      this.commentEditing = { ...editing, busy: true }
      const pending = this.commentEditing
      const result = await this.editCommentReply(threadId, commentId, content)
      if (this.commentEditing === pending) this.commentEditing = result ? null : { ...pending, busy: false }
      return Boolean(result)
    },
    setCommentEditDraft(threadId, commentId, value) {
      if (this.commentEditing?.threadId === threadId && this.commentEditing?.commentId === commentId && !this.commentEditing.busy) this.commentEditing = { ...this.commentEditing, value }
    },
    cancelCommentEdit() { this.commentEditing = null },
    commentMenuDisabled(id) {
      const methods = { edit: 'editReply', delete: 'deleteReply', translate: 'translateReply', report: 'reportReply' }
      const actions = { edit: 'edit', delete: 'remove', translate: 'translate', report: 'report' }
      return Boolean(methods[id] && (typeof this.commentProvider()?.[methods[id]] !== 'function' || !this.commentAllowed(actions[id])))
    },
    cancelCommentServices() {
      this._commentServiceRequests?.forEach(request => { request.controller.abort(); request.tab?.close() })
      this._commentServiceRequests?.clear()
      this.commentServices = {}
    },
    cancelCommentService(threadId, commentId, action = 'translate') {
      const key = JSON.stringify([threadId, commentId, action])
      const request = this._commentServiceRequests?.get(key)
      if (request) { request.controller.abort(); request.tab?.close(); this._commentServiceRequests.delete(key) }
      this.$set(this.commentServices, key, null)
    },
    commentServiceOf(threadId, commentId, action = 'translate') {
      return this.commentServices?.[JSON.stringify([threadId, commentId, action])] || null
    },
    async runCommentService(action, threadId, commentId) {
      const method = { translate: 'translateReply', report: 'reportReply' }[action]
      if (!method || !this.commentAllowed(action)) return false
      const provider = this.commentProvider(), session = this.session, editor = this.editor
      const reply = this.commentThreads.find(thread => thread.id === threadId)?.replies.find(reply => reply.id === commentId)
      if (!reply) return false
      if (typeof provider?.[method] !== 'function') { this.error = '当前评论服务不支持此操作'; return false }
      const key = JSON.stringify([threadId, commentId, action])
      if (this._commentServiceRequests?.has(key)) return false
      const request = { controller: new AbortController(), tab: null }
      if (action === 'report') {
        try {
          request.tab = window.open('about:blank', '_blank')
          if (!request.tab) throw new Error('举报页面未打开，请允许弹出窗口后重试')
          request.tab.opener = null
        } catch (error) { this.error = error?.message || '举报页面未打开，请重试'; return false }
      }
      if (!this._commentServiceRequests) this._commentServiceRequests = new Map()
      this._commentServiceRequests.set(key, request)
      const current = () => this._commentServiceRequests?.get(key) === request && !request.controller.signal.aborted
        && this.session === session && this.editor === editor && !editor?.isDestroyed && this.commentProvider() === provider
        && this.commentAllowed(action) && this.commentThreads.find(thread => thread.id === threadId)?.replies.some(item => item.id === commentId && item.content === reply.content && item.editedAt === reply.editedAt)
      request.current = current
      this.$set(this.commentServices, key, { busy: true, source: reply.content, error: '' })
      try {
        const result = await provider[method]({ documentId: session?.documentId || '', threadId, commentId, author: this.commentAuthor, replyAuthor: { ...reply.author },
          content: reply.content, ...(action === 'translate' ? { targetLanguage: 'en' } : {}), signal: request.controller.signal })
        if (!current()) return false
        if (action === 'translate') {
          if (!result || typeof result.content !== 'string' || !result.content.trim()) throw new Error('翻译服务未返回译文')
          this.$set(this.commentServices, key, { busy: false, source: reply.content, content: result.content, error: '' })
        } else {
          if (!result || !safeUrl(result.url) || !/^https?:\/\//i.test(result.url)) throw new Error('举报服务未返回有效页面地址')
          if (!createNetworkPolicy(this.larkDocConfig?.network).allows(result.url)) throw new Error('举报页面被当前网络策略拦截')
          if (request.tab.closed) throw new Error('举报页面已关闭，请重试')
          request.tab.location.replace(result.url)
          request.tab = null
          this.$set(this.commentServices, key, null)
        }
        return true
      } catch (error) {
        if (current()) {
          const message = error?.message || (action === 'translate' ? '翻译失败，请重试' : '举报页面未打开，请重试')
          this.$set(this.commentServices, key, { busy: false, source: reply.content, error: message })
          this.error = message
        }
        return false
      } finally {
        request.tab?.close()
        if (this._commentServiceRequests?.get(key) === request) {
          this._commentServiceRequests.delete(key)
          if (this.commentServices[key]?.busy) this.$set(this.commentServices, key, null)
        }
      }
    },
    commentCanViewHistory() { return !!this.commentProvider() && this.commentCan('canView') && this.commentCan('canEdit') },
    openCommentHistory(event) {
      if (!this.commentCanViewHistory()) return false
      this.closeCommentMenus()
      this.commentHistoryOpen = true
      const rect = event?.currentTarget?.getBoundingClientRect?.()
      const top = Math.max(8, Math.min(window.innerHeight - 215, rect?.bottom || 47))
      this.commentHistoryStyle = { left: `${Math.max(8, Math.min(window.innerWidth - 368, (rect?.right || window.innerWidth - 16) - 360))}px`, top: `${top}px`, maxHeight: `${Math.max(80, window.innerHeight - top - 8)}px` }
      return true
    },
    closeCommentHistory() { this.commentHistoryOpen = false },
    commentAttachmentsOf(threadId) { return this.commentAttachments?.[threadId ? `thread:${threadId}` : 'composer'] || [] },
    commentImageState(attachments) {
      const network = createNetworkPolicy(this.larkDocConfig?.network)
      const readable = this.commentCan('canView')
      return (attachments || []).map(item => ({ ...item, url: readable && network.allows(item.url) ? item.url : '', blocked: !readable || !network.allows(item.url),
        blockedReason: !readable ? '当前没有查看图片的权限' : !network.allows(item.url) ? '图片被当前网络策略拦截' : '' }))
    },
    commentAttachmentDraftState(threadId) {
      return this.commentAttachmentsOf(threadId).map(item => ({ ...item, previewUrl: this.commentCan('canView') ? item.previewUrl : '', attachment: item.attachment ? this.commentImageState([item.attachment])[0] : null }))
    },
    commentReadyAttachments(threadId) { return this.commentAttachmentsOf(threadId).filter(item => item.status === 'ready').map(item => ({ ...item.attachment })) },
    commentDraftReady(threadId, draft) {
      const attachments = this.commentAttachmentsOf(threadId)
      if (attachments.length && !this.commentCanAttach()) return false
      return Boolean(String(draft || '').trim() || attachments.length) && attachments.every(item => item.status === 'ready')
    },
    commentCanAttach() { return this.commentCan('canView') && this.commentAllowed('reply') && this.commentProvider()?.supportsAttachments === true },
    closeCommentAttachmentPreview() { this._commentAttachmentViewer?.viewer.destroy(); this._commentAttachmentViewer = null },
    openCommentAttachment(threadId, commentId, index = 0) {
      const provider = this.commentProvider(), session = this.session, editor = this.editor
      const reply = this.commentThreads.find(thread => thread.id === threadId)?.replies.find(reply => reply.id === commentId)
      const selected = reply?.attachments?.[index]
      const urls = (reply?.attachments || []).map(item => item.url).filter(url => createNetworkPolicy(this.larkDocConfig?.network).allows(url))
      const currentReply = () => this.commentThreads.find(thread => thread.id === threadId)?.replies.find(reply => reply.id === commentId)
      const current = () => this.editor === editor && !editor?.isDestroyed && this.session === session && this.commentProvider() === provider && this.commentCan('canView')
        && currentReply()?.attachments?.some(item => item.url === selected?.url) && createNetworkPolicy(this.larkDocConfig?.network).allows(selected.url)
        && urls.every(url => currentReply()?.attachments?.some(item => item.url === url) && createNetworkPolicy(this.larkDocConfig?.network).allows(url))
      if (!selected || !current()) return false
      this.closeCommentAttachmentPreview()
      const images = reply.attachments.filter(item => createNetworkPolicy(this.larkDocConfig?.network).allows(item.url)).map(item => ({ src: item.url, alt: item.name }))
      let viewer
      viewer = createImageViewer({ host: this.$refs.panelHost, images, index: images.findIndex(item => item.src === selected.url), initialScale: 1,
        canLoad: src => current() && currentReply()?.attachments?.some(item => item.url === src) && createNetworkPolicy(this.larkDocConfig?.network).allows(src),
        onClose: () => { if (this._commentAttachmentViewer?.viewer === viewer) this._commentAttachmentViewer = null } })
      if (!viewer) return false
      viewer.dom.classList.add('lark-doc-comment-attachment-viewer')
      this._commentAttachmentViewer = { viewer, current }
      return true
    },
    removeCommentAttachment(threadId, id) {
      const key = threadId ? `thread:${threadId}` : 'composer'
      const task = this._commentAttachmentTasks?.get(id)
      task?.controller?.abort('removed')
      if (task?.previewUrl) URL.revokeObjectURL(task.previewUrl)
      this._commentAttachmentTasks?.delete(id)
      if (this.commentAttachments?.[key]) this.$set(this.commentAttachments, key, this.commentAttachmentsOf(threadId).filter(item => item.id !== id))
    },
    clearCommentAttachments(threadId) {
      if (threadId !== undefined) {
        this.commentAttachmentsOf(threadId).forEach(item => this.removeCommentAttachment(threadId, item.id))
        return
      }
      this._commentAttachmentTasks?.forEach(task => { task.controller?.abort('context-change'); if (task.previewUrl) URL.revokeObjectURL(task.previewUrl) })
      this._commentAttachmentTasks?.clear()
      this.commentAttachments = {}
    },
    async addCommentAttachments(threadId, files) {
      if (!this.commentCanAttach()) { this.error = '当前评论服务不支持图片或没有评论权限'; return false }
      if (threadId && !this.commentThreads.some(thread => thread.id === threadId && !thread.resolved) || !threadId && !this.commentComposer) return false
      if (!this._commentAttachmentTasks) this._commentAttachmentTasks = new Map()
      const ids = []
      const input = this.uploader || this.uploadImage, provider = this.commentProvider(), session = this.session, editor = this.editor
      const network = JSON.stringify(this.larkDocConfig?.network || {}), epoch = this.commentContextEpoch, anchor = this._commentComposerAnchor
      const batch = { ids, threadId, invalidated: false }
      batch.current = () => !batch.invalidated && this.commentContextEpoch === epoch && this.editor === editor && !editor?.isDestroyed
        && this.session === session && this.commentProvider() === provider && (this.uploader || this.uploadImage) === input
        && JSON.stringify(this.larkDocConfig?.network || {}) === network && this.commentCanAttach()
        && (threadId ? this.commentThreads.some(thread => thread.id === threadId && !thread.resolved) : !!this.commentComposer && this._commentComposerAnchor === anchor)
      for (const file of Array.from(files || [])) {
        const id = `comment-image-${this._commentAttachmentSeq = (this._commentAttachmentSeq || 0) + 1}`
        let previewUrl = ''
        try { validateUploadFile(file, { maxSize: this.effectiveImageMaxSize, mime: COMMENT_IMAGE_MIME }); previewUrl = URL.createObjectURL?.(file) || '' } catch (_) { /* The upload path reports validation failures without previewing rejected files. */ }
        this._commentAttachmentTasks.set(id, { file, threadId, previewUrl, batch })
        this.$set(this.commentAttachments, threadId ? `thread:${threadId}` : 'composer', this.commentAttachmentsOf(threadId).concat([{ id, name: file.name, previewUrl, status: 'pending', progress: 0, error: '' }]))
        ids.push(id)
      }
      for (const id of ids) {
        if (!batch.current()) { this.stopCommentAttachmentBatch(batch); break }
        await this.retryCommentAttachment(threadId, id, batch)
      }
      return ids.length > 0
    },
    stopCommentAttachmentBatch(batch) {
      if (batch.invalidated) return
      batch.invalidated = true
      const stopped = new Set()
      batch.ids.forEach(id => {
        const task = this._commentAttachmentTasks?.get(id)
        if (task?.batch !== batch) return
        task.controller?.abort('batch-context-change')
        stopped.add(id)
      })
      if (stopped.size) this.$set(this.commentAttachments, batch.threadId ? `thread:${batch.threadId}` : 'composer', this.commentAttachmentsOf(batch.threadId).map(item => stopped.has(item.id) && (item.status === 'pending' || item.status === 'uploading')
        ? { ...item, status: 'error', error: '上传上下文已改变，请手动重试' } : item))
    },
    async retryCommentAttachment(threadId, id, batch = null) {
      const task = this._commentAttachmentTasks?.get(id)
      if (!task || task.controller && !task.controller.signal.aborted && task.running || !this.commentCanAttach()) return false
      if (batch && (task.batch !== batch || !batch.current())) return false
      task.batch = batch
      const input = this.uploader || this.uploadImage
      const provider = this.commentProvider(), session = this.session, editor = this.editor
      const network = createNetworkPolicy(this.larkDocConfig?.network)
      const update = patch => {
        if (!this.commentAttachmentsOf(threadId).some(item => item.id === id)) return
        this.$set(this.commentAttachments, threadId ? `thread:${threadId}` : 'composer', this.commentAttachmentsOf(threadId).map(item => item.id === id ? { ...item, ...patch } : item))
      }
      const controller = task.controller = new AbortController()
      task.running = true
      const current = () => this._commentAttachmentTasks?.get(id) === task && !controller.signal.aborted && !editor?.isDestroyed
        && (!batch || batch.current())
        && this.editor === editor && this.session === session && this.commentProvider() === provider && this.commentCanAttach()
        && (this.uploader || this.uploadImage) === input && JSON.stringify(this.larkDocConfig?.network || {}) === task.network
        && (threadId ? this.commentThreads.some(thread => thread.id === threadId && !thread.resolved) : !!this.commentComposer)
      task.network = JSON.stringify(this.larkDocConfig?.network || {})
      task.current = current
      update({ status: 'uploading', progress: 0, error: '' })
      try {
        // Opaque custom transports cannot establish an allowlisted destination. A host may
        // explicitly declare an offline uploader; known HTTP actions use the shared policy.
        if (input && network.mode !== 'open' && input.offline !== true && !(typeof input.action === 'string' && network.allows(input.action))) throw new Error('当前网络策略未允许评论图片上传服务')
        if (this._commentUploaderInput !== input || !this._commentUploader) {
          this._commentUploader = normalizeUploader(input, { limits: null })
          this._commentUploaderInput = input
        }
        if (!current()) {
          if (batch) this.stopCommentAttachmentBatch(batch)
          else update({ status: 'error', error: '原评论或上传上下文已改变，请重新打开评论后重试' })
          return false
        }
        const uploaded = await this._commentUploader.upload(task.file, { documentId: session?.documentId || '', source: 'comment', signal: controller.signal,
          limits: { maxSize: this.effectiveImageMaxSize, mime: COMMENT_IMAGE_MIME }, onProgress: event => { if (current()) update({ progress: event.percent || 0 }) } })
        if (!current()) return false
        if (!network.allows(uploaded.url)) throw new Error('评论图片被当前网络策略拦截')
        update({ status: 'ready', progress: 100, attachment: uploaded, previewUrl: '' })
        if (task.previewUrl) { URL.revokeObjectURL(task.previewUrl); task.previewUrl = '' }
        return true
      } catch (error) {
        if (current()) update({ status: 'error', error: isAbortError(error) ? '图片上传已取消，可重试' : error?.message || '图片上传失败，请重试' })
        return false
      } finally {
        if (task.controller === controller) {
          task.running = false
          if (this._commentAttachmentTasks?.get(id) === task && this.commentAttachmentsOf(threadId).some(item => item.id === id && item.status === 'uploading')) update({ status: 'error', error: '上传未完成，权限或文档状态可能已改变，请重试' })
        }
      }
    },
    reconcileCommentRequests() {
      if (!this.commentCan('canView') || !this.commentCan('canEdit')) this.commentHistoryOpen = false
      if (this._commentAttachmentViewer && !this._commentAttachmentViewer.current()) this.closeCommentAttachmentPreview()
      this._commentServiceRequests?.forEach((request, key) => {
        if (request.current?.() !== false) return
        request.controller.abort()
        request.tab?.close()
        this._commentServiceRequests.delete(key)
        this.$set(this.commentServices, key, null)
      })
      this._commentAttachmentTasks?.forEach(task => {
        if (task.batch && !task.batch.current()) this.stopCommentAttachmentBatch(task.batch)
        if (task.running && task.current?.() === false) task.controller.abort('context-change')
      })
    },
    toggleCommentReaction(threadId, commentId, emoji) {
      return this.mutateComment('toggleReaction', { threadId, commentId, author: this.commentAuthor, emoji }, 'react')
    },
    closeCommentReaction() { this._commentReactionToken = (this._commentReactionToken || 0) + 1; this.commentReaction = null },
    async openCommentReaction(threadId, commentId, event) {
      if (!this.commentAllowed('react')) return false
      if (typeof this.commentProvider()?.toggleReaction !== 'function') { this.error = '当前评论服务不支持表情回复'; return false }
      const session = this.session, provider = this.commentProvider(), editor = this.editor
      const rect = event?.currentTarget?.getBoundingClientRect?.() || this.$refs.root.getBoundingClientRect()
      const token = this._commentReactionToken = (this._commentReactionToken || 0) + 1
      try {
        const catalog = await loadReactionCatalog()
        if (token !== this._commentReactionToken || this.session !== session || this.editor !== editor || editor?.isDestroyed || this.commentProvider() !== provider || !this.commentAllowed('react')) return false
        this.commentReactionCatalog = catalog
        this.commentReaction = { threadId, commentId, style: { left: `${Math.max(8, Math.min(window.innerWidth - 354, rect.right - 346))}px`, top: `${Math.max(8, Math.min(window.innerHeight - 350, rect.top - 350))}px` } }
        return true
      } catch (error) { if (token === this._commentReactionToken) this.error = error?.message || '表情加载失败，请重试'; return false }
    },
    async selectCommentReaction(emoji) {
      const target = this.commentReaction
      if (!target || !this.commentReactionCatalog?.items.some(item => item.id === emoji)) return false
      this.closeCommentReaction()
      const result = await this.toggleCommentReaction(target.threadId, target.commentId, emoji)
      if (result) this.commentReactionRecent = [emoji, ...this.commentReactionRecent.filter(id => id !== emoji)].slice(0, 7)
      return Boolean(result)
    },
    quickCommentReaction(threadId, commentId) {
      this.closeCommentReaction()
      return this.toggleCommentReaction(threadId, commentId, 'thumbsup_v2')
    },
    quoteCommentReply(threadId, commentId) {
      if (!this.commentAllowed('reply')) return false
      const reply = this.commentThreads.find(thread => thread.id === threadId)?.replies.find(reply => reply.id === commentId)
      if (!reply) return false
      this.closeCommentMenus()
      this.activateComment(threadId)
      const name = this.commentAuthorName(reply.author), prefix = `@${name} `
      const draft = this.commentDraftOf(threadId)
      this.$set(this.commentReplyTargets, threadId, { commentId, authorId: reply.author.id, authorName: name })
      this.setCommentDraft(threadId, draft.startsWith(prefix) ? draft : prefix + draft)
      this.$nextTick(() => this._panelsUi?.comment?.focusReply(threadId))
      return true
    },

    // —— 选区 → 锚点 ——
    commentCellSnapshot(node) {
      const ids = []
      node.descendants(child => { if (child.attrs.blockId) ids.push(child.attrs.blockId) })
      return { type: node.type.name, size: node.nodeSize, ids: ids.join('\u0000'), text: node.textBetween(0, node.content.size, ' ', '') }
    },
    commentCellSelectionRange(selection, doc) {
      const table = selection.$anchorCell.node(-1), tablePos = selection.$anchorCell.start(-1) - 1
      if (table.type.name !== 'table' || !table.attrs.blockId) return null
      const cells = [], ranges = []
      let stable = true
      selection.forEachCell((node, pos) => {
        cells.push({ from: pos, to: pos + node.nodeSize, snapshot: this.commentCellSnapshot(node) })
        node.descendants((child, offset) => {
          if (!child.isTextblock) return true
          if (!child.attrs.blockId) stable = false
          const from = pos + offset + 2, to = from + child.content.size
          ranges.push({ from, to, blockId: child.attrs.blockId, text: doc.textBetween(from, to, '\n', ' ') })
          return false
        })
      })
      if (!stable || !cells.length) return null
      cells.sort((a, b) => a.from - b.from)
      ranges.sort((a, b) => a.from - b.from)
      const from = cells[0].from + 1, to = cells[cells.length - 1].to - 1
      const quote = cells.map(cell => cell.snapshot.text.trim()).filter(Boolean).join(' ')
      return { blockId: table.attrs.blockId, tablePos, from, to, offset: from - tablePos - 1, length: to - from,
        text: quote, quote, cells, ranges, bookmark: selection.getBookmark() }
    },
    commentCellRangeCurrent(range, doc) {
      const table = doc.nodeAt(range.tablePos)
      if (table?.type.name !== 'table' || table.attrs.blockId !== range.blockId) return false
      try {
        const selection = range.bookmark.resolve(doc)
        if (!(selection instanceof CellSelection) || selection.$anchorCell.node(-1).attrs.blockId !== range.blockId
          || !range.cells.some(cell => cell.from === selection.$anchorCell.pos) || !range.cells.some(cell => cell.from === selection.$headCell.pos)) return false
        if (!range.cells.every(cell => {
          const node = doc.nodeAt(cell.from)
          return node && cell.to - cell.from === node.nodeSize && JSON.stringify(this.commentCellSnapshot(node)) === JSON.stringify(cell.snapshot)
        })) return false
        if (!range.ranges.every(item => {
          const block = doc.nodeAt(item.from - 1)
          return block?.isTextblock && block.attrs.blockId === item.blockId && item.to - item.from === block.content.size
            && doc.textBetween(item.from, item.to, '\n', ' ') === item.text
        })) return false
        range.from = Math.min(...range.cells.map(cell => cell.from + 1))
        range.to = Math.max(...range.cells.map(cell => cell.to - 1))
        range.offset = range.from - range.tablePos - 1
        range.length = range.to - range.from
        return range.offset >= 0 && range.offset + range.length <= table.content.size
      } catch (_) { return false }
    },
    mapCommentCellRange(range, transaction) {
      const table = transaction.mapping.mapResult(range.tablePos, 1)
      if (table.deletedAfter || table.deletedAcross) return false
      range.tablePos = table.pos
      for (const item of [...range.cells, ...range.ranges]) {
        const from = transaction.mapping.mapResult(item.from, 1), to = transaction.mapping.mapResult(item.to, -1)
        if (from.deletedAcross || to.deletedAcross || from.deletedAfter || to.deletedBefore || to.pos < from.pos) return false
        item.from = from.pos
        item.to = to.pos
      }
      range.bookmark = range.bookmark.map(transaction.mapping)
      return this.commentCellRangeCurrent(range, transaction.doc)
    },
    /**
     * 当前选区落在哪个块、块内偏移多少。空选区 / 找不到带 blockId 的祖先都返回 null
     * （05 §5.5 要求 `blockId` 是身份主键，没有块 id 的选区不该建评论）。
     */
    commentSelectionRange() {
      if (!this.editor) return null
      const state = this.editor.state
      const selection = state.selection
      if (!selection || selection.empty) return null
      if (selection instanceof CellSelection) return this.commentCellSelectionRange(selection, state.doc)
      const from = selection.from
      const to = selection.to
      if (selection.node?.isBlock && selection.node.attrs.blockId) {
        const node = selection.node
        const link = ['linkEmbed', 'bookmark'].includes(node.type.name)
        const quote = node.type.name === 'bookmark' || node.type.name === 'linkEmbed' && node.attrs.view === 'card'
          ? '[网页卡片]' : node.type.name === 'linkEmbed' ? '[网页]' : node.type.name === 'image' ? '图片' : node.textContent
        return { blockId: selection.node.attrs.blockId, blockOnly: true, offset: 0, length: selection.node.content.size, from, to,
          text: state.doc.textBetween(from, to, '\n', ' '), quote, ...(link ? { linkTarget: { type: node.type.name, href: node.attrs.href || node.attrs.url } } : {}) }
      }
      const resolved = state.doc.resolve(from)
      for (let depth = resolved.depth; depth > 0; depth -= 1) {
        const node = resolved.node(depth)
        const blockId = node.attrs && typeof node.attrs.blockId === 'string' ? node.attrs.blockId.trim() : ''
        if (!blockId) continue
        const contentStart = resolved.before(depth) + 1
        return {
          blockId,
          offset: Math.max(0, from - contentStart),
          length: Math.max(0, to - from),
          from,
          to,
          text: state.doc.textBetween(from, to, '\n', ' '),
        }
      }
      return null
    },
    /** 把 comment mark 落到一段选区上（mark 没注册时静默：`setComment` 命令不存在）。 */
    applyCommentMark(threadId, from, to) {
      if (!this.editor || typeof this.editor.commands.setComment !== 'function') return false
      const size = this.editor.state.doc.content.size
      const start = Math.max(0, Math.min(from, size))
      const end = Math.max(start, Math.min(to, size))
      this.editor.chain().focus().setTextSelection({ from: start, to: end }).setComment({ threadId }).setTextSelection(end).run()
      return true
    },

    // —— 草稿 ——
    setCommentDraft(threadId, text) {
      if (!threadId || !this.commentAllowed('reply')) return
      this.$set(this.commentDrafts, threadId, typeof text === 'string' ? text : '')
    },
    clearCommentDraft(threadId) {
      if (!threadId) return
      this.clearCommentAttachments(threadId)
      this.$set(this.commentDrafts, threadId, '')
      this.commentReplyTargets = Object.fromEntries(Object.entries(this.commentReplyTargets || {}).filter(([id]) => id !== threadId))
    },
    commentHasDraft(threadId) {
      return commentDraftText(this.commentDrafts, threadId).trim().length > 0 || this.commentAttachmentsOf(threadId).length > 0
    },

    // —— 点亮、已读、跳转 ——
    activateComment(threadId) {
      const next = threadId || ''
      if (next === this.commentActiveThreadId) return
      this.commentActiveThreadId = next
      if (next) this.markCommentRead(next)
      this.$nextTick(() => this.placeCommentPanels())
    },
    markCommentRead(threadId) {
      if (!threadId || this.commentReadIds.indexOf(threadId) !== -1) return
      this.commentReadIds = this.commentReadIds.concat([threadId])
    },
    /** 面板头「下一条 / 上一条」：只在面板顺序里前后跳，跳出去不动（同修订面板口径）。 */
    goComment(threadId, direction) {
      const index = this.commentPanels.findIndex((item) => item.id === threadId)
      if (index === -1) return
      const next = this.commentPanels[index + (direction < 0 ? -1 : 1)]
      if (!next) return
      this.activateComment(next.id)
      this.scrollCommentIntoView(next.blockId)
    },
    scrollCommentIntoView(blockId) {
      if (!this.editor) return
      const pos = this.commentBlockPos(blockId)
      if (pos < 0) return
      try {
        const at = this.editor.view.domAtPos(pos)
        const node = at.node && at.node.nodeType === 3 ? at.node.parentNode : at.node
        if (node && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'center' })
      } catch (error) {
        // 滚不动不影响点亮结果，静默（没有 toast 位）。
      }
    },
    commentBlockPos(blockId) {
      if (!this.editor || typeof blockId !== 'string' || !blockId) return -1
      let found = -1
      this.editor.state.doc.descendants((node, pos) => {
        if (found !== -1) return false
        if (node.attrs && node.attrs.blockId === blockId) {
          found = pos
          return false
        }
        return true
      })
      return found
    },

    // —— 开关与菜单 ——
    toggleCommentPrivate(threadId) {
      if (!threadId) return
      const on = this.commentPrivateIds.indexOf(threadId) !== -1
      this.commentPrivateIds = on
        ? this.commentPrivateIds.filter((id) => id !== threadId)
        : this.commentPrivateIds.concat([threadId])
    },
    commentPrivate(threadId) {
      return this.commentPrivateIds.indexOf(threadId) !== -1
    },
    toggleCommentMoreMenu(threadId) {
      this.commentMoreThreadId = this.commentMoreThreadId === threadId ? '' : threadId
    },
    toggleCommentReplyMenu(threadId, commentId) {
      const same = this.commentMenuThreadId === threadId && this.commentMenuCommentId === commentId
      this.commentMenuThreadId = same ? '' : threadId
      this.commentMenuCommentId = same ? '' : commentId
    },
    closeCommentReplyMenu(threadId, commentId) {
      if (this.commentMenuThreadId !== threadId || this.commentMenuCommentId !== commentId) return
      this.commentMenuThreadId = ''
      this.commentMenuCommentId = ''
    },
    closeCommentMenus() {
      this.closeCommentReaction()
      this.commentMoreThreadId = ''
      this.commentMenuThreadId = ''
      this.commentMenuCommentId = ''
    },
    runCommentReplyControl(id, threadId, commentId, event) {
      if (id === 'more') {
        if (event?.type === 'mouseenter') {
          this.commentMenuThreadId = threadId
          this.commentMenuCommentId = commentId
          return
        }
        return this.toggleCommentReplyMenu(threadId, commentId)
      }
      if (id === 'emoji') return this.openCommentReaction(threadId, commentId, event)
      if (id === 'quote') return this.quoteCommentReply(threadId, commentId)
      return undefined
    },
    /** Reply actions retain the same author and provider context as persistence. */
    runCommentMenuItem(id, threadId, commentId) {
      this.closeCommentMenus()
      if (id === 'delete') return this.deleteCommentReply(threadId, commentId)
      if (id === 'edit') return this.beginCommentEdit(threadId, commentId)
      if (id === 'translate' || id === 'report') return this.runCommentService(id, threadId, commentId)
      return undefined
    },
    /**
     * Editing requires ownership. The current source also shows Report on one's own replies;
     * service availability separately disables actions that the provider does not implement.
     */
    commentMenuVisible(item, reply) {
      const meta = COMMENT_REPLY_MENU_ITEMS.find((entry) => entry.id === item.id)
      if (!meta) return true
      const owner = reply && reply.author ? reply.author.id : ''
      const mine = Boolean(owner) && owner === this.commentAuthor.id
      if (meta.ownOnly) return mine
      if (meta.othersOnly) return Boolean(owner) && !mine
      return true
    },
    /** 头部六按钮派发。`resolve` 在已解决面板里换成 `reopen`（重开在已解决面板）。 */
    runCommentControl(id, threadId) {
      if (id === 'go-next') return this.goComment(threadId, 1)
      if (id === 'go-previous') return this.goComment(threadId, -1)
      if (id === 'resolve') return this.resolveComment(threadId)
      if (id === 'reopen') return this.reopenComment(threadId)
      if (id === 'copyAnchor') return this.copyCommentAnchor(threadId)
      if (id === 'more') return this.toggleCommentMoreMenu(threadId)
      return undefined
    },
    /**
     * 复制锚点：把引用原文放进剪贴板（04 §3.1④ `_copyAnchor-btn`）。
     * 剪贴板不可用时静默 —— 面板没有 toast 位，报错只会吓到人。
     */
    async copyCommentAnchor(threadId) {
      const item = this.commentThreads.find((thread) => thread.id === threadId)
      if (!item || typeof window === 'undefined') return false
      const url = new URL(window.location.href)
      url.searchParams.set('comment_id', item.id)
      url.searchParams.set('comment_type', '0')
      url.searchParams.set('comment_anchor', 'true')
      const copied = await this.copyShareText(url.href)
      if (copied) this.showShareToast('success', '复制成功')
      return copied
    },
    jumpCommentAnchor() {
      if (typeof window === 'undefined') return false
      const id = new URL(window.location.href).searchParams.get('comment_id')
      const item = this.commentThreads.find(thread => thread.id === id && thread.bound && !thread.resolved)
      if (!item) return false
      const previous = this._commentLinkContext
      if (previous?.id === id && previous.editor === this.editor && previous.session === this.session && previous.provider === this.commentProvider()) return false
      this._commentLinkContext = { id, editor: this.editor, session: this.session, provider: this.commentProvider() }
      this.activateComment(id)
      this.scrollCommentIntoView(item.blockId)
      return true
    },
    commentControlDisabled(id, threadId) {
      if (id === 'go-next' || id === 'go-previous') {
        const index = this.commentPanels.findIndex((item) => item.id === threadId)
        if (index === -1) return true
        return id === 'go-next' ? index >= this.commentPanels.length - 1 : index <= 0
      }
      if (id === 'resolve' || id === 'reopen') return !this.commentAllowed(id)
      return false
    },

    // —— 几何 ——
    /** 由宿主的 `onTransaction` 调；只做「过滤 + 清理失效 id」，几何交给下一帧。 */
    updateCommentPanels() {
      if (!this.editor) {
        this.commentPanels = []
        this.commentActiveThreadId = ''
        return
      }
      const items = this.commentThreads.filter((thread) => thread.bound && !thread.resolved)
      if (this.commentActiveThreadId && !items.some((thread) => thread.id === this.commentActiveThreadId)) {
        this.commentActiveThreadId = ''
      }
      this.commentPanels = items.map((thread) => ({ ...thread, left: 0, top: 0 }))
      const threads = new Map(this.commentThreads.map(thread => [thread.id, thread]))
      this.editor.view?.dom.querySelectorAll('.lark-doc-comment[data-thread-id]').forEach(mark => {
        const thread = threads.get(mark.getAttribute('data-thread-id'))
        mark.setAttribute('data-resolved', String(!!thread?.resolved))
        mark.setAttribute('data-comment-missing', String(!thread))
      })
      this.$nextTick(() => this.placeCommentPanels())
    },
    placeCommentPanels() {
      const view = this.editor && this.editor.view
      if (!view || !this.commentPanels.length) return
      const bound = view.dom.getBoundingClientRect()
      const maxLeft = window.innerWidth - COMMENT_PANEL.width - COMMENT_VIEWPORT_MARGIN
      const left = Math.max(COMMENT_VIEWPORT_MARGIN, Math.min(maxLeft, bound.right + COMMENT_ANCHOR_GUTTER))
      const bottomLimit = window.innerHeight - COMMENT_VIEWPORT_MARGIN
      let floor = COMMENT_VIEWPORT_MARGIN
      this.commentPanels = this.commentPanels.map((item) => {
        const pos = this.commentBlockPos(item.blockId)
        let anchorTop = bound.top
        if (pos >= 0) {
          try {
            anchorTop = view.coordsAtPos(pos + 1).top
          } catch (error) {
            anchorTop = bound.top
          }
        }
        const height = this._panelsUi?.comment?.heightOf?.(item.id) || commentPanelHeight(item.replies.length, this.commentHasDraft(item.id))
        let top = Math.max(floor, anchorTop)
        // 放不下就上收，但**不收过前一块**，否则两个面板会叠在一起。
        if (top + height > bottomLimit) top = Math.max(floor, bottomLimit - height)
        floor = top + height + COMMENT_PANEL_GAP
        return { ...item, left, top }
      })
    },
    onCommentViewportChange(event) {
      if (event?.target?.closest?.('.lark-doc-comment-reaction-picker')) return
      this.closeCommentReaction()
      if (this.commentPanels.length) this.placeCommentPanels()
    },

    // —— 渲染给面板的取值 ——
    commentPanelHeightOf(item) {
      return commentPanelHeight(item.replies.length, this.commentHasDraft(item.id)) + item.replies.filter(reply => reply.reactions?.length).length * 26
    },
    commentPanelStyle(item) {
      return { left: `${item.left}px`, top: `${item.top}px` }
    },
    commentDraftOf(threadId) {
      return commentDraftText(this.commentDrafts, threadId)
    },
    commentTimeAt(at) {
      return commentRelativeTime(Date.now(), at)
    },
    commentAuthorName(author) {
      const name = author && typeof author.name === 'string' ? author.name.trim() : ''
      return name || '我'
    },
    /** 引用头：优先用落库时的快照文本，没有就退回锚点块的第一段（飞书同样是快照）。 */
    commentQuoteOf(item) {
      return typeof item.quote === 'string' && item.quote ? item.quote : ''
    },
    commentTextareaHeight(item) {
      return this.commentHasDraft(item.id) ? COMMENT_HEIGHTS.textareaActive : COMMENT_HEIGHTS.textarea
    },
    /** 点正文高亮点亮对应线程（与 04 §3.1② 的双向跳转一致）。 */
    onCommentPointerDown(event) {
      const target = event.target
      const container = target && typeof target.closest === 'function' ? target.closest('.lark-doc-comment') : null
      if (!container || container.getAttribute('data-comment-missing') === 'true') return
      this.activateComment(container.getAttribute('data-thread-id') || '')
    },
  },
}
