/**
 * 工作台外壳 —— 原生 DOM 版（阶段 5 批次 5G）。
 *
 * LarkDocWorkspace.vue 继续持有持久化、模板、导入导出和 AI 业务状态；本模块只负责
 * 把一份 state 渲染成 DOM，并通过 handlers 把用户动作交回工作台。这样不会把工作台
 * 业务重写成第二份状态机，也不会让阶段 7 的 renderer 收尾和主壳迁移混在一起。
 */

import { createSelect } from './select'
import { iconNode } from './icon'
import { mountNode, setAttr, setText, syncChildren } from './dom'
import { createLazyView } from './lazy'

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
  const owned = []

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
  const importButton = button('导入', () => importInput.click())
  const importInput = document.createElement('input')
  importInput.className = 'lark-doc-file-input'
  importInput.type = 'file'
  importInput.accept = '.html,.htm,.json,.md,.markdown,.docx'
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
      call(handlers, { 'save-version': 'openSaveVersion', history: 'openVersionHistory', 'comments-history': 'openCommentHistory' }[value])
    },
  })
  function syncHeader() {
    syncChildren(header, [
      { node: localBadge, on: true },
      { node: maxLengthSelect.el, on: true },
      { node: saveStatus, on: true },
      { node: saveButton, on: !!state.persistenceEnabled },
      { node: templateSelect.el, on: !!state.templatesEnabled },
      { node: importButton, on: !!state.importEnabled },
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

  owned.push(header, notice)
  const panels = createLazyView(() => import('./workspacePanels'), 'createWorkspacePanels', { host: panelHost, handlers }, {
    isOpen: state => !!((state.templateOpen && state.templatesEnabled) || (state.historyOpen && state.historyEnabled) || (state.aiOpen && state.aiEnabled)),
    onError: () => call(handlers, 'onLoadError'),
  })

  function update(next = {}) {
    Object.assign(state, next)
    syncHeader()
    if (headerHost) mountNode(headerHost, header, true)
    mountNode(noticeHost, notice, !!state.notice)
    panels.update(state)

    maxLengthSelect.update({ options: state.maxLengthOptions, value: state.maxLength })
    versionMenu.update({ value: '', options: [
      ...(state.historyEnabled ? [
        { value: 'save-version', label: '另存为版本', disabled: !state.versionCanCreate },
        { value: 'history', label: '历史记录' },
      ] : []),
      ...(state.commentHistoryAvailable ? [{ value: 'comments-history', label: '历史评论' }] : []),
    ] })
    saveStatus.classList.toggle('is-error', !!state.storageError)
    setText(saveStatus, state.saveStatus)
    setDisabled(saveButton, state.readonly || state.importing)
    // 这三个按钮在「文档操作」弹窗（role=menu）里，原生 title 会弹黑底提示；
    // 保存目标只作读屏补充，走 aria-description，不改按钮的可访问名（仍是「保存」）。
    setAttr(saveButton, 'aria-description', state.persistenceLabel ? `保存到${state.persistenceLabel}` : null)
    templateSelect.update({ options: state.templateOptions, value: '', disabled: state.readonly || state.importing })
    setDisabled(importButton, state.readonly || state.importing)
    setText(importButton, state.importing ? '导入中…' : (state.importLabel || '导入'))
    if (state.importAccept) importInput.accept = state.importAccept
    exportSelect.update({ options: state.exportOptions, value: '' })
    setAttr(historyButton, 'aria-expanded', state.historyOpen ? 'true' : 'false')

    setText(noticeText, state.notice)

  }

  return {
    el: header,
    update,
    focusTemplateSearch() { panels.focusTemplateSearch() },
    focusImageAI() { panels.focusImageAI() },
    destroy() {
      versionMenu.destroy()
      maxLengthSelect.destroy()
      templateSelect.destroy()
      exportSelect.destroy()
      panels.destroy()
      owned.forEach(node => { if (node.parentNode) node.parentNode.removeChild(node) })
    },
  }
}
