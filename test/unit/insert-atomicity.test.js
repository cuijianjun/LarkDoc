/**
 * P2 验收（09 §5.2 行「上传失败不产生半截节点」）。
 *
 * P2-01 ~ P2-05 的插入链都是「先上传成功、再落块」：图片走
 * `resolveImageFile` → `setImage`，文件走 `resolveFile` → `setFileBlock`。
 * 这条顺序只在一处可能漏：**上传结果不合格却仍然构造出了块属性**。
 * 所以这里不测组件循环，只守最后那道闸门 —— 属性不合格时命令必须返回
 * false、文档长度必须一动不动，别在正文里留半个空块。
 *
 * 出网策略的三档断言在 `network-policy.test.js`，不在这里重复。
 */
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import { fileBlockAttrs } from '../../src/core/media/file-block'

const emptyDoc = () => ({ type: 'doc', content: [{ type: 'paragraph' }] })

function mount() {
  return new Editor({ extensions: createLarkDocExtensions(), content: emptyDoc() })
}

/** 当前文档里的块类型快照 —— 用来证明「没多出任何节点」。 */
const blockTypes = (editor) => editor.getJSON().content.map((node) => node.type)

describe('P2 验收：上传失败不产生半截节点', () => {
  it('图片：上传结果没有有效地址，setImage 被拒，文档一个节点都不多', () => {
    const editor = mount()
    try {
      const before = blockTypes(editor)
      expect(editor.chain().setImage({ src: null, attchId: 'a1' }).run()).toBe(false)
      expect(editor.chain().setImage({ src: '', attchId: 'a1' }).run()).toBe(false)
      // 上传通道被中间人改写成脚本地址时同样不许落块。
      expect(editor.chain().setImage({ src: 'javascript:alert(1)', attchId: 'a1' }).run()).toBe(false)
      expect(blockTypes(editor)).toEqual(before)
    } finally { editor.destroy() }
  })

  it('图片：地址合法才落块（对照项，证明上面拒的是地址而不是命令本身）', () => {
    const editor = mount()
    try {
      expect(editor.chain().setImage({ src: 'https://cdn.example.com/a.png', attchId: 'a1' }).run()).toBe(true)
      expect(blockTypes(editor).filter((type) => type === 'image')).toHaveLength(1)
    } finally { editor.destroy() }
  })

  it('文件：宿主既没给直链也没给 attchId，块属性全空，setFileBlock 被拒', () => {
    const editor = mount()
    try {
      const before = blockTypes(editor)
      const attrs = fileBlockAttrs({ name: 'a.mp4', type: 'video/mp4', size: 40016 }, {})
      expect(attrs.src).toBeNull()
      expect(attrs.token).toBeNull()
      expect(editor.chain().setFileBlock(attrs).run()).toBe(false)
      expect(blockTypes(editor)).toEqual(before)
    } finally { editor.destroy() }
  })

  it('文件：只给 attchId 的宿主照样能落块（token 换票是合法路径，不算半截）', () => {
    const editor = mount()
    try {
      const attrs = fileBlockAttrs({ name: 'a.pdf', type: 'application/pdf', size: 1024 }, { attchId: 'boxcn1' })
      expect(editor.chain().setFileBlock(attrs).run()).toBe(true)
      const node = editor.getJSON().content.find((item) => item.type === 'fileBlock')
      expect(node.attrs).toMatchObject({ token: 'boxcn1', src: null, name: 'a.pdf', mimeType: 'application/pdf', viewType: 'Preview' })
    } finally { editor.destroy() }
  })

  it('文件：上传返回的 url 非法时，token 退用 url 也不能把块救回来', () => {
    const editor = mount()
    try {
      const before = blockTypes(editor)
      const attrs = fileBlockAttrs({ name: 'a.zip', type: 'application/zip', size: 1024 }, { url: 'javascript:alert(1)' })
      // token 会退用 url，但两个字段都过不了 safeUrl —— 命令必须整体拒绝。
      expect(editor.chain().setFileBlock(attrs).run()).toBe(false)
      expect(blockTypes(editor)).toEqual(before)
    } finally { editor.destroy() }
  })
})
