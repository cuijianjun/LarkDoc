/**
 * 历史版本（P6b-02）数据层的常量、错误码与二进制取值口径。
 *
 * 规格出处：
 *   · 09 §5.8 P6b-02 —— `providers/versioning` + 面板，支持「预览某版本 → 恢复为新版本」；
 *   · 09 §5.7.2-9 —— **版本快照不能存 JSON**：协同下存 `Y.encodeStateAsUpdate` 二进制
 *     （或 `Y.snapshot`），JSON 只是某一时刻的投影，只用于导出与 diff；
 *   · 05 §5.4 —— `list / createSnapshot / get / restore` 的入参、返回与语义
 *     （`restore` 是**新建版本**，不覆盖原版本）；
 *   · 04 §3.4 / §⑤-2 —— 面板消费的字段（时间线名称、作者、版本名计数上限 1000）。
 *
 * 本目录零 DOM、零网络、**不 import yjs**：二进制只当 `Uint8Array` 搬运，
 * 编码/解码由 collab 运行时负责，这里不判断 CRDT 内容是否合法 —— 判断了也只是猜测。
 *
 * 待定：`kind` 没有缺省。写路径要求显式传（猜错的代价是「自动快照被当手动永久保留」
 *       或反过来「手动快照被悄悄淘汰」，两个方向都错）；读路径遇到缺失/未知一律按
 *       `manual` 处理，即**永久保留** —— 淘汰不可逆，宁可不删。
 */

/** 快照来源（09 §5.8 要求区分「自动 / 手动 / 恢复产生」）。 */
export const SNAPSHOT_KINDS = Object.freeze(['auto', 'manual', 'restore'])

export const SNAPSHOT_KIND = Object.freeze({
  /** 定时/策略自动落盘，可被保留策略淘汰。 */
  AUTO: 'auto',
  /** 用户「另存为版本」，永久保留。 */
  MANUAL: 'manual',
  /** 「恢复为新版本」产生的快照，永久保留（恢复点被淘汰就再也回不去）。 */
  RESTORE: 'restore',
})

/** 04 §⑤-2：版本名输入框计数为 `11/1000`，上限 1000 字符。 */
export const SNAPSHOT_LABEL_MAX = 1000

export const E_SNAPSHOT_INVALID = 'E_SNAPSHOT_INVALID'
export const E_DOCUMENT_ID = 'E_DOCUMENT_ID'
export const E_SNAPSHOT_AUTHOR = 'E_SNAPSHOT_AUTHOR'
export const E_SNAPSHOT_KIND = 'E_SNAPSHOT_KIND'
export const E_SNAPSHOT_CREATED_AT = 'E_SNAPSHOT_CREATED_AT'
export const E_SNAPSHOT_LABEL = 'E_SNAPSHOT_LABEL'
export const E_SNAPSHOT_PAYLOAD_MISSING = 'E_SNAPSHOT_PAYLOAD_MISSING'
export const E_SNAPSHOT_JSON_NOT_ALLOWED = 'E_SNAPSHOT_JSON_NOT_ALLOWED'
export const E_SNAPSHOT_SIZE_MISMATCH = 'E_SNAPSHOT_SIZE_MISMATCH'
export const E_SNAPSHOT_BLOCK_COUNT = 'E_SNAPSHOT_BLOCK_COUNT'
export const E_POLICY_KEEP_AUTO = 'E_POLICY_KEEP_AUTO'
/** `get / restore` 找不到该 id（从未存在，或不属于当前存储）。 */
export const E_VERSION_NOT_FOUND = 'E_VERSION_NOT_FOUND'
/** 该 id 曾被保留策略淘汰：与「不存在」必须分开，否则用户永远不知道版本去哪了。 */
export const E_VERSION_EVICTED = 'E_VERSION_EVICTED'

/** 统一错误形状：`code` 供 UI 分支，`message` 给人看（与 collab/policies 同口径）。 */
export function versioningError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

/**
 * 二进制判定：只认 `Uint8Array`（Node `Buffer` 是它的子类）与 `ArrayBuffer`。
 *
 * 刻意**不认** `ArrayBuffer.isView` 的其它视图：`Float32Array` 的 `byteLength`
 * 与元素数不是一回事，放进来会让 `sizeBytes` 悄悄算错。也刻意不认「数字数组」——
 * 把 `[1,2,3]` 当快照存下去，读出来没人知道它是不是一段 JSON 的字节。
 */
export function isBinaryPayload(value) {
  if (value instanceof Uint8Array) return true
  if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) return true
  return false
}

/** 归一成 `Uint8Array` 视图（不拷贝）；不可识别返回 null。 */
export function toBytes(value) {
  if (value instanceof Uint8Array) return value
  if (isBinaryPayload(value)) return new Uint8Array(value)
  return null
}

/** 快照正文的字节数；非二进制返回 0（调用方负责先按缺失处理）。 */
export function payloadSize(value) {
  const bytes = toBytes(value)
  return bytes ? bytes.byteLength : 0
}
