/**
 * 嵌入组命令：网页卡片（21.35 ⑩进阶）与内嵌网页 15 项。
 *
 * 数据已就位（P3-03）：`core/embed/presets.js` 的 `EMBED_MENU_ITEMS` 就是这 15 项的
 * 菜单文案与顺序，`core/embed/resolve.js` 负责 URL → 属性。这里仍是空数组，原因有两个，
 * 改这个文件前先确认它们都解决了：
 *
 * 1. **`COMMAND_ORDER` 是一条逐项相等的断言**（`core/commands/index.js` 的
 *    size 校验 + `scripts/check-architecture.js` 的 id 列表）。直接推 15 条进来会
 *    立刻抛 `command defs missing from COMMAND_ORDER`，必须同批把那 15 个 id 按
 *    菜单顺序写进 `COMMAND_ORDER` —— 那是「默认档菜单多出 15 项」的可见变更，
 *    不能顺手做；
 * 2. **悬停组与二级选择器**（「内嵌网页」点开后列 15 项）还没实现，现在挂上去会变成
 *    15 行平铺，与 03 §内嵌网页 的二级浮层口径不符。
 *
 * 因此接线放在 P3-07（三个参考实现要真的插入块）时同批做，届时用
 * `EMBED_MENU_ITEMS.map(...)` 派生，**别手写 15 条**。
 */
export const embedCommands = []
