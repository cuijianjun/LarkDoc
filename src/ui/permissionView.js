/**
 * 权限浮层（原 PermissionDialog.vue 的渲染层）：成员与链接权限两段、安全确认、密码校验。
 *
 * B20/B25 · 视觉按飞书 `suite-config-modal` 1:1（几何、图标、交互均从真身 CDP 实测取回）：
 * - 弹窗 500×662（白底、radius 8、无阴影）；header 72 高 `padding:24px 56px 24px 24px`、
 *   **无下边框**；标题 16/500/lh24；关闭按钮 `position:absolute top:24 right:24 margin:-2px -4px`
 *   28×28，图标 `CloseOutlined` 20×20 `rgb(100,106,115)`；
 * - body 566 高、`border-top:1px rgba(31,35,41,.15)`、`padding:0 24px`、`margin-bottom:24`；
 * - 每组是 `item(title + content)`：标题 14 / 600 / lh22 `rgb(31,35,41)`，首组 `margin-top:20`、
 *   其余 `32`，组内 ruleset `margin-top:8`；
 * - 权限行是**复选框**（`label` 形态，框 16×16 radius 4，勾是 12×12 的 `CheckBoldSmall`
 *   白勾 svg，文案 `margin-left:8`），不是开关；
 * - 值是**下划线式下拉**（`ud__select__selector-border-underlined`，104×32、`padding:1px 0`、
 *   仅下边框：静止 `rgb(208,211,214)`／聚焦-展开 `rgb(51,109,244)`，箭头 `DownBoldOutlined` 12×12 `rgb(100,106,115)`
 *   `margin-left:8`），展开菜单 128 宽白底 radius 6 三重阴影、item 120×30 `margin:1px 3px`
 *   `padding:4px 8px`、选中 `rgba(31,35,41,.08)` 底 + `rgb(20,86,240)` 字 + 蓝勾；
 * - 「更多高级设置」是 `ud__collapse`：容器只有上边框，header `margin-top:32` `padding:0`，
 *   展开图标 18×18（`padding:4` `margin:0 4px 0 -4px` radius 4）内是 `ExpandRightFilled`
 *   10×10，展开态 `rotate(90deg)`，文字 14/600。
 *
 * 结构类名、`aria-label`、handler 与 disabled/capability 契约保留，测试与既有功能不回归。
 */
import { SECURE_CONFIRM_MESSAGES, SECURE_LINK_TIP } from '../components/lark-doc/editor/shareContent'
import { setAttr, setText, syncChildren } from './dom'
import { iconNode } from './icon'
import { attr, button, callHandler, makeShareClose, setInputValue, svgIcon, text } from './overlayShared'

/** 权限下拉三档（飞书源码 i18n，见文件头）。 */
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

  // —— header：72 高、右侧留 56px 给绝对定位的关闭按钮，无下边框 ——
  const header = text('div', 'lark-doc-permission-header')
  const titleWrap = text('div', 'lark-doc-permission-title-wrap')
  titleWrap.appendChild(text('h3', 'lark-doc-permission-title', '权限设置'))
  const help = text('span', 'lark-doc-permission-help')
  // MaybeOutlined = 飞书 `suite-config-title__icon` 的圆圈问号（真身 15×15、颜色跟随标题）。
  help.appendChild(svgIcon('MaybeOutlined', 15))
  attr(help, 'title', HELP_TIP)
  attr(help, 'role', 'img')
  attr(help, 'aria-label', HELP_TIP)
  titleWrap.appendChild(help)
  header.appendChild(titleWrap)
  const closeButton = button('lark-doc-share-close', '', () => callHandler(handlers, 'onClosePermissionDialog'))
  attr(closeButton, 'aria-label', '关闭')
  closeButton.appendChild(svgIcon('CloseOutlined', 20))
  header.appendChild(closeButton)
  dialog.appendChild(header)

  const body = text('div', 'lark-doc-permission-body')
  const column = text('div', 'lark-doc-permission-column')

  const isOpen = () => !!currentState.permissionDialogOpen
  const items = []
  const checkRows = []
  const scopeSelects = {}

  /** 建一组：标题行 + 规则集容器（组间距由 `.is-first` 控制，首组 20 其余 32）。 */
  function createItem(title, opts = {}) {
    const root = text('div', 'lark-doc-permission-item')
    if (opts.first) root.classList.add('is-first')
    const heading = text('div', 'lark-doc-permission-item-title')
    heading.appendChild(text('span', '', title))
    if (opts.tip) {
      const tip = text('span', 'lark-doc-permission-item-tip')
      tip.appendChild(iconNode('menu-info', 14))
      attr(tip, 'title', opts.tip)
      attr(tip, 'role', 'img')
      attr(tip, 'aria-label', opts.tip)
      heading.appendChild(tip)
    }
    root.appendChild(heading)
    const content = text('div', 'lark-doc-permission-content')
    root.appendChild(content)
    column.appendChild(root)
    items.push(root)
    return { root, content }
  }

  // #0 对外分享：两条复选（第二条是「仅可管理权限…」，本地 mock，不写后端）。
  // #0 对外分享：一条复选 + 一条说明文字（真身是灰字说明，不是可勾选项）。
  const outsideItem = createItem('对外分享', { first: true })
  const outside = createCheckRow('shareOutsideOrg', '允许内容被分享到组织外', handlers, isOpen)
  outsideItem.content.appendChild(outside.el)
  checkRows.push(outside)
  outsideItem.content.appendChild(createRuleTip('仅“可管理权限”可以将内容分享到组织外'))

  // 加密链接区（mt 8，紧随「对外分享」组）。
  const secure = createSecureSection(handlers)
  column.appendChild(secure.root)

  // #1 谁可以查看、添加、移除协作者（下拉 + 说明文字）。
  const collaboratorsItem = createItem('谁可以查看、添加、移除协作者')
  collaboratorsItem.content.appendChild(createScopeSelect('collaborators', '谁可以查看、添加、移除协作者'))
  collaboratorsItem.content.appendChild(createRuleTip('仅组织内的用户可以查看、添加、移除协作者'))

  // #2 ~ #4 单下拉三组。
  ;[
    ['copy', '谁可以复制内容'],
    ['duplicate', '谁可以创建副本、打印和下载'],
    ['comment', '谁可以评论'],
  ].forEach(([id, title]) => {
    const item = createItem(title)
    item.content.appendChild(createScopeSelect(id, title))
  })

  // —— 更多高级设置（ud__collapse，容器只有上边框）——
  const collapse = text('div', 'lark-doc-permission-collapse')
  const collapseHead = text('div', 'lark-doc-permission-collapse-head')
  attr(collapseHead, 'role', 'button')
  const caret = text('span', 'lark-doc-permission-caret')
  attr(caret, 'aria-hidden', 'true')
  caret.appendChild(svgIcon('ExpandRightFilled', 10))
  collapseHead.appendChild(caret)
  collapseHead.appendChild(text('span', 'lark-doc-permission-collapse-text', '更多高级设置'))
  collapseHead.addEventListener('click', () => callHandler(handlers, 'onToggleAdvancedSettings'))
  collapse.appendChild(collapseHead)
  const collapseContent = text('div', 'lark-doc-permission-collapse-content')
  collapse.appendChild(collapseContent)
  column.appendChild(collapse)

  // 折叠内三组：企业信息公开设置（两条复选）/ 访问者头像（下拉）/ 申请引用（一条复选）。
  const advancedItems = []
  const pushAdvanced = (item) => { advancedItems.push(item.root); collapseContent.appendChild(item.root) }
  const infoItem = createItem('企业信息公开设置')
  const advancedAutoPass = createCheckRow('ownerLeaderAutoPass', '文档所有者上级申请访问时自动通过', handlers, isOpen)
  advancedAutoPass.setDisabledReason(true)
  const advancedSearchable = createCheckRow('ownerLeaderSearchable', '文档所有者上级可搜索和访问该文档', handlers, isOpen)
  advancedSearchable.setDisabledReason(true)
  infoItem.content.appendChild(advancedAutoPass.el)
  infoItem.content.appendChild(advancedSearchable.el)
  pushAdvanced(infoItem)
  checkRows.push(advancedAutoPass, advancedSearchable)

  const avatarItem = createItem('谁可以查看访问者头像和点赞者头像')
  avatarItem.content.appendChild(createScopeSelect('visitorAvatar', '谁可以查看访问者头像和点赞者头像'))
  pushAdvanced(avatarItem)

  const applyItem = createItem('谁可以在文档内申请引用文档访问权限', { tip: REQUEST_ACCESS_TIP })
  const applyEmbed = createLocalCheck('applyEmbed', '仅可管理权限的用户可以申请')
  applyItem.content.appendChild(applyEmbed.el)
  pushAdvanced(applyItem)

  body.appendChild(column)
  dialog.appendChild(body)
  layer.appendChild(mask)
  layer.appendChild(dialog)

  const confirm = createConfirmView(handlers)
  const password = createPasswordView(handlers)

  /**
   * 下划线式下拉。真身是 readOnly 的 `ud__select`（点开三档菜单就地选值），本地按
   * 「mock 本地组织」实现：可行交互、选中后由 `onSetPermissionValue` 写本地状态，
   * 不触达后端。菜单挂到 dialog 上用 fixed 定位，避免被 body 的滚动容器裁掉。
   */
  function createScopeSelect(id, label) {
    const root = text('div', 'lark-doc-permission-ruleset')
    const wrap = text('div', 'lark-doc-permission-value lark-doc-select')
    const trigger = button('lark-doc-permission-select')
    attr(trigger, 'aria-label', label)
    attr(trigger, 'aria-haspopup', 'listbox')
    attr(trigger, 'aria-expanded', 'false')
    const content = text('span', 'lark-doc-permission-select-content', SCOPE_OPTIONS[0])
    trigger.appendChild(content)
    const arrow = text('span', 'lark-doc-permission-select-arrow')
    arrow.appendChild(svgIcon('DownBoldOutlined', 12))
    trigger.appendChild(arrow)
    wrap.appendChild(trigger)
    root.appendChild(wrap)

    const menu = text('div', 'lark-doc-select-list')
    attr(menu, 'role', 'listbox')
    const optionNodes = SCOPE_OPTIONS.map((option) => {
      const node = text('div', 'lark-doc-select-option')
      attr(node, 'role', 'option')
      attr(node, 'aria-disabled', 'false')
      node.appendChild(text('span', 'lark-doc-select-option-text', option))
      const check = text('span', 'lark-doc-select-option-check')
      check.appendChild(svgIcon('ListCheckBoldOutlined', 12))
      node.appendChild(check)
      node.addEventListener('click', () => {
        if (!trigger.isConnected || trigger.disabled) return
        close()
        callHandler(handlers, 'onSetPermissionValue', id, option)
      })
      return node
    })
    optionNodes.forEach(node => menu.appendChild(node))

    let open = false
    let scroller = null
    const place = () => {
      const rect = trigger.getBoundingClientRect()
      menu.style.left = `${Math.round(rect.left)}px`
      menu.style.top = `${Math.round(rect.bottom + 4)}px`
    }
    const onDocDown = (event) => {
      if (menu.contains(event.target) || trigger.contains(event.target)) return
      close()
    }
    function close() {
      if (!open) return
      open = false
      menu.remove()
      attr(trigger, 'aria-expanded', 'false')
      trigger.classList.remove('is-open')
      document.removeEventListener('mousedown', onDocDown, true)
      if (scroller) { scroller.removeEventListener('scroll', place); scroller = null }
    }
    function openMenu() {
      if (open || trigger.disabled) return
      open = true
      dialog.appendChild(menu)
      place()
      attr(trigger, 'aria-expanded', 'true')
      trigger.classList.add('is-open')
      document.addEventListener('mousedown', onDocDown, true)
      scroller = trigger.closest('.lark-doc-permission-body')
      if (scroller) scroller.addEventListener('scroll', place, { passive: true })
    }
    trigger.addEventListener('click', (event) => {
      event.stopPropagation()
      if (open) close(); else openMenu()
    })

    const api = {
      el: root,
      trigger,
      close,
      setValue(value) {
        const next = SCOPE_OPTIONS.includes(value) ? value : SCOPE_OPTIONS[0]
        setText(content, next)
        optionNodes.forEach((node, index) => {
          const on = SCOPE_OPTIONS[index] === next
          node.classList.toggle('is-selected', on)
          attr(node, 'aria-selected', on ? 'true' : 'false')
        })
      },
    }
    scopeSelects[id] = api
    return api.el
  }

  /**
   * 复选行（真身 `label.ud__checkbox__wrapper`）：框 16×16 radius 4，勾是 12×12 白勾，
   * 文案 14/lh22 `margin-left:8`，整行 22 高。
   *
   * 保留 `.lark-doc-permission-switch` 类名与 role=switch / aria-label / data-capability /
   * disabled / aria-disabled 契约（既有测试按序取用，见 overlays-native.test.js）。
   */
  function createCheckRow(id, label, h, isDialogOpen) {
    const root = text('div', 'lark-doc-permission-ruleset')
    const row = text('div', 'lark-doc-permission-row')
    const toggle = button('lark-doc-permission-switch')
    attr(toggle, 'role', 'switch')
    attr(toggle, 'aria-label', label)
    toggle.appendChild(svgIcon('CheckBoldSmall', 12))
    const labelNode = text('span', 'lark-doc-permission-check-label', label)
    row.appendChild(toggle)
    row.appendChild(labelNode)
    root.appendChild(row)
    const onClick = () => {
      if (!root.isConnected || !isDialogOpen() || toggle.disabled) return
      callHandler(h, 'onTogglePermissionValue', id)
    }
    toggle.addEventListener('click', onClick)
    labelNode.addEventListener('click', onClick)
    let reason = false
    return {
      el: root,
      setDisabledReason(on) { reason = on },
      update(values, canManage) {
        const on = !!values[id]
        toggle.classList.toggle('is-on', on)
        attr(toggle, 'aria-checked', on ? 'true' : 'false')
        attr(toggle, 'data-capability', 'canManagePermission')
        toggle.disabled = reason === true || canManage === false
        attr(toggle, 'aria-disabled', String(toggle.disabled))
        root.classList.toggle('is-disabled', reason === true || canManage === false)
      },
    }
  }

  /**
   * 规则说明文字：真身 `_ruleset` 里的灰色 helper（12/18、缩进对齐复选文案起点），
   * 只是说明，不可点。
   */
  function createRuleTip(label) {
    return text('div', 'lark-doc-permission-rule-tip', label)
  }

  /**
   * 本地 mock 复选（组织权限服务未接入的项）：视觉与真身一致、可点选，值只写
   * `permissionValues`，不发任何请求。类名 `.lark-doc-permission-check-box` 与受
   * handler 控制的 `.lark-doc-permission-switch` 分开，避免污染其按序取用的契约。
   */
  function createLocalCheck(id, label) {
    const root = text('div', 'lark-doc-permission-ruleset')
    const row = text('div', 'lark-doc-permission-row')
    const box = button('lark-doc-permission-check-box')
    attr(box, 'role', 'switch')
    attr(box, 'aria-label', label)
    attr(box, 'aria-checked', 'false')
    box.appendChild(svgIcon('CheckBoldSmall', 12))
    const labelNode = text('span', 'lark-doc-permission-check-label', label)
    row.appendChild(box)
    row.appendChild(labelNode)
    root.appendChild(row)
    let checked = false
    const onClick = () => {
      if (!root.isConnected || box.disabled) return
      callHandler(handlers, 'onSetPermissionValue', id, !checked)
    }
    box.addEventListener('click', onClick)
    labelNode.addEventListener('click', onClick)
    return {
      el: root,
      update(values) {
        checked = !!values[id]
        box.classList.toggle('is-on', checked)
        attr(box, 'aria-checked', checked ? 'true' : 'false')
      },
    }
  }

  function update(state) {
    currentState = state
    const values = state.permissionValues || {}
    attr(dialog, 'aria-modal', state.shareMobile && !state.passwordDialogOpen && !state.secureLinkConfirmOpen ? 'true' : null)
    outside.update(values, !!state.shareLinkWritable)
    applyEmbed.update(values)
    secure.update(state)
    // 高级设置里的两条：组织免密绕过服务未接入，保持门控只读（真身第二项本身也是 disabled）。
    advancedAutoPass.update(values, false)
    advancedSearchable.update(values, false)
    Object.keys(scopeSelects).forEach((id) => {
      const select = scopeSelects[id]
      select.setValue(values[id])
      select.trigger.disabled = false
      select.trigger.title = ''
    })
    attr(collapseHead, 'aria-expanded', state.permissionAdvancedOpen ? 'true' : 'false')
    collapse.classList.toggle('is-open', !!state.permissionAdvancedOpen)
    caret.classList.toggle('is-open', !!state.permissionAdvancedOpen)
    syncChildren(collapseContent, advancedItems.map(node => ({ node, on: !!state.permissionAdvancedOpen })))
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
  // 真身是空心描边铅笔（`EditOutlined`），不是实心块。
  editPassword.appendChild(svgIcon('EditOutlined', 16))
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
