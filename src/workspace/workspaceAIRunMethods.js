/**
 * 工作区控制器 —— AI 生成与应用域。
 *
 * 起流 / 停止 / 关闭、会话发送与重试、复制预览、把结果写回正文（替换 / 插入 /
 * 审阅建议 / 工具提案）。所有异步回写都带代际与作用域双重校验。
 */
import { AI_ACTIONS, streamMock, createReviewResult, createToolProposal, anchorValid } from '../components/lark-doc/mockAI'
import { previewToHtml, singleParagraphInner, looksLikeMarkdown } from '../components/lark-doc/ai'
import { logger } from '../utils/logger'

export const aiRunMethods = {
  startAI(action = 'rewrite', options = {}) {
    if (!this.featureEnabled('ai') || !this.writable()) return
    if ((this.state.aiImageChat || this.state.aiSelectionChat) && !options.context) this.closeAI(false)
    this.stopAI()
    this._aiOwnerOffs?.splice(0).forEach(stop => stop())
    const ownerScope = options.chatScope || this.createAIChatScope()
    if (!this.aiChatScopeValid(ownerScope)) { this._retireAIResult(); return }
    this._aiOwnerScope = ownerScope
    const checkOwner = () => { if (this._aiOwnerScope === ownerScope && !this.aiChatScopeValid(ownerScope)) this._retireAIResult() }
    this._aiOwnerOffs = ['identity', 'comments-reset', 'capabilities', 'provider-changed', 'connection']
      .map(event => ownerScope.session?.on?.(event, checkOwner)).filter(stop => typeof stop === 'function')
    const retireEditor = () => { if (this._aiOwnerScope === ownerScope) this._retireAIResult() }
    ownerScope.editor.on?.('editableUpdate', checkOwner); ownerScope.editor.on?.('destroy', retireEditor)
    this._aiOwnerOffs.push(() => ownerScope.editor.off?.('editableUpdate', checkOwner), () => ownerScope.editor.off?.('destroy', retireEditor))
    const allowed = AI_ACTIONS.some(item => item.value === action)
    const previewAction = action === 'chat' ? 'chat' : (allowed ? action : 'rewrite')
    if (previewAction !== 'chat') this.state.aiAction = previewAction
    this._aiPreviewAction = previewAction
    const context = options.context || this.currentAIContext()
    this._aiContext = context
    this.state.aiBudgetExceeded = Boolean(context.budgetExceeded)
    this.state.aiGeneratedAction = previewAction
    this.state.aiContextSummary = context.summary
    this._aiAnchor = context.kind === 'table' ? null : { from: context.from, to: context.to, source: context.source, valid: true }
    this.state.aiOpen = true
    this.state.aiRunning = true
    this.state.aiPreview = ''
    this.state.aiError = ''
    this.state.aiStatus = '准备生成…'
    this.state.aiReviewIssues = []
    this.state.aiProposal = null
    const generation = this._aiGeneration
    let settled = false
    const chatScope = options.chatScope
    const reference = this._aiSelectionReference
    const current = () => {
      if (settled || this._disposed || generation !== this._aiGeneration || this._aiOwnerScope !== ownerScope) return false
      if (!this.aiChatScopeValid(ownerScope)) { this._retireAIResult(); return false }
      if (chatScope && !this.aiChatScopeValid(chatScope)) { this.closeAI(false); return false }
      if (chatScope && reference && !this.selectionAIReferenceValid(reference)) { this.removeAIReference('引用的内容已改变，请重新选择后提问。'); return false }
      return true
    }
    const callbacks = {
      onStart: () => { if (current()) this.state.aiStatus = '生成中…' },
      onChunk: chunk => { if (current()) { this.state.aiPreview += chunk; this.state.aiStatus = '生成中…' } },
      onDone: () => {
        if (!current()) return
        settled = true
        this.state.aiRunning = false
        this.state.aiStatus = '已完成，等待确认'
        if (this._aiPreviewAction === 'proofread') this.state.aiReviewIssues = createReviewResult(context.text).issues
        if (this._aiPreviewAction === 'outline') this.state.aiProposal = createToolProposal(context, this._aiAnchor)
        if (this._aiPreviewAction === 'chat' && options.appendMessage) this.state.aiMessages.push({ id: `ai-${Date.now()}`, role: 'assistant', text: this.state.aiPreview })
      },
      onCancelled: () => { if (current()) { settled = true; this.state.aiRunning = false; this.state.aiStatus = '已停止' } },
      onError: error => { if (current()) { settled = true; this.state.aiRunning = false; this.state.aiError = error?.message || 'AI 生成失败'; this.state.aiStatus = '失败' } },
    }
    const adapter = this.getAIAdapter()
    this.state.aiContentFormat = adapter ? adapter.contentFormat : 'text'
    if (adapter) {
      try {
        const handle = adapter.stream({
          action: this._aiPreviewAction,
          text: context.text,
          prompt: options.prompt || this.state.aiPrompt,
          language: this.state.aiLanguage,
          range: { from: context.from, to: context.to, source: context.source },
          context,
          ...(options.images?.length ? { images: options.images } : {}),
          ...callbacks,
        })
        const stream = typeof handle === 'function' ? { cancel: handle } : (handle || { cancel() {} })
        // Provider errors are displayed by onError; consume the optional completion promise.
        stream.done?.catch?.(() => {})
        if (this._disposed || generation !== this._aiGeneration || !this.state.aiOpen || this._aiOwnerScope !== ownerScope || !this.aiChatScopeValid(ownerScope)) stream.cancel?.()
        else this._aiStream = stream
      } catch (error) { callbacks.onError(error) }
    } else if (options.requireProvider) {
      callbacks.onError(new Error('请先配置 AI 服务。'))
    } else {
      this._aiStream = streamMock(this._aiPreviewAction, context.text, {
        prompt: options.prompt || this.state.aiPrompt,
        language: this.state.aiLanguage,
        delay: 16,
        ...callbacks,
      })
    }
    logger.info('ai', 'lark-doc.mock.started', { action: previewAction, status: 'local' })
  },

  async sendAIChat(options = {}) {
    const prompt = this.state.aiPrompt.trim()
    if (!prompt || this.state.aiRunning || !this.writable() || !this.featureEnabled('ai')) return
    if (this.state.aiImageChat) {
      this.syncImageAI()
      if (!this.state.aiOpen) return
      const adapter = this.getAIChatAdapter()
      if (!adapter || (this.state.aiImage && !adapter.supportsImages)) {
        this.state.aiError = this.state.aiImage ? '请配置支持图片的 AI 服务后发送。' : '请先配置 AI 服务。'
        return
      }
      const image = this.state.aiImage
      if (image && !this.imageAIValid(image)) { this.removeAIImage(); this.state.aiError = '引用的图片已改变，请重新添加图片。'; return }
      this.stopAI()
      const generation = this._aiGeneration
      const abort = this._aiImageAbort = new AbortController()
      this.state.aiRunning = true
      this.state.aiError = ''
      this.state.aiStatus = image ? '正在准备图片…' : '准备生成…'
      try {
        const images = image ? [await this.prepareAIImage(image, abort.signal)] : []
        this.syncImageAI()
        if (this._disposed || generation !== this._aiGeneration || !this.state.aiOpen || (image && !this.imageAIValid())) {
          if (generation === this._aiGeneration) this.stopAI()
          return
        }
        this._aiImageAbort = null
        if (!options.retry) this.state.aiMessages.push({ id: `user-${Date.now()}`, role: 'user', text: image ? `[图片]\n${prompt}` : prompt })
        this._aiLastChat = { prompt }
        this.startAI('chat', { prompt, appendMessage: true, images, requireProvider: true, chatScope: this._aiImageScope, context: { scope: 'image', from: 0, to: 0, source: '', text: '', summary: image ? '引用的图片' : '无上下文' } })
        this.state.aiPrompt = ''
      } catch (error) {
        if (generation === this._aiGeneration && !this._disposed) { this.state.aiRunning = false; this.state.aiError = error.message || '图片准备失败'; this.state.aiStatus = '失败' }
      }
      return
    }
    if (this.state.aiSelectionChat) {
      const reference = this._aiSelectionReference
      this.syncImageAI()
      if (!this.state.aiOpen || !this.aiChatScopeValid(this._aiChatScope)) return
      if (reference && reference !== this._aiSelectionReference) return
      if (!this.getAIChatAdapter()) { this.state.aiError = '请先配置当前网络策略允许的 AI 服务。'; return }
      if (!this.selectionAIReferenceValid()) { this.removeAIReference('引用的内容已改变，请重新选择后提问。'); return }
      const context = this.selectionAIContext()
      if (!options.retry) this.state.aiMessages.push({ id: `user-${Date.now()}`, role: 'user', text: prompt })
      this._aiLastChat = { prompt }
      this.startAI('chat', { prompt, appendMessage: true, requireProvider: true, chatScope: this._aiChatScope, context })
      this.state.aiPrompt = ''
      return
    }
    this.state.aiMessages.push({ id: `user-${Date.now()}`, role: 'user', text: prompt })
    this.startAI('chat', { prompt, appendMessage: true })
    this.state.aiPrompt = ''
  },

  regenerateAI() {
    if (this.state.aiRunning) return
    if (this.state.aiImageChat || this.state.aiSelectionChat) {
      if (!this._aiLastChat) return
      this.state.aiPrompt = this._aiLastChat.prompt
      if (this.state.aiMessages[this.state.aiMessages.length - 1]?.role === 'assistant') this.state.aiMessages.pop()
      return this.sendAIChat({ retry: true })
    }
    this.startAI(this.state.aiAction, { prompt: this.state.aiPrompt })
  },

  stopAI() {
    this._aiGeneration += 1
    this._aiImageAbort?.abort()
    this._aiImageAbort = null
    if (this._aiStream && typeof this._aiStream.cancel === 'function') {
      try { this._aiStream.cancel() } catch (error) { /* 宿主流已关闭时忽略 */ }
    }
    this._aiStream = null
    this.state.aiRunning = false
    if (this.state.aiOpen && !this.state.aiStatus.includes('完成')) this.state.aiStatus = '已停止'
  },

  closeAI(focus = true) {
    this._aiOwnerOffs?.splice(0).forEach(stop => stop())
    this._aiOwnerScope = null
    this.stopAI()
    this.state.aiChatEpoch = Number(this.state.aiChatEpoch || 0) + 1
    if (this.state.aiImageChat || this.state.aiSelectionChat) {
      this.state.aiMessages = []
      this.state.aiPrompt = ''
      this.state.aiPreview = ''
      this.state.aiError = ''
    }
    this.state.aiOpen = false
    this.state.aiImageChat = false
    this.state.aiImage = null
    this.state.aiSelectionChat = false
    this.state.aiReference = null
    this._aiSelectionReference = null
    this._aiChatScope = null
    this._aiLastChat = null
    this._aiImageScope = null
    this._aiAnchor = null
    this._aiPreviewAction = null
    this._aiContext = null
    this.state.aiBudgetExceeded = false
    this.state.aiGeneratedAction = null
    this.state.aiReviewIssues = []
    this.state.aiProposal = null
    this.state.aiStatus = ''
    if (!this._disposed && focus) this.focus()
  },

  async copyAIPreview() {
    if (!this.state.aiPreview) return
    if (!this._aiResultCurrent()) return
    const generation = this._aiGeneration, scope = this._aiOwnerScope
    const current = () => !this._disposed && generation === this._aiGeneration && scope === this._aiOwnerScope && this.aiChatScopeValid(scope)
    if (!current()) { if (scope) this.closeAI(false); return }
    try {
      const clipboard = this.getNavigator().clipboard
      if (clipboard?.writeText) await clipboard.writeText(this.state.aiPreview)
      else throw new Error('clipboard unavailable')
      if (current()) this.state.notice = 'AI 结果已复制'
    } catch (_) { if (current()) this.state.aiError = '无法访问剪贴板，请手动选择复制' }
  },

  acceptAI(mode = 'replace') {
    if (!this._aiResultCurrent()) return false
    if (this.state.aiImageChat) return
    if (this.state.aiSelectionChat) {
      this.syncImageAI()
      if (!this.state.aiOpen || !this.aiChatScopeValid(this._aiChatScope) || this.state.aiRunning || !this.state.aiPreview || !this.selectionAIReferenceValid()) return false
      const editor = this.getEditor(), reference = this._aiSelectionReference
      const selection = reference?.bookmark.resolve(editor.state.doc)
      if (mode !== 'insert' && (!reference?.replaceable || !this.aiSelectionReplaceable(selection) || this.state.aiBudgetExceeded)) { this.state.aiError = '当前回复可插入正文；替换需要有效且不跨单元格的文字选区。'; return false }
      let applied
      if (mode === 'insert' || !selection) {
        const target = this.aiChatInsertionPoint(selection || editor.state.selection, !reference?.replaceable)
        if (target.block && this.state.aiContentFormat === 'text' && !looksLikeMarkdown(this.state.aiPreview)) {
          applied = editor.chain().focus().insertContentAt(target.pos, { type: 'paragraph', content: [{ type: 'text', text: this.state.aiPreview }] }).run()
        } else applied = this.insertAIResult(editor, target.pos, target.pos)
      } else {
        applied = this.insertAIResult(editor, selection.from, selection.to)
      }
      if (applied === false) { this.state.aiError = '回复未写入，请检查正文长度限制或编辑权限。'; return false }
      this.closeAI()
      return true
    }
    if (!this.writable() || this.state.aiRunning || !this.state.aiPreview) return
    if (this.state.aiBudgetExceeded && mode !== 'insert' && this.state.aiGeneratedAction !== 'title') {
      this.state.aiError = '上下文超过预算，只能插入到光标；请缩小范围后再替换。'
      return
    }
    const editor = this.getEditor()
    if (!anchorValid(this._aiAnchor, editor.state.doc)) {
      this.state.aiError = '原选区已改变或失效，请重新选择并生成预览。'
      logger.info('ai', 'lark-doc.mock.rejected', { status: 'stale' })
      return
    }
    if (this._aiPreviewAction === 'title') this.state.title = this.state.aiPreview.trim()
    else {
      const { from, to } = this._aiAnchor
      const insertFrom = mode === 'insert' ? editor.state.selection.from : (this._aiPreviewAction === 'continue' ? to : from)
      const insertTo = mode === 'insert' ? editor.state.selection.from : to
      this.insertAIResult(editor, insertFrom, insertTo)
    }
    this.closeAI()
    logger.info('ai', 'lark-doc.mock.accepted', { status: 'accepted' })
  },

  insertAIResult(editor, from, to) {
    const fallback = () => {
      const before = editor.state.doc
      editor.view.dispatch(editor.state.tr.insertText(this.state.aiPreview, from, to).scrollIntoView())
      return editor.state.doc !== before
    }
    const format = this.state.aiContentFormat || 'auto'
    if (format !== 'html' && format !== 'markdown' && !looksLikeMarkdown(this.state.aiPreview)) return fallback()
    const html = previewToHtml(this.state.aiPreview, format)
    if (!html) return fallback()
    const inline = singleParagraphInner(html)
    try {
      return editor.chain().focus().insertContentAt({ from, to }, inline === null ? html : inline, { updateSelection: true }).scrollIntoView().run()
    } catch (error) { return fallback() }
  },

  acceptReviewIssue(issue) {
    if (!this._aiResultCurrent()) return false
    if (!issue || !this.writable() || this.state.aiRunning || !this._aiAnchor) return
    const editor = this.getEditor()
    if (!anchorValid(this._aiAnchor, editor.state.doc)) {
      this.state.aiError = '原选区已改变或失效，请重新选择并生成预览。'
      return
    }
    const from = Math.min(this._aiAnchor.to, this._aiAnchor.from + Math.max(0, issue.from || 0))
    const to = Math.min(this._aiAnchor.to, this._aiAnchor.from + Math.max(issue.from || 0, issue.to || 0))
    if (to <= from) { this.state.aiError = '该审阅建议没有可替换的原文。'; return }
    if (typeof issue.expected === 'string' && editor.state.doc.textBetween(from, to, '\n') !== issue.expected) {
      this.state.aiError = '该审阅建议对应的原文已改变，请重新生成。'
      return
    }
    editor.view.dispatch(editor.state.tr.insertText(issue.suggestion || '', from, to).scrollIntoView())
    this.state.aiReviewIssues = this.state.aiReviewIssues.filter(item => item.id !== issue.id)
    this.state.aiStatus = '已接受审阅建议'
  },

  ignoreReviewIssue(id) { this.state.aiReviewIssues = this.state.aiReviewIssues.filter(issue => issue.id !== id) },

  applyAIProposal() {
    if (!this._aiResultCurrent()) return false
    if (!this.state.aiProposal || !this.writable()) return
    const content = this.state.aiProposal.operations[0]?.content
    if (!content) return
    const editor = this.getEditor()
    const target = this.state.aiProposal.target
    if (!anchorValid(this._aiAnchor, editor.state.doc) || !target || target.scope !== this._aiContext?.scope || target.source !== this._aiAnchor.source) {
      this.state.aiError = '提案对应的原文已改变或失效，请重新生成。'
      return
    }
    editor.view.dispatch(editor.state.tr.insertText(content, this._aiAnchor.from, this._aiAnchor.from).scrollIntoView())
    this.state.notice = '已应用 AI 提案，可撤销'
    this.state.aiProposal = null
    this.state.aiPreview = ''
    this.state.aiStatus = '提案已应用'
  }
}
