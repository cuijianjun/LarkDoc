/**
 * web-component/events — <lark-doc> 事件名单（框架无关、零依赖）。
 *
 * 从 LarkDocElement.js 抽出独立模块（P0-06）：adapters/{vue3,react} 只需要
 * 事件名单，不需要元素类本身——元素类依赖链会拉进 Vue 2 渲染层（mount/vueRenderer
 * → LarkDocWorkspace.vue），React / Vue 3 宿主的构建器没有 Vue 2 插件，
 * 引了就编译失败。本文件必须保持零 import。
 */

/**
 * 对外事件名（全部冒泡 + composed，方便宿主在任意祖先节点委托监听）。
 * payload 一律是纯数据（不含 Vue 实例 / ProseMirror 对象），避免跨框架时
 * Proxy 包装导致的结构化克隆失败。
 */
export const EVENT_MAP = Object.freeze({
  ready: 'lark-doc-ready',
  update: 'lark-doc-update',
  change: 'lark-doc-change',
  save: 'lark-doc-save',
  error: 'lark-doc-error',
  destroy: 'lark-doc-destroy',
  'import-report': 'lark-doc-import-report',
  'title-change': 'lark-doc-title-change',
})
