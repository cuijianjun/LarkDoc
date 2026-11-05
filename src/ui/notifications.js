import { applyStyle, mountNode, setAttr, setText, syncChildren } from './dom'
import { iconNode } from './icon'
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
  const el = node('div', 'lark-doc-notify-popover')
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
  const rows = new Map()
  container.appendChild(content)
  nested.appendChild(container)
  el.appendChild(nested)

  function update(state = {}) {
    mountNode(options.host, el, !!state.open)
    if (!state.open) return
    applyStyle(el, { left: `${state.style.left}px`, top: `${state.style.top}px` })
    setAttr(el, 'aria-busy', String(!!(state.loading || state.writing)))
    setText(mute, state.muteLabel)
    mute.disabled = !!(state.loading || state.writing)
    readAll.disabled = !!state.allReadDisabled
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
        row.appendChild(node('span', 'lark-doc-notify-item-title'))
        row.appendChild(node('span', 'lark-doc-notify-item-body'))
        rows.set(item.id, row)
      }
      row.classList.toggle('is-unread', !item.readAt)
      setText(row.children[0], item.title)
      setText(row.children[1], item.body)
      return { node: row, on: true }
    })
    rows.forEach((_row, id) => { if (!alive.has(id)) rows.delete(id) })
    syncChildren(list, slots)
    const failed = !!state.loadError && !state.loading && items.length === 0
    syncChildren(content, [
      { node: header, on: true },
      { node: error, on: failed },
      { node: empty, on: !failed && !!state.empty },
      { node: list, on: !failed && !state.empty },
    ])
  }
  return { el, update, destroy() { el.remove(); rows.clear() } }
}
