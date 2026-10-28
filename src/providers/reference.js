/**
 * Cross-table and chart reference adapter.
 *
 * A reference is tenant data with its own ACL and approval state. The host
 * owns credentials and transport; lark-doc only passes identity, revision and
 * source metadata through the explicit lifecycle operations below.
 */

const OPERATIONS = Object.freeze([
  'create', 'get', 'list', 'request', 'approve', 'reject', 'refresh', 'update', 'disconnect', 'delete',
])

const REFERENCE_STATES = Object.freeze(['idle', 'pending', 'approved', 'rejected', 'invalid', 'unavailable'])

function requireRequest(request) {
  if (typeof request !== 'function') throw new TypeError('sheet-reference provider requires a host request function')
  return request
}

function withContext(ctx = {}, input = {}) {
  const value = { ...input }
  if (ctx.actorId !== undefined && value.actorId === undefined) value.actorId = ctx.actorId
  if (ctx.tenantId !== undefined && value.tenantId === undefined) value.tenantId = ctx.tenantId
  return value
}

export function normalizeReference(input = {}) {
  return {
    ...input,
    sourceType: input.sourceType || (input.chartToken ? 'chart' : 'sheet'),
    sourceToken: input.sourceToken || input.sourceSpreadsheetToken || '',
    sourceRange: input.sourceRange || '',
    chartToken: input.chartToken,
    state: REFERENCE_STATES.includes(input.state) ? input.state : 'unavailable',
    permissions: input.permissions && typeof input.permissions === 'object' ? input.permissions : {},
  }
}

export function createReferenceProvider(options = {}) {
  const request = requireRequest(options.request)
  const routes = { ...(options.routes || {}) }
  const invoke = (operation, ctx, input = {}) => request(operation, withContext(ctx, input), {
    route: routes[operation] || operation,
    provider: 'sheet-reference',
  })
  const provider = { capabilities: Object.freeze({ operations: OPERATIONS.slice(), requiresHostRequest: true }) }
  for (const operation of OPERATIONS) provider[operation] = (ctx, input) => invoke(operation, ctx, input)
  return provider
}

export { OPERATIONS as REFERENCE_OPERATIONS }
export { REFERENCE_STATES }
