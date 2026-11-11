#!/usr/bin/env node
// Build a self-contained SDK from original archives and an installed npm resolution tree.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const semver = require('semver')

const args = {}
for (let i = 2; i < process.argv.length; i += 2) {
  const name = process.argv[i]?.replace(/^--/, '')
  if (!['sdk', 'sdk-sha256', 'installed-sdk', 'modules-root', 'archives-bundle', 'out', 'work', 'include-contract', 'larkdoc-webpack4-tools', 'private-version'].includes(name) || !process.argv[i + 1]) {
    throw new Error('Usage: pack-bundled-sdk.mjs --sdk ORIGINAL.tgz --sdk-sha256 HASH --installed-sdk DIR --modules-root NODE_MODULES --archives-bundle DIR --out OUTPUT.tgz --work NEW_DIR [--include-contract FIELD] [--larkdoc-webpack4-tools NODE_MODULES --private-version BASE-intranet.N]')
  }
  args[name] = ['sdk-sha256', 'include-contract', 'private-version'].includes(name) ? process.argv[i + 1] : path.resolve(process.argv[i + 1])
}
for (const key of ['sdk', 'sdk-sha256', 'installed-sdk', 'modules-root', 'archives-bundle', 'out', 'work']) {
  if (!args[key]) throw new Error(`Missing --${key}`)
}
if (Boolean(args['larkdoc-webpack4-tools']) !== Boolean(args['private-version'])) throw new Error('Webpack4 preparation requires both its tools and private version')
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const contained = (base, file) => file === base || file.startsWith(base + path.sep)
if (fs.existsSync(args.out) || fs.existsSync(args.work)) throw new Error('Output and working directory must be new')
if (sha256(fs.readFileSync(args.sdk)) !== args['sdk-sha256']) throw new Error('Original SDK checksum mismatch')
const modules = fs.realpathSync(args['modules-root'])
const installedSDK = fs.realpathSync(args['installed-sdk'])
const sourceRoot = modules === path.join(installedSDK, 'node_modules')
if (!sourceRoot && !contained(modules, installedSDK)) throw new Error('Installed SDK is outside the supplied npm tree')
function canonicalNewPath(directory) {
  let existing = directory
  const suffix = []
  while (!fs.existsSync(existing)) {
    suffix.unshift(path.basename(existing))
    const parent = path.dirname(existing)
    if (parent === existing) throw new Error('No existing output ancestor: ' + directory)
    existing = parent
  }
  return path.join(fs.realpathSync(existing), ...suffix)
}
args.out = canonicalNewPath(args.out)
args.work = canonicalNewPath(args.work)
for (const output of [args.out, args.work]) {
  for (const input of [installedSDK, modules]) {
    if (contained(input, output) || contained(output, input)) throw new Error('Output and work must be outside the input installation tree')
  }
}
if (contained(args.out, args.work) || contained(args.work, args.out)) throw new Error('Output and work must be separate')
const sdkManifest = readJSON(path.join(installedSDK, 'package.json'))
if (args['private-version'] && (!semver.valid(args['private-version']) || !args['private-version'].startsWith(sdkManifest.version + '-intranet.') || !/^\d+\.\d+\.\d+-intranet\.\d+$/.test(args['private-version']))) throw new Error('Webpack4 preparation requires a private intranet revision of the source public version')
if (!sourceRoot && path.relative(modules, installedSDK).split(path.sep).join('/') !== sdkManifest.name) throw new Error('SDK must be installed directly under the supplied node_modules')
const bundle = readJSON(path.join(args['archives-bundle'], 'bundle.json'))
const archives = new Map([...bundle.packages, bundle.sdk].map(item => [`${item.name}@${item.version}`, item]))
const selected = new Map()
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
  if (directory !== installedSDK && !contained(modules, directory)) throw new Error(`Dependency escapes the installation tree: ${directory}`)
  const manifest = readJSON(path.join(directory, 'package.json'))
  selected.set(directory, manifest)
  const names = new Set([...Object.keys(manifest.dependencies || {}), ...Object.keys(manifest.optionalDependencies || {}), ...Object.keys(manifest.peerDependencies || {})])
  for (const name of [...names].sort()) {
    const found = resolvePackage(name, directory)
    if (found) {
      const dependency = readJSON(path.join(found, 'package.json'))
      const range = manifest.optionalDependencies?.[name] || manifest.dependencies?.[name] || manifest.peerDependencies?.[name]
      if (!semver.satisfies(dependency.version, range)) throw new Error(`Invalid runtime resolution: ${manifest.name} -> ${name}@${range}, installed ${dependency.version}`)
      visit(found)
    }
    else if (manifest.optionalDependencies?.[name] || manifest.peerDependenciesMeta?.[name]?.optional) omittedOptional.push(`${manifest.name}@${manifest.version} -> ${name}`)
    else throw new Error(`Unresolved runtime dependency: ${manifest.name}@${manifest.version} -> ${name}`)
  }
}
visit(installedSDK)
if (args['include-contract']) {
  const contract = sdkManifest[args['include-contract']]
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) throw new Error('Expected a named dependency contract object')
  for (const name of Object.keys(contract).sort()) {
    const found = resolvePackage(name, installedSDK)
    if (!found) throw new Error(`Unresolved contract dependency: ${name}`)
    const dependency = readJSON(path.join(found, 'package.json'))
    if (!semver.satisfies(dependency.version, contract[name])) throw new Error(`Invalid contract resolution: ${name}@${contract[name]}, installed ${dependency.version}`)
    visit(found)
  }
}
const dependencies = []
for (const [directory, manifest] of selected) {
  if (directory === installedSDK) continue
  if (!sourceRoot && contained(installedSDK, directory)) throw new Error('SDK-internal nested dependencies need explicit tree rebasing; use a flat SDK installation as the resolution input')
  const record = archives.get(`${manifest.name}@${manifest.version}`)
  if (!record) throw new Error(`No original archive for ${manifest.name}@${manifest.version}`)
  const archive = path.resolve(args['archives-bundle'], record.file)
  if (!contained(args['archives-bundle'], archive)) throw new Error('Archive path escapes the bundle')
  const bytes = fs.readFileSync(archive)
  if (sha256(bytes) !== record.sha256) throw new Error(`Archive checksum mismatch: ${record.name}`)
  const integrity = record.integrity.split(' ').find(value => value.startsWith('sha512-'))
  if (!integrity || `sha512-${crypto.createHash('sha512').update(bytes).digest('base64')}` !== integrity) throw new Error(`Archive integrity mismatch: ${record.name}`)
  dependencies.push({ name: manifest.name, version: manifest.version, location: path.relative(modules, directory).split(path.sep).join('/'), archive, manifest })
}
dependencies.sort((a, b) => a.location.localeCompare(b.location))
const result = execFileSync('python3', ['-c', String.raw`
import sys, json, tarfile, hashlib, os, stat, subprocess, gzip
from pathlib import Path, PurePosixPath
data = json.load(sys.stdin)
work = Path(data['work'])
package = work / 'package'
work.mkdir(parents=True, exist_ok=False)

def extract_original(archive, target, expected):
    with tarfile.open(archive, 'r:gz') as tar:
        manifests = [m for m in tar.getmembers() if len(PurePosixPath(m.name).parts) == 2 and PurePosixPath(m.name).name == 'package.json' and m.isfile()]
        if len(manifests) != 1:
            raise ValueError('Expected one root package.json: ' + archive)
        root = PurePosixPath(manifests[0].name).parts[0]
        manifest = json.load(tar.extractfile(manifests[0]))
        for key in ['name', 'version', 'dependencies', 'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta', 'os', 'cpu']:
            if manifest.get(key) != expected.get(key):
                raise ValueError('Installed/archive manifest mismatch: ' + str(manifest.get('name')) + ':' + key)
        for member in tar.getmembers():
            parts = PurePosixPath(member.name).parts
            if not parts or parts[0] != root or any(p in ['..', ''] for p in parts) or PurePosixPath(member.name).is_absolute():
                raise ValueError('Unsafe archive path: ' + member.name)
            if len(parts) == 1:
                continue
            if any(p.startswith('._') or p == '.DS_Store' for p in parts):
                raise ValueError('macOS metadata in original archive: ' + member.name)
            destination = target.joinpath(*parts[1:])
            if member.isdir():
                destination.mkdir(parents=True, exist_ok=True)
            elif member.isfile():
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(tar.extractfile(member).read())
                destination.chmod(member.mode & 0o777)
            else:
                raise ValueError('Unsupported archive entry: ' + member.name)
        return manifest

manifest = extract_original(data['sdk'], package, data['installedManifest'])
contract = data.get('include-contract')
if contract:
    if manifest.get(contract) != data['installedManifest'].get(contract):
        raise ValueError('Installed/original dependency contract mismatch')
    manifest.setdefault('dependencies', {}).update(manifest[contract])
    # Promoted runtime dependencies must not be classified as development-only by npm pack.
    for name in manifest[contract]:
        manifest.get('devDependencies', {}).pop(name, None)
for item in data['dependencies']:
    location = PurePosixPath(item['location'])
    if location.is_absolute() or '..' in location.parts:
        raise ValueError('Unsafe dependency location')
    extract_original(item['archive'], package / 'node_modules' / item['location'], item['manifest'])
roots = sorted(set(manifest.get('dependencies', {})) | set(manifest.get('optionalDependencies', {})))
manifest['bundleDependencies'] = roots
manifest.pop('bundledDependencies', None)
(package / 'package.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
if data.get('larkdoc-webpack4-tools'):
    subprocess.run([data['node'], data['prepareScript'], str(package), data['larkdoc-webpack4-tools'], data['private-version']], check=True, stdout=sys.stderr)
    manifest = json.loads((package / 'package.json').read_text())
native = [p.relative_to(package).as_posix() for p in package.rglob('*.node')]
os_packages = [i['name'] for i in data['dependencies'] if i['manifest'].get('os') or i['manifest'].get('cpu')]
if native or os_packages:
    raise ValueError('Platform-specific runtime closure requires target-OS preparation: ' + repr(native + os_packages))
out = Path(data['out'])
out.parent.mkdir(parents=True, exist_ok=True)
with out.open('xb') as output, gzip.GzipFile(filename='', mode='wb', fileobj=output, compresslevel=6, mtime=0) as compressed, tarfile.open(fileobj=compressed, mode='w', format=tarfile.PAX_FORMAT) as tar:
    for file in sorted(package.rglob('*')):
        if file.is_file():
            info = tar.gettarinfo(str(file), arcname='package/' + file.relative_to(package).as_posix())
            info.uid = info.gid = 0
            info.uname = info.gname = ''
            info.mtime = 0
            with file.open('rb') as source:
                tar.addfile(info, source)
print(json.dumps({'name':manifest['name'], 'version':manifest['version'], 'directBundledDependencies':len(roots), 'runtimePackages':len(data['dependencies']), 'nativeBinaries':native, 'files':sum(p.is_file() for p in package.rglob('*'))}))
`], { input: JSON.stringify({ ...args, node: process.execPath, prepareScript: path.join(path.dirname(fileURLToPath(import.meta.url)), 'prepare-larkdoc-sdk.mjs'), installedManifest: selected.get(installedSDK), dependencies }), encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 })
const summary = { ...JSON.parse(result), dependencyContract: args['include-contract'] || null, originalSHA256: args['sdk-sha256'], sha256: sha256(fs.readFileSync(args.out)), bytes: fs.statSync(args.out).size, omittedOptional, packages: dependencies.map(({ name, version, location }) => ({ name, version, location })) }
fs.writeFileSync(path.join(args.work, 'bundle-info.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(JSON.stringify({ ...summary, packages: summary.packages.length }))
