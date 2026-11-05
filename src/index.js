// Rollup 产物不依赖 Webpack runtime。按需能力通过 feature registry 和
// 标准 dynamic import() 加载，宿主可在加载独立 feature 包后复用同一注册表。

// Tiptap 3 与个别依赖使用 ES2022/ES2023 API（findLast / at / structuredClone）。
// 这些代码在 node_modules 里，babel 的按需 polyfill 扫描不到，必须在入口显式补齐，
// 否则 Node 14 与旧版 Safari/Chrome 会在 setContent 等路径直接抛 TypeError。
import 'core-js/features/array/find-last'
import 'core-js/features/array/find-last-index'
import 'core-js/features/array/at'
import 'core-js/features/structured-clone'
// Mermaid也使用ES2021/2022 API；Node14 DOM宿主需显式补齐。
import 'core-js/features/object/has-own'
import 'core-js/features/string/replace-all'
// 样式随入口一并进入构建，保证 dist/lark-doc.css 自带正文样式与
// 本地 KaTeX 字体；宿主显式 import 'lark-doc/style.css' 也走同一份源。
import '../style.css'
import LarkDoc from './LarkDoc'
import { TOOLBAR_GROUPS, TOOLBAR_KEYS, MARK_KEYS, resolveToolbarKeys } from './toolbarKeys'
import { createNetworkPolicy, NETWORK_MODES, DEFAULT_NETWORK } from './networkPolicy'
import { detectLegacyHtml, isVditorHtml, normalizeVditorHtml } from './legacy'

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
}

export default LarkDoc
