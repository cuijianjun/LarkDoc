// 图片MIME/落点判定在core/media，组件只派发编辑器命令。
import { IMAGE_REJECT, imageRejectMessage, isImageMime, nearestInsertPosition, sortImageFiles } from '../../../core/media/image-insert'
// 文件/视频不限MIME且需宿主上传；core/media处理分流、落点和逐块插入。
import { fileBlockAttrs, sortFileFiles } from '../../../core/media/file-block'
import { safeAttachmentId, safeUrl } from '../../../core/documentOperations'
import { resolveUploadHandler, rejectUnavailableAssetUpload } from '../../../providers/upload'

// Capture before awaiting a host callback or local reader; keep borrowed plain-object host calls valid.
function captureUploadScope(vm) {
  const session = vm.session, editor = vm.editor, generation = session && session._assetGeneration, componentGeneration = vm.uploadScopeGeneration
  const identity = session && session.user && session.user.id, user = vm.user && vm.user.id
  return () => !vm._isDestroyed && !vm._isBeingDestroyed && !vm._disposed && vm.session === session && vm.editor === editor && componentGeneration === vm.uploadScopeGeneration &&
    !(editor && editor.isDestroyed) && !(session && session._destroyed) && generation === (session && session._assetGeneration) &&
    identity === (session && session.user && session.user.id) && user === (vm.user && vm.user.id) && vm.writable()
}

// Remote nodes require the complete assets port; a legacy host URL cannot stand in for durable ready.
function remoteAssetUpload(vm) {
  const session = vm.session, assets = session?.getProvider?.('assets'), authorization = session?.getProvider?.('authorization')
  if (!assets?.isRemote && !assets?.requiresDurableConfirmation && !authorization?.isRemote) return null
  return async file => {
    if (!assets?.requiresDurableConfirmation || typeof assets.upload !== 'function' || typeof session.uploadAssetFile !== 'function') return rejectUnavailableAssetUpload(session, file)
    const result = await session.uploadAssetFile({ file })
    if (result?.status !== 'committed' || result.persisted !== true || result.ready !== true || result.objectVerified !== true ||
      !result.asset?.ready || !result.asset.objectVerified || result.assetId !== result.asset.assetId || result.attchId !== result.assetId || result.token !== result.assetId) {
      throw Object.assign(new Error('附件尚未取得真实可用确认，请查询原上传操作。'), { code: 'ASSET_UPLOAD_NOT_READY', status: result?.status || 'unknown', operationId: result?.operationId, result })
    }
    return result
  }
}

export default {
  data() { return { uploadScopeGeneration: 0 } },
  watch: { session: { sync: true, handler() { this.uploadScopeGeneration++ } } },
  methods: {
    async resolveImageFile(file) {
      // Keep the imperative upload boundary compatible with older ECS hosts
      // that call the method with a small plain object instead of a Vue vm.
      const imagesEnabled = typeof this.featureEnabled === 'function' ? this.featureEnabled('images') : true
      const maxImageSize = this.effectiveImageMaxSize !== undefined
        ? this.effectiveImageMaxSize
        : Math.max(1, Number(this.imageMaxSize) || 5 * 1024 * 1024)
      if (!this.writable() || !imagesEnabled) return null
      const current = captureUploadScope(this)
      if (!isImageMime(file.type)) throw new Error(imageRejectMessage(IMAGE_REJECT.MIME))
      if (file.size > maxImageSize) throw new Error(imageRejectMessage(IMAGE_REJECT.SIZE, { maxSize: maxImageSize }))
      try {
        const upload = remoteAssetUpload(this) || resolveUploadHandler(this.uploadImage)
        if (this.uploadImage && !upload) throw new Error('图片上传配置缺少有效upload方法')
        if (upload) {
          const uploaded = await upload(file)
          if (!current()) return null
          const attchId = typeof uploaded?.attchId === 'string' || Number.isFinite(uploaded?.attchId) ? String(uploaded.attchId) : null
          if (!safeUrl(uploaded?.url, true) || !safeAttachmentId(attchId)) throw new Error('图片上传未返回有效地址或附件 ID')
          return { src: uploaded.url, attchId }
        }
        const authorization = this.session && typeof this.session.getProvider === 'function' ? this.session.getProvider('authorization') : null
        if (authorization && authorization.isRemote) return await rejectUnavailableAssetUpload(this.session, file)
        const src = await new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result)
          reader.onerror = () => reject(new Error('本地图片读取失败'))
          reader.readAsDataURL(file)
        })
        if (!current()) return null
        if (!safeUrl(src, true)) throw new Error('本地图片格式无效')
        return { src, attchId: null }
      } catch (error) { if (!current()) return null; throw error }
    },
    async insertImageFiles(files, pos) {
      if (!this.writable() || !this.featureEnabled('images')) return
      const current = captureUploadScope(this)
      // 一次拖拽 / 粘贴可能混进非图片（PDF 与 PNG 一起框选是常见操作）：
      // 先分流，非图片只报一条错、不阻断，剩下的图片按原顺序逐张落块。
      const { accepted, rejected } = sortImageFiles(files, { maxSize: this.effectiveImageMaxSize })
      if (!accepted.length) { if (rejected.length) this.error = rejected[0].message; return }
      this.error = rejected.length ? rejected[0].message : ''
      // 拖拽给的 pos 可能落在块边界（拖到两块之间）或文档之外，先归一成能安全
      // setTextSelection 的文本位置；没有 pos / 归一失败时按当前选区插入。
      let anchor = Number.isInteger(pos) ? nearestInsertPosition(this.editor.state.doc, pos) : null
      for (const file of accepted) {
        if (!current()) return
        try {
          const image = await this.resolveImageFile(file)
          // 上传期间文档可能被切只读或组件已卸载：停止后续插入，已完成的不回滚。
          if (!current()) return
          if (!image) continue
          if (anchor !== null) this.editor.commands.setTextSelection(anchor)
          this.editor.chain().focus().setImage({ ...image, originalSrc: image.src, originalAttchId: image.attchId, alt: file.name }).run()
          // 下一张必须接在刚插入的这张之后，否则多张图会全堆在第一张的位置上。
          if (anchor !== null) anchor = this.editor.state.selection.to
        } catch (error) { if (!current()) return; this.error = error?.message || '图片上传失败' }
      }
    },
    /**
     * 文件 / 视频的上传边界（P2-04）。
     *
     * 与 resolveImageFile 的关键差异：**没有 FileReader 兜底**。10 GB 上限的附件
     * 不可能内联成 data URI，所以没配 uploadFile 就直接报错——宁可不落块，
     * 也不产生一个「有壳没内容」的半截块。
     */
    async resolveFile(file) {
      const filesEnabled = typeof this.featureEnabled === 'function' ? this.featureEnabled('files') : true
      if (!this.writable() || !filesEnabled) return null
      const current = captureUploadScope(this)
      try {
        const upload = remoteAssetUpload(this) || resolveUploadHandler(this.uploadFile)
        if (!upload) {
          const authorization = this.session && typeof this.session.getProvider === 'function' ? this.session.getProvider('authorization') : null
          if (authorization && authorization.isRemote) return await rejectUnavailableAssetUpload(this.session, file)
          throw new Error('未配置文件上传：请通过 uploadFile 传入上传实现')
        }
        const uploaded = await upload(file)
        if (!current()) return null
        const attrs = fileBlockAttrs(file, uploaded || {})
        // token 与 src 至少有一个，块才渲染得出来（02 §19.5 ⑤ 的字段契约）。
        if (!safeAttachmentId(attrs.token) && !(attrs.src && safeUrl(attrs.src, true))) {
          throw new Error('文件上传未返回有效地址或附件 ID')
        }
        return attrs
      } catch (error) { if (!current()) return null; throw error }
    },
    async insertFileBlocks(files, pos) {
      if (!this.writable() || !this.featureEnabled('files')) return
      const current = captureUploadScope(this)
      const { accepted, rejected } = sortFileFiles(files, { maxSize: this.effectiveFileMaxSize })
      if (!accepted.length) { if (rejected.length) this.error = rejected[0].message; return }
      // 有被拒的也照样插能插的：一条 toast 说清原因，不阻断其余文件。
      this.error = rejected.length ? rejected[0].message : ''
      let anchor = Number.isInteger(pos) ? nearestInsertPosition(this.editor.state.doc, pos) : null
      for (const file of accepted) {
        if (!current()) return
        try {
          const attrs = await this.resolveFile(file)
          if (!current()) return
          if (!attrs) continue
          if (anchor !== null) this.editor.commands.setTextSelection(anchor)
          this.editor.chain().focus().setFileBlock(attrs).run()
          // 下一个必须接在刚落的块之后，否则多选的文件会全堆在同一个位置。
          if (anchor !== null) anchor = this.editor.state.selection.to
        } catch (error) { if (!current()) return; this.error = error?.message || '文件上传失败' }
      }
    },
  },
}
