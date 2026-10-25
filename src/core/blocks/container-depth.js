/**
 * 容器嵌套深度上限（P1-05，09 §5.2「默认 5」+ 拖拽合法性判定）。
 *
 * - 容器 = 视觉承载容器四类：blockquote（引用）、callout（高亮块）、
 *   details（折叠块）、columns（多栏）。column 是栏位结构不算独立层；
 *   表格单元格是结构性承载，也不计入容器链（02 口径：容器互套指引用 /
 *   高亮 / 折叠 / 多栏，02 §1079「引用可套引用」即链式叠加场景）。
 * - 深度 = 选区/落点祖先链上容器节点个数，上限 CONTAINER_NESTING_MAX = 5；
 *   wrap（再套一层）与 move（拖进更深位置）共用同一公式：
 *   落点容器深度 + 新增层数 + 区间内部最大嵌套 ≤ 5。
 * - 拦截点三层：命令层（toggleBlockquote / setDetails，覆盖快捷键与菜单）、
 *   菜单层（callout / columns 插入，mixin 调用点给 this.error 提示）、
 *   移动层（moveBlockRange 兜底，拖拽/上移下移共用）。
 */

export const CONTAINER_NESTING_MAX = 5

export const CONTAINER_TYPES = ['blockquote', 'callout', 'details', 'columns']

const containerSet = new Set(CONTAINER_TYPES)

/** 某位置的容器链深度（祖先中容器节点个数）。 */
export function containerDepthAt(doc, pos) {
  let count = 0
  try {
    const $pos = doc.resolve(pos)
    for (let depth = 1; depth <= $pos.depth; depth++) {
      if (containerSet.has($pos.node(depth).type.name)) count++
    }
  } catch (_) { /* 越界 pos 按 0 处理 */ }
  return count
}

/** [from, to) 区间内部的最大容器嵌套深度（只数区间内部的容器：起点 < from 的是区间祖先，已由 containerDepthAt 计入，跳过防双计）。 */
export function maxContainerDepthWithin(doc, from, to) {
  let max = 0
  doc.nodesBetween(from, to, (node, pos) => {
    if (pos < from || !containerSet.has(node.type.name)) return
    const chain = containerDepthAt(doc, pos) + 1
    if (chain > max) max = chain
  })
  return max
}

/** 在 [from, to) 上新增 added 层容器（wrap / 插入）是否仍在深度上限内。 */
export function wrapContainerAllowed(state, from, to, added = 1) {
  if (from > to) return false
  return containerDepthAt(state.doc, from) + added + maxContainerDepthWithin(state.doc, from, to) <= CONTAINER_NESTING_MAX
}

/** 把 [from, to) 移动到 target 落点后，整体嵌套是否仍在深度上限内。 */
export function moveDepthAllowed(editor, from, to, target) {
  const { doc } = editor.state
  return containerDepthAt(doc, target) + maxContainerDepthWithin(doc, from, to) <= CONTAINER_NESTING_MAX
}

/** 选区是否已触及指定类型容器（toggle 语义下触及时多半是拆容器，只减深度，放行）。 */
export function selectionTouchesContainer(state, typeName) {
  const type = state.schema.nodes[typeName]
  if (!type) return false
  const { from, to } = state.selection
  return [from, to].some((pos) => {
    try {
      const $pos = state.doc.resolve(pos)
      for (let depth = 1; depth <= $pos.depth; depth++) {
        if ($pos.node(depth).type === type) return true
      }
    } catch (_) { /* ignore */ }
    return false
  })
}
