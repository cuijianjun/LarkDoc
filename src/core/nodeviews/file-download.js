/** `a[download]` 真正落盘：不进 iframe、不导航当前页。 */
function saveByAnchor(doc, href, name, revoke) {
  const view = doc.defaultView
  const anchor = doc.createElement('a')
  anchor.setAttribute('data-lark-doc-file-ui', '')
  anchor.setAttribute('aria-hidden', 'true')
  anchor.href = href
  anchor.download = name
  anchor.rel = 'noopener'
  anchor.style.display = 'none'
  doc.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  if (revoke && view?.URL?.revokeObjectURL) view.setTimeout(() => view.URL.revokeObjectURL(href), 1000)
}

/**
 * 飞书下载的本地等价物：飞书走「服务端附件地址 + Content-Disposition: attachment」，
 * 靠隐藏 iframe（010-docx_app_spa module 998866 的 `docs-open-link-iframe`）交给浏览器；
 * 本地没有那个端点，iframe 里塞 mp4 只会播起来、不落盘。
 * 所以本仓库自己取字节造 `a[download]`：**真下载，仍不开新页、不 window.open**。
 * 取不到字节（跨域无 CORS）时退回 iframe 那条老路，至少不会把当前页导航走。
 */
export async function downloadFile(doc, url, name, current) {
  const view = doc.defaultView
  if (typeof view?.fetch === 'function' && typeof view?.URL?.createObjectURL === 'function') {
    try {
      const response = await view.fetch(url, { credentials: 'same-origin' })
      if (response?.ok) {
        const blob = await response.blob()
        if (!current()) return
        if (blob && blob.size) { saveByAnchor(doc, view.URL.createObjectURL(blob), name, true); return }
      }
    } catch (_) { /* 跨域 / 离线 → 下面兜底 */ }
  }
  if (!current()) return
  let sameOrigin = false
  try { sameOrigin = new view.URL(url, doc.baseURI).origin === view.location.origin } catch (_) { sameOrigin = false }
  if (sameOrigin || url.startsWith('blob:') || url.startsWith('data:')) saveByAnchor(doc, url, name, false)
  else downloadByIframe(doc, url)
}

/** 兜底：隐藏 iframe 交给浏览器（同源直链缺 CORS 时也还能触发下载）。 */
function downloadByIframe(doc, url) {
  const view = doc.defaultView
  const frame = doc.createElement('iframe')
  frame.setAttribute('data-lark-doc-file-ui', '')
  frame.setAttribute('aria-hidden', 'true')
  frame.setAttribute('sandbox', 'allow-downloads')
  frame.setAttribute('referrerpolicy', 'no-referrer')
  frame.style.display = 'none'
  frame.style.width = '0'
  frame.style.height = '0'
  frame.style.border = '0'
  frame.src = url
  doc.body.appendChild(frame)
  // iframe 加载完（或失败）就摘掉：下载一旦被浏览器接管，节点去留无所谓。
  const cleanup = () => { if (frame.parentNode) frame.parentNode.removeChild(frame) }
  frame.addEventListener('load', cleanup, { once: true })
  frame.addEventListener('error', cleanup, { once: true })
  if (view?.setTimeout) view.setTimeout(cleanup, 30000)
}
