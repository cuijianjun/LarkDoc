/* global globalThis */
// Lazy image actions only; current identity/scope guards and synchronous abort/revoke remain in commentsMixin.
export async function uploadCommentImageFiles(scope, event) {
  const files = Array.from(event.target.files || []); event.target.value = ''
  if (!this.commentCanUploadImage(scope) || !files.length) return
  if (files.length + this.commentDraftImages(scope).length > 9) { this.commentMessage = '每条评论最多添加 9 张图片。'; return }
  const generation = this.commentImageGeneration, current = this.commentOperationCurrent(), port = this.session.getProvider('assets')
  const draftGeneration = this.commentImageDraftGenerations[scope] || 0
  const context = scope === 'selection' ? this.commentComposerContext : scope.startsWith('edit/') ? this.commentEditingReply : null
  const owned = () => current() && port === this.session?.getProvider?.('assets')
  const scopeCurrent = () => owned() && generation === this.commentImageGeneration && this.commentImageScopeCurrent(scope, draftGeneration, context)
  this.commentImageBusy = true; this.commentMessage = ''
  const controller = new AbortController(); this._commentImageUploadController = controller; this._commentImageUploadScope = scope
  let active
  try {
    for (const file of files) {
      if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type) || file.size < 1 || file.size > 20 * 1024 * 1024) throw new Error('请选择 20 MB 以内的 PNG、JPEG、GIF 或 WebP 图片。')
      const newId = () => 'image-' + Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')
      active = { operationId: newId(), beginOperationId: newId(), scope }
      this._commentImageInFlight = active
      const result = await this.session.uploadCommentImage({ file, operationId: active.operationId, beginOperationId: active.beginOperationId, signal: controller.signal })
      if (!scopeCurrent()) {
        if (owned() && this.commentPendingImage?.operationId === active.operationId && result.status === 'committed') { this.commentPendingImage = null; this.commentMessage = '原图片上传已确认，已取消的草稿没有恢复。' }
        return
      }
      this._commentImageInFlight = null
      const asset = result.asset
      if (result.status !== 'committed' || !result.ready || !asset?.ready || !asset.mimeType.startsWith('image/')) throw new Error('图片尚未取得可用确认。')
      this.$set(this.commentImageDrafts, scope, [...this.commentDraftImages(scope), { assetId: result.assetId, fileName: asset.fileName, mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes, checksum: asset.checksum, previewUrl: URL.createObjectURL(file), previewOwned: true }])
    }
  } catch (error) {
    if (!owned()) return
    if (error.submitted === false && active && [active.operationId, active.beginOperationId].includes(this.commentPendingImage?.operationId)) this.commentPendingImage = null
    if (error.submitted !== false && ['unknown', 'pending'].includes(error.status) && error.operationId) {
      const original = { operationId: error.operationId, kind: error.operationId === error.beginOperationId ? 'begin' : 'complete' }
      if (scopeCurrent()) this.commentPendingImage = { ...original, scope, draftGeneration, context }
      else if (active && [active.operationId, active.beginOperationId].includes(this.commentPendingImage?.operationId)) this.commentPendingImage = { ...original, scope: null }
    }
    if (generation === this.commentImageGeneration) this.commentMessage = this.commentPendingImage ? '图片上传结果尚未确认，请查询原操作。' : error.code === 'ASSET_CANCELLED' ? '已取消图片上传。' : error.httpStatus === 413 || error.status === 413 ? '图片超出当前上传限制，请选择较小的图片。' : error.message
  } finally { if (generation === this.commentImageGeneration) { this.commentImageBusy = false; this._commentImageUploadController = null; this._commentImageInFlight = null; this._commentImageUploadScope = '' } }
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
