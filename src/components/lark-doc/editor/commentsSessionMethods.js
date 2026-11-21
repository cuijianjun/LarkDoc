/**
 * 评论会话与输入区 —— 身份重置、会话绑定、输入区开关、选区评论、图片评论入口、
 * 全文评论草稿、编辑态、翻译态。
 *
 * 从 `commentsMixin.js` 原样搬出，方法体一行未改；以对象展开并入 `methods`。
 */

import { NodeSelection } from '@tiptap/pm/state'
import { normalizeCommentMetadata } from '../../../core/comments/mentions'
import { encodeAnchor } from '../../../core/comments/anchor'
import { getTransactionMetadata, TRANSACTION_ORIGINS } from '../../../core/transactionMetadata'

export const commentsSessionMethods = {
  setCommentMessage(value) { this.commentMessage = value },
  resetCommentIdentityView(preservePending = false, preserveSidebar = false) {
    this.retireImageViewers()
    this.closeImageComments(null, false)
    this._imageCommentDrafts = null; this._imageCommentDraftOwner = null
    this._commentLikeGeneration = (this._commentLikeGeneration || 0) + 1
    this.commentDocumentLike = { snapshot: null, busy: false, pending: '', error: '' }
    this.resetCommentParticipants()
    this.resetCommentImages(preservePending)
    this.closeCommentReaction()
    this.commentIdentityGeneration = (this.commentIdentityGeneration || 0) + 1
    this.commentLoadGeneration++
    this.commentSourceThreads = []; this.commentThreads = []; this.commentPanels = []
    this.commentComposerContext = null; this.commentComposerOpen = false; this.commentSidebarOpen = preserveSidebar && this.commentSidebarOpen
    this.commentHistoryOpen = false; this.commentHistoryStyle = {}
    if (!preserveSidebar) { this.commentHistorical = false; this.commentHistory = false }
    this.commentDrafts = {}; this.commentDraftMentions = {}; this.commentDraftReferences = {}; this.commentReplyTargets = {}; this.commentMentionPicker = null; this.commentCreateDraft = ''; this.commentDocumentDraft = ''; this.commentDocumentMentions = []; this.commentDocumentReferences = []; this.commentDocumentReplyTarget = null; this.cancelCommentEdit()
    this.commentFollowPreferences = {}; this.commentMessage = ''
    this.commentFollowReadGeneration++
    this.closeCommentMenus()
    if (!preservePending) {
      this._commentReconcileAfterAuthorization = false
      this.commentOperationGeneration++
      this.commentBusy = false; this.commentFollowBusy = false
      this.commentPendingOperation = ''; this._commentPendingProvider = null
      this.commentPendingFollowOperation = ''; this._commentPendingFollowProvider = null
    }
    this.commentTranslationContext = null; this.commentTranslationState = null; this.commentTranslationLanguage = ''; this._commentTranslationOwner = null
    this.commentPendingTranslationOperation = ''; this._commentPendingTranslationProvider = null; this.commentTranslationBusy = false
    this.refreshCommentDecorations()
  },
  bindCommentSession() {
    this._commentBoundProvider = this.commentProvider()
    for (const key of ['_commentStopCapabilities', '_commentStopProvider', '_commentStopReset', '_commentStopChanges', '_commentStopAssets']) { this[key]?.(); this[key] = null }
    if (this.session && typeof this.session.on === 'function') {
      this._commentStopAssets = this.session.on('provider-changed', event => {
        if (event.name === 'authorization') { void this.loadDocumentCommentLikes(); return }
        if (event.name !== 'assets') return
        const unresolved = this.commentPendingImage || this._commentImageInFlight
        this.resetCommentImages()
        if (unresolved) this.commentMessage = '图片服务已变更，旧图片操作需在原服务核对。'
        this.syncCommentImages()
      })
      this._commentStopChanges = this.session.on('comments-changed', () => this.refreshCommentsFromSignal())
      this._commentStopReset = this.session.on('comments-reset', reason => this.resetCommentIdentityView(reason === 'authorization-required', reason === 'authorization-required'))
      this._commentStopCapabilities = this.session.on('capabilities', () => {
        this.resetCommentParticipants()
        // 预览层回收由 resetCommentImages 统一负责（先 destroy 再清指针），不再单独调一次。
        this.resetCommentImages(true)
        this.closeCommentReaction()
        this.commentLoadGeneration++
        this.commentSourceThreads = []; this.commentThreads = []; this.commentPanels = []
        this.commentDrafts = {}; this.commentDraftMentions = {}; this.commentDraftReferences = {}; this.commentReplyTargets = {}; this.commentMentionPicker = null; this.commentEditingReply = null; this.commentEditContent = ''; this.commentEditMentions = []; this.commentEditReferences = []
        this.commentFollowPreferences = {}
        this.commentTranslationContext = null; this.commentTranslationState = null
        this.refreshCommentDecorations()
        if (this.commentCan('canView')) {
          const current = this.commentOperationCurrent(), provider = this.commentProvider(), session = this.session
          const authorization = session?._authorizationGeneration
          const loading = this.loadComments(), generation = this.commentLoadGeneration
          const owns = () => current() && generation === this.commentLoadGeneration && provider === this.commentProvider() &&
            authorization === session?._authorizationGeneration && this.commentCan('canView')
          loading.then(async () => {
            if (!owns()) return
            // Independent reads must not wait for the document-like service.
            void this.loadDocumentCommentLikes().catch(() => {})
            if (this.commentMoreThreadId && this.commentThreads.some(thread => thread.id === this.commentMoreThreadId && !thread.tombstone)) void this.loadCommentFollowPreference(this.commentMoreThreadId).catch(() => {})
            await this.openCommentLink()
            if (owns()) await this.recoverCommentAfterAuthorization()
          }).catch(() => {})
        }
      })
      this._commentStopProvider = this.session.on('comments-provider', () => {
        this._commentBoundProvider = this.commentProvider()
        this.resetCommentIdentityView(true)
        if (this.commentPendingOperation) this.commentMessage = '评论服务已变更，原操作仍需查询确认。'
        this.loadComments().catch(() => {})
      })
    }
    void this.loadDocumentCommentLikes()
  },
  // 只响应服务端失效信号；合并到一个当前读，不轮询、不重放未知POST。
  refreshCommentsFromSignal() {
    this._commentSignalDirty = true
    if (this._commentSignalWork) return this._commentSignalWork
    this._commentSignalWork = (async () => {
      while (this._commentSignalDirty && !this.commentDisposed && this.commentRemote && this.commentCan('canView')) {
        this._commentSignalDirty = false
        await this.loadComments().catch(() => {})
        await this.recoverCommentAfterAuthorization()
      }
    })().finally(() => { this._commentSignalWork = null })
    return this._commentSignalWork
  },
  toggleCommentSidebar() {
    if (this._imageCommentScope) return this.closeImageComments()
    this.commentMobileScope = this._mobileEditorMedia?.matches ? 'selection' : 'document'
    this.commentSidebarOpen = !this.commentSidebarOpen
    this.commentMobileOpen = this.commentSidebarOpen
    this.$nextTick(() => { this.updateCommentLayerBounds(); this.placeCommentPanels() })
  },
  setCommentHistory(value) { this.commentHistorical = false; this.commentHistory = value === true; this.updateCommentPanels() },
  openHistoricalComments() { this.closeCommentMenus(); this.commentHistorical = true; this.commentHistory = false; this.commentSidebarOpen = true; this.commentComposerOpen = false; this.updateCommentPanels(); this.$nextTick(() => this.updateCommentLayerBounds()) },
  closeCommentComposer() {
    const editor = this.editor, current = this.commentOperationCurrent()
    this.clearCommentDraftImages('selection')
    this.commentComposerOpen = false; this.commentComposerContext = null
    if (!this.commentRemote) { this.commentSidebarOpen = this._commentComposerSidebarOpen === true; this.commentMobileOpen = this.commentSidebarOpen }
    this.refreshCommentDecorations()
    this.$nextTick(() => {
      if (!current() || editor !== this.editor || editor?.isDestroyed || !editor?.view?.dom) return
      const document = this.$el.ownerDocument, active = document.activeElement
      if (active && active !== document.body && active !== document.documentElement && !editor.view.dom.contains(active)) return
      editor.view.focus()

    })
  },
  toggleCommentComposer() {
    if (this.commentComposerOpen) return this.closeCommentComposer()
    return this.openSelectionComment()
  },
  /** 工具栏入口（表格多格 / 链接卡片）：可选地把选区落到指定原子块，再走统一的选区评论。 */
  beginCommentComposer(pos) {
    if (!this.editor || !this.commentCan('canView') || !this.commentAllowed('create')) return false
    if (Number.isInteger(pos)) this.editor.view.dispatch(this.editor.state.tr.setSelection(NodeSelection.create(this.editor.state.doc, pos)))
    return this.openSelectionComment()
  },
  openSelectionComment() {
    if (!this.commentAllowed('create') || !this.editor) return false
    const range = this.commentSelectionRange()
    if (range && !this.commentRemote && !range.blockOnly && this.writable?.() === false) return false
    if (!range) { this.commentMessage = '请先选中要评论的文字。'; return false }

    try {
      const anchor = encodeAnchor({ blockId: range.blockId, offset: range.offset, length: range.length }, this.commentAnchorCodec)
      if (this.commentRemote && (!anchor || anchor.kind !== 'y')) throw new Error('COMMENT_ANCHOR_REQUIRED')
      this.commentComposerContext = { ...range, anchor }
    } catch (error) {
      const code = error.code || error.message
      this.commentMessage = code === 'COMMENT_ANCHOR_REQUIRED' ? '当前文档尚未连接协同正文，无法创建选区评论。' : code
      return false
    }
    this.commentMessage = ''
    if (!this.commentComposerOpen) this._commentComposerSidebarOpen = this.commentSidebarOpen
    this.commentMobileScope = 'selection'
    this.commentMobileOpen = true
    this.commentSidebarOpen = true; this.commentHistory = false; this.commentHistorical = false; this.commentComposerOpen = true; this.bubbleVisible = false
    this.updateCommentPanels(); this.refreshCommentDecorations(); this.$nextTick(() => this.updateCommentLayerBounds())
    this.$nextTick(() => this.$el.querySelector('[aria-label="新评论"]')?.focus())
    return true
  },
  onCommentShortcut(event) {
    if (this.slides && this.presentationMode !== 'document') return
    if ((event.metaKey || event.ctrlKey) && event.altKey && (event.code === 'KeyM' || String(event.key).toLowerCase() === 'm') && this.commentCan('canComment')) {
      event.preventDefault(); event.stopPropagation()
      // 捕获阶段先于PM的selectionchange同步；原生键盘刚划词时以当前DOM选区为准。
      const view = this.editor && this.editor.view
      const selected = view && view.dom && view.dom.ownerDocument.getSelection()
      if (selected && view.dom.contains(selected.anchorNode) && view.dom.contains(selected.focusNode)) {
        try {
          const anchor = view.posAtDOM(selected.anchorNode, selected.anchorOffset)
          const head = view.posAtDOM(selected.focusNode, selected.focusOffset)
          this.editor.commands.setTextSelection({ from: Math.min(anchor, head), to: Math.max(anchor, head) })
        } catch { this.commentMessage = '请先选中要评论的文字。'; return }
      }
      this.openSelectionComment()
    }
  },
  setCommentCreateDraft(value) {
    if (this._imageCommentScope && !this.imageCommentCurrent()) return this.closeImageComments(null, false)
    this.commentCreateDraft = value
  },
  imageCommentCurrent(scope = this._imageCommentScope) {
    if (!scope || !scope.owner() || (scope.viewer && !scope.viewer.isConnected)) return false
    const pos = this.commentBlockPos(scope.blockId), node = pos < 0 ? null : this.editor.state.doc.nodeAt(pos)
    return node?.type.name === 'image' && node.attrs.src === scope.src && JSON.stringify(node.attrs.crop) === scope.crop
  },
  imageCommentsHandler() {
    const current = this.commentOperationCurrent(), editor = this.editor, session = this.session, provider = this.commentProvider()
    const identity = session?._identityGeneration, authorization = session?._authorizationGeneration, documentId = this.documentId
    const owner = () => current() && editor === this.editor && identity === session?._identityGeneration && authorization === session?._authorizationGeneration
      && documentId === this.documentId && provider === this.commentProvider() && this.commentCan('canView')
    const action = (image, visible, viewer) => {
      if (!owner()) {
        if (!visible) this.closeImageComments(viewer, false)
        return false
      }
      return this.openImageComments(image, visible, viewer)
    }
    action.watchViewer = (retire, images) => {
      this._imageViewerRetire ||= new Set()
      this._imageViewerRetire.add(retire)
      const targets = images.map(image => ({ image, pos: image.pos }))
      const guard = () => { if (!owner()) retire() }
      const transaction = ({ transaction: tr }) => {
        if (!owner()) { retire(); return }
        if (!tr.docChanged) return
        if ([TRANSACTION_ORIGINS.HOST, TRANSACTION_ORIGINS.RESTORE].includes(getTransactionMetadata(tr)?.origin)
          || tr.steps.some(step => step.from === 0 && step.to >= tr.before.content.size)) { retire(); return }
        for (const target of targets) {
          target.pos = tr.mapping.map(target.pos, 1)
          const node = Number.isInteger(target.pos) && target.pos >= 0 && target.pos < editor.state.doc.content.size ? editor.state.doc.nodeAt(target.pos) : null
          if (node?.type.name !== 'image' || node.attrs.blockId !== target.image.blockId || node.attrs.src !== target.image.src
            || JSON.stringify(node.attrs.crop) !== JSON.stringify(target.image.crop)) { retire(); return }
        }
      }
      const stops = ['comments-reset', 'capabilities', 'provider-changed'].map(name => session?.on?.(name, guard))
      editor?.on('transaction', transaction)
      guard()
      return () => { this._imageViewerRetire?.delete(retire); stops.forEach(stop => stop?.()); editor?.off('transaction', transaction) }
    }
    return action
  },
  retireImageViewers() { this._imageViewerRetire?.forEach(retire => retire()); this._imageViewerRetire?.clear() },
  openImageComments(image, visible = true, viewer = null) {
    if (!visible) { this.closeImageComments(viewer); return true }
    const editor = this.editor, provider = this.commentProvider()
    if (!editor || editor.isDestroyed || !provider || !this.commentCan('canView') || !this.featureEnabled('comments')) return false
    // The existing remote wire requires a nonempty text-relative anchor.
    // A block image has no text span; never invent a length or a new wire kind.
    if (provider.isRemote) { this.commentMessage = '当前远程评论服务尚未提供图片锚点评论能力'; return false }
    const blockId = image?.blockId, pos = this.commentBlockPos(blockId), node = pos < 0 ? null : editor.state.doc.nodeAt(pos)
    if (node?.type.name !== 'image' || node.attrs.src !== image.src || (viewer && (!viewer.isConnected || !this.$el.contains(viewer)))) return false
    if (this._imageCommentScope?.blockId === blockId && this._imageCommentScope.viewer === viewer && this.imageCommentCurrent()) return true
    this.closeImageComments()
    if (!this._imageCommentDraftOwner?.()) this._imageCommentDrafts = new Map()
    const current = this.commentOperationCurrent(), session = this.session, identity = session?._identityGeneration, authorization = session?._authorizationGeneration
    const assets = session?.getProvider?.('assets')
    const owner = () => current() && editor === this.editor && editor.view.dom.isConnected && provider === this.commentProvider()
      && identity === session?._identityGeneration && authorization === session?._authorizationGeneration
      && assets === session?.getProvider?.('assets') && this.commentCan('canView') && this.featureEnabled('comments')
    this._imageCommentDraftOwner = owner
    const selection = NodeSelection.create(editor.state.doc, pos)
    // `blockOnly`：整块评论（图片没有文字区间）不落 mark，只读文档里也能发。
    const context = { blockId, offset: 0, length: 0, from: pos, to: pos + node.nodeSize,
      ranges: [{ from: pos, to: pos + node.nodeSize }], text: '[图片]', blockOnly: true, bookmark: selection.getBookmark(),
      anchor: encodeAnchor({ blockId, offset: 0, length: 0 }, this.commentAnchorCodec) }
    const previous = { commentComposerOpen: this.commentComposerOpen, commentComposerContext: this.commentComposerContext,
      commentCreateDraft: this.commentCreateDraft, commentSidebarOpen: this.commentSidebarOpen, commentMobileScope: this.commentMobileScope,
      commentMobileOpen: this.commentMobileOpen, commentActiveThreadId: this.commentActiveThreadId,
      images: this.commentDraftImages('selection') }
    this.clearCommentDraftImages('selection')
    const cached = this._imageCommentDrafts.get(blockId)
    const draft = cached?.src === node.attrs.src && cached?.crop === JSON.stringify(node.attrs.crop) ? cached : null
    if (cached && !draft) this._imageCommentDrafts.delete(blockId)
    this._imageCommentScope = { blockId, src: node.attrs.src, crop: JSON.stringify(node.attrs.crop), owner, viewer, context, previous }
    this.closeCommentMenus()
    this.commentCreateDraft = draft?.text || ''
    this.$set(this.commentImageDrafts, 'selection', draft?.images || [])
    this.commentComposerContext = context; this.commentComposerOpen = true
    this._imageCommentScope.context = this.commentComposerContext
    this.commentSidebarOpen = true; this.commentMobileScope = 'selection'; this.commentMobileOpen = true
    this.updateCommentPanels(); this.refreshPanels?.()
    this.$nextTick(() => this.focusImageComment())
    return true
  },
  closeImageComments(viewer = null, restore = true) {
    const scope = this._imageCommentScope
    if (!scope || (viewer && scope.viewer !== viewer)) return false
    this._imageCommentScope = null
    const owned = scope.owner()
    scope.ui?.destroy()
    scope.column?.remove()
    if (owned && this.imageCommentCurrent(scope)) this._imageCommentDrafts?.set(scope.blockId, { src: scope.src, crop: scope.crop, text: this.commentCreateDraft, images: this.commentDraftImages('selection') })
    else { this._imageCommentDrafts = null; this._imageCommentDraftOwner = null }
    this.clearCommentDraftImages('selection')
    this.closeCommentMenus()
    if (restore && owned) {
      const { images, ...previous } = scope.previous
      Object.assign(this, previous)
      this.$set(this.commentImageDrafts, 'selection', images)
    } else { this.commentComposerOpen = false; this.commentComposerContext = null; this.commentCreateDraft = ''; this.commentSidebarOpen = false; this.commentMobileOpen = false }
    scope.viewer?.dispatchEvent(new CustomEvent('lark-doc-image-comments-close', { detail: { retired: !restore || !owned } }))
    this.refreshPanels?.()
    return true
  },
  focusImageComment() {
    const scope = this._imageCommentScope
    if (!this.imageCommentCurrent(scope) || !scope.viewer || !scope.viewer.contains(scope.viewer.ownerDocument.activeElement)) return
    scope.ui?.el?.querySelector('[aria-label="新评论"]')?.focus()
  },
  cancelDocumentCommentDraft(submittedImages) {
    if (this.commentMentionPicker?.scope === 'document') this.commentMentionPicker = null
    this.commentDocumentDraft = ''; this.commentDocumentMentions = []; this.commentDocumentReferences = []; this.commentDocumentReplyTarget = null
    this.clearCommentDraftImages('document', submittedImages)
  },
  setCommentDocumentDraft(value, mentions = [], references = []) {
    const next = normalizeCommentMetadata(value, mentions, references)
    this.commentDocumentDraft = value; this.commentDocumentMentions = next.mentions
    this.commentDocumentReferences = next.references.map((item, index) => ({ ...item, ...(references[index].readable === false ? { readable: false } : {}) }))
  },
  commentDocumentCanSubmit() { return this.commentAllowed('create') },


  consumeDocumentCommentReplyTarget(target) { if (target === this.commentDocumentReplyTarget) this.commentDocumentReplyTarget = null },

  setCommentCreatePrivate(value) { this.commentCreatePrivate = value === true },
  setCommentEditContent(value, mentions = [], references = []) {
    const next = normalizeCommentMetadata(value, mentions, references)
    this.commentEditContent = value; this.commentEditMentions = next.mentions
    this.commentEditReferences = next.references.map((item, index) => ({ ...item, ...(references[index].readable === false ? { readable: false } : {}) }))
  },
  cancelCommentEdit() { if (this.commentEditingReply) this.clearCommentDraftImages('edit/' + this.commentEditingReply.threadId + '/' + this.commentEditingReply.replyId); this.commentEditingReply = null; this.commentEditContent = ''; this.commentEditMentions = []; this.commentEditReferences = [] },
  setCommentTranslationLanguage(value) { this.commentTranslationLanguage = value },
  closeCommentTranslation() { this.commentTranslationContext = null; this.commentTranslationState = null },
}
