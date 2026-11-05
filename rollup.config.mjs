import 'core-js/features/array/at.js'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { builtinModules } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json'
import postcss from 'rollup-plugin-postcss'
import { getBabelOutputPlugin } from '@rollup/plugin-babel'
import terser from '@rollup/plugin-terser'
import { parse } from 'acorn'

const ROOT = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(ROOT, 'dist')
const builtins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)])
const collabPeers = new Set([
  'yjs',
  '@tiptap/extension-collaboration',
  '@tiptap/extension-collaboration-caret',
  '@hocuspocus/provider',
])
export const featureNames = ['math', 'mermaid', 'highlight', 'markdown', 'office', 'ui']
const ELEMENT_UI_ENTRY = '\0lark-doc-element-ui:'
const elementUiModules = {
  panels: ['createCommentPanel', 'createSaveVersionDialog', 'createVersionPanel'],
  dialogs: ['createEmbedDialog', 'createHelpDrawer', 'createLinkDialog', 'createMathDialog', 'createTablePickerDialog'],
  extendedOverlays: ['createExtendedOverlays'],
  colorPalette: ['createColorPalette'], revision: ['createRevisionPanels'], isvPanel: ['createIsvPanel'],
  reminder: ['createReminder'], calendarSearch: ['createCalendarSearch'], searchPanel: ['createSearchPanel'],
  commandMenu: ['createCommandMenu'],
}

export const PM_NAMES = ['state', 'model', 'view', 'transform', 'commands', 'keymap', 'inputrules', 'schema-list', 'history', 'gapcursor', 'dropcursor', 'tables', 'changeset']
const PM_ENTRY = '\0lark-doc-pm:'
const MERMAID_ENTRY = '\0lark-doc-mermaid'
export const MERMAID_FILES = { mermaidEsm: 'lark-doc-mermaid-runtime.esm.js', mermaidCjs: 'lark-doc-mermaid-runtime.common.js' }
const mermaidEsmTargets = new Set(['esm', 'full', 'legacyEsm', 'elementEsm', 'feature:mermaid'])
const mermaidCjsTargets = new Set(['cjs', 'fullCjs', 'legacy'])

export function mermaidTarget(target) {
  return mermaidEsmTargets.has(target) ? 'mermaidEsm' : mermaidCjsTargets.has(target) ? 'mermaidCjs' : null
}

function pmName(id) {
  const name = id.startsWith('@tiptap/pm/') ? id.slice('@tiptap/pm/'.length) : id.startsWith('prosemirror-') ? id.slice('prosemirror-'.length) : null
  return PM_NAMES.includes(name) ? name : null
}

export function isRuntimeChunk(chunk) {
  const modules = Object.keys(chunk.modules)
  const pmPackage = /node_modules\/(?:@tiptap\/pm\/|prosemirror-[^/]+\/|orderedmap\/|rope-sequence\/|w3c-keyname\/|crelt\/)/
  if (modules.length && modules.every(id => id === '\0commonjsHelpers.js' || pmPackage.test(id.replace(/\\/g, '/')) ||
    (id.startsWith(PM_ENTRY) && PM_NAMES.includes(id.slice(PM_ENTRY.length))))) return true
  const packages = chunk.name === 'polyfills'
    ? /node_modules\/core-js\//
    : chunk.name === 'tiptap'
      ? /node_modules\/(?:@tiptap\/|prosemirror-[^/]+\/|orderedmap\/|rope-sequence\/|w3c-keyname\/|crelt\/|linkifyjs\/)/
      : null
  return Boolean(packages && modules.some(id => packages.test(id)) && modules.every(id =>
    id === '\0commonjsHelpers.js' || packages.test(id.replace(/\\/g, '/'))))
}

function compatibilityPlugins(format) {
  const babel = getBabelOutputPlugin({ allowAllFormats: true, compact: true, presets: [['@babel/preset-env', { targets: { chrome: '64', node: '14.21' }, modules: false, bugfixes: true }]] })
  // webpack4未正确识别具名类表达式的内部作用域，短类名与import别名撞名会构造错误对象。
  // UMD 中 Babel 生成的辅助函数需封在局部作用域，避免污染宿主全局并允许安全改名。
  const minify = terser({ maxWorkers: 2, ecma: 2018, keep_classnames: format === 'es', enclose: format === 'umd', format: { comments: false }, compress: { passes: format === 'umd' ? 3 : 1 } })
  return [{
    ...babel,
    renderChunk(code, chunk, output) {
      try {
        // webpack4支持dynamic import；这里只检查其余语法是否还需要Babel处理。
        parse(code.replace(/\bimport\s*\(/g, '__dynamicImport('), { ecmaVersion: 2018, sourceType: 'module' })
        return null
      } catch (_) { return babel.renderChunk.call(this, code, chunk, output) }
    },
  }, {
    ...minify,
    renderChunk(code, chunk, output) {
      // vendored Mermaid已压缩；再次压缩整棵树显著拖慢构建而不改变按需边界。
      if (Object.keys(chunk.modules).some(id => id.includes('/assets/vendor/mermaid/'))) return null
      return minify.renderChunk.call(this, code, chunk, output)
    },
  }]
}

function isBare(id) {
  return !id.startsWith('.') && !isAbsolute(id) && !id.startsWith('\0')
}

function packageAlias(target = '') {
  const aliases = new Map([
    ['lark-doc/katex.css', resolve(ROOT, 'src/styles/vendor/katex.css')],
    ['lark-doc/mermaid-vendor', resolve(ROOT, 'src/assets/vendor/mermaid/mermaid.min.js')],
    ...(['lite', 'element'].includes(target) ? [
      ['katex', resolve(ROOT, 'src/core/features/stub.js')],
      ['docx', resolve(ROOT, 'src/core/features/stub.js')],
      ['marked', resolve(ROOT, 'src/core/features/stub.js')],
      ['turndown', resolve(ROOT, 'src/core/features/stub.js')],
      ['mammoth/mammoth.browser', resolve(ROOT, 'src/core/features/stub.js')],
      ['mammoth/mammoth.browser.js', resolve(ROOT, 'src/core/features/stub.js')],
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
      if (target === 'element' && importer?.startsWith(resolve(ROOT, 'src/components/lark-doc/editor') + '/') && source.startsWith('../../../ui/')) {
        const name = source.slice('../../../ui/'.length).replace(/\.js$/, '')
        if (elementUiModules[name]) return ELEMENT_UI_ENTRY + name
      }
      // 独立 Element 已注册同目录特性脚本；只替换出口层的重复实现，不影响特性包自身。
      if (target === 'element' && importer === resolve(ROOT, 'src/utils/export/index.js') &&
        (source === './markdown.js' || source === './docx.js')) return resolve(ROOT, 'src/core/features/stub.js')
      if (aliases.has(source)) return aliases.get(source)
      if (source.startsWith('lark-doc/')) {
        const relative = source.slice('lark-doc/'.length)
        const candidate = resolve(ROOT, 'src', relative)
        if (existsSync(candidate) || existsSync(`${candidate}.js`)) return candidate
      }
      return null
    },
    load(id) {
      if (!id.startsWith(ELEMENT_UI_ENTRY)) return null
      const name = id.slice(ELEMENT_UI_ENTRY.length)
      const visible = name === 'extendedOverlays' ? ',s=>s.linkHoverOpen||s.confirmOpen||s.relationOpen||s.codeLangOpen'
        : name === 'revision' ? ',s=>s.items&&s.items.length>0'
          : ''
      return `import {createDeferredUi} from ${JSON.stringify(resolve(ROOT, 'src/features/element-ui.js'))};` +
        (name === 'panels' ? `export {createOutlinePanel} from ${JSON.stringify(resolve(ROOT, 'src/ui/panels.js'))};` : '') +
        elementUiModules[name].map(factory => `export const ${factory}=options=>createDeferredUi(${JSON.stringify(factory)},options${factory === 'createSaveVersionDialog' ? ',s=>s.open||s.notice' : visible});`).join('')
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

function externals(target, format) {
  return (id) => {
    if (builtins.has(id)) return true
    if (id === 'lark-doc/mermaid-vendor' && mermaidTarget(target)) return true
    if (target !== 'pm' && format !== 'umd' && (id.startsWith('@tiptap/pm/') || id.startsWith('prosemirror-'))) return true
    if ((target === 'collab' || target === 'collabCjs') && (collabPeers.has(id) || [...collabPeers].some((peer) => id.startsWith(`${peer}/`)))) return true
    if ((target === 'plugin' || target === 'pluginCjs') && isBare(id)) return true
    return false
  }
}

export function inlineCssImports() {
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
        result.messages.push({ type: 'dependency', plugin: 'lark-doc-inline-css-imports', file })
        return inline(readFileSync(file, 'utf8'), dirname(file), seen)
      })
      root.removeAll()
      root.append(inline(readFileSync(sourceFile, 'utf8'), baseDir))
    },
  }
}
inlineCssImports.postcss = true

export function cssInjection(target) {
  if (!['element', 'elementEsm', 'feature:math:umd'].includes(target)) return false
  return (variable, id) => {
    const fonts = [...new Set([...readFileSync(id, 'utf8').matchAll(/url\(["']?(\.\/fonts\/[^"')]+)["']?\)/g)].map(match => match[1]))]
    let rebase = ''
    if (fonts.length && target === 'elementEsm') {
      // 静态字面量 URL 让 Vite 等宿主能逐个识别并搬运字体，原生 ESM 同样按 chunk 定位。
      const urls = fonts.map(file => `${JSON.stringify(file)}:new URL(${JSON.stringify(file)},import.meta.url).href`).join(',')
      rebase = `var urls={${urls}};${variable}=${variable}.replace(/url\\((["']?)((?:\\.\\/)?fonts\\/[^"')]+)\\1\\)/g,function(all,quote,file){var url=urls[file]||urls["./"+file];return url?"url("+url+")":all});`
    } else if (fonts.length) {
      rebase = `var script=document.currentScript;var base=script&&script.src?script.src:document.baseURI;${variable}=${variable}.replace(/url\\((["']?)((?:\\.\\/)?fonts\\/[^"')]+)\\1\\)/g,function(all,quote,file){return "url("+new URL(file,base).href+")"});`
    }
    return `\nif(typeof document!=="undefined"){${rebase}var style=document.createElement("style");style.textContent=${variable};(document.head||document.documentElement).appendChild(style);}`
  }
}

function plugins(target, cssFile) {
  return [
    ...(MERMAID_FILES[target] ? [{
      name: 'lark-doc-mermaid-entry',
      resolveId(id) { return id === MERMAID_ENTRY ? id : null },
      load(id) { return id === MERMAID_ENTRY ? `export { default } from ${JSON.stringify(resolve(ROOT, 'src/assets/vendor/mermaid/mermaid.min.js'))}` : null },
    }] : []),
    ...(target === 'pm' ? [{
      name: 'lark-doc-pm-entries',
      resolveId(id) { return id.startsWith(PM_ENTRY) ? id : null },
      load(id) { return id.startsWith(PM_ENTRY) ? `export * from '@tiptap/pm/${id.slice(PM_ENTRY.length)}'` : null },
    }] : []),
    packageAlias(target),
    noWebpackGlobals(),
    nodeResolve({ browser: !target.startsWith('plugin'), preferBuiltins: target.startsWith('plugin'), extensions: ['.mjs', '.js', '.json'] }),
    commonjs({ transformMixedEsModules: true }),
    json(),
    postcss({
      plugins: [inlineCssImports(), ...(target === 'feature:math' ? [{
        postcssPlugin: 'lark-doc-feature-font-paths',
        Declaration(declaration) { declaration.value = declaration.value.replace(/url\((["']?)\.\/fonts\//g, 'url($1../fonts/') },
      }] : [])],
      inject: cssInjection(target),
      extract: cssFile || false,
      minimize: target === 'element' || target === 'elementEsm' || target === 'feature:math:umd',
      sourceMap: false,
    }),
  ]
}

const targets = {
  ...Object.fromEntries(Object.entries(MERMAID_FILES).map(([name, file]) => [name, {
    input: MERMAID_ENTRY,
    format: name === 'mermaidEsm' ? 'es' : 'cjs',
    file,
    entryFileNames: file,
    inlineDynamicImports: true,
    css: null,
  }])),
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
    inlineDynamicImports: false,
    css: 'lark-doc.css',
  },
  element: {
    input: resolve(ROOT, 'src/web-component/standalone.js'),
    format: 'umd',
    file: 'lark-doc-element.umd.min.js',
    entryFileNames: 'lark-doc-element.umd.min.js',
    inlineDynamicImports: true,
    name: 'LarkDoc',
    css: null,
  },
  elementEsm: {
    input: resolve(ROOT, 'src/web-component/index.js'),
    format: 'es',
    file: 'lark-doc-element.esm.js',
    entryFileNames: 'lark-doc-element.esm.js',
    chunkFileNames: 'lark-doc-element-[name]-[hash].esm.js',
    inlineDynamicImports: false,
    css: null,
  },
  legacy: {
    input: resolve(ROOT, 'src/legacy-vue/index.js'),
    format: 'cjs',
    file: 'lark-doc-vue2.common.js',
    entryFileNames: 'lark-doc-vue2.common.js',
    inlineDynamicImports: false,
    css: 'lark-doc.css',
  },
  legacyEsm: {
    input: resolve(ROOT, 'src/legacy-vue/index.js'),
    format: 'es',
    file: 'lark-doc-vue2.esm.js',
    entryFileNames: 'lark-doc-vue2.esm.js',
    inlineDynamicImports: false,
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
  collabCjs: {
    input: resolve(ROOT, 'src/collab/index.js'),
    format: 'cjs',
    file: 'lark-doc-collab.common.js',
    entryFileNames: 'lark-doc-collab.common.js',
    inlineDynamicImports: true,
    css: null,
  },
  pm: {
    input: Object.fromEntries(PM_NAMES.map(name => [`pm/${name}`, `${PM_ENTRY}${name}`])),
    format: 'es',
    dir: DIST,
    entryFileNames: '[name].js',
    chunkFileNames: 'pm/lark-doc-pm-[name]-[hash].js',
    inlineDynamicImports: false,
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

targets.full = { ...targets.esm, input: resolve(ROOT, 'src/full.js'), file: 'lark-doc-full.esm.js', entryFileNames: 'lark-doc-full.esm.js', chunkFileNames: 'lark-doc-full-[name]-[hash].esm.js' }
targets.fullCjs = { ...targets.cjs, input: resolve(ROOT, 'src/full.js'), file: 'lark-doc-full.common.js', entryFileNames: 'lark-doc-full.common.js', chunkFileNames: 'lark-doc-full-[name]-[hash].common.js' }

function featureTarget(name, format = 'es') {
  return {
    input: resolve(ROOT, `src/features/${name}.js`),
    format,
    ...(format === 'umd' ? { file: `lark-doc-element.umd.min.${name}.js` } : { dir: DIST }),
    entryFileNames: format === 'umd' ? `lark-doc-element.umd.min.${name}.js` : `features/${name}.js`,
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
    paths(id) {
      if (id === 'lark-doc/mermaid-vendor' && mermaidTarget(normalizedTarget)) {
        return `${normalizedTarget.startsWith('feature:') ? '..' : '.'}/${MERMAID_FILES[mermaidTarget(normalizedTarget)]}`
      }
      const name = pmName(id)
      if (!name || normalizedTarget === 'pm' || selected.format === 'umd') return id
      if (selected.format === 'cjs' || normalizedTarget === 'collab') return `@tiptap/pm/${name}`
      return `${normalizedTarget.startsWith('feature:') ? '..' : '.'}/pm/${name}.js`
    },
    ...(['esm', 'cjs', 'full', 'fullCjs', 'lite', 'legacy', 'legacyEsm', 'elementEsm'].includes(normalizedTarget) ? { manualChunks(id) {
      if (normalizedTarget === 'full' || normalizedTarget === 'fullCjs') {
        if (/node_modules\/docx\//.test(id)) return 'feature-docx'
        if (/node_modules\/mammoth\//.test(id)) return 'feature-mammoth'
        if (/node_modules\/katex\//.test(id)) return 'feature-katex'
        if (/node_modules\/highlight\.js\//.test(id)) return 'feature-highlight'
        if (/node_modules\/(?:marked|turndown)\//.test(id)) return 'feature-markdown'
      }
      if (/node_modules\/(?:@tiptap\/|(?:@tiptap\/pm\/node_modules\/)?prosemirror-)/.test(id)) return 'tiptap'
      if (id.includes('/node_modules/core-js/')) return 'polyfills'
    } } : {}),
    sourcemap: false,
    // Rollup本身不降级依赖语法；公开ESM也会被webpack4的module字段选中。
    plugins: compatibilityPlugins(selected.format),
    ...(selected.name ? { name: selected.name } : {}),
    ...(['cjs', 'umd'].includes(selected.format) ? { exports: normalizedTarget === 'mermaidCjs' ? 'default' : 'named', interop: 'auto' } : {}),
  }
  return {
    input: selected.input,
    external: externals(normalizedTarget, selected.format),
    plugins: plugins(normalizedTarget, selected.css),
    output,
    // Mermaid UMD 是完整第三方运行时，无可裁剪的公开子集；避免反复深入分析其压缩 AST。
    treeshake: MERMAID_FILES[normalizedTarget] ? false : true,
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
const defaultTarget = process.env.ROLLUP_TARGET?.split(',')[0].trim() || undefined
export default getRollupConfig(['features', 'all', 'core'].includes(defaultTarget) ? 'esm' : defaultTarget)
