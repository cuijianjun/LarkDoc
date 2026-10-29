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
import LarkDocEditor from './components/lark-doc/LarkDocEditor.vue'
import LarkDocWorkspace from './components/lark-doc/LarkDocWorkspace.vue'
// 模板库是**宿主侧**弹窗：飞书编辑器页内零模板入口（02 §28.1），所以它不属于
// LarkDocEditor，单独导出给宿主挂在自己的「新建」入口里。
import LarkDocTemplateLibrary from './components/lark-doc/TemplateLibrary.vue'
import * as templateLibrary from './core/templates/library'
import { createTemplateLibrary } from './ui/templateLibrary'
import LarkDoc, { createLarkDoc } from './LarkDoc'
import { createWorkspace } from './components/lark-doc/workspace'
import { createLarkDocConfig } from './components/lark-doc/larkDocConfig'
import { TEMPLATES } from './components/lark-doc/templates'
import { createEcsImageUpload } from './components/lark-doc/ecsImages'
import * as documentOperations from './components/lark-doc/documentOperations'
import * as mockAI from './components/lark-doc/mockAI'
import * as ai from './components/lark-doc/ai'
import { DocumentSession, createDocumentSession } from './session/DocumentSession'
import * as documentSchema from './core/documentSchema'
import * as transactionMetadata from './core/transactionMetadata'
import * as migrations from './core/migrations'
// P6b：评论与历史版本的**数据层**。两侧的有状态面板留给宿主写 ——
// 这里给的是线程模型、锚点判定、快照/保留/恢复运算，以及一份可以直接跑的内存实现。
// 宿主照着内存实现的形状去接自己的服务即可，不必反推字段口径。
import * as comments from './core/comments'
import * as versioning from './core/versioning'
import * as providers from './providers'
import { TOOLBAR_GROUPS, TOOLBAR_KEYS, MARK_KEYS, resolveToolbarKeys } from './toolbarKeys'
import { createNetworkPolicy, NETWORK_MODES, DEFAULT_NETWORK } from './networkPolicy'
import { detectLegacyHtml, isVditorHtml, normalizeVditorHtml } from './legacy'

export {
  LarkDoc,
  createLarkDoc,
  LarkDocEditor,
  LarkDocWorkspace,
  LarkDocTemplateLibrary,
  createWorkspace,
  createLarkDocConfig,
  createEcsImageUpload,
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
  TEMPLATES,
  templateLibrary,
  createTemplateLibrary,
  documentOperations,
  mockAI,
  ai,
  DocumentSession,
  createDocumentSession,
  documentSchema,
  transactionMetadata,
  migrations,
  comments,
  versioning,
  providers,
}

export default LarkDoc
