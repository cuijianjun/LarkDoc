/**
 * adapters/vue3 — Vue 3 端适配入口（P0-06）。
 *
 * Vue 3 端的形态与 Vue 2 不同：**消费 lark-doc/element 的 Web Component**，
 * 不依赖 lark-doc 的 Vue 2 渲染层。Vue 3 模板里直接写 <lark-doc> 标签，
 * 本文件只补齐三件适配职责（08 §4.1 硬规则 5）：
 *
 * 1. props → attributes：resolveVue3Attrs() 把宿主 props 按
 *    web-component/attributes 的 ATTRIBUTE_SCHEMA 白名单序列化成
 *    HTML 属性字符串（对象型配置请走 property / options，见 attributes.js 注释）；
 * 2. 事件转发：VUE3_EVENTS 是 <lark-doc> 派发 CustomEvent 的名单，
 *    模板里写 @lark-doc-change="..." / @lark-doc-save="..."；
 * 3. 方法代理：元素自身已代理 getJSON / setContent / focus 等快捷方法，
 *    Vue 3 侧通过 template ref 直接调用即可，无需再包一层。
 *
 * 用法（Vue 3 宿主）：
 *   import 'lark-doc/element'
 *   import { resolveVue3Attrs, VUE3_EVENTS } from 'lark-doc/vue3'
 *   <lark-doc v-bind="resolveVue3Attrs({ content: html, contentFormat: 'html' })"
 *             @lark-doc-change="onChange" />
 *
 * 注意：lark-doc/element 是构建产物（dist/lark-doc-element.umd.min.js），
 * 源码内含 Vue 2 SFC，Vue 3 宿主不能直接引 lark-doc 源码入口。
 */
import { ATTRIBUTE_SCHEMA } from '../../web-component/attributes'
// 只引零依赖的 events 名单，不引 LarkDocElement（其依赖链含 Vue 2 SFC）。
import { EVENT_MAP } from '../../web-component/events'
// 首次序列化属性时探一次「<lark-doc> 有没有注册」：漏 import 'lark-doc/element'
// 时元素是 HTMLUnknownElement，静默不渲染 —— 必须报出来（内部有一次性缓存）。
import { assertLarkDocElement } from '../../web-component/assert'

/** <lark-doc> 派发的 CustomEvent 名单（camelCase 事件名 → DOM 事件名）。 */
export const VUE3_EVENTS = Object.freeze({ ...EVENT_MAP })

/**
 * props → HTML attributes（v-bind 用）。
 * 只放行 ATTRIBUTE_SCHEMA 里登记过的属性；未登记的 key 会被忽略并告警，
 * 避免 Vue 3 侧拼错属性名后静默失效。
 */
export function resolveVue3Attrs(props = {}) {
  // 探针放在这里而不是模块顶层：模块可能在 SSR 端被 import，浏览器端首次渲染才是
  // 该判定的时机。assert 内部有一次性缓存，逐次渲染不产生额外开销。
  assertLarkDocElement()
  const byAttr = new Map(ATTRIBUTE_SCHEMA.map((entry) => [entry.attr, entry]))
  const attrs = {}
  for (const [key, value] of Object.entries(props)) {
    const attr = key.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`)
    const entry = byAttr.get(attr)
    if (!entry) {
      if (typeof console !== 'undefined') {
        console.warn(`[lark-doc adapters/vue3] 未登记的属性 "${key}" 已忽略（对象型配置请走 property）`)
      }
      continue
    }
    if (value == null) continue
    if (entry.type === 'boolean') {
      // HTML 布尔属性语义：存在即 true，字符串 "false"/"0"/"off" 为 false。
      if (value === false) attrs[attr] = 'false'
      else if (value === true) attrs[attr] = ''
      else attrs[attr] = String(value)
      continue
    }
    attrs[attr] = entry.type === 'string' ? String(value) : typeof value === 'object' ? JSON.stringify(value) : String(value)
  }
  return attrs
}

export { assertLarkDocElement, isLarkDocElementReady } from '../../web-component/assert'
