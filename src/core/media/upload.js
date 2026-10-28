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
  if (file.type && mime.indexOf(file.type) === -1) {
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
  if (!result || typeof result !== 'object' || typeof result.url !== 'string' || !result.url) {
    throw uploadError(UPLOAD_ERROR.RESULT, '图片上传未返回有效地址')
  }
  return {
    size: file && typeof file.size === 'number' ? file.size : undefined,
    mime: file ? file.type || undefined : undefined,
    name: file ? file.name || undefined : undefined,
    ...result,
  }
}

function emitProgress(onProgress, loaded, total) {
  if (typeof onProgress !== 'function') return
  const safeTotal = Number(total) > 0 ? Number(total) : 0
  const percent = safeTotal ? Math.min(100, Math.max(0, Math.round((loaded / safeTotal) * 100))) : 0
  onProgress({ loaded, total: safeTotal, percent })
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(uploadError(UPLOAD_ERROR.ABORTED, '上传已取消'))
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      reject(uploadError(UPLOAD_ERROR.ABORTED, '上传已取消'))
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * 建一个上传通道。返回值：
 *   upload(file, ctx?)   与宿主同签名，多了 ctx.taskId / ctx.signal 两个可选键
 *   cancel(taskId)       从外部取消（不传则取消全部）
 *   cancelAll()
 *   pending()            进行中的任务数（UI 可据此禁「再次上传」）
 *   limits / retry / chunked / chunkSize   生效配置的只读副本
 */
export function createUploadProvider(options = {}) {
  const upload = options.upload
  if (typeof upload !== 'function') throw new Error('上传 provider 必须传入 upload 函数')

  const limits = options.limits === undefined ? DEFAULT_UPLOAD_LIMITS : options.limits
  const retry = { ...DEFAULT_RETRY, ...(options.retry || {}) }
  const attempts = Math.max(1, Math.floor(Number(retry.attempts) || 1))
  const chunked = options.chunked === true
  const chunkSize = Math.max(64 * 1024, Number(options.chunkSize) || DEFAULT_CHUNK_SIZE)
  const getDocumentId = typeof options.getDocumentId === 'function' ? options.getDocumentId : () => null

  /** taskId → { controller, key, resumeFrom, uploadId } */
  const tasks = new Map()
  /** 断点账本：fileSignature → { uploadId, resumeFrom }，成功即删。 */
  const resumes = new Map()
  let seq = 0

  function makeTaskId() {
    seq += 1
    return `upload-${seq}`
  }

  async function withRetry(run, signal) {
    let lastError = null
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      if (signal && signal.aborted) throw uploadError(UPLOAD_ERROR.ABORTED, '上传已取消')
      try {
        return await run(attempt)
      } catch (error) {
        lastError = error
        if (isAbortError(error)) throw error
        if (attempt >= attempts || !isRetryable(error)) break
        await delay(retry.delay * Math.pow(retry.factor, attempt - 1), signal)
      }
    }
    if (isAbortError(lastError)) throw lastError
    if (lastError && lastError.code) throw lastError
    throw uploadError(UPLOAD_ERROR.FAILED, `上传失败：${(lastError && lastError.message) || '未知错误'}`, {
      cause: lastError,
      attempts,
    })
  }

  async function uploadFile(file, ctx = {}) {
    validateUploadFile(file, limits)

    const key = fileSignature(file)
    const taskId = ctx.taskId || makeTaskId()
    if (tasks.has(taskId)) throw uploadError(UPLOAD_ERROR.FAILED, '上传任务已在进行中', { taskId })

    const controller = new AbortController()
    const outer = ctx.signal
    const forwardAbort = () => controller.abort()
    if (outer) {
      if (outer.aborted) controller.abort()
      else outer.addEventListener('abort', forwardAbort, { once: true })
    }

    const resume = chunked ? resumes.get(key) || { uploadId: null, resumeFrom: 0 } : { uploadId: null, resumeFrom: 0 }
    const task = { controller, key, resumeFrom: resume.resumeFrom, uploadId: resume.uploadId || `chunk-${taskId}` }
    tasks.set(taskId, task)
    const total = Number(file.size) || 0
    const baseCtx = { documentId: ctx.documentId != null ? ctx.documentId : getDocumentId(), signal: controller.signal, taskId, onProgress: null }

    try {
      emitProgress(ctx.onProgress, 0, total)

      if (!chunked || total <= chunkSize) {
        const result = await withRetry(async () => {
          const uploaded = await upload(file, {
            ...baseCtx,
            onProgress: (event) => emitProgress(ctx.onProgress, (event && event.loaded) || 0, total),
          })
          return uploaded
        }, controller.signal)
        emitProgress(ctx.onProgress, total, total)
        resumes.delete(key)
        return normalizeUploadResult(result, file)
      }

      const parts = Math.max(1, Math.ceil(total / chunkSize))
      let finalResult = null
      for (let index = task.resumeFrom; index < parts; index += 1) {
        const start = index * chunkSize
        const end = Math.min(total, start + chunkSize)
        const part = file.slice(start, end)
        finalResult = await withRetry(() => upload(part, {
          ...baseCtx,
          file,
          chunk: { index, total: parts, offset: start, size: end - start, uploadId: task.uploadId },
        }), controller.signal)
        task.resumeFrom = index + 1
        emitProgress(ctx.onProgress, end, total)
      }
      resumes.delete(key)
      return normalizeUploadResult(finalResult, file)
    } catch (error) {
      // 取消或失败都留着账本：同一文件再次上传时从断点续，不从零重来。
      if (chunked && task.resumeFrom > 0) resumes.set(key, { uploadId: task.uploadId, resumeFrom: task.resumeFrom })
      if (isAbortError(error) || (controller.signal.aborted && !error.code)) {
        throw uploadError(UPLOAD_ERROR.ABORTED, '上传已取消', { taskId })
      }
      throw error
    } finally {
      tasks.delete(taskId)
      if (outer) outer.removeEventListener('abort', forwardAbort)
    }
  }

  return {
    upload: uploadFile,
    cancel(taskId) {
      if (taskId == null) return 0
      const task = tasks.get(taskId)
      if (!task) return 0
      task.controller.abort()
      return 1
    },
    cancelAll() {
      let count = 0
      tasks.forEach((task) => {
        task.controller.abort()
        count += 1
      })
      return count
    },
    pending() {
      return tasks.size
    },
    /** 清空断点账本（宿主切换文档 / 登出时调用）。 */
    clearResume() {
      resumes.clear()
    },
    limits,
    retry: Object.freeze({ ...retry, attempts }),
    chunked,
    chunkSize,
  }
}

export default createUploadProvider
