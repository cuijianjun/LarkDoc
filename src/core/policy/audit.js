import { redactSensitive } from './sensitive-data'

let sequence = 0

export function createAuditEvent(input = {}) {
  sequence += 1
  return redactSensitive({
    eventId: input.eventId || `audit_${Date.now()}_${sequence}`,
    actorId: input.actorId || null,
    docId: input.docId || null,
    action: input.action || '',
    result: input.result || 'unknown',
    reason: input.reason || '',
    source: input.source || 'editor',
    timestamp: input.timestamp || Date.now(),
    sensitiveFields: Array.isArray(input.sensitiveFields) ? input.sensitiveFields : [],
    taskId: input.taskId || null,
    metadata: input.metadata || {},
  })
}
