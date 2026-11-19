// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const RUNTIME_SELECTOR = 'script[data-lark-doc-runtime="true"]'
const POLYFILL_SELECTOR = 'script[data-lark-doc-polyfills="true"]'

class MockIntersectionObserver {
  constructor(callback, options) {
    this.callback = callback
    this.options = options
    this.targets = []
    MockIntersectionObserver.instances.push(this)
  }

  observe(target) { this.targets.push(target) }

  disconnect() { this.targets = [] }

  trigger(isIntersecting = true) {
    this.callback(this.targets.map(target => ({ target, isIntersecting, intersectionRatio: isIntersecting ? 1 : 0 })), this)
  }
}
MockIntersectionObserver.instances = []

function runtimeScripts() {
  return document.querySelectorAll(RUNTIME_SELECTOR)
}

function polyfillScripts() {
  return document.querySelectorAll(POLYFILL_SELECTOR)
}

/** 清空微任务队列：polyfill 门禁把脚本注入推迟到 `.then` 里。 */
async function flush(times = 3) {
  for (let index = 0; index < times; index += 1) await Promise.resolve()
}

async function freshLoader() {
  vi.resetModules()
  return import('../../src/web-component/loader.js')
}

function appendTag(tagName = 'lark-doc') {
  const element = document.createElement(tagName)
  document.body.appendChild(element)
  return element
}

/**
 * 内核模块顶层就用到这 6 个 API，引导器靠特性检测决定是否先拉 polyfill 包。
 * 默认把测试环境伪装成「现代浏览器」，让每个用例只验证引导逻辑本身。
 */
const MODERN_APIS = [
  [Array.prototype, 'at'],
  [Array.prototype, 'findLast'],
  [Array.prototype, 'findLastIndex'],
  [Object, 'hasOwn'],
  [String.prototype, 'replaceAll'],
]
let restoreApis = []

function stubModernApis() {
  restoreApis = []
  for (const [owner, key] of MODERN_APIS) {
    if (typeof owner[key] === 'function') continue
    restoreApis.push([owner, key, Object.getOwnPropertyDescriptor(owner, key)])
    Object.defineProperty(owner, key, { configurable: true, writable: true, value: () => {} })
  }
  if (typeof globalThis.structuredClone !== 'function') {
    restoreApis.push([globalThis, 'structuredClone', Object.getOwnPropertyDescriptor(globalThis, 'structuredClone')])
    globalThis.structuredClone = value => value
  }
}

/**
 * 逐个拔掉 API 模拟旧浏览器。必须登记原描述符：vitest 自身也依赖
 * `Object.hasOwn`，漏登记会让整个 runner 在收尾阶段炸掉。
 * 只拔一个就足以让 needsPolyfills() 返回 true。
 */
function breakApi(owner, key) {
  restoreApis.push([owner, key, Object.getOwnPropertyDescriptor(owner, key)])
  Object.defineProperty(owner, key, { configurable: true, writable: true, value: undefined })
}

beforeEach(() => {
  MockIntersectionObserver.instances = []
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
  document.body.innerHTML = ''
  document.head.innerHTML = ''
  stubModernApis()
})

afterEach(() => {
  document.body.innerHTML = ''
  document.head.innerHTML = ''
  for (const [owner, key, descriptor] of restoreApis) {
    if (descriptor) Object.defineProperty(owner, key, descriptor)
    else delete owner[key]
  }
  restoreApis = []
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Element 引导器只在需要时拉 runtime（L0）', () => {
  it('文档里没有 lark-doc 时不发任何请求', async () => {
    await freshLoader()
    await flush()
    expect(runtimeScripts()).toHaveLength(0)
    expect(polyfillScripts()).toHaveLength(0)
    expect(MockIntersectionObserver.instances).toHaveLength(1)
    expect(MockIntersectionObserver.instances[0].targets).toHaveLength(0)
  })

  it('元素在视口外不请求，进入视口前 400px 才请求', async () => {
    appendTag()
    await freshLoader()
    const observer = MockIntersectionObserver.instances.at(-1)
    expect(observer.options).toEqual({ rootMargin: '400px' })
    expect(observer.targets).toHaveLength(1)
    await flush()
    expect(runtimeScripts()).toHaveLength(0)

    observer.trigger(false)
    await flush()
    expect(runtimeScripts()).toHaveLength(0)

    observer.trigger(true)
    await flush()
    expect(runtimeScripts()).toHaveLength(1)
    expect(observer.targets).toHaveLength(0)
  })

  it('运行时动态插入的 lark-doc 也会被观察到', async () => {
    await freshLoader()
    const observer = MockIntersectionObserver.instances.at(-1)
    expect(observer.targets).toHaveLength(0)

    appendTag()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(observer.targets).toHaveLength(1)

    observer.trigger(true)
    await flush()
    expect(runtimeScripts()).toHaveLength(1)
  })

  it('嵌套结构里插入的 lark-doc 同样能触发', async () => {
    await freshLoader()
    const observer = MockIntersectionObserver.instances.at(-1)
    const wrapper = document.createElement('section')
    document.body.appendChild(wrapper)
    wrapper.appendChild(document.createElement('lark-doc'))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(observer.targets).toHaveLength(1)
  })

  it('runtimeReady() 在未触发时调用会立即拉取', async () => {
    const loader = await freshLoader()
    expect(runtimeScripts()).toHaveLength(0)
    loader.runtimeReady()
    await flush()
    expect(runtimeScripts()).toHaveLength(1)
  })

  it('旧的 await LarkDoc.runtimeReady 写法仍然有效（thenable 兼容）', async () => {
    const loader = await freshLoader()
    expect(runtimeScripts()).toHaveLength(0)
    // 只验证 thenable 会触发加载；jsdom 不会真的执行 onload，不能 await 它的结果。
    const promise = Promise.resolve(loader.runtimeReady)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(runtimeScripts()).toHaveLength(1)
    expect(promise).toBeInstanceOf(Promise)
  })

  it('宿主已自行注册标签时不做任何观察与请求', async () => {
    // jsdom 的自定义元素注册表跨用例常驻，这里只伪造「已定义」这一事实。
    vi.spyOn(customElements, 'get').mockReturnValue(class extends HTMLElement {})
    appendTag()
    await freshLoader()
    expect(MockIntersectionObserver.instances).toHaveLength(0)
    await flush()
    expect(runtimeScripts()).toHaveLength(0)
  })

  it('占位样式保证 runtime 到位前元素不塌陷', async () => {
    appendTag()
    await freshLoader()
    const style = document.getElementById('lark-doc-placeholder')
    expect(style).not.toBeNull()
    expect(style.textContent).toContain('lark-doc:not(:defined)')
    expect(style.textContent).toContain('--lark-doc-placeholder-height')
  })

  it('没有 IntersectionObserver 的老浏览器退化为有元素即加载', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    appendTag()
    await freshLoader()
    await flush()
    expect(runtimeScripts()).toHaveLength(1)
  })

  it('同一份 loader 重复调用 runtimeReady 只注入一次脚本', async () => {
    const loader = await freshLoader()
    loader.runtimeReady()
    loader.runtimeReady()
    await flush()
    expect(runtimeScripts()).toHaveLength(1)
  })
})

describe('polyfill 门禁（core-js 已移出内核）', () => {
  it.each([false, true])('runtime exports join the UMD namespace without replacing the bootstrap (existing script: %s)', async existing => {
    const loader = await freshLoader()
    class RuntimeLarkDoc {}
    const namespace = { loadLarkDocRuntime: loader.loadLarkDocRuntime }
    const runtime = { LarkDoc: RuntimeLarkDoc, mountLarkDoc: vi.fn(), __esModule: true }
    vi.stubGlobal('LarkDoc', namespace)
    vi.stubGlobal('LarkDocRuntime', runtime)
    if (existing) {
      const script = document.createElement('script')
      script.dataset.larkDocRuntime = 'true'
      document.head.append(script)
    }
    const pending = loader.loadLarkDocRuntime()
    await flush()
    if (!existing) runtimeScripts()[0].onload()
    expect(await pending).toBe(namespace)
    expect(window.LarkDoc.LarkDoc).toBe(RuntimeLarkDoc)
    expect(window.LarkDoc.mountLarkDoc).toBe(runtime.mountLarkDoc)
    expect(window.LarkDoc.loadLarkDocRuntime).toBe(loader.loadLarkDocRuntime)
    expect(window.LarkDocRuntime).toBe(runtime)
    expect(namespace).not.toHaveProperty('__esModule')
    expect(runtimeScripts()).toHaveLength(1)
  })

  it.each(['onerror', 'onload'])('releases a failed runtime load shared by two loaders through %s', async event => {
    const first = await freshLoader()
    const second = await freshLoader()
    const namespace = { loadLarkDocRuntime: second.loadLarkDocRuntime }
    vi.stubGlobal('LarkDoc', namespace)
    const ready = vi.fn()
    document.addEventListener('lark-doc:runtime-ready', ready)
    try {
      const firstLoad = first.loadLarkDocRuntime()
      const secondLoad = second.loadLarkDocRuntime()
      const failed = Promise.allSettled([firstLoad, secondLoad])
      await flush()
      expect(runtimeScripts()).toHaveLength(1)
      runtimeScripts()[0][event]()
      expect((await failed).map(result => result.status)).toEqual(['rejected', 'rejected'])
      expect(runtimeScripts()).toHaveLength(0)
      expect(ready).not.toHaveBeenCalled()

      const retried = second.loadLarkDocRuntime()
      await flush()
      class RuntimeLarkDoc {}
      vi.stubGlobal('LarkDocRuntime', { LarkDoc: RuntimeLarkDoc })
      runtimeScripts()[0].onload()
      await expect(retried).resolves.toBe(namespace)
      await expect(first.loadLarkDocRuntime()).resolves.toBe(namespace)
      expect(namespace.LarkDoc).toBe(RuntimeLarkDoc)
      expect(ready).toHaveBeenCalledOnce()
    } finally {
      document.removeEventListener('lark-doc:runtime-ready', ready)
    }
  })

  it('现代环境完全不请求 polyfill 包', async () => {
    appendTag()
    const loader = await freshLoader()
    loader.runtimeReady()
    await flush()
    expect(polyfillScripts()).toHaveLength(0)
    expect(runtimeScripts()).toHaveLength(1)
  })

  it('旧环境先拉 polyfill，polyfill 到位后才注入内核', async () => {
    breakApi(Array.prototype, 'findLastIndex')
    const loader = await freshLoader()
    loader.runtimeReady()
    await flush()

    expect(polyfillScripts()).toHaveLength(1)
    // 内核此刻必须还没动：顺序反了旧浏览器会直接在模块求值阶段抛错。
    expect(runtimeScripts()).toHaveLength(0)

    polyfillScripts()[0].onload()
    await flush()
    expect(runtimeScripts()).toHaveLength(1)
  })

  it('polyfill 加载失败不阻断内核', async () => {
    breakApi(Array.prototype, 'findLastIndex')
    const loader = await freshLoader()
    loader.runtimeReady()
    await flush()

    expect(polyfillScripts()).toHaveLength(1)
    polyfillScripts()[0].onerror()
    await flush()
    // 补丁挂了也要把内核放进去，必要时由内核自己或宿主兜底。
    expect(runtimeScripts()).toHaveLength(1)
  })

  it('polyfill 只请求一次，内核复用同一份 promise', async () => {
    breakApi(Array.prototype, 'findLastIndex')
    const loader = await freshLoader()
    loader.runtimeReady()
    loader.loadLarkDocRuntime()
    await flush()
    expect(polyfillScripts()).toHaveLength(1)
  })

  // 只挑不会被测试框架自身用到的两项：`at` 和 `Object.hasOwn` 一旦拔掉，
  // vitest 自己的 callstack 就会崩，测不到引导逻辑。
  it.each([
    [Array.prototype, 'findLast'],
    [Array.prototype, 'findLastIndex'],
  ])('缺少 %s 时同样会拉 polyfill 包', async (owner, key) => {
    breakApi(owner, key)
    const loader = await freshLoader()
    loader.runtimeReady()
    await flush()
    expect(polyfillScripts()).toHaveLength(1)
  })
})

describe('样式表独立加载（CSS 已移出内核）', () => {
  const STYLE_SELECTOR = 'link[data-lark-doc-style="true"]'

  it('拉内核时同时注入样式表，且只注入一次', async () => {
    const loader = await freshLoader()
    expect(document.querySelectorAll(STYLE_SELECTOR)).toHaveLength(0)
    loader.runtimeReady()
    loader.runtimeReady()
    await flush()
    const links = document.querySelectorAll(STYLE_SELECTOR)
    expect(links).toHaveLength(1)
    expect(links[0].rel).toBe('stylesheet')
    expect(links[0].href).toContain('lark-doc-element.css')
  })

  it('样式表先于内核脚本入队，保证并行下载', async () => {
    const loader = await freshLoader()
    loader.runtimeReady()
    await flush()
    const head = [...document.head.children].map(node => node.localName)
    expect(head.indexOf('link')).toBeLessThan(head.indexOf('script'))
  })
})
