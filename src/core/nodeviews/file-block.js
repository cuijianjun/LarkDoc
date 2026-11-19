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
 *   - **上传中态由外层覆盖层负责**（推翻 ③-quinquies 那条「飞书没有上传中态」的结论：
 *     那次采样停在 90 秒窗口，未命中不代表不存在）。占位节点无 `src`，本 NodeView 会走
 *     `is-fallback` 分支；`file-upload-tasks.js` 在 `dom` 上补 `.is-uploading` 并 append
 *     一块 `data-lark-doc-file-ui` 的覆盖层把它盖住，进度只改覆盖层里的 `width`。
 *     NodeView 自身**不碰进度**：`stopEvent` / `ignoreMutation` 已让外部子节点不进事务。
 *
 * 状态判据（③-ter）刻意**不从 DOM 类名反推**：`status` 只由预览元素自己的事件
 * （video 的 `error` / `loadeddata`）驱动，避免「成功/失败/上传中三态都挂同一个
 * loading 容器」那类误判。
 */
import { safeAttachmentId, safeUrl } from '../documentOperations'
import { FILE_KIND, fileFallbackText, fileFooterText, fileKindOf, isPreviewableKind } from '../media/file-block'
import { iconNode } from '../../ui/icon'
import { bindHoverTips } from '../../ui/hoverTips'

/** 标记「属于 NodeView 自己的交互元素」：事件停在这里，不进 ProseMirror。 */
const UI_ATTR = 'data-lark-doc-file-ui'

/**
 * 块外工具条图标：全部 24 栅格实心路径（飞书 `universe-icon` 是 24 viewBox、渲染 18px），
 * 形状取自 obs/b10-04-file-click.json 实测的 path 前缀 + 实拍图，跟飞书同一套视觉。
 */
const BLOCK_ICON = {
  // ↖↗ 对角双箭头（飞书 fullscreen）
  fullscreen: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14.3 2.6a1 1 0 0 1 1-1h6.1a1 1 0 0 1 1 1v6.1a1 1 0 1 1-2 0V5.4l-5.3 5.3a1 1 0 0 1-1.4-1.4l5.3-5.3h-3.7a1 1 0 0 1-1-1Z"/><path d="M9.7 21.4a1 1 0 0 1-1 1H2.6a1 1 0 0 1-1-1v-6.1a1 1 0 1 1 2 0v3.3l5.3-5.3a1 1 0 0 1 1.4 1.4l-5.3 5.3h3.7a1 1 0 0 1 1 1Z"/></svg>',
  // 箭头入托盘（飞书 download：M20 18… 底槽 + 竖箭头）
  download: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20 18a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2a1 1 0 1 1 2 0v1h14v-1a1 1 0 0 1 1-1Z"/><path d="M12 2a1 1 0 0 1 1 1v9.586l3.293-3.293a1 1 0 0 1 1.414 1.414l-5 5a1 1 0 0 1-1.414 0l-5-5a1 1 0 1 1 1.414-1.414L11 12.586V3a1 1 0 0 1 1-1Z"/></svg>',
  // 短横 + 长横（飞书 inline view 原始 path：y=11 一行）
  inlineView: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M2 11a1 1 0 1 0 0 2h2a1 1 0 1 0 0-2H2Zm6 0a1 1 0 1 0 0 2h14a1 1 0 1 0 0-2H8Z"/></svg>',
  // 圆角卡片 + 内条（飞书 card view：M3 7.5h18c.552…）
  cardView: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 7.5a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9Zm2 1v7h14v-7H5Z"/><rect x="7" y="10.6" width="10" height="2.6" rx="1"/></svg>',
  // 显示器 + 底座横线（飞书 preview view：M3 5… + M4 19…）
  previewView: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5Zm2 0v9h14V5H5Z"/><path d="M4 19a1 1 0 0 1 1-1h14a1 1 0 1 1 0 2H5a1 1 0 0 1-1-1Z"/></svg>',
  // 双叠方块（飞书 copyAnchorLink）
  link: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 3.7h9.8a2 2 0 0 1 2 2v9.8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5.7a2 2 0 0 1 2-2Zm0 2v9.8h9.8V5.7H8Z"/><path d="M4.2 7.3a1 1 0 0 1 1 1v10.4h10.4a1 1 0 1 1 0 2H4.2a1 1 0 0 1-1-1V8.3a1 1 0 0 1 1-1Z"/></svg>',
  // 三条递减横线 + 右箭头（飞书 shareTextLink）
  share: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M2.5 4.6h18.4a1 1 0 1 1 0 2H2.5a1 1 0 0 1 0-2Z"/><path d="M2.5 10.7h11.4a1 1 0 1 1 0 2H2.5a1 1 0 0 1 0-2Z"/><path d="M2.5 16.8h7.2a1 1 0 1 1 0 2H2.5a1 1 0 0 1 0-2Z"/><path d="M16.6 15.9l3.7 2.2a1 1 0 0 1 0 1.7l-3.7 2.2z"/></svg>',
  // 气泡 + 内横线（飞书 comment 的两条原始 path）
  comment: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M2 5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v11.5a2 2 0 0 1-2 2h-3.812a.5.5 0 0 0-.33.124l-2.541 2.224a2 2 0 0 1-2.634 0l-2.542-2.224a.5.5 0 0 0-.329-.124H4a2 2 0 0 1-2-2V5Zm2 0v11.5h3.812a2.5 2.5 0 0 1 1.646.619L12 19.343l2.542-2.224a2.5 2.5 0 0 1 1.646-.619H20V5H4Z"/><path d="M7 11a1 1 0 0 1 1-1h8a1 1 0 1 1 0 2H8a1 1 0 0 1-1-1Z"/></svg>',
  // 垃圾桶：飞书这条工具条没有删除，这个按钮是本项目生命周期需要的，形状按同一套 24 栅格画。
  trash: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9.2 2.5a1 1 0 0 1 1-1h3.6a1 1 0 0 1 1 1V4h3.3a1 1 0 1 1 0 2h-1l-.85 13.1A1.9 1.9 0 0 1 14.36 21H9.64a1.9 1.9 0 0 1-1.89-1.9L6.9 6h-1a1 1 0 0 1 0-2h3.3V2.5Zm2 .5V4h1.6V3h-1.6ZM8.94 6l.83 12.9a.1.1 0 0 0 .1.1h4.26a.1.1 0 0 0 .1-.1L15.06 6H8.94Z"/></svg>',
}

/**
 * 视频播放器自绘图标：全部 currentColor，随控制条的浅色文字走；不写字面色。
 * `iconNode('fullscreen')` 复用图标表里现成那枚，避免重复登记。
 */
const VIDEO_ICON = {
  play: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4.6 2.9v10.2l8-5.1z"/></svg>',
  pause: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="4" y="3" width="2.6" height="10" rx=".6"/><rect x="9.4" y="3" width="2.6" height="10" rx=".6"/></svg>',
  volume: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M2 6h2.3L8 3.2v9.6L4.3 10H2zM10.4 5.4a3.6 3.6 0 0 1 0 5.2l.9.9a4.9 4.9 0 0 0 0-7z"/></svg>',
  muted: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M2 6h2.3L8 3.2v9.6L4.3 10H2z"/><path d="m10.3 5.6 1.2 1.2 1.2-1.2.8.8L12.3 7.6l1.2 1.2-.8.8-1.2-1.2-1.2 1.2-.8-.8 1.2-1.2-1.2-1.2z"/></svg>',
  pip: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="1.9" y="2.9" width="12.2" height="10.2" rx="1.3"/><rect x="7.7" y="7.6" width="5.4" height="4" rx=".6" fill="currentColor" stroke="none"/></svg>',
}

/** 分享：宿主还没接分享面板，块工具条上先只隐藏 UI。
    按钮构建、tips 与 `lark-doc:file-action` 事件出口全部保留，把这个开关打开即恢复。 */
const SHOW_SHARE = false

/** 评论：宿主还没接评论面板，视频里**所有**评论按钮（播放器顶栏 + 块工具条）统一隐藏 UI，
    按钮构建与事件出口同样保留。 */
const SHOW_COMMENT = false

/** 秒 → mm:ss（时长徽标与进度时间共用；无效值给空串，不显示 NaN）。 */
function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return ''
  const total = Math.floor(seconds)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** 控制条时间 `mm:ss/mm:ss`（飞书无空格；无效侧用 00:00 兜底，不出现 NaN/空半截）。 */
function formatClock(current, duration) {
  return `${formatDuration(current) || '00:00'}/${formatDuration(duration) || '00:00'}`
}

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

  const { editor, node, extension, getPos } = props
  const resolveFileUrl = extension && extension.options ? extension.options.resolveFileUrl : null
  let currentNode = node
  let status = STATUS.LOADING
  let resolvedSrc = null
  let attemptedToken = null
  let generation = 0

  const attrs = () => currentNode.attrs || {}
  const kind = () => fileKindOf(attrs().mimeType)

  /**
   * 被出网策略拦下的块：`src` 空了但 `originalSrc` 有值（见 policy/network.js 的 applyDocument）。
   * 这种块不许再走换票 —— 否则策略刚挡掉一个远端地址，换票又用一个远端地址补回来。
   */
  const blockedByPolicy = () => !safeFileUrl(attrs().src) && safeFileUrl(attrs().originalSrc)

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
  let mediaSrc = null
  /** 当前视频播放器控制条引用的 video（自绘 UI 的事件挂它；destroy 时一并清空）。 */
  let videoEl = null
  /** 播放器弹层挂的 document 级监听 / 提示句柄：随 media 一起销毁，换源也不残留。 */
  const videoCleanups = []

  /** 下载文件名：优先块 attrs.name，其次 URL 尾段；没扩展名时按 mimeType 补。 */
  function downloadName(url) {
    const fallback = (() => {
      try {
        const path = new (dom.ownerDocument.defaultView.URL)(url, dom.ownerDocument.baseURI).pathname
        return decodeURIComponent(path.split('/').pop() || '')
      } catch (_) { return '' }
    })()
    let name = String(attrs().name || '').trim() || fallback || 'download'
    if (!/\.[a-z0-9]{1,8}$/i.test(name)) {
      const mime = String(attrs().mimeType || '')
      const ext = mime === 'video/mp4' ? '.mp4'
        : mime === 'video/webm' ? '.webm'
          : mime === 'application/pdf' ? '.pdf'
            : mime.startsWith('image/') ? `.${mime.slice(6).replace('jpeg', 'jpg')}`
              : ''
      name += ext
    }
    return name
  }

  /** `a[download]` 真正落盘：不进 iframe、不导航当前页。 */
  function saveByAnchor(href, name, revoke) {
    const view = dom.ownerDocument.defaultView
    const doc = dom.ownerDocument
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
  async function downloadFile(url) {
    if (!url) return
    const view = dom.ownerDocument.defaultView
    const doc = dom.ownerDocument
    const name = downloadName(url)
    if (typeof view?.fetch === 'function' && typeof view?.URL?.createObjectURL === 'function') {
      try {
        const response = await view.fetch(url, { credentials: 'same-origin' })
        if (response?.ok) {
          const blob = await response.blob()
          if (blob && blob.size) { saveByAnchor(view.URL.createObjectURL(blob), name, true); return }
        }
      } catch (_) { /* 跨域 / 离线 → 下面兜底 */ }
    }
    let sameOrigin = false
    try { sameOrigin = new view.URL(url, doc.baseURI).origin === view.location.origin } catch (_) { sameOrigin = false }
    if (sameOrigin || url.startsWith('blob:') || url.startsWith('data:')) saveByAnchor(url, name, false)
    else downloadByIframe(url)
  }

  /** 兜底：隐藏 iframe 交给浏览器（同源直链缺 CORS 时也还能触发下载）。 */
  function downloadByIframe(url) {
    if (!url) return
    const view = dom.ownerDocument.defaultView
    const doc = dom.ownerDocument
    const frame = doc.createElement('iframe')
    frame.setAttribute('data-lark-doc-file-ui', '')
    frame.setAttribute('aria-hidden', 'true')
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

  /** 块外部浮动工具条的 tips 句柄（随块销毁清理）。 */
  let blockToolbarTips = null

  function teardownMedia() {
    if (!media) return
    while (videoCleanups.length) {
      const dispose = videoCleanups.pop()
      try { dispose() } catch (_) { /* 已失效的监听/句柄不影响换源 */ }
    }
    media.remove()
    media = null
    mediaKind = null
    mediaSrc = null
    videoEl = null
    dom.classList.remove('is-video-ready')
  }

  /**
   * 飞书式视频播放器（完成态）。
   *
   * 关键差异（相对旧的「裸 video + 固定 409 + contain」）：
   *   - 容器按视频真实宽高比自适应（`aspect-ratio`），画面 `object-fit: cover` 铺满 —— 消除上下灰留白；
   *   - 静态态：中央大播放键 + 右下角时长徽标；悬浮态：左上角文件名 + 底部自绘控制条
   *     （播放/暂停、进度、时间、倍速、清晰度占位、画中画、音量、全屏）。
   *   - 原生 `controls` 保留在 DOM 上供无 JS / 无障碍回退，但被 CSS 隐藏，视觉交给自绘条。
   * 全部交互元素走 `markUi`，事件被 stopEvent 吃掉，不进 ProseMirror 事务。
   */
  function buildVideo(src) {
    const shell = markUi(el('div', 'lark-doc-video-player'))

    const video = el('video', 'lark-doc-file-video', {
      controls: 'controls', // 保留原生控件作无障碍回退；CSS 隐藏，视觉交给自绘条（测试契约也依赖此属性）。
      playsinline: 'playsinline',
      preload: 'metadata',
      src,
      'aria-label': String(attrs().name || '视频'),
    })
    videoEl = video

    // 中央播放键（静态态）。
    const centerPlay = markUi(el('button', 'lark-doc-video-center-play', { type: 'button', 'aria-label': '播放视频' }))
    centerPlay.innerHTML = VIDEO_ICON.play

    // 左上角文件名浮层（悬浮态）。
    const nameOverlay = el('div', 'lark-doc-video-name')
    nameOverlay.textContent = String(attrs().name || '未命名视频')

    // 右下角时长徽标（静态态）。
    const durationBadge = el('span', 'lark-doc-video-duration')

    // 底部自绘控制条（悬浮态）：进度条位于控制栏顶部通栏；按钮按飞书顺序。
    const controls = markUi(el('div', 'lark-doc-video-controls'))
    const seek = markUi(el('div', 'lark-doc-video-seek', { role: 'slider', tabindex: '0', 'aria-label': '播放进度', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }))
    const seekFill = el('div', 'lark-doc-video-seek-fill')
    seek.appendChild(seekFill)
    const toggle = markUi(el('button', 'lark-doc-video-btn lark-doc-video-toggle', { type: 'button', 'aria-label': '播放' }))
    toggle.innerHTML = VIDEO_ICON.play
    const time = el('span', 'lark-doc-video-time')
    time.textContent = '00:00/00:00'
    const spacer = el('span', 'lark-doc-video-spacer')
    const rate = markUi(el('button', 'lark-doc-video-text-btn', { type: 'button', 'aria-label': '播放速度', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }))
    rate.textContent = '1x'
    const quality = markUi(el('button', 'lark-doc-video-text-btn', { type: 'button', 'aria-label': '清晰度', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }))
    quality.textContent = '480p'
    const pip = markUi(el('button', 'lark-doc-video-btn', { type: 'button', 'aria-label': '画中画' }))
    pip.innerHTML = VIDEO_ICON.pip
    const volume = markUi(el('button', 'lark-doc-video-btn', { type: 'button', 'aria-label': '静音', 'aria-expanded': 'false', 'data-tooltip-none': '' }))
    volume.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown')
    volume.innerHTML = VIDEO_ICON.volume
    const fullscreen = markUi(el('button', 'lark-doc-video-btn lark-doc-video-fullscreen', { type: 'button', 'aria-label': '进入全屏' }))
    fullscreen.appendChild(iconNode('fullscreen', 16))

    // 进度条先入 DOM（绝对定位在控制栏顶部），再放一排按钮。
    controls.appendChild(seek)
    controls.appendChild(toggle)
    controls.appendChild(time)
    controls.appendChild(spacer)
    controls.appendChild(rate)
    controls.appendChild(quality)
    controls.appendChild(pip)
    controls.appendChild(volume)
    controls.appendChild(fullscreen)

    shell.appendChild(video)
    shell.appendChild(nameOverlay)
    shell.appendChild(centerPlay)
    shell.appendChild(durationBadge)
    shell.appendChild(controls)

    /* ---- 播放态切换：中央键 ↔ 暂停键，静态徽标 ↔ 悬浮条 ---- */
    const syncPlaying = () => {
      const playing = !video.paused && !video.ended
      shell.classList.toggle('is-playing', playing)
      toggle.innerHTML = playing ? VIDEO_ICON.pause : VIDEO_ICON.play
      toggle.setAttribute('aria-label', playing ? '暂停' : '播放')
    }
    const togglePlay = () => {
      if (video.paused || video.ended) video.play().catch(() => {})
      else video.pause()
    }
    centerPlay.addEventListener('click', togglePlay)
    toggle.addEventListener('click', togglePlay)
    // 点画面本身也切换（与飞书一致），但控制条上的按钮不算（各自 stopPropagation）。
    video.addEventListener('click', togglePlay)
    video.addEventListener('play', syncPlaying)
    video.addEventListener('pause', syncPlaying)
    video.addEventListener('ended', syncPlaying)

    const syncTime = () => {
      const dur = Number.isFinite(video.duration) ? video.duration : 0
      const cur = Number.isFinite(video.currentTime) ? video.currentTime : 0
      const percent = dur > 0 ? Math.min(100, Math.round(cur / dur * 100)) : 0
      time.textContent = formatClock(cur, dur)
      seekFill.style.width = `${percent}%`
      seek.setAttribute('aria-valuenow', String(percent))
    }
    video.addEventListener('timeupdate', syncTime)
    video.addEventListener('durationchange', () => {
      durationBadge.textContent = formatDuration(video.duration)
      syncTime()
    })

    const seekTo = (clientX) => {
      const dur = Number.isFinite(video.duration) ? video.duration : 0
      if (dur <= 0) return
      const rect = seek.getBoundingClientRect()
      if (!rect.width) return
      video.currentTime = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * dur
    }
    seek.addEventListener('click', (event) => { event.stopPropagation(); seekTo(event.clientX) })
    seek.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      event.stopPropagation()
      const step = Number.isFinite(video.duration) ? video.duration * 0.05 : 5
      video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + (event.key === 'ArrowRight' ? step : -step)))
    })

    /* ---------- 播放器弹层（倍速 / 清晰度 / 音量） ----------
       飞书口径：倍速与清晰度是**贴着控制栏上沿浮出的深色菜单**，选中项左侧打 ✓；
       音量是**竖向滑杆面板**，顶部百分比 + 蓝色已填 + 白色圆钮。
       三个弹层都挂在播放器壳里（绝对定位），不吃 ProseMirror 事务。 */
    const doc = dom.ownerDocument
    const view = doc.defaultView
    let openPopup = null
    let openTrigger = null
    let popupHideTimer = null
    let popupResize = null
    const onPopupResize = () => closePopup(openPopup?.contains(doc.activeElement))
    const cancelPopupHide = () => {
      view.clearTimeout(popupHideTimer)
      popupHideTimer = null
    }
    const closePopup = (restoreFocus = false) => {
      cancelPopupHide()
      const trigger = openTrigger
      const popup = openPopup
      openPopup = null
      openTrigger = null
      view.removeEventListener('resize', onPopupResize)
      popupResize?.disconnect()
      popupResize = null
      popup?.remove()
      trigger?.setAttribute('aria-expanded', 'false')
      if (restoreFocus) trigger?.focus({ preventScroll: true })
    }
    const placePopup = (popup, trigger) => {
      const playerRect = shell.getBoundingClientRect()
      const triggerRect = trigger.getBoundingClientRect()
      const width = popup.offsetWidth
      const left = Math.max(8, Math.min(playerRect.width - width - 8, triggerRect.left - playerRect.left + triggerRect.width / 2 - width / 2))
      popup.style.left = `${Math.round(left)}px`
    }
    const showPopup = (popup, trigger) => {
      cancelPopupHide()
      if (openPopup === popup) return
      closePopup()
      shell.appendChild(popup)
      openPopup = popup
      openTrigger = trigger
      trigger.setAttribute('aria-expanded', 'true')
      placePopup(popup, trigger)
      view.addEventListener('resize', onPopupResize)
      if (view.ResizeObserver) {
        popupResize = new view.ResizeObserver(() => {
          if (openPopup === popup) placePopup(popup, trigger)
        })
        popupResize.observe(shell)
      }
    }
    const bindPopupHover = (popup, trigger) => {
      const leave = () => {
        if (openPopup !== popup) return
        cancelPopupHide()
        popupHideTimer = view.setTimeout(() => {
          if (openPopup === popup && !popup.contains(doc.activeElement)) closePopup()
        }, 200)
      }
      trigger.addEventListener('pointerenter', event => {
        if (event.pointerType !== 'touch') showPopup(popup, trigger)
      })
      trigger.addEventListener('pointerleave', leave)
      popup.addEventListener('pointerenter', cancelPopupHide)
      popup.addEventListener('pointerleave', leave)
      popup.addEventListener('focusout', event => {
        if (openPopup === popup && !popup.contains(event.relatedTarget)) closePopup()
      })
    }
    const buildMenu = (ariaLabel, options, current, onPick) => {
      const popup = markUi(el('div', 'lark-doc-video-popup lark-doc-video-menu', { role: 'menu', 'aria-label': ariaLabel }))
      const rows = options.map((option) => {
        const item = el('button', 'lark-doc-video-menu-item', { type: 'button', role: 'menuitemradio', 'aria-checked': String(option.value === current) })
        const check = el('span', 'lark-doc-video-menu-check', { 'aria-hidden': 'true' })
        check.textContent = '✓'
        const label = el('span', 'lark-doc-video-menu-label')
        label.textContent = option.label
        item.appendChild(check)
        item.appendChild(label)
        item.addEventListener('click', (event) => {
          event.stopPropagation()
          onPick(option.value)
          rows.forEach((row) => row.setAttribute('aria-checked', String(row === item)))
          closePopup(popup.contains(doc.activeElement))
        })
        popup.appendChild(item)
        return item
      })
      return popup
    }

    const RATE_OPTIONS = [2, 1.5, 1, 0.75, 0.5].map(value => ({ value, label: `${value}x` }))
    const rateMenu = buildMenu('播放速度', RATE_OPTIONS, 1, (value) => {
      video.playbackRate = value
      rate.textContent = `${value}x`
    })
    const QUALITY_OPTIONS = ['360p', '480p', '原画'].map(value => ({ value, label: value }))
    // 本地只有一个源文件，清晰度是**档位展示**（切档不换源，和飞书同款菜单交互）。
    const qualityMenu = buildMenu('清晰度', QUALITY_OPTIONS, '480p', (value) => { quality.textContent = value })

    for (const [trigger, menu] of [[rate, rateMenu], [quality, qualityMenu]]) {
      bindPopupHover(menu, trigger)
      trigger.addEventListener('click', event => {
        event.stopPropagation()
        showPopup(menu, trigger)
        if (event.detail === 0) menu.querySelector('[aria-checked="true"]').focus()
      })
      const items = Array.from(menu.children)
      menu.addEventListener('keydown', event => {
        const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
        if (!step) return
        event.preventDefault()
        event.stopPropagation()
        items[(items.indexOf(event.target) + step + items.length) % items.length].focus()
      })
    }

    /* 音量面板 */
    const volumePanel = markUi(el('div', 'lark-doc-video-popup lark-doc-video-volume', { role: 'group', 'aria-label': '音量' }))
    const volumeValue = el('span', 'lark-doc-video-volume-value')
    const volumeTrack = markUi(el('div', 'lark-doc-video-volume-track', {
      role: 'slider', tabindex: '0', 'aria-label': '音量', 'aria-orientation': 'vertical', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '100',
    }))
    const volumeFill = el('div', 'lark-doc-video-volume-fill')
    const volumeKnob = el('span', 'lark-doc-video-volume-knob')
    volumeTrack.appendChild(volumeFill)
    volumeTrack.appendChild(volumeKnob)
    volumePanel.appendChild(volumeValue)
    volumePanel.appendChild(volumeTrack)

    let lastVolume = 1
    const currentVolume = () => (video.muted ? 0 : (Number.isFinite(video.volume) ? video.volume : 1))
    const syncVolume = () => {
      const value = Math.max(0, Math.min(1, currentVolume()))
      const percent = Math.round(value * 100)
      volumeValue.textContent = `${percent}%`
      volumeFill.style.height = `${percent}%`
      volumeKnob.style.bottom = `${percent}%`
      volumeTrack.setAttribute('aria-valuenow', String(percent))
      volume.classList.toggle('is-muted', value === 0)
      volume.innerHTML = value === 0 ? VIDEO_ICON.muted : VIDEO_ICON.volume
      volume.setAttribute('aria-label', value === 0 ? '取消静音' : '静音')
    }
    const setVolume = (value) => {
      const next = Math.max(0, Math.min(1, value))
      video.volume = next
      video.muted = next === 0
      if (next > 0) lastVolume = next
      syncVolume()
    }
    const volumeAt = (clientY) => {
      const rect = volumeTrack.getBoundingClientRect()
      if (!rect.height) return
      setVolume((rect.bottom - clientY) / rect.height)
    }
    bindPopupHover(volumePanel, volume)
    volume.addEventListener('keydown', event => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
      event.preventDefault()
      event.stopPropagation()
      showPopup(volumePanel, volume)
      volumeTrack.focus()
    })
    volume.addEventListener('click', (event) => {
      event.stopPropagation()
      if (event.pointerType === 'touch' && openPopup !== volumePanel) {
        showPopup(volumePanel, volume)
        return
      }
      if (currentVolume() === 0) setVolume(lastVolume || 1)
      else setVolume(0)
    })
    let volumeDragging = false
    volumeTrack.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      volumeDragging = true
      volumeAt(event.clientY)
      volumeTrack.setPointerCapture?.(event.pointerId)
    })
    volumeTrack.addEventListener('pointermove', (event) => {
      if (!volumeDragging) return
      event.stopPropagation()
      volumeAt(event.clientY)
    })
    const endVolumeDrag = () => { volumeDragging = false }
    volumeTrack.addEventListener('pointerup', endVolumeDrag)
    volumeTrack.addEventListener('pointercancel', endVolumeDrag)
    volumeTrack.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
      event.preventDefault()
      event.stopPropagation()
      setVolume(currentVolume() + (event.key === 'ArrowUp' ? 0.05 : -0.05))
    })

    /* 点空白处 / Esc 收起弹层（挂在 document 上，随块销毁解绑）。 */
    const onDocumentPointerDown = (event) => {
      if (!openPopup) return
      if (openPopup.contains(event.target) || openTrigger.contains(event.target)) return
      closePopup()
    }
    const onDocumentKeyDown = (event) => {
      if (event.key !== 'Escape' || !openPopup) return
      if (shell.contains(event.target)) event.stopPropagation()
      closePopup(openPopup.contains(doc.activeElement))
    }
    doc.addEventListener('pointerdown', onDocumentPointerDown, true)
    doc.addEventListener('keydown', onDocumentKeyDown, true)
    videoCleanups.push(() => {
      doc.removeEventListener('pointerdown', onDocumentPointerDown, true)
      doc.removeEventListener('keydown', onDocumentKeyDown, true)
      closePopup()
    })

    pip.addEventListener('click', (event) => {
      event.stopPropagation()
      if (doc.pictureInPictureElement === video) doc.exitPictureInPicture?.().catch(() => {})
      else video.requestPictureInPicture?.().catch(() => {})
    })
    video.addEventListener('enterpictureinpicture', () => pip.setAttribute('aria-label', '退出画中画'))
    video.addEventListener('leavepictureinpicture', () => pip.setAttribute('aria-label', '画中画'))
    fullscreen.addEventListener('click', (event) => {
      event.stopPropagation()
      if (doc.fullscreenElement === shell) doc.exitFullscreen?.().catch(() => {})
      else if (video.webkitDisplayingFullscreen) video.webkitExitFullscreen?.()
      else if (shell.requestFullscreen) shell.requestFullscreen().catch(() => {})
      else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen()
    })
    // 全屏按钮的中文提示随状态切换（飞书：进入全屏 / 退出全屏）。
    const syncFullscreenLabel = () => {
      const active = doc.fullscreenElement === shell || Boolean(video.webkitDisplayingFullscreen)
      fullscreen.setAttribute('aria-label', active ? '退出全屏' : '进入全屏')
    }
    doc.addEventListener('fullscreenchange', syncFullscreenLabel)
    videoCleanups.push(() => doc.removeEventListener('fullscreenchange', syncFullscreenLabel))
    video.addEventListener('webkitbeginfullscreen', syncFullscreenLabel)
    video.addEventListener('webkitendfullscreen', syncFullscreenLabel)
    video.addEventListener('volumechange', syncVolume)
    videoCleanups.push(() => video.removeEventListener('volumechange', syncVolume))
    // 播放、画中画和全屏悬停时显示动作提示。
    const controlTips = bindHoverTips(controls)
    videoCleanups.push(() => controlTips.destroy())
    syncVolume()

    // 封面走 `coverUrl`（⑤ 的既有属性，此前没有任何消费者）。被出网策略拦下时
    // 它已经是本地透明占位，不会发请求。
    if (safeFileUrl(attrs().coverUrl)) video.setAttribute('poster', attrs().coverUrl)
    // 解码拿到真实尺寸后按宽高比撑容器（cover 铺满 + 容器同比 → 无留白、不裁切）。
    video.addEventListener('loadedmetadata', () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        shell.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`
      }
      durationBadge.textContent = formatDuration(video.duration)
      syncTime()
      dom.classList.add('is-video-ready')
      status = STATUS.READY
      syncPreview()
    })
    // 解码失败 = 视频兜底态（③-octies B 段：45MB mp4 落的块高 268、文案换掉、下载仍在）。
    video.addEventListener('error', () => { status = STATUS.ERROR; syncPreview() })
    return shell
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

  /** 文本视图（飞书 inline view）：图标 + 文件名 + 大小，一行紧凑展示，点击走下载。 */
  function buildInline() {
    const row = markUi(el('div', 'lark-doc-file-inline', { role: 'group', 'aria-label': '文本视图' }))
    const icon = el('span', 'lark-doc-file-inline-icon', { 'aria-hidden': 'true' })
    icon.appendChild(iconNode('slides', 16))
    const link = markUi(el('a', 'lark-doc-file-inline-link', { role: 'button' }))
    link.textContent = String(attrs().name || '未命名文件')
    const href = effectiveSrc()
    if (href) link.setAttribute('data-href', href)
    else link.setAttribute('aria-disabled', 'true')
    link.addEventListener('click', (event) => { event.stopPropagation(); downloadFile(link.getAttribute('data-href')) })
    const sub = el('span', 'lark-doc-file-inline-size')
    sub.textContent = fileFooterText('', attrs().size)
    row.appendChild(icon)
    row.appendChild(link)
    row.appendChild(sub)
    return row
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
  // 与视频工具条同一个出口：取字节 → a[download] 落盘（href 留着给右键/中键用）。
  download.addEventListener('click', (event) => {
    event.preventDefault()
    if (download.getAttribute('aria-disabled') === 'true') return
    downloadFile(effectiveSrc())
  })
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
      download.setAttribute('download', downloadName(href))
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

  /* ---------- 块外部浮动工具条（飞书 b10-04-file-click.json） ----------
     飞书文档里视频/文件块**只有这一条**工具条：浮在块上方、块外，选中/悬浮出现。
     顺序按实测 data-name：fullscreen | download — text/card/preview view — copy link |
     （share — comment 暂时隐藏，见 SHOW_SHARE / SHOW_COMMENT）| delete。全部 markUi，事件不进 ProseMirror。 */
  let blockToolbar = null
  const viewButtons = {}

  /* 工具条浮在块外 8px 之上：鼠标从画面移过去会穿过这段「既不在块内、也不在条内」的空隙，
     纯 CSS `:hover` 会在这几帧里断掉 → opacity 归 0、pointer-events 回 none，按钮就点不住了。
     所以用「进入即开、离开延时关」的显隐类兜住这段过渡（图片工具条同款做法）。 */
  const TOOLBAR_OPEN_CLASS = 'is-toolbar-open'
  const TOOLBAR_HIDE_DELAY = 180
  let toolbarHideTimer = null

  function openBlockToolbar() {
    if (toolbarHideTimer != null) { clearTimeout(toolbarHideTimer); toolbarHideTimer = null }
    dom.classList.add(TOOLBAR_OPEN_CLASS)
  }

  function closeBlockToolbarSoon() {
    if (toolbarHideTimer != null) clearTimeout(toolbarHideTimer)
    toolbarHideTimer = setTimeout(() => {
      toolbarHideTimer = null
      dom.classList.remove(TOOLBAR_OPEN_CLASS)
    }, TOOLBAR_HIDE_DELAY)
  }

  function disposeBlockToolbar() {
    if (toolbarHideTimer != null) { clearTimeout(toolbarHideTimer); toolbarHideTimer = null }
    dom.classList.remove(TOOLBAR_OPEN_CLASS)
  }

  const blockIconButton = (name, label, icon, extra = {}) => {
    const button = markUi(el('button', 'lark-doc-block-tool-btn', {
      type: 'button', 'aria-label': label, 'data-name': name, ...extra,
    }))
    button.innerHTML = icon
    return button
  }

  function fireFileAction(action) {
    const detail = { action, source: 'file', ...currentNode.attrs }
    const pos = typeof getPos === 'function' ? getPos() : null
    if (pos != null) detail.pos = pos
    dom.dispatchEvent(new dom.ownerDocument.defaultView.CustomEvent('lark-doc:file-action', {
      bubbles: true, detail,
    }))
  }

  function setViewType(viewType) {
    const pos = typeof getPos === 'function' ? getPos() : null
    if (pos == null || !editor || !editor.view) return
    try {
      const at = editor.state.doc.nodeAt(pos)
      if (!at || at.type.name !== currentNode.type.name) return
      editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...at.attrs, viewType }))
    } catch (_) { /* 编辑器正在销毁*/ }
  }

  function deleteBlock() {
    const pos = typeof getPos === 'function' ? getPos() : null
    if (pos == null || !editor || !editor.view) return
    try {
      const at = editor.state.doc.nodeAt(pos)
      if (!at) return
      editor.view.dispatch(editor.state.tr.delete(pos, pos + at.nodeSize))
      // 删块后把焦点交回编辑器，否则 Ctrl+Z 落在别处、history 收不到（飞书删除即可撤销）。
      editor.view.focus()
    } catch (_) { /* 编辑器正在销毁*/ }
  }

  function copyBlockLink() {
    const anchor = typeof attrs().blockId === 'string' && attrs().blockId
      ? `#${attrs().blockId}`
      : (effectiveSrc() || '')
    const clipboard = dom.ownerDocument.defaultView.navigator?.clipboard
    clipboard?.writeText?.(anchor).catch(() => {})
  }

  function buildBlockToolbar() {
    const bar = markUi(el('div', 'lark-doc-file-block-toolbar', { role: 'toolbar', 'aria-label': '文件工具' }))
    // 别让按钮抢走编辑器焦点，否则删完块 Ctrl+Z 进不到 history（图片工具条同款做法）。
    bar.addEventListener('mousedown', (event) => event.preventDefault())
    // 飞书两档分隔线：组内 1×20；三态视图后那条是 override-full-height（贴满 40 高容器）。
    const divider = (full = false) => el('span',
      `lark-doc-block-tool-divider${full ? ' is-full' : ''}`,
      { 'aria-hidden': 'true' })

    const fullscreen = blockIconButton('fullscreen', '全屏', BLOCK_ICON.fullscreen)
    fullscreen.addEventListener('click', (event) => {
      event.stopPropagation()
      const player = preview.querySelector('.lark-doc-video-player')
      if (player?.requestFullscreen) player.requestFullscreen().catch(() => {})
      else if (videoEl?.webkitEnterFullscreen) videoEl.webkitEnterFullscreen()
    })
    const download = blockIconButton('download', '下载', BLOCK_ICON.download)
    download.addEventListener('click', (event) => { event.stopPropagation(); downloadFile(effectiveSrc()) })
    bar.appendChild(fullscreen)
    bar.appendChild(download)
    bar.appendChild(divider())

    const triplets = [
      ['text view', '文本视图', 'Inline', BLOCK_ICON.inlineView],
      ['card view', '卡片视图', 'Card', BLOCK_ICON.cardView],
      ['preview view', '预览视图', 'Preview', BLOCK_ICON.previewView],
    ]
    triplets.forEach(([name, label, value, icon]) => {
      const button = blockIconButton(name, label, icon, { 'aria-pressed': 'false' })
      button.addEventListener('click', (event) => { event.stopPropagation(); setViewType(value) })
      viewButtons[value] = button
      bar.appendChild(button)
    })
    bar.appendChild(divider(true))

    const copyLink = blockIconButton('copyAnchorLink', '复制链接', BLOCK_ICON.link)
    copyLink.addEventListener('click', (event) => { event.stopPropagation(); copyBlockLink() })
    const share = blockIconButton('shareTextLink', '分享', BLOCK_ICON.share)
    share.addEventListener('click', (event) => { event.stopPropagation(); fireFileAction('share') })
    bar.appendChild(copyLink)

    const comment = blockIconButton('comment', '评论', BLOCK_ICON.comment)
    comment.addEventListener('click', (event) => { event.stopPropagation(); fireFileAction('comment') })
    // 分享 / 评论暂时隐藏 UI（宿主未接面板），按钮与事件出口照旧保留。
    if (SHOW_SHARE) bar.appendChild(share)
    if (SHOW_SHARE || SHOW_COMMENT) bar.appendChild(divider())
    if (SHOW_COMMENT) bar.appendChild(comment)
    bar.appendChild(divider())
    const remove = blockIconButton('delete', '删除', BLOCK_ICON.trash)
    remove.addEventListener('click', (event) => { event.stopPropagation(); deleteBlock() })
    bar.appendChild(remove)

    return bar
  }

  function syncBlockToolbar() {
    // 只给视频形态挂这条（用户本轮聚焦视频；其它 file 块保持原样不动）。
    const isVideo = kind() === FILE_KIND.VIDEO
    dom.classList.toggle('has-block-toolbar', isVideo)
    if (!isVideo) return
    if (!blockToolbar) {
      blockToolbar = buildBlockToolbar()
      dom.appendChild(blockToolbar)
      blockToolbarTips = bindHoverTips(blockToolbar)
      // 块与条各自进出都走同一对开关；跨 8px 空隙时靠 180ms 延时兜住。
      dom.addEventListener('pointerenter', openBlockToolbar)
      dom.addEventListener('pointerleave', closeBlockToolbarSoon)
      blockToolbar.addEventListener('pointerenter', openBlockToolbar)
      blockToolbar.addEventListener('pointerleave', closeBlockToolbarSoon)
    }
    const current = ['Preview', 'Card', 'Inline'].includes(attrs().viewType) ? attrs().viewType : 'Card'
    Object.keys(viewButtons).forEach(value => {
      viewButtons[value].setAttribute('aria-pressed', String(value === current))
    })
  }

  /* ---------- 预览区同步（唯一出口，避免状态与 DOM 分叉） ---------- */
  function syncPreview() {
    const src = effectiveSrc()
    const shape = kind()
    const viewType = ['Preview', 'Card', 'Inline'].includes(attrs().viewType)
      ? attrs().viewType
      : (isPreviewableKind(shape) ? 'Preview' : 'Card')

    preview.classList.remove('is-fallback', 'is-card', 'is-inline')

    // 没有地址 / 宿主明确要卡片 / 形态本身不该内嵌 → 三条路都不挂预览元素。
    if (!src) {
      teardownMedia()
      preview.classList.add('is-fallback')
      replacePreview(buildFallback(fileFallbackText(shape)))
      return
    }
    if (viewType === 'Inline') {
      teardownMedia()
      preview.classList.add('is-inline')
      replacePreview(buildInline())
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
    if (media && mediaKind === shape && mediaSrc === src) {
      replacePreview(media, true)
      return
    }
    teardownMedia()
    media = shape === FILE_KIND.VIDEO ? buildVideo(src) : buildFrame(src)
    mediaKind = shape
    mediaSrc = src
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
    if (blockedByPolicy()) return
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
    if (blockedByPolicy()) dom.setAttribute('data-network-blocked', 'true')
    else dom.removeAttribute('data-network-blocked')
    // 原地址留在 DOM 上，宿主做「重新上传替换」时能从这里取回被拦下的地址。
    if (safeFileUrl(attrs().originalSrc)) dom.setAttribute('data-original-src', attrs().originalSrc)
    else dom.removeAttribute('data-original-src')
    syncFooter()
    syncPreview()
    syncBlockToolbar()
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
      disposeBlockToolbar()
      blockToolbarTips?.destroy()
      blockToolbarTips = null
      blockToolbar?.remove()
      blockToolbar = null
    },
    // 测试与宿主联调通道。
    status() { return status },
    kind() { return kind() },
    refresh() { attemptedToken = null; syncAll(); maybeResolveToken() },
    downloadUrl: effectiveSrc,
  }
}

export default createFileBlockNodeView
