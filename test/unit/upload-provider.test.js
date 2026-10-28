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

import { describe, expect, it } from 'vitest'
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

describe('P2-02 超限', () => {
  it('类型不在白名单时抛 UPLOAD_MIME，且不调宿主', async () => {
    let calls = 0
    const provider = createUploadProvider({ upload: async () => { calls += 1; return { url: 'x' } } })
    await expect(provider.upload(makeFile(10, 'a.pdf', 'application/pdf'))).rejects.toMatchObject({
      code: UPLOAD_ERROR.MIME,
      message: '只支持 PNG/JPEG/GIF/WEBP 图片',
    })
    expect(calls).toBe(0)
  })

  it('超过 maxSize 时抛 UPLOAD_SIZE，带尺寸供 UI 显示', async () => {
    const provider = createUploadProvider({ upload: async () => ({ url: 'x' }), limits: { maxSize: 2 * MB } })
    await expect(provider.upload(makeFile(3 * MB))).rejects.toMatchObject({
      code: UPLOAD_ERROR.SIZE,
      message: '单张图片不能超过 2 MB',
      maxSize: 2 * MB,
    })
  })

  it('limits 传 null 表示不在 provider 层拦（口径交给调用方）', async () => {
    const provider = createUploadProvider({ upload: async () => ({ url: 'x' }), limits: null })
    await expect(provider.upload(makeFile(30 * MB, 'big.png', 'image/x-raw'))).resolves.toMatchObject({ url: 'x' })
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
        return { url: 'u' }
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
        return { url: 'u' }
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
        return { url: 'u' }
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

  it('未声明 chunked 时即便文件很大也只调一次（不分片）', async () => {
    let calls = 0
    const provider = createUploadProvider({
      upload: async () => { calls += 1; return { url: 'u' } },
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
        return { url: 'u' }
      },
      limits: null,
    })
    await provider.upload(makeFile(4096), { onProgress: (event) => events.push(event) })
    expect(events[0]).toEqual({ loaded: 0, total: 4096, percent: 0 })
    expect(events[1]).toEqual({ loaded: 512, total: 4096, percent: 13 })
    expect(events[2]).toEqual({ loaded: 4096, total: 4096, percent: 100 })
  })

  it('同一 taskId 并发上传直接被拒，不会有两个任务写同一份断点', async () => {
    const provider = createUploadProvider({
      upload: (file, ctx) => new Promise((resolve) => setTimeout(() => resolve({ url: 'u' }), 5)),
      limits: null,
    })
    const first = provider.upload(makeFile(), { taskId: 'same' })
    await expect(provider.upload(makeFile(), { taskId: 'same' })).rejects.toMatchObject({ message: '上传任务已在进行中' })
    await first
    expect(provider.pending()).toBe(0)
  })
})
