import { describe, expect, it } from 'vitest'

import { median, percentile } from '../../scripts/perf/stats.mjs'

/**
 * perf/stats.mjs 的回归夹具（纯合成数据，不起浏览器）。
 *
 * 这组用例存在的理由是一次真实事故：旧 `percentile` 用 `sorted[round(p * n) - 1]`，
 * 在击键采样数 8、p = 0.95 时下标恒等于 n-1，**取到的就是最大值**。于是
 * `keystrokeP95Ms` 与 `keystrokeP99Ms` 永远同值（2578 / 2578），基线被单次抖动决定 ——
 * 同一份 dist 连采三次极差 2.65 倍。`scripts/perf/measure.mjs` 也确实因为这个组合
 * 把采样数从 30 降到了 8，两个缺陷叠在一起才有这么大的抖动。
 *
 * 所以下面「分位数」那一段守的是两件事：**p95 不能退化成最大值**，**p95 与 p99 必须有区分度**。
 */

/** 严格递增序列，方便按秩手算期望值。 */
const ramp = (n) => Array.from({ length: n }, (_, i) => i + 1)

describe('median', () => {
  it('奇数个样本取中间项', () => {
    expect(median([3, 1, 2])).toBe(2)
  })

  it('偶数个样本取中间两项的平均', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5)
  })

  it('不修改传入数组（实现内部排序，不能就地改）', () => {
    const values = [3, 1, 2]
    median(values)
    expect(values).toEqual([3, 1, 2])
  })

  it('空样本返回 NaN，而不是 undefined 或 0', () => {
    expect(median([])).toBeNaN()
  })
})

describe('percentile', () => {
  it('p=0 取最小值、p=1 取最大值', () => {
    expect(percentile(ramp(30), 0)).toBe(1)
    expect(percentile(ramp(30), 1)).toBe(30)
  })

  it('p=0.5 落在中位数上', () => {
    expect(percentile(ramp(11), 0.5)).toBe(6)
  })

  it('按秩在相邻样本之间线性插值', () => {
    // 秩 = 0.25 * (5 - 1) = 1 → 第二个样本
    expect(percentile([10, 20, 30, 40, 50], 0.25)).toBe(20)
    // 秩 = 0.75 * 4 = 3 → 第四个样本
    expect(percentile([10, 20, 30, 40, 50], 0.75)).toBe(40)
    // 秩 = 0.1 * 4 = 0.4 → 10 + 0.4 * (20 - 10)
    expect(percentile([10, 20, 30, 40, 50], 0.1)).toBeCloseTo(14, 10)
  })

  it('不要求输入有序', () => {
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3)
  })

  it('单样本恒等于它自己，空样本返回 NaN', () => {
    expect(percentile([42], 0.95)).toBe(42)
    expect(percentile([], 0.95)).toBeNaN()
  })

  /**
   * 事故回归 1：旧实现在 8 个样本、p=0.95 时下标 = round(7.6) - 1 = 7，恒为最大值。
   * 若这条失败，说明又退回「p95 就是最差那一次」。
   */
  it('8 个样本下 p95 不再等于最大值（旧实现的缺陷）', () => {
    const samples = ramp(8) // 1..8
    const oldImpl = [...samples].sort((a, b) => a - b)[Math.min(samples.length - 1, Math.max(0, Math.round(0.95 * samples.length) - 1))]
    expect(oldImpl).toBe(8) // 旧口径确实取到最大值，作为对照钉在这里
    expect(percentile(samples, 0.95)).toBeCloseTo(1 + 0.95 * 7, 10) // 7.65
    expect(percentile(samples, 0.95)).toBeLessThan(Math.max(...samples))
  })

  /**
   * 事故回归 2：p95 与 p99 必须能区分开。旧实现在 8 个样本下两者同值
   * （都是下标 7），`keystrokeP95Ms` / `keystrokeP99Ms` 因此失去意义。
   */
  it('p95 与 p99 在同一批样本上有区分度（旧实现恒同值）', () => {
    const samples = ramp(8)
    const oldP95 = [...samples].sort((a, b) => a - b)[Math.min(7, Math.max(0, Math.round(0.95 * 8) - 1))]
    const oldP99 = [...samples].sort((a, b) => a - b)[Math.min(7, Math.max(0, Math.round(0.99 * 8) - 1))]
    expect(oldP95).toBe(oldP99) // 旧口径：8 样本下两者相同
    expect(percentile(samples, 0.95)).toBeLessThan(percentile(samples, 0.99))
  })

  /**
   * 采样数提到 30（决策 B）之后的实际效果：p95 的秩落在 27.55，即有序第 28 与第 29 个
   * 样本之间（值 28.55），而不是最差的那一次，单次偶发抖动不再直接决定基线。
   */
  it('30 个样本下 p95 落在秩 27.55 处，与 p99 分别落在不同的秩', () => {
    const samples = ramp(30)
    expect(percentile(samples, 0.95)).toBeCloseTo(1 + 0.95 * 29, 10) // 28.55
    expect(percentile(samples, 0.99)).toBeCloseTo(1 + 0.99 * 29, 10) // 29.71
  })

  /**
   * 极端长尾：一个 30 倍离群值不应把 p95 拉到离群值本身 ——
   * 这正是「采样数 + 插值口径」一起修才有的性质。
   */
  it('单个离群值不会把 p95 拉到它自己', () => {
    const samples = [...ramp(29), 10000]
    expect(percentile(samples, 0.95)).toBeLessThan(10000)
    expect(percentile(samples, 0.95)).toBeGreaterThan(percentile(samples, 0.5))
  })

  it('结果始终落在样本的最小值与最大值之间', () => {
    const samples = [7, 3, 91, 42, 15, 68, 24]
    for (const p of [0, 0.25, 0.5, 0.9, 0.95, 0.99, 1]) {
      const value = percentile(samples, p)
      expect(value).toBeGreaterThanOrEqual(Math.min(...samples))
      expect(value).toBeLessThanOrEqual(Math.max(...samples))
    }
  })
})
