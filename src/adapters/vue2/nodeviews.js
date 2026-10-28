/**
 * Vue 2 端 NodeView 注册入口。
 *
 * 图片块已改为 core 自带的纯 DOM NodeView（`src/core/nodeviews/image.js`），三端共用，
 * 不在这里注册；如果某个宿主想用 Vue 组件覆盖图片，在这里补一行 setNodeView 即可。
 * 代码块仍是 Vue 2 专属实现，所以住在这一层。
 *
 * 注册只做一件事：把「节点名 → NodeView renderer」写进 core 的注册表，
 * core 装配 schema 时按名字查表，静态依赖里因此不再出现 UI 框架。
 * 将来 vue3 / react 适配层各自在这里注册同名节点的自己的实现即可。
 */
import { VueNodeViewRenderer } from '@tiptap/vue-2'
import { setNodeView } from '../../registry/nodeviews'
import CodeNode from './CodeNode.vue'

export function registerVue2NodeViews() {
  setNodeView('codeBlock', VueNodeViewRenderer(CodeNode))
}
