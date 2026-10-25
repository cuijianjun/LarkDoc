/**
 * 日程卡片块 `calendar_event`（P4-02b）—— requirements/02 §26、04 §4.7、17 §。
 *
 * 与 `bookmark`（P3-05）的关系：**同一套三段式，不同的数据源**。
 *   - 契约 + markup 全在 `core/embed/calendar-event.js`（唯一出处）；
 *   - 这里只做 schema（attrs / parseHTML / 命令）；
 *   - 交互（「加入日程」按钮、外部点击、hover）在
 *     `core/nodeviews/calendar-event.js`。
 *
 * 四条硬口径（02 §26 ⑨ V1 结论）：
 *
 *   1. **存 `eventId`，不存完整日程**。块是一张**引用卡**，展示字段只是兜底快照，
 *      **允许过期**，以 `refetchCalendarEvent()` 回写为准。所以 attrs 里没有
 *      「编辑日程」这条路 —— 更新永远由日历服务主导（17 § 契约：Create = 搜索已有日程
 *      插入，Update 由日历服务，Delete 只删块）。
 *   2. **`atom: true` + 无 `contentDOM`**：卡片不可编辑、整块选中、一次删掉（同
 *      bookmark / cardEmbed / webEmbed）。
 *   3. **删除只走块菜单**。飞书里 Backspace / Delete / Shift+↓ / 拖选 / Esc+Delete /
 *      Meta+Z 六种键盘路径**全废**且会误伤相邻文字（02 §26 ⑥ 逐条验过），所以这里
 *      不做任何"退格合并时顺带删卡"的逻辑 —— 删块统一走 `deleteBlock(id)`。
 *   4. **`renderHTML` 同时是导出产物**，NodeView 直接复用（`DOMSerializer.serializeNode`），
 *      保证「编辑器里看到什么 = 导出的是什么」。
 *
 * 与 `bookmark` 的一个刻意差异：**卡内有真 `button`**（「加入日程」常驻）。bookmark 那边
 * 「卡内无 a/button」是为了导出不出现假链接；日程的按钮在飞书里本来就常驻可见，藏掉
 * 反而不是同一张卡。
 */
import { Node, mergeAttributes } from '@tiptap/core'
import { BLOCK_ID_PATTERN } from '../documentOperations'
import { validateAttribute } from './shared'
import { getNodeView } from '../nodeviews/registry'
import { createCalendarEventNodeView } from '../nodeviews/calendar-event'
import {
  CALENDAR_EVENT_ID_PATTERN, CALENDAR_EVENT_LIMITS, CALENDAR_EVENT_RSVP,
  normalizeCalendarEvent, readCalendarEvent, readCalendarTime, renderCalendarEventCard,
} from '../embed/calendar-event'

/**
 * 判定层与块定义同源：契约常量、读路径、markup 全在 `core/embed/calendar-event.js`，
 * 这里原样再导一次，上层只认 `registry/blocks.js` 一个入口（P0-04 硬规则 1）。
 */
export {
  CALENDAR_EVENT_ID_PATTERN, CALENDAR_EVENT_JOIN_LABEL, CALENDAR_EVENT_LIMITS,
  CALENDAR_EVENT_ORGANIZER_LABEL, CALENDAR_EVENT_RSVP, CALENDAR_EVENT_RSVP_LABELS,
  CALENDAR_EVENT_SIZES, CALENDAR_EVENT_VERSION, calendarEventDateLine,
  calendarEventFromSearch, calendarEventReminderLine, calendarEventSearchMatch,
  calendarTimezoneLabel, normalizeCalendarEvent, readCalendarEvent, readCalendarTime,
  renderCalendarEventCard,
} from '../embed/calendar-event'

const safeText = (limit) => (value) => value === null || value === undefined
  || (typeof value === 'string' && Array.from(value).length <= limit && !value.includes('\u0000'))

const safeEventId = (value) => value === null || value === undefined || value === ''
  || (typeof value === 'string' && CALENDAR_EVENT_ID_PATTERN.test(value))

/** 时间属性：`null` / 空串放行（schema 默认值），其余必须能解析出字面分量。 */
const safeTime = (value) => value === null || value === undefined || value === ''
  || (typeof value === 'string' && readCalendarTime(value) !== null)

const safeRsvp = (value) => value === null || value === undefined
  || CALENDAR_EVENT_RSVP[value] !== undefined

const safeMinutes = (value) => value === null || value === undefined
  || (Array.isArray(value) && value.every((item) => Number.isFinite(Number(item)) && Number(item) >= 0))

const safeNames = (value) => value === null || value === undefined
  || (Array.isArray(value) && value.every((item) => typeof item === 'string'))

const readAttr = (name) => (el) => {
  const value = el.getAttribute(name)
  return value === null || value === '' ? null : value
}

/**
 * JSON 属性读取（`reminders` / `attendees` 是数组，HTML 属性只能放字符串）。
 *
 * 读路径**永不抛**：脏 JSON 一律退化成空数组 —— 卡片少一行提醒，比打开文档白屏好。
 */
const readJsonAttr = (name, fallback) => (el) => {
  const raw = el.getAttribute(name)
  if (raw === null || raw === '') return fallback
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : fallback
  } catch (_) {
    return fallback
  }
}

const CalendarEvent = Node.create({
  name: 'calendar_event',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addOptions() {
    return {
      /**
       * 「加入日程」按钮的通道：`onJoin({ eventId, title })`。
       *
       * 飞书里点这个按钮**没有可见变化**（不弹层、不变灰、不改文案，02 §26 ④ 主动留白），
       * 所以 V1 也**不给任何默认视觉反馈** —— 宿主接了 `onJoin` 就去真的写日历，
       * 没接就是个不响的按钮。刻意不做"本地 toggle 成已加入"：那会造出一个飞书没有的状态。
       */
      onJoin: null,
      /**
       * 快照刷新通道：`refetch(eventId) => Promise<event|null>`。宿主不接就永远用块里的
       * 兜底快照（**允许过期**，这是设计如此，不是缺陷）。
       */
      refetch: null,
    }
  },

  addAttributes() {
    return {
      // 引用主键：一切刷新的锚点。缺了它就是一张永远过期的死卡（写路径已拦）。
      eventId: {
        default: null,
        validate: validateAttribute('calendar_event.eventId', safeEventId),
        parseHTML: readAttr('data-event-id'),
        rendered: false,
      },
      title: {
        default: null,
        validate: validateAttribute('calendar_event.title', safeText(CALENDAR_EVENT_LIMITS.title)),
        parseHTML: readAttr('data-title'),
        rendered: false,
      },
      // 起止时间存**原始 ISO 串**（带时区），不存时间戳：导出成 HTML 后肉眼可读，
      // 导回来也不用担心精度/时区来回转。排版时分量由 `readCalendarTime` 现取。
      start: {
        default: null,
        validate: validateAttribute('calendar_event.start', safeTime),
        parseHTML: readAttr('data-start'),
        rendered: false,
      },
      end: {
        default: null,
        validate: validateAttribute('calendar_event.end', safeTime),
        parseHTML: readAttr('data-end'),
        rendered: false,
      },
      // 时区标识（IANA 名或偏移串）。**只透传，不参与显示** —— 卡片上的 `(GMT+8)`
      // 一律从 `start` 的偏移派生，避免「tz 与串内偏移打架时无人可裁」。
      tz: {
        default: null,
        validate: validateAttribute('calendar_event.tz', safeText(64)),
        parseHTML: readAttr('data-tz'),
        rendered: false,
      },
      organizer: {
        default: null,
        validate: validateAttribute('calendar_event.organizer', safeText(CALENDAR_EVENT_LIMITS.organizer)),
        parseHTML: readAttr('data-organizer'),
        rendered: false,
      },
      // 提醒偏移（分钟数数组，0 = 日程开始时）。数组存 JSON 属性，读路径永不抛。
      reminders: {
        default: null,
        validate: validateAttribute('calendar_event.reminders', safeMinutes),
        parseHTML: readJsonAttr('data-reminders', []),
        rendered: false,
      },
      rsvp: {
        default: 'none',
        validate: validateAttribute('calendar_event.rsvp', safeRsvp),
        parseHTML: (el) => {
          const value = el.getAttribute('data-rsvp')
          return CALENDAR_EVENT_RSVP[value] ? value : CALENDAR_EVENT_RSVP.none
        },
        rendered: false,
      },
      // 参与人只存名字数组：卡片上**不渲染**（实测 3 行 info 里只有组织者行），
      // 留着是为了宿主做「参与人」侧栏/导出时不至于没有数据。
      attendees: {
        default: null,
        validate: validateAttribute('calendar_event.attendees', safeNames),
        parseHTML: readJsonAttr('data-attendees', []),
        rendered: false,
      },
      location: {
        default: null,
        validate: validateAttribute('calendar_event.location', safeText(CALENDAR_EVENT_LIMITS.location)),
        parseHTML: readAttr('data-location'),
        rendered: false,
      },
    }
  },

  // 只认自带标记；没有合法 `data-event-id` 的 DOM 一律拒收，让文档层退化成 unknown-block
  // 保留原文 —— 比渲染一张空卡诚实（同 bookmark 的 `data-url` 口径）。
  parseHTML() {
    const accept = (el) => {
      const eventId = (el.getAttribute('data-event-id') || '').trim()
      return CALENDAR_EVENT_ID_PATTERN.test(eventId) ? null : false
    }
    return [
      { tag: 'div[data-type="calendar_event"]', getAttrs: accept },
      // 飞书原生块（`.docx-calendar_event-block` + `data-block-type="calendar_event"`）
      // 粘贴进来时的入口。
      { tag: 'div.docx-calendar_event-block[data-block-type="calendar_event"]', getAttrs: accept },
    ]
  },

  addCommands() {
    return {
      /**
       * 插入一张日程卡片。入参可直接吃 04 §4.7 ⑥ 的搜索返回项
       * （`calendarEventFromSearch()` 负责转形状），也可吃已摊平的 attrs。
       */
      setCalendarEvent: (input) => ({ state, commands }) => {
        const event = normalizeCalendarEvent(input)
        if (!event) return false
        // `insertContent` 遇到非法属性只打 warning 然后照常返回 true，
        // 所以先 create 一遍探路（bookmark / webEmbed / cardEmbed 同口径）。
        try { state.schema.nodes[this.name].create(event) } catch (_) { return false }
        return commands.insertContent({ type: this.name, attrs: event })
      },

      /**
       * 用服务端最新数据回写快照。按 `eventId` 定位而不是位置：同一条日程可以在文档里
       * 被引用多次，全部一起刷新；位置会漂移，id 不会。
       *
       * 只采用**非空**字段：接口回包缺字段时保留旧快照，而不是把卡片抹成空白。
       */
      refetchCalendarEvent: (input) => ({ state, tr }) => {
        const source = input && typeof input === 'object' ? input : {}
        const eventId = typeof source.eventId === 'string' ? source.eventId.trim() : ''
        if (!CALENDAR_EVENT_ID_PATTERN.test(eventId)) return false
        const patched = []
        state.doc.descendants((node, pos) => {
          if (node.type.name !== this.name) return true
          if ((node.attrs || {}).eventId !== eventId) return true
          patched.push({ node, pos })
          return false
        })
        if (!patched.length) return false
        let changed = false
        patched.forEach(({ node, pos }) => {
          const attrs = node.attrs || {}
          const next = {}
          if (typeof source.title === 'string' && source.title && source.title !== attrs.title) next.title = source.title
          if (safeTime(source.start) && source.start && source.start !== attrs.start) next.start = source.start
          if (safeTime(source.end) && source.end && source.end !== attrs.end) next.end = source.end
          if (typeof source.organizer === 'string' && source.organizer && source.organizer !== attrs.organizer) next.organizer = source.organizer
          if (safeMinutes(source.reminders)) next.reminders = source.reminders
          if (safeRsvp(source.rsvp) && source.rsvp !== attrs.rsvp) next.rsvp = source.rsvp
          if (typeof source.location === 'string' && source.location !== attrs.location) next.location = source.location
          if (!Object.keys(next).length) return
          tr.setNodeMarkup(pos, undefined, { ...attrs, ...next })
          changed = true
        })
        return changed
      },
    }
  },

  renderHTML({ node }) {
    const attrs = node.attrs || {}
    const event = readCalendarEvent(attrs)
    const root = {
      class: 'lark-doc-calendar-event docx-calendar_event-block',
      'data-type': 'calendar_event',
      'data-block-type': 'calendar_event',
      contenteditable: 'false',
    }
    // 自绘 renderHTML 不会自动合入全局属性，稳定块 id 要显式带上（同 bookmark）。
    if (typeof attrs.blockId === 'string' && BLOCK_ID_PATTERN.test(attrs.blockId)) root['data-block-id'] = attrs.blockId

    // 数据坏了（没 id / 没标题 / 开始时间不可解析）→ 不画空卡：画一行「日程数据缺失」，
    // 样式复用 unknown-block 的中性 chrome，原文写什么就显示什么，便于人工修。
    if (!event) {
      const raw = typeof attrs.eventId === 'string' ? attrs.eventId : ''
      return ['div', mergeAttributes(root),
        ['div', { class: 'lark-doc-unknown-card' },
          ['span', { class: 'lark-doc-unknown-card-icon', 'aria-hidden': 'true' }],
          ['span', { class: 'lark-doc-unknown-card-text' },
            ['span', { class: 'lark-doc-unknown-card-title' }, '日程数据缺失'],
            ['span', { class: 'lark-doc-unknown-card-sub' }, raw || '没有可用的日程 ID']]],
      ]
    }

    // 快照也写进属性：导出成 HTML 后再被导回时，不依赖日历服务重新拉一遍。
    root['data-event-id'] = event.eventId
    if (attrs.title) root['data-title'] = String(attrs.title)
    if (attrs.start) root['data-start'] = String(attrs.start)
    if (attrs.end) root['data-end'] = String(attrs.end)
    if (attrs.tz) root['data-tz'] = String(attrs.tz)
    if (attrs.organizer) root['data-organizer'] = String(attrs.organizer)
    if (attrs.location) root['data-location'] = String(attrs.location)
    root['data-rsvp'] = attrs.rsvp || CALENDAR_EVENT_RSVP.none
    if (Array.isArray(attrs.reminders) && attrs.reminders.length) root['data-reminders'] = JSON.stringify(attrs.reminders)
    if (Array.isArray(attrs.attendees) && attrs.attendees.length) root['data-attendees'] = JSON.stringify(attrs.attendees)

    return ['div', mergeAttributes(root),
      ['div', { class: 'lark-doc-calendar-container' }, renderCalendarEventCard(event)],
    ]
  },

  // NodeView 先查注册表（三端可覆盖），没有再落 core 的纯 DOM 实现。
  addNodeView() { return getNodeView('calendar_event') || createCalendarEventNodeView },
})

export { CalendarEvent }
