import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const demoVendor = path.join(root, 'docs/public/demo/vendor')
const dist = path.join(root, 'dist')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const expected = {
  version: pkg.version,
  files: [
    ['vue.min.js', path.join(root, 'node_modules/vue/dist/vue.min.js')],
  ],
}

function buildBundleFiles(prefix) {
  return fs.readdirSync(dist)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.js'))
    .sort()
    .map((name) => [name, path.join(dist, name)])
}

function expectedFiles() {
  return [
    ...buildBundleFiles('lark-doc.umd.min'),
    ...buildBundleFiles('lark-doc-element.umd.min'),
    ...expected.files,
  ]
}

function fail(message) {
  console.error(`[demo-sync-vendor] ${message}`)
  process.exitCode = 1
}

const check = process.argv.includes('--check')
if (!fs.existsSync(demoVendor)) {
  fail(`目录不存在: ${demoVendor}`)
} else {
  const currentVersion = fs.existsSync(path.join(demoVendor, 'VERSION'))
    ? fs.readFileSync(path.join(demoVendor, 'VERSION'), 'utf8').trim()
    : ''
  if (check) {
    if (currentVersion !== expected.version) fail(`VERSION=${currentVersion || '(missing)'}，期望 ${expected.version}`)
    for (const [name] of expectedFiles()) {
      if (!fs.existsSync(path.join(demoVendor, name))) fail(`缺少 vendor/${name}`)
    }
    if (!process.exitCode) console.log(`[demo-sync-vendor] OK ${expected.version}`)
  } else {
    for (const [name, source] of expectedFiles()) {
      if (!fs.existsSync(source)) {
        fail(`源文件不存在: ${source}`)
        continue
      }
      fs.copyFileSync(source, path.join(demoVendor, name))
    }
    fs.writeFileSync(path.join(demoVendor, 'VERSION'), `${expected.version}\n`)
    console.log(`[demo-sync-vendor] 已同步 ${expected.version}`)
  }
}
