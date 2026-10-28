import { describe, expect, it } from 'vitest'
import { createOpenAICompatibleProvider, parseSseEvents, validateAIWriteback } from '../../src/providers/ai'

describe('OpenAI-compatible AI provider', () => {
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
