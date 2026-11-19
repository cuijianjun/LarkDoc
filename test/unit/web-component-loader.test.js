import { afterEach, describe, expect, it } from 'vitest'
import { loadLarkDocRuntime } from '../../src/web-component/loader'

/**
 * UMD 宿主契约：`window.LarkDoc` 是唯一的对外命名空间。
 *
 * runtime 是独立产物、全局名是 `window.LarkDocRuntime`（`standalone.js`），
 * 主入口（`loader.js`）负责把它并进 `window.LarkDoc`。少了这一步，
 * `new window.LarkDoc.LarkDoc(...)` 与 `new window.LarkDoc.LarkDoc` 全是
 * TypeError —— 线上 demo 与静态示例就是这么白屏的（0.14.10 实测）。
 */

const saved = {}

function stubGlobals({ larkDoc, runtime }) {
  saved.window = globalThis.window
  saved.document = globalThis.document
  const script = { dataset: { larkDocRuntime: 'true' } }
  globalThis.window = { LarkDoc: larkDoc, LarkDocRuntime: runtime }
  globalThis.document = { querySelector: () => script }
  return script
}

afterEach(() => {
  if ('window' in saved) { if (saved.window === undefined) delete globalThis.window; else globalThis.window = saved.window }
  if ('document' in saved) { if (saved.document === undefined) delete globalThis.document; else globalThis.document = saved.document }
  delete saved.window
  delete saved.document
})

describe('Web Component loader · 全局命名空间对齐', () => {
  it('runtime 到位后把导出并进 window.LarkDoc，构造器可 new', async () => {
    class RuntimeLarkDoc { constructor(options) { this.options = options } }
    const mountLarkDoc = () => 'mounted'
    const larkDoc = { loadLarkDocRuntime: () => null, runtimeReady: null }
    stubGlobals({ larkDoc, runtime: { __esModule: true, LarkDoc: RuntimeLarkDoc, mountLarkDoc, default: RuntimeLarkDoc } })

    const ns = await loadLarkDocRuntime()

    expect(ns).toBe(window.LarkDoc)
    expect(window.LarkDoc.LarkDoc).toBe(RuntimeLarkDoc)
    expect(window.LarkDoc.mountLarkDoc).toBe(mountLarkDoc)
    // 主入口自己的 API 不能被覆盖掉
    expect(typeof window.LarkDoc.loadLarkDocRuntime).toBe('function')
    // 直接引 runtime 的老用法同样保留
    expect(window.LarkDocRuntime.LarkDoc).toBe(RuntimeLarkDoc)
    // __esModule 不该被搬过去（避免被打包器误判成 ES 模块）
    expect('__esModule' in window.LarkDoc).toBe(false)
    expect(() => new window.LarkDoc.LarkDoc({ element: '#host' })).not.toThrow()
  })

  it('没有主入口命名空间时原样返回 runtime，不凭空造对象', async () => {
    const runtime = { LarkDoc: class RuntimeLarkDoc {} }
    stubGlobals({ larkDoc: undefined, runtime })

    const ns = await loadLarkDocRuntime()

    expect(ns).toBe(runtime)
  })

  it('runtime 还没到就返回 null，不会把半成品命名空间当成就绪', async () => {
    const larkDoc = { loadLarkDocRuntime: () => null, runtimeReady: null }
    stubGlobals({ larkDoc, runtime: undefined })

    expect(await loadLarkDocRuntime()).toBeNull()
    expect(window.LarkDoc.LarkDoc).toBeUndefined()
  })
})
