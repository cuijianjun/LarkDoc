/**
 * P1-03 未知块占位卡：载入降级、payload 逐字节保真、导出还原。
 *
 * 新版本文档里的未知块类型在 validateDocument（载入必经入口）被就地替换为
 * unknownBlock 占位卡：原始 JSON 存进 payload（JSON.stringify 保 key 顺序），
 * 导出侧 restoreUnknownBlocks 还原——一来一回不丢字节。
 */
// @vitest-environment jsdom
import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { beforeAll, describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import { DOMSerializer } from '@tiptap/pm/model'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import { validateDocument, restoreUnknownBlocks, UNKNOWN_PAYLOAD_MAX } from '../../src/core/documentOperations'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

let schema
beforeAll(() => {
  schema = getSchema(createLarkDocExtensions())
})

// 刻意用非字母序 key，守「JSON.stringify 保序 → 还原逐字节一致」。
const rawUnknown = { type: 'knightBlock', attrs: { variant: 'wide', customId: 'abc' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '未知块内部文本' }] }] }

describe('unknownBlock 降级（validateDocument 拦截）', () => {
  it('顶层未知块被替换为占位卡，payload 逐字节保真', () => {
    const json = { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: '前文' }] },
      rawUnknown,
      { type: 'paragraph', content: [{ type: 'text', text: '后文' }] },
    ] }
    const out = validateDocument(json, schema)
    const card = out.content[1]
    expect(card.type).toBe('unknownBlock')
    expect(card.attrs.unknownType).toBe('knightBlock')
    expect(card.attrs.payload).toBe(JSON.stringify(rawUnknown))
    // 前后块原样保留
    expect(out.content[0].type).toBe('paragraph')
    expect(out.content[2].type).toBe('paragraph')
  })

  it('容器形态（heading.children）内的未知块同样被拦截', () => {
    const json = { type: 'doc', content: [
      { type: 'heading', attrs: { level: 1 }, children: [
        { type: 'paragraph', content: [{ type: 'text', text: '标题下正文' }] },
        rawUnknown,
      ] },
    ] }
    const out = validateDocument(json, schema)
    const card = out.content.find((node) => node.type === 'unknownBlock')
    expect(card).toBeTruthy()
    expect(card.attrs.payload).toBe(JSON.stringify(rawUnknown))
  })

  it('嵌套容器内的未知块（未知块内部还有未知子块）整块进 payload', () => {
    const nested = { type: 'outerMystery', content: [rawUnknown] }
    const json = { type: 'doc', content: [nested] }
    const out = validateDocument(json, schema)
    expect(out.content).toHaveLength(1)
    expect(out.content[0].attrs.payload).toBe(JSON.stringify(nested))
  })

  it('unknownType 超 100 字符被截断且不抛错', () => {
    const json = { type: 'doc', content: [{ type: `x${'y'.repeat(149)}` }] }
    const out = validateDocument(json, schema)
    expect(out.content[0].attrs.unknownType).toHaveLength(100)
  })

  it('payload 超 1M 放弃保真只存占位（载入优先于还原）', () => {
    const big = { type: 'bigBlock', attrs: { blob: 'x'.repeat(UNKNOWN_PAYLOAD_MAX + 10) } }
    const json = { type: 'doc', content: [big] }
    const out = validateDocument(json, schema)
    expect(out.content[0].type).toBe('unknownBlock')
    expect(out.content[0].attrs.payload).toBe('')
    expect(out.content[0].attrs.unknownType).toBe('bigBlock')
  })
})

describe('unknownBlock 还原（restoreUnknownBlocks）', () => {
  it('占位卡还原为原始未知块，key 顺序逐字节一致', () => {
    const json = { type: 'doc', content: [rawUnknown] }
    const out = validateDocument(json, schema)
    const restored = restoreUnknownBlocks(out)
    expect(JSON.stringify(restored.content[0])).toBe(JSON.stringify(rawUnknown))
  })

  it('往返幂等：还原 → 再降级 → 再还原，两次结果全等', () => {
    const json = { type: 'doc', content: [rawUnknown] }
    const first = restoreUnknownBlocks(validateDocument(json, schema))
    const second = restoreUnknownBlocks(validateDocument(first, schema))
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })

  it('payload 损坏时保留占位卡原样', () => {
    const json = { type: 'doc', content: [{ type: 'unknownBlock', attrs: { payload: '{oops', unknownType: 'knightBlock' } }] }
    const out = validateDocument(json, schema)
    const restored = restoreUnknownBlocks(out)
    expect(restored.content[0].type).toBe('unknownBlock')
    expect(restored.content[0].attrs.payload).toBe('{oops')
  })

  it('空 payload 保留占位；非 unknownBlock 节点原样透传', () => {
    const json = { type: 'doc', content: [
      { type: 'unknownBlock', attrs: { unknownType: 'x' } },
      { type: 'paragraph', content: [{ type: 'text', text: '正文' }] },
    ] }
    const out = validateDocument(json, schema)
    const restored = restoreUnknownBlocks(out)
    expect(restored.content[0].type).toBe('unknownBlock')
    expect(restored.content[1].type).toBe('paragraph')
  })

  it('schema 快照守卫（fixtures/schema-v1.json 与装配 schema 逐字段一致）', () => {
    const fixture = JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures/schema-v1.json'), 'utf8'))
    // 序列化口径与 quote.test.js / scripts/capture-baseline.js 共用（scripts/lib/schema-contract.js）。
    const { serializeMap } = createRequire(import.meta.url)(path.join(root, 'scripts/lib/schema-contract'))
    expect(serializeMap(schema.spec.nodes)).toEqual(fixture.nodes)
    expect(serializeMap(schema.spec.marks)).toEqual(fixture.marks)
    expect(Object.keys(fixture.nodes)).toContain('unknownBlock')
  })
})

/**
 * 回归守卫：renderHTML 的子 spec 必须展平。
 *
 * 嵌套写法（`['div', attrs, [child, child]]`）在编辑器里看不出问题——只在
 * **序列化**时炸（`getHTML()` / 导出 PDF、DOCX 全走这条路），报
 * `RangeError: Invalid array passed to renderSpec`。原来那条路径没有测试覆盖，
 * 所以这个 bug 一直躺着。
 */
describe('unknownBlock 序列化（导出侧回归）', () => {
  it('serializeNode 不抛错，占位卡结构与 renderHTML 一致', () => {
    const node = schema.nodes.unknownBlock.create({ payload: '{"type":"knightBlock"}', unknownType: 'knightBlock' })
    const el = DOMSerializer.fromSchema(schema).serializeNode(node)
    expect(el.classList.contains('lark-doc-unknown-card')).toBe(true)
    expect(el.querySelector('.lark-doc-unknown-card-title').textContent).toBe('暂不支持显示的内容块')
    expect(el.querySelector('.lark-doc-unknown-card-sub').textContent).toContain('knightBlock')
  })
})
