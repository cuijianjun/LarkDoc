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
/** 工具条外层 310×42（`04 §1.3` 实测）。外层是 `position: fixed`，所以坐标由
 *  `positionToolbar()` 按图片矩形自己算，CSS 里只留尺寸/层序。 */
const TOOLBAR_W = 310
const TOOLBAR_H = 42
/** 工具条底边与块顶之间的间隙：正好是 `TOOLBAR_HIDE_DELAY` 要兜住的那 8px。 */
const TOOLBAR_GAP = 8
/** 工具条离视口左右缘的最小留白（窄屏时不贴边）。 */
const TOOLBAR_MARGIN = 8
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
/**
 * 工具条 8 项（`04 §1.3` 实测，顺序与 `data-name` 逐字照抄 —— e2e 拿 `data-name` 对锚）。
 * 图标走 24×24 SVG（同一条 `currentColor`，深浅主题自动跟随），不再用文字 glyph。
 * `align: true` 的项参与「当前对齐 → `.menu-item-actived`」同步。
 */
const TOOLBAR_ITEMS = [
  { action: 'crop', name: 'Crop', label: '裁剪', icon: 'crop' },
  { action: 'caption', name: 'caption', label: '编辑图片说明', icon: 'caption' },
  { action: 'left', name: 'align left', label: '左对齐', icon: 'align-left', align: true },
  { action: 'center', name: 'align center', label: '居中对齐', icon: 'align-center', align: true },
  { action: 'right', name: 'align right', label: '右对齐', icon: 'align-right', align: true },
  { action: 'copyAnchorLink', name: 'copyAnchorLink', label: '复制锚点链接', icon: 'link' },
  { action: 'shareTextLink', name: 'shareTextLink', label: '分享图片链接', icon: 'share' },
  { action: 'comment', name: 'comment', label: '评论', icon: 'comment' },
]
/** 分隔线插在「对齐三连」与「链接三连」之间（`04 §1.3`：5→6 步距 49，此处有分隔线）。 */
const TOOLBAR_DIVIDER_BEFORE = 'copyAnchorLink'

/**
 * 9 个 24×24 图标（`viewBox="0 0 24 24"`，描边式，`stroke="currentColor"`）。
 * core 里不引 Vue 图标组件，所以这里只存 path 数据，由 `iconEl()` 建 SVG。
 * 比例来自飞书同族线性图标：线宽 1.5、端点圆角、不填充。
 */
const ICON_PATHS = {
  crop: ['M7 3v14h14', 'M3 7h14v14'],
  caption: ['M4 5.5h16v9.5H4z', 'M8 19h8'],
  'align-left': ['M4 6h16', 'M4 10.5h9', 'M4 15h16', 'M4 19.5h9'],
  'align-center': ['M4 6h16', 'M7.5 10.5h9', 'M4 15h16', 'M7.5 19.5h9'],
  'align-right': ['M4 6h16', 'M11 10.5h9', 'M4 15h16', 'M11 19.5h9'],
  link: ['M10.5 13.5a4.2 4.2 0 0 0 6 0l2.2-2.2a4.2 4.2 0 0 0-6-6l-1.2 1.2', 'M13.5 10.5a4.2 4.2 0 0 0-6 0l-2.2 2.2a4.2 4.2 0 0 0 6 6l1.2-1.2'],
  share: ['M12 15.5V4', 'm8 8 4-4 4 4', 'M5 14v6h14v-6'],
  comment: ['M4 5.5h16v10.5H9.5L5 20z'],
  'chevron-left': ['m14.5 5.5-6.5 6.5 6.5 6.5'],
  'chevron-right': ['m9.5 5.5 6.5 6.5-6.5 6.5'],
  dots: ['M6 12h.01', 'M12 12h.01', 'M18 12h.01'],
  close: ['m6 6 12 12', 'm18 6-12 12'],
}


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

/** 24×24 描边图标（`svg` 必须走命名空间创建，`createElement('svg')` 不认）。 */
function iconEl(name) {
  const paths = ICON_PATHS[name] || []
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', '24')
  svg.setAttribute('height', '24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.5')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  paths.forEach((d) => {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', d)
    svg.appendChild(path)
  })
  return svg
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
  // 工具条 8 项按 `04 §1.3` 不含「替换」（飞书靠删除重插）；被拦截的图必须留一条
  // 可点的替换路径，否则占位卡是死路。
  const blockedReplace = markUi(el('button', 'lark-doc-image-blocked-replace', { type: 'button', 'aria-label': '替换被拦截的图片' }))
  blockedReplace.textContent = '替换图片'
  blockedReplace.addEventListener('click', (event) => { event.stopPropagation(); openReplace() })
  blockedCard.appendChild(blockedReplace)

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
  // 工具条提示行：复制/分享/评论这类「动作已完成」的反馈不进 `role="alert"`
  // （alert 是错误通道，读屏会打断当前朗读），用 status + aria-live=polite。
  const hintBox = el('p', 'lark-doc-media-hint is-hidden', { role: 'status', 'aria-live': 'polite' })

  dom.appendChild(frame)
  dom.appendChild(captionText)
  dom.appendChild(captionInput)
  dom.appendChild(replaceInput)
  dom.appendChild(errorLine)
  dom.appendChild(hintBox)

  /* ---------- 工具条：hover 挂载 / 离开卸载 ---------- */
  let toolbar = null
  let dialogEl = null

  /**
   * 工具条 = **双层**（`04 §1.3`）：外层 `.overlay-container` z86（只管定位、透明）
   * 套内层面板 z999（白底 / r6 / 阴影 / 8 项）。两层都得建 —— 只建一层时
   * 块手柄（z79）与图片预览（z1049）之间的层序会塌，且阴影会被父级裁掉。
   */
  function buildToolbar() {
    const bar = markUi(el('div', 'lark-doc-image-toolbar', { role: 'toolbar', 'aria-label': '图片工具' }))
    bar.addEventListener('mousedown', (event) => event.preventDefault())
    bar.addEventListener('mouseenter', cancelHide)
    const panel = el('div', 'lark-doc-image-toolbar-panel')
    bar.appendChild(panel)

    TOOLBAR_ITEMS.forEach((item) => {
      if (item.name === TOOLBAR_DIVIDER_BEFORE) panel.appendChild(el('span', 'lark-doc-image-toolbar-divider', { 'aria-hidden': 'true' }))
      const button = el('button', null, {
        type: 'button',
        'aria-label': item.label,
        title: item.label,
        'data-name': item.name,
        'data-role': item.align ? `align-${item.action}` : item.action,
      })
      if (item.align) button.setAttribute('data-align-value', item.action)
      button.appendChild(iconEl(item.icon))
      button.addEventListener('click', (event) => { event.stopPropagation(); runToolbarAction(item.action) })
      panel.appendChild(button)
    })
    return bar
  }

  function runToolbarAction(action) {
    if (action === 'crop') openCrop()
    else if (action === 'replace') openReplace()
    else if (action === 'caption') { enterCaptionEdit() }
    else if (action === 'reset') resetImage()
    else if (action === 'preview') openPreview()
    else if (action === 'copyAnchorLink') copyAnchorLink()
    else if (action === 'shareTextLink') shareImageLink()
    else if (action === 'comment') requestComment()
    else if (ALIGNMENTS.includes(action)) setAlign(action)
  }

  /** 元素定位用的 deep link：`origin + pathname + #blockId`（无 blockId 时退化为当前 URL）。 */
  function blockLink() {
    const loc = typeof window !== 'undefined' ? window.location : null
    const base = loc ? `${loc.origin}${loc.pathname}` : ''
    const blockId = typeof currentNode.attrs.blockId === 'string' ? currentNode.attrs.blockId : ''
    return { base, blockId, url: blockId ? `${base}#${blockId}` : base }
  }

  /** 复制文本：优先异步剪贴板，非安全上下文退回隐藏 textarea + execCommand（宿主老 WebView）。 */
  function writeClipboard(text) {
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : null
    if (clipboard && typeof clipboard.writeText === 'function') {
      return clipboard.writeText(text).catch(() => fallbackCopy(text))
    }
    return Promise.resolve(fallbackCopy(text))
  }

  function fallbackCopy(text) {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    let ok = false
    try { ok = document.execCommand('copy') } catch (copyError) { ok = false }
    area.remove()
    return ok
  }

  function copyAnchorLink() {
    const { url, blockId } = blockLink()
    if (!blockId) { flashHint('图片块还没有 blockId，暂时无法生成锚点链接'); return }
    Promise.resolve(writeClipboard(url)).then((result) => {
      flashHint(result === false ? '复制失败，请手动复制地址栏链接' : '已复制锚点链接')
    })
    // 宿主可监听该事件做「已复制」埋点；没有监听者也不影响上面的可见反馈。
    if (editor && typeof editor.emit === 'function') editor.emit('blockAnchorLinkCopied', { blockId, url })
  }

  /**
   * 分享 = 复制可外部打开的图片直链（本库没有宿主分享面板时这就是完整闭环），
   * 同时 `emit('shareBlock')` 让有分享面板的宿主接管（收到后自行 popover）。
   */
  function shareImageLink() {
    const src = currentNode.attrs.originalSrc || currentNode.attrs.src || ''
    const safe = safeUrl(src, true)
    if (!safe) { flashHint('当前图片地址不允许分享（离线策略拦截）'); return }
    Promise.resolve(writeClipboard(safe)).then((result) => {
      flashHint(result === false ? '复制失败，请手动右键复制图片地址' : '已复制图片链接，可粘贴分享')
    })
    if (editor && typeof editor.emit === 'function') editor.emit('shareBlock', { blockId: blockLink().blockId, src: safe })
  }

  /** 评论：先选中图片块再抛事件，宿主接评论面板后按 blockId 建 thread。 */
  function requestComment() {
    const { blockId } = blockLink()
    if (editor && typeof editor.emit === 'function') editor.emit('commentBlock', { blockId, type: 'image' })
    flashHint(blockId ? '已请求宿主打开评论区' : '图片块还没有 blockId，无法定位评论')
  }

  /** 工具条底部临时提示（1.8s 自动消失，不占文档流、不进 aria 的 alert 通道）。 */
  let hintTimer = null
  function flashHint(text) {
    if (!hintBox) return
    hintBox.textContent = text
    hintBox.classList.remove('is-hidden')
    if (hintTimer !== null) clearTimeout(hintTimer)
    hintTimer = setTimeout(() => {
      hintTimer = null
      if (hintBox) hintBox.classList.add('is-hidden')
    }, 1800)
  }

  /**
   * 工具条落位（`04 §1.3`：**块上方 8px、水平居中**）。
   *
   * 外层是 `position: fixed`（层序稳、不被父级 overflow / border-radius 裁），
   * 但 fixed 不认「相对父级」的百分比几何，所以坐标必须按图片矩形算一遍。
   * 贴视口顶（首屏图）时上方没有 8px 余量，翻到块下方，别被裁掉。
   */
  function positionToolbar() {
    if (!toolbar) return
    const rect = img.getBoundingClientRect()
    if (!rect || !rect.width || !rect.height) return
    const viewportWidth = window.innerWidth || 0
    const centered = rect.left + rect.width / 2 - TOOLBAR_W / 2
    const maxLeft = Math.max(TOOLBAR_MARGIN, viewportWidth - TOOLBAR_W - TOOLBAR_MARGIN)
    const left = Math.min(maxLeft, Math.max(TOOLBAR_MARGIN, centered))
    const above = rect.top - TOOLBAR_H - TOOLBAR_GAP
    toolbar.style.left = `${Math.round(left)}px`
    toolbar.style.top = `${Math.round(above >= TOOLBAR_MARGIN ? above : rect.bottom + TOOLBAR_GAP)}px`
  }

  function mountToolbar() {
    cancelHide()
    if (toolbar || !editable) return
    toolbar = buildToolbar()
    dom.appendChild(toolbar)
    syncToolbarState()
    positionToolbar()
    // fixed 层不跟滚动走：滚轮 / 改窗口大小都得重算，否则工具条会留在原地。
    window.addEventListener('scroll', positionToolbar, true)
    window.addEventListener('resize', positionToolbar)
  }

  function unmountToolbar() {
    cancelHide()
    if (hintTimer !== null) { clearTimeout(hintTimer); hintTimer = null }
    if (hintBox) hintBox.classList.add('is-hidden')
    if (!toolbar) return
    window.removeEventListener('scroll', positionToolbar, true)
    window.removeEventListener('resize', positionToolbar)
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
    // 飞书同类浮层用 `.menu-item-actived` 表「当前值」（不是只有蓝底就算数）——
    // 两个属性都打，样式吃 class、a11y 吃 aria-pressed。
    toolbar.querySelectorAll('button[data-align-value]').forEach((button) => {
      const active = button.getAttribute('data-align-value') === align
      button.setAttribute('aria-pressed', String(active))
      button.classList.toggle('menu-item-actived', active)
    })
    const comment = toolbar.querySelector('button[data-role="comment"]')
    if (comment) comment.hidden = !blockLink().blockId
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
  let viewerTimer = null

  /** 同一编辑器里所有可预览的图（上一张 / 下一张按文档顺序走，与飞书一致）。 */
  function gallery() {
    const viewDom = editor && editor.view ? editor.view.dom : null
    if (!viewDom) return []
    return Array.from(viewDom.querySelectorAll('figure.lark-doc-image .lark-doc-image-img'))
      .filter((node) => !isBlockedSrc(node.getAttribute('src')))
      .map((node) => ({ src: node.getAttribute('src'), alt: node.getAttribute('alt') || '文档图片' }))
  }

  /** 预览层皮肤固定（`04 §1.5.1`：深/浅两态八层逐字节相同，只有继承色变）—— 只做一套深色。 */
  function openPreview() {
    if (isBlockedSrc(currentNode.attrs.src)) { openReplace(); return false }
    if (viewerShell) viewerShell.remove()
    const shellEl = markUi(el('div', 'lark-doc-image-viewer-shell', {
      role: 'dialog', 'aria-modal': 'true', 'aria-label': '图片预览', tabindex: '-1',
    }))
    const mask = el('div', 'lark-doc-image-viewer-mask', { 'aria-hidden': 'true' })
    const content = el('div', 'lark-doc-image-viewer-content')
    const viewerImg = el('img', 'lark-doc-image-viewer-img', { alt: currentNode.attrs.caption || '文档图片' })
    viewerImg.setAttribute('src', currentNode.attrs.src)
    content.appendChild(viewerImg)

    const toolbar = el('div', 'lark-doc-image-viewer-toolbar', { role: 'toolbar', 'aria-label': '图片预览工具' })
    const list = el('div', 'lark-doc-image-viewer-toolbar-list')
    toolbar.appendChild(list)

    const shots = gallery()
    let index = Math.max(0, shots.findIndex((item) => item.src === currentNode.attrs.src))

    const prevButton = el('button', 'lark-doc-image-viewer-btn', { type: 'button', 'aria-label': '上一张', 'data-role': 'prev' })
    prevButton.appendChild(iconEl('chevron-left'))
    const pageInfo = el('span', 'lark-doc-image-viewer-page', { 'aria-live': 'polite' })
    const nextButton = el('button', 'lark-doc-image-viewer-btn', { type: 'button', 'aria-label': '下一张', 'data-role': 'next' })
    nextButton.appendChild(iconEl('chevron-right'))
    const divider = el('span', 'lark-doc-image-viewer-divider', { 'aria-hidden': 'true' })
    const moreButton = el('button', 'lark-doc-image-viewer-btn', { type: 'button', 'aria-label': '更多操作', 'aria-haspopup': 'menu', 'data-role': 'more' })
    moreButton.appendChild(iconEl('dots'))
    const scaleInfo = el('span', 'lark-doc-image-viewer-scale', { 'aria-live': 'off' })

    // 「更多」的子菜单：两项都是本库能独立闭环的动作，不需要宿主。
    const moreMenu = el('div', 'lark-doc-image-viewer-menu', { role: 'menu', 'aria-label': '更多操作' })
    moreMenu.hidden = true
    const copyItem = el('button', null, { type: 'button', role: 'menuitem' })
    copyItem.textContent = '复制图片地址'
    copyItem.addEventListener('click', () => {
      const src = viewerImg.getAttribute('src') || ''
      Promise.resolve(writeClipboard(src)).then((result) => {
        copyItem.textContent = result === false ? '复制失败' : '已复制'
        setTimeout(() => { copyItem.textContent = '复制图片地址' }, 1200)
      })
      closeMenu()
    })
    const openItem = el('button', null, { type: 'button', role: 'menuitem' })
    openItem.textContent = '在新标签页打开'
    openItem.addEventListener('click', () => {
      const src = safeUrl(viewerImg.getAttribute('src') || '', true)
      if (src) window.open(src, '_blank', 'noopener,noreferrer')
      closeMenu()
    })
    moreMenu.appendChild(copyItem)
    moreMenu.appendChild(openItem)

    list.appendChild(prevButton)
    list.appendChild(pageInfo)
    list.appendChild(nextButton)
    list.appendChild(divider)
    list.appendChild(moreButton)
    list.appendChild(scaleInfo)
    list.appendChild(moreMenu)

    function closeMenu() { moreMenu.hidden = true }

    function syncViewer() {
      const shot = shots[index]
      if (shot) {
        viewerImg.setAttribute('src', shot.src)
        viewerImg.setAttribute('alt', shot.alt)
      }
      pageInfo.textContent = shots.length > 1 ? `${index + 1} / ${shots.length}` : ''
      prevButton.disabled = index <= 0
      nextButton.disabled = index >= shots.length - 1
    }

    /** 缩放百分比 = 实际渲染高度 ÷ 原图高度（字号 12、白色，飞书同款读数）。 */
    function syncScale() {
      const naturalWidth = viewerImg.naturalWidth || 0
      const naturalHeight = viewerImg.naturalHeight || 0
      if (!naturalWidth || !naturalHeight) { scaleInfo.textContent = ''; return }
      const limit = Math.max(120, window.innerHeight - 95)
      const percent = Math.round(Math.min(1, limit / naturalHeight) * 100)
      scaleInfo.textContent = `${percent}%`
      viewerImg.style.width = `${Math.round(naturalWidth * percent / 100)}px`
      viewerImg.style.height = `${Math.round(naturalHeight * percent / 100)}px`
    }

    function step(delta) {
      const next = index + delta
      if (next < 0 || next >= shots.length) return
      index = next
      syncViewer()
    }

    function showToolbar() {
      toolbar.classList.remove('is-hidden')
      if (viewerTimer !== null) clearTimeout(viewerTimer)
      // auto-hide：鼠标静止 2.5s 后淡出（`04 §1.5` 的 `toolbar-hide` 语义）。
      viewerTimer = setTimeout(() => { viewerTimer = null; toolbar.classList.add('is-hidden') }, 2500)
    }

    prevButton.addEventListener('click', () => step(-1))
    nextButton.addEventListener('click', () => step(1))
    moreButton.addEventListener('click', (event) => { event.stopPropagation(); moreMenu.hidden = !moreMenu.hidden })
    viewerImg.addEventListener('load', syncScale)
    // 点图（不是点工具条）关闭；工具条与「更多」菜单里的点击不冒到壳上。
    content.addEventListener('click', (event) => { if (event.target === content) closePreview() })
    mask.addEventListener('click', closePreview)
    toolbar.addEventListener('click', (event) => event.stopPropagation())
    shellEl.addEventListener('mousemove', showToolbar)
    shellEl.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closePreview() }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1) }
      else if (event.key === 'ArrowRight') { event.preventDefault(); step(1) }
    })

    // 关闭钮 =「看得见的 Esc」：键位已在 keydown 里处理，但鼠标/触屏用户需要可见出口。
    const closeButton = el('button', 'lark-doc-image-viewer-close', { type: 'button', 'aria-label': '关闭预览', title: '关闭预览' })
    closeButton.appendChild(iconEl('close'))
    closeButton.addEventListener('click', closePreview)

    shellEl.appendChild(mask)
    shellEl.appendChild(content)
    shellEl.appendChild(toolbar)
    shellEl.appendChild(closeButton)
    // 挂在块内而不是 document.body：① 自定义元素版把样式注入 shadow root，
    // 挂到 body 上的节点会完全丢样式；② 主题 token 定义在 .lark-doc 上，挂 body 读不到。
    // 全屏靠 position: fixed；.ProseMirror 只有 position: relative（z-index auto），不构成层叠上下文。
    dom.appendChild(shellEl)
    viewerShell = shellEl
    syncViewer()
    syncScale()
    // 首帧就带 is-hidden（鼠标未动就自动隐藏），移动鼠标才显示。
    toolbar.classList.add('is-hidden')
    showToolbar()
    shellEl.focus({ preventScroll: true })
    return true
  }

  function closePreview() {
    if (viewerTimer !== null) { clearTimeout(viewerTimer); viewerTimer = null }
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
    // 「重置裁剪」从工具条挪到这里（工具条 8 项按 `04 §1.3` 不含它）：
    // 只有裁过的图才谈得上重置 —— originalSrc 存在且与当前 src 不同。
    const cropped = safeUrl(currentNode.attrs.originalSrc, true) && currentNode.attrs.originalSrc !== currentNode.attrs.src
    const resetButton = el('button', 'lark-doc-crop-reset', { type: 'button', 'aria-label': '恢复原图' })
    resetButton.textContent = '恢复原图'
    resetButton.hidden = !cropped
    resetButton.addEventListener('click', () => { closeDialog(); resetImage() })
    section.appendChild(resetButton)
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
  // 解码完尺寸才定：hover 早于 load 时工具条算出来的是 0 高矩形，补一次重算。
  img.addEventListener('load', positionToolbar)
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
      // 走 unmount：顺带摘掉 scroll/resize 两个 window 监听，别把死 NodeView 留在监听表里。
      unmountToolbar()
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
