/** RevisionPanel 原生渲染接线层。 */
import { createLazyView } from '../../../ui/lazy'

export default {
  watch: {
    revisionPanels: { deep: true, handler() { this.refreshRevisionPanels() } },
    revisionActiveId() { this.refreshRevisionPanels() },
    revisionHoverId() { this.refreshRevisionPanels() },
    interactionMode() { this.refreshRevisionPanels() },
    exportOpen() { this.refreshRevisionPanels() },
  },
  methods: {
    mountRevisionPanels() {
      if (this._revisionUi) return
      const host = this.$refs.revisionHost
      if (!host) return
      this._revisionUi = createLazyView(() => import('../../../ui/revision'), 'createRevisionPanels', {
        host,
        handlers: {
          onEnter: (id) => this.enterRevisionPanel(id),
          onLeave: () => this.leaveRevisionPanel(),
          onButton: (id, revisionId) => { if (!this.exportOpen) this.runRevisionButton(id, revisionId) },
        },
      }, { onError: () => { this.error = '界面暂时无法打开，请关闭后重试' }, isOpen: state => !!state.items?.length })
      this.refreshRevisionPanels()
    },
    buildRevisionPanelsState() {
      return {
        title: this.revisionPanelTitle,
        readonly: this.revisionReadonly,
        buttons: this.revisionButtons,
        // Export owns the modal surface. Preserve the selected revision and
        // document history while its contextual controls are temporarily absent.
        items: (this.exportOpen ? [] : this.revisionPanels).map((item) => ({
          id: item.revisionId,
          author: this.revisionAuthorName(item.author),
          summary: this.revisionSummaryOf(item),
          style: this.revisionPanelStyle(item),
          height: this.revisionPanelBoxHeight(item),
          active: this.revisionPanelActive(item),
          disabled: this.revisionButtons.filter((button) => !button.split && this.revisionButtonDisabled(button.id, item.revisionId)).map((button) => button.id),
        })),
      }
    },
    refreshRevisionPanels() {
      if (!this._revisionUi) return
      this._revisionUi.update(this.buildRevisionPanelsState())
    },
    destroyRevisionPanels() {
      if (!this._revisionUi) return
      this._revisionUi.destroy(); this._revisionUi = null
    },
  },
}
