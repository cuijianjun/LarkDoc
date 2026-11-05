/**
 * 浮层定位 —— 气泡条的标题级别下拉 / 缩进对齐下拉共用。
 *
 * 算法与旧版 `bubbleMenuMixin.positionBubbleAlignMenu()` /
 * `positionBubbleHeadingMenu()` 完全一致（只是抽成纯函数、不再依赖 `$refs`）：
 *   - 边距 8、触发器与弹层间隙 6；
 *   - **默认排在触发器下方**，下方放不下且上方更宽裕时翻到上方；
 *   - `top` 的下界是 `minTop`（= `bubbleSafeTop()`：吸顶顶栏/工具栏底边 + 6），
 *     不是视口 8px —— 否则菜单会压到工具栏上；
 *   - `left` 夹在 `[8, innerWidth - width - 8]`，再按触发器左边界对齐。
 *
 * 🔴 调用前提：`menu` 必须**已在文档里**。`getBoundingClientRect()` 对游离节点
 * 一律返回 0，量出来的宽高会让「翻到上方」的判断永远走不到。
 * 这正是原生化要顺手解决的时序点 —— 原生 DOM 同步插入即可同步测量，
 * 不再需要 `$nextTick(() => positionXxx())`。
 */
export const MENU_MARGIN = 8
export const MENU_GAP = 6

/**
 * @param {HTMLElement} menu 已插入文档的弹层
 * @param {HTMLElement} trigger 触发器（菜单的锚点）
 * @param {number} minTop `bubbleSafeTop()` 的结果
 */
export function placeMenu(menu, trigger, minTop) {
  if (!menu || !trigger) return
  const triggerRect = trigger.getBoundingClientRect()
  const box = menu.getBoundingClientRect()
  const width = box.width || 230
  const below = Math.max(0, window.innerHeight - triggerRect.bottom - MENU_MARGIN)
  const above = Math.max(0, triggerRect.top - minTop)
  const useAbove = below < box.height && above > below
  const naturalTop = useAbove ? triggerRect.top - box.height - MENU_GAP : triggerRect.bottom + MENU_GAP
  const left = Math.max(MENU_MARGIN, Math.min(window.innerWidth - width - MENU_MARGIN, triggerRect.left))
  const top = Math.max(minTop, Math.min(window.innerHeight - box.height - MENU_MARGIN, naturalTop))
  menu.style.left = `${Math.round(left)}px`
  menu.style.top = `${Math.round(top)}px`
}
