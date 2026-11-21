/* global globalThis */
import { normalizeRemoteVersionDiff, normalizeVersionDiffSource } from '../core/versioning/diff'
/**
 * 版本 Provider 保存不可变快照和恢复操作。恢复应由服务端创建新版本，
 * 不覆盖原版本；本阶段只定义接口，不启用远端实现。
 *
 * 必需方法：list、createSnapshot、get、restore。
 * DocumentSession 的 createVersion/restoreVersion 只消费 createSnapshot
 * 与 restore，并先经 canCreateVersion/canRestoreVersion 能力把关。
 */
export const VERSIONING_METHODS = ['list', 'createSnapshot', 'get', 'restore']

/** 校验不可变版本边界；真正的版本权限和并发检查由服务端完成。 */
export function createVersioningProvider(provider) {
  if (provider == null) return null
  const missing = VERSIONING_METHODS.filter(method => typeof provider[method] !== 'function')
  if (missing.length) throw new Error(`versioning Provider 缺少方法：${missing.join(', ')}`)
  return provider
}

const integer = value => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)
const hash = value => typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value)
const text = value => typeof value === 'string' && value.length > 0 && !value.includes('\0')
const failure = (code, status = null) => Object.assign(new Error(code), { code, status })
const newOperationId = prefix => prefix + '-' + Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')
function nextInteger(value) {
  const digits = value.split('')
  for (let i = digits.length - 1; i >= 0; i--) {
    if (digits[i] !== '9') { digits[i] = String.fromCharCode(digits[i].charCodeAt(0) + 1); return digits.join('') }
    digits[i] = '0'
  }
  return '1' + digits.join('')
}

// 与服务端投影同一JSON语义：对象键排序，数组次序保留；不从投影重建Yjs历史。
function canonical(value, seen = new Set()) {
  if (value && typeof value === 'object') {
    if (seen.has(value)) throw failure('VERSION_INVALID_CONTENT')
    seen.add(value)
    const encoded = Array.isArray(value) ? '[' + value.map(item => canonical(item, seen)).join(',') + ']'
      : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key], seen)).join(',') + '}'
    seen.delete(value)
    return encoded
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw failure('VERSION_INVALID_CONTENT')
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw failure('VERSION_INVALID_CONTENT')
  return encoded
}
async function digest(bytes) {
  const result = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))
  return 'sha256:' + Array.from(result, byte => byte.toString(16).padStart(2, '0')).join('')
}

/** C07真实冻结适配器。正文事实只由服务端捕获，不上传活动编辑器JSON。 */
export function createHttpVersioningProvider(options = {}) {
  const { tenantId, docId } = options
  if (!text(tenantId) || !text(docId)) throw new TypeError('versioning需要tenantId/docId')
  const request = options.request || (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null)
  if (typeof request !== 'function') throw new TypeError('versioning需要fetch-compatible request')
  const base = options.baseUrl == null ? '' : String(options.baseUrl).replace(/\/+$/, '')
  const publicApi = `${base}/editor/v1/tenants/${encodeURIComponent(tenantId)}`
  const documentApi = `${publicApi}/documents/${encodeURIComponent(docId)}`
  const operations = new Map()
  const restoreOperations = new Map()
  const knownContentHashes = new Map()
  const conversionOperations = new Map()
  const recoverableConversions = new Map()
  const conversionControllers = new Set()
  let conversionGeneration = 0, conversionDisposed = false, generation = 0, disposed = false
  const controllers = new Set(), retiredOperations = new Set(), retiredRestores = new Set(), retiredConversions = new Set()
  const restoringIds = new Set(), exportingIds = new Set()
  const contextChanged = () => failure('VERSION_CONTEXT_CHANGED', 409)
  function checkContext(epoch) { if (disposed || epoch !== generation) throw contextChanged() }
  function reset(reason) {
    generation++
    operations.forEach((record, id) => {
      if (reason === 'authorization-required' && record.recoverAfterAuthorization) {
        // Retain the original intent for a fresh authorized query. Invalidate every old continuation.
        operations.set(id, { body: record.body, requestHash: record.requestHash, context: generation, recoverAfterAuthorization: true })
      } else {
        retiredOperations.add(id)
        operations.delete(id)
      }
    })
    restoreOperations.forEach((record, id) => retiredRestores.add(id))
    restoringIds.forEach(id => retiredRestores.add(id)); restoringIds.clear()
    exportingIds.forEach(id => retiredConversions.add(id)); exportingIds.clear()
    restoreOperations.clear(); knownContentHashes.clear()
    provider.resetConversions(reason)
    controllers.forEach(controller => controller.abort()); controllers.clear()
  }

  async function hostHandoff(callback, result, current = () => {}) {
    if (typeof callback !== 'function') throw failure('RESTORE_REOPEN_REQUIRED')
    let timer
    try {
      return await Promise.race([Promise.resolve().then(() => { current(); return callback(result) }), new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(failure('RESTORE_REOPEN_REQUIRED')), 15000)
      })])
    } finally { clearTimeout(timer) }
  }

  function metadata(raw) {
    if (!raw || raw.tenantId !== tenantId || raw.docId !== docId || !text(raw.versionId) || !text(raw.operationId) ||
      !text(raw.createdBy) || typeof raw.createdAt !== 'string' || !Number.isFinite(Date.parse(raw.createdAt)) ||
      ![raw.capturedSeq, raw.sourceRevision, raw.sourceEpoch, raw.schemaVersion].every(integer) ||
      !hash(raw.contentHash) || !hash(raw.stateHash) || typeof raw.label !== 'string' ||
      !['auto', 'manual', 'approval', 'pre_restore', 'post_restore'].includes(raw.purpose) || raw.kind !== raw.purpose || raw.status !== 'durable' ||
      raw.protocolVersion !== 'editor-crdt-v1' || !Number.isSafeInteger(raw.sizeBytes) || raw.sizeBytes < 0) throw failure('VERSION_INVALID_RESPONSE')
    const meta = { ...raw, id: raw.versionId, documentId: raw.docId, author: raw.createdBy,
      createdAtIso: raw.createdAt, createdAt: Date.parse(raw.createdAt) }
    delete meta.payloadBase64
    delete meta.contentJson
    return meta
  }
  async function send(url, body, conversionRequest = false) {
    const epoch = generation; checkContext(epoch)
    const headers = { Accept: 'application/json' }
    if (body) {
      const csrf = typeof options.csrfToken === 'function' ? options.csrfToken() : options.csrfToken
      if (!text(csrf)) throw failure('CSRF_REQUIRED')
      headers['Content-Type'] = 'application/json'; headers['X-CSRF-Token'] = csrf
      if (body.operationId) headers['Idempotency-Key'] = body.operationId
    }
    checkContext(epoch)
    const controller = new AbortController(); controllers.add(controller)
    if (conversionRequest) conversionControllers.add(controller)
    let timer, abort
    const cancelled = new Promise((resolve, reject) => {
      abort = () => reject(contextChanged())
      controller.signal.addEventListener('abort', abort)
    })
    const timeout = new Promise((resolve, reject) => {
      timer = setTimeout(() => { reject(failure('VERSION_REQUEST_TIMEOUT')); controller.abort() }, 15000)
    })
    try {
      return await Promise.race([(async () => {
        const response = await request(url, { method: body ? 'POST' : 'GET', headers, credentials: 'include',
          cache: 'no-store', redirect: 'error', signal: controller.signal, ...(body ? { body: JSON.stringify(body) } : {}) })
        checkContext(epoch)
        if (!response || !Number.isInteger(response.status)) throw failure('VERSION_INVALID_RESPONSE')
        const data = await response.json()
        checkContext(epoch)
        return { httpStatus: response.status, data }
      })(), timeout, cancelled])
    } catch (error) { checkContext(epoch); throw error } finally {
      clearTimeout(timer); controller.signal.removeEventListener('abort', abort)
      controllers.delete(controller); conversionControllers.delete(controller)
    }
  }
  function unknown(operationId, prior, code = 'COMMIT_UNKNOWN', map = operations) {
    checkContext(prior.context)
    const result = Object.freeze({ status: 'unknown', operationId, requestHash: prior.requestHash || null, code })
    map.set(operationId, { ...prior, result })
    return result
  }

  async function restoreUnknown(operationId, prior, code) {
    const result = unknown(operationId, prior, code, restoreOperations)
    try { await hostHandoff(options.isolateDocument, { ...result, isolationReason: 'RESTORE_RESULT_UNKNOWN' }, () => checkContext(prior.context)) }
    catch { /* 结果仍是unknown，不把宿主隔离异常改成未提交。 */ }
    checkContext(prior.context)
    return result
  }
  function reloaded(postEpoch) {
    const state = typeof options.getState === 'function' ? options.getState() : null
    return state && state.status === 'ready' && state.epoch === postEpoch && Array.isArray(state.pending) && state.pending.length === 0 ? state : null
  }
  async function restoreConfirmed(operationId, original, response) {
    checkContext(original.context)
    const prior = restoreOperations.get(operationId) || original
    const data = response.data
    if (response.httpStatus >= 500 || (data && ['unknown', 'pending', 'coordinating'].includes(data.status))) {
      if (data && data.operationId !== operationId) return restoreUnknown(operationId, prior, 'RESTORE_INVALID_RESPONSE')
      const known = data && hash(data.requestHash) && (!prior.requestHash || prior.requestHash === data.requestHash)
        ? { ...prior, requestHash: data.requestHash } : prior
      return restoreUnknown(operationId, known, data && data.code)
    }
    if (response.httpStatus !== 200 && response.httpStatus !== 201) {
      const error = failure(data && data.code || 'RESTORE_REQUEST_REJECTED', response.httpStatus)
      error.operationId = operationId
      restoreOperations.set(operationId, { ...prior, error })
      throw error
    }
    let postVersion
    try {
      if (!data || data.status !== 'committed' || data.operationId !== operationId || !hash(data.requestHash) ||
        (prior.requestHash && data.requestHash !== prior.requestHash) || !text(data.preVersionId) || !text(data.postVersionId) ||
        data.preVersionId === data.postVersionId || !integer(data.preEpoch) || data.postEpoch !== nextInteger(data.preEpoch) ||
        ![data.preStateHash, data.postStateHash, data.preContentHash, data.postContentHash].every(hash)) throw failure('RESTORE_INVALID_RESPONSE')
      postVersion = metadata(data.postVersion)
      const receipt = data.receipt
      if (postVersion.versionId !== data.postVersionId || postVersion.purpose !== 'post_restore' || postVersion.sourceEpoch !== data.postEpoch ||
        postVersion.stateHash !== data.postStateHash || postVersion.contentHash !== data.postContentHash ||
        !receipt || receipt.tenantId !== tenantId || receipt.docId !== docId || receipt.epoch !== data.postEpoch ||
        receipt.status !== 'durable' || receipt.protocolVersion !== 'editor-crdt-v1' || !text(receipt.updateId) || !hash(receipt.payloadHash) ||
        ![receipt.seq, receipt.contentRevision].every(integer) || typeof receipt.committedAt !== 'string' || !Number.isFinite(Date.parse(receipt.committedAt)) ||
        postVersion.capturedSeq !== receipt.seq || postVersion.sourceRevision !== receipt.contentRevision) throw failure('RESTORE_INVALID_RESPONSE')
      if (prior.body && (data.preEpoch !== prior.body.expectedEpoch || receipt.contentRevision !== nextInteger(prior.body.expectedRevision) ||
        (prior.targetContentHash && data.postContentHash !== prior.targetContentHash))) throw failure('RESTORE_INVALID_RESPONSE')
      const previous = prior.result && prior.result.status === 'committed' ? prior.result : null
      if (previous && ['preVersionId', 'postVersionId', 'preEpoch', 'postEpoch', 'postStateHash', 'postContentHash'].some(key => data[key] !== previous[key])) throw failure('RESTORE_INVALID_RESPONSE')
    } catch { return restoreUnknown(operationId, prior, 'RESTORE_INVALID_RESPONSE') }
    // COMMIT事实先记录；宿主重载失败不能改报数据库回滚或恢复失败。
    if (prior.handoffHandled && prior.result && prior.result.status === 'committed') return prior.result
    let result = Object.freeze({ ...data, postVersion: Object.freeze(postVersion), receipt: Object.freeze({ ...data.receipt }),
      reloadRequired: true, editingResumed: false })
    restoreOperations.set(operationId, { ...prior, requestHash: data.requestHash, result, handoffHandled: true })
    if (!reloaded(data.postEpoch)) {
      try {
        await hostHandoff(options.isolateDocument, { ...result, isolationReason: 'EPOCH_MISMATCH' }, () => checkContext(prior.context))
        checkContext(prior.context)
        const reload = options.reloadDocument || options.onRestoreCommitted
        if (typeof reload === 'function') await hostHandoff(reload, result, () => checkContext(prior.context))
      } catch { /* 保持committed和只读重开要求，不能宣称恢复没有发生。 */ }
    }
    checkContext(prior.context)
    const state = reloaded(data.postEpoch)
    result = Object.freeze({ ...result, reloadRequired: !state, editingResumed: Boolean(state && state.canWrite === true) })
    restoreOperations.set(operationId, { ...prior, requestHash: data.requestHash, result, handoffHandled: true })
    return result
  }
  function confirmed(operationId, prior, response) {
    checkContext(prior.context)
    const data = response.data
    if (response.httpStatus >= 500 || (data && (data.status === 'unknown' || data.status === 'pending'))) {
      if (data && data.operationId !== operationId) return unknown(operationId, prior, 'VERSION_INVALID_RESPONSE')
      if (data && hash(data.requestHash) && (!prior.requestHash || prior.requestHash === data.requestHash)) prior = { ...prior, requestHash: data.requestHash }
      return unknown(operationId, prior, data && data.code)
    }
    if (response.httpStatus !== 200 && response.httpStatus !== 201) {
      const error = failure(data && data.code || 'VERSION_REQUEST_REJECTED', response.httpStatus)
      error.operationId = operationId
      operations.set(operationId, { ...prior, error })
      throw error
    }
    try {
      if (!data || data.status !== 'committed' || data.operationId !== operationId || !hash(data.requestHash) ||
        (prior.requestHash && data.requestHash !== prior.requestHash)) throw failure('VERSION_INVALID_RESPONSE')
      const version = metadata(data.version)
      if (version.operationId !== operationId) throw failure('VERSION_INVALID_RESPONSE')
      if (prior.body && (version.sourceRevision !== prior.body.expectedRevision || version.label !== prior.body.label || version.purpose !== prior.body.purpose)) throw failure('VERSION_INVALID_RESPONSE')
      const previous = prior.result && prior.result.version
      if (previous && ['versionId', 'capturedSeq', 'sourceRevision', 'sourceEpoch', 'stateHash', 'contentHash'].some(key => previous[key] !== version[key])) throw failure('VERSION_INVALID_RESPONSE')
      const result = { ...version, status: 'committed', operationId, requestHash: data.requestHash,
        version: Object.freeze({ ...version, status: 'durable' }) }
      operations.set(operationId, { ...prior, requestHash: data.requestHash, result })
      return result
    } catch { return unknown(operationId, prior, 'VERSION_INVALID_RESPONSE') }
  }

  function conversionCapability(kind) {
    if (conversionDisposed) throw failure('CONVERSION_CONTEXT_CHANGED', 409)
    const capabilities = typeof options.getCapabilities === 'function' ? options.getCapabilities() : null
    if (!capabilities || capabilities[kind === 'import' ? 'canEdit' : kind === 'export' ? 'canExport' : 'canView'] !== true) throw failure('CONVERSION_FORBIDDEN', 404)
  }
  function conversionSource(body) {
    const state = typeof options.getState === 'function' ? options.getState() : null
    if (!state || state.status !== 'ready' || !Array.isArray(state.pending) || state.pending.length || !integer(state.epoch) || !integer(state.revision)) throw failure('CONVERSION_SOURCE_NOT_READY', 409)
    if (body && (body.expectedEpoch !== state.epoch || body.expectedRevision !== state.revision)) throw failure('CONVERSION_SOURCE_CONFLICT', 409)
    return state
  }
  function conversionIntent(kind, input, original) {
    const format = input.format
    if (typeof format !== 'string' || !format.trim() || format.length > 128 || format.includes('\0')) throw failure('CONVERSION_FORMAT_INVALID', 400)
    if (kind === 'export') {
      if (!text(input.versionId)) throw failure('VERSION_ID_REQUIRED')
      return { operationId: original.operationId, versionId: input.versionId, format }
    }
    const state = original.body ? null : conversionSource()
    const expectedEpoch = input.expectedEpoch === undefined ? (original.body ? original.body.expectedEpoch : state.epoch) : input.expectedEpoch
    const expectedRevision = input.expectedRevision === undefined ? (original.body ? original.body.expectedRevision : state.revision) : input.expectedRevision
    if (!integer(expectedEpoch) || !integer(expectedRevision)) throw failure('CONVERSION_SOURCE_NOT_READY', 409)
    if (input.assetId !== undefined && !text(input.assetId)) throw failure('CONVERSION_ASSET_REQUIRED', 400)
    return { operationId: original.operationId, expectedEpoch, expectedRevision, format, ...(input.assetId === undefined ? {} : { assetId: input.assetId }) }
  }
  function conversionCurrent(record) {
    if (conversionDisposed || record.generation !== conversionGeneration || conversionOperations.get(record.operationId) !== record) throw failure('CONVERSION_CONTEXT_CHANGED', 409)
  }
  function conversionTask(record, data) {
    if (!data || data.operation !== record.kind || data.operationId !== record.operationId ||
      (record.requestHash && data.requestHash && record.requestHash !== data.requestHash)) throw failure('CONVERSION_RESULT_UNKNOWN')
    if (data.status === 'unknown') {
      if (!['OPERATION_UNKNOWN', 'COMMIT_UNKNOWN'].includes(data.code) || (data.requestHash !== undefined && !hash(data.requestHash))) throw failure('CONVERSION_RESULT_UNKNOWN')
      return Object.freeze({ status: 'unknown', code: data.code, operation: record.kind, operationId: record.operationId, ...(data.requestHash ? { requestHash: data.requestHash } : {}) })
    }
    if (!['pending', 'ready', 'failed'].includes(data.status) || data.tenantId !== tenantId || data.docId !== docId || !hash(data.requestHash) ||
      data.persisted !== true || data.taskId !== record.operationId || data.sourceVerified !== true || typeof data.requestedFormat !== 'string' ||
      (record.body.format !== undefined && data.requestedFormat !== record.body.format) || (data.code !== null && typeof data.code !== 'string')) throw failure('CONVERSION_RESULT_UNKNOWN')
    const result = { status: data.status, operation: record.kind, operationId: record.operationId, requestHash: data.requestHash,
      requestedFormat: data.requestedFormat, persisted: true, taskId: data.taskId, sourceVerified: true, code: data.code }
    if (record.kind === 'export') {
      result.source = normalizeVersionDiffSource(data.source, record.body.versionId)
      if (knownContentHashes.has(result.source.versionId) && knownContentHashes.get(result.source.versionId) !== result.source.contentHash) throw failure('VERSION_HASH_MISMATCH')
      if (data.status === 'ready') {
        const output = data.output
        if (!output || !text(output.mimeType) || /[\r\n]/.test(output.mimeType) || !integer(output.sizeBytes) || !hash(output.checksum)) throw failure('CONVERSION_RESULT_UNKNOWN')
        result.output = Object.freeze({ mimeType: output.mimeType, sizeBytes: output.sizeBytes, checksum: output.checksum })
      }
    } else {
      const source = data.source
      if (!source || !text(source.assetId) || (record.body.assetId !== undefined && source.assetId !== record.body.assetId) ||
        !integer(source.assetRevision) || !text(source.versionId) || !hash(source.checksum) || !integer(source.sizeBytes) || !text(source.mimeType)) throw failure('CONVERSION_RESULT_UNKNOWN')
      result.source = Object.freeze({ assetId: source.assetId, assetRevision: source.assetRevision, versionId: source.versionId, checksum: source.checksum, sizeBytes: source.sizeBytes, mimeType: source.mimeType })
      if (data.status === 'ready') {
        const receipt = data.receipt
        if (!receipt || receipt.tenant_id !== tenantId || receipt.doc_id !== docId || !text(receipt.update_id) || !hash(receipt.payload_hash) ||
          ![receipt.epoch, receipt.seq, receipt.content_revision].every(integer) || receipt.protocol_version !== 'editor-crdt-v1' ||
          typeof receipt.committed_at !== 'string' || !Number.isFinite(Date.parse(receipt.committed_at)) ||
          (record.body.expectedEpoch !== undefined && (receipt.epoch !== record.body.expectedEpoch || receipt.content_revision !== nextInteger(record.body.expectedRevision)))) throw failure('CONVERSION_RESULT_UNKNOWN')
        result.receipt = Object.freeze({ ...receipt }); result.reloadRequired = true
      }
    }
    return Object.freeze(result)
  }
  async function conversion(record, querying) {
    try {
      conversionCurrent(record); conversionCapability(querying ? 'diff' : record.kind)
      if (record.kind === 'import' && !querying) conversionSource(record.body)
      const query = { ...record.body, ...(record.requestHash ? { requestHash: record.requestHash } : {}) }
      const url = `${documentApi}/${record.kind}-operations${querying ? `?${new URLSearchParams(query)}` : ''}`
      const response = await send(url, querying ? undefined : record.body, true), data = response.data
      conversionCurrent(record); conversionCapability(querying ? 'diff' : record.kind)
      if (response.httpStatus === 200 || response.httpStatus === 202) {
        const result = conversionTask(record, data)
        record.status = result.status; record.requestHash = result.requestHash || record.requestHash; record.result = result
        if (record.kind === 'import' && result.status === 'ready' && !record.handoffHandled) {
          record.handoffHandled = true
          try {
            await hostHandoff(options.isolateDocument, { ...result, isolationReason: 'IMPORT_COMMITTED' }, () => conversionCurrent(record))
            conversionCurrent(record)
            await hostHandoff(options.reloadDocument, result, () => conversionCurrent(record))
          }
          catch { /* 已确认receipt保留，宿主重开失败不改报回滚。 */ }
          conversionCurrent(record)
        }
        return result
      }
      if (response.httpStatus !== 503 || !data || data.status !== 'blocked' || data.code !== 'DEPENDENCY_BLOCKED' || data.operation !== record.kind ||
        data.operationId !== record.operationId || data.requestedFormat !== record.body.format || data.formatApproved !== false || data.persisted !== false || data.taskId !== null ||
        !Array.isArray(data.dependencies) || data.dependencies.length !== 3 || new Set(data.dependencies).size !== 3 ||
        !['approved-conversion-formats', 'internal-conversion', 'internal-object-storage'].every(value => data.dependencies.includes(value))) throw failure('CONVERSION_RESULT_UNKNOWN', response.httpStatus)
      const result = { status: 'blocked', code: 'DEPENDENCY_BLOCKED', operation: record.kind, operationId: record.operationId,
        dependencies: Object.freeze(data.dependencies.slice()), requestedFormat: record.body.format, formatApproved: false, persisted: false, taskId: null }
      if (record.kind === 'export') {
        if (data.sourceVerified !== true || data.expectedEpoch !== undefined || data.expectedRevision !== undefined) throw failure('CONVERSION_RESULT_UNKNOWN')
        result.source = normalizeVersionDiffSource(data.source, record.body.versionId); result.sourceVerified = true
        if (knownContentHashes.has(record.body.versionId) && knownContentHashes.get(record.body.versionId) !== result.source.contentHash) throw failure('VERSION_HASH_MISMATCH')
      } else {
        if (data.sourceVerified !== false || data.source !== undefined || data.expectedEpoch !== record.body.expectedEpoch || data.expectedRevision !== record.body.expectedRevision) throw failure('CONVERSION_RESULT_UNKNOWN')
        conversionSource(record.body)
        Object.assign(result, { sourceVerified: false, expectedEpoch: data.expectedEpoch, expectedRevision: data.expectedRevision })
      }
      record.status = 'blocked'; record.result = Object.freeze(result)
      return record.result
    } catch (error) {
      if (record.generation !== conversionGeneration && recoverableConversions.has(record.operationId)) throw Object.assign(failure('CONVERSION_CONTEXT_CHANGED', 'unknown'), { operationId: record.operationId })
      conversionCurrent(record)
      record.status = error.status >= 400 && error.status < 500 ? 'rejected' : 'unknown'
      throw Object.assign(error, { operationId: record.operationId, httpStatus: error.status, status: record.status })
    }
  }
  function requestConversion(kind, input = {}) {
    const epoch = generation, conversionEpoch = conversionGeneration
    conversionCapability(kind)
    const operationId = input.operationId === undefined ? newOperationId('conversion') : input.operationId
    if (!text(operationId)) throw failure('CONVERSION_OPERATION_REQUIRED')
    if (retiredConversions.has(operationId)) throw failure('CONVERSION_CONTEXT_CHANGED', 409)
    if (recoverableConversions.has(operationId)) throw failure('CONVERSION_QUERY_REQUIRED', 409)
    exportingIds.delete(operationId)
    const prior = conversionOperations.get(operationId)
    const body = conversionIntent(kind, input, prior || { operationId })
    if (prior) {
      if (prior.kind !== kind || JSON.stringify(body) !== JSON.stringify(prior.body)) throw failure('IDEMPOTENCY_MISMATCH', 409)
      return conversion(prior, true)
    }
    checkContext(epoch)
    if (conversionEpoch !== conversionGeneration) throw failure('CONVERSION_CONTEXT_CHANGED', 409)
    const record = { operationId, kind, body: Object.freeze(body), status: 'pending', generation: conversionGeneration }
    conversionOperations.set(operationId, record)
    return conversion(record, false)
  }

  const provider = {
    requiresDurableConfirmation: true,
    supportsRestore: typeof options.getState === 'function' && typeof options.getCapabilities === 'function' && typeof options.isolateDocument === 'function',
    async diff(fromVersionId, toVersionId) {
      conversionCapability('diff')
      if (!text(fromVersionId) || !text(toVersionId)) throw failure('VERSION_ID_REQUIRED')
      const response = await send(`${documentApi}/version-diff-operations`, { fromVersionId, toVersionId })
      if (response.httpStatus !== 200) throw failure(response.data && response.data.code || 'VERSION_DIFF_FAILED', response.httpStatus)
      const result = normalizeRemoteVersionDiff(response.data, { tenantId, docId, fromVersionId, toVersionId })
      for (const side of [result.from, result.to]) if (knownContentHashes.has(side.versionId) && knownContentHashes.get(side.versionId) !== side.contentHash) throw failure('VERSION_HASH_MISMATCH')
      return result
    },
    captureImportSource() {
      conversionCapability('import')
      const state = conversionSource()
      if (!integer(state.lastSeq)) throw failure('CONVERSION_SOURCE_NOT_READY', 409)
      return Object.freeze({ expectedEpoch: state.epoch, expectedRevision: state.revision, lastSeq: state.lastSeq })
    },
    requestImport: input => requestConversion('import', input),
    async requestExport(input = {}) {
      const epoch = generation, conversionEpoch = conversionGeneration
      if (retiredConversions.has(input.operationId)) throw failure('CONVERSION_CONTEXT_CHANGED', 409)
      const prior = input.operationId && conversionOperations.get(input.operationId)
      if (input.versionId !== undefined || prior) return requestConversion('export', { ...input, versionId: input.versionId === undefined ? prior.body.versionId : input.versionId })
      conversionCapability('export')
      if (text(input.operationId)) exportingIds.add(input.operationId)
      const before = conversionSource(), list = await provider.list()
      checkContext(epoch)
      if (conversionEpoch !== conversionGeneration) throw failure('CONVERSION_CONTEXT_CHANGED', 409)
      const after = conversionSource()
      if (before.epoch !== after.epoch || before.revision !== after.revision || before.lastSeq !== after.lastSeq) throw failure('CONVERSION_SOURCE_CONFLICT', 409)
      const frozen = list.find(value => value.sourceEpoch === after.epoch && value.sourceRevision === after.revision && value.capturedSeq === after.lastSeq)
      if (!frozen) throw failure('CONVERSION_IMMUTABLE_SOURCE_REQUIRED', 409)
      return requestConversion('export', { ...input, versionId: frozen.versionId })
    },
    queryConversion(input) {
      const args = typeof input === 'string' ? { operationId: input } : input || {}
      if (retiredConversions.has(args.operationId)) throw failure('CONVERSION_CONTEXT_CHANGED', 409)
      let record = conversionOperations.get(args.operationId) || recoverableConversions.get(args.operationId)
      if (record && !conversionOperations.has(args.operationId) && recoverableConversions.has(args.operationId)) {
        conversionCapability('diff')
        record = { ...record }; conversionOperations.set(args.operationId, record)
      }
      if (!record && text(args.operationId) && ['import', 'export'].includes(args.operation) && (args.requestHash === undefined || hash(args.requestHash))) {
        const body = { operationId: args.operationId }
        for (const key of ['format', 'versionId', 'expectedEpoch', 'expectedRevision', 'assetId']) if (args[key] !== undefined) body[key] = args[key]
        record = { operationId: args.operationId, kind: args.operation, body: Object.freeze(body), requestHash: args.requestHash, status: 'unknown', generation: conversionGeneration }
        conversionOperations.set(args.operationId, record)
      }
      if (!record) throw failure('CONVERSION_OPERATION_NOT_FOUND')
      if (args.requestHash !== undefined) {
        if (!hash(args.requestHash) || (record.requestHash && record.requestHash !== args.requestHash)) throw failure('IDEMPOTENCY_MISMATCH', 409)
        record.requestHash = args.requestHash
      }
      if ((args.operation !== undefined && args.operation !== record.kind) || (args.kind !== undefined && args.kind !== record.kind)) throw failure('IDEMPOTENCY_MISMATCH', 409)
      if (Object.keys(record.body).some(key => args[key] !== undefined && args[key] !== record.body[key])) throw failure('IDEMPOTENCY_MISMATCH', 409)
      return conversion(record, true)
    },
    async downloadConversion(input) {
      const id = typeof input === 'string' ? input : input && input.operationId
      const record = conversionOperations.get(id)
      if (!record || record.kind !== 'export' || record.result?.status !== 'ready' || !record.result.output) throw failure('CONVERSION_OUTPUT_NOT_READY', 409)
      conversionCurrent(record); conversionCapability('export')
      const output = record.result.output, max = options.maxDownloadBytes === undefined ? 32 * 1024 * 1024 : options.maxDownloadBytes
      if (!Number.isSafeInteger(max) || max < 1 || !Number.isSafeInteger(Number(output.sizeBytes)) || Number(output.sizeBytes) > max) throw failure('CONVERSION_OUTPUT_LIMIT', 413)
      const audited = options.auditedDownloads === true, headers = { Accept: output.mimeType }
      let download, body
      if (audited) {
        download = record.download
        if (!download || download.status === 'complete') {
          const csrf = typeof options.csrfToken === 'function' ? options.csrfToken() : options.csrfToken
          if (!text(csrf)) throw failure('CSRF_REQUIRED')
          conversionCurrent(record); conversionCapability('export')
          download = { id: newOperationId('download'), status: 'unknown' }
          record.download = download
          body = JSON.stringify({ downloadOperationId: download.id })
          Object.assign(headers, { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, 'Idempotency-Key': download.id })
        }
      }
      const current = () => {
        conversionCurrent(record); conversionCapability('export')
        conversionCurrent(record)
        if (audited && record.download !== download) throw failure('CONVERSION_CONTEXT_CHANGED', 409)
      }
      const query = new URLSearchParams({ requestHash: record.requestHash, ...(audited && !body ? { downloadOperationId: download.id } : {}) })
      const controller = new AbortController(); conversionControllers.add(controller)
      let timer, abort
      const cancelled = new Promise((resolve, reject) => {
        abort = () => reject(Object.assign(failure('CONVERSION_CONTEXT_CHANGED', 409), { operationId: id, ...(download?.id ? { downloadOperationId: download.id } : {}) }))
        controller.signal.addEventListener('abort', abort)
      })
      try {
        return await Promise.race([(async () => {
          current()
          const response = await request(`${documentApi}/export-operations/${encodeURIComponent(id)}/content?${query}`,
            { method: body ? 'POST' : 'GET', credentials: 'include', cache: 'no-store', redirect: 'error', headers, signal: controller.signal, ...(body ? { body } : {}) })
          current()
          if (audited && response?.status === 503 && typeof response.json === 'function') {
            const data = await response.json(); current()
            if (!data || Array.isArray(data) || data.status !== 'unknown' || !['COMMIT_UNKNOWN', 'OPERATION_UNKNOWN'].includes(data.code) ||
              data.operationId !== id || data.downloadOperationId !== download.id || (data.requestHash !== undefined && data.requestHash !== record.requestHash) ||
              Object.keys(data).some(key => !['status', 'code', 'operationId', 'downloadOperationId', 'requestHash'].includes(key))) throw failure('CONVERSION_RESULT_UNKNOWN', 503)
            throw failure(data.code, 503)
          }
          if (response?.status !== 200 || typeof response.arrayBuffer !== 'function') throw failure('CONVERSION_OUTPUT_FAILED', response?.status)
          const bytes = new Uint8Array(await response.arrayBuffer())
          current()
          if (controller.signal.aborted || bytes.byteLength > max || String(bytes.byteLength) !== output.sizeBytes || await digest(bytes) !== output.checksum) throw failure('CONVERSION_OUTPUT_CORRUPT')
          current()
          if (controller.signal.aborted) throw failure('CONVERSION_CONTEXT_CHANGED', 409)
          if (audited) download.status = 'complete'
          return Object.freeze({ status: 'downloaded', operationId: id, bytes, mimeType: output.mimeType, checksum: output.checksum, ...(audited ? { downloadOperationId: download.id } : {}) })
        })(), new Promise((resolve, reject) => { timer = setTimeout(() => { reject(failure('CONVERSION_OUTPUT_TIMEOUT')); controller.abort() }, 15000) }), cancelled])
      } catch (error) {
        if (!audited) throw error
        if (error?.code === 'CONVERSION_CONTEXT_CHANGED' || error?.status === 'unknown' || controller.signal.aborted) {
          // Abort/reset races can reject with an Error owned by the request
          // implementation. Do not rely on mutating that object: retain the
          // original audit key in a fresh, stable unknown result.
          const unknown = failure(error?.code || 'CONVERSION_CONTEXT_CHANGED', 'unknown')
          throw Object.assign(unknown, { operationId: id, downloadOperationId: download.id, status: 'unknown' })
        }
        if (record.generation !== conversionGeneration && recoverableConversions.has(id)) throw Object.assign(failure('CONVERSION_CONTEXT_CHANGED', 'unknown'), { operationId: id, downloadOperationId: download.id })
        try { conversionCurrent(record) } catch (contextError) {
          throw Object.assign(contextError, { operationId: id, downloadOperationId: download.id, status: 'unknown' })
        }
        if (record.download !== download) throw Object.assign(failure('CONVERSION_CONTEXT_CHANGED', 409), { operationId: id, downloadOperationId: download.id })
        throw Object.assign(failure(error?.code || 'CONVERSION_OUTPUT_FAILED', 'unknown'), { operationId: id, downloadOperationId: download.id, httpStatus: typeof error?.status === 'number' ? error.status : null })
      } finally { clearTimeout(timer); controller.signal.removeEventListener('abort', abort); conversionControllers.delete(controller) }
    },
    resetConversions(reason) {
      conversionGeneration++
      const keepQueries = reason === 'authorization-required' && !conversionDisposed
      if (!keepQueries) { recoverableConversions.forEach((_, id) => retiredConversions.add(id)); recoverableConversions.clear() }
      conversionOperations.forEach((record, id) => {
        if (keepQueries && ['pending', 'unknown', 'ready'].includes(record.status)) {
          // A new record invalidates all old continuations. Keep no result, bytes or source projection.
          recoverableConversions.set(id, { operationId: id, kind: record.kind, body: record.body, requestHash: record.requestHash,
            status: 'unknown', generation: conversionGeneration, ...(record.download ? { download: { id: record.download.id, status: 'unknown' } } : {}) })
        } else retiredConversions.add(id)
      }); conversionOperations.clear()
      recoverableConversions.forEach(record => { record.generation = conversionGeneration; if (record.download) record.download = { id: record.download.id, status: 'unknown' } })
      exportingIds.forEach(id => retiredConversions.add(id)); exportingIds.clear()
      conversionControllers.forEach(controller => controller.abort()); conversionControllers.clear()
    },
    reset,
    dispose() { disposed = true; conversionDisposed = true; reset() },
    getConversionOperation: id => conversionOperations.has(id) ? JSON.parse(JSON.stringify(conversionOperations.get(id))) : null,
    async list() {
      const response = await send(`${documentApi}/versions`)
      if (response.httpStatus !== 200 || !Array.isArray(response.data)) throw failure(response.data && response.data.code || 'VERSION_LIST_FAILED', response.httpStatus)
      return response.data.map(raw => {
        if (!raw || typeof raw !== 'object') throw failure('VERSION_INVALID_LIST')
        if ('payloadBase64' in raw || 'contentJson' in raw || 'payload' in raw) throw failure('VERSION_INVALID_LIST')
        return metadata(raw)
      })
    },
    async get(versionId) {
      const epoch = generation
      if (!text(versionId)) throw failure('VERSION_ID_REQUIRED')
      const response = await send(`${documentApi}/versions/${encodeURIComponent(versionId)}`)
      if (response.httpStatus !== 200) throw failure(response.data && response.data.code || 'VERSION_GET_FAILED', response.httpStatus)
      const raw = response.data, meta = metadata(raw)
      if (meta.id !== versionId || typeof raw.payloadBase64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw.payloadBase64) ||
        !raw.contentJson || raw.contentJson.type !== 'doc' || !Array.isArray(raw.contentJson.content)) throw failure('VERSION_INVALID_CONTENT')
      const payload = Uint8Array.from(globalThis.atob(raw.payloadBase64), char => char.charCodeAt(0))
      if (payload.byteLength !== meta.sizeBytes) throw failure('VERSION_HASH_MISMATCH')
      const stateHash = await digest(payload)
      checkContext(epoch)
      if (stateHash !== meta.stateHash) throw failure('VERSION_HASH_MISMATCH')
      const contentHash = await digest(new globalThis.TextEncoder().encode(canonical(raw.contentJson)))
      checkContext(epoch)
      if (contentHash !== meta.contentHash) throw failure('VERSION_HASH_MISMATCH')
      knownContentHashes.set(versionId, meta.contentHash)
      return { ...meta, payload, contentJson: raw.contentJson }
    },
    async createSnapshot(record = {}) {
      const context = generation
      if (record.documentId !== undefined && record.documentId !== docId) throw failure('VERSION_DOCUMENT_MISMATCH')
      if (typeof options.getState !== 'function') throw failure('VERSION_STATE_REQUIRED')
      const state = options.getState()
      if (!state || state.status !== 'ready' || !Array.isArray(state.pending) || state.pending.length) throw failure('VERSION_STATE_NOT_READY')
      const expectedRevision = record.expectedRevision === undefined
        ? (typeof options.getRevision === 'function' ? options.getRevision() : state.revision) : record.expectedRevision
      if (!integer(expectedRevision)) throw failure('VERSION_REVISION_REQUIRED')
      const operationId = record.operationId === undefined ? 'version-' + Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('') : record.operationId
      if (!text(operationId) || (record.label !== undefined && typeof record.label !== 'string')) throw failure('VERSION_INVALID_REQUEST')
      const body = Object.freeze({ operationId, expectedRevision, label: record.label || '', purpose: record.purpose || 'manual' })
      // `auto` 是自动历史版本（编辑落定后由前端提交、后端落库，与飞书一致：前端没有
      // 「创建版本」入口）。手动另存为已下线，`manual` 仍然保留 —— 历史数据与隐藏的
      // 宿主调用方都用它，删掉会让老版本读不出来。
      if (!['auto', 'manual', 'approval'].includes(body.purpose)) throw failure('VERSION_INVALID_REQUEST')
      if (retiredOperations.has(operationId)) throw contextChanged()
      const prior = operations.get(operationId)
      if (prior) {
        if (!prior.body || JSON.stringify(prior.body) !== JSON.stringify(body)) throw failure('IDEMPOTENCY_MISMATCH')
        if (prior.error) throw prior.error
        return prior.result || unknown(operationId, prior)
      }
      checkContext(context)
      const pending = { body, requestHash: null, context, recoverAfterAuthorization: body.purpose === 'manual' && record.recoverAfterAuthorization === true }
      operations.set(operationId, pending)
      let response
      try { response = await send(`${documentApi}/version-operations`, body) }
      catch { return unknown(operationId, pending) }
      return confirmed(operationId, pending, response)
    },
    async queryOperation(operationId) {
      const context = generation
      if (retiredOperations.has(operationId)) throw contextChanged()
      if (!text(operationId)) throw failure('VERSION_ORIGINAL_KEY_REQUIRED')
      const prior = operations.get(operationId) || { body: null, requestHash: null, context }
      operations.set(operationId, prior)
      let response
      try { response = await send(`${publicApi}/operations/${encodeURIComponent(operationId)}?commandType=version`) }
      catch { return unknown(operationId, prior) }
      return confirmed(operationId, prior, response)
    },
    async restore(versionId, args = {}) {
      const context = generation
      if (!text(versionId)) throw failure('VERSION_ID_REQUIRED')
      if (typeof options.getState !== 'function' || typeof options.getCapabilities !== 'function' || typeof options.isolateDocument !== 'function') throw failure('RESTORE_CONFIGURATION_REQUIRED')
      const capabilities = options.getCapabilities()
      if (!capabilities || capabilities.canRestoreVersion !== true) throw failure('RESTORE_FORBIDDEN', 403)
      const state = options.getState()
      if (!state || state.status !== 'ready' || !Array.isArray(state.pending) || state.pending.length || !integer(state.epoch) || !integer(state.revision)) throw failure('RESTORE_STATE_NOT_READY')
      if (args.documentId !== undefined && args.documentId !== docId) throw failure('VERSION_DOCUMENT_MISMATCH')
      const operationId = args.operationId === undefined ? 'restore-' + Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('') : args.operationId
      const body = Object.freeze({ operationId, targetVersionId: versionId,
        expectedRevision: args.expectedRevision === undefined ? state.revision : args.expectedRevision,
        expectedEpoch: args.expectedEpoch === undefined ? state.epoch : args.expectedEpoch })
      if (!text(operationId) || !integer(body.expectedRevision) || !integer(body.expectedEpoch) || body.expectedEpoch !== state.epoch || body.expectedRevision !== state.revision) throw failure('RESTORE_STALE_BASELINE', 409)
      if (retiredRestores.has(operationId)) throw contextChanged()
      restoringIds.add(operationId)
      const prior = restoreOperations.get(operationId)
      if (prior) {
        if (!prior.body || JSON.stringify(prior.body) !== JSON.stringify(body)) throw failure('IDEMPOTENCY_MISMATCH', 409)
        if (prior.error) throw prior.error
        return prior.result || unknown(operationId, prior, 'COMMIT_UNKNOWN', restoreOperations)
      }
      if (!knownContentHashes.has(versionId)) await provider.get(versionId)
      checkContext(context)
      const latest = options.getState(), actual = options.getCapabilities()
      if (!actual || actual.canRestoreVersion !== true) throw failure('RESTORE_FORBIDDEN', 403)
      if (!latest || latest.status !== 'ready' || !Array.isArray(latest.pending) || latest.pending.length ||
        latest.epoch !== body.expectedEpoch || latest.revision !== body.expectedRevision) throw failure('RESTORE_STALE_BASELINE', 409)
      checkContext(context)
      const targetContentHash = knownContentHashes.get(versionId)
      const pending = { body, requestHash: null, targetContentHash, context }
      restoreOperations.set(operationId, pending)
      let response
      try { response = await send(`${documentApi}/restore-operations`, body) }
      catch { return restoreUnknown(operationId, pending, 'COMMIT_UNKNOWN') }
      return restoreConfirmed(operationId, pending, response)
    },
    async queryRestoreOperation(operationId) {
      const context = generation
      if (retiredRestores.has(operationId)) throw contextChanged()
      if (!text(operationId)) throw failure('RESTORE_ORIGINAL_KEY_REQUIRED')
      const prior = restoreOperations.get(operationId) || { body: null, requestHash: null, context }
      restoreOperations.set(operationId, prior)
      let response
      try { response = await send(`${publicApi}/operations/${encodeURIComponent(operationId)}?commandType=restore`) }
      catch { return restoreUnknown(operationId, prior, 'COMMIT_UNKNOWN') }
      return restoreConfirmed(operationId, prior, response)
    },
  }
  for (const name of Object.keys(provider)) {
    if (typeof provider[name] !== 'function' || ['reset', 'resetConversions', 'dispose', 'getConversionOperation'].includes(name)) continue
    const method = provider[name]
    provider[name] = (...args) => {
      const epoch = generation
      checkContext(epoch)
      const result = method(...args)
      if (!result || typeof result.then !== 'function') { checkContext(epoch); return result }
      return result.then(value => { checkContext(epoch); return value }, error => {
        if (epoch !== generation && recoverableConversions.has(error.operationId)) {
          throw Object.assign(failure('CONVERSION_CONTEXT_CHANGED', 'unknown'), {
            operationId: error.operationId,
            ...(error.downloadOperationId ? { downloadOperationId: error.downloadOperationId } : {}),
          })
        }
        checkContext(epoch); throw error
      })
    }
  }
  return provider
}
