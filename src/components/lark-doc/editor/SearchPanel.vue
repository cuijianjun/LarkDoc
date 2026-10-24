<template>
  <div
    v-if="ed.searchOpen && ed.featureEnabled('search')"
    class="lark-doc-search"
    role="search"
  >
    <input
      ref="searchInput"
      :value="ed.searchQuery"
      aria-label="查找内容"
      placeholder="查找文档"
      @input="ed.setSearchQuery($event.target.value); ed.updateSearch()"
      @keydown.enter.prevent="ed.nextMatch(1)"
    ><span>{{ ed.searchMatches.length ? `${ed.searchIndex + 1}/${ed.searchMatches.length}` : (ed.searchQuery ? '无结果' : '输入关键词') }}</span><button
      type="button"
      aria-label="上一处"
      :disabled="!ed.searchMatches.length"
      @click="ed.nextMatch(-1)"
    >
      ↑
    </button><button
      type="button"
      aria-label="下一处"
      :disabled="!ed.searchMatches.length"
      @click="ed.nextMatch(1)"
    >
      ↓
    </button><input
      :value="ed.replacement"
      aria-label="替换为"
      placeholder="替换为"
      @input="ed.setReplacement($event.target.value)"
    ><button
      type="button"
      :disabled="ed.effectiveReadonly || !ed.searchMatches.length"
      @click="ed.replace(false)"
    >
      替换
    </button><button
      type="button"
      :disabled="ed.effectiveReadonly || !ed.searchMatches.length"
      @click="ed.replace(true)"
    >
      全部替换
    </button><button
      type="button"
      aria-label="关闭查找"
      @click="ed.closeSearch"
    >
      <lark-doc-icon
        :size="14"
        name="close"
      />
    </button>
  </div>
</template>

<script>
// SearchPanel —— 从 LarkDocEditor.vue 拆出的查找替换面板（P0-03 段 2/8 附属根）。
// 父组件与 toolbarCollapseMixin 仍以 `$refs.searchInput.focus()` 聚焦输入框：
// 父模板把 ref 名 `searchInput` 挂在本组件实例上，这里转发 `focus()` 到真实
// input，两处调用点零改动。v-if 挂载时主动聚焦一次，与按钮点击路径行为一致。
import LarkDocIcon from '../LarkDocIcon.vue'

export default {
  name: 'LarkDocSearchPanel',
  components: { LarkDocIcon },
  props: {
    ed: { type: Object, required: true },
  },
  mounted() { this.focus() },
  methods: {
    focus() { this.$refs.searchInput?.focus() },
  },
}
</script>
