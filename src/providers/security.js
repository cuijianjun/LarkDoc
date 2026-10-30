/**
 * Workspace policy adapter. Decision mutation and formal audit reads are
 * separate operations so reporter telemetry cannot be mistaken for AuditRecord.
 */

const OPERATIONS = Object.freeze([
  'getPolicy', 'updatePolicy', 'requestDecision', 'resolveDecision', 'listAuditRecords',
])

const SECURITY_DECISION_STATUSES = Object.freeze(['permit', 'deny', 'approval_required', 'unavailable'])
const WATERMARKS = Object.freeze(['none', 'visible', 'invisible'])

function requireRequest(request) {
  if (typeof request !== 'function') throw new TypeError('security provider requires a host request function')
  return request
}

function withContext(ctx = {}, input = {}) {
  const value = { ...input }
  if (ctx.actorId !== undefined && value.actorId === undefined) value.actorId = ctx.actorId
  if (ctx.tenantId !== undefined && value.tenantId === undefined) value.tenantId = ctx.tenantId
  return value
}

export function normalizeSecurityPolicy(input = {}) {
  return {
    canCopy: input.canCopy !== false,
    canDownload: input.canDownload !== false,
    canPrint: input.canPrint !== false,
    watermark: WATERMARKS.includes(input.watermark) ? input.watermark : 'none',
    watermarkScopes: Array.isArray(input.watermarkScopes) ? input.watermarkScopes : [],
    allowScreenshot: input.allowScreenshot !== false,
    allowScreenRecord: input.allowScreenRecord !== false,
    mobileCopyBlocked: Boolean(input.mobileCopyBlocked),
    expiresAt: input.expiresAt,
    ...input,
  }
}

export function normalizeSecurityDecision(input = {}) {
  const status = SECURITY_DECISION_STATUSES.includes(input.status)
    ? input.status
    : (input.allowed ? 'permit' : 'unavailable')
  return { ...input, status, allowed: status === 'permit' }
}

export function securityDecisionError(decision, operation = 'security request') {
  const normalized = normalizeSecurityDecision(decision)
  const error = new Error(normalized.reason || `${operation} denied`)
  error.code = normalized.code || 'ERR_SECURITY_DENIED'
  error.status = normalized.status
  error.requestId = normalized.requestId || null
  error.permissionVersion = normalized.permissionVersion
  error.reason = normalized.reason || ''
  error.decision = normalized
  return error
}

/**
 * Host calls must preserve a business denial even when the transport succeeds
 * (the Feishu security APIs commonly return HTTP 200 with code != 0).
 */
export function requirePermittedDecision(input, operation = 'security request') {
  const decision = normalizeSecurityDecision(input)
  if (!decision.allowed) throw securityDecisionError(decision, operation)
  return decision
}

export function normalizeAuditRecord(input = {}) {
  return {
    ...input,
    auditId: input.auditId || '',
    actorType: input.actorType || 'user',
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
  }
}

export function createSecurityProvider(options = {}) {
  const request = requireRequest(options.request)
  const routes = { ...(options.routes || {}) }
  const invoke = (operation, ctx, input = {}) => request(operation, withContext(ctx, input), {
    route: routes[operation] || operation,
    provider: 'security',
  })
  const provider = { capabilities: Object.freeze({ operations: OPERATIONS.slice(), requiresHostRequest: true }) }
  for (const operation of OPERATIONS) {
    provider[operation] = async (ctx, input) => {
      const result = await invoke(operation, ctx, input)
      // Reads return their normalized payload. Mutations/decisions must not
      // turn a business deny into a successful-looking resolved Promise.
      if (operation === 'requestDecision' || operation === 'resolveDecision' || operation === 'updatePolicy') {
        return requirePermittedDecision(result, operation)
      }
      return result
    }
  }
  return provider
}

export { OPERATIONS as SECURITY_OPERATIONS }
export { SECURITY_DECISION_STATUSES, WATERMARKS }
