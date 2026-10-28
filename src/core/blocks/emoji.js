/** 行内 emoji 节点：data-name 记名字，渲染成统一字形，未知名字回退 `:name:`。 */
import { Node, mergeAttributes } from '@tiptap/core'
import { findEmojiByName, normalizeEmojiName } from '../emoji/catalog'

// 与 0.11 及以前落库的默认值保持一致，不改 schema 快照。
const EMOJI_DEFAULT_NAME = 'smile'

// 查不到字形时返回空串，由调用方决定回退形态（行内节点回退 `:name:` 纯文本）。
// 不用 fallback 图：多带一份资源；不用空白占位：用户会以为图标"消失"了。
const emojiGlyph = (name) => {
  const item = findEmojiByName(name)
  return item ? item.glyph : ''
}

const LarkDocEmoji = Node.create({
  name: 'emoji',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      // 归一化（小写 + 去首尾冒号 + 截 64）只在**落库那一侧**做，所以 `data-name` 永远是
      // 干净的；但 `null`（属性缺失）与 `''`（属性为空）要分开保持 —— 前者渲染 `:null:`、
      // 后者渲染 `::`，混成一个就没法自愈脏数据了。
      name: {
        default: EMOJI_DEFAULT_NAME,
        parseHTML: (el) => el.getAttribute('data-name'),
        renderHTML: (attrs) => (attrs.name === null ? {} : { 'data-name': normalizeEmojiName(attrs.name) }),
      },
    }
  },
  parseHTML() { return [{ tag: 'span[data-type="emoji"]' }] },
  renderHTML({ node, HTMLAttributes }) {
    const raw = node.attrs.name
    const attrs = mergeAttributes(HTMLAttributes, { 'data-type': 'emoji', class: 'lark-doc-emoji' })
    // 未收录 / 拼错 / 空值一律原样回显成 `:name:`，不抛错、不阻断整篇渲染。
    if (raw === null) return ['span', attrs, ':null:']
    const name = normalizeEmojiName(raw === undefined ? EMOJI_DEFAULT_NAME : raw)
    const glyph = emojiGlyph(name)
    return ['span', attrs, glyph || `:${name}:`]
  },
  addCommands() {
    return {
      setEmoji: (name) => ({ commands }) => commands.insertContent({
        type: this.name, attrs: { name: normalizeEmojiName(name) || EMOJI_DEFAULT_NAME },
      }),
    }
  },
})

export { EMOJI_DEFAULT_NAME, emojiGlyph, LarkDocEmoji }
