/**
 * web-component/index — Web Component 入口（lark-doc/element）。
 *
 * 用法（任意框架 / 无框架）：
 *
 *   import 'lark-doc/element'          // 自动注册 <lark-doc>（样式随 JS 注入，无需另引 CSS）
 *
 *   <lark-doc readonly theme="light"></lark-doc>
 *
 *   const el = document.querySelector('lark-doc')
 *   el.addEventListener('lark-doc-change', (e) => console.log(e.detail.payload.json))
 *   el.getJSON()
 *
 * 本入口与 src/index.js 的差异：**不导出任何 Vue 组件**。任何 UI 框架依赖都被封在
 * mount/ 渲染适配层与 Web Component 产物内部，外层宿主不需要安装 Vue。
 */

// Rollup 产物不依赖 Webpack runtime。按需能力通过 feature registry 和
// 标准 dynamic import() 加载，宿主可在加载独立 feature 包后复用同一注册表。

// Tiptap 3 与个别依赖使用 ES2022/ES2023 API（findLast / at / structuredClone），
// 旧版 Safari/Chrome 与 Node 14 会在运行时抛 TypeError；Mermaid 另用 hasOwn /
// replaceAll。这些 polyfill 已移到独立产物 `lark-doc-element.polyfills.umd.min.js`
// （见 ./polyfills.js），由引导体 loader.js 在注入本内核**之前**按特性检测决定
// 是否加载——core-js 为这 6 个 API 要拖进 170+ 个内部模块，不值得让现代浏览器
// 陪着下载。走 ESM 入口（src/index.js）的宿主仍自行内联补齐。
// 样式随入口进入构建：ESM 档关闭 CSS 抽取，样式由 JS 注入 <style>，宿主无需再
// 单独 import css；UMD 档（standalone.js 走这里）抽取成 lark-doc-element.css，
// 由 loader 注入 <link> 与内核并行下载，省掉 JS 里 265 KB 的样式字符串。
import '../../style.css'

import { LarkDoc } from '../LarkDoc'
import { createRenderer } from '../mount'
import { LarkDocElement as BaseLarkDocElement, DEFAULT_TAG, registerLarkDoc as registerElement, upgradeLarkDoc, isRegistered } from './register'

class LarkDocElement extends BaseLarkDocElement {
  _mount(preservedState = {}) {
    if (this.document || !this.isConnected) return
    const options = this.__options
    // 无持久化时 ready 可在 renderer.mount 返回前同步发出；交回微任务，
    // 确保门面已取得 handle、元素已绑定事件，宿主才能在 ready 中写入正文。
    const mountOptions = {
      ...options,
      rendererFactory: () => {
        const renderer = createRenderer(options)
        return {
          ...renderer,
          mount: ({ on = {}, ...args }) => {
            let handle
            handle = renderer.mount({
              ...args,
              on: {
                ...on,
                ready: payload => {
                  Promise.resolve().then(() => {
                    if (renderer.getInstance(handle) && typeof on.ready === 'function') on.ready(payload)
                  }).catch(error => { if (typeof on.error === 'function') on.error(error) })
                },
              },
            })
            return handle
          },
        }
      },
    }
    this.__options = mountOptions
    try { super._mount(preservedState) } finally {
      if (this.__options === mountOptions) this.__options = options
    }
  }
}

function registerLarkDoc(tagName = DEFAULT_TAG, options = {}) {
  return registerElement(tagName, { elementClass: LarkDocElement, ...options })
}

/**
 * 手动创建元素：`createLarkDocElement(options)` 返回已挂载前的元素，
 * 宿主 append 到文档后自动初始化。适合 React / Vue 的 ref 容器场景。
 */
export function createLarkDocElement(options = {}) {
  if (typeof document === 'undefined') throw new Error('createLarkDocElement 需要浏览器环境')
  registerLarkDoc(DEFAULT_TAG)
  const el = document.createElement(DEFAULT_TAG)
  if (options && typeof options === 'object') {
    const configuration = { ...options }
    delete configuration.element
    el.options = configuration
  }
  return el
}

/**
 * 命令式挂载到已有节点（不注册自定义元素也能用）：
 * 返回 LarkDoc 实例，宿主自行 destroy()。
 */
export function mountLarkDoc(element, options = {}) {
  return new LarkDoc({ ...options, element })
}

// 默认自动注册；宿主如果想用自定义标签名，先 import 本模块的具名导出手动注册即可。
const AUTO_REGISTER = true
if (AUTO_REGISTER) registerLarkDoc(DEFAULT_TAG)

export {
  LarkDoc,
  LarkDocElement,
  registerLarkDoc,
  upgradeLarkDoc,
  isRegistered,
  DEFAULT_TAG,
}

export default LarkDocElement
