/**
 * IndexedDB 分层持久化适配器（零依赖，不引入 idb / dexie）。
 *
 * 为什么分层（P7-02）：旧实现把「草稿」和「20 份快照」各存成一个 localStorage
 * 大 blob，每存一次快照都要把 20 篇正文整写一遍 —— 2,000 块文档（≈1.5 MB JSON）
 * 第 21 次快照的写入量是 O(20 × 正文)，且必然撞上 localStorage 的 5 MB 上限。
 * 这里拆成三个 store：
 *   - `meta`      草稿元信息（标题 / schemaVersion / updatedAt），几百字节；
 *   - `content`   草稿正文 JSON（+ 可选 HTML 派生副本），只在正文变更时写；
 *   - `snapshots` 一份快照一条记录，key 就是快照 id，写入量 O(1)。
 * 读标题做早期水合（P7-03）时只碰 `meta`，不必反序列化整篇正文。
 *
 * 事务语义（门禁）：写入只在 `transaction.oncomplete` 之后才算成功，`save()` /
 * `snapshot()` 的 Promise 只在那之后 resolve；`onerror` / `onabort` 一律 reject。
 * 因此「已保存」状态永远不可能先于真正落盘出现。
 *
 * 降级：本文件不做选型，工厂不可用时直接 reject；IndexedDB → localStorage →
 * 内存 的三级降级在 `src/providers/persistence.js`。
 */
import { isValidDerivedSnapshot } from '../derive/snapshot'

export const DB_NAME = 'tiptap-vue2:lark-doc'
export const DB_VERSION = 1
export const META_STORE = 'meta'
export const CONTENT_STORE = 'content'
export const SNAPSHOT_STORE = 'snapshots'
export const DRAFT_KEY = 'draft'
/**
 * 计划里提到「可选的 journal store」：目前没有任何写入方（操作日志尚未立项），
 * 建一个永远为空的 store 只会白占 schema —— 真要有写入方时随 DB_VERSION 一起加。
 */
export const DATABASE_STORES = [META_STORE, CONTENT_STORE, SNAPSHOT_STORE]

export const STORAGE_ERROR = '本地保存失败，可能已禁用存储或空间不足；请导出当前文档'
export const READ_ERROR = '无法读取本地存储，请导出当前文档'
export const CORRUPT_ERROR = '本地文档数据损坏，未覆盖现有文档'
export const SNAPSHOT_CORRUPT_ERROR = '本地快照数据损坏，未覆盖现有文档'
export const INVALID_RECORD_ERROR = '文档结构无效，未保存'
export const MISSING_SNAPSHOT_ERROR = '该快照不存在'

const DEFAULT_MAX_SNAPSHOTS = 20

/** 与 `components/lark-doc/workspace.js` 的 `validRecord` 同构：两腿必须判同一件事。 */
export function isValidDocumentRecord(record) {
  return Boolean(record) && typeof record.title === 'string' && Boolean(record.json) &&
    record.json.type === 'doc' && Array.isArray(record.json.content) &&
    Number.isFinite(record.updatedAt)
}

function failure(message, cause) {
  const error = new Error(message)
  if (cause) error.cause = cause
  return error
}

/**
 * 「IndexedDB 这条路根本走不通」（隐私模式、安全上下文限制、版本被占）时的专用错误码。
 * 只有它允许上层静默降级到 localStorage —— 读写失败、数据损坏都不许降级，
 * 否则 quota 报错会因为换了个地方存而变成一声不响的数据丢失。
 */
export const IDB_UNAVAILABLE = 'IDB_UNAVAILABLE'

function unavailable(cause) {
  const error = failure(READ_ERROR, cause)
  error.code = IDB_UNAVAILABLE
  return error
}

export function isIndexedDbAvailable(factory) {
  return Boolean(factory) && typeof factory.open === 'function'
}

/**
 * 打开（必要时建库并升级到）数据库。`onupgradeneeded` 里只做「缺哪个建哪个」，
 * 不做数据搬迁 —— 未来的迁移写成 `oldVersion` 分支，不要在这里顺手改数据。
 */
export function openIndexedDbDatabase(options = {}) {
  const factory = options.factory
  if (!isIndexedDbAvailable(factory)) return Promise.reject(unavailable(null))
  const name = options.name || DB_NAME
  const version = Number.isFinite(options.version) ? options.version : DB_VERSION
  const stores = Array.isArray(options.stores) && options.stores.length ? options.stores : DATABASE_STORES
  return new Promise((resolve, reject) => {
    let request
    try {
      request = factory.open(name, version)
    } catch (error) {
      reject(unavailable(error))
      return
    }
    request.onupgradeneeded = () => {
      const database = request.result
      for (const store of stores) {
        if (!database.objectStoreNames.contains(store)) database.createObjectStore(store)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(unavailable(request.error))
    // 另一个标签页还占着旧版本连接：不 reject，等它释放；上层超时由调用方处理。
    request.onblocked = () => {}
  })
}

/**
 * 包装一个 store：所有方法都是**同步发出请求**，结果通过可选回调取回。
 *
 * 必须同步发：IndexedDB 的事务在没有任何待处理请求时会自动提交，`await` 之后
 * 再发请求会抛 TransactionInactiveError。因此这里的契约是「在 work() 里同步
 * 把请求全部发完」，回调里再发的请求仍在同一事务内（规范保证）。
 */
function wrapStore(store) {
  const deliver = (request, done) => {
    if (typeof done === 'function') request.onsuccess = () => done(request.result)
    return request
  }
  return {
    get(key, done) { return deliver(store.get(key), done) },
    getAll(done) { return deliver(store.getAll(), done) },
    put(value, key, done) { return deliver(key === undefined ? store.put(value) : store.put(value, key), done) },
    delete(key) { return store.delete(key) },
    count(done) { return deliver(store.count(), done) },
  }
}

/**
 * 在一个事务里执行 `work`，只有事务提交成功才 resolve。
 *
 * `work(stores)` 必须同步发完所有请求，返回值的字段由回调在事务提交前填好
 * （规范保证 request 的 success 回调先于 transaction 的 complete 触发）。
 */
export function runTransaction(database, storeNames, mode, work, writeFailureMessage) {
  const message = writeFailureMessage || (mode === 'readwrite' ? STORAGE_ERROR : READ_ERROR)
  return new Promise((resolve, reject) => {
    let transaction
    try {
      transaction = database.transaction(storeNames, mode)
    } catch (error) {
      reject(failure(message, error))
      return
    }
    const stores = {}
    for (const name of storeNames) stores[name] = wrapStore(transaction.objectStore(name))
    let settled = false
    let outcome
    const settle = (error) => {
      if (settled) return
      settled = true
      if (error) reject(error)
      else resolve(outcome)
    }
    transaction.oncomplete = () => settle(null)
    transaction.onerror = () => settle(failure(message, transaction.error))
    transaction.onabort = () => settle(failure(message, transaction.error))
    try {
      outcome = work(stores)
    } catch (error) {
      settle(failure(message, error))
      try { transaction.abort() } catch (ignored) { /* 事务可能已经结束 */ }
    }
  })
}

/** 与 workspace.js 的 `record()` 同构：补齐 updatedAt，校验后才允许落库。 */
function normalizeRecord(value) {
  const result = { title: value && value.title, json: value && value.json, updatedAt: Date.now() }
  if (value && value.schemaVersion != null) result.schemaVersion = value.schemaVersion
  if (value && value.html != null) result.html = value.html
  if (!isValidDocumentRecord(result)) throw failure(INVALID_RECORD_ERROR)
  // 目录快照是**可选的加速件**：形状不对就丢掉这个字段，别让整篇文档存不进去。
  // 读回来还会再判伪一次（`validateDerivedSnapshot` 对不上正文就作废）。
  if (value && isValidDerivedSnapshot(value.derived)) result.derived = value.derived
  return result
}

/**
 * 拆成 meta / content 两份：`meta` 只留能快速读出来的小字段。
 * `derived` 放 meta —— 它只有几百字节到几十 KB，却正是「只读 meta 就能先挂目录」的依据。
 */
function splitDraft(record) {
  const meta = { title: record.title, updatedAt: record.updatedAt }
  if (record.schemaVersion != null) meta.schemaVersion = record.schemaVersion
  if (record.derived != null) meta.derived = record.derived
  const content = { json: record.json }
  if (record.html != null) content.html = record.html
  return { meta, content }
}

function mergeDraft(meta, content) {
  const record = { title: meta.title, json: content.json, updatedAt: meta.updatedAt }
  if (meta.schemaVersion != null) record.schemaVersion = meta.schemaVersion
  if (meta.derived != null) record.derived = meta.derived
  if (content.html != null) record.html = content.html
  return record
}

/** 快照 id：毫秒时间戳 + 定宽序号。定宽是为了让同一毫秒内的 id 仍按字典序可比 ——
 *  `sortSnapshots` 的兜底排序靠 id 比较，不定宽会出现 `-9` 排在 `-10` 前面。 */
function nextSnapshotId(sequence) {
  return `${Date.now()}-${String(sequence).padStart(6, '0')}`
}

function sortSnapshots(list) {
  return list.slice().sort((left, right) => {
    if (right.updatedAt !== left.updatedAt) return right.updatedAt - left.updatedAt
    return String(right.id) < String(left.id) ? -1 : 1
  })
}

/** 读宽容、写严格：读回来的东西只要形状不对就整份判损坏，绝不返回半条列表。 */
function assertSnapshots(list) {
  if (!Array.isArray(list) || list.some((item) => !isValidDocumentRecord(item) || typeof item.id !== 'string')) {
    throw failure(SNAPSHOT_CORRUPT_ERROR)
  }
  return sortSnapshots(list)
}

/**
 * IndexedDB 版工作区适配器。
 *
 * 返回的对象与 `createWorkspace()` 的方法名完全一致（load / save / snapshots /
 * snapshot / restore），区别只是全部返回 Promise —— 调用方本来就在 await，
 * 因此 `createWorkspace(storage, options)` 的老调用点和 Provider 契约都不用变。
 * 额外暴露 `kind` / `durable` 供宿主判断「这次保存是不是真的落盘了」。
 */
export function createIndexedDbWorkspace(options = {}) {
  const name = options.name || DB_NAME
  const version = Number.isFinite(options.version) ? options.version : DB_VERSION
  const configuredMax = Number(options.maxSnapshots)
  const maxSnapshots = Number.isFinite(configuredMax) ? Math.max(0, configuredMax) : DEFAULT_MAX_SNAPSHOTS
  const factory = options.factory
  let database = null
  let opening = null
  let sequence = 0

  function open() {
    if (database) return Promise.resolve(database)
    if (!opening) {
      opening = openIndexedDbDatabase({ factory, name, version }).then((db) => {
        database = db
        return db
      }, (error) => {
        // 允许下一轮重试：隐私模式可能在授权后才放行，卡死在第一次失败没意义。
        opening = null
        throw error
      })
    }
    return opening
  }

  // 读全部快照（已校验、已按最新在前排序），不做截断 —— 保留策略要看到超额项才能删。
  async function readSnapshots(db) {
    const box = await runTransaction(db, [SNAPSHOT_STORE], 'readonly', (stores) => {
      const read = {}
      stores.snapshots.getAll((values) => { read.rows = values })
      return read
    })
    return assertSnapshots(box.rows || [])
  }

  return {
    kind: 'indexeddb',
    durable: true,
    degraded: false,
    maxSnapshots,
    close() {
      if (database) database.close()
      database = null
      opening = null
    },
    async load() {
      const db = await open()
      const box = await runTransaction(db, [META_STORE, CONTENT_STORE], 'readonly', (stores) => {
        const read = {}
        stores.meta.get(DRAFT_KEY, (value) => { read.meta = value })
        stores.content.get(DRAFT_KEY, (value) => { read.content = value })
        return read
      })
      if (box.meta === undefined && box.content === undefined) return null
      // 只写了一半（meta 有、content 没有，或反过来）一律判损坏，不返回半截记录。
      if (!box.meta || !box.content) throw failure(CORRUPT_ERROR)
      const record = mergeDraft(box.meta, box.content)
      if (!isValidDocumentRecord(record)) throw failure(CORRUPT_ERROR)
      return record
    },
    async save(value) {
      // 校验在开事务之前：结构不合法时不产生任何写入。
      const record = normalizeRecord(value)
      const { meta, content } = splitDraft(record)
      const db = await open()
      await runTransaction(db, [META_STORE, CONTENT_STORE], 'readwrite', (stores) => {
        stores.meta.put(meta, DRAFT_KEY)
        stores.content.put(content, DRAFT_KEY)
        return record
      })
      // runTransaction 只在 oncomplete 之后 resolve：走到这里说明两份都已落盘。
      return record
    },
    async snapshots() {
      const db = await open()
      const full = await readSnapshots(db)
      return full.slice(0, maxSnapshots)
    },
    async snapshot(value) {
      const record = normalizeRecord(value)
      const db = await open()
      // 先读全量并校验：损坏在这一步就抛 SNAPSHOT_CORRUPT_ERROR，不会被事务错误文案盖掉；
      // 也保证下面删哪些 id 是算好的，不在事务里做校验。
      const full = await readSnapshots(db)
      const entry = { ...record, id: nextSnapshotId(sequence++) }
      const kept = sortSnapshots([entry, ...full]).slice(0, maxSnapshots)
      const keep = new Set(kept.map((item) => item.id))
      const dropped = full.filter((item) => !keep.has(item.id))
      // 写入与淘汰在同一个事务里：要么「新材料 + 旧材料删除」一起生效，要么都不生效，
      // 不会留下「写进去了但旧的没删」的超额中间态。
      await runTransaction(db, [SNAPSHOT_STORE], 'readwrite', (stores) => {
        stores.snapshots.put(entry, entry.id)
        for (const row of dropped) stores.snapshots.delete(row.id)
        return entry
      })
      return entry
    },
    async restore(id) {
      const db = await open()
      const box = await runTransaction(db, [SNAPSHOT_STORE], 'readonly', (stores) => {
        const read = {}
        stores.snapshots.get(id, (value) => { read.entry = value })
        return read
      })
      if (!box.entry) throw failure(MISSING_SNAPSHOT_ERROR)
      if (!isValidDocumentRecord(box.entry) || typeof box.entry.id !== 'string') throw failure(SNAPSHOT_CORRUPT_ERROR)
      return box.entry
    },
  }
}
