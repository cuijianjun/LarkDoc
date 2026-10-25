/**
 * LarkDoc 编辑器的公开配置契约。
 * createLarkDocConfig 负责规范化与守卫：未知字段丢弃、非法值回落默认值，
 * 保证组件拿到的 config 恒定可用。这里保持 schema 稳定：关闭能力只隐藏
 * 入口并阻止新操作，历史 JSON 仍可读取。
 */
import { MAX_BLOCK_INDENT } from './documentOperations'

export const LARK_DOC_FEATURES = Object.freeze([
  'history', 'headings', 'marks', 'textStyle', 'blockStyle', 'tables', 'images',
  'codeBlocks', 'math', 'emoji', 'templates', 'callouts', 'columns', 'search',
  'outline', 'folding', 'blockHandle', 'blockDrag', 'ai', 'viewModes', 'shortcuts', 'insert',
  'persistence', 'importExport', 'diagram',
  // 文件 / 视频块（P2-04）：视频与附件共用同一个 `file` 块，所以只有一个开关。
  'files',
])

export const DEFAULT_LARK_DOC_CONFIG = Object.freeze({
  features: {
    history: true, headings: true, marks: true, textStyle: true, blockStyle: true,
    tables: true, images: true, codeBlocks: true, math: true, emoji: true,
    templates: true, callouts: true, columns: true, search: true, outline: true,
    folding: true, blockHandle: true, blockDrag: true, ai: true, viewModes: true,
    shortcuts: true, insert: true,
    persistence: true, importExport: true,
    // 图表预览（mermaid）：关闭后代码块保持纯源码形态，渲染器不会加载。
    diagram: true,
    // 文件 / 视频块：关闭后斜杠菜单不再出现「视频或文件」，粘贴与拖入也不落块。
    files: true,
  },
  toolbar: {
    history: true, headings: true, marks: true, textStyle: true, blockStyle: true,
    insert: true, tables: true, ai: true, search: true, outline: true, viewModes: true,
    shortcuts: true,
    // null = 展示全部行内格式；数组 = 只展示列出的 mark。
    marksAllow: null,
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
  layout: {
    // 标题栏默认跟随文档滚动，宿主可按页面场景开启顶端吸附。
    titleBarFixed: false,
    // 工具栏吸附顶端：开启后滚动时格式工具栏固定在标题栏下方。
    toolbarFixed: false,
    // 顶部标题栏可见性：置 false 时整行隐藏，原有 header-actions 插槽内容
    // 自动移入工具栏右侧「⋯」下拉弹窗，功能入口不丢失。
    headerVisible: true,
  },
  text: {
    // 正文为空时的占位提示，命令式入口的 placeholder 配置项落到这里。
    placeholder: '输入正文，或输入 / 插入内容',
  },
  network: {
    // 默认放行：老系统的 http 图床可直接显示。需要离线时显式改为 'offline'。
    mode: 'open',
    allowlist: [],
  },
  limits: {
    titleLength: 120,
    maxLength: 0,
    maxImageSize: 5 * 1024 * 1024,
    // 附件上限：02 L4188 实测飞书斜杠 `file` 的报错是「文件大小为 0 MB 或者大于 10 GB」，
    // 上下限同一句，下限是开区间 0（0 字节直接拒）。
    maxFileSize: 10 * 1024 * 1024 * 1024,
    maxTableRows: 9,
    maxTableColumns: 9,
    maxIndent: 5,
    maxSnapshots: 20,
  },
  performance: {
    // 0 keeps synchronous change notifications for hosts that depend on them.
    changeDebounce: 16,
    stateUpdateFrame: true,
    syntaxHighlight: true,
    // 图表渲染器（mermaid）的脚本地址。默认用包内 vendored 产物：
    // 源码打包的宿主由 file-loader 自动落盘；直接消费预构建 dist 的宿主
    // 需把 dist/vendor/ 拷进站点静态目录，或在此指定自托管地址。
    diagramScriptUrl: null,
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

export function createLarkDocConfig(overrides = {}) {
  const source = isPlainObject(overrides) ? overrides : {}
  const config = {
    ...DEFAULT_LARK_DOC_CONFIG,
    features: mergeSection(DEFAULT_LARK_DOC_CONFIG.features, source.features),
    toolbar: mergeSection(DEFAULT_LARK_DOC_CONFIG.toolbar, source.toolbar),
    commands: mergeSection(DEFAULT_LARK_DOC_CONFIG.commands, source.commands),
    blockMenu: mergeSection(DEFAULT_LARK_DOC_CONFIG.blockMenu, source.blockMenu),
    layout: mergeSection(DEFAULT_LARK_DOC_CONFIG.layout, source.layout),
    text: mergeSection(DEFAULT_LARK_DOC_CONFIG.text, source.text),
    network: mergeSection(DEFAULT_LARK_DOC_CONFIG.network, source.network),
    limits: mergeSection(DEFAULT_LARK_DOC_CONFIG.limits, source.limits),
    performance: mergeSection(DEFAULT_LARK_DOC_CONFIG.performance, source.performance),
  }

  // Unknown feature names are ignored by the UI, while known names always have a boolean value.
  LARK_DOC_FEATURES.forEach((name) => { config.features[name] = config.features[name] !== false })
  config.layout.titleBarFixed = config.layout.titleBarFixed === true
  config.layout.toolbarFixed = config.layout.toolbarFixed === true
  config.layout.headerVisible = config.layout.headerVisible !== false
  config.toolbar.marksAllow = Array.isArray(config.toolbar.marksAllow) ? config.toolbar.marksAllow.filter((id) => typeof id === 'string') : null
  config.network.mode = ['offline', 'allowlist', 'open'].includes(config.network.mode) ? config.network.mode : DEFAULT_LARK_DOC_CONFIG.network.mode
  config.network.allowlist = Array.isArray(config.network.allowlist)
    ? config.network.allowlist.map((host) => String(host || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean)
    : []
  config.limits.titleLength = Math.max(1, Number(config.limits.titleLength) || DEFAULT_LARK_DOC_CONFIG.limits.titleLength)
  config.limits.maxLength = Math.max(0, Number(config.limits.maxLength) || 0)
  config.limits.maxImageSize = Math.max(1, Number(config.limits.maxImageSize) || DEFAULT_LARK_DOC_CONFIG.limits.maxImageSize)
  // 文件上限允许调到 10 GB 以上（宿主可能有自己的配额），只挡非正数。
  config.limits.maxFileSize = Math.max(1, Number(config.limits.maxFileSize) || DEFAULT_LARK_DOC_CONFIG.limits.maxFileSize)
  config.limits.maxTableRows = Math.max(1, Math.min(9, Number(config.limits.maxTableRows) || 9))
  config.limits.maxTableColumns = Math.max(1, Math.min(9, Number(config.limits.maxTableColumns) || 9))
  config.limits.maxIndent = Math.max(0, Math.min(MAX_BLOCK_INDENT, Number(config.limits.maxIndent) || MAX_BLOCK_INDENT))
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
  return createLarkDocConfig(next)
}
