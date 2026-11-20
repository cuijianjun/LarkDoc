/** Pure DOM image viewer. Viewing never changes the document or its image attributes. */
import { safeUrl } from '../documentOperations'
import { imageCropGeometry, normalizeImageCrop } from '../media/image-crop'
import { lockPageScroll } from '../../ui/dom'


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

export function createImageViewer({ host, images, index = 0, initialScale, onClose, onComment, onDownload, canLoad, scrollOwner } = {}) {
  const allowed = src => {
    try { return safeUrl(src, true) && (!canLoad || canLoad(src)) } catch (_) { return false }
  }
  const items = (images || []).filter(item => allowed(item.src))
  if (!host || !items.length) return null
  index = Math.max(0, Math.min(items.length - 1, index))
  let destroyed = false, scale = 1, fitScale = 1, rotation = 0, x = 0, y = 0, drag = null
  let commentOpen = false, downloadGeneration = 0
  let stopOwner = null
  let downloadAbort = null
  const phone = window.matchMedia?.('(max-width: 760px) and (pointer: coarse)').matches === true
  let touch = null, lastTap = null, tapTimer = null
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
  if (phone) stage.style.touchAction = 'none'
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
    element.addEventListener('click', event => {
      if (!destroyed && root.isConnected && element.isConnected && !element.disabled && !element.closest('[hidden], [inert]')) action(event)
    })
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
  function setComments(visible, notify = true) {
    commentOpen = visible
    if (notify && onComment?.(items[index], visible, root) === false) {
      commentOpen = false
      error.textContent = '暂时无法打开图片评论，请检查评论服务和当前权限'
    }
    root.classList.toggle('has-comments', commentOpen)
    buttons.comment?.setAttribute('aria-pressed', String(commentOpen))
    loaded()
  }
  const closeComments = event => { setComments(false, false); if (event.detail?.retired && buttons.comment) buttons.comment.disabled = true }
  root.addEventListener('lark-doc-image-comments-close', closeComments)
  if (typeof onComment === 'function') button('comment', '评论', () => setComments(!commentOpen)).setAttribute('aria-pressed', 'false')
  const close = button('close', '关闭预览', destroy, root)
  close.className = 'lark-doc-image-viewer-close'
  root.appendChild(stage)
  root.appendChild(toolbar)
  root.appendChild(error)
  host.appendChild(root)
  const scrollOwners = new Set([root.ownerDocument.body, scrollOwner || host.closest?.('.lark-doc-main')].filter(Boolean))
  const unlockScroll = [...scrollOwners].map(owner => lockPageScroll(owner))

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
    // 用 `translate(-50%, -50%)` 自己居中，而不是靠 stage 的 `place-items:center`：
    // 投影盒（原图尺寸）比视口高时，grid 居中会把它摆到顶部，再按中心缩放就把图推到底部。
    projection.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${scale}) rotate(${rotation}deg)`
    percentage.textContent = `${Math.round(scale * 100)}%`
    original.title = Math.abs(scale - 1) < 0.001 ? '适应窗口' : '原始尺寸'
    original.setAttribute('aria-label', original.title)
    original.replaceChildren(icon(Math.abs(scale - 1) < 0.001 ? 'fit' : 'original'))
    setButtonDisabled(buttons.out, scale <= 0.1)
    setButtonDisabled(buttons.in, scale >= 5)
    const touchZoomed = phone && scale > fitScale + 0.001
    toolbar.hidden = touchZoomed
    toolbar.style.display = touchZoomed ? 'none' : ''
    close.hidden = touchZoomed
    close.style.display = touchZoomed ? 'none' : ''
    if (touchZoomed && (toolbar.contains(document.activeElement) || document.activeElement === close)) root.focus({ preventScroll: true })
  }
  function loaded() {
    if (destroyed) return
    // 视口口径：横向留 48、纵向扣掉底部工具条（48 高 + 20 底距）与上下留白。
    // 之前的 `innerHeight * 0.9` 没扣工具条，竖图「适应窗口」后下半张会被工具条盖住。
    const bounds = stage.getBoundingClientRect()
    const width = bounds.width || window.innerWidth
    const height = bounds.height || window.innerHeight
    const toolbarHeight = toolbar.getBoundingClientRect().height || 48
    const availableWidth = Math.max(1, width - 48)
    // 上下各留「工具条高度 + 20 底距 + 8 间隙」：整图居中后底边仍然落在工具条上方。
    const availableHeight = Math.max(1, height - 2 * (toolbarHeight + 28))
    const geometry = imageCropGeometry(image.naturalWidth, image.naturalHeight, items[index].crop)
    fitScale = Math.min(2.55, availableWidth / (geometry?.width || image.naturalWidth), availableHeight / (geometry?.height || image.naturalHeight))
    if (!Number.isFinite(fitScale) || fitScale <= 0) fitScale = 1
    scale = Number.isFinite(initialScale) && initialScale > 0 ? Math.max(.1, Math.min(5, initialScale)) : fitScale
    paint()
  }
  function resize() {
    const previous = { scale, x, y }, fitted = Math.abs(scale - fitScale) < .001
    loaded()
    if (!fitted) { scale = previous.scale; x = previous.x; y = previous.y; paint() }
  }
  function show(next) {
    if (destroyed || next < 0 || next >= items.length) return
    if (!allowed(items[next].src)) { error.textContent = '当前网络策略不允许加载此图片'; return }
    cancelTouch()
    if (commentOpen) setComments(false)
    index = next
    downloadGeneration += 1
    downloadAbort?.abort()
    downloadAbort = null
    x = 0; y = 0; rotation = 0; scale = 1; fitScale = 1
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
      const { downloadViewerImage } = await import('../media/image-output')
      const current = () => !destroyed && generation === downloadGeneration && allowed(item.src)
      await downloadViewerImage(item, { root, signal: controller.signal, crop: normalizeImageCrop(item.crop), current })
    } catch (reason) { if (!destroyed && generation === downloadGeneration) error.textContent = reason?.message || '图片下载失败，请重试' }
    finally { if (downloadAbort === controller) downloadAbort = null }
  }
  function keydown(event) {
    if (destroyed || event.defaultPrevented || event.isComposing || event.keyCode === 229) return
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (commentOpen && event.target.closest('.lark-doc-comment-layer')) setComments(false); else destroy(); return }
    if (event.key !== 'Tab' && root.contains(event.target.closest('input,textarea,[contenteditable="true"]'))) return
    if (event.key === 'ArrowLeft') { event.preventDefault(); show(index - 1) }
    if (event.key === 'ArrowRight') { event.preventDefault(); show(index + 1) }
    if (event.key === 'Tab') {
      const enabled = [...root.querySelectorAll('button:not(:disabled),textarea,input,[tabindex="0"]')].filter(element => !element.closest('[hidden]'))
      if (!enabled.length) { event.preventDefault(); root.focus({ preventScroll: true }); return }
      const current = enabled.indexOf(document.activeElement)
      if (enabled.length && ((event.shiftKey && current <= 0) || (!event.shiftKey && current === enabled.length - 1))) {
        event.preventDefault(); enabled[event.shiftKey ? enabled.length - 1 : 0].focus()
      }
    }
  }
  function move(event) { if (drag) { x = drag.x + event.clientX - drag.clientX; y = drag.y + event.clientY - drag.clientY; paint() } }
  function stop() { drag = null; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', stop) }
  function cancelTouch() {
    touch = null
    lastTap = null
    clearTimeout(tapTimer)
    tapTimer = null
  }
  stage.addEventListener('touchstart', event => {
    if (!phone || destroyed) return
    if (event.touches.length !== 1) { cancelTouch(); return }
    event.preventDefault()
    clearTimeout(tapTimer)
    tapTimer = null
    const point = event.touches[0]
    touch = { id: point.identifier, clientX: point.clientX, clientY: point.clientY, x, y, zoomed: scale > fitScale + 0.001, moved: false }
  }, { passive: false })
  stage.addEventListener('touchmove', event => {
    if (!touch || destroyed) return
    if (event.touches.length !== 1) { cancelTouch(); return }
    const point = event.touches[0]
    if (point.identifier !== touch.id) { cancelTouch(); return }
    event.preventDefault()
    const dx = point.clientX - touch.clientX, dy = point.clientY - touch.clientY
    if (Math.max(Math.abs(dx), Math.abs(dy)) > 8) { touch.moved = true; lastTap = null }
    if (touch.zoomed) { x = touch.x + dx; y = touch.y + dy; paint() }
  }, { passive: false })
  stage.addEventListener('touchend', event => {
    if (!touch || destroyed) return
    const point = [...event.changedTouches].find(item => item.identifier === touch.id)
    if (!point || event.touches.length) { cancelTouch(); return }
    event.preventDefault()
    const gesture = touch
    touch = null
    const dx = point.clientX - gesture.clientX, dy = point.clientY - gesture.clientY
    if (gesture.moved || Math.max(Math.abs(dx), Math.abs(dy)) > 8) {
      lastTap = null
      if (!gesture.zoomed && Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy) * 1.25) show(index + (dx < 0 ? 1 : -1))
      return
    }
    const now = Date.now()
    if (lastTap && now - lastTap.time <= 300 && Math.hypot(point.clientX - lastTap.x, point.clientY - lastTap.y) <= 36) {
      lastTap = null
      scale = gesture.zoomed ? fitScale : Math.min(5, fitScale * 2)
      x = 0; y = 0
      paint()
      return
    }
    lastTap = { time: now, x: point.clientX, y: point.clientY }
    // Wait for a possible second tap before taking the observed fit-state exit path.
    tapTimer = setTimeout(() => { tapTimer = null; lastTap = null; if (!gesture.zoomed) destroy() }, 300)
  }, { passive: false })
  stage.addEventListener('touchcancel', cancelTouch)
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
  window.addEventListener('resize', resize)
  function destroy(restore = true) {
    if (destroyed) return
    const restoreFocus = restore !== false && (root.contains(document.activeElement) || document.activeElement === document.body)
    destroyed = true
    stopOwner?.(); stopOwner = null
    downloadGeneration += 1
    downloadAbort?.abort()
    downloadAbort = null
    stop()
    cancelTouch()
    if (commentOpen) onComment?.(items[index], false, root)
    root.removeEventListener('lark-doc-image-comments-close', closeComments)
    image.removeEventListener('load', loaded)
    window.removeEventListener('resize', resize)
    root.remove()
    unlockScroll.forEach(unlock => unlock())
    if (restoreFocus && previousFocus?.isConnected && previousFocus.focus) previousFocus.focus()
    onClose?.()
  }
  show(index)
  stopOwner = onComment?.watchViewer?.(() => destroy(false), items)
  if (destroyed) { stopOwner?.(); stopOwner = null }
  else root.focus()
  return { dom: root, destroy }
}
