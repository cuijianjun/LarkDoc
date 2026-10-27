/**
 * 派生索引 DerivedIndex —— 折叠 / 编号 / 大纲 / 装饰的统一派生计算入口。
 * （requirements/09 §3.7 契约：P0-11 定签名 + 「全量重建」兜底实现，P7-01 填脏区实现。）
 *
 * 两条装饰路径（P7-01 起）：
 * - **热路径**（文本块内的纯文字改动）：`update(tr)` 按 §3.7 纪律 1 从 `tr.mapping.maps`
 *   收集**全部**改动区间，并按「块 + 一层父块」扩张、标题改动向后传播到下一个更高级标题；
 *   `decorations()` 用 `oldSet.map` 打底 + 只重算这些区间。
 * - **冷路径**（结构变更 / 纯 meta 事务 / 换文档 / `invalidate()`）：整份重建。
 *   节点增删、attrs 变更（缩进、级别、起编号）会让窗口外的序号与折叠变样，搜索词、
 *   折叠集合、把手悬停改的是 UI 状态而不是正文，两者都整份重建更稳 ——
 *   它们都是点击 / 回车级操作，不在击键路径上。
 */
/* global globalThis */
// 上面这行是给 eslint 的：`globalThis` 是 ES2020 标准全局，但本仓库 `.eslintrc` 只开了
// `env: { node: true }`（ecmaVersion 停在 2018），`no-undef` 认不出来。这里不改成
// `es2020: true`，是因为那会连带放宽 ecmaVersion，影响面比一个全局声明大。
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

/** 标题层级夹取到 1..9，与 advanceHeadingCounters 同一口径。 */
const headingLevel = (node) => Math.max(1, Math.min(9, Number(node?.attrs?.level) || 1))

/**
 * 把改动区间延伸到「下一个更高级标题之前」。
 *
 * 标题编号是向后传播的（改一个 H2 会重排它后面所有同级 H2），所以脏区必须
 * 延伸过去，否则局部重扫会留下错号。
 *
 * 门槛：**只有带编号的标题才传播**。computeHeadingNumbers 完全跳过未编号的标题
 * （它们既不产出标签也不推进计数器），所以改这类标题的文字一行都不会影响后面；
 * 不做这个判定的话，2,000 块文档里「改一个 H2 的文字」会把脏区一路扩到文末
 * （它后面没有更高级标题可停），局部重扫立刻退化成全量重建。
 * 「刚被打开编号」的标题由**新文档**上的同一遍判定覆盖 —— 那时 numbering 已是 true。
 */
export function extendHeadingRange(doc, range) {
  const found = headingAt(doc, range.from)
  if (!found || !found.parent) return range
  if (!found.node.attrs?.numbering) return range
  const level = headingLevel(found.node)
  let end = range.to
  let started = false
  let pos = found.parentStart
  for (let i = 0; i < found.parent.childCount; i += 1) {
    const child = found.parent.child(i)
    if (!started) {
      if (child === found.node) started = true
    } else if (isHeading(child)) {
      if (headingLevel(child) < level) return { from: range.from, to: Math.max(end, pos) }
      end = Math.max(end, pos + child.nodeSize)
    }
    pos += child.nodeSize
  }
  return { from: range.from, to: end }
}

function expandDirtyRanges(doc, ranges) {
  return mergeRanges(ranges.map((range) => extendHeadingRange(doc, expandBlockRange(doc, range))))
}

/** `from..to` 是否落在**同一个文本块内部**（不跨块边界）。 */
function insideOneTextblock(doc, from, to) {
  if (!doc?.resolve) return false
  const size = doc.content.size
  const start = Math.max(0, Math.min(size, from))
  const end = Math.max(start, Math.min(size, to))
  try {
    const $from = doc.resolve(start)
    const $to = doc.resolve(end)
    if (!$from.parent?.isTextblock || !$to.parent?.isTextblock) return false
    return $from.parent === $to.parent && start >= $from.start($from.depth) && end <= $from.end($from.depth)
  } catch (_) {
    return false
  }
}

/**
 * 「这一笔事务只改了某个文本块里的文字」——热路径唯一的准入条件。
 *
 * 为什么门槛放在 step 上：列表序号在同列表内累进、标题编号向后传播、折叠资格由
 * 「有没有缩进子树」决定、折叠段边界随标题/后代变化 —— 这四类都是**结构派生**的，
 * 一次节点增删或 attrs 变更就能让窗口外的装饰变样（插入一个列表项会让其后所有序号 +1，
 * 改 indent 会让父块的折叠箭头出现或消失），而窗口只覆盖被改块本身。
 *
 * 判断方式：
 * - 插入切片必须全是文字（含一个段落就说明在拆块，属结构变更）；
 * - 替换范围（含纯删除）必须落在同一文本块内部：删整段、合并段落、跨块选区都算结构变更。
 *
 * 非 ReplaceStep（`setNodeMarkup` / `addMark` / 结构替换）没有 `slice`，一律算结构变更。
 * 结构变更由调用方退回全量重建 —— 那是回车 / 粘贴 / 缩进 / 列表增删级操作，
 * 不在击键路径上，2,000 块约 36 ms，换取「绝不出现错号或漏折叠」。
 */
function isTextOnlyChange(doc, steps) {
  if (!Array.isArray(steps) || !steps.length) return false
  return steps.every((step) => {
    const slice = step && step.slice
    if (!slice || !slice.content) return false
    let textOnly = true
    slice.content.forEach((node) => { if (!node.isText) textOnly = false })
    if (!textOnly) return false
    return insideOneTextblock(doc, step.from, step.to)
  })
}

/**
 * 性能探针接收器（只给 `scripts/perf/measure.mjs` 用）。
 *
 * 宿主页挂上 `globalThis.__larkDocPerf = { samples: [] }` 才记账；没挂时这里只是一次属性
 * 读取，热路径代价可忽略。挂上后每次 `decorations()` 压入 `{ path, ms }`，`path` 区分
 * 走了增量分支还是退回全量重建 —— 采集侧只统计 `path === 'incremental'` 的那些。
 *
 * 为什么计时必须放在这一层：装饰增量那一段（`previous.map` + 窗口重扫）夹在
 * `view.dispatch` 内部，外面只能量到「dispatch → 下一次绘制」的整段，混着 DOM 补丁、
 * 排版与合成，量不出装饰层自己的开销。
 */
function perfSink() {
  const sink = typeof globalThis === 'undefined' ? null : globalThis.__larkDocPerf
  return sink && Array.isArray(sink.samples) ? sink : null
}

/**
 * @param {object} options
 * @param {import('@tiptap/pm/model').Node} options.doc 首次构建时的文档（骨架期仅作初始 doc 引用）
 * @param {import('@tiptap/pm/model').Schema} options.schema 局部重扫时按节点类型判断折叠资格与编号传播边界
 * @param {(state: object) => object} rebuild 全量重建回调：输入当前 state，输出 DecorationSet
 * @param {(ctx: {state: object, previous: object, ranges: Array<{from: number, to: number}>}) => object} [options.incremental]
 *   脏区增量回调（P7-01）。`previous` 已经由本模块 `map` 到新文档坐标，`ranges` 是
 *   「可能变脏」的区间（同样是新文档坐标）。不传就退回全量重建（老宿主/测试桩）。
 */
export function createDerivedIndex({ doc, schema, rebuild, incremental }) {
  let currentDoc = doc
  let cachedDoc = null
  let cachedSet = null
  let dirty = true
  // 热路径待消费批次：自上次 decorations() 以来每笔 docChanged 事务的 { mapping, doc }。
  // 一次 dispatch 里 appendTransaction 追加的事务也算一笔（回车新块的 blockId 补全就是），
  // 所以必须能按顺序叠多步，不能只留最后一笔 —— 否则 blockId 修正那笔会丢掉前一笔的偏移。
  let pendingSteps = []
  // 脏区统一存**最新 doc** 坐标：每来一笔事务先把它前移到新坐标，再并本笔的新段。
  let pendingRanges = []

  const resetPending = () => { pendingSteps = []; pendingRanges = [] }

  /**
   * 把区间前移到 mapping 之后。
   *
   * left 用 assoc -1、right 用 assoc +1：在区间边界上插入的内容要算进脏区
   * （否则新块的装饰会落在窗口外，旧集合里又没有），删除导致的退化区间再规整一次。
   */
  const mapForward = (mapping, ranges) => {
    if (!ranges.length) return []
    if (!mapping || typeof mapping.map !== 'function') return ranges.map((range) => ({ ...range }))
    return ranges.map((range) => {
      const left = mapping.map(range.from, -1)
      const right = mapping.map(range.to, 1)
      return left <= right ? { from: left, to: right } : { from: right, to: left }
    })
  }

  const index = {
    schema,

    /**
     * 事务后更新：收集 mapping 区间、按块（+ 一层父块）与标题传播扩张，登记为待消费脏区。
     *
     * `changed` 是「装饰可能变化的区间」，坐标相对**改动前的文档**（§3.7 纪律 1 的对外口径）。
     * 内部另存一份前移到最新文档坐标的脏区，供热路径的 `find` 使用。
     *
     * @param {object} tr
     * @param {{touchesDecorations?: boolean}} [flags]
     *   `touchesDecorations=false` 表示「这笔事务不可能改动装饰的输入」——纯选区事务、
     *   其他插件的 meta。装饰只依赖 (doc, query/activeIndex/folded/handleHover)，
     *   两者都没变就该直接复用缓存，否则每次点击、每个方向键都会白付一次全量重建。
     * @returns {{ changed: Array<{from: number, to: number}>, index: object }}
     */
    update(tr, { touchesDecorations = true } = {}) {
      const changed = []
      // 纪律 1：受影响区间来自 tr.mapping.maps，不是 tr.docChanged——
      // 只取第一段在协同下必然漏更新。
      tr.mapping.maps.forEach((map) => {
        map.forEach((oldStart, oldEnd) => changed.push({ from: oldStart, to: oldEnd }))
      })
      const rawChanged = mergeRanges(changed)
      const docChanged = tr.docChanged || rawChanged.length > 0
      const expanded = docChanged ? expandDirtyRanges(currentDoc, rawChanged) : []
      if (docChanged) {
        // 只有「文本块内的纯文字改动」才值得脏区重扫；节点增删 / attrs 变更会让
        // 窗口外的编号与折叠变样，直接整份重建（判据见 isTextOnlyChange）。
        if (isTextOnlyChange(currentDoc, tr.steps)) {
          pendingRanges = mergeRanges([
            ...mapForward(tr.mapping, pendingRanges),
            ...mapForward(tr.mapping, expanded),
          ])
          pendingSteps.push({ mapping: tr.mapping, doc: tr.doc })
        } else {
          resetPending()
        }
        dirty = true
      } else if (touchesDecorations) {
        // 纯 UI 事务（搜索词 / 折叠集合 / 把手悬停）：改的是装饰输入，整份重建比
        // 局部推断更稳，而且这些都是点击级操作，不在击键路径上。
        resetPending()
        dirty = true
      }
      currentDoc = tr.doc
      return { changed: expanded, index }
    },

    /**
     * 装饰集：热路径只重扫脏区，冷路径整份重建。
     *
     * 热路径 = 「这一帧只有 docChanged 事务」。`previous.map` 打底（结构共享）后，
     * 只摘掉脏区内的旧装饰并重算这些区间，脏区外的 widget 实例与 spec.key 原样保留 ——
     * 视图按 key 复用 widget DOM，脏区外的一个都不重建。
     */
    decorations(state) {
      if (!dirty && state.doc === cachedDoc) return cachedSet
      const doc = state.doc
      const sink = perfSink()
      const startedAt = sink ? performance.now() : 0
      let path = 'rebuild'
      // 待消费批次必须正好落在当前文档上；对不上（例如有人直接换了文档）就走冷路径。
      const pendingDoc = pendingSteps.length ? pendingSteps[pendingSteps.length - 1].doc : null
      const canIncremental = !!incremental && !!cachedSet && pendingDoc === doc && pendingRanges.length > 0
      if (canIncremental) {
        let previous = cachedSet
        pendingSteps.forEach((step) => { previous = previous.map(step.mapping, step.doc) })
        // incremental 返回 null = 「这帧不适合增量」（例如搜索高亮开着，全局命中序号
        // 在脏区里拼不回来）：退回全量，绝不拿半个结果当结果。
        const next = incremental({ state, previous, ranges: pendingRanges.slice() })
        if (next) {
          cachedSet = next
          path = 'incremental'
        } else {
          cachedSet = rebuild(state)
        }
      } else {
        cachedSet = rebuild(state)
      }
      cachedDoc = doc
      dirty = false
      resetPending()
      if (sink) sink.samples.push({ path, ms: performance.now() - startedAt })
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
      resetPending()
    },
  }
  return index
}
