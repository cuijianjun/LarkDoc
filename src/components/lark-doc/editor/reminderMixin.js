/**
 * reminderMixin — 日期提醒日历浮层（P4-02a）的开关、定位、月历派生与就地改写。
 *
 * 与 `mentionMixin.js` 的**结构差异**（都写在 02 §19.4 实测里，不是随手改的）：
 *   1. mention 的驱动源是文档事务（`document.js` 的 `onMention(match)` 每帧回调），
 *      因为关键词就是正文里 `@` 后面那截；reminder 没有「关键词」，浮层由**点 chip**
 *      开起来 —— 所以入口是 DOM 事件，不进 `document.js` 的插件回调（少一条没人用的通道）。
 *   2. mention 落 chip 是一次性提交（面板关掉就结束）；reminder 的浮层**没有确定按钮**
 *      （02 §19.4 ④-bis 量到的只有日历 + 两行选项 + 用户行），所以每天/每时的选择都
 *      **当场改写正文**（`applyReminder`），关浮层 = 直接结束。
 *   3. 因为要反复改写同一个 chip，本模块自己维护 `reminderFrom / reminderTo`
 *      （chip 在文档里的区间）。每次改写都「同起点替换、长度现算」，改写后立刻回写这两个值 ——
 *      不靠重新搜文档定位，多 chip 同块也不会串。
 *
 * 🔴 两条负结论照 02 §19.4 执行，别顺手「补全」：
 *   - 「`!日期错误` 失败态」在真飞书里不存在（允许设到过去、无警告）⇒ 这里不校验时间先后。
 *   - 「撤销只回 chip 不回蒙层」是飞书 bug ⇒ 我们 mark + decoration 天然同生同死，不复刻。
 */
import { REMINDER_REPEAT_LABELS, normalizeReminder, readReminder, reminderLabel } from '../../../core/blocks/reminder'

/** 星期表头：飞书写「日一二三四五六」，不写「星期天」。 */
export const REMINDER_WEEKDAYS = Object.freeze(['日', '一', '二', '三', '四', '五', '六'])

/** 时间粒度 30 分钟（02 §19.4 ④-quinquies 实测：面板 166×246 = 8 项视口，行 32 高）。 */
const REMINDER_TIME_STEP = 30

const POPOVER_WIDTH = 280
/** 未量到实际高度前的兜底（02 §19.4 ④：壳 280×534）。落 DOM 后会读真实 offsetHeight 再校一次。 */
const POPOVER_HEIGHT = 534
const TIMES_WIDTH = 166
const TIMES_HEIGHT = 246
const POPOVER_GAP = 6
const VIEWPORT_MARGIN = 8

/** 6×7 = 42 格（02 §19.4 ④-ter：DOM 里同时预渲染约 7 个月，一个月只有 42 格）。 */
const CALENDAR_CELLS = 42

function pad2(value) {
  return value < 10 ? `0${value}` : String(value)
}

/** 本地日历键 `YYYY-M-D`：跨时区比较「同一天」必须按本地日历算，不能比 UTC 串。 */
function dayKeyOf(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/** 宽松转 Date：不可解析一律 null（不抛）。 */
function toDate(value) {
  if (!value) return null
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export default {
  data() {
    return {
      reminderOpen: false,
      /** chip 在文档里的区间；`null` = 当前没有在编辑的 chip。 */
      reminderFrom: null,
      reminderTo: null,
      /** 唯一真相：带时区的 ISO 串（02 §19.4 ⑥）。chip 文案永远由它现算。 */
      reminderAt: '',
      reminderNotify: true,
      reminderRepeat: 'none',
      /** 日历当前展示的月份（0-based month，与 `Date` 一致）。 */
      reminderView: { year: 0, month: 0 },
      reminderTimesOpen: false,
      reminderStyle: {},
      reminderTimesStyle: {},
      /**
       * 浮层底部「提醒：xxx」的宿主用户名。**V1 恒为空**（组件没有「当前用户」这个概念，
       * 不新造配置字段），为空时整行不渲染 —— 换宿主注入时只填这里，模板不用动。
       */
      reminderUser: '',
      reminderWeekdays: REMINDER_WEEKDAYS,
    }
  },
  computed: {
    reminderSelectedDay() {
      const date = toDate(this.reminderAt)
      return date ? dayKeyOf(date) : ''
    },
    reminderSelectedTime() {
      const date = toDate(this.reminderAt)
      return date ? `${pad2(date.getHours())}:${pad2(date.getMinutes())}` : ''
    },
    reminderViewTitle() {
      return `${this.reminderView.year}年 ${this.reminderView.month + 1}月`
    },
    /**
     * 42 个日历格。`outside`（前后月补白）在飞书里**点了连校验都不跑**（02 §19.4 ④-ter ②），
     * 模板直接 `disabled` —— 同样的「点了没反应」，但不会让人以为程序卡住。
     */
    reminderCells() {
      const year = this.reminderView.year
      const month = this.reminderView.month
      const lead = new Date(year, month, 1).getDay()
      const first = new Date(year, month, 1 - lead)
      const todayKey = dayKeyOf(new Date())
      const selectedKey = this.reminderSelectedDay
      const cells = []
      for (let index = 0; index < CALENDAR_CELLS; index += 1) {
        const date = new Date(first.getFullYear(), first.getMonth(), first.getDate() + index)
        const key = dayKeyOf(date)
        cells.push({
          key,
          day: date.getDate(),
          year: date.getFullYear(),
          month: date.getMonth(),
          outside: date.getMonth() !== month,
          today: key === todayKey,
          selected: key === selectedKey,
        })
      }
      return cells
    },
    /** 48 个半点档位（00:00 … 23:30）。 */
    reminderTimeOptions() {
      const total = (24 * 60) / REMINDER_TIME_STEP
      const options = []
      for (let index = 0; index < total; index += 1) {
        const minutes = index * REMINDER_TIME_STEP
        options.push(`${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`)
      }
      return options
    },
    /**
     * 第二行「提醒」下拉的文案。飞书这一格是 **`readOnly`** 的展示项，默认文案
     * 「事件发生时」（02 §19.4 ④-bis 5″）—— 所以 `none` 显示「事件发生时」而不是
     * `REMINDER_REPEAT_LABELS.none` 的「不重复」，其余三档直接复用契约层标签。
     * 🔴 若日后证实这格可编辑，只改模板里那个 `disabled`，状态机已经具备。
     */
    reminderRepeatText() {
      if (this.reminderRepeat === 'none') return '事件发生时'
      return REMINDER_REPEAT_LABELS[this.reminderRepeat] || REMINDER_REPEAT_LABELS.none
    },
  },
  methods: {
    /**
     * 点 chip 打开浮层（模板绑在 `.lark-doc-paper` 上做事件委托）。
     *
     * 用 DOM 位置反查 mark：`view.posAtDOM(chip, 0)` 拿到的是**被点的那个** chip 的起点，
     * 所以同一块里有多个 chip 也不会串台（若改成「扫块内第一个 reminder」就会串）。
     */
    onReminderChipClick(event) {
      if (!this.editor || !this.writable() || this.effectiveReadonly) return
      const target = event ? event.target : null
      const chip = target && target.closest ? target.closest('.lark-doc-reminder-chip') : null
      if (!chip) return
      const found = this.reminderRangeAt(this.editor.view.posAtDOM(chip, 0))
      if (!found) return
      this.openReminderPopover(found.from, found.to, readReminder(found.mark))
    },
    /**
     * 定位光标/元素位置所在的那个 reminder chip（两轮：先严格 `[from, to)`，再退化到
     * `pos === to`）。
     *
     * 两轮是必要的：`startReminder` 插完之后光标停在 chip **末尾**（`head === to`），
     * 而 `posAtDOM` 点出来的是 chip **起点**。一次遍历里同时用两种判定会让「紧贴着的
     * 下一个 chip 的起点」抢走前一个 chip 的归属。
     */
    reminderRangeAt(pos) {
      if (!this.editor) return null
      const doc = this.editor.state.doc
      if (typeof pos !== 'number' || pos < 0 || pos > doc.content.size) return null
      const $pos = doc.resolve(pos)
      const base = $pos.start()
      let strict = null
      let boundary = null
      $pos.parent.forEach((node, offset) => {
        if (!node.isText) return
        const mark = node.marks.find((item) => item.type.name === 'reminder')
        if (!mark) return
        const from = base + offset
        const to = from + node.nodeSize
        if (pos >= from && pos < to) {
          if (!strict) strict = { from, to, mark }
        } else if (pos === to && !boundary) {
          boundary = { from, to, mark }
        }
      })
      return strict || boundary
    },
    /** OPEN：接一份 attrs，把浮层内部状态铺好并挂到 chip 旁边。 */
    openReminderPopover(from, to, attrs) {
      const next = normalizeReminder(attrs)
      const date = toDate(next.remindAt) || new Date()
      this.reminderFrom = from
      this.reminderTo = to
      this.reminderAt = next.remindAt
      this.reminderNotify = next.notify
      this.reminderRepeat = next.repeat
      this.reminderView = { year: date.getFullYear(), month: date.getMonth() }
      this.reminderOpen = true
      this.reminderTimesOpen = false
      this.reminderStyle = this.reminderStyleAt(from, POPOVER_HEIGHT)
      this.$nextTick(() => this.positionReminderPopover())
    },
    /** CLOSE：状态全清，正文不动（浮层没有「取消」语义，改动早已落盘）。 */
    closeReminderPopover(restoreFocus = false) {
      if (!this.reminderOpen && this.reminderFrom === null) return
      this.reminderOpen = false
      this.reminderTimesOpen = false
      this.reminderFrom = null
      this.reminderTo = null
      this.reminderAt = ''
      this.reminderNotify = true
      this.reminderRepeat = 'none'
      this.reminderStyle = {}
      this.reminderTimesStyle = {}
      if (restoreFocus) this.focus()
    },
    /**
     * 命令菜单入口（斜杠「日期提醒」）：插默认 chip → 立刻弹浮层。
     *
     * 默认值 = 当前时刻 +24h 且分钟归零（`normalizeReminder({})` 走的就是 `createDefaultRemindAt`），
     * 所以 chip 文案落在「明天 HH:00」这一档（02 §19.4 ② batch373 / batch385 两次实测一致）。
     */
    startReminder() {
      if (!this.editor || !this.writable() || this.effectiveReadonly) return
      const attrs = normalizeReminder({})
      const text = reminderLabel(attrs.remindAt)
      if (!text) return
      this.closeCommandMenu()
      this.editor.chain().focus().insertContent({ type: 'text', text, marks: [{ type: 'reminder', attrs }] }).run()
      // 插完光标在 chip 末尾 ⇒ `reminderRangeAt` 的第二种判定（`pos === to`）正好命中。
      const found = this.reminderRangeAt(this.editor.state.selection.head)
      if (!found) return
      this.openReminderPopover(found.from, found.to, attrs)
    },
    /**
     * 唯一写入口：把「当前浮层状态 + 增量 patch」收口成一份 attrs，**同起点替换** chip。
     *
     * 为什么不 `setMark`：mark 不携带内容，`setMark` 只会给已有文字套色、不会改文案。
     * chip 的可见文字就是文案，所以必须整段文本一起换。
     */
    applyReminder(patch) {
      if (!this.editor || this.reminderFrom === null || this.reminderTo === null) return
      const merged = patch && typeof patch === 'object' ? patch : {}
      const next = normalizeReminder({
        remindAt: merged.remindAt === undefined ? this.reminderAt : merged.remindAt,
        notify: merged.notify === undefined ? this.reminderNotify : merged.notify,
        repeat: merged.repeat === undefined ? this.reminderRepeat : merged.repeat,
      })
      const text = reminderLabel(next.remindAt)
      if (!text) return
      const from = this.reminderFrom
      const to = this.reminderTo
      const schema = this.editor.schema
      const tr = this.editor.state.tr
      tr.replaceWith(from, to, schema.text(text, [schema.marks.reminder.create(next)]))
      this.editor.view.dispatch(tr)
      // 同起点替换 ⇒ 起点不变、终点 = 起点 + 新文案长度（文案会变长变短，必须现算）。
      this.reminderTo = from + text.length
      this.reminderAt = next.remindAt
      this.reminderNotify = next.notify
      this.reminderRepeat = next.repeat
      const date = toDate(next.remindAt)
      if (date) this.reminderView = { year: date.getFullYear(), month: date.getMonth() }
      this.$nextTick(() => {
        this.positionReminderPopover()
        if (this.reminderTimesOpen) this.positionReminderTimes()
      })
    },
    shiftReminderMonth(step) {
      const view = this.reminderView
      const date = new Date(view.year, view.month + step, 1)
      this.reminderView = { year: date.getFullYear(), month: date.getMonth() }
    },
    /** 选日：时间沿用当前 chip 的时分（飞书的日历只换日期，不动时刻）。 */
    chooseReminderDay(cell) {
      if (!cell || cell.outside) return
      const base = toDate(this.reminderAt) || new Date()
      const picked = new Date(cell.year, cell.month, cell.day, base.getHours(), base.getMinutes(), 0, 0)
      this.applyReminder({ remindAt: picked.toISOString() })
    },
    /** 选时：日期沿用当前选中的那天。 */
    chooseReminderTime(value) {
      const parts = String(value || '').split(':')
      const hours = Number(parts[0])
      const minutes = Number(parts[1])
      if (Number.isNaN(hours) || Number.isNaN(minutes)) return
      const base = toDate(this.reminderAt) || new Date()
      const picked = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hours, minutes, 0, 0)
      this.reminderTimesOpen = false
      this.applyReminder({ remindAt: picked.toISOString() })
    },
    toggleReminderTimes() {
      this.reminderTimesOpen = !this.reminderTimesOpen
      if (!this.reminderTimesOpen) return
      this.$nextTick(() => {
        this.positionReminderTimes()
        this.scrollReminderTimeIntoView()
      })
    },
    /** 下拉打开时把选中档滚进视口（48 档、视口只有 8 项，不滚就会落在看不见的位置）。 */
    scrollReminderTimeIntoView() {
      const root = this.$refs.root
      if (!root) return
      const list = root.querySelector('.lark-doc-reminder-times')
      const active = root.querySelector('.lark-doc-reminder-time-row.is-selected')
      if (!list || !active) return
      const offset = active.offsetTop - list.clientHeight / 2 + active.offsetHeight / 2
      list.scrollTop = Math.max(0, offset)
    },
    /**
     * 浮层定位：低于 chip 所在行就往下放，下方放不下且上方更宽裕时翻到上方。
     * 02 §19.4 ④-bis 1 层：「定位完全靠 inline style 现算」—— 飞书也是这样，别指望 CSS 类。
     */
    reminderStyleAt(pos, height) {
      const coords = this.editor.view.coordsAtPos(pos)
      const box = height || POPOVER_HEIGHT
      const spaceBelow = window.innerHeight - coords.bottom - VIEWPORT_MARGIN
      const spaceAbove = coords.top - VIEWPORT_MARGIN
      const placeAbove = spaceBelow < box && spaceAbove > spaceBelow
      const rawTop = placeAbove ? coords.top - box - POPOVER_GAP : coords.bottom + POPOVER_GAP
      const widest = window.innerWidth - VIEWPORT_MARGIN * 2
      const width = Math.min(POPOVER_WIDTH, widest)
      const left = Math.max(VIEWPORT_MARGIN, Math.min(window.innerWidth - width - VIEWPORT_MARGIN, coords.left))
      const top = Math.max(VIEWPORT_MARGIN, Math.min(window.innerHeight - box - VIEWPORT_MARGIN, rawTop))
      return { left: `${left}px`, top: `${top}px` }
    },
    /** 落 DOM 后按真实高度重算一次（日历换月不会改高度，但首屏兜底 534 需要校正）。 */
    positionReminderPopover() {
      if (!this.reminderOpen || this.reminderFrom === null || !this.editor) return
      const root = this.$refs.root
      const popover = root ? root.querySelector('.lark-doc-reminder-popover') : null
      const height = popover ? popover.offsetHeight : POPOVER_HEIGHT
      this.reminderStyle = this.reminderStyleAt(this.reminderFrom, height)
    },
    positionReminderTimes() {
      if (!this.reminderTimesOpen) return
      const root = this.$refs.root
      const select = root ? root.querySelector('[data-reminder="time"]') : null
      if (!select) return
      const rect = select.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN
      const spaceAbove = rect.top - VIEWPORT_MARGIN
      const placeAbove = spaceBelow < TIMES_HEIGHT && spaceAbove > spaceBelow
      const rawTop = placeAbove ? rect.top - TIMES_HEIGHT - 4 : rect.bottom + 4
      const left = Math.max(VIEWPORT_MARGIN, Math.min(window.innerWidth - TIMES_WIDTH - VIEWPORT_MARGIN, rect.left))
      const top = Math.max(VIEWPORT_MARGIN, Math.min(window.innerHeight - TIMES_HEIGHT - VIEWPORT_MARGIN, rawTop))
      this.reminderTimesStyle = { left: `${left}px`, top: `${top}px` }
    },
    /**
     * 键盘接管（在命令菜单判定之前被 `commandMenuMixin.onEditorKeydown` 调起）。
     *
     * `Esc` 逐层收：先收时间下拉、再收浮层（浮层里的两层结构，一次 Esc 只走一层）。
     * 其余按键一律**先收浮层再放行** —— chip 的位置会随着输入漂移，`reminderFrom /
     * reminderTo` 立刻失效，继续拿它去改写就会改到别的文字上。
     */
    onReminderKeydown(event) {
      if (!this.reminderOpen) return false
      if (event.isComposing || (this.editor && this.editor.view.composing)) return false
      if (event.key === 'Escape') {
        event.preventDefault()
        if (this.reminderTimesOpen) {
          this.reminderTimesOpen = false
          return true
        }
        this.closeReminderPopover()
        return true
      }
      this.closeReminderPopover()
      return false
    },
  },
}
