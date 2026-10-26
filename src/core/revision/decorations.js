/**
 * 修订标记的视觉叠加层 —— requirements/07 §12.5「点正文里的修订标记 → 对应面板
 * 展开到 169 高并高亮」。
 *
 * 只做一件事：把「当前激活的那条建议」的区间打上 `.is-revision-active`，
 * 其余视觉（新增蓝字 + 下划线、删除线、hover 底）全部由 CSS 按 `data-revision-*`
 * 属性选，不进装饰层 —— 装饰层每次编辑都要重算，能少算一条就少算一条。
 *
 * 激活 id 存在 plugin state 里（不是模块变量）：换 id 必须走一次 `dispatch` 才能触发
 * 重绘，写模块变量在 Vue 的响应式之外，改了也不会重新渲染。
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { collectRevisions } from '../blocks/revision'

export const revisionActiveKey = new PluginKey('larkDocRevisionActive')

/** 激活态装饰集（`activeId` 为空即空集）。 */
export function buildRevisionDecorations(doc, activeId) {
  const id = String(activeId || '')
  if (!id) return DecorationSet.empty
  const items = collectRevisions(doc).filter((item) => item.revisionId === id)
  if (!items.length) return DecorationSet.empty
  const decorations = items
    .map((item) => Decoration.inline(item.from, item.to, { class: 'is-revision-active' }))
  return DecorationSet.create(doc, decorations)
}

export const revisionHighlightPlugin = new Plugin({
  key: revisionActiveKey,

  state: {
    init: () => '',
    apply(tr, value) {
      const next = tr.getMeta(revisionActiveKey)
      return typeof next === 'string' ? next : value
    },
  },

  props: {
    decorations(state) {
      const activeId = revisionActiveKey.getState(state)
      return activeId ? buildRevisionDecorations(state.doc, activeId) : DecorationSet.empty
    },
  },
})

/** 把「激活某条建议」包成一次不进历史的 setMeta 事务（可选滚动到该段）。 */
export function buildRevisionActiveTr(state, activeId) {
  const tr = state.tr
  tr.setMeta(revisionActiveKey, String(activeId || ''))
  tr.setMeta('addToHistory', false)
  return tr
}

/** 装饰层的扩展外壳（Tiptap 只认 Extension，裸 Plugin 要包一层才挂得上）。 */
export const LarkDocRevisionHighlight = Extension.create({
  name: 'larkDocRevisionHighlight',
  addProseMirrorPlugins() {
    return [revisionHighlightPlugin]
  },
})

export default LarkDocRevisionHighlight
