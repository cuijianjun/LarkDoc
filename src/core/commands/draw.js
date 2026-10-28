/**
 * 绘图层命令：3 项（P5-05）—— 思维导图 / 流程图 / UML 图。
 *
 * 真值来自 03 §3.4 ⑥（斜杠菜单「绘图」组实测 4 项，y 序 1388 / 1420 / 1452 / 1484）：
 *
 *   | y    | label    | data-name                    | 本文件 id   |
 *   |------|----------|------------------------------|-------------|
 *   | 1388 | 画板     | `diagram whiteboard normal`  | **不在本组** |
 *   | 1420 | 思维导图 | `diagram whiteboard mindmap` | `mindMap`   |
 *   | 1452 | 流程图   | `diagram whiteboard flowchart` | `flowChart` |
 *   | 1484 | UML图    | `diagram whiteboard uml`     | `umlDiagram` |
 *
 * 🔴 第 1 项「画板」是**显式缺口**，不是漏了：它在 P3-07 用 `webEmbed` + 全桥
 * 真交付（iframe 型内容），而本组这 3 项是 `cardEmbed` 空态卡（无引擎，见
 * `core/embed/board-diagram.js` 文件头）。把画板塞进同一组会让「点一下插什么」骗人，
 * 所以宁可在菜单里少一项，也不混两种交付形态。core 命令表暂无 `whiteboard`。
 *
 * 组标题 `绘图`（y 1356）由 `CommandMenu.categories` 按 `category` 首次出现顺序
 * 自动生成，所以这 3 条在 `COMMAND_ORDER` 里必须**连续成段**，且紧跟在
 * `bitableRefer`（多维表格组）之后、`inlineMath`（智能组）之前 —— 真值组序是
 * 数据 1100 → 多维表格 1164 → 绘图 1356 → 团队协作 1516。
 *
 * `tier: 'skeleton'`：能插入、能绑定、能打开，但没有编辑引擎（09 §5.6 的
 * 「骨架档」口径）。别因为「验收通过」就改成 `required`，那等于声称绘图可用。
 */
import { BOARD_DIAGRAM_ITEMS } from '../embed/board-diagram'

/** 检索词尾巴：三项共用的中文/拼音/英文别名，省得每条抄一遍。 */
const TAIL = ' diagram board whiteboard 绘图 画板'

/** 每条的专属检索词（`label` 与 `id` 已由 `filterCommands` 一起匹配，这里只补同义词）。 */
const ALIAS = {
  mindMap: 'mindmap mind map siweidaotu daotu 导图 脑图 思维导图',
  flowChart: 'flowchart flow chart liuchengtu 流程 流程图',
  umlDiagram: 'uml umlclass 类图 用例图 时序图 UML图',
}

export const drawCommands = BOARD_DIAGRAM_ITEMS.map((item, index) => ({
  id: item.id,
  label: item.label,
  category: '绘图',
  // 真飞书「+」菜单里绘图 4 项都在（03 §3.4 四 的 55 项清单）；
  // 但只有第一项带排序位，其余靠数组序 —— `plusCategory` 只影响分组标题。
  plusCategory: '常用',
  // 图标是几何符号占位：飞书这三个图标是彩色位图，取不到色值也没有矢量源，
  // 与之最接近的既有口径是 `diagram`（图表）的 ▥ —— 这里用同一族字形，别引 emoji。
  glyph: ['◈', '⇄', '⬡'][index],
  tone: 'blue',
  keywords: `${ALIAS[item.id]}${TAIL}`,
  group: 'draw',
  tier: 'skeleton',
}))
