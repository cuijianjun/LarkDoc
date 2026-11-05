/**
 * overlaysUiMixin — 分享 / 导出浮层原生化接线层（阶段 5 批次 5）。
 *
 * shareMixin / exportMixin 继续持有全部状态和业务动作；这里仅把响应式状态
 * 平铺成原生渲染器需要的 state，并负责监听与销毁。
 */
import { createOverlays } from '../../../ui/overlays'
import { createNotifications } from '../../../ui/notifications'
import { watermarkAttributes } from '../../../core/policy/output'

export default {
  watch: {
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
    shareLinkPerm() { this.refreshOverlays() },
    shareOrgName() { this.refreshOverlays() },
    shareCollaborators: { deep: true, handler() { this.refreshOverlays() } },
    shareDialogLinkPerm() { this.refreshOverlays() },
    session() { this.refreshOverlays() },
    exportOpen() { this.refreshOverlays() },
    exportFormat() { this.refreshOverlays() },
    exportScope() { this.refreshOverlays() },
    exportToast() { this.refreshOverlays() },
    exportBusy() { this.refreshOverlays() },
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
    notifyContext() { this.refreshOverlays() },
    shareEntryMode() { this.refreshOverlays() },
    shareViewMaskVisible() { this.refreshOverlays() },
  },
  methods: {
    mountOverlays() {
      if (this._overlaysUi) return
      const host = this.$refs.overlayHost
      if (!host) return
      this._overlaysUi = createOverlays({ host, handlers: this.overlaysHandlers() })
      this._notificationsUi = createNotifications({ host, handlers: {
        onToggleMute: () => this.toggleNotifyMute(),
        onMarkAllRead: () => this.markAllNotifyRead(),
      } })
      this.refreshOverlays()
    },
    destroyOverlays() {
      if (this._notificationsUi) this._notificationsUi.destroy()
      this._notificationsUi = null
      if (this._overlaysUi) this._overlaysUi.destroy()
      this._overlaysUi = null
    },
    overlaysHandlers() {
      return {
        onRequestAccess: () => this.requestShareAccess(),
        onToggleSharePopover: (event) => this.toggleSharePopover(event),
        onOpenPermissionDialog: () => this.openPermissionDialog(),
        onSetShareInviteQuery: (value) => this.setShareInviteQuery(value),
        onSetShareLinkPerm: (value) => this.setShareLinkPerm(value),
        onCopyShareLink: () => this.copyShareLink(),
        onClosePermissionDialog: () => this.closePermissionDialog(),
        onTogglePermissionValue: (id) => this.setPermissionValue(id, !this.permissionValues[id]),
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
        onCancelExport: () => this.cancelExport(),
        onSelectExportScope: (value) => this.selectExportScope(value),
        onSubmitExport: () => this.submitExport(),
      }
    },
    buildOverlaysState() {
      return {
        shareViewMaskVisible: this.shareViewMaskVisible,
        shareEntryVisible: this.shareEntryVisible,
        shareEntryLabel: this.shareEntryLabel,
        shareCanManagePermission: this.shareCan('canManagePermission'),
        sharePopoverOpen: this.sharePopoverOpen && this.shareCan('canView') && this.shareCan('canManagePermission'),
        sharePopoverStyle: this.sharePopoverStyle(),
        shareInviteQuery: this.shareInviteQuery,
        shareCollaboratorInitial: this.shareCollaboratorInitial,
        shareOrgName: this.shareOrgName,
        shareLinkPermLabel: this.shareLinkPermLabel,
        shareLinkPermOptions: this.shareLinkPermOptions,
        shareScopeText: this.shareScopeText,
        shareToast: this.shareToast,
        permissionDialogOpen: this.permissionDialogOpen && this.shareCan('canView') && this.shareCan('canManagePermission'),
        permissionAdvancedOpen: this.permissionAdvancedOpen,
        permissionValues: this.permissionValues,
        sharePermissionOptions: this.sharePermissionOptions,
        shareDialogScopeText: this.shareDialogScopeText,
        secureLinkEnabled: this.secureLinkEnabled,
        secureLinkPassword: this.secureLinkPassword,
        secureLinkConfirmOpen: this.secureLinkConfirmOpen,
        passwordDialogOpen: this.passwordDialogOpen,
        passwordDraft: this.passwordDraft,
        sharePasswordRules: this.sharePasswordRules,
        sharePasswordSaveDisabled: this.sharePasswordSaveDisabled,
        outputWatermarkAttributes: watermarkAttributes(this.session?.getProvider?.('security')?.policy || {}),
        exportOpen: this.exportOpen,
        exportToast: this.exportToast,
        exportPanelTitle: this.exportPanelTitle,
        exportScopeOptions: this.exportScopeOptions,
        exportScopeValue: this.exportScopeValue,
        exportCanExport: this.exportCanExport,
        exportSubmitDisabled: this.exportSubmitDisabled,
      }
    },
    refreshOverlays() {
      if (this._overlaysUi) this._overlaysUi.update(this.buildOverlaysState())
      if (this._notificationsUi) this._notificationsUi.update({
        open: this.notifyOpen && this.notifyCurrent(this.notificationContext()),
        style: this.notifyStyle,
        items: this.notifyItems,
        muted: this.notifyMuted,
        loading: this.notifyLoading,
        writing: this.notifyWriting,
        loadError: this.notifyLoadError,
        empty: this.notifyEmpty,
        muteLabel: this.notifyMuteLabel,
        allReadDisabled: this.notifyAllReadDisabled,
      })
    },
  },
}
