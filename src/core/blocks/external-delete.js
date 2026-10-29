/**
 * 外部服务块的 Delete 收口（17 §17.5 表头：**Delete 对块一律放行，统一走
 * `BlockModuleAPI.remove`**）。
 *
 * 为什么不靠 ProseMirror 默认：`baseKeymap` 的 `Backspace` / `Delete` 走 `deleteSelection` /
 * `joinBackward`，本质是**直接 `tr.delete`** —— 绕开了 `remove()` 里的 `expandDeletion`
 * （列表项 / 容器按语义上提子块）与 `closeHistory()`（一次删除 = 一步撤销）。§17.5 要求
 * 所有删除路径收口到 `remove`，所以这里用更高的 `priority` 抢在 baseKeymap 之前。
 *
 * 仓库内实测**只有两条**真实的删除路径（`grep` 已核）：
 *   1. 整块选中（点卡片 / 方向键走到 atom）后按 `Backspace` / `Delete`；
 *   2. 光标在紧邻段落的行首 / 行尾按 `Backspace` / `Delete` —— PM 会 `joinBackward` 把卡片吞掉。
 *
 * 「命令条 delete」在本仓库不存在（没有块菜单删除按钮）；`replaceSelection` / `insertAll`
 * 也没有覆盖删除的调用点（`insertAll` 只做新建，且已过 `assertExternalOperation(kind,'create')`
 * 闸门）。日后加块菜单删除时，直接调 `createBlockApi().remove(id)`，**不要**再写第二套删除。
 */
import { Extension } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { blockEntry, createBlockApi, inTableContext } from '../blockApi'

/**
 * 节点类型名 —— 必须与 `core/blocks/external-block.js` 的 `name: 'externalBlock'` 一致。
 *
 * 注意 `isExternalBlockType()` 是 `isExternalKind()` 的别名，收的是 **kind**
 * （`jira_issue` / `board` …），拿它判节点类型名会恒为 false。
 */
const EXTERNAL_BLOCK_NODE = 'externalBlock'

const isExternalNode = (node) => !!node && node.type.name === EXTERNAL_BLOCK_NODE

/**
 * 当前按键会删掉哪个 externalBlock —— 纯函数，便于单测。
 *
 * @param {import('prosemirror-model').Node} doc
 * @param {import('prosemirror-state').Selection} selection
 * @param {'Backspace'|'Delete'} key
 * @returns {string[]} 待删 blockId（空数组 = 这次按键与外部块无关，交回 PM 默认处理）
 */
export function externalDeleteTargets(doc, selection, key) {
  if (!doc || !selection) return []
  const idOf = (node) => {
    const id = node && node.attrs ? node.attrs.blockId : ''
    return typeof id === 'string' && id ? id : ''
  }
  // 路径 1：整块选中。
  if (selection instanceof NodeSelection) {
    const node = selection.node
    if (!node || !isExternalNode(node)) return []
    const id = idOf(node)
    return id ? [id] : []
  }
  // 路径 2：只在**根层**判定（深度 > 1 的段落归各自的容器管，别在这里猜）。
  if (!selection.empty || selection.$from.depth !== 1) return []
  const $from = selection.$from
  const atStart = $from.parentOffset === 0
  const atEnd = $from.parentOffset === $from.parent.content.size
  if (key === 'Backspace' && !atStart) return []
  if (key === 'Delete' && !atEnd) return []
  const index = $from.index(0) + (key === 'Backspace' ? -1 : 1)
  if (index < 0 || index >= doc.childCount) return []
  const sibling = doc.child(index)
  if (!isExternalNode(sibling)) return []
  const id = idOf(sibling)
  return id ? [id] : []
}

/**
 * 键盘收口：命中外部服务块就改走 `remove`，返回 `true` 让 PM 别再 `joinBackward`。
 *
 * `priority: 1001` 与 `document.js`（1000）同量级、都高于 baseKeymap 的默认 100 ——
 * 谁先注册谁先拿到 `handleKeyDown`，这里必须比 `StarterKit` 的键位更早。
 */
export const LarkDocExternalDelete = Extension.create({
  name: 'larkDocExternalDelete',
  priority: 1001,

  addKeyboardShortcuts() {
    const removeOn = (key) => () => {
      const editor = this.editor
      if (!editor || !editor.isEditable) return false
      const { doc, selection } = editor.state
      // 表格骨架里的块 `remove()` 本来就不动（`inTableContext`），这种块交回 PM 默认，
      // 免得按了键什么都不发生 —— 宁可维持旧行为，也不做「静默吃掉按键」。
      const ids = externalDeleteTargets(doc, selection, key).filter((id) => {
        const entry = blockEntry(doc, id)
        return entry && !inTableContext(doc, entry)
      })
      if (!ids.length) return false
      const api = createBlockApi({ editor })
      ids.forEach((id) => api.remove(id))
      return true
    }
    return { Backspace: removeOn('Backspace'), Delete: removeOn('Delete') }
  },
})

export default LarkDocExternalDelete
