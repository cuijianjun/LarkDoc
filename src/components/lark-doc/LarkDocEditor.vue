<template>
  <section
    ref="root"
    class="lark-doc"
    :class="[`lark-doc-width-${widthMode}`, { 'lark-doc-reading': effectiveReadonly, 'lark-doc-comments-open': commentRemote && commentSidebarOpen, 'lark-doc-mode-suggest': mode === 'suggest', 'lark-doc-slides': slides, 'lark-doc-slide-pages': slides && presentationMode !== 'document', 'lark-doc-fullscreen': fullscreen, 'lark-doc-titlebar-fixed': larkDocConfig.layout.titleBarFixed, 'lark-doc-toolbar-fixed': larkDocConfig.layout.toolbarFixed }]"
    @keydown.capture="onCommentShortcut"
    @keydown.esc="closeOverlay"
    @copy.capture="onContentClipboard"
    @cut.capture="onContentClipboard"
  >
    <a
      class="lark-doc-skip"
      href="#lark-doc-editor"
    >跳到正文</a>
    <TopBar :ed="self">
      <template #header-actions>
        <slot name="header-actions" />
      </template>
    </TopBar>
    <!-- P4-06模式切换用顶部中性条（07§1.1/06§6.2），不复用右下角错误toast。 -->
    <div
      v-if="modeToast"
      class="lark-doc-mode-toast"
      role="status"
      aria-live="polite"
    >
      {{ modeToast }}
    </div>

    <ToolbarBar :ed="self">
      <template #header-actions>
        <slot name="header-actions" />
      </template>
    </ToolbarBar>
    <div
      key="editor-context-panels"
      style="display: contents"
    >
      <SearchPanel
        v-if="searchOpen && featureEnabled('search')"
        ref="searchInput"
        :ed="self"
      />
      <TableTools :ed="self" />
      <!-- 稳定原生边界避免异步面板解析时搬移正文；提及面板仍锚在光标处。 -->
      <MentionPanel :ed="self" />
      <!-- 日期提醒日历浮层：点 chip 打开（入口是 DOM 事件，不走插件回调），与菜单/提及互斥 -->
      <ReminderPopover :ed="self" />
      <!-- 日程搜索面板：斜杠「日程」打开，点结果行即插卡片（Esc 刻意不关，02 §26 ⑦） -->
      <CalendarSearchPanel :ed="self" />
      <!-- ISV配置270×386/z600；Esc/取消/外部关闭，未确认不落块（02§22⑤-3）。 -->
      <IsvButtonPanel :ed="self" />
      <RevisionPanel :ed="self" />
    </div>
    <p
      v-if="documentBusinessDeleted"
      class="lark-doc-deleted-document"
    >
      文档已移入回收站
    </p>
    <div
      key="editor-body"
      :style="documentBusinessDeleted ? { display: 'none' } : null"
      class="lark-doc-body"
    >
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
      <main
        ref="mainScroll"
        class="lark-doc-main"
        aria-label="文档内容"
      >
        <PaperStage
          v-if="slides"
          :ed="self"
        />
        <div
          key="editor-paper"
          class="lark-doc-paper"
          @pointermove="onPaperPointerMove"
          @pointerdown="onReminderChipClick"
        >
          <div
            key="editor-paper-controls"
            style="display: contents"
          >
            <BlockHandleMenu :ed="self" /><div
              v-if="dropPosition !== null"
              class="lark-doc-drop-line"
              :style="{ top: `${dropLineTop}px` }"
              aria-hidden="true"
            />
          </div><editor-content
            v-if="editor"
            id="lark-doc-editor"
            key="live-editor-content"
            :editor="editor"
            class="lark-doc-editor-content"
            @keydown.native="onEditorKeydown"
            @pointerdown.native="onColumnPointerDown"
            @pointermove.native="onEditorPointerMove"
            @dragover.native="onBlockDragOver"
            @drop.native="onBlockDrop"
          /><CalloutTools :ed="self" /><TableBoundaryTools :ed="self" />
        </div><DocumentLikeBar :ed="self" /><CommentPanel
          :ed="self"
          :document-only="true"
        /><footer class="lark-doc-status">
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

    <BubbleBar :ed="self" />
    <command-menu
      v-if="menuOpen && !effectiveReadonly"
      :items="filteredCommands"
      :templates="templates"
      :query="menuQuery"
      :position-style="menuStyle"
      :active-id="activeCommandId"
      :kind="menuKind"
      @hook:mounted="onCommandMenuMounted"
      @query="menuQuery = $event; activeCommandIndex = 0"
      @move="moveCommand"
      @choose="chooseCommand"
      @close="closeCommandMenu(true)"
    />
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
    <!-- P2-04文件/视频共用不限accept入口（02 L4168实测）。 -->
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
// 编辑器模板、props、生命周期与内容管理；其余UI逻辑由editor/各mixin合并到实例。
import { Editor, EditorContent } from '@tiptap/vue-2'
import { markRaw } from 'vue'
import { DOMParser as ProseMirrorDOMParser } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
const CommandMenu = () => import(/* webpackChunkName: "editor-panels" */ './CommandMenu.vue')
import LarkDocIcon from './LarkDocIcon.vue'
import TopBar from './editor/TopBar.vue'
import ToolbarBar from './editor/ToolbarBar.vue'
const SearchPanel = () => import(/* webpackChunkName: "editor-panels" */ './editor/SearchPanel.vue')
const MentionPanel = () => import(/* webpackChunkName: "editor-panels" */ './editor/MentionPanel.vue')
// P4-02a：日历浮层组件，只渲染；状态与定位全在 reminderMixin。
const ReminderPopover = () => import(/* webpackChunkName: "editor-panels" */ './editor/ReminderPopover.vue')
// P4-02b：日程搜索面板，只渲染；状态与定位全在 calendarMixin。
const CalendarSearchPanel = () => import(/* webpackChunkName: "editor-panels" */ './editor/CalendarSearchPanel.vue')
// P4-04：ISV 按钮配置面板，只渲染；表单状态、校验、落块全在 isvMixin。
const IsvButtonPanel = () => import(/* webpackChunkName: "editor-panels" */ './editor/IsvButtonPanel.vue')
const RevisionPanel = () => import(/* webpackChunkName: "editor-panels" */ './editor/RevisionPanel.vue') // P4-06：只渲染，状态与定位全在 revisionMixin。
const TableTools = () => import(/* webpackChunkName: "editor-panels" */ './editor/TableTools.vue')
const OutlinePanel = () => import(/* webpackChunkName: "editor-panels" */ './editor/OutlinePanel.vue')
const PaperStage = () => import(/* webpackChunkName: "presentation" */ './editor/PaperStage.vue')
const BlockHandleMenu = () => import(/* webpackChunkName: "editor-panels" */ './editor/BlockHandleMenu.vue')
const CalloutTools = () => import(/* webpackChunkName: "editor-panels" */ './editor/CalloutTools.vue')
const TableBoundaryTools = () => import(/* webpackChunkName: "editor-panels" */ './editor/TableBoundaryTools.vue')
const BubbleBar = () => import(/* webpackChunkName: "editor-panels" */ './editor/BubbleBar.vue')
const ColorPalette = () => import(/* webpackChunkName: "editor-panels" */ './editor/ColorPalette.vue')
const TablePickerDialog = () => import(/* webpackChunkName: "editor-panels" */ './editor/dialogs/TablePickerDialog.vue')
const MathDialog = () => import(/* webpackChunkName: "editor-panels" */ './editor/dialogs/MathDialog.vue')
const LinkDialog = () => import(/* webpackChunkName: "editor-panels" */ './editor/dialogs/LinkDialog.vue')
let helpDialogPromise
const loadHelpDialog = () => helpDialogPromise || (helpDialogPromise = import(/* webpackChunkName: "editor-help" */ './editor/dialogs/HelpDialog.vue'))
const HelpDialog = loadHelpDialog
const HelpFab = () => import(/* webpackChunkName: "editor-help" */ './editor/HelpFab.vue')
const EmbedLinkDialog = () => import(/* webpackChunkName: "editor-panels" */ './editor/dialogs/EmbedLinkDialog.vue')
const HeadingNumberMenu = () => import(/* webpackChunkName: "editor-panels" */ './editor/dialogs/HeadingNumberMenu.vue')
import { createLarkDocExtensions } from './extensions'
import { aggregateHeadingContainers, restoreUnknownBlocks, clampBlockIndent, collectOutline, sanitizeHTML, validateDocument } from './documentOperations'
import { isBlockActionEnabled, isConfigEnabled, mergeLegacyConfig } from './larkDocConfig'
// Vue2 NodeViews由适配层注册；保留core/adapters注册缝供宿主替换renderer。
import { registerVue2NodeViews } from '../../adapters/vue2/nodeviews'
import viewModesMixin from './editor/viewModesMixin'
// 高频选区定位由selectionPacing合帧；组件不要声明同名onSelectionUpdate覆盖mixin。
import selectionPacingMixin from './editor/selectionPacingMixin'
import commandMenuMixin from './editor/commandMenuMixin'
import tableToolsMixin from './editor/tableToolsMixin'
import toolbarCollapseMixin from './editor/toolbarCollapseMixin'
import blockHandleMixin from './editor/blockHandleMixin'
import blockMenuMixin from './editor/blockMenuMixin'
import blockIndentMixin from './editor/blockIndentMixin'
import overlayDismissMixin from './editor/overlayDismissMixin'
import bubbleMenuMixin from './editor/bubbleMenuMixin'
import calloutColorMixin from './editor/calloutColorMixin'
import toolbarMenusMixin from './editor/toolbarMenusMixin'
import headingNumberMixin from './editor/headingNumberMixin'
// 提及动作集中mentionMixin，面板只接:ed渲染。
import mentionMixin from './editor/mentionMixin'
// 无关键词的日期提醒走chip DOM事件，不走document插件回调。
import reminderMixin from './editor/reminderMixin'
// 日程仅引用已有事件、不新建或编辑字段，状态由calendarMixin处理。
import calendarMixin from './editor/calendarMixin'
// ISV按钮先配置校验再落块，目录直接落块；共享isv节点按kind分支。
import isvMixin from './editor/isvMixin'
import revisionMixin from './editor/revisionMixin' // P4-06 ③：接受 / 拒绝无二次确认、无 toast。
// 折叠偏好的本设备持久化（三闸门）单独立一支，主组件只留调用点。
import foldPersistMixin from './editor/foldPersistMixin'
import collabMixin from './editor/collabMixin'
import uploadMixin from './editor/uploadMixin'
// P6b：评论 / 历史版本 / 分享 / 导出 / 三态统一五条线的聚合挂载点（含浮层容器）。
import p6bMixin from './editor/p6bMixin'
import { setTransactionMetadata, TRANSACTION_ORIGINS } from '../../core/transactionMetadata'
import { createNetworkPolicy } from '../../networkPolicy'
// 旧数据兼容：Vditor getHTML() 产物在 setContent 前归一化。
import { normalizeVditorHtml } from '../../legacy'
// lark-doc.css 由包样式入口（style.css ← src/index.js）统一引入：组件侧重复 import 会让同一份样式在模块图里出现两次。

// 模块一加载就把 Vue 2 NodeView 注册进 core 注册表，等价于过去的静态注入；extensions.js 按节点名查表。
registerVue2NodeViews()

export default {
  name: 'LarkDocEditor',
  components: { DocumentLikeBar: () => import(/* webpackChunkName: "editor-panels" */ './DocumentLikeBar.vue'), CommentPanel: () => import(/* webpackChunkName: "editor-panels" */ './CommentPanel.vue'), EditorContent, CommandMenu, LarkDocIcon, TopBar, ToolbarBar, SearchPanel, MentionPanel, ReminderPopover, CalendarSearchPanel, IsvButtonPanel, RevisionPanel, TableTools, OutlinePanel, PaperStage, BlockHandleMenu, CalloutTools, TableBoundaryTools, BubbleBar, ColorPalette, TablePickerDialog, MathDialog, LinkDialog, HelpDialog, EmbedLinkDialog, HeadingNumberMenu, HelpFab },
  mixins: [viewModesMixin, selectionPacingMixin, commandMenuMixin, tableToolsMixin, blockHandleMixin, blockMenuMixin, blockIndentMixin, bubbleMenuMixin, calloutColorMixin, toolbarMenusMixin, toolbarCollapseMixin, headingNumberMixin, overlayDismissMixin, mentionMixin, reminderMixin, calendarMixin, isvMixin, revisionMixin, foldPersistMixin, collabMixin, uploadMixin, p6bMixin],
  props: {
    value: { type: String, default: '<p></p>' }, title: { type: String, default: '' }, readonly: { type: Boolean, default: false },
    config: { type: Object, default: () => ({}) }, maxLength: { type: Number, default: null }, imageMaxSize: { type: Number, default: null },
    templates: { type: Array, default: () => [] },
    uploadImage: { type: [Function, Object], default: null }, msgId: { type: [Number, String], default: null },
    // P2-04：文件 / 视频块必须走宿主上传（10 GB 的附件不可能内联成 data URI），
    // 没传 uploadFile 时该入口只报错、不落半截块。
    uploadFile: { type: [Function, Object], default: null },
    // 只存附件 token、不存直链的宿主可注入这条换票函数（token → 可渲染地址）。
    resolveFileUrl: { type: Function, default: null },
    session: { type: Object, default: null },
    onDocumentAction: { type: Function, default: null },
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
    editorRevision: 0, localTitle: this.title,
    alignNames: { left: '左', center: '居中', right: '右', justify: '两端' }, alignGlyphs: { left: '≡', center: '☷', right: '≣', justify: '▤' },
    helpOpen: false, savedSelection: null,
    error: '', pendingHTML: null, htmlSeeded: false,
    pendingStateFrame: null, pendingChangeTimer: null,
  } },
  computed: {
    // Invalidate editor-derived UI on transactions without observing ProseMirror's tree.
    editor: {
      get() { void this.editorRevision; return this._runtimeEditor || null },
      set(value) { this._runtimeEditor = value; this.editorRevision += 1 },
    },
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
    session() { this.bindContentCopyCapabilities() },
    title(value) { if (value !== this.localTitle) this.localTitle = value },
    value(value) { if (this.editor && value !== this.editor.getHTML()) { try { this.setContent(value) } catch (error) { this.error = error.message } } },
    maxLength() { if (this.editor) { this.editor.storage.characterCount.setLimit(this.effectiveMaxLength); this.refreshDocumentState() } },
    config: { deep: true, handler() {
      if (this.editor) this.editor.storage.characterCount.setLimit(this.effectiveMaxLength)
      this.$nextTick(() => this.refreshDocumentState())
    } },
    effectiveReadonly(value) { if (this.editor) { this.editor.setEditable(!value); this.editor.emit('editableUpdate', { editable: !value }); this.closeCommandMenu(); this.closeMentionPanel(); this.closeReminderPopover(); this.closeCalendarSearch(); this.headingOpen = false; this.headingStyle = {}; this.closeBlockMenu(); this.clearHandleHighlight(); this.colorPaletteOpen = ''; this.closeEmbedDialog(); this.bubbleVisible = false; this.closeBubbleAlignMenu(); if (value) this.tableBoundary.visible = false; else this.$nextTick(() => this.updateTableBoundary()); this.$emit('mode-change', { readonly: value }) } },
    tablePicker(value) { if (value) { this.tablePickerHover = { rows: 3, cols: 3 }; this.$nextTick(() => this.$refs.root?.querySelector('.lark-doc-table-grid button')?.focus()) } },
    helpOpen(value) {
      if (!value) return
      loadHelpDialog().then(() => {
        this.$nextTick(() => {
          if (this.helpOpen && !this._isDestroyed && !this._isBeingDestroyed) this.$refs.root?.querySelector('[aria-label="关闭快捷键帮助"]')?.focus()
        })
      }, () => {
        if (this.helpOpen && !this._isDestroyed && !this._isBeingDestroyed) this.error = '帮助加载失败，请刷新页面后重试'
      })
    },
    linkDialog(value) { if (value) this.$nextTick(() => this.$refs.root?.querySelector(this.linkInsertMode ? '[aria-label="链接文本"]' : '[aria-label="链接地址"]')?.focus()) },
    embedDialog(value) { if (value) this.$nextTick(() => this.$refs.root?.querySelector('[aria-label="内嵌网页链接"]')?.focus()) },
  },
  mounted() {
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
      // ProseMirror owns its immutable state; Vue must observe only the editor reference.
      this.editor = markRaw(new Editor({
        content: this.collabOptions ? undefined : this.prepareHTML(initialHTML), editable: !this.effectiveReadonly,
        /* 内部NodeView权限桥：只传实时回调，不向Vue观察树注入Session。 */
        editorProps: { larkDocCanCopy: () => this.contentCopyAllowed(), larkDocCopyContext: () => this.contentCopyContext() },
        extensions: createLarkDocExtensions({ ...this.embedOptions, collab: this.collabOptions || undefined, maxLength: this.effectiveMaxLength, config: this.larkDocConfig, resolveImageFile: this.resolveImageFile, resolveFileUrl: this.resolveFileUrl, onSlash: this.onSlash, onMention: this.onMention, onHeadingNumberMenu: (payload) => this.openHeadingNumberMenu(payload), onListNumberMenu: (payload) => this.openListNumberMenu(payload), onImageFiles: this.insertImageFiles, onBackspace: () => this.deletePreviousBlockOnBackspace(), onError: (message) => { this.error = message } }),
        onUpdate: ({ transaction }) => this.onUpdate(transaction), onTransaction: () => { this.editorRevision += 1; this.syncFoldState(); this.persistFolds(); this.updateRevisionPanels(); this.$nextTick(() => { this.syncHandleHighlightBackdrop(); this.syncTableClip() }) }, onSelectionUpdate: () => this.onSelectionUpdate(),
      }))
      this.session?.attachEditor(this.editor)
      this.bindContentCopyCapabilities()
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
  beforeDestroy() { document.removeEventListener('fullscreenchange', this.onFullscreenChange); window.removeEventListener('keydown', this.onWindowKeydown); window.removeEventListener('scroll', this.onDocumentScroll, true); window.removeEventListener('resize', this.onDocumentScroll); window.removeEventListener('pointerup', this.onHandlePointerUp); window.removeEventListener('pointermove', this.onColumnPointerMove); window.removeEventListener('pointerup', this.onColumnPointerUp); document.removeEventListener('pointerdown', this.onDocumentPointerDown, true); window.removeEventListener('pointermove', this.onDocumentPointerMove, true); this._sessionCapabilitiesOff?.(); clearTimeout(this.handleHideTimer); clearTimeout(this.blockMenuCloseTimer); clearTimeout(this.pendingChangeTimer); if (this.pendingStateFrame) cancelAnimationFrame(this.pendingStateFrame); this.clearHandleHighlight(); this.closeBubbleAlignMenu(); if (this._outlineFrame) cancelAnimationFrame(this._outlineFrame); this.closeCommandMenu(); this.dragging = null },
  destroyed() {
    if (this.session && this.editor) this.session.detachEditor(this.editor)
    this.editor?.destroy()
    this.editor = null
  },
  methods: {
    bindContentCopyCapabilities() {
      this._sessionCapabilitiesOff?.()
      const refresh = () => { this.$forceUpdate(); this.editor?.emit('lark-doc-copy-permission'); if (this.session?.getProvider?.('authorization')?.documentInformation) void import(/* webpackChunkName: "document-information" */ '../../providers/document-information').then(module => module.recordEditorVisit(this)).catch(() => {}) }
      this._sessionCapabilitiesOff = this.session?.on?.('capabilities', refresh) || null
      refresh()
    },
    contentCopyAllowed() {
      const session = this.session, remote = session?.getProvider?.('authorization')?.isRemote
      return Boolean(this.editor && !this.editor.isDestroyed && this.shareCan('canView') && this.shareCan('canCopy') &&
        (!remote || session.can('canCopy') === true))
    },
    contentCopyContext() {
      const session = this.session
      /* 瞬时私有快照只传冷执行器，不存入Vue data；首次import前固定全部授权边界。 */
      return { owner: this, editor: this.editor, doc: this.editor?.state.doc, session,
        provider: session?.getProvider?.('authorization'), principal: session?.user?.id,
        identity: session?._privateIdentityGeneration, auth: session?._authorizationGeneration, documentId: session?.documentId }
    },
    onContentClipboard(event, content = this.editor?.view?.dom) {
      if (event.target.closest?.('input, textarea')) return
      const selection = typeof window !== 'undefined' && typeof window.getSelection === 'function' ? window.getSelection() : null
      const draft = event.target.closest?.('[data-comment-draft-editor="true"]')
      if (draft && !content?.contains(draft) && draft.closest('.lark-doc-comment-rich-input') &&
        draft.contains(selection?.anchorNode) && draft.contains(selection?.focusNode)) return
      if (content && (content.contains(event.target) || content.contains(selection?.anchorNode) || content.contains(selection?.focusNode)) &&
        !this.contentCopyAllowed()) { event.preventDefault(); event.stopPropagation() }
    },
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
    onDocumentPointerMove(event) {
      const root = this.$refs.root
      if (!root || root.contains(event.target)) return
      if (!event.target.closest?.('.lark-doc-block-handle, .lark-doc-callout-tools')) this.scheduleHandleHide()
    },
  },
}
</script>
