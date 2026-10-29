<template>
  <div
    class="lark-doc-help-fab-wrap"
    @mouseenter="showMenu"
    @mouseleave="hideLater"
  >
    <!-- 04 §3.5：右下角 `?` 圆钮 36×36、radius 50%、shadow = rgba(31,35,41,.08) 0 6px 12px 0
         （06 §3 的 --shadow-fab，库里已映射为 --ld-shadow-tooltip）；层级 60（06 六档体系第 1 档）。 -->
    <button
      type="button"
      class="lark-doc-help-fab"
      aria-label="帮助"
      aria-haspopup="menu"
      :aria-expanded="menuOpen ? 'true' : 'false'"
      @click="toggleMenu"
      @focus="showMenu"
    >
      ?
    </button>
    <div
      v-if="menuOpen"
      class="lark-doc-help-menu"
      role="menu"
      aria-label="帮助菜单"
      @mouseenter="cancelHide"
      @mouseleave="hideLater"
    >
      <button
        v-for="item in items"
        :key="item.id"
        type="button"
        role="menuitem"
        class="lark-doc-help-menu-item"
        @click="run(item)"
      >
        <lark-doc-icon
          :size="16"
          :name="item.icon"
        /><span>{{ item.label }}</span>
      </button>
    </div>
  </div>
</template>

<script>
import LarkDocIcon from '../LarkDocIcon.vue'
import { HELP_MENU_ITEMS } from '../../../ui/shortcutGroups'

export default {
  name: 'HelpFab',
  components: { LarkDocIcon },
  props: {
    ed: { type: Object, required: true },
  },
  data() {
    return { menuOpen: false, items: HELP_MENU_ITEMS, timer: null }
  },
  beforeDestroy() {
    this.cancelHide()
  },
  methods: {
    showMenu() {
      this.cancelHide()
      this.menuOpen = true
    },
    // 菜单在圆钮上方 12px 处，鼠标越过缝隙会先离开圆钮 —— 160ms 抖动窗口内不关，
    // 与二级子菜单同口径（07 §9：二级子菜单「移开 160ms」）。
    hideLater() {
      this.cancelHide()
      this.timer = setTimeout(() => { this.menuOpen = false; this.timer = null }, 160)
    },
    cancelHide() {
      if (this.timer) { clearTimeout(this.timer); this.timer = null }
    },
    toggleMenu() {
      if (this.menuOpen) { this.cancelHide(); this.menuOpen = false } else { this.showMenu() }
    },
    run(item) {
      this.cancelHide()
      this.menuOpen = false
      // 5 项里只有「快捷键」在本项目有落点；其余是飞书的外部服务入口，
      // 复刻范围内没有对应页面，点了就只收起菜单（不伪造跳转、不弹空态）。
      if (item.id === 'shortcuts') this.ed.toggleHelpOpen()
    },
  },
}
</script>
