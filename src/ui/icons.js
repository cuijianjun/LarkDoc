/**
 * 工具栏 SVG 图标库：16×16、stroke 使用 currentColor（自动跟随激活态变色）、
 * 圆角线帽，风格对齐飞书扁平线性图标。由 `src/ui/icon.js` 统一渲染，禁止直接内嵌
 * 到模板字符串里拼 HTML。
 */
// 多色图标资源（唯一不用 currentColor 的地方）走色板常量表，见 palette.js（T0-04）。
import { ICON_PALETTE } from './palette'

const S = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"'
const wrap = (inner, extra = '') => `<svg ${S} ${extra}>${inner}</svg>`

export const ICONS = {
  'share-embed-compass': '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="6.75" stroke="currentColor" stroke-width="1.25"/><path d="m11.15 4.85-1.94 4.36-4.36 1.94 1.94-4.36 4.36-1.94Z" fill="currentColor"/></svg>',
  // Vector redrawn from the source's unsupported-preview raster, not an embedded screenshot.
  'share-unsupported-illustration': '<svg viewBox="0 0 150 140" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M9 55C3.1 58 0 63 0 70.5v12C0 74.7 3.2 70 9 67V55Zm124 34c10.8 5.5 16 12 16 19.5V120c0-7.1-5.6-13.2-16-18.9V89Z" fill="rgb(12,41,110)"/>' +
    '<path d="M70 47V31C70 13.2 83.4 0 100.5 0 119.2 0 133 15.7 133 34.2V48L70 47Z" fill="rgb(12,41,110)"/>' +
    '<path d="M76.1 14.5c-2.1 5.9-3.8 12-4.9 18.3l-6.5 9h4.4v5.6h22.7c.9-4.8 4.4-5.6 9.4-6.2 5.3-.6 8.4-4.5 6.4-8.1-1.8-3.3-5.4-3.4-8.7-.7-8.4-4.2-16.2-10.8-22.8-17.9Z" fill="rgb(255,255,255)" stroke="rgb(12,41,110)" stroke-width="1.25" stroke-linejoin="round"/>' +
    '<path d="M77.2 30.6c-.1 5.1 3.4 7.3 7.7 3.6" stroke="rgb(12,41,110)" stroke-width="1.25" stroke-linecap="round"/>' +
    '<path d="M14 30h29.8l15.8 16H127a6 6 0 0 1 6 6v87H14a5 5 0 0 1-5-5V35a5 5 0 0 1 5-5Z" fill="rgb(224,226,228)"/>' +
    '<circle cx="23" cy="42" r="3.3" stroke="rgb(143,149,158)" stroke-width="1.4"/><circle cx="36.5" cy="42" r="3.3" stroke="rgb(143,149,158)" stroke-width="1.4"/>' +
    '<path d="M47 78c6.4 11.2 15.5 17.4 27.5 17.4 12.1 0 21.2-6.2 27.5-17.4M45.6 93l7.2-7.1m43.6 0 7.2 7.1m-29.1 2.4v9.9" stroke="rgb(12,41,110)" stroke-width="1.25" stroke-linecap="round"/>' +
    '<path d="M0 70.5c0 9 12.2 15.9 32 20.5v12C11.2 98.5 0 91.2 0 82.5v-12Z" fill="var(--ld-brand-chrome)"/>' +
    '<path d="M3.5 104.5c12.9 9.6 29.5 15.5 48.7 18.6v10.2C32 130 15.1 123.8 3.5 116v-11.5Z" fill="rgb(255,255,255)" stroke="rgb(12,41,110)" stroke-width="1.25"/>' +
    '<path d="M90 128h38.3c10.1 0 17.1-4.1 20.7-10v10c-2 7.4-9.2 11-21.1 11H90v-11Z" fill="var(--ld-brand-chrome)"/></svg>',
  'comment-history-info': '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0 2C5.925 23 1 18.075 1 12S5.925 1 12 1s11 4.925 11 11-4.925 11-11 11Zm-1-7.5v-4a1 1 0 1 1 0-2h1.004c.55 0 .998.445.998.996.003 1.668-.002 3.336-.002 5.004h.5a1 1 0 1 1 0 2h-3a1 1 0 1 1 0-2h.5Zm1-7a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" fill="currentColor"/></svg>',
  'comment-history-empty': '<svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M103.587 73.962V64c5.142 1.573 10.804 3.656 12.077 6.592.176.4.262.796.262 1.184h.002v5.856c0-.388-.088-.785-.262-1.185-.108-.246-.249.29-.423.949-.241.912-.544 2.062-.908 1.707-.618-.606-1.43-1.23-2.408-1.857-1.983-1.27-5.114-2.34-8.34-3.284ZM22.423 35.486v8.518c-8.445-2.616-17.634-6.317-17.634-10.67V22.628c0 7.267 9.214 10.845 17.634 12.86Z" fill="var(--ld-text)"/><path d="M4.788 33.63c0-.075.001-.15.005-.226.288-6.747 14.759-13.693 19.854-14.66V9.836c-4.376.83-19.86 7.503-19.86 13.906v9.889Z" fill="var(--ld-text-check)"/><path d="M103.587 26.174a4 4 0 0 0-4-4H26.423a4 4 0 0 0-4 4V72.48a4 4 0 0 0 4 4h66.261l10.903 10.507V26.174Z" fill="var(--ld-text-disabled)" fill-opacity=".45"/><path d="M33.508 37.654a.5.5 0 0 1 .5-.5h46.814a.5.5 0 0 1 0 1H34.008a.5.5 0 0 1-.5-.5Zm0 10.52a.5.5 0 0 0 .5.5h27.1a.5.5 0 1 0 0-1h-27.1a.5.5 0 0 0-.5.5Z" fill="var(--ld-text-icon)"/><path d="M100.759 35.023c6.373 0 11.54-5.167 11.54-11.541 0-6.374-5.167-11.54-11.54-11.54-6.374 0-11.541 5.166-11.541 11.54 0 6.374 5.167 11.54 11.541 11.54Z" fill="var(--ld-brand-chrome)"/><path d="M11.45 67.418v28.593a.5.5 0 0 0 .845.361l5.043-4.82h31.231a2.5 2.5 0 0 0 2.5-2.5V67.418a2.5 2.5 0 0 0-2.5-2.5H13.95a2.5 2.5 0 0 0-2.5 2.5Zm2.5-1.5h34.62a1.5 1.5 0 0 1 1.5 1.5v21.633a1.5 1.5 0 0 1-1.5 1.5H17.136a.5.5 0 0 0-.345.139l-4.342 4.151V67.418a1.5 1.5 0 0 1 1.5-1.5Z" fill="var(--ld-text)"/><path d="M115.928 71.686c-.061 8.424-34.561 13.433-54.424 14.171v9.09c20.95-.576 54.424-5.725 54.424-13.466v-9.795Z" fill="var(--ld-text-check)"/><path d="M57.415 111.165v-9.088c14.542-.532 36.808-3.283 48.133-7.933v9.453c-11.09 4.389-32.867 7.156-48.133 7.568Z" fill="var(--ld-brand-chrome)"/><path d="M52.122 12.786V3.938C41.949 4.545 38.111 5.96 32.247 7.8v9.092c5.823-1.572 10.217-2.94 19.875-4.106Z" fill="var(--ld-text-check)"/></svg>',
  'table-insert-boundary': '<svg viewBox="0 0 22 24" fill="none"><path d="M16.153 20.721A10.999 10.999 0 0022 11c0-6.075-4.925-11-11-11S0 4.925 0 11c0 4.213 2.369 7.873 5.847 9.721L11 24l5.153-3.279z" fill="currentColor"/><path d="M10.45 6a.2.2 0 00-.2.2v4.05H6.2a.2.2 0 00-.2.2v1.1c0 .11.09.2.2.2h4.05v4.05c0 .11.09.2.2.2h1.1a.2.2 0 00.2-.2v-4.05h4.05a.2.2 0 00.2-.2v-1.1a.2.2 0 00-.2-.2h-4.05V6.2a.2.2 0 00-.2-.2h-1.1z" fill="var(--ld-table-plus-fg)"/></svg>',
  'comment-reaction': '<svg viewBox="0 0 14 14" fill="currentColor"><path d="M1.75 12.833h-.583a.29.29 0 0 1-.292-.291V4.958a.292.292 0 0 1 .292-.291h.583a.292.292 0 0 1 .292.291v7.584a.292.292 0 0 1-.292.291zm7-8.167h2.501c1.74 0 2.14 1.536 1.74 2.688l-1.74 4.582a1.237 1.237 0 0 1-1.196.902H3.204a.293.293 0 0 1-.292-.291v-7.59a.292.292 0 0 1 .292-.291h.6a.583.583 0 0 0 .477-.248L6.702.973c.164-.26.607-.46 1.078-.246.708.322 1.554 1.025 1.554 2.19 0 .44-.195 1.023-.585 1.749z"/></svg>',
  'comment-reply': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.25 19.511 13.5 22.5c-.401.438-.957.68-1.5.68s-.967-.137-1.523-.68L7.75 19.511 3 19.5c-1.1-.011-2-.9-2-2v-13c0-1.1.9-2 2-2h18c1.1 0 2 .9 2 2v13c0 1.1-.9 1.989-2 2l-4.75.011ZM5.5 10.5v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1a1 1 0 0 0-1-1h-1a1 1 0 0 0-1 1Zm6-1a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1a1 1 0 0 0-1-1h-1Zm5 0a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1a1 1 0 0 0-1-1h-1Z"/></svg>',
  'image-crop': wrap('<path d="M4 1v11h11M1 4h11v11M7 4h5v5"/>'),
  'link-unset': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m3 3 18 18M10 7l2-2a5 5 0 0 1 7 7l-2 2M14 17l-2 2a5 5 0 0 1-7-7l2-2M9 15l6-6"/></svg>',
  'link-view-title': '<svg viewBox="0 0 24 24" fill="none"><path d="M2 11a1 1 0 1 0 0 2h2a1 1 0 1 0 0-2H2Zm6 0a1 1 0 1 0 0 2h14a1 1 0 1 0 0-2H8Z" fill="currentColor"></path></svg>',
  'link-view-link': '<svg viewBox="0 0 24 24" fill="none"><path d="M18.849 2.699a5.037 5.037 0 0 0-7.1.97L8.97 7.372a4.784 4.784 0 0 0 .957 6.699l.972.729a1 1 0 0 0 1.2-1.6l-.972-.73a2.784 2.784 0 0 1-.557-3.898l2.777-3.703a3.037 3.037 0 1 1 4.8 3.72l-1.429 1.786a1 1 0 1 0 1.562 1.25l1.43-1.788a5.037 5.037 0 0 0-.862-7.138Z" fill="currentColor"></path><path d="M5.152 21.301a5.037 5.037 0 0 0 7.1-.97l2.777-3.703a4.784 4.784 0 0 0-.957-6.699L13.1 9.2a1 1 0 0 0-1.2 1.6l.973.73a2.784 2.784 0 0 1 .556 3.898l-2.777 3.703a3.037 3.037 0 1 1-4.8-3.72l1.429-1.786a1 1 0 0 0-1.562-1.25l-1.43 1.787a5.037 5.037 0 0 0 .863 7.14Z" fill="currentColor"></path></svg>',
  'link-view-card': '<svg viewBox="0 0 24 24" fill="none"><path d="M3 7.5h18c.552 0 1 .424 1 .948v7.104c0 .524-.448.948-1 .948H3c-.552 0-1-.424-1-.947V8.447c0-.524.448-.948 1-.948Zm1 2v5h16v-5H4ZM2.5 19h19c.275 0 .5.225.5.5v1c0 .275-.225.5-.5.5h-19a.501.501 0 0 1-.5-.5v-1c0-.275.225-.5.5-.5Zm0-16h19c.275 0 .5.225.5.5v1c0 .275-.225.5-.5.5h-19a.501.501 0 0 1-.5-.5v-1c0-.275.225-.5.5-.5Z" fill="currentColor"></path></svg>',
  'link-view-more': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="3" width="6" height="6" rx=".7"/><rect x="3" y="15" width="6" height="6" rx=".7"/><rect x="15" y="15" width="6" height="6" rx=".7"/><path d="m18 2 4 5-4 5-4-5Z"/></svg>',

  undo: wrap('<path d="M6.5 3.5 3 7l3.5 3.5"/><path d="M3 7h6.5a3.5 3.5 0 0 1 0 7H7"/>'),
  redo: wrap('<path d="M9.5 3.5 13 7l-3.5 3.5"/><path d="M13 7H6.5a3.5 3.5 0 0 0 0 7H9"/>'),
  inlineCode: wrap('<path d="M5.5 4 2 8l3.5 4"/><path d="M10.5 4 14 8l-3.5 4"/><path d="M9 3 7 13"/>'),
  link: wrap('<path d="M6.5 9.5l3-3"/><path d="M4.8 7.7 3.2 9.3a2.6 2.6 0 0 0 3.7 3.7l1.6-1.6"/><path d="M11.2 8.3l1.6-1.6a2.6 2.6 0 0 0-3.7-3.7L7.5 4.6"/>'),
  'align-left': wrap('<path d="M2.5 4h11"/><path d="M2.5 8h7"/><path d="M2.5 12h9"/>'),
  'align-center': wrap('<path d="M2.5 4h11"/><path d="M4.5 8h7"/><path d="M3.5 12h9"/>'),
  'align-right': wrap('<path d="M2.5 4h11"/><path d="M6.5 8h7"/><path d="M4.5 12h9"/>'),
  'align-justify': wrap('<path d="M2.5 4h11"/><path d="M2.5 8h11"/><path d="M2.5 12h11"/>'),
  'indent-dec': wrap('<path d="M3 4h10"/><path d="M3 12h10"/><path d="M13 8H6.5"/><path d="m9 5.5-2.5 2.5L9 10.5"/>'),
  'indent-inc': wrap('<path d="M3 4h10"/><path d="M3 12h10"/><path d="M6.5 8H13"/><path d="m10.5 5.5 2.5 2.5-2.5 2.5"/>'),
  clear: wrap('<path d="M3 13.5h10"/><path d="M5.5 13.5 3.2 11.2a1.6 1.6 0 0 1 0-2.3l5.4-5.4a1.6 1.6 0 0 1 2.3 0l2.1 2.1a1.6 1.6 0 0 1 0 2.3l-5.6 5.6"/><path d="M6.5 5.5l4 4"/>'),
  plus: wrap('<path d="M8 3v10"/><path d="M3 8h10"/>'),
  table: wrap('<rect x="2.8" y="2.8" width="10.4" height="10.4" rx="1.4"/><path d="M2.8 8h10.4"/><path d="M8 2.8v10.4"/>'),
  chart: wrap('<rect x="2.8" y="2.8" width="10.4" height="4" rx="1.2"/><rect x="2.8" y="9.2" width="10.4" height="4" rx="1.2"/><path d="M5.5 4.8h.01M5.5 11.2h.01" stroke-width="1.8"/>'),
  sparkle: wrap('<path d="M8 2l1.4 4.1L13.5 7.5 9.4 8.9 8 13 6.6 8.9 2.5 7.5 6.6 6.1z" fill="currentColor" stroke="none"/><path d="M12.5 11.5l.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5z" fill="currentColor" stroke="none"/>'),
  search: wrap('<circle cx="7" cy="7" r="4.4"/><path d="m10.4 10.4 3.4 3.4"/>'),
  outline: wrap('<path d="M3 4h10"/><path d="M3 8h10"/><path d="M3 12h6"/>'),
  reading: wrap('<path d="M8 5.2A2.2 2.2 0 0 0 5.8 3H2.8v9.5h3.4A1.8 1.8 0 0 1 8 13.7"/><path d="M8 5.2A2.2 2.2 0 0 1 10.2 3h3v9.5h-3.4A1.8 1.8 0 0 0 8 13.7"/>'),
  fullscreen: wrap('<path d="M2.5 6V3.9a1.4 1.4 0 0 1 1.4-1.4H6"/><path d="M10 2.5h2.1a1.4 1.4 0 0 1 1.4 1.4V6"/><path d="M13.5 10v2.1a1.4 1.4 0 0 1-1.4 1.4H10"/><path d="M6 13.5H3.9a1.4 1.4 0 0 1-1.4-1.4V10"/>'),
  slides: wrap('<rect x="2.5" y="3" width="11" height="7.6" rx="1.3"/><path d="M7 5.6 9.6 6.8 7 8z" fill="currentColor" stroke="none"/><path d="M8 10.6v2"/><path d="M5.6 13h4.8"/>'),
  chevronDown: wrap('<path d="m4.2 6.2 3.8 3.8 3.8-3.8"/>'),
  // 实心小三角：下拉触发器尾部的「▾」（飞书菜单用实心，比 chevron 更紧凑）
  caretSolid: wrap('<path d="M4.6 6.2h6.8L8 10.7z" fill="currentColor" stroke="none"/>'),
  chevronUp: wrap('<path d="m4.2 9.8 3.8-3.8 3.8 3.8"/>'),
  close: wrap('<path d="m4.6 4.6 6.8 6.8"/><path d="m11.4 4.6-6.8 6.8"/>'),
  // 编号菜单三项：对齐飞书（编号类图标都是「1.」+ 动作符号的组合，不是抽象线条）。
  // 左半是数字「1.」（text 用 currentColor 填充、去掉描边），右半是动作符号，两半互不重叠：
  // 继续=右向箭头、重新开始=逆时针回环、设置值=输入框+光标。
  'numbered-continue': wrap('<text x="4" y="10.8" fill="currentColor" stroke="none" font-family="Helvetica, Arial, sans-serif" font-size="8" font-weight="600" text-anchor="middle">1.</text><path d="M9.2 8h5"/><path d="m12.2 5.9 2.1 2.1-2.1 2.1"/>'),
  'numbered-restart': wrap('<text x="4" y="10.8" fill="currentColor" stroke="none" font-family="Helvetica, Arial, sans-serif" font-size="8" font-weight="600" text-anchor="middle">1.</text><path d="M9.2 8a2.6 2.6 0 1 0 2.6-2.6"/><path d="m12.9 4.2-1.1 1.2 1.2 1.1"/>'),
  'numbered-value': wrap('<text x="4" y="10.8" fill="currentColor" stroke="none" font-family="Helvetica, Arial, sans-serif" font-size="8" font-weight="600" text-anchor="middle">1.</text><rect x="9" y="4.8" width="5.8" height="6.4" rx="1.3"/><path d="M11.2 6.7v2.6"/>'),
  // —— 块菜单类型网格（对齐飞书：正文/标题是文字字形，列表/代码/引用是线性符号）——
  'block-text': wrap('<text x="8" y="12.2" fill="currentColor" stroke="none" font-family="Helvetica, Arial, sans-serif" font-size="11" font-weight="500" text-anchor="middle">T</text>'),
  'block-h1': wrap('<text x="8" y="11.6" fill="currentColor" stroke="none" font-family="Helvetica, Arial, sans-serif" font-size="9.5" font-weight="600" text-anchor="middle">H<tspan font-size="7">1</tspan></text>'),
  'block-h2': wrap('<text x="8" y="11.6" fill="currentColor" stroke="none" font-family="Helvetica, Arial, sans-serif" font-size="9.5" font-weight="600" text-anchor="middle">H<tspan font-size="7">2</tspan></text>'),
  'block-h3': wrap('<text x="8" y="11.6" fill="currentColor" stroke="none" font-family="Helvetica, Arial, sans-serif" font-size="9.5" font-weight="600" text-anchor="middle">H<tspan font-size="7">3</tspan></text>'),
  ...Object.fromEntries(Array.from({ length: 6 }, (_, index) => {
    const level = index + 4
    return [`block-h${level}`, wrap(`<text x="8" y="11.6" fill="currentColor" stroke="none" font-family="Helvetica, Arial, sans-serif" font-size="9.5" font-weight="600" text-anchor="middle">H<tspan font-size="7">${level}</tspan></text>`)]
  })),
  'block-ordered': wrap('<text x="3.4" y="6.6" fill="currentColor" stroke="none" font-family="Helvetica, Arial, sans-serif" font-size="6" font-weight="600" text-anchor="middle">1</text><text x="3.4" y="13" fill="currentColor" stroke="none" font-family="Helvetica, Arial, sans-serif" font-size="6" font-weight="600" text-anchor="middle">2</text><path d="M7.4 5.2h6"/><path d="M7.4 8h6"/><path d="M7.4 11.6h6"/>'),
  'block-bullet': wrap('<circle cx="3.6" cy="4.9" r="1" fill="currentColor" stroke="none"/><circle cx="3.6" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="3.6" cy="11.1" r="1" fill="currentColor" stroke="none"/><path d="M7.4 4.9h6"/><path d="M7.4 8h6"/><path d="M7.4 11.1h6"/>'),
  'block-task': wrap('<rect x="2.8" y="2.8" width="10.4" height="10.4" rx="2.2"/><path d="m5.6 8.2 1.9 1.9 3.6-3.9"/>'),
  'horizontal-rule': wrap('<path d="M2 8h12"/><path d="M2 3h3M7 3h3M12 3h2M2 13h3M7 13h3M12 13h2"/>'),
  'block-code': wrap('<path d="M5.8 4c-1.3 0-1.6.7-1.6 1.7v1.1c0 .8-.4 1.2-1.4 1.2v.1c1 0 1.4.4 1.4 1.2v1.1c0 1 .3 1.7 1.6 1.7"/><path d="M10.2 4c1.3 0 1.6.7 1.6 1.7v1.1c0 .8.4 1.2 1.4 1.2v.1c-1 0-1.4.4-1.4 1.2v1.1c0 1-.3 1.7-1.6 1.7"/>'),
  'block-quote': wrap('<path d="M7 5.2c-1.9.4-3 1.6-3 3.6v2h3.2V7.6H5.6c.1-.9.7-1.5 1.4-1.8z" fill="currentColor" stroke="none"/><path d="M12.6 5.2c-1.9.4-3 1.6-3 3.6v2h3.2V7.6h-1.6c.1-.9.7-1.5 1.4-1.8z" fill="currentColor" stroke="none"/>'),
  "link-view-preview": "<svg viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5Zm2 0v9h14V5H5ZM4 19a1 1 0 1 0 0 2h16a1 1 0 1 0 0-2H4Z\" fill=\"currentColor\"></path></svg>",
  "table-float-header-row": "<svg viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M4 2a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H4Zm4.5 13.5V20H4v-4.5h4.5ZM4 4h4.5v5H4V4Zm4.5 6v4.5H4V10h4.5Zm1 0h5v4.5h-5V10ZM20 10v4.5h-4.5V10H20Zm-4.5 5.5H20V20h-4.5v-4.5ZM20 4v5h-4.5V4H20ZM9.5 15.5h5V20h-5v-4.5Zm5-11.5v5h-5V4h5Z\" fill=\"currentColor\"></path><path d=\"M4 4h4.5v5H4V4Zm11.5 0H20v5h-4.5V4Zm-6 0h5v5h-5V4Z\" opacity=\"0.5\" fill=\"currentColor\"></path></svg>",
  "table-float-header-column": "<svg viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v16Zm13.5-4.5H20V20h-4.5v-4.5ZM4 20v-4.5h5V20H4Zm6-4.5h4.5V20H10v-4.5Zm0-1v-5h4.5v5H10ZM10 4h4.5v4.5H10V4Zm5.5 4.5V4H20v4.5h-4.5ZM4 4h5v4.5H4V4Zm11.5 10.5v-5H20v5h-4.5ZM4 9.5h5v5H4v-5Z\" fill=\"currentColor\"></path><path d=\"M4 20v-4.5h5V20H4ZM4 8.5V4h5v4.5H4Zm0 6v-5h5v5H4Z\" opacity=\"0.5\" fill=\"currentColor\"></path></svg>",
  "table-float-merge": "<svg viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M4 5.117a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.6a1 1 0 1 0 2 0v-1.6a3 3 0 0 0-3-3H5a3 3 0 0 0-3 3v4h2v-4Zm16 0a1 1 0 0 0-1-1h-2a1 1 0 0 0-1 1v1.6a1 1 0 1 1-2 0v-1.6a3 3 0 0 1 3-3h2a3 3 0 0 1 3 3v4h-2v-4Zm-15 15a1 1 0 0 1-1-1v-4H2v4a3 3 0 0 0 3 3h2a3 3 0 0 0 3-3v-1.6a1 1 0 0 0-2 0v1.6a1 1 0 0 1-1 1H5Zm15-1a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-1.6a1 1 0 0 0-2 0v1.6a3 3 0 0 0 3 3h2a3 3 0 0 0 3-3v-4h-2v4Zm-9.427-6.68a.4.4 0 0 0 0-.64l-2.933-2.2a.4.4 0 0 0-.64.32v1.2H2a1 1 0 1 0 0 2h5v1.2a.4.4 0 0 0 .64.32l2.933-2.2Zm2.854-.64a.4.4 0 0 0 0 .64l2.933 2.2a.4.4 0 0 0 .64-.32v-1.2h5a1 1 0 0 0 0-2h-5v-1.2a.4.4 0 0 0-.64-.32l-2.933 2.2Z\" fill=\"currentColor\"></path></svg>",
  "table-float-background": "<svg viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M21.957 2.13a1 1 0 0 0-1.406.147l-9.11 11.25a6.632 6.632 0 0 0-1.367 2.969.221.221 0 0 0 .302.244 6.632 6.632 0 0 0 2.62-1.955l9.109-11.25a1 1 0 0 0-.148-1.406Z\" fill=\"currentColor\"></path><path d=\"M17.008 3.665a13.454 13.454 0 0 0-5.06-.984l-.024.004-.538.011-.51.03c-1.191.091-2.37.343-3.51.75a12.305 12.305 0 0 0-3.754 2.142c-1.096.922-1.96 1.99-2.568 3.176a8.435 8.435 0 0 0-.96 3.885c0 1.335.324 2.63.962 3.848.608 1.157 1.474 2.195 2.573 3.083a12.303 12.303 0 0 0 3.755 2.049c1.444.494 2.981.745 4.563.745l.545-.01.525-.029a14.43 14.43 0 0 0 1.57-.203l.722-.148.196-.06c.514-.186.96-.566 1.253-1.083a2.87 2.87 0 0 0 .26-2.178l-.09-.349-.03-.218a2.301 2.301 0 0 1 .357-1.454c.357-.544.93-.868 1.538-.871h1.768l.204-.007c1.614-.113 2.91-1.56 3.007-3.365l.006-.22-.006-.24-.05-.432-.067-.404a8.844 8.844 0 0 0-1.236-3.08 10.13 10.13 0 0 0-.802-1.096l-1.199 1.48c.154.2.298.406.43.617.483.76.81 1.563.974 2.393l.06.358.032.276.003.086-.007.22-.021.169c-.12.724-.604 1.301-1.19 1.38l-.138.01h-1.77l-.247.008c-1.14.079-2.192.702-2.847 1.7a4.145 4.145 0 0 0-.574 3.156l.068.273.037.13.028.154a.993.993 0 0 1-.118.588.58.58 0 0 1-.248.247l-.07.021-.67.134-.549.085a12.6 12.6 0 0 1-1.657.11 12.18 12.18 0 0 1-3.961-.647 10.426 10.426 0 0 1-3.19-1.734c-.9-.729-1.606-1.57-2.096-2.5a6.38 6.38 0 0 1-.75-2.984c0-1.037.254-2.06.755-3.034.495-.963 1.206-1.839 2.11-2.6A10.494 10.494 0 0 1 7.99 5.235a11.42 11.42 0 0 1 3.41-.677l.538-.01.496.01c1.153.048 2.281.264 3.338.633l1.236-1.526Z\" fill=\"currentColor\"></path><path d=\"M6.875 14.466a1.377 1.377 0 0 0-1.374-1.374 1.375 1.375 0 0 0 0 2.747c.758 0 1.374-.616 1.374-1.373ZM8.124 9.47a1.375 1.375 0 0 0-2.748 0 1.374 1.374 0 1 0 2.748 0Zm5.246-1.874a1.374 1.374 0 1 0-2.747-.001 1.374 1.374 0 0 0 2.747 0Z\" fill=\"currentColor\"></path></svg>",
  "table-float-text": "<svg viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M2 3a1 1 0 0 1 1-1h18a1 1 0 0 1 1 1v4a1 1 0 1 1-2 0V4h-7v16h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3V4H4v3a1 1 0 1 1-2 0V3Z\" fill=\"currentColor\"></path></svg>",
  "table-float-align": "<svg viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M2 4a1 1 0 0 1 1-1h18a1 1 0 1 1 0 2H3a1 1 0 0 1-1-1Zm0 4a1 1 0 0 1 1-1h10a1 1 0 1 1 0 2H3a1 1 0 0 1-1-1Zm1 3a1 1 0 1 0 0 2h18a1 1 0 1 0 0-2H3Zm-1 5a1 1 0 0 1 1-1h10a1 1 0 1 1 0 2H3a1 1 0 0 1-1-1Zm1 3a1 1 0 1 0 0 2h18a1 1 0 1 0 0-2H3Z\" fill=\"currentColor\"></path></svg>",
  "table-float-bold": "<svg viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M5 2.709C5 2.317 5.317 2 5.709 2h6.734a5.317 5.317 0 0 1 3.686 9.148 5.671 5.671 0 0 1-2.623 10.7H5.71a.709.709 0 0 1-.71-.707V2.71Zm2 7.798h5.443a3.19 3.19 0 0 0 3.19-3.19c0-1.762-1.428-3.317-3.19-3.317H7v6.507Zm0 2.126v7.09h6.507a3.544 3.544 0 0 0 0-7.09H7Z\" fill=\"currentColor\"></path></svg>",
  "table-float-strike": "<svg viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M5.49 7.226A5.107 5.107 0 0 1 6.9 3.831C8.017 2.636 9.718 2 11.819 2c2.142 0 3.779.57 4.867 1.689.4.392.869.958 1.26 1.595.443.723-.191 1.53-1.04 1.53-.606 0-1.039-.447-1.326-.981a2.864 2.864 0 0 0-.362-.517c-.735-.93-1.909-1.419-3.386-1.419-2.404 0-4.154 1.395-4.2 3.393-.02.846.337 1.58.995 2.043h-2.75c-.271-.621-.403-1.332-.385-2.107Zm8.906 6.024H4.038c-.518 0-.938-.38-.938-.897 0-.518.42-.978.938-.978h16.125c.518 0 .937.437.937.954 0 .518-.42.921-.937.921h-2.455c.542.806.96 1.954.934 3.055C18.563 19.82 15.87 22 11.572 22c-2.875 0-5.028-.964-6.13-2.745a6.884 6.884 0 0 1-.545-1.191c-.261-.72.318-1.432 1.084-1.432.574 0 1.034.416 1.24.952.17.445.4.794.733 1.142.805.858 2.104 1.305 3.766 1.305 2.845 0 4.696-1.39 4.747-3.61.024-1.072-.256-1.61-.897-2.42-.473-.598-1.174-.751-1.174-.751Z\" fill=\"currentColor\"></path></svg>",
  "table-float-italic": "<svg viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M14.825 5.077 11.19 18.923h4.052a1.038 1.038 0 1 1 0 2.077H4.954a1.038 1.038 0 1 1 0-2.077h4.053l3.636-13.846H8.591A1.038 1.038 0 1 1 8.59 3h10.287a1.038 1.038 0 0 1 0 2.077h-4.053Z\" fill=\"currentColor\"></path></svg>",
  "table-float-underline": "<svg viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M7.361 3.052a.99.99 0 0 0-.989-.994.998.998 0 0 0-.999.994v5.765c0 4.205 2.601 7.29 6.627 7.29s6.627-3.085 6.627-7.29V3.052a.996.996 0 0 0-.996-.994.992.992 0 0 0-.992.994v5.765c0 3.003-1.763 5.302-4.639 5.302-2.876 0-4.639-2.299-4.639-5.302V3.052ZM3.054 19.42a.988.988 0 0 0-.994.988 1 1 0 0 0 .994 1h17.892a1 1 0 0 0 .994-1.002.987.987 0 0 0-.994-.986H3.054Z\" fill=\"currentColor\"></path></svg>",
  "table-float-code": "<svg viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M13.31 1.082a1 1 0 0 0-1.115.87L9.758 21.805a1 1 0 0 0 1.985.243l2.437-19.85a1 1 0 0 0-.87-1.115ZM8.207 5.293a1 1 0 0 1 0 1.414L2.414 12.5l5.793 5.793a1 1 0 1 1-1.414 1.414l-6.5-6.5a1 1 0 0 1 0-1.414l6.5-6.5a1 1 0 0 1 1.414 0Zm7.586 0a1 1 0 0 0 0 1.414l5.793 5.793-5.793 5.793a1 1 0 0 0 1.414 1.414l6.5-6.5a1 1 0 0 0 0-1.414l-6.5-6.5a1 1 0 0 0-1.414 0Z\" fill=\"currentColor\"></path></svg>",
  "table-float-more": "<svg viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M13.086 7.814a2 2 0 0 1 0-2.828l3.04-3.04a2 2 0 0 1 2.829 0l3.04 3.04a2 2 0 0 1 0 2.828l-3.04 3.04a2 2 0 0 1-2.829 0l-3.04-3.04Zm2.828-2.828L14.5 6.4l1.414 1.414.212.212 1.415 1.414 1.414-1.414.212-.212L20.58 6.4l-1.414-1.414-.212-.212-1.414-1.415-1.415 1.415-.212.212ZM4.2 2.199a2 2 0 0 0-2 2v4.5a2 2 0 0 0 2 2h4.5a2 2 0 0 0 2-2v-4.5a2 2 0 0 0-2-2H4.2Zm0 2h4.5v4.5H4.2v-4.5Zm0 9.101a2 2 0 0 0-2 2v4.5a2 2 0 0 0 2 2h4.5a2 2 0 0 0 2-2v-4.5a2 2 0 0 0-2-2H4.2Zm0 2h4.5v4.5H4.2v-4.5Zm11.1-2a2 2 0 0 0-2 2v4.501a2 2 0 0 0 2 2h4.5a2 2 0 0 0 2-2v-4.5a2 2 0 0 0-2-2h-4.5Zm0 2h4.5v4.501h-4.5v-4.5Z\" fill=\"currentColor\"></path></svg>",
  "table-float-remove": "<svg viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M8 4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2h5a1 1 0 1 1 0 2h-1v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6H3a1 1 0 0 1 0-2h5ZM6 6v14h12V6H6Zm4 3a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1Zm4 0a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1Z\" fill=\"currentColor\"></path></svg>",
  "table-float-distribute": "<svg viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M18.912 7.787a.285.285 0 0 0 0 .426l1.984 1.722c.174.15.437.022.437-.213V6.278c0-.235-.263-.364-.437-.213l-1.984 1.721Zm-13.825 0a.285.285 0 0 1 0 .426L3.104 9.935c-.174.15-.438.022-.438-.213V6.278c0-.235.264-.364.438-.213l1.983 1.722ZM6 7.445A.545.545 0 0 0 5.467 8c0 .307.238.556.533.556h.36A.545.545 0 0 0 6.893 8a.545.545 0 0 0-.533-.555H6Zm2.04 0A.545.545 0 0 0 7.507 8c0 .307.238.556.533.556h.72A.545.545 0 0 0 9.293 8a.545.545 0 0 0-.533-.555h-.72Zm2.4 0A.545.545 0 0 0 9.907 8c0 .307.238.556.533.556h.72A.545.545 0 0 0 11.693 8a.545.545 0 0 0-.533-.555h-.72Zm2.4 0a.545.545 0 0 0-.533.555c0 .307.238.556.533.556h.72A.545.545 0 0 0 14.093 8a.545.545 0 0 0-.533-.555h-.72Zm2.4 0a.545.545 0 0 0-.533.555c0 .307.238.556.533.556h.72A.545.545 0 0 0 16.493 8a.545.545 0 0 0-.533-.555h-.72Zm2.4 0a.545.545 0 0 0-.533.555c0 .307.238.556.533.556H18A.545.545 0 0 0 18.533 8 .545.545 0 0 0 18 7.445h-.36ZM1.667 13.333c0-.92.746-1.666 1.666-1.666h17.334c.92 0 1.666.746 1.666 1.666v4c0 .92-.746 1.667-1.666 1.667H3.332c-.92 0-1.667-.746-1.667-1.667v-4Zm2 .334V17h16.666v-3.333H3.667Z\" fill=\"currentColor\"></path></svg>",
  "link-view-caret": "<svg viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"m3.414 7.086-.707.707a1 1 0 0 0 0 1.414l7.778 7.778a2 2 0 0 0 2.829 0l7.778-7.778a1 1 0 0 0 0-1.414l-.707-.707a1 1 0 0 0-1.415 0l-7.07 7.07-7.072-7.07a1 1 0 0 0-1.414 0Z\" fill=\"currentColor\" /></svg>",
  'table-float-highlight': `<svg viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="3" fill="${ICON_PALETTE.highlightSwatch}"/><path d="m16.439 15 3.14 7.391a1 1 0 1 0 1.842-.782L13.38 2.692c-.518-1.218-2.244-1.218-2.761 0L2.58 21.609a1 1 0 1 0 1.84.782L7.563 15h8.877Zm-.85-2H8.412L12 4.557 15.59 13Z" fill="${ICON_PALETTE.highlightGlyph}"/></svg>`,
  // —— 块菜单操作行（剪切/复制/翻译/移动/删除）——
  copy: wrap('<rect x="5.6" y="5.6" width="7.6" height="7.6" rx="1.4"/><path d="M10.4 2.8H4.2a1.4 1.4 0 0 0-1.4 1.4v6.2"/>'),
  "refresh": "<svg viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M9.93 4.273a8 8 0 0 1 8.683 3.224h-3.11a1 1 0 0 0 0 2h5.496a1 1 0 0 0 1.001-1V3a1 1 0 1 0-2 0v3a10 10 0 1 0 .66 11 1 1 0 0 0-1.732-1A8 8 0 1 1 9.93 4.273Z\" fill=\"currentColor\"></path></svg>",
  "open-external": "<svg viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0 2C5.925 23 1 18.075 1 12S5.925 1 12 1s11 4.925 11 11-4.925 11-11 11Zm2.325-9.726a2 2 0 0 1-1.056 1.056l-5.113 2.178c-.41.175-.828-.26-.654-.66l2.213-5.082a2 2 0 0 1 1.033-1.034l5.098-2.228c.41-.179.831.253.66.655l-2.181 5.115Z\" fill=\"currentColor\"></path></svg>",
  cut: wrap('<circle cx="4.4" cy="11.6" r="1.8"/><circle cx="11.6" cy="11.6" r="1.8"/><path d="M5.7 10.3 11.6 2.8"/><path d="m10.3 10.3-5.9-7.5"/>'),
  translate: wrap('<path d="M2.6 4.6h5"/><path d="M5 2.8v1.8"/><path d="M7 4.6c-.4 2.6-2 4.4-4.4 5.4"/><path d="M3.2 6.6c1 1.6 2.3 2.7 4 3.2"/><path d="M8.6 13.2 11 7.4l2.4 5.8"/><path d="M9.4 11.4h3.3"/>'),
  trash: wrap('<path d="M3 4.6h10"/><path d="M6.4 4.6V3.4c0-.6.4-1 1-1h1.2c.6 0 1 .4 1 1v1.2"/><path d="M4.4 4.6l.6 8c0 .6.5 1 1 1h4c.5 0 1-.4 1-1l.6-8"/><path d="M6.7 7.4v3.6"/><path d="M9.3 7.4v3.6"/>'),
  'move-up': wrap('<path d="M8 13V3.6"/><path d="M4.4 7.2 8 3.6l3.6 3.6"/>'),
  'move-down': wrap('<path d="M8 3v9.4"/><path d="M4.4 8.8 8 12.4l3.6-3.6"/>'),
  // —— 表格句柄菜单（对齐飞书：标题行/标题列 = 网格 + 深色首行/首列，均分列宽 = 双向箭头）——
  'table-header-row': wrap('<rect x="2.8" y="2.8" width="10.4" height="3.2" rx="1.4" fill="currentColor" stroke="none"/><rect x="2.8" y="2.8" width="10.4" height="10.4" rx="1.4"/><path d="M2.8 9.6h10.4"/><path d="M8 6v7.2"/>'),
  'table-header-col': wrap('<rect x="2.8" y="2.8" width="3.2" height="10.4" rx="1.4" fill="currentColor" stroke="none"/><rect x="2.8" y="2.8" width="10.4" height="10.4" rx="1.4"/><path d="M6 6.4h7.2"/><path d="M6 9.8h7.2"/><path d="M6 2.8v10.4"/>'),
  'distribute-cols': wrap('<path d="M4.2 4v8"/><path d="M11.8 4v8"/><path d="M5 8h6"/><path d="m6.4 6.6-1.4 1.4 1.4 1.4"/><path d="m9.6 6.6 1.4 1.4-1.4 1.4"/>'),
  // —— 气泡条格式按钮（对齐飞书：文字字形 + 装饰线，hover 跟随 currentColor）——
  'mark-bold': wrap('<text x="8" y="12" fill="currentColor" stroke="none" font-family="Georgia, \'Times New Roman\', serif" font-size="11.5" font-weight="800" text-anchor="middle">B</text>'),
  'mark-strike': wrap('<text x="8" y="11.8" fill="currentColor" stroke="none" font-family="Helvetica, Arial, sans-serif" font-size="10.5" text-anchor="middle">S</text><path d="M3.4 8.4h9.2"/>'),
  'mark-italic': wrap('<text x="8" y="12" fill="currentColor" stroke="none" font-family="Georgia, \'Times New Roman\', serif" font-size="11.5" font-style="italic" text-anchor="middle">I</text>'),
  'mark-underline': wrap('<text x="8" y="11" fill="currentColor" stroke="none" font-family="Helvetica, Arial, sans-serif" font-size="10.5" text-anchor="middle">U</text><path d="M4.6 13.2h6.8"/>'),
  // 高亮按钮：黄色小色块打底（飞书的高亮 icon 自带黄色），A 随 currentColor。
  'mark-highlight': wrap(`<rect x="3" y="3" width="10" height="10" rx="2" fill="${ICON_PALETTE.highlightSwatch}" stroke="none"/><text x="8" y="11.4" fill="${ICON_PALETTE.highlightGlyph}" stroke="none" font-family="Helvetica, Arial, sans-serif" font-size="9" font-weight="600" text-anchor="middle">A</text>`),
  // 块菜单「颜色」行的调色盘（飞书同款语义：调色盘 + 一笔）。
  palette: wrap('<path d="M8 2.6a5.4 5.4 0 1 0 0 10.8c1 0 1.4-.5 1.4-1.1 0-.9-.7-1.2-.7-2 0-.7.5-1.2 1.3-1.2h1.2c1.6 0 2.4-1 2.4-2.3C13.6 4.5 11.1 2.6 8 2.6z"/><circle cx="5.4" cy="6.4" r=".9" fill="currentColor" stroke="none"/><circle cx="8.2" cy="5" r=".9" fill="currentColor" stroke="none"/><circle cx="10.9" cy="6.6" r=".9" fill="currentColor" stroke="none"/>'),
  // —— P4-06 顶栏模式切换按钮（03 §顶栏右侧按钮组 #2：图标位 16×22）——
  // 只有尺寸是实测值，字形飞书未采集 → 取与语义最贴的线性符号：编辑 = 铅笔、修订 = 对话气泡；
  // 阅读直接复用上面的 reading（书本），不另画一个。
  'mode-edit': wrap('<path d="M11.3 2.7a1.6 1.6 0 0 1 2.3 0l.6.6a1.6 1.6 0 0 1 0 2.3l-8 8L3 14.3l.7-3.2z"/><path d="m10.2 3.8 2.3 2.3"/>'),
  'mode-comment': wrap('<path d="M13.4 9.4a1.8 1.8 0 0 1-1.8 1.8H4.8L2.6 13.4V4.4a1.8 1.8 0 0 1 1.8-1.8h7.2a1.8 1.8 0 0 1 1.8 1.8z"/><path d="M5.4 6.4h5.2"/><path d="M5.4 9h3.2"/>'),
  // —— P4-06 右下角帮助菜单 5 项（04 §3.5；图标区实测 16×16）——
  // 上传日志：纸面 + 向上箭头（对齐「导出/上报」语义）
  'help-log': wrap('<path d="M9.2 2.8H4.6a1.6 1.6 0 0 0-1.6 1.6v6.4a1.6 1.6 0 0 0 1.6 1.6h6.8a1.6 1.6 0 0 0 1.6-1.6V6.4z"/><path d="M9 2.8v3.6h3.4"/><path d="M8 12.4V8.4"/><path d="m6.4 9.9 1.6-1.6 1.6 1.6"/>'),
  // 联系客服：耳机 + 麦克风臂
  'help-support': wrap('<path d="M3.4 9.2V7.6a4.6 4.6 0 0 1 9.2 0v1.6"/><rect x="2.2" y="8.8" width="2.4" height="3.6" rx="1.2"/><rect x="11.4" y="8.8" width="2.4" height="3.6" rx="1.2"/><path d="M12.6 12.4v.4a1.8 1.8 0 0 1-1.8 1.8H9"/>'),
  // 功能更新：礼盒（飞书「功能更新」用礼盒/喇叭语义，取礼盒更好认）
  'help-whatsnew': wrap('<rect x="2.6" y="6" width="10.8" height="7.2" rx="1.4"/><path d="M2.6 9.2h10.8"/><path d="M8 6v7.2"/><path d="M8 6C7.2 4 5.9 3 4.9 3.6c-.9.6-.4 1.8 1.1 2.4"/><path d="M8 6c.8-2 2.1-3 3.1-2.4.9.6.4 1.8-1.1 2.4"/>'),
  // 帮助中心：问号圆环
  'help-center': wrap('<circle cx="8" cy="8" r="5.4"/><path d="M6.4 6.2a1.7 1.7 0 1 1 2.4 1.6c-.5.3-.8.7-.8 1.3v.3"/><path d="M8 11.6h.01" stroke-width="1.9"/>'),
  // 快捷键：键盘外形 + 三粒按键
  'help-keyboard': wrap('<rect x="2.2" y="4.4" width="11.6" height="7.2" rx="1.6"/><path d="M4.8 7h.01M7 7h.01M9.2 7h.01M11.4 7h.01" stroke-width="1.9"/><path d="M5.4 9.6h5.2"/>'),
  // —— P4-06 修订建议面板（07 §12.4：热区统一 16×16，图标本体 12/14 两档）——
  // 上下箭头 = 下一条 / 上一条建议；勾 = 接受修订。叉与链条直接复用 close / link，
  // 不重画（飞书那两颗的路径与通用叉/链一致，没必要为了「一物一图」多存两份）。
  // 字形未采集（07 只给了尺寸与色值）→ 取最通用的线性箭头/勾，与工具栏风格一致。
  'rev-next': wrap('<path d="M8 3.6v8.8"/><path d="m4.4 9 3.6 3.6L11.6 9"/>'),
  'rev-prev': wrap('<path d="M8 12.4V3.6"/><path d="m4.4 7 3.6-3.6L11.6 7"/>'),
  'rev-accept': wrap('<path d="m3.4 8.4 3.2 3.2 6-7.2"/>'),
  // 输入区右侧配图按钮（实测 16×16 占位，字形未采集）：取相框 + 山形，和飞书的图片语义一致。
  'rev-image': wrap('<rect x="2.6" y="3.4" width="10.8" height="9.2" rx="1.6"/><circle cx="6" cy="6.6" r="1"/><path d="m3.4 11 3.2-3.2 2.4 2.4 1.8-1.8 1.8 1.8"/>'),
  // 回复卡头像兜底（07 §12.3：灰底人形 SVG）。用半身剪影，别做成「两个圆」——
  // 32px 圆内头肩要留白，否则缩到 18px 就看不出是人。
  'rev-avatar': wrap('<circle cx="8" cy="5.5" r="2.7"/><path d="M3.1 13.7c0-2.6 2.2-4.4 4.9-4.4s4.9 1.8 4.9 4.4"/>'),
  // —— v11 表格/文本浮窗（与顶部功能栏共用同一套 16×16 currentColor 图标，禁止字符凑图）——
  // 合并 / 拆分单元格：两格 + 相向 / 相背箭头，与「标题行 / 标题列」网格图标同族。
  'table-merge': wrap('<rect x="2.6" y="3.4" width="10.8" height="9.2" rx="1.4"/><path d="M8 3.4v9.2" stroke-dasharray="2 2"/><path d="M4.2 8h2.4M9.4 8h2.4"/><path d="m5.5 6.9 1.1 1.1-1.1 1.1M10.5 6.9 9.4 8l1.1 1.1"/>'),
  'table-split': wrap('<rect x="2.6" y="3.4" width="10.8" height="9.2" rx="1.4"/><path d="M8 3.4v9.2"/><path d="M4.2 8h2.4M9.4 8h2.4"/><path d="m5.5 6.9-1.1 1.1 1.1 1.1M10.5 6.9l1.1 1.1-1.1 1.1"/>'),
  // 单元格垂直对齐：上下基线 + 内容块贴顶 / 居中 / 贴底。
  'valign-top': wrap('<path d="M2.8 3.2h10.4"/><path d="M2.8 12.8h10.4" opacity=".4"/><rect x="5" y="4.2" width="6" height="3.2" rx="1"/>'),
  'valign-middle': wrap('<path d="M2.8 3.2h10.4M2.8 12.8h10.4" opacity=".4"/><rect x="5" y="6.4" width="6" height="3.2" rx="1"/>'),
  'valign-bottom': wrap('<path d="M2.8 3.2h10.4" opacity=".4"/><path d="M2.8 12.8h10.4"/><rect x="5" y="8.6" width="6" height="3.2" rx="1"/>'),
  // 「转换为」里的高亮块（方框 + 感叹号）与同步块（双向回环）。
  'block-callout': wrap('<rect x="2.6" y="2.8" width="10.8" height="10.4" rx="1.6"/><path d="M8 5.4v3.2"/><path d="M8 10.8h.01" stroke-width="1.9"/>'),
  'block-sync': wrap('<path d="M3.3 7.2a4.8 4.8 0 0 1 8.1-2.7"/><path d="m11.3 2.5.2 2.4-2.4.1"/><path d="M12.7 8.8a4.8 4.8 0 0 1-8.1 2.7"/><path d="m4.7 13.5-.2-2.4 2.4-.1"/>'),
  // 更多：三点；复制选区链接：方框 + 右上跳出箭头（与「插入链接」的链条明确区分）。
  'more-horizontal': wrap('<circle cx="3.6" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="12.4" cy="8" r="1.1" fill="currentColor" stroke="none"/>'),
  // 飞书块句柄的六点拖拽图标：两列三行，避免用 Braille 字符造成平台字形漂移。
  'drag-handle': wrap('<circle cx="5" cy="4" r="1.05" fill="currentColor" stroke="none"/><circle cx="11" cy="4" r="1.05" fill="currentColor" stroke="none"/><circle cx="5" cy="8" r="1.05" fill="currentColor" stroke="none"/><circle cx="11" cy="8" r="1.05" fill="currentColor" stroke="none"/><circle cx="5" cy="12" r="1.05" fill="currentColor" stroke="none"/><circle cx="11" cy="12" r="1.05" fill="currentColor" stroke="none"/>'),
  'share-link': wrap('<path d="M9.2 3.4h3.1a1.3 1.3 0 0 1 1.3 1.3v6.6a1.3 1.3 0 0 1-1.3 1.3H9.2"/><path d="M6 8h7.6"/><path d="m11.4 5.8 2.2 2.2-2.2 2.2"/>'),
}

export default ICONS
