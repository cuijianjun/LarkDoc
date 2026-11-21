/** 评论正文独立持久化；远端动作只有数据库原键确认后更新视图。 */
import { COMMENT_MORE_MENU, COMMENT_REPLY_MENU } from '../../../core/blocks/comment'
import { unreadCount } from '../../../core/comments/index'
import { resolveAnchorCodec } from '../../../core/comments/binding'
import { normalizeAuthor } from '../../../core/comments/thread'
import { normalizeCommentMetadata } from '../../../core/comments/mentions'
import { createCommentOperationId } from '../../../providers/comments'
import { projectCapabilityUi } from '../../../core/policy/capability'
import { documentMentionScope, COMMENT_VIEWPORT_MARGIN, commentDraftText } from './commentMixinShared'
import { commentsSessionMethods } from './commentsSessionMethods'
import { commentsCapabilityMethods } from './commentsCapabilityMethods'
import { commentsThreadMethods } from './commentsThreadMethods'
import { commentsLayoutMethods } from './commentsLayoutMethods'

export {
  COMMENT_GATES, commentGate, commentDraftText, commentRelativeTime, commentSidebarThreads,
} from './commentMixinShared'

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
      commentReactionCatalog: null,
      commentReactionRecent: [],
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
      /** threadId → 引用目标（点「引用回复」时记录），提交时随 payload 落到 `replyTo`。 */
      commentReplyTargets: {},
      commentMentionPicker: null,
      /** 已读线程 id：未读数按它与 `commentThreads` 做差集。 */
      commentReadIds: [],
      /** 本地Provider保留旧开关；远端使用服务端visibility。 */
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
      /** 飞书历史评论弹层（表格头「历史评论」）：锚点样式由触发元素算出。 */
      commentHistoryOpen: false,
      commentHistoryStyle: {},
      /** threadId → 删除请求标记；同一条线程只允许一次删除在飞。 */
      commentDeleting: {},
      /** `threadId:replyId` → `{ source, content }`：译文只在 source 仍等于正文时展示。 */
      commentTranslations: {},
      /** 协同宿主注入 yjs codec 工厂的入口；不注入就走 plain（core 不 import yjs）。 */
      commentAnchorOptions: {},
    }
  },
  computed: {
    commentCapabilityState() { return projectCapabilityUi(this.session, 'canComment') },



    commentDocumentThreads() {
      const mobile = this._mobileEditorMedia?.matches
      return this.commentThreads.filter(thread => thread.scope === 'document' && !thread.tombstone && (!mobile || !thread.resolved))
    },
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
    /** 表格 / 链接预览工具栏里的评论入口：有可读 provider 且身份可查看评论。 */
    commentEntryVisible() { return !!this.editor && !!this.commentProvider() && this.commentCan('canView') },
    commentEntryAvailable() { return this.commentEntryVisible && this.commentAllowed('create') },
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
    ...commentsSessionMethods,
    ...commentsCapabilityMethods,
    ...commentsThreadMethods,
    ...commentsLayoutMethods,
    /** 飞书历史评论弹层的门槛：有评论服务，且可查看且可编辑（方法而非 computed，调用方统一 `()`）。 */
    commentCanViewHistory() { return !this._mobileEditorMedia?.matches && !!this.commentProvider() && this.commentCan('canView') && this.commentCan('canEdit') },
    /** 飞书「历史评论」弹层：贴着触发元素右下角开，最大高度贴底。 */
    openCommentHistory(event) {
      if (!this.commentCanViewHistory()) return false
      this.closeCommentMenus()
      this.commentHistoryOpen = true
      const rect = event?.currentTarget?.getBoundingClientRect?.()
      const top = Math.max(8, Math.min(window.innerHeight - 215, rect?.bottom || 47))
      this.commentHistoryStyle = {
        left: `${Math.max(8, Math.min(window.innerWidth - 368, (rect?.right || window.innerWidth - 16) - 360))}px`,
        top: `${top}px`,
        maxHeight: `${Math.max(80, window.innerHeight - top - 8)}px`,
      }
      return true
    },
    closeCommentHistory() { this.commentHistoryOpen = false },
    /** 删除整条线程：只有历史弹层能给这个入口，权限与可编辑性同弹层门槛。 */
    async deleteCommentThread(threadId) {
      if (!threadId || !this.commentCanViewHistory() || !this.commentAllowed('remove') || this.commentDeleting?.[threadId]) return null
      if (typeof this.commentProvider()?.deleteThread !== 'function') { this.commentMessage = '当前评论服务不支持删除线程'; return null }
      const pending = Symbol('delete-comment-thread')
      if (!this.commentDeleting) this.commentDeleting = {}
      this.$set(this.commentDeleting, threadId, pending)
      try {
        const result = await this.runCommentWrite('deleteThread', { threadId, author: this.commentAuthor }, 'deleteCommentThread')
        if (this.commentDeleting[threadId] !== pending || !this.commentCanViewHistory() || !this.commentAllowed('remove')) return null
        if (result === true) {
          this.commentThreads = this.commentThreads.filter(thread => thread.id !== threadId)
          this.updateCommentPanels()
          this.clearCommentDraft(threadId)
        }
        return result
      } finally {
        if (this.commentDeleting[threadId] === pending) this.$set(this.commentDeleting, threadId, null)
      }
    },
    /** Vue2 的 `$delete` 只存在于真宿主；单测/桥接对象可能没有，退化成普通 delete。 */
    commentDropKey(object, key) {
      if (typeof this.$delete === 'function') this.$delete(object, key)
      else delete object[key]
    },
    /** 「查看原文」：撤掉译文展示，正文与 provider 记录都不动。 */
    cancelCommentTranslation(threadId, replyId) {
      const key = `${threadId}:${replyId}`
      if (!this.commentTranslations || !(key in this.commentTranslations)) return false
      this.commentDropKey(this.commentTranslations, key)
      return true
    },
  },
}
