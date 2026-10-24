/**
 * 列表项的起始编号（等价 HTML `<li value="N">`）。
 *
 * 飞书里列表序号是可点的块级 UI，「重新开始编号 / 设置编号的值」作用在单个 item 上。
 * 这里只在这个 item 上记一个起点，编号串本身仍由 computeOrderedListNumbers
 * 每帧现算 —— 删除、移动、插入后编号自动接上，不需要补丁事务。
 */
import { Extension } from '@tiptap/core'
import { clampHeadingNumberStart } from '../documentOperations'

const LarkDocListItemNumber = Extension.create({
  name: 'larkDocListItemNumber',
  addGlobalAttributes() {
    return [{
      types: ['listItem'],
      attributes: {
        numberStart: {
          default: null,
          parseHTML: (element) => {
            const value = Number(element.getAttribute('value'))
            return Number.isFinite(value) && value > 0 ? clampHeadingNumberStart(value) : null
          },
          renderHTML: ({ numberStart }) => (Number(numberStart) > 0 ? { value: clampHeadingNumberStart(numberStart) } : {}),
        },
      },
    }]
  },
})

export { LarkDocListItemNumber }
