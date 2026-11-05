/**
 * 右下角帮助菜单接线：配置控制入口和项目，开合及160ms定时器仍由原生积木持有。
 * 快捷键使用内置抽屉，其余动作交给应用的 help.onAction。
 */
import { createHelpFab } from '../../../ui/helpFab'
import { HELP_MENU_ITEMS } from '../../../ui/shortcutGroups'

export default {
  watch: {
    'larkDocConfig.help': { deep: true, handler() { this.refreshHelpFab() } },
  },
  methods: {
    /** 挂载（由主组件 `mounted` 调用，不依赖编辑器实例）。 */
    mountHelpFab() {
      this.refreshHelpFab()
    },
    refreshHelpFab() {
      const config = this.larkDocConfig.help
      if (!config.enabled || !config.items.length) { this.destroyHelpFab(); return }
      const host = this.$refs.helpFabHost
      if (!host) return
      const items = config.items.map(id => HELP_MENU_ITEMS.find(item => item.id === id))
      if (this._helpFabUi) { this._helpFabUi.update({ items }); return }
      this._helpFabUi = createHelpFab({
        host,
        items,
        handlers: { onRun: (item) => this.runHelpItem(item) },
      })
    },
    destroyHelpFab() {
      if (!this._helpFabUi) return
      this._helpFabUi.destroy()
      this._helpFabUi = null
    },
    runHelpItem(item) {
      if (item && item.id === 'shortcuts') this.toggleHelpOpen()
      const onAction = this.larkDocConfig.help.onAction
      if (!item || typeof onAction !== 'function') return
      const reportError = error => this.$emit('error', error)
      try {
        Promise.resolve(onAction({ id: item.id, label: item.label })).catch(reportError)
      } catch (error) { reportError(error) }
    },
  },
}
