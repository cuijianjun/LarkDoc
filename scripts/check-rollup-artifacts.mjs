#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { builtinModules } from 'node:module'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { artifactFiles, gzipBytes, staticModuleRequests } = require('./artifact-graph')
const { parse } = require('acorn')

const ROOT = resolve(new URL('..', import.meta.url).pathname)
const DIST = resolve(ROOT, 'dist')
const checks = [
  { file: 'lark-doc.css', required: ['.lark-doc-toolbar', '.lark-doc-topbar', '.katex'], forbidden: [] },
  { file: 'lark-doc.esm.js', required: ['export'], forbidden: ['__webpack_require__', '__webpack_public_path__'] },
  { file: 'lark-doc.common.js', required: ['exports.'], forbidden: ['__webpack_public_path__', '__webpack_require__', 'featureLoader'] },
  { file: 'lark-doc-element.umd.min.js', required: ['LarkDoc'], forbidden: ['__webpack_require__', '__webpack_public_path__'] },
  { file: 'lark-doc-vue3.mjs', required: ['export'], forbidden: ['require(', 'module.exports'] },
  { file: 'lark-doc-react.mjs', required: ['export'], forbidden: ['require(', 'module.exports'] },
  { file: 'lark-doc-collab.esm.js', imports: ['yjs', '@tiptap/extension-collaboration'], forbidden: ['class YDoc', 'module.exports'] },
  { file: 'lark-doc-manifest.json', required: ['"generatedBy": "rollup"'], forbidden: [] },
]

let failed = false
if (existsSync(resolve(DIST, 'lark-doc-manifest.json'))) {
  const manifest = JSON.parse(readFileSync(resolve(DIST, 'lark-doc-manifest.json'), 'utf8'))
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'))
  if (manifest.version !== pkg.version) {
    console.error(`✗ 产物版本 ${manifest.version} 与 package.json ${pkg.version} 不一致，请重新构建`)
    failed = true
  }
}
for (const check of checks) {
  const path = resolve(DIST, check.file)
  if (!existsSync(path) || statSync(path).size === 0) {
    console.error(`✗ 缺少 Rollup 产物：${check.file}`)
    failed = true
    continue
  }
  const source = readFileSync(path, 'utf8')
  if (check.imports) {
    const imports = staticModuleRequests(source)
    for (const dependency of check.imports) if (!imports.includes(dependency)) {
      console.error(`✗ ${check.file} 未保留 external：${dependency}`)
      failed = true
    }
  }
  for (const text of check.required || []) {
    if (!source.includes(text)) {
      console.error(`✗ ${check.file} 未满足检查：${text}`)
      failed = true
    }
  }
  for (const text of check.forbidden || []) {
    if (source.includes(text)) {
      console.error(`✗ ${check.file} 命中禁用内容：${text}`)
      failed = true
    }
  }
}

// The optional native-browser entry must resolve without an import map, through its full closure.
const browserGraphFile = resolve(DIST, 'lark-doc-graph.json')
if (existsSync(browserGraphFile)) {
  const graphs = JSON.parse(readFileSync(browserGraphFile, 'utf8'))
  for (const target of ['elementEsm', 'collabBrowser']) {
    const duplicated = Object.entries(graphs[target] || {}).flatMap(([file, item]) => file.startsWith('pm/') ? [] :
      (item.modules || []).filter(id => /(?:^|\/)node_modules\/(?:@tiptap\/pm\/|prosemirror-[^/]+\/)/.test(id.replace(/\\/g, '/'))))
    if (duplicated.length) { console.error(`✗ ${target} 内联了 ${duplicated.length} 个 PM 模块，未共享发布的 PM 身份`); failed = true }
  }
  const graph = graphs.collabBrowser
  if (graph) {
    const visited = new Set()
    const inspect = file => {
      if (visited.has(file)) return
      visited.add(file)
      const code = readFileSync(file, 'utf8'), ast = parse(code, { ecmaVersion: 2022, sourceType: 'module' })
      const visit = node => {
        if (!node || typeof node !== 'object') return
        const dependency = node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration' ? node.source?.value : node.type === 'ImportExpression' ? node.source?.value : null
        if (typeof dependency === 'string') {
          if (!dependency.startsWith('.')) { console.error(`✗ 浏览器协同存在裸导入：${dependency}`); failed = true }
          else inspect(resolve(dirname(file), dependency))
        }
        Object.values(node).forEach(value => { if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') visit(value) })
      }
      visit(ast)
    }
    for (const [file, entry] of Object.entries(graph)) if (entry.entry) inspect(resolve(DIST, file))
  }
}

// CJS 外部 PM 仍属于宿主初始代码；按真实 require 闭包计量，避免外置后虚减体积。
function externalPmFiles(graph) {
  const files = new Set()
  const builtins = new Set(builtinModules.map(name => name.replace(/^node:/, '')))
  const visit = (dependency, parent) => {
    if (builtins.has(dependency.replace(/^node:/, ''))) return
    const file = createRequire(parent).resolve(dependency)
    if (files.has(file)) return
    files.add(file)
    if (!/\.(?:c?js|mjs)$/.test(file)) return
    const ast = parse(readFileSync(file, 'utf8'), { ecmaVersion: 2020, sourceType: 'script' })
    const walk = node => {
      if (!node || typeof node !== 'object') return
      if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'require' && node.arguments[0]?.type === 'Literal' && typeof node.arguments[0].value === 'string') {
        visit(node.arguments[0].value, file)
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(walk)
        else if (value && typeof value === 'object') walk(value)
      }
    }
    walk(ast)
  }
  for (const item of Object.values(graph)) {
    for (const dependency of item.imports || []) {
      if (dependency.startsWith('prosemirror-')) visit(dependency, resolve(ROOT, 'package.json'))
      else if (dependency.startsWith('@tiptap/pm/')) visit(dependency, resolve(ROOT, 'package.json'))
    }
  }
  return [...files]
}

if (process.argv.includes('--size')) {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'))
  const targets = { 'lark-doc.esm.js': 'esm', 'lark-doc.common.js': 'cjs', 'lark-doc-element.umd.min.js': 'element', 'lark-doc-element.runtime.umd.min.js': 'elementRuntime', 'lark-doc-element.polyfills.umd.min.js': 'elementPolyfills', 'lark-doc-collab.esm.js': 'collab', 'lark-doc-lite.esm.js': 'lite' }
  // Element 拆两条预算：引导文件走应用加载路径，runtime 惰性拉取。两者分开卡，
  // 否则把 runtime 移出加载路径的改动会让单文件口径看起来毫无收益。
  const RUNTIME_FILE = 'lark-doc-element.runtime.umd.min.js'
  const SCOPE_LABEL = { editor: '编辑器', bootstrap: '引导文件', lazy: '惰性 runtime' }
  const graphs = JSON.parse(readFileSync(resolve(DIST, 'lark-doc-graph.json'), 'utf8'))
  for (const budget of pkg['size-limit']) {
    const file = budget.path.replace(/^dist\//, '')
    const target = targets[file]
    if (!target) { console.error(`✗ size-limit 条目没有对应的构建图：${budget.path}`); failed = true; continue }
    const initial = artifactFiles(DIST, target, false)
    const all = artifactFiles(DIST, target, true)
    const external = target === 'cjs' ? externalPmFiles(graphs[target]) : []
    const externalBytes = external.reduce((total, file) => total + gzipSync(readFileSync(file)).length, 0)
    const bytes = gzipBytes(DIST, initial) + externalBytes
    const measured = budget.scope === 'editor'
      ? initial.filter(file => !(graphs[target][file] || graphs.pm?.[file]).runtime)
      : budget.scope === 'bootstrap'
        ? initial.filter(file => file !== RUNTIME_FILE)
        : initial
    const budgetBytes = gzipBytes(DIST, measured) + (budget.scope === 'editor' ? 0 : externalBytes)
    const match = budget.limit.match(/^([\d.]+)\s*(KB|MB|B)$/i)
    const limit = Number(match[1]) * ({ B: 1, KB: 1000, MB: 1000000 }[match[2].toUpperCase()])
    console.log(`${target}: ${SCOPE_LABEL[budget.scope] || '初始图'}预算对象 ${budgetBytes} B gzip / ${limit} B；全部初始 ${bytes} B；含动态区块 ${gzipBytes(DIST, all) + externalBytes} B；${measured.length}/${all.length} 文件${external.length ? `，含外部 PM ${external.length} 文件/${externalBytes} B` : ''}`)
    if (budgetBytes > limit) { console.error(`✗ ${target} 超过预算`); failed = true }
  }
}
if (failed) process.exit(1)
console.log('✓ Rollup 产物检查通过（入口存在、模块格式和协同 external 满足约束）')
