// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import { collectOutline, aggregateHeadingContainers, restoreUnknownBlocks } from '../../src/core/documentOperations'
import { createDocumentSnapshotReader, createDocumentStatsReader } from '../../src/editor/documentSnapshot'
import { createSegmentedDocumentModel, createSegmentedDocumentReader, createLargeDocumentViewportController } from '../../src/editor/segmentedDocumentModel'
import { createEditorController } from '../../src/editor/EditorController'
import { LarkDoc } from '../../src/LarkDoc'

const editors = []
function makeEditor(content = '<p></p>') {
  const editor = new Editor({ extensions: createLarkDocExtensions({ config: { performance: { syntaxHighlight: false } } }), content })
  editors.push(editor)
  return editor
}
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); vi.restoreAllMocks() })

describe('large document snapshots preserve the public codecs', () => {
  const mixed = '<h1>章节😀</h1><p><strong>粗体</strong><br>正文</p><ul><li><p>列表</p><h2>列表标题</h2></li></ul>'
    + '<blockquote><h2>隔离标题</h2><p>引用</p></blockquote><table><tbody><tr><td><p>单元格</p></td></tr></tbody></table>'
    + '<h2>后文</h2><p><img src="data:image/png;base64,AAAA" alt="图片"></p><p></p>'

  it('cooperative fallback equals HTML, JSON, text and media-link output from the real schema', async () => {
    const editor = makeEditor(mixed)
    const reader = createDocumentSnapshotReader({ workerFactory: () => null })
    const controller = createEditorController({ editor })
    const snapshot = await reader.read(editor)
    expect(snapshot.html).toBe(editor.getHTML())
    expect(snapshot.text).toBe(editor.getText())
    expect(snapshot.json).toEqual(controller.getJSON())
    const link = await reader.read(editor, { media: { mode: 'link' } })
    expect(link.html).toBe(controller.getHTML({ media: { mode: 'link' } }))
  })

  it('streams JSON blocks to a worker and terminates it after delivery', async () => {
    const editor = makeEditor(mixed)
    const content = []
    const terminate = vi.fn()
    const postMessage = vi.fn(message => {
      if (message.type === 'append') content.push(...message.content)
      else queueMicrotask(() => worker.onmessage({ data: aggregateHeadingContainers(restoreUnknownBlocks({ type: 'doc', content })) }))
    })
    const worker = { postMessage, terminate }
    const result = await createDocumentSnapshotReader({ workerFactory: () => worker }).read(editor)
    expect(result.json).toEqual(createEditorController({ editor }).getJSON())
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'finish' })
    expect(terminate).toHaveBeenCalledTimes(1)
  })

  it('cancels a waiting worker and never publishes a stale document', async () => {
    const editor = makeEditor(mixed)
    const worker = { postMessage: vi.fn(), terminate: vi.fn() }
    const abort = new AbortController()
    const pending = createDocumentSnapshotReader({ workerFactory: () => worker }).read(editor, { signal: abort.signal })
    abort.abort()
    expect(await pending).toBeNull()
    expect(worker.terminate).toHaveBeenCalled()
    expect(await createDocumentSnapshotReader().read(editor, { signal: abort.signal })).toBeNull()
  })

  it('recovers from worker-src failure with identical output', async () => {
    const editor = makeEditor(mixed)
    const worker = { terminate: vi.fn(), postMessage(message) {
      if (message.type === 'finish') queueMicrotask(() => worker.onerror({ preventDefault() {} }))
    } }
    const result = await createDocumentSnapshotReader({ workerFactory: () => worker }).read(editor)
    expect(result.html).toBe(editor.getHTML())
    expect(result.json).toEqual(createEditorController({ editor }).getJSON())
  })

  it('does not serialize unchanged immutable blocks again after an edit', async () => {
    const editor = makeEditor('<p>保留</p><p>修改</p>')
    const reader = createDocumentSnapshotReader({ workerFactory: () => null })
    const unchanged = editor.state.doc.firstChild
    const serialize = vi.spyOn(unchanged, 'toJSON')
    await reader.read(editor)
    editor.commands.insertContentAt(unchanged.nodeSize + 1, '新')
    const result = await reader.read(editor)
    expect(serialize).toHaveBeenCalledTimes(1)
    expect(result.text).toBe(editor.getText())
  })

  it('matches Unicode, leaf-space and nested-heading statistics across edits', async () => {
    const editor = makeEditor(mixed)
    const reader = createDocumentStatsReader()
    for (const html of [mixed, '<p>😀𠮷</p><p>é<br>text</p><hr><p></p>', '<ul><li><p>父</p><h2>子标题</h2></li></ul>']) {
      editor.commands.setContent(html)
      const result = await reader.read(editor.state.doc)
      expect(result.characters).toBe(editor.storage.characterCount.characters())
      expect(result.outline).toEqual(collectOutline(editor.state.doc))
    }
    expect(await reader.read(editor.state.doc, () => false)).toBeNull()
  })

  it('indexes top-level blocks into stable segments and maps document positions', () => {
    const editor = makeEditor('<h1>章节</h1><p>第一段正文</p><p>第二段正文</p><p>第三段正文</p><p>第四段正文</p>')
    const model = createSegmentedDocumentModel(editor.state.doc, { segmentBlocks: 2 })
    expect(model.segmentCount).toBe(3)
    expect(model.segments.map(segment => [segment.blockStart, segment.blockEnd])).toEqual([[0, 2], [2, 4], [4, 5]])
    expect(model.segmentForBlock(2).index).toBe(1)
    expect(model.segmentForPos(model.blocks[2].from + 1).index).toBe(1)
    expect(model.blocks[0].intrinsicSize).toBe(76)
    expect(model.blocks[1].segment).toBe(0)
  })

  it('computes compact segment metadata in a worker and falls back when it fails', async () => {
    const editor = makeEditor('<p>一</p><p>二</p><h2>三</h2>')
    const model = createSegmentedDocumentModel(editor.state.doc, { segmentBlocks: 2 })
    const terminate = vi.fn()
    const worker = {
      postMessage: vi.fn(message => {
        expect(message.type).toBe('compute')
        queueMicrotask(() => worker.onmessage({ data: {
          type: 'segments',
          heights: new Uint16Array([90, 91, 64]),
          segments: [{ index: 0, blockStart: 0, blockEnd: 2, from: 0, to: 8, blockCount: 2, estimatedHeight: 181, textLength: 2, headingCount: 0 }, { index: 1, blockStart: 2, blockEnd: 3, from: 8, to: 13, blockCount: 1, estimatedHeight: 64, textLength: 1, headingCount: 1 }],
        } }))
      }),
      terminate,
    }
    const result = await createSegmentedDocumentReader({ workerFactory: () => worker }).read(model)
    expect(result.segments).toHaveLength(2)
    expect(result.heights[1]).toBe(91)
    expect(terminate).toHaveBeenCalledTimes(1)
    model.applyWorkerResult(result)
    expect(model.blocks[1].intrinsicSize).toBe(91)

    const failedWorker = {
      postMessage() { queueMicrotask(() => failedWorker.onerror({ preventDefault() {} })) },
      terminate: vi.fn(),
    }
    const failed = await createSegmentedDocumentReader({ workerFactory: () => failedWorker }).read(model)
    expect(failed.segments).toHaveLength(2)
  })

  it('applies segment and intrinsic-size hints without removing editor DOM nodes', () => {
    const editor = makeEditor('<p>一</p><p>二</p><p>三</p>')
    const host = document.createElement('div')
    host.innerHTML = '<p>一</p><p>二</p><p>三</p>'
    document.body.appendChild(host)
    const model = createSegmentedDocumentModel(editor.state.doc, { segmentBlocks: 2 })
    const controller = createLargeDocumentViewportController({ editorDom: host, model, viewWindow: window })
    controller.refresh()
    expect(host.children).toHaveLength(3)
    expect(host.getAttribute('data-ld-segment-count')).toBe('2')
    expect(host.querySelector('[data-ld-segment-start]')).toBeNull()
    controller.destroy()
    host.remove()
  })

  it('UI updates never toggle editability on the ProseMirror ancestor', async () => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, storage: 'none', content: '<p>正文</p>' })
    const mutations = []
    const container = doc.getEditor().view.dom.parentElement
    const observer = new MutationObserver(records => mutations.push(...records))
    observer.observe(container, { attributes: true, attributeFilter: ['contenteditable'] })
    try {
      doc._handle.nativeHost.host.helpOpen = true
      doc.setReadonly(true)
      await new Promise(resolve => setTimeout(resolve, 30))
      expect(container.hasAttribute('contenteditable')).toBe(false)
      expect(mutations).toHaveLength(0)
      expect(doc.getEditor().isEditable).toBe(false)
    } finally { observer.disconnect(); doc.destroy(); element.remove() }
  })
})
