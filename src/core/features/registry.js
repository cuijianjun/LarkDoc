/**
 * 可选特性注册表（阶段 4 · MASTER_PLAN §4）。
 *
 * 解决的问题：lite 主产物（dist/lark-doc-lite.esm.js）与特性包
 * （dist/features/*.js）是两个独立 bundle，各自持有 registry.js 的模块副本；
 * ESM/CJS 双包形态下甚至可能各有两份。注册表挂到宿主全局（globalThis），
 * 让所有副本共享同一张 Map —— 主产物 loadFeature('math') 能看到特性包
 * registerFeature('math') 写入的 loader，与加载顺序无关（两边都走同一全局）。
 *
 * 契约（特性名 → loader resolve 值）：
 *   math            → katex API（与 core/blocks/math.js loadKatex 同形）
 *   mermaid         → mermaid 实例（有 initialize / render）
 *   highlight       → 注册好语言的 hljs 实例
 *   markdown        → { marked, TurndownService }
 *   office.buildDocx → { buildDocx }（rich Word 导出，src/utils/export/docx.js）
 *   office.docx     → docx 命名空间（纯文本 Word 导出）
 *   office.mammoth  → mammoth 实例（docx 导入）
 *
 * 错误一律加注特性名再抛出：调用方的 catch（降级提示）能把「哪个可选能力
 * 没装上」带进 UI，而不是一句裸的模块解析失败。
 */

/* global globalThis -- ES2020 全局；文件内仅作 typeof 探测与共享挂载点 */

const REGISTRY_KEY = '__LARK_DOC_FEATURES__'

/** 宿主全局：globalThis 优先，兜底浏览器 / worker / Node 三种传统全局。 */
function hostGlobal() {
  if (typeof globalThis !== 'undefined') return globalThis
  if (typeof window !== 'undefined') return window
  if (typeof self !== 'undefined') return self
  if (typeof global !== 'undefined') return global
  return undefined
}

/**
 * 取（必要时创建）全局注册表。全局对象不可写时返回 null：
 * registerFeature 会显式报错，loadFeature / hasFeature 则退回内置通道。
 */
function getMap() {
  const host = hostGlobal()
  if (!host) return null
  let map = host[REGISTRY_KEY]
  if (map instanceof Map) return map
  map = new Map()
  try {
    host[REGISTRY_KEY] = map
  } catch (_) {
    return null
  }
  return map
}

function annotate(error, name) {
  const reason = error && error.message ? error.message : String(error)
  if (error instanceof Error) {
    if (error.message.indexOf(`[lark-doc] 特性 "${name}"`) === -1) {
      error.message = `[lark-doc] 特性 "${name}" 加载失败：${reason}`
    }
    return error
  }
  return new Error(`[lark-doc] 特性 "${name}" 加载失败：${reason}`)
}

/**
 * 注册一个特性的加载器。loader 返回值（或 resolve 值）即该特性的实现，
 * 允许重复注册（后写覆盖先写）——宿主升级特性包时直接换文件重挂即可。
 *
 * @param {string} name 特性名（见文件头契约表）
 * @param {Function} loader 同步返回值或返回 Promise
 * @returns {Function} 解绑函数：仅当当前映射未被覆盖时移除
 */
export function registerFeature(name, loader) {
  if (typeof name !== 'string' || !name) throw new TypeError('registerFeature：特性名必须是非空字符串')
  if (typeof loader !== 'function') throw new TypeError(`registerFeature("${name}")：loader 必须是函数`)
  const map = getMap()
  if (!map) throw new Error(`registerFeature("${name}")：当前环境没有可写的全局对象，无法注册特性`)
  map.set(name, loader)
  return () => {
    if (map.get(name) === loader) map.delete(name)
  }
}

/** 该特性是否已有注册的 loader（内置通道不算）。 */
export function hasFeature(name) {
  const map = getMap()
  return !!(map && map.has(name))
}

/**
 * 加载特性：注册的 loader 优先；未注册时走 fallback（包内置的动态 import），
 * 两者都没有则 reject。任何错误加注特性名。
 *
 * @param {string} name 特性名
 * @param {Function} [fallback] 内置加载通道（返回 Promise / 值的函数）
 * @returns {Promise}
 */
export function loadFeature(name, fallback) {
  const map = getMap()
  const entry = map && map.get(name)
  if (typeof entry === 'function') {
    return Promise.resolve().then(entry).catch((error) => {
      throw annotate(error, name)
    })
  }
  if (typeof fallback !== 'function') {
    return Promise.reject(new Error(`[lark-doc] 特性 "${name}" 未注册，且没有内置加载通道；请先加载对应特性包（lark-doc/features/*）`))
  }
  return Promise.resolve().then(fallback).catch((error) => {
    throw annotate(error, name)
  })
}
