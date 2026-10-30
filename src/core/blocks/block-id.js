/**
 * 块稳定标识（blockId）的全局属性。
 *
 * 所有「用户能当作一个块操作」的节点都带 `data-block-id`，落进 JSON 的 attrs 里，
 * 随文档一起保存/导入/导出。折叠集合、评论锚点、协同定位都按它引用块。
 * 结构性容器（listItem / tableRow / tableCell / column …）不编号：父块已经有 id。
 */
import { Extension } from '@tiptap/core'
import { BLOCK_ID_PATTERN, BLOCK_ID_TYPES } from '../documentOperations'
import { normalizeAsyncBlockState } from './shared'

const ASYNC_DOM_TYPES = new Set(['file', 'image', 'sheet', 'web-embed', 'bookmark', 'unknown-block'])

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
        asyncState: {
          default: null,
          parseHTML: (element) => {
            const domType = element.getAttribute('data-type')
            const blockType = element.getAttribute('data-block-type')
            if (!ASYNC_DOM_TYPES.has(domType) && !ASYNC_DOM_TYPES.has(blockType)) return null
            const raw = element.getAttribute('data-async-state')
            if (!raw) return null
            try { return JSON.stringify(normalizeAsyncBlockState(JSON.parse(raw))) } catch (_) { return null }
          },
          renderHTML: ({ asyncState }) => {
            if (!asyncState) return {}
            try { return { 'data-async-state': JSON.stringify(normalizeAsyncBlockState(typeof asyncState === 'string' ? JSON.parse(asyncState) : asyncState)) } } catch (_) { return {} }
          },
        },
      },
    }]
  },
})

export { LarkDocBlockId }
