/**
 * 文档级命令表（larkDoc 扩展的 addCommands 返回值）。
 *
 * 全部命令只往事务里写 meta / 属性，由插件的 state.apply 与 appendTransaction
 * 统一消化；`createDocumentCommands()` 无副作用、不依赖扩展实例（没有 this）。
 */
import {
  blockIdAt,
  clampHeadingNumberStart,
  collectBlockIdFixes,
  collectIndentFixes,
  foldedRange,
  nodeAtSafe,
  previousSiblingOrderedList,
} from '../documentOperations'
import { applyBlockIdFixes, applyIndentFixes } from './block-fixes'
import { documentKey } from './document-key'

export function createDocumentCommands() {
  return {
    setLarkDocSearch: (query, activeIndex = 0) => ({ tr, dispatch }) => { if (dispatch) tr.setMeta(documentKey, { search: String(query || ''), activeIndex }); return true },
    // 折叠状态存的是标题的 blockId（不是文档位置）：编辑、重命名、移动、删除
    // 都不会让它串到别的标题上，同名标题天然各自独立。
    toggleLarkDocFold: (pos) => ({ tr, dispatch }) => {
      const id = blockIdAt(tr.doc, pos)
      if (!id || !foldedRange(tr.doc, pos)) return false
      if (dispatch) tr.setMeta(documentKey, { toggleFoldId: id })
      return true
    },
    toggleLarkDocFoldById: (id) => ({ tr, dispatch }) => {
      if (typeof id !== 'string' || !id) return false
      if (dispatch) tr.setMeta(documentKey, { toggleFoldId: id })
      return true
    },
    resetLarkDocFolds: () => ({ tr, dispatch }) => { if (dispatch) tr.setMeta(documentKey, { resetFolds: true }); return true },
    revealLarkDocMatch: (from, to) => ({ tr, dispatch }) => { if (dispatch) tr.setMeta(documentKey, { reveal: { from, to } }); return true },
    setLarkDocHandleHover: (range) => ({ tr, dispatch }) => { if (dispatch) tr.setMeta(documentKey, { handleHover: range && Number.isInteger(range.from) && Number.isInteger(range.to) ? { from: range.from, to: range.to, section: range.section === true } : null }); return true },
    // 按 blockId 恢复折叠位（刷新/内容替换后由宿主调用）。
    foldLarkDocByIds: (ids) => ({ tr, dispatch }) => {
      const list = Array.isArray(ids) ? ids.map(String).filter(Boolean) : []
      if (!list.length) return false
      if (dispatch) tr.setMeta(documentKey, { foldIds: list.slice(0, 1000) })
      return true
    },
    // 兼容 0.6.x 之前的持久化内容：旧键是「层级\u0001文本\u0001同名序号」，
    // 这里按旧算法换算成 blockId 后再折叠；写回时自然迁移成 id。
    foldLarkDocByKeys: (keys) => ({ tr, dispatch }) => {
      const list = Array.isArray(keys) ? keys.map(String).filter(Boolean) : []
      if (!list.length) return false
      if (dispatch) tr.setMeta(documentKey, { foldByKeys: list.slice(0, 1000) })
      return true
    },
    // 给缺号/重号的块补 blockId（初始化与 setContent 后由宿主显式调用一次）。
    ensureLarkDocBlockIds: () => ({ tr, dispatch }) => {
      if (!dispatch) return collectBlockIdFixes(tr.doc).length > 0
      return applyBlockIdFixes(tr)
    },
    normalizeLarkDocIndents: () => ({ tr, dispatch }) => {
      if (!dispatch) return collectIndentFixes(tr.doc).length > 0
      return applyIndentFixes(tr)
    },
    /**
     * 标题编号的唯一写入口。`patch` 只带需要改的字段：
     * - `{ numbering: true }` 开启编号（继续前序）
     * - `{ numberingStart: null }` 继续标题编号
     * - `{ numberingStart: 3 }` 重新开始 / 设置编号的值
     * 编号值本身不落库，由 computeHeadingNumbers 每帧算，删除/移动会自动更新。
     */
    setLarkDocHeadingNumber: (pos, patch) => ({ tr, dispatch }) => {
      const node = nodeAtSafe(tr.doc, pos)
      if (!node || node.type.name !== 'heading') return false
      const next = { ...node.attrs }
      if (typeof patch?.numbering === 'boolean') next.numbering = patch.numbering
      if (patch && 'numberingStart' in patch) next.numberingStart = patch.numberingStart === null ? null : clampHeadingNumberStart(patch.numberingStart)
      if (next.numbering === node.attrs.numbering && next.numberingStart === node.attrs.numberingStart) return false
      if (dispatch) tr.setNodeMarkup(pos, node.type, next)
      return true
    },
    /** 切换某个标题的编号开关（飞书用 ⋮⋮ →「有序列表」触发）。 */
    toggleLarkDocHeadingNumber: (pos) => ({ tr, dispatch }) => {
      const node = nodeAtSafe(tr.doc, pos)
      if (!node || node.type.name !== 'heading') return false
      const next = { ...node.attrs, numbering: !node.attrs.numbering }
      if (!next.numbering) next.numberingStart = null
      if (dispatch) tr.setNodeMarkup(pos, node.type, next)
      return true
    },
    /**
     * 列表序号菜单的唯一写入口（点列表序号弹出，与标题编号共用一套菜单）：
     * - `null` 继续前序编号（清掉这个 item 的起点）
     * - `1` 重新开始编号
     * - `7` 设置编号的值
     * 只改该 item 的 numberStart，兄弟项的编号由 computeOrderedListNumbers 现算。
     * 显式起点会覆盖「继续编号」的接号，所以同时把列表上的 continueFrom 摘掉。
     */
    setLarkDocListItemNumber: (pos, numberStart) => ({ tr, dispatch }) => {
      const node = nodeAtSafe(tr.doc, pos)
      if (!node || node.type.name !== 'listItem') return false
      const $pos = tr.doc.resolve(pos)
      const parent = $pos.parent
      if (!parent || parent.type.name !== 'orderedList') return false
      const next = numberStart === null ? null : clampHeadingNumberStart(numberStart)
      const unlink = next !== null && parent.attrs?.continueFrom === true
      if (!unlink && next === (node.attrs?.numberStart ?? null)) return false
      if (dispatch) {
        if (unlink) tr.setNodeMarkup($pos.before(), parent.type, { ...parent.attrs, continueFrom: false })
        tr.setNodeMarkup(pos, node.type, { ...node.attrs, numberStart: next })
      }
      return true
    },
    /**
     * 「继续编号」对列表的服务端语义（点菜单第一项）：
     * 1. 该 item 有显式起点 → 清掉，回到接着上一个 item 数；
     * 2. 它是列表首项且前面紧邻另一个有序列表 → 给列表打上 continueFrom，接上前一个列表的序号。
     *
     * 第 2 条是「两个相邻列表都显示 1.」时点「继续编号」没反应的正解：
     * 此时 item 没有起点、列表也没有接号标记，只清起点等于什么都没做。
     */
    continueLarkDocListNumber: (pos) => ({ tr, dispatch }) => {
      const node = nodeAtSafe(tr.doc, pos)
      if (!node || node.type.name !== 'listItem') return false
      const $pos = tr.doc.resolve(pos)
      const parent = $pos.parent
      if (!parent || parent.type.name !== 'orderedList') return false
      const cleared = Number.isInteger(node.attrs?.numberStart)
      const linkable = $pos.index() === 0 && parent.attrs?.continueFrom !== true && !!previousSiblingOrderedList(tr.doc, $pos.before())
      if (!cleared && !linkable) return false
      if (dispatch) {
        if (cleared) tr.setNodeMarkup(pos, node.type, { ...node.attrs, numberStart: null })
        if (linkable) tr.setNodeMarkup($pos.before(), parent.type, { ...parent.attrs, continueFrom: true })
      }
      return true
    },
  }
}
