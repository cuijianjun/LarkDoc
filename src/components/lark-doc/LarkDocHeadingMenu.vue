<template>
  <div
    class="lark-doc-dropdown lark-doc-heading-menu"
    role="menu"
    :aria-label="ariaLabel"
    @mouseenter="$emit('keep-open')"
    @mouseleave="$emit('schedule-close')"
  >
    <button
      v-for="option in options"
      :key="`heading-${option.level === null ? 'paragraph' : option.level}`"
      type="button"
      role="menuitem"
      :class="{ 'lark-doc-menu-active': option.level === activeLevel }"
      :aria-checked="option.level === activeLevel ? 'true' : 'false'"
      @mousedown.prevent
      @click="$emit('choose', option.level)"
    >
      <span
        class="lark-doc-heading-glyph"
        aria-hidden="true"
      >{{ option.glyph }}</span>{{ option.label }}<span
        v-if="option.level === activeLevel"
        class="lark-doc-menu-check"
        aria-hidden="true"
      >✓</span>
    </button>
  </div>
</template>

<script>
/**
 * 标题级别下拉（正文 + 一~九级标题）——工具栏与划词气泡条共用的同一份实现。
 *
 * 飞书里这两处是同一个功能的两个入口，观感必须一致：宽 155、内边距 5、
 * 圆角 9、行高 30、选中项「浅绿底 + 深绿字 + 右侧勾」。把菜单收在这里，
 * 两边只负责「打开/定位/选中后干什么」，避免像以前那样各写一套 152px/32px/蓝色
 * 的私有样式再慢慢分叉。
 *
 * 纯受控组件：开关与定位由父级决定（工具栏用 headingOpen/<dropdown 定位>，
 * 气泡条那一支已原生化到 `src/ui/headingMenu.js`），本组件只渲染与透传事件。
 * 两边**共用同一份选项表** `HEADING_MENU_OPTIONS` —— 菜单项文字/级别只写一次。
 */
import { HEADING_MENU_OPTIONS } from '../../ui/headingMenu'

export default {
  name: 'LarkDocHeadingMenu',
  props: {
    // 当前块的标题级别：null = 正文，1~9 = H1~H9。
    activeLevel: { type: Number, default: null },
    ariaLabel: { type: String, default: '标题级别' },
  },
  data() { return { options: HEADING_MENU_OPTIONS } },
}
</script>
