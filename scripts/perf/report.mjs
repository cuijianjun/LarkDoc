/**
 * report.mjs — P0-10 门禁：当前采集结果对比 perf/baseline.json，退化 > 20% 非零退出
 * （requirements/09 §2.4.3「这张表是门禁，不是愿望」、§5.7 check:perf 每 PR 起每期跑）。
 *
 * 用法：
 *   node scripts/perf/report.mjs            // 对比（无基线 → 提示先 --update）
 *   node scripts/perf/report.mjs --update   // 把本次 .perf-result.json 写成新基线
 *
 * 基线只能由真实运行生成（--update 复制采集结果），不许手填。
 * 方向口径：时间/内存类越高越差；scrollFps 越低越差。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')
const perfDir = path.join(repoRoot, 'perf')
const resultPath = path.join(perfDir, '.perf-result.json')
const baselinePath = path.join(perfDir, 'baseline.json')

const REGRESSION_LIMIT = 0.2
/** 指标方向：true = 升高是退化（时间/内存），false = 降低是退化（帧率）。 */
const METRICS = {
  mountToTypeableMs: true,
  keystrokeP95Ms: true,
  keystrokeP99Ms: true,
  decorationsRebuildMs: true,
  scrollFps: false,
  saveProxyMs: true,
  heapMB: true,
}

const pct = (value) => `${value >= 0 ? '+' : ''}${Math.round(value * 100)}%`

function main() {
  if (!fs.existsSync(resultPath)) {
    console.error('缺少 perf/.perf-result.json —— 先跑 node scripts/perf/measure.mjs')
    process.exit(2)
  }
  const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'))

  if (process.argv.includes('--update')) {
    const baseline = {
      _meta: {
        comment: '性能基线（requirements/09 §2.4.3 门禁）。只能由 report.mjs --update 从真实运行生成，禁止手填。',
        seed: result.seed,
        blockCount: result.blockCount,
        node: result.node,
        capturedAt: result.capturedAt,
        note: '机器相关基线：换机器或换 seed 请重采。check:perf 退化超 20% 非零退出。',
      },
      metrics: result.metrics,
    }
    fs.mkdirSync(perfDir, { recursive: true })
    fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`)
    console.log('基线已更新 → perf/baseline.json')
    for (const [key, value] of Object.entries(result.metrics)) console.log(`  ${key} = ${value}`)
    return
  }

  if (!fs.existsSync(baselinePath)) {
    console.error('perf/baseline.json 不存在 —— 首次建基线：node scripts/perf/report.mjs --update')
    process.exit(2)
  }
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
  const baselineMeta = baseline._meta || baseline
  if (baselineMeta.seed !== result.seed || baselineMeta.blockCount !== result.blockCount) {
    console.error(`工作负载不一致（基线 seed=${baselineMeta.seed}/blocks=${baselineMeta.blockCount}，本次 seed=${result.seed}/blocks=${result.blockCount}）—— 不可比，拒绝判定`)
    process.exit(2)
  }

  const rows = []
  let failed = false
  for (const [key, higherIsWorse] of Object.entries(METRICS)) {
    const base = baseline.metrics[key]
    const now = result.metrics[key]
    if (base == null || now == null) {
      rows.push([key, base, now, '—', '缺数据'])
      failed = true
      continue
    }
    const delta = base === 0 ? 0 : (now - base) / base
    const regressed = higherIsWorse ? delta > REGRESSION_LIMIT : delta < -REGRESSION_LIMIT
    if (regressed) failed = true
    rows.push([key, base, now, pct(delta), regressed ? '✗ 退化' : '✓'])
  }

  console.log(`\n指标（seed=${result.seed}, blocks=${result.blockCount}, 预算口径见 requirements/09 §2.4.3，退化阈值 20%）：`)
  console.log('  指标                     基线      本次      Δ      判定')
  for (const [key, base, now, delta, verdict] of rows) {
    console.log(`  ${key.padEnd(24)} ${String(base).padStart(8)} ${String(now).padStart(8)} ${delta.padStart(7)}  ${verdict}`)
  }
  if (failed) {
    console.error('\ncheck:perf 失败：存在退化 > 20% 的指标')
    process.exit(1)
  }
  console.log('\ncheck:perf 通过')
}

main()
