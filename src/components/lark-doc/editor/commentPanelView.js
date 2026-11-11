import { commentMentionSegments } from '../../../core/comments/mentions'
import { commentTranslationActions } from './commentTranslation'
import { uploadCommentImageFiles as uploadImages, queryPendingCommentImage as queryImage } from './commentImages'

// Presentation projections live with the existing lazy comment panel; authoritative gates remain on ed.
import { COMMENT_HEIGHTS, COMMENT_CONTROLS, COMMENT_PRIVATE_SWITCH, COMMENT_REPLY_CONTROLS, COMMENT_REPLY_CONTROL_IDS, COMMENT_REPLY_MENU_ITEMS } from '../../../core/blocks/comment'
import { emojiCategories, searchEmoji, findEmojiByGlyph, normalizeEmojiGlyph } from '../../../core/emoji/catalog'

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

/** Whole-comment default time: local calendar first, then the captured relative thresholds. */
export function formatDocumentCommentTime(at, now = Date.now()) {
  const timestamp = value => typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Date.parse(value) : NaN
  const end = timestamp(now), input = timestamp(at)
  if (!Number.isFinite(end) || end <= 0 || !Number.isFinite(input) || input <= 0) return ''
  if (!Number.isFinite(new Date(input).getTime())) return ''
  const time = Math.min(input, end), date = new Date(time), today = new Date(end)
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(today.getTime())) return ''
  const sameDay = other => date.getFullYear() === other.getFullYear() && date.getMonth() === other.getMonth() && date.getDate() === other.getDate()
  if (sameDay(today)) {
    const seconds = Math.round((end - time) / 1000)
    if (seconds <= 44) return '刚刚'
    if (seconds <= 89) return '1 分钟前'
    const minutes = Math.round((end - time) / 60000)
    if (minutes <= 1) return '1 分钟前'
    if (minutes <= 44) return `${minutes} 分钟前`
    if (minutes <= 89) return '1 小时前'
    const hours = Math.round((end - time) / 3600000)
    if (hours <= 24) return `${Math.max(1, hours)} 小时前`
    // A repeated local hour can make a single calendar day longer than 24 hours.
    return hours <= 35 ? '1 天前' : `${Math.round((end - time) / 86400000)} 天前`
  }
  const clock = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  if (sameDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1))) return `昨天 ${clock}`
  return date.getFullYear() === today.getFullYear() ? `${date.getMonth() + 1}月${date.getDate()}日 ${clock}` : `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

export const commentPanelClock = {
  data: () => ({ documentCommentNow: Date.now() }),
  mounted() { if (this.documentOnly) this.startDocumentCommentClock() },
  watch: { documentOnly(value) { if (value) this.startDocumentCommentClock(); else this.stopDocumentCommentClock() } },
  beforeDestroy() { this._documentCommentClockDisposed = true; this.stopDocumentCommentClock() },
  methods: {
    stopDocumentCommentClock() {
      clearInterval(this._documentCommentTimer); this._documentCommentTimer = null
      this._documentCommentClockDocument?.removeEventListener('visibilitychange', this._documentCommentVisibility)
      this._documentCommentClockDocument = null; this._documentCommentVisibility = null
    },
    startDocumentCommentClock() {
      this.stopDocumentCommentClock()
      if (this._documentCommentClockDisposed || typeof document === 'undefined') return
      const target = document
      const current = () => !this._documentCommentClockDisposed && !this._isDestroyed && !this._isBeingDestroyed && this.documentOnly && this._documentCommentVisibility === visibility
      const tick = () => { if (current() && target.visibilityState === 'visible') this.documentCommentNow = Date.now() }
      const visibility = () => {
        if (!current()) return
        clearInterval(this._documentCommentTimer); this._documentCommentTimer = null
        if (target.visibilityState === 'visible') { tick(); this._documentCommentTimer = setInterval(tick, 60000) }
      }
      this._documentCommentClockDocument = target; this._documentCommentVisibility = visibility
      target.addEventListener('visibilitychange', visibility); visibility()
    },
  },
}

/** Only a host-supplied document URL or navigation intent may open a reference. */
export async function openCommentDocumentTarget(ed, docId) {
  if (typeof docId !== 'string' || !/^[A-Za-z0-9._-]{1,128}(?![\s\S])/.test(docId) || !ed.commentCan('canView')) return false
  const session = ed.session, current = ed.commentOperationCurrent(), auth = session?._authorizationGeneration,
    identity = session?._privateIdentityGeneration, principal = session?.user?.id, sourceDoc = session?.documentId,
    provider = session?.getProvider?.('documentBusiness'), authorization = session?.getProvider?.('authorization'), handler = ed.onDocumentAction
  const owns = () => current() && session === ed.session && auth === session?._authorizationGeneration && identity === session?._privateIdentityGeneration &&
    principal === session?.user?.id && sourceDoc === session?.documentId && authorization === session?.getProvider?.('authorization') && ed.commentCan('canView')
  try {
    const raw = provider?.getDocumentUrl?.(docId)
    if (raw) {
      if (typeof raw !== 'string') return false
      const url = new URL(raw, window.location.href), here = new URL(window.location.href)
      if (!['https:', 'http:'].includes(url.protocol) || url.origin !== here.origin || url.username || url.password ||
        /^\/editor\/(?:v1|integration)\//.test(url.pathname) || (docId !== sourceDoc && url.href === here.href) ||
        !owns() || provider !== session?.getProvider?.('documentBusiness')) return false
      window.open(url.href, '_blank', 'noopener'); return true
    }
    if (typeof handler === 'function' && owns()) {
      const result = await handler(Object.freeze({ action: 'open-document-reference', target: 'document', documentId: docId,
        sourceDocumentId: sourceDoc ?? null, actorId: principal ?? null }))
      if (owns() && handler === ed.onDocumentAction && result !== true) ed.commentMessage = '暂时无法打开此文档。'
      return owns() && handler === ed.onDocumentAction && result === true
    }
    if (owns()) ed.commentMessage = '暂时无法打开此文档。'
  } catch { if (owns()) ed.commentMessage = '暂时无法打开此文档。' }
  return false
}

export const commentPanelComputed = {
historicalOnly() { return !this.documentOnly && this.ed.commentHistorical === true },
commentReactionCategories() { return ['常用', '全部', ...emojiCategories] },
commentReactionItems() {
      const query = this.ed.commentReactionQuery
      if (!query && this.ed.commentReactionCategory === '常用') return ['👍', '❤️', '😄', '👏', '🎉', '👀', '✅', '🙏'].map(findEmojiByGlyph).filter(Boolean)
      return searchEmoji(query, ['常用', '全部'].includes(this.ed.commentReactionCategory) ? undefined : this.ed.commentReactionCategory)
    },
commentReactionVisibleItems() { return this.commentReactionItems.slice(0, this.ed.commentReactionLimit) },
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

export const commentParticipantActions = {
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

export const commentPanelMethods = {
commentMentionSegments,
onCommentDocumentReferenceClick(event, threadId, replyId, reference) {
      if (!reference.docId) return false
      event.preventDefault(); event.stopPropagation()
      return this.openCommentDocumentReference(threadId, replyId, reference)
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
        expectedRevision: thread.threadRevision }, 'reactToComment')
      // 冲突只刷新当前视图，绝不根据新版本自动再提交。
      if (!result && current() && this.ed.commentCan('canView') && !this.ed.commentPendingOperation) await this.ed.loadComments().catch(() => {})
      return result
    },
chooseCommentReaction(emoji) {
      const context = this.ed.commentReactionContext
      if (!context) return
      const reply = this.ed.commentThreads.find(item => item.id === context.threadId)?.replies.find(item => item.id === context.replyId)
      const mine = reply?.reactions?.find(item => item.emoji === normalizeEmojiGlyph(emoji))?.reactedByMe === true
      return this.setCommentReaction(context.threadId, context.replyId, emoji, !mine)
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
        if (!thread || !reply || this.documentControlDisabled(id, thread, reply)) return
        if (id === 'thumb') return this.setCommentReaction(threadId, commentId, '👍', !reply.reactions?.some(item => item.emoji === '👍' && item.reactedByMe))
        if (id === 'document-reply') return this.ed.beginDocumentCommentReply(threadId, commentId)
        if (id === 'resolve') return this.runCommentControl('resolve', threadId, event)
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
      if (control.id === 'thumb' && reply.reactions?.some(item => item.emoji === '👍' && item.reactedByMe)) return '取消点赞'
      if (control.id === 'resolve' && thread.resolved) return '重开评论'
      return control.label
    },
runCommentMenuItem(id, threadId, commentId) {
      this.ed.closeCommentMenus()
      if (id === 'report') return this.reportCommentReply(threadId, commentId)
      if (id === 'delete') return this.ed.deleteCommentReply(threadId, commentId)
      if (id === 'edit') return this.ed.beginEditComment(threadId, commentId)
      if (id === 'translate' && this.ed.commentRemote) return this.ed.beginCommentTranslation(threadId, commentId)
      return undefined
    },
commentMenuDisabled(item) {
      return item.id === 'report' && (typeof this.ed.onDocumentAction !== 'function' || !this.ed.commentCan('canView'))
    },
async reportCommentReply(threadId, replyId) {
      const ed = this.ed, handler = ed.onDocumentAction
      const thread = ed.commentThreads?.find(item => item.id === threadId)
      const reply = thread?.replies.find(item => item.id === replyId)
      if (typeof handler !== 'function' || !ed.commentCan('canView') || !reply || thread.tombstone || reply.tombstone ||
          !reply.author?.id || reply.author.id === ed.commentAuthor.id) return false
      const current = ed.commentOperationCurrent(), auth = ed.session?._authorizationGeneration
      try {
        await handler(Object.freeze({ action: 'report', target: 'comment', documentId: ed.session?.documentId ?? null,
          actorId: ed.session?.user?.id ?? null, threadId, replyId }))
        return current() && handler === ed.onDocumentAction && auth === ed.session?._authorizationGeneration && ed.commentCan('canView')
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
      if (id === 'copyAnchor') return this.copyCommentAnchor(threadId)
      if (id === 'more') return this.ed.toggleCommentMoreMenu(threadId, event)
      return undefined
    },
copyCommentAnchor(threadId) {
      if (this.ed.commentRemote) return this.copyRemoteCommentLink(threadId)
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
async copyRemoteCommentLink(threadId) {
      const provider = this.ed.commentProvider()
      const generation = this.ed.commentLoadGeneration
      const current = () => !this.ed.commentDisposed && generation === this.ed.commentLoadGeneration && provider === this.ed.commentProvider() && this.ed.commentCan('canView')
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
