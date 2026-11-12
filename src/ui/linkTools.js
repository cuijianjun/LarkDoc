import { mountNode, syncChildren } from './dom'
import { iconNode, setIcon } from './icon'

const VIEWS = [['link', '链接视图', 'link-view-link'], ['title', '标题视图', 'link-view-title'], ['card', '卡片视图', 'link-view-card'], ['preview', '预览视图', 'link-view-preview']]

export function createLinkTools({ host, handlers = {} }) {
  const el = document.createElement('div')
  el.className = 'lark-doc-link-tools'
  el.setAttribute('role', 'toolbar')
  el.setAttribute('aria-label', '链接工具')
  const url = document.createElement('a')
  url.className = 'lark-doc-link-tools-url'
  url.target = '_blank'
  url.rel = 'noopener noreferrer'
  el.appendChild(url)
  const refresh = button('刷新预览', 'refresh', () => handlers.onRefresh?.())
  const redirect = button('打开原网页', 'open-external', () => handlers.onOpen?.())
  let hoverTimer
  const menus = []
  function button(label, icon, action) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.setAttribute('aria-label', label)
    btn.title = label
    if (icon) btn.appendChild(iconNode(icon, 18))
    btn.addEventListener('click', action)
    el.appendChild(btn)
    return btn
  }
  function divider() {
    const span = document.createElement('span')
    span.className = 'lark-doc-link-tools-divider'
    el.appendChild(span)
    return span
  }
  const edit = button('编辑链接', 'mode-edit', () => handlers.onEdit?.())
  const remove = button('移除链接', 'link-unset', () => handlers.onRemove?.())
  const leadingDivider = divider()
  const view = button('链接视图', 'link-view-title', () => toggle(viewMenu, view))
  view.className = 'lark-doc-link-view-trigger'
  const viewLabel = document.createElement('span')
  view.appendChild(viewLabel)
  const caret = document.createElement('span')
  caret.className = 'lark-doc-link-view-caret'
  caret.appendChild(iconNode('link-view-caret', 14))
  view.appendChild(caret)
  divider().classList.add('is-full')
  const more = button('更多链接操作', 'link-view-more', () => toggle(moreMenu, more))
  const share = button('分享', 'share-link', () => handlers.onShare?.())
  const commentDivider = divider()
  const comment = button('添加评论', 'mode-comment', () => { if (!comment.disabled) handlers.onComment?.() })
  function submenu(trigger, label) {
    trigger.setAttribute('aria-haspopup', 'menu')
    trigger.setAttribute('aria-expanded', 'false')
    const menu = document.createElement('div')
    menu.className = 'lark-doc-link-view-menu'
    menu.setAttribute('role', 'menu')
    menu.setAttribute('aria-label', label)
    menu.hidden = true
    el.appendChild(menu)
    menus.push([menu, trigger])
    trigger.addEventListener('mouseenter', () => {
      clearTimeout(hoverTimer)
      hoverTimer = setTimeout(() => open(menu, trigger), 150)
    })
    trigger.addEventListener('mouseleave', () => clearTimeout(hoverTimer))
    return menu
  }
  const viewMenu = submenu(view, '链接显示视图')
  const moreMenu = submenu(more, '链接复制操作')
  function open(menu, trigger) {
    menus.forEach(([node, button]) => { node.hidden = node !== menu; button.setAttribute('aria-expanded', String(node === menu)) })
    const win = el.ownerDocument.defaultView
    const box = trigger.getBoundingClientRect()
    const toolbar = el.getBoundingClientRect()
    const rect = menu.getBoundingClientRect()
    menu.style.left = `${Math.max(8, Math.min(box.left - 9, win.innerWidth - rect.width - 8))}px`
    menu.style.top = `${Math.max(8, toolbar.bottom + rect.height + 4 <= win.innerHeight ? toolbar.bottom + 4 : toolbar.top - rect.height - 4)}px`
  }
  function toggle(menu, trigger) {
    clearTimeout(hoverTimer)
    if (menu.hidden) open(menu, trigger)
    else { menu.hidden = true; trigger.setAttribute('aria-expanded', 'false') }
  }
  const choices = VIEWS.map(([id, label, icon]) => {
    const item = document.createElement('button')
    item.type = 'button'
    item.setAttribute('role', 'menuitemradio')
    item.setAttribute('aria-label', label)
    item.dataset.view = id
    const iconBox = document.createElement('span')
    iconBox.className = 'lark-doc-link-menu-icon'
    iconBox.appendChild(iconNode(icon, 18))
    item.appendChild(iconBox)
    const text = document.createElement('span')
    text.textContent = label
    item.appendChild(text)
    const check = document.createElement('span')
    check.className = 'lark-doc-link-view-check'
    check.textContent = '✓'
    item.appendChild(check)
    item.addEventListener('click', () => { viewMenu.hidden = true; handlers.onView?.(id) })
    viewMenu.appendChild(item)
    return item
  })
  ;[['rich', '复制链接'], ['url', '复制原始网页链接']].forEach(([kind, label]) => {
    const item = document.createElement('button')
    item.type = 'button'
    item.textContent = label
    item.setAttribute('role', 'menuitem')
    item.addEventListener('click', () => { moreMenu.hidden = true; handlers.onCopy?.(kind) })
    moreMenu.appendChild(item)
  })
  el.addEventListener('pointerdown', event => event.preventDefault())
  el.addEventListener('mouseenter', () => handlers.onKeep?.())
  el.addEventListener('mouseleave', () => { clearTimeout(hoverTimer); handlers.onLeave?.() })
  return {
    el,
    update(state = {}) {
      mountNode(host, el, !!state.open)
      if (!state.open) { clearTimeout(hoverTimer); menus.forEach(([menu]) => { menu.hidden = true }); return }
      url.href = state.href
      url.textContent = state.href
      url.title = state.href
      const preview = state.view === 'preview'
      const card = state.view === 'card'
      mountNode(el, share, (preview || card) && !!state.shareVisible)
      mountNode(el, commentDivider, (preview || card) && !!state.commentVisible)
      mountNode(el, comment, (preview || card) && !!state.commentVisible)
      for (const node of [share, commentDivider, comment]) if (node.parentNode === el) el.insertBefore(node, viewMenu)
      comment.disabled = !state.canComment
      comment.title = state.canComment ? '添加评论' : '当前没有评论权限'
      el.classList.toggle('is-preview', preview)
      el.classList.toggle('is-card', card)
      url.hidden = preview || card
      leadingDivider.hidden = card
      refresh.hidden = redirect.hidden = !preview
      edit.hidden = remove.hidden = preview || card || !!state.readonly
      view.hidden = !!state.readonly
      const currentView = VIEWS.find(([id]) => id === state.view) || VIEWS[1]
      viewLabel.textContent = currentView[1]
      setIcon(view.firstElementChild, currentView[2], 18)
      choices.forEach(item => {
        item.setAttribute('aria-checked', String(item.dataset.view === state.view))
      })
      syncChildren(viewMenu, choices.map(item => ({ node: item, on: !state.views || state.views.includes(item.dataset.view) })))
      const win = el.ownerDocument.defaultView
      const rect = el.getBoundingClientRect()
      const bounds = host.closest('.lark-doc')?.getBoundingClientRect()
      const minLeft = Math.max(8, (bounds?.left || 0) + 8)
      const maxRight = Math.min(win.innerWidth, bounds?.right || win.innerWidth) - 8
      el.style.left = `${Math.max(minLeft, Math.min((state.left + (state.right ?? state.left)) / 2 - rect.width / 2, maxRight - rect.width))}px`
      el.style.top = `${state.top >= rect.height + 8 ? state.top - rect.height - 8 : state.bottom + 8}px`
    },
    destroy() { clearTimeout(hoverTimer); mountNode(host, el, false) },
  }
}
