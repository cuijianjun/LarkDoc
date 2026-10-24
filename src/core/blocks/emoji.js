/** 行内 emoji 节点：data-name 记名字，渲染成统一字形，未知名字回退 `:name:`。 */
import { Node, mergeAttributes } from '@tiptap/core'

const EMOJI_GLYPHS = {
  smile: '😄', heart: '❤️', thumbsup: '👍', tada: '🎉', pin: '📌', warning: '⚠️',
  check: '✅', comment: '💬', target: '🎯', fire: '🔥', star: '🌟',
}

const LarkDocEmoji = Node.create({
  name: 'emoji',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { name: { default: 'smile', parseHTML: (el) => el.getAttribute('data-name') || 'smile', renderHTML: ({ name }) => ({ 'data-name': String(name || 'smile').slice(0, 64) }) } }
  },
  parseHTML() { return [{ tag: 'span[data-type="emoji"]' }] },
  renderHTML({ node, HTMLAttributes }) {
    const name = String(node.attrs.name || 'smile').replace(/^:|:$/g, '').toLowerCase()
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'emoji', class: 'lark-doc-emoji' }), EMOJI_GLYPHS[name] || `:${name}:`]
  },
  addCommands() {
    return { setEmoji: (name) => ({ commands }) => commands.insertContent({ type: this.name, attrs: { name: String(name || 'smile').replace(/^:|:$/g, '').toLowerCase() } }) }
  },
})

export { EMOJI_GLYPHS, LarkDocEmoji }
