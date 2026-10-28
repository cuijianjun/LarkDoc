/** 标题块：一~九级标题 + 飞书式标题编号（numbering / numberingStart）。 */
import { mergeAttributes } from '@tiptap/core'
import Heading from '@tiptap/extension-heading'
import { clampHeadingNumberStart } from '../documentOperations'
import { levels, validateAttribute } from './shared'

const LarkDocHeading = Heading.extend({
  addAttributes() {
    return {
      level: { default: 1, rendered: false, validate: validateAttribute('heading.level', (value) => levels.includes(value)) },
      // 标题编号 = 飞书里「把标题设为有序列表」，默认关闭（飞书新建标题也不带编号）。
      numbering: {
        default: false,
        parseHTML: (el) => el.getAttribute('data-numbering') === 'true',
        renderHTML: ({ numbering }) => (numbering ? { 'data-numbering': 'true' } : {}),
      },
      // 「重新开始编号 / 设置编号的值」的起点；null = 继续（跟着前序同级标题排）。
      numberingStart: {
        default: null,
        parseHTML: (el) => clampHeadingNumberStart(el.getAttribute('data-numbering-start')),
        renderHTML: ({ numberingStart }) => {
          const start = clampHeadingNumberStart(numberingStart)
          return start ? { 'data-numbering-start': start } : {}
        },
      },
    }
  },
  parseHTML() {
    return levels.map((level) => ({ tag: level <= 6 ? `h${level}` : `div[data-type="heading"][data-level="${level}"]`, attrs: { level } }))
  },
  renderHTML({ node, HTMLAttributes }) {
    const level = levels.includes(node.attrs.level) ? node.attrs.level : 1
    return level <= 6 ? [`h${level}`, HTMLAttributes, 0] : ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'heading', 'data-level': level }), 0]
  },
}).configure({ levels })

export { LarkDocHeading }
