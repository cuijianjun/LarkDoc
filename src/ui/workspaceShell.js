/**
 * Workspace 外壳 —— 只创建 LarkDocEditor / LarkDocWorkspace 共用的 DOM 挂载点。
 *
 * 业务状态由 WorkspaceController 持有，具体工具栏、面板和浮层由各自的原生
 * renderer 挂载。这里不依赖 Vue，也不绑定任何业务事件，方便 DOM renderer
 * 与后续其他宿主复用同一份结构契约。
 */
import { IMAGE_MIME_ALLOWLIST } from '../core/media/image-insert'

function append(parent, ...children) {
  children.forEach(child => parent.appendChild(child))
  return parent
}

export function createWorkspaceShell(ownerDocument = document) {
  const root = ownerDocument.createElement('section')
  root.className = 'lark-doc lark-doc-dom-migration'
  root.setAttribute('data-renderer', 'dom-migration')
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape') event.stopPropagation()
  })

  const skip = ownerDocument.createElement('a')
  skip.className = 'lark-doc-skip'
  skip.href = '#lark-doc-editor'
  skip.textContent = '跳到正文'
  const topBarHost = ownerDocument.createElement('div')
  const actionsPark = ownerDocument.createElement('div')
  actionsPark.className = 'lark-doc-actions-park'
  const actionsHost = ownerDocument.createElement('div')
  actionsHost.className = 'lark-doc-actions-host'
  const modeToast = ownerDocument.createElement('div')
  modeToast.className = 'lark-doc-mode-toast'
  modeToast.setAttribute('role', 'status')
  modeToast.setAttribute('aria-live', 'polite')
  const modeToastIcon = ownerDocument.createElement('span')
  modeToastIcon.className = 'lark-doc-mode-toast-icon'
  modeToastIcon.setAttribute('aria-hidden', 'true')
  modeToastIcon.textContent = '✓'
  const modeToastText = ownerDocument.createElement('span')
  modeToastText.className = 'lark-doc-mode-toast-text'
  append(modeToast, modeToastIcon, modeToastText)
  const toolbarHost = ownerDocument.createElement('div')
  const searchPanelHost = ownerDocument.createElement('div')
  const tableToolsHost = ownerDocument.createElement('div')
  const mentionHost = ownerDocument.createElement('div')
  const reminderHost = ownerDocument.createElement('div')
  const calendarSearchHost = ownerDocument.createElement('div')
  const isvPanelHost = ownerDocument.createElement('div')
  const revisionHost = ownerDocument.createElement('div')
  const body = ownerDocument.createElement('div')
  body.className = 'lark-doc-body'
  const outlineHost = ownerDocument.createElement('div')
  outlineHost.style.display = 'contents'
  const main = ownerDocument.createElement('main')
  main.className = 'lark-doc-main'
  const stageHost = ownerDocument.createElement('div')
  stageHost.style.display = 'contents'
  const paper = ownerDocument.createElement('div')
  paper.className = 'lark-doc-paper'
  const blockHandleHost = ownerDocument.createElement('div')
  const dropLine = ownerDocument.createElement('div')
  dropLine.className = 'lark-doc-drop-line'
  dropLine.style.display = 'none'
  const editorEl = ownerDocument.createElement('div')
  editorEl.id = 'lark-doc-editor'
  editorEl.className = 'lark-doc-editor-content'
  const tableBoundaryHost = ownerDocument.createElement('div')
  const calloutToolsHost = ownerDocument.createElement('div')
  const status = ownerDocument.createElement('footer')
  status.className = 'lark-doc-status'
  const statusSummary = ownerDocument.createElement('span')
  const statusHint = ownerDocument.createElement('span')
  status.appendChild(statusSummary)
  status.appendChild(statusHint)
  const externalPanel = ownerDocument.createElement('aside')
  externalPanel.className = 'lark-doc-external-panel'
  const panelHost = ownerDocument.createElement('div')
  const bubbleHost = ownerDocument.createElement('div')
  const commandMenuHost = ownerDocument.createElement('div')
  const dialogHost = ownerDocument.createElement('div')
  const helpFabHost = ownerDocument.createElement('div')
  const colorPaletteHost = ownerDocument.createElement('div')
  const imageInput = ownerDocument.createElement('input')
  imageInput.type = 'file'
  imageInput.accept = IMAGE_MIME_ALLOWLIST.join(',')
  imageInput.multiple = true
  imageInput.className = 'lark-doc-file-input'
  imageInput.setAttribute('aria-label', '选择本地图片')
  const fileInput = ownerDocument.createElement('input')
  fileInput.type = 'file'
  fileInput.multiple = true
  fileInput.className = 'lark-doc-file-input'
  fileInput.setAttribute('aria-label', '选择视频或文件')
  const error = ownerDocument.createElement('p')
  error.className = 'lark-doc-toast'
  error.setAttribute('role', 'alert')
  const headingNumberMenuHost = ownerDocument.createElement('div')
  const overlayHost = ownerDocument.createElement('div')
  // 表格 md 交互层的独立宿主：`display: contents` 不吃布局，内部节点用 fixed 定位。
  // 单独给一个宿主是为了不和 tableToolsHost / tableBoundaryHost 抢 syncChildren 的子树。
  const tableOverlayHost = ownerDocument.createElement('div')
  tableOverlayHost.style.display = 'contents'

  actionsPark.appendChild(actionsHost)
  externalPanel.appendChild(panelHost)
  append(paper, blockHandleHost, dropLine, editorEl, tableBoundaryHost, calloutToolsHost)
  append(main, stageHost, paper, status)
  append(body, outlineHost, main, externalPanel)
  append(root, skip, topBarHost, actionsPark, modeToast, toolbarHost, searchPanelHost, tableToolsHost,
    mentionHost, reminderHost, calendarSearchHost, isvPanelHost, revisionHost, body, bubbleHost,
    commandMenuHost, dialogHost, helpFabHost, colorPaletteHost, imageInput, fileInput, error,
    headingNumberMenuHost, overlayHost)
  append(root, tableOverlayHost)

  return {
    root,
    topBarHost,
    actionsPark,
    actionsHost,
    modeToast,
    modeToastText,
    toolbarHost,
    searchPanelHost,
    tableToolsHost,
    mentionHost,
    reminderHost,
    calendarSearchHost,
    isvPanelHost,
    revisionHost,
    outlineHost,
    main,
    stageHost,
    paper,
    blockHandleHost,
    dropLine,
    editorEl,
    tableBoundaryHost,
    calloutToolsHost,
    status,
    statusSummary,
    statusHint,
    externalPanel,
    panelHost,
    bubbleHost,
    commandMenuHost,
    dialogHost,
    helpFabHost,
    colorPaletteHost,
    imageInput,
    fileInput,
    error,
    headingNumberMenuHost,
    overlayHost,
    tableOverlayHost,
  }
}
