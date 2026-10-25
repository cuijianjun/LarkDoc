/**
 * P1-01 quote_container 引用容器（09 §5.2）。
 *
 * 引用是容器：content: 'block+'，内可放列表 / 表格等任意块；
 * quote_container 是 0.11 历史命名，parseHTML 兼容读取、新写一律归一 blockquote
 * （02 §8 收口定判）；JSON 层迁移在 P1-04 落地，这里守「读取不丢」。
 * 同时补上 schema 快照守卫（fixtures/schema-v1.json）—— 扩展装配的任何
 * 规格漂移（含本任务替换 StarterKit 内置 Blockquote）在这里现形。
 */
// @vitest-environment jsdom
import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'
import { Editor, getSchema } from '@tiptap/core'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function createEditor(content) {
  return new Editor({ extensions: createLarkDocExtensions(), content })
}

const quoteDoc = {
  type: 'doc',
  content: [{
    type: 'blockquote',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: '引用段落' }] },
      {
        type: 'bulletList',
        content: [{
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '引用里的无序项' }] }],
        }],
      },
      {
        type: 'orderedList',
        content: [{
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '引用里的有序项' }] }],
        }],
      },
      {
        type: 'table',
        content: [{
          type: 'tableRow',
          content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B' }] }] },
          ],
        }],
      },
    ],
  }],
}

describe('P1-01 引用容器（quote_container）', () => {
  it('schema：blockquote 是容器（content: block+），列表与表格可入内', () => {
    const editor = createEditor(quoteDoc)
    const doc = editor.state.doc
    const quote = doc.firstChild
    expect(quote.type.name).toBe('blockquote')
    expect(quote.childCount).toBe(4)
    expect(quote.child(1).type.name).toBe('bulletList')
    expect(quote.child(2).type.name).toBe('orderedList')
    expect(quote.child(3).type.name).toBe('table')
    editor.destroy()
  })

  it('getJSON round-trip 无损：容器内列表 / 表格结构不丢', () => {
    const first = createEditor(quoteDoc)
    const once = first.getJSON()
    first.destroy()
    const second = createEditor(once)
    expect(second.getJSON()).toEqual(once)
    second.destroy()
  })

  it('兼容读取：div[data-type="quote_container"] 解析为 blockquote', () => {
    const editor = createEditor('<div data-type="quote_container"><p>旧命名引用</p></div>')
    const quote = editor.state.doc.firstChild
    expect(quote.type.name).toBe('blockquote')
    expect(quote.child(0).textContent).toBe('旧命名引用')
    editor.destroy()
  })

  it('写入归一：输出仍是 <blockquote> 标签，quote_container 只进不出', () => {
    const editor = createEditor('<div data-type="quote_container"><p>内容</p></div>')
    expect(editor.getHTML()).toContain('<blockquote>')
    expect(editor.getHTML()).not.toContain('quote_container')
    editor.destroy()
  })

  it('命令继承：toggleBlockquote 仍在位（块菜单 / 命令菜单直通）', () => {
    const editor = createEditor('<p>正文</p>')
    expect(typeof editor.commands.toggleBlockquote).toBe('function')
    editor.commands.toggleBlockquote()
    expect(editor.state.doc.firstChild.type.name).toBe('blockquote')
    editor.destroy()
  })

  it('schema 快照守卫：与 fixtures/schema-v1.json 逐字段一致', () => {
    const fixture = JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures/schema-v1.json'), 'utf8'))
    const schema = getSchema(createLarkDocExtensions())
    // 序列化口径与 scripts/capture-baseline.js 共用（scripts/lib/schema-contract.js）。
    const { serializeMap } = createRequire(import.meta.url)(path.join(root, 'scripts/lib/schema-contract'))
    expect(serializeMap(schema.spec.nodes)).toEqual(fixture.nodes)
    expect(serializeMap(schema.spec.marks)).toEqual(fixture.marks)
    expect(schema.spec.topNode).toBe(fixture.topNode)
  })
})
