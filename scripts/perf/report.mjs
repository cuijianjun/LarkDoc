/**
 * report.mjs — P0-10/P7-06 门禁：当前采集结果对比基线，任一指标退化 > 20% 非零退出
 * （requirements/09 §2.4.3「这张表是门禁，不是愿望」、§5.7 check:perf 每 PR 起每期跑）。
 *
 * 判定逻辑全在 perf/gate.mjs（纯函数，单测覆盖）；这里只做参数、IO 与退出码。
 *
 * 用法：
 *   node scripts/perf/report.mjs                       // 对比 perf/baseline.json
 *   node scripts/perf/report.mjs --update              // 把本次 .perf-result.json 写成基线
 *   node scripts/perf/report.mjs --baseline <path>     // 换一份基线（CI 按运行器分基线）
 *   node scripts/perf/report.mjs --bootstrap           // 基线不存在时用本次采集建立它（不判定）
 *
 * 退出码：0 通过 / 1 有指标退化 > 20% / 2 不可比（缺采集、缺基线、工作负载不一致）。
 * 基线只能由真实运行生成（--update 或 --bootstrap 复制采集结果），不许手填。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  REGRESSION_LIMIT,
  baselineMetaOf,
  buildBaseline,
  checkWorkload,
  compareMetrics,
  renderTable,
} from './gate.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')
const perfDir = path.join(repoRoot, 'perf')
const resultPath = path.join(perfDir, '.perf-result.json')

const EXIT_OK = 0
const EXIT_REGRESSED = 1
const EXIT_INCOMPARABLE = 2

function argValue(argv, flag) {
  const index = argv.indexOf(flag)
  if (index < 0) return null
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) {
    console.error(`${flag} 需要一个路径参数`)
    process.exit(EXIT_INCOMPARABLE)
  }
  return value
}

function writeBaseline(targetPath, baseline) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  fs.writeFileSync(targetPath, `${JSON.stringify(baseline, null, 2)}\n`)
}

/** 仓库内的路径显示成相对路径；仓库外（CI 临时目录 / cache）照原样显示。 */
function displayPath(targetPath) {
  const relative = path.relative(repoRoot, targetPath)
  return !relative || relative.startsWith('..') ? targetPath : relative
}

function main() {
  const argv = process.argv.slice(2)
  const baselinePath = path.resolve(repoRoot, argValue(argv, '--baseline') || 'perf/baseline.json')
  const relativeBaseline = displayPath(baselinePath)
  const update = argv.includes('--update')
  const bootstrap = argv.includes('--bootstrap')

  if (!fs.existsSync(resultPath)) {
    console.error('缺少 perf/.perf-result.json —— 先跑 node scripts/perf/measure.mjs')
    process.exit(EXIT_INCOMPARABLE)
  }
  const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'))

  if (update || (bootstrap && !fs.existsSync(baselinePath))) {
    const baseline = buildBaseline(result)
    writeBaseline(baselinePath, baseline)
    console.log(`${bootstrap && !update ? '本运行器基线已建立' : '基线已更新'} → ${relativeBaseline}`)
    for (const [key, value] of Object.entries(baseline.metrics)) console.log(`  ${key} = ${value}`)
    if (bootstrap && !update) console.log('（--bootstrap：本次仅建立基线、不判定；下一次运行开始拦截）')
    return EXIT_OK
  }

  if (!fs.existsSync(baselinePath)) {
    console.error(`${relativeBaseline} 不存在 —— 首次建基线：node scripts/perf/report.mjs --update`)
    process.exit(EXIT_INCOMPARABLE)
  }
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
  const baselineMeta = baselineMetaOf(baseline)

  const workload = checkWorkload(baselineMeta, result)
  if (!workload.comparable) {
    console.error(`${workload.reason} —— 不可比，拒绝判定`)
    process.exit(EXIT_INCOMPARABLE)
  }

  const { rows, failures, failed } = compareMetrics(baseline, result)
  const where = [baselineMeta.platform, baselineMeta.arch].filter(Boolean).join('-') || '未标注平台'

  console.log(`\n指标（seed=${result.seed}, blocks=${result.blockCount}, 基线 ${where} @ ${baselineMeta.capturedAt || '未知时间'}，退化阈值 ${Math.round(REGRESSION_LIMIT * 100)}%）：`)
  console.log(renderTable(rows))
  console.log(`\n基线：${relativeBaseline}（node ${baselineMeta.node || '未知'}）`)

  if (failed) {
    console.error(`\ncheck:perf 失败：${failures.length} 项退化 > ${Math.round(REGRESSION_LIMIT * 100)}%（${failures.map((failure) => failure.key).join(', ')}）`)
    process.exit(EXIT_REGRESSED)
  }
  console.log('\ncheck:perf 通过')
  return EXIT_OK
}

process.exitCode = main()
