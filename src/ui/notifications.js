import { applyStyle, mountNode, setAttr, setText, syncChildren } from './dom'
import { iconNode } from './icon'

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
  const bell = node('span', 'lark-doc-notify-header-bell')
  setAttr(bell, 'aria-hidden', 'true')
  bell.appendChild(iconNode('bell', 14))
  header.appendChild(bell)

  function action(className, label, name) {
    const button = node('button', className, label)
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
  const mute = action('lark-doc-notify-mute', '', 'onToggleMute')
  const readAll = action('lark-doc-notify-readall', '全部已读', 'onMarkAllRead')
  const empty = node('div', 'lark-doc-notify-empty')
  const image = node('span', 'lark-doc-notify-empty-img')
  setAttr(image, 'aria-hidden', 'true')
  image.appendChild(iconNode('bell', 72))
  empty.appendChild(image)
  empty.appendChild(node('p', 'lark-doc-notify-empty-title', '暂无通知'))
  empty.appendChild(node('p', 'lark-doc-notify-empty-sub', '当协作者在文档中提及你、回复你的评论或修改你关注的内容时，通知会出现在这里'))
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
    setText(mute, state.muteLabel)
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
        applyStyle(button, { display: 'flex', flexDirection: 'column', gap: '4px', width: '100%', padding: '0', border: '0', textAlign: 'left' })
        button.appendChild(node('span', 'lark-doc-notify-item-title'))
        button.appendChild(node('span', 'lark-doc-notify-item-body'))
        button.addEventListener('click', () => { if (!button.disabled) handlers.onOpenItem?.(item.id) })
        row.appendChild(button)
        rows.set(item.id, row)
      }
      row.classList.toggle('is-unread', typeof item.read === 'boolean' ? !item.read : !item.readAt)
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
