/** Image chat view. The workspace owns requests, cancellation and transient references. */
import { iconNode } from './icon'
import { setText, syncChildren } from './dom'

export function createImageAiChat(handlers = {}) {
  const make = (tag, className, text) => {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text) node.textContent = text
    return node
  }
  const call = (name, ...args) => handlers[name]?.(...args)
  const button = (label, glyph, action) => {
    const node = make('button')
    node.type = 'button'
    node.setAttribute('aria-label', label)
    node.title = label
    node.appendChild(glyph === 'send' ? make('span', '', '↑') : iconNode(glyph, 18))
    node.addEventListener('click', action)
    return node
  }
  const root = make('section', 'lark-doc-image-ai')
  root.setAttribute('aria-label', '图片问答')
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !event.isComposing) { event.stopPropagation(); call('closeAI') }
  })
  const header = make('header', 'lark-doc-image-ai-header')
  header.appendChild(make('span', '', 'AI 助手'))
  const close = button('关闭图片问答', 'close', () => call('closeAI'))
  header.appendChild(close)
  const body = make('div', 'lark-doc-image-ai-body')
  const hero = make('div', 'lark-doc-image-ai-hero')
  hero.appendChild(iconNode('sparkle', 64))
  hero.appendChild(make('h2', '', '今天有什么工作要处理？'))
  const messages = make('div', 'lark-doc-image-ai-messages')
  messages.setAttribute('role', 'log')
  messages.setAttribute('aria-label', '图片问答记录')
  const live = make('div', 'lark-doc-image-ai-answer')
  live.setAttribute('aria-live', 'polite')
  const copy = button('复制 AI 回复', 'copy', () => call('copyAIPreview'))
  const actions = make('div', 'lark-doc-image-ai-actions')
  const actionButton = (label, action) => {
    const node = make('button', '', label)
    node.type = 'button'
    node.addEventListener('click', action)
    return node
  }
  const retry = actionButton('重新生成', () => call('regenerateAI'))
  const insert = actionButton('插入正文', () => call('acceptAI', 'insert'))
  const replace = actionButton('替换选区', () => call('acceptAI', 'replace'))
  const status = make('p', 'lark-doc-image-ai-status')
  status.setAttribute('role', 'status')
  const error = make('p', 'lark-doc-image-ai-error')
  error.setAttribute('role', 'alert')
  const composer = make('div', 'lark-doc-image-ai-composer')
  const reference = make('div', 'lark-doc-image-ai-reference')
  const referenceText = make('span', '', '[图片]')
  reference.appendChild(referenceText)
  let selectionChat = false
  let promptEpoch = 0
  let lastContext
  let wasOpen = null
  let wasSelection = null
  let active = false
  const createPrompt = context => {
    const epoch = ++promptEpoch
    const node = make('textarea')
    node.rows = 1
    node.setAttribute('aria-label', '图片问答消息')
    node.placeholder = '发消息或创建任务…'
    const current = () => active && prompt === node && epoch === promptEpoch && (!handlers.isAIChatCurrent || handlers.isAIChatCurrent(context))
    node.addEventListener('input', () => { if (current()) call('setAIPrompt', node.value) })
    node.addEventListener('keydown', event => {
      if (!current()) return
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
        event.preventDefault()
        if (!sending && !send.disabled) call('sendAIChat')
      }
    })
    return node
  }
  let prompt = createPrompt()
  const removeReference = button('移除图片引用', 'close', () => { call(selectionChat ? 'removeAIReference' : 'removeAIImage'); prompt.focus() })
  reference.appendChild(removeReference)
  let sending = false
  const controls = make('div', 'lark-doc-image-ai-controls')
  const service = make('small')
  const send = button('发送图片问答', 'send', () => call(sending ? 'stopAI' : 'sendAIChat'))
  controls.appendChild(service)
  controls.appendChild(send)
  composer.appendChild(reference)
  composer.appendChild(prompt)
  composer.appendChild(controls)
  root.appendChild(header)
  root.appendChild(body)
  root.appendChild(composer)
  return {
    el: root,
    focus() { prompt.focus({ preventScroll: true }) },
    update(state) {
      selectionChat = !!state.aiSelectionChat
      const open = state.aiOpen !== false
      if (state.aiChatEpoch !== lastContext || wasOpen !== open || wasSelection !== selectionChat) {
        const next = createPrompt(state.aiChatEpoch)
        prompt.replaceWith(next)
        prompt = next
      }
      active = open
      lastContext = state.aiChatEpoch
      wasOpen = open
      wasSelection = selectionChat
      const label = selectionChat ? 'AI 问答' : '图片问答'
      root.setAttribute('aria-label', label)
      close.setAttribute('aria-label', `关闭${label}`)
      close.title = `关闭${label}`
      messages.setAttribute('aria-label', `${label}记录`)
      prompt.setAttribute('aria-label', `${label}消息`)
      removeReference.setAttribute('aria-label', selectionChat ? '移除内容引用' : '移除图片引用')
      sending = !!state.aiRunning
      reference.hidden = !state.aiImage && !state.aiReference
      setText(referenceText, state.aiImage ? '[图片]' : state.aiReference?.label || '')
      referenceText.title = state.aiReference?.text || ''
      if (prompt.value !== state.aiPrompt) prompt.value = state.aiPrompt || ''
      prompt.disabled = !!state.readonly
      send.disabled = !!state.readonly || (!sending && (!String(state.aiPrompt || '').trim() || !state.aiServiceAvailable || (state.aiImage && !state.aiImageAvailable)))
      send.setAttribute('aria-label', sending ? '停止生成' : `发送${label}`)
      send.title = sending ? '停止生成' : `发送${label}`
      setText(send.firstChild, sending ? '■' : '↑')
      setText(service, !state.aiServiceAvailable ? '请先配置 AI 服务' : state.aiImage && !state.aiImageAvailable ? '当前 AI 服务不支持图片' : '')
      setText(status, state.aiStatus)
      setText(error, state.aiError)
      const rows = (state.aiMessages || []).map(message => {
        const row = make('div', `lark-doc-image-ai-message is-${message.role}`, message.text)
        return { node: row, on: true }
      })
      syncChildren(messages, rows)
      setText(live, state.aiPreview)
      const last = state.aiMessages?.[state.aiMessages.length - 1]
      retry.disabled = !!state.readonly || !state.aiServiceAvailable
      insert.disabled = replace.disabled = !!state.readonly
      syncChildren(actions, [
        { node: copy, on: !!state.aiPreview && !sending },
        { node: retry, on: !!state.aiCanRetry && !sending },
        { node: insert, on: selectionChat && !!state.aiPreview && !sending },
        { node: replace, on: selectionChat && !!state.aiCanReplace && !!state.aiPreview && !sending },
      ])
      syncChildren(body, [
        { node: hero, on: !rows.length && !state.aiPreview },
        { node: messages, on: !!rows.length },
        { node: live, on: !!state.aiPreview && (sending || last?.role !== 'assistant') },
        { node: actions, on: !sending && (!!state.aiPreview || !!state.aiCanRetry) },
        { node: status, on: !!state.aiStatus },
        { node: error, on: !!state.aiError },
      ])
    },
  }
}
