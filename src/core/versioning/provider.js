/**
 * 内存版 versioning Provider：单测与演示用，满足 `src/providers/versioning.js` 的契约
 * （`list / createSnapshot / get / restore`，四个都返回 Promise）。
 *
 * 为什么需要它：05 §5.4 的契约只有签名，真实实现（服务端）不在本仓库（09 §5.7.3）。
 * 没有内存实现，面板和恢复流程就只能靠 e2e 才能验证；有了它，「版本链只增不减」
 * 「淘汰后无法恢复」这些语义可以在 Node 里逐条断言。
 *
 * 三个刻意选择：
 *   · **`list()` 只给元信息**，正文留在 `get()` —— 面板拉时间线不该把每份快照的字节都搬一遍；
 *   · **`list()` 顺序确定**：`createdAt` 新的在前，同毫秒按写入次序（后写的在前）；
 *   · **淘汰留墓碑**：`prune()` 删掉的 id 记在 `evicted` 集合里，`get / restore` 遇到时报
 *     `E_VERSION_EVICTED` 而不是 `E_VERSION_NOT_FOUND` —— 「这个版本被保留策略删了」
 *     和「这个版本不存在」对用户是两件事。
 *
 * 待定：`author` 缺省 —— 05 §5.4 的 `restore(versionId, ctx)` 里 ctx 只有 `documentId`，
 *       但恢复出来的快照必须带作者。这里允许 `options.author` 兜底，都没有就报错，
 *       不编造身份；宿主应从 session 把当前用户传进来。
 * 待定：`prune` 不是契约方法（`VERSIONING_METHODS` 里没有），是演示用的扩展；
 *       它返回元信息列表，避免调用方误以为还能从 dropped 里取回正文。
 */
import { normalizeSnapshot, createSnapshot } from './snapshot'
import { createRestoreRecord } from './restore'
import { pruneSnapshots } from './retention'
import { E_SNAPSHOT_INVALID, E_VERSION_EVICTED, E_VERSION_NOT_FOUND, versioningError } from './types'

export function createMemoryVersioningProvider(options) {
  const config = options && typeof options === 'object' ? options : {}
  const now = typeof config.now === 'function' ? config.now : () => Date.now()
  const defaultAuthor = typeof config.author === 'string' ? config.author : ''

  /** `{ seq, record }`：seq 只用于同毫秒排序，不对外暴露。 */
  const entries = []
  const evicted = new Set()
  let seq = 0

  function insert(record) {
    // id 一旦复用，`get` 就会静默返回另一份快照 —— 不可变版本最不该出的错，直接拒绝。
    const clash = entries.some((entry) => entry.record.id === record.id) || evicted.has(record.id)
    if (clash) throw versioningError(E_SNAPSHOT_INVALID, `版本 id 重复：${record.id}`)
    seq += 1
    entries.push({ seq, record })
  }

  /** 先查在库，再查墓碑：两者的错误必须分开（见文件头）。 */
  function requireEntry(versionId) {
    const id = typeof versionId === 'string' ? versionId : ''
    if (!id) throw versioningError(E_VERSION_NOT_FOUND, 'versionId 必须是非空字符串')
    const hit = entries.find((entry) => entry.record.id === id)
    if (hit) return hit
    if (evicted.has(id)) {
      throw versioningError(E_VERSION_EVICTED, `版本 ${id} 已被保留策略淘汰，无法恢复；只能从仍存在的版本恢复`)
    }
    throw versioningError(E_VERSION_NOT_FOUND, `版本 ${id} 不存在`)
  }

  /** 出库一律给拷贝：调用方拿到 buffer 后改了它，不能反过来改掉库里的"不可变快照"。 */
  function cloneRecord(record) {
    return Object.assign({}, record, { payload: record.payload.slice() })
  }

  return {
    /** 05 §5.4：列版本，新→旧。`ctx.documentId` 可选（缺省=全部文档，演示用）。 */
    async list(ctx) {
      const documentId = ctx && typeof ctx.documentId === 'string' ? ctx.documentId : ''
      return entries
        .filter((entry) => !documentId || entry.record.documentId === documentId)
        .slice()
        .sort((a, b) => (b.record.createdAt - a.record.createdAt) || (b.seq - a.seq))
        .map((entry) => normalizeSnapshot(entry.record))
    },

    /** 05 §5.4：建不可变快照。id 缺省由本实现生成（契约里 id 是服务端生成的）。 */
    async createSnapshot(record) {
      const input = Object.assign({}, record)
      if (!input.id) input.id = `v${seq + 1}`
      if (input.createdAt === undefined) input.createdAt = now()
      if (!input.author) input.author = defaultAuthor
      const created = createSnapshot(input)
      insert(created)
      return cloneRecord(created)
    },

    /** 05 §5.4：取单个版本全文（含二进制）。 */
    async get(versionId) {
      return cloneRecord(requireEntry(versionId).record)
    },

    /** 05 §5.4：恢复 = 新建版本，不覆盖原版本；原版本仍在链上。 */
    async restore(versionId, ctx) {
      const source = requireEntry(versionId).record
      const author = (ctx && typeof ctx.author === 'string' && ctx.author) || defaultAuthor
      const restored = createRestoreRecord(source, {
        // id 也必须先占位，否则同毫秒两次恢复会拿到同一个派生 id。
        id: `v${seq + 1}`,
        author,
        createdAt: now(),
      })
      insert(restored)
      return cloneRecord(restored)
    },

    /**
     * 演示扩展：按保留策略淘汰，并给被删的 id 立墓碑。
     * 返回元信息（`{ kept, dropped }`），调用方拿不到已删的正文 —— 那才是「淘汰」。
     */
    prune(policy) {
      const result = pruneSnapshots(entries.map((entry) => entry.record), policy)
      const kept = new Set(result.kept.map((record) => record.id))
      const survivors = entries.filter((entry) => kept.has(entry.record.id))
      entries.forEach((entry) => {
        if (!kept.has(entry.record.id)) evicted.add(entry.record.id)
      })
      entries.length = 0
      Array.prototype.push.apply(entries, survivors)
      return {
        kept: result.kept.map((record) => normalizeSnapshot(record)),
        dropped: result.dropped.map((record) => normalizeSnapshot(record)),
      }
    },
  }
}
