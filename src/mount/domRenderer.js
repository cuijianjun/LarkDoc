/** 默认原生 DOM 渲染器；编辑器行为由无框架宿主装配现有纯 JavaScript 模块。 */
import { Editor } from '@tiptap/core'
import { createLarkDocExtensions } from '../components/lark-doc/extensions'
import { sanitizeHTML } from '../components/lark-doc/documentOperations'
import { isAbortError, normalizeUploader } from '../core/media/upload'
import { normalizeVditorHtml } from '../legacy'
import { createEditorController } from '../editor/EditorController'
import { createNativeEditorHost } from '../editor/nativeEditorHost'
import { createLarkDocConfig, isCommandEnabled, resolveMediaOptions } from '../components/lark-doc/larkDocConfig'
import { applyMediaHtmlMode } from '../core/media/htmlMode'
import { createWorkspaceState, createWorkspaceController } from '../workspace/WorkspaceController'
import { createWorkspace } from '../ui/workspace'
import { createWorkspaceShell } from '../ui/workspaceShell'
import { createEditorUiRegistry } from '../ui/editorUiRegistry'
import { createWorkspaceViewState } from '../core/workspace/workspace-view-state'
import { createNetworkPolicy } from '../networkPolicy'
import { previewToHtml, looksLikeMarkdown } from '../components/lark-doc/ai'
import { LARGE_DOCUMENT_SIZE } from '../editor/documentSnapshot'
import { createSegmentedDocumentModel, createSegmentedDocumentReader, createLargeDocumentViewportController } from '../editor/segmentedDocumentModel'

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Runtime config patches preserve omitted sections while replacing supplied sections. */
function mergeConfigPatch(current, patch) {
  const base = isPlainObject(current) ? current : {}
  const source = isPlainObject(patch) ? patch : {}
  return { ...base, ...source }
}

function prepareHTML(content, format) {
  const legacy = normalizeVditorHtml(content, { force: format === 'vditor', skip: format === 'html' })
  return { ...legacy, html: sanitizeHTML(legacy.html) }
}

function createImageResolver(props, getHost, onCallbackError) {
  let input
  let provider
  let generation = 0
  const active = new Set()
  const resolve = async (file, context = {}) => {
    const host = getHost()
    if (!host.writable() || !isCommandEnabled(host.larkDocConfig, 'image', 'images')) return null
    const next = props.uploader || props.uploadImage
    if (!provider || next !== input) {
      const normalized = normalizeUploader(next, { limits: null })
      active.forEach(controller => controller.abort('uploader-change'))
      if (provider && provider !== input) provider.clearResume()
      input = next
      provider = normalized
    }
    const current = generation
    const controller = new AbortController()
    const onAbort = () => controller.abort(context.signal.reason || 'placeholder-removed')
    if (context.signal?.aborted) onAbort()
    else context.signal?.addEventListener('abort', onAbort, { once: true })
    active.add(controller)
    try {
      const uploaded = await provider.upload(file, {
        ...context,
        signal: controller.signal,
        source: context.source || 'select',
        documentId: host.session?.documentId ?? props.documentId ?? null,
        limits: { maxSize: host.effectiveImageMaxSize },
        onCallbackError,
      })
      if (current !== generation || !host.writable() || !isCommandEnabled(host.larkDocConfig, 'image', 'images')) return null
      return { src: uploaded.url, attchId: uploaded.attchId == null ? null : String(uploaded.attchId) }
    } catch (error) {
      if (isAbortError(error) || current !== generation) return null
      throw error
    } finally {
      context.signal?.removeEventListener('abort', onAbort)
      active.delete(controller)
    }
  }
  resolve.cancelAll = reason => {
    generation += 1
    getHost()?.editor?.storage.imageUploadTasks?.cancelAll(reason)
    active.forEach(controller => controller.abort(reason))
    if (provider && provider !== input) provider.clearResume()
  }
  resolve.generation = () => generation
  return resolve
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
      let snapshotAbort = null
      let largeDocumentModel = null
      let largeDocumentViewport = null
      let largeDocumentReader = null
      let largeDocumentDoc = null
      let largeDocumentPendingDoc = null
      let largeDocumentReadTimer = null
      let largeDocumentReadAbort = null
      const requestRender = () => {
        if (destroyed || renderScheduled) return
        renderScheduled = true
        Promise.resolve().then(() => { renderScheduled = false; if (!destroyed && workspaceUi) render() })
      }
      const emit = (name, payload) => {
        if (destroyed) return
        if (name === 'update:title') workspaceController?.setTitle(payload)
        if (name === 'mode-change') {
          if (payload.readonly) resolveImageFile.cancelAll('readonly')
          runtime.state.effectiveReadonly = payload.readonly
        }
        if (name === 'ai-request' && typeof on[name] !== 'function') {
          if (payload?.action === 'image') workspaceController?.openImageAI(payload.image)
          else if (payload === 'rewrite' || payload?.action === 'chat') workspaceController?.openSelectionAI()
          else workspaceController?.startAI(payload)
        }
        const result = typeof on[name] === 'function' ? on[name](payload) : undefined
        requestRender()
        return result
      }
      const resetLargeDocumentLayout = () => {
        if (largeDocumentReadTimer != null) viewWindow.clearTimeout(largeDocumentReadTimer)
        largeDocumentReadTimer = null
        largeDocumentReadAbort?.abort()
        largeDocumentReadAbort = null
        largeDocumentViewport?.destroy()
        largeDocumentViewport = null
        largeDocumentModel = null
        largeDocumentDoc = null
        largeDocumentPendingDoc = null
        shell.root.removeAttribute('data-ld-segment-count')
        shell.root.removeAttribute('data-ld-segment-blocks')
      }
      const scheduleLargeDocumentLayout = () => {
        const doc = editor?.state?.doc
        const large = !!doc && doc.content.size > LARGE_DOCUMENT_SIZE
        shell.root.classList.toggle('lark-doc-large-document', large)
        if (!large) {
          resetLargeDocumentLayout()
          return
        }
        if (largeDocumentDoc === doc && largeDocumentModel) return
        if (largeDocumentPendingDoc === doc) return
        if (largeDocumentReadTimer != null) viewWindow.clearTimeout(largeDocumentReadTimer)
        largeDocumentPendingDoc = doc
        largeDocumentReadTimer = viewWindow.setTimeout(async () => {
          largeDocumentReadTimer = null
          largeDocumentPendingDoc = null
          if (destroyed || !editor || editor.state.doc !== doc) return
          const model = createSegmentedDocumentModel(doc)
          largeDocumentReadAbort?.abort()
          const abort = new AbortController()
          largeDocumentReadAbort = abort
          largeDocumentModel = model
          largeDocumentDoc = doc
          largeDocumentViewport?.destroy()
          largeDocumentViewport = createLargeDocumentViewportController({ editorDom: editor.view.dom, model, viewWindow })
          largeDocumentViewport.refresh(model)
          largeDocumentReader ||= createSegmentedDocumentReader()
          const result = await largeDocumentReader.read(model, { signal: abort.signal })
          if (destroyed || abort.signal.aborted || editor.state.doc !== doc || largeDocumentModel !== model) return
          model.applyWorkerResult(result)
          largeDocumentViewport.refresh(model)
          shell.root.setAttribute('data-ld-segment-count', String(model.segmentCount))
          shell.root.setAttribute('data-ld-segment-blocks', String(model.segmentBlocks))
        }, 120)
      }
      const resolveImageFile = createImageResolver(props, () => runtime.host, error => emit('error', error))
      runtime = createNativeEditorHost({
        shell, props, state: createWorkspaceState(props), emit, onChange: requestRender, resolveImageFile,
      })
      const { host: documentHost, state } = runtime
      documentHost.restoreMode()
      const host = {
        getEditor: () => editor,
        getDocumentAccess: () => editorController,
        getHTML: () => editorController?.getHTML() || '',
        getJSON: () => editorController?.getJSON() || null,
        getText: () => editorController?.getText() || '',
        setContent: (content, options) => editorController?.setContent(content, options) || false,
        setReadonly: readonly => { if (readonly) resolveImageFile.cancelAll('readonly'); return editorController?.setReadonly(readonly) || false },
        focus: () => editorController?.focus(),
        focusTemplateSearch: () => workspaceUi?.focusTemplateSearch(),
        writable: () => documentHost.writable(),
        emit,
        confirm: message => typeof viewWindow.confirm === 'function' ? viewWindow.confirm(message) : true,
        getWindow: () => viewWindow,
        getNavigator: () => viewWindow.navigator,
        getAIProvider: () => props.aiProvider,
        focusImageAI: () => { requestRender(); Promise.resolve().then(() => { if (!destroyed) workspaceUi?.focusImageAI() }) },
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
        openVersionHistory: renderNow(() => documentHost.openVersionPanel()),
        openSaveVersion: renderNow(() => documentHost.openSaveVersionDialog()),
        openCommentHistory: renderNow(() => { documentHost.closeHeaderMenu(); documentHost.openCommentHistory() }),
        closeTemplate: () => workspaceController.closeTemplatePicker(),
        setTemplateQuery: value => { state.templateQuery = value },
        chooseTemplate: id => workspaceController.chooseTemplate(id),
        closeHistory: () => { state.historyOpen = false; workspaceController.focus() },
        createSnapshot: () => workspaceController.createSnapshot(),
        restoreSnapshot: id => workspaceController.restoreSnapshot(id),
        closeAI: () => workspaceController.closeAI(),
        removeAIImage: () => workspaceController.removeAIImage(),
        removeAIReference: () => workspaceController.removeAIReference(),
        setAIContext: value => { state.aiContextScope = value; workspaceController.resetAIPreview() },
        setAIAction: value => { state.aiAction = value },
        setAILanguage: value => { state.aiLanguage = value },
        setAIPrompt: value => { state.aiPrompt = value },
        isAIChatCurrent: epoch => !destroyed && state.aiOpen && state.aiChatEpoch === epoch
          && workspaceController.aiChatScopeValid(state.aiSelectionChat ? workspaceController._aiChatScope : workspaceController._aiImageScope),
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
        workspaceController.syncImageAI()
        const projected = createWorkspaceViewState(state, props)
        const templateItems = state.templateItems || []
        const query = String(state.templateQuery || '').trim().toLocaleLowerCase()
        workspaceUi.update({
          ...projected,
          maxLength: state.editorConfig.limits.maxLength,
          maxLengthOptions: state.maxLengthOptions,
          saveStatus: state.saveStatus,
          storageError: state.storageError,
          readonly: documentHost.effectiveReadonly,
          versionCanCreate: documentHost.versionCanCreate,
          commentHistoryAvailable: documentHost.commentCanViewHistory?.() === true,
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
          aiImageChat: state.aiImageChat,
          aiSelectionChat: state.aiSelectionChat,
          aiReference: state.aiReference,
          aiCanRetry: !!workspaceController._aiLastChat,
          aiImage: state.aiImage,
          aiImageAvailable: !!workspaceController.getAIAdapter()?.supportsImages,
          aiServiceAvailable: !!workspaceController.getAIChatAdapter(),
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
        shell.root.classList.toggle('lark-doc-has-image-ai', !!(state.aiOpen && (state.aiImageChat || state.aiSelectionChat)))
        shell.root.classList.toggle('lark-doc-mode-suggest', state.mode === 'suggest')
        shell.root.classList.toggle('lark-doc-titlebar-fixed', !!state.editorConfig.layout.titleBarFixed)
        shell.root.classList.toggle('lark-doc-toolbar-fixed', !!state.editorConfig.layout.toolbarFixed)
        shell.root.classList.toggle('lark-doc-dom-migration-ready', !!editor)
        scheduleLargeDocumentLayout()
        ;['standard', 'wide', 'full'].forEach(mode => shell.root.classList.toggle(`lark-doc-width-${mode}`, state.widthMode === mode))
        shell.root.setAttribute('data-interaction-mode', documentHost.interactionMode)
        shell.root.setAttribute('data-interaction-reason', documentHost.interactionReason)
        shell.root.setAttribute('data-title', state.title || '')
        // The inner ProseMirror owns editability. Toggling this ancestor on
        // every render makes the entire document's editing/layout state dirty
        // and fights the host's MutationObserver on the next microtask.
        shell.statusSummary.textContent = `${state.wordCount}${documentHost.effectiveMaxLength > 0 ? ` / ${documentHost.effectiveMaxLength}` : ''} 字 · ${state.outline.length} 个标题`
        shell.statusHint.textContent = readonly ? '仅阅读' : '输入 / 快速插入'
        shell.modeToastText.textContent = state.modeToast
        shell.modeToast.hidden = !state.modeToast
        errorText.textContent = state.error
        shell.error.hidden = !state.error
        reopenOutline.hidden = state.outlineOpen || !documentHost.featureEnabled('outline')
        shell.dropLine.style.display = state.dropPosition === null ? 'none' : ''
        shell.root.classList.toggle('is-image-file-dragging', state.dropPosition !== null && !state.dragging)
        shell.dropLine.style.top = `${state.dropLineTop}px`
      }
      const refreshChange = transaction => {
        documentHost.scheduleDocumentState(transaction)
        snapshotAbort?.abort()
        if (transaction?.getMeta && (transaction.getMeta('larkDocBlockIds') || transaction.getMeta('larkDocIndentNormalized'))) return
        clearTimeout(state.pendingChangeTimer)
        if (state.pendingChangeIdle && typeof viewWindow.cancelIdleCallback === 'function') viewWindow.cancelIdleCallback(state.pendingChangeIdle)
        state.pendingChangeIdle = null
        const publish = async () => {
          if (destroyed || !editorController) return
          const doc = editor.state.doc
          const media = resolveMediaOptions(state.editorConfig)
          const abort = new AbortController()
          snapshotAbort = abort
          const payload = doc.content.size > 500000
            ? await editorController.getSnapshotAsync({ signal: abort.signal, media })
            : { html: applyMediaHtmlMode(editorController.getHTML(), media), json: editorController.getJSON(), text: editorController.getText() }
          if (!payload || abort.signal.aborted || destroyed || editor.state.doc !== doc) return
          state.html = payload.html
          workspaceController.queueSave()
          emit('update', payload)
          emit('change', payload)
        }
        const baseDelay = Number(state.editorConfig.performance.changeDebounce) || 0
        const docSize = editor?.state?.doc?.content?.size || 0
        // Let the editor stay responsive while a large document settles. The
        // final payload is still emitted once after the quiet period.
        // A large document must stay interactive through a burst of typing and
        // scrolling.  Serialising its HTML/JSON/text payload is intentionally
        // kept behind a quiet window; requestIdleCallback alone is insufficient
        // because one serialization is still a long, non-preemptible task.
        const delay = docSize > 500000 ? Math.max(baseDelay, 2000) : baseDelay
        const scheduleIdle = () => {
          if (destroyed) return
          if (typeof viewWindow.requestIdleCallback === 'function') {
            state.pendingChangeIdle = viewWindow.requestIdleCallback(() => { state.pendingChangeIdle = null; publish() }, { timeout: 1000 })
          } else publish()
        }
        state.pendingChangeTimer = delay > 0 ? setTimeout(() => { state.pendingChangeTimer = null; scheduleIdle() }, delay) : null
        if (!delay) scheduleIdle()
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
            getCalendarEventOptions: () => ({ onJoin: props.onCalendarEventJoin, refetch: props.calendarEventRefetch }),
            getIsvOptions: () => ({ onButtonAction: props.onIsvButtonAction, onCatalogJump: props.onIsvCatalogJump }),
            getImageOptions: () => ({ enabled: isCommandEnabled(state.editorConfig, 'image', 'images'), aiEnabled: state.editorConfig.features.ai !== false, onAction: documentHost.runImageAction, onComment: documentHost.openImageComments, canLoad: src => createNetworkPolicy(state.editorConfig.network).allows(src) }),
            isColumnsEnabled: () => state.editorConfig.features.columns,
            isAgendaEnabled: () => isCommandEnabled(state.editorConfig, 'agenda', 'insert'),
            getMathOptions: () => ({ enabled: state.editorConfig.features.math, scope: documentHost.session }),
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
          // The document can cross the large-document threshold through a
          // runtime setContent/insert transaction after the initial render.
          // Re-project once after the view has applied that transaction so
          // the CSS fast path is enabled (or removed) at the same boundary.
          onUpdate: ({ transaction }) => { refreshChange(transaction); requestRender() },
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
          onBeforeContentReplace: () => {
            resolveImageFile.cancelAll('document-change')
            workspaceController.closeAI(false)
            documentHost.closeBlockMenu()
            // A content replacement invalidates the previous block position.
            // Clear the native handle itself, otherwise its stale button can
            // sit over the first cell of the new document and intercept input.
            documentHost.handleRange = null
            state.handleRange = null
            documentHost._foldsReady = false
          },
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
        setReadonly: value => { if (value) resolveImageFile.cancelAll('readonly'); return workspaceController.setReadonly(value) },
        isReadonly: () => documentHost.effectiveReadonly,
        focus: () => editorController.focus(),
        getSession: () => workspaceController.getSession(),
        getImportReport: () => workspaceController.getImportReport(),
        toggleSlides: renderNow(documentHost.toggleSlides),
        isSlides: () => !!state.slides,
      }
      ;['insertContent', 'insertText', 'undo', 'redo', 'save', 'getWorkspace', 'callWorkspace', 'record', 'onReady',
        'queueSave', 'flushOnLeave', 'saveNow', 'setAutoSave', 'getAutoSave', 'storageFailure', 'toggleHistory', 'createSnapshot', 'restoreSnapshot',
        'importDocument', 'exportDocument', 'mapAI', 'currentAIContext', 'resetAIPreview', 'startAI', 'sendAIChat',
        'regenerateAI', 'stopAI', 'closeAI', 'openImageAI', 'openSelectionAI', 'removeAIImage', 'removeAIReference', 'copyAIPreview', 'acceptAI', 'insertAIResult', 'acceptReviewIssue',
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
        resolveImageFile, stageUi: documentHost._stageUi, topBarUi: documentHost._topBarUi, toolbarUi: documentHost._toolbarUi,
        helpFabUi: documentHost._helpFabUi, outlineUi: documentHost._panelsUi?.outline,
        editorUiRegistry, viewWindow, props, requestRender, nativeHost: runtime,
        cleanup: () => {
          resolveImageFile.cancelAll('destroy')
          snapshotAbort?.abort()
          resetLargeDocumentLayout()
          if (state.pendingChangeIdle && typeof viewWindow.cancelIdleCallback === 'function') viewWindow.cancelIdleCallback(state.pendingChangeIdle)
          clearTimeout(state.pendingChangeTimer)
          state.pendingChangeIdle = null
          destroyed = true
          renderScheduled = false
        },
      }
    },
    update(handle, props = {}) {
      if (!handle?.instance || handle.destroyed) return
      if (['session', 'documentId', 'uploader', 'uploadImage'].some(key => Object.prototype.hasOwnProperty.call(props, key) && props[key] !== handle.props[key])) handle.resolveImageFile.cancelAll('document-change')
      Object.assign(handle.props, props)
      if (Object.prototype.hasOwnProperty.call(props, 'config')) {
        handle.state.editorConfig = createLarkDocConfig(mergeConfigPatch(handle.state.editorConfig, props.config))
        if (!isCommandEnabled(handle.state.editorConfig, 'image', 'images')) handle.resolveImageFile.cancelAll('images-disabled')
      }
      if (Object.prototype.hasOwnProperty.call(props, 'readonly')) handle.instance.setReadonly(props.readonly === true)
      if (Object.prototype.hasOwnProperty.call(props, 'initialTitle')) handle.instance.setTitle(props.initialTitle)
      if (Object.prototype.hasOwnProperty.call(props, 'session')) {
        const previous = handle.nativeHost.host.session
        previous?.detachEditor?.(handle.editor)
        handle.workspaceController.initializeSession()
        handle.editorController.session = handle.workspaceController.getSession()
        handle.workspaceController.getSession()?.attachEditor?.(handle.editor, handle.editorController)
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
