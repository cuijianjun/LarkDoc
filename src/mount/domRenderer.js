/** 默认原生 DOM 渲染器；编辑器行为由无框架宿主装配现有纯 JavaScript 模块。 */
import { Editor } from '@tiptap/core'
import { createLarkDocExtensions } from '../components/lark-doc/extensions'
import { sanitizeHTML, createBlockId } from '../components/lark-doc/documentOperations'
import { isAbortError, normalizeUploader } from '../core/media/upload'
import { normalizeVditorHtml } from '../legacy'
import { createEditorController } from '../editor/EditorController'
import { createNativeEditorHost } from '../editor/nativeEditorHost'
import { createLarkDocConfig, resolveMediaOptions, isCommandEnabled, isBlockActionEnabled } from '../components/lark-doc/larkDocConfig'
import { applyMediaHtmlMode } from '../core/media/htmlMode'
import { createWorkspaceState, createWorkspaceController } from '../workspace/WorkspaceController'
import { createWorkspace } from '../ui/workspace'
import { iconNode } from '../ui/icon'
import { createWorkspaceShell } from '../ui/workspaceShell'
import { createEditorUiRegistry } from '../ui/editorUiRegistry'
import { createWorkspaceViewState } from '../core/workspace/workspace-view-state'
import { createNetworkPolicy } from '../networkPolicy'
import { evaluateOutputPolicy } from '../core/policy/output'
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
  const resumeOwner = createBlockId()
  let owner = null, ownerStops = []
  const captureOwner = host => {
    const session = host.session, editor = host.editor, source = props.uploader || props.uploadImage
    const scope = () => JSON.stringify([host.documentId, props.documentId, session?.documentId, session?.user?.id ?? props.user?.id,
      session?._identityGeneration, session?._privateIdentityGeneration, session?._authorizationGeneration])
    const key = scope()
    return { session, documentId: session?.documentId ?? props.documentId ?? null,
      current: () => getHost() === host && !host._isDestroyed && !host._isBeingDestroyed && host.nativeScopeValid !== false
        && session === host.session && !session?._destroyed && editor === host.editor && !editor?.isDestroyed
        && source === (props.uploader || props.uploadImage) && key === scope() }
  }
  const resolve = async (file, context = {}) => {
    const host = getHost()
    if (!host.writable() || !isCommandEnabled(host.larkDocConfig, 'image', 'images')) return null
    if (owner && !owner.current()) resolve.cancelAll('context-change')
    const next = props.uploader || props.uploadImage
    if (!provider || next !== input) {
      const normalized = normalizeUploader(next, { limits: null })
      active.forEach(controller => controller.abort('uploader-change'))
      if (provider && provider !== input) provider.clearResume()
      input = next
      provider = normalized
    }
    if (!owner) {
      const scope = owner = captureOwner(host)
      const retire = () => { if (owner === scope && !scope.current()) resolve.cancelAll('identity-change') }
      ownerStops = typeof scope.session?.on === 'function'
        ? ['comments-reset', 'capabilities', 'identity'].map(name => scope.session.on(name, retire)) : []
    }
    const current = generation, operationOwner = owner, operationProvider = provider
    const controller = new AbortController()
    const isCurrent = () => {
      if (current !== generation || owner !== operationOwner) return false
      if (!operationOwner.current()) { resolve.cancelAll('context-change'); return false }
      return !controller.signal.aborted && host.writable() && isCommandEnabled(host.larkDocConfig, 'image', 'images')
    }
    const onAbort = () => controller.abort(context.signal.reason || 'placeholder-removed')
    if (context.signal?.aborted) onAbort()
    else context.signal?.addEventListener('abort', onAbort, { once: true })
    active.add(controller)
    try {
      const uploaded = await operationProvider.upload(file, {
        ...context,
        signal: controller.signal,
        source: context.source || 'select',
        documentId: operationOwner.documentId,
        // The existing provider cache key supports a scope. Never share an old
        // identity's resumable chunks, including with externally owned providers.
        resumeScope: JSON.stringify([resumeOwner, current, context.resumeScope ?? null]),
        limits: { maxSize: host.effectiveImageMaxSize },
        onCallbackError: error => { if (isCurrent()) return onCallbackError(error) },
      })
      if (!isCurrent()) return null
      return { src: uploaded.url, attchId: uploaded.attchId == null ? null : String(uploaded.attchId) }
    } catch (error) {
      if (isAbortError(error) || !isCurrent()) return null
      throw error
    } finally {
      context.signal?.removeEventListener('abort', onAbort)
      active.delete(controller)
    }
  }
  resolve.cancelAll = reason => {
    generation += 1
    owner = null
    ownerStops.splice(0).forEach(stop => stop?.())
    const host = getHost()
    host?.editor?.storage.imageUploadTasks?.cancelAll(reason)
    host?._imageUploadErrorOff?.()
    if (host) host._imageUploadErrorOff = null
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
      let changeAbort = null, changeGeneration = 0
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
        if (name === 'workspace-import') return workspaceUi?.requestImport(payload)
        if (name === 'workspace-export') return workspaceController?.exportDocument(payload)
        if (name === 'update:title') workspaceController?.setTitle(payload)
        if (name === 'mode-change') {
          if (payload.readonly) resolveImageFile.cancelAll('readonly')
          runtime.state.effectiveReadonly = payload.readonly
        }
        if (name === 'ai-request' && typeof on[name] !== 'function') {
          if (payload?.action === 'image') workspaceController?.openImageAI(payload.image)
          // 只有显式要「对话」的入口（块菜单「问问AI」、表格 AI）才开问答面板；
          // 其余 —— 工具栏 AI、气泡、命令菜单、块菜单翻译 —— 都是**一次性生成**
          // （续写/扩写/精简/翻译…），直接按动作进结果面板，别再让用户先对着
          // 「今天有什么工作要处理？」重打一遍需求。
          else if (payload?.action === 'chat') workspaceController?.openSelectionAI()
          else workspaceController?.startAI(typeof payload === 'string' ? payload : payload?.action || 'rewrite')
        }
        const result = typeof on[name] === 'function' ? on[name](payload) : undefined
        requestRender()
        return result
      }
      // 视频块外部工具条的「分享 / 评论」是纯 DOM NodeView，够不到 Vue $emit；
      // 冒泡的 lark-doc:file-action 在这里转成同一个 emit('file-action') 出口给宿主。
      const onFileAction = (event) => {
        event.stopPropagation()
        if (event.detail?.action === 'copyLink') {
          if (isBlockActionEnabled(state.editorConfig, 'copyLink') && documentHost.session?.can?.('canCopy') !== false && evaluateOutputPolicy(documentHost.session?.getProvider?.('security')?.policy, 'copy').allowed) {
            void documentHost.copyBlockLink({ from: event.detail.pos })
          }
          return
        }
        emit('file-action', event.detail || {})
      }
      shell.root.addEventListener('lark-doc:file-action', onFileAction)
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
        editor?.view.dom.removeAttribute('data-ld-segment-count')
        editor?.view.dom.removeAttribute('data-ld-segment-blocks')
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
        // Keep the existing segment model for block-heavy documents; only
        // the large-character threshold activates the DOM render window.
        if (!large && (pagedDocument || !doc || doc.childCount <= 128)) {
          resetLargeDocumentLayout()
          return
        }
        // During a locked import the DOM observer maintains the window. Avoid
        // two extra synchronous layout/selection reads for every appended page.
        if (!editor.storage.larkDoc?.pagedImport || !editor.view.dom.classList.contains('lark-doc-segment-layout')) largeDocumentProjection?.setActive(large)
        if (large && !pagedDocument && !largeDocumentProjectionChecked && !largeDocumentProjectionLoading && largeDocumentFailedDoc !== doc) {
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
        getHTML: () => editorController?.getHTML() || '',
        getJSON: () => editorController?.getJSON() || null,
        getText: () => editorController?.getText() || '',
        getDocumentAccess: () => ({
          getTitle: () => state.title,
          isReadonly: () => documentHost.effectiveReadonly,
          prepareContent: (...args) => editorController.prepareContent(...args),
          applyPreparedContent: (...args) => editorController.applyPreparedContent(...args),
        }),
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
        getTheme: () => shell.root._larkDocTheme?.getTheme?.() || null,
        setTheme: (theme, contentTheme, preset) => shell.root._larkDocTheme?.setTheme?.(theme, contentTheme, preset) || null,
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
        setAIAction: value => workspaceController.switchAIAction(value),
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
      reopenOutline.setAttribute('data-tooltip', '展开目录')
      reopenOutline.appendChild(iconNode('outline-expand', 20))
      reopenOutline.addEventListener('click', () => { state.outlineOpen = true })
      shell.outlineHost.parentNode.insertBefore(reopenOutline, shell.outlineHost)

      const render = () => {
        if (destroyed) return
        runtime.flush()
        runtime.bindSession()
        workspaceController.checkInitialization?.()
        workspaceController.syncImageAI()
        const projected = createWorkspaceViewState(state, props)
        const templateItems = state.templateItems || []
        const query = String(state.templateQuery || '').trim().toLocaleLowerCase()
        workspaceUi.update({
          ...projected,
          compactHeader: documentHost.compactHeader,
          commentHistoryAvailable: documentHost.commentCanViewHistory?.() === true,
          maxLength: state.editorConfig.limits.maxLength,
          maxLengthOptions: state.maxLengthOptions,
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
          aiImageChat: state.aiImageChat,
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
        ;['standard', 'wide', 'full'].forEach(mode => shell.root.classList.toggle(`lark-doc-width-${mode}`, state.widthMode === mode))
        shell.root.setAttribute('data-interaction-mode', documentHost.interactionMode)
        shell.root.setAttribute('data-interaction-reason', documentHost.interactionReason)
        shell.root.setAttribute('data-title', state.title || '')
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
        scheduleLargeDocumentLayout()
        if (editor?.state.doc.content.size > LARGE_DOCUMENT_SIZE) documentHost._backgroundGate.touch()
        documentHost.scheduleDocumentState(transaction)
        snapshotAbort?.abort()
        const attributesOnly = transaction?.getMeta && (transaction.getMeta('larkDocBlockIds') || transaction.getMeta('larkDocIndentNormalized'))
        // Attribute normalization can invalidate an in-flight user snapshot.
        // Keep that user's publication owed, without publishing standalone metadata changes.
        if (attributesOnly && !contentChangePending) return
        if (!attributesOnly) contentChangePending = true
        clearTimeout(state.pendingChangeTimer)
        changeAbort?.abort()
        const generation = ++changeGeneration
        const delay = state.editorConfig.performance.changeDebounce
        const publish = () => {
          if (destroyed || !editorController) return
          const doc = editor.state.doc
          const deliver = snapshot => {
            if (!snapshot || destroyed || generation !== changeGeneration || editor.state.doc !== doc) return
            const payload = { ...snapshot, html: applyMediaHtmlMode(snapshot.html, resolveMediaOptions(state.editorConfig)) }
            contentChangePending = false
            state.html = snapshot.html
            workspaceController.queueSave()
            emit('update', payload)
            emit('change', payload)
          }
          // Explicit zero-debounce hosts retain synchronous notifications.
          // Large debounced changes use the existing cached cooperative codec.
          if (delay > 0 && (doc.content.size > LARGE_DOCUMENT_SIZE || doc.childCount > 128)) {
            const abort = changeAbort = new AbortController()
            editorController.getSnapshotAsync({ signal: abort.signal, media: resolveMediaOptions(state.editorConfig) }).then(snapshot => {
              if (!abort.signal.aborted) deliver(snapshot)
            }).catch(error => { if (!destroyed && !abort.signal.aborted) emit('error', error) })
          } else deliver({ html: editorController.getHTML(), json: editorController.getJSON(), text: editorController.getText() })
        }
        state.pendingChangeTimer = delay > 0 ? setTimeout(publish, delay) : null
        if (!delay) publish()
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
            getImageOptions: () => {
              const comments = documentHost.commentProvider()
              return { enabled: isCommandEnabled(state.editorConfig, 'image', 'images'), aiEnabled: state.editorConfig.features.ai !== false,
                commentEnabled: !!comments && !comments.isRemote && documentHost.commentAllowed('create'),
                onAction: documentHost.runImageAction, onComment: documentHost.imageCommentsHandler(), canLoad: src => createNetworkPolicy(state.editorConfig.network).allows(src) }
            },
            captureFileOwner() {
              const session = documentHost.session, documentId = session?.documentId
              const identity = session?._identityGeneration, actor = session?._privateIdentityGeneration, authorization = session?._authorizationGeneration
              return () => !destroyed && documentHost.session === session && !session?._destroyed && session?.documentId === documentId &&
                session?._identityGeneration === identity && session?._privateIdentityGeneration === actor && session?._authorizationGeneration === authorization
            },
            allowFileAction(action, url) {
              const session = documentHost.session
              if (action === 'edit' || action === 'delete') return documentHost.writable() && documentHost.featureEnabled('files') &&
                (action !== 'delete' || isBlockActionEnabled(state.editorConfig, 'delete'))
              if (action === 'copy' && !isBlockActionEnabled(state.editorConfig, 'copyLink')) return false
              if (url && !createNetworkPolicy(state.editorConfig.network).allows(url)) return false
              const capability = action === 'copy' ? 'canCopy' : 'canExport'
              return session?.can?.(capability) !== false && evaluateOutputPolicy(session?.getProvider?.('security')?.policy, action).allowed
            },
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
            changeAbort?.abort(); changeGeneration += 1
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
          onAfterContentReplace: () => { scheduleLargeDocumentLayout(); documentHost.restoreFolds(); state.savedSelection = null; documentHost.refreshDocumentState() },
        })
        editor.on('beforeTransaction', prepareProjectionSelection)
        runtime.mount(editor, editorController)
        scheduleLargeDocumentLayout()
        editorController.setImportReport(preparedInitial?.converted ? preparedInitial.report : null)
      } catch (error) {
        shell.root.removeEventListener('lark-doc:file-action', onFileAction)
        resetLargeDocumentLayout()
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
      ;['executeCommand', 'setMode', 'openVersionPanel', 'closeVersionPanel',
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
        cancelPendingChange: () => { changeAbort?.abort(); changeGeneration += 1; clearTimeout(state.pendingChangeTimer) },
        resolveImageFile, stageUi: documentHost._stageUi, topBarUi: documentHost._topBarUi, toolbarUi: documentHost._toolbarUi,
        helpFabUi: documentHost._helpFabUi, outlineUi: documentHost._panelsUi?.outline,
        editorUiRegistry, viewWindow, props, requestRender, nativeHost: runtime,
        cleanup: () => {
          shell.root.removeEventListener('lark-doc:file-action', onFileAction)
          importConfirmation?.destroy()
          editor?.off('beforeTransaction', prepareProjectionSelection)
          resolveImageFile.cancelAll('destroy')
          snapshotAbort?.abort()
          changeAbort?.abort(); changeGeneration += 1
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
      if (['session', 'documentId', 'uploader', 'uploadImage'].some(key => Object.prototype.hasOwnProperty.call(props, key) && props[key] !== handle.props[key])) {
        handle.resolveImageFile.cancelAll('document-change')
        handle.cancelPendingChange()
      }
      Object.assign(handle.props, props)
      if (Object.prototype.hasOwnProperty.call(props, 'templates')) handle.state.templateItems = createWorkspaceState(handle.props).templateItems
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
        handle.workspaceController.getSession()?.attachEditor?.(handle.editor, handle.workspaceController.host.getDocumentAccess?.())
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
