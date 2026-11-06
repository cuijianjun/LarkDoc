#!/usr/bin/env node
// Package the verified, self-contained SDK with each application's source and lockfile.
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const usage = 'node scripts/pack-windows-intranet.mjs --sdk SDK.tgz --sdk-sha256 SHA256 --out DIR --work DIR [--locks DIR]'
if (process.argv.includes('--help')) { console.log(usage); process.exit(0) }
const options = {}
for (let n = 2; n < process.argv.length; n++) {
  const key = process.argv[n]
  if (!['--out', '--work', '--sdk', '--sdk-sha256', '--locks'].includes(key) || !process.argv[n + 1] || options[key.slice(2)]) throw new Error(usage)
  const value = process.argv[++n]
  options[key.slice(2)] = key === '--sdk-sha256' ? value : path.resolve(value)
}
for (const key of ['out', 'work', 'sdk', 'sdk-sha256']) if (!options[key]) throw new Error(`Missing --${key}\n${usage}`)
if (!/^[a-f0-9]{64}$/.test(options['sdk-sha256'])) throw new Error('Expected the approved SDK SHA256')
const exists = file => fs.access(file).then(() => true, () => false)
const hash = (bytes, algorithm = 'sha256', encoding = 'hex') => crypto.createHash(algorithm).update(bytes).digest(encoding)
const json = async file => JSON.parse(await fs.readFile(file, 'utf8'))
const writeJSON = (file, value) => fs.writeFile(file, JSON.stringify(value, null, 2) + '\n')
const within = (parent, child) => child === parent || child.startsWith(parent + path.sep)
// Resolve existing ancestors too: a symlink must not redirect output into the source tree.
async function realDestination(file) {
  if (await exists(file)) return fs.realpath(file)
  return path.join(await realDestination(path.dirname(file)), path.basename(file))
}
const [realRoot, realOut, realWork, realSDK] = await Promise.all([fs.realpath(root), realDestination(options.out), realDestination(options.work), fs.realpath(options.sdk)])
if (within(realRoot, realOut) || within(realRoot, realWork)) throw new Error('--out and --work must be outside the repository')
if (within(realWork, realOut) || within(realOut, realWork) || within(realWork, realSDK) || within(realOut, realSDK)) throw new Error('SDK, output and work paths must be separate')
if (await exists(options.work) && (await fs.readdir(options.work)).length) throw new Error('--work must be a new or empty directory')
const sdkBytes = await fs.readFile(options.sdk)
if (hash(sdkBytes) !== options['sdk-sha256']) throw new Error('SDK SHA256 mismatch')
const integrity = 'sha512-' + hash(sdkBytes, 'sha512', 'base64')
const manifest = JSON.parse(execFileSync('python3', ['-c', `
import json, pathlib, sys, tarfile
with tarfile.open(sys.argv[1], 'r:gz') as archive:
    members = archive.getmembers()
    for member in members:
        parts = pathlib.PurePosixPath(member.name).parts
        if not parts or parts[0] != 'package' or '..' in parts or member.issym() or member.islnk() or not (member.isfile() or member.isdir()):
            raise SystemExit('Unsafe SDK archive member: ' + member.name)
    manifest = json.load(archive.extractfile('package/package.json'))
    bundled = manifest.get('bundleDependencies', manifest.get('bundledDependencies', []))
    if not isinstance(bundled, list) or not bundled or set(bundled) != set(manifest.get('dependencies', {})):
        raise SystemExit('SDK must bundle every runtime dependency')
    names = {member.name for member in members if member.isfile()}
    for dependency in bundled:
        if 'package/node_modules/' + dependency + '/package.json' not in names:
            raise SystemExit('Missing bundled dependency: ' + dependency)
    print(json.dumps(manifest))
`, options.sdk], { encoding: 'utf8' }))
if (manifest.name !== 'lark-doc' || !/^\d+\.\d+\.\d+-intranet\.(0|[1-9]\d*)$/.test(manifest.version) || manifest.publishConfig?.tag !== 'intranet') throw new Error('Expected a private intranet SDK tagged intranet')
const version = manifest.version
const publicVersion = version.split('-intranet.')[0]
const sdkName = `lark-doc-${version}.tgz`, fileSpec = `file:../vendor/${sdkName}`
const checksumFile = path.join(options.out, `SHA256SUMS-${version}.txt`)
if (await exists(checksumFile)) throw new Error('Refusing to overwrite: ' + checksumFile)

function npmLock(lock) {
  const sdk = lock.packages?.['node_modules/lark-doc']
  if (lock.lockfileVersion !== 2 || sdk?.version !== version || !lock.packages['']?.dependencies?.['lark-doc'] || !lock.dependencies?.['lark-doc']) throw new Error('Vue2 canonical npm lock must match the SDK version')
  const sameEntries = (a, b) => JSON.stringify(Object.entries(a || {}).sort()) === JSON.stringify(Object.entries(b || {}).sort())
  if (!sameEntries(sdk.dependencies, manifest.dependencies) || JSON.stringify([...(sdk.bundleDependencies || [])].sort()) !== JSON.stringify([...manifest.bundleDependencies].sort())) throw new Error('Vue2 lock must contain the complete intranet SDK dependency contract')
  for (const dependency of manifest.bundleDependencies) if (!lock.packages[`node_modules/lark-doc/node_modules/${dependency}`]?.inBundle) throw new Error('Vue2 lock is missing a bundled runtime: ' + dependency)
  lock.packages[''].dependencies['lark-doc'] = fileSpec
  sdk.resolved = fileSpec; sdk.integrity = integrity
  lock.dependencies['lark-doc'].version = fileSpec
  lock.dependencies['lark-doc'].resolved = fileSpec
  lock.dependencies['lark-doc'].integrity = integrity
  return JSON.stringify(lock, null, 2) + '\n'
}
function pnpmLock(source) {
  if (!/^lockfileVersion: ['"]9\.0['"]$/m.test(source)) throw new Error('Vue3 requires the canonical shared pnpm 9/10 lockfile')
  const lines = source.split('\n')
  let section = '', importer = false, packageCount = 0, snapshotCount = 0, importerCount = 0
  for (let n = 0; n < lines.length; n++) {
    if (/^[a-zA-Z]+:$/.test(lines[n])) section = lines[n].slice(0, -1)
    if (section === 'importers') {
      if (/^      lark-doc:$/.test(lines[n])) { importer = true; importerCount++; continue }
      if (importer && /^      \S/.test(lines[n])) importer = false
      if (importer && /^        (specifier|version): /.test(lines[n])) lines[n] = lines[n].replace(/: .*/, ': ' + fileSpec)
    }
    if (['packages', 'snapshots'].includes(section) && /^  ['"]?lark-doc@/.test(lines[n])) {
      const end = lines.findIndex((line, index) => index > n && (/^  \S/.test(line) || /^[a-zA-Z]+:$/.test(line)))
      const stop = end < 0 ? lines.length : end
      const block = lines.slice(n, stop).join('\n')
      if (section === 'packages') {
        if (!block.includes(`    version: ${version}`)) throw new Error('Vue3 SDK package version must match the input tgz')
        const bundled = [...block.matchAll(/^      - (.+)$/gm)].map(match => match[1].replace(/^['"]|['"]$/g, '')).sort()
        if (!/^    bundledDependencies:$/m.test(block) || JSON.stringify(bundled) !== JSON.stringify([...manifest.bundleDependencies].sort())) throw new Error('Vue3 lock must contain the complete intranet SDK bundled dependency contract')
        if (!/^      integrity: sha512-/m.test(block) || !/^      tarball: /m.test(block)) throw new Error('Expected the canonical SDK tarball resolution')
        for (let i = n + 1; i < stop; i++) {
          if (/^      integrity: /.test(lines[i])) lines[i] = '      integrity: ' + integrity
          if (/^      tarball: /.test(lines[i])) lines[i] = '      tarball: ' + fileSpec
        }
        packageCount++
      } else { snapshotCount++ }
      lines[n] = `  lark-doc@${fileSpec}:` + (lines[n].endsWith(': {}') ? ' {}' : '')
    }
  }
  if (importerCount !== 1 || packageCount !== 1 || snapshotCount !== 1) throw new Error('Expected one SDK importer, package and snapshot in canonical pnpm lock')
  return lines.join('\n')
}
async function filesBelow(directory, prefix = '') {
  const files = []
  for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix + entry.name
    if (entry.isSymbolicLink()) throw new Error('Delivery contains a symlink: ' + relative)
    if (entry.name === '.DS_Store' || entry.name.startsWith('._')) continue
    if (entry.isDirectory()) files.push(...await filesBelow(path.join(directory, entry.name), relative + '/'))
    else if (entry.isFile()) files.push(relative)
    else throw new Error('Unsupported delivery entry: ' + relative)
  }
  return files
}

// Validate both locks/templates before writing either delivery.
const deliveries = []
for (const environment of ['vue2-webpack4', 'vue3-vite']) {
  const app = path.join(root, 'docs/examples/apps', environment)
  const appManifest = await json(path.join(app, 'package.json'))
  if (appManifest.dependencies?.['lark-doc'] !== publicVersion) throw new Error(`${environment} manifest does not match SDK public baseline ${publicVersion}`)
  appManifest.dependencies['lark-doc'] = fileSpec
  if (environment === 'vue3-vite') {
    delete appManifest.packageManager
    appManifest.engines = { ...appManifest.engines, pnpm: '>=9 <11' }
    delete appManifest.engines.npm
  }
  const lockName = environment === 'vue2-webpack4' ? 'package-lock.json' : 'pnpm-lock.yaml'
  const lockPath = options.locks ? path.join(options.locks, environment, lockName) : path.join(app, lockName)
  if (!await exists(lockPath)) throw new Error(`Missing canonical lock: ${lockPath}`)
  const lock = environment === 'vue2-webpack4' ? npmLock(await json(lockPath)) : pnpmLock(await fs.readFile(lockPath, 'utf8'))
  const bundleName = `lark-doc-${environment === 'vue3-vite' ? 'vue3' : environment}-${version}-windows-x64`
  const archive = path.join(options.out, bundleName + '.zip')
  if (await exists(archive)) throw new Error('Refusing to overwrite: ' + archive)
  const template = await fs.readFile(path.join(root, 'scripts/intranet', `README-${environment}.md`), 'utf8')
  const fields = { SDK_VERSION: version, PUBLIC_VERSION: publicVersion, SDK_SHA256: hash(sdkBytes), BUNDLE_NAME: bundleName }
  const readme = template.replace(/\{\{([A-Z_]+)\}\}/g, (match, key) => {
    if (!(key in fields)) throw new Error('Unknown README field: ' + key)
    return fields[key]
  })
  deliveries.push({ environment, app, appManifest, lockName, lock, bundleName, archive, readme })
}
await fs.mkdir(options.work, { recursive: true }); await fs.mkdir(options.out, { recursive: true })
const archives = []
for (const delivery of deliveries) {
  const directory = path.join(options.work, delivery.bundleName)
  await fs.mkdir(path.join(directory, 'vendor'), { recursive: true })
  await fs.mkdir(path.join(directory, 'demo'), { recursive: true })
  await fs.copyFile(options.sdk, path.join(directory, 'vendor', sdkName))
  await fs.writeFile(path.join(directory, 'README.md'), delivery.readme)
  for (const entry of ['src', 'index.html', delivery.environment === 'vue2-webpack4' ? 'webpack.config.cjs' : 'vite.config.js']) {
    await fs.cp(path.join(delivery.app, entry), path.join(directory, 'demo', entry), { recursive: true })
  }
  await writeJSON(path.join(directory, 'demo/package.json'), delivery.appManifest)
  await fs.writeFile(path.join(directory, 'demo', delivery.lockName), delivery.lock)
  const checksums = []
  for (const relative of await filesBelow(directory)) checksums.push(`${hash(await fs.readFile(path.join(directory, relative)))}  ${relative}`)
  await fs.writeFile(path.join(directory, 'SHA256SUMS.txt'), checksums.join('\n') + '\n')
  // Standard ZIP writer marks non-ASCII names as UTF-8; tgz bytes remain unchanged.
  execFileSync('python3', ['-c', `
import os, sys, zipfile
root, destination = sys.argv[1:]
with zipfile.ZipFile(destination, 'x', allowZip64=True) as archive:
    for current, directories, files in os.walk(root):
        directories.sort()
        for filename in sorted(files):
            source = os.path.join(current, filename)
            relative = os.path.relpath(source, root).replace(os.sep, '/')
            compression = zipfile.ZIP_STORED if relative.endswith('.tgz') else zipfile.ZIP_DEFLATED
            archive.write(source, relative, compress_type=compression, compresslevel=6 if compression == zipfile.ZIP_DEFLATED else None)
`, directory, delivery.archive])
  archives.push(`${hash(await fs.readFile(delivery.archive))}  ${path.basename(delivery.archive)}`)
  console.log(`Delivery: ${delivery.archive}`)
}
await fs.writeFile(checksumFile, archives.join('\n') + '\n', { flag: 'wx' })
console.log('No installation or Windows verification was performed by this packaging command.')
