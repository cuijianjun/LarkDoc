/**
 * P1-02 标题容器（09 §5.2）。
 *
 * 飞书标题块是容器（heading-children 收进子块，02 §2）；v2 容器形态 JSON 允许
 * heading 节点携带 children 数组。
 * - 读取兼容（第一步）：validateDocument 入口的 flattenHeadingContainers 把容器
 *   展平为等价扁平 JSON——老 JSON 不受影响，容器 JSON 不丢数据，安全性不放宽。
 * - 写入切换 + 迁移（第二步 + P1-04）：写入侧（组件 getJSON / 文档记录 / JSON
 *   导出）输出容器形态，DOCUMENT_SCHEMA_VERSION 1→2，v1→v2 迁移注册在
 *   migrations.js，载入侧（草稿 / 快照 / JSON 导入 / 信封）经 migrateRecordContent
 *   自动迁移。
 */
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { Editor, getSchema } from '@tiptap/core'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import { flattenHeadingContainers, aggregateHeadingContainers, validateDocument } from '../../src/core/documentOperations'
import { migrateDocument, migrateRecordContent } from '../../src/core/migrations'
import { DOCUMENT_SCHEMA_VERSION } from '../../src/core/documentSchema'
import { createDocumentSession } from '../../src/session/DocumentSession'

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
            // H2 之后、无更浅标题终结 → 按 02 §2 归入 H2 分节（聚合口径，09 §5.2）。
            { type: 'paragraph', attrs: { blockId: 'p3' }, content: [{ type: 'text', text: 'H2 分节内的段落' }] },
          ],
        },
      ],
    },
  ],
})

/** 上面容器形态的等价扁平 JSON（v1 历史写入模型 = 编辑器内部模型；v2 写入侧已切容器形态）。 */
const flatDoc = () => ({
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1, blockId: 'h1' }, content: [{ type: 'text', text: '一级标题' }] },
    { type: 'paragraph', attrs: { blockId: 'p1' }, content: [{ type: 'text', text: '子段落' }] },
    { type: 'heading', attrs: { level: 2, blockId: 'h2' }, content: [{ type: 'text', text: '二级标题' }] },
    { type: 'paragraph', attrs: { blockId: 'p2' }, content: [{ type: 'text', text: '孙段落' }] },
    { type: 'paragraph', attrs: { blockId: 'p3' }, content: [{ type: 'text', text: 'H2 分节内的段落' }] },
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

describe('P1-02 第二步 + P1-04：扁平→容器聚合与迁移链', () => {
  it('聚合是展平的逆：flatDoc 聚合回 containerDoc（逐字节一致）', () => {
    expect(aggregateHeadingContainers(flatDoc())).toEqual(containerDoc())
  })

  it('容器形态输入幂等：已聚合文档再聚合无变化', () => {
    expect(aggregateHeadingContainers(containerDoc())).toEqual(containerDoc())
  })

  it('往返无损：迁移（聚合）后再展平，与原始扁平文档一致', () => {
    expect(flattenHeadingContainers(migrateDocument(flatDoc(), 1))).toEqual(flatDoc())
  })

  it('缩进块不额外嵌套：attrs.indent 原样保留为标题子块', () => {
    const indented = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1, blockId: 'h1' }, content: [{ type: 'text', text: '标题' }] },
        { type: 'paragraph', attrs: { blockId: 'p1', indent: 2 }, content: [{ type: 'text', text: '缩进二' }] },
        { type: 'paragraph', attrs: { blockId: 'p2', indent: 1 }, content: [{ type: 'text', text: '缩进一' }] },
      ],
    }
    const aggregated = aggregateHeadingContainers(indented)
    expect(aggregated.content).toHaveLength(1)
    expect(aggregated.content[0].children.map((child) => child.attrs.indent)).toEqual([2, 1])
  })

  it('同级标题各自分节：H1 的分节在下一个同级标题处终结', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1, blockId: 'h1' }, content: [{ type: 'text', text: '甲' }] },
        { type: 'paragraph', attrs: { blockId: 'pa' }, content: [{ type: 'text', text: '甲的子块' }] },
        { type: 'heading', attrs: { level: 1, blockId: 'h1b' }, content: [{ type: 'text', text: '乙' }] },
        { type: 'paragraph', attrs: { blockId: 'pb' }, content: [{ type: 'text', text: '乙的子块' }] },
      ],
    }
    const aggregated = aggregateHeadingContainers(doc)
    expect(aggregated.content).toHaveLength(2)
    expect(aggregated.content[0].children.map((child) => child.attrs.blockId)).toEqual(['pa'])
    expect(aggregated.content[1].children.map((child) => child.attrs.blockId)).toEqual(['pb'])
  })

  it('聚合为纯函数：不修改入参', () => {
    const source = flatDoc()
    const probe = JSON.parse(JSON.stringify(source))
    aggregateHeadingContainers(source)
    expect(JSON.stringify(source)).toEqual(JSON.stringify(probe))
  })

  it('迁移链：migrateDocument 从 v1 迁出容器形态；声明 v2 的记录直通', () => {
    expect(migrateDocument(flatDoc(), 1)).toEqual(containerDoc())
    expect(migrateDocument(containerDoc(), 1, 2)).toEqual(containerDoc())
  })

  it('迁移链缺失报错：版本 0 没有迁移步骤时抛错，不静默丢数据', () => {
    expect(() => migrateDocument(flatDoc(), 0)).toThrow('缺少文档 Schema 0 到 1 的迁移')
  })

  it('migrateRecordContent：缺版本号按 v1 处理，v2 直通', () => {
    expect(migrateRecordContent(flatDoc(), undefined)).toEqual(containerDoc())
    expect(migrateRecordContent(containerDoc(), 2)).toEqual(containerDoc())
  })

  it('DOCUMENT_SCHEMA_VERSION 已升到 2（v2 = 标题容器形态）', () => {
    expect(DOCUMENT_SCHEMA_VERSION).toBe(2)
  })

  it('DocumentSession.getDocumentRecord：正文聚合为容器形态且 schemaVersion=2', () => {
    const session = createDocumentSession({ documentId: 'doc-1' })
    session.attachEditor({ getJSON: () => flatDoc() })
    const record = session.getDocumentRecord({ title: '聚合' })
    expect(record.schemaVersion).toBe(2)
    expect(record.content).toEqual(containerDoc())
  })
})
