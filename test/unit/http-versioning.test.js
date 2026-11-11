import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import * as Y from 'yjs'
import { createHttpVersioningProvider } from '../../src/providers/versioning'
import { createHttpIdentityProvider } from '../../src/providers/identity'
import { normalizeRemoteVersionDiff, formatVersionDiffValue } from '../../src/core/versioning/diff'
import exportMixin from '../../src/components/lark-doc/editor/exportMixin'
import { createDocumentSession } from '../../src/session/DocumentSession'
import versioningMixin from '../../src/components/lark-doc/editor/versioningMixin'

// 真实Yjs字节与匹配的PM投影；fetch仍为注入端口，不代替PG冻结/浏览器验收。
const ydoc = new Y.Doc({ gc: false })
const paragraph = new Y.XmlElement('paragraph'), text = new Y.XmlText()
text.insert(0, '冻结A'); paragraph.insert(0, [text]); ydoc.getXmlFragment('default').insert(0, [paragraph])
const payload = Y.encodeStateAsUpdate(ydoc)
ydoc.destroy()
const contentJson = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '冻结A' }] }] }
const canonical = '{"content":[{"content":[{"text":"冻结A","type":"text"}],"type":"paragraph"}],"type":"doc"}'
const sha = value => 'sha256:' + createHash('sha256').update(value).digest('hex')
const requestHash = sha('canonical-request')
const meta = (extra = {}) => ({ tenantId: 'tenant', docId: 'doc', versionId: 'version:one', operationId: 'version-op',
  capturedSeq: '7', sourceRevision: '7', sourceEpoch: '1', schemaVersion: '1', stateHash: sha(payload), contentHash: sha(canonical),
  label: 'A', purpose: 'manual', kind: 'manual', sizeBytes: payload.byteLength, protocolVersion: 'editor-crdt-v1',
  createdAt: '2026-11-07T13:00:00Z', createdBy: 'alice', status: 'durable', ...extra })
const full = () => ({ ...meta(), payloadBase64: Buffer.from(payload).toString('base64'), contentJson })
const committed = (extra = {}) => ({ status: 'committed', operationId: 'version-op', requestHash, version: meta(), ...extra })
const response = (data, status = 200) => ({ status, json: async () => data })
const create = (request, extra = {}) => createHttpVersioningProvider({ tenantId: 'tenant', docId: 'doc', csrfToken: 'csrf',
  getState: () => ({ status: 'ready', revision: '7', pending: [] }), request, ...extra })

// Session identity delivery is synthetic; the version adapter/HTTP decoding and lifecycle are the production implementations.
function versionIdentitySession(provider, capabilities = { canView: true, canCreateVersion: true }) {
  const listeners = new Set()
  let state = { status: 'authenticated', principalId: 'alice', canCreate: false, expiresInMs: 4000, generation: 1 }
  const identity = { getState: () => state, getCsrfToken: () => 'csrf',
    subscribe(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener) },
    async login() {}, async queryLogin() {}, async refresh() {}, async logout() {}, dispose() { listeners.clear() } }
  const session = createDocumentSession({ documentId: 'doc', identity, versioning: provider,
    authorization: { async getCapabilities() { return capabilities } } })
  return { session, identity, async change(principalId) { state = { ...state, principalId, generation: state.generation + 1 }; listeners.forEach(listener => listener(state)); await session._capabilitiesPromise } }
}

describe('Session identity must reset actual non-conversion version state (E1)', () => {
  it('Session version reset: new identity cannot replay a cached prior principal result without a current GET', async () => {
    const request = vi.fn(async () => response(committed(), 201)), provider = create(request), h = versionIdentitySession(provider)
    try {
      await h.session._capabilitiesPromise
      const intent = { operationId: 'version-op', label: 'A' }
      expect(await h.session.createVersion(intent)).toMatchObject({ status: 'committed', version: { createdBy: 'alice' } })
      await h.change('bob'); expect(h.session.user.id).toBe('bob'); expect(h.session.can('canCreateVersion')).toBe(true)
      const before = request.mock.calls.length
      await expect(h.session.createVersion(intent)).rejects.toMatchObject({ code: 'VERSION_CONTEXT_CHANGED' })
      expect(request).toHaveBeenCalledTimes(before)
      await expect(provider.queryOperation('version-op')).rejects.toMatchObject({ code: 'VERSION_CONTEXT_CHANGED' })
      expect(request).toHaveBeenCalledTimes(before)
    } finally { await h.session.dispose() }
  })
  it('Session version reset: a late non-conversion HTTP response cannot refill the prior identity ledger', async () => {
    let release, entered
    const waiting = new Promise(resolve => { release = resolve }), reached = new Promise(resolve => { entered = resolve })
    const request = vi.fn(async () => { entered(); return waiting }), provider = create(request), h = versionIdentitySession(provider)
    try {
      await h.session._capabilitiesPromise
      // Observe the real provider boundary too: Session's final identity guard alone cannot clean its sensitive Map.
      const pending = provider.createSnapshot({ operationId: 'version-op', label: 'A' }).then(value => ({ value }), error => ({ error }))
      await reached; await h.change('bob'); release(response(committed(), 201))
      expect(await pending).toMatchObject({ error: { code: 'VERSION_CONTEXT_CHANGED' } })
      await expect(h.session.createVersion({ operationId: 'version-op', label: 'A' })).rejects.toMatchObject({ code: 'VERSION_CONTEXT_CHANGED' })
      expect(request).toHaveBeenCalledOnce(); expect(request.mock.calls[0][1].method).toBe('POST')
    } finally { release?.(response(committed(), 201)); await h.session.dispose() }
  })
})

describe('HTTP immutable version adapter（注入fetch，非真实PG冻结）', () => {
  it('list仅映射meta并保留来源/hash，不带正文；get校验实际二进制和内容投影hash', async () => {
    const request = vi.fn(async url => response(url.endsWith('/versions') ? [meta()] : full()))
    const provider = create(request)
    const list = await provider.list()
    expect(list[0]).toMatchObject({ id: 'version:one', documentId: 'doc', author: 'alice', sourceRevision: '7', contentHash: meta().contentHash, stateHash: meta().stateHash })
    expect(list[0].createdAt).toBe(Date.parse(meta().createdAt))
    expect(list[0].payload).toBeUndefined()
    const version = await provider.get('version:one')
    expect(version.payload).toEqual(payload)
    expect(version.contentJson).toEqual(contentJson)
    expect(version.payloadBase64).toBeUndefined()
    expect(request.mock.calls[1][0]).toContain('/versions/version%3Aone')
    expect(request.mock.calls[1][1]).toMatchObject({ credentials: 'include', cache: 'no-store', method: 'GET' })
  })

  it.each([
    { stateHash: sha('other bytes') }, { contentHash: sha('other content') },
    { docId: 'other' }, { versionId: 'other' }, { sizeBytes: payload.byteLength + 1 },
  ])('拒绝异文档/异版本/错误hash或长度：%j', async invalid => {
    await expect(create(async () => response({ ...full(), ...invalid })).get('version:one')).rejects.toThrow()
  })

  it('列表拒正文混入；真实投影拒非JSON数字', async () => {
    await expect(create(async () => response([full()])).list()).rejects.toMatchObject({ code: 'VERSION_INVALID_LIST' })
    await expect(create(async () => response({ ...full(), contentJson: { type: 'doc', content: [], invalid: Infinity } })).get('version:one')).rejects.toMatchObject({ code: 'VERSION_INVALID_CONTENT' })
  })

  it('冻结POST仅发送原op/committed revision/label/purpose，忽略活动JSON与actor', async () => {
    const request = vi.fn(async () => response(committed(), 201))
    const created = await create(request).createSnapshot({ operationId: 'version-op', label: 'A',
      content: { text: '尚未持久化' }, author: 'forged', actor: 'forged', documentId: 'doc' })
    expect(created).toMatchObject({ status: 'committed', id: 'version:one', version: { status: 'durable' }, requestHash })
    const [url, init] = request.mock.calls[0]
    expect(url).toBe('/editor/v1/tenants/tenant/documents/doc/version-operations')
    expect(JSON.parse(init.body)).toEqual({ operationId: 'version-op', expectedRevision: '7', label: 'A', purpose: 'manual' })
    expect(init.headers).toMatchObject({ 'X-CSRF-Token': 'csrf', 'Idempotency-Key': 'version-op' })
  })

  it.each([{ status: 'blocked', pending: [] }, { status: 'ready', pending: [{ status: 'unknown' }] }])('pending或unknown/quarantine状态不发冻结请求', async state => {
    const request = vi.fn()
    await expect(create(request, { getState: () => ({ revision: '7', ...state }) }).createSnapshot({ label: 'A' })).rejects.toMatchObject({ code: 'VERSION_STATE_NOT_READY' })
    expect(request).not.toHaveBeenCalled()
  })

  it('未知提交保原键，不重新POST；显式查询原结果才确认持久版本', async () => {
    const request = vi.fn(async (url, init) => {
      if (init.method === 'POST') throw new Error('lost acknowledgement')
      return response(committed())
    })
    const provider = create(request)
    const original = { operationId: 'version-op', label: 'A' }
    expect((await provider.createSnapshot(original)).status).toBe('unknown')
    expect((await provider.createSnapshot(original)).status).toBe('unknown')
    expect(request).toHaveBeenCalledTimes(1)
    await expect(provider.createSnapshot({ ...original, label: 'changed' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_MISMATCH' })
    expect((await provider.queryOperation('version-op')).status).toBe('committed')
    expect(request.mock.calls[1][0]).toBe('/editor/v1/tenants/tenant/operations/version-op?commandType=version')
    expect(request.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1)
  })

  it('自动ID只生成一次供原键查询，202与畸形2xx不显示成功', async () => {
    const request = vi.fn(async (url, init) => response({ status: 'unknown', operationId: JSON.parse(init.body).operationId }, 202))
    const provider = create(request)
    const unknown = await provider.createSnapshot({ label: 'A' })
    expect(unknown.operationId).toMatch(/^version-[0-9a-f]{32}$/)
    expect(unknown.status).toBe('unknown')
    expect((await create(async () => response({}, 201)).createSnapshot({ operationId: 'version-op', label: 'A' })).status).toBe('unknown')
  })

  it('已知原hash不能被query替换，未接隔离/能力端口时不能恢复', async () => {
    const request = vi.fn(async (url, init) => init.method === 'POST'
      ? response({ status: 'unknown', operationId: 'version-op', requestHash }, 503)
      : response(committed({ requestHash: sha('changed request') })))
    const provider = create(request)
    await provider.createSnapshot({ operationId: 'version-op', label: 'A' })
    expect((await provider.queryOperation('version-op')).status).toBe('unknown')
    await expect(provider.restore('version:one')).rejects.toMatchObject({ code: 'RESTORE_CONFIGURATION_REQUIRED' })
    expect(request).toHaveBeenCalledTimes(2)
  })

  it.each(['request', 'json'])('15秒deadline包含%s，中止且无隐藏重试', async phase => {
    vi.useFakeTimers()
    try {
      let signal
      const request = vi.fn((url, init) => {
        signal = init.signal
        return phase === 'request' ? new Promise(() => {}) : Promise.resolve({ status: 200, json: () => new Promise(() => {}) })
      })
      const assertion = expect(create(request).list()).rejects.toMatchObject({ code: 'VERSION_REQUEST_TIMEOUT' })
      await vi.advanceTimersByTimeAsync(15000)
      await assertion
      expect(signal.aborted).toBe(true)
      expect(request).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })
})

describe('HTTP restore原操作与显式新代际重开（注入端口，非PG/WS）', () => {
  const restoreHash = sha('restore request')
  const restored = () => {
    const post = meta({ versionId: 'version:post', operationId: 'restore-op:post', purpose: 'post_restore', kind: 'post_restore',
      sourceEpoch: '2', sourceRevision: '8', capturedSeq: '8', stateHash: sha('complete historical state after restore') })
    return { status: 'committed', operationId: 'restore-op', requestHash: restoreHash,
      preVersionId: 'version:pre', postVersionId: post.versionId, preEpoch: '1', postEpoch: '2',
      preStateHash: sha('pre state'), postStateHash: post.stateHash, preContentHash: sha('B'), postContentHash: post.contentHash,
      postVersion: post, roomApplied: true,
      receipt: { tenantId: 'tenant', docId: 'doc', updateId: 'restore-delta', payloadHash: sha('delta'), epoch: '2',
        protocolVersion: 'editor-crdt-v1', seq: '8', contentRevision: '8', committedAt: '2026-11-07T13:00:00Z', status: 'durable' } }
  }
  function setup(options = {}) {
    let state = { status: 'ready', epoch: '1', revision: '7', pending: [], canWrite: true }
    const isolate = vi.fn(() => { state = { ...state, status: 'quarantined', canWrite: false } })
    const request = vi.fn(async (url, init) => url.includes('/versions/') ? response(full())
      : response(options.outcome || restored(), init.method === 'POST' ? options.status || 200 : 200))
    const config = { getState: () => state, getCapabilities: () => ({ canRestoreVersion: true }), isolateDocument: isolate }
    const provider = create(request, { ...config, ...options.config })
    return { provider, request, isolate, getState: () => state, setState: next => { state = next } }
  }

  it('只POST不可变原键/CAS/epoch/target；成功不从JSON重建，未重开保持真实committed', async () => {
    const h = setup()
    const result = await h.provider.restore('version:one', { operationId: 'restore-op', contentJson: { forged: true }, actor: 'forged' })
    expect(result).toMatchObject({ status: 'committed', reloadRequired: true, editingResumed: false, postEpoch: '2' })
    const [, init] = h.request.mock.calls.find(([, value]) => value.method === 'POST')
    expect(JSON.parse(init.body)).toEqual({ operationId: 'restore-op', targetVersionId: 'version:one', expectedRevision: '7', expectedEpoch: '1' })
    expect(h.getState()).toMatchObject({ epoch: '1', status: 'quarantined', canWrite: false })
    expect(h.isolate).toHaveBeenCalledWith(expect.objectContaining({ isolationReason: 'EPOCH_MISMATCH', status: 'committed' }))
    expect(result.postStateHash).not.toBe(meta().stateHash) // 完整历史身份不等目标旧状态字节。
    expect(result.postContentHash).toBe(meta().contentHash)
  })

  it('只有host显式重开后实际新ready/epoch/pending证明才报告恢复编辑，重复query不再隔离新连接', async () => {
    const reload = vi.fn(async () => h.setState({ status: 'ready', epoch: '2', revision: '8', pending: [], canWrite: true }))
    const h = setup({ config: { reloadDocument: reload } })
    const result = await h.provider.restore('version:one', { operationId: 'restore-op' })
    expect(result).toMatchObject({ status: 'committed', reloadRequired: false, editingResumed: true })
    await h.provider.queryRestoreOperation('restore-op')
    expect(reload).toHaveBeenCalledTimes(1)
    expect(h.isolate).toHaveBeenCalledTimes(1)
    expect(h.getState().epoch).toBe('2')
  })

  it.each(['throws', 'claimsReady'])('host重开%s不更改DB已提交事实，也不能声称旧文档已恢复编辑', async mode => {
    const h = setup({ outcome: { ...restored(), roomApplied: false }, config: { reloadDocument: async () => {
      if (mode === 'throws') throw new Error('reload failed')
      return { status: 'ready', epoch: '2', pending: [] }
    } } })
    expect(await h.provider.restore('version:one', { operationId: 'restore-op' })).toMatchObject({ status: 'committed', reloadRequired: true, editingResumed: false, roomApplied: false })
  })

  it('unknown隔离旧连接并保原op，显式query不自动再POST/换epoch', async () => {
    let committedNow = false
    const h = setup()
    h.request.mockImplementation(async (url, init) => url.includes('/versions/') ? response(full())
      : response(committedNow ? restored() : { status: 'unknown', operationId: 'restore-op', requestHash: restoreHash, code: 'COMMIT_UNKNOWN' }, init.method === 'POST' ? 503 : 200))
    expect(await h.provider.restore('version:one', { operationId: 'restore-op' })).toMatchObject({ status: 'unknown', operationId: 'restore-op' })
    expect(h.isolate).toHaveBeenLastCalledWith(expect.objectContaining({ isolationReason: 'RESTORE_RESULT_UNKNOWN' }))
    committedNow = true
    expect((await h.provider.queryRestoreOperation('restore-op')).status).toBe('committed')
    expect(h.request.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1)
    expect(h.request.mock.calls.some(([url]) => url.endsWith('/operations/restore-op?commandType=restore'))).toBe(true)
    expect(h.getState().epoch).toBe('1')
  })

  it.each([
    { postEpoch: '3' }, { preEpoch: '0' }, { requestHash: 'not-a-hash' },
    { postContentHash: sha('wrong target') }, { postStateHash: sha('wrong state') },
    { receipt: { ...restored().receipt, epoch: '1' } },
    { receipt: { ...restored().receipt, status: 'pending' } },
    { postVersion: { ...restored().postVersion, kind: 'manual' } },
  ])('错原键/epoch/receipt/目标hash不能确认或启用编辑：%j', async patch => {
    const h = setup({ outcome: { ...restored(), ...patch } })
    const result = await h.provider.restore('version:one', { operationId: 'restore-op' })
    expect(result.status).toBe('unknown')
    expect(h.getState().epoch).toBe('1')
    expect(h.getState().canWrite).toBe(false)
  })

  it('实际能力false/unknown或pending时不提交；409冲突明示且不自动改CAS', async () => {
    const denied = setup({ config: { getCapabilities: () => ({ canRestoreVersion: 'true' }) } })
    await expect(denied.provider.restore('version:one')).rejects.toMatchObject({ code: 'RESTORE_FORBIDDEN' })
    expect(denied.request).not.toHaveBeenCalled()
    const pending = setup()
    pending.setState({ status: 'ready', epoch: '1', revision: '7', pending: [{ status: 'unknown' }] })
    await expect(pending.provider.restore('version:one')).rejects.toMatchObject({ code: 'RESTORE_STATE_NOT_READY' })
    expect(pending.request).not.toHaveBeenCalled()
    const conflict = setup({ status: 409, outcome: { operationId: 'restore-op', code: 'REVISION_CONFLICT' } })
    await expect(conflict.provider.restore('version:one', { operationId: 'restore-op' })).rejects.toMatchObject({ code: 'REVISION_CONFLICT', status: 409 })
    expect(conflict.request.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1)
  })
})

const diffSource = (extra = {}) => ({ versionId: 'version:one', sourceRevision: '7', sourceEpoch: '1', capturedSeq: '7', schemaVersion: '1', stateHash: sha(payload), contentHash: sha(canonical), ...extra })
const realDiff = (extra = {}) => ({ status: 'completed', tenantId: 'tenant', docId: 'doc', algorithm: 'json-pointer-v1',
  from: diffSource(), to: diffSource({ versionId: 'version:two', sourceRevision: '8', capturedSeq: '8', contentHash: sha('changed content') }),
  identical: false, changes: [{ path: '/content/0/content/0/text', kind: 'replace', before: '冻结A', after: '冻结B' },
    { path: '/content/0/attrs/title~1name', kind: 'add', after: '<img src=x onerror=alert(1)>' }], persisted: false, taskId: null, ...extra })
const conversionBlocked = (kind, extra = {}) => ({ status: 'blocked', code: 'DEPENDENCY_BLOCKED', operation: kind,
  operationId: `${kind}-op`, dependencies: ['approved-conversion-formats', 'internal-conversion', 'internal-object-storage'],
  requestedFormat: 'docx', formatApproved: false, persisted: false, taskId: null,
  ...(kind === 'import' ? { sourceVerified: false, expectedEpoch: '1', expectedRevision: '7' } : { sourceVerified: true, source: diffSource() }), ...extra })
const converting = (request, extra = {}) => create(request, { getState: () => ({ status: 'ready', epoch: '1', revision: '7', lastSeq: '7', pending: [] }),
  getCapabilities: () => ({ canView: true, canEdit: true, canExport: true }), ...extra })

describe('审计下载原键（真实HTTP端口，E1非真实PG/浏览器）', () => {
  const owned = [], releases = []
  const bytes = new TextEncoder().encode('audited immutable export')
  const ready = () => ({ status: 'ready', operation: 'export', operationId: 'export-op', tenantId: 'tenant', docId: 'doc', requestHash,
    requestedFormat: 'docx', persisted: true, taskId: 'export-op', sourceVerified: true, source: diffSource(), code: null,
    output: { mimeType: 'application/octet-stream', sizeBytes: String(bytes.length), checksum: sha(bytes) } })
  const binary = () => ({ status: 200, arrayBuffer: vi.fn(async () => bytes.buffer) })
  const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes }); releases.push(resolve); return { promise, resolve } }
  const keyOf = (url, init) => init.body ? JSON.parse(init.body).downloadOperationId : new URL(url, 'https://editor.example').searchParams.get('downloadOperationId')
  const unknown = (url, init, extra = {}) => response({ status: 'unknown', code: init.method === 'POST' ? 'COMMIT_UNKNOWN' : 'OPERATION_UNKNOWN',
    operationId: 'export-op', downloadOperationId: keyOf(url, init), requestHash, ...extra }, 503)
  const contentCalls = request => request.mock.calls.filter(([url]) => url.includes('/content?'))
  async function harness(content = async () => binary(), options = {}) {
    const request = vi.fn(async (url, init) => url.includes('/content?') ? content(url, init) : response(ready()))
    const port = converting(request, { auditedDownloads: true, ...options }); owned.push(port)
    await port.requestExport({ operationId: 'export-op', versionId: 'version:one', format: 'docx' })
    return { port, request }
  }
  afterEach(async () => {
    releases.splice(0).forEach(release => release(binary()))
    for (const value of owned.splice(0).reverse()) await value.dispose()
    vi.unstubAllGlobals(); vi.useRealTimers()
  })
  it.each([undefined, false])('审计未显式true时沿旧GET，不生成下载键：%s', async auditedDownloads => {
    const { port, request } = await harness(undefined, { auditedDownloads })
    expect((await port.downloadConversion('export-op')).downloadOperationId).toBeUndefined()
    await port.downloadConversion('export-op')
    for (const [url, init] of contentCalls(request)) {
      expect(init.method).toBe('GET'); expect(init.body).toBeUndefined(); expect(init.headers['Idempotency-Key']).toBeUndefined()
      expect(new URL(url, 'https://editor.example').searchParams.has('downloadOperationId')).toBe(false)
    }
    expect(port.getConversionOperation('export-op').download).toBeUndefined()
  })
  it('完整字节/hash成功才complete；下一次明确下载新键，POST只发送独立下载ID', async () => {
    let csrf = 'csrf-initial'
    const { port, request } = await harness(undefined, { csrfToken: () => csrf })
    csrf = 'csrf-current'
    const first = await port.downloadConversion('export-op')
    expect(first).toMatchObject({ status: 'downloaded', operationId: 'export-op', checksum: sha(bytes) }); expect(first.bytes).toEqual(bytes)
    expect(first.downloadOperationId).toMatch(/^download-[a-f0-9]{32}$/)
    expect(port.getConversionOperation('export-op').download).toEqual({ id: first.downloadOperationId, status: 'complete' })
    const second = await port.downloadConversion('export-op'); expect(second.downloadOperationId).not.toBe(first.downloadOperationId)
    for (const [url, init] of contentCalls(request)) {
      const id = keyOf(url, init)
      expect(new URL(url, 'https://editor.example').searchParams.get('requestHash')).toBe(requestHash)
      expect(init).toMatchObject({ method: 'POST', credentials: 'include', cache: 'no-store', redirect: 'error',
        headers: { Accept: 'application/octet-stream', 'Content-Type': 'application/json', 'X-CSRF-Token': 'csrf-current', 'Idempotency-Key': id } })
      expect(JSON.parse(init.body)).toEqual({ downloadOperationId: id }); expect(init.headers.Cookie).toBeUndefined()
    }
  })
  it('丢失POST与GET未知都保原downloadid；只GET完整恢复后下次点击才可新POST', async () => {
    let calls = 0
    const { port, request } = await harness(async (url, init) => {
      calls++; if (calls === 1) throw Error('lost download response')
      return calls === 2 ? unknown(url, init) : binary()
    })
    const error = await port.downloadConversion('export-op').catch(value => value)
    expect(error).toMatchObject({ status: 'unknown', operationId: 'export-op' })
    const original = error.downloadOperationId
    await expect(port.downloadConversion('export-op')).rejects.toMatchObject({ code: 'OPERATION_UNKNOWN', status: 'unknown', downloadOperationId: original })
    expect(port.getConversionOperation('export-op').download).toEqual({ id: original, status: 'unknown' })
    expect((await port.downloadConversion('export-op')).downloadOperationId).toBe(original)
    expect((await port.downloadConversion('export-op')).downloadOperationId).not.toBe(original)
    const callsMade = contentCalls(request)
    expect(callsMade.map(([, init]) => init.method)).toEqual(['POST', 'GET', 'GET', 'POST'])
    expect(callsMade.slice(0, 3).every(([url, init]) => keyOf(url, init) === original)).toBe(true)
    expect(callsMade.slice(1, 3).every(([, init]) => init.body === undefined)).toBe(true)
  })
  it('同一下载尚未完成时再次调用只GET已保存的原键，不并发第二个POST', async () => {
    const held = deferred(), entered = deferred()
    const { port, request } = await harness(async (url, init) => {
      if (init.method === 'POST') { entered.resolve(); return held.promise }
      return unknown(url, init)
    })
    const pending = port.downloadConversion('export-op')
    await entered.promise; const [url, init] = contentCalls(request)[0], original = keyOf(url, init)
    expect(port.getConversionOperation('export-op').download).toEqual({ id: original, status: 'unknown' })
    await expect(port.downloadConversion('export-op')).rejects.toMatchObject({ status: 'unknown', downloadOperationId: original })
    held.resolve(binary()); expect((await pending).downloadOperationId).toBe(original)
    expect(contentCalls(request).map(([, call]) => call.method)).toEqual(['POST', 'GET'])
  })
  it.each([{ operationId: 'other-export' }, { downloadOperationId: 'other-download' }, { requestHash: sha('other request') }, { bytes: 'forged' }])('未知DTO作用域/多余字段错误不释放原键：%j', async extra => {
    let first = true
    const { port, request } = await harness(async (url, init) => { if (first) { first = false; return unknown(url, init, extra) } return binary() })
    const error = await port.downloadConversion('export-op').catch(value => value)
    expect(error).toMatchObject({ code: 'CONVERSION_RESULT_UNKNOWN', status: 'unknown', operationId: 'export-op' })
    expect(JSON.stringify(error)).not.toContain('forged')
    expect((await port.downloadConversion('export-op')).downloadOperationId).toBe(error.downloadOperationId)
    expect(contentCalls(request).map(([, init]) => init.method)).toEqual(['POST', 'GET'])
  })
  it.each([400, 401, 403, 404, 409, 500])('HTTP %s失败后也不二POST，只按原下载键查询', async status => {
    let first = true
    const { port, request } = await harness(async () => { if (first) { first = false; return { status } } return binary() })
    const error = await port.downloadConversion('export-op').catch(value => value)
    expect(error).toMatchObject({ status: 'unknown', httpStatus: status, operationId: 'export-op' })
    expect((await port.downloadConversion('export-op')).downloadOperationId).toBe(error.downloadOperationId)
    expect(contentCalls(request).map(([, init]) => init.method)).toEqual(['POST', 'GET'])
  })
  it('在途POST遇到多次soft reset清output，原export查询后只GET同下载键，迟字节不回填', async () => {
    const held = deferred(), entered = deferred()
    const { port, request } = await harness(async (url, init) => { if (init.method === 'POST') { entered.resolve(); return held.promise } return binary() })
    const pending = port.downloadConversion('export-op').catch(error => error)
    await entered.promise; const [url, init] = contentCalls(request)[0], original = keyOf(url, init)
    port.reset('authorization-required'); port.resetConversions('authorization-required')
    expect(await pending).toMatchObject({ code: 'CONVERSION_CONTEXT_CHANGED', status: 'unknown', operationId: 'export-op', downloadOperationId: original })
    expect(init.signal.aborted).toBe(true); expect(port.getConversionOperation('export-op')).toBeNull()
    await expect(port.downloadConversion('export-op')).rejects.toMatchObject({ code: 'CONVERSION_OUTPUT_NOT_READY' })
    await port.queryConversion('export-op')
    expect(port.getConversionOperation('export-op').download).toEqual({ id: original, status: 'unknown' })
    const resumed = await port.downloadConversion('export-op'); expect(resumed.downloadOperationId).toBe(original)
    held.resolve(binary()); await Promise.resolve()
    expect(port.getConversionOperation('export-op').download).toEqual({ id: original, status: 'complete' })
    expect(contentCalls(request).map(([, call]) => call.method)).toEqual(['POST', 'GET'])
  })
  it('soft reset发生在已校验字节后仍先GET旧键，避免外层尚未交付就重复审计', async () => {
    const { port, request } = await harness()
    const first = await port.downloadConversion('export-op')
    port.resetConversions('authorization-required'); await port.queryConversion('export-op')
    expect(port.getConversionOperation('export-op').download).toEqual({ id: first.downloadOperationId, status: 'unknown' })
    expect((await port.downloadConversion('export-op')).downloadOperationId).toBe(first.downloadOperationId)
    expect((await port.downloadConversion('export-op')).downloadOperationId).not.toBe(first.downloadOperationId)
    expect(contentCalls(request).map(([, call]) => call.method)).toEqual(['POST', 'GET', 'POST'])
  })
  it.each(['identity-changed', 'provider-replaced', 'doc-changed', 'disposed'])('硬重置%s退休原export和download键，不能带入下一身份', async reason => {
    const { port, request } = await harness(async () => { throw Error('unknown original download') })
    const error = await port.downloadConversion('export-op').catch(value => value)
    expect(error.downloadOperationId).toBeTruthy()
    if (reason === 'disposed') port.dispose(); else port.reset(reason)
    const count = request.mock.calls.length
    await expect(Promise.resolve().then(() => port.queryConversion('export-op'))).rejects.toBeInstanceOf(Error)
    await expect(Promise.resolve().then(() => port.downloadConversion('export-op'))).rejects.toBeInstanceOf(Error)
    await expect(Promise.resolve().then(() => port.requestExport({ operationId: 'export-op', versionId: 'version:one', format: 'docx' }))).rejects.toBeInstanceOf(Error)
    expect(request).toHaveBeenCalledTimes(count); expect(port.getConversionOperation('export-op')).toBeNull()
  })
  it('真实Session A→B→A即使最终同名也不能复活旧download键或交付迟字节', async () => {
    const held = deferred(), entered = deferred()
    const request = vi.fn(async (url, init) => { if (url.includes('/content?')) { entered.resolve(); return held.promise } return response(ready()) })
    const port = converting(request, { auditedDownloads: true }); owned.push(port)
    const h = versionIdentitySession(port, { canView: true, canCreateVersion: true, canExport: true }); owned.push(h.session)
    await h.session._capabilitiesPromise
    await port.requestExport({ operationId: 'export-op', versionId: 'version:one', format: 'docx' })
    const pending = port.downloadConversion('export-op').then(value => ({ value }), error => ({ error }))
    await entered.promise; await h.change('bob'); await h.change('alice'); held.resolve(binary())
    expect((await pending).value).toBeUndefined()
    const count = request.mock.calls.length
    await expect(h.session.queryConversion('export-op')).rejects.toBeInstanceOf(Error)
    expect(request).toHaveBeenCalledTimes(count); expect(port.getConversionOperation('export-op')).toBeNull()
  })
  it('真实HTTP身份CSRF轮换后复权并查询原export，下载仍只GET原audit', async () => {
    vi.useFakeTimers()
    let csrf = 'A', session
    const identity = createHttpIdentityProvider({ tenantId: 'tenant', docId: 'doc', request: async () => ({ status: 200,
      headers: { get: () => 'application/json' }, json: async () => ({ status: 'authenticated', principalId: 'alice', canCreate: false,
        csrfToken: csrf.repeat(43), refreshAfterMs: 1000, expiresInMs: 4000 }) }) }); owned.push(identity)
    await identity.login({ operationId: 'download-login', loginCode: 'download-fixture-code' })
    const held = deferred(), entered = deferred()
    const request = vi.fn(async (url, init) => {
      if (url.includes('/content?')) { if (init.method === 'POST') { entered.resolve(); return held.promise } return binary() }
      return response(ready())
    })
    const port = converting(request, { auditedDownloads: true, csrfToken: () => identity.getCsrfToken(), getCapabilities: () => session.getCapabilities() }); owned.push(port)
    session = createDocumentSession({ documentId: 'doc', identity, versioning: port,
      authorization: { async getCapabilities() { return { canView: true, canEdit: true, canExport: true } } } }); owned.push(session)
    await session._capabilitiesPromise
    await session.requestExport({ operationId: 'export-op', versionId: 'version:one', format: 'docx' })
    const pending = session.downloadConversion('export-op').catch(error => error)
    await entered.promise; const [url, init] = contentCalls(request)[0], original = keyOf(url, init), owner = session._privateIdentityGeneration
    csrf = 'B'; await identity.refresh(); await session._capabilitiesPromise
    expect(session._privateIdentityGeneration).toBe(owner)
    expect(await pending).toMatchObject({ status: 'unknown', operationId: 'export-op' })
    await session.queryConversion('export-op'); expect((await session.downloadConversion('export-op')).downloadOperationId).toBe(original)
    expect(contentCalls(request).map(([, call]) => call.method)).toEqual(['POST', 'GET']); expect(init.signal.aborted).toBe(true)
  })
  it.each(['response', 'body', 'digest'])('取件%s阶段失去export权限不交付bytes，恢复后只GET原键', async boundary => {
    let allowed = true, first = true
    const read = vi.fn(async () => { if (first && boundary === 'body') { first = false; allowed = false } return bytes.buffer })
    if (boundary === 'digest') {
      const original = globalThis.crypto
      vi.stubGlobal('crypto', { getRandomValues: array => original.getRandomValues(array), subtle: { digest: async (...args) => {
        const result = await original.subtle.digest(...args); if (first) { first = false; allowed = false } return result
      } } })
    }
    const { port, request } = await harness(async () => {
      if (first && boundary === 'response') { first = false; allowed = false }
      return { status: 200, arrayBuffer: read }
    }, { getCapabilities: () => ({ canView: true, canExport: allowed }) })
    const error = await port.downloadConversion('export-op').catch(value => value)
    expect(error).toMatchObject({ code: 'CONVERSION_FORBIDDEN', status: 'unknown', operationId: 'export-op' }); expect(error.bytes).toBeUndefined()
    if (boundary === 'response') expect(read).not.toHaveBeenCalled()
    allowed = true
    expect((await port.downloadConversion('export-op')).downloadOperationId).toBe(error.downloadOperationId)
    expect(contentCalls(request).map(([, call]) => call.method)).toEqual(['POST', 'GET'])
  })
  it('capability getter触发身份reset时，在真正HTTP之前再次检查scope', async () => {
    let enabled = false, checks = 0, port
    const h = await harness(undefined, { getCapabilities: () => {
      if (enabled && ++checks === 3) port.resetConversions('identity-changed')
      return { canView: true, canExport: true }
    } }); port = h.port; enabled = true
    await expect(port.downloadConversion('export-op')).rejects.toMatchObject({ code: 'CONVERSION_CONTEXT_CHANGED' })
    expect(contentCalls(h.request)).toHaveLength(0)
  })
  it.each([0, -1, 1, Number.NaN])('非法或超出大小上限%s在HTTP前拒绝，不创建下载键', async maxDownloadBytes => {
    const { port, request } = await harness(undefined, { maxDownloadBytes })
    await expect(port.downloadConversion('export-op')).rejects.toMatchObject({ code: 'CONVERSION_OUTPUT_LIMIT' })
    expect(contentCalls(request)).toHaveLength(0); expect(port.getConversionOperation('export-op').download).toBeUndefined()
  })
  it('缺CSRF在HTTP前拒绝，不生成无法恢复的空下载意图', async () => {
    let csrf = 'bootstrap-csrf'
    const { port, request } = await harness(undefined, { csrfToken: () => csrf })
    csrf = null
    await expect(port.downloadConversion('export-op')).rejects.toMatchObject({ code: 'CSRF_REQUIRED' })
    expect(contentCalls(request)).toHaveLength(0); expect(port.getConversionOperation('export-op').download).toBeUndefined()
  })
  it.each(['length', 'checksum', 'byte-limit'])('实际字节%s校验失败不交付，也只能GET同原键', async invalid => {
    let first = true
    const bad = invalid === 'checksum' ? new Uint8Array(bytes.length).fill(65) : new Uint8Array(invalid === 'length' ? 1 : bytes.length + 1)
    const { port, request } = await harness(async () => {
      if (!first) return binary()
      first = false; return { status: 200, arrayBuffer: async () => bad.buffer }
    }, { maxDownloadBytes: bytes.length })
    const error = await port.downloadConversion('export-op').catch(value => value)
    expect(error).toMatchObject({ code: 'CONVERSION_OUTPUT_CORRUPT', status: 'unknown', operationId: 'export-op' }); expect(error.bytes).toBeUndefined()
    expect(port.getConversionOperation('export-op').download).toEqual({ id: error.downloadOperationId, status: 'unknown' })
    expect((await port.downloadConversion('export-op')).downloadOperationId).toBe(error.downloadOperationId)
    expect(contentCalls(request).map(([, call]) => call.method)).toEqual(['POST', 'GET'])
  })
  it('arrayBuffer超时后迟到字节不能complete，重试仍GET原键', async () => {
    vi.useFakeTimers()
    const held = deferred(), entered = deferred()
    let first = true
    const { port, request } = await harness(async () => {
      if (!first) return binary()
      first = false; return { status: 200, arrayBuffer: async () => { entered.resolve(); return held.promise } }
    })
    const pending = port.downloadConversion('export-op').catch(error => error)
    await entered.promise; const [url, init] = contentCalls(request)[0], original = keyOf(url, init)
    await vi.advanceTimersByTimeAsync(15000)
    expect(await pending).toMatchObject({ status: 'unknown', downloadOperationId: original }); expect(init.signal.aborted).toBe(true)
    held.resolve(bytes.buffer); await vi.advanceTimersByTimeAsync(0)
    expect(port.getConversionOperation('export-op').download).toEqual({ id: original, status: 'unknown' })
    expect((await port.downloadConversion('export-op')).downloadOperationId).toBe(original)
    expect(contentCalls(request).map(([, call]) => call.method)).toEqual(['POST', 'GET'])
  })
  it('digest计算途中超时，迟hash不能把unknown写成complete或触发新POST', async () => {
    vi.useFakeTimers()
    const originalCrypto = globalThis.crypto, held = deferred(), entered = deferred()
    let first = true
    vi.stubGlobal('crypto', { getRandomValues: array => originalCrypto.getRandomValues(array), subtle: { digest: (...args) => {
      if (!first) return originalCrypto.subtle.digest(...args)
      first = false; entered.resolve(); return held.promise
    } } })
    const { port, request } = await harness()
    const pending = port.downloadConversion('export-op').catch(error => error)
    await entered.promise; const [url, init] = contentCalls(request)[0], original = keyOf(url, init)
    await vi.advanceTimersByTimeAsync(15000)
    expect(await pending).toMatchObject({ status: 'unknown', downloadOperationId: original })
    held.resolve(await originalCrypto.subtle.digest('SHA-256', bytes)); await vi.advanceTimersByTimeAsync(0)
    expect(port.getConversionOperation('export-op').download).toEqual({ id: original, status: 'unknown' })
    expect((await port.downloadConversion('export-op')).downloadOperationId).toBe(original)
    expect(contentCalls(request).map(([, call]) => call.method)).toEqual(['POST', 'GET'])
  })
})

describe('T107受控转换任务（E1，非真实转换服务）', () => {
  const bytes = new TextEncoder().encode('approved synthetic output')
  const task = (status, extra = {}) => ({ status, operation: 'export', operationId: 'export-op', tenantId: 'tenant', docId: 'doc', requestHash,
    requestedFormat: 'docx', persisted: true, taskId: 'export-op', sourceVerified: true, source: diffSource(), code: null,
    ...(status === 'ready' ? { output: { mimeType: 'application/octet-stream', sizeBytes: String(bytes.length), checksum: sha(bytes) } } : {}), ...extra })
  it('pending保原键，GET ready后真实取件并核完整内容hash，不接downloadUrl', async () => {
    const request = vi.fn().mockResolvedValueOnce(response(task('pending'))).mockResolvedValueOnce(response(task('ready')))
      .mockResolvedValueOnce({ status: 200, arrayBuffer: async () => bytes.buffer })
    const provider = converting(request)
    expect((await provider.requestExport({ operationId: 'export-op', versionId: 'version:one', format: 'docx' })).status).toBe('pending')
    expect(() => provider.queryConversion({ operationId: 'export-op', requestHash: sha('other intent') })).toThrow('IDEMPOTENCY_MISMATCH')
    expect((await provider.queryConversion('export-op')).status).toBe('ready')
    const output = await provider.downloadConversion('export-op')
    expect(output.bytes).toEqual(bytes); expect(output.checksum).toBe(sha(bytes))
    expect(request.mock.calls.map(([, init]) => init.method)).toEqual(['POST', 'GET', 'GET'])
    expect(request.mock.calls[2][0]).toContain('/export-operations/export-op/content?requestHash=')
  })
  it('晚到task在reset后不得恢复旧身份缓存', async () => {
    let finish
    const provider = converting(() => new Promise(resolve => { finish = resolve }))
    const pending = provider.requestExport({ operationId: 'export-op', versionId: 'version:one', format: 'docx' })
    provider.resetConversions('identity-changed'); finish(response(task('ready')))
    await expect(pending).rejects.toMatchObject({ code: 'CONVERSION_CONTEXT_CHANGED' })
    expect(provider.getConversionOperation('export-op')).toBeNull()
  })
  it('实际下载hash不符不交付bytes；当前export撤销后不再发取件请求', async () => {
    let allowed = true
    const request = vi.fn().mockResolvedValueOnce(response(task('ready'))).mockResolvedValueOnce({ status: 200, arrayBuffer: async () => new Uint8Array([1]).buffer })
    const provider = converting(request, { getCapabilities: () => ({ canView: true, canExport: allowed }) })
    await provider.requestExport({ operationId: 'export-op', versionId: 'version:one', format: 'docx' })
    await expect(provider.downloadConversion('export-op')).rejects.toMatchObject({ code: 'CONVERSION_OUTPUT_CORRUPT' })
    allowed = false
    await expect(provider.downloadConversion('export-op')).rejects.toMatchObject({ code: 'CONVERSION_FORBIDDEN' })
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('切格式查询旧任务仍按原任务格式下载，失败终态不锁住其他格式', async () => {
    const anchor = { click: vi.fn(), href: '', download: '' }, OriginalURL = globalThis.URL
    vi.stubGlobal('document', { createElement: () => anchor })
    vi.stubGlobal('URL', class extends OriginalURL { static createObjectURL() { return 'blob:synthetic' } static revokeObjectURL() {} })
    const remote = { requiresDurableConfirmation: true }
    const session = { getProvider: () => remote, requestExport: vi.fn(), queryConversion: vi.fn(async () => ({ status: 'ready', operationId: 'export-op', requestedFormat: 'docx' })),
      downloadConversion: vi.fn(async () => ({ bytes, mimeType: 'application/octet-stream' })) }
    const vm = { ...exportMixin.data(), ...exportMixin.methods, session, exportCanExport: true, exportFileBaseName: 'document', exportPendingOperationId: 'export-op', _pendingExportProvider: remote }
    try {
      await vm.submitRemoteExport('pdf')
      expect(anchor.download).toBe('document.docx'); expect(anchor.click).toHaveBeenCalledTimes(1); expect(session.requestExport).not.toHaveBeenCalled()
      vm.exportPendingOperationId = 'failed-op'; session.queryConversion.mockResolvedValueOnce({ status: 'failed', operationId: 'failed-op' })
      await vm.submitRemoteExport('pdf'); expect(vm.exportPendingOperationId).toBe('')
    } finally { vi.unstubAllGlobals() }
  })

  it('远端导出提交先关闭设置弹窗并显示统一处理中提示', async () => {
    const remote = { requiresDurableConfirmation: true }
    const session = { user: { id: 'alice' }, _conversionGeneration: 0, getProvider: () => remote,
      requestExport: vi.fn(async () => ({ status: 'pending', operationId: 'export-pending' })) }
    const vm = { ...exportMixin.data(), ...exportMixin.methods, session, exportCanExport: true,
      exportFormatDef: { id: 'word', extension: 'docx' }, exportOpen: true,
      closeExportDialog: exportMixin.methods.closeExportDialog, exportFileBaseName: 'document' }
    await vm.submitExport()
    expect(vm.exportOpen).toBe(false)
    expect(vm.exportToast).toBe('导出任务处理中；再次点击查询原任务。')
    expect(vm.exportPendingOperationId).toBe('export-pending')
  })
})

describe('T107原导出按钮跨身份晚回', () => {
  it.each(['command', 'download'])('%s await中换身份，旧ready/unknown不触发文件或覆盖当前提示', async phase => {
    for (const outcome of ['ready', 'unknown']) {
      let finish, fail
      const held = new Promise((resolve, reject) => { finish = resolve; fail = reject })
      const remote = { requiresDurableConfirmation: true }, session = { user: { id: 'alice' }, getProvider: () => remote,
        requestExport: vi.fn(() => phase === 'command' ? held : Promise.resolve({ status: 'ready', operationId: 'export-op', requestedFormat: 'docx' })),
        downloadConversion: vi.fn(() => held) }
      const vm = { ...exportMixin.data(), ...exportMixin.methods, session, exportCanExport: true, exportFileBaseName: 'document' }
      const pending = vm.submitRemoteExport('docx')
      await vi.waitFor(() => expect(phase === 'command' ? session.requestExport : session.downloadConversion).toHaveBeenCalledOnce())
      session.user = { id: 'bob' }; exportMixin.watch['session.user.id'].call(vm, 'bob', 'alice'); vm.exportToast = 'current view'
      if (outcome === 'ready') finish(phase === 'command' ? { status: 'ready', operationId: 'export-op', requestedFormat: 'docx' } : { bytes: new Uint8Array([1]), mimeType: 'application/octet-stream' })
      else fail(Object.assign(new Error('lost'), { status: 'unknown', operationId: 'export-op' }))
      expect(await pending).toBeNull(); expect(vm.exportToast).toBe('current view'); expect(vm.exportPendingOperationId).toBe('')
      if (phase === 'command') expect(session.downloadConversion).not.toHaveBeenCalled()
      expect(vm.exportBusy).toBe(false)
    }
  })
})

describe('same identity authorization refresh conversion recovery', () => {
  it.each(['capability refresh', 'provider replacement', 'principal ABA'])('does not start a conversion when %s happens while its lazy module is loading', async boundary => {
    const port = { list() {}, createSnapshot() {}, get() {}, restore() {}, requestImport: vi.fn() }
    const session = createDocumentSession({ user: { id: 'alice' }, versioning: port,
      authorization: { async getCapabilities() { return { canView: true, canEdit: true } } } })
    try {
      await session._capabilitiesPromise
      const pending = session.requestImport({ format: 'docx' }).catch(error => error)
      if (boundary === 'capability refresh') await session.refreshCapabilities()
      else if (boundary === 'provider replacement') session.setProvider('versioning', { ...port })
      else { session.user = { id: 'bob' }; session.user = { id: 'alice' } }
      expect(await pending).toBeInstanceOf(Error); expect(port.requestImport).not.toHaveBeenCalled()
    } finally { await session.dispose() }
  })
  it('actual identity CSRF renewal keeps the interrupted conversion query-only through the Session', async () => {
    let token = 'A', finish, entered
    const started = new Promise(resolve => { entered = resolve })
    const identity = createHttpIdentityProvider({ tenantId: 'tenant', docId: 'doc', request: async () => ({ status: 200,
      headers: { get: () => 'application/json' }, json: async () => ({ status: 'authenticated', principalId: 'alice', canCreate: false,
        csrfToken: token.repeat(43), refreshAfterMs: 1000, expiresInMs: 4000 }) }) })
    await identity.login({ operationId: 'renewal-login', loginCode: 'fixture-only-renewal-code' })
    const request = vi.fn(async (_url, init) => {
      if (init.method === 'POST') { entered(); return new Promise(resolve => { finish = resolve }) }
      return response(conversionBlocked('import'), 503)
    })
    let session
    const port = converting(request, { csrfToken: () => identity.getCsrfToken(), getCapabilities: () => session.getCapabilities() })
    session = createDocumentSession({ documentId: 'doc', identity, versioning: port,
      authorization: { async getCapabilities() { return { canView: true, canEdit: true, canExport: true } } } })
    try {
      await session._capabilitiesPromise
      const privateGeneration = session._privateIdentityGeneration
      const pending = session.requestImport({ operationId: 'import-op', format: 'docx' }).catch(error => error)
      await started; token = 'B'; await identity.refresh(); await session._capabilitiesPromise
      expect(session._privateIdentityGeneration).toBe(privateGeneration)
      expect(await pending).toMatchObject({ status: 'unknown', operationId: 'import-op' })
      expect(await session.queryConversion('import-op')).toMatchObject({ status: 'blocked', operationId: 'import-op' })
      finish(response(conversionBlocked('import'), 503)); await Promise.resolve()
      expect(request.mock.calls.map(([, init]) => init.method)).toEqual(['POST', 'GET'])
      expect(request.mock.calls[0][1].signal.aborted).toBe(true)
    } finally { await session.dispose() }
  })
  it.each(['requestImport', 'requestExport', 'queryConversion', 'downloadConversion'].flatMap(method => ['resolve', 'reject'].map(outcome => [method, outcome])))('Session retains the original key when %s %s crosses a capability refresh', async (method, outcome) => {
    let finish, fail
    const port = { list() {}, createSnapshot() {}, get() {}, restore() {}, [method]: vi.fn(() => new Promise((resolve, reject) => { finish = resolve; fail = reject })) }
    const session = createDocumentSession({ documentId: 'doc', user: { id: 'alice' }, versioning: port,
      authorization: { async getCapabilities() { return { canView: true, canEdit: true, canExport: true } } } })
    try {
      await session._capabilitiesPromise
      const input = method === 'queryConversion' || method === 'downloadConversion' ? 'original-conversion' : { format: 'docx' }
      const pending = session[method](input).catch(error => error)
      await vi.waitFor(() => expect(port[method]).toHaveBeenCalledOnce())
      await session.refreshCapabilities()
      if (outcome === 'reject') fail(Object.assign(new Error('private converter failure'), { operationId: 'original-conversion', bytes: new Uint8Array([1]) }))
      else finish(method === 'downloadConversion' ? { bytes: new Uint8Array([1]) } : { status: 'pending', operationId: 'original-conversion' })
      const error = await pending
      expect(error).toMatchObject({ code: 'CONVERSION_CONTEXT_CHANGED', status: 'unknown', operationId: 'original-conversion' })
      expect(error.bytes).toBeUndefined(); expect(port[method]).toHaveBeenCalledOnce()
    } finally { await session.dispose() }
  })
  it.each(['unknown', 'principal ABA', 'identity provider', 'versioning provider', 'disposed'])('Session does not retain a conversion key across %s', async boundary => {
    let finish
    const port = converting(() => new Promise(resolve => { finish = resolve }))
    const h = versionIdentitySession(port, { canView: true, canEdit: true, canExport: true })
    try {
      await h.session._capabilitiesPromise
      const pending = h.session.requestImport({ operationId: 'import-op', format: 'docx' }).catch(error => error)
      await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
      if (boundary === 'unknown') { await h.change(null); await h.change('alice') }
      else if (boundary === 'principal ABA') { await h.change('bob'); await h.change('alice') }
      else if (boundary === 'identity provider') { h.session.setProvider('identity', { ...h.identity }); await h.session._capabilitiesPromise }
      else if (boundary === 'versioning provider') { h.session.setProvider('versioning', converting(async () => response({}))); h.session.setProvider('versioning', port) }
      else await h.session.dispose()
      finish(response(conversionBlocked('import'), 503))
      const error = await pending
      expect(error).toBeInstanceOf(Error); expect(error.operationId).toBeUndefined(); expect(error.bytes).toBeUndefined()
      expect(() => port.queryConversion('import-op')).toThrow(/(?:VERSION|CONVERSION)_CONTEXT_CHANGED/)
    } finally { await h.session.dispose() }
  })
  it('aborts the old POST, keeps only query metadata and uses GET after current authorization', async () => {
    const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes }); return { promise, resolve } }
    const gate = deferred(), entered = deferred()
    const request = vi.fn(async (_url, init) => { if (init.method === 'POST') { entered.resolve(); return gate.promise } return response(conversionBlocked('import'), 503) })
    const port = converting(request), pending = port.requestImport({ operationId: 'import-op', format: 'docx' }).catch(error => error)
    await entered.promise; port.reset('authorization-required')
    expect(await pending).toMatchObject({ status: 'unknown', operationId: 'import-op' })
    expect(port.getConversionOperation('import-op')).toBeNull()
    expect(() => port.requestImport({ operationId: 'import-op', format: 'docx' })).toThrow('CONVERSION_QUERY_REQUIRED')
    expect(await port.queryConversion('import-op')).toMatchObject({ status: 'blocked', operationId: 'import-op' })
    gate.resolve(response(conversionBlocked('import'), 503)); await Promise.resolve()
    expect(request.mock.calls.map(call => call[1].method)).toEqual(['POST', 'GET'])
    port.reset('identity-changed')
    expect(() => port.queryConversion('import-op')).toThrow('CONVERSION_CONTEXT_CHANGED')
    port.dispose()
  })
  it('requires renewed read permission for the original GET, and never turns read-only recovery into export permission', async () => {
    let finishAuthorization, allowed = true
    const request = vi.fn(async () => response(conversionBlocked('export'), 503))
    let session
    const port = converting(request, { getCapabilities: () => session.getCapabilities() })
    session = createDocumentSession({ user: { id: 'alice' }, versioning: port,
      authorization: { getCapabilities: async () => allowed ? { canView: true, canExport: true } : new Promise(resolve => { finishAuthorization = resolve }) } })
    try {
      await session._capabilitiesPromise
      request.mockRejectedValueOnce(new Error('lost ACK'))
      await expect(session.requestExport({ operationId: 'export-op', versionId: 'version:one', format: 'docx' })).rejects.toMatchObject({ operationId: 'export-op', status: 'unknown' })
      allowed = false; const refresh = session.refreshCapabilities()
      await expect(session.queryConversion('export-op')).rejects.toBeInstanceOf(Error)
      expect(request).toHaveBeenCalledOnce()
      finishAuthorization({ canView: true, canExport: false }); await refresh
      expect(await session.queryConversion('export-op')).toMatchObject({ status: 'blocked', operationId: 'export-op' })
      await expect(session.downloadConversion('export-op')).rejects.toBeInstanceOf(Error)
      expect(request.mock.calls.map(([, init]) => init.method)).toEqual(['POST', 'GET'])
    } finally { await session.dispose() }
  })
})

describe('T107导出请求所有权', () => {
  it('provider替换晚回能释放自己的busy，不解锁替换后新请求；ABA不复活旧结果', async () => {
    let oldFinish, newFinish, latestFinish
    const old = new Promise(resolve => { oldFinish = resolve }), next = new Promise(resolve => { newFinish = resolve }), latest = new Promise(resolve => { latestFinish = resolve })
    const first = { requiresDurableConfirmation: true }, second = { requiresDurableConfirmation: true }; let provider = first
    const session = { user: { id: 'alice' }, getProvider: () => provider, requestExport: vi.fn().mockReturnValueOnce(old).mockReturnValueOnce(next).mockReturnValueOnce(latest) }
    const vm = { ...exportMixin.data(), ...exportMixin.methods, session, exportCanExport: true }
    const pending = vm.submitRemoteExport('docx'); await vi.waitFor(() => expect(session.requestExport).toHaveBeenCalledTimes(1))
    provider = second
    oldFinish({ status: 'failed' }); await pending
    expect(vm.exportBusy).toBe(false)
    provider = first; vm.clearRemoteExport()
    const newer = vm.submitRemoteExport('pdf'); await vi.waitFor(() => expect(session.requestExport).toHaveBeenCalledTimes(2))
    expect(vm.exportBusy).toBe(true)
    vm.clearRemoteExport(); provider = second; provider = first
    const current = vm.submitRemoteExport('docx'); await vi.waitFor(() => expect(session.requestExport).toHaveBeenCalledTimes(3))
    vm.exportToast = 'new intent'
    newFinish({ status: 'unknown', operationId: 'old-epoch-op' }); await newer
    expect(vm.exportBusy).toBe(true); expect(vm.exportToast).toBe('new intent'); expect(vm.exportPendingOperationId).toBe('')
    latestFinish({ status: 'failed' }); await current; expect(vm.exportBusy).toBe(false)
  })
})

describe('US12真实差异与转换阻塞（E1端口注入，不代替PG/文件验收）', () => {
  it('diff只POST两个不可变ID，完整显示文本/结构值，不上传当前JSON或伪造job', async () => {
    const request = vi.fn(async () => response(realDiff()))
    const value = await converting(request).diff('version:one', 'version:two')
    expect(value).toMatchObject({ status: 'completed', identical: false, persisted: false, taskId: null })
    expect(value.changes[0]).toMatchObject({ before: '冻结A', after: '冻结B' })
    expect(formatVersionDiffValue(value.changes[1].after)).toBe('"<img src=x onerror=alert(1)>"')
    expect(Object.isFrozen(value.changes)).toBe(true)
    expect(request.mock.calls[0][0]).toBe('/editor/v1/tenants/tenant/documents/doc/version-diff-operations')
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ fromVersionId: 'version:one', toVersionId: 'version:two' })
    expect(request.mock.calls[0][1].headers['Idempotency-Key']).toBeUndefined()
  })

  it.each([
    { docId: 'other' }, { from: diffSource({ versionId: 'other' }) }, { identical: true },
    { changes: [{ path: '/bad~2escape', kind: 'replace', before: 1, after: 2 }] },
    { changes: [{ path: '/text', kind: 'add', before: 'not-allowed', after: 'B' }] },
    { changes: [{ path: '/text', kind: 'replace', before: undefined, after: 'B' }] },
  ])('异来源/畸形pointer/非JSON不显示部分差异 %j', async invalid => {
    await expect(converting(async () => response(realDiff(invalid))).diff('version:one', 'version:two')).rejects.toMatchObject({ code: 'VERSION_DIFF_INVALID' })
  })

  it('超限明确失败，不回退块数摘要或截断结果', async () => {
    await expect(converting(async () => response({ code: 'PG_CONVERSION_LIMIT' }, 413)).diff('version:one', 'version:two')).rejects.toMatchObject({ code: 'PG_CONVERSION_LIMIT', status: 413 })
    expect(() => normalizeRemoteVersionDiff(realDiff({ changes: [{ path: 'wrong', kind: 'remove', before: {} }] }),
      { tenantId: 'tenant', docId: 'doc', fromVersionId: 'version:one', toVersionId: 'version:two' })).toThrow('VERSION_DIFF_INVALID')
  })

  it('import只核当前epoch/revision，文件未验证则保持blocked，不能本地setContent成功', async () => {
    const request = vi.fn(async () => response(conversionBlocked('import'), 503))
    const provider = converting(request)
    const value = await provider.requestImport({ operationId: 'import-op', format: 'docx', content: { forged: true }, file: { name: 'local.docx' }, actor: 'forged' })
    expect(value).toMatchObject({ status: 'blocked', sourceVerified: false, persisted: false, taskId: null, formatApproved: false })
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ operationId: 'import-op', expectedEpoch: '1', expectedRevision: '7', format: 'docx' })
    expect(value.receipt).toBeUndefined()
    expect(provider.getConversionOperation('import-op').status).toBe('blocked')
  })

  it('export固定version/hash；缺显式ID时只能选匹配当前committed来源，不猜最新', async () => {
    const request = vi.fn(async url => response(url.endsWith('/versions') ? [meta()] : conversionBlocked('export'), url.endsWith('/versions') ? 200 : 503))
    const value = await converting(request).requestExport({ operationId: 'export-op', format: 'docx' })
    expect(value).toMatchObject({ status: 'blocked', sourceVerified: true, source: diffSource(), taskId: null })
    expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({ operationId: 'export-op', versionId: 'version:one', format: 'docx' })
    expect(value.downloadUrl).toBeUndefined()
    const wrong = vi.fn(async () => response([meta({ sourceRevision: '8' })]))
    await expect(converting(wrong).requestExport({ operationId: 'export-op', format: 'docx' })).rejects.toMatchObject({ code: 'CONVERSION_IMMUTABLE_SOURCE_REQUIRED' })
    expect(wrong).toHaveBeenCalledTimes(1)
  })

  it('转换unknown只GET原kind/body；换格式/来源不自动换ID或重POST', async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce(response(conversionBlocked('import'), 503))
    const provider = converting(request)
    const input = { operationId: 'import-op', format: 'docx' }
    await expect(provider.requestImport(input)).rejects.toMatchObject({ status: 'unknown', operationId: 'import-op' })
    expect(() => provider.requestImport({ ...input, format: 'pdf' })).toThrow('IDEMPOTENCY_MISMATCH')
    expect(() => provider.queryConversion({ operationId: 'import-op', expectedEpoch: '2' })).toThrow('IDEMPOTENCY_MISMATCH')
    expect((await provider.queryConversion('import-op')).persisted).toBe(false)
    const [url, init] = request.mock.calls[1]
    expect(init.method).toBe('GET')
    expect(new URL(`https://local.invalid${url}`).searchParams.get('expectedEpoch')).toBe('1')
    expect(request.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1)
  })

  it.each([
    response({ status: 'completed', downloadUrl: 'https://fake/file' }),
    response(conversionBlocked('import', { sourceVerified: true }), 503),
    response(conversionBlocked('import', { persisted: true, taskId: 'fake' }), 503),
  ])('未供给转换不能接受假下载/文件验证/任务 %j', async incoming => {
    const provider = converting(async () => incoming)
    await expect(provider.requestImport({ operationId: 'import-op', format: 'docx' })).rejects.toMatchObject({ status: 'unknown' })
    expect(JSON.stringify(provider.getConversionOperation('import-op'))).not.toMatch(/downloadUrl|fake/)
  })

  it('远端导出入口不读active JSON、不走markdown/docx/pdf本地产物', async () => {
    const remote = { requiresDurableConfirmation: true }
    const handler = vi.fn(async () => conversionBlocked('export'))
    const vm = { ...exportMixin.data(), ...exportMixin.methods, session: { getProvider: () => remote }, exportCanExport: true,
      exportFormatDef: { id: 'word', extension: 'docx' }, submitRemoteExport: handler, currentDoc: vi.fn(() => { throw new Error('active-json-must-not-be-exported') }) }
    await vm.submitExport(); await vm.dispatchMarkdown('all', 'x'); await vm.dispatchDocx('contentOnly', 'x'); await vm.dispatchPdf('contentOnly', 'x')
    expect(handler.mock.calls.map(([format]) => format)).toEqual(['docx', 'md', 'docx', 'pdf'])
    expect(vm.currentDoc).not.toHaveBeenCalled()
  })

  it('关闭/切换历史后晚到diff不能恢复旧视图', async () => {
    let finish
    const remote = { requiresDurableConfirmation: true, diff: () => {} }
    const vm = { ...versioningMixin.data(), ...versioningMixin.methods, versionProvider: remote, versionRemoteDiff: true,
      versionPanelOpen: true, versionShowChanges: true, versionSelectedId: 'version:two', versionList: [{ id: 'version:two' }, { id: 'version:one' }],
      session: { diffVersions: () => new Promise(resolve => { finish = resolve }) } }
    const pending = vm.loadVersionDiff()
    vm.closeVersionPanel(); finish(realDiff())
    await pending
    expect(vm.versionDiff).toBeNull()
    expect(vm.versionShowChanges).toBe(false)
  })
})


describe('T107/T108 Workspace受控转换UI接续（E1）', () => {
  const source = readFileSync(new URL('../../src/components/lark-doc/LarkDocWorkspace.vue', import.meta.url), 'utf8')
  const methodsSource = source.slice(source.indexOf('    bindRemoteConversionSession() {'), source.indexOf('    featureEnabled(name) {'))
  function workspaceVm(overrides = {}, load = async () => ({ downloadBlob: vi.fn(), safeFileName: () => 'document' })) {
    const remote = { requiresDurableConfirmation: true }
    const session = { user: { id: 'alice' }, can: () => true, getProvider: () => remote,
      requestExport: vi.fn(), requestImport: vi.fn(), queryConversion: vi.fn(), downloadConversion: vi.fn(), ...overrides }
    // Vue imports stay outside unit closure; the actual methods are evaluated with only the lazy asset loader injected.
    const lazySource = readFileSync(new URL('../../src/utils/remoteConversion.js', import.meta.url), 'utf8').split('export const remoteConversionMethods = ')[1]
    const loaded = async () => {
      const helpers = await load()
      const remoteConversionMethods = new Function('downloadBlob', 'safeFileName', `const remoteConversionMethods = ${lazySource}; return remoteConversionMethods`)(helpers.downloadBlob, helpers.safeFileName)
      return { remoteConversionMethods }
    }
    const methods = new Function('loadImportExport', `return ({${methodsSource.replace(/import\(/g, 'loadImportExport(')}})`)(loaded)
    const vm = { ...methods, documentId: 'doc', title: 'Task', conversionGeneration: 0, conversionBusy: false, conversionPendingId: '', conversionResult: null,
      notice: '', getSession: () => session }
    return { vm, session, remote }
  }
  it('转换组件加载失败不POST，保留已有原请求并提示重试', async () => {
    const { vm, session } = workspaceVm({}, async () => { throw new Error('chunk unavailable') })
    vm.conversionPendingId = 'original-operation'
    expect(await vm.queryRemoteConversion()).toBeNull()
    expect(vm.conversionPendingId).toBe('original-operation')
    expect(session.queryConversion).not.toHaveBeenCalled(); expect(session.requestExport).not.toHaveBeenCalled()
    expect(vm.notice).toMatch(/加载失败/)
  })
  it('same identity capability refresh retains the original unknown key and blocks another conversion POST', async () => {
    const { vm, session } = workspaceVm({ _conversionGeneration: 0, _privateIdentityGeneration: 1,
      requestExport: vi.fn(async () => ({ status: 'unknown', operationId: 'export-op' })), queryConversion: vi.fn(async () => ({ status: 'failed', operationId: 'export-op' })) })
    await vm.runRemoteConversion('export', { format: 'docx' })
    session._conversionGeneration++
    await vm.runRemoteConversion('export', { format: 'pdf' })
    expect(session.requestExport).toHaveBeenCalledOnce(); expect(vm.conversionPendingId).toBe('export-op')
    await vm.queryRemoteConversion(); expect(session.queryConversion).toHaveBeenCalledWith('export-op'); expect(vm.conversionPendingId).toBe('')
  })
  it('authorization interruption from an empty notice keeps a visible generic original-query entrance', async () => {
    let reject
    const held = new Promise((_, no) => { reject = no }), { vm, session } = workspaceVm({ _conversionGeneration: 0, _privateIdentityGeneration: 1,
      requestExport: vi.fn(() => held), queryConversion: vi.fn(async () => ({ status: 'failed', operationId: 'export-op' })) })
    const pending = vm.runRemoteConversion('export', { format: 'docx' })
    await vi.waitFor(() => expect(session.requestExport).toHaveBeenCalledOnce())
    session._conversionGeneration++; session.can = () => false
    reject(Object.assign(Error('cancelled'), { status: 'unknown', operationId: 'export-op' })); await pending
    expect(vm.conversionPendingId).toBe('export-op'); expect(vm.notice).toMatch(/仅可查询原请求/); expect(vm.conversionResult).toBeNull()
    session.can = () => true; await vm.runRemoteConversion('export', { format: 'pdf' }); expect(session.requestExport).toHaveBeenCalledOnce()
    await vm.queryRemoteConversion(); expect(session.queryConversion).toHaveBeenCalledWith('export-op')
  })
  it('Workspace原任务同tick真实Session ABA不由旧unknown回包复活', async () => {
    let fail
    const held = new Promise((_, reject) => { fail = reject }), { vm, remote } = workspaceVm()
    const actual = createDocumentSession({ user: { id: 'alice' } })
    actual.getProvider = () => remote; actual.can = () => true; actual.requestImport = vi.fn(() => held)
    vm.getSession = () => actual
    const pending = vm.runRemoteConversion('import', { format: 'docx' }); await vi.waitFor(() => expect(actual.requestImport).toHaveBeenCalledOnce())
    actual.user = { id: 'bob' }; actual.user = { id: 'alice' }; vm.notice = 'current view'
    fail(Object.assign(new Error('lost'), { status: 'unknown', operationId: 'old-import' })); await pending
    expect(vm.notice).toBe('current view'); expect(vm.conversionPendingId).toBe('')
  })
  const task = (status, operation = 'export', extra = {}) => ({ status, operation, operationId: operation+'-op', requestedFormat: 'docx',
    ...(status === 'ready' && operation === 'import' ? { receipt: { epoch: '1', seq: '8', content_revision: '8' }, reloadRequired: true } : {}), ...extra })
  it.each(['pending', 'unknown'])('%s保原ID，新的导出点击不POST，查询走Session原GET边界', async status => {
    const { vm, session } = workspaceVm({ requestExport: vi.fn(async () => task(status)), queryConversion: vi.fn(async () => task('failed')) })
    await vm.runRemoteConversion('export', { format: 'docx' })
    expect(vm.conversionPendingId).toBe('export-op'); expect(vm.notice).not.toMatch(/依赖未接通/)
    await vm.runRemoteConversion('export', { format: 'pdf' })
    expect(session.requestExport).toHaveBeenCalledOnce()
    await vm.queryRemoteConversion()
    expect(session.queryConversion).toHaveBeenCalledWith('export-op')
    expect(session.requestExport).toHaveBeenCalledOnce(); expect(vm.conversionPendingId).toBe('')
    expect(vm.notice).toMatch(/任务失败/)
    await vm.runRemoteConversion('export', { format: 'pdf' }); expect(session.requestExport).toHaveBeenCalledTimes(2)
  })
  it('ready import显示真实receipt与重开要求，不再误报blocked或本地替换正文', async () => {
    const { vm, session } = workspaceVm({ requestImport: vi.fn(async () => task('ready', 'import')) })
    await vm.runRemoteConversion('import', { format: 'docx', assetId: 'asset:one' })
    expect(vm.conversionResult.receipt).toMatchObject({ seq: '8' }); expect(vm.conversionPendingId).toBe('')
    expect(vm.notice).toMatch(/导入已提交.*epoch 1.*seq 8.*重新打开/)
    expect(session.downloadConversion).not.toHaveBeenCalled()
  })
  it('ready export仅下载Session核验字节，用原任务格式而非后来选择格式', async () => {
    const downloadBlob = vi.fn(), bytes = new Uint8Array([1, 2, 3])
    const { vm, session } = workspaceVm({ requestExport: vi.fn(async () => task('pending')), queryConversion: vi.fn(async () => task('ready')),
      downloadConversion: vi.fn(async () => ({ bytes, mimeType: 'application/octet-stream' })) }, async () => ({ downloadBlob, safeFileName: () => 'safe-name' }))
    await vm.runRemoteConversion('export', { format: 'docx' }); await vm.runRemoteConversion('export', { format: 'pdf' }); await vm.queryRemoteConversion()
    expect(session.requestExport).toHaveBeenCalledOnce(); expect(session.downloadConversion).toHaveBeenCalledWith('export-op')
    expect(downloadBlob).toHaveBeenCalledOnce(); expect(downloadBlob.mock.calls[0][1]).toBe('safe-name.docx')
    expect(new Uint8Array(await downloadBlob.mock.calls[0][0].arrayBuffer())).toEqual(bytes)
    expect(vm.conversionPendingId).toBe(''); expect(vm.notice).toMatch(/已校验.*发起下载/)
  })
  it('下载校验失败不downloadBlob，保原ID只可GET重查', async () => {
    const downloadBlob = vi.fn(), { vm, session } = workspaceVm({ requestExport: vi.fn(async () => task('ready')),
      downloadConversion: vi.fn(async () => { throw Object.assign(new Error('hash mismatch'), { code: 'CONVERSION_OUTPUT_CORRUPT' }) }),
      queryConversion: vi.fn(async () => task('pending')) }, async () => ({ downloadBlob, safeFileName: () => 'safe' }))
    await vm.runRemoteConversion('export', { format: 'docx' })
    expect(downloadBlob).not.toHaveBeenCalled(); expect(vm.conversionPendingId).toBe('export-op')
    await vm.queryRemoteConversion(); expect(session.queryConversion).toHaveBeenCalledWith('export-op'); expect(session.requestExport).toHaveBeenCalledOnce()
  })
  const changes = ['provider', 'session', 'identity', 'dispose', 'document', 'view permission', 'reset']
  function changeScope(name, vm, session) {
    if (name === 'provider') session.getProvider = () => ({ requiresDurableConfirmation: true })
    if (name === 'session') vm.getSession = () => ({ ...session })
    if (name === 'identity') session.user = { id: 'bob' }
    if (name === 'dispose') vm._disposed = true
    if (name === 'document') vm.documentId = 'other'
    if (name === 'view permission') session.can = () => false
    if (name === 'reset') vm.clearRemoteConversion()
  }
  it.each(changes)('请求晚到%s不显示旧ready/unknown状态', async change => {
    for (const outcome of ['ready', 'unknown error']) {
      let finish, fail
      const held = new Promise((resolve, reject) => { finish = resolve; fail = reject })
      const { vm, session } = workspaceVm({ requestImport: vi.fn(() => held) })
      const pending = vm.runRemoteConversion('import', { format: 'docx' })
      await vi.waitFor(() => expect(session.requestImport).toHaveBeenCalledOnce())
      changeScope(change, vm, session); vm.notice = 'current view'
      if (outcome === 'ready') finish(task('ready', 'import'))
      else fail(Object.assign(new Error('lost'), { status: 'unknown', operationId: 'import-op' }))
      expect(await pending).toBeNull(); expect(vm.notice).toBe('current view'); expect(vm.conversionResult).toBeNull()
      if (change !== 'view permission') expect(vm.conversionPendingId).toBe('')
    }
  })
  it.each(changes)('原GET晚到%s不能确认旧pending或发文件', async change => {
    let finish
    const held = new Promise(resolve => { finish = resolve }), downloadBlob = vi.fn()
    const { vm, session } = workspaceVm({ requestExport: vi.fn(async () => task('pending')), queryConversion: vi.fn(() => held) }, async () => ({ downloadBlob, safeFileName: () => 'safe' }))
    await vm.runRemoteConversion('export', { format: 'docx' })
    const pending = vm.queryRemoteConversion(); await vi.waitFor(() => expect(session.queryConversion).toHaveBeenCalledOnce()); changeScope(change, vm, session); vm.notice = 'current view'
    finish(task('ready'))
    expect(await pending).toBeNull(); expect(vm.notice).toBe('current view')
    expect(session.downloadConversion).not.toHaveBeenCalled(); expect(downloadBlob).not.toHaveBeenCalled()
    expect(session.requestExport).toHaveBeenCalledOnce()
  })
  it.each(['download', 'loader'])('ready导出%s await中切身份，零downloadBlob', async phase => {
    let finish, entered
    const held = new Promise(resolve => { finish = resolve }), waiting = new Promise(resolve => { entered = resolve }), downloadBlob = vi.fn()
    const load = phase === 'loader' ? () => { entered(); return held } : async () => ({ downloadBlob, safeFileName: () => 'safe' })
    const { vm, session } = workspaceVm({ requestExport: vi.fn(async () => task('ready')), downloadConversion: phase === 'download'
      ? vi.fn(() => { entered(); return held }) : vi.fn(async () => ({ bytes: new Uint8Array([1]), mimeType: 'application/octet-stream' })) }, load)
    const pending = vm.runRemoteConversion('export', { format: 'docx' }); await waiting
    session.user = { id: 'bob' }; vm.notice = 'current view'
    finish(phase === 'download' ? { bytes: new Uint8Array([1]), mimeType: 'application/octet-stream' } : { downloadBlob, safeFileName: () => 'safe' })
    expect(await pending).toBeNull(); expect(downloadBlob).not.toHaveBeenCalled(); expect(vm.notice).toBe('current view')
    expect(vm.conversionResult).toBeNull()
  })
})


describe('T107同tick真实Session用户ABA', () => {
  it.each(['principal', 'provider'])('a retired remote Session %s event cannot cancel the new Session local export', async event => {
    const remote = { requiresDurableConfirmation: true, list() {}, createSnapshot() {}, get() {}, restore() {},
      async requestExport() { return { status: 'pending', operationId: 'old-key' } } }
    const prior = createDocumentSession({ user: { id: 'alice' }, versioning: remote }), current = createDocumentSession()
    const vm = { ...exportMixin.data(), ...exportMixin.methods, session: prior, exportCanExport: true }
    try {
      await vm.submitRemoteExport('docx'); vm.session = current; exportMixin.watch.session.call(vm)
      const generation = vm.exportGeneration
      vm.exportBusy = true; vm.exportToast = 'new local export'
      if (event === 'principal') prior.user = { id: 'bob' }; else prior.setProvider('versioning', { ...remote })
      expect(vm.exportGeneration).toBe(generation); expect(vm.exportBusy).toBe(true); expect(vm.exportToast).toBe('new local export')
    } finally { vm._exportSessionStops?.forEach(stop => stop()); await prior.dispose(); await current.dispose() }
  })
  it.each(['principal ABA', 'versioning provider ABA'])('export UI synchronously retires its old key on %s but retains it on authorization refresh', async boundary => {
    const remote = { requiresDurableConfirmation: true, list() {}, createSnapshot() {}, get() {}, restore() {},
      async requestExport() { return { status: 'pending', operationId: 'old-key' } } }
    const session = createDocumentSession({ user: { id: 'alice' }, versioning: remote })
    const vm = { ...exportMixin.data(), ...exportMixin.methods, session, exportCanExport: true }
    try {
      await vm.submitRemoteExport('docx')
      expect(vm.exportPendingOperationId).toBe('old-key')
      session._clearPrivateIdentityView('authorization-required')
      expect(vm.exportPendingOperationId).toBe('old-key')
      if (boundary === 'principal ABA') { session.user = { id: 'bob' }; session.user = { id: 'alice' } }
      else { session.setProvider('versioning', { ...remote }); session.setProvider('versioning', remote) }
      expect(vm.exportPendingOperationId).toBe(''); expect(vm.exportToast).toBe('')
    } finally { vm._exportSessionStops?.forEach(stop => stop()); await session.dispose() }
  })
  it('原导出按钮不由旧unknown恢复pending或覆盖现视图', async () => {
    let fail
    const held = new Promise((_, reject) => { fail = reject }), remote = { requiresDurableConfirmation: true }
    const session = createDocumentSession({ user: { id: 'alice' } })
    session.getProvider = () => remote; session.requestExport = vi.fn(() => held)
    const vm = { ...exportMixin.data(), ...exportMixin.methods, session, exportCanExport: true }
    const pending = vm.submitRemoteExport('docx'); await vi.waitFor(() => expect(session.requestExport).toHaveBeenCalledOnce())
    session.user = { id: 'bob' }; session.user = { id: 'alice' }; vm.exportToast = 'current view'
    fail(Object.assign(new Error('lost'), { status: 'unknown', operationId: 'old-op' })); await pending
    expect(vm.exportToast).toBe('current view'); expect(vm.exportPendingOperationId).toBe('')
  })
})


describe('HTTP versioning private context reset', () => {
  const held = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
  const observe = promise => promise.then(value => ({ value }), error => ({ error }))
  const configured = (request, extra = {}) => create(request, { getState: () => ({ status: 'ready', epoch: '1', revision: '7', lastSeq: '7', pending: [] }),
    getCapabilities: () => ({ canView: true, canEdit: true, canExport: true, canRestoreVersion: true }), isolateDocument: vi.fn(), ...extra })
  it('reset removes version/restore results and target hashes; old IDs cannot POST and a new restore must refetch the target', async () => {
    let deny = false
    const isolate = vi.fn(), request = vi.fn(async (url, init) => url.includes('/versions/') ? response(deny ? {} : full(), deny ? 404 : 200)
      : url.includes('/restore-operations') ? response({ status: 'unknown', operationId: 'reset-restore' }, 503) : response(committed(), 201))
    const port = configured(request, { isolateDocument: isolate }); await port.get('version:one')
    await port.createSnapshot({ operationId: 'version-op', label: 'A' }); await port.restore('version:one', { operationId: 'reset-restore' })
    expect(isolate).toHaveBeenCalledOnce(); port.reset('identity-changed'); deny = true
    const before = request.mock.calls.length
    for (const work of [() => port.createSnapshot({ operationId: 'version-op', label: 'A' }), () => port.restore('version:one', { operationId: 'reset-restore' }),
      () => port.queryOperation('version-op'), () => port.queryRestoreOperation('reset-restore')]) await expect(Promise.resolve().then(work)).rejects.toMatchObject({ code: 'VERSION_CONTEXT_CHANGED' })
    expect(request).toHaveBeenCalledTimes(before)
    await expect(port.restore('version:one', { operationId: 'fresh-restore' })).rejects.toBeInstanceOf(Error)
    expect(request.mock.calls.at(-1)[0]).toContain('/versions/'); expect(request.mock.calls.at(-1)[1].method).toBe('GET'); expect(isolate).toHaveBeenCalledOnce(); port.dispose()
  })
  it.each(['response', 'json'])('reset aborts a version capture waiting for %s without recreating its private result', async phase => {
    const waiting = held(), entered = held(); let signal
    const request = vi.fn(async (_url, init) => { signal = init.signal; entered.resolve(); return phase === 'response' ? waiting.promise : { status: 201, json: () => waiting.promise } })
    const port = configured(request), pending = observe(port.createSnapshot({ operationId: 'version-op', label: 'private label' })); await entered.promise
    port.reset(); expect(signal.aborted).toBe(true)
    expect((await pending).error).toMatchObject({ code: 'VERSION_CONTEXT_CHANGED' })
    waiting.resolve(phase === 'response' ? response(committed(), 201) : committed()); await Promise.resolve()
    await expect(port.createSnapshot({ operationId: 'version-op', label: 'private label' })).rejects.toMatchObject({ code: 'VERSION_CONTEXT_CHANGED' }); expect(request).toHaveBeenCalledOnce(); port.dispose()
  })
  it('reset during restore target prefetch neither posts restore nor hands old data to the current host', async () => {
    const waiting = held(), entered = held(), isolate = vi.fn()
    const request = vi.fn(async () => { entered.resolve(); return waiting.promise }), port = configured(request, { isolateDocument: isolate })
    const pending = observe(port.restore('version:one', { operationId: 'prefetch-restore' })); await entered.promise; port.reset()
    waiting.resolve(response(full())); expect((await pending).error).toMatchObject({ code: 'VERSION_CONTEXT_CHANGED' })
    await expect(port.restore('version:one', { operationId: 'prefetch-restore' })).rejects.toMatchObject({ code: 'VERSION_CONTEXT_CHANGED' })
    expect(request.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true); expect(isolate).not.toHaveBeenCalled(); port.dispose()
  })
  it('reset while version SHA is pending cannot repopulate known hashes from the old identity', async () => {
    const waiting = held(), entered = held(), native = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle)
    const spy = vi.spyOn(globalThis.crypto.subtle, 'digest').mockImplementationOnce(() => { entered.resolve(); return waiting.promise })
    let deny = false
    const request = vi.fn(async () => response(deny ? {} : full(), deny ? 404 : 200)), isolate = vi.fn(), port = configured(request, { isolateDocument: isolate })
    try {
      const pending = observe(port.get('version:one')); await entered.promise; port.reset(); deny = true
      waiting.resolve(await native('SHA-256', payload)); expect((await pending).error).toMatchObject({ code: 'VERSION_CONTEXT_CHANGED' })
      await expect(port.restore('version:one', { operationId: 'new-after-reset' })).rejects.toBeInstanceOf(Error)
      expect(request).toHaveBeenCalledTimes(2); expect(isolate).not.toHaveBeenCalled()
    } finally { waiting.resolve(new Uint8Array(32).buffer); spy.mockRestore(); port.dispose() }
  })
  it('dispose also closes non-conversion version operations and sanitizes a late private failure', async () => {
    const waiting = held(), entered = held(), request = vi.fn(async () => { entered.resolve(); return waiting.promise }), port = configured(request)
    const pending = observe(port.list()); await entered.promise; port.dispose(); waiting.reject(Object.assign(new Error('private version source'), { payload: 'private bytes' }))
    const outcome = await pending; expect(outcome.error).toMatchObject({ code: 'VERSION_CONTEXT_CHANGED' }); expect(JSON.stringify(outcome.error)).not.toContain('private')
    for (const work of [() => port.list(), () => port.get('version:one'), () => port.createSnapshot({ operationId: 'new-id' })]) await expect(Promise.resolve().then(work)).rejects.toMatchObject({ code: 'VERSION_CONTEXT_CHANGED' })
    expect(request).toHaveBeenCalledOnce()
  })
})


describe('HTTP versioning reset handoff and original query boundaries', () => {
  const held = () => { let resolve; const promise = new Promise(yes => { resolve = yes }); return { promise, resolve } }
  const observe = promise => promise.then(value => ({ value }), error => ({ error }))
  const configured = (request, extra = {}) => converting(request, { getCapabilities: () => ({ canView: true, canEdit: true, canExport: true, canRestoreVersion: true }), isolateDocument: vi.fn(), ...extra })
  it.each(['version', 'restore'])('an in-flight original %s GET becomes a retired ID on reset without any POST', async kind => {
    const waiting = held(), entered = held(), request = vi.fn(async () => { entered.resolve(); return waiting.promise }), port = configured(request)
    const pending = observe(kind === 'version' ? port.queryOperation('old-query') : port.queryRestoreOperation('old-query'))
    await entered.promise; port.reset(); expect((await pending).error).toMatchObject({ code: 'VERSION_CONTEXT_CHANGED' })
    waiting.resolve(response({ status: 'unknown', operationId: 'old-query' }, 503))
    const retry = kind === 'version' ? () => port.createSnapshot({ operationId: 'old-query' }) : () => port.restore('version:one', { operationId: 'old-query' })
    await expect(Promise.resolve().then(retry)).rejects.toMatchObject({ code: 'VERSION_CONTEXT_CHANGED' })
    expect(request).toHaveBeenCalledOnce(); expect(request.mock.calls[0][1].method).toBe('GET'); port.dispose()
  })
  it('reset during restore isolation cannot refill the old ledger or call a current host again', async () => {
    const waiting = held(), entered = held(), isolate = vi.fn(() => { entered.resolve(); return waiting.promise }), reload = vi.fn()
    const request = vi.fn(async url => response(url.includes('/versions/') ? full() : { status: 'unknown', operationId: 'old-restore' }, url.includes('/versions/') ? 200 : 503))
    const port = configured(request, { isolateDocument: isolate, reloadDocument: reload }), pending = observe(port.restore('version:one', { operationId: 'old-restore' }))
    await entered.promise; port.reset(); waiting.resolve(); expect((await pending).error).toMatchObject({ code: 'VERSION_CONTEXT_CHANGED' })
    await expect(port.queryRestoreOperation('old-restore')).rejects.toMatchObject({ code: 'VERSION_CONTEXT_CHANGED' }); expect(reload).not.toHaveBeenCalled(); expect(isolate).toHaveBeenCalledOnce(); port.dispose()
  })
  it('reset between import isolate and reload prevents the second host callback and retires conversion IDs', async () => {
    const waiting = held(), entered = held(), reload = vi.fn(), isolate = vi.fn(() => { entered.resolve(); return waiting.promise })
    const ready = { status: 'ready', operation: 'import', operationId: 'import-op', taskId: 'import-op', tenantId: 'tenant', docId: 'doc', requestedFormat: 'docx',
      requestHash, persisted: true, sourceVerified: true, code: null, source: { assetId: 'asset-one', assetRevision: '1', versionId: 'object:one', checksum: sha('asset'), sizeBytes: '5', mimeType: 'application/octet-stream' },
      receipt: { tenant_id: 'tenant', doc_id: 'doc', update_id: 'import-update', payload_hash: sha('delta'), epoch: '1', seq: '8', content_revision: '8', protocol_version: 'editor-crdt-v1', committed_at: '2026-11-07T13:00:00Z' } }
    const request = vi.fn(async () => response(ready)), port = configured(request, { isolateDocument: isolate, reloadDocument: reload })
    const pending = observe(port.requestImport({ operationId: 'import-op', assetId: 'asset-one', format: 'docx' })); await entered.promise
    port.reset(); waiting.resolve(); expect((await pending).error).toMatchObject({ code: 'VERSION_CONTEXT_CHANGED' }); expect(reload).not.toHaveBeenCalled(); expect(port.getConversionOperation('import-op')).toBeNull()
    for (const retry of [() => port.requestImport({ operationId: 'import-op', assetId: 'asset-one', format: 'docx' }), () => port.queryConversion({ operationId: 'import-op', operation: 'import' })])
      await expect(Promise.resolve().then(retry)).rejects.toMatchObject({ code: 'CONVERSION_CONTEXT_CHANGED' })
    expect(request).toHaveBeenCalledOnce(); port.dispose()
  })
})


describe('T107 selected File upload before remote import (E1)', () => {
  const source = readFileSync(new URL('../../src/components/lark-doc/LarkDocWorkspace.vue', import.meta.url), 'utf8')
  it('server-managed身份下热更新user prop不冒充登录、不抛异常，仍清理旧转换视图', async () => {
    const h = versionIdentitySession(create(async () => response(committed(), 201)))
    try {
      await h.session._capabilitiesPromise
      const watchSource = source.slice(source.indexOf('    user(value, prior) {'), source.indexOf('\n  created() {'))
      const watch = new Function(`return ({${watchSource.slice(0, watchSource.lastIndexOf('\n  },'))}})`)()
      const vm = { sessionInstance: h.session, clearRemoteConversion: vi.fn() }
      expect(() => watch.user.call(vm, { id: 'forged-host' }, { id: 'alice' })).not.toThrow()
      expect(h.session.user).toEqual({ id: 'alice' })
      expect(vm.clearRemoteConversion).toHaveBeenCalledOnce()
    } finally { await h.session.dispose() }
  })
  const methodSource = source.slice(source.indexOf('    bindRemoteConversionSession() {'), source.indexOf('    featureEnabled(name) {'))
  const importSource = source.slice(source.indexOf('    async importDocument(event) {'), source.indexOf('    async exportDocument(', source.indexOf('    async importDocument(event) {')))
  const lazySource = readFileSync(new URL('../../src/utils/remoteConversion.js', import.meta.url), 'utf8').split('export const remoteConversionMethods = ')[1]
  const held = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
  const checksum = sha('file bytes'), file = () => ({ name: 'selected.docx', type: 'application/docx', size: 10, arrayBuffer: vi.fn() })
  const facts = () => ({ fileName: 'selected.docx', mimeType: 'application/docx', sizeBytes: '10', checksum })
  const uploaded = (extra = {}) => ({ status: 'committed', operation: 'complete', operationId: 'upload-op', persisted: true,
    ready: true, objectVerified: true, assetId: 'asset-one', asset: { assetId: 'asset-one', ready: true, objectVerified: true, ...facts() }, ...extra })
  const deferredUpload = (phase, status = 'unknown') => Object.assign(new Error('not confirmed'), { status, operationId: phase === 'begin' ? 'begin-op' : 'upload-op',
    uploadOperationId: 'upload-op', beginOperationId: 'begin-op', metadata: facts(), result: { assetId: 'asset-one' } })
  const task = (status = 'pending') => ({ status, operation: 'import', operationId: 'import-op', requestedFormat: 'docx' })
  function harness({ load, upload, query, realVue = false } = {}) {
    const listeners = new Map(), state = { expectedEpoch: '1', expectedRevision: '7', lastSeq: '7' }
    const remote = { requiresDurableConfirmation: true, captureImportSource: vi.fn(() => { if (state.pending) throw Error('pending'); return Object.freeze({ expectedEpoch: state.expectedEpoch, expectedRevision: state.expectedRevision, lastSeq: state.lastSeq }) }) }
    const assets = { requiresDurableConfirmation: true }, session = { user: { id: 'alice' }, _conversionGeneration: 0, _destroyed: false, can: () => true,
      getProvider: name => name === 'versioning' ? remote : assets, uploadAssetFile: vi.fn(upload || (async () => uploaded())), queryAssetOperation: vi.fn(query),
      requestImport: vi.fn(async () => task()), queryConversion: vi.fn(async () => task('failed')), downloadConversion: vi.fn(),
      on(event, listener) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(listener); return () => listeners.get(event).delete(listener) },
      emit(event, value) { listeners.get(event)?.forEach(listener => listener(value)) } }
    const loaded = async () => { if (load) await load(); return { remoteConversionMethods: new Function('downloadBlob', 'safeFileName', `const remoteConversionMethods = ${lazySource}; return remoteConversionMethods`)(vi.fn(), () => 'safe') } }
    const methods = new Function('loadImportExport', `return ({${methodSource.replace(/import\(/g, 'loadImportExport(')}${importSource}})`)(loaded)
    const data = { session, sessionInstance: session, documentId: 'doc', title: 'Task', conversionGeneration: 0, conversionBusy: false, conversionPendingId: '',
      conversionResult: null, importUploadPending: false, notice: '', _disposed: false }
    let vm
    if (realVue) {
      const Vue = createRequire(import.meta.url)('vue/dist/vue.common.js')
      const watchSource = source.slice(source.indexOf('  watch: {') + 10, source.indexOf('  created() {')).trim().replace(/},$/, '')
      const watch = new Function(`return ({${watchSource}})`)()
      const viewData = { ...data }; delete viewData.session; delete viewData.documentId
      vm = new Vue({ props: { session: Object, documentId: String }, propsData: { session, documentId: 'doc' }, data: () => viewData,
        methods: { ...methods, retireNativeScope: vi.fn(), getSession() { return this.session || this.sessionInstance }, featureEnabled: () => true, writable: () => true }, watch: { session: watch.session, documentId: watch.documentId } })
    } else vm = { ...data, ...methods, getSession() { return this.session || this.sessionInstance }, featureEnabled: () => true, writable: () => true }
    return { vm, session, remote, state, listeners, select: f => vm.importDocument({ target: { files: [f], value: 'selected' } }) }
  }
  it('captures the selected File and exact source synchronously before lazy loading; sends ready asset with frozen CAS only', async () => {
    const gate = held(), h = harness({ load: () => gate.promise }), selected = file(), pending = h.select(selected)
    expect(h.remote.captureImportSource).toHaveBeenCalled(); expect(h.session.uploadAssetFile).not.toHaveBeenCalled()
    gate.resolve(); await pending
    expect(h.session.uploadAssetFile.mock.calls[0][0]).toMatchObject({ file: selected, signal: expect.any(AbortSignal) })
    expect(h.session.requestImport).toHaveBeenCalledWith({ assetId: 'asset-one', format: 'docx', expectedEpoch: '1', expectedRevision: '7' })
    expect(h.vm.conversionPendingId).toBe('import-op'); expect(h.vm.importUploadPending).toBe(false); expect(h.vm._pendingImportUpload).toBeNull()
  })
  it.each(['lazy', 'expectedEpoch', 'expectedRevision', 'lastSeq', 'pending'])('source change during %s never silently retargets import', async phase => {
    const gate = held(), h = harness(phase === 'lazy' ? { load: () => gate.promise } : { upload: () => gate.promise })
    const pending = h.select(file()); if (phase !== 'lazy') await vi.waitFor(() => expect(h.session.uploadAssetFile).toHaveBeenCalledOnce())
    if (phase === 'lazy') h.state.expectedRevision = '8'; else if (phase === 'pending') h.state.pending = true; else h.state[phase] = '8'
    gate.resolve(phase === 'lazy' ? undefined : uploaded()); await pending
    expect(h.session.requestImport).not.toHaveBeenCalled(); if (phase === 'lazy') expect(h.session.uploadAssetFile).not.toHaveBeenCalled()
    expect(h.vm._pendingImportUpload).toBeNull(); expect(h.vm.notice).toMatch(/来源|正文/)
  })
  it.each([{ status: 'pending' }, { persisted: false }, { ready: false }, { objectVerified: false },
    { asset: { ...uploaded().asset, sizeBytes: '11' } }, { asset: { ...uploaded().asset, mimeType: 'wrong/type' } }, { asset: { ...uploaded().asset, checksum: 'wrong' } }])('non-durable/mismatched asset never reaches import: %j', async invalid => {
    const h = harness({ upload: async () => uploaded(invalid) }); await h.select(file()); expect(h.session.requestImport).not.toHaveBeenCalled()
  })
  it('complete unknown keeps only original upload GET; ready match imports once then conversion unknown uses its own GET', async () => {
    const h = harness({ upload: async () => { throw deferredUpload('complete') }, query: async () => uploaded() })
    h.session.requestImport.mockRejectedValueOnce(Object.assign(Error('lost conversion ACK'), { status: 'unknown', operationId: 'import-op' }))
    await h.select(file()); expect(h.vm.importUploadPending).toBe(true); expect(h.vm.conversionPendingId).toBe('')
    expect(h.vm._pendingImportUpload.file).toBeNull(); await h.vm.queryRemoteConversion()
    expect(h.session.queryAssetOperation).toHaveBeenCalledWith(expect.objectContaining({ operationId: 'upload-op', kind: 'complete' }))
    expect(h.session.uploadAssetFile).toHaveBeenCalledOnce(); expect(h.session.requestImport).toHaveBeenCalledOnce(); expect(h.vm.conversionPendingId).toBe('import-op')
    await h.vm.queryRemoteConversion(); expect(h.session.queryConversion).toHaveBeenCalledWith('import-op'); expect(h.session.queryAssetOperation).toHaveBeenCalledOnce()
  })
  it('begin unknown queries original begin first and resumes the same File and complete ID for first bytes only', async () => {
    const selected = file(), h = harness({ upload: vi.fn().mockRejectedValueOnce(deferredUpload('begin')).mockResolvedValueOnce(uploaded()),
      query: async () => ({ status: 'committed', operation: 'begin', operationId: 'begin-op', persisted: true, assetId: 'asset-one', asset: { ...uploaded().asset, checksum: null, ready: false, objectVerified: false } }) })
    await h.select(selected); expect(h.vm._pendingImportUpload.file).toBe(selected); await h.vm.queryRemoteConversion()
    expect(h.session.queryAssetOperation).toHaveBeenCalledWith(expect.objectContaining({ operationId: 'begin-op', kind: 'begin' }))
    expect(h.session.uploadAssetFile.mock.calls[1][0]).toMatchObject({ file: selected, operationId: 'upload-op', beginOperationId: 'begin-op' })
    expect(h.session.requestImport).toHaveBeenCalledOnce(); expect(h.vm._pendingImportUpload).toBeNull()
  })
  it('GET ready with a different checksum cannot import or repost complete bytes', async () => {
    const h = harness({ upload: async () => { throw deferredUpload('complete') }, query: async () => uploaded({ asset: { ...uploaded().asset, checksum: sha('other bytes') } }) })
    await h.select(file()); await h.vm.queryRemoteConversion(); expect(h.session.requestImport).not.toHaveBeenCalled(); expect(h.session.uploadAssetFile).toHaveBeenCalledOnce()
  })
  it('cancel synchronously aborts and releases File/subscriptions; late ready cannot overwrite a new scope', async () => {
    const gate = held(), h = harness({ upload: () => gate.promise }), pending = h.select(file())
    await vi.waitFor(() => expect(h.session.uploadAssetFile).toHaveBeenCalledOnce()); const signal = h.session.uploadAssetFile.mock.calls[0][0].signal
    h.vm.clearRemoteConversion(); expect(signal.aborted).toBe(true); expect(h.vm._pendingImportUpload).toBeNull(); expect([...h.listeners.values()].every(set => set.size === 0)).toBe(true)
    h.vm.notice = 'new view'; gate.resolve(uploaded()); await pending; expect(h.session.requestImport).not.toHaveBeenCalled(); expect(h.vm.notice).toBe('new view')
  })
  it.each(['capabilities', 'identity', 'provider-changed', 'comments-reset'])('%s invalidation clears pending File synchronously and forbids late error/ready', async event => {
    const gate = held(), h = harness({ upload: () => gate.promise }), pending = h.select(file())
    await vi.waitFor(() => expect(h.session.uploadAssetFile).toHaveBeenCalledOnce())
    if (event === 'comments-reset') h.session._destroyed = true; else if (event === 'capabilities') h.session.can = () => false; else h.session._conversionGeneration++
    h.session.emit(event); expect(h.vm._pendingImportUpload).toBeNull(); h.vm.notice = 'new identity'
    gate.reject(deferredUpload('complete')); await pending; expect(h.session.requestImport).not.toHaveBeenCalled(); expect(h.vm.notice).toBe('new identity')
  })
  it.each(['session', 'documentId'])('real Vue %s prop A-B-A synchronously retires upload intent before late ready', async prop => {
    const gate = held(), h = harness({ upload: () => gate.promise, realVue: true }), pending = h.select(file())
    await vi.waitFor(() => expect(h.session.uploadAssetFile).toHaveBeenCalledOnce())
    const original = h.vm[prop]; h.vm[prop] = prop === 'session' ? { ...h.session } : 'other'; h.vm[prop] = original
    expect(h.vm._pendingImportUpload).toBeNull(); h.vm.notice = 'current'; gate.resolve(uploaded()); await pending
    expect(h.session.requestImport).not.toHaveBeenCalled(); expect(h.vm.notice).toBe('current'); h.vm.$destroy()
  })
  it.each(['begin', 'complete'])('an original %s GET transport failure retains IDs and never reposts under a new intent', async phase => {
    const h = harness({ upload: vi.fn().mockRejectedValueOnce(deferredUpload(phase)).mockResolvedValueOnce(uploaded()),
      query: vi.fn().mockRejectedValueOnce(Error('lost GET response')).mockResolvedValueOnce(phase === 'begin'
        ? { status: 'committed', operation: 'begin', operationId: 'begin-op', persisted: true, assetId: 'asset-one', asset: { ...uploaded().asset, checksum: null, ready: false, objectVerified: false } } : uploaded()) })
    await h.select(file()); const original = h.vm._pendingImportUpload
    await h.vm.queryRemoteConversion(); expect(h.vm._pendingImportUpload).toBe(original); expect(h.vm.importUploadPending).toBe(true)
    expect(h.session.uploadAssetFile).toHaveBeenCalledOnce(); expect(h.session.requestImport).not.toHaveBeenCalled()
    await h.vm.queryRemoteConversion(); expect(h.session.requestImport).toHaveBeenCalledOnce()
    expect(h.session.queryAssetOperation.mock.calls.map(([input]) => input.operationId)).toEqual([phase === 'begin' ? 'begin-op' : 'upload-op', phase === 'begin' ? 'begin-op' : 'upload-op'])
    expect(h.session.uploadAssetFile).toHaveBeenCalledTimes(phase === 'begin' ? 2 : 1)
  })
  it('a body change followed by undo still synchronously cancels the old source before ready', async () => {
    const gate = held(), h = harness({ upload: () => gate.promise }), pending = h.select(file())
    await vi.waitFor(() => expect(h.session.uploadAssetFile).toHaveBeenCalledOnce()); h.state.pending = true; h.vm.invalidateRemoteImportSource(); h.state.pending = false
    expect(h.vm._pendingImportUpload).toBeNull(); h.vm.notice = 'new body'; gate.resolve(uploaded()); await pending
    expect(h.session.requestImport).not.toHaveBeenCalled(); expect(h.vm.notice).toBe('new body')
  })
  it('same-tick user A-B-A drops the File during the denied capabilities event and ignores old ready', async () => {
    const gate = held(), h = harness({ upload: () => gate.promise }), pending = h.select(file())
    await vi.waitFor(() => expect(h.session.uploadAssetFile).toHaveBeenCalledOnce())
    h.session.can = () => false; h.session.user = { id: 'bob' }; h.session._conversionGeneration++; h.session.emit('capabilities')
    h.session.user = { id: 'alice' }; h.session._conversionGeneration++; h.session.can = () => true
    expect(h.vm._pendingImportUpload).toBeNull(); gate.resolve(uploaded()); await pending; expect(h.session.requestImport).not.toHaveBeenCalled()
  })
  it('read-only editor at upload completion cannot submit the frozen import', async () => {
    const gate = held(), h = harness({ upload: () => gate.promise }), pending = h.select(file())
    await vi.waitFor(() => expect(h.session.uploadAssetFile).toHaveBeenCalledOnce()); h.vm.writable = () => false; gate.resolve(uploaded()); await pending
    expect(h.session.requestImport).not.toHaveBeenCalled(); expect(h.vm._pendingImportUpload).toBeNull()
  })
  it('late original upload GET after cancel cannot import or release a newer upload busy marker', async () => {
    const queryGate = held(), nextGate = held(), h = harness({ upload: vi.fn().mockRejectedValueOnce(deferredUpload('complete')).mockImplementationOnce(() => nextGate.promise), query: () => queryGate.promise })
    await h.select(file()); const oldQuery = h.vm.queryRemoteConversion(); await vi.waitFor(() => expect(h.session.queryAssetOperation).toHaveBeenCalledOnce())
    h.vm.clearRemoteConversion(); const next = h.select(file()); await vi.waitFor(() => expect(h.session.uploadAssetFile).toHaveBeenCalledTimes(2)); h.vm.notice = 'new upload'
    queryGate.resolve(uploaded()); await oldQuery; expect(h.session.requestImport).not.toHaveBeenCalled(); expect(h.vm.conversionBusy).toBe(true); expect(h.vm.notice).toBe('new upload')
    h.vm.clearRemoteConversion(); nextGate.resolve(uploaded()); await next
  })
  it('ordinary same-owner reload capability events retain the original upload intent', async () => {
    const h = harness({ upload: async () => { throw deferredUpload('begin') } }); await h.select(file()); const prior = h.vm._pendingImportUpload
    h.session.emit('capabilities'); h.session.emit('provider-changed'); h.session.emit('comments-reset', 'reload'); h.vm.invalidateRemoteImportSource()
    expect(h.vm._pendingImportUpload).toBe(prior); expect(h.vm.importUploadPending).toBe(true); h.vm.clearRemoteConversion()
  })
})

describe('T107 synchronous source capture', () => {
  it('returns only frozen expected fields from ready/no-pending state without HTTP and refuses pending', () => {
    const state = { status: 'ready', epoch: '1', revision: '7', lastSeq: '9', pending: [] }, request = vi.fn(), port = converting(request, { getState: () => state })
    const source = port.captureImportSource(); expect(source).toEqual({ expectedEpoch: '1', expectedRevision: '7', lastSeq: '9' }); expect(Object.isFrozen(source)).toBe(true)
    state.revision = '8'; expect(source.expectedRevision).toBe('7'); state.pending.push({ status: 'pending' }); expect(() => port.captureImportSource()).toThrow(); expect(request).not.toHaveBeenCalled(); port.dispose()
  })
})
