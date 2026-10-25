/**
 * 引用块（P1-01，09 §5.2）：容器语义确认 + quote_container 历史命名兼容读取。
 *
 * - schema 沿用 StarterKit Blockquote 的容器定义（content: 'block+'），引用
 *   内可放段落 / 标题 / 列表 / 表格 / 代码块 / 图片等任意块；
 * - renderHTML 仍输出 <blockquote>（02 §8 收口定判：飞书 data-block-type
 *   实测即 blockquote，quote_container 是 lark-doc 0.11 的历史命名，同指一物）；
 * - parseHTML 追加 div[data-type="quote_container"]，旧命名 JSON 继续可读，
 *   新写入一律归一为 blockquote（JSON 层迁移在 P1-04 落地）。
 */
import Blockquote from '@tiptap/extension-blockquote'
import { selectionTouchesContainer, wrapContainerAllowed } from './container-depth'

export const LarkDocBlockquote = Blockquote.extend({
  parseHTML() {
    return [
      { tag: 'blockquote' },
      { tag: 'div[data-type="quote_container"]' },
    ]
  },
  // P1-05：toggleBlockquote 命令层深度守卫（覆盖快捷键 Mod-Shift-B 与全部菜单入口）。
  // toggle 语义下选区已触及引用 = 本次多半是拆引用（只减深度），放行；
  // 纯非引用区 = 套引用，按容器嵌套上限判定。
  addCommands() {
    const parentCommands = this.parent?.() ?? {}
    return {
      toggleBlockquote: (...args) => (props) => {
        const { state } = props
        const { from, to } = state.selection
        if (!selectionTouchesContainer(state, 'blockquote') && !wrapContainerAllowed(state, from, to, 1)) return false
        return parentCommands.toggleBlockquote?.(...args)?.(props) ?? false
      },
    }
  },
})
