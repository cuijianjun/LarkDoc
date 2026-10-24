/**
 * NodeView 注册表 —— core 与具体 UI 框架之间唯一的单向缝。
 *
 * `extensions.js` 只问一句「有没有人注册了这个节点的 NodeView」，
 * 不关心它是 Vue 写的、React 写的还是原生 DOM 写的。注册动作由三端
 * 适配层在各自模块加载时完成（Vue 2 端见 `src/adapters/vue2/`）。
 *
 * 查不到就返回 undefined：`extensions.js` 里 `addNodeView()` 收到 undefined
 * 时，Tiptap 会退回 renderHTML 的默认渲染，节点照样能用，只是没有富 NodeView。
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
