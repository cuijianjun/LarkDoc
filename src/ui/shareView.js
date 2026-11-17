/**
 * 分享浮层（原 SharePopover.vue 的渲染层）：分享对象、链接权限、服务入口与二维码面板。
 *
 * 从 `ui/overlays.js` 原样搬出，函数体、类名、aria 一行未改。
 */
import { applyStyle, setAttr, setText, syncChildren } from './dom'
import { iconNode } from './icon'
import { attr, button, callHandler, setInputValue, svgIcon, text } from './overlayShared'
import { createPermissionView } from './permissionView'

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
    setPage('members'); callHandler(handlers, 'onLoadShareMembers')
  })
  attr(avatars, 'aria-label', '查看协作者')
  avatars.appendChild(text('span', 'lark-doc-share-avatar'))
  const avatarMore = text('span', 'lark-doc-share-avatar-more'); avatars.appendChild(avatarMore)
  avatars.appendChild(text('span', 'lark-doc-share-members-chevron', '›'))
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
  const inviteEntry = attr(button('lark-doc-share-org-entry', '', () => { if (popover.isConnected && state.sharePopoverOpen) setPage('invite') }), 'aria-label', '添加协作者')
  inviteEntry.appendChild(svgIcon('AddOutlined', 16)); invite.appendChild(inviteEntry)
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
  const orgButton = document.createElement('select')
  orgButton.className = 'lark-doc-share-org-btn'
  attr(orgButton, 'aria-label', '链接范围')
  orgButton.addEventListener('change', () => {
    if (popover.isConnected && state.sharePopoverOpen && state.shareLinkWritable && !orgButton.disabled) callHandler(handlers, 'onSetShareLinkAudience', orgButton.value)
  })
  linkMain.appendChild(orgButton)
  const scopeText = text('span', 'lark-doc-share-scope-text')
  linkMain.appendChild(scopeText)
  linkBody.appendChild(linkMain)
  const linkSelect = document.createElement('select')
  linkSelect.className = 'lark-doc-share-perm-select'
  attr(linkSelect, 'aria-label', '链接权限')
  linkSelect.disabled = true; linkSelect.title = '链接权限设置尚未接入文档服务。'
  linkSelect.addEventListener('change', () => {
    if (popover.isConnected && state.sharePopoverOpen && state.shareLinkWritable && !linkSelect.disabled) callHandler(handlers, 'onSetShareLinkPerm', linkSelect.value)
  })
  linkBody.appendChild(linkSelect)
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
  copyLink.append(iconNode('link', 14), text('span', '', '复制链接')); copyRow.appendChild(copyLink)
  for (const [label, icon, size] of [['通过飞书分享', 'LarkLogoColorful', 18], ['分享至收藏', 'SubscriptionShareColorful', 20], ['通过微信分享', 'WechatColorful', 20], ['分享二维码', 'QrOutlined', 16], ['加密链接分享', 'LinkLockOutlined', 16]]) {
    const channel = button('lark-doc-share-channel', ''); channel.disabled = true
    attr(channel, 'aria-label', label); channel.title = label + '服务尚未配置'; channel.appendChild(svgIcon(icon, size)); copyRow.appendChild(channel)
  }
  for (const [label, icon] of [['图片分享', 'image'], ['朋友圈', 'share-link'], ['QQ', 'share-link'], ['微博', 'share-link'], ['更多分享方式', 'more']]) {
    const channel = button('lark-doc-share-channel', '')
    channel.disabled = true; channel.title = `${label}服务尚未配置，暂不可用`; attr(channel, 'aria-label', channel.title)
    channel.appendChild(iconNode(icon, 18)); copyRow.appendChild(channel)
  }
  linkCard.appendChild(copyRow)
  lower.appendChild(linkCard)
  popoverInner.appendChild(lower)
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
  const childStates = {}, childFocus = new Map()
  layer.addEventListener('keydown', event => {
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
    if (visible && copyRow.parentNode !== popoverInner) popoverInner.appendChild(copyRow)
    else if (!visible && copyRow.parentNode !== linkCard) linkCard.appendChild(copyRow)
    copyLink.className = visible ? 'lark-doc-share-copy-link' : 'lark-doc-share-btn-filled'
    copyRow.querySelectorAll('.lark-doc-share-channel').forEach(node => { node.hidden = !visible; node.style.display = visible ? '' : 'none' })
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
    syncChildren(layer, [
      { node: mobileMask, on: false },
      { node: popover, on: !!state.sharePopoverOpen },
      { node: permissionLayer.el, on: !!state.permissionDialogOpen },
    ])
    permissionButton.disabled = state.shareCanManagePermission === false
    attr(permissionButton, 'aria-disabled', String(permissionButton.disabled))
    applyStyle(popover, state.sharePopoverStyle || {})
    setInputValue(inviteInput, state.shareInviteQuery)
    const firstMember = state.shareMembers?.status === 'ready' ? state.shareMembers.items?.[0]?.principalId : null
    setText(avatars.children[0], state.shareMembers ? firstMember?.slice(0, 1) || '' : state.shareCollaboratorInitial)
    avatars.children[0].style.display = avatars.children[0].textContent ? '' : 'none'
    setText(avatarMore, state.shareMembers?.status === 'ready' && state.shareMembers.items?.length > 1 ? `+${state.shareMembers.items.length - 1}` : '')
    avatarMore.hidden = !avatarMore.textContent
    const scopeConfigured = !!state.shareLinkState
    orgButton.replaceChildren(...(scopeConfigured ? [['collaborators', '仅协作者'], ['public', '互联网用户']] : [['', '未配置']]).map(([value, label]) => {
      const option = document.createElement('option'); option.value = value; option.textContent = label; return option
    }))
    orgButton.value = state.shareLinkState?.audience || ''
    orgButton.disabled = !state.shareLinkWritable
    orgButton.title = scopeConfigured ? '' : '链接范围设置尚未接入文档服务。'
    linkSelect.disabled = !state.shareLinkWritable
    linkSelect.title = scopeConfigured ? '' : '链接权限设置尚未接入文档服务。'
    setText(linkStatus, state.shareLinkBusy ? '正在读取或保存链接权限…' : state.shareLinkError || (state.shareLinkPending ? '链接操作待确认，请查询原操作。' : !state.shareLinkAvailable ? '链接权限服务尚未接入，当前不可用。' : ''))
    linkReload.hidden = !state.shareLinkAvailable
    linkReload.disabled = !!state.shareLinkBusy
    setText(linkReload, state.shareLinkPending ? '查询原操作' : '重新载入')
    setText(linkTagValue, scopeConfigured ? state.shareLinkPermLabel : '未配置')
    setText(scopeText, scopeConfigured ? state.shareScopeText : '链接范围与权限服务尚未配置')
    linkSelect.textContent = ''
    ;(scopeConfigured ? state.shareLinkPermOptions || [] : ['未配置']).forEach((option) => {
      const item = document.createElement('option')
      item.value = option
      item.textContent = option
      linkSelect.appendChild(item)
    })
    linkSelect.value = scopeConfigured ? state.shareLinkPermLabel || '' : '未配置'
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
