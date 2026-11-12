// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LarkDoc } from '../../src/LarkDoc'
import { createDocumentSession } from '../../src/session/DocumentSession'
import { createMemoryVersioningProvider } from '../../src/core/versioning/provider'
import { decodeVersionDocument, encodeVersionDocument } from '../../src/core/versioning/document-codec'

const mounted = []
beforeEach(() => {
  const createRange = document.createRange.bind(document)
  vi.spyOn(document, 'createRange').mockImplementation(() => Object.assign(createRange(), {
    getClientRects: () => [], getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }),
  }))
})
afterEach(() => { mounted.splice(0).forEach(destroy => destroy()); vi.restoreAllMocks() })

function mount(provider = createMemoryVersioningProvider(), extra = {}) {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const session = createDocumentSession({ documentId: 'versions_document', user: { id: 'version-owner' }, providers: { versioning: provider } })
  const doc = new LarkDoc({ element, storage: 'none', session, content: '<p data-block-id="version_p">历史正文中文😀</p>', ...extra })
  mounted.push(() => { doc.destroy(); element.remove() })
  return { doc, session, provider }
}

describe('version document lifecycle through the real facade and provider', () => {
  it('saves binary current content, decodes it for preview and restores the body as a new immutable version', async () => {
    const { doc, session, provider } = mount()
    const before = doc.getJSON()
    const saved = await session.createVersion({ label: '基线版本' })
    expect(saved.payload).toBeInstanceOf(Uint8Array)
    expect(saved.author).toBe('version-owner')
    expect((await session.readVersionDocument(saved.id)).content).toEqual(before)
    doc.setContent('<p data-block-id="new_p">待移除的恢复标记</p>')
    const modified = doc.getJSON()
    const restored = await session.restoreVersion(saved.id)
    expect(doc.getJSON()).toEqual(before)
    expect(restored.id).not.toBe(saved.id)
    expect(restored.kind).toBe('restore')
    expect((await provider.list({ documentId: session.documentId })).map(record => record.id)).toContain(saved.id)
    doc.getEditor().commands.undo()
    expect(doc.getJSON()).toEqual(modified)
    doc.getEditor().commands.redo()
    expect(doc.getJSON()).toEqual(before)
  })

  it('the actual save-version UI uses the real binary provider rather than a metadata-only stub', async () => {
    const { doc, provider } = mount()
    const host = doc._handle.nativeHost.host
    host.openSaveVersionDialog()
    host.saveVersionName = '完整正文版本'
    expect(await host.confirmSaveVersion()).toBeTruthy()
    expect(host.saveVersionOpen).toBe(false)
    const list = await provider.list({ documentId: 'versions_document' })
    expect(list).toHaveLength(1)
    await host.selectVersion(list[0].id)
    expect(host.versionPreview.document.content).toEqual(doc.getJSON())
  })

  it('does not replace newer content when a restore response arrives after the document changed', async () => {
    const memory = createMemoryVersioningProvider()
    let release
    const provider = { ...memory, restore: (...args) => new Promise(resolve => { release = async () => resolve(await memory.restore(...args)) }) }
    const { doc, session } = mount(provider)
    const saved = await session.createVersion({ label: '旧版本' })
    doc.setContent('<p>还原前内容</p>')
    const pending = session.restoreVersion(saved.id)
    await vi.waitFor(() => expect(typeof release).toBe('function'))
    doc.setContent('<p>等待期间的新编辑</p>')
    await release()
    await expect(pending).rejects.toThrow(/更改|失效/)
    expect(doc.getEditor().state.doc.textContent).toBe('等待期间的新编辑')
  })

  it.each(['readonly', 'provider', 'dispose', 'permission'])('does not apply late restoration after %s', async change => {
    const memory = createMemoryVersioningProvider()
    let release
    const provider = { ...memory, restore: (...args) => new Promise(resolve => { release = async () => resolve(await memory.restore(...args)) }) }
    const { doc, session } = mount(provider)
    const saved = await session.createVersion({ label: '旧版本' })
    doc.setContent('<p>当前正文</p>')
    const pending = session.restoreVersion(saved.id)
    await vi.waitFor(() => expect(typeof release).toBe('function'))
    if (change === 'readonly') doc.setReadonly(true)
    if (change === 'provider') session.setProvider('versioning', createMemoryVersioningProvider())
    if (change === 'dispose') await session.dispose()
    if (change === 'permission') { session._capabilities.canRestoreVersion = false; session.emit('capabilities', session.getCapabilities()) }
    await release()
    await expect(pending).rejects.toThrow(/只读|失效|权限/)
    expect(doc.getEditor().state.doc.textContent).toBe('当前正文')
  })

  it('mounts a separate readonly history editor and releases it without rebinding the live session', async () => {
    const { doc, session } = mount()
    const saved = await session.createVersion({ label: '只读预览' })
    doc.setContent('<p>当前可编辑正文</p>')
    const editor = doc.getEditor(), host = doc._handle.nativeHost.host
    await host.selectVersion(saved.id)
    const element = document.createElement('div')
    document.body.appendChild(element)
    const cleanup = host.mountVersionDocumentPreview(element, host.versionPreview.document)
    expect(element.querySelector('[aria-label="历史版本正文"]').getAttribute('contenteditable')).toBe('false')
    expect(element.textContent).toBe('历史正文中文😀')
    expect(session.getEditor()).toBe(editor)
    expect(editor.state.doc.textContent).toBe('当前可编辑正文')
    cleanup()
    expect(element.children).toHaveLength(0)
    element.remove()
  })

  it.each(['unknown', 'corrupt', 'foreign', 'invalid'])('rejects %s snapshots before adding a restore record or replacing the body', async kind => {
    const { doc, session, provider } = mount()
    const record = session.getDocumentRecord()
    if (kind === 'foreign') record.documentId = 'other_document'
    if (kind === 'invalid') record.content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }] }
    const payload = kind === 'unknown' ? new Uint8Array([1, 2, 3]) : kind === 'corrupt'
      ? new Uint8Array([...encodeVersionDocument(record).slice(0, 20), 0xff]) : encodeVersionDocument(record)
    const saved = await session.createVersion({ payload })
    doc.setContent('<p>保留当前正文</p>')
    const restore = vi.spyOn(provider, 'restore')
    await expect(session.restoreVersion(saved.id)).rejects.toThrow()
    expect(restore).not.toHaveBeenCalled()
    expect(doc.getEditor().state.doc.textContent).toBe('保留当前正文')
    expect(await provider.list({ documentId: session.documentId })).toHaveLength(1)
  })

  it('supports a custom opaque binary codec with its receiver preserved', async () => {
    const codec = { records: [], encode(record) { this.records.push(record); return new Uint8Array([71]) }, decode(payload) { expect(payload[0]).toBe(71); return this.records[0] } }
    const { doc, session } = mount({ ...createMemoryVersioningProvider(), documentCodec: codec })
    const original = doc.getJSON(), saved = await session.createVersion()
    doc.setContent('<p>需要还原</p>')
    await session.restoreVersion(saved.id)
    expect(doc.getJSON()).toEqual(original)
  })

  it('roundtrips unicode when native text codecs are unavailable', () => {
    const { session } = mount()
    const record = session.getDocumentRecord()
    vi.stubGlobal('TextEncoder', undefined)
    vi.stubGlobal('TextDecoder', undefined)
    try { expect(decodeVersionDocument(encodeVersionDocument(record))).toEqual(record) }
    finally { vi.unstubAllGlobals() }
  })

  it('invalidates the current-version marker after edits, including edits by restoration subscribers', async () => {
    const { doc, session } = mount()
    const saved = await session.createVersion()
    expect(session.getCurrentVersionId()).toBe(saved.id)
    doc.setContent('<p>新编辑</p>')
    expect(session.getCurrentVersionId()).toBe(null)
    session.on('version-restored', () => doc.setContent('<p>回调产生的新编辑</p>'))
    await session.restoreVersion(saved.id)
    expect(session.getCurrentVersionId()).toBe(null)
    expect(doc.getEditor().state.doc.textContent).toBe('回调产生的新编辑')
  })

  it('keeps a reopened save dialog draft when an earlier save acknowledgement arrives', async () => {
    const memory = createMemoryVersioningProvider()
    let release
    const provider = { ...memory, createSnapshot: (...args) => new Promise(resolve => { release = async () => resolve(await memory.createSnapshot(...args)) }) }
    const { doc } = mount(provider)
    const host = doc._handle.nativeHost.host
    host.openSaveVersionDialog()
    host.saveVersionName = '第一次保存'
    const pending = host.confirmSaveVersion()
    await vi.waitFor(() => expect(typeof release).toBe('function'))
    host.closeSaveVersionDialog()
    host.openSaveVersionDialog()
    host.saveVersionName = '再次打开的草稿'
    await release()
    await pending
    expect(host.saveVersionOpen).toBe(true)
    expect(host.saveVersionName).toBe('再次打开的草稿')
    expect(host.saveVersionBusy).toBe(false)
  })

  it('does not mark a restore record current when a synchronous update subscriber edits its body', async () => {
    const { doc, session } = mount()
    const saved = await session.createVersion()
    doc.setContent('<p>还原前正文</p>')
    let armed = true
    doc.getEditor().on('update', () => { if (armed) { armed = false; doc.setContent('<p>update 订阅者的新编辑</p>') } })
    await session.restoreVersion(saved.id)
    expect(doc.getEditor().state.doc.textContent).toBe('update 订阅者的新编辑')
    expect(session.getCurrentVersionId()).toBe(null)
  })

  it('restores the exact snapshot in suggestion mode instead of creating new insertion revisions', async () => {
    const { doc, session } = mount()
    const original = doc.getJSON(), saved = await session.createVersion()
    doc.setContent('<p>还原前正文</p>')
    const modified = doc.getJSON(), host = doc._handle.nativeHost.host
    host.mode = 'suggest'
    host.applyInteractionMode()
    await session.restoreVersion(saved.id)
    expect(doc.getJSON()).toEqual(original)
    doc.getEditor().commands.undo()
    expect(doc.getJSON()).toEqual(modified)
    doc.getEditor().commands.redo()
    expect(doc.getJSON()).toEqual(original)
  })

  it('disables only version saving in readonly menus and updates the same row after editing is enabled', async () => {
    const { doc } = mount()
    const root = doc._handle.nativeHost.host.$refs.root
    doc.setReadonly(true)
    const trigger = root.querySelector('[aria-label="文档更多操作"]')
    trigger.click()
    const rows = [...document.querySelectorAll('[role="listbox"][aria-label="文档更多操作"] [role="option"]')]
    await vi.waitFor(() => expect(rows[0].disabled).toBe(true))
    expect(rows[1].disabled).toBe(false)
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(root.querySelector('.lark-doc-save-version-mask')).toBe(null)
    doc.setReadonly(false)
    await vi.waitFor(() => expect(rows[0].disabled).toBe(false))
    rows[0].click()
    expect(root.querySelector('.lark-doc-save-version-mask')).not.toBe(null)
  })

  it.each(['offline', 'allowlist'])('rechecks current %s resource policy after an awaited provider restore', async mode => {
    const memory = createMemoryVersioningProvider()
    let release
    const provider = { ...memory, restore: (...args) => new Promise(resolve => { release = async () => resolve(await memory.restore(...args)) }) }
    const { doc, session } = mount(provider, { content: { type: 'doc', content: [{ type: 'bookmark', attrs: {
      url: 'https://blocked.example/', title: '带远程封面的旧版本', cover: 'https://blocked.example/cover.png', favicon: 'https://blocked.example/icon.png',
    } }] } })
    const saved = await session.createVersion()
    doc.setContent('<p>还原前正文</p>')
    const pending = session.restoreVersion(saved.id)
    await vi.waitFor(() => expect(typeof release).toBe('function'))
    doc.patchProps({ config: { network: { mode, allowlist: ['allowed.example'] } } })
    await release()
    await pending
    expect(doc.getHTML()).not.toContain('https://blocked.example/cover.png')
    expect(doc.getHTML()).not.toContain('https://blocked.example/icon.png')
    expect(document.querySelector('[style*="blocked.example"]')).toBe(null)
  })
})


describe('版本保存框上下文失效边界', () => {
  it('同一session的普通视图刷新不清空刚打开的保存框', async () => {
    const { doc } = mount()
    const host = doc._handle.nativeHost.host
    host.openSaveVersionDialog()
    host.saveVersionName = '保留版本名称'
    host.$forceUpdate()
    await host.$nextTick()
    expect(host.saveVersionOpen).toBe(true)
    expect(host.saveVersionName).toBe('保留版本名称')
  })
  it('同一页面的两个保存框各自关联自己的版本名输入', async () => {
    const first = mount(), second = mount()
    first.doc._handle.nativeHost.host.openSaveVersionDialog()
    second.doc._handle.nativeHost.host.openSaveVersionDialog()
    await first.doc._handle.nativeHost.host.$nextTick()
    await second.doc._handle.nativeHost.host.$nextTick()
    const inputs = [...document.querySelectorAll('.lark-doc-save-version-input')]
    expect(inputs).toHaveLength(2)
    expect(new Set(inputs.map(input => input.id)).size).toBe(2)
    for (const input of inputs) {
      expect(input.labels).toHaveLength(1)
      expect(input.labels[0].control).toBe(input)
    }
  })
  it('真实文档标识变化仍关闭保存框', async () => {
    const { doc } = mount()
    const host = doc._handle.nativeHost.host
    host.openSaveVersionDialog()
    doc.patchProps({ documentId: 'changed-document' })
    await host.$nextTick()
    expect(host.saveVersionOpen).toBe(false)
  })
  it('真实替换versioning provider仍关闭旧保存框并清除草稿', async () => {
    const { doc, session } = mount()
    const host = doc._handle.nativeHost.host
    host.openSaveVersionDialog()
    host.saveVersionName = '旧服务草稿'
    session.setProvider('versioning', createMemoryVersioningProvider())
    await host.$nextTick()
    expect(host.saveVersionOpen).toBe(false)
    expect(host.saveVersionName).toBe('')
  })
})
