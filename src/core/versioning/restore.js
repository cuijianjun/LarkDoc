/**
 * 「预览某版本 → 恢复为新版本」（09 §5.8 P6b-02 / 05 §5.4 `restore`）。
 *
 * 关键语义：**恢复不是回滚**。版本链只增不减 —— 拿旧版本的正文生成一份**新快照**
 * （`kind: 'restore'`，新 id、新时间、新作者），原版本原样留在链上。
 * 这与 05 §5.4 的「恢复 = 新建版本，不覆盖原版本」逐字一致。
 *
 * 为什么恢复点要永久保留（见 retention.js）：恢复本身是「回到某个历史状态」的唯一入口，
 * 若恢复出来的那份又被淘汰，用户就没有任何锚点能说明"我当初恢复到哪儿了"。
 *
 * 两个必须说清楚的错误：
 *   · 源快照不存在（已淘汰 / 从未存在）→ `E_VERSION_NOT_FOUND`；
 *   · 源只有元信息没有正文（例如直接拿 `list()` 的元素来恢复）→ `E_SNAPSHOT_PAYLOAD_MISSING`，
 *     提示先 `get(versionId)`。列表不返回二进制是刻意的（面板不该为时间线把全文都拉下来）。
 *
 * 待定：恢复版本的 `label` —— 规格没定义命名规则。这里沿用源版本名（不发明新文案），
 *       调用方可显式传 `label` 覆盖。
 * 待定：`id` —— 与 `createSnapshot` 同口径，缺省确定性派生；存储层仍应显式传。
 */
import { normalizeSnapshot, createSnapshot } from './snapshot'
import {
  E_SNAPSHOT_AUTHOR, E_SNAPSHOT_CREATED_AT, E_SNAPSHOT_PAYLOAD_MISSING, E_VERSION_NOT_FOUND,
  SNAPSHOT_KIND, toBytes, versioningError,
} from './types'

/**
 * @param {object} source `get()` 拿到的完整记录（元信息 + payload 二进制）
 * @param {{ author?: string, createdAt?: number, id?: string, label?: string }} options
 * @returns 新快照记录（`kind: 'restore'`），可直接交给存储层
 */
export function createRestoreRecord(source, options) {
  if (!source || typeof source !== 'object') {
    // 「已被淘汰」和「不存在」在纯层分不出来（淘汰标记只有存储层知道），
    // 这里给出统一口径；带墓碑的实现应在调用前直接抛 E_VERSION_EVICTED。
    throw versioningError(E_VERSION_NOT_FOUND, '要恢复的版本不存在（可能已被保留策略淘汰）')
  }
  const meta = normalizeSnapshot(source)
  const bytes = toBytes(source.payload)
  if (!bytes) {
    throw versioningError(E_SNAPSHOT_PAYLOAD_MISSING,
      `版本 ${meta.id || '(无 id)'} 只有元信息，没有正文；恢复前先 get(versionId)`)
  }

  const input = options && typeof options === 'object' ? options : {}
  const author = typeof input.author === 'string' ? input.author.trim() : ''
  if (!author) throw versioningError(E_SNAPSHOT_AUTHOR, '恢复需要 author（执行恢复的人）')
  if (!Number.isFinite(input.createdAt)) {
    throw versioningError(E_SNAPSHOT_CREATED_AT, '恢复需要 createdAt（毫秒时间戳）—— 纯层不读时钟')
  }

  // 复用写路径校验：label 上限、blockCount 取值、二进制拷贝都在 createSnapshot 里，
  // 恢复只是「换 id / 换时间 / 换作者 / 换 kind」的一次重建。
  return createSnapshot({
    id: typeof input.id === 'string' && input.id ? input.id : `${meta.id || meta.documentId}~restore@${input.createdAt}`,
    documentId: meta.documentId,
    label: input.label === undefined ? meta.label : input.label,
    createdAt: input.createdAt,
    author,
    kind: SNAPSHOT_KIND.RESTORE,
    pinned: false,
    blockCount: meta.blockCount,
    payload: bytes,
  })
}
