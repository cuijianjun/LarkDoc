/**
 * P2-03 图片插入链路：MIME 分流 / 粘贴图片地址 / 拖拽落点归一。
 *
 * 三层用例：
 * 1. 纯函数（core/media/image-insert.js）——不碰 DOM；
 * 2. 落点归一（nearestInsertPosition）——用真实 schema 造 doc，验证「拖到两块之间」
 *    和「拖到文档之外」这两种 FileHandler 真会给到的脏 pos 不会抛 RangeError；
 * 3. 粘贴插件（core/blocks/image-paste.js）——起真编辑器，直接调 handlePaste，
 *    验证「空段落 → 变图片块」以及三条不该拦的边界（有内容 / 只读 / 功能关）。
 */
// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Editor, getSchema } from '@tiptap/core'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import { IMAGE_URL_PASTE_KEY } from '../../src/core/blocks/image-paste'
import { UPLOAD_MIME_ALLOWLIST } from '../../src/core/media/upload'
import {
  IMAGE_MIME_ALLOWLIST, IMAGE_REJECT, formatImageSize, imageRejectMessage, imageUrlFromText,
  isImageMime, nearestInsertPosition, sortImageFiles,
} from '../../src/core/media/image-insert'

const makeFile = (type, size = 1024, name = `f.${String(type).split('/')[1] || 'bin'}`) => ({ name, type, size })

describe('isImageMime / 白名单', () => {
  it('四种图片格式通过，大小写不敏感', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'IMAGE/PNG', 'Image/Jpeg']) {
      expect(isImageMime(type)).toBe(true)
    }
  })

  it('svg / heic / 非图片 / 空值一律拒绝', () => {
    for (const type of ['image/svg+xml', 'image/heic', 'image/bmp', 'application/pdf', '', null, undefined]) {
      expect(isImageMime(type)).toBe(false)
    }
  })

  it('插入白名单与上传白名单不漂移', () => {
    // 两处各写一份是因为语义不同（一个管 schema 能渲染什么，一个管上传通道收什么），
    // 但用户眼里必须是同一组格式——分叉会让「能传上去却插不进来」。
    expect([...IMAGE_MIME_ALLOWLIST]).toEqual([...UPLOAD_MIME_ALLOWLIST])
  })
})

describe('formatImageSize / imageRejectMessage', () => {
  it('整数 MB 不留小数位，其余最多一位', () => {
    expect(formatImageSize(5 * 1024 * 1024)).toBe('5 MB')
    expect(formatImageSize(20 * 1024 * 1024)).toBe('20 MB')
    expect(formatImageSize(1.5 * 1024 * 1024)).toBe('1.5 MB')
    expect(formatImageSize(0)).toBe('0 MB')
    expect(formatImageSize(NaN)).toBe('0 MB')
  })

  it('文案与既有工具栏上传报错保持一致', () => {
    expect(imageRejectMessage(IMAGE_REJECT.MIME)).toBe('只支持 PNG/JPEG/GIF/WebP 图片')
    expect(imageRejectMessage(IMAGE_REJECT.SIZE, { maxSize: 2 * 1024 * 1024 })).toBe('单张图片不能超过 2 MB')
    expect(imageRejectMessage('其它')).toBe('图片插入失败')
  })
})

describe('sortImageFiles', () => {
  it('混入非图片只拒那一张，其余按原顺序通过', () => {
    const png = makeFile('image/png')
    const pdf = makeFile('application/pdf')
    const webp = makeFile('image/webp')
    const { accepted, rejected } = sortImageFiles([png, pdf, webp], { maxSize: 5 * 1024 * 1024 })
    expect(accepted).toEqual([png, webp])
    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toMatchObject({ file: pdf, code: IMAGE_REJECT.MIME })
    expect(rejected[0].message).toBe('只支持 PNG/JPEG/GIF/WebP 图片')
  })

  it('超限单张被拒，文案带上限', () => {
    const big = makeFile('image/png', 3 * 1024 * 1024)
    const { accepted, rejected } = sortImageFiles([big], { maxSize: 2 * 1024 * 1024 })
    expect(accepted).toHaveLength(0)
    expect(rejected[0]).toMatchObject({ code: IMAGE_REJECT.SIZE, message: '单张图片不能超过 2 MB' })
  })

  it('maxSize 缺省/0 表示不限；空入参退成两个空数组', () => {
    const big = makeFile('image/png', 99 * 1024 * 1024)
    expect(sortImageFiles([big], {}).accepted).toEqual([big])
    expect(sortImageFiles([big], { maxSize: 0 }).accepted).toEqual([big])
    expect(sortImageFiles(null)).toEqual({ accepted: [], rejected: [] })
    expect(sortImageFiles([null, undefined]).accepted).toEqual([])
  })
})

describe('imageUrlFromText', () => {
  it('认图片扩展名的 http(s) 地址（含签名参数）', () => {
    expect(imageUrlFromText('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png')
    expect(imageUrlFromText('  https://cdn.example.com/a.JPG  ')).toBe('https://cdn.example.com/a.JPG')
    expect(imageUrlFromText('https://cdn.example.com/a.jpeg?x=1&y=2#z')).toBe('https://cdn.example.com/a.jpeg?x=1&y=2#z')
    expect(imageUrlFromText('https://cdn.example.com/a.webp')).toBe('https://cdn.example.com/a.webp')
  })

  it('认 base64 内联小图', () => {
    const data = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='
    expect(imageUrlFromText(data)).toBe(data)
  })

  it('非图片 / 多行 / 危险协议一律不认', () => {
    expect(imageUrlFromText('https://cdn.example.com/a.svg')).toBeNull()
    expect(imageUrlFromText('https://cdn.example.com/page')).toBeNull()
    expect(imageUrlFromText('javascript:alert(1)')).toBeNull()
    expect(imageUrlFromText('data:image/svg+xml;base64,AAAA')).toBeNull()
    expect(imageUrlFromText('看这个 https://cdn.example.com/a.png')).toBeNull()
    expect(imageUrlFromText('https://cdn.example.com/a.png\nhttps://cdn.example.com/b.png')).toBeNull()
    expect(imageUrlFromText('')).toBeNull()
    expect(imageUrlFromText(null)).toBeNull()
  })
})

describe('nearestInsertPosition', () => {
  let schema
  let doc
  beforeAll(() => {
    schema = getSchema(createLarkDocExtensions())
    // 两个段落各 2 个字：p1 占 0–4（文字在 1,2），p2 占 4–8（文字在 5,6）。
    doc = schema.nodeFromJSON({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'ab' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'cd' }] },
      ],
    })
  })

  it('段落内部原样返回', () => {
    expect(nearestInsertPosition(doc, 5)).toBe(5)
  })

  it('落在两块之间时退到后一块的开头（拖到块缝里的真实现场）', () => {
    expect(nearestInsertPosition(doc, 4)).toBe(5)
  })

  it('超出文档时夹到末尾的文字位置，不抛 RangeError', () => {
    expect(nearestInsertPosition(doc, 9999)).toBe(7)
    expect(nearestInsertPosition(doc, -5)).toBe(1)
  })

  it('doc 不可用时返回 null，调用方按当前选区插入', () => {
    expect(nearestInsertPosition(null, 3)).toBeNull()
    expect(nearestInsertPosition({}, 3)).toBeNull()
  })
})

describe('粘贴图片地址成块', () => {
  /**
   * 直接调「本任务新增的那一个插件」的 handlePaste。
   * 不走 view.someProp 全链：兄弟插件的 handlePaste（FileHandler 读 clipboardData.files、
   * code-block 把纯文本当 JSON 解析）都要求真实浏览器 ClipboardEvent，jsdom 里造不出来，
   * 桩对象会在它们内部先炸，测不到本条链路。注册与否由 find 本身验证。
   */
  const runPaste = (editor, text) => {
    const plugin = editor.view.state.plugins.find((item) => item.key === IMAGE_URL_PASTE_KEY.key)
    expect(plugin).toBeTruthy()
    return plugin.props.handlePaste(editor.view, { clipboardData: { getData: () => text } })
  }

  it('空段落里粘图片地址 → 整行换成图片块', () => {
    const editor = new Editor({ extensions: createLarkDocExtensions(), content: { type: 'doc', content: [{ type: 'paragraph' }] } })
    try {
      expect(runPaste(editor, 'https://cdn.example.com/a.png')).toBe(true)
      const json = editor.getJSON()
      // 图片块后面跟的那个空段落是 StarterKit 的 trailingNode 补的（保证文档以文字块收尾），
      // 不是这次粘贴留下的——这里只断言「头一个块变成了图片、且地址没被当文本落下」。
      expect(json.content[0]).toMatchObject({ type: 'image', attrs: { src: 'https://cdn.example.com/a.png' } })
      // 地址没被当文本留下：除了图片块，其余都是空段落。
      expect(json.content.every((node) => node.type === 'image' || !node.content)).toBe(true)
    } finally { editor.destroy() }
  })

  it('已写字的行里粘地址不拦，仍按文本处理', () => {
    const editor = new Editor({ extensions: createLarkDocExtensions(), content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'abc' }] }] } })
    try {
      expect(runPaste(editor, 'https://cdn.example.com/a.png')).toBe(false)
      expect(editor.getJSON().content[0].content[0]).toMatchObject({ type: 'text', text: 'abc' })
    } finally { editor.destroy() }
  })

  it('只读时不拦（编辑器本身也不可编辑）', () => {
    const editor = new Editor({ extensions: createLarkDocExtensions(), editable: false, content: { type: 'doc', content: [{ type: 'paragraph' }] } })
    try {
      expect(runPaste(editor, 'https://cdn.example.com/a.png')).toBe(false)
      expect(editor.getJSON().content[0].type).toBe('paragraph')
    } finally { editor.destroy() }
  })

  it('图片功能关掉时不拦，普通网页链接也不拦', () => {
    const off = new Editor({ extensions: createLarkDocExtensions({ config: { features: { images: false } } }), content: { type: 'doc', content: [{ type: 'paragraph' }] } })
    const on = new Editor({ extensions: createLarkDocExtensions(), content: { type: 'doc', content: [{ type: 'paragraph' }] } })
    try {
      expect(runPaste(off, 'https://cdn.example.com/a.png')).toBe(false)
      expect(runPaste(on, 'https://cdn.example.com/page')).toBe(false)
      expect(on.getJSON().content[0].type).toBe('paragraph')
    } finally { off.destroy(); on.destroy() }
  })
})
