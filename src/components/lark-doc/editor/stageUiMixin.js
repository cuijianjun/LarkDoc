/**
 * stageUiMixin — 幻灯片演示舞台的原生化接线层（阶段 5 批次 5F）。
 *
 * 与 `panelsUiMixin` / `dialogsUiMixin` 同一套范式：DOM 由 `src/ui/stage.js`（纯 DOM、
 * 零框架）创建，本 mixin 只做「把状态算成一份 state → 推给 UI」。分章逻辑（
 * `slideChapters`）、游标（`slideIndex`）、开合（`slides`）一行没动，全留在
 * `viewModesMixin` 里。
 *
 * 三条必须守住的线：
 *
 * 1. **别 watch `slideChapters`**。它是 computed，而 `slideChapters` 会对每个 H1 跑一次
 *    `doc.textBetween()`。SFC 里这个 computed 只在 `v-if="ed.slides"` 为真时才被渲染
 *    函数读到 —— 非演示态改正文一次都不会求值。若在这里 watch 它，watcher 会强制每次
 *    正文变化都重算（2,000 块的文档就是每按键几十次 `textBetween`），直接把
 *    `keystrokeP95` 打回去。正确做法是：**watch 它依赖的 `outline`，且只在
 *    `slides` 为真时才 refresh**，同时 `buildStageState()` 在关闭时**根本不读**
 *    `slideChapters`。
 * 2. **`open` 就是原 `v-if="ed.slides"` 的那个条件**。条件为假时整棵真不在 DOM 里，
 *    断言用 `querySelector` 找不到才是对的（不是 `display:none`）。
 * 3. **宿主是 `.lark-doc-main` 里的 `display: contents` 空壳**（`ref="stageHost"`），
 *    紧挨在 `.lark-doc-paper` 之前。舞台必须当「正文流的首个子元素」才能撑
 *    `min-height: 70vh`；`mountNode` 只会 `appendChild`（排到队尾），所以顺序靠宿主
 *    位置解决，不靠插入 API。
 */
import { createSlideStage } from '../../../ui/stage'

export default {
  watch: {
    // 开合：真进真出 DOM。
    slides() { this.refreshStage() },
    // 章节游标：只在演示态有意义（键盘 ← → 与三颗按钮都改它）。
    slideIndex() { this.refreshStage() },
    // 目录变了 = 分章边界或章节标题变了。**加了 `slides` 闸门**，理由见文件头第 1 条。
    outline() { if (this.slides) this.refreshStage() },
    // 没有 H1 时章节标题兜底用文档名（`slideChapters` 的第一条分支）。
    localTitle() { if (this.slides) this.refreshStage() },
  },
  methods: {
    /** 挂载舞台（由主组件 `mounted` 调用，不依赖编辑器实例）。 */
    mountStage() {
      if (this._stageUi) return
      const host = this.$refs.stageHost
      if (!host) return
      this._stageUi = createSlideStage({
        host,
        handlers: {
          onPrev: () => this.prevSlide(),
          onNext: () => this.nextSlide(),
          // 「退出演示」与工具栏那颗按钮同一条路径（`toggleSlides` 顺手把游标清零）。
          onExit: () => this.toggleSlides(),
        },
      })
      this.refreshStage()
    },
    destroyStage() {
      if (!this._stageUi) return
      this._stageUi.destroy()
      this._stageUi = null
    },
    /**
     * 推平 state。
     *
     * 关闭时**只返回 `open: false`** —— 不是「算完再丢掉」，是压根不碰
     * `slideChapters`（那个 computed 一求值就是 O(标题数) 次 `textBetween`）。
     */
    buildStageState() {
      if (!this.slides) return { open: false }
      const chapters = this.slideChapters || []
      const total = chapters.length
      // 游标兜底：`prevSlide` / `nextSlide` 本身不 clamp（靠按钮 disabled 拦），
      // 章节数变少时 index 可能停在区间外；渲染前夹一下，别让模板读到 undefined。
      const index = Math.min(Math.max(this.slideIndex, 0), Math.max(total - 1, 0))
      const current = chapters[index] || { title: '', text: '' }
      return { open: true, index, total, title: current.title, text: current.text }
    },
    refreshStage() {
      if (!this._stageUi) return
      this._stageUi.update(this.buildStageState())
    },
  },
}
