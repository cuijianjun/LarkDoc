/** 评论正文独立持久化；远端动作只有数据库原键确认后更新视图。 */
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state'
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
import { getTransactionMetadata, PAGED_IMPORT_META, TRANSACTION_ORIGINS } from '../../../core/transactionMetadata'

const documentMentionScope = scope => scope === 'document' || (typeof scope === 'string' && /^edit\/[^/]+\/[^/]+$/.test(scope))

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



import { createCommentInteraction } from "./commentInteraction"

const commentInteraction = createCommentInteraction({ documentMentionScope, commentDraftText, COMMENT_MORE_MENU, COMMENT_REPLY_MENU, normalizeCommentMetadata, COMMENT_VIEWPORT_MARGIN, createCommentOperationId })

export default {
  data() {
    return {
      /** Provider 返回并经 `bindThreads` 绑过的线程（含 resolved，面板自己过滤）。 */
      commentThreads: [],
      commentSourceThreads: [],
      commentMessage: '',
      commentDocumentLike: { snapshot: null, busy: false, pending: '', error: '' },
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
      commentMobileScope: 'document',
      commentMobileOpen: false,
      /** threadId → 草稿文本。Vue 2 加新键必须走 `$set`，见 `setCommentDraft`。 */
      commentDrafts: {},
      commentDraftMentions: {},
      commentDraftReferences: {},
      commentMentionPicker: null,
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
  watch: {
    documentId() { this.retireImageViewers(); this.closeImageComments(null, false) },
    commentBusy() { this.refreshPanels?.() },
    commentPendingOperation() { this.refreshPanels?.() },
    session: { sync: true, handler(next, previous) {
    // Native repaint invalidates object dependencies even when Session identity is unchanged.
    // Identity/capability resets have their own Session events; a repaint must retain drafts.
    if (next === previous && this._commentBoundProvider === this.commentProvider()) return
    this.resetCommentIdentityView(); this.bindCommentSession()
    if (this.editor) void this.loadComments()
  } } },
  mounted() {
    this.bindCommentSession?.()
    document.addEventListener('pointerdown', this.onCommentReactionOutside, true)
    window.addEventListener('keydown', this.onCommentReactionKeydown, true)
    // 宿主的 `mounted` 在本钩子之后才建编辑器 —— 延一帧再拉评论、挂监听。
    this.$nextTick(() => {
      const view = this.editor && !this.editor.isDestroyed ? this.editor.view : null
      if (!view?.dom) return
      this._commentEditorDom = view.dom
      this._commentEditorDom.addEventListener('pointerdown', this.onCommentPointerDown)
      if (typeof this.editor.on === 'function') {
        this.editor.on('transaction', this.onCommentTransaction)
        this.editor.on('update', this.refreshImportedComments)
        this.loadComments?.().then(() => this.openCommentLink?.()).catch(() => {})
      }

    })
    window.addEventListener('scroll', this.onCommentViewportChange, true)
    window.addEventListener('resize', this.onCommentViewportChange)
  },
  beforeDestroy() {
    this.retireImageViewers()
    this.closeImageComments(null, false)
    this.resetCommentParticipants?.()
    document.removeEventListener('pointerdown', this.onCommentReactionOutside, true)
    window.removeEventListener('keydown', this.onCommentReactionKeydown, true)
    this.resetCommentImages?.()
    this.closeCommentReaction?.()
    this.commentDisposed = true; this.commentLoadGeneration++
    if (this._commentStopCapabilities) this._commentStopCapabilities()
    if (this._commentStopProvider) this._commentStopProvider()
    if (this._commentStopReset) this._commentStopReset()
    if (this._commentStopChanges) this._commentStopChanges()
    if (this._commentStopAssets) this._commentStopAssets()
    if (this.editor) {
      this.editor.off?.('transaction', this.onCommentTransaction)
      this.editor.off?.('update', this.refreshImportedComments)
      if (this._commentDecorationKey) this.editor.unregisterPlugin?.(this._commentDecorationKey)
    }
    window.removeEventListener('scroll', this.onCommentViewportChange, true)
    window.removeEventListener('resize', this.onCommentViewportChange)
    this._commentEditorDom?.removeEventListener?.('pointerdown', this.onCommentPointerDown)
    this._commentEditorDom = null

  },
  methods: {
    ...commentInteraction.methods,
    setCommentMessage(value) { this.commentMessage = value },
    resetCommentIdentityView(preservePending = false, preserveSidebar = false) {
      this.retireImageViewers()
      this.closeImageComments(null, false)
      this._imageCommentDrafts = null; this._imageCommentDraftOwner = null
      this._commentLikeGeneration = (this._commentLikeGeneration || 0) + 1
      this.commentDocumentLike = { snapshot: null, busy: false, pending: '', error: '' }
      this.resetCommentParticipants()
      this.resetCommentImages(preservePending)
      this.closeCommentReaction()
      this.commentIdentityGeneration = (this.commentIdentityGeneration || 0) + 1
      this.commentLoadGeneration++
      this.commentSourceThreads = []; this.commentThreads = []; this.commentPanels = []
      this.commentComposerContext = null; this.commentComposerOpen = false; this.commentSidebarOpen = preserveSidebar && this.commentSidebarOpen
      if (!preserveSidebar) this.commentHistorical = false
      this.commentDrafts = {}; this.commentDraftMentions = {}; this.commentDraftReferences = {}; this.commentMentionPicker = null; this.commentCreateDraft = ''; this.commentDocumentDraft = ''; this.commentDocumentMentions = []; this.commentDocumentReferences = []; this.commentDocumentReplyTarget = null; this.cancelCommentEdit()
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
      this._commentBoundProvider = this.commentProvider()
      for (const key of ['_commentStopCapabilities', '_commentStopProvider', '_commentStopReset', '_commentStopChanges', '_commentStopAssets']) { this[key]?.(); this[key] = null }
      if (this.session && typeof this.session.on === 'function') {
        this._commentStopAssets = this.session.on('provider-changed', event => {
          if (event.name === 'authorization') { void this.loadDocumentCommentLikes(); return }
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
          this.commentDrafts = {}; this.commentDraftMentions = {}; this.commentDraftReferences = {}; this.commentMentionPicker = null; this.commentEditingReply = null; this.commentEditContent = ''; this.commentEditMentions = []; this.commentEditReferences = []
          this.commentFollowPreferences = {}
          this.commentTranslationContext = null; this.commentTranslationState = null
          this.refreshCommentDecorations()
          if (this.commentCan('canView')) {
            const current = this.commentOperationCurrent(), provider = this.commentProvider(), session = this.session
            const authorization = session?._authorizationGeneration
            const loading = this.loadComments(), generation = this.commentLoadGeneration
            const owns = () => current() && generation === this.commentLoadGeneration && provider === this.commentProvider() &&
              authorization === session?._authorizationGeneration && this.commentCan('canView')
            loading.then(async () => {
              if (!owns()) return
              // Independent reads must not wait for the document-like service.
              void this.loadDocumentCommentLikes().catch(() => {})
              if (this.commentMoreThreadId && this.commentThreads.some(thread => thread.id === this.commentMoreThreadId && !thread.tombstone)) void this.loadCommentFollowPreference(this.commentMoreThreadId).catch(() => {})
              await this.openCommentLink()
              if (owns()) await this.recoverCommentAfterAuthorization()
            }).catch(() => {})
          }
        })
        this._commentStopProvider = this.session.on('comments-provider', () => {
          this._commentBoundProvider = this.commentProvider()
          this.resetCommentIdentityView(true)
          if (this.commentPendingOperation) this.commentMessage = '评论服务已变更，原操作仍需查询确认。'
          this.loadComments().catch(() => {})
        })
      }
      void this.loadDocumentCommentLikes()
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
      if (this._imageCommentScope) return this.closeImageComments()
      this.commentMobileScope = this._mobileEditorMedia?.matches ? 'selection' : 'document'
      this.commentSidebarOpen = !this.commentSidebarOpen
      this.commentMobileOpen = this.commentSidebarOpen
      this.$nextTick(() => { this.updateCommentLayerBounds(); this.placeCommentPanels() })
    },
    setCommentHistory(value) { this.commentHistorical = false; this.commentHistory = value === true; this.updateCommentPanels() },
    openHistoricalComments() { this.closeCommentMenus(); this.commentHistorical = true; this.commentHistory = false; this.commentSidebarOpen = true; this.commentComposerOpen = false; this.updateCommentPanels(); this.$nextTick(() => this.updateCommentLayerBounds()) },
    closeCommentComposer() {
      const editor = this.editor, current = this.commentOperationCurrent()
      this.clearCommentDraftImages('selection')
      this.commentComposerOpen = false; this.commentComposerContext = null
      if (!this.commentRemote) { this.commentSidebarOpen = this._commentComposerSidebarOpen === true; this.commentMobileOpen = this.commentSidebarOpen }
      this.refreshCommentDecorations()
      this.$nextTick(() => {
        if (!current() || editor !== this.editor || editor?.isDestroyed || !editor?.view?.dom) return
        const document = this.$el.ownerDocument, active = document.activeElement
        if (active && active !== document.body && active !== document.documentElement && !editor.view.dom.contains(active)) return
        editor.view.focus()

      })
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
      } catch (error) {
        const code = error.code || error.message
        this.commentMessage = code === 'COMMENT_ANCHOR_REQUIRED' ? '当前文档尚未连接协同正文，无法创建选区评论。' : code
        return false
      }
      this.commentMessage = ''
      if (!this.commentComposerOpen) this._commentComposerSidebarOpen = this.commentSidebarOpen
      this.commentMobileScope = 'selection'
      this.commentMobileOpen = true
      this.commentSidebarOpen = true; this.commentHistory = false; this.commentHistorical = false; this.commentComposerOpen = true; this.bubbleVisible = false
      this.updateCommentPanels(); this.refreshCommentDecorations(); this.$nextTick(() => this.updateCommentLayerBounds())
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
    setCommentCreateDraft(value) {
      if (this._imageCommentScope && !this.imageCommentCurrent()) return this.closeImageComments(null, false)
      this.commentCreateDraft = value
    },
    imageCommentCurrent(scope = this._imageCommentScope) {
      if (!scope || !scope.owner() || (scope.viewer && !scope.viewer.isConnected)) return false
      const pos = this.commentBlockPos(scope.blockId), node = pos < 0 ? null : this.editor.state.doc.nodeAt(pos)
      return node?.type.name === 'image' && node.attrs.src === scope.src && JSON.stringify(node.attrs.crop) === scope.crop
    },
    imageCommentsHandler() {
      const current = this.commentOperationCurrent(), editor = this.editor, session = this.session, provider = this.commentProvider()
      const identity = session?._identityGeneration, authorization = session?._authorizationGeneration, documentId = this.documentId
      const owner = () => current() && editor === this.editor && identity === session?._identityGeneration && authorization === session?._authorizationGeneration
        && documentId === this.documentId && provider === this.commentProvider() && this.commentCan('canView')
      const action = (image, visible, viewer) => {
        if (!owner()) {
          if (!visible) this.closeImageComments(viewer, false)
          return false
        }
        return this.openImageComments(image, visible, viewer)
      }
      action.watchViewer = (retire, images) => {
        this._imageViewerRetire ||= new Set()
        this._imageViewerRetire.add(retire)
        const targets = images.map(image => ({ image, pos: image.pos }))
        const guard = () => { if (!owner()) retire() }
        const transaction = ({ transaction: tr }) => {
          if (!owner()) { retire(); return }
          if (!tr.docChanged) return
          if ([TRANSACTION_ORIGINS.HOST, TRANSACTION_ORIGINS.RESTORE].includes(getTransactionMetadata(tr)?.origin)
            || tr.steps.some(step => step.from === 0 && step.to >= tr.before.content.size)) { retire(); return }
          for (const target of targets) {
            target.pos = tr.mapping.map(target.pos, 1)
            const node = Number.isInteger(target.pos) && target.pos >= 0 && target.pos < editor.state.doc.content.size ? editor.state.doc.nodeAt(target.pos) : null
            if (node?.type.name !== 'image' || node.attrs.blockId !== target.image.blockId || node.attrs.src !== target.image.src
              || JSON.stringify(node.attrs.crop) !== JSON.stringify(target.image.crop)) { retire(); return }
          }
        }
        const stops = ['comments-reset', 'capabilities', 'provider-changed'].map(name => session?.on?.(name, guard))
        editor?.on('transaction', transaction)
        guard()
        return () => { this._imageViewerRetire?.delete(retire); stops.forEach(stop => stop?.()); editor?.off('transaction', transaction) }
      }
      return action
    },
    retireImageViewers() { this._imageViewerRetire?.forEach(retire => retire()); this._imageViewerRetire?.clear() },
    openImageComments(image, visible = true, viewer = null) {
      if (!visible) { this.closeImageComments(viewer); return true }
      const editor = this.editor, provider = this.commentProvider()
      if (!editor || editor.isDestroyed || !provider || !this.commentCan('canView') || !this.featureEnabled('comments')) return false
      // The existing remote wire requires a nonempty text-relative anchor.
      // A block image has no text span; never invent a length or a new wire kind.
      if (provider.isRemote) { this.commentMessage = '当前远程评论服务尚未提供图片锚点评论能力'; return false }
      const blockId = image?.blockId, pos = this.commentBlockPos(blockId), node = pos < 0 ? null : editor.state.doc.nodeAt(pos)
      if (node?.type.name !== 'image' || node.attrs.src !== image.src || (viewer && (!viewer.isConnected || !this.$el.contains(viewer)))) return false
      if (this._imageCommentScope?.blockId === blockId && this._imageCommentScope.viewer === viewer && this.imageCommentCurrent()) return true
      this.closeImageComments()
      if (!this._imageCommentDraftOwner?.()) this._imageCommentDrafts = new Map()
      const current = this.commentOperationCurrent(), session = this.session, identity = session?._identityGeneration, authorization = session?._authorizationGeneration
      const assets = session?.getProvider?.('assets')
      const owner = () => current() && editor === this.editor && editor.view.dom.isConnected && provider === this.commentProvider()
        && identity === session?._identityGeneration && authorization === session?._authorizationGeneration
        && assets === session?.getProvider?.('assets') && this.commentCan('canView') && this.featureEnabled('comments')
      this._imageCommentDraftOwner = owner
      const selection = NodeSelection.create(editor.state.doc, pos)
      const context = { blockId, offset: 0, length: 0, from: pos, to: pos + node.nodeSize,
        ranges: [{ from: pos, to: pos + node.nodeSize }], text: '[图片]', bookmark: selection.getBookmark(),
        anchor: encodeAnchor({ blockId, offset: 0, length: 0 }, this.commentAnchorCodec) }
      const previous = { commentComposerOpen: this.commentComposerOpen, commentComposerContext: this.commentComposerContext,
        commentCreateDraft: this.commentCreateDraft, commentSidebarOpen: this.commentSidebarOpen, commentMobileScope: this.commentMobileScope,
        commentMobileOpen: this.commentMobileOpen, commentActiveThreadId: this.commentActiveThreadId,
        images: this.commentDraftImages('selection') }
      this.clearCommentDraftImages('selection')
      const cached = this._imageCommentDrafts.get(blockId)
      const draft = cached?.src === node.attrs.src && cached?.crop === JSON.stringify(node.attrs.crop) ? cached : null
      if (cached && !draft) this._imageCommentDrafts.delete(blockId)
      this._imageCommentScope = { blockId, src: node.attrs.src, crop: JSON.stringify(node.attrs.crop), owner, viewer, context, previous }
      this.closeCommentMenus()
      this.commentCreateDraft = draft?.text || ''
      this.$set(this.commentImageDrafts, 'selection', draft?.images || [])
      this.commentComposerContext = context; this.commentComposerOpen = true
      this._imageCommentScope.context = this.commentComposerContext
      this.commentSidebarOpen = true; this.commentMobileScope = 'selection'; this.commentMobileOpen = true
      this.updateCommentPanels(); this.refreshPanels?.()
      this.$nextTick(() => this.focusImageComment())
      return true
    },
    closeImageComments(viewer = null, restore = true) {
      const scope = this._imageCommentScope
      if (!scope || (viewer && scope.viewer !== viewer)) return false
      this._imageCommentScope = null
      const owned = scope.owner()
      scope.ui?.destroy()
      if (owned && this.imageCommentCurrent(scope)) this._imageCommentDrafts?.set(scope.blockId, { src: scope.src, crop: scope.crop, text: this.commentCreateDraft, images: this.commentDraftImages('selection') })
      else { this._imageCommentDrafts = null; this._imageCommentDraftOwner = null }
      this.clearCommentDraftImages('selection')
      this.closeCommentMenus()
      if (restore && owned) {
        const { images, ...previous } = scope.previous
        Object.assign(this, previous)
        this.$set(this.commentImageDrafts, 'selection', images)
      } else { this.commentComposerOpen = false; this.commentComposerContext = null; this.commentCreateDraft = ''; this.commentSidebarOpen = false; this.commentMobileOpen = false }
      scope.viewer?.dispatchEvent(new CustomEvent('lark-doc-image-comments-close', { detail: { retired: !restore || !owned } }))
      this.refreshPanels?.()
      return true
    },
    focusImageComment() {
      const scope = this._imageCommentScope
      if (!this.imageCommentCurrent(scope) || !scope.viewer || !scope.viewer.contains(scope.viewer.ownerDocument.activeElement)) return
      scope.ui?.el?.querySelector('[aria-label="新评论"]')?.focus()
    },
    cancelDocumentCommentDraft() {
      if (this.commentMentionPicker?.scope === 'document') this.commentMentionPicker = null
      this.commentDocumentDraft = ''; this.commentDocumentMentions = []; this.commentDocumentReferences = []; this.commentDocumentReplyTarget = null
      this.clearCommentDraftImages('document')
    },
    setCommentDocumentDraft(value, mentions = [], references = []) {
      const next = normalizeCommentMetadata(value, mentions, references)
      this.commentDocumentDraft = value; this.commentDocumentMentions = next.mentions
      this.commentDocumentReferences = next.references.map((item, index) => ({ ...item, ...(references[index].readable === false ? { readable: false } : {}) }))
    },
    commentDocumentCanSubmit() { return this.commentAllowed('create') },


    consumeDocumentCommentReplyTarget(target) { if (target === this.commentDocumentReplyTarget) this.commentDocumentReplyTarget = null },

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
      if (action === 'create' && (!this.commentCan('canView') || this.featureEnabled?.('comments') === false)) return false
      const provider = this.commentProvider()
      if (!provider || !provider.isRemote) {
        if (action === 'create') return typeof provider?.createThread === 'function' && this.writable()
          && !this.commentBusy && !this.commentPendingOperation
        if (action !== 'react') return true
        const thread = this.commentThreads.find(item => item.id === threadId && !item.tombstone)
        return typeof provider?.react === 'function' && !this.commentBusy && !this.commentPendingOperation && !!this.commentAuthor?.id && !!thread?.replies.some(reply => reply.id === replyId && !reply.tombstone)
      }
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
    commentLikeScope() {
      const session = this.session, provider = session?.getProvider?.('authorization'), auth = session?._authorizationGeneration
      const owns = this.commentOperationCurrent(), generation = this._commentLikeGeneration = (this._commentLikeGeneration || 0) + 1
      return { provider, current: () => owns() && generation === this._commentLikeGeneration && this.commentCan('canView')
        && session === this.session && !session?._destroyed && provider === session?.getProvider?.('authorization') && auth === session?._authorizationGeneration }
    },
    async loadDocumentCommentLikes() {
      const scope = this.commentLikeScope(), provider = scope.provider
      this.commentDocumentLike = { snapshot: null, busy: false, pending: '', error: '' }
      if (!provider?.isRemote || typeof provider.documentInformation !== 'function' || !scope.current()) return
      this.commentDocumentLike.busy = true
      let pending
      try {
        pending = await provider.documentInformation('operation', 'like')
        if (!scope.current()) return
        const snapshot = await provider.documentInformation('read', 'likes')
        if (scope.current()) this.commentDocumentLike = { snapshot, busy: false, pending: pending?.operationId || '', error: '' }
      } catch { if (scope.current()) this.commentDocumentLike = { snapshot: null, busy: false, pending: pending?.operationId || '', error: '暂时无法读取点赞状态' } }
    },
    async toggleDocumentCommentLike() {
      const state = this.commentDocumentLike
      if (!state || state.busy || (!state.snapshot && !state.pending)) return false
      const scope = this.commentLikeScope(), provider = scope.provider
      if (!scope.current() || !provider?.isRemote || typeof provider.documentInformation !== 'function') return false
      this.commentDocumentLike = { ...state, busy: true, error: '' }
      try {
        const result = await provider.documentInformation(state.pending ? 'query' : 'request', state.pending || {
          kind: 'like', expectedRevision: state.snapshot.revision, liked: !state.snapshot.liked,
        })
        if (!scope.current()) return false
        if (result?.status !== 'committed' || !result.like) throw new Error('unconfirmed')
        this.commentDocumentLike = { snapshot: result.like, busy: false, pending: '', error: '' }
        return true
      } catch (error) {
        if (scope.current()) this.commentDocumentLike = { ...state, busy: false,
          pending: error.operationId || state.pending, error: error.status === 'unknown' || state.pending ? '点赞结果尚未确认，请查询原操作' : '点赞未完成，请重试' }
        return false
      }
    },
    // 一次异步操作归属于发起时的身份视图；普通列表刷新不改变此归属。
    commentOperationCurrent() {
      const session = this.session, identity = session && session.user && session.user.id, documentId = session?.documentId
      // Same-principal credential rotation retires authorization, not the owner of an original write/query.
      const generation = this.commentOperationGeneration, identityGeneration = session && session._privateIdentityGeneration
      return () => !this.commentDisposed && !this.editor?.isDestroyed && session === this.session && generation === this.commentOperationGeneration &&
        identityGeneration === (session && session._privateIdentityGeneration) && identity === (this.session && this.session.user && this.session.user.id) && documentId === this.session?.documentId
    },

    // —— 读取与绑定 ——
    async loadComments() {
      const generation = ++this.commentLoadGeneration
      const current = this.commentOperationCurrent()
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
        if (!current() || generation !== this.commentLoadGeneration || provider !== this.commentProvider() || !this.commentCan('canView')) return []
        const visible = provider.isRemote ? threads : threads.filter(thread => thread.scope !== 'document' || thread.visibility !== 'private'
          || thread.author?.id === this.commentAuthor.id || thread.participants?.includes(this.commentAuthor.id))
        this.commentSourceThreads = visible
        this.commentThreads = bindThreads(this.editor ? this.editor.state.doc : null, visible, this.commentAnchorCodec)
        if (this.commentParticipantThread && !this.commentAllowed('participants', this.commentParticipantThread)) this.resetCommentParticipants()
        if (this.commentReactionContext && !this.commentAllowed('react', this.commentReactionContext.threadId, this.commentReactionContext.replyId)) this.closeCommentReaction()
        if (this.commentTranslationState && !this.commentTranslationIsCurrent(this.commentTranslationState)) this.commentTranslationState = null
        this.syncCommentImages()
        this.installCommentDecorations()
        this.refreshCommentDecorations()
        this.updateCommentPanels()
        return this.commentThreads
      } catch (error) {
        if (!current() || generation !== this.commentLoadGeneration || provider !== this.commentProvider() || !this.commentCan('canView')) return []
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
      const capability = ['resolve', 'reopen'].includes(method) ? 'canResolveComment' : 'canComment'
      this.commentBusy = true; this.commentMessage = ''
      try {
        // resolve/reopen keep their string threadId contract; only object
        // inputs can safely receive the remote idempotency field.
        if (provider.isRemote && input && typeof input === 'object' && input.operationId === undefined) input = { ...input, operationId: createCommentOperationId() }
        const result = this.session && typeof this.session[sessionMethod] === 'function'
          ? await this.session[sessionMethod](input) : await provider[method](input)
        if (!current() || !this.commentCan('canView') || !this.commentCan(capability) || provider !== this.commentProvider()) return null
        await this.loadComments().catch(() => { if (current()) this.commentMessage = '评论已提交，列表暂时无法刷新。' })
        return current() && this.commentCan('canView') && this.commentCan(capability) && provider === this.commentProvider() ? result : null
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
      const imageScope = this._imageCommentScope
      if (imageScope && (range !== imageScope.context || !this.imageCommentCurrent(imageScope))) return null
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
      if (!provider.isRemote && (range.invalid || this.commentBlockPos(range.blockId) < 0)) return null
      this._commentSubmittingRange = range
      const thread = await this.runCommentWrite('createThread', {
        scope: 'selection', visibility, ...(this.commentDraftImages('selection').length ? { assetIds: this.commentDraftImages('selection').map(image => image.assetId) } : {}), blockId: range.blockId, author: this.commentAuthor, content: text, anchor, quote: range.text,
      }, 'createCommentThread')
      if (this._commentSubmittingRange === range) this._commentSubmittingRange = null
      if (imageScope && (this._imageCommentScope !== imageScope || !this.imageCommentCurrent(imageScope))) return null
      if (thread && !provider.isRemote && !this.writable()) {
        this.commentMessage = '评论已提交，正文已切为只读，未写入标记。'
        return null
      }
      if (thread && !provider.isRemote && (range.invalid || this.commentBlockPos(range.blockId) < 0)) {
        this.commentMessage = '评论已提交，但原引用已被删除，未标记其他正文。'
        return null
      }
      if (thread) {
        this.commentCreateDraft = ''; this.clearCommentDraftImages('selection')
        this.commentComposerOpen = false; this.commentComposerContext = null; this.commentSidebarOpen = true
        if (!provider.isRemote) {
          const mark = this.editor.schema.marks.comment?.create({ threadId: thread.id })
          if (mark) {
            const transaction = this.editor.state.tr
            for (const selected of range.ranges || [range]) transaction.addMark(selected.from, selected.to, mark)
            this.editor.view.dispatch(transaction)
          }
        }
        this.activateComment(thread.id)
      }
      return thread
    },
    async createDocumentComment(content, visibility = 'document', participants = [], mentions, references) {
      if (!this.commentDocumentCanSubmit()) return null
      const result = await this.runCommentWrite('createThread', { scope: 'document', visibility, participants, content, ...(mentions === undefined ? {} : { mentions }), ...(references === undefined ? {} : { references }), ...(this.commentDraftImages('document').length ? { assetIds: this.commentDraftImages('document').map(image => image.assetId) } : {}), author: this.commentAuthor,
        blockId: null, anchor: null }, 'createCommentThread')
      if (result) this.activateComment(result.id)
      return result
    },
    async submitCommentDraft(threadId) {
      if (!this.commentAllowed('reply', threadId)) return null
      const mentions = this.commentDraftMentions[threadId] || [], references = this.commentDraftReferences[threadId] || []
      const draft = commentDraftText(this.commentDrafts, threadId)
      const text = mentions.length || references.length ? draft : draft.trim()
      if (!text.trim() && !this.commentDraftImages(threadId).length) return null
      const result = await this.runCommentWrite('reply', { threadId, author: this.commentAuthor, content: text, ...(mentions.length ? { mentions } : {}), ...(references.length ? { references } : {}), ...(this.commentDraftImages(threadId).length ? { assetIds: this.commentDraftImages(threadId).map(image => image.assetId) } : {}) }, 'replyToComment')
      if (result && this.commentDraftOf(threadId) === draft && (this.commentDraftMentions[threadId] || mentions) === mentions && (this.commentDraftReferences[threadId] || references) === references) this.clearCommentDraft(threadId)
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
      this.commentMessage = '当前评论服务不支持删除。'
      return null
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
      const ranges = selection.ranges.map(range => ({ from: range.$from.pos, to: range.$to.pos })).sort((a, b) => a.from - b.from)
      const from = ranges[0].from, to = ranges[ranges.length - 1].to
      const resolved = selection.$anchorCell || state.doc.resolve(from)
      const node = selection.node
      if (node?.attrs?.blockId) {
        const text = ({ image: '[图片]', linkEmbed: '[网页]', bookmark: '[网页卡片]' })[node.type.name] || node.textContent
        return { blockId: node.attrs.blockId, offset: 0, length: node.content.size, from, to, ranges, text, bookmark: selection.getBookmark() }
      }
      for (let depth = resolved.depth; depth > 0; depth -= 1) {
        const node = resolved.node(depth)
        const blockId = node.attrs && typeof node.attrs.blockId === 'string' ? node.attrs.blockId.trim() : ''
        if (!blockId || (selection.$anchorCell && node.type.name !== 'table')) continue
        const contentStart = resolved.before(depth) + 1
        return {
          blockId, offset: Math.max(0, from - contentStart), length: Math.max(0, to - from), from, to, ranges,
          text: selection.$anchorCell ? ranges.map(range => state.doc.textBetween(range.from, range.to, ' ', ' ')).join(' ') : state.doc.textBetween(from, to, '\n', ' '),
          bookmark: selection.getBookmark(),
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
    setCommentDraft(threadId, text, mentions = this.commentDraftMentions[threadId] || [], references = this.commentDraftReferences[threadId] || []) {
      if (!threadId || !this.commentAllowed('reply', threadId)) return
      const content = typeof text === 'string' ? text : ''
      let metadata = { mentions: [], references: [] }
      try { metadata = normalizeCommentMetadata(content, mentions, references) } catch { /* Text edits can invalidate stale ranges; keep plain text until a new mention is selected. */ }
      this.$set(this.commentDrafts, threadId, content)
      this.$set(this.commentDraftMentions, threadId, metadata.mentions)
      this.$set(this.commentDraftReferences, threadId, metadata.references)
    },
    clearCommentDraft(threadId) {
      if (!threadId) return
      this.clearCommentDraftImages(threadId)
      this.$set(this.commentDrafts, threadId, '')
      this.$set(this.commentDraftMentions, threadId, [])
      this.$set(this.commentDraftReferences, threadId, [])
      if (this.commentMentionPicker?.threadId === threadId) this.commentMentionPicker = null
    },







    commentHasDraft(threadId) {
      return commentDraftText(this.commentDrafts, threadId).trim().length > 0 || this.commentDraftImages(threadId).length > 0
    },

    // —— 点亮、已读、跳转 ——
    activateComment(threadId) {
      const next = threadId || ''
      const thread = this.commentThreads.find(item => item.id === next)
      if (next) this.commentMobileOpen = true
      if (thread) this.commentMobileScope = thread.scope === 'document' ? 'document' : 'selection'
      if ((this.commentRemote || this._mobileEditorMedia?.matches) && thread && thread.scope !== 'document') { this.commentSidebarOpen = true; this.commentHistorical = thread.anchorStatus === 'orphaned'; this.commentHistory = !this.commentHistorical && thread.resolved === true }
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
        this.editor.storage?.larkDoc?.projection?.revealPosition?.(pos)
        const at = this.editor.view.domAtPos(pos)
        const direct = this.editor.view.nodeDOM?.(pos) || at.node
        const node = direct && direct.nodeType === 3 ? direct.parentNode : direct
        this.editor.storage?.larkDoc?.projection?.revealNode?.(node)
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

    commentPrivate(threadId) {
      const provider = this.commentProvider()
      if (provider?.isRemote || this.commentThreads.find(thread => thread.id === threadId)?.scope === 'document') {
        const thread = (this.commentThreads || []).find(item => item.id === threadId)
        return Boolean(thread && thread.visibility === 'private')
      }
      return this.commentPrivateIds.indexOf(threadId) !== -1
    },



    commentViewport() {
      const root = typeof document !== 'undefined' ? document.documentElement : null
      const win = typeof window !== 'undefined' ? window : null
      const visual = win?.visualViewport
      const width = Number(visual?.width) || Number(root?.clientWidth) || Number(win?.innerWidth) || 0
      const height = Number(visual?.height) || Number(root?.clientHeight) || Number(win?.innerHeight) || 0
      return { width, height }
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
      const anchor = this._commentReactionAnchor, context = this.commentReactionContext
      this.commentReactionContext = null; this._commentReactionAnchor = null
      if (context?.position) {
        const style = this.$el?.querySelector?.('.lark-doc-comment-reaction-picker')?.style
        for (const key of ['position', 'left', 'top']) style?.removeProperty(key)
      }
      this.commentReactionQuery = ''; this.commentReactionCategory = '常用'; this.commentReactionLimit = 120
      if (restoreFocus) this.restoreCommentReplyFocus(context?.threadId, context?.replyId, anchor)
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
      if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229) return
      const root = this.$refs?.root || this.$el
      const tree = root?.getRootNode?.()
      let target = event.target?.nodeType ? event.target : tree?.activeElement || root?.ownerDocument?.activeElement
      // A closed shadow hides its input from the window's composed path.
      for (let boundary = tree; boundary?.host; boundary = boundary.host.getRootNode?.()) {
        if (target === boundary.host && tree.activeElement) { target = tree.activeElement; break }
      }
      while (target?.shadowRoot?.activeElement) target = target.shadowRoot.activeElement
      const input = (event.composedPath?.() || []).find(node => typeof node?.__larkDocCommentComposition === 'function') || target?.closest?.('.lark-doc-comment-rich-input')
      if (input?.__larkDocCommentComposition?.(event)) return
      if (event.key === 'Escape' && root && target && target !== root.ownerDocument?.body && target !== root.ownerDocument?.documentElement &&
          !root.contains(target) && !event.composedPath?.().includes(root)) {
        if (this.commentImageViewer) this.closeCommentImage()
        if (this.commentMoreThreadId || this.commentMenuThreadId || this.commentReactionContext) this.closeCommentMenus()
        return
      }
      if (this.commentImageViewer && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.closeCommentImage(true); return }
      if (event.key === 'Escape' && (this.commentMoreThreadId || this.commentMenuThreadId)) {
        const anchor = this._commentMoreMenuAnchor || this._commentReplyMenuAnchor
        const threadId = this.commentMenuThreadId, replyId = this.commentMenuCommentId
        event.preventDefault(); event.stopPropagation(); this.closeCommentMenus(); this.restoreCommentReplyFocus(threadId, replyId, anchor); return
      }
      if (!this.commentReactionContext || event.key !== 'Escape') return
      event.preventDefault(); event.stopPropagation(); this.closeCommentReaction(true)
    },
    showMoreCommentReactions() { this.commentReactionLimit += 120 },
    setCommentReactionQuery(value) { this.commentReactionQuery = value; this.commentReactionLimit = 120 },
    setCommentReactionCategory(value) { this.commentReactionCategory = value; this.commentReactionLimit = 120 },











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



    // —— 几何 ——
    /** 由宿主的 `onTransaction` 调；只做「过滤 + 清理失效 id」，几何交给下一帧。 */
    updateCommentPanels() {
      if (!this.editor) {
        this.commentPanels = []
        this.commentActiveThreadId = ''
        return
      }
      const provider = this.commentProvider()
      if (provider && Array.isArray(this.commentSourceThreads)) {
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
      if (this._isBeingDestroyed || this._isDestroyed || this.editor?.isDestroyed) return
      this.updateCommentLayerBounds?.()
      const view = this.editor?.view
      if (!view) return
      if (this._mobileEditorMedia?.matches && this.commentSidebarOpen && !this.commentComposerOpen && !this.commentHistorical) {
        const main = this.$refs.root?.querySelector('.lark-doc-main'), bounds = main?.getBoundingClientRect()
        const cards = [...(this.$el.querySelector('.is-reference-drawer')?.querySelectorAll('[data-comment-thread]') || [])]
        const at = item => {
          const pos = this.commentBlockPos(item.blockId), node = pos >= 0 ? view.nodeDOM(pos) : null
          const top = node?.getBoundingClientRect?.().top
          return Number.isFinite(top) ? top - (bounds?.top || 0) + (main?.scrollTop || 0) : 65
        }
        let floor = 65
        this.commentPanels = [...this.commentPanels].sort((a, b) => at(a) - at(b)).map(item => {
          const top = Math.max(floor, at(item)), gap = top - floor
          const height = cards.find(node => node.dataset.commentThread === item.id)?.getBoundingClientRect().height || this.commentPanelHeightOf(item)
          floor = top + height + 36
          return { ...item, top, gap }
        })
        return
      }
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
      const viewport = this.commentViewport()
      const maxLeft = viewport.width - COMMENT_PANEL.width - COMMENT_VIEWPORT_MARGIN
      const left = Math.max(COMMENT_VIEWPORT_MARGIN, Math.min(maxLeft, bound.right + COMMENT_ANCHOR_GUTTER))
      const bottomLimit = viewport.height - COMMENT_VIEWPORT_MARGIN
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
    refreshImportedComments(payload) {
      if (payload.transaction.getMeta(PAGED_IMPORT_META)) this.onCommentTransaction({ ...payload, imported: true })
    },
    onCommentTransaction({ transaction, imported = false } = {}) {
      const imageScope = this._imageCommentScope
      const replaced = transaction?.docChanged && ([TRANSACTION_ORIGINS.HOST, TRANSACTION_ORIGINS.RESTORE].includes(getTransactionMetadata(transaction)?.origin)
        || transaction.steps.some(step => step.from === 0 && step.to >= transaction.before.content.size))
      if (replaced) { this._imageCommentDrafts = null; this._imageCommentDraftOwner = null }
      if (imageScope && transaction?.docChanged && (replaced || !this.imageCommentCurrent(imageScope))) this.closeImageComments(null, false)
      if (transaction?.docChanged) for (const range of new Set([this.commentComposerContext, this._commentSubmittingRange, this._imageCommentScope?.previous.commentComposerContext])) {
        if (!range || range.invalid) continue
        const selected = range.ranges || [range]
        range.ranges = selected.map(item => {
          const from = transaction.mapping.mapResult(item.from, 1), to = transaction.mapping.mapResult(item.to, -1)
          if (from.deletedAcross || to.deletedAcross || from.pos >= to.pos) range.invalid = true
          return { from: from.pos, to: to.pos }
        })
        range.from = range.ranges[0].from; range.to = range.ranges[range.ranges.length - 1].to
        range.bookmark = range.bookmark?.map(transaction.mapping)
      }
      if (!imported && transaction?.getMeta(PAGED_IMPORT_META)) return
      const provider = this.commentProvider()
      if (!this.commentDisposed && provider && (provider.isRemote || imported)) this.updateCommentPanels()
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
      const viewport = this.commentViewport()
      const win = typeof window !== 'undefined' ? window : null
      const layoutWidth = Number(win?.innerWidth) || viewport.width
      const layoutHeight = Number(win?.innerHeight) || viewport.height
      const layer = root.querySelector('.lark-doc-comment-layer.is-remote')
      if (layer) {
        layer.style.right = `${layoutWidth <= 760 ? 0 : Math.max(COMMENT_VIEWPORT_MARGIN * 2, layoutWidth - viewport.width + COMMENT_VIEWPORT_MARGIN * 2)}px`
        layer.style.bottom = `${layoutWidth <= 760 ? 0 : Math.max(COMMENT_VIEWPORT_MARGIN * 2, layoutHeight - viewport.height + COMMENT_VIEWPORT_MARGIN * 2)}px`
      }
      this.commentLayerHeight = Math.max(0, Math.min(viewport.height, root.getBoundingClientRect().bottom) - this.commentLayerTop - 16)
    },
    // 视口尺寸变化（软键盘弹出、工具栏折叠）不是内容滚动：选择器是 fixed 定位、
    // 没有可跟随的滚动容器，刚打开就被抖动关掉等于该入口在移动端不可用。
    // 这里只把选择器收敛回可视区域，真正的滚动仍按原语义关闭。
    refitCommentReaction() {
      const context = this.commentReactionContext
      const root = this.$el
      const picker = root?.querySelector?.('.lark-doc-comment-reaction-picker')
        || root?.ownerDocument?.querySelector?.('.lark-doc-comment-reaction-picker')
      const rect = picker?.getBoundingClientRect?.()
      if (!context?.position || !rect || !rect.width || !rect.height) return
      const viewport = this.commentViewport()
      const left = Math.max(COMMENT_VIEWPORT_MARGIN, Math.min(context.position.left, viewport.width - rect.width - COMMENT_VIEWPORT_MARGIN))
      const top = Math.max(COMMENT_VIEWPORT_MARGIN, Math.min(context.position.top, viewport.height - rect.height - COMMENT_VIEWPORT_MARGIN))
      if (left === context.position.left && top === context.position.top) return
      context.position = { left, top }
      this.refreshPanels?.()
    },
    onCommentViewportChange(event) {
      const target = event && event.target
      const menuScroll = target && typeof target.closest === 'function' && target.closest('.lark-doc-comment-more-menu, .lark-doc-comment-reply-menu, .lark-doc-comment-reaction-picker')
      const resized = !!event && event.type === 'resize'
      this.updateCommentLayerBounds?.()
      if (resized) this.refitCommentReaction()
      else if (event && !menuScroll && this.commentReactionContext) this.closeCommentReaction()
      if (event && !menuScroll && this.commentRemote) {
        for (const [id, anchorKey, position, geometry] of [
          ['commentMoreThreadId', '_commentMoreMenuAnchor', 'commentMoreMenuPosition', COMMENT_MORE_MENU],
          ['commentMenuThreadId', '_commentReplyMenuAnchor', 'commentReplyMenuPosition', COMMENT_REPLY_MENU],
        ]) {
          if (!this[id]) continue
          const anchor = this[anchorKey], rect = anchor && anchor.isConnected && anchor.getBoundingClientRect()
          const viewport = this.commentViewport()
          if (!rect || rect.bottom < this.commentLayerTop || rect.top > viewport.height) {
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
      if (this._mobileEditorMedia?.matches && at) {
        const date = new Date(at)
        if (Number.isFinite(date.getTime())) return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
      }
      return commentRelativeTime(Date.now(), at)
    },
    commentAuthorName(author) {
      const name = author && typeof author.name === 'string' ? author.name.trim() : ''
      return name || '我'
    },

    /** 引用头：优先用落库时的快照文本，没有就退回锚点块的第一段（飞书同样是快照）。 */
    commentQuoteOf(item) {
      if (typeof item.quote === 'string' && item.quote) return item.quote
      const pos = this.commentBlockPos?.(item.blockId) ?? -1
      return pos >= 0 && this.editor?.state.doc.nodeAt(pos)?.type.name === 'image' ? '[图片]' : ''
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
