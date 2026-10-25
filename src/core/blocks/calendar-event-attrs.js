/**
 * 日程卡片块的属性层（P4-02b 拆出）—— 安全谓词 + `addAttributes()` 的 11 个字段。
 *
 * 拆出来的原因很具体：`calendar-event.js` 是「schema + 命令 + renderHTML」三段式，
 * 属性层最长且自成一体（每个字段一条 default/validate/parseHTML），留在原文件里
 * 会把块文件顶过 250 行（P0-04 的拆块硬规则，check-architecture.js 守着）。
 *
 * 谓词（`safeTime` / `safeMinutes` / `safeRsvp`）也一并导出：`refetchCalendarEvent`
 * 回写快照时要按同一口径判字段合法性，两处各抄一份必然会漂。
 */
import { validateAttribute } from './shared'
import {
  CALENDAR_EVENT_ID_PATTERN, CALENDAR_EVENT_LIMITS, CALENDAR_EVENT_RSVP, readCalendarTime,
} from '../embed/calendar-event'

const safeText = (limit) => (value) => value === null || value === undefined
  || (typeof value === 'string' && Array.from(value).length <= limit && !value.includes('\u0000'))

export const safeEventId = (value) => value === null || value === undefined || value === ''
  || (typeof value === 'string' && CALENDAR_EVENT_ID_PATTERN.test(value))

/** 时间属性：`null` / 空串放行（schema 默认值），其余必须能解析出字面分量。 */
export const safeTime = (value) => value === null || value === undefined || value === ''
  || (typeof value === 'string' && readCalendarTime(value) !== null)

export const safeRsvp = (value) => value === null || value === undefined
  || CALENDAR_EVENT_RSVP[value] !== undefined

export const safeMinutes = (value) => value === null || value === undefined
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

/** `addAttributes()` 的返回值：全部 `rendered: false`，markup 由块自己的 renderHTML 画。 */
export function calendarEventAttributes() {
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
}
