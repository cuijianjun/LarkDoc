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

// Android Feishu 8.6.9, physical App sheet captured 2026-11-14. Flat swatches
// and dominant glyph ink sampled from phone-real-native-color-panel.png.
export const MOBILE_TEXT_COLOR_OPTIONS = TEXT_COLOR_OPTIONS.map((item, index) => ({ ...item, value:
  ['#1f2329', '#8f959e', '#d83931', '#de7802', '#dc9b04', '#2ea121', '#245bdb', '#6425d0'][index] }))
export const MOBILE_TEXT_BACKGROUND_ROWS = [
  [
    { label: '默认', value: '' }, { label: '浅灰', value: '#e5e6e9' },
    { label: '浅红', value: '#fbbfbc' }, { label: '浅橙', value: '#feddb6' },
    { label: '浅黄', value: '#fff895' }, { label: '浅绿', value: '#c5f1c1' },
    { label: '浅蓝', value: '#cfddfe' }, { label: '浅紫', value: '#dcc9fc' },
  ],
  [
    { label: '灰白', value: '#f2f3f5' }, { label: '灰色', value: '#bbbfc4' },
    { label: '红色', value: '#f76964' }, { label: '橙色', value: '#ffa53d' },
    { label: '黄色', value: '#ffe928' }, { label: '绿色', value: '#62d256' },
    { label: '蓝色', value: '#9ebbfe' }, { label: '紫色', value: '#c4a4fa' },
  ],
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

/* ---- 小组件按钮色板：两行 × 8（02 §22 ④-4a 实测） ----
   浅组 / 深组各一行，不叫「背景/前景」——两组是同权重的 16 个可选底色，
   深组不是浅组的深色档（深纸按钮也用深组，浅纸按钮也能选深组）。
   `__item` 23×23 r5、列距 31（=23+8）、行距 29（=23+6），整块 52 = 23+6+23 不带 padding ——
   这些是面板几何，写在 .lark-doc 的 CSS 里；本表只负责色值本身。
   默认选中的是浅组第 5 个 `#E1EAFF`（浅蓝），与飞书初值一致。 */
export const BUTTON_COLOR_ROWS = [
  [
    { label: '浅红', value: '#fde2e2' }, { label: '浅橙', value: '#feead2' },
    { label: '浅绿', value: '#d9f5d6' }, { label: '浅青', value: '#d9f3fd' },
    { label: '浅蓝', value: '#e1eaff' }, { label: '浅粉', value: '#fdddef' },
    { label: '浅紫', value: '#ece2fe' }, { label: '浅灰', value: '#eff0f1' },
  ],
  [
    { label: '红', value: '#f76964' }, { label: '橙', value: '#ffa53d' },
    { label: '绿', value: '#62d256' }, { label: '青', value: '#14c0ff' },
    { label: '蓝', value: '#3370ff' }, { label: '粉', value: '#f14ba9' },
    { label: '紫', value: '#935af6' }, { label: '黑', value: '#2b2f36' },
  ],
]

/* ---- 组件默认值（原生 color input 的初值 / 未应用状态的回填） ---- */
/** 行内文字默认色 = 正文主文字（与 --ld-text-content 同值，但用于写 inline style，不能取 var） */
/** CSS 内容色名称在 Word 等无 CSS 环境中的 RGB 对照，不随 UI 主题变化。 */
export const CONTENT_NAMED_RGB = Object.freeze({ black: '000000', white: 'FFFFFF', red: 'FF0000', blue: '0000FF', green: '008000', yellow: 'FFFF00' })
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
/** 小组件按钮块默认底色 = 色板浅蓝（02 §22 ④-4a「默认选中」） */
export const DEFAULT_BUTTON_COLOR = '#e1eaff'

/* ---- 多色图标资源 ---- */
/** Multicolor sharing resources keep their measured logo colors. */
export const SHARE_ICON_COLORS = {
  larkTeal: "#00D6B9",
  larkBlue: "#3370FF",
  larkDeepBlue: "#133C9A",
  subscriptionWhite: "#fff",
  subscriptionLightPurple: "#827CFF",
  subscriptionPurple: "#675FF6",
  subscriptionMediumPurple: "#5B53F7",
  subscriptionDeepPurple: "#3B31E2",
  wechatDarkGreen: "#187E28",
  wechatGray: "#858C8C",
  wechatGreen: "#78D431",
  wechatLightGreen: "#9EEE69",
  wechatLightGray: "#E4E6E6",
  wechatWhite: "#F5F5FF",
}

/** 高亮笔图标：黄色色块打底 + 深褐 A（其余图标一律 currentColor） */
export const ICON_PALETTE = { highlightSwatch: '#ffd50a', highlightGlyph: '#4a3b06' }

/** 通知类多色图标资源（飞书截图实测取色）：云文档助手 logo、文档更新成功勾、通知空态插图。
 *  三处共用同一支「品牌蓝底 + 白前景」——这是图标资产的固有色，不是皮肤色，故不进 --ld-*。
 *  刻意拆成扁平字符串常量而不是一个对象：打包时字符串常量会在使用处被内联，
 *  对象字面量则会把整个对象搬进每个引用它的特性包（实测 uiOverlays 因此超预算 12 B）。 */
export const NOTIFY_BRAND_BLUE = '#3370FF'
// 空态插图里那两支深蓝/青绿弧线的实测值（截图 932×1286 直方图：#0D296E 1211 px、#01D6B9 3238 px）。
// 早前写的 #1F55D8 / #00D6A5 是目测近似，整图比对时会把弧线压出肉眼可见的偏色。
export const NOTIFY_DEEP_BLUE = '#0D296E'
export const NOTIFY_TEAL = '#01D6B9'
export const NOTIFY_SUCCESS_GREEN = '#34A853'
// 飞书 ud__notice-success  toast 固有色（真身截图直方图：底 228,250,225 / 边 49,166,69）。
// 与 NOTIFY_SUCCESS_GREEN（通知插图绿）不是同一个值，别复用。
export const TOAST_SUCCESS_BG = '#E4FAE1'
export const TOAST_SUCCESS_BORDER = '#32A645'
// 文档卡底色与卡内两条灰线：截图取样 #E1E2E4 / #8F959E（不是 #D8DADE / #F7F8FA）。
export const NOTIFY_CARD = '#E1E2E4'
export const NOTIFY_CARD_LINE = '#8F959E'
/** 品牌色底上的白（logo 页面 / 成功勾）。 */
export const NOTIFY_ON_BRAND = '#fff'

/** 二维码模块色：内容色而不是皮肤色——两档主题都不得反色，否则相机扫不出。
 *  所以不取 --ld-bg-*，刻意写死（与 SAMPLE_CONTENT_BRAND 同理）。 */
export const QR_CODE_LIGHT = '#ffffff'
export const QR_CODE_DARK = '#000000'

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
  BUTTON_COLOR_ROWS,
  DEFAULT_TEXT_COLOR,
  DEFAULT_TEXT_BACKGROUND,
  DEFAULT_CALLOUT_COLORS,
  DEFAULT_CALLOUT_COLORS_DARK,
  DEFAULT_CELL_BACKGROUND,
  DEFAULT_BUTTON_COLOR,
  ICON_PALETTE,
  SAMPLE_CONTENT_BRAND,
  calloutColorOptions,
  calloutDefaults,
}
