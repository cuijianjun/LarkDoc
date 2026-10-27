/**
 * P7-03 派生快照：`outline` / `blockCount` / `fingerprint` 的序列化与校验。
 *
 * 这三条不变量是全部用例的主张：
 *   1. 快照**只由文档结构算出**，不需要编辑器 state、不需要装饰集 —— 因此可以在
 *      `setContent`（2,000 块可达数十秒）之前就把大纲挂上；
 *   2. 快照**必须能判伪**：`blockCount` / `fingerprint` 对不上就整份作废，绝不用
 *      半信半疑的旧登记去渲染目录（错的大纲比空的大纲更糟）；
 *   3. 校验**绝不抛错**：持久化层读到的任何垃圾都只能让它返回 `null`，让调用方
 *      退回实测。落库记录里多一个坏字段不该让整篇文档打不开。
 */
import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import { aggregateHeadingContainers, collectOutline, validateDocument } from '../../src/core/documentOperations'
import {
  DERIVED_SNAPSHOT_VERSION,
  createDerivedSnapshot,
  documentBlockCount,
  documentFingerprint,
  isValidDerivedSnapshot,
  validateDerivedSnapshot,
} from '../../src/core/derive/snapshot'

const schema = getSchema(createLarkDocExtensions())
const nodeFromJSON = (content) => schema.nodeFromJSON({ type: 'doc', content })

const sampleDoc = () => nodeFromJSON([
  { type: 'heading', attrs: { level: 1, blockId: 'blk-a' }, content: [{ type: 'text', text: '总则' }] },
  { type: 'paragraph', attrs: { blockId: 'blk-b' }, content: [{ type: 'text', text: '正文一' }] },
  { type: 'heading', attrs: { level: 2, blockId: 'blk-c' }, content: [{ type: 'text', text: '细则' }] },
  { type: 'paragraph', attrs: { blockId: 'blk-d' }, content: [{ type: 'text', text: '正文二' }] },
])

// 落库往返：真正的快照一定先过一遍 JSON.stringify（localStorage / IndexedDB 都这样）。
const persisted = (value) => JSON.parse(JSON.stringify(value))
// 一个合法的空文档快照：被判伪的用例只需要改坏其中一个字段。
const baseline = () => persisted(createDerivedSnapshot(sampleDoc()))

describe('P7-03 derived snapshot: creation', () => {
  it('captures the outline from the document structure alone, without editor state or decorations', () => {
    const doc = sampleDoc()
    const snapshot = createDerivedSnapshot(doc)

    expect(snapshot.v).toBe(DERIVED_SNAPSHOT_VERSION)
    expect(snapshot.blockCount).toBe(4)
    expect(snapshot.outline).toEqual([
      { pos: 0, level: 1, text: '总则', blockId: 'blk-a' },
      { pos: collectOutline(doc)[1].pos, level: 2, text: '细则', blockId: 'blk-c' },
    ])
    // 与实时计算逐项相同：早期水合出来的目录与 setContent 之后重算的结果一致。
    expect(snapshot.outline.map((item) => item.pos)).toEqual(collectOutline(doc).map((item) => item.pos))
  })

  it('returns null for a missing document instead of an empty snapshot', () => {
    expect(createDerivedSnapshot(null)).toBeNull()
    expect(createDerivedSnapshot(undefined)).toBeNull()
  })

  it('records a null blockId when the document has not been back-filled yet', () => {
    const doc = nodeFromJSON([
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '无 id 标题' }] },
    ])
    expect(createDerivedSnapshot(doc).outline).toEqual([{ pos: 0, level: 2, text: '无 id 标题', blockId: null }])
  })

  it('counts blocks the same way the persisted JSON does', () => {
    const doc = sampleDoc()
    expect(documentBlockCount(doc.toJSON())).toBe(createDerivedSnapshot(doc).blockCount)
    expect(documentBlockCount(null)).toBe(-1)
    expect(documentBlockCount({ type: 'doc' })).toBe(-1)
  })
})

describe('P7-03 derived snapshot: fingerprint', () => {
  it('is stable for structurally identical JSON and differs once body text changes', () => {
    const before = documentFingerprint(sampleDoc().toJSON())
    const same = documentFingerprint(sampleDoc().toJSON())
    expect(same).toBe(before)

    const edited = nodeFromJSON([
      { type: 'heading', attrs: { level: 1, blockId: 'blk-a' }, content: [{ type: 'text', text: '总则' }] },
      { type: 'paragraph', attrs: { blockId: 'blk-b' }, content: [{ type: 'text', text: '正文一改' }] },
      { type: 'heading', attrs: { level: 2, blockId: 'blk-c' }, content: [{ type: 'text', text: '细则' }] },
      { type: 'paragraph', attrs: { blockId: 'blk-d' }, content: [{ type: 'text', text: '正文二' }] },
    ])
    expect(documentFingerprint(edited.toJSON())).not.toBe(before)
  })

  it('is order sensitive: two blocks swapping places is a different document', () => {
    const swapped = nodeFromJSON([
      { type: 'paragraph', attrs: { blockId: 'blk-d' }, content: [{ type: 'text', text: '正文二' }] },
      { type: 'paragraph', attrs: { blockId: 'blk-b' }, content: [{ type: 'text', text: '正文一' }] },
    ])
    const ordered = nodeFromJSON([
      { type: 'paragraph', attrs: { blockId: 'blk-b' }, content: [{ type: 'text', text: '正文一' }] },
      { type: 'paragraph', attrs: { blockId: 'blk-d' }, content: [{ type: 'text', text: '正文二' }] },
    ])
    expect(documentFingerprint(swapped.toJSON())).not.toBe(documentFingerprint(ordered.toJSON()))
  })

  it('returns null rather than a made-up number for malformed input', () => {
    expect(documentFingerprint(null)).toBeNull()
    expect(documentFingerprint({ type: 'doc' })).toBeNull()
    expect(documentFingerprint({ type: 'doc', content: [{ text: '缺 type' }] })).toBeNull()
  })
})

describe('P7-03 derived snapshot: validation', () => {
  it('accepts a snapshot that matches the document it was taken from', () => {
    const json = sampleDoc().toJSON()
    const result = validateDerivedSnapshot(persisted(createDerivedSnapshot(sampleDoc())), json)
    expect(result).not.toBeNull()
    expect(result.outline.map((item) => item.text)).toEqual(['总则', '细则'])
  })

  it('rejects a stale snapshot whose block count no longer matches', () => {
    const json = sampleDoc().toJSON()
    const stale = baseline()
    stale.blockCount += 1
    // 块数变了就说明这份大纲不是当前正文的，宁可重算也不要错目录。
    expect(validateDerivedSnapshot(stale, json)).toBeNull()
  })

  it('rejects a snapshot whose fingerprint no longer matches (same block count, edited text)', () => {
    const json = sampleDoc().toJSON()
    const stale = baseline()
    stale.fingerprint = (stale.fingerprint + 1) >>> 0
    expect(validateDerivedSnapshot(stale, json)).toBeNull()
  })

  it('rejects an unknown snapshot version instead of guessing at its shape', () => {
    const json = sampleDoc().toJSON()
    const future = baseline()
    future.v = DERIVED_SNAPSHOT_VERSION + 1
    expect(validateDerivedSnapshot(future, json)).toBeNull()
  })

  it('rejects the whole snapshot when any single outline entry is malformed', () => {
    const json = sampleDoc().toJSON()
    const cases = [
      (snapshot) => { snapshot.outline[0] = null },
      (snapshot) => { snapshot.outline[0] = { pos: 0, level: 1, text: '总则', blockId: null, extra: true } },
      (snapshot) => { snapshot.outline[0].pos = -1 },
      (snapshot) => { snapshot.outline[0].pos = 1.5 },
      (snapshot) => { snapshot.outline[0].pos = 10 ** 9 },
      (snapshot) => { snapshot.outline[0].level = 0 },
      (snapshot) => { snapshot.outline[0].level = 10 },
      (snapshot) => { snapshot.outline[0].level = '1' },
      (snapshot) => { snapshot.outline[0].text = 42 },
      (snapshot) => { snapshot.outline[0].blockId = 42 },
      (snapshot) => { snapshot.outline = {} },
    ]
    for (const mutate of cases) {
      const broken = baseline()
      mutate(broken)
      expect(validateDerivedSnapshot(broken, json)).toBeNull()
    }
  })

  it('never throws, whatever the persistence layer hands back', () => {
    const json = sampleDoc().toJSON()
    for (const value of [null, undefined, 0, '', 'derived', [], {}, { outline: [] }, { v: 1 }]) {
      expect(() => validateDerivedSnapshot(value, json)).not.toThrow()
      expect(validateDerivedSnapshot(value, json)).toBeNull()
    }
    // 文档侧坏掉同样只能判伪，不能抛。
    expect(validateDerivedSnapshot(baseline(), null)).toBeNull()
    expect(validateDerivedSnapshot(baseline(), { type: 'doc' })).toBeNull()
  })

  it('treats a document without metadata as "nothing to hydrate", not as an error', () => {
    // 老草稿 / 别的客户端写进来的记录都没有 derived 字段：调用方保持现状即可。
    expect(validateDerivedSnapshot(undefined, sampleDoc().toJSON())).toBeNull()
  })
})

describe('P7-03 derived snapshot: storage form vs editor form', () => {
  // 落库正文是 `getJSON()` 的**聚合容器形态**（标题把后续块收进 children），编辑器里
  // 却是扁平文档；快照按扁平文档算。所以载入侧必须先展平再比对 —— 拿落库原样去比，
  // 带标题的文档会被全部判伪，水合静默失效（功能活着，只是永远不生效）。
  const recordJson = () => aggregateHeadingContainers(sampleDoc().toJSON())

  it('the persisted record really is a different shape (this suite premise)', () => {
    const record = recordJson()
    expect(record.content.length).toBe(1)
    expect(record.content[0].children.length).toBe(2)
  })

  it('rejects against the raw record but accepts against the flattened content', () => {
    const snapshot = persisted(createDerivedSnapshot(sampleDoc()))
    expect(validateDerivedSnapshot(snapshot, recordJson())).toBeNull()
    const content = validateDocument(recordJson(), schema)
    expect(validateDerivedSnapshot(snapshot, content).outline.map((item) => item.pos))
      .toEqual(snapshot.outline.map((item) => item.pos))
  })
})

describe('P7-03 derived snapshot: localStorage leg shape gate', () => {
  // `components/lark-doc/workspace.js` 是 CJS（门禁脚本直接 require），没法 import 这个
  // ESM 模块，只能自带一份形状检查。这条用例把两份检查钉在一起：CJS 侧接受的集合
  // 必须是 ESM 侧接受集合的超集 —— 否则一条腿会把另一条腿写进去的快照丢掉。
  it('accepts everything createDerivedSnapshot produces and rejects malformed shapes', () => {
    expect(isValidDerivedSnapshot(persisted(createDerivedSnapshot(sampleDoc())))).toBe(true)
    expect(isValidDerivedSnapshot({ v: 1, blockCount: 1, fingerprint: 0, outline: [] })).toBe(true)

    for (const value of [null, undefined, 0, 'x', [], {}, { v: 1 }, { v: '1', blockCount: 1, fingerprint: 0, outline: [] },
      { v: 1, blockCount: -1, fingerprint: 0, outline: [] },
      { v: 1, blockCount: 1, fingerprint: '0', outline: [] },
      { v: 1, blockCount: 1, fingerprint: 0, outline: [{}] }]) {
      expect(isValidDerivedSnapshot(value)).toBe(false)
    }
  })
})
