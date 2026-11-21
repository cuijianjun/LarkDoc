/* global globalThis */
import { isEmojiGlyph, normalizeEmojiGlyph } from '../core/emoji/identity'
import { normalizeCommentMetadata } from '../core/comments/mentions'
/**
 * 评论数据独立于正文保存。anchor 由 blockId 和 Provider 位置抽象组成，
 * 不把瞬时的 ProseMirror from/to 坐标作为长期评论身份。
 *
 * 必需方法：list、createThread、reply、resolve、reopen。
 * 宿主实现自定义 Provider 时把线程持久化映射到自己的存储；DocumentSession
 * /UI 层经这五个方法读写评论，缺失任何一个会在创建 Session 时立即报错。
 */
export const COMMENT_METHODS = ['list', 'createThread', 'reply', 'resolve', 'reopen']

/** 校验评论边界；线程与锚点的持久化由宿主服务负责。 */
export function createCommentsProvider(provider) {
  if (provider == null) return null
  const missing = COMMENT_METHODS.filter(method => typeof provider[method] !== 'function')
  if (missing.length) throw new Error(`comments Provider 缺少方法：${missing.join(', ')}`)
  return provider
}

const decimal = value => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)
const required = (value, name) => {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw new TypeError(`comments: ${name} 必须是非空字符串`)
  return value
}
const failure = (code, status, operationId) => Object.assign(new Error(code), { code, status, operationId })
const requestFailure = (error, fallback = 'COMMENT_REQUEST_FAILED') => Object.assign(new Error(error && error.message || fallback), error && typeof error === 'object' ? error : {})
const copy = value => JSON.parse(JSON.stringify(value))
const content = (value, assetIds, existingImage = false) => { if (value === '' && (existingImage || Array.isArray(assetIds) && assetIds.length)) return ''; required(value, 'content'); if (!value.trim()) throw failure('COMMENT_CONTENT_REQUIRED'); return value }
const hash = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value)
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
function increment(value) {
  const digits = value.split('')
  let carry = 1
  for (let i = digits.length - 1; i >= 0 && carry; i--) {
    const next = Number(digits[i]) + carry
    digits[i] = String(next % 10); carry = next > 9 ? 1 : 0
  }
  return `${carry ? '1' : ''}${digits.join('')}`
}
const atLeast = (value, minimum) => value.length > minimum.length || (value.length === minimum.length && value >= minimum)
function base64(value) {
  if (typeof value === 'string') {
    if (!value || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value) || globalThis.btoa(globalThis.atob(value)) !== value) throw failure('COMMENT_ANCHOR_REQUIRED')
    return value
  }
  if (!(value instanceof Uint8Array) || !value.length) throw failure('COMMENT_ANCHOR_REQUIRED')
  let binary = ''
  value.forEach(byte => { binary += String.fromCharCode(byte) })
  return globalThis.btoa(binary)
}
function wireAnchor(value) {
  if (!value || value.kind !== 'y' || typeof value.blockId !== 'string' || !value.blockId ||
    !Number.isSafeInteger(value.offset) || value.offset < 0 || !Number.isSafeInteger(value.length) || value.length < 1) throw failure('COMMENT_ANCHOR_REQUIRED')
  return { kind: 'y', blockId: value.blockId, offset: value.offset, length: value.length, from: base64(value.from), to: base64(value.to) }
}
function operationId() {
  if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== 'function') throw failure('COMMENT_RANDOM_UNAVAILABLE')
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  return `comment-${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`
}
export { operationId as createCommentOperationId }

const translationRecord = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key))
async function translationDigest(text) {
  if (!globalThis.crypto?.subtle || typeof globalThis.TextEncoder !== 'function') throw failure('TRANSLATION_SOURCE_HASH_UNAVAILABLE')
  const bytes = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new globalThis.TextEncoder().encode(text)))
  return 'sha256:' + Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Cookie/CSRF 评论端口。原请求一旦发出只允许原键查询，正文不携带评论数据。 */
export function createHttpCommentsProvider(options = {}) {
  const tenantId = required(options.tenantId, 'tenantId')
  const docId = required(options.docId, 'docId')
  const root = `${options.baseUrl == null ? '' : String(options.baseUrl).replace(/\/+$/, '')}/editor/v1/tenants/${encodeURIComponent(tenantId)}`
  const documentUrl = `${root}/documents/${encodeURIComponent(docId)}/comment-threads`
  const request = options.request || (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null)
  if (typeof request !== 'function') throw new TypeError('comments: 需要 fetch-compatible request')
  const threads = new Map()
  const operations = new Map()
  const followOperations = new Map()
  const translationOperations = new Map()
  const preparingComments = new Map()
  const preparingFollows = new Map()
  const preparingTranslations = new Map()
  const retiredComments = new Set(), retiredFollows = new Set(), retiredTranslations = new Set(), controllers = new Set()
  let generation = 0, disposed = false
  const contextChanged = id => failure('COMMENT_CONTEXT_CHANGED', 'unknown', id)
  function checkContext(epoch, id) { if (disposed || epoch !== generation) throw contextChanged(id) }
  function checkRecord(record, records) { if (disposed || records.get(record.operationId) !== record) throw contextChanged(record.operationId) }
  const recoverableComments = new Map(), recoverableFollows = new Map()
  function reset(reason, options) {
    generation++
    // 同一身份的授权刷新/端口替换只留原键和校验元数据，绝不保留正文或重发意图。
    if (['authorization-required', 'provider-replaced'].includes(reason)) {
      for (const [records, recovery] of [[operations, recoverableComments], [followOperations, recoverableFollows]]) {
        records.forEach(record => recovery.set(record.operationId, { operationId: record.operationId, threadId: record.threadId,
          principalId: record.principalId, requestHash: record.requestHash, status: 'unknown', body: { expectedRevision: record.body.expectedRevision } }))
      }
    } else { recoverableComments.clear(); recoverableFollows.clear() }
    for (const [records, preparing, retired] of [[operations, preparingComments, retiredComments], [followOperations, preparingFollows, retiredFollows], [translationOperations, preparingTranslations, retiredTranslations]]) {
      records.forEach((_, id) => retired.add(id)); preparing.forEach((_, id) => retired.add(id)); records.clear(); preparing.clear()
    }
    if (!options?.keepThreads) threads.clear()
    controllers.forEach(controller => controller.abort()); controllers.clear()
  }

  async function preparingResult(pending, intent, revisionKey, id) {
    const keys = new Set([...Object.keys(pending.intent), ...Object.keys(intent)])
    for (const key of keys) {
      if (key === revisionKey && (intent[key] === undefined || pending.intent[key] === undefined)) continue
      if (JSON.stringify(intent[key]) !== JSON.stringify(pending.intent[key])) throw failure('IDEMPOTENCY_MISMATCH', 409, id)
    }
    const record = await pending.ready
    if (record && intent[revisionKey] !== undefined && intent[revisionKey] !== record.body[revisionKey]) throw failure('IDEMPOTENCY_MISMATCH', 409, id)
    return pending.result
  }
  function startPreparation(preparing, id, intent, work) {
    let ready, resolveResult, rejectResult
    const pending = { intent, submitted: false, ready: new Promise(resolve => { ready = resolve }),
      result: new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject }) }
    preparing.set(id, pending)
    const finish = () => {
      // 读失败时也释放等待者；原错误仍由共享result原样传播。
      ready(null)
      if (preparing.get(id) === pending) preparing.delete(id)
    }
    work(record => { if (record) pending.submitted = true; ready(record) }).then(value => { finish(); resolveResult(value) }, error => {
      if (!pending.submitted) {
        error = Object.assign(requestFailure(error, 'COMMENT_PREPARATION_FAILED'), { submitted: false })
        if (error.status === 'unknown') error.status = 'rejected'
      }
      finish(); rejectResult(error)
    })
    return pending.result
  }

  async function send(url, body) {
    const epoch = generation; checkContext(epoch)
    const headers = { Accept: 'application/json' }
    if (body) {
      headers['Content-Type'] = 'application/json'
      headers['X-CSRF-Token'] = required(typeof options.csrfToken === 'function' ? options.csrfToken() : options.csrfToken, 'csrfToken')
      headers['Idempotency-Key'] = body.operationId
    }
    checkContext(epoch)
    const controller = new AbortController(); controllers.add(controller)
    let abortListener
    const cancelled = new Promise((_, reject) => { abortListener = () => reject(contextChanged()); controller.signal.addEventListener('abort', abortListener, { once: true }) })
    let timer
    const timeout = new Promise((resolve, reject) => {
      timer = setTimeout(() => { reject(failure('COMMENT_TIMEOUT')); controller.abort() }, 15000)
    })
    try {
      const result = await Promise.race([(async () => {
        const response = await request(url, { method: body ? 'POST' : 'GET', credentials: 'include', cache: 'no-store', redirect: 'error',
          headers, signal: controller.signal, ...(body ? { body: JSON.stringify(body) } : {}) })
        checkContext(epoch)
        if (!response || !Number.isInteger(response.status)) throw failure('COMMENT_INVALID_RESPONSE')
        let data
        try { data = await response.json(); checkContext(epoch) } catch { checkContext(epoch); throw failure('COMMENT_INVALID_RESPONSE', response.status) }
        return { status: response.status, data }
      })(), timeout, cancelled])
      checkContext(epoch); return result
    } catch (error) { checkContext(epoch); throw error }
    finally { clearTimeout(timer); controller.signal.removeEventListener('abort', abortListener); controllers.delete(controller) }
  }
  function decodeThread(raw) {
    const bad = () => { throw failure('COMMENT_INVALID_RESPONSE') }
    if (!raw || raw.tenantId !== tenantId || raw.docId !== docId || typeof raw.id !== 'string' || !raw.id ||
      !decimal(raw.threadRevision) || !['document', 'selection'].includes(raw.scope) || !['document', 'private'].includes(raw.visibility) ||
      typeof raw.creator !== 'string' || !raw.creator || !raw.author || raw.author.id !== raw.creator ||
      !Array.isArray(raw.participants) || raw.participants.some(id => typeof id !== 'string' || !id) ||
      typeof raw.resolved !== 'boolean' || typeof raw.tombstone !== 'boolean' || !iso(raw.createdAt) || !iso(raw.updatedAt) ||
      !raw.capabilities || !Array.isArray(raw.replies)) bad()
    let anchor = null
    if (raw.scope === 'document') {
      if (raw.anchor !== null || raw.rawAnchor !== null || raw.blockId != null || raw.anchorStatus !== 'document') bad()
    } else {
      anchor = wireAnchor(raw.rawAnchor)
      if (!raw.anchor || JSON.stringify(wireAnchor(raw.anchor)) !== JSON.stringify(anchor) || raw.blockId !== anchor.blockId ||
        !decimal(raw.sourceEpoch) || !decimal(raw.sourceSeq) || !['attached', 'orphaned'].includes(raw.anchorStatus)) bad()
    }
    const replies = raw.replies.map(reply => {
      if (!reply || typeof reply.id !== 'string' || !reply.id || !reply.author || typeof reply.author.id !== 'string' || !reply.author.id ||
        typeof reply.content !== 'string' || !decimal(reply.replyRevision) || !iso(reply.createdAt) ||
        !(reply.editedAt === null || iso(reply.editedAt)) || !(reply.deletedAt === null || iso(reply.deletedAt)) ||
        typeof reply.tombstone !== 'boolean' || !reply.capabilities || (reply.tombstone && reply.content !== '')) bad()
      if (reply.attachments !== undefined) {
        if (!Array.isArray(reply.attachments) || (reply.tombstone && reply.attachments.length)) bad()
        const seenAssets = new Set()
        reply.attachments.forEach(asset => {
          if (!asset || Object.keys(asset).length !== 5 || typeof asset.assetId !== 'string' || !/^asset-[A-Za-z0-9-]{1,128}$/.test(asset.assetId) || seenAssets.has(asset.assetId) ||
            typeof asset.fileName !== 'string' || !asset.fileName || asset.fileName.length > 255 || !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(asset.mimeType) ||
            !decimal(asset.sizeBytes) || asset.sizeBytes === '0' || !hash(asset.checksum)) bad()
          seenAssets.add(asset.assetId)
        })
      }
      let mentions, references
      try { ({ mentions, references } = normalizeCommentMetadata(reply.content, reply.mentions === undefined ? [] : reply.mentions, reply.references === undefined ? [] : reply.references, true)) } catch { bad() }
      if (reply.tombstone && (mentions.length || references.length)) bad()
      const hasReactions = reply.reactions !== undefined
      if (hasReactions !== (reply.capabilities.canReact !== undefined)) bad()
      if (hasReactions) {
        if (typeof reply.capabilities.canReact !== 'boolean' || !Array.isArray(reply.reactions) || reply.reactions.length > 64 ||
          (reply.tombstone && (reply.reactions.length || reply.capabilities.canReact))) bad()
        const seen = new Set()
        reply.reactions.forEach(reaction => {
          if (!reaction || Object.keys(reaction).length !== 3 || !isEmojiGlyph(reaction.emoji) || reaction.emoji !== normalizeEmojiGlyph(reaction.emoji) ||
            !decimal(reaction.count) || reaction.count === '0' || typeof reaction.reactedByMe !== 'boolean' || seen.has(reaction.emoji)) bad()
          seen.add(reaction.emoji)
        })
      }
      return { ...copy(reply), mentions, references, createdAt: Date.parse(reply.createdAt), editedAt: reply.editedAt === null ? null : Date.parse(reply.editedAt),
        deletedAt: reply.deletedAt === null ? null : Date.parse(reply.deletedAt),
        capabilities: { canEdit: reply.capabilities.canEdit === true, canDelete: reply.capabilities.canDelete === true, ...(hasReactions ? { canReact: reply.capabilities.canReact } : {}) } }
    })
    const value = { ...copy(raw), anchor: anchor && { ...anchor, from: Uint8Array.from(globalThis.atob(anchor.from), c => c.charCodeAt(0)),
      to: Uint8Array.from(globalThis.atob(anchor.to), c => c.charCodeAt(0)) }, rawAnchor: anchor, replies,
    createdAt: Date.parse(raw.createdAt), updatedAt: Date.parse(raw.updatedAt),
    capabilities: Object.fromEntries(['canReply', 'canResolve', 'canReopen', 'canManageParticipants', 'canChangeVisibility'].map(key => [key, raw.capabilities[key] === true])) }
    return value
  }
  function cacheThread(thread) {
    // 调用方可编辑自己的视图副本，不能改写下次动作的服务端能力上限。
    threads.set(thread.id, { ...thread, capabilities: { ...thread.capabilities }, replies: thread.replies.map(reply => ({ ...reply, capabilities: { ...reply.capabilities } })) })
  }
  function allowed(kind, thread, replyId) {
    const flags = typeof options.getCapabilities === 'function' ? options.getCapabilities() : null
    const gate = kind === 'resolve' || kind === 'reopen' ? 'canResolveComment' : 'canComment'
    if (!flags || flags[gate] !== true) throw failure('COMMENT_FORBIDDEN', 403)
    if (!thread) return
    const action = { reply: 'canReply', resolve: 'canResolve', reopen: 'canReopen', participants: 'canManageParticipants', visibility: 'canChangeVisibility' }[kind]
    if (action && thread.capabilities[action] !== true) throw failure('COMMENT_FORBIDDEN', 403)
    if (['edit', 'delete', 'reaction'].includes(kind)) {
      const reply = thread.replies.find(item => item.id === replyId)
      if (!reply || reply.capabilities[{ edit: 'canEdit', delete: 'canDelete', reaction: 'canReact' }[kind]] !== true) throw failure('COMMENT_FORBIDDEN', 403)
    }
  }
  function confirm(record, response) {
    checkRecord(record, operations)
    const { data, status } = response
    if ((status !== 200 && status !== 201) || !data || data.status !== 'committed' || data.operationId !== record.operationId ||
      !hash(data.requestHash) || (record.requestHash && record.requestHash !== data.requestHash) ||
      !decimal(data.committedRevision) || data.committedRevision !== increment(record.body.expectedRevision)) throw failure('COMMENT_RESULT_UNKNOWN', 'unknown', record.operationId)
    const thread = decodeThread(data.thread)
    if ((record.threadId && thread.id !== record.threadId) || !atLeast(thread.threadRevision, data.committedRevision)) throw failure('COMMENT_RESULT_UNKNOWN', 'unknown', record.operationId)
    record.requestHash = data.requestHash; record.status = 'committed'; record.committedRevision = data.committedRevision
    cacheThread(thread)
    return thread
  }
  async function execute(record, querying = false) {
    checkRecord(record, operations)
    try {
      const response = await send(querying ? `${root}/operations/${encodeURIComponent(record.operationId)}?commandType=comment` : record.url, querying ? undefined : record.body)
      checkRecord(record, operations)
      if (querying) requireView()
      if (querying && [401, 403, 404].includes(response.status)) throw failure('COMMENT_NOT_VISIBLE', response.status, record.operationId)
      if (response.status >= 400 && response.status < 500 && !querying) {
        record.status = 'rejected'
        throw failure(response.data && response.data.code || 'COMMENT_REQUEST_REJECTED', response.status, record.operationId)
      }
      return confirm(record, response)
    } catch (error) {
      checkRecord(record, operations)
      if (record.status !== 'rejected') record.status = 'unknown'
      throw Object.assign(requestFailure(error), { operationId: record.operationId, submitted: true, httpStatus: error && typeof error.status === 'number' ? error.status : null, status: record.status })
    }
  }
  async function write(kind, input = {}) {
    const epoch = generation; checkContext(epoch)
    input = { ...input, ...(Array.isArray(input.assetIds) ? { assetIds: input.assetIds.slice() } : {}), ...(Array.isArray(input.participants) ? { participants: input.participants.slice() } : {}) }
    if (input.mentions !== undefined || input.references !== undefined) {
      if (!['create', 'reply', 'edit'].includes(kind)) throw failure('COMMENT_MENTIONS_INVALID')
      const metadata = normalizeCommentMetadata(input.content, input.mentions === undefined ? [] : input.mentions, input.references === undefined ? [] : input.references)
      if (input.mentions !== undefined) input.mentions = metadata.mentions
      if (input.references !== undefined) input.references = metadata.references
    }
    if (input.assetIds !== undefined && (!['create', 'reply', 'edit'].includes(kind) || !Array.isArray(input.assetIds) || input.assetIds.length > 9 || new Set(input.assetIds).size !== input.assetIds.length || input.assetIds.some(id => typeof id !== 'string' || !/^asset-[A-Za-z0-9-]{1,128}$/.test(id)))) throw failure('COMMENT_INVALID_ATTACHMENTS')
    if (kind === 'reaction') {
      if (!isEmojiGlyph(input.emoji) || typeof input.active !== 'boolean') throw failure('COMMENT_INVALID_REACTION')
      input.emoji = normalizeEmojiGlyph(input.emoji)
    }
    const id = input.operationId === undefined ? operationId() : required(input.operationId, 'operationId')
    if (retiredComments.has(id)) throw contextChanged(id)
    const pending = preparingComments.get(id)
    if (operations.has(id)) {
      const prior = operations.get(id)
      const candidate = copy(prior.body)
      const mismatch = () => { throw failure('IDEMPOTENCY_MISMATCH', 409, id) }
      if (kind !== prior.kind || (kind !== 'create' && input.threadId !== prior.threadId)) mismatch()
      if (input.expectedRevision !== undefined) candidate.expectedRevision = input.expectedRevision
      if (kind === 'create') {
        candidate.scope = input.scope || 'selection'; candidate.visibility = input.visibility || 'document'
        candidate.content = content(input.content, input.assetIds)
        if (candidate.scope === 'selection') {
          candidate.anchor = wireAnchor(input.anchor); candidate.blockId = candidate.anchor.blockId
          if (input.sourceEpoch !== undefined) candidate.sourceEpoch = input.sourceEpoch
          if (input.sourceSeq !== undefined) candidate.sourceSeq = input.sourceSeq
        } else { candidate.anchor = null; candidate.blockId = null; candidate.sourceEpoch = null; candidate.sourceSeq = null }
      }
      if (['reply', 'edit'].includes(kind)) candidate.content = content(input.content, input.assetIds, kind === 'edit' && prior.body.content === '')
      if (['edit', 'delete', 'reaction'].includes(kind)) candidate.replyId = input.replyId || input.commentId
      if (kind === 'participants' || kind === 'create') {
        if (input.participants === undefined) delete candidate.participants
        else candidate.participants = input.participants
      }
      if (['create', 'reply', 'edit'].includes(kind)) { if (input.assetIds === undefined) delete candidate.assetIds; else candidate.assetIds = input.assetIds }
      if (['create', 'reply', 'edit'].includes(kind)) {
        if (input.mentions === undefined) delete candidate.mentions
        else candidate.mentions = input.mentions
        if (input.references === undefined) delete candidate.references
        else candidate.references = input.references
      }
      if (kind === 'reaction') { candidate.emoji = input.emoji; candidate.active = input.active }
      if (kind === 'visibility') candidate.visibility = input.visibility
      const keys = new Set([...Object.keys(candidate), ...Object.keys(prior.body)])
      if (Array.from(keys).some(key => JSON.stringify(candidate[key]) !== JSON.stringify(prior.body[key]))) mismatch()
      return pending ? pending.result : execute(prior, true)
    }
    const intent = { kind, threadId: input.threadId, expectedRevision: input.expectedRevision, ...(input.assetIds === undefined ? {} : { assetIds: input.assetIds }) }
    if (['reply', 'edit'].includes(kind)) intent.content = input.content
    if (['create', 'reply', 'edit'].includes(kind) && input.mentions !== undefined) intent.mentions = input.mentions
    if (['create', 'reply', 'edit'].includes(kind) && input.references !== undefined) intent.references = input.references
    if (['edit', 'delete', 'reaction'].includes(kind)) intent.replyId = input.replyId || input.commentId
    if (kind === 'reaction') { intent.emoji = input.emoji; intent.active = input.active }
    if (kind === 'participants') intent.participants = input.participants
    if (kind === 'visibility') intent.visibility = input.visibility
    if (pending) return preparingResult(pending, intent, 'expectedRevision', id)
    return startPreparation(preparingComments, id, intent, async ready => {
      let thread = null
      if (kind !== 'create') thread = threads.get(input.threadId) || await provider.getThread(input.threadId)
      checkContext(epoch, id)
      allowed(kind, thread, input.replyId || input.commentId)
      const expectedRevision = input.expectedRevision === undefined ? (kind === 'create' ? '0' : thread.threadRevision) : input.expectedRevision
      if (!decimal(expectedRevision)) throw failure('COMMENT_REVISION_REQUIRED')
      if (kind === 'create' && expectedRevision !== '0') throw failure('COMMENT_REVISION_REQUIRED')
      const body = { operationId: id, expectedRevision, ...(input.assetIds === undefined ? {} : { assetIds: input.assetIds }) }
      if (kind === 'create') {
        const scope = input.scope || 'selection'
        if (!['document', 'selection'].includes(scope) || !['document', 'private'].includes(input.visibility || 'document')) throw failure('COMMENT_INVALID_INPUT')
        Object.assign(body, { scope, visibility: input.visibility || 'document', content: content(input.content, input.assetIds), blockId: null, anchor: null, sourceEpoch: null, sourceSeq: null })
        if (scope === 'selection') {
          const state = typeof options.getState === 'function' ? options.getState() : null
          if (!state || state.status !== 'ready' || !Array.isArray(state.pending) || state.pending.length || !decimal(state.epoch) || !decimal(state.lastSeq)) throw failure('COMMENT_SOURCE_NOT_DURABLE')
          body.anchor = wireAnchor(input.anchor); body.blockId = body.anchor.blockId
          body.sourceEpoch = state.epoch; body.sourceSeq = state.lastSeq
          if ((input.sourceEpoch !== undefined && input.sourceEpoch !== body.sourceEpoch) || (input.sourceSeq !== undefined && input.sourceSeq !== body.sourceSeq)) throw failure('COMMENT_SOURCE_NOT_DURABLE')
        }
      } else {
        body.kind = kind
        if (kind === 'reaction') { body.emoji = input.emoji; body.active = input.active }
        if (['reply', 'edit'].includes(kind)) body.content = content(input.content, input.assetIds, kind === 'edit' && input.assetIds === undefined && thread.replies.find(reply => reply.id === (input.replyId || input.commentId))?.attachments?.length > 0)
        if (['edit', 'delete', 'reaction'].includes(kind)) body.replyId = required(input.replyId || input.commentId, 'replyId')
      }
      if (input.mentions !== undefined) body.mentions = input.mentions
      if (input.references !== undefined) body.references = input.references
      if (kind === 'participants' || (kind === 'create' && input.participants !== undefined)) {
        if (!Array.isArray(input.participants) || input.participants.some(id => typeof id !== 'string' || !id)) throw failure('COMMENT_INVALID_PARTICIPANTS')
        body.participants = input.participants.slice()
      }
      if (kind === 'visibility') {
        if (!['document', 'private'].includes(input.visibility)) throw failure('COMMENT_INVALID_VISIBILITY')
        body.visibility = input.visibility
      }
      const record = { operationId: id, kind, body: Object.freeze(copy(body)), threadId: thread && thread.id,
        url: thread ? `${documentUrl}/${encodeURIComponent(thread.id)}/operations` : documentUrl, status: 'pending', requestHash: null }
      checkContext(epoch, id); operations.set(id, record)
      ready(record)
      return execute(record)
    })
  }
  function requireView() {
    const flags = typeof options.getCapabilities === 'function' ? options.getCapabilities() : null
    if (!flags || flags.canView !== true) throw failure('COMMENT_NOT_VISIBLE', 404)
  }
  function readPreference(raw, threadId) {
    if (!raw || raw.tenantId !== tenantId || raw.docId !== docId || raw.threadId !== threadId ||
      typeof raw.principalId !== 'string' || !raw.principalId || typeof raw.following !== 'boolean' || typeof raw.muted !== 'boolean' ||
      !decimal(raw.preferenceRevision)) throw failure('FOLLOW_INVALID_RESPONSE')
    return copy(raw)
  }
  async function followExecute(record, querying = false) {
    checkRecord(record, followOperations)
    requireView()
    try {
      const { data, status } = await send(querying ? `${root}/operations/${encodeURIComponent(record.operationId)}?commandType=follow`
        : `${documentUrl}/${encodeURIComponent(record.threadId)}/follow-preference`, querying ? undefined : record.body)
      checkRecord(record, followOperations)
      requireView()
      if (querying && [401, 403, 404].includes(status)) throw failure('COMMENT_NOT_VISIBLE', status, record.operationId)
      if (status >= 400 && status < 500 && !querying) {
        record.status = 'rejected'
        throw failure(status === 403 || status === 404 ? 'COMMENT_NOT_VISIBLE' : data && data.code || 'FOLLOW_REQUEST_REJECTED', status, record.operationId)
      }
      if (![200, 201].includes(status) || !data || data.status !== 'committed' || data.operationId !== record.operationId ||
        !hash(data.requestHash) || (record.requestHash && record.requestHash !== data.requestHash) || data.committedRevision !== increment(record.body.expectedRevision)) throw failure('FOLLOW_RESULT_UNKNOWN')
      const preference = readPreference(data.preference, record.threadId)
      if (preference.principalId !== record.principalId || !atLeast(preference.preferenceRevision, data.committedRevision)) throw failure('FOLLOW_RESULT_UNKNOWN')
      record.requestHash = data.requestHash; record.committedRevision = data.committedRevision; record.status = 'committed'
      return preference
    } catch (error) {
      checkRecord(record, followOperations)
      if (record.status !== 'rejected') record.status = 'unknown'
      throw Object.assign(requestFailure(error), { operationId: record.operationId, submitted: true, httpStatus: error && typeof error.status === 'number' ? error.status : null, status: record.status })
    }
  }
  async function followWrite(kind, value, input) {
    const epoch = generation; checkContext(epoch)
    requireView()
    const threadId = required(input.threadId, 'threadId')
    if (typeof value !== 'boolean') throw failure('FOLLOW_INVALID_VALUE')
    const id = input.operationId === undefined ? operationId() : required(input.operationId, 'operationId')
    if (retiredFollows.has(id)) throw contextChanged(id)
    const expected = input.expectedRevision
    const pending = preparingFollows.get(id)
    const prior = followOperations.get(id)
    if (prior) {
      if (prior.threadId !== threadId || prior.body.kind !== kind || prior.body.value !== value ||
        (input.expectedRevision !== undefined && input.expectedRevision !== prior.body.expectedRevision)) throw failure('IDEMPOTENCY_MISMATCH', 409, id)
      return pending ? pending.result : followExecute(prior, true)
    }
    const intent = { threadId, kind, value, expectedRevision: expected }
    if (pending) return preparingResult(pending, intent, 'expectedRevision', id)
    return startPreparation(preparingFollows, id, intent, async ready => {
      // 不沿用上一个Cookie主体的偏好缓存；读到当前主体后才捕获CAS基线。
      const preference = await provider.getFollowPreference(threadId)
      checkContext(epoch, id)
      const expectedRevision = expected === undefined ? preference.preferenceRevision : expected
      if (!decimal(expectedRevision)) throw failure('FOLLOW_REVISION_REQUIRED')
      const record = { operationId: id, threadId, principalId: preference.principalId,
        body: Object.freeze({ operationId: id, expectedRevision, kind, value }), requestHash: null, status: 'pending' }
      checkContext(epoch, id); followOperations.set(id, record)
      ready(record)
      return followExecute(record)
    })
  }
  function linkBase() {
    const location = globalThis.location
    const raw = options.documentUrl === undefined ? location && location.href : options.documentUrl
    let url
    try { url = new URL(required(raw, 'documentUrl'), location && location.href) } catch { throw failure('COMMENT_DOCUMENT_URL_REQUIRED') }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search ||
      (url.hash && (options.documentUrl !== undefined || !url.hash.startsWith('#larkComment=')))) throw failure('COMMENT_DOCUMENT_URL_REQUIRED')
    url.hash = ''
    return url
  }
  function parseLink(value) {
    let url
    try { url = new URL(value, linkBase()) } catch { throw failure('COMMENT_LINK_INVALID') }
    const base = linkBase()
    if (url.origin !== base.origin || url.pathname !== base.pathname || url.search || url.username || url.password) throw failure('COMMENT_LINK_SCOPE_MISMATCH')
    const params = new URLSearchParams(url.hash.slice(1))
    const names = ['larkComment', 'tenantId', 'docId', 'threadId']
    if (Array.from(params.keys()).some(key => !names.includes(key)) || names.some(key => params.getAll(key).length !== 1) ||
      params.get('larkComment') !== '1' || params.get('tenantId') !== tenantId || params.get('docId') !== docId || !params.get('threadId')) throw failure('COMMENT_LINK_SCOPE_MISMATCH')
    return params.get('threadId')
  }
  function translationIntent(record, input) {
    for (const key of ['threadId', 'replyId', 'sourceRevision', 'targetLanguage']) {
      const original = key === 'threadId' || key === 'replyId' ? record[key] : record.body[key]
      if (input[key] !== undefined && input[key] !== original) throw failure('IDEMPOTENCY_MISMATCH', 409, record.operationId)
    }
  }
  async function translationSource(record, source) {
    requireView()
    const thread = source || await provider.getThread(record.threadId)
    const reply = thread.replies.find(item => item.id === record.replyId && !item.tombstone)
    if (!reply || thread.tombstone) throw failure('COMMENT_NOT_VISIBLE', 404)
    if (reply.replyRevision !== record.body.sourceRevision) throw failure('TRANSLATION_SOURCE_STALE', 409)
    return reply
  }
  function translationResult(record, data, status) {
    const original = { ...record.body, threadId: record.threadId, replyId: record.replyId }
    if (!data || Object.keys(original).some(key => data[key] !== original[key])) throw failure('TRANSLATION_RESULT_UNKNOWN')
    const base = [...Object.keys(original), 'status', 'code', 'taskId', 'persisted', 'batchBlocked']
    if (data.status === 'blocked') {
      if (status !== 503 || !translationRecord(data, [...base, 'dependency']) || data.code !== 'DEPENDENCY_BLOCKED' || data.dependency !== 'internal-translation' ||
        data.batchBlocked !== true || data.persisted !== false || data.taskId !== null) throw failure('TRANSLATION_RESULT_UNKNOWN')
      return { status: 'blocked', code: 'DEPENDENCY_BLOCKED', dependency: 'internal-translation', batchBlocked: true,
        ...original, persisted: false, taskId: null }
    }
    const uncertain = data.status === 'unknown' && [false, null].includes(data.persisted)
    let keys = [...base, 'translatedText', 'tenantId', 'docId', 'requestHash', 'sourceHash']
    if (uncertain) {
      keys = [...base, 'translatedText']
      if ('requestHash' in data || 'sourceHash' in data) keys.push('requestHash', 'sourceHash')
      if ('tenantId' in data || 'docId' in data) keys.push('tenantId', 'docId')
    }
    if (!translationRecord(data, keys) || !['unknown', 'pending', 'ready', 'failed'].includes(data.status) || data.batchBlocked !== false ||
      status !== (data.status === 'pending' ? 202 : data.status === 'unknown' ? 503 : 200) ||
      (keys.includes('tenantId') && (data.tenantId !== tenantId || data.docId !== docId)) ||
      (keys.includes('requestHash') && (!hash(data.requestHash) || !hash(data.sourceHash)))) throw failure('TRANSLATION_RESULT_UNKNOWN')
    if (uncertain) {
      if (data.taskId !== null || data.translatedText !== null || data.code !== (data.persisted === null ? 'COMMIT_UNKNOWN' : 'OPERATION_UNKNOWN') ||
        (data.persisted === false && !hash(data.requestHash))) throw failure('TRANSLATION_RESULT_UNKNOWN')
    } else {
      if (data.persisted !== true || !hash(data.requestHash) || !hash(data.sourceHash) || data.tenantId !== tenantId || data.docId !== docId ||
        typeof data.taskId !== 'string' || !/^translation-[A-Za-z0-9-]{1,64}(?![\s\S])/.test(data.taskId) ||
        data.code !== (data.status === 'unknown' ? 'OPERATION_UNKNOWN' : data.status === 'failed' ? 'TRANSLATION_FAILED' : null)) throw failure('TRANSLATION_RESULT_UNKNOWN')
      if (data.status === 'ready') {
        if (typeof data.translatedText !== 'string' || !data.translatedText.trim() || data.translatedText.includes('\0') ||
          new globalThis.TextEncoder().encode(data.translatedText).byteLength > 1048576) throw failure('TRANSLATION_RESULT_UNKNOWN')
      } else if (data.translatedText !== null) throw failure('TRANSLATION_RESULT_UNKNOWN')
    }
    return Object.freeze({ ...data })
  }
  async function translationExecute(record, querying = false, source) {
    checkRecord(record, translationOperations)
    try {
      await translationSource(record, source); checkRecord(record, translationOperations); requireView()
      const path = `${documentUrl}/${encodeURIComponent(record.threadId)}/replies/${encodeURIComponent(record.replyId)}/translations`
      const { status, data } = await send(querying ? `${path}?${new URLSearchParams(record.body)}` : path, querying ? undefined : record.body)
      checkRecord(record, translationOperations); requireView()
      if (status >= 400 && status < 500) throw failure(status === 403 || status === 404 ? 'COMMENT_NOT_VISIBLE' : status === 409 ? 'TRANSLATION_SOURCE_STALE' : data && data.code || 'TRANSLATION_REQUEST_REJECTED', status)
      const result = translationResult(record, data, status)
      if (result.sourceHash) {
        const reply = await translationSource(record), text = reply.content, actualHash = await translationDigest(text)
        checkRecord(record, translationOperations); requireView()
        const current = threads.get(record.threadId), latest = current && current.replies.find(item => item.id === record.replyId && !item.tombstone)
        if (!current || current.tombstone || !latest) throw failure('COMMENT_NOT_VISIBLE', 404)
        if (latest.replyRevision !== record.body.sourceRevision || latest.content !== text) throw failure('TRANSLATION_SOURCE_STALE', 409)
        if (actualHash !== result.sourceHash) throw failure('TRANSLATION_RESULT_UNKNOWN')
      }
      if ((record.requestHash && result.requestHash && record.requestHash !== result.requestHash) ||
        (record.sourceHash && result.sourceHash && record.sourceHash !== result.sourceHash) ||
        (record.taskId && result.taskId && record.taskId !== result.taskId)) throw failure('TRANSLATION_RESULT_UNKNOWN')
      if (result.requestHash) record.requestHash = result.requestHash
      if (result.sourceHash) record.sourceHash = result.sourceHash
      if (result.taskId) record.taskId = result.taskId
      record.status = result.status
      // Operation bookkeeping retains only metadata; private translatedText is returned to the current caller, never cached here.
      return result
    } catch (error) {
      checkRecord(record, translationOperations)
      const rejected = [400, 401, 403, 404, 409, 422].includes(error && error.status)
      record.status = rejected ? 'rejected' : 'unknown'
      throw Object.assign(requestFailure(error), { operationId: record.operationId, submitted: true, httpStatus: error && typeof error.status === 'number' ? error.status : null, status: record.status })
    }
  }
  const provider = {
    isRemote: true, requiresDurableConfirmation: true,
    getAnchorCodec: editor => typeof options.getAnchorCodec === 'function' ? options.getAnchorCodec(editor) : null,
    getOperation: id => operations.has(id) ? copy(operations.get(id)) : null,
    async list() {
      const epoch = generation
      const { data, status } = await send(documentUrl)
      checkContext(epoch)
      if (status !== 200 || !Array.isArray(data)) throw failure(data && data.code || 'COMMENT_INVALID_RESPONSE', status)
      threads.clear()
      const result = data.map(decodeThread)
      result.forEach(cacheThread)
      return result
    },
    async getThread(id) {
      const epoch = generation
      const { data, status } = await send(`${documentUrl}/${encodeURIComponent(required(id, 'threadId'))}`)
      checkContext(epoch)
      if (status !== 200) throw failure(status === 403 || status === 404 ? 'COMMENT_NOT_VISIBLE' : data && data.code || 'COMMENT_REQUEST_FAILED', status)
      const thread = decodeThread(data)
      if (thread.id !== id) throw failure('COMMENT_INVALID_RESPONSE')
      cacheThread(thread)
      return thread
    },
    createThread: input => write('create', input),
    reply: input => write('reply', input),
    resolve: (threadId, args = {}) => write('resolve', { ...args, threadId }),
    reopen: (threadId, args = {}) => write('reopen', { ...args, threadId }),
    editReply: input => write('edit', input),
    deleteReply: input => write('delete', input),
    react: input => write('reaction', input),
    setParticipants: input => write('participants', input),
    setVisibility: input => write('visibility', input),
    queryOperation(id) {
      requireView()
      required(id, 'operationId')
      if (!operations.has(id) && recoverableComments.has(id)) operations.set(id, recoverableComments.get(id))
      const record = operations.get(id)
      if (!record) { if (retiredComments.has(id)) throw contextChanged(id); throw failure('COMMENT_OPERATION_NOT_FOUND') }
      return execute(record, true)
    },
    async getFollowPreference(id) {
      requireView()
      const threadId = required(id, 'threadId')
      const { status, data } = await send(`${documentUrl}/${encodeURIComponent(threadId)}/follow-preference`)
      if (status !== 200) throw failure(status === 403 || status === 404 ? 'COMMENT_NOT_VISIBLE' : data && data.code || 'FOLLOW_REQUEST_FAILED', status)
      return readPreference(data, threadId)
    },
    follow: (input, args = {}) => followWrite('follow', true, typeof input === 'string' ? { ...args, threadId: input } : input),
    unfollow: (input, args = {}) => followWrite('follow', false, typeof input === 'string' ? { ...args, threadId: input } : input),
    setMuted: (input, value, args = {}) => followWrite('mute', typeof input === 'string' ? value : input.value,
      typeof input === 'string' ? { ...args, threadId: input } : input),
    getFollowOperation: id => followOperations.has(id) ? copy(followOperations.get(id)) : null,
    queryFollowOperation(id) {
      requireView()
      required(id, 'operationId')
      if (!followOperations.has(id) && recoverableFollows.has(id)) followOperations.set(id, recoverableFollows.get(id))
      const record = followOperations.get(id)
      if (!record) { if (retiredFollows.has(id)) throw contextChanged(id); throw failure('FOLLOW_OPERATION_NOT_FOUND') }
      return followExecute(record, true)
    },
    async getLinkTarget(id) {
      requireView()
      const threadId = required(id, 'threadId')
      const { data, status } = await send(`${documentUrl}/${encodeURIComponent(threadId)}/link-target`)
      if (status !== 200) throw failure(status === 403 || status === 404 ? 'COMMENT_NOT_VISIBLE' : data && data.code || 'COMMENT_LINK_FAILED', status)
      if (!data || data.tenantId !== tenantId || data.docId !== docId || data.threadId !== threadId || !['document', 'selection'].includes(data.scope)) throw failure('COMMENT_LINK_INVALID')
      if (data.scope === 'document') {
        if (data.blockId !== null || data.anchor !== null || data.anchorStatus !== 'document') throw failure('COMMENT_LINK_INVALID')
      } else if (!['attached', 'orphaned'].includes(data.anchorStatus) || data.blockId !== wireAnchor(data.anchor).blockId) throw failure('COMMENT_LINK_INVALID')
      return copy(data)
    },
    async getLink(threadId) {
      const epoch = generation
      const base = linkBase()
      const target = await provider.getLinkTarget(threadId)
      checkContext(epoch)
      base.hash = new URLSearchParams({ larkComment: '1', tenantId, docId, threadId: target.threadId }).toString()
      return base.href
    },
    async openLink(value) {
      const epoch = generation
      requireView()
      const threadId = parseLink(value)
      const thread = await provider.getThread(threadId)
      checkContext(epoch)
      const target = await provider.getLinkTarget(threadId)
      checkContext(epoch)
      return { thread, target }
    },
    async requestTranslation(input = {}) {
      const epoch = generation
      requireView()
      input = { ...input }
      const id = input.operationId === undefined ? operationId() : required(input.operationId, 'operationId')
      if (retiredTranslations.has(id)) throw contextChanged(id)
      const pending = preparingTranslations.get(id)
      const prior = translationOperations.get(id)
      if (prior) { translationIntent(prior, input); return pending ? pending.result : translationExecute(prior, true) }
      const threadId = required(input.threadId, 'threadId')
      const replyId = required(input.replyId, 'replyId')
      const targetLanguage = required(input.targetLanguage, 'targetLanguage')
      if (targetLanguage.length > 63 || !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*(?![\s\S])/.test(targetLanguage)) throw failure('TRANSLATION_LANGUAGE_INVALID')
      const intent = { threadId, replyId, targetLanguage, sourceRevision: input.sourceRevision }
      if (pending) return preparingResult(pending, intent, 'sourceRevision', id)
      return startPreparation(preparingTranslations, id, intent, async ready => {
        const thread = await provider.getThread(threadId)
        checkContext(epoch, id)
        const reply = thread.replies.find(item => item.id === replyId && !item.tombstone)
        if (!reply || thread.tombstone) throw failure('COMMENT_NOT_VISIBLE', 404)
        const sourceRevision = input.sourceRevision === undefined ? reply.replyRevision : input.sourceRevision
        if (!decimal(sourceRevision)) throw failure('TRANSLATION_SOURCE_INVALID')
        const record = { operationId: id, threadId, replyId,
          body: Object.freeze({ operationId: id, sourceRevision, targetLanguage }), status: 'pending' }
        checkContext(epoch, id); translationOperations.set(id, record)
        ready(record)
        return translationExecute(record, false, thread)
      })
    },
    queryTranslation(input) {
      const args = typeof input === 'string' ? { operationId: input } : input || {}
      const record = translationOperations.get(required(args.operationId, 'operationId'))
      if (!record) { if (retiredTranslations.has(args.operationId)) throw contextChanged(args.operationId); throw failure('TRANSLATION_OPERATION_NOT_FOUND') }
      translationIntent(record, args)
      return translationExecute(record, true)
    },
    getTranslationOperation: id => translationOperations.has(id) ? copy(translationOperations.get(id)) : null,
  }
  // Keep synchronous entry errors synchronous; all async outcomes remain tied to their starting identity.
  const rejectOutcome = (epoch, error) => {
    try { checkContext(epoch) } catch (changed) {
      if (error && typeof error.operationId === 'string') changed.operationId = error.operationId
      if (error && error.submitted === false) { changed.submitted = false; changed.status = 'rejected' }
      throw changed
    }
    throw error
  }
  for (const [name, method] of Object.entries(provider)) {
    if (typeof method !== 'function' || ['getAnchorCodec', 'getOperation', 'getFollowOperation', 'getTranslationOperation'].includes(name)) continue
    provider[name] = function (...args) {
      const epoch = generation; checkContext(epoch)
      try {
        const value = method.apply(this, args)
        if (value && typeof value.then === 'function') return value.then(result => { checkContext(epoch); return result }, error => rejectOutcome(epoch, error))
        checkContext(epoch); return value
      } catch (error) { rejectOutcome(epoch, error) }
    }
  }
  provider.reset = reset
  /** 同一主体凭据轮换（CSRF 换票）：在途请求必须停（旧凭据不能落地、更不能重发），
   *  但已缓存的线程保留 —— 每次续期都清空评论区会让用户看到一闪而空的面板。 */
  provider.retirePending = reason => reset(reason || 'authorization-required', { keepThreads: true })
  provider.dispose = () => { disposed = true; reset() }
  return provider
}
