<template>
  <!-- 浮层组（阶段 5 批次 4b 之后只剩分享 / 导出）。
       为什么还要这一层：`SharePopover` 与 `ExportDialog` 各自的 _panel 都是 `position: fixed`，
       必须是**兄弟** —— 祖先一旦有 transform / filter / 非 static 定位，就会改写 fixed 的
       包含块而漂走（`SharePopover.vue` 头部同一条纪律）。而 `LarkDocEditor.vue` 有 <700 行
       门禁（P0-03 门面只做装配），两条线各占一个模板位会把门面撑过线，所以收成一个根节点。

       ⚠️ 包裹层自身**不许**加 transform / filter / overflow / 非 static 定位。

       两个子节点**都自管理显隐**，所以这里**不写 v-if** —— 尤其 `ExportDialog`：
       04 §4.6.7③ 的顺序是「弹窗关闭 → toast」，父级 v-if 会把还没消失的 toast 一起摘掉。

       评论 / 历史版本 / 另存为三块在 4b 已迁到 `src/ui/panels.js`，挂载点是
       `LarkDocEditor.vue` 里的 `<div ref="panelHost" />`（与本组件同层，同一套 fixed 前提）。 -->
  <div class="lark-doc-p6b-layer">
    <!-- 分享：入口按钮 + popover + 二级权限 Dialog 同属一个组件
         （00-README 行 ~119：一级分享是 popover 不是 Dialog）。 -->
    <SharePopover :ed="ed" />
    <!-- 导出：设置弹窗 + 导出 toast（04 §4.6.7）。 -->
    <ExportDialog :ed="ed" />
  </div>
</template>

<script>
// 浮层组的挂载点。这里不写任何逻辑 —— 状态机在 `editor/p6bMixin.js` 聚合的 mixin 里，
// 渲染在各自的 .vue 里，本组件只是把它们按「兄弟」关系排成一个根节点。
//
// `ed` 是 **LarkDocEditor 实例本身**（不是本组件）：父级传的是 `:ed="self"`，
// 这里再原样往下传，面板因此能直接读到 `ed.editor` / `ed.session` / 各 mixin 的 data。
import SharePopover from '../SharePopover.vue'
import ExportDialog from '../ExportDialog.vue'

export default {
  name: 'LarkDocP6bOverlays',
  components: { SharePopover, ExportDialog },
  props: {
    ed: { type: Object, required: true },
  },
}
</script>
