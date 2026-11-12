/**
 * Pure DOM image node: original image + normalized crop projection, inline eight-handle
 * cropping, centered resizing, caption editing and a document-independent viewer.
 * All writes verify that the live position still belongs to the initiating image.
 */
import { safeUrl } from '../documentOperations'
import { BLOCKED_IMAGE_PLACEHOLDER } from '../policy/network'
import { FULL_IMAGE_CROP, dragImageCrop, imageCropGeometry, imageCropStyles, isImageCrop, normalizeImageCrop } from '../media/image-crop'
import { createImageViewer } from './image-viewer'
import { IMAGE_MIME_ALLOWLIST } from '../media/image-insert'
import { iconNode } from '../../ui/icon'

const WIDTH_MIN = 40
const WIDTH_MAX = 2400
const CAPTION_MAX = 100000
/** 鼠标离开块后延时卸载工具条，跨「块顶与工具条之间 8px」的间隙不闪。 */
const TOOLBAR_HIDE_DELAY = 160
/** 标记「属于 NodeView 自己的交互元素」：事件停在这里，不进 ProseMirror。 */
const UI_ATTR = 'data-lark-doc-image-ui'
const ALIGNMENTS = ['left', 'center', 'right']
const RESIZE_CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
const CORNER_LABELS = { 'top-left': '左上角', 'top-right': '右上角', 'bottom-left': '左下角', 'bottom-right': '右下角' }
const CROP_HANDLES = ['w', 'e', 'n', 's', 'nw', 'sw', 'ne', 'se']
const TOOLBAR_ITEMS = [
  { action: 'crop', label: '裁剪', icon: 'image-crop' },
  { action: 'caption', label: '编辑图片说明', icon: 'block-text' },
]
const TOOLBAR_ALIGN_ITEMS = [
  { action: 'left', value: 'left', label: '左对齐', icon: 'align-left' },
  { action: 'center', value: 'center', label: '居中对齐', icon: 'align-center' },
  { action: 'right', value: 'right', label: '右对齐', icon: 'align-right' },
]

/** 宽度校验：合法返回四舍五入值，非法返回 null（手柄提交与对外 setWidth 共用）。 */
export function clampImageWidth(value) {
  const width = Number(value)
  if (!Number.isFinite(width) || width < WIDTH_MIN || width > WIDTH_MAX) return null
  return Math.round(width)
}

/** 宽度校验失败时的用户文案；合法输入返回空串。 */
export function imageWidthError(value) {
  return clampImageWidth(value) === null ? '图片宽度须为 40–2400 像素' : ''
}

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

function isBlockedSrc(src) {
  return !src || src === BLOCKED_IMAGE_PLACEHOLDER
}

function sameImage(left, right) {
  return left && right && ['blockId', 'src', 'attchId'].every(key => left.attrs[key] === right.attrs[key])
}

export function createImageNodeView(props) {
  const { editor, node, view, getPos, extension } = props
  const resolveImageFile = extension && extension.options ? extension.options.resolveImageFile : null
  const imageOptions = () => extension?.options?.getOptions?.() || {}
  const allowsImage = src => {
    const predicate = imageOptions().canLoad || extension?.options?.canLoad
    try { return !!safeUrl(src, true) && (!predicate || predicate(src)) } catch (_) { return false }
  }
  const blockedImage = src => isBlockedSrc(src) || !allowsImage(src)
  let currentNode = node
  let editable = Boolean(editor && !editor.isDestroyed && editor.isEditable)
  let destroyed = false
  let selected = false
  let hovered = false
  let pointerSelection = null
  let error = ''
  let cropOpen = false
  let captionEditing = false
  let replaceGeneration = 0
  let hideTimer = null
  let returnFocus = null
  let resizeStart = null
  let cropDrag = null
  let cropDraft = FULL_IMAGE_CROP.slice()
  let resizePreviewWidth = null

  /* ---------- DOM 骨架 ----------
     figure[data-type=image] > frame(flex 对齐层) > shell(贴图宽) > img + 四角手柄
     与 renderHTML 的 figure>img+figcaption 双层契约保持一致（少了 shell 时样式照样命中）。 */
  const dom = el('figure', 'lark-doc-image', { 'data-type': 'image', contenteditable: 'false' })
  const frame = el('div', 'lark-doc-image-frame')
  const shell = el('div', 'lark-doc-image-shell')
  const viewport = el('div', 'lark-doc-image-viewport')

  const blockedCard = el('div', 'lark-doc-image-blocked', { role: 'img', 'aria-label': '外链图片已被离线策略拦截' })
  const blockedTitle = el('strong')
  blockedTitle.textContent = '外链图片已拦截'
  const blockedUrl = el('code')
  const blockedHint = el('span')
  blockedHint.textContent = '把图片上传到本地或对象存储后替换，或调整 network 策略放行该域名'
  const blockedReplace = markUi(el('button', 'lark-doc-image-blocked-replace', {
    type: 'button',
    'aria-label': '替换图片',
    title: '替换图片',
  }))
  blockedReplace.textContent = '替换图片'
  blockedReplace.addEventListener('click', event => {
    event.preventDefault()
    event.stopPropagation()
    openReplace()
  })
  blockedCard.appendChild(blockedTitle)
  blockedCard.appendChild(blockedUrl)
  blockedCard.appendChild(blockedHint)
  blockedCard.appendChild(blockedReplace)

  const img = el('img', 'lark-doc-image-img', { draggable: 'false', loading: 'lazy', decoding: 'async' })
  shell.appendChild(blockedCard)
  shell.appendChild(img)

  const handles = {}
  RESIZE_CORNERS.forEach((corner) => {
    const label = `拖动调整图片宽度（${CORNER_LABELS[corner]}）`
    const handle = markUi(el('button', `lark-doc-image-resize is-${corner}`, { type: 'button', 'data-corner': corner, 'aria-label': label, title: label }))
    handle.addEventListener('mousedown', (event) => startResize(event, corner))
    handles[corner] = handle
    shell.appendChild(handle)
  })
  frame.appendChild(shell)

  const captionText = el('figcaption', 'lark-doc-image-caption-text')
  captionText.addEventListener('click', () => enterCaptionEdit())
  const captionInput = markUi(el('input', 'lark-doc-image-caption', { 'aria-label': '图片说明', placeholder: '添加图片说明' }))
  captionInput.addEventListener('change', () => commitCaption())
  captionInput.addEventListener('blur', () => commitCaption())
  captionInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); commitCaption() }
    else if (event.key === 'Escape') { event.stopPropagation(); exitCaptionEdit() }
  })
  const replaceInput = markUi(el('input', 'lark-doc-image-replace-input', { type: 'file', accept: IMAGE_MIME_ALLOWLIST.join(','), 'aria-label': '替换图片文件' }))
  replaceInput.addEventListener('change', onReplaceFile)
  const errorLine = el('p', 'lark-doc-media-error', { role: 'alert' })

  dom.appendChild(frame)
  dom.appendChild(captionText)
  dom.appendChild(captionInput)
  dom.appendChild(replaceInput)
  dom.appendChild(errorLine)

  /* ---------- 工具条：hover 挂载 / 离开卸载 ---------- */
  let toolbar = null
  let cropResetButton = null
  let cropUi = null

  function buildToolbar() {
    const bar = markUi(el('div', 'lark-doc-image-toolbar', { role: 'toolbar', 'aria-label': '图片工具' }))
    bar.classList.toggle('has-image-ai', imageOptions().aiEnabled === true)
    bar.addEventListener('mousedown', (event) => event.preventDefault())
    bar.addEventListener('mouseenter', cancelHide)
    const mountButton = (item, extra = {}) => {
      const button = el('button', null, { type: 'button', 'aria-label': item.label, title: item.label, ...extra })
      button.dataset.action = item.action
      button.appendChild(iconNode(item.icon, 18))
      if (['copy', 'share', 'comment'].includes(item.action)) button.disabled = typeof imageOptions().onAction !== 'function'
      button.addEventListener('click', (event) => { event.stopPropagation(); runToolbarAction(item.action) })
      bar.appendChild(button)
      return button
    }
    if (imageOptions().aiEnabled === true) {
      const ask = mountButton({ action: 'ai', label: '问问AI', icon: 'sparkle' })
      const label = el('span')
      label.textContent = '问问AI'
      ask.appendChild(label)
      ask.disabled = typeof imageOptions().onAction !== 'function'
    }
    TOOLBAR_ITEMS.forEach(item => {
      mountButton(item)
      if (item.action === 'crop') cropResetButton = mountButton({ action: 'reset', label: '重置图片', icon: 'undo' })
    })
    bar.appendChild(el('span', 'lark-doc-image-toolbar-divider', { 'aria-hidden': 'true' }))
    TOOLBAR_ALIGN_ITEMS.forEach((item) => {
      mountButton({ ...item, label: item.label }, { 'data-role': `align-${item.value}`, 'data-align-value': item.value })
    })
    bar.appendChild(el('span', 'lark-doc-image-toolbar-divider', { 'aria-hidden': 'true' }))
    ;[{ action: 'copy', label: '复制图片链接', icon: 'link' }, { action: 'share', label: '分享图片', icon: 'share-link' }, { action: 'comment', label: '添加评论', icon: 'mode-comment' }].forEach(item => mountButton(item))
    return bar
  }

  function runToolbarAction(action) {
    if (action === 'crop') openCrop()
    else if (action === 'reset') resetImage()
    else if (action === 'caption') { enterCaptionEdit() }
    else if (ALIGNMENTS.includes(action)) setAlign(action)
    else if (['ai', 'copy', 'share', 'comment'].includes(action)) {
      const pos = typeof getPos === 'function' ? getPos() : getPos?.pos
      imageOptions().onAction?.(action, { ...currentNode.attrs, pos })
    }
  }

  function mountToolbar() {
    cancelHide()
    if (toolbar && toolbar.classList.contains('has-image-ai') !== (imageOptions().aiEnabled === true)) unmountToolbar()
    if (toolbar || !editable) return
    toolbar = buildToolbar()
    dom.appendChild(toolbar)
    syncToolbarState()
  }

  function unmountToolbar() {
    cancelHide()
    if (!toolbar) return
    toolbar.remove()
    toolbar = null
  }

  function cancelHide() {
    if (hideTimer === null) return
    clearTimeout(hideTimer)
    hideTimer = null
  }

  function scheduleHide() {
    cancelHide()
    hideTimer = setTimeout(() => { hideTimer = null; unmountToolbar() }, TOOLBAR_HIDE_DELAY)
  }

  dom.addEventListener('mouseenter', () => {
    hovered = true
    syncDom()
    if (editable && !cropOpen) mountToolbar()
  })
  dom.addEventListener('mouseleave', () => {
    hovered = false
    syncDom()
    if (!cropOpen) scheduleHide()
  })

  /* ---------- 状态同步 ---------- */
  function syncToolbarState() {
    if (!toolbar) return
    const align = ALIGNMENTS.includes(currentNode.attrs.align) ? currentNode.attrs.align : 'center'
    toolbar.querySelectorAll('button[data-align-value]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.getAttribute('data-align-value') === align))
    })
    const cropped = !blockedImage(currentNode.attrs.src) && (!!normalizeImageCrop(currentNode.attrs.crop) || (allowsImage(currentNode.attrs.originalSrc) && currentNode.attrs.originalSrc !== currentNode.attrs.src))
    toolbar.classList.toggle('has-reset', !!cropped)
    if (cropped && cropResetButton.parentNode !== toolbar) toolbar.insertBefore(cropResetButton, toolbar.querySelector('[data-action="caption"]'))
    else if (!cropped) cropResetButton.remove()

  }

  function syncDom() {
    const attrs = currentNode.attrs
    const blocked = blockedImage(attrs.src)
    dom.setAttribute('data-align', ALIGNMENTS.includes(attrs.align) ? attrs.align : 'center')
    if (typeof attrs.blockId === 'string' && attrs.blockId) dom.setAttribute('data-block-id', attrs.blockId)
    else dom.removeAttribute('data-block-id')
    dom.classList.toggle('is-selected', selected)
    dom.classList.toggle('is-blocked', blocked)

    img.classList.toggle('is-hidden', blocked)
    viewport.classList.toggle('is-hidden', blocked)
    blockedCard.classList.toggle('is-hidden', !blocked)
    blockedReplace.disabled = !editable || typeof resolveImageFile !== 'function'
    blockedReplace.setAttribute('aria-disabled', String(blockedReplace.disabled))
    if (blocked) {
      blockedUrl.textContent = attrs.originalSrc || (isBlockedSrc(attrs.src) ? '' : attrs.src) || ''
      blockedUrl.classList.toggle('is-hidden', !blockedUrl.textContent)
    }
    if (!blocked) {
      if (img.getAttribute('src') !== attrs.src) img.setAttribute('src', attrs.src)
      img.setAttribute('alt', attrs.alt || attrs.caption || '文档图片')
      if (attrs.title) img.setAttribute('title', attrs.title)
      else img.removeAttribute('title')
      // 未设宽度时不写死像素：交给 CSS 的 max-width: calc(100% - 20px)，
      // 自然得到 min(原图宽, 栏宽 − 20)，图片永不放大。
      syncImageGeometry()
    } else {
      img.removeAttribute('src')
    }

    RESIZE_CORNERS.forEach((corner) => {
      handles[corner].classList.toggle('is-hidden', !editable || !hovered || blocked || cropOpen)
    })

    const caption = attrs.caption || ''
    captionText.textContent = caption
    captionText.classList.toggle('is-hidden', captionEditing || !caption)
    captionInput.value = caption
    captionInput.classList.toggle('is-hidden', !(editable && captionEditing))
    errorLine.textContent = error
    errorLine.classList.toggle('is-hidden', !error)
    syncToolbarState()
  }

  /* ---------- 写入文档（NodeView 没有 updateAttributes，自行 setNodeMarkup） ---------- */
  function updateAttributes(patch) {
    if (destroyed || !editor || editor.isDestroyed || !editor.isEditable || !view) return false
    let pos
    try {
      pos = typeof getPos === 'function' ? getPos() : (getPos && typeof getPos.pos === 'number' ? getPos.pos : null)
    } catch (_) { return false }
    if (typeof pos !== 'number' || pos < 0) return false
    const { state } = view
    if (pos > state.doc.content.size) return false
    const target = state.doc.nodeAt(pos)
    if (!target || target.type !== currentNode.type || !sameImage(target, currentNode)) return false
    view.dispatch(state.tr.setNodeMarkup(pos, null, { ...currentNode.attrs, ...patch }))
    return true
  }

  function setWidth(value) {
    if (!editable) return false
    const width = clampImageWidth(value)
    if (width === null) { error = imageWidthError(value); syncDom(); return false }
    const ok = updateAttributes({ width })
    if (ok) error = ''
    if (!ok) syncDom()
    return ok
  }

  function setCaption(value) {
    if (!editable) return false
    return updateAttributes({ caption: String(value || '').slice(0, CAPTION_MAX) })
  }

  function setAlign(value) {
    if (!editable || !ALIGNMENTS.includes(value)) return false
    return updateAttributes({ align: value })
  }

  function enterCaptionEdit() {
    if (!editable) return
    captionEditing = true
    syncDom()
    captionInput.focus()
    if (typeof captionInput.select === 'function') captionInput.select()
  }

  function exitCaptionEdit() {
    if (!captionEditing) return
    captionEditing = false
    syncDom()
  }

  function commitCaption() {
    if (!captionEditing) return
    const value = captionInput.value
    captionEditing = false
    const ok = setCaption(value)
    if (!ok) syncDom()
  }

  /* ---------- 四角缩放 ---------- */
  function startResize(event, corner) {
    if (!editable || blockedImage(currentNode.attrs.src)) return
    event.preventDefault()
    event.stopPropagation()
    const rect = img.getBoundingClientRect()
    const startWidth = Math.round(rect.width) || clampImageWidth(currentNode.attrs.width) || 0
    if (!startWidth) return
    resizeStart = { x: event.clientX, width: startWidth, direction: corner.endsWith('-left') ? -1 : 1, multiplier: currentNode.attrs.align === 'center' ? 2 : 1 }
    window.addEventListener('mousemove', onResize)
    window.addEventListener('mouseup', finishResize)
  }

  function onResize(event) {
    if (!editable || !resizeStart) { stopResize(false); return }
    const bounds = normalizeImageCrop(currentNode.attrs.crop) || FULL_IMAGE_CROP
    const width = clampImageWidth(resizeStart.width + resizeStart.direction * resizeStart.multiplier * (event.clientX - resizeStart.x) / (bounds[2] - bounds[0]))
    if (width !== null) { resizePreviewWidth = width; syncImageGeometry() }
  }

  function finishResize() { stopResize(true) }

  function stopResize(commit) {
    window.removeEventListener('mousemove', onResize)
    window.removeEventListener('mouseup', finishResize)
    const previewWidth = resizePreviewWidth
    resizePreviewWidth = null
    if (commit && resizeStart) {
      // A click without movement has no draft. Cropped image styles use percentages.
      const width = previewWidth === null ? null : clampImageWidth(previewWidth)
      if (width !== null && width !== resizeStart.width) setWidth(width)
      else syncDom()
    } else {
      syncDom()
    }
    resizeStart = null
  }

  /* ---------- 替换 / 重置 / 预览 ---------- */
  function openReplace() {
    if (!editable) return
    if (!resolveImageFile) { error = '未配置图片上传，无法替换图片'; syncDom(); return }
    replaceInput.click()
  }

  async function onReplaceFile(event) {
    const file = event.target.files && event.target.files[0]
    event.target.value = ''
    if (!file || !editable) return
    const generation = ++replaceGeneration
    const original = currentNode
    try {
      const image = await resolveImageFile(file, { source: 'replace' })
      if (!image || generation !== replaceGeneration || !sameImage(original, currentNode)) return
      if (!editor || editor.isDestroyed || !editor.isEditable) return
      error = ''
      // 替换是「换一张原图」：originalSrc 跟着换成新图，重置按钮随之失效。
      updateAttributes({ ...image, crop: null, naturalWidth: null, naturalHeight: null, originalSrc: image.src, originalAttchId: image.attchId || null, alt: file.name || null })
    } catch (replaceError) {
      if (generation !== replaceGeneration) return
      if (!editor || editor.isDestroyed || !editor.isEditable) return
      error = (replaceError && replaceError.message) || '图片替换失败'
      syncDom()
    }
  }

  function resetImage() {
    if (!editable || destroyed) return false
    const attrs = currentNode.attrs
    if (blockedImage(attrs.src)) return false
    const legacy = allowsImage(attrs.originalSrc) && attrs.originalSrc !== attrs.src
    if (!normalizeImageCrop(attrs.crop) && !legacy) return false
    if (cropOpen) closeDialog()
    error = ''
    const patch = legacy ? { src: attrs.originalSrc, attchId: attrs.originalAttchId, naturalWidth: null, naturalHeight: null, crop: null } : { crop: null }
    const ok = updateAttributes(patch)
    if (!ok) syncDom()
    return ok
  }

  let viewerShell = null
  function openPreview() {
    if (cropOpen || destroyed) return false
    if (blockedImage(currentNode.attrs.src)) { openReplace(); return false }
    closePreview()
    const images = []
    let index = 0
    const currentPos = typeof getPos === 'function' ? getPos() : getPos?.pos
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'image' || blockedImage(node.attrs.src)) return
      if (pos === currentPos) index = images.length
      images.push({ ...node.attrs, pos })
    })
    viewerShell = createImageViewer({ host: dom, images, index, canLoad: allowsImage, onComment: imageOptions().onComment, onDownload: imageOptions().onDownload, onClose: () => { viewerShell = null } })
    return Boolean(viewerShell)
  }

  function closePreview() {
    if (!viewerShell) return
    viewerShell.destroy()
    viewerShell = null
  }

  /* ---------- Non-destructive inline crop ---------- */
  function baseGeometry(bounds) {
    const attrs = currentNode.attrs
    const naturalWidth = attrs.naturalWidth || img.naturalWidth
    const naturalHeight = attrs.naturalHeight || img.naturalHeight
    const width = resizePreviewWidth || attrs.width || naturalWidth
    return imageCropGeometry(width, width * naturalHeight / naturalWidth, bounds)
  }

  function syncImageGeometry() {
    const bounds = cropOpen ? FULL_IMAGE_CROP : normalizeImageCrop(currentNode.attrs.crop)
    const geometry = bounds ? baseGeometry(bounds) : null
    if (geometry) {
      if (img.parentNode !== viewport) { shell.insertBefore(viewport, img); viewport.appendChild(img) }
      const styles = imageCropStyles(geometry)
      Object.assign(viewport.style, styles.viewport)
      Object.assign(img.style, styles.image)
    } else {
      if (img.parentNode === viewport) { shell.insertBefore(img, viewport); viewport.remove() }
      for (const key of ['position', 'maxWidth', 'height', 'left', 'top']) img.style[key] = ''
      const width = resizePreviewWidth || currentNode.attrs.width
      img.style.width = width ? `${width}px` : ''
    }
    syncCropRegion()
  }

  function onImageLoad() { if (!destroyed && img.getAttribute('src') === currentNode.attrs.src) syncImageGeometry() }
  img.addEventListener('load', onImageLoad)

  function openCrop() {
    if (!editable || destroyed || cropOpen) return false
    if (blockedImage(currentNode.attrs.src)) {
      error = '外链图片已被拦截，请先上传到本地再裁剪'
      syncDom()
      return false
    }
    if (!baseGeometry(FULL_IMAGE_CROP)) {
      error = '图片尚未加载，请稍后重试'
      syncDom()
      return false
    }
    returnFocus = document.activeElement
    cropDraft = (normalizeImageCrop(currentNode.attrs.crop) || FULL_IMAGE_CROP).slice()
    cropOpen = true
    error = ''
    unmountToolbar()
    syncDom()
    const mask = markUi(el('div', 'lark-doc-crop-mask', { 'aria-hidden': 'true' }))
    const region = markUi(el('div', 'lark-doc-crop-region', { 'aria-label': '拖动裁剪区域', contenteditable: 'false' }))
    CROP_HANDLES.forEach(handle => {
      const button = el('button', `lark-doc-crop-handle is-${handle}`, { type: 'button', 'data-crop-handle': handle, 'aria-label': `拖动裁剪边界 ${handle}` })
      region.appendChild(button)
    })
    region.addEventListener('mousedown', startCropDrag)
    viewport.appendChild(mask)
    shell.appendChild(region)
    cropUi = { mask, region }
    syncCropRegion()
    window.addEventListener('keydown', onCropKeydown, true)
    window.addEventListener('mousedown', onCropOutside, true)
    return true
  }

  function syncCropRegion() {
    if (!cropUi || !isImageCrop(cropDraft)) return
    const [left, top, right, bottom] = cropDraft.map(number => number * 100)
    Object.assign(cropUi.region.style, { left: `${left}%`, top: `${top}%`, width: `${right - left}%`, height: `${bottom - top}%` })
    cropUi.mask.style.clipPath = `polygon(evenodd, 0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, ${left}% ${top}%, ${left}% ${bottom}%, ${right}% ${bottom}%, ${right}% ${top}%, ${left}% ${top}%)`
  }

  function closeDialog(restoreFocus = true) {
    stopCropDrag()
    cropOpen = false
    window.removeEventListener('keydown', onCropKeydown, true)
    window.removeEventListener('mousedown', onCropOutside, true)
    if (cropUi) { cropUi.mask.remove(); cropUi.region.remove(); cropUi = null }
    syncDom()
    if (editable && !destroyed && dom.matches(':hover')) mountToolbar()
    if (restoreFocus && !destroyed && editable && returnFocus?.isConnected && typeof returnFocus.focus === 'function') returnFocus.focus()
    returnFocus = null
  }

  function onCropKeydown(event) {
    if (!cropOpen || !['Enter', 'Escape'].includes(event.key)) return
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Enter') applyCrop()
    else closeDialog()
  }

  function onCropOutside(event) {
    if (cropOpen && !shell.contains(event.target)) applyCrop(false)
  }

  function startCropDrag(event) {
    if (!editable || !cropUi || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const rect = viewport.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const handle = event.target.closest('[data-crop-handle]')?.getAttribute('data-crop-handle') || 'move'
    cropDrag = { x: event.clientX, y: event.clientY, rect, handle, snapshot: cropDraft.slice() }
    window.addEventListener('mousemove', onCropDrag)
    window.addEventListener('mouseup', finishCropDrag)
  }

  function onCropDrag(event) {
    if (!cropDrag || !editable) return
    const { x, y, rect, handle, snapshot } = cropDrag
    cropDraft = dragImageCrop(snapshot, handle, (event.clientX - x) / rect.width, (event.clientY - y) / rect.height, 1 / rect.width, 1 / rect.height)
    syncCropRegion()
  }

  function finishCropDrag() {
    window.removeEventListener('mousemove', onCropDrag)
    window.removeEventListener('mouseup', finishCropDrag)
    cropDrag = null
  }
  function stopCropDrag() { finishCropDrag() }

  function applyCrop(restoreFocus = true) {
    if (!editable || destroyed || !cropOpen) return false
    if (!isImageCrop(cropDraft)) {
      error = '裁剪区域须在原图范围内，宽高必须大于零'
      errorLine.textContent = error
      errorLine.classList.remove('is-hidden')
      return false
    }
    const crop = normalizeImageCrop(cropDraft)
    const previous = normalizeImageCrop(currentNode.attrs.crop)
    if (JSON.stringify(crop) === JSON.stringify(previous)) { closeDialog(restoreFocus); return true }
    const naturalWidth = currentNode.attrs.naturalWidth || img.naturalWidth
    const naturalHeight = currentNode.attrs.naturalHeight || img.naturalHeight
    const width = currentNode.attrs.width || clampImageWidth(img.getBoundingClientRect().width) || null
    closeDialog(restoreFocus)
    error = ''
    return updateAttributes({ crop, naturalWidth, naturalHeight, width })
  }

  /* ---------- Selecting an image then clicking it opens the viewer, also in read mode. ---------- */
  img.addEventListener('mousedown', event => { pointerSelection = event.button === 0 ? selected : null })
  img.addEventListener('click', (event) => {
    const wasSelected = event.detail > 0 && pointerSelection !== null ? pointerSelection : selected
    pointerSelection = null
    if (cropOpen || !(wasSelected || !editable)) return
    event.preventDefault()
    event.stopPropagation()
    openPreview()
  })

  /* ---------- 生命周期 ---------- */
  function syncEditable() {
    const next = Boolean(editor && !editor.isDestroyed && editor.isEditable)
    if (toolbar && toolbar.classList.contains('has-image-ai') !== (imageOptions().aiEnabled === true)) { unmountToolbar(); if (next) mountToolbar() }
    if (next === editable) return
    editable = next
    if (!editable) {
      replaceGeneration += 1
      cropOpen = false
      closeDialog(false)
      unmountToolbar()
      stopResize(false)
      captionEditing = false
      closePreview()
    }
    syncDom()
  }
  if (editor && typeof editor.on === 'function') {
    editor.on('transaction', syncEditable)
    editor.on('update', syncEditable)
  }

  syncDom()

  return {
    dom,
    update(newNode) {
      if (!newNode || !newNode.type || newNode.type.name !== currentNode.type.name) return false
      const changed = !sameImage(currentNode, newNode)
      currentNode = newNode
      if (changed) {
        replaceGeneration += 1
        closeDialog(false)
        stopResize(false)
        closePreview()
        captionEditing = false
      }
      if (cropOpen && blockedImage(currentNode.attrs.src)) closeDialog(false)
      syncDom()
      return true
    },
    selectNode() { selected = true; syncDom() },
    deselectNode() {
      selected = false
      if (captionEditing) commitCaption()
      syncDom()
    },
    /** 工具条 / 手柄 / 题注输入 / 对话框里的事件都停在这里，不进 ProseMirror 的 keymap。 */
    stopEvent(event) {
      const target = event && event.target
      return Boolean(target && typeof target.closest === 'function' && target.closest(`[${UI_ATTR}]`))
    },
    ignoreMutation() { return true },
    destroy() {
      if (editor && typeof editor.off === 'function') {
        editor.off('transaction', syncEditable)
        editor.off('update', syncEditable)
      }
      destroyed = true
      img.removeEventListener('load', onImageLoad)
      cancelHide()
      stopResize(false)
      stopCropDrag()
      closePreview()
      replaceGeneration += 1
      closeDialog(false)
      if (toolbar) { toolbar.remove(); toolbar = null }
    },
    // 测试与宿主联调通道：等价于工具条各按钮。
    setWidth,
    setCaption,
    setAlign,
    reset: resetImage,
    openPreview,
    closePreview,
    openReplace,
    openCrop,
    applyCrop,
    /** Supports the original percentage API and normalized edge tuples. */
    setCropArea(next) {
      if (!cropOpen || !next) return false
      if (Array.isArray(next)) cropDraft = next.slice()
      else {
        const [left, top, right, bottom] = isImageCrop(cropDraft) ? cropDraft : FULL_IMAGE_CROP
        const values = { x: left * 100, y: top * 100, width: (right - left) * 100, height: (bottom - top) * 100, ...next }
        const x = Number(values.x), y = Number(values.y), width = Number(values.width), height = Number(values.height)
        cropDraft = [x / 100, y / 100, (x + width) / 100, (y + height) / 100]
      }
      syncCropRegion()
      return isImageCrop(cropDraft)
    },
    closeDialog,
    mountToolbar,
    unmountToolbar,
    enterCaptionEdit,
    commitCaption,
  }
}

export default createImageNodeView
