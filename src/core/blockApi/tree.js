/**
 * BlockAPI 的块树：全库唯一一份「blockId → 位置 / 父子关系」索引。
 *
 * 05 §5.12 的三条硬约束里，第一条（一切按 blockId，不按 pos）的全部难点都压在这里：
 * pos 会随任何一次远端 step 漂移，所以**任何地方都不许缓存 id → pos**。本文件是唯一
 * 例外，而且缓存在 `WeakMap` 里、以 **doc 节点实例**为键 —— `editor.state.doc` 与
 * `tr.doc` 每次事务都是新对象，键一换缓存自然作废，不需要任何手动失效逻辑，也就不
 * 存在「文档改了还拿着旧 pos」的机会（§5.12.5 的 `WeakMap<state, Map>` 要求）。
 *
 * 块树口径（对应 §5.12.2 的 `BlockSnapshot`）：
 * - 只有 `BLOCK_ID_TYPES` 里的节点进树。结构性容器（column / detailsContent /
 *   tableRow / tableCell / tableHeader）不编号，块树直接穿透，看不见它们；
 * - `children` = 最近的编号后代（穿透上面那层包装）；
 * - 表格内部按文档顺序摊平成 `table` 的子块 —— 只是为了让 `get` / `parent` 能定位
 *   单元格里的段落。§5.12.4 规定表格不支持块级增删改（`insert` / `move` 一律拒绝），
 *   所以摊平不代表单元格里的段落可以被搬动。
 */
import { BLOCK_ID_TYPES } from '../documentOperations'

/**
 * 可容纳子块的块类型（对应 §5.12.2 的 `isContainer`：callout/details/columns/
 * listItem/table…）。
 *
 * `heading` 不在里面：本仓库的 heading 内容表达式是纯行内（02 §2 的 heading-children
 * 由读写侧的聚合/展平实现，不是节点内容），它装不下任何块。
 */
export const BLOCK_CONTAINER_TYPES = new Set([
  'blockquote', 'callout', 'columns', 'details', 'table',
  'bulletList', 'orderedList', 'taskList', 'listItem', 'taskItem',
])

/** 外层是列表容器、内部只装 item 的三类（删空要连容器一起删）。 */
export const BLOCK_LIST_TYPES = new Set(['bulletList', 'orderedList', 'taskList'])

/** doc 节点实例 → 块树。键是 doc 本身：任一 step 换了新 doc，缓存自动作废。 */
const TREE_CACHE = new WeakMap()

/** 取节点上的 blockId；未编号类型或未落 id 返回 null。 */
export function blockIdOf(node) {
  if (!node || !BLOCK_ID_TYPES.has(node.type.name)) return null
  const id = node.attrs && node.attrs.blockId
  return typeof id === 'string' && id ? id : null
}

/**
 * 建块树：`{ byId, order, root }`。
 *
 * `order` 是文档顺序（深度优先，父先于子），`query` / 差异比对都靠它保持文档序。
 * 重复 id（复制粘贴留下的）只认先出现的那个 —— 与 `collectBlockIdFixes` 的
 * 「先到先得」口径一致，避免两个块抢同一个锚点。
 */
export function blockTree(doc) {
  if (!doc || typeof doc.childCount !== 'number') return { byId: new Map(), order: [], root: [] }
  const cached = TREE_CACHE.get(doc)
  if (cached) return cached
  const byId = new Map()
  const order = []
  const root = []
  const walk = (parent, base, depth, parentEntry) => {
    let pos = base
    for (let index = 0; index < parent.childCount; index += 1) {
      const child = parent.child(index)
      let entry = parentEntry
      let childDepth = depth
      const id = blockIdOf(child)
      if (id && !byId.has(id)) {
        const list = parentEntry ? parentEntry.children : root
        entry = {
          blockId: id,
          node: child,
          pos,
          end: pos + child.nodeSize,
          depth,
          parentId: parentEntry ? parentEntry.blockId : null,
          index: list.length,
          children: [],
        }
        childDepth = depth + 1
        byId.set(id, entry)
        order.push(entry)
        list.push(id)
      }
      if (child.content.size) walk(child, pos + 1, childDepth, entry)
      pos += child.nodeSize
    }
  }
  walk(doc, 0, 0, null)
  const tree = { byId, order, root }
  TREE_CACHE.set(doc, tree)
  return tree
}

/** 取某个 id 的块树条目；找不到返回 null（调用方一律不抛异常，见 §5.12.3）。 */
export function blockEntry(doc, blockId) {
  if (typeof blockId !== 'string' || !blockId) return null
  const found = blockTree(doc).byId.get(blockId)
  return found || null
}

/**
 * 全库唯一允许的「id → pos」实现（§5.12.5）。
 *
 * `source` 可以是 `EditorState` 或 `doc` 节点 —— 传 state 是规格原文的形状，传 doc
 * 是 `batch` 内部要用的形状（事务还没 dispatch，`editor.state.doc` 是旧文档）。
 * 从 root 正向遍历，不做 `nodeAtSafe(pos)` 反查。
 */
export function posAtId(source, blockId) {
  if (!source) return null
  const doc = source.doc || source
  const entry = blockEntry(doc, blockId)
  return entry ? entry.pos : null
}

/** 块快照副本（§5.12.2）：`attrs` / `children` / `docPos` 全是新对象，外部改不动内部。 */
export function snapshotOf(entry) {
  const node = entry.node
  const text = node.textContent
  return {
    blockId: entry.blockId,
    type: node.type.name,
    attrs: { ...node.attrs },
    text,
    depth: entry.depth,
    parentId: entry.parentId,
    children: entry.children.slice(),
    index: entry.index,
    isEmpty: !text && entry.children.length === 0,
    docPos: { from: entry.pos, to: entry.end },
  }
}

/** 类型是否是可容纳子块的容器（§5.12.2 `isContainer`）。 */
export function isContainerType(type) {
  return BLOCK_CONTAINER_TYPES.has(type)
}
