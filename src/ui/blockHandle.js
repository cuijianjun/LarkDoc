/**
 * 区块句柄 + 块菜单 —— 原生 DOM 版（`src/ui/` 积木 · 阶段 5 批次 3）。
 *
 * 原 SFC `editor/BlockHandleMenu.vue` 已在阶段 5 批次 3 删除，这里是唯一实现。
 * **结构即契约**：`scripts/verify-browser-block-menu.js` 37 条断言在逐字段量这里
 * 产出的 DOM —— 句柄盒模型与垂直对齐、遮罩（不在本模块）、块菜单段序、
 * 子菜单几何、表格分支、空段落分支，全都不能凭手感改。
 *
 * 三条规矩（与 `toolbar.js` / `bubbleBar.js` 一致）：
 * 1. **结构即契约**：类名 / `role` / `aria-*` / 段序逐字段复刻 SFC；
 *    `v-if` → 真的 insert/remove，`v-show` → `style.display`。
 * 2. **一次建节点、之后只改属性**：只有类型网格、操作列表、颜色三处是动态列表，
 *    按签名重建。
 * 3. **同步定位**：节点同步插入 DOM，`getBoundingClientRect()` 立刻可量 ——
 *    SFC 里 `openBlockMenu` → `$nextTick(positionBlockMenu)` 的时序点就此消灭。
 *
 * ⚠️ 两段式更新（性能很硬）：`updateChrome()` 只写句柄本体，`positionBlockHandle`
 * 在 `pointermove` 上每秒要跑几十次，绝不能顺带重算类型网格（9 次 `blockTypeActive`
 * 各要一次 `doc.resolve`）；`updateMenu()` 才重算菜单内容。
 * 但**两者都要重排根节点的子节点** —— 菜单节点的挂/摘由同一份 state 决定，
 * 各自维护一份会互相摘掉对方的节点。
 */

import { iconNode as defaultIconNode } from './icon'
import { BLOCK_TYPE_ICONS } from './commandIcons'
import { applyStyle, setAttr, syncChildren } from './dom'
import { bindHoverTips } from './hoverTips'

// Same SVG paths as the observed Feishu block menu; keep overrides local.
const BLOCK_MENU_ICONS = {
  "align-left": "<svg width=\"1em\" height=\"1em\" viewBox=\"0 0 24 24\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\" data-icon=\"TypographyOutlined\"><path d=\"M2 4a1 1 0 0 1 1-1h18a1 1 0 1 1 0 2H3a1 1 0 0 1-1-1Zm0 4a1 1 0 0 1 1-1h10a1 1 0 1 1 0 2H3a1 1 0 0 1-1-1Zm1 3a1 1 0 1 0 0 2h18a1 1 0 1 0 0-2H3Zm-1 5a1 1 0 0 1 1-1h10a1 1 0 1 1 0 2H3a1 1 0 0 1-1-1Zm1 3a1 1 0 1 0 0 2h18a1 1 0 1 0 0-2H3Z\" fill=\"currentColor\"></path></svg>",
  "block-submenu-arrow": "<svg width=\"1em\" height=\"1em\" viewBox=\"0 0 24 24\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\" data-icon=\"RightSmallCcmOutlined\"><path d=\"M7.293 4.293a1 1 0 0 0 0 1.414L13.586 12l-6.293 6.293a1 1 0 1 0 1.414 1.414l7-7a1 1 0 0 0 0-1.414l-7-7a1 1 0 0 0-1.414 0Z\" fill=\"currentColor\"></path></svg>",
  "mode-comment": "<svg width=\"1em\" height=\"1em\" viewBox=\"0 0 24 24\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\" data-icon=\"AddCommentOutlined\"><path d=\"M7 11a1 1 0 0 1 1-1h8a1 1 0 1 1 0 2H8a1 1 0 0 1-1-1Z\" fill=\"currentColor\"></path><path d=\"M2 5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v11.5a2 2 0 0 1-2 2h-3.812a.5.5 0 0 0-.33.124l-2.541 2.224a2 2 0 0 1-2.634 0l-2.542-2.224a.5.5 0 0 0-.329-.124H4a2 2 0 0 1-2-2V5Zm2 0v11.5h3.812a2.5 2.5 0 0 1 1.646.619L12 19.343l2.542-2.224a2.5 2.5 0 0 1 1.646-.619H20V5H4Z\" fill=\"currentColor\"></path></svg>",
  "cut": "<svg width=\"1em\" height=\"1em\" viewBox=\"0 0 24 24\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\" data-icon=\"FeishuclipOutlined\"><path d=\"M4.801 4.906a2.289 2.289 0 0 1-.167-2.686c.202-.315.636-.274.875.013l6.571 7.925 6.571-7.925c.239-.287.673-.328.875-.013a2.29 2.29 0 0 1-.167 2.686l-5.817 7.015 2.486 2.997a3.87 3.87 0 0 1 2.212-.691c2.165 0 3.92 1.776 3.92 3.966 0 2.191-1.755 3.967-3.92 3.967s-3.92-1.776-3.92-3.966a4 4 0 0 1 .279-1.473l-2.519-3.037-2.519 3.037c.18.455.279.952.279 1.473 0 2.19-1.755 3.966-3.92 3.966S2 20.384 2 18.194c0-2.191 1.755-3.967 3.92-3.967.82 0 1.582.255 2.212.691l2.486-2.997L4.8 4.906ZM18.24 19.893a1.69 1.69 0 0 0 1.68-1.7c0-.938-.752-1.7-1.68-1.7a1.69 1.69 0 0 0-1.68 1.7c0 .94.752 1.7 1.68 1.7Zm-10.64-1.7c0-.938-.752-1.7-1.68-1.7a1.69 1.69 0 0 0-1.68 1.7c0 .94.752 1.7 1.68 1.7a1.69 1.69 0 0 0 1.68-1.7Z\" fill=\"currentColor\"></path></svg>",
  "copy": "<svg width=\"1em\" height=\"1em\" viewBox=\"0 0 24 24\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\" data-icon=\"CopyOutlined\"><path d=\"M9 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v12a1 1 0 1 1-2 0V4h-9a1 1 0 0 1-1-1Z\" fill=\"currentColor\"></path><path d=\"M5 6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H5Zm0 2h10v12H5V8Z\" fill=\"currentColor\"></path></svg>",
  "trash": "<svg width=\"1em\" height=\"1em\" viewBox=\"0 0 24 24\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\" data-icon=\"DeleteTrashOutlined\"><path d=\"M8 4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2h5a1 1 0 1 1 0 2h-1v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6H3a1 1 0 0 1 0-2h5ZM6 6v14h12V6H6Zm4 3a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1Zm4 0a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1Z\" fill=\"currentColor\"></path></svg>",
  "block-quote": "<svg viewBox=\"0 0 24 24\" fill=\"none\" aria-hidden=\"true\"><path d=\"M6.865 21C4.275 21 2 18.88 2 15.037c0-4.5 3.143-9.725 6.518-12.422a.888.888 0 0 1 1.203.107c.398.424.32 1.11-.112 1.5-2.412 2.17-5.32 6.855-5.153 9.055.215-.113 1.277-.516 2.801-.516 2.197 0 3.845 1.726 3.845 4.002A4.22 4.22 0 0 1 6.865 21Zm10.898 0c-2.59 0-4.865-2.119-4.865-5.963 0-4.5 3.143-9.725 6.518-12.422a.888.888 0 0 1 1.203.107c.398.424.32 1.11-.112 1.5-2.412 2.17-5.32 6.855-5.153 9.055.215-.113 1.277-.516 2.801-.516 2.197 0 3.845 1.726 3.845 4.002A4.22 4.22 0 0 1 17.763 21Z\" fill=\"currentColor\"/></svg>",
  "palette": "<svg viewBox=\"0 0 24 24\" fill=\"none\" aria-hidden=\"true\"><path d=\"M21.957 2.13a1 1 0 0 0-1.406.147l-9.11 11.25a6.632 6.632 0 0 0-1.367 2.969.221.221 0 0 0 .302.244 6.632 6.632 0 0 0 2.62-1.955l9.109-11.25a1 1 0 0 0-.148-1.406Z\" fill=\"currentColor\"/><path d=\"M17.008 3.665a13.454 13.454 0 0 0-5.06-.984l-.024.004-.538.011-.51.03c-1.191.091-2.37.343-3.51.75a12.305 12.305 0 0 0-3.754 2.142c-1.096.922-1.96 1.99-2.568 3.176a8.435 8.435 0 0 0-.96 3.885c0 1.335.324 2.63.962 3.848.608 1.157 1.474 2.195 2.573 3.083a12.303 12.303 0 0 0 3.755 2.049c1.444.494 2.981.745 4.563.745l.545-.01.525-.029a14.43 14.43 0 0 0 1.57-.203l.722-.148.196-.06c.514-.186.96-.566 1.253-1.083a2.87 2.87 0 0 0 .26-2.178l-.09-.349-.03-.218a2.301 2.301 0 0 1 .357-1.454c.357-.544.93-.868 1.538-.871h1.768l.204-.007c1.614-.113 2.91-1.56 3.007-3.365l.006-.22-.006-.24-.05-.432-.067-.404a8.844 8.844 0 0 0-1.236-3.08 10.13 10.13 0 0 0-.802-1.096l-1.199 1.48c.154.2.298.406.43.617.483.76.81 1.563.974 2.393l.06.358.032.276.003.086-.007.22-.021.169c-.12.724-.604 1.301-1.19 1.38l-.138.01h-1.77l-.247.008c-1.14.079-2.192.702-2.847 1.7a4.145 4.145 0 0 0-.574 3.156l.068.273.037.13.028.154a.993.993 0 0 1-.118.588.58.58 0 0 1-.248.247l-.07.021-.67.134-.549.085a12.6 12.6 0 0 1-1.657.11 12.18 12.18 0 0 1-3.961-.647 10.426 10.426 0 0 1-3.19-1.734c-.9-.729-1.606-1.57-2.096-2.5a6.38 6.38 0 0 1-.75-2.984c0-1.037.254-2.06.755-3.034.495-.963 1.206-1.839 2.11-2.6A10.494 10.494 0 0 1 7.99 5.235a11.42 11.42 0 0 1 3.41-.677l.538-.01.496.01c1.153.048 2.281.264 3.338.633l1.236-1.526Z\" fill=\"currentColor\"/><path d=\"M6.875 14.466a1.377 1.377 0 0 0-1.374-1.374 1.375 1.375 0 0 0 0 2.747c.758 0 1.374-.616 1.374-1.373ZM8.124 9.47a1.375 1.375 0 0 0-2.748 0 1.374 1.374 0 1 0 2.748 0Zm5.246-1.874a1.374 1.374 0 1 0-2.747-.001 1.374 1.374 0 0 0 2.747 0Z\" fill=\"currentColor\"/></svg>",
  "translate": "<svg viewBox=\"0 0 24 24\" fill=\"none\" aria-hidden=\"true\"><path d=\"M18.656 9.5h1.47a8.504 8.504 0 0 0-16.252 0H1.799c1.122-4.592 5.264-8 10.201-8 4.938 0 9.079 3.408 10.2 8h1.644a.16.16 0 0 1 .156.162.166.166 0 0 1-.046.115l-2.539 2.652a.226.226 0 0 1-.33 0l-2.54-2.652a.167.167 0 0 1 0-.23.152.152 0 0 1 .11-.047Zm-13.312 5h-1.47a8.504 8.504 0 0 0 16.252 0h2.075c-1.122 4.592-5.264 8-10.201 8s-9.079-3.408-10.2-8H.155a.152.152 0 0 1-.11-.048.168.168 0 0 1 0-.23l2.539-2.65a.226.226 0 0 1 .33 0l2.54 2.65a.169.169 0 0 1 .045.116.16.16 0 0 1-.156.162Z\" fill=\"currentColor\"/><path d=\"M13.015 7.5H11.01l-3.51 9h2.016l1.025-2.484H13.4l1.116 2.484H16.5l-3.485-9ZM12.93 12h-1.873l.958-2.52.915 2.52Z\" fill=\"currentColor\"/></svg>",
  "sparkle": "<svg viewBox=\"0 0 18 18\" fill=\"none\" aria-hidden=\"true\"><path d=\"M6.38892 1.96158C6.66161 1.74378 7.05189 1.78674 7.29053 2.04141C7.58896 2.35992 7.53069 2.8744 7.2063 3.16641C5.3975 4.79486 3.21678 8.30799 3.34204 9.95816C3.50307 9.87292 4.29972 9.57076 5.44263 9.57071C7.0904 9.57071 8.32617 10.8656 8.32617 12.5722C8.32604 14.3374 6.91418 15.7493 5.14893 15.7494C3.20691 15.7494 1.5 14.1609 1.5 11.2773C1.5 7.90301 3.8577 3.98398 6.38892 1.96158ZM5.02515 10.9499C4.11388 10.9499 3.375 11.6887 3.375 12.6C3.37506 13.5112 4.11391 14.2502 5.02515 14.2502C5.93632 14.2501 6.67524 13.5112 6.67529 12.6C6.67529 11.6888 5.93635 10.9499 5.02515 10.9499Z\" fill=\"currentColor\"/><path d=\"M14.562 1.96158C14.8347 1.74369 15.2257 1.78669 15.4644 2.04141C15.7627 2.35993 15.7045 2.87443 15.3801 3.16641C13.5713 4.7948 11.3899 8.30794 11.5151 9.95816C11.6761 9.87292 12.4734 9.57071 13.6165 9.57071C15.2642 9.57072 16.5 10.8656 16.5 12.5722C16.4999 14.3375 15.0874 15.7494 13.322 15.7494C11.3801 15.7493 9.67383 14.1608 9.67383 11.2773C9.67383 7.90309 12.0309 3.98402 14.562 1.96158ZM13.2751 10.9499C12.3639 10.9499 11.625 11.6887 11.625 12.6C11.625 13.5112 12.3639 14.2502 13.2751 14.2502C14.1863 14.2501 14.9253 13.5112 14.9253 12.6C14.9253 11.6888 14.1863 10.9499 13.2751 10.9499Z\" fill=\"currentColor\"/></svg>",
  "share-link": "<svg viewBox=\"0 0 24 24\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\" data-icon=\"SharewordsOutlined\"><path d=\"M21.5 5c0-.552-.473-1-1.055-1H3.555C2.974 4 2.5 4.448 2.5 5s.473 1 1.056 1h16.889c.582 0 1.055-.448 1.055-1Zm-9.617 6c.647 0 1.172.448 1.172 1s-.525 1-1.172 1h-8.21c-.648 0-1.173-.448-1.173-1s.525-1 1.173-1h8.21Zm-3.167 7c.648 0 1.173.448 1.173 1s-.525 1-1.173 1H3.673c-.648 0-1.173-.448-1.173-1s.525-1 1.173-1h5.043Zm9.077-8.242a1 1 0 0 1 1.415 0l3.535 3.535a1 1 0 0 1 0 1.415l-3.535 3.535a1 1 0 0 1-1.415-1.414l1.822-1.822c-1.819.07-3.162.64-4.065 1.543-.965.965-1.55 2.435-1.55 4.45a1 1 0 1 1-2 0c0-2.403.706-4.434 2.136-5.864 1.356-1.356 3.251-2.06 5.491-2.13l-1.834-1.834a1 1 0 0 1 0-1.414Z\" fill=\"currentColor\"></path></svg>",
  "block-template": "<svg viewBox=\"0 0 24 24\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\" data-icon=\"TemplateOutlined\"><path d=\"M19.482 14.763a1.99 1.99 0 0 0 .627-.998l2.07-7.727a2 2 0 0 0-1.414-2.45l-7.727-2.07a2 2 0 0 0-2.45 1.414L9.421 7.289a6.5 6.5 0 1 0-1.62 12.705C7.799 21.038 8.635 22 9.804 22h10.392c1.54 0 2.502-1.667 1.732-3l-2.446-4.237Zm.766-9.243-1.935 7.219L16.733 10c-.77-1.333-2.695-1.333-3.465 0l-.966 1.673-1.852-.496 2.07-7.728 7.728 2.071ZM8.75 17.824A4.505 4.505 0 0 1 3 13.5a4.5 4.5 0 0 1 5.903-4.277l-.385 1.436a2 2 0 0 0 1.414 2.45l1.335.357-2.516 4.358ZM15 11l5.196 9H9.804L15 11Z\" fill=\"currentColor\"></path></svg>",
  "block-copy-link": "<svg viewBox=\"0 0 24 24\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\" data-icon=\"BlocklinkOutlined\"><path d=\"M4.15 1.7h14.894a2 2 0 0 1 2 2v2.014h-2V3.7H4.15v14.895h2.543v2H4.15a2 2 0 0 1-2-2V3.7a2 2 0 0 1 2-2Zm17.57 5.954c1.9 1.594 2.296 4.415.703 6.313l-.443.528a1 1 0 1 1-1.532-1.286l.443-.528c.81-.965.687-2.536-.456-3.495-1.142-.959-2.71-.808-3.521.158l-2.487 2.963c-.638.761-.552 2.019.374 2.795l.675.567A1 1 0 1 1 14.19 17.2l-.675-.567c-1.683-1.412-2.04-3.919-.62-5.612l2.487-2.963c1.592-1.899 4.439-2 6.339-.405Zm-5.697 13.942c-1.593 1.898-4.44 1.999-6.34.404-1.9-1.594-2.294-4.415-.702-6.313l.443-.527a1 1 0 1 1 1.532 1.285l-.443.528c-.81.966-.687 2.537.456 3.495 1.143.96 2.711.808 3.521-.158l2.487-2.963c.639-.761.552-2.018-.373-2.795l-.676-.566a1 1 0 1 1 1.286-1.533l.675.567c1.683 1.412 2.04 3.92.62 5.613l-2.486 2.963Z\" fill=\"currentColor\"></path></svg>",
  "block-append": "<svg viewBox=\"0 0 24 24\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\" data-icon=\"NewJoinMeetingOutlined\"><path d=\"M11 8a1 1 0 1 1 2 0v3h3a1 1 0 1 1 0 2h-3v3a1 1 0 1 1-2 0v-3H8a1 1 0 1 1 0-2h3V8Z\" fill=\"currentColor\"></path><path d=\"M2 4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4Zm2 0v16h16V4H4Z\" fill=\"currentColor\"></path></svg>"
}
function iconNode(name, size = 18, className = '') {
  const markup = BLOCK_MENU_ICONS[name] || BLOCK_TYPE_ICONS[name]
  if (!markup) return defaultIconNode(name, size, className)
  const node = document.createElement('span'); node.className = 'lark-doc-icon ' + className
  node.style.width = node.style.height = size + 'px'; node.innerHTML = markup
  return node
}

const ALIGN_ORDER = ['left', 'center', 'right', 'justify']

// 句柄左槽类型图标的边长。飞书 b10-03 实测：左槽 span 22×22、里面 svg 14×14，
// 与右侧 drag-handle（14×14）等重；文件/视频的回形针按飞书给 14，其余类型沿用 18。
const HANDLE_ICON_SIZE = { 'block-attachment': 14 }

const handleIconNode = (name) => iconNode(name, HANDLE_ICON_SIZE[name] || 18, 'lark-doc-block-handle-icon')

/**
 * @param {object} options
 * @param {object} [options.handlers] 全部交互回调（键名与 SFC 里的 `ed.xxx` 一一对应）
 * @param {HTMLElement|null} [options.host] 挂载宿主（`.lark-doc-paper`）
 * @param {HTMLElement|null} [options.anchor] 插入位置锚点（句柄插在它**前面**）
 * @returns {object} `el` / `updateChrome` / `updateMenu` / 若干元素引用 / `destroy`
 */
export function createBlockHandle(options = {}) {
  const handlers = options.handlers || {}
  handlers.onMenuRuntime?.(blockMenuState, openBlockInsertMenu, blockInsertionCurrent, positionBlockMenu)
  const host = options.host || null
  const anchor = options.anchor || null

  const call = (name, ...args) => {
    const fn = handlers[name]
    return typeof fn === 'function' ? fn(...args) : undefined
  }

  // ————————————————— 状态（唯一真相） —————————————————
  // 由于 DOM 不再由 Vue 驱动，state 必须留在本模块里：`updateChrome` 只知道
  // 「菜单开着吗」，`updateMenu` 只知道「句柄是哪种按钮」，而两者都要重排根节点
  // 子节点。合并到一份 state 上才不会互相踩。
  const state = {
    visible: false,
    style: null,
    menuOpen: false,
    alignOpen: false,
    colorOpen: false,
    blockStyle: true,
    buttonKind: 'none',
    glyph: 'T',
    icon: 'block-text',
    isCallout: false,
    draggable: true,
    features: {},
    typeActions: [],
    listActions: [],
    table: false,
    tableHeader: { row: false, column: false },
    canDuplicate: false,
    canAddBelow: false,
    colors: [],
    // 三个菜单容器的定位 style（`position: absolute` 的块菜单 + 两个 `fixed` 子菜单）。
    // 不进 state 就会永远停在 (0,0)：它们是 data 赋值，原生层不感知。
    menuStyle: {},
    alignMenuStyle: {},
    colorMenuStyle: {},
    align: { value: 'left', indent: 0, canIncrease: false },
    alignGlyphs: {},
    alignNames: {},
  }

  // ————————————————— 基础工厂 —————————————————

  /** `@mousedown.prevent` —— 菜单里每个按钮都要，否则按下会抢焦点、菜单当场关掉。 */
  function preventMouseDown(node) {
    node.addEventListener('mousedown', (event) => event.preventDefault())
    return node
  }

  function makeDivider(className) {
    const node = document.createElement('div')
    node.className = className
    node.setAttribute('role', 'separator')
    return node
  }

  /** 菜单里「图标 + 文案」的普通行（模板里 `<lark-doc-icon/><span>` 这个固定搭配）。 */
  function makeIconLabel(icon, size, text, className) {
    const node = document.createElement('span')
    if (className) node.className = className
    node.textContent = text
    return [iconNode(icon, size, 'lark-doc-block-menu-icon'), node]
  }

  // ————————————————— ① 句柄本体 —————————————————

  const el = document.createElement('div')
  el.className = 'lark-doc-block-handle'
  el.addEventListener('mouseenter', (event) => call('onHandleEnter', event))
  el.addEventListener('mouseleave', (event) => call('onHandleLeave', event))

  /**
   * 图标提示。绑在句柄根节点上：块菜单与对齐/颜色子菜单都是它的子节点，
   * 一次委托就覆盖「六点句柄 + 块菜单 + 子菜单」，菜单内容重渲染也不用重绑。
   * 带可见中文名的行（问问AI、对齐项、操作清单）与带 `aria-haspopup` 的触发器按判据不出。
   */
  const tips = bindHoverTips(el)

  // 空段落：句柄换成「＋」，点开的是插入内容命令菜单（不是块菜单）。
  const emptyButton = preventMouseDown(document.createElement('button'))
  emptyButton.type = 'button'
  emptyButton.className = 'lark-doc-empty-block-insert'
  emptyButton.setAttribute('aria-label', '插入内容')
  // ➕ 点开的是插入命令菜单（下一级弹窗）：语义上标 aria-haspopup，
  // bindHoverTips 的 hasNextLevelPopup() 会跳过它；同时不设原生 title，
  // 避免被跳过后浏览器仍弹出原生 tooltip（用户：➕ 号不需要 tips）。
  emptyButton.setAttribute('aria-haspopup', 'menu')
  emptyButton.appendChild(iconNode('plus', 18, 'lark-doc-empty-block-icon'))
  const emptyText = document.createElement('span')
  emptyText.className = 'sr-only'
  emptyText.textContent = '＋'
  emptyButton.appendChild(emptyText)
  emptyButton.addEventListener('mouseenter', (event) => call('openEmptyBlockInsertMenu', event))
  emptyButton.addEventListener('mouseleave', () => call('scheduleCommandMenuClose'))
  emptyButton.addEventListener('click', (event) => call('openEmptyBlockInsertMenu', event))

  const mainButton = document.createElement('button')
  mainButton.type = 'button'
  mainButton.className = 'lark-doc-block-handle-main'
  mainButton.setAttribute('aria-label', '块操作')
  // 句柄自身不出悬停提示（用户：六点句柄不要 tips）。`aria-label` 留着给读屏，
  // 视觉提示靠 `data-tooltip-none` 关掉，也不设原生 `title`（否则浏览器仍会弹灰框）。
  mainButton.setAttribute('data-tooltip-none', '')
  mainButton.setAttribute('draggable', 'true')
  mainButton.addEventListener('mouseenter', (event) => call('openBlockMenuOnHover', event))
  mainButton.addEventListener('focus', (event) => call('openBlockMenuOnHover', event))
  mainButton.addEventListener('click', (event) => call('openBlockMenu', event))
  mainButton.addEventListener('pointerdown', (event) => call('pressHandle', event))
  mainButton.addEventListener('dragstart', (event) => call('startBlockDrag', event))
  mainButton.addEventListener('dragend', (event) => call('endBlockDrag', event))

  const glyphNode = document.createElement('span')
  glyphNode.className = 'lark-doc-block-handle-type'
  let glyphIcon = handleIconNode('block-text')
  glyphIcon.dataset.icon = 'block-text'
  const glyphText = document.createElement('span')
  glyphText.className = 'sr-only'
  glyphText.textContent = 'T'
  glyphNode.appendChild(glyphIcon)
  glyphNode.appendChild(glyphText)
  const dotsNode = document.createElement('span')
  dotsNode.className = 'lark-doc-block-handle-dots'
  dotsNode.setAttribute('aria-hidden', 'true')
  dotsNode.appendChild(iconNode('drag-handle', 14, 'lark-doc-drag-handle-icon'))
  mainButton.appendChild(glyphNode)
  mainButton.appendChild(dotsNode)

  // One menu owner, two explicit targets: the table and its current cell block.
  const secondary = document.createElement('div')
  secondary.className = 'lark-doc-block-handle lark-doc-block-handle-secondary'
  secondary.addEventListener('mouseenter', event => call('onHandleEnter', event))
  secondary.addEventListener('mouseleave', event => call('onHandleLeave', event))
  const secondaryButton = mainButton.cloneNode(true)
  secondaryButton.classList.add('lark-doc-block-handle-extra')
  secondary.appendChild(secondaryButton)
  let secondaryPressed = null
  const activate = event => call('activateSecondary', state.secondary, event)
  secondaryButton.addEventListener('mouseenter', event => {
    if (document.activeElement !== mainButton) activate(event)
  })
  secondaryButton.addEventListener('mousemove', event => {
    if (document.activeElement === mainButton && !event.buttons && (event.movementX || event.movementY)) activate(event)
  })
  secondaryButton.addEventListener('focus', event => {
    if (activate(event)) mainButton.focus({ preventScroll: true })
  })
  secondaryButton.addEventListener('click', activate)
  secondaryButton.addEventListener('pointerdown', event => {
    event.preventDefault(); secondaryPressed = state.secondary
    if (activate(event)) call('pressHandle')
  })
  secondaryButton.addEventListener('dragstart', event => {
    if (call('activateSecondary', secondaryPressed || state.secondary, event)) call('startBlockDrag', event)
    else event.preventDefault()
  })
  secondaryButton.addEventListener('pointerup', () => { secondaryPressed = null })
  secondaryButton.addEventListener('dragend', event => { secondaryPressed = null; call('endBlockDrag', event) })

  // ————————————————— ② 块菜单外壳 —————————————————

  const menuEl = document.createElement('div')
  menuEl.className = 'lark-doc-block-menu'
  menuEl.setAttribute('role', 'menu')
  menuEl.setAttribute('aria-label', '块操作')
  menuEl.addEventListener('mouseenter', () => call('onBlockMenuEnter'))
  menuEl.addEventListener('mouseleave', (event) => call('onBlockMenuLeave', event))
  menuEl.addEventListener('focusin', () => call('onBlockMenuFocusIn'))
  menuEl.addEventListener('focusout', (event) => call('onBlockMenuFocusOut', event))

  const aiButton = preventMouseDown(document.createElement('button'))
  aiButton.type = 'button'
  aiButton.setAttribute('role', 'menuitem')
  aiButton.className = 'lark-doc-block-menu-ai'
  aiButton.setAttribute('aria-label', '问问AI')
  // 「问问AI」语义是**对话**（对着这一块问），与工具栏/气泡的「一次性动作」分开。
  aiButton.addEventListener('click', () => call('emitAiRequest', { action: 'chat' }))
  aiButton.appendChild(iconNode('sparkle', 16, 'lark-doc-block-menu-icon'))
  const aiText = document.createElement('span')
  aiText.textContent = '问问AI'
  aiButton.appendChild(aiText)

  const menuDividerAi = makeDivider('lark-doc-block-menu-divider')

  // 类型网格：6 列，标题按文档已有级别展开，项序即 `blockTypeActions` 顺序（断言逐项比对）。
  const typeSection = document.createElement('div')
  typeSection.className = 'lark-doc-block-menu-section lark-doc-block-type-actions'
  typeSection.setAttribute('role', 'group')
  typeSection.setAttribute('aria-label', '类型转换')
  let typeButtons = []
  let typeSignature = ''

  function syncTypeActions(items) {
    const signature = items.map((item) => [item.id, item.label, item.icon, item.active ? 1 : 0].join('\u0002')).join('\u0001')
    if (signature === typeSignature) return
    typeSignature = signature
    typeButtons.forEach((button) => { if (button.parentNode) button.parentNode.removeChild(button) })
    typeButtons = items.map((item) => {
      const button = preventMouseDown(document.createElement('button'))
      button.type = 'button'
      button.setAttribute('role', 'menuitem')
      button.setAttribute('aria-label', item.label)
      if (item.active) button.classList.add('active')
      button.addEventListener('click', () => call('blockTypeAction', item.id))
      const symbol = document.createElement('span')
      symbol.className = 'lark-doc-block-type-symbol'
      symbol.appendChild(iconNode(item.icon, 18, 'lark-doc-block-type-icon'))
      button.appendChild(symbol)
      const hidden = document.createElement('span')
      hidden.className = 'sr-only'
      hidden.textContent = item.label
      button.appendChild(hidden)
      typeSection.appendChild(button)
      return button
    })
  }

  const menuDividerStyle = makeDivider('lark-doc-block-menu-divider')

  /** 子菜单触发项：「图标 + 文案 + ›」，悬停/聚焦/点击三入口展开（飞书口径）。 */
  function makeSubmenuTrigger(icon, label, onOpen) {
    const button = preventMouseDown(document.createElement('button'))
    button.type = 'button'
    button.setAttribute('role', 'menuitem')
    button.className = 'lark-doc-block-submenu-trigger'
    button.setAttribute('aria-haspopup', 'menu')
    button.setAttribute('aria-expanded', 'false')
    button.setAttribute('aria-label', label)
    button.addEventListener('mouseenter', (event) => onOpen(event))
    button.addEventListener('focus', (event) => onOpen(event))
    button.addEventListener('click', (event) => { event.stopPropagation(); onOpen(event) })
    const [iconEl, textEl] = makeIconLabel(icon, 18, label)
    const arrow = iconNode('block-submenu-arrow', 16, 'lark-doc-block-menu-arrow')
    arrow.setAttribute('aria-hidden', 'true')
    button.appendChild(iconEl)
    button.appendChild(textEl)
    button.appendChild(arrow)
    return button
  }

  const alignTrigger = makeSubmenuTrigger('align-left', '缩进和对齐', (event) => call('openBlockAlignMenuOnHover', event))
  const colorTrigger = makeSubmenuTrigger('palette', '颜色', (event) => call('openBlockColorMenuOnHover', event))

  // ————————————————— ③ 颜色子菜单 —————————————————
  // ⚠️ 与 SFC 一致：它是 `.lark-doc-block-menu` 的**子节点**（夹在两个触发项与
  // 表格组之间），不要「顺手」挪到根上 —— 段序断言按模板顺序量。

  const colorMenu = document.createElement('div')
  colorMenu.className = 'lark-doc-block-submenu lark-doc-block-color-submenu'
  colorMenu.setAttribute('role', 'menu')
  colorMenu.setAttribute('aria-label', '颜色')

  const colorResetButton = preventMouseDown(document.createElement('button'))
  colorResetButton.type = 'button'
  colorResetButton.setAttribute('role', 'menuitem')
  colorResetButton.setAttribute('aria-label', '恢复默认颜色')
  colorResetButton.addEventListener('click', () => call('blockColorAction', ''))
  const resetSwatch = document.createElement('span')
  resetSwatch.className = 'lark-doc-block-color-swatch is-transparent'
  resetSwatch.setAttribute('aria-hidden', 'true')
  const resetText = document.createElement('span')
  resetText.textContent = '恢复默认'
  colorResetButton.appendChild(resetSwatch)
  colorResetButton.appendChild(resetText)

  let colorButtons = []
  // 初值是哨兵而非 `''`：`syncColors([])` 的签名也算出 `''`，用 `''` 当初始值会让
  // 首次调用直接命中「没变」分支 → 常驻的「恢复默认」按钮永远进不了 DOM。
  let colorSignature = '\u0000'

  function syncColors(colors) {
    const signature = colors.map((color) => `${color.value}\u0002${color.label}`).join('\u0001')
    if (signature === colorSignature) return
    colorSignature = signature
    colorButtons.forEach((button) => { if (button.parentNode) button.parentNode.removeChild(button) })
    colorButtons = colors.map((color) => {
      const button = preventMouseDown(document.createElement('button'))
      button.type = 'button'
      button.setAttribute('role', 'menuitem')
      button.setAttribute('aria-label', color.label)
      button.addEventListener('click', () => call('blockColorAction', color.value))
      const swatch = document.createElement('span')
      swatch.className = 'lark-doc-block-color-swatch'
      swatch.setAttribute('aria-hidden', 'true')
      if (color.value) swatch.style.backgroundColor = color.value
      const text = document.createElement('span')
      text.textContent = color.label
      button.appendChild(swatch)
      button.appendChild(text)
      return button
    })
    // 首项固定是「恢复默认」，其余按签名追加
    colorMenu.textContent = ''
    colorMenu.appendChild(colorResetButton)
    colorButtons.forEach((button) => colorMenu.appendChild(button))
  }

  // ————————————————— ④ 表格组 —————————————————

  const tableGroup = document.createElement('div')
  tableGroup.className = 'lark-doc-block-menu-table'
  tableGroup.setAttribute('role', 'group')
  tableGroup.setAttribute('aria-label', '表格设置')

  /** 表格行的两种形态：开关行（menuitemcheckbox + `.lark-doc-menu-switch`）与普通行。 */
  function makeTableRow(spec) {
    const button = preventMouseDown(document.createElement('button'))
    button.type = 'button'
    button.className = 'lark-doc-block-menu-row'
    button.setAttribute('role', spec.role)
    button.setAttribute('aria-label', spec.label)
    button.addEventListener('click', () => call('tableHandleAction', spec.action))
    const [iconEl, textEl] = makeIconLabel(spec.icon, 18, spec.label)
    button.appendChild(iconEl)
    button.appendChild(textEl)
    if (spec.role !== 'menuitemcheckbox') return { button, switchEl: null, switchDot: null }
    button.setAttribute('aria-checked', 'false')
    const switchEl = document.createElement('span')
    switchEl.className = 'lark-doc-menu-switch'
    switchEl.setAttribute('aria-hidden', 'true')
    const switchDot = document.createElement('span')
    switchDot.className = 'lark-doc-menu-switch-dot'
    switchEl.appendChild(switchDot)
    button.appendChild(switchEl)
    return { button, switchEl, switchDot }
  }

  const tableRow = makeTableRow({ role: 'menuitemcheckbox', title: '标题行', label: '标题行', icon: 'table-header-row', action: 'toggleHeaderRow' })
  const tableColumn = makeTableRow({ role: 'menuitemcheckbox', title: '标题列', label: '标题列', icon: 'table-header-col', action: 'toggleHeaderColumn' })
  const tableDistribute = makeTableRow({ role: 'menuitem', title: '均分列宽', label: '均分列宽', icon: 'distribute-cols', action: 'distributeColumns' })
  tableGroup.appendChild(tableRow.button)
  tableGroup.appendChild(tableColumn.button)
  tableGroup.appendChild(tableDistribute.button)

  // ————————————————— ⑤ 操作列表 + 分隔线 + 加正文 —————————————————

  const menuDividerActions = makeDivider('lark-doc-block-menu-divider')
  let listActionButtons = []
  let listActionSignature = ''

  function syncListActions(items) {
    const signature = items.map((item) => `${item.id}\u0002${item.label}\u0002${item.icon}\u0002${!!item.disabled}\u0002${item.hint || ''}`).join('\u0001')
    if (signature === listActionSignature) return
    listActionSignature = signature
    listActionButtons.forEach((button) => { if (button.parentNode) button.parentNode.removeChild(button) })
    listActionButtons = items.map((item) => {
      const button = preventMouseDown(document.createElement('button'))
      button.type = 'button'
      button.setAttribute('role', 'menuitem')
      button.className = 'lark-doc-block-menu-row'
      button.setAttribute('aria-label', item.label)
      setAttr(button, 'aria-description', item.hint || null)
      button.dataset.blockAction = item.id
      button.disabled = !!item.disabled
      button.addEventListener('click', () => { if (!button.disabled) call('blockAction', item.id) })
      const [iconEl, textEl] = makeIconLabel(item.icon, 18, item.label)
      button.appendChild(iconEl)
      button.appendChild(textEl)
      return button
    })
  }

  const menuDividerShare = makeDivider('lark-doc-block-menu-divider')
  const menuDividerFooter = makeDivider('lark-doc-block-menu-divider')

  const addBelowButton = preventMouseDown(document.createElement('button'))
  addBelowButton.type = 'button'
  addBelowButton.setAttribute('role', 'menuitem')
  addBelowButton.className = 'lark-doc-block-menu-row'
  addBelowButton.setAttribute('aria-label', '在下方添加')
  addBelowButton.setAttribute('aria-haspopup', 'menu')
  addBelowButton.setAttribute('aria-expanded', 'false')
  addBelowButton.addEventListener('mouseenter', event => call('openBlockInsertMenu', event))
  addBelowButton.addEventListener('focus', event => call('openBlockInsertMenu', event))
  addBelowButton.addEventListener('click', (event) => call('openBlockInsertMenu', event))
  {
    const [iconEl, textEl] = makeIconLabel('block-append', 18, '在下方添加')
    addBelowButton.appendChild(iconEl)
    addBelowButton.appendChild(textEl)
    addBelowButton.appendChild(iconNode('block-submenu-arrow', 16, 'lark-doc-block-menu-arrow'))
  }

  // Returning to any ordinary parent item dismisses its sibling overlays.
  // The color panel is nested in menuEl; its own controls keep it open.
  function enterMenuItem(event) {
    if (colorMenu.contains(event.target)) return
    const button = event.target.closest('button')
    if (button !== alignTrigger && button !== colorTrigger && (state.alignOpen || state.colorOpen)) call('closeBlockSubmenus')
    if (button !== addBelowButton) call('closeBlockInsertMenu')
  }
  menuEl.addEventListener('mouseover', enterMenuItem)
  menuEl.addEventListener('focusin', enterMenuItem)

  // ————————————————— ⑥ 缩进和对齐子菜单（根的直接子节点） —————————————————

  const alignMenu = document.createElement('div')
  alignMenu.className = 'lark-doc-block-submenu'
  alignMenu.setAttribute('role', 'menu')
  alignMenu.setAttribute('aria-label', '缩进和对齐')

  const alignButtons = ALIGN_ORDER.map((align) => {
    const button = preventMouseDown(document.createElement('button'))
    button.type = 'button'
    button.setAttribute('role', 'menuitem')
    button.setAttribute('aria-pressed', 'false')
    button.addEventListener('click', () => call('blockAlignAction', align))
    const glyph = document.createElement('span')
    glyph.className = 'lark-doc-block-align-glyph'
    glyph.setAttribute('aria-hidden', 'true')
    const text = document.createElement('span')
    const check = document.createElement('span')
    check.className = 'lark-doc-block-align-check'
    check.setAttribute('aria-hidden', 'true')
    check.appendChild(iconNode('check', 16, 'lark-doc-align-check-icon'))
    const checkText = document.createElement('span')
    checkText.className = 'sr-only'
    checkText.textContent = '✓'
    check.appendChild(checkText)
    button.appendChild(glyph)
    button.appendChild(text)
    button.appendChild(check)
    return { align, button, glyph, text, check }
  })

  const alignDivider = makeDivider('lark-doc-block-submenu-divider')

  const indentMoreButton = preventMouseDown(document.createElement('button'))
  indentMoreButton.type = 'button'
  indentMoreButton.setAttribute('role', 'menuitem')
  indentMoreButton.addEventListener('click', () => call('blockAlignAction', 'increaseIndent'))
  const indentMoreGlyph = document.createElement('span')
  indentMoreGlyph.className = 'lark-doc-block-align-glyph'
  indentMoreGlyph.setAttribute('aria-hidden', 'true')
  indentMoreGlyph.appendChild(iconNode('indent-inc', 18, 'lark-doc-block-align-icon'))
  const indentMoreText = document.createElement('span')
  indentMoreText.textContent = '增加缩进'
  const indentMoreHelp = document.createElement('span')
  indentMoreHelp.className = 'lark-doc-block-align-help'
  indentMoreHelp.setAttribute('aria-label', '已达到最大缩进')
  indentMoreHelp.textContent = '?'
  indentMoreButton.appendChild(indentMoreGlyph)
  indentMoreButton.appendChild(indentMoreText)
  indentMoreButton.appendChild(indentMoreHelp)

  const indentLessButton = preventMouseDown(document.createElement('button'))
  indentLessButton.type = 'button'
  indentLessButton.setAttribute('role', 'menuitem')
  indentLessButton.addEventListener('click', () => call('blockAlignAction', 'decreaseIndent'))
  const indentLessGlyph = document.createElement('span')
  indentLessGlyph.className = 'lark-doc-block-align-glyph'
  indentLessGlyph.setAttribute('aria-hidden', 'true')
  indentLessGlyph.appendChild(iconNode('indent-dec', 18, 'lark-doc-block-align-icon'))
  const indentLessText = document.createElement('span')
  indentLessText.textContent = '减少缩进'
  indentLessButton.appendChild(indentLessGlyph)
  indentLessButton.appendChild(indentLessText)

  // 对齐子菜单内部结构（**全静态**，建一次即可）：4 项对齐 → 分隔线 → 增加/减少缩进。
  // 顺序与 SFC 模板逐段一致；`alignDivider` 无条件存在（模板里没有 `v-if`）。
  syncChildren(alignMenu, [
    ...alignButtons.map((entry) => ({ node: entry.button, on: true })),
    { node: alignDivider, on: true },
    { node: indentMoreButton, on: true },
    { node: indentLessButton, on: true },
  ])

  // ————————————————— 渲染 —————————————————

  /** 根节点子节点序：空段按钮 → 主句柄 → 块菜单 → 对齐子菜单（模板顺序）。 */
  function renderRoot() {
    if (!el.parentNode && state.visible && host) host.insertBefore(el, anchor || null)
    if (el.parentNode && !state.visible) el.parentNode.removeChild(el)
    if (secondary.parentNode && (!state.visible || !state.secondary)) secondary.remove()
    if (!state.visible) return
    setAttr(mainButton, 'data-block-scope', state.scope)
    if (state.secondary) {
      const target = state.secondary
      applyStyle(secondary, target.style)
      setAttr(secondaryButton, 'data-block-scope', target.scope)
      setAttr(secondaryButton, 'aria-label', target.scope === 'table' ? '整表块操作' : '单元格块操作')
      setAttr(secondaryButton, 'draggable', String(!!state.draggable))
      const glyph = secondaryButton.querySelector('.lark-doc-block-handle-type')
      if (glyph.dataset.icon !== target.icon) { glyph.textContent = ''; glyph.appendChild(handleIconNode(target.icon)); glyph.dataset.icon = target.icon }
      if (!secondary.parentNode && host) host.insertBefore(secondary, anchor || null)
    }
    el.classList.toggle('is-menu-open', !!state.menuOpen)
    applyStyle(el, state.style)
    syncChildren(el, [
      { node: emptyButton, on: state.buttonKind === 'empty' },
      { node: mainButton, on: state.buttonKind === 'main' },
      { node: menuEl, on: !!state.menuOpen },
      // `v-if="blockAlignMenuOpen && featureEnabled('blockStyle')"` —— 门控在 state 里折好
      { node: alignMenu, on: !!state.alignOpen },
    ])
  }

  function renderMenu() {
    const features = state.features || {}
    const blockStyle = features.blockStyle !== false
    applyStyle(menuEl, state.menuStyle)
    applyStyle(alignMenu, state.alignMenuStyle)
    applyStyle(colorMenu, state.colorMenuStyle)
    setAttr(alignTrigger, 'aria-expanded', state.alignOpen ? 'true' : 'false')
    setAttr(colorTrigger, 'aria-expanded', state.colorOpen ? 'true' : 'false')
    setAttr(addBelowButton, 'aria-expanded', state.insertOpen ? 'true' : 'false')

    syncTypeActions(state.typeActions)
    syncColors(state.colors)
    syncListActions(state.listActions.filter(item => !['duplicate', 'moveUp', 'moveDown'].includes(item.id)))

    // Remove a closed conditional slot first, leaving focused following rows in place.
    if (!state.colorOpen) colorMenu.remove()
    syncChildren(menuEl, [
      { node: aiButton, on: features.ai !== false },
      { node: menuDividerAi, on: features.ai !== false },
      { node: typeSection, on: state.typeActions.length > 0 && !state.table },
      { node: menuDividerStyle, on: !state.table },
      { node: alignTrigger, on: blockStyle && !state.table },
      { node: colorTrigger, on: blockStyle && !state.table },
      { node: colorMenu, on: !!state.colorOpen && blockStyle },
      { node: tableGroup, on: !!state.table && features.tables !== false },
      { node: menuDividerActions, on: state.listActions.length > 0 },
      ...listActionButtons.flatMap(node => ['share', 'saveTemplate', 'copyLink'].includes(node.dataset.blockAction) && node === listActionButtons.find(button => ['share', 'saveTemplate', 'copyLink'].includes(button.dataset.blockAction)) ? [{ node: menuDividerShare, on: true }, { node, on: true }] : [{ node, on: true }]),
      { node: menuDividerFooter, on: blockStyle },
      { node: addBelowButton, on: !!state.canAddBelow },
    ])

    // 表格开关：`aria-checked` 与 `.lark-doc-menu-switch.on` 同步（点完立刻能看到翻转）
    setAttr(tableRow.button, 'aria-checked', String(!!(state.tableHeader || {}).row))
    setAttr(tableColumn.button, 'aria-checked', String(!!(state.tableHeader || {}).column))
    tableRow.switchEl.classList.toggle('on', !!(state.tableHeader || {}).row)
    tableColumn.switchEl.classList.toggle('on', !!(state.tableHeader || {}).column)

    // 对齐子菜单
    const alignName = state.alignNames || {}
    const align = state.align || { value: 'left', indent: 0, canIncrease: false }
    alignButtons.forEach((entry) => {
      const active = align.value === entry.align
      const alignIcon = `align-${entry.align}`
      const nextIcon = entry.glyph.dataset.icon
      if (nextIcon !== alignIcon) {
        const svg = iconNode(alignIcon, 18, 'lark-doc-block-align-icon')
        svg.dataset.icon = alignIcon
        entry.glyph.textContent = ''
        entry.glyph.appendChild(svg)
        entry.glyph.dataset.icon = alignIcon
      }
      entry.text.textContent = `${alignName[entry.align] || entry.align}对齐`
      entry.button.classList.toggle('active', active)
      setAttr(entry.button, 'aria-pressed', String(active))
      syncChildren(entry.button, [
        { node: entry.glyph, on: true },
        { node: entry.text, on: true },
        { node: entry.check, on: active },
      ])
    })
    indentMoreButton.disabled = !align.canIncrease
    indentLessButton.disabled = !(align.indent > 0)
    syncChildren(indentMoreButton, [
      { node: indentMoreGlyph, on: true },
      { node: indentMoreText, on: true },
      { node: indentMoreHelp, on: !align.canIncrease },
    ])
  }

  // ————————————————— 对外 —————————————————

  /**
   * 句柄本体（`pointermove` 热路径）。**不碰菜单内容** —— 见文件头。
   * @param {object} patch
   */
  function updateChrome(patch) {
    Object.assign(state, patch || {})
    if (patch && patch.glyph !== undefined && glyphNode.textContent !== String(state.glyph)) {
      glyphText.textContent = String(state.glyph)
    }
    if (patch && patch.icon !== undefined && glyphIcon.dataset.icon !== state.icon) {
      const svg = handleIconNode(state.icon || 'block-text')
      svg.dataset.icon = state.icon || 'block-text'
      glyphNode.replaceChild(svg, glyphIcon)
      glyphIcon = svg
    }
    if (patch && patch.isCallout !== undefined) mainButton.classList.toggle('is-callout', !!state.isCallout)
    if (patch && patch.draggable !== undefined) setAttr(mainButton, 'draggable', String(!!state.draggable))
    renderRoot()
  }

  /**
   * 菜单内容（开合、类型网格、颜色、表格开关、对齐）。所有字段一次推平。
   * @param {object} patch
   */
  function updateMenu(patch) {
    Object.assign(state, patch || {})
    renderRoot()
    renderMenu()
    // 菜单收起时提示一并收掉；否则提示会挂在已被移出文档的锚点旁边。
    if (!state.menuOpen) tips.hide()
  }

  let lastMenu = null

  return {
    el,
    updateChrome,
    updateMenu,
    update(patch) {
      if (patch.chrome) updateChrome(patch.chrome)
      if (patch.menu && patch.menu !== lastMenu) { lastMenu = patch.menu; updateMenu(patch.menu) }
    },
    // 定位要用的节点引用：调用方以前靠 `querySelector` 反查，原生层直接给。
    get mainEl() { return mainButton },
    get menuEl() { return menuEl },
    get alignMenuEl() { return alignMenu },
    get colorMenuEl() { return colorMenu },
    get alignTrigger() { return alignTrigger },
    get colorTrigger() { return colorTrigger },
    destroy() {
      tips.destroy()
      secondary.remove()
      if (el.parentNode) el.parentNode.removeChild(el)
    },
  }
}

/** Menu presentation state loads with the menu, not the editor startup. */
function blockMenuState() {
      const blockStyle = this.featureEnabled('blockStyle')
      return {
        menuOpen: this.blockMenuOpen,
        insertOpen: !!this._blockInsertContext && this.menuOpen,
        alignOpen: !!this.blockAlignMenuOpen && blockStyle,
        colorOpen: !!this.blockColorMenuOpen && blockStyle,
        blockStyle,
        features: {
          ai: this.featureEnabled('ai'),
          blockStyle,
          tables: this.featureEnabled('tables'),
        },
        typeActions: (this.blockTypeTextRange(this.handleRange) ? this.visibleBlockTypeActions : []).map((item) => ({
          id: item.id,
          label: item.label,
          icon: item.icon,
          active: this.blockTypeActive(item.id),
        })),
        listActions: [
          // 没接评论服务时整项不出现 —— 渲染成 disabled 等于把「这个文档不支持评论」
          // 一直摆在用户面前，比没有入口更糟（用户要求：没接入就先隐藏 UI）。
          ...(this.isBlockActionEnabled('comment') && this.commentEntryVisible ? [{ id: 'comment', label: '评论', icon: 'mode-comment', disabled: !this.commentEntryAvailable, hint: this.commentEntryAvailable ? '' : '当前文档暂不支持评论' }] : []),
          ...this.visibleBlockListActions.map((item) => ({ id: item.id, label: item.label, icon: item.icon })),
          ...(this.selectionShareAllowed?.() && this.isBlockActionEnabled('share') ? [{ id: 'share', label: '分享', icon: 'share-link' }] : []),
          ...(this.featureEnabled('templates') && this.isBlockActionEnabled('saveTemplate') ? [{ id: 'saveTemplate', label: '保存为模板', icon: 'block-template', disabled: !this.templateSaveAllowed(), hint: this.templateSaveAllowed() ? '' : typeof this.onSaveTemplate === 'function' ? '当前权限无法保存模板' : '当前应用未配置模板保存' }] : []),
          ...(this.shareCan('canView') && this.isBlockActionEnabled('copyLink') ? [{ id: 'copyLink', label: '复制链接', icon: 'block-copy-link' }] : []),
        ],
        table: this.handleIsTable,
        tableHeader: this.handleTableHeaderState(),
        canAddBelow: this.featureEnabled('insert') && this.isBlockActionEnabled('addBelow'),
        menuStyle: this.blockMenuStyle,
        alignMenuStyle: this.blockAlignMenuStyle,
        colorMenuStyle: this.blockColorMenuStyle,
        colors: this.colorPaletteOptions.map((color) => ({ value: color.value, label: color.label })),
        align: {
          value: this.blockAlignValue(),
          indent: this.blockAlignIndent(),
          canIncrease: this.blockAlignCanIncrease(),
        },
        alignGlyphs: this.alignGlyphs,
        alignNames: this.alignNames,
      }
}

function openBlockInsertMenu(event) {
      if (!this.writable() || !this.featureEnabled('insert') || !this.isBlockActionEnabled('addBelow')) return false
      if (this._blockInsertContext && this.menuOpen) return true
      const range = this.handleActionRange(), editor = this.editor
      if (!range) return false
      this.blockAlignMenuOpen = this.blockColorMenuOpen = false
      this.blockAlignMenuStyle = this.blockColorMenuStyle = {}
      this._blockInsertContext = { editor, doc: editor.state.doc, session: this.session, documentId: this.documentId, sessionDocumentId: this.session?.documentId, range }
      this.openCommandMenu('plus', event)
      const rect = event?.currentTarget?.getBoundingClientRect?.()
      if (rect) { this.menuAnchor = { left: rect.right + 6, top: rect.top, bottom: rect.top }; this.menuTrigger = null }
      this.$nextTick(() => this.positionCommandMenu())
      return true
}

function blockInsertionCurrent(append) {
      return this.editor === append.editor && !append.editor.isDestroyed && append.doc === this.editor.state.doc && append.session === this.session && append.documentId === this.documentId && append.sessionDocumentId === this.session?.documentId && this.isBlockActionEnabled('addBelow')
}

function positionBlockMenu(selector) {
      this.$nextTick(() => {
        const handle = this.$refs.root?.querySelector('.lark-doc-block-handle')
        const menu = handle?.querySelector(selector)
        if (!handle || !menu) return
        const handleRect = handle.getBoundingClientRect()
        const menuRect = menu.getBoundingClientRect()
        const content = this.$refs.root?.querySelector('.lark-doc-editor-content, .ProseMirror')
        const contentRect = content?.getBoundingClientRect?.() || handleRect
        const otherRect = this.$refs.root?.querySelector('.lark-doc-block-handle-secondary')?.getBoundingClientRect()
        const viewportGap = 8
        const menuWidth = menuRect.width || 230
        const maxViewportLeft = Math.max(viewportGap, window.innerWidth - menuWidth - viewportGap)
        const preferredViewportLeft = (otherRect ? Math.min(contentRect.left, handleRect.left, otherRect.left) : contentRect.left) - menuWidth - viewportGap
        const menuViewportLeft = preferredViewportLeft >= viewportGap && preferredViewportLeft <= maxViewportLeft
          ? preferredViewportLeft
          : Math.min(Math.max(viewportGap, Math.max(handleRect.right, otherRect?.right || handleRect.right) + viewportGap), maxViewportLeft)
        const top = handleRect.top
        const below = Math.max(0, window.innerHeight - top - 40)
        const above = Math.max(0, top - 8)
        const useAbove = below < menu.scrollHeight && above > below
        const available = Math.max(32, useAbove ? above : below)
        this.blockMenuStyle = {
          left: `${Math.round(menuViewportLeft - handleRect.left)}px`,
          top: useAbove ? `${-Math.min(menu.scrollHeight, available) - 8}px` : '32px',
          maxHeight: `${available}px`,
        }
      })
    }
