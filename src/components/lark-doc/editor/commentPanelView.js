/** Source consumers retain synchronous, complete panel projections. */
import { createPanelPresentation } from './panelPresentation'
import { supportsDocumentAction } from './documentMenuView'
import { COMMENT_HEIGHTS, COMMENT_CONTROLS, COMMENT_PRIVATE_SWITCH, COMMENT_REPLY_CONTROLS, COMMENT_REPLY_CONTROL_IDS, COMMENT_REPLY_MENU_ITEMS } from '../../../core/blocks/comment'

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

/** This navigation helper is also called by the synchronous top-bar controller. */
export async function openCommentDocumentTarget(ed, docId, { reportError = true } = {}) {
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
      if (reportError && owns() && handler === ed.onDocumentAction && result !== true) ed.commentMessage = '暂时无法打开此文档。'
      return owns() && handler === ed.onDocumentAction && result === true
    }
    if (reportError && owns()) ed.commentMessage = '暂时无法打开此文档。'
  } catch { if (reportError && owns()) ed.commentMessage = '暂时无法打开此文档。' }
  return false
}

export const panelPresentation = createPanelPresentation({
  commentModel: { COMMENT_HEIGHTS, COMMENT_CONTROLS, COMMENT_PRIVATE_SWITCH, COMMENT_REPLY_CONTROLS, COMMENT_REPLY_CONTROL_IDS, COMMENT_REPLY_MENU_ITEMS },
  supportsDocumentAction, formatDocumentCommentTime, openCommentDocumentTarget,
})
export const commentPanelComputed = panelPresentation.computed
export const commentParticipantActions = panelPresentation.commentParticipantActions
export const commentPanelMethods = panelPresentation.commentPanelMethods
