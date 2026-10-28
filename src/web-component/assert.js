/**
 * web-component/assert — 元素注册探测（零依赖，仅供 adapters 复用）。
 *
 * 要解决的是**静默失效**：宿主装了 `lark-doc`，写了 `<lark-doc ref>`，
 * 但忘了 `import 'lark-doc/element'` —— 此时浏览器把该标签当成未知元素
 * （HTMLUnknownElement），不报错、不渲染、ref 上所有方法都是 undefined。
 * 排查成本极高（页面白框、控制台干净），所以在挂载点主动探一次。
 *
 * 三条约定的取舍：
 * 1. **console.error 而不是 throw**：throw 会打断宿主整棵组件树的挂载，
 *    把「少了一行 import」放大成「白屏」；一条可行动的红色日志足够定位。
 * 2. **SSR 直接放过**：Node 端没有 customElements，判定为 true 不误报。
 * 3. **只探一次**：模块级 verified 缓存，避免组件反复渲染时刷屏。
 */

import { DEFAULT_TAG } from './tag'

let verified = false
let warned = false

/**
 * 检查 `<lark-doc>` 是否已注册。
 * @param {string} [tagName=DEFAULT_TAG]
 * @param {{ force?: boolean }} [options] force=true 时绕过缓存重新判定
 * @returns {boolean} 已注册（或处于 SSR / 无 customElements 环境）→ true
 */
export function assertLarkDocElement(tagName = DEFAULT_TAG, options = {}) {
  if (!options.force && verified) return true
  if (typeof window === 'undefined' || !window.customElements) {
    // SSR：不判定，也不缓存 —— 浏览器端首次调用还要再探一次。
    return true
  }
  if (window.customElements.get(tagName)) {
    verified = true
    return true
  }
  if (!warned && typeof console !== 'undefined') {
    warned = true
    console.error(
      `[lark-doc] <${tagName}> 尚未注册。adapters 只做桥接，元素本体在 element 入口，` +
      '请在宿主入口最先执行 `import \'lark-doc/element\'`' +
      '（webpack 4 宿主写全 `lark-doc/dist/lark-doc-element.umd.min.js`）。'
    )
  }
  return false
}

/** 只判定不告警（宿主想自己决定提示方式时用）。 */
export function isLarkDocElementReady(tagName = DEFAULT_TAG) {
  if (typeof window === 'undefined' || !window.customElements) return false
  return Boolean(window.customElements.get(tagName))
}

/** 仅供测试复位探测状态。 */
export function __resetAssertState() {
  verified = false
  warned = false
}
