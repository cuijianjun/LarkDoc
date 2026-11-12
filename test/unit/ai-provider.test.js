import { describe, expect, it } from 'vitest'
import { createOpenAICompatibleProvider, parseSseEvents, validateAIWriteback } from '../../src/providers/ai'
import { AI_PROTOCOLS, normalizeAIProvider } from '../../src/components/lark-doc/ai'

describe('OpenAI-compatible AI provider', () => {
  it('sends actual image content parts alongside the question', async () => {
    let payload
    const provider = createOpenAICompatibleProvider({ baseUrl: 'https://llm.example.test/v1', request: async (_, init) => {
      payload = JSON.parse(init.body)
      return { ok: true, body: 'data: [DONE]\n\n' }
    } })
    await provider.generate({ action: 'chat', prompt: '描述图片', images: [{ url: 'data:image/png;base64,YQ==' }] })
    expect(payload.messages[1].content).toEqual([
      { type: 'text', text: '描述图片\n\nDocument text:\n' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,YQ==' } },
    ])
    expect(provider.supportsImages).toBe(true)
  })
  it('normalizes a base URL and builds a bearer-auth chat request', async () => {
    const calls = []
    const provider = createOpenAICompatibleProvider({
      baseUrl: 'https://llm.example.test/v1/',
      apiKey: 'secret-key',
      model: 'demo-model',
      request: async (url, init) => {
        calls.push({ url, init })
        return { ok: true, status: 200, body: 'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: [DONE]\n\n' }
      },
    })

    const chunks = []
    await provider.generate({ text: 'source', action: 'rewrite', onChunk: chunk => chunks.push(chunk) })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://llm.example.test/v1/chat/completions')
    expect(calls[0].init.headers.Authorization).toBe('Bearer secret-key')
    expect(JSON.parse(calls[0].init.body)).toMatchObject({ model: 'demo-model', stream: true })
    expect(chunks).toEqual(['Hi'])
  })

  it('accepts baseurl/api_key aliases and exposes a direct request contract', async () => {
    let captured
    const chunks = []
    const provider = normalizeAIProvider({
      protocol: 'openai',
      baseurl: 'https://llm.example.test/v1',
      api_key: 'alias-key',
      request: async request => {
        captured = request
        return { ok: true, status: 200, body: 'data: {"choices":[{"delta":{"content":"直连结果"}}]}\n\ndata: [DONE]\n\n' }
      },
    })
    await new Promise((resolve, reject) => provider.stream({
      action: 'chat', text: '上下文', prompt: '问题',
      onChunk: chunk => chunks.push(chunk), onDone: resolve, onError: reject,
    }))
    expect(captured.url).toBe('https://llm.example.test/v1/chat/completions')
    expect(captured.method).toBe('POST')
    expect(captured.headers.Authorization).toBe('Bearer alias-key')
    expect(captured.body.messages[1].content).toContain('问题')
    expect(chunks).toEqual(['直连结果'])
    expect(AI_PROTOCOLS).toContain('openai')
  })

  it('keeps the standalone OpenAI provider compatible with baseURL and dynamic api_key', async () => {
    let authorization = ''
    const provider = createOpenAICompatibleProvider({
      baseURL: 'https://llm.example.test/v1',
      api_key: () => 'dynamic-alias-key',
      request: async (_url, init) => {
        authorization = init.headers.Authorization
        return { ok: true, body: 'data: [DONE]\n\n' }
      },
    })
    expect(provider.kind).toBe('endpoint')
    expect(provider.baseURL).toBe('https://llm.example.test/v1')
    await provider.generate({ action: 'chat', prompt: 'hello' })
    expect(authorization).toBe('Bearer dynamic-alias-key')
  })

  it('parses multiline SSE events and ignores comments', () => {
    const events = parseSseEvents(':keep-alive\n\ndata: {"choices":[{"delta":{"content":"A"}}]}\ndata: {"choices":[{"delta":{"content":"B"}}]}\n\n')
    expect(events).toEqual([
      { choices: [{ delta: { content: 'A' } }] },
      { choices: [{ delta: { content: 'B' } }] },
    ])
  })

  it('supports cancellation and surfaces provider errors without leaking the key', async () => {
    let aborted = false
    const provider = createOpenAICompatibleProvider({
      baseUrl: 'https://llm.example.test',
      apiKey: 'secret-key',
      request: async (_url, init) => new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          aborted = true
          reject(Object.assign(new Error('request secret-key failed'), { name: 'AbortError' }))
        }, { once: true })
      }),
    })
    const handle = provider.stream({ text: 'source', action: 'rewrite' })
    handle.cancel()
    await expect(handle.done).rejects.toMatchObject({ code: 'AI_CANCELLED' })
    expect(aborted).toBe(true)
  })

  it('redacts the configured key from provider error text', async () => {
    const provider = createOpenAICompatibleProvider({
      baseUrl: 'https://llm.example.test',
      apiKey: 'secret-key',
      request: async () => { throw Object.assign(new Error('upstream secret-key rejected'), { code: 'UPSTREAM' }) },
    })
    let error
    try { await provider.generate({ text: 'source', action: 'rewrite' }) } catch (caught) { error = caught }
    expect(error).toMatchObject({ code: 'UPSTREAM' })
    expect(error.message).not.toContain('secret-key')
  })

  it('supports citations, feedback and revision-guarded writeback', async () => {
    const calls = []
    const provider = createOpenAICompatibleProvider({
      baseUrl: 'https://llm.example.test/v1',
      apiKey: 'secret-key',
      request: async (url, init) => {
        calls.push({ url, init })
        return { ok: true, status: 200, json: async () => ({ ok: true, citations: [{ title: 'Source' }] }) }
      },
    })
    await provider.citations({ text: 'source', sourceRevisionId: 'r1' })
    await provider.feedback({ taskId: 'task-1', value: 'helpful' })
    await provider.writeback({ sourceRevisionId: 'r1', currentRevisionId: 'r1', text: 'result' })
    expect(calls.map(call => call.url)).toEqual([
      'https://llm.example.test/v1/citations',
      'https://llm.example.test/v1/feedback',
      'https://llm.example.test/v1/writeback',
    ])
    expect(() => validateAIWriteback({ sourceRevisionId: 'r1', currentRevisionId: 'r2', text: 'stale' })).toThrow(/revision/i)
  })
})
