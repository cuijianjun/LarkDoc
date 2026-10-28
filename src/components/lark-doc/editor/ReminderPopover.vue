<template>
  <!-- 🔴 这层包裹只为 Vue 2 的「单根节点」约束存在：浮层壳与时间下拉必须是**兄弟**
       （下拉若挂在 `.lark-doc-reminder-body` 里，会被它的 animation transform 改写
       `position: fixed` 的包含块而漂走）。包裹层本身**不能有 transform / filter /
       overflow / 非 static 定位**，否则同样会劫持 fixed。子节点全是 fixed，故它高度恒为 0。 -->
  <div class="lark-doc-reminder-layer">
    <div
      v-if="ed.reminderOpen"
      class="lark-doc-reminder-popover"
      role="dialog"
      aria-label="日期提醒"
      :style="ed.reminderStyle"
    >
      <div class="lark-doc-reminder-body">
        <div class="lark-doc-reminder-calendar">
          <div class="lark-doc-reminder-calendar-head">
            <span class="lark-doc-reminder-calendar-title">{{ ed.reminderViewTitle }}</span>
            <span class="lark-doc-reminder-calendar-nav">
              <button
                type="button"
                aria-label="上个月"
                @mousedown.prevent="ed.shiftReminderMonth(-1)"
              >
                ‹
              </button>
              <button
                type="button"
                aria-label="下个月"
                @mousedown.prevent="ed.shiftReminderMonth(1)"
              >
                ›
              </button>
            </span>
          </div>
          <div
            class="lark-doc-reminder-week"
            aria-hidden="true"
          >
            <span
              v-for="day in ed.reminderWeekdays"
              :key="day"
            >{{ day }}</span>
          </div>
          <!-- 42 格：前后月补白格在飞书里「点了连校验都不跑」（02 §19.4 ④-ter ②），
               这里直接 disabled —— 视觉上更淡，行为上一致。 -->
          <div
            class="lark-doc-reminder-days"
            role="grid"
          >
            <button
              v-for="cell in ed.reminderCells"
              :key="cell.key"
              type="button"
              role="gridcell"
              class="lark-doc-reminder-day"
              :class="{ 'is-outside': cell.outside, 'is-selected': cell.selected, 'is-today': cell.today }"
              :disabled="cell.outside"
              :aria-selected="cell.selected ? 'true' : 'false'"
              :aria-label="`${cell.year}年${cell.month + 1}月${cell.day}日`"
              @mousedown.prevent="ed.chooseReminderDay(cell)"
            >
              {{ cell.day }}
            </button>
          </div>
        </div>
        <!-- 选项组：左右内边距 24（日历是 16，飞书两处刻意不统一，别合并）。 -->
        <div class="lark-doc-reminder-options">
          <div class="lark-doc-reminder-row is-time">
            <span class="lark-doc-reminder-label">设置时间</span>
            <button
              type="button"
              class="lark-doc-reminder-select"
              data-reminder="time"
              aria-label="设置时间"
              :aria-expanded="ed.reminderTimesOpen ? 'true' : 'false'"
              @mousedown.prevent="ed.toggleReminderTimes()"
            >
              <span>{{ ed.reminderSelectedTime }}</span><span
                class="lark-doc-reminder-select-caret"
                aria-hidden="true"
              >▾</span>
            </button>
          </div>
          <div class="lark-doc-reminder-row is-repeat">
            <span class="lark-doc-reminder-label">提醒</span>
            <!-- 🔴 这一格在真飞书里是 `readOnly`（02 §19.4 ④-bis 5″：只读展示「事件发生时」），
                 不是可编辑下拉。别把它做成第二个下拉 —— 没有实测依据。 -->
            <button
              type="button"
              class="lark-doc-reminder-select"
              data-reminder="repeat"
              aria-label="提醒"
              disabled
            >
              <span>{{ ed.reminderRepeatText }}</span>
            </button>
          </div>
        </div>
        <p
          v-if="ed.reminderUser"
          class="lark-doc-reminder-user"
        >
          提醒：{{ ed.reminderUser }}
        </p>
      </div>
    </div>
    <div
      v-if="ed.reminderOpen && ed.reminderTimesOpen"
      class="lark-doc-reminder-times"
      role="listbox"
      aria-label="提醒时间"
      :style="ed.reminderTimesStyle"
    >
      <!-- 选中与悬停**同底色**（04-quinquies 实测飞书就是没区分），别加高亮。 -->
      <button
        v-for="slot in ed.reminderTimeOptions"
        :key="slot"
        type="button"
        role="option"
        class="lark-doc-reminder-time-row"
        :class="{ 'is-selected': slot === ed.reminderSelectedTime }"
        :aria-selected="slot === ed.reminderSelectedTime ? 'true' : 'false'"
        @mousedown.prevent="ed.chooseReminderTime(slot)"
      >
        {{ slot }}
      </button>
    </div>
  </div>
</template>

<script>
// ReminderPopover —— 日期提醒的日历浮层（P4-02a，规格见 requirements/02 §19.4 与 04-bis/04-ter/04-quinquies）。
//
// 与 MentionPanel 同一范式：父组件传 `:ed="self"`，本组件只渲染，状态与方法全在
// `reminderMixin.js` 里。浮层内的控件一律 `@mousedown.prevent`：不让按钮夺走编辑器焦点，
// 这样 `onEditorKeydown` → `onReminderKeydown` 的 Esc 逐层收、以及「打字先收浮层」都还能生效。
//
// 三段结构对应飞书实测的三层：壳（280×534，padding 5/10）→ 体（280×519，3px 圆角 + 1px 描边）
// → 日历区（pad 16）+ 选项组（pad 24，带上边框）。时间下拉是**壳的兄弟节点**（fixed 叠在
// z-index 47），不是体的子节点 —— 否则会被体的 `overflow`/动画变换裁掉。
export default {
  name: 'LarkDocReminderPopover',
  props: {
    ed: { type: Object, required: true },
  },
}
</script>
