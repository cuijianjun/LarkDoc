/**
 * Host-owned Bitable adapter.
 *
 * Feishu Base/Table/View/Field/Record resources are tenant-owned and need an
 * app token, user token or host-specific API gateway. This adapter deliberately
 * keeps transport and credentials outside lark-doc: callers provide `request`
 * and may override route names without creating a real Base during setup.
 */

const OPERATIONS = Object.freeze([
  'createBase', 'getBase', 'updateBase', 'deleteBase', 'restoreBase',
  'getBaseAcl', 'updateBaseAcl', 'requestBaseAcl', 'approveBaseAcl', 'rejectBaseAcl', 'getVersion',
  'createTable', 'getTable', 'listTables', 'updateTable', 'deleteTable',
  'createView', 'getView', 'listViews', 'updateView', 'deleteView',
  'createField', 'getField', 'listFields', 'updateField', 'deleteField',
  'listRecords', 'getRecord', 'createRecord', 'updateRecord', 'deleteRecord', 'restoreRecord',
])

function requireRequest(request) {
  if (typeof request !== 'function') throw new TypeError('Bitable provider requires a host request function')
  return request
}

function withContext(ctx = {}, input = {}) {
  const value = { ...input }
  if (ctx.actorId !== undefined && value.actorId === undefined) value.actorId = ctx.actorId
  if (ctx.tenantId !== undefined && value.tenantId === undefined) value.tenantId = ctx.tenantId
  return value
}

export function createBitableProvider(options = {}) {
  const request = requireRequest(options.request)
  const routes = { ...(options.routes || {}) }
  const invoke = (operation, ctx, input = {}) => request(operation, withContext(ctx, input), {
    route: routes[operation] || operation,
    provider: 'bitable',
  })

  const provider = { capabilities: Object.freeze({ operations: OPERATIONS.slice(), requiresHostRequest: true }) }
  for (const operation of OPERATIONS) {
    provider[operation] = (ctx, input) => invoke(operation, ctx, input)
  }
  return provider
}

export { OPERATIONS as BITABLE_OPERATIONS }

