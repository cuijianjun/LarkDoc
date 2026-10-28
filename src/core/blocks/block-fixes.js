/** 文档级属性补丁事务：blockId 补号与缩进归一，都不进撤销栈、不冒泡成内容修改。 */
import { Fragment } from '@tiptap/pm/model'
import { Selection } from '@tiptap/pm/state'
import { collectBlockIdFixes, collectIndentFixes } from '../documentOperations'

// 补块 id 的事务带这个标记：它对用户不可见，宿主不应把它当成一次内容修改。
export const BLOCK_ID_META = 'larkDocBlockIds'
// 缩进归一是纯属性修正，同样不能冒泡成一次内容修改。
export const INDENT_META = 'larkDocIndentNormalized'

/**
 * 「逐条改」与「整篇单步」的分界条数。
 *
 * 逐条 `setNodeMarkup` 每条 step 都要把文档 Fragment 重写一遍，n 个待补块就是 n × O(n)；
 * 同一次事务里的这几千条 step 还会被 `autolink`（Tiptap Link 扩展）用
 * `combineTransactionSteps` 整批重放一次 —— 两个 O(n²) 叠在一起。P8-01b 实测：2,000 块
 * 一次性灌入产生 7,932 条，`setContent` 34.5 s；把这笔事务摘掉只花 0.96 s。
 *
 * 但日常编辑（回车分段、粘三五个块）只有 1~2 条 —— 这种规模逐条改更快：不必整篇重建，
 * 也不会让 `autolink` 把全篇当成变更区重扫。所以按条数分流，分界取 32（一屏内能粘的块数）。
 */
export const INPLACE_FIX_LIMIT = 32

/**
 * 把 `fixes`（pos → 新 id）里的 id 写进文档，返回**新的 content Fragment**。
 *
 * `contentStart` 是这个节点内容区的起始位置：文档是 0，普通节点的第 p 位是 p + 1。
 * 只换 attrs、不动尺寸，所以位置在整轮重写过程中始终有效 —— 这也是能一次性重写的前提。
 */
function rebuildContent(node, contentStart, fixes) {
  let changed = false
  const children = []
  node.forEach((child, offset) => {
    const next = rebuildNode(child, contentStart + offset, fixes)
    if (next !== child) changed = true
    children.push(next)
  })
  return changed ? Fragment.fromArray(children) : node.content
}

function rebuildNode(node, pos, fixes) {
  const id = fixes.get(pos)
  const attrs = id === undefined ? node.attrs : { ...node.attrs, blockId: id }
  let content = node.content
  if (!node.isLeaf) {
    const next = rebuildContent(node, pos + 1, fixes)
    if (next !== node.content) content = next
  }
  if (content === node.content && id === undefined) return node
  return node.type.create(attrs, content, node.marks)
}

/** 整篇一次性替换：1 条 step 替代 n 条。`tr` 里已有的 step 不受影响（位置现算）。 */
function replaceWholeDoc(tr, fixes) {
  const map = new Map()
  fixes.forEach(({ pos, id }) => map.set(pos, id))
  const doc = tr.doc
  const content = rebuildContent(doc, 0, map)
  // 只换属性，内容尺寸必须一字不差。对不上说明位置算错了 —— 宁可抛错，也不要写坏文档。
  if (content.size !== doc.content.size) throw new Error('blockId 补号改变了文档尺寸，位置记账有误')
  // 整篇替换会把区间内的位置压到端点（selection 一并被压掉），所以先存 JSON、替换后按原样还原。
  const selection = tr.selection.toJSON()
  tr.replaceWith(0, doc.content.size, content)
  try {
    tr.setSelection(Selection.fromJSON(tr.doc, selection))
  } catch (_) {
    // 还原不了（极少见的自定义选区类型）就沿用映射后的选区，不影响文档正确性。
  }
}

/** 把缺失/重复的 blockId 补进当前事务；只改属性不改尺寸，位置不会失效。 */
export function applyBlockIdFixes(tr, fixes = collectBlockIdFixes(tr.doc)) {
  if (!fixes.length) return false
  if (fixes.length > INPLACE_FIX_LIMIT) {
    replaceWholeDoc(tr, fixes)
  } else {
    fixes.forEach(({ pos, id }) => {
      const node = tr.doc.nodeAt(pos)
      if (node) tr.setNodeMarkup(pos, undefined, { ...node.attrs, blockId: id })
    })
  }
  tr.setMeta('addToHistory', false)
  tr.setMeta(BLOCK_ID_META, true)
  return true
}

/** 把超出上限的缩进一次性压回上限（老 JSON / 手工粘贴的正文），不进撤销栈。 */
export function applyIndentFixes(tr, fixes = collectIndentFixes(tr.doc)) {
  if (!fixes.length) return false
  // 从后往前改，避免前面的 setNodeMarkup 让后面的位置失效。
  fixes.slice().sort((a, b) => b.pos - a.pos).forEach(({ pos, indent }) => {
    const node = tr.doc.nodeAt(pos)
    if (node && Number(node.attrs?.indent) !== indent) tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent })
  })
  tr.setMeta('addToHistory', false)
  tr.setMeta(INDENT_META, true)
  return true
}
