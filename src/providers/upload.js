/* global globalThis */
/**
 * 上传 Provider 出口（P2-02）。
 *
 * 宿主可传三种形态，门面都会归一成同一个 `(file, ctx?) => Promise<result>`：
 *   1. `uploader: { upload, limits?, retry?, chunked?, chunkSize? }` —— 推荐，
 *      四条路径（超限 / 重试 / 取消 / 断点）按需打开；
 *   2. `uploader: fn`（或 `uploadImage: fn`）—— 兼容老写法，等价于只返回 url
 *      的裸函数；
 *   3. 本文件导出的 `createUploadProvider(opt)` 自建实例，自己持有 cancel / pending。
 *
 * 契约见 05 §5.7：`upload(file, ctx) → { url, width?, height?, size, mime, name? }`。
 * 实现与四条路径的判定规则在 `src/core/media/upload.js`（纯逻辑、无 DOM，可单测）。
 */
export {
  createUploadProvider,
  validateUploadFile,
  normalizeUploadResult,
  isRetryable,
  isAbortError,
  fileSignature,
  uploadError,
  UPLOAD_ERROR,
  UPLOAD_MIME_ALLOWLIST,
  DEFAULT_UPLOAD_LIMITS,
  DEFAULT_RETRY,
  DEFAULT_CHUNK_SIZE,
} from '../core/media/upload'

/** 宿主旧函数与完整provider对象共用一个调用边界，不丢method this。 */
export function resolveUploadHandler(value) {
  if (typeof value === 'function') return value
  return value && typeof value.upload === 'function' ? value.upload.bind(value) : null
}

export function createAssetProvider(provider) {
  if (provider == null) return null
  const missing = ['begin', 'complete', 'getStatus', 'getContent'].filter(key => typeof provider[key] !== 'function')
  if (missing.length) throw new Error(`assets Provider 缺少方法：${missing.join(', ')}`)
  return provider
}

const assetText = value => typeof value === 'string' && value.length > 0 && !value.includes('\0')
const assetInteger = value => typeof value === 'string' && /^(0|[1-9][0-9]*)(?![\s\S])/.test(value)
const assetError = (code, status) => Object.assign(new Error(code), { code, status, retryable: false })
const compareInteger = (left, right) => left.length === right.length ? (left === right ? 0 : left < right ? -1 : 1) : left.length - right.length
function assetRange(value) {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length > 512) throw assetError('ASSET_RANGE_INVALID', 416)
  const match = /^bytes=(0|[1-9][0-9]*)?-(0|[1-9][0-9]*)?$/i.exec(value)
  if (!match || match[0] !== value || (!match[1] && !match[2])) throw assetError('ASSET_RANGE_INVALID', 416)
  if (match[1] && match[2]) {
    if (compareInteger(match[1], match[2]) > 0) throw assetError('ASSET_RANGE_INVALID', 416)
    return { kind: 'closed', start: match[1], end: match[2] }
  }
  if (match[1]) return { kind: 'open', start: match[1] }
  if (match[2] === '0') throw assetError('ASSET_RANGE_INVALID', 416)
  return { kind: 'suffix', length: match[2] }
}

/** C13实际字节上传、元数据确认与受权内容代理；未获durable ready不返回可插入附件。 */
export function createHttpAssetProvider(options = {}) {
  const { tenantId, docId } = options
  if (!assetText(tenantId) || !assetText(docId)) throw new TypeError('assets需要固定tenantId/docId')
  const request = options.request || (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null)
  if (typeof request !== 'function') throw new TypeError('assets需要fetch-compatible request')
  const root = `${options.baseUrl == null ? '' : String(options.baseUrl).replace(/\/+$/, '')}/editor/v1/tenants/${encodeURIComponent(tenantId)}/documents/${encodeURIComponent(docId)}/assets`
  const operations = new Map(), controllers = new Map(), uploadIds = new Set()
  const digest = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}(?![\s\S])/.test(value)
  const identifier = value => typeof value === 'string' && /^[A-Za-z0-9._-]{1,128}(?![\s\S])/.test(value)
  const copy = value => JSON.parse(JSON.stringify(value))
  const maxUploadBytes = options.maxUploadBytes === undefined ? 20 * 1024 * 1024 : options.maxUploadBytes
  if (!Number.isSafeInteger(maxUploadBytes) || maxUploadBytes < 1) throw new TypeError('assets需要有限maxUploadBytes')
  let disposed = false, generation = 0
  function permitted(write, purpose) {
    const caps = typeof options.getCapabilities === 'function' ? options.getCapabilities() : null
    if (disposed || !caps || caps.canView !== true) throw assetError(disposed ? 'ASSET_PROVIDER_DISPOSED' : 'ASSET_NOT_VISIBLE', 404)
    if (write && (purpose === 'comment' ? caps.canComment !== true : caps.canEdit !== true)) throw assetError('ASSET_WRITE_FORBIDDEN', 403)
  }
  function metadata(raw, expectedId) {
    if (!raw || raw.tenantId !== tenantId || raw.docId !== docId || !assetText(raw.assetId) || raw.assetId.length > 256 ||
      (expectedId && raw.assetId !== expectedId) || !['pending', 'ready', 'rejected', 'deleted'].includes(raw.status) || !assetInteger(raw.assetRevision) || raw.assetRevision === '0' ||
      typeof raw.fileName !== 'string' || raw.fileName.length > 255 || !assetText(raw.mimeType) || !assetInteger(raw.sizeBytes) ||
      !(raw.checksum === null || digest(raw.checksum)) || raw.ready !== (raw.status === 'ready') || raw.objectVerified !== raw.ready ||
      typeof raw.reconciliationRequired !== 'boolean' || raw.physicalDelete !== false || (raw.ready && !digest(raw.checksum))) throw assetError('ASSET_RESULT_UNKNOWN')
    return Object.freeze({ tenantId, docId, assetId: raw.assetId, status: raw.status, assetRevision: raw.assetRevision, fileName: raw.fileName,
      mimeType: raw.mimeType, sizeBytes: raw.sizeBytes, checksum: raw.checksum, ready: raw.ready, objectVerified: raw.objectVerified,
      reconciliationRequired: raw.reconciliationRequired, physicalDelete: false })
  }
  function operationResult(record, raw, status) {
    if (!raw || raw.operation !== record.kind || raw.operationId !== record.operationId) throw assetError('ASSET_RESULT_UNKNOWN')
    if (raw.status === 'unknown') {
      if (![200, 503].includes(status) || !['OPERATION_UNKNOWN', 'COMMIT_UNKNOWN'].includes(raw.code) || raw.asset !== undefined ||
        (raw.requestHash !== undefined && !digest(raw.requestHash)) || (record.requestHash && raw.requestHash && record.requestHash !== raw.requestHash)) throw assetError('ASSET_RESULT_UNKNOWN')
      return Object.freeze({ status: 'unknown', code: raw.code, operation: record.kind, operationId: record.operationId,
        assetId: record.assetId || null, ...(raw.requestHash ? { requestHash: raw.requestHash } : {}) })
    }
    if (!['pending', 'committed'].includes(raw.status) || (raw.status === 'committed' ? ![200, 201].includes(status) : ![200, 202].includes(status)) ||
      !digest(raw.requestHash) || (record.requestHash && record.requestHash !== raw.requestHash) || !assetText(raw.assetId) ||
      (record.assetId && raw.assetId !== record.assetId) || raw.persisted !== true || raw.physicalDelete !== false || typeof raw.replayed !== 'boolean' ||
      !(raw.code === null || typeof raw.code === 'string') || (raw.status === 'committed' ? !assetInteger(raw.committedRevision) || raw.committedRevision === '0' : raw.committedRevision !== null)) throw assetError('ASSET_RESULT_UNKNOWN')
    const asset = metadata(raw.asset, raw.assetId)
    if (raw.ready !== asset.ready || raw.objectVerified !== asset.objectVerified ||
      (raw.committedRevision && compareInteger(raw.committedRevision, asset.assetRevision) > 0) ||
      (record.committedRevision && raw.committedRevision !== record.committedRevision) ||
      (record.kind === 'begin' && raw.status === 'committed' && raw.committedRevision !== '1')) throw assetError('ASSET_RESULT_UNKNOWN')
    if (record.body) {
      if (record.kind === 'begin' && record.body.fileName !== asset.fileName) throw assetError('ASSET_RESULT_UNKNOWN')
      if (asset.ready && (asset.sizeBytes !== record.body.sizeBytes || asset.mimeType !== record.body.mimeType ||
        (record.kind === 'complete' && asset.checksum !== record.body.checksum))) throw assetError('ASSET_RESULT_UNKNOWN')
    }
    return Object.freeze({ status: raw.status, operation: record.kind, operationId: record.operationId, requestHash: raw.requestHash,
      assetId: raw.assetId, asset, persisted: true, ready: asset.ready, objectVerified: asset.objectVerified,
      physicalDelete: false, replayed: raw.replayed, code: raw.code, committedRevision: raw.committedRevision })
  }
  function reset() { generation++; controllers.forEach((_, controller) => controller.abort()); controllers.clear(); operations.forEach((record, id) => uploadIds.add(id)); operations.clear() }
  async function execute(kind, assetId, body, record, querying, input) {
    const write = Boolean(body && !querying), epoch = generation, binary = input.bytes instanceof Uint8Array
    const purpose = record?.purpose || body?.purpose || input.purpose
    permitted(write, purpose)
    const csrf = write ? (typeof options.csrfToken === 'function' ? options.csrfToken() : options.csrfToken) : null
    if (write && !assetText(csrf)) throw assetError('CSRF_REQUIRED')
    const requestedRange = kind === 'content' ? assetRange(input.range) : undefined
    const headers = { Accept: kind === 'content' ? 'application/octet-stream, application/json' : 'application/json' }
    if (write) Object.assign(headers, { 'Content-Type': binary ? 'application/octet-stream' : 'application/json', 'X-CSRF-Token': csrf, 'Idempotency-Key': record.operationId })
    if (requestedRange) headers.Range = input.range
    let url = kind === 'begin' ? root : `${root}/${encodeURIComponent(assetId)}${kind === 'complete' ? binary ? '/upload-operations' : '/completion-operations' : kind === 'content' ? '/content' : ''}`
    if (kind === 'content' && input.comment) {
      const c = input.comment
      if (!c || Object.keys(c).length !== 3 || !identifier(c.threadId) || !identifier(c.replyId) || !assetInteger(c.replyRevision)) throw assetError('ASSET_INPUT_INVALID', 400)
      url += `?${new URLSearchParams(c)}`
    }
    if (binary) url += `?${new URLSearchParams(body)}`
    if (querying) url = `${root}/operations/${encodeURIComponent(record.operationId)}?${new URLSearchParams({ kind: record.kind, ...(record.requestHash ? { requestHash: record.requestHash } : {}) })}`
    const controller = new AbortController(); controllers.set(controller, record && record.operationId)
    let timer, abortListener, reader, received = '0', reason = 'ASSET_CANCELLED'
    const abort = () => controller.abort()
    const guard = () => { permitted(write, purpose); if (epoch !== generation || controller.signal.aborted || (record && operations.get(record.operationId) !== record)) throw assetError(reason) }
    const cancelled = new Promise((resolve, reject) => {
      abortListener = () => reject(assetError(reason))
      controller.signal.addEventListener('abort', abortListener, { once: true })
      timer = setTimeout(() => { reason = 'ASSET_REQUEST_TIMEOUT'; controller.abort() }, 15000)
    })
    cancelled.catch(() => {}) // 已取消signal会在stage进入race前拒绝；guard仍报告取消。
    if (input.signal) { input.signal.addEventListener('abort', abort, { once: true }); if (input.signal.aborted) controller.abort() }
    const stage = async work => { guard(); const value = await Promise.race([work(), cancelled]); guard(); return value }
    try {
      const response = await stage(() => request(url, { method: write ? 'POST' : 'GET', credentials: 'include', cache: 'no-store', redirect: 'error', headers,
        signal: controller.signal, ...(body && write ? { body: binary ? input.bytes : JSON.stringify(body) } : {}) }))
      if (!response || !Number.isInteger(response.status) || response.redirected) throw assetError('ASSET_INVALID_RESPONSE')
      let result
      if (kind === 'content' && [200, 206].includes(response.status)) {
        if (typeof input.onChunk !== 'function' || !response.body || typeof response.body.getReader !== 'function') throw assetError('ASSET_CONTENT_SINK_REQUIRED')
        const mimeType = response.headers?.get('Content-Type')?.split(';')[0].trim(), length = response.headers?.get('Content-Length'), contentRange = response.headers?.get('Content-Range')
        if (!assetText(mimeType) || !assetInteger(length) || (requestedRange ? response.status !== 206 : response.status !== 200 || contentRange)) throw assetError('ASSET_CONTENT_HEADERS_INVALID')
        if (requestedRange && !matchingContentRange(requestedRange, contentRange, length)) throw assetError('ASSET_RANGE_MISMATCH')
        reader = response.body.getReader()
        for (;;) {
          const entry = await stage(() => reader.read()); if (entry.done) break
          if (!(entry.value instanceof Uint8Array) || entry.value.byteLength < 1) throw assetError('ASSET_INVALID_BYTES')
          received = addInteger(received, String(entry.value.byteLength))
          if (compareInteger(received, length) > 0) throw assetError('ASSET_CONTENT_LENGTH_MISMATCH')
          await stage(() => Promise.resolve(input.onChunk(new Uint8Array(entry.value), { assetId, mimeType })))
        }
        if (received !== length) throw assetError('ASSET_CONTENT_LENGTH_MISMATCH')
        return Object.freeze({ status: 'completed', operation: 'content', assetId, bytesRead: received, mimeType, ...(contentRange ? { contentRange } : {}) })
      }
      const data = await stage(() => response.json())
      if (response.status >= 400 && response.status < 500) throw Object.assign(assetError(data && data.code || 'ASSET_REQUEST_REJECTED', response.status), { serverRejected: true })
      if (binary && response.status !== (data?.status === 'pending' ? 202 : ['blocked', 'unknown'].includes(data?.status) ? 503 : 200)) throw assetError('ASSET_RESULT_UNKNOWN')
      if (response.status === 503 && data && data.status === 'blocked' && data.code === 'DEPENDENCY_BLOCKED' && data.dependency === 'internal-object-storage' &&
        data.operation === (querying ? record.kind : kind) && data.assetId === (querying ? null : assetId) && data.persisted === false && data.taskId === null && data.ready === false && data.objectVerified === false &&
        data.operationId === (record ? record.operationId : undefined)) {
        if (requestedRange ? !data.requestedRange || Object.keys(requestedRange).some(key => requestedRange[key] !== data.requestedRange[key]) : data.requestedRange !== undefined) throw assetError('ASSET_RANGE_MISMATCH')
        result = Object.freeze({ status: 'blocked', code: 'DEPENDENCY_BLOCKED', dependency: 'internal-object-storage', operation: querying ? record.kind : kind,
          ...(record ? { operationId: record.operationId } : {}), assetId, persisted: false, taskId: null, ready: false, objectVerified: false,
          ...(requestedRange ? { requestedRange: Object.freeze(requestedRange) } : {}) })
      } else if (record) result = operationResult(record, data, response.status)
      else if (kind === 'status' && response.status === 200 && data && data.status === 'available' && data.operation === 'status' && data.assetId === assetId && data.persisted === true) {
        const asset = metadata(data.asset, assetId)
        if (data.ready !== asset.ready || data.objectVerified !== asset.objectVerified) throw assetError('ASSET_RESULT_UNKNOWN')
        result = Object.freeze({ status: 'available', operation: 'status', assetId, asset, persisted: true, ready: asset.ready, objectVerified: asset.objectVerified })
      } else throw assetError('ASSET_RESULT_UNKNOWN')
      guard()
      if (record) {
        if (result.requestHash) record.requestHash = result.requestHash
        if (result.assetId) record.assetId = result.assetId
        if (result.committedRevision) record.committedRevision = result.committedRevision
        if (record.status !== 'committed' || result.status === 'committed') record.status = result.status
        record.result = result; record.viewStatus = 'current'
      }
      return result
    } catch (cause) {
      const error = cause && cause.code ? cause : assetError('ASSET_RESULT_UNKNOWN')
      if (record && epoch === generation && !disposed && operations.get(record.operationId) === record) {
        if (record.status !== 'committed') record.status = error.serverRejected ? 'rejected' : 'unknown'
        record.viewStatus = 'unknown'; delete record.result
      }
      throw Object.assign(error, { operationId: record && record.operationId, httpStatus: error.status, status: record ? (error.serverRejected ? 'rejected' : 'unknown') : error.status, bytesRead: received, retryable: false })
    } finally {
      clearTimeout(timer); controller.signal.removeEventListener('abort', abortListener); input.signal?.removeEventListener('abort', abort)
      controllers.delete(controller)
      if (reader) { const closing = reader.cancel(); Promise.resolve(closing).catch(() => {}) }
      controller.abort()
    }
  }
  async function run(kind, input = {}) {
    permitted(kind === 'begin' || kind === 'complete', input.purpose)
    const assetId = kind === 'begin' ? null : input.assetId
    if (kind !== 'begin' && (!assetText(assetId) || assetId.length > 256)) throw assetError('ASSET_ID_REQUIRED', 400)
    if (!['begin', 'complete'].includes(kind)) return execute(kind, assetId, undefined, null, false, { range: input.range, signal: input.signal, onChunk: input.onChunk, comment: input.comment })
    const operationId = input.operationId === undefined ? 'asset-' + Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('') : input.operationId
    if (!identifier(operationId) || !assetInteger(input.sizeBytes) || !assetText(input.mimeType)) throw assetError('ASSET_INPUT_INVALID', 400)
    const body = kind === 'begin' ? { operationId, fileName: input.fileName, mimeType: input.mimeType, sizeBytes: input.sizeBytes, ...(input.purpose === undefined ? {} : { purpose: input.purpose }) }
      : { operationId, sizeBytes: input.sizeBytes, mimeType: input.mimeType, checksum: input.checksum }
    if (input.purpose !== undefined && input.purpose !== 'comment') throw assetError('ASSET_INPUT_INVALID', 400)
    if ((kind === 'begin' && (!assetText(input.fileName) || input.fileName.length > 255)) || (kind === 'complete' && !digest(input.checksum))) throw assetError('ASSET_INPUT_INVALID', 400)
    const prior = operations.get(operationId)
    if (prior) {
      if (prior.kind !== kind || prior.targetAssetId !== assetId || JSON.stringify(prior.body) !== JSON.stringify(body)) throw assetError('IDEMPOTENCY_MISMATCH', 409)
      return execute(kind, prior.assetId, undefined, prior, true, { signal: input.signal })
    }
    if (uploadIds.has(operationId)) throw assetError('ASSET_OPERATION_QUERY_REQUIRED', 409)
    uploadIds.add(operationId)
    const record = { operationId, kind, targetAssetId: assetId, assetId, body: Object.freeze(body), purpose: input.purpose, status: 'pending' }; operations.set(operationId, record)
    return execute(kind, assetId, record.body, record, false, { signal: input.signal })
  }
  const newId = () => 'asset-' + Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')
  async function upload(input = {}) {
    permitted(true, input.purpose)
    if (input.purpose !== undefined && input.purpose !== 'comment') throw assetError('ASSET_INPUT_INVALID', 400)
    const file = input.file, signal = input.signal, epoch = generation, size = file && file.size
    const facts = { fileName: file && file.name, mimeType: file && (file.type || 'application/octet-stream'), sizeBytes: String(size), ...(input.purpose ? { purpose: input.purpose } : {}) }
    if (input.purpose === 'comment' && !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(facts.mimeType)) throw assetError('ASSET_FILE_INVALID', 400)
    if (!file || typeof file.arrayBuffer !== 'function' || !assetText(facts.fileName) || facts.fileName.length > 255 ||
      !Number.isSafeInteger(size) || size < 1 || size > maxUploadBytes || !assetText(facts.mimeType) || facts.mimeType.length > 255 ||
      !/^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,127}\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,127}(?![\s\S])/.test(facts.mimeType)) throw assetError('ASSET_FILE_INVALID', 400)
    if (signal && (typeof signal.addEventListener !== 'function' || signal.aborted)) throw assetError('ASSET_CANCELLED')
    const operationId = input.operationId === undefined ? newId() : input.operationId
    let record = operations.get(operationId)
    const original = record || uploadIds.has(operationId), beginOperationId = input.beginOperationId === undefined ? record?.upload?.beginOperationId || newId() : input.beginOperationId
    if (!identifier(operationId) || !identifier(beginOperationId) || beginOperationId === operationId) throw assetError('ASSET_INPUT_INVALID', 400)
    if (record && (record.kind !== 'complete' || record.upload && (record.upload.beginOperationId !== beginOperationId ||
      Object.keys(facts).some(key => facts[key] !== record.upload[key])))) throw assetError('IDEMPOTENCY_MISMATCH', 409)
    if (!record) {
      record = { operationId, kind: 'complete', purpose: input.purpose, targetAssetId: null, assetId: null, body: null, status: original ? 'unknown' : 'pending',
        ...(!original ? { uploadSent: false, uploadStarted: false, upload: Object.freeze({ beginOperationId, ...facts, checksum: null }) } : {}) }
      operations.set(operationId, record)
    }
    uploadIds.add(operationId) // Retain only seen IDs across reset: an old transfer can be queried, never posted again.
    const guard = () => { permitted(true, input.purpose); if (epoch !== generation || signal?.aborted || operations.get(operationId) !== record) throw assetError('ASSET_CANCELLED') }
    const unresolved = result => {
      const status = result.asset?.status === 'rejected' ? 'rejected' : result.status
      const error = assetError(result.code || 'ASSET_UPLOAD_NOT_READY', status)
      error.message = status === 'blocked' ? '内部对象存储尚未接通；未上传文件、未生成可用附件。' : '附件尚未取得真实可用确认，请查询原上传操作。'
      throw Object.assign(error, { result, operationId: result.operationId, requestHash: result.requestHash })
    }
    const ready = (result, checksum) => {
      const asset = result.asset
      if (result.status !== 'committed' || result.persisted !== true || result.ready !== true || result.objectVerified !== true || !asset?.ready || !asset.objectVerified) return unresolved(result)
      if (asset.fileName !== facts.fileName || asset.sizeBytes !== facts.sizeBytes || asset.mimeType !== facts.mimeType || asset.checksum !== checksum ||
        record.upload?.checksum && record.upload.checksum !== checksum) throw assetError('ASSET_RESULT_UNKNOWN')
      return Object.freeze({ ...result, url: `${root}/${encodeURIComponent(result.assetId)}/content`, attchId: result.assetId, token: result.assetId,
        name: asset.fileName, size: Number(asset.sizeBytes), mime: asset.mimeType, mimeType: asset.mimeType })
    }
    let bytes
    try {
      // Local byte preparation is bounded and cancellable; neither File nor bytes enter the operation ledger.
      const controller = new AbortController(); controllers.set(controller, operationId)
      let timer
      const abort = () => controller.abort(), cancelled = new Promise((resolve, reject) => {
        controller.signal.addEventListener('abort', () => reject(assetError('ASSET_CANCELLED')), { once: true })
        timer = setTimeout(abort, 15000)
      })
      cancelled.catch(() => {})
      signal?.addEventListener('abort', abort, { once: true })
      const stage = async work => { guard(); if (controller.signal.aborted) throw assetError('ASSET_CANCELLED'); const value = await Promise.race([work(), cancelled]); guard(); return value }
      let checksum
      try {
        const buffer = await stage(() => file.arrayBuffer())
        let length
        try { length = Reflect.get(ArrayBuffer.prototype, 'byteLength', buffer) } catch (_) { throw assetError('ASSET_INVALID_BYTES') }
        if (length !== size) throw assetError('ASSET_FILE_LENGTH_MISMATCH')
        bytes = new Uint8Array(ArrayBuffer.prototype.slice.call(buffer, 0))
        if (bytes.byteLength !== size) throw assetError('ASSET_FILE_LENGTH_MISMATCH')
        if (!globalThis.crypto?.subtle) throw assetError('ASSET_HASH_UNAVAILABLE')
        const value = new Uint8Array(await stage(() => globalThis.crypto.subtle.digest('SHA-256', bytes)))
        if (value.byteLength !== 32) throw assetError('ASSET_HASH_UNAVAILABLE')
        checksum = 'sha256:' + Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('')
      } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); controllers.delete(controller); controller.abort() }
      guard()
      if (original && (!record.upload || !record.upload.checksum)) {
        const result = await execute('complete', record.assetId, undefined, record, true, { signal }); guard()
        return ready(result, checksum)
      }
      if (!original) {
        record.upload = Object.freeze({ beginOperationId, ...facts, checksum })
        record.body = Object.freeze({ operationId, sizeBytes: facts.sizeBytes, mimeType: facts.mimeType, checksum })
      } else if (record.upload.checksum !== checksum) throw assetError('IDEMPOTENCY_MISMATCH', 409)
      if (!record.uploadSent) {
        record.uploadStarted = true
        const begun = await run('begin', { operationId: beginOperationId, ...facts, signal }); guard()
        if (begun.status !== 'committed' || begun.persisted !== true) return unresolved(begun)
        if (begun.asset.fileName !== facts.fileName || begun.asset.mimeType !== facts.mimeType || begun.asset.sizeBytes !== facts.sizeBytes) throw assetError('ASSET_RESULT_UNKNOWN')
        if (record.assetId && record.assetId !== begun.assetId) throw assetError('ASSET_RESULT_UNKNOWN')
        record.assetId = record.targetAssetId = begun.assetId
        if (!record.uploadSent) {
          record.uploadSent = true
          const result = await execute('complete', record.assetId, record.body, record, false, { signal, bytes }); guard()
          return ready(result, checksum)
        }
      }
      const result = await execute('complete', record.assetId, undefined, record, true, { signal }); guard()
      return ready(result, checksum)

    } catch (cause) {
      const error = cause && cause.code ? cause : assetError('ASSET_RESULT_UNKNOWN')
      if (epoch === generation && !disposed && operations.get(operationId) === record) {
        const state = ['blocked', 'pending', 'rejected'].includes(error.status) ? error.status : 'unknown'
        if (record.status !== 'committed') record.status = state
        record.viewStatus = state === 'unknown' ? 'unknown' : 'current'; if (state === 'unknown') delete record.result
      }
      if (error.status === undefined) error.status = 'unknown'
      throw Object.assign(error, { operationId: error.operationId || (record.uploadSent ? operationId : beginOperationId), uploadOperationId: operationId,
        beginOperationId, submitted: Boolean(original || record.uploadStarted || record.uploadSent), metadata: { ...facts, checksum: record.upload?.checksum || null }, retryable: false })
    }
  }
  return { isRemote: true, requiresDurableConfirmation: true, upload, uploadCommentImage: input => upload({ ...input, purpose: 'comment' }), begin: input => run('begin', input), complete: input => run('complete', input),
    getStatus: assetId => run('status', { assetId }), getContent: input => run('content', input),
    queryOperation(input) {
      permitted(false)
      const args = typeof input === 'string' ? { operationId: input } : { ...input }
      if (!identifier(args.operationId)) return Promise.reject(assetError('ASSET_OPERATION_REQUIRED', 400))
      if (args.requestHash !== undefined && !digest(args.requestHash)) return Promise.reject(assetError('ASSET_ORIGINAL_REQUEST_REQUIRED', 400))
      let record = operations.get(args.operationId)
      if (record) {
        if ((args.kind !== undefined && args.kind !== record.kind) || (args.requestHash !== undefined && record.requestHash && args.requestHash !== record.requestHash)) return Promise.reject(assetError('IDEMPOTENCY_MISMATCH', 409))
        if (args.requestHash) record.requestHash = args.requestHash
      } else {
        if (!['begin', 'complete'].includes(args.kind)) return Promise.reject(assetError('ASSET_ORIGINAL_REQUEST_REQUIRED', 400))
        record = { operationId: args.operationId, kind: args.kind, body: null, targetAssetId: null, assetId: null, status: 'unknown', ...(args.requestHash ? { requestHash: args.requestHash } : {}) }; operations.set(args.operationId, record)
      }
      return execute(record.kind, record.assetId, undefined, record, true, { signal: args.signal })
    },
    getOperation(id) { try { permitted(false) } catch (_) { return null } return operations.has(id) ? copy(operations.get(id)) : null },
    cancelOperation(id) { controllers.forEach((operationId, controller) => { if (operationId === id) controller.abort() }) },
    reset, dispose() { disposed = true; reset(); uploadIds.clear() } }
}

function addInteger(left, right) {
  let a = left.length - 1, b = right.length - 1, carry = 0, result = ''
  while (a >= 0 || b >= 0 || carry) { const sum = (a >= 0 ? left.charCodeAt(a--) - 48 : 0) + (b >= 0 ? right.charCodeAt(b--) - 48 : 0) + carry; result = String(sum % 10) + result; carry = Math.floor(sum / 10) }
  return result || '0'
}
function subtractInteger(left, right) {
  let b = right.length - 1, borrow = 0, result = ''
  for (let a = left.length - 1; a >= 0; a--) { let digit = left.charCodeAt(a) - 48 - (b >= 0 ? right.charCodeAt(b--) - 48 : 0) - borrow; borrow = digit < 0 ? 1 : 0; if (borrow) digit += 10; result = String(digit) + result }
  return result.replace(/^0+(?=\d)/, '')
}
function matchingContentRange(requested, raw, length) {
  const match = typeof raw === 'string' && /^bytes (0|[1-9][0-9]*)-(0|[1-9][0-9]*)\/(0|[1-9][0-9]*)$/.exec(raw)
  if (!match || match[0] !== raw || match[3] === '0' || compareInteger(match[1], match[2]) > 0 || compareInteger(match[2], match[3]) >= 0 || addInteger(subtractInteger(match[2], match[1]), '1') !== length) return false
  const end = subtractInteger(match[3], '1')
  const start = requested.kind === 'suffix' ? (compareInteger(requested.length, match[3]) >= 0 ? '0' : subtractInteger(match[3], requested.length)) : requested.start
  const expectedEnd = requested.kind === 'closed' && compareInteger(requested.end, end) < 0 ? requested.end : end
  return match[1] === start && match[2] === expectedEnd
}

/** 未接完整对象上传链时仅检查真实准入；绝不能接着落data URL或半截节点。 */
export async function rejectUnavailableAssetUpload(session, file) {
  const provider = session && typeof session.getProvider === 'function' ? session.getProvider('assets') : null
  const result = provider ? await session.beginAssetUpload({ fileName: file.name, mimeType: file.type || 'application/octet-stream', sizeBytes: String(file.size) }) : null
  const error = assetError(result && result.status !== 'blocked' ? 'ASSET_UPLOAD_NOT_CONNECTED' : 'DEPENDENCY_BLOCKED', 'blocked')
  error.message = '内部对象存储尚未接通；未上传文件、未生成可用附件。请配置完整的内部对象上传服务。'
  error.result = result
  error.operationId = result && result.operationId
  throw error
}
