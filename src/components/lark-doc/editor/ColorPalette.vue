<template>
  <div
    v-if="ed.colorPaletteOpen && !ed.effectiveReadonly"
    class="lark-doc-color-palette"
    :class="{ 'lark-doc-color-palette-text': ed.colorPaletteIsText }"
    role="menu"
    :aria-label="`${ed.colorPaletteTitle}面板`"
    :style="ed.colorPaletteStyle"
    @mousedown.prevent
    @mouseenter="ed.cancelPopupHoverClose"
    @mouseleave="ed.scheduleColorPaletteClose"
  >
    <template v-if="ed.colorPaletteIsText">
      <div class="lark-doc-color-palette-text-section">
        <small>字体颜色</small>
        <div class="lark-doc-color-letters">
          <button
            v-for="color in ed.textColorOptions"
            :key="`tc-${color.value}`"
            type="button"
            role="menuitem"
            :aria-label="`字体颜色 ${color.label}`"
            :title="color.label"
            :style="{ color: color.value }"
            :class="{ 'is-active': ed.activeTextColor && ed.activeTextColor.toLowerCase() === color.value.toLowerCase() }"
            @click="ed.applyColorPalette(color.value, 'textColor')"
          >
            A
          </button>
        </div>
      </div>
      <div class="lark-doc-color-palette-text-section">
        <small>背景颜色</small>
        <div
          v-for="(row, rowIndex) in ed.textBackgroundRows"
          :key="`row-${rowIndex}`"
          class="lark-doc-color-grid"
        >
          <button
            v-for="color in row"
            :key="`bg-${color.label}`"
            type="button"
            role="menuitem"
            :aria-label="`背景颜色 ${color.label}`"
            :title="color.label"
            :class="{ 'is-transparent': !color.value, 'is-active': color.value ? (ed.activeTextBackground && ed.activeTextBackground.toLowerCase() === color.value.toLowerCase()) : !ed.activeTextBackground }"
            :style="color.value ? { backgroundColor: color.value } : {}"
            @click="ed.applyColorPalette(color.value, 'textBackground')"
          />
        </div>
      </div>
      <div
        v-if="ed.textColorRecent.length"
        class="lark-doc-color-palette-section lark-doc-color-palette-text-recent"
      >
        <small>最近</small><button
          v-for="color in ed.textColorRecent"
          :key="`recent-text-${color}`"
          type="button"
          role="menuitem"
          :aria-label="`最近颜色 ${color}`"
          :title="color"
          :style="{ backgroundColor: color }"
          @click="ed.applyColorPalette(color, 'textBackground')"
        />
      </div>
      <button
        type="button"
        role="menuitem"
        class="lark-doc-color-palette-reset"
        aria-label="恢复默认颜色"
        @click="ed.resetTextColors"
      >
        恢复默认
      </button>
    </template>
    <template v-else>
      <strong>{{ ed.colorPaletteTitle }}</strong>
      <div
        v-if="ed.colorPaletteRecent.length"
        class="lark-doc-color-palette-section"
      >
        <small>最近</small><button
          v-for="color in ed.colorPaletteRecent"
          :key="`recent-${color}`"
          type="button"
          role="menuitem"
          :aria-label="`最近颜色 ${color}`"
          :title="color"
          :style="{ backgroundColor: color }"
          @click="ed.applyColorPalette(color)"
        />
      </div>
      <div class="lark-doc-color-palette-section">
        <small>推荐</small><button
          v-for="color in ed.colorPaletteOptions"
          :key="color.value || 'default'"
          type="button"
          role="menuitem"
          :aria-label="color.label"
          :title="color.label"
          :class="{ 'is-transparent': !color.value }"
          :style="color.value ? { backgroundColor: color.value } : {}"
          @click="ed.applyColorPalette(color.value)"
        />
      </div>
      <button
        type="button"
        role="menuitem"
        class="lark-doc-color-palette-reset"
        aria-label="恢复默认颜色"
        @click="ed.resetColorPalette"
      >
        恢复默认
      </button>
    </template>
  </div>
</template>

<script>
// ColorPalette —— 从 LarkDocEditor.vue 拆出的颜色面板（P0-03 段 7/8）。
// 文字色（字母行 + 背景网格 + 最近）与通用推荐色两态；归属 calloutColorMixin。

export default {
  name: 'LarkDocColorPalette',
  props: {
    ed: { type: Object, required: true },
  },
}
</script>
