/**
 * commandMenuUiMixin — 命令菜单（`/` 斜杠 + 空段落「＋」）原生化接线层（阶段 5 批次 3）。
 *
 * 与 `bubbleMenuMixin` / `blockHandleUiMixin` 同一套范式：渲染层已不是模板，DOM 由
 * `src/ui/commandMenu.js`（纯 DOM、零框架）创建，本 mixin 只做「把状态算成一份 state
 * → 推给 UI」。`commandMenuMixin.js` 里那套开合/定位/键盘/执行逻辑一行没动。
 *
 * 三条必须守住的线：
 *
 * 1. **`open` 就是原 `v-if` 的两个条件**：`menuOpen && !effectiveReadonly`。原模板上
 *    这两个是同一个 `v-if`，拆成两个 watcher 各刷一次会出现「菜单开了但只读」的一帧，
 *    所以只留一个 `open` 字段、只由一个方法推。
 * 2. **子菜单状态不进 state**：`submenuOpen` / `columnsHover` / `tableHover` 是菜单
 *    **内部**状态（SFC 的 `data`），父组件从来读不到也改不了。把它们塞进 state 会凭空
 *    造出第二份真相 —— 收起子菜单时两边不同步。原生层自己持有，`update()` 只碰入参
 *    提到的那几个字段。
 * 3. **定位仍走 `positionCommandMenu`**：它读的是 `$refs.root` 里真实 DOM 的尺寸，
 *    不认谁建的节点。原生化之后 `menuStyle` 照样由它算，这里只负责把结果推下去。
 */
import { createCommandMenu } from '../../../ui/commandMenu'

export default {
  watch: {
    // —— 开合与入口：斜杠 ↔ plus 换的是整张分段表，必须重推。
    menuOpen() { this.refreshCommandMenu() },
    menuKind() { this.refreshCommandMenu() },
    effectiveReadonly() { this.refreshCommandMenu() },
    // —— 内容：搜索词 / 过滤结果 / 模板列表 / 高亮项。
    menuQuery() { this.refreshCommandMenu() },
    activeCommandId() { this.refreshCommandMenu() },
    filteredCommands: { deep: true, handler() { this.refreshCommandMenu() } },
    templates: { deep: true, handler() { this.refreshCommandMenu() } },
    // —— 定位：`menuStyle` 由 `positionCommandMenu` 算出（含 maxHeight），整体覆盖。
    menuStyle: { deep: true, handler() { this.refreshCommandMenu() } },
  },
  methods: {
    /**
     * 挂载原生菜单（由主组件 `mounted` 调用）。
     *
     * `ref="commandMenuHost"` 这次**既是锚点也是宿主**：菜单直接挂在它里面（与气泡条的
     * `bubbleHost` 同款）。不学块句柄那样插到兄弟位 —— 那要往 Vue 管的子节点列表里塞
     * 节点，父级重渲染时容易被顺手挪走。菜单自己 `position: fixed`，父级是谁不影响定位，
     * 而 `.lark-doc .lark-doc-command-menu` 是后代选择器，多这层空 div 也不丢样式。
     */
    mountCommandMenu() {
      if (this._commandMenuUi) return
      const host = this.$refs.commandMenuHost
      if (!host) return
      this._commandMenuUi = createCommandMenu({ host, handlers: this.commandMenuHandlers() })
      this.refreshCommandMenu()
    },
    destroyCommandMenu() {
      if (!this._commandMenuUi) return
      this._commandMenuUi.destroy()
      this._commandMenuUi = null
    },

    /**
     * handler 全表（键名与 `src/ui/commandMenu.js` 里的 `call('onXxx')` 一一对应）。
     *
     * 三个 emit 的语义照原模板搬：`@query` 除了写搜索词还要**把高亮打回第一项**
     * （换成别人的结果集后下标可能越界）；`@close` 固定传 `true` 复原焦点。
     */
    commandMenuHandlers() {
      return {
        onQuery: (value) => { this.menuQuery = value; this.activeCommandIndex = 0 },
        onMove: (step) => this.moveCommand(step),
        onChoose: (item) => this.chooseCommand(item),
        onClose: () => this.closeCommandMenu(true),
      }
    },

    /** 一份 state 推平（原 `<command-menu :items :templates :query :position-style :active-id :kind>`）。 */
    buildCommandMenuState() {
      return {
        // 原 `v-if="menuOpen && !effectiveReadonly"`
        open: !!(this.menuOpen && !this.effectiveReadonly),
        kind: this.menuKind,
        items: this.filteredCommands,
        templates: this.templates,
        query: this.menuQuery,
        activeId: this.activeCommandId,
        positionStyle: this.menuStyle,
      }
    },

    refreshCommandMenu() {
      const ui = this._commandMenuUi
      if (!ui) return
      ui.update(this.buildCommandMenuState())
    },
  },
}
