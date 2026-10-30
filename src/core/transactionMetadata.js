/**
 * 事务来源统一放在 ProseMirror transaction meta 中，供协同、历史、审计和
 * AI 提案层区分用户输入、远端同步、导入和恢复操作。
 */
export const TRANSACTION_META_KEY = 'larkDocTransaction'
export const TRANSACTION_ORIGINS = Object.freeze({
  USER: 'user',
  LOCAL: 'local',
  REMOTE: 'remote',
  PROVIDER: 'provider',
  SYSTEM: 'system',
  IMPORT: 'import',
  RESTORE: 'restore',
  AI: 'ai',
  HOST: 'host',
})

const CANONICAL_ORIGINS = new Map([
  ['user', TRANSACTION_ORIGINS.LOCAL],
  ['local', TRANSACTION_ORIGINS.LOCAL],
  ['remote', TRANSACTION_ORIGINS.REMOTE],
  ['provider', TRANSACTION_ORIGINS.PROVIDER],
  ['import', TRANSACTION_ORIGINS.PROVIDER],
  ['restore', TRANSACTION_ORIGINS.SYSTEM],
  ['ai', TRANSACTION_ORIGINS.PROVIDER],
  ['host', TRANSACTION_ORIGINS.SYSTEM],
  ['system', TRANSACTION_ORIGINS.SYSTEM],
])

export function createTransactionId(prefix = 'tx') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

export function canonicalTransactionOrigin(origin) {
  return CANONICAL_ORIGINS.get(String(origin || '').toLowerCase()) || TRANSACTION_ORIGINS.SYSTEM
}

export function setTransactionMetadata(transaction, metadata = {}) {
  if (!transaction || typeof transaction.setMeta !== 'function') return transaction
  const origin = metadata.origin || TRANSACTION_ORIGINS.USER
  return transaction.setMeta(TRANSACTION_META_KEY, {
    origin,
    canonicalOrigin: canonicalTransactionOrigin(origin),
    transactionId: metadata.transactionId || createTransactionId(),
    operation: metadata.operation || null,
    blockIds: Array.isArray(metadata.blockIds) ? metadata.blockIds.slice() : [],
    actorId: metadata.actorId == null ? null : String(metadata.actorId),
    requestId: metadata.requestId == null ? null : String(metadata.requestId),
    baseRevision: metadata.baseRevision == null ? null : String(metadata.baseRevision),
    timestamp: Number(metadata.timestamp) || Date.now(),
  })
}

export function getTransactionMetadata(transaction) {
  const value = transaction && typeof transaction.getMeta === 'function'
    ? transaction.getMeta(TRANSACTION_META_KEY)
    : null
  return value && typeof value === 'object' ? value : null
}
