/**
 * 日程卡片 NodeView（P4-02b）—— 纯 DOM，core 零 UI 框架依赖。
 *
 * 与 `bookmark` 的 NodeView 同源（DOM 直接来自 `renderHTML`），差别全在「点哪、点什么」：
 *
 *   1. **卡身点击什么都不做**。飞书实测：点标题**无跳转、无浮层**（`pages 1→1`、
 *      `popups: []`），`data-name` 也是 null（02 §26 ④）。所以这里**不挂** `window.open`、
 *      不弹任何层 —— 只让 `mousedown` 走 ProseMirror 拿到「选中整块」的能力。
 *   2. **唯一可点的东西是「加入日程」按钮**，且它**常驻可见**（不是 hover 才出）。
 *      点击转成 `onJoin({ eventId, title })`；宿主没接就**什么都不发生** —— 飞书点下去
 *      也是零视觉变化（主动留白），刻意不做本地 toggle 成"已加入"，那会造出一个飞书
 *      不存在的状态。
 *   3. **hover 零视觉变化**：bg / border / shadow 逐字节相同（02 §26 ④ 验过）。所以这里
 *      既不监听 mouseenter，也不加任何 state 属性 —— 样式表里也**不许写 `:hover`**。
 *   4. **不自动 refetch**。块里存的是兜底快照，**允许过期**（02 §26 ⑨）。每次打开文档
 *      就打一遍日历接口是明确的浪费，且离线时只会闪烁；刷新交给宿主显式调
 *      `refresh()`（对应 `refetchCalendarEvent` 命令）。
 *
 * 删除不走这里：飞书里六种键盘路径全废且会误伤相邻文字，删块统一走块菜单
 * `deleteBlock(id)`（02 §26 ⑥）。
 */
import { DOMSerializer } from '@tiptap/pm/model'
import { readCalendarEvent } from '../embed/calendar-event'

/** 「加入日程」按钮。目前唯一有交互的元素。 */
const JOIN_SELECTOR = '.lark-doc-calendar-join'
/** 承载 `wrapper → card → ...` 的那一层。 */
const CONTAINER_SELECTOR = '.lark-doc-calendar-container'

/** 参与渲染的 attrs；其余字段（如宿主扩展塞进来的）变化不必重造 DOM。 */
const RENDER_KEYS = [
  'eventId', 'title', 'start', 'end', 'tz', 'organizer',
  'reminders', 'rsvp', 'attendees', 'location', 'blockId',
]

function clearChildren(element) {
  while (element.firstChild) element.removeChild(element.firstChild)
}

export function createCalendarEventNodeView(props) {
  const { node, extension } = props
  const options = (extension && extension.options) || {}

  let currentNode = node
  let serializer = null
  let destroyed = false

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

  const calendarEvent = () => readCalendarEvent(currentNode.attrs || {})

  /* ---------- 加入日程 ---------- */

  function join() {
    const data = calendarEvent()
    if (!data) return
    if (typeof options.onJoin !== 'function') return
    // 宿主回调抛错不该让点击「没反应」变成「报错」：卡片是外来内容，宿主只是执行方。
    try { options.onJoin({ eventId: data.eventId, title: data.title }) } catch (_) { /* 吞掉 */ }
  }

  function onClick(event) {
    if (destroyed) return
    const target = event && event.target
    if (!target || typeof target.closest !== 'function' || !target.closest(JOIN_SELECTOR)) return
    // 骨架/坏数据态没有 `data`，按钮点不动（`renderHTML` 那条分支根本没画按钮，双保险）。
    if (!calendarEvent()) return
    join()
  }

  /** 手动刷新快照：宿主拿到服务端最新数据后调（`refetchCalendarEvent` 已在文档层改 attrs，
   *  这里只负责「把改动落到 DOM」）。 */
  function refresh() {
    if (destroyed || !dom) return
    const container = containerOf(dom)
    const next = renderElement()
    const nextContainer = containerOf(next)
    if (!container || !nextContainer) return
    clearChildren(container)
    while (nextContainer.firstChild) container.appendChild(nextContainer.firstChild)
  }

  function containerOf(element) {
    return element && typeof element.querySelector === 'function'
      ? element.querySelector(CONTAINER_SELECTOR)
      : null
  }

  const dom = renderElement() || document.createElement('div')
  if (dom && typeof dom.addEventListener === 'function') dom.addEventListener('click', onClick)

  return {
    dom,

    update(nextNode) {
      if (destroyed) return false
      if (!nextNode || !nextNode.type || nextNode.type.name !== 'calendar_event') return false
      const previous = currentNode.attrs || {}
      const next = nextNode.attrs || {}
      // 数组字段（reminders / attendees）走引用比较：refetch 后是新数组，会多重建一次，
      // 无害；反之「内容变了但引用相同」在这条回写路径上不会发生。
      const unchanged = RENDER_KEYS.every((key) => (previous[key] || null) === (next[key] || null))
      currentNode = nextNode
      return unchanged
    },

    /**
     * 只拦「加入日程」按钮上的事件，其余一律放行给 ProseMirror。
     *
     * 为什么 `mousedown` 也要拦（bookmark 那边反而不拦）：按钮不该把光标拽进卡片，
     * 也不该在按下时清掉用户的选区 —— 点按钮是一个独立动作，不是"点到块里"。
     * 卡身其余区域的 `mousedown` 必须放行，否则整块选不中、也就删不掉。
     */
    stopEvent(event) {
      if (!event) return false
      const target = event.target
      if (!target || typeof target.closest !== 'function') return false
      if (!target.closest(JOIN_SELECTOR)) return false
      return event.type === 'click' || event.type === 'mousedown'
    },

    ignoreMutation() { return true },

    destroy() {
      destroyed = true
      if (dom && typeof dom.removeEventListener === 'function') dom.removeEventListener('click', onClick)
    },

    /* ---------- 测试与宿主联调通道 ---------- */
    calendarEvent,
    refresh,
  }
}

export default createCalendarEventNodeView
