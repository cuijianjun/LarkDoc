import { applyStyle, mountNode, setAttr, setText, syncChildren } from './dom'

function button(className, type = 'button') {
  const node = document.createElement('button')
  node.type = type
  node.className = className
  return node
}

export function createMentionPanel({ host, handlers = {} } = {}) {
  let root = null
  let state = {}
  let tabNodes = []
  let optionNodes = []
  let checkbox = null
  let confirm = null
  let empty = null

  const build = () => {
    root = document.createElement('div')
    root.className = 'lark-doc-mention-panel'
    setAttr(root, 'role', 'dialog')
    setAttr(root, 'aria-label', '提及')

    const tabs = document.createElement('div')
    tabs.className = 'lark-doc-mention-tabs'
    setAttr(tabs, 'role', 'tablist')
    root.appendChild(tabs)

    const list = document.createElement('div')
    list.className = 'lark-doc-mention-list'
    setAttr(list, 'role', 'listbox')
    root.appendChild(list)

    const footer = document.createElement('div')
    footer.className = 'lark-doc-mention-footer'
    const label = document.createElement('label')
    label.className = 'lark-doc-mention-notify'
    checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    setAttr(checkbox, 'aria-label', '同时发送通知')
    checkbox.addEventListener('change', () => handlers.onNotify?.(checkbox.checked))
    const labelText = document.createElement('span')
    setText(labelText, '同时发送通知')
    label.append(checkbox, labelText)
    confirm = button('lark-doc-mention-confirm')
    setText(confirm, '提及')
    confirm.addEventListener('mousedown', (event) => { event.preventDefault(); handlers.onChoose?.() })
    footer.append(label, confirm)
    root.appendChild(footer)
    return { tabs, list }
  }

  const refs = { tabs: null, list: null }
  const render = () => {
    if (!root) Object.assign(refs, build())
    const tabs = (state.tabs || []).map((tab, index) => {
      const node = tabNodes[index] || button('lark-doc-mention-tab')
      setAttr(node, 'role', 'tab')
      setAttr(node, 'aria-selected', state.kind === tab.id ? 'true' : 'false')
      setText(node, tab.label)
      if (!node.__ldMentionBound) {
        node.__ldMentionBound = true
        node.addEventListener('mousedown', (event) => { event.preventDefault(); handlers.onKind?.(node.__ldMentionId) })
      }
      node.__ldMentionId = tab.id
      node.classList.toggle('is-active', state.kind === tab.id)
      return node
    })
    tabNodes = tabs
    syncChildren(refs.tabs, tabs.map((node) => ({ node, on: true })))

    const options = (state.items || []).map((item, index) => {
      const node = optionNodes[index] || button('lark-doc-mention-row')
      setAttr(node, 'role', 'option')
      setAttr(node, 'aria-selected', index === state.activeIndex ? 'true' : 'false')
      node.classList.toggle('is-active', index === state.activeIndex)
      if (!node.__ldMentionBound) {
        node.__ldMentionBound = true
        node.addEventListener('mousedown', (event) => { event.preventDefault(); handlers.onChoose?.(node.__ldMentionItem) })
        node.addEventListener('mouseenter', () => handlers.onActive?.(node.__ldMentionIndex))
      }
      node.__ldMentionItem = item
      node.__ldMentionIndex = index
      let name = node.querySelector('.lark-doc-mention-row-name')
      if (!name) { name = document.createElement('span'); name.className = 'lark-doc-mention-row-name'; node.appendChild(name) }
      setText(name, item.name)
      let dept = node.querySelector('.lark-doc-mention-row-dept')
      if (item.department) { if (!dept) { dept = document.createElement('span'); dept.className = 'lark-doc-mention-row-dept'; node.appendChild(dept) } setText(dept, item.department) } else if (dept) node.removeChild(dept)
      return node
    })
    optionNodes = options
    if (!options.length) {
      if (!empty) { empty = document.createElement('p'); empty.className = 'lark-doc-mention-empty' }
      setText(empty, state.loading ? '搜索中…' : state.emptyText)
      syncChildren(refs.list, [{ node: empty, on: true }])
    } else { empty = null; syncChildren(refs.list, options.map((node) => ({ node, on: true }))) }
    checkbox.checked = !!state.notify
    confirm.disabled = !options.length
    applyStyle(root, state.style || {})
  }

  return {
    el: root,
    update(patch = {}) {
      state = { ...state, ...patch }
      if (!state.open) { if (root) mountNode(host, root, false); return }
      if (!root) { Object.assign(refs, build()); this.el = root }
      render()
      mountNode(host, root, true)
    },
    destroy() { if (root) mountNode(host, root, false); root = null; tabNodes = []; optionNodes = [] },
  }
}
