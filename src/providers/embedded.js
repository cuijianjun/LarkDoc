/**
 * Host-owned adapters for Feishu directory products and mobile surfaces.
 *
 * These products have their own authentication, lifecycle and ACL. The editor
 * only forwards identity/version/idempotency metadata to the host and renders
 * the returned resource or a structured provider error.
 */

const FACTORY_OPERATIONS = Object.freeze({
  miaji: Object.freeze(['resolve', 'get', 'update', 'remove', 'delete', 'sync', 'requestPermission', 'healthCheck']),
  subscription: Object.freeze(['get', 'publish', 'update', 'unpublish', 'remove', 'delete', 'requestPermission', 'healthCheck']),
  infoCollection: Object.freeze(['create', 'get', 'update', 'markRead', 'submitResponse', 'submit', 'results', 'remove', 'delete', 'requestPermission', 'healthCheck']),
  presentation: Object.freeze(['create', 'get', 'update', 'publish', 'close', 'delete', 'healthCheck']),
  mobile: Object.freeze([
    'getCapabilities', 'setOfflineAvailable', 'getOfflineState', 'setOrientation',
    'listComments', 'createComment', 'replyComment', 'updateComment', 'resolveComment',
    'deleteComment', 'reportComment', 'listVersions', 'getVersion', 'healthCheck',
  ]),
  documentInfo: Object.freeze(['overview', 'visits', 'operations', 'privacy', 'updatePrivacy', 'healthCheck']),
  collaborator: Object.freeze(['list', 'search', 'invite', 'update', 'remove', 'transferOwnership', 'healthCheck']),
  mention: Object.freeze(['list', 'notify', 'notifyAll', 'healthCheck']),
  documentApp: Object.freeze(['search', 'list', 'install', 'uninstall', 'healthCheck']),
  report: Object.freeze(['reasons', 'submit', 'healthCheck']),
  isv: Object.freeze(['get', 'readFormState', 'submit', 'reset', 'remove', 'healthCheck']),
  documentAI: Object.freeze(['overview', 'refreshOverview', 'assistComment', 'insertCommentSuggestion', 'healthCheck']),
  fileView: Object.freeze(['get', 'setView', 'resizePreview', 'setPictureInPicture', 'healthCheck']),
  localTemplate: Object.freeze(['saveSelection', 'list', 'instantiate', 'remove', 'healthCheck']),
  dictionary: Object.freeze(['get', 'list', 'create', 'update', 'remove', 'healthCheck']),
})

function requireRequest(request, name) {
  if (typeof request !== 'function') throw new TypeError(`${name} provider requires a host request function`)
  return request
}

function withContext(ctx = {}, input = {}) {
  const value = { ...input }
  for (const key of ['actorId', 'tenantId', 'version', 'idempotencyKey', 'identityMode']) {
    if (ctx[key] !== undefined && value[key] === undefined) value[key] = ctx[key]
  }
  return value
}

function createProvider(name, options = {}) {
  const request = requireRequest(options.request, name)
  const routes = { ...(options.routes || {}) }
  const operations = FACTORY_OPERATIONS[name]
  const invoke = (operation, ctx, input = {}) => request(operation, withContext(ctx, input), {
    route: routes[operation] || operation,
    provider: name,
  })
  const provider = {
    capabilities: Object.freeze({
      provider: name,
      operations: operations.slice(),
      requiresHostRequest: true,
    }),
  }
  for (const operation of operations) provider[operation] = (ctx, input) => invoke(operation, ctx, input)
  return provider
}

export function normalizeEmbeddedResource(input = {}) {
  const state = ['ready', 'pending', 'blocked', 'failed', 'deleted', 'unavailable'].includes(input.state)
    ? input.state
    : 'unavailable'
  return {
    ...input,
    state,
    resourceId: input.resourceId || input.id || '',
    providerVersion: input.providerVersion || input.version || '',
    permissions: input.permissions && typeof input.permissions === 'object' ? input.permissions : {},
    error: input.error && typeof input.error === 'object' ? input.error : undefined,
  }
}

export function normalizeMobileCapabilities(input = {}) {
  const enumValue = (value, allowed, fallback = 'unsupported') => allowed.includes(value) ? value : fallback
  return {
    ...input,
    platform: enumValue(input.platform, ['ios', 'android', 'web'], 'web'),
    supportsInfoCollection: enumValue(input.supportsInfoCollection, ['view', 'submit', 'unsupported']),
    supportsOffline: Boolean(input.supportsOffline),
    supportsComments: Boolean(input.supportsComments),
    commentActions: input.commentActions && typeof input.commentActions === 'object' ? input.commentActions : {},
    reason: input.reason || undefined,
  }
}

export function createMiajiProvider(options = {}) { return createProvider('miaji', options) }
export function createSubscriptionProvider(options = {}) { return createProvider('subscription', options) }
export function createInfoCollectionProvider(options = {}) { return createProvider('infoCollection', options) }
export function createPresentationProvider(options = {}) { return createProvider('presentation', options) }
export function createMobileProvider(options = {}) { return createProvider('mobile', options) }
export function createDocumentInfoProvider(options = {}) { return createProvider('documentInfo', options) }
export function createCollaboratorProvider(options = {}) { return createProvider('collaborator', options) }
export function createMentionProvider(options = {}) { return createProvider('mention', options) }
export function createDocumentAppProvider(options = {}) { return createProvider('documentApp', options) }
export function createReportProvider(options = {}) { return createProvider('report', options) }
export function createIsvProvider(options = {}) { return createProvider('isv', options) }
export function createDocumentAIProvider(options = {}) { return createProvider('documentAI', options) }
export function createFileViewProvider(options = {}) { return createProvider('fileView', options) }
export function createLocalTemplateProvider(options = {}) { return createProvider('localTemplate', options) }
export function createDictionaryProvider(options = {}) { return createProvider('dictionary', options) }

export function createProviderRegistry(initial = {}) {
  const providers = new Map(Object.entries(initial))
  return {
    register(name, provider) {
      if (!name || !provider || !provider.capabilities) throw new TypeError('provider registry requires a named provider')
      providers.set(name, provider)
    },
    get(name) { return providers.get(name) || null },
    async capabilities() {
      return [...providers.entries()].map(([name, provider]) => ({ name, ...provider.capabilities }))
    },
  }
}

export const MIAJI_OPERATIONS = FACTORY_OPERATIONS.miaji
export const SUBSCRIPTION_OPERATIONS = FACTORY_OPERATIONS.subscription
export const INFO_COLLECTION_OPERATIONS = FACTORY_OPERATIONS.infoCollection
export const PRESENTATION_OPERATIONS = FACTORY_OPERATIONS.presentation
export const MOBILE_OPERATIONS = FACTORY_OPERATIONS.mobile
export const DOCUMENT_INFO_OPERATIONS = FACTORY_OPERATIONS.documentInfo
export const COLLABORATOR_OPERATIONS = FACTORY_OPERATIONS.collaborator
export const MENTION_OPERATIONS = FACTORY_OPERATIONS.mention
export const DOCUMENT_APP_OPERATIONS = FACTORY_OPERATIONS.documentApp
export const REPORT_OPERATIONS = FACTORY_OPERATIONS.report
export const ISV_OPERATIONS = FACTORY_OPERATIONS.isv
export const DOCUMENT_AI_OPERATIONS = FACTORY_OPERATIONS.documentAI
export const FILE_VIEW_OPERATIONS = FACTORY_OPERATIONS.fileView
export const LOCAL_TEMPLATE_OPERATIONS = FACTORY_OPERATIONS.localTemplate
export const DICTIONARY_OPERATIONS = FACTORY_OPERATIONS.dictionary
