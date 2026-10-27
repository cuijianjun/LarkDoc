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
import * as providers from './providers'
import { TOOLBAR_GROUPS, TOOLBAR_KEYS, MARK_KEYS, resolveToolbarKeys } from './toolbarKeys'
import { createNetworkPolicy, NETWORK_MODES, DEFAULT_NETWORK } from './networkPolicy'
import { detectLegacyHtml, isVditorHtml, normalizeVditorHtml } from './legacy'

export {
  LarkDoc,
  createLarkDoc,
  LarkDocEditor,
  LarkDocWorkspace,
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
  documentOperations,
  mockAI,
  ai,
  DocumentSession,
  createDocumentSession,
  documentSchema,
  transactionMetadata,
  migrations,
  providers,
}

export default LarkDoc
