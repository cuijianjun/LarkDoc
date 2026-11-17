/**
 * 权限闸门与操作生命周期 —— capability 投影、写操作闸门、Provider 解析、operation
 * 代际校验、授权后恢复、参与者查询。
 *
 * 从 `commentsMixin.js` 原样搬出，方法体一行未改；以对象展开并入 `methods`。
 */

import { bindThreads } from '../../../core/comments/binding'
import { encodeAnchor, decodeAnchor } from '../../../core/comments/anchor'
import { createCommentOperationId } from '../../../providers/comments'
import { projectCapabilityUi } from '../../../core/policy/capability'
import { commentGate, commentDraftText } from './commentMixinShared'

export const commentsCapabilityMethods = {
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



}
