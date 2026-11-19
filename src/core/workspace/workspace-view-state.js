/**
 * 工作台 UI projection 的纯函数边界。
 *
 * 输入只接受普通 state / props，不读取 Vue、DOM 或 controller 实例。
 */
import { previewToHtml } from '../../components/lark-doc/ai'
import { canEditContent, deriveInteractionMode } from '../blocks/interaction-mode'
import {
  createLarkDocConfig, isImportEnabled, isExportEnabled, resolveImportAccept, resolveExportOptions,
} from '../../components/lark-doc/larkDocConfig'

export const WORKSPACE_FEATURES = Object.freeze([
  'persistence',
  'importExport',
  'templates',
  'history',
  'ai',
])

function sourceConfig(state, props) {
  return state.editorConfig || props.config || state.config || {}
}

export function deriveWorkspaceFeatureFlags(state = {}, props = {}, names = WORKSPACE_FEATURES) {
  const features = sourceConfig(state, props).features
  const result = {}
  names.forEach(name => {
    result[name] = !features || features[name] !== false
  })
  return result
}

/**
 * 版本历史入口（顶栏「另存为版本」+「历史记录」）的开关。
 *
 * 不复用 `features.history` 的原因：那个开关还兼管工具栏的撤销/重做
 * （`toolbarKeys.js` 把 undo / redo 归到 history 组），拿它关版本历史会顺手
 * 把 undo/redo 一起下线。这里只认显式的 `features.versionHistory`，缺省关闭。
 */
export function deriveVersionHistoryEnabled(state = {}, props = {}) {
  const features = sourceConfig(state, props).features
  return !!features && features.versionHistory === true
}

export function deriveWorkspaceReadonly(state = {}, props = {}) {
  const mode = deriveInteractionMode({
    readonly: props.readonly === true || state.forcedReadonly === true || state.effectiveReadonly === true,
    reading: state.reading === true || state.mode === 'read',
    slides: state.slides === true,
    mode: state.mode,
    capabilities: props.capabilities || state.capabilities,
  })
  return !canEditContent(mode)
}

export function deriveAIPreviewHtml(state = {}) {
  const preview = state.aiPreview
  if (!preview) return ''
  const format = state.aiContentFormat || 'auto'
  if (format === 'text') return ''
  return previewToHtml(preview, format)
}

export function deriveNotice(state = {}) {
  return state.notice == null ? '' : String(state.notice)
}

export function createWorkspaceViewState(state = {}, props = {}) {
  const featureFlags = deriveWorkspaceFeatureFlags(state, props)
  const config = createLarkDocConfig(sourceConfig(state, props))
  return {
    notice: deriveNotice(state),
    aiPreviewHtml: deriveAIPreviewHtml(state),
    readonly: deriveWorkspaceReadonly(state, props),
    featureFlags,
    persistenceEnabled: featureFlags.persistence,
    importExportEnabled: featureFlags.importExport,
    importEnabled: isImportEnabled(config),
    exportEnabled: isExportEnabled(config),
    importAccept: resolveImportAccept(config),
    importLabel: config.importExport.importLabel,
    exportOptions: resolveExportOptions(config),
    templatesEnabled: featureFlags.templates,
    historyEnabled: deriveVersionHistoryEnabled(state, props),
    aiEnabled: featureFlags.ai,
    aiSelectionChat: !!state.aiSelectionChat,
    aiChatEpoch: state.aiChatEpoch || 0,
    aiReference: state.aiReference || null,
    aiCanReplace: !!(state.aiSelectionChat && state.aiReference?.kind === 'text' && state.aiReference.replaceable && !state.aiBudgetExceeded),
  }
}

export default createWorkspaceViewState
