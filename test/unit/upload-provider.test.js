// @vitest-environment jsdom
/**
 * P2-02 上传 provider：断点 / 重试 / 取消 / 超限。
 *
 * 守护的是「失败也不留半截节点」这件事的四个前置条件：
 *  1. 超限（类型 / 大小）在上传前拦掉，错误带 code，文案可读；
 *  2. 只有「重试一定安全」的失败才重试 —— 网络错误重试，业务 4xx 立刻抛；
 *  3. 取消有确定结果（UPLOAD_ABORTED），不挂在 pending 里；
 *  4. 断点：分片上传逐片重试，失败从失败那片续，同一文件再次上传也接着走。
 */

import { describe, expect, it, vi } from 'vitest'
import {
  createUploadProvider,
  isRetryable,
  normalizeUploadResult,
  validateUploadFile,
  UPLOAD_ERROR,
} from '../../src/core/media/upload.js'

const MB = 1024 * 1024
const PNG = { type: 'image/png' }

function makeFile(size = 1024, name = 'a.png', type = 'image/png') {
  return new File([new Uint8Array(size)], name, { type })
}

/** 快速重试配置：真等 300ms 起跳会让用例变慢，重试次数照旧。 */
const FAST_RETRY = { attempts: 3, delay: 1, factor: 1 }

function networkError() {
  return new TypeError('Failed to fetch')
}

describe('完整上传生命周期', () => {
  it('独立模块域共享 Provider 保持身份，并发分片与取消不碰撞或重复通知', async () => {
    const producer = await import('../../src/core/media/upload.js?upload-domain=producer')
    const consumer = await import('../../src/core/media/upload.js?upload-domain=consumer')
    expect(producer.createUploadProvider).not.toBe(consumer.createUploadProvider)
    const pendingChunks = new Map()
    const contexts = []
    const onStart = vi.fn()
    const onCancel = vi.fn()
    const onSuccess = vi.fn()
    const onSettled = vi.fn()
    const provider = producer.createUploadProvider({
      chunked: true, chunkSize: 64 * 1024, onStart, onCancel, onSuccess, onSettled,
      upload: (file, ctx) => {
        contexts.push(ctx)
        return new Promise(resolve => pendingChunks.set(`${ctx.documentId}:${ctx.chunk.index}`, resolve))
      },
    })
    const normalized = consumer.normalizeUploader(provider)
    expect(normalized).toBe(provider)
    const brand = Symbol.for('lark-doc.uploadProvider')
    expect(Object.getOwnPropertyDescriptor(provider, brand)).toMatchObject({ value: 1, enumerable: false })
    expect({ ...provider }[brand]).toBeUndefined()
    const file = makeFile(128 * 1024)
    const first = provider.upload(file, { documentId: 'first' })
    const second = normalized.upload(file, { documentId: 'second' })
    first.catch(() => {})
    second.catch(() => {})
    try {
      expect(provider.pending()).toBe(2)
      expect(new Set(contexts.map(ctx => ctx.taskId)).size).toBe(2)
      normalized.cancel(contexts[0].taskId, 'user')
      await expect(first).rejects.toMatchObject({ code: UPLOAD_ERROR.ABORTED, reason: 'user' })
      pendingChunks.get('second:0')({ url: '/part.png' })
      await vi.waitFor(() => expect(pendingChunks.has('second:1')).toBe(true))
      pendingChunks.get('second:1')({ url: '/finished.png' })
      await expect(second).resolves.toMatchObject({ url: '/finished.png' })
      expect(contexts.map(ctx => [ctx.documentId, ctx.chunk.index])).toEqual([['first', 0], ['second', 0], ['second', 1]])
      expect(onStart).toHaveBeenCalledTimes(2)
      expect(onCancel).toHaveBeenCalledTimes(1)
      expect(onSuccess).toHaveBeenCalledTimes(1)
      expect(onSettled).toHaveBeenCalledTimes(2)
      expect(provider.pending()).toBe(0)
    } finally {
      provider.cancelAll()
      normalized.cancelAll()
      await Promise.allSettled([first, second])
    }
  })

  it('未知 Provider 协议版本或不完整协议明确失败，不二次包装', async () => {
    const { normalizeUploader } = await import('../../src/core/media/upload.js?upload-domain=consumer')
    const brand = Symbol.for('lark-doc.uploadProvider')
    expect(() => normalizeUploader({ [brand]: 99, upload: vi.fn() })).toThrow('不支持的上传 Provider 协议版本')
    expect(() => normalizeUploader({ [brand]: 1, upload: vi.fn() })).toThrow('上传 Provider 协议无效')
  })

  it('对象回调依次通知且保留文件任务上下文', async () => {
    const events = []
    const provider = createUploadProvider({
      beforeUpload: (file, ctx) => { events.push('before'); expect(ctx.cancel).toBeTypeOf('function') },
      upload: async (file, ctx) => { events.push('upload'); ctx.onProgress({ loaded: file.size }); return { url: '/image.png' } },
      onStart: event => { events.push('start'); expect(event).toMatchObject({ source: 'paste', documentId: 'doc', mode: 'upload' }) },
      onProgress: () => events.push('progress'),
      onSuccess: () => events.push('success'),
      onSettled: event => { events.push('settled'); expect(event.status).toBe('success') },
    })
    await provider.upload(makeFile(), { source: 'paste', documentId: 'doc' })
    expect(events.filter(event => event !== 'progress').slice(0, 3)).toEqual(['before', 'start', 'upload'])
    expect(events.slice(-2)).toEqual(['success', 'settled'])
  })

  it.each(['true', 'false', 'reject'])('异步 before 等待期间取消立即终结，迟到 %s 不会开始上传', async outcome => {
    let finishBefore
    let context
    const upload = vi.fn(async () => ({ url: '/image.png' }))
    const onCancel = vi.fn()
    const onSettled = vi.fn()
    const provider = createUploadProvider({
      beforeUpload: (file, ctx) => { context = ctx; return new Promise((resolve, reject) => { finishBefore = outcome === 'reject' ? reject : resolve }) },
      upload, onCancel, onSettled,
    })
    const pending = provider.upload(makeFile())
    context.cancel('user')
    await expect(pending).rejects.toMatchObject({ code: UPLOAD_ERROR.ABORTED, reason: 'user' })
    expect(provider.pending()).toBe(0)
    finishBefore(outcome === 'reject' ? new Error('late') : outcome === 'true')
    await Promise.resolve()
    expect(upload).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSettled).toHaveBeenCalledTimes(1)
  })

  it.each(['resolve', 'reject'])('忽略不响应 signal 的迟到 upload %s 与进度', async outcome => {
    let complete
    let uploadContext
    const onProgress = vi.fn()
    const onSuccess = vi.fn()
    const onCancel = vi.fn()
    const onSettled = vi.fn()
    const provider = createUploadProvider({
      upload: (file, ctx) => { uploadContext = ctx; return new Promise((resolve, reject) => { complete = outcome === 'resolve' ? resolve : reject }) },
      onProgress, onSuccess, onCancel, onSettled,
    })
    const pending = provider.upload(makeFile())
    uploadContext.cancel('route-change')
    await expect(pending).rejects.toMatchObject({ code: UPLOAD_ERROR.ABORTED, reason: 'route-change' })
    const count = onProgress.mock.calls.length
    complete(outcome === 'resolve' ? { url: '/late.png' } : new Error('late'))
    uploadContext.onProgress({ loaded: 1024 })
    await Promise.resolve()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onProgress).toHaveBeenCalledTimes(count)
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSettled).toHaveBeenCalledTimes(1)
  })

  it.each(['false', 'cancel'])('beforeUpload %s 只有 cancelled 终态，没有 start/upload', async action => {
    const upload = vi.fn()
    const onStart = vi.fn()
    const onCancel = vi.fn()
    const onSettled = vi.fn()
    const provider = createUploadProvider({
      upload, onStart, onCancel, onSettled,
      beforeUpload: (file, ctx) => action === 'false' ? false : ctx.cancel('denied'),
    })
    await expect(provider.upload(makeFile())).rejects.toMatchObject({ code: UPLOAD_ERROR.ABORTED })
    expect(upload).not.toHaveBeenCalled()
    expect(onStart).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSettled).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 'cancelled' }))
  })

  it('拒绝/请求失败/非法结果各自只产生一个终态和 settled', async () => {
    for (const scenario of ['reject', 'request', 'result']) {
      const events = []
      const upload = vi.fn(async () => {
        if (scenario === 'request') throw new Error('denied')
        return { url: 'javascript:alert(1)' }
      })
      const provider = createUploadProvider({
        upload, limits: { maxSize: scenario === 'reject' ? 1 : 1024 },
        onReject: event => events.push(['rejected', event.code]),
        onError: event => events.push(['error', event.code]),
        onSettled: event => events.push(['settled', event.status]),
      })
      await expect(provider.upload(makeFile())).rejects.toMatchObject({ code: { reject: UPLOAD_ERROR.SIZE, request: UPLOAD_ERROR.FAILED, result: UPLOAD_ERROR.RESULT }[scenario] })
      expect(events).toEqual(scenario === 'reject' ? [['rejected', UPLOAD_ERROR.SIZE], ['settled', 'rejected']]
        : [['error', scenario === 'request' ? UPLOAD_ERROR.FAILED : UPLOAD_ERROR.RESULT], ['settled', 'error']])
      expect(upload).toHaveBeenCalledTimes(scenario === 'reject' ? 0 : 1)
      expect(provider.pending()).toBe(0)
    }
  })

  it('通知回调同步异常及 Promise rejection 走错误渠道，不重试、不递归、不阻塞 settled', async () => {
    const failure = new Error('callback')
    const onCallbackError = vi.fn()
    for (const failUpload of [false, true]) {
      const upload = vi.fn(async () => { if (failUpload) throw new Error('denied'); return { url: '/ok.png' } })
      const onSettled = vi.fn(() => Promise.reject(failure))
      const provider = createUploadProvider({
        upload,
        onStart: () => { throw failure },
        onProgress: () => Promise.reject(failure),
        onSuccess: () => Promise.reject(failure),
        onError: () => { throw failure },
        onSettled, onCallbackError,
      })
      if (failUpload) await expect(provider.upload(makeFile())).rejects.toMatchObject({ code: UPLOAD_ERROR.FAILED })
      else await expect(provider.upload(makeFile())).resolves.toMatchObject({ url: '/ok.png' })
      await Promise.resolve()
      expect(upload).toHaveBeenCalledTimes(1)
      expect(onSettled).toHaveBeenCalledTimes(1)
      expect(provider.pending()).toBe(0)
    }
    expect(onCallbackError).toHaveBeenCalledWith(failure)
  })

  it.each(['throw', 'reject'])('成功通知 %s 时，应用和任务错误通道各收到一次原异常', async kind => {
    const failure = new Error('success-callback')
    const onCallbackError = vi.fn()
    const contextError = vi.fn()
    const onSettled = vi.fn()
    const upload = vi.fn(async () => ({ url: '/ok.png' }))
    const provider = createUploadProvider({
      upload, onCallbackError, onSettled,
      onSuccess: () => { if (kind === 'throw') throw failure; return Promise.reject(failure) },
    })
    await expect(provider.upload(makeFile(), { onCallbackError: contextError })).resolves.toMatchObject({ url: '/ok.png' })
    await Promise.resolve()
    expect(onCallbackError).toHaveBeenCalledExactlyOnceWith(failure)
    expect(contextError).toHaveBeenCalledExactlyOnceWith(failure)
    expect(onSettled).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 'success' }))
    expect(upload).toHaveBeenCalledTimes(1)
    expect(provider.pending()).toBe(0)
  })

  it('应用和任务共用同一个错误回调时只通知一次', async () => {
    const failure = new Error('success-callback')
    const onCallbackError = vi.fn()
    const provider = createUploadProvider({
      upload: async () => ({ url: '/ok.png' }), onCallbackError,
      onSuccess: () => { throw failure },
    })
    await expect(provider.upload(makeFile(), { onCallbackError })).resolves.toMatchObject({ url: '/ok.png' })
    expect(onCallbackError).toHaveBeenCalledExactlyOnceWith(failure)
  })

  it.each([[0, 'throw'], [0, 'reject'], [1, 'throw'], [1, 'reject']])('错误报告通道 %s 自身 %s 不阻塞另一通道或改变上传结果', async (channel, kind) => {
    const failure = new Error('success-callback')
    const reportFailure = new Error('report-callback')
    const reports = [vi.fn(), vi.fn()]
    reports[channel].mockImplementation(() => { if (kind === 'throw') throw reportFailure; return Promise.reject(reportFailure) })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onSettled = vi.fn()
    const provider = createUploadProvider({
      upload: async () => ({ url: '/ok.png' }), onCallbackError: reports[0], onSettled,
      onSuccess: () => { throw failure },
    })
    try {
      await expect(provider.upload(makeFile(), { onCallbackError: reports[1] })).resolves.toMatchObject({ url: '/ok.png' })
      await Promise.resolve()
      reports.forEach(report => expect(report).toHaveBeenCalledExactlyOnceWith(failure))
      expect(log).toHaveBeenCalledExactlyOnceWith('[LarkDoc] 上传回调异常', reportFailure)
      expect(onSettled).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 'success' }))
      expect(provider.pending()).toBe(0)
    } finally { log.mockRestore() }
  })

  it('没有有效错误回调时仍向控制台报告原异常', async () => {
    const failure = new Error('success-callback')
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const provider = createUploadProvider({ upload: async () => ({ url: '/ok.png' }), onSuccess: () => { throw failure } })
    try {
      await expect(provider.upload(makeFile(), { onCallbackError: 'invalid' })).resolves.toMatchObject({ url: '/ok.png' })
      expect(log).toHaveBeenCalledExactlyOnceWith('[LarkDoc] 上传回调异常', failure)
    } finally { log.mockRestore() }
  })

  it('分片重试聚合进度单调且仅通知一次 start/success，retry 带分片身份', async () => {
    const progress = []
    let failed = false
    const file = makeFile(64 * 1024 * 3)
    const onStart = vi.fn()
    const onSuccess = vi.fn()
    const onRetry = vi.fn()
    const provider = createUploadProvider({
      chunked: true, chunkSize: 64 * 1024, retry: FAST_RETRY, onStart, onSuccess, onRetry,
      onProgress: event => progress.push(event),
      upload: async (part, ctx) => {
        ctx.onProgress({ loaded: part.size * 0.8 })
        ctx.onProgress({ loaded: 0 })
        if (ctx.chunk.index === 1 && !failed) { failed = true; throw networkError() }
        ctx.onProgress({ loaded: part.size * 2 })
        return { url: '/chunk.png' }
      },
    })
    await provider.upload(file, { taskId: 'chunks' })
    expect(progress.every((event, i) => event.percent <= 100 && (i === 0 || event.loaded >= progress[i - 1].loaded))).toBe(true)
    expect(progress.at(-1)).toMatchObject({ percent: 100, loaded: file.size, total: file.size })
    expect(onRetry).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ taskId: 'chunks', attempt: 1, nextAttempt: 2, chunk: expect.objectContaining({ index: 1 }) }))
    expect(onStart).toHaveBeenCalledTimes(1)
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })

  it('无 upload 时本地 base64 复用相同生命周期，成功后取消幂等', async () => {
    const events = []
    let context
    const provider = createUploadProvider({
      beforeUpload: (file, ctx) => { context = ctx; events.push('before') },
      onStart: event => { expect(event.mode).toBe('local'); events.push('start') },
      onSuccess: event => { expect(event.result.url).toMatch(/^data:image\/png;base64,/); events.push('success'); event.cancel() },
      onSettled: event => { expect(event.status).toBe('success'); events.push('settled') },
    })
    await provider.upload(makeFile(8))
    expect(events).toEqual(['before', 'start', 'success', 'settled'])
    expect(context.cancel()).toBe(0)
    expect(context.signal.aborted).toBe(false)
  })
})

describe('P2-02 超限', () => {
  it('缺失 MIME 与非图片 MIME 在 before/start/upload 前拒绝', async () => {
    const upload = vi.fn()
    const beforeUpload = vi.fn()
    const onStart = vi.fn()
    const onReject = vi.fn()
    const provider = createUploadProvider({ upload, beforeUpload, onStart, onReject })
    await expect(provider.upload(makeFile(1, 'a.png', ''))).rejects.toMatchObject({ code: UPLOAD_ERROR.MIME })
    expect(upload).not.toHaveBeenCalled()
    expect(beforeUpload).not.toHaveBeenCalled()
    expect(onStart).not.toHaveBeenCalled()
    expect(onReject).toHaveBeenCalledTimes(1)
  })

  it('类型不在白名单时抛 UPLOAD_MIME，且不调宿主', async () => {
    let calls = 0
    const provider = createUploadProvider({ upload: async () => { calls += 1; return { url: '/x' } } })
    await expect(provider.upload(makeFile(10, 'a.pdf', 'application/pdf'))).rejects.toMatchObject({
      code: UPLOAD_ERROR.MIME,
      message: '只支持 JPEG/PNG/GIF/WEBP/BMP 图片',
    })
    expect(calls).toBe(0)
  })

  it('超过 maxSize 时抛 UPLOAD_SIZE，带尺寸供 UI 显示', async () => {
    const provider = createUploadProvider({ upload: async () => ({ url: '/x' }), limits: { maxSize: 2 * MB } })
    await expect(provider.upload(makeFile(3 * MB))).rejects.toMatchObject({
      code: UPLOAD_ERROR.SIZE,
      message: '单张图片不能超过 2 MB',
      maxSize: 2 * MB,
    })
  })

  it('limits 传 null 表示不在 provider 层拦（口径交给调用方）', async () => {
    const provider = createUploadProvider({ upload: async () => ({ url: '/x' }), limits: null })
    await expect(provider.upload(makeFile(30 * MB, 'big.png', 'image/x-raw'))).resolves.toMatchObject({ url: '/x' })
    expect(validateUploadFile(makeFile(1), null)).toBeTruthy()
  })
})

describe('P2-02 重试', () => {
  it('网络错误会重试，成功即返回且不重复上报', async () => {
    let calls = 0
    const provider = createUploadProvider({
      upload: async () => {
        calls += 1
        if (calls < 3) throw networkError()
        return { url: 'https://cdn/x.png', attchId: '7' }
      },
      retry: FAST_RETRY,
    })
    const result = await provider.upload(makeFile())
    expect(calls).toBe(3)
    expect(result).toMatchObject({ url: 'https://cdn/x.png', attchId: '7', size: 1024, mime: 'image/png', name: 'a.png' })
  })

  it('业务错误（无 status 的普通 Error）不重试，只调一次', async () => {
    let calls = 0
    const provider = createUploadProvider({
      upload: async () => {
        calls += 1
        throw new Error('无权限')
      },
      retry: FAST_RETRY,
    })
    await expect(provider.upload(makeFile())).rejects.toMatchObject({ code: UPLOAD_ERROR.FAILED, message: '上传失败：无权限' })
    expect(calls).toBe(1)
  })

  it('4xx 不重试、5xx 与 429 重试，attempts 用尽后抛 FAILED 并记次数', async () => {
    const run = async (error) => {
      let calls = 0
      const provider = createUploadProvider({
        upload: async () => {
          calls += 1
          throw error
        },
        retry: FAST_RETRY,
      })
      await expect(provider.upload(makeFile())).rejects.toMatchObject({ code: UPLOAD_ERROR.FAILED, attempts: 3 })
      return calls
    }
    expect(await run(Object.assign(new Error('bad'), { status: 400 }))).toBe(1)
    expect(await run(Object.assign(new Error('boom'), { status: 503 }))).toBe(3)
    expect(await run(Object.assign(new Error('slow down'), { status: 429 }))).toBe(3)
    // 宿主显式声明可重试的也算
    expect(isRetryable(Object.assign(new Error('x'), { retryable: true }))).toBe(true)
    expect(isRetryable(Object.assign(new Error('x'), { retryable: false, status: 503 }))).toBe(false)
  })
})

describe('P2-02 取消', () => {
  const hanging = (file, ctx) => new Promise((resolve, reject) => {
    ctx.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })
  })

  it('provider.cancel(taskId) 让在飞的请求以 UPLOAD_ABORTED 结束', async () => {
    const provider = createUploadProvider({ upload: hanging, retry: FAST_RETRY })
    const pending = provider.upload(makeFile(), { taskId: 't1' })
    expect(provider.pending()).toBe(1)
    expect(provider.cancel('t1')).toBe(1)
    await expect(pending).rejects.toMatchObject({ code: UPLOAD_ERROR.ABORTED, message: '上传已取消' })
    expect(provider.pending()).toBe(0)
  })

  it('宿主自己传 signal 也能取消；cancelAll 返回受影响任务数', async () => {
    const provider = createUploadProvider({ upload: hanging, retry: FAST_RETRY })
    const controller = new AbortController()
    const pending = provider.upload(makeFile(), { signal: controller.signal })
    await Promise.resolve()
    expect(provider.cancelAll()).toBe(1)
    await expect(pending).rejects.toMatchObject({ code: UPLOAD_ERROR.ABORTED })
    // 已取消的 signal 再传进来，直接判取消，不调宿主
    expect(provider.cancel('不存在')).toBe(0)
  })

  it('取消不会被当成可重试失败（否则会白等三次）', async () => {
    let calls = 0
    const provider = createUploadProvider({
      upload: async (file, ctx) => {
        calls += 1
        throw Object.assign(new Error('aborted'), { name: 'AbortError' })
      },
      retry: FAST_RETRY,
    })
    await expect(provider.upload(makeFile())).rejects.toMatchObject({ code: UPLOAD_ERROR.ABORTED })
    expect(calls).toBe(1)
  })
})

describe('P2-02 断点（分片续传）', () => {
  const CHUNK = 64 * 1024
  const fourChunks = () => makeFile(CHUNK * 4, 'p.png')

  it('只切 chunked 声明的宿主；逐片成功时按序上传 4 片并带 offset', async () => {
    const seen = []
    const provider = createUploadProvider({
      upload: async (part, ctx) => {
        seen.push({ index: ctx.chunk.index, offset: ctx.chunk.offset, total: ctx.chunk.total, size: ctx.chunk.size })
        return { url: `https://cdn/part-${ctx.chunk.index}.png` }
      },
      chunked: true,
      chunkSize: CHUNK,
      limits: null,
    })
    const result = await provider.upload(fourChunks())
    expect(seen.map((item) => item.index)).toEqual([0, 1, 2, 3])
    expect(seen.map((item) => item.offset)).toEqual([0, CHUNK, CHUNK * 2, CHUNK * 3])
    expect(seen[0].total).toBe(4)
    expect(result.url).toBe('https://cdn/part-3.png')
  })

  it('某片网络失败只重传该片，不从头再来', async () => {
    const indices = []
    let failedOnce = false
    const provider = createUploadProvider({
      upload: async (part, ctx) => {
        indices.push(ctx.chunk.index)
        if (ctx.chunk.index === 1 && !failedOnce) {
          failedOnce = true
          throw networkError()
        }
        return { url: '/u' }
      },
      chunked: true,
      chunkSize: CHUNK,
      retry: FAST_RETRY,
      limits: null,
    })
    await provider.upload(fourChunks())
    expect(indices).toEqual([0, 1, 1, 2, 3])
  })

  it('整轮失败后同一文件再次上传，从断点续而不是从零开始', async () => {
    const indices = []
    const file = fourChunks()
    let alwaysFailOn = 2
    const provider = createUploadProvider({
      upload: async (part, ctx) => {
        indices.push(ctx.chunk.index)
        if (ctx.chunk.index === alwaysFailOn) throw Object.assign(new Error('boom'), { status: 500 })
        return { url: '/u' }
      },
      chunked: true,
      chunkSize: CHUNK,
      retry: { attempts: 2, delay: 1, factor: 1 },
      limits: null,
    })
    await expect(provider.upload(file)).rejects.toMatchObject({ code: UPLOAD_ERROR.FAILED })
    expect(indices).toEqual([0, 1, 2, 2])

    alwaysFailOn = -1
    indices.length = 0
    // 同一个 file 对象（真机上是同一磁盘文件，lastModified 稳定）才能命中断点账本
    await provider.upload(file)
    // 前两片已完成（resumeFrom = 2），第二轮只补 2、3
    expect(indices).toEqual([2, 3])
  })

  it('成功后清账本，下一次同文件从第 0 片开始；clearResume 也能清', async () => {
    const indices = []
    const provider = createUploadProvider({
      upload: async (part, ctx) => {
        indices.push(ctx.chunk.index)
        return { url: '/u' }
      },
      chunked: true,
      chunkSize: CHUNK,
      limits: null,
    })
    await provider.upload(fourChunks())
    indices.length = 0
    await provider.upload(fourChunks())
    expect(indices).toEqual([0, 1, 2, 3])
    provider.clearResume()
    expect(provider.chunked).toBe(true)
    expect(provider.chunkSize).toBe(CHUNK)
  })

  it('取消后立即 clearResume 不会被旧任务的异步清理重新写入断点', async () => {
    const indices = []
    let block = true
    let startedSecond
    const second = new Promise(resolve => { startedSecond = resolve })
    const provider = createUploadProvider({
      chunked: true, chunkSize: CHUNK,
      upload: async (part, ctx) => {
        indices.push(ctx.chunk.index)
        if (block && ctx.chunk.index === 1) { startedSecond(); return new Promise(() => {}) }
        return { url: '/chunk.png' }
      },
    })
    const file = fourChunks()
    const pending = provider.upload(file)
    await second
    provider.cancelAll('document-change')
    provider.clearResume()
    await expect(pending).rejects.toMatchObject({ code: UPLOAD_ERROR.ABORTED })
    block = false
    indices.length = 0
    await provider.upload(file)
    expect(indices).toEqual([0, 1, 2, 3])
  })

  it('同一 Provider 的不同 documentId 不共享同文件断点', async () => {
    const indices = []
    const provider = createUploadProvider({
      chunked: true, chunkSize: CHUNK,
      upload: async (part, ctx) => {
        indices.push([ctx.documentId, ctx.chunk.index])
        if (ctx.documentId === 'first' && ctx.chunk.index === 1) throw new Error('denied')
        return { url: '/chunk.png' }
      },
    })
    const file = fourChunks()
    await expect(provider.upload(file, { documentId: 'first' })).rejects.toMatchObject({ code: UPLOAD_ERROR.FAILED })
    indices.length = 0
    await provider.upload(file, { documentId: 'second' })
    expect(indices.map(item => item[1])).toEqual([0, 1, 2, 3])
    indices.length = 0
    await expect(provider.upload(file, { documentId: 'first' })).rejects.toMatchObject({ code: UPLOAD_ERROR.FAILED })
    expect(indices).toEqual([['first', 1]])
  })

  it('未声明 chunked 时即便文件很大也只调一次（不分片）', async () => {
    let calls = 0
    const provider = createUploadProvider({
      upload: async () => { calls += 1; return { url: '/u' } },
      limits: null,
    })
    await provider.upload(fourChunks())
    expect(calls).toBe(1)
    expect(provider.chunked).toBe(false)
  })
})

describe('P2-02 返回契约与进度', () => {
  it('缺 url / 非对象都判失败，不产生半截节点', () => {
    expect(() => normalizeUploadResult({ width: 10 }, PNG)).toThrowError(/未返回有效地址/)
    expect(() => normalizeUploadResult(null, PNG)).toThrowError(/未返回有效地址/)
    expect(normalizeUploadResult({ url: 'https://cdn/x.png', width: 800, height: 600 }, makeFile(2048))).toEqual({
      size: 2048,
      mime: 'image/png',
      name: 'a.png',
      url: 'https://cdn/x.png',
      width: 800,
      height: 600,
    })
  })

  it('宿主给了 url 但没有 size/mime/name 时按文件补齐', async () => {
    const provider = createUploadProvider({ upload: async () => ({ url: 'https://cdn/x.png' }), limits: null })
    await expect(provider.upload(makeFile(4096, 'b.webp', 'image/webp'))).resolves.toMatchObject({
      url: 'https://cdn/x.png',
      size: 4096,
      mime: 'image/webp',
      name: 'b.webp',
    })
  })

  it('进度回调收到 loaded / total / percent，percent 夹在 0–100', async () => {
    const events = []
    const provider = createUploadProvider({
      upload: async (file, ctx) => {
        ctx.onProgress({ loaded: 512 })
        ctx.onProgress({ loaded: 4096 })
        return { url: '/u' }
      },
      limits: null,
    })
    await provider.upload(makeFile(4096), { onProgress: (event) => events.push(event) })
    expect(events[0]).toMatchObject({ loaded: 0, total: 4096, percent: 0 })
    expect(events[1]).toMatchObject({ loaded: 512, total: 4096, percent: 13 })
    expect(events[2]).toMatchObject({ loaded: 4096, total: 4096, percent: 100 })
  })

  it('同一 taskId 并发上传直接被拒，不会有两个任务写同一份断点', async () => {
    const provider = createUploadProvider({
      upload: (file, ctx) => new Promise((resolve) => setTimeout(() => resolve({ url: '/u' }), 5)),
      limits: null,
    })
    const first = provider.upload(makeFile(), { taskId: 'same' })
    await expect(provider.upload(makeFile(), { taskId: 'same' })).rejects.toMatchObject({ message: '上传任务已在进行中' })
    await first
    expect(provider.pending()).toBe(0)
  })
})
