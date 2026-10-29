/**
 * 顶栏 popover 的通用定位纯函数（04 §0.1「浮层通用 DOM 骨架」+ §4.6 四个顶栏浮层）。
 *
 * 为什么单独成文件：
 *   1) 顶栏三处（更多 / 新建 / 通知）的定位规则完全一致 —— 右对齐锚点右缘、下方 4px、
 *      放不下翻上去、左右各夹 8px。三份代码三份漂移，历史上已经出现过「更多」和
 *      「模式下拉」夹边规则不一致的问题；
 *   2) 纯函数可以在 Node 单测里直接 import（vitest 环境禁止 import .vue）；
 *   3) 尺寸不在函数里写死 —— 菜单宽度是**渲染后实测**的（飞书「更多」宽度随第 12 项
 *      语言名长度浮动 ±5px，`04 §4.2.1`），所以 `size` 由调用方传 `getBoundingClientRect()`。
 *
 * 参数
 *   anchor  —— 触发按钮的 DOMRect（`event.currentTarget.getBoundingClientRect()`）
 *   size    —— 浮层实测尺寸 `{ width, height }`
 *   viewport—— `{ width, height }`（`window.innerWidth/innerHeight`）
 *   options —— `{ gap = 4, align = 'right', margin = 8 }`
 *             `align: 'right'` 右对齐锚点右缘（顶栏浮层默认）；`'left'` 左对齐锚点左缘
 *             （「新建」菜单在顶栏左侧，向右展开）；`'center'` 居中对齐。
 * 返回
 *   `{ left, top }`（像素整数，直接进 `:style`）
 */
export function anchorPopoverStyle(anchor, size, viewport, options) {
  const opts = options || {}
  const gap = typeof opts.gap === 'number' ? opts.gap : 4
  const margin = typeof opts.margin === 'number' ? opts.margin : 8
  const align = opts.align || 'right'
  if (!anchor || !size) return { left: 0, top: 0 }
  const vw = viewport && viewport.width ? viewport.width : 0
  const vh = viewport && viewport.height ? viewport.height : 0
  const width = size.width || 0
  const height = size.height || 0

  let left
  if (align === 'left') left = anchor.left
  else if (align === 'center') left = anchor.left + (anchor.width - width) / 2
  else left = anchor.right - width

  // 垂直：优先下方；下方放不下就翻到上方；上下都放不下则贴住视口底边（不越界）。
  let top = anchor.bottom + gap
  if (vh && top + height > vh - margin) {
    const above = anchor.top - gap - height
    top = above >= margin ? above : Math.max(margin, vh - height - margin)
  }

  const maxLeft = vw ? Math.max(margin, vw - width - margin) : left
  left = Math.min(Math.max(margin, left), maxLeft)
  return { left: Math.round(left), top: Math.round(Math.max(margin, top)) }
}

export default anchorPopoverStyle
