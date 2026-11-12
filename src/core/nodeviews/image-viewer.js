/** Pure DOM image viewer. Viewing never changes the document or its image attributes. */
import { safeUrl } from '../documentOperations'
import { imageCropGeometry, normalizeImageCrop, cropImageBlob } from '../media/image-crop'


const PATHS = {
  previous: 'M15 5l-7 7 7 7', next: 'M9 5l7 7-7 7', close: 'M5 5l14 14M19 5L5 19',
  out: 'M9 10h6M16.5 16.5L21 21', in: 'M9 10h6M12 7v6M16.5 16.5L21 21',
  original: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  fit: 'M8 3v5H3M16 3v5h5M21 16h-5v5M8 21v-5H3',
  rotate: 'M7 4H3v4M3 4l4 4M5 12a7 7 0 1 0 4-6',
  download: 'M12 3v12m-5-5l5 5 5-5M4 16v5h16v-5',
  comment: 'M4 4h16v12H9l-5 4V4M8 8h8M8 12h6',
}

function icon(name) {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', width: '24', height: '24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'aria-hidden': 'true' })) svg.setAttribute(key, value)
  if (name === 'in' || name === 'out') {
    const circle = document.createElementNS(ns, 'circle')
    for (const [key, value] of Object.entries({ cx: '11', cy: '10', r: '7' })) circle.setAttribute(key, value)
    svg.appendChild(circle)
  }
  const path = document.createElementNS(ns, 'path')
  path.setAttribute('d', PATHS[name] || PATHS.original)
  svg.appendChild(path)
  return svg
}

export function createImageViewer({ host, images, index = 0, initialScale, onClose, onComment, onDownload, canLoad } = {}) {
  const allowed = src => {
    try { return safeUrl(src, true) && (!canLoad || canLoad(src)) } catch (_) { return false }
  }
  const items = (images || []).filter(item => allowed(item.src))
  if (!host || !items.length) return null
  index = Math.max(0, Math.min(items.length - 1, index))
  let destroyed = false, scale = 1, fitScale = 1, rotation = 0, x = 0, y = 0, drag = null
  let commentOpen = false, downloadGeneration = 0
  let downloadAbort = null
  const previousFocus = document.activeElement
  const root = document.createElement('div')
  root.className = 'lark-doc-image-viewer-shell'
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-modal', 'true')
  root.setAttribute('aria-label', '图片预览')
  root.setAttribute('data-lark-doc-image-ui', '')
  root.tabIndex = -1
  const stage = document.createElement('div')
  stage.className = 'lark-doc-image-viewer-stage'
  const image = document.createElement('img')
  image.draggable = false
  image.className = 'lark-doc-image-viewer-image'
  const projection = document.createElement('div')
  projection.className = 'lark-doc-image-viewer-projection'
  projection.appendChild(image)
  stage.appendChild(projection)
  const toolbar = document.createElement('div')
  toolbar.className = 'lark-doc-image-viewer-toolbar'
  toolbar.setAttribute('role', 'toolbar')
  toolbar.setAttribute('aria-label', '图片查看工具')
  const error = document.createElement('div')
  error.className = 'lark-doc-image-viewer-message'
  error.setAttribute('role', 'status')
  const buttons = {}
  function setButtonDisabled(element, disabled) {
    const focused = document.activeElement === element
    element.disabled = disabled
    if (focused && disabled) root.focus({ preventScroll: true })
  }
  function button(name, label, action, parent = toolbar) {
    const element = document.createElement('button')
    element.type = 'button'
    element.dataset.viewerAction = name
    element.setAttribute('aria-label', label)
    element.title = label
    element.appendChild(icon(name))
    element.addEventListener('click', action)
    parent.appendChild(element)
    buttons[name] = element
    return element
  }
  const position = document.createElement('span')
  position.className = 'lark-doc-image-viewer-position'
  button('previous', '上一张', () => show(index - 1))
  toolbar.appendChild(position)
  button('next', '下一张', () => show(index + 1))
  button('out', '缩小', () => zoom(1 / 1.15))
  const percentage = document.createElement('span')
  percentage.className = 'lark-doc-image-viewer-percentage'
  toolbar.appendChild(percentage)
  button('in', '放大', () => zoom(1.15))
  const original = button('original', '原始尺寸', () => { scale = Math.abs(scale - 1) < 0.001 ? fitScale : 1; x = 0; y = 0; paint() })
  button('rotate', '旋转', () => { rotation = (rotation + 90) % 360; x = 0; y = 0; paint() })
  button('download', '下载', download)
  if (typeof onComment === 'function') button('comment', '评论', () => {
    commentOpen = !commentOpen
    root.classList.toggle('has-comments', commentOpen)
    buttons.comment.setAttribute('aria-pressed', String(commentOpen))
    if (onComment(items[index], commentOpen, root) === false) {
      commentOpen = false
      root.classList.remove('has-comments')
      buttons.comment.setAttribute('aria-pressed', 'false')
      error.textContent = '暂时无法打开图片评论，请重新打开查看器后重试'
    }
    loaded()
  })
  const close = button('close', '关闭预览', destroy, root)
  close.className = 'lark-doc-image-viewer-close'
  root.appendChild(stage)
  root.appendChild(toolbar)
  root.appendChild(error)
  host.appendChild(root)

  function paint() {
    const geometry = imageCropGeometry(image.naturalWidth, image.naturalHeight, items[index].crop)
    if (geometry) {
      const [left, top] = geometry.crop
      Object.assign(projection.style, { width: `${geometry.width}px`, height: `${geometry.height}px` })
      Object.assign(image.style, { width: `${geometry.baseWidth}px`, height: `${geometry.baseHeight}px`, left: `${-left * geometry.baseWidth}px`, top: `${-top * geometry.baseHeight}px` })
    }
    const bounds = stage.getBoundingClientRect()
    const width = bounds.width || window.innerWidth, height = bounds.height || window.innerHeight
    const rotated = rotation % 180 !== 0
    const naturalWidth = geometry?.width || image.naturalWidth, naturalHeight = geometry?.height || image.naturalHeight
    const maxX = Math.max(0, ((rotated ? naturalHeight : naturalWidth) * scale - width) / 2)
    const maxY = Math.max(0, ((rotated ? naturalWidth : naturalHeight) * scale - height) / 2)
    x = Math.max(-maxX, Math.min(maxX, x))
    y = Math.max(-maxY, Math.min(maxY, y))
    projection.style.transform = `translate(${x}px, ${y}px) scale(${scale}) rotate(${rotation}deg)`
    percentage.textContent = `${Math.round(scale * 100)}%`
    original.title = Math.abs(scale - 1) < 0.001 ? '适应窗口' : '原始尺寸'
    original.setAttribute('aria-label', original.title)
    original.replaceChildren(icon(Math.abs(scale - 1) < 0.001 ? 'fit' : 'original'))
    setButtonDisabled(buttons.out, scale <= 0.1)
    setButtonDisabled(buttons.in, scale >= 5)
  }
  function loaded() {
    if (destroyed) return
    // Source viewport measurements: 95% width / 90% height, with observed initial zoom 255%.
    const geometry = imageCropGeometry(image.naturalWidth, image.naturalHeight, items[index].crop)
    fitScale = Math.min(2.55, (stage.getBoundingClientRect().width || window.innerWidth) * 0.95 / (geometry?.width || image.naturalWidth), window.innerHeight * 0.9 / (geometry?.height || image.naturalHeight))
    if (!Number.isFinite(fitScale) || fitScale <= 0) fitScale = 1
    scale = Number.isFinite(initialScale) && initialScale > 0 ? Math.max(.1, Math.min(5, initialScale)) : fitScale
    paint()
  }
  function show(next) {
    if (destroyed || next < 0 || next >= items.length) return
    if (!allowed(items[next].src)) { error.textContent = '当前网络策略不允许加载此图片'; return }
    if (commentOpen) { commentOpen = false; root.classList.remove('has-comments'); onComment?.(items[index], false, root); buttons.comment?.setAttribute('aria-pressed', 'false') }
    index = next
    downloadGeneration += 1
    downloadAbort?.abort()
    downloadAbort = null
    x = 0; y = 0; rotation = 0; scale = 1
    error.textContent = ''
    image.alt = items[index].caption || items[index].alt || '文档图片'
    image.src = items[index].src
    position.textContent = `${index + 1}/${items.length}`
    setButtonDisabled(buttons.previous, index === 0)
    setButtonDisabled(buttons.next, index === items.length - 1)
    paint()
    if (image.complete && image.naturalWidth) loaded()
  }
  function zoom(factor) {
    let next = Math.max(0.1, Math.min(5, scale * factor))
    // The source rounds both visible dimensions up when shrinking below natural size.
    if (factor < 1 && next > 0.1 && next < 1) {
      const geometry = imageCropGeometry(image.naturalWidth, image.naturalHeight, items[index].crop)
      if (geometry) {
        const rounded = Math.max(Math.ceil(geometry.width * next - 1e-9) / geometry.width, Math.ceil(geometry.height * next - 1e-9) / geometry.height)
        // Tiny images / narrow crops must still shrink when a whole pixel exceeds this step.
        if (rounded < scale - 1e-9) next = rounded
      }
    }
    scale = Math.max(0.1, Math.min(5, next))
    paint()
  }
  async function download() {
    const item = items[index], generation = ++downloadGeneration
    downloadAbort?.abort()
    downloadAbort = null
    if (!allowed(item.src)) { error.textContent = '当前网络策略不允许下载此图片'; return }
    const controller = downloadAbort = new AbortController()
    try {
      if (onDownload) { if (await onDownload(item, { signal: controller.signal }) === false) throw new Error('图片下载失败'); return }
      const response = await fetch(item.src, { signal: controller.signal })
      if (!response.ok) throw new Error('下载失败')
      let blob = await response.blob()
      if (destroyed || generation !== downloadGeneration || !allowed(item.src)) return
      const crop = normalizeImageCrop(item.crop)
      if (crop) blob = await cropImageBlob(blob, crop)
      if (destroyed || generation !== downloadGeneration || !allowed(item.src)) return
      const url = URL.createObjectURL(blob), anchor = document.createElement('a')
      anchor.href = url
      anchor.download = Array.from(String(item.alt || '文档图片'), character => character.charCodeAt(0) < 32 ? '_' : character).join('').replace(/[/\\]/g, '_')
      if (crop) anchor.download = `${anchor.download.replace(/\.[a-z0-9]{1,8}$/i, '')}.png`
      root.appendChild(anchor)
      anchor.click()
      anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch (reason) { if (!destroyed && generation === downloadGeneration) error.textContent = reason?.message || '图片下载失败，请重试' }
    finally { if (downloadAbort === controller) downloadAbort = null }
  }
  function keydown(event) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); destroy() }
    if (root.contains(event.target.closest('input,textarea,[contenteditable="true"]'))) return
    if (event.key === 'ArrowLeft') { event.preventDefault(); show(index - 1) }
    if (event.key === 'ArrowRight') { event.preventDefault(); show(index + 1) }
    if (event.key === 'Tab') {
      const enabled = [...root.querySelectorAll('button:not(:disabled),textarea,input,[tabindex="0"]')]
      const current = enabled.indexOf(document.activeElement)
      if (enabled.length && ((event.shiftKey && current <= 0) || (!event.shiftKey && current === enabled.length - 1))) {
        event.preventDefault(); enabled[event.shiftKey ? enabled.length - 1 : 0].focus()
      }
    }
  }
  function move(event) { if (drag) { x = drag.x + event.clientX - drag.clientX; y = drag.y + event.clientY - drag.clientY; paint() } }
  function stop() { drag = null; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', stop) }
  stage.addEventListener('mousedown', event => {
    if (event.target !== image || event.button !== 0) return
    event.preventDefault()
    root.focus({ preventScroll: true })
    drag = { x, y, clientX: event.clientX, clientY: event.clientY }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', stop)
  })
  stage.addEventListener('click', event => { if (event.target === stage) destroy() })
  root.addEventListener('keydown', keydown)
  root.addEventListener('wheel', event => {
    if (!stage.contains(event.target)) return
    event.preventDefault()
    x -= event.deltaX
    y -= event.deltaY
    paint()
  }, { passive: false })
  image.addEventListener('load', loaded)
  function destroy() {
    if (destroyed) return
    destroyed = true
    downloadGeneration += 1
    downloadAbort?.abort()
    downloadAbort = null
    stop()
    if (commentOpen) onComment?.(items[index], false, root)
    image.removeEventListener('load', loaded)
    root.remove()
    if (previousFocus?.isConnected && previousFocus.focus) previousFocus.focus()
    onClose?.()
  }
  show(index)
  root.focus()
  return { dom: root, destroy }
}
