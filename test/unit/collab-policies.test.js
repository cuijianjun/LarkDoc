/**
 * P6a 协同运行策略（09 §5.7.2 九条冲突 + §5.7.5 B22–B24）。
 *
 * 这一组只测**纯策略**：UI 状态仓库、离线快照、capability 交集、首次播种、协议校验。
 * 真正的双端收敛在 `collab-e2e.test.js`（起内存 hocuspocus），这里不碰网络。
 */

import { describe, expect, it, vi } from 'vitest'
import {
  E_PROTOCOL_MISMATCH, OFFLINE_MAX_BYTES, OFFLINE_PREFIX, OFFLINE_THROTTLE_MS,
  UI_STATE_COLLAPSED_LIMIT, UI_STATE_DEBOUNCE_MS, UI_STATE_PREFIX,
  assertProtocolVersion, createOfflineSnapshot, createUiStateStore, defaultUiState,
  normalizeUiState, offlineKey, resolveCapabilities, shouldSeed, toggleCollapsed, uiStateKey, utf8Bytes,
} from '../../src/collab/policies.js'
import { COLLAB_PROTOCOL_VERSION } from '../../src/collab/protocol.js'
/**
 * `src/collab/index.js` 会连带拉进 Tiptap 与 Yjs，是这个文件里最重的一次模块加载。
 *
 * 必须用**静态** import。原来这五处写法是 `await import(...)`，于是加载成本落在某条用例
 * 内部 —— 而每条用例只有 5 s 预算。全量跑（73 个 worker 并发、单 worker 起环境约 19.4 s）时
 * 第一个 await 它的用例必然超时：单独跑 30 条 2.76 s 全绿，并发跑就红。
 * P8-02 的全量门禁连着三轮撞在这里，故改成静态 import：加载发生在文件导入阶段，
 * 不吃用例超时，判据不再随机器负载翻转。（纯策略用例多加载一个模块，代价可忽略。）
 */
import {
  createCollabExtensions, createCommentAnchors, createHocuspocusBridge, isRemoteTransaction,
} from '../../src/collab/index.js'

/** 最小 storage 替身：只实现 get/set/remove，足够跑三个仓库。 */
function memoryStorage(initial) {
  const map = new Map(Object.entries(initial || {}))
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)) },
    removeItem: (key) => { map.delete(key) },
    get size() { return map.size },
    raw: map,
  }
}

/** 手动时钟：不真等 300ms / 30s；cancel 真的会把任务摘掉（防抖靠它）。 */
function manualScheduler() {
  const queue = new Map()
  let seq = 0
  return {
    schedule(fn) { seq += 1; queue.set(seq, fn); return seq },
    cancel(handle) { queue.delete(handle) },
    runAll() { const list = Array.from(queue.values()); queue.clear(); list.forEach((fn) => fn()) },
    get pending() { return queue.size },
  }
}

describe('P6a B22 · UI 状态（折叠/大纲/侧栏）不进 Y.Doc', () => {
  it('key 是「单文档一个」，前缀固定', () => {
    expect(uiStateKey('ws1/doc1')).toBe(`${UI_STATE_PREFIX}ws1/doc1`)
    expect(UI_STATE_PREFIX).toBe('tiptap-vue2:lark-doc:ui-state:')
  })

  it('缺省全展开（空数组），不是"全部折叠"', () => {
    expect(defaultUiState().collapsed).toEqual([])
  })

  it('读路径宽容：脏 JSON / 缺字段 / 类型不对都退回缺省', () => {
    expect(normalizeUiState('not json').collapsed).toEqual([])
    expect(normalizeUiState(null)).toEqual(defaultUiState())
    expect(normalizeUiState({ collapsed: 'x' }).collapsed).toEqual([])
    expect(normalizeUiState({ collapsed: ['a', 1, '', null] }).collapsed).toEqual(['a'])
    expect(normalizeUiState({ sidebarWidth: -3 }).sidebarWidth).toBe(0)
    expect(normalizeUiState({ outlineOpen: 'yes' }).outlineOpen).toBe(true)
  })

  it('折叠集合守住 500 上限，超出丢最早的', () => {
    const many = Array.from({ length: 600 }, (item, index) => `b${index}`)
    const state = normalizeUiState({ collapsed: many })
    expect(state.collapsed).toHaveLength(UI_STATE_COLLAPSED_LIMIT)
    expect(state.collapsed[0]).toBe('b100')
    expect(state.collapsed[499]).toBe('b599')
  })

  it('toggleCollapsed 加减都不产生重复 id', () => {
    expect(toggleCollapsed([], 'a', true)).toEqual(['a'])
    expect(toggleCollapsed(['a'], 'a', true)).toEqual(['a'])
    expect(toggleCollapsed(['a', 'b'], 'a', false)).toEqual(['b'])
    expect(toggleCollapsed(['a'], '', true)).toEqual(['a'])
  })

  it('写是 300ms 防抖：连续三次只有一次落盘', () => {
    const storage = memoryStorage()
    const scheduler = manualScheduler()
    const store = createUiStateStore({ documentId: 'd1', storage, schedule: scheduler.schedule, cancel: scheduler.cancel })
    store.setCollapsed('a', true)
    store.setCollapsed('b', true)
    store.setCollapsed('c', true)
    expect(scheduler.pending).toBe(1)
    expect(UI_STATE_DEBOUNCE_MS).toBe(300)
    expect(storage.getItem(uiStateKey('d1'))).toBeNull()
    scheduler.runAll()
    expect(JSON.parse(storage.getItem(uiStateKey('d1'))).collapsed).toEqual(['a', 'b', 'c'])
  })

  it('读回：新开的 store 拿到上次折叠的 id', () => {
    const storage = memoryStorage()
    const scheduler = manualScheduler()
    const first = createUiStateStore({ documentId: 'd2', storage, schedule: scheduler.schedule, cancel: scheduler.cancel })
    first.write({ collapsed: ['x'], sidebarWidth: 320 }, true)
    const second = createUiStateStore({ documentId: 'd2', storage, schedule: scheduler.schedule, cancel: scheduler.cancel })
    expect(second.read()).toMatchObject({ collapsed: ['x'], sidebarWidth: 320 })
  })

  it('storage 不可用（隐私模式）退回内存：本次会话仍有效，不抛错', () => {
    const scheduler = manualScheduler()
    const store = createUiStateStore({ documentId: 'd3', storage: null, schedule: scheduler.schedule, cancel: scheduler.cancel })
    store.write({ outlineOpen: false }, true)
    expect(store.read().outlineOpen).toBe(false)
  })

  it('storage.setItem 抛配额错误时不冒泡', () => {
    const storage = { getItem: () => null, setItem: () => { throw new Error('QuotaExceeded') }, removeItem: () => {} }
    const scheduler = manualScheduler()
    const store = createUiStateStore({ documentId: 'd4', storage, schedule: scheduler.schedule, cancel: scheduler.cancel })
    expect(() => store.write({ outlineOpen: false }, true)).not.toThrow()
    expect(store.read().outlineOpen).toBe(false)
  })

  it('dispose 取消排队中的写入（不留下挂着的计时器）', () => {
    const scheduler = manualScheduler()
    const store = createUiStateStore({ documentId: 'd5', storage: memoryStorage(), schedule: scheduler.schedule, cancel: scheduler.cancel })
    store.setCollapsed('a', true)
    expect(scheduler.pending).toBe(1)
    store.dispose()
    expect(scheduler.pending).toBe(0)
  })
})

describe('P6a B23 · 离线应急快照（30s / 单份 / 512KB）', () => {
  it('key 前缀独立，单份覆盖不是数组', () => {
    expect(offlineKey('d1')).toBe(`${OFFLINE_PREFIX}d1`)
    const storage = memoryStorage()
    const snapshot = createOfflineSnapshot({ documentId: 'd1', storage, snapshot: () => ({ n: 1 }), schedule: () => 1, cancel: () => {} })
    snapshot.write()
    snapshot.write()
    expect(JSON.parse(storage.getItem(offlineKey('d1')))).toEqual({ n: 1 })
    expect(storage.raw.size).toBe(1)
  })

  it('进入 disconnected 立刻写一次，不等 30s', () => {
    const storage = memoryStorage()
    const snapshot = createOfflineSnapshot({
      documentId: 'd2', storage, snapshot: () => ({ text: 'hi' }), schedule: () => 1, cancel: () => {},
    })
    snapshot.start()
    expect(storage.getItem(offlineKey('d2'))).toBe('{"text":"hi"}')
    expect(OFFLINE_THROTTLE_MS).toBe(30000)
  })

  it('之后只在有改动时写（无改动不空转）', () => {
    const storage = memoryStorage()
    let calls = 0
    let tick = null
    const snapshot = createOfflineSnapshot({
      documentId: 'd3',
      storage,
      snapshot: () => { calls += 1; return { calls } },
      schedule: (fn) => { tick = fn; return 1 },
      cancel: () => {},
    })
    snapshot.start()
    expect(calls).toBe(1)
    tick()
    expect(calls).toBe(1)
    snapshot.markChanged()
    tick()
    expect(calls).toBe(2)
  })

  it('超过 512KB 放弃写入并置 skipped，不截断', () => {
    const storage = memoryStorage()
    const big = 'x'.repeat(OFFLINE_MAX_BYTES + 1)
    const snapshot = createOfflineSnapshot({
      documentId: 'd4', storage, snapshot: () => ({ big }), schedule: () => 1, cancel: () => {},
    })
    expect(snapshot.write()).toBe(false)
    expect(snapshot.skipped).toBe(true)
    expect(storage.getItem(offlineKey('d4'))).toBeNull()
  })

  it('512KB 按 UTF-8 字节算（中文一字符三字节）', () => {
    expect(utf8Bytes('abc')).toBe(3)
    expect(utf8Bytes('中')).toBe(3)
    expect(utf8Bytes('😀')).toBe(4)
    expect(utf8Bytes('')).toBe(0)
    // 18 万汉字 ≈ 540KB > 512KB，字符数才 18 万，用 length 会漏判。
    const snapshot = createOfflineSnapshot({
      documentId: 'd5', storage: memoryStorage(), snapshot: () => ({ text: '中'.repeat(180000) }), schedule: () => 1, cancel: () => {},
    })
    expect(snapshot.write()).toBe(false)
    expect(snapshot.skipped).toBe(true)
  })

  it('synced 后停表并清空本地快照', () => {
    const storage = memoryStorage()
    const snapshot = createOfflineSnapshot({
      documentId: 'd6', storage, snapshot: () => ({ text: 'hi' }), schedule: () => 1, cancel: () => {},
    })
    snapshot.start()
    expect(snapshot.read()).toBe('{"text":"hi"}')
    snapshot.stop()
    expect(snapshot.read()).toBeNull()
    expect(snapshot.active).toBe(false)
    expect(snapshot.skipped).toBe(false)
  })

  it('恢复时不自动合并：read() 只把内容交给宿主', () => {
    const storage = memoryStorage({ [offlineKey('d7')]: '{"kept":true}' })
    const snapshot = createOfflineSnapshot({ documentId: 'd7', storage, snapshot: () => null, schedule: () => 1, cancel: () => {} })
    expect(snapshot.read()).toBe('{"kept":true}')
    // 读不写：宿主自己决定要不要下载副本。
    expect(storage.getItem(offlineKey('d7'))).toBe('{"kept":true}')
  })

  it('snapshot() 抛错不冒泡', () => {
    const snapshot = createOfflineSnapshot({
      documentId: 'd8', storage: memoryStorage(), snapshot: () => { throw new Error('boom') }, schedule: () => 1, cancel: () => {},
    })
    expect(() => snapshot.write()).not.toThrow()
    expect(snapshot.write()).toBe(false)
  })
})

describe('P6a B24 · capability 取交集（握手 ∩ 打开文档）', () => {
  it('两边都 true 才 true；任一 false 即 false', () => {
    const merged = resolveCapabilities({ canEdit: true, canComment: true }, { canEdit: false })
    expect(merged).toEqual({ canEdit: false, canComment: true })
  })

  it('只给一边时以给出的一边为准（缺省即 true 的口径）', () => {
    expect(resolveCapabilities({ canExport: false }, {})).toEqual({ canExport: false })
    expect(resolveCapabilities({}, { canExport: false })).toEqual({ canExport: false })
    expect(resolveCapabilities(null, { canEdit: true })).toEqual({ canEdit: true })
  })

  it('非 boolean 字段不进结果（不猜语义）', () => {
    expect(resolveCapabilities({ role: 'owner' }, {})).toEqual({})
  })
})

describe('P6a · 首次播种（C7）与协议校验', () => {
  it('只有 synced + 空文档 + 没播过 三者同时成立才播', () => {
    expect(shouldSeed({ synced: true, isEmpty: true })).toBe(true)
    expect(shouldSeed({ synced: false, isEmpty: true })).toBe(false)
    expect(shouldSeed({ synced: true, isEmpty: false })).toBe(false)
    expect(shouldSeed({ synced: true, isEmpty: true, seeded: true })).toBe(false)
  })

  it('协议版本一致放行；未声明按放行（由服务端契约兜底）', () => {
    expect(assertProtocolVersion(COLLAB_PROTOCOL_VERSION)).toBe(true)
    expect(assertProtocolVersion(undefined)).toBe(true)
    expect(assertProtocolVersion(null)).toBe(true)
  })

  it('版本不一致抛 E_PROTOCOL_MISMATCH，不回退不半连', () => {
    let caught = null
    try { assertProtocolVersion(COLLAB_PROTOCOL_VERSION + 1) } catch (error) { caught = error }
    expect(caught).not.toBeNull()
    expect(caught.code).toBe(E_PROTOCOL_MISMATCH)
  })

  it('协议版本只在一个地方定义', () => {
    expect(COLLAB_PROTOCOL_VERSION).toBe(1)
  })
})

describe('P6a · 协同子入口的契约（不联网）', () => {
  it('isRemoteTransaction 认 y-sync meta，本地事务为 false', async () => {
    expect(isRemoteTransaction({ getMeta: () => undefined })).toBeFalsy()
    expect(isRemoteTransaction({ getMeta: () => ({ isChangeOrigin: true }) })).toBe(true)
  })

  it('createCollabExtensions 只给 ydoc 时只有一个扩展（不画光标）', async () => {
    const Y = await import('yjs')
    const list = createCollabExtensions({ ydoc: new Y.Doc({ gc: false }) })
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('collaboration')
  })

  it('provider + user 齐了才装 CollaborationCaret', async () => {
    const Y = await import('yjs')
    const ydoc = new Y.Doc({ gc: false })
    const provider = { awareness: {} }
    expect(createCollabExtensions({ ydoc, provider, user: { name: '甲', color: '#1456f0' } })).toHaveLength(2)
    expect(createCollabExtensions({ ydoc, provider })).toHaveLength(1)
  })

  it('没有真实 Y.Doc 时立刻抛类型错误，不半初始化', async () => {
    expect(() => createCollabExtensions({})).toThrow(TypeError)
    expect(() => createHocuspocusBridge({ documentId: 'x' })).toThrow(TypeError)
    expect(() => createHocuspocusBridge({ url: 'ws://x' })).toThrow(TypeError)
    expect(() => createCommentAnchors({})).toThrow(TypeError)
  })

  it('评论锚点能编解码；并发插入后跟着内容走', async () => {
    const Y = await import('yjs')
    const ydoc = new Y.Doc({ gc: false })
    // 用 Y.Text 而不是 XmlFragment：fragment 的 index 指的是子节点序号，
    // 文本偏移要落在文本类型上才有意义（真实场景是 `content` 里的 XmlText）。
    const text = ydoc.getText('prose')
    text.insert(0, '甲乙丙')
    const anchors = createCommentAnchors({ ydoc, type: text })
    const encoded = anchors.encode(2)
    expect(encoded).toBeInstanceOf(Uint8Array)
    // P6b：`decode` 回 `{ type, index }` —— 协同下「同一个 index」在不同 type 里没有意义，
    // `createYjsAnchorCodec` 要靠 `type` 判断起点/终点是否还在同一个文本里。
    expect(anchors.decode(encoded)).toMatchObject({ index: 2 })
    // 前面插两个字，锚点应该右移两位而不是原地不动 —— 这就是不用绝对偏移的理由。
    text.insert(0, '前前')
    expect(anchors.decode(encoded)).toMatchObject({ index: 4 })
    expect(anchors.decode(null)).toBeNull()
  })
})
