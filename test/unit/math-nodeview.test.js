// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import katex from 'katex'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import { registerFeature } from '../../src/core/features/registry'
import { LarkDoc } from '../../src/LarkDoc'
import { createDocumentSession } from '../../src/session/DocumentSession'

let unregister
const mounted = []
beforeEach(() => {
  unregister = registerFeature('math', () => Promise.resolve(katex))
  const createRange = document.createRange.bind(document)
  vi.spyOn(document, 'createRange').mockImplementation(() => Object.assign(createRange(), {
    getClientRects: () => [], getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }),
  }))
})
afterEach(() => { mounted.splice(0).forEach(destroy => destroy()); unregister?.(); vi.restoreAllMocks() })

function content(latex = '', type = 'inlineMath') {
  const node = { type, attrs: { latex, ...(type === 'blockMath' ? { blockId: 'math_block' } : {}) } }
  return { type: 'doc', content: type === 'blockMath' ? [node] : [{ type: 'paragraph', attrs: { blockId: 'math_p' }, content: [node] }] }
}
function mount(latex = '', type = 'inlineMath', config) {
  const element = document.createElement('div')
  element.className = 'lark-doc'
  document.body.appendChild(element)
  const editor = new Editor({ element, extensions: createLarkDocExtensions({ config }), content: content(latex, type) })
  mounted.push(() => { editor.destroy(); element.remove() })
  return editor
}
const math = editor => editor.view.dom.querySelector('[data-type="inline-math"],[data-type="block-math"]')
const popup = () => document.querySelector('.lark-doc-math-editor')
const input = () => popup()?.querySelector('textarea')
function edit(value) { input().value = value; input().dispatchEvent(new Event('input', { bubbles: true })) }
function finish() { input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) }
const latex = editor => { let result; editor.state.doc.descendants(node => { if (node.type.name === 'inlineMath' || node.type.name === 'blockMath') result = node.attrs.latex }); return result }

describe('Feishu math editor', () => {
  it('opens on the formula, focuses raw LaTeX and saves on Escape instead of cancelling', async () => {
    const editor = mount('x^2+1')
    math(editor).click()
    expect(popup()).not.toBeNull()
    expect(document.activeElement).toBe(input())
    expect(input().value).toBe('x^2+1')
    expect(popup().textContent).toContain('按 ESC 完成输入')
    edit('x^2+1+3')
    expect(latex(editor)).toBe('x^2+1+3')
    finish()
    expect(popup()).toBeNull()
    await vi.waitFor(() => expect(math(editor).querySelector('.katex')).not.toBeNull())
    math(editor).click()
    expect(input().value).toBe('x^2+1+3')
  })

  it('keeps empty and invalid expressions editable and retains their exact source', async () => {
    const editor = mount()
    math(editor).click()
    finish()
    expect(math(editor).textContent).toBe('添加 LaTeX 公式')
    math(editor).click()
    edit('\\badcommand{')
    await vi.waitFor(() => expect(math(editor).textContent).toContain('无效公式'))
    finish()
    expect(latex(editor)).toBe('\\badcommand{')
    math(editor).click()
    expect(input().value).toBe('\\badcommand{')
    edit('x+1')
    finish()
    await vi.waitFor(() => expect(math(editor).querySelector('.katex')).not.toBeNull())
  })

  it('supports multiline input, outside finish and one-step undo of an editing session', () => {
    const editor = mount('x')
    math(editor).click()
    edit('x+1')
    edit('x+1\n+2')
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    expect(popup()).toBeNull()
    expect(latex(editor)).toBe('x+1\n+2')
    editor.commands.undo()
    expect(latex(editor)).toBe('x')
    editor.commands.redo()
    expect(latex(editor)).toBe('x+1\n+2')
  })

  it('preserves math JSON/HTML, atom deletion and undo', () => {
    const editor = mount('x^2+1')
    const html = editor.getHTML()
    editor.commands.setContent(html)
    expect(latex(editor)).toBe('x^2+1')
    editor.commands.deleteRange({ from: 1, to: 2 })
    expect(latex(editor)).toBeUndefined()
    editor.commands.undo()
    expect(latex(editor)).toBe('x^2+1')
  })

  it.each(['inlineMath', 'blockMath'])('keeps legacy %s readable and blocks its editor in readonly / disabled feature', type => {
    const editor = mount('x+1', type, { features: { math: false } })
    math(editor).click()
    expect(popup()).toBeNull()
    editor.setEditable(false)
    math(editor).click()
    expect(popup()).toBeNull()
    expect(latex(editor)).toBe('x+1')
  })

  it('closes on runtime feature disable and rejects late textarea events', async () => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, storage: 'none', content: content('x') })
    mounted.push(() => { doc.destroy(); element.remove() })
    math(doc.getEditor()).click()
    const stale = input()
    expect(stale).not.toBeNull()
    stale.dispatchEvent(new Event('compositionstart', { bubbles: true }))
    stale.value = '\\text{中文}'
    stale.dispatchEvent(new Event('input', { bubbles: true }))
    doc.patchProps({ config: { features: { math: false } } })
    await Promise.resolve()
    expect(popup()).toBeNull()
    stale.value = 'stale'
    stale.dispatchEvent(new Event('compositionend', { bubbles: true }))
    stale.dispatchEvent(new Event('input', { bubbles: true }))
    expect(latex(doc.getEditor())).toBe('x')
  })

  it('closes safely when its atom is removed and never writes into the replacement document', () => {
    const editor = mount('x')
    math(editor).click()
    const stale = input()
    editor.commands.setContent('<p>新文档</p>')
    stale.value = 'late'
    stale.dispatchEvent(new Event('input', { bubbles: true }))
    expect(popup()).toBeNull()
    expect(editor.state.doc.textContent).toBe('新文档')
  })

  it('finishes an in-progress IME expression before removing the outside-click editor', () => {
    const editor = mount('x')
    math(editor).click()
    const composingInput = input()
    composingInput.dispatchEvent(new Event('compositionstart', { bubbles: true }))
    composingInput.value = '\\text{中文}'
    composingInput.dispatchEvent(new Event('input', { bubbles: true }))
    expect(latex(editor)).toBe('x')
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    composingInput.dispatchEvent(new Event('compositionend', { bubbles: true }))
    expect(latex(editor)).toBe('\\text{中文}')
    expect(popup()).toBeNull()
  })

  it('finishes an offscreen IME editor without recursive positioning or lost characters', () => {
    const editor = mount('x'), element = math(editor)
    element.click()
    input().dispatchEvent(new Event('compositionstart', { bubbles: true }))
    input().value = '\\text{中文}'
    input().dispatchEvent(new Event('input', { bubbles: true }))
    element.getBoundingClientRect = () => ({ top: -100, bottom: -80, left: 100, right: 120, width: 20, height: 20 })
    window.dispatchEvent(new Event('scroll'))
    expect(popup()).toBeNull()
    expect(latex(editor)).toBe('\\text{中文}')
  })

  it('does not leave viewport listeners when opening an already offscreen formula', () => {
    const editor = mount('x'), element = math(editor)
    element.getBoundingClientRect = () => ({ top: -100, bottom: -80, left: 100, right: 120, width: 20, height: 20 })
    const add = vi.spyOn(window, 'addEventListener')
    element.click()
    expect(popup()).toBeNull()
    expect(add.mock.calls.filter(([event]) => event === 'resize' || event === 'scroll')).toHaveLength(0)
  })

  it('discards deferred renderer completion after removal', async () => {
    let resolve
    const renderer = { render: vi.fn() }
    unregister()
    unregister = registerFeature('math', () => new Promise(done => { resolve = done }))
    const editor = mount('x')
    await Promise.resolve()
    editor.commands.setContent('<p>替换正文</p>')
    resolve(renderer)
    await new Promise(done => setTimeout(done, 0))
    expect(renderer.render).not.toHaveBeenCalled()
    expect(editor.state.doc.textContent).toBe('替换正文')
  })

  it('retries a failed renderer without losing raw LaTeX', async () => {
    let failed = true
    unregister()
    unregister = registerFeature('math', () => failed ? Promise.reject(new Error('fixture renderer unavailable')) : Promise.resolve(katex))
    const editor = mount('x^2')
    await vi.waitFor(() => expect(math(editor).textContent).toContain('加载失败'))
    failed = false
    math(editor).click()
    expect(input().value).toBe('x^2')
    await vi.waitFor(() => expect(math(editor).querySelector('.katex')).not.toBeNull())
    expect(latex(editor)).toBe('x^2')
  })

  it('closes on actual facade session replacement even when the math expression is unchanged', async () => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const a = createDocumentSession({ documentId: 'math-a' }), b = createDocumentSession({ documentId: 'math-b' })
    const doc = new LarkDoc({ element, storage: 'none', session: a, content: content('x') })
    mounted.push(() => { doc.destroy(); element.remove() })
    math(doc.getEditor()).click()
    const stale = input()
    stale.dispatchEvent(new Event('compositionstart', { bubbles: true }))
    stale.value = '\\text{旧文档组字}'
    stale.dispatchEvent(new Event('input', { bubbles: true }))
    doc.patchProps({ session: b })
    await Promise.resolve()
    expect(popup()).toBeNull()
    stale.value = 'old session'
    stale.dispatchEvent(new Event('compositionend', { bubbles: true }))
    stale.dispatchEvent(new Event('input', { bubbles: true }))
    expect(latex(doc.getEditor())).not.toBe('old session')
  })
})
