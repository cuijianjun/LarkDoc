<template>
  <section
    ref="root"
    class="lark-doc"
    :class="[`lark-doc-width-${widthMode}`, { 'lark-doc-reading': effectiveReadonly, 'lark-doc-slides': slides, 'lark-doc-fullscreen': fullscreen, 'lark-doc-titlebar-fixed': larkDocConfig.layout.titleBarFixed, 'lark-doc-toolbar-fixed': larkDocConfig.layout.toolbarFixed }]"
    @keydown.esc="closeOverlay"
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

    <ToolbarBar :ed="self">
      <template #header-actions>
        <slot name="header-actions" />
      </template>
    </ToolbarBar>
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
          <BlockHandleMenu :ed="self" /><div
            v-if="dropPosition !== null"
            class="lark-doc-drop-line"
            :style="{ top: `${dropLineTop}px` }"
            aria-hidden="true"
          /><editor-content
            v-if="editor"
            id="lark-doc-editor"
            :editor="editor"
            class="lark-doc-editor-content"
            @keydown.native="onEditorKeydown"
            @pointerdown.native="onColumnPointerDown"
            @pointermove.native="onEditorPointerMove"
            @dragover.native="onBlockDragOver"
            @drop.native="onBlockDrop"
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

    <BubbleBar :ed="self" />
    <command-menu
      v-if="menuOpen && !effectiveReadonly"
      :items="filteredCommands"
      :templates="templates"
      :query="menuQuery"
      :position-style="menuStyle"
      :active-id="activeCommandId"
      :kind="menuKind"
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
    <!-- 标题编号菜单：点编号按钮弹出，三项与飞书一致（继续/重新开始/设置值） -->
    <HeadingNumberMenu :ed="self" />
  </section>
</template>

<script>
// LarkDocEditor.vue —— 编辑器视图层：模板、props、生命周期与内容管理核心方法。
// 各 UI 子域拆分到 ./editor/ 下的 mixin（视图模式/命令菜单/表格工具/区块句柄/区块菜单/
// 气泡菜单/高亮块与颜色盘/工具栏菜单），经 Vue 2 选项合并后仍以 this.xxx 供模板与生命周期调用。
import { Editor, EditorContent } from '@tiptap/vue-2'
import { DOMParser as ProseMirrorDOMParser } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
import CommandMenu from './CommandMenu.vue'
import LarkDocIcon from './LarkDocIcon.vue'
import TopBar from './editor/TopBar.vue'
import ToolbarBar from './editor/ToolbarBar.vue'
import SearchPanel from './editor/SearchPanel.vue'
import MentionPanel from './editor/MentionPanel.vue'
// P4-02a：日历浮层组件，只渲染；状态与定位全在 reminderMixin。
import ReminderPopover from './editor/ReminderPopover.vue'
// P4-02b：日程搜索面板，只渲染；状态与定位全在 calendarMixin。
import CalendarSearchPanel from './editor/CalendarSearchPanel.vue'
// P4-04：ISV 按钮配置面板，只渲染；表单状态、校验、落块全在 isvMixin。
import IsvButtonPanel from './editor/IsvButtonPanel.vue'
import TableTools from './editor/TableTools.vue'
import OutlinePanel from './editor/OutlinePanel.vue'
import PaperStage from './editor/PaperStage.vue'
import BlockHandleMenu from './editor/BlockHandleMenu.vue'
import CalloutTools from './editor/CalloutTools.vue'
import TableBoundaryTools from './editor/TableBoundaryTools.vue'
import BubbleBar from './editor/BubbleBar.vue'
import ColorPalette from './editor/ColorPalette.vue'
import TablePickerDialog from './editor/dialogs/TablePickerDialog.vue'
import MathDialog from './editor/dialogs/MathDialog.vue'
import LinkDialog from './editor/dialogs/LinkDialog.vue'
import HelpDialog from './editor/dialogs/HelpDialog.vue'
import EmbedLinkDialog from './editor/dialogs/EmbedLinkDialog.vue'
import HeadingNumberMenu from './editor/dialogs/HeadingNumberMenu.vue'
import { createLarkDocExtensions } from './extensions'
import { aggregateHeadingContainers, restoreUnknownBlocks, clampBlockIndent, collectOutline, safeAttachmentId, safeUrl, sanitizeHTML, validateDocument } from './documentOperations'
import { isBlockActionEnabled, isConfigEnabled, mergeLegacyConfig } from './larkDocConfig'
// Vue 2 专属 NodeView（图片 / 代码块）住在 adapters/vue2/，由它自己注册进 core 的
// NodeView 注册表；这里只负责把适配层拉起来，core 与 Vue 之间不再有静态绑定。
// 注意：core → adapters 这条 import 是刻意的临时反向依赖（P0-01 只做到「注册表缝」，
// 装配动作仍由 Vue 2 宿主触发），Task 6 拆三端适配时会把 registerVue2NodeViews()
// 的调用点从 core 移到真正的宿主入口，届时删除本行。
import { registerVue2NodeViews } from '../../adapters/vue2/nodeviews'
import viewModesMixin from './editor/viewModesMixin'
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
// 折叠偏好的本设备持久化（三闸门）单独立一支，主组件只留调用点。
import foldPersistMixin from './editor/foldPersistMixin'
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
// lark-doc.css 由包样式入口（style.css ← src/index.js）统一引入：组件侧重复 import 会让
// 同一份样式在模块图里出现两次，改成单一归属，避免以后 CSS 被静默写两份。

// 把 Vue 2 专属 NodeView 注册进 core 的注册表：本模块一加载就可用，等价于过去的静态
// 注入；extensions.js 装配 schema 时按节点名查表，不再静态依赖任何 UI 框架。
registerVue2NodeViews()

export default {
  name: 'LarkDocEditor',
  components: { EditorContent, CommandMenu, LarkDocIcon, TopBar, ToolbarBar, SearchPanel, MentionPanel, ReminderPopover, CalendarSearchPanel, IsvButtonPanel, TableTools, OutlinePanel, PaperStage, BlockHandleMenu, CalloutTools, TableBoundaryTools, BubbleBar, ColorPalette, TablePickerDialog, MathDialog, LinkDialog, HelpDialog, EmbedLinkDialog, HeadingNumberMenu },
  mixins: [viewModesMixin, commandMenuMixin, tableToolsMixin, blockHandleMixin, blockMenuMixin, blockIndentMixin, bubbleMenuMixin, calloutColorMixin, toolbarMenusMixin, toolbarCollapseMixin, headingNumberMixin, overlayDismissMixin, mentionMixin, reminderMixin, calendarMixin, isvMixin, foldPersistMixin],
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
    try {
      let initialHTML = this.pendingHTML === null ? this.value || '<p></p>' : this.pendingHTML
      const hasInitialValue = Object.prototype.hasOwnProperty.call(this.$options.propsData || {}, 'value')
      if (!hasInitialValue && !this.htmlSeeded && (!initialHTML.trim() || initialHTML === '<p></p>') && this.msgId !== null) {
        // 未提供初始正文才只读兼容旧缓存；显式空 value 也是宿主的正文选择。
        try { const cached = localStorage.getItem(String(this.msgId)); if (cached) initialHTML = cached } catch (_) { this.error = '浏览器阻止读取公告缓存' }
      }
      this.editor = new Editor({
        content: this.prepareHTML(initialHTML), editable: !this.effectiveReadonly,
        extensions: createLarkDocExtensions({ ...this.embedOptions, maxLength: this.effectiveMaxLength, config: this.larkDocConfig, resolveImageFile: this.resolveImageFile, resolveFileUrl: this.resolveFileUrl, onSlash: this.onSlash, onMention: this.onMention, onHeadingNumberMenu: (payload) => this.openHeadingNumberMenu(payload), onListNumberMenu: (payload) => this.openListNumberMenu(payload), onImageFiles: this.insertImageFiles, onBackspace: () => this.deletePreviousBlockOnBackspace(), onError: (message) => { this.error = message } }),
        onUpdate: ({ transaction }) => this.onUpdate(transaction), onTransaction: () => { this.syncFoldState(); this.persistFolds(); this.$nextTick(() => this.syncHandleHighlightBackdrop()) }, onSelectionUpdate: () => this.onSelectionUpdate(),
      })
      this.session?.attachEditor(this.editor)
      this._sessionCapabilitiesOff = this.session?.on?.('capabilities', () => this.$forceUpdate()) || null
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
      this.outline = collectOutline(this.editor.state.doc)
      this.syncOutlineCollapseState()
      this.syncFoldState()
      this.wordCount = this.editor.storage.characterCount.characters()
      if (this.effectiveMaxLength > 0 && this.wordCount > this.effectiveMaxLength) this.error = `正文不能超过 ${this.effectiveMaxLength} 字，请缩短正文`
      else if (this.error.startsWith('正文不能超过 ')) this.error = ''
      if (this.searchQuery) this.updateSearch()
    },
    // syncFoldState / syncOutlineCollapseState 在 viewModesMixin（视图级状态的那一支）。
    onSelectionUpdate() {
      if (!this.editor) return
      const { selection } = this.editor.state
      if (this.editor.isFocused) this.savedSelection = { from: selection.from, to: selection.to }
      this.activeHeading = [...this.outline].reverse().find((item) => item.pos <= selection.from)?.pos ?? -1
      const coords = this.editor.view.coordsAtPos(selection.from)
      if (!this.handlePressed && !this.blockMenuOpen && !this.blockTypeMenuOpen) this.positionBlockHandle(this.currentBlockRange())
      if (this.editor.isActive('table') && this.writable()) this.tableToolsOpen = true
      this.clearTableBoundaryHover()
      this.updateTableBoundary()
      this.$nextTick(() => this.updateTableBoundary())
      this.updateCalloutTools()
      this.bubbleVisible = !selection.empty && !selection.node && !this.effectiveReadonly && this.editor.isFocused
      if (this.bubbleVisible) {
        // 顶部避让：选区贴近视口顶部时，气泡条不能钻进吸顶工具栏（飞书同样会把浮条翻到选区下方）。
        const safeTop = this.bubbleSafeTop()
        const endCoords = this.editor.view.coordsAtPos(selection.to)
        const naturalTop = coords.top - 50
        const top = naturalTop >= safeTop ? naturalTop : endCoords.bottom + 10
        this.bubblePosition = {
          left: Math.max(8, Math.min(window.innerWidth - 270, coords.left)),
          top: Math.max(safeTop, Math.min(top, window.innerHeight - 60)),
        }
      }
      else { this.closeBubbleAlignMenu(); this.closeBubbleHeadingMenu() }
    },
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
    writable() { return !this._isBeingDestroyed && !this._isDestroyed && this.editor?.isEditable && !this.editor.isDestroyed && !this.effectiveReadonly },
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
