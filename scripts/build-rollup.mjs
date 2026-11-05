#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { rollup } from 'rollup'
import { createHash } from 'node:crypto'
import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getRollupConfig, isRuntimeChunk, mermaidTarget, MERMAID_FILES, PM_NAMES } from '../rollup.config.mjs'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const DIST = resolve(ROOT, 'dist')
const requestedTarget = process.env.ROLLUP_TARGET || process.argv[2] || 'esm'
const target = requestedTarget === 'features' ? 'features' : requestedTarget
const CACHE_FILE = resolve(ROOT, '_codex/rollup-inputs.json')
let inputCache = {}
try {
  const cached = JSON.parse(readFileSync(CACHE_FILE, 'utf8'))
  if (cached && typeof cached === 'object' && !Array.isArray(cached)) inputCache = cached
} catch (_) { /* 首次构建或缓存损坏时重新生成。 */ }
const rollupCaches = new Map()
const verifiedBuilds = new Map()
const runtimeAssets = [
  ['src/styles', 'src/styles'],
  ['src/components/lark-doc', 'src/components/lark-doc'],
  ['src/assets/fonts/katex', 'fonts'],
]

function filesUnder(root, directory) {
  const files = []
  for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true })) {
    const file = `${directory}/${entry.name}`
    if (entry.isDirectory()) files.push(...filesUnder(root, file))
    else files.push(file)
  }
  return files.sort()
}

function fileHash(file) {
  const data = readFileSync(file)
  return { size: data.length, hash: createHash('sha256').update(data).digest('hex') }
}

function fileRecords(root, files) {
  return Object.fromEntries([...new Set(files)].sort().map(file => [file, fileHash(resolve(root, file))]))
}

function recordsFingerprint(records) {
  return createHash('sha256').update(process.versions.node.split('.')[0])
    .update(JSON.stringify(Object.entries(records).sort(([a], [b]) => a.localeCompare(b)))).digest('hex')
}

export function inputFingerprint(files, root = ROOT) {
  return recordsFingerprint(fileRecords(root, files))
}

function readGraph(dist = DIST) {
  try {
    const graph = JSON.parse(readFileSync(resolve(dist, 'lark-doc-graph.json'), 'utf8'))
    return graph && typeof graph === 'object' && !Array.isArray(graph) ? graph : {}
  } catch (_) { return {} }
}

function graphFingerprint(graph) {
  return createHash('sha256').update(JSON.stringify(graph)).digest('hex')
}

function assertExpectedOutputs(name, outputs, dist) {
  for (const file of expectedFiles(name)) {
    if (!outputs.includes(file) || !existsSync(resolve(dist, file)) || statSync(resolve(dist, file)).size === 0) {
      throw new Error(`Rollup 构建结束但产物缺失或为空：${file}`)
    }
  }
}

export function normalizeOutput(output, options, dist = DIST) {
  const directory = options.dir || dirname(options.file)
  const names = new Map(output.map(item => [item.fileName, relative(dist, resolve(directory, item.fileName)).replace(/\\/g, '/')]))
  return output.map(item => {
    const dependency = file => {
      if (names.has(file)) return names.get(file)
      const mapped = typeof options.paths === 'function' ? options.paths(file) : options.paths?.[file] || file
      const fromChunk = relative(dist, resolve(directory, dirname(item.fileName), mapped)).replace(/\\/g, '/')
      return mapped.startsWith('.') && ([...names.values()].includes(fromChunk) || fromChunk.startsWith('pm/') || Object.values(MERMAID_FILES).includes(fromChunk)) ? fromChunk : mapped
    }
    return {
      ...item, fileName: names.get(item.fileName),
      ...(item.type === 'chunk' ? { imports: item.imports.map(dependency), dynamicImports: item.dynamicImports.map(dependency) } : {}),
    }
  })
}

export function realInputFiles(files) {
  return files.filter(file => typeof file === 'string' && !file.includes('\0') && existsSync(file) && statSync(file).isFile())
}

export function rollupCacheGroup(name) {
  if (name === 'full' || name === 'fullCjs' || MERMAID_FILES[name]) return null
  // UMD 必须内联 vendor，不能沿用 ESM 已缓存的 external 解析结果。
  if (name.endsWith(':umd')) return 'featureUmd'
  return name === 'lite' || name === 'element' || name === 'pm' ? name : name.startsWith('plugin') ? 'plugin' : name.startsWith('collab') ? 'collab' : 'default'
}

export function inputSnapshotPlugin(captureInput) {
  return {
    name: 'record-build-inputs',
    load(id) { captureInput(id); return null },
    shouldTransformCachedModule({ id }) { captureInput(id); return id.endsWith('.css') ? true : null },
  }
}

export function cleanStaleChunks(target, graphs, recorded, dist = DIST) {
  if (target !== 'all' || targetsFor('all').some(name => !graphs[name] || !Object.keys(graphs[name]).length)) return []
  const live = new Set()
  for (const graph of Object.values(graphs)) {
    if (!graph || typeof graph !== 'object' || Array.isArray(graph)) return []
    for (const [file, chunk] of Object.entries(graph)) {
      if (!chunk || typeof chunk !== 'object') return []
      live.add(file)
      for (const dependency of [...(chunk.imports || []), ...(chunk.dynamicImports || [])]) live.add(dependency)
    }
  }
  const removed = []
  for (const file of [...new Set(recorded)].sort()) {
    // 只删既有记录中的根目录哈希 chunk；公开入口、子目录和未知文件均保留。
    if (!( /^lark-doc-[\w.-]+-[a-f0-9]{8}\.(?:esm\.js|common\.js|mjs|js)$/.test(file) || /^pm\/lark-doc-pm-[\w.-]+-[a-f0-9]{8}\.js$/.test(file)) || live.has(file)) continue
    const path = resolve(dist, file)
    if (existsSync(path) && statSync(path).isFile()) {
      unlinkSync(path)
      removed.push(file)
    }
  }
  return removed
}

export function canReuseBuild(name, previous, { root = ROOT, dist = DIST } = {}) {
  try {
    if (!previous || !Array.isArray(previous.outputs) || !previous.outputs.length || !previous.outputHashes) return false
    if (JSON.stringify(filesUnder(root, 'src')) !== JSON.stringify(previous.sources)) return false
    assertExpectedOutputs(name, previous.outputs, dist)
    if (inputFingerprint(previous.inputs, root) !== previous.fingerprint) return false
    for (const file of previous.outputs) {
      if (JSON.stringify(fileHash(resolve(dist, file))) !== JSON.stringify(previous.outputHashes[file])) return false
    }
    const graph = readGraph(dist)[name]
    return Boolean(graph && Object.keys(graph).length && graphFingerprint(graph) === previous.graphHash &&
      expectedFiles(name).every(file => graph[file]?.entry))
  } catch (_) { return false }
}

export function assertStableInputs(started, inputs, root = ROOT) {
  const before = Object.fromEntries(inputs.map(file => [file, started[file]]))
  const after = fileRecords(root, inputs)
  if (inputs.some(file => !before[file]) || recordsFingerprint(before) !== recordsFingerprint(after)) {
    throw new Error('构建期间输入发生变化，未写入缓存；请在文件稳定后重新构建')
  }
  return recordsFingerprint(after)
}

function assertNodeVersion() {
  const [major] = process.versions.node.split('.').map(Number)
  if (major < 14) throw new Error(`Rollup 构建要求 Node >=14，当前为 ${process.versions.node}`)
}

export function targetsFor(name) {
  if (name.includes(',')) return [...new Set(name.split(',').map(target => target.trim()).filter(Boolean).flatMap(targetsFor))]
  let names
  if (name === 'all') names = ['esm', 'cjs', 'full', 'fullCjs', 'element', 'elementEsm', 'legacy', 'legacyEsm', 'lite', 'adapters', 'collab', 'collabCjs', 'plugin', 'pluginCjs', ...['math', 'mermaid', 'highlight', 'markdown', 'office'].flatMap((feature) => [`feature:${feature}`, `feature:${feature}:umd`])]
  else if (name === 'full') names = ['full', 'fullCjs']
  else if (name === 'core') names = ['esm', 'cjs']
  else if (name === 'features') names = ['math', 'mermaid', 'highlight', 'markdown', 'office'].flatMap((feature) => [`feature:${feature}`, `feature:${feature}:umd`])
  else if (name === 'plugin') names = ['plugin', 'pluginCjs']
  else if (name === 'vue2' || name === 'legacy') names = ['legacy', 'legacyEsm']
  else if (name === 'collab') names = ['collab', 'collabCjs']
  else names = [name]
  const needsPM = names.some(target => ['esm', 'full', 'lite', 'legacyEsm', 'elementEsm', 'adapters', 'plugin'].includes(target) ||
    (target.startsWith('feature:') && !target.endsWith(':umd')))
  return [...new Set([...(needsPM ? ['pm'] : []), ...names.map(mermaidTarget).filter(Boolean), ...names])]
}

function expectedFiles(name) {
  const files = {
    ...Object.fromEntries(Object.entries(MERMAID_FILES).map(([name, file]) => [name, [file]])),
    esm: ['lark-doc.esm.js'],
    cjs: ['lark-doc.common.js'],
    full: ['lark-doc-full.esm.js'],
    fullCjs: ['lark-doc-full.common.js'],
    lite: ['lark-doc-lite.esm.js'],
    element: ['lark-doc-element.umd.min.js'],
    elementEsm: ['lark-doc-element.esm.js'],
    legacy: ['lark-doc-vue2.common.js'],
    legacyEsm: ['lark-doc-vue2.esm.js'],
    adapters: ['lark-doc-vue3.mjs', 'lark-doc-react.mjs', 'lark-doc-templates.mjs', 'lark-doc-comments.mjs', 'lark-doc-versioning.mjs', 'lark-doc-providers.mjs', 'lark-doc-migrations.mjs'],
    collab: ['lark-doc-collab.esm.js'],
    collabCjs: ['lark-doc-collab.common.js'],
    pm: PM_NAMES.map(name => `pm/${name}.js`),
    plugin: ['plugin.mjs'],
    pluginCjs: ['plugin.cjs'],
  }
  if (name.startsWith('feature:')) {
    const [, feature, variant] = name.split(':')
    return [variant === 'umd' ? `lark-doc-element.umd.min.${feature}.js` : `features/${feature}.js`]
  }
  return files[name] || []
}

async function buildOne(name) {
  const config = getRollupConfig(name)
  const commonInputs = ['package.json', 'package-lock.json', 'rollup.config.mjs', 'scripts/build-rollup.mjs', 'style.css']
  const previous = inputCache[name]
  if (canReuseBuild(name, previous)) {
    verifiedBuilds.set(name, previous)
    console.log(`✓ Rollup ${name} 输入未变，复用既有产物`)
    return
  }
  const sources = filesUnder(ROOT, 'src')
  const started = fileRecords(ROOT, [...commonInputs, ...sources])
  const scannedCss = new Set()
  const captureInput = file => {
    if (!existsSync(file) || !statSync(file).isFile()) return
    const key = relative(ROOT, file)
    if (!started[key]) started[key] = fileHash(file)
    // 内联器会直接读子 CSS，必须在读取前记录，不能只依赖 Rollup 的模块 load。
    if (file.endsWith('.css') && !scannedCss.has(file)) {
      scannedCss.add(file)
      for (const match of readFileSync(file, 'utf8').matchAll(/@import\s+["']([^"']+)["']\s*;?/g)) {
        if (match[1].startsWith('.') && match[1].endsWith('.css')) captureInput(resolve(dirname(file), match[1]))
      }
    }
  }
  const cacheGroup = rollupCacheGroup(name)
  // full 静态图很大；进入前释放普通图，且不把 full AST 留给下一个 target。
  if (cacheGroup === null) rollupCaches.clear()
  const bundle = await rollup({
    cache: cacheGroup === null ? false : rollupCaches.get(cacheGroup),
    input: config.input,
    external: config.external,
    plugins: [inputSnapshotPlugin(captureInput), ...config.plugins],
    treeshake: config.treeshake,
    onwarn: config.onwarn,
  })
  try {
    const result = await bundle.write(config.output)
    const output = normalizeOutput(result.output, config.output)
    const outputs = output.map(item => item.fileName)
    assertExpectedOutputs(name, outputs, DIST)
    if (JSON.stringify(filesUnder(ROOT, 'src')) !== JSON.stringify(sources)) throw new Error('构建期间源码文件清单发生变化，未写入缓存')
    const inputs = [...new Set([...Object.keys(started), ...realInputFiles(bundle.watchFiles).map(file => relative(ROOT, file))])].sort()
    const fingerprint = assertStableInputs(started, inputs)
    if (cacheGroup !== null) rollupCaches.set(cacheGroup, bundle.cache)
    const graph = readGraph()
    graph[name] = Object.fromEntries(output.filter(item => item.type === 'chunk').map(item => [item.fileName, {
      entry: item.isEntry, runtime: isRuntimeChunk(item), modules: Object.keys(item.modules).map(id => id.replace(`${ROOT}/`, '')).sort(),
      imports: item.imports, dynamicImports: item.dynamicImports,
    }]))
    writeFileSync(resolve(DIST, 'lark-doc-graph.json'), `${JSON.stringify(graph, null, 2)}\n`)
    verifiedBuilds.set(name, { inputs, sources, fingerprint, outputs, graphHash: graphFingerprint(graph[name]) })
  } finally {
    await bundle.close()
  }
  console.log(`✓ Rollup ${name} 产物已生成：${expectedFiles(name).join(', ')}`)
}

function inlinePublishedCssImports() {
  const file = resolve(DIST, 'lark-doc.css')
  if (!existsSync(file)) return
  const inline = (css, directory, seen = new Set()) => css.replace(/@import\s+["']([^"']+)["']\s*;?/g, (statement, request) => {
    if (!request.startsWith('.') || !request.endsWith('.css')) return statement
    const source = resolve(directory, request)
    if (!existsSync(source) || seen.has(source)) return statement
    seen.add(source)
    return inline(readFileSync(source, 'utf8'), dirname(source), seen)
  })
  writeFileSync(file, inline(readFileSync(file, 'utf8'), DIST))
}

function copyRuntimeAssets() {
  // fs.cpSync在Node14不存在；复制范围只包含包内确定的CSS和字体目录。
  const copyDirectory = (source, target) => {
    mkdirSync(target, { recursive: true })
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      const from = resolve(source, entry.name)
      const to = resolve(target, entry.name)
      if (entry.isDirectory()) copyDirectory(from, to)
      else copyFileSync(from, to)
    }
  }
  for (const [source, target] of runtimeAssets) {
    if (!existsSync(resolve(ROOT, source))) throw new Error(`静态资源源目录不存在：${source}`)
    copyDirectory(resolve(ROOT, source), resolve(DIST, target))
  }
  console.log(`✓ Rollup 静态资源已复制：${resolve(DIST, 'fonts')}`)
}

function writeManifest(names) {
  const manifest = {
    version: JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).version,
    generatedBy: 'rollup',
    core: { esm: 'lark-doc.esm.js', cjs: 'lark-doc.common.js', element: 'lark-doc-element.umd.min.js', elementEsm: 'lark-doc-element.esm.js' },
    vue2: { cjs: 'lark-doc-vue2.common.js', esm: 'lark-doc-vue2.esm.js' },
    adapters: { vue3: 'lark-doc-vue3.mjs', react: 'lark-doc-react.mjs' },
    features: Object.fromEntries(['math', 'mermaid', 'highlight', 'markdown', 'office'].map((name) => [name, {
      esm: `features/${name}.js`,
      umd: `lark-doc-element.umd.min.${name}.js`,
    }])),
    full: { esm: 'lark-doc-full.esm.js', cjs: 'lark-doc-full.common.js' },
    collab: { esm: 'lark-doc-collab.esm.js', cjs: 'lark-doc-collab.common.js' },
    pm: Object.fromEntries(PM_NAMES.map(name => [name, `pm/${name}.js`])),
    mermaid: MERMAID_FILES,
    built: names,
  }
  writeFileSync(resolve(DIST, 'lark-doc-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
}

async function main() {
  assertNodeVersion()
  mkdirSync(DIST, { recursive: true })
  const recorded = [
    ...Object.values(readGraph()).flatMap(graph => graph && typeof graph === 'object' ? Object.keys(graph) : []),
    ...Object.values(inputCache).flatMap(entry => Array.isArray(entry?.outputs) ? entry.outputs : []),
  ]
  const names = targetsFor(target)
  for (const name of names) await buildOne(name)
  copyRuntimeAssets()
  inlinePublishedCssImports()
  writeManifest(names)
  const assets = runtimeAssets.flatMap(([source, target]) => filesUnder(ROOT, source).map(file => `${target}${file.slice(source.length)}`))
  for (const [name, entry] of verifiedBuilds) {
    if (JSON.stringify(filesUnder(ROOT, 'src')) !== JSON.stringify(entry.sources) || inputFingerprint(entry.inputs) !== entry.fingerprint) {
      throw new Error(`Rollup ${name} 构建期间输入发生变化，未写入缓存`)
    }
    const outputs = [...new Set([...entry.outputs, ...assets])].sort()
    assertExpectedOutputs(name, outputs, DIST)
    inputCache[name] = { ...entry, outputs, outputHashes: fileRecords(DIST, outputs) }
    if (!canReuseBuild(name, inputCache[name])) throw new Error(`Rollup ${name} 产物或构建图验证失败，未写入缓存`)
  }
  // 所有 target、后处理、静态资源和真实输出校验成功后才提交持久缓存。
  const removed = cleanStaleChunks(target, readGraph(), recorded)
  if (removed.length) console.log(`✓ Rollup 清理旧哈希区块：${removed.length} 个`)
  mkdirSync(dirname(CACHE_FILE), { recursive: true })
  writeFileSync(CACHE_FILE, JSON.stringify(inputCache))
  console.log(`✓ Rollup ${target} 全量构建完成，manifest 已写入 dist/lark-doc-manifest.json`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`✗ Rollup ${target} 构建失败`)
    console.error(error && error.stack ? error.stack : error)
    process.exit(1)
  })
}
