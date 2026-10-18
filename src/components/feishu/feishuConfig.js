// Feishu 编辑器的公开配置契约。
// 这里保持 schema 稳定：关闭能力只隐藏入口并阻止新操作，历史 JSON 仍可读取。
export const FEISHU_FEATURES = Object.freeze([
  'history', 'headings', 'marks', 'textStyle', 'blockStyle', 'tables', 'images',
  'codeBlocks', 'math', 'emoji', 'templates', 'callouts', 'columns', 'search',
  'outline', 'folding', 'blockHandle', 'blockDrag', 'ai', 'viewModes', 'shortcuts', 'insert',
  'persistence', 'importExport',
])

export const DEFAULT_FEISHU_CONFIG = Object.freeze({
  features: {
    history: true, headings: true, marks: true, textStyle: true, blockStyle: true,
    tables: true, images: true, codeBlocks: true, math: true, emoji: true,
    templates: true, callouts: true, columns: true, search: true, outline: true,
    folding: true, blockHandle: true, blockDrag: true, ai: true, viewModes: true,
    shortcuts: true, insert: true,
    persistence: true, importExport: true,
  },
  toolbar: {
    history: true, headings: true, marks: true, textStyle: true, blockStyle: true,
    insert: true, tables: true, ai: true, search: true, outline: true, viewModes: true,
    shortcuts: true,
  },
  commands: {
    disabled: [],
    // null means “use the built-in command list”; an array is an allow-list of ids.
    allow: null,
  },
  blockMenu: {
    disabled: [],
    allow: null,
  },
  limits: {
    titleLength: 120,
    maxLength: 0,
    maxImageSize: 5 * 1024 * 1024,
    maxTableRows: 9,
    maxTableColumns: 9,
    maxIndent: 8,
    maxSnapshots: 20,
  },
  performance: {
    // 0 keeps synchronous change notifications for hosts that depend on them.
    changeDebounce: 16,
    stateUpdateFrame: true,
    syntaxHighlight: true,
  },
})

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

function mergeSection(defaults, overrides) {
  const next = { ...defaults }
  if (!isPlainObject(overrides)) return next
  Object.keys(overrides).forEach((key) => {
    const value = overrides[key]
    if (Array.isArray(value)) next[key] = value.slice()
    else if (isPlainObject(value) && isPlainObject(next[key])) next[key] = { ...next[key], ...value }
    else if (value !== undefined) next[key] = value
  })
  return next
}

export function createFeishuConfig(overrides = {}) {
  const source = isPlainObject(overrides) ? overrides : {}
  const config = {
    ...DEFAULT_FEISHU_CONFIG,
    features: mergeSection(DEFAULT_FEISHU_CONFIG.features, source.features),
    toolbar: mergeSection(DEFAULT_FEISHU_CONFIG.toolbar, source.toolbar),
    commands: mergeSection(DEFAULT_FEISHU_CONFIG.commands, source.commands),
    blockMenu: mergeSection(DEFAULT_FEISHU_CONFIG.blockMenu, source.blockMenu),
    limits: mergeSection(DEFAULT_FEISHU_CONFIG.limits, source.limits),
    performance: mergeSection(DEFAULT_FEISHU_CONFIG.performance, source.performance),
  }

  // Unknown feature names are ignored by the UI, while known names always have a boolean value.
  FEISHU_FEATURES.forEach((name) => { config.features[name] = config.features[name] !== false })
  config.limits.titleLength = Math.max(1, Number(config.limits.titleLength) || DEFAULT_FEISHU_CONFIG.limits.titleLength)
  config.limits.maxLength = Math.max(0, Number(config.limits.maxLength) || 0)
  config.limits.maxImageSize = Math.max(1, Number(config.limits.maxImageSize) || DEFAULT_FEISHU_CONFIG.limits.maxImageSize)
  config.limits.maxTableRows = Math.max(1, Math.min(9, Number(config.limits.maxTableRows) || 9))
  config.limits.maxTableColumns = Math.max(1, Math.min(9, Number(config.limits.maxTableColumns) || 9))
  config.limits.maxIndent = Math.max(0, Math.min(8, Number(config.limits.maxIndent) || 8))
  config.limits.maxSnapshots = Math.max(0, Number(config.limits.maxSnapshots) || 0)
  config.performance.changeDebounce = Math.max(0, Number(config.performance.changeDebounce) || 0)
  config.performance.stateUpdateFrame = config.performance.stateUpdateFrame !== false
  config.performance.syntaxHighlight = config.performance.syntaxHighlight !== false
  return config
}

export function isConfigEnabled(config, feature) {
  return !config || !config.features || config.features[feature] !== false
}

function listAllows(list, id) {
  return !Array.isArray(list) || list.length === 0 || list.includes(id)
}

export function isCommandEnabled(config, id, feature) {
  if (!isConfigEnabled(config, feature)) return false
  const commands = config?.commands || {}
  if (Array.isArray(commands.disabled) && commands.disabled.includes(id)) return false
  return listAllows(commands.allow, id)
}

export function isBlockActionEnabled(config, id) {
  const blockMenu = config?.blockMenu || {}
  if (Array.isArray(blockMenu.disabled) && blockMenu.disabled.includes(id)) return false
  return listAllows(blockMenu.allow, id)
}

export function mergeLegacyConfig(config, props = {}) {
  const base = isPlainObject(config) ? config : {}
  const next = { ...base, limits: { ...(base.limits || {}) } }
  if (props.maxLength !== undefined && props.maxLength !== null) next.limits.maxLength = props.maxLength
  if (props.imageMaxSize !== undefined && props.imageMaxSize !== null) next.limits.maxImageSize = props.imageMaxSize
  return createFeishuConfig(next)
}
