/** C15证据工具：只记录真实执行类型，复用原性能门禁，不启动浏览器或数据库。 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { REGRESSION_LIMIT, PERF_METRICS, checkWorkload, compareMetrics } from './perf/gate.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
function resolveBackendRoot() {
  const candidates = [
    process.env.LARK_DOC_BACKEND_ROOT,
    path.resolve(root, '../lark-doc-backend'),
    path.resolve(root, '../../tiptap-integration-demos/apps/lark-doc-backend'),
  ].filter(Boolean)
  return candidates.find(directory => fs.existsSync(path.join(directory, 'test/evidence/schema.json'))) || candidates[1]
}
function defaultEvidenceSchemaPath() { return path.join(resolveBackendRoot(), 'test/evidence/schema.json') }
export const EVIDENCE_LEVELS = Object.freeze({ E0: '文档静态', E1: '单元/mock', E2: '真实协议/DB集成', E3: '真实账号浏览器/故障', E4: '批准生产观测' })
export const EVIDENCE_SOURCE = '.specify/memory/constitution.md:29'
export const AC_IDS = Object.freeze(['AC-15-S', 'AC-15-F', 'AC-15-A', 'AC-15-C', 'AC-15-D', 'AC-15-R', 'AC-15-Q'])
export const ALL_AC_IDS = Object.freeze(Array.from({ length: 15 }, (_, index) =>
  ['S', 'F', 'A', 'C', 'D', 'R', 'Q'].map(kind => `AC-${String(index + 1).padStart(2, '0')}-${kind}`)).flat())
const TASK_IDS = Object.freeze(Array.from({ length: 126 }, (_, index) => `T${String(index + 1).padStart(3, '0')}`))
export const sha256 = value => 'sha256:' + createHash('sha256').update(value).digest('hex')
export const MATRIX = Object.freeze(['chromium', 'safari-native', 'touch-hardware'].flatMap(browser =>
  ['element', 'facade'].flatMap(entry => ['edit', 'suggest', 'read'].map(mode => Object.freeze({ id: `${browser}/${entry}/${mode}`, browser, entry, mode })))))

export function artifact(file, role, id, sourceHash) {
  const bytes = fs.readFileSync(file)
  return { id, role, path: path.resolve(file), sha256: sha256(bytes), bytes: bytes.length, ...(sourceHash ? { sourceHash } : {}) }
}
export function sourceFiles(directory) {
  const files = []
  const walk = relative => {
    for (const entry of fs.readdirSync(path.join(directory, relative), { withFileTypes: true })) {
      const name = path.join(relative, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`SOURCE_SYMLINK_UNATTESTED:${name}`)
      if (entry.isDirectory()) walk(name)
      else if (entry.isFile()) files.push(name)
    }
  }
  if (fs.existsSync(path.join(directory, 'src'))) {
    if (fs.lstatSync(path.join(directory, 'src')).isSymbolicLink()) throw new Error('SOURCE_SYMLINK_UNATTESTED:src')
    walk('src')
  }
  for (const file of ['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'vue.config.js', 'rollup.config.js', 'tsconfig.json', '.nvmrc', '.node-version', '.tool-versions']) if (fs.existsSync(path.join(directory, file))) {
    if (fs.lstatSync(path.join(directory, file)).isSymbolicLink()) throw new Error(`SOURCE_SYMLINK_UNATTESTED:${file}`)
    files.push(file)
  }
  return files.sort()
}
export function revision(directory) {
  const sourceHash = sha256(sourceFiles(directory).map(file => file + '\0' + sha256(fs.readFileSync(path.join(directory, file)))).join('\n'))
  try {
    const run = args => execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    return { commit: run(['rev-parse', 'HEAD']), dirty: Boolean(run(['status', '--porcelain'])), sourceHash, reason: null }
  } catch { return { commit: null, dirty: null, sourceHash, reason: '目录无可用Git基线；以本次源文件指纹标识，不编造提交' } }
}
export function compareBudgets(elementBytes, baseline, measured, environment = {}) {
  const size = elementBytes ? gzipSync(elementBytes, { level: 9 }).length : null
  const sizeResult = { status: size === null ? 'BLOCKED' : size <= 475000 ? 'PASS' : 'FAIL', actual: size,
    detail: size === null ? '缺Element实际制品' : '原Element gzip(level=9)预算≤475000 B，未放宽' }
  const workload = checkWorkload(baseline && baseline._meta, measured)
  const meta = baseline && baseline._meta
  const complete = baseline && measured && Object.keys(PERF_METRICS).every(key => Number.isFinite(baseline.metrics && baseline.metrics[key]) && baseline.metrics[key] > 0 && Number.isFinite(measured.metrics && measured.metrics[key]) && measured.metrics[key] >= 0)
  const comparable = workload.comparable && meta && meta.blockCount === 2000 && meta.seed === 42 &&
    complete && environment.os === meta.platform && environment.arch === meta.arch && environment.node === meta.node
  const comparison = comparable ? compareMetrics(baseline, measured) : null
  return { elementGzipBytes: 475000, regressionLimit: REGRESSION_LIMIT, seed: 42, blockCount: 2000, approvedSlo: null,
    size: sizeResult, performance: { status: !comparison ? 'BLOCKED' : comparison.failed ? 'FAIL' : 'PASS',
      actual: null, comparison, detail: comparison ? '复用scripts/perf/gate.mjs固定>20%门禁' : workload.reason || '环境/运行器或原2000块基线不可比，不填合成性能结果' } }
}
function sensitive(value) {
  if (!value || typeof value !== 'object') return false
  return Object.entries(value).some(([key, item]) => /^(token|cookie|authorization|password|secret|privateBody|privateText|contentJson|payloadBase64)$/i.test(key) || sensitive(item))
}
export function validateEvidence(report, { verifyArtifacts = true, schemaPath = defaultEvidenceSchemaPath() } = {}) {
  const errors = []
  try {
    // 复用现有Webpack依赖中的Ajv；独立实例避免共享校验器重复注册同$id。
    const Ajv = require('ajv')
    const validateSchema = new Ajv({ allErrors: true }).compile(JSON.parse(fs.readFileSync(schemaPath, 'utf8')))
    if (!validateSchema(report)) return { valid: false, errors: validateSchema.errors.map(error => 'SCHEMA:' + error.dataPath + ':' + error.message) }
  } catch (error) { return { valid: false, errors: ['SCHEMA:' + error.message] } }
  const artifactIds = new Set(report.artifacts.map(item => item.id))
  const stepIds = new Set(report.steps.map(item => item.id))
  if (artifactIds.size !== report.artifacts.length || stepIds.size !== report.steps.length) errors.push('DUPLICATE_IDS')
  if (report.levelDefinition.definition !== EVIDENCE_LEVELS[report.level]) errors.push('LEVEL_DEFINITION_MISMATCH')
  if (report.status === 'BLOCKED' && !report.blockedReasons.length) errors.push('MISSING_BLOCKED_REASON')
  if (Date.parse(report.endedAt) < Date.parse(report.startedAt)) errors.push('INVALID_RUN_TIME')
  if (sensitive(report)) errors.push('SENSITIVE_CONTENT_IN_REPORT')
  for (const step of report.steps) {
    if (Date.parse(step.endedAt) < Date.parse(step.startedAt) || Date.parse(step.startedAt) < Date.parse(report.startedAt) || Date.parse(step.endedAt) > Date.parse(report.endedAt)) errors.push(`INVALID_STEP_TIME:${step.id}`)
    if (step.rawArtifactIds.some(id => !artifactIds.has(id))) errors.push(`MISSING_RAW_ARTIFACT:${step.id}`)
    if (step.status === 'PASS' && ['real-browser', 'real-database', 'fault-injection', 'hardware-device'].includes(step.executionType) && !step.rawArtifactIds.length) errors.push(`NO_RAW_RESULT:${step.id}`)
  }
  if (new Set(report.acIndex.map(item => item.acId)).size !== AC_IDS.length) errors.push('INCOMPLETE_AC_INDEX')
  for (const item of report.acIndex) {
    if (item.stepIds.some(id => !stepIds.has(id))) errors.push(`MISSING_AC_STEP:${item.acId}`)
    if (item.status === 'PASS' && (!item.stepIds.length || item.stepIds.some(id => report.steps.find(step => step.id === id).status !== 'PASS'))) errors.push(`UNPROVEN_AC:${item.acId}`)
  }
  if (report.status === 'PASS' && (report.blockedReasons.length || report.steps.some(step => step.status !== 'PASS') || report.acIndex.some(item => item.status !== 'PASS') || report.budgets.size.status !== 'PASS' || report.budgets.performance.status !== 'PASS')) errors.push('FALSE_PASS')
  const passed = report.steps.filter(step => step.status === 'PASS')
  for (const step of passed.filter(step => step.observed && step.observed.matrixCell)) {
    const cell = MATRIX.find(cell => cell.id === step.observed.matrixCell)
    if (!cell || step.observed.entry !== cell.entry || step.observed.mode !== cell.mode) errors.push(`INVALID_MATRIX_CELL:${step.id}`)
  }
  if ((report.claims.realBrowserMatrix || report.claims.nativeSafari || report.claims.hardwareTouch) && !passed.some(step => ['real-browser', 'hardware-device'].includes(step.executionType))) errors.push('NO_REAL_BROWSER')
  if (report.claims.realBrowserMatrix && MATRIX.some(cell => !passed.some(step => step.observed && step.observed.matrixCell === cell.id))) errors.push('INCOMPLETE_BROWSER_MATRIX')
  if (report.claims.nativeSafari && !passed.some(step => step.observed && step.observed.browser && step.observed.browser.name === 'Safari' && step.observed.browser.automation === 'native-safaridriver' && step.observed.browser.native === true)) errors.push('WEBKIT_IS_NOT_SAFARI')
  if (report.claims.hardwareTouch && !passed.some(step => step.executionType === 'hardware-device' && step.observed && step.observed.device === 'touch-hardware')) errors.push('EMULATION_IS_NOT_HARDWARE')
  if (report.claims.durableBackend && !passed.some(step => step.executionType === 'real-database')) errors.push('NO_REAL_DATABASE')
  if (report.level === 'E0' && report.steps.some(step => !['static', 'not-executed'].includes(step.executionType))) errors.push('E0_IS_NOT_EXECUTION')
  if (report.level === 'E1' && report.steps.some(step => !['static', 'unit', 'injected-port', 'in-memory', 'not-executed'].includes(step.executionType))) errors.push('E1_IS_NOT_INTEGRATION')
  if (['E3', 'E4'].includes(report.level) && report.status === 'PASS' && (!report.identities.length || report.identities.some(identity => !['real-idp-test', 'production-approved'].includes(identity.kind)))) errors.push('SYNTHETIC_IDENTITY_IS_NOT_REAL_ACCOUNT_ACCEPTANCE')
  if (report.level === 'E4' && report.status === 'PASS' && (!report.productionApproval || !passed.some(step => step.executionType === 'approved-production-observation'))) errors.push('NO_APPROVED_PRODUCTION_OBSERVATION')
  for (const item of [...report.artifacts, ...report.previousRuns.map(previous => previous.report)]) {
    if (['frontend', 'backend'].includes(item.role) && item.sourceHash !== report.revisions[item.role].sourceHash) errors.push(`ARTIFACT_SOURCE_MISMATCH:${item.id}`)
    if (verifyArtifacts) {
      try {
        const actual = artifact(item.path, item.role, item.id)
        if (actual.sha256 !== item.sha256 || actual.bytes !== item.bytes) errors.push(`ARTIFACT_HASH_MISMATCH:${item.id}`)
      } catch { errors.push(`ARTIFACT_UNAVAILABLE:${item.id}`) }
    }
  }
  return { valid: errors.length === 0, errors }
}

const indexHash = value => typeof value === 'string' && /^(?:sha256:)?[a-f0-9]{64}$/.test(value) ? 'sha256:' + value.replace(/^sha256:/, '') : null
const indexPassed = value => value && (value.passed === true && (value.status === undefined || value.status === 'PASS') || value.passed === undefined && value.status === 'PASS')
function indexSource(sourceRoot, file, roots) {
  if (!roots.includes(sourceRoot)) throw new Error('UNDECLARED_SOURCE_ROOT')
  const absolute = path.resolve(sourceRoot, file)
  const owner = roots.find(directory => absolute.startsWith(directory + path.sep))
  if (!owner) throw new Error('SOURCE_OUTSIDE_ROOTS')
  let current = owner
  for (const part of path.relative(owner, absolute).split(path.sep)) {
    current = path.join(current, part)
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error('SOURCE_SYMLINK_UNATTESTED')
  }
  if (!fs.statSync(absolute).isFile()) throw new Error('SOURCE_NOT_FILE')
  return absolute
}

/** 独立任务索引只校验已有原始结果，不执行测试、不修改tasks、不生成报告目录。 */
export function validateTaskIndex(report, { schemaPath = defaultEvidenceSchemaPath() } = {}) {
  const errors = [], runs = new Map(), roots = []
  try {
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8')), Ajv = require('ajv')
    const validate = new Ajv({ allErrors: true }).compile({ definitions: schema.definitions, $ref: '#/definitions/taskIndex' })
    if (!validate(report)) return { valid: false, errors: validate.errors.map(error => 'TASK_SCHEMA:' + error.dataPath + ':' + error.message) }
  } catch (error) { return { valid: false, errors: ['TASK_SCHEMA:' + error.message] } }
  if (report.levelDefinition.definition !== EVIDENCE_LEVELS[report.level]) errors.push('LEVEL_DEFINITION_MISMATCH')
  if (sensitive(report)) errors.push('SENSITIVE_CONTENT_IN_REPORT')
  for (const directory of Object.values(report.sourceRoots)) {
    try {
      if (!path.isAbsolute(directory) || path.resolve(directory) !== directory || fs.realpathSync(directory) !== directory || !fs.statSync(directory).isDirectory()) throw new Error('INVALID_SOURCE_ROOT')
      roots.push(directory)
    } catch { errors.push(`INVALID_SOURCE_ROOT:${directory}`) }
  }
  if (new Set(roots).size !== roots.length) errors.push('DUPLICATE_SOURCE_ROOT')
  const checkIds = (items, key, expected, label) => {
    const actual = items.map(item => item[key]), seen = new Set(actual)
    if (seen.size !== actual.length) errors.push(`DUPLICATE_${label}_IDS`)
    if (expected.some(id => !seen.has(id))) errors.push(`INCOMPLETE_${label}_INDEX`)
    actual.filter(id => !expected.includes(id)).forEach(id => errors.push(`UNKNOWN_${label}:${id}`))
  }
  checkIds(report.tasks, 'taskId', TASK_IDS, 'TASK'); checkIds(report.acIndex, 'acId', ALL_AC_IDS, 'AC')
  for (const run of report.runs) {
    if (runs.has(run.runId)) { errors.push(`DUPLICATE_RUN:${run.runId}`); continue }
    const info = { ...run, sources: new Map(), cases: new Map(), passed: false, currentMatch: true, identityVerified: false, productionVerified: false }
    runs.set(run.runId, info)
    try {
      if (!roots.includes(run.sourceRoot)) throw new Error('UNDECLARED_SOURCE_ROOT')
      if (!path.isAbsolute(run.path) || fs.realpathSync(run.path) !== path.resolve(run.path) || !fs.statSync(run.path).isFile()) throw new Error('RUN_PATH_UNSAFE')
      const bytes = fs.readFileSync(run.path)
      if (sha256(bytes) !== run.sha256) throw new Error('RUN_HASH_MISMATCH')
      const raw = JSON.parse(bytes.toString('utf8'))
      if (!Array.isArray(raw.tests)) throw new Error('RUN_CASES_MISSING')
      info.passed = Boolean(indexPassed(raw))
      for (const item of raw.tests) {
        if (!item || typeof item.name !== 'string' || !item.name.trim()) throw new Error('RUN_CASE_INVALID')
        if (info.cases.has(item.name)) throw new Error('DUPLICATE_CASE_NAME')
        info.cases.set(item.name, Boolean(indexPassed(item)))
      }
      const kinds = Array.isArray(raw.identities) ? raw.identities.map(identity => identity.kind) : []
      info.identityVerified = ['real-idp-test', 'production-approved'].includes(run.identityKind) && kinds.includes(run.identityKind)
      if (['real-idp-test', 'production-approved'].includes(run.identityKind) && !info.identityVerified) throw new Error('UNATTESTED_IDENTITY')
      info.productionVerified = info.identityVerified && run.identityKind === 'production-approved' && run.kind === 'approved-production-observation' &&
        raw.level === 'E4' && raw.productionApproval && typeof raw.productionApproval.reference === 'string' && Boolean(raw.productionApproval.reference.trim()) &&
        typeof raw.productionApproval.scope === 'string' && Boolean(raw.productionApproval.scope.trim()) && Number.isFinite(Date.parse(raw.productionApproval.approvedAt))
      const fingerprints = []
      if (raw.sources !== undefined && !Array.isArray(raw.sources)) throw new Error('RUN_SOURCES_INVALID')
      if (Array.isArray(raw.sources)) fingerprints.push(...raw.sources.map(item => ({ file: item.path, hash: item.sha256, after: item.sha256After })))
      for (const key of ['sourceHashes', 'compiledHashes', 'inputSha256']) {
        if (raw[key] !== undefined && (!raw[key] || typeof raw[key] !== 'object' || Array.isArray(raw[key]))) throw new Error('RUN_SOURCES_INVALID')
        if (raw[key] && typeof raw[key] === 'object' && !Array.isArray(raw[key])) fingerprints.push(...Object.entries(raw[key]).map(([file, hash]) => ({ file, hash })))
      }
      if (!fingerprints.length && run.current) throw new Error('RUN_SOURCES_MISSING')
      for (const fingerprint of fingerprints) {
        try {
          const expected = indexHash(fingerprint.hash)
          if (!expected || (fingerprint.after !== undefined && indexHash(fingerprint.after) !== expected)) throw new Error('RUN_SOURCE_CHANGED_DURING_EXECUTION')
          const file = indexSource(run.sourceRoot, fingerprint.file, roots)
          if (info.sources.has(file) && info.sources.get(file) !== expected) throw new Error('CONFLICTING_SOURCE_HASH')
          info.sources.set(file, expected)
          if (sha256(fs.readFileSync(file)) !== expected) throw new Error('RUN_SOURCE_STALE')
        } catch (error) {
          info.currentMatch = false
          if (run.current) errors.push(`${error.message}:${run.runId}:${fingerprint.file}`)
        }
      }
    } catch (error) { info.currentMatch = false; errors.push(`${error.message}:${run.runId}`) }
  }
  const references = (refs, id, mustPass) => {
    const seen = new Set(), selected = []
    if (mustPass && !refs.length) errors.push(`UNPROVEN_LOCAL:${id}`)
    for (const ref of refs) {
      const key = JSON.stringify([ref.runId, ref.caseName]), run = runs.get(ref.runId)
      if (seen.has(key)) errors.push(`DUPLICATE_REFERENCE:${id}`)
      seen.add(key)
      if (!run) { errors.push(`MISSING_RUN:${id}:${ref.runId}`); continue }
      if (!run.cases.has(ref.caseName)) { errors.push(`MISSING_CASE:${id}:${ref.runId}:${ref.caseName}`); continue }
      selected.push(run)
      if (mustPass && (!run.current || !run.currentMatch)) errors.push(`STALE_REFERENCE:${id}:${ref.runId}`)
      if (mustPass && (!run.passed || !run.cases.get(ref.caseName))) errors.push(`FAILED_REFERENCE:${id}:${ref.runId}:${ref.caseName}`)
    }
    return selected
  }
  const external = (status, refs, id) => {
    if (status === 'VERIFIED' && !refs.some(run => run.current && run.currentMatch && run.passed && run.identityVerified)) errors.push(`UNPROVEN_EXTERNAL:${id}`)
  }
  for (const task of report.tasks) {
    if (!task.reason.trim()) errors.push(`MISSING_REASON:${task.taskId}`)
    if (!task.acIds.length || task.acIds.some(id => !ALL_AC_IDS.includes(id))) errors.push(`INVALID_TASK_AC_MAPPING:${task.taskId}`)
    const pass = task.localIntegration === 'PASS', verified = task.externalAcceptance === 'VERIFIED'
    const selected = references(task.refs, task.taskId, pass || verified)
    external(task.externalAcceptance, selected, task.taskId)
    if (pass && task.implementation !== 'local-complete') errors.push(`INCOMPLETE_IMPLEMENTATION:${task.taskId}`)
    if (task.implementation === 'local-complete' && !task.sourceFiles.length) errors.push(`MISSING_IMPLEMENTATION_SOURCE:${task.taskId}`)
    const sourceIds = new Set()
    for (const source of task.sourceFiles) {
      try {
        const file = indexSource(source.sourceRoot, source.path, roots)
        if (sourceIds.has(file)) errors.push(`DUPLICATE_TASK_SOURCE:${task.taskId}`)
        sourceIds.add(file)
        if (sha256(fs.readFileSync(file)) !== source.sha256) errors.push(`TASK_SOURCE_STALE:${task.taskId}:${source.path}`)
        if (pass && !selected.some(run => run.sources.get(file) === source.sha256)) errors.push(`SOURCE_NOT_COVERED:${task.taskId}:${source.path}`)
      } catch (error) { errors.push(`${error.message}:${task.taskId}:${source.path}`) }
    }
  }
  for (const ac of report.acIndex) {
    if (!ac.reason.trim()) errors.push(`MISSING_REASON:${ac.acId}`)
    if (!report.tasks.some(task => task.acIds.includes(ac.acId))) errors.push(`UNMAPPED_AC:${ac.acId}`)
    const full = ac.fullStatus === 'PASS', pass = ac.localCoverage === 'PASS'
    const selected = references(ac.refs, ac.acId, full || pass || ac.externalAcceptance === 'VERIFIED')
    external(ac.externalAcceptance, selected, ac.acId)
    if (full && (!pass || ac.externalAcceptance === 'BLOCKED')) errors.push(`FALSE_FULL_PASS:${ac.acId}`)
    if (full && ['E3', 'E4'].includes(report.level) && !selected.some(run => run.identityVerified && run.current && run.currentMatch)) errors.push(`SYNTHETIC_IS_NOT_FULL_ACCEPTANCE:${ac.acId}`)
    if (full && report.level === 'E4' && !selected.some(run => run.productionVerified && run.current && run.currentMatch)) errors.push(`NO_APPROVED_PRODUCTION_OBSERVATION:${ac.acId}`)
  }
  if (report.level === 'E0' && report.runs.some(run => run.current && run.kind !== 'static')) errors.push('E0_IS_NOT_EXECUTION')
  if (report.level === 'E1' && report.runs.some(run => run.current && !['static', 'unit', 'injected-port', 'in-memory'].includes(run.kind))) errors.push('E1_IS_NOT_INTEGRATION')
  return { valid: errors.length === 0, errors }
}
export function preserveReport(directory, report) {
  if (sensitive(report)) throw new Error('SENSITIVE_CONTENT_IN_REPORT')
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const filename = path.join(directory, `${report.runId}.json`)
  fs.writeFileSync(filename, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  return artifact(filename, 'raw-report', report.runId)
}
export function createEvidence({ frontend = root, backend = resolveBackendRoot(), level = 'E2', scope = 'p0-increment' } = {}) {
  const now = new Date().toISOString()
  return { schemaVersion: 'larkdoc-production-evidence-v1', runId: 'us15-' + randomUUID(), level,
    levelDefinition: { definition: EVIDENCE_LEVELS[level], source: EVIDENCE_SOURCE }, scope, status: 'BLOCKED', productionApproval: null,
    startedAt: now, endedAt: now, revisions: { frontend: revision(frontend), backend: revision(backend) },
    environment: { os: process.platform, arch: process.arch, node: process.version, browser: null, device: 'not-executed', database: 'none', services: [] },
    identities: [], artifacts: [], steps: [], budgets: compareBudgets(null, null, null),
    claims: { realBrowserMatrix: false, durableBackend: false, nativeSafari: false, hardwareTouch: false, productionAcceptance: false, historical2703Reused: false },
    limitations: ['本工具不批准生产发布、容量、SLO或HA/RPO/RTO；历史2703不计本轮验收'], blockedReasons: [], previousRuns: [],
    acIndex: AC_IDS.map(acId => ({ acId, status: 'BLOCKED', stepIds: [] })) }
}
