import { afterEach, describe, expect, it, vi } from 'vitest'
import toolbarCollapseMixin from '../../src/components/lark-doc/editor/toolbarCollapseMixin'

// 用可控布局尺寸和 nextTick 验证调度协议；不冒充浏览器几何/Safari验收。
function harness({ capacity = 7 } = {}) {
  const ticks = []
  const frames = new Map()
  const observers = []
  let frameId = 0
  let bar
  const root = { querySelector: () => bar }
  const ctx = {
    ...toolbarCollapseMixin.data(),
    $refs: { root },
    $nextTick: () => new Promise(resolve => ticks.push(resolve)),
  }
  Object.entries(toolbarCollapseMixin.methods).forEach(([name, fn]) => { ctx[name] = fn.bind(ctx) })
  ctx.closeMoreMenu = vi.fn(ctx.closeMoreMenu)
  ctx.teardownMoreMenu = vi.fn()
  function newBar() {
    return {
      get scrollWidth() { return (7 - ctx.collapsedGroups.length) * 100 },
      get clientWidth() { return capacity * 100 },
    }
  }
  bar = newBar()
  vi.stubGlobal('requestAnimationFrame', fn => { frames.set(++frameId, fn); return frameId })
  vi.stubGlobal('cancelAnimationFrame', id => frames.delete(id))
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback) { this.callback = callback; this.observe = vi.fn(); this.disconnect = vi.fn(); observers.push(this) }
  })
  return {
    ctx, ticks, frames, observers,
    hide() { bar = null },
    replace() { bar = newBar() },
    widen() { capacity = 7 },
    async drain() {
      for (let i = 0; i < 40 && ticks.length; i += 1) { ticks.shift()(); await Promise.resolve() }
      expect(ticks).toHaveLength(0)
    },
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('工具栏折叠布局生命周期', () => {
  it('窄栏依优先序收纳，试展开溢出时回填，变宽后逆序恢复', async () => {
    const h = harness({ capacity: 4 })
    const task = h.ctx.evaluateToolbarFit()
    await h.drain()
    await task
    expect(h.ctx.collapsedGroups).toEqual(['toolsEnd', 'insert', 'blockStyle'])
    h.widen()
    const restore = h.ctx.evaluateToolbarFit()
    await h.drain()
    await restore
    expect(h.ctx.collapsedGroups).toEqual([])
    expect(h.ctx._fitRunning).toBe(false)
  })

  it('收纳停在nextTick时隐藏，旧任务不能重新写回折叠组', async () => {
    const h = harness({ capacity: 0 })
    h.ctx.bindToolbarObserver()
    expect(h.ctx.collapsedGroups).toEqual(['toolsEnd'])
    h.hide()
    h.ctx.bindToolbarObserver()
    expect(h.observers[0].disconnect).toHaveBeenCalledOnce()
    expect(h.ctx.closeMoreMenu).toHaveBeenCalledOnce()
    await h.drain()
    expect(h.ctx.collapsedGroups).toEqual([])
    expect(h.ctx._fitRunning).toBe(false)
  })

  it('重绑期间旧任务失效，pending接续新栏的布局而不吞掉重算', async () => {
    const h = harness({ capacity: 0 })
    h.ctx.bindToolbarObserver()
    h.replace()
    h.widen()
    h.ctx.bindToolbarObserver()
    expect(h.ctx._fitPending).toBe(true)
    expect(h.observers).toHaveLength(2)
    await h.drain()
    expect(h.ctx.collapsedGroups).toEqual([])
    expect(h.ctx._fitRunning).toBe(false)
    expect(h.ctx._fitPending).toBe(false)
    expect(h.observers[0].disconnect).toHaveBeenCalledOnce()
    expect(h.observers[1].observe).toHaveBeenCalledOnce()
  })

  it('展开停在nextTick时隐藏，不把旧栏的溢出回填到新状态', async () => {
    const h = harness({ capacity: 6 })
    h.ctx.collapsedGroups = ['toolsEnd']
    const task = h.ctx.evaluateToolbarFit()
    expect(h.ctx.collapsedGroups).toEqual([])
    h.hide()
    h.ctx.bindToolbarObserver()
    await h.drain()
    await task
    expect(h.ctx.collapsedGroups).toEqual([])
  })

  it('未重绑但DOM已替换时，旧任务也必须停下', async () => {
    const h = harness({ capacity: 0 })
    const task = h.ctx.evaluateToolbarFit()
    h.replace()
    await h.drain()
    await task
    expect(h.ctx.collapsedGroups).toEqual(['toolsEnd'])
    expect(h.ctx._fitRunning).toBe(false)
  })

  it('销毁消费挂起布局，并拒绝迟到observer和已取消RAF回调', async () => {
    const h = harness({ capacity: 0 })
    h.ctx.bindToolbarObserver()
    const observer = h.observers[0]
    observer.callback()
    const staleFrame = [...h.frames.values()][0]
    toolbarCollapseMixin.beforeDestroy.call(h.ctx)
    const groups = [...h.ctx.collapsedGroups]
    expect(h.frames.size).toBe(0)
    observer.callback()
    staleFrame()
    h.ctx.bindToolbarObserver()
    await h.drain()
    expect(h.ctx.collapsedGroups).toEqual(groups)
    expect(h.ctx._fitRunning).toBe(false)
    expect(h.ctx._fitPending).toBe(false)
    expect(h.frames.size).toBe(0)
    expect(h.observers).toHaveLength(1)
    expect(observer.disconnect).toHaveBeenCalledOnce()
    expect(h.ctx.teardownMoreMenu).toHaveBeenCalledOnce()
  })

  it('连续resize仅保留一个RAF，运行中请求合并为pending', async () => {
    const h = harness({ capacity: 4 })
    h.ctx.bindToolbarObserver()
    const observer = h.observers[0]
    observer.callback()
    observer.callback()
    expect(h.frames.size).toBe(1)
    const [id, callback] = [...h.frames.entries()][0]
    h.frames.delete(id)
    callback()
    expect(h.ctx._fitPending).toBe(true)
    await h.drain()
    expect(h.ctx.collapsedGroups).toEqual(['toolsEnd', 'insert', 'blockStyle'])
    expect(h.ctx._fitPending).toBe(false)
    expect(h.ctx._fitRunning).toBe(false)
  })
})
