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
import { LARGE_DOCUMENT_SIZE } from '../editor/documentStats'

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
      let importConfirmation = null
      let instance = null
      let runtime
      let snapshotAbort = null
      let contentChangePending = false
      let largeDocumentModel = null
      let largeDocumentViewport = null
      let largeDocumentReader = null
      let largeDocumentDoc = null
      let largeDocumentFailedDoc = null
      let largeDocumentProjection = null
      let flatDocumentProjection = null
      let largeDocumentProjectionLoading = null
      let largeDocumentProjectionChecked = false
      let largeDocumentPendingDoc = null
      let largeDocumentReadTimer = null
      let largeDocumentReadAbort = null
      let readProjectionSelection = null
      const prepareProjectionSelection = ({ editor: current, nextState, transaction }) => {
        if (!current.storage.larkDoc?.pagedImport && current.storage.larkDoc?.pagedView?.isDocument(nextState.doc)) { current.storage.larkDoc.pagedView.prepareSelection(); return }
        if (destroyed || current.storage.larkDoc?.pagedImport || !largeDocumentProjection || nextState.doc.content.size <= LARGE_DOCUMENT_SIZE
          || largeDocumentProjection === current.storage.larkDoc?.pagedView
          || nextState.doc === current.state.doc && nextState.selection.eq(current.state.selection)) return
        largeDocumentProjection.prepareSelection(readProjectionSelection(nextState.selection, transaction))
      }
      let largeDocumentViewportFrame = null
      let largeDocumentRuntimeTransactionFrame = null
      let blockHandleVisibilityScheduled = false
      const refreshBlockHandleVisibility = () => {
        if (destroyed || blockHandleVisibilityScheduled) return
        blockHandleVisibilityScheduled = true
        Promise.resolve().then(() => {
          blockHandleVisibilityScheduled = false
          if (!destroyed) documentHost.syncBlockHandleVisibility()
        })
      }
      const requestRender = () => {
        if (destroyed || renderScheduled) return
        renderScheduled = true
        Promise.resolve().then(() => { renderScheduled = false; if (!destroyed && workspaceUi) render() })
      }
      const refreshLargeDocumentViewport = () => {
        if (!largeDocumentViewport) return
        if (largeDocumentViewportFrame != null) return
        const refresh = () => {
          largeDocumentViewportFrame = null
          if (!destroyed) largeDocumentViewport?.refresh()
        }
        if (typeof viewWindow.requestAnimationFrame === 'function') largeDocumentViewportFrame = viewWindow.requestAnimationFrame(refresh)
        else largeDocumentViewportFrame = setTimeout(refresh, 16)
      }
      const refreshRuntimeTransaction = () => {
        if (!documentHost?.editor) return
        const largeDocument = documentHost.editor.state.doc.content.size > LARGE_DOCUMENT_SIZE
        if (!largeDocument) {
          runtime.transaction()
          return
        }
        if (largeDocumentRuntimeTransactionFrame != null) return
        const refresh = () => {
          largeDocumentRuntimeTransactionFrame = null
          if (!destroyed && documentHost?.editor) runtime.transaction()
        }
        if (typeof viewWindow.requestAnimationFrame === 'function') largeDocumentRuntimeTransactionFrame = viewWindow.requestAnimationFrame(refresh)
        else largeDocumentRuntimeTransactionFrame = setTimeout(refresh, 16)
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
        if (largeDocumentViewportFrame != null) {
          if (typeof viewWindow.cancelAnimationFrame === 'function') viewWindow.cancelAnimationFrame(largeDocumentViewportFrame)
          else clearTimeout(largeDocumentViewportFrame)
          largeDocumentViewportFrame = null
        }
        if (largeDocumentRuntimeTransactionFrame != null) {
          if (typeof viewWindow.cancelAnimationFrame === 'function') viewWindow.cancelAnimationFrame(largeDocumentRuntimeTransactionFrame)
          else clearTimeout(largeDocumentRuntimeTransactionFrame)
          largeDocumentRuntimeTransactionFrame = null
        }
        if (largeDocumentReadTimer != null) viewWindow.clearTimeout(largeDocumentReadTimer)
        largeDocumentReadTimer = null
        largeDocumentReadAbort?.abort()
        largeDocumentReadAbort = null
        largeDocumentViewport?.destroy()
        largeDocumentViewport = null
        largeDocumentProjection?.setActive(false)
        largeDocumentModel = null
        largeDocumentDoc = null
        largeDocumentFailedDoc = null
        largeDocumentPendingDoc = null
        shell.root.removeAttribute('data-ld-segment-count')
        shell.root.removeAttribute('data-ld-segment-blocks')
      }
      const scheduleLargeDocumentLayout = () => {
        const doc = editor?.state?.doc
        const paged = editor?.storage.larkDoc?.pagedView
        const pagedDocument = doc && paged?.isDocument(doc)
        if (pagedDocument && largeDocumentProjection !== paged) {
          flatDocumentProjection = largeDocumentProjection
          flatDocumentProjection?.setActive(false)
          largeDocumentViewport?.destroy(); largeDocumentViewport = null
          largeDocumentProjection = paged
          paged.setWindowCallback(nodes => { refreshBlockHandleVisibility(); documentHost.syncTableClip(nodes) })
          editor.storage.larkDoc.projection = paged
        } else if (!pagedDocument && largeDocumentProjection === paged) {
          paged?.setActive(false)
          largeDocumentProjection = flatDocumentProjection
          editor.storage.larkDoc.projection = flatDocumentProjection
        }
        const large = !!doc && doc.content.size > LARGE_DOCUMENT_SIZE
        shell.root.classList.toggle('lark-doc-large-document', large)
        if (!large) {
          resetLargeDocumentLayout()
          return
        }
        // During a locked import the DOM observer maintains the window. Avoid
        // two extra synchronous layout/selection reads for every appended page.
        if (!editor.storage.larkDoc?.pagedImport || !editor.view.dom.classList.contains('lark-doc-segment-layout')) largeDocumentProjection?.setActive(true)
        if (!pagedDocument && !largeDocumentProjectionChecked && !largeDocumentProjectionLoading && largeDocumentFailedDoc !== doc) {
          largeDocumentProjectionLoading = import('../editor/segmentedDocumentModel').then(tools => {
            if (destroyed || !editor || editor.storage.larkDoc?.pagedView?.isDocument(editor.state.doc)) return
            readProjectionSelection = tools.createProjectionSelectionReader(editor.view)
            largeDocumentProjection = tools.createLargeDocumentProjection({ editorDom: editor.view.dom,
              onRenderWindowChange: nodes => {
                if (destroyed) return
                // A prepared selection must finish before hover cleanup can dispatch.
                refreshBlockHandleVisibility()
                documentHost.syncTableClip(nodes)
              },
              initialActive: editor.state.doc.content.size > LARGE_DOCUMENT_SIZE,
              getSelectionNodes: () => readProjectionSelection(editor.state.selection) })
            editor.storage.larkDoc.projection = largeDocumentProjection
            largeDocumentProjectionChecked = true
            largeDocumentProjection?.setActive(editor.state.doc.content.size > LARGE_DOCUMENT_SIZE)
          }).catch(error => {
            if (!destroyed) { largeDocumentFailedDoc = editor?.state.doc; emit('error', error) }
          }).finally(() => { largeDocumentProjectionLoading = null })
        }
        if (editor.storage.larkDoc?.pagedImport) return
        if (largeDocumentDoc === doc && largeDocumentModel) return
        if (largeDocumentFailedDoc === doc) return
        if (largeDocumentPendingDoc === doc) return
        if (largeDocumentReadTimer != null) viewWindow.clearTimeout(largeDocumentReadTimer)
        largeDocumentReadAbort?.abort()
        const abort = new AbortController()
        largeDocumentReadAbort = abort
        largeDocumentPendingDoc = doc
        largeDocumentReadTimer = viewWindow.setTimeout(async () => {
          largeDocumentReadTimer = null
          const current = () => !destroyed && !abort.signal.aborted && !!editor && editor.state.doc === doc
          try {
            if (!await documentHost._backgroundGate.wait(current)) return
            const tools = await import('../editor/segmentedDocumentModel')
            if (!current()) return
            largeDocumentReader ||= tools.createSegmentedDocumentReader()
            const model = await largeDocumentReader.create(pagedDocument ? paged.logicalDocument(doc) : doc, { signal: abort.signal, waitForBackground: () => documentHost._backgroundGate.wait(current) })
            if (!model || !current()) return
            largeDocumentModel = model
            largeDocumentDoc = doc
            largeDocumentViewport?.destroy()
            if (!pagedDocument) largeDocumentViewport = tools.createLargeDocumentViewportController({ editorDom: editor.view.dom, model, viewWindow })
            shell.root.setAttribute('data-ld-segment-count', String(model.segmentCount))
            shell.root.setAttribute('data-ld-segment-blocks', String(model.segmentBlocks))
          } catch (error) {
            if (current()) { largeDocumentFailedDoc = doc; emit('error', error) }
          } finally {
            if (largeDocumentPendingDoc === doc) largeDocumentPendingDoc = null
          }
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
        setContentAsync: (content, options) => editorController?.setContentAsync(content, options) || Promise.resolve(false),
        setReadonly: readonly => { if (readonly) resolveImageFile.cancelAll('readonly'); return editorController?.setReadonly(readonly) || false },
        focus: () => editorController?.focus(),
        focusTemplateSearch: () => workspaceUi?.focusTemplateSearch(),
        writable: () => documentHost.writable(),
        emit,
        confirm: message => typeof viewWindow.confirm === 'function' ? viewWindow.confirm(message) : true,
        confirmImport: async (message, details) => {
          const { createImportConfirmation } = await import('../ui/dialogs')
          if (destroyed) return false
          importConfirmation?.destroy()
          const dialog = importConfirmation = createImportConfirmation({ host: shell.panelHost, message, ...details })
          try { return await dialog.result }
          finally { if (importConfirmation === dialog) importConfirmation = null }
        },
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
        onLoadError: () => { state.notice = '面板暂时无法打开，请关闭后重试' },
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
      workspaceUi = createWorkspace({ headerHost: shell.actionsHost, panelHost: shell.panelHost, noticeHost: shell.noticeHost, handlers: workspaceHandlers })
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
        if (editor?.state.doc.content.size > LARGE_DOCUMENT_SIZE) documentHost._backgroundGate.touch()
        documentHost.scheduleDocumentState(transaction)
        snapshotAbort?.abort()
        const attributesOnly = transaction?.getMeta && (transaction.getMeta('larkDocBlockIds') || transaction.getMeta('larkDocIndentNormalized'))
        // Attribute normalization can invalidate an in-flight user snapshot.
        // Keep that user's publication owed, without publishing standalone metadata changes.
        if (attributesOnly && !contentChangePending) return
        if (!attributesOnly) contentChangePending = true
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
          contentChangePending = false
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
        const selectionScrollMargin = { top: 5, right: 5, bottom: 5, left: 5 }
        const selectionScrollThreshold = { top: 0, right: 0, bottom: 0, left: 0 }
        editor = new Editor({
          element: shell.editorEl,
          content: documentHost.collabOptions ? undefined : (preparedInitial ? preparedInitial.html : initialContent),
          editorProps: {
            scrollMargin: selectionScrollMargin, scrollThreshold: selectionScrollThreshold,
            handleScrollToSelection() {
              largeDocumentProjection?.refresh()
              const toolbar = shell.root.querySelector('.lark-doc-toolbar')
              const style = toolbar && viewWindow.getComputedStyle(toolbar)
              const height = style && style.display !== 'none' && /^(sticky|fixed)$/.test(style.position) ? toolbar.getBoundingClientRect().height : 0
              const inset = height > 0 ? Math.ceil(height + Math.max(0, parseFloat(style.top) || 0)) : 0
              selectionScrollMargin.top = inset + 5
              selectionScrollThreshold.top = inset ? inset + 5 : 0
              return false
            },
          },
          editable: !documentHost.effectiveReadonly,
          extensions: createLarkDocExtensions({
            ...props,
            getCalendarEventOptions: () => ({ onJoin: props.onCalendarEventJoin, refetch: props.calendarEventRefetch }),
            getIsvOptions: () => ({ onButtonAction: props.onIsvButtonAction, onCatalogJump: props.onIsvCatalogJump }),
            getImageOptions: () => ({ enabled: isCommandEnabled(state.editorConfig, 'image', 'images'), aiEnabled: state.editorConfig.features.ai !== false, onAction: documentHost.runImageAction, onComment: documentHost.openImageComments, canLoad: src => createNetworkPolicy(state.editorConfig.network).allows(src) }),
            isColumnsEnabled: () => state.editorConfig.features.columns,
            isAgendaEnabled: () => isCommandEnabled(state.editorConfig, 'agenda', 'insert'),
            isDividerEnabled: () => isCommandEnabled(state.editorConfig, 'divider', 'blockStyle'),
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
          onUpdate: ({ transaction }) => { if (editor?.storage.larkDoc?.pagedImport) return; refreshLargeDocumentViewport(); refreshChange(transaction); requestRender() },
          onTransaction: () => { largeDocumentProjection?.completeSelection(); if (editor?.storage.larkDoc?.pagedImport) { scheduleLargeDocumentLayout(); return } refreshLargeDocumentViewport(); refreshRuntimeTransaction(); requestRender() },
          onSelectionUpdate: () => {
            if (documentHost.editor) {
              largeDocumentViewport?.ensureForPos(documentHost.editor.state.selection.from)
              runtime.selection()
            }
            requestRender()
          },
          onFocus: () => { if (documentHost.editor) runtime.selection() },
          onBlur: () => {
            state.bubbleVisible = false
            documentHost.closeBubbleAlignMenu()
            documentHost.closeBubbleHeadingMenu()
          },
        })
        Object.defineProperty(editor, '__v_skip', { value: true, configurable: true, writable: true })
        editor.storage.larkDoc.backgroundGate = documentHost._backgroundGate
        editorController = createEditorController({
          editor, session: workspaceController.getSession(), title: state.title,
          prepareHTML: (content, format) => prepareHTML(content, format || props.contentFormat),
          onImportReport: report => workspaceController.onImportReport(report),
          getMaxLength: () => documentHost.effectiveMaxLength,
          getNetwork: () => createNetworkPolicy(state.editorConfig.network),
          onBeforeContentReplace: () => {
            snapshotAbort?.abort()
            viewWindow.clearTimeout(state.pendingChangeTimer)
            if (state.pendingChangeIdle && typeof viewWindow.cancelIdleCallback === 'function') viewWindow.cancelIdleCallback(state.pendingChangeIdle)
            state.pendingChangeIdle = null
            resolveImageFile.cancelAll('document-change')
            documentHost.cancelFileUploads('document-change')
            workspaceController.closeAI(false)
            documentHost.closeBlockMenu()
            documentHost.endBlockDrag()
            // A content replacement invalidates the previous block position.
            // Clear the native handle itself, otherwise its stale button can
            // sit over the first cell of the new document and intercept input.
            documentHost.handleRange = null
            state.handleRange = null
            documentHost._foldsReady = false
          },
          onAfterContentReplace: () => { documentHost.restoreFolds(); state.savedSelection = null; documentHost.refreshDocumentState() },
        })
        editor.on('beforeTransaction', prepareProjectionSelection)
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
        setContentAsync: (content, options) => workspaceController.setContentAsync(content, options),
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
          importConfirmation?.destroy()
          editor?.off('beforeTransaction', prepareProjectionSelection)
          resolveImageFile.cancelAll('destroy')
          snapshotAbort?.abort()
          resetLargeDocumentLayout()
          largeDocumentProjection?.destroy()
          if (flatDocumentProjection !== largeDocumentProjection) flatDocumentProjection?.destroy()
          if (editor) editor.storage.larkDoc.projection = null
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
      if (['session', 'documentId', 'uploader', 'uploadFile'].some(key => Object.prototype.hasOwnProperty.call(props, key) && props[key] !== handle.props[key])) handle.nativeHost.host.cancelFileUploads('document-change')
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
