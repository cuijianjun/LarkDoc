import { createMentionPanel } from '../../../ui/mention'

export default {
  watch: {
    mentionOpen() { this.refreshMentionPanel() },
    mentionKind() { this.refreshMentionPanel() },
    mentionItems: { deep: true, handler() { this.refreshMentionPanel() } },
    mentionActiveIndex() { this.refreshMentionPanel() },
    mentionNotify() { this.refreshMentionPanel() },
    mentionLoading() { this.refreshMentionPanel() },
    mentionStyle: { deep: true, handler() { this.refreshMentionPanel() } },
  },
  methods: {
    mountMentionPanel() {
      const host = this.$refs.mentionHost
      if (!host) return
      this._mentionUi = createMentionPanel({ host, handlers: {
        onKind: (kind) => this.setMentionKind(kind),
        onActive: (index) => this.setMentionActive(index),
        onNotify: (value) => this.setMentionNotify(value),
        onChoose: (item) => this.chooseMention(item),
      } })
      this.refreshMentionPanel()
    },
    buildMentionPanelState() {
      return { open: !!this.mentionOpen && !this.effectiveReadonly, tabs: this.mentionTabs, kind: this.mentionKind, items: this.mentionItems, activeIndex: this.mentionActiveIndex, notify: this.mentionNotify, loading: this.mentionLoading, emptyText: this.mentionEmptyText, style: this.mentionStyle }
    },
    refreshMentionPanel() { if (this._mentionUi) this._mentionUi.update(this.buildMentionPanelState()) },
    destroyMentionPanel() { if (this._mentionUi) { this._mentionUi.destroy(); this._mentionUi = null } },
  },
}
