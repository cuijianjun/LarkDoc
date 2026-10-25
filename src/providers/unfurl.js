/**
 * 网页元数据 Provider 出口（P3-05）—— requirements/09 §265。
 *
 * 第 6 个**可选** provider，和 `upload` 一样是薄转发：纯逻辑在
 * `src/core/embed/unfurl.js`（无 DOM、可单测），这里只做出口收口，
 * 上层从 `providers/` 一个目录就能拿到全部 provider。
 *
 * 与另外五个 provider 的区别：它**不进 5 类必选契约**。宿主没接它时，
 * 网页卡片会降级成「URL + 域名标题」的简卡，其余能力照常 —— 所以
 * `createUnfurlProvider()` 在没给抓取实现时返回 `null` 而不是抛错。
 */
export {
  createUnfurlProvider,
  UNFURL_ERROR,
  DEFAULT_UNFURL_TIMEOUT,
} from '../core/embed/unfurl'
