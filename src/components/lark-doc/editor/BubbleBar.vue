<template>
  <div
    v-if="ed.bubbleVisible && !ed.effectiveReadonly"
    class="lark-doc-bubble"
    :style="ed.bubbleStyle"
    role="toolbar"
    aria-label="划词工具栏"
    @mousedown.prevent
  >
    <button
      v-if="ed.featureEnabled('ai')"
      type="button"
      class="lark-doc-bubble-ai"
      title="问问 AI"
      aria-label="问问 AI"
      @click="ed.$emit('ai-request', 'rewrite')"
    >
      <lark-doc-icon
        name="block-quote"
        :size="16"
      /><span>问问 AI</span>
    </button>
    <span
      v-if="ed.featureEnabled('ai')"
      class="lark-doc-bubble-divider"
      aria-hidden="true"
    />
    <div
      v-if="ed.featureEnabled('blockStyle')"
      class="lark-doc-bubble-heading"
      @mouseleave="ed.scheduleBubbleHeadingClose"
    >
      <button
        type="button"
        class="lark-doc-bubble-heading-trigger"
        title="标题级别"
        aria-label="标题级别"
        aria-haspopup="menu"
        :aria-expanded="ed.bubbleHeadingOpen ? 'true' : 'false'"
        @mouseenter="ed.openBubbleHeadingMenu"
        @focus="ed.openBubbleHeadingMenu"
        @click.prevent="ed.openBubbleHeadingMenu"
      >
        <span aria-hidden="true">{{ ed.bubbleHeadingValue() }}</span><lark-doc-icon
          class="lark-doc-bubble-caret lark-doc-caret"
          :size="12"
          name="chevronDown"
        />
      </button>
      <lark-doc-heading-menu
        v-if="ed.bubbleHeadingOpen"
        :active-level="ed.bubbleHeadingLevel()"
        :style="ed.bubbleHeadingMenuStyle"
        aria-label="划词标题级别"
        @keep-open="ed.cancelBubbleHoverClose"
        @schedule-close="ed.scheduleBubbleHeadingClose"
        @choose="ed.bubbleHeadingAction"
      />
    </div>
    <div
      class="lark-doc-bubble-align"
      @mouseenter="ed.openBubbleAlignMenu"
      @mouseleave="ed.scheduleBubbleAlignClose"
    >
      <button
        type="button"
        class="lark-doc-bubble-align-trigger"
        aria-label="缩进和对齐"
        title="缩进和对齐"
        aria-haspopup="menu"
        :aria-expanded="ed.bubbleAlignOpen ? 'true' : 'false'"
        @focus="ed.openBubbleAlignMenu"
        @click.prevent="ed.openBubbleAlignMenu"
      >
        <lark-doc-icon
          :name="`align-${ed.bubbleAlignValue()}`"
          :size="16"
        /><lark-doc-icon
          class="lark-doc-bubble-caret lark-doc-caret"
          :size="12"
          name="chevronDown"
        />
      </button>
      <div
        v-if="ed.bubbleAlignOpen"
        class="lark-doc-bubble-align-menu"
        role="menu"
        aria-label="划词缩进和对齐"
        :style="ed.bubbleAlignMenuStyle"
        @mouseenter="ed.cancelBubbleHoverClose"
        @mouseleave="ed.scheduleBubbleAlignClose"
      >
        <button
          v-for="align in ['left', 'center', 'right', 'justify']"
          :key="`bubble-align-${align}`"
          type="button"
          role="menuitem"
          :aria-pressed="String(ed.bubbleAlignValue() === align)"
          :class="{ active: ed.bubbleAlignValue() === align }"
          :data-tooltip="ed.bubbleAlignTooltip(align)"
          :title="ed.bubbleAlignTooltip(align)"
          @mousedown.prevent
          @click="ed.bubbleAlignAction(align)"
        >
          <span
            class="lark-doc-block-align-glyph"
            aria-hidden="true"
          >{{ ed.alignGlyphs[align] }}</span><span>{{ ed.alignNames[align] }}对齐</span><span
            v-if="ed.bubbleAlignValue() === align"
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
          :disabled="!ed.bubbleAlignCanIncrease()"
          :data-tooltip="ed.bubbleAlignTooltip('increaseIndent')"
          :title="ed.bubbleAlignTooltip('increaseIndent')"
          @mousedown.prevent
          @click="ed.bubbleAlignAction('increaseIndent')"
        >
          <span
            class="lark-doc-block-align-glyph"
            aria-hidden="true"
          >⇥</span><span>增加缩进</span><span
            v-if="!ed.bubbleAlignCanIncrease()"
            class="lark-doc-block-align-help"
            aria-label="已达到最大缩进"
          >?</span>
        </button>
        <button
          type="button"
          role="menuitem"
          :disabled="ed.bubbleAlignIndent() <= 0"
          :data-tooltip="ed.bubbleAlignTooltip('decreaseIndent')"
          :title="ed.bubbleAlignTooltip('decreaseIndent')"
          @mousedown.prevent
          @click="ed.bubbleAlignAction('decreaseIndent')"
        >
          <span
            class="lark-doc-block-align-glyph"
            aria-hidden="true"
          >⇤</span><span>减少缩进</span>
        </button>
      </div>
    </div>
    <span
      class="lark-doc-bubble-divider"
      aria-hidden="true"
    />
    <button
      v-for="item in ed.bubbleMarkItems"
      :key="`bubble-mark-${item.id}`"
      type="button"
      :aria-label="item.label"
      :title="item.label"
      :aria-pressed="String(ed.isActive(item.id))"
      @click="ed.toggleMark(item.id)"
    >
      <lark-doc-icon
        :name="item.icon"
        :size="16"
      />
    </button>
    <template v-if="ed.bubbleHighlightAllowed">
      <button
        type="button"
        class="lark-doc-bubble-mark-highlight"
        aria-label="高亮"
        title="高亮"
        :aria-pressed="String(ed.isActive('highlight'))"
        @click="ed.toggleMark('highlight')"
      >
        <lark-doc-icon
          name="mark-highlight"
          :size="16"
        />
      </button><button
        type="button"
        class="lark-doc-bubble-caret-button"
        aria-label="选择高亮颜色"
        title="选择高亮颜色"
        @click.prevent="ed.toggleColorPalette('textBackground', $event)"
      >
        <lark-doc-icon
          class="lark-doc-bubble-caret lark-doc-caret"
          :size="12"
          name="chevronDown"
        />
      </button>
    </template>
    <span
      class="lark-doc-bubble-divider"
      aria-hidden="true"
    />
    <button
      type="button"
      aria-label="复制选中文字"
      title="复制选中文字"
      @click="ed.bubbleCopy"
    >
      <lark-doc-icon
        name="copy"
        :size="16"
      />
    </button>
  </div>
</template>

<script>
// BubbleBar —— 从 LarkDocEditor.vue 拆出的划词工具栏（P0-03 段 7/8）。
// AI/标题级别/缩进对齐/格式标记/高亮色/复制；标题级别下拉与工具栏共用 LarkDocHeadingMenu。
import LarkDocIcon from '../LarkDocIcon.vue'
import LarkDocHeadingMenu from '../LarkDocHeadingMenu.vue'

export default {
  name: 'LarkDocBubbleBar',
  components: { LarkDocIcon, LarkDocHeadingMenu },
  props: {
    ed: { type: Object, required: true },
  },
}
</script>
