/**
 * 内嵌网页块 NodeView —— 纯 DOM，core 零 UI 框架依赖（P3-01）。
 *
 * 规格来源 requirements/04 §4.3（实测）+ requirements/09 §3.4.1 / §3.4.2：
 *
 *   - 壳：`.iframe-container` 带 `1px solid #DEE0E3` + `radius 9px`，
 *     inline `width: 820px; max-width: 1041px`（正文宽 × 1.27 是飞书的硬顶）；
 *   - **loading 与就绪共用同一个壳**：先挂转圈（36×36），iframe `load` 之后再补边框。
 *     04 §4.3 ⑥ 的时间线：落块 ~250ms 无 `__border` / 无 `editable` → ≥1.5s 才有。
 *     这里用 `data-embed-state` 一个属性翻面，CSS 按状态给边框，避免两份类名列表漂移。
 *   - **加载失败零反馈**（04 §4.3 ⑦ 15s 实测：块高恒定、src 原样、无文案、无 toast）：
 *     所以 `iframe.onerror` 什么都不做，只保留白块。
 *   - **桥 3s 超时才降级**，且**只有存在 `poster` 才降级**（09 §3.4.2 超时降级 → 快照卡）。
 *     没有 poster 就继续白块 —— 这才是飞书 1:1（飞书没有桥，自然永远白块）。
 *   - **高度拖拽不实现**：04 §4.3 ④ 实测拖右下角手柄尺寸完全不变，4 个 `.draggable-btn`
 *     静止与 hover 后 `display` 均为 `none`，类名带 `is-iframe-free-width`（宽度受正文约束）。
 *     1:1 就是不画手柄；块高只由 `height` / `aspect` / 桥 `resize` 决定。
 */
import { safeUrl } from '../documentOperations'
import { createEmbedBridge } from '../embed/bridge'
import {
  GENERIC_PROVIDER_ID, safeEmbedSrc, resolveEmbedHeight,
  DEFAULT_EMBED_SANDBOX, DEFAULT_EMBED_ALLOW,
} from '../embed/web-embed'

/** 标记「属于 NodeView 自己的交互元素」：事件停在这里，不进 ProseMirror。 */
const UI_ATTR = 'data-lark-doc-embed-ui'

const STATUS = Object.freeze({
  /** 刚落下，转圈中（iframe 已挂 src，还没 load）。 */
  LOADING: 'loading',
  /** iframe 已就绪（load 或桥握手成功）。 */
  READY: 'ready',
  /** 桥 3s 未握手 + 有 poster → 快照卡。 */
  DEGRADED: 'degraded',
  /** 没有可用 src，或被出网策略拦下（`canEmbed` 返回 false）→ 不挂 iframe。 */
  BLOCKED: 'blocked',
})

/**
 * sandbox / allow 的默认值取自判定层（09 §3.4.2 安全基线，见 `core/embed/web-embed.js`
 * 里的取值说明），这里只留「宿主可覆盖」的通道。
 */

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

const safePoster = (value) => typeof value === 'string' && value && safeUrl(value, true)

export function createWebEmbedNodeView(props) {

  const { node, extension } = props
  const options = (extension && extension.options) || {}

  let currentNode = node
  let status = STATUS.LOADING
  let iframe = null
  let bridge = null
  let listening = false
  let destroyed = false
  let generation = 0

  const attrs = () => currentNode.attrs || {}
  const embedSrc = () => (attrs().src && safeEmbedSrc(attrs().src) ? attrs().src : null)
  const poster = () => (safePoster(attrs().poster) ? attrs().poster : null)

  /** 出网策略闸门（P3-06 注入）。注入器抛错一律当「拦」，宁可不加载也不越权加载。 */
  function policyAllows() {
    const src = embedSrc()
    if (!src) return false
    if (typeof options.canEmbed !== 'function') return true
    try { return options.canEmbed(src) !== false } catch (_) { return false }
  }

  /* ---------- DOM 骨架：figure > iframe-container > iframe-content ---------- */
  const dom = el('figure', 'lark-doc-embed docx-iframe-block', {
    'data-type': 'web-embed', 'data-block-type': 'iframe', contenteditable: 'false',
  })
  const frame = markUi(el('div', 'iframe-container lark-doc-embed-frame'))
  const content = markUi(el('div', 'iframe-content lark-doc-embed-content'))
  /**
   * `.iframe-layer` 从挂载起就常驻，iframe 一旦造出来就塞进来。
   *
   * 为什么不是「就绪后才进 DOM」：**游离的 iframe 没有 browsing context，永远不触发
   * `load`、`contentWindow` 也是 null** —— 那样转圈会一直转下去，桥也起不来。
   * loading 期的「看不见」交给 CSS（`[data-embed-state="loading"] .iframe-layer`），
   * 视觉结果与 04 §4.3 ⑥ 的 250ms 快照一致（只有转圈），只是实现上先挂后藏。
   */
  const layer = markUi(el('div', 'iframe-layer lark-doc-embed-layer'))
  content.appendChild(layer)
  frame.appendChild(content)
  dom.appendChild(frame)

  /* ---------- 四态的 content 内容 ---------- */

  function buildLoading() {
    const box = markUi(el('div', 'lark-doc-embed-loading'))
    // 36×36 转圈（04 §4.3 ⑥ `.docx-block-spin`）。
    box.appendChild(el('span', 'lark-doc-embed-spin', { role: 'progressbar', 'aria-label': '正在加载嵌入内容' }))
    return box
  }

  function buildIframe(src) {
    const sandbox = typeof options.sandbox === 'string' && options.sandbox ? options.sandbox : DEFAULT_EMBED_SANDBOX
    const allow = typeof options.allow === 'string' && options.allow ? options.allow : DEFAULT_EMBED_ALLOW
    const element = markUi(el('iframe', 'lark-doc-embed-iframe', {
      src,
      title: String(attrs().title || '内嵌网页'),
      sandbox,
      allow,
      allowfullscreen: 'true',
      referrerpolicy: 'no-referrer',
      loading: 'lazy',
    }))
    return element
  }

  function buildDegraded() {
    const box = markUi(el('div', 'lark-doc-embed-fallback'))
    const shot = poster()
    if (shot) {
      // poster 是快照图：用 div + background-image 而不是 img —— 图挂了也不会破图标（同 bookmark 的 favicon 口径）。
      const image = el('div', 'lark-doc-embed-poster', { role: 'img', 'aria-label': String(attrs().title || '内嵌网页快照') })
      image.style.backgroundImage = `url("${shot.replace(/"/g, '%22')}")`
      box.appendChild(image)
    }
    const caption = el('p', 'lark-doc-embed-fallback-text')
    caption.textContent = String(attrs().title || '嵌入内容未响应')
    box.appendChild(caption)
    const src = embedSrc()
    if (src) {
      const open = markUi(el('a', 'lark-doc-embed-open', { href: src, target: '_blank', rel: 'noopener noreferrer' }))
      open.textContent = '在新窗口打开'
      box.appendChild(open)
    }
    return box
  }

  /** 被拦 / 无 src：有 poster 就只显示图，没有就留白（1:1 飞书白块，不加错误 UI）。 */
  function buildBlocked() {
    const box = markUi(el('div', 'lark-doc-embed-fallback is-blocked'))
    const shot = poster()
    if (shot) {
      const image = el('div', 'lark-doc-embed-poster', { role: 'img', 'aria-label': String(attrs().title || '内嵌网页快照') })
      image.style.backgroundImage = `url("${shot.replace(/"/g, '%22')}")`
      box.appendChild(image)
    }
    return box
  }

  /** 换掉「状态层」（转圈 / 快照卡 / 留白），**永远不动常驻的 `.iframe-layer`**。 */
  function setOverlay(element) {
    const extra = Array.prototype.slice.call(content.children).filter((child) => child !== layer)
    extra.forEach((child) => content.removeChild(child))
    if (element) content.appendChild(element)
  }

  /* ---------- 桥 ---------- */

  function detachBridge() {
    if (bridge) {
      bridge.destroy()
      bridge = null
    }
  }

  function handleMessage(event) {
    if (bridge) bridge.handleMessage(event)
  }

  function attachListener() {
    if (listening || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return
    window.addEventListener('message', handleMessage)
    listening = true
  }

  function detachListener() {
    if (!listening || typeof window === 'undefined' || typeof window.removeEventListener !== 'function') return
    window.removeEventListener('message', handleMessage)
    listening = false
  }

  function applyHeight(height) {
    const value = Number(height)
    if (!Number.isFinite(value) || value < 120 || value > 4000) return
    const mine = ++generation
    // 桥上报的高度是内容真实高度，直接写 inline 高度；`generation` 防晚到的上报打穿已重挂的块。
    if (mine !== generation) return
    dom.style.setProperty('--lark-doc-embed-height', `${Math.round(value)}px`)
    frame.style.height = `${Math.round(value)}px`
  }

  function enterFullscreen() {
    const target = typeof frame.requestFullscreen === 'function' ? frame : null
    if (!target) return
    try { target.requestFullscreen() } catch (_) { /* 全屏被浏览器策略拒了就保持原样 */ }
  }

  function startBridge() {
    detachBridge()
    if (destroyed || !iframe || !iframe.contentWindow || !embedSrc()) return
    const timeout = Number(options.bridgeTimeout)
    bridge = createEmbedBridge({
      src: embedSrc(),
      target: iframe.contentWindow,
      ...(Number.isFinite(timeout) && timeout > 0 ? { timeout } : {}),
      onReady() {
        if (destroyed) return
        status = STATUS.READY
        syncAll()
      },
      onResize: applyHeight,
      onSetTitle(title) {
        if (destroyed) return
        if (typeof options.onSetTitle === 'function') options.onSetTitle(title, attrs())
      },
      onSave(payload) {
        if (typeof options.onSave === 'function') options.onSave({ ...payload, attrs: attrs() })
      },
      onFullscreen: enterFullscreen,
      onTimeout() {
        if (destroyed) return
        // 只有拿得出快照才降级；没有 poster 就继续飞书那种静默白块。
        if (!poster()) return
        status = STATUS.DEGRADED
        syncAll()
      },
    })
    attachListener()
    bridge.start()
  }

  function teardownIframe() {
    detachBridge()
    detachListener()
    if (iframe) {
      iframe.removeEventListener('load', onFrameLoad)
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
      iframe = null
    }
  }

  /**
   * iframe 一 load 就翻就绪态并起桥。
   *
   * 顺序不能反：`init` 要是早于文档就绪发出去，会被丢在空白文档里（09 §3.4.2）。
   * 注意 load 只代表「文档载完了」，不代表嵌入内容愿不愿意握手 —— 所以这里先给 READY
   * （边框补上，04 §4.3 ⑥ 的 ≥1.5s 那一档），3s 内没握手再走 DEGRADED。
   */
  function onFrameLoad() {
    if (destroyed) return
    if (status === STATUS.BLOCKED) return
    status = STATUS.READY
    syncAll()
    startBridge()
  }

  /* ---------- 唯一同步出口 ---------- */
  function syncAll() {
    const src = embedSrc()
    dom.setAttribute('data-provider-id', attrs().providerId || GENERIC_PROVIDER_ID)
    if (src) dom.setAttribute('data-src', src)
    else dom.removeAttribute('data-src')
    if (attrs().title) dom.setAttribute('data-embed-title', attrs().title)
    else dom.removeAttribute('data-embed-title')
    if (poster()) dom.setAttribute('data-poster', poster())
    else dom.removeAttribute('data-poster')
    dom.setAttribute('data-bridge-version', String(Number.isInteger(attrs().bridgeVersion) ? attrs().bridgeVersion : 1))

    const blocked = !policyAllows()
    if (blocked) status = STATUS.BLOCKED

    if (status !== STATUS.BLOCKED && status !== STATUS.DEGRADED && !iframe && src) {
      // 只有真要加载时才建 iframe；被拦的块连 src 都不设（P3-06：offline 下不设 src）。
      // 造出来立刻进常驻层 —— 游离 iframe 不 load，这一步是「能不能出转圈」的关键。
      iframe = buildIframe(src)
      iframe.addEventListener('load', onFrameLoad)
      layer.appendChild(iframe)
    }

    dom.setAttribute('data-embed-state', status)
    frame.style.width = '100%'
    frame.style.maxWidth = '1041px'

    if (status === STATUS.BLOCKED) {
      teardownIframe()
      frame.removeAttribute('style')
      setOverlay(buildBlocked())
      return
    }
    if (status === STATUS.DEGRADED) {
      teardownIframe()
      if (!frame.style.height) frame.style.height = `${resolveEmbedHeight(attrs(), dom.clientWidth || 820)}px`
      setOverlay(buildDegraded())
      return
    }
    if (status === STATUS.LOADING) {
      if (!frame.style.height) frame.style.height = `${resolveEmbedHeight(attrs(), dom.clientWidth || 820)}px`
      setOverlay(buildLoading())
      return
    }
    // READY：转圈撤掉，`.iframe-layer` 由 CSS 按 `data-embed-state` 显形。
    if (!iframe) return
    if (!frame.style.height) frame.style.height = `${resolveEmbedHeight(attrs(), dom.clientWidth || 820)}px`
    setOverlay(null)
  }

  syncAll()

  return {
    dom,
    update(nextNode) {
      if (!nextNode || !nextNode.type || nextNode.type.name !== currentNode.type.name) return false
      // 两侧归一到 null 再比：Tiptap 创建后紧跟的 update() 会把 undefined 补成默认 null，
      // 直接比会把「没换源」误判成换源（→ 无辜重挂一次 iframe）。
      const previousSrc = attrs().src || null
      const previousPoster = attrs().poster || null
      currentNode = nextNode
      if (previousSrc !== (attrs().src || null) || previousPoster !== (attrs().poster || null)) {
        teardownIframe()
        generation += 1
        status = STATUS.LOADING
      }
      syncAll()
      return true
    },
    selectNode() { dom.classList.add('is-selected') },
    deselectNode() { dom.classList.remove('is-selected') },
    /** 降级卡里的链接、iframe 里的事件都停在这里，不进 ProseMirror。 */
    stopEvent(event) {
      const target = event && event.target
      return Boolean(target && typeof target.closest === 'function' && target.closest(`[${UI_ATTR}]`))
    },
    ignoreMutation() { return true },
    destroy() {
      destroyed = true
      generation += 1
      teardownIframe()
    },
    // 测试与宿主联调通道。
    status() { return status },
    embedSrc,
    bridgeState() { return bridge ? bridge.state() : null },
    /** 真实 iframe 元素：loading 期间它已在 `.iframe-layer` 里，只是被 CSS 藏起，测试靠这个拿句柄。 */
    iframe() { return iframe },
  }
}

export default createWebEmbedNodeView
