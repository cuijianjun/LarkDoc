/**
 * P2-03：粘贴图片地址成块。
 *
 * 02 §11 ② 的「增」有两条非文件路径：粘贴剪贴板图片（走 `@tiptap/extension-file-handler`）
 * 和**粘贴图片 URL**（没有文件，只有文本）。后者默认会被浏览器当纯文本粘成一行字，
 * 这里补一个粘贴拦截：命中图片地址且当前行是空段落时，把这一行直接换成图片块。
 *
 * 刻意收窄的三条边界（放宽任何一条都会误伤普通粘贴）：
 * 1. 只处理顶层空段落——用户在写了一半的行里粘地址，仍按文本插入；
 * 2. 只读 / 图片功能关掉时不拦，文本原样落地；
 * 3. 地址必须带图片扩展名或是 `data:image/*`，普通网页链接不转。
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { imageUrlFromText } from '../media/image-insert'

/** 插件 key：宿主排查粘贴链路时可按 key 取到本插件。 */
export const IMAGE_URL_PASTE_KEY = new PluginKey('larkDocImageUrlPaste')

/**
 * @param {object} [options]
 * @param {() => boolean} [options.enabled] 图片功能是否开启；缺省视为开启。
 */
export function imageUrlPasteExtension(options = {}) {
  const enabled = options.enabled
  return Extension.create({
    name: 'imageUrlPaste',
    addProseMirrorPlugins() {
      return [new Plugin({
        key: IMAGE_URL_PASTE_KEY,
        props: {
          handlePaste(view, event) {
            if (!view.editable) return false
            if (typeof enabled === 'function' && !enabled()) return false
            const { state } = view
            const { $from, empty } = state.selection
            // 非空选区 / 非文字块 / 块里有内容：都不是「空行粘贴」，交回默认行为。
            if (!empty || !$from.parent.isTextblock || $from.parent.content.size !== 0) return false
            // depth 1 = 文档顶层的段落；列表项、引用、callout 里换成块级图片会破坏
            // 父节点的 content 表达式（例如 listItem 要求 paragraph+），一律不转。
            if ($from.depth !== 1) return false
            const clipboard = event.clipboardData
            const text = clipboard && typeof clipboard.getData === 'function' ? clipboard.getData('text/plain') : ''
            const src = imageUrlFromText(text)
            const type = state.schema.nodes.image
            if (!src || !type) return false
            const from = $from.before($from.depth)
            view.dispatch(state.tr.replaceWith(from, from + $from.parent.nodeSize, type.create({ src, alt: null, title: null })).scrollIntoView())
            return true
          },
        },
      })]
    },
  })
}
