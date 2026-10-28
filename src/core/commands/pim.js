/**
 * 项目管理组命令：4 项（P5-06）—— Jira 问题 / Jira 过滤器 / 视图表格 / 详情卡片。
 *
 * 真值（03 §3.4 ⑨ 项目管理 4 项，y 1996 / 2028 / 2060 / 2092）：
 * `slash jira issue` / `slash jira filter` / `Meego View` / `Meego Detail`。
 *
 * 🔴 全部 `tier: 'skip'`：这 4 项都要连外部服务（Jira / Meego），V1 不接。
 * 09 §245 的口径是「菜单里照常列出、但不可执行、给 tooltip『需要企业版接入』」——
 * 「没做」必须是**可见的取舍**，不能变成「点了没反应」。
 *
 * 数据不在这里：四条文案/图标/分类统一取自 `core/embed/enterprise.js` 的 9 项真值表
 * （派生而非手写，否则「视图表格」与「详情卡片」两个 Meego 中文名会出现两份）。
 */
import { ENTERPRISE_MENU_ITEMS, toEnterpriseCommand } from '../embed/enterprise'

export const pimCommands = ENTERPRISE_MENU_ITEMS
  .filter((item) => item.category === '项目管理')
  .map((item) => toEnterpriseCommand(item, 'pim'))
