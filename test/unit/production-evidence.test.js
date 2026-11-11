import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { AC_IDS, ALL_AC_IDS, EVIDENCE_LEVELS, EVIDENCE_SOURCE, artifact, compareBudgets, preserveReport, validateEvidence, validateTaskIndex, sourceFiles, revision, sha256 } from '../../scripts/production-evidence.mjs'
import { PERF_METRICS } from '../../scripts/perf/gate.mjs'

const directories = []
afterEach(() => directories.splice(0).forEach(directory => fs.rmSync(directory, { recursive: true, force: true })))
const hash = 'sha256:' + 'a'.repeat(64)
const now = '2026-11-07T13:00:00Z'
function blocked() {
  return { schemaVersion: 'larkdoc-production-evidence-v1', runId: 'synthetic-evidence-unit', level: 'E0',
    levelDefinition: { definition: EVIDENCE_LEVELS.E0, source: EVIDENCE_SOURCE }, scope: 'tool-validation', status: 'BLOCKED',
    startedAt: now, endedAt: now, productionApproval: null,
    revisions: { frontend: { commit: null, dirty: null, sourceHash: hash, reason: '单测合成输入' }, backend: { commit: null, dirty: null, sourceHash: hash, reason: '单测合成输入' } },
    environment: { os: 'darwin', arch: 'x64', node: 'test-runtime', browser: null, device: 'not-executed', database: 'none', services: [] },
    identities: [], artifacts: [], steps: [], budgets: compareBudgets(null, null, null),
    claims: { realBrowserMatrix: false, durableBackend: false, nativeSafari: false, hardwareTouch: false, productionAcceptance: false, historical2703Reused: false },
    limitations: ['这是工具合成单测，不是浏览器/PG结果'], blockedReasons: ['真实浏览器尚未执行'], previousRuns: [],
    acIndex: AC_IDS.map(acId => ({ acId, status: 'BLOCKED', stepIds: [] })) }
}
describe('C15 evidence schema/真实性门（合成输入，非E2E）', () => {
  it('缺浏览器是合法BLOCKED，E0不称端到端通过；字段缺失拒绝', () => {
    expect(validateEvidence(blocked())).toEqual({ valid: true, errors: [] })
    const missing = blocked(); delete missing.environment
    expect(validateEvidence(missing).valid).toBe(false)
    const noReason = blocked(); noReason.blockedReasons = []
    expect(validateEvidence(noReason).errors).toContain('MISSING_BLOCKED_REASON')
    const fakePass = blocked(); fakePass.status = 'PASS'
    expect(validateEvidence(fakePass).errors).toContain('FALSE_PASS')
  })

  it('E0/mock不能声称真实浏览器/DB，历史2703不能当本轮证据', () => {
    const record = blocked(); record.claims.realBrowserMatrix = true; record.claims.durableBackend = true
    expect(validateEvidence(record).errors).toEqual(expect.arrayContaining(['NO_REAL_BROWSER', 'NO_REAL_DATABASE']))
    record.claims.historical2703Reused = true
    expect(validateEvidence(record).valid).toBe(false)
  })

  it('完整七AC索引和原始结果引用必需，报告不含凭证/private正文', () => {
    const record = blocked(); record.acIndex[0].stepIds = ['not-executed']
    expect(validateEvidence(record).errors).toContain('MISSING_AC_STEP:AC-15-S')
    record.steps.push({ id: 'not-executed', name: '静态输入', status: 'BLOCKED', executionType: 'static',
      startedAt: now, endedAt: now, command: [], acIds: [], rawArtifactIds: [], observed: { token: 'forbidden' }, limitations: [] })
    expect(validateEvidence(record).errors).toContain('SENSITIVE_CONTENT_IN_REPORT')
  })

  it('固定gzip预算/原20%/2000块，环境不可比或缺指标只BLOCKED', () => {
    const metrics = Object.fromEntries(Object.keys(PERF_METRICS).map(key => [key, 100]))
    const baseline = { _meta: { seed: 42, blockCount: 2000, platform: 'darwin', arch: 'x64', node: 'test-runtime' }, metrics }
    const measured = { seed: 42, blockCount: 2000, metrics: { ...metrics } }
    const env = { os: 'darwin', arch: 'x64', node: 'test-runtime' }
    const exact = compareBudgets(Buffer.from('element'), baseline, measured, env)
    expect(exact).toMatchObject({ elementGzipBytes: 475000, regressionLimit: 0.2, blockCount: 2000, approvedSlo: null, performance: { status: 'PASS' } })
    expect(compareBudgets(randomBytes(480000), baseline, measured, env).size.status).toBe('FAIL')
    expect(compareBudgets(null, baseline, { ...measured, metrics: { ...metrics, keystrokeP95Ms: 121 } }, env).performance.status).toBe('FAIL')
    expect(compareBudgets(null, baseline, { ...measured, blockCount: 500 }, env).performance.status).toBe('BLOCKED')
    expect(compareBudgets(null, baseline, measured, { ...env, node: 'different' }).performance.status).toBe('BLOCKED')
    expect(compareBudgets(null, baseline, { ...measured, metrics: {} }, env).performance.status).toBe('BLOCKED')
  })

  it('旧失败不覆盖；新结果引用旧报告hash，原文件篡改可被检测', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'larkdoc-evidence-unit-')); directories.push(directory)
    const first = blocked(); first.status = 'FAIL'
    const previous = preserveReport(directory, first)
    expect(() => preserveReport(directory, first)).toThrow()
    const next = blocked(); next.runId = 'fixed-synthetic-evidence-unit'; next.previousRuns = [{ runId: first.runId, status: 'FAIL', report: previous }]
    expect(validateEvidence(next).valid).toBe(true)
    fs.appendFileSync(previous.path, '\nchanged')
    expect(validateEvidence(next).errors).toContain('ARTIFACT_HASH_MISMATCH:' + previous.id)
  })

  it('制品必须绑定本次源指纹，不能沿用其他分支/旧制品hash', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'larkdoc-evidence-unit-')); directories.push(directory)
    const filename = path.join(directory, 'bundle.js'); fs.writeFileSync(filename, 'synthetic bundle')
    const record = blocked(); record.artifacts = [artifact(filename, 'frontend', 'element', hash)]
    expect(validateEvidence(record).valid).toBe(true)
    record.artifacts[0].sourceHash = 'sha256:' + 'b'.repeat(64)
    expect(validateEvidence(record).errors).toContain('ARTIFACT_SOURCE_MISMATCH:element')
  })
})

// E1合成文件/结果校验，不执行PG/浏览器、不代表任意任务或生产验收通过。
function taskFixture() {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'larkdoc-task-index-unit-'))); directories.push(directory)
  const frontend = path.join(directory, 'lark-doc'), backend = path.join(directory, 'lark-doc-backend'), spec = path.join(directory, 'spec')
  const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); return sha256(Buffer.from(text)) }
  const source = { sourceRoot: backend, path: 'src/app.ts', sha256: write(path.join(backend, 'src/app.ts'), 'export const actual = 1\n') }
  const frontendHash = write(path.join(frontend, 'src/app.js'), 'export const ui = 1\n')
  write(path.join(backend, '.nvmrc'), '22.13.0\n'); write(path.join(frontend, '.nvmrc'), '14.21.3\n')
  const specHash = write(path.join(spec, 'plan.md'), '# 当前合成设计\n')
  const report = { schemaVersion: 'larkdoc-task-index-v1', level: 'E2', levelDefinition: { definition: EVIDENCE_LEVELS.E2, source: EVIDENCE_SOURCE },
    sourceRoots: { frontend, backend, spec }, runs: [],
    tasks: Array.from({ length: 126 }, (_, index) => ({ taskId: `T${String(index + 1).padStart(3, '0')}`, implementation: 'not-started', localIntegration: 'NOT_RUN',
      externalAcceptance: 'BLOCKED', reason: `T${index + 1}尚无实现/执行证据；外部供给未获批准`, acIds: [ALL_AC_IDS[index % ALL_AC_IDS.length]], sourceFiles: [], refs: [] })),
    acIndex: ALL_AC_IDS.map(acId => ({ acId, fullStatus: 'BLOCKED', localCoverage: 'NOT_RUN', externalAcceptance: 'BLOCKED', reason: `${acId}外部供给未批准，未声称完整验收`, refs: [] })) }
  const raw = { passed: true, tests: [{ name: '精确原始case', passed: true }],
    inputSha256: { 'src/app.ts': source.sha256.slice(7), '../lark-doc/src/app.js': frontendHash.slice(7) } }
  const attach = () => {
    const file = path.join(backend, 'raw.json'), hash = write(file, JSON.stringify(raw))
    if (!report.runs.length) report.runs.push({ runId: 'raw-run', path: file, sha256: hash, sourceRoot: backend, kind: 'real-database', identityKind: 'synthetic-local', current: true })
    else report.runs[0].sha256 = hash
    const ref = { runId: 'raw-run', caseName: '精确原始case' }
    Object.assign(report.tasks[0], { implementation: 'local-complete', localIntegration: 'PASS', sourceFiles: [{ ...source }], refs: [ref] })
    Object.assign(report.acIndex[0], { localCoverage: 'PASS', refs: [ref] })
    return report
  }
  return { directory, frontend, backend, spec, write, report, raw, attach, source, specHash }
}

describe('T124/T126 126task/105AC索引（E1工具合成输入）', () => {
  it('默认AC_IDS仍严格7项；全量索引不冒充legacy C15报告', () => {
    expect(AC_IDS).toHaveLength(7); expect(ALL_AC_IDS).toHaveLength(105); expect(new Set(ALL_AC_IDS).size).toBe(105)
    expect(ALL_AC_IDS.slice(-7)).toEqual(AC_IDS)
    const legacy = blocked(); legacy.acIndex = ALL_AC_IDS.map(acId => ({ acId, status: 'BLOCKED', stepIds: [] }))
    expect(validateEvidence(legacy).valid).toBe(false)
    const f = taskFixture(); expect(validateTaskIndex(f.report)).toEqual({ valid: true, errors: [] })
    Object.assign(f.report.tasks[1], { implementation: 'local-complete', sourceFiles: [{ sourceRoot: f.spec, path: 'plan.md', sha256: f.specHash }] })
    expect(validateTaskIndex(f.report)).toEqual({ valid: true, errors: [] })
    expect(f.report.tasks[1].localIntegration).toBe('NOT_RUN')
  })

  it('精确case/raw JSON/hash/显式根及backend→frontend来源都一致才可本地PASS', () => {
    const f = taskFixture(); expect(validateTaskIndex(f.attach())).toEqual({ valid: true, errors: [] })
    expect(f.report.acIndex[0].fullStatus).toBe('BLOCKED')
    f.report.tasks[0].refs[0].caseName = '精确原始'
    expect(validateTaskIndex(f.report).errors).toContain('MISSING_CASE:T001:raw-run:精确原始')
  })

  it.each(['missing-task', 'duplicate-task', 'unknown-task', 'missing-ac', 'duplicate-ac', 'unknown-ac'])('拒绝缺失/重复/虚构任务或AC %s', kind => {
    const f = taskFixture(), value = f.report
    if (kind === 'missing-task') value.tasks.pop()
    if (kind === 'duplicate-task') value.tasks[125].taskId = 'T001'
    if (kind === 'unknown-task') value.tasks[125].taskId = 'T127'
    if (kind === 'missing-ac') value.acIndex.pop()
    if (kind === 'duplicate-ac') value.acIndex[104].acId = ALL_AC_IDS[0]
    if (kind === 'unknown-ac') value.acIndex[104].acId = 'AC-16-S'
    expect(validateTaskIndex(value).valid).toBe(false)
  })

  it.each(['run-failed', 'case-failed', 'duplicate-case', 'missing-case', 'raw-hash', 'missing-fingerprint'])('原始失败/缺case/重复名/原JSON篡改不得算当前PASS %s', kind => {
    const f = taskFixture()
    if (kind === 'run-failed') f.raw.passed = false
    if (kind === 'case-failed') f.raw.tests[0].passed = false
    if (kind === 'duplicate-case') f.raw.tests.push({ ...f.raw.tests[0] })
    if (kind === 'missing-case') f.raw.tests = []
    if (kind === 'missing-fingerprint') delete f.raw.inputSha256
    f.attach()
    if (kind === 'raw-hash') fs.appendFileSync(f.report.runs[0].path, '\n')
    expect(validateTaskIndex(f.report).valid).toBe(false)
  })

  it.each(['sources', 'sourceHashes', 'inputSha256'])('支持三种真实原报告指纹格式，旧source不能升当前PASS %s', kind => {
    const f = taskFixture(), inputs = f.raw.inputSha256; delete f.raw.inputSha256
    if (kind === 'sources') f.raw.sources = Object.entries(inputs).map(([file, hash]) => ({ path: path.resolve(f.backend, file), sha256: hash, sha256After: hash }))
    else f.raw[kind] = inputs
    f.attach(); expect(validateTaskIndex(f.report).valid).toBe(true)
    f.write(path.join(f.backend, 'src/app.ts'), 'changed current source\n')
    expect(validateTaskIndex(f.report).errors).toContain('RUN_SOURCE_STALE:raw-run:src/app.ts'.replace('src/app.ts', kind === 'sources' ? path.join(f.backend, 'src/app.ts') : 'src/app.ts'))
    expect(validateTaskIndex(f.report).errors).toContain('STALE_REFERENCE:T001:raw-run')
  })

  it('compiledHashes同样逐个核对；执行前后source变化也不属于单一源码', () => {
    const f = taskFixture(), file = path.join(f.backend, 'dist/src/app.js')
    f.raw.sourceHashes = f.raw.inputSha256; delete f.raw.inputSha256
    f.raw.compiledHashes = { 'dist/src/app.js': f.write(file, 'actual compiled\n').slice(7) }
    f.attach(); expect(validateTaskIndex(f.report).valid).toBe(true)
    f.write(file, 'changed compiled\n')
    expect(validateTaskIndex(f.report).errors).toContain('RUN_SOURCE_STALE:raw-run:dist/src/app.js')
    const other = taskFixture(); other.raw.sources = [{ path: 'src/app.ts', sha256: other.source.sha256, sha256After: hash }]
    other.attach(); expect(validateTaskIndex(other.report).valid).toBe(false)
  })

  it.each(['sources', 'sourceHashes', 'compiledHashes'])('畸形%s不能被另一个合法inputSha256掩盖', key => {
    const f = taskFixture(); f.raw[key] = key === 'sources' ? {} : []
    f.attach(); expect(validateTaskIndex(f.report).errors).toContain('RUN_SOURCES_INVALID:raw-run')
  })

  it('historical current:false只能说明局部/阻塞，不能作为当前PASS；不足proof的PARTIAL需明确理由', () => {
    const f = taskFixture(); f.attach(); f.report.runs[0].current = false
    expect(validateTaskIndex(f.report).errors).toContain('STALE_REFERENCE:T001:raw-run')
    f.report.tasks[0].localIntegration = 'PARTIAL'; f.report.acIndex[0].localCoverage = 'PARTIAL'
    expect(validateTaskIndex(f.report).valid).toBe(true)
    f.report.tasks[0].reason = '  '
    expect(validateTaskIndex(f.report).errors).toContain('MISSING_REASON:T001')
  })

  it('仅整报告/异run/重复ref无精确case都不能证明AC', () => {
    const f = taskFixture(); f.attach(); f.report.acIndex[0].refs = []
    expect(validateTaskIndex(f.report).errors).toContain('UNPROVEN_LOCAL:' + ALL_AC_IDS[0])
    f.report.acIndex[0].refs = [{ runId: 'foreign', caseName: '精确原始case' }]
    expect(validateTaskIndex(f.report).errors).toContain(`MISSING_RUN:${ALL_AC_IDS[0]}:foreign`)
    f.report.tasks[0].refs.push({ ...f.report.tasks[0].refs[0] })
    expect(validateTaskIndex(f.report).errors).toContain('DUPLICATE_REFERENCE:T001')
  })

  it('显式根之外或符号链接不能绕过当前来源校验', () => {
    const f = taskFixture(); f.raw.inputSha256['../../outside.ts'] = hash.slice(7); f.attach()
    expect(validateTaskIndex(f.report).errors).toContain('SOURCE_OUTSIDE_ROOTS:raw-run:../../outside.ts')
    const linked = taskFixture(); fs.symlinkSync(path.join(linked.backend, 'src/app.ts'), path.join(linked.backend, 'src/alias.ts'))
    linked.raw.inputSha256['src/alias.ts'] = linked.source.sha256.slice(7); linked.attach()
    expect(validateTaskIndex(linked.report).errors).toContain('SOURCE_SYMLINK_UNATTESTED:raw-run:src/alias.ts')
    const alias = path.join(linked.directory, 'root-alias'); fs.symlinkSync(linked.frontend, alias)
    linked.report.sourceRoots.frontend = alias
    expect(validateTaskIndex(linked.report).errors).toContain('INVALID_SOURCE_ROOT:' + alias)
  })

  it('不能用只hash无关文件的测试报告证明当前实现，任务源码本身也要复核', () => {
    const f = taskFixture(); delete f.raw.inputSha256['src/app.ts']; f.attach()
    expect(validateTaskIndex(f.report).errors).toContain('SOURCE_NOT_COVERED:T001:src/app.ts')
    f.report.tasks[0].sourceFiles[0].sha256 = hash
    expect(validateTaskIndex(f.report).errors).toContain('TASK_SOURCE_STALE:T001:src/app.ts')
  })

  it('synthetic浏览器不能升级真实公司/E3或生产验收；真实外部也须原报告身份/批准证明', () => {
    const f = taskFixture(); f.attach(); f.report.runs[0].kind = 'real-browser'
    f.report.level = 'E3'; f.report.levelDefinition.definition = EVIDENCE_LEVELS.E3
    Object.assign(f.report.acIndex[0], { fullStatus: 'PASS', externalAcceptance: 'VERIFIED' })
    expect(validateTaskIndex(f.report).errors).toContain('SYNTHETIC_IS_NOT_FULL_ACCEPTANCE:' + ALL_AC_IDS[0])
    f.report.runs[0].identityKind = 'real-idp-test'
    expect(validateTaskIndex(f.report).errors).toContain('UNATTESTED_IDENTITY:raw-run')
    f.raw.identities = [{ kind: 'real-idp-test' }]; f.attach()
    expect(validateTaskIndex(f.report).valid).toBe(true)
    f.report.level = 'E4'; f.report.levelDefinition.definition = EVIDENCE_LEVELS.E4
    expect(validateTaskIndex(f.report).errors).toContain('NO_APPROVED_PRODUCTION_OBSERVATION:' + ALL_AC_IDS[0])
  })

  it('sourceFiles含真实runtimepin，.nvmrc变更改变revision指纹且不放过pin symlink', () => {
    const f = taskFixture(); expect(sourceFiles(f.backend)).toContain('.nvmrc')
    const before = revision(f.backend).sourceHash
    f.write(path.join(f.backend, '.nvmrc'), 'different-runtime\n')
    expect(revision(f.backend).sourceHash).not.toBe(before)
    fs.unlinkSync(path.join(f.backend, '.nvmrc')); fs.symlinkSync(path.join(f.frontend, '.nvmrc'), path.join(f.backend, '.nvmrc'))
    expect(() => sourceFiles(f.backend)).toThrowError('SOURCE_SYMLINK_UNATTESTED:.nvmrc')
  })
})
