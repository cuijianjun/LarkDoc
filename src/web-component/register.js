/**
 * web-component/register — 自定义元素注册入口。
 *
 * 两件事：
 * 1. 幂等注册：同一标签重复 define 会抛错（HMR / 多版本共存 / Vite 依赖预构建
 *    都会重复执行模块），统一走 `customElements.get()` 守卫；
 * 2. SSR 安全：Node 环境没有 customElements，import 本模块不得炸服务端渲染。
 */

import { LarkDocElement } from './LarkDocElement'
// 常量下沉到零依赖的 tag.js：adapters 也需要它，但不能顺带拉进 Vue 2 渲染层。
import { DEFAULT_TAG } from './tag'

function getRegistry() {
  return typeof window !== 'undefined' && window.customElements ? window.customElements : null
}

/**
 * 注册自定义元素。
 * @param {string} [tagName=DEFAULT_TAG]
 * @param {{ elementClass?: typeof LarkDocElement, force?: boolean }} [options]
 * @returns {boolean} 是否真正注册成功（false 表示该标签已被注册）
 */
export function registerLarkDoc(tagName = DEFAULT_TAG, options = {}) {
  const registry = getRegistry()
  if (!registry) return false
  const elementClass = options.elementClass || LarkDocElement
  if (!options.force && registry.get(tagName)) return false
  registry.define(tagName, elementClass)
  return true
}

/** 是否已注册（用于判断是否走手动 opts）。 */
export function isRegistered(tagName = DEFAULT_TAG) {
  const registry = getRegistry()
  return registry ? Boolean(registry.get(tagName)) : false
}

/**
 * 责问式升级：宿主把 <lark-doc> 放在模板里但没 import 本模块时，
 * 调这个方法可以补齐注册并把已存在的元素 upgrade（可选）。
 */
export function upgradeLarkDoc(root = null) {
  const registry = getRegistry()
  if (!registry) return 0
  const scope = root && root.querySelectorAll ? root : typeof document !== 'undefined' ? document : null
  if (!scope) return 0
  const nodes = scope.querySelectorAll(DEFAULT_TAG)
  nodes.forEach((node) => {
    if (!(node instanceof LarkDocElement) && registry.upgrade) registry.upgrade(node)
  })
  return nodes.length
}

export { LarkDocElement, DEFAULT_TAG }
export default registerLarkDoc
