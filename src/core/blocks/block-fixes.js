/** 文档级属性补丁事务：blockId 补号与缩进归一，都不进撤销栈、不冒泡成内容修改。 */
import { Fragment } from '@tiptap/pm/model'
import { Step, StepResult, Transform } from '@tiptap/pm/transform'
import { collectBlockIdFixes, collectIndentFixes } from '../documentOperations'

// 补块 id 的事务带这个标记：它对用户不可见，宿主不应把它当成一次内容修改。
export const BLOCK_ID_META = 'larkDocBlockIds'
// 缩进归一是纯属性修正，同样不能冒泡成一次内容修改。
export const INDENT_META = 'larkDocIndentNormalized'
// Controller imports already normalize their detached model; skip the plugin's duplicate pass.
export const DEFER_BLOCK_ID_META = 'larkDocDeferBlockIds'

/**
 * 「逐条属性 step」与「批量属性 step」的分界条数。
 *
 * 逐条 `setNodeMarkup` 每条 step 都要把文档 Fragment 重写一遍，n 个待补块就是 n × O(n)；
 * 同一次事务里的这几千条 step 还会被 `autolink`（Tiptap Link 扩展）用
 * `combineTransactionSteps` 整批重放一次 —— 两个 O(n²) 叠在一起。P8-01b 实测：2,000 块
 * 一次性灌入产生 7,932 条，`setContent` 34.5 s；把这笔事务摘掉只花 0.96 s。
 *
 * 但日常编辑（回车分段、粘三五个块）只有 1~2 条 —— 这种规模逐条改更快：不必整篇重建，
 * 也不必整篇重建。所以按条数分流，分界取 32（一屏内能粘的块数）。
 */
export const INPLACE_FIX_LIMIT = 32

/**
 * 把位置对应的属性补丁写进文档，保留尺寸、marks 和无关属性。
 *
 * `contentStart` 是这个节点内容区的起始位置：文档是 0，普通节点的第 p 位是 p + 1。
 * 只换 attrs、不动尺寸，所以位置在整轮重写过程中始终有效 —— 这也是能一次性重写的前提。
 */
function rebuildContent(node, contentStart, changes, found) {
  let changed = false
  const children = []
  node.forEach((child, offset) => {
    const pos = contentStart + offset
    const change = changes.get(pos)
    const patch = change && change.type === child.type.name && !child.isText
      && Object.keys(change.attrs).every(key => Object.prototype.hasOwnProperty.call(child.attrs, key)) ? change.attrs : null
    if (patch) found.add(pos)
    const content = child.isLeaf ? child.content : rebuildContent(child, pos + 1, changes, found)
    const next = patch || content !== child.content ? child.type.create(patch ? { ...child.attrs, ...patch } : child.attrs, content, child.marks) : child
    if (next !== child) changed = true
    children.push(next)
  })
  return changed ? Fragment.fromArray(children) : node.content
}

/** One linear tree copy with an empty position map, like a batch of AttrStep. */
class BatchAttrsStep extends Step {
  constructor(changes) { super(); this.changes = changes }
  apply(doc) {
    const changes = new Map(this.changes.map(change => [change.pos, change]))
    const found = new Set()
    const content = rebuildContent(doc, 0, changes, found)
    if (found.size !== this.changes.length || content.size !== doc.content.size) return StepResult.fail('Invalid batch attribute positions')
    return StepResult.ok(doc.copy(content))
  }
  invert(doc) {
    const changes = new Map(this.changes.map(change => [change.pos, change.attrs]))
    const inverse = []
    doc.descendants((node, pos) => {
      const attrs = changes.get(pos)
      if (attrs) inverse.push({ pos, type: node.type.name, attrs: Object.fromEntries(Object.keys(attrs).map(key => [key, node.attrs[key]])) })
    })
    return new BatchAttrsStep(inverse)
  }
  map(mapping) {
    const changes = []
    this.changes.forEach(({ pos, type, attrs }) => {
      const mapped = mapping.mapResult(pos, 1)
      if (!mapped.deletedAfter) changes.push({ pos: mapped.pos, type, attrs })
    })
    return changes.length ? new BatchAttrsStep(changes) : null
  }
  toJSON() { return { stepType: 'larkDocBatchAttrsV1', changes: this.changes } }
  static fromJSON(schema, json) {
    if (!Array.isArray(json.changes) || json.changes.some(change => !Number.isInteger(change?.pos) || change.pos < 0
      || typeof change.type !== 'string' || !schema.nodes[change.type]
      || !change.attrs || typeof change.attrs !== 'object' || Array.isArray(change.attrs)
      || !Object.keys(change.attrs).length || Object.keys(change.attrs).some(key => key !== 'blockId' && key !== 'indent')
      || ('blockId' in change.attrs && change.attrs.blockId !== null && typeof change.attrs.blockId !== 'string')
      || ('indent' in change.attrs && !Number.isInteger(change.attrs.indent)))
      || new Set(json.changes.map(change => change.pos)).size !== json.changes.length) {
      throw new RangeError('Invalid batch attribute step')
    }
    return new BatchAttrsStep(json.changes)
  }
}
// Two SDK bundles may share the same external PM runtime. Reuse its registered
// implementation rather than registering the same protocol twice.
const batchStepKey = Symbol.for('lark-doc:batch-attrs:v1')
const AttributeStep = Step[batchStepKey] || (Step[batchStepKey] = Step.jsonID('larkDocBatchAttrsV1', BatchAttrsStep))

function applyAttributes(tr, changes, batch) {
  if (batch && changes.length > INPLACE_FIX_LIMIT) {
    const byPosition = new Map(changes.map(change => [change.pos, change]))
    const typed = []
    tr.doc.descendants((node, pos) => {
      const change = byPosition.get(pos)
      if (change) typed.push({ ...change, type: node.type.name })
    })
    if (typed.length !== changes.length) throw new RangeError('Invalid batch attribute positions')
    tr.step(new AttributeStep(typed))
  } else changes.forEach(({ pos, attrs }) => {
    Object.keys(attrs).forEach(key => tr.setNodeAttribute(pos, key, attrs[key]))
  })
}

/** Normalize a detached import before its first view update, without history metadata. */
export function normalizeImportedBlockAttributes(doc, reservedIds) {
  const changes = new Map()
  collectBlockIdFixes(doc, undefined, reservedIds).forEach(({ pos, id }) => changes.set(pos, { blockId: id }))
  collectIndentFixes(doc).forEach(({ pos, indent }) => changes.set(pos, { ...changes.get(pos), indent }))
  if (!changes.size) return doc
  const transform = new Transform(doc)
  applyAttributes(transform, [...changes].map(([pos, attrs]) => ({ pos, attrs })), true)
  return transform.doc
}

/** 把缺失/重复的 blockId 补进当前事务；只改属性不改尺寸，位置不会失效。 */
export function applyBlockIdFixes(tr, fixes = collectBlockIdFixes(tr.doc), { batch = true } = {}) {
  if (!fixes.length) return false
  applyAttributes(tr, fixes.map(({ pos, id }) => ({ pos, attrs: { blockId: id } })), batch)
  tr.setMeta('addToHistory', false)
  tr.setMeta(BLOCK_ID_META, true)
  return true
}

/** 把超出上限的缩进一次性压回上限（老 JSON / 手工粘贴的正文），不进撤销栈。 */
export function applyIndentFixes(tr, fixes = collectIndentFixes(tr.doc), { batch = true } = {}) {
  if (!fixes.length) return false
  applyAttributes(tr, fixes.map(({ pos, indent }) => ({ pos, attrs: { indent } })), batch)
  tr.setMeta('addToHistory', false)
  tr.setMeta(INDENT_META, true)
  return true
}
