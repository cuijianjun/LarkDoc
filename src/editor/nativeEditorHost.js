import { INSERT_TEMPLATES } from '../components/lark-doc/templates'
import { nativeDocumentStateMethods } from './nativeDocumentState'
import { bindMobileEditorControls, mobileEditorMethods } from './mobileEditorControls'
import { TextSelection } from '@tiptap/pm/state'
import { clampBlockIndent } from '../components/lark-doc/documentOperations'
import { isBlockActionEnabled, isCommandEnabled, isConfigEnabled } from '../components/lark-doc/larkDocConfig'
import { isImageMime } from '../core/media/image-insert'
import { showImageUploadError } from '../ui/imageUploadPlaceholder'
import { createActivityGate } from '../core/pacing'
import { createNativeOptionsHost } from './nativeOptionsHost'
import { createTopBar } from '../ui/topBar'
import { evaluateOutputPolicy } from '../core/policy/output'
import viewModesMixin from '../components/lark-doc/editor/viewModesMixin'
import selectionPacingMixin from '../components/lark-doc/editor/selectionPacingMixin'
import commandMenuMixin from '../components/lark-doc/editor/commandMenuMixin'
import commandMenuUiMixin from '../components/lark-doc/editor/commandMenuUiMixin'
import tableToolsMixin from '../components/lark-doc/editor/tableToolsMixin'
import tableInteractionMixin from '../components/lark-doc/editor/tableInteractionMixin'
import blockHandleMixin from '../components/lark-doc/editor/blockHandleMixin'
import blockHandleUiMixin from '../components/lark-doc/editor/blockHandleUiMixin'
import blockMenuMixin from '../components/lark-doc/editor/blockMenuMixin'
import blockIndentMixin from '../components/lark-doc/editor/blockIndentMixin'
import bubbleMenuMixin from '../components/lark-doc/editor/bubbleMenuMixin'
import calloutColorMixin from '../components/lark-doc/editor/calloutColorMixin'
import toolbarMenusMixin from '../components/lark-doc/editor/toolbarMenusMixin'
import dialogsUiMixin from '../components/lark-doc/editor/dialogsUiMixin'
import panelsUiMixin from '../components/lark-doc/editor/panelsUiMixin'
import toolbarCollapseMixin from '../components/lark-doc/editor/toolbarCollapseMixin'
import toolbarUiMixin from '../components/lark-doc/editor/toolbarUiMixin'
import headingNumberMixin from '../components/lark-doc/editor/headingNumberMixin'
import headingNumberMenuUiMixin from '../components/lark-doc/editor/headingNumberMenuUiMixin'
import stageUiMixin from '../components/lark-doc/editor/stageUiMixin'
import tableToolsUiMixin from '../components/lark-doc/editor/tableToolsUiMixin'
import linkToolsUiMixin from '../components/lark-doc/editor/linkToolsUiMixin'
import helpFabUiMixin from '../components/lark-doc/editor/helpFabUiMixin'
import colorPaletteUiMixin from '../components/lark-doc/editor/colorPaletteUiMixin'
import calloutToolsUiMixin from '../components/lark-doc/editor/calloutToolsUiMixin'
import revisionUiMixin from '../components/lark-doc/editor/revisionUiMixin'
import calendarSearchUiMixin from '../components/lark-doc/editor/calendarSearchUiMixin'
import overlayDismissMixin from '../components/lark-doc/editor/overlayDismissMixin'
import mentionMixin from '../components/lark-doc/editor/mentionMixin'
import mentionUiMixin from '../components/lark-doc/editor/mentionUiMixin'
import isvPanelUiMixin from '../components/lark-doc/editor/isvPanelUiMixin'
import searchPanelUiMixin from '../components/lark-doc/editor/searchPanelUiMixin'
import reminderMixin from '../components/lark-doc/editor/reminderMixin'
import reminderUiMixin from '../components/lark-doc/editor/reminderUiMixin'
import calendarMixin from '../components/lark-doc/editor/calendarMixin'
import isvMixin from '../components/lark-doc/editor/isvMixin'
import revisionMixin from '../components/lark-doc/editor/revisionMixin'
import foldPersistMixin from '../components/lark-doc/editor/foldPersistMixin'
import collabMixin from '../components/lark-doc/editor/collabMixin'
import p6bMixin from '../components/lark-doc/editor/p6bMixin'
import overlaysUiMixin from '../components/lark-doc/editor/overlaysUiMixin'
import extendedOverlaysUiMixin from '../components/lark-doc/editor/extendedOverlaysUiMixin'

const uiDomains = [
  ['TopBar', 'refreshTopBar'], ['Dialogs', 'refreshDialogs'], ['Overlays', 'refreshOverlays'],
  ['ExtendedOverlays', 'refreshExtendedOverlays'],
  ['Panels', 'refreshPanels'], ['Stage', 'refreshStage'], ['TableTools', 'refreshTableTools'], ['LinkTools', 'refreshLinkTools'],
  ['HelpFab', 'refreshHelpFab'], ['ColorPalette', 'refreshColorPalette'], ['CalloutTools', 'refreshCalloutTools'],
  ['RevisionPanels', 'refreshRevisionPanels'], ['CalendarSearch', 'refreshCalendarSearch'],
  ['MentionPanel', 'refreshMentionPanel'], ['IsvPanel', 'refreshIsvPanel'], ['SearchPanel', 'refreshSearchPanel'],
  ['Reminder', 'refreshReminder'], ['BubbleBar', 'refreshBubbleBar'], ['ToolbarBar', 'refreshToolbar'],
  ['HeadingNumberMenu', 'refreshHeadingNumberMenu'], ['BlockHandle', 'refreshBlockHandle'], ['CommandMenu', 'refreshCommandMenu'],
]

const options = {
  mixins: [viewModesMixin, selectionPacingMixin, commandMenuMixin, commandMenuUiMixin, tableToolsMixin, tableInteractionMixin,
    blockHandleMixin, blockHandleUiMixin, blockMenuMixin, blockIndentMixin, bubbleMenuMixin, calloutColorMixin,
    toolbarMenusMixin, dialogsUiMixin, panelsUiMixin, toolbarCollapseMixin, toolbarUiMixin, headingNumberMixin,
    headingNumberMenuUiMixin, stageUiMixin, tableToolsUiMixin, helpFabUiMixin, colorPaletteUiMixin,
    calloutToolsUiMixin, revisionUiMixin, calendarSearchUiMixin, overlayDismissMixin, mentionMixin,
    mentionUiMixin, isvPanelUiMixin, searchPanelUiMixin, reminderMixin, reminderUiMixin, calendarMixin,
    isvMixin, revisionMixin, foldPersistMixin, collabMixin, p6bMixin, overlaysUiMixin, extendedOverlaysUiMixin, linkToolsUiMixin],
  data() { return {
    editor: null, editorController: null, helpOpen: false, savedSelection: null, error: '',
    alignNames: { left: '左', center: '居中', right: '右', justify: '两端' },
    alignGlyphs: { left: '≡', center: '☷', right: '≣', justify: '▤' },
    pendingStateFrame: null, pendingChangeTimer: null, pendingDerivedIdle: null, pendingDerivedTimer: null, pendingDerivedVersion: 0, _derivedDoc: null,
    mobileEditorActive: false, mobileEditorStyle: { left: 0, width: 0, bottom: 0 }, isNarrowViewport: false, // 宽度态，口径同 @media (max-width: 760px)
  } },
  computed: {
    larkDocConfig() { return this.editorConfig },
    maxBlockIndent() { return clampBlockIndent(this.larkDocConfig.limits.maxIndent) },
    effectiveMaxLength() { return Math.max(0, Number(this.larkDocConfig.limits.maxLength) || 0) },
    effectiveImageMaxSize() { return this.larkDocConfig.limits.maxImageSize },
    effectiveFileMaxSize() { return this.larkDocConfig.limits.maxFileSize },
    titleLength() { return this.larkDocConfig.limits.titleLength },
    effectiveReadonly() { return this.interactionMode === 'read' },
    hasTextSelection() { return !!this.editor && !this.editor.state.selection.empty },
    visibleBlockActions() { return this.blockActions.filter(item => this.isBlockActionEnabled(item.id) && (item.id !== 'translate' || this.featureEnabled('ai'))) },
    visibleBlockTypeActions() {
      return this.blockTypeActions.filter(item => this.featureEnabled('blockStyle') && this.featureEnabled(item.id === 'codeBlock' ? 'codeBlocks' : item.id === 'callout' ? 'callouts' : /^heading/.test(item.id) ? 'headings' : 'blockStyle') && this.isBlockActionEnabled(item.id))
    },
    visibleBlockListActions() {
      const list = this.visibleBlockActions.filter(item => item.id !== 'duplicate')
      const duplicate = this.blockActions.find(item => item.id === 'duplicate')
      return this.handleIsTable && duplicate && this.isBlockActionEnabled('duplicate') ? [duplicate, ...list] : list
    },
  },
  watch: {
    mobileEditorActive() { this.refreshToolbar() },
    mobileEditorStyle() { this.refreshToolbar() },
    colorPaletteOpen() {
      if (this._mobileEditorMedia?.matches && this.colorPaletteIsText && this.writable()) {
        this.rememberSelection(true)
        this.editor.view.dom.blur()
      }
      this.refreshToolbar()
    },
    menuOpen() { this.refreshToolbar() },
    isvPanelOpen() { this.refreshToolbar() },
    outlineOpen() { this.syncOutlineReopen() },
    isNarrowViewport() { this.syncViewportClasses() },
    viewportOrientation() { this.syncViewportClasses() },
    session() {
      this.editor?.storage.inlineMath?.refresh?.(); this.editor?.storage.blockMath?.refresh?.()
      this.applyInteractionMode()
      this.refreshTopBar()
      this.refreshToolbar()
      this.refreshOverlays()
      this.refreshPanels()
      this.refreshRevisionPanels()
    },
    notifyOpen() { this.refreshTopBar() },
    notifyUnreadCount() { this.refreshTopBar() },
    notifyContext() { this.refreshTopBar() },
    createMenuOpen() { this.refreshTopBar() },
    createMenuStyle: { deep: true, handler() { this.refreshTopBar() } },
    topbarMoreOpen() { this.refreshTopBar() },
    topbarMoreSubmenu() { this.refreshTopBar() },
    topbarMoreStyle: { deep: true, handler() { this.refreshTopBar() } },
    topbarMoreSubmenuStyle: { deep: true, handler() { this.refreshTopBar() } },
    topbarMoreItems() { this.refreshTopBar() },
    topbarMoreShowAuthor() { this.refreshTopBar() },
    topbarMoreOffline() { this.refreshTopBar() },
    effectiveReadonly(value) {
      if (value) { this.resolveImageFile.cancelAll?.('readonly'); this.cancelFileUploads('readonly'); this.dropPosition = null }
      if (!this.editor) return
      this.closeEditingOverlays()
      if (value) this.tableBoundary.visible = false
      else this.$nextTick(() => this.updateTableBoundary())
    },
    editorConfig: { deep: true, handler() {
      if (!this.featureEnabled('files')) this.cancelFileUploads('files-disabled')
      if (!isCommandEnabled(this.larkDocConfig, 'image', 'images')) {
        this.resolveImageFile.cancelAll?.('images-disabled')
        if (!this.dragging) this.dropPosition = null
      }
      this.editor?.storage.columns?.refresh?.()
      this.editor?.storage.agenda?.refresh?.()
      this.editor?.storage.inlineMath?.refresh?.()
      this.editor?.storage.blockMath?.refresh?.()
      if (!isCommandEnabled(this.larkDocConfig, this.isvAction, 'insert')) this.closeIsvPanel()
      this.editor?.storage.characterCount?.setLimit?.(this.effectiveMaxLength)
      if (this.colorPaletteIsText && !this.toolbarEnabled('textStyle')) {
        this.colorPaletteOpen = ''
        this.mobileEditorActive = false
      }
      this.syncOutlineReopen()
      this.$nextTick(() => this.refreshDocumentState())
    } },
  },
  methods: {
    async runImageAction(action, image) {
      const node = this.editor?.state.doc.nodeAt(image.pos)
      if (node?.type.name !== 'image' || node.attrs.blockId !== image.blockId) return false
      if (action === 'ai') {
        if (!this.writable() || this.larkDocConfig.features.ai === false) return false
        this.$emit('ai-request', { action: 'image', image: { ...node.attrs, pos: image.pos } })
        return true
      }
      if (action === 'comment') return this.openImageComments(image, true)
      if (action === 'share') {
        if (this.openImageShareDialog) return this.openImageShareDialog(image)
        this.error = '当前宿主尚未配置图片分享'
        return false
      }
      if (action === 'copy') {
        try {
          const url = new URL(this.shareDocumentLink())
          url.hash = `share-${image.blockId}`
          if (!await this.copyShareText(url.href)) { this.error = '复制失败，请检查剪贴板权限'; return false }
          this.showShareToast('success', '复制成功')
          return true
        } catch (error) { this.error = error?.message || '图片链接复制失败'; return false }
      }
      return false
    },
    jumpSharedBlock() {
      if (!this.editor || this.editor.isDestroyed) return
      const hash = window.location.hash
      if (!hash.startsWith('#share-')) return
      const blockId = hash.slice(7)
      const element = this.editor.storage?.larkDoc?.projection?.revealBlockId?.(blockId)
        || [...this.editor.view.dom.querySelectorAll('[data-block-id]')].find(node => node.dataset.blockId === blockId)
      this.editor.storage?.larkDoc?.projection?.revealNode?.(element)
      element?.scrollIntoView({ block: 'center' })
    },
    featureEnabled(name) { return isConfigEnabled(this.larkDocConfig, name) },
    toolbarEnabled(name) { return this.larkDocConfig.toolbar[name] !== false && this.featureEnabled(name) },
    isBlockActionEnabled(id) { return isBlockActionEnabled(this.larkDocConfig, id) },
    syncViewportClasses() {
      const root = this.$refs.root
      if (!root) return // 必须是真布尔：传函数引用时 toggle 每次翻转，桌面端会一直带 narrow。
      root.classList.toggle('lark-doc-narrow', this.isNarrowViewport === true)
      root.classList.toggle('lark-doc-landscape', this.viewportOrientation === 'landscape')
    },
    mountTopBar() {
      if (this._topBarUi) return
      const anchor = this.$refs.topBarHost
      let topBar
      topBar = this._topBarUi = createTopBar({
        host: anchor.parentNode, anchor, overlayHost: this.$refs.overlayHost,
        paperHost: this.$refs.paper,
        actionsHost: this.$refs.actionsHost,
        refs: this.$refs,
        onMenusReady: () => this.onTopbarMenusReady(topBar),
        handlers: {
          updateTitle: value => this.updateTitle(value),
          setMode: id => this.setMode(id),
          openHome: () => this.onMobileHeaderAction('home'),
          openProfile: () => this.onMobileHeaderAction('profile'),
          openMembers: event => { if (this.shareCan('canView')) this.toggleSharePopover(event) },
          libraryScope: () => this.mobileLibraryScope(), libraryDirectory: () => this.mobileLibraryDirectory(),
          openLibraryDocument: id => this.openMobileLibraryDocument(id), mobileHostAction: action => this.onMobileHeaderAction(action),
          toggleOutline: () => { this.toggleOutlineOpen(); this.refreshTopBar() },
          toggleNotify: event => this.toggleNotify(event),
          toggleCreateMenu: event => this.toggleCreateMenu(event),
          toggleTopbarMore: event => this.toggleTopbarMore(event),
          createMenuItem: item => this.onCreateMenuItem(item),
          closeCreateMenu: () => this.closeCreateMenu(),
          closeTopbarMore: () => this.closeTopbarMore(),
          topbarMoreItem: (item, event) => this.onTopbarMoreItem(item, event),
          hoverTopbarMoreItem: item => this.hoverTopbarMoreItem(item),
          topbarMoreSubmenuItem: (item, event) => this.onTopbarMoreSubmenuItem(item, event),
        },
      })
      this.refreshTopBar()
    },
    ...nativeDocumentStateMethods,
    ...mobileEditorMethods,
    toolbarHandlers() {
      return { ...toolbarUiMixin.methods.toolbarHandlers.call(this), hideMobileKeyboard: () => this.hideMobileKeyboard() }
    },
    refreshTopBar() {
      if (!this._topBarUi) return
      this._topBarUi.update({
        ...toolbarUiMixin.methods.buildTopBarState.call(this),
        outlineOpen: this.outlineOpen,
        outlineVisible: this.larkDocConfig.layout.outlineVisible,
        notifyOpen: this.notifyOpen,
        notifyUnreadCount: this.notifyCurrent(this.notificationContext()) ? this.notifyUnreadCount : 0,
        notifyDisabled: !this.notifyCurrent(this.notificationContext()),
        createMenuOpen: this.createMenuOpen,
        createMenuStyle: this.createMenuStyle,
        createMenuRows: this.createMenuRows,
        topbarMoreOpen: this.topbarMoreOpen,
        topbarMoreStyle: this.topbarMoreStyle,
        topbarMoreRows: this.topbarMoreRows,
        topbarMoreSubmenu: this.topbarMoreSubmenu,
        topbarMoreSubmenuStyle: this.topbarMoreSubmenuStyle,
        topbarMoreSubmenuItems: this.topbarMoreSubmenuItems,
        topbarMoreShowAuthor: this.topbarMoreShowAuthor,
        topbarMoreOffline: this.topbarMoreOffline,
      })
      this.parkActionsHost()
    },
    parkActionsHost() {
      const { actionsHost, actionsPark, toolbarHost } = this.$refs
      if (!this.larkDocConfig.layout.headerVisible && !this.larkDocConfig.layout.toolbarVisible) {
        actionsPark.classList.add('lark-doc-header-actions')
        actionsPark.style.display = 'flex'
        if (actionsHost.parentNode !== actionsPark) actionsPark.appendChild(actionsHost)
        return
      }
      actionsPark.classList.remove('lark-doc-header-actions')
      actionsPark.style.display = ''
      if (this.larkDocConfig.layout.toolbarVisible !== false && this._toolbarUi && this._toolbarUi.el.parentNode !== toolbarHost.parentNode) toolbarHost.before(this._toolbarUi.el)
      toolbarUiMixin.methods.parkActionsHost.call(this)
    },
    syncOutlineReopen() {
      const button = this._outlineReopen || this.$refs.root.querySelector('.lark-doc-outline-reopen')
      if (!button) return
      this._outlineReopen = button
      if (this.outlineOpen || !this.featureEnabled('outline')) button.remove()
      else this.$refs.outlineHost.before(button)
    },
    getEditor() { return this.editor },
    getHTML() { return this.editorController?.getHTML() || '' },
    getJSON() { return this.editorController?.getJSON() || null },
    getText() { return this.editorController?.getText() || '' },
    focus() { this.editorController?.focus() },
    setContent(content, config) { return this.editorController?.setContent(content, config) },
    updateTitle(value) { if (!this.effectiveReadonly) this.$emit('update:title', value) },
    rememberSelection(includeCursor = false) {
      if (!this.editor) return
      const { from, to } = this.editor.state.selection
      if (from !== to || includeCursor) this.savedSelection = { from, to }
    },
    restoreSelection(includeCursor = false) {
      if (!this.editor || !this.savedSelection || !(this.editor.state.selection instanceof TextSelection)) return
      const { from, to } = this.savedSelection
      const size = this.editor.state.doc.content.size
      if ((from !== to || includeCursor) && from <= size && to <= size) this.editor.view.dispatch(this.editor.state.tr.setSelection(TextSelection.create(this.editor.state.doc, from, to)))
    },
    run(command, ...args) {
      if (!this.writable()) return false
      if (command === 'undo' && this.editor.storage.imageUploadTasks?.undoPending()) return true
      if (command === 'redo' && this.editor.storage.imageUploadTasks?.redoPending()) return true
      this.restoreSelection()
      const chain = this.editor.chain().focus()
      return typeof chain[command] === 'function' ? chain[command](...args).run() : false
    },
    isActive(name) { return !!this.editor?.isActive(name) },
    toggleMark(name) {
      if (!this.featureEnabled('marks')) return
      this.run(`toggle${name[0].toUpperCase()}${name.slice(1)}`)
      this.bubbleVisible = false
      this.closeBubbleAlignMenu()
    },
    setTextStyle(key, value) { if (value) this.run(`set${key[0].toUpperCase()}${key.slice(1)}`, value) },
    applyTextStyle(key, value) { this.setTextStyle(key, value); this.appliedTextStyle[key] = value },
    applyTextColor(value) { this.setTextStyle('color', value); this.appliedTextStyle.textColor = value },
    applyTextBackground(value) { this.setTextStyle('backgroundColor', value); this.appliedTextStyle.backgroundColor = value },
    applyLineHeight(value) { this.setBlockAttribute('lineHeight', value); this.appliedTextStyle.lineHeight = value },
    applyCellAlign(key, value) { this.cellAttribute(key, value); this.cellAlignState[key] = value },
    setBlockAttribute(name, value, type) {
      if (!this.writable() || value === null || value === undefined || value === '') return
      this.restoreSelection()
      const block = type || (this.editor.isActive('heading') ? 'heading' : 'paragraph')
      this.editor.chain().focus().updateAttributes(block, { [name]: name === 'indent' ? clampBlockIndent(value, this.maxBlockIndent) : value }).run()
    },
    setAlign(value) { this.run('setTextAlign', value) },
    clearFormatting() { if (this.writable()) { this.restoreSelection(); this.editor.chain().focus().unsetAllMarks().clearNodes().run() } },
    cellAttribute(name, value) { if (value) this.run('setCellAttribute', name, value) },
    onImageInput(event) { const files = Array.from(event.target.files || []); event.target.value = ''; return this.insertImageFiles(files) },
    onFileInput(event) { const files = Array.from(event.target.files || []); event.target.value = ''; return this.insertFileBlocks(files) },
    onImageDragOver(event) {
      if (!this.writable() || !isCommandEnabled(this.larkDocConfig, 'image', 'images') || this.dragging) return false
      const transfer = event.dataTransfer
      if (Array.from(transfer?.types || []).includes('application/x-prosemirror-slice')) return false
      const items = [...Array.from(transfer?.items || []), ...Array.from(transfer?.files || [])]
      if (!items.some(item => isImageMime(item.type))) return false
      const pos = this.editor.view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
      const target = this.editor.storage.imageUploadTasks.dropTarget(pos, { x: event.clientX, y: event.clientY })
      if (!target) return false
      this.dropPosition = target.pos
      this.dropLineTop = target.top - this.$refs.paper.getBoundingClientRect().top
      event.preventDefault()
      transfer.dropEffect = 'copy'
      return true
    },
    async insertImageFiles(files, pos, source = 'select', dropPoint) {
      if (!this.writable() || !isCommandEnabled(this.larkDocConfig, 'image', 'images')) return
      if (source === 'drop') this.dropPosition = null
      this.error = ''
      return this.editor.storage.imageUploadTasks.insertFiles(files, {
        pos, source, dropPoint, maxSize: this.effectiveImageMaxSize, resolve: this.resolveImageFile,
        isAllowed: () => this.writable() && isCommandEnabled(this.larkDocConfig, 'image', 'images'),
        onError: error => {
          this._imageUploadErrorOff?.()
          this._imageUploadErrorOff = showImageUploadError(this.$refs.panelHost, error)
        },
      })
    },
    async insertFileBlocks(files, pos) {
      if (!this.writable() || !this.featureEnabled('files')) return
      const epoch = this._fileUploadEpoch || 0
      const { createFileUploadTasks } = await import('../core/media/file-upload-tasks')
      if (epoch !== (this._fileUploadEpoch || 0) || !this.writable()) return
      this._fileUploadTasks ||= createFileUploadTasks(this)
      return this._fileUploadTasks.insert(files, pos)
    },
    cancelFileUploads(reason) { this._fileUploadEpoch = (this._fileUploadEpoch || 0) + 1; this._fileUploadTasks?.cancelAll(reason) },

  },
}
export function createNativeEditorHost({ shell, props, state, emit, onChange, resolveImageFile }) {
  // 文档浮层不能与工作台 syncChildren 共用宿主，也不能放进侧栏的定位上下文。
  const panelHost = shell.root.ownerDocument.createElement('div')
  shell.root.appendChild(panelHost)
  const runtime = createNativeOptionsHost({
    options, props, state, refs: { ...shell, panelHost }, slots: { 'header-actions': true }, emit, onChange,
    aliases: {
      localTitle: { get: (_host, source) => source.title, set: (value, _host, source) => { source.title = value } },
      session: { get: (_host, source) => source.sessionInstance, set: (value, _host, source) => { source.sessionInstance = value } },
      foldPersistKey: { get: (_host, source, input) => input.foldPersistKey ?? source.sessionInstance?.documentId ?? input.documentId ?? 'local' },
      readonly: { get: (_host, source, input) => !!(input.readonly || source.forcedReadonly || source.importing) },
      config: { get: (_host, source) => source.editorConfig },
      templates: { get: (_host, source, input) => Array.isArray(input.templates) ? source.templateItems : INSERT_TEMPLATES },
      resolveImageFile: { get: () => resolveImageFile },
    },
  })
  const host = runtime.host
  host._backgroundGate = createActivityGate()
  const listeners = []
  let themeUi = null
  function mountThemeUi() {
    const actions = shell.actionsHost
    if (!actions || themeUi) return
    const document = shell.root.ownerDocument
    const readingButton = document.createElement('button')
    readingButton.type = 'button'
    readingButton.className = 'lark-doc-reading-entry-button'
    readingButton.setAttribute('aria-label', '阅读模式')
    readingButton.textContent = '阅读'
    readingButton.addEventListener('click', () => { host.toggleReading?.(); refreshThemeUi?.() })
    const commentButton = document.createElement('button')
    commentButton.type = 'button'
    commentButton.className = 'lark-doc-comment-entry-button'
    commentButton.setAttribute('aria-label', '全文评论')
    commentButton.textContent = '评论'
    commentButton.addEventListener('click', () => {
      if (host.commentSidebarOpen !== true) host.commentSidebarOpen = true
      host.updateCommentPanels?.()
      host.refreshPanels?.()
      host.updateCommentLayerBounds?.()
    })
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'lark-doc-theme-button'
    button.setAttribute('aria-label', '主题')
    button.setAttribute('aria-haspopup', 'menu')
    button.setAttribute('aria-expanded', 'false')
    button.textContent = '主题'
    const menu = document.createElement('div')
    menu.className = 'lark-doc-dropdown lark-doc-theme-menu'
    menu.setAttribute('role', 'menu')
    menu.setAttribute('aria-label', '主题')
    const closeTheme = (restore = false) => {
      menu.hidden = true
      button.setAttribute('aria-expanded', 'false')
      if (restore && button.isConnected) button.focus()
    }
    const choices = [
      ['default', '经典绿色', 'light'],
      ['feishu-light', '飞书浅色', 'light'],
      ['feishu-dark', '飞书暗色', 'dark'],
    ]
    const rows = choices.map(([id, label, theme]) => {
      const row = document.createElement('button')
      row.type = 'button'
      row.className = 'lark-doc-theme-item'
      row.setAttribute('role', 'menuitemradio')
      row.dataset.themeChoice = id
      row.textContent = label
      row.addEventListener('click', () => {
        const controller = shell.root._larkDocTheme
        if (!controller) return
        controller.setTheme(theme, 'auto', id === 'default' ? 'default' : 'feishu')
        closeTheme(true)
        refreshThemeUi()
      })
      menu.appendChild(row)
      return row
    })
    const refreshThemeUi = () => {
      readingButton.textContent = host.reading ? '退出阅读' : '阅读'
      readingButton.setAttribute('aria-label', host.reading ? '退出阅读' : '阅读模式')
      const controller = shell.root._larkDocTheme
      const snapshot = controller?.getTheme?.()
      const choice = snapshot?.preset === 'feishu' ? (snapshot.resolved?.theme === 'dark' ? 'feishu-dark' : 'feishu-light') : 'default'
      rows.forEach(row => row.setAttribute('aria-checked', String(row.dataset.themeChoice === choice)))
    }
    button.addEventListener('click', () => {
      menu.hidden = !menu.hidden
      button.setAttribute('aria-expanded', String(!menu.hidden))
      if (!menu.hidden) {
        const rect = button.getBoundingClientRect()
        menu.style.top = `${Math.max(8, Math.min(Math.round(rect.bottom + 4), document.defaultView.innerHeight - menu.offsetHeight - 8))}px`
        menu.style.left = `${Math.max(8, Math.round(rect.right - 144))}px`
        refreshThemeUi()
        rows.find(row => row.getAttribute('aria-checked') === 'true')?.focus()
      }
    })
    listen(actions, 'lark-doc-actions-dismiss', () => closeTheme())
    listen(actions, 'keydown', event => {
      if (menu.hidden || (!menu.contains(event.target) && event.target !== button)) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeTheme(true); return }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      event.preventDefault(); event.stopPropagation()
      const index = rows.indexOf(document.activeElement)
      rows[event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + rows.length) % rows.length].focus()
    })
    listen(document, 'pointerdown', event => { if (!menu.hidden && !menu.contains(event.target) && event.target !== button) closeTheme() })
    listen(document.defaultView, 'resize', () => closeTheme())
    menu.hidden = true
    actions.append(readingButton, commentButton, button, menu)
    themeUi = { readingButton, commentButton, button, menu, refresh: refreshThemeUi }
  }
  let editorContainerObserver = null
  const listen = (target, type, handler, capture = false) => {
    target.addEventListener(type, handler, capture)
    listeners.push(() => target.removeEventListener(type, handler, capture))
  }
  let capabilitiesOff = null
  let versionProviderOff = null
  let session = null
  let sessionContext = []
  let initialSessionBound = false
  const refreshSession = () => {
    host.$forceUpdate()
    runtime.flush()
    host.applyInteractionMode()
    host.refreshTopBar()
    host.refreshToolbar()
    host.refreshOverlays()
    host.refreshPanels()
    host.refreshRevisionPanels()
  }
  const bindSession = () => {
    const current = host.session
    const context = [current, current?.documentId, current?.user, current?.user?.id, current?._destroyed]
    if (context.every((value, index) => Object.is(value, sessionContext[index])) && sessionContext.length) return
    sessionContext = context
    if (current !== session) {
      capabilitiesOff?.()
      versionProviderOff?.()
      session = current
      capabilitiesOff = current?.on?.('capabilities', () => {
        if (host.session === current && !host._isBeingDestroyed && !host._isDestroyed) refreshSession()
      }) || null
      versionProviderOff = current?.on?.('provider-changed', event => {
        if (event?.name === 'versioning' && host.session === current && !host._isBeingDestroyed && !host._isDestroyed) refreshSession()
      }) || null
    }
    // Every UI domain has already rendered against the initialized session during
    // mount. Avoid repainting all domains once more on the first bind; later
    // session/provider changes still take the full refresh path.
    if (initialSessionBound) refreshSession()
    else {
      initialSessionBound = true
      host.applyInteractionMode()
    }
  }
  return {
    ...runtime,
    bindSession,
    mount(editor, controller) {
      host.editor = editor
      host.editorController = controller
      const onEditableUpdate = () => {
        if (host.editor === editor && !editor.isDestroyed && !host._isBeingDestroyed && !host._isDestroyed) runtime.invalidateEditor()
      }
      editor.on('editableUpdate', onEditableUpdate)
      listeners.push(() => editor.off('editableUpdate', onEditableUpdate))
      // 相同正文恢复不会触发 controller 的替换回调，也必须落下早期目录水合闸门。
      const setContent = controller.setContent
      controller.setContent = (...args) => {
        try { return setContent.apply(controller, args) } finally {
          if (host.outlinePending) {
            host.refreshDocumentState()
            runtime.flush()
          }
        }
      }
      listeners.push(() => { controller.setContent = setContent })
      const onBlur = editor.options.onBlur
      const onEditorBlur = payload => {
        if (shell.bubbleHost.contains(payload.event?.relatedTarget)) return
        onBlur?.call(editor, payload)
      }
      editor.off('blur', onBlur)
      editor.on('blur', onEditorBlur)
      listeners.push(() => {
        editor.off('blur', onEditorBlur)
        editor.on('blur', onBlur)
      })
      mountThemeUi()
      uiDomains.forEach(([domain]) => host[`mount${domain}`]())
      runtime.mount()
      bindSession()
      const document = shell.root.ownerDocument
      const window = document.defaultView
      listen(window, 'hashchange', host.jumpSharedBlock)
      host.$nextTick(host.jumpSharedBlock)
      bindMobileEditorControls({ host, editor, shell, listen, listeners })
      // 只有 ProseMirror 自身可编辑；外层成为编辑宿主会吞掉正文焦点和快捷键。
      const syncEditorContainer = () => shell.editorEl.removeAttribute('contenteditable')
      editorContainerObserver = new window.MutationObserver(syncEditorContainer)
      editorContainerObserver.observe(shell.editorEl, { attributes: true, attributeFilter: ['contenteditable'] })
      syncEditorContainer()
      host.syncOutlineReopen()
      host.syncViewportClasses()
      const guardCopy = event => {
        if (host.session?.can?.('canCopy') !== false && evaluateOutputPolicy(host.session?.getProvider?.('security')?.policy, 'copy').allowed) return
        event.preventDefault()
        event.stopImmediatePropagation()
      }
      listen(shell.editorEl, 'copy', guardCopy, true)
      listen(shell.editorEl, 'cut', guardCopy, true)
      // 评论快捷键必须在捕获阶段读取 DOM 选区，早于 ProseMirror selectionchange。
      listen(shell.root, 'keydown', event => host.onCommentShortcut?.(event), true)
      // 链接浮层先消费正文根节点的 Escape；不抢子输入、IME 或更高优先级面板。
      listen(shell.editorEl, 'keydown', event => {
        if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || event.keyCode === 229
          || editor.view.composing || host.versionPanelOpen || !host._linkTarget || event.target !== editor.view.dom) return
        event.preventDefault()
        event.stopPropagation()
        host.closeOverlay()
      }, true)
      listen(shell.root, 'keydown', event => { if (event.key === 'Escape' && !event.defaultPrevented) host.closeOverlay() })

      // 成功提示保留「立即查看」，进入其他弹窗控件后让出它们的操作区域。
      const dismissNoticeForPopup = event => {
        if (host.versionNotice && event.target.closest?.('[aria-haspopup]')) host.dismissVersionNotice()
      }
      listen(shell.root, 'pointerover', dismissNoticeForPopup)
      listen(shell.root, 'focusin', dismissNoticeForPopup)
      listen(shell.paper, 'pointermove', host.onPaperPointerMove)
      listen(shell.paper, 'pointerdown', host.onReminderChipClick)
      listen(shell.editorEl, 'keydown', host.onEditorKeydown)
      listen(shell.editorEl, 'pointerdown', host.onColumnPointerDown)
      listen(shell.editorEl, 'pointerdown', host.onEditorPointerDown)
      listen(shell.editorEl, 'pointermove', host.onEditorPointerMove)
      listen(shell.editorEl, 'click', host.onEditorLinkTouchClick, true)
      listen(shell.editorEl, 'click', host.onEditorLinkClick)
      listen(shell.editorEl, 'dragover', event => { if (!host.onImageDragOver(event)) host.onBlockDragOver(event) })
      listen(shell.editorEl, 'dragleave', event => { if (!shell.editorEl.contains(event.relatedTarget) && !host.dragging) host.dropPosition = null })
      listen(shell.editorEl, 'drop', host.onBlockDrop)
      listen(shell.imageInput, 'change', host.onImageInput)
      listen(shell.fileInput, 'change', host.onFileInput)
      listen(document, 'fullscreenchange', host.onFullscreenChange)
      listen(window, 'keydown', event => {
        host.onWindowKeydown(event)
        runtime.flush()
      })
      listen(window, 'scroll', host.onDocumentScroll, true)
      listen(window, 'scroll', host.refreshLinkTools, true)
      listen(window, 'resize', host.onDocumentScroll)
      listen(window, 'resize', host.syncTableClip)
      listen(window, 'pointerup', host.onHandlePointerUp)
      listen(document, 'pointerdown', event => {
        if (host.linkDialog && !host._dialogsUi?.link.el?.contains(event.target)) host.linkDialog = false
        host.onDocumentPointerDown(event)
      }, true)
      listen(window, 'pointermove', host.onDocumentPointerMove, true)
      editor.commands.ensureLarkDocBlockIds?.()
      editor.commands.normalizeLarkDocIndents?.()
      host.refreshDocumentState()
      host.restoreFolds()
      host.$nextTick(() => { host.updateTableBoundary(); host.refreshTableOverlays?.() })
    },
    transaction() {
      runtime.invalidateEditor()
      host.syncBlockHandleVisibility()
      host.refreshLinkTools()
      host.syncFoldState()
      host.persistFolds()
      host.updateRevisionPanels()
      ;['refreshToolbar', 'refreshTableTools', 'refreshColorPalette', 'refreshCalloutTools', 'refreshRevisionPanels', 'refreshCalendarSearch', 'refreshMentionPanel', 'refreshIsvPanel', 'refreshBubbleBar', 'refreshLinkTools'].forEach(name => host[name]())
      if (host.blockMenuOpen) host.refreshBlockMenu()
      host.$nextTick(() => { host.syncHandleHighlightBackdrop(); host.syncTableClip(); host.refreshTableOverlays?.() })
    },
    selection() {
      runtime.invalidateEditor()
      host.onSelectionUpdate()
      ;['refreshToolbar', 'refreshTableTools', 'refreshColorPalette', 'refreshCalloutTools', 'refreshRevisionPanels', 'refreshCalendarSearch', 'refreshMentionPanel', 'refreshIsvPanel', 'refreshLinkTools'].forEach(name => host[name]())
      host.$nextTick(() => host.refreshTableOverlays?.())
    },
    destroy() {
      host.cancelFileUploads('destroy'); host._fileUploadTasks?.dispose()
      host._blockHandleAnchor = null
      resolveImageFile.cancelAll?.('destroy')
      host._imageUploadErrorOff?.()
      editorContainerObserver?.disconnect()
      editorContainerObserver = null
      listeners.splice(0).forEach(remove => remove())
      capabilitiesOff?.()
      capabilitiesOff = null
      versionProviderOff?.()
      versionProviderOff = null
      const window = shell.root.ownerDocument.defaultView
      window.removeEventListener('pointermove', host.onColumnPointerMove)
      window.removeEventListener('pointerup', host.onColumnPointerUp)
      host.closeMentionPanel()
      host.closeCalendarSearch()
      host.cancelBubbleHoverClose()
      host.clearHandleHighlight()
      host.closeCommandMenu()
      ;['handleHideTimer', 'blockMenuCloseTimer', '_keepMenuTimer', 'pendingChangeTimer', 'pendingDerivedTimer'].forEach(key => clearTimeout(host[key]))
      host.pendingDerivedVersion += 1
      host._backgroundGate.dispose()
      host.destroyTableClipObserver()
      if (host.pendingDerivedIdle && typeof cancelIdleCallback === 'function') cancelIdleCallback(host.pendingDerivedIdle)
      host.pendingDerivedIdle = null
      clearTimeout(host._activeHeadingTimer)
      host._activeHeadingTimer = null
      ;['pendingStateFrame', '_outlineFrame'].forEach(key => { if (host[key]) cancelAnimationFrame(host[key]) })
      uiDomains.slice().reverse().forEach(([domain]) => host[`destroy${domain}`]())
      if (themeUi) { themeUi.readingButton.remove(); themeUi.commentButton.remove(); themeUi.button.remove(); themeUi.menu.remove(); themeUi = null }
      runtime.destroy()
      panelHost.remove()
    },
  }
}
