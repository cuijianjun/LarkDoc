/**
 * 评论的纯函数与面板几何常量 —— 无 `this`、无闭包，被 mixin 本体与四个方法域共用。
 *
 * 从 `commentsMixin.js` 原样搬出。搬出的唯一原因：四个方法域都要用 `commentDraftText` /
 * `commentGate` 这类判定，若继续从 `commentsMixin.js` 反向导入就会成环。
 * `commentsMixin.js` 仍把公开的五个重新导出，对外签名不变。
 */

export const documentMentionScope = scope => scope === 'document' || (typeof scope === 'string' && /^edit\/[^/]+\/[^/]+$/.test(scope))



/** 面板与正文右缘的间距（实测 1214 - 1202，与修订面板同口径）。 */
export const COMMENT_ANCHOR_GUTTER = 12
/** 贴视口边的最小留白，与 isv 面板同口径。 */
export const COMMENT_VIEWPORT_MARGIN = 8
/** 两个面板纵向叠放时的间隙。**不属于面板几何**（04 §3.1④ 没测），故不进 `COMMENT_PANEL`。 */
export const COMMENT_PANEL_GAP = 8









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

export function commentLauncher(ed, imageScope) {
  const root = ed.$refs?.root, win = root?.ownerDocument.defaultView
  const bounds = root?.getBoundingClientRect()
  const header = root?.querySelector('.lark-doc-topbar'), rect = header?.getBoundingClientRect()
  const style = header && win?.getComputedStyle(header)
  const visibleHeader = header && rect.height > 0 && !header.hidden && style?.display !== 'none' && style?.visibility !== 'hidden'
  const desktop = !ed._mobileEditorMedia?.matches
  const toolbar = desktop && root?.querySelector('.lark-doc-toolbar')
  return {
    desktop,
    visible: !imageScope && ed.commentCan?.('canView') === true && ed.featureEnabled?.('comments') !== false && !!ed.commentProvider?.(),
    top: Math.max(0, toolbar?.getBoundingClientRect?.().bottom || 0, visibleHeader ? rect.bottom : bounds?.top || 0),
    right: Math.max(0, (win?.innerWidth || 0) - (bounds?.right || win?.innerWidth || 0)),
  }
}

export function commentSidebarThreads(threads, remote, historical, resolved) {
  return threads.filter(thread => remote ? !thread.tombstone && thread.scope !== 'document' && (historical ? thread.anchorStatus === 'orphaned' : resolved ? thread.resolved : !thread.resolved && thread.anchorStatus !== 'orphaned') : thread.bound && !thread.resolved)
}
