/**
 * 行内日期提醒 mark `reminder`（P4-02a）—— requirements/02 §19.4。
 *
 * 飞书的日期提醒是 **mark，不是 node**（02 §19.4 ⑥ 给的 JSON 就是
 * `type:'text'` + `marks:[{type:'reminder'}]`，`text` 直接是 chip 文案）：
 *
 *   { type: 'text', marks: [{ type: 'reminder' }],
 *     attrs: { remindAt: '2026-10-26T13:00:00+08:00', notify: true, repeat: 'none' },
 *     text: '明天 13:00' }
 *
 * 三个必须守住的口径（改之前先读 02 §19.4 ②-bis / ⑤）：
 *   1. **`remindAt` 是唯一真相**，chip 文案由它派生（`reminderLabel`）。存文案不存时间
 *      会在跨天后说瞎话，所以文案永远现算。
 *   2. **chip 与块级蒙层共存亡**。蒙层不是节点，是 `document-decorations.js` 给「含
 *      reminder mark 的文本块」打的一层 `Decoration.node` —— mark 一没 decoration 就
 *      跟着没，天然同生同死。飞书「删同生、撤不同死」的 bug 因此复刻不出来（V1 不复刻）。
 *   3. **`inclusive: false`**：否则 chip 后面接着打字会继续沿用 mark，整段变橙。
 *
 * 三条负结论（别实现）：
 *   - 「`!日期错误` 失败态」在真飞书里不存在（02 §19.4 ④-quater 已证伪，允许设到过去）。
 *   - 「撤销只回 chip 不回蒙层」是飞书 bug，V1 不复刻。
 *   - `notify === false` 时飞书只摘 `should-notify` 类，**没给替换色**，所以这里也只落
 *     `data-notify="false"`，不自造一个"已静音"的灰色（不新造实测色值）。
 */
import { Mark, mergeAttributes } from '@tiptap/core'

/** 重复规则枚举（02 §19.4 ⑥「事件发生时」）。 */
export const REMINDER_REPEATS = Object.freeze(['none', 'daily', 'weekly', 'monthly'])

/** 重复规则 → 浮层选项文案。 */
export const REMINDER_REPEAT_LABELS = Object.freeze({ none: '不重复', daily: '每天', weekly: '每周', monthly: '每月' })

/**
 * `remindAt` 的合法形状：ISO 8601 **必须带时区**（`Z` 或 `±HH:mm`）。
 *
 * 要求带时区是为了让「同一时刻」在跨时区协作里不产生歧义 —— 裸 `2026-10-26T13:00`
 * 会被各端按本地时区各解释一遍。空串单独放行：那是 schema 默认值（见 `addAttributes`），
 * 也是「mark 存在但时间缺失」的合法态，落库再打开不能炸。
 */
export const REMINDER_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/

/** 默认提醒偏移 = +24h（02 §19.4 ② 实测：batch373 `@13:xx` → 「明天 13:00」）。 */
const REMINDER_DEFAULT_OFFSET_MS = 24 * 60 * 60 * 1000

const DAY_MS = 24 * 60 * 60 * 1000

/** `getDay()` 序号 → 「周X」；飞书用「周日」不用「星期天」。 */
const WEEKDAY_LABELS = Object.freeze(['周日', '周一', '周二', '周三', '周四', '周五', '周六'])

function pad2(value) {
  return value < 10 ? `0${value}` : String(value)
}

/** 宽松转 Date：接受 Date / 时间戳 / ISO 串；不可解析一律 null（不抛）。 */
function toDate(value) {
  if (!value) return null
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** 本地零点时间戳 —— 「今天/明天」按用户本地日历算，不按 UTC 差 24h 算。 */
function startOfLocalDay(date) {
  const copy = new Date(date.getTime())
  copy.setHours(0, 0, 0, 0)
  return copy.getTime()
}

/**
 * 默认提醒时间：当前时刻 +24h，且**分钟归零**。
 *
 * 输出 `toISOString()`（UTC `Z`）而不是拼本地 `+08:00`：两者是同一时刻，UTC 形式
 * 不受宿主时区影响、逐字节可比较；用户看到的分档（今天/明天/周X）仍由
 * `reminderLabel` 按本地日历现算，不受影响。
 */
export function createDefaultRemindAt(now) {
  const base = toDate(now) || new Date()
  const next = new Date(base.getTime() + REMINDER_DEFAULT_OFFSET_MS)
  next.setMinutes(0, 0, 0)
  return next.toISOString()
}

/**
 * chip 文案派生（02 §19.4 ⑥ 末行）：同日 → `今天 HH:mm`；次日 → `明天 HH:mm`；
 * 7 日内 → `周X HH:mm`；更远（含过去）→ `M月D日 HH:mm`。
 *
 * 过去的时间点走最后一档具体日期：飞书允许设到过去且不警告（④-quater），
 * 这里既不拦也不特殊化成「昨天」—— 具体日期在「已过期」场景下信息量更大。
 */
export function reminderLabel(remindAt, now) {
  const target = toDate(remindAt)
  if (!target) return ''
  const base = toDate(now) || new Date()
  const dayDiff = Math.round((startOfLocalDay(target) - startOfLocalDay(base)) / DAY_MS)
  // 用本地时分（不是 remindAt 串里的时分）：串可能带任意时区，显示的必须是"我这边的几点"。
  const clock = `${pad2(target.getHours())}:${pad2(target.getMinutes())}`
  if (dayDiff === 0) return `今天 ${clock}`
  if (dayDiff === 1) return `明天 ${clock}`
  if (dayDiff > 1 && dayDiff < 7) return `${WEEKDAY_LABELS[target.getDay()]} ${clock}`
  return `${target.getMonth() + 1}月${target.getDate()}日 ${clock}`
}

/** 收口一份提醒属性（写入前必过）：缺时间就补默认值，枚举越界就落 `none`。 */
export function normalizeReminder(input) {
  const source = input && typeof input === 'object' ? input : {}
  const raw = source.remindAt === null || source.remindAt === undefined ? '' : String(source.remindAt)
  return {
    remindAt: REMINDER_AT_PATTERN.test(raw) ? raw : createDefaultRemindAt(),
    notify: source.notify === undefined || source.notify === null ? true : Boolean(source.notify),
    repeat: REMINDER_REPEATS.indexOf(source.repeat) === -1 ? 'none' : source.repeat,
  }
}

/** 从 mark 读回一份干净的提醒属性；不是 reminder mark 时返回 null。 */
export function readReminder(mark) {
  if (!mark || !mark.type || mark.type.name !== 'reminder') return null
  const attrs = mark.attrs || {}
  const raw = attrs.remindAt === null || attrs.remindAt === undefined ? '' : String(attrs.remindAt)
  return {
    remindAt: raw,
    notify: attrs.notify !== false,
    repeat: REMINDER_REPEATS.indexOf(attrs.repeat) === -1 ? 'none' : attrs.repeat,
  }
}

/** chip 文案的便捷入口：给属性、给「现在」，直接得文案。 */
export function reminderText(attrs, now) {
  const source = attrs && typeof attrs === 'object' ? attrs : {}
  const raw = source.remindAt === null || source.remindAt === undefined ? '' : String(source.remindAt)
  return reminderLabel(raw, now)
}

const LarkDocReminder = Mark.create({
  name: 'reminder',
  // chip 后面接着打字不能继续挂在 mark 上（否则整段变成提醒色）。
  inclusive: false,
  addAttributes() {
    return {
      remindAt: {
        // 空串是合法默认值（`validateAttrs` 对空串放行），真正的时间由
        // `normalizeReminder` 在插入时补 —— schema 建表期不能调 `new Date()`。
        default: '',
        parseHTML: (element) => element.getAttribute('data-remind-at') || '',
        renderHTML: (attrs) => ({ 'data-remind-at': String(attrs.remindAt || '') }),
      },
      notify: {
        default: true,
        parseHTML: (element) => element.getAttribute('data-notify') !== 'false',
        renderHTML: (attrs) => ({ 'data-notify': attrs.notify === false ? 'false' : 'true' }),
      },
      repeat: {
        default: 'none',
        parseHTML: (element) => (REMINDER_REPEATS.indexOf(element.getAttribute('data-repeat')) === -1 ? 'none' : element.getAttribute('data-repeat')),
        renderHTML: (attrs) => ({ 'data-repeat': REMINDER_REPEATS.indexOf(attrs.repeat) === -1 ? 'none' : attrs.repeat }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-type="reminder"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    // 只有一层：chip 的 18px 左内边距就是日历图标位（02 §19.4 ④），图标由 CSS
    // ::before 画，不占 DOM —— 多一层壳在这里没有排版价值（与 mention 的两层不同：
    // 那边前后各 5px 间隙需要一个不染色的外层）。
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'reminder', class: 'lark-doc-reminder-chip' }), 0]
  },
  addCommands() {
    return {
      /**
       * 就地写入/更新一个提醒 chip：**文本一起换**。
       *
       * chip 的可见文字就是文案（mark 不渲染内容），所以不能只 `setMark` ——
       * 那会把用户选中的原文字留着、套上一层橙色。这里直接 `insertContent`
       * 一段带 mark 的文本，选区被替换成 chip 文案。
       */
      setReminder: (attrs) => ({ commands }) => {
        // 先 normalize 再派生文案：文案必须和真正落库的 `remindAt` 一致，
        // 顺序反了就会出现「chip 写明天、attrs 存后天」。
        const normalized = normalizeReminder(attrs)
        const text = reminderLabel(normalized.remindAt)
        if (!text) return false
        return commands.insertContent({
          type: 'text',
          text,
          marks: [{ type: this.name, attrs: normalized }],
        })
      },
      unsetReminder: () => ({ commands }) => commands.unsetMark(this.name),
    }
  },
})

export { LarkDocReminder }
