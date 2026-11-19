/** Private interactions that are reachable from the mounted comment UI. */
import { loadReactionCatalog } from '../../../core/comments/reactionCatalog'

async function resolveMentionPicker(token, request, current) {
  if (!current()) return null
  token.status = 'loading'; token.candidates = []
  try {
    const result = await request()
    if (!current()) return null
    if (token.kind !== 'reference') token.operationId = result?.operationId || token.operationId
    if (result?.status === 'resolved') {
      token.candidates = (result.candidates || result.items || []).filter(item => item && (token.kind === 'reference' ? item.docId : item.principalId)).slice(0, 8)
      token.index = token.candidates.length ? 0 : -1; token.status = token.candidates.length ? 'ready' : 'empty'
    } else token.status = result?.status === 'blocked' ? 'blocked' : 'error'
  } catch (error) {
    if (!current()) return null
    if (token.kind !== 'reference') token.operationId = error?.operationId || token.operationId
    if (error?.status === 'rejected') token.operationId = null
    token.status = error?.status === 'unknown' && token.operationId ? 'unknown' : 'error'
  }
  return token
}

export function createCommentInteraction(dependencies) {
  const { documentMentionScope, commentDraftText, COMMENT_MORE_MENU, COMMENT_REPLY_MENU, normalizeCommentMetadata, COMMENT_VIEWPORT_MARGIN, createCommentOperationId } = dependencies
  const methods = {
    beginDocumentCommentReply(threadId, replyId) {
      if (!this.commentCan('canView') || !this.commentAllowed('create')) return false
      const reply = this.commentThreads.find(thread => thread.id === threadId)?.replies.find(item => item.id === replyId && !item.tombstone)
      if (!reply?.author?.id) return false
      this.commentDocumentReplyTarget = { principalId: reply.author.id, displayName: reply.author.name || reply.author.id,
        visibility: this.commentThreads.find(thread => thread.id === threadId).visibility }
      return true
    },
    quoteDocumentComment(threadId, replyId) {
      const thread = this.commentThreads.find(item => item.id === threadId && item.scope === 'document' && !item.tombstone)
      const reply = thread?.replies.find(item => item.id === replyId && !item.tombstone)
      if (!reply || !this.commentAllowed('reply', threadId) || !this.beginDocumentCommentReply(threadId, replyId)) return false
      const prefix = `> ${this.commentAuthorName(reply.author)}：${reply.content}\n\n`
      const shift = item => ({ ...item, from: item.from + prefix.length, to: item.to + prefix.length })
      this.setCommentDocumentDraft(prefix + (this.commentDocumentDraft || ''), (this.commentDocumentMentions || []).map(shift), (this.commentDocumentReferences || []).map(shift))
      this.closeCommentMenus()
      this.commentMobileScope = 'document'; this.commentHistorical = false
      this.refreshPanels?.()
      const current = this.commentOperationCurrent()
      this.$nextTick(() => { if (current() && this.commentCan('canView')) this.$el.querySelector('.lark-doc-document-composer-input')?.focus() })
      return true
    },
    async submitDocumentComment(visibility) {
      const text = this.commentDocumentDraft
      if (!text.trim() && !this.commentDraftImages('document').length || !this.commentDocumentCanSubmit()) return null
      const { mentions, references } = normalizeCommentMetadata(text, this.commentDocumentMentions, this.commentDocumentReferences)
      const participants = visibility === 'private' ? [...new Set(mentions.map(value => value.principalId))].filter(id => id !== this.commentAuthor.id) : []
      const result = await (references.length ? this.createDocumentComment(text, visibility, participants, mentions, references) : mentions.length ? this.createDocumentComment(text, visibility, participants, mentions) : this.createDocumentComment(text, visibility))
      if (result) this.cancelDocumentCommentDraft()
      return result
    },
    beginEditComment(threadId, replyId) {
      if (!this.commentAllowed('edit', threadId, replyId)) return
      const thread = (this.commentThreads || []).find(item => item.id === threadId)
      const reply = thread && thread.replies.find(item => item.id === replyId)
      if (!reply) return
      this.cancelCommentEdit()
      // 已存附件在编辑态是「已就绪草稿」：带 id 才能用 × 移除（`onRemoveAttachment` 传的就是 id），
      // 带 status=ready 才会被 `commentDraftAssetIds` 收进本次提交。
      this.$set(this.commentImageDrafts, 'edit/' + threadId + '/' + replyId, (reply.attachments || []).map((asset, index) => ({
        ...asset, id: asset.assetId || (asset.attchId != null ? 'attch-' + asset.attchId : 'saved-' + index), status: 'ready',
        previewUrl: this.commentImageUrl(thread, reply, asset),
      })))
      let metadata = { mentions: [], references: [] }
      try { metadata = normalizeCommentMetadata(reply.content, reply.mentions || [], reply.references || [], true) } catch { /* Invalid legacy ranges remain plain text. */ }
      this.commentEditGeneration = (this.commentEditGeneration || 0) + 1
      this.commentEditingReply = { threadId, replyId, generation: this.commentEditGeneration, originalReplyRevision: reply.replyRevision, originalAssets: (reply.attachments || []).map(asset => asset.assetId), ...(reply.references?.length ? { originalReferences: true } : {}) }
      this.setCommentEditContent(reply.content, metadata.mentions, metadata.references)
    },
    async saveEditedComment() {
      const value = this.commentEditingReply
      if (!value || !this.commentAllowed('edit', value.threadId, value.replyId)) return null
      const scope = 'edit/' + value.threadId + '/' + value.replyId
      const assetIds = this.commentDraftAssetIds(scope), remote = this.commentProvider()?.isRemote
      // 原来有图、草稿里一张没剩 = 用户主动移除，要显式发空附件，否则服务端按「本次没提交附件」保留原图。
      const cleared = !assetIds.length && Boolean(value.originalAssets?.length)
      if (!this.commentEditContent.trim() && !assetIds.length && !cleared) return null
      const local = remote ? [] : this.commentDraftAttachments(scope)
      const attachmentPayload = remote ? (assetIds.length || cleared ? { assetIds } : {})
        : (local.length ? { attachments: local, ...(assetIds.length ? { assetIds } : {}) } : cleared ? { attachments: [] } : {})
      const { mentions, references } = normalizeCommentMetadata(this.commentEditContent, this.commentEditMentions, this.commentEditReferences)
      const result = await this.runCommentWrite('editReply', { threadId: value.threadId, replyId: value.replyId, content: this.commentEditContent, mentions, ...(remote ? {} : { author: this.commentAuthor }), ...(references.length || value.originalReferences ? { references } : {}), ...attachmentPayload }, 'editCommentReply')
      if (result) this.cancelCommentEdit()
      return result
    },
    async setCommentParticipants(threadId, participants, expectedRevision) {
      if (!this.commentAllowed('participants', threadId)) return null
      return this.runCommentWrite('setParticipants', { threadId, participants, ...(expectedRevision === undefined ? {} : { expectedRevision }) }, 'setCommentParticipants')
    },
    async updateCommentMentionPicker(threadId, value, caret = value?.length) {
      if (!threadId || !this.commentAllowed('reply', threadId) || typeof value !== 'string') return this.commentMentionPicker = null
      const end = Number.isInteger(caret) ? Math.max(0, Math.min(caret, value.length)) : value.length
      const prefix = value.slice(0, end), match = /[@＠]([^\s@＠]*)$/u.exec(prefix)
      if (!match || !this.commentRemote || typeof this.session?.resolveMentions !== 'function') return this.commentMentionPicker = null
      const query = match[1], from = end - query.length - 1
      this.commentMentionPicker = { threadId, query, from, to: end, candidates: [], index: 0, status: 'loading', operationId: null }
      const token = this.commentMentionPicker
      const session = this.session, identity = session._privateIdentityGeneration, authorization = session._authorizationGeneration
      const current = () => this.commentMentionPicker === token && this.session === session && session._privateIdentityGeneration === identity && session._authorizationGeneration === authorization && this.commentAllowed('reply', threadId)
      const resolve = original => resolveMentionPicker(token, () => original && token.operationId ? session.queryMentionResolution({ operationId: token.operationId }) : session.resolveMentions({ query }), current)
      token.retry = () => token.status === 'loading' ? null : resolve(!!token.operationId)
      return resolve(false)
    },
    async updateDocumentMentionPicker(scope, value, caret = value?.length) {
      if (!documentMentionScope(scope) || typeof value !== 'string' || !this.commentCan('canComment')) return this.commentMentionPicker = null
      const end = Number.isInteger(caret) ? Math.max(0, Math.min(caret, value.length)) : value.length
      const prefix = value.slice(0, end), mention = /[@＠]([^\s@＠]*)$/u.exec(prefix), reference = /\[\[([^\]]*)$/u.exec(prefix)
      const kind = mention ? 'mention' : reference ? 'reference' : ''
      if (!kind || this.commentRemote !== true) return this.commentMentionPicker = null
      const match = mention || reference, markerLength = kind === 'mention' ? 1 : 2
      const edit = scope.startsWith('edit/') ? scope.split('/') : []
      this.commentMentionPicker = { scope, kind, threadId: edit[1] || '', replyId: edit[2] || '', query: match[1], from: end - match[1].length - markerLength, to: end, candidates: [], index: 0, status: 'loading', operationId: null }
      const token = this.commentMentionPicker
      const session = this.session, handler = this.onDocumentAction, identity = session?._privateIdentityGeneration, authorization = session?._authorizationGeneration
      const current = () => this.commentMentionPicker === token && this.session === session && session?._privateIdentityGeneration === identity && session?._authorizationGeneration === authorization && this.commentCan('canComment') && (kind === 'mention' || handler === this.onDocumentAction)
      const resolve = original => resolveMentionPicker(token, () => kind === 'mention'
        ? (original && token.operationId ? session.queryMentionResolution({ operationId: token.operationId }) : session.resolveMentions({ query: token.query }))
        : handler?.({ action: 'resolve-document-references', query: token.query, sourceDocumentId: session?.documentId || null, actorId: session?.user?.id || null }), current)
      token.retry = () => token.status === 'loading' ? null : resolve(!!token.operationId)
      return resolve(false)
    },
    retryCommentMentionPicker(scope) {
      const token = this.commentMentionPicker
      if (!token || (token.scope ? token.scope !== scope || !this.commentCan('canComment') : scope !== `reply/${token.threadId}` || !this.commentAllowed('reply', token.threadId))) return false
      return token.retry?.() || false
    },
    documentMentionKeydown(scope, key) {
      const picker = this.commentMentionPicker
      if (!picker || picker.scope !== scope) return false
      if (key === 'Escape') { this.commentMentionPicker = null; return true }
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        const size = picker.candidates.length
        if (!size) return true
        picker.index = (picker.index + (key === 'ArrowDown' ? 1 : -1) + size) % size
        this.$set(this, 'commentMentionPicker', { ...picker }); return true
      }
      if (key === 'Enter' && picker.candidates[picker.index]) { this.chooseDocumentMention(picker.candidates[picker.index]); return true }
      return false
    },
    chooseDocumentMention(candidate) {
      const picker = this.commentMentionPicker
      if (!picker || !documentMentionScope(picker.scope) || (picker.kind === 'reference' ? !candidate?.docId : !candidate?.principalId)) return false
      const edit = picker.scope.startsWith('edit/'), content = edit ? this.commentEditContent : this.commentDocumentDraft
      const label = candidate.displayName || candidate.name || candidate.principalId || candidate.docId
      const marker = picker.kind === 'reference' ? '' : '@', inserted = marker + label, next = content.slice(0, picker.from) + inserted + content.slice(picker.to)
      const shift = inserted.length - (picker.to - picker.from)
      const priorMentions = (edit ? this.commentEditMentions : this.commentDocumentMentions) || [], mentions = [...priorMentions.filter(item => item.to <= picker.from), ...priorMentions.filter(item => item.from >= picker.to).map(item => ({ ...item, from: item.from + shift, to: item.to + shift }))]
      const priorReferences = (edit ? this.commentEditReferences : this.commentDocumentReferences) || [], references = [...priorReferences.filter(item => item.to <= picker.from), ...priorReferences.filter(item => item.from >= picker.to).map(item => ({ ...item, from: item.from + shift, to: item.to + shift }))]
      if (picker.kind === 'reference') references.push({ docId: candidate.docId, from: picker.from, to: picker.from + inserted.length, displayName: label, readable: candidate.readable !== false })
      else mentions.push({ principalId: candidate.principalId, from: picker.from, to: picker.from + inserted.length })
      mentions.sort((left, right) => left.from - right.from); references.sort((left, right) => left.from - right.from)
      if (edit) this.setCommentEditContent(next, mentions, references)
      else this.setCommentDocumentDraft(next, mentions, references)
      this.commentMentionPicker = null; return true
    },
    commentMentionKeydown(threadId, key) {
      const picker = this.commentMentionPicker
      if (!picker || picker.scope || picker.threadId !== threadId) return false
      if (key === 'Escape') { this.commentMentionPicker = null; return true }
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        const size = picker.candidates.length
        if (!size) return true
        picker.index = (picker.index + (key === 'ArrowDown' ? 1 : -1) + size) % size
        this.$set(this, 'commentMentionPicker', { ...picker })
        return true
      }
      if (key === 'Enter' && picker.candidates[picker.index]) { this.chooseCommentMention(picker.candidates[picker.index]); return true }
      return false
    },
    chooseCommentMention(candidate) {
      const picker = this.commentMentionPicker
      if (!picker || picker.scope || !candidate?.principalId || picker.threadId === undefined) return false
      const content = commentDraftText(this.commentDrafts, picker.threadId), label = candidate.displayName || candidate.name || candidate.principalId
      const next = content.slice(0, picker.from) + '@' + label + content.slice(picker.to)
      const shift = ('@' + label).length - (picker.to - picker.from)
      const prior = (this.commentDraftMentions[picker.threadId] || []).filter(item => item.to <= picker.from).map(item => ({ ...item }))
      const suffix = (this.commentDraftMentions[picker.threadId] || []).filter(item => item.from >= picker.to).map(item => ({ ...item, from: item.from + shift, to: item.to + shift }))
      const mention = { principalId: candidate.principalId, from: picker.from, to: picker.from + ('@' + label).length, displayName: label }
      const references = (this.commentDraftReferences[picker.threadId] || []).filter(item => item.to <= picker.from || item.from >= picker.to)
        .map(item => item.from >= picker.to ? { ...item, from: item.from + shift, to: item.to + shift } : { ...item })
      this.setCommentDraft(picker.threadId, next, [...prior, mention, ...suffix], references)
      this.commentMentionPicker = null
      return true
    },
    toggleCommentPrivate(threadId) {
      if (!threadId) return
      const provider = this.commentProvider()
      if (!provider?.isRemote && this.commentThreads.find(thread => thread.id === threadId)?.scope === 'document') {
        if (!this.commentAllowed('visibility', threadId)) return false
        if (typeof provider?.setVisibility !== 'function') { this.commentMessage = '当前本地评论服务不支持更改可见范围'; return false }
        return this.runCommentWrite('setVisibility', { threadId, visibility: this.commentPrivate(threadId) ? 'document' : 'private' }, 'setCommentVisibility')
      }
      if (provider?.isRemote) {
        if (!this.commentAllowed('visibility', threadId)) return null
        return this.runCommentWrite('setVisibility', { threadId, visibility: this.commentPrivate(threadId) ? 'document' : 'private' }, 'setCommentVisibility')
      }
      const on = this.commentPrivateIds.indexOf(threadId) !== -1
      this.commentPrivateIds = on
        ? this.commentPrivateIds.filter((id) => id !== threadId)
        : this.commentPrivateIds.concat([threadId])
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
    commentMenuPosition(event, width, height, localFloating = false) {
      const anchor = event && event.currentTarget
      if ((!this.commentRemote && !localFloating) || !anchor || typeof anchor.getBoundingClientRect !== 'function') return null
      this.updateCommentLayerBounds()
      const rect = anchor.getBoundingClientRect()
      const viewport = this.commentViewport()
      const layerTop = Number.isFinite(this.commentLayerTop) && this.commentLayerTop < viewport.height
        ? this.commentLayerTop : COMMENT_VIEWPORT_MARGIN
      const floor = Math.max(COMMENT_VIEWPORT_MARGIN, Math.min(layerTop, viewport.height - 32))
      return {
        left: Math.max(COMMENT_VIEWPORT_MARGIN, Math.min(rect.right - width, viewport.width - width - COMMENT_VIEWPORT_MARGIN)),
        top: Math.max(floor, Math.min(rect.bottom + 4, viewport.height - height - COMMENT_VIEWPORT_MARGIN)),
      }
    },
    commentFloatingMenuStyle(position) {
      return this.commentRemote && position ? { position: 'fixed', left: `${position.left}px`, top: `${position.top}px`, right: 'auto', maxHeight: `calc(100vh - ${position.top + COMMENT_VIEWPORT_MARGIN}px)`, overflowY: 'auto' } : null
    },
    restoreCommentReplyFocus(threadId, replyId, anchor) {
      const current = this.commentOperationCurrent()
      const root = this.$el, doc = root?.ownerDocument
      const focused = () => {
        const tree = root?.getRootNode?.()
        let active = tree?.activeElement || doc?.activeElement
        while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement
        return tree?.host && active === tree.host ? null : active
      }
      const owner = focused()
      if (!root || (owner && owner !== doc.body && owner !== doc.documentElement && !root.contains(owner))) return
      this.refreshPanels?.()
      this.$nextTick(() => {
        if (!current() || !this.commentCan('canView')) return
        const active = focused()
        if (active && active !== owner && active !== doc.body && active !== doc.documentElement) return
        const thread = [...root.querySelectorAll('[data-comment-thread]')].find(node => node.dataset.commentThread === threadId)
        const reply = thread && [...thread.querySelectorAll('[data-comment-reply]')].find(node => node.dataset.commentReply === replyId)
        const target = anchor?.isConnected && root.contains(anchor) ? anchor : reply?.querySelector('[data-comment-reply-control="more"]')
        target?.focus({ preventScroll: true })
      })
    },
    openCommentReaction(threadId, replyId, event) {
      if (!this.commentAllowed('react', threadId, replyId)) return
      const doc = this.$el?.ownerDocument
      const view = doc?.defaultView || (typeof window !== 'undefined' ? window : null)
      const anchor = event && event.currentTarget
      // 与基线一致：板子贴在锚点上方，本地与远端同一套视口坐标（fixed 定位）。
      const rect = anchor?.getBoundingClientRect?.() || this.$el?.getBoundingClientRect?.()
      const position = rect && view ? {
        left: Math.max(8, Math.min(view.innerWidth - 354, rect.right - 346)),
        top: Math.max(8, Math.min(view.innerHeight - 350, rect.top - 350)),
      } : null
      this.closeCommentMenus()
      this._commentReactionAnchor = anchor
      this.commentReactionContext = { threadId, replyId, position }
      const context = this.commentReactionContext
      // 目录近 1MB：第一次开板才拉，拉到再进 state，板子自己按目录建网格。
      if (!this.commentReactionCatalog) {
        void loadReactionCatalog().then((catalog) => {
          if (this.commentReactionContext !== context) return
          this.commentReactionCatalog = catalog
        }, (error) => {
          if (this.commentReactionContext !== context) return
          this.closeCommentReaction()
          this.error = error?.message || '表情加载失败，请重试'
        })
      }
      // Native DOM hosts do not always flush Vue-style watchers for this
      // transient state. Refresh immediately so a mobile tap mounts the
      // picker before a subsequent pointer/scroll event can dismiss it.
      this.refreshPanels?.()
    },
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
    beginCommentTranslation(threadId, replyId) {
      if (!this.commentCan('canView') || this.commentTranslationBusy) return
      const thread = this.commentThreads.find(item => item.id === threadId && !item.tombstone)
      const reply = thread && thread.replies.find(item => item.id === replyId && !item.tombstone)
      if (!reply) return
      // 飞书：翻译只替换展示，原文留在 provider 记录里。服务只提供一次性译文时直接取，
      // 长任务链路（远端 requestTranslation + 待确认查询）仍走下面的独立面板。
      const provider = this.commentProvider()
      if (typeof provider?.translateReply === 'function' && provider.isRemote !== true) return this.translateCommentReply(threadId, replyId)
      if (this.commentPendingTranslationOperation) { this.commentMessage = '请先查询原翻译请求，避免替换未确认的来源。'; return }
      if (typeof reply.replyRevision !== 'string') return
      this.commentTranslationContext = { threadId, replyId, sourceRevision: reply.replyRevision }
      this.commentTranslationLanguage = 'zh-CN'
      this.commentTranslationState = null
    },
    async translateCommentReply(threadId, replyId) {
      const provider = this.commentProvider(), current = this.commentOperationCurrent()
      const reply = this.commentThreads.find(item => item.id === threadId && !item.tombstone)?.replies.find(item => item.id === replyId && !item.tombstone)
      if (!reply || typeof provider?.translateReply !== 'function') return null
      this.commentTranslationBusy = true
      try {
        const result = await provider.translateReply({ threadId, commentId: replyId, author: this.commentAuthor })
        if (!current() || !this.commentCan('canView') || provider !== this.commentProvider()) return null
        const content = typeof result?.content === 'string' ? result.content : ''
        if (!content) { this.commentMessage = result?.message || '翻译失败，请重试'; return null }
        this.$set(this.commentTranslations, `${threadId}:${replyId}`, { source: reply.content, content })
        return result
      } catch (error) {
        if (!current()) return null
        await this.clearUnavailableCommentView(error)
        if (current() && this.commentCan('canView')) this.commentMessage = error?.code || error?.message || '翻译失败，请重试'
        return null
      } finally { if (current()) this.commentTranslationBusy = false }
    },
  }
  return { methods }
}
