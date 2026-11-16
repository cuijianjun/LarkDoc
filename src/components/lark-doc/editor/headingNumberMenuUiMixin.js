/**
 * headingNumberMenuUiMixin — 标题 / 列表编号菜单的原生化接线层（阶段 5）。
 *
 * `headingNumberMixin` 持有状态与入口，交互运行时随菜单加载；本 mixin 把状态推给
 * `src/ui/headingNumberMenu.js`，并把 DOM 事件原样转回业务方法。
 */
import { createLazyView } from '../../../ui/lazy'

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
      this._headingNumberMenuUi = createLazyView(() => import('../../../ui/headingNumberMenu').then(module => {
        if (!this._isBeingDestroyed && !this._isDestroyed) this._headingNumberRuntime = module.createHeadingNumberRuntime(this)
        return module
      }), 'createHeadingNumberMenu', {
        host,
        handlers: {
          onAction: (id) => this.headingNumberAction(id),
          onDraft: (value) => this.setHeadingNumberDraft(value),
          onKeydown: (event) => this.onHeadingNumberInputKeydown(event),
          onApply: () => this.applyHeadingNumberValue(),
          onStep: (step) => this.stepHeadingNumberDraft(step),
          onReposition: () => this.positionHeadingNumberMenu(),
          onClose: () => this.closeHeadingNumberMenu(),
        },
      }, { onError: () => { this.error = '界面暂时无法打开，请关闭后重试' }, onReady: () => { this.refreshHeadingNumberMenu(); this.positionHeadingNumberMenu() } })
      this.refreshHeadingNumberMenu()
    },
    refreshHeadingNumberMenu() {
      const ui = this._headingNumberMenuUi
      if (!ui) return
      ui.update(this._headingNumberRuntime?.viewState() || { open: !!this.headingNumberMenu?.open && !this.effectiveReadonly })
    },
    destroyHeadingNumberMenu() {
      if (!this._headingNumberMenuUi) return
      this._headingNumberMenuUi.destroy()
      this._headingNumberMenuUi = null
      this._headingNumberRuntime = null
    },
  },
}
