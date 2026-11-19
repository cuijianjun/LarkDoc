/* Small UMD bootstrap for the Web Component distribution.
 *
 * 这个文件是唯一进入宿主应用加载路径的 Element 代码，所以它自己必须很小，
 * 而且**不能**在模块顶层把 runtime 拉下来：runtime 是 600 KB 级的编辑内核，
 * 文档里没有编辑器、或者编辑器在首屏之外时，那份字节纯属浪费。
 *
 * 策略：落地时只挂观察器，等 `<lark-doc>` 进入视口前 400px 再注入 runtime
 * 脚本。`customElements.define()` 会按标准自动 upgrade 已存在的元素，因此
 * 「先有元素、后到定义」不会丢属性、不会丢监听器。
 */
import { DEFAULT_TAG } from './tag'

const RUNTIME_FILE = 'lark-doc-element.runtime.umd.min.js'
const POLYFILL_FILE = 'lark-doc-element.polyfills.umd.min.js'
const STYLE_FILE = 'lark-doc-element.css'
// 提前一屏加载：滚到元素时 runtime 基本已就绪，接管看起来仍是「同步」的。
const PRELOAD_MARGIN = '400px'
const PLACEHOLDER_ID = 'lark-doc-placeholder'

let runtimePromise = null
let polyfillPromise = null
let armed = false
let intersection = null
let mutation = null

function runtimeBase() {
  if (typeof document === 'undefined') return ''
  const current = document.currentScript && document.currentScript.src
  if (current) return current
  const candidate = Array.from(document.scripts || []).find(script => /lark-doc(?:-element|-wc)?[^/]*\.js(?:\?|$)/i.test(script.src || ''))
  return candidate?.src || document.baseURI || ''
}

function announce(name) {
  if (typeof document === 'undefined') return
  const Custom = document.defaultView && document.defaultView.CustomEvent
  if (!Custom) return
  document.dispatchEvent(new Custom(name))
}

/**
 * 样式表与内核并行下载。样式不再以字符串形式塞在 JS 里，所以浏览器可以边下
 * 边解析；内核求值时首屏样式通常已经就位，避免「先裸奔一帧」。
 */
function loadStyles() {
  if (typeof document === 'undefined') return
  if (document.querySelector('link[data-lark-doc-style="true"]')) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = new URL(STYLE_FILE, runtimeBase()).href
  link.dataset.larkDocStyle = 'true'
  ;(document.head || document.documentElement).appendChild(link)
}

/**
 * 内核模块顶层就会调用 `at` / `findLast` / `structuredClone`，所以 polyfill 必须
 * 在注入内核之前到位。缺的 API 与 ./polyfills.js 的 import 一一对应。
 */
function needsPolyfills() {
  const array = Array.prototype
  return typeof array.at !== 'function'
    || typeof array.findLast !== 'function'
    || typeof array.findLastIndex !== 'function'
    || typeof Object.hasOwn !== 'function'
    || typeof String.prototype.replaceAll !== 'function'
    || typeof structuredClone !== 'function'
}

function loadPolyfills() {
  if (polyfillPromise) return polyfillPromise
  // 现代浏览器（Chrome 98+ / Safari 15.4+）走这条：一个字节都不多下。
  if (!needsPolyfills()) {
    polyfillPromise = Promise.resolve()
    return polyfillPromise
  }
  const src = new URL(POLYFILL_FILE, runtimeBase()).href
  const script = document.createElement('script')
  script.async = false
  script.src = src
  script.dataset.larkDocPolyfills = 'true'
  polyfillPromise = new Promise((resolve, reject) => {
    script.onload = () => resolve()
    script.onerror = () => reject(new Error(`无法加载 Web Component polyfills：${src}`))
  }).catch(() => {
    // 补丁失败不阻断内核：旧环境可能有个别能力缺失，但不该整页白屏。
    polyfillPromise = Promise.resolve()
  })
  ;(document.head || document.documentElement).appendChild(script)
  return polyfillPromise
}

function adoptRuntime(runtime) {
  const namespace = window.LarkDoc
  if (!runtime || !namespace || typeof namespace !== 'object' || namespace === runtime) return runtime
  for (const key of Object.keys(runtime)) {
    if (key !== '__esModule') namespace[key] = runtime[key]
  }
  return namespace
}

export function loadLarkDocRuntime() {
  if (runtimePromise) return runtimePromise
  if (typeof document === 'undefined') {
    runtimePromise = Promise.resolve(null)
    return runtimePromise
  }
  const src = new URL(RUNTIME_FILE, runtimeBase()).href
  loadStyles()
  // 先补 polyfill 再注入内核，顺序不能反。
  runtimePromise = loadPolyfills().then(() => {
    const existing = document.querySelector('script[data-lark-doc-runtime="true"]')
    if (existing?.__larkDocRuntimePromise) return existing.__larkDocRuntimePromise
    const registered = () => [window.LarkDocRuntime, window.LarkDoc].find(value => typeof value?.LarkDoc === 'function')
    const previousRuntime = existing && registered()
    if (previousRuntime) return adoptRuntime(previousRuntime)
    existing?.remove()
    const script = document.createElement('script')
    script.async = false
    script.src = src
    script.dataset.larkDocRuntime = 'true'
    script.__larkDocRuntimePromise = new Promise((resolve, reject) => {
      const fail = () => reject(new Error(`无法加载 Web Component runtime：${src}`))
      script.onload = () => {
        const runtime = registered()
        if (runtime) resolve(runtime)
        else fail()
      }
      script.onerror = fail
    }).then(runtime => {
      const namespace = adoptRuntime(runtime)
      announce('lark-doc:runtime-ready')
      return namespace
    }).catch(error => {
      script.remove()
      throw error
    })
    ;(document.head || document.documentElement).appendChild(script)
    return script.__larkDocRuntimePromise
  }).catch(error => {
    runtimePromise = null
    throw error
  })
  return runtimePromise
}

function defined() {
  const registry = typeof window !== 'undefined' && window.customElements
  return !!(registry && typeof registry.get === 'function' && registry.get(DEFAULT_TAG))
}

/** 占位高度：runtime 到位前元素不塌陷，避免整页 CLS。宿主可覆盖该变量。 */
function injectPlaceholder() {
  if (typeof document === 'undefined' || document.getElementById(PLACEHOLDER_ID)) return
  const style = document.createElement('style')
  style.id = PLACEHOLDER_ID
  style.textContent = `${DEFAULT_TAG}:not(:defined){display:block;min-height:var(--lark-doc-placeholder-height,320px)}`
  ;(document.head || document.documentElement).appendChild(style)
}

function kick() {
  if (runtimePromise) return runtimePromise
  stop()
  announce('lark-doc:runtime-kick')
  return loadLarkDocRuntime()
}

function stop() {
  if (intersection) { intersection.disconnect(); intersection = null }
  if (mutation) { mutation.disconnect(); mutation = null }
}

/**
 * 开始按需引导。可重复调用；已经定义（宿主用了 ESM 档或显式注册）时不做任何事。
 */
export function armLarkDocRuntime() {
  if (armed || typeof document === 'undefined') return
  armed = true
  // 宿主已经自己注册过：runtime 的那份字节本来就是多余的。
  if (defined()) return
  injectPlaceholder()

  const seen = new WeakSet()
  const observe = node => {
    if (seen.has(node)) return
    seen.add(node)
    if (intersection) intersection.observe(node)
    // 老浏览器没有 IntersectionObserver：退化成「有元素就加载」，不能装作能用。
    else kick()
  }

  if (typeof window !== 'undefined' && typeof window.IntersectionObserver === 'function') {
    intersection = new window.IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting || entry.intersectionRatio > 0)) kick()
    }, { rootMargin: PRELOAD_MARGIN })
  }

  if (typeof window !== 'undefined' && typeof window.MutationObserver === 'function') {
    mutation = new window.MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes || []) {
          if (!node || node.nodeType !== 1) continue
          if (node.localName === DEFAULT_TAG) observe(node)
          else if (node.querySelectorAll) node.querySelectorAll(DEFAULT_TAG).forEach(observe)
        }
      }
    })
    mutation.observe(document.documentElement, { childList: true, subtree: true })
  }

  const scan = () => {
    if (runtimePromise) return
    if (defined()) { stop(); return }
    const nodes = document.querySelectorAll(DEFAULT_TAG)
    if (nodes.length) nodes.forEach(observe)
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan, { once: true })
  else scan()
}

/**
 * 显式等待 runtime 就绪。L0 之前它是模块顶层常量（一 import 就开拉），
 * 现在改成函数：`await LarkDoc.runtimeReady()` 只在真正需要时才触发加载。
 *
 * 同时保留 thenable 形状（`.then` / `.catch` / `.finally`），历史写法
 * `await LarkDoc.runtimeReady` 依旧有效，只是它现在「先加载再返回」。
 */
export function runtimeReady() {
  return loadLarkDocRuntime()
}
runtimeReady.then = (onFulfilled, onRejected) => loadLarkDocRuntime().then(onFulfilled, onRejected)
runtimeReady.catch = onRejected => loadLarkDocRuntime().catch(onRejected)
runtimeReady.finally = onFinally => loadLarkDocRuntime().finally(onFinally)

armLarkDocRuntime()
