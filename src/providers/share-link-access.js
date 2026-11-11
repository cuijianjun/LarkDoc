/* global globalThis */
import { createShareLinkAccessPort } from './share-links'

const id = value => typeof value === 'string' && /^[A-Za-z0-9._-]{1,128}(?![\s\S])/.test(value)
const fail = (code, status) => Object.assign(new Error(code), { code, ...(status === undefined ? {} : { status }) })
function base(value) {
  if (value === undefined || value === '') return ''
  if (typeof value !== 'string' || Array.from(value).some(char => char.codePointAt(0) <= 32 || char.codePointAt(0) === 127) || /[\\?#]/.test(value) || value.startsWith('//')) throw fail('SHARE_LINK_CONFIGURATION')
  const relative = value.startsWith('/'), url = new URL(value, 'https://share-link.invalid')
  if (url.username || url.password || (!relative && url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) ||
    (relative && url.origin !== 'https://share-link.invalid') || url.pathname.replace(/\/+$/, '') !== value.replace(/^https?:\/\/[^/]+/, '').replace(/\/+$/, '')) throw fail('SHARE_LINK_CONFIGURATION')
  return value.replace(/\/+$/, '')
}

/** Cookie-only public transport. Passwords and the original ledger stay inside the cold port. */
export function createHttpShareLinkAccessProvider(options = {}) {
  if (!id(options.tenantId) || !id(options.docId)) throw fail('SHARE_LINK_CONFIGURATION')
  const request = options.request || globalThis.fetch?.bind(globalThis)
  if (typeof request !== 'function') throw fail('SHARE_LINK_CONFIGURATION')
  const root = `${base(options.baseUrl)}/editor/v1/tenants/${encodeURIComponent(options.tenantId)}/documents/${encodeURIComponent(options.docId)}`
  const controllers = new Set()
  let generation = 0, disposed = false
  const check = epoch => { if (disposed || epoch !== generation) throw fail('SHARE_LINK_CONTEXT_CHANGED') }
  async function send(path, body) {
    const epoch = generation; check(epoch)
    const controller = new AbortController(); controllers.add(controller)
    let timer, abort
    const cancelled = new Promise((resolve, reject) => {
      abort = () => reject(fail('SHARE_LINK_REQUEST_ABORTED'))
      controller.signal.addEventListener('abort', abort, { once: true })
      timer = setTimeout(() => controller.abort(), 15000)
    })
    const stage = async work => { check(epoch); const result = await Promise.race([work(), cancelled]); check(epoch); if (controller.signal.aborted) throw fail('SHARE_LINK_REQUEST_ABORTED'); return result }
    const json = async (suffix, input) => {
      const response = await stage(() => request(root + '/' + suffix, { method: input ? 'POST' : 'GET', credentials: 'include', cache: 'no-store', redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/json', ...(input ? { 'Content-Type': 'application/json', 'Idempotency-Key': input.operationId } : {}) },
        ...(input ? { body: JSON.stringify(input) } : {}) }))
      if (!response || !Number.isInteger(response.status) || response.redirected) throw fail('SHARE_LINK_INVALID_RESPONSE')
      const data = await stage(() => response.json())
      if (!data || typeof data !== 'object' || Array.isArray(data) || Object.prototype.hasOwnProperty.call(data, 'token')) throw fail('SHARE_LINK_INVALID_RESPONSE')
      return { status: response.status, data }
    }
    try {
      if (body) {
        try {
          const initialized = await json('share-link-access/context')
          if (initialized.status !== 200 || initialized.data.ready !== true || Object.keys(initialized.data).length !== 1) {
            const code = ['SHARE_LINK_CRYPTO_UNAVAILABLE', 'SHARE_LINK_BUSY', 'SHARE_LINK_RATE_LIMIT'].includes(initialized.data.code) ? initialized.data.code : 'SHARE_LINK_BUSY'
            return { status: initialized.status >= 400 ? initialized.status : 503, data: { code } }
          }
        } catch { check(epoch); return { status: 503, data: { code: 'SHARE_LINK_BUSY' } } } // No POST was sent, so this is a confirmed unavailable attempt.
      }
      if (body && options.beforeUnlock) {
        try { options.beforeUnlock() } catch { check(epoch); return { status: 503, data: { code: 'SHARE_LINK_BUSY' } } }
      }
      return await json(path, body)
    } finally { clearTimeout(timer); controller.signal.removeEventListener('abort', abort); controllers.delete(controller) }
  }
  const port = createShareLinkAccessPort({ send,
    operationId() {
      if (typeof globalThis.crypto?.getRandomValues !== 'function') throw fail('SHARE_LINK_CRYPTO_UNAVAILABLE')
      return 'share-link-access-' + Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')
    }, error: fail,
    digest: value => typeof value === 'string' && /^sha256:[a-f0-9]{64}(?![\s\S])/.test(value),
    decimal: value => typeof value === 'string' && /^(0|[1-9][0-9]*)(?![\s\S])/.test(value) })
  const reset = () => { generation++; controllers.forEach(controller => controller.abort()); controllers.clear(); port.reset() }
  return {
    request(input) { check(generation); return port.request(input) },
    query() { check(generation); return port.query() },
    operation: () => port.operation(),
    getPending() { const value = port.operation(); return value && ['pending', 'unknown'].includes(value.status) ? value : null },
    reset,
    dispose() { disposed = true; reset() },
  }
}
