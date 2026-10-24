/** 文档级属性补丁事务：blockId 补号与缩进归一，都不进撤销栈、不冒泡成内容修改。 */
import { collectBlockIdFixes, collectIndentFixes } from '../documentOperations'

// 补块 id 的事务带这个标记：它对用户不可见，宿主不应把它当成一次内容修改。
export const BLOCK_ID_META = 'larkDocBlockIds'
// 缩进归一是纯属性修正，同样不能冒泡成一次内容修改。
export const INDENT_META = 'larkDocIndentNormalized'

/** 把缺失/重复的 blockId 补进当前事务；只改属性不改尺寸，位置不会失效。 */
export function applyBlockIdFixes(tr, fixes = collectBlockIdFixes(tr.doc)) {
  if (!fixes.length) return false
  fixes.forEach(({ pos, id }) => {
    const node = tr.doc.nodeAt(pos)
    if (node) tr.setNodeMarkup(pos, undefined, { ...node.attrs, blockId: id })
  })
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
