/**
 * docModes —— 文档三态模式（编辑 / 修订 / 阅读）的纯数据与键位判定（P4-06，07 §1、§1.1、§12.1）。
 *
 * 为什么单开一个纯 JS 文件，而不是把三行文案写进 TopBar.vue：
 *   1. 下拉三项的**主标题 + 副标题 + 快捷键**是能被规格断言的数据，单测直接 import 就能校验，
 *      不必去解析 .vue 模板（vitest 在本仓库禁止 import .vue，见 test/ 的 forbidVueImports 插件）；
 *   2. 顶栏下拉、工具栏「视图与工具」分组、快捷键三条入口共用同一份表 —— 文案不会分叉。
 *      历史上标题级别下拉就因为两处各写一份，分出 152 / 32 两套宽度和三套蓝字。
 *
 * 🔴 三态是**独立状态**，不是「只读」的一个子开关（07 §1「复刻要点」）：
 *    修订态要能继续编辑正文，只是产出物从「正文变更」变成「修订建议」，需要他人接受/拒绝。
 *    所以 `suggest` **不能**进 effectiveReadonly 的只读集合，否则连光标都放不进去。
 */

/**
 * 三项的顺序即下拉里的渲染顺序：编辑 → 修订 → 阅读（07 §1.1 真机切换的三项文案原样）。
 * `keys` 存的是需求文档里的**字面写法**（07 §12.1），不是渲染格式 ——
 * 文档里 macOS 记 `⌘`、Windows 记 `Ctrl`，混着写是因为两侧各测了一次；
 * 实际判定两者**都认**（见 modeFromShortcut），展示时再按平台归一。
 */
export const DOC_MODES = [
  { id: 'edit', label: '编辑', hint: '可编辑文档', keys: ['E', 'Ctrl + ⌥ + E'] },
  { id: 'suggest', label: '修订', hint: '提出修改建议', keys: ['⌘ + ⌥ + X'] },
  { id: 'read', label: '阅读', hint: '仅查看或评论文档', keys: ['Ctrl + ⌥ + V'] },
]

export const DOC_MODE_IDS = ['edit', 'suggest', 'read']

/**
 * 顶栏按钮图标：阅读复用工具栏已有的 `reading`（书本），另两个是 P4-06 新画。
 * 只借来「语义最贴」的线性符号 —— 03 只采集了图标位尺寸（16×22 位置框、字形 16），
 * 没采集字形路径，所以这里不声称与飞书逐像素一致。
 */
export const MODE_ICONS = { edit: 'mode-edit', suggest: 'mode-comment', read: 'reading' }

/**
 * 下拉最小宽度。旧实现是手搓的 180×160 定宽弹层（每项 170×50、副标题居中两行）；
 * 现在改用共享下拉原语（`src/ui/select.js`，与工具栏「字号」同一套交互与弹层 UI），
 * 高度由「三项 × 两行」自然撑开，宽度只保一个下限：最长一句「仅查看或评论文档」
 * 配上 14px/12px 两行排版，340 刚好不折行。改这个值要同步看 `topBar.js` 的
 * `menuMinWidth`（它从这里取，不另写一份）。
 */
export const MODE_MENU_MIN_WIDTH = 340

/** 切换成功后的提示文案（07 §1.1「页面出现『已切换为修订模式』提示」）。 */
export const MODE_TOAST = {
  edit: '已切换为编辑模式',
  suggest: '已切换为修订模式',
  read: '已切换为阅读模式',
}

/**
 * 模式是**当前用户维度**的状态（07 §1.1「不会把其他协作者切换成修订态」），
 * 所以存储键不分文档 id，整站一个。刷新 / 重新打开后保持。
 */
export const MODE_STORAGE_KEY = 'lark-doc:mode'

/** 提示停留时长：沿用 07 §10 ② 实测的 toast 存活时长（3302ms 取整）。 */
export const MODE_TOAST_MS = 3300

/**
 * `modes` 配置段的缺省值。与 `larkDocConfig.DEFAULT_LARK_DOC_CONFIG.modes` 同值 ——
 * 一份给「宿主直接传 config 给 Vue 组件」的旁路用（那条路不过 createLarkDocConfig），
 * 另一份给 `LarkDoc` 命令式入口。两边都归一化，幂等。
 */
export const DEFAULT_MODES_CONFIG = Object.freeze({
  default: 'edit',
  allow: Object.freeze(['edit', 'suggest', 'read']),
  persist: true,
  labels: Object.freeze({}),
  shortcuts: true,
})

/**
 * 归一化 `modes` 配置。**所有非法输入都静默回落，不抛错** —— 一份写错的配置
 * 不应该让整个编辑器挂不起来。
 *
 * 四条规则（顺序有意义）：
 *  1. `allow` 按 `DOC_MODE_IDS` 的规格顺序收（宿主数组顺序不参与），去非法 id、去重；
 *  2. `allow` 过滤后为空 → 回落「三项都留」。想关掉整个切换应该写 `allow: ['edit']`
 *     （变成静态文字），给空数组更可能是一次笔误，不该把功能整个吞掉；
 *  3. `default` 不在 `allow` 里 → 回落 `allow[0]`（保证初始态一定是可选项之一）；
 *  4. `labels` 只认三项已知 id 的**非空字符串**，其余键与空值丢弃。
 *
 * @param {object} [input] 宿主的 `config.modes`
 * @returns {{default: string, allow: string[], persist: boolean, labels: object, shortcuts: boolean}}
 */
export function normalizeModesConfig(input) {
  const source = input && typeof input === 'object' ? input : {}
  const allowInput = Array.isArray(source.allow) ? source.allow : DEFAULT_MODES_CONFIG.allow
  const allow = DOC_MODE_IDS.filter((id) => allowInput.indexOf(id) >= 0)
  const finalAllow = allow.length ? allow : DOC_MODE_IDS.slice()

  const labels = {}
  const rawLabels = source.labels && typeof source.labels === 'object' ? source.labels : {}
  DOC_MODE_IDS.forEach((id) => {
    const value = rawLabels[id]
    if (typeof value === 'string' && value.trim()) labels[id] = value.trim()
  })

  const wanted = isDocMode(source.default) ? source.default : DEFAULT_MODES_CONFIG.default
  const fallback = finalAllow.indexOf(wanted) >= 0 ? wanted : finalAllow[0]

  return {
    default: fallback,
    allow: finalAllow,
    persist: source.persist !== false,
    labels,
    shortcuts: source.shortcuts !== false,
  }
}

/**
 * 下拉/工具栏实际渲染的选项：`allow` 过滤 + `labels` 覆盖文案。
 * 顺序恒为「编辑 → 修订 → 阅读」，与 `DOC_MODES` 一致。
 */
export function resolveModeOptions(config) {
  const cfg = config && typeof config === 'object' ? config : DEFAULT_MODES_CONFIG
  const allow = Array.isArray(cfg.allow) && cfg.allow.length ? cfg.allow : DOC_MODE_IDS
  const labels = cfg.labels && typeof cfg.labels === 'object' ? cfg.labels : {}
  return DOC_MODES.filter((item) => allow.indexOf(item.id) >= 0).map((item) => ({
    ...item,
    label: labels[item.id] || item.label,
  }))
}

export function isDocMode(id) {
  return DOC_MODE_IDS.indexOf(id) >= 0
}

/** 取某项元数据；非法 id 一律回落「编辑」，模板里不用再写兜底。 */
export function modeMeta(id) {
  const found = DOC_MODES.filter((item) => item.id === id)[0]
  return found || DOC_MODES[0]
}

export function modeLabel(id) {
  return modeMeta(id).label
}

export function modeToastText(id) {
  return MODE_TOAST[id] || MODE_TOAST.edit
}

/**
 * 焦点是否在「可输入区域」——决定裸 `E` 能不能被当成模式快捷键。
 * 不用 `instanceof HTMLElement` 之类：单测里传的是假对象，只看 closest 在不在。
 */
export function isEditableTarget(target) {
  if (!target || typeof target.closest !== 'function') return false
  return Boolean(target.closest('[contenteditable="true"], [contenteditable="plaintext-only"], input, textarea, [role="textbox"]'))
}

/**
 * 从键盘事件解析出目标模式 id；无匹配返回 `''`（调用方据此决定要不要 preventDefault）。
 *
 * 键位（07 §12.1）：编辑 `E` / `Ctrl(⌘)+⌥+E`；修订 `⌘(Ctrl)+⌥+X`；阅读 `Ctrl(⌘)+⌥+V`。
 *   - 带修饰键的三组必须**排除 shift**：`⌘+⌥+Shift+X` 在气泡条里不是模式键，误判会打断用户的组合键；
 *   - 裸 `E` 只在焦点不在正文/输入框时接管 —— 否则正文里每敲一个 e 都会切模式。
 *     `inEditable` 由调用方（applyModeShortcut）用真实 DOM 目标算好传进来。
 */
export function modeFromShortcut(event, inEditable) {
  if (!event) return ''
  const key = String(event.key || '').toLowerCase()
  if (!key) return ''
  const meta = Boolean(event.metaKey || event.ctrlKey)
  const alt = Boolean(event.altKey)
  if (meta && alt && !event.shiftKey) {
    if (key === 'e') return 'edit'
    if (key === 'x') return 'suggest'
    if (key === 'v') return 'read'
    return ''
  }
  if (!meta && !alt && !event.shiftKey && key === 'e' && !inEditable) return 'edit'
  return ''
}
