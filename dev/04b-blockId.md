<!-- 由 DEVELOPMENT.md §4 拆出，是「4.2 blockId（块稳定标识）」的唯一出处。 -->
# 4.2 blockId（块稳定标识）

> 所属：[回归防护清单](./04-回归防护清单.md)　|　总导航：[`dev/00-INDEX.md`](./00-INDEX.md)

### 4.2 blockId（块稳定标识）

- 所有「可视块」带 `attrs.blockId`（类型见 `BLOCK_ID_TYPES`）。**列表项是特例必须编号**（飞书把 `fold-block-id` 挂在 item 上）；结构性容器（tableRow / tableCell / column / detailsContent）刻意不编号。
- 补号唯一入口：插件 `appendTransaction` + `collectBlockIdFixes(doc, {doc: oldDoc, mapping})` + `ensureLarkDocBlockIds`（初始挂载 / setContent 各调一次）。补号事务带 `addToHistory:false` 与 meta `larkDocBlockIds`，宿主据此不冒泡 change。
- 三个易错点：
  1. `appendTransaction` 只能挂在 **plugin spec 顶层**，放进 props 不生效；
  2. `Mapping.appendMapping` **无返回值**，别写进 reduce；
  3. 块起始位置映射用 `assoc = +1`。
- 表格的 `data-block-id` **不进 DOM**：prosemirror-tables 的 TableView 自建 `<table>` 且不回写 attrs，浏览器断言要按此口径扣掉表格数。
