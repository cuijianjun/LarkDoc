/**
 * 原生图标节点 —— 阶段 5「UI 原生化」的最小积木之一。
 *
 * 产出的 DOM 保持旧图标组件的逐字段契约：
 * `<span class="… lark-doc-icon" style="width:Npx;height:Npx">{svg}</span>`。
 * 类名顺序（外部类在前、`lark-doc-icon` 在后）、内联宽高、`innerHTML` 三样
 * 只要差一项，`lark-doc.css` 里的 `.lark-doc-icon` / `.lark-doc-bubble-caret`
 * 规则与气泡条断言就会同时失准（见 `scripts/verify-browser-bubble.js）。
 *
 * TODO(阶段 5·批次 3)：`icons.js` / `palette.js` 目前还挂在
 * `components/lark-doc/editor/` 下（它们本身已经是纯数据、零框架）。
 * 等菜单那一批也原生化之后，把这两个文件整体挪进 `src/ui/`，本模块的
 * 相对路径就能改成同目录引用。
 */
import { ICONS } from './icons'

/**
 * @param {string} name `icons.js` 里的图标键
 * @param {number} size 边长（px），默认值为 16
 * @param {string} className 额外类名（如 `lark-doc-bubble-caret lark-doc-caret`）
 * @returns {HTMLSpanElement}
 */
export function iconMarkup(name) {
  return ICONS[name] || ''
}

const DIAGRAM_ICON_MARKUP = {
  // 节点 + 分支菱形：一眼区别于其他图表的流程结构。
  flowchart: '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><rect x="7" y="1.5" width="6" height="3.5" rx="1"/><path d="m10 7 3 3-3 3-3-3Z"/><rect x="1.5" y="14.5" width="6" height="3.5" rx="1"/><rect x="12.5" y="14.5" width="6" height="3.5" rx="1"/><path d="M10 5v2M10 13v1.5M7.8 10H4.5v4.5M12.2 10h3.3v4.5"/></svg>',
  // 两条生命线 + 横向消息箭头：对应 sequenceDiagram。
  sequence: '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M4 2v16M16 2v16"/><rect x="2" y="2" width="4" height="3" rx=".8"/><rect x="14" y="2" width="4" height="3" rx=".8"/><path d="M6 7h8l-2-2M14 11H6l2 2M6 15h8l-2-2"/></svg>',
  // 时间轴、分行任务条：对应 gantt。
  gantt: '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M2 3.5v14M2 17.5h16M2 7.5h16M2 11.5h16"/><rect x="4" y="4.5" width="5" height="2" rx=".7"/><rect x="7" y="8.5" width="8" height="2" rx=".7"/><rect x="5" y="12.5" width="4" height="2" rx=".7"/></svg>',
  // 扇区缺口 + 分割线：对应 pie。
  pie: '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M10 2a8 8 0 1 0 8 8h-8Z" fill="currentColor" stroke="none"/><path d="M11 2a7 7 0 0 1 7 7h-7Z" fill="none"/><path d="M10 2v8h8"/></svg>',
  // 状态圆点、终态胶囊和状态迁移箭头：对应 stateDiagram。
  state: '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><circle cx="3.5" cy="10" r="2.2"/><rect x="13" y="7" width="5" height="6" rx="3"/><path d="M5.7 10h6.1l-2-2M11.8 10l-2 2"/></svg>',
  // UML 类框三分区 + 继承连线：对应 classDiagram。
  class: '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><rect x="1.5" y="1.5" width="8" height="7" rx=".7"/><path d="M1.5 4h8M1.5 6h8M3 3h5M3 5h2"/><rect x="11" y="11.5" width="7.5" height="7" rx=".7"/><path d="M11 14h7.5M11 16h7.5M12.5 13h4M12.5 15h2M9.5 6h2.5v9h-1.5"/></svg>',
}

export function diagramIconNode(type, size = 18, className = '') {
  const span = document.createElement('span')
  span.className = className ? `${className} lark-doc-icon lark-doc-diagram-icon` : 'lark-doc-icon lark-doc-diagram-icon'
  span.style.width = `${size}px`
  span.style.height = `${size}px`
  span.innerHTML = DIAGRAM_ICON_MARKUP[type] || DIAGRAM_ICON_MARKUP.flowchart
  return span
}

export function iconNode(name, size = 16, className = '') {
  const span = document.createElement('span')
  span.className = className ? `${className} lark-doc-icon` : 'lark-doc-icon'
  const svg = iconMarkup(name)
  // 未收录的图标只留空 span（与旧组件的空 span 兼容）。
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
