#!/usr/bin/env node
// Prepare a staged, self-contained LarkDoc SDK for Webpack4 without changing source artifacts.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
if (process.argv.length !== 5) throw Error('Usage: prepare-larkdoc-sdk.mjs STAGED_PACKAGE TOOL_NODE_MODULES VERSION')
const sdk = fs.realpathSync(process.argv[2])
const tools = fs.realpathSync(process.argv[3])
const source = path.dirname(tools)
if (sdk === source || sdk.startsWith(source + path.sep)) throw Error('Compatibility preparation requires a staged SDK outside the tool installation tree')
const version = process.argv[4]
const acorn = require(path.join(tools, 'acorn'))
const babel = require(path.join(tools, '@babel/core'))
const auditFile = path.join(path.dirname(sdk), 'compatibility-changes.json')
if (fs.existsSync(auditFile)) throw Error('Use a fresh staged SDK; compatibility output already exists')
const shim = 'export * from "./dist/lark-doc-collab.esm.js";\n'
if (fs.existsSync(path.join(sdk, 'collab.js')) && fs.readFileSync(path.join(sdk, 'collab.js'), 'utf8') !== shim) throw Error('Unexpected existing collab.js; refusing to overwrite')
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const changed = []
function write(file, contents, reason) {
  const before = fs.existsSync(file) ? fs.readFileSync(file) : null
  const after = Buffer.from(contents)
  if (before && before.equals(after)) return
  fs.writeFileSync(file, after)
  changed.push({ file: path.relative(sdk, file), reason, originalSHA256: before && hash(before), sha256: hash(after) })
}
const sdkManifest = json(sdk + '/package.json')
if (sdkManifest.name !== 'lark-doc' || !Array.isArray(sdkManifest.bundleDependencies) || !sdkManifest.collabDependencies) throw Error('Expected a self-contained LarkDoc staging package with its collaboration contract included')
if (!/^\d+\.\d+\.\d+-intranet\.(0|[1-9]\d*)$/.test(version) || !version.startsWith(sdkManifest.version + '-intranet.')) throw Error('Use a private intranet revision of the source public version')
sdkManifest.version = version
sdkManifest.publishConfig = { ...sdkManifest.publishConfig, tag: 'intranet' }
for (const name of Object.keys(sdkManifest.collabDependencies || {})) {
  if (!sdkManifest.dependencies[name]) throw Error('Contract runtime was not included: ' + name)
  if (sdkManifest.devDependencies) delete sdkManifest.devDependencies[name]
}
sdkManifest.files = [...new Set([...(sdkManifest.files || []), 'collab.js'])]
write(sdk + '/package.json', JSON.stringify(sdkManifest, null, 2) + '\n', 'Include Webpack4 collab subpath shim')
write(sdk + '/collab.js', shim, 'Webpack4 physical lark-doc/collab subpath')
const binaryFiles = new Set()
const modulesRoot = sdk + '/node_modules'
function collectBinaries(modules) {
  for (const entry of fs.readdirSync(modules, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw Error('Do not transform symlinked dependencies')
    if (!entry.isDirectory()) continue
    const root = path.join(modules, entry.name)
    const packages = entry.name.startsWith('@') ? fs.readdirSync(root).map(name => path.join(root, name)) : [root]
    for (const directory of packages) {
      if (!fs.existsSync(path.join(directory, 'package.json'))) continue
      const pkg = json(path.join(directory, 'package.json'))
      const bins = typeof pkg.bin === 'string' ? [pkg.bin] : Object.values(pkg.bin || {})
      bins.forEach(bin => binaryFiles.add(path.resolve(directory, bin)))
      const nested = path.join(directory, 'node_modules')
      if (fs.existsSync(nested)) collectBinaries(nested)
    }
  }
}
collectBinaries(modulesRoot)
const pm = sdk + '/node_modules/@tiptap/pm'
const manifest = json(pm + '/package.json')
for (const [subpath, entry] of Object.entries(manifest.exports)) {
  if (!subpath.startsWith('./') || !entry || typeof entry !== 'object' || !entry.import) continue
  const name = subpath.slice(2)
  const rawPackage = 'prosemirror-' + name
  if (!fs.existsSync(sdk + '/node_modules/' + rawPackage + '/package.json')) throw Error('Missing ProseMirror runtime: ' + name)
  const folder = pm + '/' + name
  fs.mkdirSync(folder, { recursive: true })
  write(folder + '/index.js', `export * from ${JSON.stringify(rawPackage)};\n`, 'Webpack4 physical PM subpath; preserve SDK browser mapping to raw PM constructors')
}

function syntaxCompatible(code) {
  acorn.parse(code.replace(/\bimport\s*\(/g, '__dynamicImport('), { ecmaVersion: 2018, sourceType: 'module', allowReturnOutsideFunction: true, allowHashBang: true })
}
const syntaxErrors = []
function transpile(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isSymbolicLink()) throw Error('Do not transform symlinked dependencies')
    if (entry.isDirectory()) { transpile(file); continue }
    if (!/\.(?:js|mjs|cjs)$/.test(entry.name) || binaryFiles.has(file)) continue
    const code = fs.readFileSync(file, 'utf8')
    try { syntaxCompatible(code); continue } catch (_) {}
    const transformed = babel.transformSync(code, {
      filename: file,
      babelrc: false,
      configFile: false,
      sourceType: 'unambiguous',
      sourceMaps: false,
      inputSourceMap: false,
      comments: true,
      shouldPrintComment: comment => !/^[@#]\s*sourceMappingURL\s*=/.test(comment.trim()),
      presets: [[path.join(tools, '@babel/preset-env'), { targets: { chrome: '64', node: '14.21' }, modules: false, useBuiltIns: false, bugfixes: true }]],
    }).code
    // Babel filters only true source-map comments; string contents and license comments stay intact.
    const output = transformed + '\n'
    try { syntaxCompatible(output) } catch (error) { syntaxErrors.push({ file: path.relative(sdk, file), error: error.message }); continue }
    write(file, output, 'Syntax-only ES2018 compatibility; no polyfill or module rewriting')
  }
}
transpile(sdk + '/node_modules')
if (syntaxErrors.length) throw Error(JSON.stringify(syntaxErrors))
fs.writeFileSync(auditFile, JSON.stringify({ sdk, changed, total: changed.length }, null, 2))
console.log(JSON.stringify({ changed: changed.length, syntaxTransforms: changed.filter(c => c.reason.startsWith('Syntax')).length, preservedCommandLineEntries: binaryFiles.size }))
