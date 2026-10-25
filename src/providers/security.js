/**
 * Workspace policy adapter. Decision mutation and formal audit reads are
 * separate operations so reporter telemetry cannot be mistaken for AuditRecord.
 */

const OPERATIONS = Object.freeze([
  'getPolicy', 'updatePolicy', 'requestDecision', 'resolveDecision', 'listAuditRecords',
])

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

export function createSecurityProvider(options = {}) {
  const request = requireRequest(options.request)
  const routes = { ...(options.routes || {}) }
  const invoke = (operation, ctx, input = {}) => request(operation, withContext(ctx, input), {
    route: routes[operation] || operation,
    provider: 'security',
  })
  const provider = { capabilities: Object.freeze({ operations: OPERATIONS.slice(), requiresHostRequest: true }) }
  for (const operation of OPERATIONS) provider[operation] = (ctx, input) => invoke(operation, ctx, input)
  return provider
}

export { OPERATIONS as SECURITY_OPERATIONS }
