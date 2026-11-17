/**
 * CalloutTools 原生渲染接线层（阶段 5-G）。业务仍在 calloutColorMixin，
 * 本层只把 Vue 状态推给 src/ui/calloutTools.js。
 */
import { createCalloutTools } from '../../../ui/calloutTools'
import { loadFeature, readFeature } from '../../../core/features/registry'

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
      let ui
      const onReady = () => {
        if (!ui || this._calloutToolsUi !== ui || this._isDestroyed || this._isBeingDestroyed) return
        this.calloutPresentationRevision = (this.calloutPresentationRevision || 0) + 1
        this.refreshCalloutTools()
        this.prefetchCalloutEmoji(ui)
      }
      ui = this._calloutToolsUi = createCalloutTools({
        host,
        onReady,
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
        categories: this.calloutEmojiOpen ? this.calloutEmojiCategories : [],
        items: this.calloutEmojiOpen ? this.filteredCalloutEmojiItems : [],
      }
    },
    refreshCalloutTools() {
      if (!this._calloutToolsUi) return
      this._calloutToolsUi.update(this.buildCalloutToolsState())
    },
    /**
     * 高亮块表情表只随侧栏面板包（`ui.panels`）下发——它和评论/版本面板共用同一份
     * emoji 数据，放 A 包会让这 77 KB 在两个包里各打一遍。
     *
     * 代价是「点开表情选择器时数据可能还没到」，所以不等用户点：工具条一出现
     * （选中高亮块就会触发）就开始拉包，等手指挪到表情按钮上时早已就位。
     * 非 Element 宿主从 features/ui.js 拿全集，这里第一步就是 no-op。
     */
    prefetchCalloutEmoji(ui) {
      if (readFeature('ui.ready')?.createCalloutPresentation) return
      const alive = () => ui && this._calloutToolsUi === ui && !this._isDestroyed && !this._isBeingDestroyed
      loadFeature('ui.panels').then(() => {
        if (!alive()) return
        this.calloutPresentationRevision = (this.calloutPresentationRevision || 0) + 1
        this.refreshCalloutTools()
      }, () => { /* 包缺失时表情列表留空，工具条其余部分照常可用 */ })
    },
    destroyCalloutTools() {
      if (!this._calloutToolsUi) return
      this._calloutToolsUi.destroy()
      this._calloutToolsUi = null
    },
  },
}
