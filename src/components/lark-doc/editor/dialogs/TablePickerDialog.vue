<template>
  <div
    v-if="ed.tablePicker"
    class="lark-doc-dialog-backdrop"
    @click.self="ed.closeOverlay"
  >
    <section
      class="lark-doc-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="插入表格"
    >
      <header>
        <strong>插入表格</strong><span class="lark-doc-table-grid-size">{{ ed.tablePickerHover.cols }} × {{ ed.tablePickerHover.rows }}</span><button
          type="button"
          aria-label="关闭表格选择"
          @click="ed.closeOverlay"
        >
          <lark-doc-icon
            :size="14"
            name="close"
          />
        </button>
      </header><p>插入支持富文本的表格</p><div class="lark-doc-table-grid">
        <button
          v-for="n in 81"
          :key="n"
          type="button"
          :class="{ 'is-preview': Math.floor((n - 1) / 9) + 1 <= ed.tablePickerHover.rows && ((n - 1) % 9) + 1 <= ed.tablePickerHover.cols }"
          :aria-label="`${((n - 1) % 9) + 1}行${Math.floor((n - 1) / 9) + 1}列`"
          @mouseenter="ed.previewTableSize(Math.floor((n - 1) / 9) + 1, ((n - 1) % 9) + 1)"
          @focus="ed.previewTableSize(Math.floor((n - 1) / 9) + 1, ((n - 1) % 9) + 1)"
          @click="ed.insertTable(Math.floor((n - 1) / 9) + 1, ((n - 1) % 9) + 1)"
        >
          ▦
        </button>
      </div>
    </section>
  </div>
</template>

<script>
import LarkDocIcon from '../../LarkDocIcon.vue'

export default {
  name: 'TablePickerDialog',
  components: { LarkDocIcon },
  props: {
    ed: { type: Object, required: true },
  },
}
</script>
