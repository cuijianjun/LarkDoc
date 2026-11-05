// @vitest-environment jsdom

import { afterEach, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
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
  const { createCollabExtensions } = await import('../../src/collab')
  const ydoc = new Y.Doc({ gc: false })
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
  const { LarkDoc } = require(resolve(artifactRoot, 'lark-doc-element.umd.min.js'))
  expectRuntimeRejectedBeforeMount(LarkDoc, runtime)
})
