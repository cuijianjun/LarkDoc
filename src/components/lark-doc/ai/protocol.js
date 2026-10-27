/**
 * 响应协议解析。三种协议共用一套「帧 → {delta, done, error}」接口，
 * 上层只管把 delta 累加进预览，不需要知道后端是 OpenAI 还是自家 chatStream。
 */

const TEXT_KEYS = ['content', 'text', 'delta', 'answer', 'output', 'reply', 'chunk', 'token']
const DONE_WORDS = /^(done|end|finish|finished|complete|completed|stop|close)$/i
const DONE_EVENTS = /^(done|end|finish|complete|completed|message_end)$/i

/**
 * 从任意形状的 JSON 里挖出可显示的文本。
 * 覆盖 OpenAI（choices[].delta.content）、自家后端（content/text/delta/answer）、
 * 以及常见的 `{data:{...}}` / `{result:{...}}` 套壳。
 */
export function pickText(node, depth) {
  const level = depth || 0
  if (node === null || node === undefined || level > 4) return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number' || typeof node === 'boolean') return ''
  if (Array.isArray(node)) return node.map(item => pickText(item, level + 1)).join('')
  if (typeof node !== 'object') return ''

  const choice = Array.isArray(node.choices) ? node.choices[0] : null
  if (choice && typeof choice === 'object') {
    const fromDelta = pickText(choice.delta, level + 1)
    if (fromDelta) return fromDelta
    const fromMessage = pickText(choice.message, level + 1)
    if (fromMessage) return fromMessage
    if (typeof choice.text === 'string') return choice.text
  }

  for (let i = 0; i < TEXT_KEYS.length; i += 1) {
    const value = node[TEXT_KEYS[i]]
    if (typeof value === 'string') return value
  }
  for (let i = 0; i < TEXT_KEYS.length; i += 1) {
    const value = node[TEXT_KEYS[i]]
    if (value && typeof value === 'object') {
      const nested = pickText(value, level + 1)
      if (nested) return nested
    }
  }
  if (node.message && typeof node.message === 'object') return pickText(node.message, level + 1)
  if (node.data !== undefined && node.data !== null) return pickText(node.data, level + 1)
  if (node.result !== undefined && node.result !== null) return pickText(node.result, level + 1)
  return ''
}

export function isDoneSignal(node, eventName) {
  if (eventName && DONE_EVENTS.test(eventName)) return true
  if (!node || typeof node !== 'object') return false
  if (node.done === true || node.finish === true || node.finished === true || node.isEnd === true || node.is_end === true) return true
  const marker = node.event || node.type || node.status
  if (typeof marker === 'string' && DONE_WORDS.test(marker)) return true
  const choice = Array.isArray(node.choices) ? node.choices[0] : null
  if (choice && typeof choice.finish_reason === 'string' && choice.finish_reason) return true
  return false
}

function errorFrom(node) {
  const raw = node && (node.error || (node.success === false ? node.message || node.msg : null))
  if (!raw) return null
  const message = typeof raw === 'string' ? raw : (raw.message || raw.msg || JSON.stringify(raw))
  return new Error(message || 'AI 接口返回错误')
}

function tryJson(data) {
  const text = String(data == null ? '' : data).trim()
  if (!text) return { ok: false, value: null }
  if (text.charAt(0) !== '{' && text.charAt(0) !== '[') return { ok: false, value: null }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (error) {
    return { ok: false, value: null }
  }
}

/** OpenAI / 任何兼容 /v1/chat/completions 的服务。 */
function parseOpenAI(data) {
  const text = String(data == null ? '' : data).trim()
  if (!text) return { delta: '' }
  if (text === '[DONE]') return { delta: '', done: true }
  const parsed = tryJson(text)
  if (!parsed.ok) return { delta: text }
  const failure = errorFrom(parsed.value)
  if (failure) return { delta: '', error: failure }
  return { delta: pickText(parsed.value), done: isDoneSignal(parsed.value) }
}

/** 自家 chatStream：每帧一个 JSON，字段名不固定，靠 pickText 自适应。 */
function parseChatStream(data, eventName) {
  const text = String(data == null ? '' : data).trim()
  if (!text) return { delta: '' }
  if (text === '[DONE]') return { delta: '', done: true }
  const parsed = tryJson(text)
  if (!parsed.ok) return { delta: DONE_EVENTS.test(eventName || '') ? '' : text, done: DONE_EVENTS.test(eventName || '') }
  const failure = errorFrom(parsed.value)
  if (failure) return { delta: '', error: failure }
  return { delta: pickText(parsed.value), done: isDoneSignal(parsed.value, eventName) }
}

const PROTOCOLS = {
  openai: parseOpenAI,
  chatStream: parseChatStream,
  json: parseChatStream,
  auto: parseChatStream,
}

export const PROTOCOL_NAMES = Object.freeze(Object.keys(PROTOCOLS))

export function createFrameParser(protocol) {
  const name = PROTOCOLS[protocol] ? protocol : 'auto'
  const parse = PROTOCOLS[name]
  return {
    name,
    parse(data, eventName) {
      try {
        return parse(data, eventName) || { delta: '' }
      } catch (error) {
        return { delta: '', error }
      }
    },
  }
}

/**
 * 非流式整体响应：一次性把正文挖出来。
 * 顺序：JSON → pickText；失败则整段当纯文本；再失败返回原文。
 */
export function extractWholeBody(raw) {
  const text = String(raw == null ? '' : raw).trim()
  if (!text) return ''
  const parsed = tryJson(text)
  if (parsed.ok) {
    const failure = errorFrom(parsed.value)
    if (failure) throw failure
    const picked = pickText(parsed.value)
    return picked || ''
  }
  return text
}

export function httpAcceptFor(protocol) {
  if (protocol === 'json') return 'application/json'
  if (protocol === 'openai') return 'text/event-stream'
  return 'text/event-stream, application/json, text/plain, */*'
}
