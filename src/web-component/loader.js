/* Small UMD bootstrap for the Web Component distribution. */
const RUNTIME_FILE = 'lark-doc-element.runtime.umd.min.js'

function runtimeBase() {
  if (typeof document === 'undefined') return ''
  const current = document.currentScript && document.currentScript.src
  if (current) return current
  const candidate = Array.from(document.scripts || []).find(script => /lark-doc(?:-element|-wc)?[^/]*\.js(?:\?|$)/i.test(script.src || ''))
  return candidate?.src || document.baseURI || ''
}

/**
 * runtime 是独立的 UMD 产物，它有自己的全局名（`window.LarkDocRuntime`）。
 * 但对宿主来说契约只有一个：`window.LarkDoc` 上有构造器与工具函数
 * （`new window.LarkDoc.LarkDoc(...)`、`LarkDoc.mountLarkDoc(el)`）。
 * 所以运行时一到，就把它的导出合并进主入口建好的命名空间；两边同时保留，
 * 直接引 runtime 的老代码也不受影响。
 * @param {object|null} runtime
 * @returns {object|null}
 */
function adoptRuntime(runtime) {
  if (!runtime) return null
  const ns = window.LarkDoc
  if (!ns || typeof ns !== 'object' || ns === runtime) return runtime
  Object.keys(runtime).forEach((key) => {
    if (key === '__esModule') return
    ns[key] = runtime[key]
  })
  return ns
}

export function loadLarkDocRuntime() {
  if (typeof document === 'undefined') return Promise.resolve(null)
  const existing = document.querySelector('script[data-lark-doc-runtime="true"]')
  if (existing) return existing.__larkDocRuntimePromise || Promise.resolve(adoptRuntime(window.LarkDocRuntime))
  const src = new URL(RUNTIME_FILE, runtimeBase()).href
  const script = document.createElement('script')
  script.async = false
  script.src = src
  script.dataset.larkDocRuntime = 'true'
  const promise = new Promise((resolve, reject) => {
    script.onload = () => resolve(adoptRuntime(window.LarkDocRuntime) || window.LarkDoc || null)
    script.onerror = () => reject(new Error(`无法加载 Web Component runtime：${src}`))
  })
  script.__larkDocRuntimePromise = promise
  ;(document.head || document.documentElement).appendChild(script)
  return promise
}

export const runtimeReady = loadLarkDocRuntime()
