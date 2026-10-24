/**
 * 卡片契约（cardEmbed，飞书卡片形态）—— requirements/09 §3.5。
 *
 * 卡片渲染在 DOM（不走 iframe）：可被搜索、可导出 PDF/DOCX、可被评论锚定、
 * 可参与协同。与 webEmbed 的分界线：内容小、需要被搜索/导出/协同 → 卡片；
 * 内容是独立运行时 → iframe；不确定时选 iframe。
 *
 * P0-09 只落常量与契约注释，零渲染实现（P3 卡片节点落地）。
 *
 * 契约规则（写死）：
 * - 体积上限 8 KB：超出只存 resourceId + 摘要，正文不回写文档；
 * - 动作冒泡：按钮点击 → emit('cardAction', { providerId, resourceId, actionId, payload })，
 *   跳转/提交由宿主决定，编辑器不持 token；
 * - 未知 providerId：渲染「未知卡片」占位并原样保留 payload，不做 schema 迁移、不丢数据；
 * - cardVersion 不匹配：按「只读 + 原样保留」处理，等宿主升级。
 *
 * @typedef {Object} CardAction
 * @property {string} id
 * @property {string} label
 * @property {'open'|'command'} kind
 * @property {string} [href]      kind === 'open' 时的跳转地址
 * @property {string} [commandId] kind === 'command' 时冒泡给宿主的命令
 *
 * @typedef {Object} CardSchema
 * @property {1} cardVersion
 * @property {string} providerId 谁的卡片
 * @property {string|null} resourceId 服务端对象 id（可空）
 * @property {{title: string, desc: string, fields: Array<{label: string, value: string}>, cover: string|null}} payload
 * @property {CardAction[]} actions
 */

/** 卡片 schema 基准形状（示例值 = requirements/09 §3.5，实现侧据此校验与降级）。 */
export const cardSchema = {
  cardVersion: 1,
  providerId: 'task_research',
  resourceId: 'tr_123',
  payload: {
    title: '2026 Q4 用户调研',
    desc: '12 题，约 3 分钟',
    fields: [{ label: '截止', value: '11-15' }],
    cover: null,
  },
  actions: [
    { id: 'open', label: '去填写', kind: 'open', href: 'https://example.com/survey/tr_123' },
    { id: 'submit', label: '提交', kind: 'command', commandId: 'card.submit' },
  ],
}
