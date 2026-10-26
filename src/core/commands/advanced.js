/**
 * 进阶组命令：AI 改写（宿主通过 ai-request 事件承接，编辑器不持模型）。
 * 需求 03 §3.4 ⑩「进阶」（网页卡片 / 订阅号文章 / 倒计时）在 P3+ 期落位。
 *
 * P5-06 落位的第 2 条 = 订阅号文章（`tier: 'skip'`）：要连公众号服务，V1 不接。
 * 文案/图标取自 `core/embed/enterprise.js` 的 9 项真值表（`providerId = 'subscription_article'`）。
 * 真值 ⑩ 里的「网页卡片」在 P3-03 已由 `bookmark`（网页卡片）交付，「倒计时」仍属
 * 不做档且不需要外部授权 —— 两条都不在本文件。
 */
import { enterpriseCommandOf } from '../embed/enterprise'

export const advancedCommands = [
  { id: 'ai', label: 'AI 改写', category: '智能', plus: false, glyph: '✦', tone: 'green', keywords: 'ai gaixie rewrite', group: 'advanced', tier: 'required' },
  enterpriseCommandOf('subscribeArticle', 'advanced'),
]
