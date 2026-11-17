/**
 * popover、权限 Dialog、加密链接与密码、复制与提示 —— capability 投影、弹窗开关、
 * 权限项读写、密码规则状态机、剪贴板与 toast。
 *
 * 从 `shareMixin.js` 原样搬出，方法体一行未改；以对象展开并入 `methods`。
 */

import { SHARE_ENTRY_MODES, LINK_PERM_OPTIONS, SHARE_TOAST, SHARE_TOAST_TEXTS, buildShareLinkText, buildShareClipboardText, readCapability, capabilityUiState, isPasswordValid, SHARE_KEEP_OPEN_SELECTORS, unresolvedInvitation } from './shareModel'

export const shareDialogMethods = {
    // —— 权限读取（唯一入口，禁止在模板里直接读 session 字段）——
    shareCan(key) {
      return readCapability(this.session, key)
    },
    /** 取一项 capability 的 UI 落值（B24 逐条）。 */
    shareCapabilityState(key) {
      return capabilityUiState(this.session, key)
    },
    /** 置灰样式：有权限返回 null，无权限返回统一置灰视觉（保留 pointer-events）。 */
    shareGrayStyle(key) {
      return capabilityUiState(this.session, key).style
    },

    // —— 一级 popover ——
    /**
     * 入口点击。降级形态（`canManagePermission:false`）**不开任何面板**，直接复制链接
     * （B24 末行：「只复制链接，不弹权限面板」）。
     */
    toggleSharePopover(event) {
      if (!this.shareCan('canView')) return
      if (this.shareEntryMode === SHARE_ENTRY_MODES.readonlyLink) {
        this.copyShareLink()
        return
      }
      if (this.sharePopoverOpen) {
        this.closeSharePopover()
        return
      }
      const rect = event && event.currentTarget && event.currentTarget.getBoundingClientRect
        ? event.currentTarget.getBoundingClientRect()
        : null
      // 实测 popover @(596,52)、按钮本体 @(996,16) 80×32 ⇒ 顶边 = 按钮底边 + 4，
      // 右缘与按钮右缘**对齐**（1076 = 996+80），故 `right` 直接用视口宽减按钮右缘。
      const viewportWidth = typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 0
      this.sharePopoverAnchor = rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width } : null
      this.sharePopoverPos = {
        top: rect ? rect.bottom + 4 : 52,
        right: rect ? Math.max(0, viewportWidth - rect.right) : 436,
      }
      this.sharePopoverOpen = true
      void this.loadShareLink()
    },
    sharePopoverStyle() {
      if (typeof window !== 'undefined' && window.innerWidth <= 760) {
        const anchor = this.sharePopoverAnchor
        const top = Math.round(Math.min(anchor ? anchor.bottom + 6 : 54, Math.max(8, window.innerHeight - Math.min(329, window.innerHeight - 68) - 8)))
        return { left: '24px', right: '0px', top: `${top}px`, bottom: '' }
      }
      return { left: '', bottom: '', top: `${this.sharePopoverPos.top}px`, right: `${this.sharePopoverPos.right}px` }
    },
    onShareViewportResize() {
      if (this.sharePopoverOpen) this.refreshOverlays?.()
    },
    closeSharePopover() {
      this.sharePopoverOpen = false
      this.resetShareLink()
      this.closePermissionDialog()
      const keepInvitation = unresolvedInvitation(this.shareInvitation)
      // Reads may be discarded on dismissal; an unresolved write must retain its query guard.
      this.clearShareReads?.({ keepInvitation })
    },
    /** 点外部关闭。权限 Dialog 打开时**不收 popover**（04 §4.1.1 ①：两层叠加）。 */
    onSharePointerDown(event) {
      if (!this.sharePopoverOpen) return
      const target = event.target
      if (!target || typeof target.closest !== 'function') return
      for (let i = 0; i < SHARE_KEEP_OPEN_SELECTORS.length; i += 1) {
        if (target.closest(SHARE_KEEP_OPEN_SELECTORS[i])) return
      }
      this.closeSharePopover()
    },
    /** Esc 逐层收（互斥链，一次只收一层）：改密 → 提示 → 权限 → popover。 */
    onShareWindowKeydown(event) {
      if (!event || event.key !== 'Escape') return
      if (this.passwordDialogOpen) this.closePasswordDialog()
      else if (this.secureLinkConfirmOpen) this.cancelSecureLinkConfirm()
      else if (this.permissionDialogOpen) this.closePermissionDialog()
      else if (this.sharePopoverOpen) this.closeSharePopover()
    },

    // —— 二级权限 Dialog ——
    openPermissionDialog() {
      // 降级形态连二级面板都没有，这里再挡一次（入口已经不弹 popover，防的是外部直调）。
      if (!this.shareCan('canView') || !this.shareCan('canManagePermission')) return
      this.permissionDialogOpen = true
      if (!this.shareLinkState && !this.shareLinkBusy) void this.loadShareLink()
    },
    closePermissionDialog() {
      this.permissionDialogOpen = false
      this.secureLinkConfirmOpen = false
      this.passwordDialogOpen = false
      this.passwordDraft = ''
      if (!this.sharePopoverOpen) this.resetShareLink()
    },
    setPermissionValue(id, value) {
      if (id === 'shareOutsideOrg') return this.setShareLinkAudience(value ? 'public' : 'collaborators')
      this.showShareToast('warning', '此项组织权限服务尚未接入，当前不可用。')
    },
    /** 邀请输入框。受控写法：模板 `:value` + `@input`，不引 v-model（本仓统一口径）。 */
    setShareInviteQuery(value) {
      if (unresolvedInvitation(this.shareInvitation)) return
      this.shareInviteQuery = String(value == null ? '' : value)
      clearTimeout(this._shareDirectoryTimer)
      if (this._shareReadTokens) delete this._shareReadTokens.directory
      this.shareDirectory = { status: 'idle', items: [], error: '' }
      if (this.shareInviteQuery.trim()) this._shareDirectoryTimer = setTimeout(() => this.searchShareDirectory(), 250)
    },
    /** 一级 popover 的链接权限下拉。 */
    setShareLinkPerm(value) {
      if (!LINK_PERM_OPTIONS.includes(value) || !this.shareLinkWritable) return null
      return this.shareLinkAction('permission', value)
    },
    toggleAdvancedSettings() {
      this.permissionAdvancedOpen = !this.permissionAdvancedOpen
    },

    // —— 加密链接状态机（⑤-1 / ⑤-10）——
    /**
     * 点复选框。**开启**要走「提示」二次确认（⑤-1 步 1→2），**关闭**是直接回落
     * （04 只记了开启弹确认，关闭只写「`link_share_entity` 回落到普通枚举」）。
     */
    toggleSecureLink() {
      if (!this.shareLinkWritable) return null
      return this.shareLinkAction('toggle')
    },
    confirmSecureLink() {
      if (!this.secureLinkConfirmOpen || !this.shareLinkWritable || !this.shareLinkState?.cryptoReady) return null
      return this.shareLinkAction('confirm')
    },
    /** 「取消」= 丢弃：复选框回到未勾选，密码区不长出来。 */
    cancelSecureLinkConfirm() {
      this.secureLinkConfirmOpen = false
    },
    applySecureLink(on) {
      if (!this.shareLinkWritable || on && !this.shareLinkState?.cryptoReady) return null
      return on ? this.confirmSecureLink() : this.shareLinkAction('save', { enabled: false })
    },

    // —— 修改密码弹窗（⑤-5 / ⑤-9）——
    openPasswordDialog() {
      if (!this.shareLinkWritable || !this.shareLinkState?.enabled || !this.shareLinkState?.cryptoReady) return
      this.passwordDraft = ''
      this.passwordDialogOpen = true
    },
    /** 取消即丢弃：密码值不变（⑤-10 `k_afterCancel`）。 */
    closePasswordDialog() {
      this.passwordDialogOpen = false
      this.passwordDraft = ''
    },
    setPasswordDraft(value) {
      if (!this.passwordDialogOpen || !this.shareLinkWritable) return
      this.passwordDraft = String(value == null ? '' : value)
    },
    randomizePasswordDraft() {
      if (!this.passwordDialogOpen || !this.shareLinkWritable) return null
      return this.shareLinkAction('random')
    },
    /**
     * 保存。按钮恒可点，非法输入**在提交时静默拦截**：弹窗不关、密码值不变、
     * 不做 shake，只出橙色 warning toast（⑤-9）。
     */
    saveSharePassword() {
      if (!this.passwordDialogOpen || !this.shareLinkWritable || !this.shareLinkState?.enabled || !this.shareLinkState.cryptoReady) return false
      if (!isPasswordValid(this.passwordDraft)) {
        this.showShareToast('warning', SHARE_TOAST_TEXTS.invalidPassword)
        return false
      }
      return this.shareLinkAction('password', this.passwordDraft)
    },

    // —— 复制 ——
    /** 复制链接 + 密码（⑤-4 两个入口行为完全等价：复制按钮 / 点密码值本体）。 */
    copyLinkAndPassword() {
      return this.shareLinkAction('copy-password', buildShareClipboardText)
    },
    /** 降级路径：只复制链接，不带密码、不弹面板。 */
    copyShareLink() {
      if (!this.sharePopoverOpen && !this.permissionDialogOpen) return this.copyReadonlyDocumentLink()
      if (this.shareCan('canManagePermission')) return this.shareLinkAction('copy', (url, password) => password ? buildShareClipboardText(url, password) : buildShareLinkText(url))
      return this.copyReadonlyDocumentLink()
    },
    async copyReadonlyDocumentLink() {
      const scope = this.remoteShareScope(), provider = scope.provider
      const current = () => scope.owner() && this.shareCan('canView') && provider?.isRemote === true
      if (!current() || typeof this.session?.getShareLink !== 'function') { this.showShareToast('warning', '文档链接服务尚未接入，当前不可用。'); return false }
      try {
        const url = await scope.session.getShareLink()
        if (!current()) return false
        const clipboard = this.shareClipboardWriter()
        if (!clipboard?.writeText) throw new Error('clipboard unavailable')
        await clipboard.writeText(buildShareLinkText(url))
        if (current()) this.showShareToast('success', SHARE_TOAST_TEXTS.copiedLink)
        return true
      } catch { if (current()) this.showShareToast('warning', '链接未能复制，请重试。'); return false }
    },
    /** 文档链接：宿主赋值优先，缺省取当前地址。 */
    shareDocumentLink() {
      if (this.shareLink) return this.shareLink
      return typeof window !== 'undefined' && window.location ? window.location.href : ''
    },
    copyShareText(text) {
      const clipboard = this.shareClipboardWriter()
      if (clipboard && typeof clipboard.writeText === 'function') {
        return clipboard.writeText(text).then(() => true).catch(() => this.copyShareTextFallback(text))
      }
      return Promise.resolve(this.copyShareTextFallback(text))
    },
    /** 拆成方法是为了让 http 页面（非安全上下文）与单测都能替换剪贴板实现。 */
    shareClipboardWriter() {
      return typeof navigator !== 'undefined' && navigator.clipboard ? navigator.clipboard : null
    },
    /** 兜底路径：textarea + execCommand（与 `revisionMixin.copyRevisionAnchorFallback` 同写法）。 */
    copyShareTextFallback(text) {
      let area
      try {
        area = document.createElement('textarea')
        area.value = text
        area.setAttribute('readonly', 'readonly')
        area.style.position = 'fixed'
        area.style.top = '-1000px'
        document.body.appendChild(area)
        area.select()
        return document.execCommand('copy') === true
      } catch (error) {
        return false
      } finally { area?.remove() }
    },

    // —— toast ——
    showShareToast(kind, text) {
      this.hideShareToast()
      this.shareToast = { kind, text }
      this._shareToastTimer = setTimeout(() => this.hideShareToast(), SHARE_TOAST.duration)
    },
    hideShareToast() {
      if (this._shareToastTimer) {
        clearTimeout(this._shareToastTimer)
        this._shareToastTimer = null
      }
      this.shareToast = null
    },

    // —— 只读遮罩 ——
    /**
     * 「申请权限」按钮。04 §4.1.1 ⑥ 明写申请流程**诚实未采**（需双账号），
     * 所以这里只把点击抛给宿主，不自造审批流。
     */
    requestShareAccess() {
      try { if (this.openDocumentAccessRequests?.() === true) return true }
      catch { this.showShareToast?.('warning', '权限申请入口暂不可用。'); return false }
      if (typeof this.onRequestAccess === 'function') return this.onRequestAccess()
      return false
    },
}
