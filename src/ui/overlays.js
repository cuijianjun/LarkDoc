/**
 * 分享 / 导出浮层 —— 原生 DOM 版（阶段 5 批次 5）。
 *
 * 原 SharePopover.vue、PermissionDialog.vue、ExportDialog.vue 的渲染层集中在这里；
 * 状态和业务动作仍由 shareMixin / exportMixin 持有，渲染器只负责 DOM、事件和显隐。
 */
import { applyStyle, mountNode, setAttr, setText, syncChildren } from './dom'
import { iconNode } from './icon'
import { SECURE_CONFIRM_MESSAGES, SECURE_LINK_TIP } from '../components/lark-doc/editor/shareMixin'

function callHandler(handlers, name, ...args) {
  const fn = handlers && handlers[name]
  return typeof fn === 'function' ? fn(...args) : undefined
}

function text(tag, className, value) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (value !== undefined) node.textContent = value
  return node
}

function button(className, label, onClick) {
  const node = document.createElement('button')
  node.type = 'button'
  if (className) node.className = className
  if (label !== undefined) node.textContent = label
  if (onClick) node.addEventListener('click', onClick)
  return node
}

function attr(node, name, value) {
  if (value !== undefined) node.setAttribute(name, String(value))
  return node
}

function svgIcon(kind) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.4')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  if (kind === 'gear') path.setAttribute('d', 'M12 4.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4Zm0-3v2.2m0 7.8v2.2M4.6 4.6l1.9 1.1m11-1.1-1.9 1.1M4.6 11.4l1.9-1.1m11 1.1-1.9-1.1')
  else if (kind === 'pencil') path.setAttribute('d', 'm10.4 2.6 3 3-7.5 7.5-3.4.5.5-3.4 7.4-7.6Zm-1.2 1.2 3 3')
  else path.setAttribute('d', 'm7 7 10 10M17 7 7 17')
  svg.appendChild(path)
  return svg
}

function makeClose(className, label, handler) {
  const node = button(className, '', handler)
  attr(node, 'aria-label', label)
  node.appendChild(iconNode('close', 14))
  return node
}

function makeShareClose(className, label, handler) {
  const node = button(className, '✕', handler)
  attr(node, 'aria-label', label)
  return node
}

function setInputValue(node, value) {
  const next = value == null ? '' : String(value)
  if (node.value !== next) node.value = next
}

function selectNode(className, label, value, options, onChange) {
  const node = document.createElement('select')
  node.className = className
  attr(node, 'aria-label', label)
  options.forEach((option) => {
    const item = document.createElement('option')
    item.value = option
    item.textContent = option
    node.appendChild(item)
  })
  node.value = value
  node.addEventListener('change', (event) => onChange(event.target.value))
  return node
}

function createShareView(options) {
  const handlers = options.handlers || {}
  const layer = text('div', 'lark-doc-share-layer')
  const state = {}

  const mask = text('div', 'lark-doc-share-mask')
  attr(mask, 'role', 'alertdialog')
  attr(mask, 'aria-label', '你没有查看权限')
  const maskCard = text('div', 'lark-doc-share-mask-card')
  const maskIcon = text('span', 'lark-doc-share-mask-icon')
  attr(maskIcon, 'aria-hidden', 'true')
  maskIcon.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="9.5" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2.5"/></svg>'
  maskCard.appendChild(maskIcon)
  maskCard.appendChild(text('p', 'lark-doc-share-mask-title', '你没有查看权限'))
  maskCard.appendChild(button('lark-doc-share-btn-filled', '申请权限', () => callHandler(handlers, 'onRequestAccess')))
  mask.appendChild(maskCard)

  const entry = text('div', 'lark-doc-share-entry')
  const entryButton = button('lark-doc-share-btn-filled', '')
  entryButton.addEventListener('click', (event) => callHandler(handlers, 'onToggleSharePopover', event))
  entry.appendChild(entryButton)

  const popover = text('div', 'lark-doc-share-popover')
  attr(popover, 'role', 'dialog')
  attr(popover, 'aria-label', '分享文档')
  const popoverInner = text('div', 'lark-doc-share-popover-inner')
  const shareHeader = text('div', 'lark-doc-share-header')
  shareHeader.appendChild(text('h3', 'lark-doc-share-header-title', '分享文档'))
  const headerActions = text('div', 'lark-doc-share-header-actions')
  const permissionButton = button('lark-doc-share-perm-btn')
  attr(permissionButton, 'aria-label', '权限设置')
  permissionButton.appendChild(svgIcon('gear'))
  permissionButton.appendChild(text('span', '', '权限设置'))
  permissionButton.addEventListener('click', () => callHandler(handlers, 'onOpenPermissionDialog'))
  headerActions.appendChild(permissionButton)
  shareHeader.appendChild(headerActions)
  popoverInner.appendChild(shareHeader)

  const memberRow = text('div', 'lark-doc-share-member-row')
  memberRow.appendChild(text('span', 'lark-doc-share-member-text', '已有协作者'))
  const avatars = text('div', 'lark-doc-share-avatars')
  avatars.appendChild(text('span', 'lark-doc-share-avatar'))
  avatars.appendChild(text('span', 'lark-doc-share-avatar-more', '+2'))
  memberRow.appendChild(avatars)
  popoverInner.appendChild(memberRow)

  const invite = text('div', 'lark-doc-share-invite')
  const inviteInput = document.createElement('input')
  attr(inviteInput, 'aria-label', '邀请协作者')
  inviteInput.placeholder = '搜索用户、群组、部门、用户组或智能体'
  inviteInput.addEventListener('input', (event) => callHandler(handlers, 'onSetShareInviteQuery', event.target.value))
  invite.appendChild(inviteInput)
  invite.appendChild(attr(button('lark-doc-share-org-entry', '⌄'), 'aria-label', '选择组织范围'))
  popoverInner.appendChild(invite)

  const lower = text('div', 'lark-doc-share-lower')
  const linkCard = text('div', 'lark-doc-share-link-card')
  const linkHead = text('div', 'lark-doc-share-link-head')
  linkHead.appendChild(text('span', 'lark-doc-share-link-title', '链接分享'))
  const linkTag = text('span', 'lark-doc-share-link-tag')
  const linkTagValue = text('span')
  linkTag.appendChild(linkTagValue)
  linkHead.appendChild(linkTag)
  linkCard.appendChild(linkHead)
  const linkBody = text('div', 'lark-doc-share-link-body')
  const linkIcon = text('span', 'lark-doc-share-link-icon')
  linkIcon.appendChild(iconNode('link', 14))
  linkBody.appendChild(linkIcon)
  const linkMain = text('div', 'lark-doc-share-link-main')
  const orgButton = button('lark-doc-share-org-btn', '')
  linkMain.appendChild(orgButton)
  const scopeText = text('span', 'lark-doc-share-scope-text')
  linkMain.appendChild(scopeText)
  linkBody.appendChild(linkMain)
  const linkSelect = document.createElement('select')
  linkSelect.className = 'lark-doc-share-perm-select'
  attr(linkSelect, 'aria-label', '链接权限')
  linkSelect.addEventListener('change', (event) => callHandler(handlers, 'onSetShareLinkPerm', event.target.value))
  linkBody.appendChild(linkSelect)
  linkCard.appendChild(linkBody)
  const copyRow = text('div', 'lark-doc-share-copy-row')
  copyRow.appendChild(button('lark-doc-share-btn-filled', '复制链接', () => callHandler(handlers, 'onCopyShareLink')))
  linkCard.appendChild(copyRow)
  lower.appendChild(linkCard)
  popoverInner.appendChild(lower)
  popover.appendChild(popoverInner)

  const permissionLayer = createPermissionView({ handlers })
  const shareToast = text('div', 'lark-doc-share-toast')
  attr(shareToast, 'role', 'status')
  const shareToastText = text('span', 'lark-doc-share-toast-text')
  shareToast.appendChild(shareToastText)

  layer.appendChild(mask)
  layer.appendChild(entry)
  layer.appendChild(popover)
  layer.appendChild(permissionLayer.el)
  layer.appendChild(shareToast)

  function render(next) {
    Object.assign(state, next || {})
    syncChildren(layer, [
      { node: mask, on: !!state.shareViewMaskVisible },
      { node: entry, on: !!state.shareEntryVisible },
      { node: popover, on: !!state.sharePopoverOpen },
      { node: permissionLayer.el, on: !!state.permissionDialogOpen },
      { node: shareToast, on: !!state.shareToast },
    ])
    setText(entryButton, state.shareEntryLabel)
    attr(entryButton, 'aria-label', state.shareEntryLabel)
    applyStyle(popover, state.sharePopoverStyle || {})
    setInputValue(inviteInput, state.shareInviteQuery)
    setText(avatars.children[0], state.shareCollaboratorInitial)
    setText(linkTagValue, state.shareLinkPermLabel)
    setText(orgButton, state.shareOrgName)
    setText(scopeText, state.shareScopeText)
    linkSelect.textContent = ''
    ;(state.shareLinkPermOptions || []).forEach((option) => {
      const item = document.createElement('option')
      item.value = option
      item.textContent = option
      linkSelect.appendChild(item)
    })
    linkSelect.value = state.shareLinkPermLabel || ''
    shareToast.className = `lark-doc-share-toast is-${state.shareToast ? state.shareToast.kind : 'success'}`
    setText(shareToastText, state.shareToast && state.shareToast.text)
    permissionLayer.update(state)
  }

  return { el: layer, update: render, destroy() { if (layer.parentNode) layer.parentNode.removeChild(layer) } }
}

function createPermissionView(options) {
  const handlers = options.handlers || {}
  const layer = text('div', 'lark-doc-permission-layer')
  const mask = text('div', 'lark-doc-permission-mask')
  mask.addEventListener('click', () => callHandler(handlers, 'onClosePermissionDialog'))
  const dialog = text('div', 'lark-doc-permission-dialog')
  attr(dialog, 'role', 'dialog')
  attr(dialog, 'aria-label', '权限设置')
  const header = text('div', 'lark-doc-permission-header')
  header.appendChild(text('div', 'lark-doc-permission-crumb', '分享文档'))
  const headRow = text('div', 'lark-doc-permission-head-row')
  headRow.appendChild(text('h3', 'lark-doc-permission-title', '权限设置'))
  headRow.appendChild(makeShareClose('lark-doc-share-close', '关闭', () => callHandler(handlers, 'onClosePermissionDialog')))
  header.appendChild(headRow)
  dialog.appendChild(header)
  const body = text('div', 'lark-doc-permission-body')
  const column = text('div', 'lark-doc-permission-column')
  column.appendChild(text('div', 'lark-doc-permission-invite-row', '邀请协作者'))
  column.appendChild(text('div', 'lark-doc-permission-group-title', '对外分享'))
  const search = text('div', 'lark-doc-permission-search')
  const searchInput = document.createElement('input')
  attr(searchInput, 'aria-label', '搜索用户、群组、部门、用户组或智能体')
  searchInput.placeholder = '搜索用户、群组、部门、用户组或智能体'
  searchInput.addEventListener('input', (event) => callHandler(handlers, 'onSetShareInviteQuery', event.target.value))
  search.appendChild(searchInput)
  column.appendChild(search)

  const outside = createToggleRow('shareOutsideOrg', '允许内容被分享到组织外', '', handlers)
  const outsideDesc = text('div', 'lark-doc-permission-desc', '仅"可管理权限"可以将内容分享到组织外')
  column.appendChild(outside.root)
  column.appendChild(outsideDesc)
  const secure = createSecureSection(handlers)
  column.appendChild(secure.root)
  const detail = text('div', 'lark-doc-permission-link-detail')
  const detailOrg = button('lark-doc-permission-org-btn', '')
  const detailScope = text('span', 'lark-doc-permission-scope-text')
  detail.appendChild(detailOrg)
  detail.appendChild(detailScope)
  column.appendChild(detail)

  const selectRows = [
    ['collaborators', '谁可以查看、添加、移除协作者', '仅组织内的用户可以查看、添加、移除协作者'],
    ['copy', '谁可以复制内容', ''],
    ['duplicate', '谁可以创建副本、打印和下载', ''],
    ['comment', '谁可以评论', ''],
  ]
  const selectNodes = {}
  const staticChildren = [column.children[0], column.children[1], column.children[2], outside.root, outsideDesc, secure.root, detail]
  selectRows.forEach(([id, title, desc]) => {
    const row = createPermissionSelectRow(id, title, desc, handlers)
    selectNodes[id] = row.select
    staticChildren.push(row.root)
    column.appendChild(row.root)
  })

  const advancedButton = button('lark-doc-permission-collapse-head')
  const advancedCaret = text('span', 'lark-doc-permission-caret')
  attr(advancedCaret, 'aria-hidden', 'true')
  advancedButton.appendChild(advancedCaret)
  advancedButton.appendChild(text('span', '', '更多高级设置'))
  advancedButton.addEventListener('click', () => callHandler(handlers, 'onToggleAdvancedSettings'))
  column.appendChild(advancedButton)
  const advancedChildren = [text('div', 'lark-doc-permission-group-title', '企业信息公开设置')]
  const advancedSelects = {}
  const advancedToggle1 = createToggleRow('ownerLeaderAutoPass', '文档所有者上级', '申请访问时自动通过', handlers)
  const advancedToggle2 = createToggleRow('ownerLeaderSearchable', '文档所有者上级', '可搜索和访问该文档', handlers)
  advancedChildren.push(advancedToggle1.root, advancedToggle2.root)
  ;[
    ['visitorAvatar', '谁可以查看访问者头像和点赞者头像', ''],
    ['requestAccess', '谁可以在文档内申请引用文档访问权限', '仅可管理权限的用户可以申请'],
  ].forEach(([id, title, desc]) => {
    const row = createPermissionSelectRow(id, title, desc, handlers)
    advancedSelects[id] = row.select
    advancedChildren.push(row.root)
  })
  body.appendChild(column)
  dialog.appendChild(body)
  layer.appendChild(mask)
  layer.appendChild(dialog)

  const confirm = createConfirmView(handlers)
  const password = createPasswordView(handlers)

  function update(state) {
    setInputValue(searchInput, state.shareInviteQuery)
    outside.update(state.permissionValues || {})
    secure.update(state)
    setText(detailOrg, state.shareOrgName)
    setText(detailScope, state.shareDialogScopeText)
    const options = state.sharePermissionOptions || []
    Object.keys(selectNodes).forEach((id) => {
      const node = selectNodes[id]
      node.textContent = ''
      options.forEach((option) => { const item = document.createElement('option'); item.value = option; item.textContent = option; node.appendChild(item) })
      node.value = (state.permissionValues || {})[id] || ''
    })
    Object.keys(advancedSelects).forEach((id) => {
      const node = advancedSelects[id]
      node.textContent = ''
      options.forEach((option) => { const item = document.createElement('option'); item.value = option; item.textContent = option; node.appendChild(item) })
      node.value = (state.permissionValues || {})[id] || ''
    })
    setText(advancedCaret, state.permissionAdvancedOpen ? '▾' : '▸')
    setAttr(advancedButton, 'aria-expanded', state.permissionAdvancedOpen ? 'true' : 'false')
    syncChildren(column, [
      ...staticChildren.map((node) => ({ node, on: true })),
      { node: advancedButton, on: true },
      ...advancedChildren.map((node) => ({ node, on: !!state.permissionAdvancedOpen })),
    ])
    syncChildren(layer, [
      { node: mask, on: true },
      { node: dialog, on: true },
      { node: confirm.el, on: !!state.secureLinkConfirmOpen },
      { node: password.el, on: !!state.passwordDialogOpen },
    ])
    confirm.update(state)
    password.update(state)
  }

  return { el: layer, update }
}

function createToggleRow(id, title, desc, handlers) {
  const root = text('div', 'lark-doc-permission-item')
  const row = text('div', 'lark-doc-permission-row')
  row.appendChild(text('span', 'lark-doc-permission-item-title', title))
  const toggle = button('lark-doc-permission-switch')
  attr(toggle, 'role', 'switch')
  attr(toggle, 'aria-label', desc ? `${title} ${desc}` : title)
  toggle.addEventListener('click', () => callHandler(handlers, 'onTogglePermissionValue', id))
  row.appendChild(toggle)
  root.appendChild(row)
  if (desc) root.appendChild(text('div', 'lark-doc-permission-desc', desc))
  return { root, update(values) { const on = !!values[id]; toggle.classList.toggle('is-on', on); attr(toggle, 'aria-checked', on ? 'true' : 'false') } }
}

function createPermissionSelectRow(id, title, desc, handlers) {
  const root = text('div', 'lark-doc-permission-item')
  const row = text('div', 'lark-doc-permission-row')
  row.appendChild(text('span', 'lark-doc-permission-item-title', title))
  root.appendChild(row)
  const value = text('div', 'lark-doc-permission-value')
  const select = selectNode('lark-doc-permission-select', title, '', [], (next) => callHandler(handlers, 'onSetPermissionValue', id, next))
  value.appendChild(select)
  root.appendChild(value)
  if (desc) root.appendChild(text('div', 'lark-doc-permission-desc', desc))
  return { root, select }
}

function createSecureSection(handlers) {
  const root = text('div', 'lark-doc-secure-link')
  const operation = text('div', 'lark-doc-secure-link-operation')
  const checkbox = document.createElement('input')
  checkbox.className = 'lark-doc-secure-link-checkbox'
  checkbox.type = 'checkbox'
  attr(checkbox, 'aria-label', '启用加密链接')
  checkbox.addEventListener('change', () => callHandler(handlers, 'onToggleSecureLink'))
  operation.appendChild(checkbox)
  const description = text('span', 'lark-doc-secure-link-desc', '启用加密链接')
  description.addEventListener('click', () => callHandler(handlers, 'onToggleSecureLink'))
  operation.appendChild(description)
  root.appendChild(operation)
  const passwordArea = text('div', 'lark-doc-secure-link-password-area')
  const passwordRow = text('div', 'lark-doc-secure-link-password-row')
  passwordRow.appendChild(text('span', 'lark-doc-secure-link-password-label', '密码：'))
  const passwordValue = text('span', 'lark-doc-secure-link-password-val')
  passwordValue.setAttribute('role', 'button')
  passwordValue.addEventListener('click', () => callHandler(handlers, 'onCopyLinkAndPassword'))
  passwordRow.appendChild(passwordValue)
  const editPassword = button('lark-doc-secure-link-edit', '', () => callHandler(handlers, 'onOpenPasswordDialog'))
  attr(editPassword, 'aria-label', '修改密码')
  editPassword.appendChild(svgIcon('pencil'))
  passwordRow.appendChild(editPassword)
  passwordRow.appendChild(button('lark-doc-secure-link-copy-btn', '复制链接和密码', () => callHandler(handlers, 'onCopyLinkAndPassword')))
  passwordArea.appendChild(passwordRow)
  const tip = text('p', 'lark-doc-secure-link-tip', SECURE_LINK_TIP)
  root.appendChild(passwordArea)
  root.appendChild(tip)
  return {
    root,
    update(state) {
      checkbox.checked = !!state.secureLinkEnabled
      setText(passwordValue, state.secureLinkPassword)
      syncChildren(root, [
        { node: operation, on: true },
        { node: passwordArea, on: !!state.secureLinkEnabled },
        { node: tip, on: !!state.secureLinkEnabled },
      ])
    },
  }
}

function createConfirmView(handlers) {
  const el = text('div', 'lark-doc-share-confirm')
  attr(el, 'role', 'dialog'); attr(el, 'aria-label', '提示')
  const header = text('div', 'lark-doc-share-confirm-header')
  const row = text('div', 'lark-doc-permission-head-row')
  row.appendChild(text('h3', 'lark-doc-share-confirm-title', '提示'))
  row.appendChild(makeShareClose('lark-doc-share-close', '关闭', () => callHandler(handlers, 'onCancelSecureLinkConfirm')))
  header.appendChild(row)
  const body = text('div', 'lark-doc-share-confirm-body')
  SECURE_CONFIRM_MESSAGES.forEach((message, index) => {
    const paragraph = text('p', 'lark-doc-share-confirm-text')
    if (index === 2) {
      paragraph.appendChild(document.createTextNode('具体说明及安全事项请查看'))
      paragraph.appendChild(text('span', 'lark-doc-share-confirm-link', '服务协议'))
      paragraph.appendChild(document.createTextNode('和'))
      paragraph.appendChild(text('span', 'lark-doc-share-confirm-link', '隐私政策'))
      paragraph.appendChild(document.createTextNode('。'))
    } else paragraph.textContent = message
    body.appendChild(paragraph)
  })
  const footer = text('div', 'lark-doc-share-confirm-footer')
  footer.appendChild(button('lark-doc-share-btn-outlined', '取消', () => callHandler(handlers, 'onCancelSecureLinkConfirm')))
  footer.appendChild(button('lark-doc-share-btn-filled', '确认', () => callHandler(handlers, 'onConfirmSecureLink')))
  el.appendChild(header); el.appendChild(body); el.appendChild(footer)
  return { el, update() {} }
}

function createPasswordView(handlers) {
  const el = text('div', 'lark-doc-share-password')
  attr(el, 'role', 'dialog'); attr(el, 'aria-label', '修改密码')
  const header = text('div', 'lark-doc-share-password-header')
  header.appendChild(text('h3', 'lark-doc-share-password-title', '修改密码'))
  header.appendChild(makeShareClose('lark-doc-share-close', '关闭', () => callHandler(handlers, 'onClosePasswordDialog')))
  const body = text('div', 'lark-doc-share-password-body')
  const content = text('div', 'lark-doc-share-password-content')
  const inputRow = text('div', 'lark-doc-share-password-input-row')
  const inputWrap = text('div', 'lark-doc-share-password-input')
  const input = document.createElement('input'); attr(input, 'aria-label', '请输入新密码'); input.placeholder = '请输入新密码'
  input.addEventListener('input', (event) => callHandler(handlers, 'onSetPasswordDraft', event.target.value))
  const clear = button('lark-doc-share-password-clear', '✕', () => callHandler(handlers, 'onSetPasswordDraft', ''))
  attr(clear, 'aria-label', '清空')
  inputWrap.appendChild(input); inputWrap.appendChild(clear)
  inputRow.appendChild(inputWrap)
  const random = button('lark-doc-share-btn-outlined lark-doc-share-password-random', '', () => callHandler(handlers, 'onRandomizePasswordDraft'))
  random.appendChild(svgIcon('gear')); random.appendChild(text('span', '', '随机生成'))
  inputRow.appendChild(random); content.appendChild(inputRow)
  const rules = text('div', 'lark-doc-share-password-rules'); content.appendChild(rules)
  content.appendChild(text('p', 'lark-doc-share-password-hints', '安全提示：请勿使用个人常用或其他平台中的密码'))
  const footer = text('div', 'lark-doc-share-password-footer')
  footer.appendChild(button('lark-doc-share-btn-outlined', '取消', () => callHandler(handlers, 'onClosePasswordDialog')))
  const save = button('lark-doc-share-btn-filled', '保存', () => callHandler(handlers, 'onSaveSharePassword'))
  footer.appendChild(save)
  content.appendChild(footer); body.appendChild(content); el.appendChild(header); el.appendChild(body)
  function update(state) {
    setInputValue(input, state.passwordDraft)
    save.disabled = !!state.sharePasswordSaveDisabled
    setAttr(save, 'aria-disabled', state.sharePasswordSaveDisabled ? 'true' : 'false')
    clear.style.display = state.passwordDraft ? '' : 'none'
    rules.textContent = ''
    ;(state.sharePasswordRules || []).forEach((rule) => {
      const row = text('div', `lark-doc-share-password-rule is-${rule.state}`)
      const icon = text('span', 'lark-doc-share-password-rule-icon')
      icon.innerHTML = rule.state === 'error' ? '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="currentColor"/><path d="m7.5 8.5 9 7m0-7-9 7" stroke="var(--ld-share-surface)" stroke-width="2"/></svg>' : '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="currentColor"/><path d="m7 12 3.2 3.2L17 8.8" stroke="var(--ld-share-surface)" stroke-width="2"/></svg>'
      row.appendChild(icon); row.appendChild(text('span', 'lark-doc-share-password-rule-text', rule.text)); rules.appendChild(row)
    })
    syncChildren(inputWrap, [{ node: input, on: true }, { node: clear, on: !!state.passwordDraft }])
  }
  return { el, update }
}

function createExportView(options) {
  const handlers = options.handlers || {}
  const layer = text('div', 'lark-doc-export-layer')
  const toast = text('div', 'lark-doc-export-toast'); attr(toast, 'role', 'status'); attr(toast, 'aria-live', 'polite')
  toast.appendChild(text('div', 'lark-doc-export-toast-inner'))
  const backdrop = text('div', 'lark-doc-export-backdrop')
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) callHandler(handlers, 'onCancelExport') })
  const panel = text('section', 'lark-doc-export-panel'); attr(panel, 'role', 'dialog'); attr(panel, 'aria-modal', 'true')
  const header = text('header', 'lark-doc-export-header')
  const title = text('strong', 'lark-doc-export-title')
  header.appendChild(title)
  header.appendChild(makeClose('lark-doc-export-close', '关闭导出设置', () => callHandler(handlers, 'onCloseExportDialog')))
  const body = text('div', 'lark-doc-export-body'); body.appendChild(text('span', 'lark-doc-export-range-label', '内容范围'))
  const radios = text('div', 'lark-doc-export-radio-group'); attr(radios, 'role', 'radiogroup'); attr(radios, 'aria-label', '内容范围')
  body.appendChild(radios)
  const footer = text('footer', 'lark-doc-export-footer'); const buttons = text('div', 'lark-doc-export-btns')
  buttons.appendChild(button('lark-doc-export-cancel', '取消', () => callHandler(handlers, 'onCancelExport')))
  const submit = button('lark-doc-export-submit', '导出', () => callHandler(handlers, 'onSubmitExport')); buttons.appendChild(submit); footer.appendChild(buttons)
  panel.appendChild(header); panel.appendChild(body); panel.appendChild(footer); backdrop.appendChild(panel)
  layer.appendChild(toast); layer.appendChild(backdrop)
  function update(state) {
    setText(toast.firstChild, state.exportToast)
    setText(title, state.exportPanelTitle)
    attr(panel, 'aria-label', state.exportPanelTitle)
    submit.disabled = !!state.exportSubmitDisabled
    attr(submit, 'aria-disabled', state.exportSubmitDisabled ? 'true' : 'false')
    submit.classList.toggle('is-disabled', !!state.exportSubmitDisabled)
    radios.textContent = ''
    ;(state.exportScopeOptions || []).forEach((option) => {
      const label = text('label', 'lark-doc-export-option'); label.classList.toggle('is-disabled', !state.exportCanExport)
      const radio = text('span', 'lark-doc-export-radio')
      const input = document.createElement('input'); input.className = 'lark-doc-export-radio-input'; input.type = 'radio'; input.name = 'lark-doc-export-scope'; input.value = option.value; input.checked = state.exportScopeValue === option.value; input.disabled = !state.exportCanExport
      input.addEventListener('change', () => callHandler(handlers, 'onSelectExportScope', option.value))
      const wallpaper = text('span', 'lark-doc-export-radio-wallpaper'); if (input.checked) wallpaper.appendChild(text('span', 'lark-doc-export-radio-ink'))
      radio.appendChild(input); radio.appendChild(wallpaper); label.appendChild(radio); label.appendChild(text('span', 'lark-doc-export-option-text', option.label)); radios.appendChild(label)
    })
    syncChildren(layer, [{ node: toast, on: !!state.exportToast }, { node: backdrop, on: !!state.exportOpen }])
  }
  return { el: layer, update, destroy() { if (layer.parentNode) layer.parentNode.removeChild(layer) } }
}

export function createOverlays(options = {}) {
  const host = options.host || null
  const handlers = options.handlers || {}
  const share = createShareView({ handlers })
  const exportView = createExportView({ handlers })
  const el = text('div', 'lark-doc-p6b-layer')
  el.appendChild(share.el)
  el.appendChild(exportView.el)
  function update(state) {
    mountNode(host, el, true)
    share.update(state)
    exportView.update(state)
  }
  return {
    el,
    update,
    destroy() { if (el.parentNode) el.parentNode.removeChild(el) },
  }
}
