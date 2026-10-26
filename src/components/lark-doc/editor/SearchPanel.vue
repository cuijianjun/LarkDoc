<template>
  <div
    v-if="ed.searchOpen && ed.featureEnabled('search')"
    class="lark-doc-fr"
    :class="{ 'is-replace': isReplace }"
    :style="panelStyle"
    role="search"
    aria-label="查找和替换"
  >
    <!-- Tab 行即拖拽把手（04 §3.2：整块 react-draggable）。点空白拖动、点 Tab 切页，
         两者都从 pointerdown 起算，位移小于 2px 时按「点击」处理。 -->
    <div
      class="lark-doc-fr-bar"
      role="tablist"
      aria-label="查找替换"
      @pointerdown="startDrag"
    >
      <button
        type="button"
        class="lark-doc-fr-tab"
        :class="{ 'is-active': !isReplace }"
        role="tab"
        :aria-selected="!isReplace"
        @click="ed.setSearchTab('find')"
      >
        查找
      </button><button
        type="button"
        class="lark-doc-fr-tab"
        :class="{ 'is-active': isReplace }"
        role="tab"
        :aria-selected="isReplace"
        @click="ed.setSearchTab('replace')"
      >
        替换
      </button><span
        class="lark-doc-fr-ink"
        aria-hidden="true"
      />
    </div>
    <div class="lark-doc-fr-pane">
      <div class="lark-doc-fr-field">
        <label
          v-if="isReplace"
          class="lark-doc-fr-label"
          for="lark-doc-fr-find"
        >查找</label>
        <div class="lark-doc-fr-input">
          <input
            id="lark-doc-fr-find"
            ref="searchInput"
            :value="ed.searchQuery"
            aria-label="查找内容"
            placeholder="在文档内查找"
            @input="ed.setSearchQuery($event.target.value); ed.updateSearch()"
            @keydown.enter.prevent="ed.nextMatch(1)"
          ><span class="lark-doc-fr-counter">{{ counterText }}</span>
        </div>
      </div>
      <div
        v-if="isReplace"
        class="lark-doc-fr-field"
      >
        <label
          class="lark-doc-fr-label"
          for="lark-doc-fr-replace"
        >替换为</label>
        <div class="lark-doc-fr-input">
          <input
            id="lark-doc-fr-replace"
            :value="ed.replacement"
            aria-label="替换为"
            placeholder="请输入文字"
            @input="ed.setReplacement($event.target.value)"
          >
        </div>
      </div>
      <div class="lark-doc-fr-actions">
        <button
          v-if="isReplace"
          type="button"
          class="lark-doc-fr-btn is-primary"
          :disabled="ed.effectiveReadonly || !ed.searchMatches.length"
          @click="ed.replace(true)"
        >
          全部替换
        </button><button
          v-if="isReplace"
          type="button"
          class="lark-doc-fr-btn"
          :disabled="ed.effectiveReadonly || !ed.searchMatches.length"
          @click="ed.replace(false)"
        >
          替换
        </button><button
          type="button"
          class="lark-doc-fr-btn"
          :disabled="!ed.searchMatches.length"
          @click="ed.nextMatch(-1)"
        >
          上一处
        </button><button
          type="button"
          class="lark-doc-fr-btn"
          :disabled="!ed.searchMatches.length"
          @click="ed.nextMatch(1)"
        >
          下一处
        </button>
      </div>
    </div>
    <button
      type="button"
      class="lark-doc-fr-close"
      aria-label="关闭查找"
      @click="ed.closeSearch"
    >
      <lark-doc-icon
        :size="20"
        name="close"
      />
    </button>
  </div>
</template>

<script>
/* SearchPanel —— 查找替换浮层（P4-05）。04 §3.2 实测：替换 Tab 406×286、查找 Tab 406×186、
   z-index 100、radius 8、border 一档常态一档禁用，右上角默认位、可拖拽。
   刻意不做 More / 区分大小写 / 全字匹配 / 正则 —— ④-3 实测飞书网页版没有这四项。

   父组件与 toolbarCollapseMixin 仍以 `$refs.searchInput.focus()` 聚焦输入框：父模板把
   ref 名 `searchInput` 挂在本组件实例上，这里转发 `focus()` 到真实 input，两处调用点零改动。 */
import LarkDocIcon from '../LarkDocIcon.vue'

const PANEL_WIDTH = 406

export default {
  name: 'LarkDocSearchPanel',
  components: { LarkDocIcon },
  props: {
    ed: { type: Object, required: true },
  },
  data() { return { drag: null } },
  computed: {
    isReplace() { return this.ed.searchTab === 'replace' },
    panelHeight() { return this.isReplace ? 286 : 186 },
    // 计数器格式 `N / M`（④-2：空态实测 `0 / 0`），左值是当前序号（1-based）。
    counterText() {
      const total = this.ed.searchMatches.length
      return `${total ? this.ed.searchIndex + 1 : 0} / ${total}`
    },
    panelStyle() {
      const style = { height: `${this.panelHeight}px` }
      const pos = this.ed.searchPanelPos
      if (pos) { style.left = `${pos.left}px`; style.top = `${pos.top}px` }
      return style
    },
  },
  mounted() { this.focus() },
  beforeDestroy() { this.endDrag() },
  methods: {
    focus() { const input = this.$refs.searchInput; if (input) input.focus() },
    startDrag(event) {
      if (event.button) return
      const rect = this.$el.getBoundingClientRect()
      this.drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top }
      window.addEventListener('pointermove', this.onDragMove)
      window.addEventListener('pointerup', this.endDrag)
    },
    onDragMove(event) {
      const drag = this.drag
      if (!drag) return
      const left = drag.left + event.clientX - drag.x
      const top = drag.top + event.clientY - drag.y
      // 只允许在视口内拖：面板整体不出界（含底部工具栏条的高度差）。
      this.ed.setSearchPanelPos({
        left: Math.min(Math.max(0, left), Math.max(0, window.innerWidth - PANEL_WIDTH)),
        top: Math.min(Math.max(0, top), Math.max(0, window.innerHeight - this.panelHeight)),
      })
    },
    endDrag() {
      if (!this.drag) return
      this.drag = null
      window.removeEventListener('pointermove', this.onDragMove)
      window.removeEventListener('pointerup', this.endDrag)
    },
  },
}
</script>
