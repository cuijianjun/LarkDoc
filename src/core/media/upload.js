import { safeAttachmentId, safeUrl } from '../documentOperations'
import { IMAGE_MIME_ALLOWLIST } from './image-insert'

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
 * 这个模块不操作编辑器：统一任务状态与结果校验，浏览器传输仅在实际上传时创建。
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
export const UPLOAD_MIME_ALLOWLIST = IMAGE_MIME_ALLOWLIST

/** 与文档图片入口一致，默认单张最大 20 MB。 */
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
 * 交给调用方自己那道校验（文档入口默认 20 MB，允许宿主单独收紧）。
 */
export function validateUploadFile(file, limits = DEFAULT_UPLOAD_LIMITS) {
  if (!file || typeof file.size !== 'number') throw uploadError(UPLOAD_ERROR.FAILED, '上传内容无效')
  if (!limits) return file
  const mime = Array.isArray(limits.mime) && limits.mime.length ? limits.mime : UPLOAD_MIME_ALLOWLIST
  if (mime.indexOf(String(file.type || '').toLowerCase()) === -1) {
    const labels = [...new Set(mime.map(type => String(type).split('/')[1].toUpperCase().replace(/^JPG$/, 'JPEG').replace(/^X-(?:MS-)?BMP$/, 'BMP')))].join('/')
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

function responseField(body, path) {
  if (typeof path !== 'string' || !path || path.split('.').some(key => !/^[\w$]+$/.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key))) {
    throw uploadError(UPLOAD_ERROR.RESULT, '上传响应字段路径无效', { retryable: false })
  }
  return path.split('.').reduce((value, key) => value != null && Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined, body)
}

/** 普通单文件 HTTP 上传；任务、重试和终态仍由同一个 Provider 管理。 */
async function uploadHttpImage(file, ctx, options) {
  const invalid = message => uploadError(UPLOAD_ERROR.FAILED, message, { retryable: false })
  let action
  try {
    if (typeof options.action !== 'string' || !options.action.trim()) throw invalid('请配置图片上传接口 action')
    action = new URL(options.action, typeof location === 'undefined' ? undefined : location.href)
    if (!['http:', 'https:'].includes(action.protocol) || action.username || action.password) throw invalid('图片上传接口必须是 HTTP(S) 地址')
  } catch (_) { throw invalid('图片上传接口 action 无效') }
  const method = String(options.method || 'POST').toUpperCase()
  const fieldName = options.fieldName === undefined ? 'file' : options.fieldName
  const timeout = options.timeout === undefined ? 30000 : options.timeout
  if (!['POST', 'PUT', 'PATCH'].includes(method)) throw invalid('图片上传仅支持 POST / PUT / PATCH')
  if (typeof fieldName !== 'string' || !fieldName.trim()) throw invalid('图片上传 fieldName 无效')
  if (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout < 0) throw invalid('图片上传 timeout 无效')
  if (options.withCredentials !== undefined && typeof options.withCredentials !== 'boolean') throw invalid('图片上传 withCredentials 必须是布尔值')
  if (options.chunked) throw invalid('分片上传请提供自定义 upload 函数')
  if (typeof XMLHttpRequest === 'undefined' || typeof FormData === 'undefined') throw invalid('当前环境不支持 HTTP 图片上传')
  const mapping = options.response === undefined ? {} : options.response
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) throw invalid('图片上传 response 配置无效')
  for (const key of ['url', 'attchId', 'message']) {
    if (mapping[key] !== undefined) responseField({}, mapping[key])
  }
  if (mapping.success !== undefined) {
    if (!mapping.success || !Object.prototype.hasOwnProperty.call(mapping.success, 'equals')) throw invalid('图片上传 success 配置需要 path 和 equals')
    responseField({}, mapping.success.path)
  }
  let headers
  try { headers = typeof options.headers === 'function' ? await options.headers(file, ctx) : options.headers }
  catch (_) { throw invalid('获取图片上传请求头失败') }
  if (ctx.signal.aborted) throw uploadError(UPLOAD_ERROR.ABORTED, '上传已取消')
  if (headers === undefined) headers = {}
  const data = options.data === undefined ? {} : options.data
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) throw invalid('图片上传 headers 必须是对象')
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw invalid('图片上传 data 必须是对象')
  if (Object.keys(headers).some(key => key.toLowerCase() === 'content-type')) throw invalid('multipart Content-Type 由浏览器自动设置，请勿配置')
  if (Object.prototype.hasOwnProperty.call(data, fieldName)) throw invalid('图片上传 data 不能覆盖文件字段')
  const form = new FormData()
  form.append(fieldName, file)
  Object.entries(data).forEach(([key, value]) => {
    if (value == null) return
    if (!['string', 'number', 'boolean'].includes(typeof value)) throw invalid('图片上传 data 字段仅支持字符串、数字或布尔值')
    form.append(key, String(value))
  })
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      ctx.signal.removeEventListener('abort', onAbort)
      xhr.onload = xhr.onerror = xhr.ontimeout = xhr.onabort = null
      xhr.upload.onprogress = null
      callback(value)
    }
    const onAbort = () => {
      xhr.abort()
      finish(reject, uploadError(UPLOAD_ERROR.ABORTED, '上传已取消'))
    }
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        finish(reject, uploadError(UPLOAD_ERROR.FAILED, `图片上传失败（HTTP ${xhr.status}）`, { status: xhr.status }))
        return
      }
      try {
        const body = JSON.parse(xhr.responseText)
        if (mapping.success !== undefined && responseField(body, mapping.success.path) !== mapping.success.equals) {
          const message = mapping.message === undefined ? undefined : responseField(body, mapping.message)
          throw invalid(typeof message === 'string' && message ? message : '图片上传业务处理失败')
        }
        const result = { url: responseField(body, mapping.url === undefined ? 'url' : mapping.url) }
        const attchId = responseField(body, mapping.attchId === undefined ? 'attchId' : mapping.attchId)
        if (attchId != null) result.attchId = attchId
        finish(resolve, result)
      } catch (error) {
        finish(reject, error.code ? error : uploadError(UPLOAD_ERROR.RESULT, '图片上传响应不是有效 JSON', { retryable: false }))
      }
    }
    xhr.onerror = () => finish(reject, uploadError(UPLOAD_ERROR.FAILED, '图片上传网络错误', { name: 'NetworkError' }))
    xhr.ontimeout = () => finish(reject, uploadError(UPLOAD_ERROR.FAILED, '图片上传超时', { name: 'TimeoutError' }))
    xhr.onabort = () => finish(reject, uploadError(UPLOAD_ERROR.ABORTED, '上传已取消'))
    xhr.upload.onprogress = event => {
      // multipart 字节含表单和 boundary；按传输比例归一，避免把额外字段计成文件字节。
      if (event.lengthComputable && event.total > 0) ctx.onProgress({ loaded: file.size * Math.min(1, event.loaded / event.total) })
    }
    try {
      xhr.open(method, action.href, true)
      xhr.timeout = timeout
      xhr.withCredentials = options.withCredentials === true
      Object.entries(headers).forEach(([key, value]) => xhr.setRequestHeader(key, value))
      ctx.signal.addEventListener('abort', onAbort, { once: true })
      if (ctx.signal.aborted) onAbort()
      else xhr.send(form)
    } catch (_) { finish(reject, invalid('图片上传请求配置无效')) }
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
  const custom = typeof options.upload === 'function'
  const http = !custom && options.action !== undefined
  const upload = custom ? options.upload.bind(options) : http ? (file, ctx) => uploadHttpImage(file, ctx, options) : readLocalImage
  const mode = custom || http ? 'upload' : 'local'
  const limits = options.limits === undefined ? DEFAULT_UPLOAD_LIMITS : options.limits
  // 普通 POST 可能已在服务器落库；内置 HTTP 默认不重试，应用可按接口幂等契约显式开启。
  const retry = { ...DEFAULT_RETRY, ...(http ? { attempts: 1 } : {}), ...(options.retry || {}) }
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
      const reports = [options.onCallbackError, ctx.onCallbackError].filter((handler, index, list) => typeof handler === 'function' && list.indexOf(handler) === index)
      if (!reports.length) console.error('[LarkDoc] 上传回调异常', error)
      reports.forEach(report => {
        try { Promise.resolve(report(error)).catch(failure => console.error('[LarkDoc] 上传回调异常', failure)) }
        catch (failure) { console.error('[LarkDoc] 上传回调异常', failure) }
      })
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
