/** 分栏容器：columns（2~5 列）+ column（宽度 10%~90%，flex 布局）。 */
import { Node, mergeAttributes } from '@tiptap/core'

const Columns = Node.create({
  name: 'columns', group: 'block', content: 'column{2,5}', defining: true, isolating: true,
  parseHTML() { return [{ tag: 'div[data-type="columns"]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'columns' }), 0] },
})

const Column = Node.create({
  name: 'column', content: 'block+', isolating: true,
  addAttributes() {
    return { width: {
      default: 50,
      parseHTML: (el) => { const width = Number(el.getAttribute('data-width')); return width >= 10 && width <= 90 ? width : 50 },
      renderHTML: ({ width }) => ({ 'data-width': width, style: `flex-basis: ${Math.max(10, Math.min(90, Number(width) || 50))}%` }),
    } }
  },
  parseHTML() { return [{ tag: 'div[data-type="column"]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'column' }), 0] },
})

export { Columns, Column }
