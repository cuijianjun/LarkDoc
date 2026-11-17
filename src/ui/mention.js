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
  let disposed = false, gesture = null, suppressClickUntil = 0
  const positions = new Map()
  const active = node => !disposed && state.open && root?.isConnected && root.contains(node)
  const choose = node => active(node) && Date.now() >= suppressClickUntil

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

    const header = document.createElement('div')
    header.className = 'lark-doc-mention-mobile-header'
    const cancel = button('lark-doc-mention-cancel')
    setAttr(cancel, 'aria-label', '取消提及'); setText(cancel, '取消')
    cancel.addEventListener('mousedown', event => event.preventDefault())
    cancel.addEventListener('click', () => { if (active(cancel)) handlers.onCancel?.() })
    const title = document.createElement('h3')
    title.className = 'lark-doc-mention-mobile-title'
    header.append(cancel, title)

    const tabs = document.createElement('div')
    tabs.className = 'lark-doc-mention-tabs'
    setAttr(tabs, 'role', 'tablist')
    root.appendChild(tabs)

    const list = document.createElement('div')
    list.className = 'lark-doc-mention-list'
    setAttr(list, 'role', 'listbox')
    root.appendChild(list)
    const recovery = button('lark-doc-mention-confirm')
    recovery.addEventListener('mousedown', event => event.preventDefault())
    recovery.addEventListener('click', () => {
      if (choose(recovery) && !state.loading) {
        if (state.pendingOperation) handlers.onQuery?.()
        else handlers.onRetry?.()
      }
    })
    list.addEventListener('scroll', () => {
      if (state.mobile && state.open && !state.loading) positions.set(state.kind, list.scrollTop)
    })
    list.addEventListener('pointerdown', event => {
      if (!state.mobile || !active(list) || (event.pointerType === 'mouse' && event.button !== 0)) return
      suppressClickUntil = 0
      gesture = { id: event.pointerId, x: event.clientX, y: event.clientY }
    })
    list.addEventListener('pointermove', event => {
      if (!gesture || gesture.id !== event.pointerId) return
      const dx = Math.abs(event.clientX - gesture.x), dy = Math.abs(event.clientY - gesture.y)
      if (dx > 16 || dy > 16) suppressClickUntil = Date.now() + 400
      if (dx > 40 && dx > dy * 1.25) event.preventDefault()
    })
    list.addEventListener('pointerup', event => {
      if (!gesture || gesture.id !== event.pointerId) return
      const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y
      gesture = null
      if (Math.abs(dx) > 16 || Math.abs(dy) > 16) suppressClickUntil = Date.now() + 400
      if (!active(list) || Math.abs(dx) < 40 || Math.abs(dx) <= Math.abs(dy) * 1.25) return
      const tabs = state.tabs || [], index = tabs.findIndex(tab => tab.id === state.kind)
      const next = tabs[index + (dx < 0 ? 1 : -1)]
      if (next) handlers.onKind?.(next.id)
    })
    list.addEventListener('pointercancel', () => { if (gesture) suppressClickUntil = Date.now() + 400; gesture = null })

    const footer = document.createElement('div')
    footer.className = 'lark-doc-mention-footer'
    const label = document.createElement('label')
    label.className = 'lark-doc-mention-notify'
    const preserveFocus = event => { if (state.mobile) event.preventDefault() }
    label.addEventListener('pointerdown', preserveFocus)
    label.addEventListener('mousedown', preserveFocus)
    checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    setAttr(checkbox, 'aria-label', '同时发送通知')
    checkbox.addEventListener('change', () => { if (active(checkbox)) handlers.onNotify?.(checkbox.checked) })
    const labelText = document.createElement('span')
    setText(labelText, '同时发送通知')
    label.append(checkbox, labelText)
    confirm = button('lark-doc-mention-confirm')
    setText(confirm, '提及')
    confirm.addEventListener('mousedown', (event) => { event.preventDefault(); if (active(confirm)) handlers.onChoose?.() })
    footer.append(label, confirm)
    root.appendChild(footer)
    return { header, title, tabs, list, footer, recovery, notify: label }
  }

  const refs = { tabs: null, list: null }
  const render = () => {
    if (!root) Object.assign(refs, build())
    root.classList.toggle('is-mobile', !!state.mobile)
    setText(refs.title, { user: '你可能想提及的人员', page: '你可能想提及的云文档', chat: '你可能想插入的群名片' }[state.kind] || '提及')
    setAttr(root, 'aria-label', state.mobile ? refs.title.textContent : '提及')
    const tabs = (state.tabs || []).map((tab, index) => {
      const node = tabNodes[index] || button('lark-doc-mention-tab')
      setAttr(node, 'role', 'tab')
      setAttr(node, 'aria-selected', state.kind === tab.id ? 'true' : 'false')
      setText(node, tab.label)
      if (!node.__ldMentionBound) {
        node.__ldMentionBound = true
        node.addEventListener('mousedown', (event) => { event.preventDefault(); if (!state.mobile && active(node)) handlers.onKind?.(node.__ldMentionId) })
        node.addEventListener('click', () => { if (state.mobile && active(node)) handlers.onKind?.(node.__ldMentionId) })
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
        node.addEventListener('mousedown', (event) => { event.preventDefault(); if (!state.mobile && choose(node)) handlers.onChoose?.(node.__ldMentionItem) })
        node.addEventListener('click', () => { if (state.mobile && choose(node)) handlers.onChoose?.(node.__ldMentionItem) })
        node.addEventListener('mouseenter', () => { if (!state.mobile && active(node)) handlers.onActive?.(node.__ldMentionIndex) })
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
      if (!empty) { empty = document.createElement('p'); empty.className = 'lark-doc-mention-empty'; setAttr(empty, 'role', 'status') }
      setText(empty, state.loading ? '搜索中…' : state.emptyText)
      setText(refs.recovery, state.pendingOperation ? '查询原请求' : '重新查询')
      syncChildren(refs.list, [{ node: empty, on: true }, { node: refs.recovery, on: !state.loading && !!(state.pendingOperation || state.retry) }])
    } else { empty = null; syncChildren(refs.list, options.map((node) => ({ node, on: true }))) }
    const selected = state.items?.[state.activeIndex || 0]
    syncChildren(refs.footer, [{ node: refs.notify, on: state.mobile ? state.kind === 'user' : !!selected && (selected.kind || 'user') === 'user' }, { node: confirm, on: !state.mobile }])
    syncChildren(root, [{ node: refs.header, on: !!state.mobile }, { node: refs.tabs, on: true }, { node: refs.list, on: true }, { node: refs.footer, on: !state.mobile || state.kind === 'user' }])
    setAttr(refs.list, 'aria-busy', state.loading ? 'true' : 'false')
    if (state.mobile && !state.loading) refs.list.scrollTop = positions.get(state.kind) || 0
    checkbox.checked = !!state.notify
    confirm.disabled = !options.length
    applyStyle(root, state.style || {})
  }

  return {
    el: root,
    update(patch = {}) {
      if (disposed) return
      if (state.mobile && state.open && !state.loading && refs.list) positions.set(state.kind, refs.list.scrollTop)
      if (patch.query !== undefined && patch.query !== state.query) positions.clear()
      state = { ...state, ...patch }
      if (!state.open) { positions.clear(); gesture = null; suppressClickUntil = 0; optionNodes.forEach(clearAvatar); if (root) mountNode(host, root, false); return }
      if (!root) { Object.assign(refs, build()); this.el = root }
      render()
      mountNode(host, root, true)
    },
    destroy() { disposed = true; positions.clear(); gesture = null; optionNodes.forEach(clearAvatar); if (root) mountNode(host, root, false); root = null; tabNodes = []; optionNodes = [] },
  }
}
