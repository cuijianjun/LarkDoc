// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import { validateDocument } from '../../src/core/documentOperations'
import { LarkDoc } from '../../src/LarkDoc'

const editors = []
const facades = []
beforeEach(() => {
  // jsdom has no Range layout; real dimensions and focus/scroll are covered in the browser probe.
  const createRange = document.createRange.bind(document)
  vi.spyOn(document, 'createRange').mockImplementation(() => Object.assign(createRange(), {
    getClientRects: () => [],
    getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }),
  }))
})
const paragraph = (text = '', blockId) => ({ type: 'paragraph', attrs: blockId ? { blockId } : {}, content: text ? [{ type: 'text', text }] : [] })
const layout = (count = 2) => ({ type: 'columns', attrs: { blockId: 'layout_root' }, content: Array.from({ length: count }, (_, index) => ({ type: 'column', attrs: { width: 100 / count }, content: [paragraph(index === 0 ? '保留正文' : '', index === 0 ? 'p_original' : `p_col_${index}`)] })) })
function mount(content = [paragraph('当前段落', 'p_original')]) {
  // Include the SDK's normal trailing paragraph so its first transaction adds no fixture scaffolding.
  if (content[content.length - 1].type === 'columns') content = [...content, paragraph('', 'p_tail')]
  const editor = new Editor({ extensions: createLarkDocExtensions(), content: { type: 'doc', content } })
  document.body.appendChild(editor.view.dom)
  editors.push(editor)
  return editor
}
afterEach(() => {
  editors.splice(0).forEach(editor => { const dom = editor.view.dom; editor.destroy(); dom.remove() })
  facades.splice(0).forEach(({ doc, element }) => { doc.destroy(); element.remove() })
  vi.restoreAllMocks()
})
function mountFacade(config) {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const doc = new LarkDoc({ element, storage: 'none', config, content: { type: 'doc', content: [layout(3), paragraph('', 'p_tail')] } })
  facades.push({ doc, element })
  return doc
}

describe('Feishu column layout', () => {
  it('keeps controls live after value-equal setContent and actual facade loading', () => {
    const editor = mount([layout()])
    editor.commands.setContent(editor.getJSON())
    editor.view.dom.querySelector('.lark-doc-column-add').click()
    expect(editor.state.doc.firstChild.childCount).toBe(3)
    editor.commands.setContent(editor.getJSON())
    startResize(editor)
    window.dispatchEvent(new MouseEvent('pointerup'))
    expect(editor.state.doc.firstChild.child(0).attrs.width).toBeGreaterThan(100 / 3)
    const doc = mountFacade()
    doc.getEditor().view.dom.querySelector('.lark-doc-column-add').click()
    expect(doc.getJSON().content[0].content).toHaveLength(4)
    expect(document.activeElement).toBe(doc.getEditor().view.dom)
  })

  it('honors initial and changing feature flags for API, controls, Backspace and pending gestures', async () => {
    const doc = mountFacade({ features: { columns: false } }), editor = doc.getEditor()
    const before = doc.getJSON(), grid = editor.view.dom.querySelector('[data-type="columns"]')
    expect(grid.dataset.columnsEditable).toBe('false')
    grid.querySelector('.lark-doc-column-add').click()
    expect(editor.commands.addLayoutColumn(1)).toBe(false)
    expect(editor.commands.insertColumns(2)).toBe(false)
    editor.commands.setTextSelection(1 + editor.state.doc.firstChild.child(0).nodeSize + 2)
    expect(editor.commands.removeEmptyLayoutColumn()).toBe(false)
    expect(doc.getJSON()).toEqual(before)
    doc.patchProps({ config: { features: { columns: true } } })
    await Promise.resolve()
    expect(grid.dataset.columnsEditable).toBe('true')
    startResize(editor)
    expect(grid.classList.contains('is-resizing')).toBe(true)
    doc.patchProps({ config: { features: { columns: false } } })
    await Promise.resolve()
    expect(grid.classList.contains('is-resizing')).toBe(false)
    window.dispatchEvent(new MouseEvent('pointerup'))
    expect(doc.getJSON()).toEqual(before)
    editor.commands.insertContentAt(3, '正文仍可编辑')
    expect(editor.state.doc.firstChild.textContent).toContain('正文仍可编辑')
  })

  it('normalizes legacy non-percentage weights on completed layout changes, preserving content and undo', () => {
    const old = layout(3)
    old.content.forEach(column => { delete column.attrs.width })
    const editor = mount([old]), before = editor.getJSON()
    expect(before.content[0].content.map(column => column.attrs.width)).toEqual([50, 50, 50])
    startResize(editor)
    window.dispatchEvent(new MouseEvent('pointerup'))
    const widths = editor.state.doc.firstChild.content.content.map(column => column.attrs.width)
    expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(100)
    expect(widths[0]).toBeCloseTo(100 / 3 + 24 / 820 * 100)
    expect(editor.state.doc.firstChild.child(0).firstChild.attrs.blockId).toBe('p_original')
    editor.commands.undo()
    expect(editor.getJSON()).toEqual(before)
    editor.commands.addLayoutColumn(1)
    editor.state.doc.firstChild.forEach(column => expect(column.attrs.width).toBeCloseTo(25, 8))
    editor.commands.undo()
    expect(editor.getJSON()).toEqual(before)
  })
  it('wraps the current paragraph and keeps its identity, text and caret through undo/redo', () => {
    const editor = mount()
    editor.commands.setTextSelection(3)
    expect(editor.commands.insertColumns(2)).toBe(true)
    const grid = editor.state.doc.firstChild
    expect(grid.child(0).firstChild.attrs.blockId).toBe('p_original')
    expect(grid.child(0).textContent).toBe('当前段落')
    expect(editor.state.selection.from).toBe(5)
    expect(editor.commands.undo()).toBe(true)
    expect(editor.state.doc.firstChild.type.name).toBe('paragraph')
    expect(editor.state.doc.firstChild.attrs.blockId).toBe('p_original')
    expect(editor.commands.redo()).toBe(true)
    expect(editor.state.doc.firstChild.childCount).toBe(2)
  })

  it('adds editable columns beyond five without losing existing content', () => {
    const editor = mount([layout()])
    for (let count = 3; count <= 10; count += 1) {
      expect(editor.commands.addLayoutColumn(1)).toBe(true)
      expect(editor.state.doc.firstChild.childCount).toBe(count)
      expect(editor.state.doc.firstChild.child(0).firstChild.attrs.blockId).toBe('p_original')
      expect(editor.state.doc.firstChild.child(1).firstChild.type.name).toBe('paragraph')
    }
    expect(validateDocument(editor.getJSON(), editor.schema)).toBeTruthy()
    expect(editor.commands.undo()).toBe(true)
    expect(editor.state.doc.firstChild.childCount).toBe(9)
  })

  it('Backspace removes only an empty column, then unwraps the survivor with the same paragraph ID', () => {
    const editor = mount([layout(3)])
    const emptyPos = () => 1 + editor.state.doc.firstChild.child(0).nodeSize
    editor.commands.setTextSelection(emptyPos() + 2)
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }))
    expect(editor.state.doc.firstChild.childCount).toBe(2)
    editor.commands.setTextSelection(emptyPos() + 2)
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }))
    expect(editor.state.doc.firstChild.type.name).toBe('paragraph')
    expect(editor.state.doc.firstChild.attrs.blockId).toBe('p_original')
    expect(editor.state.doc.firstChild.textContent).toBe('保留正文')
    editor.commands.undo()
    expect(editor.state.doc.firstChild.childCount).toBe(2)
  })

  it('keeps a populated column and blocks layout mutations in read mode', () => {
    const editor = mount([layout()])
    editor.commands.setTextSelection(3)
    expect(editor.commands.removeEmptyLayoutColumn()).toBe(false)
    editor.setEditable(false)
    const before = editor.getJSON()
    expect(editor.commands.addLayoutColumn(1)).toBe(false)
    expect(editor.commands.insertColumns(3)).toBe(false)
    expect(editor.getJSON()).toEqual(before)
  })

  it('retains fractional widths smaller than ten percent through HTML and JSON', () => {
    const editor = mount([layout(12)])
    expect(editor.state.doc.firstChild.child(0).attrs.width).toBeCloseTo(100 / 12)
    const html = editor.getHTML()
    editor.commands.setContent(html)
    expect(editor.state.doc.firstChild.childCount).toBe(12)
    expect(editor.state.doc.firstChild.child(0).attrs.width).toBeCloseTo(100 / 12)
    expect(validateDocument(editor.getJSON(), editor.schema)).toBeTruthy()
  })

  function startResize(editor) {
    const grid = editor.view.dom.querySelector('[data-type="columns"]')
    grid.getBoundingClientRect = () => ({ width: 820 })
    grid.querySelector('.lark-doc-column-divider').dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 164, bubbles: true }))
    document.body.dispatchEvent(new MouseEvent('pointermove', { clientX: 188, bubbles: true }))
    return grid
  }

  it('resizes only the adjacent pair by the measured full-grid delta and commits once on release', () => {
    const editor = mount([layout(5)])
    const before = editor.getJSON()
    const grid = startResize(editor)
    expect(editor.getJSON()).toEqual(before)
    expect(grid.classList.contains('is-resizing')).toBe(true)
    window.dispatchEvent(new MouseEvent('pointerup'))
    const columns = editor.state.doc.firstChild
    expect(columns.child(0).attrs.width).toBeCloseTo(22.926829, 5)
    expect(columns.child(1).attrs.width).toBeCloseTo(17.073171, 5)
    expect(columns.child(2).toJSON()).toEqual(before.content[0].content[2])
    expect(columns.child(0).firstChild.attrs.blockId).toBe('p_original')
    editor.commands.undo()
    expect(editor.getJSON()).toEqual(before)
  })

  it.each(['escape', 'cancel', 'readonly', 'document'])('discards a resize on %s without stale width writes', mode => {
    const editor = mount([layout(5)])
    const before = editor.getJSON()
    const grid = startResize(editor)
    if (mode === 'escape') {
      const stopper = event => event.stopPropagation()
      editor.view.dom.addEventListener('keydown', stopper)
      editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      editor.view.dom.removeEventListener('keydown', stopper)
    }
    if (mode === 'cancel') window.dispatchEvent(new Event('pointercancel'))
    if (mode === 'readonly') editor.setEditable(false)
    if (mode === 'document') editor.commands.insertContentAt(3, '新增')
    const changed = editor.getJSON()
    window.dispatchEvent(new MouseEvent('pointerup'))
    expect(editor.getJSON()).toEqual(mode === 'document' ? changed : before)
    expect(grid.classList.contains('is-resizing')).toBe(false)
    expect(editor.state.doc.firstChild.child(0).attrs.width).toBe(20)
  })

  it('clamps dragging at the source one-of-24 width unit and preserves the adjacent total', () => {
    const editor = mount([layout(5)])
    startResize(editor)
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: -500 }))
    window.dispatchEvent(new MouseEvent('pointerup'))
    expect(editor.state.doc.firstChild.child(0).attrs.width).toBeCloseTo(100 / 24, 6)
    expect(editor.state.doc.firstChild.child(1).attrs.width).toBeCloseTo(40 - 100 / 24, 6)
  })
})
