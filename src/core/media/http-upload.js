import { uploadError, UPLOAD_ERROR } from './upload'

function responseField(body, path) {
  if (typeof path !== 'string' || !path || path.split('.').some(key => !/^[\w$]+$/.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key))) {
    throw uploadError(UPLOAD_ERROR.RESULT, '上传响应字段路径无效', { retryable: false })
  }
  return path.split('.').reduce((value, key) => value != null && Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined, body)
}

/** 普通单文件 HTTP 上传；任务、重试和终态仍由同一个 Provider 管理。 */
export async function uploadHttpImage(file, ctx, options) {
  if (ctx.signal.aborted) throw uploadError(UPLOAD_ERROR.ABORTED, '上传已取消')
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

