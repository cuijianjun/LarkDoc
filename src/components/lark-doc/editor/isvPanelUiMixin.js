import { createIsvPanel } from '../../../ui/isvPanel'
export default {
  watch: { isvPanelOpen() { this.refreshIsvPanel() }, isvAction() { this.refreshIsvPanel() }, isvButtonText() { this.refreshIsvPanel() }, isvButtonColor() { this.refreshIsvPanel() }, isvLinkUrl() { this.refreshIsvPanel() }, isvErrorField() { this.refreshIsvPanel() }, isvActionSelectOpen() { this.refreshIsvPanel() }, isvPanelStyle: { deep: true, handler() { this.refreshIsvPanel() } } },
  methods: {
    mountIsvPanel() { const host = this.$refs.isvPanelHost; if (!host) return; this._isvUi = createIsvPanel({ host, handlers: { onText: (e) => this.onIsvButtonTextInput(e), onLink: (e) => this.onIsvLinkInput(e), onColor: (v) => this.chooseIsvButtonColor(v), onToggleAction: () => this.toggleIsvActionSelect(), onAction: (v) => this.chooseIsvAction(v), onClose: () => this.closeIsvPanel(), onConfirm: () => this.confirmIsvButton() } }); this.refreshIsvPanel() },
    buildIsvPanelState() { return { open: !!this.isvPanelOpen && !this.effectiveReadonly, style: this.isvPanelStyle, height: this.isvPanelBoxHeight, text: this.isvButtonText, color: this.isvButtonColor, colors: this.isvButtonColors, action: this.isvAction, actionLabel: this.isvActionLabel, actions: this.isvActions, selectOpen: this.isvActionSelectOpen, needsLink: this.isvNeedsLink, link: this.isvLinkUrl, errorField: this.isvErrorField, validationMessage: this.isvValidationMessage } },
    refreshIsvPanel() { if (this._isvUi) this._isvUi.update(this.buildIsvPanelState()) },
    destroyIsvPanel() { if (this._isvUi) { this._isvUi.destroy(); this._isvUi = null } },
  },
}
