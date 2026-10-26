/**
 * `core/versioning` 的公开面（P6b-02 数据层）。
 *
 * 分层：`types`（常量/错误码/二进制口径）→ `snapshot`（模型读写）→ `retention`
 * （保留策略）→ `restore`（恢复状态转换）→ `diff`（投影摘要）→ `provider`（内存实现）。
 * 上层只从这里取，不要在面板里直接 import 具体文件 —— 换实现时只改这一张表。
 *
 * 边界（09 §5.8 + §5.7.2-9）：零 DOM、零网络、不 import yjs；快照正文只搬二进制。
 */
export {
  SNAPSHOT_KINDS, SNAPSHOT_KIND, SNAPSHOT_LABEL_MAX,
  E_SNAPSHOT_INVALID, E_DOCUMENT_ID, E_SNAPSHOT_AUTHOR, E_SNAPSHOT_KIND, E_SNAPSHOT_CREATED_AT,
  E_SNAPSHOT_LABEL, E_SNAPSHOT_PAYLOAD_MISSING, E_SNAPSHOT_JSON_NOT_ALLOWED,
  E_SNAPSHOT_SIZE_MISMATCH, E_SNAPSHOT_BLOCK_COUNT, E_POLICY_KEEP_AUTO,
  E_VERSION_NOT_FOUND, E_VERSION_EVICTED,
  versioningError, isBinaryPayload, toBytes, payloadSize,
} from './types'

export { normalizeSnapshot, createSnapshot } from './snapshot'
export { DEFAULT_POLICY, pruneSnapshots } from './retention'
export { createRestoreRecord } from './restore'
export { projectionMetrics, diffSummary } from './diff'
export { createMemoryVersioningProvider } from './provider'
