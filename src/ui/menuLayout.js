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

export function editorChromeSafeTop(root) {
  const win = root?.ownerDocument.defaultView
  if (!win) return MENU_MARGIN
  let bottom = MENU_MARGIN
  root.querySelectorAll('.lark-doc-topbar, .lark-doc-toolbar').forEach(bar => {
    const style = win.getComputedStyle(bar)
    if (style.position !== 'sticky' && style.position !== 'fixed') return
    const rect = bar.getBoundingClientRect()
    if (rect.top <= (parseFloat(style.top) || 0) + 1 && rect.bottom > bottom) bottom = rect.bottom
  })
  return Math.round(bottom) + MENU_GAP
}

/**
 * @param {HTMLElement} menu 已插入文档的弹层
 * @param {HTMLElement} trigger 触发器（菜单的锚点）
 * @param {number} minTop `bubbleSafeTop()` 的结果
 */
export function placeMenu(menu, trigger, minTop = MENU_MARGIN, options = {}) {
  if (!menu || !trigger) return
  const win = menu.ownerDocument.defaultView
  const triggerRect = trigger.getBoundingClientRect ? trigger.getBoundingClientRect() : trigger
  const viewport = win.visualViewport
  const x = viewport?.offsetLeft || 0, y = viewport?.offsetTop || 0
  const right = x + (viewport?.width || win.innerWidth) - MENU_MARGIN
  const bottom = y + (viewport?.height || win.innerHeight) - MENU_MARGIN
  const safeTop = Math.min(Math.max(y + MENU_MARGIN, minTop), bottom)
  const maxWidth = Math.max(0, Math.min(options.maxWidth || Infinity, right - x - MENU_MARGIN))
  const maxHeight = Math.max(0, bottom - safeTop)
  menu.style.maxWidth = `${maxWidth}px`
  menu.style.maxHeight = `${maxHeight}px`
  menu.style.boxSizing = 'border-box'
  const computed = win.getComputedStyle(menu)
  const minWidth = parseFloat(computed.minWidth) || 0
  if (minWidth > maxWidth) menu.style.minWidth = `${maxWidth}px`
  const box = menu.getBoundingClientRect()
  const width = Math.min(box.width || parseFloat(computed.width) || Math.max(minWidth, 230), maxWidth)
  const height = Math.min(box.height || menu.offsetHeight, maxHeight)
  const gap = options.gap ?? MENU_GAP
  const below = Math.max(0, bottom - triggerRect.bottom - gap), above = Math.max(0, triggerRect.top - safeTop - gap)
  const placeAbove = below < height && above > below
  // 弹层高度不能超过所选方向的可用空间：否则 `top` 会被下界夹回 `safeTop`，弹层
  // 铺满整屏、反过来盖住自己的触发按钮（工具栏「更多」菜单比视口还高时就是这样，
  // 鼠标移到按钮上菜单先弹出，随后按钮被盖住，点击永远打不中）。
  const space = placeAbove ? above : below
  // 只有「自然高度装不下」时才把高度收到可用空间：否则菜单会越过所选方向铺满整屏，
  // 反过来盖住自己的触发按钮（工具栏「更多」菜单比视口还高时就是这样，鼠标移到按钮
  // 上菜单先弹出，随后按钮被盖住，点击永远打不中）。本来就装得下时保留视口上限，
  // 不要把它压成当前自然高度 —— 内容一变就再也撑不开了。
  const capped = height > space
  const fittedHeight = capped ? space : height
  const appliedMaxHeight = capped ? Math.min(maxHeight, space) : maxHeight
  if (capped) menu.style.maxHeight = `${appliedMaxHeight}px`
  const naturalTop = placeAbove ? triggerRect.top - fittedHeight - gap : triggerRect.bottom + gap
  const left = Math.max(x + MENU_MARGIN, Math.min(right - width, options.align === 'end' ? triggerRect.right - width : triggerRect.left))
  const top = Math.max(safeTop, Math.min(bottom - fittedHeight, naturalTop))
  const style = { left: `${left}px`, top: `${top}px`, right: 'auto', maxWidth: `${maxWidth}px`, maxHeight: `${appliedMaxHeight}px`, marginTop: '0px' }
  Object.assign(menu.style, style)
  return style
}
