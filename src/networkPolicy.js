/**
 * 统一的出网策略。
 *
 * 默认 open：正文里的外链图片（含老系统的 http 图床）直接按原地址加载，
 * 开箱即用。需要内网 / 公文 / 隐私场景时，宿主显式切到 'offline' 或
 * 'allowlist'，offline 下外链图片会降级为占位块。
 *
 * 静态资源（KaTeX 字体、高亮语法、Emoji 字形）始终随包发布，与网络策略无关。
 */

export const NETWORK_MODES = Object.freeze(['offline', 'allowlist', 'open'])

export const DEFAULT_NETWORK = Object.freeze({ mode: 'open', allowlist: [] })

/**
 * 被拦下的外链图片会换成这个 1x1 透明 GIF：它是本地 data URI，
 * 不会发起请求，同时保留 Tiptap 图片节点的结构，宿主可以后续上传替换。
 */
export const BLOCKED_IMAGE_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

function normalizeHost(value) {
  return String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
}

// 相对路径、data:、blob: 都属于本地资源，任何模式都放行。
export function isLocalUrl(value) {
  if (typeof value !== 'string' || !value) return true
  return /^(?:#|\/|\.{1,2}\/|data:|blob:)/i.test(value)
}

export function urlHost(value) {
  if (typeof value !== 'string' || !value) return ''
  try {
    return new URL(value, 'https://local.invalid').hostname.toLowerCase()
  } catch (_) {
    return ''
  }
}

function hostAllowed(host, allowlist) {
  if (!host) return false
  return allowlist.some((item) => host === item || host.endsWith(`.${item}`))
}

export function createNetworkPolicy(options = {}) {
  const source = options && typeof options === 'object' ? options : {}
  const mode = NETWORK_MODES.includes(source.mode) ? source.mode : DEFAULT_NETWORK.mode
  const allowlist = (Array.isArray(source.allowlist) ? source.allowlist : []).map(normalizeHost).filter(Boolean)
  const proxy = typeof source.imageProxy === 'function' ? source.imageProxy : null

  function allows(url) {
    if (isLocalUrl(url)) return true
    if (mode === 'open') return true
    if (mode === 'allowlist') return hostAllowed(urlHost(url), allowlist)
    return false
  }

  /**
   * 过滤 HTML 中的远端资源引用。必须在 sanitizeHTML 之后调用：
   * sanitizeHTML 负责删危险标签和白名单属性，这里只改写允许保留的 media 地址。
   */
  function filterHtml(html) {
    if (typeof html !== 'string' || typeof document === 'undefined') return html
    const container = document.createElement('div')
    container.innerHTML = html
    Array.from(container.querySelectorAll('img[src],source[src],video[src],audio[src]')).forEach((element) => {
      const src = element.getAttribute('src')
      if (allows(src)) return
      // 保留原地址供宿主后续上传替换；图片换成透明占位，避免浏览器发起请求。
      if (element.tagName === 'IMG') {
        if (!element.getAttribute('data-original-src')) element.setAttribute('data-original-src', src)
        element.setAttribute('data-network-blocked', 'true')
        element.setAttribute('src', BLOCKED_IMAGE_PLACEHOLDER)
        return
      }
      element.removeAttribute('src')
      element.setAttribute('data-network-blocked', 'true')
    })
    return container.innerHTML
  }

  /** 直接处理 Tiptap JSON：外链图片保留 originalSrc，src 换成透明占位。 */
  function applyDocument(json) {
    if (!json || typeof json !== 'object') return json
    const walk = (node) => {
      if (!node || typeof node !== 'object') return node
      if (node.type === 'image' && node.attrs && !allows(node.attrs.src)) {
        if (!node.attrs.originalSrc && node.attrs.src) node.attrs.originalSrc = node.attrs.src
        node.attrs.src = BLOCKED_IMAGE_PLACEHOLDER
      }
      if (Array.isArray(node.content)) node.content.forEach(walk)
      return node
    }
    return walk(JSON.parse(JSON.stringify(json)))
  }

  async function resolveImage(url) {
    if (allows(url)) return url
    if (!proxy) throw new Error('外链图片被离线策略拦截，且未提供 imageProxy')
    const local = await proxy(url)
    if (!allows(local)) throw new Error('imageProxy 未返回本地图片地址')
    return local
  }

  return {
    mode,
    allowlist,
    allows,
    filterHtml,
    applyDocument,
    resolveImage,
    describe: () => ({ mode, allowlist: allowlist.slice(), imageProxy: Boolean(proxy) }),
  }
}
