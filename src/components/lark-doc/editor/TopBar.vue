<template>
  <!-- 顶部标题栏：layout.headerVisible=false 时整行隐藏，操作入口移入工具栏「⋯」下拉 -->
  <header
    v-if="ed.larkDocConfig.layout.headerVisible"
    class="lark-doc-topbar"
  >
    <div
      class="lark-doc-brand"
      aria-label="文档"
    >
      ✦ <span>文档</span>
    </div>
    <div class="lark-doc-title-wrap">
      <input
        :value="ed.localTitle"
        aria-label="文档标题"
        :maxlength="ed.titleLength"
        placeholder="未命名文档"
        :readonly="ed.effectiveReadonly"
        @input="ed.updateTitle($event.target.value)"
      ><span class="lark-doc-title-sub">{{ ed.effectiveReadonly ? '阅读中' : '单人编辑' }}</span>
    </div>
    <div class="lark-doc-header-actions">
      <!-- P4-06 三态模式入口（03 顶栏右侧按钮组 #2：84×32、白底、深灰文字、radius 6）。
           必须与下面的 slot **并存**：slot 里是宿主塞进来的控件（LarkDocWorkspace 有 6+ 个），
           历史上「替换掉 slot」的一个改法会让宿主控件全部消失。 -->
      <div class="lark-doc-mode-switch">
        <button
          type="button"
          class="lark-doc-mode-btn"
          aria-haspopup="listbox"
          :aria-label="`切换文档模式，当前${ed.modeLabel}`"
          :aria-expanded="String(ed.modeMenuOpen)"
          @click="ed.toggleModeMenu($event.currentTarget)"
        >
          <lark-doc-icon
            class="lark-doc-mode-btn-icon"
            :name="ed.modeIcon"
            :size="16"
          />
          <span class="lark-doc-mode-btn-label">{{ ed.modeLabel }}</span>
          <lark-doc-icon
            class="lark-doc-mode-btn-caret"
            name="caretSolid"
            :size="12"
          />
        </button>
        <!-- 180×160，三项各 170×50（主标题 + 副标题两行），四周各留 5px -->
        <div
          v-if="ed.modeMenuOpen"
          class="lark-doc-mode-menu"
          :style="ed.modeMenuStyle"
          role="listbox"
          aria-label="文档模式"
        >
          <button
            v-for="item in ed.modeOptions"
            :key="item.id"
            type="button"
            role="option"
            class="lark-doc-mode-item"
            :class="{ 'is-active': ed.mode === item.id }"
            :aria-selected="String(ed.mode === item.id)"
            @click="ed.setMode(item.id)"
          >
            <span class="lark-doc-mode-item-label">{{ item.label }}</span>
            <span class="lark-doc-mode-item-hint">{{ item.hint }}</span>
          </button>
        </div>
      </div>
      <slot name="header-actions" />
    </div>
  </header>
</template>

<script>
import LarkDocIcon from '../LarkDocIcon.vue'

// TopBar —— 从 LarkDocEditor.vue 拆出的顶部标题栏（P0-03 段 1/8）。
// 通过实例 prop `ed` 直接引用父编辑器实例：父组件状态全部住在 editor/*.mixin.js，
// 显式声明 props 会让父组件超行数预算；子模板对 `ed.xxx` 的访问仍受 Vue 依赖
// 追踪精确管控（render 只跟踪实际读取的属性）。
export default {
  name: 'LarkDocTopBar',
  components: { LarkDocIcon },
  props: {
    ed: { type: Object, required: true },
  },
}
</script>
