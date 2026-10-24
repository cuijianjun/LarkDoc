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
      <slot name="header-actions" />
    </div>
  </header>
</template>

<script>
// TopBar —— 从 LarkDocEditor.vue 拆出的顶部标题栏（P0-03 段 1/8）。
// 通过实例 prop `ed` 直接引用父编辑器实例：父组件状态全部住在 editor/*.mixin.js，
// 显式声明 props 会让父组件超行数预算；子模板对 `ed.xxx` 的访问仍受 Vue 依赖
// 追踪精确管控（render 只跟踪实际读取的属性）。
export default {
  name: 'LarkDocTopBar',
  props: {
    ed: { type: Object, required: true },
  },
}
</script>
