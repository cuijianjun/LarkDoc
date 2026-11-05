import { createSearchPanel } from '../../../ui/searchPanel'

export default {
  watch: {
    searchOpen() { this.refreshSearchPanel() },
    searchTab() { this.refreshSearchPanel() },
    searchQuery() { this.refreshSearchPanel() },
    replacement() { this.refreshSearchPanel() },
    searchMatches: { deep: true, handler() { this.refreshSearchPanel() } },
    searchIndex() { this.refreshSearchPanel() },
    searchPanelPos: { deep: true, handler() { this.refreshSearchPanel() } },
    effectiveReadonly() { this.refreshSearchPanel() },
  },
  methods: {
    mountSearchPanel() {
      const host = this.$refs.searchPanelHost
      if (!host) return
      this._searchUi = createSearchPanel({
        host,
        handlers: {
          onTab: (tab) => this.setSearchTab(tab),
          onQuery: (event) => { this.setSearchQuery(event.target.value); this.scheduleSearchUpdate() },
          onReplacement: (event) => this.setReplacement(event.target.value),
          onNext: (step) => this.nextMatch(step),
          onReplace: (all) => this.replace(all),
          onClose: () => this.closeSearch(),
          onPosition: (pos) => this.setSearchPanelPos(pos),
        },
      })
      this.refreshSearchPanel()
    },
    buildSearchPanelState() {
      const total = this.searchMatches.length
      const pos = this.searchPanelPos
      const style = {}
      if (pos) { style.left = `${pos.left}px`; style.top = `${pos.top}px` }
      return {
        open: !!this.searchOpen && this.featureEnabled('search'),
        isReplace: this.searchTab === 'replace',
        height: this.searchTab === 'replace' ? 286 : 186,
        style,
        query: this.searchQuery,
        replacement: this.replacement,
        counterText: `${total ? this.searchIndex + 1 : 0} / ${total}`,
        readonly: this.effectiveReadonly,
        hasMatches: !!total,
      }
    },
    refreshSearchPanel() {
      if (this._searchUi) this._searchUi.update(this.buildSearchPanelState())
    },
    focusSearchPanel() {
      if (this._searchUi) this._searchUi.focus()
    },
    destroySearchPanel() {
      if (this._searchUi) { this._searchUi.destroy(); this._searchUi = null }
    },
  },
}
