<template>
  <div
    v-if="ed.linkDialog"
    class="lark-doc-dialog-backdrop"
    @click.self="ed.closeOverlay"
  >
    <section
      class="lark-doc-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="设置链接"
      @keydown.esc.stop.prevent="ed.closeOverlay"
    >
      <header>
        <strong>设置链接</strong><button
          type="button"
          aria-label="关闭链接设置"
          @click="ed.closeOverlay"
        >
          <lark-doc-icon
            :size="14"
            name="close"
          />
        </button>
      </header>
      <label v-if="ed.linkInsertMode">链接文本 <input
        ref="linkTextInput"
        :value="ed.linkText"
        aria-label="链接文本"
        placeholder="输入链接显示文字"
        @input="ed.setLinkText($event.target.value)"
        @keydown.enter.prevent="ed.applyLink"
      ></label>
      <label>链接地址 <input
        ref="linkInput"
        :value="ed.linkValue"
        aria-label="链接地址"
        placeholder="https://example.com"
        @input="ed.setLinkValue($event.target.value)"
        @keydown.enter.prevent="ed.applyLink"
      ></label>
      <p v-if="ed.linkInsertMode">
        输入显示文字和地址后插入本地链接；
      </p><p>
        仅允许 http、https、mailto、tel 或 # 锚点链接；取消不会改变选区。
      </p>
      <button
        type="button"
        :disabled="!ed.linkValue || (ed.linkInsertMode && !ed.linkText.trim())"
        @click="ed.applyLink"
      >
        应用链接
      </button><button
        type="button"
        :disabled="ed.linkInsertMode || !ed.isActive('link')"
        @click="ed.removeLink"
      >
        解除链接
      </button>
    </section>
  </div>
</template>

<script>
import LarkDocIcon from '../../LarkDocIcon.vue'

export default {
  name: 'LinkDialog',
  components: { LarkDocIcon },
  props: {
    ed: { type: Object, required: true },
  },
}
</script>
