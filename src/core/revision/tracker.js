/**
 * 修订模式的事务跟踪 —— requirements/07 §12.2 / §12.5「增」一行。
 *
 * 只做一件事：**修订态（suggest）下把用户的改动改写成「建议」**。
 *
 * | 用户动作 | 默认行为 | 修订态行为 |
 * | --- | --- | --- |
 * | 键入 / 粘贴 | 文字直接进正文 | 文字进正文 + 立刻落 `revision kind=insert` 标记 |
 * | Backspace / Delete | 文字真删 | 文字保留 + 落 `revision kind=delete`（删除线） |
 *
 * 两条实现路线，各自解决一类问题：
 *   1. **新增走 `appendTransaction`** —— 键入是浏览器 / IME 的内建行为，拦按键去手写
 *      插入会跟 IME 组字、输入法候选、粘贴、拖拽全部打架。所以让改动先正常发生，
 *      事后再把「新增的那些字符」补上 mark（只改 doc，不改按键）。
 *   2. **删除走 `handleKeyDown`** —— 删除必须**不发生**（文字要留着画删除线），
 *      事后补不回来。所以只在「纯字符退格」这一种情形拦按键，其余（跨块合并段落、
 *      整块选中删除）照旧真删。
 *
 * 四条硬口径：
 *   - **标记不能自成一个撤销步**。补 mark 的事务一律 `addToHistory: false` ——
 *     prosemirror-history 对 `appendedTransaction` 带这个 meta 的情形走 `addMaps`
 *     分支（见其 `applyTransaction`），mark 会并进同一个 undo event，⌘Z 仍是一步。
 *   - **防自激**。补 mark 的事务都带 `REVISION_TRACK_META`，`appendTransaction`
 *     见到它 / 见到 `appendedTransaction`（别人补的）就直接返回 null。
 *   - **连续键入算同一条建议**。同一条 `revisionId` 只在「紧接着上一次由本插件写入
 *     的标记继续输入」时复用（`storage.openId`）—— 已有修订（他人 / 刷新后载入）
 *     绝不追加，避免把两条建议粘成一条。
 *   - **IME 组字期间不补 mark**。组字中途替换文本节点会让部分浏览器中断组字，
 *     所以 `view.composing` 时先记账，`compositionend` 后再一次性补。
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { normalizeRevision, createRevisionId, REVISION_AUTHOR_FALLBACK } from '../blocks/revision'

/** 本插件自己写的补丁事务 meta（见到就跳过，防自激）。 */
export const REVISION_TRACK_META = 'larkDocRevisionTrack'

/** 宿主（接受 / 拒绝、`setContent`、协同远端）给事务打这个 meta 可让跟踪器彻底放手。 */
export const REVISION_SKIP_META = 'larkDocRevisionSkip'

const revisionTrackerKey = new PluginKey('larkDocRevisionTracker')

/** 区间合并（升序、相邻或重叠并成一段），删除与新增的落点都过这一道。 */
export function mergeRanges(ranges) {
  const list = (ranges || [])
    .filter((item) => item && item.to > item.from)
    .map((item) => ({ from: item.from, to: item.to }))
    .sort((a, b) => a.from - b.from)
  const merged = []
  list.forEach((item) => {
    const last = merged[merged.length - 1]
    if (last && item.from <= last.to) {
      last.to = Math.max(last.to, item.to)
      return
    }
    merged.push(item)
  })
  return merged
}

/**
 * 一个事务里「新出现的字符」占哪些区间（新文档坐标，升序合并）。
 *
 * 逐 step 取 `StepMap` 的回调（`newEnd > newStart` 即该 step 有新增内容），再把区间
 * 顺着**后续 step 的 mapping** 推到最后位置 —— 多 step 事务（如「先删后插」）里
 * 直接用中间坐标会错位。
 */
export function insertedRanges(tr) {
  const ranges = []
  tr.steps.forEach((step, index) => {
    const map = tr.mapping.maps[index]
    const rest = tr.mapping.slice(index + 1)
    map.forEach((oldStart, oldEnd, newStart, newEnd) => {
      if (newEnd <= newStart) return
      ranges.push({ from: rest.map(newStart, -1), to: rest.map(newEnd, 1) })
    })
  })
  return mergeRanges(ranges)
}

/** 区间内命中的 revision 标记片段（带绝对位置），`type` 来自 `state.schema.marks.revision`。 */
export function revisionSpans(doc, from, to, type) {
  const spans = []
  if (!type || to <= from) return spans
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return true
    const mark = type.isInSet(node.marks)
    if (!mark) return true
    const start = Math.max(from, pos)
    const end = Math.min(to, pos + node.nodeSize)
    if (end > start) spans.push({ mark, from: start, to: end })
    return true
  })
  return spans
}

/**
 * 退格 / 删除要作用到哪一段（`forward` = true 为 Delete，向后删）。
 *
 * 只认「一个文本块内的字符」：光标在段落里、前后还有字。其余情形（块首退格要合并段落、
 * 整块选中、单元格边界）返回 null → 交给默认行为真删。这是刻意收窄的 V1 口径
 * （07 §12 没实测这些边界，不凭手感造行为）。
 */
export function deletionRange(state, forward) {
  const sel = state.selection
  if (!sel || sel.$from === undefined) return null
  if (!sel.empty) {
    if (sel.$from.parent && sel.$from.parent.isTextblock && sel.$from.sameParent(sel.$to)) return { from: sel.from, to: sel.to }
    return null
  }
  const $pos = sel.$from
  if (!$pos.parent || !$pos.parent.isTextblock) return null
  const offset = $pos.parentOffset
  if (!forward) return offset > 0 ? { from: $pos.pos - 1, to: $pos.pos } : null
  if (offset < $pos.parent.content.size) return { from: $pos.pos, to: $pos.pos + 1 }
  return null
}

/**
 * 这段文字「删下去」应该怎么处理：
 *
 * | 区间覆盖 | 判定 | 含义 |
 * | --- | --- | --- |
 * | 全是 `delete` 标记 | `keep` | 已经是删除态，吞掉按键什么也不做 |
 * | 全是 `insert` 标记 | `drop` | 自己刚键入、还没被采纳 —— 真删（不留下一条空建议） |
 * | 其余（无标记 / 混合 / 部分覆盖） | `mark` | 转成删除建议 |
 */
export function deleteDecision(doc, range, type) {
  const spans = revisionSpans(doc, range.from, range.to, type)
  const covered = spans.reduce((sum, span) => sum + (span.to - span.from), 0)
  if (!spans.length || covered < range.to - range.from) return 'mark'
  const kinds = spans.map((span) => normalizeRevision(span.mark.attrs).kind)
  if (kinds.every((kind) => kind === 'delete')) return 'keep'
  if (kinds.every((kind) => kind === 'insert')) return 'drop'
  return 'mark'
}

/**
 * 紧挨着 `from` 之前那个字符上的建议 id（跨块、块首一律返回空串）。
 * 只有它等于 `openId`（本插件刚写过的那条）时才算「继续同一条建议」。
 */
export function adjacentRevisionId(doc, from, type) {
  if (!type || from <= 0) return ''
  const $pos = doc.resolve(from)
  if (!$pos.parent || !$pos.parent.isTextblock || $pos.parentOffset <= 0) return ''
  let found = ''
  doc.nodesBetween(from - 1, from, (node) => {
    if (!node.isText) return true
    const mark = type.isInSet(node.marks)
    if (mark) found = normalizeRevision(mark.attrs).revisionId
    return true
  })
  return found
}

/** 给一段区间补 mark 的事务（新增 / 删除共用形状）；拿不到 mark 类型时返回 null。 */
export function buildRevisionMarkTr(state, range, attrs, meta) {
  const type = state.schema.marks.revision
  if (!type || !range || range.to <= range.from) return null
  const tr = state.tr
  tr.addMark(range.from, range.to, type.create(normalizeRevision(attrs)))
  tr.setMeta(REVISION_TRACK_META, true)
  // 补 mark 不算一次编辑：并进同一个 undo event（见文件头第一条硬口径）。
  tr.setMeta('addToHistory', false)
  if (meta) tr.setMeta(meta, true)
  return tr
}

/**
 * 是不是「整篇替换」这一类事务（`setContent` / 载入正文 / 历史恢复）。
 *
 * 整篇替换在修订态下也会被当成「新增」，会把一整篇正文刷成蓝字 —— 那不是用户在
 * 提建议，是宿主在换内容。判据取「单 step 且覆盖 0..docSize」，选区全选后键入会被
 * 误判进来（宁可少标一条，也不要把整篇染色）。
 */
export function isBulkReplace(oldState, tr) {
  if (!tr || tr.steps.length !== 1) return false
  const step = tr.steps[0]
  if (typeof step.from !== 'number' || typeof step.to !== 'number') return false
  return step.from === 0 && step.to === oldState.doc.content.size
}

/**
 * 修订跟踪扩展。
 *
 * `storage` 是宿主与插件的唯一协商面：
 *   - `active`  —— 是否处于修订态（宿主在模式切换时改它，插件每帧读）
 *   - `author`  —— 建议作者 id（落进 mark，面板按它显示名字）
 *   - `openId`  —— 当前这条建议的 id（连续键入复用）
 *
 * 用 storage 而不是 `configure()` 是因为编辑器只建一次：模式是**用户维度**的状态，
 * 换模式不该重建编辑器（会丢选区、折叠与历史栈）。
 */
export const LarkDocRevisionTracker = Extension.create({
  name: 'larkDocRevisionTracker',

  addStorage() {
    return { active: false, author: REVISION_AUTHOR_FALLBACK, openId: '' }
  },

  addProseMirrorPlugins() {
    const storage = this.storage
    const editor = this.editor
    // IME 组字期间记账：`compositionend` 后一次性补 mark（区间是新文档坐标）。
    let pending = []
    let compositionBound = false

    const isActive = () => !!(storage && storage.active)
    const markType = (state) => state.schema.marks.revision
    const authorOf = () => (storage && storage.author) || REVISION_AUTHOR_FALLBACK

    /** 补一段「新增」标记：能接上 openId 就复用，接不上就新开一条建议。 */
    const trackInsert = (state, ranges) => {
      const type = markType(state)
      if (!type || !ranges.length) return null
      let tr = null
      ranges.forEach((range) => {
        const adjacent = adjacentRevisionId(state.doc, range.from, type)
        const revisionId = adjacent && adjacent === storage.openId ? adjacent : createRevisionId()
        const next = buildRevisionMarkTr(state, range, { revisionId, author: authorOf(), kind: 'insert' })
        if (!next) return
        if (!tr) {
          tr = next
        } else {
          tr.addMark(range.from, range.to, type.create(normalizeRevision({ revisionId, author: authorOf(), kind: 'insert' })))
        }
        storage.openId = revisionId
      })
      return tr
    }

    const flushPending = () => {
      if (!pending.length) return
      const view = editor && editor.view
      if (!view || !isActive()) {
        pending = []
        return
      }
      const state = view.state
      const size = state.doc.content.size
      const ranges = mergeRanges(pending.map((item) => ({ from: Math.min(item.from, size), to: Math.min(item.to, size) })))
      pending = []
      const tr = trackInsert(state, ranges)
      if (tr) view.dispatch(tr)
    }

    const bindComposition = (view) => {
      if (compositionBound) return
      compositionBound = true
      const onEnd = () => setTimeout(flushPending, 0)
      view.dom.addEventListener('compositionend', onEnd)
      editor.on('destroy', () => view.dom.removeEventListener('compositionend', onEnd))
    }

    const plugin = new Plugin({
      key: revisionTrackerKey,

      appendTransaction(transactions, oldState, newState) {
        if (!isActive()) return null
        if (newState.doc === oldState.doc) return null
        // 别人补的 / 自己补的 / 宿主显式跳过的，一律不碰。
        const blocked = transactions.some((tr) => tr.getMeta(REVISION_TRACK_META)
          || tr.getMeta(REVISION_SKIP_META)
          || tr.getMeta('appendedTransaction'))
        if (blocked) return null
        const ranges = insertedRanges(transactions[transactions.length - 1])
        if (!ranges.length) return null
        const view = editor && editor.view
        if (view && view.composing) {
          // 组字中：先记账，`compositionend` 后再补（见文件头第四条硬口径）。
          pending = mergeRanges([...pending, ...ranges])
          return null
        }
        return trackInsert(newState, ranges)
      },

      props: {
        handleKeyDown(view, event) {
          if (!isActive()) return false
          if (event.isComposing || view.composing) return false
          if (event.key !== 'Backspace' && event.key !== 'Delete') return false
          if (event.metaKey || event.ctrlKey || event.altKey) return false
          const state = view.state
          const type = markType(state)
          if (!type) return false
          const range = deletionRange(state, event.key === 'Delete')
          if (!range) return false
          const decision = deleteDecision(state.doc, range, type)
          if (decision === 'keep') return true
          if (decision === 'drop') return false
          const adjacent = adjacentRevisionId(state.doc, range.from, type)
          const revisionId = adjacent && adjacent === storage.openId ? adjacent : createRevisionId()
          const tr = buildRevisionMarkTr(state, range, { revisionId, author: authorOf(), kind: 'delete' }, REVISION_SKIP_META)
          if (!tr) return false
          storage.openId = revisionId
          view.dispatch(tr)
          return true
        },
      },

      view() {
        return {
          update(view) { bindComposition(view) },
          destroy() { pending = [] },
        }
      },
    })

    return [plugin]
  },
})

export default LarkDocRevisionTracker
