/**
 * 派生索引 DerivedIndex —— 折叠 / 编号 / 大纲 / 装饰的统一派生计算入口。
 * （requirements/09 §3.7 契约：P0-11 定签名 + 「全量重建」兜底实现，P7-01 填脏区实现。）
 *
 * P0-11 的兜底语义：任何事务都只「标记 dirty」，下一次 decorations() 调用时全量重建
 * —— 行为与收拢前逐字节一致（每次 view update 都重算一遍）。这一步没有任何优化，
 * 目的只有一个：把派生计算收拢到一个可替换的入口；P7-01 只换 update(tr) 的实现
 * （按 mapping 区间做局部重扫 + oldSet.map 打底），六个调用方一行不改。
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
     * 事务后更新。P0-11 兜底：收集 mapping 区间后整单标脏（含纯 meta 事务——
     * 搜索词 / 折叠集合 / 把手悬停都走 tr meta，不标脏会让装饰读到旧 UI 状态）。
     * @returns {{ changed: Array<{from: number, to: number}>, index: object }}
     */
    update(tr) {
      const changed = []
      // 纪律 1：受影响区间来自 tr.mapping.maps，不是 tr.docChanged——
      // 只取第一段在协同下必然漏更新。
      tr.mapping.maps.forEach((map) => {
        map.forEach((oldStart, oldEnd) => changed.push({ from: oldStart, to: oldEnd }))
      })
      currentDoc = tr.doc
      dirty = true
      return { changed: mergeRanges(changed), index }
    },

    /** 装饰集：dirty 或换文档时全量重建，否则返回缓存。 */
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
