<template>
  <!-- P6b 浮层组（评论 / 历史版本 / 分享 / 导出）。
       为什么要有这一层：五条线各自的_panel 全是 `position: fixed`，它们必须是**兄弟**
       —— 祖先一旦有 transform / filter / 非 static 定位，就会改写 fixed 的包含块而漂走
       （`SharePopover.vue` 头部同一条纪律）。而 `LarkDocEditor.vue` 有 <700 行门禁
       （P0-03 门面只做装配），五条线各占一个模板位会把门面撑过线，所以收成一个根节点。

       ⚠️ 包裹层自身**不许**加 transform / filter / overflow / 非 static 定位。
       它也不带任何类名以外的样式：闭合态下五个子节点都不渲染或高度为 0，此处只是一个空 div。

       ⚠️ 封面**槽**（`CoverSlot.vue`）不在这里 —— 它是文档流内元素（纸张之上、标题之前），
       塞进 fixed 层会脱离流。这里注册的 `CoverPanel` 只是它的操作面板。

       十三个子节点**全部自管理显隐**（各自根节点或首个子节点带 v-if），所以这里**不写 v-if**
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
    <!-- 顶栏「更多」23 项菜单 + 二级子面板（04 §4.2.1 / §4.2，z 1030 / 1050）。 -->
    <TopbarMoreMenu :ed="ed" />
    <!-- 链接悬浮卡（04 §1.6，hover ≥1.2s，z 600 / 999）。 -->
    <LinkHoverCard :ed="ed" />
    <!-- 文档封面：空态槽 + 已添加槽 + 「编辑封面」面板（04 §1.4，z 78 / 80）。 -->
    <CoverPanel :ed="ed" />
    <!-- 代码语言选择器（04 §2.2，219×317，71 语言 + 搜索，z 1030）。 -->
    <CodeLangPicker :ed="ed" />
    <!-- 浮层矩阵补齐线四件（`docs/blocks/overlays.md` 的四个 ⬜）。
         同样全部自管理显隐，这里**不写 v-if**：
           · `ConfirmDialog` 的显隐由 `ed.confirmOpen` 驱动，但它要活在
             `confirmDialog()` 返回的 Promise 生命周期里 —— 父级 v-if 会把
             「关掉动画/遮罩」一起摘掉；
           · `CreateMenu` / `NotifyPopover` 是锚定 popover，显隐即 `createMenuOpen` /
             `notifyOpen`，留着空节点供 `measure*` 量尺寸（`closeCreateMenu` 后
             `measure` 还要能读到 ref）。 -->
    <!-- 通用二次确认框（04 §4.9，420×180，z 1000）。全库唯一的破坏性操作确认层。 -->
    <ConfirmDialog :ed="ed" />
    <!-- 顶栏「新建」13 行菜单（04 §4.6.5，182×509，z 1030）。 -->
    <CreateMenu :ed="ed" />
    <!-- 当前文档通知 popover（04 §4.6.4，402×555，z 999）。 -->
    <NotifyPopover :ed="ed" />
    <!-- 关联已有多维表格（04 §4.5，1080×676，z 1000）。 -->
    <RelationBitableDialog :ed="ed" />
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
// UI 补齐线四个浮层：全部 `position: fixed`，同样必须是兄弟节点。
import TopbarMoreMenu from './TopbarMoreMenu.vue'
import LinkHoverCard from './LinkHoverCard.vue'
import CoverPanel from './CoverPanel.vue'
import CodeLangPicker from './CodeLangPicker.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import CreateMenu from './CreateMenu.vue'
import NotifyPopover from './NotifyPopover.vue'
import RelationBitableDialog from './RelationBitableDialog.vue'

export default {
  name: 'LarkDocP6bOverlays',
  components: {
    CommentPanel,
    VersionPanel,
    SaveVersionDialog,
    SharePopover,
    ExportDialog,
    TopbarMoreMenu,
    LinkHoverCard,
    CoverPanel,
    CodeLangPicker,
    ConfirmDialog,
    CreateMenu,
    NotifyPopover,
    RelationBitableDialog,
  },
  props: {
    ed: { type: Object, required: true },
  },
}
</script>
