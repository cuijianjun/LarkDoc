// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Schema } from '@tiptap/pm/model'
import highlighter from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'

const schema = new Schema({ nodes: {
  doc: { content: 'block+' },
  text: { group: 'inline' },
  codeBlock: { group: 'block', content: 'text*', attrs: { language: { default: 'plaintext' } } },
} })
const mounted = []
const unregister = []
let createCodeBlockNodeView
let registerFeature

beforeEach(async () => {
  vi.resetModules()
  ;({ createCodeBlockNodeView } = await import('../../src/core/nodeviews/code-block'))
  ;({ registerFeature } = await import('../../src/core/features/registry'))
  highlighter.registerLanguage('javascript', javascript)
})

afterEach(() => {
  mounted.splice(0).forEach(view => view.destroy())
  unregister.splice(0).forEach(dispose => dispose())
  vi.restoreAllMocks()
  document.body.textContent = ''
})

function mount(language = 'js', options = {}) {
  const node = schema.node('codeBlock', { language }, schema.text('const answer = 42'))
  const view = createCodeBlockNodeView({ node, editor: { isEditable: true }, extension: { options } })
  mounted.push(view)
  document.body.appendChild(view.dom)
  return { view, node, highlight: view.dom.querySelector('.lark-doc-code-highlight code') }
}

describe('代码块加载失败后的恢复', () => {
  it('同一语言下次更新重新加载，并复用并发请求而不自动循环重试', async () => {
    const loader = vi.fn().mockRejectedValueOnce(new Error('temporary highlight chunk 404')).mockResolvedValue(highlighter)
    unregister.push(registerFeature('highlight', loader))
    const first = mount()
    const second = mount('javascript')
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1))
    // 等待失败链结束；两份视图仍显示经过转义的源码。
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(first.highlight.querySelector('.hljs-keyword')).toBeNull()
    expect(second.highlight.querySelector('.hljs-keyword')).toBeNull()
    expect(loader).toHaveBeenCalledTimes(1)

    first.view.update(first.node)
    second.view.update(second.node)
    await vi.waitFor(() => {
      expect(loader).toHaveBeenCalledTimes(2)
      expect(first.highlight.querySelector('.hljs-keyword').textContent).toBe('const')
      expect(second.highlight.querySelector('.hljs-number').textContent).toBe('42')
    })
    expect(first.view.dom.querySelector('select').value).toBe('javascript')
    expect(first.node.attrs.language).toBe('js')
  })

  it('语言注册失败也能在同语言更新时恢复', async () => {
    const loaded = new Set()
    const registerLanguage = vi.fn().mockImplementationOnce(() => { throw new Error('temporary language failure') }).mockImplementation((name, grammar) => { highlighter.registerLanguage(name, grammar); loaded.add(name) })
    const runtime = {
      getLanguage: name => loaded.has(name),
      registerLanguage,
      highlight: highlighter.highlight.bind(highlighter),
    }
    unregister.push(registerFeature('highlight', () => runtime))
    const { view, node, highlight } = mount('sql')
    await vi.waitFor(() => expect(registerLanguage).toHaveBeenCalledTimes(1))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(highlight.querySelector('span')).toBeNull()
    view.update(node)
    await vi.waitFor(() => {
      expect(registerLanguage).toHaveBeenCalledTimes(2)
      expect(highlight.querySelector('.hljs-number').textContent).toBe('42')
    })
  })

  it('恢复真实图表错误原因并只通知一次应用回调', async () => {
    const error = new Error('temporary mermaid chunk 404')
    unregister.push(registerFeature('mermaid', () => Promise.reject(error)))
    const onDiagramError = vi.fn()
    const { view } = mount('mermaid', { onDiagramError })
    await vi.waitFor(() => expect(onDiagramError).toHaveBeenCalledTimes(1))
    expect(onDiagramError).toHaveBeenCalledWith(error)
    expect(view.dom.querySelector('.lark-doc-diagram-error').textContent).toContain('temporary mermaid chunk 404')
    expect(view.getState().diagramError).toContain('temporary mermaid chunk 404')
    expect(view.dom.querySelector('.lark-doc-code-body').style.display).toBe('')
  })
})
