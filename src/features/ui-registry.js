/**
 * Element 面板包的跨包注册桥。
 *
 * 面板工厂按触发时机拆成两个 UMD：`ui`（选区/悬浮/表格/顶栏，鼠标一动就要用）
 * 与 `uiPanels`（侧栏面板/对话框/浮层，点了才用）。两个 bundle 各带一份本模块
 * 副本，所以合并表必须挂在宿主全局：
 *   先加载的包建表并发布 `ui.ready`，后加载的把工厂并进去。
 * 已经拿到 `ui.ready` 句柄的延迟包装器因此不用重新取，也不会看到半个 api——
 * 它只在真正被调用时读 `api[工厂名]`，那时该包要么已并表，要么根本还没加载。
 */
import { registerFeature } from '../core/features/registry'

const UI_API_KEY = '__LARK_DOC_UI_API__'
const UI_READY_KEY = '__LARK_DOC_UI_READY__'

/** 宿主全局：与 core/features/registry 同口径，优先 globalThis。 */
function hostGlobal() {
  if (typeof globalThis !== 'undefined') return globalThis
  if (typeof window !== 'undefined') return window
  if (typeof self !== 'undefined') return self
  return undefined
}

/**
 * 发布一个面板包的工厂表。
 *
 * @param {string} pack 特性名（`ui` / `ui.panels`），该包自己的加载槽位
 * @param {object} factories 工厂名 → 实现
 * @returns {object} 合并后的全局面板 api（两个包共享同一实例）
 */
export function registerUiApi(pack, factories) {
  const host = hostGlobal()
  if (!host) throw new Error(`registerUiApi("${pack}")：当前环境没有可写的全局对象，无法发布面板工厂`)
  let api = host[UI_API_KEY]
  if (!api || typeof api !== 'object') api = host[UI_API_KEY] = {}
  Object.assign(api, factories)
  // 只挂一次：ui.ready 必须始终指向同一个可增长的对象，否则先加载的包
  // 发布的那份快照会让后加载的工厂永远读不到。
  if (!host[UI_READY_KEY]) {
    host[UI_READY_KEY] = true
    registerFeature('ui.ready', () => api)
  }
  registerFeature(pack, () => api)
  return api
}
