import { createFrameParser, extractWholeBody } from './protocol.js'
import { createSseDecoder } from './transport.js'

/**
 * 传输层：只做三件事——发一个 POST、把响应体按增量吐出来、能取消。
 *
 * 为什么是 XHR 而不是 fetch：
 * 1. 宿主多是 webpack4 + Node14 的老工程，fetch 没有 onprogress，读不到增量；
 * 2. XHR 的 abort 语义在 IE11 / 旧 Chromium 上稳定，fetch 的 AbortController 反而要 polyfill；
 * 3. `responseText` 在 readyState=3 时就是已到达的全部内容，配合游标天然做到「只追加」。
 */

/**
 * @param {object} options
 * @param {string} options.url
 * @param {string} [options.method]
 * @param {object} [options.headers]
 * @param {string|object} [options.body]  对象会自动 JSON 序列化并补 Content-Type
 * @param {boolean} [options.withCredentials]
 * @param {number} [options.timeout]     毫秒；0 表示不设上限（流式建议 0）
 * @param {(status:number, xhr:XMLHttpRequest)=>void} [options.onOpen]
 * @param {(chunk:string)=>void} [options.onText]
 * @param {()=>void} [options.onDone]
 * @param {(error:Error)=>void} [options.onError]
 * @returns {{ cancel: () => void }}
 */
export function postStream(options) {
  const {
    url, method = 'POST', headers = {}, body, withCredentials = false, timeout = 0,
    onOpen, onText, onDone, onError,
  } = options || {}

  if (typeof url !== 'string' || !url) throw new Error('AI 接入缺少 endpoint / baseURL')

  const xhr = new XMLHttpRequest()
  let consumed = 0
  let settled = false
  let cancelled = false
  let pollTimer = null

  const payload = body !== undefined && body !== null && typeof body === 'object' ? JSON.stringify(body) : body
  const finalHeaders = { Accept: 'text/event-stream, application/json, text/plain, */*', ...headers }
  if (typeof payload === 'string' && !Object.keys(finalHeaders).some(key => key.toLowerCase() === 'content-type')) {
    finalHeaders['Content-Type'] = 'application/json;charset=UTF-8'
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  }

  function finish(callback, value) {
    if (settled) return
    settled = true
    stopPolling()
    if (callback) callback(value)
  }

  function isSuccessful() {
    return (xhr.status >= 200 && xhr.status < 300) || xhr.status === 304
  }

  function drain() {
    if (settled || !isSuccessful()) return
    let text
    try {
      text = xhr.responseText
    } catch (error) {
      // responseType 被宿主改成非文本时读不到 responseText，直接放弃增量。
      return
    }
    if (typeof text !== 'string' || text.length <= consumed) return
    const chunk = text.slice(consumed)
    consumed = text.length
    try {
      if (onText) onText(chunk)
    } catch (error) {
      finish(onError, error)
      try { xhr.abort() } catch (ignored) { /* 已关闭时忽略 */ }
    }
  }

  xhr.onreadystatechange = () => {
    if (settled || cancelled) return
    if (xhr.readyState === 3 && isSuccessful()) {
      if (onOpen) { try { onOpen(xhr.status, xhr) } catch (ignored) { /* 宿主钩子异常不影响流 */ } }
      drain()
      // IE11 / 部分旧内核不派发 onprogress，用轮询兜底保证增量不丢。
      if (!settled && !pollTimer) pollTimer = setInterval(drain, 120)
    } else if (xhr.readyState === 4) {
      stopPolling()
      const status = xhr.status
      if (isSuccessful()) {
        if (onOpen) { try { onOpen(status, xhr) } catch (ignored) { /* 同上 */ } }
        drain()
        finish(onDone)
      } else if (status) {
        // 状态 0 由 error / timeout / abort 事件给出具体原因。
        const raw = (() => { try { return xhr.responseText || '' } catch (error) { return '' } })()
        finish(onError, buildHttpError(status, raw))
      }
    }
  }

  xhr.onprogress = () => { if (!cancelled) drain() }
  xhr.onload = () => { if (!cancelled) drain() }
  xhr.onerror = () => {
    if (cancelled) { finish(onDone); return }
    finish(onError, new Error('AI 请求网络异常，请检查 endpoint、跨域与网络策略'))
  }
  xhr.ontimeout = () => {
    if (cancelled) { finish(onDone); return }
    finish(onError, new Error('AI 请求超时'))
  }
  xhr.onabort = () => {
    if (cancelled) finish(onDone)
  }

  try {
    xhr.open(method, url, true)
    if (timeout > 0) xhr.timeout = timeout
    xhr.withCredentials = Boolean(withCredentials)
    Object.keys(finalHeaders).forEach(name => {
      if (finalHeaders[name] != null) xhr.setRequestHeader(name, String(finalHeaders[name]))
    })
    xhr.send(payload === undefined ? null : payload)
  } catch (error) {
    finish(onError, error)
  }

  return {
    cancel() {
      if (settled && !cancelled) return
      cancelled = true
      stopPolling()
      try { xhr.abort() } catch (error) { /* 已结束的 xhr.abort 会抛，忽略 */ }
      finish(onDone)
    },
  }
}

function buildHttpError(status, raw) {
  let detail = ''
  const text = String(raw || '').trim()
  if (text) {
    try {
      const json = JSON.parse(text)
      detail = json.message || json.error?.message || json.error || json.msg || ''
      if (detail && typeof detail === 'object') detail = JSON.stringify(detail)
    } catch (error) {
      // The adapter redacts the sent credential before shortening the message.
      detail = text
    }
  }
  const error = new Error(`AI 接口返回 HTTP ${status}${detail ? `：${detail}` : ''}`)
  error.status = status
  error.body = raw
  return error
}

export function runHttpStream(config, request, args, { decideMode, redactProviderError }) {
  const callbacks = args || {}
  const onStart = typeof callbacks.onStart === 'function' ? callbacks.onStart : null
  const onChunk = typeof callbacks.onChunk === 'function' ? callbacks.onChunk : null
  const onDone = typeof callbacks.onDone === 'function' ? callbacks.onDone : null
  const onCancelled = typeof callbacks.onCancelled === 'function' ? callbacks.onCancelled : null
  const onError = typeof callbacks.onError === 'function' ? callbacks.onError : null

  const parser = createFrameParser(request.protocol)
  const decoder = createSseDecoder({
    onEvent(event) {
      if (settled) return
      const result = parser.parse(event.data, event.event)
      if (result.error) { fail(result.error); return }
      if (result.delta) emit(result.delta)
      if (result.done) complete()
    },
  })

  let settled = false
  let cancelled = false
  let started = false
  let mode = config.stream === false ? 'whole' : null
  let pending = ''
  let raw = ''

  function start() {
    if (started) return
    started = true
    if (onStart) onStart()
  }

  function emit(text) {
    if (!text) return
    start()
    if (onChunk) onChunk(text)
  }

  function complete() {
    if (settled) return
    settled = true
    start()
    if (onDone) onDone()
  }

  function fail(error) {
    if (settled) return
    settled = true
    if (onError) onError(redactProviderError(error, config, request))
  }

  function feed(chunk) {
    if (settled) return
    if (mode === 'sse') { decoder.push(chunk); return }
    if (mode === 'whole') { raw += chunk; return }
    if (mode === 'plain') { emit(chunk); return }
    pending += chunk
    const decided = decideMode(pending, false)
    if (!decided) return
    mode = decided
    const buffered = pending
    pending = ''
    if (mode === 'sse') decoder.push(buffered)
    else if (mode === 'whole') raw += buffered
    else emit(buffered)
  }

  const handle = postStream({
    url: request.url,
    method: request.method || 'POST',
    headers: request.headers,
    body: request.body,
    withCredentials: config.withCredentials === true,
    timeout: Number(config.timeout) || 0,
    onOpen() { start() },
    onText: feed,
    onDone() {
      if (settled) return
      if (cancelled) {
        settled = true
        if (onCancelled) onCancelled()
        return
      }
      try {
        if (mode === 'sse') {
          decoder.end()
        } else if (mode === 'whole' || mode === null) {
          const whole = extractWholeBody(raw || pending)
          if (whole) emit(whole)
        }
      } catch (error) {
        fail(error)
        return
      }
      complete()
    },
    onError(error) {
      if (cancelled) {
        if (onCancelled) onCancelled()
        settled = true
        return
      }
      if (error && error.name === 'AbortError') {
        settled = true
        if (onCancelled) onCancelled()
        return
      }
      fail(error)
    },
  })

  return {
    cancel() {
      if (settled) return
      cancelled = true
      settled = true
      handle.cancel()
      if (onCancelled) onCancelled()
    },
  }
}
