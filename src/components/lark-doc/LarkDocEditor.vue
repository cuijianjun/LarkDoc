<template>
  <section
    ref="root"
    class="lark-doc"
    :class="[`lark-doc-width-${widthMode}`, { 'lark-doc-reading': effectiveReadonly, 'lark-doc-mode-suggest': mode === 'suggest', 'lark-doc-slides': slides, 'lark-doc-fullscreen': fullscreen, 'lark-doc-titlebar-fixed': larkDocConfig.layout.titleBarFixed, 'lark-doc-toolbar-fixed': larkDocConfig.layout.toolbarFixed }]"
    @keydown.esc="closeOverlay"
  >
    <a
      class="lark-doc-skip"
      href="#lark-doc-editor"
    >跳到正文</a>
    <!-- 顶栏 / 工具栏挂载点（阶段 5 批次 2 原生化）：DOM 由 src/ui/topBar.js、src/ui/toolbar.js 建。 -->
    <div ref="topBarHost" />
    <!-- `header-actions` 宿主的停泊位：插槽内容始终由 Vue 渲染，原生层只搬节点（顶栏右侧 / 「⋯」下拉）。 -->
    <div
      ref="actionsPark"
      class="lark-doc-actions-park"
    >
      <div ref="actionsHost">
        <slot name="header-actions" />
      </div>
    </div>
    <!-- P4-06：「已切换为 X 模式」提示。载体是**顶部中性条**（07 §1.1 文案 + 06 §6.2
         `.ud__msg-manager--top` 的 1512×16 @y=32 / z 9999 / fixed），刻意不复用右下角
         `.lark-doc-toast` —— 那是琥珀 error 语义，混用会让人以为切换失败。 -->
    <div
      v-if="modeToast"
      class="lark-doc-mode-toast"
      role="status"
      aria-live="polite"
    >
      {{ modeToast }}
    </div>

    <!-- 工具栏（阶段 5 批次 2 原生化）：DOM 由 src/ui/toolbar.js 建，这里是挂载点。 -->
    <div ref="toolbarHost" />
    <SearchPanel
      ref="searchInput"
      :ed="self"
    />
    <TableTools :ed="self" />
    <!-- `@` 提及面板：锚在光标处，与斜杠菜单互斥（同时只会开一个） -->
    <MentionPanel :ed="self" />
    <!-- 日期提醒日历浮层：点 chip 打开（入口是 DOM 事件，不走插件回调），与菜单/提及互斥 -->
    <ReminderPopover :ed="self" />
    <!-- 日程搜索面板：斜杠「日程」打开，点结果行即插卡片（Esc 刻意不关，02 §26 ⑦） -->
    <CalendarSearchPanel :ed="self" />
    <!-- ISV 按钮配置面板：斜杠三条按钮命令打开（270×386，z600，无 backdrop）。
         与日程面板相反：Esc/取消/点外部都关，关了不建块（02 §22 ⑤-3）。 -->
    <IsvButtonPanel :ed="self" />
    <RevisionPanel :ed="self" />
    <div class="lark-doc-body">
      <button
        v-if="!outlineOpen && featureEnabled('outline')"
        type="button"
        class="lark-doc-outline-reopen"
        aria-label="展开目录"
        title="展开目录"
        @click="outlineOpen = true"
      >
        ☰
      </button>
      <OutlinePanel :ed="self" />
      <main class="lark-doc-main">
        <PaperStage :ed="self" />
        <div
          v-show="!slides"
          class="lark-doc-paper"
          @pointermove="onPaperPointerMove"
          @pointerdown="onReminderChipClick"
        >
          <div ref="blockHandleHost" /><div
            v-if="dropPosition !== null"
            class="lark-doc-drop-line"
            :style="{ top: `${dropLineTop}px` }"
            aria-hidden="true"
          /><div
            id="lark-doc-editor"
            ref="editorEl"
            class="lark-doc-editor-content"
            @keydown="onEditorKeydown"
            @pointerdown="onColumnPointerDown"
            @pointermove="onEditorPointerMove"
            @dragover="onBlockDragOver"
            @drop="onBlockDrop"
          /><CalloutTools :ed="self" /><TableBoundaryTools :ed="self" />
        </div><footer class="lark-doc-status">
          <span>{{ wordCount }}{{ effectiveMaxLength > 0 ? ` / ${effectiveMaxLength}` : '' }} 字 · {{ outline.length }} 个标题</span><span>{{ effectiveReadonly ? '仅阅读' : '输入 / 快速插入' }}</span>
        </footer>
      </main>
      <aside
        v-if="$slots['side-panel']"
        class="lark-doc-external-panel"
      >
        <slot name="side-panel" />
      </aside>
    </div>

    <!-- 划词气泡条的挂载点（阶段 5 批次 1 原生化）：DOM 由 src/ui/bubbleBar.js 建，
         必须是 .lark-doc 里的空容器 —— 气泡条样式全带 `.lark-doc ` 前缀；
         自身 position: fixed，这个空 div 不占布局。 -->
    <div ref="bubbleHost" />
    <!-- 命令菜单的挂载点（阶段 5 批次 3 原生化）：DOM 由 src/ui/commandMenu.js 建，
         自身 position: fixed，这个空 div 不占布局。 -->
    <div ref="commandMenuHost" />
    <ColorPalette :ed="self" />
    <TablePickerDialog :ed="self" />
    <MathDialog :ed="self" />
    <LinkDialog :ed="self" />
    <HelpDialog :ed="self" />
    <HelpFab :ed="self" />
    <EmbedLinkDialog :ed="self" />
    <input
      ref="imageInput"
      type="file"
      accept="image/png,image/jpeg,image/gif,image/webp"
      class="lark-doc-file-input"
      aria-label="选择本地图片"
      @change="onImageInput"
    >
    <!-- P2-04：视频与文件同一个入口。刻意不写 accept —— 02 L4168 实测飞书斜杠 `file`
         的 accept 为 null（不限类型），任何附件都该能被选进来，由上传侧再兜限值。 -->
    <input
      ref="fileInput"
      type="file"
      multiple
      class="lark-doc-file-input"
      aria-label="选择视频或文件"
      @change="onFileInput"
    >
    <p
      v-if="error"
      class="lark-doc-toast"
      role="alert"
    >
      {{ error }} <button
        type="button"
        aria-label="关闭错误"
        @click="error = ''"
      >
        <lark-doc-icon
          :size="14"
          name="close"
        />
      </button>
    </p>
    <!-- 标题编号菜单（继续/重新开始/设置值）+ P6b 浮层组（评论/版本/分享/导出，五条线收在一个容器里只占一个模板位 —— 本文件有 <700 行门禁） -->
    <HeadingNumberMenu :ed="self" /><LarkDocOverlays :ed="self" />
  </section>
</template>

<script>
// LarkDocEditor.vue —— 编辑器视图层：模板、props、生命周期与内容管理核心方法。
// 各 UI 子域拆分到 ./editor/ 下的 mixin（视图模式/命令菜单/表格工具/区块句柄/区块菜单/
// 气泡菜单/高亮块与颜色盘/工具栏菜单），经 Vue 2 选项合并后仍以 this.xxx 供模板与生命周期调用。
// 阶段 2：直接用 core 的 Editor —— `@tiptap/vue-2` 的 Editor 只多一个 contentComponent
// 字段（仅 Vue NodeView 读取），代码块改成 core 原生 NodeView 后已无人使用；
// 挂载也不再走 <editor-content>，改为把容器元素直接交给 core（`element` 选项）。
import { Editor } from '@tiptap/core'
import { DOMParser as ProseMirrorDOMParser } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
import commandMenuUiMixin from './editor/commandMenuUiMixin' // 阶段 5 批次 3：命令菜单渲染层在 src/ui/commandMenu.js
import LarkDocIcon from './LarkDocIcon.vue'
import SearchPanel from './editor/SearchPanel.vue'
import MentionPanel from './editor/MentionPanel.vue'
// P4-02a：日历浮层组件，只渲染；状态与定位全在 reminderMixin。
import ReminderPopover from './editor/ReminderPopover.vue'
// P4-02b：日程搜索面板，只渲染；状态与定位全在 calendarMixin。
import CalendarSearchPanel from './editor/CalendarSearchPanel.vue'
// P4-04：ISV 按钮配置面板，只渲染；表单状态、校验、落块全在 isvMixin。
import IsvButtonPanel from './editor/IsvButtonPanel.vue'
import RevisionPanel from './editor/RevisionPanel.vue' // P4-06：只渲染，状态与定位全在 revisionMixin。
import TableTools from './editor/TableTools.vue'
import OutlinePanel from './editor/OutlinePanel.vue'
import PaperStage from './editor/PaperStage.vue'
import CalloutTools from './editor/CalloutTools.vue'
import TableBoundaryTools from './editor/TableBoundaryTools.vue'
import ColorPalette from './editor/ColorPalette.vue'
import TablePickerDialog from './editor/dialogs/TablePickerDialog.vue'
import MathDialog from './editor/dialogs/MathDialog.vue'
import LinkDialog from './editor/dialogs/LinkDialog.vue'
import HelpDialog from './editor/dialogs/HelpDialog.vue'
import HelpFab from './editor/HelpFab.vue'
import EmbedLinkDialog from './editor/dialogs/EmbedLinkDialog.vue'
import HeadingNumberMenu from './editor/dialogs/HeadingNumberMenu.vue'
import { createLarkDocExtensions } from './extensions'
import { aggregateHeadingContainers, restoreUnknownBlocks, clampBlockIndent, collectOutline, safeAttachmentId, safeUrl, sanitizeHTML, validateDocument } from './documentOperations'
import { isBlockActionEnabled, isConfigEnabled, mergeLegacyConfig } from './larkDocConfig'
// 阶段 2：图片 / 代码块 NodeView 都已下沉为 core 的纯 DOM 实现（`core/nodeviews/*.js`），
// Vue 2 适配层不再注册任何 NodeView。这行 import 保留是为了把**注册表缝**拉起来 ——
// 宿主仍可用 setNodeView(name, renderer) 覆盖 core 默认实现；Task 6 拆三端适配时会挪到宿主入口。
import { registerVue2NodeViews } from '../../adapters/vue2/nodeviews'
import viewModesMixin from './editor/viewModesMixin'
// P7-04：选区高频路径（每按键一轮定位）的帧级合并单独成一支，
// 主组件连 onSelectionUpdate 都不再持有 —— 否则组件自身的同名方法会盖掉 mixin。
import selectionPacingMixin from './editor/selectionPacingMixin'
import commandMenuMixin from './editor/commandMenuMixin'
import tableToolsMixin from './editor/tableToolsMixin'
import toolbarCollapseMixin from './editor/toolbarCollapseMixin'
import toolbarUiMixin from './editor/toolbarUiMixin'
import blockHandleMixin from './editor/blockHandleMixin'
import blockMenuMixin from './editor/blockMenuMixin'
import blockHandleUiMixin from './editor/blockHandleUiMixin' // 阶段 5 批次 3：句柄/块菜单渲染层在 src/ui/blockHandle.js
import blockIndentMixin from './editor/blockIndentMixin'
import overlayDismissMixin from './editor/overlayDismissMixin'
import bubbleMenuMixin from './editor/bubbleMenuMixin'
import calloutColorMixin from './editor/calloutColorMixin'
import toolbarMenusMixin from './editor/toolbarMenusMixin'
import headingNumberMixin from './editor/headingNumberMixin'
// P4-01：`@` 提及面板的状态与动作（打开/关、候选、键盘、落 chip）全在这个 mixin，
// 面板组件只负责渲染 —— 与 SearchPanel 同一套「父传 :ed="self"」范式。
import mentionMixin from './editor/mentionMixin'
// P4-02a：日期提醒（行内 reminder mark + 日历浮层）。入口是「点 chip」这个 DOM 事件，
// 不走 document.js 的插件回调 —— reminder 没有关键词，那条通道没人用。
import reminderMixin from './editor/reminderMixin'
// P4-02b：日程搜索面板的状态与动作（开/关、候选、落块）。与 reminder 的差别在于
// 「插入 ≠ 新建」—— 面板只把**已有日程**引用成块，所有字段都不在面板里编辑。
import calendarMixin from './editor/calendarMixin'
// P4-04：ISV 块（按钮 / 目录导航）的状态机。按钮走「先弹面板 → 校验 → 落块」，
// 目录导航不弹面板、就地插块，两者共用同一个 isv 节点、靠 kind 分叉。
import isvMixin from './editor/isvMixin'
import revisionMixin from './editor/revisionMixin' // P4-06 ③：接受 / 拒绝无二次确认、无 toast。
// 折叠偏好的本设备持久化（三闸门）单独立一支，主组件只留调用点。
import foldPersistMixin from './editor/foldPersistMixin'
import collabMixin from './editor/collabMixin'
// P6b：评论 / 历史版本 / 分享 / 导出 / 三态统一五条线的聚合挂载点（含浮层容器）。
import p6bMixin from './editor/p6bMixin'
import { setTransactionMetadata, TRANSACTION_ORIGINS } from '../../core/transactionMetadata'
// P2-03：图片插入的纯判定（MIME 分流 / 落点归一）在 core/media/image-insert.js，
// 组件只负责「拿编辑器实例去派发」，别再往模板方法里堆边界。
import { IMAGE_REJECT, imageRejectMessage, isImageMime, nearestInsertPosition, sortImageFiles } from '../../core/media/image-insert'
// P2-04：文件 / 视频块与图片共用「分流 → 归一落点 → 逐块插入」这套形状，
// 差别只有「不限 MIME、必须走宿主上传」，判定全在 core/media/file-block.js。
import { fileBlockAttrs, sortFileFiles } from '../../core/media/file-block'
import { createNetworkPolicy } from '../../networkPolicy'
// 旧数据兼容：Vditor getHTML() 产物在 setContent 前归一化。
import { normalizeVditorHtml } from '../../legacy'
// lark-doc.css 由包样式入口（style.css ← src/index.js）统一引入：组件侧重复 import 会让同一份样式在模块图里出现两次。

// 模块一加载就把 Vue 2 NodeView 注册进 core 注册表，等价于过去的静态注入；extensions.js 按节点名查表。
registerVue2NodeViews()

export default {
  name: 'LarkDocEditor',
  components: { LarkDocIcon, SearchPanel, MentionPanel, ReminderPopover, CalendarSearchPanel, IsvButtonPanel, RevisionPanel, TableTools, OutlinePanel, PaperStage, CalloutTools, TableBoundaryTools, ColorPalette, TablePickerDialog, MathDialog, LinkDialog, HelpDialog, EmbedLinkDialog, HeadingNumberMenu, HelpFab },
  mixins: [viewModesMixin, selectionPacingMixin, commandMenuMixin, commandMenuUiMixin, tableToolsMixin, blockHandleMixin, blockHandleUiMixin, blockMenuMixin, blockIndentMixin, bubbleMenuMixin, calloutColorMixin, toolbarMenusMixin, toolbarCollapseMixin, toolbarUiMixin, headingNumberMixin, overlayDismissMixin, mentionMixin, reminderMixin, calendarMixin, isvMixin, revisionMixin, foldPersistMixin, collabMixin, p6bMixin],
  props: {
    value: { type: String, default: '<p></p>' }, title: { type: String, default: '' }, readonly: { type: Boolean, default: false },
    config: { type: Object, default: () => ({}) }, maxLength: { type: Number, default: null }, imageMaxSize: { type: Number, default: null },
    templates: { type: Array, default: () => [] },
    uploadImage: { type: Function, default: null }, msgId: { type: [Number, String], default: null },
    // P2-04：文件 / 视频块必须走宿主上传（10 GB 的附件不可能内联成 data URI），
    // 没传 uploadFile 时该入口只报错、不落半截块。
    uploadFile: { type: Function, default: null },
    // 只存附件 token、不存直链的宿主可注入这条换票函数（token → 可渲染地址）。
    resolveFileUrl: { type: Function, default: null },
    session: { type: Object, default: null },
    // 'auto' 按指纹识别 Vditor HTML；'vditor' 强制归一化；'html' 明确跳过归一化。
    contentFormat: { type: String, default: 'auto' },
    // 折叠偏好持久化键（通常传 documentId）：非空时章节折叠状态按标题稳定键
    // 存入本设备 localStorage，刷新后恢复（需求文档 13.6.1 V1 本地偏好）。
    foldPersistKey: { type: String, default: '' },
    // P3-07：内嵌内容的宿主回调。六项全部可选，缺省即退回 core 默认行为
    // （标题不同步 / iframe 存盘只回 ok / 卡片动作自己 window.open / URL 卡只显示域名）。
    onEmbedTitle: { type: Function, default: null },
    onEmbedSave: { type: Function, default: null },
    onEmbedCardAction: { type: Function, default: null },
    embedProviders: { type: Array, default: null },
    onBookmarkOpen: { type: Function, default: null },
    unfurlProvider: { type: Function, default: null },
    // iframe 的 sandbox / allow 覆盖通道：不传即安全基线（无 allow-same-origin）。
    embedSandbox: { type: String, default: null },
    embedAllow: { type: String, default: null },
    // P4-01：提及候选来源。数组 = 静态名单；函数 = `(keyword, kind) => Promise<item[]>`
    // （宿主自己查通讯录 / 云文档）；对象 = `{ user: [...], chat: [...], page: [...] }`。
    // 不传即用 core 内置的演示目录（core/mention/directory.js），保证开箱可用。
    mentionSource: { type: [Array, Function, Object], default: null },
    // P4-02b：日程候选来源。数组 = 静态「我参与的未来日程」；函数 = `(options) => Promise<item[]>`
    // （`options` 恒为 `{ query: '', range: 'future' }`，关键词不往上游传 —— 只匹配标题是本地口径）；
    // 对象 = `{ search(options) }`（对应 04 §4.7 ⑥ 的 `calendar.search`）。
    // 不传即空列表：本库没有日历服务，不该编一份假日程来演示。
    calendarSource: { type: [Array, Function, Object], default: null },
    // 点卡片「加入日程」时回调（`{ eventId, title }`）；不传则按钮只做展示。
    onCalendarEventJoin: { type: Function, default: null },
    // 重新拉取某条日程的最新快照（`(eventId) => item | null`）。卡片字段允许过期，
    // 但刷新时机由宿主决定（飞书是打开文档/重连时拉），本库不自动轮询。
    calendarEventRefetch: { type: Function, default: null },
  },
  data() { return {
    editor: null, localTitle: this.title,
    alignNames: { left: '左', center: '居中', right: '右', justify: '两端' }, alignGlyphs: { left: '≡', center: '☷', right: '≣', justify: '▤' },
    helpOpen: false, savedSelection: null,
    error: '', pendingHTML: null, htmlSeeded: false,
    pendingStateFrame: null, pendingChangeTimer: null,
  } },
  computed: {
    // 拆分出的子组件（editor/*.vue）经实例 prop 引用本组件：模板里写 :ed="self"。
    self() { return this },
    // ECS 的 ref.html 与新页面 v-model 使用同一正文，保留原调用方的读写契约。
    larkDocConfig() { return mergeLegacyConfig(this.config, { maxLength: this.maxLength, imageMaxSize: this.imageMaxSize }) },
    maxBlockIndent() { return clampBlockIndent(this.larkDocConfig.limits.maxIndent) },
    effectiveMaxLength() { return Math.max(0, Number(this.larkDocConfig.limits.maxLength) || 0) },
    effectiveImageMaxSize() { return this.larkDocConfig.limits.maxImageSize },
    effectiveFileMaxSize() { return this.larkDocConfig.limits.maxFileSize },
    titleLength() { return this.larkDocConfig.limits.titleLength },
    visibleBlockActions() { return this.blockActions.filter((item) => isBlockActionEnabled(this.larkDocConfig, item.id)) },
    visibleBlockTypeActions() {
      return this.blockTypeActions.filter((item) => {
        const feature = item.id === 'codeBlock' ? 'codeBlocks' : 'blockStyle'
        return isConfigEnabled(this.larkDocConfig, feature) && isBlockActionEnabled(this.larkDocConfig, item.id)
      })
    },
    visibleBlockListActions() {
      const list = this.visibleBlockActions.filter((item) => item.id !== 'duplicate')
      // 表格分支没有类型网格与独立副本按钮，创建副本回到操作列表里，不丢功能。
      if (this.handleIsTable && isBlockActionEnabled(this.larkDocConfig, 'duplicate')) {
        const dup = this.blockActions.find((item) => item.id === 'duplicate')
        if (dup) return [dup, ...list]
      }
      return list
    },
    html: {
      get() { return this.editor?.getHTML() || this.pendingHTML || this.value || '<p></p>' },
      set(value) { this.htmlSeeded = true; if (this.editor) this.setContent(value); else this.pendingHTML = value },
    },
    effectiveReadonly() { return this.readonly || this.reading || this.slides || (this.session && typeof this.session.can === 'function' && !this.session.can('canEdit')) },
    hasTextSelection() { return !!this.editor && !this.editor.state.selection.empty },
    // P3-07：内嵌内容的宿主回调整包转发给扩展装配。这些回调只在建编辑器时读一次
    // （NodeView 建好后再换函数不会重挂），所以不需要 watch，也不该进响应式依赖。
    embedOptions() {
      return {
        onEmbedTitle: this.onEmbedTitle, onEmbedSave: this.onEmbedSave, onEmbedCardAction: this.onEmbedCardAction,
        embedProviders: this.embedProviders, onBookmarkOpen: this.onBookmarkOpen, unfurlProvider: this.unfurlProvider,
        embedSandbox: this.embedSandbox, embedAllow: this.embedAllow,
        // P4-02b：日程块的两个宿主回调（与上面同一口径：NodeView 建好后再换不重挂）。
        onCalendarEventJoin: this.onCalendarEventJoin, calendarEventRefetch: this.calendarEventRefetch,
      }
    },
  },
  watch: {
    title(value) { if (value !== this.localTitle) this.localTitle = value },
    value(value) { if (this.editor && value !== this.editor.getHTML()) { try { this.setContent(value) } catch (error) { this.error = error.message } } },
    maxLength() { if (this.editor) { this.editor.storage.characterCount.setLimit(this.effectiveMaxLength); this.refreshDocumentState() } },
    config: { deep: true, handler() {
      if (this.editor) this.editor.storage.characterCount.setLimit(this.effectiveMaxLength)
      this.$nextTick(() => this.refreshDocumentState())
    } },
    effectiveReadonly(value) { if (this.editor) { this.editor.setEditable(!value); this.editor.emit('editableUpdate', { editable: !value }); this.closeCommandMenu(); this.closeMentionPanel(); this.closeReminderPopover(); this.closeCalendarSearch(); this.headingOpen = false; this.headingStyle = {}; this.closeBlockMenu(); this.clearHandleHighlight(); this.colorPaletteOpen = ''; this.closeEmbedDialog(); this.bubbleVisible = false; this.closeBubbleAlignMenu(); if (value) this.tableBoundary.visible = false; else this.$nextTick(() => this.updateTableBoundary()); this.$emit('mode-change', { readonly: value }) } },
    tablePicker(value) { if (value) { this.tablePickerHover = { rows: 3, cols: 3 }; this.$nextTick(() => this.$refs.root?.querySelector('.lark-doc-table-grid button')?.focus()) } },
    helpOpen(value) { if (value) this.$nextTick(() => this.$refs.root?.querySelector('[aria-label="关闭快捷键帮助"]')?.focus()) },
    linkDialog(value) { if (value) this.$nextTick(() => this.$refs.root?.querySelector(this.linkInsertMode ? '[aria-label="链接文本"]' : '[aria-label="链接地址"]')?.focus()) },
    embedDialog(value) { if (value) this.$nextTick(() => this.$refs.root?.querySelector('[aria-label="内嵌网页链接"]')?.focus()) },
  },
  mounted() {
    // 阶段 5 批次 2：顶栏已原生化（`src/ui/topBar.js`）。先挂它 —— 它不依赖编辑器实例，
    // 放在最前面可以保证「编辑器创建失败」时页头仍然是完整的。
    this.mountTopBar()
    // P4-06：模式是当前用户维度的状态，刷新/重开后保持（07 §1.1）。
    // 在编辑器创建前恢复，`editable: !this.effectiveReadonly` 第一次就是对的。
    this.restoreMode()
    try {
      let initialHTML = this.pendingHTML === null ? this.value || '<p></p>' : this.pendingHTML
      const hasInitialValue = Object.prototype.hasOwnProperty.call(this.$options.propsData || {}, 'value')
      if (!hasInitialValue && !this.htmlSeeded && (!initialHTML.trim() || initialHTML === '<p></p>') && this.msgId !== null) {
        // 未提供初始正文才只读兼容旧缓存；显式空 value 也是宿主的正文选择。
        try { const cached = localStorage.getItem(String(this.msgId)); if (cached) initialHTML = cached } catch (_) { this.error = '浏览器阻止读取公告缓存' }
      }
      // 原生挂载（阶段 2）：容器 div 由模板常驻，core 的 Editor 收到 element 后
      // 自己在该容器里建 EditorView —— 不再需要 <editor-content> 这层 Vue 包装。
      this.editor = new Editor({
        element: this.$refs.editorEl,
        content: this.collabOptions ? undefined : this.prepareHTML(initialHTML), editable: !this.effectiveReadonly,
        extensions: createLarkDocExtensions({ ...this.embedOptions, collab: this.collabOptions || undefined, maxLength: this.effectiveMaxLength, config: this.larkDocConfig, resolveImageFile: this.resolveImageFile, resolveFileUrl: this.resolveFileUrl, onSlash: this.onSlash, onMention: this.onMention, onHeadingNumberMenu: (payload) => this.openHeadingNumberMenu(payload), onListNumberMenu: (payload) => this.openListNumberMenu(payload), onImageFiles: this.insertImageFiles, onBackspace: () => this.deletePreviousBlockOnBackspace(), onError: (message) => { this.error = message } }),
        onUpdate: ({ transaction }) => this.onUpdate(transaction), onTransaction: () => { this.syncFoldState(); this.persistFolds(); this.updateRevisionPanels(); this.refreshToolbar(); if (this.blockMenuOpen) this.refreshBlockMenu(); this.$nextTick(() => { this.syncHandleHighlightBackdrop(); this.syncTableClip() }) }, onSelectionUpdate: () => { this.onSelectionUpdate(); this.refreshToolbar() },
      })
      this.session?.attachEditor(this.editor)
      this._sessionCapabilitiesOff = this.session?.on?.('capabilities', () => this.$forceUpdate()) || null
      // 阶段 5 批次 1：气泡条已原生化（`src/ui/bubbleBar.js`），编辑器就绪后挂一次。
      this.mountBubbleBar()
      // 阶段 5 批次 2：工具栏已原生化（`src/ui/toolbar.js`），同样在编辑器就绪后挂一次。
      this.mountToolbarBar()
      this.mountBlockHandle() // 阶段 5 批次 3：块句柄/块菜单原生化，依赖 editor 判可见性。
      this.mountCommandMenu() // 阶段 5 批次 3：命令菜单原生化（`src/ui/commandMenu.js`）。
      // 首次挂载先补齐块的稳定 id：折叠偏好、锚点都按 id 引用块；没 id 就恢复不出折叠位。
      if (this.editor.commands && typeof this.editor.commands.ensureLarkDocBlockIds === 'function') this.editor.commands.ensureLarkDocBlockIds()
      // 老数据或外部 JSON 的缩进可能超过飞书上限（5 级），挂载/替换正文后一次性压回。
      if (this.editor.commands && typeof this.editor.commands.normalizeLarkDocIndents === 'function') this.editor.commands.normalizeLarkDocIndents()
      this.refreshDocumentState()
      this.restoreFolds()
      this.$nextTick(() => this.updateTableBoundary())
      this.$emit('mode-change', { readonly: this.effectiveReadonly })
      this.$nextTick(() => this.$emit('ready', this.editor))
      document.addEventListener('fullscreenchange', this.onFullscreenChange)
      window.addEventListener('keydown', this.onWindowKeydown)
      window.addEventListener('scroll', this.onDocumentScroll, true)
      window.addEventListener('resize', this.onDocumentScroll)
      window.addEventListener('pointerup', this.onHandlePointerUp)
      document.addEventListener('pointerdown', this.onDocumentPointerDown, true)
      window.addEventListener('pointermove', this.onDocumentPointerMove, true)
    } catch (error) { this.error = error.message }
  },
  beforeDestroy() {
    // 原生挂载后 ProseMirror 的 DOM 挂在 Vue 容器里：必须先于 Vue 卸载子树销毁编辑器
    // （EditorContent 时代的 beforeDestroy 做的就是这件事——把 PM 的 DOM 搬出去再销毁）。
    if (this.session && this.editor) this.session.detachEditor(this.editor)
    this.editor?.destroy()
    this.editor = null
    // 原生气泡条 / 块句柄都持有 DOM 与定时器，先拆掉再走后面的收尾（watcher 会读到 _bubbleUi 为 null）。
    this.destroyBubbleBar(); this.destroyBlockHandle(); this.destroyCommandMenu()
    document.removeEventListener('fullscreenchange', this.onFullscreenChange); window.removeEventListener('keydown', this.onWindowKeydown); window.removeEventListener('scroll', this.onDocumentScroll, true); window.removeEventListener('resize', this.onDocumentScroll); window.removeEventListener('pointerup', this.onHandlePointerUp); window.removeEventListener('pointermove', this.onColumnPointerMove); window.removeEventListener('pointerup', this.onColumnPointerUp); document.removeEventListener('pointerdown', this.onDocumentPointerDown, true); window.removeEventListener('pointermove', this.onDocumentPointerMove, true); this._sessionCapabilitiesOff?.(); clearTimeout(this.handleHideTimer); clearTimeout(this.blockMenuCloseTimer); clearTimeout(this.pendingChangeTimer); if (this.pendingStateFrame) cancelAnimationFrame(this.pendingStateFrame); this.clearHandleHighlight(); this.closeBubbleAlignMenu(); if (this._outlineFrame) cancelAnimationFrame(this._outlineFrame); this.closeCommandMenu(); this.dragging = null   },
  methods: {
    featureEnabled(name) { return isConfigEnabled(this.larkDocConfig, name) },
    toolbarEnabled(name) { return this.larkDocConfig.toolbar[name] !== false && this.featureEnabled(name) },
    isBlockActionEnabled(id) { return isBlockActionEnabled(this.larkDocConfig, id) },
    getEditor() { return this.editor }, getHTML() { return this.editor?.getHTML() || '' }, getJSON() { return this.editor ? aggregateHeadingContainers(restoreUnknownBlocks(this.editor.getJSON())) : null }, getText() { return this.editor?.getText() || '' },
    focus() { this.editor?.commands.focus() },
    /**
     * 统一内容准备：旧数据（Vditor HTML）归一化 + 安全清洗。
     * 初始内容与 setContent 都走这里，避免两条路径行为不一致。
     */
    prepareHTML(content, format) {
      let mode = format || this.contentFormat || 'auto'
      if (mode === 'wangeditor') {
        // 0.4.0 起不再支持 wangEditor，老宿主传旧枚举时降级为自动识别，避免直接抛错。
        if (!this._legacyFormatWarned) {
          this._legacyFormatWarned = true
          console.warn("[lark-doc] contentFormat 'wangeditor' 已不支持，按 'auto' 处理")
        }
        mode = 'auto'
      }
      const legacy = normalizeVditorHtml(content, { force: mode === 'vditor', skip: mode === 'html' })
      if (legacy.converted) {
        this.lastImportReport = legacy.report
        this.$emit('import-report', legacy.report)
      }
      return sanitizeHTML(legacy.html)
    },
    setContent(content, options = {}) {
      if (!this.editor) return false
      const schema = this.editor.schema
      let json
      if (typeof content === 'string') {
        const safe = this.prepareHTML(content, options.format)
        const container = document.createElement('div'); container.innerHTML = safe
        json = ProseMirrorDOMParser.fromSchema(schema).parse(container).toJSON()
      } else json = validateDocument(content, schema)
      // 离线策略在这里统一生效：外链图片降级为占位，避免渲染时发起外部请求。
      // 复用扩展里那一个实例（装配层创建，见 extensions.js）—— 旧宿主会绕过 Vue
      // 计算属性直接调用本方法，没有扩展句柄时才按默认策略现造。
      const network = this.editor.storage.larkDoc?.network || createNetworkPolicy(this.larkDocConfig ? this.larkDocConfig.network : null)
      json = network.applyDocument(json)
      const next = schema.nodeFromJSON(validateDocument(json, schema))
      // Keep this method usable by the legacy imperative API and small host-side
      // harnesses that call it without Vue's computed properties.
      const maxLength = this.effectiveMaxLength !== undefined
        ? this.effectiveMaxLength
        : Math.max(0, Number(this.maxLength) || 0)
      if (maxLength > 0 && this.editor.storage.characterCount.characters({ node: next }) > maxLength) throw new Error(`正文不能超过 ${maxLength} 字`)
      if (next.eq(this.editor.state.doc)) return false
      // Content replacement invalidates the transient handle/menu target.
      if (typeof this.closeBlockMenu === 'function') this.closeBlockMenu()
      this.handleRange = null
      // 内容替换期间先关闭折叠写回：reset → 恢复之间不能把偏好写成空数组。
      this._foldsReady = false
      // 使用普通事务替换正文，让本地历史可撤销模板、导入与快照恢复。
      const tr = this.editor.state.tr.replaceWith(0, this.editor.state.doc.content.size, next.content)
      this.editor.view.dispatch(setTransactionMetadata(tr, { origin: TRANSACTION_ORIGINS.HOST }))
      if (this.editor.commands && typeof this.editor.commands.resetLarkDocFolds === 'function') this.editor.commands.resetLarkDocFolds()
      // 老文档（或外部 JSON）可能没有 blockId：先补号再按 id 恢复折叠偏好。
      if (this.editor.commands && typeof this.editor.commands.ensureLarkDocBlockIds === 'function') this.editor.commands.ensureLarkDocBlockIds()
      // 老数据或外部 JSON 的缩进可能超过飞书上限（5 级），挂载/替换正文后一次性压回。
      if (this.editor.commands && typeof this.editor.commands.normalizeLarkDocIndents === 'function') this.editor.commands.normalizeLarkDocIndents()
      // 内容替换后按持久化键恢复折叠偏好（加载草稿 / 恢复快照共用此路径）。
      if (typeof this.restoreFolds === 'function') this.restoreFolds()
      this.savedSelection = null
      this.editor.view.dispatch(closeHistory(this.editor.state.tr))
      return true
    },
    updateTitle(value) { if (this.effectiveReadonly) return; this.localTitle = value; this.$emit('update:title', value) },
    onUpdate(transaction) {
      this.scheduleDocumentState()
      // 补 blockId 的事务只改属性、不改正文：不能当成一次内容修改冒泡给宿主，
      // 否则打开文档就会立刻被标记成「有未保存的改动」。
      if (transaction && transaction.getMeta && (transaction.getMeta('larkDocBlockIds') || transaction.getMeta('larkDocIndentNormalized'))) return
      const publish = () => {
        if (!this.editor || this._isBeingDestroyed || this._isDestroyed) return
        const html = this.getHTML()
        this.$emit('input', html)
        this.$emit('change', { html, json: this.getJSON(), text: this.getText() })
      }
      clearTimeout(this.pendingChangeTimer)
      const delay = this.larkDocConfig.performance.changeDebounce
      this.pendingChangeTimer = delay > 0 ? setTimeout(publish, delay) : null
      if (!delay) publish()
    },
    scheduleDocumentState() {
      if (!this.editor) return
      if (!this.larkDocConfig.performance.stateUpdateFrame) {
        this.refreshDocumentState()
        this.$nextTick(() => this.updateHandleAndTable())
        return
      }
      if (this.pendingStateFrame) return
      this.pendingStateFrame = requestAnimationFrame(() => {
        this.pendingStateFrame = null
        if (!this.editor || this._isBeingDestroyed || this._isDestroyed) return
        this.refreshDocumentState()
        this.$nextTick(() => this.updateHandleAndTable())
      })
    },
    updateHandleAndTable() {
      if (!this.editor) return
      this.updateTableBoundary()
      if (!this.handleRange) return
      const { from, to } = this.handleRange
      const doc = this.editor.state.doc
      if (from < 0 || from >= to || to > doc.content.size) { this.closeBlockMenu(); this.handleRange = null; return }
      const start = doc.resolve(from)
      const end = doc.resolve(to)
      if (!start.sameParent(end) || start.textOffset || end.textOffset || from !== start.posAtIndex(start.index(), start.depth) || to !== end.posAtIndex(end.index(), end.depth)) {
        this.closeBlockMenu()
        this.handleRange = null
      } else this.positionBlockHandle(this.handleRange)
    },
    refreshDocumentState() {
      if (!this.editor) return
      // 实测目录覆盖上去的同一时刻落下水合闸门（P7-03 早期目录的 `outlinePending`）：
      // 此后 `outline` 里的 pos 就是当前正文算出来的，按下去不会落空。
      this.outlinePending = false
      this.outline = collectOutline(this.editor.state.doc)
      this.syncOutlineCollapseState()
      this.syncFoldState()
      this.wordCount = this.editor.storage.characterCount.characters()
      if (this.effectiveMaxLength > 0 && this.wordCount > this.effectiveMaxLength) this.error = `正文不能超过 ${this.effectiveMaxLength} 字，请缩短正文`
      else if (this.error.startsWith('正文不能超过 ')) this.error = ''
      if (this.searchQuery) this.scheduleSearchUpdate()
    },
    // syncFoldState / syncOutlineCollapseState 在 viewModesMixin（视图级状态的那一支）。
    // onSelectionUpdate 已下沉到 editor/selectionPacingMixin.js（P7-04 帧级合并）。
    onDocumentScroll() {
      if (this._outlineFrame || !this.editor) return
      this._outlineFrame = requestAnimationFrame(() => {
        this._outlineFrame = null
        if (!this.blockMenuOpen && !this.blockTypeMenuOpen && !this.handlePressed) this.positionBlockHandle(this.handleRange || this.currentBlockRange())
        this.syncHandleHighlightBackdrop()
        if (this.blockAlignMenuOpen) this.positionBlockAlignMenu()
        if (this.blockColorMenuOpen) this.positionBlockColorMenu()
        if (this.bubbleAlignOpen) this.positionBubbleAlignMenu()
        this.updateTableBoundary()
        if (this.headingOpen) this.positionHeadingMenu()
        if (this.menuOpen) this.positionCommandMenu()
        this.updateCalloutTools()
        let visible = -1
        for (const item of this.outline) {
          const dom = this.editor.view.nodeDOM(item.pos)
          if (dom instanceof Element && dom.getBoundingClientRect().top <= 170) visible = item.pos
          else if (visible !== -1) break
        }
        if (visible !== -1) this.activeHeading = visible
      })
    },
    rememberSelection(includeCursor = false) { if (!this.editor) return; const { from, to } = this.editor.state.selection; if (from !== to || includeCursor) this.savedSelection = { from, to } },
    restoreSelection(includeCursor = false) { if (!this.editor || !this.savedSelection || !(this.editor.state.selection instanceof TextSelection)) return; const { from, to } = this.savedSelection; const size = this.editor.state.doc.content.size; if ((from !== to || includeCursor) && from <= size && to <= size) this.editor.view.dispatch(this.editor.state.tr.setSelection(TextSelection.create(this.editor.state.doc, from, to))) },
    // `writable()` 退役了 —— 可写判定统一归 `editor/readingModeMixin.js`（P6b-05 三态口径）。
    // 这里不能留同名实现：Vue 2 里组件自身的 methods 会覆盖 mixin 的同名方法。
    run(command, ...args) { if (!this.writable()) return false; this.restoreSelection(); const chain = this.editor.chain().focus(); const method = chain[command]; return typeof method === 'function' ? method(...args).run() : false },
    isActive(name) { return !!this.editor?.isActive(name) },
    toggleMark(name) { if (!this.featureEnabled('marks')) return; const command = `toggle${name[0].toUpperCase()}${name.slice(1)}`; this.run(command); this.bubbleVisible = false; this.closeBubbleAlignMenu() },
    setTextStyle(attribute, value) { if (!value) return; const command = `set${attribute[0].toUpperCase()}${attribute.slice(1)}`; this.run(command, value) },
    // 自绘下拉（LarkDocSelect）的回调：应用样式并记住最近值，供触发按钮回显。
    applyTextStyle(key, value) { this.setTextStyle(key, value); this.appliedTextStyle[key] = value },
    applyTextColor(value) { this.setTextStyle('color', value); this.appliedTextStyle.textColor = value },
    applyTextBackground(value) { this.setTextStyle('backgroundColor', value); this.appliedTextStyle.backgroundColor = value },
    applyLineHeight(value) { this.setBlockAttribute('lineHeight', value); this.appliedTextStyle.lineHeight = value },
    applyCellAlign(key, value) { this.cellAttribute(key, value); this.cellAlignState[key] = value },
    setBlockAttribute(name, value, type) {
      if (!this.writable() || value === null || value === undefined || value === '') return
      this.restoreSelection()
      const block = type || (this.editor.isActive('heading') ? 'heading' : 'paragraph')
      // 缩进只有一个上限：所有入口（工具栏/气泡/块菜单/快捷键）都走 clampBlockIndent。
      const next = name === 'indent' ? clampBlockIndent(value, this.maxBlockIndent) : value
      this.editor.chain().focus().updateAttributes(block, { [name]: next }).run()
    },
    // 缩进五连已下沉到 editor/blockIndentMixin.js：工具栏 / 气泡条 / 块菜单 / 快捷键
    // 四个入口共用，不再是本组件的私有方法。
    setAlign(value) { this.run('setTextAlign', value) },
    clearFormatting() { if (!this.writable()) return; this.restoreSelection(); this.editor.chain().focus().unsetAllMarks().clearNodes().run() },
    cellAttribute(name, value) { if (value) this.run('setCellAttribute', name, value) },
    onImageInput(event) { const files = Array.from(event.target.files || []); event.target.value = ''; this.insertImageFiles(files) },
    onFileInput(event) { const files = Array.from(event.target.files || []); event.target.value = ''; this.insertFileBlocks(files) },
    async resolveImageFile(file) {
      // Keep the imperative upload boundary compatible with older ECS hosts
      // that call the method with a small plain object instead of a Vue vm.
      const imagesEnabled = typeof this.featureEnabled === 'function' ? this.featureEnabled('images') : true
      const maxImageSize = this.effectiveImageMaxSize !== undefined
        ? this.effectiveImageMaxSize
        : Math.max(1, Number(this.imageMaxSize) || 5 * 1024 * 1024)
      if (!this.writable() || !imagesEnabled) return null
      if (!isImageMime(file.type)) throw new Error(imageRejectMessage(IMAGE_REJECT.MIME))
      if (file.size > maxImageSize) throw new Error(imageRejectMessage(IMAGE_REJECT.SIZE, { maxSize: maxImageSize }))
      if (this.uploadImage) {
        const uploaded = await this.uploadImage(file)
        if (!this.writable()) return null
        const attchId = typeof uploaded?.attchId === 'string' || Number.isFinite(uploaded?.attchId) ? String(uploaded.attchId) : null
        if (!safeUrl(uploaded?.url, true) || !safeAttachmentId(attchId)) throw new Error('图片上传未返回有效地址或附件 ID')
        return { src: uploaded.url, attchId }
      }
      const src = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = () => reject(new Error('本地图片读取失败'))
        reader.readAsDataURL(file)
      })
      if (!this.writable()) return null
      if (!safeUrl(src, true)) throw new Error('本地图片格式无效')
      return { src, attchId: null }
    },
    async insertImageFiles(files, pos) {
      if (!this.writable() || !this.featureEnabled('images')) return
      // 一次拖拽 / 粘贴可能混进非图片（PDF 与 PNG 一起框选是常见操作）：
      // 先分流，非图片只报一条错、不阻断，剩下的图片按原顺序逐张落块。
      const { accepted, rejected } = sortImageFiles(files, { maxSize: this.effectiveImageMaxSize })
      if (!accepted.length) { if (rejected.length) this.error = rejected[0].message; return }
      this.error = rejected.length ? rejected[0].message : ''
      // 拖拽给的 pos 可能落在块边界（拖到两块之间）或文档之外，先归一成能安全
      // setTextSelection 的文本位置；没有 pos / 归一失败时按当前选区插入。
      let anchor = Number.isInteger(pos) ? nearestInsertPosition(this.editor.state.doc, pos) : null
      for (const file of accepted) {
        try {
          const image = await this.resolveImageFile(file)
          // 上传期间文档可能被切只读或组件已卸载：停止后续插入，已完成的不回滚。
          if (!this.writable()) return
          if (!image) continue
          if (anchor !== null) this.editor.commands.setTextSelection(anchor)
          this.editor.chain().focus().setImage({ ...image, originalSrc: image.src, originalAttchId: image.attchId, alt: file.name }).run()
          // 下一张必须接在刚插入的这张之后，否则多张图会全堆在第一张的位置上。
          if (anchor !== null) anchor = this.editor.state.selection.to
        } catch (error) { this.error = error?.message || '图片上传失败' }
      }
    },
    /**
     * 文件 / 视频的上传边界（P2-04）。
     *
     * 与 resolveImageFile 的关键差异：**没有 FileReader 兜底**。10 GB 上限的附件
     * 不可能内联成 data URI，所以没配 uploadFile 就直接报错——宁可不落块，
     * 也不产生一个「有壳没内容」的半截块。
     */
    async resolveFile(file) {
      const filesEnabled = typeof this.featureEnabled === 'function' ? this.featureEnabled('files') : true
      if (!this.writable() || !filesEnabled) return null
      const upload = this.uploadFile
      if (typeof upload !== 'function') throw new Error('未配置文件上传：请通过 uploadFile 传入上传实现')
      const uploaded = await upload(file)
      if (!this.writable()) return null
      const attrs = fileBlockAttrs(file, uploaded || {})
      // token 与 src 至少有一个，块才渲染得出来（02 §19.5 ⑤ 的字段契约）。
      if (!safeAttachmentId(attrs.token) && !(attrs.src && safeUrl(attrs.src, true))) {
        throw new Error('文件上传未返回有效地址或附件 ID')
      }
      return attrs
    },
    async insertFileBlocks(files, pos) {
      if (!this.writable() || !this.featureEnabled('files')) return
      const { accepted, rejected } = sortFileFiles(files, { maxSize: this.effectiveFileMaxSize })
      if (!accepted.length) { if (rejected.length) this.error = rejected[0].message; return }
      // 有被拒的也照样插能插的：一条 toast 说清原因，不阻断其余文件。
      this.error = rejected.length ? rejected[0].message : ''
      let anchor = Number.isInteger(pos) ? nearestInsertPosition(this.editor.state.doc, pos) : null
      for (const file of accepted) {
        try {
          const attrs = await this.resolveFile(file)
          if (!this.writable()) return
          if (!attrs) continue
          if (anchor !== null) this.editor.commands.setTextSelection(anchor)
          this.editor.chain().focus().setFileBlock(attrs).run()
          // 下一个必须接在刚落的块之后，否则多选的文件会全堆在同一个位置。
          if (anchor !== null) anchor = this.editor.state.selection.to
        } catch (error) { this.error = error?.message || '文件上传失败' }
      }
    },
    onDocumentPointerMove(event) {
      const root = this.$refs.root
      if (!root || root.contains(event.target)) return
      if (!event.target.closest?.('.lark-doc-block-handle, .lark-doc-callout-tools')) this.scheduleHandleHide()
    },
  },
}
</script>
