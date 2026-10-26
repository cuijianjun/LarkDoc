/**
 * P6b-02 历史版本 · 数据层（09 §5.8 / §5.7.2-9 / 05 §5.4 / 04 §3.4）。
 * 只测 `src/core/versioning/`：纯函数、纯状态机，零 DOM、零网络、不 import yjs。
 * 四条主线：快照模型（读宽容 / 写严格、正文只收二进制）、保留策略（永久件 vs 自动件）、
 * 恢复（新建版本，不是回滚）、内存 Provider（淘汰留墓碑，报 `E_VERSION_EVICTED`）。
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_POLICY, E_POLICY_KEEP_AUTO, E_SNAPSHOT_AUTHOR, E_SNAPSHOT_BLOCK_COUNT,
  E_SNAPSHOT_CREATED_AT, E_SNAPSHOT_JSON_NOT_ALLOWED, E_SNAPSHOT_KIND, E_SNAPSHOT_LABEL,
  E_SNAPSHOT_PAYLOAD_MISSING, E_SNAPSHOT_SIZE_MISMATCH, E_VERSION_EVICTED, E_VERSION_NOT_FOUND,
  SNAPSHOT_LABEL_MAX, createMemoryVersioningProvider, createRestoreRecord, createSnapshot,
  diffSummary, normalizeSnapshot, projectionMetrics, pruneSnapshots,
} from '../../src/core/versioning/index'
// 契约真源：内存实现必须过这一关，否则就是「看起来能用、换远端就缺方法」。
import { VERSIONING_METHODS, createVersioningProvider } from '../../src/providers/versioning'

/* ---------------- 脚手架 ---------------- */

/** 假二进制：只关心字节数与内容，不关心它是不是合法 Yjs update。 */
function bytes(length, fill) {
  return new Uint8Array(length).fill(fill === undefined ? 1 : fill)
}

/** 合法的写路径入参；`kind: 'auto'` 是唯一会被淘汰的那类。 */
function input(overrides) {
  return { documentId: 'doc-1', createdAt: 1000, author: 'u1', kind: 'auto', payload: bytes(8), ...(overrides || {}) }
}

/** 保留策略只读 `kind / pinned / author / createdAt`，不必造正文。 */
function entry(id, createdAt, kind, author, pinned) {
  return { id, documentId: 'doc-1', createdAt, author, kind: kind || 'auto', pinned: Boolean(pinned) }
}

/** 取错误码（同步）；`toThrow` 断言不了 code，而 code 才是 UI 的分支依据。 */
function codeOfSync(action) {
  try {
    action()
  } catch (error) {
    return error.code
  }
  throw new Error('预期抛错，但没有抛')
}

async function codeOf(promiseFactory) {
  try {
    await promiseFactory()
  } catch (error) {
    return error.code
  }
  throw new Error('预期抛错，但没有抛')
}

/* ---------------- 1. 快照模型 ---------------- */

describe('快照模型 · 读路径宽容', () => {
  it('脏输入不抛：null / 字符串 / 空对象都退回安全缺省', () => {
    ;[null, undefined, 'x', 42, []].forEach((raw) => {
      const meta = normalizeSnapshot(raw)
      expect(meta.id).toBe('')
      expect(meta.documentId).toBe('')
      expect(meta.createdAt).toBe(0)
      expect(meta.sizeBytes).toBe(0)
      expect(meta.blockCount).toBe(null)
    })
  })

  it('未知 kind 当手动（永久保留），truthy pinned 当钉住 —— 两个方向都只会「多留」', () => {
    expect(normalizeSnapshot({ kind: 'weird' }).kind).toBe('manual')
    expect(normalizeSnapshot({ kind: undefined }).kind).toBe('manual')
    expect(normalizeSnapshot({ pinned: 'yes' }).pinned).toBe(true)
    expect(normalizeSnapshot({ pinned: 0 }).pinned).toBe(false)
  })

  it('能读 04 §⑥ / 05 §5.4 两套老字段名（name / authorId / createdBy.id）', () => {
    const fromName = normalizeSnapshot({ name: '周报 第 3 版', authorId: 'u9' })
    expect(fromName.label).toBe('周报 第 3 版')
    expect(fromName.author).toBe('u9')
    expect(normalizeSnapshot({ label: 'L', createdBy: { id: 'u8', name: '崔' } }).author).toBe('u8')
  })

  it('blockCount 非法时是 null 而不是 0（0 会被读成「空文档」）', () => {
    expect(normalizeSnapshot({ blockCount: -1 }).blockCount).toBe(null)
    expect(normalizeSnapshot({ blockCount: 2.5 }).blockCount).toBe(null)
    expect(normalizeSnapshot({ blockCount: 7 }).blockCount).toBe(7)
  })

  it('元信息形状固定为九个字段，二进制不进列表', () => {
    const meta = normalizeSnapshot(createSnapshot(input()))
    expect(Object.keys(meta).sort()).toEqual([
      'author', 'blockCount', 'createdAt', 'documentId', 'id', 'kind', 'label', 'pinned', 'sizeBytes',
    ].sort())
    expect(meta.payload).toBeUndefined()
  })
})

describe('快照模型 · 写路径校验', () => {
  it('正常写入：sizeBytes 由正文算出，label 缺省为空串，pinned 缺省 false', () => {
    const created = createSnapshot(input({ blockCount: 12 }))
    expect(created.sizeBytes).toBe(8)
    expect(created.label).toBe('')
    expect(created.pinned).toBe(false)
    expect(created.kind).toBe('auto')
    expect(created.blockCount).toBe(12)
    expect(created.id).toBe('doc-1#1000') // 派生 id：同参数同结果（存储层仍应显式传）
  })

  it('正文只收二进制：JSON 对象 / 数组 / JSON 字符串都被拒（09 §5.7.2-9）', () => {
    ;[{ type: 'doc', content: [] }, [1, 2, 3], '{"type":"doc"}'].forEach((payload) => {
      expect(codeOfSync(() => createSnapshot(input({ payload })))).toBe(E_SNAPSHOT_JSON_NOT_ALLOWED)
    })
  })

  it('收 ArrayBuffer；返回的 payload 是拷贝，改调用方的 buffer 不影响快照', () => {
    const created = createSnapshot(input({ payload: new Uint8Array([7, 8]).buffer }))
    expect(Array.from(created.payload)).toEqual([7, 8])
    const source = bytes(3, 5)
    const snapshot = createSnapshot(input({ payload: source }))
    source[0] = 9
    expect(snapshot.payload[0]).toBe(5)
    expect(snapshot.payload).not.toBe(source)
  })

  it('缺 documentId / author / kind / createdAt / payload 各有明确错误码', () => {
    expect(codeOfSync(() => createSnapshot(input({ documentId: '  ' })))).toBe('E_DOCUMENT_ID')
    expect(codeOfSync(() => createSnapshot(input({ author: '' })))).toBe(E_SNAPSHOT_AUTHOR)
    expect(codeOfSync(() => createSnapshot(input({ kind: 'restored' })))).toBe(E_SNAPSHOT_KIND)
    expect(codeOfSync(() => createSnapshot(input({ createdAt: undefined })))).toBe(E_SNAPSHOT_CREATED_AT)
    expect(codeOfSync(() => createSnapshot(input({ payload: undefined })))).toBe(E_SNAPSHOT_PAYLOAD_MISSING)
    expect(codeOfSync(() => createSnapshot(null))).toBe('E_SNAPSHOT_INVALID')
  })

  it('sizeBytes 与正文实际字节数对不上就报错，不做「以谁为准」的猜测', () => {
    expect(codeOfSync(() => createSnapshot(input({ sizeBytes: 9 })))).toBe(E_SNAPSHOT_SIZE_MISMATCH)
    expect(createSnapshot(input({ sizeBytes: 8 })).sizeBytes).toBe(8)
  })

  it('blockCount 必须是非负整数；label 上限 1000（04 §⑤-2 计数口径）', () => {
    expect(codeOfSync(() => createSnapshot(input({ blockCount: 1.5 })))).toBe(E_SNAPSHOT_BLOCK_COUNT)
    expect(codeOfSync(() => createSnapshot(input({ label: 123 })))).toBe(E_SNAPSHOT_LABEL)
    expect(codeOfSync(() => createSnapshot(input({ label: 'x'.repeat(SNAPSHOT_LABEL_MAX + 1) })))).toBe(E_SNAPSHOT_LABEL)
    expect(createSnapshot(input({ label: 'x'.repeat(SNAPSHOT_LABEL_MAX) })).label.length).toBe(SNAPSHOT_LABEL_MAX)
  })
})

/* ---------------- 2. 保留策略 ---------------- */
describe('保留策略 · pruneSnapshots', () => {
  it('只保留最近 N 份自动快照，kept 新的在前；空输入不抛', () => {
    const list = [entry('a1', 5000), entry('a2', 4000), entry('a3', 3000), entry('a4', 2000), entry('a5', 1000)]
    const result = pruneSnapshots(list, { keepAuto: 2 })
    expect(result.kept.map((item) => item.id)).toEqual(['a1', 'a2'])
    expect(result.dropped.map((item) => item.id)).toEqual(['a3', 'a4', 'a5'])
    expect(pruneSnapshots(null, {})).toEqual({ kept: [], dropped: [] })
    expect(pruneSnapshots([], {})).toEqual({ kept: [], dropped: [] })
  })

  it('pinned / 手动 / 恢复点永久保留，且不占自动快照名额', () => {
    const list = [
      entry('a1', 5000), entry('a2', 4000),
      entry('m1', 3000, 'manual'), entry('r1', 2500, 'restore'), entry('p1', 1000, 'auto', 'u1', true),
    ]
    const result = pruneSnapshots(list, { keepAuto: 1 })
    expect(result.kept.map((item) => item.id)).toEqual(['a1', 'm1', 'r1', 'p1'])
    expect(result.dropped.map((item) => item.id)).toEqual(['a2'])
  })

  it('未知 kind（脏数据）按永久处理，不淘汰', () => {
    const result = pruneSnapshots([entry('a1', 2000), entry('legacy', 1000, 'snapshot')], { keepAuto: 1 })
    expect(result.kept.map((item) => item.id)).toEqual(['a1', 'legacy'])
    expect(result.dropped).toEqual([])
  })

  it('合并开关默认关：同作者连续自动快照原样保留', () => {
    expect(DEFAULT_POLICY.mergeConsecutiveAuto).toBe(false)
    const list = [entry('a1', 3000, 'auto', 'u1'), entry('a2', 2000, 'auto', 'u1'), entry('a3', 1000, 'auto', 'u1')]
    expect(pruneSnapshots(list, {}).kept.map((item) => item.id)).toEqual(['a1', 'a2', 'a3'])
  })

  it('开合并：同一作者连续段只留最新那份；换人 / 手动 / pinned 都算断开', () => {
    const run = [entry('a1', 3000, 'auto', 'u1'), entry('a2', 2000, 'auto', 'u1'), entry('a3', 1000, 'auto', 'u1')]
    const merged = pruneSnapshots(run, { mergeConsecutiveAuto: true })
    expect(merged.kept.map((item) => item.id)).toEqual(['a1'])
    expect(merged.dropped.map((item) => item.id)).toEqual(['a2', 'a3'])

    const mixed = [entry('a1', 3000, 'auto', 'u1'), entry('a2', 2000, 'auto', 'u2'), entry('a3', 1000, 'auto', 'u1')]
    expect(pruneSnapshots(mixed, { mergeConsecutiveAuto: true }).kept).toHaveLength(3)

    const broken = [entry('a1', 3000, 'auto', 'u1'), entry('m1', 2000, 'manual', 'u1'), entry('a2', 1000, 'auto', 'u1')]
    expect(pruneSnapshots(broken, { mergeConsecutiveAuto: true }).kept).toHaveLength(3)

    const pinned = [entry('a1', 3000, 'auto', 'u1', true), entry('a2', 2000, 'auto', 'u1')]
    expect(pruneSnapshots(pinned, { mergeConsecutiveAuto: true }).kept).toHaveLength(2)
  })

  it('纯函数：不改输入数组顺序、不改对象、kept 复用原引用', () => {
    const list = [entry('a3', 1000), entry('a1', 3000), entry('m1', 2000, 'manual')]
    const frozen = Object.freeze(list.map((item) => Object.freeze(item)))
    const before = frozen.map((item) => item.id)
    const result = pruneSnapshots(frozen, { keepAuto: 1 })
    expect(frozen.map((item) => item.id)).toEqual(before) // 输入顺序不变（含乱序输入）
    expect(result.kept.map((item) => item.id)).toEqual(['a1', 'm1']) // 输出才是新的在前
    expect(result.kept[0]).toBe(frozen[1]) // 同一个对象，不是拷贝
    expect(result.kept.length + result.dropped.length).toBe(frozen.length)
  })

  it('同毫秒按输入顺序（输入约定新的在前），顺序稳定可复现', () => {
    const list = [entry('n1', 1000), entry('n2', 1000), entry('n3', 1000)]
    expect(pruneSnapshots(list, { keepAuto: 2 }).kept.map((item) => item.id)).toEqual(['n1', 'n2'])
    expect(pruneSnapshots(list.slice().reverse(), { keepAuto: 2 }).kept.map((item) => item.id)).toEqual(['n3', 'n2'])
  })

  it('keepAuto 必须是 ≥1 的整数，否则是配置事故直接报错', () => {
    expect(codeOfSync(() => pruneSnapshots([], { keepAuto: 0 }))).toBe(E_POLICY_KEEP_AUTO)
    expect(codeOfSync(() => pruneSnapshots([], { keepAuto: 2.5 }))).toBe(E_POLICY_KEEP_AUTO)
    expect(codeOfSync(() => pruneSnapshots([], { keepAuto: '3' }))).toBe(E_POLICY_KEEP_AUTO)
  })
})

/* ---------------- 3. 恢复 = 新建版本 ---------------- */

describe('恢复 · createRestoreRecord', () => {
  const source = createSnapshot(input({ id: 'v1', label: '第 1 版', blockCount: 6, payload: bytes(4, 3) }))

  it('产出新快照：新 id、新时间、新作者、kind=restore，原版本字段不变', () => {
    const restored = createRestoreRecord(source, { id: 'v9', author: 'u2', createdAt: 5000 })
    expect(restored.id).toBe('v9')
    expect(restored.kind).toBe('restore')
    expect(restored.createdAt).toBe(5000)
    expect(restored.author).toBe('u2')
    expect(restored.pinned).toBe(false)
    expect(restored.label).toBe('第 1 版') // 缺省沿用源版本名（待定：规格未定义）
    expect(restored.blockCount).toBe(6)
    expect(restored.sizeBytes).toBe(4)
    expect(source.id).toBe('v1')
    expect(source.author).toBe('u1')
    expect(source.kind).toBe('auto')
  })

  it('正文是拷贝：改源 buffer 不影响恢复出来的版本', () => {
    const mutable = createSnapshot(input({ id: 'v2', payload: bytes(2, 4) }))
    const restored = createRestoreRecord(mutable, { author: 'u2', createdAt: 6000 })
    mutable.payload[0] = 0
    expect(restored.payload[0]).toBe(4)
    expect(restored.payload).not.toBe(mutable.payload)
  })

  it('源不存在 / 只有元信息 / 缺作者 / 缺时间 各有明确错误', () => {
    expect(codeOfSync(() => createRestoreRecord(null, { author: 'u1', createdAt: 1 }))).toBe(E_VERSION_NOT_FOUND)
    const meta = normalizeSnapshot(source)
    expect(codeOfSync(() => createRestoreRecord(meta, { author: 'u1', createdAt: 1 }))).toBe(E_SNAPSHOT_PAYLOAD_MISSING)
    expect(codeOfSync(() => createRestoreRecord(source, { createdAt: 1 }))).toBe(E_SNAPSHOT_AUTHOR)
    expect(codeOfSync(() => createRestoreRecord(source, { author: 'u1' }))).toBe(E_SNAPSHOT_CREATED_AT)
    expect(createRestoreRecord(source, { author: 'u1', createdAt: 1 }).kind).toBe('restore')
  })
})

/* ---------------- 4. 差异摘要 ---------------- */
const docA = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '背景' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '旧正文' }] },
  ],
}

const docB = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '背景' }] },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '方案' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '新正文，更长一些' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '' }] },
  ],
}

describe('差异摘要 · diffSummary', () => {
  it('块数与字数只给增量，不做字符级 diff', () => {
    const diff = diffSummary(docA, docB)
    expect(diff.blockCount).toEqual({ prev: 2, next: 4, delta: 2 })
    expect(diff.charCount.prev).toBe(5)
    expect(diff.charCount.next).toBe(12)
    expect(diff.charCount.delta).toBe(7)
    expect(Object.keys(diff).sort()).toEqual(['blockCount', 'charCount', 'headings'])
  })

  it('标题增删按多重集算，顺序保持各自文档里的先后', () => {
    expect(diffSummary(docA, docB).headings).toEqual({ added: [{ level: 2, text: '方案' }], removed: [] })
    expect(diffSummary(docB, docA).headings.removed).toEqual([{ level: 2, text: '方案' }])
    const twice = diffSummary({ type: 'doc', content: [docA.content[0], docA.content[0]] }, docA)
    expect(twice.headings.removed).toEqual([{ level: 1, text: '背景' }])
  })

  it('接受 JSON 字符串与已算好的指标对象', () => {
    expect(diffSummary(JSON.stringify(docA), docB).blockCount.delta).toBe(2)
    const diff = diffSummary(
      { blockCount: 3, charCount: 100, headings: [{ level: 1, text: 'A' }] },
      { blockCount: 3, charCount: 120, headings: [{ level: 1, text: 'A' }] },
    )
    expect(diff.blockCount).toEqual({ prev: 3, next: 3, delta: 0 })
    expect(diff.charCount.delta).toBe(20)
    expect(diff.headings).toEqual({ added: [], removed: [] })
  })

  it('空 / 坏输入当空文档，不抛', () => {
    expect(projectionMetrics(null)).toEqual({ blockCount: 0, charCount: 0, headings: [] })
    expect(diffSummary('not json', undefined)).toEqual({
      blockCount: { prev: 0, next: 0, delta: 0 },
      charCount: { prev: 0, next: 0, delta: 0 },
      headings: { added: [], removed: [] },
    })
  })
})

/* ---------------- 5. 内存 Provider ---------------- */

describe('内存 versioning Provider', () => {
  function makeProvider() {
    let clock = 1000
    return { provider: createMemoryVersioningProvider({ author: 'tester', now: () => (clock += 100) }) }
  }

  it('满足 providers/versioning 的四个方法（契约校验直接通过）', () => {
    const provider = createMemoryVersioningProvider()
    VERSIONING_METHODS.forEach((method) => expect(typeof provider[method]).toBe('function'))
    expect(createVersioningProvider(provider)).toBe(provider)
  })

  it('createSnapshot 生成 id 与时间；list 只给元信息，新的在前', async () => {
    const { provider } = makeProvider()
    const first = await provider.createSnapshot({ documentId: 'doc-1', kind: 'auto', payload: bytes(4) })
    const second = await provider.createSnapshot({ documentId: 'doc-1', kind: 'manual', label: '里程碑', payload: bytes(6) })
    expect(first.id).toBe('v1')
    expect(second.id).toBe('v2')
    expect(first.author).toBe('tester')

    const list = await provider.list({ documentId: 'doc-1' })
    expect(list.map((item) => item.id)).toEqual(['v2', 'v1'])
    expect(list[0].payload).toBeUndefined() // 二进制不进列表
    expect(list[0].label).toBe('里程碑')
  })

  it('list 可按 documentId 过滤，缺省给全部（演示用）', async () => {
    const { provider } = makeProvider()
    await provider.createSnapshot({ documentId: 'doc-1', kind: 'auto', payload: bytes(2) })
    await provider.createSnapshot({ documentId: 'doc-2', kind: 'auto', payload: bytes(2) })
    expect((await provider.list({ documentId: 'doc-2' })).length).toBe(1)
    expect((await provider.list()).length).toBe(2)
  })

  it('get 返回正文拷贝：改返回值不会污染库里的不可变快照', async () => {
    const { provider } = makeProvider()
    const created = await provider.createSnapshot({ documentId: 'doc-1', kind: 'auto', payload: bytes(3, 6) })
    const first = await provider.get(created.id)
    first.payload[0] = 0
    expect((await provider.get(created.id)).payload[0]).toBe(6)
    expect(await codeOf(() => provider.get('nope'))).toBe(E_VERSION_NOT_FOUND)
  })

  it('restore 新建版本，原版本仍在链上（只增不减）', async () => {
    const { provider } = makeProvider()
    const original = await provider.createSnapshot({ documentId: 'doc-1', kind: 'auto', payload: bytes(5, 2), blockCount: 3 })
    const restored = await provider.restore(original.id)
    expect(restored.kind).toBe('restore')
    expect(restored.id).not.toBe(original.id)
    expect(restored.createdAt).toBeGreaterThan(original.createdAt)
    expect(Array.from(restored.payload)).toEqual(Array.from(original.payload))
    expect(restored.blockCount).toBe(3)

    const list = await provider.list({ documentId: 'doc-1' })
    expect(list.map((item) => item.kind)).toEqual(['restore', 'auto'])
    expect(Array.from((await provider.get(original.id)).payload)).toEqual([2, 2, 2, 2, 2])
  })

  it('恢复被保留策略淘汰的版本：报 E_VERSION_EVICTED，而不是「不存在」', async () => {
    const { provider } = makeProvider()
    const older = await provider.createSnapshot({ documentId: 'doc-1', kind: 'auto', payload: bytes(2) })
    const newer = await provider.createSnapshot({ documentId: 'doc-1', kind: 'auto', payload: bytes(2) })

    const pruned = provider.prune({ keepAuto: 1 })
    expect(pruned.kept.map((item) => item.id)).toEqual([newer.id])
    expect(pruned.dropped.map((item) => item.id)).toEqual([older.id])
    expect(pruned.dropped[0].payload).toBeUndefined() // 淘汰就是连正文一起没

    expect(await codeOf(() => provider.get(older.id))).toBe(E_VERSION_EVICTED)
    expect(await codeOf(() => provider.restore(older.id))).toBe(E_VERSION_EVICTED)
    expect((await provider.list()).length).toBe(1)
  })

  it('恢复点自己不会被下一轮淘汰', async () => {
    const { provider } = makeProvider()
    await provider.createSnapshot({ documentId: 'doc-1', kind: 'auto', payload: bytes(2) })
    const latest = await provider.createSnapshot({ documentId: 'doc-1', kind: 'auto', payload: bytes(2) })
    const restored = await provider.restore(latest.id)

    const pruned = provider.prune({ keepAuto: 1 })
    expect(pruned.kept.map((item) => item.id).sort()).toEqual([latest.id, restored.id].sort())
    expect(pruned.dropped).toHaveLength(1)
  })
})
