import { createExtendedOverlays } from '../../../ui/extendedOverlays'

const stateKeys = [
  'linkHoverOpen', 'linkHoverStyle', 'linkHoverLabel', 'linkHoverSafeHref', 'linkHoverView',
  'linkHoverMenuOpen', 'linkViewModes',
  'confirmOpen', 'confirmTitle', 'confirmBody', 'confirmExtra', 'confirmExtraChecked',
  'confirmPrimaryText', 'confirmCancelText',
  'relationOpen', 'relationStep', 'relationBases', 'relationTables', 'relationBaseToken',
  'relationBaseName', 'relationTableId', 'relationLoading', 'relationError', 'relationHint',
  'relationSelectionText', 'relationConfirmDisabled', 'relationConfirmReason',
  'codeLangOpen', 'codeLangStyle', 'codeLangQuery', 'codeLangItems', 'codeLangValue',
]
const actions = [
  'keepLinkHover', 'closeLinkHover', 'editHoveredLink', 'removeHoveredLink',
  'toggleLinkHoverMenu', 'setLinkHoverView', 'onLinkHoverMore',
  'closeConfirm', 'acceptConfirm', 'toggleConfirmExtra',
  'closeRelationBitable', 'backToRelationBase', 'pickRelationBase', 'pickRelationTable', 'confirmRelationBitable',
  'setCodeLangQuery', 'pickCodeLanguage', 'closeCodeLangPicker',
]

/** 只投影视图；动作与异步 Provider 仍由 dev 对应 mixin 持有。 */
export default {
  watch: Object.fromEntries([...stateKeys, 'effectiveReadonly', 'session', 'editor'].map(key => [key, {
    deep: stateKeys.includes(key),
    handler() { this.refreshExtendedOverlays() },
  }])),
  methods: {
    mountExtendedOverlays() {
      if (this._extendedOverlaysUi || !this.$refs.overlayHost) return
      this._extendedOverlaysUi = createExtendedOverlays({
        host: this.$refs.overlayHost,
        refs: this.$refs,
        handlers: Object.fromEntries(actions.map(name => [name, (...args) => this[name](...args)])),
      })
      this.refreshExtendedOverlays()
    },
    refreshExtendedOverlays() {
      this._extendedOverlaysUi?.update({
        ...Object.fromEntries(stateKeys.map(key => [key, this[key]])),
        writable: this.writable(),
      })
    },
    destroyExtendedOverlays() {
      // 卸载也必须结束仍等待用户选择的 Promise。
      this.closeConfirm()
      this._extendedOverlaysUi?.destroy()
      this._extendedOverlaysUi = null
    },
  },
}
