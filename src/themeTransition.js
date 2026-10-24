/**
 * themeTransition —— 主题切换的动效编排（12 T4-02 / T4-03）。
 *
 * 两条路径**互斥、不叠加**（叠加会出现「bloom 里再渐变一次」的糊感）：
 *   ① 支持 View Transitions API 且未开 reduced-motion → 整页快照做圆形 bloom；
 *   ② 否则 → 属性一步到位，下一帧再挂 `.ld-theme-transition`（300ms 后摘），
 *      让颜色类属性补一段 200ms 缓动。
 *
 * 「首帧不挂」是硬要求：class 必须在属性生效**之后**的下一帧才加，
 * 否则浏览器会把属性变更本身也纳入过渡，看到的是「旧色慢慢挪到新色」的拖影，
 * 而不是干净的一次换色。
 *
 * reduced-motion 下两条路径都自动失效：CSS 层由 lark-doc.css 现有规则统一清零，
 * JS 层这里也不启动 VT。
 */

const TRANSITION_CLASS = 'ld-theme-transition'
/** class 存活窗口：略长于 200ms 过渡，保证收尾不被截断。 */
const TRANSITION_WINDOW_MS = 300
/** bloom 圆心变量（CSS 侧 @keyframes ld-theme-bloom 读它）。 */
const BLOOM_X = '--ld-theme-bloom-x'
const BLOOM_Y = '--ld-theme-bloom-y'

let timer = null

function getMatchMedia() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  return window.matchMedia('(prefers-reduced-motion: reduce)')
}

/** 系统「减弱动效」偏好。非浏览器环境按 false（不阻止必要逻辑）。 */
export function prefersReducedMotion() {
  const query = getMatchMedia()
  return Boolean(query && query.matches)
}

/** View Transitions 能力检测：只检测，不 polyfill（12 T4-03）。 */
export function supportsViewTransitions() {
  return typeof document !== 'undefined' && typeof document.startViewTransition === 'function'
}

function nextFrame(callback) {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => callback())
    return
  }
  setTimeout(callback, 16)
}

/**
 * 把 bloom 圆心写到 <html>：取根容器可见矩形的中心。
 * 为什么取根容器而不是点击处：换档入口不止一个（工具栏 / 设置 / 宿主 / system
 * 自动切换），把圆心绑到某一次点击会让其余入口的圆心飘到屏幕外，扩散看不全。
 */
function setBloomOrigin(root) {
  if (typeof document === 'undefined' || !document.documentElement) return
  const style = document.documentElement.style
  if (!style || typeof style.setProperty !== 'function') return
  let x = 50
  let y = 50
  if (root && typeof root.getBoundingClientRect === 'function') {
    const rect = root.getBoundingClientRect()
    const vw = (typeof window !== 'undefined' && window.innerWidth) || rect.width || 1
    const vh = (typeof window !== 'undefined' && window.innerHeight) || rect.height || 1
    if (rect.width && rect.height) {
      x = Math.round(((rect.left + rect.width / 2) / vw) * 100)
      y = Math.round(((rect.top + rect.height / 2) / vh) * 100)
    }
  }
  style.setProperty(BLOOM_X, `${x}%`)
  style.setProperty(BLOOM_Y, `${y}%`)
}

/**
 * 主题切换收尾动效（T4-02）。属性已生效后调用，下一帧挂 class，300ms 后摘掉 ——
 * 常驻过渡会拖慢 hover 等交互（每次 hover 都多 200ms 尾巴），所以只开短窗口。
 *
 * @param {Element|null} root 根容器（.lark-doc）
 */
export function scheduleThemeTransition(root) {
  if (!root || !root.classList || typeof root.classList.add !== 'function') return
  nextFrame(() => {
    if (!root.classList) return
    root.classList.add(TRANSITION_CLASS)
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      if (root.classList && typeof root.classList.remove === 'function') root.classList.remove(TRANSITION_CLASS)
      timer = null
    }, TRANSITION_WINDOW_MS)
  })
}

/**
 * 换档入口：把「写 DOM」这一步包进动效编排里。
 *
 * - 支持 VT 且未 reduced-motion：属性变更发生在 startViewTransition 的快照回调内，
 *   由浏览器拍 old/new 两帧做圆形 bloom（圆心见 setBloomOrigin）；
 * - 否则：属性同步写完，再补一段 class 缓动。
 *
 * VT 抛错（例如已有过渡进行中）时静默退回第二条路径 —— 换色本身绝不能因此失败。
 *
 * @param {Element|null} root  根容器
 * @param {function}     apply 真正写 DOM 的函数（applyToRoot）
 */
export function runThemeTransition(root, apply) {
  const write = typeof apply === 'function' ? apply : function () {}
  if (!root) { write(); return }
  if (supportsViewTransitions() && !prefersReducedMotion()) {
    setBloomOrigin(root)
    try {
      swallowViewTransitionRejections(document.startViewTransition(() => { write() }))
      return
    } catch (error) {
      // 少数状态下 VT 会抛（已有过渡进行中 / 页面正在卸载）：走下面的普通路径。
    }
  }
  write()
  scheduleThemeTransition(root)
}

/**
 * 吞掉 ViewTransition 三个 promise 的 rejection。
 * 为什么必须吞：换档被跳过（页面正在导航 / 标签被关 / 又一次换档插进来）时浏览器会
 * reject 成 AbortError，不接就会冒一个 unhandledrejection —— 换色本身是成功的，
 * 却会污染宿主的全局错误监控（Sentry 一类会当线上事故报）。
 */
function swallowViewTransitionRejections(transition) {
  if (!transition || typeof transition !== 'object') return
  ;['ready', 'finished', 'updateCallbackDone'].forEach((key) => {
    const promise = transition[key]
    if (promise && typeof promise.catch === 'function') promise.catch(() => {})
  })
}

/** 供销毁时清理，避免定时器挂着已卸载的根容器。 */
export function cancelThemeTransition() {
  if (timer) { clearTimeout(timer); timer = null }
}
