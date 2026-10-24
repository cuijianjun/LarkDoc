/** 高亮块（callout）：emoji 图标 + 背景/边框/文字色，全部经安全校验进 schema。 */
import { Node, mergeAttributes } from '@tiptap/core'
import { safeColor } from '../documentOperations'

const calloutEmojis = ['💡', '📌', '⚠️', '✅', '💬', '🎯', '🔥', '🌟', '😄', '❤️', '👍', '🎉']
const safeCalloutEmoji = (value) => calloutEmojis.includes(String(value)) ? String(value) : '💡'

const Callout = Node.create({
  name: 'callout', group: 'block', content: 'block+', defining: true,
  addAttributes() {
    return {
      backgroundColor: { default: null, parseHTML: (el) => safeColor(el.style.backgroundColor) ? el.style.backgroundColor : null, renderHTML: (attrs) => attrs.backgroundColor && safeColor(attrs.backgroundColor) ? { style: `background-color: ${attrs.backgroundColor}` } : {} },
      borderColor: { default: null, parseHTML: (el) => safeColor(el.style.borderColor) ? el.style.borderColor : null, renderHTML: (attrs) => attrs.borderColor && safeColor(attrs.borderColor) ? { style: `border-color: ${attrs.borderColor}` } : {} },
      color: { default: null, parseHTML: (el) => safeColor(el.style.color) ? el.style.color : null, renderHTML: (attrs) => attrs.color && safeColor(attrs.color) ? { style: `color: ${attrs.color}` } : {} },
      emoji: { default: '💡', validate: (value) => { if (!calloutEmojis.includes(String(value))) throw new Error('无效高亮块图标') }, parseHTML: (el) => safeCalloutEmoji(el.getAttribute('data-emoji')), renderHTML: (attrs) => ({ 'data-emoji': safeCalloutEmoji(attrs.emoji) }) },
    }
  },
  parseHTML() { return [{ tag: 'div[data-type="callout"]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'callout' }), 0] },
})

export { calloutEmojis, safeCalloutEmoji, Callout }
