import { createIsvPanel } from '../../../ui/isvPanel'
export default {
  watch: { effectiveReadonly(value) { if (value) this.closeIsvPanel(); this.refreshIsvPanel() }, isvPanelOpen() { this.refreshIsvPanel() }, isvAction() { this.refreshIsvPanel() }, isvButtonText() { this.refreshIsvPanel() }, isvButtonColor() { this.refreshIsvPanel() }, isvLinkUrl() { this.refreshIsvPanel() }, isvErrorField() { this.refreshIsvPanel() }, isvActionSelectOpen() { this.refreshIsvPanel() }, isvPanelStyle: { deep: true, handler() { this.refreshIsvPanel() } } },
  methods: {
    mountIsvPanel() { if (this._isvUi) return; const host = this.$refs.isvPanelHost; if (!host) return; const ui = createIsvPanel({ host, onReady: () => this.onIsvPanelReady(ui), handlers: { onText: (e) => this.onIsvButtonTextInput(e), onLink: (e) => this.onIsvLinkInput(e), onColor: (v) => this.chooseIsvButtonColor(v), onToggleAction: () => this.toggleIsvActionSelect(), onAction: (v) => this.chooseIsvAction(v), onClose: () => this.closeIsvPanel(), onConfirm: () => this.confirmIsvButton() } }); this._isvUi = ui; this.refreshIsvPanel() },

    buildIsvPanelState() { return { open: !!this.isvPanelOpen && !this.effectiveReadonly, style: this.isvPanelStyle, height: this.isvPanelBoxHeight, text: this.isvButtonText, color: this.isvButtonColor, colors: this.isvButtonColors, action: this.isvAction, actionLabel: this.isvActionLabel, actions: this.isvActions, selectOpen: this.isvActionSelectOpen, needsLink: this.isvNeedsLink, link: this.isvLinkUrl, errorField: this.isvErrorField, validationMessage: this.isvValidationMessage } },
    refreshIsvPanel() {
      const ui = this._isvUi
      if (!ui) return
      const state = this.buildIsvPanelState()
      ui.update(state)
      if (state.open && (this._isvReadyUi !== ui || this._isvReadyRevision !== this.isvPanelRevision)) {
        this._isvReadyUi = ui
        this._isvReadyRevision = this.isvPanelRevision
        this.onIsvPanelReady(ui)
      }
    },
    destroyIsvPanel() {
      const ui = this._isvUi
      this._isvUi = null
      this._isvReadyUi = null
      this._isvReadyRevision = null
      if (ui) ui.destroy()
    },
  },
}
