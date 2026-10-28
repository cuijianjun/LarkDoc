import { describe, expect, it } from 'vitest'
import {
  ACTION_PROMPTS,
  buildMessages,
  createFrameParser,
  createSseDecoder,
  extractWholeBody,
  looksLikeSse,
  normalizeAIProvider,
  previewToHtml,
  singleParagraphInner,
} from '../../src/components/lark-doc/ai'
// httpAcceptFor 只服务于请求头拼装，适配层入口刻意没有再导出，这里直接测源头模块。
import { httpAcceptFor } from '../../src/components/lark-doc/ai/protocol'

/**
 * 内置 AI 适配层的单测。
 *
 * 与 scripts/check-ai-adapter.js 的分工：那边是发布门禁风格的脚本断言
 * （不入 vitest，npm run check:lark-doc 里跑），这里进 check:unit，
 * 保证这条链路上的回归能被 `npm run test:unit` 直接看到。
 */
describe('AI 适配层 · 四档接入归一化', () => {
  it('空值一律归一化为 null（组件据此回退本地 Mock）', () => {
    expect(normalizeAIProvider(null)).toBe(null)
    expect(normalizeAIProvider(undefined)).toBe(null)
    expect(normalizeAIProvider(false)).toBe(null)
    expect(normalizeAIProvider('   ')).toBe(null)
    expect(normalizeAIProvider({ enabled: false })).toBe(null)
  })

  it('L1 只给地址：字符串与 { endpoint } 都收敛成 endpoint provider', () => {
    const fromString = normalizeAIProvider('https://api.example.test/ai')
    expect(fromString.kind).toBe('endpoint')
    expect(fromString.endpoint).toBe('https://api.example.test/ai')
    expect(fromString.protocol).toBe('auto')

    const fromObject = normalizeAIProvider({ endpoint: '/api/ai', protocol: 'json' })
    expect(fromObject.kind).toBe('endpoint')
    expect(fromObject.endpoint).toBe('/api/ai')
    expect(fromObject.protocol).toBe('json')
  })

  it('L2 直连模型服务：只有 baseURL 时自动走 openai 协议', () => {
    const provider = normalizeAIProvider({ baseURL: 'https://llm.example.test/v1', apiKey: 'k', model: 'm' })
    expect(provider.kind).toBe('endpoint')
    expect(provider.protocol).toBe('openai')
    expect(provider.baseURL).toBe('https://llm.example.test/v1')
  })

  it('L3 旧钩子：{ stream } 与函数简写都收敛成 stream provider', () => {
    const hook = () => ({ cancel() {} })
    expect(normalizeAIProvider({ stream: hook }).kind).toBe('stream')
    expect(normalizeAIProvider(hook).kind).toBe('stream')
  })

  it('L3 钩子返回值容错：函数 / { cancel } / 空 都能包出可调用的 cancel', () => {
    const cases = [
      () => function cancel() {},
      () => ({ cancel() {} }),
      () => undefined,
    ]
    for (const hook of cases) {
      const provider = normalizeAIProvider({ stream: hook })
      expect(typeof provider.stream({}).cancel).toBe('function')
    }
  })

  it('幂等：门面与 UI 各归一化一次，已标准化的 provider 原样返回', () => {
    const provider = normalizeAIProvider({ endpoint: '/api/ai' })
    expect(normalizeAIProvider(provider)).toBe(provider)
  })
})

describe('AI 适配层 · SSE 解码与帧解析', () => {
  it('按空行派发事件，多行 data 用 \\n 拼接，注释行忽略', () => {
    const events = []
    const decoder = createSseDecoder({ onEvent: event => events.push(event) })
    decoder.push(':keep-alive\n')
    decoder.push('event: delta\n')
    decoder.push('data: {"a":1}\ndata: {"b":2}\n\n')
    decoder.end()

    expect(events).toHaveLength(1)
    expect(events[0].event).toBe('delta')
    expect(events[0].data).toBe('{"a":1}\n{"b":2}')
  })

  it('end() 会把没有空行结尾的最后一段补派发', () => {
    const events = []
    const decoder = createSseDecoder({ onEvent: event => events.push(event) })
    decoder.push('data: tail-without-blank-line')
    expect(events).toHaveLength(0)
    decoder.end()
    expect(events).toEqual([{ event: 'message', data: 'tail-without-blank-line', id: '' }])
  })

  it('openai 帧：取 delta 文本，[DONE] 与 finish_reason 判结束', () => {
    const parser = createFrameParser('openai')
    expect(parser.parse('{"choices":[{"delta":{"content":"Hello"}}]}').delta).toBe('Hello')
    expect(parser.parse('[DONE]')).toMatchObject({ delta: '', done: true })
    expect(parser.parse('{"choices":[{"delta":{},"finish_reason":"stop"}]}').done).toBe(true)
  })

  it('服务端回错帧：转成 error 交给 onError，不让错误文本进正文', () => {
    const result = createFrameParser('openai').parse('{"error":{"message":"quota exceeded"}}')
    expect(result.delta).toBe('')
    expect(result.error.message).toContain('quota exceeded')
  })

  it('未知协议回落到 auto，非 JSON 帧按纯文本透传', () => {
    expect(createFrameParser('nope').name).toBe('auto')
    expect(createFrameParser('auto').parse('plain chunk').delta).toBe('plain chunk')
  })

  it('looksLikeSse 只认 data/event/id 行开头', () => {
    expect(looksLikeSse('data: {"x":1}')).toBe(true)
    expect(looksLikeSse('event: delta\n')).toBe(true)
    expect(looksLikeSse('just text')).toBe(false)
  })
})

describe('AI 适配层 · 整体响应与请求头', () => {
  it('extractWholeBody 从 JSON 里挖正文，纯文本原样返回', () => {
    expect(extractWholeBody('{"content":"whole body"}')).toBe('whole body')
    expect(extractWholeBody('not json')).toBe('not json')
    expect(extractWholeBody('')).toBe('')
  })

  it('整体响应里的错误会被抛出来', () => {
    expect(() => extractWholeBody('{"success":false,"message":"denied"}')).toThrow('denied')
  })

  it('httpAcceptFor 按协议给出不同 Accept', () => {
    expect(httpAcceptFor('openai')).toBe('text/event-stream')
    expect(httpAcceptFor('json')).toBe('application/json')
    expect(httpAcceptFor('auto')).toContain('text/event-stream')
  })
})

describe('AI 适配层 · 提示词与结果渲染', () => {
  it('buildMessages 输出 system + user，未知动作回落默认指令', () => {
    const messages = buildMessages('rewrite', '原文', '', 'zh')
    expect(messages[0].role).toBe('system')
    expect(messages[0].content).toBe(ACTION_PROMPTS.rewrite)
    expect(messages[1]).toEqual({ role: 'user', content: '原文' })
    expect(buildMessages('unknown-action', '原文')[0].content).toContain('写作助手')
  })

  it('translate 把目标语言拼进系统指令', () => {
    expect(buildMessages('translate', '原文', '', 'en')[0].content).toContain('英文')
    expect(buildMessages('translate', '原文', '', 'ja')[0].content).toContain('日文')
  })

  it('chat 动作把文档当上下文、把 prompt 当问题', () => {
    const user = buildMessages('chat', '文档内容', '这段讲了什么？')[1].content
    expect(user).toContain('文档内容')
    expect(user).toContain('这段讲了什么？')
  })

  it('previewToHtml：markdown 渲染成真实格式，text/html 各走各路', () => {
    expect(previewToHtml('**粗体**')).toContain('<strong>粗体</strong>')
    expect(previewToHtml('**粗体**', 'text')).toBe('<p>**粗体**</p>')
    expect(previewToHtml('<p>已渲染</p>', 'html')).toBe('<p>已渲染</p>')
    expect(previewToHtml('   ')).toBe('')
  })

  it('singleParagraphInner：单段取段内 HTML，多块返回 null 交给插入逻辑', () => {
    expect(singleParagraphInner('<p>一句话</p>')).toBe('一句话')
    expect(singleParagraphInner('<p>a</p><p>b</p>')).toBe(null)
    expect(singleParagraphInner('<ul><li>a</li></ul>')).toBe(null)
  })
})
