/**
 * EmbedDef —— 「一种嵌入内容」的描述，不是「一个块」。
 *
 * 决策 4（requirements/09 §3.4）：嵌入内容只有两种形态——
 * 能自己跑的网页（kind: 'iframe'，渲染为 webEmbed 原子块）和我们渲染的
 * 卡片（kind: 'card'，渲染为 cardEmbed，可进文本流）。新增一种嵌入 =
 * 加一条 EmbedDef 配置，不许新增块类型、不许 fork core。
 *
 * 本文件只定义形状与 15 条 preset 的空壳（P0-09）；`match` 正则、
 * `toAttrs`、`resolveEmbed` 在 P3-03（core/embed/presets.js + resolver）
 * 落地。零网络：本目录不发任何请求，放不放行由 policy/network 决定。
 *
 * @typedef {Object} EmbedDef
 * @property {string} id            稳定 id，写进节点 attrs.providerId
 * @property {'iframe'|'card'} kind 决定用 webEmbed 还是 cardEmbed 节点渲染
 * @property {string} label         菜单文案
 * @property {string} [icon]        菜单图标名
 * @property {string} [iconColor]   图标色 token
 * @property {'required'|'skeleton'|'skip'} tier 复用命令表三档
 * @property {RegExp[]} [match]     有序匹配，命中即用（P3-03 补）
 * @property {(url: string, m: RegExpMatchArray) => Object} [toAttrs] URL → 节点属性（P3-03 补）
 * @property {string} [sandbox]     iframe sandbox（不给 allow-same-origin + allow-scripts 同源组合）
 * @property {string} [allow]       iframe allow（仅按需 clipboard-write / fullscreen）
 * @property {{version: number, required: string[]}} [bridge] 桥必备能力（5 条：ready/resize/setTitle/error/save）
 * @property {{poster: boolean, minHeight: number}} [fallback] 超时/离线降级
 */

/** 15 条内嵌网页 preset（清单 = requirements/03 §内嵌网页菜单，与飞书口径逐项对齐）。
 *  P0-09 只锁 id/kind/label 空壳；match/toAttrs/尺寸等由 P3-03 补齐为完整 def。
 *  @type {Array<EmbedDef>} */
export const EMBED_PRESETS = [
  { id: 'douyin_embed_video', kind: 'iframe', label: '抖音' },
  { id: 'bilibili', kind: 'iframe', label: '哔哩哔哩' },
  { id: 'youku', kind: 'iframe', label: '优酷' },
  { id: 'iqiyi_video', kind: 'iframe', label: '爱奇艺' },
  { id: 'byte_jimeng', kind: 'iframe', label: '即梦AI' },
  { id: 'figma', kind: 'iframe', label: 'Figma' },
  { id: 'modao', kind: 'iframe', label: '墨刀' },
  { id: 'canva', kind: 'iframe', label: 'Canva' },
  { id: 'jcode', kind: 'iframe', label: '码上掘金' },
  { id: 'codepen', kind: 'iframe', label: 'CodePen' },
  { id: 'feishu_survey', kind: 'iframe', label: '飞书问卷' },
  { id: 'jinshuju', kind: 'iframe', label: '金数据' },
  { id: 'airtable', kind: 'iframe', label: 'Airtable' },
  { id: 'baidumap', kind: 'iframe', label: '百度地图' },
  { id: 'autonavi', kind: 'iframe', label: '高德地图' },
].map((preset) => ({ tier: 'skeleton', ...preset }))
