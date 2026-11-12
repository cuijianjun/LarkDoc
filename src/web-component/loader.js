/* Small UMD bootstrap for the Web Component distribution. */
const RUNTIME_FILE = 'lark-doc-element.runtime.umd.min.js'

function runtimeBase() {
  if (typeof document === 'undefined') return ''
  const current = document.currentScript && document.currentScript.src
  if (current) return current
  const candidate = Array.from(document.scripts || []).find(script => /lark-doc(?:-element|-wc)?[^/]*\.js(?:\?|$)/i.test(script.src || ''))
  return candidate?.src || document.baseURI || ''
}

export function loadLarkDocRuntime() {
  if (typeof document === 'undefined') return Promise.resolve(null)
  const existing = document.querySelector('script[data-lark-doc-runtime="true"]')
  if (existing) return existing.__larkDocRuntimePromise || Promise.resolve(window.LarkDocRuntime || null)
  const src = new URL(RUNTIME_FILE, runtimeBase()).href
  const script = document.createElement('script')
  script.async = false
  script.src = src
  script.dataset.larkDocRuntime = 'true'
  const promise = new Promise((resolve, reject) => {
    script.onload = () => resolve(window.LarkDocRuntime || window.LarkDoc || null)
    script.onerror = () => reject(new Error(`无法加载 Web Component runtime：${src}`))
  })
  script.__larkDocRuntimePromise = promise
  ;(document.head || document.documentElement).appendChild(script)
  return promise
}

export const runtimeReady = loadLarkDocRuntime()
