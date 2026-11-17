/** Private create/More surfaces. The top bar supplies live state and shared menu ownership. */
import { applyStyle, mountNode, setAttr, syncChildren } from './dom'
import { iconNode } from './icon'

export function createTopBarMenus(options) {
  const { el, mobileButton, moreButton, createButton, call, activeMoreMenus } = options
  let destroyed = false
  const isDisposed = () => destroyed || options.isDisposed()
  // 弹层独占一个子宿主，不能让工作台或通知的更新摘掉菜单。
  const menus = document.createElement('div')
  const createMenu = document.createElement('div')
  createMenu.className = 'lark-doc-create-menu'
  createMenu.setAttribute('role', 'menu')
  createMenu.setAttribute('aria-label', '新建')
  const createList = document.createElement('div')
  createList.className = 'lark-doc-create-menu-list'
  createMenu.appendChild(createList)
  const moreMenu = document.createElement('div')
  moreMenu.className = 'lark-doc-topbar-more'
  moreMenu.setAttribute('role', 'menu')
  moreMenu.setAttribute('aria-label', '更多')
  moreMenu.tabIndex = -1
  const moreList = document.createElement('div')
  moreList.className = 'lark-doc-topbar-more-list'
  moreMenu.appendChild(moreList)
  const submenu = document.createElement('div')
  submenu.className = 'lark-doc-topbar-more-submenu'
  submenu.setAttribute('role', 'menu')
  moreMenu.appendChild(submenu)
  const refs = options.refs || {}
  Object.assign(refs, { createMenu, createMenuList: createList, topbarMoreMenu: moreMenu, topbarMoreSubmenu: submenu })
  const menuDocument = el.ownerDocument
  const moreTriggerNode = options.moreTriggerNode
  function dismissMore(restoreFocus = false) {
    if (isDisposed() || !moreMenu.isConnected) return
    options.setMoreDismissed(true)
    moreMenu.remove()
    if (!menus.children.length) menus.remove()
    if (activeMoreMenus.get(menuDocument) === moreMenu) activeMoreMenus.delete(menuDocument)
    setAttr(mobileButton, 'aria-expanded', String(options.getMobileOpen()))
    setAttr(moreButton, 'aria-expanded', 'false')
    call('closeTopbarMore')
    if (restoreFocus && moreTriggerNode().isConnected) moreTriggerNode().focus({ preventScroll: true })
  }
  const closeMoreOutside = event => {
    if (!moreMenu.contains(event.target) && !moreTriggerNode().contains(event.target)) dismissMore()
  }
  const closeMoreEscape = event => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || activeMoreMenus.get(menuDocument) !== moreMenu) return
    const owner = el.closest('.lark-doc'), targetOwner = event.target.closest?.('.lark-doc')
    if (targetOwner && targetOwner !== owner) return
    if (!moreMenu.contains(event.target) && event.target.closest?.('[role="dialog"], [role="listbox"]')) return
    if (!moreMenu.isConnected) return
    event.preventDefault(); event.stopPropagation(); dismissMore(true)
  }
  moreMenu.addEventListener('focusin', () => { if (!isDisposed() && moreMenu.isConnected) activeMoreMenus.set(menuDocument, moreMenu) })
  menuDocument.addEventListener('pointerdown', closeMoreOutside)
  menuDocument.addEventListener('keydown', closeMoreEscape)
  const shortcuts = document.createElement('div'), shortcutNodes = new Map()
  shortcuts.className = 'lark-doc-mobile-shortcuts'; shortcuts.setAttribute('aria-label', '文档快捷操作')
  const shortcutDefinitions = [['share', '分享', 'share-link'], ['ai', '问问AI', 'sparkle'], ['add-navigation', '添加到导航栏', 'outline'], ['floating-window', '浮窗', 'copy'], ['move', '移动到', 'move-down'], ['pin', '置顶', 'outline'], ['favorite', '收藏', 'sparkle'], ['offline', '离线使用', 'rev-next'], ['shortcut', '快捷方式', 'link']]
  function syncShortcuts(state) {
    const on = state.referenceMobileMenu === true && window.matchMedia?.('(max-width:760px) and (pointer:coarse)').matches
    if (!on) { shortcuts.remove(); return }
    const rows = state.topbarMoreRows || []
    for (const [id, label, icon] of shortcutDefinitions) {
      let node = shortcutNodes.get(id)
      if (!node) {
        node = document.createElement('button'); node.type = 'button'; node.dataset.shortcut = id
        node.append(iconNode(icon, 24), document.createElement('span'), document.createElement('small'))
        node.addEventListener('click', event => {
          if (isDisposed() || !node.isConnected || node.disabled) return
          if (id === 'share') call('openMembers', event)
          else if (node._item) call('topbarMoreItem', node._item, event)
          else call('mobileHostAction', id)
        })
        shortcutNodes.set(id, node); shortcuts.appendChild(node)
      }
      node._item = rows.map(row => row.item || row).find(item => item.id === id) || null
      node.disabled = id === 'share' ? state.membersEnabled !== true : node._item ? node._item.enabled === false || node._item.disabled === true : state.mobileShortcutCapabilities?.[id] !== true
      node.querySelector('span:not(.lark-doc-icon)').textContent = node._item?.label || label
      node.querySelector('small').textContent = node.disabled ? '暂不可用' : ''
      node.title = node.disabled ? `${label}服务尚未配置或当前不可用` : label
    }
    if (shortcuts.parentNode !== moreMenu) moreMenu.insertBefore(shortcuts, moreList)
  }
  const menuRows = new Map()
  ;[createMenu, moreMenu, submenu].forEach(menu => {
    menu.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (menu !== createMenu) dismissMore(true)
        else { call('closeCreateMenu'); (window.innerWidth <= 760 ? mobileButton : createButton).focus() }
        return
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      event.stopPropagation()
      const list = menu === moreMenu ? moreList : menu
      const items = [...list.querySelectorAll('button:not(:disabled)')]
      if (!items.length) return
      event.preventDefault()
      const index = items.indexOf(document.activeElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length
      items[next].focus()
    })
  })
  function updateMenu(parent, entries, kind, state) {
    const children = entries.map((entry, index) => {
      const item = entry.item || entry
      const id = `${kind}:${item.id || index}`
      let node = menuRows.get(id)
      if (!node) {
        node = document.createElement(entry.kind === 'divider' || entry.kind === 'group' ? 'div' : 'button')
        if (node.tagName === 'BUTTON') {
          node.type = 'button'
          node.setAttribute('role', 'menuitem')
          node.addEventListener('click', event => {
            if (!node.disabled && node.isConnected) call(kind === 'create' ? 'createMenuItem' : kind === 'more' ? 'topbarMoreItem' : 'topbarMoreSubmenuItem', node._item, event)
          })
          if (kind === 'more') node.addEventListener('mouseenter', () => call('hoverTopbarMoreItem', node._item))
        }
        menuRows.set(id, node)
      }
      node._item = item
      node.className = entry.kind === 'divider' ? (kind === 'create' ? 'lark-doc-create-menu-divider' : 'lark-doc-topbar-more-divider') : entry.kind === 'group' ? 'lark-doc-create-menu-group' : kind === 'create' ? 'lark-doc-create-menu-item' : kind === 'sub' ? 'lark-doc-topbar-more-submenu-item' : 'lark-doc-topbar-more-item'
      const label = entry.kind === 'divider' ? '' : item.label
      const renderLabel = `${label}|${item.icon || ''}|${item.arrow || item.affordance || ''}`
      if (node._renderLabel !== renderLabel) {
        node._renderLabel = renderLabel
        node.textContent = ''
        const text = document.createElement('span')
        text.className = kind === 'create' ? 'lark-doc-create-menu-label' : 'lark-doc-topbar-more-item-label'
        text.textContent = label || ''
        node.appendChild(text)
        if (node.tagName === 'BUTTON' && item.icon) {
          const icon = document.createElement('span')
          icon.className = kind === 'create' ? 'lark-doc-create-menu-icon' : 'lark-doc-topbar-more-item-icon'
          icon.style.color = item.iconColor || ''
          icon.appendChild(iconNode(item.icon, 16))
          node.prepend(icon)
        }
        if (item.affordance === 'arrow' || item.arrow) {
          const arrow = document.createElement('span')
          arrow.className = kind === 'create' ? 'lark-doc-create-menu-arrow' : 'lark-doc-topbar-more-item-arrow'
          arrow.setAttribute('aria-hidden', 'true')
          if (kind === 'create') arrow.appendChild(iconNode('chevron-right', 13))
          node.appendChild(arrow)
        }
      }
      if (entry.kind === 'divider') node.setAttribute('role', 'separator')
      if (entry.kind === 'group') node.setAttribute('role', 'presentation')
      if (node.tagName === 'BUTTON') {
        node.classList.toggle('is-submenu', item.kind === 'submenu')
        node.classList.toggle('is-switch', item.kind === 'switch')
        setAttr(node, 'data-create-menu-id', kind === 'create' ? item.id : null)
        const parentItem = (state.topbarMoreRows || []).find(row => row.item?.id === state.topbarMoreSubmenu)?.item
        node.disabled = item.enabled === false || item.disabled === true || (kind === 'create' && !!state.readonly) || (kind === 'sub' && parentItem?.enabled === false)
        node.title = item.title || item.label || ''
        node.classList.toggle('is-disabled', node.disabled)
        node.style.width = '100%'
        node.style.textAlign = 'left'
        setAttr(node, 'aria-disabled', String(node.disabled))
        setAttr(node, 'data-topbar-more-id', kind === 'more' ? item.id : null)
        const capability = options.capabilities[kind === 'sub' ? state.topbarMoreSubmenu : item.id]
        setAttr(node, 'data-capability', capability || null)
        setAttr(node, 'aria-haspopup', item.kind === 'submenu' ? 'menu' : null)
        setAttr(node, 'aria-expanded', item.kind === 'submenu' ? String(state.topbarMoreSubmenu === item.id) : null)
        if (item.kind === 'switch') {
          node.setAttribute('role', 'menuitemcheckbox')
          const checked = typeof item.checked === 'boolean' ? item.checked : item.id === 'show-author' ? !!state.topbarMoreShowAuthor : !!state.topbarMoreOffline
          setAttr(node, 'aria-checked', String(checked))
          let toggle = node.querySelector('.lark-doc-topbar-more-switch')
          if (!toggle) {
            toggle = document.createElement('span')
            toggle.className = 'lark-doc-topbar-more-switch'
            toggle.setAttribute('aria-hidden', 'true')
            const thumb = document.createElement('span')
            thumb.className = 'lark-doc-topbar-more-switch-handler'
            toggle.appendChild(thumb)
            node.appendChild(toggle)
          }
          toggle.classList.toggle('is-on', checked)
        }
      }
      return { node, on: true }
    })
    syncChildren(parent, children)
  }

  function update() {
    if (isDisposed()) return
    const state = options.readState(), visible = state.headerVisible !== false
    const moreWasOpen = moreMenu.isConnected
    updateMenu(createList, state.createMenuRows || [], 'create', state)
    updateMenu(moreList, state.topbarMoreRows || [], 'more', state)
    syncShortcuts(state)
    setAttr(submenu, 'aria-label', `更多-${state.topbarMoreSubmenu || ''}`)
    updateMenu(submenu, state.topbarMoreSubmenuItems || [], 'sub', state)
    applyStyle(createMenu, Object.fromEntries(Object.entries(state.createMenuStyle || {}).map(([key, value]) => [key, typeof value === 'number' ? `${value}px` : value])))
    applyStyle(moreMenu, Object.fromEntries(Object.entries(state.topbarMoreStyle || {}).map(([key, value]) => [key, typeof value === 'number' ? `${value}px` : value])))
    applyStyle(submenu, Object.fromEntries(Object.entries(state.topbarMoreSubmenuStyle || {}).map(([key, value]) => [key, typeof value === 'number' ? `${value}px` : value])))
    mountNode(moreMenu, submenu, !!state.topbarMoreSubmenu && !!state.topbarMoreSubmenuItems?.length)
    syncChildren(menus, [
      { node: createMenu, on: visible && !!state.createMenuOpen && !state.readonly },
      { node: moreMenu, on: visible && !!state.topbarMoreOpen && !options.getMoreDismissed() },
    ])
    if (options.host) mountNode(options.host, menus, menus.children.length > 0)
    if (moreMenu.isConnected && !moreWasOpen) {
      activeMoreMenus.set(menuDocument, moreMenu)
      if (options.canFocusOnOpen?.() !== false) (moreList.querySelector('button:not(:disabled):not([aria-disabled="true"])') || moreMenu).focus({ preventScroll: true })
    } else if (!moreMenu.isConnected && activeMoreMenus.get(menuDocument) === moreMenu) activeMoreMenus.delete(menuDocument)
  }
  function destroy() {
    if (destroyed) return
    destroyed = true
    menuDocument.removeEventListener('pointerdown', closeMoreOutside)
    menuDocument.removeEventListener('keydown', closeMoreEscape)
    if (activeMoreMenus.get(menuDocument) === moreMenu) activeMoreMenus.delete(menuDocument)
    menus.remove()
    menuRows.clear(); shortcutNodes.clear(); shortcuts.remove()
    ;['createMenu', 'createMenuList', 'topbarMoreMenu', 'topbarMoreSubmenu'].forEach(key => {
      if ([createMenu, createList, moreMenu, submenu].includes(refs[key])) delete refs[key]
    })
  }
  return { el: menus, update, destroy }
}
