const methods = ['bindContext', 'getState', 'load', 'folders', 'execute', 'query', 'getPending', 'subscribe', 'reset']
export function createDocumentBusinessProvider(provider) {
  if (provider == null) return null
  if (methods.some(name => typeof provider[name] !== 'function')) throw new Error('documentBusiness Provider 契约不完整')
  return provider
}
/** Async optional HTTP adapter, keeping business transport out of the initial SDK. */
export function createHttpDocumentBusinessProvider(options) {
  return import(/* webpackChunkName: "document-business" */ './document-business-http').then(module => module.createHttpDocumentBusinessProvider(options))
}
/** Optional public-link Cookie transport, loaded only for an explicit share-link visit. */
export function createHttpShareLinkAccessProvider(options) {
  return import(/* webpackChunkName: "share-link-access" */ './share-link-access').then(module => module.createHttpShareLinkAccessProvider(options))
}
