/* global globalThis */
/** C01 资源边界；身份来自 HttpOnly 会话，浏览器不持有服务票据或声明 actor。 */
export const RESOURCE_METHODS = ['createOrBind', 'queryBinding', 'unbind', 'requestDeletion', 'queryOperation']

export function createResourceProvider(provider) {
  if (provider == null) return null
  const missing = RESOURCE_METHODS.filter(method => typeof provider[method] !== 'function')
  if (missing.length) throw new Error(`resources Provider 缺少方法：${missing.join(', ')}`)
  return provider
}

const required = (value, name) => {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw new TypeError(`resources: ${name} 必须是非空字符串`)
  return value
}
const revision = (value, name) => {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) throw new TypeError(`resources: ${name} 必须是十进制字符串`)
  return value
}

/** 返回 {httpStatus,data}；仅网络/响应解析错误抛出，不把 HTTP 错误包装为成功。 */
export function createHttpResourceProvider(options = {}) {
  const tenantId = required(options.tenantId, 'tenantId')
  const docId = required(options.docId, 'docId')
  const baseUrl = options.baseUrl == null ? '' : String(options.baseUrl).replace(/\/+$/, '')
  const request = options.request || (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null)
  if (typeof request !== 'function') throw new TypeError('resources: 需要 fetch-compatible request')
  if (typeof options.csrfToken !== 'function') required(options.csrfToken, 'csrfToken')
  const integration = `${baseUrl}/editor/integration/v1/tenants/${encodeURIComponent(tenantId)}`
  const publicApi = `${baseUrl}/editor/v1/tenants/${encodeURIComponent(tenantId)}`

  function scoped(input) {
    if (input.docId !== undefined && input.docId !== docId) throw new Error('RESOURCE_DOCUMENT_MISMATCH')
  }
  async function send(url, body) {
    const headers = { Accept: 'application/json' }
    const init = { method: body ? 'POST' : 'GET', credentials: 'include', cache: 'no-store', redirect: 'error', headers }
    if (body) {
      const token = typeof options.csrfToken === 'function' ? options.csrfToken() : options.csrfToken
      headers['X-CSRF-Token'] = required(token, 'csrfToken')
      headers['Idempotency-Key'] = required(body.operationId, 'operationId')
      headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(body)
    }
    const controller = new AbortController()
    init.signal = controller.signal
    let timer
    const timeout = new Promise((resolve, reject) => {
      timer = setTimeout(() => { reject(new Error('RESOURCE_REQUEST_TIMEOUT')); controller.abort() }, 15000)
    })
    try {
      return await Promise.race([(async () => {
        const response = await request(url, init)
        if (!response || !Number.isInteger(response.status) || response.status < 100 || response.status > 599) throw new Error('RESOURCE_INVALID_RESPONSE')
        return { httpStatus: response.status, data: await response.json() }
      })(), timeout])
    } finally { clearTimeout(timer) }
  }

  return {
    createOrBind(input = {}) {
      scoped(input)
      if (input.mode !== 'create' && input.mode !== 'bind') throw new TypeError('resources: mode 必须是 create 或 bind')
      const body = { mode: input.mode, docId, sourceSystem: required(input.sourceSystem, 'sourceSystem'),
        externalResourceId: required(input.externalResourceId, 'externalResourceId'), operationId: required(input.operationId, 'operationId') }
      if (input.expectedRevision !== undefined) body.expectedRevision = revision(input.expectedRevision, 'expectedRevision')
      if (input.grantIntent !== undefined) {
        const grant = input.grantIntent
        if (!grant || !Array.isArray(grant.scopes)) throw new TypeError('resources: grantIntent.scopes 必须是数组')
        body.grantIntent = { subject: required(grant.subject, 'grantIntent.subject'), scopes: grant.scopes.map(scope => required(scope, 'grantIntent.scope')) }
      }
      return send(`${integration}/resource-bindings`, body)
    },
    queryBinding(input = {}) {
      scoped(input)
      const query = new URLSearchParams({ sourceSystem: required(input.sourceSystem, 'sourceSystem'),
        externalResourceId: required(input.externalResourceId, 'externalResourceId') })
      return send(`${integration}/resource-bindings?${query}`)
    },
    unbind(input = {}) {
      scoped(input)
      const body = { expectedRevision: revision(input.expectedRevision, 'expectedRevision'), operationId: required(input.operationId, 'operationId') }
      if (input.sourceRevision !== undefined) body.sourceRevision = revision(input.sourceRevision, 'sourceRevision')
      return send(`${integration}/resource-bindings/${encodeURIComponent(required(input.bindingId, 'bindingId'))}/unbind-operations`, body)
    },
    requestDeletion(input = {}) {
      scoped(input)
      return send(`${integration}/resource-bindings/${encodeURIComponent(required(input.bindingId, 'bindingId'))}/deletion-intents`, {
        sourceRevision: revision(input.sourceRevision, 'sourceRevision'), operationId: required(input.operationId, 'operationId'),
      })
    },
    queryOperation(input = {}) {
      scoped(input)
      if (!['create', 'bind', 'unbind', 'deletion-intent'].includes(input.commandType)) throw new TypeError('resources: commandType 无效')
      const query = new URLSearchParams({ commandType: input.commandType })
      if (input.requestHash !== undefined) query.set('requestHash', required(input.requestHash, 'requestHash'))
      return send(`${publicApi}/operations/${encodeURIComponent(required(input.operationId, 'operationId'))}?${query}`)
    },
  }
}
