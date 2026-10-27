/**
 * AI 适配层入口。
 *
 * 把宿主传进来的 `ai` 配置统一收敛成一个对象：
 *
 *   { kind: 'stream' | 'endpoint', protocol, contentFormat, stream(args) }
 *
 * 支持的入参形态（从省事到可控）：
 *
 *   ai: 'https://api.example.com/ai'                 // L1 只给地址
 *   ai: { endpoint: '/api/ai', protocol: 'auto' }    // L1 显式协议
 *   ai: { protocol: 'openai', baseURL, apiKey, model }  // L2 直连模型服务
 *   ai: { stream(args) { ... return { cancel } } }    // L3 旧钩子，完全自管
 *   ai: (args) => ({ cancel })                       // L3 函数简写
 *
 * `stream(args)` 的入参与返回值保持与历史版本一致，因此老的 `{ stream }`
 * 接入不需要任何改动就能继续工作。
 */
import { buildMessages } from './prompt'
import { createFrameParser, extractWholeBody, httpAcceptFor } from './protocol'
import { createSseDecoder, postStream } from './transport'
import { previewToHtml } from './markdown'

export const AI_KINDS = Object.freeze(['stream', 'endpoint'])
export const AI_CONTENT_FORMATS = Object.freeze(['auto', 'markdown', 'html', 'text'])

const OPENAI_DEFAULT_PATH = '/chat/completions'

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function trimSlash(value) {
  return String(value || '').replace(/\/+$/, '')
}

function resolveHeaders(config) {
  const source = typeof config.headers === 'function' ? config.headers() : config.headers
  const headers = isPlainObject(source) ? { ...source } : {}
  const apiKey = typeof config.apiKey === 'function' ? config.apiKey() : config.apiKey
  if (apiKey && !Object.keys(headers).some(key => key.toLowerCase() === 'authorization')) {
    headers.Authorization = `Bearer ${apiKey}`
  }
  return headers
}

function normalizeContentFormat(value) {
  const format = String(value || '').toLowerCase()
  return AI_CONTENT_FORMATS.indexOf(format) === -1 ? 'auto' : format
}

/**
 * 判定入参属于哪一种接入方式。识别不出来返回 null（调用方回退到本地 Mock）。
 */
export function normalizeAIProvider(source) {
  if (source === null || source === undefined || source === false) return null

  if (typeof source === 'function') return createStreamProvider({ stream: source }, source)
  if (typeof source === 'string') {
    return source.trim() ? createEndpointProvider({ endpoint: source.trim() }) : null
  }
  if (!isPlainObject(source)) return null
  // 幂等：门面（LarkDoc.js）与 UI 层（Workspace.aiAdapter）各归一化一次，
  // 已经是标准 provider 的直接返回，否则 endpoint 会被二次包成 kind:'stream'。
  if (AI_KINDS.indexOf(source.kind) !== -1 && typeof source.stream === 'function') return source
  if (source.enabled === false) return null

  // L3：宿主自己管传输。stream 是历史契约，generate 是可读性更好的别名。
  const hook = typeof source.stream === 'function' ? source.stream : (typeof source.generate === 'function' ? source.generate : null)
  if (hook) return createStreamProvider(source, hook)

  const endpoint = source.endpoint || source.url || source.api
  const baseURL = source.baseURL || source.baseUrl
  if (typeof endpoint === 'string' && endpoint.trim()) {
    return createEndpointProvider({ ...source, endpoint: endpoint.trim(), baseURL })
  }
  if (typeof baseURL === 'string' && baseURL.trim()) {
    return createEndpointProvider({ ...source, protocol: source.protocol || 'openai', baseURL: baseURL.trim() })
  }
  return null
}

function createStreamProvider(config, hook) {
  return {
    kind: 'stream',
    protocol: config.protocol || 'custom',
    contentFormat: normalizeContentFormat(config.contentFormat),
    stream(args) {
      const handle = hook.call(config, args)
      if (typeof handle === 'function') return { cancel: handle }
      if (handle && typeof handle.cancel === 'function') return handle
      return { cancel() {} }
    },
  }
}

function createEndpointProvider(config) {
  const protocol = config.protocol || (config.baseURL && !config.endpoint ? 'openai' : 'auto')
  return {
    kind: 'endpoint',
    protocol,
    contentFormat: normalizeContentFormat(config.contentFormat),
    endpoint: config.endpoint || '',
    baseURL: config.baseURL || '',
    config,
    stream(args) {
      return runEndpointStream(config, protocol, args)
    },
  }
}

/** 组装一次请求。宿主的 transformRequest 可以整体接管。 */
function buildRequest(config, protocol, args) {
  const headers = { ...resolveHeaders(config) }
  if (!Object.keys(headers).some(key => key.toLowerCase() === 'accept')) {
    headers.Accept = httpAcceptFor(protocol)
  }
  let request
  if (protocol === 'openai') {
    const url = config.endpoint || `${trimSlash(config.baseURL)}${config.urlPath || OPENAI_DEFAULT_PATH}`
    const body = {
      model: config.model,
      stream: config.stream !== false,
      messages: typeof config.messages === 'function'
        ? config.messages(args)
        : buildMessages(args.action, args.text, args.prompt, args.language),
      ...(isPlainObject(config.params) ? config.params : {}),
    }
    if (body.model === undefined) delete body.model
    request = { url, headers, body, protocol: 'openai' }
  } else {
    const body = {
      action: args.action,
      text: args.text,
      prompt: args.prompt,
      language: args.language,
      range: args.range,
      ...(isPlainObject(config.params) ? config.params : {}),
    }
    request = { url: config.endpoint, headers, body, protocol }
  }
  if (typeof config.transformRequest === 'function') {
    const patched = config.transformRequest(request, args)
    if (isPlainObject(patched)) request = { ...request, ...patched }
  }
  return request
}

function decideMode(text, forceWhole) {
  if (forceWhole) return 'whole'
  if (/(^|\n)\s*(data|event|id):/.test(text)) return 'sse'
  const trimmed = text.replace(/^[\s\uFEFF]+/, '')
  if (!trimmed) return null
  if (trimmed.charAt(0) === '{' || trimmed.charAt(0) === '[') {
    try {
      JSON.parse(trimmed)
      return 'whole'
    } catch (error) {
      return trimmed.length >= 65536 ? 'whole' : null
    }
  }
  const newline = text.indexOf('\n')
  if (newline !== -1) return 'plain'
  return text.length >= 4096 ? 'plain' : null
}

function runEndpointStream(config, protocol, args) {
  const callbacks = args || {}
  const onStart = typeof callbacks.onStart === 'function' ? callbacks.onStart : null
  const onChunk = typeof callbacks.onChunk === 'function' ? callbacks.onChunk : null
  const onDone = typeof callbacks.onDone === 'function' ? callbacks.onDone : null
  const onCancelled = typeof callbacks.onCancelled === 'function' ? callbacks.onCancelled : null
  const onError = typeof callbacks.onError === 'function' ? callbacks.onError : null

  let request
  try {
    request = buildRequest(config, protocol, callbacks)
  } catch (error) {
    if (onError) onError(error)
    return { cancel() {} }
  }

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
    if (onError) onError(error)
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

/**
 * 预览内容 → 可进正文的 HTML。UI 层用它把 markdown 结果渲染成真实格式，
 * 而不是把 `**粗体**` 原样塞进文档。
 */
export function normalizePreviewHtml(text, contentFormat) {
  return previewToHtml(text, contentFormat)
}

export { previewToHtml, markdownToHtml, looksLikeMarkdown, plainTextToHtml, singleParagraphInner } from './markdown'
export { buildMessages, buildUserPrompt, resolveSystemPrompt, ACTION_PROMPTS } from './prompt'
export { createSseDecoder, postStream, looksLikeSse } from './transport'
export { createFrameParser, extractWholeBody, pickText, PROTOCOL_NAMES } from './protocol'
