/**
 * 文件 / 视频块 NodeView —— 纯 DOM，core 零 UI 框架依赖（P2-04）。
 *
 * 规格来源 02 §19.5：
 *   - 块壳 534×453（默认栏）：`453 = preview 409 + footer 42 + 2(border)`，
 *     宽 `534 = preview 532 + 2`；容器 8px 圆角、iframe 只圆上方两角；
 *   - **三种形态同一个壳**：`video/*` → 播放器、`application/pdf` → iframe
 *     viewer、其余 → 卡片 + 下载。形态由 `mimeType` 决定，不新增节点类型；
 *   - **失败态照常落块**（与图片相反）：预览元素报错就换兜底文案 + 保留下载入口。
 *     文案按形态分两套（③-octies B 段实测视频那一套字不一样）；
 *   - 上传中态**不做**：③-quinquies 实测飞书 90 秒窗口内零进度、零 toast，
 *     上传完成前页面什么都不变就是 1:1 行为。
 *
 * 状态判据（③-ter）刻意**不从 DOM 类名反推**：`status` 只由预览元素自己的事件
 * （video 的 `error` / `loadeddata`）驱动，避免「成功/失败/上传中三态都挂同一个
 * loading 容器」那类误判。
 */
import { safeAttachmentId, safeUrl } from '../documentOperations'
import { FILE_KIND, fileFallbackText, fileFooterText, fileKindOf, isPreviewableKind } from '../media/file-block'

/** 标记「属于 NodeView 自己的交互元素」：事件停在这里，不进 ProseMirror。 */
const UI_ATTR = 'data-lark-doc-file-ui'

/** 预览区状态：`loading` 只在视频真正开始解码前存在（不画进度条，只挡兜底文案）。 */
const STATUS = Object.freeze({ LOADING: 'loading', READY: 'ready', ERROR: 'error' })

function el(tag, className, attrs = {}) {
  const element = document.createElement(tag)
  if (className) element.className = className
  Object.keys(attrs).forEach((key) => element.setAttribute(key, attrs[key]))
  return element
}

function markUi(element) {
  element.setAttribute(UI_ATTR, '')
  return element
}

const safeFileUrl = (value) => typeof value === 'string' && value && safeUrl(value, true)

/**
 * 换票结果按「编辑器 + token」缓存。
 *
 * Tiptap 首次挂载会把同一个节点视图**重建一次**（帧里只留得下一个 figure，但换票函数
 * 会被调两遍）。这一层让同一个附件只发一次请求；换票失败时立刻把缓存删掉，
 * 好让 `refresh()` 能重试，也不会把一次失败永久钉死。
 */
const resolveCache = new WeakMap()

function resolveTokenOnce(editor, token, resolver, node) {
  if (!editor || typeof editor !== 'object') return Promise.resolve().then(() => resolver(token, node))
  let cache = resolveCache.get(editor)
  if (!cache) {
    cache = new Map()
    resolveCache.set(editor, cache)
  }
  if (!cache.has(token)) {
    cache.set(token, Promise.resolve()
      .then(() => resolver(token, node))
      .catch((error) => {
        cache.delete(token)
        throw error
      }))
  }
  return cache.get(token)
}

export function createFileBlockNodeView(props) {

  const { editor, node, extension } = props
  const resolveFileUrl = extension && extension.options ? extension.options.resolveFileUrl : null
  let currentNode = node
  let status = STATUS.LOADING
  let resolvedSrc = null
  let attemptedToken = null
  let generation = 0

  const attrs = () => currentNode.attrs || {}
  const kind = () => fileKindOf(attrs().mimeType)

  /* ---------- DOM 骨架 ----------
     figure.lark-doc-file.docx-file-block
       > div.lark-doc-file-preview   （409）
       > div.lark-doc-file-footer    （42）
     失败态与成功态共用同一个 preview 容器，只换里面的内容，
     所以「块高恒定 453」这条在失败态下也成立（02 L3911：别用块高判断成败）。 */
  const dom = el('figure', 'lark-doc-file docx-file-block', { 'data-type': 'file', 'data-block-type': 'file', contenteditable: 'false' })
  const preview = markUi(el('div', 'lark-doc-file-preview'))
  const footer = markUi(el('div', 'lark-doc-file-footer'))
  dom.appendChild(preview)
  dom.appendChild(footer)

  /* ---------- 三种形态的预览内容（按需挂载，避免无意义的外部请求） ---------- */
  let media = null
  let mediaKind = null

  function teardownMedia() {
    if (!media) return
    media.remove()
    media = null
    mediaKind = null
  }

  function buildVideo(src) {
    const video = markUi(el('video', 'lark-doc-file-video', {
      controls: 'controls',
      playsinline: 'playsinline',
      preload: 'metadata',
      src,
    }))
    // 解码失败 = 视频兜底态（③-octies B 段：45MB mp4 落的块高 268、文案换掉、下载仍在）。
    video.addEventListener('loadeddata', () => { status = STATUS.READY; syncPreview() })
    video.addEventListener('error', () => { status = STATUS.ERROR; syncPreview() })
    return video
  }

  function buildFrame(src) {
    // PDF 没有可靠的失败事件（③-ter：唯一可靠判据就是 iframe 本身在不在），
    // 所以这里只负责挂上，成不成交给浏览器；宿主想强制走卡片就传 viewType: 'Card'。
    const frame = markUi(el('iframe', 'lark-doc-file-frame', {
      src,
      title: String(attrs().name || '文件预览'),
      loading: 'lazy',
    }))
    return frame
  }

  function buildCard() {
    const card = markUi(el('div', 'lark-doc-file-card'))
    const icon = el('span', 'lark-doc-file-card-icon', { 'aria-hidden': 'true' })
    const body = el('div', 'lark-doc-file-card-body')
    const title = el('span', 'lark-doc-file-card-name')
    title.textContent = String(attrs().name || '未命名文件')
    const sub = el('span', 'lark-doc-file-card-sub')
    sub.textContent = fileFooterText('', attrs().size)
    body.appendChild(title)
    body.appendChild(sub)
    card.appendChild(icon)
    card.appendChild(body)
    return card
  }

  function buildFallback(text) {
    const box = markUi(el('div', 'lark-doc-file-fallback', { role: 'img', 'aria-label': text }))
    const line = el('p', 'lark-doc-media-error')
    line.textContent = text
    // 第二行是 `<文件名> · <大小>`（02 L3853 实测），与 footer 同源同一份格式化。
    const meta = el('p', 'lark-doc-file-fallback-meta')
    meta.textContent = fileFooterText(attrs().name, attrs().size)
    box.appendChild(line)
    box.appendChild(meta)
    return box
  }

  /* ---------- footer：文件名 · 大小 + 下载 ---------- */
  const footerName = el('span', 'lark-doc-file-name')
  const footerSep = el('span', 'lark-doc-file-sep', { 'aria-hidden': 'true' })
  footerSep.textContent = '·'
  const footerSize = el('span', 'lark-doc-file-size')
  const download = markUi(el('a', 'lark-doc-file-download', { download: '', role: 'button' }))
  download.textContent = '下载'
  footer.appendChild(footerName)
  footer.appendChild(footerSep)
  footer.appendChild(footerSize)
  footer.appendChild(download)

  function syncFooter() {
    const name = String(attrs().name || '').trim()
    footerName.textContent = name || '未命名文件'
    footerSep.hidden = !name
    footerSize.textContent = fileFooterText('', attrs().size)
    const href = effectiveSrc()
    if (href) {
      download.setAttribute('href', href)
      download.setAttribute('aria-label', `下载 ${name || '文件'}`)
      download.removeAttribute('aria-disabled')
      download.removeAttribute('tabindex')
    } else {
      download.removeAttribute('href')
      download.setAttribute('aria-disabled', 'true')
      download.setAttribute('tabindex', '-1')
    }
  }

  function effectiveSrc() {
    const direct = attrs().src
    if (safeFileUrl(direct)) return direct
    if (safeFileUrl(resolvedSrc)) return resolvedSrc
    return null
  }

  /* ---------- 预览区同步（唯一出口，避免状态与 DOM 分叉） ---------- */
  function syncPreview() {
    const src = effectiveSrc()
    const shape = kind()
    const viewType = attrs().viewType === 'Preview' || attrs().viewType === 'Card'
      ? attrs().viewType
      : (isPreviewableKind(shape) ? 'Preview' : 'Card')

    preview.classList.remove('is-fallback', 'is-card')

    // 没有地址 / 宿主明确要卡片 / 形态本身不该内嵌 → 三条路都不挂预览元素。
    if (!src) {
      teardownMedia()
      preview.classList.add('is-fallback')
      replacePreview(buildFallback(fileFallbackText(shape)))
      return
    }
    if (shape === FILE_KIND.CARD || viewType === 'Card') {
      teardownMedia()
      preview.classList.add('is-card')
      replacePreview(buildCard())
      return
    }
    if (status === STATUS.ERROR) {
      teardownMedia()
      preview.classList.add('is-fallback')
      replacePreview(buildFallback(fileFallbackText(shape)))
      return
    }
    if (media && mediaKind === shape && media.getAttribute('src') === src) {
      replacePreview(media, true)
      return
    }
    teardownMedia()
    media = shape === FILE_KIND.VIDEO ? buildVideo(src) : buildFrame(src)
    mediaKind = shape
    if (shape !== FILE_KIND.VIDEO) status = STATUS.READY
    replacePreview(media)
  }

  /** 把一个元素放进预览区；`keep` 为真时不重排（同源同形态只更新属性）。 */
  function replacePreview(element, keep = false) {
    if (!keep) {
      while (preview.firstChild) preview.removeChild(preview.firstChild)
      preview.appendChild(element)
      return
    }
    if (preview.firstChild !== element) {
      while (preview.firstChild) preview.removeChild(preview.firstChild)
      preview.appendChild(element)
    }
  }

  /**
   * `token` → `src` 的换票（可选）。
   *
   * 本仓库没有飞书的预览 SDK，`src` 属性是 V1 的主路径；宿主真的只存 token 时，
   * 由适配层注入 `resolveFileUrl(token, node)` 换出直链。异步，且要防回调打穿已销毁的块。
   *
   * `attemptedToken` 是「同一个 token 只换一次」的闸门：Tiptap 在首次渲染后会再走一遍
   * `update()`，没有这道闸门就会对同一个 token 发两遍请求（也已经换过票的块不该再换）。
   * 需要重试一律走 `refresh()`。
   */
  function maybeResolveToken() {

    const token = attrs().token
    if (safeFileUrl(attrs().src) || safeFileUrl(resolvedSrc) || !safeAttachmentId(token) || typeof resolveFileUrl !== 'function') return
    if (attemptedToken === token) return
    attemptedToken = token
    const current = ++generation
    resolveTokenOnce(editor, token, resolveFileUrl, currentNode)
      .then((url) => {
        if (current !== generation) return
        if (!safeFileUrl(url)) { status = STATUS.ERROR; syncPreview(); return }
        resolvedSrc = url
        status = STATUS.LOADING
        syncFooter()
        syncPreview()
      })
      .catch(() => {
        if (current !== generation) return
        status = STATUS.ERROR
        syncPreview()
      })
  }

  function syncAll() {
    dom.setAttribute('data-block-type', 'file')
    dom.setAttribute('data-view-type', attrs().viewType || 'Card')
    if (safeAttachmentId(attrs().token)) dom.setAttribute('data-token', attrs().token)
    else dom.removeAttribute('data-token')
    if (safeFileUrl(attrs().src)) dom.setAttribute('data-src', attrs().src)
    else dom.removeAttribute('data-src')
    syncFooter()
    syncPreview()
  }

  syncAll()
  maybeResolveToken()

  return {
    dom,
    update(newNode) {
      if (!newNode || !newNode.type || newNode.type.name !== currentNode.type.name) return false
      // 换源才复位状态机，否则上一份的 error 会粘住新文件。
      // 两侧都归一到 null 再比：Tiptap 创建后紧跟的那次 `update()` 会把「未传 src（undefined）」
      // 补成默认的 null，直接比会让「没换源」被误判成换源（→ 白白重换一次票）。
      const previousSrc = attrs().src || null
      currentNode = newNode
      if (previousSrc !== (attrs().src || null)) { status = STATUS.LOADING; resolvedSrc = null; attemptedToken = null }
      syncAll()
      maybeResolveToken()
      return true
    },
    selectNode() { dom.classList.add('is-selected') },
    deselectNode() { dom.classList.remove('is-selected') },
    /** 播放器控件 / 下载链接 / iframe 里的事件都停在这里，不进 ProseMirror。 */
    stopEvent(event) {
      const target = event && event.target
      return Boolean(target && typeof target.closest === 'function' && target.closest(`[${UI_ATTR}]`))
    },
    ignoreMutation() { return true },
    destroy() {
      generation += 1
      teardownMedia()
    },
    // 测试与宿主联调通道。
    status() { return status },
    kind() { return kind() },
    refresh() { attemptedToken = null; syncAll(); maybeResolveToken() },
    downloadUrl: effectiveSrc,
  }
}

export default createFileBlockNodeView
