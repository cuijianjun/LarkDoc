// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import blockMenuMixin from '../../src/components/lark-doc/editor/blockMenuMixin'
import { Editor } from '@tiptap/core'
import { AllSelection, NodeSelection, TextSelection } from '@tiptap/pm/state'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import {
  BLOCK_CLIPBOARD_MIME,
  createClipboardPayload,
  decodeClipboardPayload,
  encodeClipboardPayload,
  remapClipboardIds,
} from '../../src/core/blocks/block-clipboard'

const editors = []
const paragraph = (id, text) => ({ type: 'paragraph', attrs: { blockId: id }, content: [{ type: 'text', text, marks: [{ type: 'bold' }] }] })
function editorOf(content = [paragraph('target', '目标')], options = {}) {
  const editor = new Editor({ extensions: createLarkDocExtensions(options), content: { type: 'doc', content } })
  editors.push(editor)
  return editor
}
afterEach(() => { while (editors.length) editors.pop().destroy() })
function transfer(initial = {}, failType = '') {
  const values = { ...initial }
  return { files: [], get types() { return Object.keys(values) }, clearData() { Object.keys(values).forEach(key => delete values[key]) },
    setData(type, value) { if (type === failType) throw new Error('write denied'); values[type] = value },
    getData(type) { return values[type] || '' } }
}
function fire(editor, type, data) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: data })
  editor.view.dom.dispatchEvent(event)
  return event
}
function select(editor, selection) { editor.view.dispatch(editor.state.tr.setSelection(selection)) }

describe('块级剪贴板真实事件', () => {
  it.each(['single', 'multi', 'container'])('%s 精确保留选择结构和粗体，独立 Editor 粘贴重建身份', (kind) => {
    const blocks = kind === 'container'
      ? [{ type: 'blockquote', attrs: { blockId: 'quote' }, content: [paragraph('inner', '选中')] }]
      : [paragraph('first', '选中'), ...(kind === 'multi' ? [paragraph('second', '第二')] : [])]
    const source = editorOf([...blocks, paragraph('secret', '未选中')])
    const end = blocks.reduce((size, node) => size + source.schema.nodeFromJSON(node).nodeSize, 0)
    select(source, kind === 'multi' ? TextSelection.create(source.state.doc, 1, end - 1) : NodeSelection.create(source.state.doc, 0))
    const data = transfer()
    expect(fire(source, 'copy', data).defaultPrevented).toBe(true)
    const payload = decodeClipboardPayload(data.getData(BLOCK_CLIPBOARD_MIME))
    expect(payload.blocks).toHaveLength(blocks.length)
    expect(data.getData('text/html')).toContain('<strong>')
    expect(data.getData('text/html')).not.toContain('未选中')
    const target = editorOf()
    select(target, new AllSelection(target.state.doc))
    fire(target, 'paste', data)
    const pasted = target.getJSON().content
    // StarterKit TrailingNode appends exactly one empty paragraph after a container.
    expect(pasted).toHaveLength(blocks.length + (kind === 'container' ? 1 : 0))
    expect(pasted.map(node => node.type)).toEqual([...blocks.map(node => node.type), ...(kind === 'container' ? ['paragraph'] : [])])
    if (kind === 'container') {
      expect(pasted[0].content).toHaveLength(1)
      expect(pasted[0].content[0].content).toEqual(blocks[0].content[0].content)
      expect(pasted[1].content).toBeUndefined()
    }
    const ids = []
    target.state.doc.descendants(node => { if (node.attrs.blockId) ids.push(node.attrs.blockId) })
    expect(ids).not.toContain('first')
    expect(ids).not.toContain('inner')
    expect(ids).not.toContain('quote')
    expect(new Set(ids).size).toBe(ids.length)
    expect(target.getHTML()).toContain('<strong>')
    expect(target.getText()).toContain('选中')
  })

  it('剪切 HTML 写入失败不删除；成功只删除选中块，undo 恢复原身份', () => {
    const editor = editorOf([paragraph('keep', '保留'), paragraph('cut', '剪切')])
    const from = editor.state.doc.firstChild.nodeSize
    select(editor, NodeSelection.create(editor.state.doc, from))
    const before = editor.getJSON()
    expect(fire(editor, 'cut', transfer({}, 'text/html')).defaultPrevented).toBe(true)
    expect(editor.getJSON()).toEqual(before)
    fire(editor, 'cut', transfer())
    expect(editor.getJSON().content.map(node => node.attrs.blockId)).toEqual(['keep'])
    expect(editor.commands.undo()).toBe(true)
    expect(editor.getJSON()).toEqual(before)
  })

  it('空光标及局部文本复制不扩张为块', () => {
    const editor = editorOf([paragraph('p', 'abcdef')])
    const empty = transfer()
    fire(editor, 'copy', empty)
    expect(empty.getData(BLOCK_CLIPBOARD_MIME)).toBe('')
    select(editor, TextSelection.create(editor.state.doc, 2, 4))
    const partial = transfer()
    fire(editor, 'copy', partial)
    expect(partial.getData(BLOCK_CLIPBOARD_MIME)).toBe('')
    expect(partial.getData('text/plain')).toBe('bc')
  })

  it('复制能力拒绝时阻止原生输出', () => {
    const editor = editorOf(undefined, { canCopy: () => false })
    select(editor, new AllSelection(editor.state.doc))
    const data = transfer()
    expect(fire(editor, 'copy', data).defaultPrevented).toBe(true)
    expect(data.types).toEqual([])
  })

  it('离线私有粘贴复用媒体出网过滤', () => {
    const editor = editorOf(undefined, { config: { network: { mode: 'offline' } } })
    select(editor, new AllSelection(editor.state.doc))
    const blocks = [{ type: 'image', attrs: { src: 'https://outside.invalid/leak.png', blockId: 'img' } }]
    fire(editor, 'paste', transfer({ [BLOCK_CLIPBOARD_MIME]: encodeClipboardPayload(createClipboardPayload(blocks)) }))
    expect(editor.getJSON().content[0].attrs.src).toMatch(/^data:/)
    expect(editor.getJSON().content[0].attrs.originalSrc).toBe('https://outside.invalid/leak.png')
  })

  it('非独立文档块选择退回原生格式，不写不可回贴的私有载荷', () => {
    const editor = editorOf([{ type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('li', '列表')] }] }])
    select(editor, NodeSelection.create(editor.state.doc, 1))
    const data = transfer()
    fire(editor, 'copy', data)
    expect(data.getData(BLOCK_CLIPBOARD_MIME)).toBe('')
    expect(data.getData('text/html')).toBe('')
    expect(editor.getJSON().content[0].type).toBe('bulletList')
  })

  it('超限剪切预检拒绝，正文不删除', () => {
    const editor = editorOf([paragraph('big', 'x'.repeat(5000000))])
    select(editor, new AllSelection(editor.state.doc))
    const data = transfer()
    fire(editor, 'cut', data)
    expect(editor.state.doc.textContent).toHaveLength(5000000)
    expect(data.types).toEqual([])
  })

  it('代码块和显式纯文本粘贴不带入块结构与粗体', () => {
    const data = transfer({ [BLOCK_CLIPBOARD_MIME]: encodeClipboardPayload(createClipboardPayload([paragraph('src', '粘贴')])), 'text/plain': '粘贴' })
    const editor = editorOf([{ type: 'codeBlock', content: [{ type: 'text', text: 'abcd' }] }])
    select(editor, TextSelection.create(editor.state.doc, 3))
    fire(editor, 'paste', data)
    expect(editor.getJSON().content[0].type).toBe('codeBlock')
    expect(editor.state.doc.textContent).toBe('ab粘贴cd')
    const target = editorOf()
    select(target, new AllSelection(target.state.doc))
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperties(event, { clipboardData: { value: data }, shiftKey: { value: true } })
    target.view.dom.dispatchEvent(event)
    expect(target.getText()).toBe('粘贴')
    expect(target.getHTML()).not.toContain('<strong>')
  })

  it('提及的实例身份重建，实体及纯文本显示名保留', () => {
    const source = editorOf([{ type: 'paragraph', content: [{ type: 'mention', attrs: { id: 'user-1', name: '张三', mentionId: 'instance-1' } }] }])
    select(source, new AllSelection(source.state.doc))
    const data = transfer()
    fire(source, 'copy', data)
    expect(data.getData('text/plain')).toContain('@张三')
    const target = editorOf()
    select(target, new AllSelection(target.state.doc))
    fire(target, 'paste', data)
    const attrs = target.getJSON().content[0].content[0].attrs
    expect(attrs.id).toBe('user-1')
    expect(attrs.mentionId).not.toBe('instance-1')
  })

  it('副本保留普通格式但不继承评论和修订实体，原文不变', () => {
    const block = paragraph('entity', '文本')
    block.content[0].marks.push({ type: 'comment', attrs: { threadId: 'thread' } }, { type: 'revision', attrs: { revisionId: 'rev', kind: 'insert', author: 'a' } })
    const source = editorOf([block])
    select(source, new AllSelection(source.state.doc))
    const before = source.getJSON()
    const data = transfer()
    fire(source, 'copy', data)
    const target = editorOf()
    select(target, new AllSelection(target.state.doc))
    fire(target, 'paste', data)
    expect(target.getJSON().content[0].content[0].marks.map(mark => mark.type)).toEqual(['bold'])
    expect(source.getJSON()).toEqual(before)
  })

  it('只读剪切及私有粘贴均不改变正文，复制仍可用', () => {
    const editor = editorOf()
    select(editor, new AllSelection(editor.state.doc))
    editor.setEditable(false)
    const before = editor.getJSON()
    const data = transfer()
    fire(editor, 'copy', data)
    expect(data.getData(BLOCK_CLIPBOARD_MIME)).not.toBe('')
    fire(editor, 'cut', transfer())
    fire(editor, 'paste', data)
    expect(editor.getJSON()).toEqual(before)
  })

  it('嵌套危险 URL 和损坏私有载荷不进入正文', () => {
    const editor = editorOf()
    const before = editor.getJSON()
    const blocks = [{ type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'bad', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }] }]
    for (const value of ['bad-json', encodeClipboardPayload(createClipboardPayload(blocks))]) {
      fire(editor, 'paste', transfer({ [BLOCK_CLIPBOARD_MIME]: value }))
      expect(editor.getJSON()).toEqual(before)
    }
  })
})

describe('块菜单剪贴板', () => {
  afterEach(() => vi.unstubAllGlobals())
  function context(editor, extra = {}) {
    return { editor, writable: () => editor.isEditable, session: { can: () => true },
      deleteBlockRange: vi.fn(), $nextTick: () => {}, ...extra }
  }
  function clipboard(write, supports = () => true) {
    class Item { constructor(values) { this.values = values } static supports(type) { return supports(type) } }
    vi.stubGlobal('ClipboardItem', Item)
    vi.stubGlobal('navigator', { clipboard: { write } })
  }
  it('菜单使用正式载荷及 HTML，保留粗体且不输出相邻块', async () => {
    const editor = editorOf([paragraph('selected', '选中'), paragraph('secret', '秘密')])
    const write = vi.fn().mockResolvedValue(undefined)
    clipboard(write)
    const vm = context(editor)
    expect(await blockMenuMixin.methods.copyBlock.call(vm, { from: 0, to: editor.state.doc.firstChild.nodeSize })).toBe(true)
    const values = write.mock.calls[0][0][0].values
    expect(values['text/html']).toBeInstanceOf(Blob)
    expect(values[`web ${BLOCK_CLIPBOARD_MIME}`]).toBeInstanceOf(Blob)
    const read = blob => new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(blob) })
    expect(await read(values['text/html'])).toContain('<strong>')
    expect(await read(values['text/html'])).not.toContain('秘密')
    expect(decodeClipboardPayload(await read(values[`web ${BLOCK_CLIPBOARD_MIME}`])).blocks[0].attrs.blockId).toBe('selected')
  })
  it('同步 copy 事件写入正式 MIME 后，菜单剪切删除一次且 undo 恢复', async () => {
    const editor = editorOf([paragraph('selected', '选中'), paragraph('secret', '秘密')])
    const before = editor.getJSON()
    const original = document.execCommand
    document.execCommand = vi.fn(() => {
      const event = new Event('copy', { bubbles: true, cancelable: true })
      const data = transfer()
      Object.defineProperty(event, 'clipboardData', { value: data })
      document.dispatchEvent(event)
      return true
    })
    try {
      const vm = context(editor, { deleteBlockRange: vi.fn((range) => editor.commands.deleteRange(range)) })
      expect(await blockMenuMixin.methods.copyBlock.call(vm, { from: 0, to: editor.state.doc.firstChild.nodeSize }, true)).toBe(true)
      expect(vm.deleteBlockRange).toHaveBeenCalledTimes(1)
      expect(editor.getText()).toBe('秘密')
      editor.commands.undo()
      expect(editor.getJSON()).toEqual(before)
    } finally { document.execCommand = original }
  })

  it('输出策略拒绝时不访问系统剪贴板', async () => {
    const editor = editorOf()
    const write = vi.fn().mockResolvedValue(undefined)
    clipboard(write)
    const vm = context(editor, { session: { can: () => true, getProvider: () => ({ policy: { canCopy: false } }) } })
    expect(await blockMenuMixin.methods.copyBlock.call(vm, { from: 0, to: editor.state.doc.content.size }, true)).toBe(false)
    expect(write).not.toHaveBeenCalled()
    expect(vm.deleteBlockRange).not.toHaveBeenCalled()
  })
  it.each(['document', 'permission'])('异步写入期间 %s 变化时不删除旧坐标', async kind => {
    const editor = editorOf()
    let finish
    clipboard(() => new Promise(resolve => { finish = resolve }))
    let allowed = true
    const vm = context(editor, { session: { can: () => allowed } })
    const result = blockMenuMixin.methods.copyBlock.call(vm, { from: 0, to: editor.state.doc.content.size }, true)
    if (kind === 'document') editor.commands.insertContent('变化')
    else allowed = false
    finish()
    expect(await result).toBe(false)
    expect(vm.deleteBlockRange).not.toHaveBeenCalled()
  })
  it('异步 custom format 写入成功也不能证明原生 paste 可回读，禁止删除', async () => {
    const editor = editorOf()
    clipboard(vi.fn().mockResolvedValue(undefined))
    const vm = context(editor)
    expect(await blockMenuMixin.methods.copyBlock.call(vm, { from: 0, to: editor.state.doc.content.size }, true)).toBe(false)
    expect(vm.deleteBlockRange).not.toHaveBeenCalled()
  })
  it('仅纯文本回退可用时不执行破坏性剪切', async () => {
    const editor = editorOf()
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const vm = context(editor)
    expect(await blockMenuMixin.methods.copyBlock.call(vm, { from: 0, to: editor.state.doc.content.size }, true)).toBe(false)
    expect(vm.deleteBlockRange).not.toHaveBeenCalled()
  })
})

describe('块级剪贴板契约', () => {
  const blocks = [
    { type: 'callout', attrs: { blockId: 'k' }, content: [{ type: 'paragraph', attrs: { blockId: 'p' }, content: [{ type: 'text', text: 'x' }] }] },
  ]

  it('私有 MIME 载荷可编码并回读，且不暴露原始引用', () => {
    const payload = createClipboardPayload(blocks, { source: 'editor' })
    const encoded = encodeClipboardPayload(payload)
    expect(BLOCK_CLIPBOARD_MIME).toBe('application/vnd.lark-doc.blocks+json')
    expect(decodeClipboardPayload(encoded)).toEqual(payload)
    payload.blocks[0].attrs.blockId = 'changed'
    expect(decodeClipboardPayload(encoded).blocks[0].attrs.blockId).toBe('k')
  })

  it('损坏、版本错误和空选择安全返回 null', () => {
    expect(createClipboardPayload([], {})).toBeNull()
    expect(decodeClipboardPayload('not-json')).toBeNull()
    expect(decodeClipboardPayload(JSON.stringify({ version: 99, blocks }))).toBeNull()
    expect(decodeClipboardPayload(JSON.stringify({ version: 1, blocks: 'bad' }))).toBeNull()
  })

  it('粘贴时整棵子树重新生成 blockId，并返回旧新映射', () => {
    const result = remapClipboardIds(blocks, new Set(['existing']))
    expect(result.blocks[0].attrs.blockId).not.toBe('k')
    expect(result.blocks[0].content[0].attrs.blockId).not.toBe('p')
    expect(result.idMap).toMatchObject({ k: result.blocks[0].attrs.blockId, p: result.blocks[0].content[0].attrs.blockId })
  })
})
