/**
 * P4-02a 日期提醒：默认值 → 文案派生 → 属性收口 → 编辑器往返 → 蒙层同生共死。
 *
 * 五组用例各守一条**看起来能跑、实际会静默坏掉**的口径：
 *
 * 1. `createDefaultRemindAt` —— 必须是 `+24h 且分钟归零`。偏移错一小时，用户看到的是
 *    「今天 23:00」而不是「明天 00:00」；不归零则出现「明天 13:42」这种没人手填过的分钟。
 * 2. `reminderLabel` —— 四档分界（今天 / 明天 / 7 日内周X / 更远具体日期）。分界写错
 *    不会报错，只会让 chip 显示成「10月29日 13:05」，用户得多读一遍才知道是后天。
 * 3. `normalizeReminder` / `readReminder` —— 空值、越界枚举、裸时间串（无时区）的兜底。
 *    这两个函数是所有写入路径的收口，兜底一旦变成「原样透传」，坏数据会直接落库。
 * 4. 编辑器往返 —— `renderHTML` 的 `data-*` 与 `parseHTML` 必须对齐；`inclusive: false`
 *    必须真生效（否则 chip 后面接着打字，整段变橙）。
 * 5. 块级蒙层 —— node decoration 跟着 mark 走。这是「删 chip 蒙层还在」「撤销只回 chip
 *    不回蒙层」两条飞书 bug 在结构上不可能出现的地方，掉了就等于把 bug 请回来。
 */
// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Editor, getSchema } from '@tiptap/core'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import { validateDocument } from '../../src/core/documentOperations'
import {
  REMINDER_AT_PATTERN, REMINDER_REPEATS, REMINDER_REPEAT_LABELS,
  createDefaultRemindAt, normalizeReminder, readReminder, reminderLabel, reminderText,
} from '../../src/core/blocks/reminder'

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

/** 本地时间构造 → ISO 串（`reminderLabel` 按本地日历分档，用本地构造才不随时区漂）。 */
function localIso(year, month, day, hours, minutes) {
  return new Date(year, month - 1, day, hours, minutes, 0, 0).toISOString()
}

describe('默认提醒时间 createDefaultRemindAt', () => {
  it('＝ 当前时刻 +24h 且分钟归零（batch373 @13:xx → 明天 13:00）', () => {
    const now = new Date(2026, 9, 26, 13, 42, 37)
    const next = new Date(createDefaultRemindAt(now))
    expect(next.getFullYear()).toBe(2026)
    expect(next.getMonth()).toBe(9)
    expect(next.getDate()).toBe(27)
    expect(next.getHours()).toBe(13)
    expect(next.getMinutes()).toBe(0)
    expect(next.getSeconds()).toBe(0)
    expect(next.getMilliseconds()).toBe(0)
  })

  it('深夜跨越整点也只挪日期，不会把分钟带过去', () => {
    const now = new Date(2026, 9, 26, 23, 59, 59)
    const next = new Date(createDefaultRemindAt(now))
    // 26 日 23:59 +24h = 27 日 23:59 → 归零 23:00（不是 28 日 00:00，位移只做一次）
    expect(next.getDate()).toBe(27)
    expect(next.getHours()).toBe(23)
    expect(next.getMinutes()).toBe(0)
  })

  it('输出是带时区的 ISO 串（`toISOString` 走 Z，跨宿主可逐字节比较）', () => {
    expect(REMINDER_AT_PATTERN.test(createDefaultRemindAt(new Date(2026, 9, 26, 8, 5)))).toBe(true)
    // 入参不可解析时回落「现在」，不能抛、也不能返回空串。
    expect(REMINDER_AT_PATTERN.test(createDefaultRemindAt('不是时间'))).toBe(true)
    expect(REMINDER_AT_PATTERN.test(createDefaultRemindAt(null))).toBe(true)
  })
})

describe('chip 文案派生 reminderLabel（02 §19.4 ⑥）', () => {
  const now = new Date(2026, 9, 26, 9, 0) // 2026-10-26（周一）09:00

  it('同日 → 今天 HH:mm', () => {
    expect(reminderLabel(localIso(2026, 10, 26, 13, 5), now)).toBe('今天 13:05')
    // 边界：同一本地日历日的 00:00 与 23:59 都算「今天」，哪怕实际只差几十分钟或近一天。
    expect(reminderLabel(localIso(2026, 10, 26, 0, 0), now)).toBe('今天 00:00')
    expect(reminderLabel(localIso(2026, 10, 26, 23, 59), now)).toBe('今天 23:59')
  })

  it('次日 → 明天 HH:mm（含 7 日内分档的起点）', () => {
    expect(reminderLabel(localIso(2026, 10, 27, 13, 0), now)).toBe('明天 13:00')
  })

  it('7 日内 → 周X HH:mm，用「周日」不用「星期天」', () => {
    // 10-29 是周四；11-01 是周日 —— 后者专门盯「周日/星期天」这个措辞。
    expect(reminderLabel(localIso(2026, 10, 29, 13, 5), now)).toBe('周四 13:05')
    expect(reminderLabel(localIso(2026, 11, 1, 8, 0), now)).toBe('周日 08:00')
  })

  it('第 7 天起 → M月D日 HH:mm', () => {
    expect(reminderLabel(localIso(2026, 11, 2, 13, 5), now)).toBe('11月2日 13:05')
    expect(reminderLabel(localIso(2027, 1, 3, 7, 30), now)).toBe('1月3日 07:30')
  })

  it('过去的时间点走具体日期档，不特化成「昨天」（飞书允许设到过去且不警告）', () => {
    expect(reminderLabel(localIso(2026, 10, 20, 9, 0), now)).toBe('10月20日 09:00')
    expect(reminderLabel(localIso(2026, 10, 25, 9, 0), now)).toBe('10月25日 09:00')
  })

  it('不可解析 → 空串（调用方据此拒绝写入，不写一个空 chip）', () => {
    expect(reminderLabel('')).toBe('')
    expect(reminderLabel(null)).toBe('')
    expect(reminderLabel('2026-13-45T99:99:00Z')).toBe('')
    expect(reminderText({ remindAt: '乱码' })).toBe('')
  })
})

describe('属性收口 normalizeReminder / readReminder', () => {
  it('全空输入 → 合法默认值（notify 默认 true、repeat 默认 none）', () => {
    const entry = normalizeReminder()
    expect(REMINDER_AT_PATTERN.test(entry.remindAt)).toBe(true)
    expect(entry.notify).toBe(true)
    expect(entry.repeat).toBe('none')
    expect(normalizeReminder(null)).toEqual(entry)
  })

  it('裸时间串（无时区）不原样透传，回落默认值', () => {
    // 裸 `2026-10-26T13:00` 会被各端按本地时区各解释一遍 —— 必须当成非法输入。
    const entry = normalizeReminder({ remindAt: '2026-10-26T13:00' })
    expect(entry.remindAt).not.toBe('2026-10-26T13:00')
    expect(REMINDER_AT_PATTERN.test(entry.remindAt)).toBe(true)
  })

  it('合法时间与枚举原样保留，越界枚举落 none', () => {
    const iso = localIso(2026, 10, 27, 13, 0)
    expect(normalizeReminder({ remindAt: iso, repeat: 'weekly' })).toEqual({ remindAt: iso, notify: true, repeat: 'weekly' })
    expect(normalizeReminder({ remindAt: iso, repeat: 'yearly' }).repeat).toBe('none')
    expect(normalizeReminder({ remindAt: iso, notify: false }).notify).toBe(false)
    expect(normalizeReminder({ remindAt: iso, notify: null }).notify).toBe(true)
  })

  it('readReminder 只认 reminder mark，别的（或空）一律 null', () => {
    expect(readReminder(null)).toBe(null)
    expect(readReminder({})).toBe(null)
    expect(readReminder({ type: { name: 'bold' }, attrs: {} })).toBe(null)
    const mark = schema.marks.reminder.create({ remindAt: localIso(2026, 10, 27, 13, 0), notify: false, repeat: 'monthly' })
    expect(readReminder(mark)).toEqual({ remindAt: localIso(2026, 10, 27, 13, 0), notify: false, repeat: 'monthly' })
  })

  it('readReminder 也会兜底：越界 repeat → none，缺 notify → true', () => {
    expect(readReminder(schema.marks.reminder.create({ repeat: 'yearly' })).repeat).toBe('none')
    expect(readReminder(schema.marks.reminder.create({})).notify).toBe(true)
  })

  it('重复规则枚举与文案表一一对应', () => {
    expect(REMINDER_REPEATS).toEqual(['none', 'daily', 'weekly', 'monthly'])
    expect(Object.keys(REMINDER_REPEAT_LABELS).sort()).toEqual(REMINDER_REPEATS.slice().sort())
  })
})

describe('REMINDER_AT_PATTERN 强制带时区', () => {
  it('接受 Z 与 ±HH:mm，含可选秒与毫秒', () => {
    expect(REMINDER_AT_PATTERN.test('2026-10-26T05:00:00Z')).toBe(true)
    expect(REMINDER_AT_PATTERN.test('2026-10-26T13:00:00+08:00')).toBe(true)
    expect(REMINDER_AT_PATTERN.test('2026-10-26T13:00+08:00')).toBe(true)
    expect(REMINDER_AT_PATTERN.test('2026-10-26T13:00:00.123+08:00')).toBe(true)
  })

  it('拒绝无时区、纯日期、空串', () => {
    expect(REMINDER_AT_PATTERN.test('2026-10-26T13:00')).toBe(false)
    expect(REMINDER_AT_PATTERN.test('2026-10-26')).toBe(false)
    expect(REMINDER_AT_PATTERN.test('')).toBe(false)
  })
})

describe('编辑器往返（mark 形态，02 §19.4 ⑥）', () => {
  it('schema 里是 mark 而不是 node，且 inclusive 为 false', () => {
    expect(schema.marks.reminder).toBeTruthy()
    expect(schema.nodes.reminder).toBeUndefined()
    expect(schema.marks.reminder.spec.inclusive).toBe(false)
  })

  it('setReminder 写入的是「带 mark 的文本节点」，文案由 remindAt 派生', () => {
    const editor = mount('<p>前文</p>')
    const iso = localIso(2026, 10, 27, 13, 0)
    editor.commands.setTextSelection(3)
    editor.commands.setReminder({ remindAt: iso, notify: false, repeat: 'weekly' })
    const node = editor.getJSON().content[0].content[1]
    expect(node.type).toBe('text')
    // 文案分档取决于「运行时的今天」，所以只断言形状，不写死今天是哪一档。
    expect(node.text).toMatch(/^(?:今天|明天|周[一二三四五六日]|\d{1,2}月\d{1,2}日) \d{2}:\d{2}$/)
    expect(node.marks).toHaveLength(1)
    expect(node.marks[0].type).toBe('reminder')
    expect(node.marks[0].attrs.remindAt).toBe(iso)
    expect(node.marks[0].attrs.notify).toBe(false)
    expect(node.marks[0].attrs.repeat).toBe('weekly')
  })

  it('setReminder 先 normalize 再派生文案：越界入参也不会「文案与 attrs 不同步」', () => {
    const editor = mount('<p></p>')
    editor.commands.setReminder({ repeat: 'yearly' })
    const mark = editor.getJSON().content[0].content[0].marks[0]
    expect(mark.attrs.repeat).toBe('none')
  })

  it('getHTML() 的 data-* 能被自己重新解析回来（存一次盘再打开不丢时间）', () => {
    const iso = localIso(2026, 10, 27, 13, 0)
    const editor = mount('<p></p>')
    editor.commands.setReminder({ remindAt: iso, notify: false, repeat: 'daily' })
    const html = editor.getHTML()
    expect(html).toContain('data-type="reminder"')
    expect(html).toContain('class="lark-doc-reminder-chip"')
    expect(html).toContain(`data-remind-at="${iso}"`)
    expect(html).toContain('data-notify="false"')
    expect(html).toContain('data-repeat="daily"')
    const reopened = mount(html)
    const mark = reopened.getJSON().content[0].content[0].marks[0]
    expect(mark.attrs).toEqual({ remindAt: iso, notify: false, repeat: 'daily' })
  })

  it('inclusive:false ⇒ chip 末尾接着打字不继承 mark', () => {
    const editor = mount('<p>甲</p>')
    editor.commands.setTextSelection(2)
    editor.commands.setReminder({ remindAt: localIso(2026, 10, 27, 13, 0) })
    const end = editor.state.selection.to
    // `insertText` 走的就是「按当前选区取 marks 再插字」，等价于真键盘输入。
    editor.view.dispatch(editor.state.tr.insertText('乙', end))
    const nodes = editor.getJSON().content[0].content
    expect(nodes[nodes.length - 1].text).toBe('乙')
    expect(nodes[nodes.length - 1].marks).toBeUndefined()
  })

  it('unsetReminder 之后不再有 reminder mark', () => {
    const editor = mount('<p></p>')
    editor.commands.setReminder({ remindAt: localIso(2026, 10, 27, 13, 0) })
    editor.commands.selectAll()
    editor.commands.unsetReminder()
    const marks = (editor.getJSON().content[0].content || []).flatMap((node) => node.marks || [])
    expect(marks.some((mark) => mark.type === 'reminder')).toBe(false)
  })
})

describe('块级蒙层与 chip 同生共死（node decoration）', () => {
  it('有 reminder mark 的文本块挂上 lark-doc-reminder-highlighted，mark 一没就跟着没', () => {
    const editor = mount('<p>前文</p><p>后文</p>')
    expect(editor.view.dom.querySelector('.lark-doc-reminder-highlighted')).toBe(null)
    editor.commands.setTextSelection(3)
    editor.commands.setReminder({ remindAt: localIso(2026, 10, 27, 13, 0) })
    const highlighted = editor.view.dom.querySelectorAll('.lark-doc-reminder-highlighted')
    // 只标记「含有 reminder 的那个块」，不能顺手把整篇所有文本块都染上。
    expect(highlighted).toHaveLength(1)
    expect(highlighted[0].textContent).toContain('前文')
    editor.commands.selectAll()
    editor.commands.unsetReminder()
    expect(editor.view.dom.querySelector('.lark-doc-reminder-highlighted')).toBe(null)
  })
})

describe('validateDocument × reminder attrs', () => {
  function docWith(attrs) {
    return {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '明天 13:00', marks: [{ type: 'reminder', attrs }] }] }],
    }
  }

  it('notify（布尔）/ repeat（枚举）/ remindAt（带时区 ISO）全部放行', () => {
    const json = validateDocument(docWith({ remindAt: '2026-10-27T13:00:00+08:00', notify: false, repeat: 'weekly' }), schema)
    expect(json.content[0].content[0].marks[0].attrs.notify).toBe(false)
  })

  it('空串 remindAt 放行（schema 默认值，「mark 在但时间缺失」的合法态）', () => {
    expect(() => validateDocument(docWith({ remindAt: '' }), schema)).not.toThrow()
  })

  it('repeat 越界、裸时间串、非布尔 notify 都拒收', () => {
    expect(() => validateDocument(docWith({ remindAt: '2026-10-27T13:00:00+08:00', repeat: 'yearly' }), schema)).toThrow()
    expect(() => validateDocument(docWith({ remindAt: '2026-10-27T13:00' }), schema)).toThrow()
    expect(() => validateDocument(docWith({ remindAt: '2026-10-27T13:00:00+08:00', notify: 'true' }), schema)).toThrow()
  })
})
