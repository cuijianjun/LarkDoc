<template>
  <div
    v-if="ed.helpOpen"
    class="lark-doc-dialog-backdrop"
    @click.self="ed.closeOverlay"
  >
    <section
      class="lark-doc-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="快捷键帮助"
    >
      <header>
        <strong>快捷键</strong><button
          type="button"
          aria-label="关闭快捷键帮助"
          @click="ed.closeOverlay"
        >
          <lark-doc-icon
            :size="14"
            name="close"
          />
        </button>
      </header><p>⌘/Ctrl+B 加粗 · ⌘/Ctrl+I 斜体 · ⌘/Ctrl+Z 撤销</p><p>行首或空格后输入 / 插入内容；Tab 调整列表层级或段落缩进，Shift+Tab 减少缩进。</p>
    </section>
  </div>
</template>

<script>
import LarkDocIcon from '../../LarkDocIcon.vue'

export default {
  name: 'HelpDialog',
  components: { LarkDocIcon },
  props: {
    ed: { type: Object, required: true },
  },
}
</script>
