import { safeAttachmentId, safeUrl } from '../documentOperations'

/**
 * 上传 provider（P2-02）——把宿主的一个裸函数补成有契约的上传通道。
 *
 * 宿主入口（05 §5.7）：
 *   uploader.upload(file, ctx) → { url, width?, height?, size, mime, name? }
 * 0.11 及以前门面只做「取到函数就直接用」，因此下面四条路径全靠调用方自觉：
 *
 *   ① 超限：类型 / 大小在调用前拦掉，错误信息可读，别等传到服务端；
 *   ② 重试：只重试「确定安全」的失败（网络中断 / 5xx / 429 / 显式
 *      error.retryable === true）。业务错误（4xx、校验失败）不重试，避免
 *      重复写入；重试间隔递减抖动，最多 DEFAULT_RETRY.attempts 次。
 *   ③ 取消：每个任务一个 AbortSignal，宿主可透传给 fetch/XHR；
 *      也支持 provider.cancel(taskId) 从外部喊停，错误码统一 UPLOAD_ABORTED。
 *   ④ 断点：宿主声明 uploader.chunked === true 时按 chunkSize 切片上传，
 *      逐片重试 —— 中途失败从失败那片续，不从头再来。同一文件（按
 *      name:size:lastModified 判定）在内存里记着已完成的片数，用户手动
 *      重试也能接着走；成功后清账。
 *
 * 这个模块不碰 DOM、不碰编辑器：纯函数 + 一个闭包，单测直接喂假宿主。
 */

/** 错误码：UI 侧按码分文案，避免在组件里比对英文 message。 */
export const UPLOAD_ERROR = Object.freeze({
  MIME: 'UPLOAD_MIME',
  SIZE: 'UPLOAD_SIZE',
  ABORTED: 'UPLOAD_ABORTED',
  FAILED: 'UPLOAD_FAILED',
  RESULT: 'UPLOAD_RESULT',
})

/** 与图片块允许的类型一致；宿主想放宽就传自己的 limits。 */
export const UPLOAD_MIME_ALLOWLIST = Object.freeze(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

/** 默认上限 20 MB：比图片块默认 5 MB 宽，只兜「明显不符」的情况。 */
export const DEFAULT_UPLOAD_LIMITS = Object.freeze({ maxSize: 20 * 1024 * 1024, mime: UPLOAD_MIME_ALLOWLIST })

export const DEFAULT_RETRY = Object.freeze({ attempts: 3, delay: 300, factor: 3 })

export const DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024

/** 带 code 的错误，方便宿主和测试只认码。 */
export function uploadError(code, message, extra) {
  const error = new Error(message)
  error.code = code
  if (extra) Object.assign(error, extra)
  return error
}

export function isAbortError(error) {
  return Boolean(error) && (error.code === UPLOAD_ERROR.ABORTED || error.name === 'AbortError')
}

/**
 * 只放行「重试一定安全」的失败：
 *  - 宿主显式标了 retryable；
 *  - HTTP 状态码 429 / 5xx；
 *  - 浏览器网络层错误（fetch 的 TypeError / XHR 的 NetworkError / 超时）。
 * 业务 4xx、校验失败、返回值不合法都不重试 —— 重试只会重复扣费或重复落库。
 */
export function isRetryable(error) {
  if (!error || isAbortError(error)) return false
  if (error.retryable === true) return true
  if (error.retryable === false) return false
  const status = Number(error.status || error.statusCode)
  if (Number.isFinite(status) && status > 0) return status === 429 || status >= 500
  return error.name === 'NetworkError' || error.name === 'TimeoutError' || error.name === 'TypeError'
}

/** 同一文件的稳定指纹：用户重新选同一张图时能接着断点。 */
export function fileSignature(file) {
  if (!file) return ''
  return `${file.name || ''}:${file.size || 0}:${file.lastModified || 0}`
}

function formatMB(bytes) {
  const mb = bytes / 1024 / 1024
  return Number.isInteger(mb) ? String(mb) : mb.toFixed(1)
}

/**
 * 超限校验。limits 传 null / undefined 表示「不设 provider 级上限」，
 * 交给调用方自己那道校验（图片块已有 5 MB 默认，避免两处口径打架）。
 */
export function validateUploadFile(file, limits = DEFAULT_UPLOAD_LIMITS) {
  if (!file || typeof file.size !== 'number') throw uploadError(UPLOAD_ERROR.FAILED, '上传内容无效')
  if (!limits) return file
  const mime = Array.isArray(limits.mime) && limits.mime.length ? limits.mime : UPLOAD_MIME_ALLOWLIST
  if (mime.indexOf(String(file.type || '').toLowerCase()) === -1) {
    const labels = mime.map((type) => String(type).split('/')[1].toUpperCase()).join('/')
    throw uploadError(UPLOAD_ERROR.MIME, `只支持 ${labels} 图片`, { mime: file.type })
  }
  const maxSize = Number(limits.maxSize)
  if (Number.isFinite(maxSize) && maxSize > 0 && file.size > maxSize) {
    throw uploadError(UPLOAD_ERROR.SIZE, `单张图片不能超过 ${formatMB(maxSize)} MB`, { size: file.size, maxSize })
  }
  return file
}

/** 补齐 05 §5.7 的返回契约；缺 url 直接判失败，不产生半截节点。 */
export function normalizeUploadResult(result, file) {
  if (!result || typeof result !== 'object' || !safeUrl(result.url, true) || (result.attchId != null && !safeAttachmentId(String(result.attchId)))) {
    throw uploadError(UPLOAD_ERROR.RESULT, '图片上传未返回有效地址')
  }
  return {
    size: file && typeof file.size === 'number' ? file.size : undefined,
    mime: file ? file.type || undefined : undefined,
    name: file ? file.name || undefined : undefined,
    ...result,
  }
}

const UPLOAD_PROVIDER = Symbol.for('lark-doc.uploadProvider')
const UPLOAD_PROVIDER_VERSION = 1

/** 跨入口保留 Provider 身份，回调、取消和任务编号仍由原实例管理。 */
export function normalizeUploader(input, defaults = {}) {
  if (input && input[UPLOAD_PROVIDER] !== undefined) {
    if (input[UPLOAD_PROVIDER] !== UPLOAD_PROVIDER_VERSION) {
      throw uploadError(UPLOAD_ERROR.FAILED, '不支持的上传 Provider 协议版本')
    }
    if (!['upload', 'cancel', 'cancelAll', 'pending', 'clearResume'].every(name => typeof input[name] === 'function')) {
      throw uploadError(UPLOAD_ERROR.FAILED, '上传 Provider 协议无效')
    }
    return input
  }
  const options = typeof input === 'function' ? { upload: input } : (input || {})
  return createUploadProvider({
    ...defaults,
    ...options,
    upload: typeof options.upload === 'function' ? options.upload.bind(options) : undefined,
  })
}

function readLocalImage(file, ctx) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    const onAbort = () => { reader.abort(); reject(uploadError(UPLOAD_ERROR.ABORTED, '上传已取消')) }
    const cleanup = () => ctx.signal.removeEventListener('abort', onAbort)
    reader.onload = () => { cleanup(); resolve({ url: reader.result }) }
    reader.onerror = () => { cleanup(); reject(uploadError(UPLOAD_ERROR.FAILED, '本地图片读取失败')) }
    reader.onabort = cleanup
    reader.onprogress = event => ctx.onProgress(event)
    ctx.signal.addEventListener('abort', onAbort, { once: true })
    reader.readAsDataURL(file)
  })
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(uploadError(UPLOAD_ERROR.ABORTED, '上传已取消'))
    const onAbort = () => { clearTimeout(timer); reject(uploadError(UPLOAD_ERROR.ABORTED, '上传已取消')) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve() }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** 文件任务统一管理校验、回调、重试/分片、取消和唯一终态。 */
export function createUploadProvider(options = {}) {
  const upload = typeof options.upload === 'function' ? options.upload.bind(options) : readLocalImage
  const mode = typeof options.upload === 'function' ? 'upload' : 'local'
  const limits = options.limits === undefined ? DEFAULT_UPLOAD_LIMITS : options.limits
  const retry = { ...DEFAULT_RETRY, ...(options.retry || {}) }
  const attempts = Math.max(1, Math.floor(Number(retry.attempts) || 1))
  const chunked = mode === 'upload' && options.chunked === true
  const chunkSize = Math.max(64 * 1024, Number(options.chunkSize) || DEFAULT_CHUNK_SIZE)
  const tasks = new Map()
  const resumes = new Map()
  let resumeGeneration = 0
  let seq = 0

  async function uploadFile(file, ctx = {}) {
    const taskId = ctx.taskId || `upload-${++seq}`
    if (tasks.has(taskId)) throw uploadError(UPLOAD_ERROR.FAILED, '上传任务已在进行中', { taskId })
    const documentId = ctx.documentId ?? (typeof options.getDocumentId === 'function' ? options.getDocumentId() : null)
    const key = JSON.stringify([documentId, fileSignature(file)])
    const currentResumeGeneration = resumeGeneration
    const controller = new AbortController()
    const signal = controller.signal
    const outer = ctx.signal
    const resume = chunked ? resumes.get(key) : null
    const task = { status: null, reason: null, resumeFrom: resume?.resumeFrom || 0, uploadId: resume?.uploadId || `chunk-${taskId}` }
    const total = Number(file?.size) || 0
    let loaded = 0
    let rejectAbort
    const aborted = new Promise((resolve, reject) => { rejectAbort = reject })
    // 前置钩子可能同步取消，此时尚未开始等待它返回的 Promise。
    aborted.catch(() => {})
    const abortError = () => uploadError(UPLOAD_ERROR.ABORTED, '上传已取消', { taskId, reason: task.reason || 'cancelled' })
    const cancel = (reason = 'cancelled') => {
      if (task.status || signal.aborted) return 0
      task.reason = reason
      controller.abort()
      rejectAbort(abortError())
      return 1
    }
    task.cancel = cancel
    tasks.set(taskId, task)
    const baseCtx = {
      ...ctx, taskId, file, source: ctx.source || 'select', mode, signal, cancel,
      documentId,
    }
    const reportCallbackError = error => {
      const report = ctx.onCallbackError || options.onCallbackError
      try {
        const result = typeof report === 'function' ? report(error) : console.error('[LarkDoc] 上传回调异常', error)
        Promise.resolve(result).catch(failure => console.error('[LarkDoc] 上传回调异常', failure))
      } catch (failure) { console.error('[LarkDoc] 上传回调异常', failure) }
    }
    const notify = (name, extra = {}) => {
      const event = { ...baseCtx, ...extra }
      const handlers = [options[name], ctx[name]].filter((handler, index, list) => typeof handler === 'function' && list.indexOf(handler) === index)
      handlers.forEach(handler => {
        try { Promise.resolve(handler(event)).catch(reportCallbackError) } catch (error) { reportCallbackError(error) }
      })
    }
    const checkCancelled = () => { if (signal.aborted) throw abortError() }
    const waitFor = async promise => {
      const value = await Promise.race([promise, aborted])
      checkCancelled()
      return value
    }
    const progress = (value, extra = {}) => {
      if (task.status || signal.aborted) return
      loaded = Math.max(loaded, Math.min(total, Math.max(0, Number(value) || 0)))
      notify('onProgress', { ...extra, loaded, total, percent: total ? Math.min(100, Math.round(loaded / total * 100)) : 0 })
    }
    const forwardAbort = () => cancel(outer.reason || 'cancelled')
    if (outer) {
      if (outer.aborted) forwardAbort()
      else outer.addEventListener('abort', forwardAbort, { once: true })
    }
    const withRetry = async (part, chunk) => {
      let lastError
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        checkCancelled()
        try {
          const result = await waitFor(upload(part, {
            ...baseCtx, attempt, chunk,
            onProgress: event => progress((chunk?.offset || 0) + Math.min(part.size, Number(event?.loaded) || 0), { attempt, chunk }),
          }))
          return result
        } catch (error) {
          checkCancelled()
          lastError = error
          if (isAbortError(error) || attempt >= attempts || !isRetryable(error)) break
          notify('onRetry', { error, reason: error.message, attempt, nextAttempt: attempt + 1, chunk })
          checkCancelled()
          await waitFor(delay(retry.delay * Math.pow(retry.factor, attempt - 1), signal))
        }
      }
      if (lastError?.code || isAbortError(lastError)) throw lastError
      throw uploadError(UPLOAD_ERROR.FAILED, `上传失败：${lastError?.message || '未知错误'}`, { cause: lastError, attempts })
    }
    const finish = (status, extra) => {
      if (task.status) return
      task.status = status
      tasks.delete(taskId)
      if (outer) outer.removeEventListener('abort', forwardAbort)
      notify({ success: 'onSuccess', error: 'onError', cancelled: 'onCancel', rejected: 'onReject' }[status], { status, ...extra })
      notify('onSettled', { status, ...extra })
    }
    try {
      checkCancelled()
      if (ctx.limits !== undefined) validateUploadFile(file, ctx.limits)
      validateUploadFile(file, limits)
      if (typeof options.beforeUpload === 'function') {
        if (await waitFor(options.beforeUpload(file, baseCtx)) === false) cancel('beforeUpload')
      }
      checkCancelled()
      notify('onStart')
      checkCancelled()
      progress(0)
      checkCancelled()
      let result
      if (!chunked || total <= chunkSize) result = await withRetry(file)
      else {
        const parts = Math.max(1, Math.ceil(total / chunkSize))
        for (let index = task.resumeFrom; index < parts; index += 1) {
          const start = index * chunkSize
          const end = Math.min(total, start + chunkSize)
          const chunk = { index, total: parts, offset: start, size: end - start, uploadId: task.uploadId }
          result = await withRetry(file.slice(start, end), chunk)
          task.resumeFrom = index + 1
          progress(end, { chunk })
        }
      }
      checkCancelled()
      result = normalizeUploadResult(result, file)
      resumes.delete(key)
      progress(total)
      checkCancelled()
      finish('success', { result })
      return result
    } catch (failure) {
      if (isAbortError(failure) && !signal.aborted) cancel(failure.reason)
      const error = signal.aborted || isAbortError(failure) ? abortError()
        : failure?.code ? failure : uploadError(UPLOAD_ERROR.FAILED, failure?.message || '上传失败', { cause: failure })
      if (chunked && task.resumeFrom > 0 && currentResumeGeneration === resumeGeneration) {
        resumes.set(key, { uploadId: task.uploadId, resumeFrom: Math.min(task.resumeFrom, Math.ceil(total / chunkSize) - 1) })
      }
      const status = isAbortError(error) ? 'cancelled' : [UPLOAD_ERROR.MIME, UPLOAD_ERROR.SIZE].includes(error.code) ? 'rejected' : 'error'
      finish(status, { error, code: error.code, reason: error.reason || error.message })
      throw error
    }
  }

  const provider = {
    upload: uploadFile,
    cancel(taskId, reason) { return tasks.get(taskId)?.cancel(reason) || 0 },
    cancelAll(reason) {
      let count = 0
      tasks.forEach(task => { count += task.cancel(reason) })
      return count
    },
    pending: () => tasks.size,
    clearResume: () => { resumeGeneration += 1; resumes.clear() },
    limits,
    retry: Object.freeze({ ...retry, attempts }),
    chunked,
    chunkSize,
  }
  Object.defineProperty(provider, UPLOAD_PROVIDER, { value: UPLOAD_PROVIDER_VERSION })
  return provider
}

export default createUploadProvider
