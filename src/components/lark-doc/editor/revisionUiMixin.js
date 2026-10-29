/** RevisionPanel 原生渲染接线层。 */
import { createRevisionPanels } from '../../../ui/revision'

export default {
  watch: {
    revisionPanels: { deep: true, handler() { this.refreshRevisionPanels() } },
    revisionActiveId() { this.refreshRevisionPanels() },
    revisionHoverId() { this.refreshRevisionPanels() },
    interactionMode() { this.refreshRevisionPanels() },
  },
  methods: {
    mountRevisionPanels() {
      if (this._revisionUi) return
      const host = this.$refs.revisionHost
      if (!host) return
      this._revisionUi = createRevisionPanels({
        host,
        handlers: {
          onEnter: (id) => this.enterRevisionPanel(id),
          onLeave: () => this.leaveRevisionPanel(),
          onButton: (id, revisionId) => this.runRevisionButton(id, revisionId),
        },
      })
      this.refreshRevisionPanels()
    },
    buildRevisionPanelsState() {
      return {
        title: this.revisionPanelTitle,
        readonly: this.revisionReadonly,
        buttons: this.revisionButtons,
        items: this.revisionPanels.map((item) => ({
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
