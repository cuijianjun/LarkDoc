/**
 * 内嵌网页的「数据与判定」层 —— `blocks/web-embed.js`（节点定义）与
 * `nodeviews/web-embed.js`（渲染）共用，避免两者互相 import 成环
 * （先例：`core/media/file-block.js`）。
 *
 * 规格来源 requirements/09 §3.4.1 + §3.4.2 安全基线 + requirements/04 §4.3 实测尺寸。
 */
import { resolveBridgeOrigin } from './bridge'

/** 未命中任何 preset 时的 providerId（09 §3.4.1）。 */
export const GENERIC_PROVIDER_ID = 'generic'

/** 04 §4.3 实测默认块高（820×463，比例 1.771 ≈ 16:9）。 */
export const WEB_EMBED_DEFAULT_HEIGHT = 463

/**
 * 默认宽高比 = 820 ÷ 463（04 §4.3 实测）。
 *
 * 与 `WEB_EMBED_DEFAULT_HEIGHT` 同一个规格的两个面：高度用在「宽度未知」的兜底，
 * 比例用在「宽度会变」的场合（preset 把 aspect 写进 attrs，宽度一变高度跟着变，
 * 不用再为每个站点存一个像素值）。两个数必须自洽：`round(820 / 1.771) === 463`。
 */
export const WEB_EMBED_DEFAULT_ASPECT = 1.771

/** 高度上下界：下界防塌成一条线，上界防一条 JSON 把页面撑爆。 */
export const WEB_EMBED_MIN_HEIGHT = 120
export const WEB_EMBED_MAX_HEIGHT = 4000

/** 正文宽硬顶（04 §4.3 实测 inline `max-width: 1041px` ≈ 正文宽 × 1.27）。 */
export const WEB_EMBED_MAX_WIDTH = 1041

/**
 * 09 §3.4.2 安全基线（写死，默认值）：
 *   - **不给 `allow-same-origin` + `allow-scripts` 的同源组合** —— 那个组合等于没沙箱；
 *   - `allow` 仅按需给 `clipboard-write` / `fullscreen`；
 *   - `referrerpolicy="no-referrer"`。
 *
 * 注意 04 §4.3 ⑥ 实测飞书的 sandbox 是 `allow-scripts allow-same-origin allow-presentation
 * allow-forms allow-popups allow-downloads`（含那个同源组合）。两份文档在这一项上冲突，
 * 这里取 09：默认从严；个别确实需要同源的嵌入内容由 `EmbedDef.sandbox` 显式覆盖
 * （数据文件里一行可见、可 review），而不是让内核默默开后门。
 */
export const DEFAULT_EMBED_SANDBOX = 'allow-scripts allow-presentation allow-forms allow-popups allow-downloads'
export const DEFAULT_EMBED_ALLOW = 'clipboard-write; fullscreen'

/**
 * `src` 的合法性 = 桥能不能推导出它的 origin。
 *
 * 09 §3.4.2 把「`src` 必须 https，`localhost` 仅 dev 例外」写进安全基线（不许 per-app 放开），
 * 而这条规则在 `resolveBridgeOrigin` 里实现过一遍 —— 复用等于把「能渲染」与「桥能握手」
 * 锁在一起：origin 推不出来的地址，落成块也只是个连不上的白框，不如在 parseHTML /
 * validator 就拒掉（退化成 unknown-block，不静默丢内容）。
 */
export function safeEmbedSrc(value) {
  if (value === null || value === undefined || value === '') return true
  if (typeof value !== 'string') return false
  return resolveBridgeOrigin(value) !== null
}

/**
 * 块高解析：`height` 优先，其次 `aspect × 实际宽度`，最后 463。
 *
 * 放在判定层（而不是 NodeView）是因为 renderHTML 与 NodeView 都要用，且 preset 单测
 * 可以直接验「airtable 602 / jcode 485」而不用起编辑器。
 *
 * @param {Object} attrs 节点属性
 * @param {number} [width] 实际渲染宽度（默认按 820 正文宽算，04 §4.3 实测值）
 */
export function resolveEmbedHeight(attrs, width = 820) {
  const source = attrs || {}
  const height = Number(source.height)
  if (Number.isFinite(height) && height >= WEB_EMBED_MIN_HEIGHT && height <= WEB_EMBED_MAX_HEIGHT) return Math.round(height)
  const aspect = Number(source.aspect)
  const usable = Number.isFinite(Number(width)) && Number(width) > 0 ? Number(width) : 820
  if (Number.isFinite(aspect) && aspect > 0 && aspect <= 20) return Math.round(usable / aspect)
  return WEB_EMBED_DEFAULT_HEIGHT
}

/** 一份块属性能不能渲染出东西 —— 插入侧与 NodeView 共用同一判据。 */
export function canRenderWebEmbed(attrs) {
  return Boolean(attrs && attrs.src && safeEmbedSrc(attrs.src) && typeof attrs.src === 'string')
}
