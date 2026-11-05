'use strict'

const fs = require('fs')
const path = require('path')
const { gzipSync } = require('zlib')

/** 使用Rollup产出的真实边，不根据入口壳大小或某一种chunk命名猜测依赖。 */
function artifactFiles(dist, target, includeDynamic = true) {
  const graphs = JSON.parse(fs.readFileSync(path.join(dist, 'lark-doc-graph.json'), 'utf8'))
  const graph = graphs[target]
  if (!graph) throw new Error(`缺少 ${target} 构建图，请先构建相应产物`)
  const sharedTargets = { 'lark-doc-mermaid-runtime.esm.js': 'mermaidEsm', 'lark-doc-mermaid-runtime.common.js': 'mermaidCjs' }
  const visited = new Set()
  const visit = file => {
    if (visited.has(file)) return
    // Root只记录稳定的pm/name.js边；PM更新后始终沿最新共图，不能用旧Root中的PM节点。
    const owner = file.startsWith('pm/') ? 'pm' : sharedTargets[file]
    const item = owner ? graphs[owner] && graphs[owner][file] : graph[file]
    if (!item) {
      // Rollup 对本地产物记录相对文件名；bare external不属于发布区块。
      if (/\.(?:c?js|mjs)$/.test(file) || file.startsWith('.')) throw new Error(`构建图缺少本地区块：${file}`)
      return
    }
    visited.add(file)
    if (!fs.existsSync(path.join(dist, file))) throw new Error(`依赖区块缺失：${file}`)
    for (const dependency of [...item.imports, ...(includeDynamic ? item.dynamicImports : [])]) visit(dependency)
  }
  for (const file of Object.keys(graph)) if (graph[file].entry) visit(file)
  if (!visited.size) throw new Error(`${target} 没有可验证入口`)
  return [...visited]
}

function gzipBytes(dist, files) {
  return files.reduce((total, file) => total + gzipSync(fs.readFileSync(path.join(dist, file))).length, 0)
}

module.exports = { artifactFiles, gzipBytes }
