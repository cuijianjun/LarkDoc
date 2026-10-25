/**
 * OpenAI-compatible AI provider.
 *
 * The document workspace already accepts an `aiProvider.stream` hook. This
 * adapter keeps the transport independent from Feishu's tenant quota while
 * preserving the workspace's streaming, cancellation and error states.
 */

function normalizeBaseUrl(value) {
  const url = String(value || '').trim().replace(/\/+$/, '')
  if (!url) throw new Error('AI baseUrl 不能为空')
  return url
}

function parseDataValue(value) {
  const data = String(value || '').trim()
  if (!data || data === '[DONE]') return null
  try { return JSON.parse(data) } catch (_) { return null }
}

function pushDataEvents(data, events) {
  if (!data.length) return
  // Most providers emit one JSON object per `data:` line. Keep support for
  // true multiline SSE payloads by falling back to the joined value.
  const parsed = data.length > 1
    ? data.map(parseDataValue).filter(Boolean)
    : [parseDataValue(data[0])].filter(Boolean)
  if (parsed.length) events.push(...parsed)
  else {
    const joined = parseDataValue(data.join('\n'))
    if (joined) events.push(joined)
  }
}

export function parseSseEvents(chunk) {
  const events = []
  let data = []
  for (const line of String(chunk || '').split(/\r?\n/)) {
    if (line.startsWith(':')) continue
    if (line.startsWith('data:')) {
      data.push(line.slice(5).replace(/^ /, ''))
      continue
    }
    if (!line.trim() && data.length) {
      pushDataEvents(data, events)
      data = []
    }
  }
  if (data.length) {
    pushDataEvents(data, events)
  }
  return events
}

function safeError(error, fallback = 'AI 请求失败', secret = '') {
  if (error?.code === 'AI_CANCELLED') return error
  const message = String(error?.message || fallback)
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(secret ? new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g') : /$^/g, '[redacted]')
  const normalized = new Error(message)
  normalized.code = error?.name === 'AbortError' ? 'AI_CANCELLED' : (error?.code || 'AI_PROVIDER_ERROR')
  normalized.status = error?.status
  return normalized
}

async function readBody(response, onChunk) {
  if (typeof response.body === 'string') {
    for (const event of parseSseEvents(response.body)) onChunk(event)
    return
  }
  if (!response.body?.getReader) {
    const text = typeof response.text === 'function' ? await response.text() : ''
    for (const event of parseSseEvents(text)) onChunk(event)
    return
  }
  const reader = response.body.getReader()
  const decoder = typeof TextDecoder === 'function' ? new TextDecoder() : null
  let pending = ''
  // NOTE: 用 `for (;;)` 而不是 `while (true)` —— 本仓的 no-constant-condition
  // 也检查循环体，`while (true)` 会被判红。
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    pending += decoder ? decoder.decode(value, { stream: true }) : String(value)
    const parts = pending.split(/\r?\n\r?\n/)
    pending = parts.pop() || ''
    for (const event of parseSseEvents(parts.join('\n\n'))) onChunk(event)
  }
  if (decoder) pending += decoder.decode()
  for (const event of parseSseEvents(pending)) onChunk(event)
}

function contentFromEvent(event) {
  return event?.choices?.[0]?.delta?.content || event?.choices?.[0]?.text || ''
}

export function createOpenAICompatibleProvider(options = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl)
  const apiKey = String(options.apiKey || '')
  const model = String(options.model || 'gpt-4o-mini')
  const request = options.request || ((url, init) => fetch(url, init))
  const endpoint = options.endpoint || '/chat/completions'

  function createPayload(input = {}) {
    const action = input.action || 'rewrite'
    const prompt = input.prompt || `Perform the ${action} operation on the supplied document text.`
    const context = input.text || ''
    return {
      model: input.model || model,
      stream: true,
      messages: [
        { role: 'system', content: input.system || 'You are a careful document assistant. Return only the requested result.' },
        { role: 'user', content: `${prompt}\n\nDocument text:\n${context}` },
      ],
    }
  }

  function stream(input = {}) {
    const controller = typeof AbortController === 'function' ? new AbortController() : { signal: undefined, abort() {} }
    let resolveDone
    let rejectDone
    let settled = false
    let cancelled = false
    const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject })
    const finishError = error => {
      if (settled) return
      settled = true
      const normalized = safeError(error, 'AI 请求失败', apiKey)
      if (normalized.code === 'AI_CANCELLED') {
        cancelled = true
        if (input.onCancelled) input.onCancelled()
      } else if (input.onError) input.onError(normalized)
      rejectDone(normalized)
    }
    const finish = value => {
      if (settled) return
      settled = true
      if (input.onDone) input.onDone(value)
      resolveDone(value)
    }
    const run = async () => {
      try {
        if (input.onStart) input.onStart()
        const response = await request(`${baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
          body: JSON.stringify(createPayload(input)),
          signal: controller.signal,
        })
        if (!response?.ok) {
          const error = new Error(`AI 请求失败（HTTP ${response?.status || 0}）`)
          error.status = response?.status
          throw error
        }
        const chunks = []
        await readBody(response, event => {
          const chunk = contentFromEvent(event)
          if (chunk) {
            chunks.push(chunk)
            if (input.onChunk) input.onChunk(chunk)
          }
        })
        if (!cancelled) finish(chunks.join(''))
      } catch (error) {
        finishError(error)
      }
    }
    run()
    return {
      done,
      cancel() {
        if (settled) return
        cancelled = true
        controller.abort()
        const error = new Error('AI 生成已停止')
        error.code = 'AI_CANCELLED'
        finishError(error)
      },
    }
  }

  return {
    baseUrl,
    model,
    stream,
    async generate(input = {}) { return stream(input).done },
  }
}

