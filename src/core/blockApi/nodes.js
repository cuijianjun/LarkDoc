/**
 * BlockAPI 的节点层：payload → 真实 ProseMirror 节点，以及插入前必须的「自动包壳」。
 *
 * 单独成文件的原因与 `tree.js` 一样 —— 这两块是 05 §5.12.4 全部边界行为的落点：
 * schema 的 content 表达式写死了「谁能装谁」（`bulletList` 只吃 `listItem`、
 * `columns` 必须 2~5 个 `column`、`details` = `detailsSummary` + `detailsContent`）。
 * 宿主不该背这些规则，所以插/移/转换/复制都先过这里的 `fitToParent`，
 * 由它把 payload 包成目标父容器能吃的形状；包不出来的（表格内部、代码块）直接拒绝。
 */
import { BLOCK_ID_TYPES, createBlockId } from '../documentOperations'

/** 表格骨架：不编号、块树穿透，且**整体只读**（§5.12.4：表格无块级增删改语义）。 */
export const TABLE_STRUCTURE_TYPES = new Set(['table', 'tableRow', 'tableCell', 'tableHeader'])

/** 父容器删掉一个子块后**至少要剩下几个**子块才合法（其余类型默认 1）。 */
const MIN_CHILDREN = { columns: 2, details: 2 }

/** 列表容器 → 其条目类型。 */
export function listItemTypeOf(listType) {
  return listType === 'taskList' ? 'taskItem' : 'listItem'
}

/** 条目类型 → 其列表容器类型。 */
export function listTypeOf(itemType) {
  return itemType === 'taskItem' ? 'taskList' : 'bulletList'
}

export function isTableType(type) {
  return TABLE_STRUCTURE_TYPES.has(type)
}

export function minChildrenOf(type) {
  return MIN_CHILDREN[type] || 1
}

/** 取块在 schema 里的**直接**父容器类型（块树会穿透结构性容器，这里要的是真实父节点）。 */
export function directParentType(doc, entry) {
  const $pos = doc.resolve(entry.pos)
  return $pos.parent ? $pos.parent.type.name : 'doc'
}

/**
 * 块是否位于表格内部（严格祖先里出现表格骨架）。
 *
 * 表格**自己**不算 —— 否则「删掉整张表」会被这条规则挡掉。
 */
export function inTableContext(doc, entry) {
  if (!entry) return false
  const $pos = doc.resolve(entry.pos)
  for (let depth = 1; depth <= $pos.depth; depth += 1) {
    if (TABLE_STRUCTURE_TYPES.has($pos.node(depth).type.name)) return true
  }
  return false
}

/** `child` 是否就是 `ancestor` 或它的子孙（`move` 防环用）。 */
export function isDescendantOf(childEntry, ancestorEntry) {
  if (!childEntry || !ancestorEntry) return false
  if (childEntry === ancestorEntry) return true
  return childEntry.pos > ancestorEntry.pos && childEntry.end <= ancestorEntry.end
}

/**
 * 删除范围：块自身，外加「删完就空了」的父容器。
 *
 * `listItem` 是唯一常见的坑：删掉列表里最后一项会留下一个空 `bulletList`
 * （content 是 `listItem+`），文档当场不合法。所以逐层上溯——父容器删掉这一个
 * 之后剩不到 `minChildrenOf` 个就把它一起删，`columns` 剩 1 列、`details`
 * 只剩 summary 同理。
 */
export function expandDeletion(doc, entry) {
  let from = entry.pos
  let to = entry.end
  for (let guard = 0; guard < 16; guard += 1) {
    const $pos = doc.resolve(from)
    const parent = $pos.parent
    if (!parent || parent.type.name === 'doc') break
    if (parent.childCount - 1 >= minChildrenOf(parent.type.name)) break
    const index = $pos.index()
    let start = from
    for (let i = index - 1; i >= 0; i -= 1) start -= parent.child(i).nodeSize
    start -= 1
    if (start < 0) break
    const end = start + parent.nodeSize
    if (start > from || end < to) break
    from = start
    to = end
  }
  return { from, to }
}

/** 文档里已占用的 blockId 集合（新 id 必须避开它）。 */
export function collectIds(doc) {
  const ids = new Set()
  doc.descendants((node) => {
    if (!BLOCK_ID_TYPES.has(node.type.name)) return true
    const id = node.attrs && node.attrs.blockId
    if (typeof id === 'string' && id) ids.add(id)
    return true
  })
  return ids
}

/** JSON → 真实节点。不做 content 校验（由事务的 step 兜底，非法就是抛错而不是静默）。 */
export function nodeFromJson(schema, json) {
  const type = schema.nodes[json.type]
  if (!type) return null
  // 文本节点不能用 `NodeType.create` 造（prosemirror-model 直接抛错），走 schema.text。
  if (type.isText) return schema.text(String(json.text == null ? '' : json.text))
  const attrs = { ...(json.attrs || {}) }
  if (type.isLeaf || type.isAtom || !Array.isArray(json.content)) return type.create(attrs)
  const children = []
  for (const child of json.content) {
    const node = nodeFromJson(schema, child)
    if (!node) return null
    children.push(node)
  }
  return type.create(attrs, children)
}

const emptyParagraph = () => ({ type: 'paragraph' })

const textParagraph = (text) => (text
  ? { type: 'paragraph', content: [{ type: 'text', text }] }
  : emptyParagraph())

/**
 * payload 归一：JSON 节点 / 块快照 / 纯文本 / 真实 PM 节点 → 节点 JSON。
 *
 * 三种入口按 §5.12.2 的签名收：`{ type, content }` 是节点；`{ type, text }`
 * 是快照（没有 `content`，`text` 拼成一段纯文本）；字符串直接当纯文本段落。
 */
export function normalizePayload(schema, payload) {
  if (payload === null || payload === undefined) return null
  if (typeof payload === 'string') return textParagraph(payload)
  const raw = typeof payload.toJSON === 'function' ? payload.toJSON() : payload
  if (!raw || typeof raw !== 'object' || typeof raw.type !== 'string') return null
  const type = schema.nodes[raw.type]
  if (!type) return null
  if (Array.isArray(raw.content)) return { type: raw.type, attrs: raw.attrs, content: raw.content }
  if (type.isLeaf || type.isAtom) return { type: raw.type, attrs: raw.attrs }
  const text = typeof raw.text === 'string' ? raw.text : ''
  return text
    ? { type: raw.type, attrs: raw.attrs, content: [{ type: 'text', text }] }
    : { type: raw.type, attrs: raw.attrs }
}

/**
 * 收集 JSON 树里**已经写死**的 blockId。
 *
 * 用途：把「内容自带的 id」标成本次操作自己的。没有这一步，包壳 / 二次 `assignIds`
 * 会把已经发过号的子树当成「和文档现有块撞号」又重发一遍 —— 宿主显式给的锚点进去后
 * 就找不回来了（ batches 里 `taken` 是共享的，这是最容易踩的一处）。
 */
export function collectJsonIds(json, out = new Set()) {
  if (!json || typeof json !== 'object') return out
  if (Array.isArray(json)) {
    json.forEach(item => collectJsonIds(item, out))
    return out
  }
  const id = json.attrs && json.attrs.blockId
  if (typeof id === 'string' && id) out.add(id)
  if (Array.isArray(json.content)) json.content.forEach(child => collectJsonIds(child, out))
  return out
}

const NO_OWNED_IDS = new Set()

/**
 * 给节点（及其所有编号后代）补 blockId；返回**顶层**那个 id（没有编号类型则是 null）。
 *
 * 已带 id 的一律照用 —— 除非它跟文档里**别的**块撞号（`taken` 有、`own` 没有），
 * 那时才重发：blockId 是树索引的唯一键，一篇文档里不允许出现重号。
 * `own` 是本次 payload 自己的 id 清单（一般是 `collectJsonIds` 的结果）。
 */
export function assignIds(json, taken, own = NO_OWNED_IDS) {
  if (!json) return { json, id: null }
  const copy = { ...json }
  let id = null
  if (BLOCK_ID_TYPES.has(copy.type)) {
    const existing = copy.attrs && copy.attrs.blockId
    const keep = typeof existing === 'string' && existing && (!taken.has(existing) || own.has(existing))
    id = keep ? existing : createBlockId(taken)
    taken.add(id)
    copy.attrs = { ...(copy.attrs || {}), blockId: id }
  }
  if (Array.isArray(copy.content)) {
    copy.content = copy.content.map(child => assignIds(child, taken, own).json)
  }
  return { json: copy, id }
}

/** 整棵子树换号（`duplicate` 专用：子孙 id 一律重发，否则锚点会撞车）。 */
export function reassignIds(json, taken) {
  if (!json) return { json, id: null }
  const copy = { ...json }
  let id = null
  if (BLOCK_ID_TYPES.has(copy.type)) {
    id = createBlockId(taken)
    taken.add(id)
    copy.attrs = { ...(copy.attrs || {}), blockId: id }
  }
  if (Array.isArray(copy.content)) {
    copy.content = copy.content.map(child => reassignIds(child, taken).json)
  }
  return { json: copy, id }
}

/** `deep: false` 的复制：只留壳，子块丢掉；容器补一个「刚好合法」的最小内容。 */
export function pruneSubtree(schema, json) {
  const type = schema.nodes[json.type]
  if (!type || type.isTextblock || type.isLeaf || type.isAtom) return { ...json }
  const minimal = MINIMAL_CONTENT[json.type]
  if (!minimal) return json
  return { ...json, content: minimal() }
}

const MINIMAL_CONTENT = {
  callout: () => [emptyParagraph()],
  blockquote: () => [emptyParagraph()],
  column: () => [emptyParagraph()],
  detailsContent: () => [emptyParagraph()],
  listItem: () => [emptyParagraph()],
  taskItem: () => [emptyParagraph()],
  bulletList: () => [{ type: 'listItem', content: [emptyParagraph()] }],
  orderedList: () => [{ type: 'listItem', content: [emptyParagraph()] }],
  taskList: () => [{ type: 'taskItem', content: [emptyParagraph()] }],
  columns: () => [
    { type: 'column', content: [emptyParagraph()] },
    { type: 'column', content: [emptyParagraph()] },
  ],
}

/**
 * 造一个包壳节点：只有**壳本身**发新 id，内容里已有的 id 一律不动。
 *
 * 包壳是「为了塞进父容器」加的一层，不是新内容 —— 把里面块自带的锚点重发掉，
 * 宿主按原 id 就再也找不到了（`insert` 返回的 id 也就成了空头支票）。
 */
function wrapWith(schema, type, content, taken) {
  const own = collectJsonIds(content)
  return assignIds({ type, content }, taken, own).json
}

/**
 * 按目标父容器把 payload 包成它能吃的形状（§5.12.4 的自动包壳规则）。
 *
 * - 父是列表 → 非条目一律包 `listItem` / `taskItem`（条目内容必须以段落打头）；
 * - 父是 `columns` → 非 `column` 一律包 `column`；
 * - 父是文档级容器 → `listItem` 自动包 `bulletList`、`column` 自动包 `columns`
 *   （`columns` 至少要 2 列，补一个空列凑够 schema 的 2..5）。
 *
 * 返回值是**最外层**的 JSON；`taken` 里已经登记了包壳产生的新 id。
 */
export function fitToParent(schema, json, parentType, taken) {
  if (!json) return null
  const type = json.type
  if (parentType === 'bulletList' || parentType === 'orderedList' || parentType === 'taskList') {
    const want = listItemTypeOf(parentType)
    if (type === want) return json
    const isText = schema.nodes[type] && schema.nodes[type].isTextblock
    return wrapWith(schema, want, isText ? [json] : [emptyParagraph(), json], taken)
  }
  if (parentType === 'columns') {
    if (type === 'column') return json
    return wrapWith(schema, 'column', [json], taken)
  }
  if (type === 'listItem') return wrapWith(schema, 'bulletList', [json], taken)
  if (type === 'taskItem') return wrapWith(schema, 'taskList', [json], taken)
  if (type === 'column') {
    return wrapWith(schema, 'columns', [json, { type: 'column', content: [emptyParagraph()] }], taken)
  }
  return json
}

/** 只保留目标类型认得的 attrs（转换时 `heading` → `paragraph` 靠这条丢掉 `level`）。 */
function pickAttrs(schema, type, attrs) {
  const spec = (schema.nodes[type] && schema.nodes[type].spec.attrs) || {}
  const next = {}
  Object.keys(attrs || {}).forEach((key) => {
    if (key in spec || key === 'blockId') next[key] = attrs[key]
  })
  return next
}

/**
 * 类型转换（§5.12.4 的 transform 矩阵）。
 *
 * 返回**根节点的 JSON**（保持原 `blockId`，评论锚点不丢），或 `null` 表示拒绝 / 无需变更：
 * - `→ table` 一律拒绝（表格必须走 `insert`）；
 * - 同类型同 attrs → `null`（幂等 no-op）；
 * - `→ codeBlock`：只留纯文本，mark 全丢（codeBlock 的 content 是 `text*`）；
 * - `→ heading` 缺 `level` 补 1；`heading → paragraph` 靠 `pickAttrs` 丢 `level`；
 * - `paragraph/heading → 列表`：包 `listItem` 再包列表容器，外层沿用原 id；
 * - `listItem → paragraph`：先出列表（取条目首段的行内内容），再落成段落。
 */
export function convertBlock(schema, node, toType, attrs, taken) {
  if (!schema.nodes[toType]) return null
  if (toType === 'table' || isTableType(toType)) return null
  const from = node.type.name
  const merged = pickAttrs(schema, toType, { ...node.attrs, ...(attrs || {}) })
  if (toType === 'heading' && !Number.isFinite(merged.level)) merged.level = 1
  if (from === toType) {
    const same = Object.keys(merged).every(key => node.attrs[key] === merged[key])
    if (same) return null
    return { type: toType, attrs: { ...merged, blockId: node.attrs.blockId }, content: inlineJson(node) }
  }
  const text = node.textContent
  if (toType === 'codeBlock') {
    return { type: toType, attrs: merged, content: text ? [{ type: 'text', text }] : [] }
  }
  const isTextTarget = schema.nodes[toType].isTextblock
  if (isTextTarget) {
    const content = from === 'codeBlock' || !node.isTextblock
      ? (text ? [{ type: 'text', text }] : [])
      : inlineJson(node)
    return { type: toType, attrs: merged, content }
  }
  // 目标是容器：把「当前块压成一个能装进去的块」再包一层。
  // 内层一律换新 id，**外层沿用原 id** —— 转换后的块还是「同一个块」，
  // 评论锚点、折叠状态才能跟着走（和 `duplicate` 的关键区别）。
  const innerType = node.isTextblock ? from : 'paragraph'
  const innerContent = node.isTextblock ? inlineJson(node) : (text ? [{ type: 'text', text }] : [])
  const inner = assignIds({ type: innerType, content: innerContent }, taken).json
  let result
  if (toType === 'bulletList' || toType === 'orderedList' || toType === 'taskList') {
    const itemType = listItemTypeOf(toType)
    const item = from === 'listItem' || from === 'taskItem'
      ? assignIds({ type: itemType, content: innerContent }, taken).json
      : wrapWith(schema, itemType, [inner], taken)
    result = wrapWith(schema, toType, [item], taken)
  } else {
    result = wrapWith(schema, toType, [inner], taken)
  }
  const originalId = node.attrs && node.attrs.blockId
  if (originalId && BLOCK_ID_TYPES.has(result.type)) {
    result.attrs = { ...(result.attrs || {}), blockId: originalId }
  }
  return result
}

/** 取文本块的行内内容 JSON（`codeBlock` 之外的文本块都是行内节点）。 */
function inlineJson(node) {
  if (!node || !node.content || typeof node.content.toJSON !== 'function') return []
  const json = node.content.toJSON()
  return Array.isArray(json) ? json : []
}
