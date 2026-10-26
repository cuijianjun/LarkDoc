/**
 * 接受 / 拒绝一条修订建议 —— requirements/07 §12.5。
 *
 * 决策表只有两行（契约层 `revisionDecision` 是唯一出处，这里不重复判断）：
 *
 * | 类型 \ 动作 | accept | reject |
 * | --- | --- | --- |
 * | insert | 留文字、摘标记 | 连文字一起丢 |
 * | delete | 连文字一起丢（定稿） | 连文字一起丢（原文不恢复） |
 *
 * 三条硬口径：
 *   - **无二次确认、无 toast**（07 §12.5 逐字要求）。命令只返回事务，弹窗/提示由宿主
 *     自己加，本层不引 UI。
 *   - **进 undo 栈**（07 §13）：动作就是一次正常编辑，⌘Z 可撤回一次。只有「补 mark」
 *     那种跟踪期事务才 `addToHistory: false`。
 *   - **落 `REVISION_SKIP_META`**：删文字 / 摘 mark 都是「宿主动作」，跟踪器见到该 meta
 *     必须放手，否则拒绝一条新增会被再记成一条删除建议（自激）。
 */
import { collectRevisions, revisionDecision, normalizeRevision } from '../blocks/revision'
import { REVISION_SKIP_META } from './tracker'

/** 一条建议在文档里的全部区间 + 类型（按 `from` 升序）；不存在返回 null。 */
export function revisionTarget(doc, revisionId) {
  const target = String(revisionId || '')
  const items = collectRevisions(doc).filter((item) => item.revisionId === target)
  if (!items.length) return null
  const first = items[0]
  return {
    revisionId: target,
    kind: normalizeRevision(first).kind,
    author: first.author,
    from: items[0].from,
    to: items[items.length - 1].to,
    ranges: items.map((item) => ({ from: item.from, to: item.to })),
  }
}

/**
 * 把一条建议落定成一个事务（`tr` / `false`）。
 *
 * 删除文字时**从后往前**删：多段区间（同一 id 被中间内容拆开）用原始坐标会错位。
 */
export function buildRevisionDecisionTr(state, revisionId, action) {
  const target = revisionTarget(state.doc, revisionId)
  if (!target) return false
  const { dropText } = revisionDecision(target.kind, action)
  const type = state.schema.marks.revision
  const tr = state.tr
  if (dropText) {
    target.ranges.slice().reverse().forEach((range) => tr.delete(range.from, range.to))
  } else if (type) {
    target.ranges.forEach((range) => tr.removeMark(range.from, range.to, type))
  }
  tr.setMeta(REVISION_SKIP_META, true)
  tr.setMeta('larkDocRevisionAction', action)
  return tr
}

/** 文档里全部建议的跳转目标（`from` 升序）。prev/next 与面板排序共用这一份。 */
export function revisionJumps(doc) {
  return collectRevisions(doc).map((item) => ({
    revisionId: item.revisionId,
    kind: item.kind,
    from: item.from,
    to: item.to,
  }))
}

/**
 * 相对 `revisionId` 的下一条 / 上一条建议 id（`direction` = 1 / -1）。
 *
 * `currentId` 为空或已不在文档里 → 从头（direction>0）或从尾（direction<0）取。
 * 越界返回空串：面板据此把按钮置灰（首条时 `prev` 禁用，07 §12.4）。
 */
export function adjacentRevision(doc, revisionId, direction) {
  const jumps = revisionJumps(doc)
  if (!jumps.length) return ''
  const index = jumps.findIndex((item) => item.revisionId === revisionId)
  if (index === -1) return direction > 0 ? jumps[0].revisionId : jumps[jumps.length - 1].revisionId
  const next = jumps[index + (direction > 0 ? 1 : -1)]
  return next ? next.revisionId : ''
}

/** 复制锚点用的链接片段（与评论面板同形：`#revision-<id>`，宿主负责拼 origin）。 */
export function revisionAnchor(revisionId) {
  const id = String(revisionId || '')
  return id ? `#revision-${id}` : ''
}

export default {
  revisionTarget,
  buildRevisionDecisionTr,
  revisionJumps,
  adjacentRevision,
  revisionAnchor,
}
