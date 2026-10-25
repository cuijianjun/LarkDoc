<template>
  <div
    v-if="ed.calendarOpen"
    class="lark-doc-calendar-search"
    role="dialog"
    aria-label="插入日程"
    :style="ed.calendarStyle"
  >
    <div class="lark-doc-calendar-search-head">
      <span class="lark-doc-calendar-search-title">插入日程</span>
      <button
        type="button"
        class="lark-doc-calendar-search-close"
        aria-label="关闭"
        @mousedown.prevent="ed.closeCalendarSearch()"
      >
        <lark-doc-icon
          :size="14"
          name="close"
        />
      </button>
    </div>
    <!-- 🔴 这个输入框**没有聚焦态样式**：飞书实测点进去零视觉变化（无蓝框、无描边），
         已验 document.activeElement === input。别顺手补 :focus 描边。 -->
    <input
      ref="calendarInput"
      class="lark-doc-calendar-search-input"
      type="text"
      aria-label="搜索日程"
      placeholder="搜索日程"
      :value="ed.calendarQuery"
      @input="ed.onCalendarQueryInput"
      @keydown.down.prevent="ed.moveCalendarActive(1)"
      @keydown.up.prevent="ed.moveCalendarActive(-1)"
      @keydown.enter.prevent="ed.chooseCalendarEvent()"
      @blur="ed.onCalendarBlur()"
    >
    <div
      class="lark-doc-calendar-search-result"
      role="listbox"
      aria-label="日程搜索结果"
    >
      <!-- 行一律 @mousedown.prevent：不移焦点 ⇒ 不会先触发输入框 blur 把面板收掉，
           点一下就直接落卡片（02 §26 ⑤：点行即插，无二次确认）。 -->
      <button
        v-for="(item, index) in ed.calendarResults"
        :key="item.eventId"
        type="button"
        role="option"
        class="lark-doc-calendar-search-row"
        :class="{ 'is-active': index === ed.calendarActiveIndex }"
        :aria-selected="index === ed.calendarActiveIndex ? 'true' : 'false'"
        @mousedown.prevent="ed.chooseCalendarEvent(item)"
        @mouseenter="ed.setCalendarActive(index)"
      >
        <span
          class="lark-doc-calendar-icon"
          data-icon="calendar"
          aria-hidden="true"
        /><span class="lark-doc-calendar-search-name">{{ item.title }}</span>
      </button>
      <p
        v-if="!ed.calendarResults.length"
        class="lark-doc-calendar-search-empty"
      >
        {{ ed.calendarLoading ? '搜索中…' : '没有匹配的搜索结果' }}
      </p>
    </div>
  </div>
</template>

<script>
// CalendarSearchPanel —— 日程块「插入日程」搜索面板（P4-02b，规格见 requirements/02 §26）。
//
// 与 MentionPanel 的**唯一结构差异**：本面板带真输入框，需要自己拿焦点
// （mention 的关键词在正文 `@` 后面，面板全程不抢焦点）。焦点在 `watch` 里给 ——
// `startCalendarEvent()` 改完 `calendarOpen` 就返回，DOM 还没渲染。
//
// 🔴 三条实测负结论，别「补全」：
//   1. 面板里**没有**「新建日程」入口 —— 插入 ≠ 新建（02 §26 ⑨）。
//   2. `Esc` ×1、×2 都关不掉 ⇒ 本组件不绑 `Esc`，`calendarMixin` 也不拦（只有点外部）。
//   3. 空态文案是「没有匹配的搜索结果」，不是「暂时没有日程」之类的引导语。
export default {
  name: 'LarkDocCalendarSearchPanel',
  props: {
    ed: { type: Object, required: true },
  },
  watch: {
    'ed.calendarOpen'(open) {
      if (open) this.$nextTick(this.focusInput)
    },
  },
  methods: {
    focusInput() {
      const input = this.$refs.calendarInput
      if (!input || typeof input.focus !== 'function') return
      input.focus()
      // 光标压到末尾：飞书空输入时看不出差别，但「继续输入」的直觉在末尾比停在 0 更对。
      const end = input.value ? input.value.length : 0
      if (typeof input.setSelectionRange === 'function') input.setSelectionRange(end, end)
    },
  },
}
</script>
