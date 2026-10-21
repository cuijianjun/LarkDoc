// Tiptap 3 与个别依赖使用 ES2022/ES2023 API（findLast / at / structuredClone）。
// 这些代码在 node_modules 里，babel 的按需 polyfill 扫描不到，必须在入口显式补齐，
// 否则 Node 14 与旧版 Safari/Chrome 会在 setContent 等路径直接抛 TypeError。
import 'core-js/features/array/find-last'
import 'core-js/features/array/find-last-index'
import 'core-js/features/array/at'
import 'core-js/features/structured-clone'
// 样式随入口一并进入构建，保证 dist/feishu-document.css 自带正文样式与
// 本地 KaTeX 字体；宿主显式 import 'feishu-document/style.css' 也走同一份源。
import '../style.css'
import FeishuDocumentEditor from './components/feishu/FeishuDocumentEditor.vue'
import FeishuDocumentWorkspace from './components/feishu/FeishuDocumentWorkspace.vue'
import FeishuDocument, { createFeishuDocument } from './FeishuDocument'
import { createWorkspace } from './components/feishu/workspace'
import { createFeishuConfig } from './components/feishu/feishuConfig'
import { TEMPLATES } from './components/feishu/templates'
import { createEcsImageUpload } from './components/feishu/ecsImages'
import * as documentOperations from './components/feishu/documentOperations'
import * as mockAI from './components/feishu/mockAI'
import { DocumentSession, createDocumentSession } from './session/DocumentSession'
import * as documentSchema from './core/documentSchema'
import * as transactionMetadata from './core/transactionMetadata'
import * as migrations from './core/migrations'
import * as providers from './providers'
import { TOOLBAR_GROUPS, TOOLBAR_KEYS, MARK_KEYS, resolveToolbarKeys } from './toolbarKeys'
import { createNetworkPolicy, NETWORK_MODES, DEFAULT_NETWORK } from './networkPolicy'
import { detectLegacyHtml, isVditorHtml, normalizeVditorHtml } from './legacy'

export {
  FeishuDocument,
  createFeishuDocument,
  FeishuDocumentEditor,
  FeishuDocumentWorkspace,
  createWorkspace,
  createFeishuConfig,
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
  DocumentSession,
  createDocumentSession,
  documentSchema,
  transactionMetadata,
  migrations,
  providers,
}

export default FeishuDocument
