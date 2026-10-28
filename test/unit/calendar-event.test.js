/**
 * P4-02b 日程块：时间解析 → 文案派生 → 搜索匹配 → 归一化/读路径 → 编辑器往返。
 *
 * 六组用例各守一条**看起来能跑、实际会静默坏掉**的口径：
 *
 * 1. `readCalendarTime` —— 必须取**字面分量**，不许过 `new Date()` 本地化。宿主机时区一变，
 *    `11:30+08:00` 就会显示成 `03:30` 而 `(GMT+8)` 还挂在那儿 —— 错得很有说服力。
 * 2. `calendarTimezoneLabel` —— `Z → GMT`、`+08:00 → GMT+8`、`+05:30 → GMT+5:30`（半小时区
 *    不能吞掉分钟，否则中国香港/印度用户的日程会集体偏半小时）。
 * 3. `calendarEventDateLine` —— 同日只写时刻、跨日两端各带日期、缺 end 降级成单时刻。
 * 4. `calendarEventReminderLine` —— 取**最小**提醒值；0 / 整小时 / 整天三档分界。
 * 5. `calendarEventSearchMatch` —— **只匹配标题**。年份、月日、参与人、组织者全部 0 命中
 *    （这是飞书实测口径，不是我们偷懒）；空查询直接列全部。
 * 6. `normalizeCalendarEvent` 严格 / `readCalendarEvent` 宽容 —— 写路径不合规就 null（坏数据
 *    不许落库），读路径永不抛（脏数据只让卡片少一行，不让文档白屏）。
 */
// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Editor, getSchema } from '@tiptap/core'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import {
  CALENDAR_EVENT_JOIN_LABEL, CALENDAR_EVENT_ORGANIZER_LABEL, CALENDAR_EVENT_SIZES,
  calendarEventDateLine, calendarEventFromSearch, calendarEventReminderLine,
  calendarEventSearchMatch, calendarTimezoneLabel, normalizeCalendarEvent, readCalendarEvent,
  readCalendarTime, renderCalendarEventCard,
} from '../../src/core/blocks/calendar-event'

const mounted = []
afterEach(() => {
  while (mounted.length) mounted.pop()()
})

function mount(content, options = {}) {
  const editor = new Editor({ extensions: createLarkDocExtensions(options), content })
  mounted.push(() => editor.destroy())
  return editor
}

let schema
beforeAll(() => {
  schema = getSchema(createLarkDocExtensions())
})

/** 文档里按节点名找第一个命中的节点（不赌插入位置）。 */
function findNode(doc, name) {
  let found = null
  doc.descendants((node) => {
    if (found) return false
    if (node.type.name === name) {
      found = node
      return false
    }
    return true
  })
  return found
}

/** 02 §26 ③ 实测的那一条：10月27日 (周二) 11:30 - 12:00 (GMT+8) */
const EVENT = Object.freeze({
  eventId: 'evt-camp-001',
  title: '周会',
  start: '2026-10-27T11:30:00+08:00',
  end: '2026-10-27T12:00:00+08:00',
  organizer: '张三',
  reminders: [5],
  rsvp: 'none',
})

describe('时间解析 readCalendarTime（取字面分量，不做本地化）', () => {
  it('带偏移的时刻原样还原，不受宿主机时区影响', () => {
    // 00:30+08:00 在 UTC 是前一天 16:30 —— 一旦走了本地化，day 会变 26、hour 变 16
    const parsed = readCalendarTime('2026-10-27T00:30:00+08:00')
    expect(parsed).toEqual({
      year: 2026, month: 10, day: 27, hour: 0, minute: 30, offset: '+08:00', weekday: 2,
    })
  })

  it('WEEKDAY 只按该串自己的日历算（2026-10-27 是周二）', () => {
    expect(readCalendarTime('2026-10-27T23:59:00Z').weekday).toBe(2)
    // 同一天的 00:00Z 与 23:59Z 都是周二：UTC 运算不会因偏移越界跑到周三
    expect(readCalendarTime('2026-10-27T00:00:00Z').weekday).toBe(2)
  })

  it('Z 与带毫秒的串都认', () => {
    expect(readCalendarTime('2026-10-27T11:30:00Z').offset).toBe('Z')
    expect(readCalendarTime('2026-10-27T11:30:00.123Z').minute).toBe(30)
    expect(readCalendarTime('2026-10-27T11:30Z').hour).toBe(11)
  })

  it('非法输入一律 null（含空格分隔、月越界、非字符串）', () => {
    expect(readCalendarTime('2026-10-27 11:30')).toBeNull()
    expect(readCalendarTime('2026-13-01T00:00:00Z')).toBeNull()
    expect(readCalendarTime('2026-10-32T00:00:00Z')).toBeNull()
    expect(readCalendarTime('2026-10-27T24:00:00Z')).toBeNull()
    expect(readCalendarTime('')).toBeNull()
    expect(readCalendarTime(null)).toBeNull()
    expect(readCalendarTime(1761545400000)).toBeNull()
  })
})

describe('时区标注 calendarTimezoneLabel', () => {
  it('整点时区不加 :00，半小时时区保留分钟', () => {
    expect(calendarTimezoneLabel('+08:00')).toBe('GMT+8')
    expect(calendarTimezoneLabel('-03:00')).toBe('GMT-3')
    expect(calendarTimezoneLabel('+00:00')).toBe('GMT+0')
    expect(calendarTimezoneLabel('+05:30')).toBe('GMT+5:30')
  })

  it('Z / 缺失 / 脏值都退化成 GMT（宁可不标偏移，也不印一串乱码）', () => {
    expect(calendarTimezoneLabel('Z')).toBe('GMT')
    expect(calendarTimezoneLabel()).toBe('GMT')
    expect(calendarTimezoneLabel('UTC+8')).toBe('GMT')
    expect(calendarTimezoneLabel(null)).toBe('GMT')
  })
})

describe('时间行 calendarEventDateLine', () => {
  it('同日：只写结束时刻，时区取开始端', () => {
    expect(calendarEventDateLine(EVENT.start, EVENT.end))
      .toBe('10月27日 (周二) 11:30 - 12:00 (GMT+8)')
  })

  it('跨日：两端各带日期与星期（否则「23:30 - 00:30」会像是负时长）', () => {
    expect(calendarEventDateLine('2026-10-27T23:30:00+08:00', '2026-10-28T00:30:00+08:00'))
      .toBe('10月27日 (周二) 23:30 - 10月28日 (周三) 00:30 (GMT+8)')
  })

  it('缺 end（或 end 不合法）降级成单时刻', () => {
    const single = '10月27日 (周二) 11:30 (GMT+8)'
    expect(calendarEventDateLine(EVENT.start, '')).toBe(single)
    expect(calendarEventDateLine(EVENT.start, '不是时间')).toBe(single)
    expect(calendarEventDateLine(EVENT.start, undefined)).toBe(single)
  })

  it('UTC 的日程标 GMT，不标 GMT+0', () => {
    expect(calendarEventDateLine('2026-10-27T11:30:00Z', '2026-10-27T12:00:00Z'))
      .toBe('10月27日 (周二) 11:30 - 12:00 (GMT)')
  })

  it('开始时间不合法 → 空串（卡片少一行，而不是画一条错行）', () => {
    expect(calendarEventDateLine('', EVENT.end)).toBe('')
    expect(calendarEventDateLine(null, null)).toBe('')
  })
})

describe('提醒行 calendarEventReminderLine', () => {
  it('四档：开始时 / 分钟 / 小时 / 天', () => {
    expect(calendarEventReminderLine([0])).toBe('日程开始时')
    expect(calendarEventReminderLine([5])).toBe('提前 5 分钟')
    expect(calendarEventReminderLine([60])).toBe('提前 1 小时')
    expect(calendarEventReminderLine([120])).toBe('提前 2 小时')
    expect(calendarEventReminderLine([1440])).toBe('提前 1 天')
    expect(calendarEventReminderLine([2880])).toBe('提前 2 天')
    // 90 分钟既不是整小时也不是整天 → 只能按分钟说
    expect(calendarEventReminderLine([90])).toBe('提前 90 分钟')
  })

  it('多条提醒取最小值（最靠前的那条才是卡片上要显示的）', () => {
    expect(calendarEventReminderLine([1440, 5, 60])).toBe('提前 5 分钟')
  })

  it('空数组 / 脏值 / 负数 → 空串（不画「提前 NaN 分钟」）', () => {
    expect(calendarEventReminderLine([])).toBe('')
    expect(calendarEventReminderLine(undefined)).toBe('')
    expect(calendarEventReminderLine(['x'])).toBe('')
    expect(calendarEventReminderLine([-5])).toBe('')
  })
})

describe('搜索匹配 calendarEventSearchMatch（只匹配标题）', () => {
  it('标题子串命中，大小写不敏感', () => {
    expect(calendarEventSearchMatch({ title: 'Weekly Sync' }, 'weekly')).toBe(true)
    expect(calendarEventSearchMatch({ title: 'Weekly Sync' }, '  SYNC  ')).toBe(true)
    expect(calendarEventSearchMatch({ title: 'Weekly Sync' }, '评审')).toBe(false)
  })

  it('空查询列全部（面板刚打开就是全量列表）', () => {
    expect(calendarEventSearchMatch({ title: '周会' }, '')).toBe(true)
    expect(calendarEventSearchMatch({ title: '周会' }, '   ')).toBe(true)
    expect(calendarEventSearchMatch({ title: '周会' }, undefined)).toBe(true)
  })

  it('年份 / 月日 / 组织者 / 参与人 **不参与匹配**（飞书实测 0 命中）', () => {
    const full = {
      title: '周会',
      start: '2026-10-27T11:30:00+08:00',
      organizer: '张三',
      attendees: ['李四'],
    }
    expect(calendarEventSearchMatch(full, '2026')).toBe(false)
    expect(calendarEventSearchMatch(full, '10月27')).toBe(false)
    expect(calendarEventSearchMatch(full, '张三')).toBe(false)
    expect(calendarEventSearchMatch(full, '李四')).toBe(false)
    expect(calendarEventSearchMatch(full, '周')).toBe(true)
  })
})

describe('写路径严格 normalizeCalendarEvent', () => {
  it('完整输入 → 10 个字段齐备', () => {
    const event = normalizeCalendarEvent(EVENT)
    expect(Object.keys(event).sort()).toEqual([
      'attendees', 'end', 'eventId', 'location', 'organizer', 'reminders', 'rsvp', 'start', 'title', 'tz',
    ])
    expect(event.title).toBe('周会')
    expect(event.rsvp).toBe('none')
    expect(event.reminders).toEqual([5])
  })

  it('缺 eventId / title / 合法 start 任一 → null（不许落一个空壳卡片）', () => {
    expect(normalizeCalendarEvent({ title: '周会', start: EVENT.start })).toBeNull()
    expect(normalizeCalendarEvent({ eventId: 'evt-1', start: EVENT.start })).toBeNull()
    expect(normalizeCalendarEvent({ eventId: 'evt-1', title: '周会' })).toBeNull()
    expect(normalizeCalendarEvent({ eventId: 'evt-1', title: '周会', start: '明天十一点' })).toBeNull()
    expect(normalizeCalendarEvent(null)).toBeNull()
  })

  it('eventId 只收可见 ASCII（带空格 / 中文 / 超长都拒）', () => {
    expect(normalizeCalendarEvent({ ...EVENT, eventId: 'evt 1' })).toBeNull()
    expect(normalizeCalendarEvent({ ...EVENT, eventId: '日程-1' })).toBeNull()
    expect(normalizeCalendarEvent({ ...EVENT, eventId: 'e'.repeat(161) })).toBeNull()
  })

  it('end 不合法降级成空串（卡片只写开始时刻，比整块插不进去好）', () => {
    expect(normalizeCalendarEvent({ ...EVENT, end: 'garbage' }).end).toBe('')
    expect(normalizeCalendarEvent({ ...EVENT, end: '' }).end).toBe('')
  })

  it('rsvp 越界回到 none；reminders 脏值被剔除', () => {
    expect(normalizeCalendarEvent({ ...EVENT, rsvp: 'maybe' }).rsvp).toBe('none')
    expect(normalizeCalendarEvent({ ...EVENT, rsvp: 'accepted' }).rsvp).toBe('accepted')
    expect(normalizeCalendarEvent({ ...EVENT, reminders: [5, 'x', -1, 60] }).reminders).toEqual([5, 60])
    expect(normalizeCalendarEvent({ ...EVENT, reminders: 'soon' }).reminders).toEqual([])
  })

  it('标题超长按字符截断（`Array.from` 数代理对，不切坏 emoji）', () => {
    const title = '🌵'.repeat(220)
    const event = normalizeCalendarEvent({ ...EVENT, title })
    expect(Array.from(event.title).length).toBe(200)
    expect(event.title.endsWith('🌵')).toBe(true)
  })

  it('兼容 `{ attrs }` 出口形状', () => {
    expect(normalizeCalendarEvent({ attrs: EVENT }).eventId).toBe(EVENT.eventId)
  })
})

describe('读路径宽容 readCalendarEvent', () => {
  it('派生三行文案与组织者 tag', () => {
    const view = readCalendarEvent(EVENT)
    expect(view.dateLine).toBe('10月27日 (周二) 11:30 - 12:00 (GMT+8)')
    expect(view.reminderLine).toBe('提前 5 分钟')
    expect(view.organizerLine).toEqual({
      name: '张三',
      // 第一个 tag 固定「组织者」，第二个是 rsvp 文案
      tags: [CALENDAR_EVENT_ORGANIZER_LABEL, '不参与'],
    })
  })

  it('无组织者 → organizerLine 为 null（卡片少一行，不是画个空 chip）', () => {
    expect(readCalendarEvent({ ...EVENT, organizer: '' }).organizerLine).toBeNull()
  })

  it('组织者可以是对象（`{ name }` / `{ displayName }`）', () => {
    expect(readCalendarEvent({ ...EVENT, organizer: { displayName: '李四' } }).organizerLine.name)
      .toBe('李四')
  })

  it('缺 eventId / 标题 / 时间行 → null', () => {
    expect(readCalendarEvent({ title: '周会', start: EVENT.start })).toBeNull()
    expect(readCalendarEvent({ eventId: 'evt-1', start: EVENT.start })).toBeNull()
    expect(readCalendarEvent({ eventId: 'evt-1', title: '周会' })).toBeNull()
    expect(readCalendarEvent()).toBeNull()
  })
})

describe('搜索出口 calendarEventFromSearch（对齐 04 §4.7 ⑥）', () => {
  it('吃 { id, summary, startTime, endTime } 这套宿主字段名', () => {
    const event = calendarEventFromSearch({
      id: 'evt-9', summary: '评审', startTime: '2026-10-27T11:30:00+08:00',
      endTime: '2026-10-27T12:00:00+08:00', location: '3F',
    })
    expect(event.eventId).toBe('evt-9')
    expect(event.title).toBe('评审')
    expect(event.location).toBe('3F')
  })

  it('缺 id 或 startTime 就 null（搜索结果里点不出卡片的项不该能点）', () => {
    expect(calendarEventFromSearch({ summary: '评审' })).toBeNull()
    expect(calendarEventFromSearch({ id: 'evt-9', summary: '评审' })).toBeNull()
    expect(calendarEventFromSearch(null)).toBeNull()
  })
})

describe('markup 与编辑器往返', () => {
  it('卡片 markup 的尺寸与常量同源（改常量不用改样式断言）', () => {
    const card = renderCalendarEventCard(readCalendarEvent(EVENT))
    expect(card[0]).toBe('div')
    expect(card[1].class).toBe('lark-doc-calendar-wrapper')
    expect(CALENDAR_EVENT_SIZES.cardW).toBe(400)
    expect(CALENDAR_EVENT_SIZES.contentH).toBe(94)
  })

  it('「加入日程」按钮常驻（不是 hover 才出）', () => {
    const json = JSON.stringify(renderCalendarEventCard(readCalendarEvent(EVENT)))
    expect(json).toContain(CALENDAR_EVENT_JOIN_LABEL)
    expect(json).toContain('lark-doc-calendar-join')
  })

  it('setCalendarEvent 落块 → getHTML 带 data-* → 重新解析属性一致', () => {
    const editor = mount('<p>前文</p>')
    expect(editor.commands.setCalendarEvent(EVENT)).toBe(true)

    const node = findNode(editor.state.doc, 'calendar_event')
    expect(node).toBeTruthy()
    expect(node.attrs.eventId).toBe(EVENT.eventId)

    const html = editor.getHTML()
    expect(html).toContain('data-event-id="evt-camp-001"')
    expect(html).toContain('data-type="calendar_event"')

    const reopened = mount(html)
    const reparsed = findNode(reopened.state.doc, 'calendar_event')
    expect(reparsed).toBeTruthy()
    expect(reparsed.attrs.title).toBe('周会')
    expect(reparsed.attrs.start).toBe(EVENT.start)
    expect(reparsed.attrs.reminders).toEqual([5])
  })

  it('setCalendarEvent 输入不合规 → 返 false 且正文不动（写路径不兜底）', () => {
    const editor = mount('<p>前文</p>')
    const before = editor.getHTML()
    expect(editor.commands.setCalendarEvent({ title: '没有 id' })).toBe(false)
    expect(editor.state.doc.childCount).toBe(1)
    expect(editor.getHTML()).toBe(before)
  })

  it('未知块降级不影响解析：缺 data-event-id 的同名 DOM 不被当成日程块', () => {
    const editor = mount('<div class="docx-calendar_event-block" data-block-type="calendar_event"></div>')
    const first = editor.state.doc.child(0)
    expect(first.type.name).not.toBe('calendar_event')
  })

  it('schema 认这个节点且是 atom（无 content）', () => {
    expect(schema.nodes.calendar_event).toBeTruthy()
    expect(schema.nodes.calendar_event.isAtom).toBe(true)
    expect(schema.nodes.calendar_event.spec.content).toBeUndefined()
  })
})
