import { applyStyle, mountNode, setAttr, setText, syncChildren } from './dom'
import { iconNode } from './icon'
import { NOTIFY_BRAND_BLUE, NOTIFY_CARD, NOTIFY_CARD_LINE, NOTIFY_DEEP_BLUE, NOTIFY_ON_BRAND, NOTIFY_TEAL } from './palette'

const notificationTitles = { permission: '文档权限已更新', 'resource-binding': '关联资源已更新', comment: '评论有新动态', mention: '有人提及了你' }
import { NOTIFY_TITLE } from '../components/lark-doc/editor/notifyMixin'

function node(tag, className, value) {
  const el = document.createElement(tag)
  el.className = className
  if (value !== undefined) el.textContent = value
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
  header.appendChild(node('h3', 'lark-doc-notify-header-desc', NOTIFY_TITLE))
  // 飞书头部把开关状态画在标题后面（铃铛 / 铃铛斜杠），右侧「关闭通知」是纯文字按钮，
  // 不带图标。状态由 update() 跟着 muted 推，别在按钮上重复画一枚。
  const status = node('span', 'lark-doc-notify-status')
  setAttr(status, 'aria-hidden', 'true')
  header.appendChild(status)

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
  // 飞书头部按钮是纯文字：关闭/开启通知的状态由标题后的铃铛承载。
  const mute = action('lark-doc-notify-mute', 'onToggleMute')
  const muteText = node('span', 'lark-doc-notify-mute-text')
  mute.append(muteText)
  const readAll = action('lark-doc-notify-readall', 'onMarkAllRead')
  const readAllIcon = node('span', 'lark-doc-notify-readall-icon')
  const readAllText = node('span', 'lark-doc-notify-readall-text', '全部已读')
  setAttr(readAllIcon, 'aria-hidden', 'true')
  readAllIcon.appendChild(iconNode('check-circle', 16))
  readAll.append(readAllIcon, readAllText)
  const empty = node('div', 'lark-doc-notify-empty')
  const image = node('span', 'lark-doc-notify-empty-img')
  setAttr(image, 'aria-hidden', 'true')
  // 静态装饰图（120×120）：云文档卡片 + 双向箭头 + 蓝色提示点/对话气泡，对齐飞书空态插图。
  image.innerHTML = `<svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M22 44c2-13 12-23 25-25" stroke="${NOTIFY_TEAL}" stroke-width="10" stroke-linecap="round"/><path d="M14 76c-2-19 8-38 27-46" stroke="${NOTIFY_DEEP_BLUE}" stroke-width="10" stroke-linecap="round"/><path d="M68 98c14-1 26-10 31-23" stroke="${NOTIFY_TEAL}" stroke-width="10" stroke-linecap="round"/><path d="M54 109c23-2 41-17 47-39" stroke="${NOTIFY_BRAND_BLUE}" stroke-width="10" stroke-linecap="round"/><rect x="38" y="32" width="50" height="58" rx="5" fill="${NOTIFY_CARD}"/><path d="M47 47h30M47 57h30M47 67h17" stroke="${NOTIFY_CARD_LINE}" stroke-width="3" stroke-linecap="round"/><circle cx="84" cy="29" r="11" fill="${NOTIFY_BRAND_BLUE}"/><path d="M29 69h27v20H42l-8 8v-8h-5z" fill="${NOTIFY_ON_BRAND}" stroke="${NOTIFY_DEEP_BLUE}" stroke-width="3" stroke-linejoin="round"/></svg>`
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
      let row = rows.get(item.id)
      if (!row) {
        row = node('li', 'lark-doc-notify-item')
        const button = node('button', 'lark-doc-notify-item-action')
        button.type = 'button'
        button.appendChild(node('span', 'lark-doc-notify-item-title'))
        button.appendChild(node('span', 'lark-doc-notify-item-body'))
        button.addEventListener('click', () => { if (!button.disabled) handlers.onOpenItem?.(item.id) })
        row.appendChild(button)
        rows.set(item.id, row)
      }
      row.classList.toggle('is-unread', typeof item.read === 'boolean' ? !item.read : !item.readAt)
      // 无正文的系统通知（权限变更 / 关联资源更新）在飞书里是单行条目：行高 50、14/26 灰字、
      // 内边距 12；有正文的评论类条目仍是 9px 8px + 标题/正文两行。
      row.classList.toggle('is-line', !item.body)
      const button = row.firstElementChild
      button.disabled = busy || item.actionable === false || typeof handlers.onOpenItem !== 'function'
      setText(button.children[0], item.title || notificationTitles[item.type] || '文档有新动态')
      setText(button.children[1], item.body)
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
