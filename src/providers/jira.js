/**
 * Jira Master adapter. Connection, project permissions and Issue data stay in
 * the host because Jira credentials and tenant URLs must never enter document
 * JSON or the browser bundle.
 */

const OPERATIONS = Object.freeze([
  'getConnection', 'listProjects', 'getProject', 'listIssues', 'getIssue',
  'getProjectPermissions', 'getIssuePermissions',
  'createIssue', 'updateIssue', 'deleteIssue', 'listComments', 'addComment', 'deleteComment', 'transition',
])

function requireRequest(request) {
  if (typeof request !== 'function') throw new TypeError('jira provider requires a host request function')
  return request
}

function withContext(ctx = {}, input = {}) {
  const value = { ...input }
  if (ctx.actorId !== undefined && value.actorId === undefined) value.actorId = ctx.actorId
  if (ctx.tenantId !== undefined && value.tenantId === undefined) value.tenantId = ctx.tenantId
  return value
}

export function createJiraProvider(options = {}) {
  const request = requireRequest(options.request)
  const routes = { ...(options.routes || {}) }
  const invoke = (operation, ctx, input = {}) => request(operation, withContext(ctx, input), {
    route: routes[operation] || operation,
    provider: 'jira',
  })
  const provider = { capabilities: Object.freeze({ operations: OPERATIONS.slice(), requiresHostRequest: true }) }
  for (const operation of OPERATIONS) provider[operation] = (ctx, input) => invoke(operation, ctx, input)
  return provider
}

export { OPERATIONS as JIRA_OPERATIONS }
