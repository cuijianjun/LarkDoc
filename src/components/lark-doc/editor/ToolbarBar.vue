<template>
  <div
    class="lark-doc-toolbar"
    role="toolbar"
    aria-label="文档工具栏"
    @mousedown="ed.rememberSelection"
  >
    <div
      v-if="ed.toolbarEnabled('history')"
      v-show="!ed.isGroupCollapsed('history')"
      class="lark-doc-tools"
    >
      <button
        type="button"
        aria-label="撤销"
        title="撤销"
        :disabled="ed.effectiveReadonly"
        @click="ed.run('undo')"
      >
        <lark-doc-icon name="undo" />
      </button><button
        type="button"
        aria-label="重做"
        title="重做"
        :disabled="ed.effectiveReadonly"
        @click="ed.run('redo')"
      >
        <lark-doc-icon name="redo" />
      </button>
    </div>
    <div
      v-if="ed.toolbarEnabled('headings')"
      v-show="!ed.isGroupCollapsed('headings')"
      class="lark-doc-tools lark-doc-heading-tool"
    >
      <button
        type="button"
        aria-label="标题级别"
        title="标题级别"
        :disabled="ed.effectiveReadonly"
        :aria-expanded="ed.headingOpen ? 'true' : 'false'"
        @mouseenter="ed.openHeadingMenuOnHover"
        @mouseleave="ed.scheduleHeadingMenuClose"
        @click="ed.toggleHeadingMenu"
      >
        {{ ed.currentBlockLabel }}<lark-doc-icon
          class="lark-doc-caret"
          :size="12"
          name="chevronDown"
        />
      </button><lark-doc-heading-menu
        v-if="ed.headingOpen"
        :active-level="ed.headingActiveLevel"
        :style="ed.headingStyle"
        aria-label="标题级别"
        @keep-open="ed.cancelPopupHoverClose"
        @schedule-close="ed.scheduleHeadingMenuClose"
        @choose="ed.setHeading"
      />
    </div>
    <div
      v-if="ed.toolbarEnabled('marks')"
      v-show="!ed.isGroupCollapsed('marks')"
      class="lark-doc-tools"
    >
      <button
        v-for="item in ed.visibleMarks"
        :key="item.id"
        type="button"
        :class="`lark-doc-mark-${item.id}`"
        :aria-label="item.label"
        :title="item.label"
        :aria-pressed="String(ed.isActive(item.id))"
        :disabled="ed.effectiveReadonly"
        @mousedown.prevent
        @click="ed.toggleMark(item.id)"
      >
        {{ item.glyph }}
      </button>
    </div>
    <div
      v-if="ed.toolbarEnabled('textStyle')"
      v-show="!ed.isGroupCollapsed('textStyle')"
      class="lark-doc-tools"
    >
      <button
        type="button"
        aria-label="设置链接"
        title="设置链接"
        :aria-pressed="String(ed.isActive('link'))"
        :disabled="ed.effectiveReadonly || !ed.hasTextSelection"
        @mousedown.prevent
        @click="ed.openLinkDialog"
      >
        <lark-doc-icon name="link" />
      </button>
      <lark-doc-select
        aria-label="字体"
        :options="ed.fontFamilyOptions"
        :value="ed.appliedTextStyle.fontFamily"
        :disabled="ed.effectiveReadonly"
        @change="ed.applyTextStyle('fontFamily', $event)"
      />
      <lark-doc-select
        aria-label="字号"
        :options="ed.fontSizeOptions"
        :value="ed.appliedTextStyle.fontSize"
        :disabled="ed.effectiveReadonly"
        @change="ed.applyTextStyle('fontSize', $event)"
      />        <label
        class="lark-doc-color"
        title="颜色"
        aria-haspopup="menu"
        :aria-expanded="ed.colorPaletteOpen === 'textColor' ? 'true' : 'false'"
        @mouseenter="ed.openColorPaletteOnHover"
        @mouseleave="ed.scheduleColorPaletteClose"
        @click.prevent="ed.toggleColorPalette('textColor', $event)"
      ><span
        class="lark-doc-color-letter lark-doc-color-letter-hl"
        aria-hidden="true"
        :style="{ color: ed.appliedTextStyle.textColor, background: `linear-gradient(transparent 52%, ${ed.appliedTextStyle.backgroundColor} 52%)` }"
      >A</span><lark-doc-icon
        :size="12"
        name="chevronDown"
        class="lark-doc-caret lark-doc-color-arrow"
      /><input
        type="color"
        aria-label="文字颜色"
        :disabled="ed.effectiveReadonly"
        :value="ed.appliedTextStyle.textColor"
        @focus="ed.rememberSelection"
        @input="ed.applyTextColor($event.target.value)"
      ><input
        type="color"
        aria-label="背景颜色"
        :disabled="ed.effectiveReadonly"
        :value="ed.appliedTextStyle.backgroundColor"
        @focus="ed.rememberSelection"
        @input="ed.applyTextBackground($event.target.value)"
      ></label>
    </div>
    <div
      v-if="ed.toolbarEnabled('blockStyle')"
      v-show="!ed.isGroupCollapsed('blockStyle')"
      class="lark-doc-tools"
    >
      <lark-doc-select
        aria-label="行高"
        :options="ed.lineHeightOptions"
        :value="ed.appliedTextStyle.lineHeight"
        :disabled="ed.effectiveReadonly"
        @change="ed.applyLineHeight($event)"
      /><button
        v-for="align in ['left', 'center', 'right', 'justify']"
        :key="align"
        type="button"
        :aria-label="`对齐${ed.alignNames[align]}`"
        :title="`对齐${ed.alignNames[align]}`"
        :disabled="ed.effectiveReadonly"
        @mousedown.prevent
        @click="ed.setAlign(align)"
      >
        <lark-doc-icon :name="`align-${align}`" />
      </button><button
        type="button"
        aria-label="减少缩进"
        :title="ed.blockIndentLevel() <= 0 ? '已在最外层' : '减少缩进'"
        :disabled="ed.effectiveReadonly || ed.blockIndentLevel() <= 0"
        @mousedown.prevent
        @click="ed.changeIndent(-1)"
      >
        <lark-doc-icon name="indent-dec" />
      </button><button
        type="button"
        aria-label="增加缩进"
        :title="ed.canIncreaseIndent() ? '增加缩进' : '当前内容块已达最大缩进层级'"
        :disabled="ed.effectiveReadonly || !ed.canIncreaseIndent()"
        @mousedown.prevent
        @click="ed.changeIndent(1)"
      >
        <lark-doc-icon name="indent-inc" />
      </button><button
        type="button"
        aria-label="清除格式"
        title="清除格式"
        :disabled="ed.effectiveReadonly"
        @mousedown.prevent
        @click="ed.clearFormatting"
      >
        <lark-doc-icon name="clear" />
      </button>
    </div>
    <div
      v-if="ed.toolbarEnabled('insert') || ed.toolbarEnabled('tables') || ed.toolbarEnabled('ai')"
      v-show="!ed.isGroupCollapsed('insert')"
      class="lark-doc-tools"
    >
      <button
        v-if="ed.toolbarEnabled('insert')"
        type="button"
        aria-label="插入"
        title="插入内容"
        :disabled="ed.effectiveReadonly"
        @click="ed.openCommandMenu('plus', $event)"
      >
        <lark-doc-icon name="plus" />插入
      </button><button
        v-if="ed.toolbarEnabled('tables')"
        type="button"
        :aria-label="ed.isActive('table') ? '表格工具' : '插入表格'"
        :title="ed.isActive('table') ? '表格工具' : '插入表格'"
        :disabled="ed.effectiveReadonly"
        @mousedown.prevent
        @click="ed.onTableToolbarClick"
      >
        <lark-doc-icon name="table" />
      </button><button
        v-if="ed.toolbarEnabled('insert') && ed.larkDocConfig.features.diagram"
        type="button"
        aria-label="图表"
        title="插入图表"
        :disabled="ed.effectiveReadonly"
        :aria-expanded="String(ed.diagramMenuOpen)"
        @click="ed.toggleDiagramMenu"
      >
        <lark-doc-icon name="chart" />
      </button><button
        v-if="ed.toolbarEnabled('ai')"
        type="button"
        aria-label="AI 助手"
        title="AI 助手"
        :disabled="ed.effectiveReadonly"
        @click="ed.$emit('ai-request', 'rewrite')"
      >
        <lark-doc-icon name="sparkle" />AI
      </button>
      <!-- 图表类型下拉：流程图/时序图/甘特图等，承接图表插入的全部功能 -->
      <div
        v-if="ed.diagramMenuOpen"
        class="lark-doc-dropdown lark-doc-diagram-menu"
        :style="ed.diagramMenuStyle"
        role="menu"
        aria-label="图表类型"
      >
        <button
          v-for="item in ed.diagramTypes"
          :key="item.id"
          type="button"
          role="menuitem"
          @mousedown.prevent
          @click="ed.insertDiagramType(item.id)"
        >
          {{ item.label }}
        </button>
      </div>
    </div>
    <div class="lark-doc-tools lark-doc-tools-end">
      <span
        v-show="!ed.isGroupCollapsed('toolsEnd')"
        class="lark-doc-tools-end-inner"
      >        <button
        v-if="ed.toolbarEnabled('search')"
        type="button"
        aria-label="查找"
        title="查找"
        @click="ed.toggleSearchOpen(); ed.$nextTick(() => ed.$refs.searchInput?.focus())"
      >
        <lark-doc-icon name="search" />
      </button><button
        v-if="ed.toolbarEnabled('outline')"
        type="button"
        aria-label="目录"
        title="目录"
        :aria-expanded="String(ed.outlineOpen)"
        @click="ed.toggleOutlineOpen"
      >
        <lark-doc-icon name="outline" />
      </button>        <lark-doc-select
        v-if="ed.toolbarEnabled('viewModes')"
        aria-label="页面宽度"
        :options="ed.widthModeOptions"
        :value="ed.widthMode"
        @change="ed.setWidthMode"
      /><button
        v-if="ed.toolbarEnabled('viewModes')"
        type="button"
        :aria-label="ed.reading ? '退出阅读' : '阅读模式'"
        :title="ed.reading ? '退出阅读' : '阅读模式'"
        :aria-pressed="String(ed.reading)"
        @click="ed.toggleReading"
      >
        <lark-doc-icon name="reading" />
      </button><button
        v-if="ed.toolbarEnabled('viewModes')"
        type="button"
        :aria-label="ed.fullscreen ? '退出全屏' : '全屏'"
        :title="ed.fullscreen ? '退出全屏' : '全屏'"
        :aria-pressed="String(ed.fullscreen)"
        @click="ed.toggleFullscreen"
      >
        <lark-doc-icon name="fullscreen" />
      </button><button
        v-if="ed.toolbarEnabled('viewModes')"
        type="button"
        :aria-label="ed.slides ? '退出演示' : '演示模式'"
        :title="ed.slides ? '退出演示' : '演示模式'"
        :aria-pressed="String(ed.slides)"
        @click="ed.toggleSlides"
      >
        <lark-doc-icon name="slides" />
      </button>        <button
        v-if="ed.toolbarEnabled('shortcuts')"
        type="button"
        aria-label="快捷键帮助"
        title="快捷键帮助"
        @click="ed.toggleHelpOpen"
      >
        ?
      </button><button
        v-if="!ed.larkDocConfig.layout.headerVisible && ed.$slots['header-actions']"
        type="button"
        aria-label="文档操作"
        title="文档操作"
        :aria-expanded="String(ed.headerMenuOpen)"
        @click="ed.toggleHeaderMenu"
      >
        ⋯
      </button></span>
      <!-- header-menu 弹层放在 span 外：tools-end 被收纳隐藏时弹层仍可由「更多」打开 -->
      <div
        v-if="!ed.larkDocConfig.layout.headerVisible && ed.headerMenuOpen"
        class="lark-doc-dropdown lark-doc-header-menu"
        :style="ed.headerMenuStyle"
        role="menu"
        aria-label="文档操作"
      >
        <!-- 顶栏隐藏时承接 header-actions 插槽（字数/保存/模板/导入导出/快照） -->
        <slot name="header-actions" />
      </div>
      <!-- 工具栏自适应折叠：「更多 ▾」承接被收纳分组的全部功能（按组分节） -->
      <button
        v-if="ed.collapsedGroups.length"
        type="button"
        aria-label="更多"
        title="更多工具"
        :aria-expanded="String(ed.moreMenuOpen)"
        @mouseenter="ed.openMoreMenuOnHover"
        @mouseleave="ed.scheduleMoreMenuClose"
        @click="ed.toggleMoreMenuGuarded"
      >
        更多<lark-doc-icon
          class="lark-doc-caret"
          :size="12"
          name="chevronDown"
        />
      </button><div
        v-if="ed.moreMenuOpen"
        class="lark-doc-dropdown lark-doc-more-menu"
        :style="ed.moreMenuStyle"
        role="menu"
        aria-label="更多工具"
        @mouseenter="ed.cancelPopupHoverClose"
        @mouseleave="ed.scheduleMoreMenuClose"
      >
        <template v-for="section in ed.visibleToolbarSections">
          <div
            :key="section.id"
            class="lark-doc-more-title"
          >
            {{ section.title }}
          </div>
          <button
            v-for="item in section.items"
            :key="section.id + item.label"
            type="button"
            role="menuitem"
            :disabled="item.disabled"
            :class="{ 'lark-doc-more-active': item.checked }"
            @mousedown.prevent
            @click="ed.runMoreItem(item, $event)"
          >
            <span
              class="lark-doc-select-check"
              aria-hidden="true"
            >{{ item.checked ? '✓' : '' }}</span>{{ item.label }}
          </button>
        </template>
      </div>
    </div>
  </div>
</template>

<script>
// ToolbarBar —— 从 LarkDocEditor.vue 拆出的工具栏（P0-03 段 2/8）。
// 实例 prop `ed` 引用父编辑器实例：状态与方法全部住在 editor/*.mixin.js，
// 显式 props 会超出父组件行数预算；子模板对 `ed.xxx` 的访问仍受 Vue 依赖
// 追踪精确管控。header-actions 插槽经父组件透传（顶栏隐藏时由「⋯」菜单承接）。
import LarkDocIcon from '../LarkDocIcon.vue'
import LarkDocSelect from '../LarkDocSelect.vue'
import LarkDocHeadingMenu from '../LarkDocHeadingMenu.vue'

export default {
  name: 'LarkDocToolbarBar',
  components: { LarkDocIcon, LarkDocSelect, LarkDocHeadingMenu },
  props: {
    ed: { type: Object, required: true },
  },
}
</script>
