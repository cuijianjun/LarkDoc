/**
 * 网页卡片契约与共享 markup（`bookmark`）—— requirements/02 §24、09 §265。
 *
 * 本文件同时是**两条路**的唯一出处，块定义（`core/blocks/bookmark.js`）与
 * NodeView（`core/nodeviews/bookmark.js`）都从这里取，不各写一份：
 *
 *   1. **契约层**：URL 闸门（只认 http(s)）、文本裁切、`recordId` 生成、宽容读路径。
 *   2. **markup 层**：`renderBookmarkCard()` 产出可交给 `DOMSerializer.renderSpec`
 *      的 spec —— `renderHTML` 用它出导出产物，NodeView 用它出骨架态。
 *
 * 三条硬口径（02 §24 实测，别按直觉改）：
 *
 *   - **卡内没有 `a` / `button`**：点击是整卡的 `window.open`（NodeView 实现），
 *     所以导出产物里不要塞任何可交互元素，否则 PDF/DOCX 里就是一堆假按钮。
 *   - **favicon 是 `span` + inline `background-image`，不是 `img`**（飞书 CDN 中转）；
 *     没有 favicon 时该 `span` **根本不渲染** —— 不是透明占位。URL 左缘仍从 info 的
 *     左 padding 起（不吃 icon 位，不左移）。
 *   - **两档高度是内容长出来的**，不是写死的 box：简卡 74 = `12×2 + 20(url) + 4 + 24(detail) + 2(border)`，
 *     富卡 113 = 同式但 detail 63（title 1 行 + summary 2 行）。CSS 按这组数字落地，
 *     这里只留常量供测试与注释引用。
 *
 * ⚠️ 所有 spec 的 children **必须展平**（`['div', attrs, childA, childB]`）。把子
 * spec 收成一个数组当第三位会被 `renderSpec` 递归当成单个 spec，然后因 `structure[0]`
 * 不是字符串抛 `RangeError: Invalid array passed to renderSpec` —— 该错误只在序列化时
 * 触发（`getHTML()` / PDF / DOCX），编辑器里完全看不出来。P3-04 踩过一次（见
 * `core/blocks/card-embed.js` 的注释），别再来第二次。
 */
import { safeUrl } from '../documentOperations'

/** 契约版本（与 `cardSchema.cardVersion` 同思路：形状变了才动这个数）。 */
export const BOOKMARK_VERSION = 1

export const BOOKMARK_LIMITS = Object.freeze({
  url: 2048,
  title: 300,
  desc: 2000,
})

/** 三态块高（02 §24 ③-ter / ③-quinquies 实测值；CSS 若改高度，这里同步改）。 */
export const BOOKMARK_HEIGHTS = Object.freeze({ loading: 122, simple: 74, rich: 113 })

/** 卡片档位：`simple` 只有标题、`rich` 多两行摘要、`loading` 是骨架。 */
export const BOOKMARK_VARIANT = Object.freeze({ simple: 'simple', rich: 'rich', loading: 'loading' })

/** `data-record-id`：每卡唯一（飞书用它标识一条抓取记录，不是块 id）。与块 id 同字符集。 */
export const RECORD_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

const HTTP_RE = /^https?:\/\//i

/**
 * URL 闸门：只认 http(s)。`safeUrl` 还放行 `mailto:` / `tel:` / `#anchor`
 * （那是给行内链接和动作 href 用的），网页卡片拿这些当 `src` 是错的数据。
 */
export function readBookmarkUrl(value) {
  if (typeof value !== 'string') return null
  const url = value.trim()
  if (!url || url.length > BOOKMARK_LIMITS.url) return null
  if (!HTTP_RE.test(url)) return null
  return safeUrl(url) ? url : null
}

/** 显示用域名；解析不出来返回空串（渲染层再回落到 URL 本身）。 */
export function readBookmarkHost(url) {
  const value = typeof url === 'string' ? url.trim() : ''
  if (!value) return ''
  try {
    return (new URL(value).hostname || '').toLowerCase()
  } catch (_) {
    return ''
  }
}

/** 文本字段统一裁切：折行空白压成单空格（OG 描述里的换行不该把卡片撑成三行）。 */
export function readBookmarkText(value, limit) {
  if (typeof value !== 'string') return ''
  const text = value.replace(/\s+/g, ' ').trim()
  if (!text) return ''
  const chars = Array.from(text)
  return chars.length > limit ? chars.slice(0, limit).join('').trim() : text
}

let recordSeed = 0

/** 每卡唯一、无需服务端：时间戳 + 进程内自增 + 随机尾巴（都在 `RECORD_ID_PATTERN` 字符集里）。 */
export function createRecordId() {
  recordSeed += 1
  return `bk${Date.now().toString(36)}${recordSeed.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/**
 * 写路径（**严格**）：URL 不合格返回 null，由 `setBookmark` 转成「命令返回 false」。
 * 标题 / 摘要 / favicon 不合格只丢掉自己，不连坐整块 —— 抓回来的 OG 有噪声是常态。
 */
export function normalizeBookmark(input) {
  const raw = input && typeof input === 'object' ? input : {}
  // 兼容 `resolveEmbed()` 的出口形状（`{ kind: 'bookmark', attrs: { src } }`），
  // 让上层不必为「预设没命中的链接」写第二条插入路径 —— 整包塞进来也能吃。
  const source = raw.attrs && typeof raw.attrs === 'object' ? raw.attrs : raw
  const url = readBookmarkUrl(source.url || source.src)
  if (!url) return null
  const title = readBookmarkText(source.title, BOOKMARK_LIMITS.title)
  const desc = readBookmarkText(source.desc, BOOKMARK_LIMITS.desc)
  const favicon = readBookmarkUrl(source.favicon)
  const recordId = typeof source.recordId === 'string' && RECORD_ID_PATTERN.test(source.recordId)
    ? source.recordId
    : createRecordId()
  return { url, title: title || null, desc: desc || null, favicon, recordId }
}

/**
 * 读路径（**宽容**）：绝不抛错，只返回自己认识的东西。渲染层的每次调用都可能是
 * 「别人写的、比我们新的」数据 —— 这里抛错等于打开文档就白屏（同 `readCard` 口径）。
 */
export function readBookmark(attrs) {
  const source = attrs && typeof attrs === 'object' ? attrs : {}
  const url = readBookmarkUrl(source.url)
  if (!url) return null
  const title = readBookmarkText(source.title, BOOKMARK_LIMITS.title)
  const desc = readBookmarkText(source.desc, BOOKMARK_LIMITS.desc)
  return {
    url,
    host: readBookmarkHost(url),
    title,
    desc,
    favicon: readBookmarkUrl(source.favicon),
    variant: desc ? BOOKMARK_VARIANT.rich : BOOKMARK_VARIANT.simple,
  }
}

/** 元数据三元组（unfurl 结果 / `updateBookmarkMeta` 入参共用）；缺项一律 null。 */
export function readBookmarkMeta(value) {
  const source = value && typeof value === 'object' ? value : {}
  return {
    title: readBookmarkText(source.title, BOOKMARK_LIMITS.title) || null,
    desc: readBookmarkText(source.desc, BOOKMARK_LIMITS.desc) || null,
    favicon: readBookmarkUrl(source.favicon),
  }
}

/* ------------------------------------------------------------------ markup */

/** inline style 里的 URL 转义：只处理会截断 `url("...")` 的三个字符。 */
function escapeCssUrl(value) {
  return String(value)
    .replace(/"/g, '%22')
    .replace(/\\/g, '%5C')
    .replace(/[\r\n]/g, '')
}

function iconSpec(favicon, extraClass) {
  if (!favicon) return null
  return ['span', {
    class: extraClass ? `lark-doc-bookmark-icon ${extraClass}` : 'lark-doc-bookmark-icon',
    'aria-hidden': 'true',
    // 与导出产物同一条路：`background-image` 出图，图挂了只是没有图，不会破 icon。
    style: `background-image: url("${escapeCssUrl(favicon)}")`,
  }]
}

function skeletonRow(maxWidth) {
  // 宽度是 `max-width` 而不是 `width`：前短后长靠父层裁切出「宽度不一」的观感（02 §24 ③-quater）。
  return ['div', { class: 'lark-doc-bookmark-skeleton-item', style: `max-width: ${maxWidth}px` }]
}

/**
 * 卡片内层壳链（`wrapper → content → card`）的统一产出。
 *
 * `variant` 传 `'loading'` 时出骨架态（122 高），否则按 `bookmark.variant` 出简卡 / 富卡。
 * 骨架态**只在编辑器里出现**：`renderHTML` 永远传 ready 档，导出产物里不该有骨架。
 */
export function renderBookmarkCard(bookmark, variant) {
  const shell = (className, children) => ['div', { class: className }, ...children]

  if (variant === BOOKMARK_VARIANT.loading) {
    return shell('lark-doc-bookmark-wrapper', [
      shell('lark-doc-bookmark-content', [
        ['div', { class: 'lark-doc-bookmark-card', 'data-bookmark-variant': BOOKMARK_VARIANT.loading },
          ['span', { class: 'lark-doc-bookmark-icon is-skeleton', 'aria-hidden': 'true' }],
          skeletonRow(350),
          skeletonRow(576),
          skeletonRow(576)],
      ]),
    ])
  }

  const data = bookmark || {}
  const urlChildren = []
  const icon = iconSpec(data.favicon)
  if (icon) urlChildren.push(icon)
  urlChildren.push(['span', { class: 'lark-doc-bookmark-url' }, data.url || ''])

  const detailChildren = [['span', { class: 'lark-doc-bookmark-title' }, data.title || data.host || '']]
  // 标题与摘要之间是**真 `<br>`**，不是 block（02 §24 ②：飞书原生就是 `<br>`，行高才连得上）。
  if (data.desc) detailChildren.push(['br'], ['span', { class: 'lark-doc-bookmark-summary' }, data.desc])

  return shell('lark-doc-bookmark-wrapper', [
    shell('lark-doc-bookmark-content', [
      ['div', {
        class: 'lark-doc-bookmark-card',
        'data-bookmark-variant': data.variant || BOOKMARK_VARIANT.simple,
        // 整卡就是链接：飞书卡内没有 `a`，点击由 JS `window.open` 完成。
        // `role` / `tabindex` 是 V1 补的无障碍入口（飞书实测没有，纯增强，不影响排版）。
        role: 'link',
        tabindex: '0',
      },
      ['div', { class: 'lark-doc-bookmark-info' },
        ['div', { class: 'lark-doc-bookmark-url-wrapper' }, ...urlChildren],
        ['div', { class: 'lark-doc-bookmark-detail' }, ...detailChildren]],
      ],
    ]),
  ])
}
