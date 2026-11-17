/**
 * 权限浮层（原 PermissionDialog.vue 的渲染层）：成员与链接权限两段、安全确认、密码校验。
 *
 * 从 `ui/overlays.js` 原样搬出。三组候选行（toggle / select / 安全段）只在这里用，
 * 与确认、密码两个子视图一起留在本文件，不必再往外拆。
 */
import { SECURE_CONFIRM_MESSAGES, SECURE_LINK_TIP } from '../components/lark-doc/editor/shareContent'
import { setAttr, setText, syncChildren } from './dom'
import { attr, button, callHandler, makeShareClose, selectNode, setInputValue, svgIcon, text } from './overlayShared'

function createPermissionView(options) {
  const handlers = options.handlers || {}
  let currentState = {}
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

  const outside = createToggleRow('shareOutsideOrg', '允许内容被分享到组织外', '', handlers, () => currentState.permissionDialogOpen)
  const outsideDesc = text('div', 'lark-doc-permission-desc', '仅"可管理权限"可以将内容分享到组织外')
  column.appendChild(outside.root)
  column.appendChild(outsideDesc)
  const secure = createSecureSection(handlers)
  column.appendChild(secure.root)
  const detail = text('div', 'lark-doc-permission-link-detail')
  const detailOrg = selectNode('lark-doc-permission-org-btn', '链接范围', '', ['仅协作者', '互联网用户'], value => {
    if (dialog.isConnected && currentState.permissionDialogOpen && currentState.shareLinkWritable) callHandler(handlers, 'onSetShareLinkAudience', value === '互联网用户' ? 'public' : 'collaborators')
  })
  const detailPermission = selectNode('lark-doc-permission-select', '链接权限', '', ['可阅读', '可编辑'], value => {
    if (dialog.isConnected && currentState.permissionDialogOpen && currentState.shareLinkWritable) callHandler(handlers, 'onSetShareLinkPerm', value)
  })
  const detailScope = text('span', 'lark-doc-permission-scope-text')
  detail.appendChild(detailOrg)
  detail.appendChild(detailScope)
  detail.appendChild(detailPermission)
  column.appendChild(detail)
  const feedback = text('div', 'lark-doc-permission-desc')
  attr(feedback, 'role', 'status')
  const feedbackText = text('span')
  const reload = button('lark-doc-share-btn-outlined', '重新载入', () => {
    if (dialog.isConnected && currentState.permissionDialogOpen && currentState.shareLinkAvailable && !currentState.shareLinkBusy) callHandler(handlers, currentState.shareLinkPending ? 'onQueryShareLink' : 'onLoadShareLink')
  })
  feedback.append(feedbackText, reload)
  column.appendChild(feedback)

  const selectRows = [
    ['collaborators', '谁可以查看、添加、移除协作者', '仅组织内的用户可以查看、添加、移除协作者'],
    ['copy', '谁可以复制内容', ''],
    ['duplicate', '谁可以创建副本、打印和下载', ''],
    ['comment', '谁可以评论', ''],
  ]
  const selectNodes = {}
  const staticChildren = [column.children[0], column.children[1], column.children[2], outside.root, outsideDesc, secure.root, detail, feedback]
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
  const advancedToggle1 = createToggleRow('ownerLeaderAutoPass', '文档所有者上级', '申请访问时自动通过', handlers, () => currentState.permissionDialogOpen)
  const advancedToggle2 = createToggleRow('ownerLeaderSearchable', '文档所有者上级', '可搜索和访问该文档', handlers, () => currentState.permissionDialogOpen)
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
    currentState = state
    setText(feedbackText, state.shareLinkBusy ? '正在读取或保存链接权限…' : state.shareLinkError || (state.shareLinkPending ? '链接操作待确认，请查询原操作。' : !state.shareLinkAvailable ? '链接权限服务尚未接入，当前不可用。' : '组织高级权限尚未接入；组织免密绕过不可用。'))
    reload.hidden = !state.shareLinkAvailable
    reload.disabled = !!state.shareLinkBusy
    setText(reload, state.shareLinkPending ? '查询原操作' : '重新载入')
    attr(dialog, 'aria-modal', state.shareMobile && !state.passwordDialogOpen && !state.secureLinkConfirmOpen ? 'true' : null)
    setInputValue(searchInput, state.shareInviteQuery)
    outside.update(state.permissionValues || {}, !!state.shareLinkWritable)
    secure.update(state)
    advancedToggle1.update(state.permissionValues || {}, false)
    advancedToggle2.update(state.permissionValues || {}, false)
    detailOrg.disabled = !state.shareLinkWritable
    detailOrg.value = state.shareLinkState?.audience === 'public' ? '互联网用户' : '仅协作者'
    detailPermission.disabled = !state.shareLinkWritable
    detailPermission.value = state.shareLinkState?.permission === 'edit' ? '可编辑' : '可阅读'
    setText(detailScope, state.shareDialogScopeText)
    Object.keys(selectNodes).forEach((id) => {
      const node = selectNodes[id]
      node.disabled = true; node.title = '此项组织权限服务尚未接入，当前不可用。'
      node.textContent = ''
      const item = document.createElement('option'); item.value = ''; item.textContent = '服务尚未接入'; node.appendChild(item)
    })
    Object.keys(advancedSelects).forEach((id) => {
      const node = advancedSelects[id]
      node.disabled = true; node.title = '此项组织权限服务尚未接入，当前不可用。'
      node.textContent = ''
      const item = document.createElement('option'); item.value = ''; item.textContent = '服务尚未接入'; node.appendChild(item)
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

function createToggleRow(id, title, desc, handlers, isOpen) {
  const root = text('div', 'lark-doc-permission-item')
  const row = text('div', 'lark-doc-permission-row')
  row.appendChild(text('span', 'lark-doc-permission-item-title', title))
  const toggle = button('lark-doc-permission-switch')
  attr(toggle, 'role', 'switch')
  attr(toggle, 'aria-label', desc ? `${title} ${desc}` : title)
  toggle.addEventListener('click', () => { if (root.isConnected && isOpen() && !toggle.disabled) callHandler(handlers, 'onTogglePermissionValue', id) })
  row.appendChild(toggle)
  root.appendChild(row)
  if (desc) root.appendChild(text('div', 'lark-doc-permission-desc', desc))
  return { root, update(values, canManage) {
    const on = !!values[id]
    toggle.classList.toggle('is-on', on)
    attr(toggle, 'aria-checked', on ? 'true' : 'false')
    attr(toggle, 'data-capability', 'canManagePermission')
    toggle.disabled = canManage === false
    attr(toggle, 'aria-disabled', String(toggle.disabled))
  } }
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
  let current = {}
  const root = text('div', 'lark-doc-secure-link')
  const operation = text('div', 'lark-doc-secure-link-operation')
  const checkbox = document.createElement('input')
  checkbox.className = 'lark-doc-secure-link-checkbox'
  checkbox.type = 'checkbox'
  attr(checkbox, 'aria-label', '启用加密链接')
  checkbox.addEventListener('change', () => { if (root.isConnected && !checkbox.disabled) callHandler(handlers, 'onToggleSecureLink') })
  operation.appendChild(checkbox)
  const description = text('span', 'lark-doc-secure-link-desc', '启用加密链接')
  description.addEventListener('click', () => { if (root.isConnected && !checkbox.disabled) callHandler(handlers, 'onToggleSecureLink') })
  operation.appendChild(description)
  root.appendChild(operation)
  const passwordArea = text('div', 'lark-doc-secure-link-password-area')
  const passwordRow = text('div', 'lark-doc-secure-link-password-row')
  passwordRow.appendChild(text('span', 'lark-doc-secure-link-password-label', '密码：'))
  const passwordValue = button('lark-doc-secure-link-password-val')
  const copyPassword = () => { if (root.isConnected && current.shareLinkWritable && current.shareLinkState?.passwordAvailable) callHandler(handlers, 'onCopyLinkAndPassword') }
  passwordValue.addEventListener('click', copyPassword)
  passwordRow.appendChild(passwordValue)
  const editPassword = button('lark-doc-secure-link-edit', '', () => { if (root.isConnected && !editPassword.disabled) callHandler(handlers, 'onOpenPasswordDialog') })
  attr(editPassword, 'aria-label', '修改密码')
  editPassword.appendChild(svgIcon('pencil'))
  passwordRow.appendChild(editPassword)
  const copy = button('lark-doc-secure-link-copy-btn', '复制链接和密码', copyPassword)
  passwordRow.appendChild(copy)
  passwordArea.appendChild(passwordRow)
  const tip = text('p', 'lark-doc-secure-link-tip', SECURE_LINK_TIP)
  root.appendChild(passwordArea)
  root.appendChild(tip)
  return {
    root,
    update(state) {
      current = state
      checkbox.disabled = !state.shareLinkWritable || !state.secureLinkEnabled && !state.shareLinkState?.cryptoReady
      editPassword.disabled = !state.shareLinkWritable || !state.shareLinkState?.cryptoReady
      copy.disabled = passwordValue.disabled = !state.shareLinkWritable || !state.shareLinkState?.passwordAvailable
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
  let current = {}
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
  const confirm = button('lark-doc-share-btn-filled', '确认', () => { if (el.isConnected && current.secureLinkConfirmOpen && !confirm.disabled) callHandler(handlers, 'onConfirmSecureLink') })
  footer.appendChild(confirm)
  el.appendChild(header); el.appendChild(body); el.appendChild(footer)
  return { el, update(state) { current = state; confirm.disabled = !state.shareLinkWritable || !state.shareLinkState?.cryptoReady } }
}

function createPasswordView(handlers) {
  let current = {}
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
  input.addEventListener('input', (event) => { if (el.isConnected && current.passwordDialogOpen && !input.disabled) callHandler(handlers, 'onSetPasswordDraft', event.target.value) })
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
  const save = button('lark-doc-share-btn-filled', '保存', () => { if (el.isConnected && current.passwordDialogOpen && !save.disabled) callHandler(handlers, 'onSaveSharePassword') })
  footer.appendChild(save)
  content.appendChild(footer); body.appendChild(content); el.appendChild(header); el.appendChild(body)
  function update(state) {
    current = state
    input.disabled = !state.shareLinkWritable
    clear.disabled = random.disabled = !state.shareLinkWritable
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

export { createPermissionView }
