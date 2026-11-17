/**
 * 工作区控制器 —— AI 上下文域。
 *
 * 事务映射与锚点维护、会话作用域快照与校验、选区 / 图片引用、上下文摘要。
 * 只做「引用还成不成立」的判定，不发起请求。
 */
import { CellSelection } from '@tiptap/pm/tables'
import { mapAnchor, createContextSnapshot } from '../components/lark-doc/mockAI'
import { normalizeImageCrop, cropImageBlob, FULL_IMAGE_CROP } from '../core/media/image-crop'
import { aiNetworkAllows, createNetworkPolicy } from '../core/policy/network'

export const aiContextMethods = {
  mapAI({ transaction }) {
    if ((this.state.aiImageChat || this.state.aiSelectionChat) && transaction.docChanged) {
      let replaced = false
      transaction.mapping.maps?.forEach(map => map.forEach((from, to) => { if (from === 0 && to >= transaction.before?.content.size) replaced = true }))
      if (replaced) { this.closeAI(false); return }
    }
    mapAnchor(this._aiAnchor, transaction)
    const reference = this._aiSelectionReference
    if (reference && transaction.docChanged) {
      try {
        const previous = reference.bookmark.resolve(transaction.before)
        if (previous.ranges.some(range => transaction.mapping.mapResult(range.$from.pos, 1).deleted || transaction.mapping.mapResult(range.$to.pos, -1).deleted)) throw new Error('deleted reference')
        reference.bookmark = reference.bookmark.map(transaction.mapping)
        if (reference.cells) reference.cells = reference.cells.map(cell => ({ ...cell, pos: transaction.mapping.mapResult(cell.pos, 1).pos }))
        if (!this.selectionAIReferenceValid(reference, transaction.doc)) throw new Error('changed reference')
      } catch (_) { this.removeAIReference('引用的内容已改变，请重新选择后提问。') }
    }
    if (this.state.aiImage && transaction.docChanged) {
      const mapped = transaction.mapping.mapResult(this.state.aiImage.pos, 1)
      this.state.aiImage = { ...this.state.aiImage, pos: mapped.pos }
      // setNodeMarkup can mark an unchanged leaf as deleted while resizing/aligning it.
      if (!this.imageAIValid()) {
        this.removeAIImage()
        this.state.aiError = '引用的图片已改变，请重新添加图片。'
      }
    }
    this.syncImageAI()
  },

  createAIChatScope() {
    const session = this.getSession()
    return { editor: this.getEditor(), session, sessionDocumentId: session?.documentId, documentId: this.props.documentId,
      actor: session?.user?.id, user: this.props.user?.id, identity: session?._identityGeneration,
      privateIdentity: session?._privateIdentityGeneration, authorization: session?._authorizationGeneration,
      identityProvider: session?.getProvider?.('identity'), authorizationProvider: session?.getProvider?.('authorization'), security: session?.getProvider?.('security'),
      provider: this.host.getAIProvider ? this.host.getAIProvider() : this.props.aiProvider, network: JSON.stringify(this.state.editorConfig.network) }
  },

  aiChatScopeValid(scope) {
    const session = this.getSession()
    return !!scope?.editor?.state && !this._disposed && !scope.editor.isDestroyed && !session?._destroyed
      && this.writable() && this.featureEnabled('ai') && this.getEditor() === scope.editor
      && session === scope.session && session?.documentId === scope.sessionDocumentId && this.props.documentId === scope.documentId
      && (typeof session?.can !== 'function' || (session.can('canView') && session.can('canEdit')))
      && (typeof session?._identityCurrent !== 'function' || session._identityCurrent())
      && session?.user?.id === scope.actor && this.props.user?.id === scope.user && session?._identityGeneration === scope.identity
      && session?._privateIdentityGeneration === scope.privateIdentity && session?._authorizationGeneration === scope.authorization
      && session?.getProvider?.('identity') === scope.identityProvider && session?.getProvider?.('authorization') === scope.authorizationProvider && session?.getProvider?.('security') === scope.security
      && scope.provider === (this.host.getAIProvider ? this.host.getAIProvider() : this.props.aiProvider)
      && scope.network === JSON.stringify(this.state.editorConfig.network)
  },

  _retireAIResult() {
    this.closeAI(false)
    this.state.aiPreview = ''; this.state.aiPrompt = ''; this.state.aiMessages = []; this.state.aiError = ''
  },

  _aiResultCurrent() {
    if (this._aiOwnerScope && this.aiChatScopeValid(this._aiOwnerScope)) return true
    this._retireAIResult()
    return false
  },

  getAIChatAdapter() {
    const adapter = this.getAIAdapter()
    if (adapter?.kind === 'endpoint' && !aiNetworkAllows(adapter.endpoint || adapter.baseURL, createNetworkPolicy(this.state.editorConfig.network), this.getWindow().location?.href)) return null
    return adapter
  },

  openSelectionAI() {
    const scope = this.createAIChatScope()
    if (!this.aiChatScopeValid(scope)) return false
    const selection = scope.editor.state.selection
    let reference = null
    if (!selection.empty) {
      const cells = []
      if (selection instanceof CellSelection) selection.forEachCell((node, pos) => cells.push({ node, pos }))
      cells.sort((a, b) => a.pos - b.pos)
      const text = cells.length ? cells.map(cell => cell.node.textContent).join('\n') : scope.editor.state.doc.textBetween(selection.from, selection.to, '\n')
      reference = { kind: cells.length ? 'table' : 'text', replaceable: this.aiSelectionReplaceable(selection), bookmark: selection.getBookmark(), slice: selection.content(), cells: cells.length ? cells : null, text }
    }
    this.closeAI(false)
    this._aiChatScope = scope
    this._aiSelectionReference = reference
    this.state.aiOpen = true
    this.state.aiSelectionChat = true
    this.state.aiReference = reference ? { kind: reference.kind, text: reference.text, replaceable: reference.replaceable, label: reference.kind === 'table' ? '[表格选区]' : reference.text || '[选区]' } : null
    this.state.aiContextSummary = reference ? `${reference.kind === 'table' ? '所选单元格' : '当前选区'} · ${reference.text.length} 字` : '无上下文'
    this.state.aiPrompt = ''
    this.state.aiPreview = ''
    this.state.aiMessages = []
    this.state.aiError = ''
    this.state.aiStatus = ''
    this.host.focusImageAI?.()
    return true
  },

  selectionAIReferenceValid(reference = this._aiSelectionReference, doc = this.getEditor()?.state.doc) {
    if (!reference || !doc) return !reference
    try {
      const selection = reference.bookmark.resolve(doc)
      return (selection instanceof CellSelection) === (reference.kind === 'table') && selection.content().eq(reference.slice)
        && (!reference.cells || reference.cells.every(cell => doc.nodeAt(cell.pos) === cell.node))
    } catch (_) { return false }
  },

  aiSelectionReplaceable(selection) {
    if (selection instanceof CellSelection) return false
    const cellAt = position => {
      for (let depth = position.depth; depth > 0; depth -= 1) {
        if (['tableCell', 'tableHeader'].includes(position.node(depth).type.name)) return position.before(depth)
      }
      return null
    }
    if (cellAt(selection.$from) !== cellAt(selection.$to)) return false
    let table = false
    this.getEditor().state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
      if (node.type.name === 'table' && pos >= selection.from && pos + node.nodeSize <= selection.to) table = true
    })
    return !table
  },

  aiChatInsertionPoint(selection, outsideTable) {
    const end = selection instanceof CellSelection ? selection.$headCell : selection.$to
    if (outsideTable || selection instanceof CellSelection) {
      for (let depth = 1; depth <= end.depth; depth += 1) {
        if (end.node(depth).type.name === 'table') return { pos: end.after(depth), block: true }
      }
    }
    return { pos: selection.to, block: !selection.$to.parent.isTextblock }
  },

  selectionAIContext() {
    const reference = this._aiSelectionReference
    if (!reference) return { scope: 'none', from: 0, to: 0, source: '', text: '', summary: '无上下文' }
    const selection = reference.bookmark.resolve(this.getEditor().state.doc)
    return { scope: 'selection', kind: reference.kind, from: selection.from, to: selection.to, source: reference.text,
      text: reference.text.slice(0, 4000), summary: this.state.aiContextSummary, truncated: reference.text.length > 4000, budgetExceeded: reference.text.length > 4000,
      ...(reference.kind === 'table' ? { ranges: reference.cells.map(cell => ({ from: cell.pos, to: cell.pos + cell.node.nodeSize })), ...(reference.text.length <= 4000 ? { content: reference.slice.toJSON() } : {}) } : {}) }
  },

  removeAIReference(error = '') {
    this.stopAI()
    this._aiSelectionReference = null
    this._aiLastChat = null
    this._aiAnchor = null
    this._aiContext = null
    this.state.aiReference = null
    this.state.aiPreview = ''
    this.state.aiContextSummary = '无上下文'
    this.state.aiError = error
    this.state.aiStatus = ''
  },

  imageAIValid(image = this.state.aiImage) {
    if (!image) return false
    let node
    try { node = this.getEditor()?.state.doc.nodeAt(image.pos) } catch (_) { return false }
    return node?.type.name === 'image' && node.attrs.blockId === image.blockId
      && node.attrs.src === image.src
      && JSON.stringify(normalizeImageCrop(node.attrs.crop)) === JSON.stringify(normalizeImageCrop(image.crop))
  },

  openImageAI(image) {
    if (this._disposed || !this.featureEnabled('ai') || !this.featureEnabled('images') || !this.writable() || !this.imageAIValid(image)) return false
    if (!aiNetworkAllows(image.src, createNetworkPolicy(this.state.editorConfig.network), this.getWindow().location?.href, true)) return false
    this.closeAI(false)
    this.state.aiOpen = true
    this.state.aiImageChat = true
    this.state.aiImage = { pos: image.pos, blockId: image.blockId, src: image.src, crop: normalizeImageCrop(image.crop), alt: image.alt || '' }
    this._aiImageScope = this.createAIChatScope()
    this.state.aiPrompt = ''
    this.state.aiPreview = ''
    this.state.aiMessages = []
    this.state.aiError = ''
    this.state.aiStatus = ''
    this._aiAnchor = null
    this.host.focusImageAI?.()
    return true
  },

  syncImageAI() {
    if (this._aiOwnerScope && !this.aiChatScopeValid(this._aiOwnerScope)) { this._retireAIResult(); return }
    if (this.state.aiSelectionChat) {
      if (!this.aiChatScopeValid(this._aiChatScope)) this.closeAI(false)
      else if (!this.selectionAIReferenceValid()) this.removeAIReference('引用的内容已改变，请重新选择后提问。')
      return
    }
    if (!this.state.aiImageChat || !this._aiImageScope) return
    const scope = this._aiImageScope
    if (!this.aiChatScopeValid(scope) || !this.featureEnabled('images')) this.closeAI(false)
  },

  removeAIImage() {
    this.stopAI()
    this.state.aiImage = null
    this.state.aiError = ''
    this.state.aiStatus = ''
    this._aiLastChat = null
  },

  async prepareAIImage(image, signal) {
    if (!this.imageAIValid(image) || !aiNetworkAllows(image.src, createNetworkPolicy(this.state.editorConfig.network), this.getWindow().location?.href, true)) throw new Error('无法读取引用的图片')
    const viewWindow = this.getWindow()
    const response = await (viewWindow.fetch || fetch)(image.src, { signal, credentials: 'same-origin', redirect: 'error' })
    if (!response.ok) throw new Error('读取图片失败，请重试')
    let blob = await response.blob()
    if (blob.size > 20 * 1024 * 1024) throw new Error('图片超过 20 MB，请使用较小的图片')
    // Encode the visible crop only. Never send originalSrc or hidden pixels to an AI provider.
    blob = await cropImageBlob(blob, image.crop || FULL_IMAGE_CROP)
    if (blob.size > 20 * 1024 * 1024) throw new Error('图片超过 20 MB，请使用较小的图片')
    if (signal.aborted) throw new Error('已停止')
    const url = await new Promise((resolve, reject) => {
      const reader = new (viewWindow.FileReader || FileReader)()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => reject(new Error('读取图片失败，请重试'))
      reader.readAsDataURL(blob)
    })
    return { url, blockId: image.blockId, alt: image.alt }
  },

  currentAIContext() {
    const editor = this.getEditor()
    return editor ? createContextSnapshot(editor, this.state.aiContextScope, 4000) : { scope: this.state.aiContextScope, from: 0, to: 0, source: '', text: '', summary: '无上下文', truncated: false, budgetExceeded: false, blockCount: 0 }
  },

  resetAIPreview() {
    if (this.state.aiRunning) this.stopAI()
    this.state.aiPreview = ''
    this.state.aiError = ''
    this.state.aiReviewIssues = []
    this.state.aiProposal = null
    this.state.aiBudgetExceeded = false
    this.state.aiGeneratedAction = null
    this.state.aiContextSummary = this.currentAIContext().summary
  }
}
