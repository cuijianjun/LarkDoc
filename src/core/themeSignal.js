/**
 * themeSignal — 正文轨主题变化广播（12 T3-01）。
 *
 * 为什么需要它：纯 CSS 组件换主题只是变量重算，浏览器自动重绘；但 mermaid 渲染出的
 * SVG 里是**固化的颜色属性**，不会跟随变量，必须重新渲染。全库只在这里观察一次
 * `data-content-theme`，避免每个图表块各挂一个 MutationObserver。
 *
 * 降级口径（12 §3 T3-01「图数 > 20 降级为仅新渲染生效」）：订阅者数量即图表块数量，
 * 超过 HEAVY_LIMIT 时回调带 `degraded: true`，由调用方跳过重渲染 —— 一次切换触发
 * 几十个 mermaid 重排会明显卡顿，而用户真正在看的只是视口内那几张图。
 *
 * 非浏览器环境（SSR / 脚本预渲染）安全空操作。
 */

/** 超过该订阅者数量即降级为「仅新渲染生效」。 */
export const CONTENT_THEME_HEAVY_LIMIT = 20

const listeners = new Set()
let observer = null
let lastTheme = null

/** 读当前已解析的正文轨主题（只认 dark，其余一律 light —— 契约上是二值）。 */
export function readContentTheme() {
  if (typeof document === 'undefined') return 'light'
  const root = document.querySelector('.lark-doc')
  const value = (root && root.getAttribute('data-content-theme')) ||
    (document.documentElement && document.documentElement.getAttribute('data-content-theme'))
  return value === 'dark' ? 'dark' : 'light'
}

function notify() {
  const theme = readContentTheme()
  // 属性一次变更可能产生多条 mutation 记录，去重后再广播。
  if (theme === lastTheme) return
  lastTheme = theme
  const degraded = listeners.size > CONTENT_THEME_HEAVY_LIMIT
  Array.from(listeners).forEach((listener) => {
    try {
      listener({ theme, degraded })
    } catch (error) {
      // 单个订阅者异常不能连带其他图表块不换色。
    }
  })
}

/**
 * 观察 documentElement 的子树属性：主题属性由根容器（.lark-doc）或宿主写在
 * documentElement 上都覆盖到；attributeFilter 把观察成本压到只有这一个属性。
 */
function ensureObserver() {
  if (observer || typeof MutationObserver !== 'function' || typeof document === 'undefined') return
  const target = document.documentElement
  if (!target) return
  lastTheme = readContentTheme()
  observer = new MutationObserver(notify)
  observer.observe(target, { attributes: true, subtree: true, attributeFilter: ['data-content-theme'] })
}

/**
 * 订阅正文轨主题变化。
 *
 * @param {function({theme: string, degraded: boolean}): void} listener
 * @returns {function(): void} 取消订阅（最后一个订阅者退订时释放观察器）
 */
export function subscribeContentTheme(listener) {
  if (typeof listener !== 'function') return function () {}
  listeners.add(listener)
  ensureObserver()
  return function unsubscribe() {
    listeners.delete(listener)
    if (listeners.size === 0 && observer) {
      observer.disconnect()
      observer = null
      lastTheme = null
    }
  }
}
