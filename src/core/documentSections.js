/**
 * 章节与折叠：按标题切节、节点归属判定、折叠范围与 blockId 维护。
 *
 * 从 `core/documentOperations.js` 原样搬出（函数体一行未改）。这是这一族里最大的一块，
 * 也是唯一一处横向依赖另外三块的地方（文本目录、标题容器、缩进层级）。
 */
import { nodeIndent } from './blockIndent'
import { isolatedHeadingContainers } from './headingNumbering'

/**
 * 章节扫描时判断一个块自己的层级。
 *
 * 段落/标题的 indent=0 表示「回到顶层」；容器与原子块（代码块、表格、引用、图片…）
 * 的 indent=0 只表示「没设过」，沿用上一层——否则在缩进段落里插入代码块，
 * 代码块会以 0 级把章节截断。显式缩进过（>0）的这些块仍然按自己的层级算。
 */
function sectionIndent(node, inherited) {
  const own = Number.isInteger(node?.attrs?.indent) ? node.attrs.indent : null
  const authoritative = own !== null && (own > 0 || node.type.name === 'paragraph' || node.type.name === 'heading')
  return authoritative ? own : inherited
}

function sectionBlock(node, pos, role) {
  return { from: pos, to: pos + node.nodeSize, node, role }
}

/**
 * Resolve one heading's real section in its immediate parent container.
 * The returned blocks are the only blocks allowed to receive section state;
 * `to` is intentionally the first excluded sibling rather than a giant DOM range.
 */
export function resolveHeadingSection(doc, pos) {
  return resolveHeadingSectionMode(doc, pos)
}

/**
 * 解析一个标题的章节范围，折叠与悬停高亮共用同一套规则。
 *
 * 飞书的章节边界是**缩进子树**而不是标题级别：块模型里每个块只有一个父块，
 * 子块靠缩进挂在父块下面。所以 H2 后面没有缩进的 H3/H4 是它的兄弟块，折叠 H2
 * 不会带走它们；反过来缩进更深的普通段落、代码块、列表都属于 H2 的子树。
 * 目录（collectOutline）仍然按标题级别排，那是另一套语义。
 */
/**
 * 从宿主块的**下一个兄弟**开始向后扫，找出一段「缩进子树」的边界。
 *
 * 这是章节边界的唯一实现：单点解析（resolveHeadingSectionMode）与全量折叠范围
 * （collectFoldRanges）都调它。
 *
 * 入参全部来自调用方手上已有的结构（父节点、子序号、子起点、父内容终点），
 * 所以这里**不做任何 `doc.resolve` / `doc.nodeAt`** —— 扁平文档里两者都是
 * O(子节点数)，逐块调用会把整趟扫描拖成 O(n²)（P7-01 实测 2,000 块全量重建
 * 574 ms 的主因就是这两个随机访问）。
 *
 * @returns {{ end: number, hasDescendantHeading: boolean, blocks: Array }}
 *   `end` 是第一个**不属于**该子树的兄弟起点；扫到父内容结尾仍未截断时等于 `parentEnd`。
 */
function scanSectionSiblings(parent, startIndex, startChildPos, baseIndent, hostNode, parentEnd) {
  // 老文档里代码块/表格还没有 indent 属性，沿用前一个兄弟块的层级，
  // 否则子树的连续性会被一个缺属性的块截断。
  let previousIndent = baseIndent
  let hasDescendantHeading = false
  let end = parentEnd
  const blocks = []
  const hostIsText = hostNode.type.name === 'paragraph' || hostNode.type.name === 'heading'
  let siblingPos = startChildPos
  for (let index = startIndex; index < parent.childCount; index += 1) {
    if (parent.positionAt) siblingPos = parent.positionAt(index)
    const sibling = parent.child(index)
    const indent = sectionIndent(sibling, previousIndent)
    // 列表在视觉上天然缩进（序号/圆点画在正文列之外），飞书里标题/段落下面
    // 直接跟一个没有显式缩进的列表时，列表就是它的子块（折叠 + 高亮都算进去）。
    // 显式 indent > 0 的列表按显式值走，不受这里影响。
    const ownIndent = Number.isInteger(sibling.attrs?.indent) ? sibling.attrs.indent : null
    // 只有段落/标题做宿主时，未缩进列表才算隐式子块（列表符号画在正文列之外，
    // 视觉上天然挂在文字块下面）；代码块等容器盒子后面的列表仍是顶层兄弟。
    const implicitList = hostIsText && LIST_SECTION_TYPES.has(sibling.type.name) && !(ownIndent > 0)
    const effective = implicitList ? Math.max(indent, baseIndent + 1) : indent
    if (effective <= baseIndent) { end = siblingPos; break }
    // 继承基准仍用原始缩进：列表的「隐式 +1」只决定它自己算不算子块，
    // 不能把列表后面同样没缩进的代码块/表格也吸进子树。
    previousIndent = indent
    const isHeading = sibling.type.name === 'heading'
    if (isHeading) hasDescendantHeading = true
    if (sibling.isBlock) blocks.push(sectionBlock(sibling, siblingPos, isHeading ? 'descendant-heading' : 'body'))
    siblingPos += sibling.nodeSize
  }
  return { end, hasDescendantHeading, blocks }
}

export function resolveHeadingSectionMode(doc, pos) {
  if (pos < 0 || pos > doc.content.size) return null
  const resolved = doc.resolve(pos)
  // 块位置是「子节点起点」，nodeAfter 就是要解析的块；nodeAt 在这里是白跑一次
  // 线性查找（见 scanSectionSiblings 的注释）。
  const heading = resolved.nodeAfter
  // 飞书的章节不属于标题：段落、列表、代码块只要下面挂了子块，折叠与悬停高亮
  // 都按同一套「缩进子树」处理（用户实测：段落 + 缩进代码块也是一个整体）。
  if (!heading || !heading.isBlock) return null
  const { parent, index, end } = siblingContext(doc, resolved)
  const scan = scanSectionSiblings(
    parent,
    index + 1,
    pos + heading.nodeSize,
    nodeIndent(heading),
    heading,
    end,
  )
  const blocks = [sectionBlock(heading, pos, 'heading'), ...scan.blocks]
  // hasContent 的语义是「标题下面还有块」——只挂子标题也算有内容，
  // 悬停时整段高亮成一块（飞书的遮罩就是一个矩形）。
  const hasContent = blocks.length > 1
  return { from: pos, to: scan.end, headingPos: pos, heading, parent, blocks, hasContent, hasDescendantHeading: scan.hasDescendantHeading }
}

/** resolveHeadingSectionMode 的 highlight 模式别名，供旧调用方与高亮逻辑使用。 */
export function resolveHeadingHighlightSection(doc, pos) {
  return resolveHeadingSectionMode(doc, pos)
}

/**
 * 任意块能否折叠：块级节点、有稳定 blockId、且不在表格单元格等隔离容器里。
 *
 * 折叠偏好按 blockId 存，所以没有 id 的块（结构性容器）不参与；
 * 有没有「可折叠内容」由 foldedRange 判断，这里只管资格。
 */
function isFoldableNodeAt($pos, node) {
  if (!node || !node.isBlock || !BLOCK_ID_TYPES.has(node.type.name)) return false
  for (let depth = 1; depth <= $pos.depth; depth += 1) {
    if (isolatedHeadingContainers.has($pos.node(depth).type.name)) return false
  }
  return true
}

export function isFoldableBlock(doc, pos) {
  if (!doc || !Number.isInteger(pos) || pos < 0 || pos >= doc.content.size) return false
  const resolved = doc.resolve(pos)
  return isFoldableNodeAt(resolved, resolved.nodeAfter)
}

/** 判断标题是否属于页面大纲（不在 callout/表格等隔离容器内）。 */
export function isPageHeading(doc, pos) {
  if (!doc || pos < 0 || pos > doc.content.size) return false
  const resolved = doc.resolve(pos)
  if (!resolved.nodeAfter || resolved.nodeAfter.type.name !== 'heading') return false
  for (let depth = 1; depth <= resolved.depth; depth += 1) {
    if (isolatedHeadingContainers.has(resolved.node(depth).type.name)) return false
  }
  return true
}

/**
 * 折叠范围核心：入参是结构遍历已有的「节点 + 位置 + 父节点 + 子序号 + 父内容终点」，
 * 不做随机访问，供单点 foldedRange 与全量 collectFoldRanges 共用一份规则。
 */
function foldRangeOf(node, pos, parent, index, parentEnd) {
  // 列表项的子树在自己内部：首个子段落之后的内容（嵌套子列表、代码块…）才是可折叠部分。
  if (node.type.name === 'listItem' || node.type.name === 'taskItem') {
    if (node.childCount < 2) return null
    const from = pos + 1 + node.child(0).nodeSize
    const to = pos + node.nodeSize - 1
    return to > from ? { from, to } : null
  }
  // item 的「标题行」（首个子段落）不单独折叠：折叠入口归 item 自己。
  // 否则同一段内容会同时挂上 item 的箭头和首段落的箭头（两个 widget 落在同一个
  // 行内位置、互相盖住），点其中一个等于把另一个刚设的状态又切回去。
  if ((parent.type.name === 'listItem' || parent.type.name === 'taskItem') && index === 0) return null
  if (node.type.name === 'heading' && nodeIndent(node) === 0) {
    const from = pos + node.nodeSize
    let to = parentEnd, siblingPos = from, hasContent = false
    const level = Number(node.attrs.level) || 1
    // 标题章节不要求正文有视觉缩进；边界是同一 parent 中下一个同级/更高级标题。
    // 分页兄弟之间含内部页壳：沿真实位置截断，末章覆盖到真实父内容终点。
    for (let siblingIndex = index + 1; siblingIndex < parent.childCount; siblingIndex += 1) {
      if (parent.positionAt) siblingPos = parent.positionAt(siblingIndex)
      const sibling = parent.child(siblingIndex)
      if (sibling.type.name === 'heading' && (Number(sibling.attrs.level) || 1) <= level) { to = siblingPos; break }
      hasContent = true
      siblingPos += sibling.nodeSize
    }
    return hasContent && to > from ? { from, to } : null
  }
  const scan = scanSectionSiblings(parent, index + 1, pos + node.nodeSize, nodeIndent(node), node, parentEnd)
  const from = pos + node.nodeSize
  // 空范围等于「没有子块」：折叠箭头不该出现，调用方也无事可做。
  return scan.end > from ? { from, to: scan.end } : null
}

/** 计算某个块的折叠范围 [{ from, to }]；没有内容时返回 null。
 *
 * - 无缩进的标题：同一 parent 内直到下一个同级或更高级标题的章节正文；
 * - 有缩进的标题、段落和其它块：缩进子树，文本宿主保留隐式列表规则；
 * - 列表项：子树在自己内部，从首个子段落之后到 item 结尾。
 */
export function foldedRange(doc, pos) {
  if (!doc || !Number.isInteger(pos) || pos < 0 || pos >= doc.content.size) return null
  const resolved = doc.resolve(pos)
  const node = resolved.nodeAfter
  if (!isFoldableNodeAt(resolved, node)) return null
  const { parent, index, end } = siblingContext(doc, resolved)
  return foldRangeOf(node, pos, parent, index, end)
}

function siblingContext(doc, resolved) {
  const parent = doc.type.schema.cached.segmentSiblings?.(doc, resolved) || resolved.parent
  return { parent, index: parent.positionAt ? parent.indexAt(resolved.pos) : resolved.index(), end: parent.positionAt ? doc.content.size : resolved.end() }
}

/**
 * 全文档的折叠范围：`Map<块起点, { from, to, node }>`。
 *
 * 与逐块 `foldedRange(doc, pos)` 结果逐项相同，区别只在于**一趟结构化遍历**：
 * 父节点、子序号、子起点、父内容终点都在遍历里现成，不出现任何
 * `doc.nodeAt` / `doc.resolve`。装饰层建折叠箭头用它（2,000 块从 275 ms 降到个位数）。
 */
export function collectFoldRanges(doc, idPositions) {
  const ranges = new Map()
  if (!doc) return ranges
  const collectIds = idPositions && typeof idPositions.set === 'function'
  walkBlocks(doc, 0, false, (node, pos, index, isolated, parent, parentEnd) => {
    if (isolated || !node.isBlock || !BLOCK_ID_TYPES.has(node.type.name)) return
    const id = node.attrs && node.attrs.blockId
    if (collectIds && typeof id === 'string' && id) idPositions.set(id, pos)
    const range = foldRangeOf(node, pos, parent, index, parentEnd)
    if (range) ranges.set(pos, { from: range.from, to: range.to, node })
  })
  return ranges
}

/**
 * 结构化块遍历：一次走完整棵树。
 *
 * `descendants` 只给 (node, pos)，拿不到父节点、子序号、父内容终点 —— 而章节扫描
 * 需要这三样，于是每个调用点都用 `doc.resolve(pos)` 反查，逐个 O(子节点数)。
 * 这里自己走，需要的结构全部顺路带下去。
 *
 * `isolated` = 「自己或任一祖先在隔离容器里」（表格单元格、callout…），
 * 等价于原先每块重算 `doc.resolve(pos)` 再逐层查祖先。
 */
function walkBlocks(parent, parentStart, isolated, visit) {
  parent = parent.type.schema.cached.segmentSiblings?.(parent) || parent
  const parentEnd = parentStart + parent.content.size
  let pos = parentStart
  for (let index = 0; index < parent.childCount; index += 1) {
    const child = parent.child(index)
    const childPos = parent.positionAt ? parent.positionAt(index) : pos
    pos += child.nodeSize
    const childIsolated = isolated || isolatedHeadingContainers.has(child.type.name)
    visit(child, childPos, index, childIsolated, parent, parentEnd)
    if (child.content.size && !child.isTextblock) walkBlocks(child, childPos + 1, childIsolated, visit)
  }
}

/**
 * 解析「块操作目标」范围（需求 13.4.3.1 悬浮范围 + 13.6.10 块类型矩阵的上下层规则）。
 *
 * 命中优先级由内到外，**只返回一个**目标，父子容器不会同时进入高亮：
 * 1. 表格：整表作为一个块，单元格聚焦不抢句柄；
 * 2. 列表：最近的列表容器 → 当前 item 及其完整子树（嵌套列表命中内层 item）；
 * 3. 整块容器：callout / blockquote / details / columns 在 V1 只暴露容器句柄；
 * 4. 其余：包含指针的顶层块（代码块、图片、分割线等原子块即自身）。
 * `container` 标记供高亮层选择「整框」还是「文字范围」。
 */
const BLOCK_TARGET_CONTAINERS = new Set(['callout', 'blockquote', 'details', 'columns'])
const BLOCK_TARGET_LISTS = new Set(['bulletList', 'orderedList', 'taskList'])

export function resolveBlockTargetRange(doc, from, to = from) {
  if (!doc || !Number.isInteger(from)) return null
  const clamp = (value) => Math.max(0, Math.min(doc.content.size, value))
  const $from = doc.resolve(clamp(from))
  const $to = doc.resolve(clamp(to))
  for (let depth = $from.depth; depth >= 1; depth -= 1) {
    if ($from.node(depth).type.name !== 'table') continue
    return { from: $from.before(depth), to: $from.after(depth), parentDepth: depth - 1, container: 'table' }
  }
  for (let depth = $from.depth; depth >= 1; depth -= 1) {
    const name = $from.node(depth).type.name
    if (BLOCK_TARGET_LISTS.has(name)) {
      const index = Math.min($from.index(depth), $from.node(depth).childCount - 1)
      if (index < 0) break
      return { from: $from.posAtIndex(index, depth), to: $from.posAtIndex(index + 1, depth), parentDepth: depth, container: null }
    }
    if (BLOCK_TARGET_CONTAINERS.has(name)) {
      return { from: $from.before(depth), to: $from.after(depth), parentDepth: depth - 1, container: name }
    }
  }
  const depth = $from.depth > 0 && $from.node(1).type.name === 'documentSegment' ? 1 : 0
  const lastIndex = $from.node(depth).childCount - 1
  const startIndex = Math.min($from.index(depth), lastIndex)
  if (startIndex < 0) return null
  if (depth && (!$to.depth || $from.node(1) !== $to.node(1))) {
    const endDepth = $to.depth && $to.node(1).type.name === 'documentSegment' ? 1 : 0
    const index = $to.index(endDepth), parent = $to.node(endDepth)
    const end = Math.min(index + Number($to.pos > $to.posAtIndex(index, endDepth)), parent.childCount)
    return { from: $from.posAtIndex(startIndex, 1), to: $to.posAtIndex(end, endDepth), parentDepth: 0, container: null }
  }
  const endIndex = Math.max(startIndex + 1, Math.min($to.index(depth) + Number($to.pos > $to.posAtIndex($to.index(depth), depth)), lastIndex + 1))
  return { from: $from.posAtIndex(startIndex, depth), to: $from.posAtIndex(endIndex, depth), parentDepth: depth, container: null }
}

/*
 * —— 稳定块标识（blockId） ——
 *
 * 与飞书文档模型对齐：每个块带一个稳定 id，折叠、评论锚点、协同、@引用都按 id
 * 引用块，而不是按「层级 + 文本 + 同名序号」这种会随编辑漂移的派生键。派生键在
 * 删除靠前的同名标题时会整体前移，折叠状态就会串到另一个同名标题上；id 不会。
 *
 * 覆盖范围：用户能当作「一个块」操作的单位（段落/标题/列表容器/列表项/引用/
 * 高亮块/分栏/折叠块/代码块/图片/分割线/表格/块级公式）。
 * 不覆盖纯结构性容器（tableRow、tableCell、column、detailsContent 等）：它们是
 * 父块的内部骨架，父块已经携带 id，重复编号只会让 JSON 体积翻倍。
 *
 * 列表项是唯一的「既是骨架又能当块」的特例：飞书把 fold-block-id 直接挂在
 * item 上（折叠状态属于 item，不属于外层列表），所以 item 必须有独立 id。
 */
/**
 * 折叠箭头允许挂载的块类型（= 能被用户当成「一段可折文本」的块）。
 *
 * 箭头是行内 widget，只能插在「内容以行内开头」的块里：段落/标题在 pos+1，
 * 列表项要钻进首个子段落（pos+2）。代码块、图片等原子块没有可折叠子树，
 * 不在集合里（foldedRange 也会返回 null，双保险）。
 */
export const TEXT_FOLD_TYPES = new Set(['paragraph', 'heading', 'listItem', 'taskItem'])

/** 章节解析里「视觉上天然缩进」的列表容器：未显式缩进时算前一个文本块的子块。 */
const LIST_SECTION_TYPES = new Set(['bulletList', 'orderedList', 'taskList'])

export const ASYNC_BLOCK_TYPES = new Set(['fileBlock', 'image', 'sheet', 'webEmbed', 'bookmark', 'unknownBlock'])

export const BLOCK_ID_TYPES = new Set([
  'paragraph', 'heading', 'blockquote', 'callout', 'columns', 'details', 'detailsSummary',
  // 列表项在飞书里是独立块（fold-block-id 就挂在 item 上），子块藏在 item 内部，
  // 所以要给 item 自己的 blockId，折叠状态才存在它身上。
  'listItem', 'taskItem',
  'bulletList', 'orderedList', 'taskList', 'codeBlock', 'image', 'horizontalRule', 'blockMath', 'table',
  // 文件 / 视频块（P2-04）是原子块，但它自己就是「用户能当作一个块操作」的单位，
  // 折叠与锚点都要能指向它，所以进 id 集合。
  'fileBlock', 'webEmbed', 'bookmark', 'linkEmbed', 'unknownBlock',
  // 小组件块（P4-04）：原子块，但折叠与锚点都要能指向它 —— 不进集合就没有 blockId，
  // 导出再导回时实例键与块 id 会一起漂。
  'isv', 'agenda',
  // 电子表格块（P5-02）：同上。悬停手柄把 `blockId` 转交给宿主开块菜单，
  // 不给 id 就永远只能传 `null`；折叠/评论锚点也缺一个落点。
  'sheet',
  // 投票块（P5-03）：同上。header 标签行把 `blockId` 转交给宿主，`onVote` 也带着它，
  // 不给 id 就永远只能传 `null`；结果条要按块对账时同样缺一个落点。
  'poll',
  // 外部服务块（17 §17.5）：原子块，但它是「用户能当作一个块操作」的单位 —— 不进集合
  // 就没有 blockId，删除 / 折叠 / 评论锚点全都没有落点，而 §17.5 明确要求这些块
  // 「必须可读、可删、可保真」。
  'externalBlock',
  // 多维表格块（P5-04）：同上。悬停手柄与 footer 菜单把 `blockId` 转交给宿主，
  // `onChange`（切视图）也带着它；不给 id 就永远只能传 `null`。
  'bitable',
])
export const BLOCK_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

let blockIdSequence = 0

/** 生成一个短块 id（base36 时间片 + 自增序号 + 随机尾，长度 ≤ 32，无需外部依赖）。 */
export function createBlockId(taken) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    blockIdSequence = (blockIdSequence + 1) % 46656
    const candidate = `b${Math.random().toString(36).slice(2, 9)}${blockIdSequence.toString(36)}`
    if (!taken || !taken.has(candidate)) return candidate
  }
  return `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

/**
 * 找出所有需要补 id 或重新编号的块：[{ pos, id }]。
 *
 * 重复 id（回车分段复制 attrs、复制粘贴、拖拽复制）不是简单「保留先出现的」：
 * 传入 `previous = { doc, mapping }` 时，会以「旧位置经 mapping 映射后的位置」为准，
 * 谁离它更近谁保留原 id —— 这样粘贴在文档**前面**的副本也不会抢走原块的 id，
 * 折叠状态始终留在原来那个块上。
 */
export function collectBlockIdFixes(doc, previous, reservedIds) {
  const fixes = []
  if (!doc) return fixes
  const taken = new Set(reservedIds)
  const owner = new Map()
  const oldPositions = new Map()
  if (previous && previous.doc) {
    previous.doc.descendants((node, pos) => {
      if (!BLOCK_ID_TYPES.has(node.type.name)) return true
      const id = node.attrs && node.attrs.blockId
      if (typeof id === 'string' && id && !oldPositions.has(id)) oldPositions.set(id, pos)
      return true
    })
  }
  const expectedPosition = (id) => {
    const pos = oldPositions.get(id)
    if (pos === undefined) return null
    if (!previous || !previous.mapping) return pos
    // assoc=1：块「起始位置」在它之前插入内容后要跟着右移，映射结果才是原块的新位置。
    try { return previous.mapping.map(pos, 1) } catch (_) { return pos }
  }
  const reissue = () => { const fresh = createBlockId(taken); taken.add(fresh); return fresh }
  doc.descendants((node, pos) => {
    if (!BLOCK_ID_TYPES.has(node.type.name)) return true
    const id = node.attrs && node.attrs.blockId
    if (typeof id !== 'string' || !BLOCK_ID_PATTERN.test(id) || reservedIds?.has(id)) { fixes.push({ pos, id: reissue() }); return true }
    if (!owner.has(id)) { taken.add(id); owner.set(id, pos); return true }
    const keeper = owner.get(id)
    const expected = expectedPosition(id)
    if (expected !== null && Math.abs(pos - expected) < Math.abs(keeper - expected)) {
      fixes.push({ pos: keeper, id: reissue() })
      owner.set(id, pos)
    } else fixes.push({ pos, id: reissue() })
    return true
  })
  return fixes
}

/** 可折叠块的 blockId → pos 索引；折叠集合存 id，装饰层靠它换算位置。 */
export function foldableIdPositions(doc) {
  const index = new Map()
  if (!doc) return index
  // 结构遍历：隔离容器由遍历自己标记，不再逐块 doc.nodeAt + doc.resolve。
  walkBlocks(doc, 0, false, (node, pos, _index, isolated) => {
    if (isolated || !node.isBlock || !BLOCK_ID_TYPES.has(node.type.name)) return
    const id = node.attrs && node.attrs.blockId
    if (typeof id === 'string' && id) index.set(id, pos)
  })
  return index
}

/** 旧名字保留：折叠早先从标题开始，现在索引所有可折叠块。 */
export const headingIdPositions = foldableIdPositions

/** 取某个位置上的块 id（非块级节点或未编号返回 null）。 */
export function blockIdAt(doc, pos) {
  if (!doc || !Number.isInteger(pos)) return null
  const node = doc.nodeAt(pos)
  if (!node || !BLOCK_ID_TYPES.has(node.type.name)) return null
  const id = node.attrs && node.attrs.blockId
  return typeof id === 'string' && id ? id : null
}

/**
 * 页面级标题的**旧版**折叠偏好键：`层级 + 文本 + 同名序号`。
 * @deprecated 仅用于把 localStorage 里的历史偏好迁移到 blockId（见 foldLarkDocByKeys）。
 * 新代码请用 headingIdPositions / blockIdAt。
 */
export function mapHeadingFoldKeys(doc) {
  const keys = new Map()
  if (!doc) return keys
  const seen = new Map()
  doc.descendants((node, pos) => {
    if (node.type.name !== 'heading' || !isPageHeading(doc, pos)) return
    const base = `${node.attrs.level}\u0001${node.textContent}`
    const ordinal = seen.get(base) || 0
    seen.set(base, ordinal + 1)
    keys.set(pos, `${base}\u0001${ordinal}`)
  })
  return keys
}

/** 单个标题的折叠偏好键；非页面级标题返回 null。 */
export function headingFoldKey(doc, pos) {
  return mapHeadingFoldKeys(doc).get(pos) || null
}

// 复制、剪切和拖动标题时沿用正文折叠的完整章节范围；视觉高亮仍使用
// resolveHeadingHighlightSection 的独立块边界，避免两个交互共享错误的 DOM 区段。
export function headingActionRange(doc, pos) {
  if (!doc || pos < 0 || pos > doc.content.size || !isPageHeading(doc, pos)) return null
  const section = resolveHeadingSectionMode(doc, pos)
  if (!section || section.to <= pos + section.heading.nodeSize) return null
  return { from: pos, to: section.to, parentDepth: doc.resolve(pos).depth }
}

