<template>
  <!-- 链接悬浮卡（04 §1.6 A 态：440×42，hover ≥1.2s；04 §1.6.1 四种视图二级菜单 232×146）。
       外层 overlay-container z600 / 内层 docx-menu-wrapper z999 —— 两层缺一不可，
       这也是 §1.6.1 红字强调的「外层 600 / 内层 999」。 -->
  <div
    v-if="ed.linkHoverOpen"
    class="lark-doc-link-hover-card"
    :style="ed.linkHoverStyle"
    @mouseenter="ed.keepLinkHover()"
    @mouseleave="ed.closeLinkHover()"
  >
    <div
      class="lark-doc-link-hover-wrapper"
      role="toolbar"
      aria-label="链接"
    >
      <!-- URL 文本项 184×24：唯一带白底的项，单行省略 -->
      <a
        class="lark-doc-link-hover-url"
        :href="ed.linkHoverSafeHref"
        target="_blank"
        rel="noopener noreferrer"
        :title="ed.linkHoverLabel"
      >{{ ed.linkHoverLabel }}</a>

      <button
        type="button"
        class="lark-doc-link-hover-icon"
        data-name="edit-link"
        aria-label="编辑链接"
        @click="ed.editHoveredLink()"
      >
        <lark-doc-icon
          name="edit"
          :size="18"
        />
      </button>
      <button
        type="button"
        class="lark-doc-link-hover-icon"
        data-name="delete-link"
        aria-label="删除链接"
        :disabled="!ed.writable()"
        @click="ed.removeHoveredLink()"
      >
        <lark-doc-icon
          name="trash"
          :size="18"
        />
      </button>

      <span class="lark-doc-link-hover-divider" />

      <!-- 「标题视图」是下拉触发器，不是一次性命令（§1.6.1） -->
      <button
        type="button"
        class="lark-doc-link-hover-view"
        data-name="link-to-title"
        aria-haspopup="menu"
        :aria-expanded="String(ed.linkHoverMenuOpen)"
        @click="ed.toggleLinkHoverMenu()"
        @mouseenter="ed.toggleLinkHoverMenu()"
      >
        <span class="lark-doc-link-hover-view-text">{{ currentViewLabel }}</span>
        <lark-doc-icon
          class="lark-doc-link-hover-view-arrow"
          name="caretSolid"
          :size="14"
        />
      </button>

      <span class="lark-doc-link-hover-divider" />

      <button
        type="button"
        class="lark-doc-link-hover-icon"
        data-name="more"
        aria-label="更多"
        @click="ed.onLinkHoverMore()"
      >
        <lark-doc-icon
          name="more"
          :size="18"
        />
      </button>
    </div>

    <!-- 四种视图 232×146：项 214×32，当前项右侧 16×16 勾 -->
    <div
      v-if="ed.linkHoverMenuOpen"
      class="lark-doc-link-view-menu"
      role="menu"
      aria-label="链接显示方式"
      @mouseenter="ed.keepLinkHover()"
      @mouseleave="ed.closeLinkHover()"
    >
      <button
        v-for="mode in ed.linkViewModes"
        :key="mode.id"
        type="button"
        role="menuitemradio"
        class="lark-doc-link-view-item"
        :class="{ 'is-active': mode.active }"
        :aria-checked="String(mode.active)"
        @click="ed.setLinkHoverView(mode.id)"
      >
        <span class="lark-doc-link-view-text">{{ mode.label }}</span>
        <lark-doc-icon
          v-if="mode.active"
          class="lark-doc-link-view-check"
          name="check"
          :size="16"
        />
      </button>
    </div>
  </div>
</template>

<script>
import LarkDocIcon from '../LarkDocIcon.vue'
import { LINK_VIEW_MODES } from './linkHoverMixin'

// LinkHoverCard —— 链接悬浮卡视图层。状态机在 editor/linkHoverMixin.js。
export default {
  name: 'LarkDocLinkHoverCard',
  components: { LarkDocIcon },
  props: {
    ed: { type: Object, required: true },
  },
  computed: {
    currentViewLabel() {
      const hit = LINK_VIEW_MODES.filter((mode) => mode.id === this.ed.linkHoverView)[0]
      return hit ? hit.label : LINK_VIEW_MODES[0].label
    },
  },
}
</script>
