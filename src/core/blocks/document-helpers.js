/** 文档级行为 helper：跨块边界保列光标移动 + 行首编号标记输入规则。 */
import { Selection, TextSelection } from '@tiptap/pm/state'

/**
 * 跨块边界的上下移动：保持光标的水平目标位，让 ArrowUp / ArrowDown 对称。
 * 在相邻文本块里找同一水平线上的最近行内位置；找不到返回 null 走默认行为。
 */
export const verticalBoundarySelection = (view, direction) => {
  const { state } = view
  const { selection } = state
  if (!selection.empty || !selection.$from.parent.isTextblock || !view.endOfTextblock(direction < 0 ? 'up' : 'down')) return null
  const current = view.coordsAtPos(selection.from)
  if (!current) return null
  // Resolve outside the current text block. `selection.to + 1` is still
  // inside a paragraph when the caret is at its first line, so ArrowDown
  // would otherwise rediscover the current block.
  const probe = direction < 0 ? selection.from - 1 : selection.$from.end() + 1
  const resolvedProbe = state.doc.resolve(Math.max(1, Math.min(state.doc.content.size, probe)))
  const target = Selection.findFrom(resolvedProbe, direction, true)
  if (!target || !target.$from.parent.isTextblock) return null
  const start = target.$from.start()
  const end = target.$from.end()
  const candidates = []
  for (let pos = start; pos <= end; pos += 1) {
    try {
      const coords = view.coordsAtPos(pos)
      if (!coords || !Number.isFinite(coords.top)) continue
      const lineIsBefore = coords.bottom <= current.top + 1
      const lineIsAfter = coords.top >= current.bottom - 1
      if ((direction < 0 && !lineIsBefore) || (direction > 0 && !lineIsAfter)) continue
      candidates.push({ pos, top: coords.top, x: (coords.left + coords.right) / 2 })
    } catch (error) {
      // Positions inside atom/leaf nodes may not have a browser caret box.
    }
  }
  if (!candidates.length) return null
  const targetLine = direction < 0 ? Math.max(...candidates.map((candidate) => candidate.top)) : Math.min(...candidates.map((candidate) => candidate.top))
  const lineCandidates = candidates.filter((candidate) => Math.abs(candidate.top - targetLine) <= 1.5)
  const targetX = (current.left + current.right) / 2
  const nearest = lineCandidates.reduce((best, candidate) => !best || Math.abs(candidate.x - targetX) < Math.abs(best.x - targetX) ? candidate : best, null)
  return nearest ? TextSelection.create(state.doc, nearest.pos) : null
}

/**
 * 行首编号标记（`1. ` / `1、` / `1。` / `1）`）→ 编号块。
 *
 * 返回 true 表示这次输入已经被消费（不再插入空格、也不再走 Tiptap 默认 input rule）。
 * 只在「标记正好从块的第一行第一个字符开始」时生效，和飞书一致：
 * 句子中间的 `1. ` 仍然是普通文本。
 */
export const LINE_START_MARKER = /^(\d{1,3})\s*[.．。、)）]$/

export function applyLineStartMarker(view, from) {
  const { state } = view
  const $from = state.doc.resolve(from)
  const parent = $from.parent
  // 只认段落和标题：代码块 / 表格单元格里的 `1. ` 是内容，不能变成列表。
  if (parent.type.name !== 'paragraph' && parent.type.name !== 'heading') return false
  if (!parent.textContent) return false
  const before = parent.textBetween(0, $from.parentOffset, null, '\ufffc')
  const match = LINE_START_MARKER.exec(before)
  if (!match) return false
  const startNumber = Number(match[1])
  if (!Number.isInteger(startNumber) || startNumber < 1 || startNumber > 999) return false
  // 已经在一个列表项里：交给默认规则处理，避免把条目再包一层。
  if ($from.depth >= 2 && $from.node($from.depth - 1).type.name === 'listItem') return false
  const markerStart = from - before.length
  const blockPos = $from.before($from.depth)
  const tr = state.tr.delete(markerStart, from)
  if (parent.type.name === 'heading') {
    // 标题不能包进列表：保留标题（文字不动），把标记换成真的标题编号。
    tr.setNodeMarkup(blockPos, parent.type, { ...parent.attrs, numbering: true, numberingStart: startNumber })
    tr.setSelection(TextSelection.create(tr.doc, Math.min(markerStart, tr.doc.content.size)))
    view.dispatch(tr.scrollIntoView())
    return true
  }
  const orderedList = state.schema.nodes.orderedList
  const listItem = state.schema.nodes.listItem
  if (!orderedList || !listItem) return false
  const range = tr.doc.resolve(markerStart).blockRange()
  if (!range) return false
  try {
    tr.wrap(range, [{ type: orderedList, attrs: { start: startNumber } }, { type: listItem }])
  } catch (error) {
    return false
  }
  // 列表多包了两层（ol > li），光标跟着往里挪两级。
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(markerStart + 2, tr.doc.content.size))))
  view.dispatch(tr.scrollIntoView())
  return true
}
