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
