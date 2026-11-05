/**
 * Vue2 options 兼容入口：只借宿主的组件 API，始终挂载原生 DOM renderer。
 * 不引入 Vue 运行时，不保留第二套业务实现或 SFC。
 */
// 兼容组件也复用公开核心入口的polyfill与公共样式，避免单独构建覆盖CSS。
import LarkDoc from '../index'
import LarkDocEditor from '../components/lark-doc/LarkDocEditor.js'
import LarkDocWorkspace from '../components/lark-doc/LarkDocWorkspace.js'
import { createVue2Renderer } from '../mount/vueRenderer'

export {
  LarkDoc,
  LarkDocEditor,
  LarkDocWorkspace,
  createVue2Renderer,
}

export default LarkDoc
