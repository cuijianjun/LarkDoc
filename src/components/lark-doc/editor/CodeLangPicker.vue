<template>
  <!-- 代码语言选择器（04 §2.2 ④ 实测：浮层 **219×317**，z **1030**）。
       高度构成：搜索区 41 + 列表可视 274 + 上下边框 2 = 317（列表内容 71×36=2556 溢出走滚动）。
       ⚠️ 旧记「219×771」是层级错位测得的列表内容高度，**已作废**，别照它写。

       当前项的表现是**文字变蓝、无底色、无勾选图标**（§2.2 ④ 状态色，色值走
       `--ld-brand-content` 而不是字面色 —— check-theme-tokens 禁止组件里新增字面 hex），
       与色板那种「2px 边框」的选中态是两套，不要混用。 -->
  <div
    v-if="ed.codeLangOpen"
    class="lark-doc-code-lang"
    :style="ed.codeLangStyle"
    role="dialog"
    aria-label="代码语言"
  >
    <div class="lark-doc-code-lang-card">
      <div class="lark-doc-code-lang-search">
        <LarkDocIcon
          name="search"
          :size="14"
          class="lark-doc-code-lang-search-icon"
        /><input
          ref="codeLangInput"
          :value="ed.codeLangQuery"
          class="lark-doc-code-lang-search-input"
          type="text"
          placeholder="搜索语言"
          aria-label="搜索代码语言"
          @input="ed.setCodeLangQuery($event.target.value)"
          @keydown.down.prevent="move(1)"
          @keydown.up.prevent="move(-1)"
          @keydown.enter.prevent="choose()"
        >
      </div>
      <!-- 滚动容器：自绘滚动条，不占布局宽度（§2.2 ③）。 -->
      <div class="lark-doc-code-lang-list-container">
        <ul
          class="lark-doc-code-lang-list"
          role="listbox"
          aria-label="代码语言列表"
        >
          <li
            v-for="(item, index) in ed.codeLangItems"
            :key="item.id"
            class="lark-doc-code-lang-item"
            :class="{ 'is-active': item.label === ed.codeLangValue, 'is-cursor': index === cursor }"
            role="option"
            :aria-selected="item.label === ed.codeLangValue ? 'true' : 'false'"
            @mouseenter="cursor = index"
            @click="ed.pickCodeLanguage(item.id)"
          >
            <span class="lark-doc-code-lang-text">{{ item.label }}</span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script>
// CodeLangPicker —— 代码语言选择器（fixed 浮层，挂在 `LarkDocOverlays.vue`）。
//
// 唯一的本地状态是键盘游标 `cursor`（↑↓/Enter），它只影响 hover 高亮预览，
// 不参与「当前选中的语言」判定 —— 后者看 `ed.codeLangValue`。
import LarkDocIcon from '../LarkDocIcon.vue'

export default {
  name: 'LarkDocCodeLangPicker',
  components: { LarkDocIcon },
  props: {
    ed: { type: Object, required: true },
  },
  data() {
    return { cursor: 0 }
  },
  watch: {
    // 每次打开都把光标复位到列表头，并聚焦搜索框（真机的输入框是自动聚焦的）。
    'ed.codeLangOpen'(open) {
      if (!open) return
      this.cursor = 0
      this.$nextTick(() => {
        const input = this.$refs && this.$refs.codeLangInput
        if (input && typeof input.focus === 'function') input.focus()
      })
    },
    // 过滤后列表变短，越界的游标要拉回来，否则 Enter 会选中看不见的项。
    'ed.codeLangQuery'() {
      this.cursor = 0
    },
  },
  methods: {
    move(step) {
      const total = this.ed.codeLangItems.length
      if (!total) return
      this.cursor = (this.cursor + step + total) % total
    },
    choose() {
      const item = this.ed.codeLangItems[this.cursor]
      if (item) this.ed.pickCodeLanguage(item.id)
    },
  },
}
</script>
