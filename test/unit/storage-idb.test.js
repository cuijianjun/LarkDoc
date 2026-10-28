/**
 * P7-02 分层持久化 · IndexedDB 腿（计划 Task 3 Step 1）。
 *
 * 要钉住的六件事：
 *  1. 建库 schema：`meta` / `content` / `snapshots` 三个 store，只升级一次；
 *  2. 草稿拆两份：标题在小 store 里，正文单独一份；
 *  3. 一份快照一条记录 —— 这是 P7-02 的全部意义，写 20 份快照的写入量从
 *     O(20 × 正文) 降到 O(正文)；
 *  4. 事务语义：只有 `oncomplete` 之后才算保存成功；失败即整体回滚；
 *  5. 读宽容写严格：结构不合法不写、写了一半判损坏、绝不返回半截记录；
 *  6. 三级降级：IndexedDB → localStorage → 内存，且降级是可观测的。
 */
import { describe, expect, it } from 'vitest'
import {
  CONTENT_STORE, CORRUPT_ERROR, DATABASE_STORES, DB_NAME, DB_VERSION, DRAFT_KEY,
  IDB_UNAVAILABLE, INVALID_RECORD_ERROR, META_STORE, MISSING_SNAPSHOT_ERROR, READ_ERROR,
  SNAPSHOT_CORRUPT_ERROR, SNAPSHOT_STORE, STORAGE_ERROR,
  createIndexedDbWorkspace, isIndexedDbAvailable, openIndexedDbDatabase,
} from '../../src/core/storage/idb'
import { createPersistenceWorkspace } from '../../src/providers/persistence'
import { createFakeIndexedDB } from '../helpers/fake-indexeddb'

/* ---------------- 脚手架 ---------------- */

function doc(blocks) {
  return { type: 'doc', content: blocks.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })) }
}

const JSON_ONE_BLOCK = doc(['草稿'])

/** 抓住错误本身：`toThrow` 只能匹配文案，而这里还要断言 code。 */
async function rejection(promise) {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected rejection')
}

/** 2,000 块 × 200 字：对齐计划里「2,000 块 ≈ 1.5 MB」的量级。 */
function bigDoc() {
  const blocks = []
  for (let index = 0; index < 2000; index += 1) blocks.push(`第 ${index} 块 ${'文'.repeat(200)}`)
  return doc(blocks)
}

function setup(options = {}) {
  const fake = createFakeIndexedDB()
  const workspace = createIndexedDbWorkspace({ factory: fake, ...options })
  return { fake, workspace }
}

/** localStorage 腿的最小替身：只按 key 存取字符串。 */
function createMemoryStorage(initial) {
  const values = new Map(initial || [])
  return {
    values,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => { values.set(key, value) },
    removeItem: (key) => { values.delete(key) },
  }
}

/* ---------------- 1. schema ---------------- */

describe('建库与 schema', () => {
  it('首次打开创建 meta / content / snapshots 三个 store', async () => {
    const { fake, workspace } = setup()
    expect(await workspace.load()).toBeNull()
    expect(fake.storeNamesOf(DB_NAME).sort()).toEqual([...DATABASE_STORES].sort())
    expect(fake.versionOf(DB_NAME)).toBe(DB_VERSION)
    expect(fake.metrics.upgrades).toBe(1)
  })

  it('同一版本再次打开不重复升级', async () => {
    const { fake, workspace } = setup()
    await workspace.load()
    workspace.close()
    await workspace.load()
    expect(fake.metrics.upgrades).toBe(1)
  })

  it('未提供 factory 时判为不可用', async () => {
    expect(isIndexedDbAvailable(undefined)).toBe(false)
    expect(isIndexedDbAvailable({})).toBe(false)
    expect(isIndexedDbAvailable({ open: () => {} })).toBe(true)
    const error = await rejection(openIndexedDbDatabase({}))
    expect(error.message).toBe(READ_ERROR)
    expect(error.code).toBe(IDB_UNAVAILABLE)
  })

  /**
   * 规范里 open 请求**没有超时**：`blocked` 只在「另一个标签页还占着旧版本连接」时出现，
   * 而它可能永不解除。没有兜底闸门，Promise 永久 pending → `IDB_UNAVAILABLE` 永远不
   * reject → 三级降级完全不触发，界面停在「加载中」。下面三条钉住「一定会结算」。
   */
  it('打开被 blocked 且对方一直不释放时，超时后以可降级错误拒绝', async () => {
    const blockedFactory = {
      open() {
        const request = { result: null, error: null }
        // 只发 blocked，之后再无任何事件（= 对方标签页一直不关）
        setTimeout(() => request.onblocked && request.onblocked(), 0)
        return request
      },
    }
    const error = await rejection(openIndexedDbDatabase({ factory: blockedFactory, openTimeoutMs: 20 }))
    expect(error.code).toBe(IDB_UNAVAILABLE)
    expect(error.message).toBe(READ_ERROR)
    expect(String(error.cause && error.cause.message)).toContain('超时')
  })

  it('打开请求一个事件都不回时同样超时拒绝，不把调用方挂死', async () => {
    const silentFactory = { open: () => ({ result: null, error: null }) }
    const error = await rejection(openIndexedDbDatabase({ factory: silentFactory, openTimeoutMs: 20 }))
    expect(error.code).toBe(IDB_UNAVAILABLE)
  })

  it('慢一点但成功的打开不会被超时误杀', async () => {
    const slowFactory = {
      open() {
        const request = { result: { name: 'slow-db' }, error: null }
        setTimeout(() => request.onsuccess && request.onsuccess(), 5)
        return request
      },
    }
    const database = await openIndexedDbDatabase({ factory: slowFactory, openTimeoutMs: 100 })
    expect(database.name).toBe('slow-db')
  })

  /**
   * 下面三条是 #5 的收口：**闸门落下后迟到的连接必须自己放手**。
   *
   * open 请求没有 abort —— 超时只是让 Promise 先 reject，请求本身仍在跑。对方终于
   * 关掉标签页之后 `onsuccess` 照样会到，那是一条**没人会用**的连接，却继续占着版本锁：
   * 别的标签页想升级就被 blocked，而本标签页早已经因为超时降级走了。
   */
  it('超时之后才到的成功连接会被关掉，不再占着版本锁', async () => {
    let closed = 0
    const lateFactory = {
      open() {
        const request = { result: null, error: null }
        // 比超时（20 ms）晚得多才回：这时 Promise 早已以 IDB_UNAVAILABLE reject。
        setTimeout(() => {
          request.result = { name: 'late-db', close: () => { closed += 1 } }
          if (request.onsuccess) request.onsuccess()
        }, 60)
        return request
      },
    }
    const error = await rejection(openIndexedDbDatabase({ factory: lateFactory, openTimeoutMs: 20 }))
    expect(error.code).toBe(IDB_UNAVAILABLE)
    expect(closed).toBe(0)
    await new Promise((resolve) => { setTimeout(resolve, 80) })
    expect(closed).toBe(1)
  })

  it('正常成功的连接不会被关（闸门只在「已经结算过」时才收口）', async () => {
    let closed = 0
    const okFactory = {
      open() {
        const request = { result: { name: 'ok-db', close: () => { closed += 1 } }, error: null }
        setTimeout(() => request.onsuccess && request.onsuccess(), 5)
        return request
      },
    }
    const database = await openIndexedDbDatabase({ factory: okFactory, openTimeoutMs: 200 })
    expect(database.name).toBe('ok-db')
    await new Promise((resolve) => { setTimeout(resolve, 20) })
    expect(closed).toBe(0)
  })

  it('迟到连接已经关过时，close 抛的 InvalidStateError 不冒出去', async () => {
    const collected = []
    const collect = (error) => { collected.push(error) }
    process.on('uncaughtException', collect)
    const lateFactory = {
      open() {
        const request = { result: null, error: null }
        setTimeout(() => {
          request.result = {
            name: 'late-db',
            close: () => { const error = new Error('InvalidStateError'); error.name = 'InvalidStateError'; throw error },
          }
          if (request.onsuccess) request.onsuccess()
        }, 60)
        return request
      },
    }
    await rejection(openIndexedDbDatabase({ factory: lateFactory, openTimeoutMs: 20 }))
    await new Promise((resolve) => { setTimeout(resolve, 80) })
    process.off('uncaughtException', collect)
    // 走得到这一行就说明那条迟到连接没把自己关出个未捕获异常来。
    expect(collected).toEqual([])
  })
})

/* ---------------- 2. 草稿存读 ---------------- */

describe('草稿存读', () => {
  it('save 后 load 拿回同一份记录，且 meta 与 content 分开存', async () => {
    const { fake, workspace } = setup()
    await workspace.save({ title: '周报', json: JSON_ONE_BLOCK, schemaVersion: 2, html: '<p>草稿</p>' })
    const record = await workspace.load()
    expect(record.title).toBe('周报')
    expect(record.json).toEqual(JSON_ONE_BLOCK)
    expect(record.schemaVersion).toBe(2)
    expect(record.html).toBe('<p>草稿</p>')
    expect(Number.isFinite(record.updatedAt)).toBe(true)

    expect(fake.keysOf(DB_NAME, META_STORE)).toEqual([DRAFT_KEY])
    expect(fake.keysOf(DB_NAME, CONTENT_STORE)).toEqual([DRAFT_KEY])
    // 标题不再和正文绑在一个 blob 里：早期水合只读 meta（P7-03 的前提）。
    const meta = fake.rowsOf(DB_NAME, META_STORE)[0]
    expect(meta.json).toBeUndefined()
    expect(meta.title).toBe('周报')
    expect(fake.rowsOf(DB_NAME, CONTENT_STORE)[0].json).toEqual(JSON_ONE_BLOCK)
  })

  it('结构不合法时不产生任何写入', async () => {
    const { fake, workspace } = setup()
    const error = await rejection(workspace.save({ title: '坏的', json: { type: 'script' } }))
    expect(error.message).toBe(INVALID_RECORD_ERROR)
    expect(fake.metrics.puts).toBe(0)
    expect(fake.metrics.transactions).toBe(0)
  })

  it('只写了 meta 没写 content 判损坏，不返回半截记录', async () => {
    const { fake, workspace } = setup()
    await workspace.load()
    // 直接往 meta 里塞一条，模拟老版本/中断写入留下的残局。
    const database = await openIndexedDbDatabase({ factory: fake })
    await new Promise((resolve, reject) => {
      const transaction = database.transaction([META_STORE], 'readwrite')
      transaction.objectStore(META_STORE).put({ title: '半截', updatedAt: Date.now() }, DRAFT_KEY)
      transaction.oncomplete = resolve
      transaction.onerror = reject
    })
    database.close()
    const error = await rejection(workspace.load())
    expect(error.message).toBe(CORRUPT_ERROR)
  })
})

/* ---------------- 3. 一份快照一条记录 ---------------- */

describe('快照：一份一条记录', () => {
  it('三份快照对应 snapshots 里三行独立记录，不是一个大数组 blob', async () => {
    const { fake, workspace } = setup()
    const ids = []
    for (const title of ['一', '二', '三']) ids.push((await workspace.snapshot({ title, json: JSON_ONE_BLOCK })).id)

    const rows = fake.rowsOf(DB_NAME, SNAPSHOT_STORE)
    expect(rows.length).toBe(3)
    expect(fake.keysOf(DB_NAME, SNAPSHOT_STORE).sort()).toEqual(ids.slice().sort())
    for (const row of rows) expect(Array.isArray(row)).toBe(false)
    // 快照不该污染草稿那两个 store。
    expect(fake.rowsOf(DB_NAME, META_STORE).length).toBe(0)
    expect(fake.rowsOf(DB_NAME, CONTENT_STORE).length).toBe(0)
  })

  it('列表按最新在前，且能按 id 取回', async () => {
    const { workspace } = setup()
    for (const title of ['一', '二', '三']) await workspace.snapshot({ title, json: JSON_ONE_BLOCK })
    const list = await workspace.snapshots()
    expect(list.map((item) => item.title)).toEqual(['三', '二', '一'])
    expect((await workspace.restore(list[0].id)).title).toBe('三')
    expect((await rejection(workspace.restore('missing'))).message).toBe(MISSING_SNAPSHOT_ERROR)
  })

  it('保留策略：超出上限时删除最旧的，且删除与新写入同属一个事务', async () => {
    const { fake, workspace } = setup({ maxSnapshots: 3 })
    fake.resetMetrics()
    for (let index = 0; index < 5; index += 1) await workspace.snapshot({ title: String(index), json: JSON_ONE_BLOCK })
    // 先记下写入侧的计数，再读列表（读列表本身也要开一个事务）。
    const writes = fake.metrics.transactions
    const deletes = fake.metrics.deletes
    const list = await workspace.snapshots()
    expect(list.map((item) => item.title)).toEqual(['4', '3', '2'])
    expect(fake.rowsOf(DB_NAME, SNAPSHOT_STORE).length).toBe(3)
    // 每次快照 = 1 读事务（算该删谁）+ 1 写事务（写新的 + 删旧的）。
    expect(writes).toBe(10)
    expect(deletes).toBe(2)
  })

  it('损坏的快照集合读不回来，也不会被静默截断成可用的样子', async () => {
    const { fake, workspace } = setup()
    await workspace.load()
    const database = await openIndexedDbDatabase({ factory: fake })
    await new Promise((resolve, reject) => {
      const transaction = database.transaction([SNAPSHOT_STORE], 'readwrite')
      transaction.objectStore(SNAPSHOT_STORE).put({ id: 'x', title: 'x', json: { type: 'script' }, updatedAt: 1 }, 'x')
      transaction.oncomplete = resolve
      transaction.onerror = reject
    })
    database.close()
    expect((await rejection(workspace.snapshots())).message).toBe(SNAPSHOT_CORRUPT_ERROR)
    // 新建快照前先校验，损坏文案不会被事务错误盖掉。
    expect((await rejection(workspace.snapshot({ title: '新', json: JSON_ONE_BLOCK }))).message).toBe(SNAPSHOT_CORRUPT_ERROR)
  })
})

/* ---------------- 4. 事务语义 ---------------- */

describe('事务语义', () => {
  it('save 的 Promise 在事务提交后才 resolve：调用前数据不可见', async () => {
    const { fake, workspace } = setup()
    let settled = false
    const pending = workspace.save({ title: '提交后才算', json: JSON_ONE_BLOCK }).then(() => { settled = true })
    expect(settled).toBe(false)
    expect(fake.rowsOf(DB_NAME, CONTENT_STORE).length).toBe(0)
    await pending
    expect(settled).toBe(true)
    expect(fake.rowsOf(DB_NAME, CONTENT_STORE).length).toBe(1)
  })

  it('写入失败整体回滚：meta 已写、content 失败时 meta 也退回原状', async () => {
    const { fake, workspace } = setup()
    await workspace.save({ title: '旧标题', json: JSON_ONE_BLOCK })
    fake.control.failStore = CONTENT_STORE
    const error = await rejection(workspace.save({ title: '新标题', json: doc(['新正文']) }))
    expect(error.message).toBe(STORAGE_ERROR)
    expect((await workspace.load()).title).toBe('旧标题')
    expect(fake.rowsOf(DB_NAME, META_STORE)[0].title).toBe('旧标题')
  })

  it('会失败的 factory 只在打开阶段失败，标记为可降级', async () => {
    const fake = createFakeIndexedDB({ failOpen: true })
    const workspace = createIndexedDbWorkspace({ factory: fake })
    const error = await rejection(workspace.load())
    expect(error.code).toBe(IDB_UNAVAILABLE)
    // 允许下一轮重试：隐私模式可能在授权后才放行。
    fake.control.failOpen = false
    expect(await workspace.load()).toBeNull()
  })
})

/* ---------------- 5. 写入量 ---------------- */

describe('写入量：O(1) 而不是 O(20)', () => {
  it('2,000 块文档存 20 份快照，单次写入不超过一份正文', async () => {
    const { fake, workspace } = setup({ maxSnapshots: 20 })
    const json = bigDoc()
    const oneCopy = JSON.stringify({ title: 'T', json, updatedAt: 1 }).length
    await workspace.save({ title: 'T', json })

    fake.resetMetrics()
    for (let index = 0; index < 20; index += 1) await workspace.snapshot({ title: `S${index}`, json })

    // 20 次快照 = 20 次 put；旧实现每次都要把 20 份正文整写一遍（400 次写入量）。
    expect(fake.metrics.puts).toBe(20)
    const perPut = fake.metrics.putBytes / fake.metrics.puts
    expect(perPut).toBeLessThan(oneCopy * 1.2)
    expect((await workspace.snapshots()).length).toBe(20)
    // 快照写了 20 次，正文只写过那一次。
    expect(fake.metrics.puts).toBeLessThan(400)
  })
})

/* ---------------- 6. 降级 ---------------- */

describe('三级降级：IndexedDB → localStorage → 内存', () => {
  it('有 IndexedDB 时选它，且不标记降级', async () => {
    const fake = createFakeIndexedDB()
    const storage = createMemoryStorage()
    const workspace = createPersistenceWorkspace({ indexedDb: fake, storage })
    expect(workspace.kind).toBe('indexeddb')
    expect(workspace.degraded).toBe(false)
    expect(workspace.reason).toBe('')
    await workspace.save({ title: '主路', json: JSON_ONE_BLOCK })
    expect(fake.rowsOf(DB_NAME, CONTENT_STORE).length).toBe(1)
    expect(storage.values.size).toBe(0)
  })

  it('没有 IndexedDB 时落到 localStorage，并显式标记降级', async () => {
    const storage = createMemoryStorage()
    const workspace = createPersistenceWorkspace({ indexedDb: undefined, storage })
    expect(workspace.kind).toBe('localstorage')
    expect(workspace.degraded).toBe(true)
    expect(workspace.reason).toMatch(/IndexedDB/)
    await workspace.save({ title: '降级', json: JSON_ONE_BLOCK })
    expect(await workspace.load()).toMatchObject({ title: '降级' })
    expect([...storage.values.keys()].every((key) => key.startsWith('tiptap-vue2:lark-doc:'))).toBe(true)
  })

  it('两者都没有时落到内存，明确「不落盘」', async () => {
    const workspace = createPersistenceWorkspace({ indexedDb: undefined, storage: undefined })
    expect(workspace.kind).toBe('memory')
    expect(workspace.degraded).toBe(true)
    expect(workspace.durable).toBe(false)
    expect(workspace.reason).toMatch(/内存/)
    await workspace.save({ title: '内存稿', json: JSON_ONE_BLOCK })
    expect((await workspace.load()).title).toBe('内存稿')
    expect(await workspace.snapshot({ title: '内存快照', json: JSON_ONE_BLOCK })).toMatchObject({ title: '内存快照' })
    expect((await workspace.snapshots()).length).toBe(1)
  })

  it('IndexedDB 打开被拒时运行时降级到 localStorage，且不再反复重试', async () => {
    const fake = createFakeIndexedDB({ failOpen: true })
    const storage = createMemoryStorage()
    const workspace = createPersistenceWorkspace({ indexedDb: fake, storage })
    expect(workspace.kind).toBe('indexeddb')
    // 第一次真正用到才暴露问题：打开失败 → 切到 localStorage 完成这次调用。
    await workspace.save({ title: '私密模式', json: JSON_ONE_BLOCK })
    expect(workspace.kind).toBe('localstorage')
    expect(workspace.degraded).toBe(true)
    expect(workspace.reason).toMatch(/IndexedDB/)
    expect(await workspace.load()).toMatchObject({ title: '私密模式' })
    const opensAfterFallback = fake.metrics.opens
    await workspace.load()
    expect(fake.metrics.opens).toBe(opensAfterFallback)
  })

  it('数据损坏不触发降级：换个后端存等于一声不响地丢数据', async () => {
    const fake = createFakeIndexedDB()
    const storage = createMemoryStorage()
    const workspace = createPersistenceWorkspace({ indexedDb: fake, storage })
    await workspace.load()
    const database = await openIndexedDbDatabase({ factory: fake })
    await new Promise((resolve, reject) => {
      const transaction = database.transaction([META_STORE], 'readwrite')
      transaction.objectStore(META_STORE).put({ title: '半截', updatedAt: Date.now() }, DRAFT_KEY)
      transaction.oncomplete = resolve
      transaction.onerror = reject
    })
    database.close()
    expect((await rejection(workspace.load())).message).toBe(CORRUPT_ERROR)
    expect(workspace.kind).toBe('indexeddb')
    expect(workspace.degraded).toBe(false)
    expect(storage.values.size).toBe(0)
  })

  it('createWorkspace(storage) 的同步老路径不变（门禁脚本依赖它）', async () => {
    const storage = createMemoryStorage()
    const legacy = createPersistenceWorkspace({ indexedDb: undefined, storage })
    // localStorage 腿保持同步返回，不会被 await 需求改写。
    const saved = legacy.save({ title: '同步', json: JSON_ONE_BLOCK })
    expect(saved.title).toBe('同步')
    expect(legacy.load().title).toBe('同步')
    expect(legacy.kind).toBe('localstorage')
  })
})
