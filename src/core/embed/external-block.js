/**
 * 外部服务块目录（`externalBlock` 判定层）—— 17 §17.5「官方 BlockType 全量登记」里
 * **本地没有实现**、且必须接入外部应用或宿主服务才能真用的那批块。
 *
 * 为什么不是一个块一个节点：§17.5 这张表里 tier = C / P3 的十余类（chat_card /
 * mindnote / task / okr* / jira_issue / agenda* / board / whiteboard / view /
 * diagram / synced…）CRUD 一栏清一色是 `provider` 或 `unsupported` —— 它们的
 * **正文形态由外部服务决定**，本地无论怎么造节点都只能是一张「钥匙卡」。给每类单独
 * 造一个 ProseMirror 节点，等于往 schema 里塞十余个同样结构、同样降级行为的空壳，
 * 保真通道还要再写十余遍。
 *
 * 因此按 `isv` 已经验证过的做法（一个节点背多形态、`kind` 分叉）：
 *   - 一个 `externalBlock` 节点 + `kind` 目录，22 个官方 type 归进 11 个块族；
 *   - 每个 kind 都带 §17.5 原文登记的 CRUD 档（provider / unsupported / operation…），
 *     能力查询 `externalBlockCapability()` 是这些档的**唯一出口**，UI 与宿主都从这里
 *     取「能不能做、为什么不能」，不许自己判字符串；
 *   - 未接入时降级为 `unavailable` 卡片（§17.5 表下说明：`fallback=readonly/disabled`，
 *     并在 UI 留下可解释的 disabled 状态）；宿主接入 provider 后把 status 推到
 *     `ready`，卡片文案随之变化 —— 节点与保真通道不变。
 *
 * 保真口径与 `unknownBlock` 完全一致（P1-03）：原始块 JSON 逐字节存 `payload`，
 * 导出侧 `restoreUnknownBlocks` 还原。区别只在**显示层**：unknownBlock 是「认不出来」，
 * externalBlock 是「认得出来、但没接服务」。
 *
 * 依赖方向：本文件是判定层，**不 import 任何东西**（`documentOperations` 要用这里的
 * 常量做降级映射，反过来 import 会成环，先例 `core/embed/isv.js`）。
 */

/** 三档接入状态：`unavailable` 未接入 / `readonly` 只读 / `ready` 已接入可用。 */
export const EXTERNAL_STATUS = { UNAVAILABLE: 'unavailable', READONLY: 'readonly', READY: 'ready' }
export const EXTERNAL_STATUSES = [EXTERNAL_STATUS.UNAVAILABLE, EXTERNAL_STATUS.READONLY, EXTERNAL_STATUS.READY]

/** 状态角标文案（卡片右上角，用户肉眼看到的「为什么点不动」）。 */
export const EXTERNAL_STATUS_LABELS = {
  [EXTERNAL_STATUS.UNAVAILABLE]: '未接入',
  [EXTERNAL_STATUS.READONLY]: '只读',
  [EXTERNAL_STATUS.READY]: '已接入',
}

/** payload 上限：与 `UNKNOWN_PAYLOAD_MAX` 同档（原始块 JSON 可能替代整个子树）。 */
export const EXTERNAL_PAYLOAD_MAX = 1000000
export const EXTERNAL_TITLE_MAX = 200
export const EXTERNAL_PROVIDER_MAX = 64
export const EXTERNAL_REASON_MAX = 200
export const EXTERNAL_KIND_MAX = 64

/**
 * 11 个块族 —— 「11 个缺失块类型」就是这个粒度。
 *
 * §17.5 里 OKR 4 类（36~39）、议程 4 类（44~47）、画板/白板 2 类、目录/子页面 4 类、
 * 同步块 2 类在真实文档里是**父子结构**（OKR 下挂目标、目标下挂关键结果），本地
 * 无服务时它们只是同一张钥匙卡的不同 kind，所以按族归并，族内再分 kind。
 */
export const EXTERNAL_BLOCK_FAMILIES = [
  { family: 'chat_card', label: '会话卡片', provider: 'chat', tier: 'C' },
  { family: 'diagram', label: '流程图 / 图表', provider: 'board', tier: 'C' },
  { family: 'mindnote', label: '思维导图', provider: 'mindnote', tier: 'C' },
  { family: 'view', label: '视图', provider: 'bitable', tier: 'C' },
  { family: 'task', label: '任务（带负责人）', provider: 'task', tier: 'C' },
  { family: 'okr', label: 'OKR', provider: 'okr', tier: 'C' },
  { family: 'jira_issue', label: 'Jira 问题', provider: 'jira', tier: 'C' },
  { family: 'agenda', label: '议程', provider: 'agenda', tier: 'P2' },
  { family: 'board', label: '画板 / 白板', provider: 'whiteboard', tier: 'P3' },
  { family: 'folder_manager', label: '目录 / 子页面', provider: 'wiki', tier: 'C' },
  { family: 'synced', label: '同步块', provider: 'sync', tier: 'P1' },
]

/** provider 的人类可读名（能力拒绝时给宿主/UI 用，别再拼一遍中文）。 */
export const EXTERNAL_PROVIDER_LABELS = {
  chat: '飞书会话',
  board: '流程图服务',
  mindnote: '思维导图',
  bitable: '多维表格',
  task: '任务服务',
  okr: 'OKR 服务',
  jira: 'Jira',
  agenda: '议程服务',
  whiteboard: '白板',
  wiki: '知识库',
  sync: '同步块服务',
}

/**
 * kind 全量表（22 类，key 就是官方/实机 block type 名）。
 *
 * `type` = 官方 BlockType 编号；实机扩展（web 行）没有编号，记 `null`。
 * `crud` 逐字照抄 17 §17.5 的 C/R/U/D 四栏 —— 这是「哪些动作必须外接」的唯一出处，
 * 改档位请先改 §17.5 再改这里。
 */
export const EXTERNAL_BLOCK_KINDS = {
  chat_card: { type: 20, family: 'chat_card', label: '会话卡片', moduleId: 'block.chat_card', tier: 'C', provider: 'chat', crud: { C: 'provider', R: 'provider', U: 'provider', D: 'block-delete' } },
  diagram: { type: 21, family: 'diagram', label: '流程图', moduleId: 'block.diagram', tier: 'C', provider: 'board', crud: { C: 'unsupported', R: 'provider', U: 'provider', D: 'block-delete' } },
  mindnote: { type: 29, family: 'mindnote', label: '思维导图', moduleId: 'block.mindnote', tier: 'C', provider: 'mindnote', crud: { C: 'unsupported', R: 'provider', U: 'provider', D: 'block-delete' } },
  view: { type: 33, family: 'view', label: '视图', moduleId: 'block.view', tier: 'C', provider: 'bitable', crud: { C: 'operation', R: 'block.get', U: 'unsupported', D: 'operation' } },
  task: { type: 35, family: 'task', label: '任务', moduleId: 'block.task', tier: 'C', provider: 'task', crud: { C: 'unsupported', R: 'unsupported', U: 'unsupported', D: 'block-delete' } },
  okr: { type: 36, family: 'okr', label: 'OKR', moduleId: 'block.okr', tier: 'C', provider: 'okr', crud: { C: 'provider', R: 'provider', U: 'provider', D: 'block-delete' } },
  okr_objective: { type: 37, family: 'okr', label: 'OKR 目标', moduleId: 'block.okr_objective', tier: 'C', provider: 'okr', crud: { C: 'operation', R: 'provider', U: 'provider', D: 'operation' } },
  okr_key_result: { type: 38, family: 'okr', label: 'OKR 关键结果', moduleId: 'block.okr_key_result', tier: 'C', provider: 'okr', crud: { C: 'operation', R: 'provider', U: 'provider', D: 'operation' } },
  okr_progress: { type: 39, family: 'okr', label: 'OKR 进展', moduleId: 'block.okr_progress', tier: 'C', provider: 'okr', crud: { C: 'operation', R: 'provider', U: 'provider', D: 'provider' } },
  jira_issue: { type: 41, family: 'jira_issue', label: 'Jira 问题', moduleId: 'block.jira_issue', tier: 'C', provider: 'jira', crud: { C: 'provider', R: 'provider', U: 'provider', D: 'block-delete' } },
  wiki_catalog: { type: 42, family: 'folder_manager', label: '知识库目录', moduleId: 'block.wiki_catalog', tier: 'C', provider: 'wiki', crud: { C: 'block.insert', R: 'provider', U: 'provider', D: 'block-delete' } },
  board: { type: 43, family: 'board', label: '画板', moduleId: 'block.board', tier: 'P3', provider: 'whiteboard', crud: { C: 'block.insert', R: 'provider', U: 'bridge', D: 'block-delete' } },
  agenda: { type: 44, family: 'agenda', label: '议程', moduleId: 'block.agenda', tier: 'P2', provider: 'agenda', crud: { C: 'web.slash', R: 'block.get', U: 'provider', D: 'block-delete' } },
  agenda_item: { type: 45, family: 'agenda', label: '议程项', moduleId: 'block.agenda_item', tier: 'P2', provider: 'agenda', crud: { C: 'operation', R: 'block.get', U: 'provider', D: 'operation' } },
  agenda_item_title: { type: 46, family: 'agenda', label: '议程标题', moduleId: 'block.agenda_item_title', tier: 'P2', provider: 'agenda', crud: { C: 'operation', R: 'block.get', U: 'editor', D: 'operation' } },
  agenda_item_content: { type: 47, family: 'agenda', label: '议程内容', moduleId: 'block.agenda_item_content', tier: 'P2', provider: 'agenda', crud: { C: 'operation', R: 'block.get', U: 'editor', D: 'operation' } },
  source_synced: { type: 49, family: 'synced', label: '同步块（源）', moduleId: 'block.source_synced', tier: 'P1', provider: 'sync', crud: { C: 'unsupported', R: 'block.get', U: 'provider', D: 'block-delete' } },
  reference_synced: { type: 50, family: 'synced', label: '同步块（引用）', moduleId: 'block.reference_synced', tier: 'P1', provider: 'sync', crud: { C: 'unsupported', R: 'block.get', U: 'provider', D: 'block-delete' } },
  sub_page_list: { type: 51, family: 'folder_manager', label: '子页面列表', moduleId: 'block.sub_page_list', tier: 'C', provider: 'wiki', crud: { C: 'block.insert', R: 'provider', U: 'provider', D: 'block-delete' } },
  whiteboard: { type: null, family: 'board', label: '白板', moduleId: 'block.whiteboard', tier: 'P3', provider: 'whiteboard', crud: { C: 'block.insert', R: 'bridge', U: 'bridge', D: 'block-delete' } },
  folder_manager: { type: null, family: 'folder_manager', label: '文件夹管理', moduleId: 'block.folder_manager', tier: 'C', provider: 'wiki', crud: { C: 'block.insert', R: 'provider', U: 'provider', D: 'block-delete' } },
  wiki_recent_update: { type: null, family: 'folder_manager', label: '知识库最近更新', moduleId: 'block.wiki_recent_update', tier: 'C', provider: 'wiki', crud: { C: 'block.insert', R: 'provider', U: 'provider', D: 'block-delete' } },
}

/** 认不出 kind 时的兜底元信息（宿主没给 kind / 老数据）：当作「无类型的外部块」。 */
export const EXTERNAL_BLOCK_GENERIC = {
  code: '', type: null, family: 'external', label: '外部内容块', moduleId: 'block.external',
  tier: 'C', provider: null, crud: { C: 'provider', R: 'provider', U: 'provider', D: 'block-delete' },
}

export function isExternalKind(value) {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(EXTERNAL_BLOCK_KINDS, value)
}

/** kind 元信息：认得出的给表项，认不出的给兜底（**不返回 null**，调用点不用判空）。 */
export function externalBlockMeta(kind) {
  if (!isExternalKind(kind)) return EXTERNAL_BLOCK_GENERIC
  return { code: kind, ...EXTERNAL_BLOCK_KINDS[kind] }
}

/** 官方/实机 block type 名 → 是否本目录登记（载入降级用）。 */
export function isExternalBlockType(type) {
  return isExternalKind(type)
}

/* ---------- 能力判定：§17.5 的 CRUD 四栏是唯一出处 ---------- */

/** 本地即可完成的档位：不依赖任何外部服务。 */
const LOCAL_MODES = new Set([
  'block.insert', 'block.get', 'block.update', 'block-delete', 'operation',
  'replace_image', 'table operation', 'transaction', 'id-only',
])
/** 必须接入外部应用或宿主服务才成立的档位：`provider` / `bridge` / 宿主编辑器 / web 斜杠入口。 */
const PROVIDER_MODES = new Set(['provider', 'bridge', 'editor', 'web.slash'])

const ACTION_KEYS = { create: 'C', read: 'R', update: 'U', delete: 'D' }
const ACTION_LABELS = { create: '新建', read: '读取', update: '更新', delete: '删除' }

/** §17.5 原文：不支持的动作必须返回 `ERR_UNSUPPORTED_OPERATION`。 */
export const ERR_UNSUPPORTED_OPERATION = 'ERR_UNSUPPORTED_OPERATION'
/** provider 档但服务未接入：与「不支持」区分开，UI 才能给出「去接入」而不是「做不了」。 */
export const ERR_PROVIDER_REQUIRED = 'ERR_PROVIDER_REQUIRED'

/**
 * 单个动作的能力判定 —— UI 置灰、宿主拦命令、单测断言都走这里。
 *
 * `delete` 是唯一的例外：§17.5 表头说明「Delete 对块统一允许通过
 * `BlockModuleAPI.remove`，即便官方 OpenAPI 没有块专属 delete」，所以一律放行。
 */
export function externalBlockCapability(kind, action) {
  const meta = externalBlockMeta(kind)
  const key = ACTION_KEYS[action]
  const label = ACTION_LABELS[action] || String(action)
  if (!key) return { supported: false, mode: 'unsupported', errorCode: ERR_UNSUPPORTED_OPERATION, reason: `未知动作：${label}` }
  const mode = (meta.crud && meta.crud[key]) || 'unsupported'
  if (action === 'delete') {
    return { supported: true, mode, errorCode: null, reason: '块删除统一走 BlockModuleAPI.remove（17 §17.5）' }
  }
  if (mode === 'unsupported') {
    return { supported: false, mode, errorCode: ERR_UNSUPPORTED_OPERATION, reason: `${meta.label}不支持${label}（17 §17.5 登记为 unsupported）` }
  }
  if (PROVIDER_MODES.has(mode)) {
    const provider = EXTERNAL_PROVIDER_LABELS[meta.provider] || '外部服务'
    return { supported: false, mode, errorCode: ERR_PROVIDER_REQUIRED, reason: `${meta.label}需接入${provider}后才能${label}` }
  }
  if (!LOCAL_MODES.has(mode)) {
    return { supported: false, mode, errorCode: ERR_UNSUPPORTED_OPERATION, reason: `${meta.label}的${label}档位未登记（${mode}）` }
  }
  return { supported: true, mode, errorCode: null, reason: '' }
}

/** 四个动作一次查全（面板渲染「哪些能点」用，避免四处判字符串）。 */
export function externalBlockCapabilities(kind) {
  return ['create', 'read', 'update', 'delete'].reduce((acc, action) => {
    acc[action] = externalBlockCapability(kind, action)
    return acc
  }, {})
}

/** 卡片副文案（未接入时给可解释的原因，接入后给状态）。 */
export function externalBlockReason(kind, status = EXTERNAL_STATUS.UNAVAILABLE) {
  const meta = externalBlockMeta(kind)
  const provider = EXTERNAL_PROVIDER_LABELS[meta.provider] || '外部服务'
  if (status === EXTERNAL_STATUS.READY) return `${meta.label} · 已接入${provider}`
  if (status === EXTERNAL_STATUS.READONLY) return `${meta.label} · 只读快照，接入${provider}后可编辑`
  return `${meta.label} · 未接入${provider}，暂不可编辑（可删除）`
}

/* ---------- 字段清洗：进 attrs 前的唯一口径 ---------- */

/** 去掉控制字符（含 NUL 与 0x7F）后按字符截断 —— 与正文侧 `cleanText` 同口径。 */
const cleanText = (value, max) => {
  if (typeof value !== 'string') return ''
  const text = Array.from(value).filter((char) => {
    const code = char.charCodeAt(0)
    return code > 31 && code !== 127
  }).join('')
  return text.slice(0, max)
}

export function safeExternalKind(value) {
  if (value === '' || value === null || value === undefined) return true // 空 = 兜底「外部内容块」
  return typeof value === 'string' && value.length <= EXTERNAL_KIND_MAX && /^[a-z][a-z0-9_]*$/.test(value)
}

/** 展示文案（title / reason）：拒绝控制字符（与 validateAttrs 的兜底分支同口径）并限长。 */
export function safeExternalTitle(value) {
  if (typeof value !== 'string') return false
  const hasControl = Array.from(value).some((char) => {
    const code = char.charCodeAt(0)
    return code <= 31 || code === 127
  })
  return !hasControl && value.length <= EXTERNAL_TITLE_MAX
}

export function safeExternalProvider(value) {
  return typeof value === 'string' && value.length <= EXTERNAL_PROVIDER_MAX && /^[a-z][a-z0-9_.-]*$/.test(value)
}

export function safeExternalStatus(value) {
  return EXTERNAL_STATUSES.indexOf(value) !== -1
}

export function safeExternalPayload(value) {
  return typeof value === 'string' && value.length <= EXTERNAL_PAYLOAD_MAX && !value.includes('\u0000')
}

/**
 * 从原始块 JSON 里摘卡片要显示的两样东西（标题 / 源地址）。
 *
 * 只做**展示用**的浅摘取，字段丢了不影响保真 —— 真正的原始 JSON 整份在 payload 里。
 * 标题按各服务的常见字段依次试探（Jira 是 `issueKey` + `summary`）。
 */
export function externalBlockPreview(item) {
  const attrs = item && typeof item.attrs === 'object' && item.attrs ? item.attrs : {}
  const pick = (...keys) => {
    for (const key of keys) {
      const value = attrs[key]
      if (typeof value === 'string' && value.trim()) return cleanText(value.trim(), EXTERNAL_TITLE_MAX)
    }
    return ''
  }
  const key = typeof attrs.issueKey === 'string' ? cleanText(attrs.issueKey.trim(), 64) : ''
  const title = pick('title', 'name', 'summary', 'objective', 'content', 'text')
  return {
    title: key && title ? `${key} ${title}` : (key || title),
    sourceUrl: pick('url', 'sourceUrl', 'link', 'href'),
  }
}

/** attrs 归一化（宿主建块 / 载入降级共用）：越界裁剪、非法归零，不抛错。 */
export function normalizeExternalBlock(attrs) {
  const raw = attrs && typeof attrs === 'object' ? attrs : {}
  const kind = safeExternalKind(raw.kind) ? (raw.kind || '') : ''
  const meta = externalBlockMeta(kind)
  return {
    kind,
    payload: safeExternalPayload(raw.payload) ? raw.payload : '',
    title: safeExternalTitle(raw.title) ? cleanText(raw.title, EXTERNAL_TITLE_MAX) : '',
    sourceUrl: typeof raw.sourceUrl === 'string' ? raw.sourceUrl.slice(0, 2000) : '',
    provider: safeExternalProvider(raw.provider) ? raw.provider : (meta.provider || ''),
    status: safeExternalStatus(raw.status) ? raw.status : EXTERNAL_STATUS.UNAVAILABLE,
    reason: safeExternalTitle(raw.reason) ? cleanText(raw.reason, EXTERNAL_REASON_MAX) : '',
  }
}

