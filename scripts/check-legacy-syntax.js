'use strict'

/** webpack4支持dynamic import；其他公开浏览器区块及CJS保持ES2018语法。 */
const fs = require('fs')
const path = require('path')
const acorn = require('acorn')
const { artifactFiles } = require('./artifact-graph')
const DIST = path.resolve(__dirname, '../dist')
const graphs = JSON.parse(fs.readFileSync(path.join(DIST, 'lark-doc-graph.json'), 'utf8'))
const files = new Map()
for (const target of Object.keys(graphs)) {
  // 构建期插件运行在Node14，允许import.meta；不交给webpack4的浏览器解析器。
  if (target.startsWith('plugin')) continue
  for (const file of artifactFiles(DIST, target)) {
    files.set(file, { ecmaVersion: target === 'elementEsm' ? 2020 : 2018, sourceType: target.endsWith(':umd') || target === 'element' || target === 'cjs' || target === 'mermaidCjs' || target === 'collabCjs' || target === 'fullCjs' || target === 'legacy' ? 'script' : 'module' })
  }
}
const failures = []
for (const [file, { sourceType, ecmaVersion }] of files) {
  const source = fs.readFileSync(path.join(DIST, file), 'utf8')
  try {
    acorn.parse(source.replace(/\bimport\s*\(/g, '__dynamicImport('), { ecmaVersion, sourceType, allowReturnOutsideFunction: sourceType === 'script' })
  } catch (error) {
    failures.push(`${file}: ${error.message}`)
  }
}
if (failures.length) {
  console.error(`✗ ES2018语法检查失败 ${failures.length}/${files.size}\n${failures.join('\n')}`)
  process.exit(1)
}
console.log(`✓ 产物语法检查通过：${files.size}个真实入口与静态/动态区块；根ESM/CJS/UMD为ES2018，现代Element ESM允许import.meta（acorn ${require('acorn/package.json').version}；dynamic import由webpack4集成验证）`)
