/**
 * P3-07 回归：`validateDocument` 的属性白名单必须覆盖 webEmbed 的**数字型** attrs。
 *
 * 起因是一个真 bug：`core/documentOperations.js` 的白名单兜底分支只收字符串
 * （`typeof value === 'string' && …`），而 `aspect` / `bridgeVersion` 是数字。
 * 于是带这两个字段的文档一进 `setContent` 就整块抛错；`bridgeVersion` 有默认值 1，
 * 等于「存一次盘、再打开就炸」。
 *
 * 这个失败的隐蔽之处在于它**看起来不像校验问题**：`Workspace.onReady()` 里补种内容
 * 那句包在 `try { … } catch { this.storageFailure(error) }` 中，异常被吞成一条
 * `lark-doc.storage.failed` 警告，DOM 上表现为块静默消失、连红字都没有。
 *
 * 所以这里除了守 `aspect` / `bridgeVersion` 的区间，还加了一条**结构性**用例：
 * 遍历 schema 里所有数字型默认值，逐个单独塞进文档走一遍 `validateDocument`。
 * 以后谁再往 webEmbed 加数字 attrs 却忘了同步白名单，这条会先红。
 */
// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import { validateDocument } from '../../src/core/documentOperations'

const SRC = 'https://www.figma.com/embed?embed_host=lark&url=x'

let schema
beforeAll(() => {
  schema = getSchema(createLarkDocExtensions())
})

/** 夹在两段正文中间 —— 与 demo 里的真实落位一致，顺带覆盖「块在文档中部」。 */
function docWith(attrs) {
  return {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: '前文' }] },
      { type: 'webEmbed', attrs: { src: SRC, ...attrs } },
      { type: 'paragraph', content: [{ type: 'text', text: '后文' }] },
    ],
  }
}

function roundtrip(attrs) {
  return validateDocument(docWith(attrs), schema)
}

/** schema 里默认值是数字的 attrs（ProseMirror 会把它们规范成 `{ default, … }`）。 */
function numericAttrDefaults() {
  const attrs = schema.nodes.webEmbed.spec.attrs || {}
  return Object.keys(attrs)
    .map((key) => {
      const spec = attrs[key]
      return [key, spec && typeof spec === 'object' ? spec.default : spec]
    })
    .filter(([, value]) => typeof value === 'number')
}

describe('validateDocument × webEmbed 数字型 attrs', () => {
  it('schema 里确实有数字型 attrs（用例本身不能空跑）', () => {
    const pairs = numericAttrDefaults()
    expect(pairs.length).toBeGreaterThan(0)
    expect(pairs.map(([key]) => key)).toContain('bridgeVersion')
  })

  it('每个数字型默认值都能单独过校验（结构性防线）', () => {
    numericAttrDefaults().forEach(([key, value]) => {
      expect(() => roundtrip({ [key]: value }), `${key}=${value} 被白名单拒掉`).not.toThrow()
    })
  })

  it('aspect 收 0–20 的开区间，越界与非法类型都拒', () => {
    // 合法边界：> 0 且 <= 20（与 blocks/web-embed.js 的 safeAspect 一致）
    ;[20, 16 / 9, 1, 0.1].forEach((value) => {
      expect(() => roundtrip({ aspect: value }), `aspect=${value} 应该合法`).not.toThrow()
    })
    ;[0, -1, 20.0001, '1.78', NaN, Infinity].forEach((value) => {
      expect(() => roundtrip({ aspect: value }), `aspect=${String(value)} 应该被拒`).toThrow(/webEmbed\.aspect/)
    })
  })

  it('bridgeVersion 只收 1–99 的整数', () => {
    ;[1, 2, 99].forEach((value) => {
      expect(() => roundtrip({ bridgeVersion: value }), `bridgeVersion=${value} 应该合法`).not.toThrow()
    })
    ;[0, -1, 100, 1.5, '1', NaN].forEach((value) => {
      expect(() => roundtrip({ bridgeVersion: value }), `bridgeVersion=${String(value)} 应该被拒`).toThrow(/webEmbed\.bridgeVersion/)
    })
  })

  it('四个尺寸字段同时给也能过，且属性原样保留', () => {
    const attrs = { title: '画板', height: 520, aspect: 1.78, poster: null, bridgeVersion: 2, providerId: 'generic' }
    const out = roundtrip(attrs)
    const block = out.content[1]
    expect(block.type).toBe('webEmbed')
    expect(block.attrs).toMatchObject({ title: '画板', height: 520, aspect: 1.78, bridgeVersion: 2, providerId: 'generic' })
    // 后文没被吞掉：块本身不能影响兄弟节点。
    expect(out.content[2]).toMatchObject({ type: 'paragraph' })
  })

  it('height 仍受块高区间约束（不许被 aspect 的分支带松）', () => {
    expect(() => roundtrip({ height: 520 })).not.toThrow()
    // documentOperations 对非 column 块的下限是 40，与 resolveEmbedHeight 的常量不冲突。
    expect(() => roundtrip({ height: 39 })).toThrow(/webEmbed\.height/)
  })
})
