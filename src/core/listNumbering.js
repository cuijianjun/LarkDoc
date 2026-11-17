/**
 * 有序 / 无序列表的层级编号：第 1 层 `1.`、第 2 层 `a.`、第 3 层 `i.`。
 *
 * 与标题编号是两套规则（那边是「章节号」，这边是「这一层自己的序号」）。
 * 从 `core/documentOperations.js` 原样搬出（函数体一行未改）。
 */
import { nodeAtSafe } from './blockIndent'

/**
 * 有序列表的编号：飞书按「层级」换样式，不是一路阿拉伯数字。
 *
 *   第 1 层 `1.`  第 2 层 `a.`  第 3 层 `i.`  第 4 层又回到 `1.`
 *
 * 和标题编号（`1.` / `1.1` / `1.1.1` 复合数字）是两套规则：标题编号是「章节号」，
 * 列表编号是「这一层自己的序号」。两者都由装饰层现算，不写进正文文本。
 */
export const ORDERED_LIST_FORMATS = ['decimal', 'lower-alpha', 'lower-roman']
const ALPHA_LABEL = 'abcdefghijklmnopqrstuvwxyz'
const ROMAN_LABEL = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]

/** 1 → a，26 → z，27 → aa（飞书小写字母编号）。 */
export function alphaListLabel(value) {
  let number = Math.max(1, Math.round(Number(value) || 1))
  let label = ''
  while (number > 0) {
    number -= 1
    label = ALPHA_LABEL[number % 26] + label
    number = Math.floor(number / 26)
  }
  return label
}

/** 1 → i，4 → iv，9 → ix（飞书小写罗马编号）。 */
export function romanListLabel(value) {
  let number = Math.max(1, Math.min(3999, Math.round(Number(value) || 1)))
  let label = ''
  ROMAN_LABEL.forEach(([amount, glyph]) => {
    while (number >= amount) { label += glyph; number -= amount }
  })
  return label
}

/** 某一层第 index 项的编号文本（depth 从 1 开始）。 */
export function formatOrderedIndex(value, depth = 1) {
  const index = Math.max(1, Math.min(9999, Math.round(Number(value) || 1)))
  const level = Math.max(1, Math.round(Number(depth) || 1))
  const format = ORDERED_LIST_FORMATS[(level - 1) % ORDERED_LIST_FORMATS.length]
  if (format === 'lower-alpha') return `${alphaListLabel(index)}.`
  if (format === 'lower-roman') return `${romanListLabel(index)}.`
  return `${index}.`
}

/** 这个列表在第几层（外层每套一个同类列表记一层）。 */
function listDepth(doc, pos, typeName) {
  try {
    const $pos = doc.resolve(pos)
    let depth = 1
    for (let level = $pos.depth; level > 0; level -= 1) {
      if ($pos.node(level).type.name === typeName) depth += 1
    }
    return depth
  } catch (_) {
    return 1
  }
}

/** 有序列表在第几层（第 1 层 `1.`、第 2 层 `a.`、第 3 层 `i.`）。 */
export function orderedListDepth(doc, pos) {
  return listDepth(doc, pos, 'orderedList')
}

/** 无序列表在第几层（只影响圆点的缩进层级）。 */
export function bulletListDepth(doc, pos) {
  return listDepth(doc, pos, 'bulletList')
}

/**
 * 同一父容器中最近的前一个有序列表。
 *
 * 「继续编号」要跨列表接号（飞书同款：上一个列表排到 3，这个列表从 4 起），
 * 可以跨过普通正文，但不进入别的父容器；是否接号仍由 continueFrom 显式决定。
 */
export function previousSiblingOrderedList(doc, pos) {
  if (!doc || !Number.isInteger(pos)) return null
  try {
    const $pos = doc.resolve(pos)
    let previousPos = pos
    for (let index = $pos.index() - 1; index >= 0; index -= 1) {
      const previous = $pos.parent.child(index)
      previousPos -= previous.nodeSize
      if (previous.type.name === 'orderedList') return { node: previous, pos: previousPos }
      if (previous.type.name !== 'paragraph') return null
    }
    return null
  } catch (_) {
    return null
  }
}

/**
 * 列表序号能不能点「继续编号」。
 *
 * 两种情况可继续：
 * 1. 该 item 自己有显式起点（`numberStart`）→ 清掉即回到接着上一个 item 数；
 * 2. 它是列表首项、且同容器前面还有有序列表 → 让这个列表接上最近列表的序号。
 *
 * 其余情况（孤立的列表、已经处于继续态）禁用 —— 与飞书菜单一致。
 */
export function canContinueListNumber(doc, pos) {
  if (!doc || !Number.isInteger(pos)) return false
  const node = nodeAtSafe(doc, pos)
  if (!node || node.type.name !== 'listItem') return false
  if (Number.isInteger(node.attrs?.numberStart)) return true
  try {
    const $pos = doc.resolve(pos)
    const parent = $pos.parent
    if (!parent || parent.type.name !== 'orderedList') return false
    if (parent.attrs?.continueFrom) return false
    if ($pos.index() !== 0) return false
    return !!previousSiblingOrderedList(doc, $pos.before())
  } catch (_) {
    return false
  }
}

/**
 * 扫描全文档的有序列表，返回 `Map<listItem 的 pos, { label, depth, index, numberStart }>`。
 *
 * 序号按列表自己的 `start` 起算（`<ol start="3">` → 3./4./5.），
 * 嵌套列表各算各的，和外层序号无关 —— 与飞书一致。
 *
 * 单个 item 上的 `numberStart`（等价 HTML `<li value="N">`）会把该 item 的序号
 * 拉回指定值，后面的兄弟项接着它继续 —— 这是「重新开始编号 / 设置编号的值」
 * 落库的方式：只标一个起点，编号值本身仍然每帧现算。
 *
 * 列表上的 `continueFrom`（「继续编号」写下的标记）让这个列表接着**同容器前面最近的**
 * 有序列表的最后一项继续排；前一个列表增删条目时跟着变，不落死数字。
 */
/**
 * 一趟结构化遍历所有「同类型列表」，顺路带下嵌套层数与同容器前一个同类列表位置。
 *
 * 原实现每个列表都调 `listDepth(doc, pos)` → `doc.resolve(pos)`，扁平文档上是
 * O(块数) 的随机访问，几百个列表叠起来就是 O(n²)（2,000 块实测 30 ms 级）。
 * 前兄弟位置在每次 walk 内保存，不跨容器，也不为每个列表重扫此前兄弟。
 *
 * 语义与 `listDepth` 一致：层数 = 祖先里同类列表容器的个数 + 1。
 */
function eachList(doc, typeName, visit) {
  const walk = (parent, parentStart, depth) => {
    let pos = parentStart
    let previousPos = null
    for (let index = 0; index < parent.childCount; index += 1) {
      const child = parent.child(index)
      const isSame = child.type.name === typeName
      if (isSame) {
        visit(child, pos, depth + 1, previousPos)
        previousPos = pos
      } else if (child.type.name !== 'paragraph') previousPos = null
      // 文本块只含行内内容，不可能藏有列表；跳过其正文，避免每次击键的
      // 两遍列表扫描都访问全文文本/marks。块容器与嵌套列表仍按原深度遍历。
      if (!child.isTextblock && child.content.size) walk(child, pos + 1, isSame ? depth + 1 : depth)
      pos += child.nodeSize
    }
  }
  walk(doc, 0, 0)
}

export function computeOrderedListNumbers(doc) {
  const result = new Map()
  if (!doc) return result
  // 每个列表排到第几号（ol 起始 pos → 最后一项的序号），供后面的「继续编号」接号。
  const totals = new Map()
  eachList(doc, 'orderedList', (node, pos, depth, previousPos) => {
    let start = Number(node.attrs?.start) > 0 ? Number(node.attrs.start) : 1
    if (node.attrs && node.attrs.continueFrom) {
      const prevTotal = previousPos === null ? undefined : totals.get(previousPos)
      if (Number.isFinite(prevTotal)) start = prevTotal + 1
    }
    let current = start
    node.forEach((item, offset) => {
      if (item.type.name !== 'listItem') return
      const explicit = Number(item.attrs?.numberStart)
      if (Number.isFinite(explicit) && explicit > 0) current = Math.round(explicit)
      // `firstChildIsParagraph` 给装饰层直接用：列表标记只挂在「首子是段落」的 item 上，
      // 判定所需的 node 这里本来就有，调用方再 doc.nodeAt(pos) 一次就是 O(n) 随机访问。
      result.set(pos + 1 + offset, {
        label: formatOrderedIndex(current, depth),
        depth,
        index: current,
        numberStart: item.attrs?.numberStart ?? null,
        firstChildIsParagraph: item.firstChild?.type.name === 'paragraph',
      })
      current += 1
    })
    totals.set(pos, current - 1)
  })
  return result
}

/** 无序列表的圆点：同样走装饰层（浏览器 ::marker 会正好落在折叠箭头 / 句柄的位置上）。 */
export function computeBulletItems(doc) {
  const result = new Map()
  if (!doc) return result
  eachList(doc, 'bulletList', (node, pos, depth) => {
    node.forEach((item, offset) => {
      if (item.type.name === 'listItem') {
        result.set(pos + 1 + offset, { depth, firstChildIsParagraph: item.firstChild?.type.name === 'paragraph' })
      }
    })
  })
  return result
}
