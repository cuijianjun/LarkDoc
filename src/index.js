// 按需区块（math / office / mermaid / highlight）的基址。
// **只对 element 产物有意义**（阶段 3 起只有它还旁挂懒区块，CJS 档改成用 require()
// 加载兄弟文件，不需要任何基址推导）。element 是「预打包直挂」产物：默认用
// document.currentScript 推导 chunk 目录，静态 <script src> 引主文件时推导正确。
// 但被宿主**打包器** import 时，currentScript 指向的是宿主自己的脚本，
// 于是 `__webpack_require__.e('math')` 会去请求 /js/math.js 之类的错误位置 ——
// 首屏正常，一插公式 / 导出 Word 就 404，且极难排查。
// 宿主显式给一个基址即可：window.__LARK_DOC_PUBLIC_PATH__ = '/vendor/lark-doc/'。
// 不设则完全走原行为；非 webpack 环境（Node / vitest）因为先判空而不会执行赋值。
if (typeof window !== 'undefined' && window.__LARK_DOC_PUBLIC_PATH__) {
  __webpack_public_path__ = window.__LARK_DOC_PUBLIC_PATH__
}

// Tiptap 3 与个别依赖使用 ES2022/ES2023 API（findLast / at / structuredClone）。
// 这些代码在 node_modules 里，babel 的按需 polyfill 扫描不到，必须在入口显式补齐，
// 否则 Node 14 与旧版 Safari/Chrome 会在 setContent 等路径直接抛 TypeError。
import 'core-js/features/array/find-last'
import 'core-js/features/array/find-last-index'
import 'core-js/features/array/at'
import 'core-js/features/structured-clone'
// 样式随入口一并进入构建，保证 dist/lark-doc.css 自带正文样式与
// 本地 KaTeX 字体；宿主显式 import 'lark-doc/style.css' 也走同一份源。
import '../style.css'
import LarkDoc from './LarkDoc'
import { TOOLBAR_GROUPS, TOOLBAR_KEYS, MARK_KEYS, resolveToolbarKeys } from './toolbarKeys'
import { createNetworkPolicy, NETWORK_MODES, DEFAULT_NETWORK } from './networkPolicy'
import { detectLegacyHtml, isVditorHtml, normalizeVditorHtml } from './legacy'
import { createTemplateLibrary } from './ui/templateLibrary'

const LarkDocTemplateLibrary = createTemplateLibrary

/**
 * 默认入口只暴露编辑器核心和无重量的基础配置工具。
 * 模板、评论、版本、providers、迁移和文档操作均通过独立子入口提供，
 * 避免普通编辑器消费方因为具名导出而建立低频依赖图。
 */
export {
  LarkDoc,
  TOOLBAR_GROUPS,
  TOOLBAR_KEYS,
  MARK_KEYS,
  resolveToolbarKeys,
  createNetworkPolicy,
  NETWORK_MODES,
  DEFAULT_NETWORK,
  detectLegacyHtml,
  isVditorHtml,
  normalizeVditorHtml,
  createTemplateLibrary,
  LarkDocTemplateLibrary,
}

export default LarkDoc
