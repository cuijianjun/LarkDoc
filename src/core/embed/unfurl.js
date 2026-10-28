/**
 * 网页元数据 Provider（`unfurl`）—— requirements/09 §265。
 *
 * 第 6 个 **可选** provider：不进 5 类必选契约（collaboration / comments /
 * versioning / authorization / persistence）。缺失时网页卡片降级成「纯链接 + 域名标题」，
 * 能力不受影响 —— 所以这里所有的失败都**不抛错、不返回 error 码给 UI**：
 *
 *   🔴 飞书的抓取失败 = 一张只有 URL + 域名的正常简卡（02 §24 ③-ter，batch367/370
 *   两次独立复现：无「网页无法访问」文案、无重试按钮、无 toast、`errs: []`）。
 *
 * 于是本模块的契约是：
 *
 *   `unfurl(url) → Promise<{ ok, url, title, desc, favicon, error }>`
 *
 *   - **永远 resolve**，不 reject；
 *   - `ok: false` 只给宿主做日志/埋点，**不要拿去渲染**（渲染只看 `title` 是否为空）；
 *   - `title` / `desc` / `favicon` 一律可能为 `null`，渲染层用「标题回落域名」兜住。
 *
 * 编辑器不持 token、不直接发请求：真正的抓取由宿主传入（同 `onAction` 的思路）。
 * 建议接口形状见 02 §24 ⑥：`POST /api/docx/bookmark/unfurl { url }` → `{ title, desc,
 * favicon }`，失败返回 **null 字段而不是 error**。
 */
import { readBookmarkMeta, readBookmarkUrl } from './bookmark'

export const UNFURL_ERROR = Object.freeze({
  /** 不是合法的 http(s) 地址：不必发请求。 */
  INVALID_URL: 'invalid_url',
  /** 宿主实现抛错。 */
  FAILED: 'failed',
  /** 超过 `timeout` 还没回来。 */
  TIMEOUT: 'timeout',
  /** 宿主没提供抓取实现（`createUnfurlProvider` 会直接返回 null）。 */
  UNAVAILABLE: 'unavailable',
  /** 被出网策略拦下（P3-06）：这一条**根本没进宿主函数**，不是抓取失败。 */
  BLOCKED: 'blocked',
})

export const DEFAULT_UNFURL_TIMEOUT = 8000
const DEFAULT_CACHE_LIMIT = 100

function settle(url, value, error) {
  return { ok: !error, url, ...readBookmarkMeta(value), error: error || null }
}

/**
 * 造一个可注入的 provider。
 *
 * @param {Function|{ unfurl?: Function, fetch?: Function, timeout?: number, cache?: boolean, cacheLimit?: number }} option
 *   裸函数等价于 `{ unfurl: fn }`；`fn(url, ctx?)` 可返回 Promise 或同步值，
 *   形状 `{ title, desc, favicon }`（多余字段忽略）。
 * @returns {{ unfurl: (url: string, ctx?: object) => Promise<object>, clear: () => void, size: () => number } | null}
 *   没给抓取实现时返回 `null` —— 调用方据此走「纯链接降级」，不要当成异常。
 */
export function createUnfurlProvider(option) {
  const source = option && typeof option === 'object' ? option : {}
  const fetchMeta = typeof option === 'function'
    ? option
    : typeof source.unfurl === 'function'
      ? source.unfurl
      : typeof source.fetch === 'function'
        ? source.fetch
        : null
  if (!fetchMeta) return null

  const timeout = Number.isFinite(source.timeout) && source.timeout > 0
    ? source.timeout
    : DEFAULT_UNFURL_TIMEOUT
  const cacheLimit = Number.isFinite(source.cacheLimit) && source.cacheLimit > 0
    ? source.cacheLimit
    : DEFAULT_CACHE_LIMIT
  const useCache = source.cache !== false
  const inflight = new Map()

  function run(url, ctx) {
    return new Promise((resolve) => {
      let settled = false
      const done = (value, error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(settle(url, value, error))
      }
      // 超时也要给结果：卡片必须从骨架态翻到简卡，不能挂着等（02 §24 ③-ter 的 122 是瞬态）。
      const timer = setTimeout(() => done(null, UNFURL_ERROR.TIMEOUT), timeout)
      let result
      try {
        result = fetchMeta(url, ctx)
      } catch (_) {
        done(null, UNFURL_ERROR.FAILED)
        return
      }
      if (result && typeof result.then === 'function') {
        result.then((value) => done(value || null, null), () => done(null, UNFURL_ERROR.FAILED))
        return
      }
      done(result || null, null)
    })
  }

  return {
    unfurl(url, ctx) {
      const target = readBookmarkUrl(url)
      if (!target) return Promise.resolve(settle(String(url || ''), null, UNFURL_ERROR.INVALID_URL))
      if (!useCache) return run(target, ctx)
      const cached = inflight.get(target)
      if (cached) return cached
      const task = run(target, ctx)
      inflight.set(target, task)
      if (inflight.size > cacheLimit) {
        // 简单的 FIFO 淘汰：够用，且不会因为 Map 无限增长把长文档撑爆。
        const oldest = inflight.keys().next()
        if (!oldest.done) inflight.delete(oldest.value)
      }
      return task
    },
    /** 清缓存（宿主切换租户 / 换 endpoint 时调）。 */
    clear() { inflight.clear() },
    size() { return inflight.size },
  }
}

/**
 * 给宿主抓取器套一层出网策略闸门（P3-06）。
 *
 * 「卡片 provider 请求」是 core 里唯一会发外部请求的嵌入路径（iframe 靠 `canEmbed`，
 * 其余卡片数据本来就在正文里）。装配层用 `network.allows` 包一层，于是：
 *
 *   - `offline` / `allowlist` 下**被拦的地址连宿主函数都不进** —— 策略要求「不发请求」，
 *     而不是「发了再把结果丢掉」；
 *   - 被拦的卡片走**和抓取失败完全相同**的降级路径（`ok: false` + 三个 null 字段）：
 *     02 §24 ③-ter 的实测口径是「失败 = 一张只有 URL + 域名的正常简卡」，
 *     所以这里**不能**给 UI 一个新错误码去分叉渲染。
 *
 * 为什么 gate 在 core 而不是 `import` 策略：core 不认识策略实现，三端想换一套判定
 * 只需换传进来的谓词（同 `canEmbed` 的约定）。谓词缺失时**原样返回**，
 * 保持 P3-05 的行为逐字节不变。
 *
 * @param {Function|{ unfurl: Function }|null} provider 宿主抓取器（裸函数或对象）
 * @param {(url: string) => boolean} allows 策略谓词
 * @returns {Function|{ unfurl: Function }|null} 同形状的抓取器，被拦即返回 blocked
 */
export function withUnfurlGate(provider, allows) {
  if (!provider || typeof allows !== 'function') return provider
  const blocked = (url) => Promise.resolve(settle(String(url || ''), null, UNFURL_ERROR.BLOCKED))
  // 裸函数也是合法输入（`createUnfurlProvider(fn)` 等价形状），保持入参出参同形。
  if (typeof provider === 'function') {
    return (url, ctx) => (allows(url) ? provider(url, ctx) : blocked(url))
  }
  if (typeof provider.unfurl !== 'function') return provider
  return {
    ...provider,
    unfurl(url, ctx) {
      return allows(url) ? provider.unfurl(url, ctx) : blocked(url)
    },
  }
}
