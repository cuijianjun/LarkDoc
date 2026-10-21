/**
 * web-component/index — Web Component 入口（feishu-document/element）。
 *
 * 用法（任意框架 / 无框架）：
 *
 *   import 'feishu-document/element'          // 自动注册 <feishu-document>
 *   import 'feishu-document/dist/style.css'   // 若没有开启自动注入样式
 *
 *   <feishu-document readonly theme="light"></feishu-document>
 *
 *   const el = document.querySelector('feishu-document')
 *   el.addEventListener('feishu-change', (e) => console.log(e.detail.payload.json))
 *   el.getJSON()
 *
 * 本入口与 src/index.js 的差异：**不导出任何 Vue 组件**。任何 UI 框架依赖都被封在
 * mount/ 渲染适配层与 Web Component 产物内部，外层宿主不需要安装 Vue。
 */

// Tiptap 3 与个别依赖使用 ES2022/ES2023 API（findLast / at / structuredClone）。
// 必须在入口显式补齐，否则旧版 Safari/Chrome 与 Node 14 会在运行时抛 TypeError。
import 'core-js/features/array/find-last'
import 'core-js/features/array/find-last-index'
import 'core-js/features/array/at'
import 'core-js/features/structured-clone'
// 样式随入口进入构建：element 构建关闭 CSS 抽取，样式由 JS 注入 <style>，
// 宿主无需再单独 import css（零配置可用）。
import '../../style.css'

import { FeishuDocument } from '../FeishuDocument'
import { FeishuDocumentElement, DEFAULT_TAG, registerFeishuDocument, upgradeFeishuDocument, isRegistered } from './register'

/**
 * 手动创建元素：`createFeishuDocumentElement(options)` 返回已挂载前的元素，
 * 宿主 append 到文档后自动初始化。适合 React / Vue 的 ref 容器场景。
 */
export function createFeishuDocumentElement(options = {}) {
  if (typeof document === 'undefined') throw new Error('createFeishuDocumentElement 需要浏览器环境')
  registerFeishuDocument(DEFAULT_TAG)
  const el = document.createElement(DEFAULT_TAG)
  if (options && typeof options === 'object') {
    Object.keys(options).forEach((key) => {
      if (key === 'element') return
      el.setAttribute(key, String(options[key]))
    })
  }
  return el
}

/**
 * 命令式挂载到已有节点（不注册自定义元素也能用）：
 * 返回 FeishuDocument 实例，宿主自行 destroy()。
 */
export function mountFeishuDocument(element, options = {}) {
  return new FeishuDocument({ ...options, element })
}

// 默认自动注册；宿主如果想用自定义标签名，先 import 本模块的具名导出手动注册即可。
const AUTO_REGISTER = true
if (AUTO_REGISTER) registerFeishuDocument(DEFAULT_TAG)

export {
  FeishuDocument,
  FeishuDocumentElement,
  registerFeishuDocument,
  upgradeFeishuDocument,
  isRegistered,
  DEFAULT_TAG,
}

export default FeishuDocumentElement
