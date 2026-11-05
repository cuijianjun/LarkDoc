/**
 * colorPaletteUiMixin — 颜色面板（字色 / 高亮块两态）的原生化接线层（阶段 5 批次 5G）。
 *
 * 与 `toolbarUiMixin` / `tableToolsUiMixin` 同一套范式：DOM 由 `src/ui/colorPalette.js`
 * 建，本 mixin 只做「把状态算成一份 state → 推给 UI」，业务判断全留在
 * `calloutColorMixin`（`toggleColorPalette` / `applyColorPalette` / `resetTextColors` /
 * `resetColorPalette`）与 `toolbarMenusMixin`（hover 开合的 160ms 收敛）里。
 *
 * 四条接线要点：
 *
 * 1. **`open` 就是原模板 `v-if` 的两个条件**：`colorPaletteOpen` 且非只读。
 *    `readingModeMixin` 的 `OVERLAY_FLAGS` 在只读切换时会把 `colorPaletteOpen` 清空，
 *    所以「解除只读不自动弹回来」是既有行为，别在这里补开。
 * 2. **`activeTextColor` / `activeTextBackground` 读的是编辑器实时 state**
 *    （`getAttributes('textStyle')`），computed 不会触发 watcher —— 面板开着时要靠
 *    主组件的 `onTransaction` / `onSelectionUpdate` 显式 `refreshColorPalette()`。
 * 3. **推荐色随正文轨整组替换**（`contentTheme`，T3-03），最近色两条各自整体替换
 *    （`textColorRecent` / `colorPaletteRecent` 都是赋值新数组），所以四个 watch 都够。
 * 4. **hover 只转发不决策**：`onEnter` / `onLeave` 直接转给 `cancelPopupHoverClose` /
 *    `scheduleColorPaletteClose`。定时器只许有一份（在 `toolbarMenusMixin`），这里再攒
 *    一个就会两处各管一半。
 */
import { createColorPalette } from '../../../ui/colorPalette'

export default {
  watch: {
    colorPaletteOpen() { this.refreshColorPalette() },
    // 只读切换时色板要立刻消失（`v-if` 的第二个条件）。
    effectiveReadonly() { this.refreshColorPalette() },
    // 色板定位（top/left 整体替换），开合与重定位都从这里下来。
    colorPalettePosition: { deep: true, handler() { this.refreshColorPalette() } },
    // 推荐色随档位整组替换。
    contentTheme() { this.refreshColorPalette() },
    textColorRecent() { this.refreshColorPalette() },
    colorPaletteRecent() { this.refreshColorPalette() },
  },
  methods: {
    /** 挂载（由主组件 `mounted` 调用；面板默认关着，首次 `render` 就是空操作）。 */
    mountColorPalette() {
      if (this._colorPaletteUi) return
      const host = this.$refs.colorPaletteHost
      if (!host) return
      this._colorPaletteUi = createColorPalette({
        host,
        handlers: {
          // 字色 A 字传 `'textColor'`、背景格与「最近」传 `'textBackground'`、
          // 高亮块推荐色**不传**（由 `colorPaletteOpen` 决定三个 callout* 目标）。
          onApply: (value, target) => this.applyColorPalette(value, target),
          onResetText: () => this.resetTextColors(),
          onResetPalette: () => this.resetColorPalette(),
          onEnter: () => this.cancelPopupHoverClose(),
          onLeave: () => this.scheduleColorPaletteClose(),
        },
      })
      this.refreshColorPalette()
    },
    buildColorPaletteState() {
      const open = !!this.colorPaletteOpen && !this.effectiveReadonly
      if (!open) return { open: false }
      // 两态子树完全不同：字色态给 letters + rows，高亮块态给 options。
      // 不给的那几组传空数组，`src/ui/colorPalette.js` 的区块指纹会自己跳过重建。
      const isText = this.colorPaletteIsText
      return {
        open: true,
        isText,
        title: this.colorPaletteTitle,
        style: this.colorPaletteStyle,
        letters: isText ? this.textColorOptions : [],
        activeText: isText ? this.activeTextColor : '',
        rows: isText ? this.textBackgroundRows : [],
        activeBackground: isText ? this.activeTextBackground : '',
        recentText: this.textColorRecent,
        recent: this.colorPaletteRecent,
        options: isText ? [] : this.colorPaletteOptions,
      }
    },
    refreshColorPalette() {
      if (!this._colorPaletteUi) return
      this._colorPaletteUi.update(this.buildColorPaletteState())
    },
    destroyColorPalette() {
      if (!this._colorPaletteUi) return
      this._colorPaletteUi.destroy()
      this._colorPaletteUi = null
    },
  },
}
