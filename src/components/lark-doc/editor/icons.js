/**
 * 工具栏 SVG 图标库：16×16、stroke 使用 currentColor（自动跟随激活态变色）、
 * 圆角线帽，风格对齐飞书扁平线性图标。经 LarkDocIcon 组件渲染，禁止直接内嵌
 * 到模板字符串里拼 HTML。
 */
// 多色图标资源（唯一不用 currentColor 的地方）走色板常量表，见 palette.js（T0-04）。
import { ICON_PALETTE } from './palette'

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
}

export default ICONS
