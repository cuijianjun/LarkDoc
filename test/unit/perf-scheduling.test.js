/**
 * P7-04 帧级合并：调度次数契约。
 *
 * 这一批用例守的不是「算得快」，而是「同一帧里被叫了几次」。原实现下按住方向键
 * 走一段，`onSelectionUpdate` 每秒能跑 30 次以上，每次都是十几次强制同步布局；
 * 查找框每敲一个字符就全量扫一遍 2,000 块正文。合并之后，这两个数字必须变成
 * 「一帧一次」「一段输入一次」，否则优化等于没做。
 *
 * 四条主张：
 *   1. 200 次同 key 排队 → 只开 1 帧、只执行 1 次（且执行的是最后一次的闭包）；
 *   2. 不同 key 按首次入队顺序执行，同 key 覆盖不挪位置（顺序是功能的一部分）；
 *   3. 帧内再排队落到下一帧，不会自激成死循环；
 *   4. dispose / cancel 之后一概不执行 —— 组件卸载后不许再摸 editor。
 *
 * DOM 节点数（`outerHTML` / 节点计数）在 node 环境里测不了，由浏览器探针
 * `scripts/verify-browser-perf-scheduling.js` 负责；这里只钉调度语义。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createFrameBatcher, createTrailingDebounce, SEARCH_DEBOUNCE_MS } from '../../src/core/pacing'
import selectionPacingMixin from '../../src/components/lark-doc/editor/selectionPacingMixin'
import viewModesMixin from '../../src/components/lark-doc/editor/viewModesMixin'

/** 假 rAF：回调收进数组，由测试决定什么时候「到帧」。 */
function fakeFrame() {
  const queued = []
  return {
    requestFrame(callback) { queued.push(callback); return queued.length },
    cancelFrame(handle) { if (handle > 0) queued[handle - 1] = null },
    get pending() { return queued.filter(Boolean).length },
    tick() {
      const batch = queued.splice(0)
      for (const callback of batch) if (callback) callback()
    },
  }
}

/** 假定时器：只认 `advance(ms)`，不依赖真实时间。 */
function fakeTimers() {
  let now = 0
  let nextId = 1
  const pending = new Map()
  return {
    setTimeout(callback, delay) {
      const id = nextId
      nextId += 1
      pending.set(id, { at: now + delay, callback })
      return id
    },
    clearTimeout(id) { pending.delete(id) },
    advance(ms) {
      now += ms
      const due = [...pending.entries()].filter(([, item]) => item.at <= now).sort((a, b) => a[1].at - b[1].at)
      for (const [id, item] of due) { pending.delete(id); item.callback() }
    },
    get size() { return pending.size },
  }
}

/** 选区路径的最小 `this`：真实组件要整棵 Vue 实例，这里只给这 8 个方法会摸的字段。 */
function selectionHost({ empty = true, focused = false } = {}) {
  const frame = fakeFrame()
  const calls = { position: 0, boundary: 0, callout: 0, coords: 0 }
  const doc = { content: { size: 400 } }
  const base = {
    $frame: frame,
    error: '',
    outline: [{ pos: 0, level: 1, text: '总则' }, { pos: 40, level: 2, text: '细则' }],
    activeHeading: -1,
    savedSelection: null,
    handlePressed: false,
    blockMenuOpen: false,
    blockTypeMenuOpen: false,
    effectiveReadonly: false,
    bubbleVisible: false,
    bubblePosition: null,
    editor: {
      isFocused: focused,
      state: { doc, selection: { from: 10, to: 12, empty, node: null } },
      isActive: () => false,
      view: {
        coordsAtPos: () => { calls.coords += 1; return { left: 24, top: 120, bottom: 138 } },
      },
    },
    featureEnabled: () => true,
    writable: () => true,
    clearTableBoundaryHover() {},
    currentBlockRange: () => ({ from: 0, to: 20 }),
    positionBlockHandle() { calls.position += 1 },
    updateTableBoundary() { calls.boundary += 1 },
    updateCalloutTools() { calls.callout += 1 },
    bubbleSafeTop: () => 0,
    closeBubbleAlignMenu() {},
    closeBubbleHeadingMenu() {},
  }
  return { self: { ...base, ...selectionPacingMixin.methods }, frame, calls }
}

/** 查找路径的最小 `this`：`findTextMatches` 会调 `doc.descendants`，用它数扫描次数。 */
function searchHost() {
  const timers = fakeTimers()
  const stats = { scans: 0, reveal: 0, search: 0 }
  const doc = {
    descendants(visit) {
      stats.scans += 1
      visit({ isTextblock: true, content: { size: 3 }, textBetween: () => 'key' }, 0)
    },
  }
  const base = {
    $timers: timers,
    searchQuery: '',
    searchMatches: [],
    searchIndex: 0,
    searchOpen: true,
    searchTab: 'find',
    replacement: '',
    featureEnabled: () => true,
    writable: () => true,
    focus() {},
    editor: {
      state: { doc, selection: { from: 0, to: 0, empty: true, node: null } },
      view: { domAtPos: () => ({ node: { parentElement: null } }) },
      commands: {
        revealLarkDocMatch() { stats.reveal += 1 },
        setLarkDocSearch() { stats.search += 1 },
        setTextSelection() {},
      },
    },
  }
  return { self: { ...base, ...viewModesMixin.methods }, timers, stats }
}

describe('P7-04 frame batcher', () => {
  it('collapses 200 same-key schedules into one frame and one run', () => {
    const frame = fakeFrame()
    const batcher = createFrameBatcher({ frame })
    let runs = 0
    for (let index = 0; index < 200; index += 1) batcher.schedule('selection', () => { runs += 1 })
    expect(batcher.pending()).toBe(1)
    expect(frame.pending).toBe(1)
    expect(runs).toBe(0)
    batcher.flush()
    expect(runs).toBe(1)
    expect(batcher.pending()).toBe(0)
  })

  it('keeps first-scheduled order across keys even when an earlier key is refreshed', () => {
    const order = []
    const batcher = createFrameBatcher({ frame: fakeFrame() })
    batcher.schedule('handle', () => order.push('handle-1'))
    batcher.schedule('table', () => order.push('table'))
    batcher.schedule('handle', () => order.push('handle-2'))
    batcher.flush()
    // 覆盖不挪位置：handle 仍在 table 之前，但用的是最后一次的闭包。
    expect(order).toEqual(['handle-2', 'table'])
  })

  it('defers work queued from inside a frame to the next frame', () => {
    const batcher = createFrameBatcher({ frame: fakeFrame() })
    let runs = 0
    batcher.schedule('retry', () => {
      runs += 1
      if (runs < 3) batcher.schedule('retry', () => { runs += 1 })
    })
    batcher.flush()
    expect(runs).toBe(1)
    expect(batcher.pending()).toBe(1)
  })

  it('drops the queued frame on dispose and refuses later schedules', () => {
    const frame = fakeFrame()
    const batcher = createFrameBatcher({ frame })
    let runs = 0
    batcher.schedule('selection', () => { runs += 1 })
    batcher.dispose()
    expect(frame.pending).toBe(0)
    expect(batcher.schedule('selection', () => { runs += 1 })).toBe(false)
    batcher.flush()
    expect(runs).toBe(0)
    expect(batcher.disposed).toBe(true)
  })

  it('keeps running later tasks when one of them throws', () => {
    const reported = []
    const batcher = createFrameBatcher({ frame: fakeFrame(), onError: (error) => reported.push(error.message) })
    let runs = 0
    batcher.schedule('boom', () => { throw new Error('boom') })
    batcher.schedule('ok', () => { runs += 1 })
    batcher.flush()
    expect(reported).toEqual(['boom'])
    expect(runs).toBe(1)
  })
})

describe('P7-04 trailing debounce', () => {
  it('collapses 200 keystrokes into a single run at the end of the window', () => {
    const timers = fakeTimers()
    const debounce = createTrailingDebounce({ delay: SEARCH_DEBOUNCE_MS, timers })
    let runs = 0
    for (let index = 0; index < 200; index += 1) debounce.schedule(() => { runs += 1 })
    expect(timers.size).toBe(1)
    timers.advance(SEARCH_DEBOUNCE_MS - 1)
    expect(runs).toBe(0)
    timers.advance(1)
    expect(runs).toBe(1)
  })

  it('flush runs the pending task immediately and clears the window', () => {
    const timers = fakeTimers()
    const debounce = createTrailingDebounce({ delay: 120, timers })
    let runs = 0
    debounce.schedule(() => { runs += 1 })
    expect(debounce.flush()).toBe(true)
    expect(runs).toBe(1)
    expect(timers.size).toBe(0)
    expect(debounce.flush()).toBe(false)
  })

  it('cancel and dispose both drop the pending task', () => {
    const timers = fakeTimers()
    const cancelled = createTrailingDebounce({ delay: 120, timers })
    let runs = 0
    cancelled.schedule(() => { runs += 1 })
    cancelled.cancel()
    timers.advance(1000)
    expect(runs).toBe(0)

    const disposed = createTrailingDebounce({ delay: 120, timers })
    disposed.schedule(() => { runs += 1 })
    disposed.dispose()
    timers.advance(1000)
    expect(runs).toBe(0)
    expect(disposed.schedule(() => { runs += 1 })).toBe(false)
  })
})

describe('P7-04 selection pacing', () => {
  it('collapses 200 selection updates into a single layout pass', () => {
    const { self, frame, calls } = selectionHost()
    for (let index = 0; index < 200; index += 1) {
      self.editor.state.selection.from = 10 + index
      self.onSelectionUpdate()
    }
    // 排队阶段一次布局都不做：这就是「按住方向键」时被砍掉的那 199 轮。
    expect(calls.position).toBe(0)
    expect(calls.boundary).toBe(0)
    expect(frame.pending).toBe(1)
    frame.tick()
    expect(calls.position).toBe(1)
    expect(calls.boundary).toBe(1)
    expect(calls.callout).toBe(1)
  })

  it('measures the bubble bar once per frame instead of once per keystroke', () => {
    const { self, frame, calls } = selectionHost({ empty: false, focused: true })
    for (let index = 0; index < 50; index += 1) self.onSelectionUpdate()
    expect(calls.coords).toBe(0)
    frame.tick()
    // 只在真要显示气泡时才量：from / to 各一次。
    expect(calls.coords).toBe(2)
    expect(self.bubbleVisible).toBe(true)
    expect(self.bubblePosition.left).toBe(24)
  })

  it('keeps the active heading in sync without touching the outline array', () => {
    const { self } = selectionHost()
    const outline = self.outline
    self.editor.state.selection.from = 45
    self.onSelectionUpdate()
    expect(self.activeHeading).toBe(40)
    self.editor.state.selection.from = 5
    self.onSelectionUpdate()
    expect(self.activeHeading).toBe(0)
    expect(self.outline).toBe(outline)
  })

  it('reports -1 when the document has no heading before the caret', () => {
    const { self } = selectionHost()
    self.outline = []
    self.editor.state.selection.from = 5
    self.onSelectionUpdate()
    expect(self.activeHeading).toBe(-1)
  })
})

describe('P7-04 search pacing', () => {
  it('scans the document once for 200 keystrokes', () => {
    const { self, timers, stats } = searchHost()
    for (let index = 0; index < 200; index += 1) {
      self.searchQuery = `k${index}`
      self.scheduleSearchUpdate()
    }
    expect(stats.scans).toBe(0)
    expect(timers.size).toBe(1)
    timers.advance(SEARCH_DEBOUNCE_MS)
    expect(stats.scans).toBe(1)
    expect(stats.search).toBe(1)
  })

  it('skips the transactions when neither the document nor the query changed', () => {
    const { self, stats } = searchHost()
    self.searchQuery = 'key'
    self.updateSearch()
    const afterFirst = { scans: stats.scans, search: stats.search, reveal: stats.reveal }
    self.updateSearch()
    expect(stats.scans).toBe(afterFirst.scans)
    expect(stats.search).toBe(afterFirst.search)
    expect(stats.reveal).toBe(afterFirst.reveal)
  })

  it('flushes the pending scan before moving to the next match', () => {
    const { self, stats } = searchHost()
    self.searchQuery = 'key'
    self.scheduleSearchUpdate()
    expect(stats.scans).toBe(0)
    self.nextMatch(1)
    // nextMatch 先落地待办，再按最新命中跳转。
    expect(stats.scans).toBe(1)
    expect(stats.reveal).toBe(2) // 一次来自 updateSearch，一次来自 nextMatch
  })

  it('cancels the pending scan when the panel closes', () => {
    const { self, timers, stats } = searchHost()
    self.searchQuery = 'key'
    self.scheduleSearchUpdate()
    self.closeSearch()
    timers.advance(SEARCH_DEBOUNCE_MS * 5)
    expect(stats.scans).toBe(0)
  })
})

/**
 * `bubbleBarPosition` 读 `window.innerWidth/innerHeight`：node 环境没有 window，
 * 只在这一组里挂一个最小替身，结束即摘掉（别污染其它用例）。
 */
const originalWindow = globalThis.window
beforeAll(() => { globalThis.window = { innerWidth: 1440, innerHeight: 900 } })
afterAll(() => {
  if (originalWindow === undefined) delete globalThis.window
  else globalThis.window = originalWindow
})
