// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Editor, getSchema } from '@tiptap/core'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import { encodeSheet } from '../../src/core/blocks/sheet-render'

const extensions = () => createLarkDocExtensions()
const schema = getSchema(extensions())

beforeEach(() => {
  if (typeof HTMLCanvasElement !== 'undefined') {
    HTMLCanvasElement.prototype.getContext = () => null
  }
})

afterEach(() => {
  if (typeof HTMLCanvasElement !== 'undefined') {
    delete HTMLCanvasElement.prototype.getContext
  }
})

const cases = [
  { type: 'fileBlock', attrs: { src: 'https://cdn.example.com/a.pdf', mimeType: 'application/pdf' } },
  { type: 'image', attrs: { src: 'https://cdn.example.com/a.png' } },
  { type: 'sheet', attrs: { sheet: encodeSheet({ rows: 2, cols: 2 }) } },
  { type: 'webEmbed', attrs: { src: 'https://example.com/embed' } },
  { type: 'bookmark', attrs: { url: 'https://example.com' } },
  { type: 'unknownBlock', attrs: { payload: '{}', unknownType: 'futureBlock' } },
]

function makeEditor(type, attrs) {
  return new Editor({
    extensions: extensions(),
    content: { type: 'doc', content: [{ type, attrs: { ...attrs, asyncState: { state: 'loading' } } }] },
  })
}

describe('异步块统一状态投影', () => {
  it.each(cases)('$type 在导出 DOM 暴露规范化 async state', ({ type, attrs }) => {
    const editor = makeEditor(type, attrs)
    try {
      const root = editor.view.dom.firstElementChild
      expect(root.getAttribute('data-async-state')).toContain('"state":"loading"')
      expect(root.classList.contains('is-async-loading')).toBe(true)
    } finally {
      editor.destroy()
    }
  })

  it.each(['empty', 'loading', 'failed', 'unauthorized', 'over_limit'])('状态 %s 有稳定视觉语义 class', (state) => {
    const node = schema.nodes.image.create({ src: 'https://cdn.example.com/a.png', asyncState: { state } })
    const editor = new Editor({
      extensions: extensions(),
      content: { type: 'doc', content: [node.toJSON()] },
    })
    try {
      expect(editor.view.dom.firstElementChild.classList.contains(`is-async-${state}`)).toBe(true)
    } finally {
      editor.destroy()
    }
  })
})
