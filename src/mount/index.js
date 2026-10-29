/**
 * mount/ — 渲染适配层（唯一允许依赖 UI 框架的目录）。
 *
 * 为什么要有这一层：
 * 命令式门面 `LarkDoc` 不该关心“用哪个框架画 UI”。历史上它直接 `new Vue(...)`
 * 挂载 Workspace，导致整个包被 Vue 2 绑死：外层必须是 Vue 2、且版本还得一致。
 * 这里把「挂载 / 更新 / 卸载」收敛成一个可替换的 renderer 契约：
 *
 *   createRenderer() -> {
 *     name                                        // 'vue2' 等，便于诊断
 *     mount({ element, props, on }) -> handle     // 插入 DOM，返回适配器自有句柄
 *     update(handle, props)                       // 增量更新变更的 props
 *     destroy(handle)                             // 卸载并移除 DOM
 *     getInstance(handle) -> workspace 实例        // 供门面转发实例方法
 *     getRoot(handle) -> Element                  // 渲染出的根节点（宿主打主题属性用）
 *   }
 *
 * **五个动作，不多不少**。多出来的动作基本都是框架细节漏出这一层（`$forceUpdate`、
 * `$refs`、`$el` 之类），阶段 5 换成原生 DOM 渲染器时会直接断。
 * 契约由 `npm run check:architecture` 的 R3 规则运行时锁死：缺一个动作、或多一个
 * 函数型成员，校验链立刻红。
 *
 * 目前默认仍是 Vue 2 实现（vueRenderer）；另有显式 opt-in 的迁移期 DOM 实现
 *（domRenderer）。DOM 实现尚未覆盖 Vue 编辑器的全部 UI 状态机，因此不会切默认。
 * 上层（LarkDoc / web-component）禁止 import 任何框架，只能 import 本目录。
 */
import { createVue2Renderer } from './vueRenderer'
import { createDomRenderer } from './domRenderer'

let override = null

/** 当前生效的渲染适配器。默认 Vue 2；DOM 版必须显式 opt-in。 */
export function createRenderer(options = {}) {
  if (override) return override()
  if (options && options.renderer === 'dom') return createDomRenderer()
  return createVue2Renderer()
}

/**
 * 替换全局渲染适配器（测试或自研无框架渲染器使用）。
 * 传 null 恢复默认 Vue 2 实现。
 */
export function setRenderer(factory) {
  override = typeof factory === 'function' ? factory : null
}

export { createVue2Renderer, createDomRenderer }
export default createRenderer
