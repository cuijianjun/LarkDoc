/**
 * palette.js —— 色板常量表（T0-04）。
 *
 * ⚠️ 本文件是全库**唯一**允许出现字面 hex 的地方（`scripts/check-theme-tokens.js`
 * 的 `PALETTE_FILES` 白名单），其余组件一律用 `var(--ld-*)` 或引用本文件的常量。
 *
 * 为什么这些值不是主题 token：
 *   - `CALLOUT_COLOR_OPTIONS` / `TEXT_COLOR_OPTIONS` / `TEXT_BACKGROUND_ROWS` 是
 *     **用户内容色**（写进文档 HTML 的 inline style，随文档走，不随主题变），
 *     等价于飞书的「语义色板」——06 §1.5.1 要求浅/深各存一套，整组替换，
 *     而不是逐色改透明度。主题化在 T2/T3 通过「整表替换」实现，不拆成 CSS 变量。
 *   - `ICON_PALETTE` 是多色图标资源（高亮笔的黄色打底），属资源而非 UI 皮肤。
 *
 * 深色档（T2）扩展方式：给对应表加 `dark` 组，由主题引擎按当前档位取用；
 * 本文件当前只有浅色（默认档）一套。
 */

/* ---- 高亮块取色盘：9 色（06 §1.5 同族色板） ---- */
export const CALLOUT_COLOR_OPTIONS = [
  { label: '墨绿', value: '#263b35' }, { label: '薄荷绿', value: '#d8f3e5' }, { label: '青绿', value: '#00b887' },
  { label: '天空蓝', value: '#dbeafe' }, { label: '靛蓝', value: '#586bff' }, { label: '暖黄', value: '#fff2a8' },
  { label: '橙色', value: '#ffb35c' }, { label: '珊瑚红', value: '#f58a8a' }, { label: '淡紫', value: '#eadcff' },
]

/* ---- 行内字体色：8 色（06 §7.2.1 ①） ---- */
export const TEXT_COLOR_OPTIONS = [
  { label: '黑色', value: '#1f2329' }, { label: '灰色', value: '#646a73' }, { label: '红色', value: '#f54a45' },
  { label: '橙色', value: '#ff8800' }, { label: '黄色', value: '#dcad0c' }, { label: '绿色', value: '#00b42a' },
  { label: '蓝色', value: '#3491fa' }, { label: '紫色', value: '#722ed1' },
]

/* ---- 深色档（T3-03 / M5）：整组替换，不与浅色混用 ----
   取值全部落在 06 §1.5.1 batch91 实测的三行深档上，深纸上不发光（低饱和深底）：
     边框档    灰 #434343 红 #9E3836 橙 #BD7017 黄 #C7B300 绿 #339428 蓝 #2851A3 紫 #6533BD
     填充·深档 灰 #5F5F5F·50% 红 #6B2827 橙 #845117 黄 #877B10 绿 #296B22 蓝 #203E78 紫 #4D2691
     填充·浅档 灰 #373737·60% 红 #4A1D1B 橙 #57330A 黄 #5C5514 绿 #1F471B 蓝 #192A4C 紫 #361D61
   label 与浅色表一一对应（面板结构不变，只换色值）；同一支色在「文字/背景/边框」
   三个角色上共用（沿用浅色表的单表三角色模型）。
   ⚠️ 已知取舍：三个偏「墨」的深色作文字用时对比度偏低 —— 飞书 06 §1.5.1 的
   「字体颜色」行仍是「待补」，等实测补齐后改按角色分表。 */
export const CALLOUT_COLOR_OPTIONS_DARK = [
  { label: '墨绿', value: '#1F471B' }, { label: '薄荷绿', value: '#296B22' }, { label: '青绿', value: '#339428' },
  { label: '天空蓝', value: '#203E78' }, { label: '靛蓝', value: '#2851A3' }, { label: '暖黄', value: '#877B10' },
  { label: '橙色', value: '#845117' }, { label: '珊瑚红', value: '#6B2827' }, { label: '淡紫', value: '#4D2691' },
]

/* ---- 行内背景色：两行 × 9（06 §7.2.1 ②）；value 为空 = 默认（清除背景） ---- */
export const TEXT_BACKGROUND_ROWS = [
  [
    { label: '默认', value: '' },
    { label: '浅红', value: '#fbd0d0' }, { label: '浅橙', value: '#fbd3a1' }, { label: '浅黄', value: '#fdeab4' },
    { label: '浅绿', value: '#bfecc7' }, { label: '浅青', value: '#aee9e4' }, { label: '浅蓝', value: '#b8d8f8' },
    { label: '浅紫', value: '#d9c4f1' }, { label: '浅灰', value: '#d5d9dc' },
  ],
  [
    { label: '樱红', value: '#fde9e8' }, { label: '杏橙', value: '#fdeacc' }, { label: '鹅黄', value: '#fff7d1' },
    { label: '草绿', value: '#e2f7e6' }, { label: '薄荷', value: '#ddf7f4' }, { label: '天蓝', value: '#e3f0fd' },
    { label: '香芋', value: '#efe5fa' }, { label: '云灰', value: '#f2f3f5' }, { label: '白', value: '#ffffff' },
  ],
]

/* ---- 组件默认值（原生 color input 的初值 / 未应用状态的回填） ---- */
/** 行内文字默认色 = 正文主文字（与 --ld-text-content 同值，但用于写 inline style，不能取 var） */
export const DEFAULT_TEXT_COLOR = '#263b35'
/** 行内背景默认色 = 高亮盘「暖黄」（未应用时气泡条高亮按钮的展示色） */
export const DEFAULT_TEXT_BACKGROUND = '#fff2a8'
/** 高亮块默认三色：正文色 / 底色 / 边框色（与 lark-doc.css 的 callout 兜底值同值） */
export const DEFAULT_CALLOUT_COLORS = { color: '#263830', backgroundColor: '#eff9f4', borderColor: '#00b887' }
/** 深色一组（T3-03）：节点在未设属性时走 theme-dark.css 的 callout token，
    这里只用于颜色盘的默认值展示与原生 color input 回填，取值与 token 保持一致。 */
export const DEFAULT_CALLOUT_COLORS_DARK = { color: '#F0F0F0', backgroundColor: '#292929', borderColor: '#5F5F5F' }
/** 表格单元格背景的初值（表格工具条 color input） */
export const DEFAULT_CELL_BACKGROUND = '#f2faf6'

/* ---- 多色图标资源 ---- */
/** 高亮笔图标：黄色色块打底 + 深褐 A（其余图标一律 currentColor） */
export const ICON_PALETTE = { highlightSwatch: '#ffd50a', highlightGlyph: '#4a3b06' }

/* ---- 示例文档内容色（templates.js 的 sample 模板） ---- */
/** 示例段落里「绿色主题」四字的行内色（= 品牌绿）。属用户内容色：写进文档 inline style，随文档走不随主题变。 */
export const SAMPLE_CONTENT_BRAND = '#00b887'

/**
 * 按正文轨主题取高亮块色板 / 默认三色（T3-03 / M5）。
 * 06 §1.5.1 明确「深纸上是各自独立的一套去饱和暗色，不能靠亮度推导」——
 * 所以是**整组替换**，不是给浅色值套滤镜或改透明度。
 */
export function calloutColorOptions(theme) {
  return theme === 'dark' ? CALLOUT_COLOR_OPTIONS_DARK : CALLOUT_COLOR_OPTIONS
}
export function calloutDefaults(theme) {
  return theme === 'dark' ? DEFAULT_CALLOUT_COLORS_DARK : DEFAULT_CALLOUT_COLORS
}

export default {
  CALLOUT_COLOR_OPTIONS,
  CALLOUT_COLOR_OPTIONS_DARK,
  TEXT_COLOR_OPTIONS,
  TEXT_BACKGROUND_ROWS,
  DEFAULT_TEXT_COLOR,
  DEFAULT_TEXT_BACKGROUND,
  DEFAULT_CALLOUT_COLORS,
  DEFAULT_CALLOUT_COLORS_DARK,
  DEFAULT_CELL_BACKGROUND,
  ICON_PALETTE,
  SAMPLE_CONTENT_BRAND,
  calloutColorOptions,
  calloutDefaults,
}
