/**
 * 工具栏 SVG 图标库：16×16、stroke 使用 currentColor（自动跟随激活态变色）、
 * 圆角线帽，风格对齐飞书扁平线性图标。经 FeishuIcon 组件渲染，禁止直接内嵌
 * 到模板字符串里拼 HTML。
 */
const S = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"'
const wrap = (inner, extra = '') => `<svg ${S} ${extra}>${inner}</svg>`

export const ICONS = {
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
  close: wrap('<path d="m4.6 4.6 6.8 6.8"/><path d="m11.4 4.6-6.8 6.8"/>'),
}

export default ICONS
