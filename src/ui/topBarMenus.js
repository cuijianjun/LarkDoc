/** Private create/More surfaces. The top bar supplies live state and shared menu ownership. */
import { applyStyle, mountNode, setAttr, syncChildren } from './dom'
import { iconNode } from './icon'
import { NOTIFY_BRAND_BLUE, NOTIFY_ON_BRAND, NOTIFY_SUCCESS_GREEN } from './palette'

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
  const createChildren = document.createElement('div')
  createChildren.dataset.createSubmenu = ''
  createChildren.setAttribute('role', 'menu')
  createChildren.setAttribute('aria-label', '上传及导入')
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
  // 飞书「关注文档更新」hover 引导卡：静态预览 + 说明，不接收指针事件。
  const followTip = document.createElement('div')
  followTip.className = 'lark-doc-follow-tip'
  followTip.setAttribute('role', 'tooltip')
  const followLogo = `<span class="lark-doc-follow-tip-logo"><svg width="24" height="24" viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="${NOTIFY_BRAND_BLUE}"/><path d="M11 8h7l4 4v12H11z" fill="${NOTIFY_ON_BRAND}"/><path d="M15 13h4M15 16.5h4M15 20h2" stroke="${NOTIFY_BRAND_BLUE}" stroke-width="1.5" stroke-linecap="round"/></svg></span>`
  followTip.innerHTML = `<div class="lark-doc-follow-tip-preview"><div class="lark-doc-follow-tip-app">${followLogo}<span class="lark-doc-follow-tip-name">云文档助手</span><span class="lark-doc-follow-tip-tag">机器人</span></div><div class="lark-doc-follow-tip-feed">${followLogo}<div class="lark-doc-follow-tip-msg"><b>文档内容变更提醒</b><p><em>@李天天</em> 编辑了文档 <em>项目进展</em></p><span class="lark-doc-follow-tip-btn">查看变更详情</span></div></div></div><p class="lark-doc-follow-tip-desc">开启后，云文档助手将在文档更新时通知你，时刻掌握文档动态。</p>`
  const tipHost = () => options.host || el
  const hideFollowTip = () => { followTip.remove() }
  function showFollowTip(node) {
    if (isDisposed() || !node.isConnected) return
    followTip._owner = node
    if (followTip.parentNode !== tipHost()) tipHost().appendChild(followTip)
    const rect = node.getBoundingClientRect(), tip = followTip.getBoundingClientRect()
    applyStyle(followTip, {
      left: `${Math.max(8, rect.left - tip.width - 12)}px`,
      top: `${Math.max(8, Math.min(rect.top + rect.height / 2 - tip.height / 2, window.innerHeight - tip.height - 8))}px`,
      visibility: 'visible',
    })
  }
  const docToast = document.createElement('div')
  docToast.className = 'lark-doc-doc-toast'
  docToast.setAttribute('role', 'status')
  docToast.innerHTML = `<span class="lark-doc-doc-toast-icon" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="8" fill="${NOTIFY_SUCCESS_GREEN}"/><path d="m4.8 8.1 2 2 4.4-4.5" stroke="${NOTIFY_ON_BRAND}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span class="lark-doc-doc-toast-text"></span>`
  const docToastText = docToast.querySelector('.lark-doc-doc-toast-text')
  const refs = options.refs || {}
  Object.assign(refs, { createMenu, createMenuList: createList, topbarMoreMenu: moreMenu, topbarMoreSubmenu: submenu })
  const menuDocument = el.ownerDocument
  const moreTriggerNode = options.moreTriggerNode
  function dismissMore(restoreFocus = false) {
    if (isDisposed() || !moreMenu.isConnected) return
    hideFollowTip()
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
  let createChildrenOpen = false, submenuHover
  ;[createMenu, moreMenu, submenu].forEach(menu => {
    menu.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (menu !== createMenu) dismissMore(true)
        else if (createChildrenOpen && createChildren.contains(event.target)) {
          createChildrenOpen = false; update()
          createList.querySelector('[data-create-menu-id="import"]')?.focus()
        } else { call('closeCreateMenu'); (window.innerWidth <= 760 ? mobileButton : createButton).focus() }
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
      const id = `${kind}:${item.id || index}:${item.value ?? ''}`
      let node = menuRows.get(id)
      if (!node) {
        node = document.createElement(entry.kind === 'divider' || entry.kind === 'group' ? 'div' : 'button')
        if (node.tagName === 'BUTTON') {
          node.type = 'button'
          node.setAttribute('role', 'menuitem')
          node.addEventListener('click', event => {
            clearTimeout(submenuHover)
            if (node.disabled || !node.isConnected) return
            if (kind === 'create' && node._item.children) {
              createChildrenOpen = !createChildrenOpen
              update()
              if (createChildrenOpen) createChildren.querySelector('button:not(:disabled)')?.focus({ preventScroll: true })
            } else call(kind.startsWith('create') ? 'createMenuItem' : kind === 'more' ? 'topbarMoreItem' : 'topbarMoreSubmenuItem', node._item, event)
          })
          if (kind === 'more') {
            node.addEventListener('mouseenter', () => { if (!options.readState().compactHeader) call('hoverTopbarMoreItem', node._item) })
            node.addEventListener('mouseenter', () => { if (node._item?.id === 'follow' && !node.disabled) showFollowTip(node) })
            node.addEventListener('mouseleave', hideFollowTip)
            node.addEventListener('focus', () => { if (node._item?.id === 'follow' && !node.disabled) showFollowTip(node) })
            node.addEventListener('blur', hideFollowTip)
            node.addEventListener('pointerenter', event => {
              if (!options.readState().compactHeader || event.pointerType !== 'mouse' || node._item.kind !== 'submenu' || node.disabled) return
              clearTimeout(submenuHover)
              submenuHover = setTimeout(() => {
                if (node.isConnected && !node.disabled && node.getAttribute('aria-expanded') !== 'true') call('topbarMoreItem', node._item, { detail: 1 })
              }, 450)
            })
            node.addEventListener('pointerleave', () => clearTimeout(submenuHover))
          }
        }
        menuRows.set(id, node)
      }
      node._item = item
      node.className = entry.kind === 'divider' ? (kind === 'create' ? 'lark-doc-create-menu-divider' : 'lark-doc-topbar-more-divider') : entry.kind === 'group' ? 'lark-doc-create-menu-group' : kind.startsWith('create') ? 'lark-doc-create-menu-item' : kind === 'sub' ? 'lark-doc-topbar-more-submenu-item' : 'lark-doc-topbar-more-item'
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
        setAttr(node, 'data-create-menu-id', kind.startsWith('create') ? item.id : null)
        const parentItem = (state.topbarMoreRows || []).find(row => row.item?.id === state.topbarMoreSubmenu)?.item
        node.disabled = item.enabled === false || item.disabled === true || (kind === 'create' && !!state.readonly) || (kind === 'sub' && parentItem?.enabled === false)
        if (item.id === 'follow' && (node.disabled || item.kind !== 'switch')) hideFollowTip()
        node.title = item.title || item.label || ''
        node.classList.toggle('is-disabled', node.disabled)
        node.style.width = '100%'
        node.style.textAlign = 'left'
        setAttr(node, 'aria-disabled', String(node.disabled))
        setAttr(node, 'data-topbar-more-id', kind === 'more' ? item.id : null)
        const capability = options.capabilities[kind === 'sub' ? state.topbarMoreSubmenu : item.id]
        setAttr(node, 'data-capability', capability || null)
        setAttr(node, 'aria-haspopup', item.kind === 'submenu' || item.children ? 'menu' : null)
        setAttr(node, 'aria-expanded', item.children ? String(createChildrenOpen) : item.kind === 'submenu' ? String(state.topbarMoreSubmenu === item.id) : null)
        if (item.kind !== 'switch' && typeof item.checked === 'boolean') {
          node.setAttribute('role', 'menuitemradio')
          setAttr(node, 'aria-checked', String(item.checked))
        }
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
    if (!state.topbarMoreOpen) hideFollowTip()
    if (state.docToast) {
      if (docToast.parentNode !== tipHost()) tipHost().appendChild(docToast)
      docToastText.textContent = state.docToast
    } else if (docToast.parentNode) { docToast.remove(); docToastText.textContent = '' }
    const createOpen = state.createMenuOpen && (!state.compactHeader || window.innerWidth <= 760)
    if (!createOpen || !visible || state.readonly) createChildrenOpen = false
    const moreWasOpen = moreMenu.isConnected
    submenu.classList.toggle('is-width-settings', state.compactHeader === true && state.topbarMoreSubmenu === 'width')
    updateMenu(createList, state.createMenuRows || [], 'create', state)
    const children = (state.createMenuRows || []).find(row => row.children)?.children
    if (createChildrenOpen && children) updateMenu(createChildren, children, 'create-child', state)
    mountNode(createMenu, createChildren, createChildrenOpen && !!children)
    updateMenu(moreList, state.topbarMoreRows || [], 'more', state)
    syncShortcuts(state)
    setAttr(submenu, 'aria-label', `更多-${state.topbarMoreSubmenu || ''}`)
    updateMenu(submenu, state.topbarMoreSubmenuItems || [], 'sub', state)
    applyStyle(createMenu, Object.fromEntries(Object.entries(state.createMenuStyle || {}).map(([key, value]) => [key, typeof value === 'number' ? `${value}px` : value])))
    applyStyle(moreMenu, Object.fromEntries(Object.entries(state.topbarMoreStyle || {}).map(([key, value]) => [key, typeof value === 'number' ? `${value}px` : value])))
    applyStyle(submenu, Object.fromEntries(Object.entries(state.topbarMoreSubmenuStyle || {}).map(([key, value]) => [key, typeof value === 'number' ? `${value}px` : value])))
    mountNode(moreMenu, submenu, !!state.topbarMoreSubmenu && !!state.topbarMoreSubmenuItems?.length)
    syncChildren(menus, [
      { node: createMenu, on: visible && !!createOpen && !state.readonly },
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
    clearTimeout(submenuHover)
    menuDocument.removeEventListener('pointerdown', closeMoreOutside)
    menuDocument.removeEventListener('keydown', closeMoreEscape)
    if (activeMoreMenus.get(menuDocument) === moreMenu) activeMoreMenus.delete(menuDocument)
    menus.remove(); followTip.remove(); docToast.remove()
    menuRows.clear(); shortcutNodes.clear(); shortcuts.remove()
    ;['createMenu', 'createMenuList', 'topbarMoreMenu', 'topbarMoreSubmenu'].forEach(key => {
      if ([createMenu, createList, moreMenu, submenu].includes(refs[key])) delete refs[key]
    })
  }
  return { el: menus, update, destroy }
}
