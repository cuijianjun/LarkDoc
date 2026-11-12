/** 评论正文独立持久化；远端动作只有数据库原键确认后更新视图。 */
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import {
  COMMENT_HEIGHTS,
  COMMENT_PANEL,
  COMMENT_MORE_MENU,
  COMMENT_REPLY_MENU,
  commentPanelHeight,
} from '../../../core/blocks/comment'
import { unreadCount } from '../../../core/comments/index'
import { bindThreads, resolveAnchorCodec } from '../../../core/comments/binding'
import { normalizeAuthor } from '../../../core/comments/thread'
import { normalizeCommentMetadata } from '../../../core/comments/mentions'
import { encodeAnchor, decodeAnchor } from '../../../core/comments/anchor'
import { createCommentOperationId } from '../../../providers/comments'
import { projectCapabilityUi } from '../../../core/policy/capability'

let commentImagesPromise
function loadCommentImages() {
  if (!commentImagesPromise) commentImagesPromise = import(/* webpackChunkName: "editor-comment-images" */ './commentImages').catch(error => { commentImagesPromise = null; throw error })
  let timer
  return Promise.race([commentImagesPromise, new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('COMMENT_IMAGE_COMPONENT_TIMEOUT')), 15000) })]).finally(() => clearTimeout(timer))
}

/** 面板与正文右缘的间距（实测 1214 - 1202，与修订面板同口径）。 */
const COMMENT_ANCHOR_GUTTER = 12
/** 贴视口边的最小留白，与 isv 面板同口径。 */
const COMMENT_VIEWPORT_MARGIN = 8
/** 两个面板纵向叠放时的间隙。**不属于面板几何**（04 §3.1④ 没测），故不进 `COMMENT_PANEL`。 */
const COMMENT_PANEL_GAP = 8









/**
 * 写操作 → 需要哪个 capability。
 * 表在这里是因为「哪些动作归哪把钥匙」只有一处答案，散在各个方法里迟早会漏一个。
 */
export const COMMENT_GATES = Object.freeze({
  create: 'canComment',
  reply: 'canComment',
  react: 'canComment',
  remove: 'canComment',
  edit: 'canComment',
  participants: 'canComment',
  visibility: 'canComment',
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

export function commentSidebarThreads(threads, remote, historical, resolved) {
  return threads.filter(thread => remote ? !thread.tombstone && thread.scope !== 'document' && (historical ? thread.anchorStatus === 'orphaned' : resolved ? thread.resolved : !thread.resolved && thread.anchorStatus !== 'orphaned') : thread.bound && !thread.resolved)
}

export default {
  data() {
    return {
      /** Provider 返回并经 `bindThreads` 绑过的线程（含 resolved，面板自己过滤）。 */
      commentThreads: [],
      commentSourceThreads: [],
      commentMessage: '',
      commentComposerOpen: false,
      commentSidebarOpen: false,
      commentHistory: false,
      commentHistorical: false,
      commentComposerContext: null,
      commentCreateDraft: '',
      commentDocumentDraft: '',
      commentDocumentMentions: [],
      commentDocumentReferences: [],
      commentDocumentReplyTarget: null,
      commentCreatePrivate: false,
      commentFollowPreferences: {},
      commentFollowReadGeneration: 0,
      commentFollowBusy: false,
      commentPendingFollowOperation: '',
      commentIdentityGeneration: 0,
      commentOperationGeneration: 0,
      commentTranslationContext: null,
      commentTranslationLanguage: '',
      commentTranslationState: null,
      commentTranslationBusy: false,
      commentPendingTranslationOperation: '',
      commentPendingOperation: '',
      commentBusy: false,
      commentImageDrafts: {},
      commentImageDraftGenerations: {},
      commentImageUrls: {},
      commentImageErrors: {},
      commentImageGeneration: 0,
      commentImageBusy: false,
      commentPendingImage: null,
      commentImageViewer: null,
      commentReactionContext: null,
      commentReactionQuery: '',
      commentReactionCategory: '常用',
      commentReactionLimit: 120,
      commentEditingReply: null,
      commentEditContent: '',
      commentEditGeneration: 0,
      commentEditMentions: [],
      commentEditReferences: [],
      commentParticipantThread: '',
      commentParticipantRevision: '',
      commentParticipantQuery: '',
      commentParticipantSelection: [],
      commentParticipantCandidates: [],
      commentParticipantIndex: -1,
      commentParticipantBusy: false,
      commentParticipantError: '',
      commentLoadGeneration: 0,
      commentDisposed: false,
      /** 点亮 / 展开输入的线程 id。飞书的面板只对一条线程展开输入区。 */
      commentActiveThreadId: '',
      /** threadId → 草稿文本。Vue 2 加新键必须走 `$set`，见 `setCommentDraft`。 */
      commentDrafts: {},
      /** 已读线程 id：未读数按它与 `commentThreads` 做差集。 */
      commentReadIds: [],
      /** 本地Provider保留旧开关；远端使用服务端visibility。 */
      commentPrivateIds: [],
      /** 面板头「更多」下拉打开的线程 id（同时只允许一个，关别的靠它互斥）。 */
      commentMoreThreadId: '',
      /** 回复行「更多」菜单：`{ threadId, commentId }`，空串 = 关着。 */
      commentMenuThreadId: '',
      commentReplyMenuPosition: null,
      commentMoreMenuPosition: null,
      commentLayerHeight: null,
      commentLayerTop: 125,
      commentComposerGap: 0,
      commentMenuCommentId: '',
      /** 带几何的面板列表（bound 且未解决），与 `revisionPanels` 同形态。 */
      commentPanels: [],
      /** 协同宿主注入 yjs codec 工厂的入口；不注入就走 plain（core 不 import yjs）。 */
      commentAnchorOptions: {},
    }
  },
  computed: {
    commentCapabilityState() { return projectCapabilityUi(this.session, 'canComment') },
    
    
    
    commentDocumentThreads() { return this.commentThreads.filter(thread => thread.scope === 'document' && !thread.tombstone) },
    commentSelectionCount() { return this.commentThreads.filter(thread => thread.scope !== 'document' && !thread.tombstone && !thread.resolved && thread.anchorStatus !== 'orphaned').length },
    commentRemote() { const provider = this.commentProvider(); return Boolean(provider && provider.isRemote) },
    
    
    
    
    
    
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
      const provider = this.commentProvider()
      const codec = provider && typeof provider.getAnchorCodec === 'function' ? provider.getAnchorCodec(this.editor) : null
      return codec || resolveAnchorCodec(this.editor, this.commentAnchorOptions)
    },
    /** 当前用户（写路径的 author）。没有 session 时回落本地作者，`buildReply` 要非空 id。 */
    commentAuthor() {
      const user = this.session && this.session.user ? this.session.user : null
      return normalizeAuthor(user || { id: 'local-user', name: '我' })
    },
  },
  watch: { session: { sync: true, handler() { this.resetCommentIdentityView(); this.bindCommentSession() } } },
  mounted() {
    this.bindCommentSession()
    document.addEventListener('pointerdown', this.onCommentReactionOutside, true)
    window.addEventListener('keydown', this.onCommentReactionKeydown, true)
    // 宿主的 `mounted` 在本钩子之后才建编辑器 —— 延一帧再拉评论、挂监听。
    this.$nextTick(() => {
      if (!this.editor) return
      this.editor.view.dom.addEventListener('pointerdown', this.onCommentPointerDown)
      this.editor.on('transaction', this.onCommentTransaction)
      this.loadComments().then(() => this.openCommentLink()).catch(() => {})
    })
    window.addEventListener('scroll', this.onCommentViewportChange, true)
    window.addEventListener('resize', this.onCommentViewportChange)
  },
  beforeDestroy() {
    this.resetCommentParticipants()
    document.removeEventListener('pointerdown', this.onCommentReactionOutside, true)
    window.removeEventListener('keydown', this.onCommentReactionKeydown, true)
    this.resetCommentImages()
    this.closeCommentReaction()
    this.commentDisposed = true; this.commentLoadGeneration++
    if (this._commentStopCapabilities) this._commentStopCapabilities()
    if (this._commentStopProvider) this._commentStopProvider()
    if (this._commentStopReset) this._commentStopReset()
    if (this._commentStopChanges) this._commentStopChanges()
    if (this._commentStopAssets) this._commentStopAssets()
    if (this.editor) {
      this.editor.off('transaction', this.onCommentTransaction)
      if (this._commentDecorationKey) this.editor.unregisterPlugin(this._commentDecorationKey)
    }
    window.removeEventListener('scroll', this.onCommentViewportChange, true)
    window.removeEventListener('resize', this.onCommentViewportChange)
    if (this.editor && this.editor.view && this.editor.view.dom) {
      this.editor.view.dom.removeEventListener('pointerdown', this.onCommentPointerDown)
    }
  },
  methods: {
    setCommentMessage(value) { this.commentMessage = value },
    resetCommentIdentityView(preservePending = false, preserveSidebar = false) {
      this.resetCommentParticipants()
      this.resetCommentImages(preservePending)
      this.closeCommentReaction()
      this.commentIdentityGeneration = (this.commentIdentityGeneration || 0) + 1
      this.commentLoadGeneration++
      this.commentSourceThreads = []; this.commentThreads = []; this.commentPanels = []
      this.commentComposerContext = null; this.commentComposerOpen = false; this.commentSidebarOpen = preserveSidebar && this.commentSidebarOpen
      if (!preserveSidebar) this.commentHistorical = false
      this.commentDrafts = {}; this.commentCreateDraft = ''; this.commentDocumentDraft = ''; this.commentDocumentMentions = []; this.commentDocumentReferences = []; this.commentDocumentReplyTarget = null; this.cancelCommentEdit()
      this.commentFollowPreferences = {}; this.commentMessage = ''
      this.commentFollowReadGeneration++
      this.closeCommentMenus()
      if (!preservePending) {
        this._commentReconcileAfterAuthorization = false
        this.commentOperationGeneration++
        this.commentBusy = false; this.commentFollowBusy = false
        this.commentPendingOperation = ''; this._commentPendingProvider = null
        this.commentPendingFollowOperation = ''; this._commentPendingFollowProvider = null
      }
      this.commentTranslationContext = null; this.commentTranslationState = null; this.commentTranslationLanguage = ''; this._commentTranslationOwner = null
      this.commentPendingTranslationOperation = ''; this._commentPendingTranslationProvider = null; this.commentTranslationBusy = false
      this.refreshCommentDecorations()
    },
    bindCommentSession() {
      for (const key of ['_commentStopCapabilities', '_commentStopProvider', '_commentStopReset', '_commentStopChanges', '_commentStopAssets']) { this[key]?.(); this[key] = null }
      if (this.session && typeof this.session.on === 'function') {
        this._commentStopAssets = this.session.on('provider-changed', event => {
          if (event.name !== 'assets') return
          const unresolved = this.commentPendingImage || this._commentImageInFlight
          this.resetCommentImages()
          if (unresolved) this.commentMessage = '图片服务已变更，旧图片操作需在原服务核对。'
          this.syncCommentImages()
        })
        this._commentStopChanges = this.session.on('comments-changed', () => this.refreshCommentsFromSignal())
        this._commentStopReset = this.session.on('comments-reset', reason => this.resetCommentIdentityView(reason === 'authorization-required', reason === 'authorization-required'))
        this._commentStopCapabilities = this.session.on('capabilities', () => {
          this.resetCommentParticipants()
          this.resetCommentImages(true)
          this.closeCommentReaction()
          this.commentLoadGeneration++
          this.commentSourceThreads = []; this.commentThreads = []; this.commentPanels = []
          this.commentDrafts = {}; this.commentEditingReply = null; this.commentEditContent = ''; this.commentEditMentions = []; this.commentEditReferences = []
          this.commentFollowPreferences = {}
          this.commentTranslationContext = null; this.commentTranslationState = null
          this.refreshCommentDecorations()
          if (this.commentCan('canView')) this.loadComments().then(async () => {
            await this.openCommentLink()
            await this.recoverCommentAfterAuthorization()
            if (this.commentMoreThreadId && this.commentThreads.some(thread => thread.id === this.commentMoreThreadId && !thread.tombstone)) await this.loadCommentFollowPreference(this.commentMoreThreadId)
          }).catch(() => {})
        })
        this._commentStopProvider = this.session.on('comments-provider', () => {
          this.resetCommentIdentityView(true)
          if (this.commentPendingOperation) this.commentMessage = '评论服务已变更，原操作仍需查询确认。'
          this.loadComments().catch(() => {})
        })
      }
    },
    // 只响应服务端失效信号；合并到一个当前读，不轮询、不重放未知POST。
    refreshCommentsFromSignal() {
      this._commentSignalDirty = true
      if (this._commentSignalWork) return this._commentSignalWork
      this._commentSignalWork = (async () => {
        while (this._commentSignalDirty && !this.commentDisposed && this.commentRemote && this.commentCan('canView')) {
          this._commentSignalDirty = false
          await this.loadComments().catch(() => {})
          await this.recoverCommentAfterAuthorization()
        }
      })().finally(() => { this._commentSignalWork = null })
      return this._commentSignalWork
    },
    toggleCommentSidebar() {
      this.commentSidebarOpen = !this.commentSidebarOpen
      this.$nextTick(() => this.placeCommentPanels())
    },
    setCommentHistory(value) { this.commentHistorical = false; this.commentHistory = value === true; this.updateCommentPanels() },
    openHistoricalComments() { this.closeCommentMenus(); this.commentHistorical = true; this.commentHistory = false; this.commentSidebarOpen = true; this.commentComposerOpen = false; this.updateCommentPanels() },
    closeCommentComposer() {
      this.clearCommentDraftImages('selection')
      this.commentComposerOpen = false; this.commentComposerContext = null
      this.refreshCommentDecorations()
      this.$nextTick(() => this.editor && this.editor.commands.focus())
    },
    toggleCommentComposer() {
      if (this.commentComposerOpen) return this.closeCommentComposer()
      return this.openSelectionComment()
    },
    openSelectionComment() {
      if (!this.commentAllowed('create') || !this.editor) return false
      const range = this.commentSelectionRange()
      if (!range) { this.commentMessage = '请先选中要评论的文字。'; return false }
      try {
        const anchor = encodeAnchor({ blockId: range.blockId, offset: range.offset, length: range.length }, this.commentAnchorCodec)
        if (this.commentRemote && (!anchor || anchor.kind !== 'y')) throw new Error('COMMENT_ANCHOR_REQUIRED')
        this.commentComposerContext = { ...range, anchor }
      } catch (error) { this.commentMessage = error.code || error.message; return false }
      this.commentSidebarOpen = true; this.commentHistory = false; this.commentHistorical = false; this.commentComposerOpen = true; this.bubbleVisible = false
      this.updateCommentPanels(); this.refreshCommentDecorations()
      this.$nextTick(() => this.$el.querySelector('[aria-label="新评论"]')?.focus())
      return true
    },
    onCommentShortcut(event) {
      if (this.slides && this.presentationMode !== 'document') return
      if ((event.metaKey || event.ctrlKey) && event.altKey && (event.code === 'KeyM' || String(event.key).toLowerCase() === 'm') && this.commentCan('canComment')) {
        event.preventDefault(); event.stopPropagation()
        // 捕获阶段先于PM的selectionchange同步；原生键盘刚划词时以当前DOM选区为准。
        const view = this.editor && this.editor.view
        const selected = view && view.dom && view.dom.ownerDocument.getSelection()
        if (selected && view.dom.contains(selected.anchorNode) && view.dom.contains(selected.focusNode)) {
          try {
            const anchor = view.posAtDOM(selected.anchorNode, selected.anchorOffset)
            const head = view.posAtDOM(selected.focusNode, selected.focusOffset)
            this.editor.commands.setTextSelection({ from: Math.min(anchor, head), to: Math.max(anchor, head) })
          } catch { this.commentMessage = '请先选中要评论的文字。'; return }
        }
        this.openSelectionComment()
      }
    },
    setCommentCreateDraft(value) { this.commentCreateDraft = value },
    cancelDocumentCommentDraft() { this.commentDocumentDraft = ''; this.commentDocumentMentions = []; this.commentDocumentReferences = []; this.commentDocumentReplyTarget = null; this.clearCommentDraftImages('document') },
    setCommentDocumentDraft(value, mentions = [], references = []) {
      const next = normalizeCommentMetadata(value, mentions, references)
      this.commentDocumentDraft = value; this.commentDocumentMentions = next.mentions
      this.commentDocumentReferences = next.references.map((item, index) => ({ ...item, ...(references[index].readable === false ? { readable: false } : {}) }))
    },
    commentDocumentCanSubmit() { return this.commentAllowed('create') },
    beginDocumentCommentReply(threadId, replyId) {
      if (!this.commentCan('canView') || !this.commentAllowed('create')) return false
      const reply = this.commentThreads.find(thread => thread.id === threadId)?.replies.find(item => item.id === replyId && !item.tombstone)
      if (!reply?.author?.id) return false
      this.commentDocumentReplyTarget = { principalId: reply.author.id, displayName: reply.author.name || reply.author.id,
        visibility: this.commentThreads.find(thread => thread.id === threadId).visibility }
      return true
    },
    consumeDocumentCommentReplyTarget(target) { if (target === this.commentDocumentReplyTarget) this.commentDocumentReplyTarget = null },
    async submitDocumentComment(visibility) {
      const text = this.commentDocumentDraft
      if (!text.trim() && !this.commentDraftImages('document').length || !this.commentDocumentCanSubmit()) return null
      const { mentions, references } = normalizeCommentMetadata(text, this.commentDocumentMentions, this.commentDocumentReferences)
      const participants = visibility === 'private' ? [...new Set(mentions.map(value => value.principalId))].filter(id => id !== this.commentAuthor.id) : []
      const result = await (references.length ? this.createDocumentComment(text, visibility, participants, mentions, references) : mentions.length ? this.createDocumentComment(text, visibility, participants, mentions) : this.createDocumentComment(text, visibility))
      if (result) this.cancelDocumentCommentDraft()
      return result
    },
    setCommentCreatePrivate(value) { this.commentCreatePrivate = value === true },
    setCommentEditContent(value, mentions = [], references = []) {
      const next = normalizeCommentMetadata(value, mentions, references)
      this.commentEditContent = value; this.commentEditMentions = next.mentions
      this.commentEditReferences = next.references.map((item, index) => ({ ...item, ...(references[index].readable === false ? { readable: false } : {}) }))
    },
    cancelCommentEdit() { if (this.commentEditingReply) this.clearCommentDraftImages('edit/' + this.commentEditingReply.threadId + '/' + this.commentEditingReply.replyId); this.commentEditingReply = null; this.commentEditContent = ''; this.commentEditMentions = []; this.commentEditReferences = [] },
    setCommentTranslationLanguage(value) { this.commentTranslationLanguage = value },
    closeCommentTranslation() { this.commentTranslationContext = null; this.commentTranslationState = null },
    // —— 闸门与 Provider ——
    /** 单一判定入口：没配 session 时按 DEFAULT_CAPABILITIES（八项默认 true）放行。 */
    commentCapabilityState(capability = 'canComment') {
      return projectCapabilityUi(this.session, capability)
    },
    commentCan(capability) {
      const session = this.session
      if (!session || typeof session.can !== 'function') return true
      return projectCapabilityUi(session, capability).allowed
    },
    /** 写操作的统一闸门；返回 false 时调用方直接 return（UI 侧同步置灰）。 */
    commentAllowed(action, threadId, replyId) {
      const gate = commentGate(action)
      if (!gate) return false
      if (!this.commentCan(gate)) return false
      const provider = this.commentProvider()
      if (!provider || !provider.isRemote) return action !== 'react'
      if (this.commentBusy || this.commentPendingOperation || this.commentImageBusy || this.commentPendingImage || (action === 'react' && typeof provider.react !== 'function')) return false
      if (!threadId) return action === 'create'
      const thread = (this.commentThreads || []).find(item => item.id === threadId)
      if (!thread || thread.tombstone) return false
      if (this.commentHistorical && thread.anchorStatus === 'orphaned') return false
      const key = { reply: 'canReply', resolve: 'canResolve', reopen: 'canReopen', participants: 'canManageParticipants', visibility: 'canChangeVisibility' }[action]
      if (key) return thread.capabilities && thread.capabilities[key] === true
      const reply = thread.replies.find(item => item.id === replyId)
      return Boolean(reply && reply.capabilities && reply.capabilities[{ edit: 'canEdit', remove: 'canDelete', react: 'canReact' }[action]] === true)
    },
    commentProvider() {
      const session = this.session
      if (!session || typeof session.getProvider !== 'function') return null
      return session.getProvider('comments')
    },
    // 一次异步操作归属于发起时的身份视图；普通列表刷新不改变此归属。
    commentOperationCurrent() {
      const session = this.session, identity = session && session.user && session.user.id
      // Same-principal credential rotation retires authorization, not the owner of an original write/query.
      const generation = this.commentOperationGeneration, identityGeneration = session && session._privateIdentityGeneration
      return () => !this.commentDisposed && session === this.session && generation === this.commentOperationGeneration &&
        identityGeneration === (session && session._privateIdentityGeneration) && identity === (this.session && this.session.user && this.session.user.id)
    },

    // —— 读取与绑定 ——
    async loadComments() {
      const generation = ++this.commentLoadGeneration
      const provider = this.commentProvider()
      if (!provider || !this.commentCan('canView')) {
        this.resetCommentImages(true)
        this.commentSourceThreads = []; this.commentThreads = []; this.commentPanels = []
        this.refreshCommentDecorations()
        return []
      }
      try {
        const threads = this.session && typeof this.session.listComments === 'function'
          ? await this.session.listComments() : await provider.list({ documentId: this.session && this.session.documentId })
        if (this.commentDisposed || generation !== this.commentLoadGeneration || provider !== this.commentProvider() || !this.commentCan('canView')) return []
        this.commentSourceThreads = threads
        this.commentThreads = bindThreads(this.editor ? this.editor.state.doc : null, threads, this.commentAnchorCodec)
        if (this.commentParticipantThread && !this.commentAllowed('participants', this.commentParticipantThread)) this.resetCommentParticipants()
        if (this.commentReactionContext && !this.commentAllowed('react', this.commentReactionContext.threadId, this.commentReactionContext.replyId)) this.closeCommentReaction()
        if (this.commentTranslationState && !this.commentTranslationIsCurrent(this.commentTranslationState)) this.commentTranslationState = null
        this.syncCommentImages()
        this.installCommentDecorations()
        this.refreshCommentDecorations()
        this.updateCommentPanels()
        return this.commentThreads
      } catch (error) {
        if (!this.commentDisposed && generation === this.commentLoadGeneration) {
          this.resetCommentImages(true)
          this.closeCommentReaction()
          this.commentSourceThreads = []; this.commentThreads = []; this.commentPanels = []
          this.commentMessage = error.code || error.message
          this.refreshCommentDecorations()
        }
        throw error
      }
    },
    async runCommentWrite(method, input, sessionMethod) {
      if (this.commentBusy || this.commentPendingOperation) return null
      const provider = this.commentProvider()
      if (!provider || typeof provider[method] !== 'function') return null
      const current = this.commentOperationCurrent()
      this.commentBusy = true; this.commentMessage = ''
      try {
        // resolve/reopen keep their string threadId contract; only object
        // inputs can safely receive the remote idempotency field.
        if (provider.isRemote && input && typeof input === 'object' && input.operationId === undefined) input = { ...input, operationId: createCommentOperationId() }
        const result = this.session && typeof this.session[sessionMethod] === 'function'
          ? await this.session[sessionMethod](input) : await provider[method](input)
        if (!current() || !this.commentCan('canView') || provider !== this.commentProvider()) return null
        await this.loadComments().catch(() => { if (current()) this.commentMessage = '评论已提交，列表暂时无法刷新。' })
        return current() && this.commentCan('canView') && provider === this.commentProvider() ? result : null
      } catch (error) {
        if (!current()) return null
        await this.clearUnavailableCommentView(error)
        if (!current()) return null
        if (error.status === 'unknown' && error.operationId) {
          this.commentPendingOperation = error.operationId; this._commentPendingProvider = provider
          this._commentReconcileAfterAuthorization = ['COMMENT_CONTEXT_CHANGED', 'COMMENT_TRANSLATION_INVALIDATED'].includes(error.code)
        }
        if (current() && this.commentCan('canView')) {
          this.commentMessage = error.status === 'unknown' ? '评论结果尚未确认，请查询原操作。草稿已保留。' : ({ PG_COMMENT_REACTION_LIMIT: '此条评论的表情种类已达上限。', PG_COMMENT_CONFLICT: '评论已更新，请按最新内容重试。', PG_ASSET_NOT_FOUND: '图片已不可用，请重新选择。' }[error.code] || error.code || error.message)
        }
        return null
      } finally { if (current()) { this.commentBusy = false; void this.recoverCommentAfterAuthorization() } }
    },
    recoverCommentAfterAuthorization() {
      if (!this._commentReconcileAfterAuthorization || !this.commentPendingOperation || this.commentBusy || !this.commentCan('canView')) return Promise.resolve(null)
      // 同一身份授权复核造成的unknown只自动GET一次原键；不自动重发写入或轮询。
      this._commentReconcileAfterAuthorization = false
      return this.queryPendingComment()
    },
    async queryPendingComment() {
      if (!this.commentPendingOperation || this.commentBusy || !this.commentCan('canView')) return null
      const provider = this._commentPendingProvider || this.commentProvider()
      if (!provider || typeof provider.queryOperation !== 'function') return null
      const id = this.commentPendingOperation
      const current = this.commentOperationCurrent()
      this.commentBusy = true
      try {
        const result = provider === this.commentProvider() && this.session && typeof this.session.queryCommentOperation === 'function'
          ? await this.session.queryCommentOperation(id) : await provider.queryOperation(id)
        if (!current() || !this.commentCan('canView')) return null
        this.commentPendingOperation = ''; this.commentMessage = '原评论操作已确认。'
        this._commentReconcileAfterAuthorization = false
        this._commentPendingProvider = null
        // 未确认时保留的草稿不自动再次发送；用户可核对已提交内容后自行清理。
        await this.loadComments().catch(() => { if (current()) this.commentMessage = '评论已提交，列表暂时无法刷新。' })
        return current() && this.commentCan('canView') ? result : null
      } catch (error) {
        if (!current()) return null
        await this.clearUnavailableCommentView(error)
        if (current()) this.commentMessage = '原评论操作仍未确认，请稍后查询。'
        return null
      } finally { if (current()) this.commentBusy = false }
    },
    async createCommentFromSelection(content, visibility = 'document') {
      if (!this.commentAllowed('create') || !this.editor) return null
      const text = typeof content === 'string' ? content.trim() : ''
      const captured = this.commentComposerContext
      const range = captured || this.commentSelectionRange()
      if ((!text && !this.commentDraftImages('selection').length) || !range) return null
      this.commentCreateDraft = text
      const provider = this.commentProvider()
      if (!provider) return null
      // 评论专属权限不依赖正文可写；远端始终使用真实相对位置。
      if (!provider.isRemote && !this.writable()) return null
      let anchor
      try {
        anchor = captured ? captured.anchor : encodeAnchor({ blockId: range.blockId, offset: range.offset, length: range.length }, this.commentAnchorCodec)
        if (provider.isRemote && (!anchor || anchor.kind !== 'y')) throw new Error('COMMENT_ANCHOR_REQUIRED')
        if (captured && provider.isRemote) {
          const decoded = decodeAnchor(anchor, this.commentAnchorCodec)
          if (!decoded || !decoded.length || this.commentBlockPos(decoded.blockId) < 0) throw new Error('COMMENT_ANCHOR_CONFLICT')
        }
      } catch (error) { this.commentMessage = error.code || error.message; return null }
      const thread = await this.runCommentWrite('createThread', {
        scope: 'selection', visibility, ...(this.commentDraftImages('selection').length ? { assetIds: this.commentDraftImages('selection').map(image => image.assetId) } : {}), blockId: range.blockId, author: this.commentAuthor, content: text, anchor, quote: range.text,
      }, 'createCommentThread')
      if (thread) {
        this.commentCreateDraft = ''; this.clearCommentDraftImages('selection')
        this.commentComposerOpen = false; this.commentComposerContext = null; this.commentSidebarOpen = true
        if (!provider.isRemote) this.applyCommentMark(thread.id, range.from, range.to)
        this.activateComment(thread.id)
      }
      return thread
    },
    async createDocumentComment(content, visibility = 'document', participants = [], mentions, references) {
      if (!this.commentAllowed('create')) return null
      const result = await this.runCommentWrite('createThread', { scope: 'document', visibility, participants, content, ...(mentions === undefined ? {} : { mentions }), ...(references === undefined ? {} : { references }), ...(this.commentDraftImages('document').length ? { assetIds: this.commentDraftImages('document').map(image => image.assetId) } : {}), author: this.commentAuthor,
        blockId: null, anchor: null }, 'createCommentThread')
      if (result) this.activateComment(result.id)
      return result
    },
    async submitCommentDraft(threadId) {
      if (!this.commentAllowed('reply', threadId)) return null
      const text = commentDraftText(this.commentDrafts, threadId).trim()
      if (!text && !this.commentDraftImages(threadId).length) return null
      const result = await this.runCommentWrite('reply', { threadId, author: this.commentAuthor, content: text, ...(this.commentDraftImages(threadId).length ? { assetIds: this.commentDraftImages(threadId).map(image => image.assetId) } : {}) }, 'replyToComment')
      if (result) this.clearCommentDraft(threadId)
      return result
    },
    async resolveComment(threadId) {
      if (!this.commentAllowed('resolve', threadId)) return null
      return this.runCommentWrite('resolve', threadId, 'resolveComment')
    },
    async reopenComment(threadId) {
      if (!this.commentAllowed('reopen', threadId)) return null
      return this.runCommentWrite('reopen', threadId, 'reopenComment')
    },
    async deleteCommentReply(threadId, commentId) {
      if (!this.commentAllowed('remove', threadId, commentId)) return null
      const provider = this.commentProvider()
      if (provider && typeof provider.deleteReply === 'function') return this.runCommentWrite('deleteReply', { threadId, commentId }, 'deleteCommentReply')
      if (provider && provider.isRemote) return null
      this.commentThreads = this.commentThreads.map(thread => thread.id !== threadId ? thread : { ...thread, replies: thread.replies.filter(reply => reply.id !== commentId) })
      this.updateCommentPanels()
      return true
    },
    beginEditComment(threadId, replyId) {
      if (!this.commentAllowed('edit', threadId, replyId)) return
      const thread = (this.commentThreads || []).find(item => item.id === threadId)
      const reply = thread && thread.replies.find(item => item.id === replyId)
      if (!reply) return
      this.cancelCommentEdit()
      this.$set(this.commentImageDrafts, 'edit/' + threadId + '/' + replyId, (reply.attachments || []).map(asset => ({ ...asset, previewUrl: this.commentImageUrl(thread, reply, asset) })))
      let metadata = { mentions: [], references: [] }
      try { metadata = normalizeCommentMetadata(reply.content, reply.mentions || [], reply.references || [], true) } catch { /* Invalid legacy ranges remain plain text. */ }
      this.commentEditGeneration = (this.commentEditGeneration || 0) + 1
      this.commentEditingReply = { threadId, replyId, generation: this.commentEditGeneration, originalReplyRevision: reply.replyRevision, originalAssets: (reply.attachments || []).map(asset => asset.assetId), ...(reply.references?.length ? { originalReferences: true } : {}) }
      this.setCommentEditContent(reply.content, metadata.mentions, metadata.references)
    },
    async saveEditedComment() {
      const value = this.commentEditingReply
      if (!value || !this.commentAllowed('edit', value.threadId, value.replyId)) return null
      const assetIds = this.commentDraftImages('edit/' + value.threadId + '/' + value.replyId).map(asset => asset.assetId)
      if (!this.commentEditContent.trim() && !assetIds.length) return null
      const { mentions, references } = normalizeCommentMetadata(this.commentEditContent, this.commentEditMentions, this.commentEditReferences)
      const changed = (!this.commentEditContent.trim() && assetIds.length <= 9) || JSON.stringify(assetIds) !== JSON.stringify(value.originalAssets || [])
      const result = await this.runCommentWrite('editReply', { threadId: value.threadId, replyId: value.replyId, content: this.commentEditContent, mentions, ...(references.length || value.originalReferences ? { references } : {}), ...(changed ? { assetIds } : {}) }, 'editCommentReply')
      if (result) this.cancelCommentEdit()
      return result
    },
    async setCommentParticipants(threadId, participants, expectedRevision) {
      if (!this.commentAllowed('participants', threadId)) return null
      return this.runCommentWrite('setParticipants', { threadId, participants, ...(expectedRevision === undefined ? {} : { expectedRevision }) }, 'setCommentParticipants')
    },
    resetCommentParticipants() {
      clearTimeout(this._commentParticipantTimer); this._commentParticipantRead = null
      this.commentParticipantThread = ''; this.commentParticipantRevision = ''; this.commentParticipantQuery = ''
      this.commentParticipantSelection = []; this.commentParticipantCandidates = []; this.commentParticipantIndex = -1
      this.commentParticipantBusy = false; this.commentParticipantError = ''
    },


    // —— 选区 → 锚点 ——
    /**
     * 当前选区落在哪个块、块内偏移多少。空选区 / 找不到带 blockId 的祖先都返回 null
     * （05 §5.5 要求 `blockId` 是身份主键，没有块 id 的选区不该建评论）。
     */
    commentSelectionRange() {
      if (!this.editor) return null
      const state = this.editor.state
      const selection = state.selection
      if (!selection || selection.empty) return null
      const from = selection.from
      const to = selection.to
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
      const provider = this.commentProvider()
      if ((provider && provider.isRemote) || !this.editor || typeof this.editor.commands.setComment !== 'function') return false
      const size = this.editor.state.doc.content.size
      const start = Math.max(0, Math.min(from, size))
      const end = Math.max(start, Math.min(to, size))
      this.editor.chain().focus().setTextSelection({ from: start, to: end }).setComment({ threadId }).setTextSelection(end).run()
      return true
    },

    // —— 草稿 ——
    setCommentDraft(threadId, text) {
      if (!threadId || !this.commentAllowed('reply', threadId)) return
      this.$set(this.commentDrafts, threadId, typeof text === 'string' ? text : '')
    },
    clearCommentDraft(threadId) {
      if (!threadId) return
      this.clearCommentDraftImages(threadId)
      this.$set(this.commentDrafts, threadId, '')
    },
    commentHasDraft(threadId) {
      return commentDraftText(this.commentDrafts, threadId).trim().length > 0 || this.commentDraftImages(threadId).length > 0
    },

    // —— 点亮、已读、跳转 ——
    activateComment(threadId) {
      const next = threadId || ''
      const thread = this.commentThreads.find(item => item.id === next)
      if (this.commentRemote && thread && thread.scope !== 'document') { this.commentSidebarOpen = true; this.commentHistorical = thread.anchorStatus === 'orphaned'; this.commentHistory = !this.commentHistorical && thread.resolved === true }
      if (next === this.commentActiveThreadId) { this.updateCommentPanels(); return }
      this.commentActiveThreadId = next
      if (next) this.markCommentRead(next)
      if (this.commentRemote) this.updateCommentPanels()
      this.refreshCommentDecorations()
      this.$nextTick(() => this.placeCommentPanels())
    },
    markCommentRead(threadId) {
      if (!threadId || this.commentReadIds.indexOf(threadId) !== -1) return
      this.commentReadIds = this.commentReadIds.concat([threadId])
    },
    /** 面板头「下一条 / 上一条」：只在面板顺序里前后跳，跳出去不动（同修订面板口径）。 */
    goComment(threadId, direction) {
      const list = this.commentRemote ? this.commentThreads.filter(thread => !thread.tombstone) : this.commentPanels
      const index = list.findIndex((item) => item.id === threadId)
      if (index === -1) return
      const next = list[index + (direction < 0 ? -1 : 1)]
      if (!next) return
      this.activateComment(next.id)
      if (next.bound) this.scrollCommentIntoView(next.blockId)
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
      const provider = this.commentProvider()
      if (provider && provider.isRemote) {
        if (!this.commentAllowed('visibility', threadId)) return null
        return this.runCommentWrite('setVisibility', { threadId, visibility: this.commentPrivate(threadId) ? 'document' : 'private' }, 'setCommentVisibility')
      }
      const on = this.commentPrivateIds.indexOf(threadId) !== -1
      this.commentPrivateIds = on
        ? this.commentPrivateIds.filter((id) => id !== threadId)
        : this.commentPrivateIds.concat([threadId])
    },
    commentPrivate(threadId) {
      const provider = this.commentProvider()
      if (provider && provider.isRemote) {
        const thread = (this.commentThreads || []).find(item => item.id === threadId)
        return Boolean(thread && thread.visibility === 'private')
      }
      return this.commentPrivateIds.indexOf(threadId) !== -1
    },
    toggleCommentMoreMenu(threadId, event) {
      this.resetCommentParticipants()
      this.commentMoreThreadId = this.commentMoreThreadId === threadId ? '' : threadId
      this._commentMoreMenuAnchor = this.commentMoreThreadId && event && event.currentTarget || null
      this.commentMoreMenuPosition = this.commentMoreThreadId ? this.commentMenuPosition(event, COMMENT_MORE_MENU.width, COMMENT_MORE_MENU.height) : null
      if (this.commentRemote && this.commentMoreThreadId) this.loadCommentFollowPreference(threadId)
    },
    toggleCommentReplyMenu(threadId, commentId, event) {
      const same = this.commentMenuThreadId === threadId && this.commentMenuCommentId === commentId
      this.commentMenuThreadId = same ? '' : threadId
      this.commentMenuCommentId = same ? '' : commentId
      this._commentReplyMenuAnchor = !same && event && event.currentTarget || null
      this.commentReplyMenuPosition = same ? null : this.commentMenuPosition(event, COMMENT_REPLY_MENU.width, COMMENT_REPLY_MENU.height)
    },
    commentMenuPosition(event, width, height) {
      const anchor = event && event.currentTarget
      if (!this.commentRemote || !anchor || typeof anchor.getBoundingClientRect !== 'function') return null
      this.updateCommentLayerBounds()
      const rect = anchor.getBoundingClientRect()
      const floor = Math.min(this.commentLayerTop, Math.max(COMMENT_VIEWPORT_MARGIN, window.innerHeight - 32))
      return {
        left: Math.max(COMMENT_VIEWPORT_MARGIN, Math.min(rect.right - width, window.innerWidth - width - COMMENT_VIEWPORT_MARGIN)),
        top: Math.max(floor, Math.min(rect.bottom + 4, window.innerHeight - height - COMMENT_VIEWPORT_MARGIN)),
      }
    },
    commentFloatingMenuStyle(position) {
      return this.commentRemote && position ? { position: 'fixed', left: `${position.left}px`, top: `${position.top}px`, right: 'auto', maxHeight: `calc(100vh - ${position.top + COMMENT_VIEWPORT_MARGIN}px)`, overflowY: 'auto' } : null
    },
    closeCommentMenus() {
      this.resetCommentParticipants()
      this.closeCommentReaction()
      this.commentMoreThreadId = ''
      this.commentMenuThreadId = ''
      this.commentMenuCommentId = ''
      this.commentReplyMenuPosition = null
      this.commentMoreMenuPosition = null
      this._commentMoreMenuAnchor = null; this._commentReplyMenuAnchor = null
    },
    commentDraftImages(scope) { return this.commentImageDrafts?.[scope] || [] },
    invalidateCommentImageUpload(scope) {
      if (!this.commentImageDraftGenerations) this.commentImageDraftGenerations = {}
      this.$set(this.commentImageDraftGenerations, scope, (this.commentImageDraftGenerations[scope] || 0) + 1)
      if (this.commentPendingImage?.scope === scope) this.commentPendingImage = { operationId: this.commentPendingImage.operationId, kind: this.commentPendingImage.kind, scope: null }
      if (this._commentImageInFlight?.scope === scope) {
        this.commentPendingImage = { operationId: this._commentImageInFlight.operationId, beginOperationId: this._commentImageInFlight.beginOperationId, kind: 'complete', scope: null }
        this._commentImageUploadController?.abort()
      }
      if (this._commentImageUploadScope === scope && !this._commentImageInFlight) { this._commentImageUploadController?.abort(); this._commentImageUploadController = null; this._commentImageUploadScope = ''; this.commentImageBusy = false }
    },
    commentImageCanCancel() { return Boolean(this._commentImageUploadController && this._commentImageUploadScope) },
    cancelCommentImageUpload() {
      const scope = this._commentImageUploadScope
      if (scope) this.invalidateCommentImageUpload(scope)
    },
    clearCommentDraftImages(scope) {
      this.invalidateCommentImageUpload(scope)
      this.commentDraftImages(scope).forEach(image => { if (image.previewUrl && image.previewOwned) URL.revokeObjectURL(image.previewUrl) })
      this.$set(this.commentImageDrafts, scope, [])
    },
    removeCommentDraftImage(scope, assetId) {
      const list = this.commentDraftImages(scope)
      list.filter(image => image.assetId === assetId).forEach(image => { if (image.previewUrl && image.previewOwned) URL.revokeObjectURL(image.previewUrl) })
      this.$set(this.commentImageDrafts, scope, list.filter(image => image.assetId !== assetId))
    },
    commentCanUploadImage(scope) {
      if (!this.commentRemote || !this.commentCan('canComment') || this.commentImageBusy || this.commentPendingImage || this.commentBusy || this.commentPendingOperation ||
        typeof this.session?.getProvider?.('assets')?.uploadCommentImage !== 'function' || this.commentDraftImages(scope).length >= 9) return false
      if (scope.startsWith('edit/')) { const [, threadId, replyId] = scope.split('/'); return this.commentAllowed('edit', threadId, replyId) }
      return ['document', 'selection'].includes(scope) ? this.commentAllowed('create') : this.commentAllowed('reply', scope)
    },
    
    commentImageScopeCurrent(scope, draftGeneration, context) {
      if ((this.commentImageDraftGenerations[scope] || 0) !== draftGeneration || !this.commentCan('canComment')) return false
      if (scope === 'selection') return this.commentComposerOpen && this.commentComposerContext === context
      if (scope === 'document') return true
      if (scope.startsWith('edit/')) {
        if (!context || this.commentEditingReply !== context) return false
        const reply = this.commentThreads.find(thread => thread.id === context.threadId)?.replies.find(reply => reply.id === context.replyId)
        return reply?.replyRevision === context.originalReplyRevision && reply?.capabilities.canEdit === true
      }
      return this.commentThreads.some(thread => thread.id === scope && !thread.tombstone && thread.capabilities.canReply)
    },
    resetCommentImages(preservePending = false) {
      const original = this.commentPendingImage || (this._commentImageInFlight ? { operationId: this._commentImageInFlight.operationId, kind: 'complete', beginOperationId: this._commentImageInFlight.beginOperationId } : null)
      this._commentImageInFlight = null
      this._commentImageUploadScope = ''
      this.commentImageGeneration++
      this._commentImageUploadController?.abort(); this._commentImageUploadController = null
      this._commentImageEntries?.forEach(entry => { entry.controller.abort(); if (entry.url) URL.revokeObjectURL(entry.url) })
      this._commentImageEntries = new Map()
      Object.keys(this.commentImageDrafts).forEach(scope => this.clearCommentDraftImages(scope))
      this.commentImageDrafts = {}; this.commentImageDraftGenerations = {}; this.commentImageUrls = {}; this.commentImageErrors = {}; this.commentImageViewer = null; this._commentImageViewerAnchor = null; this.commentImageBusy = false
      this.commentPendingImage = preservePending && original ? { operationId: original.operationId, kind: original.kind, ...(original.beginOperationId ? { beginOperationId: original.beginOperationId } : {}), scope: null } : null
    },
    commentImageKey(thread, reply, asset) { return [thread.id, reply.id, reply.replyRevision, asset.assetId, asset.checksum].join('/') },
    commentImageUrl(thread, reply, asset) { return this.commentImageUrls[this.commentImageKey(thread, reply, asset)] || '' },
    closeCommentImage(restoreFocus = false) { this.commentImageViewer = null; if (restoreFocus && this._commentImageViewerAnchor?.isConnected) this._commentImageViewerAnchor.focus(); this._commentImageViewerAnchor = null },
    focusCommentImageClose() { this.$el.querySelector('[aria-label="关闭图片预览"]')?.focus() },
    retryCommentImage(thread, reply, asset) {
      const key = this.commentImageKey(thread, reply, asset), entry = this._commentImageEntries?.get(key)
      if (!entry || !this.commentImageErrors[key] || !this.commentCan('canView')) return
      entry.controller.abort(); this._commentImageEntries.delete(key); this.$set(this.commentImageErrors, key, ''); this.syncCommentImages()
    },
    openCommentImage(thread, reply, asset, event) {
      if (!this.commentImageUrl(thread, reply, asset)) return this.retryCommentImage(thread, reply, asset)
      const key = this.commentImageKey(thread, reply, asset)
      if (this.commentImageUrls[key]) { this.closeCommentMenus(); this._commentImageViewerAnchor = event?.currentTarget; this.commentImageViewer = { key, url: this.commentImageUrls[key], fileName: asset.fileName }; this.$nextTick(() => this.focusCommentImageClose()) }
    },
    syncCommentImages() {
      if (!this._commentImageEntries) this._commentImageEntries = new Map()
      const wanted = new Map()
      this.commentThreads.forEach(thread => thread.replies.forEach(reply => (reply.attachments || []).forEach(asset => wanted.set(this.commentImageKey(thread, reply, asset), { thread, reply, asset }))))
      this._commentImageEntries.forEach((entry, key) => {
        if (!wanted.has(key)) { entry.controller.abort(); if (entry.url) URL.revokeObjectURL(entry.url); this._commentImageEntries.delete(key); this.$set(this.commentImageUrls, key, ''); this.$set(this.commentImageErrors, key, '') }
      })
      if (this.commentImageViewer && !wanted.has(this.commentImageViewer.key)) this.commentImageViewer = null
      wanted.forEach(({ thread, reply, asset }, key) => {
        if (this._commentImageEntries.has(key)) return
        const entry = { controller: new AbortController(), url: '' }, generation = this.commentImageGeneration, session = this.session
        this._commentImageEntries.set(key, entry)
        const current = () => generation === this.commentImageGeneration && this._commentImageEntries.get(key) === entry && session === this.session && this.commentCan('canView')
        void loadCommentImages().then(operations => {
          if (current()) return operations.loadCommentImage.call(this, { asset, session, entry, thread, reply, current, key })
          return undefined
        }).catch(() => { if (current()) this.$set(this.commentImageErrors, key, '图片加载失败，请重试。') })
      })
    },
    closeCommentReaction(restoreFocus = false) {
      const anchor = this._commentReactionAnchor
      this.commentReactionContext = null; this._commentReactionAnchor = null
      this.commentReactionQuery = ''; this.commentReactionCategory = '常用'; this.commentReactionLimit = 120
      if (restoreFocus && anchor && anchor.isConnected) anchor.focus()
    },
    onCommentReactionOutside(event) {
      const insideMenu = event.target?.closest?.('.lark-doc-comment-more-menu, .lark-doc-comment-reply-menu')
      const trigger = this._commentMoreMenuAnchor?.contains?.(event.target) || this._commentReplyMenuAnchor?.contains?.(event.target)
      if ((this.commentMoreThreadId || this.commentMenuThreadId) && !insideMenu && !trigger) this.closeCommentMenus()
      if (!this.commentReactionContext) return
      const target = event.target
      if (target && typeof target.closest === 'function' && target.closest('.lark-doc-comment-reaction-picker')) return
      this.closeCommentReaction()
    },
    onCommentReactionKeydown(event) {
      if (this.commentImageViewer && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.closeCommentImage(true); return }
      if (event.key === 'Escape' && (this.commentMoreThreadId || this.commentMenuThreadId)) {
        const anchor = this._commentMoreMenuAnchor || this._commentReplyMenuAnchor
        event.preventDefault(); event.stopPropagation(); this.closeCommentMenus(); if (anchor?.isConnected) anchor.focus(); return
      }
      if (!this.commentReactionContext || event.key !== 'Escape') return
      event.preventDefault(); event.stopPropagation(); this.closeCommentReaction(true)
    },
    showMoreCommentReactions() { this.commentReactionLimit += 120 },
    setCommentReactionQuery(value) { this.commentReactionQuery = value; this.commentReactionLimit = 120 },
    setCommentReactionCategory(value) { this.commentReactionCategory = value; this.commentReactionLimit = 120 },
    openCommentReaction(threadId, replyId, event) {
      if (!this.commentAllowed('react', threadId, replyId)) return
      this.closeCommentMenus()
      this._commentReactionAnchor = event && event.currentTarget
      this.commentReactionContext = { threadId, replyId, position: this.commentMenuPosition(event, 328, 340) }
      this.$nextTick(() => this.$el.querySelector('.lark-doc-comment-reaction-picker input')?.focus())
    },
    
    
    
    
    
    
    
    
    
    async loadCommentFollowPreference(threadId) {
      const provider = this.commentProvider()
      if (!provider || !provider.isRemote || !this.commentCan('canView')) return null
      this.$set(this.commentFollowPreferences, threadId, null)
      const generation = this.commentLoadGeneration
      const readGeneration = ++this.commentFollowReadGeneration
      const current = () => !this.commentDisposed && generation === this.commentLoadGeneration && readGeneration === this.commentFollowReadGeneration && provider === this.commentProvider() && this.commentCan('canView')
      try {
        const preference = this.session && typeof this.session.getCommentFollowPreference === 'function'
          ? await this.session.getCommentFollowPreference(threadId) : await provider.getFollowPreference(threadId)
        if (!current()) return null
        this.$set(this.commentFollowPreferences, threadId, preference)
        return preference
      } catch (error) {
        if (!current()) return null
        await this.clearUnavailableCommentView(error)
        if (current()) this.commentMessage = '评论不可见或当前无权访问。'
        return null
      }
    },
    commentFollowPreference(threadId) { return this.commentFollowPreferences[threadId] || null },
    commentFollowAllowed(threadId) {
      return this.commentCan('canView') && Boolean(this.commentFollowPreference(threadId)) && !this.commentFollowBusy && !this.commentPendingFollowOperation
    },
    async changeCommentFollow(threadId, kind) {
      if (!this.commentFollowAllowed(threadId)) return null
      const provider = this.commentProvider()
      const prior = this.commentFollowPreference(threadId)
      const method = kind === 'mute' ? 'setMuted' : prior.following ? 'unfollow' : 'follow'
      const sessionMethod = kind === 'mute' ? 'muteComment' : prior.following ? 'unfollowComment' : 'followComment'
      const input = { threadId, expectedRevision: prior.preferenceRevision, ...(kind === 'mute' ? { value: !prior.muted } : {}) }
      const generation = this.commentLoadGeneration
      const current = this.commentOperationCurrent()
      this.commentFollowBusy = true
      try {
        if (provider.isRemote) input.operationId = createCommentOperationId()
        const result = this.session && typeof this.session[sessionMethod] === 'function'
          ? await this.session[sessionMethod](input) : await provider[method](input)
        if (!current() || !this.commentCan('canView') || provider !== this.commentProvider()) return null
        this.commentFollowReadGeneration++
        if (generation === this.commentLoadGeneration) this.$set(this.commentFollowPreferences, threadId, result)
        else await this.loadCommentFollowPreference(threadId)
        return current() && this.commentCan('canView') && provider === this.commentProvider() ? result : null
      } catch (error) {
        if (!current()) return null
        await this.clearUnavailableCommentView(error)
        if (current()) {
          if (error.status === 'unknown' && error.operationId) { this.commentPendingFollowOperation = error.operationId; this._commentPendingFollowProvider = provider }
          this.commentMessage = error.status === 'unknown' ? '关注偏好尚未确认，请查询原操作。' : '评论不可见、无权访问或偏好未保存。'
        }
        return null
      } finally { if (current()) this.commentFollowBusy = false }
    },
    async queryPendingCommentFollow() {
      if (!this.commentPendingFollowOperation || this.commentFollowBusy || !this.commentCan('canView')) return null
      const provider = this._commentPendingFollowProvider || this.commentProvider()
      const current = this.commentOperationCurrent()
      this.commentFollowBusy = true
      try {
        const result = await provider.queryFollowOperation(this.commentPendingFollowOperation)
        if (!current() || !this.commentCan('canView')) return null
        this.commentFollowReadGeneration++
        this.commentPendingFollowOperation = ''; this._commentPendingFollowProvider = null
        if (provider === this.commentProvider() && this.commentCan('canView')) this.$set(this.commentFollowPreferences, result.threadId, result)
        this.commentMessage = '原关注偏好已确认。'
        return result
      } catch (error) {
        if (!current()) return null
        await this.clearUnavailableCommentView(error)
        if (current()) this.commentMessage = '原关注偏好仍未确认；评论不可见时无法查询。'
        return null
      } finally { if (current()) this.commentFollowBusy = false }
    },
    async openCommentLink(value) {
      const provider = this.commentProvider()
      if (!provider || !provider.isRemote || !this.commentCan('canView')) return null
      const link = value || (typeof window !== 'undefined' && window.location.hash.startsWith('#larkComment=') ? window.location.href : '')
      if (!link) return null
      try {
        const result = this.session && typeof this.session.openCommentLink === 'function'
          ? await this.session.openCommentLink(link) : await provider.openLink(link)
        if (this.commentDisposed || provider !== this.commentProvider() || !this.commentCan('canView')) return null
        await this.loadComments()
        const item = this.commentThreads.find(thread => thread.id === result.target.threadId)
        if (!item) throw new Error('COMMENT_NOT_VISIBLE')
        this.activateComment(item.id)
        if (result.target.anchorStatus === 'orphaned' || item.anchorStatus === 'orphaned') this.commentMessage = '原引用已删除或无法定位；仍可查看获准的评论。'
        else if (item.bound) this.scrollCommentIntoView(item.blockId)
        return result
      } catch (error) {
        await this.clearUnavailableCommentView(error)
        if (!this.commentDisposed) this.commentMessage = '评论不可见或当前无权访问。'
        return null
      }
    },
    commentTranslationIsCurrent(value) {
      if (this.commentDisposed || !value || !this.commentCan('canView')) return false
      const owner = value === this.commentTranslationState && this._commentTranslationOwner
      if (owner && (owner.session !== this.session || owner.generation !== (this.session && this.session._commentGeneration) || owner.componentGeneration !== this.commentIdentityGeneration ||
        owner.identity !== (this.session && this.session.user && this.session.user.id) || owner.provider !== this.commentProvider())) return false
      const thread = this.commentThreads.find(item => item.id === value.threadId && !item.tombstone)
      return Boolean(thread && thread.replies.some(reply => reply.id === value.replyId && !reply.tombstone && reply.replyRevision === value.sourceRevision))
    },
    async clearUnavailableCommentView(error) {
      if (this.commentDisposed || !error || !(error.code === 'COMMENT_NOT_VISIBLE' || error.code === 'TRANSLATION_SOURCE_STALE' || [401, 403, 404].includes(error.httpStatus || error.status))) return
      this.commentLoadGeneration++
      this.commentSourceThreads = []; this.commentThreads = []; this.commentPanels = []; this.commentFollowPreferences = {}
      this.commentTranslationState = null; this.commentTranslationContext = null
      this.commentEditingReply = null; this.commentEditContent = ''; this.commentEditMentions = []; this.commentEditReferences = []
      this.refreshCommentDecorations()
      await this.loadComments().catch(() => {})
    },
    beginCommentTranslation(threadId, replyId) {
      if (!this.commentCan('canView') || this.commentTranslationBusy) return
      if (this.commentPendingTranslationOperation) { this.commentMessage = '请先查询原翻译请求，避免替换未确认的来源。'; return }
      const thread = this.commentThreads.find(item => item.id === threadId && !item.tombstone)
      const reply = thread && thread.replies.find(item => item.id === replyId && !item.tombstone)
      if (!reply || typeof reply.replyRevision !== 'string') return
      this.commentTranslationContext = { threadId, replyId, sourceRevision: reply.replyRevision }
      this.commentTranslationLanguage = 'zh-CN'
      this.commentTranslationState = null
    },
    

    // —— 几何 ——
    /** 由宿主的 `onTransaction` 调；只做「过滤 + 清理失效 id」，几何交给下一帧。 */
    updateCommentPanels() {
      if (!this.editor) {
        this.commentPanels = []
        this.commentActiveThreadId = ''
        return
      }
      const provider = this.commentProvider()
      if (provider && provider.isRemote && Array.isArray(this.commentSourceThreads)) {
        this.commentThreads = bindThreads(this.editor.state.doc, this.commentSourceThreads, this.commentAnchorCodec)
      }
      const remote = provider && provider.isRemote
      const items = commentSidebarThreads(this.commentThreads, remote, this.commentHistorical, this.commentHistory)
      if (this.commentActiveThreadId && !(remote ? this.commentThreads.filter(thread => !thread.tombstone) : items).some((thread) => thread.id === this.commentActiveThreadId)) {
        this.commentActiveThreadId = ''
      }
      this.commentPanels = items.map((thread) => ({ ...thread, left: 0, top: 0 }))
      this.$nextTick(() => this.placeCommentPanels())
    },
    placeCommentPanels() {
      this.updateCommentLayerBounds()
      const view = this.editor && this.editor.view
      if (!view) return
      if (this.commentRemote) {
        const layer = this.$el.querySelector('.lark-doc-comment-layer.is-remote')
        let floor = this.commentLayerTop + 52
        const at = anchor => {
          const pos = anchor && this.commentBlockPos(anchor.blockId)
          if (pos == null || pos < 0) return floor
          try { return view.coordsAtPos(pos + 1 + (anchor.offset || 0)).top } catch (error) { return floor }
        }
        if (this.commentComposerOpen && this.commentComposerContext) {
          const anchor = decodeAnchor(this.commentComposerContext.anchor, this.commentAnchorCodec)
          this.commentComposerGap = Math.max(0, at(anchor) - floor)
          floor += this.commentComposerGap + (layer?.querySelector('.lark-doc-comment-composer')?.getBoundingClientRect().height || COMMENT_HEIGHTS.empty) + COMMENT_PANEL_GAP
        }
        const nodes = layer ? [...layer.querySelectorAll('[data-comment-thread]')] : []
        this.commentPanels = [...this.commentPanels].sort((a, b) => at(a.anchor) - at(b.anchor)).map(item => {
          const top = Math.max(floor, item.bound ? at(item.anchor) : floor)
          const gap = Math.max(0, top - floor)
          const height = nodes.find(node => node.dataset.commentThread === item.id)?.getBoundingClientRect().height || this.commentPanelHeightOf(item)
          floor = top + height + COMMENT_PANEL_GAP
          return { ...item, top, gap }
        })
        return
      }
      if (!this.commentPanels.length) return
      const bound = view.dom.getBoundingClientRect()
      const maxLeft = window.innerWidth - COMMENT_PANEL.width - COMMENT_VIEWPORT_MARGIN
      const left = Math.max(COMMENT_VIEWPORT_MARGIN, Math.min(maxLeft, bound.right + COMMENT_ANCHOR_GUTTER))
      const bottomLimit = window.innerHeight - COMMENT_VIEWPORT_MARGIN
      let floor = COMMENT_VIEWPORT_MARGIN
      this.commentPanels = this.commentPanels.map((item) => {
        const pos = item.bound ? this.commentBlockPos(item.blockId) : -1
        let anchorTop = bound.top
        if (pos >= 0) {
          try {
            anchorTop = view.coordsAtPos(pos + 1).top
          } catch (error) {
            anchorTop = bound.top
          }
        }
        const height = commentPanelHeight(item.replies.length, this.commentHasDraft(item.id))
        let top = Math.max(floor, anchorTop)
        // 放不下就上收，但**不收过前一块**，否则两个面板会叠在一起。
        if (top + height > bottomLimit) top = Math.max(floor, bottomLimit - height)
        floor = top + height + COMMENT_PANEL_GAP
        return { ...item, left, top }
      })
    },
    onCommentTransaction() {
      if (!this.commentDisposed && this.commentProvider() && this.commentProvider().isRemote) this.updateCommentPanels()
    },
    installCommentDecorations() {
      const provider = this.commentProvider()
      if (!provider || !provider.isRemote || !this.editor || this._commentDecorationKey) return
      const vm = this
      const key = new PluginKey('lark-doc-private-comment-view')
      this._commentDecorationKey = key
      this.editor.registerPlugin(new Plugin({ key, props: { decorations(state) {
        if (vm.commentDisposed || !vm.commentCan('canView')) return DecorationSet.empty
        const decorations = []
        const highlight = (anchor, attributes) => state.doc.descendants((node, pos) => {
          if (!node.attrs || node.attrs.blockId !== anchor.blockId) return
          const from = pos + 1 + anchor.offset, to = from + anchor.length
          // 相对端点解码后的length可能跨段；由DecorationSet拆到各文本块，不截断在首块。
          if (anchor.offset <= node.content.size && to <= state.doc.content.size && to > from) decorations.push(Decoration.inline(from, to, attributes))
          return false
        })
        const context = vm.commentComposerOpen && vm.commentComposerContext
        const draft = context && decodeAnchor(context.anchor, vm.commentAnchorCodec)
        if (draft && draft.length) highlight(draft, { class: 'lark-doc-comment is-active is-draft' })
        bindThreads(state.doc, vm.commentSourceThreads, vm.commentAnchorCodec).forEach(thread => {
          if (!thread.bound || thread.tombstone || thread.resolved || !thread.anchor.length) return
          highlight(thread.anchor, { class: `lark-doc-comment${thread.id === vm.commentActiveThreadId ? ' is-active' : ''}`, 'data-thread-id': thread.id })
        })
        return DecorationSet.create(state.doc, decorations)
      } } }))
    },
    refreshCommentDecorations() {
      if (this.editor && this._commentDecorationKey && !this.commentDisposed) this.editor.view.dispatch(this.editor.state.tr.setMeta(this._commentDecorationKey, true).setMeta('addToHistory', false))
    },
    updateCommentLayerBounds() {
      const dom = this.editor && this.editor.view && this.editor.view.dom
      if (!this.commentRemote || !dom || typeof dom.closest !== 'function') return
      const root = dom.closest('.lark-doc')
      if (!root) return
      const bars = Array.from(root.querySelectorAll('.lark-doc-topbar, .lark-doc-toolbar')).filter(node => node.getClientRects().length)
      this.commentLayerTop = Math.max(COMMENT_VIEWPORT_MARGIN, ...bars.map(node => node.getBoundingClientRect().bottom + COMMENT_PANEL_GAP))
      this.commentLayerHeight = Math.max(0, Math.min(window.innerHeight, root.getBoundingClientRect().bottom) - this.commentLayerTop - 16)
    },
    onCommentViewportChange(event) {
      const target = event && event.target
      const menuScroll = target && typeof target.closest === 'function' && target.closest('.lark-doc-comment-more-menu, .lark-doc-comment-reply-menu, .lark-doc-comment-reaction-picker')
      this.updateCommentLayerBounds()
      if (event && !menuScroll && this.commentReactionContext) this.closeCommentReaction()
      if (event && !menuScroll && this.commentRemote) {
        for (const [id, anchorKey, position, geometry] of [
          ['commentMoreThreadId', '_commentMoreMenuAnchor', 'commentMoreMenuPosition', COMMENT_MORE_MENU],
          ['commentMenuThreadId', '_commentReplyMenuAnchor', 'commentReplyMenuPosition', COMMENT_REPLY_MENU],
        ]) {
          if (!this[id]) continue
          const anchor = this[anchorKey], rect = anchor && anchor.isConnected && anchor.getBoundingClientRect()
          if (!rect || rect.bottom < this.commentLayerTop || rect.top > window.innerHeight) {
            this[id] = ''; this[position] = null; this[anchorKey] = null
            if (id === 'commentMenuThreadId') this.commentMenuCommentId = ''
          } else this[position] = this.commentMenuPosition({ currentTarget: anchor }, geometry.width, geometry.height)
        }
      }
      if (this.commentPanels.length) this.placeCommentPanels()
    },

    // —— 渲染给面板的取值 ——
    commentPanelHeightOf(item) {
      return commentPanelHeight(item.replies.length, this.commentHasDraft(item.id))
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
    
    /** 点正文高亮点亮对应线程（与 04 §3.1② 的双向跳转一致）。 */
    onCommentPointerDown(event) {
      const target = event.target
      const container = target && typeof target.closest === 'function' ? target.closest('.lark-doc-comment') : null
      if (!container) return
      this.activateComment(container.getAttribute('data-thread-id') || '')
      this.$nextTick(() => {
        const panels = this.$el.querySelectorAll('[data-comment-thread]')
        for (const panel of panels) if (panel.dataset.commentThread === this.commentActiveThreadId) panel.scrollIntoView({ block: 'nearest' })
      })
    },
  },
}
