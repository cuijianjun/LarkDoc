/** Private native panel presentation. No model or public command is initialized here. */
import { commentMentionSegments, commentRichContentSegments } from '../../../core/comments/mentions'
import { emojiCategories, searchEmoji, findEmojiByGlyph, normalizeEmojiGlyph } from '../../../core/emoji/catalog'
import { commentTranslationActions } from './commentTranslation'
import { uploadCommentImageFiles as uploadImages, queryPendingCommentImage as queryImage } from './commentImages'

const reactionIsMine = (reaction, author) => typeof reaction?.reactedByMe === 'boolean' ? reaction.reactedByMe : !!reaction?.users?.includes(author?.id)

// A displayed menu belongs to the exact readable reply and identity that opened it.
// Clipboard and confirmation callbacks must not reinterpret an old node as a new actor.
function mobileCommentMenuScope(ed, threadId, replyId) {
  const thread = ed.commentThreads?.find(item => item.id === threadId && !item.tombstone)
  const reply = thread?.replies.find(item => item.id === replyId && !item.tombstone)
  if (!reply || !ed.commentCan('canView')) return null
  const textOf = value => value.richContent ? commentRichContentSegments(value.richContent).map(segment => segment.text).join('') : value.content || ''
  const text = textOf(reply), provider = ed.commentProvider(), session = ed.session
  const current = ed.commentOperationCurrent(), load = ed.commentLoadGeneration, identity = ed.commentIdentityGeneration
  const authorization = session?._authorizationGeneration, publicIdentity = session?._identityGeneration
  const revision = reply.replyRevision, threadRevision = thread.threadRevision, author = reply.author?.id, visibility = thread.visibility
  return { text, key: JSON.stringify([session?.documentId, session?.user?.id, identity, load, authorization, publicIdentity, session?._privateIdentityGeneration, session?._commentGeneration, ed.commentOperationGeneration, revision, threadRevision]),
    current: () => {
      const liveThread = ed.commentThreads?.find(item => item.id === threadId && !item.tombstone)
      const liveReply = liveThread?.replies.find(item => item.id === replyId && !item.tombstone)
      return !!liveReply && current() && identity === ed.commentIdentityGeneration && load === ed.commentLoadGeneration && provider === ed.commentProvider()
        && authorization === session?._authorizationGeneration && publicIdentity === session?._identityGeneration
        && ed.featureEnabled?.('comments') !== false && ed.commentCan('canView')
        && visibility === liveThread.visibility && author === liveReply.author?.id
        && revision === liveReply.replyRevision && threadRevision === liveThread.threadRevision && text === textOf(liveReply)
    } }
}

const MOBILE_COMMENT_ACTIONS = [
  { id: 'reply', label: '回复', icon: 'mode-comment' },
  { id: 'copy', label: '复制', icon: 'copy' },
  { id: 'edit', label: '编辑', icon: 'edit' },
  { id: 'translate', label: '翻译', icon: 'translate' },
  { id: 'delete', label: '删除', icon: 'trash' },
  { id: 'report', label: '举报', glyph: '⚠︎' },
]

const COMMENT_CONTROL_ICONS = Object.freeze({
  'go-next': 'rev-next',
  'go-previous': 'rev-prev',
  copyAnchor: 'link',
  resolve: 'rev-accept',
  more: '',
})

const DOCUMENT_COMMENT_ICONS = [{"viewBox":"0 0 14 14","paths":[{"d":"M1.75 12.833h-.583a.29.29 0 01-.292-.291V4.958a.292.292 0 01.292-.291h.583a.292.292 0 01.292.291v7.584a.292.292 0 01-.292.291zm7-8.167h2.501c1.74 0 2.14 1.536 1.74 2.688l-1.74 4.582a1.237 1.237 0 01-1.196.902H3.204a.293.293 0 01-.292-.291v-7.59a.292.292 0 01.292-.291h.6a.583.583 0 00.477-.248L6.702.973c.164-.26.607-.46 1.078-.246.708.322 1.554 1.025 1.554 2.19 0 .44-.195 1.023-.585 1.749z","rule":null}]},{"viewBox":"0 0 24 24","paths":[{"d":"M16.25 19.511 13.5 22.5c-.401.438-.957.68-1.5.68s-.967-.137-1.523-.68L7.75 19.511 3 19.5c-1.1-.011-2-.9-2-2v-13c0-1.1.9-2 2-2h18c1.1 0 2 .9 2 2v13c0 1.1-.9 1.989-2 2l-4.75.011ZM5.5 10.5v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1a1 1 0 0 0-1-1h-1a1 1 0 0 0-1 1Zm6-1a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1a1 1 0 0 0-1-1h-1Zm5 0a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1a1 1 0 0 0-1-1h-1Z","rule":null}]},{"viewBox":"0 0 24 24","paths":[{"d":"M1 12c0 6.075 4.925 11 11 11s11-4.925 11-11S18.075 1 12 1 1 5.925 1 12Zm14.794-2.674a.994.994 0 0 1 1.405.01.994.994 0 0 1 .01 1.404c-1.888 1.886-3.776 3.77-5.66 5.659a1.001 1.001 0 0 1-1.418 0c-.984-.986-1.97-1.971-2.956-2.956a.993.993 0 0 1 .01-1.403.992.992 0 0 1 1.403-.012l2.252 2.252 4.954-4.954Z","rule":null}]},{"viewBox":"0 0 24 24","paths":[{"d":"M5.5 11.75a1.75 1.75 0 1 1-3.5 0 1.75 1.75 0 0 1 3.5 0Zm8.225 0a1.75 1.75 0 1 1-3.5 0 1.75 1.75 0 0 1 3.5 0Zm8.275 0a1.75 1.75 0 1 1-3.5 0 1.75 1.75 0 0 1 3.5 0Z","rule":null}]}]

const COMMENT_REPLY_ICONS = Object.freeze({ emoji: 'sparkle', quote: 'block-quote', more: '' })

const COMMENT_CONTROL_LABELS = Object.freeze({
  'go-next': '下一条评论',
  'go-previous': '上一条评论',
  copyAnchor: '复制锚点',
  resolve: '解决评论',
  more: '更多',
})

const COMMENT_REPLY_CONTROL_LABELS = Object.freeze({ emoji: '添加表情回复', quote: '引用回复', more: '更多菜单' })

/** Shared model constants and host capability helpers keep their original identity. */
export function createPanelPresentation(dependencies) {
  const { commentModel, supportsDocumentAction, formatDocumentCommentTime, openCommentDocumentTarget } = dependencies
  const { COMMENT_HEIGHTS, COMMENT_CONTROLS, COMMENT_PRIVATE_SWITCH, COMMENT_REPLY_CONTROLS, COMMENT_REPLY_CONTROL_IDS, COMMENT_REPLY_MENU_ITEMS } = commentModel

  const commentPanelComputed = {
  historicalOnly() { return !this.documentOnly && this.ed.commentHistorical === true },
  commentReactionCategories() { return ['常用', '全部', ...emojiCategories] },
  commentReactionItems() {
        const query = this.ed.commentReactionQuery
        if (!query && this.ed.commentReactionCategory === '常用') return ['👍', '❤️', '😄', '👏', '🎉', '👀', '✅', '🙏'].map(findEmojiByGlyph).filter(Boolean)
        return searchEmoji(query, ['常用', '全部'].includes(this.ed.commentReactionCategory) ? undefined : this.ed.commentReactionCategory)
      },
  commentReactionVisibleItems() {
        // Native p6b projection evaluates each getter with an `{ ed }` adapter;
        // read the sibling projection from the editor instead of relying on a
        // Vue computed context that does not exist in the DOM host.
        return (this.ed?.commentReactionItems || this.commentReactionItems || []).slice(0, this.ed.commentReactionLimit)
      },
  commentPanelTitle() {
        return '评论'
      },
  commentPrivateTitle() {
        return COMMENT_PRIVATE_SWITCH.title
      },
  commentPrivateHint() {
        return this.ed.commentRemote ? '开启后，仅提及的协作者、文档所有者、有文档管理权限的用户可见。' : COMMENT_PRIVATE_SWITCH.hint
      },
  commentControls() {
        return COMMENT_CONTROLS.filter(item => !this.historicalOnly || item.id === 'copyAnchor').map((item) => ({
          id: item.id,
          label: COMMENT_CONTROL_LABELS[item.id] || item.id,
          split: item.tone === 'split',
          icon: COMMENT_CONTROL_ICONS[item.id] || '',
          iconSize: item.iconSize,
          tone: item.tone,
        }))
      },
  commentReplyControls() {
        if (this.documentOnly) return [{ id: 'thumb', label: '点赞' }, { id: 'document-reply', label: '回复' }, { id: 'resolve', label: '解决评论' }, { id: 'more', label: '更多' }].map((item, index) => ({ ...item, graphic: DOCUMENT_COMMENT_ICONS[index], iconSize: 14 }))
        return COMMENT_REPLY_CONTROL_IDS.map((id) => ({
          id,
          label: COMMENT_REPLY_CONTROL_LABELS[id] || id,
          icon: COMMENT_REPLY_ICONS[id] || '',
          iconSize: COMMENT_REPLY_CONTROLS.size,
        }))
      },
  commentMenuItems() {
        return COMMENT_REPLY_MENU_ITEMS.map((item) => ({ id: item.id,
          label: this.ed.commentRemote && item.id === 'translate' ? '翻译' : item.label,
          submenu: Boolean(item.submenu) && !(this.ed.commentRemote && item.id === 'translate') }))
      }
  }

  const commentParticipantActions = {
      openCommentParticipants(threadId) {
        if (!this.commentAllowed('participants', threadId)) return null
        this.resetCommentParticipants()
        const thread = this.commentThreads.find(item => item.id === threadId)
        this.commentParticipantThread = threadId; this.commentParticipantRevision = thread.threadRevision
        const authors = [thread.author, ...thread.replies.map(reply => reply.author)].filter(Boolean)
        this.commentParticipantSelection = thread.participants.map(principalId => ({ principalId, displayName: authors.find(author => author.id === principalId)?.name || principalId }))
        this.$nextTick?.(() => this.$el?.querySelector('.lark-doc-comment-member-picker input')?.focus())
        return commentParticipantActions.searchCommentParticipants.call(this)
      },
      setCommentParticipantQuery(value) {
        this.commentParticipantQuery = value; this.commentParticipantCandidates = []; this.commentParticipantIndex = -1
        this._commentParticipantRead = null; this.commentParticipantBusy = false; clearTimeout(this._commentParticipantTimer)
        this._commentParticipantTimer = setTimeout(() => { void commentParticipantActions.searchCommentParticipants.call(this) }, 200)
      },
      async searchCommentParticipants() {
        clearTimeout(this._commentParticipantTimer)
        const threadId = this.commentParticipantThread, session = this.session, query = this.commentParticipantQuery.trim()
        if (!threadId || !this.commentAllowed('participants', threadId) || typeof session?.resolveMentions !== 'function') return null
        const current = this.commentOperationCurrent(), authorizationGeneration = session._authorizationGeneration, revision = this.commentParticipantRevision
        const token = {}; this._commentParticipantRead = token; this.commentParticipantBusy = true; this.commentParticipantError = ''
        const owns = () => current() && token === this._commentParticipantRead && threadId === this.commentMoreThreadId && threadId === this.commentParticipantThread &&
          session === this.session && authorizationGeneration === session._authorizationGeneration && this.commentAllowed('participants', threadId) && query === this.commentParticipantQuery.trim() && this.commentThreads.find(item => item.id === threadId)?.threadRevision === revision
        try {
          const result = await session.resolveMentions({ query })
          if (!owns()) return null
          if (result.status !== 'resolved') { this.commentParticipantError = '人员目录暂不可用，请重试。'; return null }
          this.commentParticipantSelection = this.commentParticipantSelection.map(item => result.candidates.find(candidate => candidate.principalId === item.principalId) || item)
          this.commentParticipantCandidates = result.candidates.filter(item => !this.commentParticipantSelection.some(selected => selected.principalId === item.principalId))
          this.commentParticipantIndex = this.commentParticipantCandidates.length ? 0 : -1
        } catch { if (owns()) this.commentParticipantError = '人员搜索未完成，请重试。' }
        finally { if (token === this._commentParticipantRead) this.commentParticipantBusy = false }
      },
      selectCommentParticipant(candidate) {
        if (!this.commentAllowed('participants', this.commentParticipantThread) || !this.commentParticipantCandidates.some(item => item.principalId === candidate.principalId)) return
        if (!this.commentParticipantSelection.some(item => item.principalId === candidate.principalId)) this.commentParticipantSelection = [...this.commentParticipantSelection, candidate]
        this.commentParticipantCandidates = this.commentParticipantCandidates.filter(item => item.principalId !== candidate.principalId)
        this.commentParticipantIndex = this.commentParticipantCandidates.length ? 0 : -1
      },
      removeCommentParticipant(principalId) {
        if (this.commentAllowed('participants', this.commentParticipantThread)) this.commentParticipantSelection = this.commentParticipantSelection.filter(item => item.principalId !== principalId)
      },
      commentParticipantKeydown(event) {
        const list = this.commentParticipantCandidates
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.resetCommentParticipants(); return }
        if (event.key === 'Enter') { event.preventDefault(); if (list[this.commentParticipantIndex]) commentParticipantActions.selectCommentParticipant.call(this, list[this.commentParticipantIndex]); else void commentParticipantActions.searchCommentParticipants.call(this); return }
        if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); this.commentParticipantIndex = list.length ? (this.commentParticipantIndex + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length : -1 }
      },
      async saveCommentParticipants(threadId) {
        if (threadId !== this.commentParticipantThread || !this.commentAllowed('participants', threadId)) return null
        const thread = this.commentThreads.find(item => item.id === threadId)
        if (thread.threadRevision !== this.commentParticipantRevision) { this.commentParticipantError = '评论已更新，请重新加载参与者后再保存。'; return null }
        const current = this.commentOperationCurrent(), token = this._commentParticipantRead
        const result = await this.setCommentParticipants(threadId, this.commentParticipantSelection.map(item => item.principalId), this.commentParticipantRevision)
        if (result && current() && token === this._commentParticipantRead) this.resetCommentParticipants()
        return result
      },
  }

  const commentPanelMethods = {
  commentMentionSegments,
  onCommentDocumentReferenceClick(event, threadId, replyId, reference) {
        if (!reference.docId) return false
        event.preventDefault(); event.stopPropagation()
        return this.ed.openCommentDocumentReference(threadId, replyId, reference)
      },
  openCommentDocumentReference(threadId, replyId, reference) {
        const thread = this.ed.commentThreads.find(item => item.id === threadId && !item.tombstone), reply = thread?.replies.find(item => item.id === replyId && !item.tombstone)
        if (!reply || !commentMentionSegments(reply.content, reply.mentions, reply.references).some(item => item.docId === reference.docId && item.from === reference.from && item.to === reference.to && item.text === reference.text)) return false
        return openCommentDocumentTarget(this.ed, reference.docId)
      },
  documentCommentTime(at) {
        return formatDocumentCommentTime(at, this.documentCommentNow)
      },
  onDocumentEditInput(draft) {
        if (draft.draftOwner && draft.draftOwner === this.ed.commentEditingReply) this.ed.setCommentEditContent(draft.content, draft.mentions, draft.references)
      },
  onDocumentEditKeydown(event) {
        if (event.key === 'Enter' && !event.defaultPrevented && !event.isComposing && event.keyCode !== 229 && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
          event.preventDefault(); void this.ed.saveEditedComment()
        }
      },
    ...Object.fromEntries(Object.entries(commentParticipantActions).map(([name, action]) => [name, function (...args) { return action.apply(this.ed, args) }])),
    commentStateText(item) { return [item.anchorStatus === 'orphaned' ? (this.ed.commentHistorical && item.anchorReason === 'missing-block' ? '原文已被删除' : '原引用已删除或无法定位') : '', item.resolved ? '已解决，可重开' : '', item.visibility === 'private' ? '私密' : ''].filter(Boolean).join(' · ') },
    submitCommentTranslation() { return commentTranslationActions.submitCommentTranslation.call(this.ed) },
    queryPendingCommentTranslation() { return commentTranslationActions.queryPendingCommentTranslation.call(this.ed) },
    commentTranslationMessage(...args) { return commentTranslationActions.commentTranslationMessage.call(this.ed, ...args) },
    uploadCommentImageFiles(scope, event) { return uploadImages.call(this.ed, scope, event) },
    queryPendingCommentImage() { return queryImage.call(this.ed) },
  commentReactionLabel(emoji) { return findEmojiByGlyph(emoji)?.label || emoji },
  async setCommentReaction(threadId, replyId, emoji, active) {
        if (!this.ed.commentAllowed('react', threadId, replyId)) return null
        const thread = this.ed.commentThreads.find(item => item.id === threadId)
        this.ed.closeCommentReaction()
        const current = this.ed.commentOperationCurrent()
        const result = await this.ed.runCommentWrite('react', { threadId, replyId, emoji: normalizeEmojiGlyph(emoji), active,
          ...(this.ed.commentRemote ? {} : { author: this.ed.commentAuthor }),
          expectedRevision: thread.threadRevision }, 'reactToComment')
        // 冲突只刷新当前视图，绝不根据新版本自动再提交。
        if (!result && current() && this.ed.commentCan('canView') && !this.ed.commentPendingOperation) await this.ed.loadComments().catch(() => {})
        return result
      },
  chooseCommentReaction(emoji) {
        const context = this.ed.commentReactionContext
        if (!context) return
        const reply = this.ed.commentThreads.find(item => item.id === context.threadId)?.replies.find(item => item.id === context.replyId)
        const mine = reactionIsMine(reply?.reactions?.find(item => normalizeEmojiGlyph(item.emoji) === normalizeEmojiGlyph(emoji)), this.ed.commentAuthor)
        return this.ed.setCommentReaction(context.threadId, context.replyId, emoji, !mine)
      },
  mobileCommentMenuItems(thread, reply, scope) {
        const actions = thread.documentOnly || thread.scope === 'document' ? [
          ...MOBILE_COMMENT_ACTIONS.slice(0, 2),
          { id: 'resolve', label: thread.resolved ? '重开评论' : '解决并隐藏', icon: 'rev-accept' },
          MOBILE_COMMENT_ACTIONS[2], { id: 'forward', label: '转发', icon: 'share-link' },
          { id: 'copy-link', label: '复制链接', icon: 'link' }, ...MOBILE_COMMENT_ACTIONS.slice(3),
        ] : MOBILE_COMMENT_ACTIONS
        const ed = this.ed
        return actions.map(action => {
          let reason = !scope?.current() ? '当前无权访问评论或评论已不可用' : ''
          if (!reason && action.id === 'reply' && !ed.commentAllowed(thread.scope === 'document' ? 'create' : 'reply', thread.id)) reason = '当前无回复权限'
          if (!reason && action.id === 'copy' && !scope.text.trim()) reason = '评论没有可复制的文字内容'
          if (!reason && action.id === 'edit' && (!ed.commentAllowed('edit', thread.id, reply.id) || !ed.commentMenuVisible(action, reply, thread.id))) reason = '当前无编辑权限'
          if (!reason && action.id === 'delete' && !ed.commentAllowed('remove', thread.id, reply.id)) reason = '当前无删除权限'
          if (!reason && action.id === 'resolve' && !ed.commentAllowed(thread.resolved ? 'reopen' : 'resolve', thread.id)) reason = '当前无解决评论权限'
          if (!reason && action.id === 'forward') reason = '评论转发服务未接入'
          if (!reason && action.id === 'copy-link' && (ed.commentProvider()?.isRemote !== true || typeof ed.commentProvider()?.getLink !== 'function')) reason = '当前评论服务未提供规范评论链接'
          if (!reason && ['translate', 'report'].includes(action.id)) reason = ed.commentMenuDisabledReason(action, reply)
          return { ...action, mobile: true, visible: true, disabled: !!reason, reason }
        })
      },
  runMobileCommentMenuItem(id, threadId, replyId, scope) {
        const ed = this.ed
        if (!scope?.current()) return false
        const thread = ed.commentThreads.find(item => item.id === threadId), reply = thread?.replies.find(item => item.id === replyId)
        const action = ed.mobileCommentMenuItems(thread, reply, scope).find(item => item.id === id)
        if (!action || action.disabled) return false
        if (id === 'copy') return ed.copyMobileCommentText(scope)
        if (id === 'copy-link') { ed.closeCommentMenus(); return ed.copyRemoteCommentLink(threadId, scope.current) }
        if (id === 'reply') {
          const ownerDocument = ed.$el.ownerDocument, focused = ownerDocument.activeElement
          if (thread.scope === 'document') {
            if (!ed.beginDocumentCommentReply(threadId, replyId)) return false
            ed.commentMobileScope = 'document'; ed.commentHistorical = false
          } else ed.activateComment(threadId)
          ed.closeCommentMenus(); ed.refreshPanels?.()
          ed.$nextTick?.(() => {
            if (!scope.current() || !ed.commentAllowed(thread.scope === 'document' ? 'create' : 'reply', threadId)
              || (ownerDocument.activeElement !== focused && ownerDocument.activeElement !== ownerDocument.body)) return
            const input = thread.scope === 'document' ? ed.$el.querySelector('.lark-doc-document-composer-input')
              : [...ed.$el.querySelectorAll('[data-comment-thread]')].find(node => node.dataset.commentThread === threadId)?.querySelector('[aria-label="回复"]')
            if (input?.isConnected) input.focus()
          })
          return true
        }
        if (id === 'resolve') { ed.closeCommentMenus(); return ed.runCommentControl('resolve', threadId) }
        // Mobile deletion is only reachable through the guarded confirmation below.
        if (id === 'delete') return false
        return ed.runCommentMenuItem(id, threadId, replyId)
      },
  async copyMobileCommentText(scope) {
        const ed = this.ed
        if (!scope?.current() || !scope.text.trim()) return false
        try {
          const clipboard = ed.$el?.ownerDocument.defaultView?.navigator.clipboard
          if (typeof clipboard?.writeText !== 'function') throw new Error('COMMENT_CLIPBOARD_UNAVAILABLE')
          // Keep this first call on the trusted click stack, before any await.
          const pending = clipboard.writeText(scope.text)
          ed.closeCommentMenus()
          await pending
          if (!scope.current()) return false
          ed.setCommentMessage('评论内容已复制。')
          return true
        } catch {
          if (scope.current()) ed.setCommentMessage('复制未完成，请重试或检查剪贴板权限。')
          return false
        }
      },
  requestMobileCommentDelete(threadId, replyId, scope) {
        const ed = this.ed
        if (!scope?.current() || !ed.commentAllowed('remove', threadId, replyId)) return null
        let used = false
        const current = () => !used && scope.current() && ed.commentAllowed('remove', threadId, replyId)
        return { current, confirm() {
          if (!current()) return false
          used = true
          return ed.deleteCommentReply(threadId, replyId)
        } }
      },
  commentMenuVisible(item, reply, threadId) {
        const provider = this.ed.commentProvider()
        if (provider && provider.isRemote && item.id === 'translate') return this.ed.commentCan('canView') && !reply.tombstone
        if (provider && provider.isRemote && ['edit', 'delete'].includes(item.id)) return this.ed.commentAllowed(item.id === 'edit' ? 'edit' : 'remove', threadId, reply.id)
        const meta = COMMENT_REPLY_MENU_ITEMS.find((entry) => entry.id === item.id)
        if (!meta) return true
        const owner = reply && reply.author ? reply.author.id : ''
        const mine = Boolean(owner) && owner === this.ed.commentAuthor.id
        if (meta.ownOnly) return mine
        if (meta.othersOnly) return Boolean(owner) && !mine
        return true
      },
  commentControlDisabled(id, threadId) {
        if (id === 'go-next' || id === 'go-previous') {
          const list = this.ed.commentRemote ? this.ed.commentThreads.filter(thread => !thread.tombstone) : this.ed.commentPanels
          const index = list.findIndex((item) => item.id === threadId)
          if (index === -1) return true
          return id === 'go-next' ? index >= list.length - 1 : index <= 0
        }
        if (id === 'resolve' || id === 'reopen') {
          const thread = (this.ed.commentThreads || []).find(item => item.id === threadId)
          return !this.ed.commentAllowed(thread && thread.resolved ? 'reopen' : id, threadId)
        }
        return false
      }
  ,
  runCommentReplyControl(id, threadId, commentId, event) {
        if (this.documentOnly) {
          event?.stopPropagation?.()
          const thread = this.ed.commentThreads.find(item => item.id === threadId), reply = thread?.replies.find(item => item.id === commentId)
          if (!thread || !reply || this.ed.documentControlDisabled(id, thread, reply)) return
          if (id === 'thumb') return this.ed.setCommentReaction(threadId, commentId, '👍', !reply.reactions?.some(item => normalizeEmojiGlyph(item.emoji) === '👍' && reactionIsMine(item, this.ed.commentAuthor)))
          if (id === 'document-reply') return this.ed.beginDocumentCommentReply(threadId, commentId)
          if (id === 'resolve') return this.ed.runCommentControl('resolve', threadId, event)
        }
        if (id === 'emoji') return this.ed.openCommentReaction(threadId, commentId, event)
        if (id === 'more') return this.ed.toggleCommentReplyMenu(threadId, commentId, event)
        if (id === 'quote' && this.ed.commentRemote && this.ed.commentAllowed('reply', threadId)) {
          const reply = this.ed.commentThreads.find(item => item.id === threadId)?.replies.find(item => item.id === commentId)
          if (!reply || reply.tombstone) return
          this.ed.activateComment(threadId)
          this.ed.setCommentDraft(threadId, `> ${this.ed.commentAuthorName(reply.author)}：${reply.content}\n\n${this.ed.commentDraftOf(threadId)}`)
          this.ed.$nextTick(() => [...this.ed.$el.querySelectorAll('[data-comment-thread]')].find(node => node.dataset.commentThread === threadId)?.querySelector('[aria-label="回复"]')?.focus())
        }
        return undefined
      },
  documentControlDisabled(id, thread, reply) {
        if (reply.tombstone) return true
        if (id === 'thumb') return !this.ed.commentAllowed('react', thread.id, reply.id)
        if (id === 'document-reply') return !this.ed.commentAllowed('create')
        if (id === 'resolve') return !this.ed.commentAllowed(thread.resolved ? 'reopen' : 'resolve', thread.id)
        return !this.ed.commentCan('canView')
      },
  documentControlLabel(control, thread, reply) {
        if (control.id === 'thumb' && reply.reactions?.some(item => normalizeEmojiGlyph(item.emoji) === '👍' && reactionIsMine(item, this.ed.commentAuthor))) return '取消点赞'
        if (control.id === 'resolve' && thread.resolved) return '重开评论'
        return control.label
      },
  runCommentMenuItem(id, threadId, commentId) {
        const reply = this.ed.commentThreads?.find(item => item.id === threadId && !item.tombstone)?.replies.find(item => item.id === commentId)
        const reason = this.ed.commentMenuDisabledReason({ id }, reply)
        if (reason) { this.ed.commentMessage = reason; return false }
        this.ed.closeCommentMenus()
        if (id === 'report') return this.ed.reportCommentReply(threadId, commentId)
        if (id === 'delete') return this.ed.deleteCommentReply(threadId, commentId)
        if (id === 'edit') return this.ed.beginEditComment(threadId, commentId)
        if (id === 'translate' && this.ed.commentRemote) return this.ed.beginCommentTranslation(threadId, commentId)
        return undefined
      },
  commentMenuDisabledReason(item, reply) {
        if (!['translate', 'report'].includes(item.id)) return ''
        const ed = this.ed
        if (!ed.commentCan('canView')) return '当前无权访问评论'
        if (!reply || reply.tombstone) return '评论已不可用'
        if (item.id === 'translate') {
          const provider = ed.commentProvider()
          if (provider?.isRemote !== true || typeof provider.requestTranslation !== 'function') return '当前评论服务未接通翻译'
          if (typeof reply.replyRevision !== 'string') return '评论来源修订不可用'
          if (ed.commentTranslationBusy) return '翻译请求处理中'
          if (ed.commentPendingTranslationOperation) return '请先查询原翻译请求'
          return ''
        }
        if (!reply.author?.id) return '无法识别评论作者'
        if (reply.author.id === ed.commentAuthor?.id) return '不能举报自己的评论'
        return supportsDocumentAction(ed, 'report-comment') ? '' : '举报服务未接入'
      },
  /** 菜单项是否置灰：只看本作用域是否具备该能力；逐条回复的具体原因走 `commentMenuDisabledReason`。 */
  commentMenuDisabled(item) {
    const ed = this.ed
    if (item.id === 'report') return !supportsDocumentAction(ed, 'report-comment')
    if (item.id === 'translate') {
      const provider = ed.commentProvider()
      return !(provider?.isRemote === true && typeof provider.requestTranslation === 'function')
    }
    return false
  },
  async reportCommentReply(threadId, replyId) {
        const ed = this.ed, handler = ed.onDocumentAction
        const thread = ed.commentThreads?.find(item => item.id === threadId)
        const reply = thread?.replies.find(item => item.id === replyId)
        if (!supportsDocumentAction(ed, 'report-comment') || !ed.commentCan('canView') || !reply || thread.tombstone || reply.tombstone ||
            !reply.author?.id || reply.author.id === ed.commentAuthor.id) return false
        const current = ed.commentOperationCurrent(), auth = ed.session?._authorizationGeneration
        try {
          const result = await handler(Object.freeze({ action: 'report', target: 'comment', documentId: ed.session?.documentId ?? null,
            actorId: ed.session?.user?.id ?? null, threadId, replyId }))
          return result !== false && current() && handler === ed.onDocumentAction && auth === ed.session?._authorizationGeneration && ed.commentCan('canView')
        } catch {
          if (current() && handler === ed.onDocumentAction && auth === ed.session?._authorizationGeneration && ed.commentCan('canView')) ed.commentMessage = '暂时无法打开举报，请稍后重试。'
          return false
        }
      },
  runCommentControl(id, threadId, event) {
        if (id === 'go-next' || id === 'go-previous') event?.stopPropagation?.()
        if (id === 'go-next') return this.ed.goComment(threadId, 1)
        if (id === 'go-previous') return this.ed.goComment(threadId, -1)
        if (id === 'resolve') {
          const thread = (this.ed.commentThreads || []).find(item => item.id === threadId)
          return thread && thread.resolved ? this.ed.reopenComment(threadId) : this.ed.resolveComment(threadId)
        }
        if (id === 'reopen') return this.ed.reopenComment(threadId)
        if (id === 'copyAnchor') return this.ed.copyCommentAnchor(threadId)
        if (id === 'more') return this.ed.toggleCommentMoreMenu(threadId, event)
        return undefined
      },
  copyCommentAnchor(threadId) {
        if (this.ed.commentRemote) return this.ed.copyRemoteCommentLink(threadId)
        const item = (this.ed.commentThreads || []).find((thread) => thread.id === threadId)
        const text = item ? this.ed.commentQuoteOf(item) : ''
        if (!text) return false
        const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : null
        if (!clipboard || typeof clipboard.writeText !== 'function') return false
        clipboard.writeText(text).catch(() => {})
        return true
      },
  commentTextareaHeight(item) {
        return this.ed.commentHasDraft(item.id) ? COMMENT_HEIGHTS.textareaActive + (this.ed.commentDraftImages(item.id).length ? 88 : 0) : COMMENT_HEIGHTS.textarea
      }
  ,
  chooseCommentImageFile(scope) {
        if (!this.ed.commentCanUploadImage(scope)) return
        const input = [...this.ed.$el.querySelectorAll('input[data-comment-image-scope]')].find(node => node.dataset.commentImageScope === scope)
        if (input) input.click()
      },
  commentAuthorInitial(author) { return this.ed.commentAuthorName(author).slice(0, 1).toUpperCase() }
  ,
  async copyRemoteCommentLink(threadId, menuCurrent = () => true) {
        const provider = this.ed.commentProvider()
        const generation = this.ed.commentLoadGeneration
        const current = () => menuCurrent() && !this.ed.commentDisposed && generation === this.ed.commentLoadGeneration && provider === this.ed.commentProvider() && this.ed.commentCan('canView')
        try {
            const link = this.ed.session && typeof this.ed.session.getCommentLink === 'function'
              ? await this.ed.session.getCommentLink(threadId) : await provider.getLink(threadId)
            if (!current()) return false
            if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') throw new Error('COMMENT_CLIPBOARD_UNAVAILABLE')
            await navigator.clipboard.writeText(link)
            if (current()) this.ed.setCommentMessage('评论链接已复制；打开时会重新检查权限。')
            return true
        } catch (error) {
            if (!current()) return false
            await this.ed.clearUnavailableCommentView(error)
            if (current()) this.ed.setCommentMessage(error.code === 'COMMENT_DOCUMENT_URL_REQUIRED' ? '请由宿主配置当前文档的规范链接。' : '评论不可见、无权访问或链接无法复制。')
            return false
        }
      }
  }

  const methods = {
    /** handler 全表（键名与 `src/ui/panels.js` 里的 `call('onXxx')` 一一对应）。 */
    panelsHandlers() {
      return {
        outline: {
          onToggleOpen: () => this.toggleOutlineOpen(),
          onToggle: (pos) => this.toggleOutline(pos),
          onJump: (pos) => this.jumpHeading(pos),
        },
        version: {
          // 唯一关闭出口：`Esc` 在这条线上是「拦冒泡」而不是关闭（SFC 头负结论 1）。
          onClose: () => this.closeVersionPanel(),
          onRestore: () => this.requestVersionRestore(),
          onCancelRestore: () => this.closeVersionRestoreConfirm(),
          onConfirmRestore: () => this.confirmVersionRestore(),
          onPrev: () => this.versionPrev(),
          onNext: () => this.versionNext(),
          onChangePrev: () => this.stepVersionChange(-1),
          onChangeNext: () => this.stepVersionChange(1),
          onToggleShowChanges: () => this.toggleVersionShowChanges(),
          onSelect: (id) => this.selectVersion(id),
          onOpenTrash: () => this.openVersionTrash(),
          onCloseTrash: () => this.closeVersionTrash(),
          onRestoreDeleted: (id) => this.restoreDeletedVersion(id),
          onPurgeDeleted: (id) => this.purgeDeletedVersion(id),
        },
        versionToast: {
          // 提示里的「立即查看」：先开面板再收提示（与模板里的内联两调用顺序一致）。
          onNoticeLink: () => { this.openVersionPanel(); this.dismissVersionNotice() },
        },
        comment: {
          onActivate: (id) => this.activateComment(id),
          onLocate: id => {
            const thread = this.commentThreads.find(item => item.id === id && item.bound)
            if (thread && this.commentCan('canView')) { this.activateComment(id); this.scrollCommentIntoView(thread.blockId) }
          },
          onControl: (controlId, threadId) => this.runCommentControl(controlId, threadId),
          onReplyControl: (ctlId, threadId, replyId, event) => {
            // The native renderer owns the DOM event. Keep the reaction path
            // direct so the picker is opened on the editor host even when the
            // p6b adapter is evaluating the other panel actions.
            if (ctlId === 'emoji') return this.openCommentReaction(threadId, replyId, event)
            if (ctlId === 'quote' && this.commentThreads.some(thread => thread.id === threadId && thread.scope === 'document')) return this.quoteDocumentComment(threadId, replyId)
            return this.runCommentReplyControl(ctlId, threadId, replyId, event)
          },
          onMenuItem: (menuId, threadId, replyId) => this.runCommentMenuItem(menuId, threadId, replyId),
          onMobileMenuItem: (menuId, threadId, replyId, scope) => this.runMobileCommentMenuItem(menuId, threadId, replyId, scope),
          onRequestDelete: (threadId, replyId, scope) => this.requestMobileCommentDelete(threadId, replyId, scope),
          onDocumentReference: (threadId, replyId, reference, event) => this.openCommentDocumentReference(threadId, replyId, reference, event),
          onReaction: (threadId, replyId, emoji, active) => this.setCommentReaction(threadId, replyId, emoji, active),
          onChooseReaction: emoji => this.chooseCommentReaction(emoji),
          onReactionQuery: value => this.setCommentReactionQuery(value),
          onReactionCategory: value => this.setCommentReactionCategory(value),
          onMoreReaction: () => this.showMoreCommentReactions(),
          onCloseReaction: restoreFocus => this.closeCommentReaction(restoreFocus),
          onEditDraft: (threadId, replyId, value, event) => {
            const current = this.commentEditingReply
            if (current && current.threadId === threadId && current.replyId === replyId) {
              try { this.setCommentEditContent(value, event?.commentDraft?.mentions || this.commentEditMentions, event?.commentDraft?.references || this.commentEditReferences) }
              catch { this.setCommentEditContent(value) }
              void this.updateDocumentMentionPicker?.(`edit/${threadId}/${replyId}`, value, event?.commentDraft?.caret ?? event?.target?.selectionStart)
            }
          },
          onDocumentMentionKeydown: (scope, key) => this.documentMentionKeydown?.(scope, key),
          onRetryDocumentMention: scope => this.retryCommentMentionPicker?.(scope),
          onChooseDocumentMention: candidate => this.chooseDocumentMention?.(candidate),
          onCancelEdit: () => this.cancelCommentEdit(),
          onSaveEdit: () => this.saveEditedComment(),
          onTranslationLanguage: value => this.setCommentTranslationLanguage(value),
          onCloseTranslation: () => this.closeCommentTranslation(),
          onSubmitTranslation: () => this.submitCommentTranslation(),
          onQueryTranslation: () => this.queryPendingCommentTranslation(),
          onDraft: (threadId, value, event) => {
            this.setCommentDraft(threadId, value, event?.commentDraft?.mentions, event?.commentDraft?.references)
            void this.updateCommentMentionPicker?.(threadId, value, event?.commentDraft?.caret ?? event?.target?.selectionStart)
          },
          onMentionKeydown: (threadId, key) => this.commentMentionKeydown?.(threadId, key),
          onChooseMention: candidate => this.chooseCommentMention?.(candidate),
          onClearDraft: (threadId) => this.clearCommentDraft(threadId),
          onSubmit: (threadId) => this.submitCommentDraft(threadId),
          onTogglePrivate: (threadId) => this.toggleCommentPrivate(threadId),
          onCloseMenus: context => {
            this.closeCommentMenus()
            if (context?.restoreFocus) this.restoreCommentReplyFocus(context.threadId, context.replyId)
          },
          onToggleSidebar: () => {
            if (this.commentSidebarOpen || (this.commentProvider?.() && this.commentCan?.('canView') === true && this.featureEnabled?.('comments') !== false)) {
              if (this._mobileEditorMedia?.matches && !this.commentSidebarOpen) this.commentActiveThreadId = ''
              this.toggleCommentSidebar()
            }
          },
          onDocumentLike: () => this.toggleDocumentCommentLike(),
          onBackToTop: () => this.$refs.root?.querySelector('.lark-doc-main')?.scrollTo?.({ top: 0, behavior: 'smooth' }),
          onCloseMobile: () => { this.commentSidebarOpen = false; this.commentMobileOpen = false; this.closeCommentMenus() },
          onToggleHistory: () => this.setCommentHistory(!this.commentHistory),
          onComposerDraft: value => this.setCommentCreateDraft(value),
          onComposerCancel: () => this.closeCommentComposer(),
          onComposerPrivate: value => this.setCommentCreatePrivate(value),
          onComposerSubmit: () => this.createCommentFromSelection(this.commentCreateDraft, this.commentCreatePrivate ? 'private' : 'document'),
          onDocumentComposerDraft: (value, event) => {
            try {
              this.setCommentDocumentDraft(value, event?.commentDraft?.mentions || this.commentDocumentMentions, event?.commentDraft?.references || this.commentDocumentReferences)
              void this.updateDocumentMentionPicker?.('document', value, event?.commentDraft?.caret ?? event?.target?.selectionStart)
            }
            catch { this.setCommentDocumentDraft(value, [], []) }
          },
          onDocumentComposerCancel: () => this.cancelDocumentCommentDraft(),
          onDocumentComposerPrivate: value => this.setCommentCreatePrivate(value),
          onDocumentComposerSubmit: () => this.submitDocumentComment(this.commentCreatePrivate ? 'private' : 'document'),
          onChooseImage: (scope) => {
            if (!this.commentCanUploadImage?.(scope)) return
            const input = [...(this.$el?.querySelectorAll?.('input[data-comment-image-scope]') || [])].find(node => node.dataset.commentImageScope === scope)
            input?.click()
          },
          onUploadImage: (scope, event) => this.uploadCommentImageFiles(scope, event),
          onRemoveDraftImage: (scope, assetId) => this.removeCommentDraftImage(scope, assetId),
          onOpenImage: (threadId, replyId, assetId, event) => {
            const thread = this.commentThreads.find(item => item.id === threadId && !item.tombstone)
            const reply = thread?.replies.find(item => item.id === replyId && !item.tombstone)
            const asset = reply?.attachments?.find(item => item.assetId === assetId)
            if (asset && this.commentCan('canView')) this.openCommentImage(thread, reply, asset, event)
          },
          onCloseImage: restoreFocus => this.closeCommentImage(restoreFocus),
          onCancelImageUpload: () => this.cancelCommentImageUpload(),
          onQueryImage: () => this.queryPendingCommentImage(),
        },
      }
    },
  buildVersionState() {
        const error = this.versionError || ''
        const total = this.versionTotal
        const loading = !!this.versionLoading
        const selected = this.versionSelected
        const preview = this.versionPreview
        const contextKey = JSON.stringify([this.session?.documentId, this.session?._versioningProviderGeneration, this.session?._authorizationGeneration, this.session?._privateIdentityGeneration])
        const readable = !this.session?.can || this.session.can('canView')
        const current = !preview?.readScope || preview.readScope === contextKey
        const diff = this.versionSelectedDiff
        const restoreDisabled = !!this.versionRestoreDisabled || this.session?.can?.('canRestoreVersion') === false
        const prevDisabled = !!this.versionPrevDisabled
        const nextDisabled = !!this.versionNextDisabled
        return {
          open: !!this.versionPanelOpen && readable && current,
          kind: this.versionPanelKind,
          contextKey,
          previewPolicyKey: JSON.stringify(this.larkDocConfig?.network || {}),
          restoreConfirm: {
            open: !!this.versionRestoreConfirmOpen && readable && current && !restoreDisabled,
            text: this.versionRestoreConfirmText,
            disabled: restoreDisabled,
          },
          trash: {
            open: !!this.versionTrashOpen,
            busy: !!this.versionTrashBusy,
            canManage: !!this.versionCanManageTrash,
            reason: this.versionTrashReason,
            items: (this.versionDeletedList || []).map(item => ({
              id: item.id,
              name: this.versionItemName(item),
              label: item.label,
            })),
          },
          restore: {
            disabled: restoreDisabled,
            // `:title="ed.versionCanRestoreReason"` —— 允许时是空串（属性在、值为空）。
            title: this.versionCanRestoreReason,
            style: this.versionDisabledStyle(restoreDisabled),
          },
          pager: {
            cursor: this.versionCursorLabel,
            prev: { disabled: prevDisabled, style: this.versionDisabledStyle(prevDisabled) },
            next: { disabled: nextDisabled, style: this.versionDisabledStyle(nextDisabled) },
          },
          // 底栏「显示更改」是开关，不是文案（飞书默认开）。
          showChanges: this.versionShowChanges !== false,
          // 左栏三选一：错误 > 空态 > 预览（`v-if` / `v-else-if` / `v-else` 的顺序）。
          view: error ? 'error' : (total ? 'preview' : 'empty'),
          errorText: error,
          emptyText: loading ? '正在载入历史记录…' : '暂无历史版本',
          preview: total ? this.buildVersionPreviewState(selected, preview, diff) : null,
          // 右栏时间线：错误时只留一条降级文案（`v-else` 挂在 for 上）。
          timelineError: error,
          days: error ? [] : (this.versionDayGroups || []).map((group) => ({
            key: group.key,
            label: group.label,
            items: (group.items || []).map((item) => ({
              id: item.id,
              cls: this.versionTimelineClass(item).selected ? 'selected' : '',
              name: this.versionItemName(item),
              // 飞书条目是三行：时间 / 「最近更新」绿标 + 改动描述 / 作者。
              badge: this.versionItemBadge(item),
              desc: this.versionItemDesc(item),
              user: this.versionActorLabel(item),
            })),
          })),
        }
      },

  buildVersionPreviewState(selected, preview, diff) {
        const meta = [this.versionItemName(selected), this.versionActorLabel(selected)]
        if (preview) meta.push(`二进制快照 ${preview.byteLength} 字节`)
        if (preview && Number.isInteger(preview.blockCount)) meta.push(`${preview.blockCount} 个块`)
        let row = ''
        if (diff && diff.blockCount) {
          const { prev, next, delta } = diff.blockCount
          row = `块数 ${prev} → ${next} （${delta >= 0 ? '+' : ''}${delta}）`
        }
        return {
          title: (preview && preview.label) || '未命名版本',
          id: preview?.id || '',
          document: preview?.document || null,
          changes: this.versionChanges || [],
          changeIndex: this.versionChangeIndex || 0,
          changeCursor: this.versionChangeCursor || '编辑记录 0/0',
          changesLoading: !!this.versionChangesLoading,
          changesError: this.versionChangesError || '',
          kind: this.versionKindLabel(selected && selected.kind),
          meta,
          degraded: this.versionPreviewError || '',
          diff: diff ? { row } : null,
          // 有载荷才给文案；空串 = 走「该版本没有可取回的正文」那条兜底。
          payload: preview && preview.hasPayload && !preview.document
            ? `该版本正文为二进制快照（${preview.byteLength} 字节），需由协同运行时解码后才能渲染。`
            : '',
        }
      },

  buildCommentState() {
        const imageScope = this.imageCommentCurrent?.() ? this._imageCommentScope : null
        const inViewer = !!imageScope?.viewer
        const panels = imageScope ? (this.commentPanels || []).filter(item => item.blockId === imageScope.blockId)
          : [...(this.commentPanels || []), ...(this.commentDocumentThreads || []).map(item => ({ ...item, documentOnly: true }))]
        const controls = this.commentControls || []
        const menus = this.commentMenuItems || []
        const remote = this.commentRemote === true
        const sidebarOpen = !!imageScope || (remote || this._mobileEditorMedia?.matches ? this.commentSidebarOpen === true : panels.length > 0 || this.commentComposerOpen === true)
        const historical = !imageScope && this.commentHistorical === true
        const drawer = !inViewer && this._mobileEditorMedia?.matches && sidebarOpen && this.commentMobileScope === 'selection' && !this.commentComposerOpen && !historical
        const documentInline = !imageScope && !historical && this.featureEnabled?.('comments') !== false && this.commentCan?.('canView') === true && (remote || !!this.commentProvider?.())
        const emptyText = remote && sidebarOpen && !panels.length && !this.commentComposerOpen
          ? (historical ? '暂无历史评论' : this.commentHistory ? '暂无已解决评论' : '暂无选区评论，选中文字即可发表评论。') : ''
        const reactionPicker = this.commentReactionContext ? {
          open: true,
          position: this.commentReactionContext.position || null,
          query: this.commentReactionQuery || '',
          category: this.commentReactionCategory || '常用',
          categories: this.commentReactionCategories || [],
          items: this.commentReactionVisibleItems || [],
          limit: this.commentReactionLimit || 120,
        } : { open: false }
        // 进入“全文评论”侧栏后即显示空态输入框；草稿/回复目标只决定
        // 操作区是否出现，不能把输入入口本身隐藏掉。
        const documentComposerOpen = !imageScope && !historical && (sidebarOpen || documentInline) && !this.commentComposerOpen
        const root = this.$refs?.root, rootBounds = root?.getBoundingClientRect(), win = root?.ownerDocument.defaultView
        const header = root?.querySelector('.lark-doc-topbar'), headerBounds = header?.getBoundingClientRect()
        const headerStyle = header && win?.getComputedStyle?.(header)
        const headerVisible = header && !header.hidden && headerBounds?.height > 0 && headerStyle?.display !== 'none' && headerStyle?.visibility !== 'hidden'
        return {
          open: sidebarOpen,
          viewerHost: imageScope?.viewer || null, viewerCurrent: imageScope ? () => this.imageCommentCurrent(imageScope) : null,
          remote,
          documentInline,
          historical,
          launcher: { visible: !imageScope && !!this._mobileEditorMedia?.matches && !!this.commentProvider?.() && this.commentCan?.('canView') === true && this.featureEnabled?.('comments') !== false,
            top: Math.max(0, headerVisible ? headerBounds.bottom : rootBounds?.top || 0),
            right: Math.max(0, (win?.innerWidth || 0) - (rootBounds?.right || win?.innerWidth || 0)) },
          like: { ...(this.commentDocumentLike || {}), available: this.commentProvider?.() && this.commentCan?.('canView') === true
            && this.session?.getProvider?.('authorization')?.isRemote === true && typeof this.session?.getProvider?.('authorization')?.documentInformation === 'function' },
          identityGeneration: this.commentIdentityGeneration || 0,
          mobileScope: historical || this.commentComposerOpen ? 'selection' : this.commentMobileScope || 'document',
          mobileOpen: remote ? sidebarOpen : this.commentMobileOpen || !!this.commentComposerOpen,
          activeThreadId: this.commentActiveThreadId || '',
          sidebarOpen,
          title: imageScope ? '图片评论' : this._mobileEditorMedia?.matches ? `${this.commentPanelTitle || '评论'} (${panels.filter(item => !item.documentOnly).length})` : this.commentPanelTitle,
          controls,
          replyControls: this.commentReplyControls || [],
          moreTitle: this.commentPrivateTitle,
          moreHint: this.commentPrivateHint,
          emptyText,
          message: this.commentCan('canView') ? this.commentMessage || '' : '',
          imageViewer: this.commentImageViewer,
          imageStatus: { busy: this.commentImageBusy, pending: !!this.commentPendingImage,
            canCancel: this.commentImageCanCancel?.() === true, canQuery: !this.commentImageBusy && this.commentCan('canView') },
          reactionPicker,
          translationRecovery: { pending: !!this.commentPendingTranslationOperation && !panels.some(item => item.id === this.commentTranslationContext?.threadId),
            canQuery: !this.commentTranslationBusy && this.commentCan('canView') },
          documentComposer: {
            open: documentComposerOpen,
            value: this.commentDocumentDraft || '',
            mentions: this.commentDocumentMentions || [],
            references: this.commentDocumentReferences || [],
            segments: commentMentionSegments(this.commentDocumentDraft || '', this.commentDocumentMentions || [], this.commentDocumentReferences || []),
            draftImages: this.commentDraftImages('document'),
            hasImages: this.commentDraftImages('document').length > 0,
            canUploadImage: this.commentCanUploadImage?.('document') === true,
            readonly: this.commentDocumentCanSubmit?.() === false || !this.commentAllowed('create'),
            canSubmit: this.commentDocumentCanSubmit?.() !== false && this.commentAllowed('create'),
            privateOn: this.commentCreatePrivate === true,
            replyTarget: this.commentDocumentReplyTarget,
            mentionPicker: this.commentMentionPicker?.scope === 'document' ? { query: this.commentMentionPicker.query, candidates: this.commentMentionPicker.candidates, index: this.commentMentionPicker.index, status: this.commentMentionPicker.status, operationId: this.commentMentionPicker.operationId } : null,
          },
          composer: {
            open: this.commentComposerOpen === true,
            quote: this.commentComposerContext?.text || '',
            author: this.commentAuthorName(this.commentAuthor),
            value: this.commentCreateDraft || '',
            draftImages: this.commentDraftImages('selection'),
            hasImages: this.commentDraftImages('selection').length > 0,
            canUploadImage: this.commentCanUploadImage?.('selection') === true,
            readonly: !this.commentAllowed('create') || (!!imageScope && !this.writable()),
            canSubmit: this.commentAllowed('create') && (!imageScope || this.writable()),
            privateOn: this.commentCreatePrivate === true,
            history: this.commentHistory || historical ? (historical || this.commentHistory ? '返回未解决' : '已解决评论') : '已解决评论',
          },
          items: panels.map((item) => ({
            id: item.id,
            // 一次合成（SFC 是数组合并语义，`applyStyle` 是替换语义）。
            style: {
              ...(item.documentOnly || inViewer ? { position: 'relative', left: 'auto', top: 'auto', height: 'auto', ...(inViewer ? { width: '100%', margin: '0' } : {}) } : this.commentPanelStyle(item)),
              ...(item.documentOnly || inViewer ? {} : { height: `${this.commentPanelHeightOf(item)}px` }),
              ...(drawer && !item.documentOnly ? { marginTop: `${item.gap || 0}px` } : {}),
            },
            documentOnly: item.documentOnly === true,
            quote: item.documentOnly ? '' : this.commentQuoteOf(item),
            // 置灰而不是隐藏：无权限的按钮照挂，加 `is-disabled`。
            disabled: controls
              .filter((control) => !control.split && this.commentControlDisabled(control.id, item.id))
              .map((control) => control.id),
            edit: (() => {
              const value = this.commentEditingReply && this.commentEditingReply.threadId === item.id
                ? this.commentEditingReply : null
              if (!value) return null
              return {
                replyId: value.replyId,
                value: this.commentEditContent || '',
                segments: commentMentionSegments(this.commentEditContent || '', this.commentEditMentions || [], this.commentEditReferences || []),
                mentions: this.commentEditMentions || [],
                references: this.commentEditReferences || [],
                draftImages: this.commentDraftImages('edit/' + item.id + '/' + value.replyId),
                mentionPicker: this.commentMentionPicker?.scope === `edit/${item.id}/${value.replyId}` ? { query: this.commentMentionPicker.query, candidates: this.commentMentionPicker.candidates, index: this.commentMentionPicker.index, status: this.commentMentionPicker.status, operationId: this.commentMentionPicker.operationId } : null,
                canUploadImage: this.commentCanUploadImage?.('edit/' + item.id + '/' + value.replyId) === true,
                readonly: !this.commentAllowed('edit', item.id, value.replyId),
              }
            })(),
            translation: (() => {
              const context = this.commentTranslationContext && this.commentTranslationContext.threadId === item.id ? this.commentTranslationContext : null
              if (!context) return null
              const state = this.commentTranslationState && this.commentTranslationIsCurrent?.(this.commentTranslationState) ? this.commentTranslationState : null
              return {
                ...context,
                language: this.commentTranslationLanguage || '',
                busy: this.commentTranslationBusy === true,
                pending: !!this.commentPendingTranslationOperation,
                current: this.commentTranslationIsCurrent?.(context) !== false,
                status: state?.status || '',
                message: state ? this.commentTranslationMessage?.(state) : '',
                translatedText: state?.status === 'ready' ? state.translatedText || '' : '',
              }
            })(),
            replies: (item.replies || []).map((reply) => {
              const menuScope = this._mobileEditorMedia?.matches ? mobileCommentMenuScope(this, item.id, reply.id) : null
              return ({
              mobileMenu: !!this._mobileEditorMedia?.matches,
              menuScope,
              quickReactions: menuScope ? ['👍', '❤️', '😄', '👏', '🎉', '👀'].map(findEmojiByGlyph).filter(Boolean).map(emoji => ({
                emoji: emoji.glyph, label: emoji.label,
                active: reactionIsMine(reply.reactions?.find(reaction => normalizeEmojiGlyph(reaction.emoji) === normalizeEmojiGlyph(emoji.glyph)), this.commentAuthor),
              })) : [],
              id: reply.id,
              tombstone: reply.tombstone === true,
              canReact: this.commentAllowed('react', item.id, reply.id),
              reactionDisabledReason: this.commentAllowed('react', item.id, reply.id) ? '' : '当前无表情回复权限或评论服务不可用',
              canReply: this.commentAllowed('reply', item.id),
              name: this.commentAuthorName(reply.author),
              time: this.commentTimeAt(reply.createdAt),
              body: reply.content,
              richSegments: !reply.tombstone && reply.richContent ? commentRichContentSegments(reply.richContent) : null,
              segments: reply.tombstone ? [{ text: '评论已删除' }] : commentMentionSegments(reply.content || '', reply.mentions || [], reply.references || []).map(segment => ({
                ...segment,
                ...(segment.principalId ? { isSelf: segment.principalId === this.commentAuthor?.id } : {}),
              })),
              edited: reply.editedAt != null,
              reactions: reply.tombstone ? [] : (reply.reactions || []).map(reaction => ({
                ...reaction,
                count: reaction.count ?? (Array.isArray(reaction.users) ? reaction.users.length : 0),
                reactedByMe: typeof reaction.reactedByMe === 'boolean' ? reaction.reactedByMe : !!reaction.users?.includes(this.commentAuthor?.id),
                label: this.commentReactionLabel?.(reaction.emoji) || reaction.emoji,
                canReact: this.commentAllowed('react', item.id, reply.id),
                people: Array.isArray(reaction.users) ? reaction.users.map(id => id === this.commentAuthor?.id ? this.commentAuthorName(this.commentAuthor) : id === reply.author?.id ? this.commentAuthorName(reply.author) : id).join('、') : '',
              })),
              editing: !!this.commentEditingReply && this.commentEditingReply.threadId === item.id && this.commentEditingReply.replyId === reply.id,
              images: reply.tombstone ? [] : (reply.attachments || []).map(asset => ({
                assetId: asset.assetId, fileName: asset.fileName,
                url: this.commentImageUrl(item, reply, asset),
                error: !!this.commentImageErrors[this.commentImageKey(item, reply, asset)],
              })),
              menuOpen: this.commentMenuThreadId === item.id && this.commentMenuCommentId === reply.id,
              menus: this._mobileEditorMedia?.matches ? this.mobileCommentMenuItems(item, reply, menuScope) : menus.map((menu) => {
                // 置灰有两层：作用域能力（`commentMenuDisabled`）与**这一条**回复的具体原因
                // （`commentMenuDisabledReason`：举报自己、翻译服务未接通…）。只取前者的话，
                // 后者只能挂在 title 上 —— 菜单看着可点，`runCommentMenuItem` 却在点下去之后
                // 才拦下来，等于把「为什么不能点」放在动作之后说。
                const reason = this.commentMenuDisabledReason?.(menu, reply) || ''
                return {
                  id: menu.id,
                  label: menu.label,
                  submenu: !!menu.submenu,
                  visible: this.commentMenuVisible(menu, reply, item.id),
                  disabled: reason !== '' || this.commentMenuDisabled?.(menu, reply) === true,
                  reason,
                }
              }),
            }) }),
            textarea: {
              value: this.commentDraftOf(item.id),
              mentions: this.commentDraftMentions?.[item.id] || [],
              references: this.commentDraftReferences?.[item.id] || [],
              readonly: !this.commentAllowed('reply', item.id),
              height: this.commentTextareaHeight(item),
            },
            draftImages: this.commentDraftImages(item.id),
            hasDraft: this.commentHasDraft(item.id),
            mentionPicker: this.commentMentionPicker && !this.commentMentionPicker.scope && this.commentMentionPicker.threadId === item.id ? {
              query: this.commentMentionPicker.query,
              candidates: this.commentMentionPicker.candidates,
              index: this.commentMentionPicker.index,
              status: this.commentMentionPicker.status,
              operationId: this.commentMentionPicker.operationId,
            } : null,
            allowedReply: this.commentAllowed('reply', item.id),
            canUploadImage: this.commentCanUploadImage?.(item.id) !== false,
            moreOpen: this.commentMoreThreadId === item.id,
            privateOn: this.commentPrivate(item.id),
            privateEnabled: item.scope !== 'document' || remote || typeof this.commentProvider?.()?.setVisibility === 'function',
          })),
        }
      },
  }
  return { methods, computed: commentPanelComputed, commentPanelMethods, commentParticipantActions }
}
