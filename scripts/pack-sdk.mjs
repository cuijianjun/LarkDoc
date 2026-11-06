#!/usr/bin/env node
// Public packages share the host runtime; private intranet packages carry a complete tree.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const semver = require('semver')
const usage = 'Usage: node scripts/pack-sdk.mjs --out NEW_DIR [--work NEW_DIR] [--node14 PATH] [--archives-cache ARCHIVE_BUNDLE_DIR] [--skip-build] [--intranet-version BASE-intranet.N]'
const args = {}
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i].replace(/^--/, '')
  if (key === 'help' || key === 'h') { console.log(usage); process.exit(0) }
  if (args[key]) throw Error('Duplicate argument: --' + key)
  if (key === 'skip-build') { args[key] = true; continue }
  if (!['out', 'work', 'node14', 'archives-cache', 'intranet-version'].includes(key) || !process.argv[i + 1] || process.argv[i + 1].startsWith('--')) throw Error(usage)
  const value = process.argv[++i]
  args[key] = key === 'intranet-version' ? value : path.resolve(value)
}
if (!args.out) throw Error('Missing --out')
if (Number(process.versions.node.split('.')[0]) < 22) throw Error('Packaging requires Node.js 22+; library builds use the separately pinned Node.js 14 runtime')
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const digest = (bytes, algorithm, encoding = 'hex') => crypto.createHash(algorithm).update(bytes).digest(encoding)
const contained = (base, file) => file === base || file.startsWith(base + path.sep)
function canonicalNewPath(directory) {
  let existing = directory
  const suffix = []
  while (!fs.existsSync(existing)) {
    suffix.unshift(path.basename(existing))
    const parent = path.dirname(existing)
    if (parent === existing) throw Error('No existing output ancestor: ' + directory)
    existing = parent
  }
  return path.join(fs.realpathSync(existing), ...suffix)
}
const out = canonicalNewPath(args.out)
const work = canonicalNewPath(args.work || out + '.work')
for (const directory of [out, work]) {
  if (contained(root, directory) || contained(directory, root)) throw Error('Output and work must be outside the source repository')
  if (fs.existsSync(directory)) throw Error('Output and work directories must be new: ' + directory)
}
if (contained(out, work) || contained(work, out)) throw Error('Output and work directories must be separate')
const manifest = json(path.join(root, 'package.json'))
const lock = json(path.join(root, 'package-lock.json'))
if (lock.version !== manifest.version || lock.packages[''].version !== manifest.version) throw Error('Source manifest and lock versions differ')
const intranetVersion = args['intranet-version']
if (intranetVersion && (!semver.valid(intranetVersion) || !new RegExp('^' + manifest.version.replace(/\./g, '\\.') + '-intranet\\.\\d+$').test(intranetVersion))) throw Error('Use --intranet-version ' + manifest.version + '-intranet.N for a self-contained private SDK')
const modules = fs.realpathSync(path.join(root, 'node_modules'))
if (modules !== path.join(root, 'node_modules')) throw Error('Use the source repository installation, not linked node_modules')
const pinned = fs.readFileSync(path.join(root, '.nvmrc'), 'utf8').trim().replace(/^v/, '')
const node14 = args.node14 || process.env.LARK_DOC_NODE14 || path.join(os.homedir(), '.nvm', 'versions', 'node', 'v' + pinned, 'bin', 'node')
const cleanEnv = { ...process.env }
delete cleanEnv.NODE_OPTIONS
if (execFileSync(node14, ['--version'], { encoding: 'utf8', env: cleanEnv }).trim() !== 'v' + pinned || !pinned.startsWith('14.')) throw Error('Library build runtime must match .nvmrc (Node.js 14)')
function run(command, argv, options = {}) {
  const output = execFileSync(command, argv, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, env: cleanEnv, ...options })
  if (output.trim()) process.stderr.write(output.trimEnd() + '\n')
  return output
}
const buildEnv = { ...cleanEnv, PATH: path.dirname(node14) + path.delimiter + process.env.PATH }
// A stable npm 8/Node 14 user-agent is part of the artifact fingerprint.
// Do not inherit the packaging host's npm 11 user-agent into the build gate.
delete buildEnv.npm_config_user_agent
const buildNpm = path.join(path.dirname(node14), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
run(node14, [buildNpm, 'run', args['skip-build'] ? 'artifacts:check' : 'prepack'], { env: buildEnv })
if (args['skip-build']) run(node14, ['scripts/check-rollup-artifacts.mjs', '--size'], { env: buildEnv })
const sourceInputs = new Map(['package.json', 'package-lock.json', 'collab.js'].map(file => [file, digest(fs.readFileSync(path.join(root, file)), 'sha256')]))
function checkSource() {
  run(node14, [buildNpm, 'run', 'artifacts:check'], { env: buildEnv })
  checkSDK()
  for (const [file, expected] of sourceInputs) if (digest(fs.readFileSync(path.join(root, file)), 'sha256') !== expected) throw Error('Source changed during packaging: ' + file)
}
fs.mkdirSync(out, { recursive: true })
fs.mkdirSync(work, { recursive: true })
fs.mkdirSync(path.join(work, 'thin'))
const npmCLI = process.env.npm_execpath || path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
const packed = JSON.parse(execFileSync(process.execPath, [npmCLI, 'pack', '--ignore-scripts', '--json', '--pack-destination', path.join(work, 'thin')], { cwd: root, encoding: 'utf8', env: cleanEnv, maxBuffer: 4 * 1024 * 1024 }))[0]
const sdk = path.join(work, 'thin', packed.filename)
const sdkBytes = fs.readFileSync(sdk)
function checkSDK() {
  run('python3', ['-c', String.raw`
import json, sys, tarfile
from pathlib import Path, PurePosixPath
root = Path(sys.argv[2])
with tarfile.open(sys.argv[1], 'r:gz') as archive:
    for member in archive.getmembers():
        parts = PurePosixPath(member.name).parts
        if not parts or parts[0] != 'package' or '..' in parts or not member.isfile():
            raise ValueError('Unexpected SDK archive member: ' + member.name)
        relative = PurePosixPath(*parts[1:]).as_posix()
        if relative != 'package.json' and archive.extractfile(member).read() != root.joinpath(*parts[1:]).read_bytes():
            raise ValueError('SDK payload changed during packaging: ' + relative)
    expected = json.loads((root / 'package.json').read_text())
    manifest = json.load(archive.extractfile('package/package.json'))
    for key in ['name', 'version', 'dependencies', 'collabDependencies', 'peerDependencies', 'optionalDependencies']:
        if manifest.get(key) != expected.get(key):
            raise ValueError('SDK dependency contract changed during packaging: ' + key)
`, sdk, root])
}
if (!intranetVersion) {
  if (manifest.bundleDependencies || manifest.bundledDependencies || packed.files.some(file => file.path.startsWith('node_modules/'))) throw Error('Public SDK must preserve external runtime dependencies')
  checkSource()
  const tarball = path.join(out, packed.filename)
  fs.copyFileSync(sdk, tarball, fs.constants.COPYFILE_EXCL)
  const auditPaths = { summary: tarball + '.json' }
  const result = { ...packed, tarball, mode: 'public', runtime: 'external', sha512: digest(sdkBytes, 'sha512'), sha256: digest(sdkBytes, 'sha256'), bytes: sdkBytes.length, fileCount: packed.files.length, directRoots: Object.keys(manifest.dependencies || {}).length, runtimePackages: 0, auditPaths }
  fs.writeFileSync(auditPaths.summary, JSON.stringify(result, null, 2) + '\n')
  await new Promise(resolve => process.stdout.write(JSON.stringify(result) + '\n', resolve))
  process.exit(0)
}
const selected = new Map()
const edges = []
const omittedOptional = []
function resolvePackage(name, issuer) {
  for (let cursor = issuer; ; cursor = path.dirname(cursor)) {
    const candidate = path.join(cursor, 'node_modules', name)
    if (fs.existsSync(path.join(candidate, 'package.json'))) return fs.realpathSync(candidate)
    if (path.dirname(cursor) === cursor) return null
  }
}
function visit(directory) {
  if (selected.has(directory)) return
  if (directory !== root && !contained(modules, directory)) throw Error('Runtime resolution escapes source node_modules: ' + directory)
  const pkg = json(path.join(directory, 'package.json'))
  selected.set(directory, pkg)
  const dependencies = { ...pkg.peerDependencies, ...pkg.dependencies, ...pkg.optionalDependencies, ...(directory === root ? pkg.collabDependencies : {}) }
  for (const [name, range] of Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b))) {
    const found = resolvePackage(name, directory)
    if (!found) {
      if (pkg.optionalDependencies?.[name] || pkg.peerDependenciesMeta?.[name]?.optional) { omittedOptional.push({ issuer: pkg.name, name, range }); continue }
      throw Error(`Unresolved runtime edge: ${pkg.name} -> ${name}@${range}`)
    }
    const target = json(path.join(found, 'package.json'))
    if (!semver.satisfies(target.version, range)) throw Error(`Invalid runtime edge: ${pkg.name} -> ${name}@${range}, installed ${target.version}`)
    edges.push({ issuer: path.relative(root, directory) || '.', name, range, version: target.version, location: path.relative(root, found) })
    visit(found)
  }
}
visit(root)
const archivesDir = path.join(work, 'archives')
fs.mkdirSync(archivesDir)
const cache = args['archives-cache'] ? json(path.join(args['archives-cache'], 'bundle.json')) : null
const cacheRecords = new Map((cache ? [...cache.packages, ...(cache.sdk ? [cache.sdk] : [])] : []).map(record => [`${record.name}@${record.version}`, record]))
const records = new Map()
function verified(bytes, integrity) {
  const expected = integrity?.split(/\s+/).find(value => value.startsWith('sha512-'))
  return expected && expected === 'sha512-' + digest(bytes, 'sha512', 'base64')
}
for (const [directory, pkg] of selected) {
  if (directory === root) continue
  const key = `${pkg.name}@${pkg.version}`
  const entry = lock.packages[path.relative(root, directory).split(path.sep).join('/')]
  if (!entry || entry.version !== pkg.version || !entry.integrity || !entry.resolved) throw Error('Missing exact source lock archive: ' + key)
  // A lock may record a company mirror URL. Fetch the same exact archive from
  // official npm and require the source lock's SHA512, without editing the lock.
  const official = new URL(`${pkg.name}/-/${pkg.name.split('/').pop()}-${pkg.version}.tgz`, 'https://registry.npmjs.org/').href
  const prior = records.get(key)
  if (prior && prior.integrity !== entry.integrity) throw Error('Conflicting locked archive identities: ' + key)
  if (!prior) records.set(key, { name: pkg.name, version: pkg.version, integrity: entry.integrity, resolved: official, lockedResolved: entry.resolved, file: digest(key, 'sha256') + '.tgz' })
}
const queue = [...records.values()]
let cursor = 0
await Promise.all(Array.from({ length: Math.min(8, queue.length) }, async () => {
  while (cursor < queue.length) {
    const record = queue[cursor++]
    const cached = cacheRecords.get(`${record.name}@${record.version}`)
    let bytes
    if (cached) {
      const file = path.resolve(args['archives-cache'], cached.file)
      if (!contained(args['archives-cache'], file)) throw Error('Cache archive escapes its bundle')
      const candidate = fs.readFileSync(file)
      if (digest(candidate, 'sha256') !== cached.sha256 || !verified(candidate, cached.integrity) || !verified(candidate, record.integrity)) throw Error('Cache integrity mismatch: ' + record.name)
      bytes = candidate
    } else {
      const response = await fetch(record.resolved, { signal: AbortSignal.timeout(120000) })
      if (!response.ok) throw Error(`Download failed (${response.status}): ${record.name}`)
      bytes = Buffer.from(await response.arrayBuffer())
      if (!verified(bytes, record.integrity)) throw Error('Locked archive integrity mismatch: ' + record.name)
    }
    record.sha256 = digest(bytes, 'sha256')
    fs.writeFileSync(path.join(archivesDir, record.file), bytes, { flag: 'wx' })
  }
}))
const bundle = { sdk: { name: manifest.name, version: manifest.version, file: path.relative(archivesDir, sdk), sha256: digest(sdkBytes, 'sha256'), integrity: 'sha512-' + digest(sdkBytes, 'sha512', 'base64') }, packages: queue }
fs.writeFileSync(path.join(archivesDir, 'bundle.json'), JSON.stringify(bundle, null, 2) + '\n')
const filename = `${manifest.name.replace(/^@/, '').replace('/', '-')}-${intranetVersion}.tgz`
const tarball = path.join(out, filename)
run(process.execPath, ['scripts/intranet/pack-bundled-sdk.mjs', '--sdk', sdk, '--sdk-sha256', bundle.sdk.sha256, '--installed-sdk', root, '--modules-root', modules, '--archives-bundle', archivesDir, '--out', tarball, '--work', path.join(work, 'stage'), '--include-contract', 'collabDependencies', '--larkdoc-webpack4-tools', modules, '--private-version', intranetVersion])
const stage = path.join(work, 'stage', 'package')
// SDK files themselves must still match the source snapshot; only bundled
// dependency syntax and the staged package manifest may change.
for (const { path: file } of packed.files) {
  if (file === 'package.json') continue
  if (!fs.readFileSync(path.join(root, file)).equals(fs.readFileSync(path.join(stage, file)))) throw Error('SDK payload changed during packaging: ' + file)
}
checkSource()
const files = []
function list(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) list(file)
    else if (entry.isFile()) files.push({ path: path.relative(stage, file).split(path.sep).join('/') })
    else throw Error('Unsupported staged entry: ' + file)
  }
}
list(stage)
const bytes = fs.readFileSync(tarball)
const auditPaths = { bundle: path.join(work, 'stage', 'bundle-info.json'), compatibility: path.join(work, 'stage', 'compatibility-changes.json'), runtime: path.join(work, 'runtime-graph.json'), summary: path.join(out, filename + '.json') }
fs.writeFileSync(auditPaths.runtime, JSON.stringify({ packages: selected.size - 1, edges, omittedOptional }, null, 2) + '\n')
const info = json(auditPaths.bundle)
const result = { tarball, filename, name: manifest.name, version: intranetVersion, mode: 'intranet', runtime: 'bundled', shasum: digest(bytes, 'sha1'), integrity: 'sha512-' + digest(bytes, 'sha512', 'base64'), sha512: digest(bytes, 'sha512'), sha256: digest(bytes, 'sha256'), bytes: bytes.length, fileCount: files.length, directRoots: info.directBundledDependencies, runtimePackages: info.runtimePackages, auditPaths, files }
fs.writeFileSync(auditPaths.summary, JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result))
