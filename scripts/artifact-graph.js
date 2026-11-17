'use strict'

const fs = require('fs')
const path = require('path')
const { gzipSync } = require('zlib')

/** Reexports establish the same static external edge as an import declaration. */
function staticModuleRequests(source) {
  const { parse } = require('acorn')
  return parse(source, { ecmaVersion: 2020, sourceType: 'module' }).body
    .filter(node => ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.source)
    .map(node => node.source.value)
}

/** 使用Rollup产出的真实边，不根据入口壳大小或某一种chunk命名猜测依赖。 */
function artifactFiles(dist, target, includeDynamic = true) {
  const graphs = JSON.parse(fs.readFileSync(path.join(dist, 'lark-doc-graph.json'), 'utf8'))
  const graph = graphs[target]
  if (!graph) throw new Error(`缺少 ${target} 构建图，请先构建相应产物`)
  const sharedTargets = { 'lark-doc-mermaid-runtime.esm.js': 'mermaidEsm', 'lark-doc-mermaid-runtime.common.js': 'mermaidCjs', 'lark-doc-element.runtime.umd.min.js': 'elementRuntime' }
  const classicFeatures = []
  if (includeDynamic && ['element', 'elementRuntime'].includes(target)) {
    // Classic feature scripts are real dynamic edges even though DOM script
    // insertion cannot appear in Rollup's imports/dynamicImports metadata.
    const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'lark-doc-manifest.json'), 'utf8'))
    if (!manifest.features || typeof manifest.features !== 'object' || Array.isArray(manifest.features)) throw new Error('缺少 classic 特性清单')
    for (const [name, feature] of Object.entries(manifest.features)) {
      if (typeof feature.umd !== 'string' || !feature.umd.endsWith('.js')) throw new Error(`classic 特性清单无效：${name}`)
      sharedTargets[feature.umd] = `feature:${name}:umd`
      classicFeatures.push(feature.umd)
    }
  }
  const visited = new Set()
  const visit = (file, currentGraph = graph) => {
    if (visited.has(file)) return
    // Root只记录稳定的pm/name.js边；PM更新后始终沿最新共图，不能用旧Root中的PM节点。
    const owner = file.startsWith('pm/') ? 'pm' : sharedTargets[file]
    const ownerGraph = owner ? graphs[owner] : currentGraph
    const item = ownerGraph && ownerGraph[file]
    if (!item) {
      // Rollup 对本地产物记录相对文件名；bare external不属于发布区块。
      if (/\.(?:c?js|mjs)$/.test(file) || file.startsWith('.')) throw new Error(`构建图缺少本地区块：${file}`)
      return
    }
    visited.add(file)
    if (!fs.existsSync(path.join(dist, file))) throw new Error(`依赖区块缺失：${file}`)
    for (const dependency of [...item.imports, ...(includeDynamic ? item.dynamicImports : [])]) visit(dependency, ownerGraph)
  }
  for (const file of Object.keys(graph)) if (graph[file].entry) visit(file)
  // The Element entry appends this script eagerly. It is an initial dependency
  // even though Rollup cannot express a DOM script loader as an import edge.
  if (target === 'element') visit('lark-doc-element.runtime.umd.min.js')
  for (const file of classicFeatures) visit(file)
  if (!visited.size) throw new Error(`${target} 没有可验证入口`)
  return [...visited]
}

function gzipBytes(dist, files) {
  return files.reduce((total, file) => total + gzipSync(fs.readFileSync(path.join(dist, file))).length, 0)
}

module.exports = { artifactFiles, gzipBytes, staticModuleRequests }
