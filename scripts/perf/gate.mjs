/**
 * perf/gate.mjs — P7-06 性能门禁的判定核心（纯函数，无 IO）。
 *
 * 只做三件事：比指标、判工作负载是否可比、把结论渲染成可读表格。
 * 文件读写与进程退出码留在 report.mjs，这样单测可以在 node 环境里直接喂合成数据
 * （见 test/unit/perf-gate.test.js），不需要起浏览器，也不需要真实采集结果。
 *
 * 口径与 requirements/09 §2.4.3 一致：任一指标退化 > 20% 即失败。
 * 方向：时间/内存类越高越差；scrollFps 越低越差。
 */

/** 退化阈值（> 20%，等于 20% 不算）。 */
export const REGRESSION_LIMIT = 0.2

/**
 * 浮点容差：`base * 1.2` 在二进制里常常落成 0.20000000000000004，
 * 没有它「恰好 20%」会被误判成超阈。
 */
const EPSILON = 1e-9

/** 指标方向：true = 升高是退化（时间/内存），false = 降低是退化（帧率）。 */
export const PERF_METRICS = Object.freeze({
  mountToTypeableMs: true,
  keystrokeP95Ms: true,
  keystrokeP99Ms: true,
  decorationsRebuildMs: true,
  scrollFps: false,
  saveProxyMs: true,
  heapMB: true,
})

export const VERDICT = Object.freeze({
  OK: 'ok',
  REGRESSED: 'regressed',
  MISSING: 'missing',
})

const VERDICT_LABEL = {
  [VERDICT.OK]: '✓',
  [VERDICT.REGRESSED]: '✗ 退化',
  [VERDICT.MISSING]: '✗ 缺数据',
}

/** `+21%` / `-4%` / `0%`。 */
export function formatDelta(delta) {
  if (delta == null || !Number.isFinite(delta)) return '—'
  const rounded = Math.round(delta * 100)
  if (rounded === 0) return '0%'
  return `${rounded > 0 ? '+' : ''}${rounded}%`
}

/** 基线里有 `_meta` 就用它，老格式（顶层平铺）也能读。 */
export function baselineMetaOf(baseline) {
  return (baseline && baseline._meta) || baseline || {}
}

/**
 * 工作负载口径是否可比：seed 或块数不同，两个数字根本不在同一坐标系里，
 * 这时必须拒绝判定（report.mjs 会以退出码 2 表示「不可比」而不是「失败」）。
 */
export function checkWorkload(baselineMeta, result) {
  const meta = baselineMeta || {}
  const seed = result && result.seed
  const blockCount = result && result.blockCount
  if (meta.seed !== seed || meta.blockCount !== blockCount) {
    return {
      comparable: false,
      reason: `工作负载不一致（基线 seed=${meta.seed}/blocks=${meta.blockCount}，本次 seed=${seed}/blocks=${blockCount}）`,
    }
  }
  return { comparable: true, reason: '' }
}

/**
 * 比一轮指标。
 *
 * @returns {{
 *   rows: Array<{ key: string, base: number|null, now: number|null, delta: number|null, verdict: string }>,
 *   failures: Array<{ key: string, kind: 'regression'|'missing', delta: number|null }>,
 *   failed: boolean,
 * }}
 */
export function compareMetrics(baseline, result, options = {}) {
  const limit = options.limit == null ? REGRESSION_LIMIT : options.limit
  const metrics = options.metrics || PERF_METRICS
  const baseMetrics = (baseline && baseline.metrics) || {}
  const nowMetrics = (result && result.metrics) || {}

  const rows = []
  const failures = []
  for (const [key, higherIsWorse] of Object.entries(metrics)) {
    const base = baseMetrics[key]
    const now = nowMetrics[key]
    if (base == null || now == null) {
      rows.push({ key, base: base == null ? null : base, now: now == null ? null : now, delta: null, verdict: VERDICT.MISSING })
      failures.push({ key, kind: VERDICT.MISSING, delta: null })
      continue
    }
    // 基数为 0 时比率没有意义（旧实现直接给 0），保持「不判退化」以免除零炸出 Infinity。
    const delta = base === 0 ? 0 : (now - base) / base
    const regressed = higherIsWorse ? delta > limit + EPSILON : delta < -(limit + EPSILON)
    rows.push({ key, base, now, delta, verdict: regressed ? VERDICT.REGRESSED : VERDICT.OK })
    if (regressed) failures.push({ key, kind: VERDICT.REGRESSED, delta })
  }

  return { rows, failures, failed: failures.length > 0 }
}

/** 表格行（不含表头），供 CLI 与报告共用同一套排版。 */
export function renderRows(rows) {
  return (rows || []).map(({ key, base, now, delta, verdict }) => {
    const baseText = base == null ? '—' : String(base)
    const nowText = now == null ? '—' : String(now)
    const label = VERDICT_LABEL[verdict] || verdict
    return `  ${key.padEnd(24)} ${baseText.padStart(8)} ${nowText.padStart(8)} ${formatDelta(delta).padStart(7)}  ${label}`
  })
}

export function renderTable(rows) {
  const header = `  ${'指标'.padEnd(22)} ${'基线'.padStart(8)} ${'本次'.padStart(8)} ${'Δ'.padStart(7)}  判定`
  return [header, ...renderRows(rows)].join('\n')
}

/**
 * 由一次真实采集结果生成基线对象 —— `--update` 与 CI 首次「建立本运行器基线」
 * 走同一条路径，保证基线永远是采集结果的原样拷贝，不给人手填数的机会。
 */
export function buildBaseline(result, options = {}) {
  const capturedAt = options.capturedAt || new Date().toISOString()
  return {
    _meta: {
      comment: '性能基线（requirements/09 §2.4.3 门禁）。只能由 report.mjs 从真实运行生成，禁止手填。',
      seed: result.seed,
      blockCount: result.blockCount,
      node: result.node,
      platform: options.platform || process.platform,
      arch: options.arch || process.arch,
      capturedAt,
    },
    metrics: { ...result.metrics },
  }
}
