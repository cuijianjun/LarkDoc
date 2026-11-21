/**
 * 工作台外壳 —— 原生 DOM 版（阶段 5 批次 5G）。
 *
 * 持久化、模板、导入导出和 AI 业务状态由 WorkspaceController 持有；本模块只负责
 * 把一份 state 渲染成 DOM，并通过 handlers 把用户动作交回工作台。
 */

import { createSelect } from './select'
import { iconNode } from './icon'
import { mountNode, setAttr, setText, syncChildren } from './dom'
import { createWorkspacePanels } from './workspacePanels'

function call(handlers, name, ...args) {
  const handler = handlers[name]
  return typeof handler === 'function' ? handler(...args) : undefined
}

function button(label, onClick, className = '') {
  const node = document.createElement('button')
  node.type = 'button'
  if (className) node.className = className
  if (label !== undefined) node.textContent = label
  if (onClick) node.addEventListener('click', onClick)
  return node
}

function closeButton(label, onClick) {
  const node = button('', onClick)
  node.setAttribute('aria-label', label)
  node.appendChild(iconNode('close', 14))
  return node
}

function setDisabled(node, disabled) {
  node.disabled = !!disabled
}

export function createWorkspace(options = {}) {
  const headerHost = options.headerHost || null
  const panelHost = options.panelHost || null
  const noticeHost = options.noticeHost || panelHost
  const handlers = options.handlers || {}
  const state = {}
  const canImport = () => state.importEnabled && !state.readonly && !state.importing && state.importAccept
  const panels = createWorkspacePanels({
    host: panelHost, handlers, pickImport,
    closeImport() { state.importOpener = null; panels.update(state) },
  })

  function pickImport(accept = state.importAccept) {
    if (!canImport()) return false
    importInput.accept = accept
    importInput.click()
    return true
  }

  const header = document.createElement('div')
  header.className = 'lark-doc-workspace-actions'
  const localBadge = document.createElement('span')
  localBadge.className = 'lark-doc-local-badge'
  localBadge.textContent = '本地 Demo'
  const maxLengthSelect = createSelect({
    ariaLabel: '字数上限',
    onChange: value => call(handlers, 'setMaxLength', value),
  })
  const saveStatus = document.createElement('span')
  saveStatus.className = 'lark-doc-save-status'
  saveStatus.setAttribute('role', 'status')
  const saveButton = button('保存', () => call(handlers, 'save'))
  const templateSelect = createSelect({
    ariaLabel: '选择文档模板',
    title: '选择本地模板',
    placeholder: '模板',
    onChange: value => call(handlers, 'applyTemplate', value),
  })
  // 导入 / 导出是两个独立入口：显隐各由 config.importExport.importEnabled /
  // exportEnabled 决定，文案与 accept 也跟着配置走（默认值仍是不传配置时的老样子）。
  const importButton = button('导入', () => pickImport())
  const importStatus = document.createElement('div')
  const importProgress = document.createElement('span')
  importProgress.className = 'lark-doc-import-progress'
  importProgress.setAttribute('role', 'status')
  importProgress.setAttribute('aria-live', 'polite')
  const retryImport = button('重试失败项', () => call(handlers, 'retryImport'))
  const rollbackImport = button('回滚导入', () => call(handlers, 'rollbackImport'))
  const importInput = document.createElement('input')
  importInput.className = 'lark-doc-file-input'
  importInput.type = 'file'
  importInput.setAttribute('aria-label', '导入文档')
  importInput.addEventListener('change', event => call(handlers, 'importDocument', event))
  const exportSelect = createSelect({
    ariaLabel: '导出文档格式',
    title: '导出文档',
    placeholder: '导出',
    onChange: value => call(handlers, 'exportDocument', value),
  })
  const historyButton = button('本地快照', () => call(handlers, 'toggleHistory'))
  const versionMenu = createSelect({
    ariaLabel: '文档更多操作', placeholder: '⋯', menuMinWidth: 200,
    onChange: value => {
      versionMenu.update({ value: '' })
      call(handlers, { history: 'openVersionHistory', 'comments-history': 'openCommentHistory' }[value])
    },
  })
  function syncHeader() {
    const statusHost = state.compactHeader ? importStatus : header
    const feedback = [
      { node: saveStatus, on: !state.compactHeader || !!state.storageError },
      { node: importProgress, on: !!state.importEnabled && !!state.importProgressState },
      { node: retryImport, on: !!state.importEnabled && !!state.importProgressState?.canRetry },
      { node: rollbackImport, on: !!state.importEnabled && !!state.importProgressState?.canRollback },
    ]
    if (state.compactHeader) syncChildren(importStatus, feedback)
    mountNode(noticeHost, importStatus, state.compactHeader && feedback.some(item => item.on))
    syncChildren(header, [
      { node: localBadge, on: true },
      { node: maxLengthSelect.el, on: true },
      ...(statusHost === header ? feedback.slice(0, 1) : []),
      { node: saveButton, on: !!state.persistenceEnabled },
      { node: templateSelect.el, on: !!state.templatesEnabled },
      { node: importButton, on: !!state.importEnabled },
      ...(statusHost === header ? feedback.slice(1) : []),
      { node: importInput, on: !!state.importEnabled },
      { node: exportSelect.el, on: !!state.exportEnabled },
      { node: historyButton, on: !!state.historyEnabled },
      { node: versionMenu.el, on: !!(state.historyEnabled || state.commentHistoryAvailable) },
    ])
  }

  const notice = document.createElement('div')
  notice.className = 'lark-doc-notice'
  notice.setAttribute('role', 'status')
  const noticeText = document.createElement('span')
  const noticeClose = closeButton('关闭提示', () => call(handlers, 'clearNotice'))
  notice.appendChild(noticeText)
  notice.appendChild(noticeClose)

  function update(next = {}) {
    Object.assign(state, next)
    // 未细分导入/导出开关时沿用工作台总开关，不能让两个入口默认消失。
    state.importEnabled = next.importEnabled ?? state.importExportEnabled
    state.exportEnabled = next.exportEnabled ?? state.importExportEnabled
    syncHeader()
    if (headerHost) mountNode(headerHost, header, true)
    mountNode(noticeHost, notice, !!state.notice)
    setText(noticeText, state.notice)
    if (!canImport() || !state.importOpener?.isConnected) state.importOpener = null
    panels.update(state)

    maxLengthSelect.update({ options: state.maxLengthOptions, value: state.maxLength })
    versionMenu.update({ value: '', options: [
      ...(state.historyEnabled ? [{ value: 'history', label: '历史记录' }] : []),
      ...(state.commentHistoryAvailable ? [{ value: 'comments-history', label: '历史评论' }] : []),
    ] })
    saveStatus.classList.toggle('is-error', !!state.storageError)
    setText(saveStatus, state.saveStatus)
    setDisabled(saveButton, state.readonly || state.importing)
    setAttr(saveButton, 'aria-description', state.persistenceLabel ? `保存到${state.persistenceLabel}` : null)
    templateSelect.update({ options: state.templateOptions, value: '', disabled: state.readonly || state.importing })
    setDisabled(importButton, state.readonly || state.importing)
    const progress = state.importProgressState
    setText(importButton, state.importing ? (progress ? `导入中 ${progress.progress || 0}%` : '导入中…') : (state.importLabel || '导入'))
    setText(importProgress, progress ? (progress.failed ? `导入 ${progress.progress}% · 失败 ${progress.failed} 项` : `导入 ${progress.progress}% · ${progress.completed}/${progress.total}`) : '')
    setDisabled(retryImport, state.importing || typeof handlers.retryImport !== 'function')
    setDisabled(rollbackImport, state.importing || typeof handlers.rollbackImport !== 'function')
    importInput.accept = state.importAccept || ''
    exportSelect.update({ options: state.exportOptions, value: '' })
    setAttr(historyButton, 'aria-expanded', state.historyOpen ? 'true' : 'false')
    setAttr(historyButton, 'title', '本地快照')

  }

  return {
    el: header,
    update,
    requestImport(opener) {
      if (!canImport()) return false
      if (!opener || !panelHost?.isConnected || !document.defaultView?.HTMLDialogElement?.prototype.showModal) return pickImport()
      state.importOpener = opener
      panels.update(state)
      return true
    },
    focusTemplateSearch() { panels.focusTemplateSearch() },
    focusImageAI() { panels.focusImageAI() },
    destroy() {
      versionMenu.destroy()
      maxLengthSelect.destroy()
      templateSelect.destroy()
      exportSelect.destroy()
      panels.destroy()
      header.remove()
      importStatus.remove()
      notice.remove()
    },
  }
}
