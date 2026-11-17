// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LarkDoc } from '../../src/LarkDoc'
import { createDocumentSession, AUTO_VERSION_INTERVAL_MS } from '../../src/session/DocumentSession'
import { createMemoryVersioningProvider } from '../../src/core/versioning/provider'

const mounted = []
beforeEach(() => {
  const createRange = document.createRange.bind(document)
  vi.spyOn(document, 'createRange').mockImplementation(() => Object.assign(createRange(), {
    getClientRects: () => [], getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }),
  }))
})
afterEach(() => { mounted.splice(0).forEach(destroy => destroy()); vi.restoreAllMocks() })

function mount(extra = {}) {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const provider = extra.provider || createMemoryVersioningProvider({ author: 'auto-owner' })
  const session = createDocumentSession({ documentId: 'auto_versions', user: { id: 'auto-owner' }, providers: { versioning: provider } })
  const doc = new LarkDoc({ element, storage: 'none', session, content: '<p data-block-id="auto_p">自动版本正文</p>', ...extra })
  mounted.push(() => { doc.destroy(); element.remove() })
  return { doc, session, provider }
}

describe('automatic history versions', () => {
  it('does not submit on every edit — the record lands after the quiet window, not per keystroke', async () => {
    const { doc, session, provider } = mount()
    doc.setContent('<p data-block-id="auto_p">第一次编辑</p>')
    doc.setContent('<p data-block-id="auto_p">第二次编辑</p>')
    // 同步阶段一条都不该发出去：自动版本是「编辑落定后的补记」，不是击键日志。
    expect(await provider.list({ documentId: session.documentId })).toHaveLength(0)
    // 也不是一个短防抖：窗口期内依旧不发。
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(await provider.list({ documentId: session.documentId })).toHaveLength(0)
    expect(session._autoVersionTimer).not.toBeNull()
    expect(AUTO_VERSION_INTERVAL_MS).toBeGreaterThanOrEqual(30000)
  })

  it('records one automatic version through the version provider with purpose and kind both auto', async () => {
    const { session, provider } = mount()
    const create = vi.spyOn(provider, 'createSnapshot')
    const created = await session.requestAutoVersion()
    // `purpose` 是发给后端的口径，`kind` 是本地保留策略的口径 —— 两边都必须是 auto，
    // 否则自动版本会被当成「手动」永久保留，保留策略失效。
    expect(create).toHaveBeenCalledOnce()
    expect(create.mock.calls[0][0]).toMatchObject({ purpose: 'auto', kind: 'auto' })
    expect(created).toMatchObject({ kind: 'auto', author: 'auto-owner' })
    expect(created.payload).toBeInstanceOf(Uint8Array)
    const list = await provider.list({ documentId: session.documentId })
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ kind: 'auto' })
  })

  it('throttles to one record per window and never sends a second one', async () => {
    const { session, provider } = mount()
    expect(await session.requestAutoVersion()).not.toBeNull()
    expect(await session.requestAutoVersion()).toBeNull()
    expect(await provider.list({ documentId: session.documentId })).toHaveLength(1)
  })

  it('stays silent and keeps the body editable when the version provider fails', async () => {
    const { doc, session, provider } = mount()
    vi.spyOn(provider, 'createSnapshot').mockRejectedValue(new Error('version service down'))
    await expect(session.requestAutoVersion()).resolves.toBeNull()
    const before = doc.getJSON()
    doc.setContent('<p data-block-id="auto_p">失败之后继续写</p>')
    expect(doc.getJSON()).not.toEqual(before)
    expect(await provider.list({ documentId: session.documentId })).toHaveLength(0)
  })

  it('keeps the LarkDoc autoVersion switch and the create permission as hard gates', async () => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const off = new LarkDoc({ element, storage: 'none', documentId: 'auto_off', autoVersion: false,
      user: { id: 'auto-owner' }, versioning: createMemoryVersioningProvider({ author: 'auto-owner' }) })
    mounted.push(() => { off.destroy(); element.remove() })
    expect(off.getSession().autoVersion).toBe(false)
    off.setContent('<p data-block-id="auto_p">关掉之后</p>')
    expect(await off.getSession().requestAutoVersion()).toBeNull()
    expect(off.getSession()._autoVersionTimer).toBeNull()

    const denied = mount()
    denied.session._capabilities.canCreateVersion = false
    expect(await denied.session.requestAutoVersion()).toBeNull()
    expect(await denied.provider.list({ documentId: denied.session.documentId })).toHaveLength(0)
  })

  it('stops the pending window when the editor is detached or the session is disposed', async () => {
    const { doc, session } = mount()
    doc.setContent('<p data-block-id="auto_p">解绑前</p>')
    expect(session._autoVersionTimer).not.toBeNull()
    session.detachEditor(doc.getEditor())
    expect(session._autoVersionTimer).toBeNull()
    expect(session._autoVersionDirty).toBe(false)
  })
})
