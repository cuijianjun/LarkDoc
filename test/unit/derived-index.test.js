import { describe, expect, it, vi } from 'vitest'
import { getSchema } from '@tiptap/core'
import { EditorState } from '@tiptap/pm/state'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import { createDerivedIndex } from '../../src/core/derive/index'

const schema = getSchema(createLarkDocExtensions())

const mappingFrom = (...segments) => ({
  maps: segments.map((ranges) => ({
    forEach(callback) {
      ranges.forEach(([oldStart, oldEnd]) => callback(oldStart, oldEnd))
    },
  })),
})

const transaction = ({ doc, mapping, meta = false }) => ({
  doc,
  docChanged: !meta,
  mapping,
  getMeta: () => (meta ? { source: 'test' } : undefined),
})

const documentWithScanCounter = (id, scans) => ({
  id,
  descendants(callback) {
    scans.count += 1
    if (callback) callback()
  },
})

const nodeFromJSON = (content) => schema.nodeFromJSON({ type: 'doc', content })

const headingPositions = (doc) => {
  const result = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') result.push({ pos, end: pos + node.nodeSize, level: node.attrs.level })
  })
  return result
}

describe('P7-01 DerivedIndex seams', () => {
  it('reuses the cached decoration set until a transaction invalidates it', () => {
    const doc = { id: 'doc-1' }
    const rebuild = vi.fn(() => ({ id: 'decorations-1' }))
    const index = createDerivedIndex({ doc, schema: {}, rebuild })

    const first = index.decorations({ doc })
    const second = index.decorations({ doc })

    expect(second).toBe(first)
    expect(rebuild).toHaveBeenCalledTimes(1)
  })

  it('returns every mapped range, merging overlapping and adjacent segments across maps', () => {
    const initialDoc = { id: 'before' }
    const nextDoc = { id: 'after' }
    const index = createDerivedIndex({ doc: initialDoc, schema: {}, rebuild: vi.fn() })

    const result = index.update(transaction({
      doc: nextDoc,
      mapping: mappingFrom(
        [[4, 8], [20, 24]],
        [[7, 10], [24, 26]],
      ),
    }))

    expect(result.changed).toEqual([
      { from: 4, to: 10 },
      { from: 20, to: 26 },
    ])
  })

  it('keeps meta-only transactions on the invalidation path', () => {
    const doc = { id: 'doc-1' }
    const rebuild = vi.fn(() => ({ id: 'decorations-1' }))
    const index = createDerivedIndex({ doc, schema: {}, rebuild })

    index.decorations({ doc })
    const result = index.update(transaction({
      doc,
      mapping: mappingFrom(),
      meta: true,
    }))
    index.decorations({ doc })

    expect(result.changed).toEqual([])
    expect(rebuild).toHaveBeenCalledTimes(2)
  })

  it('invalidate() forces a rebuild even when the document identity is unchanged', () => {
    const doc = { id: 'doc-1' }
    const rebuild = vi.fn(() => ({ id: 'decorations-1' }))
    const index = createDerivedIndex({ doc, schema: {}, rebuild })

    index.decorations({ doc })
    index.invalidate()
    index.decorations({ doc })

    expect(rebuild).toHaveBeenCalledTimes(2)
  })

  it('rebuilds exactly once per edit and serves the cached set in between', () => {
    // 契约：装饰重建次数必须与「编辑次数」成正比，不能与「取用次数」成正比 ——
    // 同一份文档连取十次也只算一次。
    //
    // 这条用例不传 `incremental`（且 doc 是没有 `resolve` 的桩），所以走的是**冷路径**：
    // 每笔 docChanged 事务后第一次取用会全量重建一次。真实装配下会传 incremental，
    // 装好增量实现后只重扫脏区（见 document-decorations-incremental.test.js 的逐条
    // 等价性验证）；这里的断言保持原样，是为了守住「不传增量实现就退回全量」这条兜底
    // —— 增量回调返回 null、换文档、invalidate 都必须还能正常出装饰。
    const scans = { count: 0 }
    const initialDoc = documentWithScanCounter('before', scans)
    const nextDoc = documentWithScanCounter('after', scans)
    const thirdDoc = documentWithScanCounter('later', scans)
    const decorationSet = { map: vi.fn(() => decorationSet) }
    const rebuild = vi.fn((state) => {
      state.doc.descendants(() => {})
      return decorationSet
    })
    const index = createDerivedIndex({ doc: initialDoc, schema: {}, rebuild })

    index.decorations({ doc: initialDoc })
    index.decorations({ doc: initialDoc })
    index.decorations({ doc: initialDoc })
    expect(rebuild).toHaveBeenCalledTimes(1)
    expect(scans.count).toBe(1)

    index.update(transaction({ doc: nextDoc, mapping: mappingFrom([[8, 8]]) }))
    index.decorations({ doc: nextDoc })
    index.decorations({ doc: nextDoc })
    expect(rebuild).toHaveBeenCalledTimes(2)

    index.update(transaction({ doc: thirdDoc, mapping: mappingFrom([[8, 8]]) }))
    index.decorations({ doc: thirdDoc })
    expect(rebuild).toHaveBeenCalledTimes(3)
  })

  it('expands a text edit to the edited block and one containing parent block', () => {
    const doc = nodeFromJSON([{
      type: 'blockquote',
      content: [{
        type: 'paragraph',
        attrs: { blockId: 'p1' },
        content: [{ type: 'text', text: '父块内文字' }],
      }],
    }])
    const state = EditorState.create({ schema, doc })
    const next = state.tr.insertText('!', 3)
    const index = createDerivedIndex({ doc, schema, rebuild: vi.fn() })

    const result = index.update(next)

    expect(result.changed).toContainEqual({ from: 0, to: doc.child(0).nodeSize })
  })

  it('propagates a numbered-heading edit through following siblings until the next higher heading', () => {
    const doc = nodeFromJSON([
      { type: 'heading', attrs: { level: 1, numbering: true, numberingStart: null, blockId: 'h1' }, content: [{ type: 'text', text: '章' }] },
      { type: 'heading', attrs: { level: 2, numbering: true, numberingStart: null, blockId: 'h2a' }, content: [{ type: 'text', text: '节一' }] },
      { type: 'heading', attrs: { level: 2, numbering: true, numberingStart: null, blockId: 'h2b' }, content: [{ type: 'text', text: '节二' }] },
      { type: 'heading', attrs: { level: 1, numbering: true, numberingStart: null, blockId: 'h1b' }, content: [{ type: 'text', text: '下一章' }] },
    ])
    const headings = headingPositions(doc)
    const state = EditorState.create({ schema, doc })
    const next = state.tr.insertText('!', headings[1].pos + 1)
    const index = createDerivedIndex({ doc, schema, rebuild: vi.fn() })

    const result = index.update(next)

    expect(result.changed).toContainEqual({ from: headings[1].pos, to: headings[3].pos })
    expect(result.changed.some(({ to }) => to > headings[3].pos)).toBe(false)
  })
})
