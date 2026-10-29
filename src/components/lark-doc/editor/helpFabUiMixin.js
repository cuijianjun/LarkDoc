/**
 * helpFabUiMixin — 右下角 `?` 帮助圆钮的原生化接线层（阶段 5 批次 5G）。
 *
 * 这个 mixin **故意只有挂载 / 卸载两个方法**，没有 `watch`、没有 `buildXxxState()`、
 * 没有 `refreshXxx()` —— 它跟 `stageUiMixin` / `tableToolsUiMixin` 不是漏写了半套：
 *
 * - **没有外部状态推下来**。`HelpFab.vue` 的 `menuOpen` 与 160ms 定时器是这个组件
 *   私有的开关，主壳从来没有过 `helpFabOpen` 这类字段，也没有任何业务逻辑要读它。
 *   把开关抬进 Vue 的 `data` 只会让每次 `mouseenter` 都走一遍响应式派发，还把
 *   「指针在不在上面」这种纯 UI 事实漏进业务状态。所以开关留在 `ui/helpFab.js` 里。
 * - **菜单项是静态数据**（`ui/shortcutGroups.js` 的 `HELP_MENU_ITEMS`，5 项固定），
 *   由 `ui/helpFab.js` 直接引用，不需要刷新。
 *
 * 唯一留在业务侧的判断是**落点**：5 项里只有「快捷键」在本项目有对应界面
 * （`helpOpen` → 快捷键抽屉），其余 4 项是飞书的外部服务入口，点了只收起菜单。
 * 这条策略属于编辑器，不属于 UI 积木，所以放在这里的 `runHelpItem()`。
 */
import { createHelpFab } from '../../../ui/helpFab'

export default {
  methods: {
    /** 挂载（由主组件 `mounted` 调用，不依赖编辑器实例）。 */
    mountHelpFab() {
      if (this._helpFabUi) return
      const host = this.$refs.helpFabHost
      if (!host) return
      this._helpFabUi = createHelpFab({
        host,
        handlers: { onRun: (item) => this.runHelpItem(item) },
      })
    },
    destroyHelpFab() {
      if (!this._helpFabUi) return
      this._helpFabUi.destroy()
      this._helpFabUi = null
    },
    /**
     * 帮助菜单的落点（原 `HelpFab.vue` 的 `run()` 后半段）。
     *
     * 只有 `shortcuts` 有界面可去；其余 4 项**刻意什么都不做** —— 复刻范围内没有
     * 上传日志 / 客服 / 更新日志 / 帮助中心这些页面，宁可点了没反应，也不伪造跳转
     * 或弹一个空态（那会让人以为功能坏了）。
     */
    runHelpItem(item) {
      if (item && item.id === 'shortcuts') this.toggleHelpOpen()
    },
  },
}
