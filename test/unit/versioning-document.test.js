// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { undoDepth, redoDepth } from '@tiptap/pm/history'
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
  // 本文件验证的是「版本能力」本身（保存 / 预览 / 还原链路），所以显式打开入口开关；
  // 「入口缺省关闭」那一层由 workspace-view-state 的单测覆盖。
  const doc = new LarkDoc({
    element, storage: 'none', session,
    config: { features: { versionHistory: true } },
    content: '<p data-block-id="version_p">历史正文中文😀</p>', ...extra,
  })
  mounted.push(() => { doc.destroy(); element.remove() })
  return { doc, session, provider, element }
}

describe('version document lifecycle through the real facade and provider', () => {
  it('reads an authorized tagged snapshot without trusting a supplied record or changing the live body', async () => {
    const { doc, session, provider } = mount()
    const before = doc.getJSON()
    const saved = await provider.createSnapshot({ documentId: session.documentId, author: 'version-owner', kind: 'manual',
      payload: encodeVersionDocument(session.getDocumentRecord()), createdAt: 1000 })
    const projection = await session.readVersionDocument(saved.id, { documentId: 'other', content: { type: 'doc' } })
    expect(projection.content).toEqual(before)
    expect(doc.getJSON()).toEqual(before)
    session._capabilities.canView = false
    await expect(session.readVersionDocument(saved.id)).rejects.toThrow(/权限|失效/)
  })

  it('renders decoded history in the native panel and navigates real changes without selecting another version', async () => {
    const { doc, session, provider, element } = mount()
    const original = session.getDocumentRecord()
    const older = await provider.createSnapshot({ documentId: session.documentId, author: 'version-owner', kind: 'manual', payload: encodeVersionDocument(original), createdAt: 1000 })
    const frozen = { ...original, content: { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'frozen' }, content: [{ type: 'text', text: '冻结版本正文' }] }] } }
    const newer = await provider.createSnapshot({ documentId: session.documentId, author: 'version-owner', kind: 'manual', payload: encodeVersionDocument(frozen), createdAt: 2000 })
    provider.diff = vi.fn(async () => ({ algorithm: 'json-pointer-v1', from: { versionId: older.id }, to: { versionId: newer.id }, changes: [
      { kind: 'replace', path: '/content/0/content/0/text', before: '历史正文中文😀', after: '冻结版本正文' },
      { kind: 'replace', path: '/content/0/attrs/blockId', before: 'version_p', after: 'frozen' },
    ] }))
    const host = doc._handle.nativeHost.host, before = doc.getJSON()
    await host.openVersionPanel()
    await vi.waitFor(() => expect(element.querySelector('[aria-label="历史版本正文"]')?.textContent).toBe('冻结版本正文'))
    expect(element.querySelector('[aria-label="历史版本正文"]').getAttribute('contenteditable')).toBe('false')
    const next = element.querySelector('[aria-label="下一项编辑"]')
    next.click(); next.click()
    await vi.waitFor(() => expect(host.versionChangeIndex).toBe(2))
    expect(host.versionSelectedId).toBe(newer.id)
    expect(doc.getJSON()).toEqual(before)
    expect(provider.diff).toHaveBeenCalledWith(older.id, newer.id)
    host.closeVersionPanel(); host.refreshPanels()
    expect(element.querySelector('[aria-label="历史版本正文"]')).toBeNull()
    expect(session.getEditor()).toBe(doc.getEditor())
  })

  it('opens a phone history list, expands a day and returns through the readonly preview to its source', async () => {
    const width = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    try {
      const { doc, session, provider, element } = mount()
      for (let index = 0; index < 4; index++) await provider.createSnapshot({ documentId: session.documentId, author: 'version-owner', kind: 'manual',
        payload: encodeVersionDocument(session.getDocumentRecord()), createdAt: 1000 + index, label: `保存版本 ${index}` })
      const host = doc._handle.nativeHost.host, before = doc.getJSON()
      await host.openVersionPanel()
      const layer = element.querySelector('.lark-doc-version-layer')
      expect(layer.classList.contains('is-phone-list')).toBe(true)
      expect(layer.querySelectorAll('.lark-doc-version-item')).toHaveLength(3)
      layer.querySelector('.lark-doc-version-more-history').click()
      expect(layer.querySelectorAll('.lark-doc-version-item')).toHaveLength(4)
      layer.querySelector('.lark-doc-version-item').click()
      await vi.waitFor(() => expect(layer.classList.contains('is-phone-preview')).toBe(true))
      const previewBack = layer.querySelector('[aria-label="返回版本列表"]')
      expect(previewBack).not.toBeNull()
      previewBack.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      expect(layer.classList.contains('is-phone-list')).toBe(true)
      const listBack = layer.querySelector('[aria-label="返回文档"]')
      expect(listBack).not.toBeNull()
      listBack.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      await vi.waitFor(() => expect(element.querySelector('.lark-doc-version-layer')).toBeNull())
      expect(doc.getJSON()).toEqual(before)
    } finally { Object.defineProperty(window, 'innerWidth', { configurable: true, value: width }) }
  })

  it.each(['permission', 'document', 'provider', 'dispose'])('rejects a late decoded snapshot after %s changes', async change => {
    const { session, provider } = mount()
    const saved = await provider.createSnapshot({ documentId: session.documentId, author: 'version-owner', kind: 'manual',
      payload: encodeVersionDocument(session.getDocumentRecord()), createdAt: 1000 })
    const record = await provider.get(saved.id)
    let release
    provider.get = () => new Promise(resolve => { release = () => resolve(record) })
    const pending = session.readVersionDocument(saved.id)
    if (change === 'permission') session._capabilities.canView = false
    if (change === 'document') session.documentId = 'other-document'
    if (change === 'provider') session.setProvider('versioning', createMemoryVersioningProvider())
    if (change === 'dispose') await session.dispose()
    release()
    await expect(pending).rejects.toThrow(/权限|失效/)
  })

  it.each(['opaque', 'foreign', 'invalid'])('rejects %s readonly content without applying it to the source', async kind => {
    const { doc, session, provider } = mount()
    const before = doc.getJSON(), original = session.getDocumentRecord()
    const saved = await provider.createSnapshot({ documentId: session.documentId, author: 'version-owner', kind: 'manual',
      payload: kind === 'opaque' ? new Uint8Array([1, 2, 3]) : encodeVersionDocument({ ...original,
        ...(kind === 'foreign' ? { documentId: 'other-document' } : {}),
        ...(kind === 'invalid' ? { content: { type: 'doc', content: [{ type: 'image', attrs: { src: 'javascript:alert(1)' } }] } } : {}),
      }), createdAt: 1000 })
    await expect(session.readVersionDocument(saved.id)).rejects.toThrow()
    expect(doc.getJSON()).toEqual(before)
  })

  it('removes an already rendered readonly preview when read access is revoked', async () => {
    const { doc, session, provider, element } = mount()
    await provider.createSnapshot({ documentId: session.documentId, author: 'version-owner', kind: 'manual',
      payload: encodeVersionDocument(session.getDocumentRecord()), createdAt: 1000 })
    const host = doc._handle.nativeHost.host
    await host.openVersionPanel()
    await vi.waitFor(() => expect(element.querySelector('[aria-label="历史版本正文"]')).not.toBeNull())
    session._capabilities.canView = false; host.refreshPanels()
    expect(element.querySelector('[aria-label="历史版本正文"]')).toBeNull()
  })

  it('requires a visible restore confirmation, cancels without writing and confirms the captured target only once', async () => {
    const { doc, session, provider, element } = mount()
    const saved = await provider.createSnapshot({ documentId: session.documentId, author: 'version-owner', kind: 'manual', label: '确认目标版本',
      payload: encodeVersionDocument(session.getDocumentRecord()), createdAt: 1000 })
    const restore = vi.spyOn(session, 'restoreVersion').mockRejectedValue(new Error('仅核调用，未执行恢复'))
    const host = doc._handle.nativeHost.host
    await host.openVersionPanel()
    const open = () => element.querySelector('.lark-doc-version-restore').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    open(); expect(restore).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(element.querySelector('[aria-label="还原历史版本确认"]')).not.toBeNull())
    expect(element.querySelector('[aria-label="还原历史版本确认"]').textContent).toContain('确认目标版本')
    element.querySelector('[aria-label="取消还原"]').click()
    expect(restore).not.toHaveBeenCalled()
    open(); await vi.waitFor(() => expect(element.querySelector('[aria-label="还原历史版本确认"]')).not.toBeNull())
    element.querySelector('[aria-label="还原历史版本确认"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(restore).not.toHaveBeenCalled()
    open(); await vi.waitFor(() => expect(element.querySelector('[aria-label="确认还原"]')).not.toBeNull())
    const confirm = element.querySelector('[aria-label="确认还原"]'); confirm.click(); confirm.click()
    await vi.waitFor(() => expect(restore).toHaveBeenCalledExactlyOnceWith(saved.id))
    expect(element.querySelector('[aria-label="还原历史版本确认"]')).toBeNull()
  })

  it.each(['target', 'permission', 'document', 'close'])('blocks a captured restore after %s changes without invoking the write service', async change => {
    const { doc, session, provider } = mount()
    const saved = await provider.createSnapshot({ documentId: session.documentId, author: 'version-owner', kind: 'manual',
      payload: encodeVersionDocument(session.getDocumentRecord()), createdAt: 1000 })
    const host = doc._handle.nativeHost.host, restore = vi.spyOn(session, 'restoreVersion').mockRejectedValue(new Error('禁止恢复写入'))
    await host.openVersionPanel(); expect(host.requestVersionRestore()).toBe(true)
    const record = await provider.get(saved.id)
    let release
    provider.get = () => new Promise(resolve => { release = () => resolve(record) })
    const pending = host.confirmVersionRestore()
    if (change === 'target') host.versionSelectedId = 'other-version'
    if (change === 'permission') session._capabilities.canRestoreVersion = false
    if (change === 'document') session.documentId = 'changed-document'
    if (change === 'close') host.closeVersionPanel()
    if (release) release()
    await pending
    expect(restore).not.toHaveBeenCalled()
  })

  it('removes an open restore confirmation on capability loss and rejects its retired confirm button', async () => {
    const { doc, session, provider, element } = mount()
    await provider.createSnapshot({ documentId: session.documentId, author: 'version-owner', kind: 'manual',
      payload: encodeVersionDocument(session.getDocumentRecord()), createdAt: 1000 })
    const host = doc._handle.nativeHost.host, restore = vi.spyOn(session, 'restoreVersion').mockRejectedValue(new Error('禁止恢复写入'))
    await host.openVersionPanel(); host.requestVersionRestore(); host.refreshPanels()
    const retired = element.querySelector('[aria-label="确认还原"]')
    expect(retired).not.toBeNull()
    session._capabilities.canRestoreVersion = false; host.refreshPanels()
    expect(element.querySelector('[aria-label="还原历史版本确认"]')).toBeNull()
    retired.click(); await Promise.resolve()
    expect(restore).not.toHaveBeenCalled()
  })

  it.each(['offline', 'allowlist'])('replaces an already mounted readonly preview when the current %s network policy changes', async mode => {
    const { doc, session, provider, element } = mount()
    const record = { ...session.getDocumentRecord(), content: { type: 'doc', content: [{ type: 'bookmark', attrs: {
      url: 'https://blocked.example/', title: '冻结封面', cover: 'https://blocked.example/cover.png', favicon: 'https://blocked.example/icon.png',
    } }] } }
    await provider.createSnapshot({ documentId: session.documentId, author: 'version-owner', kind: 'manual', payload: encodeVersionDocument(record), createdAt: 1000 })
    const host = doc._handle.nativeHost.host, before = doc.getJSON()
    await host.openVersionPanel()
    await vi.waitFor(() => expect(element.querySelector('.lark-doc-version-document [style*="blocked.example"]')).not.toBeNull())
    const previous = element.querySelector('[aria-label="历史版本正文"]')
    doc.patchProps({ config: { network: { mode, allowlist: ['allowed.example'] } } })
    await vi.waitFor(() => expect(element.querySelector('.lark-doc-version-document [style*="blocked.example"]')).toBeNull())
    expect(previous.isConnected).toBe(false)
    expect(doc.getJSON()).toEqual(before)
  })
  it('restores a paged document with public content and retains the current version marker', async () => {
    const { doc, session } = mount()
    await doc.setContentAsync('<h1>version</h1>' + '<p>body</p>'.repeat(12), { pagedView: true, pageBlocks: 2, yieldToMain: async () => {} })
    const before = doc.getJSON(), saved = await session.createVersion({ label: 'paged' })
    doc.getEditor().commands.insertContentAt(2, 'edit')
    const restored = await session.restoreVersion(saved.id)
    expect(doc.getJSON()).toEqual(before)
    expect(session.getCurrentVersionId()).toBe(restored.id)
    expect(JSON.stringify(doc.getJSON())).not.toContain('documentSegment')
  })
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

  it('automatic snapshots reach the real binary provider and the panel previews them', async () => {
    const { doc, session, provider } = mount()
    const host = doc._handle.nativeHost.host
    const saved = await session.createVersion({ purpose: 'auto' })
    expect(saved.payload).toBeInstanceOf(Uint8Array)
    const list = await provider.list({ documentId: 'versions_document' })
    expect(list.map(record => record.id)).toContain(saved.id)
    await host.selectVersion(saved.id)
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

  it('gates 另存为版本 by writability while 查看已存版本 stays enabled in readonly menus', async () => {
    const { doc } = mount()
    const host = doc._handle.nativeHost.host
    doc.setReadonly(true)
    host.topbarMoreOpen = true
    await host.$nextTick()
    let items = host.topbarMoreItems
    // 飞书桌面端「更多」里这一项是在的（B18 依截图加回），只读时禁用而不是消失。
    expect(items.find(item => item.label === '另存为版本').enabled).toBe(false)
    const versionItem = items.find(item => item.id === 'view-versions' || item.id === 'saved-versions')
    expect(versionItem.enabled).toBe(true)
    doc.setReadonly(false)
    await host.$nextTick()
    items = host.topbarMoreItems
    expect(items.find(item => item.label === '另存为版本').enabled).toBe(true)
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


describe('历史面板上下文失效边界', () => {
  it('同一session的普通视图刷新不清空刚打开的历史面板', async () => {
    const { doc } = mount()
    const host = doc._handle.nativeHost.host
    host.openVersionPanel()
    host.$forceUpdate()
    await host.$nextTick()
    expect(host.versionPanelOpen).toBe(true)
  })
  it('真实文档标识变化后历史面板按新文档重载而不是留着旧列表', async () => {
    const { doc } = mount()
    const host = doc._handle.nativeHost.host
    await host.openVersionPanel()
    host.versionSelectedId = host.versionList[0]?.id || ''
    doc.patchProps({ documentId: 'changed-document' })
    await host.$nextTick()
    expect(host.versionSelectedId).toBe('')
    expect(host.versionList).toEqual([])
  })
  it('真实替换versioning provider仍清空旧选中与旧列表', async () => {
    const { doc, session } = mount()
    const host = doc._handle.nativeHost.host
    await host.openVersionPanel()
    host.versionSelectedId = host.versionList[0]?.id || ''
    session.setProvider('versioning', createMemoryVersioningProvider())
    await host.$nextTick()
    expect(host.versionSelectedId).toBe('')
    expect(host.versionList).toEqual([])
  })
})


describe('T077 local public versioning admission', () => {
  function publicDocument(provider = createMemoryVersioningProvider(), user = { id: 'qa-t077', name: 'QA version owner' }) {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, storage: 'none', documentId: 't077_local_versions',
      user, versioning: provider, title: '公开入口版本标题', content: '<p data-block-id="t077_original">公开入口正文中文😀</p>' })
    mounted.push(() => { doc.destroy(); element.remove() })
    return { doc, session: doc.getSession(), provider }
  }

  it('creates a readable binary manual snapshot using the actual facade user and supplied title', async () => {
    const { doc, session, provider } = publicDocument()
    const original = doc.getJSON(), title = doc.getTitle()
    expect(session.user.id).toBe('qa-t077')
    const saved = await session.createVersion({ label: '公开入口创建的版本', title })
    expect(saved).toMatchObject({ documentId: session.documentId, author: 'qa-t077', kind: 'manual', label: '公开入口创建的版本' })
    expect(saved.payload).toBeInstanceOf(Uint8Array)
    doc.setContent('<p data-block-id="t077_current">保持当前正文</p>')
    const read = await session.readVersionDocument(saved.id)
    expect(read).toMatchObject({ documentId: session.documentId, title, content: original })
    expect(doc.getEditor().state.doc.textContent).toBe('保持当前正文')
    expect(await provider.list({ documentId: session.documentId })).toHaveLength(1)
  })

  it('uses the current actor for public restore and keeps the source snapshot immutable', async () => {
    const { doc, session, provider } = publicDocument()
    const record = session.getDocumentRecord({ title: doc.getTitle() })
    const source = await provider.createSnapshot({ documentId: session.documentId, author: 'original-snapshot-author', kind: 'manual',
      label: '不可变原版本', payload: encodeVersionDocument(record) })
    const restored = await session.restoreVersion(source.id)
    expect(restored).toMatchObject({ documentId: session.documentId, author: 'qa-t077', kind: 'restore' })
    expect(restored.id).not.toBe(source.id)
    expect((await session.readVersionDocument(restored.id))).toEqual(record)
    expect(await provider.get(source.id)).toEqual(source)
    expect(await provider.list({ documentId: session.documentId })).toHaveLength(2)
  })

  it('does not invent an author when neither the session nor the local provider supplies one', async () => {
    const { session, provider } = publicDocument(createMemoryVersioningProvider(), null)
    await expect(session.createVersion({ title: '无身份', label: '不能保存' })).rejects.toMatchObject({ code: 'E_SNAPSHOT_AUTHOR' })
    expect(await provider.list({ documentId: session.documentId })).toEqual([])
    const source = await provider.createSnapshot({ documentId: session.documentId, author: 'known-original-author', kind: 'manual',
      payload: encodeVersionDocument(session.getDocumentRecord()) })
    await expect(session.restoreVersion(source.id)).rejects.toMatchObject({ code: 'E_SNAPSHOT_AUTHOR' })
    expect(await provider.list({ documentId: session.documentId })).toHaveLength(1)
  })

  it.each(['permission', 'document', 'provider', 'destroy', 'identity', 'identity-aba', 'authorization-aba'])('rejects local encoding after %s retirement before any provider write', async change => {
    const memory = createMemoryVersioningProvider()
    let release
    const encode = vi.fn(record => new Promise(resolve => { release = () => resolve(encodeVersionDocument(record)) }))
    const createSnapshot = vi.fn(record => memory.createSnapshot(record))
    const provider = { ...memory, createSnapshot, documentCodec: { encode, decode: decodeVersionDocument } }
    const { doc, session } = publicDocument(provider)
    const pending = session.createVersion({ label: '编码中不可越权保存', title: doc.getTitle() })
    // Observe rejection immediately: the unchanged implementation currently fails
    // before it ever calls encode, and that RED must not become an unhandled rejection.
    const outcome = pending.then(value => ({ value }), error => ({ error }))
    await Promise.resolve(); await Promise.resolve()
    expect(encode).toHaveBeenCalledOnce()
    expect(createSnapshot).not.toHaveBeenCalled()
    if (change === 'permission') session._capabilities.canCreateVersion = false
    if (change === 'document') session.documentId = 't077_other_document'
    if (change === 'provider') session.setProvider('versioning', createMemoryVersioningProvider())
    if (change === 'destroy') doc.destroy()
    if (change === 'identity' || change === 'identity-aba') session.user = { id: 'retired-other-actor' }
    if (change === 'identity-aba') session.user = { id: 'qa-t077' }
    if (change === 'authorization-aba') session._authorizationGeneration += 2
    release()
    const result = await outcome
    expect(result.error).toBeInstanceOf(Error)
    expect(result.value).toBeUndefined()
    expect(createSnapshot).not.toHaveBeenCalled()
    expect(await memory.list({ documentId: 't077_local_versions' })).toEqual([])
    if (change !== 'destroy') expect(doc.getEditor().state.doc.textContent).toBe('公开入口正文中文😀')
  })

  it('preserves strict binary validation for an explicitly supplied JSON payload', async () => {
    const memory = createMemoryVersioningProvider(), encode = vi.fn(encodeVersionDocument)
    const provider = { ...memory, documentCodec: { encode, decode: decodeVersionDocument } }
    const { doc, session } = publicDocument(provider)
    await expect(session.createVersion({ author: 'qa-t077', kind: 'manual', payload: doc.getJSON() })).rejects.toMatchObject({ code: 'E_SNAPSHOT_JSON_NOT_ALLOWED' })
    expect(encode).not.toHaveBeenCalled()
    expect(await memory.list({ documentId: session.documentId })).toEqual([])
  })

  it('keeps remote create and restore inputs unchanged and never runs the local codec', async () => {
    const encode = vi.fn(() => { throw new Error('remote must not encode a client snapshot') })
    const createSnapshot = vi.fn(async () => ({ id: 'remote-created' })), restore = vi.fn(async () => ({ id: 'remote-restored' }))
    const remote = { isRemote: true, list: async () => [], get: async () => null, createSnapshot, restore,
      documentCodec: { encode, decode: decodeVersionDocument } }
    const { session } = publicDocument(remote)
    const record = session.getDocumentRecord()
    vi.spyOn(session, 'getDocumentRecord').mockReturnValue(record)
    const meta = { label: '由服务端捕获正文' }
    await session.createVersion(meta)
    expect(createSnapshot).toHaveBeenCalledExactlyOnceWith({ ...record, ...meta })
    const sent = createSnapshot.mock.calls[0][0]
    for (const key of ['payload', 'kind', 'author']) expect(sent).not.toHaveProperty(key)
    await session.restoreVersion('server-owned-version')
    expect(restore).toHaveBeenCalledExactlyOnceWith('server-owned-version', { documentId: session.documentId })
    expect(encode).not.toHaveBeenCalled()
  })
})


describe('T077 local version handoff regressions', () => {
  it('detaches the old session and keeps real save and restore working after patchProps swaps the session', async () => {
    const { doc, session: previous } = mount()
    const memory = createMemoryVersioningProvider()
    const next = createDocumentSession({ documentId: 'replacement_version_document', user: { id: 'replacement-owner' }, providers: { versioning: memory } })
    mounted.push(() => next.dispose())
    const editor = doc.getEditor(), original = doc.getJSON()
    doc.patchProps({ session: next })
    expect(doc.getSession()).toBe(next)
    expect(previous.getEditor()).toBeNull()
    expect(next.getEditor()).toBe(editor)
    const saved = await next.createVersion({ label: '替换会话后的版本' })
    expect(saved.author).toBe('replacement-owner')
    doc.setContent('<p data-block-id="after_session_swap">替换会话后的新编辑</p>')
    await next.restoreVersion(saved.id)
    expect(doc.getJSON()).toEqual(original)
    expect(next.getEditor()).toBe(editor)
    expect(previous.getEditor()).toBeNull()
  })

  it.each(['payload', 'content'])('does not mark an explicit different %s snapshot as the live current version or disable its restore action', async field => {
    const { doc, session } = mount()
    const content = { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'explicit_other_body' }, content: [{ type: 'text', text: '另一个合法版本的正文' }] }] }
    const meta = { label: '显式指定的其他版本', [field]: field === 'payload'
      ? encodeVersionDocument({ ...session.getDocumentRecord(), content }) : content }
    const saved = await session.createVersion(meta)
    expect(session.getCurrentVersionId()).not.toBe(saved.id)
    const host = doc._handle.nativeHost.host
    await host.openVersionPanel()
    await host.selectVersion(saved.id)
    expect(host.versionPreview.document.content).toEqual(content)
    expect(host.versionRestoreDisabled).toBe(false)
  })

  it.each(['actor', 'provider'])('retires restoration publication when a synchronous apply subscriber changes the %s', async change => {
    const { doc, session, provider } = mount()
    const saved = await session.createVersion({ label: '同步apply前版本' })
    doc.setContent('<p>还原前当前正文</p>')
    const restore = vi.spyOn(provider, 'restore'), published = vi.fn()
    session.on('version-restored', published)
    let armed = true
    doc.getEditor().on('update', () => {
      if (!armed) return
      armed = false
      if (change === 'actor') session.user = { id: 'new-actor-during-apply' }
      else session.setProvider('versioning', createMemoryVersioningProvider())
    })
    await expect(session.restoreVersion(saved.id)).rejects.toThrow(/失效|权限/)
    expect(armed).toBe(false)
    // The provider already committed before the local apply subscriber ran.
    expect(restore).toHaveBeenCalledOnce()
    expect(await provider.list({ documentId: 'versions_document' })).toHaveLength(2)
    expect(published).not.toHaveBeenCalled()
    expect(session.getCurrentVersionId()).toBeNull()
    const committed = await restore.mock.results[0].value
    expect(session._currentVersion?.id).not.toBe(committed.id)
  })

  it('does not call the provider when the local asynchronous encoder fails', async () => {
    const memory = createMemoryVersioningProvider(), failure = new Error('OWNED_ASYNC_VERSION_ENCODING_FAILURE')
    const encode = vi.fn(async () => { throw failure }), createSnapshot = vi.fn(record => memory.createSnapshot(record))
    const { doc, session } = mount({ ...memory, createSnapshot, documentCodec: { ...memory.documentCodec, encode } })
    const before = doc.getJSON()
    await expect(session.createVersion()).rejects.toBe(failure)
    expect(encode).toHaveBeenCalledOnce()
    expect(createSnapshot).not.toHaveBeenCalled()
    expect(await memory.list({ documentId: session.documentId })).toEqual([])
    expect(doc.getJSON()).toEqual(before)
  })

  it('rejects foreign document metadata before encoding or provider write', async () => {
    const memory = createMemoryVersioningProvider(), encode = vi.fn(encodeVersionDocument), createSnapshot = vi.fn(record => memory.createSnapshot(record))
    const { session } = mount({ ...memory, createSnapshot, documentCodec: { encode, decode: decodeVersionDocument } })
    await expect(session.createVersion({ documentId: 'foreign_document' })).rejects.toThrow(/当前文档|不属于/)
    expect(encode).not.toHaveBeenCalled()
    expect(createSnapshot).not.toHaveBeenCalled()
    expect(await memory.list({ documentId: 'foreign_document' })).toEqual([])
  })

  it.each([{ author: null, code: 'E_SNAPSHOT_AUTHOR' }, { kind: 'invented-kind', code: 'E_SNAPSHOT_KIND' }])('keeps explicit invalid metadata strict: $code', async ({ code, ...meta }) => {
    const { doc, session, provider } = mount()
    const before = doc.getJSON()
    await expect(session.createVersion(meta)).rejects.toMatchObject({ code })
    expect(await provider.list({ documentId: session.documentId })).toEqual([])
    expect(doc.getJSON()).toEqual(before)
  })

  it('rejects local JSON restoration in collaborative mode without calling restore or replacing the body', async () => {
    const memory = createMemoryVersioningProvider({ author: 'explicit-provider-author' })
    const { doc, session } = mount(memory)
    const saved = await memory.createSnapshot({ documentId: session.documentId, author: 'source-author', kind: 'manual', payload: encodeVersionDocument(session.getDocumentRecord()) })
    const before = doc.getJSON(), restore = vi.spyOn(memory, 'restore')
    session.mode = 'collaborative'
    await expect(session.restoreVersion(saved.id)).rejects.toThrow(/协作|持久/)
    expect(restore).not.toHaveBeenCalled()
    expect(await memory.list({ documentId: session.documentId })).toHaveLength(1)
    expect(doc.getJSON()).toEqual(before)
  })
})


describe('T077 local provider confirmation admission', () => {
  it.each(['null', 'unknown', 'pending', 'coordinating', 'bare-id', 'foreign-document', 'source-id'])('does not apply or publish a local restore with a %s result', async kind => {
    const { doc, session, provider } = mount()
    const original = doc.getJSON(), source = await session.createVersion({ label: '合法原版本' })
    doc.getEditor().commands.setTextSelection(doc.getEditor().state.doc.content.size - 1)
    doc.insertText('保留当前编辑与撤销记录')
    const current = await session.createVersion({ label: '仍然有效的当前版本' })
    const before = doc.getJSON(), history = [undoDepth(doc.getEditor().state), redoDepth(doc.getEditor().state)]
    expect(before).not.toEqual(original)
    expect(session.getCurrentVersionId()).toBe(current.id)
    const full = { ...await provider.get(source.id), id: 'unconfirmed-restored-version', kind: 'restore' }
    const result = kind === 'null' ? null : kind === 'bare-id' ? { id: 'unconfirmed-bare-id' }
      : kind === 'foreign-document' ? { ...full, documentId: 'a_different_document' }
        : kind === 'source-id' ? { ...full, id: source.id } : { ...full, status: kind }
    const restore = vi.spyOn(provider, 'restore').mockResolvedValue(result), published = vi.fn()
    session.on('version-restored', published)
    await expect(session.restoreVersion(source.id)).rejects.toMatchObject({ status: 'unknown' })
    expect(restore).toHaveBeenCalledExactlyOnceWith(source.id, { documentId: session.documentId, author: 'version-owner' })
    expect(doc.getJSON()).toEqual(before)
    expect([undoDepth(doc.getEditor().state), redoDepth(doc.getEditor().state)]).toEqual(history)
    expect(session.getCurrentVersionId()).toBe(current.id)
    expect(published).not.toHaveBeenCalled()
    expect(doc.getEditor().commands.undo()).toBe(true)
    expect(doc.getJSON()).toEqual(original)
    expect(doc.getEditor().commands.redo()).toBe(true)
    expect(doc.getJSON()).toEqual(before)
  })

  it('does not replace a confirmed current marker or emit success when local createSnapshot is still pending', async () => {
    const { doc, session, provider } = mount()
    const current = await session.createVersion({ label: '真实已确认版本' })
    const before = doc.getJSON(), record = await provider.get(current.id)
    const createSnapshot = vi.spyOn(provider, 'createSnapshot').mockResolvedValue({ ...record, id: 'pending-created-version', status: 'pending' })
    const published = vi.fn()
    session.on('version-created', published)
    await expect(session.createVersion({ label: '尚未确认的新版本' })).rejects.toMatchObject({ status: 'unknown' })
    expect(createSnapshot).toHaveBeenCalledOnce()
    expect(doc.getJSON()).toEqual(before)
    expect(session.getCurrentVersionId()).toBe(current.id)
    expect(published).not.toHaveBeenCalled()
  })
})


describe('T077 native local unknown-version query', () => {
  function localPort(action) {
    const memory = createMemoryVersioningProvider(), operationId = `owned-local-${action}-operation`, facts = {}
    const createSnapshot = vi.fn(async record => {
      const saved = await memory.createSnapshot(record)
      facts.created = saved
      return action === 'create' ? { status: 'unknown', operationId } : saved
    })
    const restore = vi.fn(async (...args) => {
      facts.restored = await memory.restore(...args)
      return { status: 'unknown', operationId }
    })
    const queryOperation = vi.fn(async key => ({ ...await memory.get(facts.created.id), status: 'committed', operationId: key }))
    const queryRestoreOperation = vi.fn(async key => ({ ...await memory.get(facts.restored.id), status: 'committed', operationId: key }))
    const provider = { ...memory, createSnapshot, restore, queryOperation, queryRestoreOperation }
    return { ...mount(provider), memory, operationId, facts, createSnapshot, restore, queryOperation, queryRestoreOperation }
  }
  const down = button => {
    expect(button).not.toBeNull()
    expect(button.disabled).toBe(false)
    button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  }
  async function pendingRestore() {
    const port = localPort('restore'), { doc, session, element, operationId } = port
    const original = doc.getJSON(), source = await session.createVersion({ label: '待查询恢复的原版本' })
    doc.insertText('等待确认前保留的当前编辑')
    const before = doc.getJSON(), host = doc._handle.nativeHost.host
    expect(before).not.toEqual(original)
    await host.openVersionPanel()
    const request = vi.spyOn(host, 'requestVersionRestore'), confirm = vi.spyOn(host, 'confirmVersionRestore')
    down(element.querySelector('.lark-doc-version-restore'))
    await vi.waitFor(() => expect(element.querySelector('[aria-label="确认还原"]')).not.toBeNull())
    const confirmButton = element.querySelector('[aria-label="确认还原"]')
    confirmButton.click()
    expect(confirm).toHaveBeenCalledOnce()
    await confirm.mock.results[0].value
    expect(host.versionRestorePending).toBe(true)
    expect(host.versionRestoreOperationId).toBe(operationId)
    expect(doc.getJSON()).toEqual(before)
    expect(doc.getEditor().isEditable).toBe(false)
    const query = async () => {
      await vi.waitFor(() => expect(element.querySelector('.lark-doc-version-restore')?.disabled).toBe(false))
      const calls = request.mock.calls.length
      down(element.querySelector('.lark-doc-version-restore'))
      expect(request).toHaveBeenCalledTimes(calls + 1)
      return request.mock.results.at(-1).value
    }
    return { ...port, host, source, original, before, query }
  }

  it('queries one real committed restore by its original key, applies the snapshot and releases only its own readonly lock', async () => {
    const port = await pendingRestore(), { doc, session, host, original, before, query, operationId } = port
    const published = vi.fn(); session.on('version-restored', published)
    await query()
    expect(port.queryRestoreOperation).toHaveBeenCalledExactlyOnceWith(operationId)
    expect(port.restore).toHaveBeenCalledOnce()
    expect(port.createSnapshot).toHaveBeenCalledOnce()
    expect(published).toHaveBeenCalledOnce()
    expect(host.versionRestorePending).toBe(false)
    expect(host.versionRestoreOperationId).toBe('')
    expect(host.versionNotice).toContain('已恢复')
    expect(doc.getEditor().isEditable).toBe(true)
    expect(doc.getJSON()).toEqual(original)
    expect(doc.getEditor().commands.undo()).toBe(true)
    expect(doc.getJSON()).toEqual(before)
  })

  it.each(['wrong-key', 'still-unknown', 'external-readonly', 'permission', 'body-change'])('does not apply, report success or blindly unlock a local restore query after %s', async change => {
    const port = await pendingRestore(), { doc, session, host, query, operationId } = port
    const published = vi.fn(); session.on('version-restored', published)
    const editable = vi.spyOn(doc.getEditor(), 'setEditable')
    let release
    port.queryRestoreOperation.mockImplementation(() => new Promise(resolve => { release = resolve }))
    const pending = query()
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    const result = { ...await port.memory.get(port.facts.restored.id), status: 'committed', operationId }
    if (change === 'wrong-key') result.operationId = 'different-restore-operation'
    if (change === 'still-unknown') result.status = 'unknown'
    if (change === 'external-readonly') doc.setReadonly(true)
    if (change === 'permission') session._capabilities.canRestoreVersion = false
    if (change === 'body-change') doc.setContent('<p data-block-id="later_pending_edit">查询期间新的正文编辑</p>')
    const expected = doc.getJSON(), history = [undoDepth(doc.getEditor().state), redoDepth(doc.getEditor().state)]
    release(result)
    await pending
    expect(port.queryRestoreOperation).toHaveBeenCalledExactlyOnceWith(operationId)
    expect(port.restore).toHaveBeenCalledOnce()
    expect(port.createSnapshot).toHaveBeenCalledOnce()
    expect(doc.getJSON()).toEqual(expected)
    expect([undoDepth(doc.getEditor().state), redoDepth(doc.getEditor().state)]).toEqual(history)
    expect(published).not.toHaveBeenCalled()
    expect(host.versionNotice).toBe('')
    expect(host.versionRestorePending).toBe(true)
    expect(host.versionRestoreOperationId).toBe(operationId)
    expect(doc.getEditor().isEditable).toBe(false)
    expect(editable.mock.calls.filter(([value]) => value === true)).toEqual([])
    if (change === 'external-readonly') expect(doc.isReadonly()).toBe(true)
  })
})

describe('automatic history recording', () => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
  /** 自动记录要自己配防抖，所以这条链单独建 session，不走 mount() 的默认会话。 */
  function mountAuto(autoSnapshot) {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const session = createDocumentSession({
      documentId: 'auto_versions',
      user: { id: 'auto-owner' },
      providers: { versioning: createMemoryVersioningProvider() },
      autoSnapshot,
    })
    const doc = new LarkDoc({ element, storage: 'none', session, content: '<p data-block-id="auto_p">基线</p>' })
    mounted.push(() => { doc.destroy(); element.remove() })
    return { doc, session, provider: session.getProvider('versioning') }
  }

  it('默认开启 2.5s 防抖与 60s 节流，只读或计数断言场景可关掉', () => {
    const { session } = mountAuto()
    expect(session.setAutoSnapshot()).toEqual({ enabled: true, debounce: 2500, minInterval: 60000 })
    expect(session.setAutoSnapshot({ enabled: false }).enabled).toBe(false)
  })

  it('编辑后无需另存为版本即落一条 auto 快照', async () => {
    const { doc, session, provider } = mountAuto({ debounce: 20, minInterval: 0 })
    const created = []
    session.on('version-created', event => created.push(event.kind))
    doc.getEditor().commands.insertContentAt(2, '自动记录')
    await sleep(150)
    const list = await provider.list({ documentId: session.documentId })
    expect(list).toHaveLength(1)
    expect(list[0].kind).toBe('auto')
    expect(created).toEqual(['auto'])
  })

  it('正文等价的替换被去重，不产生空记录', async () => {
    const { doc, session, provider } = mountAuto({ debounce: 20, minInterval: 0 })
    doc.getEditor().commands.insertContentAt(2, '自动记录')
    await sleep(150)
    const { state } = doc.getEditor()
    doc.getEditor().view.dispatch(state.tr.replace(0, state.doc.content.size, state.doc.slice(0, state.doc.content.size)))
    await sleep(150)
    expect((await provider.list({ documentId: session.documentId })).length).toBe(1)
  })

  it('关闭自动记录后编辑不再写盘，重新打开可继续', async () => {
    const { doc, session, provider } = mountAuto({ debounce: 20, minInterval: 0 })
    session.setAutoSnapshot({ enabled: false })
    doc.getEditor().commands.insertContentAt(2, '关闭期间')
    await sleep(150)
    expect((await provider.list({ documentId: session.documentId })).length).toBe(0)
    session.setAutoSnapshot({ enabled: true, debounce: 20, minInterval: 0 })
    doc.getEditor().commands.insertContentAt(2, '重新开启')
    await sleep(150)
    expect((await provider.list({ documentId: session.documentId })).length).toBe(1)
  })
})
