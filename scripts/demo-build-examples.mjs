#!/usr/bin/env node
/** Build the real standalone consumers used by the six documentation previews.
 * --install: npm ci in all four apps (use Node 22).
 * --webpack: build Vue2 apps (Node 14.21.3 is supported).
 * --vite: build Vue3/React apps and copy the two static examples (Node 22).
 * --check: reject missing, changed or stale generated previews without building.
 * No flags: build all apps and static examples with the current runtime.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(import.meta.url)
const root = path.resolve(path.dirname(script), '..')
const apps = path.join(root, 'docs/examples/apps')
const output = path.join(root, 'docs/public/examples-runtime')
const vendor = path.join(root, 'docs/public/demo/vendor')
const webpackApps = ['vue2-webpack4', 'vue2-webpack5']
const viteApps = ['vue3-vite', 'react-vite']
const staticApps = ['html-cdn', 'web-component']
const entries = [...webpackApps, ...viteApps, ...staticApps]
const args = process.argv.slice(2)
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number)
const modernNode = nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 13)
const allowed = ['--install', '--webpack', '--vite', '--check']
if (args.some(arg => !allowed.includes(arg)) || args.length > 1) {
  throw new Error(`用法：node scripts/demo-build-examples.mjs [${allowed.join(' | ')}]`)
}

function files(directory, prefix = '', excluded = []) {
  return fs.readdirSync(directory).sort().flatMap(name => {
    if (excluded.includes(name)) return []
    const relative = prefix + name
    const target = path.join(directory, name)
    return fs.statSync(target).isDirectory() ? files(target, `${relative}/`, excluded) : [relative]
  })
}

function fingerprint(inputs) {
  const hash = crypto.createHash('sha256')
  for (const [name, filename] of inputs) {
    hash.update(name).update('\0').update(fs.readFileSync(filename)).update('\0')
  }
  return hash.digest('hex')
}

function sourceHash(name) {
  const inputs = [['builder', script]]
  if (staticApps.includes(name)) {
    inputs.push(['source', path.join(apps, 'static', `${name}.html`)])
    for (const relative of files(vendor)) inputs.push([`vendor/${relative}`, path.join(vendor, relative)])
  } else {
    const app = path.join(apps, name)
    for (const relative of files(app, '', ['node_modules', 'dist'])) inputs.push([relative, path.join(app, relative)])
  }
  return fingerprint(inputs)
}

function outputHash(directory) {
  return fingerprint(files(directory)
    .filter(name => name !== '.source.json')
    .map(name => [name, path.join(directory, name)]))
}

// fs.cpSync is unavailable on the supported Node 14 Webpack build runtime.
function copy(source, target) {
  if (fs.statSync(source).isDirectory()) {
    fs.mkdirSync(target, { recursive: true })
    for (const name of fs.readdirSync(source)) copy(path.join(source, name), path.join(target, name))
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(source, target)
  }
}

function runNpm(directory, command) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const result = spawnSync(npm, command, { cwd: directory, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${path.basename(directory)}: npm ${command.join(' ')} 失败`)
}

function writeManifest(name) {
  const target = path.join(output, name)
  fs.writeFileSync(path.join(target, '.source.json'), JSON.stringify({
    source: sourceHash(name), output: outputHash(target),
  }) + '\n')
}

function buildApp(name) {
  const app = path.join(apps, name)
  const sdk = path.join(app, 'node_modules/lark-doc')
  if (!fs.existsSync(sdk) || fs.lstatSync(sdk).isSymbolicLink()) {
    throw new Error(`${name}: 请先在 Node 22 执行 node scripts/demo-build-examples.mjs --install；需要独立 npm ci 安装的 lark-doc`)
  }
  const expected = JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8')).dependencies['lark-doc']
  const installed = JSON.parse(fs.readFileSync(path.join(sdk, 'package.json'), 'utf8')).version
  if (installed !== expected) throw new Error(`${name}: lark-doc 需要 ${expected}，实际 ${installed}；请重新 npm ci`)
  runNpm(app, ['run', 'build'])
  const target = path.join(output, name)
  fs.rmSync(target, { recursive: true, force: true })
  if (webpackApps.includes(name)) {
    copy(path.join(app, 'index.html'), path.join(target, 'index.html'))
    copy(path.join(app, 'dist'), path.join(target, 'dist'))
  } else {
    copy(path.join(app, 'dist'), target)
  }
  writeManifest(name)
  console.log(`✓ ${name} → docs/public/examples-runtime/${name}/`)
}

function buildStatic() {
  if (!fs.existsSync(path.join(vendor, 'VERSION'))) {
    throw new Error('缺少同版本 demo vendor；请先构建库并执行 node scripts/demo-sync-vendor.mjs')
  }
  for (const name of staticApps) {
    const target = path.join(output, name)
    fs.rmSync(target, { recursive: true, force: true })
    copy(path.join(apps, 'static', `${name}.html`), path.join(target, 'index.html'))
    copy(vendor, path.join(target, 'vendor'))
    writeManifest(name)
    console.log(`✓ ${name} → docs/public/examples-runtime/${name}/`)
  }
}

if (args[0] === '--install') {
  if (!modernNode) throw new Error('--install 请使用 Node 22.13.0 或更高版本')
  for (const name of [...webpackApps, ...viteApps]) runNpm(path.join(apps, name), ['ci'])
} else if (args[0] === '--check') {
  for (const name of entries) {
    const target = path.join(output, name)
    const manifest = path.join(target, '.source.json')
    if (!fs.existsSync(path.join(target, 'index.html')) || !fs.existsSync(manifest)) {
      throw new Error(`${name}: 预览缺失；请执行 --webpack 和 --vite 构建`)
    }
    const saved = JSON.parse(fs.readFileSync(manifest, 'utf8'))
    if (saved.source !== sourceHash(name) || saved.output !== outputHash(target)) {
      throw new Error(`${name}: 预览与源码或资源不一致；请重新执行相应 --webpack / --vite 构建`)
    }
  }
  console.log('✓ 六类真实环境预览完整，源码与生成资源一致')
} else {
  if (args[0] !== '--webpack' && !modernNode) {
    throw new Error('Vite 7 示例需要 Node 22.13.0 或更高版本；Node 14 请只执行 --webpack，再切换 Node 22 执行 --vite')
  }
  if (args[0] !== '--vite') for (const name of webpackApps) buildApp(name)
  if (args[0] !== '--webpack') {
    for (const name of viteApps) buildApp(name)
    buildStatic()
  }
}
