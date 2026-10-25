/**
 * P1-02 第一步：标题容器读取兼容（09 §5.2「先做容器读取兼容，再切写入」）。
 *
 * 飞书标题块是容器（heading-children 收进子块，02 §2）；容器形态 JSON 允许
 * heading 节点携带 children 数组。写入侧目前仍是 v1 扁平模型，因此读取边界
 * （validateDocument 入口的 flattenHeadingContainers）把容器展平为等价扁平
 * JSON：老 JSON 不受影响，容器 JSON 不丢数据，安全性不放宽。
 * 写入切换（第二步）与 schema 版本 1→2 在 P1-04 收口。
 */
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { Editor, getSchema } from '@tiptap/core'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import { flattenHeadingContainers, validateDocument } from '../../src/core/documentOperations'

const schema = getSchema(createLarkDocExtensions())

/** 容器形态的标题（v2 预定义：heading.children = 子块数组，嵌套标题同样带 children）。 */
const containerDoc = () => ({
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 1, blockId: 'h1' },
      content: [{ type: 'text', text: '一级标题' }],
      children: [
        { type: 'paragraph', attrs: { blockId: 'p1' }, content: [{ type: 'text', text: '子段落' }] },
        {
          type: 'heading',
          attrs: { level: 2, blockId: 'h2' },
          content: [{ type: 'text', text: '二级标题' }],
          children: [
            { type: 'paragraph', attrs: { blockId: 'p2' }, content: [{ type: 'text', text: '孙段落' }] },
          ],
        },
      ],
    },
    { type: 'paragraph', attrs: { blockId: 'p3' }, content: [{ type: 'text', text: '标题外的段落' }] },
  ],
})

/** 上面容器形态的等价扁平 JSON（v1 现行写入模型）。 */
const flatDoc = () => ({
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1, blockId: 'h1' }, content: [{ type: 'text', text: '一级标题' }] },
    { type: 'paragraph', attrs: { blockId: 'p1' }, content: [{ type: 'text', text: '子段落' }] },
    { type: 'heading', attrs: { level: 2, blockId: 'h2' }, content: [{ type: 'text', text: '二级标题' }] },
    { type: 'paragraph', attrs: { blockId: 'p2' }, content: [{ type: 'text', text: '孙段落' }] },
    { type: 'paragraph', attrs: { blockId: 'p3' }, content: [{ type: 'text', text: '标题外的段落' }] },
  ],
})

describe('P1-02 标题容器读取兼容（flattenHeadingContainers）', () => {
  it('容器形态展平：子块按原顺序拼接到标题之后，attrs 逐个保留', () => {
    expect(flattenHeadingContainers(containerDoc())).toEqual(flatDoc())
  })

  it('嵌套标题递归展开：H1 的 children 里 H2 自带的 children 一并平铺', () => {
    const flat = flattenHeadingContainers(containerDoc())
    const types = flat.content.map((node) => node.type)
    expect(types).toEqual(['heading', 'paragraph', 'heading', 'paragraph', 'paragraph'])
    expect(flat.content[1].attrs.blockId).toBe('p1')
    expect(flat.content[3].attrs.blockId).toBe('p2')
  })

  it('老 JSON 幂等：扁平文档过一遍展平无变化（老 JSON 仍能读）', () => {
    expect(flattenHeadingContainers(flatDoc())).toEqual(flatDoc())
  })

  it('children 为空数组 / 非数组：字段丢弃，按普通标题处理', () => {
    const empty = flattenHeadingContainers({
      type: 'doc',
      content: [{ type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: '空容器' }], children: [] }],
    })
    expect(empty.content[0].children).toBeUndefined()
    const junk = flattenHeadingContainers({
      type: 'doc',
      content: [{ type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: '坏容器' }], children: 'oops' }],
    })
    expect(junk.content[0].children).toBeUndefined()
  })

  it('纯函数：不修改入参（深冻结后调用不抛错、结果与冻结前一致）', () => {
    const frozen = JSON.parse(JSON.stringify(containerDoc()))
    const probe = JSON.parse(JSON.stringify(containerDoc()))
    const deepFreeze = (value) => {
      if (value && typeof value === 'object') Object.values(value).forEach(deepFreeze)
      return Object.freeze(value)
    }
    deepFreeze(frozen)
    expect(flattenHeadingContainers(frozen)).toEqual(flattenHeadingContainers(probe))
    expect(JSON.stringify(frozen)).toEqual(JSON.stringify(probe))
  })

  it('端到端：容器 JSON 经 validateDocument 载入后与扁平等价文档逐字节一致', () => {
    const loaded = validateDocument(containerDoc(), schema)
    expect(loaded).toEqual(validateDocument(flatDoc(), schema))
    const editor = new Editor({ extensions: createLarkDocExtensions(), content: loaded })
    expect(editor.state.doc.childCount).toBe(5)
    expect(editor.state.doc.child(0).type.name).toBe('heading')
    expect(editor.state.doc.child(3).textContent).toBe('孙段落')
    editor.destroy()
  })

  it('校验白名单不放宽：非 heading 节点携带 children 仍被拒绝', () => {
    expect(() => validateDocument({
      type: 'doc',
      content: [{ type: 'paragraph', children: [{ type: 'paragraph' }] }],
    }, schema)).toThrow('不支持的节点字段：children')
  })
})
