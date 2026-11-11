/* global globalThis */
/**
 * 权限是能力集合。服务端返回的能力是最终判断，编辑器只用它控制按钮和
 * 交互；这样即使 UI 被绕过，后端仍可拒绝写入、评论或恢复版本。
 *
 * 必需方法：getCapabilities() —— 返回能力对象（Promise 或同步均可）。
 * 宿主实现自定义 Provider 时只需提供该方法；DocumentSession 在构造和
 * setProvider('authorization') 时调用它刷新能力，供 can()/UI 消费。
 */
export const DEFAULT_CAPABILITIES = Object.freeze({
  canView: true,
  canEdit: true,
  canComment: true,
  canResolveComment: true,
  canCreateVersion: true,
  canRestoreVersion: true,
  canExport: true,
  canManagePermission: false,
  canCopy: true,
})

export const ASYNC_STATE_CAPABILITIES = Object.freeze({
  empty: Object.freeze({ visible: true, read: true, edit: true, delete: true, comment: true, retry: true }),
  loading: Object.freeze({ visible: true, read: false, edit: false, delete: true, comment: false, retry: false }),
  failed: Object.freeze({ visible: true, read: false, edit: false, delete: true, comment: false, retry: true }),
  unauthorized: Object.freeze({ visible: true, read: false, edit: false, delete: true, comment: false, retry: false }),
  over_limit: Object.freeze({ visible: true, read: false, edit: false, delete: true, comment: false, retry: false }),
})

export function projectCapabilitiesForState(state) {
  return { ...(ASYNC_STATE_CAPABILITIES[state] || ASYNC_STATE_CAPABILITIES.empty) }
}

export function normalizeCapabilities(value = {}) {
  const input = value && typeof value === 'object' ? value : {}
  const normalized = { ...DEFAULT_CAPABILITIES, ...input }
  return {
    ...normalized,
    visible: input.visible === undefined ? normalized.canView !== false : input.visible !== false,
    read: input.read === undefined ? normalized.canView !== false : input.read !== false,
    edit: input.edit === undefined ? normalized.canEdit !== false : input.edit !== false,
    delete: input.delete === undefined ? normalized.canEdit !== false : input.delete !== false,
    comment: input.comment === undefined ? normalized.canComment !== false : input.comment !== false,
    restore: input.restore === undefined ? normalized.canRestoreVersion !== false : input.restore !== false,
    duplicate: input.duplicate === undefined ? normalized.canEdit !== false : input.duplicate !== false,
    export: input.export === undefined ? normalized.canExport !== false : input.export !== false,
  }
}

export const DENIED_CAPABILITIES = Object.freeze(Object.fromEntries(Object.keys(DEFAULT_CAPABILITIES).map(key => [key, false])))

/** 远端能力只接受已知布尔值；缺失、未知和不可见文档一律关闭。 */
export function normalizeRemoteCapabilities(value) {
  const result = { ...DENIED_CAPABILITIES }
  if (value && typeof value === 'object') Object.keys(result).forEach(key => { result[key] = value[key] === true })
  if (!result.canView) return { ...DENIED_CAPABILITIES }
  if (!result.canEdit) result.canRestoreVersion = false
  return result
}

function capabilitiesFromScopes(value) {
  const scopes = new Set(Array.isArray(value) ? value.filter(scope => typeof scope === 'string') : [])
  const canView = scopes.has('document.read') || scopes.has('document.write')
  return {
    canView,
    canEdit: canView && scopes.has('document.write'),
    canComment: canView && scopes.has('comment.write'),
    canResolveComment: canView && scopes.has('comment.resolve'),
    canCreateVersion: canView && scopes.has('version.create'),
    canRestoreVersion: canView && scopes.has('document.write') && scopes.has('version.restore'),
    canExport: canView && scopes.has('document.export'),
    canManagePermission: canView && scopes.has('grant.manage'),
    canCopy: canView,
  }
}

const required = (value, name) => {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw new TypeError(`authorization: ${name} 必须是非空字符串`)
  return value
}
function authorizationError(code, status) {
  return Object.assign(new Error(code), { code, status })
}
const decimal = value => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)
const copy = value => JSON.parse(JSON.stringify(value))
const atLeast = (value, minimum) => value.length > minimum.length || (value.length === minimum.length && value >= minimum)
const digest = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value)
function nextRevision(value) {
  const digits = value.split(''); let carry = 1
  for (let index = digits.length - 1; index >= 0 && carry; index--) {
    const next = Number(digits[index]) + carry; digits[index] = String(next % 10); carry = next > 9 ? 1 : 0
  }
  return `${carry ? '1' : ''}${digits.join('')}`
}
function operationId(prefix) {
  if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== 'function') throw authorizationError('AUTHORIZATION_RANDOM_UNAVAILABLE')
  return `${prefix}-${Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')}`
}

/** Cookie会话的真实权限端口；固定文档、有限总等待、不重试，不接受请求actor。 */
export function createHttpAuthorizationProvider(options = {}) {
  const tenantId = required(options.tenantId, 'tenantId')
  const docId = required(options.docId, 'docId')
  const baseUrl = options.baseUrl == null ? '' : String(options.baseUrl).replace(/\/+$/, '')
  const request = options.request || (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null)
  if (typeof request !== 'function') throw new TypeError('authorization: 需要 fetch-compatible request')
  const documentUrl = `${baseUrl}/editor/v1/tenants/${encodeURIComponent(tenantId)}/documents/${encodeURIComponent(docId)}`
  const tenantUrl = `${baseUrl}/editor/v1/tenants/${encodeURIComponent(tenantId)}`
  const mentions = new Map(), shares = new Map(), retiredMentions = new Set(), retiredShares = new Set(), controllers = new Set()
  const recoverableShares = new Map(), shareLinkAccessPorts = new Set()
  let generation = 0, disposed = false
  let settingsPromise, settingsPort, informationPromise, informationPort, accessPromise, accessPort, shareLinkPromise, shareLinkPort
  const canRecoverOperation = id => typeof id === 'string' && (recoverableShares.has(id) || settingsPort?.canRecover(id) || informationPort?.canRecover?.(id) || shareLinkPort?.canRecover(id) || accessPort?.canRecover?.(id))
  const contextChanged = id => Object.assign(authorizationError('AUTHORIZATION_CONTEXT_CHANGED', 'unknown'), id ? { operationId: id } : {})
  function checkContext(epoch, id) { if (disposed || epoch !== generation) throw contextChanged(id) }
  function checkRecord(record, records) { if (disposed || records.get(record.operationId) !== record) throw contextChanged(record.operationId) }
  function reset(reason) {
    generation++
    if (reason !== 'authorization-required') { shareLinkAccessPorts.forEach(port => port.dispose?.()); shareLinkAccessPorts.clear() }
    settingsPort?.reset(reason)
    informationPort?.reset(reason)
    accessPort?.reset(reason)
    shareLinkPort?.reset(reason)
    const keepQueries = reason === 'authorization-required' && !disposed
    if (!keepQueries) { recoverableShares.forEach((_, id) => retiredShares.add(id)); recoverableShares.clear() }
    mentions.forEach((_, id) => retiredMentions.add(id))
    shares.forEach((record, id) => {
      if (keepQueries && ['pending', 'unknown', 'committed'].includes(record.status)) recoverableShares.set(id, { operationId: id, body: record.body, requestHash: record.requestHash, status: 'unknown' })
      else retiredShares.add(id)
    })
    mentions.clear(); shares.clear(); controllers.forEach(controller => controller.abort()); controllers.clear()
  }

  async function send(path, body, raw = false, base = documentUrl) {
    const epoch = generation; checkContext(epoch)
    const headers = { Accept: 'application/json' }
    if (body) {
      headers['Content-Type'] = 'application/json'
      headers['X-CSRF-Token'] = required(typeof options.csrfToken === 'function' ? options.csrfToken() : options.csrfToken, 'csrfToken')
      if (body.operationId) headers['Idempotency-Key'] = body.operationId
    }
    checkContext(epoch)
    const controller = new AbortController(); controllers.add(controller)
    let abortListener
    const cancelled = new Promise((_, reject) => { abortListener = () => reject(contextChanged()); controller.signal.addEventListener('abort', abortListener, { once: true }) })
    let timer
    const timeout = new Promise((resolve, reject) => {
      timer = setTimeout(() => { reject(authorizationError('AUTHORIZATION_TIMEOUT', null)); controller.abort() }, 15000)
    })
    try {
      const result = await Promise.race([(async () => {
        const response = await request(`${base}/${path}`, { method: body ? 'POST' : 'GET', headers,
          credentials: 'include', cache: 'no-store', redirect: 'error', signal: controller.signal,
          ...(body ? { body: JSON.stringify(body) } : {}),
        })
        checkContext(epoch)
        if (!response || !Number.isInteger(response.status)) throw authorizationError('AUTHORIZATION_INVALID_RESPONSE', null)
        let data
        try { data = await response.json(); checkContext(epoch) }
        catch { checkContext(epoch); throw authorizationError(response.status >= 200 && response.status < 300 ? 'AUTHORIZATION_INVALID_RESPONSE' : 'AUTHORIZATION_REQUEST_FAILED', response.status) }
        if (raw) return { data, status: response.status }
        if (response.status < 200 || response.status >= 300) {
          throw authorizationError(data && typeof data.code === 'string' ? data.code : 'AUTHORIZATION_REQUEST_FAILED', response.status)
        }
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw authorizationError('AUTHORIZATION_INVALID_RESPONSE', response.status)
        if (data.status === 'unknown' || data.status === 'revoked' || data.revoked === true) throw authorizationError('AUTHORIZATION_UNKNOWN', response.status)
        return data
      })(), timeout, cancelled])
      checkContext(epoch); return result
    } catch (error) { checkContext(epoch); throw error }
    finally { clearTimeout(timer); controller.signal.removeEventListener('abort', abortListener); controllers.delete(controller) }
  }

  async function sharingSettings(method, input) {
    const epoch = generation; checkContext(epoch)
    if (!settingsPromise) settingsPromise = import(/* webpackChunkName: "sharing-settings" */ './sharing-settings').then(module =>
      (settingsPort = module.createSharingSettingsPort({ tenantId, docId, send, tenantUrl, requireCapability, operationId,
        error: authorizationError, contextChanged, decimal, digest, nextRevision })))
    const port = await settingsPromise; checkContext(epoch)
    return port[method](input)
  }

  async function shareLink(method, input) {
    const epoch = generation; checkContext(epoch)
    if (!['get', 'request', 'query', 'operation', 'canRecover'].includes(method)) throw authorizationError('SHARE_LINK_INVALID')
    if (!shareLinkPromise) shareLinkPromise = import(/* webpackChunkName: "share-links" */ './share-links').then(module =>
      (shareLinkPort = module.createShareLinkPort({ tenantId, docId, send, tenantUrl, requireCapability, operationId,
        error: authorizationError, contextChanged, decimal, digest, nextRevision })))
    const port = await shareLinkPromise; checkContext(epoch)
    return port[method](input)
  }

  async function documentAccess(method, input) {
    const epoch = generation; checkContext(epoch)
    if (!['list', 'request', 'query', 'operation'].includes(method)) throw authorizationError('DOCUMENT_ACCESS_INVALID')
    if (!accessPromise) accessPromise = import(/* webpackChunkName: "document-access" */ './document-access').then(module =>
      (accessPort = module.createDocumentAccessPort({ tenantId, docId, send, tenantUrl, operationId, error: authorizationError,
        contextChanged, decimal, digest, requireIdentity: () => { if (disposed) throw contextChanged() } })))
    const port = await accessPromise; checkContext(epoch)
    return port[method](input)
  }

  async function documentInformation(method, input) {
    const epoch = generation; checkContext(epoch)
    if (!informationPromise) informationPromise = import(/* webpackChunkName: "document-information" */ './document-information').then(module =>
      (informationPort = module.createDocumentInformationPort({ tenantId, docId, send, tenantUrl, requireCapability, operationId,
        error: authorizationError, contextChanged, decimal, digest, nextRevision })))
    const port = await informationPromise; checkContext(epoch)
    if (!['read', 'request', 'query', 'operation', 'observeGeneration', 'observeInformationRevision'].includes(method)) throw authorizationError('DOCUMENT_INFORMATION_INVALID')
    return port[method](input)
  }

  function requireCapability(capability) {
    if (typeof options.getCapabilities !== 'function' || options.getCapabilities()?.[capability] !== true) throw authorizationError('AUTHORIZATION_NOT_VISIBLE', 404)
  }
  function source(input, original) {
    const state = typeof options.getState === 'function' ? options.getState() : null
    const value = original || { sourceEpoch: input.sourceEpoch === undefined ? state && state.epoch : input.sourceEpoch,
      sourceSeq: input.sourceSeq === undefined ? state && state.lastSeq : input.sourceSeq }
    if (!decimal(value.sourceEpoch) || !decimal(value.sourceSeq)) throw authorizationError('MENTION_SOURCE_REQUIRED', 400)
    if (typeof options.getState === 'function' && (!state || state.status !== 'ready' || !Array.isArray(state.pending) || state.pending.length ||
      state.epoch !== value.sourceEpoch || state.lastSeq !== value.sourceSeq)) throw authorizationError('MENTION_SOURCE_CONFLICT', 409)
    return value
  }
  function mentionKinds(value) {
    if (value === undefined) return undefined
    if (!Array.isArray(value) || !value.length || value.length > 2 || value.some(kind => !['user', 'page'].includes(kind))) throw authorizationError('MENTION_QUERY_INVALID', 400)
    return Object.freeze(['user', 'page'].filter(kind => value.includes(kind)))
  }
  function mentionIntent(record, input, writing = false) {
    for (const key of ['sourceEpoch', 'sourceSeq', 'query']) if (input[key] !== undefined && input[key] !== record.body[key]) throw authorizationError('IDEMPOTENCY_MISMATCH', 409)
    if ((writing || input.kinds !== undefined) && JSON.stringify(mentionKinds(input.kinds)) !== JSON.stringify(record.body.kinds)) throw authorizationError('IDEMPOTENCY_MISMATCH', 409)
  }
  function mentionHash(record, value) {
    if (!digest(value) || value.length !== 71 || (record.requestHash && record.requestHash !== value)) throw authorizationError('MENTION_RESULT_UNKNOWN')
    record.requestHash = value
  }
  function resolvedMention(record, data) {
    checkRecord(record, mentions)
    const fields = ['status', 'tenantId', 'docId', 'operationId', 'sourceEpoch', 'sourceSeq', 'requestHash', 'candidates', 'persisted', 'notified', 'shared', 'replayed']
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !fields.includes(key)) ||
      data.status !== 'resolved' || data.tenantId !== tenantId || data.docId !== docId || data.operationId !== record.operationId ||
      data.sourceEpoch !== record.body.sourceEpoch || data.sourceSeq !== record.body.sourceSeq || data.persisted !== true ||
      data.notified !== false || data.shared !== false || typeof data.replayed !== 'boolean' || !Array.isArray(data.candidates) || data.candidates.length > (record.body.kinds ? 20 : 100)) throw authorizationError('MENTION_RESULT_UNKNOWN')
    const seen = new Set()
    const candidates = data.candidates.map(value => {
      const key = value?.kind === 'page' ? 'docId' : 'principalId', identity = value?.[key], typed = `${value?.kind}:${identity}`
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(field => ![key, 'displayName', 'kind'].includes(field)) ||
        !(record.body.kinds || ['user']).includes(value.kind) || typeof identity !== 'string' || !/^[A-Za-z0-9._-]{1,128}(?![\s\S])/.test(identity) || seen.has(typed) ||
        typeof value.displayName !== 'string' || value.displayName.length < 1 || value.displayName.length > (value.kind === 'page' ? 255 : 64) || /[\p{Cc}]/u.test(value.displayName)) throw authorizationError('MENTION_RESULT_UNKNOWN')
      seen.add(typed)
      return { [key]: identity, displayName: value.displayName, kind: value.kind }
    })
    mentionHash(record, data.requestHash)
    record.status = 'resolved'
    return { ...data, candidates }
  }
  async function mention(record, querying) {
    checkRecord(record, mentions)
    try {
      requireCapability('canView'); source({}, record.body)
      const path = `mention-resolution-operations${querying ? `?${new URLSearchParams({ ...record.body, ...(record.body.kinds ? { kinds: record.body.kinds.join(',') } : {}) })}` : ''}`
      const { data, status } = await send(path, querying ? undefined : record.body, true)
      checkRecord(record, mentions); requireCapability('canView'); source({}, record.body)
      if (status === 200 && data && data.status === 'resolved') return resolvedMention(record, data)
      if ([200, 503].includes(status) && data && data.status === 'unknown' && ['OPERATION_UNKNOWN', 'COMMIT_UNKNOWN'].includes(data.code) &&
        Object.keys(data).every(key => ['status', 'code', 'operationId', 'sourceEpoch', 'sourceSeq', 'requestHash'].includes(key)) &&
        data.operationId === record.operationId && data.sourceEpoch === record.body.sourceEpoch && data.sourceSeq === record.body.sourceSeq && data.requestHash !== undefined) mentionHash(record, data.requestHash)
      if (status === 503 && data && data.status === 'blocked' && data.code === 'DEPENDENCY_BLOCKED' && data.dependency === 'internal-directory' &&
        data.operationId === record.operationId && data.sourceEpoch === record.body.sourceEpoch && data.sourceSeq === record.body.sourceSeq &&
        data.persisted === false && data.taskId === null && data.notified === false && data.shared === false) {
        record.status = 'blocked'
        return { status: 'blocked', code: 'DEPENDENCY_BLOCKED', dependency: 'internal-directory', operationId: record.operationId,
          sourceEpoch: record.body.sourceEpoch, sourceSeq: record.body.sourceSeq, persisted: false, taskId: null, notified: false, shared: false }
      }
      throw authorizationError(status >= 400 && status < 500 ? (status === 409 ? 'MENTION_SOURCE_CONFLICT' : status === 404 || status === 403 ? 'AUTHORIZATION_NOT_VISIBLE' : 'MENTION_REQUEST_REJECTED') : 'MENTION_RESULT_UNKNOWN', status)
    } catch (error) {
      checkRecord(record, mentions)
      const rejected = typeof error.status === 'number' && error.status >= 400 && error.status < 500
      record.status = rejected ? 'rejected' : 'unknown'
      throw Object.assign(error, { operationId: record.operationId, httpStatus: error.status, status: record.status })
    }
  }
  function shareBody(input, id) {
    if (input.originType !== undefined && input.originType !== 'share') throw authorizationError('SHARE_ORIGIN_INVALID', 400)
    const known = ['document.read', 'document.write', 'comment.write', 'comment.resolve', 'version.read', 'version.create', 'version.restore', 'document.export', 'grant.manage']
    if (!Array.isArray(input.scopes) || input.scopes.length > known.length || input.scopes.some(scope => !known.includes(scope)) ||
      !decimal(input.expectedRevision) || !decimal(input.sourceRevision) ||
      (input.revoked !== undefined && typeof input.revoked !== 'boolean') || input.resync !== undefined) throw authorizationError('SHARE_INPUT_INVALID', 400)
    return { operationId: id, subject: required(input.subject, 'subject'), originType: 'share', sourceGrantKey: required(input.sourceGrantKey, 'sourceGrantKey'),
      scopes: [...new Set(input.scopes)].sort(), expectedRevision: input.expectedRevision, sourceRevision: input.sourceRevision,
      revoked: input.revoked === true }
  }
  function shareResult(record, raw) {
    if (!raw || raw.tenantId !== tenantId || raw.docId !== docId || raw.operationId !== record.operationId || raw.subject !== record.body.subject ||
      raw.originType !== 'share' || raw.sourceGrantKey !== record.body.sourceGrantKey || !digest(raw.requestHash) ||
      (record.requestHash && raw.requestHash !== record.requestHash) || raw.authzVersion !== nextRevision(record.body.expectedRevision) ||
      !decimal(raw.sourceRevision) || !decimal(raw.observedRevision) || typeof raw.replayed !== 'boolean' ||
      !((raw.status === 'committed' && raw.code === 'ok' && raw.sourceGap === false && raw.sourceRevision === record.body.sourceRevision && raw.observedRevision === record.body.sourceRevision) ||
        (raw.status === 'blocked' && raw.code === 'SOURCE_GAP' && raw.sourceGap === true && !atLeast(raw.sourceRevision, record.body.sourceRevision) && atLeast(raw.observedRevision, record.body.sourceRevision)))) throw authorizationError('SHARE_RESULT_UNKNOWN')
    return Object.fromEntries(['tenantId', 'docId', 'operationId', 'subject', 'originType', 'sourceGrantKey', 'status', 'code', 'requestHash',
      'authzVersion', 'sourceRevision', 'observedRevision', 'sourceGap', 'replayed'].map(key => [key, raw[key]]))
  }
  async function share(record, querying) {
    checkRecord(record, shares)
    requireCapability('canManagePermission')
    try {
      const path = `operations/${encodeURIComponent(record.operationId)}?${new URLSearchParams({ commandType: 'permission', ...(record.requestHash ? { requestHash: record.requestHash } : {}) })}`
      const { data, status } = querying ? await send(path, undefined, true, tenantUrl) : await send('share-operations', record.body, true)
      checkRecord(record, shares)
      if (!querying && status >= 400 && status < 500) throw authorizationError(data && typeof data.code === 'string' ? data.code : 'SHARE_REQUEST_REJECTED', status)
      if (querying && (!data || status !== 200 || data.status !== 'committed' || data.operationId !== record.operationId || !digest(data.requestHash) || data.requestHash !== data.result?.requestHash)) throw authorizationError('SHARE_RESULT_UNKNOWN', status)
      const result = shareResult(record, querying ? data.result : data)
      if ((!querying && status !== (result.status === 'committed' ? 200 : 503)) || (querying && data.requestHash !== result.requestHash)) throw authorizationError('SHARE_RESULT_UNKNOWN', status)
      record.status = result.status; record.requestHash = result.requestHash
      return result
    } catch (error) {
      if (shares.get(record.operationId) !== record && recoverableShares.has(record.operationId)) throw contextChanged(record.operationId)
      checkRecord(record, shares)
      if (!['committed', 'blocked'].includes(record.status)) record.status = !querying && error.status >= 400 && error.status < 500 ? 'rejected' : 'unknown'
      throw Object.assign(error, { operationId: record.operationId, httpStatus: error.status,
        status: ['committed', 'blocked'].includes(record.status) ? 'unavailable' : record.status })
    }
  }

  const provider = {
    isRemote: true,
    async listMembers() {
      requireCapability('canManagePermission')
      const data = await send('members')
      requireCapability('canManagePermission')
      const known = ['document.read', 'document.write', 'comment.write', 'comment.resolve', 'version.read', 'version.create', 'version.restore', 'document.export', 'grant.manage']
      const validScopes = value => Array.isArray(value) && value.length <= 9 && new Set(value).size === value.length && value.every(scope => known.includes(scope))
      const id = value => typeof value === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(value)
      if (!data || data.tenantId !== tenantId || data.docId !== docId || !decimal(data.authzVersion) || !Array.isArray(data.members) || data.members.length > 200) throw authorizationError('MEMBERS_RESULT_INVALID')
      const seen = new Set()
      const members = data.members.map(member => {
        if (!member || !id(member.principalId) || seen.has(member.principalId) || !validScopes(member.scopes) || !Array.isArray(member.sources)) throw authorizationError('MEMBERS_RESULT_INVALID')
        seen.add(member.principalId)
        const keys = new Set(), sources = member.sources.map(source => {
          if (!source) throw authorizationError('MEMBERS_RESULT_INVALID')
          const key = `${source.originType}:${source.sourceGrantKey}`
          if (!source || !['direct', 'share'].includes(source.originType) || !id(source.sourceGrantKey) || keys.has(key) || !decimal(source.sourceRevision) ||
            !validScopes(source.scopes) || typeof source.revoked !== 'boolean' || typeof source.sourceGap !== 'boolean') throw authorizationError('MEMBERS_RESULT_INVALID')
          keys.add(key)
          return { originType: source.originType, sourceGrantKey: source.sourceGrantKey, sourceRevision: source.sourceRevision, scopes: source.scopes.slice(), revoked: source.revoked, sourceGap: source.sourceGap }
        })
        return { principalId: member.principalId, scopes: member.scopes.slice(), sources }
      })
      return { tenantId, docId, authzVersion: data.authzVersion, members }
    },
    async getCapabilities() {
      const data = await send('capabilities')
      const scopes = capabilitiesFromScopes(data.scopes)
      const explicit = data.capabilities && typeof data.capabilities === 'object' ? data.capabilities : data
      const hasExplicit = data.capabilities !== undefined || Object.keys(DENIED_CAPABILITIES).some(key => Object.prototype.hasOwnProperty.call(data, key))
      if (!hasExplicit) return { ...scopes, canCopy: false }
      const actual = normalizeRemoteCapabilities(explicit)
      return Object.fromEntries(Object.keys(scopes).map(key => [key, scopes[key] && actual[key]]))
    },
    async issueCollaborationTicket(input = {}) {
      if (!Array.isArray(input.requestedScopes) || input.requestedScopes.some(scope => typeof scope !== 'string' || !scope)) throw new TypeError('authorization: requestedScopes 必须是字符串数组')
      if (input.protocolVersion !== undefined && input.protocolVersion !== 'editor-crdt-v1') throw new TypeError('authorization: protocolVersion 无效')
      const requestedScopes = input.requestedScopes.slice()
      const data = await send('collaboration-tickets', { requestedScopes, protocolVersion: 'editor-crdt-v1' })
      const knownScopes = ['document.read', 'document.write', 'comment.write', 'comment.resolve',
        'version.read', 'version.create', 'version.restore', 'document.export', 'grant.manage']
      if (typeof data.ticket !== 'string' || !data.ticket || data.tenantId !== tenantId || data.docId !== docId ||
        typeof data.principalId !== 'string' || !data.principalId || data.protocolVersion !== 'editor-crdt-v1' ||
        ![data.epoch, data.authzVersion].every(value => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) ||
        typeof data.expiresAt !== 'string' || !Number.isFinite(Date.parse(data.expiresAt)) ||
        !Array.isArray(data.scopes) || data.scopes.some(scope => !knownScopes.includes(scope) || !requestedScopes.includes(scope))) {
        throw authorizationError('AUTHORIZATION_INVALID_TICKET', null)
      }
      return data
    },
    async searchDocuments(input = {}) {
      const epoch = generation
      requireCapability('canView')
      if (typeof input.query !== 'string' || input.query.length > 128 || input.query.includes('\0')) throw authorizationError('DOCUMENT_SEARCH_QUERY_INVALID', 400)
      const data = await send(`document-search?query=${encodeURIComponent(input.query)}`)
      checkContext(epoch); requireCapability('canView')
      if (data.tenantId !== tenantId || data.docId !== docId || !Array.isArray(data.items) || data.items.length > 20) throw authorizationError('DOCUMENT_SEARCH_INVALID_RESPONSE')
      const seen = new Set(), items = data.items.map(item => {
        if (!item || item.kind !== 'page' || typeof item.docId !== 'string' || !/^[A-Za-z0-9._-]{1,128}(?![\s\S])/.test(item.docId) || seen.has(item.docId) ||
          typeof item.displayName !== 'string' || !item.displayName || item.displayName.length > 255 || item.displayName.includes('\0')) throw authorizationError('DOCUMENT_SEARCH_INVALID_RESPONSE')
        seen.add(item.docId)
        return { kind: 'page', docId: item.docId, displayName: item.displayName }
      })
      return { tenantId, docId, items }
    },
    resolveMentions(input = {}) {
      requireCapability('canView')
      const id = input.operationId === undefined ? operationId('mention') : required(input.operationId, 'operationId')
      if (retiredMentions.has(id)) throw contextChanged(id)
      const prior = mentions.get(id)
      if (prior) { mentionIntent(prior, input, true); return mention(prior, true) }
      if (typeof input.query !== 'string' || input.query.length > 128 || input.query.includes('\0')) throw authorizationError('MENTION_QUERY_INVALID', 400)
      const position = source(input), kinds = mentionKinds(input.kinds)
      const record = { operationId: id, body: Object.freeze({ operationId: id, sourceEpoch: position.sourceEpoch, sourceSeq: position.sourceSeq, query: input.query, ...(kinds === undefined ? {} : { kinds }) }), status: 'pending', requestHash: null }
      mentions.set(id, record)
      return mention(record, false)
    },
    queryMentionResolution(input) {
      const args = typeof input === 'string' ? { operationId: input } : input || {}
      const record = mentions.get(args.operationId)
      if (!record) { if (retiredMentions.has(args.operationId)) throw contextChanged(args.operationId); throw authorizationError('MENTION_OPERATION_NOT_FOUND') }
      mentionIntent(record, args)
      return mention(record, true)
    },
    getMentionOperation: id => mentions.has(id) ? copy(mentions.get(id)) : null,
    requestShare(input = {}) {
      requireCapability('canManagePermission')
      const id = input.operationId === undefined ? operationId('share') : required(input.operationId, 'operationId')
      if (retiredShares.has(id)) throw contextChanged(id)
      if (recoverableShares.has(id)) throw authorizationError('SHARE_QUERY_REQUIRED', 409)
      const body = shareBody(input, id), prior = shares.get(id)
      if (prior) {
        if (JSON.stringify(body) !== JSON.stringify(prior.body)) throw authorizationError('IDEMPOTENCY_MISMATCH', 409)
        return share(prior, true)
      }
      const record = { operationId: id, body: Object.freeze({ ...body, scopes: Object.freeze(body.scopes) }), status: 'pending', requestHash: null }
      shares.set(id, record)
      return share(record, false)
    },
    queryShareOperation(id) {
      let record = shares.get(id) || recoverableShares.get(id)
      if (!record) { if (retiredShares.has(id)) throw contextChanged(id); throw authorizationError('SHARE_OPERATION_NOT_FOUND') }
      requireCapability('canManagePermission')
      if (!shares.has(id) && recoverableShares.has(id)) { record = { ...record }; shares.set(id, record) }
      return share(record, true)
    },
    getShareOperation: id => shares.has(id) ? copy(shares.get(id)) : null,
    getSharingSettings: () => sharingSettings('get'),
    requestSharingSettings: input => sharingSettings('request', input),
    querySharingSettingsOperation: id => sharingSettings('query', id),
    getSharingSettingsOperation: id => sharingSettings('operation', id),
    documentInformation,
    documentAccess,
    shareLink,
    getScope: () => Object.freeze({ tenantId, docId }),
    getShareLinkAccessState() {
      try { const state = options.getState?.(); return Object.freeze({ known: Boolean(state && Array.isArray(state.pending)), pending: Array.isArray(state?.pending) ? state.pending.length : null }) } catch { return Object.freeze({ known: false, pending: null }) }
    },
    async createShareLinkAccess(beforeUnlock) {
      const epoch = generation, module = await import(/* webpackChunkName: "share-links" */ './share-link-access')
      checkContext(epoch)
      const port = module.createHttpShareLinkAccessProvider({ tenantId, docId, baseUrl, request, beforeUnlock })
      shareLinkAccessPorts.add(port); return port
    },
    async getShareLink() {
      const epoch = generation
      requireCapability('canView')
      if (!(await provider.getCapabilities()).canView) throw authorizationError('AUTHORIZATION_NOT_VISIBLE', 404)
      checkContext(epoch)
      const location = globalThis.location
      let url
      try { url = new URL(options.documentUrl === undefined ? location && location.href : options.documentUrl, location && location.href) } catch { throw authorizationError('SHARE_DOCUMENT_URL_REQUIRED') }
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search) throw authorizationError('SHARE_DOCUMENT_URL_REQUIRED')
      if (url.hash) {
        const params = new URLSearchParams(url.hash.slice(1)), keys = ['larkDocument', 'tenantId', 'docId']
        if (options.documentUrl !== undefined || Array.from(params.keys()).some(key => !keys.includes(key)) || keys.some(key => params.getAll(key).length !== 1) ||
          params.get('larkDocument') !== '1' || params.get('tenantId') !== tenantId || params.get('docId') !== docId) throw authorizationError('SHARE_DOCUMENT_URL_REQUIRED')
      }
      url.hash = new URLSearchParams({ larkDocument: '1', tenantId, docId }).toString()
      return url.href
    },
  }
  for (const [name, method] of Object.entries(provider)) {
    if (typeof method !== 'function' || ['getMentionOperation', 'getShareOperation'].includes(name)) continue
    provider[name] = function (...args) {
      const epoch = generation; checkContext(epoch)
      try {
        const value = method.apply(this, args)
        if (value && typeof value.then === 'function') return value.then(result => {
          if (epoch !== generation && canRecoverOperation(result?.operationId)) throw contextChanged(result.operationId)
          checkContext(epoch); return result
        }, error => {
          if (epoch !== generation && canRecoverOperation(error.operationId)) throw contextChanged(error.operationId)
          checkContext(epoch); throw error
        })
        checkContext(epoch); return value
      } catch (error) { checkContext(epoch); throw error }
    }
  }
  provider.reset = reset
  provider.dispose = () => { disposed = true; reset() }
  return provider
}

/** 校验宿主授权适配器，避免 Session 运行到保存动作才发现接口错误。 */
export function createAuthorizationProvider(provider) {
  if (provider == null) return null
  if (typeof provider.getCapabilities !== 'function') throw new Error('authorization Provider 必须实现 getCapabilities')
  return provider
}
