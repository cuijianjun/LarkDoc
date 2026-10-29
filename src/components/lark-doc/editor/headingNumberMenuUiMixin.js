/**
 * headingNumberMenuUiMixin — 标题 / 列表编号菜单的原生化接线层（阶段 5）。
 *
 * `headingNumberMixin` 继续持有编号状态、定位和文档命令；本 mixin 只把状态推给
 * `src/ui/headingNumberMenu.js`，并把 DOM 事件原样转回业务方法。
 */
import { createHeadingNumberMenu } from '../../../ui/headingNumberMenu'

export default {
  watch: {
    headingNumberMenu() { this.refreshHeadingNumberMenu() },
    headingNumberMenuStyle: { deep: true, handler() { this.refreshHeadingNumberMenu() } },
    headingNumberEditing() { this.refreshHeadingNumberMenu() },
    headingNumberDraft() { this.refreshHeadingNumberMenu() },
    effectiveReadonly() { this.refreshHeadingNumberMenu() },
  },
  methods: {
    mountHeadingNumberMenu() {
      if (this._headingNumberMenuUi) return
      const host = this.$refs.headingNumberMenuHost
      if (!host) return
      this._headingNumberMenuUi = createHeadingNumberMenu({
        host,
        handlers: {
          onAction: (id) => this.headingNumberAction(id),
          onDraft: (value) => this.setHeadingNumberDraft(value),
          onKeydown: (event) => this.onHeadingNumberInputKeydown(event),
          onApply: () => this.applyHeadingNumberValue(),
          onStep: (step) => this.stepHeadingNumberDraft(step),
        },
      })
      this.refreshHeadingNumberMenu()
    },
    refreshHeadingNumberMenu() {
      const ui = this._headingNumberMenuUi
      if (!ui) return
      const menu = this.headingNumberMenu || {}
      const actions = this.headingNumberActions || []
      const disabled = {}
      actions.forEach((action) => { disabled[action.id] = this.headingNumberMenuDisabled(action.id) })
      ui.update({
        open: !!menu.open && !this.effectiveReadonly,
        editing: !!this.headingNumberEditing,
        style: this.headingNumberMenuStyle,
        draft: this.headingNumberDraft,
        actions,
        disabled,
      })
    },
    destroyHeadingNumberMenu() {
      if (!this._headingNumberMenuUi) return
      this._headingNumberMenuUi.destroy()
      this._headingNumberMenuUi = null
    },
  },
}
