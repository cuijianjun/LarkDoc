<template>
  <div
    v-if="ed.activeCalloutVisible && ed.featureEnabled('callouts')"
    class="lark-doc-callout-tools"
    :style="ed.calloutToolsStyle"
    role="toolbar"
    aria-label="高亮块工具"
    @mousedown.prevent
  >
    <label
      title="高亮块文字颜色"
      aria-haspopup="menu"
      @click.prevent="ed.toggleColorPalette('ed.calloutColor', $event)"
    ><span aria-hidden="true">A</span><input
      type="color"
      aria-label="高亮块文字颜色"
      :value="ed.calloutColor('color')"
      @input="ed.setCalloutColor('color', $event.target.value)"
    ></label><label
      title="高亮块背景颜色"
      aria-haspopup="menu"
      @click.prevent="ed.toggleColorPalette('calloutBackground', $event)"
    ><span aria-hidden="true">◉</span><input
      type="color"
      aria-label="高亮块背景颜色"
      :value="ed.calloutColor('backgroundColor')"
      @input="ed.setCalloutColor('backgroundColor', $event.target.value)"
    ></label><label
      title="高亮块边框颜色"
      aria-haspopup="menu"
      @click.prevent="ed.toggleColorPalette('calloutBorder', $event)"
    ><span aria-hidden="true">▔</span><input
      type="color"
      aria-label="高亮块边框颜色"
      :value="ed.calloutColor('borderColor')"
      @input="ed.setCalloutColor('borderColor', $event.target.value)"
    ></label><button
      type="button"
      aria-label="更换高亮块图标"
      @click="ed.toggleCalloutEmoji"
    >
      ☺
    </button><button
      type="button"
      aria-label="恢复高亮块默认样式"
      @click="ed.resetCalloutStyle"
    >
      ↺
    </button><button
      type="button"
      aria-label="删除高亮块"
      @click="ed.deleteActiveCallout"
    >
      ⌫
    </button><div
      v-if="ed.calloutEmojiOpen"
      class="lark-doc-callout-emoji-picker"
      role="menu"
      aria-label="高亮块图标"
    >
      <label class="lark-doc-callout-emoji-search"><span class="sr-only">搜索表情</span><input
        :value="ed.calloutEmojiQuery"
        type="search"
        aria-label="搜索高亮块图标"
        placeholder="搜索"
        @input="ed.setCalloutEmojiQuery($event.target.value)"
      ></label><button
        type="button"
        aria-label="随机高亮块图标"
        title="随机高亮块图标"
        @click="ed.setCalloutEmoji(ed.pickRandomCalloutEmoji())"
      >
        ↺
      </button><div
        class="lark-doc-callout-emoji-tabs"
        role="tablist"
        aria-label="高亮块图标分类"
      >
        <button
          type="button"
          role="tab"
          aria-label="最近使用"
          :aria-selected="String(ed.calloutEmojiCategory === 'recent')"
          @click="ed.setCalloutEmojiCategory('recent')"
        >
          最近
        </button><button
          type="button"
          role="tab"
          aria-label="全部"
          :aria-selected="String(ed.calloutEmojiCategory === 'all')"
          @click="ed.setCalloutEmojiCategory('all')"
        >
          全部
        </button><button
          v-for="category in ed.calloutEmojiCategories"
          :key="category"
          type="button"
          role="tab"
          :aria-label="category"
          :aria-selected="String(ed.calloutEmojiCategory === category)"
          @click="ed.setCalloutEmojiCategory(category)"
        >
          {{ category }}
        </button>
      </div><p
        v-if="ed.calloutEmojiCategory === 'recent' && !ed.filteredCalloutEmojiItems.length"
        class="lark-doc-callout-emoji-empty"
      >
        暂无最近使用
      </p><button
        v-for="item in ed.filteredCalloutEmojiItems"
        :key="item.value"
        type="button"
        role="menuitem"
        :aria-label="item.label"
        @click="ed.setCalloutEmoji(item.glyph)"
      >
        {{ item.glyph }}
      </button>
    </div>
  </div>
</template>

<script>
// CalloutTools —— 从 LarkDocEditor.vue 拆出的高亮块浮动工具条（P0-03 段 6/8）。
// 文字/背景/边框取色、图标选择器（搜索/分类/随机）与工具条操作；
// 表情搜索 v-model 与分类 tab 赋值收敛为 mixin 方法 setCalloutEmojiQuery/setCalloutEmojiCategory。

export default {
  name: 'LarkDocCalloutTools',
  props: {
    ed: { type: Object, required: true },
  },
}
</script>
