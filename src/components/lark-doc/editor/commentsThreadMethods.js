/**
 * 线程与草稿侧 —— 选区范围、草稿写入 / 清理、线程激活与跳转、草稿图片上传、
 * 图片查看器、表情回复、跟随偏好。
 *
 * 从 `commentsMixin.js` 原样搬出，方法体一行未改；以对象展开并入 `methods`。
 */

import { normalizeCommentMetadata } from '../../../core/comments/mentions'
import { commentDraftText } from './commentMixinShared'

let commentImagesPromise
function loadCommentImages() {
  if (!commentImagesPromise) commentImagesPromise = import(/* webpackChunkName: "editor-comment-images" */ './commentImages').catch(error => { commentImagesPromise = null; throw error })
  let timer
  return Promise.race([commentImagesPromise, new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('COMMENT_IMAGE_COMPONENT_TIMEOUT')), 15000) })]).finally(() => clearTimeout(timer))
}


export const commentsThreadMethods = {
  resetCommentParticipants() {
    clearTimeout(this._commentParticipantTimer); this._commentParticipantRead = null
    this.commentParticipantThread = ''; this.commentParticipantRevision = ''; this.commentParticipantQuery = ''
    this.commentParticipantSelection = []; this.commentParticipantCandidates = []; this.commentParticipantIndex = -1
    this.commentParticipantBusy = false; this.commentParticipantError = ''
  },


  // —— 选区 → 锚点 ——
  /**
   * 当前选区落在哪个块、块内偏移多少。空选区 / 找不到带 blockId 的祖先都返回 null
   * （05 §5.5 要求 `blockId` 是身份主键，没有块 id 的选区不该建评论）。
   */
  commentSelectionRange() {
    if (!this.editor) return null
    const state = this.editor.state
    const selection = state.selection
    if (!selection || selection.empty) return null
    const ranges = selection.ranges.map(range => ({ from: range.$from.pos, to: range.$to.pos })).sort((a, b) => a.from - b.from)
    const from = ranges[0].from, to = ranges[ranges.length - 1].to
    const resolved = selection.$anchorCell || state.doc.resolve(from)
    const node = selection.node
    if (node?.attrs?.blockId) {
      const text = ({ image: '[图片]', linkEmbed: '[网页]', bookmark: '[网页卡片]' })[node.type.name] || node.textContent
      return { blockId: node.attrs.blockId, offset: 0, length: node.content.size, from, to, ranges, text, bookmark: selection.getBookmark() }
    }
    for (let depth = resolved.depth; depth > 0; depth -= 1) {
      const node = resolved.node(depth)
      const blockId = node.attrs && typeof node.attrs.blockId === 'string' ? node.attrs.blockId.trim() : ''
      if (!blockId || (selection.$anchorCell && node.type.name !== 'table')) continue
      const contentStart = resolved.before(depth) + 1
      return {
        blockId, offset: Math.max(0, from - contentStart), length: Math.max(0, to - from), from, to, ranges,
        text: selection.$anchorCell ? ranges.map(range => state.doc.textBetween(range.from, range.to, ' ', ' ')).join(' ') : state.doc.textBetween(from, to, '\n', ' '),
        bookmark: selection.getBookmark(),
      }
    }
    return null
  },
  /** 把 comment mark 落到一段选区上（mark 没注册时静默：`setComment` 命令不存在）。 */
  applyCommentMark(threadId, from, to) {
    const provider = this.commentProvider()
    if ((provider && provider.isRemote) || !this.editor || typeof this.editor.commands.setComment !== 'function') return false
    const size = this.editor.state.doc.content.size
    const start = Math.max(0, Math.min(from, size))
    const end = Math.max(start, Math.min(to, size))
    this.editor.chain().focus().setTextSelection({ from: start, to: end }).setComment({ threadId }).setTextSelection(end).run()
    return true
  },

  // —— 草稿 ——
  setCommentDraft(threadId, text, mentions = this.commentDraftMentions[threadId] || [], references = this.commentDraftReferences[threadId] || []) {
    if (!threadId || !this.commentAllowed('reply', threadId)) return
    const content = typeof text === 'string' ? text : ''
    let metadata = { mentions: [], references: [] }
    try { metadata = normalizeCommentMetadata(content, mentions, references) } catch { /* Text edits can invalidate stale ranges; keep plain text until a new mention is selected. */ }
    this.$set(this.commentDrafts, threadId, content)
    this.$set(this.commentDraftMentions, threadId, metadata.mentions)
    this.$set(this.commentDraftReferences, threadId, metadata.references)
  },
  /** 引用回复：把被引用作者写成结构化 mention（文本仍是 `@名字 `，但带身份），再顺延既有区间。 */
  quoteCommentReply(threadId, replyId) {
    const reply = this.commentThreads.find(thread => thread.id === threadId)?.replies.find(item => item.id === replyId)
    if (!reply) return false
    const name = this.commentAuthorName(reply.author), prefix = `@${name} `
    this.$set(this.commentReplyTargets, threadId, { commentId: reply.id, authorId: reply.author.id, authorName: name })
    const draft = this.commentDraftOf(threadId)
    if (draft.startsWith(prefix)) return true
    const shift = prefix.length
    const mentions = [{ principalId: reply.author.id, from: 0, to: 1 + name.length },
      ...(this.commentDraftMentions[threadId] || []).map(item => ({ ...item, from: item.from + shift, to: item.to + shift }))]
    const references = (this.commentDraftReferences[threadId] || []).map(item => ({ ...item, from: item.from + shift, to: item.to + shift }))
    this.setCommentDraft(threadId, prefix + draft, mentions, references)
    return true
  },
  clearCommentDraft(threadId, submittedImages) {
    if (!threadId) return
    this.clearCommentDraftImages(threadId, submittedImages)
    this.$set(this.commentDrafts, threadId, '')
    this.$set(this.commentDraftMentions, threadId, [])
    this.$set(this.commentDraftReferences, threadId, [])
    this.commentDropKey(this.commentReplyTargets, threadId)
    if (this.commentMentionPicker?.threadId === threadId) this.commentMentionPicker = null
  },







  commentHasDraft(threadId) {
    return commentDraftText(this.commentDrafts, threadId).trim().length > 0 || this.commentDraftImages(threadId).length > 0
  },

  // —— 点亮、已读、跳转 ——
  activateComment(threadId) {
    const next = threadId || ''
    const thread = this.commentThreads.find(item => item.id === next)
    if (next) this.commentMobileOpen = true
    if (thread) this.commentMobileScope = thread.scope === 'document' ? 'document' : 'selection'
    if ((this.commentRemote || this._mobileEditorMedia?.matches) && thread && thread.scope !== 'document') { this.commentSidebarOpen = true; this.commentHistorical = thread.anchorStatus === 'orphaned'; this.commentHistory = !this.commentHistorical && thread.resolved === true }
    if (next === this.commentActiveThreadId) { this.updateCommentPanels(); return }
    this.commentActiveThreadId = next
    if (next) this.markCommentRead(next)
    if (this.commentRemote) this.updateCommentPanels()
    this.refreshCommentDecorations()
    this.$nextTick(() => this.placeCommentPanels())
  },
  markCommentRead(threadId) {
    if (!threadId || this.commentReadIds.indexOf(threadId) !== -1) return
    this.commentReadIds = this.commentReadIds.concat([threadId])
  },
  /** 面板头「下一条 / 上一条」：只在面板顺序里前后跳，跳出去不动（同修订面板口径）。 */
  goComment(threadId, direction) {
    const list = this.commentRemote ? this.commentThreads.filter(thread => !thread.tombstone) : this.commentPanels
    const index = list.findIndex((item) => item.id === threadId)
    if (index === -1) return
    const next = list[index + (direction < 0 ? -1 : 1)]
    if (!next) return
    this.activateComment(next.id)
    if (next.bound) this.scrollCommentIntoView(next.blockId)
  },
  scrollCommentIntoView(blockId) {
    if (!this.editor) return
    const pos = this.commentBlockPos(blockId)
    if (pos < 0) return
    try {
      this.editor.storage?.larkDoc?.projection?.revealPosition?.(pos)
      const at = this.editor.view.domAtPos(pos)
      const direct = this.editor.view.nodeDOM?.(pos) || at.node
      const node = direct && direct.nodeType === 3 ? direct.parentNode : direct
      this.editor.storage?.larkDoc?.projection?.revealNode?.(node)
      if (node && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'center' })
    } catch (error) {
      // 滚不动不影响点亮结果，静默（没有 toast 位）。
    }
  },
  commentBlockPos(blockId) {
    if (!this.editor || typeof blockId !== 'string' || !blockId) return -1
    let found = -1
    this.editor.state.doc.descendants((node, pos) => {
      if (found !== -1) return false
      if (node.attrs && node.attrs.blockId === blockId) {
        found = pos
        return false
      }
      return true
    })
    return found
  },

  // —— 开关与菜单 ——

  commentPrivate(threadId) {
    const provider = this.commentProvider()
    if (provider?.isRemote || this.commentThreads.find(thread => thread.id === threadId)?.scope === 'document') {
      const thread = (this.commentThreads || []).find(item => item.id === threadId)
      return Boolean(thread && thread.visibility === 'private')
    }
    return false
  },



  commentViewport() {
    const root = typeof document !== 'undefined' ? document.documentElement : null
    const win = typeof window !== 'undefined' ? window : null
    const visual = win?.visualViewport
    const width = Number(visual?.width) || Number(root?.clientWidth) || Number(win?.innerWidth) || 0
    const height = Number(visual?.height) || Number(root?.clientHeight) || Number(win?.innerHeight) || 0
    return { width, height }
  },

  closeCommentMenus() {
    this.resetCommentParticipants()
    this.closeCommentReaction()
    this.commentMoreThreadId = ''
    this.commentMenuThreadId = ''
    this.commentMenuCommentId = ''
    this.commentReplyMenuPosition = null
    this.commentMoreMenuPosition = null
    this._commentMoreMenuAnchor = null; this._commentReplyMenuAnchor = null
  },
  commentDraftImages(scope) { return this.commentImageDrafts?.[scope] || [] },
  /** 本地 provider 的图片附件：与远端 `assetIds` 对应，取已上传完成的 uploader 结果。 */
  commentDraftAttachments(scope) {
    return this.commentDraftImages(scope).filter(image => image.status === 'ready' && (image.attachment?.url || image.url))
      // 编辑态里的已存附件是扁平 `{ url, name }`（没有 uploader 结果），照原样送回才能保住这张图。
      .map(image => {
        const attachment = image.attachment || image
        return { url: attachment.url, name: image.name || attachment.fileName || '', ...(attachment.attchId != null ? { attchId: String(attachment.attchId) } : {}) }
      })
  },
  /** 远端 provider 的 `assetIds`：与 `commentDraftAttachments` 同一批已就绪草稿。 */
  commentDraftAssetIds(scope) {
    return this.commentDraftImages(scope).filter(image => image.status === 'ready' && image.assetId).map(image => image.assetId)
  },
  submittedCommentImageIds(scope) {
    const remote = this.commentProvider()?.isRemote
    return this.commentDraftImages(scope)
      .filter(image => image.status === 'ready' && (image.assetId || (!remote && (image.attachment?.url || image.url))))
      .map(image => image.id)
  },
  invalidateCommentImageUpload(scope) {
    if (!this.commentImageDraftGenerations) this.commentImageDraftGenerations = {}
    this.$set(this.commentImageDraftGenerations, scope, (this.commentImageDraftGenerations[scope] || 0) + 1)
    if (this.commentPendingImage?.scope === scope) this.commentPendingImage = { operationId: this.commentPendingImage.operationId, kind: this.commentPendingImage.kind, scope: null }
    if (this._commentImageInFlight?.scope === scope) {
      this.commentPendingImage = { operationId: this._commentImageInFlight.operationId, beginOperationId: this._commentImageInFlight.beginOperationId, kind: 'complete', scope: null }
      this._commentImageUploadController?.abort()
    }
    if (this._commentImageUploadScope === scope && !this._commentImageInFlight) { this._commentImageUploadController?.abort(); this._commentImageUploadController = null; this._commentImageUploadScope = ''; this.commentImageBusy = false }
  },
  commentImageCanCancel() { return Boolean(this._commentImageUploadController && this._commentImageUploadScope) },
  cancelCommentImageUpload() {
    const scope = this._commentImageUploadScope
    if (scope) this.invalidateCommentImageUpload(scope)
  },
  clearCommentDraftImages(scope, submittedImages) {
    if (submittedImages) {
      for (const image of this.commentDraftImages(scope)) {
        if (submittedImages.includes(image.id)) this.removeCommentDraftImage(scope, image.id)
      }
      return
    }
    this.invalidateCommentImageUpload(scope)
    this.dropCommentAttachmentTasks(scope)
    this.commentDraftImages(scope).forEach(image => {
      this._commentAttachmentFiles?.delete(image.id)
      if (image.previewUrl) URL.revokeObjectURL(image.previewUrl)
    })
    this.$set(this.commentImageDrafts, scope, [])
  },
  /** 撤掉这个草稿作用域还没结束的上传（清草稿 / 换文档 / 移除单张都走这里）。 */
  dropCommentAttachmentTasks(scope, id = '') {
    this._commentAttachmentTasks?.forEach((task, taskId) => {
      if (task.scope !== scope || (id && taskId !== id)) return
      task.controller?.abort('draft-cleared')
      if (task.previewUrl) URL.revokeObjectURL(task.previewUrl)
      this._commentAttachmentTasks.delete(taskId)
    })
  },
  removeCommentDraftImage(scope, id) {
    const list = this.commentDraftImages(scope)
    this.dropCommentAttachmentTasks(scope, id)
    list.filter(image => image.id === id).forEach(image => { if (image.previewUrl) URL.revokeObjectURL(image.previewUrl) })
    this._commentAttachmentFiles?.delete(id)
    this.$set(this.commentImageDrafts, scope, list.filter(image => image.id !== id))
  },
  /** 与基线一致：图片能力只看评论服务是否声明 supportAttachments，不依赖 assets Provider。 */
  commentCanAttach() { return this.commentCan('canView') && this.commentProvider?.()?.supportsAttachments === true },
  commentCanUploadImage(scope) {
    if (!this.commentCanAttach() || this.commentImageBusy || this.commentDraftImages(scope).length >= 9) return false
    if (scope.startsWith('edit/')) { const [, threadId, replyId] = scope.split('/'); return this.commentAllowed('edit', threadId, replyId) }
    return ['document', 'selection'].includes(scope) ? this.commentAllowed('create') : this.commentAllowed('reply', scope)
  },

  commentImageScopeCurrent(scope, draftGeneration, context) {
    if ((this.commentImageDraftGenerations[scope] || 0) !== draftGeneration || !this.commentCan('canComment')) return false
    if (scope === 'selection') return this.commentComposerOpen && this.commentComposerContext === context
    if (scope === 'document') return true
    if (scope.startsWith('edit/')) {
      if (!context || this.commentEditingReply !== context) return false
      const reply = this.commentThreads.find(thread => thread.id === context.threadId)?.replies.find(reply => reply.id === context.replyId)
      return reply?.replyRevision === context.originalReplyRevision && reply?.capabilities.canEdit === true
    }
    return this.commentThreads.some(thread => thread.id === scope && !thread.tombstone && thread.capabilities.canReply)
  },
  resetCommentImages(preservePending = false) {
    const original = this.commentPendingImage || (this._commentImageInFlight ? { operationId: this._commentImageInFlight.operationId, kind: 'complete', beginOperationId: this._commentImageInFlight.beginOperationId } : null)
    this._commentImageInFlight = null
    this._commentImageUploadScope = ''
    this.commentImageGeneration++
    this._commentImageUploadController?.abort(); this._commentImageUploadController = null
    this._commentImageEntries?.forEach(entry => { entry.controller.abort(); if (entry.url) URL.revokeObjectURL(entry.url) })
    this._commentImageEntries = new Map()
    Object.keys(this.commentImageDrafts).forEach(scope => this.clearCommentDraftImages(scope))
    this._commentAttachmentFiles = new Map(); this._commentUploader = null; this._commentUploaderInput = null
    // 指针一清，权限回收时就再也找不到这块预览层了：先销毁，再撤掉切换文档时的回收钩子。
    this._commentAttachmentViewer?.destroy?.(false)
    if (this._commentAttachmentRetire) this._imageViewerRetire?.delete(this._commentAttachmentRetire)
    this._commentAttachmentViewer = null; this._commentAttachmentRetire = null
    this.commentImageDrafts = {}; this.commentImageDraftGenerations = {}; this.commentImageUrls = {}; this.commentImageErrors = {}; this.commentImageViewer = null; this._commentImageViewerAnchor = null; this.commentImageBusy = false
    this.commentPendingImage = preservePending && original ? { operationId: original.operationId, kind: original.kind, ...(original.beginOperationId ? { beginOperationId: original.beginOperationId } : {}), scope: null } : null
  },
  commentImageKey(thread, reply, asset) { return [thread.id, reply.id, reply.replyRevision, asset.assetId, asset.checksum].join('/') },
  commentImageUrl(thread, reply, asset) { return this.commentImageUrls[this.commentImageKey(thread, reply, asset)] || '' },
  closeCommentImage(restoreFocus = false) { this.commentImageViewer = null; if (restoreFocus && this._commentImageViewerAnchor?.isConnected) this._commentImageViewerAnchor.focus(); this._commentImageViewerAnchor = null },
  focusCommentImageClose() { this.$el.querySelector('[aria-label="关闭图片预览"]')?.focus() },
  retryCommentImage(thread, reply, asset) {
    const key = this.commentImageKey(thread, reply, asset), entry = this._commentImageEntries?.get(key)
    if (!entry || !this.commentImageErrors[key] || !this.commentCan('canView')) return
    entry.controller.abort(); this._commentImageEntries.delete(key); this.$set(this.commentImageErrors, key, ''); this.syncCommentImages()
  },
  openCommentImage(thread, reply, asset, event) {
    if (!this.commentImageUrl(thread, reply, asset)) return this.retryCommentImage(thread, reply, asset)
    const key = this.commentImageKey(thread, reply, asset)
    if (this.commentImageUrls[key]) { this.closeCommentMenus(); this._commentImageViewerAnchor = event?.currentTarget; this.commentImageViewer = { key, url: this.commentImageUrls[key], fileName: asset.fileName }; this.$nextTick(() => this.focusCommentImageClose()) }
  },
  syncCommentImages() {
    if (!this._commentImageEntries) this._commentImageEntries = new Map()
    const wanted = new Map()
    this.commentThreads.forEach(thread => thread.replies.forEach(reply => (reply.attachments || []).forEach(asset => wanted.set(this.commentImageKey(thread, reply, asset), { thread, reply, asset }))))
    this._commentImageEntries.forEach((entry, key) => {
      if (!wanted.has(key)) { entry.controller.abort(); if (entry.url) URL.revokeObjectURL(entry.url); this._commentImageEntries.delete(key); this.$set(this.commentImageUrls, key, ''); this.$set(this.commentImageErrors, key, '') }
    })
    if (this.commentImageViewer && !wanted.has(this.commentImageViewer.key)) this.commentImageViewer = null
    wanted.forEach(({ thread, reply, asset }, key) => {
      if (this._commentImageEntries.has(key)) return
      const entry = { controller: new AbortController(), url: '' }, generation = this.commentImageGeneration, session = this.session
      this._commentImageEntries.set(key, entry)
      const current = () => generation === this.commentImageGeneration && this._commentImageEntries.get(key) === entry && session === this.session && this.commentCan('canView')
      void loadCommentImages().then(operations => {
        if (current()) return operations.loadCommentImage.call(this, { asset, session, entry, thread, reply, current, key })
        return undefined
      }).catch(() => { if (current()) this.$set(this.commentImageErrors, key, '图片加载失败，请重试。') })
    })
  },
  closeCommentReaction(restoreFocus = false) {
    const anchor = this._commentReactionAnchor, context = this.commentReactionContext
    this.commentReactionContext = null; this._commentReactionAnchor = null
    if (context?.position) {
      const style = this.$el?.querySelector?.('.lark-doc-comment-reaction-picker')?.style
      for (const key of ['position', 'left', 'top']) style?.removeProperty(key)
    }
    if (restoreFocus) this.restoreCommentReplyFocus(context?.threadId, context?.replyId, anchor)
  },

  onCommentReactionOutside(event) {
    const insideMenu = event.target?.closest?.('.lark-doc-comment-more-menu, .lark-doc-comment-reply-menu')
    const trigger = this._commentMoreMenuAnchor?.contains?.(event.target) || this._commentReplyMenuAnchor?.contains?.(event.target)
    if ((this.commentMoreThreadId || this.commentMenuThreadId) && !insideMenu && !trigger) this.closeCommentMenus()
    if (!this.commentReactionContext) return
    const target = event.target
    if (target && typeof target.closest === 'function' && target.closest('.lark-doc-comment-reaction-picker')) return
    this.closeCommentReaction()
  },
  onCommentReactionKeydown(event) {
    if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229) return
    const root = this.$refs?.root || this.$el
    const tree = root?.getRootNode?.()
    let target = event.target?.nodeType ? event.target : tree?.activeElement || root?.ownerDocument?.activeElement
    // A closed shadow hides its input from the window's composed path.
    for (let boundary = tree; boundary?.host; boundary = boundary.host.getRootNode?.()) {
      if (target === boundary.host && tree.activeElement) { target = tree.activeElement; break }
    }
    while (target?.shadowRoot?.activeElement) target = target.shadowRoot.activeElement
    const input = (event.composedPath?.() || []).find(node => typeof node?.__larkDocCommentComposition === 'function') || target?.closest?.('.lark-doc-comment-rich-input')
    if (input?.__larkDocCommentComposition?.(event)) return
    if (event.key === 'Escape' && root && target && target !== root.ownerDocument?.body && target !== root.ownerDocument?.documentElement &&
        !root.contains(target) && !event.composedPath?.().includes(root)) {
      if (this.commentImageViewer) this.closeCommentImage()
      if (this.commentMoreThreadId || this.commentMenuThreadId || this.commentReactionContext) this.closeCommentMenus()
      return
    }
    if (this.commentImageViewer && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.closeCommentImage(true); return }
    if (event.key === 'Escape' && (this.commentMoreThreadId || this.commentMenuThreadId)) {
      const anchor = this._commentMoreMenuAnchor || this._commentReplyMenuAnchor
      const threadId = this.commentMenuThreadId, replyId = this.commentMenuCommentId
      event.preventDefault(); event.stopPropagation(); this.closeCommentMenus(); this.restoreCommentReplyFocus(threadId, replyId, anchor); return
    }
    if (!this.commentReactionContext || event.key !== 'Escape') return
    event.preventDefault(); event.stopPropagation(); this.closeCommentReaction(true)
  },











  async loadCommentFollowPreference(threadId) {
    const provider = this.commentProvider()
    if (!provider || !provider.isRemote || !this.commentCan('canView')) return null
    this.$set(this.commentFollowPreferences, threadId, null)
    const generation = this.commentLoadGeneration
    const readGeneration = ++this.commentFollowReadGeneration
    const current = () => !this.commentDisposed && generation === this.commentLoadGeneration && readGeneration === this.commentFollowReadGeneration && provider === this.commentProvider() && this.commentCan('canView')
    try {
      const preference = this.session && typeof this.session.getCommentFollowPreference === 'function'
        ? await this.session.getCommentFollowPreference(threadId) : await provider.getFollowPreference(threadId)
      if (!current()) return null
      this.$set(this.commentFollowPreferences, threadId, preference)
      return preference
    } catch (error) {
      if (!current()) return null
      await this.clearUnavailableCommentView(error)
      if (current()) this.commentMessage = '评论不可见或当前无权访问。'
      return null
    }
  },
}
