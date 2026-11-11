/* global globalThis */
/* Cold manager port; authentication, CSRF and finite transport stay in authorization.send. */
export function createShareLinkPort(context) {
  const { tenantId, docId, send, tenantUrl, requireCapability, operationId, error, contextChanged, decimal, digest, nextRevision } = context
  const records = new Map(), recovery = new Map(), retired = new Set()
  let floor = '0', generation = 0
  const invalid = () => error('SHARE_LINK_INVALID')
  const compare = (a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)
  const id = value => typeof value === 'string' && /^[A-Za-z0-9._-]{1,128}(?![\s\S])/.test(value)
  const linkId = value => typeof value === 'string' && /^sl_[A-Za-z0-9_-]{43}(?![\s\S])/.test(value)
  const pending = () => [...records.values(), ...recovery.values()].find(record => ['pending', 'unknown'].includes(record.status))
  const required = record => Object.assign(error('SHARE_LINK_QUERY_REQUIRED', 'unknown'), { operationId: record.operationId })
  function snapshot(raw) {
    if (!raw || raw.tenantId !== tenantId || raw.docId !== docId || !decimal(raw.revision) || !['collaborators', 'public'].includes(raw.audience) ||
      typeof raw.enabled !== 'boolean' || !['read', 'edit'].includes(raw.permission) || raw.canManage !== true || raw.organizationBypass !== 'unavailable' ||
      typeof raw.cryptoReady !== 'boolean' || typeof raw.passwordAvailable !== 'boolean' ||
      (raw.audience === 'collaborators' ? raw.enabled || raw.linkId !== null : !linkId(raw.linkId)) ||
      (raw.passwordAvailable ? !raw.enabled || !raw.cryptoReady || typeof raw.password !== 'string' || raw.password.length < 8 || raw.password.length > 18 || /[^\x21-\x7e]/.test(raw.password) || Number(/[a-z]/i.test(raw.password)) + Number(/[0-9]/.test(raw.password)) + Number(/[^a-z0-9]/i.test(raw.password)) < 2 : raw.password !== null)) throw invalid()
    if (compare(raw.revision, floor) < 0) throw error('SHARE_LINK_STALE')
    const result = { tenantId, docId, revision: raw.revision, audience: raw.audience, enabled: raw.enabled, permission: raw.permission,
      linkId: raw.linkId, password: raw.password, passwordAvailable: raw.passwordAvailable, cryptoReady: raw.cryptoReady, canManage: true, organizationBypass: 'unavailable' }
    return result
  }
  function current(record) { if (records.get(record.operationId) !== record) throw contextChanged(record.operationId) }
  async function execute(record, querying) {
    current(record); requireCapability('canManagePermission')
    try {
      const path = `operations/${encodeURIComponent(record.operationId)}?${new URLSearchParams({ commandType: 'share-link', ...(record.requestHash ? { requestHash: record.requestHash } : {}) })}`
      const { status, data } = querying ? await send(path, undefined, true, tenantUrl) : await send('share-link-operations', record.body, true)
      current(record); requireCapability('canManagePermission')
      if (status === 200 && data?.status === 'committed') {
        const link = snapshot(data.link)
        if (data.operationId !== record.operationId || !digest(data.requestHash) || record.requestHash && record.requestHash !== data.requestHash ||
          data.committedRevision !== nextRevision(record.expectedRevision) || compare(link.revision, data.committedRevision) < 0 || typeof data.replayed !== 'boolean') throw invalid()
        floor = link.revision; record.requestHash = data.requestHash; record.status = 'committed'; recovery.delete(record.operationId)
        return { status: 'committed', operationId: record.operationId, requestHash: data.requestHash, committedRevision: data.committedRevision, link, replayed: data.replayed }
      }
      if (!querying && (status >= 400 && status < 500 || ['SHARE_LINK_CRYPTO_UNAVAILABLE', 'SHARE_LINK_BUSY'].includes(data?.code))) throw error(data?.code || 'SHARE_LINK_REJECTED', status)
      if (data?.status === 'unknown' && data.operationId === record.operationId && data.requestHash !== undefined) {
        if (!digest(data.requestHash) || record.requestHash && data.requestHash !== record.requestHash) throw invalid()
        record.requestHash = data.requestHash
      }
      throw error('SHARE_LINK_UNKNOWN', status)
    } catch (cause) {
      current(record)
      const rejected = !querying && (cause.status >= 400 && cause.status < 500 || ['SHARE_LINK_CRYPTO_UNAVAILABLE', 'SHARE_LINK_BUSY'].includes(cause.code))
      record.status = rejected ? 'rejected' : 'unknown'
      throw Object.assign(cause, { operationId: record.operationId, httpStatus: cause.status, status: record.status })
    } finally { delete record.body }
  }
  return {
    async get() {
      requireCapability('canManagePermission'); const prior = pending(); if (prior) throw required(prior)
      const epoch = generation, result = snapshot(await send('share-link')); if (epoch !== generation) throw contextChanged(); requireCapability('canManagePermission'); floor = result.revision; return result
    },
    request(input = {}) {
      requireCapability('canManagePermission'); const prior = pending(); if (prior) throw required(prior)
      const key = input.operationId === undefined ? operationId('share-link') : input.operationId, changes = input.changes
      if (!id(key) || !decimal(input.expectedRevision) || !changes || typeof changes !== 'object' || Array.isArray(changes) || !Object.keys(changes).length ||
        Object.keys(changes).some(k => !['audience', 'enabled', 'permission', 'password'].includes(k)) ||
        changes.audience !== undefined && !['collaborators', 'public'].includes(changes.audience) || changes.enabled !== undefined && typeof changes.enabled !== 'boolean' ||
        changes.permission !== undefined && !['read', 'edit'].includes(changes.permission) || changes.password !== undefined && typeof changes.password !== 'string') throw invalid()
      if (retired.has(key)) throw contextChanged(key)
      if (records.has(key) || recovery.has(key)) throw required(records.get(key) || recovery.get(key))
      const body = { operationId: key, expectedRevision: input.expectedRevision, changes: { ...changes } }
      const record = { operationId: key, expectedRevision: input.expectedRevision, body, requestHash: null, status: 'pending' }
      records.set(key, record); return execute(record, false)
    },
    query(key) {
      let record = records.get(key) || recovery.get(key)
      if (!record) { if (retired.has(key)) throw contextChanged(key); throw error('SHARE_LINK_OPERATION_NOT_FOUND') }
      if (!records.has(key)) { record = { ...record }; records.set(key, record) }
      return execute(record, true)
    },
    operation(key) { const record = key ? records.get(key) || recovery.get(key) : pending(); return record ? { operationId: record.operationId, status: record.status, requestHash: record.requestHash } : null },
    canRecover: key => recovery.has(key),
    reset(reason) {
      generation++
      const keep = reason === 'authorization-required'
      if (!keep) { recovery.forEach((_, key) => retired.add(key)); recovery.clear(); floor = '0' }
      records.forEach((record, key) => {
        delete record.body
        if (keep && ['pending', 'unknown', 'committed'].includes(record.status)) recovery.set(key, { ...record, status: record.status === 'committed' ? 'committed' : 'unknown' })
        else retired.add(key)
      }); records.clear()
    },
  }
}

/* Public unlock uses a separate host transport with an opaque browser binding cookie. */
export function createShareLinkAccessPort({ send, operationId, error, digest, decimal }) {
  let record = null, generation = 0
  const invalid = () => error('SHARE_LINK_INVALID')
  async function execute(current, querying) {
    const epoch = generation
    try {
      const response = querying ? await send(`share-link-access-operations/${encodeURIComponent(current.operationId)}?${new URLSearchParams({ linkId: current.linkId, ...(current.requestHash ? { requestHash: current.requestHash } : {}) })}`) : await send('share-link-access-operations', current.body)
      if (record !== current || epoch !== generation) throw error('SHARE_LINK_CONTEXT_CHANGED')
      const { status, data } = response
      if (!querying && ['SHARE_LINK_CRYPTO_UNAVAILABLE', 'SHARE_LINK_BUSY', 'SHARE_LINK_RATE_LIMIT'].includes(data?.code)) { current.status = 'rejected'; throw error(data.code, status) }
      if (data?.operationId !== current.operationId) throw invalid()
      if (data.requestHash !== undefined) { if (!digest(data.requestHash) || current.requestHash && current.requestHash !== data.requestHash) throw invalid(); current.requestHash = data.requestHash }
      if (status === 200 && data.status === 'committed') {
        if (!current.requestHash || typeof data.principalId !== 'string' || !/^guest-link-[a-f0-9]{40}(?![\s\S])/.test(data.principalId) || !decimal(data.linkRevision) || data.linkRevision === '0' || typeof data.expiresAt !== 'string' || !Number.isFinite(Date.parse(data.expiresAt)) || typeof data.csrfToken !== 'string' || !/^[A-Za-z0-9_-]{43}(?![\s\S])/.test(data.csrfToken) || data.token !== undefined) throw invalid()
        current.status = 'committed'; return { status: 'committed', operationId: current.operationId, requestHash: current.requestHash, principalId: data.principalId, expiresAt: data.expiresAt, linkRevision: data.linkRevision, csrfToken: data.csrfToken }
      }
      if (data.status === 'denied' && data.code === 'SHARE_LINK_DENIED' || !querying && [400,404,429].includes(status)) { current.status = 'rejected'; throw error(data.code || 'SHARE_LINK_DENIED', status) }
      if (!querying && ['SHARE_LINK_CRYPTO_UNAVAILABLE', 'SHARE_LINK_BUSY'].includes(data.code)) { current.status = 'rejected'; throw error(data.code, status) }
      throw error('SHARE_LINK_UNKNOWN', status)
    } catch (cause) {
      if (record !== current || epoch !== generation) throw error('SHARE_LINK_CONTEXT_CHANGED')
      if (current.status !== 'rejected') current.status = 'unknown'
      throw Object.assign(cause, { status: current.status, operationId: current.operationId })
    } finally { delete current.body }
  }
  return {
    request({ linkId, password } = {}) {
      if (record && ['pending', 'unknown'].includes(record.status)) throw error('SHARE_LINK_QUERY_REQUIRED')
      if (typeof linkId !== 'string' || !/^sl_[A-Za-z0-9_-]{43}(?![\s\S])/.test(linkId) || password !== undefined && (typeof password !== 'string' || password.length > 18)) throw invalid()
      const key = operationId('share-link-access'); record = { operationId: key, linkId, requestHash: null, status: 'pending', body: { operationId: key, linkId, ...(password === undefined ? {} : { password }) } }
      return execute(record, false)
    },
    query() { if (!record) throw error('SHARE_LINK_QUERY_REQUIRED'); return execute(record, true) },
    operation() { return record ? { operationId: record.operationId, status: record.status, requestHash: record.requestHash } : null },
    reset() { generation++; record = null },
  }
}

export function shareLinkUrl(documentUrl, linkId) {
  const url = new URL(documentUrl)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || /^\/editor\/v1(?:\/|$)/.test(url.pathname) || !/^sl_[A-Za-z0-9_-]{43}(?![\s\S])/.test(linkId)) throw Error('SHARE_LINK_INVALID')
  const params = new URLSearchParams(url.hash.slice(1))
  if (params.get('larkDocument') !== '1' || !params.get('tenantId') || !params.get('docId') || ['larkDocument', 'tenantId', 'docId'].some(key => params.getAll(key).length !== 1) || [...params.keys()].some(key => !['larkDocument', 'tenantId', 'docId'].includes(key))) throw Error('SHARE_LINK_INVALID')
  params.set('shareLink', linkId); url.hash = params.toString(); return url.href
}

function securePassword() {
  const pools = ['abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ', '23456789', '!@#$%^&*'], all = pools.join(''), bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  const chars = pools.map((pool, index) => pool.charAt(bytes[index] % pool.length))
  for (let index = 3; index < 8; index++) chars.push(all.charAt(bytes[index] % all.length))
  for (let index = 7; index > 0; index--) { const other = bytes[index + 8] % (index + 1), value = chars[index]; chars[index] = chars[other]; chars[other] = value }
  return chars.join('')
}

/* Manager UI logic stays in the cold chunk; the editor's eager mixin only dispatches user actions. */
export async function remoteShareLinkAction(ed, action, input) {
  const scope = ed.remoteShareScope(), provider = scope.provider
  if (!scope.current() || typeof provider?.shareLink !== 'function') return null
  const apply = state => {
    ed.shareLinkState = state; ed.secureLinkEnabled = state.enabled; ed.secureLinkPassword = state.password || ''
    ed.shareLinkPerm = state.permission === 'edit' ? '可编辑' : '可阅读'
  }
  if (action === 'toggle') {
    if (ed.shareLinkBusy || ed.shareLinkPending || !ed.shareLinkState?.cryptoReady) return null
    if (!ed.secureLinkEnabled) { ed.secureLinkConfirmOpen = true; return null }
    return remoteShareLinkAction(ed, 'save', { enabled: false })
  }
  if (action === 'confirm') {
    ed.secureLinkConfirmOpen = false
    const password = securePassword()
    return remoteShareLinkAction(ed, 'save', { audience: 'public', enabled: true, password })
  }
  if (action === 'random') {
    if (ed.passwordDialogOpen) ed.passwordDraft = securePassword()
    return null
  }
  if (action === 'password') return remoteShareLinkAction(ed, 'save', { password: input })
  if (action === 'permission') return remoteShareLinkAction(ed, 'save', { permission: input === '可编辑' ? 'edit' : 'read' })
  if (action === 'audience') return remoteShareLinkAction(ed, 'save', input === 'public' ? { audience: 'public' } : { audience: 'collaborators', enabled: false })
  if (ed.shareLinkBusy) return null
  const token = {}; ed._shareLinkToken = token; ed.shareLinkBusy = true; ed.shareLinkError = ''
  const current = () => ed._shareLinkToken === token && scope.current()
  const owner = () => ed._shareLinkToken === token && scope.owner()
  try {
    let result
    const pending = ed.shareLinkPending || (await provider.shareLink('operation'))?.operationId
    if (!current()) return null
    if (action === 'save') {
      if (pending || !ed.shareLinkState?.cryptoReady) { ed.shareLinkPending = pending || ''; return null }
      result = await provider.shareLink('request', { expectedRevision: ed.shareLinkState.revision, changes: input })
    } else if (action === 'copy' || action === 'copy-password') {
      if (pending) { ed.shareLinkPending = pending; return null }
      const state = await provider.shareLink('get'), documentUrl = await scope.session.getShareLink()
      if (!current()) return null
      apply(state)
      if (state.audience !== 'public' || state.enabled && !state.passwordAvailable || action === 'copy-password' && !state.passwordAvailable) { ed.shareLinkError = '请先开启链接分享并确认密码服务可用。'; return null }
      const url = shareLinkUrl(documentUrl, state.linkId), clipboard = ed.shareClipboardWriter()
      if (!clipboard?.writeText) throw Error('SHARE_CLIPBOARD_UNAVAILABLE')
      const text = typeof input === 'function' ? input(url, state.enabled ? state.password : '') : state.enabled ? `飞书链接：${url}   密码：${state.password}` : url
      await clipboard.writeText(text)
      if (current()) ed.showShareToast('success', state.enabled ? '链接和密码已复制' : '链接已复制')
      return true
    } else {
      if (pending) { ed.shareLinkPending = pending; result = await provider.shareLink('query', pending) }
      else result = await provider.shareLink('get')
    }
    if (!current()) return null
    apply(result.status === 'committed' ? result.link : result); ed.shareLinkPending = ''
    if (action === 'save') { ed.closePasswordDialog(); ed.showShareToast('success', '链接权限已更新'); void scope.session.refreshCapabilities?.() }
    return result
  } catch (cause) {
    if (owner()) {
      ed.shareLinkState = null; ed.secureLinkEnabled = false; ed.secureLinkPassword = ''
      if (cause.status === 'unknown' && cause.operationId) ed.shareLinkPending = cause.operationId
      ed.shareLinkError = ed.shareLinkPending ? '链接操作待确认，请核对原操作。' : cause.code === 'SHARE_LINK_CRYPTO_UNAVAILABLE' ? '链接加密服务尚未配置。' : '链接设置未能完成，请重新载入。'
      ed.showShareToast('warning', ed.shareLinkError)
    }
    return null
  } finally { if (ed._shareLinkToken === token) ed.shareLinkBusy = false }
}
