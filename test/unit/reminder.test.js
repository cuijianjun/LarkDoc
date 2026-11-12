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
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { LarkDoc } from '../../src/LarkDoc'
import { createDocumentSession } from '../../src/session/DocumentSession'
import { Editor, getSchema } from '@tiptap/core'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import { sanitizeHTML, validateDocument } from '../../src/core/documentOperations'
import {
  REMINDER_AT_PATTERN, REMINDER_REPEATS, REMINDER_REPEAT_LABELS,
  createDefaultRemindAt, normalizeReminder, readReminder, reminderLabel, reminderText,
} from '../../src/core/blocks/reminder'

const mounted = []
afterEach(() => {
  while (mounted.length) mounted.pop()()
  vi.restoreAllMocks()
})

function mountReminderWorkspace(attrs = {}) {
  const createRange = document.createRange.bind(document)
  vi.spyOn(document, 'createRange').mockImplementation(() => Object.assign(createRange(), { getClientRects: () => [], getBoundingClientRect: () => ({ left: 100, top: 100, right: 100, bottom: 122, width: 0, height: 22 }) }))
  const element = document.createElement('div')
  document.body.appendChild(element)
  const settings = normalizeReminder({ remindAt: localIso(2026, 11, 12, 13, 30), ...attrs })
  const label = reminderText(settings)
  const session = createDocumentSession({ user: { id: 'self', name: '核验用户' } })
  const doc = new LarkDoc({ element, session, storage: 'none', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: label, marks: [{ type: 'reminder', attrs: settings }] }] }] } })
  mounted.push(() => { doc.destroy(); session.dispose(); element.remove() })
  const editor = doc.getEditor(), host = doc._handle.nativeHost.host
  vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({ left: 100, top: 100, right: 100, bottom: 122 })
  host.openReminderPopover(1, label.length + 1, settings)
  host.refreshReminder()
  return { doc, editor, host, element }
}

describe('current Feishu reminder popover closure', () => {
  it('has independent time/notify checkboxes and nine editable lead times', () => {
    const { host, element, editor } = mountReminderWorkspace()
    expect(element.querySelectorAll('.lark-doc-reminder-popover input[type=checkbox]')).toHaveLength(2)
    host.setReminderHasTime(false)
    expect(readReminder(editor.state.doc.firstChild.firstChild.marks.find(mark => mark.type.name === 'reminder')).hasTime).toBe(false)
    expect(editor.state.doc.textContent).not.toContain('13:30')
    host.setReminderNotify(false)
    expect(element.querySelector('[data-reminder=time]')).toBeNull()
    expect(element.querySelector('[data-reminder=offset]')).toBeNull()
    host.setReminderNotify(true)
    host.chooseReminderOffset(15)
    expect(readReminder(editor.state.doc.firstChild.firstChild.marks.find(mark => mark.type.name === 'reminder')).notifyOffset).toBe(15)
    expect(host.reminderOffsetOptions).toHaveLength(9)
    expect(element.textContent).toContain('提醒：核验用户')
  })

  it('year/month browsing does not write until choosing a day and returns to the date grid', () => {
    const { host, doc, editor } = mountReminderWorkspace({ hasTime: false })
    const before = doc.getJSON()
    host.setReminderCalendarMode('year')
    expect(host.reminderPeriodCells).toHaveLength(20)
    expect(host.reminderPeriodCells[0].value).toBe(2020)
    host.chooseReminderPeriod(2027)
    expect(host.reminderCalendarMode).toBe('date')
    host.setReminderCalendarMode('month')
    expect(host.reminderPeriodCells).toHaveLength(12)
    host.chooseReminderPeriod(1)
    expect(doc.getJSON()).toEqual(before)
    host.chooseReminderDay({ year: 2027, month: 1, day: 3 })
    expect(editor.state.doc.textContent).toBe('2027年2月3日')
    expect(host.reminderOpen).toBe(true)
  })

  it('accepts custom minute input on Enter, rolls back invalid input and leaves blur uncommitted', () => {
    const { host, editor } = mountReminderWorkspace()
    host.editReminderTime('13:17')
    expect(host.reminderTimeOptions).toHaveLength(48)
    expect(host.commitReminderTime('13:17')).toBe(true)
    expect(editor.state.doc.textContent).toContain('13:17')
    host.editReminderTime('25:99')
    expect(host.commitReminderTime('25:99')).toBe(false)
    expect(editor.state.doc.textContent).toContain('13:17')
    expect(host.reminderTimeDraft).toBeNull()
    expect(host.commitReminderTime('9:5')).toBe(true)
    expect(editor.state.doc.textContent).toContain('09:05')
    host.editReminderTime('13:18')
    host.blurReminderTime()
    expect(editor.state.doc.textContent).toContain('09:05')
    expect(host.reminderTimeDraft).toBe('13:18')
  })

  it('maps an open reminder after edits and rejects stale events after deletion or disable', () => {
    const { host, editor, doc } = mountReminderWorkspace()
    editor.commands.insertContentAt(1, 'prefix ')
    host.chooseReminderOffset(30)
    expect(editor.state.doc.textContent).toMatch(/^prefix /)
    editor.commands.deleteRange({ from: host.reminderFrom, to: host.reminderTo })
    expect(host.reminderOpen).toBe(false)
    const before = doc.getJSON()
    host.chooseReminderDay({ year: 2027, month: 1, day: 3 })
    expect(doc.getJSON()).toEqual(before)
    doc.patchProps({ config: { features: { insert: false } } })
    host.startReminder()
    expect(doc.getJSON()).toEqual(before)
  })

  it('time input preserves IME composition and Escape closes one layer at a time', () => {
    const { host, element, editor } = mountReminderWorkspace()
    const input = element.querySelector('[data-reminder=time] input')
    input.focus()
    input.value = '9:5'
    const before = editor.getJSON()
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }))
    expect(editor.getJSON()).toEqual(before)
    expect(document.activeElement).toBe(input)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(host.reminderTimesOpen).toBe(false)
    expect(host.reminderOpen).toBe(true)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(host.reminderOpen).toBe(false)
  })

  it.each(['session', 'documentId'])('rejects old reminder events immediately after %s changes', async kind => {
    const { host, doc } = mountReminderWorkspace()
    const before = doc.getJSON()
    if (kind === 'session') {
      const replacement = createDocumentSession({ documentId: 'replacement' })
      mounted.unshift(() => replacement.dispose())
      doc.patchProps({ session: replacement })
    } else doc.patchProps({ documentId: 'replacement' })
    host.chooseReminderTime('9:5')
    expect(doc.getJSON()).toEqual(before)
    await vi.waitFor(() => expect(host.reminderOpen).toBe(false))
  })

  it('edits the entire reminder across formatting splits without duplicating its old time', () => {
    const { doc, editor, host } = mountReminderWorkspace()
    const json = doc.getJSON()
    const original = json.content[0].content[0]
    json.content[0].content = [{ ...original, text: original.text.slice(0, 3), marks: [...original.marks, { type: 'bold' }] }, { ...original, text: original.text.slice(3) }]
    doc.setContent(json)
    const found = host.reminderRangeAt(2)
    expect(found.from).toBe(1)
    expect(found.to).toBe(original.text.length + 1)
    host.openReminderPopover(found.from, found.to, readReminder(found.mark))
    host.chooseReminderTime('9:5')
    expect(editor.state.doc.textContent).toMatch(/09:05$/)
    expect(editor.state.doc.textContent).not.toContain('13:30')
    expect(editor.state.doc.firstChild.firstChild.text.length).toBe(3)
    expect(editor.state.doc.firstChild.firstChild.marks.some(mark => mark.type.name === 'bold')).toBe(true)
    expect(editor.state.doc.firstChild.lastChild.marks.some(mark => mark.type.name === 'bold')).toBe(false)
  })
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
  it('当前时刻 +24h，向下取半点（13:42 → 明天 13:30）', () => {
    const now = new Date(2026, 9, 26, 13, 42, 37)
    const next = new Date(createDefaultRemindAt(now))
    expect(next.getFullYear()).toBe(2026)
    expect(next.getMonth()).toBe(9)
    expect(next.getDate()).toBe(27)
    expect(next.getHours()).toBe(13)
    expect(next.getMinutes()).toBe(30)
    expect(next.getSeconds()).toBe(0)
    expect(next.getMilliseconds()).toBe(0)
  })

  it('深夜跨越整点也只挪日期，不会把分钟带过去', () => {
    const now = new Date(2026, 9, 26, 23, 59, 59)
    const next = new Date(createDefaultRemindAt(now))
    // 保留下一天，23:59 向下取半点为 23:30。
    expect(next.getDate()).toBe(27)
    expect(next.getHours()).toBe(23)
    expect(next.getMinutes()).toBe(30)
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

  it('本周日期使用「本周X」，周日按周一开始的日历周计算', () => {
    // 10-29 是周四；11-01 是周日 —— 后者专门盯「周日/星期天」这个措辞。
    expect(reminderLabel(localIso(2026, 10, 29, 13, 5), now)).toBe('本周四 13:05')
    expect(reminderLabel(localIso(2026, 11, 1, 8, 0), now)).toBe('本周日 08:00')
  })

  it('下周按日历周分档，跨年显示年份', () => {
    expect(reminderLabel(localIso(2026, 11, 2, 13, 5), now)).toBe('下周一 13:05')
    expect(reminderLabel(localIso(2027, 1, 3, 7, 30), now)).toBe('2027年1月3日 07:30')
  })

  it('昨天单独显示，其余过去日期显示具体月日', () => {
    expect(reminderLabel(localIso(2026, 10, 20, 9, 0), now)).toBe('10月20日 09:00')
    expect(reminderLabel(localIso(2026, 10, 25, 9, 0), now)).toBe('昨天 09:00')
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
    expect(normalizeReminder({ remindAt: iso, repeat: 'weekly' })).toEqual({ remindAt: iso, notify: true, repeat: 'weekly', hasTime: true, notifyOffset: 0 })
    expect(normalizeReminder({ remindAt: iso, repeat: 'yearly' }).repeat).toBe('none')
    expect(normalizeReminder({ remindAt: iso, notify: false }).notify).toBe(false)
    expect(normalizeReminder({ remindAt: iso, notify: null }).notify).toBe(true)
  })

  it('readReminder 只认 reminder mark，别的（或空）一律 null', () => {
    expect(readReminder(null)).toBe(null)
    expect(readReminder({})).toBe(null)
    expect(readReminder({ type: { name: 'bold' }, attrs: {} })).toBe(null)
    const mark = schema.marks.reminder.create({ remindAt: localIso(2026, 10, 27, 13, 0), notify: false, repeat: 'monthly' })
    expect(readReminder(mark)).toEqual({ remindAt: localIso(2026, 10, 27, 13, 0), notify: false, repeat: 'monthly', hasTime: true, notifyOffset: 0 })
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
    expect(mark.attrs).toEqual({ remindAt: iso, notify: false, repeat: 'daily', hasTime: true, notifyOffset: 0 })
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

describe('提醒 HTML 清洗往返', () => {
  it('导入保留原始日期、通知开关和重复规则，不回落成默认的明天', () => {
    const iso = '2099-10-26T13:00:00Z'
    const html = `<p><span data-type="reminder" data-remind-at="${iso}" data-notify="false" data-repeat="weekly">10月26日 13:00</span></p>`
    const editor = mount(sanitizeHTML(html))
    const mark = editor.getJSON().content[0].content[0].marks[0]
    expect(mark.attrs).toEqual({ remindAt: iso, notify: false, repeat: 'weekly', hasTime: true, notifyOffset: 0 })
  })

  it('清洗剔除非法日期、重复规则及事件属性，保留合法带时区日期', () => {
    const html = sanitizeHTML('<p><span data-type="reminder" data-remind-at="2099-10-26T13:00" data-repeat="yearly" onclick="alert(1)">非法</span><span data-type="reminder" data-remind-at="2099-10-26T13:00:00+08:00" data-repeat="daily">合法</span></p>')
    const container = document.createElement('div')
    container.innerHTML = html
    const [invalid, valid] = container.querySelectorAll('span')
    expect(invalid.hasAttribute('data-remind-at')).toBe(false)
    expect(invalid.hasAttribute('data-repeat')).toBe(false)
    expect(invalid.hasAttribute('onclick')).toBe(false)
    expect(valid.getAttribute('data-remind-at')).toBe('2099-10-26T13:00:00+08:00')
    expect(valid.getAttribute('data-repeat')).toBe('daily')
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

describe('current Feishu reminder settings and date labels', () => {
  const now = localIso(2026, 11, 10, 12, 0)
  it.each([
    [2026, 11, 9, '昨天'], [2026, 11, 8, '11月8日'],
    [2026, 11, 10, '今天'], [2026, 11, 11, '明天'],
    [2026, 11, 12, '本周四'], [2026, 11, 15, '本周日'],
    [2026, 11, 16, '下周一'], [2026, 11, 22, '下周日'],
    [2026, 11, 23, '11月23日'], [2027, 2, 3, '2027年2月3日'],
  ])('derives the source date-only label for %i/%i/%i', (year, month, day, label) => {
    const remindAt = localIso(year, month, day, 13, 30)
    expect(reminderText({ remindAt, hasTime: false }, now)).toBe(label)
    expect(reminderText({ remindAt, hasTime: true }, now)).toBe(`${label} 13:30`)
  })

  it('round-trips independent time visibility, notification and lead time without losing legacy repeat', () => {
    const remindAt = localIso(2026, 11, 12, 13, 30)
    const attrs = normalizeReminder({ remindAt, hasTime: false, notify: false, notifyOffset: 15, repeat: 'weekly' })
    expect(attrs).toEqual({ remindAt, hasTime: false, notify: false, notifyOffset: 15, repeat: 'weekly' })
    const ed = mount('<p></p>')
    ed.commands.setReminder(attrs)
    const html = sanitizeHTML(ed.getHTML())
    expect(html).toContain('data-has-time="false"')
    expect(html).toContain('data-notify-offset="15"')
    const restored = mount(html)
    expect(readReminder(restored.state.doc.firstChild.firstChild.marks.find(mark => mark.type.name === 'reminder'))).toEqual(attrs)
  })

  it('validates notification lead time as the observed finite choices and rejects non-boolean time visibility', () => {
    const ed = mount('<p></p>')
    const input = attrs => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '日期', marks: [{ type: 'reminder', attrs }] }] }] })
    for (const notifyOffset of [0, 5, 15, 30, 60, 120, 1440, 2880, 10080]) expect(() => validateDocument(input({ hasTime: false, notifyOffset }), ed.schema)).not.toThrow()
    for (const notifyOffset of [-1, 1.5, 99999, '15']) expect(() => validateDocument(input({ notifyOffset }), ed.schema)).toThrow()
    expect(() => validateDocument(input({ hasTime: 'false' }), ed.schema)).toThrow()
  })
})
