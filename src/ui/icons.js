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
  'block-file': wrap('<path d="m6.5 9.5 4-4a2.1 2.1 0 0 1 3 3l-6 6a3.5 3.5 0 0 1-5-5l6-6a1.4 1.4 0 0 1 2 2l-6 6a.7.7 0 0 1-1-1l5-5"/>'),
  'document-like': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10v11H1.5V10ZM7 10l4-7c.5-.8 1.6-.6 1.7.4l-.2 5.1h6.3c1.2 0 2 1.1 1.7 2.2l-2.3 8.5c-.3 1-1.1 1.8-2.1 1.8H7Z"/></svg>',
  ...Object.fromEntries([
    'M11.4 9.2 13 8v5',
    'M11 9.1a1.5 1.5 0 0 1 3 0c0 .8-.8 1.4-3 3.9h3',
    'M11 8.3h2.7l-1.5 1.8c2.2-.2 2.8 2.9.7 3.1a2 2 0 0 1-2-.5',
    'M13 13V8l-2.5 3.4h3.9',
    'M14 8h-2.7l-.2 2.1h1.6c2.1 0 2.1 3 0 3H11',
    'M13.7 8.2c-2.5-.9-3.8 4.6-1.4 4.8a1.5 1.5 0 1 0 0-3c-.7 0-1.1.3-1.4.7',
  ].map((digit, index) => [`mobile-heading${index + 1}`, wrap(`<path d="M2.5 3.2v9.6M9 3.2v9.6M2.5 8H9" stroke-width="1.1"/><path d="${digit}" stroke-width="1"/>`)])),
  'mobile-ordered': wrap('<g stroke-width=".75"><path d="m2.1 2.4 1-.6v2.7"/><path d="M1.7 7.2a1 1 0 0 1 2 0c0 .5-.6.9-2 2.2h2"/><path d="M1.7 11.7h2l-1.1 1c1.6-.1 1.9 1.9.4 1.9-.5 0-.9-.1-1.2-.4"/></g><path d="M6.3 3.3H14M6.3 8H14M6.3 12.7H14" stroke-width="1.1"/>'),
  'mobile-quote': wrap('<path d="M6.8 2.5C3.5 4.2 1.7 6.9 1.7 10.5c0 2 1.1 3.1 2.7 3.1A2.5 2.5 0 0 0 6.9 11c0-1.5-.9-2.5-2.5-2.5h-.8c.5-2 1.7-3.5 3.8-5Z" fill="currentColor" stroke="none"/><path d="M14.1 2.5c-3.3 1.7-5.1 4.4-5.1 8 0 2 1.1 3.1 2.7 3.1a2.5 2.5 0 0 0 2.5-2.6c0-1.5-.9-2.5-2.5-2.5h-.8c.5-2 1.7-3.5 3.8-5Z" fill="currentColor" stroke="none"/>'),
  ...Object.fromEntries(Array.from({ length: 6 }, (_, index) => {
    const level = index + 4
    return [`block-h${level}`, wrap(`<text x="8" y="12" fill="currentColor" stroke="none" font-family="Helvetica, Arial, sans-serif" font-size="11.5" font-weight="650" text-anchor="middle">H<tspan font-size="8.5">${level}</tspan></text>`)]
  })),
  ...Object.fromEntries(Array.from({ length: 3 }, (_, i) => [`mobile-heading${i + 7}`, wrap(`<text x="8" y="11.6" fill="currentColor" stroke="none" font-family="Helvetica, Arial, sans-serif" font-size="9.5" font-weight="600" text-anchor="middle">H<tspan font-size="7">${i + 7}</tspan></text>`)])),
  'table-merge': wrap('<rect x="2" y="3" width="12" height="10" rx="1"/><path d="M2 8h4m4 0h4M4.5 6.5 6 8 4.5 9.5m7-3L10 8l1.5 1.5"/>'),
  'cell-background': wrap('<rect x="2" y="2" width="12" height="12" rx="1"/><path d="M2 6h12M6 2v12M10 2v12M2 10h12"/><path d="M6 6h4v4H6Z" fill="currentColor" stroke="none"/>'),
  'valign-top': wrap('<path d="M2 3h12M8 13V6m-3 3 3-3 3 3"/>'),
  'valign-middle': wrap('<path d="M2 8h12M8 1v4M6 3l2 2 2-2M8 15v-4m-2 2 2-2 2 2"/>'),
  'valign-bottom': wrap('<path d="M2 13h12M8 3v7M5 7l3 3 3-3"/>'),
  'share-link': wrap('<path d="M9 2h5v5M14 2 7 9M5 4H2v10h10v-3"/>'),
  'image-crop': wrap('<path d="M5 1v10h10M1 5h10v10M8 2h6v6"/>'),
  'insert-file': wrap('<path d="m6 10 4.6-4.6a2 2 0 0 1 2.8 2.8L7 14.6a3.5 3.5 0 0 1-5-5l6.4-6.4a2.5 2.5 0 0 1 3.6 3.6L5.6 13"/>'),
  'insert-table': wrap('<rect x="2" y="2" width="12" height="12" rx=".8"/><path d="M2 6h12M2 10h12M6 2v12"/>'),
  'insert-callout': wrap('<rect x="2" y="2.5" width="12" height="5.5" rx=".8"/><path d="M2 11h12M2 14h7"/>'),
  'insert-synced': wrap('<path d="M7 9H2V2h8v5M9 7h5v7H6V9"/>'),
  'insert-divider': wrap('<path d="M2 8h12M2 3h2m3 0h2m3 0h2M2 13h2m3 0h2m3 0h2"/>'),
  'insert-columns': wrap('<rect x="2" y="2" width="12" height="12" rx="2"/><path d="M7 2v12M2 7h12"/>'),
  'insert-math': wrap('<text x="8" y="11.5" fill="currentColor" stroke="none" font-family="Georgia, serif" font-size="9" text-anchor="middle">T<tspan dy="1.5" font-size="6">E</tspan><tspan dy="-1.5">X</tspan></text>'),
  'insert-template': wrap('<path d="M3 1.5h7l3 3v10H3Z"/><path d="m8 5 3 3-3 3-3-3Z" fill="currentColor" stroke="none"/>'),
  'mobile-insert': wrap('<circle cx="8" cy="8" r="6"/><path d="M8 5v6M5 8h6"/>'),
  'keyboard-hide': wrap('<rect x="1.5" y="2" width="13" height="9" rx="1.5"/><path d="M4 5h1m2.5 0h1m2.5 0h1M4 8h8m-6 5 2 1.5 2-1.5"/>'),
  home: wrap('<path d="m2 7 6-5 6 5v7H9.5v-4h-3v4H2Z"/>'),
  'library-document': wrap('<rect x="3" y="1.5" width="10" height="13" rx="1.5"/><path d="M5.5 5h5M5.5 8h5M5.5 11h3"/>'),
  members: wrap('<circle cx="6" cy="5" r="2.5"/><path d="M1.5 14v-1.5a4.5 4.5 0 0 1 9 0V14ZM11 3a2.5 2.5 0 0 1 0 5M12 10a3.5 3.5 0 0 1 2.5 3.5V14"/>'),
  'mobile-home': '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linejoin="round"><path d="M2.5 8.3 10 2.7l7.5 5.6v9.2h-5v-5h-5v5h-5Z"/></svg>',
  'mobile-outline': '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="2.5" cy="2.5" r="1.5" fill="currentColor" stroke="none"/><path d="M2.5 4v3H4M4 16H2.5v-4H1M8 2.5h8M8 9h8M8 15.5h8"/></svg>',
  'mobile-members': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><circle cx="8.5" cy="7" r="3.5"/><path d="M1.5 20.5v-2.6a4.4 4.4 0 0 1 4.3-4.4h5.4a4.4 4.4 0 0 1 4.3 4.4v2.6ZM18.5 15h1a3 3 0 0 1 3 3v2.5h-4"/><circle cx="17.5" cy="9.5" r="2"/></svg>',
  'mobile-menu': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 6h14M5 12h14M5 18h14"/></svg>',
  'comment-send': '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3.5 13.75c-.4.13-.5.49-.5.75L2.5 22a1 1 0 0 0 1.48.88l18.5-10a1 1 0 0 0 0-1.76l-18.5-10A1 1 0 0 0 2.5 2L3 9.5c0 .27.06.66.5.76l7.13 1.25a.5.5 0 0 1 0 .98L3.5 13.75Z" fill="currentColor"/></svg>',
  'diagram-flowchart': '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="1.5" width="6" height="3.5" rx="1"/><path d="m10 7 3 3-3 3-3-3Z"/><rect x="1.5" y="14.5" width="6" height="3.5" rx="1"/><rect x="12.5" y="14.5" width="6" height="3.5" rx="1"/><path d="M10 5v2M10 13v1.5M7.8 10H4.5v4.5M12.2 10h3.3v4.5"/></svg>',
  'diagram-sequence': '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2v16M16 2v16"/><rect x="2" y="2" width="4" height="3" rx=".8"/><rect x="14" y="2" width="4" height="3" rx=".8"/><path d="M6 7h8l-2-2M14 11H6l2 2M6 15h8l-2-2"/></svg>',
  'diagram-gantt': '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3.5v14M2 17.5h16M2 7.5h16M2 11.5h16"/><rect x="4" y="4.5" width="5" height="2" rx=".7"/><rect x="7" y="8.5" width="8" height="2" rx=".7"/><rect x="5" y="12.5" width="4" height="2" rx=".7"/></svg>',
  'diagram-pie': '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2a8 8 0 1 0 8 8h-8Z" fill="currentColor" stroke="none"/><path d="M11 2a7 7 0 0 1 7 7h-7Z"/><path d="M10 2v8h8"/></svg>',
  'diagram-state': '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><circle cx="3.5" cy="10" r="2.2"/><rect x="13" y="7" width="5" height="6" rx="3"/><path d="M5.7 10h6.1l-2-2M11.8 10l-2 2"/></svg>',
  'diagram-class': '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="1.5" width="8" height="7" rx=".7"/><path d="M1.5 4h8M1.5 6h8M3 3h5M3 5h2"/><rect x="11" y="11.5" width="7.5" height="7" rx=".7"/><path d="M11 14h7.5M11 16h7.5M12.5 13h4M12.5 15h2M9.5 6h2.5v9h-1.5"/></svg>',
  undo: wrap('<path d="M6.5 3.5 3 7l3.5 3.5"/><path d="M3 7h6.5a3.5 3.5 0 0 1 0 7H7"/>'),
  redo: wrap('<path d="M9.5 3.5 13 7l-3.5 3.5"/><path d="M13 7H6.5a3.5 3.5 0 0 0 0 7H9"/>'),
  inlineCode: wrap('<path d="M5.5 4 2 8l3.5 4"/><path d="M10.5 4 14 8l-3.5 4"/><path d="M9 3 7 13"/>'),
  link: wrap('<path d="M6.5 9.5l3-3"/><path d="M4.8 7.7 3.2 9.3a2.6 2.6 0 0 0 3.7 3.7l1.6-1.6"/><path d="M11.2 8.3l1.6-1.6a2.6 2.6 0 0 0-3.7-3.7L7.5 4.6"/>'),
  'link-view-link': wrap('<path d="M6 10l4-4M5 7l-2 2a3 3 0 0 0 4 4l2-2M7 5l2-2a3 3 0 0 1 4 4l-2 2"/>'),
  'link-view-title': wrap('<path d="M3 3h10M8 3v10M5 13h6"/>'),
  'link-view-card': wrap('<rect x="1.5" y="3" width="13" height="10" rx="1.5"/><path d="M4 6h8M4 9h5"/>'),
  'link-view-preview': wrap('<rect x="1.5" y="2" width="13" height="12" rx="1.5"/><path d="M2 5h12M4 3.5h.1M6 3.5h.1"/>'),
  'link-view-caret': wrap('<path d="m4 6 4 4 4-4"/>'),
  'link-unset': wrap('<path d="m2 2 12 12M6 6l-3 3a3 3 0 0 0 4 4l2-2M7 5l2-2a3 3 0 0 1 4 4l-2 2"/>'),
  'link-view-more': wrap('<circle cx="3" cy="8" r="1"/><circle cx="8" cy="8" r="1"/><circle cx="13" cy="8" r="1"/>'),
  'open-external': wrap('<path d="M9 2h5v5M14 2 7 9M6 3H3v10h10v-3"/>'),
  refresh: wrap('<path d="M13 6a5 5 0 1 0 0 4M13 2v4H9"/>'),
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
  'block-text': '<svg viewBox="0 0 24 24" fill="none"><path d="M2 3a1 1 0 0 1 1-1h18a1 1 0 0 1 1 1v4a1 1 0 1 1-2 0V4h-7v16h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3V4H4v3a1 1 0 1 1-2 0V3Z" fill="currentColor"/></svg>',
  'block-h1': wrap('<text x="8" y="12" fill="currentColor" stroke="none" font-family="Helvetica, Arial, sans-serif" font-size="11.5" font-weight="650" text-anchor="middle">H<tspan font-size="8.5">1</tspan></text>'),
  'block-h2': wrap('<text x="8" y="12" fill="currentColor" stroke="none" font-family="Helvetica, Arial, sans-serif" font-size="11.5" font-weight="650" text-anchor="middle">H<tspan font-size="8.5">2</tspan></text>'),
  'block-h3': wrap('<text x="8" y="12" fill="currentColor" stroke="none" font-family="Helvetica, Arial, sans-serif" font-size="11.5" font-weight="650" text-anchor="middle">H<tspan font-size="8.5">3</tspan></text>'),
  'block-ordered': wrap('<text x="3.4" y="6.6" fill="currentColor" stroke="none" font-family="Helvetica, Arial, sans-serif" font-size="6" font-weight="600" text-anchor="middle">1</text><text x="3.4" y="13" fill="currentColor" stroke="none" font-family="Helvetica, Arial, sans-serif" font-size="6" font-weight="600" text-anchor="middle">2</text><path d="M7.4 5.2h6"/><path d="M7.4 8h6"/><path d="M7.4 11.6h6"/>'),
  'block-bullet': wrap('<circle cx="3.6" cy="4.9" r="1" fill="currentColor" stroke="none"/><circle cx="3.6" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="3.6" cy="11.1" r="1" fill="currentColor" stroke="none"/><path d="M7.4 4.9h6"/><path d="M7.4 8h6"/><path d="M7.4 11.1h6"/>'),
  'block-task': wrap('<rect x="2.8" y="2.8" width="10.4" height="10.4" rx="2.2"/><path d="m5.6 8.2 1.9 1.9 3.6-3.9"/>'),
  'block-code': wrap('<path d="M5.8 4c-1.3 0-1.6.7-1.6 1.7v1.1c0 .8-.4 1.2-1.4 1.2v.1c1 0 1.4.4 1.4 1.2v1.1c0 1 .3 1.7 1.6 1.7"/><path d="M10.2 4c1.3 0 1.6.7 1.6 1.7v1.1c0 .8.4 1.2 1.4 1.2v.1c-1 0-1.4.4-1.4 1.2v1.1c0 1-.3 1.7-1.6 1.7"/>'),
  'block-quote': wrap('<path d="M7 5.2c-1.9.4-3 1.6-3 3.6v2h3.2V7.6H5.6c.1-.9.7-1.5 1.4-1.8z" fill="currentColor" stroke="none"/><path d="M12.6 5.2c-1.9.4-3 1.6-3 3.6v2h3.2V7.6h-1.6c.1-.9.7-1.5 1.4-1.8z" fill="currentColor" stroke="none"/>'),
  // —— 块菜单操作行（剪切/复制/翻译/移动/删除）——
  copy: wrap('<rect x="5.6" y="5.6" width="7.6" height="7.6" rx="1.4"/><path d="M10.4 2.8H4.2a1.4 1.4 0 0 0-1.4 1.4v6.2"/>'),
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
  // —— 链接悬浮卡 / 封面面板（04 §1.6 / §1.4）——
  // 这三颗规格里只有热区尺寸（链接卡 24×24 / 封面项图标到文字 20px），字形未采集，
  // 所以一律取语义最贴的线性符号与前两条线保持同一支线宽。
  // 编辑链接：铅笔（与「修订插入」区分开 —— 修订是勾/叉，编辑必须是笔）
  edit: wrap('<path d="M11.3 2.7a1.6 1.6 0 0 1 2.3 0l.6.6a1.6 1.6 0 0 1 0 2.3l-8 8L3 14.3l.7-3.2z"/><path d="m10.2 3.8 2.3 2.3"/>'),
  // 更多：横向三点（飞书 24×24 更多按钮的标准字形）
  more: wrap('<circle cx="3.6" cy="8" r="1.15" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1.15" fill="currentColor" stroke="none"/><circle cx="12.4" cy="8" r="1.15" fill="currentColor" stroke="none"/>'),
  // 勾（04 §1.6.1：path 13×9）：不复用 rev-accept —— 那条虽然路径相同，
  // 但语义绑在「接受修订」上，改口径会让勾的确切用途失真。
  // 描边色不写死：用方由 currentColor 决定（当前主要挂在 --ld-brand-content 上）。
  check: wrap('<path d="m3.1 8.2 3.1 3.1 6.7-6.6"/>'),
  // 封面面板「选择图片」：与 rev-image 同款相框（同一件事不画两种图）
  image: wrap('<rect x="2.6" y="3.4" width="10.8" height="9.2" rx="1.6"/><circle cx="6" cy="6.6" r="1"/><path d="m3.4 11 3.2-3.2 2.4 2.4 1.8-1.8 1.8 1.8"/>'),
  // 封面面板「调整图片位置」：左右夹住图的两侧并双向拖动
  'cover-position': wrap('<path d="M2.6 3.4h10.8v9.2H2.6z" opacity=".35"/><path d="M8 5.2v5.6"/><path d="m6.2 6.9 1.8-1.8 1.8 1.8"/><path d="m6.2 9.1 1.8 1.8 1.8-1.8"/>'),
  // —— 顶栏「新建」菜单与「通知」popover 专用（04 §4.6.3 / §4.6.4）——
  // 11 项里前 6 项与「知识库」是单色 `--ld-text-menu` 线框图标，后 4 项（画板/思维导图/流程图/
  // 上传及导入）是彩色图形 —— 颜色由项的 `iconColor` 走 `style.color` 覆盖，图标本身仍用
  // currentColor，这样彩色/单色两态共用同一份路径，不用画两套。
  'chevron-right': wrap('<path d="m6.2 4.2 3.8 3.8-3.8 3.8"/>'),
  bell: wrap('<path d="M8 2.2a4 4 0 0 0-4 4v2.6L2.9 11h10.2L12 8.8V6.2a4 4 0 0 0-4-4z"/><path d="M6.4 13.2a1.7 1.7 0 0 0 3.2 0"/>'),
  doc: wrap('<path d="M4.2 2.4h4.6l3 3v8.2H4.2z"/><path d="M8.6 2.4v3.2h3.2"/><path d="M6.2 8.6h3.6"/><path d="M6.2 11h3.6"/>'),
  'doc-grid': wrap('<rect x="2.6" y="2.6" width="10.8" height="10.8" rx="1.6"/><path d="M2.6 6.4h10.8"/><path d="M2.6 10.2h10.8"/><path d="M6.4 2.6v10.8"/>'),
  form: wrap('<rect x="2.6" y="2.6" width="10.8" height="10.8" rx="1.6"/><path d="M5.4 6.2h5.2"/><path d="M5.4 8.6h5.2"/><path d="M5.4 11h2.6"/>'),
  board: wrap('<rect x="2.4" y="3.4" width="11.2" height="9.2" rx="1.6"/><path d="M5.6 6.2v3.8" stroke-width="1.8"/><path d="m8.6 4.8 2.6 2.2-2.6 2.2z"/>'),
  mindmap: wrap('<circle cx="3.4" cy="8" r="1.5"/><circle cx="12.2" cy="4.4" r="1.3"/><circle cx="12.2" cy="11.6" r="1.3"/><path d="M4.9 8h3.2c1 0 1.4-.6 1.9-1.4"/><path d="M4.9 8h3.2c1 0 1.4.6 1.9 1.4"/>'),
  flow: wrap('<rect x="2.4" y="2.4" width="5" height="4" rx="1"/><rect x="8.6" y="9.6" width="5" height="4" rx="1"/><path d="M4.9 6.4v3.2h6.2"/>'),
  upload: wrap('<path d="M8 10.4V3.2"/><path d="m5.4 5.8 2.6-2.6 2.6 2.6"/><path d="M3 11.2v1.6h10v-1.6"/>'),
  'text-color': wrap('<path d="m4 12.6 3.1-8.8h1.8l3.1 8.8M5.2 9.3h5.6"/><path d="M2.8 14h10.4"/>'),
  'block-image': wrap('<rect x="2.4" y="2.4" width="11.2" height="11.2" rx="1.7"/><circle cx="5.7" cy="5.8" r="1.1"/><path d="m3.6 12 3.1-3.1 2.2 2.2 1.9-1.9 1.7 1.7"/>'),
  'block-table': '<svg viewBox="0 0 24 24" fill="none"><path d="M19.5 4.25v15.5H4V4.25h15.5ZM4 2.25a2 2 0 0 0-2 2v15.5a2 2 0 0 0 2 2h15.5a2 2 0 0 0 2-2V4.25a2 2 0 0 0-2-2H4Z" fill="currentColor"/><path d="M9.997 4.25v3.835H19.5v2H9.997v3.83H19.5v2H9.997v3.835h-2v-3.835H4v-2h3.997v-3.83H4v-2h3.997V4.25h2Z" fill="currentColor"/></svg>',
  'block-columns': wrap('<path d="M5 2.8v10.4M11 2.8v10.4" stroke-width="2.2"/>'),
  'block-details': wrap('<path d="m4.5 6.2 3.5 3.5 3.5-3.5"/>'),
  'block-template': wrap('<path d="m8 2.4 5.6 5.6L8 13.6 2.4 8 8 2.4Z"/><path d="M6.1 8h3.8"/>'),
  'block-diagram': wrap('<rect x="2.2" y="2.2" width="4.1" height="3.4" rx=".7"/><rect x="9.7" y="10.4" width="4.1" height="3.4" rx=".7"/><path d="M6.3 3.9h3.1v8.2M9.4 12.1H8"/>'),
  'mark-subscript': wrap('<path d="M2.8 4.3 7.2 8.7M7.2 4.3 2.8 8.7"/><path d="M9.6 10.2h3.7l-3.7 3.1h3.7"/>'),
  'mark-superscript': wrap('<path d="M2.8 7.7 7.2 12.1M7.2 7.7 2.8 12.1"/><path d="M9.6 5.8h3.7l-3.7-3.1h3.7"/>'),
  'block-callout': wrap('<rect x="2.4" y="2" width="11.2" height="6.4" rx=".8"/><path d="M2.4 11h11.2M2.4 14h7.2"/>'),
  'drag-handle': '<svg viewBox="0 0 24 24" fill="none"><path d="M8.25 6.5a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5Zm0 7.25a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5Zm1.75 5.5a1.75 1.75 0 1 1-3.5 0 1.75 1.75 0 0 1 3.5 0ZM14.753 6.5a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5ZM16.5 12a1.75 1.75 0 1 1-3.5 0 1.75 1.75 0 0 1 3.5 0Zm-1.747 9a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5Z" fill="currentColor"/></svg>',
}

export default ICONS
