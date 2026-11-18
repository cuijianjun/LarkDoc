import { createUploadProvider, uploadError, UPLOAD_ERROR, isAbortError } from './upload'
import { sortFileFiles, fileBlockAttrs, fileKindOf, FILE_KIND } from './file-block'
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

const OVERLAY_CLASS = 'lark-doc-file-uploading'
const UPLOADING_CLASS = 'is-uploading'

/**
 * 上传中覆盖层。
 *
 * 为什么是「直接改 DOM」而不是加进度属性/换一条事务：
 *   - 进度每秒可能来几十次，写事务等于每次都让 NodeView 重建一遍 iframe / video，
 *     大文件上传时整篇文档都在重排；直接改两个属性只要一次样式重算；
 *   - `fileBlock` 的 attrs 是 `test/fixtures/schema-v1.json` 里冻结的契约，
 *     往里塞 `uploading` / `percent` 要改契约，代价远大于收益。
 *
 * 所以占位节点本身只带 `name / size / mimeType / viewType`（都是已有字段），
 * 上方再盖一块纯展示的 DOM。节点 DOM 由 NodeView 管理，这里只 append 一个子元素，
 * `stopEvent` 认得 `data-lark-doc-file-ui`，点它不会打进 ProseMirror。
 */
function createUploadingOverlay(ownerDocument, file, onCancel) {
  const el = (tag, className, text) => {
    const node = ownerDocument.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }
  const root = el('div', OVERLAY_CLASS)
  /**
   * 视频盖的是**深底媒体卡**：视频块本体就是一块深色播放器，上传中用白底盖上去
   * 会先闪一下白、传完再跳回深色。kind 只读一次 `file.type`，不走 schema。
   */
  const video = fileKindOf(file.type) === FILE_KIND.VIDEO
  if (video) root.classList.add('is-video')
  root.setAttribute('data-lark-doc-file-ui', '')
  root.setAttribute('role', 'progressbar')
  root.setAttribute('aria-valuemin', '0')
  root.setAttribute('aria-valuemax', '100')
  root.setAttribute('aria-valuenow', '0')
  root.setAttribute('aria-label', `正在上传 ${file.name || '文件'}`)
  // 飞书上传卡（用户第四轮截图）：浅灰大卡 + 垂直居中的「上传中 X%」+ 进度条，
  //     进度条颜色随进度 0% 灰 → 进行中蓝 → 100% 绿，卡上不显示文件名。
  // 这里只搭结构；颜色/居中由 CSS 按 `data-state` 上色。
  const meta = el('span', `${OVERLAY_CLASS}-meta`, '上传中 0%')
  const track = el('div', `${OVERLAY_CLASS}-track`)
  const fill = el('div', `${OVERLAY_CLASS}-fill`)
  track.appendChild(fill)
  root.appendChild(meta)
  root.appendChild(track)
  // 飞书 `box.uploader.button.cancel = 取消上传`：上传中可取消，点了 abort 这一路并删占位。
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
      root.setAttribute('aria-valuenow', String(value))
      // 0% 灰、进行中蓝、100% 绿——飞书截图的三段配色。
      root.dataset.state = value >= 100 ? 'done' : value > 0 ? 'uploading' : 'idle'
    },
    destroy() { root.remove() },
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
  /**
   * 取消一批：批级 signal 取消「还没开始的分片」，任务级 signal 取消「正在飞的那一个」。
   *
   * 两个 signal 都要发 —— 上传请求拿的是任务级 signal（占位被删时要能单独掐掉一路），
   * 只 abort 批级那个的话，`cancelFileUploads` 之后在飞的请求会一直挂着，
   * `insert()` 的 Promise 也就永远不 settle（readonly / 切文档 / destroy 都是这条路径）。
   */
  const abortBatch = (batch, reason) => {
    if (!batch.abort.signal.aborted) batch.abort.abort(reason)
    for (const task of batch.tasks) if (!task.settled) task.controller.abort(reason)
  }
  const cancelAll = (reason = 'cancelled') => {
    for (const batch of batches) abortBatch(batch, reason)
    if (reason === 'document-change' || reason === 'destroy') scope++
  }
  const editor = host.editor
  const stopCapturing = () => editor.state.plugins.forEach(plugin => plugin.getState(editor.state)?.undoManager?.stopCapturing?.())

  /** 按 blockId 找占位节点位置。占位只活几秒，数量是个位数，直接遍历够用。 */
  const findPos = blockId => {
    let found = null
    editor.state.doc.descendants((node, pos) => {
      if (found !== null) return false
      if (node.type.name === 'fileBlock' && node.attrs.blockId === blockId) { found = pos; return false }
      return true
    })
    return found
  }
  /** 位置映射后先验一眼 —— 别把「别人的块」当成自己的占位改掉。 */
  const posOf = task => {
    const node = task.pos == null ? null : editor.state.doc.nodeAt(task.pos)
    if (node && node.type.name === 'fileBlock' && node.attrs.blockId === task.blockId) return task.pos
    task.pos = findPos(task.blockId)
    return task.pos
  }
  const attachOverlay = task => {
    const dom = task.pos == null ? null : editor.view.nodeDOM(task.pos)
    if (!dom || dom.nodeType !== 1 || !task.overlay) return
    dom.classList.add(UPLOADING_CLASS)
    // 视频换成紧凑媒体卡（CSS 里按 `data-upload-kind="video"` 收高、把进度条居中）。
    // 标在**块壳**上而不是覆盖层上：壳高得跟着上传态一起收，覆盖层才能垂直居中。
    if (fileKindOf(task.file?.type) === FILE_KIND.VIDEO) dom.setAttribute('data-upload-kind', 'video')
    dom.appendChild(task.overlay.el)
  }
  const releaseOverlay = task => {
    if (!task.overlay) return
    const dom = task.pos == null ? null : editor.view.nodeDOM(task.pos)
    if (dom && dom.nodeType === 1) {
      dom.classList.remove(UPLOADING_CLASS)
      dom.removeAttribute('data-upload-kind')
    }
    task.overlay.destroy()
    task.overlay = null
  }
  /**
   * 把占位滚进视口。
   *
   * 附件壳 453px 高，插在文档末尾时通常只露出小半截，进度条又画在壳里 —— 不滚过去，
   * 用户看到的仍然是「没反应」。`block: 'nearest'` 只在确实不可见时才滚，已经看得见
   * 就不动，免得把正在别处打字的用户拽走。等一帧是因为 NodeView 可能下一帧才挂上。
   */
  const revealPlaceholder = task => {
    if (!task || task.pos == null) return
    const run = () => {
      if (disposed) return
      const dom = editor.view.nodeDOM(task.pos)
      const node = dom && dom.nodeType === 1 ? dom : dom && dom.parentElement
      if (!node || typeof node.getBoundingClientRect !== 'function') return
      const view = editor.view.dom.ownerDocument.defaultView
      if (!view) return
      const box = node.getBoundingClientRect()
      // 量不出高度：NodeView 还没排版，或者环境里压根没有布局引擎（jsdom、SSR 预渲染）。
      // 这两种情况都无从判断「可不可见」，滚过去也多半滚错，放过更稳。
      if (!(box.height > 0)) return
      if (box.top >= 0 && box.bottom <= view.innerHeight) return
      if (typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' })
    }
    const view = editor.view.dom.ownerDocument.defaultView
    if (view && typeof view.requestAnimationFrame === 'function') view.requestAnimationFrame(run)
    else run()
  }

  const onTransaction = ({ transaction }) => {
    if (!transaction.docChanged) return
    for (const batch of batches) {
      if (batch.inserting) continue
      for (const task of batch.tasks) {
        if (task.settled || task.pos == null) continue
        const mapped = transaction.mapping.mapResult(task.pos, 1)
        task.pos = mapped.deletedAcross ? null : mapped.pos
        // 占位被删掉（用户按了退格 / 撤销）→ 取消这一路上传，别在别处补一块进来。
        if (posOf(task) == null) task.controller.abort('anchor-removed')
      }
    }
  }
  editor.on('transaction', onTransaction)
  return {
    cancelAll,
    dispose() {
      disposed = true
      cancelAll('destroy')
      editor.off('transaction', onTransaction)
      // 销毁时把还挂着的占位删掉。`fail()` 在 `disposed` 之后会提前返回（编辑器都没了，
      // 不能再去改它的 state），所以清场只能放在这里 —— 否则每次 destroy 都会在文档里
      // 留一块「打不开的空文件」。此刻 view 通常还没释放（dispose 先于 runtime.destroy），
      // 但仍用 try/catch 兜一层，免得各种销毁顺序下反而抛出来。
      const stale = []
      for (const batch of batches) {
        for (const task of batch.tasks) {
          releaseOverlay(task)
          if (task.settled || task.pos == null) continue
          const at = findPos(task.blockId)
          if (at != null) stale.push(at)
          task.settled = true
          task.pos = null
        }
      }
      if (!stale.length) return
      let tr = editor.state.tr
      for (const at of stale.sort((a, b) => b - a)) {
        const node = tr.doc.nodeAt(at)
        if (node && node.type.name === 'fileBlock') tr = tr.delete(at, at + node.nodeSize)
      }
      if (!tr.docChanged) return
      tr.setMeta('addToHistory', false)
      try { editor.view.dispatch(tr) } catch (_) { /* destroyed */ }
    },
    async insert(files, pos) {
      if (disposed || !host.writable() || !host.featureEnabled('files')) return
      const { accepted, rejected } = sortFileFiles(files, { maxSize: host.effectiveFileMaxSize })
      host.error = rejected[0]?.message || ''
      if (!accepted.length) return
      const input = source(), session = host.session, documentId = host.documentId, sessionDocumentId = session?.documentId
      let provider
      try { provider = providerFor(input) } catch (error) { host.error = error.message; return }
      const anchor = nearestInsertPosition(editor.state.doc, Number.isInteger(pos) ? pos : editor.state.selection.to)
      if (anchor === null) return
      const batch = { abort: new AbortController(), inserting: false, tasks: [] }
      if (disposed || editor.isDestroyed || editor.state.doc.content.size === 0) return
      batches.add(batch)
      const current = () => !disposed && !editor.isDestroyed && !batch.abort.signal.aborted && host.editor === editor && host.writable() &&
        host.featureEnabled('files') && host.session === session && host.documentId === documentId && session?.documentId === sessionDocumentId && source() === input
      const stop = () => { batches.delete(batch); for (const task of batch.tasks) releaseOverlay(task) }
      const prior = tail
      let release
      tail = new Promise(resolve => { release = resolve })
      try {
        await prior
        if (!current()) { release(); return }
        /* ---- ① 先落占位：一笔事务、一条历史，用户立刻能看到「在传了」 ---- */
        batch.inserting = true
        const placeholders = accepted.map(file => {
          // 占位只带「渲染得出来但打不开」的那几个已有字段：无 `src` / `token` / `originalSrc`。
          // `blockId` 必须显式给 —— 它是 findPos / onTransaction 的唯一锚点，`create()` 的
          // 默认值是 null，不给就再也找不到自己插的这块。
          const attrs = fileBlockAttrs(file, {})
          delete attrs.src
          delete attrs.token
          delete attrs.originalSrc
          attrs.blockId = createBlockId()
          return { file, blockId: attrs.blockId, attrs }
        })
        // 传 JSONContent 而不是 Node 实例：tiptap 的 `createNodeFromContent` 只认
        // Node / Fragment / Slice 三种「已是 PM 内容」的形态，**数组不会被识别**，
        // 会逐个丢进 `schema.nodeFromJSON()` —— Node 实例进去直接抛
        // `Invalid input for Fragment.fromJSON`。
        const content = placeholders.map(item => ({ type: 'fileBlock', attrs: item.attrs }))
        const bookmark = editor.state.selection.getBookmark()
        // `closeHistory` 起一次历史边界，`insertContentAt` 把 N 个占位写成**一笔**事务：
        // 撤销一次就是整批消失，和飞书一致（旧实现每个块一条记录，撤销要按 N 次）。
        stopCapturing()
        editor.chain()
          .command(({ tr }) => { closeHistory(tr); return true })
          .insertContentAt(anchor, content)
          .command(({ tr }) => { tr.setSelection(bookmark.map(tr.mapping).resolve(tr.doc)); return true })
          .run()
        // 收尾切一次历史边界：`stopCapturing()` 对 prosemirror-history 是**空操作**
        // （那个插件没有 `undoManager`），真正的边界是 `closeHistory` 的 meta。
        // 不切的话「传完接着打字」会和这次插入并成一条历史，一撤销把刚写的字一起吞掉。
        editor.view.dispatch(closeHistory(editor.state.tr))
        batch.tasks = placeholders.map(item => ({
          file: item.file, blockId: item.attrs.blockId, pos: findPos(item.attrs.blockId),
          controller: new AbortController(), settled: false, overlay: null,
        }))
        for (const task of batch.tasks) {
          if (task.pos == null) continue
          task.overlay = createUploadingOverlay(editor.view.dom.ownerDocument, task.file, () => {
            // 取消 = abort 这一路 + 走 fail() 删占位；fail 会被 worker 的 catch 命中，
            // 但这里直接删更及时（不必等在飞的那一片回来）。
            if (task.settled) return
            task.controller.abort('user-cancel')
            const at = posOf(task)
            if (at == null) return
            const node = editor.state.doc.nodeAt(at)
            task.settled = true
            if (node && editor.view) {
              const tr = editor.state.tr.delete(at, at + node.nodeSize)
              tr.setMeta('addToHistory', false)
              try { editor.view.dispatch(tr) } catch (_) { /* destroyed */ }
            }
            releaseOverlay(task)
          })
          attachOverlay(task)
        }
        // 占位可能落在视口外（附件壳 453px 高，插在文档末尾时常常只露半截）：
        // 不滚过去的话用户看到的还是「没反应」，进度条白画。`nearest` 只在不可见时才动，
        // 已经看得见就不打扰（避免用户在别处打字时被拽走）。
        revealPlaceholder(batch.tasks[0])
        batch.inserting = false
        if (!current()) { stop(); return }

        /* ---- ② 逐块上传；成功换真身、失败删占位，都不记账 ---- */
        // 两条收尾都以 `addToHistory: false` 落地：占位插入已经写了一条历史，
        // 换真身 / 删占位只是「同一块的后续」，再记一笔会让撤销要按好几次。
        // 编辑器已销毁时不再碰 state（destroy 后的 dispatch 会直接抛）。
        const settle = task => {
          const at = disposed ? null : posOf(task)
          task.settled = true
          releaseOverlay(task)
          return at
        }
        // view 已随 destroy 释放时 dispatch 会抛；这里只是收尾，吞掉即可 ——
        // 编辑器都没了，历史里留不留一条空块已无意义。
        const apply = tr => {
          tr.setMeta('addToHistory', false)
          try { editor.view.dispatch(tr) } catch (_) { /* destroyed */ }
        }
        const complete = (task, result) => {
          const at = settle(task)
          if (at == null) return
          policy.validate(task.file, { maxSize: host.effectiveFileMaxSize })
          policy.normalize(result, task.file)
          apply(editor.state.tr.setNodeMarkup(at, undefined, fileBlockAttrs(task.file, result)))
        }
        const fail = task => {
          const at = settle(task)
          if (at == null) return
          const node = editor.state.doc.nodeAt(at)
          if (!node) return
          apply(editor.state.tr.delete(at, at + node.nodeSize))
        }
        let next = 0
        const worker = async () => {
          while (current() && next < batch.tasks.length) {
            const task = batch.tasks[next++]
            if (task.pos == null) { task.settled = true; continue }
            try {
              const result = await provider.upload(task.file, {
                taskId: `file-${createBlockId()}`, source: 'select', documentId: sessionDocumentId ?? documentId,
                resumeScope: `${ownerId}:${scope}`, signal: task.controller.signal,
                limits: { maxSize: host.effectiveFileMaxSize },
                onProgress: event => { if (current() && !task.settled) task.overlay?.update(event.percent) },
              })
              if (current() && !task.settled) complete(task, result)
            } catch (error) {
              if (task.settled) continue
              if (current() && !isAbortError(error)) { host.error = error?.message || '文件上传失败'; fail(task) }
              else fail(task)
            }
          }
        }
        const concurrency = Math.min(3, Math.max(1, Math.floor(Number(input.concurrency) || 1)))
        await Promise.all(Array.from({ length: Math.min(concurrency, batch.tasks.length) }, worker))
      } finally { stop(); release() }
    },
  }
}
