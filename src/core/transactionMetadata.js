/**
 * 事务来源统一放在 ProseMirror transaction meta 中，供协同、历史、审计和
 * AI 提案层区分用户输入、远端同步、导入和恢复操作。
 */
export const TRANSACTION_META_KEY = 'larkDocTransaction'
export const TRANSACTION_ORIGINS = Object.freeze({
  USER: 'user',
  REMOTE: 'remote',
  IMPORT: 'import',
  RESTORE: 'restore',
  AI: 'ai',
  HOST: 'host',
})

export function setTransactionMetadata(transaction, metadata = {}) {
  if (!transaction || typeof transaction.setMeta !== 'function') return transaction
  return transaction.setMeta(TRANSACTION_META_KEY, {
    origin: metadata.origin || TRANSACTION_ORIGINS.USER,
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
