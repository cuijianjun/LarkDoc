/**
 * P8-02 候选 B：blockId 补号从「n 条 step」压成「1 条 step」。
 *
 * P8-01b 实测：2,000 块一次性灌入，`applyBlockIdFixes` 一块一条 `setNodeMarkup`，
 * 一次事务里堆出 7,932 条 step；每条 step 都要把该位置之前的 Fragment 重写一遍
 * （n × O(n)），`autolink` 的 `combineTransactionSteps` 又把这批 step 整批重放
 * （第二个 O(n²)）。把这笔事务整体摘掉，`setContent` 从 34.5 s 掉到 0.96 s。
 *
 * 所以改动是**压步数**，不是换算法：
 * - 条数 > `INPLACE_FIX_LIMIT`：整篇重建 Fragment、`replaceWith` 一次落地 → 1 条 step；
 * - 条数 ≤ 上限：保持原来的逐条 `setNodeMarkup`（日常编辑只有 1~2 条，逐条更快，
 *   也不会把全篇当成变更区让 `autolink` 重扫）。
 *
 * 这里守的是「一样」而不是「快」—— 快靠 `scripts/perf/attribute.mjs` 量，
 * 正确性只能靠逐字节比对：
 * - 整篇单步的结果必须与「逐条、每条一个事务」的结果**JSON 全等**；
 * - 尺寸必须一字不差（只换 attrs，位置记账才成立，代码里对不上直接抛错）；
 * - selection、其它 attrs、已有 blockId 一个都不能动。
 *
 * 环境用 node：只建 schema 与 EditorState，不开 Editor，不需要 DOM。
 */
import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import {
  BLOCK_ID_META, INDENT_META, INPLACE_FIX_LIMIT, applyBlockIdFixes, applyIndentFixes,
} from '../../src/core/blocks/block-fixes'
import {
  BLOCK_ID_PATTERN, BLOCK_ID_TYPES, MAX_BLOCK_INDENT, clampBlockIndent, collectBlockIdFixes,
} from '../../src/core/documentOperations'

const schema = getSchema(createLarkDocExtensions())

const docOf = (content) => schema.nodeFromJSON({ type: 'doc', content })
const stateOf = (content) => EditorState.create({ schema, doc: docOf(content) })

const para = (text, attrs) => ({
  type: 'paragraph',
  ...(attrs ? { attrs } : {}),
  ...(text ? { content: [{ type: 'text', text }] } : {}),
})
/** n 个各带一点文字的段落（文字长度不影响位置计算的正确性，但会真正暴露算错）。 */
const paras = (n, attrs) => Array.from({ length: n }, (_, i) => para(`第${i}段`, attrs))

/**
 * 给文档里每个可编号块按顺序配一个确定性 id（`b0`、`b1`…）。
 *
 * id 必须确定：`collectBlockIdFixes` 走的是随机 id，两个路径各跑一次就永远比不出
 * 「一样」。位置用 `descendants` 现取，跟实现的遍历口径一致。
 */
function deterministicFixes(doc) {
  const fixes = []
  doc.descendants((node, pos) => {
    if (!BLOCK_ID_TYPES.has(node.type.name)) return true
    fixes.push({ pos, id: `b${fixes.length}` })
    return true
  })
  return fixes
}

/** 逐条改的参考实现：每条 fix 单独一个事务，等价于改造前「一块一条 step」的语义。 */
function referenceApply(state, fixes) {
  return fixes.reduce((current, { pos, id }) => {
    const tr = current.tr
    const node = tr.doc.nodeAt(pos)
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, blockId: id })
    return current.apply(tr)
  }, state)
}

/** 文档里所有 blockId（跳过 null），按出现顺序。 */
function blockIds(doc) {
  const ids = []
  doc.descendants((node, pos) => {
    const id = node.attrs?.blockId
    if (typeof id === 'string' && id) ids.push({ pos, id })
    return true
  })
  return ids
}

describe('applyBlockIdFixes：没有待补块就不碰事务', () => {
  it('fixes 为空返回 false，不留 step、不留 meta', () => {
    const state = stateOf(paras(3))
    const tr = state.tr
    expect(applyBlockIdFixes(tr, [])).toBe(false)
    expect(tr.steps).toHaveLength(0)
    expect(tr.getMeta(BLOCK_ID_META)).toBeUndefined()
    expect(tr.getMeta('addToHistory')).toBeUndefined()
  })

  it('不传 fixes 时自己收集：已经全部编号的文档什么都不做', () => {
    const state = stateOf(paras(3, { blockId: 'b0' }))
    // 三个块同 id，必然要重编 —— 先补成唯一，再验证「无事可做」。
    const tr0 = state.tr
    const fixes = collectBlockIdFixes(state.doc)
    expect(fixes).toHaveLength(2)
    applyBlockIdFixes(tr0, fixes)
    const fixed = state.apply(tr0)
    const tr1 = fixed.tr
    expect(applyBlockIdFixes(tr1)).toBe(false)
    expect(tr1.steps).toHaveLength(0)
  })
})

describe('applyBlockIdFixes：条数 ≤ 上限仍走逐条 setNodeMarkup', () => {
  it('3 条 fix 就是 3 条 step，id 逐个写对', () => {
    const state = stateOf(paras(3))
    const fixes = deterministicFixes(state.doc)
    expect(fixes).toHaveLength(3)
    const tr = state.tr
    expect(applyBlockIdFixes(tr, fixes)).toBe(true)
    expect(tr.steps).toHaveLength(3)
    const next = state.apply(tr)
    expect(blockIds(next.doc)).toEqual(fixes)
  })

  it('阈值边界：正好 INPLACE_FIX_LIMIT 条是 N 条 step，多一条就变 1 条', () => {
    const atLimit = stateOf(paras(INPLACE_FIX_LIMIT))
    const trA = atLimit.tr
    applyBlockIdFixes(trA, deterministicFixes(atLimit.doc))
    expect(trA.steps).toHaveLength(INPLACE_FIX_LIMIT)

    const overLimit = stateOf(paras(INPLACE_FIX_LIMIT + 1))
    const trB = overLimit.tr
    applyBlockIdFixes(trB, deterministicFixes(overLimit.doc))
    expect(trB.steps).toHaveLength(1)
  })
})

describe('applyBlockIdFixes：条数 > 上限走整篇单步', () => {
  it('40 条 fix 只产生 1 条 step，且文档尺寸不变', () => {
    const state = stateOf(paras(40))
    const fixes = deterministicFixes(state.doc)
    expect(fixes).toHaveLength(40)
    const tr = state.tr
    expect(applyBlockIdFixes(tr, fixes)).toBe(true)
    expect(tr.steps).toHaveLength(1)
    const next = state.apply(tr)
    expect(next.doc.content.size).toBe(state.doc.content.size)
    expect(blockIds(next.doc)).toEqual(fixes)
  })

  it('结果与「逐条、每条一个事务」JSON 全等（含容器与叶子块）', () => {
    const content = [
      para('开头'),
      { type: 'blockquote', content: [para('引用一'), para('引用二')] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [para('列表项')] }] },
      { type: 'horizontalRule' },
      { type: 'codeBlock', content: [{ type: 'text', text: 'const a = 1' }] },
      ...paras(36),
    ]
    const state = stateOf(content)
    const fixes = deterministicFixes(state.doc)
    expect(fixes.length).toBeGreaterThan(INPLACE_FIX_LIMIT)

    const tr = state.tr
    applyBlockIdFixes(tr, fixes)
    expect(tr.steps).toHaveLength(1)
    const batched = state.apply(tr)
    const reference = referenceApply(state, fixes)

    expect(batched.doc.toJSON()).toEqual(reference.doc.toJSON())
    expect(batched.doc.textContent).toBe(reference.doc.textContent)
    expect(batched.doc.content.size).toBe(reference.doc.content.size)
  })

  it('嵌套容器内的块补在真实位置上，父块与子块各归各位', () => {
    const state = stateOf([
      { type: 'blockquote', content: [para('外层引用'), { type: 'blockquote', content: [para('内层引用')] }] },
    ])
    const fixes = deterministicFixes(state.doc)
    // 引用容器自己也在 BLOCK_ID_TYPES 里：外层引用 → 外层段落 → 内层引用 → 内层段落。
    expect(fixes).toHaveLength(4)
    const tr = state.tr
    applyBlockIdFixes(tr, fixes)
    const next = state.apply(tr)
    expect(blockIds(next.doc)).toEqual(fixes)
    const outer = next.doc.nodeAt(0)
    expect(outer.type.name).toBe('blockquote')
    expect(outer.attrs.blockId).toBe('b0')
    expect(outer.firstChild.attrs.blockId).toBe('b1')
    expect(outer.lastChild.type.name).toBe('blockquote')
    expect(outer.lastChild.attrs.blockId).toBe('b2')
    expect(outer.lastChild.firstChild.attrs.blockId).toBe('b3')
    // 位置真的没漂：每个 id 都落在 descendants 报的那个 pos 上。
    fixes.forEach(({ pos, id }) => expect(next.doc.nodeAt(pos).attrs.blockId).toBe(id))
  })

  it('整篇替换后 selection 原样保留（替换会把区间内位置压到端点）', () => {
    const state = stateOf(paras(40))
    const fixes = deterministicFixes(state.doc)
    // 落在中间某段的文字区：整篇替换会把区间内位置压到端点，落在这儿最容易暴露。
    const anchor = fixes[20].pos + 1
    const head = anchor + 2
    const withSelection = state.apply(state.tr.setSelection(TextSelection.create(state.doc, anchor, head)))
    const tr = withSelection.tr
    applyBlockIdFixes(tr, fixes)
    expect(tr.steps).toHaveLength(1)
    const next = withSelection.apply(tr)
    expect(next.selection.from).toBe(anchor)
    expect(next.selection.to).toBe(head)
    expect(next.selection instanceof TextSelection).toBe(true)
  })

  it('已有 blockId 与其它 attrs 一个字都不动，只补缺失的那些', () => {
    const content = [
      para('已编号', { blockId: 'keep1', indent: 2 }),
      ...paras(38),
      para('缩进块', { indent: MAX_BLOCK_INDENT }),
    ]
    const state = stateOf(content)
    const fixes = collectBlockIdFixes(state.doc)
    expect(fixes).toHaveLength(39)
    const tr = state.tr
    applyBlockIdFixes(tr, fixes)
    const next = state.apply(tr)
    expect(next.doc.nodeAt(0).attrs.blockId).toBe('keep1')
    expect(next.doc.nodeAt(0).attrs.indent).toBe(2)
    const last = next.doc.lastChild
    expect(last.attrs.indent).toBe(MAX_BLOCK_INDENT)
    expect(BLOCK_ID_PATTERN.test(last.attrs.blockId)).toBe(true)
  })

  it('重号块：只留先出现的那个，其余换新号，最终全局唯一且长度合规', () => {
    const state = stateOf(paras(40, { blockId: 'dup' }))
    const fixes = collectBlockIdFixes(state.doc)
    expect(fixes).toHaveLength(39)
    const tr = state.tr
    applyBlockIdFixes(tr, fixes)
    expect(tr.steps).toHaveLength(1)
    const ids = blockIds(state.apply(tr).doc).map((item) => item.id)
    expect(ids).toHaveLength(40)
    expect(new Set(ids).size).toBe(40)
    expect(ids.filter((id) => id === 'dup')).toHaveLength(1)
    expect(ids.every((id) => BLOCK_ID_PATTERN.test(id))).toBe(true)
  })

  it('两条路径都不进撤销栈，也都带 blockId 标记', () => {
    for (const count of [3, 40]) {
      const state = stateOf(paras(count))
      const tr = state.tr
      applyBlockIdFixes(tr, deterministicFixes(state.doc))
      expect(tr.getMeta('addToHistory')).toBe(false)
      expect(tr.getMeta(BLOCK_ID_META)).toBe(true)
    }
  })
})

describe('applyIndentFixes：改造后行为不变', () => {
  it('越界缩进压回上限，只改那一条，不进撤销栈', () => {
    const state = stateOf([para('正常'), para('越界', { indent: MAX_BLOCK_INDENT + 3 })])
    const positions = []
    state.doc.descendants((node, pos) => { if (node.type.name === 'paragraph') positions.push(pos); return true })
    const tr = state.tr
    expect(applyIndentFixes(tr)).toBe(true)
    expect(tr.steps).toHaveLength(1)
    expect(tr.getMeta('addToHistory')).toBe(false)
    expect(tr.getMeta(INDENT_META)).toBe(true)
    const next = state.apply(tr)
    expect(next.doc.nodeAt(positions[0]).attrs.indent).toBe(0)
    expect(next.doc.nodeAt(positions[1]).attrs.indent).toBe(clampBlockIndent(MAX_BLOCK_INDENT + 3))
  })

  it('没有越界缩进就返回 false', () => {
    const state = stateOf([para('正常'), para('五级', { indent: MAX_BLOCK_INDENT })])
    const tr = state.tr
    expect(applyIndentFixes(tr)).toBe(false)
    expect(tr.steps).toHaveLength(0)
  })
})
