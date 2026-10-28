/**
 * 文档管理组命令：2 项（P5-06）—— 子页面列表 / 知识库动态。
 *
 * 真值（03 §3.4 ⑧ 文档管理 2 项，y 1900 / 1932）：`folder manager` / `wiki recent`。
 * 查找替换不占斜杠菜单名额（21.43），**不走命令表**，别往这里加第三条。
 *
 * 🔴 两项都 `tier: 'skip'`：都要连知识库服务（`wiki_token` / `parent_node_id`），V1 不接。
 *
 * 🔴 `folderManager`（本组）与 `sub_page_list`（P3-08 引用卡）是**同一个飞书块的两种
 * 形态**：前者是宿主同步下来的只读子页面列表（V1 不绑定），后者是能在文档里新建、
 * 能改绑定目标的引用卡。两张表并存，判顺序是「先 reference 后 enterprise」，
 * 别因为看到两个中文名都叫「子页面列表」就合并它们。
 */
import { ENTERPRISE_MENU_ITEMS, toEnterpriseCommand } from '../embed/enterprise'

export const docmanageCommands = ENTERPRISE_MENU_ITEMS
  .filter((item) => item.category === '文档管理')
  .map((item) => toEnterpriseCommand(item, 'docmanage'))
