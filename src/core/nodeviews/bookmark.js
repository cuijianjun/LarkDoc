/**
 * 网页卡片 NodeView（P3-05）—— 纯 DOM，core 零 UI 框架依赖。
 *
 * 三条设计要点（与 `card-embed` 同源，差别只在「点哪、点什么」）：
 *
 *   1. **DOM 直接来自 `renderHTML`**（`DOMSerializer.serializeNode`）：拿到的元素就是导出
 *      产物那一份，不做第二套 markup —— 网页卡片恰恰是「导出必须带标题」的块。
 *   2. **整卡就是链接**：卡内没有 `a` / `button`（02 §24 ③ 实测 `anchors: 0 / buttons: 0`），
 *      点击 / Enter / Space 一律转成 `onOpen({ url, recordId })`；宿主没接就自己
 *      `window.open(url, '_blank', 'noopener')`。没有「换 URL」入口 —— 与飞书一致
 *      （单击、双击都不弹，只能删了重建）。
 *   3. **骨架态只在编辑器里存在**：`title` 为空且注入了 `unfurl` 时先画 122 高的骨架，
 *      抓回来（或失败）就换回 ready 档。骨架与 ready 都出自
 *      `renderBookmarkCard()`，所以两者不会漂移；导出侧永远看不到 shimmer。
 *
 * 🔴 抓取失败**不是错误态**：飞书实测就是一张「URL + 域名标题」的简卡，
 * 无文案、无重试、无 toast（02 §24 ③-ter）。所以这里失败只做一件事 —— 收起骨架。
 */
import { DOMSerializer } from '@tiptap/pm/model'
import { BOOKMARK_VARIANT, readBookmark, renderBookmarkCard } from '../embed/bookmark'

/** 卡身（可点的区域）；root 的 16px 外边距是「不跳转的死区」，留给选中与拖拽。 */
const CARD_SELECTOR = '.lark-doc-bookmark-card'
/** 承载 `wrapper → content → card` 的那一层，骨架态就地替换它的 children。 */
const CONTAINER_SELECTOR = '.lark-doc-bookmark-container'

/** 参与渲染的 attrs；其余（如 `blockId` 之外的扩展字段）变化不必重造 DOM。 */
const RENDER_KEYS = ['url', 'title', 'desc', 'favicon', 'recordId', 'blockId']

function clearChildren(element) {
  while (element.firstChild) element.removeChild(element.firstChild)
}

export function createBookmarkNodeView(props) {
  const { node, extension } = props
  const options = (extension && extension.options) || {}
  const host = props.editor || (extension && extension.editor) || null

  let currentNode = node
  let serializer = null
  let destroyed = false
  let pending = false
  /** 抓取令牌：`update()` 触发重建 / 手动 reload 时作废旧任务，避免旧结果盖新数据。 */
  let fetchToken = 0

  /** 序列化器只建一次：schema 在同一个 editor 生命周期里不变。 */
  function getSerializer() {
    if (!serializer) serializer = DOMSerializer.fromSchema(currentNode.type.schema)
    return serializer
  }

  /** 用节点自己的 `toDOM`（即 `renderHTML`）造元素 —— 与导出走的是同一条路。 */
  function renderElement() {
    const rendered = getSerializer().serializeNode(currentNode)
    return rendered && rendered.nodeType === 1 ? rendered : null
  }

  const bookmark = () => readBookmark(currentNode.attrs || {})

  function containerOf(element) {
    return element && typeof element.querySelector === 'function'
      ? element.querySelector(CONTAINER_SELECTOR)
      : null
  }

  /* ---------- 打开链接 ---------- */

  function openLink() {
    const data = bookmark()
    if (!data) return
    const attrs = currentNode.attrs || {}
    const payload = {
      url: data.url,
      recordId: typeof attrs.recordId === 'string' ? attrs.recordId : null,
    }
    if (typeof options.onOpen === 'function') {
      try {
        options.onOpen(payload)
        return
      } catch (_) {
        // 宿主回调抛错不该让点击「没反应」：退回默认打开（卡片是外来内容，宿主只是第一执行方）。
      }
    }
    if (typeof window !== 'undefined' && typeof window.open === 'function') {
      try { window.open(data.url, '_blank', 'noopener') } catch (_) { /* 被拦截就当无事发生 */ }
    }
  }

  function onClick(event) {
    if (destroyed) return
    const target = event && event.target
    // 骨架态点不动：数据还没回来，跳过去也没有标题可回填。
    if (pending || !bookmark()) return
    if (!target || typeof target.closest !== 'function' || !target.closest(CARD_SELECTOR)) return
    // 划词选中时不跳（用户多半只是想复制 URL 文本）。
    const selection = typeof window !== 'undefined' && typeof window.getSelection === 'function'
      ? window.getSelection()
      : null
    if (selection && selection.isCollapsed === false) return
    openLink()
  }

  function onKeyDown(event) {
    const key = event && event.key
    // 'Spacebar' 是老浏览器 / IE 口径，一并认掉。
    if (key !== 'Enter' && key !== ' ' && key !== 'Spacebar') return
    if (pending || !bookmark()) return
    if (typeof event.preventDefault === 'function') event.preventDefault()
    openLink()
  }

  /* ---------- 骨架 ⇄ ready ---------- */

  function skeletonElement() {
    const rendered = DOMSerializer.renderSpec(document, renderBookmarkCard(null, BOOKMARK_VARIANT.loading))
    return rendered && rendered.dom ? rendered.dom : null
  }

  function showSkeleton() {
    const container = containerOf(dom)
    const skeleton = skeletonElement()
    if (!container || !skeleton) return
    clearChildren(container)
    container.appendChild(skeleton)
    pending = true
    if (typeof dom.setAttribute === 'function') dom.setAttribute('data-bookmark-state', 'loading')
  }

  function showReady() {
    pending = false
    if (!dom) return
    const container = containerOf(dom)
    const next = renderElement()
    const nextContainer = containerOf(next)
    if (!container || !nextContainer) return
    clearChildren(container)
    while (nextContainer.firstChild) container.appendChild(nextContainer.firstChild)
    if (typeof dom.setAttribute === 'function') dom.setAttribute('data-bookmark-state', 'ready')
  }

  /* ---------- 抓取 ---------- */

  function unfurlTask() {
    const provider = options.unfurl
    if (!provider || typeof provider.unfurl !== 'function') return null
    const attrs = currentNode.attrs || {}
    // 已经有标题就不再抓：文档是真相，抓取只是补空白（也避免每次打开都打接口）。
    if (typeof attrs.title === 'string' && attrs.title.trim()) return null
    const data = bookmark()
    if (!data) return null
    return { url: data.url }
  }

  /** 把抓回来的元数据写回节点 attrs（按位置写，写完由 `update()` 触发重建）。 */
  function applyMeta(result) {
    if (!host || !host.state || !host.view) return false
    const attrs = currentNode.attrs || {}
    const next = {}
    if (result.title && result.title !== attrs.title) next.title = result.title
    if (result.desc && result.desc !== attrs.desc) next.desc = result.desc
    if (result.favicon && result.favicon !== attrs.favicon) next.favicon = result.favicon
    if (!Object.keys(next).length) return false

    let position = null
    try {
      position = typeof props.getPos === 'function' ? props.getPos() : null
    } catch (_) {
      position = null // 节点已被移走 / 删除：`getPos()` 会抛，抓取结果直接丢弃。
    }
    if (!Number.isInteger(position)) return false
    try {
      const live = host.state.doc.nodeAt(position)
      if (!live || live.type.name !== 'bookmark') return false
      const liveAttrs = live.attrs || {}
      if (liveAttrs.recordId && attrs.recordId && liveAttrs.recordId !== attrs.recordId) return false
      host.view.dispatch(host.state.tr.setNodeMarkup(position, undefined, { ...liveAttrs, ...next }))
      return true
    } catch (_) {
      return false
    }
  }

  function startFetch() {
    const task = unfurlTask()
    if (!task) return
    const token = ++fetchToken
    showSkeleton()
    let result
    try {
      result = options.unfurl.unfurl(task.url)
    } catch (_) {
      showReady()
      return
    }
    if (!result || typeof result.then !== 'function') {
      showReady()
      return
    }
    const settle = (value) => {
      if (destroyed || token !== fetchToken) return
      // `ok: false` 也是一张正常简卡（02 §24 ③-ter），所以不分支错误 UI，只收骨架。
      if (!value || value.ok === false || !applyMeta(value)) showReady()
    }
    result.then(settle, () => { if (!destroyed && token === fetchToken) showReady() })
  }

  const dom = renderElement() || document.createElement('div')
  if (dom && typeof dom.addEventListener === 'function') {
    dom.addEventListener('click', onClick)
    dom.addEventListener('keydown', onKeyDown)
  }
  if (dom && typeof dom.setAttribute === 'function') dom.setAttribute('data-bookmark-state', 'ready')
  startFetch()

  return {
    dom,

    update(nextNode) {
      if (destroyed) return false
      if (!nextNode || !nextNode.type || nextNode.type.name !== 'bookmark') return false
      const previous = currentNode.attrs || {}
      const next = nextNode.attrs || {}
      const unchanged = RENDER_KEYS.every((key) => (previous[key] || null) === (next[key] || null))
      currentNode = nextNode
      // 骨架态期间属性没动就保持骨架（抓取任务还在跑，重建会白闪一次）。
      return unchanged
    },

    /**
     * 只拦卡身上的 click / keydown，mousedown 不拦。
     *
     * `mousedown` 交给 ProseMirror 才能选中整块（否则「点一下卡片就跳走，选不中、删不掉」）；
     * 而 click 我们已经在 `dom` 上自己处理了，让 PM 再跑一遍没有意义。
     */
    stopEvent(event) {
      if (!event) return false
      const target = event.target
      if (!target || typeof target.closest !== 'function' || !target.closest(CONTAINER_SELECTOR)) return false
      return event.type === 'click' || event.type === 'keydown'
    },

    ignoreMutation() { return true },

    destroy() {
      destroyed = true
      fetchToken += 1
      if (dom && typeof dom.removeEventListener === 'function') {
        dom.removeEventListener('click', onClick)
        dom.removeEventListener('keydown', onKeyDown)
      }
    },

    /* ---------- 测试与宿主联调通道 ---------- */
    bookmark,
    pending: () => pending,
    /** 手动重抓（宿主「刷新卡片」入口用；飞书没有这个入口，属可选增强）。 */
    reload() {
      if (destroyed) return
      startFetch()
    },
  }
}

export default createBookmarkNodeView
