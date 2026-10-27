/**
 * 派生索引 DerivedIndex —— 折叠 / 编号 / 大纲 / 装饰的统一派生计算入口。
 * （requirements/09 §3.7 契约：P0-11 定签名 + 「全量重建」兜底实现，P7-01 填脏区实现。）
 *
 * 现状：`update(tr)` 已按 §3.7 纪律 1 从 `tr.mapping.maps` 收集**全部**改动区间，
 * 并按「块 + 一层父块」扩张、标题改动向后传播到下一个更高级标题，
 * 作为 `changed` 返回给调用方；`decorations()` 仍是全量重建。
 *
 * 为什么装饰仍然全量重算：列表序号（同列表内累进）、标题编号（向后传播）、
 * 折叠范围（缩进子树）三种装饰都跨块，局部重扫必须为每种维护可增量接续的前缀状态，
 * 否则会输出错值。真正的局部重扫在确认收益口径后再接（见 P7 收口计划）。
 */
import {
  collectOutline,
  computeHeadingNumbers,
  foldableIdPositions,
  foldedRange,
} from '../documentOperations'

/**
 * 合并重叠/相邻区间。§3.7 纪律 1 要求 update(tr) 的 changed 必须来自
 * tr.mapping.maps（一个事务可含多处不连续改动，协同远端尤其如此），
 * 这里负责把散段收敛成互不重叠的区间，P7 的局部重扫直接消费。
 */
export function mergeRanges(ranges) {
  if (!ranges.length) return []
  const sorted = ranges.slice().sort((a, b) => a.from - b.from || a.to - b.to)
  const merged = [{ ...sorted[0] }]
  for (let i = 1; i < sorted.length; i += 1) {
    const last = merged[merged.length - 1]
    const next = sorted[i]
    // from 相等或落在上一段内视为重叠；贴边（from === last.to）也算相邻可并。
    if (next.from <= last.to) last.to = Math.max(last.to, next.to)
    else merged.push({ ...next })
  }
  return merged
}

const isHeading = (node) => node?.type?.name === 'heading'

/**
 * Expand a mapping range to the smallest block context whose decorations can
 * change.  A text edit needs its text block plus one containing block so fold
 * and section decorations keep the same boundary semantics as a full scan.
 */
function expandBlockRange(doc, range) {
  if (!doc?.resolve || !Number.isFinite(doc.content?.size)) return { ...range }
  const size = doc.content.size
  const from = Math.max(0, Math.min(size, range.from))
  const to = Math.max(from, Math.min(size, range.to))
  let resolved
  try {
    resolved = doc.resolve(from)
  } catch (_) {
    return { from, to }
  }
  let blocks = 0
  let expandedFrom = from
  let expandedTo = to
  for (let depth = resolved.depth; depth > 0 && blocks < 2; depth -= 1) {
    const node = resolved.node(depth)
    if (!node?.isBlock) continue
    try {
      expandedFrom = Math.min(expandedFrom, resolved.before(depth))
      expandedTo = Math.max(expandedTo, resolved.after(depth))
      blocks += 1
    } catch (_) { /* malformed test doubles fall back to the mapped range */ }
  }
  // A range at a block boundary can resolve above the edited block.  Probe the
  // right edge as well so an insertion/deletion still expands to its block.
  if (blocks === 0 && to > from) {
    try {
      const right = doc.resolve(Math.max(from, to - 1))
      for (let depth = right.depth; depth > 0 && blocks < 2; depth -= 1) {
        const node = right.node(depth)
        if (!node?.isBlock) continue
        expandedFrom = Math.min(expandedFrom, right.before(depth))
        expandedTo = Math.max(expandedTo, right.after(depth))
        blocks += 1
      }
    } catch (_) { /* keep mapped range */ }
  }
  return { from: expandedFrom, to: expandedTo }
}

/** 找出 pos 所属的标题块及其直接父容器与父内容起点。 */
function headingAt(doc, pos) {
  if (!doc?.resolve) return null
  let resolved
  try { resolved = doc.resolve(pos) } catch (_) { return null }
  for (let depth = resolved.depth; depth > 0; depth -= 1) {
    const node = resolved.node(depth)
    if (!isHeading(node)) continue
    const parentDepth = depth - 1
    return { node, parent: resolved.node(parentDepth), parentStart: resolved.start(parentDepth) }
  }
  // pos 正好落在块起点时 resolve 停在父容器上（不会自动进入该块），块本身在 nodeAfter。
  // 区间的 from 就是 expandBlockRange 给的块边界，大多数编辑都走这一支。
  if (isHeading(resolved.nodeAfter)) {
    return { node: resolved.nodeAfter, parent: resolved.parent, parentStart: resolved.start(resolved.depth) }
  }
  return null
}

/**
 * Extend a changed heading range to the next heading with a shallower level.
 *
 * 标题编号是向后传播的（改一个 H2 会重排它后面所有同级 H2），所以脏区必须
 * 延伸到「下一个更高级标题之前」，否则局部重扫会留下错号。
 */
function extendHeadingRange(doc, range) {
  const found = headingAt(doc, range.from)
  if (!found || !found.parent) return range
  const level = Number(found.node.attrs?.level) || 1
  let end = range.to
  let started = false
  let pos = found.parentStart
  for (let i = 0; i < found.parent.childCount; i += 1) {
    const child = found.parent.child(i)
    if (!started) {
      if (child === found.node) started = true
    } else if (isHeading(child)) {
      if ((Number(child.attrs?.level) || 1) < level) return { from: range.from, to: Math.max(end, pos) }
      end = Math.max(end, pos + child.nodeSize)
    }
    pos += child.nodeSize
  }
  return { from: range.from, to: end }
}

function expandDirtyRanges(doc, ranges) {
  return mergeRanges(ranges.map((range) => extendHeadingRange(doc, expandBlockRange(doc, range))))
}

/**
 * @param {object} options
 * @param {import('@tiptap/pm/model').Node} options.doc 首次构建时的文档（骨架期仅作初始 doc 引用）
 * @param {import('@tiptap/pm/model').Schema} options.schema 留给 P7：局部重扫时按节点类型判断折叠资格与编号传播边界
 * @param {(state: object) => object} rebuild 全量重建回调：输入当前 state，输出 DecorationSet
 */
export function createDerivedIndex({ doc, schema, rebuild }) {
  let currentDoc = doc
  let cachedDoc = null
  let cachedSet = null
  let dirty = true

  const index = {
    schema,

    /**
     * 事务后更新：收集 mapping 区间、按块扩张后整单标脏。
     *
     * 标脏是**必须**的（不是保守）：列表序号、标题编号、折叠范围都是跨块的，
     * 一次文本编辑就可能改掉后面一整串值；纯 meta 事务（搜索词 / 折叠集合 /
     * 把手悬停）同样走 tr meta，不标脏会让装饰读到旧 UI 状态。
     *
     * 返回的 changed 是「装饰可能变化的区间」，供局部重扫使用。
     * @returns {{ changed: Array<{from: number, to: number}>, index: object }}
     */
    update(tr) {
      const changed = []
      // 纪律 1：受影响区间来自 tr.mapping.maps，不是 tr.docChanged——
      // 只取第一段在协同下必然漏更新。
      tr.mapping.maps.forEach((map) => {
        map.forEach((oldStart, oldEnd) => changed.push({ from: oldStart, to: oldEnd }))
      })
      const rawChanged = mergeRanges(changed)
      const docChanged = tr.docChanged || rawChanged.length > 0
      const expanded = docChanged ? expandDirtyRanges(currentDoc, rawChanged) : []
      currentDoc = tr.doc
      dirty = true
      return { changed: expanded, index }
    },

    /** 装饰集：脏了就重建（全量），否则直接给缓存。 */
    decorations(state) {
      if (dirty || state.doc !== cachedDoc) {
        cachedSet = rebuild(state)
        cachedDoc = state.doc
        dirty = false
      }
      return cachedSet
    },

    /** 标题编号：pos 处编号标题返回 { label, level, counters }，否则 null。 */
    headingNumbers(pos) {
      return computeHeadingNumbers(currentDoc).get(pos) || null
    },

    /** 大纲/目录复用同一份：{ pos, level, text, blockId }，容器内标题不出现。 */
    outline() {
      if (!currentDoc) return []
      return collectOutline(currentDoc).map((item) => ({
        ...item,
        // 节点已被删除时 collectOutline 不会给出该 pos，这里只是防御式读取。
        blockId: currentDoc.nodeAt(item.pos)?.attrs?.blockId ?? null,
      }))
    },

    /** 折叠范围：blockId 对应可折叠块的 { from, to }，不存在/不可折返回 null。 */
    foldRanges(blockId) {
      if (!currentDoc) return null
      const pos = foldableIdPositions(currentDoc).get(blockId)
      if (pos === undefined) return null
      return foldedRange(currentDoc, pos) || null
    },

    /** 兜底失效：结构大变时整体重建（换文档、restore、schema 级操作）。 */
    invalidate() {
      dirty = true
      cachedSet = null
    },
  }
  return index
}
