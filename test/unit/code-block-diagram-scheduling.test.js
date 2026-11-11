// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Schema } from '@tiptap/pm/model'

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
})

afterEach(() => {
  mounted.splice(0).forEach(view => view.destroy())
  unregister.splice(0).forEach(dispose => dispose())
  vi.restoreAllMocks()
  document.documentElement.removeAttribute('data-content-theme')
  document.body.textContent = ''
})

function node(source) {
  return schema.node('codeBlock', { language: 'mermaid' }, schema.text(source))
}
function mount(source = 'const answer = 42', options = {}) {
  const view = createCodeBlockNodeView({ node: node(source), editor: { isEditable: true }, extension: { options } })
  mounted.push(view)
  document.body.appendChild(view.dom)
  return view
}
function mockMermaid() {
  const render = vi.fn(async () => ({ svg: '<svg><text>节点</text></svg>' }))
  unregister.push(registerFeature('mermaid', () => ({ initialize: vi.fn(), render })))
  return render
}

describe('图表渲染调度：离散动作立即渲染，逐字编辑才防抖', () => {
  it('首次挂载不等待 300ms 防抖就渲染', async () => {
    const render = mockMermaid()
    const started = Date.now()
    const view = mount()
    await vi.waitFor(() => expect(view.dom.querySelector('.lark-doc-diagram-svg svg')).not.toBeNull())
    expect(render).toHaveBeenCalledTimes(1)
    expect(Date.now() - started).toBeLessThan(250)
  })

  it('逐字输入仍走 300ms 防抖，只在停手后渲染一次', async () => {
    const render = mockMermaid()
    const view = mount()
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1))
    view.update(node('const answer = 42x'))
    await new Promise(resolve => setTimeout(resolve, 60))
    expect(render).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2), { timeout: 1500 })
  })

  it('在源码中间插入单个字符仍走防抖，不会每键立即重渲染', async () => {
    const render = mockMermaid()
    const source = 'graph TD\n  A[S0] --> B[渲染完成]'
    const view = mount(source)
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1))
    view.update(node('graph TD\n  A[S0x] --> B[渲染完成]'))
    await new Promise(resolve => setTimeout(resolve, 60))
    expect(render).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2), { timeout: 1500 })
  })

  it('整篇替换（setContent / 粘贴 / 切换笔记）立即渲染', async () => {
    const render = mockMermaid()
    const view = mount()
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1))
    const started = Date.now()
    view.update(node('graph LR\n  A[另一篇文档] --> B[节点]'))
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2))
    expect(Date.now() - started).toBeLessThan(250)
  })

  it('同一份源码的重复 update 不产生多余渲染', async () => {
    const render = mockMermaid()
    const view = mount()
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1))
    view.update(node('const answer = 42'))
    view.update(node('const answer = 42'))
    await new Promise(resolve => setTimeout(resolve, 350))
    expect(render).toHaveBeenCalledTimes(1)
  })

  it('正文轨换档即使源码不变也会用新配色重画', async () => {
    const render = mockMermaid()
    const view = mount()
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1))
    document.documentElement.setAttribute('data-content-theme', 'dark')
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2), { timeout: 2000 })
    expect(view.getState().contentTheme).toBe('dark')
  })
})
