/**
 * adapters/vue2 — Vue 2 端适配入口（P0-06）。
 *
 * 职责边界（对齐 08 §4.1 硬规则 5：适配层只做三件事——props→options、事件转发、方法代理）：
 * - NodeView 注册：图片 / 代码块的 Vue 2 实现住在 ./nodeviews.js，
 *   宿主在 `new LarkDoc(options)` 之前调用一次 registerVue2NodeViews()；
 * - 门面转发：主 demo 的「new LarkDoc(options)」用法原样可用，
 *   本文件只是把它显式收拢为 Vue 2 端的单一入口，方便按端阅读。
 *
 * 用法（Vue 2 宿主）：
 *   import { LarkDoc, registerVue2NodeViews } from 'lark-doc/adapters/vue2'
 *   registerVue2NodeViews()
 *   const doc = new LarkDoc({ element, title, content, ... })
 */
import LarkDoc, { createLarkDoc } from '../../LarkDoc'
import { registerVue2NodeViews } from './nodeviews'

export { LarkDoc, createLarkDoc, registerVue2NodeViews }
export default LarkDoc
