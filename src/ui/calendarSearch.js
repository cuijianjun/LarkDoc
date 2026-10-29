import { applyStyle, mountNode, setText, syncChildren } from './dom'
import { iconNode } from './icon'

/**
 * CalendarSearchPanel 的原生 DOM 渲染器。
 * 语义契约：根 v-if；输入框打开即聚焦；结果行 mousedown 阻止默认行为；Esc 只停在面板内，
 * 不向编辑器根节点冒泡；结果区固定保留空态槽位。
 */
function buttonNode(className, label) {
  const node = document.createElement('button')
  node.type = 'button'
  node.className = className
  if (label) node.setAttribute('aria-label', label)
  return node
}

function createRow(item, index, handlers) {
  const row = buttonNode('lark-doc-calendar-search-row')
  row.setAttribute('role', 'option')
  row.__ldCalendarEventId = item.eventId
  const icon = document.createElement('span')
  icon.className = 'lark-doc-calendar-icon'
  icon.setAttribute('data-icon', 'calendar')
  icon.setAttribute('aria-hidden', 'true')
  const name = document.createElement('span')
  name.className = 'lark-doc-calendar-search-name'
  setText(name, item.title)
  row.append(icon, name)
  row.addEventListener('mousedown', event => { event.preventDefault(); handlers.onChoose(item) })
  row.addEventListener('mouseenter', () => handlers.onActive(index))
  return row
}

export function createCalendarSearch({ host, handlers = {} } = {}) {
  let root = null
  let input = null
  let listbox = null
  let state = { open: false, style: {}, query: '', results: [], activeIndex: 0, loading: false }

  function build() {
    root = document.createElement('div')
    root.className = 'lark-doc-calendar-search'
    root.setAttribute('role', 'dialog')
    root.setAttribute('aria-label', '插入日程')
    root.addEventListener('keydown', event => event.stopPropagation())

    const head = document.createElement('div')
    head.className = 'lark-doc-calendar-search-head'
    const title = document.createElement('span')
    title.className = 'lark-doc-calendar-search-title'
    setText(title, '插入日程')
    const close = buttonNode('lark-doc-calendar-search-close', '关闭')
    close.addEventListener('mousedown', event => { event.preventDefault(); handlers.onClose() })
    close.appendChild(iconNode('close', 14))
    head.append(title, close)

    input = document.createElement('input')
    input.className = 'lark-doc-calendar-search-input'
    input.type = 'text'
    input.setAttribute('aria-label', '搜索日程')
    input.placeholder = '搜索日程'
    input.addEventListener('input', event => handlers.onQuery(event))
    input.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown') { event.preventDefault(); handlers.onMove(1) }
      else if (event.key === 'ArrowUp') { event.preventDefault(); handlers.onMove(-1) }
      else if (event.key === 'Enter') { event.preventDefault(); handlers.onChoose() }
    })
    input.addEventListener('blur', () => handlers.onBlur())

    listbox = document.createElement('div')
    listbox.className = 'lark-doc-calendar-search-result'
    listbox.setAttribute('role', 'listbox')
    listbox.setAttribute('aria-label', '日程搜索结果')
    root.append(head, input, listbox)
  }

  function paint() {
    if (!root) build()
    applyStyle(root, state.style || {})
    input.value = state.query || ''
    const children = []
    ;(state.results || []).forEach((item, index) => {
      const row = createRow(item, index, handlers)
      row.classList.toggle('is-active', index === state.activeIndex)
      row.setAttribute('aria-selected', index === state.activeIndex ? 'true' : 'false')
      children.push(row)
    })
    if (!children.length) {
      const empty = document.createElement('p')
      empty.className = 'lark-doc-calendar-search-empty'
      setText(empty, state.loading ? '搜索中…' : '没有匹配的搜索结果')
      children.push(empty)
    }
    syncChildren(listbox, children.map(node => ({ node })))
    if (state.open) {
      mountNode(host, root, true)
      input.focus()
      const end = input.value.length
      if (typeof input.setSelectionRange === 'function') input.setSelectionRange(end, end)
    } else mountNode(host, root, false)
  }

  return {
    get el() { return root },
    update(patch = {}) { state = { ...state, ...patch }; paint() },
    destroy() { if (root?.parentNode) root.parentNode.removeChild(root); root = null; input = null; listbox = null },
  }
}
