import { TextSelection } from '@tiptap/pm/state'
import { clampBlockIndent, collectOutline, safeAttachmentId, safeUrl } from '../components/lark-doc/documentOperations'
import { isBlockActionEnabled, isConfigEnabled } from '../components/lark-doc/larkDocConfig'
import { nearestInsertPosition } from '../core/media/image-insert'
import { fileBlockAttrs, sortFileFiles } from '../core/media/file-block'
import { createNativeOptionsHost } from './nativeOptionsHost'
import { createTopBar } from '../ui/topBar'
import { evaluateOutputPolicy } from '../core/policy/output'
import viewModesMixin from '../components/lark-doc/editor/viewModesMixin'
import selectionPacingMixin from '../components/lark-doc/editor/selectionPacingMixin'
import commandMenuMixin from '../components/lark-doc/editor/commandMenuMixin'
import commandMenuUiMixin from '../components/lark-doc/editor/commandMenuUiMixin'
import tableToolsMixin from '../components/lark-doc/editor/tableToolsMixin'
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
  ['Panels', 'refreshPanels'], ['Stage', 'refreshStage'], ['TableTools', 'refreshTableTools'],
  ['HelpFab', 'refreshHelpFab'], ['ColorPalette', 'refreshColorPalette'], ['CalloutTools', 'refreshCalloutTools'],
  ['RevisionPanels', 'refreshRevisionPanels'], ['CalendarSearch', 'refreshCalendarSearch'],
  ['MentionPanel', 'refreshMentionPanel'], ['IsvPanel', 'refreshIsvPanel'], ['SearchPanel', 'refreshSearchPanel'],
  ['Reminder', 'refreshReminder'], ['BubbleBar', 'refreshBubbleBar'], ['ToolbarBar', 'refreshToolbar'],
  ['HeadingNumberMenu', 'refreshHeadingNumberMenu'], ['BlockHandle', 'refreshBlockHandle'], ['CommandMenu', 'refreshCommandMenu'],
]

const options = {
  mixins: [viewModesMixin, selectionPacingMixin, commandMenuMixin, commandMenuUiMixin, tableToolsMixin,
    blockHandleMixin, blockHandleUiMixin, blockMenuMixin, blockIndentMixin, bubbleMenuMixin, calloutColorMixin,
    toolbarMenusMixin, dialogsUiMixin, panelsUiMixin, toolbarCollapseMixin, toolbarUiMixin, headingNumberMixin,
    headingNumberMenuUiMixin, stageUiMixin, tableToolsUiMixin, helpFabUiMixin, colorPaletteUiMixin,
    calloutToolsUiMixin, revisionUiMixin, calendarSearchUiMixin, overlayDismissMixin, mentionMixin,
    mentionUiMixin, isvPanelUiMixin, searchPanelUiMixin, reminderMixin, reminderUiMixin, calendarMixin,
    isvMixin, revisionMixin, foldPersistMixin, collabMixin, p6bMixin, overlaysUiMixin, extendedOverlaysUiMixin],
  data() { return {
    editor: null, editorController: null, helpOpen: false, savedSelection: null, error: '',
    alignNames: { left: '左', center: '居中', right: '右', justify: '两端' },
    alignGlyphs: { left: '≡', center: '☷', right: '≣', justify: '▤' },
    pendingStateFrame: null, pendingChangeTimer: null,
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
    visibleBlockActions() { return this.blockActions.filter(item => this.isBlockActionEnabled(item.id)) },
    visibleBlockTypeActions() {
      return this.blockTypeActions.filter(item => this.featureEnabled(item.id === 'codeBlock' ? 'codeBlocks' : 'blockStyle') && this.isBlockActionEnabled(item.id))
    },
    visibleBlockListActions() {
      const list = this.visibleBlockActions.filter(item => item.id !== 'duplicate')
      const duplicate = this.blockActions.find(item => item.id === 'duplicate')
      return this.handleIsTable && duplicate && this.isBlockActionEnabled('duplicate') ? [duplicate, ...list] : list
    },
  },
  watch: {
    outlineOpen() { this.syncOutlineReopen() },
    isNarrowViewport() { this.syncViewportClasses() },
    viewportOrientation() { this.syncViewportClasses() },
    session() {
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
      if (value) this.resolveImageFile.cancelAll?.('readonly')
      if (!this.editor) return
      this.closeEditingOverlays()
      if (value) this.tableBoundary.visible = false
      else this.$nextTick(() => this.updateTableBoundary())
    },
    editorConfig: { deep: true, handler() {
      this.editor?.storage.characterCount?.setLimit?.(this.effectiveMaxLength)
      this.syncOutlineReopen()
      this.$nextTick(() => this.refreshDocumentState())
    } },
  },
  methods: {
    featureEnabled(name) { return isConfigEnabled(this.larkDocConfig, name) },
    toolbarEnabled(name) { return this.larkDocConfig.toolbar[name] !== false && this.featureEnabled(name) },
    isBlockActionEnabled(id) { return isBlockActionEnabled(this.larkDocConfig, id) },
    syncViewportClasses() {
      this.$refs.root.classList.toggle('lark-doc-narrow', this.isNarrowViewport)
      this.$refs.root.classList.toggle('lark-doc-landscape', this.viewportOrientation === 'landscape')
    },
    mountTopBar() {
      if (this._topBarUi) return
      const anchor = this.$refs.topBarHost
      this._topBarUi = createTopBar({
        host: anchor.parentNode, anchor, overlayHost: this.$refs.overlayHost,
        actionsHost: this.$refs.actionsHost,
        refs: this.$refs,
        handlers: {
          updateTitle: value => this.updateTitle(value),
          setMode: id => this.setMode(id),
          toggleNotify: event => this.toggleNotify(event),
          toggleCreateMenu: event => this.toggleCreateMenu(event),
          toggleTopbarMore: event => this.toggleTopbarMore(event),
          createMenuItem: item => this.onCreateMenuItem(item),
          closeCreateMenu: () => this.closeCreateMenu(),
          closeTopbarMore: () => this.closeTopbarMore(),
          topbarMoreItem: item => this.onTopbarMoreItem(item),
          hoverTopbarMoreItem: item => this.hoverTopbarMoreItem(item),
          topbarMoreSubmenuItem: item => this.onTopbarMoreSubmenuItem(item),
        },
      })
      this.refreshTopBar()
    },
    refreshToolbar() {
      const ui = this._toolbarUi
      if (!ui) return
      const anchor = this.$refs.toolbarHost
      if (this.larkDocConfig.layout.toolbarVisible === false) ui.el.remove()
      else if (ui.el.parentNode !== anchor.parentNode) anchor.before(ui.el)
      toolbarUiMixin.methods.refreshToolbar.call(this)
    },
    refreshTopBar() {
      if (!this._topBarUi) return
      this._topBarUi.update({
        ...toolbarUiMixin.methods.buildTopBarState.call(this),
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
    async insertImageFiles(files, pos, source = 'select') {
      if (!this.writable() || !this.featureEnabled('images')) return
      this.error = ''
      let anchor = Number.isInteger(pos) ? nearestInsertPosition(this.editor.state.doc, pos) : null
      const generation = this.resolveImageFile.generation?.()
      for (const file of Array.from(files || [])) {
        try {
          const pending = this.resolveImageFile(file, { source })
          const image = await pending
          if (!this.writable() || generation !== this.resolveImageFile.generation?.()) return
          if (!image) continue
          if (anchor !== null) this.editor.commands.setTextSelection(anchor)
          this.editor.chain().focus().setImage({ ...image, originalSrc: image.src, originalAttchId: image.attchId, alt: file.name }).run()
          if (anchor !== null) anchor = this.editor.state.selection.to
        } catch (error) {
          if (generation !== this.resolveImageFile.generation?.()) return
          this.error = error?.message || '图片上传失败'
        }
      }
    },
    async insertFileBlocks(files, pos) {
      if (!this.writable() || !this.featureEnabled('files')) return
      const { accepted, rejected } = sortFileFiles(files, { maxSize: this.effectiveFileMaxSize })
      this.error = rejected[0]?.message || ''
      let anchor = Number.isInteger(pos) ? nearestInsertPosition(this.editor.state.doc, pos) : null
      for (const file of accepted) {
        try {
          if (typeof this.uploadFile !== 'function') throw new Error('未配置文件上传：请通过 uploadFile 传入上传实现')
          const uploaded = await this.uploadFile(file)
          if (!this.writable()) return
          const attrs = fileBlockAttrs(file, uploaded || {})
          if (!safeAttachmentId(attrs.token) && !(attrs.src && safeUrl(attrs.src, true))) throw new Error('文件上传未返回有效地址或附件 ID')
          if (anchor !== null) this.editor.commands.setTextSelection(anchor)
          this.editor.chain().focus().setFileBlock(attrs).run()
          if (anchor !== null) anchor = this.editor.state.selection.to
        } catch (error) { this.error = error?.message || '文件上传失败' }
      }
    },
    refreshDocumentState() {
      if (!this.editor || this.editor.isDestroyed || this._isBeingDestroyed || this._isDestroyed) return
      this.outlinePending = false
      this.outline = Object.freeze(collectOutline(this.editor.state.doc))
      this.syncOutlineCollapseState()
      this.syncFoldState()
      this.wordCount = this.editor.storage.characterCount.characters()
      if (this.effectiveMaxLength > 0 && this.wordCount > this.effectiveMaxLength) this.error = `正文不能超过 ${this.effectiveMaxLength} 字，请缩短正文`
      else if (this.error.startsWith('正文不能超过 ')) this.error = ''
      if (this.searchQuery) this.scheduleSearchUpdate()
    },
    scheduleDocumentState() {
      if (!this.editor || this.editor.isDestroyed || this._isBeingDestroyed || this._isDestroyed) return
      if (!this.larkDocConfig.performance.stateUpdateFrame) {
        this.refreshDocumentState()
        this.$nextTick(() => this.updateHandleAndTable())
      } else if (!this.pendingStateFrame) {
        this.pendingStateFrame = requestAnimationFrame(() => {
          this.pendingStateFrame = null
          if (!this.editor || this.editor.isDestroyed || this._isBeingDestroyed || this._isDestroyed) return
          this.refreshDocumentState()
          this.$nextTick(() => this.updateHandleAndTable())
        })
      }
    },
    updateHandleAndTable() {
      if (!this.editor || this.editor.isDestroyed || this._isBeingDestroyed || this._isDestroyed) return
      this.updateTableBoundary()
      if (!this.handleRange) return
      const { from, to } = this.handleRange
      const doc = this.editor.state.doc
      if (from < 0 || from >= to || to > doc.content.size) { this.closeBlockMenu(); this.handleRange = null; return }
      const start = doc.resolve(from)
      const end = doc.resolve(to)
      if (!start.sameParent(end) || start.textOffset || end.textOffset || from !== start.posAtIndex(start.index(), start.depth) || to !== end.posAtIndex(end.index(), end.depth)) {
        this.closeBlockMenu(); this.handleRange = null
      } else this.positionBlockHandle(this.handleRange)
    },
    onDocumentScroll() {
      if (this._outlineFrame || !this.editor || this.editor.isDestroyed || this._isBeingDestroyed || this._isDestroyed) return
      this._outlineFrame = requestAnimationFrame(() => {
        this._outlineFrame = null
        if (!this.editor || this.editor.isDestroyed || this._isBeingDestroyed || this._isDestroyed) return
        if (!this.blockMenuOpen && !this.blockTypeMenuOpen && !this.handlePressed) this.positionBlockHandle(this.handleRange || this.currentBlockRange())
        this.syncHandleHighlightBackdrop()
        if (this.blockAlignMenuOpen) this.positionBlockAlignMenu()
        if (this.blockColorMenuOpen) this.positionBlockColorMenu()
        if (this.bubbleAlignOpen) this.positionBubbleAlignMenu()
        if (this.bubbleVisible) this.bubblePosition = this.bubbleBarPosition(this.editor.state.selection)
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
    onDocumentPointerMove(event) {
      if (this.$refs.root.contains(event.target)) return
      if (!event.target.closest?.('.lark-doc-block-handle, .lark-doc-callout-tools')) this.scheduleHandleHide()
    },
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
      templates: { get: (_host, source) => source.templateItems },
      resolveImageFile: { get: () => resolveImageFile },
    },
  })
  const host = runtime.host
  const listeners = []
  let editorContainerObserver = null
  const listen = (target, type, handler, capture = false) => {
    target.addEventListener(type, handler, capture)
    listeners.push(() => target.removeEventListener(type, handler, capture))
  }
  let capabilitiesOff = null
  let session = null
  let sessionContext = []
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
      session = current
      capabilitiesOff = current?.on?.('capabilities', () => {
        if (host.session === current && !host._isBeingDestroyed && !host._isDestroyed) refreshSession()
      }) || null
    }
    refreshSession()
  }
  return {
    ...runtime,
    bindSession,
    mount(editor, controller) {
      host.editor = editor
      host.editorController = controller
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
      uiDomains.forEach(([domain]) => host[`mount${domain}`]())
      runtime.mount()
      bindSession()
      const document = shell.root.ownerDocument
      const window = document.defaultView
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
      listen(shell.root, 'keydown', event => { if (event.key === 'Escape') host.closeOverlay() })
      listen(shell.paper, 'pointermove', host.onPaperPointerMove)
      listen(shell.paper, 'pointerdown', host.onReminderChipClick)
      listen(shell.editorEl, 'keydown', host.onEditorKeydown)
      listen(shell.editorEl, 'pointerdown', host.onColumnPointerDown)
      listen(shell.editorEl, 'pointermove', host.onEditorPointerMove)
      listen(shell.editorEl, 'dragover', host.onBlockDragOver)
      listen(shell.editorEl, 'drop', host.onBlockDrop)
      listen(shell.imageInput, 'change', host.onImageInput)
      listen(shell.fileInput, 'change', host.onFileInput)
      listen(document, 'fullscreenchange', host.onFullscreenChange)
      listen(window, 'keydown', event => {
        host.onWindowKeydown(event)
        if (host.slides && ['ArrowLeft', 'ArrowRight'].includes(event.key)) event.preventDefault()
        runtime.flush()
      })
      listen(window, 'scroll', host.onDocumentScroll, true)
      listen(window, 'resize', host.onDocumentScroll)
      listen(window, 'pointerup', host.onHandlePointerUp)
      listen(document, 'pointerdown', host.onDocumentPointerDown, true)
      listen(window, 'pointermove', host.onDocumentPointerMove, true)
      editor.commands.ensureLarkDocBlockIds?.()
      editor.commands.normalizeLarkDocIndents?.()
      host.refreshDocumentState()
      host.restoreFolds()
      host.$nextTick(() => host.updateTableBoundary())
    },
    transaction() {
      runtime.invalidateEditor()
      host.syncFoldState()
      host.persistFolds()
      host.updateRevisionPanels()
      ;['refreshToolbar', 'refreshTableTools', 'refreshColorPalette', 'refreshCalloutTools', 'refreshRevisionPanels', 'refreshCalendarSearch', 'refreshMentionPanel', 'refreshIsvPanel', 'refreshBubbleBar'].forEach(name => host[name]())
      if (host.blockMenuOpen) host.refreshBlockMenu()
      host.$nextTick(() => { host.syncHandleHighlightBackdrop(); host.syncTableClip() })
    },
    selection() {
      runtime.invalidateEditor()
      host.onSelectionUpdate()
      ;['refreshToolbar', 'refreshTableTools', 'refreshColorPalette', 'refreshCalloutTools', 'refreshRevisionPanels', 'refreshCalendarSearch', 'refreshMentionPanel', 'refreshIsvPanel'].forEach(name => host[name]())
    },
    destroy() {
      resolveImageFile.cancelAll?.('destroy')
      editorContainerObserver?.disconnect()
      editorContainerObserver = null
      listeners.splice(0).forEach(remove => remove())
      capabilitiesOff?.()
      capabilitiesOff = null
      const window = shell.root.ownerDocument.defaultView
      window.removeEventListener('pointermove', host.onColumnPointerMove)
      window.removeEventListener('pointerup', host.onColumnPointerUp)
      host.closeMentionPanel()
      host.closeCalendarSearch()
      host.cancelBubbleHoverClose()
      host.clearHandleHighlight()
      host.closeCommandMenu()
      ;['handleHideTimer', 'blockMenuCloseTimer', '_keepMenuTimer', 'pendingChangeTimer'].forEach(key => clearTimeout(host[key]))
      ;['pendingStateFrame', '_outlineFrame'].forEach(key => { if (host[key]) cancelAnimationFrame(host[key]) })
      uiDomains.slice().reverse().forEach(([domain]) => host[`destroy${domain}`]())
      runtime.destroy()
      panelHost.remove()
    },
  }
}
