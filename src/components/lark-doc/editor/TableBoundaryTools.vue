<template>
  <div
    v-if="ed.featureEnabled('tables') && ed.tableBoundary.visible && ed.tableBoundary.hover && !ed.effectiveReadonly"
    class="lark-doc-table-boundary-tools"
    :class="{ 'is-column': ed.tableBoundary.hover === 'column', 'is-row': ed.tableBoundary.hover === 'row' }"
    :style="{ ...tableBoundary.style, '--lark-doc-column-line-left': `${ed.tableBoundary.columnLineLeft}px`, '--lark-doc-row-line-top': `${ed.tableBoundary.rowLineTop}px` }"
    role="toolbar"
    aria-label="表格边界操作"
    @pointerenter="ed.keepTableBoundaryHover"
    @pointerleave="ed.clearTableBoundaryHover"
  >
    <span
      v-if="ed.tableBoundary.hover === 'column'"
      class="lark-doc-table-boundary-line is-column-line"
      :style="{ left: `${ed.tableBoundary.columnLineLeft}px` }"
      aria-hidden="true"
    /><span
      v-if="ed.tableBoundary.hover === 'row'"
      class="lark-doc-table-boundary-line is-row-line"
      :style="{ top: `${ed.tableBoundary.rowLineTop}px` }"
      aria-hidden="true"
    />
    <button
      v-if="ed.tableBoundary.hover === 'column'"
      type="button"
      class="is-column-before"
      aria-label="在左侧插入列"
      title="在左侧插入列"
      @mousedown.prevent
      @click="ed.tableBoundaryAction('addColumnBefore')"
    >
      ＋
    </button><button
      v-if="ed.tableBoundary.hover === 'column'"
      type="button"
      class="is-column-after"
      aria-label="在右侧插入列"
      title="在右侧插入列"
      @mousedown.prevent
      @click="ed.tableBoundaryAction('addColumnAfter')"
    >
      ＋
    </button><button
      v-if="ed.tableBoundary.hover === 'row'"
      type="button"
      class="is-row-before"
      aria-label="在上方插入行"
      title="在上方插入行"
      @mousedown.prevent
      @click="ed.tableBoundaryAction('addRowBefore')"
    >
      ＋
    </button><button
      v-if="ed.tableBoundary.hover === 'row'"
      type="button"
      class="is-row-after"
      aria-label="在下方插入行"
      title="在下方插入行"
      @mousedown.prevent
      @click="ed.tableBoundaryAction('addRowAfter')"
    >
      ＋
    </button>
  </div>
</template>

<script>
// TableBoundaryTools —— 从 LarkDocEditor.vue 拆出的表格边界浮动工具条（P0-03 段 6/8）。
// 行/列悬停提示线与「在前后插入行/列」快捷按钮；状态与方法都在 tableToolsMixin。

export default {
  name: 'LarkDocTableBoundaryTools',
  props: {
    ed: { type: Object, required: true },
  },
}
</script>
