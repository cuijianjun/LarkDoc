import { describe, expect, it } from 'vitest'

import {
  PERF_METRICS,
  REGRESSION_LIMIT,
  baselineMetaOf,
  buildBaseline,
  checkWorkload,
  compareMetrics,
  formatDelta,
  renderRows,
} from '../../scripts/perf/gate.mjs'

/**
 * P7-06 门禁回归夹具（纯合成数据，不碰 perf/*.json，也不起浏览器）。
 *
 * 这条用例守的是「门禁本身能不能拦住退化」，不是「性能好不好」：
 * 正常数据必须通过，合成 >20% 退化必须失败，方向相反的指标（帧率）不能判反。
 * 真实数据由 `npm run check:perf` 采集后再走同一套比较逻辑。
 */

const BASE_METRICS = {
  mountToTypeableMs: 39232.7,
  keystrokeP95Ms: 6002.1,
  keystrokeP99Ms: 6002.1,
  decorationsRebuildMs: 2.1,
  scrollFps: 59.3,
  saveProxyMs: 25,
  heapMB: 107.4,
}

const baseline = {
  _meta: { seed: 42, blockCount: 2000, platform: 'darwin', arch: 'arm64' },
  metrics: { ...BASE_METRICS },
}

const run = (metricOverrides = {}, meta = {}) => ({
  seed: 42,
  blockCount: 2000,
  ...meta,
  metrics: { ...BASE_METRICS, ...metricOverrides },
})

const verdictOf = (result, key, options) => {
  const { rows } = compareMetrics(baseline, result, options)
  return rows.find((row) => row.key === key).verdict
}

describe('perf gate: 正常数据通过', () => {
  it('指标完全一致时全部 ok 且不失败', () => {
    const { failed, failures, rows } = compareMetrics(baseline, run())
    expect(failed).toBe(false)
    expect(failures).toEqual([])
    expect(rows.length).toBe(Object.keys(PERF_METRICS).length)
    expect(rows.every((row) => row.verdict === 'ok')).toBe(true)
    expect(rows.every((row) => row.delta === 0)).toBe(true)
  })

  it('恰好 20% 退化不算超阈（判据是 > 20%，不是 >=）', () => {
    const { failed } = compareMetrics(baseline, run({ keystrokeP95Ms: BASE_METRICS.keystrokeP95Ms * 1.2 }))
    expect(failed).toBe(false)
    expect(verdictOf(run({ keystrokeP95Ms: BASE_METRICS.keystrokeP95Ms * 1.2 }), 'keystrokeP95Ms')).toBe('ok')
  })

  it('性能变好（时间下降、帧率上升）不失败', () => {
    const { failed } = compareMetrics(baseline, run({
      mountToTypeableMs: BASE_METRICS.mountToTypeableMs * 0.5,
      keystrokeP95Ms: BASE_METRICS.keystrokeP95Ms * 0.5,
      scrollFps: BASE_METRICS.scrollFps * 1.1,
    }))
    expect(failed).toBe(false)
  })
})

describe('perf gate: 合成 >20% 退化必须失败', () => {
  it.each([
    ['mountToTypeableMs', BASE_METRICS.mountToTypeableMs * 1.21],
    ['keystrokeP95Ms', BASE_METRICS.keystrokeP95Ms * 1.21],
    ['keystrokeP99Ms', BASE_METRICS.keystrokeP99Ms * 1.21],
    ['decorationsRebuildMs', BASE_METRICS.decorationsRebuildMs * 1.21],
    ['saveProxyMs', BASE_METRICS.saveProxyMs * 1.21],
    ['heapMB', BASE_METRICS.heapMB * 1.21],
  ])('时间/内存指标 %s 升高 21% 判退化', (key, value) => {
    const result = run({ [key]: value })
    const { failed, failures } = compareMetrics(baseline, result)
    expect(verdictOf(result, key)).toBe('regressed')
    expect(failed).toBe(true)
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({ key, kind: 'regressed' })
  })

  it('帧率下降 21% 判退化（方向与时间类相反）', () => {
    const result = run({ scrollFps: BASE_METRICS.scrollFps * 0.79 })
    expect(verdictOf(result, 'scrollFps')).toBe('regressed')
    expect(compareMetrics(baseline, result).failed).toBe(true)
  })

  it('帧率上升 21% 不判退化', () => {
    expect(verdictOf(run({ scrollFps: BASE_METRICS.scrollFps * 1.21 }), 'scrollFps')).toBe('ok')
  })

  it('多指标同时退化时逐个列出，不只报第一个', () => {
    const result = run({ keystrokeP95Ms: 9000, heapMB: 200 })
    const { failures } = compareMetrics(baseline, result)
    expect(failures.map((failure) => failure.key).sort()).toEqual(['heapMB', 'keystrokeP95Ms'])
  })

  it('阈值可覆盖（默认 20%，显式传 50% 时 21% 退化应通过）', () => {
    const result = run({ keystrokeP95Ms: BASE_METRICS.keystrokeP95Ms * 1.21 })
    expect(compareMetrics(baseline, result, { limit: 0.5 }).failed).toBe(false)
    expect(REGRESSION_LIMIT).toBe(0.2)
  })
})

describe('perf gate: 缺数据与不可比', () => {
  it('缺指标判失败并标 missing（不能静默放行）', () => {
    const result = run()
    delete result.metrics.heapMB
    const { failed, failures, rows } = compareMetrics(baseline, result)
    expect(failed).toBe(true)
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({ key: 'heapMB', kind: 'missing' })
    expect(rows.find((row) => row.key === 'heapMB').verdict).toBe('missing')
  })

  it('基数为 0 时 delta 记为 0，不产生 Infinity/NaN', () => {
    const zeroBaseline = { _meta: { seed: 42, blockCount: 2000 }, metrics: { ...BASE_METRICS, saveProxyMs: 0 } }
    const { rows } = compareMetrics(zeroBaseline, run({ saveProxyMs: 5 }))
    const row = rows.find((item) => item.key === 'saveProxyMs')
    expect(row.delta).toBe(0)
    expect(Number.isFinite(row.delta)).toBe(true)
  })

  it('seed 或块数不一致时判不可比（跨工作负载的数字没有意义）', () => {
    expect(checkWorkload(baselineMetaOf(baseline), run())).toMatchObject({ comparable: true })
    expect(checkWorkload(baselineMetaOf(baseline), run({}, { seed: 43 }))).toMatchObject({ comparable: false })
    expect(checkWorkload(baselineMetaOf(baseline), run({}, { blockCount: 500 }))).toMatchObject({ comparable: false })
    expect(checkWorkload({ seed: 42, blockCount: 2000 }, run())).toMatchObject({ comparable: true })
  })

  it('旧版基线没有 _meta 包裹时也能读出 seed/块数', () => {
    expect(baselineMetaOf({ seed: 42, blockCount: 2000, metrics: BASE_METRICS })).toMatchObject({ seed: 42, blockCount: 2000 })
  })
})

describe('perf gate: 基线只能由真实采集生成', () => {
  it('buildBaseline 复制本次指标的原始值并记录 seed/块数/平台', () => {
    const captured = buildBaseline(run({ keystrokeP95Ms: 6002.1 }), { platform: 'linux', arch: 'x64' })
    expect(captured.metrics).toEqual(run().metrics)
    expect(captured._meta).toMatchObject({ seed: 42, blockCount: 2000, platform: 'linux', arch: 'x64' })
    expect(typeof captured._meta.capturedAt).toBe('string')
    expect(Number.isNaN(Date.parse(captured._meta.capturedAt))).toBe(false)
  })

  it('buildBaseline 深拷贝指标（后续改 result 不会污染基线）', () => {
    const result = run()
    const captured = buildBaseline(result)
    result.metrics.heapMB = 999
    expect(captured.metrics.heapMB).toBe(BASE_METRICS.heapMB)
  })
})

describe('perf gate: 输出可读', () => {
  it('formatDelta 带正负号并四舍五入到整数百分比', () => {
    expect(formatDelta(0.214)).toBe('+21%')
    expect(formatDelta(-0.036)).toBe('-4%')
    expect(formatDelta(0)).toBe('0%')
  })

  it('renderRows 每行都带指标名、基线与本次取值', () => {
    const { rows } = compareMetrics(baseline, run({ keystrokeP95Ms: 9000 }))
    const lines = renderRows(rows)
    expect(lines).toHaveLength(rows.length)
    expect(lines.join('\n')).toContain('keystrokeP95Ms')
    expect(lines.join('\n')).toContain('+50%')
    expect(lines.join('\n')).toContain('退化')
  })
})
