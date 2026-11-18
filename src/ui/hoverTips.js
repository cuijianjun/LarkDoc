/**
 * 功能栏图标悬停提示 —— 共用绑定器。
 *
 * 口径（用户原话）：「只要是功能栏里的**图标**都出提示；**有中文名称的不出**；
 * **有下一级弹窗的不出**」。三条都落在下面的 `resolveTarget()` 里。
 *
 * 与 `tooltip.js` 的分工：那边是**提示层**（定位、延时、`aria-describedby` 串接、
 * 销毁），这里是**判据 + 容器级委托**。所以一条功能栏只调一次
 * `bindHoverTips(root)`，之后条目增删不用重绑。
 *
 * 为什么走委托而不是逐元素 `tooltip.bind()`：
 * `commandMenu` 的条目是**复用**的（同一节点在 ➕ / 斜杠两种形态间来回切，`syncEntry`
 * 只改属性），`bubbleBar.build()` 又会 `el.textContent = ''` 清空重建。逐元素绑会
 * 漏绑重建出来的新按钮，而且 `bind()` 返回的 `unbind` 没人存，改两次就叠两份监听。
 *
 * 为什么「有中文名称」必须按**布局**判、不能按 `textContent`：
 * ➕ 菜单「基础」那格是**有文本、但被 `clip-path: inset(50%)` 藏起来**的纯图标
 * （见 `lark-doc.css` 的 `.lark-doc-command-menu.is-plus … .lark-doc-command-label`）。
 * 按文本判会把整整一格最该出提示的按钮判成「有名称」，一条提示都不出。
 * 反向的坑历史上也踩过：`toolbar.js` 曾用「含中文就跳过」，把「插入」「图表」一并排除了。
 */

import { createTooltip } from './tooltip'

/** 该出提示的控件。用内容语义而不是标签名 —— 菜单项是 `<button role="menuitem">`。 */
const TARGET_SELECTOR = 'button, [role="button"], [role="menuitem"], [role="option"], [role="combobox"], input[type="color"]'

/** 同一根节点只挂一次，重复调用拿到同一个句柄（`bubbleBar` 的 `build()` 会被反复调）。 */
const INSTANCES = new WeakMap()

const isBlank = (value) => !value || !value.trim()

/**
 * 元素本身是否被样式藏起来了（藏了就等于「没有可见名称」）。
 * 只看「明确藏」的几种写法：靠反向推断（量宽高 > 0）在无布局引擎的环境里会全判成隐藏。
 */
function isVisuallyHidden(node, win) {
  const style = win.getComputedStyle ? win.getComputedStyle(node) : null
  // `clip-path` 这类带连字符的属性，cssstyle 未必挂在驼峰字段上，两个入口都读。
  const read = (camel, css) => {
    const computed = style && (style[camel] || (css && style.getPropertyValue ? style.getPropertyValue(css) : ''))
    if (computed) return String(computed)
    const inline = node.style && (node.style[camel] || (css && node.style.getPropertyValue ? node.style.getPropertyValue(css) : ''))
    return inline ? String(inline) : ''
  }
  if (read('display') === 'none') return true
  const visibility = read('visibility')
  if (visibility === 'hidden' || visibility === 'collapse') return true
  // `clip-path: inset(50%)` —— ➕ 菜单「基础」格用的就是这条。
  const clipPath = read('clipPath', 'clip-path')
  if (clipPath && clipPath !== 'none') return true
  if (read('opacity') === '0') return true
  // sr-only：绝对定位 + 1px 见方 + overflow hidden。
  if (read('position') === 'absolute'
    && read('overflow') === 'hidden'
    && parseFloat(read('width')) <= 1
    && parseFloat(read('height')) <= 1) return true
  return false
}

/**
 * 图标字形不算「名称」。
 * 内联 SVG 图标里带 `<text>B</text>` / `<text>H1</text>` 这类字形 ——
 * 它们是 `aria-hidden` 的装饰，按文本判会把**所有**纯图标按钮都判成「有名称」。
 */
function isDecorative(node, root) {
  for (let current = node; current && current !== root; current = current.parentElement) {
    if (current.localName === 'svg') return true
    if (current.getAttribute && current.getAttribute('aria-hidden') === 'true') return true
  }
  return false
}

/** 控件里是否有一处**看得见**的文本（= 有中文名称 → 不出提示）。 */
export function hasVisibleText(node) {
  const win = node.ownerDocument.defaultView
  if (!win || !node.ownerDocument.createTreeWalker) return false
  const walker = node.ownerDocument.createTreeWalker(node, 4 /* NodeFilter.SHOW_TEXT */)
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    if (isBlank(text.nodeValue)) continue
    const owner = text.parentElement
    if (!owner) continue
    if (isDecorative(owner, node)) continue
    if (!isVisuallyHidden(owner, win)) return true
  }
  return false
}

/** 控件是否自带下一级弹窗（下拉 / 子菜单 / 取色板 / 组合框）→ 不出提示。 */
export function hasNextLevelPopup(node) {
  const popup = node.getAttribute('aria-haspopup')
  if (popup && popup !== 'false') return true
  if (node.getAttribute('role') === 'combobox') return true
  // `caret` 是各处的下拉箭头（`lark-doc-caret` / `lark-doc-bubble-caret`），
  // `submenu-arrow` 是命令菜单项右侧的 `›`。
  return !!node.querySelector('[class*="caret"], [class*="submenu-arrow"]')
}

/** 提示文案：沿用 `data-tooltip-title`（`toolbar.js` 的既有约定）→ `title` → `aria-label`。 */
export function tipText(node) {
  const text = node.dataset.tooltipTitle || node.getAttribute('title') || node.getAttribute('aria-label') || ''
  return isBlank(text) ? '' : text.trim()
}

/**
 * 显式退出提示的标记（`data-tooltip-none`）。
 * 块句柄这类「悬停即展开菜单」的主动作控件用它：飞书悬停六点句柄不出提示，
 * 留个原生 `title` 只会闪一个灰底小框。
 */
const TOOLTIP_OPT_OUT_ATTR = 'data-tooltip-none'

/**
 * 判据总入口：该出提示就返回节点，否则 `null`。
 * @param {Element|null} node
 * @returns {Element|null}
 */
export function resolveTarget(node) {
  if (!node || node.nodeType !== 1) return null
  if (node.hasAttribute(TOOLTIP_OPT_OUT_ATTR)) return null
  if (hasNextLevelPopup(node)) return null
  if (hasVisibleText(node)) return null
  return tipText(node) ? node : null
}

/**
 * 给一条功能栏挂悬停提示。
 * @param {HTMLElement} root 功能栏容器（委托挂在这里，子节点重建不影响）
 * @param {object} [options]
 * @param {number} [options.delay] 悬停延时，缺省 150ms（与 `toolbar.js` 一致）
 * @returns {{ hide(): void, destroy(): void }}
 */
export function bindHoverTips(root, options = {}) {
  if (!root) return { hide() {}, destroy() {} }
  const existing = INSTANCES.get(root)
  if (existing) return existing

  // 命令菜单根是 `role="menu"`，`tooltip.js` 缺省会拦掉弹层内的提示，这里显式放行。
  const tip = createTooltip({ host: root, delay: options.delay, allowInPopup: true })
  let current = null

  const showFor = (node) => {
    current = node
    tip.show(node, () => ({ title: tipText(node) }))
  }
  const clear = () => {
    if (!current) return
    current = null
    tip.hide()
  }
  const targetOf = (target) => {
    const node = target && target.closest ? target.closest(TARGET_SELECTOR) : null
    if (!node || !root.contains(node)) return null
    return resolveTarget(node)
  }

  const onOver = (event) => {
    const node = targetOf(event.target)
    if (node === current) return
    // 从按钮移到它内部的图标：`mouseover` 会再冒一次，这时不该重开延时。
    if (node && current && current.contains(event.target)) return
    if (!node) { clear(); return }
    showFor(node)
  }
  const onOut = (event) => {
    if (!current) return
    if (current.contains(event.relatedTarget)) return
    clear()
  }
  const onFocusIn = (event) => {
    const node = targetOf(event.target)
    if (node === current) return
    if (!node) { clear(); return }
    showFor(node)
  }
  // 按下即收：用户已经动手了，提示让位。
  const listeners = [['mouseover', onOver], ['mouseout', onOut], ['focusin', onFocusIn], ['focusout', clear], ['mousedown', clear]]
  listeners.forEach(([name, handler]) => root.addEventListener(name, handler))

  const handle = {
    /** 功能栏收起来时调一次（`bubbleBar.hide()`、菜单关闭）—— 否则提示会留在已隐藏的锚点旁。 */
    hide: clear,
    destroy() {
      listeners.forEach(([name, handler]) => root.removeEventListener(name, handler))
      current = null
      tip.destroy()
      INSTANCES.delete(root)
    },
  }
  INSTANCES.set(root, handle)
  return handle
}
