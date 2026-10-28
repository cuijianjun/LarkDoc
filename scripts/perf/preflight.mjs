/**
 * perf/preflight.mjs — 采集前的机器状态判定（纯函数，无 IO、无浏览器）。
 *
 * 为什么需要它：`check:perf` 是 `build:element && measure && report` 串跑，vue-cli 的
 * 16 worker 构建结束后负载不会立刻归零。2026-10-28 实测：构建前 `loadavg[0]` = 7.38，
 * 构建尾流把它推到 **15.78**，紧随其后的 `measure` 就采在热机上 —— 同一 bundle 得到
 * 4 项「退化」（P95 +33% / P99 +54% / decoration +28% / saveProxy +22%），
 * 而机器静下来单独跑同一 bundle 是 **7/7 全绿**（P95 +8%）。
 *
 * 结论：热机采集不是指标退化，是**采集环境**问题。所以判定放在采集之前，
 * 由 `measure.mjs` 轮询等待；不通过时不采样，而不是采一份不可比的数字。
 *
 * 单独成文件的理由与 `stats.mjs` 相同：`measure.mjs` 顶层就 `main()` 起浏览器，
 * 单测没法 import 它，而阈值判定恰恰是「等多久」这件事唯一需要被钉住的部分。
 */

/** 负载上限的相对系数：核数 × 该系数即为软上限。 */
export const DEFAULT_LOAD_FACTOR = 0.5

/**
 * 负载上限的绝对下限。
 *
 * 低于 4 的绝对负载在任何机器上都不影响 60 FPS 的采集；给小机器（2~4 核）留一个
 * 不至于永远等不到的地板，否则 `cores × 0.5` 在 2 核机上等于 1，正常系统负载就能卡死采集。
 */
export const DEFAULT_LOAD_FLOOR = 4

/**
 * 由核数算负载上限：`max(floor, floor(cores × factor))`。
 *
 * @param {object} options
 * @param {number} options.cores 逻辑核数（`os.cpus().length`）
 * @param {number} [options.factor] 相对系数，默认 {@link DEFAULT_LOAD_FACTOR}
 * @param {number} [options.floor] 绝对下限，默认 {@link DEFAULT_LOAD_FLOOR}
 * @returns {number} 1 分钟负载的上限值
 */
export function loadLimit({ cores, factor = DEFAULT_LOAD_FACTOR, floor = DEFAULT_LOAD_FLOOR }) {
  const safeCores = Number.isFinite(cores) && cores > 0 ? cores : 1
  const safeFactor = Number.isFinite(factor) && factor > 0 ? factor : DEFAULT_LOAD_FACTOR
  const safeFloor = Number.isFinite(floor) && floor >= 0 ? floor : DEFAULT_LOAD_FLOOR
  return Math.max(safeFloor, Math.floor(safeCores * safeFactor))
}

/**
 * 判定当前 1 分钟负载能不能开始采样。
 *
 * 注意这是**等待**判据不是**失败**判据：调用方拿到 `idle: false` 应当继续等，
 * 等到超时才报错。`NaN`（取不到负载的平台）一律按「可采」放行 —— 宁可采一份可能
 * 偏热的数字，也不要在一个读不到 `loadavg` 的环境里永远起不了采集。
 *
 * @param {object} options
 * @param {number} options.load1 `os.loadavg()[0]`
 * @param {number} options.cores 逻辑核数
 * @param {number} [options.limit] 直接指定上限（CI 按运行器硬编码时用，优先于核数换算）
 * @param {number} [options.factor]
 * @param {number} [options.floor]
 * @returns {{ load1: number|null, limit: number, idle: boolean, known: boolean }}
 */
export function evaluateLoad({ load1, cores, limit, factor, floor }) {
  const resolved = Number.isFinite(limit) && limit > 0 ? limit : loadLimit({ cores, factor, floor })
  const known = Number.isFinite(load1)
  return {
    load1: known ? load1 : null,
    limit: resolved,
    idle: known ? load1 <= resolved : true,
    known,
  }
}
