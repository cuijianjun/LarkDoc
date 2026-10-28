/**
 * Vue 2 端 NodeView 注册入口。
 *
 * 阶段 2 之后这里**不再注册任何 NodeView**：图片块与代码块都已下沉为 core 自带的
 * 纯 DOM 实现（`core/nodeviews/image.js`、`core/nodeviews/code-block.js`），
 * 三端共用，静态依赖里不再出现 UI 框架。
 *
 * 函数保留是宿主覆盖用的「注册表缝」：某个端想用自己的组件替换某个节点的渲染，
 * 在 `new LarkDoc(options)` 之前调用 `setNodeView(name, renderer)` 即可 ——
 * 装配 schema 时 core 按名字查表，注册优先于 core 默认实现。
 */
export function registerVue2NodeViews() {
  // 历史实现（CodeNode.vue）已由 core/nodeviews/code-block.js 取代。
  return []
}
