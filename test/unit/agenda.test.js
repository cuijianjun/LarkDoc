// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import { sanitizeHTML, validateDocument, restoreUnknownBlocks } from '../../src/core/documentOperations'
import { serializeMarkdown } from '../../src/utils/export/markdown'
import { LarkDoc } from '../../src/LarkDoc'
import { COMMANDS } from '../../src/core/commands'

const mounted = []
beforeEach(() => {
  const createRange = document.createRange.bind(document)
  vi.spyOn(document, 'createRange').mockImplementation(() => Object.assign(createRange(), {
    getClientRects: () => [], getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }),
  }))
})
afterEach(() => { mounted.splice(0).forEach(cleanup => cleanup()); vi.restoreAllMocks() })
function mount(options = {}) {
  const editor = new Editor({ extensions: createLarkDocExtensions(options), content: '<p></p>' })
  const dom = editor.view.dom
  document.body.append(dom)
  mounted.push(() => { if (!editor.isDestroyed) editor.destroy(); dom.remove() })
  return editor
}
const agenda = editor => editor.state.doc.content.content.find(node => node.type.name === 'agenda')
const itemPos = (editor, index = 0) => {
  const positions = []
  editor.state.doc.descendants((node, pos) => { if (node.type.name === 'agendaItem') positions.push(pos) })
  return positions[index]
}

describe('native meeting agendas', () => {
  it('inserts one native agenda with two independent 20/10-minute rich-text items and a trailing caret', () => {
    const editor = mount()
    expect(COMMANDS.find(command => command.id === 'agenda').tier).toBe('required')
    expect(editor.commands.insertAgenda()).toBe(true)
    const block = agenda(editor)
    expect(block.childCount).toBe(2)
    expect(block.content.content.map(item => item.attrs.durationMinutes)).toEqual([20, 10])
    expect(new Set(block.content.content.map(item => item.attrs.itemId)).size).toBe(2)
    expect(block.attrs.blockId).toBeTruthy()
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph')
    expect(editor.commands.undo()).toBe(true)
    expect(agenda(editor)).toBeUndefined()
    editor.commands.redo()
    expect(agenda(editor).eq(block)).toBe(true)
  })
  it('keeps item identity, siblings and rich text during duration changes and undo', () => {
    const editor = mount()
    editor.commands.insertAgenda()
    editor.commands.insertContentAt(itemPos(editor) + 2, { type: 'text', text: '讨论目标', marks: [{ type: 'bold' }] })
    const before = agenda(editor)
    expect(editor.commands.setAgendaDuration(itemPos(editor), 21)).toBe(true)
    expect(agenda(editor).child(0).attrs.itemId).toBe(before.child(0).attrs.itemId)
    expect(agenda(editor).child(0).firstChild.firstChild.marks[0].type.name).toBe('bold')
    expect(agenda(editor).child(1).eq(before.child(1))).toBe(true)
    editor.commands.undo()
    expect(agenda(editor).eq(before)).toBe(true)
    editor.commands.redo()
    expect(agenda(editor).child(0).attrs.durationMinutes).toBe(21)
  })
  it.each(['pm', 'yjs'])('%s keeps agenda actions separate from adjacent typing in both undo directions', async mode => {
    const runtime = mode === 'yjs' ? await import('../../src/collab') : null
    const ydoc = runtime ? new runtime.Yjs.Doc() : null
    const editor = mount(runtime ? { collab: { extensions: runtime.createCollabExtensions({ ydoc }), isRemoteTransaction: runtime.isRemoteTransaction } } : {})
    try {
      editor.commands.setContent('<p></p>')
      editor.state.plugins.forEach(plugin => plugin.getState(editor.state)?.undoManager?.clear())
      editor.commands.insertContent('前文')
      const before = editor.getJSON()
      editor.commands.insertAgenda()
      const inserted = editor.getJSON()
      editor.commands.insertContent('后文')
      editor.commands.undo()
      expect(editor.getJSON()).toEqual(inserted)
      editor.commands.undo()
      expect(editor.getJSON()).toEqual(before)
      editor.commands.redo()
      expect(editor.getJSON()).toEqual(inserted)
      editor.commands.setAgendaDuration(itemPos(editor), 22)
      editor.commands.insertContent('后续')
      editor.commands.undo()
      expect(agenda(editor).firstChild.attrs.durationMinutes).toBe(22)
      editor.commands.undo()
      expect(agenda(editor).firstChild.attrs.durationMinutes).toBe(20)
    } finally { editor.destroy(); ydoc?.destroy() }
  })
  it.each([0, -1, 1.5, NaN, Infinity, '21', Number.MAX_SAFE_INTEGER + 1])('rejects invalid duration %s without changing the document', value => {
    const editor = mount()
    editor.commands.insertAgenda()
    const before = editor.getJSON()
    expect(editor.commands.setAgendaDuration(itemPos(editor), value)).toBe(false)
    expect(editor.getJSON()).toEqual(before)
    const invalid = JSON.parse(JSON.stringify(before))
    invalid.content.find(node => node.type === 'agenda').content[0].attrs.durationMinutes = value
    expect(() => validateDocument(invalid, editor.schema)).toThrow()
  })
  it('removes only the chosen item, retains an empty container and restores identities on undo', () => {
    const editor = mount()
    editor.commands.insertAgenda()
    const before = agenda(editor)
    editor.commands.removeAgendaItem(itemPos(editor))
    expect(agenda(editor).childCount).toBe(1)
    expect(agenda(editor).firstChild.eq(before.lastChild)).toBe(true)
    editor.commands.removeAgendaItem(itemPos(editor))
    expect(agenda(editor).childCount).toBe(0)
    editor.commands.undo()
    expect(agenda(editor).firstChild.eq(before.lastChild)).toBe(true)
    editor.commands.undo()
    expect(agenda(editor).eq(before)).toBe(true)
  })
  it('roundtrips public JSON and sanitized HTML with duration labels excluded from editable text', () => {
    const editor = mount()
    editor.commands.insertAgenda()
    editor.commands.setAgendaDuration(itemPos(editor), 21)
    editor.commands.insertContentAt(itemPos(editor) + 2, '首项标题')
    const before = editor.getJSON(), block = agenda(editor)
    expect(validateDocument(before, editor.schema)).toEqual(before)
    editor.commands.setContent(sanitizeHTML(editor.getHTML()))
    expect(agenda(editor).eq(block)).toBe(true)
    expect(agenda(editor).textContent).toBe('首项标题')
  })
  it('supports duration controls, invalid input reset and Escape cancellation without stale detached writes', () => {
    const editor = mount()
    editor.commands.insertAgenda()
    const input = editor.view.dom.querySelector('input[type="number"]')
    input.value = '21'
    input.dispatchEvent(new Event('change'))
    expect(agenda(editor).firstChild.attrs.durationMinutes).toBe(21)
    input.value = '0'
    input.dispatchEvent(new Event('change'))
    expect(input.value).toBe('21')
    input.value = '42'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(agenda(editor).firstChild.attrs.durationMinutes).toBe(21)
    const old = input
    editor.commands.setContent('<p>新文档</p>')
    const before = editor.getJSON()
    old.value = '99'; old.dispatchEvent(new Event('change'))
    expect(editor.getJSON()).toEqual(before)
  })
  it('updates readonly controls immediately and rejects API and detached DOM actions', () => {
    const editor = mount()
    editor.commands.insertAgenda()
    const before = editor.getJSON(), pos = itemPos(editor)
    editor.setEditable(false)
    expect(editor.view.dom.querySelector('input[type="number"]').disabled).toBe(true)
    expect(editor.view.dom.querySelector('[data-type="agenda-item"]').dataset.agendaEditable).toBe('false')
    expect(editor.commands.setAgendaDuration(pos, 21)).toBe(false)
    expect(editor.commands.removeAgendaItem(pos)).toBe(false)
    expect(editor.commands.insertAgenda()).toBe(false)
    expect(editor.getJSON()).toEqual(before)
    editor.setEditable(true)
    expect(editor.view.dom.querySelector('input[type="number"]').disabled).toBe(false)
  })
  it('honors facade feature and command changes while preserving existing agenda text', () => {
    const element = document.createElement('div')
    document.body.append(element)
    const doc = new LarkDoc({ element, storage: 'none', content: '<p></p>' })
    mounted.push(() => { doc.destroy(); element.remove() })
    const editor = doc.getEditor()
    editor.commands.insertAgenda()
    const saved = doc.getJSON()
    doc.setContent(saved)
    doc.patchProps({ config: { commands: { disabled: ['agenda'] } } })
    expect(editor.commands.setAgendaDuration(itemPos(editor), 22)).toBe(false)
    expect(element.querySelector('[data-type="agenda-item"]').dataset.agendaEditable).toBe('false')
    expect(doc.getJSON()).toEqual(saved)
    doc.patchProps({ config: { commands: { disabled: [] }, features: { insert: false } } })
    expect(editor.commands.insertAgenda()).toBe(false)
    doc.patchProps({ config: { features: { insert: true } } })
    expect(editor.commands.setAgendaDuration(itemPos(editor), 22)).toBe(true)
  })
  it('exports duration and rich text as portable Markdown and Word paragraphs', () => {
    const editor = mount()
    editor.commands.insertAgenda()
    editor.commands.insertContentAt(itemPos(editor) + 2, '议程一')
    const markdown = serializeMarkdown(editor.getJSON())
    expect(markdown).toContain('20 分钟')
    expect(markdown).toContain('10 分钟')
    expect(markdown).toContain('议程一')
  })
  it('preserves unsupported official agenda payloads through the existing unknown-block compatibility path', () => {
    const editor = mount()
    const legacy = { type: 'agenda', attrs: { agendaId: 'external_1', items: [{ itemId: 'item_1', durationMinutes: 20, title: '旧议程', content: '正文' }] } }
    const compatible = validateDocument({ type: 'doc', content: [legacy] }, editor.schema)
    expect(compatible.content[0].type).toBe('unknownBlock')
    expect(restoreUnknownBlocks(compatible).content[0]).toEqual(legacy)
  })
})
