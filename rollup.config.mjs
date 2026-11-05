import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { builtinModules } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json'
import postcss from 'rollup-plugin-postcss'

const ROOT = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(ROOT, 'dist')
const builtins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)])
const collabPeers = new Set([
  'yjs',
  '@tiptap/extension-collaboration',
  '@tiptap/extension-collaboration-caret',
  '@hocuspocus/provider',
])
const featureNames = ['math', 'mermaid', 'highlight', 'markdown', 'office']

function isBare(id) {
  return !id.startsWith('.') && !isAbsolute(id) && !id.startsWith('\0')
}

function packageAlias(target = '') {
  const aliases = new Map([
    ...(target === 'lite' ? [
      ['katex', resolve(ROOT, 'src/core/features/stub.js')],
      ['docx', resolve(ROOT, 'src/core/features/stub.js')],
      ['marked', resolve(ROOT, 'src/core/features/stub.js')],
      ['turndown', resolve(ROOT, 'src/core/features/stub.js')],
      ['mammoth/mammoth.browser', resolve(ROOT, 'src/core/features/stub.js')],
      ['lark-doc/mermaid-vendor', resolve(ROOT, 'src/core/features/stub.js')],
      ['lark-doc/katex.css', resolve(ROOT, 'src/core/features/empty.css')],
      ['highlight.js/lib/core.js', resolve(ROOT, 'src/core/features/stub.js')],
      ['highlight.js/lib/languages/javascript.js', resolve(ROOT, 'src/core/features/stub.js')],
      ['highlight.js/lib/languages/typescript.js', resolve(ROOT, 'src/core/features/stub.js')],
      ['highlight.js/lib/languages/json.js', resolve(ROOT, 'src/core/features/stub.js')],
      ['highlight.js/lib/languages/css.js', resolve(ROOT, 'src/core/features/stub.js')],
      ['highlight.js/lib/languages/xml.js', resolve(ROOT, 'src/core/features/stub.js')],
      ['highlight.js/lib/languages/python.js', resolve(ROOT, 'src/core/features/stub.js')],
      ['highlight.js/lib/languages/bash.js', resolve(ROOT, 'src/core/features/stub.js')],
      ['highlight.js/lib/languages/sql.js', resolve(ROOT, 'src/core/features/stub.js')],
    ] : []),
    ['lark-doc/katex.css', resolve(ROOT, 'src/styles/vendor/katex.css')],
    ['lark-doc/mermaid-vendor', resolve(ROOT, 'src/assets/vendor/mermaid/mermaid.min.js')],
    ['lark-doc/templates', resolve(ROOT, 'src/templates.js')],
    ['lark-doc/comments', resolve(ROOT, 'src/comments.js')],
    ['lark-doc/versioning', resolve(ROOT, 'src/versioning.js')],
    ['lark-doc/providers', resolve(ROOT, 'src/providers.js')],
    ['lark-doc/migrations', resolve(ROOT, 'src/migrations.js')],
    ['lark-doc', resolve(ROOT, 'src/index.js')],
  ])
  return {
    name: 'lark-doc-package-alias',
    resolveId(source, importer) {
      if (aliases.has(source)) return aliases.get(source)
      if (source.startsWith('lark-doc/')) {
        const relative = source.slice('lark-doc/'.length)
        const candidate = resolve(ROOT, 'src', relative)
        if (existsSync(candidate) || existsSync(`${candidate}.js`)) return candidate
      }
      return null
    },
  }
}

function noWebpackGlobals() {
  return {
    name: 'lark-doc-no-webpack-globals',
    transform(code, id) {
      if (!id.includes(`${ROOT}/src/`)) return null
      // 仅清理历史源码中的 Webpack chunk 命名注释；动态 import 保留为标准
      // Rollup import()，不能伪造一个不存在的 featureLoader runtime。
      const next = code.replace(/\/\*\s*webpackChunkName:\s*["'][^"']+["']\s*\*\//g, '')
      return next === code ? null : { code: next, map: null }
    },
  }
}

function externals(target) {
  return (id) => {
    if (builtins.has(id)) return true
    if (target === 'collab' && (collabPeers.has(id) || [...collabPeers].some((peer) => id.startsWith(`${peer}/`)))) return true
    if (target === 'plugin' && isBare(id)) return true
    return false
  }
}

function inlineCssImports() {
  return {
    postcssPlugin: 'lark-doc-inline-css-imports',
    Once(root, { result }) {
      const sourceFile = result.opts.from
      const baseDir = sourceFile ? dirname(sourceFile) : ROOT
      const inline = (css, directory, seen = new Set()) => css.replace(/@import\s+["']([^"']+)["']\s*;?/g, (statement, request) => {
        if (!request.startsWith('.') || !request.endsWith('.css')) return statement
        const file = resolve(directory, request)
        if (!existsSync(file) || seen.has(file)) return statement
        seen.add(file)
        return inline(readFileSync(file, 'utf8'), dirname(file), seen)
      })
      root.removeAll()
      root.append(inline(readFileSync(sourceFile, 'utf8'), baseDir))
    },
  }
}
inlineCssImports.postcss = true

function plugins(target, cssFile) {
  return [
    packageAlias(target),
    noWebpackGlobals(),
    nodeResolve({ browser: target !== 'plugin', preferBuiltins: target === 'plugin', extensions: ['.mjs', '.js', '.json'] }),
    commonjs({ transformMixedEsModules: true }),
    json(),
    postcss({
      plugins: [inlineCssImports()],
      inject: target === 'element',
      extract: cssFile || false,
      minimize: target === 'element',
      sourceMap: false,
    }),
  ]
}

const targets = {
  lite: {
    input: resolve(ROOT, 'src/index.js'),
    format: 'es',
    file: 'lark-doc-lite.esm.js',
    entryFileNames: 'lark-doc-lite.esm.js',
    chunkFileNames: 'lark-doc-lite-[name]-[hash].esm.js',
    inlineDynamicImports: false,
    css: null,
  },
  esm: {
    input: resolve(ROOT, 'src/index.js'),
    format: 'es',
    file: 'lark-doc.esm.js',
    entryFileNames: 'lark-doc.esm.js',
    chunkFileNames: 'lark-doc-[name]-[hash].esm.js',
    inlineDynamicImports: false,
    css: 'lark-doc.css',
  },
  cjs: {
    input: resolve(ROOT, 'src/index.js'),
    format: 'cjs',
    file: 'lark-doc.common.js',
    entryFileNames: 'lark-doc.common.js',
    chunkFileNames: 'lark-doc-[name]-[hash].common.js',
    inlineDynamicImports: true,
    css: 'lark-doc.css',
  },
  element: {
    input: resolve(ROOT, 'src/web-component/index.js'),
    format: 'umd',
    file: 'lark-doc-element.umd.min.js',
    entryFileNames: 'lark-doc-element.umd.min.js',
    inlineDynamicImports: true,
    name: 'LarkDoc',
    css: null,
  },
  legacy: {
    input: resolve(ROOT, 'src/legacy-vue/index.js'),
    format: 'cjs',
    file: 'lark-doc-vue2.common.js',
    entryFileNames: 'lark-doc-vue2.common.js',
    inlineDynamicImports: true,
    css: 'lark-doc.css',
  },
  legacyEsm: {
    input: resolve(ROOT, 'src/legacy-vue/index.js'),
    format: 'es',
    file: 'lark-doc-vue2.esm.js',
    entryFileNames: 'lark-doc-vue2.esm.js',
    inlineDynamicImports: true,
    css: null,
  },
  adapters: {
    input: {
      'lark-doc-vue3': resolve(ROOT, 'src/adapters/vue3/index.js'),
      'lark-doc-react': resolve(ROOT, 'src/adapters/react/index.js'),
      'lark-doc-templates': resolve(ROOT, 'src/templates.js'),
      'lark-doc-comments': resolve(ROOT, 'src/comments.js'),
      'lark-doc-versioning': resolve(ROOT, 'src/versioning.js'),
      'lark-doc-providers': resolve(ROOT, 'src/providers.js'),
      'lark-doc-migrations': resolve(ROOT, 'src/migrations.js'),
    },
    format: 'es',
    dir: DIST,
    entryFileNames: '[name].mjs',
    chunkFileNames: 'lark-doc-adapter-[name]-[hash].mjs',
    inlineDynamicImports: false,
    css: null,
  },
  collab: {
    input: resolve(ROOT, 'src/collab/index.js'),
    format: 'es',
    file: 'lark-doc-collab.esm.js',
    entryFileNames: 'lark-doc-collab.esm.js',
    inlineDynamicImports: true,
    css: null,
  },
  plugin: {
    input: resolve(ROOT, 'src/plugin/index.js'),
    format: 'es',
    file: 'plugin.mjs',
    entryFileNames: 'plugin.mjs',
    inlineDynamicImports: true,
    css: null,
  },
  pluginCjs: {
    input: resolve(ROOT, 'src/plugin/index.js'),
    format: 'cjs',
    file: 'plugin.cjs',
    entryFileNames: 'plugin.cjs',
    inlineDynamicImports: true,
    css: null,
  },
}

function featureTarget(name, format = 'es') {
  return {
    input: resolve(ROOT, `src/features/${name}.js`),
    format,
    file: format === 'umd' ? `lark-doc-element.umd.min.${name}.js` : `features/${name}.js`,
    entryFileNames: format === 'umd' ? `lark-doc-element.umd.min.${name}.js` : `${name}.js`,
    inlineDynamicImports: true,
    name: format === 'umd' ? `LarkDocFeature${name[0].toUpperCase()}${name.slice(1)}` : undefined,
    css: name === 'math' && format === 'es' ? 'features/math.css' : null,
  }
}

export function getRollupConfig(target = process.env.ROLLUP_TARGET || 'esm') {
  const normalizedTarget = target === 'core' ? 'esm' : target === 'vue2' ? 'legacy' : target
  const selected = normalizedTarget.startsWith('feature:')
    ? featureTarget(normalizedTarget.slice('feature:'.length).replace(/:umd$/, ''), normalizedTarget.endsWith(':umd') ? 'umd' : 'es')
    : targets[normalizedTarget]
  if (!selected) throw new Error(`Unknown Rollup target: ${target}`)
  const output = {
    ...(selected.file && selected.inlineDynamicImports ? { file: resolve(DIST, selected.file) } : { dir: selected.dir || DIST }),
    format: selected.format,
    entryFileNames: selected.entryFileNames,
    chunkFileNames: selected.chunkFileNames || 'lark-doc-[name]-[hash].js',
    inlineDynamicImports: selected.inlineDynamicImports,
    sourcemap: false,
    ...(selected.name ? { name: selected.name } : {}),
    ...(['cjs', 'umd'].includes(selected.format) ? { exports: 'named', interop: 'auto' } : {}),
  }
  return {
    input: selected.input,
    external: externals(target),
    plugins: plugins(target, selected.css),
    output,
    treeshake: true,
    onwarn(warning, defaultHandler) {
      if (warning.code === 'CIRCULAR_DEPENDENCY') return
      // mammoth.browser.js 是第三方预构建文件，Rollup 会因其中历史性的
      // eval 实现发出 EVAL 警告；不改写 vendor 代码，只隐藏这个已知且
      // 无法由 lark-doc 源码修复的提示。
      if (warning.code === 'EVAL' && warning.id && warning.id.includes('/mammoth/')) return
      defaultHandler(warning)
    },
  }
}

export const ROLLUP_TARGETS = Object.keys(targets)
export const FEATURE_TARGETS = featureNames.flatMap((name) => [`feature:${name}`, `feature:${name}:umd`])
export default getRollupConfig(['features', 'all', 'core'].includes(process.env.ROLLUP_TARGET) ? 'esm' : undefined)
