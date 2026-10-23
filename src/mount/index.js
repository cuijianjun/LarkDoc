/**
 * mount/ — 渲染适配层（唯一允许依赖 UI 框架的目录）。
 *
 * 为什么要有这一层：
 * 命令式门面 `LarkDoc` 不该关心“用哪个框架画 UI”。历史上它直接 `new Vue(...)`
 * 挂载 Workspace，导致整个包被 Vue 2 绑死：外层必须是 Vue 2、且版本还得一致。
 * 这里把「挂载 / 更新 / 卸载」收敛成一个可替换的 renderer 契约：
 *
 *   createRenderer() -> {
 *     mount({ element, props, on }) -> instance   // 插入 DOM，返回适配器自有句柄
 *     update(instance, props)                     // 增量更新变更的 props
 *     destroy(instance)                           // 卸载并移除 DOM
 *     getInstance(instance) -> workspace 组件实例  // 供门面转发实例方法
 *   }
 *
 * 目前只提供 Vue 2 实现（vueRenderer）；将来换成原生 DOM 渲染器时，只要实现同一份
 * 契约并在 createRenderer 里切换，LarkDoc 与 Web Component 外壳都无需改动。
 * 上层（LarkDoc / web-component）禁止 import 任何框架，只能 import 本目录。
 */
import { createVue2Renderer } from './vueRenderer'

let override = null

/** 当前生效的渲染适配器。默认 Vue 2；可通过 setRenderer 替换以实现去框架化。 */
export function createRenderer() {
  return override ? override() : createVue2Renderer()
}

/**
 * 替换全局渲染适配器（测试或自研无框架渲染器使用）。
 * 传 null 恢复默认 Vue 2 实现。
 */
export function setRenderer(factory) {
  override = typeof factory === 'function' ? factory : null
}

export { createVue2Renderer }
export default createRenderer
