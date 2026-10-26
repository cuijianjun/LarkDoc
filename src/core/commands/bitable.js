/**
 * 多维表格组命令：5 项（P5-04）。
 *
 * 真值来自 03 §3.4 ⑤ —— 斜杠菜单「多维表格」组实测**恰好 5 项**，y 序如下：
 *
 *   | y    | label  | data-name          | 本文件 id        | 默认视图 |
 *   |------|--------|--------------------|------------------|----------|
 *   | 1196 | 表格   | `bitable GridView` | `bitable`        | grid     |
 *   | 1228 | 看板   | `bitable Kanban`   | `bitableKanban`  | kanban   |
 *   | 1260 | 甘特图 | `bitable Gantt`    | `bitableGantt`   | gantt    |
 *   | 1292 | 画册   | `bitable Gallery`  | `bitableGallery` | gallery  |
 *   | 1324 | 关联   | `bitable refer`    | `bitableRefer`   | relation |
 *
 * 组标题 `多维表格`（y 1164）是**标题**不是可点项，所以这里只出 5 条命令；
 * 组标题由 `CommandMenu.categories` 按 `category` 首次出现顺序自动生成。
 * 因此这 5 条在 `COMMAND_ORDER` 里必须连续成段、且紧跟在 `sheet`（数据组）之后。
 *
 * 两个取舍（都是判定，不是实测，别再反复改）：
 *   1. **5 项各插同一个块、只带不同默认视图**，不是 5 种块类型。视图是数据的投影，
 *      拆成 5 个节点会让「切视图」变成换节点，块 id / 评论锚点 / 协同光标全断
 *      （见 `core/blocks/bitable.js` 文件头）。
 *   2. **只有「表格」进 `+` 菜单**。5 项在 `+` 菜单里是同一种块的 5 个兄弟，并列 5 个
 *      几乎同名的项只会把那一栏撑糊；`+` 菜单承诺的是「点一下就地插一个块」，
 *      插进来之后块内 tab 就能切视图。其余 4 项 `plus: false`。
 */
const TAIL = ' bitable duoweibiaoge 多维表格 视图'

export const bitableCommands = [
  {
    id: 'bitable', label: '表格', category: '多维表格', plusCategory: '常用', glyph: '▦', tone: 'indigo',
    keywords: `grid biaoge 表格${TAIL}`,
    group: 'bitable', tier: 'required',
  },
  {
    id: 'bitableKanban', label: '看板', category: '多维表格', plus: false, glyph: '▤', tone: 'indigo',
    keywords: `kanban 看板${TAIL}`,
    group: 'bitable', tier: 'required',
  },
  {
    id: 'bitableGantt', label: '甘特图', category: '多维表格', plus: false, glyph: '▥', tone: 'indigo',
    keywords: `gantt gantetu 甘特 甘特图 时间线${TAIL}`,
    group: 'bitable', tier: 'required',
  },
  {
    id: 'bitableGallery', label: '画册', category: '多维表格', plus: false, glyph: '▧', tone: 'indigo',
    keywords: `gallery huace 画册 画廊 卡片${TAIL}`,
    group: 'bitable', tier: 'required',
  },
  {
    // 关联已有多维表格：V1 一律落置灰态（`providerUnavailable`，见 17 §17.5 / §17.13）。
    id: 'bitableRefer', label: '关联', category: '多维表格', plus: false, glyph: '▨', tone: 'indigo',
    keywords: `refer relation guanlian 关联 关联表${TAIL}`,
    group: 'bitable', tier: 'required',
  },
]
