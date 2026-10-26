/**
 * Native OKR adapter. The host performs role checks and optimistic version
 * validation; this layer keeps cycle and goal operations explicit.
 */

const OPERATIONS = Object.freeze([
  'listCycles', 'getCycle', 'createCycle', 'activateCycle', 'closeCycle',
  'getCyclePermissions', 'getObjectivePermissions',
  'listObjectives', 'getObjective', 'createObjective', 'updateObjective', 'deleteObjective',
  'listKeyResults', 'getKeyResult', 'createKeyResult', 'updateKeyResult', 'deleteKeyResult', 'checkIn',
])

function requireRequest(request) {
  if (typeof request !== 'function') throw new TypeError('okr provider requires a host request function')
  return request
}

function withContext(ctx = {}, input = {}) {
  const value = { ...input }
  if (ctx.actorId !== undefined && value.actorId === undefined) value.actorId = ctx.actorId
  if (ctx.tenantId !== undefined && value.tenantId === undefined) value.tenantId = ctx.tenantId
  return value
}

export function createOkrProvider(options = {}) {
  const request = requireRequest(options.request)
  const routes = { ...(options.routes || {}) }
  const invoke = (operation, ctx, input = {}) => request(operation, withContext(ctx, input), {
    route: routes[operation] || operation,
    provider: 'okr',
  })
  const provider = { capabilities: Object.freeze({ operations: OPERATIONS.slice(), requiresHostRequest: true }) }
  for (const operation of OPERATIONS) provider[operation] = (ctx, input) => invoke(operation, ctx, input)
  return provider
}

export { OPERATIONS as OKR_OPERATIONS }
