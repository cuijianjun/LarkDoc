/** Inert share content shared by the editor and the cold UI without editor dependencies. */
import { safeUrl } from '../../../core/policy/url'
import { createNetworkPolicy, BLOCKED_IMAGE_PLACEHOLDER } from '../../../core/policy/network'

/** 「提示」二次确认的三句正文（⑤-2）。第 1 句原文在采集日志里被截断，
 *  这里按语义补齐句号（见文件头「待定」），第 2、3 句逐字照抄。 */
export const SECURE_CONFIRM_MESSAGES = Object.freeze([
  '当前文档仅内部用户可访问。该功能开启后，互联网上获得链接和密码的人都能够访问该文档。',
  '注意：有文档分享权限的外部用户，可查看协作者列表，请注意信息安全。',
  '具体说明及安全事项请查看服务协议和隐私政策。',
])

/** 加密链接开启后的 tip（⑤-3）。 */
export const SECURE_LINK_TIP = '已启用密码，组织外非协作者用户需要密码访问，组织内用户无需密码可直接访问'

function shareExcerptImageUrl(value, network) {
  // Browsers treat backslashes as URL separators; the shared policy's relative
  // path shortcut must not turn /\host into an offline/allowlisted image.
  return typeof value === 'string' && !value.includes('\\') && safeUrl(value, true) && network.allows(value) ? value : null
}

/** Inert static excerpts; only the core bookmark's single, gated image resource survives CSS cleanup. */
export function cloneShareExcerpt(source, network = createNetworkPolicy()) {
  const inert = source.ownerDocument.implementation.createHTMLDocument('')
  const clone = inert.importNode(source, true)
  const removed = 'script,style,link,meta,base,iframe,object,embed,video,audio,source,track,button,input,select,textarea,form,svg,math,template,noscript,canvas,[data-lark-doc-ui],[data-lark-doc-image-ui],[data-lark-doc-link-ui],[data-lark-doc-embed-ui],.column-resize-handle,.lark-doc-link-preview-resize'
  if (clone.matches(removed)) { const label = inert.createElement('div'); label.textContent = source.textContent; return label }
  clone.setAttribute('inert', '')
  clone.setAttribute('draggable', 'false')
  clone.querySelectorAll(removed).forEach(element => element.remove())
  for (const element of [clone, ...clone.querySelectorAll('*')]) {
    const bookmarkMedia = element.classList.contains('lark-doc-bookmark-cover') || element.classList.contains('lark-doc-bookmark-icon')
    // CSSOM supplies the canonical property, but escaped tokens and composite
    // images still fail closed. Rebuild one url() instead of retaining a style.
    const background = bookmarkMedia && element.style.getPropertyValue('background-image')
    const match = background && /^url\(\s*(?:"([^"\\]*)"|'([^'\\]*)'|([^\s"'()\\]+))\s*\)$/i.exec(background)
    const imageUrl = match && shareExcerptImageUrl(match[1] ?? match[2] ?? match[3], network)
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase()
      if (/^on/.test(name) || ['id', 'data-block-id', 'data-record-id', 'contenteditable', 'tabindex', 'href', 'xlink:href', 'srcset', 'srcdoc', 'poster', 'background', 'action', 'formaction', 'autofocus'].includes(name) || (name === 'src' && element.tagName !== 'IMG')) element.removeAttribute(attribute.name)
    }
    for (const property of Array.from(element.style || [])) {
      if (/url\s*\(|image-set\s*\(|expression|@import|\\/i.test(element.style.getPropertyValue(property)) || /^(?:background-image|border-image|list-style-image|mask|filter|clip-path|cursor|content)/.test(property)) element.style.removeProperty(property)
    }
    if (imageUrl) element.style.setProperty('background-image', `url("${imageUrl.replace(/"/g, '%22')}")`)
    if (element.tagName === 'IMG') {
      const src = element.getAttribute('src')
      if (!shareExcerptImageUrl(src, network)) element.setAttribute('src', BLOCKED_IMAGE_PLACEHOLDER)
    }
  }
  return clone
}

