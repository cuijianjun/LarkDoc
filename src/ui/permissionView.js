/**
 * 权限浮层（原 PermissionDialog.vue 的渲染层）：成员与链接权限两段、安全确认、密码校验。
 *
 * 从 `ui/overlays.js` 原样搬出。三组候选行（toggle / select / 安全段）只在这里用，
 * 与确认、密码两个子视图一起留在本文件，不必再往外拆。
 *
 * B20 · 视觉按飞书 `suite-config-item-v2` 1:1：
 * - 标题「权限设置」+ 帮助问号（`menu-help` = MaybeOutlined，tooltip「帮助中心」，
 *   源码 `invite.suite_config_header` / `guide.help_doc` / `suite-config-title_v2`）；
 * - 权限行是**复选框**（`!disabled && pk(icon)` 语义见 B19），不是开关：勾=蓝实心白勾、
 *   未选=灰描边空心、禁用=浅灰描边 + 浅灰字；
 * - 值是**下划线式下拉**（飞书 `At.Select bordered:"underlined"`），三档
 *   「可阅读的用户 / 可编辑的用户 / 可管理的用户」（源码
 *   `LarkCCM_Perm_UserWith*PermCanViewAddRemoveCollaborator_Dropdown`）；
 * - 折叠头是实心下三角，问号/信息图标走 `svgIcon`。
 *
 * 结构类名、`aria-label`、handler 与 disabled/capability 契约全部保留，测试与既有功能不回归。
 */
import { SECURE_CONFIRM_MESSAGES, SECURE_LINK_TIP } from '../components/lark-doc/editor/shareContent'
import { setAttr, setText, syncChildren } from './dom'
import { iconNode } from './icon'
import { attr, button, callHandler, makeShareClose, selectNode, setInputValue, svgIcon, text } from './overlayShared'

/** 权限下拉三档（飞书源码 i18n，见文件头）。组织服务未接入时仍展示默认档但置灰。 */
const SCOPE_OPTIONS = ['可阅读的用户', '可编辑的用户', '可管理的用户']

/** 帮助 tooltip 文案：`guide.help_doc` = 帮助中心（源码 `suite-config-title_v2`）。 */
const HELP_TIP = '帮助中心'
/** 申请引用文档权限项后的 info tooltip：源码 `LarkCCM_Docs_Perm_DisableViewDescription_Tooltip_1_Common`。 */
const REQUEST_ACCESS_TIP = '如文档内的引用文档涉及敏感信息可勾选此选项'

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
  const titleWrap = text('div', 'lark-doc-permission-title-wrap')
  titleWrap.appendChild(text('h3', 'lark-doc-permission-title', '权限设置'))
  const help = text('span', 'lark-doc-permission-help')
  // MaybeOutlined = 飞书 suite-config-title__help 的圆圈问号（SHARE_REFERENCE_ICONS 收录）。
  help.appendChild(svgIcon('MaybeOutlined', 16))
  attr(help, 'title', HELP_TIP)
  attr(help, 'role', 'img')
  attr(help, 'aria-label', HELP_TIP)
  titleWrap.appendChild(help)
  headRow.appendChild(titleWrap)
  headRow.appendChild(makeShareClose('lark-doc-share-close', '关闭', () => callHandler(handlers, 'onClosePermissionDialog')))
  header.appendChild(headRow)
  dialog.appendChild(header)
  const body = text('div', 'lark-doc-permission-body')
  const column = text('div', 'lark-doc-permission-column')

  // —— 对外分享（飞书：`CreationDoc_ECM_Permission_ExternalSharing`）——
  column.appendChild(text('div', 'lark-doc-permission-invite-row', '邀请协作者'))
  column.appendChild(text('div', 'lark-doc-permission-group-title', '对外分享'))
  const search = text('div', 'lark-doc-permission-search')
  const searchInput = document.createElement('input')
  attr(searchInput, 'aria-label', '搜索用户、群组、部门、用户组或智能体')
  searchInput.placeholder = '搜索用户、群组、部门、用户组或智能体'
  searchInput.addEventListener('input', (event) => callHandler(handlers, 'onSetShareInviteQuery', event.target.value))
  search.appendChild(searchInput)
  column.appendChild(search)

  // 飞书三项复选框：允许分享到组织外 / 仅"可管理权限"可将内容分享到组织外 / 启用加密链接。
  // 第一项接既有 handler；第二项是组织分享范围的另一种口径，服务未接入——做成禁用展示，不新增写入。
  const outside = createToggleRow('shareOutsideOrg', '允许内容被分享到组织外', '', handlers, () => currentState.permissionDialogOpen)
  column.appendChild(outside.root)
  const outsideOnly = createStaticCheckbox('仅“可管理权限”可以将内容分享到组织外')
  column.appendChild(outsideOnly)
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

  // 飞书四个下拉项。文案按源码 i18n；「谁可以查看、添加、移除协作者」下带一枚说明复选框。
  const selectRows = [
    ['collaborators', '谁可以查看、添加、移除协作者', '仅组织内的用户可以查看、添加、移除协作者'],
    ['copy', '谁可以复制内容', ''],
    ['duplicate', '谁可以创建副本、打印和下载', ''],
    ['comment', '谁可以评论', ''],
  ]
  const selectNodes = {}
  const staticChildren = [column.children[0], column.children[1], column.children[2], outside.root, outsideOnly, secure.root, detail, feedback]
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
  // 飞书源码文案（273 i18n）：两行都是**单行**复选，desc 不再单独成行。
  const advancedToggle1 = createToggleRow('ownerLeaderAutoPass', '文档所有者上级申请访问时自动通过', '', handlers, () => currentState.permissionDialogOpen)
  const advancedToggle2 = createToggleRow('ownerLeaderSearchable', '文档所有者上级可搜索和访问该文档', '', handlers, () => currentState.permissionDialogOpen)
  advancedToggle2.setDisabledReason(true)
  advancedChildren.push(advancedToggle1.root, advancedToggle2.root)
  ;[
    ['visitorAvatar', '谁可以查看访问者头像和点赞者头像', ''],
    ['requestAccess', '谁可以在文档内申请引用文档访问权限', '仅可管理权限的用户可以申请'],
  ].forEach(([id, title, desc]) => {
    const row = createPermissionSelectRow(id, title, desc, handlers)
    if (id === 'requestAccess') row.setInfoTip(REQUEST_ACCESS_TIP)
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
    // 「仅可管理权限…」是组织分享范围的另一种口径，服务未接入——正常色空心展示，不写入。
    setStaticCheckbox(outsideOnly, false, false)
    secure.update(state)
    advancedToggle1.update(state.permissionValues || {}, false)
    advancedToggle2.update(state.permissionValues || {}, false)
    detailOrg.disabled = !state.shareLinkWritable
    detailOrg.value = state.shareLinkState?.audience === 'public' ? '互联网用户' : '仅协作者'
    detailPermission.disabled = !state.shareLinkWritable
    detailPermission.value = state.shareLinkState?.permission === 'edit' ? '可编辑' : '可阅读'
    setText(detailScope, state.shareDialogScopeText)
    // 组织权限服务未接入：三档真实选项照飞书展示，但保持 disabled 与说明（能力门控，不捏造写入）。
    Object.keys(selectNodes).forEach((id) => {
      const node = selectNodes[id]
      node.disabled = true
      node.title = '此项组织权限服务尚未接入，当前不可用。'
      syncOptions(node, (state.permissionValues || {})[id])
    })
    Object.keys(advancedSelects).forEach((id) => {
      const node = advancedSelects[id]
      node.disabled = true
      node.title = '此项组织权限服务尚未接入，当前不可用。'
      syncOptions(node, (state.permissionValues || {})[id])
    })
    attr(advancedButton, 'aria-expanded', state.permissionAdvancedOpen ? 'true' : 'false')
    advancedCaret.classList.toggle('is-open', !!state.permissionAdvancedOpen)
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

/** 把原生 select 的选项刷成飞书三档，并选中当前值（未知值回落第一档）。 */
function syncOptions(node, value) {
  const next = value == null ? SCOPE_OPTIONS[0] : String(value)
  const labels = [...node.options].map(option => option.value)
  if (labels.length !== SCOPE_OPTIONS.length || labels.some((label, i) => label !== SCOPE_OPTIONS[i])) {
    node.textContent = ''
    SCOPE_OPTIONS.forEach((label) => {
      const item = document.createElement('option')
      item.value = label
      item.textContent = label
      node.appendChild(item)
    })
  }
  node.value = SCOPE_OPTIONS.includes(next) ? next : SCOPE_OPTIONS[0]
}

/**
 * 纯展示复选框（飞书里独立成行的说明项，如「仅可管理权限可以将内容分享到组织外」、
 * 「仅组织内的用户可以查看、添加、移除协作者」）。组织权限服务未接入，禁用且无写入。
 * 不占用 `.lark-doc-permission-switch` 类名（那是接 handler 的开关，测试按序取用）。
 */
function createStaticCheckbox(label) {
  const root = text('div', 'lark-doc-permission-item lark-doc-permission-static-check')
  const row = text('div', 'lark-doc-permission-row')
  const box = text('span', 'lark-doc-permission-static-box')
  attr(box, 'aria-hidden', 'true')
  row.appendChild(box)
  row.appendChild(text('span', 'lark-doc-permission-static-label', label))
  root.appendChild(row)
  return root
}
function setStaticCheckbox(root, checked, disabled) {
  root.classList.toggle('is-on', !!checked)
  root.classList.toggle('is-disabled', !!disabled)
}

/**
 * 复选行。视觉是飞书复选框，但保留 `.lark-doc-permission-switch` 类名与 role=switch、
 * aria-label、capability、disabled 契约（既有测试与 B24 能力门控依赖它们）。
 */
function createToggleRow(id, title, desc, handlers, isOpen) {
  const root = text('div', 'lark-doc-permission-item lark-doc-permission-check-item')
  const row = text('div', 'lark-doc-permission-row')
  const label = text('span', 'lark-doc-permission-item-title', title)
  row.appendChild(label)
  const toggle = button('lark-doc-permission-switch')
  attr(toggle, 'role', 'switch')
  attr(toggle, 'aria-label', title)
  toggle.addEventListener('click', () => { if (root.isConnected && isOpen() && !toggle.disabled) callHandler(handlers, 'onTogglePermissionValue', id) })
  row.appendChild(toggle)
  root.appendChild(row)
  if (desc) root.appendChild(text('div', 'lark-doc-permission-desc', desc))
  let reason = false
  const api = {
    root,
    setDisabledReason(on) { reason = on },
    update(values, canManage) {
      const on = !!values[id]
      toggle.classList.toggle('is-on', on)
      attr(toggle, 'aria-checked', on ? 'true' : 'false')
      attr(toggle, 'data-capability', 'canManagePermission')
      toggle.disabled = reason === true || canManage === false
      attr(toggle, 'aria-disabled', String(toggle.disabled))
      root.classList.toggle('is-disabled', reason === true)
    },
  }
  return api
}

/** 下拉行：标题（可带 info 图标）+ 下划线式 select + 可选说明复选框行。 */
function createPermissionSelectRow(id, title, desc, handlers) {
  const root = text('div', 'lark-doc-permission-item lark-doc-permission-select-item')
  const heading = text('div', 'lark-doc-permission-select-heading', title)
  root.appendChild(heading)
  const value = text('div', 'lark-doc-permission-value')
  const select = selectNode('lark-doc-permission-select', title, SCOPE_OPTIONS[0], SCOPE_OPTIONS, (next) => callHandler(handlers, 'onSetPermissionValue', id, next))
  value.appendChild(select)
  root.appendChild(value)
  // 飞书把「仅组织内的用户…」「仅可管理权限的用户可以申请」渲染成独立复选框，不是描述文字；
  // 这两项属组织权限能力，服务未接入——禁用展示，不接写入 handler。
  if (desc) root.appendChild(createStaticCheckbox(desc))
  const api = {
    root,
    select,
    setInfoTip(tip) {
      const info = text('span', 'lark-doc-permission-info')
      info.appendChild(iconNode('menu-info', 14))
      attr(info, 'title', tip)
      attr(info, 'role', 'img')
      attr(info, 'aria-label', tip)
      heading.appendChild(info)
    },
  }
  return api
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
  // 飞书真身是实心斜铅笔；svgIcon('pencil') 是描边细线，实测几乎不可见（B22）。
  editPassword.appendChild(iconNode('pencil-solid', 16))
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
      checkbox.classList.toggle('is-on', !!state.secureLinkEnabled)
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
