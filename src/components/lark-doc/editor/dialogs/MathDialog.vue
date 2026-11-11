<template>
  <div
    v-if="ed.mathDialog"
    class="lark-doc-dialog-backdrop"
    @click.self="ed.closeOverlay"
  >
    <section
      class="lark-doc-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="插入公式"
      @keydown.esc.stop.prevent="ed.closeOverlay"
    >
      <header>
        <strong>插入公式</strong><button
          type="button"
          aria-label="关闭对话框"
          @click="ed.closeOverlay"
        >
          <lark-doc-icon
            :size="14"
            name="close"
          />
        </button>
      </header><label>LaTeX <input
        ref="mathInput"
        :value="ed.mathValue"
        aria-label="LaTeX 公式"
        placeholder="例如 x^2 + y^2"
        @input="ed.setMathValue($event.target.value)"
        @keydown.enter.prevent="ed.insertMath"
      ></label><p
        v-if="ed.mathError"
        role="alert"
        class="lark-doc-error"
      >
        {{ ed.mathError }}
      </p><button
        type="button"
        @click="ed.insertMath"
      >
        插入
      </button>
    </section>
  </div>
</template>

<script>
import LarkDocIcon from '../../LarkDocIcon.vue'

export default {
  name: 'MathDialog',
  components: { LarkDocIcon },
  props: {
    ed: { type: Object, required: true },
  },
  mounted() {
    const ed = this.ed, session = ed.session, documentId = session?.documentId
    // 首次冷加载可能晚于命令的 nextTick；只为仍有效的当前弹窗补焦点。
    this.$nextTick(() => {
      if (!this._isDestroyed && !this._isBeingDestroyed && !ed._isDestroyed && !ed._isBeingDestroyed && ed.mathDialog &&
        session === ed.session && documentId === ed.session?.documentId && ed.editor?.isEditable && ed.$el?.contains(this.$el)) this.$refs.mathInput?.focus()
    })
  },
}
</script>
