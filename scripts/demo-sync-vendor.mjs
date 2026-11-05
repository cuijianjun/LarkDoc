#!/usr/bin/env node
/** Build dist first, then sync the current Rollup browser assets for Pages/offline docs.
 * node scripts/demo-sync-vendor.mjs [--check] [--quiet]
 * Generated vendor files are ignored by Git; deployment builds them from the same commit.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
const vendor = path.join(root, 'docs/public/demo/vendor')
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version
const check = process.argv.includes('--check')
const quiet = process.argv.includes('--quiet')
const bundles = ['lark-doc-element.umd.min.js', 'lark-doc.css',
  ...['math', 'mermaid', 'highlight', 'markdown', 'office'].map(name => `lark-doc-element.umd.min.${name}.js`)]
const expected = new Map()
for (const name of bundles) expected.set(name, path.join(dist, name))
const fonts = path.join(dist, 'fonts')
if (!fs.existsSync(fonts)) throw new Error('缺少 dist/fonts；请先 npm run build:all')
for (const name of fs.readdirSync(fonts).sort()) {
  if (fs.statSync(path.join(fonts, name)).isFile()) expected.set(`fonts/${name}`, path.join(fonts, name))
}
for (const [name, source] of expected) {
  if (!fs.existsSync(source)) throw new Error(`缺少 dist/${name}；请先 npm run build:all`)
}
const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'lark-doc-manifest.json'), 'utf8'))
if (manifest.version !== version) throw new Error('dist 版本不符；请重新 npm run build:all')

// Only this generated directory is managed. A same-size change must still be copied/rejected.
function files(directory, prefix = '') {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory).flatMap(name => {
    const relative = prefix + name
    return fs.statSync(path.join(directory, name)).isDirectory()
      ? files(path.join(directory, name), relative + '/') : [relative]
  })
}
const stale = files(vendor).filter(name => name !== 'VERSION' && !expected.has(name))
const errors = []
if (check) {
  for (const name of stale) errors.push(`陈旧文件 ${name}`)
} else {
  for (const name of stale) fs.unlinkSync(path.join(vendor, name))
}
for (const [name, source] of expected) {
  const target = path.join(vendor, name)
  const bytes = fs.readFileSync(source)
  if (fs.existsSync(target) && fs.readFileSync(target).equals(bytes)) continue
  if (check) errors.push(`缺少或内容不同 ${name}`)
  else {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, bytes)
  }
}
const stamp = path.join(vendor, 'VERSION')
if (!fs.existsSync(stamp) || fs.readFileSync(stamp, 'utf8') !== version + '\n') {
  if (check) errors.push('VERSION 与 package.json 不同')
  else fs.writeFileSync(stamp, version + '\n')
}
if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}
if (!quiet) console.log(`✓ Demo ${check ? '校验' : '同步'}通过：v${version}，${expected.size} 个资源，无 Vue 运行时`)
