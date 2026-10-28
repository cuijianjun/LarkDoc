/**
 * 绘图板三件（P5-05）：思维导图 / 流程图 / UML 图 —— **一张清单，三处共用**。
 *
 * 规格口径（读这段再动值）：
 *
 *   - 03 §3.4 ⑥ 实测「绘图」组**4 项**，y 序：画板 1388 / 思维导图 1420 /
 *     流程图 1452 / UML图 1484，data-name 分别是
 *     `diagram whiteboard normal|mindmap|flowchart|uml`。
 *   - 17 §17.4.1：飞书 API 层这四种共用**一个** `board` 块类型（必填 `board_id`
 *     或 `source_url`，可选 `template_id` / `height` / `theme`），网页块类型名
 *     `whiteboard`。**没有** mindmap / flowchart / uml 三个块类型。
 *   - 04 §5.2 + 16 §2.11：这 4 项点下去**没有任何产出**（8 秒内页数、块数、全屏层
 *     全都不动，两轮独立复现），所以**任何写像素规格的都是编的**。09 §5.6 P5-04/P5-05
 *     因此把它们定为 `cardEmbed` 空态骨架，不写 canvas 引擎。
 *
 * 🔴 所以 `providerId` **不是**飞书块类型名（飞书只有一个 `board`）：
 * 这三个值是本仓库的卡片契约键 —— `board_` 前缀保留块类型归属，后缀对应
 * 03 §3.4 ⑥ data-name 的末段。真落库到飞书侧时映射回 `board` + `template_id`，
 * 映射就靠本文件的 `template` 字段（`mindmap` / `flowchart` / `uml`）。
 *
 * 🔴 **画板（`diagram whiteboard normal`）故意不在这里**：P3-07 用 `webEmbed` +
 * 全桥真交付了（`core/embed/bridge.js`，参考实现在 demo 侧），它是 iframe 型内容，
 * 不是空态卡。把它塞进本文件会得到一个「画板走卡、其余走 iframe」的假一致。
 * core 命令表目前没有 `whiteboard` 命令 —— 这是显式缺口，别在这里硬补一条。
 *
 * 为什么单独一个文件：命令层（`commands/draw.js`）要 label 与菜单顺序、
 * 宿主（`commandMenuMixin`）要「命令 id → 卡片 kind」、测试要真值表，
 * 三处各抄一份必然漂移（历史上标题菜单就分叉过三轮）。
 */

/** 三种绘图模板（`board.template_id` 的取值，也是本仓库卡片 providerId 的后缀）。 */
export const BOARD_TEMPLATES = Object.freeze(['mindmap', 'flowchart', 'uml'])

/**
 * 三项真值表。`id` 是命令 id（P0-05 camelCase 契约），`label` 是菜单文案
 * （**逐字**照 03 §3.4 ⑥，含 `UML图` 不带空格的写法），`dataName` 只作溯源记录。
 */
export const BOARD_DIAGRAM_ITEMS = Object.freeze([
  { id: 'mindMap', template: 'mindmap', providerId: 'board_mindmap', label: '思维导图', dataName: 'diagram whiteboard mindmap' },
  { id: 'flowChart', template: 'flowchart', providerId: 'board_flowchart', label: '流程图', dataName: 'diagram whiteboard flowchart' },
  { id: 'umlDiagram', template: 'uml', providerId: 'board_uml', label: 'UML图', dataName: 'diagram whiteboard uml' },
])

const BY_COMMAND = new Map(BOARD_DIAGRAM_ITEMS.map((item) => [item.id, item]))
const BY_PROVIDER = new Map(BOARD_DIAGRAM_ITEMS.map((item) => [item.providerId, item]))

/** 命令 id → 卡片 providerId。不是绘图命令返回 null（调用方据此走别的分支）。 */
export function boardProviderOf(commandId) {
  const item = BY_COMMAND.get(commandId)
  return item ? item.providerId : null
}

/** 卡片 providerId → 模板名。不是绘图卡返回 null。 */
export function boardTemplateOf(providerId) {
  const item = BY_PROVIDER.get(providerId)
  return item ? item.template : null
}

/** 卡片 providerId → 中文名。不是绘图卡返回空串（不抛错，同 `referenceKindLabel`）。 */
export function boardLabelOf(providerId) {
  const item = BY_PROVIDER.get(providerId)
  return item ? item.label : ''
}
