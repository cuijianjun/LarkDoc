#!/usr/bin/env node
/**
 * prepack 的产物去重闸门。
 *
 * 问题是纯重复劳动：发布链路里 `check:artifacts` 已经构建过 5 个产物，
 * 紧接着 `npm pack` 触发的 `prepack` 会把同样这 5 个产物再构建一遍（约 3 分钟）。
 *
 * 这里改成「输入没变就不重建」：
 *   - 计算一份「构建输入指纹」（src/** 的路径+大小+mtime、构建配置、依赖声明）；
 *   - 指纹与上次构建后写的 stamp 一致，且 5 个产物都在 → 跳过构建；
 *   - 否则按顺序重建 5 项，成功后写回 stamp。
 *
 * 为什么不直接比 mtime：
 *   改 `package.json` 的 scripts、或改个 README，mtime 就变了，
 *   一刀切会退化成「每次都全建」。指纹只吃真正影响产物的字段
 *   （deps / peerDeps / engines / browserslist），改 scripts 不会误伤。
 *
 * 用法：
 *   node scripts/ensure-artifacts.mjs            # 智能判断（prepack 用这个）
 *   node scripts/ensure-artifacts.mjs --force    # 无条件重建
 *   node scripts/ensure-artifacts.mjs --check    # 只判定，不构建（EXIT=1 = 需重建）
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const STAMP = process.env.LARK_DOC_ARTIFACTS_STAMP || join(ROOT, '_codex', 'artifacts-stamp.json') // _codex/ 已被 .gitignore

/** 产物 → 构建脚本。顺序与原 prepack 一致，不能换（后一步可能依赖前一步产物）。 */
const ARTIFACTS = [
  { file: 'dist/lark-doc.common.js', script: 'build' },
  { file: 'dist/lark-doc.umd.min.js', script: 'build:umd' },
  { file: 'dist/lark-doc.esm.js', script: 'build:esm' },
  { file: 'dist/lark-doc-collab.esm.js', script: 'build:collab' },
  { file: 'dist/lark-doc-element.umd.min.js', script: 'build:element' }
]

/** 整文件参与指纹的构建配置 */
const CONFIG_FILES = ['vue.config.js', 'babel.config.js', 'postcss.config.js', 'jsconfig.json']

/** package.json 里只取真正影响产物的字段 */
const PKG_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'engines', 'browserslist', 'sideEffects']

const argv = process.argv.slice(2)
const FORCE = argv.includes('--force')
const CHECK_ONLY = argv.includes('--check')

const hash = createHash('sha1')

function feedFile(abs) {
  const st = statSync(abs)
  hash.update(relative(ROOT, abs) + '\0' + st.size + '\0' + Math.round(st.mtimeMs) + '\n')
}

function walkSrc(dir) {
  for (const name of readdirSync(dir).sort()) {
    if (name === 'node_modules' || name === '.git') continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walkSrc(p)
    else feedFile(p)
  }
}

// 1) 源码树
walkSrc(join(ROOT, 'src'))
// 2) 构建配置
for (const f of CONFIG_FILES) {
  const p = join(ROOT, f)
  if (existsSync(p)) feedFile(p)
}
// 3) 依赖与目标环境声明
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
for (const k of PKG_FIELDS) hash.update(k + '=' + JSON.stringify(pkg[k] ?? null) + '\n')
// 4) 跑构建用的 npm 版本（Node14 的 npm 与 Node22 的 npm 排布可能不同）
// 注意：这一项让「怎么调本脚本」也成了指纹输入 —— 裸 `node scripts/ensure-artifacts.mjs
// --check` 取不到该变量，算出的指纹与 `npm run artifacts:check` 口径必然不同。
// 判定保持保守（不同就报需重建），但报错时会点明口径，免得被误读成「源码有变动」。
const npmAgent = process.env.npm_config_user_agent || ''
hash.update('npm=' + npmAgent + '\n')

const fingerprint = hash.digest('hex')

let stamp = null
try {
  stamp = JSON.parse(readFileSync(STAMP, 'utf8'))
} catch {
  stamp = null
}

const missing = ARTIFACTS.filter((a) => !existsSync(join(ROOT, a.file)))
const sizeDrift = ARTIFACTS.filter((a) => {
  const p = join(ROOT, a.file)
  if (!existsSync(p)) return false
  const rec = stamp?.artifacts?.[a.file]
  return rec !== undefined && rec !== statSync(p).size
})

const upToDate = !FORCE && missing.length === 0 && sizeDrift.length === 0 && stamp?.fingerprint === fingerprint

if (upToDate) {
  console.log(`✓ 构建输入未变，5 个产物齐备 —— 跳过构建（指纹 ${fingerprint.slice(0, 8)}）`)
  process.exit(0)
}

const reasons = []
if (FORCE) reasons.push('--force')
if (missing.length) reasons.push(`缺 ${missing.map((m) => m.file).join(', ')}`)
if (sizeDrift.length) reasons.push(`产物被改动 ${sizeDrift.map((m) => m.file).join(', ')}`)
if (!stamp?.fingerprint) reasons.push('无构建记录')
else if (stamp.fingerprint !== fingerprint) reasons.push('源码/依赖/构建配置有变动')

if (CHECK_ONLY) {
  console.log(`✗ 需要重建产物：${reasons.join('；')}（当前指纹 ${fingerprint}）`)
  // 指纹含 npm 用户代理，绕过 npm 直调时这一项为空 —— 这时「源码有变动」是误报，
  // 会把人引去重建那 3 分钟的产物。点明口径，省一次白跑。
  if (!npmAgent) {
    console.log('  提示：本次未经 npm 调用（用户代理为空），指纹与 npm 口径不同；复验请用 `npm run artifacts:check`')
  }
  process.exit(1)
}

console.log(`→ 重建产物（${reasons.join('；')}）`)
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
for (const a of ARTIFACTS) {
  console.log(`\n$ npm run ${a.script}  →  ${a.file}`)
  const r = spawnSync(npm, ['run', a.script], { cwd: ROOT, stdio: 'inherit', env: process.env })
  if (r.status !== 0) {
    console.error(`\n✗ 构建失败：${a.script}`)
    process.exit(1)
  }
}

const after = {}
for (const a of ARTIFACTS) {
  const p = join(ROOT, a.file)
  if (!existsSync(p)) {
    console.error(`✗ 构建结束但产物不存在：${a.file}`)
    process.exit(1)
  }
  after[a.file] = statSync(p).size
}
try {
  mkdirSync(dirname(STAMP), { recursive: true })
  writeFileSync(STAMP, JSON.stringify({ fingerprint, artifacts: after, at: new Date().toISOString() }, null, 2))
} catch {
  /* stamp 写不进去只影响下次复用，不影响本次产物 */
}
console.log(`\n✓ 产物就绪（5/5，指纹 ${fingerprint.slice(0, 8)}）`)
