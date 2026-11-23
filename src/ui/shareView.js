/**
 * 分享浮层（原 SharePopover.vue 的渲染层）：分享对象、链接权限、服务入口与二维码面板。
 *
 * 从 `ui/overlays.js` 原样搬出，函数体、类名、aria 一行未改。
 */
import { applyStyle, setAttr, setText, syncChildren } from './dom'
import { iconNode } from './icon'
import { attr, button, callHandler, setInputValue, svgIcon, text } from './overlayShared'
import { createSelect } from './select'
import { createPermissionView } from './permissionView'
import { createManageView, createAddView } from './collaboratorView'
import { createShareQrView } from './shareQrView'

/**
 * 链接范围四档（飞书 `linkShareScope`，文案见 279-33888 的 `Lf()/Mf()`）。
 * `tenant` / `partner` 需要密级与关联组织能力，本库协议层 `organizationBypass`
 * 恒为 unavailable，所以只置灰不隐藏 —— 与飞书「能力不足时禁用」的形态一致。
 */
const SHARE_SCOPE_OPTIONS = Object.freeze([
  { value: 'collaborators', label: '仅协作者' },
  { value: 'tenant', label: '本组织', disabled: true },
  { value: 'public', label: '互联网获得链接的人' },
  { value: 'partner', label: '本组织及关联组织', disabled: true },
])
const SHARE_PERM_OPTIONS = Object.freeze([
  { value: '可阅读', label: '可阅读' },
  { value: '可编辑', label: '可编辑' },
])
const SHARE_SCOPE_UNSET = Object.freeze([{ value: '', label: '未配置', disabled: true }])

function createShareView(options) {
  const handlers = options.handlers || {}
  const layer = text('div', 'lark-doc-share-layer')
  const state = {}

  const popover = text('div', 'lark-doc-share-popover')
  attr(popover, 'role', 'dialog')
  attr(popover, 'aria-label', '分享文档')
  const popoverInner = text('div', 'lark-doc-share-popover-inner')
  const shareHeader = text('div', 'lark-doc-share-header')
  const shareTitle = text('h3', 'lark-doc-share-header-title', '分享文档')
  const shareHelp = text('span', 'lark-doc-share-header-help')
  const shareHelpText = '可邀请协作者或复制链接；访问范围以文档权限为准'
  attr(shareHelp, 'role', 'img'); attr(shareHelp, 'aria-label', shareHelpText)
  shareHelp.title = shareHelpText; shareHelp.tabIndex = 0
  shareHelp.appendChild(svgIcon('MaybeOutlined', 14)); shareTitle.appendChild(shareHelp)
  shareHeader.appendChild(shareTitle)
  const headerActions = text('div', 'lark-doc-share-header-actions')
  const permissionButton = button('lark-doc-share-perm-btn')
  attr(permissionButton, 'aria-label', '权限设置')
  attr(permissionButton, 'data-capability', 'canManagePermission')
  permissionButton.appendChild(svgIcon('SettingOutlined'))
  permissionButton.appendChild(text('span', '', '权限设置'))
  permissionButton.addEventListener('click', () => callHandler(handlers, 'onOpenPermissionDialog'))
  headerActions.appendChild(permissionButton)
  shareHeader.appendChild(headerActions)
  popoverInner.appendChild(shareHeader)

  const memberRow = text('div', 'lark-doc-share-member-row')
  memberRow.appendChild(text('span', 'lark-doc-share-member-text', '邀请协作者'))
  const avatars = button('lark-doc-share-avatars', '', () => {
    if (!popover.isConnected || !state.sharePopoverOpen || state.shareCanManagePermission === false) return
    // 桌面端点「我 ▾」进飞书「管理协作者」二级弹窗；移动端保持原单页 members 路由。
    if (isMobile()) { setPage('members'); callHandler(handlers, 'onLoadShareMembers') }
    else callHandler(handlers, 'onOpenCollaboratorManage')
  })
  attr(avatars, 'aria-label', '查看协作者')
  avatars.appendChild(text('span', 'lark-doc-share-avatar'))
  const avatarMore = text('span', 'lark-doc-share-avatar-more'); avatars.appendChild(avatarMore)
  const membersChevron = text('span', 'lark-doc-share-members-chevron')
  membersChevron.appendChild(iconNode('caretRight', 16))
  avatars.appendChild(membersChevron)
  memberRow.appendChild(avatars)
  popoverInner.appendChild(memberRow)

  const invite = text('div', 'lark-doc-share-invite')
  const inviteInput = document.createElement('input')
  attr(inviteInput, 'aria-label', '邀请协作者')
  inviteInput.placeholder = '搜索用户、群组、部门、用户组或智能体'
  inviteInput.addEventListener('input', (event) => {
    if (!popover.isConnected || !state.sharePopoverOpen) return
    callHandler(handlers, 'onSetShareInviteQuery', event.target.value)
    if (isMobile()) setPage('invite')
  })
  invite.appendChild(inviteInput)
  // 飞书这一格是输入框内的「+」：桌面端把焦点送回输入框（候选列表跟着输入出现），
  // 手机端才走整页路由。
  const inviteEntry = attr(button('lark-doc-share-org-entry', '', () => {
    if (!popover.isConnected || !state.sharePopoverOpen) return
    if (isMobile()) setPage('invite')
    else inviteInput.focus()
  }), 'aria-label', '添加协作者')
  inviteEntry.appendChild(svgIcon('AddOutlined', 16)); invite.appendChild(inviteEntry)
  popoverInner.appendChild(invite)

  const lower = text('div', 'lark-doc-share-lower')
  const linkCard = text('div', 'lark-doc-share-link-card')
  const linkHead = text('div', 'lark-doc-share-link-head')
  const linkHeadMain = text('div', 'lark-doc-share-link-head-main')
  linkHeadMain.appendChild(text('span', 'lark-doc-share-link-title', '链接分享'))
  const linkTag = text('span', 'lark-doc-share-link-tag')
  const linkTagValue = text('span')
  linkTag.appendChild(linkTagValue)
  linkHeadMain.appendChild(linkTag)
  const passwordLink = button('lark-doc-share-pwd-link', '启用密码', () => {
    if (popover.isConnected && state.sharePopoverOpen) callHandler(handlers, 'onPasswordSetting')
  })
  linkHead.append(linkHeadMain, passwordLink)
  linkCard.appendChild(linkHead)
  const linkBody = text('div', 'lark-doc-share-link-body')
  const linkIcon = text('span', 'lark-doc-share-link-icon')
  // 飞书这一格是蓝色圆底 + 白色地球（不是链环）。图形见 icons.js 的 share-globe。
  // 地球墨迹实测 12.5 CSS（圆盘 30），20 的图标画出来是 15.5，偏大。
  linkIcon.appendChild(iconNode('share-globe', 16))
  linkBody.appendChild(linkIcon)
  const linkMain = text('div', 'lark-doc-share-link-main')
  /**
   * 范围下拉。飞书桌面 V3 是 `linkShareScope` 四档（仅协作者 / 组织内 / 互联网 / 关联组织，
   * 见 279-33888 的 `Lf()`），不是 7 项那份扁平列表（`ZH()` 是另一处 UI 用的）。
   * 后两档要 securityLevel 与关联组织能力：本库 share-links 协议把 `organizationBypass`
   * 固定成 unavailable，所以只能置灰，不假装可写。
   */
  const scopeSelect = createSelect({
    ariaLabel: '链接范围',
    className: 'lark-doc-share-scope-select',
    menuMinWidth: 240,
    caret: 'caretWide',
    caretSize: 16,
    options: SHARE_SCOPE_OPTIONS,
    onChange: (value) => {
      if (!popover.isConnected || !state.sharePopoverOpen || !state.shareLinkWritable) return
      callHandler(handlers, 'onSetShareLinkAudience', value)
    },
  })
  linkMain.appendChild(scopeSelect.el)
  const scopeText = text('span', 'lark-doc-share-scope-text')
  linkMain.appendChild(scopeText)
  linkBody.appendChild(linkMain)
  const permSelect = createSelect({
    ariaLabel: '链接权限',
    className: 'lark-doc-share-perm-select',
    menuMinWidth: 120,
    caret: 'caretWide',
    caretSize: 16,
    options: SHARE_PERM_OPTIONS,
    onChange: (value) => {
      if (!popover.isConnected || !state.sharePopoverOpen || !state.shareLinkWritable) return
      callHandler(handlers, 'onSetShareLinkPerm', value)
    },
  })
  linkBody.appendChild(permSelect.el)
  linkCard.appendChild(linkBody)
  const linkFeedback = text('div', 'lark-doc-share-status')
  attr(linkFeedback, 'role', 'status')
  const linkReload = button('lark-doc-share-btn-outlined', '重新载入', () => {
    if (popover.isConnected && state.sharePopoverOpen && state.shareLinkAvailable && !state.shareLinkBusy) callHandler(handlers, state.shareLinkPending ? 'onQueryShareLink' : 'onLoadShareLink')
  })
  const linkStatus = text('span')
  linkFeedback.append(linkStatus, linkReload)
  linkCard.appendChild(linkFeedback)
  const copyRow = text('div', 'lark-doc-share-copy-row')
  const copyLink = button('lark-doc-share-copy-link', '', () => { if (popover.isConnected && state.sharePopoverOpen) callHandler(handlers, 'onCopyShareLink') })
  const copyLabel = text('span', '', '复制链接')
  copyLink.append(iconNode('link', 14), copyLabel); copyRow.appendChild(copyLink)
  // 飞书真实渠道行：wechat/qrcode=面板、passwordSetting=密码面板（web-scripts/279-33888.b3a2968c.js）；
  // data-share-channel 供验收定位。用户口径（截图红框）只保留后三枚：飞书会话 logo 与
  // 订阅号紫星连同功能一并去掉，不再渲染。
  const onChannel = (event) => {
    if (popover.isConnected && state.sharePopoverOpen) {
      callHandler(handlers, 'onShareChannel', event.currentTarget.dataset.shareChannel)
    }
  }
  for (const [channelId, label, icon, size] of [['wechat', '微信', 'WechatColorful', 20], ['qrcode', '二维码', 'QrOutlined', 16], ['secure', '加密链接', 'LinkLockOutlined', 16]]) {
    const channel = button('lark-doc-share-channel', '', onChannel)
    attr(channel, 'aria-label', label); channel.title = label
    attr(channel, 'data-share-channel', channelId)
    channel.appendChild(svgIcon(icon, size)); copyRow.appendChild(channel)
  }
  // 灰条挂在面板内层而不是链接卡里：飞书这条是**贴面板左右边的通栏**（480 宽），
  // 链接卡自带 16px 内衬，挂进去会右移 16、底下再白留 16（实测 335 → 343）。
  lower.appendChild(linkCard)
  popoverInner.append(lower, copyRow)
  popover.appendChild(popoverInner)

  // Mobile routes reuse the same guarded business actions as the desktop view.
  const mobile = text('section', 'lark-doc-share-mobile')
  const mobileHead = text('header', 'lark-doc-share-mobile-head')
  const mobileTitle = text('h3', '', '协作者')
  let mobilePage = 'index', mobileVisible = false, restoreFocus = null, unlock = null, invitationStatus = 'idle'
  const directoryRows = new Map()
  const isMobile = () => layer.ownerDocument.defaultView.innerWidth <= 760
  const closeMobile = () => callHandler(handlers, 'onCloseSharePopover')
  const setPage = page => { mobilePage = page; render(state); (page === 'invite' ? mobileInput.hidden ? mobileRole.disabled ? mobileInviteFeedback : mobileRole : mobileInput : mobileBack).focus() }
  const mobileBack = button('', '‹', () => { setPage('index'); inviteInput.focus() })
  attr(mobileBack, 'aria-label', '返回协作者')
  const mobileClose = button('', '×', closeMobile); attr(mobileClose, 'aria-label', '关闭协作者')
  mobileHead.append(mobileBack, mobileTitle, mobileClose); mobile.append(mobileHead)
  const mobileIndex = text('div', 'lark-doc-share-mobile-index')
  const mobileRow = (label, icon, action) => {
    const row = button('lark-doc-share-mobile-row', '', action)
    row.append(iconNode(icon, 20), text('span', '', label))
    return row
  }
  const mobileInvite = mobileRow('邀请协作者', 'members', () => setPage('invite')); attr(mobileInvite, 'aria-label', '邀请协作者')
  mobileInvite.append(text('span', 'lark-doc-share-mobile-chevron', '›'))
  const mobileMembers = mobileRow('协作者', 'members', () => { setPage('members'); callHandler(handlers, 'onLoadShareMembers') }); attr(mobileMembers, 'aria-label', '查看协作者')
  const mobileMemberAvatar = text('span', 'lark-doc-share-mobile-avatar'); mobileMembers.append(mobileMemberAvatar)
  const mobileCopy = mobileRow('复制链接', 'link', () => callHandler(handlers, 'onCopyShareLink'))
  mobileIndex.append(mobileInvite, text('div', 'lark-doc-share-mobile-divider'), mobileMembers, text('div', 'lark-doc-share-mobile-divider'), mobileCopy)
  const mobileSearch = text('div', 'lark-doc-share-mobile-search')
  const mobileInput = document.createElement('input')
  mobileInput.placeholder = inviteInput.placeholder; attr(mobileInput, 'aria-label', '搜索协作者')
  mobileInput.addEventListener('input', event => callHandler(handlers, 'onSetShareInviteQuery', event.target.value))
  mobileSearch.append(mobileInput)
  const mobileResults = text('div', 'lark-doc-share-mobile-results'); mobileSearch.append(mobileResults)
  const mobileSearchRetry = button('lark-doc-share-mobile-retry', '重试搜索', () => callHandler(handlers, 'onSearchShareDirectory')); mobileSearch.append(mobileSearchRetry)
  const mobileMemberPage = text('div', 'lark-doc-share-mobile-members')
  const mobileMemberList = text('div', 'lark-doc-share-mobile-member-list')
  const mobileMemberRetry = button('lark-doc-share-mobile-retry', '重新加载协作者', () => callHandler(handlers, 'onLoadShareMembers'))
  const mobileSettings = button('lark-doc-share-mobile-settings', '权限与链接设置', () => setPage('settings'))
  mobileMemberPage.append(mobileMemberList, mobileMemberRetry, mobileSettings)
  const mobileStatus = text('p', 'lark-doc-share-mobile-status'); attr(mobileStatus, 'role', 'status')
  mobileSearch.append(mobileStatus)
  const mobileConfirm = text('div', 'lark-doc-share-mobile-confirm')
  const mobileRecipient = text('p', 'lark-doc-share-mobile-recipient')
  const mobileRoleLabel = text('label', 'lark-doc-share-mobile-role', '权限')
  const mobileRole = document.createElement('select'); attr(mobileRole, 'aria-label', '邀请权限')
  ;[['read', '可阅读'], ['edit', '可编辑'], ['manage', '可管理']].forEach(([value, label]) => {
    const option = document.createElement('option'); option.value = value; option.textContent = label; mobileRole.append(option)
  })
  mobileRole.addEventListener('change', () => callHandler(handlers, 'onSetShareInviteRole', mobileRole.value)); mobileRoleLabel.append(mobileRole)
  const mobileInviteFeedback = text('p', 'lark-doc-share-mobile-status'); attr(mobileInviteFeedback, 'role', 'status'); mobileInviteFeedback.tabIndex = -1
  const mobileSend = button('lark-doc-share-mobile-send', '发送', () => callHandler(handlers, 'onSubmitShareInvitation'))
  const mobileQuery = button('lark-doc-share-mobile-retry', '查询原邀请操作', () => callHandler(handlers, 'onQueryShareInvitation'))
  const mobileReselect = button('lark-doc-share-mobile-retry', '重新选择协作者', () => callHandler(handlers, 'onCancelShareInvitation'))
  mobileConfirm.append(mobileRecipient, mobileRoleLabel, mobileInviteFeedback, mobileSend, mobileQuery, mobileReselect); mobileSearch.append(mobileConfirm)
  mobile.append(mobileIndex, mobileSearch, mobileMemberPage)
  popover.prepend(mobile)
  const mobileMask = text('div', 'lark-doc-share-mobile-mask')
  mobileMask.addEventListener('click', closeMobile)
  popover.addEventListener('keydown', event => {
    if (!mobileVisible || state.permissionDialogOpen) return
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation()
      if (mobilePage !== 'index') { setPage('index'); inviteInput.focus() } else closeMobile()
    } else if (event.key === 'Tab') {
      const nodes = [...popover.querySelectorAll('button,input,select')].filter(node => !node.disabled && !node.closest('[hidden]'))
      const first = nodes[0], last = nodes[nodes.length - 1], active = layer.ownerDocument.activeElement
      if (event.shiftKey && active === first || !event.shiftKey && active === last) { event.preventDefault(); (event.shiftKey ? last : first)?.focus() }
    }
  })

  const permissionLayer = createPermissionView({ handlers })
  const manageLayer = createManageView({ handlers })
  const addLayer = createAddView({ handlers })

  const shareQr = createShareQrView(handlers)

  const childStates = {}, childFocus = new Map()
  layer.addEventListener('keydown', event => {
    if (event.key === 'Escape' && state.shareQr) {
      event.preventDefault(); event.stopPropagation()
      callHandler(handlers, 'onCloseShareQrCode'); return
    }
    if (event.key === 'Escape' && state.collaboratorAddOpen) {
      event.preventDefault(); event.stopPropagation()
      callHandler(handlers, 'onCloseCollaboratorAdd'); return
    }
    if (event.key === 'Escape' && state.collaboratorManageOpen) {
      event.preventDefault(); event.stopPropagation()
      callHandler(handlers, 'onCloseCollaboratorManage'); return
    }
    if (!mobileVisible || !state.permissionDialogOpen || !permissionLayer.el.contains(event.target)) return
    const dialog = permissionLayer.el.querySelector(state.passwordDialogOpen ? '.lark-doc-share-password' : state.secureLinkConfirmOpen ? '.lark-doc-share-confirm' : '.lark-doc-permission-dialog')
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation()
      callHandler(handlers, state.passwordDialogOpen ? 'onClosePasswordDialog' : state.secureLinkConfirmOpen ? 'onCancelSecureLinkConfirm' : 'onClosePermissionDialog')
    } else if (event.key === 'Tab') {
      const nodes = [...dialog.querySelectorAll('button,input,select,[tabindex="0"]')].filter(node => !node.disabled && !node.closest('[hidden]'))
      const first = nodes[0], last = nodes[nodes.length - 1], active = layer.ownerDocument.activeElement
      if (event.shiftKey && active === first || !event.shiftKey && active === last) { event.preventDefault(); (event.shiftKey ? last : first)?.focus() }
    }
  })
  layer.appendChild(popover)
  layer.appendChild(permissionLayer.el)
  layer.appendChild(manageLayer.el)
  layer.appendChild(addLayer.el)

  function render(next) {
    const inviteFocusOwned = mobileSearch.contains(layer.ownerDocument.activeElement)
    Object.assign(state, next || {})
    const restoreChildren = [], openingChildren = []
    for (const key of ['permissionDialogOpen', 'secureLinkConfirmOpen', 'passwordDialogOpen']) {
      if (state[key] && !childStates[key]) { childFocus.set(key, layer.ownerDocument.activeElement); openingChildren.push(key) }
      if (!state[key] && childStates[key]) { restoreChildren.unshift(childFocus.get(key)); childFocus.delete(key) }
      childStates[key] = !!state[key]
    }
    const visible = !!state.sharePopoverOpen && state.shareCanManagePermission !== false && isMobile()
    if (visible && !mobileVisible) { restoreFocus = layer.ownerDocument.activeElement; mobilePage = 'index' }
    popover.classList.toggle('is-mobile-reference', visible)
    // 桌面与手机同父级（弹窗内层），几何差异交给 CSS 的 is-mobile-reference；
    // 渠道行两态都展示：飞书底部是「复制链接 + 渠道」整行，不再按手机态隐藏。
    if (copyRow.parentNode !== popoverInner) popoverInner.appendChild(copyRow)
    copyLink.className = 'lark-doc-share-copy-link'
    popoverInner.hidden = state.sharePopoverOpen && !['index', 'settings'].includes(mobilePage)
    mobile.hidden = !state.sharePopoverOpen || mobilePage === 'index'
    attr(popover, 'aria-label', visible && mobilePage !== 'index' ? '协作者' : '分享文档')
    setAttr(popover, 'aria-modal', visible && mobilePage !== 'index' ? 'true' : null)
    if (unlock) { unlock(); unlock = null }
    mobileTitle.textContent = mobilePage === 'invite' ? '邀请协作者' : mobilePage === 'settings' ? '权限与链接设置' : '协作者'
    mobileBack.hidden = mobilePage === 'index'; mobileIndex.hidden = mobilePage !== 'index'; mobileSearch.hidden = mobilePage !== 'invite'; mobileMemberPage.hidden = mobilePage !== 'members'
    setInputValue(mobileInput, state.shareInviteQuery)
    const members = state.shareMembers || {}, directory = state.shareDirectory || {}, invitation = state.shareInvitation || {}
    setText(mobileMemberAvatar, members.status === 'ready' && members.items?.length ? members.items[0].principalId.slice(0, 1) : '')
    mobileMemberAvatar.hidden = !mobileMemberAvatar.textContent
    mobileMemberList.replaceChildren()
    if (members.status === 'ready') {
      (members.items || []).forEach(member => {
        const row = text('div', 'lark-doc-share-mobile-member')
        row.append(text('span', 'lark-doc-share-mobile-avatar', member.principalId.slice(0, 1)), text('span', '', member.principalId), text('span', 'lark-doc-share-mobile-scope', member.scopes?.includes('grant.manage') ? '可管理' : member.scopes?.includes('document.write') ? '可编辑' : '可阅读'))
        mobileMemberList.append(row)
      })
      if (!members.items?.length) mobileMemberList.textContent = '暂无协作者'
    } else mobileMemberList.textContent = members.status === 'failed' ? members.error || '无法加载协作者。' : '正在加载协作者…'
    mobileMemberRetry.hidden = members.status !== 'failed'
    const wantedCandidates = new Set((directory.items || []).map(candidate => candidate.principalId))
    directoryRows.forEach((row, id) => { if (!wantedCandidates.has(id)) { row.remove(); directoryRows.delete(id) } })
    syncChildren(mobileResults, (directory.items || []).map(candidate => {
      let row = directoryRows.get(candidate.principalId)
      if (!row) { row = button('lark-doc-share-mobile-member', '', () => callHandler(handlers, 'onSelectShareInviteCandidate', candidate.principalId)); directoryRows.set(candidate.principalId, row) }
      setText(row, candidate.displayName || candidate.principalId)
      attr(row, 'aria-label', `选择协作者 ${candidate.displayName || candidate.principalId}`)
      return { node: row, on: true }
    }))
    mobileSearchRetry.hidden = !['failed', 'blocked'].includes(directory.status)
    setText(mobileStatus, directory.status === 'loading' ? '正在搜索…' : ['failed', 'blocked'].includes(directory.status) ? directory.error : directory.status === 'ready' && !directory.items?.length ? '未找到协作者' : '')
    const confirming = !!invitation.candidate
    mobileConfirm.hidden = !confirming
    mobileInput.hidden = confirming; mobileResults.hidden = confirming; mobileStatus.hidden = confirming
    if (confirming) mobileSearchRetry.hidden = true
    setText(mobileRecipient, invitation.candidate?.displayName || invitation.candidate?.principalId)
    mobileRole.value = invitation.role || 'read'; mobileRole.disabled = invitation.status !== 'confirm'
    mobileSend.hidden = !['confirm', 'sending', 'querying', 'preparing'].includes(invitation.status)
    if (['sending', 'querying'].includes(invitation.status) && mobileConfirm.contains(document.activeElement)) mobileInviteFeedback.focus()
    mobileSend.disabled = invitation.status !== 'confirm'
    mobileQuery.hidden = !(['unknown', 'blocked'].includes(invitation.status) || invitation.status === 'committed' && !invitation.verified)
    mobileReselect.hidden = !(invitation.status === 'failed' || invitation.status === 'committed' && invitation.verified)
    setText(mobileInviteFeedback, invitation.error || (invitation.status === 'preparing' ? '正在确认协作者版本…' : invitation.status === 'sending' ? '正在发送邀请…' : invitation.status === 'querying' ? '正在查询原邀请操作…' : invitation.status === 'committed' && invitation.verified ? '协作者权限已保存' : '确认邀请后，将为此协作者授予所选权限。'))
    shareQr.update(state.shareQr)
    const collabOpen = !!state.collaboratorManageOpen || !!state.collaboratorAddOpen
    const popoverStyle = state.sharePopoverStyle || {}
    // 协作者二级弹窗替换分享 popover 的位置；打开时收起 popover（移动端子页同样收起）。
    manageLayer.update({ ...state, shareMembers: state.shareMembers })
    addLayer.update({ ...state, collaboratorSubpage: state.collaboratorSubpage, collaboratorNotify: state.collaboratorNotify, collaboratorNote: state.collaboratorNote })
    syncChildren(layer, [
      { node: mobileMask, on: false },
      // 权限 Dialog 是两层叠加（popover 保留）；只有协作者弹窗才是替换位置。
      { node: popover, on: !!state.sharePopoverOpen && !collabOpen },
      { node: permissionLayer.el, on: !!state.permissionDialogOpen },
      { node: manageLayer.el, on: !!state.collaboratorManageOpen },
      { node: addLayer.el, on: !!state.collaboratorAddOpen },
      { node: shareQr.el, on: !!state.shareQr },
    ])
    permissionButton.disabled = state.shareCanManagePermission === false
    attr(permissionButton, 'aria-disabled', String(permissionButton.disabled))
    applyStyle(popover, popoverStyle)
    applyStyle(manageLayer.el, popoverStyle)
    applyStyle(addLayer.el, popoverStyle)
    setInputValue(inviteInput, state.shareInviteQuery)
    const firstMember = state.shareMembers?.status === 'ready' ? state.shareMembers.items?.[0]?.principalId : null
    // 协作者列表还没回来时不能留空：飞书这一格始终有「自己」的头像（截图是「健军」）。
    // 原写法用 `state.shareMembers ?` 判真，而 idle 态的对象恒为真，于是首字被算成空串。
    setText(avatars.children[0], firstMember ? firstMember.slice(0, 1) : state.shareCollaboratorInitial)
    avatars.children[0].style.display = avatars.children[0].textContent ? '' : 'none'
    setText(avatarMore, state.shareMembers?.status === 'ready' && state.shareMembers.items?.length > 1 ? `+${state.shareMembers.items.length - 1}` : '')
    avatarMore.hidden = !avatarMore.textContent
    const scopeConfigured = !!state.shareLinkState
    scopeSelect.update({
      options: scopeConfigured ? SHARE_SCOPE_OPTIONS : SHARE_SCOPE_UNSET,
      value: scopeConfigured ? (state.shareLinkState.audience === 'public' ? 'public' : 'collaborators') : '',
      disabled: !state.shareLinkWritable,
    })
    permSelect.update({
      options: scopeConfigured ? SHARE_PERM_OPTIONS : SHARE_SCOPE_UNSET,
      value: scopeConfigured ? state.shareLinkPermLabel || '' : '',
      disabled: !state.shareLinkWritable,
    })
    setText(linkStatus, state.shareLinkBusy ? '正在读取或保存链接权限…' : state.shareLinkError || (state.shareLinkPending ? '链接操作待确认，请查询原操作。' : !state.shareLinkAvailable ? '链接权限服务尚未接入，当前不可用。' : ''))
    // 截图是正常态，链接卡里没有「重新载入」这一行；它只在真出错/待查询时才是恢复入口。
    linkReload.hidden = !state.shareLinkAvailable || (!state.shareLinkBusy && !state.shareLinkError && !state.shareLinkPending)
    linkReload.disabled = !!state.shareLinkBusy
    setText(linkReload, state.shareLinkPending ? '查询原操作' : '重新载入')
    // 整条状态行在「无文案且无按钮」时收起来 —— 空 span 仍吃 8px margin-top，
    // 会让链接卡比飞书高 8（196 vs 188）。
    linkFeedback.hidden = !linkStatus.textContent && linkReload.hidden
    setText(linkTagValue, state.shareLinkScopeTag || (scopeConfigured ? state.shareLinkPermLabel : '未配置'))
    setText(copyLabel, state.shareCopyLabel || '复制链接')
    setText(passwordLink, state.sharePasswordEnabled ? '修改密码' : '启用密码')
    passwordLink.hidden = state.sharePasswordSettingEnabled === false
    setText(scopeText, scopeConfigured ? state.shareScopeText : '链接范围与权限服务尚未配置')
    permissionLayer.update({ ...state, shareMobile: visible })
    if (visible && openingChildren.length) {
      const selector = state.passwordDialogOpen ? '.lark-doc-share-password' : state.secureLinkConfirmOpen ? '.lark-doc-share-confirm' : '.lark-doc-permission-dialog'
      permissionLayer.el.querySelector(`${selector} button:not(:disabled)`)?.focus()
    }
    if (visible && restoreChildren.length) (restoreChildren.find(node => node?.isConnected && !node.closest('[hidden]')) || permissionButton).focus({ preventScroll: true })
    if (visible && !mobileVisible) permissionButton.focus()
    if (visible && mobilePage === 'invite' && invitationStatus !== (invitation.status || 'idle') && inviteFocusOwned) {
      const focus = invitation.status === 'confirm' ? mobileRole : ['unknown', 'blocked'].includes(invitation.status) ? mobileQuery : !confirming ? mobileInput : mobileInviteFeedback
      focus.focus({ preventScroll: true })
    }
    invitationStatus = invitation.status || 'idle'
    if (!visible && mobileVisible && restoreFocus?.isConnected && !state.permissionDialogOpen) restoreFocus.focus({ preventScroll: true })
    mobileVisible = visible
  }

  return { el: layer, update: render, destroy() { unlock?.(); unlock = null; if (layer.parentNode) layer.parentNode.removeChild(layer) } }
}

export { createShareView }
