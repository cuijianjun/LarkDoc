// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let renderDiagram
let registerFeature
const disposers = []

function runtime(label) {
  return {
    initialize: vi.fn(),
    render: vi.fn(async () => ({ svg: `<svg><text>${label}</text></svg>` })),
  }
}

beforeEach(async () => {
  vi.resetModules()
  delete window.mermaid
  ;({ renderDiagram } = await import('../../src/core/diagram'))
  ;({ registerFeature } = await import('../../src/core/features/registry'))
})

afterEach(() => {
  disposers.splice(0).forEach(dispose => dispose())
  vi.restoreAllMocks()
  delete window.mermaid
  document.head.querySelectorAll('script[data-lark-doc-diagram]').forEach(script => script.remove())
  document.body.textContent = ''
})

describe('图表渲染器加载隔离', () => {
  it('不完整的宿主全局对象不能阻止已注册的渲染器加载', async () => {
    window.mermaid = { initialize: vi.fn() }
    const renderer = runtime('bundled')
    disposers.push(registerFeature('mermaid', () => renderer))
    await expect(renderDiagram('graph TD\n A --> B')).resolves.toContain('bundled')
    expect(window.mermaid.initialize).not.toHaveBeenCalled()
  })

  it('显式脚本地址不能被已有全局或默认缓存跳过', async () => {
    const old = runtime('old')
    const custom = runtime('custom')
    window.mermaid = old
    await renderDiagram('graph TD\n A --> B')
    const pending = renderDiagram('graph TD\n A --> C', { scriptUrl: '/local/mermaid.js' })
    await vi.waitFor(() => expect(document.head.querySelector('script[data-lark-doc-diagram]')).not.toBeNull())
    const script = document.head.querySelector('script[data-lark-doc-diagram]')
    expect(script.getAttribute('src')).toBe('/local/mermaid.js')
    window.mermaid = custom
    script.onload()
    await expect(pending).resolves.toContain('custom')
    expect(custom.initialize).toHaveBeenCalledTimes(1)
    expect(old.initialize).toHaveBeenCalledTimes(1)
    expect(old.render).toHaveBeenCalledTimes(1)
  })

  it('不同脚本地址分别加载，同地址并发仅请求一次，失败后可重试', async () => {
    const options = { scriptUrl: '/local/first.js' }
    const first = renderDiagram('first', options)
    const duplicate = renderDiagram('duplicate', options)
    await vi.waitFor(() => expect(document.head.querySelectorAll('script[data-lark-doc-diagram]')).toHaveLength(1))
    const failedScript = document.head.querySelector('script[data-lark-doc-diagram]')
    const failures = Promise.allSettled([first, duplicate])
    failedScript.onerror()
    const results = await failures
    expect(results.every(result => result.status === 'rejected')).toBe(true)
    expect(failedScript.isConnected).toBe(false)

    const retry = renderDiagram('retry', options)
    await vi.waitFor(() => expect(document.head.querySelectorAll('script[data-lark-doc-diagram]')).toHaveLength(1))
    window.mermaid = runtime('first')
    document.head.querySelector('script[data-lark-doc-diagram]').onload()
    await expect(retry).resolves.toContain('first')

    const second = renderDiagram('second', { scriptUrl: '/local/second.js' })
    await vi.waitFor(() => expect(document.head.querySelector('script[src="/local/second.js"]')).not.toBeNull())
    window.mermaid = runtime('second')
    document.head.querySelector('script[src="/local/second.js"]').onload()
    await expect(second).resolves.toContain('second')
  })

  it('自定义脚本导出无效接口时保留具体错误且不调用旧全局', async () => {
    const old = runtime('old')
    window.mermaid = old
    const pending = renderDiagram('graph TD', { scriptUrl: '/local/broken.js' })
    const failure = expect(pending).rejects.toThrow('initialize / render')
    await vi.waitFor(() => expect(document.head.querySelector('script[data-lark-doc-diagram]')).not.toBeNull())
    window.mermaid = { initialize: vi.fn() }
    document.head.querySelector('script[data-lark-doc-diagram]').onload()
    await failure
    expect(document.head.querySelector('script[data-lark-doc-diagram]')).toBeNull()
    expect(window.mermaid).toBe(old)
    expect(old.render).not.toHaveBeenCalled()
  })

  it('不同地址并发时串行捕获导出，空导出不能误用旧全局，缓存身份保持独立', async () => {
    const old = runtime('host')
    window.mermaid = old
    const first = renderDiagram('first', { scriptUrl: '/local/a.js' })
    const second = renderDiagram('second', { scriptUrl: '/local/b.js' })
    const secondFailure = expect(second).rejects.toThrow('initialize / render')
    await vi.waitFor(() => expect(document.head.querySelector('script[src="/local/a.js"]')).not.toBeNull())
    expect(document.head.querySelector('script[src="/local/b.js"]')).toBeNull()
    const a = runtime('a')
    window.mermaid = a
    document.head.querySelector('script[src="/local/a.js"]').onload()
    await expect(first).resolves.toContain('a')
    await vi.waitFor(() => expect(document.head.querySelector('script[src="/local/b.js"]')).not.toBeNull())
    expect(window.mermaid).toBeUndefined()
    document.head.querySelector('script[src="/local/b.js"]').onload()
    await secondFailure
    expect(window.mermaid).toBe(a)
    await expect(renderDiagram('cached', { scriptUrl: '/local/a.js' })).resolves.toContain('a')
    expect(a.initialize).toHaveBeenCalledTimes(1)
    expect(old.render).not.toHaveBeenCalled()
  })
})
