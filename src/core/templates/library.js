/**
 * 文档模板库（P5-07）—— 宿主侧「模板库」弹窗的数据与几何。
 *
 * 规格来源：02 §28（batch414–422 九探）。三条必须记住的结论：
 *
 *   1. 🔴 **入口不在编辑器里**。编辑器页内 `nTpl=0` / `nBar=0`、侧栏也不给入口；
 *      唯一真入口是**云盘首页**「新建 / 上传 / 模板库」三卡里的第三张。
 *      ⇒ 本文件与 `TemplateLibrary.vue` 是**可嵌入宿主的独立组件**，
 *      不挂进 `LarkDocEditor`，也不进斜杠菜单。编辑器里加任何模板入口都是错。
 *   2. 🔴 **「使用模板」= 复制一整篇文档**，不是「拿模板 JSON 逐块 insert」。
 *      实测请求是 `POST /space/api/wiki/v2/tree/create_node/`，落点 `/wiki/{nodeId}`，
 *      新 tab 首屏写着「正在创建副本，请稍候」。⇒ 组件只 `emit('use', template)`，
 *      复制由宿主做；组件内**绝不能**出现 `insertContent` / 块数组灌入。
 *   3. 🔴 **缩略图不复刻 `blob:` 机制**。飞书 24 张卡的 `img.src` 全是
 *      `URL.createObjectURL` 造的、原始 URL 不可得 ⇒ 用宿主自己的静态图。
 *
 * 颜色为什么不走 `--ld-*` token：这是**宿主侧**（云盘首页）UI，固定飞书云盘外观，
 * 不随编辑器的三档主题变。所以这里直接写 02 §28 的实测 rgb/rgba 值
 * （token 校验只拦字面 hex 与 `white` 关键字，rgb/rgba 不算违例）。
 * 别「顺手统一成 token」—— 那会让宿主换主题时模板库跟着变色，与飞书不一致。
 */

/** 弹窗几何（02 §28.2 / §28.8-2：`calc(100% - 284px) × calc(100% - 84px)`）。 */
export const TEMPLATE_MODAL = Object.freeze({
  /** 视口 1512 下实测 1229×866 = 1512−283 / 950−84。 */
  widthInset: 284,
  heightInset: 84,
  radius: 8,
  /** `ud__modal__body` 的灰底，白卡浮在灰上。 */
  bodyBg: 'rgb(248, 249, 250)',
  mask: 'rgba(0, 0, 0, 0.55)',
})

/** header 三段（02 §28.3）。搜索框在**正中**，不是右对齐。 */
export const TEMPLATE_HEADER = Object.freeze({
  height: 62,
  searchWidth: 340,
  searchHeight: 30,
  searchRadius: 6,
  searchBorder: '1px solid rgb(208, 211, 214)',
  searchBg: 'rgb(248, 249, 250)',
  closeSize: 32,
})

/** 左栏（02 §28.4）：196 固定宽、item 36 高。 */
export const TEMPLATE_SIDEBAR = Object.freeze({
  width: 196,
  paddingTop: 17,
  paddingBottom: 8,
  itemHeight: 36,
  itemRadius: 6,
  itemMargin: '0 8px 1px',
  /** 激活态：`rgba(20,86,240,.1)` 底 + `rgb(51,109,244)` 字。 */
  activeBg: 'rgba(20, 86, 240, 0.1)',
  activeColor: 'rgb(51, 109, 244)',
})

/** 卡片网格（02 §28.5）：226×256、4 列、间距 24、可视区左右各留 24。 */
export const TEMPLATE_GRID = Object.freeze({
  columns: 4,
  cardWidth: 226,
  cardHeight: 256,
  gap: 24,
  rowGap: 24,
  padding: 24,
  /** 卡内三段：40 标题条 + 182 缩略图 + 34 底栏 = 256。 */
  titleHeight: 40,
  thumbHeight: 182,
  bottomHeight: 34,
  radius: 8,
  thumbRadius: 6,
  /** 静态三叠阴影（02 §28.5 实测）。 */
  shadow: 'rgba(31, 35, 41, 0.03) 0 4px 16px 4px, rgba(31, 35, 41, 0.02) 0 4px 8px 0, rgba(31, 35, 41, 0.02) 0 2px 4px -4px',
  /** hover 三叠阴影（02 §28.6 ①）。 */
  shadowHover: 'rgba(31, 35, 41, 0.04) 0 10px 36px 10px, rgba(31, 35, 41, 0.04) 0 8px 24px 0, rgba(31, 35, 41, 0.06) 0 6px 12px -10px',
  /** hover 两段同步的时长与缓动（02 §28.6：都是 `0.15s linear`，不是 ease）。 */
  transition: 'box-shadow 0.15s linear, transform 0.15s linear',
  /** 卡上浮 8px；操作条从 +10px 滑到 0。 */
  hoverLift: -8,
  actionSlide: 10,
  /** 底栏两枚按钮：97 宽、间距 8、左距 12。 */
  actionButtonWidth: 97,
  actionButtonHeight: 32,
  actionButtonGap: 8,
})

/**
 * 23 个**稳定**分类（02 §28.4）。顺序 = DOM 顺序，别按字母重排。
 *
 * `group` 只用于左栏的分段视觉，不参与业务；`id` 是给宿主回传的稳定键
 * （中文名会改，id 不该改）。
 */
export const TEMPLATE_STABLE_CATEGORIES = Object.freeze([
  { id: 'mine', group: '我的', label: '我的模板' },
  { id: 'shared', group: '我的', label: '与我共享' },
  { id: 'recommend', group: '推荐', label: '推荐' },
  { id: 'dashboard', group: '专区', label: '仪表盘专区' },
  { id: 'hot', group: '专区', label: '热门模板' },
  { id: 'miniApp', group: '专区', label: '小程序专区' },
  { id: 'ecommerce', group: '场景', label: '电商' },
  { id: 'pm', group: '场景', label: '项目管理' },
  { id: 'office', group: '场景', label: '办公常用' },
  { id: 'weekly', group: '场景', label: '周报日报' },
  { id: 'meeting', group: '场景', label: '会议' },
  { id: 'okr', group: '场景', label: 'OKR' },
  { id: 'rd', group: '场景', label: '研发' },
  { id: 'collection', group: '场景', label: '信息收集与记录' },
  { id: 'product', group: '场景', label: '产品' },
  { id: 'design', group: '场景', label: '设计' },
  { id: 'operation', group: '场景', label: '运营' },
  { id: 'marketing', group: '场景', label: '市场' },
  { id: 'sales', group: '场景', label: '销售' },
  { id: 'hr', group: '场景', label: 'HR' },
  { id: 'admin', group: '场景', label: '行政' },
  { id: 'personal', group: '场景', label: '个人' },
  { id: 'other', group: '场景', label: '其他' },
])

/**
 * 8 个**运营位**的缺省值（02 §28.4 带 emoji 的那 8 项）。
 *
 * 🔴 规格原话：「带 emoji 的 8 项是**运营位**（顺序会变），V1 **不要硬编码**这 8 个」。
 * 所以这里只作**缺省**：宿主传 `promoCategories` 就整组替换，`promo: true` 的项
 * 由组件按 `anchorAfter` 插进稳定分类之间（DOM 顺序见 02 §28.4 的表序）。
 */
export const TEMPLATE_PROMO_DEFAULTS = Object.freeze([
  { id: 'promo-latest', group: '推荐', label: '🆕 最新', anchorAfter: 'recommend' },
  { id: 'promo-ai-template', group: '推荐', label: '🌟 AI 模板', anchorAfter: 'promo-latest' },
  { id: 'promo-ai-page', group: '专区', label: '🌐 AI 页面专区', anchorAfter: 'recommend' },
  { id: 'promo-ai-flow', group: '专区', label: '🤖 AI 工作流专区', anchorAfter: 'promo-ai-page' },
  { id: 'promo-query', group: '专区', label: '📖 查询页面专区', anchorAfter: 'dashboard' },
  { id: 'promo-survey', group: '专区', label: '🧑‍💻 问卷专区', anchorAfter: 'hot' },
  { id: 'promo-solution', group: '专区', label: '✍️ 解决方案专区', anchorAfter: 'miniApp' },
  { id: 'promo-elite', group: '专区', label: '🔥 先进团队实践', anchorAfter: 'promo-solution' },
])

/** 分类总数（02 §28.4：2 + 3 + 9 + 17 = 31）。 */
export const TEMPLATE_CATEGORY_TOTAL = TEMPLATE_STABLE_CATEGORIES.length + TEMPLATE_PROMO_DEFAULTS.length

/** 卡片默认高度与标题字号（02 §28.5）。 */
export const TEMPLATE_TEXT = Object.freeze({
  name: { size: 15, weight: 500, color: 'rgb(31, 35, 41)' },
  meta: { size: 12, weight: 400, color: 'rgb(100, 106, 115)' },
})

/**
 * 合并稳定分类与运营位 → 左栏的完整渲染顺序。
 *
 * 用 `anchorAfter` 而不是「按 group 分组再排」：02 §28.4 的表是**逐项 DOM 顺序**，
 * 运营位嵌在稳定项之间（如 `📖 查询页面专区` 在 `仪表盘专区` 之后、`热门模板` 之前）。
 * 按 group 重排会把这个顺序打散，左栏看着就像另一套菜单。
 */
export function buildCategoryList(promo = TEMPLATE_PROMO_DEFAULTS) {
  const list = TEMPLATE_STABLE_CATEGORIES.map((item) => ({ ...item, promo: false }))
  const extras = Array.isArray(promo) ? promo : []
  // 逐个插：锚点可能是刚插进去的运营位，所以每插一个都要重新找一次。
  for (const item of extras) {
    if (!item || !item.id) continue
    const at = item.anchorAfter ? list.findIndex((entry) => entry.id === item.anchorAfter) : -1
    const node = { id: item.id, group: item.group, label: item.label, promo: true }
    if (at >= 0) list.splice(at + 1, 0, node)
    else list.push(node)
  }
  return list
}

/** 卡片形状归一：宿主给的数据千奇百怪，渲染层只认这四个字段。 */
export function normalizeTemplate(input) {
  if (!input || typeof input !== 'object') return null
  const id = typeof input.id === 'string' ? input.id.trim() : ''
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!id || !name) return null
  return {
    id,
    name,
    thumb: typeof input.thumb === 'string' ? input.thumb : '',
    meta: typeof input.meta === 'string' ? input.meta : '',
  }
}

/**
 * 按分类过滤。
 *
 * 语义与组件保持一处：**没打 `categories` 标签的卡在每个分类里都露出来**
 * （比「全都看不见」好用）；`categoryId` 为空 = 全部。
 * 先按原始数据筛再归一，不做「归一后拿 id 回查原表」——重复 id 会取错条，且是 O(n²)。
 */
export function templatesOf(list, categoryId) {
  const source = Array.isArray(list) ? list : []
  const picked = categoryId
    ? source.filter((entry) => {
      const tags = entry && Array.isArray(entry.categories) ? entry.categories : []
      return tags.length === 0 || tags.indexOf(categoryId) !== -1
    })
    : source
  return picked.map(normalizeTemplate).filter(Boolean)
}

/** 关键词过滤（搜索框）：名称 + meta，大小写不敏感。 */
export function searchTemplates(list, keyword) {
  const needle = String(keyword || '').trim().toLocaleLowerCase()
  if (!needle) return Array.isArray(list) ? list : []
  return (Array.isArray(list) ? list : []).filter((item) => {
    if (!item) return false
    return `${item.name || ''} ${item.meta || ''}`.toLocaleLowerCase().indexOf(needle) !== -1
  })
}
