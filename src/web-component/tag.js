/**
 * web-component/tag — 默认标签名（零依赖）。
 *
 * 单独一个文件的原因：adapters/{vue3,react} 与 assert.js 都需要这个常量，但它们
 * **不能** import register.js —— register.js 依赖 LarkDocElement，后者整条链拉进
 * Vue 2 SFC，React / Vue 3 宿主的构建器没有 Vue 2 插件，引了就编译失败。
 *
 * 所以常量下沉到这里，register.js 再 re-export，保持「一处定义、两处消费」。
 */
export const DEFAULT_TAG = 'lark-doc'

export default DEFAULT_TAG
