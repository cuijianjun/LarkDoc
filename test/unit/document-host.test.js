// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { webcrypto } from 'node:crypto'
import { createHttpDocumentHostProvider, createHttpDocumentHost, receiveHttpDocumentHostIdentity } from '../../src/providers/document-host-http'
import { createDocumentReport } from '../../src/ui/documentHost'
import { documentMenuItems, documentMenuChildren, runDocumentMenuAction } from '../../src/components/lark-doc/editor/documentMenuView'
import toolbarUiMixin from '../../src/components/lark-doc/editor/toolbarUiMixin'
import toolbarMenusMixin from '../../src/components/lark-doc/editor/toolbarMenusMixin'
import { commentPanelMethods } from '../../src/components/lark-doc/editor/commentPanelView'

const hash = 'sha256:' + 'a'.repeat(64), docNode = 'd-' + '1'.repeat(64), folderNode = 'f-' + '2'.repeat(64)
const response = (data, status = 200) => ({ status, headers: new Headers({ 'content-type': 'application/json' }), json: async () => data })
const ack = operationId => ({ status: 'committed', tenantId: 'tenant', docId: 'doc', principalId: 'alice', operationId, requestHash: hash, reportId: 'report-' + 'b'.repeat(64), receivedAt: '2026-11-14T10:00:00.000Z', reviewStatus: 'received', replayed: false })
const settle = async () => { for (let i = 0; i < 16; i++) await Promise.resolve() }
function fixture() {
  let identity = { status: 'authenticated', principalId: 'alice', generation: 1 }
  const request = vi.fn(async (url, options) => response(ack(JSON.parse(options.body).operationId)))
  const options = { tenantId: 'tenant', docId: 'doc', request, csrfToken: () => 'c'.repeat(43), getIdentityState: () => identity, getCapabilities: () => ({ canView: true }) }
  return { options, request, provider: createHttpDocumentHostProvider(options), identity: value => { identity = value } }
}
afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.replaceChildren(); document.head.querySelectorAll('style').forEach(n => n.remove()); history.replaceState(null, '', '/') })

describe('current-identity document host HTTP boundary', () => {
  it('sends only report data and validates durable receipt, Cookie/CSRF/idempotency', async () => {
    vi.stubGlobal('crypto', webcrypto)
    const f = fixture(), result = await f.provider.submitReport({ reason: 'other', description: '😀'.repeat(100) })
    expect(result).toMatchObject({ status: 'committed', principalId: 'alice', reviewStatus: 'received' })
    const [url, options] = f.request.mock.calls[0], body = JSON.parse(options.body)
    expect(url).toBe('/editor/v1/tenants/tenant/documents/doc/report-operations')
    expect(Object.keys(body)).toEqual(['operationId', 'reason', 'description'])
    expect(options).toMatchObject({ credentials: 'include', cache: 'no-store', redirect: 'error', headers: { 'X-CSRF-Token': 'c'.repeat(43), 'Idempotency-Key': body.operationId } })
    expect(f.provider.getPending()).toEqual([])
    await expect(f.provider.submitReport({ reason: 'other', description: '😀'.repeat(101) })).rejects.toMatchObject({ code: 'HOST_REPORT_INVALID' })
    expect(f.request).toHaveBeenCalledOnce()
  })

  it.each([401, 404, 409, 503])('keeps original operation after HTTP %i; queries never create another write', async status => {
    vi.stubGlobal('crypto', webcrypto)
    const f = fixture(); f.request.mockResolvedValueOnce(response({ code: 'DENIED_AFTER_COMMIT' }, status))
    await expect(f.provider.submitReport({ reason: 'other' })).rejects.toMatchObject({ unknown: true })
    const [{ operationId }] = f.provider.getPending()
    await expect(f.provider.submitReport({ reason: 'other' })).rejects.toMatchObject({ code: 'HOST_ORIGINAL_OPERATION_REQUIRED' })
    f.request.mockResolvedValueOnce(response(ack(operationId)))
    expect(await f.provider.queryReport(operationId)).toMatchObject({ operationId, status: 'committed' })
    expect(f.request.mock.calls.map(c => c[1].method)).toEqual(['POST', 'GET'])
  })

  it('rejects forged receipt and late Alice result after authenticated Bob replacement', async () => {
    vi.stubGlobal('crypto', webcrypto)
    const f = fixture(); let release
    f.request.mockImplementationOnce((url, options) => new Promise(resolve => { release = () => resolve(response(ack(JSON.parse(options.body).operationId))) }))
    const pending = f.provider.submitReport({ reason: 'other' })
    f.identity({ status: 'authenticated', principalId: 'bob', generation: 2 }); release()
    await expect(pending).rejects.toMatchObject({ code: 'HOST_CONTEXT_CHANGED' })
    expect(f.provider.getPending()).toEqual([])
    f.identity({ status: 'authenticated', principalId: 'alice', generation: 3 })
    const original = f.provider.getPending()[0].operationId
    f.request.mockResolvedValueOnce(response({ ...ack(original), principalId: 'bob' }))
    await expect(f.provider.queryReport(original)).rejects.toMatchObject({ code: 'HOST_RESULT_UNKNOWN' })
    expect(f.provider.getPending()).toHaveLength(1)
  })

  it('does not consume original operation on query denial or non-JSON response', async () => {
    const f = fixture(); f.provider.resumeReport({ operationId: 'original', requestHash: hash })
    f.request.mockResolvedValueOnce(response({ code: 'DENIED' }, 404))
    await expect(f.provider.queryReport('original')).rejects.toMatchObject({ unknown: true })
    f.request.mockResolvedValueOnce({ status: 200, headers: new Headers({ 'content-type': 'text/html' }), json: vi.fn() })
    await expect(f.provider.queryReport('original')).rejects.toMatchObject({ code: 'HOST_RESULT_UNKNOWN' })
    expect(f.provider.getPending()).toEqual([{ operationId: 'original', requestHash: hash }])
  })

  it('constructs real hierarchical nodes; rejects cycles, invalid actor and oversized trees', async () => {
    const f = fixture(), page = items => ({ tenantId: 'tenant', docId: 'doc', principalId: 'alice', items, nextCursor: null })
    f.request.mockResolvedValueOnce(response(page([{ id: docNode, parentId: folderNode, docId: 'doc', displayName: 'Document' }, { id: folderNode, parentId: null, displayName: 'Folder' }])))
    expect(await f.provider.library()).toEqual({ status: 'resolved', items: [{ id: folderNode, displayName: 'Folder', children: [{ id: docNode, docId: 'doc', displayName: 'Document' }] }] })
    f.request.mockResolvedValueOnce(response(page([{ id: folderNode, parentId: folderNode, displayName: 'Cycle' }])))
    await expect(f.provider.library()).rejects.toMatchObject({ code: 'HOST_LIBRARY_INVALID' })
    f.request.mockResolvedValueOnce(response({ ...page([]), principalId: 'bob' }))
    await expect(f.provider.library()).rejects.toMatchObject({ code: 'HOST_LIBRARY_UNAVAILABLE' })
    let number = 0
    f.request.mockImplementation(async () => {
      const items = Array.from({ length: 50 }, () => ({ id: 'd-' + (++number).toString(16).padStart(64, '0'), parentId: null, docId: 'doc-' + number, displayName: 'Document' }))
      return response({ ...page(items), nextCursor: items.at(-1).id })
    })
    await expect(f.provider.library()).rejects.toMatchObject({ code: 'LIBRARY_LIMIT' })
  })
})

describe('report DOM lifecycle', () => {
  it('selects observed reason, counts UTF16 input, waits for actual receipt and clears on lost identity', async () => {
    let commit
    const provider = { getPending: () => [], submitReport: vi.fn(() => new Promise(resolve => { commit = resolve })) }
    const ui = createDocumentReport({ provider })
    expect([...ui.el.querySelectorAll('button')].map(e => e.textContent)).toEqual(['欺诈', '违规行为及违禁品', '涉政谣言', '色情低俗', '恐怖暴力', '非法宗教活动', '引流/骚扰', '其他'])
    ui.el.querySelectorAll('button')[7].click()
    const input = ui.el.querySelector('textarea'); input.value = '😀'.repeat(100); input.dispatchEvent(new Event('input'))
    expect(ui.el.textContent).toContain('200/200')
    expect(ui.el.querySelector('[aria-label="图片证据上传暂未接入"]').disabled).toBe(true)
    ui.el.querySelector('.report-primary').click(); expect(ui.el.textContent).not.toContain('举报已接收')
    expect(provider.submitReport).toHaveBeenCalledWith({ reason: 'other', description: '😀'.repeat(100) })
    commit(ack('original')); await settle(); expect(ui.el.textContent).toContain('举报已接收')
    ui.setUnavailable(); expect(ui.el.textContent).not.toContain('report-' + 'b'.repeat(64)); expect(ui.el.querySelector('textarea')).toBeNull()
    ui.destroy()
  })

  it('unknown and denied original queries retain only original query action', async () => {
    const provider = { getPending: () => [{ operationId: 'original' }], queryReport: vi.fn(async () => { throw Error('denied') }), submitReport: vi.fn() }
    const ui = createDocumentReport({ provider }); ui.el.querySelector('button').click(); await settle()
    expect(provider.queryReport).toHaveBeenCalledWith('original'); expect(provider.submitReport).not.toHaveBeenCalled()
    expect(ui.el.textContent).toContain('查询原举报'); expect(ui.el.textContent).not.toContain('提交举报')
    ui.destroy()
  })

  it('late successful response cannot repaint after identity becomes unavailable', async () => {
    let finish
    const provider = { getPending: () => [], submitReport: () => new Promise(resolve => { finish = resolve }) }
    const ui = createDocumentReport({ provider, initialReason: 'other' }); ui.el.querySelector('.report-primary').click()
    ui.setUnavailable(); finish(ack('original')); await settle()
    expect(ui.el.textContent).toContain('当前无法举报'); expect(ui.el.textContent).not.toContain('举报已接收'); ui.destroy()
  })
})

describe('same-origin foreground-free new-page handoff', () => {
  it('enables only configured host actions; a library/report adapter cannot enable fake move/delete/profile/create', async () => {
    const handler = vi.fn(async () => false); handler.supportedActions = ['list-knowledge-library', 'report', 'open-document-reference', 'open-in-app']; handler.openInAppLabel = '在浏览器中打开'
    const ed = { onDocumentAction: handler, session: { documentId: 'doc', user: { id: 'alice' }, can: () => true, getProvider: () => null }, featureEnabled: () => true, toolbarEnabled: () => true, shareCan: () => true, closeHeaderMenu: vi.fn(), larkDocConfig: { layout: {} }, modesConfig: {}, toggleSharePopover: vi.fn() }
    const state = toolbarUiMixin.methods.buildTopBarState.call(ed)
    expect(state).toMatchObject({ homeEnabled: false, profileEnabled: false, hostCreateEnabled: false, mobileOpenInAppLabel: '在浏览器中打开' })
    expect(documentMenuItems(ed).filter(i => ['move', 'duplicate', 'delete', 'widgets'].includes(i.id)).every(i => i.disabled)).toBe(true)
    expect(documentMenuChildren(ed, 'more').find(i => i.id === 'report').disabled).toBe(false)
    expect(documentMenuChildren(ed, 'more').find(i => i.id === 'offline').disabled).toBe(true)
    expect(await runDocumentMenuAction(ed, 'move')).toBe(false)
    toolbarMenusMixin.methods.toggleCreateMenu.call(ed)
    expect(await toolbarUiMixin.methods.onMobileHeaderAction.call(ed, 'profile')).toBe(false)
    expect(handler).not.toHaveBeenCalled(); expect(ed.createMenuOpen).toBeUndefined()
    expect(await runDocumentMenuAction(ed, 'report')).toBe(false)
    expect(handler).toHaveBeenCalledOnce()
  })

  it('opens synchronously, transfers current CSRF without URL credentials, supports original-page reload, and rejects another actor', async () => {
    vi.stubGlobal('crypto', webcrypto)
    const channels = new Map()
    class Channel {
      constructor(name) { this.name = name; if (!channels.has(name)) channels.set(name, new Set()); channels.get(name).add(this) }
      postMessage(data) { for (const peer of channels.get(this.name)) if (peer !== this) queueMicrotask(() => peer.onmessage?.({ data })) }
      close() { channels.get(this.name).delete(this) }
    }
    vi.stubGlobal('BroadcastChannel', Channel)
    const f = fixture(), popup = { closed: false, opener: {} }, openWindow = vi.fn(() => popup)
    const host = createHttpDocumentHost({ ...f.options, openWindow, reportUrl: () => '/report', documentUrl: () => '/doc' })
    expect(host.handleAction({ action: 'report' })).toBe(true); expect(openWindow).toHaveBeenCalledOnce(); expect(popup.opener).toBeNull()
    const url = new URL(openWindow.mock.calls[0][0]); expect(url.href).not.toContain('csrf'); expect(url.href).not.toContain('alice')
    history.replaceState(null, '', url)
    expect(await receiveHttpDocumentHostIdentity()).toEqual({ principalId: 'alice', csrfToken: 'c'.repeat(43) })
    expect(await receiveHttpDocumentHostIdentity()).toMatchObject({ principalId: 'alice' })
    f.identity({ status: 'authenticated', principalId: 'bob', generation: 2 })
    const channel = [...channels.values()][0].values().next().value
    channel.postMessage = vi.fn(); channel.onmessage({ data: { type: 'identity-request' } }); expect(channel.postMessage).not.toHaveBeenCalled()
    host.destroy(); expect([...channels.values()][0].size).toBe(0)
  })

  it('refuses popup rejection and foreign URL without reporting success', () => {
    vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('BroadcastChannel', class { close() {} })
    const f = fixture(), host = createHttpDocumentHost({ ...f.options, openWindow: () => null, reportUrl: () => '/report', documentUrl: () => 'https://foreign.example/' })
    expect(host.handleAction({ action: 'report', target: 'comment' })).toBe(false)
    expect(() => host.handleAction({ action: 'report' })).toThrow('HOST_POPUP_BLOCKED')
    expect(() => host.handleAction({ action: 'open-document-reference', documentId: 'doc' })).toThrow('HOST_TARGET_INVALID'); host.destroy()
  })

  it('a document-only report capability cannot enable or dispatch reply reporting; legacy handlers remain compatible', async () => {
    const handler = vi.fn(); handler.supportedActions = ['report']
    const ed = { onDocumentAction: handler, commentCan: () => true, commentAuthor: { id: 'alice' }, commentThreads: [{ id: 'thread', replies: [{ id: 'reply', author: { id: 'bob' } }] }] }
    expect(commentPanelMethods.commentMenuDisabled.call({ ed }, { id: 'report' })).toBe(true)
    expect(await commentPanelMethods.reportCommentReply.call({ ed }, 'thread', 'reply')).toBe(false)
    expect(handler).not.toHaveBeenCalled()
    delete handler.supportedActions
    expect(commentPanelMethods.commentMenuDisabled.call({ ed }, { id: 'report' })).toBe(false)
  })

  it('keeps an uncertain original operation in the URL when history returns to an earlier reason', async () => {
    document.body.innerHTML = '<p id="loading"></p>'
    history.replaceState(null, '', '/report?tenantId=tenant&docId=doc#handoff=' + 'a'.repeat(32))
    const html = fs.readFileSync(path.resolve(__dirname, '../../examples/document-report.html'), 'utf8')
    const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/import[^\n]+\n/g, '')
    const owner = { status: 'authenticated', principalId: 'alice', generation: 1 }
    let configured, pending = []
    const identity = { resumeCurrentSession: async () => owner, getState: () => owner, getCsrfToken: () => 'c'.repeat(43), subscribe: () => () => {}, dispose: vi.fn() }
    const provider = { getPending: () => pending, reset: vi.fn(), destroy: vi.fn() }
    const ui = { setUnavailable: vi.fn(), setReason: vi.fn(), destroy: vi.fn() }
    const boot = new Function('createHttpIdentityProvider', 'createHttpAuthorizationProvider', 'createHttpDocumentHostProvider', 'receiveHttpDocumentHostIdentity', 'mountHttpDocumentReport', `return (async()=>{${script}})()`)
    await boot(() => identity, () => ({ getCapabilities: async () => ({ canView: true }) }), options => { configured = options; return provider }, async () => ({ principalId: 'alice', csrfToken: 'c'.repeat(43) }), async () => ui)
    configured.onPending({ operationId: 'uncertain-original' }); pending = [{ operationId: 'uncertain-original' }]
    // A same-document history traversal does not run beforeunload.
    const earlier = new URL(location.href); earlier.hash = 'handoff=' + 'a'.repeat(32) + '&requestHash=' + hash
    history.replaceState(null, '', earlier); window.dispatchEvent(new PopStateEvent('popstate'))
    expect(new URLSearchParams(location.hash.slice(1)).get('operationId')).toBe('uncertain-original')
    expect(new URLSearchParams(location.hash.slice(1)).has('requestHash')).toBe(false)
    expect(ui.setReason).not.toHaveBeenCalled()
    window.dispatchEvent(new Event('pagehide'))
  })

  it.each(['handoff', 'mount'])('retains the initial original operation when history changes during %s', async stage => {
    document.body.innerHTML = '<p id="loading"></p>'
    const start = '/report?tenantId=tenant&docId=doc#handoff=' + 'a'.repeat(32) + '&operationId=initial-original&requestHash=' + hash
    history.replaceState(null, '', start)
    const html = fs.readFileSync(path.resolve(__dirname, '../../examples/document-report.html'), 'utf8')
    const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/import[^\n]+\n/g, '')
    const owner = { status: 'authenticated', principalId: 'alice', generation: 1 }
    const identity = { resumeCurrentSession: async () => owner, getState: () => owner, getCsrfToken: () => 'c'.repeat(43), subscribe: () => () => {}, dispose: vi.fn() }
    const provider = { resumeReport: vi.fn(), reset: vi.fn(), destroy: vi.fn() }
    const ui = { setUnavailable: vi.fn(), setReason: vi.fn(), destroy: vi.fn() }
    const boot = new Function('createHttpIdentityProvider', 'createHttpAuthorizationProvider', 'createHttpDocumentHostProvider', 'receiveHttpDocumentHostIdentity', 'mountHttpDocumentReport', `return (async()=>{${script}})()`)
    await boot(() => identity, () => ({ getCapabilities: async () => ({ canView: true }) }), () => provider, async () => {
      if (stage === 'handoff') history.replaceState(null, '', '/report?tenantId=tenant&docId=doc#handoff=' + 'a'.repeat(32))
      return { principalId: 'alice', csrfToken: 'c'.repeat(43) }
    }, async () => {
      if (stage === 'mount') history.replaceState(null, '', '/report?tenantId=tenant&docId=doc#handoff=' + 'a'.repeat(32))
      return ui
    })
    expect(provider.resumeReport).toHaveBeenCalledWith({ operationId: 'initial-original', requestHash: hash })
    expect(new URLSearchParams(location.hash.slice(1)).get('operationId')).toBe('initial-original')
    expect(new URLSearchParams(location.hash.slice(1)).get('requestHash')).toBe(hash)
  })

  it('boots from actual handoff, resumes original operation, and clears authenticated Alice UI when Bob replaces her', async () => {
    history.replaceState(null, '', '/report#handoff=' + 'a'.repeat(32) + '&operationId=original')
    document.body.innerHTML = '<p id="loading"></p>'
    const html = fs.readFileSync(path.resolve(__dirname, '../../examples/document-report.html'), 'utf8')
    const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/import[^\n]+\n/g, '')
    history.replaceState(null, '', '/report?tenantId=tenant&docId=doc' + location.hash)
    let owner = { status: 'authenticated', principalId: 'alice', generation: 1 }, listener, configured
    const identity = { resumeCurrentSession: vi.fn(async () => owner), getState: () => owner, getCsrfToken: () => 'c'.repeat(43), subscribe: fn => { listener = fn; fn(owner); return vi.fn() }, dispose: vi.fn() }
    const provider = { resumeReport: vi.fn(), reset: vi.fn(), destroy: vi.fn() }, ui = { setUnavailable: vi.fn(), setReason: vi.fn(), destroy: vi.fn() }
    const boot = new Function('createHttpIdentityProvider', 'createHttpAuthorizationProvider', 'createHttpDocumentHostProvider', 'receiveHttpDocumentHostIdentity', 'mountHttpDocumentReport', `return (async()=>{${script}})()`)
    await boot(() => identity, () => ({ getCapabilities: async () => ({ canView: true }) }), options => { configured = options; return provider }, async () => ({ principalId: 'alice', csrfToken: 'c'.repeat(43) }), async () => ui)
    expect(identity.resumeCurrentSession).toHaveBeenCalledWith({ csrfToken: 'c'.repeat(43) }); expect(provider.resumeReport).toHaveBeenCalledWith({ operationId: 'original' })
    configured.onPending({ operationId: 'second-original' }); expect(new URLSearchParams(location.hash.slice(1)).get('handoff')).toBe('a'.repeat(32))
    owner = { status: 'authenticated', principalId: 'bob', generation: 2 }; listener(owner)
    expect(provider.reset).toHaveBeenCalledOnce(); expect(ui.setUnavailable).toHaveBeenCalledOnce()
    window.dispatchEvent(new Event('pagehide'))
  })
})
