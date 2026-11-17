import { createMentionPanel } from '../../../ui/mention'

export default {
  watch: {
    mentionOpen() { this.refreshMentionPanel() },
    mentionKind() { this.refreshMentionPanel() },
    mentionItems: { deep: true, handler() { this.refreshMentionPanel() } },
    mentionActiveIndex() { this.refreshMentionPanel() },
    mentionNotify() { this.refreshMentionPanel() },
    mentionLoading() { this.refreshMentionPanel() },
    mentionPendingOperation() { this.refreshMentionPanel() },
    mentionMessage() { this.refreshMentionPanel() },
    mentionStyle: { deep: true, handler() { this.refreshMentionPanel() } },
    larkDocConfig: { deep: true, handler() { this.refreshMentionPanel() } },
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
        onCancel: () => this.closeMentionPanel(),
        onQuery: () => this.queryPendingMention(),
        onRetry: () => this.refreshMentionItems(),
      } })
      const win = host.ownerDocument.defaultView
      const media = win.matchMedia?.('(max-width: 760px) and (pointer: coarse)')
      this._mentionMedia = media
      const refresh = () => {
        if (this.mentionOpen && this.mentionIsMobile() && this.mentionKind === 'all') this.setMentionKind('user')
        this.refreshMentionPanel()
      }
      const viewport = win.visualViewport
      this._mentionViewportStart = () => {
        if (this._mentionViewportCleanup) return
        media?.addEventListener?.('change', refresh)
        win.addEventListener('resize', refresh)
        viewport?.addEventListener('resize', refresh)
        viewport?.addEventListener('scroll', refresh)
        this._mentionViewportCleanup = () => {
          media?.removeEventListener?.('change', refresh)
          win.removeEventListener('resize', refresh)
          viewport?.removeEventListener('resize', refresh)
          viewport?.removeEventListener('scroll', refresh)
        }
      }
      this.refreshMentionPanel()
    },
    buildMentionPanelState() {
      const mobile = this.mentionIsMobile()
      const kind = mobile && this.mentionKind === 'all' ? 'user' : this.mentionKind
      const win = this.$refs.mentionHost?.ownerDocument.defaultView || this.$refs.root?.ownerDocument.defaultView
        || (typeof window !== 'undefined' ? window : null)
      const viewport = win?.visualViewport
      const layoutHeight = win?.innerHeight || 0
      const bottom = viewport ? Math.max(0, layoutHeight - viewport.height - viewport.offsetTop) : 0
      const visibleHeight = viewport ? Math.max(0, Math.min(viewport.height, layoutHeight - viewport.offsetTop)) : layoutHeight
      const height = Math.min(layoutHeight * 0.65, 560, visibleHeight)
      return { open: !!this.mentionOpen && !this.effectiveReadonly, mobile, query: this.mentionQuery,
        tabs: mobile ? this.mentionTabs.filter(tab => tab.id !== 'all').map(tab => tab.id === 'user' ? { ...tab, label: '人员' } : tab) : this.mentionTabs,
        kind, items: mobile ? this.mentionItems.filter(item => (item.kind || 'user') === kind) : this.mentionItems,
        activeIndex: this.mentionActiveIndex, notify: this.mentionNotify, loading: this.mentionLoading,
        pendingOperation: this.mentionPendingOperation,
        retry: this.mentionRemote && this.mentionKind !== 'chat',
        emptyText: this.mentionMessage || this.mentionEmptyText,
        style: mobile ? { left: '0px', right: '0px', top: 'auto', bottom: `${bottom}px`, height: `${height}px`, maxHeight: `${height}px` } : this.mentionStyle,
        network: this.larkDocConfig?.network }
    },
    refreshMentionPanel() {
      if (!this._mentionUi) return
      if (this.mentionOpen && !this.effectiveReadonly) this._mentionViewportStart?.()
      else { this._mentionViewportCleanup?.(); this._mentionViewportCleanup = null }
      this._mentionUi.update(this.buildMentionPanelState())
    },
    destroyMentionPanel() {
      this._mentionViewportCleanup?.(); this._mentionViewportCleanup = null; this._mentionViewportStart = null; this._mentionMedia = null
      if (this._mentionUi) { this._mentionUi.destroy(); this._mentionUi = null }
    },
  },
}
