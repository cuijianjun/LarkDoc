/**
 * 企业授权类块（P5-06）—— 9 个 `cardEmbed` 的 `providerId` 变体，**渲染成同一种置灰卡**。
 *
 * 依据：09 §5.6 P5-06「`skip` 档的 9 项全部落成 `cardEmbed` 的 `providerId` 变体，
 * 不另造 `external_block`」+ §4 三档表注「『不做』的 17 项里有 9 项依赖组织体系或
 * 企业授权」。逐项取自 **17 §17.4.2 的块配置档**（每项都有独立配置档与必填字段，
 * 说明它们在飞书那边确实是块，而不是行内物件）。
 *
 * 🔴 为什么不另造 `external_block`：09 §3.5 的卡片契约已经装得下「providerId +
 * resourceId + payload + actions」，再造一个节点等于让导出/粘贴/协同/迁移各写一遍
 * 分支（同 §3.4 反对「一个节点带 kind」的理由反过来用）。
 *
 * 🔴 为什么是「置灰只读」而不是「能配置」：这 9 项**都要连外部服务**（Jira / Meego /
 * 知识库 / 订阅号 / 会议 / OKR），V1 不接真实服务。09 §245 定的口径是「菜单项也出现，
 * 但 `disabled: true` + `data-tooltip="需要企业版接入"`」——「没做」要**可见**，
 * 不能变成「点了没反应」。
 *
 * 与本仓库其它几张卡的分界：
 *   - `sub_page_list`（P3-08，`core/embed/reference.js`）与 `folder_manager`（本表）
 *     是**同一个飞书块的两种形态**：前者是可绑定的引用卡（三态机、能改 resourceId），
 *     后者是宿主同步下来的只读子页面列表（V1 不绑定）。老文档里两种 id 都可能出现，
 *     所以两张表并存、互不覆盖 —— 判定顺序是「先 reference 后 enterprise」。
 *   - `mention_doc` / `mention_chat`（云文档 / 群名片）**不在这里**：它们是行内
 *     mention，P4-01 已实现为 `tier: 'skip'` 的 chip，不是块。09 §651 括号里那句
 *     「云文档 / 群名片」说的是 mention 那条线，别按它往这张表里加两个行内 id。
 *
 * 🔴 `agenda` 有个特例要说清：02 §29 已经给出**可插入、可编辑**的完整规格（首次插入
 * 落容器 + 2 个议程项，默认 20 / 10 分钟，时长按 1 分钟步进，`Cmd+Z` 原子撤销）。
 * 但 09 §4 的必做 32 里「团队协作 5」= 人员 / 任务清单 / 投票 / 日期提醒 / 日程，
 * **不含**会议议程 ⇒ 它仍属「不做 17」。所以这里保持 `tier: 'skip'`；将来升档只需
 * 把 tier 改成 `required` 并接 `AgendaAPI`，卡面与菜单数据一行都不用动。
 */

import { isExternalKind } from './external-block'
import { externalOperationState } from './provider-registry'

/** 09 §245 的原文措辞。菜单 tooltip 与卡面提示**共用这一条**，别写两版。 */
export const ENTERPRISE_TOOLTIP = '需要企业版接入'

/**
 * 9 项真值表。字段说明：
 *   - `id`：卡片 `providerId`，**逐字**取 17 §17.4.2 的配置档名；
 *   - `menuId`：命令表 id（camelCase，P0-05 契约）。`null` = 飞书斜杠菜单 72 项里
 *     没有入口（`okr` 只在 17 有配置档），所以它只参与渲染、不进命令表；
 *   - `category`：03 §3.4 的分类名（菜单分组用，与真值一致）；
 *   - `fields`：17 里该配置档的**必填**字段，只为可追溯，本文件不校验它们。
 */
export const ENTERPRISE_PROVIDERS = Object.freeze([
  { id: 'folder_manager', label: '子页面列表', menuId: 'folderManager', category: '文档管理', fields: 'wiki_token 或 parent_node_id', glyph: '▤', tone: 'indigo' },
  { id: 'wiki_recent_update', label: '知识库动态', menuId: 'wikiRecent', category: '文档管理', fields: 'wiki_token', glyph: '▥', tone: 'indigo' },
  { id: 'jira_issue', label: 'Jira 问题', menuId: 'jiraIssue', category: '项目管理', fields: 'issue_key 或 url', glyph: '▦', tone: 'blue' },
  { id: 'jira_filter', label: 'Jira 过滤器', menuId: 'jiraFilter', category: '项目管理', fields: 'url', glyph: '▧', tone: 'blue' },
  { id: 'meego_view', label: '视图表格', menuId: 'meegoView', category: '项目管理', fields: 'space_id + view_id', glyph: '▨', tone: 'blue' },
  { id: 'meego_detail', label: '详情卡片', menuId: 'meegoDetail', category: '项目管理', fields: 'work_item_id', glyph: '▩', tone: 'blue' },
  { id: 'agenda', label: '会议议程', menuId: 'agenda', category: '团队协作', fields: 'agenda_id 或 children[]', glyph: '☰', tone: 'teal' },
  { id: 'subscription_article', label: '订阅号文章', menuId: 'subscribeArticle', category: '进阶', fields: 'document_id + title', glyph: '❝', tone: 'orange' },
  { id: 'okr', label: 'OKR', menuId: null, category: '项目管理', fields: 'okr_id', glyph: '◎', tone: 'green' },
])

const BY_PROVIDER = new Map(ENTERPRISE_PROVIDERS.map((item) => [item.id, item]))
const BY_MENU = new Map(
  ENTERPRISE_PROVIDERS.filter((item) => item.menuId).map((item) => [item.menuId, item]),
)

/** 卡片 providerId 是不是这 9 项之一。 */
export function isEnterpriseProvider(providerId) {
  return BY_PROVIDER.has(providerId)
}

/** providerId → 真值项；不是返回 null。 */
export function enterpriseItemOf(providerId) {
  return BY_PROVIDER.get(providerId) || null
}

/** 命令 id → 真值项；不是返回 null（`commandMenuMixin` 据此挑提示文案与 providerId）。 */
export function enterpriseItemByMenu(menuId) {
  return BY_MENU.get(menuId) || null
}

/** providerId → 中文名；不是这 9 项返回空串（不抛错，同 `referenceKindLabel`）。 */
export function enterpriseLabelOf(providerId) {
  const item = BY_PROVIDER.get(providerId)
  return item ? item.label : ''
}

/** 进命令表的那 8 项（`okr` 无菜单入口，被排除）。顺序 = 本文件的表序，别改。 */
export const ENTERPRISE_MENU_ITEMS = Object.freeze(
  ENTERPRISE_PROVIDERS.filter((item) => item.menuId),
)

/**
 * 真值项 → `CommandDef`（09 §3.2 契约）。
 *
 * 派生而不是每组手写：4 个组文件（pim / docmanage / collab / advanced）各取自己那几项，
 * `label` / `category` / `glyph` / `tone` 全来自同一张表 —— 手写就等于把 9 个中文名
 * 抄四遍，改一个漏三个。
 *
 * `tier: 'skip'` 是**唯一**的置灰依据（09 §245）：菜单照常列出，点了给 tooltip，
 * 不执行命令。`plus: false`：真飞书「+」菜单里没有这几项（它们在斜杠菜单的分类里）。
 */
export function toEnterpriseCommand(item, group) {
  return {
    id: item.menuId,
    label: item.label,
    category: item.category,
    plus: false,
    glyph: item.glyph,
    tone: item.tone,
    keywords: `${item.label} ${item.id} ${ENTERPRISE_TOOLTIP}`,
    group,
    tier: 'skip',
  }
}

/**
 * 单项的置灰原因（17 §17.5）：能对上 externalBlock 目录的菜单项（`jira_issue` / `agenda`）
 * 直接用 registry 的闸门文案 —— 「Jira 问题需接入Jira后才能新建」/「只读快照…」，
 * 与 `blockApi` 抛的错**同一句话**；对不上目录的（`folder_manager` 这类没有本地目录项的）
 * 返回空串，由调用方回落到 `ENTERPRISE_TOOLTIP`。
 */
export function enterpriseSkipReason(menuId) {
  const item = BY_MENU.get(menuId)
  if (!item || !isExternalKind(item.id)) return ''
  const state = externalOperationState(item.id, 'create')
  return state.allowed ? '' : state.reason
}

/**
 * 给 `tier: 'skip'` 的项补运行时 `reason`（菜单每次打开重算一次）。
 *
 * 🔴 为什么不写进 `toEnterpriseCommand()`：那一层在**模块初始化**时就把表建好了，而
 * provider 是运行时注册的 —— 把状态冻在 import 那一刻，接好服务后菜单仍会一直说「未接入」。
 * 已经在项上写了 `reason` 的不覆盖（宿主可以自己给文案）。
 */
export function withSkipReasons(items) {
  if (!Array.isArray(items)) return []
  return items.map((item) => {
    if (!item || item.tier !== 'skip' || item.reason) return item
    const reason = enterpriseSkipReason(item.id)
    return reason ? { ...item, reason } : item
  })
}

/** 单项版：`collab` / `advanced` 这种「组里只有一条企业项」的用法。 */
export function enterpriseCommandOf(menuId, group) {
  const item = BY_MENU.get(menuId)
  return item ? toEnterpriseCommand(item, group) : null
}
