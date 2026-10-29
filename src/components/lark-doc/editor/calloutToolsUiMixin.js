/**
 * CalloutTools 原生渲染接线层（阶段 5-G）。业务仍在 calloutColorMixin，
 * 本层只把 Vue 状态推给 src/ui/calloutTools.js。
 */
import { createCalloutTools } from '../../../ui/calloutTools'

export default {
  watch: {
    calloutEmojiOpen() { this.refreshCalloutTools() },
    calloutEmojiQuery() { this.refreshCalloutTools() },
    calloutEmojiCategory() { this.refreshCalloutTools() },
    calloutEmojiRecent() { this.refreshCalloutTools() },
    calloutEmojiPlacement() { this.refreshCalloutTools() },
    calloutToolsPosition: { deep: true, handler() { this.refreshCalloutTools() } },
    effectiveReadonly() { this.refreshCalloutTools() },
    larkDocConfig() { this.refreshCalloutTools() },
    contentTheme() { this.refreshCalloutTools() },
  },
  methods: {
    mountCalloutTools() {
      if (this._calloutToolsUi) return
      const host = this.$refs.calloutToolsHost
      if (!host) return
      this._calloutToolsUi = createCalloutTools({
        host,
        handlers: {
          onPalette: (target, event) => this.toggleColorPalette(target, event),
          onColor: (name, value) => this.setCalloutColor(name, value),
          onToggleEmoji: () => this.toggleCalloutEmoji(),
          onReset: () => this.resetCalloutStyle(),
          onDelete: () => this.deleteActiveCallout(),
          onQuery: (value) => this.setCalloutEmojiQuery(value),
          onCategory: (value) => this.setCalloutEmojiCategory(value),
          onRandom: () => this.setCalloutEmoji(this.pickRandomCalloutEmoji()),
          onEmoji: (value) => this.setCalloutEmoji(value),
        },
      })
      this.refreshCalloutTools()
    },
    buildCalloutToolsState() {
      const visible = !!this.activeCalloutVisible && this.featureEnabled('callouts') && !this.effectiveReadonly
      if (!visible) return { visible: false, emojiOpen: false }
      return {
        visible: true,
        style: this.calloutToolsStyle,
        color: this.calloutColor('color'),
        backgroundColor: this.calloutColor('backgroundColor'),
        borderColor: this.calloutColor('borderColor'),
        emojiOpen: this.calloutEmojiOpen,
        placement: this.calloutEmojiPlacement,
        query: this.calloutEmojiQuery,
        category: this.calloutEmojiCategory,
        categories: this.calloutEmojiCategories,
        items: this.filteredCalloutEmojiItems,
      }
    },
    refreshCalloutTools() {
      if (!this._calloutToolsUi) return
      this._calloutToolsUi.update(this.buildCalloutToolsState())
    },
    destroyCalloutTools() {
      if (!this._calloutToolsUi) return
      this._calloutToolsUi.destroy()
      this._calloutToolsUi = null
    },
  },
}
