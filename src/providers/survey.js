/**
 * Host-owned survey adapter.
 *
 * A Feishu survey is an independent product resource. The document layer
 * carries the survey definition, answer and result contracts, while the host
 * owns authentication, tenant permissions, publishing and result storage.
 */

const OPERATIONS = Object.freeze([
  'create', 'get', 'list', 'update', 'publish', 'close', 'delete', 'restore',
  'submit', 'results', 'export', 'getPermissions', 'updatePermissions',
])

function requireRequest(request) {
  if (typeof request !== 'function') throw new TypeError('survey provider requires a host request function')
  return request
}

function withContext(ctx = {}, input = {}) {
  const value = { ...input }
  if (ctx.actorId !== undefined && value.actorId === undefined) value.actorId = ctx.actorId
  if (ctx.tenantId !== undefined && value.tenantId === undefined) value.tenantId = ctx.tenantId
  return value
}

export function createSurveyProvider(options = {}) {
  const request = requireRequest(options.request)
  const routes = { ...(options.routes || {}) }
  const invoke = (operation, ctx, input = {}) => request(operation, withContext(ctx, input), {
    route: routes[operation] || operation,
    provider: 'survey',
  })
  const provider = { capabilities: Object.freeze({ operations: OPERATIONS.slice(), requiresHostRequest: true }) }
  for (const operation of OPERATIONS) provider[operation] = (ctx, input) => invoke(operation, ctx, input)
  return provider
}

export { OPERATIONS as SURVEY_OPERATIONS }
