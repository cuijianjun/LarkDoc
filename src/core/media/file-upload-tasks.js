import { createUploadProvider, uploadError, UPLOAD_ERROR, isAbortError } from './upload'
import { sortFileFiles, fileBlockAttrs, fileKindOf, FILE_KIND, safeFileUrl } from './file-block'
import { nearestInsertPosition } from './image-insert'
import { createBlockId, safeAttachmentId } from '../documentOperations'
import { closeHistory } from '@tiptap/pm/history'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

const policy = {
  validate(file, limits) {
    const rejected = sortFileFiles([file], { maxSize: limits?.maxSize }).rejected[0]
    if (rejected) throw uploadError(UPLOAD_ERROR.SIZE, rejected.message)
    if (Array.isArray(limits?.mime) && !limits.mime.includes(file.type)) throw uploadError(UPLOAD_ERROR.MIME, '文件类型不符合上传配置')
  },
  normalize(result, file) {
    const attrs = fileBlockAttrs(file, result || {})
    if (!safeAttachmentId(attrs.token) && !safeFileUrl(attrs.src)) throw uploadError(UPLOAD_ERROR.RESULT, '文件上传未返回有效地址或附件 ID')
    return result
  },
}

const OVERLAY_CLASS = 'lark-doc-file-uploading'

function createUploadingOverlay(ownerDocument, file, onCancel) {
  const el = (tag, className, text) => {
    const node = ownerDocument.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }
  const root = el('div', OVERLAY_CLASS)
  const video = fileKindOf(file.type) === FILE_KIND.VIDEO
  if (video) root.classList.add('is-video')
  root.setAttribute('data-lark-doc-file-ui', '')
  const meta = el('span', `${OVERLAY_CLASS}-meta`, '上传中 0%')
  const track = el('div', `${OVERLAY_CLASS}-track`)
  track.setAttribute('role', 'progressbar')
  track.setAttribute('aria-valuemin', '0')
  track.setAttribute('aria-valuemax', '100')
  track.setAttribute('aria-valuenow', '0')
  track.setAttribute('aria-label', `正在上传 ${file.name || '文件'}`)
  const fill = el('div', `${OVERLAY_CLASS}-fill`)
  track.appendChild(fill)
  root.appendChild(meta)
  root.appendChild(track)
  const cancel = el('button', `${OVERLAY_CLASS}-cancel`, '取消上传')
  cancel.setAttribute('type', 'button')
  cancel.setAttribute('data-lark-doc-file-ui', '')
  cancel.addEventListener('click', (event) => { event.stopPropagation(); onCancel?.() })
  root.appendChild(cancel)
  root.dataset.state = 'idle' // idle | uploading | done
  let percent = 0
  return {
    el: root,
    /** 只碰宽度 / 文案 / 状态；不触发 NodeView 更新，也不进事务。 */
    update(next) {
      const value = Math.max(0, Math.min(100, Math.round(Number(next) || 0)))
      if (value === percent) return
      percent = value
      fill.style.width = `${value}%`
      meta.textContent = `上传中 ${value}%`
      track.setAttribute('aria-valuenow', String(value))
      root.dataset.state = value >= 100 ? 'done' : value > 0 ? 'uploading' : 'idle'
    },
  }
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
  const key = new PluginKey('fileUploadProgress')
  editor.registerPlugin(new Plugin({
    key,
    state: {
      init: () => DecorationSet.empty,
      apply(transaction, previous) {
        const decorations = previous.map(transaction.mapping, transaction.doc)
        const { add, remove } = transaction.getMeta(key) || {}
        if (add) return decorations.add(transaction.doc, [add])
        if (remove) return decorations.remove(decorations.find(undefined, undefined, spec => spec.batch === remove))
        return decorations
      },
    },
    props: { decorations: state => key.getState(state) },
  }))
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
    dispose() {
      disposed = true
      cancelAll('destroy')
      editor.off('transaction', onTransaction)
      if (!editor.isDestroyed) editor.unregisterPlugin(key)
    },
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
      const identity = session?._identityGeneration
      const actor = session?._privateIdentityGeneration
      const authorization = session?._authorizationGeneration
      const resumeScope = [ownerId, scope, identity, actor, authorization].join(':')
      const sameOwner = () => !session?._destroyed && session?._identityGeneration === identity && session?._privateIdentityGeneration === actor &&
        session?._authorizationGeneration === authorization
      const retire = () => { if (!sameOwner()) batch.abort.abort('identity-change') }
      const ownerStops = ['comments-reset', 'capabilities', 'identity'].map(event => session?.on?.(event, retire))
      const ownerDocument = editor.view.dom.ownerDocument
      const placeholder = ownerDocument.createElement('div')
      placeholder.contentEditable = 'false'
      const tasks = accepted.map(file => {
        const controller = new AbortController()
        const ui = createUploadingOverlay(ownerDocument, file, () => controller.abort('cancelled'))
        controller.signal.addEventListener('abort', () => ui.el.remove(), { once: true })
        placeholder.appendChild(ui.el)
        return { file, controller, ui }
      })
      batch.abort.signal.addEventListener('abort', () => {
        for (const task of tasks) task.controller.abort(batch.abort.signal.reason)
      }, { once: true })
      batches.add(batch)
      const current = () => !disposed && !editor.isDestroyed && !batch.abort.signal.aborted && host.editor === editor && host.writable() &&
        host.featureEnabled('files') && host.session === session && host.documentId === documentId && session?.documentId === sessionDocumentId && source() === input && sameOwner()
      const results = new Array(accepted.length)
      let next = 0
      const worker = async () => {
        while (current() && next < accepted.length) {
          const index = next++
          const { file, controller, ui } = tasks[index]
          if (controller.signal.aborted) continue
          try {
            const result = await provider.upload(file, { taskId: `file-${createBlockId()}`, source: 'select', documentId: sessionDocumentId ?? documentId,
              resumeScope,
              signal: controller.signal, onProgress: event => ui.update(event.percent),
              limits: { maxSize: host.effectiveFileMaxSize } })
            if (current() && !controller.signal.aborted) { policy.validate(file, { maxSize: host.effectiveFileMaxSize }); policy.normalize(result, file); results[index] = fileBlockAttrs(file, result) }
          } catch (error) {
            ui.el.remove()
            if (current() && !isAbortError(error)) host.error = error?.message || '文件上传失败'
          }
        }
      }
      const prior = tail
      let release
      tail = new Promise(resolve => { release = resolve })
      try {
        const position = editor.state.doc.resolve(batch.anchor).after()
        const widget = Decoration.widget(position, placeholder, { batch, stopEvent: () => true })
        editor.view.dispatch(editor.state.tr.setMeta(key, { add: widget }))
        await prior
        if (!current()) return
        const concurrency = Math.min(3, Math.max(1, Math.floor(Number(input.concurrency) || 1)))
        await Promise.all(Array.from({ length: Math.min(concurrency, accepted.length) }, worker))
        const completed = results.filter((result, index) => result && !tasks[index].controller.signal.aborted)
        if (!current() || !completed.length) return
        const bookmark = editor.state.selection.getBookmark()
        batch.inserting = true
        stopCapturing()
        let chain = editor.chain().setTextSelection(batch.anchor)
        for (const attrs of completed) chain = chain.setFileBlock(attrs)
        chain.command(({ tr }) => { closeHistory(tr); tr.setSelection(bookmark.map(tr.mapping).resolve(tr.doc)); return true }).run()
        stopCapturing()
        editor.view.dispatch(closeHistory(editor.state.tr).setMeta('addToHistory', false))
      } finally {
        ownerStops.forEach(stop => stop?.())
        batches.delete(batch)
        release()
        if (!disposed && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(key, { remove: batch }))
      }
    },
  }
}
