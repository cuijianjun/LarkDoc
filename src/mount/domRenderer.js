/**
 * mount/domRenderer — 迁移期原生 DOM 渲染器。
 *
 * 这不是完整的 Vue Workspace 等价实现：编辑器业务仍由
 * WorkspaceController / EditorController 持有，编辑器 UI 的大部分状态机仍在
 * LarkDocEditor.vue 的 mixin 中。因此这里明确只提供迁移期能力：在普通 DOM 宿主
 * 下创建等价的 `.lark-doc` / 正文纸张 / Tiptap 编辑器根节点，并复用两个 controller
 * 的文档、会话、持久化与 AI 业务入口。完整工具栏、浮层和模式状态尚未迁移到本文件。
 *
 * 只有宿主显式注入本实现时才会使用；默认 renderer 仍是 Vue 2。
 */
import { Editor } from '@tiptap/core'
import { createLarkDocExtensions } from '../components/lark-doc/extensions'
import { sanitizeHTML } from '../components/lark-doc/documentOperations'
import { normalizeVditorHtml } from '../legacy'
import { createEditorController } from '../editor/EditorController'
import { createLarkDocConfig, resolveMediaOptions } from '../components/lark-doc/larkDocConfig'
import { applyMediaHtmlMode } from '../core/media/htmlMode'
import { createWorkspaceState, createWorkspaceController } from '../workspace/WorkspaceController'

function prepareHTML(content, format) {
  const mode = format || 'auto'
  const legacy = normalizeVditorHtml(content, { force: mode === 'vditor', skip: mode === 'html' })
  return sanitizeHTML(legacy.html)
}

function makeReactiveState(source, onChange, cache = new WeakMap()) {
  if (!source || typeof source !== 'object' || source instanceof Map || source instanceof Set || source instanceof Date) return source
  if (cache.has(source)) return cache.get(source)
  const proxy = new Proxy(source, {
    get(target, key, receiver) {
      return makeReactiveState(Reflect.get(target, key, receiver), onChange, cache)
    },
    set(target, key, value, receiver) {
      const changed = Reflect.get(target, key, receiver) !== value
      const result = Reflect.set(target, key, value, receiver)
      if (changed) onChange()
      return result
    },
    deleteProperty(target, key) {
      const existed = Object.prototype.hasOwnProperty.call(target, key)
      const result = Reflect.deleteProperty(target, key)
      if (existed) onChange()
      return result
    },
  })
  cache.set(source, proxy)
  return proxy
}

function append(parent, ...children) {
  children.forEach((child) => parent.appendChild(child))
  return parent
}

function createShell() {
  const root = document.createElement('section')
  root.className = 'lark-doc lark-doc-dom-migration'
  root.setAttribute('data-renderer', 'dom-migration')
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape') event.stopPropagation()
  })

  const skip = document.createElement('a')
  skip.className = 'lark-doc-skip'
  skip.href = '#lark-doc-editor'
  skip.textContent = '跳到正文'
  const topBarHost = document.createElement('div')
  const actionsPark = document.createElement('div')
  actionsPark.className = 'lark-doc-actions-park'
  const actionsHost = document.createElement('div')
  const modeToast = document.createElement('div')
  modeToast.className = 'lark-doc-mode-toast'
  modeToast.setAttribute('role', 'status')
  modeToast.setAttribute('aria-live', 'polite')
  const toolbarHost = document.createElement('div')
  const searchPanelHost = document.createElement('div')
  const tableToolsHost = document.createElement('div')
  const mentionHost = document.createElement('div')
  const reminderHost = document.createElement('div')
  const calendarSearchHost = document.createElement('div')
  const isvPanelHost = document.createElement('div')
  const revisionHost = document.createElement('div')
  const body = document.createElement('div')
  body.className = 'lark-doc-body'
  const outlineHost = document.createElement('div')
  outlineHost.style.display = 'contents'
  const main = document.createElement('main')
  main.className = 'lark-doc-main'
  const stageHost = document.createElement('div')
  stageHost.style.display = 'contents'
  const paper = document.createElement('div')
  paper.className = 'lark-doc-paper'
  const blockHandleHost = document.createElement('div')
  const dropLine = document.createElement('div')
  dropLine.className = 'lark-doc-drop-line'
  dropLine.style.display = 'none'
  const editorEl = document.createElement('div')
  editorEl.id = 'lark-doc-editor'
  editorEl.className = 'lark-doc-editor-content'
  const tableBoundaryHost = document.createElement('div')
  const calloutToolsHost = document.createElement('div')
  const status = document.createElement('footer')
  status.className = 'lark-doc-status'
  const externalPanel = document.createElement('aside')
  externalPanel.className = 'lark-doc-external-panel'
  const bubbleHost = document.createElement('div')
  const commandMenuHost = document.createElement('div')
  const dialogHost = document.createElement('div')
  const helpFabHost = document.createElement('div')
  const colorPaletteHost = document.createElement('div')
  const imageInput = document.createElement('input')
  imageInput.type = 'file'
  imageInput.accept = 'image/png,image/jpeg,image/gif,image/webp'
  imageInput.className = 'lark-doc-file-input'
  const fileInput = document.createElement('input')
  fileInput.type = 'file'
  fileInput.multiple = true
  fileInput.className = 'lark-doc-file-input'
  const error = document.createElement('p')
  error.className = 'lark-doc-toast'
  error.setAttribute('role', 'alert')
  const headingNumberMenuHost = document.createElement('div')
  const overlayHost = document.createElement('div')
  const panelHost = document.createElement('div')

  actionsHost.className = 'lark-doc-actions-host'
  actionsPark.appendChild(actionsHost)
  append(paper, blockHandleHost, dropLine, editorEl, tableBoundaryHost, calloutToolsHost)
  append(main, stageHost, paper, status)
  append(body, outlineHost, main, externalPanel)
  append(root, skip, topBarHost, actionsPark, modeToast, toolbarHost, searchPanelHost, tableToolsHost,
    mentionHost, reminderHost, calendarSearchHost, isvPanelHost, revisionHost, body, bubbleHost,
    commandMenuHost, dialogHost, helpFabHost, colorPaletteHost, imageInput, fileInput, error,
    headingNumberMenuHost, overlayHost, panelHost)

  return { root, editorEl, status, error }
}

function resolveWindow(element) {
  return element && element.ownerDocument && element.ownerDocument.defaultView
    ? element.ownerDocument.defaultView
    : (typeof window !== 'undefined' ? window : {})
}

export function createDomRenderer() {
  return {
    name: 'dom-migration',

    mount({ element, props = {}, on = {} }) {
      if (!element || typeof element.appendChild !== 'function') throw new Error('dom renderer 需要普通 DOM 宿主')
      const shell = createShell()
      const viewWindow = resolveWindow(element)
      let render
      let destroyed = false
      let editor = null
      let editorController = null
      let instance = null
      let workspaceController
      let state = makeReactiveState(createWorkspaceState({
        initialContent: props.initialContent,
        initialTitle: props.initialTitle,
        templates: props.templates,
        config: props.config,
      }), () => { if (!destroyed && render) render() })
      state.editorConfig = createLarkDocConfig(props.config)

      const emit = (name, payload) => {
        const callback = on[name]
        if (typeof callback === 'function') callback(payload)
        if (!destroyed && render) render()
      }

      const getEffectiveReadonly = () => Boolean(props.readonly || state.forcedReadonly)
      const refreshChange = () => {
        if (!editorController || destroyed) return
        // 对外的 HTML 与 `LarkDoc#getHTML()` 同口径：跟随 config.media.htmlMode。
        const html = applyMediaHtmlMode(editorController.getHTML(), resolveMediaOptions(state.editorConfig))
        const payload = { html, json: editorController.getJSON(), text: editorController.getText() }
        state.html = payload.html
        workspaceController.queueSave()
        emit('update', payload)
        emit('change', payload)
      }

      const host = {
        getEditor: () => editor,
        getHTML: () => editorController ? editorController.getHTML() : '',
        getJSON: () => editorController ? editorController.getJSON() : null,
        getText: () => editorController ? editorController.getText() : '',
        setContent: (content, options) => editorController ? editorController.setContent(content, options) : false,
        focus: () => editorController && editorController.focus(),
        writable: () => Boolean(editor && editor.isEditable && !state.importing && !destroyed),
        emit,
        confirm: message => typeof viewWindow.confirm === 'function' ? viewWindow.confirm(message) : true,
        getWindow: () => viewWindow,
        getNavigator: () => viewWindow.navigator || (typeof navigator !== 'undefined' ? navigator : {}),
        getAIProvider: () => props.aiProvider,
        hydrateOutline: () => false,
        bindAITransaction: handler => editor && editor.on('transaction', handler),
        unbindAITransaction: handler => editor && editor.off('transaction', handler),
        addBeforeUnload: handler => viewWindow.addEventListener && viewWindow.addEventListener('beforeunload', handler),
        removeBeforeUnload: handler => viewWindow.removeEventListener && viewWindow.removeEventListener('beforeunload', handler),
        nextTick: callback => Promise.resolve().then(callback),
        documentApi: null,
      }

      workspaceController = createWorkspaceController({ state, props, host })
      workspaceController.initializeSession()

      const initialContent = props.initialContent == null
        ? state.html
        : (typeof props.initialContent === 'string' ? prepareHTML(props.initialContent, props.contentFormat) : undefined)
      const resolveImageFile = async (file) => {
        if (typeof props.uploadImage === 'function') return props.uploadImage(file)
        if (typeof FileReader === 'undefined') throw new Error('当前宿主不支持本地图片读取')
        return new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve({ src: reader.result })
          reader.onerror = () => reject(reader.error || new Error('图片读取失败'))
          reader.readAsDataURL(file)
        })
      }

      editor = new Editor({
        element: shell.editorEl,
        content: props.initialContent && typeof props.initialContent === 'object' ? undefined : initialContent,
        editable: !getEffectiveReadonly(),
        extensions: createLarkDocExtensions({
          config: state.editorConfig,
          maxLength: state.editorConfig.limits.maxLength,
          resolveImageFile,
          resolveFileUrl: props.resolveFileUrl,
          onEmbedTitle: props.onEmbedTitle,
          onEmbedSave: props.onEmbedSave,
          onEmbedCardAction: props.onEmbedCardAction,
          embedProviders: props.embedProviders,
          onBookmarkOpen: props.onBookmarkOpen,
          unfurlProvider: props.unfurlProvider,
          embedSandbox: props.embedSandbox,
          embedAllow: props.embedAllow,
          onError: message => { state.error = message },
        }),
        onUpdate: ({ transaction }) => {
          if (transaction && transaction.getMeta && (transaction.getMeta('larkDocBlockIds') || transaction.getMeta('larkDocIndentNormalized'))) return
          refreshChange()
        },
        onTransaction: () => { if (!destroyed && render) render() },
        onSelectionUpdate: () => { if (!destroyed && render) render() },
      })
      editorController = createEditorController({
        editor,
        session: workspaceController.getSession(),
        title: state.title,
        prepareHTML,
        getMaxLength: () => props.config?.limits?.maxLength || 0,
      })
      host.documentApi = instance = {
        getEditor: () => editor,
        getHTML: () => editorController.getHTML(),
        getJSON: () => editorController.getJSON(),
        getText: () => editorController.getText(),
        focus: () => editorController.focus(),
        getTitle: () => state.title,
        setTitle: value => {
          if (getEffectiveReadonly()) return
          state.title = value == null ? '' : String(value)
          editorController.setTitle(state.title)
          workspaceController.queueSave()
          emit('update', { title: state.title })
        },
        setContent: (content, options) => editorController.setContent(content, options),
        setReadonly: value => {
          state.forcedReadonly = value === true
          return editorController.setReadonly(getEffectiveReadonly())
        },
        isReadonly: () => getEffectiveReadonly(),
        insertContent: content => editor.chain().focus().insertContent(content).run(),
        insertText: text => editor.chain().focus().insertContent(String(text == null ? '' : text)).run(),
        undo: () => editor.chain().focus().undo().run(),
        redo: () => editor.chain().focus().redo().run(),
        save: () => workspaceController.saveNow(true),
        getSession: () => workspaceController.getSession(),
        getImportReport: () => state.importReport || null,
        // 对齐 LarkDoc 门面和 Vue Workspace 的公开 controller 契约；
        // 这些方法只转发业务层，不把 UI 框架对象泄漏到 renderer 边界。
        getWorkspace: () => workspaceController.getWorkspace(),
        callWorkspace: (method, ...args) => workspaceController.callWorkspace(method, ...args),
        record: () => workspaceController.record(),
        onReady: () => workspaceController.onReady(),
        queueSave: () => workspaceController.queueSave(),
        flushOnLeave: () => workspaceController.flushOnLeave(),
        saveNow: manual => workspaceController.saveNow(manual),
        storageFailure: error => workspaceController.storageFailure(error),
        toggleHistory: () => workspaceController.toggleHistory(),
        createSnapshot: () => workspaceController.createSnapshot(),
        restoreSnapshot: id => workspaceController.restoreSnapshot(id),
        importDocument: event => workspaceController.importDocument(event),
        exportDocument: format => workspaceController.exportDocument(format),
        mapAI: transaction => workspaceController.mapAI(transaction),
        currentAIContext: () => workspaceController.currentAIContext(),
        resetAIPreview: () => workspaceController.resetAIPreview(),
        startAI: (action, options) => workspaceController.startAI(action, options),
        sendAIChat: () => workspaceController.sendAIChat(),
        regenerateAI: () => workspaceController.regenerateAI(),
        stopAI: () => workspaceController.stopAI(),
        closeAI: () => workspaceController.closeAI(),
        copyAIPreview: () => workspaceController.copyAIPreview(),
        acceptAI: () => workspaceController.acceptAI(),
        insertAIResult: () => workspaceController.insertAIResult(),
        acceptReviewIssue: issue => workspaceController.acceptReviewIssue(issue),
        ignoreReviewIssue: issue => workspaceController.ignoreReviewIssue(issue),
        applyAIProposal: proposal => workspaceController.applyAIProposal(proposal),
      }

      render = () => {
        if (destroyed) return
        const readonly = getEffectiveReadonly()
        shell.root.classList.toggle('lark-doc-reading', readonly)
        shell.root.classList.toggle('lark-doc-dom-migration-ready', Boolean(editor))
        shell.editorEl.setAttribute('contenteditable', readonly ? 'false' : 'true')
        const title = state.title == null ? '' : String(state.title)
        shell.status.textContent = `${editorController ? editorController.getText().length : 0} 字 · ${readonly ? '仅阅读' : '输入 / 快速插入'}`
        shell.root.setAttribute('data-title', title)
      }

      element.appendChild(shell.root)
      render()
      Promise.resolve(workspaceController.onReady()).catch(error => {
        state.error = error.message || '工作台初始化失败'
        emit('error', error)
      })
      return { instance, root: shell.root, editor, workspaceController, editorController }
    },

    update(handle, props = {}) {
      if (!handle || !handle.instance) return
      if (Object.prototype.hasOwnProperty.call(props, 'readonly')) handle.instance.setReadonly(props.readonly === true)
      if (Object.prototype.hasOwnProperty.call(props, 'initialTitle')) handle.instance.setTitle(props.initialTitle)
      if (props.session && handle.workspaceController) handle.workspaceController.props.session = props.session
    },

    destroy(handle) {
      if (!handle || !handle.instance || handle.destroyed) return
      handle.destroyed = true
      handle.workspaceController?.dispose()
      handle.editorController?.destroy()
      const root = handle.root
      if (root && root.parentNode) root.parentNode.removeChild(root)
      handle.instance = null
    },

    getInstance(handle) {
      return handle && !handle.destroyed ? handle.instance : null
    },

    getRoot(handle) {
      return handle && !handle.destroyed ? handle.root : null
    },
  }
}

export default createDomRenderer
