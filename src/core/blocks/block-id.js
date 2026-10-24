/**
 * 块稳定标识（blockId）的全局属性。
 *
 * 所有「用户能当作一个块操作」的节点都带 `data-block-id`，落进 JSON 的 attrs 里，
 * 随文档一起保存/导入/导出。折叠集合、评论锚点、协同定位都按它引用块。
 * 结构性容器（listItem / tableRow / tableCell / column …）不编号：父块已经有 id。
 */
import { Extension } from '@tiptap/core'
import { BLOCK_ID_PATTERN, BLOCK_ID_TYPES } from '../documentOperations'

const LarkDocBlockId = Extension.create({
  name: 'larkDocBlockId',
  addGlobalAttributes() {
    return [{
      types: Array.from(BLOCK_ID_TYPES),
      attributes: {
        blockId: {
          default: null,
          parseHTML: (element) => {
            const id = element.getAttribute('data-block-id')
            return id && BLOCK_ID_PATTERN.test(id) ? id : null
          },
          renderHTML: ({ blockId }) => (typeof blockId === 'string' && BLOCK_ID_PATTERN.test(blockId) ? { 'data-block-id': blockId } : {}),
        },
      },
    }]
  },
})

export { LarkDocBlockId }
