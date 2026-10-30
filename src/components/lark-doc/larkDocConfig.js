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
  // 内嵌网页 15 项（P3-07）：15 条命令共用这一个开关，关掉后斜杠菜单不再出现「内嵌网页」组。
  'embed',
])

/**
 * 导入格式目录：`value` 是内部格式键（Workspace 里按它分派解析器），
 * `extensions` 是文件扩展名（决定 `<input accept>` 与文件名分派）。
 */
export const LARK_DOC_IMPORT_FORMATS = Object.freeze([
  Object.freeze({ value: 'html', extensions: Object.freeze(['html', 'htm']), label: 'HTML' }),
  Object.freeze({ value: 'json', extensions: Object.freeze(['json']), label: 'JSON' }),
  Object.freeze({ value: 'md', extensions: Object.freeze(['md', 'markdown']), label: 'Markdown' }),
  Object.freeze({ value: 'docx', extensions: Object.freeze(['docx']), label: 'Word（.docx）' }),
])

/** 导出格式目录：`label` 进下拉菜单文案，`hint` 进 `title` 气泡（降级说明）。 */
export const LARK_DOC_EXPORT_FORMATS = Object.freeze([
  Object.freeze({ value: 'html', label: 'HTML', hint: '完整 HTML，媒体按 config.media.htmlMode 输出' }),
  Object.freeze({ value: 'json', label: 'JSON（完整正文）', hint: '保留全部块属性，可无损再导入' }),
  Object.freeze({ value: 'md', label: 'Markdown（简化）', hint: '字体、分栏、公式与图片裁剪会降级' }),
  Object.freeze({ value: 'txt', label: '纯文本', hint: '只保留文字' }),
  Object.freeze({ value: 'docx', label: 'Word（简化）', hint: '纯文本段落，不保留复杂块与媒体布局' }),
  Object.freeze({ value: 'print', label: '打印 / PDF', hint: '调用浏览器打印，可选「另存为 PDF」' }),
])

/** 媒体在 HTML 产物里的呈现方式（`config.media.htmlMode`）。 */
export const LARK_DOC_MEDIA_HTML_MODES = Object.freeze(['inline', 'link'])

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
    // 内嵌网页 15 项：关闭后斜杠菜单不再出现「内嵌网页」组。
    embed: true,
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
  /**
   * 自动保存（本地草稿 / 宿主适配器）。默认开启：只要 persistence 有落点
   * （localStorage / IndexedDB / 宿主 providers.persistence），正文改动后
   * `delay` 毫秒自动落一次。
   *
   * 关掉有两条独立的路：
   * - `features.persistence: false` → 整套持久化下线（不读草稿、不显示保存状态）；
   * - `autosave.enabled: false` → 只关「自动」这一层，保存按钮 / save() 仍可用。
   */
  autosave: {
    enabled: true,
    // 防抖毫秒：连续输入时只在最后一次改动后落盘。
    delay: 650,
  },
  /**
   * 导入 / 导出：入口与格式各自独立配置。
   * `features.importExport` 仍是总闸，这里是它下层的分区开关与格式白名单。
   */
  importExport: {
    // 两个入口分别显隐：只留导出（`importEnabled:false`）或只留导入都可以。
    importEnabled: true,
    exportEnabled: true,
    // 按钮文案，可整体改写（多语言 / 业务口径）。
    importLabel: '导入',
    exportLabel: '导出',
    // 允许的导入格式（LARK_DOC_IMPORT_FORMATS 的 value）。
    importFormats: ['html', 'json', 'md', 'docx'],
    // 导出下拉里出现的格式（LARK_DOC_EXPORT_FORMATS 的 value），顺序即菜单顺序。
    exportFormats: ['html', 'json', 'md', 'txt', 'docx', 'print'],
  },
  /**
   * 媒体（图片 / 附件 / 视频）在 **HTML 产物**（getHTML、导出 HTML、saveHtml）
   * 里的呈现方式：
   * - `inline`：直出媒体本身（`<figure><img>` 等），正文可直接渲染；
   * - `link`：只保留媒体地址（`<a href>` 链接），正文里不出现媒体本体。
   * JSON 产物不受影响（始终是结构化块，可无损再导入）。
   */
  media: {
    htmlMode: 'inline',
    // link 档的链接文案；空串 = 用默认文案（图片地址 / 附件名 / 视频地址）。
    linkText: '',
    // link 档是否在新窗口打开。
    newTab: true,
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
    autosave: mergeSection(DEFAULT_LARK_DOC_CONFIG.autosave, source.autosave),
    importExport: mergeSection(DEFAULT_LARK_DOC_CONFIG.importExport, source.importExport),
    media: mergeSection(DEFAULT_LARK_DOC_CONFIG.media, source.media),
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

  /* —— 自动保存 —— */
  config.autosave.enabled = config.autosave.enabled !== false
  // 0 也允许（立即落盘），但非数字一律回落默认值，避免 setTimeout(undefined)。
  {
    const delay = Number(config.autosave.delay)
    config.autosave.delay = Number.isFinite(delay) && delay >= 0 ? delay : DEFAULT_LARK_DOC_CONFIG.autosave.delay
  }

  /* —— 导入 / 导出 —— */
  config.importExport.importEnabled = config.importExport.importEnabled !== false
  config.importExport.exportEnabled = config.importExport.exportEnabled !== false
  config.importExport.importLabel = normalizeLabel(config.importExport.importLabel, DEFAULT_LARK_DOC_CONFIG.importExport.importLabel)
  config.importExport.exportLabel = normalizeLabel(config.importExport.exportLabel, DEFAULT_LARK_DOC_CONFIG.importExport.exportLabel)
  config.importExport.importFormats = normalizeFormatList(config.importExport.importFormats, LARK_DOC_IMPORT_FORMATS, DEFAULT_LARK_DOC_CONFIG.importExport.importFormats)
  config.importExport.exportFormats = normalizeFormatList(config.importExport.exportFormats, LARK_DOC_EXPORT_FORMATS, DEFAULT_LARK_DOC_CONFIG.importExport.exportFormats)

  /* —— 媒体 HTML 呈现 —— */
  config.media.htmlMode = LARK_DOC_MEDIA_HTML_MODES.includes(config.media.htmlMode)
    ? config.media.htmlMode
    : DEFAULT_LARK_DOC_CONFIG.media.htmlMode
  config.media.linkText = typeof config.media.linkText === 'string' ? config.media.linkText : ''
  config.media.newTab = config.media.newTab !== false

  return config
}

/** 按钮文案归一：非空字符串才采用，否则回落默认（避免 label 变成 "[object Object]"）。 */
function normalizeLabel(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

/**
 * 格式白名单归一：只保留目录里真实存在的 value，并按目录顺序输出（菜单顺序稳定、
 * 不因宿主数组顺序抖动）；传入非数组或过滤后为空时回落默认清单 —— 一个格式也
 * 不允许的入口应该用 `importEnabled/exportEnabled:false` 关掉，而不是清空数组。
 */
function normalizeFormatList(value, catalog, fallback) {
  if (!Array.isArray(value)) return fallback.slice()
  const allowed = catalog.map((item) => item.value)
  const picked = value.filter((item) => allowed.includes(item))
  const unique = allowed.filter((item) => picked.includes(item))
  return unique.length ? unique : fallback.slice()
}

export function isConfigEnabled(config, feature) {
  return !config || !config.features || config.features[feature] !== false
}

/* ------------------------------------------------------------------
   三段配置的解析辅助：UI（Vue 壳 / DOM 渲染器）与控制器都从这里取，
   保证「同一份 config → 同一套入口与文案」，不在两处各写一遍默认值。
   ------------------------------------------------------------------ */

function section(config, name) {
  return (config && config[name]) || DEFAULT_LARK_DOC_CONFIG[name]
}

/** 导入入口是否可用（总闸 + 分区开关）。 */
export function isImportEnabled(config) {
  return isConfigEnabled(config, 'importExport') && section(config, 'importExport').importEnabled !== false
}

/** 导出入口是否可用（总闸 + 分区开关）。 */
export function isExportEnabled(config) {
  return isConfigEnabled(config, 'importExport') && section(config, 'importExport').exportEnabled !== false
}

/** `<input type="file">` 的 accept 串：由 importFormats 的扩展名拼出来。 */
export function resolveImportAccept(config) {
  const formats = section(config, 'importExport').importFormats || []
  const extensions = []
  LARK_DOC_IMPORT_FORMATS.forEach((item) => {
    if (formats.includes(item.value)) extensions.push(...item.extensions)
  })
  return extensions.map((ext) => `.${ext}`).join(',')
}

/** 文件扩展名 → 内部格式键；不在白名单里返回 null（调用方据此报「不支持」）。 */
export function resolveImportFormatId(config, extension) {
  const ext = String(extension || '').trim().toLowerCase()
  const formats = section(config, 'importExport').importFormats || []
  const hit = LARK_DOC_IMPORT_FORMATS.find((item) => item.extensions.includes(ext))
  return hit && formats.includes(hit.value) ? hit.value : null
}

/**
 * 导出下拉的选项（含占位项）。第一项 `value:''` 是触发器的占位文案，
 * 命名为 `exportLabel`，改文案不用动菜单结构。
 */
export function resolveExportOptions(config) {
  const settings = section(config, 'importExport')
  const formats = settings.exportFormats || []
  const options = [{ value: '', label: settings.exportLabel || DEFAULT_LARK_DOC_CONFIG.importExport.exportLabel }]
  LARK_DOC_EXPORT_FORMATS.forEach((item) => {
    if (formats.includes(item.value)) options.push({ value: item.value, label: item.label, hint: item.hint })
  })
  return options
}

/** 自动保存是否生效（持久化总闸 + autosave 开关）。 */
export function isAutoSaveEnabled(config) {
  return isConfigEnabled(config, 'persistence') && section(config, 'autosave').enabled !== false
}

/** 自动保存防抖毫秒。 */
export function resolveAutoSaveDelay(config) {
  return Number(section(config, 'autosave').delay) || 0
}

/** 媒体 HTML 呈现选项（EditorController / 序列化层用）。 */
export function resolveMediaOptions(config) {
  const media = section(config, 'media')
  return {
    mode: LARK_DOC_MEDIA_HTML_MODES.includes(media.htmlMode) ? media.htmlMode : DEFAULT_LARK_DOC_CONFIG.media.htmlMode,
    linkText: typeof media.linkText === 'string' ? media.linkText : '',
    newTab: media.newTab !== false,
  }
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
