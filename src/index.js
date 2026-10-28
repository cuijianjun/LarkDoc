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
