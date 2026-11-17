/**
 * overlaysUiMixin — 分享 / 导出浮层原生化接线层（阶段 5 批次 5）。
 *
 * shareMixin / exportMixin 继续持有全部状态和业务动作；这里仅把响应式状态
 * 平铺成原生渲染器需要的 state，并负责监听与销毁。
 */
import { createDocumentOverlays } from '../../../ui/overlays'
import { createShareEntry } from '../../../ui/shareEntry'
import { createNotifications } from '../../../ui/notifications'
import { watermarkAttributes } from '../../../core/policy/output'

export default {
  watch: {
    imageShare: { deep: true, handler() { this.refreshOverlays() } },
    larkDocConfig: { deep: true, handler() { this.refreshOverlays() } },
    sharePopoverOpen() { this.refreshOverlays() },
    sharePopoverPos: { deep: true, handler() { this.refreshOverlays() } },
    permissionDialogOpen() { this.refreshOverlays() },
    permissionAdvancedOpen() { this.refreshOverlays() },
    secureLinkEnabled() { this.refreshOverlays() },
    secureLinkPassword() { this.refreshOverlays() },
    secureLinkConfirmOpen() { this.refreshOverlays() },
    passwordDialogOpen() { this.refreshOverlays() },
    passwordDraft() { this.refreshOverlays() },
    permissionValues: { deep: true, handler() { this.refreshOverlays() } },
    shareToast: { deep: true, handler() { this.refreshOverlays() } },
    shareInviteQuery() { this.refreshOverlays() },
    shareMembers: { deep: true, handler() { this.refreshOverlays() } },
    shareDirectory: { deep: true, handler() { this.refreshOverlays() } },
    shareInvitation: { deep: true, handler() { this.refreshOverlays() } },
    shareLinkPerm() { this.refreshOverlays() },
    shareLinkState: { deep: true, handler() { this.refreshOverlays() } },
    shareLinkBusy() { this.refreshOverlays() },
    shareLinkPending() { this.refreshOverlays() },
    shareLinkError() { this.refreshOverlays() },
    shareOrgName() { this.refreshOverlays() },
    shareCollaborators: { deep: true, handler() { this.refreshOverlays() } },
    shareDialogLinkPerm() { this.refreshOverlays() },
    session() { this.refreshOverlays() },
    exportOpen() { this.refreshOverlays() },
    exportFormat() { this.refreshOverlays() },
    exportScope() { this.refreshOverlays() },
    exportToast() { this.refreshOverlays() },
    exportBusy() { this.refreshOverlays() },
    exportRoute() { this.refreshOverlays() },
    exportPendingOperationId() { this.refreshOverlays() },
    exportCanExport() { this.refreshOverlays() },
    exportSubmitDisabled() { this.refreshOverlays() },
    outputWatermarkAttrs: { deep: true, handler() { this.refreshOverlays() } },
    notifyOpen() { this.refreshOverlays() },
    notifyStyle: { deep: true, handler() { this.refreshOverlays() } },
    notifyItems: { deep: true, handler() { this.refreshOverlays() } },
    notifyMuted() { this.refreshOverlays() },
    notifyLoading() { this.refreshOverlays() },
    notifyWriting() { this.refreshOverlays() },
    notifyLoadError() { this.refreshOverlays() },
    notifyHasMore() { this.refreshOverlays() },
    notifyHistoryLoading() { this.refreshOverlays() },
    notifyHistoryError() { this.refreshOverlays() },
    notifyOpeningId() { this.refreshOverlays() },
    notifyActionError() { this.refreshOverlays() },
    notifyPendingId() { this.refreshOverlays() },
    notifyContext() { this.refreshOverlays() },
    shareEntryMode() { this.refreshOverlays() },
    shareViewMaskVisible() { this.refreshOverlays() },
  },
  methods: {
    mountOverlays() {
      if (this._overlaysUi) return
      const host = this.$refs.overlayHost
      if (!host) return
      const handlers = this.overlaysHandlers()
      this._shareEntryUi = createShareEntry({ host, handlers })
      this._overlaysUi = createDocumentOverlays({ host, handlers })
      this._notificationsUi = createNotifications({ host, handlers: {
        onToggleMute: () => this.toggleNotifyMute(),
        onMarkAllRead: () => this.markAllNotifyRead(),
        onOpenItem: id => this.openNotification(id),
        onLoadMore: () => this.loadMoreNotifications(),
        onClose: restoreFocus => this.closeNotify(restoreFocus),
        onQueryPending: () => this.queryPendingNotification(),
      }, onReady: () => {
        if (this.notifyOpen && this.notifyCurrent(this.notificationContext())) this.measureNotify()
      } })
      window.addEventListener('keydown', this.onColdOverlayKeydown, true)
      this.refreshOverlays()
    },
    destroyOverlays() {
      window.removeEventListener('keydown', this.onColdOverlayKeydown, true)
      this._shareEntryUi?.destroy(); this._shareEntryUi = null
      if (this._notificationsUi) this._notificationsUi.destroy()
      this._notificationsUi = null
      if (this._overlaysUi) this._overlaysUi.destroy()
      this._overlaysUi = null
    },
    onColdOverlayKeydown(event) {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || this.editor?.view?.composing
        || this._isDestroyed || this._isBeingDestroyed || !this.$refs.root?.contains(event.target)) return
      if (this.notifyOpen && !this._notificationsUi?.el && this.notifyCurrent(this.notificationContext())) {
        event.preventDefault(); event.stopPropagation(); this.closeNotify(true)
      } else if (this.imageShare && !this._overlaysUi?.el) {
        event.preventDefault(); event.stopPropagation(); this.closeImageShareDialog()
      }
    },
    overlaysHandlers() {
      return {
        onLoadError: () => { this.error = '面板暂时无法打开，请关闭后重试' },
        onImageShareClose: () => this.closeImageShareDialog(),
        onImageShareQuery: query => this.searchImageShareRecipients(query),
        onImageShareRecipient: (id, kind) => this.toggleImageShareRecipient(id, kind),
        onImageShareMessage: message => this.setImageShareMessage(message),
        onImageShareSend: () => this.submitImageShare(),
        onRequestAccess: () => this.requestShareAccess(),
        onToggleSharePopover: (event) => this.toggleSharePopover(event),
        onOpenPermissionDialog: () => this.openPermissionDialog(),
        onSetShareInviteQuery: (value) => this.setShareInviteQuery(value),
        onLoadShareMembers: () => this.loadShareMembers(),
        onSearchShareDirectory: () => this.searchShareDirectory(),
        onSelectShareInviteCandidate: id => this.selectShareInviteCandidate(id),
        onSetShareInviteRole: role => this.setShareInviteRole(role),
        onSubmitShareInvitation: () => this.submitShareInvitation(),
        onQueryShareInvitation: () => this.queryShareInvitation(),
        onCancelShareInvitation: () => this.cancelShareInvitation(),
        onCloseSharePopover: () => this.closeSharePopover(),
        onSetShareLinkPerm: (value) => this.setShareLinkPerm(value),
        onSetShareLinkAudience: value => this.setShareLinkAudience(value),
        onLoadShareLink: () => this.loadShareLink(),
        onQueryShareLink: () => this.queryShareLink(),
        onCopyShareLink: () => this.copyShareLink(),
        onClosePermissionDialog: () => this.closePermissionDialog(),
        onTogglePermissionValue: (id) => this.setPermissionValue(id, id === 'shareOutsideOrg' ? this.shareLinkState?.audience !== 'public' : !this.permissionValues[id]),
        onSetPermissionValue: (id, value) => this.setPermissionValue(id, value),
        onToggleAdvancedSettings: () => this.toggleAdvancedSettings(),
        onToggleSecureLink: () => this.toggleSecureLink(),
        onCopyLinkAndPassword: () => this.copyLinkAndPassword(),
        onOpenPasswordDialog: () => this.openPasswordDialog(),
        onCancelSecureLinkConfirm: () => this.cancelSecureLinkConfirm(),
        onConfirmSecureLink: () => this.confirmSecureLink(),
        onClosePasswordDialog: () => this.closePasswordDialog(),
        onSetPasswordDraft: (value) => this.setPasswordDraft(value),
        onRandomizePasswordDraft: () => this.randomizePasswordDraft(),
        onSaveSharePassword: () => this.saveSharePassword(),
        onCloseExportDialog: () => this.closeExportDialog(),
        onChooseExportFormat: format => this.openExportDialog(format),
        onCancelExport: () => this.cancelExport(),
        onSelectExportScope: (value) => this.selectExportScope(value),
        onSubmitExport: () => this.submitExport(),
        onSelectExportRoute: route => this.selectExportRoute(route),
        onQueryRemoteExport: () => this.queryRemoteExport(),
      }
    },
    buildOverlaysState() {
      const link = this.shareLinkAvailable && this._shareLinkSnapshotOwner?.() === true ? this.shareLinkState : null
      const selectionShare = this.imageShare?.target === 'selection'
      const imageShareAllowed = !selectionShare || this.selectionShareAllowed()
      const imageShareConfigured = typeof (selectionShare ? this.onSelectionShare : this.onImageShare) === 'function'
      return {
        imageShare: this.imageShare,
        imageShareAvailable: imageShareConfigured && imageShareAllowed,
        imageShareUnavailableReason: selectionShare && !imageShareAllowed ? '当前权限不允许分享所选内容'
          : selectionShare && !imageShareConfigured ? '尚未配置选区分享服务，暂时无法发送' : '',
        imageShareNetwork: this.larkDocConfig?.network,
        shareViewMaskVisible: this.shareViewMaskVisible,
        shareEntryVisible: this.shareEntryVisible,
        shareEntryLabel: this.shareEntryLabel,
        shareCanManagePermission: this.shareCan('canManagePermission'),
        sharePopoverOpen: this.sharePopoverOpen && this.shareCan('canView') && this.shareCan('canManagePermission'),
        sharePopoverStyle: this.sharePopoverStyle(),
        shareInviteQuery: this.shareInviteQuery,
        shareMembers: this.shareMembers,
        shareDirectory: this.shareDirectory,
        shareInvitation: this.shareInvitation,
        shareCollaboratorInitial: this.shareCollaboratorInitial,
        shareOrgName: link ? (link.audience === 'public' ? '互联网用户' : '仅协作者') : '链接范围未配置',
        shareLinkState: link,
        shareLinkAvailable: this.shareLinkAvailable,
        shareLinkWritable: this.shareLinkWritable,
        shareLinkBusy: this.shareLinkBusy,
        shareLinkPending: this.shareLinkPending,
        shareLinkError: this.shareLinkError,
        shareLinkPermLabel: this.shareLinkPermLabel,
        shareLinkPermOptions: this.shareLinkPermOptions,
        shareScopeText: this.shareScopeText,
        shareToast: this.shareToast,
        permissionDialogOpen: this.permissionDialogOpen && this.shareCan('canView') && this.shareCan('canManagePermission'),
        permissionAdvancedOpen: this.permissionAdvancedOpen,
        permissionValues: { ...this.permissionValues, shareOutsideOrg: link?.audience === 'public' },
        sharePermissionOptions: this.sharePermissionOptions,
        shareDialogScopeText: this.shareDialogScopeText,
        secureLinkEnabled: !!link?.enabled,
        secureLinkPassword: link?.passwordAvailable ? link.password : '',
        secureLinkConfirmOpen: this.secureLinkConfirmOpen,
        passwordDialogOpen: this.passwordDialogOpen,
        passwordDraft: this.passwordDraft,
        sharePasswordRules: this.sharePasswordRules,
        sharePasswordSaveDisabled: this.sharePasswordSaveDisabled,
        outputWatermarkAttributes: watermarkAttributes(this.session?.getProvider?.('security')?.policy || {}),
        exportOpen: this.exportOpen,
        exportRoute: this.exportRoute,
        exportRemoteAvailable: this.exportRemoteAvailable,
        exportRouteDescription: this.exportRouteDescription,
        exportPendingOperationId: this.exportPendingOperationId,
        exportBusy: this.exportBusy,
        exportFormatPicker: this.exportOpen && !this.exportFormat,
        exportToast: this.exportToast,
        exportPanelTitle: this.exportPanelTitle,
        exportScopeOptions: this.exportScopeOptions,
        exportScopeValue: this.exportScopeValue,
        exportCanExport: this.exportCanExport,
        exportSubmitDisabled: this.exportSubmitDisabled,
      }
    },
    refreshOverlays() {
      if (this._shareEntryUi || this._overlaysUi) {
        const state = this.buildOverlaysState()
        this._shareEntryUi?.update(state)
        this._overlaysUi?.update(state)
      }
      if (this._notificationsUi) this._notificationsUi.update({
        open: this.notifyOpen && this.notifyCurrent(this.notificationContext()),
        style: this.notifyStyle,
        items: this.notifyItems.map(item => ({ ...item, actionable: this.notifyItemAvailable(item) })),
        muted: this.notifyMuted,
        loading: this.notifyLoading,
        writing: this.notifyWriting,
        loadError: this.notifyLoadError,
        empty: this.notifyEmpty,
        muteLabel: this.notifyMuteLabel,
        allReadDisabled: this.notifyAllReadDisabled,
        hasMore: this.notifyHasMore,
        historyLoading: this.notifyHistoryLoading,
        historyError: this.notifyHistoryError,
        openingId: this.notifyOpeningId,
        actionError: this.notifyActionError,
        pendingId: this.notifyPendingId,
      })
    },
  },
}
