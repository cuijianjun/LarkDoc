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

import { fileBlockAttrs } from '../../src/core/media/file-block'
import uploadMixin from '../../src/components/lark-doc/editor/uploadMixin'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createHash, webcrypto } from 'node:crypto'
import { createRequire } from 'node:module'
import { createHttpAssetProvider, resolveUploadHandler, rejectUnavailableAssetUpload } from '../../src/providers/upload'
import { createDocumentSession } from '../../src/session/DocumentSession'
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
      upload: async () => {
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
      upload: () => new Promise((resolve) => setTimeout(() => resolve({ url: 'u' }), 5)),
      limits: null,
    })
    const first = provider.upload(makeFile(), { taskId: 'same' })
    await expect(provider.upload(makeFile(), { taskId: 'same' })).rejects.toMatchObject({ message: '上传任务已在进行中' })
    await first
    expect(provider.pending()).toBe(0)
  })
})

// 注入HTTP边界（E1），不代替真实内部对象存储、浏览器上传或分块撤权验收。
describe('US13 远端对象服务未供给时的真实阻塞边界', () => {
  const begin = { operationId: 'asset-original', fileName: 'a.png', mimeType: 'image/png', sizeBytes: '1024' }
  const blocked = (extra = {}) => ({ status: 'blocked', code: 'DEPENDENCY_BLOCKED', dependency: 'internal-object-storage',
    operation: 'begin', operationId: begin.operationId, assetId: null, persisted: false, taskId: null, ready: false, objectVerified: false, ...extra })
  const response = (data, status = 503) => ({ status, json: async () => data })
  const create = (request, extra = {}) => createHttpAssetProvider({ baseUrl: '/api', tenantId: 'tenant', docId: 'doc', csrfToken: () => 'csrf',
    getCapabilities: () => ({ canView: true, canEdit: true }), request, ...extra })
  const checksum = 'sha256:' + 'a'.repeat(64), requestHash = 'sha256:' + 'b'.repeat(64)
  const asset = (extra = {}) => ({ tenantId: 'tenant', docId: 'doc', assetId: 'asset:one', status: 'pending', assetRevision: '1',
    fileName: begin.fileName, mimeType: begin.mimeType, sizeBytes: begin.sizeBytes, checksum: null,
    ready: false, objectVerified: false, reconciliationRequired: false, physicalDelete: false, ...extra })
  const committed = (operation, value, extra = {}) => ({ status: 'committed', operation, operationId: operation === 'begin' ? begin.operationId : 'complete-original',
    requestHash, assetId: value.assetId, asset: value, persisted: true, ready: value.ready, objectVerified: value.objectVerified,
    physicalDelete: false, replayed: false, code: null, committedRevision: operation === 'begin' ? '1' : '2', ...extra })

  it.each(['begin', 'complete'])('Session queried intent tombstone: an original %s first seen through GET cannot become POST after reset', async kind => {
    const value = kind === 'begin' ? asset() : asset({ status: 'ready', assetRevision: '2', checksum, ready: true, objectVerified: true })
    const request = vi.fn(async (url, init) => response(committed(kind, value, { replayed: init.method === 'GET' }), kind === 'begin' && init.method === 'POST' ? 201 : 200))
    const provider = create(request), input = kind === 'begin' ? { ...begin } : { operationId: 'complete-original', assetId: value.assetId, sizeBytes: begin.sizeBytes, mimeType: begin.mimeType, checksum }
    try {
      // A fresh provider learns only the original current-authorized receipt, never its private write intent.
      expect(await provider.queryOperation({ operationId: input.operationId, kind })).toMatchObject({ status: 'committed', operationId: input.operationId })
      expect(request.mock.calls.map(([, init]) => init.method)).toEqual(['GET'])
      provider.reset('identity-changed'); expect(provider.getOperation(input.operationId)).toBeNull()
      await provider[kind](input).catch(() => null)
      expect(request.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true)
      expect(await provider.queryOperation({ operationId: input.operationId, kind })).toMatchObject({ status: 'committed', operationId: input.operationId })
      expect(request.mock.calls.at(-1)[1].method).toBe('GET'); expect(request.mock.calls.at(-1)[0]).toContain('kind=' + kind)
      expect(request.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(0)
    } finally { provider.dispose() }
  })

  it.each(['begin', 'complete'])('Session private reset upload: public %s retains an ID tombstone and can only query after reset', async kind => {
    const value = kind === 'begin' ? asset() : asset({ status: 'ready', assetRevision: '2', checksum, ready: true, objectVerified: true })
    const request = vi.fn(async (url, init) => response(committed(kind, value, { replayed: init.method === 'GET' }), kind === 'begin' && init.method === 'POST' ? 201 : 200))
    const port = create(request), input = kind === 'begin' ? { ...begin } : { operationId: 'complete-original', assetId: value.assetId, sizeBytes: begin.sizeBytes, mimeType: begin.mimeType, checksum }
    try {
      await port[kind](input); expect(request.mock.calls[0][1].method).toBe('POST'); port.reset('identity-changed')
      expect(port.getOperation(input.operationId)).toBeNull()
      const before = request.mock.calls.length
      await port[kind](input).catch(() => null)
      expect(request.mock.calls.slice(before).every(([, init]) => init.method === 'GET')).toBe(true)
      await port.queryOperation({ operationId: input.operationId, kind })
      expect(request.mock.calls.at(-1)[1].method).toBe('GET'); expect(request.mock.calls.at(-1)[0]).toContain('kind=' + kind)
      expect(request.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1)
    } finally { port.dispose() }
  })

  it('保留宿主Function和对象upload的this/参数/完整返回数据', async () => {
    const file = makeFile(), context = { onProgress: vi.fn() }
    const fn = vi.fn(async () => ({ url: 'https://internal/a', attchId: '1' }))
    expect(resolveUploadHandler(fn)).toBe(fn)
    const host = { id: 'host', async upload(input, ctx) { ctx.onProgress(input.size); return { url: 'https://internal/a', attchId: this.id, callback: ctx.onProgress } } }
    await expect(resolveUploadHandler(host)(file, context)).resolves.toMatchObject({ attchId: 'host', callback: context.onProgress })
    expect(context.onProgress).toHaveBeenCalledWith(file.size)
    expect(resolveUploadHandler({})).toBeNull()
  })

  it('只发送Cookie/CSRF和准入元数据，blocked不分配对象或透传地址', async () => {
    const request = vi.fn(async () => response(blocked({ url: 'https://fake', objectKey: 'fake', bytes: [1] })))
    const provider = create(request)
    const result = await provider.begin({ ...begin, actor: 'admin', mode: 'owner' })
    expect(result).toEqual(blocked())
    expect(request).toHaveBeenCalledOnce()
    const [url, init] = request.mock.calls[0]
    expect(url).toBe('/api/editor/v1/tenants/tenant/documents/doc/assets')
    expect(init).toMatchObject({ method: 'POST', credentials: 'include', cache: 'no-store', redirect: 'error',
      headers: { 'X-CSRF-Token': 'csrf', 'Idempotency-Key': begin.operationId } })
    expect(JSON.parse(init.body)).toEqual(begin)
    expect(provider.getOperation(begin.operationId)).toMatchObject({ status: 'blocked', assetId: null, body: begin })
  })

  it('未配置host上传时Session走assets准入并明确拒绝，未读Data URL', async () => {
    const request = vi.fn(async (url, init) => response(blocked({ operationId: JSON.parse(init.body).operationId })))
    const session = createDocumentSession({ documentId: 'doc' })
    session.setProvider('assets', create(request))
    const reader = vi.spyOn(FileReader.prototype, 'readAsDataURL')
    try {
      await expect(rejectUnavailableAssetUpload(session, makeFile())).rejects.toMatchObject({ code: 'DEPENDENCY_BLOCKED', status: 'blocked', retryable: false,
        result: { persisted: false, taskId: null, ready: false, objectVerified: false, assetId: null } })
      expect(request).toHaveBeenCalledOnce()
      expect(reader).not.toHaveBeenCalled()
    } finally { reader.mockRestore(); await session.dispose() }
  })

  it.each([
    [200, { status: 'ready', url: 'https://fake', assetId: 'fake' }],
    [503, blocked({ objectVerified: true })],
    [503, blocked({ operationId: 'different' })],
    [503, blocked({ taskId: 'fake-job' })],
  ])('拒绝未证实的成功/异原请求 %s %j，保持unknown且不自动重发', async (status, data) => {
    const request = vi.fn(async () => response(data, status)), provider = create(request)
    await expect(provider.begin(begin)).rejects.toMatchObject({ code: 'ASSET_RESULT_UNKNOWN', status: 'unknown', retryable: false, operationId: begin.operationId })
    expect(provider.getOperation(begin.operationId).status).toBe('unknown')
    await expect(provider.begin(begin)).rejects.toMatchObject({ code: 'ASSET_RESULT_UNKNOWN', status: 'unknown' })
    await expect(provider.begin({ ...begin, fileName: 'changed.png' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_MISMATCH' })
    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls[1][1].method).toBe('GET')
    const copy = provider.getOperation(begin.operationId); copy.body.fileName = 'changed'
    expect(provider.getOperation(begin.operationId).body.fileName).toBe('a.png')
  })

  it('reader可读准入但不能上传，缺失可见能力拒绝所有操作', async () => {
    const request = vi.fn(async () => response(blocked({ operation: 'status', operationId: undefined, assetId: 'asset:one' })))
    const provider = create(request, { getCapabilities: () => ({ canView: true, canEdit: false }) })
    await expect(provider.begin(begin)).rejects.toMatchObject({ code: 'ASSET_WRITE_FORBIDDEN', status: 403 })
    await expect(provider.getStatus('asset:one')).resolves.toMatchObject({ status: 'blocked', assetId: 'asset:one' })
    expect(request.mock.calls[0][0]).toContain('/assets/asset%3Aone')
    expect(request.mock.calls[0][1].method).toBe('GET')
    expect(request.mock.calls[0][1].headers['X-CSRF-Token']).toBeUndefined()
    await expect(create(request, { getCapabilities: () => ({}) }).getStatus('asset:one')).rejects.toMatchObject({ status: 404 })
    expect(request).toHaveBeenCalledOnce()
  })

  it('Range巨大十进制保持精确且只接收blocked元数据，不获取对象字节', async () => {
    const start = '99999999999999999999999999', end = '100000000000000000000000000'
    const blob = vi.fn(), arrayBuffer = vi.fn()
    const request = vi.fn(async () => ({ ...response(blocked({ operation: 'content', operationId: undefined, assetId: 'asset', requestedRange: { kind: 'closed', start, end } })), blob, arrayBuffer }))
    await expect(create(request).getContent({ assetId: 'asset', range: `bytes=${start}-${end}` })).resolves.toMatchObject({ requestedRange: { kind: 'closed', start, end }, ready: false })
    expect(request.mock.calls[0][1].headers.Range).toBe(`bytes=${start}-${end}`)
    expect(blob).not.toHaveBeenCalled(); expect(arrayBuffer).not.toHaveBeenCalled()
    for (const range of ['bytes=2-1', 'bytes=-0', 'bytes=0-1,3-4', 'bytes=01-2', 'bytes=-']) {
      await expect(create(request).getContent({ assetId: 'asset', range })).rejects.toMatchObject({ code: 'ASSET_RANGE_INVALID', status: 416 })
    }
    expect(request).toHaveBeenCalledOnce()
  })

  it('request/json共用15秒期限，超时记录unknown并abort且不重试', async () => {
    vi.useFakeTimers()
    const request = vi.fn(async () => ({ status: 503, json: () => new Promise(() => {}) }))
    const provider = create(request)
    try {
      const pending = expect(provider.begin(begin)).rejects.toMatchObject({ code: 'ASSET_REQUEST_TIMEOUT', status: 'unknown', retryable: false })
      await vi.advanceTimersByTimeAsync(15000)
      await pending
      expect(request.mock.calls[0][1].signal.aborted).toBe(true)
      expect(provider.getOperation(begin.operationId).status).toBe('unknown')
      expect(request).toHaveBeenCalledOnce()
    } finally { provider.dispose(); vi.useRealTimers() }
  })

  it('资产原键重入只GET原operation，不重POST即使原结果尚未知', async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce(response({ status: 'unknown', code: 'OPERATION_UNKNOWN', operation: 'begin', operationId: begin.operationId, assetId: null }, 200))
    const provider = create(request)
    await expect(provider.begin(begin)).rejects.toMatchObject({ status: 'unknown' })
    await expect(provider.begin(begin)).resolves.toMatchObject({ status: 'unknown', operationId: begin.operationId })
    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls[1][0]).toBe(`/api/editor/v1/tenants/tenant/documents/doc/assets/operations/${begin.operationId}?kind=begin`)
    expect(request.mock.calls[1][1].method).toBe('GET')
  })

  it('原请求hash可在未知后补充，查询始终绑定该hash且拒绝无效或不同hash', async () => {
    const requestHash = 'sha256:' + 'a'.repeat(64)
    const request = vi.fn().mockRejectedValueOnce(new Error('lost')).mockResolvedValue(response({ status: 'unknown', code: 'OPERATION_UNKNOWN', operation: 'begin', operationId: begin.operationId }, 200))
    const provider = create(request)
    await expect(provider.begin(begin)).rejects.toMatchObject({ status: 'unknown' })
    await expect(provider.queryOperation({ operationId: begin.operationId, requestHash: 'invalid' })).rejects.toMatchObject({ code: 'ASSET_ORIGINAL_REQUEST_REQUIRED' })
    await expect(provider.queryOperation({ operationId: begin.operationId, requestHash })).resolves.toMatchObject({ status: 'unknown' })
    expect(new URL(request.mock.calls[1][0], 'https://app').searchParams.get('requestHash')).toBe(requestHash)
    expect(provider.getOperation(begin.operationId).requestHash).toBe(requestHash)
    await expect(provider.queryOperation({ operationId: begin.operationId, requestHash: 'sha256:' + 'b'.repeat(64) })).rejects.toMatchObject({ code: 'IDEMPOTENCY_MISMATCH' })
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('已取消signal不发请求、不产生未处理拒绝，仍保留unknown原键供查询', async () => {
    const controller = new AbortController(); controller.abort()
    const request = vi.fn(), provider = create(request)
    await expect(provider.begin({ ...begin, signal: controller.signal })).rejects.toMatchObject({ code: 'ASSET_CANCELLED', status: 'unknown' })
    expect(provider.getOperation(begin.operationId).status).toBe('unknown')
    expect(request).not.toHaveBeenCalled()
    await new Promise(resolve => setTimeout(resolve, 0))
    provider.dispose()
  })

  it('仅服务端已验证的ready元数据可用；完成重入与刷新均查原键，不传对象地址', async () => {
    const ready = asset({ status: 'ready', assetRevision: '90071992547409931234', checksum, ready: true, objectVerified: true, url: 'https://forged', objectKey: 'private' })
    const request = vi.fn()
      .mockResolvedValueOnce(response(committed('begin', asset()), 201))
      .mockResolvedValueOnce(response(committed('complete', ready), 200))
      .mockResolvedValueOnce(response(committed('complete', ready, { replayed: true }), 200))
      .mockResolvedValueOnce(response(committed('complete', ready, { replayed: true }), 200))
      .mockResolvedValueOnce(response({ status: 'available', operation: 'status', assetId: ready.assetId, asset: ready, persisted: true, ready: true, objectVerified: true }, 200))
    const provider = create(request), completion = { operationId: 'complete-original', assetId: ready.assetId, mimeType: begin.mimeType, sizeBytes: begin.sizeBytes, checksum }
    expect((await provider.begin(begin)).asset.status).toBe('pending')
    const completed = await provider.complete({ ...completion, url: 'https://forged', actor: 'admin' })
    expect(completed).toMatchObject({ status: 'committed', ready: true, asset: { assetRevision: ready.assetRevision, checksum } })
    expect(completed.asset.url).toBeUndefined(); expect(completed.asset.objectKey).toBeUndefined()
    expect(Object.isFrozen(completed.asset)).toBe(true)
    expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({ operationId: completion.operationId, sizeBytes: begin.sizeBytes, mimeType: begin.mimeType, checksum })
    await expect(provider.complete(completion)).resolves.toMatchObject({ replayed: true })
    const restored = create(request, { getCapabilities: () => ({ canView: true, canEdit: false }) })
    await expect(restored.queryOperation({ operationId: completion.operationId, kind: 'complete', requestHash })).resolves.toMatchObject({ ready: true, assetId: ready.assetId })
    await expect(restored.getStatus(ready.assetId)).resolves.toMatchObject({ status: 'available', ready: true })
    expect(request.mock.calls.map(([, init]) => init.method)).toEqual(['POST', 'POST', 'GET', 'GET', 'GET'])
    expect(new URL(request.mock.calls[3][0], 'https://app').searchParams.get('requestHash')).toBe(requestHash)
    expect(request.mock.calls[3][1].headers).toEqual({ Accept: 'application/json' })
    provider.dispose(); restored.dispose()
  })

  it('完成声明与已验证checksum不符保持unknown，不生成可用附件', async () => {
    const ready = asset({ status: 'ready', assetRevision: '2', checksum: 'sha256:' + 'c'.repeat(64), ready: true, objectVerified: true })
    const request = vi.fn(async () => response(committed('complete', ready), 200)), provider = create(request)
    await expect(provider.complete({ operationId: 'complete-original', assetId: ready.assetId, mimeType: begin.mimeType, sizeBytes: begin.sizeBytes, checksum })).rejects.toMatchObject({ code: 'ASSET_RESULT_UNKNOWN', status: 'unknown' })
    expect(provider.getOperation('complete-original')).toMatchObject({ status: 'unknown', viewStatus: 'unknown' })
    expect(provider.getOperation('complete-original').result).toBeUndefined()
    expect(request).toHaveBeenCalledOnce()
    provider.dispose()
  })

  it('reset取消在飞请求并清原键，忽略迟到回包；恢复只GET原operation', async () => {
    let resolve
    const request = vi.fn().mockImplementationOnce(() => new Promise(done => { resolve = done }))
      .mockResolvedValueOnce(response({ status: 'unknown', code: 'OPERATION_UNKNOWN', operation: 'begin', operationId: begin.operationId }, 200))
    const provider = create(request), pending = provider.begin(begin)
    provider.reset()
    await expect(pending).rejects.toMatchObject({ code: 'ASSET_CANCELLED', status: 'unknown' })
    expect(request.mock.calls[0][1].signal.aborted).toBe(true)
    expect(provider.getOperation(begin.operationId)).toBeNull()
    resolve(response(committed('begin', asset()), 201))
    await Promise.resolve()
    expect(provider.getOperation(begin.operationId)).toBeNull()
    await expect(provider.queryOperation({ operationId: begin.operationId, kind: 'begin' })).resolves.toMatchObject({ status: 'unknown' })
    expect(request.mock.calls[1][1].method).toBe('GET')
    provider.dispose()
    expect(provider.getOperation(begin.operationId)).toBeNull()
    await expect(provider.begin(begin)).rejects.toMatchObject({ code: 'ASSET_PROVIDER_DISPOSED' })
  })

  it.each([false, true])('受权分块读取验证Range/长度并隔离字节，读中撤权=%s立即停止', async revoke => {
    let visible = true
    const bytes = new Uint8Array([1, 2]), read = vi.fn().mockResolvedValueOnce({ done: false, value: bytes }).mockResolvedValueOnce({ done: true })
    const cancel = vi.fn(), request = vi.fn(async () => ({ status: 206, headers: { get: name => ({ 'Content-Type': 'image/png', 'Content-Length': '2', 'Content-Range': 'bytes 1-2/4' }[name]) },
      body: { getReader: () => ({ read, cancel }) } }))
    const provider = create(request, { getCapabilities: () => ({ canView: visible }) })
    const onChunk = vi.fn(chunk => { expect(chunk).toEqual(bytes); chunk[0] = 99; if (revoke) visible = false })
    const pending = provider.getContent({ assetId: 'asset:one', range: 'bytes=1-2', onChunk })
    if (revoke) await expect(pending).rejects.toMatchObject({ code: 'ASSET_NOT_VISIBLE', bytesRead: '2' })
    else await expect(pending).resolves.toMatchObject({ status: 'completed', bytesRead: '2', contentRange: 'bytes 1-2/4' })
    expect(bytes[0]).toBe(1)
    expect(onChunk).toHaveBeenCalledOnce(); expect(read).toHaveBeenCalledTimes(revoke ? 1 : 2)
    expect(cancel).toHaveBeenCalledOnce(); expect(request.mock.calls[0][1].signal.aborted).toBe(true)
    provider.dispose()
  })
})


// E1组件方法/宿主回调边界；没有真实对象传输，不代表US13浏览器或对象服务验收。
describe('US13 upload callback scope continuation', () => {
  const methods = uploadMixin.methods
  const result = { url: 'https://internal.example/uploaded', attchId: 'attachment-one', name: 'host.pdf', size: 24, mimeType: 'application/pdf' }
  function fixture(upload) {
    const chain = { focus: vi.fn(), setImage: vi.fn(), setFileBlock: vi.fn(), run: vi.fn(() => true) }
    for (const key of ['focus', 'setImage', 'setFileBlock']) chain[key].mockReturnValue(chain)
    const editor = { state: { doc: {}, selection: { to: 1 } }, commands: { setTextSelection: vi.fn() }, chain: vi.fn(() => chain) }
    const session = createDocumentSession({ documentId: 'doc', user: { id: 'alice' } })
    const vm = { ...methods, editor, session, user: { id: 'alice' }, uploadImage: upload, uploadFile: upload,
      writable: () => true, featureEnabled: () => true, effectiveImageMaxSize: MB * 5, effectiveFileMaxSize: MB * 10, error: '' }
    return { vm, chain, session, editor }
  }
  const changes = [
    ['user ABA', vm => { const original = vm.session.user; vm.session.user = { id: 'bob' }; vm.session.user = original }],
    ['provider ABA', vm => { const prior = vm.session.getProvider('assets'); vm.session.setProvider('assets', { begin() {}, complete() {}, getStatus() {}, getContent() {} }); vm.session.setProvider('assets', prior) }],
    ['authorization ABA', vm => { vm.session.setProvider('authorization', { getCapabilities: async () => ({ canView: true, canEdit: true }) }); vm.session.setProvider('authorization', null) }],
    ['asset generation', vm => { vm.session._assetGeneration++ }],
    ['session', vm => { vm.session = createDocumentSession({ documentId: 'doc', user: { id: 'alice' } }) }],
    ['editor', vm => { vm.editor = { ...vm.editor } }],
    ['editor disposed', vm => { vm.editor.isDestroyed = true }],
    ['component disposed', vm => { vm._isBeingDestroyed = true }],
    ['session disposed', vm => vm.session.dispose()],
    ['readonly', vm => { vm.writable = () => false }],
    ['host user', vm => { vm.user = { id: 'bob' } }],
  ]
  const samples = [
    { resolve: 'resolveImageFile', batch: 'insertImageFiles', make: name => makeFile(1024, name+'.png'), insert: 'setImage' },
    { resolve: 'resolveFile', batch: 'insertFileBlocks', make: name => makeFile(1024, name+'.pdf', 'application/pdf'), insert: 'setFileBlock' },
  ]
  for (const sample of samples) {
    for (const outcome of ['ready', 'error']) {
      it.each(changes)(`${sample.resolve} late ${outcome} after %s is discarded`, async (name, change) => {
        let finish, fail
        const held = new Promise((resolve, reject) => { finish = resolve; fail = reject }), upload = vi.fn(() => held)
        const { vm, session } = fixture(upload), file = sample.make('first')
        try {
          const pending = vm[sample.resolve](file)
          expect(upload).toHaveBeenCalledWith(file)
          const generation = session._assetGeneration
          await change(vm)
          if (name.includes('ABA')) expect(session._assetGeneration).toBeGreaterThan(generation)
          vm.error = 'current view error'
          if (outcome === 'ready') finish(result)
          else fail(new Error('old upload error'))
          await expect(pending).resolves.toBeNull()
          expect(vm.error).toBe('current view error')
        } finally { await session.dispose(); await vm.session.dispose() }
      })
      it.each(changes.filter(([name]) => ['user ABA', 'provider ABA', 'asset generation', 'editor', 'component disposed'].includes(name)))(`${sample.batch} late ${outcome} after %s inserts nothing, stops second file and preserves current error`, async (name, change) => {
        let finish, fail
        const held = new Promise((resolve, reject) => { finish = resolve; fail = reject })
        const upload = vi.fn().mockImplementationOnce(() => held).mockResolvedValue(result)
        const { vm, chain, session, editor } = fixture(upload)
        try {
          const pending = vm[sample.batch]([sample.make('first'), sample.make('second')])
          expect(upload).toHaveBeenCalledTimes(1)
          await change(vm); vm.error = 'current view error'
          if (outcome === 'ready') finish(result)
          else fail(new Error('old upload error'))
          await pending
          expect(upload).toHaveBeenCalledTimes(1); expect(chain.run).not.toHaveBeenCalled()
          expect(editor.commands.setTextSelection).not.toHaveBeenCalled(); expect(vm.error).toBe('current view error')
        } finally { await session.dispose(); await vm.session.dispose() }
      })
    }
    it(`${sample.resolve} current host result and error retain callback contract`, async () => {
      const host = { marker: 'bound-host', upload: vi.fn(async function (file) { expect(this.marker).toBe('bound-host'); expect(file.name).toMatch(/first/); return result }) }
      const { vm, session } = fixture(host), file = sample.make('first')
      try {
        const value = await vm[sample.resolve](file)
        if (sample.resolve === 'resolveImageFile') expect(value).toEqual({ src: result.url, attchId: result.attchId })
        else expect(value).toEqual(fileBlockAttrs(file, result))
        expect(host.upload).toHaveBeenCalledOnce()
        const error = new Error('current upload error')
        vm.uploadImage = vm.uploadFile = () => Promise.reject(error)
        await expect(vm[sample.resolve](file)).rejects.toBe(error)
      } finally { await session.dispose() }
    })
    it(`${sample.batch} current failure still reports error and continues other accepted files`, async () => {
      const upload = vi.fn().mockRejectedValueOnce(new Error('current upload error')).mockResolvedValue(result)
      const { vm, chain, session } = fixture(upload)
      try {
        await vm[sample.batch]([sample.make('first'), sample.make('second')])
        expect(upload).toHaveBeenCalledTimes(2); expect(chain[sample.insert]).toHaveBeenCalledOnce()
        expect(vm.error).toBe('current upload error')
      } finally { await session.dispose() }
    })
  }
  it('borrowed plain-object local image boundary retains FileReader fallback without Session/editor', async () => {
    const plain = { writable: () => true, imageMaxSize: MB, uploadImage: null }
    await expect(methods.resolveImageFile.call(plain, makeFile(4))).resolves.toMatchObject({ src: expect.stringMatching(/^data:image\/png;base64,/), attchId: null })
  })
  it.each(['ready', 'error'])('local FileReader late %s is discarded after component disposal', async outcome => {
    const Reader = globalThis.FileReader; let reader
    class HeldReader { constructor() { reader = this } readAsDataURL() {} }
    vi.stubGlobal('FileReader', HeldReader)
    const { vm, session } = fixture(null)
    try {
      const pending = vm.resolveImageFile(makeFile(4)); vm._isDestroyed = true
      if (outcome === 'ready') { reader.result = 'data:image/png;base64,AAAA'; reader.onload() }
      else reader.onerror()
      await expect(pending).resolves.toBeNull()
    } finally { vi.stubGlobal('FileReader', Reader); await session.dispose() }
  })
})


// E1 actual byte requests against the injected HTTP port; no browser/object-store acceptance is implied.
describe('US13 durable browser file ingress continuation', () => {
  const originalCrypto = globalThis.crypto, bytes = Uint8Array.from([0, 255, 1, 128, 65]), operationId = 'complete-bytes', beginOperationId = 'begin-bytes'
  const checksum = 'sha256:' + createHash('sha256').update(bytes).digest('hex'), requestHash = 'sha256:' + 'd'.repeat(64)
  beforeAll(() => vi.stubGlobal('crypto', webcrypto)); afterAll(() => vi.stubGlobal('crypto', originalCrypto))
  const file = (extra = {}) => ({ name: 'bytes.png', type: 'image/png', size: bytes.length, arrayBuffer: vi.fn(async () => bytes.slice().buffer), ...extra })
  const asset = (ready = false, extra = {}) => ({ tenantId: 'tenant', docId: 'doc', assetId: 'asset:bytes', status: ready ? 'ready' : 'pending', assetRevision: ready ? '2' : '1',
    fileName: 'bytes.png', mimeType: 'image/png', sizeBytes: String(bytes.length), checksum: ready ? checksum : null,
    ready, objectVerified: ready, reconciliationRequired: false, physicalDelete: false, ...extra })
  const result = (kind, state = 'committed', extra = {}) => ({ status: state, operation: kind, operationId: kind === 'begin' ? beginOperationId : operationId,
    requestHash, assetId: 'asset:bytes', asset: asset(kind === 'complete' && state === 'committed'), persisted: true,
    ready: kind === 'complete' && state === 'committed', objectVerified: kind === 'complete' && state === 'committed', physicalDelete: false,
    replayed: false, code: null, committedRevision: state === 'pending' ? null : kind === 'begin' ? '1' : '2', ...extra })
  const response = (data, status = 200) => ({ status, json: async () => data })
  function setup(extra = {}) {
    const live = { canEdit: true, response: result('complete') }
    const request = vi.fn(async (url, init) => {
      if (url.endsWith('/assets')) return response(result('begin'), 201)
      if (url.includes('kind=begin')) return response(result('begin'))
      return response(live.response, live.response.status === 'pending' ? 202 : live.response.status === 'unknown' ? 503 : 200)
    })
    const port = createHttpAssetProvider({ baseUrl: '/api', tenantId: 'tenant', docId: 'doc', csrfToken: () => 'csrf',
      getCapabilities: () => ({ canView: true, canEdit: live.canEdit }), request, ...extra })
    return { port, request, live }
  }
  const upload = (port, value = file(), extra = {}) => port.upload({ file: value, operationId, beginOperationId, ...extra })
  it('sends actual copied bytes with original complete query/CSRF/Cookie and returns only the authorized content proxy after durable matching ready', async () => {
    const { port, request } = setup(), input = file(), confirmed = await upload(port, input, { checksum: 'sha256:' + 'a'.repeat(64), sizeBytes: '999' })
    expect(confirmed).toMatchObject({ status: 'committed', persisted: true, ready: true, objectVerified: true, attchId: 'asset:bytes', token: 'asset:bytes',
      url: '/api/editor/v1/tenants/tenant/documents/doc/assets/asset%3Abytes/content', size: bytes.length, mimeType: 'image/png' })
    expect(request).toHaveBeenCalledTimes(2)
    const [url, init] = request.mock.calls[1], query = new URL(url, 'https://local').searchParams
    expect(url).toContain('/asset%3Abytes/upload-operations?'); expect(Object.fromEntries(query)).toEqual({ operationId, sizeBytes: String(bytes.length), mimeType: 'image/png', checksum })
    expect(init).toMatchObject({ method: 'POST', credentials: 'include', cache: 'no-store', redirect: 'error', headers: { 'Content-Type': 'application/octet-stream', 'Idempotency-Key': operationId, 'X-CSRF-Token': 'csrf' } })
    expect(init.body).toBeInstanceOf(Uint8Array); expect(Array.from(init.body)).toEqual(Array.from(bytes))
    expect(port.getOperation(operationId).upload).toEqual({ beginOperationId, fileName: 'bytes.png', mimeType: 'image/png', sizeBytes: String(bytes.length), checksum })
    expect(port.getOperation(operationId)).not.toHaveProperty('file'); expect(port.getOperation(operationId)).not.toHaveProperty('bytes')
    await upload(port); expect(request.mock.calls[2][1].method).toBe('GET'); expect(request.mock.calls[2][0]).toContain('kind=complete&requestHash=')
    expect(request.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(2)
    await expect(upload(port, file({ arrayBuffer: async () => new Uint8Array(bytes.length).buffer }))).rejects.toMatchObject({ code: 'IDEMPOTENCY_MISMATCH' })
    port.dispose()
  })
  it.each(['pending', 'unknown'])('%s retains the original complete ID and only GET scans/finishes on explicit retry', async status => {
    const { port, request, live } = setup()
    live.response = status === 'pending' ? result('complete', 'pending') : { status: 'unknown', operation: 'complete', operationId, code: 'COMMIT_UNKNOWN', requestHash }
    await expect(upload(port)).rejects.toMatchObject({ status, operationId, uploadOperationId: operationId, beginOperationId, retryable: false })
    live.response = result('complete'); await expect(upload(port)).resolves.toMatchObject({ ready: true })
    expect(request.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(2); expect(request.mock.calls[2][1].method).toBe('GET')
    port.dispose()
  })
  it('reset purges private metadata but an explicitly retried seen complete ID remains GET-only', async () => {
    const { port, request } = setup(); await upload(port); port.reset(); expect(port.getOperation(operationId)).toBeNull()
    await expect(upload(port)).resolves.toMatchObject({ ready: true })
    expect(request.mock.calls.map(([, init]) => init.method)).toEqual(['POST', 'POST', 'GET']); expect(request.mock.calls[2][0]).toContain('kind=complete'); port.dispose()
  })
  it('blocked begin keeps its original key and cannot reach a byte POST or return a fake ready URL', async () => {
    const blocked = { status: 'blocked', code: 'DEPENDENCY_BLOCKED', dependency: 'internal-object-storage', operation: 'begin', operationId: beginOperationId,
      assetId: null, persisted: false, taskId: null, ready: false, objectVerified: false }
    const request = vi.fn(async () => response(blocked, 503)), { port } = setup({ request })
    await expect(upload(port)).rejects.toMatchObject({ status: 'blocked', operationId: beginOperationId, uploadOperationId: operationId, metadata: { checksum } })
    await expect(upload(port)).rejects.toMatchObject({ status: 'blocked', operationId: beginOperationId })
    expect(request.mock.calls.map(([, init]) => init.method)).toEqual(['POST', 'GET']); expect(request.mock.calls[1][0]).toContain('kind=begin'); port.dispose()
  })
  it('a pending original upload binds requestHash and rejects a later changed hash without another byte POST', async () => {
    const { port, request, live } = setup(); live.response = result('complete', 'pending')
    await expect(upload(port)).rejects.toMatchObject({ status: 'pending', requestHash })
    live.response = result('complete', 'committed', { requestHash: 'sha256:' + 'a'.repeat(64) })
    await expect(upload(port)).rejects.toMatchObject({ status: 'unknown', operationId }); expect(port.getOperation(operationId).requestHash).toBe(requestHash)
    expect(request.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(2); port.dispose()
  })
  it('concurrent reentry queries the sent complete intent without a second byte POST', async () => {
    let release, entered
    const held = new Promise(resolve => { release = resolve }), waiting = new Promise(resolve => { entered = resolve }), { port, request } = setup()
    const original = request.getMockImplementation()
    request.mockImplementation((url, init) => url.includes('/upload-operations') ? (entered(), held) : original(url, init))
    const first = upload(port).then(value => ({ value }), error => ({ error })); await waiting
    await expect(upload(port)).resolves.toMatchObject({ ready: true }); release(response(result('complete')))
    expect((await first).value.ready).toBe(true); expect(request.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(2); port.dispose()
  })
  it.each([[200, 'pending'], [202, 'committed'], [200, 'unknown']])('byte upload HTTP %s rejects mismatching %s before exposing ready', async (status, state) => {
    const data = state === 'unknown' ? { status: state, operation: 'complete', operationId, code: 'COMMIT_UNKNOWN' } : result('complete', state)
    const request = vi.fn(async url => url.endsWith('/assets') ? response(result('begin'), 201) : response(data, status)), { port } = setup({ request })
    await expect(upload(port)).rejects.toMatchObject({ status: 'unknown', operationId }); port.dispose()
  })
  it('an unknown begin queries the original begin then performs the complete byte POST only once', async () => {
    let first = true
    const request = vi.fn(async (url, init) => {
      if (url.endsWith('/assets') && first) { first = false; return response({ status: 'unknown', operation: 'begin', operationId: beginOperationId, code: 'COMMIT_UNKNOWN' }, 503) }
      return response(result(url.includes('kind=begin') ? 'begin' : 'complete'))
    }), { port } = setup({ request })
    await expect(upload(port)).rejects.toMatchObject({ status: 'unknown', operationId: beginOperationId, uploadOperationId: operationId })
    await expect(upload(port)).resolves.toMatchObject({ ready: true })
    expect(request.mock.calls.map(([, init]) => init.method)).toEqual(['POST', 'GET', 'POST']); port.dispose()
  })
  it.each([
    { checksum: 'sha256:' + 'a'.repeat(64) }, { sizeBytes: '6' }, { mimeType: 'image/jpeg' }, { tenantId: 'other' }, { assetId: 'other' },
  ])('rejects a ready that differs from actual file facts or scope %j without returning an insertable URL', async changed => {
    const { port, live } = setup(); live.response = result('complete', 'committed', { asset: asset(true, changed) })
    await expect(upload(port)).rejects.toMatchObject({ status: 'unknown', operationId }); port.dispose()
  })
  it('validates a finite limit, actual ArrayBuffer/length and pre-abort before object requests', async () => {
    for (const value of [file({ size: 20 * MB + 1 }), file({ size: 1.5 }), file({ arrayBuffer: async () => 'not bytes' }), file({ size: 4 })]) {
      const { port, request } = setup(); await expect(upload(port, value)).rejects.toBeInstanceOf(Error); expect(request).not.toHaveBeenCalled(); port.dispose()
    }
    const { port, request } = setup(), controller = new AbortController(), input = file(); controller.abort()
    await expect(upload(port, input, { signal: controller.signal })).rejects.toMatchObject({ code: 'ASSET_CANCELLED' }); expect(input.arrayBuffer).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled(); port.dispose()
  })
  it.each(['read', 'digest', 'begin', 'transfer'])('reset/permission/abort while awaiting %s cannot post more bytes or expose ready', async phase => {
    for (const change of ['reset', 'permission', 'abort', 'dispose']) {
      let release, entered
      const held = new Promise(resolve => { release = resolve }), waiting = new Promise(resolve => { entered = resolve }), input = file()
      const { port, request, live } = setup(), originalRequest = request.getMockImplementation(), controller = new AbortController()
      let spy, nativeDigest
      if (phase === 'read') input.arrayBuffer = vi.fn(() => { entered(); return held })
      if (phase === 'digest') { nativeDigest = webcrypto.subtle.digest.bind(webcrypto.subtle); spy = vi.spyOn(webcrypto.subtle, 'digest').mockImplementationOnce(() => { entered(); return held }) }
      if (phase === 'begin' || phase === 'transfer') request.mockImplementation((url, init) => {
        if (phase === 'begin' ? url.endsWith('/assets') : url.includes('/upload-operations')) { entered(); return held }
        return originalRequest(url, init)
      })
      const pending = upload(port, input, { signal: controller.signal }).then(value => ({ value }), error => ({ error })); await waiting
      if (change === 'reset') port.reset()
      if (change === 'permission') live.canEdit = false
      if (change === 'abort') controller.abort()
      if (change === 'dispose') port.dispose()
      if (phase === 'read') release(bytes.slice().buffer)
      if (phase === 'digest') release(await nativeDigest('SHA-256', bytes))
      if (phase === 'begin') release(response(result('begin'), 201))
      if (phase === 'transfer') release(response(result('complete')))
      const outcome = await pending; expect(outcome.value).toBeUndefined(); expect(outcome.error).toBeInstanceOf(Error)
      const posts = request.mock.calls.filter(([url]) => url.includes('/upload-operations'))
      expect(posts).toHaveLength(phase === 'transfer' ? 1 : 0); if (spy) spy.mockRestore(); port.dispose()
    }
  })
  it('remote editor image/file uploads use Session/assets instead of legacy callback URLs, while incomplete ports remain blocked', async () => {
    for (const method of ['resolveImageFile', 'resolveFile']) {
      const { port } = setup(), session = createDocumentSession({ documentId: 'doc', user: { id: 'alice' }, assets: port }), host = vi.fn(async () => ({ url: 'https://fake', attchId: 'fake' }))
      // Let generated IDs pass through the same real provider decoder rather than injecting editor attrs.
      const nativeUpload = port.upload; port.upload = value => nativeUpload({ ...value, operationId, beginOperationId })
      const vm = { ...uploadMixin.methods, session, writable: () => true, featureEnabled: () => true, effectiveImageMaxSize: MB, uploadImage: host, uploadFile: host }
      const value = await vm[method](file()); expect(value.src).toContain('/asset%3Abytes/content'); expect(host).not.toHaveBeenCalled(); await session.dispose()
      const remote = { isRemote: true, requiresDurableConfirmation: true, begin: vi.fn(), complete: vi.fn(), getStatus: vi.fn(), getContent: vi.fn(), upload: vi.fn(async () => ({ url: 'https://fake', attchId: 'fake' })) }
      const missing = createDocumentSession({ documentId: 'doc', assets: remote }); vm.session = missing
      await expect(vm[method](file())).rejects.toMatchObject({ code: 'ASSET_UPLOAD_NOT_READY' }); expect(host).not.toHaveBeenCalled(); await missing.dispose()
    }
  })
  it('remote authorization without a full assets port stays blocked and ignores both legacy callbacks and FileReader', async () => {
    const session = createDocumentSession({ documentId: 'doc', authorization: { isRemote: true, getCapabilities: async () => ({ canView: true, canEdit: true }) } })
    await session._capabilitiesPromise
    const host = vi.fn(async () => ({ url: 'https://fake', attchId: 'fake' })), reader = vi.spyOn(FileReader.prototype, 'readAsDataURL')
    const vm = { ...uploadMixin.methods, session, writable: () => true, featureEnabled: () => true, effectiveImageMaxSize: MB, uploadImage: host, uploadFile: host }
    try { for (const method of ['resolveImageFile', 'resolveFile']) await expect(vm[method](file())).rejects.toMatchObject({ code: 'DEPENDENCY_BLOCKED', status: 'blocked' }); expect(host).not.toHaveBeenCalled(); expect(reader).not.toHaveBeenCalled() }
    finally { reader.mockRestore(); await session.dispose() }
  })
  it.each(['identity ABA', 'provider', 'permission', 'dispose'])('real Session %s during remote upload inserts no node and stops the old batch', async change => {
    for (const kind of ['image', 'file']) {
      let release, entered
      const held = new Promise(resolve => { release = resolve }), waiting = new Promise(resolve => { entered = resolve })
      const { port, request } = setup(), originalRequest = request.getMockImplementation()
      request.mockImplementation((url, init) => url.includes('/upload-operations') ? (entered(), held) : originalRequest(url, init))
      const nativeUpload = port.upload; port.upload = value => nativeUpload({ ...value, operationId, beginOperationId })
      const session = createDocumentSession({ documentId: 'doc', user: { id: 'alice' }, assets: port })
      const chain = { focus: vi.fn().mockReturnThis(), setImage: vi.fn().mockReturnThis(), setFileBlock: vi.fn().mockReturnThis(), run: vi.fn() }, editor = { isDestroyed: false, state: { doc: {}, selection: { to: 1 } }, commands: { setTextSelection: vi.fn() }, chain: () => chain }
      const vm = { ...uploadMixin.methods, session, editor, writable: () => session.can('canEdit'), featureEnabled: () => true, effectiveImageMaxSize: MB, effectiveFileMaxSize: MB, error: '' }
      const pending = vm[kind === 'image' ? 'insertImageFiles' : 'insertFileBlocks']([file(), file({ name: 'second.png' })]); await waiting
      if (change === 'identity ABA') { session.user = { id: 'bob' }; session.user = { id: 'alice' } }
      if (change === 'provider') session.setProvider('assets', null)
      if (change === 'permission') { session.setProvider('authorization', { getCapabilities: async () => ({ canView: true, canEdit: false }) }); await session._capabilitiesPromise }
      if (change === 'dispose') await session.dispose()
      vm.error = 'new view error'; release(response(result('complete'))); await pending
      expect(chain.run).not.toHaveBeenCalled(); expect(vm.error).toBe('new view error'); expect(request.mock.calls.filter(([url]) => url.includes('/upload-operations'))).toHaveLength(1)
      await session.dispose()
    }
  })

  it.each([
    ['image', 'ready'], ['image', 'error'], ['file', 'ready'], ['file', 'error'],
  ])('real Vue Session prop A-B-A discards late %s %s and stops the old upload batch', async (kind, outcome) => {
    const require = createRequire(import.meta.url), Vue = require('vue/dist/vue.common.js')
    let release, reject, entered
    const held = new Promise((resolve, fail) => { release = resolve; reject = fail }), waiting = new Promise(resolve => { entered = resolve })
    const { port, request } = setup(), originalRequest = request.getMockImplementation()
    request.mockImplementation((url, init) => url.includes('/upload-operations') ? (entered(), held) : originalRequest(url, init))
    const nativeUpload = port.upload
    port.upload = vi.fn(value => nativeUpload({ ...value, operationId, beginOperationId }))
    const alice = createDocumentSession({ documentId: 'doc', user: { id: 'alice' }, assets: port })
    const bob = createDocumentSession({ documentId: 'doc', user: { id: 'bob' } })
    const chain = { focus: vi.fn().mockReturnThis(), setImage: vi.fn().mockReturnThis(), setFileBlock: vi.fn().mockReturnThis(), run: vi.fn() }
    const editor = { isDestroyed: false, state: { doc: {}, selection: { to: 1 } }, commands: { setTextSelection: vi.fn() }, chain: () => chain }
    const vm = new Vue({ mixins: [uploadMixin], data: () => ({ session: alice, editor, effectiveImageMaxSize: MB, effectiveFileMaxSize: MB, error: '' }),
      methods: { writable() { return this.session.can('canEdit') }, featureEnabled() { return true } } })
    const second = file({ name: 'second.png' })
    const pending = vm[kind === 'image' ? 'insertImageFiles' : 'insertFileBlocks']([file(), second])
    void pending.catch(() => {})
    try {
      await waiting
      const originalSessionGeneration = alice._assetGeneration
      vm.session = bob; vm.session = alice
      expect(alice._assetGeneration).toBe(originalSessionGeneration)
      expect(vm.editor).toBe(editor)
      vm.error = 'current view error'
      if (outcome === 'ready') release(response(result('complete')))
      else reject(new Error('old upload failure'))
      await pending
      expect(chain.setImage).not.toHaveBeenCalled(); expect(chain.setFileBlock).not.toHaveBeenCalled(); expect(chain.run).not.toHaveBeenCalled()
      expect(vm.error).toBe('current view error'); expect(port.upload).toHaveBeenCalledOnce(); expect(second.arrayBuffer).not.toHaveBeenCalled()
      expect(request.mock.calls.filter(([url]) => url.includes('/upload-operations'))).toHaveLength(1)
    } finally {
      release(response(result('complete'))); await pending.catch(() => {})
      vm.session = null; vm.$destroy(); await alice.dispose(); await bob.dispose()
    }
  })
})
