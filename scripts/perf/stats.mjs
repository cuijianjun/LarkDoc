/**
 * perf/stats.mjs — 性能采集用到的统计量（纯函数，无 IO、无浏览器）。
 *
 * 单独成文件只有一个原因：`scripts/perf/measure.mjs` 在模块顶层直接 `main()` 起浏览器，
 * 单元测试没法 import 它。把这些纯函数挪出来，`test/unit/perf-stats.test.js` 才能钉住口径。
 *
 * 这里最要紧的一条是 **`percentile` 的口径**：旧实现用
 * `sorted[Math.round(p * n) - 1]`，在 n=8 / p=0.95 时下标恒等于 n-1，也就是**最大值** ——
 * 于是 `keystrokeP95Ms` 与 `keystrokeP99Ms` 永远同值（2578 / 2578），单次抖动直接成为基线。
 * 修这条的用例写在 `perf-stats.test.js` 的「分位数」describe 里，别再退化回去。
 */

/**
 * 中位数：奇数个取中间项，偶数个取中间两项的平均。
 *
 * @param {number[]} values
 * @returns {number} 空样本返回 NaN（让调用方自己决定能不能接受缺数）
 */
export function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  if (!sorted.length) return NaN
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * 线性插值分位数（与 numpy 默认口径一致）。
 *
 * 秩取 `p * (n - 1)`：落在两个相邻样本之间时按小数部分插值。
 * `p=0` 返回最小值、`p=1` 返回最大值，两者之间的任何概率都有区分度。
 *
 * @param {number[]} values
 * @param {number} p 概率，取值 [0, 1]
 * @returns {number} 空样本返回 NaN（让调用方自己决定能不能接受缺数）
 */
export function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b)
  if (!sorted.length) return NaN
  const rank = p * (sorted.length - 1)
  const lower = Math.floor(rank)
  const upper = Math.min(sorted.length - 1, lower + 1)
  return sorted[lower] + (rank - lower) * (sorted[upper] - sorted[lower])
}
