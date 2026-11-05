/**
 * 媒体在 HTML 产物里的两种呈现方式（`config.media.htmlMode`）。
 *
 *   - `inline`（默认）：图片 / 文件直接以本体出现在全文里 —— 走 schema 的 `renderHTML`，
 *     也是 `editor.getHTML()` 的原生产物。
 *   - `link`：上传完成后只保留**媒体地址**，不嵌本体。图片退化成一条链接（`<a href>`），
 *     文件块退化成一条带文件名 / 地址的链接。适用于把正文投递到邮件、报表、
 *     只允许纯文本 + 链接的第三方系统。
 *
 * 为什么不改 `renderHTML`：`renderHTML` 同时是编辑器 NodeView 之外唯一的序列化入口，
 * 且 `editor.getHTML()` 被 v-model 双向读写（`LarkDocEditor.vue` 的 `value` getter /
 * setter 靠「字符串是否相等于 `editor.getHTML()`」判定要不要回灌正文）。在 schema 层
 * 做开关会让「读到的 HTML」永远不等于「编辑器自认为的 HTML」，进而每次赋值都把图片
 * 冲成链接。所以这里做成**只在导出侧显式调用**的字符串后处理：
 * 默认 `getHTML()` 仍是原生产物，只有传了 `media.mode === 'link'` 才改写。
 *
 * 已知降级（写进文档）：链接态 HTML 再导回编辑器时，图片 / 文件会变成普通超链接文本，
 * 不再还原成媒体块 —— 要保留可逆性请用 JSON（`getJSON()` / `.json` 导出）。
 */

/** 允许改写成链接的媒体选择器（本体 + 容器）。 */
const MEDIA_SELECTORS = [
  'figure[data-type="image"]',
  'figure[data-type="file"]',
  'img',
  'video',
  'audio',
  'iframe',
  'embed',
  'object',
]

const MEDIA_TYPES = {
  img: 'image',
  video: 'video',
  audio: 'audio',
  iframe: 'embed',
  embed: 'embed',
  object: 'embed',
}

function mediaKindOf(el) {
  if (el.matches('figure[data-type="image"]')) return { type: 'image', source: el.querySelector('img') || el }
  if (el.matches('figure[data-type="file"]')) return { type: 'file', source: el }
  const tag = el.tagName.toLowerCase()
  // 已被外层 figure 收编的 img 不重复处理，交给外层容器统一出链接。
  if (tag === 'img' && el.closest('figure[data-type="image"]')) return null
  return { type: MEDIA_TYPES[tag] || 'media', source: el }
}

/** 取这条媒体真正的地址：优先 `src`，其次 `data-src`，再次 `data-original-src`。 */
function readMediaUrl(kind, el) {
  const pick = (node) => {
    if (!node || !node.getAttribute) return ''
    return node.getAttribute('src') || node.getAttribute('data-src') || node.getAttribute('data-original-src') || ''
  }
  if (kind.type === 'file') return pick(el)
  return pick(kind.source) || pick(el)
}

/** 链接文案：`config.media.linkText` 支持 `{name}` / `{url}` / `{type}` 占位，空则回落到地址本身。 */
function resolveLinkText(template, { name, url, type }) {
  const value = typeof template === 'string' ? template.trim() : ''
  if (!value) return name || url
  return value
    .replace(/\{name\}/g, name || '')
    .replace(/\{url\}/g, url)
    .replace(/\{type\}/g, type)
    .trim() || url
}

/**
 * 把 HTML 字符串里的媒体改写成纯地址链接。
 *
 * @param {string} html 已经由 schema 序列化出来的 HTML
 * @param {{ mode?: 'inline'|'link', linkText?: string, newTab?: boolean }} [options]
 * @returns {string}
 */
export function applyMediaHtmlMode(html, options = {}) {
  const mode = options.mode === 'link' ? 'link' : 'inline'
  if (mode === 'inline' || !html || typeof html !== 'string') return html
  if (typeof document === 'undefined') return html
  const template = options.linkText
  const newTab = options.newTab !== false

  const container = document.createElement('div')
  container.innerHTML = html

  const targets = container.querySelectorAll(MEDIA_SELECTORS.join(','))
  targets.forEach(el => {
    // 外层容器先被替换后，它内部的原生 img/video 已经离开文档树，直接跳过。
    if (!container.contains(el)) return
    const kind = mediaKindOf(el)
    if (!kind) return
    const url = readMediaUrl(kind, el)
    // 没有地址就说明这块本来就渲染不出东西（出网策略拦下 / 上传未完成），保持原样更好排查。
    if (!url) return
    // 名字优先取 `data-name`（文件块 / 上传后写回的原始文件名），图片退回 `alt`；
    // 都没有时 `{name}` 会渲染成空串，最终回落成地址本身。
    const name = el.getAttribute('data-name') || (kind.source && kind.source.getAttribute && kind.source.getAttribute('alt')) || ''
    const label = resolveLinkText(template, { name, url, type: kind.type })
    const anchor = document.createElement('a')
    anchor.setAttribute('href', url)
    anchor.setAttribute('class', 'lark-doc-media-link')
    anchor.setAttribute('data-media-type', kind.type)
    if (url !== label) anchor.setAttribute('title', url)
    if (newTab) {
      anchor.setAttribute('target', '_blank')
      anchor.setAttribute('rel', 'noopener noreferrer')
    }
    anchor.textContent = label
    // 块级媒体包一层 <p>，保证替换后仍是合法的块级内容（figure 不能直接塞行内 <a>）。
    const wrapper = document.createElement('p')
    wrapper.setAttribute('class', 'lark-doc-media-link-block')
    wrapper.setAttribute('data-media-type', kind.type)
    const blockId = el.getAttribute('data-block-id')
    if (blockId) wrapper.setAttribute('data-block-id', blockId)
    wrapper.appendChild(anchor)
    el.replaceWith(wrapper)
  })
  return container.innerHTML
}
