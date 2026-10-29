/**
 * 原生图标节点 —— 阶段 5「UI 原生化」的最小积木之一。
 *
 * 产出的 DOM 必须与 `LarkDocIcon.vue`（functional 组件）**逐字段一致**：
 * `<span class="… lark-doc-icon" style="width:Npx;height:Npx">{svg}</span>`。
 * 类名顺序（外部类在前、`lark-doc-icon` 在后）、内联宽高、`innerHTML` 三样
 * 只要差一项，`lark-doc.css` 里的 `.lark-doc-icon` / `.lark-doc-bubble-caret`
 * 规则与气泡条断言就会同时失准（见 `scripts/verify-browser-bubble.js`）。
 *
 * TODO(阶段 5·批次 3)：`icons.js` / `palette.js` 目前还挂在
 * `components/lark-doc/editor/` 下（它们本身已经是纯数据、零框架）。
 * 等菜单那一批也原生化之后，把这两个文件整体挪进 `src/ui/`，本模块的
 * 相对路径就能改成同目录引用。
 */
import { ICONS } from './icons'

/**
 * @param {string} name `icons.js` 里的图标键
 * @param {number} size 边长（px），默认与 `LarkDocIcon` 一致为 16
 * @param {string} className 额外类名（如 `lark-doc-bubble-caret lark-doc-caret`）
 * @returns {HTMLSpanElement}
 */
export function iconNode(name, size = 16, className = '') {
  const span = document.createElement('span')
  span.className = className ? `${className} lark-doc-icon` : 'lark-doc-icon'
  const svg = ICONS[name]
  // 未收录的图标只留空 span（与 LarkDocIcon 的 `if (!svg) return h('span', data)` 同款）。
  if (!svg) return span
  span.style.width = `${size}px`
  span.style.height = `${size}px`
  span.innerHTML = svg
  return span
}

/**
 * 原地换图标：对齐按钮的图形随 `textAlign` 变，必须换 `innerHTML` 而不是
 * 重建节点 —— 重建会把 `flex: 0 0 12px` 的 caret 兄弟节点顺序与焦点一起打乱。
 */
export function setIcon(node, name, size = 16) {
  if (!node) return
  node.style.width = `${size}px`
  node.style.height = `${size}px`
  const svg = ICONS[name] || ''
  if (node.innerHTML !== svg) node.innerHTML = svg
}
