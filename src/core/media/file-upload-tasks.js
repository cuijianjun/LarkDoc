import { createUploadProvider, uploadError, UPLOAD_ERROR, isAbortError } from './upload'
import { sortFileFiles, fileBlockAttrs } from './file-block'
import { nearestInsertPosition } from './image-insert'
import { createBlockId, safeAttachmentId, safeUrl } from '../documentOperations'
import { closeHistory } from '@tiptap/pm/history'

const policy = {
  validate(file, limits) {
    const rejected = sortFileFiles([file], { maxSize: limits?.maxSize }).rejected[0]
    if (rejected) throw uploadError(UPLOAD_ERROR.SIZE, rejected.message)
    if (Array.isArray(limits?.mime) && !limits.mime.includes(file.type)) throw uploadError(UPLOAD_ERROR.MIME, '文件类型不符合上传配置')
  },
  normalize(result, file) {
    const attrs = fileBlockAttrs(file, result || {})
    if (!safeAttachmentId(attrs.token) && !(attrs.src && safeUrl(attrs.src, true))) throw uploadError(UPLOAD_ERROR.RESULT, '文件上传未返回有效地址或附件 ID')
    return result
  },
}

// Each editor owns its signals and anchors. A shared provider keeps ownership
// of its own task IDs and resume records; never cancelAll on that provider.
export function createFileUploadTasks(host) {
  const batches = new Set(), providers = new WeakMap()
  const ownerId = createBlockId()
  let disposed = false, scope = 0, tail = Promise.resolve()
  const source = () => host.uploadFile || host.uploader
  const providerFor = input => {
    if (!(typeof input === 'function' || input && typeof input.upload === 'function')) throw new Error('未配置文件上传：请通过 uploadFile 传入上传实现')
    if (input[Symbol.for('lark-doc.uploadProvider')] !== undefined) return input
    if (!providers.has(input)) {
      const options = typeof input === 'function' ? { upload: input } : input
      providers.set(input, createUploadProvider({ ...options, limits: options.limits ?? null,
        retry: { attempts: 1, ...options.retry }, upload: options.upload.bind(options) }, policy))
    }
    return providers.get(input)
  }
  const cancelAll = (reason = 'cancelled') => {
    for (const batch of batches) batch.abort.abort(reason)
    if (reason === 'document-change' || reason === 'destroy') scope++
  }
  const editor = host.editor
  const stopCapturing = () => editor.state.plugins.forEach(plugin => plugin.getState(editor.state)?.undoManager?.stopCapturing?.())
  const onTransaction = ({ transaction }) => {
    if (!transaction.docChanged) return
    for (const batch of batches) {
      if (batch.inserting) continue
      const mapped = transaction.mapping.mapResult(batch.anchor, 1)
      if (mapped.deleted) batch.abort.abort('anchor-removed')
      else batch.anchor = mapped.pos
    }
  }
  editor.on('transaction', onTransaction)
  return {
    cancelAll,
    dispose() { disposed = true; cancelAll('destroy'); editor.off('transaction', onTransaction) },
    async insert(files, pos) {
      if (disposed || !host.writable() || !host.featureEnabled('files')) return
      const { accepted, rejected } = sortFileFiles(files, { maxSize: host.effectiveFileMaxSize })
      host.error = rejected[0]?.message || ''
      if (!accepted.length) return
      const input = source(), session = host.session, documentId = host.documentId, sessionDocumentId = session?.documentId
      let provider
      try { provider = providerFor(input) } catch (error) { host.error = error.message; return }
      const batch = { abort: new AbortController(), anchor: nearestInsertPosition(editor.state.doc, Number.isInteger(pos) ? pos : editor.state.selection.to), inserting: false }
      if (batch.anchor === null) return
      batches.add(batch)
      const current = () => !disposed && !editor.isDestroyed && !batch.abort.signal.aborted && host.editor === editor && host.writable() &&
        host.featureEnabled('files') && host.session === session && host.documentId === documentId && session?.documentId === sessionDocumentId && source() === input
      const results = new Array(accepted.length)
      let next = 0
      const worker = async () => {
        while (current() && next < accepted.length) {
          const index = next++, file = accepted[index]
          try {
            const result = await provider.upload(file, { taskId: `file-${createBlockId()}`, source: 'select', documentId: sessionDocumentId ?? documentId,
              resumeScope: `${ownerId}:${scope}`,
              signal: batch.abort.signal, limits: { maxSize: host.effectiveFileMaxSize } })
            if (current()) { policy.validate(file, { maxSize: host.effectiveFileMaxSize }); policy.normalize(result, file); results[index] = fileBlockAttrs(file, result) }
          } catch (error) { if (current() && !isAbortError(error)) host.error = error?.message || '文件上传失败' }
        }
      }
      const prior = tail
      let release
      tail = new Promise(resolve => { release = resolve })
      try {
        await prior
        if (!current()) return
        const concurrency = Math.min(3, Math.max(1, Math.floor(Number(input.concurrency) || 1)))
        await Promise.all(Array.from({ length: Math.min(concurrency, accepted.length) }, worker))
        const completed = results.filter(Boolean)
        if (!current() || !completed.length) return
        const bookmark = editor.state.selection.getBookmark()
        batch.inserting = true
        stopCapturing()
        let chain = editor.chain().setTextSelection(batch.anchor)
        for (const attrs of completed) chain = chain.setFileBlock(attrs)
        chain.command(({ tr }) => { closeHistory(tr); tr.setSelection(bookmark.map(tr.mapping).resolve(tr.doc)); return true }).run()
        stopCapturing()
        editor.view.dispatch(closeHistory(editor.state.tr).setMeta('addToHistory', false))
      } finally { batches.delete(batch); release() }
    },
  }
}
