/**
 * 最小 IndexedDB 假实现：只覆盖 `src/core/storage/idb.js` 真正用到的接口。
 *
 * 为什么不引 `fake-indexeddb`：这个包要求 Node 18 的 `structuredClone` 一整套语义，
 * 而我们真正需要复现的只有**事务自动提交**这一条 ——
 *   1. 请求是异步派发的；
 *   2. 事件回调按「请求 success 先于事务 complete」的顺序触发；
 *   3. 事务在「当前任务结束时仍没有待处理请求」才提交；
 *   4. 在 success 回调里新发的请求仍属于同一事务；
 *   5. 请求出错、或 success 回调抛异常，都中止整个事务。
 * 第 3 条是 P7-02 的正确性核心（`await` 之后再发请求必须失败），所以这里按
 * 「事务自己维护待处理计数 + 一轮宏任务后检查」来实现，而不是简单地顺序执行。
 *
 * 只用 setTimeout(0) 调度，不用微任务：微任务会在 `await` 之间插入，掩盖掉
 * 「事务已经结束」这件事，测试就测不出真实的自动提交行为。
 */

const macrotask = (fn) => setTimeout(fn, 0)

function domError(message) {
  const error = new Error(message)
  error.name = 'FakeDomError'
  return error
}

/** 粗算字符串字节数：门禁只关心量级（O(1) vs O(20)），不做 UTF-8 精确编码。 */
function byteLength(value) {
  try {
    return JSON.stringify(value).length
  } catch (error) {
    return 0
  }
}

export function createFakeIndexedDB(options = {}) {
  // name -> { name, version, stores: Map<storeName, Map<key, value>> }
  const databases = new Map()
  const control = { failOpen: options.failOpen === true, failWrites: options.failWrites === true, failStore: null }
  const metrics = { opens: 0, upgrades: 0, transactions: 0, puts: 0, putBytes: 0, deletes: 0 }

  function recordOf(name) {
    let record = databases.get(name)
    if (!record) {
      record = { name, version: 0, stores: new Map() }
      databases.set(name, record)
    }
    return record
  }

  function finish(transaction, error, aborted) {
    if (transaction._finished) return
    transaction._finished = true
    if (error) transaction.error = error
    if (aborted) {
      // 真回滚：中止前把 readwrite 事务碰过的 store 恢复到事务开始时的样子，
      // 避免「meta 写进去了、content 失败」这种半状态被测试放过。
      for (const [rows, snapshot] of transaction._undo) {
        rows.clear()
        for (const [key, value] of snapshot) rows.set(key, value)
      }
      if (transaction.onabort) transaction.onabort()
      if (transaction.onerror) transaction.onerror()
    } else if (transaction.oncomplete) transaction.oncomplete()
  }

  function maybeComplete(transaction) {
    if (transaction._finished || !transaction._scheduled || transaction._pending > 0) return
    finish(transaction, null, false)
  }

  function issue(transaction, exec) {
    const request = { result: undefined, error: null, onsuccess: null, onerror: null }
    transaction._pending += 1
    macrotask(() => {
      if (transaction._finished) return
      let error = null
      let result
      try {
        result = exec()
      } catch (caught) {
        error = caught
      }
      if (error) {
        request.error = error
        if (request.onerror) request.onerror()
        // 真实实现里请求出错且无人处理就中止事务；适配器从不在单请求上挂 onerror。
        finish(transaction, error, true)
        return
      }
      request.result = result
      let callbackError = null
      try {
        if (request.onsuccess) request.onsuccess()
      } catch (caught) {
        callbackError = caught
      }
      transaction._pending -= 1
      // 事件处理器里抛异常同样会中止事务（规范行为），这里照抄，免得测试里出现
      // 半成功状态：数据写进去了但调用方以为失败了。
      if (callbackError) {
        finish(transaction, callbackError, true)
        return
      }
      maybeComplete(transaction)
    })
    return request
  }

  function createStore(record, storeName, transaction) {
    const rows = record.stores.get(storeName)
    const writable = transaction.mode === 'readwrite'
    const guardWrite = () => {
      if (!writable) throw domError('ReadOnlyError')
      if (control.failWrites || control.failStore === storeName) throw domError('QuotaExceededError')
    }
    return {
      get: (key) => issue(transaction, () => rows.get(key)),
      getAll: () => issue(transaction, () => Array.from(rows.values())),
      count: () => issue(transaction, () => rows.size),
      put: (value, key) => issue(transaction, () => {
        guardWrite()
        const id = key === undefined ? (value && value.id) : key
        rows.set(id, value)
        metrics.puts += 1
        metrics.putBytes += byteLength(value)
        return id
      }),
      delete: (key) => issue(transaction, () => {
        guardWrite()
        rows.delete(key)
        metrics.deletes += 1
      }),
    }
  }

  function createTransaction(record, storeNames, mode) {
    metrics.transactions += 1
    const names = Array.isArray(storeNames) ? storeNames.slice() : [storeNames]
    const effectiveMode = mode || 'readonly'
    const undo = []
    if (effectiveMode === 'readwrite') {
      for (const storeName of names) {
        const rows = record.stores.get(storeName)
        if (rows) undo.push([rows, new Map(rows)])
      }
    }
    const transaction = {
      mode: effectiveMode,
      error: null,
      oncomplete: null,
      onerror: null,
      onabort: null,
      _pending: 0,
      _scheduled: false,
      _finished: false,
      _undo: undo,
      abort() {
        if (transaction._finished) return
        finish(transaction, domError('AbortError'), true)
      },
      objectStore(storeName) {
        if (!record.stores.has(storeName)) throw domError(`NotFoundError: ${storeName}`)
        return createStore(record, storeName, transaction)
      },
    }
    // 当前任务结束后做第一次自动提交检查：此时同步发出的请求已经计入 _pending。
    macrotask(() => {
      transaction._scheduled = true
      maybeComplete(transaction)
    })
    return transaction
  }

  function createConnection(record) {
    const connection = {
      name: record.name,
      version: record.version,
      closed: false,
      objectStoreNames: { contains: (storeName) => record.stores.has(storeName) },
      createObjectStore(storeName) {
        if (!record.stores.has(storeName)) record.stores.set(storeName, new Map())
        return { name: storeName }
      },
      transaction: (storeNames, mode) => createTransaction(record, storeNames, mode),
      close() {
        connection.closed = true
      },
    }
    return connection
  }

  function open(name, version) {
    metrics.opens += 1
    const request = { result: undefined, error: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null }
    macrotask(() => {
      if (control.failOpen) {
        request.error = domError('InvalidStateError')
        if (request.onerror) request.onerror()
        return
      }
      const record = recordOf(name)
      const target = version === undefined ? (record.version || 1) : version
      if (target < record.version) {
        request.error = domError('VersionError')
        if (request.onerror) request.onerror()
        return
      }
      const connection = createConnection(record)
      request.result = connection
      if (record.version < target) {
        record.version = target
        connection.version = target
        metrics.upgrades += 1
        if (request.onupgradeneeded) request.onupgradeneeded()
      }
      if (request.onsuccess) request.onsuccess()
    })
    return request
  }

  return {
    open,
    control,
    metrics,
    databases,
    // 直接看某个库里某个 store 的原始行（不经过适配器的校验/排序），
    // 用来断言「一份快照一条记录」这类物理形态。
    rowsOf(dbName, storeName) {
      const record = databases.get(dbName)
      if (!record) return []
      const rows = record.stores.get(storeName)
      return rows ? Array.from(rows.values()) : []
    },
    keysOf(dbName, storeName) {
      const record = databases.get(dbName)
      if (!record) return []
      const rows = record.stores.get(storeName)
      return rows ? Array.from(rows.keys()) : []
    },
    storeNamesOf(dbName) {
      const record = databases.get(dbName)
      return record ? Array.from(record.stores.keys()) : []
    },
    versionOf(dbName) {
      const record = databases.get(dbName)
      return record ? record.version : 0
    },
    resetMetrics() {
      for (const key of Object.keys(metrics)) metrics[key] = 0
    },
  }
}
