/**
 * 跨产物共享模块表（阶段 5 · 拆包收口）。
 *
 * 解决的问题：Element 内核（lark-doc-element.runtime.umd.min.js）与它的特性包
 * 是两个独立 bundle，各自把 `src/ui/icons.js` 这类基础模块打一份。拆 ui 子包后
 * 同一个 icons 出现三份（内核 / 交互包 / 面板包），多出来的那两份既费字节也费
 * 浏览器解析编译时间。
 *
 * 做法：内核在求值时把自己已完整持有的模块命名空间挂到宿主全局，特性包在构建期
 * 把这些模块换成一段 shim（只列出导出名，转发到全局）。于是包里不再有实现体。
 *
 * 只登记「内核已完整持有」的模块 —— 内核是 tree-shaken 的，若某个模块内核只用到
 * 一小部分（例如 segmentedDocumentModel 内核只留 2.3 KB），提上去会把懒加载内容
 * 拉进首屏，反而变大。登记条件见 rollup.config.mjs 的 sharedHostModules 注释。
 */

/* global globalThis -- ES2020 全局；与 features/registry.js 同一套探测口径 */

const SHARED_KEY = '__LARK_DOC_SHARED__'

/** 宿主全局：globalThis 优先，兜底浏览器 / worker / Node 三种传统全局。 */
function hostGlobal() {
  if (typeof globalThis !== 'undefined') return globalThis
  if (typeof window !== 'undefined') return window
  if (typeof self !== 'undefined') return self
  if (typeof global !== 'undefined') return global
  return undefined
}

/**
 * 发布共享模块（内核侧调用，只跑一次）。
 *
 * 允许重复发布：宿主升级内核时直接换文件重挂即可，后写覆盖先写。
 *
 * @param {Object<string, object>} modules 键是构建期登记的模块名，值是命名空间
 * @returns {object} 宿主全局上的共享表
 */
export function publishSharedModules(modules) {
  const host = hostGlobal()
  if (!host) throw new Error('publishSharedModules：当前环境没有可写的全局对象')
  let table = host[SHARED_KEY]
  if (!table || typeof table !== 'object') table = host[SHARED_KEY] = {}
  Object.assign(table, modules)
  return table
}

/** 读取已发布的共享模块；未发布时返回 null（供测试与版本探测）。 */
export function readSharedModule(name) {
  const host = hostGlobal()
  const table = host && host[SHARED_KEY]
  return table && typeof table === 'object' ? table[name] || null : null
}
