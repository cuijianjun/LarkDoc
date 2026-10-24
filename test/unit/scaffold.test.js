/**
 * 占位 + 冒烟：确认 vitest 能吃下仓库源码。
 *
 * 这条用例是 Step 1 的"脚手架是否可用"的探针：如果 core 以后不小心把
 * 只能在浏览器构建里跑的东西拉进来，这里会先于 `npm run build` 报错。
 */
import { describe, expect, it } from 'vitest'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import { getSchema } from '@tiptap/core'

describe('scaffold', () => {
  it('能在 Node 环境装配出 lark-doc schema', () => {
    const schema = getSchema(createLarkDocExtensions())
    expect(Object.keys(schema.nodes)).toContain('doc')
    expect(Object.keys(schema.nodes)).toContain('paragraph')
    expect(Object.keys(schema.marks)).toContain('bold')
  })

  it('lark-doc 自有节点全部在位（防「装配悄悄退化成裸 tiptap」）', () => {
    // 不只探针三个通用名，把 lark-doc 特有的块/标记各抽代表：
    // 行内（highlight/textStyle/link）、列表（taskItem/numberStart）、
    // 块（details 三件套、table 三件套）、媒体（image/codeBlock）。
    const schema = getSchema(createLarkDocExtensions())
    const nodes = Object.keys(schema.nodes)
    for (const name of [
      'heading', 'bulletList', 'orderedList', 'taskList', 'taskItem',
      'table', 'tableRow', 'tableCell', 'tableHeader',
      'details', 'detailsSummary', 'detailsContent',
      'image', 'codeBlock',
    ]) expect(nodes, `node: ${name}`).toContain(name)
    const marks = Object.keys(schema.marks)
    for (const name of ['highlight', 'textStyle', 'link', 'underline', 'strike', 'code']) {
      expect(marks, `mark: ${name}`).toContain(name)
    }
  })
})
