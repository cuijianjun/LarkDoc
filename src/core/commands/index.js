/**
 * 命令表注册表（P0-05）：slash 菜单与「+」菜单共用的数据源，拆分自 components/lark-doc/commands.js。
 *
 * 结构：10 个组文件（basic/common/collab/embed/widget/button/pim/advanced/docmanage/inline）
 * 各导出本组 CommandDef；本文件做三件事——
 *   1. 按 id 汇总（重复 id 直接抛错，防止各组悄悄打架）；
 *   2. 用显式 COMMAND_ORDER 重建数组：菜单渲染按 category 分组、组内按数组序（分段在
 *      `src/ui/commandMenu.js` 的 `categoriesOf`/`sectionList`），所以顺序必须与拆分前
 *      逐项一致，不能按组拼接；
 *   3. filterCommands 按 features 开关、commands.disabled/allow 与关键词过滤（逻辑原样保留）。
 * CommandDef 契约见 requirements/09 §3.2：tier = required | skeleton | skip。
 *
 * 🔴 只出菜单里**真的能用**的项。原先挂在这里的 11 条（视频或文件 `file`、电子表格
 * `sheet`、多维表格 5 条、绘图 3 条、投票 `poll`）在 master 上只有块定义、没有可用的
 * 插入链路 —— 点了只留一个空段落。功能没落地就不该在菜单里占位，已整段摘掉
 * （块类型与 `editor.commands.setSheet/setPoll/setBitable` 仍保留，老文档正文照样能渲染）。
 */
import { basicCommands } from './basic'
import { commonCommands } from './common'
import { embedCommands } from './embed'
import { collabCommands } from './collab'
import { widgetCommands } from './widget'
import { buttonCommands } from './button'
import { pimCommands } from './pim'
import { advancedCommands } from './advanced'
import { docmanageCommands } from './docmanage'
import { inlineCommands } from './inline'
import { EMBED_MENU_ITEMS } from '../embed/presets'

const GROUPS = [
  basicCommands, commonCommands, embedCommands, collabCommands,
  widgetCommands, buttonCommands, pimCommands, advancedCommands, docmanageCommands, inlineCommands,
]

const COMMANDS_BY_ID = new Map()
for (const group of GROUPS) {
  for (const item of group) {
    if (COMMANDS_BY_ID.has(item.id)) throw new Error(`duplicate command id: ${item.id}`)
    COMMANDS_BY_ID.set(item.id, item)
  }
}

// 与拆分前 commands.js 逐项一致（22 条显式定义 + 9 个生成标题 = 31 个 id）。
// P3-07 起末尾挂 15 项内嵌网页（派生自 EMBED_MENU_ITEMS）：它们构成最后一个分类
// 「内嵌网页」，必须是整段连续贴尾——`CommandMenu.categories` 按首次出现顺序出组标题，
// 插在中间会把「内嵌网页」顶到别的分类前面。
//
// P4-01 起在「智能」与「内嵌网页」之间插入 3 条 mention（团队协作分类）：真飞书的组序是
// 基础 → 常用 → 按钮 → 数据 → 团队协作 → 文档管理 → …，我们只复刻到这里，所以「团队协作」
// 插在已复刻分类的最后一段（智能之后）最接近真值；唯一硬约束是**不能越过内嵌网页那 15 条的尾巴**。
// P4-02a 再补一条 `reminder`（日期提醒），紧跟三条 mention —— 同属「团队协作」。
// P4-02b 再补一条 `calendar_event`（日程），接在 `reminder` 之后。
// P4-04 起补 4 条：**3 个按钮**（打开超链接 / 创建副本 / 关注文档更新）+ **目录导航**。
// 3 个按钮插到三条 mention **之前**（按钮组序早于团队协作），目录导航插到 `calendar_event` **之后**。
// P5-06 补齐 skip 档 8 条（文档管理 2 / 项目管理 4 / 会议议程 / 订阅号文章）：真值组序是
// 团队协作 → 文档管理 → 项目管理 → 进阶 → 文档小组件，所以 `catalogue`（目录导航）
// 从原来的「`calendar_event` 之后」**后移到 `subscribeArticle` 之后** —— 中间这几组补齐后，
// 它才落回真值位置。别改回去（改了会把「文档小组件」顶到「进阶」前面）。
const COMMAND_ORDER = [
  'paragraph',
  ...Array.from({ length: 9 }, (_, index) => `heading${index + 1}`),
  'orderedList', 'bulletList', 'taskList', 'code', 'diagram', 'blockquote', 'divider', 'link',
  'callout', 'columns', 'columns2', 'columns3', 'columns4', 'columns5', 'table', 'image',
  'inlineMath', 'blockMath', 'template', 'ai',
  'open_link', 'duplicate_page', 'follow_page',
  'mentionUser', 'mentionChat', 'mentionPage', 'reminder', 'calendar_event', 'agenda',
  'folderManager', 'wikiRecent',
  'jiraIssue', 'jiraFilter', 'meegoView', 'meegoDetail',
  'subscribeArticle',
  'catalogue',
  ...EMBED_MENU_ITEMS.map((item) => item.id),
]

if (COMMANDS_BY_ID.size !== COMMAND_ORDER.length) {
  const missing = [...COMMANDS_BY_ID.keys()].filter((id) => !COMMAND_ORDER.includes(id))
  throw new Error(`command defs missing from COMMAND_ORDER: ${missing.join(', ')}`)
}

export const COMMANDS = COMMAND_ORDER.map((id) => {
  const item = COMMANDS_BY_ID.get(id)
  if (!item) throw new Error(`unknown command id in COMMAND_ORDER: ${id}`)
  return item
})

const COMMAND_FEATURES = {
  table: 'tables', columns: 'columns', columns2: 'columns', columns3: 'columns', columns4: 'columns', columns5: 'columns',
  image: 'images', code: 'codeBlocks', diagram: 'diagram', inlineMath: 'math', blockMath: 'math', template: 'templates',
  callout: 'callouts', ai: 'ai',
  // P4-01：三条 mention 与「`@` 快捷输入」共用一个开关（document.js 的 reportMention
  // 读的也是 `insert`）。不这么写就落进兜底的 blockStyle，出现「关掉插入还能 @」。
  mentionUser: 'insert', mentionChat: 'insert', mentionPage: 'insert',
  // P4-02a：日期提醒同理 —— 它就落在正文里（行内 mark），没有自己的插入开关。
  reminder: 'insert',
  // P4-02b：日程卡片也落在正文里（块级 atom，但插入动作在正文）。不写这条就会落进
  // 兜底的 `blockStyle`，出现「关掉插入还能插日程」。
  calendar_event: 'insert',
  // P4-04：3 个按钮与目录导航同理 —— 都 `isv` 节点落在正文里（尽管按钮要先弹配置面板，
  // 面板只是取参，动作本身仍是插入块）。缺一条就会出现「关掉插入还能插按钮」。
  open_link: 'insert', duplicate_page: 'insert', follow_page: 'insert', catalogue: 'insert',
  // P5-06：8 条 skip 项同样归 `insert`。它们点了不执行（`tier: 'skip'` 由菜单拦截），
  // 但仍属「插入入口」—— 关掉插入能力时这几项也该从菜单里消失，不能留在原地当摆设。
  folderManager: 'insert',
  wikiRecent: 'insert',
  jiraIssue: 'insert',
  jiraFilter: 'insert',
  meegoView: 'insert',
  meegoDetail: 'insert',
  agenda: 'insert',
  subscribeArticle: 'insert',
}

// 15 项内嵌网页共用一个 `embed` 开关（`LARK_DOC_FEATURES` 白名单里同名）：
// 逐条手写 15 个键必然与 `EMBED_MENU_ITEMS` 漂移。
for (const { id } of EMBED_MENU_ITEMS) COMMAND_FEATURES[id] = 'embed'

/**
 * 命令 id → 它受哪个 feature 开关管（没有专属开关的落 `blockStyle`）。
 *
 * 抽出来是因为这段判定原来在 `commandMenuMixin` 的 `executeCommand` 里是一长串三目，
 * 与本文件的 `COMMAND_FEATURES` 是同一条规则的两份拷贝——P3-07 加第 16 个开关时
 * 两份同时要改，漏一处就变成「菜单不肯关 / 关了还能插」。
 */
export function commandFeatureOf(id) {
  return COMMAND_FEATURES[id] || 'blockStyle'
}

export function filterCommands(query, kind = 'slash', config = null) {
  const needle = String(query || '').trim().toLocaleLowerCase()
  // LarkDoc keeps the column count picker behind the single “分栏” entry.
  // The count options are implementation ids for the secondary picker, not
  // independent slash commands.
  const candidates = COMMANDS.filter((item) => {
    if (/^columns[2-5]$/.test(item.id)) return false
    const feature = COMMAND_FEATURES[item.id]
    if (feature && config?.features?.[feature] === false) return false
    if (Array.isArray(config?.commands?.disabled) && config.commands.disabled.includes(item.id)) return false
    if (Array.isArray(config?.commands?.allow) && config.commands.allow.length && !config.commands.allow.includes(item.id)) return false
    return kind !== 'plus' || item.plus !== false
  })
  const filtered = !needle ? candidates : candidates.filter((item) => `${item.label} ${item.id} ${item.keywords}`.toLocaleLowerCase().includes(needle))
  return filtered.map((item) => ({ ...item, category: kind === 'plus' ? (item.plusCategory || item.category) : item.category }))
}
