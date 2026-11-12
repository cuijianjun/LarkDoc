import { applyStyle, mountNode, setAttr, setText, syncChildren } from './dom'
import { safeUrl } from '../core/documentOperations'
import { createNetworkPolicy } from '../core/policy/network'

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

  const clearAvatar = node => {
    node.__ldMentionAvatarKey = null
    const image = node.querySelector('.lark-doc-mention-avatar img')
    if (image) { image.removeAttribute('src'); image.remove() }
  }

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
    return { tabs, list, footer, notify: label }
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

    const network = createNetworkPolicy(state.network)
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
      let avatar = node.querySelector('.lark-doc-mention-avatar')
      if (!avatar) { avatar = document.createElement('span'); avatar.className = 'lark-doc-mention-avatar'; avatar.setAttribute('aria-hidden', 'true'); node.appendChild(avatar) }
      const initial = Array.from(String(item.name || ''))[0] || ''
      const src = safeUrl(item.avatar, true) && !item.avatar.includes('\\') && network.allows(item.avatar) ? item.avatar : ''
      const avatarKey = JSON.stringify([item.kind, item.id, src])
      if (node.__ldMentionAvatarKey !== avatarKey) {
        clearAvatar(node)
        node.__ldMentionAvatarKey = avatarKey
        avatar.textContent = initial
        if (src) {
          const image = document.createElement('img')
          image.alt = ''
          image.addEventListener('error', () => {
            if (node.__ldMentionAvatarKey !== avatarKey || image.parentNode !== avatar) return
            image.removeAttribute('src')
            avatar.textContent = Array.from(String(node.__ldMentionItem?.name || ''))[0] || ''
          })
          avatar.replaceChildren(image)
          image.setAttribute('src', src)
        }
      } else if (!avatar.querySelector('img')) avatar.textContent = initial
      let main = node.querySelector('.lark-doc-mention-main')
      if (!main) { main = document.createElement('span'); main.className = 'lark-doc-mention-main'; node.appendChild(main) }
      let name = main.querySelector('.lark-doc-mention-row-name')
      if (!name) { name = document.createElement('span'); name.className = 'lark-doc-mention-row-name'; main.appendChild(name) }
      setText(name, item.name)
      let dept = main.querySelector('.lark-doc-mention-row-dept')
      if (item.department) { if (!dept) { dept = document.createElement('span'); dept.className = 'lark-doc-mention-row-dept'; main.appendChild(dept) } setText(dept, item.department) } else if (dept) dept.remove()
      return node
    })
    optionNodes.slice(options.length).forEach(clearAvatar)
    optionNodes = options
    if (!options.length) {
      if (!empty) { empty = document.createElement('p'); empty.className = 'lark-doc-mention-empty' }
      setText(empty, state.loading ? '搜索中…' : state.emptyText)
      syncChildren(refs.list, [{ node: empty, on: true }])
    } else { empty = null; syncChildren(refs.list, options.map((node) => ({ node, on: true }))) }
    const active = state.items?.[state.activeIndex || 0]
    syncChildren(refs.footer, [{ node: refs.notify, on: !!active && (active.kind || 'user') === 'user' }, { node: confirm, on: true }])
    checkbox.checked = !!state.notify
    confirm.disabled = !options.length
    applyStyle(root, state.style || {})
  }

  return {
    el: root,
    update(patch = {}) {
      state = { ...state, ...patch }
      if (!state.open) { optionNodes.forEach(clearAvatar); if (root) mountNode(host, root, false); return }
      if (!root) { Object.assign(refs, build()); this.el = root }
      render()
      mountNode(host, root, true)
    },
    destroy() { optionNodes.forEach(clearAvatar); if (root) mountNode(host, root, false); root = null; tabNodes = []; optionNodes = [] },
  }
}
