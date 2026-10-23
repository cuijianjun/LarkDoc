/**
 * Vue 2 端 NodeView 注册入口。
 *
 * 图片 / 代码块这两个 NodeView 的实现是 Vue 2 专属的，所以住在这里，不进 core。
 * 注册只做一件事：把「节点名 → NodeView renderer」写进 core 的注册表，
 * core 装配 schema 时按名字查表，静态依赖里因此不再出现任何 UI 框架。
 * 将来 vue3 / react 适配层各自在这里注册同名节点的自己的实现即可。
 */
import { VueNodeViewRenderer } from '@tiptap/vue-2'
import { setNodeView } from '../../registry/nodeviews'
import ImageNode from './ImageNode.vue'
import CodeNode from './CodeNode.vue'

export function registerVue2NodeViews() {
  setNodeView('image', VueNodeViewRenderer(ImageNode))
  setNodeView('codeBlock', VueNodeViewRenderer(CodeNode))
}
