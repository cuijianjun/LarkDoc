import { applyStyle, mountNode, setAttr, setText, syncChildren } from './dom'
import { iconNode } from './icon'
import { NOTIFY_BRAND_BLUE, NOTIFY_CARD, NOTIFY_CARD_LINE, NOTIFY_DEEP_BLUE, NOTIFY_ON_BRAND, NOTIFY_TEAL } from './palette'
import { NOTIFY_TITLE } from '../components/lark-doc/editor/notifyMixin'

/**
 * 通知动作文案表 —— 逐条对应飞书 `307-19777.9ceae05a.js` 的 `getText()`
 * （`CreationDoc_Common_Notifications_*` / `LarkCCM_Docs_*` 那串 key 的中文值）。
 *
 * ⚠️ 中文表不在 web-scripts 快照里（i18n 走运行时 `window.TTI18N` 注入），
 * 所以这里是**按 key 语义 + 飞书同一功能的面拷贝**落的值，不是逐字抄来的：
 *   comment          ← COMMNET_ADD_COMMENT      `comment_content`
 *   mention          ← MENTION_AT_IN_CONTENT    `mention_content`
 *   mention-comment  ← MENTION_AT_IN_COMMENT    `comment_content`（公开）/ 私密评论另一串
 *   reply            ← 上面都没命中的默认分支   `reply_content`
 *   whole-comment    ← COMMNET_ADD_WHOLE_COMMENT `commentAll_content`
 * 句式统一是「{人名} + 动作」，与源码 `userNamePlaceholder` 替换后的成品一致。
 */
export const NOTIFY_ACTIONS = Object.freeze({
  comment: '评论了你编辑的内容',
  mention: '在文档中提及了你',
  'mention-comment': '在评论中提及了你',
  reply: '回复了你的评论',
  'whole-comment': '发表了全文评论',
  reaction: '对你的评论添加了表情回复',
  'content-reaction': '对你的内容添加了表情回复',
  resolved: '解决了你的评论',
  'whole-resolved': '解决了文档中的评论',
  reopened: '重新打开了评论',
  'whole-reopened': '重新打开了文档中的评论',
  suggestion: '提出了建议',
  'suggestion-accepted': '采纳了你的建议',
  'suggestion-rejected': '未采纳你的建议',
  deleted: '删除了评论',
  share: '分享文档给你',
  permission: '更新了文档权限',
  'resource-binding': '更新了关联资源',
})

/** 已删除 / 无权限这类**不可跳转**的通知（飞书点击只弹提示，不定位）。 */
export const NOTIFY_BLOCKED = Object.freeze({ deleted: 1, 'no-permission': 1 })

const MINUTE = 60 * 1000

/**
 * 时间行文案（14px 下面是 12px 灰字）。飞书用 `He.Tf(notice_time)`，
 * 形态是「刚刚 / N 分钟前 / HH:mm / 昨天 HH:mm / M月D日 / YYYY年M月D日」。
 * @param {number|string|Date} value 毫秒时间戳或可解析的时间值
 * @param {number} [now] 便于测试注入「当前时间」
 */
export function formatNotifyTime(value, now = Date.now()) {
  const time = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(time)) return ''
  const delta = now - time
  if (delta < 0) return '刚刚'
  if (delta < MINUTE) return '刚刚'
  if (delta < 60 * MINUTE) return `${Math.floor(delta / MINUTE)} 分钟前`
  const at = new Date(time)
  const today = new Date(now)
  const clock = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  const sameDay = at.getFullYear() === today.getFullYear() && at.getMonth() === today.getMonth() && at.getDate() === today.getDate()
  if (sameDay) return clock
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  if (at.getFullYear() === yesterday.getFullYear() && at.getMonth() === yesterday.getMonth() && at.getDate() === yesterday.getDate()) return `昨天 ${clock}`
  if (at.getFullYear() === today.getFullYear()) return `${at.getMonth() + 1}月${at.getDate()}日`
  return `${at.getFullYear()}年${at.getMonth() + 1}月${at.getDate()}日`
}

function actorOf(item) {
  const actor = item.actor && typeof item.actor === 'object' ? item.actor : {}
  const name = item.actorName || actor.name || (typeof item.actor === 'string' ? item.actor : '') || item.fromUser?.name || ''
  const avatar = item.actorAvatar || actor.avatar || item.fromUser?.avatar || ''
  return { name: String(name || ''), avatar: String(avatar || '') }
}

/**
 * 把一条通知摊平成渲染用的字段（飞书 `Xn.getText()` + `renderContent()` 的产物）。
 * 纯函数、不碰 DOM：视图只负责把结果贴到节点上，测试可以直接断言结构。
 *
 * 宿主既可以给结构化字段（`actor` / `excerpt` / `quote` / `restCount`），
 * 也可以像以前那样只给 `title` + `body` —— 两条路都通。
 */
export function presentNotification(item = {}) {
  const actor = actorOf(item)
  const action = item.action || NOTIFY_ACTIONS[item.type] || ''
  const explicit = typeof item.title === 'string' && item.title !== ''
  const title = explicit ? item.title : [actor.name, action].filter(Boolean).join(' ') || (action || '文档有新动态')
  const excerpt = String(item.excerpt || item.summary || item.body || item.text || '')
  const quote = String(item.quote || '')
  const restCount = Number(item.restCount || item.remaining || 0) || 0
  const time = item.time ?? item.noticeTime ?? item.createdAt ?? item.created_at ?? null
  return {
    avatar: actor.avatar,
    initial: (actor.name || '?').slice(0, 1),
    title,
    suffix: String(item.suffix || ''),
    // 评论类通知：引用与正文都进灰卡；其余通知的引用直接挂在标题下（飞书同款分叉）。
    excerpt,
    quote,
    quoteInCard: !!excerpt,
    excerptAuthor: String(item.excerptAuthor || item.commentAuthor || actor.name || ''),
    excerptAvatar: String(item.excerptAvatar || item.commentAvatar || ''),
    restCount,
    time: time == null ? '' : formatNotifyTime(time),
    unread: typeof item.read === 'boolean' ? !item.read : !item.readAt,
  }
}

function node(tag, className, value) {
  const el = document.createElement(tag)
  el.className = className
  if (value !== undefined) el.textContent = value
  return el
}

/** 32 圆头像：有图用图，没图用姓名首字（飞书同款兜底）。 */
function avatarNode(className, initial, src, size) {
  const el = node('span', className)
  if (src) {
    const img = document.createElement('img')
    img.src = src
    img.alt = ''
    img.loading = 'lazy'
    img.addEventListener('error', () => { img.remove(); el.textContent = initial })
    el.appendChild(img)
  } else {
    el.textContent = initial
  }
  if (size) { el.style.width = `${size}px`; el.style.height = `${size}px` }
  return el
}

/** 通知只负责渲染；Provider 回执、回读及上下文隔离仍由 notifyMixin 持有。 */
export function createNotifications(options = {}) {
  const handlers = options.handlers || {}
  let wasOpen = false, restoreAction = null
  const el = node('div', 'lark-doc-notify-popover')
  el.tabIndex = -1
  setAttr(el, 'role', 'dialog')
  setAttr(el, 'aria-label', NOTIFY_TITLE)
  const nested = node('div', 'lark-doc-notify-loading-nested')
  const container = node('div', 'lark-doc-notify-loading-container')
  const content = node('div', 'lark-doc-notify-content')
  const header = node('header', 'lark-doc-notify-header')
  const title = node('h3', 'lark-doc-notify-header-desc', NOTIFY_TITLE)
  header.appendChild(title)

  function action(className, name) {
    const button = node('button', className)
    button.type = 'button'
    button.addEventListener('mousedown', event => {
      event.preventDefault()
    })
    button.addEventListener('click', () => {
      if (!button.disabled && typeof handlers[name] === 'function') handlers[name]()
    })
    header.appendChild(button)
    return button
  }
  /**
   * 飞书真身（截图 970×1264，面板 801 device = 400 CSS）逐像素实测：
   * 标题 ink 14..95、铃铛 ink 102.5..112（16 框）**紧贴标题右侧**，然后才是右侧两颗**纯文字**按钮
   * （「关闭通知」ink 255.5..309，无图标）。所以铃铛挂在标题后，承静音开关态。
   */
  const status = node('span', 'lark-doc-notify-status')
  setAttr(status, 'aria-hidden', 'true')
  header.appendChild(status)
  const mute = action('lark-doc-notify-mute', 'onToggleMute')
  const muteText = node('span', 'lark-doc-notify-mute-text')
  mute.appendChild(muteText)
  const readAll = action('lark-doc-notify-readall', 'onMarkAllRead')
  const readAllText = node('span', 'lark-doc-notify-readall-text', '全部已读')
  readAll.append(readAllText)

  const empty = node('div', 'lark-doc-notify-empty')
  const image = node('span', 'lark-doc-notify-empty-img')
  setAttr(image, 'aria-hidden', 'true')
  /**
   * 空态插图 120×120，按截图 932×1286 逐件实测（面板 400 CSS ↔ 804 device，2× DPR）：
   * 灰卡 x23.5..104 / y22..76、两条灰线 y37.5 与 y48、蓝圆 Ø22.5 落在卡片右上角外、
   * 左下角一枚白底深蓝描边气泡、外围两条螺旋带（青绿 #01D6B9 / 深蓝 #0D296E）+ 底部亮蓝弧。
   * 取色与几何都写在 palette.js 与下面的坐标里，别再按印象调。
   */
  image.innerHTML = `<svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">`
    // 弧线控制点是用「按长轴分箱取质心」从截图里掏出来的中心线（不是手画的贝塞尔），
    // 所以走向与飞书原始插图一致；线宽实测 8（早前按 10 画会明显更粗）。
    // 顶部青绿带是**两段**（实测 ink x6..25 与 x33.5..52.5，中间留 8.5 的白缝），
    // 且端头是斜切不是圆头 —— 圆头会把 8.5 的缝糊死，所以这段单独用 butt。
    + `<path d="M7.2 24.1l17.8-10.1" stroke="${NOTIFY_TEAL}" stroke-width="8" stroke-linecap="butt"/>`
    + `<path d="M33.5 11.9l2.8-.7 9.2-2.1 4.7-.7" stroke="${NOTIFY_TEAL}" stroke-width="8" stroke-linecap="butt" stroke-linejoin="round"/>`
    + `<path d="M8.1 29.8l1.8 2.8 5.3 3.9 4.1 4.4 1.7 1.4" stroke="${NOTIFY_DEEP_BLUE}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`
    + `<path d="M106.3 65.2l3.1 2.8 1.1 3 1.1 4.3" stroke="${NOTIFY_DEEP_BLUE}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`
    + `<path d="M65 90l11-.8 10.5-1.3 10.8-2 10.7-3 5.5-2.6" stroke="${NOTIFY_TEAL}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`
    + `<path d="M60.8 106.3l9.4-.7 9.5-1 9.6-1.5 9.4-2.1 5-1.5" stroke="${NOTIFY_BRAND_BLUE}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`
    + `<rect x="23.5" y="22" width="80.5" height="58" rx="5" fill="${NOTIFY_CARD}"/>`
    + `<path d="M35 36.5h46.5M35 47h27" stroke="${NOTIFY_CARD_LINE}" stroke-width="2" stroke-linecap="round"/>`
    + `<circle cx="101.5" cy="23.3" r="11.3" fill="${NOTIFY_BRAND_BLUE}"/>`
    + `<path d="M17.8 65.8H46.2Q50.2 65.8 50.2 69.8V83.5Q50.2 87.5 46.2 87.5H24L13.8 95.2V87.5H17.8Q13.8 87.5 13.8 83.5V69.8Q13.8 65.8 17.8 65.8Z" fill="${NOTIFY_ON_BRAND}" stroke="${NOTIFY_DEEP_BLUE}" stroke-width="2.6" stroke-linejoin="round"/>`
    + `</svg>`
  empty.appendChild(image)
  empty.appendChild(node('p', 'lark-doc-notify-empty-title', '暂无通知'))
  empty.appendChild(node('p', 'lark-doc-notify-empty-sub', '当有人在当前文档提及你，评论你编辑的内容，或回复了你的评论，你将在这里收到通知'))
  const error = node('div', 'lark-doc-notify-empty')
  setAttr(error, 'role', 'alert')
  error.appendChild(node('p', 'lark-doc-notify-empty-title', '通知读取失败'))
  const errorText = node('p', 'lark-doc-notify-empty-sub')
  error.appendChild(errorText)
  const list = node('ul', 'lark-doc-notify-list')
  const more = node('button', 'lark-doc-notify-more', '加载更多通知')
  more.type = 'button'
  more.addEventListener('click', () => { if (!more.disabled) handlers.onLoadMore?.() })
  const query = node('button', 'lark-doc-notify-query', '查询原通知操作')
  query.type = 'button'; query.addEventListener('click', () => { if (!query.disabled) handlers.onQueryPending?.() })
  const feedback = node('p', 'lark-doc-notify-empty-sub')
  setAttr(feedback, 'role', 'alert')
  const rows = new Map()
  container.appendChild(content)
  nested.appendChild(container)
  el.appendChild(nested)
  el.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    event.preventDefault(); event.stopPropagation(); handlers.onClose?.(true)
  })

  /**
   * 单条渲染（飞书 `nc-feed-message_wrapper` 的 DOM 复刻）：
   *   [头像 32 (+未读红点 11)] [标题 14/500 + 后缀 + 引用/灰卡 + 时间 12]
   * 灰卡里是「引用 + 小头像 16 + 作者: 正文 + 查看剩余 N 条评论」。
   *
   * 例外是**系统通知**（权限变更 / 关联资源更新这类没有正文的）：飞书真身里它们是
   * 无头像的单行灰字（截图 970×1264：ink 距面板左 12..14，行距 50，不带时间），
   * 走 `is-line` 分支，不套 feed-message 结构。
   */
  function buildRow(item) {
    const view = presentNotification(item)
    const line = !view.excerpt && !view.quote && view.restCount === 0
    const row = node('li', 'lark-doc-notify-item')
    row.classList.toggle('is-line', line)
    const button = node('button', 'lark-doc-notify-item-action')
    button.type = 'button'
    const avatar = avatarNode('lark-doc-notify-item-avatar', view.initial, view.avatar)
    avatar.appendChild(node('span', 'lark-doc-notify-item-badge'))
    const body = node('span', 'lark-doc-notify-item-content')
    body.appendChild(node('span', 'lark-doc-notify-item-title', view.title))
    const suffix = node('span', 'lark-doc-notify-item-suffix', view.suffix)
    if (view.suffix) body.appendChild(suffix)
    if (view.quote && !view.quoteInCard) body.appendChild(node('span', 'lark-doc-notify-item-quote', view.quote))
    if (view.excerpt || (view.quote && view.quoteInCard)) {
      const card = node('span', 'lark-doc-notify-item-card')
      if (view.quote && view.quoteInCard) card.appendChild(node('span', 'lark-doc-notify-item-quote', view.quote))
      if (view.excerpt) {
        const block = node('span', 'lark-doc-notify-item-block')
        block.appendChild(avatarNode('lark-doc-notify-item-card-avatar', (view.excerptAuthor || '?').slice(0, 1), view.excerptAvatar, 16))
        const message = node('span', 'lark-doc-notify-item-card-message')
        message.appendChild(node('span', 'lark-doc-notify-item-card-name', view.excerptAuthor ? `${view.excerptAuthor}:` : ''))
        message.appendChild(node('span', 'lark-doc-notify-item-card-text', view.excerpt))
        block.appendChild(message)
        card.appendChild(block)
      }
      if (view.restCount > 0) {
        const rest = node('span', 'lark-doc-notify-item-rest-node')
        rest.appendChild(node('span', 'lark-doc-notify-item-rest', `查看剩余 ${view.restCount} 条评论`))
        const caret = node('span', 'lark-doc-notify-item-rest-caret')
        caret.appendChild(iconNode('caretRight', 12))
        rest.appendChild(caret)
        rest.addEventListener('click', event => {
          // 行本身是 button，不能嵌 button；飞书这颗也是 div + onClick 并 stopPropagation。
          event.stopPropagation()
          if (typeof handlers.onOpenHistory === 'function') handlers.onOpenHistory(event)
        })
        card.appendChild(rest)
      }
      body.appendChild(card)
    }
    const timeNode = node('span', 'lark-doc-notify-item-time', view.time)
    if (view.time && !line) body.appendChild(timeNode)
    button.append(...(line ? [body] : [avatar, body]))
    button.addEventListener('click', () => { if (!button.disabled) handlers.onOpenItem?.(item.id) })
    row.appendChild(button)
    row.classList.toggle('is-unread', view.unread)
    // 复用判定只看**结构**：标题/正文/引用/剩余条数这些决定「有哪些节点」的字段。
    // 已读、时间、忙碌态都是原地改（`is-unread` / setText / disabled）—— 它们一变就换节点的话，
    // 外部持有的行引用（焦点、测试里的 item）全成孤儿，滚动位置也会跳。
    row.dataset.signature = JSON.stringify([view.title, view.suffix, view.quote, view.quoteInCard,
      view.excerpt, view.excerptAuthor, view.excerptAvatar, view.restCount, view.avatar, view.initial, view.time && !line])
    return row
  }

  function update(state = {}) {
    mountNode(options.host, el, !!state.open)
    if (!state.open) { wasOpen = false; restoreAction = null; return }
    applyStyle(el, { left: `${state.style.left}px`, top: `${state.style.top}px` })
    const busy = !!(state.loading || state.writing || state.historyLoading || state.openingId)
    if (busy && el.contains(el.ownerDocument.activeElement) && el.ownerDocument.activeElement !== el) {
      restoreAction = el.ownerDocument.activeElement
      el.focus({ preventScroll: true })
    }
    setAttr(el, 'aria-busy', String(busy))
    const muted = typeof state.muted === 'boolean' ? state.muted : state.muteLabel === '开启通知'
    setText(muteText, state.muteLabel || (muted ? '开启通知' : '关闭通知'))
    status.replaceChildren(iconNode(muted ? 'bell-off' : 'bell', 16))
    mute.disabled = busy
    readAll.disabled = !!state.allReadDisabled || busy
    setAttr(mute, 'aria-disabled', String(mute.disabled))
    setAttr(readAll, 'aria-disabled', String(readAll.disabled))
    readAll.classList.toggle('is-disabled', readAll.disabled)
    setText(errorText, state.loadError)
    const items = state.items || []
    const alive = new Set()
    const slots = items.map(item => {
      alive.add(item.id)
      const next = buildRow(item)
      const previous = rows.get(item.id)
      const keep = previous && previous.dataset.signature === next.dataset.signature
      const row = keep ? previous : next
      const view = presentNotification(item)
      row.classList.toggle('is-unread', view.unread)
      const timeNode = row.querySelector('.lark-doc-notify-item-time')
      if (timeNode) setText(timeNode, view.time)
      row.firstElementChild.disabled = busy || item.actionable === false || typeof handlers.onOpenItem !== 'function'
      rows.set(item.id, row)
      return { node: row, on: true }
    })
    rows.forEach((_row, id) => { if (!alive.has(id)) rows.delete(id) })
    syncChildren(list, slots)
    const failed = !!state.loadError && !state.loading && items.length === 0
    more.disabled = busy
    query.disabled = busy
    setText(more, state.historyLoading ? '正在加载…' : state.historyError ? '重试加载更多通知' : '加载更多通知')
    setText(feedback, state.actionError || state.historyError || '')
    syncChildren(content, [
      { node: header, on: true },
      { node: error, on: failed },
      { node: empty, on: !failed && !!state.empty },
      { node: list, on: !failed && !state.empty },
      { node: feedback, on: !!(state.actionError || state.historyError) },
      { node: more, on: !!state.hasMore || !!state.historyError },
      { node: query, on: !!state.pendingId },
    ])
    if (!wasOpen || el.ownerDocument.activeElement === el) {
      const target = restoreAction?.isConnected && !restoreAction.disabled ? restoreAction : mute
      ;(busy ? el : target).focus({ preventScroll: true })
      if (!busy) restoreAction = null
    }
    wasOpen = true
  }
  return { el, update, destroy() { el.remove(); rows.clear() } }
}
