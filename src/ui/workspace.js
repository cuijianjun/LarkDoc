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

function setInputValue(node, value) {
  const next = value == null ? '' : String(value)
  if (node.value !== next) node.value = next
}

export function createWorkspace(options = {}) {
  const headerHost = options.headerHost || null
  const panelHost = options.panelHost || null
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
    ])
  }

  const templatePanel = document.createElement('section')
  templatePanel.className = 'lark-doc-side-panel lark-doc-template-panel'
  templatePanel.setAttribute('role', 'dialog')
  templatePanel.setAttribute('aria-label', '模板')
  templatePanel.addEventListener('keydown', event => {
    if (event.key === 'Escape') call(handlers, 'closeTemplate')
  })
  const templateHeading = document.createElement('div')
  templateHeading.className = 'lark-doc-panel-heading'
  const templateTitle = document.createElement('h2')
  templateTitle.textContent = '模板'
  templateHeading.appendChild(templateTitle)
  templateHeading.appendChild(closeButton('关闭模板', () => call(handlers, 'closeTemplate')))
  const templateSearch = document.createElement('input')
  templateSearch.type = 'search'
  templateSearch.setAttribute('aria-label', '搜索模板')
  templateSearch.placeholder = '搜索模板'
  templateSearch.addEventListener('input', event => call(handlers, 'setTemplateQuery', event.target.value))
  const templateEmpty = document.createElement('p')
  templateEmpty.textContent = '没有匹配的模板'
  const templateList = document.createElement('div')
  templateList.className = 'lark-doc-template-list'
  templateList.setAttribute('role', 'listbox')
  templateList.setAttribute('aria-label', '模板列表')
  const templateItems = new Map()
  syncChildren(templatePanel, [
    { node: templateHeading, on: true },
    { node: templateSearch, on: true },
    { node: templateEmpty, on: false },
    { node: templateList, on: true },
  ])

  const historyPanel = document.createElement('section')
  historyPanel.className = 'lark-doc-side-panel'
  historyPanel.setAttribute('aria-label', '本地快照')
  historyPanel.addEventListener('keydown', event => {
    if (event.key === 'Escape') call(handlers, 'closeHistory')
  })
  const historyHeading = document.createElement('div')
  historyHeading.className = 'lark-doc-panel-heading'
  const historyTitle = document.createElement('h2')
  historyTitle.textContent = '本地快照'
  historyHeading.appendChild(historyTitle)
  historyHeading.appendChild(closeButton('关闭本地快照', () => call(handlers, 'closeHistory')))
  const historyDescription = document.createElement('p')
  const snapshotButton = button('保存当前快照', () => call(handlers, 'createSnapshot'))
  const historyEmpty = document.createElement('p')
  historyEmpty.textContent = '暂无本地快照'
  const snapshotList = document.createElement('ul')
  snapshotList.className = 'lark-doc-snapshot-list'
  const snapshotItems = new Map()
  syncChildren(historyPanel, [
    { node: historyHeading, on: true },
    { node: historyDescription, on: true },
    { node: snapshotButton, on: true },
    { node: historyEmpty, on: true },
    { node: snapshotList, on: true },
  ])

  const aiPanel = document.createElement('section')
  aiPanel.className = 'lark-doc-side-panel lark-doc-ai-panel'
  aiPanel.setAttribute('aria-label', 'AI 模拟预览')
  aiPanel.addEventListener('keydown', event => {
    if (event.key === 'Escape') call(handlers, 'closeAI')
  })
  const aiHeading = document.createElement('div')
  aiHeading.className = 'lark-doc-panel-heading'
  const aiTitle = document.createElement('h2')
  aiTitle.appendChild(document.createTextNode('AI 助手 '))
  const aiMock = document.createElement('small')
  aiMock.textContent = '本地 Mock'
  aiTitle.appendChild(aiMock)
  aiHeading.appendChild(aiTitle)
  aiHeading.appendChild(closeButton('关闭 AI 预览', () => call(handlers, 'closeAI')))
  const aiDescription = document.createElement('p')
  aiDescription.textContent = '单人本地工作区，不调用模型；只有明确接受、插入或替换才修改正文。'
  const aiContext = document.createElement('div')
  aiContext.className = 'lark-doc-ai-context'
  const aiContextLabel = document.createElement('label')
  aiContextLabel.textContent = '上下文范围'
  const aiContextSelect = createSelect({
    ariaLabel: '上下文范围',
    onChange: value => call(handlers, 'setAIContext', value),
  })
  const aiContextSummary = document.createElement('small')
  aiContextSummary.className = 'lark-doc-ai-context-summary'
  aiContext.appendChild(aiContextLabel)
  aiContext.appendChild(aiContextSelect.el)
  aiContext.appendChild(aiContextSummary)
  const aiActionLabel = document.createElement('label')
  aiActionLabel.textContent = '操作'
  const aiActionSelect = createSelect({
    ariaLabel: 'AI 操作',
    onChange: value => call(handlers, 'setAIAction', value),
  })
  const aiLanguageLabel = document.createElement('label')
  aiLanguageLabel.textContent = '目标语言'
  const aiLanguageSelect = createSelect({
    ariaLabel: '目标语言',
    onChange: value => call(handlers, 'setAILanguage', value),
  })
  const aiPromptLabel = document.createElement('label')
  aiPromptLabel.setAttribute('for', 'lark-doc-ai-prompt')
  aiPromptLabel.textContent = '给 AI 的要求（可选）'
  const aiPrompt = document.createElement('textarea')
  aiPrompt.id = 'lark-doc-ai-prompt'
  aiPrompt.rows = 2
  aiPrompt.placeholder = '例如：请用更简洁的语气重写'
  aiPrompt.addEventListener('input', event => call(handlers, 'setAIPrompt', event.target.value))
  const aiMessages = document.createElement('ul')
  aiMessages.className = 'lark-doc-ai-messages'
  aiMessages.setAttribute('aria-label', 'AI 对话记录')
  const aiMessageItems = new Map()
  const aiButtons = document.createElement('div')
  aiButtons.className = 'lark-doc-panel-buttons'
  const generateButton = button('生成预览', () => call(handlers, 'startAI'))
  const stopButton = button('停止', () => call(handlers, 'stopAI'))
  const sendButton = button('发送对话', () => call(handlers, 'sendAIChat'))
  aiButtons.appendChild(generateButton)
  aiButtons.appendChild(stopButton)
  aiButtons.appendChild(sendButton)
  const aiStatus = document.createElement('p')
  aiStatus.className = 'lark-doc-ai-status'
  aiStatus.setAttribute('role', 'status')
  const aiResultHost = document.createElement('div')
  const aiResult = document.createElement('pre')
  aiResult.className = 'lark-doc-ai-result'
  aiResult.setAttribute('aria-live', 'polite')
  const aiRichResult = document.createElement('div')
  aiRichResult.className = 'lark-doc-ai-result lark-doc-ai-result--rich'
  aiRichResult.setAttribute('aria-live', 'polite')
  aiResultHost.appendChild(aiResult)
  const aiReviewList = document.createElement('ul')
  aiReviewList.className = 'lark-doc-ai-review-list'
  aiReviewList.setAttribute('aria-label', 'AI 审阅建议')
  const aiReviewItems = new Map()
  const aiProposal = document.createElement('div')
  aiProposal.className = 'lark-doc-ai-proposal'
  aiProposal.setAttribute('role', 'region')
  aiProposal.setAttribute('aria-label', 'AI 修改提案')
  const aiProposalTitle = document.createElement('strong')
  const aiProposalSummary = document.createElement('p')
  const aiProposalContent = document.createElement('pre')
  const aiProposalButtons = document.createElement('div')
  aiProposalButtons.className = 'lark-doc-panel-buttons'
  const applyProposalButton = button('确认提案', () => call(handlers, 'applyAIProposal'), 'lark-doc-primary')
  const cancelProposalButton = button('取消提案', () => call(handlers, 'cancelAIProposal'))
  aiProposalButtons.appendChild(applyProposalButton)
  aiProposalButtons.appendChild(cancelProposalButton)
  aiProposal.appendChild(aiProposalTitle)
  aiProposal.appendChild(aiProposalSummary)
  aiProposal.appendChild(aiProposalContent)
  aiProposal.appendChild(aiProposalButtons)
  const aiError = document.createElement('p')
  aiError.className = 'lark-doc-error'
  aiError.setAttribute('role', 'alert')
  const aiResultButtons = document.createElement('div')
  aiResultButtons.className = 'lark-doc-panel-buttons'
  const copyButton = button('复制', () => call(handlers, 'copyAIPreview'))
  const insertButton = button('插入到光标', () => call(handlers, 'acceptAI', 'insert'))
  const replaceButton = button('替换范围', () => call(handlers, 'acceptAI', 'replace'))
  const regenerateButton = button('重新生成', () => call(handlers, 'regenerateAI'))
  const acceptButton = button('接受结果', () => call(handlers, 'acceptAI'), 'lark-doc-primary')
  const rejectButton = button('拒绝', () => call(handlers, 'closeAI'))
  aiResultButtons.appendChild(copyButton)
  aiResultButtons.appendChild(insertButton)
  aiResultButtons.appendChild(replaceButton)
  aiResultButtons.appendChild(regenerateButton)
  aiResultButtons.appendChild(acceptButton)
  aiResultButtons.appendChild(rejectButton)
  aiPanel.appendChild(aiHeading)
  aiPanel.appendChild(aiDescription)
  aiPanel.appendChild(aiContext)
  aiPanel.appendChild(aiActionLabel)
  aiPanel.appendChild(aiActionSelect.el)
  aiPanel.appendChild(aiLanguageLabel)
  aiPanel.appendChild(aiLanguageSelect.el)
  aiPanel.appendChild(aiPromptLabel)
  aiPanel.appendChild(aiPrompt)
  aiPanel.appendChild(aiMessages)
  aiPanel.appendChild(aiButtons)
  aiPanel.appendChild(aiStatus)
  aiPanel.appendChild(aiResultHost)
  aiPanel.appendChild(aiReviewList)
  aiPanel.appendChild(aiProposal)
  aiPanel.appendChild(aiError)
  aiPanel.appendChild(aiResultButtons)

  const notice = document.createElement('div')
  notice.className = 'lark-doc-notice'
  notice.setAttribute('role', 'status')
  const noticeText = document.createElement('span')
  const noticeClose = closeButton('关闭提示', () => call(handlers, 'clearNotice'))
  notice.appendChild(noticeText)
  notice.appendChild(noticeClose)

  owned.push(header, templatePanel, historyPanel, aiPanel, notice)

  function updateTemplateItems(items) {
    const list = Array.isArray(items) ? items : []
    const alive = new Set()
    const children = []
    list.forEach(item => {
      alive.add(item.id)
      let row = templateItems.get(item.id)
      if (!row) {
        const node = button()
        node.setAttribute('role', 'option')
        node.addEventListener('click', () => call(handlers, 'chooseTemplate', item.id))
        const strong = document.createElement('strong')
        const small = document.createElement('small')
        node.appendChild(strong)
        node.appendChild(small)
        row = { node, strong, small }
        templateItems.set(item.id, row)
      }
      row.node.setAttribute('aria-label', item.label)
      setText(row.strong, item.label)
      setText(row.small, item.title)
      children.push({ node: row.node, on: true })
    })
    Array.from(templateItems.keys()).forEach(id => { if (!alive.has(id)) templateItems.delete(id) })
    syncChildren(templateList, children)
  }

  function updateSnapshots(items, readonly) {
    const list = Array.isArray(items) ? items : []
    const alive = new Set()
    const children = []
    list.forEach(item => {
      alive.add(item.id)
      let row = snapshotItems.get(item.id)
      if (!row) {
        const node = document.createElement('li')
        const title = document.createElement('span')
        const updated = document.createElement('small')
        const restore = button('恢复', () => call(handlers, 'restoreSnapshot', item.id))
        node.appendChild(title)
        node.appendChild(updated)
        node.appendChild(restore)
        row = { node, title, updated, restore }
        snapshotItems.set(item.id, row)
      }
      setText(row.title, item.title || '未命名文档')
      setText(row.updated, new Date(item.updatedAt).toLocaleString())
      setDisabled(row.restore, readonly)
      children.push({ node: row.node, on: true })
    })
    Array.from(snapshotItems.keys()).forEach(id => { if (!alive.has(id)) snapshotItems.delete(id) })
    syncChildren(snapshotList, children)
  }

  function updateMessages(messages) {
    const list = Array.isArray(messages) ? messages : []
    const alive = new Set()
    const children = []
    list.forEach((message, index) => {
      const id = `${message.id}-${index}`
      alive.add(id)
      let row = aiMessageItems.get(id)
      if (!row) {
        const node = document.createElement('li')
        const role = document.createElement('strong')
        const text = document.createElement('span')
        node.appendChild(role)
        node.appendChild(text)
        row = { node, role, text }
        aiMessageItems.set(id, row)
      }
      row.node.className = `is-${message.role}`
      setText(row.role, message.role === 'user' ? '你' : 'AI')
      setText(row.text, message.text)
      children.push({ node: row.node, on: true })
    })
    Array.from(aiMessageItems.keys()).forEach(id => { if (!alive.has(id)) aiMessageItems.delete(id) })
    syncChildren(aiMessages, children)
  }

  function updateReviewIssues(items, readonly, running) {
    const list = Array.isArray(items) ? items : []
    const alive = new Set()
    const children = []
    list.forEach(issue => {
      alive.add(issue.id)
      let row = aiReviewItems.get(issue.id)
      if (!row) {
        const node = document.createElement('li')
        const title = document.createElement('strong')
        const message = document.createElement('span')
        const suggestion = document.createElement('small')
        const accept = button('接受建议', () => call(handlers, 'acceptReviewIssue', issue))
        const ignore = button('忽略', () => call(handlers, 'ignoreReviewIssue', issue.id))
        node.appendChild(title)
        node.appendChild(message)
        node.appendChild(suggestion)
        node.appendChild(accept)
        node.appendChild(ignore)
        row = { node, title, message, suggestion, accept, ignore }
        aiReviewItems.set(issue.id, row)
      }
      setText(row.title, `${issue.kind} · ${issue.severity}`)
      setText(row.message, issue.message)
      setText(row.suggestion, `建议：${issue.suggestion}`)
      setDisabled(row.accept, readonly || running)
      setDisabled(row.ignore, running)
      children.push({ node: row.node, on: true })
    })
    Array.from(aiReviewItems.keys()).forEach(id => { if (!alive.has(id)) aiReviewItems.delete(id) })
    syncChildren(aiReviewList, children)
  }

  function update(next = {}) {
    Object.assign(state, next)
    syncHeader()
    if (headerHost) mountNode(headerHost, header, true)
    if (panelHost) {
      const templateOpen = !!(state.templateOpen && state.templatesEnabled)
      const historyOpen = !!(state.historyOpen && state.historyEnabled)
      const aiOpen = !!(state.aiOpen && state.aiEnabled)
      syncChildren(panelHost, [
        { node: templatePanel, on: templateOpen },
        { node: historyPanel, on: historyOpen },
        { node: aiPanel, on: aiOpen },
        { node: notice, on: !!state.notice },
      ])
    }

    maxLengthSelect.update({ options: state.maxLengthOptions, value: state.maxLength })
    saveStatus.classList.toggle('is-error', !!state.storageError)
    setText(saveStatus, state.saveStatus)
    setDisabled(saveButton, state.readonly || state.importing)
    setAttr(saveButton, 'title', state.persistenceLabel ? `保存到${state.persistenceLabel}` : null)
    templateSelect.update({ options: state.templateOptions, value: '', disabled: state.readonly || state.importing })
    setDisabled(importButton, state.readonly || state.importing)
    setAttr(importButton, 'title', state.importing ? '导入中' : (state.importLabel || '导入'))
    setText(importButton, state.importing ? '导入中…' : (state.importLabel || '导入'))
    if (state.importAccept) importInput.accept = state.importAccept
    exportSelect.update({ options: state.exportOptions, value: '' })
    setAttr(historyButton, 'aria-expanded', state.historyOpen ? 'true' : 'false')
    setAttr(historyButton, 'title', '本地快照')

    setInputValue(templateSearch, state.templateQuery)
    const filteredTemplates = Array.isArray(state.filteredTemplates) ? state.filteredTemplates : []
    syncChildren(templatePanel, [
      { node: templateHeading, on: true },
      { node: templateSearch, on: true },
      { node: templateEmpty, on: filteredTemplates.length === 0 },
      { node: templateList, on: filteredTemplates.length > 0 },
    ])
    updateTemplateItems(filteredTemplates)
    setText(historyDescription, `仅保存在${state.persistenceLabel || ''}${state.persistenceCaveat || ''}，最多 ${state.maxSnapshots} 份。`)
    setDisabled(snapshotButton, state.readonly)
    const snapshots = Array.isArray(state.snapshots) ? state.snapshots : []
    syncChildren(historyPanel, [
      { node: historyHeading, on: true },
      { node: historyDescription, on: true },
      { node: snapshotButton, on: true },
      { node: historyEmpty, on: snapshots.length === 0 },
      { node: snapshotList, on: true },
    ])
    updateSnapshots(snapshots, state.readonly)

    setText(aiContextSummary, state.aiContextSummary)
    aiContextSelect.update({ options: state.aiContextOptions, value: state.aiContextScope, disabled: state.aiRunning || state.readonly })
    aiActionSelect.update({ options: state.aiActions, value: state.aiAction, disabled: state.readonly })
    aiLanguageLabel.style.display = state.aiAction === 'translate' ? '' : 'none'
    aiLanguageSelect.el.style.display = state.aiAction === 'translate' ? '' : 'none'
    aiLanguageSelect.update({ options: state.aiLanguageOptions, value: state.aiLanguage, disabled: state.aiRunning || state.readonly })
    setInputValue(aiPrompt, state.aiPrompt)
    setDisabled(aiPrompt, state.aiRunning || state.readonly)
    updateMessages(state.aiMessages)
    setText(generateButton, state.aiRunning ? '重新生成' : '生成预览')
    setDisabled(generateButton, state.readonly || state.aiRunning)
    setDisabled(stopButton, false)
    setDisabled(sendButton, state.readonly || state.aiRunning || !String(state.aiPrompt || '').trim())
    syncChildren(aiButtons, [
      { node: generateButton, on: true },
      { node: stopButton, on: !!state.aiRunning },
      { node: sendButton, on: true },
    ])
    setText(aiStatus, state.aiStatus)
    aiStatus.style.display = state.aiStatus ? '' : 'none'
    setText(aiResult, state.aiPreview || '选择正文或将光标放入段落，再生成预览。')
    setText(aiRichResult, '')
    if (state.aiPreviewHtml) aiRichResult.innerHTML = state.aiPreviewHtml
    syncChildren(aiResultHost, [
      { node: aiResult, on: !state.aiPreviewHtml },
      { node: aiRichResult, on: !!state.aiPreviewHtml },
    ])
    updateReviewIssues(state.aiReviewIssues, state.readonly, state.aiRunning)
    if (state.aiProposal) {
      setText(aiProposalTitle, state.aiProposal.title)
      setText(aiProposalSummary, state.aiProposal.summary)
      setText(aiProposalContent, state.aiProposal.operations?.[0]?.content || '')
    }
    setDisabled(applyProposalButton, state.readonly || state.aiRunning)
    setDisabled(cancelProposalButton, state.aiRunning)
    syncChildren(aiPanel, [
      { node: aiHeading, on: true },
      { node: aiDescription, on: true },
      { node: aiContext, on: true },
      { node: aiActionLabel, on: true },
      { node: aiActionSelect.el, on: true },
      { node: aiLanguageLabel, on: state.aiAction === 'translate' },
      { node: aiLanguageSelect.el, on: state.aiAction === 'translate' },
      { node: aiPromptLabel, on: true },
      { node: aiPrompt, on: true },
      { node: aiMessages, on: !!(state.aiMessages && state.aiMessages.length) },
      { node: aiButtons, on: true },
      { node: aiStatus, on: !!state.aiStatus },
      { node: aiResultHost, on: true },
      { node: aiReviewList, on: !!(state.aiReviewIssues && state.aiReviewIssues.length) },
      { node: aiProposal, on: !!state.aiProposal },
      { node: aiError, on: !!state.aiError },
      { node: aiResultButtons, on: true },
    ])
    setText(aiError, state.aiError)
    setDisabled(copyButton, !state.aiPreview || state.aiRunning)
    setDisabled(insertButton, !state.aiPreview || state.aiRunning || state.readonly)
    setDisabled(replaceButton, !state.aiPreview || state.aiRunning || state.readonly || state.aiReplaceDisabled)
    setAttr(replaceButton, 'title', state.aiReplaceDisabled ? '上下文超预算时只能插入到光标' : '替换生成时的上下文范围')
    setDisabled(regenerateButton, state.readonly || state.aiRunning)
    setDisabled(acceptButton, !state.aiPreview || state.aiRunning || state.readonly || state.aiReplaceDisabled)

    setText(noticeText, state.notice)
  }

  return {
    el: header,
    update,
    focusTemplateSearch() { templateSearch.focus() },
    destroy() {
      maxLengthSelect.destroy()
      templateSelect.destroy()
      exportSelect.destroy()
      aiContextSelect.destroy()
      aiActionSelect.destroy()
      aiLanguageSelect.destroy()
      owned.forEach(node => { if (node.parentNode) node.parentNode.removeChild(node) })
    },
  }
}
