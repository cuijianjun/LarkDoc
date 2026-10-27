<template>
  <!-- P6b 浮层组（评论 / 历史版本 / 分享 / 导出）。
       为什么要有这一层：五条线各自的_panel 全是 `position: fixed`，它们必须是**兄弟**
       —— 祖先一旦有 transform / filter / 非 static 定位，就会改写 fixed 的包含块而漂走
       （`SharePopover.vue` 头部同一条纪律）。而 `LarkDocEditor.vue` 有 <700 行门禁
       （P0-03 门面只做装配），五条线各占一个模板位会把门面撑过线，所以收成一个根节点。

       ⚠️ 包裹层自身**不许**加 transform / filter / overflow / 非 static 定位。
       它也不带任何类名以外的样式：闭合态下五个子节点都不渲染或高度为 0，此处只是一个空 div。

       五个子节点**全部自管理显隐**（各自根节点或首个子节点带 v-if），所以这里**不写 v-if**
       —— 尤其 `ExportDialog`：04 §4.6.7③ 的顺序是「弹窗关闭 → toast」，父级 v-if 会把
       还没消失的 toast 一起摘掉。 -->
  <div class="lark-doc-p6b-layer">
    <!-- P6b-01 评论：正文锚点高亮 + 右侧线程面板（04 §3.1 / 05 §5.5）。 -->
    <CommentPanel :ed="ed" />
    <!-- P6b-02 历史记录：全屏面板 + 另存为版本 Dialog（04 §3.4）。 -->
    <VersionPanel :ed="ed" />
    <SaveVersionDialog :ed="ed" />
    <!-- P6b-03 分享：入口按钮 + popover + 二级权限 Dialog 同属一个组件
         （00-README 行 ~119：一级分享是 popover 不是 Dialog）。 -->
    <SharePopover :ed="ed" />
    <!-- P6b-04 导出：设置弹窗 + 导出 toast（04 §4.6.7）。 -->
    <ExportDialog :ed="ed" />
  </div>
</template>

<script>
// P6b 五条线的挂载点。这里不写任何逻辑 —— 状态机在 `editor/p6bMixin.js` 聚合的五个 mixin
// 里，渲染在各自的 .vue 里，本组件只是把它们按「兄弟」关系排成一个根节点。
//
// `ed` 是 **LarkDocEditor 实例本身**（不是本组件）：父级传的是 `:ed="self"`，
// 这里再原样往下传，面板因此能直接读到 `ed.editor` / `ed.session` / 各 mixin 的 data。
import CommentPanel from '../CommentPanel.vue'
import VersionPanel from '../VersionPanel.vue'
import SaveVersionDialog from '../SaveVersionDialog.vue'
import SharePopover from '../SharePopover.vue'
import ExportDialog from '../ExportDialog.vue'

export default {
  name: 'LarkDocP6bOverlays',
  components: { CommentPanel, VersionPanel, SaveVersionDialog, SharePopover, ExportDialog },
  props: {
    ed: { type: Object, required: true },
  },
}
</script>
