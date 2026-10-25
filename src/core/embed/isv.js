/**
 * 第三方文档小组件（ISV）的「数据与判定」层 —— `blocks/isv.js`（节点定义）、
 * `nodeviews/isv.js`（渲染）与按钮配置面板三处共用，避免互相 import 成环
 * （先例：`core/embed/web-embed.js`、`core/embed/calendar-event.js`）。
 *
 * 规格来源 requirements/02 §22（①~⑦ 全链），色值对照 06。
 *
 * 两个「块」共用同一个节点类型，靠 `kind` 分叉 —— 这是 02 §22 ⑦ 的直接结论：
 *
 *   - `catalog`（目录导航）：真飞书在 `web_offline` iframe 里跑，宿主 DOM 里
 *     **永远没有**目录节点（⑦ 采坑表第 3 条）。V1 无外网、CDN 不可达，所以按 ④-5
 *     的实测几何在宿主 DOM 里**复刻**（`ul>li>ul>li` 真嵌套，见下方树构造）。
 *   - `button`（按钮）：2026-10-25 人工 E2 复核推翻了「按钮也是 iframe」的推断 ——
 *     真机是宿主 `<span class="docx-button-component">`，72×26 的纯文本按钮（⑤-3）。
 *
 * 两者的 `instanceId` 都保留：真机上它是 iframe 的实例路由键（④-2），V1 虽然不设
 * `src`，但**导出成 HTML 再导回**、以及将来接真实 iframe 时都靠它区分实例。
 */

/** 02 §22 ④-2 实测的官方应用与构建指纹（`web_offline/<ts>_<hash>/index.html`）。 */
export const ISV_APP_ID = 'cli_a3f7707424af9013'
export const ISV_BUILD_TS = '1739190045157'
export const ISV_BUILD_HASH = 'rdmvet84k3s'
export const ISV_CDN_ORIGIN = 'https://lf-fb.feishupkg.com'

/**
 * 两种形态的 id（进 attrs，决定渲染分叉）。
 *
 * 不复用飞书的 `app_id` 做判据：按钮块在真机上根本不是 iframe，也没有 app。
 */
export const ISV_KINDS = { catalog: 'catalog', button: 'button' }

/** 对齐层 `isv-alignable-container` 的三个取值；02 §22 ④-1 实测默认 `left`（图片是 center）。 */
export const ISV_ALIGNS = ['left', 'center', 'right']

/** ①②③ 实测块高：目录导航 335、按钮块 222。真机上**由 iframe 自报不是常量**，这里只做默认值。 */
export const ISV_DEFAULT_HEIGHT = 335
export const ISV_BUTTON_HEIGHT = 222
export const ISV_MIN_HEIGHT = 60
export const ISV_MAX_HEIGHT = 4000

/** `uuid` 实例键的合法形状（④-2 实测是 UUID，这里放宽到 URL 安全字符集）。 */
export const ISV_INSTANCE_PATTERN = /^[A-Za-z0-9_-]{8,64}$/

/** 按钮文字上限：面板宽 270、单行 244 的输入框，14 号字约 20 字撑满。 */
export const BUTTON_TEXT_MAX = 20

/** 按钮组件默认文案（02 §22 ⑤-3 实测按钮文字就是「按钮」）。 */
export const BUTTON_TEXT_DEFAULT = '按钮'

/**
 * 「执行操作」三项（02 §22 ⑤-2）：`readOnly` 是**假只读**，仍可展开，浮层恰好 3 项。
 * id 与 06 § 接口层的 `action` 枚举一一对应（`open_link` / `duplicate_page` / `follow_page`）。
 */
export const ISV_BUTTON_ACTIONS = [
  { id: 'open_link', label: '打开超链接' },
  { id: 'duplicate_page', label: '创建副本' },
  { id: 'follow_page', label: '关注文档更新' },
]
export const BUTTON_ACTION_DEFAULT = 'open_link'

/** ⑤-1 校验失败文案（原文，别改写）。 */
export const ISV_VALIDATION_MESSAGE = '超链接不合法，请重新输入'

/** ⑤-1 必填两条：按钮文字 / 超链接地址；`*` 与报错同为 `rgb(245,74,69)`。 */
export const ISV_REQUIRED_FIELDS = ['buttonText', 'linkUrl']

/**
 * 按钮配置面板几何（02 §22 ④-4 实测，全部是自校验过的数）：
 *   `386 = 1 + 324 + 60 + 1`、`324 = 12 + 62 + 16 + 80 + 16 + 60 + 16 + 62`。
 *
 * `heightFor(action)`：`关注文档更新` 没有超链接行 → `386 − 62 − 16 = 308`。
 * `errorHeight`：校验失败时 +38（多出 explain 一行），面板**不关、块不插入**。
 */
export const ISV_PANEL = {
  width: 270,
  height: 386,
  followHeight: 308,
  errorHeight: 424,
  footerHeight: 60,
  contentHeight: 324,
  rowHeight: 62,
  colorRowHeight: 80,
  rowGap: 16,
  labelGap: 8,
  controlWidth: 244,
  pickerHeight: 52,
  swatchSize: 23,
  swatchGapX: 8,
  swatchGapY: 6,
  dropdownHeight: 102,
  dropdownItemHeight: 32,
  zIndex: 600,
}

/** 目录导航内层几何（02 §22 ④-5）：缩进恒 `6 + 16×(level−1)`，padding-right 恒 6。 */
export const CATALOG_INDENT_BASE = 6
export const CATALOG_INDENT_STEP = 16
export const CATALOG_PADDING_RIGHT = 6
export const CATALOG_ITEM_HEIGHT = 32
export const CATALOG_CONTAINER_PADDING = '25px 26px 20px'

/** 缩进像素：L1 6 / L2 22 / L3 38（④-5 实测三档）。 */
export function catalogIndent(level) {
  const depth = Math.max(1, Math.min(9, Number(level) || 1))
  return CATALOG_INDENT_BASE + CATALOG_INDENT_STEP * (depth - 1)
}

/** 只有一级标题是 500，二三级全是 400（④-5 实测）。 */
export function catalogFontWeight(level) {
  return Number(level) === 1 ? 500 : 400
}

/** 面板高度：`关注文档更新` 少一行；校验失败再加 explain 行。 */
export function isvPanelHeight(action, hasError) {
  const base = action === 'follow_page' ? ISV_PANEL.followHeight : ISV_PANEL.height
  return hasError ? base + (ISV_PANEL.errorHeight - ISV_PANEL.height) : base
}

/**
 * 实例键。**不用 `crypto`**（Node 14 无全局 `crypto.randomUUID`，且本库前端也跑在
 * 老宿主里）；时间戳 + 计数器 + 随机后缀足够避免同页重复，长度落在 `ISV_INSTANCE_PATTERN`。
 */
let instanceSeed = 0
export function isvInstanceId() {
  instanceSeed += 1
  const stamp = Date.now().toString(36)
  const seq = instanceSeed.toString(36)
  const salt = Math.random().toString(36).slice(2, 8)
  return `isv-${stamp}-${seq}-${salt}`
}

/** 真机 iframe 地址（④-2）。V1 不设 `src`，此函数留给「接真实小组件」时直接用。 */
export function isvEmbedUrl(appId, instanceId) {
  const app = safeIsvAppId(appId) && appId ? appId : ISV_APP_ID
  const uuid = safeIsvInstanceId(instanceId) && instanceId ? instanceId : isvInstanceId()
  return `${ISV_CDN_ORIGIN}/obj/larkdeveloper/app/${app}/current/web_offline/${ISV_BUILD_TS}_${ISV_BUILD_HASH}/index.html?uuid=${uuid}`
}

/* ---- 安全谓词：`null` / 空串一律放行（schema 的 default 就是它们） ---- */

export const safeIsvAppId = (value) => value === null || value === undefined || value === ''
  || (typeof value === 'string' && /^[A-Za-z0-9_-]{4,64}$/.test(value))

export const safeIsvInstanceId = (value) => value === null || value === undefined || value === ''
  || (typeof value === 'string' && ISV_INSTANCE_PATTERN.test(value))

export const safeIsvAlign = (value) => value === null || value === undefined || ISV_ALIGNS.includes(value)

export const safeIsvKind = (value) => value === null || value === undefined
  || ISV_KINDS[value] !== undefined

/** 高度：`null` 放行（落默认值），数字必须落在上下界内。 */
export const safeIsvHeight = (value) => value === null || value === undefined
  || (Number.isFinite(Number(value)) && Number(value) >= ISV_MIN_HEIGHT && Number(value) <= ISV_MAX_HEIGHT)

export const safeButtonText = (value) => value === null || value === undefined
  || (typeof value === 'string' && Array.from(value).length <= BUTTON_TEXT_MAX && !value.includes('\u0000'))

/** 底色只认 `#rgb` / `#rrggbb`（色板给的就是 6 位；写成 `rgb()` 会让 inline style 被 CSP 拦）。 */
export const safeButtonColor = (value) => value === null || value === undefined || value === ''
  || (typeof value === 'string' && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value))

export const safeButtonAction = (value) => value === null || value === undefined
  || ISV_BUTTON_ACTIONS.some((item) => item.id === value)

/**
 * 超链接合法性（⑤-1）。
 *
 * 只认 `http` / `https`：`javascript:` / `data:` 一律非法 —— 按钮点击是 `window.open`，
 * 放行它们等于把脚本执行权交给文档内容。`mailto:` / `tel:` 飞书也不收（实测同报「不合法」）。
 * 空串**非法**：`超链接地址` 是必填项（⑤-1 必填两条）。
 */
export function isButtonLinkValid(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return false
  if (!/^https?:\/\//i.test(text)) return false
  try {
    const url = new URL(text)
    return Boolean(url.hostname) && (url.protocol === 'http:' || url.protocol === 'https:')
  } catch (_) {
    return false
  }
}

/** 归一化链接：非法一律回空串，让上层用「空 = 未通过」判，不再各写一套正则。 */
export function normalizeButtonLink(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  return isButtonLinkValid(text) ? text : ''
}

/**
 * schema 谓词：空一律放行（目录块本就没有链接字段），有值必须是 `http(s)`。
 * 不放宽到任意字符串 —— 链接最终进 `window.open` / `href`，放行等于把跳转权交给文档内容。
 */
export const safeIsvLink = (value) => value === null || value === undefined || value === ''
  || isButtonLinkValid(value)

/** 一次校验：返回空数组 = 通过；否则是**出错字段名**列表（面板按字段加红框）。 */
export function validateIsvButton(input) {
  const source = input || {}
  const errors = []
  const text = typeof source.buttonText === 'string' ? source.buttonText.trim() : ''
  if (!text) errors.push('buttonText')
  // `关注文档更新` 不需要链接（面板上那一行本来就不在），别把它判成必填缺失。
  if ((source.action || BUTTON_ACTION_DEFAULT) === 'open_link' && !isButtonLinkValid(source.linkUrl)) errors.push('linkUrl')
  return errors
}

/** 对齐值 → 默认值。空 / 非法一律 `left`（④-1：对齐层默认就是 left）。 */
export function readIsvAlign(value) {
  return ISV_ALIGNS.includes(value) ? value : 'left'
}

/** 高度 → 兜底值：按 kind 给 335 / 222。 */
export function resolveIsvHeight(attrs) {
  const source = attrs || {}
  const height = Number(source.height)
  if (Number.isFinite(height) && height >= ISV_MIN_HEIGHT && height <= ISV_MAX_HEIGHT) return Math.round(height)
  return source.kind === ISV_KINDS.button ? ISV_BUTTON_HEIGHT : ISV_DEFAULT_HEIGHT
}

/**
 * 属性 → 渲染用的归一形状。
 *
 * `null` 只在**实例键**缺失时返回：没有 `instanceId` 的块无法区分实例、也无法导出还原，
 * 按 `calendar_event` 的口径画「数据缺失」而不是画一个假组件。
 */
export function readIsv(attrs) {
  const source = attrs || {}
  if (!safeIsvInstanceId(source.instanceId) || !source.instanceId) return null
  const kind = ISV_KINDS[source.kind] ? source.kind : ISV_KINDS.catalog
  const action = safeButtonAction(source.action) && source.action ? source.action : BUTTON_ACTION_DEFAULT
  const isButton = kind === ISV_KINDS.button
  return {
    kind,
    instanceId: source.instanceId,
    appId: safeIsvAppId(source.appId) && source.appId ? source.appId : ISV_APP_ID,
    align: readIsvAlign(source.align),
    height: resolveIsvHeight({ ...source, kind }),
    buttonText: isButton ? (String(source.buttonText || '').trim() || BUTTON_TEXT_DEFAULT) : '',
    buttonColor: isButton ? (source.buttonColor || '') : '',
    action,
    linkUrl: isButton && action === 'open_link' ? normalizeButtonLink(source.linkUrl) : '',
  }
}

/**
 * 插入入口的归一化：面板 / 命令给的入参 → 完整 attrs。
 *
 * 与 `readIsv` 的差别是**它会造 `instanceId`**（`readIsv` 只判不造），所以只给写入侧用。
 */
export function normalizeIsv(input) {
  const source = input || {}
  const kind = ISV_KINDS[source.kind] ? source.kind : ISV_KINDS.catalog
  const action = safeButtonAction(source.action) && source.action ? source.action : BUTTON_ACTION_DEFAULT
  return {
    kind,
    instanceId: safeIsvInstanceId(source.instanceId) && source.instanceId ? source.instanceId : isvInstanceId(),
    appId: safeIsvAppId(source.appId) && source.appId ? source.appId : ISV_APP_ID,
    align: readIsvAlign(source.align),
    height: resolveIsvHeight({ ...source, kind }),
    buttonText: kind === ISV_KINDS.button ? (String(source.buttonText || '').trim() || BUTTON_TEXT_DEFAULT) : '',
    buttonColor: kind === ISV_KINDS.button ? (source.buttonColor || '') : '',
    action: kind === ISV_KINDS.button ? action : BUTTON_ACTION_DEFAULT,
    linkUrl: kind === ISV_KINDS.button && action === 'open_link' ? normalizeButtonLink(source.linkUrl) : '',
  }
}

/**
 * 大纲条目 → 目录树。
 *
 * 🔴 **必须真嵌套**：④-5 实测「父 item 高度 = 32 + 后代之和」（217 那条 96 = 32 + 64），
 * 说明每个 `.catalog-item` 是包住子级的容器，不是同层平铺 —— 平铺会让整块高度对不上。
 *
 * @param {Array<{pos:number, level:number, text:string}>} items `collectOutline(doc)` 的产物
 */
export function buildCatalogTree(items) {
  const roots = []
  const stack = []
  ;(Array.isArray(items) ? items : []).forEach((item, index) => {
    const level = Math.max(1, Number(item.level) || 1)
    const entry = { id: `catalog-${index}`, pos: item.pos, level, text: item.text || '', children: [] }
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop()
    if (stack.length) stack[stack.length - 1].children.push(entry)
    else roots.push(entry)
    stack.push(entry)
  })
  return roots
}

/** 树 → 扁平可渲染序列（含层级），供 NodeView 一层循环画完，避免递归 DOM 建造。 */
export function flattenCatalogTree(tree, depth = 0) {
  const out = []
  ;(Array.isArray(tree) ? tree : []).forEach((node) => {
    out.push({ ...node, depth, leaves: node.children.length })
    flattenCatalogTree(node.children, depth + 1).forEach((child) => out.push(child))
  })
  return out
}
