/** Low frequency workspace panels; loaded only while a template, snapshot or AI panel is open. */
import { createSelect } from './select'
import { iconNode } from './icon'
import { mountNode, setAttr, setText, syncChildren } from './dom'
import { makeDraggable } from './draggable'
import { LARK_DOC_IMPORT_FORMATS } from '../components/lark-doc/larkDocConfig'

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

function createImportDialog(close, pick) {
  const dialog = document.createElement('dialog')
  dialog.className = 'lark-doc-import-dialog'
  dialog.setAttribute('aria-label', '导入文档')
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.isComposing) return
    event.preventDefault()
    event.stopPropagation()
    close()
  })
  dialog.addEventListener('cancel', event => { event.preventDefault(); close() })
  dialog.addEventListener('click', event => { if (event.target === dialog) close() })
  const header = document.createElement('header')
  const heading = document.createElement('h2')
  heading.textContent = '导入文档'
  header.append(heading, closeButton('关闭导入', close))
  const formats = document.createElement('div')
  formats.className = 'lark-doc-import-formats'
  const choices = LARK_DOC_IMPORT_FORMATS.map(({ value, label, extensions }) => {
    const accept = extensions.map(ext => `.${ext}`)
    const item = button(undefined, () => pick(accept.join(',')))
    const text = document.createElement('span'), suffix = document.createElement('small')
    text.textContent = label
    suffix.textContent = accept.join(' / ')
    text.append(suffix)
    item.append(iconNode(({ docx: 'doc', md: 'block-text', html: 'block-code', json: 'block-file' })[value], 20), text)
    return { node: item, extension: accept[0] }
  })
  dialog.append(header, formats)
  return {
    dialog,
    update(accept) {
      const active = accept.split(',')
      syncChildren(formats, choices.map(item => ({ node: item.node, on: active.includes(item.extension) })))
      if (!dialog.open && dialog.isConnected) dialog.showModal()
    },
  }
}

export function createWorkspacePanels({ host: panelHost, handlers = {}, closeImport, pickImport } = {}) {
  const state = {}
  let importPicker
  const el = document.createElement('div')
  el.style.display = 'contents'
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
  // 名字随形态变（AI 助手 / 图片问答 / AI 问答），与结果区、发送按钮保持一致，
  // 也让外部按 `[aria-label=…]` 就能拿到面板（走查脚本与单测都靠它）。
  aiPanel.setAttribute('aria-label', 'AI 助手')
  aiPanel.addEventListener('keydown', event => {
    if (event.key === 'Escape') call(handlers, 'closeAI')
  })
  const aiHeading = document.createElement('div')
  aiHeading.className = 'lark-doc-panel-heading'
  const aiTitle = document.createElement('h2')
  aiTitle.appendChild(document.createTextNode('AI 助手 '))
  const aiMock = document.createElement('small')
  aiMock.textContent = '未配置'
  aiTitle.appendChild(aiMock)
  aiHeading.appendChild(aiTitle)
  const aiHeadingClose = closeButton('关闭 AI 助手', () => call(handlers, 'closeAI'))
  aiHeading.appendChild(aiHeadingClose)
  // 标题栏当拖动条：面板默认贴右侧槽位，用户可以把它挪到不挡正文的位置。
  const disposeAIDrag = makeDraggable(aiPanel, aiHeading)
  const aiDescription = document.createElement('p')
  aiDescription.textContent = '配置 AI 服务后，生成结果会流式显示；只有明确接受、插入或替换才修改正文。'
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
  // 单选下拉：11 个动作收在菜单里，收起时只占一行。
  const aiActionSelect = createSelect({
    ariaLabel: 'AI 操作',
    className: 'lark-doc-ai-action-select',
    onChange: value => call(handlers, 'setAIAction', value),
  })
  const aiLanguageLabel = document.createElement('label')
  aiLanguageLabel.textContent = '目标语言'
  const aiLanguageSelect = createSelect({
    ariaLabel: '目标语言',
    onChange: value => call(handlers, 'setAILanguage', value),
  })
  /**
   * 「操作」「目标语言」跟「上下文范围」同款字段卡：label 压在上、控件在下。
   * 三者样式必须同源 —— 之前「操作」是裸 label + 全宽 select 直接落在 12px 流里，
   * 跟上面那张 8px 内边距的卡片对不齐，就是截图里看着「错位」的那一块。
   */
  function field(control, labelNode) {
    const wrap = document.createElement('div')
    wrap.className = 'lark-doc-ai-field'
    wrap.appendChild(labelNode)
    wrap.appendChild(control)
    return wrap
  }
  const aiActionField = field(aiActionSelect.el, aiActionLabel)
  const aiLanguageField = field(aiLanguageSelect.el, aiLanguageLabel)
  /**
   * 配置栏：上下文范围 / 操作 /（翻译时的）目标语言。
   *
   * 004 起 AI 只有一个形态 —— 这张表单面板。003 为了保住这 11 个动作，把它们塞进了
   * 对话式外壳的 composer（`imageAi.setActionBar`），外壳长表单控件必然错位，也就是
   * 用户看到的「原来的弹窗样式全乱了」。现在控件回到面板自己身上，顺序按参考图重排。
   */
  const aiActionBar = document.createElement('div')
  aiActionBar.className = 'lark-doc-ai-actionbar'
  const aiPromptLabel = document.createElement('label')
  aiPromptLabel.setAttribute('for', 'lark-doc-ai-prompt')
  aiPromptLabel.textContent = '给 AI 的要求（可选）'
  /**
   * 要求输入框**每个会话换一个新节点**。
   *
   * 对话式面板下线前的硬约束，别图省事改成复用同一个 textarea：关面板时中文输入法还在
   * composition 里，`compositionend` / 迟到的 `input` 会打到旧节点上；节点是新的，
   * 旧事件就落在被换掉的那个节点上，写不进新会话。`aiChatEpoch` 由 controller 每次
   * 开新会话自增，这里只负责跟着换。
   */
  let aiPromptEpoch = -1
  let aiPromptOpen = null
  let aiPromptSelection = null
  let aiPrompt = makePrompt(0)
  function makePrompt(epoch) {
    const node = document.createElement('textarea')
    node.id = 'lark-doc-ai-prompt'
    node.rows = 2
    node.placeholder = '例如：请用更简洁的语气重写'
    node.addEventListener('input', event => {
      if (node !== aiPrompt || epoch !== aiPromptEpoch) return
      if (typeof handlers.isAIChatCurrent === 'function' && !handlers.isAIChatCurrent(epoch)) return
      call(handlers, 'setAIPrompt', event.target.value)
    })
    node.addEventListener('keydown', event => {
      if (node !== aiPrompt || epoch !== aiPromptEpoch || !(state.aiSelectionChat || state.aiImageChat)) return
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return
      if (typeof handlers.isAIChatCurrent === 'function' && !handlers.isAIChatCurrent(epoch)) return
      event.preventDefault()
      if (!sendButton.disabled) call(handlers, 'sendAIChat')
    })
    return node
  }
  /**
   * 引用条：图片 / 选区上下文。对话式面板下线后这条能力必须留在原处 ——
   * 否则「删掉引用」只能靠关面板重开。
   */
  const aiReference = document.createElement('div')
  aiReference.className = 'lark-doc-ai-reference'
  aiReference.hidden = true
  const aiReferenceText = document.createElement('span')
  aiReferenceText.className = 'lark-doc-ai-reference-text'
  const aiReferenceRemove = button('', () => {
    call(handlers, state.aiSelectionChat ? 'removeAIReference' : 'removeAIImage')
    aiPrompt.focus({ preventScroll: true })
  })
  aiReferenceRemove.className = 'lark-doc-ai-reference-remove'
  aiReferenceRemove.appendChild(iconNode('close', 12))
  aiReference.appendChild(aiReferenceText)
  aiReference.appendChild(aiReferenceRemove)
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
  // 六个按钮挤一行会在窄面板里被裁掉半个字：动作（复制/插入/替换/重新生成）与
  // 决策（接受/拒绝）分两行，各自随宽度换行。
  aiResultButtons.appendChild(copyButton)
  aiResultButtons.appendChild(insertButton)
  aiResultButtons.appendChild(replaceButton)
  aiResultButtons.appendChild(regenerateButton)
  const aiDecisionButtons = document.createElement('div')
  aiDecisionButtons.className = 'lark-doc-panel-buttons lark-doc-panel-buttons--decision'
  aiDecisionButtons.appendChild(acceptButton)
  aiDecisionButtons.appendChild(rejectButton)
  aiPanel.appendChild(aiHeading)
  aiPanel.appendChild(aiDescription)
  // 顺序对齐参考图：说明 → 上下文范围 → 操作 →（目标语言）→ 引用 → 要求 → 按钮 → 状态 → 结果。
  aiPanel.appendChild(aiActionBar)
  aiPanel.appendChild(aiReference)
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
  aiPanel.appendChild(aiDecisionButtons)

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
      setDisabled(row.node, state.readonly || state.importing)
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
    const importOpen = !!state.importOpener
    if (importOpen && !importPicker) {
      const dismissImport = () => {
        const opener = state.importOpener
        closeImport()
        if (opener?.isConnected) opener.focus({ preventScroll: true })
      }
      importPicker = createImportDialog(dismissImport, accept => { dismissImport(); pickImport(accept) })
    }
    if (!importOpen && importPicker?.dialog.open) importPicker.dialog.close()
    mountNode(panelHost, el, !!(importOpen || (state.templateOpen && state.templatesEnabled) || (state.historyOpen && state.historyEnabled) || (state.aiOpen && state.aiEnabled)))
    if (el) {
      const templateOpen = !!(state.templateOpen && state.templatesEnabled)
      const historyOpen = !!(state.historyOpen && state.historyEnabled)
      const aiOpen = !!(state.aiOpen && state.aiEnabled)
      syncChildren(el, [
        { node: templatePanel, on: templateOpen },
        { node: historyPanel, on: historyOpen },
        // AI 只有一个形态：这张表单面板（对话式外壳已退出显隐，见 specs/004 FR-201/203）。
        { node: aiPanel, on: aiOpen },
        ...(importPicker ? [{ node: importPicker.dialog, on: importOpen }] : []),
      ])
      if (importOpen) importPicker.update(state.importAccept)
    }

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
    setDisabled(snapshotButton, state.readonly || state.importing)
    const snapshots = Array.isArray(state.snapshots) ? state.snapshots : []
    syncChildren(historyPanel, [
      { node: historyHeading, on: true },
      { node: historyDescription, on: true },
      { node: snapshotButton, on: true },
      { node: historyEmpty, on: snapshots.length === 0 },
      { node: snapshotList, on: true },
    ])
    updateSnapshots(snapshots, state.readonly || state.importing)

    setText(aiContextSummary, state.aiContextSummary)
    // 配置栏：上下文范围在前，操作在后；翻译时才把「目标语言」放出来，别的时候不占位。
    syncChildren(aiActionBar, [
      { node: aiContext, on: true },
      { node: aiActionField, on: true },
      { node: aiLanguageField, on: state.aiAction === 'translate' },
    ])
    aiContextSelect.update({ options: state.aiContextOptions, value: state.aiContextScope, disabled: state.aiRunning || state.readonly })
    // 生成中允许切动作（会取消当前流、按新动作重跑），只读才整组禁用。
    aiActionSelect.update({ options: state.aiActions, value: state.aiAction, disabled: state.readonly })
    aiLanguageSelect.update({ options: state.aiLanguageOptions, value: state.aiLanguage, disabled: state.aiRunning || state.readonly })
    // 三态标签与对话式面板同源：选区问答 / 图片问答 / 普通 AI 助手。
    const selectionChat = !!state.aiSelectionChat
    const imageChat = !!(state.aiImageChat || state.aiImage)
    const chat = selectionChat || imageChat
    const canReplace = !imageChat && (!selectionChat || state.aiReference?.replaceable === true)
    const canSend = !chat || (state.aiServiceAvailable && (!state.aiImage || state.aiImageAvailable))
    const aiLabel = selectionChat ? 'AI 问答' : (imageChat ? '图片问答' : 'AI 助手')
    setAttr(aiPanel, 'aria-label', aiLabel)
    setAttr(aiHeadingClose, 'aria-label', `关闭${aiLabel}`)
    setText(aiReferenceText, state.aiImage ? '[图片]' : state.aiReference?.label || '')
    aiReferenceText.title = state.aiReference?.text || ''
    aiReference.hidden = !state.aiImage && !state.aiReference
    setAttr(aiReferenceRemove, 'aria-label', selectionChat ? '移除内容引用' : '移除图片引用')
    setAttr(sendButton, 'aria-label', `发送${aiLabel}`)
    setAttr(stopButton, 'aria-label', chat ? '停止生成' : null)
    setAttr(copyButton, 'aria-label', chat ? '复制 AI 回复' : null)
    // 换会话（或开关面板、切换问答形态）时换一个全新的要求输入框，见 makePrompt 的注释。
    const promptEpoch = Number(state.aiChatEpoch) || 0
    const promptOpen = state.aiOpen !== false
    if (promptEpoch !== aiPromptEpoch || promptOpen !== aiPromptOpen || selectionChat !== aiPromptSelection) {
      const next = makePrompt(promptEpoch)
      if (aiPrompt.parentNode) aiPrompt.parentNode.replaceChild(next, aiPrompt)
      else aiPanel.appendChild(next)
      aiPrompt = next
      aiPromptEpoch = promptEpoch
      aiPromptOpen = promptOpen
      aiPromptSelection = selectionChat
    }
    setInputValue(aiPrompt, state.aiPrompt)
    setDisabled(aiPrompt, state.aiRunning || state.readonly)
    updateMessages(state.aiMessages)
    setText(generateButton, state.aiRunning ? '重新生成' : '生成预览')
    setDisabled(generateButton, state.readonly || state.aiRunning)
    setDisabled(stopButton, false)
    setDisabled(sendButton, !canSend || state.readonly || state.aiRunning || !String(state.aiPrompt || '').trim())
    syncChildren(aiButtons, [
      { node: generateButton, on: true },
      { node: stopButton, on: !!state.aiRunning },
      { node: sendButton, on: true },
    ])
    setText(aiStatus, state.aiStatus)
    aiStatus.style.display = state.aiStatus ? '' : 'none'
    // 空态三副面孔：正在跑却还没吐第一帧（切动作重跑会经过这里）说「选择正文」是撒谎，
    // 用户明明是选了正文才点进来的；无结果的提示按当下形态说，别在「AI 问答」里让人去选正文。
    const emptyHint = state.aiSelectionChat
      ? (state.aiReference
        ? `已把${state.aiReference.kind === 'table' ? '所选单元格' : '当前选区'}作为上下文，点「生成预览」开始。`
        : '把光标放进段落或选中正文，再生成预览。')
      : ((state.aiImageChat || state.aiImage)
        ? '已添加图片，点「生成预览」开始。'
        : '选中正文或将光标放入段落，再生成预览。')
    setText(aiResult, state.aiPreview || (state.aiRunning ? '生成中…' : emptyHint))
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
      { node: aiActionBar, on: true },
      // 引用条常驻 DOM，显隐只走 `hidden`：移除引用后要能读回「已经隐藏」的状态，
      // 也免得 syncChildren 反复摘除/插回导致已渲染的引用文字闪一下。
      { node: aiReference, on: true },
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
      { node: aiDecisionButtons, on: true },
    ])
    setText(aiError, state.aiError)
    syncChildren(aiResultButtons, [
      { node: copyButton, on: true }, { node: insertButton, on: !imageChat },
      { node: replaceButton, on: canReplace }, { node: regenerateButton, on: true },
    ])
    setDisabled(copyButton, !state.aiPreview || state.aiRunning)
    setDisabled(insertButton, !state.aiPreview || state.aiRunning || state.readonly)
    setDisabled(replaceButton, !state.aiPreview || state.aiRunning || state.readonly || state.aiReplaceDisabled)
    setAttr(replaceButton, 'title', state.aiReplaceDisabled ? '上下文超预算时只能插入到光标' : '替换生成时的上下文范围')
    setDisabled(regenerateButton, state.readonly || state.aiRunning)
    setDisabled(acceptButton, !canReplace || !state.aiPreview || state.aiRunning || state.readonly || state.aiReplaceDisabled)
    setText(aiMock, state.aiServiceAvailable ? '已接入' : '未配置')
    setText(aiDescription, state.aiServiceAvailable
      ? '当前使用宿主配置的 AI 服务；只有明确接受、插入或替换才修改正文。'
      : '尚未配置 AI 服务；请先提供 endpoint、request 或 stream。')
  }
  return {
    el,
    update,
    focusTemplateSearch() { templateSearch.focus() },
    // 所有 AI 入口都落这张面板：「聚焦 AI」= 聚焦要求输入框。
    focusImageAI() { aiPrompt.focus({ preventScroll: true }) },
    destroy() {
      if (importPicker?.dialog.open) importPicker.dialog.close()
      disposeAIDrag()
      aiContextSelect.destroy()
      aiActionSelect.destroy()
      aiLanguageSelect.destroy()
      el.remove()
    },
  }
}
