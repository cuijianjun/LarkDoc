/**
 * BlockAPI（05 §5.12）：**全库唯一一层按 `blockId` 操作单个块的接口。
 *
 * 三条硬约束在本文件里逐条落地：
 *
 * 1. **一切按 `blockId`，不按 `pos`** —— `pos` 经任何一次远端 step 就漂；所有落点都由
 *    `tree.js` 现算（缓存以 doc 实例为键，见 tree.js 头注释）。`BlockSnapshot.docPos`
 *    只作调试输出，方法签名一律不收 pos；
 * 2. **每个方法自己 dispatch 一次，内部自动 `closeHistory()`** —— 保证「一次调用 = 一步撤销」
 *    （07 §13.3）。`closeHistory` 把历史插件的 `prevRanges` 置空，这笔事务不会和上一笔
 *    合并成一步；
 * 3. **写操作返回受影响的 `blockId`，读操作返回快照副本** —— 快照的 `attrs` / `children` /
 *    `docPos` 全是新对象，调用方改不动编辑器内部。
 *
 * 事务出口走 `DocumentSession.dispatch(tr, meta)`（§5.12.6），元信息里的 `origin`
 * 默认 `HOST`：BlockAPI 是给宿主（块菜单、拖拽、AI 提案）用的，不是用户输入。
 */
import { closeHistory } from '@tiptap/pm/history'
import { TRANSACTION_ORIGINS } from '../transactionMetadata'
import {
  BLOCK_LIST_TYPES, blockEntry, blockTree, isContainerType, posAtId, snapshotOf,
} from './tree'
import {
  assignIds, collectIds, convertBlock, directParentType, expandDeletion, fitToParent,
  inTableContext, isDescendantOf, isTableType, nodeFromJson, normalizePayload, pruneSubtree,
  reassignIds,
} from './nodes'

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

/**
 * 解析 `BlockAnchor`（§5.12.2 三种形态，按优先级 resolve）。
 *
 * 返回 `null` 一律表示「这个落点不合法」，调用方按 no-op 处理：
 * - `inside` 落在叶子/原子块 → **降级**为 `after`（§5.12.4）；
 * - `inside` / `offset` 落在 `codeBlock`、或落在表格骨架内部 → 拒绝；
 * - `{ index }` 越界夹到首尾，父容器不存在或不合法 → 拒绝。
 */
function resolveTarget(doc, anchor) {
  if (!anchor || typeof anchor !== 'object') return null
  if (typeof anchor.blockId === 'string' && anchor.blockId) {
    const entry = blockEntry(doc, anchor.blockId)
    if (!entry) return null
    const type = entry.node.type.name
    if (Number.isFinite(anchor.offset)) {
      // 块内字符偏移：只能落在文本块里，别处没有「字符」的概念 → 拒绝。
      if (!entry.node.isTextblock || type === 'codeBlock') return null
      const inner = entry.pos + 1
      const limit = entry.node.content.size
      return {
        pos: inner + clamp(Math.trunc(anchor.offset), 0, limit),
        parentType: type,
        kind: 'offset',
        entry,
        anchorId: entry.blockId,
      }
    }
    const where = anchor.position === 'before' || anchor.position === 'inside' ? anchor.position : 'after'
    if (where === 'inside') {
      if (type === 'codeBlock') return null
      if (isTableType(type) || inTableContext(doc, entry)) return null
      if (!isContainerType(type)) {
        return {
          pos: entry.end,
          parentType: directParentType(doc, entry),
          kind: 'after',
          entry,
          anchorId: entry.blockId,
        }
      }
      // `details` = summary + content：插到 summary 之后，内容区开头。
      const pos = type === 'details' ? entry.pos + 1 + entry.node.child(0).nodeSize : entry.pos + 1
      return {
        pos,
        parentType: type === 'details' ? 'detailsContent' : type,
        kind: 'inside',
        entry,
        anchorId: entry.blockId,
      }
    }
    return {
      pos: where === 'before' ? entry.pos : entry.end,
      parentType: directParentType(doc, entry),
      kind: where,
      entry,
      anchorId: entry.blockId,
    }
  }
  if (Number.isFinite(anchor.index)) {
    const parentId = typeof anchor.parentId === 'string' ? anchor.parentId : null
    if (!parentId) {
      const tree = blockTree(doc)
      const index = clamp(Math.trunc(anchor.index), 0, tree.root.length)
      const pos = index < tree.root.length
        ? tree.byId.get(tree.root[index]).pos
        : doc.content.size
      return { pos, parentType: 'doc', kind: 'index', entry: null, anchorId: null }
    }
    const entry = blockEntry(doc, parentId)
    if (!entry) return null
    const type = entry.node.type.name
    if (type === 'codeBlock' || isTableType(type) || inTableContext(doc, entry)) return null
    if (!isContainerType(type)) return null
    // summary 是 details 的第一个子块，插进去会破坏 `summary + content` 的固定结构。
    const floor = type === 'details' ? 1 : 0
    const kids = entry.children
    const index = clamp(Math.trunc(anchor.index), floor, kids.length)
    let pos
    if (index < kids.length) pos = blockEntry(doc, kids[index]).pos
    else if (kids.length > floor) pos = blockEntry(doc, kids[kids.length - 1]).end
    else pos = type === 'details' ? entry.pos + 1 + entry.node.child(0).nodeSize : entry.pos + 1
    return {
      pos,
      parentType: type === 'details' ? 'detailsContent' : type,
      kind: 'index',
      entry,
      anchorId: parentId,
    }
  }
  return null
}

/** `keepChildren` 能上提的子块：容器只认 callout/blockquote，列表项只认嵌套子列表。 */
function hoistedChildren(entry) {
  const type = entry.node.type.name
  const node = entry.node
  if (type === 'callout' || type === 'blockquote') {
    const out = []
    for (let i = 0; i < node.childCount; i += 1) out.push(node.child(i))
    return out.length ? out : null
  }
  if (type === 'listItem' || type === 'taskItem') {
    const items = []
    for (let i = 0; i < node.childCount; i += 1) {
      const child = node.child(i)
      if (!BLOCK_LIST_TYPES.has(child.type.name)) continue
      for (let j = 0; j < child.childCount; j += 1) items.push(child.child(j))
    }
    return items.length ? items : null
  }
  return null
}

/**
 * 建 BlockAPI。
 *
 * @param {{ editor?: object, session?: object, origin?: string }} options
 *   `editor` 与 `session` 给一个就行；两个都给时事务走 `session`（元信息更全）。
 */
export function createBlockApi(options = {}) {
  const editor = options.editor || null
  const session = options.session || null
  const origin = options.origin || TRANSACTION_ORIGINS.HOST
  /** `batch` 期间共享的事务；非 null 时所有写操作都落在它上面、且不 dispatch。 */
  let pending = null

  const baseState = () => {
    const target = editor || (session && session.getEditor())
    const state = target && target.state
    if (!state) throw new Error('createBlockApi：需要 editor，或已 attachEditor 的 session')
    return state
  }
  const currentDoc = () => (pending ? pending.tr.doc : baseState().doc)
  const newTr = () => (pending ? pending.tr : baseState().tr)

  const send = (tr) => {
    if (session) { session.dispatch(tr, { origin }); return }
    editor.view.dispatch(tr)
  }
  const commit = (tr) => {
    if (pending) return
    if (!tr || !tr.steps.length) return
    closeHistory(tr)
    send(tr)
  }

  /** 把一批 payload 插到同一个落点，按文档顺序依次排开。 */
  const insertAll = (payloads, at) => {
    const list = Array.isArray(payloads) ? payloads : [payloads]
    if (!list.length) return []
    const schema = baseState().schema
    const target = resolveTarget(currentDoc(), at)
    if (!target || target.parentType === 'codeBlock' || isTableType(target.parentType)) return []
    const tr = newTr()
    const ids = []
    let pos = target.pos
    for (const payload of list) {
      const raw = normalizePayload(schema, payload)
      if (!raw) continue
      const taken = collectIds(tr.doc)
      const assigned = assignIds(raw, taken)
      const fitted = fitToParent(schema, assigned.json, target.parentType, taken)
      const node = nodeFromJson(schema, fitted)
      if (!node) continue
      tr.insert(pos, node)
      // 返回**最外层**落地块的 id：包壳之后真正「多出来」的那一块是壳，
      // 而 payload 自带的 id 照样在文档里（调用方可以照原 id 找内层块）。
      const outerId = fitted && fitted.attrs ? fitted.attrs.blockId : null
      const id = outerId || assigned.id
      if (!id) { continue }
      ids.push(id)
      // 下一块接在刚插入的块后面。`tr.insert` 落在文本块中间时 PM 会补切分（fitSlice），
      // 实际落点不等于 `pos + nodeSize`，所以按新 id 现查一次。
      const placed = posAtId(tr.doc, id)
      pos = placed === null ? pos + node.nodeSize : placed + node.nodeSize
    }
    commit(tr)
    return ids
  }

  const api = {
    // ── 读 ────────────────────────────────────────
    get(blockId) {
      const entry = blockEntry(currentDoc(), blockId)
      return entry ? snapshotOf(entry) : null
    },
    children(blockId) {
      const entry = blockEntry(currentDoc(), blockId)
      return entry ? entry.children.slice() : []
    },
    parent(blockId) {
      const entry = blockEntry(currentDoc(), blockId)
      return entry ? entry.parentId : null
    },
    index(blockId) {
      const entry = blockEntry(currentDoc(), blockId)
      return entry ? entry.index : -1
    },
    siblings(blockId) {
      const doc = currentDoc()
      const entry = blockEntry(doc, blockId)
      if (!entry) return []
      if (!entry.parentId) return blockTree(doc).root.slice()
      const parentEntry = blockEntry(doc, entry.parentId)
      return parentEntry ? parentEntry.children.slice() : []
    },
    query(pred) {
      if (typeof pred !== 'function') return []
      return blockTree(currentDoc()).order
        .map(entry => snapshotOf(entry))
        .filter(pred)
    },
    /**
     * 当前选区涉及的块 id。
     *
     * 两种语义分开处理，因为「选中的块」在两个场景下问的不是同一个东西：
     * - **折叠光标** = 「当前块」：取光标所在的**最内层**块。光标在引用容器里的段落里，
     *   工具栏 / 块菜单要问的是那个段落，不是外面那层引用；
     * - **范围选区** = 「要操作的块」：取**最外层**相交块，块的子孙不再单列
     *   （否则「删除选中的块」会把子树重复处理一遍）。套娃式删空由 `remove` 的
     *   `expandDeletion` 兜底，父块空了自己跟着走。
     */
    selected() {
      const state = pending ? null : baseState()
      const selection = state ? state.selection : pending.tr.selection
      const tree = blockTree(currentDoc())
      const from = selection.from
      const to = selection.to
      if (from === to) {
        // 文档序里父先于子，所以「最后一个包住光标的块」就是最内层那一个。
        let found = null
        for (const entry of tree.order) {
          if (entry.pos <= from && entry.end >= from) found = entry
        }
        return found ? [found.blockId] : []
      }
      const ids = []
      let resumeAt = -1
      for (const entry of tree.order) {
        if (entry.pos < resumeAt) continue
        if (entry.end <= from) continue
        if (entry.pos >= to) break
        ids.push(entry.blockId)
        resumeAt = entry.end
      }
      return ids
    },
    isContainer(blockId) {
      const entry = blockEntry(currentDoc(), blockId)
      return entry ? isContainerType(entry.node.type.name) : false
    },

    // ── 写 ────────────────────────────────────────
    insert(payload, at) {
      return insertAll([payload], at)
    },
    update(blockId, patch) {
      const entry = blockEntry(currentDoc(), blockId)
      if (!entry || !patch || typeof patch !== 'object') return
      const spec = entry.node.type.spec.attrs || {}
      const attrs = { ...entry.node.attrs }
      let changed = false
      Object.keys(patch).forEach((key) => {
        // `blockId` 是锚点，不接受外部改写。
        if (key === 'blockId' || !(key in spec)) return
        if (attrs[key] === patch[key]) return
        attrs[key] = patch[key]
        changed = true
      })
      if (!changed) return
      const tr = newTr()
      tr.setNodeMarkup(entry.pos, null, attrs)
      commit(tr)
    },
    remove(blockId, opts) {
      const doc = currentDoc()
      const entry = blockEntry(doc, blockId)
      if (!entry || inTableContext(doc, entry)) return
      const tr = newTr()
      if (opts && opts.keepChildren) {
        const lifted = hoistedChildren(entry)
        if (lifted) {
          tr.replaceWith(entry.pos, entry.end, lifted)
          commit(tr)
          return
        }
      }
      const range = expandDeletion(doc, entry)
      // 删光整篇会造出空 doc（本仓库 doc 的 content 是 1*），留一个空段落兜底。
      if (range.from === 0 && range.to === doc.content.size) {
        const empty = baseState().schema.nodes.paragraph.create()
        tr.replaceWith(range.from, range.to, empty)
      } else {
        tr.delete(range.from, range.to)
      }
      commit(tr)
    },
    move(blockId, to) {
      const doc = currentDoc()
      const entry = blockEntry(doc, blockId)
      if (!entry || inTableContext(doc, entry)) return
      const target = resolveTarget(doc, to)
      if (!target) return
      // 防环：搬进自己或自己的子孙；以及搬进代码块 / 表格骨架。
      if (isDescendantOf(target.entry, entry)) return
      if (target.parentType === 'codeBlock' || isTableType(target.parentType)) return
      if (target.entry && isTableContextEntry(doc, target.entry)) return
      // 同位置 → no-op（§5.12.3）。
      if (target.pos === entry.pos || target.pos === entry.end) return
      const schema = baseState().schema
      const taken = collectIds(doc)
      const fitted = fitToParent(schema, entry.node.toJSON(), target.parentType, taken)
      const node = nodeFromJson(schema, fitted)
      if (!node) return
      const tr = newTr()
      const range = expandDeletion(tr.doc, entry)
      const startIndex = tr.steps.length
      tr.delete(range.from, range.to)
      // 落点在**删除前**的文档坐标里，只过本次删除新增的那几张 map。
      let pos = target.pos
      for (let i = startIndex; i < tr.mapping.maps.length; i += 1) pos = tr.mapping.maps[i].map(pos, 1)
      tr.insert(pos, node)
      commit(tr)
    },
    duplicate(blockId, opts) {
      const doc = currentDoc()
      const entry = blockEntry(doc, blockId)
      if (!entry || inTableContext(doc, entry)) return null
      const schema = baseState().schema
      const deep = !opts || opts.deep !== false
      const source = entry.node.toJSON()
      const copied = deep ? source : pruneSubtree(schema, source)
      const taken = collectIds(doc)
      // 整棵子树换号：原块与副本不能共用锚点。
      const next = reassignIds(copied, taken)
      const fitted = fitToParent(schema, next.json, directParentType(doc, entry), taken)
      const node = nodeFromJson(schema, fitted)
      if (!node) return null
      const tr = newTr()
      tr.insert(entry.end, node)
      commit(tr)
      return next.id || (fitted && fitted.attrs ? fitted.attrs.blockId : null)
    },
    transform(blockId, toType, attrs) {
      const doc = currentDoc()
      const entry = blockEntry(doc, blockId)
      if (!entry || inTableContext(doc, entry)) return
      const schema = baseState().schema
      const taken = collectIds(doc)
      const json = convertBlock(schema, entry.node, toType, attrs, taken)
      if (!json) return
      const node = nodeFromJson(schema, json)
      if (!node) return
      const tr = newTr()
      tr.replaceWith(entry.pos, entry.end, node)
      commit(tr)
    },

    // ── 批量 ──────────────────────────────────────
    insertMany(payloads, at) {
      return insertAll(payloads, at)
    },
    removeMany(blockIds) {
      const list = Array.isArray(blockIds) ? blockIds.filter(id => typeof id === 'string') : []
      if (!list.length) return
      const tr = newTr()
      for (const blockId of list) {
        // 逐个在 `tr.doc` 上现查：上一笔删除已经让后面的位置整体左移了。
        const entry = blockEntry(tr.doc, blockId)
        if (!entry || inTableContext(tr.doc, entry)) continue
        const range = expandDeletion(tr.doc, entry)
        tr.delete(range.from, range.to)
      }
      commit(tr)
    },
    /** 一次 dispatch 包住 `fn` 内所有写操作 → 整体一步可撤；`fn` 抛错则整批不落地。 */
    batch(fn) {
      if (typeof fn !== 'function') return
      if (pending) { fn(); return }
      pending = { tr: baseState().tr }
      try {
        fn()
      } catch (error) {
        pending = null
        throw error
      }
      const tr = pending.tr
      pending = null
      commit(tr)
    },

    /** 调试用：`blockId → pos`。业务代码一律走上面的方法，不要自己算 pos（§5.12.5）。 */
    posAtId(blockId) {
      return posAtId(currentDoc(), blockId)
    },
  }

  return api
}

/** 目标块本身是否落在表格骨架内部（表格里的段落搬不动）。 */
function isTableContextEntry(doc, entry) {
  return inTableContext(doc, entry) || isTableType(entry.node.type.name)
}

/**
 * 块树与节点层一并导出。
 *
 * 宿主自己写拖拽 / AI 提案时常常只要「id → 位置」或「自动包壳」这两块能力，
 * 让它们能直接 import，不必绕过 BlockAPI 去碰 `src/core/blocks` 里的内部实现。
 */
export {
  BLOCK_CONTAINER_TYPES, BLOCK_LIST_TYPES, blockEntry, blockIdOf, blockTree, isContainerType,
  posAtId, snapshotOf,
} from './tree'
export {
  TABLE_STRUCTURE_TYPES, assignIds, collectIds, collectJsonIds, convertBlock, directParentType,
  expandDeletion, fitToParent, inTableContext, isDescendantOf, isTableType, listItemTypeOf,
  listTypeOf, minChildrenOf, nodeFromJson, normalizePayload, pruneSubtree, reassignIds,
} from './nodes'

export default createBlockApi
