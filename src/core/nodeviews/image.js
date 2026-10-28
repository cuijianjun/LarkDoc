/**
 * 图片 NodeView —— 纯 DOM 实现，core 零 UI 框架依赖（P2-01）。
 *
 * 原 Vue2 端 ImageNode.vue 的全量平移重写（裁剪 / 替换 / 题注 / 四角缩放 /
 * 预览 / 离线拦截占位），并按 02 §11 实测规格修正：
 *   - 块底 margin 16px、padding 0、圆角 0（图片不裁圆角）；
 *   - 图宽 = min(原图宽, 栏宽 − 20)，**永不放大**（靠 CSS max-width 达成，
 *     不写死 800，也不在加载时回写文档）；
 *   - hover 工具条“挂载 / 离开卸载”（真实增删节点，不是 display:none），
 *     310×42、radius 6、位于块上方 8px、水平居中；跨 8px 间隙靠 160ms
 *     延时卸载，与气泡条同口径；
 *   - 四角缩放手柄 20×20、可编辑态常驻（不依赖 hover / 选中）；
 *   - 双击（可编辑态）打开全屏大图预览；
 *   - 题注独立行，点文字或工具条「说明」就地编辑。
 * 已知偏离（记入 09 §5.3 P2-01 注记）：02 §11 工具条 8 项中的
 * copyAnchorLink / shareTextLink / comment 无底层系统支撑（评论/分享属后续
 * 阶段），本轮以 替换 / 重置 / 预览 三项替代，仍是 8 项。
 */
import { safeUrl } from '../documentOperations'
import { BLOCKED_IMAGE_PLACEHOLDER } from '../policy/network'

const WIDTH_MIN = 40
const WIDTH_MAX = 2400
const CAPTION_MAX = 100000
const CROP_PIXEL_LIMIT = 24000000
/** 鼠标离开块后延时卸载工具条，跨「块顶与工具条之间 8px」的间隙不闪。 */
const TOOLBAR_HIDE_DELAY = 160
/** 标记「属于 NodeView 自己的交互元素」：事件停在这里，不进 ProseMirror。 */
const UI_ATTR = 'data-lark-doc-image-ui'
const ALIGNMENTS = ['left', 'center', 'right']
const RESIZE_CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
const CORNER_LABELS = { 'top-left': '左上角', 'top-right': '右上角', 'bottom-left': '左下角', 'bottom-right': '右下角' }
const CROP_FIELDS = [
  { key: 'x', label: '左边界' },
  { key: 'y', label: '上边界' },
  { key: 'width', label: '裁剪宽度' },
  { key: 'height', label: '裁剪高度' },
]
/** 工具条 8 项（02 §11：310×42 / 8 项）：裁剪 / 替换 / 说明 / 重置 / 对齐×3 / 预览。 */
const TOOLBAR_ITEMS = [
  { action: 'crop', label: '裁剪', glyph: '⌗' },
  { action: 'replace', label: '替换图片', glyph: '▧' },
  { action: 'caption', label: '编辑图片说明', glyph: '▤' },
  { action: 'reset', label: '重置裁剪', glyph: '↶', role: 'reset' },
]
const TOOLBAR_ALIGN_ITEMS = [
  { action: 'left', value: 'left', label: '左对齐', glyph: '⇤' },
  { action: 'center', value: 'center', label: '居中对齐', glyph: '≡' },
  { action: 'right', value: 'right', label: '右对齐', glyph: '⇥' },
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

export function createImageNodeView(props) {
  const { editor, node, view, getPos, extension } = props
  const resolveImageFile = extension && extension.options ? extension.options.resolveImageFile : null
  let currentNode = node
  let editable = Boolean(editor && !editor.isDestroyed && editor.isEditable)
  let selected = false
  let error = ''
  let busy = false
  let dialogOpen = false
  let captionEditing = false
  let cropGeneration = 0
  let replaceGeneration = 0
  let hideTimer = null
  let returnFocus = null
  let resizeStart = null
  let cropDrag = null
  const crop = { x: 10, y: 10, width: 80, height: 80 }

  /* ---------- DOM 骨架 ----------
     figure[data-type=image] > frame(flex 对齐层) > shell(贴图宽) > img + 四角手柄
     与 renderHTML 的 figure>img+figcaption 双层契约保持一致（少了 shell 时样式照样命中）。 */
  const dom = el('figure', 'lark-doc-image', { 'data-type': 'image', contenteditable: 'false' })
  const frame = el('div', 'lark-doc-image-frame')
  const shell = el('div', 'lark-doc-image-shell')

  const blockedCard = el('div', 'lark-doc-image-blocked', { role: 'img', 'aria-label': '外链图片已被离线策略拦截' })
  const blockedTitle = el('strong')
  blockedTitle.textContent = '外链图片已拦截'
  const blockedUrl = el('code')
  const blockedHint = el('span')
  blockedHint.textContent = '把图片上传到本地或对象存储后替换，或调整 network 策略放行该域名'
  blockedCard.appendChild(blockedTitle)
  blockedCard.appendChild(blockedUrl)
  blockedCard.appendChild(blockedHint)

  const img = el('img', 'lark-doc-image-img', { draggable: 'false' })
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
  const replaceInput = markUi(el('input', 'lark-doc-image-replace-input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', 'aria-label': '替换图片文件' }))
  replaceInput.addEventListener('change', onReplaceFile)
  const errorLine = el('p', 'lark-doc-media-error', { role: 'alert' })

  dom.appendChild(frame)
  dom.appendChild(captionText)
  dom.appendChild(captionInput)
  dom.appendChild(replaceInput)
  dom.appendChild(errorLine)

  /* ---------- 工具条：hover 挂载 / 离开卸载 ---------- */
  let toolbar = null
  let dialogEl = null

  function buildToolbar() {
    const bar = markUi(el('div', 'lark-doc-image-toolbar', { role: 'toolbar', 'aria-label': '图片工具' }))
    bar.addEventListener('mousedown', (event) => event.preventDefault())
    bar.addEventListener('mouseenter', cancelHide)
    const mountButton = (item, extra = {}) => {
      const button = el('button', null, { type: 'button', 'aria-label': item.label, title: item.label, ...extra })
      button.textContent = item.glyph
      button.addEventListener('click', (event) => { event.stopPropagation(); runToolbarAction(item.action) })
      bar.appendChild(button)
      return button
    }
    TOOLBAR_ITEMS.forEach((item) => mountButton(item, item.role ? { 'data-role': item.role } : {}))
    bar.appendChild(el('span', 'lark-doc-image-toolbar-divider', { 'aria-hidden': 'true' }))
    TOOLBAR_ALIGN_ITEMS.forEach((item) => {
      mountButton({ ...item, label: item.label }, { 'data-role': `align-${item.value}`, 'data-align-value': item.value })
    })
    bar.appendChild(el('span', 'lark-doc-image-toolbar-divider', { 'aria-hidden': 'true' }))
    mountButton({ action: 'preview', label: '预览图片', glyph: '◉' })
    return bar
  }

  function runToolbarAction(action) {
    if (action === 'crop') openCrop()
    else if (action === 'replace') openReplace()
    else if (action === 'caption') { enterCaptionEdit() }
    else if (action === 'reset') resetImage()
    else if (action === 'preview') openPreview()
    else if (ALIGNMENTS.includes(action)) setAlign(action)
  }

  function mountToolbar() {
    cancelHide()
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

  dom.addEventListener('mouseenter', () => { if (editable && !dialogOpen) mountToolbar() })
  dom.addEventListener('mouseleave', () => { if (!dialogOpen) scheduleHide() })

  /* ---------- 状态同步 ---------- */
  function syncToolbarState() {
    if (!toolbar) return
    const align = ALIGNMENTS.includes(currentNode.attrs.align) ? currentNode.attrs.align : 'center'
    toolbar.querySelectorAll('button[data-align-value]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.getAttribute('data-align-value') === align))
    })
    const reset = toolbar.querySelector('button[data-role="reset"]')
    // 只有「裁剪过的图」才谈得上重置：originalSrc 存在且与当前 src 不同。
    if (reset) reset.disabled = !safeUrl(currentNode.attrs.originalSrc, true) || currentNode.attrs.originalSrc === currentNode.attrs.src
  }

  function syncDom() {
    const attrs = currentNode.attrs
    const blocked = isBlockedSrc(attrs.src)
    dom.setAttribute('data-align', ALIGNMENTS.includes(attrs.align) ? attrs.align : 'center')
    if (typeof attrs.blockId === 'string' && attrs.blockId) dom.setAttribute('data-block-id', attrs.blockId)
    else dom.removeAttribute('data-block-id')
    dom.classList.toggle('is-selected', selected)
    dom.classList.toggle('is-blocked', blocked)

    img.classList.toggle('is-hidden', blocked)
    blockedCard.classList.toggle('is-hidden', !blocked)
    if (blocked) {
      blockedUrl.textContent = attrs.originalSrc || ''
      blockedUrl.classList.toggle('is-hidden', !attrs.originalSrc)
    }
    if (!blocked) {
      img.setAttribute('src', attrs.src)
      img.setAttribute('alt', attrs.alt || attrs.caption || '文档图片')
      if (attrs.title) img.setAttribute('title', attrs.title)
      else img.removeAttribute('title')
      // 未设宽度时不写死像素：交给 CSS 的 max-width: calc(100% - 20px)，
      // 自然得到 min(原图宽, 栏宽 − 20)，图片永不放大。
      img.style.width = attrs.width ? `${attrs.width}px` : ''
    } else {
      img.removeAttribute('src')
    }

    RESIZE_CORNERS.forEach((corner) => {
      handles[corner].classList.toggle('is-hidden', !editable || blocked || dialogOpen)
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
    if (!editor || editor.isDestroyed || !editor.isEditable || !view) return false
    let pos
    try {
      pos = typeof getPos === 'function' ? getPos() : (getPos && typeof getPos.pos === 'number' ? getPos.pos : null)
    } catch (_) { return false }
    if (typeof pos !== 'number' || pos < 0) return false
    const { state } = view
    if (pos > state.doc.content.size) return false
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
    if (!editable || isBlockedSrc(currentNode.attrs.src)) return
    event.preventDefault()
    event.stopPropagation()
    const rect = img.getBoundingClientRect()
    const startWidth = Math.round(rect.width) || clampImageWidth(currentNode.attrs.width) || 0
    if (!startWidth) return
    resizeStart = { x: event.clientX, width: startWidth, direction: corner.indexOf('left') === 0 ? -1 : 1 }
    window.addEventListener('mousemove', onResize)
    window.addEventListener('mouseup', finishResize)
  }

  function onResize(event) {
    if (!editable || !resizeStart) { stopResize(false); return }
    const width = clampImageWidth(resizeStart.width + resizeStart.direction * (event.clientX - resizeStart.x))
    if (width !== null) img.style.width = `${width}px`
  }

  function finishResize() { stopResize(true) }

  function stopResize(commit) {
    window.removeEventListener('mousemove', onResize)
    window.removeEventListener('mouseup', finishResize)
    if (commit && resizeStart) {
      // 手柄拖出来的宽度带单位（'600px'），clampImageWidth 用 Number() 会拿到 NaN，
      // 这里先用 parseFloat 剥掉单位再校验。
      const width = clampImageWidth(parseFloat(img.style.width))
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
    try {
      const image = await resolveImageFile(file)
      if (!image || generation !== replaceGeneration) return
      if (!editor || editor.isDestroyed || !editor.isEditable) return
      error = ''
      // 替换是「换一张原图」：originalSrc 跟着换成新图，重置按钮随之失效。
      updateAttributes({ ...image, originalSrc: image.src, originalAttchId: image.attchId || null, alt: file.name || null })
    } catch (replaceError) {
      if (generation !== replaceGeneration) return
      if (!editor || editor.isDestroyed || !editor.isEditable) return
      error = (replaceError && replaceError.message) || '图片替换失败'
      syncDom()
    }
  }

  function resetImage() {
    if (!editable || !safeUrl(currentNode.attrs.originalSrc, true)) return false
    cropGeneration += 1
    busy = false
    if (dialogOpen) closeDialog()
    error = ''
    const ok = updateAttributes({ src: currentNode.attrs.originalSrc, attchId: currentNode.attrs.originalAttchId })
    if (!ok) syncDom()
    return ok
  }

  let viewerShell = null
  function openPreview() {
    if (isBlockedSrc(currentNode.attrs.src)) { openReplace(); return false }
    if (viewerShell) viewerShell.remove()
    const shellEl = markUi(el('div', 'lark-doc-image-viewer-shell', { role: 'dialog', 'aria-modal': 'true', 'aria-label': '图片预览' }))
    const viewerImg = el('img', null, { alt: currentNode.attrs.caption || '文档图片' })
    viewerImg.setAttribute('src', currentNode.attrs.src)
    const closeBtn = el('button', 'lark-doc-image-viewer-close', { type: 'button', 'aria-label': '关闭预览' })
    closeBtn.textContent = '关闭'
    closeBtn.addEventListener('click', closePreview)
    shellEl.appendChild(viewerImg)
    shellEl.appendChild(closeBtn)
    shellEl.addEventListener('click', (event) => { if (event.target === shellEl) closePreview() })
    // 挂在块内而不是 document.body：① 自定义元素版把样式注入 shadow root，
    // 挂到 body 上的节点会完全丢样式；② 主题 token 定义在 .lark-doc 上，挂 body 读不到。
    // 全屏靠 position: fixed；.ProseMirror 只有 position: relative（z-index auto），不构成层叠上下文。
    dom.appendChild(shellEl)
    viewerShell = shellEl
    return true
  }

  function closePreview() {
    if (!viewerShell) return
    viewerShell.remove()
    viewerShell = null
  }

  /* ---------- 裁剪对话框 ---------- */
  function openCrop() {
    if (!editable || dialogOpen) return false
    // 被离线策略拦截的图片没有本地像素，裁剪会重新请求远端原图。
    if (isBlockedSrc(currentNode.attrs.src)) {
      error = '外链图片已被拦截，请先上传到本地再裁剪'
      syncDom()
      return false
    }
    crop.x = 10; crop.y = 10; crop.width = 80; crop.height = 80
    openDialog()
    return true
  }

  function openDialog() {
    unmountToolbar()
    returnFocus = document.activeElement
    dialogOpen = true
    error = ''
    const backdrop = markUi(el('div', 'lark-doc-media-backdrop'))
    backdrop.addEventListener('mousedown', (event) => { if (event.target === backdrop) closeDialog() })
    backdrop.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeDialog() }
    })

    const section = el('section', 'lark-doc-media-dialog', { role: 'dialog', 'aria-modal': 'true', 'aria-label': '裁剪图片' })
    const heading = el('div', 'lark-doc-media-heading')
    const title = el('strong')
    title.textContent = '裁剪图片'
    const closeButton = el('button', null, { type: 'button', 'aria-label': '关闭图片窗口' })
    closeButton.textContent = '关闭'
    closeButton.addEventListener('click', closeDialog)
    heading.appendChild(title)
    heading.appendChild(closeButton)
    section.appendChild(heading)

    const preview = el('div', 'lark-doc-crop-preview')
    const previewImg = el('img', null, { alt: '图片预览' })
    previewImg.setAttribute('src', safeUrl(currentNode.attrs.originalSrc, true) ? currentNode.attrs.originalSrc : currentNode.attrs.src)
    preview.appendChild(previewImg)
    const region = el('div', 'lark-doc-crop-region')
    region.addEventListener('mousedown', startCropDrag)
    preview.appendChild(region)
    section.appendChild(preview)

    const hint = el('p')
    hint.textContent = '以原图百分比设置裁剪区域。原图会保留，可随时重置。'
    section.appendChild(hint)

    const fields = el('div', 'lark-doc-crop-fields')
    CROP_FIELDS.forEach((field) => {
      const label = el('label')
      label.textContent = `${field.label} % `
      const input = el('input', null, { type: 'number', min: '0', max: '100', 'aria-label': field.label })
      input.value = String(crop[field.key])
      input.addEventListener('change', () => { crop[field.key] = Number(input.value); syncCropRegion(region) })
      label.appendChild(input)
      fields.appendChild(label)
    })
    section.appendChild(fields)

    const applyButton = el('button', null, { type: 'button' })
    applyButton.textContent = '应用裁剪'
    applyButton.addEventListener('click', () => { applyCrop() })
    section.appendChild(applyButton)
    const dialogError = el('p', 'lark-doc-media-error', { role: 'alert' })
    section.appendChild(dialogError)
    backdrop.appendChild(section)
    dom.appendChild(backdrop)
    dialogEl = { backdrop, region, applyButton, dialogError, closeButton }
    syncCropRegion(region)
    closeButton.focus()
    return dialogEl
  }

  function syncCropRegion(region) {
    region.style.left = `${crop.x}%`
    region.style.top = `${crop.y}%`
    region.style.width = `${crop.width}%`
    region.style.height = `${crop.height}%`
  }

  function closeDialog() {
    stopCropDrag()
    cropGeneration += 1
    busy = false
    dialogOpen = false
    if (dialogEl) { dialogEl.backdrop.remove(); dialogEl = null }
    syncDom()
    if (returnFocus && typeof returnFocus.focus === 'function') {
      try { returnFocus.focus() } catch (_) { /* 焦点元素可能已随 DOM 卸载 */ }
    }
    returnFocus = null
  }

  function startCropDrag(event) {
    if (!editable || !dialogEl) return
    event.preventDefault()
    event.stopPropagation()
    const rect = dialogEl.region.parentElement.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    cropDrag = { x: event.clientX, y: event.clientY, rect, snapshot: { ...crop } }
    window.addEventListener('mousemove', onCropDrag)
    window.addEventListener('mouseup', finishCropDrag)
  }

  function onCropDrag(event) {
    if (!cropDrag) return
    const { x, y, rect, snapshot } = cropDrag
    const dx = (event.clientX - x) / rect.width * 100
    const dy = (event.clientY - y) / rect.height * 100
    crop.x = Math.max(0, Math.min(100 - snapshot.width, snapshot.x + dx))
    crop.y = Math.max(0, Math.min(100 - snapshot.height, snapshot.y + dy))
    if (dialogEl) syncCropRegion(dialogEl.region)
  }

  function finishCropDrag() {
    window.removeEventListener('mousemove', onCropDrag)
    window.removeEventListener('mouseup', finishCropDrag)
    cropDrag = null
  }

  function stopCropDrag() { finishCropDrag() }

  async function applyCrop() {
    if (!editable || busy || !dialogEl) return false
    const { x, y, width, height } = crop
    if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 100 || y + height > 100) {
      dialogEl.dialogError.textContent = '裁剪区域须在原图范围内，宽高必须大于零'
      return false
    }
    const source = safeUrl(currentNode.attrs.originalSrc, true) ? currentNode.attrs.originalSrc : currentNode.attrs.src
    const originalAttchId = source === currentNode.attrs.src ? currentNode.attrs.attchId : currentNode.attrs.originalAttchId
    if (!safeUrl(source, true)) { dialogEl.dialogError.textContent = '图片地址无效'; return false }
    if (!resolveImageFile) { dialogEl.dialogError.textContent = '未配置图片上传，无法保存裁剪结果'; return false }

    busy = true
    dialogEl.applyButton.disabled = true
    dialogEl.applyButton.textContent = '正在裁剪…'
    const generation = ++cropGeneration
    try {
      const resource = await new Promise((resolve, reject) => {
        const loader = new window.Image()
        loader.crossOrigin = 'anonymous'
        loader.onload = () => resolve(loader)
        loader.onerror = () => reject(new Error('图片无法加载，请使用本地图片或允许跨域访问的图片'))
        loader.src = source
      })
      if (generation !== cropGeneration || !editable || !dialogOpen) return false
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(resource.naturalWidth * width / 100))
      canvas.height = Math.max(1, Math.round(resource.naturalHeight * height / 100))
      if (canvas.width * canvas.height > CROP_PIXEL_LIMIT) throw new Error('图片像素过大，请先缩小原图')
      const context = canvas.getContext('2d')
      if (!context) throw new Error('浏览器不支持图片裁剪')
      context.drawImage(
        resource,
        resource.naturalWidth * x / 100, resource.naturalHeight * y / 100,
        resource.naturalWidth * width / 100, resource.naturalHeight * height / 100,
        0, 0, canvas.width, canvas.height,
      )
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('图片裁剪失败'))), 'image/png')
      })
      if (generation !== cropGeneration || !editable || !dialogOpen) return false
      // 裁剪与插图共用宿主上传；originalSrc 保留原图，重置时恢复原映射。
      const uploadedImage = await resolveImageFile(new window.File([blob], 'cropped-image.png', { type: 'image/png' }))
      if (!uploadedImage || generation !== cropGeneration || !editable || !dialogOpen) return false
      closeDialog()
      error = ''
      const ok = updateAttributes({ ...uploadedImage, originalSrc: source, originalAttchId })
      if (!ok) syncDom()
      return ok
    } catch (cropError) {
      if (generation === cropGeneration && dialogEl) {
        dialogEl.dialogError.textContent = cropError && cropError.name === 'SecurityError'
          ? '远程图片禁止跨域裁剪，请导入本地图片后重试'
          : (cropError && cropError.message) || '图片裁剪失败'
      }
      return false
    } finally {
      if (generation === cropGeneration) {
        busy = false
        if (dialogEl) { dialogEl.applyButton.disabled = false; dialogEl.applyButton.textContent = '应用裁剪' }
      }
    }
  }

  /* ---------- 双击全屏预览（可编辑态；离线拦截时转替换） ---------- */
  img.addEventListener('dblclick', (event) => {
    if (!editable) return
    event.preventDefault()
    event.stopPropagation()
    openPreview()
  })

  /* ---------- 生命周期 ---------- */
  function syncEditable() {
    const next = Boolean(editor && !editor.isDestroyed && editor.isEditable)
    if (next === editable) return
    editable = next
    if (!editable) {
      dialogOpen = false
      if (dialogEl) { dialogEl.backdrop.remove(); dialogEl = null }
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
      currentNode = newNode
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
      cancelHide()
      stopResize(false)
      stopCropDrag()
      closePreview()
      cropGeneration += 1
      replaceGeneration += 1
      if (dialogEl) { dialogEl.backdrop.remove(); dialogEl = null }
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
    /** 联调/测试通道：等价于在对话框四个百分比输入里改值。 */
    setCropArea(next) {
      if (!next) return false
      CROP_FIELDS.forEach((field) => {
        const value = Number(next[field.key])
        if (Number.isFinite(value)) crop[field.key] = value
      })
      if (dialogEl) syncCropRegion(dialogEl.region)
      return true
    },
    closeDialog,
    mountToolbar,
    unmountToolbar,
    enterCaptionEdit,
    commitCaption,
  }
}

export default createImageNodeView
