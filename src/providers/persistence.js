import { createWorkspace } from '../components/lark-doc/workspace'
import { IDB_UNAVAILABLE, createIndexedDbWorkspace, isIndexedDbAvailable } from '../core/storage/idb'

/**
 * 持久化 Provider 保持现有 Demo 的 load/save/snapshots/snapshot/restore 契约。
 * 它只保存草稿和本地快照，不承担协同状态或权限判断。
 *
 * 必需方法：load（读草稿）、save（写草稿）、snapshots（列快照）、
 * snapshot（建快照）、restore（恢复快照）。工作台组件经 callWorkspace
 * 调用它们实现防抖保存与快照面板；宿主传 localStorage 以外的适配器即可
 * 把草稿落到任意后端。
 */
export const PERSISTENCE_METHODS = ['load', 'save', 'snapshots', 'snapshot', 'restore']

/** 校验草稿/快照适配器，同时保留旧工作区的同步和异步兼容性。 */
export function createPersistenceProvider(provider) {
  if (provider == null) return null
  const missing = PERSISTENCE_METHODS.filter(method => typeof provider[method] !== 'function')
  if (missing.length) throw new Error(`persistence Provider 缺少方法：${missing.join(', ')}`)
  return provider
}

/**
 * 旧的纯 localStorage 工厂：同步返回值，门禁脚本直接 require 它。
 * 保留不动 —— 需要分层存储或降级能力的调用方走 `createPersistenceWorkspace`。
 */
export function createLocalPersistence(storage, options = {}) {
  return createWorkspace(storage, options)
}

/**
 * 浏览器存储能力探测。`localStorage` / `indexedDB` 的**属性访问本身**在部分
 * 隐私模式下就会抛 SecurityError，所以每个 getter 都要单独兜住。
 */
export function detectBrowserStorage(target) {
  const scope = target || (typeof window !== 'undefined' ? window : {})
  const probe = (key) => {
    try {
      return scope[key] || undefined
    } catch (error) {
      return undefined
    }
  }
  return { indexedDb: probe('indexedDB'), storage: probe('localStorage') }
}

/** 内存腿的存储替身：只按 key 存取字符串，用来把 localStorage 腿的逻辑复用一遍。 */
function createMemoryStorage() {
  const values = new Map()
  return {
    getItem: key => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => { values.set(key, value) },
  }
}

/**
 * 三级降级工厂：IndexedDB → localStorage → 内存。
 *
 * 选型规则（P7-02）：
 *  - 有可用的 IndexedDB 工厂就选它，草稿拆 `meta`/`content`、快照一份一条记录；
 *  - 没有（或打开时被拒）就落到 localStorage，**并显式标记 `degraded`**——
 *    容量只有约 5 MB，2,000 块的文档加上 20 份快照会写不进去；
 *  - 连 localStorage 都没有就只放内存，`durable` 为 false，刷新即丢。
 *
 * 降级只认 `IDB_UNAVAILABLE`（这条路根本走不通）。读写失败、数据损坏一律原样
 * 抛出：换一个后端继续存等于把「写不进去」和「数据坏了」变成一声不响的丢数据。
 *
 * 返回对象的 `kind` / `degraded` / `reason` / `durable` 都是活取值，降级后立刻
 * 反映新状态，宿主可以据此提示「当前仅保存在浏览器本地」。
 */
export function createPersistenceWorkspace(options = {}) {
  const maxSnapshots = Number.isFinite(Number(options.maxSnapshots))
    ? Math.max(0, Number(options.maxSnapshots))
    : undefined
  const indexedDb = options.indexedDb
  const storage = options.storage
  const state = { kind: '', leg: null, degraded: false, reason: '' }

  function degradeBecause(reason) {
    if (storage && typeof storage.setItem === 'function') {
      state.kind = 'localstorage'
      state.leg = createWorkspace(storage, { maxSnapshots })
      state.reason = `${reason}；已降级到 localStorage，容量约 5 MB，长文档可能写不进去`
    } else {
      state.kind = 'memory'
      state.leg = createWorkspace(createMemoryStorage(), { maxSnapshots })
      state.reason = `${reason}；也没有 localStorage，草稿只存在内存里，刷新即丢失`
    }
    state.degraded = true
  }

  if (isIndexedDbAvailable(indexedDb)) {
    state.kind = 'indexeddb'
    state.leg = createIndexedDbWorkspace({ factory: indexedDb, maxSnapshots })
  } else {
    degradeBecause(indexedDb ? '提供的 IndexedDB 工厂不可用' : '当前环境没有 IndexedDB')
  }

  /** 只有 IndexedDB 腿可能是异步/可失败的；其余两腿保持同步语义。 */
  function recover(error, method, args) {
    if (!error || error.code !== IDB_UNAVAILABLE) throw error
    // 降级只做一次：`degradeBecause` 之后 `state.kind` 不再是 indexeddb，
    // 后续调用直接走新腿，不会反复重试打开。
    degradeBecause(`IndexedDB 打不开（${error.message}）`)
    return state.leg[method](...args)
  }

  function call(method, args) {
    if (state.kind !== 'indexeddb') return state.leg[method](...args)
    let pending
    try {
      pending = Promise.resolve(state.leg[method](...args))
    } catch (error) {
      return recover(error, method, args)
    }
    return pending.catch(error => recover(error, method, args))
  }

  return {
    get kind() { return state.kind },
    get degraded() { return state.degraded },
    get reason() { return state.reason },
    get durable() { return state.kind !== 'memory' },
    get maxSnapshots() { return state.leg.maxSnapshots },
    load: () => call('load', []),
    save: value => call('save', [value]),
    snapshots: () => call('snapshots', []),
    snapshot: value => call('snapshot', [value]),
    restore: id => call('restore', [id]),
    close() {
      if (state.leg && typeof state.leg.close === 'function') state.leg.close()
    },
  }
}
