'use strict'

const ROOM_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/
const PRIVATE_KEY = /(text|content|prompt|response|secret|token|password|api.?key|body|query|selection|preview|coordinate|position|range|rect|href|url)/i
const IDENTIFIER_KEY = /^(room|roomId|roomName|doc|docId|docName|document|documentId|documentName|user|userId|userName|username|author|authorId|authorName|clientId|title)$/i

function safeDocumentName(value) {
  const normalized = String(value || 'demo-document').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60)
  if (!normalized) return 'demo-document'
  return (/^[a-zA-Z0-9]/.test(normalized) ? normalized : `doc-${normalized}`).slice(0, 64)
}

function sanitizeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return {}

  return Object.keys(metadata).reduce((safe, key) => {
    if (PRIVATE_KEY.test(key) || IDENTIFIER_KEY.test(key)) {
      safe[key] = '[REDACTED]'
      return safe
    }

    const value = metadata[key]
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) safe[key] = value
    return safe
  }, {})
}

function normalizeTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeCommentThread(thread) {
  const value = thread && typeof thread === 'object' ? thread : {}
  return {
    ...value,
    createdAt: normalizeTimestamp(value.createdAt),
    replies: Array.isArray(value.replies)
      ? value.replies.map((reply) => {
        const item = reply && typeof reply === 'object' ? reply : {}
        return { ...item, createdAt: normalizeTimestamp(item.createdAt) }
      })
      : [],
  }
}

function parseJsonDocument(value) {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value
  const document = parsed && parsed.document ? parsed.document : parsed
  if (!document || document.type !== 'doc') throw new TypeError('无效的 Tiptap JSON 文档')
  return document
}

function wrapJsonDocument(document) {
  return { schemaVersion: 1, document: parseJsonDocument(document) }
}

module.exports = {
  ROOM_NAME_PATTERN,
  normalizeCommentThread,
  normalizeTimestamp,
  parseJsonDocument,
  safeDocumentName,
  sanitizeMetadata,
  wrapJsonDocument,
}
