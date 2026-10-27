'use strict'

/**
 * AI 适配层校验。
 *
 * 覆盖四件事：
 * 1. 入参归一化：字符串 / endpoint / baseURL / {stream} / 函数 / enabled:false 六种写法
 * 2. 协议解析：OpenAI、自家 chatStream、整包 JSON、纯文本、错误帧
 * 3. 传输：XHR 增量游标、SSE 跨块切帧、取消语义、HTTP 错误文案
 * 4. 显示：markdown 渲染、预览格式判定、单段落内联判定、action 指令
 *
 * 不依赖浏览器与真实网络：用 FakeXHR 驱动 postStream。
 */

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const sourceRoot = path.resolve(__dirname, '../src')
const originalLoader = require.extensions['.js']
require.extensions['.js'] = (module, filename) => {
  if (!filename.startsWith(sourceRoot + path.sep)) return originalLoader(module, filename)
  const { code } = require('@babel/core').transformSync(fs.readFileSync(filename, 'utf8'), {
    babelrc: false,
    configFile: false,
    plugins: ['@babel/plugin-transform-modules-commonjs'],
  })
  module._compile(code, filename)
}

// ---------------------------------------------------------------------------
// FakeXHR：把 readyState 变化暴露成 push / close，便于逐块喂响应。
// ---------------------------------------------------------------------------

class FakeXHR {
  constructor() {
    FakeXHR.last = this
    this.readyState = 0
    this.status = 0
    this.responseText = ''
    this.requestHeaders = {}
    this.withCredentials = false
    this.timeout = 0
    this.aborted = false
    this.sentBody = null
    this.sentUrl = ''
    this.sentMethod = ''
  }

  open(method, url) {
    this.sentMethod = method
    this.sentUrl = url
    this.readyState = 1
  }

  setRequestHeader(name, value) {
    this.requestHeaders[name] = value
  }

  send(body) {
    this.sentBody = body
  }

  abort() {
    this.aborted = true
    if (this.onabort) this.onabort()
  }

  header(name) {
    const key = Object.keys(this.requestHeaders).find(item => item.toLowerCase() === name.toLowerCase())
    return key === undefined ? undefined : this.requestHeaders[key]
  }

  /** 追加一块响应体，并把状态推进到 readyState=3。 */
  push(chunk, status) {
    if (status !== undefined) this.status = status
    else if (!this.status) this.status = 200
    this.responseText += chunk
    if (this.readyState < 3) this.readyState = 3
    if (this.onreadystatechange) this.onreadystatechange()
    if (this.onprogress) this.onprogress()
    return this
  }

  /** 收尾：readyState=4。code 为非 2xx 时模拟 HTTP 错误。 */
  close(code) {
    this.status = code === undefined ? (this.status || 200) : code
    this.readyState = 4
    if (this.onreadystatechange) this.onreadystatechange()
    if (this.onload) this.onload()
    return this
  }
}

global.XMLHttpRequest = FakeXHR

const aiRoot = path.resolve(sourceRoot, 'components/lark-doc/ai')
const {
  normalizeAIProvider, normalizePreviewHtml,
  AI_KINDS, AI_CONTENT_FORMATS,
} = require(path.join(aiRoot, 'index.js'))
const { postStream, createSseDecoder, looksLikeSse } = require(path.join(aiRoot, 'transport.js'))
const {
  pickText, isDoneSignal, createFrameParser, extractWholeBody, httpAcceptFor, PROTOCOL_NAMES,
} = require(path.join(aiRoot, 'protocol.js'))
const {
  ACTION_PROMPTS, resolveSystemPrompt, buildUserPrompt, buildMessages,
} = require(path.join(aiRoot, 'prompt.js'))
const {
  markdownToHtml, looksLikeMarkdown, plainTextToHtml, previewToHtml, singleParagraphInner,
} = require(path.join(aiRoot, 'markdown.js'))
const { AI_ACTIONS } = require(path.resolve(sourceRoot, 'components/lark-doc/mockAI.js'))

function fresh() {
  FakeXHR.last = null
}

/** 起一次生成，收集回调结果。 */
function startStream(provider, args) {
  fresh()
  const record = { chunks: [], started: 0, done: 0, cancelled: 0, errors: [] }
  const handle = provider.stream({
    ...(args || {}),
    onStart() { record.started += 1 },
    onChunk(text) { record.chunks.push(text) },
    onDone() { record.done += 1 },
    onCancelled() { record.cancelled += 1 },
    onError(error) { record.errors.push(error) },
  })
  return { record, handle, xhr: FakeXHR.last }
}

// ---------------------------------------------------------------------------
// 1. 入参归一化
// ---------------------------------------------------------------------------

assert.strictEqual(normalizeAIProvider(null), null, 'null 应回退到本地 Mock')
assert.strictEqual(normalizeAIProvider(undefined), null, 'undefined 应回退到本地 Mock')
assert.strictEqual(normalizeAIProvider(false), null, 'false 应回退到本地 Mock')
assert.strictEqual(normalizeAIProvider(''), null, '空字符串应回退到本地 Mock')
assert.strictEqual(normalizeAIProvider('   '), null, '纯空白字符串应回退到本地 Mock')
assert.strictEqual(normalizeAIProvider(123), null, '数字不是合法配置')
assert.strictEqual(normalizeAIProvider([]), null, '数组不是合法配置')
assert.strictEqual(normalizeAIProvider({ foo: 1 }), null, '认不出来的对象应回退到本地 Mock')
assert.strictEqual(normalizeAIProvider({ endpoint: '/api/ai', enabled: false }), null, 'enabled:false 显式关闭')

// L1：只给地址
const byString = normalizeAIProvider('  https://api.example.com/ai  ')
assert.strictEqual(byString.kind, 'endpoint', 'L1 字符串应收敛为 endpoint')
assert.strictEqual(byString.protocol, 'auto', 'L1 字符串默认 auto 协议')
assert.strictEqual(byString.endpoint, 'https://api.example.com/ai', 'endpoint 应去掉首尾空白')
assert.strictEqual(byString.contentFormat, 'auto', '内容格式默认 auto')
assert.strictEqual(typeof byString.stream, 'function', 'endpoint provider 必须有 stream 方法')

// L1：显式协议
const byEndpoint = normalizeAIProvider({ endpoint: '/api/ai', protocol: 'json' })
assert.strictEqual(byEndpoint.kind, 'endpoint')
assert.strictEqual(byEndpoint.protocol, 'json', '宿主指定的协议应保留')

// L2：直连模型服务
const byBaseUrl = normalizeAIProvider({ baseURL: 'https://api.openai.com/v1/', apiKey: 'sk-1', model: 'gpt-4o-mini' })
assert.strictEqual(byBaseUrl.kind, 'endpoint')
assert.strictEqual(byBaseUrl.protocol, 'openai', 'baseURL 形态默认 openai 协议')
assert.strictEqual(byBaseUrl.baseURL, 'https://api.openai.com/v1/')

// L2 的别名与 urlPath
assert.strictEqual(normalizeAIProvider({ baseUrl: 'https://x/v1' }).protocol, 'openai', 'baseUrl 别名同样识别')
assert.strictEqual(normalizeAIProvider({ url: '/api/x' }).kind, 'endpoint', 'url 是 endpoint 的别名')
assert.strictEqual(normalizeAIProvider({ api: '/api/x' }).kind, 'endpoint', 'api 是 endpoint 的别名')

// L3：旧钩子
let hookArgs = null
const byHook = normalizeAIProvider({
  contentFormat: 'Markdown',
  stream(args) { hookArgs = args; return { cancel() { hookArgs.cancelledBy = 'handle' } } },
})
assert.strictEqual(byHook.kind, 'stream', 'L3 stream 钩子收敛为 stream provider')
assert.strictEqual(byHook.protocol, 'custom', '自管传输的协议标记为 custom')
assert.strictEqual(byHook.contentFormat, 'markdown', 'contentFormat 应大小写归一')
assert.strictEqual(normalizeAIProvider({ endpoint: '/x', contentFormat: 'bogus' }).contentFormat, 'auto', '非法 contentFormat 回落 auto')

// L3：generate 别名 + 返回函数时自动包成 {cancel}
let generateCalled = 0
const byGenerate = normalizeAIProvider({ generate() { generateCalled += 1; return () => { generateCalled += 10 } } })
assert.strictEqual(byGenerate.kind, 'stream', 'generate 是 stream 的别名')
const generateHandle = byGenerate.stream({ action: 'title' })
assert.strictEqual(generateCalled, 1, '钩子应被调用一次')
assert.strictEqual(typeof generateHandle.cancel, 'function', '返回函数时应包装成 {cancel}')
generateHandle.cancel()
assert.strictEqual(generateCalled, 11, 'cancel 应转发给宿主返回的函数')

// L3：函数简写
const byFunction = normalizeAIProvider(() => ({ cancel() {} }))
assert.strictEqual(byFunction.kind, 'stream', '函数简写等价于 {stream}')

// 钩子返回 undefined 时也要给出可用的 cancel
assert.strictEqual(typeof normalizeAIProvider({ stream() {} }).stream({}).cancel, 'function', '钩子无返回时补空 cancel')

// 幂等：门面（LarkDoc.js）与 UI 层（Workspace.aiAdapter）会各归一化一次，
// 第二次必须原样返回，否则 endpoint 会被降级成 stream provider。
const endpointTwice = normalizeAIProvider(normalizeAIProvider({ endpoint: '/api/ai', contentFormat: 'markdown' }))
assert.strictEqual(endpointTwice.kind, 'endpoint', '重复归一化不得把 endpoint 降级成 stream')
assert.strictEqual(endpointTwice.contentFormat, 'markdown', '重复归一化应保留 contentFormat')
const hookTwice = normalizeAIProvider(normalizeAIProvider({ stream() {} }))
assert.strictEqual(hookTwice.kind, 'stream', 'stream provider 重复归一化保持 stream')

assert.deepStrictEqual([].concat(AI_KINDS), ['stream', 'endpoint'])
assert.deepStrictEqual([].concat(AI_CONTENT_FORMATS), ['auto', 'markdown', 'html', 'text'])
assert.ok(Object.isFrozen(AI_KINDS), 'AI_KINDS 应为不可变常量')

// ---------------------------------------------------------------------------
// 2. 协议解析
// ---------------------------------------------------------------------------

assert.strictEqual(pickText({ choices: [{ delta: { content: 'ab' } }] }), 'ab', 'OpenAI 流式帧')
assert.strictEqual(pickText({ choices: [{ message: { content: 'hi' } }] }), 'hi', 'OpenAI 非流式帧')
assert.strictEqual(pickText({ choices: [{ text: 't' }] }), 't', 'completions 老字段')
assert.strictEqual(pickText({ content: 'c' }), 'c', '常见扁平字段')
assert.strictEqual(pickText({ answer: 'a' }), 'a', 'answer 字段')
assert.strictEqual(pickText({ token: 'tk' }), 'tk', 'token 字段')
assert.strictEqual(pickText({ data: { content: 'd' } }), 'd', 'data 套壳')
assert.strictEqual(pickText({ result: { answer: 'r' } }), 'r', 'result 套壳')
assert.strictEqual(pickText({ message: { content: 'm' } }), 'm', 'message 套壳')
assert.strictEqual(pickText([{ content: 'x' }, { content: 'y' }]), 'xy', '数组拼接')
assert.strictEqual(pickText(null), '', 'null 安全')
assert.strictEqual(pickText({ count: 1 }), '', '无文本字段返回空串')

let deep = { content: 'never' }
for (let i = 0; i < 8; i += 1) deep = { data: deep }
assert.strictEqual(pickText(deep), '', '嵌套过深时截断，不递归到底')

assert.strictEqual(isDoneSignal({ done: true }), true)
assert.strictEqual(isDoneSignal({ finished: true }), true)
assert.strictEqual(isDoneSignal({ is_end: true }), true)
assert.strictEqual(isDoneSignal({}, 'done'), true, '事件名 done')
assert.strictEqual(isDoneSignal({}, 'message_end'), true, '事件名 message_end')
assert.strictEqual(isDoneSignal({ event: 'finish' }), true, 'event 字段')
assert.strictEqual(isDoneSignal({ status: 'end' }), true, 'status 字段')
assert.strictEqual(isDoneSignal({ choices: [{ finish_reason: 'stop' }] }), true, 'finish_reason')
assert.strictEqual(isDoneSignal({ choices: [{ finish_reason: null }] }), false, 'finish_reason 为空不算结束')
assert.strictEqual(isDoneSignal({ content: 'x' }), false, '普通帧不算结束')
assert.strictEqual(isDoneSignal(null), false, 'null 安全')

assert.strictEqual(createFrameParser(undefined).name, 'auto', '未知协议回落 auto')
assert.strictEqual(createFrameParser('nope').name, 'auto', '非法协议名回落 auto')
assert.deepStrictEqual([].concat(PROTOCOL_NAMES).sort(), ['auto', 'chatStream', 'json', 'openai'])

const openaiParser = createFrameParser('openai')
assert.deepStrictEqual(openaiParser.parse('[DONE]'), { delta: '', done: true }, '[DONE] 结束信号')
assert.deepStrictEqual(openaiParser.parse(''), { delta: '' }, '空帧')
assert.strictEqual(openaiParser.parse('{"choices":[{"delta":{"content":"你"}}]}').delta, '你')
const openaiError = openaiParser.parse('{"error":{"message":"额度不足"}}')
assert.ok(openaiError.error instanceof Error, 'error 字段应转成 Error')
assert.strictEqual(openaiError.error.message, '额度不足')
assert.strictEqual(openaiParser.parse('plain-ish').delta, 'plain-ish', '非 JSON 帧按原文透传')

const chatParser = createFrameParser('chatStream')
assert.strictEqual(chatParser.parse('{"success":false,"message":"bad"}').error.message, 'bad', 'success:false 视为错误')
assert.strictEqual(chatParser.parse('{"msg":"x","success":false}').error.message, 'x', 'msg 字段兜底')
assert.strictEqual(chatParser.parse('{"content":"ok"}').delta, 'ok')
assert.deepStrictEqual(chatParser.parse('tail', 'end'), { delta: '', done: true }, '结束事件后不再追加文本')
assert.deepStrictEqual(chatParser.parse('{"choices":[{"finish_reason":"stop"}]}').done, true)

assert.strictEqual(extractWholeBody('{"content":"hello"}'), 'hello', '整包 JSON 取正文')
assert.strictEqual(extractWholeBody('  plain text  '), 'plain text', '非 JSON 整段返回')
assert.strictEqual(extractWholeBody(''), '', '空响应')
assert.throws(() => extractWholeBody('{"error":"boom"}'), /boom/, '整包错误要抛出')

assert.strictEqual(httpAcceptFor('openai'), 'text/event-stream')
assert.strictEqual(httpAcceptFor('json'), 'application/json')
assert.strictEqual(httpAcceptFor('auto'), 'text/event-stream, application/json, text/plain, */*')

// ---------------------------------------------------------------------------
// 3. SSE 解码与传输
// ---------------------------------------------------------------------------

const sseEvents = []
const decoder = createSseDecoder({ onEvent: event => sseEvents.push(event) })
decoder.push('data: {"content":"你')
decoder.push('好"}\n')
assert.strictEqual(sseEvents.length, 0, '未遇到空行不派发')
decoder.push('\n')
assert.strictEqual(sseEvents.length, 1, '空行派发一个事件')
assert.strictEqual(sseEvents[0].data, '{"content":"你好"}', '跨块断行应拼回同一行')
decoder.push(': keep-alive\n\n')
assert.strictEqual(sseEvents.length, 1, '注释行忽略')
decoder.push('event: done\nid: 7\ndata: [DONE]\n\n')
assert.strictEqual(sseEvents[1].event, 'done', 'event 字段解析')
assert.strictEqual(sseEvents[1].id, '7', 'id 字段解析')
assert.strictEqual(sseEvents[1].data, '[DONE]')
decoder.push('data: tail')
decoder.end()
assert.strictEqual(sseEvents[2].data, 'tail', 'end() 应冲掉没有空行收尾的最后一帧')

const multiLine = []
const multiDecoder = createSseDecoder({ onEvent: event => multiLine.push(event.data) })
multiDecoder.push('data: line1\ndata: line2\n\n')
assert.deepStrictEqual(multiLine, ['line1\nline2'], '多行 data 用 \\n 拼接')

const crlf = []
const crlfDecoder = createSseDecoder({ onEvent: event => crlf.push(event.data) })
crlfDecoder.push('data: a\r\n\r\n')
assert.deepStrictEqual(crlf, ['a'], 'CRLF 应剥掉 \\r')

assert.strictEqual(looksLikeSse('data: x\n\n'), true)
assert.strictEqual(looksLikeSse('{"content":"x"}'), false)

// postStream 直接调用：请求组装 + 增量游标 + 取消
fresh()
const direct = []
const directHandle = postStream({
  url: '/api/ai',
  headers: { 'X-Token': 'k' },
  body: { a: 1 },
  onText: chunk => direct.push(chunk),
})
const directXhr = FakeXHR.last
assert.strictEqual(directXhr.sentMethod, 'POST', '默认 POST')
assert.strictEqual(directXhr.sentUrl, '/api/ai')
assert.strictEqual(directXhr.sentBody, '{"a":1}', '对象 body 自动序列化')
assert.strictEqual(directXhr.header('Content-Type'), 'application/json;charset=UTF-8', '自动补 Content-Type')
assert.strictEqual(directXhr.header('X-Token'), 'k', '宿主 header 保留')
assert.ok(directXhr.header('Accept').includes('text/event-stream'), '默认 Accept 覆盖流式')
directXhr.push('ab')
directXhr.push('cd')
assert.deepStrictEqual(direct, ['ab', 'cd'], '游标只吐增量，不重复')
directXhr.close()
assert.deepStrictEqual(direct, ['ab', 'cd'], '结束后不再追加')
directHandle.cancel()
assert.strictEqual(directXhr.aborted, false, '已结束的流 cancel 是空操作')

assert.throws(() => postStream({}), /endpoint|baseURL/, '缺 url 要明确报错')

fresh()
const httpError = []
const errorHandle = postStream({
  url: '/api/ai',
  onError: error => httpError.push(error),
})
assert.strictEqual(FakeXHR.last.sentBody, null, '无 body 时传 null')
FakeXHR.last.responseText = '{"message":"模型不可用"}'
FakeXHR.last.close(500)
assert.strictEqual(httpError.length, 1, 'HTTP 非 2xx 触发 onError')
assert.strictEqual(httpError[0].status, 500, '错误对象带 status')
assert.ok(httpError[0].message.includes('HTTP 500'), '错误文案含状态码')
assert.ok(httpError[0].message.includes('模型不可用'), '错误文案含后端 message')
assert.strictEqual(httpError[0].body, '{"message":"模型不可用"}', '错误对象带原始 body')
errorHandle.cancel()

fresh()
const plainError = []
postStream({ url: '/api/ai', onError: error => plainError.push(error) })
FakeXHR.last.responseText = 'upstream exploded'
FakeXHR.last.close(502)
assert.ok(plainError[0].message.includes('upstream exploded'), '非 JSON 错误体截断进文案')

// ---------------------------------------------------------------------------
// 4. endpoint provider 端到端：四种响应形态自适应
// ---------------------------------------------------------------------------

const sseProvider = normalizeAIProvider({ endpoint: '/api/ai', protocol: 'auto' })
const sseRun = startStream(sseProvider, {
  action: 'rewrite', text: '原文', prompt: '', language: 'zh',
  range: { from: 0, to: 2, source: 'selection' },
})
assert.strictEqual(sseRun.xhr.sentUrl, '/api/ai')
const sseBody = JSON.parse(sseRun.xhr.sentBody)
assert.deepStrictEqual(Object.keys(sseBody).sort(), ['action', 'language', 'prompt', 'range', 'text'], '自家协议 body 是扁平参数，不是 OpenAI messages')
assert.strictEqual(sseBody.action, 'rewrite', '动作要带给后端，宿主据此区分续写/润色')
assert.strictEqual(sseBody.text, '原文')
assert.strictEqual(sseBody.language, 'zh')
assert.deepStrictEqual(sseBody.range, { from: 0, to: 2, source: 'selection' })
assert.strictEqual(sseRun.xhr.header('Content-Type'), 'application/json;charset=UTF-8')

sseRun.xhr.push('data: {"content":"改"}\n\n')
sseRun.xhr.push('data: {"content":"好"}\n\n')
assert.deepStrictEqual(sseRun.record.chunks, ['改', '好'], 'SSE 逐帧回调 onChunk')
assert.strictEqual(sseRun.record.done, 0, '未收到结束帧不能完成')
sseRun.xhr.push('data: [DONE]\n\n')
sseRun.xhr.close()
assert.strictEqual(sseRun.record.done, 1, 'onDone 只触发一次')
assert.strictEqual(sseRun.record.errors.length, 0)
assert.ok(sseRun.record.started >= 1, 'onStart 应在首块到达时触发')

// 整包 JSON
const wholeProvider = normalizeAIProvider({ endpoint: '/api/ai', protocol: 'auto' })
const wholeRun = startStream(wholeProvider, { action: 'summarize', text: 'x' })
wholeRun.xhr.push('{"content":"整段')
assert.deepStrictEqual(wholeRun.record.chunks, [], 'JSON 未闭合前不吐字，避免露出半截花括号')
wholeRun.xhr.push('结果"}')
wholeRun.xhr.close()
assert.deepStrictEqual(wholeRun.record.chunks, ['整段结果'], '整包 JSON 一次性回调')
assert.strictEqual(wholeRun.record.done, 1)

// stream: false 时直接按整包处理，不做自适应的 ASCII 猜测
const wholeOnly = normalizeAIProvider({ endpoint: '/api/ai', stream: false })
const wholeOnlyRun = startStream(wholeOnly, { action: 'title', text: 'x' })
assert.strictEqual(JSON.parse(wholeOnlyRun.xhr.sentBody).action, 'title', 'stream:false 不影响自家协议的扁平 body')
wholeOnlyRun.xhr.push('{"answer":"纯正文"}')
assert.deepStrictEqual(wholeOnlyRun.record.chunks, [], 'stream:false 期间不增量回调')
wholeOnlyRun.xhr.close()
assert.deepStrictEqual(wholeOnlyRun.record.chunks, ['纯正文'], 'stream:false 收尾时整段回调')

// 纯文本流
const plainProvider = normalizeAIProvider({ endpoint: '/api/ai' })
const plainRun = startStream(plainProvider, { action: 'continue', text: 'x' })
plainRun.xhr.push('第一行\n')
plainRun.xhr.push('第二行')
plainRun.xhr.close()
assert.strictEqual(plainRun.record.chunks.join(''), '第一行\n第二行', '纯文本流按块透传')
assert.strictEqual(plainRun.record.done, 1)

// 空响应
const emptyProvider = normalizeAIProvider({ endpoint: '/api/ai' })
const emptyRun = startStream(emptyProvider, { action: 'rewrite', text: 'x' })
emptyRun.xhr.close()
assert.deepStrictEqual(emptyRun.record.chunks, [], '空响应不产生 chunk')
assert.strictEqual(emptyRun.record.done, 1, '空响应仍要收尾，否则 UI 卡在生成中')

// 错误帧
const errorProvider = normalizeAIProvider({ endpoint: '/api/ai' })
const errorRun = startStream(errorProvider, { action: 'rewrite', text: 'x' })
errorRun.xhr.push('data: {"error":"模型过载"}\n\n')
assert.strictEqual(errorRun.record.errors.length, 1, '错误帧触发 onError')
assert.strictEqual(errorRun.record.errors[0].message, '模型过载')
assert.strictEqual(errorRun.record.done, 0, '出错后不再 onDone')
errorRun.xhr.push('data: {"content":"迟到"}\n\n')
assert.deepStrictEqual(errorRun.record.chunks, [], '出错后的帧被丢弃')
errorRun.xhr.close()
assert.strictEqual(errorRun.record.done, 0, '出错后收尾不重复回调')

// 取消
const cancelProvider = normalizeAIProvider({ endpoint: '/api/ai' })
const cancelRun = startStream(cancelProvider, { action: 'rewrite', text: 'x' })
cancelRun.xhr.push('data: {"content":"半"}\n\n')
cancelRun.handle.cancel()
assert.strictEqual(cancelRun.xhr.aborted, true, 'cancel 应 abort 底层请求')
assert.strictEqual(cancelRun.record.cancelled, 1, 'onCancelled 触发一次')
assert.strictEqual(cancelRun.record.done, 0, '取消不应再 onDone')
cancelRun.xhr.push('data: {"content":"后"}\n\n')
assert.deepStrictEqual(cancelRun.record.chunks, ['半'], '取消后不再追加')
assert.strictEqual(cancelRun.record.cancelled, 1, '重复取消不重复回调')

// OpenAI 直连：URL / 鉴权 / messages 组装
const openaiProvider = normalizeAIProvider({
  baseURL: 'https://api.openai.com/v1/', apiKey: 'sk-test', model: 'gpt-4o-mini',
})
const openaiRun = startStream(openaiProvider, { action: 'translate', text: 'hello', language: 'en' })
assert.strictEqual(openaiRun.xhr.sentUrl, 'https://api.openai.com/v1/chat/completions', '默认拼 /chat/completions')
assert.strictEqual(openaiRun.xhr.header('Authorization'), 'Bearer sk-test', 'apiKey 自动进 Authorization')
assert.strictEqual(openaiRun.xhr.header('Accept'), 'text/event-stream')
const openaiBody = JSON.parse(openaiRun.xhr.sentBody)
assert.strictEqual(openaiBody.model, 'gpt-4o-mini')
assert.strictEqual(openaiBody.stream, true)
assert.deepStrictEqual(openaiBody.messages.map(item => item.role), ['system', 'user'], 'OpenAI 用 system + user 两条')
assert.ok(openaiBody.messages[0].content.includes('英文'), 'translate 应把目标语言拼进指令')
assert.strictEqual(openaiBody.messages[1].content, 'hello')
openaiRun.xhr.push('data: {"choices":[{"delta":{"content":"hel"}}]}\n\n')
openaiRun.xhr.push('data: {"choices":[{"delta":{"content":"lo"}}]}\n\n')
openaiRun.xhr.push('data: [DONE]\n\n')
openaiRun.xhr.close()
assert.deepStrictEqual(openaiRun.record.chunks, ['hel', 'lo'], 'OpenAI 帧走 choices[0].delta.content')
assert.strictEqual(openaiRun.record.done, 1)

// 宿主的 messages / transformRequest / params 覆盖
const customProvider = normalizeAIProvider({
  baseURL: 'https://x/v1', apiKey: () => 'late-key', params: { temperature: 0.2 },
  messages: args => [{ role: 'user', content: `动作:${args.action}` }],
  transformRequest: request => ({ headers: { ...request.headers, 'X-Trace': 'trace-1' } }),
})
const customRun = startStream(customProvider, { action: 'outline', text: 'x' })
assert.strictEqual(customRun.xhr.header('Authorization'), 'Bearer late-key', 'apiKey 支持函数延迟取值')
assert.strictEqual(customRun.xhr.header('X-Trace'), 'trace-1', 'transformRequest 可改写请求')
assert.strictEqual(JSON.parse(customRun.xhr.sentBody).temperature, 0.2, 'params 合并进 body')
assert.strictEqual(JSON.parse(customRun.xhr.sentBody).messages[0].content, '动作:outline', 'messages 钩子覆盖默认组装')
customRun.xhr.close()

// ---------------------------------------------------------------------------
// 5. 动作指令
// ---------------------------------------------------------------------------

AI_ACTIONS.forEach((action) => {
  const system = resolveSystemPrompt(action.value, 'zh')
  assert.strictEqual(typeof system, 'string', `${action.value} 必须有系统指令`)
  assert.ok(system.length > 8, `${action.value} 的指令不能是占位`)
})
assert.ok(resolveSystemPrompt('translate', 'en').includes('英文'), 'translate 目标语言 en')
assert.ok(resolveSystemPrompt('translate', 'zh-cn').includes('简体中文'), '目标语言 zh-cn')
assert.ok(resolveSystemPrompt('translate', 'ja').includes('日文'), '目标语言 ja')
assert.ok(resolveSystemPrompt('translate', 'kl').includes('kl'), '未知语言原样拼入')
assert.strictEqual(resolveSystemPrompt('translate', ''), ACTION_PROMPTS.translate, '没有语言时退回通用指令')
assert.ok(resolveSystemPrompt('unknown-action').includes('按指令处理'), '未定义动作有兜底指令')

assert.strictEqual(buildUserPrompt('rewrite', 'abc', ''), 'abc', '改写动作就是把原文发过去')
assert.strictEqual(buildUserPrompt('chat', '', '为什么'), '为什么', 'chat 无上下文时只发问题')
assert.strictEqual(
  buildUserPrompt('chat', 'ctx', '为什么'),
  '以下是文档上下文，供你参考：\n\nctx\n\n用户的问题：为什么',
  'chat 把上下文和问题分开标注'
)
assert.ok(buildUserPrompt('chat', 'ctx', '').includes('请概括上面的内容'), 'chat 空问题时给默认问法')
assert.strictEqual(buildUserPrompt('custom', 'abc', '更正式'), '要求：更正式\n\n内容：\nabc', 'custom 拼要求与内容')
assert.strictEqual(buildUserPrompt('rewrite', '', '更正式'), '更正式', '没有正文时退回 prompt')

assert.deepStrictEqual(buildMessages('title', 'abc', '', 'zh').map(item => item.role), ['system', 'user'])
assert.deepStrictEqual(buildMessages('title', '', '', 'zh').map(item => item.role), ['system'], '没有正文时只发 system')

// ---------------------------------------------------------------------------
// 6. markdown 渲染与预览格式
// ---------------------------------------------------------------------------

assert.strictEqual(markdownToHtml('# 标题'), '<h1>标题</h1>')
assert.strictEqual(markdownToHtml('### 三级'), '<h3>三级</h3>')
assert.strictEqual(markdownToHtml('- a\n- b'), '<ul><li><p>a</p></li><li><p>b</p></li></ul>')
assert.strictEqual(markdownToHtml('1. a\n2. b'), '<ol><li><p>a</p></li><li><p>b</p></li></ol>')
assert.strictEqual(markdownToHtml('3. a\n4. b'), '<ol start="3"><li><p>a</p></li><li><p>b</p></li></ol>', '有序列表保留起始序号')
assert.strictEqual(markdownToHtml('- 第一项\n  续行'), '<ul><li><p>第一项 续行</p></li></ul>', '悬挂缩进并入上一项')
assert.strictEqual(markdownToHtml('> 引用'), '<blockquote><p>引用</p></blockquote>')
assert.strictEqual(markdownToHtml('---'), '<hr>')
assert.strictEqual(markdownToHtml('```js\nconst a = 1\n```'), '<pre><code class="language-js">const a = 1</code></pre>')
assert.strictEqual(markdownToHtml('**粗** 和 *斜*'), '<p><strong>粗</strong> 和 <em>斜</em></p>')
assert.strictEqual(markdownToHtml('~~删~~'), '<p><s>删</s></p>')
assert.strictEqual(markdownToHtml('`code`'), '<p><code>code</code></p>')
assert.strictEqual(markdownToHtml('[文档](https://x.com)'), '<p><a href="https://x.com">文档</a></p>')
assert.strictEqual(markdownToHtml('<script>alert(1)</script>').includes('&lt;script&gt;'), true, 'HTML 必须逃生')
assert.strictEqual(markdownToHtml('**<b>x</b>**'), '<p><strong>&lt;b&gt;x&lt;/b&gt;</strong></p>', '强调内的 HTML 同样逃生')
assert.strictEqual(markdownToHtml('[x](javascript:alert(1))'), '<p>x</p>', '危险协议丢弃 href，只留文字')
assert.strictEqual(markdownToHtml('[x](/safe/path)').includes('href="/safe/path"'), true, '站内相对路径放行')
assert.strictEqual(
  markdownToHtml('[wiki](https://x.com/a_(b))'),
  '<p><a href="https://x.com/a_(b)">wiki</a></p>',
  '地址里的一层括号不应截断链接'
)
assert.strictEqual(markdownToHtml(''), '')
assert.strictEqual(markdownToHtml('   '), '')
assert.strictEqual(markdownToHtml('普通一段'), '<p>普通一段</p>')

assert.strictEqual(looksLikeMarkdown('## 小标题'), true)
assert.strictEqual(looksLikeMarkdown('- 列表'), true)
assert.strictEqual(looksLikeMarkdown('**粗体**'), true)
assert.strictEqual(looksLikeMarkdown('`code`'), true)
assert.strictEqual(looksLikeMarkdown('这是一段普通的中文正文，没有任何语法。'), false)
assert.strictEqual(looksLikeMarkdown(''), false)

assert.strictEqual(plainTextToHtml('a\nb'), '<p>a<br>b</p>', '单换行保留为 <br>')
assert.strictEqual(plainTextToHtml('a\n\nb'), '<p>a</p><p>b</p>', '空行分段')
assert.strictEqual(plainTextToHtml('<b>x</b>'), '<p>&lt;b&gt;x&lt;/b&gt;</p>', '纯文本模式也要逃生')
assert.strictEqual(plainTextToHtml(''), '')

assert.strictEqual(previewToHtml('## 标题', 'text'), '<p>## 标题</p>', 'format=text 不做 markdown 解析')
assert.strictEqual(previewToHtml('# 标题', 'markdown'), '<h1>标题</h1>')
assert.strictEqual(previewToHtml('<h1>已渲染</h1>', 'html'), '<h1>已渲染</h1>', 'format=html 原样透传')
assert.strictEqual(previewToHtml('## 标题', 'auto'), '<h2>标题</h2>', 'auto 识别 markdown')
assert.strictEqual(previewToHtml('普通正文', 'auto'), '<p>普通正文</p>', 'auto 对纯文本段落化')
assert.strictEqual(previewToHtml('', 'auto'), '')
assert.strictEqual(normalizePreviewHtml('**x**', 'auto'), '<p><strong>x</strong></p>', 'index 暴露的入口与 markdown 模块一致')

assert.strictEqual(singleParagraphInner('<p>abc</p>'), 'abc', '单段落返回段内 inline')
assert.strictEqual(singleParagraphInner('<p>a<br>b</p>'), 'a<br>b', '段内 <br> 可保留')
assert.strictEqual(singleParagraphInner('  <p>abc</p>  '), 'abc', '首尾空白可容忍')
assert.strictEqual(singleParagraphInner('<p>a</p><p>b</p>'), null, '多段落不能内联替换')
assert.strictEqual(singleParagraphInner('<h1>t</h1>'), null, '标题不是段落')
assert.strictEqual(singleParagraphInner('<ul><li><p>a</p></li></ul>'), null, '列表不是段落')
assert.strictEqual(singleParagraphInner(''), null)
assert.strictEqual(singleParagraphInner(null), null)

// 预览与落正文必须是同一份 HTML，否则「看到的」和「插进去的」不一致
const richText = '## 方案\n\n**要点** 一\n\n- 子项'
assert.strictEqual(normalizePreviewHtml(richText, 'auto'), previewToHtml(richText, 'auto'))

console.log(`AI adapter checks passed: normalization, protocol frames, SSE transport, prompt actions, markdown rendering (${AI_ACTIONS.length} actions covered)`)
