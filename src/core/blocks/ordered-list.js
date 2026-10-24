/**
 * 有序列表：多一个 `continueFrom` 标记。
 *
 * 两个相邻的 `<ol>` 各自从 1 起算，飞书的「继续编号」能把它接到前一个列表后面。
 * 这里不落死数字，只记「这个列表接着前面的列表排」，序号仍由
 * computeOrderedListNumbers 每帧现算 —— 前一个列表增删条目时后面自动跟着变。
 */
import OrderedList from '@tiptap/extension-ordered-list'

const LarkDocOrderedList = OrderedList.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      continueFrom: {
        default: false,
        parseHTML: (el) => el.getAttribute('data-continue-from') === 'true',
        renderHTML: ({ continueFrom }) => (continueFrom ? { 'data-continue-from': 'true' } : {}),
      },
    }
  },
})

export { LarkDocOrderedList }
