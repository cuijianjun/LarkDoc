<template>
  <span
    class="feishu-select"
    :class="{ 'feishu-select-open': open }"
  >
    <button
      :id="buttonId"
      ref="trigger"
      type="button"
      class="feishu-select-trigger"
      role="combobox"
      :aria-label="ariaLabel"
      :title="title || ariaLabel"
      :aria-expanded="open ? 'true' : 'false'"
      aria-haspopup="listbox"
      :disabled="disabled"
      @mousedown.prevent
      @mouseenter="onTriggerEnter"
      @mouseleave="onTriggerLeave"
      @click="toggle"
      @keydown.down.prevent="moveHighlight(1)"
      @keydown.up.prevent="moveHighlight(-1)"
      @keydown.enter.prevent="commitHighlight"
      @keydown.esc.stop="close"
    >
      <span class="feishu-select-label">{{ currentLabel }}</span><feishu-icon
        class="feishu-select-caret"
        :size="12"
        name="chevronDown"
      />
    </button>
    <div
      v-if="open"
      ref="menu"
      class="feishu-select-menu"
      role="listbox"
      :aria-label="ariaLabel"
      :style="menuStyle"
      @mouseenter="onMenuEnter"
      @mouseleave="onMenuLeave"
    >
      <button
        v-for="(item, index) in options"
        :key="String(item.value)"
        type="button"
        role="option"
        :class="{ 'feishu-select-active': item.value === value, 'is-highlight': index === highlightIndex }"
        :aria-selected="item.value === value ? 'true' : 'false'"
        @mousedown.prevent
        @click="choose(item.value)"
        @mouseenter="highlightIndex = index"
      >
        <span
          class="feishu-select-check"
          aria-hidden="true"
        >{{ item.value === value ? '✓' : '' }}</span>
        <span>{{ item.label }}</span>
      </button>
    </div>
  </span>
</template>

<script>
/**
 * 共享下拉原语：替代原生 <select> 的自绘下拉（触发按钮 + fixed 定位选项列表）。
 * - mousedown.prevent 保持编辑器选区不丢（与工具栏其他按钮一致）；
 * - 键盘：↑↓ 移动高亮、Enter 确认、Esc 关闭；点击外部自动关闭；滚动/窗口尺寸变化时重新定位；
 * - 支持 v-model（model: change）；value 未命中 options 时显示 placeholder；
 * - 选项 value 支持字符串与数字（如字数上限的 0/200）。
 */
import FeishuIcon from './FeishuIcon'

export default {
  name: 'FeishuSelect',
  components: { FeishuIcon },
  model: { prop: 'value', event: 'change' },
  props: {
    value: { type: [String, Number], default: '' },
    options: { type: Array, default: () => [] },
    disabled: { type: Boolean, default: false },
    ariaLabel: { type: String, required: true },
    title: { type: String, default: '' },
    // value 不在 options 中时的展示文案（如代码块的自定义语言名）。
    placeholder: { type: String, default: '' },
    buttonId: { type: String, default: '' },
  },
  data() {
    return { open: false, menuStyle: null, highlightIndex: 0, hoverTimer: null }
  },
  computed: {
    currentLabel() {
      const hit = this.options.find((item) => item.value === this.value)
      if (hit) return hit.label
      return this.placeholder || (this.options[0] && this.options[0].label) || ''
    },
  },
  beforeDestroy() { clearTimeout(this.hoverTimer); this.teardown() },
  methods: {
    /** 飞书式 hover 弹窗：悬停触发按钮即打开（不抢编辑器焦点），离开触发按钮/弹层后延迟关闭。 */
    onTriggerEnter() {
      if (this.disabled) return
      clearTimeout(this.hoverTimer)
      if (!this.open) { this._hoverOpened = true; this.openMenu() }
    },
    onTriggerLeave() { this.scheduleHoverClose() },
    onMenuEnter() { clearTimeout(this.hoverTimer); this.hoverTimer = null },
    onMenuLeave() { this.scheduleHoverClose() },
    scheduleHoverClose() {
      clearTimeout(this.hoverTimer)
      this.hoverTimer = setTimeout(() => { this.hoverTimer = null; this._hoverOpened = false; if (this.open) this.close() }, 150)
    },
    openMenu() {
      this.open = true
      const current = this.options.findIndex((item) => item.value === this.value)
      this.highlightIndex = current === -1 ? 0 : current
      this.position()
      document.addEventListener('pointerdown', this.onOutside, true)
      window.addEventListener('scroll', this.position, true)
      window.addEventListener('resize', this.position)
    },
    toggle() {
      if (this.disabled) return
      // hover 已打开时点击不关闭（飞书行为：hover 弹窗靠移开鼠标关闭）。
      if (this.open && this._hoverOpened) return
      if (this.open) { this.close(); return }
      this.openMenu()
      // mousedown.prevent 拦掉了原生聚焦，键盘导航（↑↓/Enter）需要焦点在触发按钮上；hover 打开不聚焦。
      this.$refs.trigger.focus()
    },
    position() {
      const rect = this.$refs.trigger.getBoundingClientRect()
      this.menuStyle = {
        left: `${Math.max(8, rect.left)}px`,
        top: `${rect.bottom + 4}px`,
        minWidth: `${Math.max(rect.width, 132)}px`,
      }
      // 下方放不下时翻转到触发按钮上方。
      this.$nextTick(() => {
        const menu = this.$refs.menu
        if (!menu) return
        const height = menu.offsetHeight
        if (rect.bottom + height + 8 > window.innerHeight && rect.top - height - 4 >= 0) {
          this.menuStyle = { ...this.menuStyle, top: `${rect.top - height - 4}px` }
        }
      })
    },
    close() {
      if (!this.open) return
      this.open = false
      this.menuStyle = null
      this.teardown()
    },
    teardown() {
      document.removeEventListener('pointerdown', this.onOutside, true)
      window.removeEventListener('scroll', this.position, true)
      window.removeEventListener('resize', this.position)
    },
    onOutside(event) {
      if (!this.$el.contains(event.target)) this.close()
    },
    choose(value) {
      if (value !== this.value) this.$emit('change', value)
      this.close()
    },
    moveHighlight(delta) {
      if (!this.open) {
        this.toggle()
        return
      }
      const total = this.options.length
      if (!total) return
      this.highlightIndex = (this.highlightIndex + delta + total) % total
    },
    commitHighlight() {
      if (!this.open) {
        this.toggle()
        return
      }
      const item = this.options[this.highlightIndex]
      if (item) this.choose(item.value)
    },
  },
}
</script>
