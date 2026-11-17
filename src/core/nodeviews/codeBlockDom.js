/**
 * 代码块 NodeView 的 DOM 造节点小工具：元素工厂、UI 标记、内联图标。
 *
 * `UI_ATTR` 是「属于 NodeView 自己的交互元素」的标记 —— 事件停在这些节点上，
 * 不再冒泡进 ProseMirror，否则点工具条按钮会把光标挪进代码正文。
 */

/** 标记「属于 NodeView 自己的交互元素」：事件停在这里，不进 ProseMirror。 */
export const UI_ATTR = 'data-lark-doc-code-ui'

export function el(tag, className, attrs = {}) {
  const element = document.createElement(tag)
  if (className) element.className = className
  Object.keys(attrs).forEach((key) => element.setAttribute(key, attrs[key]))
  return element
}

export function markUi(element) {
  element.setAttribute(UI_ATTR, '')
  return element
}

const CODE_ICONS = {
  caret: [14, 'M7 9.204l4.744-4.744a.292.292 0 01.412 0l.413.413a.292.292 0 010 .412l-5.156 5.156a.583.583 0 01-.825 0L1.432 5.285a.292.292 0 010-.412l.412-.413a.292.292 0 01.413 0L7 9.204z'],
  wrap: [22, 'M4.583 4.95c0-.202.165-.367.367-.367h.642c.202 0 .367.165.367.367v12.1a.367.367 0 01-.367.367H4.95a.367.367 0 01-.367-.367V4.95zM16.409 4.583a.367.367 0 00-.367.367v12.1c0 .203.164.367.366.367h.642a.367.367 0 00.367-.367V4.95a.367.367 0 00-.367-.367h-.642zM7.61 11.516c.902 0 1.856-.001 3.197-.007v1.444c0 .427.492.667.829.405l2.775-2.159a.513.513 0 000-.81l-2.775-2.16a.513.513 0 00-.829.406v1.497H7.61a.412.412 0 00-.412.412v.56c0 .227.184.412.412.412z'],
  copy: [22, 'M6.188 8.25v8.25h6.875V8.25H6.186zm8.25-.688v9.702c0 .337-.288.611-.642.611H5.454c-.354 0-.641-.274-.641-.611V7.486c0-.337.287-.611.641-.611h8.296c.38 0 .688.308.688.688zm2.548-3.236a.685.685 0 01.201.487v8.593c0 .19-.153.344-.343.344h-.688a.344.344 0 01-.343-.344V5.5H9.28a.344.344 0 01-.344-.344V4.47c0-.19.154-.344.344-.344H16.5c.19 0 .362.077.486.201z'],
  check: [24, 'M4 11.293a1 1 0 011.414 0l4.072 4.07 9.07-9.07a1 1 0 011.415 0l.706.707a1 1 0 010 1.414L10.193 18.9a1 1 0 01-1.415 0l-5.485-5.485a1 1 0 010-1.414L4 11.293z'],
  search: [24, 'M16.473 17.887A9.46 9.46 0 0110.5 20a9.5 9.5 0 119.5-9.5 9.46 9.46 0 01-2.113 5.973l3.773 3.773a.996.996 0 01-.007 1.407.996.996 0 01-1.407.007l-3.773-3.773zM18 10.5a7.5 7.5 0 10-15 0 7.5 7.5 0 0015 0z'],
  fold: [12, 'M1.5 3.5h9L6 8.5z'],
}

export function codeIcon(name) {
  const [size, data] = CODE_ICONS[name]
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`)
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', data)
  path.setAttribute('fill', 'currentColor')
  svg.appendChild(path)
  return svg
}
