/**
 * 协同的运行策略（P6a / 09 §5.7.2 九条冲突 + §5.7.5 四项收口 B22–B24）。
 *
 * 这里只放**纯函数与纯状态机**：不 import yjs、不碰 DOM、不建连接、不读全局。
 * 好处是每一条策略都能在 Node 里被断言，而"协同到底对不对"这件事交给 e2e。
 *
 * 三张表跟规格一一对应，改之前先看 09 §5.7.5：
 *   · UI 状态（折叠 / 大纲 / 侧栏）→ 本地 storage，**不进 Y.Doc、不进 awareness**（B22）
 *   · 离线应急快照 → 30s 节流、单份覆盖、512KB 硬顶（B23）
 *   · capability → 握手与打开文档两处取交集（B24）
 */
import { COLLAB_PROTOCOL_VERSION } from './protocol'
// 字节数只算一次实现：卡片摘要与离线快照用的是同一个尺子（core/embed/card）。
import { utf8Bytes } from '../core/embed/card'

export { utf8Bytes }

/** B22：单文档一个 key；`collapsed` 只存折叠着的 id，默认全展开即空数组。 */
export const UI_STATE_PREFIX = 'tiptap-vue2:lark-doc:ui-state:'
/** B22 容量闸门：多于 500 条时丢最早的（折叠是廉价 UI 态，丢了无损失）。 */
export const UI_STATE_COLLAPSED_LIMIT = 500
/** B22 读写时机：折叠切换后 300ms 防抖写。 */
export const UI_STATE_DEBOUNCE_MS = 300

/** B23：**只保留 1 份**，同一个 key 覆盖写，不是数组。 */
export const OFFLINE_PREFIX = 'tiptap-vue2:lark-doc:offline:'
/** B23：断线后每 30s 检查一次，且只在有改动时落盘。 */
export const OFFLINE_THROTTLE_MS = 30000
/** B23 体积闸门：超了**放弃写入**，不截断不分片（截断的草稿比没有更危险）。 */
export const OFFLINE_MAX_BYTES = 512 * 1024

/** 协议版本不一致的错误码：不回退、不静默、不半连（09 §5.7.3）。 */
export const E_PROTOCOL_MISMATCH = 'E_PROTOCOL_MISMATCH'

export function uiStateKey(documentId) {
  return `${UI_STATE_PREFIX}${String(documentId || '')}`
}

export function offlineKey(documentId) {
  return `${OFFLINE_PREFIX}${String(documentId || '')}`
}

/** UI 状态缺省值（`collapsed` 空数组 = 全展开）。 */
export function defaultUiState() {
  return { collapsed: [], outlineOpen: true, sidebarWidth: 0, updatedAt: 0 }
}

/**
 * 把 storage 里读到的东西洗成合法形状。
 *
 * 读路径必须宽容：历史上写过别的结构、手改过 localStorage、旧版本少字段，
 * 都不该让编辑器开不起来；任何一项不合法就退回该项缺省值。
 */
export function normalizeUiState(raw) {
  const base = defaultUiState()
  let input = raw
  if (typeof raw === 'string') {
    try { input = JSON.parse(raw) } catch (error) { return base }
  }
  if (!input || typeof input !== 'object') return base
  const collapsed = Array.isArray(input.collapsed)
    ? input.collapsed.filter((id) => typeof id === 'string' && id).slice(-UI_STATE_COLLAPSED_LIMIT)
    : base.collapsed
  return {
    // 只留最后 500 条：数组顺序即写入顺序，越靠前越旧。
    collapsed,
    outlineOpen: typeof input.outlineOpen === 'boolean' ? input.outlineOpen : base.outlineOpen,
    sidebarWidth: Number.isFinite(input.sidebarWidth) && input.sidebarWidth >= 0 ? input.sidebarWidth : base.sidebarWidth,
    updatedAt: Number.isFinite(input.updatedAt) ? input.updatedAt : base.updatedAt,
  }
}

/** 折叠集合的写入口：加/删一个 id，顺带守住 500 上限。 */
export function toggleCollapsed(collapsed, blockId, folded) {
  const id = typeof blockId === 'string' ? blockId : ''
  const list = Array.isArray(collapsed) ? collapsed.filter((item) => item !== id) : []
  if (!id) return list.slice(-UI_STATE_COLLAPSED_LIMIT)
  if (folded) list.push(id)
  return list.slice(-UI_STATE_COLLAPSED_LIMIT)
}

/**
 * UI 状态仓库（B22）。
 *
 * storage 不可用（隐私模式 / 配额满 / 单测里没有 localStorage）时退回**内存 Map**：
 * 本次会话有效，不报错、不提示 —— 折叠状态丢了不值得打扰用户。
 *
 * `schedule` 默认 setTimeout，测试里换成手动触发器就不用等 300ms。
 */
export function createUiStateStore(options = {}) {
  const documentId = options.documentId
  const now = options.now || (() => Date.now())
  const schedule = options.schedule || ((fn, ms) => setTimeout(fn, ms))
  const cancel = options.cancel || ((handle) => clearTimeout(handle))
  const memory = new Map()
  const storage = resolveStorage(options.storage)
  let timer = null
  let state = read()

  function read() {
    const key = uiStateKey(documentId)
    if (memory.has(key)) return normalizeUiState(memory.get(key))
    try {
      return normalizeUiState(storage ? storage.getItem(key) : null)
    } catch (error) {
      return defaultUiState()
    }
  }

  function flush() {
    timer = null
    const key = uiStateKey(documentId)
    const payload = JSON.stringify(state)
    memory.set(key, payload)
    try { if (storage) storage.setItem(key, payload) } catch (error) { /* 配额满：内存那份还在 */ }
  }

  function write(patch, immediate) {
    state = normalizeUiState({ ...state, ...(patch || {}), updatedAt: now() })
    if (immediate) {
      if (timer) cancel(timer)
      flush()
      return state
    }
    if (timer) cancel(timer)
    timer = schedule(flush, UI_STATE_DEBOUNCE_MS)
    return state
  }

  return {
    get state() { return state },
    read() { return read() },
    write,
    /** 折叠开关：一次调用同时更新内存态并排队落盘。 */
    setCollapsed(blockId, folded) {
      return write({ collapsed: toggleCollapsed(state.collapsed, blockId, folded) })
    },
    flush() {
      if (timer) cancel(timer)
      flush()
    },
    dispose() {
      if (timer) cancel(timer)
      timer = null
    },
  }
}

/**
 * 离线应急快照（B23）。
 *
 * 触发：`collaboration.connect()` 返回 disconnected 时 `start()`；
 * 恢复：`synced` 时 `stop()`（顺带清表）。三条纪律都在下面的分支里：
 *   1. 进入 disconnected **立刻写一次**（刚断网就关页面等于没写）；
 *   2. 之后每 30s 只看一眼，`markChanged()` 没被调过就不写（无改动不空转）；
 *   3. 序列化后超 512KB **放弃本次写入**并置 `skipped`，不截断。
 */
export function createOfflineSnapshot(options = {}) {
  const documentId = options.documentId
  const now = options.now || (() => Date.now())
  const schedule = options.schedule || ((fn, ms) => setInterval(fn, ms))
  const cancel = options.cancel || ((handle) => clearInterval(handle))
  const serialize = options.serialize || ((value) => JSON.stringify(value))
  const storage = resolveStorage(options.storage)
  /** 现序列化的来源：宿主传 `() => editor.getJSON()`，不在本模块里缓存整份 JSON。 */
  const snapshot = options.snapshot || (() => null)

  let timer = null
  let changed = false
  let skipped = false
  let lastWriteAt = 0

  function writeOnce() {
    if (skipped) return false
    let text = ''
    try {
      text = serialize(snapshot())
    } catch (error) {
      return false
    }
    if (!text) return false
    // 按 UTF-8 字节数算，不是字符数：中文一字符三字节，用 length 会低估三倍。
    const bytes = utf8Bytes(text)
    if (bytes > OFFLINE_MAX_BYTES) {
      // 不截断、不分片：宁可没有草稿，也不能给一份残缺的正文。
      skipped = true
      return false
    }
    try {
      if (storage) storage.setItem(offlineKey(documentId), text)
      lastWriteAt = now()
      return true
    } catch (error) {
      return false
    }
  }

  return {
    /** 进入 disconnected：立刻写一次，然后开表。 */
    start() {
      if (timer) return
      changed = true
      writeOnce()
      changed = false
      timer = schedule(() => {
        if (!changed) return
        writeOnce()
        changed = false
      }, OFFLINE_THROTTLE_MS)
    },
    /** 有本地改动时调一次（宿主在 onUpdate 里）。 */
    markChanged() { changed = true },
    /** `synced` 后调用：停表 + 清空本地快照。 */
    stop() {
      if (timer) cancel(timer)
      timer = null
      changed = false
      skipped = false
      try { if (storage) storage.removeItem(offlineKey(documentId)) } catch (error) { /* 清不掉也不致命 */ }
    },
    /** 供 UI 提示条：「本次离线改动过大，未保存草稿」。 */
    get skipped() { return skipped },
    /** 重连后读一次：**不自动合并**，只给宿主提供「下载离线副本」。 */
    read() {
      try { return storage ? storage.getItem(offlineKey(documentId)) : null } catch (error) { return null }
    },
    write: writeOnce,
    get active() { return timer !== null },
    get lastWriteAt() { return lastWriteAt },
  }
}

/**
 * capability 取交集（B24）：握手给了一次、打开文档又给一次，**更严的一侧生效**。
 *
 * 只处理 boolean 字段：`false` 是"明确拒绝"，任一来源为 false 就是 false；
 * 未提供的字段按"缺省即 true"处理（与 `normalizeCapabilities` 同口径）。
 */
export function resolveCapabilities(clientCapabilities, serverCapabilities) {
  const out = {}
  const a = clientCapabilities || {}
  const b = serverCapabilities || {}
  new Set([...Object.keys(a), ...Object.keys(b)]).forEach((key) => {
    const left = a[key]
    const right = b[key]
    if (typeof left === 'boolean' && typeof right === 'boolean') out[key] = left && right
    else if (typeof left === 'boolean') out[key] = left
    else if (typeof right === 'boolean') out[key] = right
  })
  return out
}

/**
 * 首次播种判定（§5.7.2-3）：只有 `synced` 之后、文档仍空、且本端还没播过，才写初始正文。
 *
 * 三个客户端依次进入同一文档时，第一个看到空文档的人播一次；后两人 synced 时
 * 文档已经不空了，`isEmpty` 为 false 自然跳过 —— 这就是 C7 的全部逻辑。
 */
export function shouldSeed({ synced, isEmpty, seeded }) {
  return synced === true && isEmpty === true && seeded !== true
}

/** 协议版本双向校验（不一致立刻抛，不半连）。 */
export function assertProtocolVersion(remoteVersion) {
  // 服务端可能在 synced/stateless 载荷里带版本；缺省视为"未声明"，交给服务端契约兜底。
  if (remoteVersion === undefined || remoteVersion === null) return true
  if (Number(remoteVersion) === COLLAB_PROTOCOL_VERSION) return true
  const error = new Error(`协同协议版本不一致：服务端 ${remoteVersion} / 客户端 ${COLLAB_PROTOCOL_VERSION}`)
  error.code = E_PROTOCOL_MISMATCH
  throw error
}

/** 需要 storage 的调用方可以传 `null` 强制走内存（测试用）。 */
function resolveStorage(storage) {
  if (storage === null) return null
  if (storage) return storage
  try {
    // 只在浏览器里自动取；Node / 单测一律显式传（或传 null 走内存）。
    if (typeof window === 'undefined' || !window.localStorage) return null
    return typeof window.localStorage.getItem === 'function' ? window.localStorage : null
  } catch (error) {
    return null
  }
}

