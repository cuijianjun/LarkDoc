<template>
  <div
    v-if="ed.editor && !ed.effectiveReadonly && ed.featureEnabled('blockHandle') && ed.handleRange"
    class="lark-doc-block-handle"
    :class="{ 'is-menu-open': ed.blockMenuOpen }"
    :style="ed.blockHandleStyle"
    @mouseenter="ed.onBlockHandleEnter"
    @mouseleave="ed.onBlockHandleLeave"
  >
    <button
      v-if="ed.handleIsEmptyParagraph"
      type="button"
      class="lark-doc-empty-block-insert"
      aria-label="插入内容"
      title="插入内容"
      @mousedown.prevent
      @mouseenter="ed.openEmptyBlockInsertMenu"
      @click="ed.openEmptyBlockInsertMenu"
    >
      ＋
    </button><button
      v-else-if="!ed.handleIsTaskList"
      type="button"
      class="lark-doc-block-handle-main"
      :class="{ 'is-callout': ed.handleBlockNode()?.type?.name === 'callout' }"
      aria-label="块操作"
      title="块操作与拖动"
      :draggable="ed.featureEnabled('blockDrag')"
      @mouseenter="ed.openBlockMenuOnHover"
      @focus="ed.openBlockMenuOnHover"
      @click="ed.openBlockMenu"
      @pointerdown="ed.pressHandle"
      @dragstart="ed.startBlockDrag"
      @dragend="ed.endBlockDrag"
    >
      <span class="lark-doc-block-handle-type">{{ ed.handleGlyph }}</span><span
        class="lark-doc-block-handle-dots"
        aria-hidden="true"
      >⠿</span>
    </button><div
      v-if="ed.blockMenuOpen"
      class="lark-doc-block-menu"
      role="menu"
      aria-label="块操作"
      :style="ed.blockMenuStyle"
      @mouseenter="ed.onBlockMenuEnter"
      @mouseleave="ed.onBlockMenuLeave"
      @focusin="ed.onBlockMenuFocusIn"
      @focusout="ed.onBlockMenuFocusOut"
    >
      <button
        v-if="ed.featureEnabled('ai')"
        type="button"
        role="menuitem"
        class="lark-doc-block-menu-ai"
        title="问问 AI"
        @mousedown.prevent
        @click="ed.$emit('ai-request', 'rewrite')"
      >
        <lark-doc-icon
          class="lark-doc-block-menu-icon"
          name="sparkle"
          :size="16"
        /><span>问问 AI</span>
      </button>
      <div
        v-if="ed.featureEnabled('ai')"
        class="lark-doc-block-menu-divider"
        role="separator"
      />
      <div
        v-if="ed.visibleBlockTypeActions.length && !ed.handleIsTable"
        class="lark-doc-block-menu-section lark-doc-block-type-actions"
        role="group"
        aria-label="类型转换"
      >
        <button
          v-for="item in ed.visibleBlockTypeActions"
          :key="item.id"
          type="button"
          role="menuitem"
          :aria-label="item.label"
          :class="{ active: ed.blockTypeActive(item.id) }"
          :title="item.label"
          @mousedown.prevent
          @click="ed.blockTypeAction(item.id)"
        >
          <lark-doc-icon
            class="lark-doc-block-type-icon"
            :name="item.icon"
            :size="18"
          /><span class="sr-only">{{ item.label }}</span>
        </button>
      </div>
      <button
        v-if="ed.isBlockActionEnabled('duplicate') && !ed.handleIsTable"
        type="button"
        role="menuitem"
        class="lark-doc-block-menu-duplicate"
        title="创建副本"
        aria-label="创建副本"
        @mousedown.prevent
        @click="ed.blockAction('duplicate')"
      >
        <lark-doc-icon
          name="copy"
          :size="16"
        />
      </button>
      <div
        v-if="!ed.handleIsTable"
        class="lark-doc-block-menu-divider"
        role="separator"
      />
      <button
        v-if="ed.featureEnabled('blockStyle') && !ed.handleIsTable"
        type="button"
        role="menuitem"
        class="lark-doc-block-submenu-trigger"
        aria-haspopup="menu"
        :aria-expanded="ed.blockAlignMenuOpen ? 'true' : 'false'"
        title="缩进和对齐"
        @mousedown.prevent
        @mouseenter="ed.openBlockAlignMenuOnHover"
        @focus="ed.openBlockAlignMenuOnHover"
        @click.stop="ed.openBlockAlignMenuOnHover"
      >
        <lark-doc-icon
          class="lark-doc-block-menu-icon"
          name="align-left"
          :size="16"
        /><span>缩进和对齐</span><span
          class="lark-doc-block-menu-arrow"
          aria-hidden="true"
        >›</span>
      </button><button
        v-if="ed.featureEnabled('blockStyle') && !ed.handleIsTable"
        type="button"
        role="menuitem"
        class="lark-doc-block-submenu-trigger"
        aria-haspopup="menu"
        :aria-expanded="ed.blockColorMenuOpen ? 'true' : 'false'"
        title="颜色"
        @mousedown.prevent
        @mouseenter="ed.openBlockColorMenuOnHover"
        @focus="ed.openBlockColorMenuOnHover"
        @click.stop="ed.openBlockColorMenuOnHover"
      >
        <lark-doc-icon
          class="lark-doc-block-menu-icon"
          name="palette"
          :size="16"
        /><span>颜色</span><span
          class="lark-doc-block-menu-arrow"
          aria-hidden="true"
        >›</span>
      </button><div
        v-if="ed.blockColorMenuOpen && ed.featureEnabled('blockStyle')"
        class="lark-doc-block-submenu lark-doc-block-color-submenu"
        role="menu"
        aria-label="颜色"
        :style="ed.blockColorMenuStyle"
      >
        <button
          type="button"
          role="menuitem"
          aria-label="恢复默认颜色"
          @mousedown.prevent
          @click="ed.blockColorAction('')"
        >
          <span
            class="lark-doc-block-color-swatch is-transparent"
            aria-hidden="true"
          /><span>恢复默认</span>
        </button><button
          v-for="color in ed.colorPaletteOptions"
          :key="`block-color-${color.value || 'default'}`"
          type="button"
          role="menuitem"
          :aria-label="color.label"
          @mousedown.prevent
          @click="ed.blockColorAction(color.value)"
        >
          <span
            class="lark-doc-block-color-swatch"
            :style="{ backgroundColor: color.value }"
            aria-hidden="true"
          /><span>{{ color.label }}</span>
        </button>
      </div>
      <div
        v-if="ed.handleIsTable && ed.featureEnabled('tables')"
        class="lark-doc-block-menu-table"
        role="group"
        aria-label="表格设置"
      >
        <button
          type="button"
          role="menuitemcheckbox"
          class="lark-doc-block-menu-row"
          :aria-checked="String(ed.handleTableHeaderState().row)"
          title="标题行"
          @mousedown.prevent
          @click="ed.tableHandleAction('toggleHeaderRow')"
        >
          <lark-doc-icon
            class="lark-doc-block-menu-icon"
            name="table-header-row"
            :size="16"
          /><span>标题行</span><span
            class="lark-doc-menu-switch"
            :class="{ on: ed.handleTableHeaderState().row }"
            aria-hidden="true"
          ><span class="lark-doc-menu-switch-dot" /></span>
        </button>
        <button
          type="button"
          role="menuitemcheckbox"
          class="lark-doc-block-menu-row"
          :aria-checked="String(ed.handleTableHeaderState().column)"
          title="标题列"
          @mousedown.prevent
          @click="ed.tableHandleAction('toggleHeaderColumn')"
        >
          <lark-doc-icon
            class="lark-doc-block-menu-icon"
            name="table-header-col"
            :size="16"
          /><span>标题列</span><span
            class="lark-doc-menu-switch"
            :class="{ on: ed.handleTableHeaderState().column }"
            aria-hidden="true"
          ><span class="lark-doc-menu-switch-dot" /></span>
        </button>
        <button
          type="button"
          role="menuitem"
          class="lark-doc-block-menu-row"
          title="均分列宽"
          @mousedown.prevent
          @click="ed.tableHandleAction('distributeColumns')"
        >
          <lark-doc-icon
            class="lark-doc-block-menu-icon"
            name="distribute-cols"
            :size="16"
          /><span>均分列宽</span>
        </button>
      </div>
      <div
        v-if="ed.visibleBlockListActions.length"
        class="lark-doc-block-menu-divider"
        role="separator"
      />
      <button
        v-for="item in ed.visibleBlockListActions"
        :key="item.id"
        type="button"
        role="menuitem"
        class="lark-doc-block-menu-row"
        :title="item.label"
        @mousedown.prevent
        @click="ed.blockAction(item.id)"
      >
        <lark-doc-icon
          class="lark-doc-block-menu-icon"
          :name="item.icon"
          :size="16"
        /><span>{{ item.label }}</span>
      </button>
      <div
        v-if="ed.featureEnabled('blockStyle')"
        class="lark-doc-block-menu-divider"
        role="separator"
      />
      <button
        v-if="ed.isBlockActionEnabled('addBelow')"
        type="button"
        role="menuitem"
        class="lark-doc-block-menu-row"
        title="在下方添加正文"
        @mousedown.prevent
        @click="ed.blockAction('addBelow')"
      >
        <lark-doc-icon
          class="lark-doc-block-menu-icon"
          name="plus"
          :size="16"
        /><span>在下方添加正文</span>
      </button>
    </div><div
      v-if="ed.blockAlignMenuOpen && ed.featureEnabled('blockStyle')"
      class="lark-doc-block-submenu"
      role="menu"
      aria-label="缩进和对齐"
      :style="ed.blockAlignMenuStyle"
    >
      <button
        v-for="align in ['left', 'center', 'right', 'justify']"
        :key="`block-align-${align}`"
        type="button"
        role="menuitem"
        :aria-pressed="String(ed.blockAlignValue() === align)"
        :class="{ active: ed.blockAlignValue() === align }"
        @mousedown.prevent
        @click="ed.blockAlignAction(align)"
      >
        <span
          class="lark-doc-block-align-glyph"
          aria-hidden="true"
        >{{ ed.alignGlyphs[align] }}</span><span>{{ ed.alignNames[align] }}对齐</span><span
          v-if="ed.blockAlignValue() === align"
          class="lark-doc-block-align-check"
          aria-hidden="true"
        >✓</span>
      </button>
      <div
        class="lark-doc-block-submenu-divider"
        role="separator"
      />
      <button
        type="button"
        role="menuitem"
        :disabled="!ed.blockAlignCanIncrease()"
        @mousedown.prevent
        @click="ed.blockAlignAction('increaseIndent')"
      >
        <span
          class="lark-doc-block-align-glyph"
          aria-hidden="true"
        >⇥</span><span>增加缩进</span><span
          v-if="!ed.blockAlignCanIncrease()"
          class="lark-doc-block-align-help"
          aria-label="已达到最大缩进"
        >?</span>
      </button><button
        type="button"
        role="menuitem"
        :disabled="ed.blockAlignIndent() <= 0"
        @mousedown.prevent
        @click="ed.blockAlignAction('decreaseIndent')"
      >
        <span
          class="lark-doc-block-align-glyph"
          aria-hidden="true"
        >⇤</span><span>减少缩进</span>
      </button>
    </div>
  </div>
</template>

<script>
// BlockHandleMenu —— 从 LarkDocEditor.vue 拆出的区块句柄与块菜单（P0-03 段 5/8）。
// 覆盖句柄按钮、主菜单（AI/类型转换/副本/颜色/对齐/列表操作/表格设置）与缩进子菜单；
// 拖拽赋值收敛为 mixin 方法 pressHandle/endBlockDrag；拖拽落点提示线（drop-line）
// 受 Vue 2 单根约束留在父模板。
import LarkDocIcon from '../LarkDocIcon.vue'

export default {
  name: 'LarkDocBlockHandleMenu',
  components: { LarkDocIcon },
  props: {
    ed: { type: Object, required: true },
  },
}
</script>
