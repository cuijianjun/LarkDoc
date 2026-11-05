/**
 * 工作台 UI projection 的纯函数边界。
 *
 * 输入只接受普通 state / props，不读取 Vue、DOM 或 controller 实例。
 */
import { previewToHtml } from '../../components/lark-doc/ai'
import { canEditContent, deriveInteractionMode } from '../blocks/interaction-mode'

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
  return {
    notice: deriveNotice(state),
    aiPreviewHtml: deriveAIPreviewHtml(state),
    readonly: deriveWorkspaceReadonly(state, props),
    featureFlags,
    persistenceEnabled: featureFlags.persistence,
    importExportEnabled: featureFlags.importExport,
    templatesEnabled: featureFlags.templates,
    historyEnabled: featureFlags.history,
    aiEnabled: featureFlags.ai,
  }
}

export default createWorkspaceViewState
