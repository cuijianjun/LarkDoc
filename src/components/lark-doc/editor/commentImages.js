/* global globalThis */
// 评论图片走宿主的 uploader / uploadImage（与正文插图同一条传输），不经过 assets Provider。
import { normalizeUploader, validateUploadFile, isAbortError } from '../../../core/media/upload'
import { createImageViewer } from '../../../core/nodeviews/image-viewer'
import { createNetworkPolicy } from '../../../core/policy/network'

const COMMENT_IMAGE_MIME = ['image/gif', 'image/jpg', 'image/jpeg', 'image/bmp', 'image/png']
export const COMMENT_IMAGE_ACCEPT = COMMENT_IMAGE_MIME.join(',')

export async function uploadCommentImageFiles(scope, event) {
  const files = Array.from(event.target.files || []); event.target.value = ''
  return this.addCommentAttachments(scope, files)
}

/** 草稿作用域是否还归属同一个可写的评论位（线程仍未解决 / 编辑器仍开着）。 */
function commentImageScopeOpen(ed, scope) {
  if (scope === 'document') return true
  if (scope === 'selection') return ed.commentComposerOpen === true
  if (typeof scope === 'string' && scope.startsWith('edit/')) {
    const [, threadId, replyId] = scope.split('/')
    return ed.commentEditingReply?.threadId === threadId && ed.commentEditingReply?.replyId === replyId
  }
  return (ed.commentThreads || []).some(thread => thread.id === scope && !thread.resolved && !thread.tombstone)
}

export async function addCommentAttachments(scope, files) {
  if (!this.commentCanAttach()) { this.commentMessage = '当前评论服务不支持图片或没有评论权限'; return false }
  if (!commentImageScopeOpen(this, scope)) return false
  if (!this._commentAttachmentTasks) this._commentAttachmentTasks = new Map()
  const ids = []
  const input = this.uploader || this.uploadImage, provider = this.commentProvider?.(), session = this.session, editor = this.editor
  const network = JSON.stringify(this.larkDocConfig?.network || {})
  const batch = { ids, scope, invalidated: false }
  batch.current = () => !batch.invalidated && this.editor === editor && !editor?.isDestroyed
    && this.session === session && this.commentProvider?.() === provider && (this.uploader || this.uploadImage) === input
    && JSON.stringify(this.larkDocConfig?.network || {}) === network && this.commentCanAttach()
    && commentImageScopeOpen(this, scope)
  for (const file of Array.from(files || [])) {
    const id = `comment-image-${this._commentAttachmentSeq = (this._commentAttachmentSeq || 0) + 1}`
    let previewUrl = ''
    try { validateUploadFile(file, { mime: COMMENT_IMAGE_MIME }); previewUrl = URL.createObjectURL?.(file) || '' } catch (_) { /* 校验失败的文件不预览，错误由上传路径给出 */ }
    this._commentAttachmentTasks.set(id, { file, scope, previewUrl, batch })
    this.$set(this.commentImageDrafts, scope, this.commentDraftImages(scope).concat([{ id, name: file.name, previewUrl, status: 'pending', progress: 0, error: '' }]))
    ids.push(id)
  }
  for (const id of ids) {
    if (!batch.current()) { stopCommentAttachmentBatch(this, batch); break }
    await this.retryCommentAttachment(scope, id, batch)
  }
  return ids.length > 0
}

/** 上下文变了就整批停下：在飞的 abort，没发的标错误等用户手动重试。 */
function stopCommentAttachmentBatch(ed, batch) {
  if (!batch || batch.invalidated) return
  batch.invalidated = true
  const stopped = new Set()
  batch.ids.forEach(id => {
    const task = ed._commentAttachmentTasks?.get(id)
    if (task?.batch !== batch) return
    task.controller?.abort('batch-context-change')
    stopped.add(id)
  })
  if (stopped.size) ed.$set(ed.commentImageDrafts, batch.scope, ed.commentDraftImages(batch.scope).map(item => stopped.has(item.id) && (item.status === 'pending' || item.status === 'uploading')
    ? { ...item, status: 'error', error: '上传上下文已改变，请手动重试' } : item))
}

export async function retryCommentAttachment(scope, id, batch = null) {
  const task = this._commentAttachmentTasks?.get(id)
  if (!task || (task.controller && !task.controller.signal.aborted && task.running) || !this.commentCanAttach()) return false
  if (batch && (task.batch !== batch || !batch.current())) return false
  task.batch = batch
  const input = this.uploader || this.uploadImage
  const provider = this.commentProvider?.(), session = this.session, editor = this.editor
  const network = createNetworkPolicy(this.larkDocConfig?.network)
  const update = patch => {
    const list = this.commentDraftImages(scope)
    if (!list.some(image => image.id === id)) return
    this.$set(this.commentImageDrafts, scope, list.map(image => image.id === id ? { ...image, ...patch } : image))
  }
  const controller = task.controller = new AbortController()
  task.running = true
  task.network = JSON.stringify(this.larkDocConfig?.network || {})
  const current = () => this._commentAttachmentTasks?.get(id) === task && !controller.signal.aborted && !editor?.isDestroyed
    && (!batch || batch.current()) && this.editor === editor && this.session === session && this.commentProvider?.() === provider
    && this.commentCanAttach() && (this.uploader || this.uploadImage) === input
    && JSON.stringify(this.larkDocConfig?.network || {}) === task.network && commentImageScopeOpen(this, scope)
  task.current = current
  update({ status: 'uploading', progress: 0, error: '' })
  try {
    // 不认识的目标不能靠白名单确认：只有宿主显式声明 offline，或给了可校验的 HTTP action 才放行。
    if (input && network.mode !== 'open' && input.offline !== true && !(typeof input.action === 'string' && network.allows(input.action))) throw new Error('当前网络策略未允许评论图片上传服务')
    if (this._commentUploaderInput !== input || !this._commentUploader) {
      this._commentUploader = normalizeUploader(input, { limits: null })
      this._commentUploaderInput = input
    }
    if (!current()) {
      if (batch) stopCommentAttachmentBatch(this, batch)
      else update({ status: 'error', error: '原评论或上传上下文已改变，请重新打开评论后重试' })
      return false
    }
    const uploaded = await this._commentUploader.upload(task.file, {
      documentId: session?.documentId || '', source: 'comment', signal: controller.signal,
      limits: { maxSize: this.larkDocConfig?.limits?.maxImageSize, mime: COMMENT_IMAGE_MIME },
      onProgress: event => { if (current()) update({ progress: event.percent || 0 }) },
    })
    if (!current()) return false
    if (!uploaded?.url) throw new Error('图片上传未返回可用地址')
    if (!network.allows(uploaded.url)) throw new Error('评论图片被当前网络策略拦截')
    update({ status: 'ready', progress: 100, attachment: uploaded, assetId: uploaded.assetId || uploaded.id || '', previewUrl: '' })
    if (task.previewUrl) { URL.revokeObjectURL(task.previewUrl); task.previewUrl = '' }
    return true
  } catch (error) {
    if (current()) update({ status: 'error', error: isAbortError(error) ? '图片上传已取消，可重试' : error?.message || '图片上传失败，请重试' })
    return false
  } finally {
    if (task.controller === controller) {
      task.running = false
      if (this._commentAttachmentTasks?.get(id) === task && this.commentDraftImages(scope).some(image => image.id === id && image.status === 'uploading')) update({ status: 'error', error: '上传未完成，权限或文档状态可能已改变，请重试' })
    }
  }
}

/**
 * 已存附件预览 —— 用正文同一套 `createImageViewer`（`role=dialog[aria-label=图片预览]`、
 * `.lark-doc-image-viewer-*`），宿主与评论卡同层。基线的评论图片预览就是这条链路，
 * 不复用 dev 自造的卡片内小预览。
 */
export function previewCommentAttachment(threadId, replyId, index) {
  if (!this.commentCan('canView')) return false
  const thread = this.commentThreads?.find(item => item.id === threadId && !item.tombstone)
  const reply = thread?.replies?.find(item => item.id === replyId && !item.tombstone)
  const images = []
  let target = -1
  for (const [position, asset] of (reply?.attachments || []).entries()) {
    if (!asset?.url) continue
    if (position === index) target = images.length
    images.push({ src: asset.url, name: asset.name || asset.fileName || '评论图片' })
  }
  if (!images.length) return false
  closeCommentAttachmentViewer.call(this)
  const viewer = createImageViewer({
    host: this.$refs?.panelHost || this.$el,
    images, index: Math.max(0, target), initialScale: 1,
    onClose: () => { if (this._commentAttachmentViewer === viewer) this._commentAttachmentViewer = null },
  })
  if (!viewer) return false
  this._commentAttachmentViewer = viewer
  // 切文档时 `retireImageViewers()` 会一并关掉；只登记一次，避免集合随打开次数膨胀。
  if (this._imageViewerRetire && !this._commentAttachmentRetire) {
    this._commentAttachmentRetire = () => closeCommentAttachmentViewer.call(this)
    this._imageViewerRetire.add(this._commentAttachmentRetire)
  }
  return true
}

export function closeCommentAttachmentViewer() {
  const viewer = this._commentAttachmentViewer
  this._commentAttachmentViewer = null
  if (this._commentAttachmentRetire) {
    this._imageViewerRetire?.delete(this._commentAttachmentRetire)
    this._commentAttachmentRetire = null
  }
  if (viewer) viewer.destroy(false)
  return !!viewer
}

export async function queryPendingCommentImage() {
  const pending = this.commentPendingImage
  if (!pending || this.commentImageBusy || !this.commentCan('canView')) return
  const generation = this.commentImageGeneration; this.commentImageBusy = true
  try {
    const result = await this.session.queryAssetOperation({ operationId: pending.operationId, kind: pending.kind })
    if (generation !== this.commentImageGeneration || this.commentPendingImage !== pending) return
    if (result.status !== 'committed' || result.operation !== pending.kind) { this.commentMessage = '原图片操作仍未确认，请稍后查询。'; return }
    this.commentPendingImage = null
    if (pending.kind === 'complete' && result.ready && pending.scope && this.commentImageScopeCurrent(pending.scope, pending.draftGeneration, pending.context)) {
      const asset = result.asset
      if (!this.commentDraftImages(pending.scope).some(image => image.assetId === asset.assetId) && this.commentDraftImages(pending.scope).length < 9) this.$set(this.commentImageDrafts, pending.scope, [...this.commentDraftImages(pending.scope), { ...asset }])
      this.commentMessage = '原图片上传已确认，可以发送评论。'
    } else this.commentMessage = '原图片操作已确认，已取消的草稿没有恢复。'
  } catch (error) { if (generation === this.commentImageGeneration) this.commentMessage = error.message }
  finally { if (generation === this.commentImageGeneration) this.commentImageBusy = false }
}

export async function loadCommentImage({ asset, session, entry, thread, reply, current, key }) {
  const chunks = []; let length = 0
  if (Number(asset.sizeBytes) > 20 * 1024 * 1024) throw new Error('图片超出预览大小限制')
  const result = await session.getAssetContent({ assetId: asset.assetId, comment: { threadId: thread.id, replyId: reply.id, replyRevision: reply.replyRevision }, signal: entry.controller.signal,
    onChunk: (bytes, meta) => { if (!current()) throw new Error('COMMENT_IMAGE_CONTEXT_CHANGED'); length += bytes.length; if (meta.mimeType !== asset.mimeType || length > Number(asset.sizeBytes)) throw new Error('图片校验失败'); chunks.push(new Uint8Array(bytes)) } })
  if (!current()) return
  if (result.status !== 'completed' || result.mimeType !== asset.mimeType || String(length) !== asset.sizeBytes) throw new Error('图片校验失败')
  const bytes = new Uint8Array(length); let offset = 0; chunks.forEach(chunk => { bytes.set(chunk, offset); offset += chunk.length })
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))
  if (!current()) return
  if ('sha256:' + Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('') !== asset.checksum) throw new Error('图片校验失败')
  entry.url = URL.createObjectURL(new Blob([bytes], { type: asset.mimeType })); this.$set(this.commentImageUrls, key, entry.url); this.$nextTick(() => this.placeCommentPanels())
}
