/**
 * NodeView 注册表 —— core 与具体 UI 框架之间唯一的单向缝。
 *
 * `extensions.js` 只问一句「有没有人注册了这个节点的 NodeView」，
 * 不关心它是 Vue 写的、React 写的还是原生 DOM 写的。注册动作由三端
 * 适配层在各自模块加载时完成（Vue 2 端见 `src/adapters/vue2/`）。
 *
 * 阶段 2 起，所有块类型（`image` / `codeBlock` / `sheet` / `bitable` …）都自带
 * core 的**纯 DOM** NodeView，`addNodeView()` 写成
 * `getNodeView(name) || createXxxNodeView()` —— 注册表从此是**宿主覆盖缝**：
 * 不注册就用 core 默认实现，注册了就用宿主的。Vue 2 端（`src/adapters/vue2/`）
 * 目前一个都不注册。
 */
const registry = new Map()

/** 注册一个节点的 NodeView renderer（`VueNodeViewRenderer(Component)` 的返回值）。 */
export function setNodeView(name, renderer) {
  registry.set(name, renderer)
}

/** 取一个节点的 NodeView renderer；没人注册时为 undefined。 */
export function getNodeView(name) {
  return registry.get(name)
}
