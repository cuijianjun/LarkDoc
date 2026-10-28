/**
 * selectionPacingMixin —— 选区高频路径的帧级合并（P7-04）。
 *
 * 为什么单独一支：`onSelectionUpdate` 是编辑器里唯一「每按一次方向键就跑一整轮
 * DOM 测量」的回调。按住方向键走一段，一秒钟能来 30 次以上，每次都要
 * `coordsAtPos` ×2、`positionBlockHandle`（内部十几次 `getBoundingClientRect`）、
 * `updateTableBoundary` 两遍、`updateCalloutTools`、气泡条定位 —— 全部读写布局，
 * 浏览器只能反复强制同步排版。2,000 块文档上这一串就是键击延迟的主账之一。
 *
 * 合并口径（照 P7 收口计划 Task 5）：
 *   1. **一帧一次**：同一帧里来多少次选区变化都只做一轮定位，用的永远是
 *      **最新的** selection（rAF 回调里重新读 state，不留过期快照）。
 *   2. **不合并「便宜且影响模板」的东西**：`savedSelection` / 目录高亮 / 表格工具
 *      开关仍在同步段里定，它们只是普通赋值，拖到下一帧反而会让人看到旧高亮。
 *   3. **显隐与位置同帧出**：气泡条的 `bubbleVisible` 与 `bubblePosition` 必须由
 *      同一次测量写下去，否则「先显示在旧位置、下一帧再挪」就是肉眼可见的控件抖动。
 *   4. **销毁可取消**：`beforeDestroy` 里 dispose，卸载后不再有回调摸 editor。
 *
 * 原实现里 `$nextTick(() => this.updateTableBoundary())` 那一遍被删掉了：
 * ProseMirror 的视图更新是同步的，等一帧再量已经包含「DOM 已更新」这件事，
 * 而 `updateTableBoundary` 自己还有「表格宽度为 0 → 下一帧重试」的兜底。
 */
import { createFrameBatcher } from '../../../core/pacing'

/** 选区定位只有一个任务，不需要细分 key；补一层 key 是为了将来加「只重排某一块」。 */
const SELECTION_LAYOUT_KEY = 'selection-layout'

export default {
  methods: {
    /**
     * 懒建调度器。`$frame` 是单测/宿主注入假时钟的通道（组件上永远是 undefined，
     * 走真 rAF）；不放进 `data` 是因为 rAF 句柄不该进响应式系统。
     */
    selectionBatcher() {
      if (!this._selectionBatcher) {
        this._selectionBatcher = createFrameBatcher({
          frame: this.$frame,
          // 定位失败只记日志：`this.error` 是正文校验的错误横幅，不能被一次
          // 布局抖动挂上一条「正文不能超过…」式的假错误。
          onError: (error) => { console.warn('[lark-doc] selection layout failed:', error) },
        })
      }
      return this._selectionBatcher
    },
    /** `pos` 之前最后一个标题的位置（没有则 -1）。倒序扫，不复制数组。 */
    headingPosBefore(pos) {
      const outline = this.outline
      if (!Array.isArray(outline)) return -1
      for (let index = outline.length - 1; index >= 0; index -= 1) {
        if (outline[index].pos <= pos) return outline[index].pos
      }
      return -1
    },
    onSelectionUpdate() {
      if (!this.editor) return
      const { selection } = this.editor.state
      if (this.editor.isFocused) this.savedSelection = { from: selection.from, to: selection.to }
      // 原来这里是 `[...this.outline].reverse().find(...)`：2,000 个标题时每次按键
      // 复制一个 2,000 元素的数组，纯属白花。
      this.activeHeading = this.headingPosBefore(selection.from)
      if (this.editor.isActive('table') && this.writable()) this.tableToolsOpen = true
      // hover 态是上一次指针留下的：先清掉再重算，别让边界线停在旧单元格上。
      this.clearTableBoundaryHover()
      this.scheduleSelectionLayout()
    },
    scheduleSelectionLayout() {
      if (!this.editor) return
      this.selectionBatcher().schedule(SELECTION_LAYOUT_KEY, () => this.runSelectionLayout())
    },
    /** 本帧唯一一次定位。顺序与合并前保持一致：句柄 → 表格边界 → 高亮块工具 → 气泡条。 */
    runSelectionLayout() {
      if (!this.editor || this._isBeingDestroyed || this._isDestroyed) return
      const { selection } = this.editor.state
      if (!this.handlePressed && !this.blockMenuOpen && !this.blockTypeMenuOpen) this.positionBlockHandle(this.currentBlockRange())
      this.updateTableBoundary()
      this.updateCalloutTools()
      const visible = !selection.empty && !selection.node && !this.effectiveReadonly && this.editor.isFocused
      this.bubbleVisible = visible
      if (visible) this.bubblePosition = this.bubbleBarPosition(selection)
      else { this.closeBubbleAlignMenu(); this.closeBubbleHeadingMenu() }
    },
    /** 气泡条坐标：只有真的要显示时才测（原来不论显不显示都先 `coordsAtPos` 一次）。 */
    bubbleBarPosition(selection) {
      const view = this.editor.view
      const coords = view.coordsAtPos(selection.from)
      // 顶部避让：选区贴近视口顶部时，气泡条不能钻进吸顶工具栏（飞书同样会把浮条翻到选区下方）。
      const safeTop = this.bubbleSafeTop()
      const endCoords = view.coordsAtPos(selection.to)
      const naturalTop = coords.top - 50
      const top = naturalTop >= safeTop ? naturalTop : endCoords.bottom + 10
      return {
        left: Math.max(8, Math.min(window.innerWidth - 270, coords.left)),
        top: Math.max(safeTop, Math.min(top, window.innerHeight - 60)),
      }
    },
  },
  // mixin 的 beforeDestroy 与主组件自身的钩子会被 Vue 合并成两个都执行，
  // 所以这里清自己的调度器，主组件的 beforeDestroy 一个字都不用改。
  beforeDestroy() {
    if (this._selectionBatcher) { this._selectionBatcher.dispose(); this._selectionBatcher = null }
  },
}
