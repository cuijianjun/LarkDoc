#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { builtinModules } from 'node:module'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { artifactFiles, gzipBytes } = require('./artifact-graph')
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
    const imports = parse(source, { ecmaVersion: 2018, sourceType: 'module' }).body.filter(node => node.type === 'ImportDeclaration').map(node => node.source.value)
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
  const targets = { 'lark-doc.esm.js': 'esm', 'lark-doc.common.js': 'cjs', 'lark-doc-element.umd.min.js': 'element', 'lark-doc-collab.esm.js': 'collab', 'lark-doc-lite.esm.js': 'lite' }
  const graphs = JSON.parse(readFileSync(resolve(DIST, 'lark-doc-graph.json'), 'utf8'))
  for (const budget of pkg['size-limit']) {
    const file = budget.path.replace(/^dist\//, '')
    const target = targets[file]
    const initial = artifactFiles(DIST, target, false)
    const all = artifactFiles(DIST, target, true)
    const external = target === 'cjs' ? externalPmFiles(graphs[target]) : []
    const externalBytes = external.reduce((total, file) => total + gzipSync(readFileSync(file)).length, 0)
    const bytes = gzipBytes(DIST, initial) + externalBytes
    const measured = budget.scope === 'editor' ? initial.filter(file => !(graphs[target][file] || graphs.pm?.[file]).runtime) : initial
    const budgetBytes = gzipBytes(DIST, measured) + (budget.scope === 'editor' ? 0 : externalBytes)
    const match = budget.limit.match(/^([\d.]+)\s*(KB|MB|B)$/i)
    const limit = Number(match[1]) * ({ B: 1, KB: 1000, MB: 1000000 }[match[2].toUpperCase()])
    console.log(`${target}: ${budget.scope === 'editor' ? '编辑器' : '初始图'}预算对象 ${budgetBytes} B gzip / ${limit} B；全部初始 ${bytes} B；含动态区块 ${gzipBytes(DIST, all) + externalBytes} B；${initial.length}/${all.length} 文件${external.length ? `，含外部 PM ${external.length} 文件/${externalBytes} B` : ''}`)
    if (budgetBytes > limit) { console.error(`✗ ${target} 超过预算`); failed = true }
  }
}
if (failed) process.exit(1)
console.log('✓ Rollup 产物检查通过（入口存在、模块格式和协同 external 满足约束）')
