/** 未知块占位卡（unknownBlock）：P1-03 降级显示，04 §8.3 降级卡统一 chrome。
 *
 * 新版本文档里的未知块类型在载入时（validateDocument）被就地替换为占位卡：
 * 原始块 JSON 逐字节存进 payload（JSON.stringify 保序，stringify/parse 幂等），
 * 导出侧经 restoreUnknownBlocks 还原，编辑侧只渲染灰底虚线卡片。
 */
import { Node, mergeAttributes } from '@tiptap/core'
import { UNKNOWN_PAYLOAD_MAX } from '../documentOperations'

const UnknownBlock = Node.create({
  name: 'unknownBlock', group: 'block', atom: true, selectable: true,
  addAttributes() {
    return {
      payload: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-unknown-payload') || '',
        renderHTML: (attrs) => ({ 'data-unknown-payload': attrs.payload }),
        validate: (value) => { if (typeof value !== 'string' || value.length > UNKNOWN_PAYLOAD_MAX || value.includes('\u0000')) throw new Error('无效的未知块载荷') },
      },
      unknownType: {
        default: 'unknown',
        parseHTML: (el) => el.getAttribute('data-unknown-type') || 'unknown',
        renderHTML: (attrs) => ({ 'data-unknown-type': attrs.unknownType }),
        validate: (value) => { if (typeof value !== 'string' || !value || value.length > 100 || value.includes('\u0000')) throw new Error('无效的未知块类型') },
      },
    }
  },
  parseHTML() { return [{ tag: 'div[data-type="unknown-block"]' }] },
  // atom 节点：整个卡片 DOM 由 renderHTML 一次给出，无 contentDOM。
  renderHTML({ node }) {
    return ['div', mergeAttributes({ 'data-type': 'unknown-block', class: 'lark-doc-unknown-card' }), [
      ['span', { class: 'lark-doc-unknown-card-icon', 'aria-hidden': 'true' }],
      ['span', { class: 'lark-doc-unknown-card-text' }, [
        ['span', { class: 'lark-doc-unknown-card-title' }, '暂不支持显示的内容块'],
        ['span', { class: 'lark-doc-unknown-card-sub' }, `原始类型：${String(node.attrs.unknownType || 'unknown')}`],
      ]],
    ]]
  },
})

export { UnknownBlock }
