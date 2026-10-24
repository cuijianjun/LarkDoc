<template>
  <div
    v-if="!ed.effectiveReadonly && ed.featureEnabled('tables') && ed.isActive('table')"
    class="lark-doc-table-tools"
    role="toolbar"
    aria-label="表格工具"
  >
    <button
      v-for="item in ed.visibleTableActions"
      :key="item.id"
      type="button"
      :aria-pressed="item.id === 'toggleHeaderRow' ? String(ed.tableHeaderState.row) : item.id === 'toggleHeaderColumn' ? String(ed.tableHeaderState.column) : undefined"
      :title="item.label"
      @mousedown.prevent
      @click="ed.tableAction(item.id)"
    >
      {{ item.label }}
    </button><label title="单元格背景">单元格背景 <input
      type="color"
      aria-label="单元格背景"
      value="#f2faf6"
      @change="ed.cellAttribute('backgroundColor', $event.target.value)"
    ></label><lark-doc-select
      aria-label="单元格水平对齐"
      :options="ed.cellTextAlignOptions"
      :value="ed.cellAlignState.textAlign"
      @change="ed.applyCellAlign('textAlign', $event)"
    /><lark-doc-select
      aria-label="单元格垂直对齐"
      :options="ed.cellVerticalAlignOptions"
      :value="ed.cellAlignState.verticalAlign"
      @change="ed.applyCellAlign('verticalAlign', $event)"
    />
  </div>
</template>

<script>
// TableTools —— 从 LarkDocEditor.vue 拆出的表格工具条（P0-03 段 2/8 附属根）。
// 选中表格时出现在正文上方；状态与动作全部住在 tableToolsMixin，经实例 prop `ed` 引用。
import LarkDocSelect from '../LarkDocSelect.vue'

export default {
  name: 'LarkDocTableTools',
  components: { LarkDocSelect },
  props: {
    ed: { type: Object, required: true },
  },
}
</script>
