/**
 * 文本匹配与改写：slash / mention 触发、全文查找、替换与块级移动、目录抽取。
 *
 * 从 `core/documentOperations.js` 原样搬出（函数体一行未改）。
 */
import { Fragment } from '@tiptap/pm/model'
import { moveDepthAllowed } from './blocks/container-depth'


/** 检测段落中未完成的 slash 输入；返回 { from, to, query } 或 null（代码内不触发）。 */
export function getSlashMatch(state) {
  const { $from, empty } = state.selection
  if (!empty || $from.parent.type.name !== 'paragraph') return null
  const before = $from.parent.textBetween(0, $from.parentOffset, '\n', '\ufffc')
  const match = /(?:^|\s)\/([^/\s]*)$/.exec(before)
  if (!match) return null
  let inCode = false
  $from.parent.nodesBetween($from.parentOffset - match[1].length - 1, $from.parentOffset, (node) => { if (node.marks.some((mark) => mark.type.name === 'code')) inCode = true })
  return inCode ? null : { from: $from.pos - match[1].length - 1, to: $from.pos, query: match[1] }
}

/**
 * 检测文本块里未完成的 `@` 输入；返回 `{ from, to, query }` 或 null。
 *
 * 与 `getSlashMatch` 的三处差异都是 02 §19.3 的行为差异，不是随手放松：
 *   1. **标题 / 列表项里也能 @**（飞书支持），所以只排除代码块，不限定 paragraph；
 *   2. `@` 前必须是词边界（行首或空白）—— 否则 `a@b.com` 一敲就弹面板；
 *   3. `@` 后不吞空白：查询串只到下一个空白/`@` 为止（飞书输入「@张 三」时
 *      面板会关掉，不存在「带空格查询」）。
 *
 * IME 组字期间**不在这里挡**：`document.js` 的 `view.composing` 与
 * `compositionstart/end` 已经在触发链路上双重拦截（见该文件）。
 */
export function getMentionMatch(state) {
  const { $from, empty } = state.selection
  if (!empty) return null
  const parent = $from.parent
  if (!parent.isTextblock || parent.type.name === 'codeBlock') return null
  const before = parent.textBetween(0, $from.parentOffset, '\n', '\ufffc')
  const match = /(?:^|\s)@([^@\s]*)$/.exec(before)
  if (!match) return null
  let inCode = false
  const start = $from.parentOffset - match[1].length - 1
  parent.nodesBetween(start, $from.parentOffset, (node) => {
    if (node.marks.some((mark) => mark.type.name === 'code')) inCode = true
  })
  return inCode ? null : { from: $from.pos - match[1].length - 1, to: $from.pos, query: match[1] }
}

/**
 * 查找字符串（按字面量转义，跨块不误配）；返回 [{ from, to }] 位置数组。
 *
 * `ranges` 非空时只扫与这些区间相交的文本块（P7-01 脏区重扫用）：命中结果与全文扫描
 * 在**脏区内部**逐项相同，脏区外的命中留在旧的 DecorationSet 里不动，不需要重复给。
 */
export function findTextMatches(doc, query, ranges = null) {
  if (typeof query !== 'string' || !query) return []
  const matches = []
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
  const scan = (node, pos) => {
    // 文本 Mark 不改变位置；叶节点占位防止跨公式/Emoji 错配。
    const value = node.textBetween(0, node.content.size, '', '\ufffc')
    pattern.lastIndex = 0
    let match = pattern.exec(value)
    while (match) {
      matches.push({ from: pos + 1 + match.index, to: pos + 1 + match.index + match[0].length })
      match = pattern.exec(value)
    }
  }
  if (Array.isArray(ranges) && ranges.length) {
    // nodesBetween 会带出与区间相交的**整个**文本块，边界半截的块也在内 —— 与脏区
    // 已经扩张到块边界的前提一致，不会漏算半块里的命中。
    ranges.forEach((range) => {
      doc.nodesBetween(range.from, range.to, (node, pos) => {
        if (node.isTextblock) { scan(node, pos); return false }
        return true
      })
    })
    return matches
  }
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return
    scan(node, pos)
  })
  return matches
}

/** 替换查找命中：默认替换当前/首个匹配，all=true 替换全部；返回替换数量。 */
export function replaceText(editor, query, replacement, all = false, preparedMatches = null) {
  if (!editor.isEditable || typeof replacement !== 'string') return 0
  const matches = preparedMatches || findTextMatches(editor.state.doc, query)
  const selection = editor.state.selection
  const current = matches.find((match) => match.from === selection.from && match.to === selection.to)
    || matches[editor.storage?.larkDoc?.activeIndex || 0] || matches[0]
  const selected = all ? matches : current ? [current] : []
  if (!selected.length) return 0
  const tr = editor.state.tr
  selected.slice().reverse().forEach(({ from, to }) => {
    const marks = tr.doc.resolve(from).marks()
    if (replacement) tr.replaceWith(from, to, editor.state.schema.text(replacement, marks))
    else tr.delete(from, to)
  })
  editor.view.dispatch(tr)
  return selected.length
}

/** 把 [from, to) 的完整块整体移动到 target 位置；结构非法时返回 false 不动文档。 */
export function moveBlockRange(editor, from, to, target) {
  let { doc } = editor.state
  if (!editor.isEditable || ![from, to, target].every(Number.isInteger) || from < 0 || from >= to || to > doc.content.size || target < 0 || target > doc.content.size || (target >= from && target <= to)) return false
  const tr = editor.state.tr
  const mapped = editor.storage?.larkDoc?.pagedView?.prepareBlockRange(tr, [from, to, target])
  if (mapped) { [from, to, target] = mapped; doc = tr.doc }
  // P1-05：容器嵌套深度兜底判定（拖拽 / 上移下移共用入口）。
  if (!moveDepthAllowed({ state: { doc } }, from, to, target)) return false
  const start = doc.resolve(from)
  const end = doc.resolve(to)
  const dest = doc.resolve(target)
  if (!start.sameParent(end) || start.textOffset || end.textOffset || dest.textOffset) return false
  const first = start.index()
  const last = end.index()
  if (start.pos !== start.posAtIndex(first) || end.pos !== end.posAtIndex(last) || dest.pos !== dest.posAtIndex(dest.index())) return false
  const slice = doc.slice(from, to)
  if (slice.openStart || slice.openEnd) return false
  let filler = Fragment.empty
  if (!start.parent.canReplace(first, last)) {
    const empty = start.parent.type.contentMatch.defaultType?.createAndFill()
    if (!empty) return false
    filler = Fragment.from(empty)
    if (!start.parent.canReplace(first, last, filler)) return false
  }
  const step = tr.steps.length
  tr.replaceWith(from, to, filler)
  const insertAt = tr.mapping.slice(step).map(target, target > to ? -1 : 1)
  const destination = tr.doc.resolve(insertAt)
  if (!destination.parent.canReplace(destination.index(), destination.index(), slice.content)) return false
  tr.insert(insertAt, slice.content)
  tr.doc.check()
  editor.view.dispatch(tr)
  return true
}

/** 收集页面级标题大纲（排除容器内标题）；返回 [{ pos, level, text }]。 */
export function collectOutline(doc) {
  const result = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return
    const resolved = doc.resolve(pos)
    const hiddenByContainer = Array.from({ length: resolved.depth }, (_, index) => resolved.node(index + 1).type.name)
      .some((type) => ['callout', 'blockquote', 'detailsContent', 'column', 'tableCell', 'tableHeader'].includes(type))
    if (!hiddenByContainer) result.push({ pos, level: node.attrs.level, text: node.textContent })
  })
  return result
}
