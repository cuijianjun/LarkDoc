/**
 * P1-05 容器嵌套深度上限（默认 5）+ 拖拽合法性判定。
 *
 * 三层拦截各有一组用例：纯函数（wrapContainerAllowed / moveDepthAllowed /
 * containerDepthAt）、命令层（toggleBlockquote / setDetails 守卫）、
 * 移动层（moveBlockRange 超深拒绝）。容器口径 = blockquote / callout /
 * details / columns；column 与表格单元格不计层。
 */
// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Editor, getSchema } from '@tiptap/core'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import { moveBlockRange } from '../../src/core/documentOperations'
import {
  CONTAINER_NESTING_MAX, CONTAINER_TYPES, containerDepthAt, maxContainerDepthWithin,
  moveDepthAllowed, selectionTouchesContainer, wrapContainerAllowed,
} from '../../src/core/blocks/container-depth'

let schema
let editor
beforeAll(() => {
  schema = getSchema(createLarkDocExtensions())
  editor = new Editor({ extensions: createLarkDocExtensions(), content: { type: 'doc', content: [] } })
})

/** n 层 type 容器链包住 leaf 的 JSON（默认 blockquote；测套引用被拒时用 callout 链避开 toggle=拆引用语义）。 */
const chain = (n, leaf = { type: 'paragraph' }, type = 'blockquote') => {
  let node = leaf
  for (let i = 0; i < n; i++) node = { type, content: [node] }
  return node
}
const docJSON = (content) => ({ type: 'doc', content })
const toDoc = (json) => schema.nodeFromJSON(json)

describe('常量与容器口径', () => {
  it('上限 5；容器四类，column / 表格单元格不计', () => {
    expect(CONTAINER_NESTING_MAX).toBe(5)
    expect(CONTAINER_TYPES).toEqual(['blockquote', 'callout', 'details', 'columns'])
  })
})

describe('containerDepthAt / maxContainerDepthWithin', () => {
  it('顶层段落深度 0', () => {
    const doc = toDoc(docJSON([{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }]))
    expect(containerDepthAt(doc, 1)).toBe(0)
  })
  it('n 层引用链内段落深度 n', () => {
    const doc = toDoc(docJSON([chain(3, { type: 'paragraph', content: [{ type: 'text', text: 'deep' }] })]))
    let pos = null
    doc.descendants((node, p) => { if (pos === null && node.type.name === 'paragraph' && node.textContent === 'deep') pos = p })
    expect(containerDepthAt(doc, pos + 1)).toBe(3)
  })
  it('columns 算 1 层，内部 column 不加层', () => {
    const doc = toDoc(docJSON([{ type: 'columns', content: [{ type: 'column', attrs: { width: 100 }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'c' }] }] }] }]))
    let pos = null
    doc.descendants((node, p) => { if (pos === null && node.type.name === 'paragraph') pos = p })
    expect(containerDepthAt(doc, pos + 1)).toBe(1)
  })
  it('maxContainerDepthWithin：区间含 3 层引用链返回 3', () => {
    const doc = toDoc(docJSON([chain(3, { type: 'paragraph', content: [{ type: 'text', text: 'x' }] })]))
    expect(maxContainerDepthWithin(doc, 0, doc.content.size)).toBe(3)
  })
})

describe('wrapContainerAllowed（wrap / 插入判定）', () => {
  const state = (json) => {
    editor.commands.setContent(json)
    return editor.state
  }
  it('平层段落套引用：0+1 ≤ 5 放行', () => {
    const s = state(docJSON([{ type: 'paragraph', content: [{ type: 'text', text: 'p' }] }]))
    expect(wrapContainerAllowed(s, s.selection.from, s.selection.to, 1)).toBe(true)
  })
  it('4 层链内段落套引用：4+1 ≤ 5 放行', () => {
    const s = state(docJSON([chain(4, { type: 'paragraph', content: [{ type: 'text', text: 'p' }] })]))
    let pos = null
    editor.state.doc.descendants((node, p) => { if (pos === null && node.type.name === 'paragraph') pos = p })
    expect(containerDepthAt(editor.state.doc, pos + 1)).toBe(4)
    expect(wrapContainerAllowed(editor.state, pos + 1, pos + 2, 1)).toBe(true)
  })
  it('5 层链内段落套引用：5+1 > 5 拒绝', () => {
    state(docJSON([chain(5, { type: 'paragraph', content: [{ type: 'text', text: 'p' }] })]))
    let pos = null
    editor.state.doc.descendants((node, p) => { if (pos === null && node.type.name === 'paragraph') pos = p })
    expect(wrapContainerAllowed(editor.state, pos + 1, pos + 2, 1)).toBe(false)
  })
  it('选中 5 层容器整体再包一层：拒绝', () => {
    state(docJSON([chain(5, { type: 'paragraph', content: [{ type: 'text', text: 'p' }] })]))
    const doc = editor.state.doc
    // 顶层 blockquote 整块范围（到末尾前 1，因为链是文档唯一顶层块）
    expect(wrapContainerAllowed(editor.state, 0, doc.content.size - 1, 1)).toBe(false)
  })
})

describe('命令层守卫', () => {
  const setSelectionInParagraph = () => {
    let pos = null
    editor.state.doc.descendants((node, p) => { if (pos === null && node.type.name === 'paragraph') pos = p })
    editor.commands.setTextSelection(pos + 1)
  }
  it('普通段落 toggleBlockquote 放行', () => {
    editor.commands.setContent(docJSON([{ type: 'paragraph', content: [{ type: 'text', text: 'p' }] }]))
    setSelectionInParagraph()
    expect(editor.commands.toggleBlockquote()).toBe(true)
    expect(editor.state.doc.firstChild.type.name).toBe('blockquote')
  })
  it('5 层 callout 链内段落 toggleBlockquote（套引用方向）拒绝', () => {
    editor.commands.setContent(docJSON([chain(5, { type: 'paragraph', content: [{ type: 'text', text: 'p' }] }, 'callout')]))
    setSelectionInParagraph()
    expect(selectionTouchesContainer(editor.state, 'blockquote')).toBe(false)
    expect(editor.commands.toggleBlockquote()).toBe(false)
    // 深度仍是 5（未多套一层）
    let pos = null
    editor.state.doc.descendants((node, p) => { if (pos === null && node.type.name === 'paragraph') pos = p })
    expect(containerDepthAt(editor.state.doc, pos + 1)).toBe(5)
  })
  it('引用内 toggleBlockquote（拆引用方向）放行', () => {
    editor.commands.setContent(docJSON([chain(5, { type: 'paragraph', content: [{ type: 'text', text: 'p' }] })]))
    setSelectionInParagraph()
    expect(selectionTouchesContainer(editor.state, 'blockquote')).toBe(true)
    expect(editor.commands.toggleBlockquote()).toBe(true)
  })
  it('5 层链内段落 setDetails 拒绝；平层放行', () => {
    editor.commands.setContent(docJSON([chain(5, { type: 'paragraph', content: [{ type: 'text', text: 'p' }] })]))
    setSelectionInParagraph()
    expect(editor.commands.setDetails()).toBe(false)
    editor.commands.setContent(docJSON([{ type: 'paragraph', content: [{ type: 'text', text: 'p' }] }]))
    setSelectionInParagraph()
    expect(editor.commands.setDetails()).toBe(true)
    expect(editor.state.doc.firstChild.type.name).toBe('details')
  })
})

describe('移动层（moveDepthAllowed + moveBlockRange 兜底）', () => {
  it('深层容器拖到浅层：放行', () => {
    editor.commands.setContent(docJSON([
      chain(3, { type: 'paragraph', content: [{ type: 'text', text: 'inner' }] }),
      { type: 'paragraph', content: [{ type: 'text', text: 'tail' }] },
    ]))
    expect(moveDepthAllowed(editor, 0, 4, editor.state.doc.content.size)).toBe(true)
  })
  it('带 3 层嵌套的容器拖进 3 层链内：3+3 > 5 拒绝', () => {
    editor.commands.setContent(docJSON([
      chain(3, { type: 'paragraph', content: [{ type: 'text', text: 'inner' }] }),
      chain(3, { type: 'paragraph', content: [{ type: 'text', text: 'tail' }] }),
    ]))
    const size = editor.state.doc.content.size
    // 第二个 3 层链整体 [from, to)
    let from = null
    let to = null
    editor.state.doc.forEach((node, offset, index) => { if (index === 1) { from = offset; to = offset + node.nodeSize } })
    // 落点放进第一个链的内部最深处段落前
    let pos = null
    editor.state.doc.descendants((node, p) => { if (pos === null && node.type.name === 'paragraph' && node.textContent === 'inner') pos = p })
    expect(containerDepthAt(editor.state.doc, pos + 1)).toBe(3)
    expect(moveDepthAllowed(editor, from, to, pos)).toBe(false)
    expect(moveBlockRange(editor, from, to, Math.min(pos, size))).toBe(false)
  })
  it('同容器内上下移不改变深度：天然放行', () => {
    editor.commands.setContent(docJSON([
      { type: 'blockquote', content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'one' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'two' }] },
      ] },
    ]))
    let from = null
    let to = null
    let second = null
    editor.state.doc.descendants((node, p) => { if (node.type.name === 'paragraph') { if (from === null) from = p; else if (second === null) second = p } })
    to = from + 4
    expect(moveDepthAllowed(editor, from, to, second)).toBe(true)
  })
})

afterAll(() => { if (editor) editor.destroy() })
