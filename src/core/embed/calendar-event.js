/**
 * 日程卡片契约与共享 markup（`calendar_event`）—— requirements/02 §26、04 §4.7。
 *
 * 与 `bookmark`（`core/embed/bookmark.js`）同构：本文件是**契约层 + markup 层**的唯一
 * 出处，块定义（`core/blocks/calendar-event.js`）与 NodeView
 * （`core/nodeviews/calendar-event.js`）都从这里取，不各写一份。
 *
 * 四条硬口径（02 §26 ⑨ V1 结论，别按直觉改）：
 *
 *   1. **本质是引用，不是新建**。斜杠「日程」弹的是**搜索面板**，只能从「我参与的
 *      未来日程」里挑一条插进来，面板内**没有「新建日程」入口**。块只存 `eventId` +
 *      一份展示快照，**快照允许过期**，以服务端 `refetch()` 为准 —— 所以这里所有
 *      展示字段都是「兜底快照」，不是真相。
 *   2. **点结果行即插，没有二次确认**（04 §4.7 ⑤）：面板关闭 → 卡片落地 → 光标移到
 *      卡片之后。
 *   3. **搜索只匹配标题**：`title.toLowerCase().includes(q.toLowerCase())`；空输入直接
 *      列全部；年份 / 月日 / 参与人 / 组织者 / 标题前两个汉字**全部 0 命中**（02 §26 ⑤
 *      逐项验过）。别"顺手"补上时间或参与人匹配 —— 那会让空态文案「没有匹配的搜索
 *      结果」永远出不来。
 *   4. **面板不绑 `Esc`**。真飞书 `Esc` ×1 / ×2 全无效，只认「点面板外部」；这里同理
 *      只走外层点击 + `onBlur`，绑 `Esc` 会和编辑器自己的 Esc 抢。
 *
 * 卡片侧两条负结论：**hover 零视觉变化**（bg / border / shadow 逐字节相同，02 §26 ④
 * 验过，别加 hover 加深），**点标题无跳转无浮层**（不挂 `window.open`）。删除只走块菜单
 * `data-name="delete"`：键盘六种路径（Backspace / Delete / Shift+↓ / 拖选 / Esc+Delete /
 * Meta+Z）在飞书里全废，且会误伤相邻文字。
 *
 * ⚠️ 所有 spec 的 children **必须展平**（`['div', attrs, childA, childB]`）。把子 spec
 * 收成一个数组当第三位会被 `renderSpec` 当成单个坏 spec，然后因结构首项不是字符串抛
 * `RangeError: Invalid array passed to renderSpec` —— 该错误只在序列化（`getHTML()` /
 * PDF / DOCX）时触发，编辑器里完全看不出来。理由同 `bookmark.js` 顶部注释。
 */

/** 契约版本（形状变了才动这个数，同 `BOOKMARK_VERSION` 口径）。 */
export const CALENDAR_EVENT_VERSION = 1

export const CALENDAR_EVENT_LIMITS = Object.freeze({
  title: 200,
  organizer: 100,
  location: 200,
  attendees: 50,
})

/**
 * 实测尺寸（只留验过的数，**不补推算值**）：
 *   - 面板 540×360、结果行 538×42 —— 04 §4.7 ①②（360 是固定高，空态不收缩）；
 *   - 卡片宽 400 —— 02 §26 ④（块宽 468，`justify-left` 右侧留 68）；
 *   - 内容区固定槽 374×94 —— 02 §26 ④（`maxScrollH = 94`）。
 * CSS 若改这些数，这里同步改；测试用它们做几何断言。
 */
export const CALENDAR_EVENT_SIZES = Object.freeze({
  panelW: 540,
  panelH: 360,
  rowH: 42,
  cardW: 400,
  contentH: 94,
})

/**
 * `eventId` 的合法形状：一段**非空白可见 ASCII**。
 *
 * 刻意不照抄 `RECORD_ID_PATTERN` 的 `[A-Za-z0-9_-]`：日程 id 来自外部日历服务
 * （飞书 / Google 的形态都未采集），收窄字符集只会在真机上"插不进去"。这里只做
 * 最低限度的防呆 —— 拒绝空白、控制字符、超长串。
 */
export const CALENDAR_EVENT_ID_PATTERN = /^[\x21-\x7e]{1,160}$/

/**
 * 时间字段：ISO 8601 **必须带时区**（`Z` 或 `±HH:mm`）。
 *
 * 与 `REMINDER_AT_PATTERN` 同口径、同理由：裸 `2026-10-27T11:30` 会被各端按本地时区
 * 各解释一遍。但这里**不能复用**那条正则 —— 日程要靠捕获组取出「字面分量」来排版
 * （见 `readCalendarTime`），裸 test 拿不到分组。
 */
const CALENDAR_EVENT_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/

/** `rsvp` 枚举。**只有 `none` 有实测文案**（卡片上的「不参与」tag），其余不渲染。 */
export const CALENDAR_EVENT_RSVP = Object.freeze({
  none: 'none',
  accepted: 'accepted',
  declined: 'declined',
  tentative: 'tentative',
})

/**
 * `rsvp` → tag 文案。只放**实测过**的「不参与」（02 §26 ④ `no-attendee-tag`）。
 *
 * `accepted` / `declined` / `tentative` 的真飞书文案**没采到**，所以故意缺席：缺席即
 * 不渲染 tag（`buildOrganizerTags` 只查已有键）。宁可少一个 tag，也不自造文案。
 */
export const CALENDAR_EVENT_RSVP_LABELS = Object.freeze({
  none: '不参与',
})

/** 组织者 tag 文案（02 §26 ④ `organizer-tag`「组织者」，fs10 / `rgb(20,86,240)`）。 */
export const CALENDAR_EVENT_ORGANIZER_LABEL = '组织者'

/** 「加入日程」按钮文案。常驻显示，**不是 hover 才出**（02 §26 ④ 专门验过）。 */
export const CALENDAR_EVENT_JOIN_LABEL = '加入日程'

/** `getDay()` 序号 → 「周X」；飞书用「周日」不用「星期天」（与 reminder 同表）。 */
const WEEKDAY_LABELS = Object.freeze(['周日', '周一', '周二', '周三', '周四', '周五', '周六'])

function pad2(value) {
  return value < 10 ? `0${value}` : String(value)
}

/** 文本字段统一裁切：折行空白压成单空格，按**码点**截断（emoji 不劈半）。 */
function readCalendarText(value, limit) {
  if (typeof value !== 'string') return ''
  const text = value.replace(/\s+/g, ' ').trim()
  if (!text) return ''
  const chars = Array.from(text)
  return chars.length > limit ? chars.slice(0, limit).join('').trim() : text
}

/* ---------------------------------------------------------------- 时间解析 */

/**
 * 把 ISO 串拆成**字面分量**（不经过 `new Date()` 的本地化）。
 *
 * 为什么要字面分量：卡片上写的是 `10月27日 (周二) 11:30 - 12:00 (GMT+8)` —— 末尾带时区
 * 标注，说明显示的是**日程所在时区的墙上时间**。一旦走 `new Date()` 再 `getHours()`，
 * 换个时区的浏览器打开同一份文档就会显示成 `03:30`，而 `(GMT+8)` 还在，自相矛盾。
 *
 * 返回 `{ year, month, day, hour, minute, offset, weekday }`；`weekday` 用 `Date.UTC`
 * 算，不受宿主机时区影响。不可解析一律 `null`（不抛）。
 */
export function readCalendarTime(value) {
  if (typeof value !== 'string') return null
  const match = CALENDAR_EVENT_TIME_RE.exec(value.trim())
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null
  return {
    year,
    month,
    day,
    hour,
    minute,
    offset: match[7],
    // 纯 UTC 运算：`2026-10-27` 这天在它自己的日历上是周几，与该串落在哪个时区无关。
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  }
}

/**
 * 时区标注：`+08:00` → `GMT+8`、`-05:00` → `GMT-5`、`+05:30` → `GMT+5:30`、`Z` → `GMT`。
 *
 * 只有 `GMT+8` 是实测形态（02 §26 ④ 原文 `(GMT+8)`）；其余是同一套规则的纯换算。
 * 小时不补前导零（`GMT+8` 不是 `GMT+08`），分钟非零才补 `:mm`。
 */
export function calendarTimezoneLabel(offset) {
  const raw = typeof offset === 'string' ? offset : 'Z'
  if (raw === 'Z') return 'GMT'
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(raw)
  if (!match) return 'GMT'
  const hours = Number(match[2])
  const minutes = Number(match[3])
  return minutes === 0 ? `GMT${match[1]}${hours}` : `GMT${match[1]}${hours}:${pad2(minutes)}`
}

/**
 * 卡片第一行文案：`10月27日 (周二) 11:30 - 12:00 (GMT+8)`（02 §26 ④ 逐字形态）。
 *
 * 降级（都未实测，取信息不丢的最小改法，注释留痕）：
 *   - **无结束时间** → `10月27日 (周二) 11:30 (GMT+8)`；
 *   - **跨天** → 两端各带日期：`10月27日 (周二) 11:30 - 10月28日 (周三) 01:00 (GMT+8)`。
 * 开始时间不可解析（脏数据）→ 空串，调用方据此不渲染这一行。
 */
export function calendarEventDateLine(start, end) {
  const from = readCalendarTime(start)
  if (!from) return ''
  const to = readCalendarTime(end)
  const clock = (value) => `${pad2(value.hour)}:${pad2(value.minute)}`
  const head = `${from.month}月${from.day}日 (${WEEKDAY_LABELS[from.weekday]}) ${clock(from)}`
  if (!to) return `${head} (${calendarTimezoneLabel(from.offset)})`
  const sameDay = from.year === to.year && from.month === to.month && from.day === to.day
  const tail = sameDay
    ? clock(to)
    : `${to.month}月${to.day}日 (${WEEKDAY_LABELS[to.weekday]}) ${clock(to)}`
  // 时区以**开始时间**的偏移为准：单次日程两端同区（跨区日程在飞书里也是同一时刻、
  // 同一偏移存储），取尾部的偏移反而要处理"两端不一致该信谁"的无解题。
  return `${head} - ${tail} (${calendarTimezoneLabel(from.offset)})`
}

/**
 * 卡片第三行文案：`提前 5 分钟`（02 §26 ④ 实测）。
 *
 * `reminders` 是**分钟数数组**（0 = 日程开始时）。多值时只取**最早的一条**：实测只见过
 * 单值，多值排成一行会超出 374 宽的内容槽。空数组 → 空串（这一行整行不渲染，卡片由
 * 3 行降为 2 行而不是留白）。
 *
 * ⚠️ 只有「提前 N 分钟」是实测文案；`提前 N 小时` / `提前 N 天` / `日程开始时` 是同一
 * 套数值换算（非新造口径），但形态未采集。
 */
export function calendarEventReminderLine(reminders) {
  if (!Array.isArray(reminders) || !reminders.length) return ''
  const minutes = reminders
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item >= 0)
    .sort((a, b) => a - b)
  if (!minutes.length) return ''
  const first = Math.round(minutes[0])
  if (first === 0) return '日程开始时'
  if (first % 1440 === 0) return `提前 ${first / 1440} 天`
  if (first % 60 === 0) return `提前 ${first / 60} 小时`
  return `提前 ${first} 分钟`
}

/* ---------------------------------------------------------------- 搜索匹配 */

/**
 * 结果过滤：**只匹配标题**（02 §26 ⑤ 的九项逐条验过）。
 *
 * 空查询直接返回 `true`（空输入列全部 —— 飞书就是这么做的，不是"空态"）。大小写不敏感，
 * 用 `toLowerCase()` 而不是 `localeCompare`：飞书的行为就是朴素包含，`toLowerCase` 才能
 * 复现「标题里的英文小写能搜到、大写也能搜到」这个唯一确定的行为。
 *
 * 面板（`CalendarSearchPanel.vue`）必须调这个函数而不是自己写 `includes` —— 匹配口径
 * 要真只有一个出处，否则「只匹配标题」这条会在两处慢慢漂移。
 */
export function calendarEventSearchMatch(event, query) {
  const text = typeof query === 'string' ? query.trim().toLowerCase() : ''
  if (!text) return true
  const title = event && typeof event.title === 'string' ? event.title : ''
  return title.toLowerCase().includes(text)
}

/* ---------------------------------------------------------------- 读写路径 */

/** 组织者行的 tag 串：有组织者就给「组织者」，`rsvp==='none'` 再给「不参与」。 */
function buildOrganizerTags(source) {
  const tags = [CALENDAR_EVENT_ORGANIZER_LABEL]
  const label = CALENDAR_EVENT_RSVP_LABELS[source.rsvp]
  if (label) tags.push(label)
  return tags
}

function readOrganizer(value) {
  if (typeof value === 'string') return readCalendarText(value, CALENDAR_EVENT_LIMITS.organizer)
  if (value && typeof value === 'object') {
    return readCalendarText(value.name || value.displayName, CALENDAR_EVENT_LIMITS.organizer)
  }
  return ''
}

function readAttendees(value) {
  if (!Array.isArray(value)) return []
  return value
    .slice(0, CALENDAR_EVENT_LIMITS.attendees)
    .map((item) => readOrganizer(item))
    .filter((name) => Boolean(name))
}

/**
 * 写路径（**严格**）：`eventId` / 标题 / 开始时间任一不合格就返回 `null`，由
 * `setCalendarEvent` 转成「命令返回 false」。
 *
 * 为什么这三个是硬闸门：没有 id 就没法 `refetch()`，块会变成一张永远过期的死卡片；
 * 没有标题卡片第一行是空的；没有开始时间第一行整行渲染不出来。其余字段（结束时间、
 * 提醒、组织者、参与人）缺了只是少一行 / 少个 tag，不连坐整块。
 */
export function normalizeCalendarEvent(input) {
  const raw = input && typeof input === 'object' ? input : {}
  // 兼容两种上游形状：块 attrs 直塞，或 `{ attrs: {...} }` 的解析出口。
  const source = raw.attrs && typeof raw.attrs === 'object' ? raw.attrs : raw
  const eventId = typeof source.eventId === 'string' ? source.eventId.trim() : ''
  if (!CALENDAR_EVENT_ID_PATTERN.test(eventId)) return null
  const title = readCalendarText(source.title, CALENDAR_EVENT_LIMITS.title)
  if (!title) return null
  const start = typeof source.start === 'string' ? source.start.trim() : ''
  if (!readCalendarTime(start)) return null
  const end = typeof source.end === 'string' ? source.end.trim() : ''
  return {
    eventId,
    title,
    // 结束时间不合法就当没给：卡片降级成"只有开始时刻"，比整块插不进去好。
    end: readCalendarTime(end) ? end : '',
    start,
    // `tz` 只做透传与导出留痕，**显示不用它** —— 时区标注一律从 `start` 的偏移派生
    // （见 `calendarEventDateLine`），否则 `tz` 与串里的偏移打架时无人可裁。
    tz: typeof source.tz === 'string' ? source.tz.trim() : '',
    organizer: readOrganizer(source.organizer),
    reminders: Array.isArray(source.reminders)
      ? source.reminders.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item >= 0)
      : [],
    rsvp: CALENDAR_EVENT_RSVP[source.rsvp] ? source.rsvp : CALENDAR_EVENT_RSVP.none,
    attendees: readAttendees(source.attendees),
    location: readCalendarText(source.location, CALENDAR_EVENT_LIMITS.location),
  }
}

/**
 * 读路径（**宽容**）：绝不抛错。渲染层的每次调用都可能拿到「别人写的、比我们新的」
 * 数据，抛错等于打开文档就白屏（同 `readBookmark` / `readCard` 口径）。
 *
 * 出口全是**已排版好的文案**（`dateLine` / `reminderLine` / 组织者 tag 串），markup 层
 * 不再做任何判断 —— 一处判断，一处排版。
 */
export function readCalendarEvent(attrs) {
  const source = attrs && typeof attrs === 'object' ? attrs : {}
  const eventId = typeof source.eventId === 'string' ? source.eventId.trim() : ''
  const title = readCalendarText(source.title, CALENDAR_EVENT_LIMITS.title)
  const dateLine = calendarEventDateLine(source.start, source.end)
  if (!eventId || !title || !dateLine) return null
  const organizer = readOrganizer(source.organizer)
  return {
    eventId,
    title,
    dateLine,
    organizerLine: organizer
      ? { name: organizer, tags: buildOrganizerTags(source) }
      : null,
    reminderLine: calendarEventReminderLine(source.reminders),
    location: readCalendarText(source.location, CALENDAR_EVENT_LIMITS.location),
  }
}

/**
 * 把搜索接口的返回项转成块 attrs（04 §4.7 ⑥ 的 `calendar.search()` 契约）。
 *
 * 接口约定：`calendar.search({ query, range: 'future' })` →
 * `{ id, summary, startTime, endTime, isAllDay, location, attendeeCount, url }`。
 * 这里只挑**块里真的会用到**的字段：`url` / `isAllDay` / `attendeeCount` 不进块
 * （前者是外部跳转链接、飞书卡片点标题都不跳；后两者卡片上根本不显示）。
 */
export function calendarEventFromSearch(item) {
  const source = item && typeof item === 'object' ? item : {}
  return normalizeCalendarEvent({
    eventId: source.id,
    title: source.summary,
    start: source.startTime,
    end: source.endTime,
    tz: source.timezone,
    organizer: source.organizer,
    reminders: source.reminders,
    rsvp: source.rsvp,
    attendees: source.attendees,
    location: source.location,
  })
}

/* ------------------------------------------------------------------ markup */

/**
 * 卡片 markup（02 §26 ④ 的 13 层压到 5 层，视觉等价）：
 *
 *   `.lark-doc-calendar-wrapper`（400 宽 / r8 / 透明）
 *     `.lark-doc-calendar-card`（白底 + 1px 描边 + r8 + padding 12）
 *       `.lark-doc-calendar-header`（24 高，标题 `padding-left: 24px` —— 实测标题左缘
 *                                    比卡片左缘多 24，是给左侧日历图标预留的空位，
 *                                    那个图标在飞书里靠 `::before` 画、不占 DOM）
 *       `.lark-doc-calendar-scroller`（374×94 固定槽，无内部滚动条）
 *         三行 `.lark-doc-calendar-info`（图标 16×16 + 文案，行间 `margin-top: 8px`）
 *       `.lark-doc-calendar-actions` → `button.lark-doc-calendar-join`（374×32 / r6）
 *
 * 图标走 `data-icon` + CSS `mask`（`lark-doc.css` 的 `--ld-calendar-icon-*`），不在
 * spec 里塞 inline SVG：spec 的 attrs 走 `setAttribute`，塞不进 `innerHTML`，而
 * `renderHTML` 里另建 DOM 节点会让「唯一 markup 出处」这条失效。
 *
 * ⚠️ 卡片里**有真 `button`**（与 bookmark「卡内无 a/button」相反）：实测「加入日程」是
 * 常驻按钮，不是 hover 才出。导出到 PDF/DOCX 时它是个不会响的假按钮 —— 飞书自己也是
 * 这个结果，V1 不复刻点击行为。
 */
export function renderCalendarEventCard(data) {
  const shell = (className, children) => ['div', { class: className }, ...children]
  const value = data && typeof data === 'object' ? data : {}

  const icon = (name) => ['span', { class: 'lark-doc-calendar-icon', 'data-icon': name, 'aria-hidden': 'true' }]

  const rows = []
  if (value.dateLine) {
    rows.push(shell('lark-doc-calendar-info', [icon('clock'), ['span', { class: 'lark-doc-calendar-text' }, value.dateLine]]))
  }
  if (value.organizerLine) {
    const chips = [icon('user'), ['span', { class: 'lark-doc-calendar-organizer' }, value.organizerLine.name]]
    const tags = value.organizerLine.tags || []
    for (let index = 0; index < tags.length; index += 1) {
      // 第一个 tag 是「组织者」（蓝字），后面的是 rsvp tag（灰字）：两者字号相同（fs10）
      // 但色不同，CSS 靠 `is-organizer` 区分。
      chips.push(['span', {
        class: index === 0 ? 'lark-doc-calendar-tag is-organizer' : 'lark-doc-calendar-tag',
      }, tags[index]])
    }
    rows.push(shell('lark-doc-calendar-info is-organizer', chips))
  }
  if (value.reminderLine) {
    rows.push(shell('lark-doc-calendar-info', [icon('bell'), ['span', { class: 'lark-doc-calendar-text' }, value.reminderLine]]))
  }

  return shell('lark-doc-calendar-wrapper', [
    ['div', { class: 'lark-doc-calendar-card', 'data-event-id': value.eventId || '' },
      shell('lark-doc-calendar-header', [
        ['span', { class: 'lark-doc-calendar-title' }, value.title || ''],
      ]),
      // 固定槽：即使只有 2 行（无提醒）也保持 94 高，面板/卡片高度才不随数据抖动
      // （02 §26 ④ `maxScrollH = 94`，空态不收缩是面板那边的同一口径）。
      shell('lark-doc-calendar-scroller', rows),
      shell('lark-doc-calendar-actions', [
        ['button', { class: 'lark-doc-calendar-join', type: 'button' }, CALENDAR_EVENT_JOIN_LABEL],
      ]),
    ],
  ])
}
