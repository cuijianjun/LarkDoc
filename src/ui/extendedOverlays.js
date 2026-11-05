import { applyStyle, mountNode, setAttr, setText, syncChildren } from './dom'
import { iconNode } from './icon'

/** 复用 dev 状态机的链接悬浮卡、确认框、关联表格和代码语言浮层。 */
export function createExtendedOverlays({ host, handlers = {}, refs = {} }) {
  const document = host.ownerDocument
  const call = (name, ...args) => handlers[name]?.(...args)
  const node = (tag, className, text) => {
    const el = document.createElement(tag)
    el.className = className
    if (text !== undefined) setText(el, text)
    return el
  }
  const button = (className, handler, text, eventType = 'click') => {
    const el = node('button', className, text)
    el.type = 'button'
    el.addEventListener(eventType, event => {
      if (eventType === 'mousedown') event.preventDefault()
      if (!el.disabled) call(handler)
    })
    // 保留鼠标按下不丢选区的行为，同时允许键盘/辅助技术激活按钮。
    if (eventType === 'mousedown') el.addEventListener('click', event => {
      if (event.detail === 0 && !el.disabled) call(handler)
    })
    return el
  }
  const escape = (el, handler) => el.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    call(handler)
  })
  const position = (el, style = {}) => applyStyle(el, Object.fromEntries(Object.entries(style).map(([key, value]) => [key, typeof value === 'number' ? `${value}px` : value])))

  const link = node('div', 'lark-doc-link-hover-card')
  escape(link, 'closeLinkHover')
  link.addEventListener('mouseenter', () => call('keepLinkHover'))
  link.addEventListener('mouseleave', () => call('closeLinkHover'))
  const linkToolbar = node('div', 'lark-doc-link-hover-wrapper')
  setAttr(linkToolbar, 'role', 'toolbar')
  setAttr(linkToolbar, 'aria-label', '链接')
  const url = node('a', 'lark-doc-link-hover-url')
  url.target = '_blank'
  url.rel = 'noopener noreferrer'
  const linkIcon = (name, label, icon, handler) => {
    const el = button('lark-doc-link-hover-icon', handler)
    setAttr(el, 'data-name', name)
    setAttr(el, 'aria-label', label)
    el.appendChild(iconNode(icon, 18))
    return el
  }
  const editLink = linkIcon('edit-link', '编辑链接', 'edit', 'editHoveredLink')
  const deleteLink = linkIcon('delete-link', '删除链接', 'trash', 'removeHoveredLink')
  const linkView = button('lark-doc-link-hover-view', 'toggleLinkHoverMenu')
  setAttr(linkView, 'data-name', 'link-to-title')
  setAttr(linkView, 'aria-haspopup', 'menu')
  linkView.addEventListener('mouseenter', () => call('toggleLinkHoverMenu'))
  const linkViewText = node('span', 'lark-doc-link-hover-view-text')
  const linkViewArrow = iconNode('caretSolid', 14)
  linkViewArrow.classList.add('lark-doc-link-hover-view-arrow')
  linkView.append(linkViewText, linkViewArrow)
  linkToolbar.append(url, editLink, deleteLink, node('span', 'lark-doc-link-hover-divider'), linkView,
    node('span', 'lark-doc-link-hover-divider'), linkIcon('more', '更多', 'more', 'onLinkHoverMore'))
  const linkMenu = node('div', 'lark-doc-link-view-menu')
  setAttr(linkMenu, 'role', 'menu')
  setAttr(linkMenu, 'aria-label', '链接显示方式')
  linkMenu.addEventListener('mouseenter', () => call('keepLinkHover'))
  linkMenu.addEventListener('mouseleave', () => call('closeLinkHover'))
  link.appendChild(linkToolbar)
  const linkRows = new Map()

  const confirm = node('div', 'lark-doc-confirm-layer')
  setAttr(confirm, 'role', 'dialog')
  setAttr(confirm, 'aria-modal', 'true')
  escape(confirm, 'closeConfirm')
  const confirmMask = node('div', 'lark-doc-confirm-mask')
  confirmMask.addEventListener('mousedown', event => { event.preventDefault(); call('closeConfirm') })
  const confirmSection = node('section', 'lark-doc-confirm')
  const confirmContent = node('div', 'lark-doc-confirm-content')
  const confirmHeader = node('header', 'lark-doc-confirm-header')
  const confirmIcon = node('span', 'lark-doc-confirm-icon', '!')
  setAttr(confirmIcon, 'aria-hidden', 'true')
  const confirmTitle = node('h3', 'lark-doc-confirm-title')
  confirmHeader.append(confirmIcon, confirmTitle)
  const confirmBody = node('div', 'lark-doc-confirm-body')
  const confirmExtra = button('lark-doc-confirm-extra', 'toggleConfirmExtra', undefined, 'mousedown')
  const confirmCheckbox = node('span', 'lark-doc-confirm-checkbox')
  setAttr(confirmCheckbox, 'aria-hidden', 'true')
  const confirmExtraText = node('span', '')
  confirmExtra.append(confirmCheckbox, confirmExtraText)
  const confirmFooter = node('footer', 'lark-doc-confirm-footer')
  const cancelConfirm = button('lark-doc-confirm-btn is-plain', 'closeConfirm', undefined, 'mousedown')
  const acceptConfirm = button('lark-doc-confirm-btn is-primary', 'acceptConfirm', undefined, 'mousedown')
  confirmFooter.append(cancelConfirm, acceptConfirm)
  confirmSection.appendChild(confirmContent)
  confirm.append(confirmMask, confirmSection)

  const relation = node('div', 'lark-doc-relation-layer')
  setAttr(relation, 'role', 'dialog')
  setAttr(relation, 'aria-modal', 'true')
  setAttr(relation, 'aria-label', '关联已有多维表格')
  escape(relation, 'closeRelationBitable')
  const relationMask = node('div', 'lark-doc-relation-mask')
  relationMask.addEventListener('mousedown', event => { event.preventDefault(); call('closeRelationBitable') })
  const relationContent = node('section', 'lark-doc-relation-content')
  const relationHeader = node('header', 'lark-doc-relation-header')
  const relationBack = button('lark-doc-relation-back', 'backToRelationBase', undefined, 'mousedown')
  setAttr(relationBack, 'aria-label', '返回选择多维表格')
  const backIcon = iconNode('chevron-right', 16)
  backIcon.style.transform = 'rotate(180deg)'
  relationBack.appendChild(backIcon)
  const relationTitle = node('h3', 'lark-doc-relation-title')
  const relationCrumb = node('span', 'lark-doc-relation-crumb')
  const relationBody = node('div', 'lark-doc-relation-body')
  const relationList = node('ul', 'lark-doc-relation-list')
  const relationHint = node('div', 'lark-doc-relation-empty')
  const relationFooter = node('footer', 'lark-doc-relation-footer')
  const relationSelection = node('span', 'lark-doc-relation-selection')
  const relationAccept = button('lark-doc-relation-btn is-primary', 'confirmRelationBitable', '确认', 'mousedown')
  relationFooter.append(relationSelection, button('lark-doc-relation-btn is-plain', 'closeRelationBitable', '取消', 'mousedown'), relationAccept)
  relationContent.append(relationHeader, relationBody, relationFooter)
  relation.append(relationMask, relationContent)
  const relationRows = new Map()

  const code = node('div', 'lark-doc-code-lang')
  setAttr(code, 'role', 'dialog')
  setAttr(code, 'aria-label', '代码语言')
  // 阻止根节点和 window 对同一次 Esc 再收掉底层浮层。
  escape(code, 'closeCodeLangPicker')
  const codeCard = node('div', 'lark-doc-code-lang-card')
  const codeSearch = node('div', 'lark-doc-code-lang-search')
  const searchIcon = iconNode('search', 14)
  searchIcon.classList.add('lark-doc-code-lang-search-icon')
  const codeInput = node('input', 'lark-doc-code-lang-search-input')
  codeInput.type = 'text'
  codeInput.placeholder = '搜索语言'
  setAttr(codeInput, 'aria-label', '搜索代码语言')
  codeInput.addEventListener('input', () => call('setCodeLangQuery', codeInput.value))
  const codeContainer = node('div', 'lark-doc-code-lang-list-container')
  const codeList = node('ul', 'lark-doc-code-lang-list')
  setAttr(codeList, 'role', 'listbox')
  setAttr(codeList, 'aria-label', '代码语言列表')
  codeContainer.appendChild(codeList)
  codeSearch.append(searchIcon, codeInput)
  codeCard.append(codeSearch, codeContainer)
  code.appendChild(codeCard)
  refs.codeLangInput = codeInput
  const codeRows = new Map()
  let cursor = 0
  let state = {}
  let codeOpen = false
  let codeQuery = ''
  function syncCursor(scroll = false) {
    Array.from(codeList.children).forEach((el, index) => el.classList.toggle('is-cursor', index === cursor))
    if (scroll) codeList.children[cursor]?.scrollIntoView?.({ block: 'nearest' })
  }
  codeInput.addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return
    event.preventDefault()
    event.stopPropagation()
    const items = state.codeLangItems || []
    if (!items.length) return
    if (event.key === 'Enter') call('pickCodeLanguage', items[cursor].id)
    else { cursor = (cursor + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length; syncCursor(true) }
  })

  function update(next = {}) {
    state = next
    position(link, state.linkHoverStyle)
    setText(url, state.linkHoverLabel)
    setAttr(url, 'title', state.linkHoverLabel)
    setAttr(url, 'href', state.linkHoverSafeHref || null)
    deleteLink.disabled = !state.writable
    const modes = state.linkViewModes || []
    setText(linkViewText, modes.find(mode => mode.id === state.linkHoverView)?.label || '链接视图')
    setAttr(linkView, 'aria-expanded', String(!!state.linkHoverMenuOpen))
    syncChildren(linkMenu, modes.map(mode => {
      let row = linkRows.get(mode.id)
      if (!row) {
        row = button('lark-doc-link-view-item', null)
        row.addEventListener('click', () => call('setLinkHoverView', mode.id))
        setAttr(row, 'role', 'menuitemradio')
        const text = node('span', 'lark-doc-link-view-text')
        const check = iconNode('check', 16)
        check.classList.add('lark-doc-link-view-check')
        row.append(text, check)
        linkRows.set(mode.id, row)
      }
      setText(row.firstChild, mode.label)
      row.classList.toggle('menu-item-actived', !!mode.active)
      setAttr(row, 'aria-checked', String(!!mode.active))
      row.lastChild.style.display = mode.active ? '' : 'none'
      return { node: row, on: true }
    }))
    mountNode(link, linkMenu, !!state.linkHoverMenuOpen)
    mountNode(host, link, !!state.linkHoverOpen)

    setAttr(confirm, 'aria-label', state.confirmTitle)
    setText(confirmTitle, state.confirmTitle)
    setText(confirmBody, state.confirmBody)
    setText(confirmExtraText, state.confirmExtra)
    setAttr(confirmExtra, 'aria-pressed', String(!!state.confirmExtraChecked))
    confirmCheckbox.classList.toggle('is-on', !!state.confirmExtraChecked)
    setText(cancelConfirm, state.confirmCancelText)
    setText(acceptConfirm, state.confirmPrimaryText)
    syncChildren(confirmContent, [
      { node: confirmHeader, on: true }, { node: confirmBody, on: true },
      { node: confirmExtra, on: !!state.confirmExtra }, { node: confirmFooter, on: true },
    ])
    mountNode(host, confirm, !!state.confirmOpen)

    const tableStep = state.relationStep === 'table'
    setText(relationTitle, tableStep ? '选择数据表' : '关联已有多维表格')
    setText(relationCrumb, state.relationBaseName)
    syncChildren(relationHeader, [{ node: relationBack, on: tableStep }, { node: relationTitle, on: true }, { node: relationCrumb, on: tableStep }])
    const entries = (tableStep ? state.relationTables : state.relationBases) || []
    syncChildren(relationList, entries.map(entry => {
      const id = tableStep ? entry.tableId : entry.appToken
      const key = `${state.relationStep}:${id}`
      let row = relationRows.get(key)
      if (!row) {
        row = node('li', 'lark-doc-relation-item')
        setAttr(row, 'role', 'button')
        row.tabIndex = 0
        const pick = () => call(tableStep ? 'pickRelationTable' : 'pickRelationBase', row._entry)
        row.addEventListener('mousedown', event => { event.preventDefault(); pick() })
        row.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); pick() } })
        row.appendChild(node('span', 'lark-doc-relation-item-name'))
        if (!tableStep) row.appendChild(node('span', 'lark-doc-relation-item-owner'))
        relationRows.set(key, row)
      }
      row._entry = entry
      setText(row.firstChild, entry.name || (tableStep ? '未命名数据表' : '未命名多维表格'))
      if (!tableStep) setText(row.lastChild, `所有者: ${entry.ownerName || '未知'}`)
      row.classList.toggle('is-active', id === (tableStep ? state.relationTableId : state.relationBaseToken))
      return { node: row, on: true }
    }))
    setText(relationHint, state.relationHint)
    relationHint.classList.toggle('is-error', !!state.relationError)
    setAttr(relationBody, 'aria-busy', String(!!state.relationLoading))
    syncChildren(relationBody, [{ node: relationList, on: entries.length > 0 }, { node: relationHint, on: !entries.length }])
    setText(relationSelection, state.relationSelectionText)
    relationAccept.disabled = !!state.relationConfirmDisabled
    setAttr(relationAccept, 'aria-disabled', String(relationAccept.disabled))
    setAttr(relationAccept, 'title', state.relationConfirmReason)
    mountNode(host, relation, !!state.relationOpen)

    const opening = !!state.codeLangOpen && !codeOpen
    if (opening || codeQuery !== state.codeLangQuery) cursor = 0
    codeQuery = state.codeLangQuery
    position(code, state.codeLangStyle)
    if (codeInput.value !== (codeQuery || '')) codeInput.value = codeQuery || ''
    const items = state.codeLangItems || []
    if (cursor >= items.length) cursor = 0
    syncChildren(codeList, items.map((item, index) => {
      let row = codeRows.get(item.id)
      if (!row) {
        row = node('li', 'lark-doc-code-lang-item')
        setAttr(row, 'role', 'option')
        row.appendChild(node('span', 'lark-doc-code-lang-text', item.label))
        row.addEventListener('mouseenter', () => { cursor = [...codeList.children].indexOf(row); syncCursor() })
        row.addEventListener('click', () => call('pickCodeLanguage', item.id))
        codeRows.set(item.id, row)
      }
      row.classList.toggle('is-active', item.label === state.codeLangValue)
      row.classList.toggle('is-cursor', index === cursor)
      setAttr(row, 'aria-selected', String(item.label === state.codeLangValue))
      return { node: row, on: true }
    }))
    mountNode(host, code, !!state.codeLangOpen)
    codeOpen = !!state.codeLangOpen
    if (opening) { codeContainer.scrollTop = 0; codeInput.focus() }
  }

  return {
    update,
    destroy() {
      for (const el of [link, confirm, relation, code]) el.remove()
      if (refs.codeLangInput === codeInput) delete refs.codeLangInput
      linkRows.clear()
      relationRows.clear()
      codeRows.clear()
      state = {}
    },
  }
}
