/** 默认原生 DOM 渲染器；编辑器行为由无框架宿主装配现有纯 JavaScript 模块。 */
import { Editor } from '@tiptap/core'
import { createLarkDocExtensions } from '../components/lark-doc/extensions'
import { sanitizeHTML } from '../components/lark-doc/documentOperations'
import { safeAttachmentId, safeUrl } from '../core/documentOperations'
import { normalizeVditorHtml } from '../legacy'
import { IMAGE_REJECT, imageRejectMessage, isImageMime } from '../core/media/image-insert'
import { createEditorController } from '../editor/EditorController'
import { createNativeEditorHost } from '../editor/nativeEditorHost'
import { createLarkDocConfig } from '../components/lark-doc/larkDocConfig'
import { createWorkspaceState, createWorkspaceController } from '../workspace/WorkspaceController'
import { createWorkspace } from '../ui/workspace'
import { createWorkspaceShell } from '../ui/workspaceShell'
import { createEditorUiRegistry } from '../ui/editorUiRegistry'
import { createWorkspaceViewState } from '../core/workspace/workspace-view-state'
import { createNetworkPolicy } from '../networkPolicy'
import { previewToHtml, looksLikeMarkdown } from '../components/lark-doc/ai'

function prepareHTML(content, format) {
  const legacy = normalizeVditorHtml(content, { force: format === 'vditor', skip: format === 'html' })
  return { ...legacy, html: sanitizeHTML(legacy.html) }
}

function createImageResolver(props, getHost, viewWindow) {
  return async file => {
    const host = getHost()
    if (!host.writable() || !host.featureEnabled('images')) return null
    const maxSize = host.effectiveImageMaxSize
    if (!isImageMime(file.type)) throw new Error(imageRejectMessage(IMAGE_REJECT.MIME))
    if (file.size > maxSize) throw new Error(imageRejectMessage(IMAGE_REJECT.SIZE, { maxSize }))
    if (typeof props.uploadImage === 'function') {
      const uploaded = await props.uploadImage(file)
      if (!host.writable()) return null
      const attchId = typeof uploaded?.attchId === 'string' || Number.isFinite(uploaded?.attchId) ? String(uploaded.attchId) : null
      if (!safeUrl(uploaded?.url, true) || !safeAttachmentId(attchId)) throw new Error('图片上传未返回有效地址或附件 ID')
      return { src: uploaded.url, attchId }
    }
    const src = await new Promise((resolve, reject) => {
      const reader = new viewWindow.FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => reject(new Error('本地图片读取失败'))
      reader.readAsDataURL(file)
    })
    if (!host.writable()) return null
    if (!safeUrl(src, true)) throw new Error('本地图片格式无效')
    return { src, attchId: null }
  }
}

export function createDomRenderer() {
  return {
    name: 'dom-migration',
    mount({ element, props = {}, on = {} }) {
      if (!element || typeof element.appendChild !== 'function') throw new Error('dom renderer 需要普通 DOM 宿主')
      const shell = createWorkspaceShell(element.ownerDocument || document)
      const viewWindow = shell.root.ownerDocument.defaultView
      const editorUiRegistry = createEditorUiRegistry()
      let destroyed = false
      let renderScheduled = false
      let editor = null
      let editorController = null
      let workspaceController = null
      let workspaceUi = null
      let instance = null
      let runtime
      const requestRender = () => {
        if (destroyed || renderScheduled) return
        renderScheduled = true
        Promise.resolve().then(() => { renderScheduled = false; if (!destroyed && workspaceUi) render() })
      }
      const emit = (name, payload) => {
        if (destroyed) return
        if (name === 'update:title') workspaceController?.setTitle(payload)
        if (name === 'mode-change') runtime.state.effectiveReadonly = payload.readonly
        if (name === 'ai-request' && typeof on[name] !== 'function') workspaceController?.startAI(payload)
        if (typeof on[name] === 'function') on[name](payload)
        requestRender()
      }
      const resolveImageFile = createImageResolver(props, () => runtime.host, viewWindow)
      runtime = createNativeEditorHost({
        shell, props, state: createWorkspaceState(props), emit, onChange: requestRender, resolveImageFile,
      })
      const { host: documentHost, state } = runtime
      documentHost.restoreMode()
      const host = {
        getEditor: () => editor,
        getHTML: () => editorController?.getHTML() || '',
        getJSON: () => editorController?.getJSON() || null,
        getText: () => editorController?.getText() || '',
        setContent: (content, options) => editorController?.setContent(content, options) || false,
        setReadonly: readonly => editorController?.setReadonly(readonly) || false,
        focus: () => editorController?.focus(),
        focusTemplateSearch: () => workspaceUi?.focusTemplateSearch(),
        writable: () => documentHost.writable(),
        emit,
        confirm: message => typeof viewWindow.confirm === 'function' ? viewWindow.confirm(message) : true,
        getWindow: () => viewWindow,
        getNavigator: () => viewWindow.navigator,
        getAIProvider: () => props.aiProvider,
        hydrateOutline: outline => documentHost.hydrateOutline(outline),
        bindAITransaction: handler => editor?.on('transaction', handler),
        unbindAITransaction: handler => editor?.off('transaction', handler),
        addBeforeUnload: handler => viewWindow.addEventListener('beforeunload', handler),
        removeBeforeUnload: handler => viewWindow.removeEventListener('beforeunload', handler),
        nextTick: callback => documentHost.$nextTick(callback),
        documentApi: null,
      }
      workspaceController = createWorkspaceController({ state, props, host })
      workspaceController.initializeSession()
      const renderNow = action => (...args) => { const result = action(...args); runtime.flush(); render(); return result }
      const workspaceHandlers = {
        setMaxLength: value => { state.editorConfig.limits.maxLength = value },
        save: () => workspaceController.save(true),
        applyTemplate: value => workspaceController.applyTemplate(value),
        importDocument: event => workspaceController.importDocument(event),
        exportDocument: value => workspaceController.exportDocument(value),
        toggleHistory: () => workspaceController.toggleHistory(),
        closeTemplate: () => workspaceController.closeTemplatePicker(),
        setTemplateQuery: value => { state.templateQuery = value },
        chooseTemplate: id => workspaceController.chooseTemplate(id),
        closeHistory: () => { state.historyOpen = false; workspaceController.focus() },
        createSnapshot: () => workspaceController.createSnapshot(),
        restoreSnapshot: id => workspaceController.restoreSnapshot(id),
        closeAI: () => workspaceController.closeAI(),
        setAIContext: value => { state.aiContextScope = value; workspaceController.resetAIPreview() },
        setAIAction: value => { state.aiAction = value },
        setAILanguage: value => { state.aiLanguage = value },
        setAIPrompt: value => { state.aiPrompt = value },
        startAI: () => workspaceController.startAI(state.aiAction),
        stopAI: () => workspaceController.stopAI(),
        sendAIChat: () => workspaceController.sendAIChat(),
        copyAIPreview: () => workspaceController.copyAIPreview(),
        acceptAI: mode => workspaceController.acceptAI(mode),
        regenerateAI: () => workspaceController.regenerateAI(),
        acceptReviewIssue: issue => workspaceController.acceptReviewIssue(issue),
        ignoreReviewIssue: id => workspaceController.ignoreReviewIssue(id),
        applyAIProposal: () => workspaceController.applyAIProposal(),
        cancelAIProposal: () => { state.aiProposal = null },
        clearNotice: () => { state.notice = '' },
      }
      workspaceUi = createWorkspace({ headerHost: shell.actionsHost, panelHost: shell.panelHost, handlers: workspaceHandlers })
      const errorText = shell.root.ownerDocument.createTextNode('')
      const closeError = shell.root.ownerDocument.createElement('button')
      closeError.type = 'button'
      closeError.setAttribute('aria-label', '关闭错误')
      closeError.textContent = '×'
      closeError.addEventListener('click', () => { state.error = '' })
      shell.error.append(errorText, closeError)
      const reopenOutline = shell.root.ownerDocument.createElement('button')
      reopenOutline.type = 'button'
      reopenOutline.className = 'lark-doc-outline-reopen'
      reopenOutline.setAttribute('aria-label', '展开目录')
      reopenOutline.title = '展开目录'
      reopenOutline.textContent = '☰'
      reopenOutline.addEventListener('click', () => { state.outlineOpen = true })
      shell.outlineHost.parentNode.insertBefore(reopenOutline, shell.outlineHost)

      const render = () => {
        if (destroyed) return
        runtime.flush()
        runtime.bindSession()
        const projected = createWorkspaceViewState(state, props)
        const templateItems = state.templateItems || []
        const query = String(state.templateQuery || '').trim().toLocaleLowerCase()
        workspaceUi.update({
          ...projected,
          maxLength: state.editorConfig.limits.maxLength,
          maxLengthOptions: state.maxLengthOptions,
          exportOptions: state.exportOptions,
          saveStatus: state.saveStatus,
          storageError: state.storageError,
          readonly: documentHost.effectiveReadonly,
          importing: state.importing,
          persistenceLabel: workspaceController.persistenceLabel(),
          persistenceCaveat: workspaceController.persistenceCaveat(),
          maxSnapshots: state.editorConfig.limits.maxSnapshots,
          templateOptions: [{ value: '', label: '模板' }].concat(templateItems.map(item => ({ value: item.id, label: item.label }))),
          templateOpen: state.templateOpen,
          templateQuery: state.templateQuery,
          filteredTemplates: query ? templateItems.filter(item => `${item.label} ${item.title} ${item.id}`.toLocaleLowerCase().includes(query)) : templateItems,
          historyOpen: state.historyOpen,
          snapshots: state.snapshots,
          aiOpen: state.aiOpen,
          aiActions: state.aiActions,
          aiContextOptions: state.aiContextOptions,
          aiContextScope: state.aiContextScope,
          aiContextSummary: state.aiContextSummary,
          aiRunning: state.aiRunning,
          aiAction: state.aiAction,
          aiLanguageOptions: state.aiLanguageOptions,
          aiLanguage: state.aiLanguage,
          aiPrompt: state.aiPrompt,
          aiMessages: state.aiMessages,
          aiStatus: state.aiStatus,
          aiPreview: state.aiPreview,
          aiPreviewHtml: state.aiPreview && (state.aiContentFormat !== 'text' || looksLikeMarkdown(state.aiPreview)) ? previewToHtml(state.aiPreview, state.aiContentFormat) : '',
          aiReviewIssues: state.aiReviewIssues,
          aiProposal: state.aiProposal,
          aiError: state.aiError,
          aiReplaceDisabled: !!(state.aiBudgetExceeded && state.aiGeneratedAction !== 'title'),
        })
        const readonly = documentHost.effectiveReadonly
        state.effectiveReadonly = readonly
        shell.paper.style.display = state.slides ? 'none' : ''
        shell.root.classList.toggle('lark-doc-slides', state.slides)
        shell.root.classList.toggle('lark-doc-fullscreen', !!state.fullscreen)
        shell.root.classList.toggle('lark-doc-reading', readonly)
        shell.root.classList.toggle('lark-doc-mode-suggest', state.mode === 'suggest')
        shell.root.classList.toggle('lark-doc-titlebar-fixed', !!state.editorConfig.layout.titleBarFixed)
        shell.root.classList.toggle('lark-doc-toolbar-fixed', !!state.editorConfig.layout.toolbarFixed)
        shell.root.classList.toggle('lark-doc-dom-migration-ready', !!editor)
        ;['standard', 'wide', 'full'].forEach(mode => shell.root.classList.toggle(`lark-doc-width-${mode}`, state.widthMode === mode))
        shell.root.setAttribute('data-interaction-mode', documentHost.interactionMode)
        shell.root.setAttribute('data-interaction-reason', documentHost.interactionReason)
        shell.root.setAttribute('data-title', state.title || '')
        shell.editorEl.setAttribute('contenteditable', readonly ? 'false' : 'true')
        shell.statusSummary.textContent = `${state.wordCount}${documentHost.effectiveMaxLength > 0 ? ` / ${documentHost.effectiveMaxLength}` : ''} 字 · ${state.outline.length} 个标题`
        shell.statusHint.textContent = readonly ? '仅阅读' : '输入 / 快速插入'
        shell.modeToastText.textContent = state.modeToast
        shell.modeToast.hidden = !state.modeToast
        errorText.textContent = state.error
        shell.error.hidden = !state.error
        reopenOutline.hidden = state.outlineOpen || !documentHost.featureEnabled('outline')
        shell.dropLine.style.display = state.dropPosition === null ? 'none' : ''
        shell.dropLine.style.top = `${state.dropLineTop}px`
      }
      const refreshChange = transaction => {
        documentHost.scheduleDocumentState()
        if (transaction?.getMeta && (transaction.getMeta('larkDocBlockIds') || transaction.getMeta('larkDocIndentNormalized'))) return
        clearTimeout(state.pendingChangeTimer)
        const publish = () => {
          if (destroyed || !editorController) return
          const payload = { html: editorController.getHTML(), json: editorController.getJSON(), text: editorController.getText() }
          state.html = payload.html
          workspaceController.queueSave()
          emit('update', payload)
          emit('change', payload)
        }
        const delay = state.editorConfig.performance.changeDebounce
        state.pendingChangeTimer = delay > 0 ? setTimeout(publish, delay) : null
        if (!delay) publish()
      }
      const initialContent = props.initialContent == null ? state.html : props.initialContent
      element.appendChild(shell.root)
      try {
        const preparedInitial = !documentHost.collabOptions && typeof initialContent === 'string'
          ? prepareHTML(initialContent, props.contentFormat)
          : null
        editor = new Editor({
          element: shell.editorEl,
          content: documentHost.collabOptions ? undefined : (preparedInitial ? preparedInitial.html : initialContent),
          editable: !documentHost.effectiveReadonly,
          extensions: createLarkDocExtensions({
            ...props,
            collab: documentHost.collabOptions || undefined,
            config: state.editorConfig,
            maxLength: documentHost.effectiveMaxLength,
            resolveImageFile,
            onSlash: documentHost.onSlash,
            onMention: documentHost.onMention,
            onHeadingNumberMenu: documentHost.openHeadingNumberMenu,
            onListNumberMenu: documentHost.openListNumberMenu,
            onImageFiles: documentHost.insertImageFiles,
            onBackspace: documentHost.deletePreviousBlockOnBackspace,
            onError: message => { state.error = message },
          }),
          onUpdate: ({ transaction }) => refreshChange(transaction),
          onTransaction: () => { if (documentHost.editor) runtime.transaction(); requestRender() },
          onSelectionUpdate: () => { if (documentHost.editor) runtime.selection(); requestRender() },
          onFocus: () => { if (documentHost.editor) runtime.selection() },
          onBlur: () => {
            state.bubbleVisible = false
            documentHost.closeBubbleAlignMenu()
            documentHost.closeBubbleHeadingMenu()
          },
        })
        editorController = createEditorController({
          editor, session: workspaceController.getSession(), title: state.title,
          prepareHTML: (content, format) => prepareHTML(content, format || props.contentFormat),
          onImportReport: report => workspaceController.onImportReport(report),
          getMaxLength: () => documentHost.effectiveMaxLength,
          getNetwork: () => createNetworkPolicy(state.editorConfig.network),
          onBeforeContentReplace: () => { documentHost.closeBlockMenu(); state.handleRange = null; documentHost._foldsReady = false },
          onAfterContentReplace: () => { documentHost.restoreFolds(); state.savedSelection = null; documentHost.refreshDocumentState() },
        })
        runtime.mount(editor, editorController)
        editorController.setImportReport(preparedInitial?.converted ? preparedInitial.report : null)
      } catch (error) {
        runtime.destroy()
        editorController?.destroy()
        if (!editorController) editor?.destroy()
        workspaceUi.destroy()
        shell.root.remove()
        destroyed = true
        throw error
      }
      host.documentApi = instance = {
        state,
        getEditor: () => editor,
        getHTML: () => editorController.getHTML(),
        getJSON: () => editorController.getJSON(),
        getText: () => editorController.getText(),
        getTitle: () => workspaceController.getTitle(),
        setTitle: value => { const changed = workspaceController.setTitle(value); if (changed) emit('update', { title: state.title }); return changed },
        setContent: (content, options) => workspaceController.setContent(content, options),
        setReadonly: value => workspaceController.setReadonly(value),
        isReadonly: () => documentHost.effectiveReadonly,
        focus: () => editorController.focus(),
        getSession: () => workspaceController.getSession(),
        getImportReport: () => workspaceController.getImportReport(),
        toggleSlides: renderNow(documentHost.toggleSlides),
        isSlides: () => !!state.slides,
      }
      ;['insertContent', 'insertText', 'undo', 'redo', 'save', 'getWorkspace', 'callWorkspace', 'record', 'onReady',
        'queueSave', 'flushOnLeave', 'saveNow', 'storageFailure', 'toggleHistory', 'createSnapshot', 'restoreSnapshot',
        'importDocument', 'exportDocument', 'mapAI', 'currentAIContext', 'resetAIPreview', 'startAI', 'sendAIChat',
        'regenerateAI', 'stopAI', 'closeAI', 'copyAIPreview', 'acceptAI', 'insertAIResult', 'acceptReviewIssue',
        'ignoreReviewIssue', 'applyAIProposal'].forEach(method => { instance[method] = (...args) => workspaceController[method](...args) })
      ;['executeCommand', 'setMode', 'openVersionPanel', 'closeVersionPanel', 'openSaveVersionDialog',
        'toggleSharePopover', 'openPermissionDialog', 'openExportDialog', 'createCommentFromSelection'].forEach(method => {
        if (typeof documentHost[method] === 'function') instance[method] = documentHost[method]
      })
      editorUiRegistry.register({ destroy: () => runtime.destroy() })
      render()
      Promise.resolve(workspaceController.onReady()).catch(error => {
        if (destroyed) return
        state.error = error.message || '工作台初始化失败'
        emit('error', error)
      })
      return {
        instance, root: shell.root, editor, state, workspaceController, editorController, workspaceUi,
        stageUi: documentHost._stageUi, topBarUi: documentHost._topBarUi, toolbarUi: documentHost._toolbarUi,
        helpFabUi: documentHost._helpFabUi, outlineUi: documentHost._panelsUi?.outline,
        editorUiRegistry, viewWindow, props, requestRender, nativeHost: runtime,
        cleanup: () => { destroyed = true; renderScheduled = false },
      }
    },
    update(handle, props = {}) {
      if (!handle?.instance || handle.destroyed) return
      Object.assign(handle.props, props)
      if (Object.prototype.hasOwnProperty.call(props, 'config')) handle.state.editorConfig = createLarkDocConfig(props.config)
      if (Object.prototype.hasOwnProperty.call(props, 'readonly')) handle.instance.setReadonly(props.readonly === true)
      if (Object.prototype.hasOwnProperty.call(props, 'initialTitle')) handle.instance.setTitle(props.initialTitle)
      if (Object.prototype.hasOwnProperty.call(props, 'session')) {
        const previous = handle.nativeHost.host.session
        previous?.detachEditor?.(handle.editor)
        handle.workspaceController.initializeSession()
        handle.editorController.session = handle.workspaceController.getSession()
        handle.workspaceController.getSession()?.attachEditor?.(handle.editor)
      }
      handle.nativeHost.updateProps()
      handle.requestRender()
    },
    destroy(handle) {
      if (!handle?.instance || handle.destroyed) return
      handle.destroyed = true
      handle.cleanup()
      handle.editorUiRegistry.destroy()
      handle.workspaceUi.destroy()
      handle.workspaceController.dispose()
      handle.editorController.destroy()
      handle.root.remove()
      handle.instance = null
    },
    getInstance(handle) { return handle && !handle.destroyed ? handle.instance : null },
    getRoot(handle) { return handle && !handle.destroyed ? handle.root : null },
  }
}

export default createDomRenderer
