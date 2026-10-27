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

  function drain() {
    if (settled && cancelled) return
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

  xhr.open(method, url, true)
  if (timeout > 0) xhr.timeout = timeout
  xhr.withCredentials = Boolean(withCredentials)
  Object.keys(finalHeaders).forEach(name => {
    if (finalHeaders[name] != null) xhr.setRequestHeader(name, String(finalHeaders[name]))
  })

  xhr.onreadystatechange = () => {
    if (cancelled) return
    if (xhr.readyState === 3) {
      if (onOpen) { try { onOpen(xhr.status, xhr) } catch (ignored) { /* 宿主钩子异常不影响流 */ } }
      drain()
      // IE11 / 部分旧内核不派发 onprogress，用轮询兜底保证增量不丢。
      if (!pollTimer) pollTimer = setInterval(drain, 120)
    } else if (xhr.readyState === 4) {
      stopPolling()
      if (cancelled) return
      drain()
      const status = xhr.status
      if ((status >= 200 && status < 300) || status === 304) {
        if (onOpen) { try { onOpen(status, xhr) } catch (ignored) { /* 同上 */ } }
        finish(onDone)
      } else {
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
      detail = text.slice(0, 200)
    }
  }
  const error = new Error(`AI 接口返回 HTTP ${status}${detail ? `：${detail}` : ''}`)
  error.status = status
  error.body = raw
  return error
}

/**
 * SSE 解码器。按行切分，空行派发一个事件；`data:` 多行用 \n 拼接，
 * 与 WHATWG 规范一致。注释行（`:` 开头）忽略。
 *
 * @param {{ onEvent: (event:{event:string,data:string,id:string}) => void }} handlers
 */
export function createSseDecoder(handlers) {
  const onEvent = (handlers && handlers.onEvent) || function noop() {}
  let buffer = ''
  let dataLines = []
  let eventName = ''
  let lastId = ''

  function dispatch() {
    if (!dataLines.length && !eventName) return
    const payload = { event: eventName || 'message', data: dataLines.join('\n'), id: lastId }
    dataLines = []
    eventName = ''
    onEvent(payload)
  }

  function handleLine(rawLine) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (!line) { dispatch(); return }
    if (line.charAt(0) === ':') return
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.charAt(0) === ' ') value = value.slice(1)
    if (field === 'data') dataLines.push(value)
    else if (field === 'event') eventName = value
    else if (field === 'id') lastId = value
  }

  return {
    push(chunk) {
      buffer += chunk
      let index = buffer.indexOf('\n')
      while (index !== -1) {
        handleLine(buffer.slice(0, index))
        buffer = buffer.slice(index + 1)
        index = buffer.indexOf('\n')
      }
    },
    end() {
      if (buffer) { handleLine(buffer); buffer = '' }
      dispatch()
    },
  }
}

/** 是否像 SSE 流：首块里出现 `data:` / `event:` 行。 */
export function looksLikeSse(text) {
  return /(^|\n)\s*(data|event|id):/.test(String(text || ''))
}
