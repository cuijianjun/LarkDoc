// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createUploadProvider, normalizeUploader, UPLOAD_ERROR } from '../../src/core/media/upload.js'

const PNG = 'data:image/png;base64,iVBORw0KGgo='
const file = () => new File([new Uint8Array(32)], 'image.png', { type: 'image/png' })
let requests
let responses

class TestXHR {
  constructor() {
    this.upload = {}
    this.headers = {}
    requests.push(this)
  }
  open(method, url) { this.method = method; this.url = url }
  setRequestHeader(name, value) { this.headers[name] = value }
  send(form) {
    this.form = form
    const response = responses.shift() || { body: { url: '/images/result.png' } }
    if (!response.manual) queueMicrotask(() => this.respond(response))
  }
  respond({ status = 200, body, error, loaded, total } = {}) {
    if (loaded !== undefined) this.upload.onprogress?.({ loaded, total, lengthComputable: total !== undefined })
    if (error) return this[error]?.()
    this.status = status
    this.responseText = typeof body === 'string' ? body : JSON.stringify(body)
    this.onload?.()
  }
  abort() { this.aborted = true; this.onabort?.() }
}

beforeEach(() => {
  requests = []
  responses = []
  vi.stubGlobal('XMLHttpRequest', TestXHR)
})
afterEach(() => vi.unstubAllGlobals())

describe('初始化配置式 HTTP 图片上传', () => {
  it('action 配置执行 multipart 请求，等待响应映射且保留完整任务上下文', async () => {
    const events = []
    responses.push({ body: { code: 0, data: { url: '/images/server.png', id: '42' } }, loaded: 64, total: 128 })
    const image = file()
    const provider = normalizeUploader({
      action: '/api/upload', fieldName: 'image', data: { business: 'document', enabled: true },
      response: { success: { path: 'code', equals: 0 }, url: 'data.url', attchId: 'data.id' },
      beforeUpload: (value, ctx) => { expect(value).toBe(image); events.push(['before', ctx]) },
      onStart: event => events.push(['start', event]),
      onProgress: event => events.push(['progress', event]),
      onSuccess: event => events.push(['success', event]),
      onSettled: event => events.push(['settled', event]),
    })
    await expect(provider.upload(image, { documentId: 'doc', source: 'paste' })).resolves.toMatchObject({ url: '/images/server.png', attchId: '42' })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ method: 'POST', timeout: 30000, withCredentials: false })
    expect(new URL(requests[0].url, location.href).pathname).toBe('/api/upload')
    expect(requests[0].form.get('image')).toBe(image)
    expect(requests[0].form.get('business')).toBe('document')
    expect(requests[0].form.get('enabled')).toBe('true')
    expect(events.filter(([name]) => name !== 'progress').map(([name]) => name)).toEqual(['before', 'start', 'success', 'settled'])
    expect(events.some(([name, event]) => name === 'progress' && event.loaded === 16 && event.percent === 50)).toBe(true)
    for (const [, event] of events) expect(event).toMatchObject({ source: 'paste', mode: 'upload', documentId: 'doc', file: image })
    expect(new Set(events.map(([, event]) => event.taskId)).size).toBe(1)
    expect(provider.pending()).toBe(0)
  })

  it('默认解析顶层 url，也接受服务器返回的 base64', async () => {
    responses.push({ body: { url: PNG } })
    await expect(createUploadProvider({ action: '/upload' }).upload(file())).resolves.toMatchObject({ url: PNG })
  })

  it('multipart 额外字段不冒充文件字节；未知传输总量不提前报100%', async () => {
    responses.push({ manual: true })
    const onProgress = vi.fn()
    const provider = createUploadProvider({ action: '/upload', data: { large: 'x'.repeat(2048) }, onProgress })
    const pending = provider.upload(file())
    await vi.waitFor(() => expect(requests[0]?.form).toBeDefined())
    requests[0].upload.onprogress({ lengthComputable: true, loaded: 512, total: 2048 })
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ loaded: 8, total: 32, percent: 25 }))
    requests[0].upload.onprogress({ lengthComputable: false, loaded: 1024, total: 0 })
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ percent: 25 }))
    requests[0].respond({ body: { url: '/images/result.png' } })
    await pending
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ loaded: 32, percent: 100 }))
  })

  it('每次请求重新解析异步 headers，支持 PUT、超时和凭据配置', async () => {
    let token = 'first'
    const headers = vi.fn(async (image, ctx) => {
      expect(image.type).toBe('image/png')
      expect(ctx.mode).toBe('upload')
      return { Authorization: `Bearer ${token}` }
    })
    const provider = createUploadProvider({ action: '/upload', method: 'put', headers, timeout: 1234, withCredentials: true })
    await provider.upload(file())
    token = 'second'
    await provider.upload(file())
    expect(requests.map(request => request.headers.Authorization)).toEqual(['Bearer first', 'Bearer second'])
    expect(requests[1]).toMatchObject({ method: 'PUT', timeout: 1234, withCredentials: true })
    expect(headers).toHaveBeenCalledTimes(2)
  })

  it('自定义 upload 优先，不解析服务器配置', async () => {
    const upload = vi.fn(async () => ({ url: '/custom.png' }))
    await expect(createUploadProvider({ action: 'javascript:bad', upload }).upload(file())).resolves.toMatchObject({ url: '/custom.png' })
    expect(upload).toHaveBeenCalledTimes(1)
    expect(requests).toHaveLength(0)
  })

  it('无 action 与 upload 仍是本地 base64，回调 mode 为 local', async () => {
    const onSuccess = vi.fn()
    await expect(createUploadProvider({ onSuccess }).upload(file())).resolves.toMatchObject({ url: expect.stringMatching(/^data:image\/png;base64,/) })
    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ mode: 'local' }))
    expect(requests).toHaveLength(0)
  })

  it.each([
    ['HTTP 500', { status: 500, body: {} }],
    ['业务失败', { body: { code: 1, message: 'quota reached', data: { url: '/must-not-insert.png' } } }],
    ['非法 JSON', { body: '<html>error</html>' }],
    ['缺失 URL', { body: { code: 0, data: {} } }],
    ['非法 URL', { body: { code: 0, data: { url: 'javascript:alert(1)' } } }],
    ['网络错误', { error: 'onerror' }],
    ['超时', { error: 'ontimeout' }],
  ])('%s 只通知 error/settled，不回退 base64、不默认重试 POST', async (_, response) => {
    responses.push(response)
    const onError = vi.fn()
    const onSuccess = vi.fn()
    const onSettled = vi.fn()
    const provider = createUploadProvider({
      action: '/upload', response: { success: { path: 'code', equals: 0 }, url: 'data.url', message: 'message' },
      onError, onSuccess, onSettled,
    })
    await expect(provider.upload(file())).rejects.toHaveProperty('code')
    expect(requests).toHaveLength(1)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onSettled).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 'error' }))
    expect(provider.pending()).toBe(0)
  })

  it('业务错误保留配置的服务器消息且不重试', async () => {
    responses.push({ body: { code: 5, message: 'quota reached' } })
    const provider = createUploadProvider({ action: '/upload', response: { success: { path: 'code', equals: 0 }, message: 'message' }, retry: { attempts: 3, delay: 1 } })
    await expect(provider.upload(file())).rejects.toMatchObject({ message: 'quota reached', retryable: false })
    expect(requests).toHaveLength(1)
  })

  it('显式允许重试时 503 重试，headers 每次重新读取，onStart 不重复', async () => {
    responses.push({ status: 503, body: {} }, { body: { url: '/retried.png' } })
    const onStart = vi.fn()
    const onRetry = vi.fn()
    const headers = vi.fn(() => ({ 'X-Attempt': String(requests.length + 1) }))
    await expect(createUploadProvider({ action: '/upload', headers, retry: { attempts: 2, delay: 1 }, onStart, onRetry }).upload(file())).resolves.toMatchObject({ url: '/retried.png' })
    expect(requests).toHaveLength(2)
    expect(headers).toHaveBeenCalledTimes(2)
    expect(onStart).toHaveBeenCalledTimes(1)
    expect(onRetry).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ attempt: 1, nextAttempt: 2 }))
  })

  it.each([400, 401, 403])('HTTP %s 即使开启 retry 也不重试', async status => {
    responses.push({ status, body: {} })
    const onRetry = vi.fn()
    await expect(createUploadProvider({ action: '/upload', retry: { attempts: 3, delay: 1 }, onRetry }).upload(file())).rejects.toMatchObject({ status })
    expect(requests).toHaveLength(1)
    expect(onRetry).not.toHaveBeenCalled()
  })

  it('异步 headers 拒绝只通知失败，不发送请求或重试', async () => {
    const headers = vi.fn(async () => { throw new Error('auth unavailable') })
    await expect(createUploadProvider({ action: '/upload', headers, retry: { attempts: 3, delay: 1 } }).upload(file())).rejects.toMatchObject({ retryable: false })
    expect(headers).toHaveBeenCalledTimes(1)
    expect(requests).toHaveLength(0)
  })

  it('并发任务取消一个不影响另一个 HTTP 请求', async () => {
    responses.push({ manual: true }, { body: { url: '/other.png' } })
    const contexts = []
    const onSuccess = vi.fn()
    const provider = createUploadProvider({ action: '/upload', onStart: ctx => contexts.push(ctx), onSuccess })
    const first = provider.upload(file(), { documentId: 'one' })
    first.catch(() => {})
    const second = provider.upload(file(), { documentId: 'two' })
    provider.cancel(contexts[0].taskId, 'unmount')
    await expect(first).rejects.toMatchObject({ code: UPLOAD_ERROR.ABORTED })
    await expect(second).resolves.toMatchObject({ url: '/other.png' })
    expect(requests[0].aborted).toBe(true)
    expect(requests[1].aborted).not.toBe(true)
    expect(onSuccess).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ documentId: 'two' }))
  })

  it('取消实际中止 XHR，迟到响应与进度不再通知或写回', async () => {
    responses.push({ manual: true })
    const onSuccess = vi.fn()
    const onCancel = vi.fn()
    const onSettled = vi.fn()
    const onProgress = vi.fn()
    const provider = createUploadProvider({ action: '/upload', onSuccess, onCancel, onSettled, onProgress })
    const pending = provider.upload(file())
    pending.catch(() => {})
    await vi.waitFor(() => expect(requests[0]?.form).toBeDefined())
    provider.cancelAll('unmount')
    await expect(pending).rejects.toMatchObject({ code: UPLOAD_ERROR.ABORTED })
    const count = onProgress.mock.calls.length
    requests[0].respond({ body: { url: '/late.png' }, loaded: 32 })
    expect(requests[0].aborted).toBe(true)
    expect(onProgress).toHaveBeenCalledTimes(count)
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSettled).toHaveBeenCalledTimes(1)
  })

  it('等待 headers 时取消，不会迟到发送请求', async () => {
    let resolveHeaders
    const provider = createUploadProvider({ action: '/upload', headers: () => new Promise(resolve => { resolveHeaders = resolve }) })
    const pending = provider.upload(file())
    pending.catch(() => {})
    await vi.waitFor(() => expect(resolveHeaders).toBeTypeOf('function'))
    provider.cancelAll('unmount')
    await expect(pending).rejects.toMatchObject({ code: UPLOAD_ERROR.ABORTED })
    resolveHeaders({ Authorization: 'late' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(requests).toHaveLength(0)
  })

  it.each([
    { action: '' }, { action: null }, { action: 'javascript:alert(1)' },
    { action: 'https://user:password@example.com/upload' },
    { action: '/upload', method: 'GET' }, { action: '/upload', timeout: -1 },
    { action: '/upload', fieldName: '' }, { action: '/upload', chunked: true },
    { action: '/upload', withCredentials: 'false' },
    { action: '/upload', data: { file: 'overwrite' } },
    { action: '/upload', data: { nested: {} } },
    { action: '/upload', response: null },
    { action: '/upload', response: { success: { path: 'code' } } },
    { action: '/upload', headers: 'invalid' },
    { action: '/upload', headers: { 'Content-Type': 'multipart/form-data' } },
    { action: '/upload', response: { url: '__proto__.url' } },
  ])('非法服务器配置明确失败、不发请求或转本地模式：%j', async options => {
    await expect(createUploadProvider(options).upload(file())).rejects.toHaveProperty('code')
    expect(requests.filter(request => request.form)).toHaveLength(0)
  })
})
