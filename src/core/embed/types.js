/**
 * EmbedDef —— 「一种嵌入内容」的描述，不是「一个块」。
 *
 * 决策 4（requirements/09 §3.4）：嵌入内容只有两种形态——
 * 能自己跑的网页（kind: 'iframe'，渲染为 webEmbed 原子块）和我们渲染的
 * 卡片（kind: 'card'，渲染为 cardEmbed，可进文本流）。新增一种嵌入 =
 * 加一条 EmbedDef 配置，不许新增块类型、不许 fork core。
 *
 * 本文件只定义形状（P0-09）；15 条数据在 `./presets.js`、URL → 属性的映射在
 * `./resolve.js`（均为 P3-03）。零网络：本目录不发任何请求，放不放行由 policy/network 决定。
 *
 * 🔴 **形状与 `EmbedDef` 有意分成两层**：`EmbedDef` 描述「这是一种什么嵌入」，
 * 而「一个 URL 属于谁、`src` 要不要改写」是**按 URL 的 host 判**的（04 §4.3 ⑤.1
 * W2/W3：点哔哩哔哩粘抖音链接落的是抖音播放器）——所以改写规则挂在
 * `EMBED_SRC_RULES` 上，与菜单项的 `label` 只靠 `id` 弱关联。别再往 `EmbedDef`
 * 上塞 `match` / `toAttrs`：那样等于又把「菜单项」当成了「谁是这条 URL 的站点」。
 *
 * @typedef {Object} EmbedDef
 * @property {string} id            稳定 id，写进节点 attrs.providerId
 * @property {'iframe'|'card'} kind 决定用 webEmbed 还是 cardEmbed 节点渲染
 * @property {string} label         菜单文案（浮层标题也从这里派生）
 * @property {'required'|'skeleton'|'skip'} tier 复用命令表三档
 * @property {number} aspect        站点级默认宽高比（13 项 1.771，airtable / jcode 例外）
 * @property {string} [icon]        菜单图标名
 * @property {string} [iconColor]   图标色 token
 * @property {string} [sandbox]     iframe sandbox（不给 allow-same-origin + allow-scripts 同源组合）
 * @property {string} [allow]       iframe allow（仅按需 clipboard-write / fullscreen）
 * @property {{version: number, required: string[]}} [bridge] 桥必备能力（5 条：ready/resize/setTitle/error/save）
 * @property {{poster: boolean, minHeight: number}} [fallback] 超时/离线降级
 */

/**
 * 15 条内嵌网页 preset —— 数据在 `./presets.js`（P3-03），本文件只转发。
 *
 * P0-09 时这里是手写的 15 条空壳；P3-03 把文案 / host 规则 / `src` 规范化收进
 * `presets.js` 一个数据文件后，这里再抄一份就会立刻漂移（label 改一处得改两处）。
 * 保留这个导出是因为 `scripts/check-architecture.js` 与上层只认 `core/embed/types`
 * 这一个入口（P0-09 的验收断言就压在这条路径上）。
 *
 * @type {Array<EmbedDef>}
 */
export { EMBED_PRESETS } from './presets'
