#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { rollup } from 'rollup'
import { getRollupConfig } from '../rollup.config.mjs'

const ROOT = resolve(new URL('..', import.meta.url).pathname)
const DIST = resolve(ROOT, 'dist')
const requestedTarget = process.env.ROLLUP_TARGET || process.argv[2] || 'esm'
const target = requestedTarget === 'features' ? 'features' : requestedTarget

function assertNodeVersion() {
  const [major] = process.versions.node.split('.').map(Number)
  if (major < 14) throw new Error(`Rollup 构建要求 Node >=14，当前为 ${process.versions.node}`)
}

function targetsFor(name) {
  if (name === 'all') return ['esm', 'cjs', 'element', 'legacy', 'legacyEsm', 'lite', 'adapters', 'collab', 'plugin', 'pluginCjs', ...['math', 'mermaid', 'highlight', 'markdown', 'office'].flatMap((feature) => [`feature:${feature}`, `feature:${feature}:umd`])]
  if (name === 'core') return ['esm', 'cjs']
  if (name === 'features') return ['math', 'mermaid', 'highlight', 'markdown', 'office'].flatMap((feature) => [`feature:${feature}`, `feature:${feature}:umd`])
  if (name === 'lite') return ['lite']
  if (name === 'plugin') return ['plugin', 'pluginCjs']
  if (name === 'vue2') return ['legacy', 'legacyEsm']
  if (name === 'legacy') return ['legacy', 'legacyEsm']
  return [name]
}

function expectedFiles(name) {
  const files = {
    esm: ['lark-doc.esm.js'],
    cjs: ['lark-doc.common.js'],
    lite: ['lark-doc-lite.esm.js'],
    element: ['lark-doc-element.umd.min.js'],
    legacy: ['lark-doc-vue2.common.js'],
    legacyEsm: ['lark-doc-vue2.esm.js'],
    adapters: ['lark-doc-vue3.mjs', 'lark-doc-react.mjs', 'lark-doc-templates.mjs', 'lark-doc-comments.mjs', 'lark-doc-versioning.mjs', 'lark-doc-providers.mjs', 'lark-doc-migrations.mjs'],
    collab: ['lark-doc-collab.esm.js'],
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
  const bundle = await rollup({
    input: config.input,
    external: config.external,
    plugins: config.plugins,
    treeshake: config.treeshake,
    onwarn: config.onwarn,
  })
  await bundle.write(config.output)
  await bundle.close()
  for (const file of expectedFiles(name)) {
    const path = resolve(DIST, file)
    if (!existsSync(path) || statSync(path).size === 0) throw new Error(`Rollup 构建结束但产物缺失或为空：${path}`)
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
  const cssSources = [
    resolve(ROOT, 'src/styles'),
    resolve(ROOT, 'src/components/lark-doc'),
  ]
  for (const sourceDir of cssSources) {
    if (!existsSync(sourceDir)) throw new Error(`CSS 源目录不存在：${sourceDir}`)
    const relative = sourceDir.endsWith('/src/styles') ? 'src/styles' : 'src/components/lark-doc'
    cpSync(sourceDir, resolve(DIST, relative), { recursive: true })
  }
  const source = resolve(ROOT, 'src/assets/fonts/katex')
  const target = resolve(DIST, 'fonts')
  if (!existsSync(source)) throw new Error(`字体源目录不存在：${source}`)
  cpSync(source, target, { recursive: true })
  console.log(`✓ Rollup 静态资源已复制：${target}`)
}

function writeManifest(names) {
  const manifest = {
    version: '0.14.2',
    generatedBy: 'rollup',
    core: { esm: 'lark-doc.esm.js', cjs: 'lark-doc.common.js', element: 'lark-doc-element.umd.min.js' },
    vue2: { cjs: 'lark-doc-vue2.common.js', esm: 'lark-doc-vue2.esm.js' },
    adapters: { vue3: 'lark-doc-vue3.mjs', react: 'lark-doc-react.mjs' },
    features: Object.fromEntries(['math', 'mermaid', 'highlight', 'markdown', 'office'].map((name) => [name, {
      esm: `features/${name}.js`,
      umd: `lark-doc-element.umd.min.${name}.js`,
    }])),
    built: names,
  }
  writeFileSync(resolve(DIST, 'lark-doc-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
}

async function main() {
  assertNodeVersion()
  mkdirSync(DIST, { recursive: true })
  const names = targetsFor(target)
  for (const name of names) await buildOne(name)
  copyRuntimeAssets()
  inlinePublishedCssImports()
  writeManifest(names)
  console.log(`✓ Rollup ${target} 全量构建完成，manifest 已写入 dist/lark-doc-manifest.json`)
}

main().catch((error) => {
  console.error(`✗ Rollup ${target} 构建失败`)
  console.error(error && error.stack ? error.stack : error)
  process.exit(1)
})
