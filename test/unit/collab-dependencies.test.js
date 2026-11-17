// @vitest-environment jsdom

import { afterEach, expect, it, vi } from 'vitest'
import Module, { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

afterEach(() => {
  vi.doUnmock('@hocuspocus/provider')
  vi.resetModules()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('普通包不以未使用的协同peer阻止宿主安装', async () => {
  const { default: pkg } = await import('../../package.json')
  expect(pkg.peerDependencies || {}).not.toHaveProperty('@hocuspocus/provider')
  expect(pkg.collabDependencies['@hocuspocus/provider']).toBe('^4.7.1')
})

it('显式Hocuspocus桥拒绝不支持的Provider API，且在创建连接前失败', async () => {
  const constructed = vi.fn()
  vi.doMock('@hocuspocus/provider', () => ({ HocuspocusProvider: class {
    constructor() { constructed(); throw new Error('legacy provider constructed') }
  } }))
  const { createHocuspocusBridge } = await import('../../src/collab')
  expect(() => createHocuspocusBridge({ url: 'ws://127.0.0.1:1', documentId: 'fixture' })).toThrow(/attach\/detach/)
  expect(constructed).not.toHaveBeenCalled()
})

it('已安装支持组合保持Y.Doc单例与协同扩展的真实能力', async () => {
  const Y = await import('yjs')
  const { HocuspocusProvider } = await import('@hocuspocus/provider')
  const { createCollabExtensions, Yjs } = await import('../../src/collab')
  expect(Yjs.Doc).toBe(Y.Doc)
  const ydoc = new Yjs.Doc({ gc: false })
  try {
    const extensions = createCollabExtensions({ ydoc })
    expect(extensions).toHaveLength(1)
    expect(extensions[0].name).toBe('collaboration')
    expect(extensions[0].options.document).toBe(ydoc)
    expect(typeof HocuspocusProvider.prototype.attach).toBe('function')
    expect(typeof HocuspocusProvider.prototype.detach).toBe('function')
  } finally { ydoc.destroy() }
})

function getArtifactRoot() {
  const builtRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist')
  return process.env.LARK_DOC_ARTIFACT_ROOT || builtRoot
}

function blockCollabChunks(root, require) {
  const graph = JSON.parse(readFileSync(resolve(root, 'lark-doc-graph.json'), 'utf8')).collabCjs
  const deferred = new Set(Object.values(graph).flatMap(chunk => chunk.dynamicImports).filter(file => graph[file]).map(file => resolve(root, file)))
  expect(deferred.size).toBeGreaterThan(0)
  for (const file of deferred) delete require.cache[file]
  const load = Module._load
  return vi.spyOn(Module, '_load').mockImplementation(function(request, parent, isMain) {
    const path = request.startsWith('.') && parent?.filename ? resolve(dirname(parent.filename), request) : request
    if (deferred.has(path)) throw new Error('OWNED_TEST_COLLAB_CHUNK_UNAVAILABLE')
    return load.call(this, request, parent, isMain)
  })
}

it.each(['autoConnect', 'forceSync/READY'])('CJS协作 %s 冷块缺失保原ready，补块后显式入场才恢复', async mode => {
  const root = getArtifactRoot(), require = createRequire(resolve(root, '../package.json'))
  const runtime = require(resolve(root, 'lark-doc-collab.common.js'))
  const blocked = blockCollabChunks(root, require), onError = vi.fn()
  const bridge = runtime.createDurableCollaborationBridge({ url: 'ws://127.0.0.1:33333', tenantId: 'tenant', docId: 'doc',
    ...(mode === 'autoConnect' ? {} : { autoConnect: false }), presence: true, onError })
  const connect = vi.spyOn(bridge.provider.configuration.websocketProvider, 'connect').mockResolvedValue()
  const wire = vi.spyOn(bridge.provider, 'sendStateless'), originalReady = bridge.ready, awareness = bridge.provider.awareness
  let settled = false
  originalReady.then(() => { settled = true }, () => { settled = true })
  const stale = new runtime.Yjs.Doc(), fresh = new runtime.Yjs.Doc()
  stale.getText('body').insert(0, 'retired READY must not replay')
  fresh.getText('body').insert(0, 'fresh authorized READY')
  const receiveReady = doc => bridge.provider.receiveStateless(JSON.stringify({ type: 'READY', protocolVersion: 'editor-crdt-v1', tenantId: 'tenant', docId: 'doc',
    epoch: '1', revision: '0', lastSeq: '0', canWrite: true, principalId: 'alice', field: 'default', presenceProtocol: 'cursor-v1',
    payloadBase64: Buffer.from(runtime.Yjs.encodeStateAsUpdate(doc)).toString('base64') }))
  try {
    if (mode !== 'autoConnect') { bridge.provider.forceSync(); receiveReady(stale) }
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce())
    expect(onError.mock.calls[0][0].code).toBe('COLLABORATION_MODULE_UNAVAILABLE')
    expect(bridge.getState()).toMatchObject({ status: 'disconnected', epoch: null, canWrite: false })
    expect(settled).toBe(false)
    expect(bridge.ready).toBe(originalReady)
    expect(connect).not.toHaveBeenCalled()
    expect(bridge.ydoc.getText('body').toString()).toBe('')
    blocked.mockRestore()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(connect).not.toHaveBeenCalled()
    await bridge.connect()
    expect(connect).toHaveBeenCalledOnce()
    expect(settled).toBe(false)
    expect(bridge.provider.awareness).toBe(awareness)
    expect(bridge.ydoc.getText('body').toString()).toBe('')
    bridge.provider.forceSync(); receiveReady(fresh)
    await expect(originalReady).resolves.toMatchObject({ status: 'ready' })
    expect(bridge.ydoc.getText('body').toString()).toBe('fresh authorized READY')
    expect(wire.mock.calls.map(([payload]) => JSON.parse(payload)).filter(message => message.type === 'UPDATE')).toEqual([])
  } finally { blocked.mockRestore(); bridge.destroy(); stale.destroy(); fresh.destroy() }
})

it('CJS协作默认缺块与显式重试始终保留未知pending原键，绝不自动UPDATE', async () => {
  const root = getArtifactRoot(), require = createRequire(resolve(root, '../package.json'))
  const runtime = require(resolve(root, 'lark-doc-collab.common.js'))
  const blocked = blockCollabChunks(root, require), onError = vi.fn()
  const bridge = runtime.createDurableCollaborationBridge({ url: 'ws://127.0.0.1:33333', tenantId: 'tenant', docId: 'doc', onError })
  const baseline = new runtime.Yjs.Doc()
  const connect = vi.spyOn(bridge.provider.configuration.websocketProvider, 'connect').mockResolvedValue()
  const wire = vi.spyOn(bridge.provider, 'sendStateless'), originalReady = bridge.ready
  let settled = false
  originalReady.then(() => { settled = true }, () => { settled = true })
  try {
    bridge.ydoc.getText('offline').insert(0, 'keep original unknown bytes')
    const snapshot = await bridge.exportPendingSnapshot(), original = snapshot.pending[0]
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce())
    expect(bridge.getState()).toMatchObject({ status: 'disconnected', canWrite: false })
    await expect(bridge.connect()).rejects.toMatchObject({ code: 'COLLABORATION_MODULE_UNAVAILABLE' })
    expect(bridge.exportPending()).toEqual([original])
    expect(settled).toBe(false)
    expect(connect).not.toHaveBeenCalled()
    blocked.mockRestore()
    await bridge.connect()
    expect(connect).toHaveBeenCalledOnce()
    expect(bridge.exportPending()).toEqual([original])
    expect(bridge.ready).toBe(originalReady)
    expect(settled).toBe(false)
    bridge.provider.forceSync()
    bridge.provider.receiveStateless(JSON.stringify({ type: 'READY', protocolVersion: 'editor-crdt-v1', tenantId: 'tenant', docId: 'doc',
      epoch: '1', revision: '0', lastSeq: '0', canWrite: true, principalId: 'alice', field: 'default',
      payloadBase64: Buffer.from(runtime.Yjs.encodeStateAsUpdate(baseline)).toString('base64') }))
    await expect(originalReady).rejects.toMatchObject({ code: 'PRE_READY_PENDING' })
    expect(bridge.exportPending()).toEqual([original])
    expect(wire.mock.calls.map(([payload]) => JSON.parse(payload)).filter(message => message.type === 'UPDATE')).toEqual([])
  } finally { blocked.mockRestore(); bridge.destroy(); baseline.destroy() }
})

it('CJS协作真实异步chunk保持原pending键、同步query与PM/Yjs同实例', async () => {
  const root = getArtifactRoot(), require = createRequire(resolve(root, '../package.json'))
  const runtime = require(resolve(root, 'lark-doc-collab.common.js'))
  expect(runtime.Yjs.Doc).toBe(require('yjs').Doc)
  const source = new runtime.Yjs.Doc(), baseline = new runtime.Yjs.Doc()
  const bridge = runtime.createDurableCollaborationBridge({ url: 'ws://127.0.0.1:33333', tenantId: 'tenant', docId: 'doc', autoConnect: false, presence: true })
  try {
    const awareness = bridge.provider.awareness
    expect(awareness).toBeTruthy()
    const extensions = runtime.createCollabExtensions({ ydoc: bridge.ydoc, provider: bridge.provider, user: { id: 'alice', name: 'Alice' } })
    expect(extensions[0].options.document).toBe(bridge.ydoc)
    expect(extensions[Symbol.for('lark-doc.collabRuntime')][0]).toBe(require('@tiptap/pm/state').Plugin)
    source.getText('restored').insert(0, 'original bytes')
    const bytes = runtime.Yjs.encodeStateAsUpdate(source)
    const item = { operationId: 'original-operation', updateId: 'original-update', epoch: '1', expectedRevision: '0', status: 'unknown',
      payloadBase64: Buffer.from(bytes).toString('base64'), payloadHash: 'sha256:' + Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex') }
    await bridge.restorePending({ schemaVersion: 'pending-snapshot-v1', protocolVersion: 'editor-crdt-v1', tenantId: 'tenant', docId: 'doc', epoch: '1', principalId: 'alice', pending: [item] })
    expect(bridge.exportPending()).toEqual([item])
    bridge.provider.receiveStateless(JSON.stringify({ type: 'READY', protocolVersion: 'editor-crdt-v1', tenantId: 'tenant', docId: 'doc',
      epoch: '1', revision: '0', lastSeq: '0', canWrite: true, principalId: 'alice', field: 'default', presenceProtocol: 'cursor-v1',
      payloadBase64: Buffer.from(runtime.Yjs.encodeStateAsUpdate(baseline)).toString('base64') }))
    await bridge.ready
    expect(bridge.getState()).toMatchObject({ status: 'blocked', canWrite: false })
    expect(bridge.provider.awareness).toBe(awareness)
    expect(bridge.queryPending()).toBe(1)
    bridge.provider.receiveStateless(JSON.stringify({ type: 'RECEIPT', protocolVersion: 'editor-crdt-v1', tenantId: 'tenant', docId: 'doc',
      operationId: item.operationId, expectedRevision: '0', receipt: { tenantId: 'tenant', docId: 'doc', protocolVersion: 'editor-crdt-v1',
        updateId: item.updateId, payloadHash: item.payloadHash, epoch: '1', seq: '1', contentRevision: '1', status: 'durable', committedAt: '2026-11-15T00:00:00Z' } }))
    await vi.waitFor(() => expect(bridge.exportPending()).toEqual([]))
    expect(bridge.ydoc.getText('restored').toString()).toBe('')
  } finally { bridge.destroy(); source.destroy(); baseline.destroy() }
})

it('CJS协作真实chunk缺失时恢复零写，加载恢复后仍重试原键', async () => {
  const root = getArtifactRoot(), require = createRequire(resolve(root, '../package.json'))
  const graph = JSON.parse(readFileSync(resolve(root, 'lark-doc-graph.json'), 'utf8')).collabCjs
  const deferred = new Set(Object.values(graph).flatMap(chunk => chunk.dynamicImports).filter(file => graph[file]).map(file => resolve(root, file)))
  expect(deferred.size).toBeGreaterThan(0)
  for (const file of deferred) delete require.cache[file]
  const runtime = require(resolve(root, 'lark-doc-collab.common.js')), source = new runtime.Yjs.Doc()
  const bridge = runtime.createDurableCollaborationBridge({ url: 'ws://127.0.0.1:33333', tenantId: 'tenant', docId: 'doc', autoConnect: false })
  source.getText('restored').insert(0, 'original bytes')
  const snapshot = { schemaVersion: 'pending-snapshot-v1', protocolVersion: 'editor-crdt-v1', tenantId: 'tenant', docId: 'doc', epoch: '1', principalId: 'alice',
    pending: [{ operationId: 'retry-original-operation', updateId: 'retry-original-update', epoch: '1', payloadBase64: Buffer.from(runtime.Yjs.encodeStateAsUpdate(source)).toString('base64'), status: 'unknown' }] }
  const load = Module._load
  const blocked = vi.spyOn(Module, '_load').mockImplementation(function(request, parent, isMain) {
    const path = request.startsWith('.') && parent?.filename ? resolve(dirname(parent.filename), request) : request
    if (deferred.has(path)) throw new Error('OWNED_TEST_COLLAB_CHUNK_UNAVAILABLE')
    return load.call(this, request, parent, isMain)
  })
  const offline = runtime.createDurableCollaborationBridge({ url: 'ws://127.0.0.1:33333', tenantId: 'tenant', docId: 'offline', autoConnect: false })
  try {
    offline.ydoc.getText('offline').insert(0, 'recover without a network chunk')
    const cached = await offline.exportPendingSnapshot()
    expect(cached.pending).toHaveLength(1)
    expect(cached.pending[0].payloadHash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(Object.isFrozen(cached.pending[0])).toBe(true)
    const copy = new runtime.Yjs.Doc()
    try {
      runtime.Yjs.applyUpdate(copy, Buffer.from(cached.pending[0].payloadBase64, 'base64'))
      expect(copy.getText('offline').toString()).toBe('recover without a network chunk')
    } finally { copy.destroy() }
    await expect(bridge.restorePending(snapshot)).rejects.toThrow('OWNED_TEST_COLLAB_CHUNK_UNAVAILABLE')
    expect(bridge.exportPending()).toEqual([])
    expect(bridge.getState()).toMatchObject({ status: 'connecting', epoch: null })
    blocked.mockRestore()
    await bridge.restorePending(snapshot)
    expect(bridge.exportPending()).toEqual(snapshot.pending)
    expect(bridge.ydoc.getText('restored').toString()).toBe('')
  } finally { blocked.mockRestore(); offline.destroy(); bridge.destroy(); source.destroy() }
})

function loadCjsRuntime() {
  const artifactRoot = getArtifactRoot()
  // SDK、协同与依赖都从同一消费者作用域 require，直接执行真实 CJS 产物。
  const require = createRequire(resolve(artifactRoot, '../package.json'))
  return {
    ...require(resolve(artifactRoot, 'lark-doc.common.js')),
    ...require(resolve(artifactRoot, 'lark-doc-collab.common.js')),
    ...require('@tiptap/pm/state'),
    ...require('@tiptap/pm/view'),
    ...require('@tiptap/y-tiptap'),
    ...require('y-protocols/awareness'),
    Y: require('yjs'),
  }
}

function mountSharedEditors(runtime, { caret = false } = {}) {
  const websocket = vi.fn(() => { throw new Error('本测试不允许 WebSocket') })
  const fetch = vi.fn(() => { throw new Error('本测试不允许 HTTP 请求') })
  vi.stubGlobal('WebSocket', websocket)
  vi.stubGlobal('fetch', fetch)
  const xhr = vi.spyOn(XMLHttpRequest.prototype, 'open').mockImplementation(() => { throw new Error('本测试不允许 XHR') })
  const createRange = document.createRange.bind(document)
  // jsdom 无排版，仅补矩形测量；不替换编辑器、选区或协同插件。
  vi.spyOn(document, 'createRange').mockImplementation(() => Object.assign(createRange(), {
    getClientRects: () => [],
    getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }),
  }))
  const ydoc = new runtime.Y.Doc({ gc: false })
  const awareness = caret ? new runtime.Awareness(ydoc) : null
  const elements = [document.createElement('div'), document.createElement('div')]
  elements.forEach(element => document.body.appendChild(element))
  const docs = []
  const editors = []
  const destroy = () => {
    docs.forEach(doc => doc.destroy())
    editors.forEach(editor => expect(editor.isDestroyed).toBe(true))
    awareness?.destroy()
    elements.forEach(element => element.remove())
    ydoc.destroy()
    expect(websocket).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expect(xhr).not.toHaveBeenCalled()
  }
  try {
    for (const [index, element] of elements.entries()) {
      const extensions = runtime.createCollabExtensions({
        ydoc,
        ...(awareness ? { provider: { awareness }, user: { name: `User ${index}`, color: '#336699' } } : {}),
      })
      const doc = new runtime.LarkDoc({
        element, documentId: 'published-shared-doc', content: '<p></p>', storage: 'none', network: { mode: 'offline' },
        collab: { extensions, isRemoteTransaction: runtime.isRemoteTransaction },
      })
      docs.push(doc)
      editors.push(doc.getEditor())
    }
    return { docs, editors, ydoc, awareness, destroy }
  } catch (error) {
    destroy()
    throw error
  }
}

const structuredContent = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'first alpha' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'middle beta' }] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'outer gamma' }] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'inner delta' }] },
      ] }] },
    ] }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'last omega' }] },
  ],
}

async function seedEditors(fixture) {
  fixture.editors[0].commands.setContent(structuredContent)
  await vi.waitFor(() => expect(fixture.docs[1].getJSON()).toEqual(fixture.docs[0].getJSON()))
  expect(fixture.docs[1].getText()).toContain('inner delta')
}

it('源协同工厂拒绝不同模块格式的真实 Y.Doc', async () => {
  const require = createRequire(import.meta.url)
  const Y = require('yjs')
  const { createCollabExtensions } = await import('../../src/collab')
  const ydoc = new Y.Doc({ gc: false })
  try {
    expect(() => createCollabExtensions({ ydoc })).toThrow(/同模块格式/)
  } finally { ydoc.destroy() }
})

it('真实 CJS root/collab 共享 Y.Doc 同步、undo/redo、销毁且不连接网络', async () => {
  const runtime = loadCjsRuntime()
  const fixture = mountSharedEditors(runtime)
  const [first, second] = fixture.editors
  try {
    expect(first.state.selection).toBeInstanceOf(runtime.TextSelection)
    expect(second.state.selection).toBeInstanceOf(runtime.TextSelection)
    expect(first.extensionManager.extensions.some(extension => extension.name === 'collaboration')).toBe(true)
    await seedEditors(fixture)
    runtime.yUndoPluginKey.getState(first.state).undoManager.stopCapturing()
    first.commands.insertContentAt(1, 'UNDO_MARK ')
    await vi.waitFor(() => expect(fixture.docs[1].getText()).toContain('UNDO_MARK'))
    expect(first.commands.undo()).toBe(true)
    await vi.waitFor(() => expect(fixture.docs[1].getText()).not.toContain('UNDO_MARK'))
    expect(fixture.docs[1].getText()).toContain('inner delta')
    expect(first.commands.redo()).toBe(true)
    await vi.waitFor(() => expect(fixture.docs[1].getText()).toContain('UNDO_MARK'))
    fixture.docs[0].destroy()
    second.commands.insertContentAt(1, 'AFTER_DESTROY ')
    expect(fixture.docs[1].getText()).toContain('AFTER_DESTROY')
  } finally { fixture.destroy() }
})

it('真实 CJS 多段落与嵌套列表的绝对/相对位置往返，远端插入保留非末尾选区', async () => {
  const runtime = loadCjsRuntime()
  const fixture = mountSharedEditors(runtime)
  const [first, second] = fixture.editors
  try {
    await seedEditors(fixture)
    const positions = []
    let middle
    first.state.doc.descendants((node, pos) => {
      if (!node.isText) return
      positions.push(pos, pos + 2)
      if (node.text === 'middle beta') middle = pos
    })
    expect(positions).toHaveLength(10)
    const firstSync = runtime.ySyncPluginKey.getState(first.state)
    const secondSync = runtime.ySyncPluginKey.getState(second.state)
    for (const position of positions) {
      const relative = runtime.absolutePositionToRelativePosition(position, firstSync.type, firstSync.binding.mapping)
      const decoded = runtime.Y.decodeRelativePosition(runtime.Y.encodeRelativePosition(relative))
      expect(runtime.relativePositionToAbsolutePosition(fixture.ydoc, firstSync.type, decoded, firstSync.binding.mapping)).toBe(position)
      expect(runtime.relativePositionToAbsolutePosition(fixture.ydoc, secondSync.type, decoded, secondSync.binding.mapping)).toBe(position)
    }
    const from = middle + 2
    const to = middle + 5
    second.view.focus()
    second.view.dispatch(second.state.tr.setSelection(runtime.TextSelection.create(second.state.doc, from, to)))
    const selected = second.state.doc.textBetween(from, to)
    expect(to).toBeLessThan(second.state.doc.content.size - 2)
    first.commands.insertContentAt(1, 'REMOTE ')
    await vi.waitFor(() => {
      expect(second.state.selection.from).toBe(from + 7)
      expect(second.state.selection.to).toBe(to + 7)
      expect(second.state.doc.textBetween(second.state.selection.from, second.state.selection.to)).toBe(selected)
    })
    expect(second.state.selection).toBeInstanceOf(runtime.TextSelection)
  } finally { fixture.destroy() }
})

it('真实 Awareness/caret 使用同实例 DecorationSet，远端光标可渲染并清理监听器', async () => {
  const runtime = loadCjsRuntime()
  const fixture = mountSharedEditors(runtime, { caret: true })
  const remoteDoc = new runtime.Y.Doc({ gc: false })
  const remoteAwareness = new runtime.Awareness(remoteDoc)
  try {
    await seedEditors(fixture)
    const [first, second] = fixture.editors
    const sync = runtime.ySyncPluginKey.getState(first.state)
    remoteAwareness.setLocalState({
      user: { name: 'Remote peer', color: '#4477aa' },
      cursor: {
        anchor: runtime.absolutePositionToRelativePosition(2, sync.type, sync.binding.mapping),
        head: runtime.absolutePositionToRelativePosition(5, sync.type, sync.binding.mapping),
      },
    })
    runtime.applyAwarenessUpdate(fixture.awareness, runtime.encodeAwarenessUpdate(remoteAwareness, [remoteDoc.clientID]), 'in-memory-peer')
    await vi.waitFor(() => {
      for (const editor of [first, second]) {
        const decorations = runtime.yCursorPluginKey.getState(editor.state)
        expect(decorations).toBeInstanceOf(runtime.DecorationSet)
        expect(decorations.find()).toHaveLength(2)
        expect(editor.view.dom.querySelector('.collaboration-carets__label')?.textContent).toBe('Remote peer')
      }
    })
    fixture.docs.forEach(doc => doc.destroy())
    expect(fixture.awareness._observers.get('update')?.size || 0).toBe(0)
    expect(fixture.awareness._observers.get('change')?.size || 0).toBe(0)
  } finally {
    remoteAwareness.destroy()
    remoteDoc.destroy()
    fixture.destroy()
  }
})

const extensionArrayForms = [
  ['原数组', extensions => extensions],
  ['spread', extensions => [...extensions]],
  ['filter', extensions => extensions.filter(() => true)],
]

function expectRuntimeRejectedBeforeMount(LarkDoc, runtime) {
  for (const [form, transform] of extensionArrayForms) {
    const ydoc = new runtime.Y.Doc({ gc: false })
    const element = document.createElement('div')
    let doc
    try {
      const extensions = transform(runtime.createCollabExtensions({ ydoc }))
      expect.soft(() => {
        doc = new LarkDoc({
          element, storage: 'none', network: { mode: 'offline' },
          collab: { extensions, isRemoteTransaction: runtime.isRemoteTransaction },
        })
      }, form).toThrow(/运行时不一致/)
      expect.soft(element.childElementCount, form).toBe(0)
    } finally {
      doc?.destroy()
      element.remove()
      ydoc.destroy()
    }
  }
}

it('真实 CJS 协同扩展的原数组/spread/filter 传给源 ESM SDK 时在挂载前拒绝 PM 运行时混用', async () => {
  const runtime = loadCjsRuntime()
  const { LarkDoc } = await import('../../src/LarkDoc')
  expectRuntimeRejectedBeforeMount(LarkDoc, runtime)
}, 30000)

it('真实 CJS 协同扩展的原数组/spread/filter 传给实际 UMD SDK 时在挂载前拒绝 PM 运行时混用', () => {
  const runtime = loadCjsRuntime()
  const artifactRoot = getArtifactRoot()
  const require = createRequire(resolve(artifactRoot, '../package.json'))
  const { LarkDoc } = require(resolve(artifactRoot, 'lark-doc-element.runtime.umd.min.js'))
  expectRuntimeRejectedBeforeMount(LarkDoc, runtime)
})
