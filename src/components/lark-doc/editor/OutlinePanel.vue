<template>
  <aside
    v-if="ed.outlineOpen && ed.featureEnabled('outline')"
    class="lark-doc-outline"
    aria-label="文档目录"
  >
    <div class="lark-doc-outline-heading">
      <strong>目录</strong><button
        type="button"
        aria-label="关闭目录"
        @click="ed.toggleOutlineOpen()"
      >
        <lark-doc-icon
          :size="14"
          name="close"
        />
      </button>
    </div><p v-if="!ed.outline.length">
      添加标题后自动生成目录
    </p><div
      v-for="item in ed.outlineItems"
      :key="item.pos"
      class="lark-doc-outline-item"
      :style="{ paddingLeft: `${Math.min(item.level - 1, 5) * 10}px` }"
    >
      <button
        v-if="item.hasChildren"
        type="button"
        :class="{ active: item.pos === ed.activeHeading }"
        :aria-label="`${item.collapsed ? '展开' : '收起'}目录：${item.text || '标题'}`"
        :aria-expanded="String(!item.collapsed)"
        :title="item.collapsed ? '展开目录' : '收起目录'"
        @click="ed.toggleOutline(item.pos)"
      >
        <span
          class="lark-doc-outline-arrow"
          :class="{ 'is-collapsed': item.collapsed }"
          aria-hidden="true"
        />
      </button><span
        v-else
        class="lark-doc-outline-toggle-placeholder"
        aria-hidden="true"
      />
      <button
        type="button"
        :class="{ active: item.pos === ed.activeHeading }"
        @click="ed.jumpHeading(item.pos)"
      >
        {{ item.text || '无标题' }}
      </button>
    </div>
  </aside>
</template>

<script>
// OutlinePanel —— 从 LarkDocEditor.vue 拆出的目录侧栏（P0-03 段 3/8）。
// 父组件里「展开目录」reopen 按钮与本组件是兄弟节点，受 Vue 2 单根约束留在父模板。
import LarkDocIcon from '../LarkDocIcon.vue'

export default {
  name: 'LarkDocOutlinePanel',
  components: { LarkDocIcon },
  props: {
    ed: { type: Object, required: true },
  },
}
</script>
