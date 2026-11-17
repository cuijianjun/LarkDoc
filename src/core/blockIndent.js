/**
 * 块缩进：像素步长、层级上限与「按位置夹取 / 步进」的一组工具。
 *
 * 从 `core/documentOperations.js` 原样搬出（函数体一行未改）。
 */


/** 缩进层级对应的像素步长与上限（对齐飞书实测：每级 25px，最深 6 层 = 5 级缩进）。 */
export const INDENT_STEP_PX = 25
export const MAX_BLOCK_INDENT = 5

/**
 * 缩进层级的唯一钳制入口。
 *
 * 飞书的块缩进到第 6 层（= 缩进 5 级）就不再下沉，任何入口（快捷键、工具栏、
 * 气泡菜单、块菜单、导入的 JSON/HTML）都必须走这里，避免出现「某个入口能一直加」。
 */
export function clampBlockIndent(value, max = MAX_BLOCK_INDENT) {
  const limit = Number.isFinite(Number(max)) ? Math.max(0, Math.min(MAX_BLOCK_INDENT, Number(max))) : MAX_BLOCK_INDENT
  const level = Number(value)
  if (!Number.isFinite(level)) return 0
  return Math.max(0, Math.min(limit, Math.round(level)))
}

/**
 * 越界安全的 doc.nodeAt。
 *
 * 宿主整体替换正文（setContent / 恢复快照）后，上一帧记下的块位置可能已经超出文档尺寸，
 * prosemirror 的 nodeAt 会直接抛 RangeError 并把渲染栈打崩；这里统一返回 null。
 */
export function nodeAtSafe(doc, pos) {
  if (!doc || !Number.isInteger(pos) || pos < 0 || pos >= doc.content.size) return null
  return doc.nodeAt(pos)
}

/** 收集超出上限的缩进（老数据/外部 JSON），用于挂载与 setContent 后一次性归一。 */
export function collectIndentFixes(doc) {
  const fixes = []
  if (!doc || typeof doc.descendants !== 'function') return fixes
  doc.descendants((node, pos) => {
    const value = node?.attrs?.indent
    if (!Number.isInteger(value)) return
    const next = clampBlockIndent(value)
    if (next !== value) fixes.push({ pos, node, indent: next })
  })
  return fixes
}

export function nodeIndent(node, fallback = 0) {
  return Number.isInteger(node?.attrs?.indent) ? node.attrs.indent : fallback
}

/**
 * 一个块的「有效缩进层级」。
 *
 * 段落/标题以自身 indent 为准（0 就是顶层）；容器与原子块（代码块、表格、引用、图片…）
 * 的 indent=0 只表示「没设过」，在计算上级关系时按 0 处理（它们是顶层盒子）。
 */
export function blockEffectiveIndent(node) {
  const own = Number.isInteger(node?.attrs?.indent) ? node.attrs.indent : 0
  return own > 0 ? own : 0
}

/**
 * 一个位置上的块「最多能缩进到第几级」—— 由**前一个兄弟块**决定。
 *
 * 飞书的块缩进不是绝对层级，而是「成为上一个块的子块」：所以
 * - 文档 / 父容器的第一个块没有前兄弟 → 上限 0（缩不动）；
 * - 前块 0 级 → 上限 1；前块 2 级 → 上限 3；
 * - 仍然不超过硬上限 MAX_BLOCK_INDENT（6 层）。
 *
 * 减少缩进**不受此限**：只受 0 下限约束，可以一路减回文档开头。
 */
export function maxIndentAt(doc, pos, max = MAX_BLOCK_INDENT) {
  if (!doc || !Number.isInteger(pos) || pos < 0 || pos > doc.content.size) return 0
  const ceiling = Number.isFinite(Number(max)) ? Math.max(0, Math.min(MAX_BLOCK_INDENT, Number(max))) : MAX_BLOCK_INDENT
  let $pos
  try { $pos = doc.resolve(Math.min(pos, doc.content.size)) } catch (_) { return 0 }
  // 位置落在文本块内部时先退到该块的起点，否则 index() 拿到的是行内偏移。
  if ($pos.depth > 0 && $pos.parent.isTextblock) {
    try { $pos = doc.resolve($pos.before($pos.depth)) } catch (_) { return 0 }
  }
  const index = $pos.index()
  if (index <= 0) return 0
  const previous = $pos.parent.child(index - 1)
  return Math.min(ceiling, blockEffectiveIndent(previous) + 1)
}

/** 按「前一个兄弟块」算出的上限来钳制缩进值（直接设置缩进时用；减少缩进不要走这里）。 */
export function clampBlockIndentAt(doc, pos, value, max = MAX_BLOCK_INDENT) {
  const limit = maxIndentAt(doc, pos, max)
  const level = Number(value)
  if (!Number.isFinite(level)) return 0
  return Math.max(0, Math.min(limit, Math.round(level)))
}

/**
 * 缩进/减少缩进的下一步层级 —— 所有入口（工具栏、气泡、块菜单、⌘] / ⌘[）共用。
 *
 * - 增加：不能超过 maxIndentAt（前一个兄弟块 + 1）；已经到顶或老数据超顶时原地不动，
 *   不会「点一下增加反而跳到 0」；
 * - 减少：只受 0 下限约束，可以一路减回文档开头（真飞书实测：到顶后依然能一路减）。
 */
export function stepBlockIndent(doc, pos, currentIndent, delta, max = MAX_BLOCK_INDENT) {
  const current = Number(currentIndent) || 0
  if (delta < 0) return Math.max(0, current + delta)
  const limit = maxIndentAt(doc, pos, max)
  if (current >= limit) return current
  return Math.min(current + 1, limit)
}
