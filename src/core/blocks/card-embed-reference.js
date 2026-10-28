/**
 * 卡片块引用命令的**落库助手**（P3-08 拆出，P0-04 行数硬规则）。
 *
 * 三条引用命令（`updateReferenceCard` / `markReferenceStale` / `rebindReferenceCard`）
 * 共用同一套步骤：定位目标卡 → 读旧卡 → 纯函数算新卡 → `setNodeMarkup`。三段逻辑
 * 一模一样，差别只有中间那个 mutate 函数，所以收在这里，块文件里只剩一行调用。
 */
import { nodeAtSafe } from '../documentOperations'
import { encodeCard, readCard } from '../embed/card'

/**
 * 找命令要改的那张引用卡。两个入口：显式 `pos`（宿主同步时手里有位置），
 * 或当前选中的卡（用户点了卡上的「重新绑定」）。
 *
 * **不往上找祖先**：`cardEmbed` 是 atom，选区不可能落在卡片内部 —— 真落进去了
 * 说明命中的是别的东西，硬改一张不是目标的卡比返回 false 更糟。
 */
function referenceTarget(state, pos) {
  const doc = state && state.doc
  if (!doc) return null
  if (Number.isInteger(pos)) {
    const node = nodeAtSafe(doc, pos)
    return node && node.type && node.type.name === 'cardEmbed' ? { node, pos } : null
  }
  const selection = state && state.selection
  const node = selection && selection.node
  return node && node.type && node.type.name === 'cardEmbed' ? { node, pos: selection.from } : null
}

/**
 * 三条引用命令共用的落库步骤：读旧卡 → 纯函数算新卡 → `setNodeMarkup`。
 *
 * 为什么统一走 `setNodeMarkup` 而不是替换节点：替换会让卡片「重造」，选区、块 id、
 * 协同里的节点身份都会断；改 attrs 才是「同一张卡换了状态」。NodeView 的 `update()`
 * 见到 `card` 变了返回 false → 重画 DOM，所以画面上看不出差别。
 */
export function applyReference(state, tr, pos, mutate) {
  const target = referenceTarget(state, pos)
  if (!target || typeof mutate !== 'function') return false
  const next = mutate(readCard((target.node.attrs || {}).card))
  if (!next) return false
  let encoded
  try { encoded = encodeCard(next) } catch (_) { return false }
  tr.setNodeMarkup(target.pos, undefined, { ...(target.node.attrs || {}), card: encoded })
  return true
}
