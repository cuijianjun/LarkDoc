/**
 * 快照模型：读路径宽容的 `normalizeSnapshot` + 写路径严格的 `createSnapshot`。
 *
 * 形状（任务给定，与 05 §5.4 的 `Version` 字段对齐但更窄）：
 *   `{ id, documentId, label, createdAt, author, sizeBytes, blockCount, pinned, kind }`
 *
 * 正文**不在**这九个字段里（09 §5.7.2-9）：存储形态是「这九个字段 + `payload` 二进制」，
 * 列表只给元信息，取正文走 `get()`。这样面板拉时间线时不会把每份快照的字节都读进内存。
 *
 * 待定：`id` —— 05 §5.4 写明「服务端生成，不可变」，但纯函数拿不到服务端。
 *       这里接受调用方显式传入；缺省时退化成 `${documentId}#${createdAt}` 的确定性派生，
 *       同参数同结果（可复现），但**同一毫秒建两份会撞车**，所以存储层（mem provider /
 *       服务端）必须显式给 id。
 */
import {
  E_DOCUMENT_ID, E_SNAPSHOT_AUTHOR, E_SNAPSHOT_BLOCK_COUNT, E_SNAPSHOT_CREATED_AT,
  E_SNAPSHOT_INVALID, E_SNAPSHOT_JSON_NOT_ALLOWED, E_SNAPSHOT_KIND, E_SNAPSHOT_LABEL,
  E_SNAPSHOT_PAYLOAD_MISSING, E_SNAPSHOT_SIZE_MISMATCH, SNAPSHOT_KINDS, SNAPSHOT_KIND,
  SNAPSHOT_LABEL_MAX, payloadSize, toBytes, versioningError,
} from './types'

/**
 * 读路径：脏数据洗成合法形状，**永不抛**。
 *
 * 宽容到什么程度：字段缺失、类型不对、甚至传进来的是 05 §5.4 的老 `Version`
 * （`name` / `createdBy` / `authorId` 三个旧名）都要能读出来。理由和 `normalizeUiState`
 * 一样 —— 历史数据是既成事实，读不出来的后果是编辑器/面板开不起来。
 *
 * 关键取舍：`kind` 不认识就当 `manual`（永久保留），`pinned` 只要 truthy 就当真。
 * 这两个方向的误判都是「多留一份」，而误判成 `auto` 会**永久删掉**用户的历史。
 */
export function normalizeSnapshot(raw) {
  const input = raw && typeof raw === 'object' ? raw : {}
  const createdAt = Number.isFinite(input.createdAt) ? input.createdAt : 0
  return {
    id: typeof input.id === 'string' ? input.id : '',
    documentId: typeof input.documentId === 'string' ? input.documentId : '',
    // 04 §⑥ 写 `name`、05 §5.4 写 `label`，两份规格都算数，读的时候都认。
    label: typeof input.label === 'string' ? input.label
      : (typeof input.name === 'string' ? input.name : ''),
    createdAt,
    author: pickAuthor(input),
    sizeBytes: Number.isFinite(input.sizeBytes) && input.sizeBytes >= 0 ? input.sizeBytes : 0,
    // null 比 0 诚实：0 会被读成「这份快照是空文档」。
    blockCount: Number.isInteger(input.blockCount) && input.blockCount >= 0 ? input.blockCount : null,
    pinned: Boolean(input.pinned),
    kind: SNAPSHOT_KINDS.indexOf(input.kind) >= 0 ? input.kind : SNAPSHOT_KIND.MANUAL,
  }
}

/** 作者可能是 `author` / `authorId` 字符串，也可能是 05 §5.4 的 `createdBy: Actor`。 */
function pickAuthor(input) {
  const direct = typeof input.author === 'string' ? input.author : input.authorId
  if (typeof direct === 'string' && direct) return direct
  const actor = input.createdBy
  if (typeof actor === 'string' && actor) return actor
  if (actor && typeof actor === 'object' && typeof actor.id === 'string' && actor.id) return actor.id
  return ''
}

/**
 * 写路径：建一份不可变快照。校验是严格且带错误码的 —— 这里少报一个错，
 * 面板上就会出现「看起来保存成功、其实内容丢了」的版本。
 *
 * 入参：`{ id?, documentId, label?, createdAt, author, kind, pinned?, blockCount?, sizeBytes?, payload }`
 * 返回：`{ ...九个元字段, payload }`（`payload` 是**拷贝**，调用方之后改自己的 buffer 不影响快照）。
 *
 * `payload` 必须是二进制：传 JSON 直接拒绝（09 §5.7.2-9）。要在本地存 JSON 的话，
 * 先由 collab 运行时编码成 Yjs update，JSON 留作 diff/导出用的投影即可。
 */
export function createSnapshot(input) {
  if (!input || typeof input !== 'object') {
    throw versioningError(E_SNAPSHOT_INVALID, '快照入参必须是对象')
  }
  const documentId = typeof input.documentId === 'string' ? input.documentId.trim() : ''
  if (!documentId) throw versioningError(E_DOCUMENT_ID, '快照缺少 documentId')

  const author = typeof input.author === 'string' ? input.author.trim() : ''
  if (!author) throw versioningError(E_SNAPSHOT_AUTHOR, '快照缺少 author（建快照的人）')

  if (SNAPSHOT_KINDS.indexOf(input.kind) < 0) {
    throw versioningError(E_SNAPSHOT_KIND, `快照 kind 必须是 ${SNAPSHOT_KINDS.join(' / ')}，收到 ${String(input.kind)}`)
  }

  // 时间由调用方注入（纯层不读时钟），同参数同结果才好写单测。
  if (!Number.isFinite(input.createdAt)) {
    throw versioningError(E_SNAPSHOT_CREATED_AT, '快照缺少 createdAt（毫秒时间戳）')
  }

  const label = normalizeLabel(input.label)
  const bytes = requireBinary(input.payload)
  const sizeBytes = payloadSize(bytes)
  if (input.sizeBytes !== undefined && input.sizeBytes !== null && input.sizeBytes !== sizeBytes) {
    throw versioningError(E_SNAPSHOT_SIZE_MISMATCH,
      `sizeBytes 与正文实际字节数不一致：声明 ${input.sizeBytes}，实际 ${sizeBytes}`)
  }

  let blockCount = null
  if (input.blockCount !== undefined && input.blockCount !== null) {
    if (!Number.isInteger(input.blockCount) || input.blockCount < 0) {
      throw versioningError(E_SNAPSHOT_BLOCK_COUNT, `blockCount 必须是非负整数，收到 ${String(input.blockCount)}`)
    }
    blockCount = input.blockCount
  }

  if (input.pinned !== undefined && typeof input.pinned !== 'boolean') {
    throw versioningError(E_SNAPSHOT_INVALID, 'pinned 必须是 boolean —— 非布尔值会被读成「不钉住」，那是静默降级')
  }

  return {
    id: typeof input.id === 'string' && input.id ? input.id : `${documentId}#${input.createdAt}`,
    documentId,
    label,
    createdAt: input.createdAt,
    author,
    sizeBytes,
    blockCount,
    pinned: input.pinned === true,
    kind: input.kind,
    payload: bytes.slice(),
  }
}

function normalizeLabel(value) {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') {
    throw versioningError(E_SNAPSHOT_LABEL, '版本名必须是字符串')
  }
  if (value.length > SNAPSHOT_LABEL_MAX) {
    throw versioningError(E_SNAPSHOT_LABEL, `版本名上限 ${SNAPSHOT_LABEL_MAX} 字符（04 §⑤-2 计数口径），当前 ${value.length}`)
  }
  return value
}

/**
 * 正文必须是二进制。传对象/数组/字符串（也就是 JSON 的各种形态）时给**专门的**错误码：
 * 这是 09 §5.7.2-9 明令禁止的那条，不能混在「参数缺失」里被忽视。
 */
function requireBinary(value) {
  if (value === undefined || value === null) {
    throw versioningError(E_SNAPSHOT_PAYLOAD_MISSING, '快照缺少正文二进制（payload）')
  }
  const bytes = toBytes(value)
  if (!bytes) {
    throw versioningError(E_SNAPSHOT_JSON_NOT_ALLOWED,
      '快照正文只存二进制（Y.encodeStateAsUpdate / Y.snapshot）；JSON 只是投影，先编码再存（09 §5.7.2-9）')
  }
  return bytes
}
