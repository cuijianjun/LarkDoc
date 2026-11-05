import { describe, expect, it, vi } from 'vitest'
import { cssInjection, FEATURE_TARGETS, getRollupConfig, inlineCssImports, isRuntimeChunk, MERMAID_FILES, ROLLUP_TARGETS } from '../../rollup.config.mjs'
import { assertStableInputs, canReuseBuild, cleanStaleChunks, inputFingerprint, inputSnapshotPlugin, normalizeOutput, realInputFiles, rollupCacheGroup, targetsFor } from '../../scripts/build-rollup.mjs'
import pkg from '../../package.json'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import graph from '../../scripts/artifact-graph'
import { createHash } from 'node:crypto'
import { runInContext, runInNewContext } from 'node:vm'
import { rollup } from 'rollup'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { JSDOM } from 'jsdom'

const requireHere = createRequire(import.meta.url)
const pmNames = ['state', 'model', 'view', 'transform', 'commands', 'keymap', 'inputrules', 'schema-list', 'history', 'gapcursor', 'dropcursor', 'tables', 'changeset']

function evaluateCjsChunks(output, file, external = requireHere) {
  const loaded = new Map()
  const globals = {}
  const load = name => {
    if (loaded.has(name)) return loaded.get(name).exports
    const module = { exports: {} }
    loaded.set(name, module)
    runInNewContext(output.find(item => item.fileName === name).code, {
      module, exports: module.exports, globalThis: globals,
      require: request => request.startsWith('.') ? load(path.posix.normalize(path.posix.join(path.posix.dirname(name), request))) : external(request),
    })
    return module.exports
  }
  return { load, globals, exports: load(file) }
}

function cacheFixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lark-doc-build-contract-'))
  const dist = path.join(root, 'dist')
  fs.mkdirSync(dist)
  fs.mkdirSync(path.join(root, 'src/styles'), { recursive: true })
  const inputs = ['src/entry.js', 'src/styles/main.css', 'src/styles/child.css', 'src/font.woff2']
  inputs.forEach(file => fs.writeFileSync(path.join(root, file), file))
  const outputs = ['lark-doc.esm.js', 'lazy.js']
  outputs.forEach(file => fs.writeFileSync(path.join(dist, file), 'export const value = 1'))
  const targetGraph = {
    'lark-doc.esm.js': { entry: true, runtime: false, imports: ['lazy.js'], dynamicImports: [] },
    'lazy.js': { entry: false, runtime: false, imports: [], dynamicImports: [] },
  }
  fs.writeFileSync(path.join(dist, 'lark-doc-graph.json'), JSON.stringify({ esm: targetGraph }))
  const sha256 = value => createHash('sha256').update(value).digest('hex')
  const previous = {
    inputs, sources: [...inputs].sort(), fingerprint: inputFingerprint(inputs, root), outputs,
    outputHashes: Object.fromEntries(outputs.map(file => [file, { size: fs.statSync(path.join(dist, file)).size, hash: sha256(fs.readFileSync(path.join(dist, file))) }])),
    graphHash: sha256(JSON.stringify(targetGraph)),
  }
  const finish = () => fs.rmSync(root, { recursive: true, force: true })
  try {
    const result = run({ root, dist, previous, targetGraph })
    if (result?.then) return result.finally(finish)
    finish()
    return result
  } catch (error) { finish(); throw error }
}

describe('公开产物与轻量包边界', () => {
  it('full 是可构建且公开的入口', () => {
    expect(pkg.exports['./full']).toBeTruthy()
    expect(getRollupConfig('full').input).toMatch(/src\/full\.js$/)
  })

  it('lite 的真实 import 不被公共 alias 重新指向重依赖', () => {
    const alias = getRollupConfig('lite').plugins.find(plugin => plugin.name === 'lark-doc-package-alias')
    for (const id of ['lark-doc/mermaid-vendor', 'mammoth/mammoth.browser.js']) {
      expect(alias.resolveId(id)).toMatch(/features\/stub\.js$/)
    }
    expect(alias.resolveId('lark-doc/katex.css')).toMatch(/features\/empty\.css$/)
  })

  it('Element 仅从导出出口移除重复实现，普通入口与独立特性包保留真实依赖', () => {
    const importer = path.resolve(__dirname, '../../src/utils/export/index.js')
    const feature = path.resolve(__dirname, '../../src/features/markdown.js')
    const aliasFor = target => getRollupConfig(target).plugins.find(plugin => plugin.name === 'lark-doc-package-alias')
    const element = aliasFor('element')
    expect(element.resolveId('marked')).toMatch(/features\/stub\.js$/)
    for (const request of ['./markdown.js', './docx.js']) {
      expect(element.resolveId(request, importer)).toMatch(/features\/stub\.js$/)
      expect(element.resolveId(request, feature)).toBeNull()
      for (const target of ['esm', 'cjs', 'lite', 'elementEsm', 'feature:markdown:umd', 'feature:office:umd']) {
        expect(aliasFor(target).resolveId(request, importer)).toBeNull()
      }
    }
    expect(aliasFor('feature:markdown:umd').resolveId('marked')).toBeNull()
  })

  it('UI 延迟边界只影响 Element 编辑器，目录及其他入口保持同步真实实现', () => {
    const importer = path.resolve(__dirname, '../../src/components/lark-doc/editor/commandMenuUiMixin.js')
    const aliasFor = target => getRollupConfig(target).plugins.find(plugin => plugin.name === 'lark-doc-package-alias')
    const alias = aliasFor('element')
    for (const name of ['panels', 'dialogs', 'extendedOverlays', 'colorPalette', 'revision', 'isvPanel', 'reminder', 'calendarSearch', 'searchPanel', 'commandMenu']) {
      const source = `../../../ui/${name}`
      const id = alias.resolveId(source, importer)
      expect(id).toMatch(/^\0lark-doc-element-ui:/)
      expect(alias.load(id)).toContain('createDeferredUi')
      expect(alias.resolveId(source, path.resolve(__dirname, '../../src/features/ui.js'))).toBeNull()
      for (const target of ['esm', 'cjs', 'lite', 'elementEsm', 'feature:ui', 'feature:ui:umd']) {
        expect(aliasFor(target).resolveId(source, importer)).toBeNull()
      }
    }
    expect(alias.resolveId('../../../core/blocks/reminder', importer)).toBeNull()
    expect(alias.load(alias.resolveId('../../../ui/panels', importer))).toContain('export {createOutlinePanel} from')
    expect(targetsFor('all')).toContain('feature:ui:umd')
    expect(targetsFor('features')).toContain('feature:ui')
  })

  it('真实 UI 独立脚本按需去重、失败可重试，面板状态和事件互相隔离', async () => {
    const dom = new JSDOM('', { url: 'https://assets.test/page', runScripts: 'outside-only' })
    const context = dom.getInternalVMContext()
    const { document } = dom.window
    const script = document.createElement('script')
    script.src = 'https://assets.test/vendor/lark-doc-element.umd.min.js'
    Object.defineProperty(document, 'currentScript', { value: script, configurable: true })
    const config = getRollupConfig('element')
    const input = '\0element-ui-fixture'
    const root = path.resolve(__dirname, '../..')
    const source = `import ${JSON.stringify(path.join(root, 'src/features/element.js'))};export {createDeferredUi} from ${JSON.stringify(path.join(root, 'src/features/element-ui.js'))};export {default as commandMenuUiMixin} from ${JSON.stringify(path.join(root, 'src/components/lark-doc/editor/commandMenuUiMixin.js'))}`
    const bundle = await rollup({ ...config, input, plugins: [{ name: 'element-ui-fixture', resolveId: id => id === input ? id : null, load: id => id === input ? source : null }, ...config.plugins] })
    const feature = await rollup(getRollupConfig('feature:ui:umd'))
    try {
      const main = await bundle.generate(config.output)
      const built = await feature.generate(getRollupConfig('feature:ui:umd').output)
      const code = built.output.find(item => item.type === 'chunk').code
      expect(Object.keys(built.output[0].modules).some(id => /node_modules\/(?:@tiptap|prosemirror-)/.test(id))).toBe(false)
      runInContext(main.output[0].code, context)
      const scripts = []
      const append = document.head.appendChild.bind(document.head)
      document.head.appendChild = node => { if (node.tagName === 'SCRIPT') scripts.push(node); return append(node) }
      const hosts = [document.createElement('div'), document.createElement('div')]
      hosts.forEach(host => document.body.appendChild(host))
      const onQuery = vi.fn()
      const ui = hosts.map((host, index) => dom.window.LarkDoc.createDeferredUi('createSearchPanel', { host, handlers: index === 0 ? { onQuery } : {} }))
      const menuHost = document.createElement('div')
      document.body.appendChild(menuHost)
      const menuMethods = dom.window.LarkDoc.commandMenuUiMixin.methods
      const onReady = vi.fn(menu => { expect(menu.el.isConnected).toBe(true); menu.focusSearch(); expect(document.activeElement).toBe(menu.el.querySelector('input')) })
      const menuContext = { $refs: { commandMenuHost: menuHost }, commandMenuHandlers: () => ({}),
        menuOpen: false, onCommandMenuReady: onReady,
        buildCommandMenuState: () => ({ open: true, kind: 'plus', query: '', items: [], templates: [] }),
        refreshCommandMenu() { menuMethods.refreshCommandMenu.call(this) } }
      menuMethods.mountCommandMenu.call(menuContext)
      const settle = async () => { for (let i = 0; i < 24; i += 1) await Promise.resolve() }
      ui.forEach((panel, index) => panel.update({ open: true, query: `查询${index}` }))
      await settle()
      expect(scripts.map(node => node.src)).toEqual(['https://assets.test/vendor/lark-doc-element.umd.min.ui.js'])
      scripts[0].onerror()
      await settle()
      expect(hosts.every(host => host.querySelector('[role="alert"]'))).toBe(true)
      ;[...hosts, menuHost].forEach(host => host.querySelector('[role="alert"]').click())
      await settle()
      expect(scripts).toHaveLength(2)
      runInContext(code, context)
      scripts[1].onload()
      await settle()
      expect(onReady).toHaveBeenCalledOnce()
      menuMethods.destroyCommandMenu.call(menuContext)
      expect(hosts.map(host => host.querySelector('input').value)).toEqual(['查询0', '查询1'])
      const inputNode = hosts[0].querySelector('input')
      inputNode.value = '已修改'
      inputNode.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
      expect(onQuery).toHaveBeenCalledOnce()
      expect(hosts[1].querySelector('input').value).toBe('查询1')
      ui[0].destroy()
      expect(hosts[0].childNodes).toHaveLength(0)
      expect(hosts[1].querySelector('[role="search"]')).not.toBeNull()
      ui[1].update({ open: false })
      ui[1].update({ open: true, query: '重开' })
      expect(hosts[1].querySelector('input').value).toBe('重开')
      expect(scripts).toHaveLength(2)
      ui[1].destroy()
    } finally { await bundle.close(); await feature.close(); dom.window.close() }
  }, 30000)

  it('only editor entrypoints create manual runtime chunks; adapters do not create empty tiptap output', () => {
    expect(getRollupConfig('adapters').output.manualChunks).toBeUndefined()
    expect(getRollupConfig('esm').output.manualChunks).toBeTypeOf('function')
  })

  it.each(['full', 'fullCjs'])('%s statically splits heavy feature implementations and keeps synchronous registration', target => cacheFixture(async ({ dist }) => {
    const vendors = [
      ['/fixture/src/assets/vendor/mermaid/mermaid.min.js', 'mermaid'],
      ['/fixture/node_modules/docx/index.js', 'docx'],
      ['/fixture/node_modules/mammoth/mammoth.browser.js', 'mammoth'],
      ['/fixture/node_modules/katex/dist/katex.mjs', 'katex'],
      ['/fixture/node_modules/highlight.js/lib/core.js', 'highlight'],
      ['/fixture/node_modules/marked/lib/marked.esm.js', 'markdown'],
      ['/fixture/node_modules/turndown/lib/turndown.es.js', 'markdown'],
    ]
    const entry = '/fixture/src/full-fixture.js'
    const sources = new Map(vendors.map(([id, value]) => [id, `export const value = ${JSON.stringify(value)}`]))
    sources.set(entry, `${vendors.map(([id], index) => `import {value as v${index}} from ${JSON.stringify(id)}`).join(';')};export const registered=globalThis.fullFeatures=[${vendors.map((_, index) => `v${index}`).join(',')}]`)
    const config = getRollupConfig(target)
    const bundle = await rollup({ input: entry, plugins: [{ name: 'tiny-full-features', resolveId: id => sources.has(id) ? id : null, load: id => sources.get(id) }] })
    try {
      const { output } = await bundle.generate({ ...config.output, dir: dist, plugins: [] })
      const chunks = output.filter(item => item.type === 'chunk')
      const named = new Map(chunks.map(item => [item.name, item]))
      for (const name of ['docx', 'mammoth', 'katex', 'highlight', 'markdown']) {
        expect(named.has(`feature-${name}`)).toBe(true)
        expect(isRuntimeChunk(named.get(`feature-${name}`))).toBe(false)
      }
      expect(chunks.every(item => item.dynamicImports.length === 0)).toBe(true)
      const main = chunks.find(item => item.isEntry)
      const reachable = new Set()
      const visit = file => {
        if (reachable.has(file)) return
        reachable.add(file)
        chunks.find(item => item.fileName === file).imports.forEach(visit)
      }
      visit(main.fileName)
      expect(reachable.size).toBe(chunks.length)
      expect(isRuntimeChunk(main)).toBe(false)
      if (target === 'fullCjs') {
        const loaded = new Map()
        const state = {}
        const requireChunk = file => {
          if (loaded.has(file)) return loaded.get(file).exports
          const module = { exports: {} }
          loaded.set(file, module)
          runInNewContext(chunks.find(item => item.fileName === file).code, {
            module, exports: module.exports, globalThis: state,
            require: request => requireChunk(path.posix.normalize(path.posix.join(path.posix.dirname(file), request))),
          })
          return module.exports
        }
        expect(requireChunk(main.fileName).registered).toEqual(vendors.map(([, value]) => value))
        expect(state.fullFeatures).toEqual(vendors.map(([, value]) => value))
      }
    } finally { await bundle.close() }
  }))

  it('full AST caches are not retained across targets while ordinary ESM/CJS still share a cache group', () => {
    expect(rollupCacheGroup('full')).toBeNull()
    expect(rollupCacheGroup('fullCjs')).toBeNull()
    expect(rollupCacheGroup('esm')).toBe(rollupCacheGroup('cjs'))
  })

  it('normal ESM then CJS builds restore CommonJS proxy state through the real cached plugin hooks', () => cacheFixture(async ({ root }) => {
    const input = path.join(root, 'src/ordinary.cjs')
    fs.writeFileSync(input, 'module.exports=require("./dependency.cjs")')
    fs.writeFileSync(path.join(root, 'src/dependency.cjs'), 'module.exports={value:42}')
    let cache
    const captured = vi.fn()
    const tracker = inputSnapshotPlugin(captured)
    expect(tracker.shouldTransformCachedModule({ id: input })).toBeNull()
    expect(tracker.shouldTransformCachedModule({ id: 'style.css' })).toBe(true)
    for (const target of ['esm', 'cjs']) {
      const config = getRollupConfig(target)
      const bundle = await rollup({ input, cache, plugins: [inputSnapshotPlugin(captured), ...config.plugins] })
      try {
        const { output } = await bundle.generate({ ...config.output, plugins: [] })
        expect(output.some(item => item.type === 'chunk' && item.isEntry)).toBe(true)
        if (target === 'cjs') {
          const module = { exports: {} }
          runInNewContext(output.find(item => item.isEntry).code, { module, exports: module.exports })
          expect((module.exports.default || module.exports).value).toBe(42)
        }
        cache = bundle.cache
      } finally { await bundle.close() }
    }
    expect(captured).toHaveBeenCalledWith(input)
  }))

  it('only successful all builds remove recorded stale root hash chunks and preserve other targets/user files', () => cacheFixture(({ dist }) => {
    const old = 'lark-doc-index-01234567.esm.js'
    const oldPM = 'pm/lark-doc-pm-index-01234567.js'
    const active = 'lark-doc-index-89abcdef.common.js'
    const unknown = 'lark-doc-custom-12345678.esm.js'
    const keep = [active, unknown, 'lark-doc.esm.js', 'plugin.mjs', 'features/math.js']
    fs.mkdirSync(path.join(dist, 'features'))
    fs.mkdirSync(path.join(dist, 'pm'))
    for (const file of [old, oldPM, ...keep]) fs.writeFileSync(path.join(dist, file), 'fixture')
    const graphs = Object.fromEntries([...ROLLUP_TARGETS, ...FEATURE_TARGETS].map(name => [name, { [`${name.replace(/:/g, '-')}.js`]: { entry: true } }]))
    graphs.cjs[active] = { entry: false }
    const recorded = [old, oldPM, active, 'lark-doc.esm.js', 'plugin.mjs', 'features/math.js']
    expect(cleanStaleChunks('esm', graphs, recorded, dist)).toEqual([])
    expect(fs.existsSync(path.join(dist, old))).toBe(true)
    const partial = { ...graphs }
    delete partial.fullCjs
    expect(cleanStaleChunks('all', partial, recorded, dist)).toEqual([])
    expect(fs.existsSync(path.join(dist, old))).toBe(true)
    expect(cleanStaleChunks('all', { ...graphs, damaged: null }, recorded, dist)).toEqual([])
    expect(fs.existsSync(path.join(dist, old))).toBe(true)
    expect(cleanStaleChunks('all', graphs, recorded, dist)).toEqual([old, oldPM])
    expect(fs.existsSync(path.join(dist, old))).toBe(false)
    expect(fs.existsSync(path.join(dist, oldPM))).toBe(false)
    for (const file of keep) expect(fs.existsSync(path.join(dist, file))).toBe(true)
  }))

  it('element has separate native ESM splitting and standalone UMD inputs', () => {
    const esm = getRollupConfig('elementEsm')
    expect(esm.input).toMatch(/src\/web-component\/index\.js$/)
    expect(esm.output.format).toBe('es')
    expect(esm.output.entryFileNames).toBe('lark-doc-element.esm.js')
    expect(esm.output.inlineDynamicImports).toBe(false)
    expect(getRollupConfig('element').input).toMatch(/src\/web-component\/standalone\.js$/)
  })

  it('UMD 降级辅助函数不泄漏全局，且兼容浏览器、旧全局、AMD 和 CommonJS', async () => {
    const config = getRollupConfig('element')
    const bundle = await rollup({
      input: 'umd-compatibility-fixture',
      plugins: [{
        name: 'umd-compatibility-fixture',
        resolveId: id => id === 'umd-compatibility-fixture' ? id : null,
        load: () => 'export class Example { value = 7; read(options) { return options?.value ?? this.value } }',
      }],
    })
    try {
      const { output } = await bundle.generate(config.output)
      const code = output.find(item => item.type === 'chunk').code
      for (const mode of ['browser', 'legacy', 'amd', 'commonjs']) {
        let api
        const context = {}
        if (mode === 'legacy') context.globalThis = undefined
        if (mode === 'commonjs') {
          context.exports = {}
          context.module = { exports: context.exports }
        }
        if (mode === 'amd') {
          context.define = (dependencies, factory) => { api = {}; factory(api) }
          context.define.amd = {}
        }
        const before = Object.keys(context)
        runInNewContext(code, context)
        api = api || context.module?.exports || context.LarkDoc
        const instance = new api.Example()
        expect(instance.read()).toBe(7)
        expect(instance.read({ value: 0 })).toBe(0)
        expect(Object.getOwnPropertyDescriptor(instance, 'value')).toMatchObject({ enumerable: true, configurable: true, writable: true })
        expect(Object.keys(context).filter(key => !before.includes(key))).toEqual(mode === 'browser' || mode === 'legacy' ? ['LarkDoc'] : [])
      }
    } finally { await bundle.close() }
  }, 30000)

  it('Element 富导出通过真实独立脚本加载，Markdown/Word 保留结构和下载行为', async () => {
    const root = path.resolve(__dirname, '../..')
    const input = '\0element-export-fixture'
    const config = getRollupConfig('element')
    const source = `import ${JSON.stringify(path.join(root, 'src/features/element.js'))};export { exportMarkdown, exportDocx } from ${JSON.stringify(path.join(root, 'src/utils/export/index.js'))}`
    const bundle = await rollup({
      ...config, input,
      plugins: [{ name: 'element-export-fixture', resolveId: id => id === input ? id : null, load: id => id === input ? source : null }, ...config.plugins],
    })
    try {
      const { output } = await bundle.generate({ ...config.output, plugins: [] })
      const chunk = output.find(item => item.type === 'chunk')
      expect(Object.keys(chunk.modules).some(id => /utils\/export\/(?:markdown|docx)\.js$/.test(id))).toBe(false)
      const featureScripts = new Map()
      for (const name of ['markdown', 'office']) {
        const featureConfig = getRollupConfig(`feature:${name}:umd`)
        const featureBundle = await rollup(featureConfig)
        try {
          const built = await featureBundle.generate({ ...featureConfig.output, plugins: [] })
          featureScripts.set(`lark-doc-element.umd.min.${name}.js`, built.output.find(item => item.type === 'chunk').code)
        } finally { await featureBundle.close() }
      }
      const scripts = []
      const clicks = []
      const blobs = []
      class HostURL extends URL {
        static createObjectURL(blob) { blobs.push(blob); return 'blob:export-test' }
        static revokeObjectURL() {}
      }
      const sandbox = {
        URL: HostURL, Blob, Uint8Array, setTimeout, clearTimeout, setImmediate,
        document: {
          currentScript: { src: 'https://assets.test/vendor/lark-doc-element.umd.min.js' },
          createElement: tag => ({ click() { clicks.push(this.download) }, remove() {}, tag }),
          body: { appendChild() {} },
          head: { appendChild(node) { scripts.push(node); runInNewContext(featureScripts.get(new URL(node.src).pathname.split('/').pop()), sandbox); node.onload() } },
        },
      }
      runInNewContext(chunk.code, sandbox)
      const doc = { type: 'doc', content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '标题' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '正文', marks: [{ type: 'bold' }] }, { type: 'image', attrs: { src: 'data:image/png;base64,AA==', alt: '图' } }] },
      ] }
      const first = sandbox.LarkDoc.exportMarkdown(doc, { fileName: '周报', scope: 'all' })
      const second = sandbox.LarkDoc.exportMarkdown(doc, { fileName: '文本', scope: 'textOnly' })
      const [all, text] = await Promise.all([first, second])
      expect(all.markdown).toContain('## 标题')
      expect(all.markdown).toContain('**正文**')
      expect(all.markdown).toContain('![图]')
      expect(text.markdown).not.toContain('![图]')
      expect(clicks).toEqual(['周报.md', '文本.md'])
      expect(scripts.map(node => node.src)).toEqual(['https://assets.test/vendor/lark-doc-element.umd.min.markdown.js'])
      const word = await sandbox.LarkDoc.exportDocx({ type: 'doc', content: doc.content.slice(0, 1) }, { fileName: '周报', images: {} })
      expect(word.blob.size).toBeGreaterThan(100)
      expect(new Uint8Array(await word.blob.arrayBuffer()).slice(0, 2)).toEqual(new Uint8Array([80, 75]))
      expect(clicks).toEqual(['周报.md', '文本.md', '周报.docx'])
      expect(scripts).toHaveLength(2)
      expect(blobs).toHaveLength(3)
    } finally { await bundle.close() }
  }, 30000)

  it('npm modules externalize PM while standalone UMD and the local PM graph bundle it', () => {
    for (const target of ['esm', 'cjs', 'full', 'fullCjs', 'lite', 'legacy', 'legacyEsm', 'elementEsm', 'adapters', 'collab']) {
      expect(getRollupConfig(target).external('@tiptap/pm/state')).toBe(true)
      expect(getRollupConfig(target).external('prosemirror-state')).toBe(true)
    }
    expect(getRollupConfig('element').external('@tiptap/pm/state')).toBe(false)
    expect(getRollupConfig('pm').external('@tiptap/pm/state')).toBe(false)
    expect(getRollupConfig('esm').output.paths('@tiptap/pm/state')).toBe('./pm/state.js')
    for (const target of ['cjs', 'fullCjs', 'legacy', 'collabCjs', 'collab']) {
      expect(getRollupConfig(target).output.paths('@tiptap/pm/state')).toBe('@tiptap/pm/state')
      expect(getRollupConfig(target).output.paths('prosemirror-view')).toBe('@tiptap/pm/view')
    }
    expect(getRollupConfig('collabCjs').output.format).toBe('cjs')
    expect(getRollupConfig('feature:office').output.paths('@tiptap/pm/model')).toBe('../pm/model.js')
  })

  it('the 13 PM dependency ranges copy the installed Tiptap wrapper contract without replacing the main entry', () => {
    expect(typeof pkg.browser).toBe('object')
    expect(Object.keys(pkg.browser).sort()).toEqual(pmNames.map(name => `./dist/pm/${name}.js`).sort())
    const upstream = JSON.parse(fs.readFileSync(path.resolve(path.dirname(requireHere.resolve('@tiptap/pm/state')), '../../package.json'), 'utf8')).dependencies
    for (const name of pmNames) {
      const dependency = `prosemirror-${name}`
      expect(pkg.browser[`./dist/pm/${name}.js`]).toBe(dependency)
      expect(pkg.dependencies[dependency]).toBe(upstream[dependency])
    }
    expect(pkg.browser[pkg.main]).toBeUndefined()
    expect(pkg.browser['./dist/lark-doc.esm.js']).toBeUndefined()
    expect(pkg.exports['./collab'].node).toBe('./dist/lark-doc-collab.common.js')
    expect(pkg.exports['./collab'].require).toBe('./dist/lark-doc-collab.common.js')
    expect(pkg.exports['./collab'].import).toBe('./dist/lark-doc-collab.esm.js')
  })

  it('local PM builds precede every browser ESM route and comma-separated collab targets deduplicate', () => {
    for (const target of ['esm', 'core', 'all', 'full', 'lite', 'elementEsm', 'vue2', 'legacyEsm', 'adapters', 'features']) {
      expect(targetsFor(target)[0]).toBe('pm')
    }
    expect(targetsFor('collab,collabCjs')).toEqual(['collab', 'collabCjs'])
    expect(targetsFor('esm,cjs')).toEqual(['pm', 'mermaidEsm', 'esm', 'mermaidCjs', 'cjs'])
    expect(targetsFor('cjs')).toEqual(['mermaidCjs', 'cjs'])
  })

  it('normal, legacy, element and feature ESM share one Mermaid module; lite and standalone UMD keep their boundaries', () => {
    for (const target of ['esm', 'full', 'legacyEsm', 'elementEsm', 'feature:mermaid']) {
      const config = getRollupConfig(target)
      expect(config.external('lark-doc/mermaid-vendor')).toBe(true)
      expect(config.output.paths('lark-doc/mermaid-vendor')).toBe(`${target.startsWith('feature:') ? '..' : '.'}/${MERMAID_FILES.mermaidEsm}`)
      expect(targetsFor(target)).toContain('mermaidEsm')
    }
    for (const target of ['cjs', 'fullCjs', 'legacy']) expect(targetsFor(target)).toContain('mermaidCjs')
    for (const target of ['lite', 'element', 'feature:mermaid:umd']) {
      expect(getRollupConfig(target).external('lark-doc/mermaid-vendor')).toBe(false)
      expect(targetsFor(target)).not.toContain('mermaidEsm')
    }
  })

  it('shared Mermaid remains in real lazy/full graphs and missing or malformed shared output fails closed', () => cacheFixture(({ dist, targetGraph }) => {
    const file = MERMAID_FILES.mermaidEsm
    fs.writeFileSync(path.join(dist, file), 'export default { initialize() {}, render() {} }')
    targetGraph['lark-doc.esm.js'].dynamicImports = [file]
    const graphs = { esm: targetGraph, full: { 'full.js': { entry: true, imports: [file], dynamicImports: [] } }, mermaidEsm: { [file]: { entry: true, runtime: false, imports: [], dynamicImports: [] } } }
    fs.writeFileSync(path.join(dist, 'full.js'), `export { default } from "./${file}"`)
    const save = () => fs.writeFileSync(path.join(dist, 'lark-doc-graph.json'), JSON.stringify(graphs))
    save()
    expect(graph.artifactFiles(dist, 'esm', false)).not.toContain(file)
    expect(graph.artifactFiles(dist, 'esm', true)).toContain(file)
    expect(graph.artifactFiles(dist, 'full', false)).toContain(file)
    expect(graph.gzipBytes(dist, graph.artifactFiles(dist, 'full', false))).toBeGreaterThan(graph.gzipBytes(dist, ['full.js']))
    delete graphs.mermaidEsm[file]; save()
    expect(() => graph.artifactFiles(dist, 'esm')).toThrow(/构建图缺少本地区块/)
    graphs.mermaidEsm[file] = { entry: true, imports: [], dynamicImports: [] }; save()
    fs.unlinkSync(path.join(dist, file))
    expect(() => graph.artifactFiles(dist, 'full')).toThrow(/依赖区块缺失/)
  }))

  it('shared CJS vendor works through real native dynamic import and full static consumer', () => cacheFixture(async ({ root, dist }) => {
    const config = getRollupConfig('mermaidCjs')
    const vendor = path.resolve(__dirname, '../../src/assets/vendor/mermaid/mermaid.min.js')
    const bundle = await rollup({ ...config, plugins: [{ name: 'tiny-real-umd-shape', load: id => id === vendor ? 'module.exports={initialize(){return "ready"},render(){return "svg"}}' : null }, ...config.plugins] })
    try {
      const { output } = await bundle.generate({ ...config.output, file: path.join(dist, MERMAID_FILES.mermaidCjs) })
      const result = evaluateCjsChunks(output, MERMAID_FILES.mermaidCjs).exports
      expect(result.initialize()).toBe('ready')
      expect(result.render()).toBe('svg')
      expect(result.default).toBeUndefined()
      for (const item of output) if (item.type === 'chunk') fs.writeFileSync(path.join(dist, item.fileName), item.code)
      for (const [target, code] of [
        ['cjs', 'export async function read(){const m=await import("lark-doc/mermaid-vendor");return (m.default||m).initialize()}'],
        ['fullCjs', 'import mermaid from "lark-doc/mermaid-vendor";export function read(){return mermaid.initialize()}'],
      ]) {
        const input = path.join(root, 'src/consumer.js')
        fs.writeFileSync(input, code)
        const consumer = getRollupConfig(target)
        const built = await rollup({ ...consumer, input })
        try {
          const file = path.join(dist, `${target}.js`)
          await built.write({ ...consumer.output, dir: undefined, file })
          const check = spawnSync(process.execPath, ['-e', `Promise.resolve(require(${JSON.stringify(file)}).read()).then(value=>process.stdout.write(value))`], { encoding: 'utf8' })
          expect(check.status, check.stderr).toBe(0)
          expect(check.stdout).toBe('ready')
        } finally { await built.close() }
      }
    } finally { await bundle.close() }
  }))

  it('a cached ESM feature never turns the following standalone UMD vendor into an external global', () => cacheFixture(async ({ root }) => {
    const input = path.join(root, 'src/feature-fixture.js')
    fs.writeFileSync(input, 'import mermaid from "lark-doc/mermaid-vendor";globalThis.fixtureMermaid=mermaid')
    const caches = new Map()
    for (const target of ['feature:mermaid', 'feature:mermaid:umd']) {
      const config = getRollupConfig(target)
      const warnings = []
      const vendor = path.resolve(__dirname, '../../src/assets/vendor/mermaid/mermaid.min.js')
      const group = rollupCacheGroup(target)
      const bundle = await rollup({ ...config, input, cache: caches.get(group), onwarn: warning => warnings.push(warning), plugins: [inputSnapshotPlugin(() => {}), { name: 'tiny-vendor-cache-boundary', load: id => id === vendor ? 'module.exports={initialize(){return "ready"}}' : null }, ...config.plugins] })
      try {
        const { output } = await bundle.generate(config.output)
        if (target.endsWith(':umd')) {
          expect(warnings).toEqual([])
          const state = {}
          runInNewContext(output.find(item => item.type === 'chunk').code, { globalThis: state })
          expect(state.fixtureMermaid.initialize()).toBe('ready')
        }
        caches.set(group, bundle.cache)
      } finally { await bundle.close() }
    }
  }))

  it('config imports under the actual comma-separated ROLLUP_TARGET environment', () => {
    const result = spawnSync(process.execPath, ['-e', 'import("./rollup.config.mjs").then(config=>process.stdout.write(config.default.output.format))'], {
      cwd: path.resolve(__dirname, '../..'), env: { ...process.env, ROLLUP_TARGET: 'cjs,collabCjs' }, encoding: 'utf8', timeout: 20000,
    })
    expect(result.status, result.stderr || result.error?.message).toBe(0)
    expect(result.stdout).toBe('cjs')
  }, 30000)

  it.each(['esm', 'cjs'])('%s root outputs contain PM references without any bundled PM classes', target => cacheFixture(async ({ root }) => {
    const input = path.join(root, 'src/pm-consumer.js')
    fs.writeFileSync(input, 'export {Node} from "@tiptap/pm/model";export {EditorState} from "@tiptap/pm/state";export {ReplaceStep} from "@tiptap/pm/transform";export {DecorationSet} from "@tiptap/pm/view"')
    const config = getRollupConfig(target)
    const bundle = await rollup({ ...config, input })
    try {
      const { output } = await bundle.generate({ ...config.output, plugins: [] })
      const chunks = output.filter(item => item.type === 'chunk')
      expect(chunks.flatMap(item => Object.keys(item.modules)).some(id => /node_modules\/(?:@tiptap\/pm|prosemirror-)/.test(id))).toBe(false)
      const [entry] = normalizeOutput(chunks, config.output)
      expect(entry.imports).toContain(target === 'esm' ? 'pm/model.js' : '@tiptap/pm/model')
      if (target === 'cjs') {
        // The SDK's own bare PM packages may be nested; consumers must use the wrapper's scope.
        const nested = { 'prosemirror-model': { Node: class ForeignNode {} }, 'prosemirror-view': { DecorationSet: class ForeignDecorations {} } }
        const result = evaluateCjsChunks(chunks, chunks.find(item => item.isEntry).fileName, id => nested[id] || requireHere(id)).exports
        expect(result.Node).toBe(requireHere('@tiptap/pm/model').Node)
        expect(result.EditorState).toBe(requireHere('@tiptap/pm/state').EditorState)
        expect(result.ReplaceStep).toBe(requireHere('@tiptap/pm/transform').ReplaceStep)
        expect(result.DecorationSet).toBe(requireHere('@tiptap/pm/view').DecorationSet)
      }
    } finally { await bundle.close() }
  }))

  it('the 13 local PM entries share one real module graph and preserve Node/ReplaceStep identity', () => cacheFixture(async ({ dist }) => {
    const config = getRollupConfig('pm')
    expect(Object.keys(config.input).sort()).toEqual(pmNames.map(name => `pm/${name}`).sort())
    const bundle = await rollup({ ...config })
    try {
      const { output } = await bundle.generate({ ...config.output, dir: dist, format: 'cjs', plugins: [] })
      const chunks = output.filter(item => item.type === 'chunk')
      expect(chunks.filter(item => item.isEntry)).toHaveLength(13)
      expect(chunks.every(isRuntimeChunk)).toBe(true)
      expect(chunks.flatMap(item => Object.keys(item.modules)).filter(id => /\/prosemirror-model\/dist\/index\.js$/.test(id))).toHaveLength(1)
      const runtime = evaluateCjsChunks(chunks, 'pm/model.js')
      const model = runtime.exports
      const state = runtime.load('pm/state.js')
      const transform = runtime.load('pm/transform.js')
      const schema = new model.Schema({ nodes: { doc: { content: 'text*' }, text: {} } })
      const transaction = state.EditorState.create({ doc: schema.node('doc', null, [schema.text('x')]) }).tr.insertText('y', 0)
      expect(transaction.doc instanceof model.Node).toBe(true)
      expect(transaction.steps[0] instanceof transform.ReplaceStep).toBe(true)
    } finally { await bundle.close() }
  }))

  it('root closures follow the latest PM graph without adding unused PM entries', () => cacheFixture(({ dist }) => {
    fs.mkdirSync(path.join(dist, 'pm'))
    for (const name of ['state.js', 'model.js', 'old.js', 'new.js']) fs.writeFileSync(path.join(dist, 'pm', name), `export const value=${JSON.stringify(name)}`)
    const item = (entry, imports = []) => ({ entry, imports, dynamicImports: [] })
    const graphs = {
      esm: { 'lark-doc.esm.js': item(true, ['pm/state.js']), 'pm/state.js': item(false, ['pm/old.js']) },
      pm: { 'pm/state.js': item(true, ['pm/new.js']), 'pm/model.js': item(true), 'pm/new.js': item(false) },
    }
    fs.writeFileSync(path.join(dist, 'lark-doc-graph.json'), JSON.stringify(graphs))
    const files = graph.artifactFiles(dist, 'esm', false)
    expect(files).toEqual(['lark-doc.esm.js', 'pm/state.js', 'pm/new.js'])
    expect(graph.gzipBytes(dist, files)).toBeGreaterThan(graph.gzipBytes(dist, ['lark-doc.esm.js']))
    delete graphs.pm['pm/state.js']
    fs.writeFileSync(path.join(dist, 'lark-doc-graph.json'), JSON.stringify(graphs))
    expect(() => graph.artifactFiles(dist, 'esm')).toThrow(/缺少|缺失/)
  }))

  it('发布声明不会让Rollup裁掉源码侧纯注册副作用', () => cacheFixture(async ({ root }) => {
    const entry = path.join(root, 'src/register-entry.js')
    const feature = path.resolve(__dirname, '../../src/features/element.js')
    fs.writeFileSync(entry, `import ${JSON.stringify(feature)}; export const entry = true`)
    const config = getRollupConfig('element')
    const bundle = await rollup({ input: entry, plugins: config.plugins })
    try {
      const { output } = await bundle.generate({ format: 'iife', name: 'RegistrationFixture' })
      const sandbox = { URL, document: { currentScript: { src: 'https://assets.test/lark-doc.js' } } }
      runInNewContext(output[0].code, sandbox)
      expect(sandbox.__LARK_DOC_FEATURES__?.has('math')).toBe(true)
      expect(sandbox.__LARK_DOC_FEATURES__?.has('mermaid')).toBe(true)
    } finally { await bundle.close() }
  }))

  it('runtime budget exclusions require real allowed package modules and cannot hide src code', () => {
    const chunk = modules => ({ name: 'tiptap', modules: Object.fromEntries(modules.map(id => [id, {}])) })
    expect(isRuntimeChunk(chunk(['/project/node_modules/@tiptap/core/dist/index.js', '/project/node_modules/prosemirror-model/dist/index.js']))).toBe(true)
    expect(isRuntimeChunk(chunk(['/project/node_modules/@tiptap/core/dist/index.js', '/project/src/editor/hidden.js']))).toBe(false)
    expect(isRuntimeChunk(chunk(['/project/node_modules/mermaid/dist/index.js']))).toBe(false)
    expect(isRuntimeChunk(chunk(['/project/node_modules/@tiptap/core/dist/index.js', '/project/node_modules/linkifyjs/dist/linkify.mjs']))).toBe(true)
    expect(isRuntimeChunk(chunk([]))).toBe(false)
    expect(isRuntimeChunk({ name: 'polyfills', modules: { '/project/node_modules/core-js/internals/foo.js': {} } })).toBe(true)
  })

  it('cached outputs must match their sizes and hashes, even for equal-length corruption', () => cacheFixture(({ root, dist, previous }) => {
    expect(canReuseBuild('esm', previous, { root, dist })).toBe(true)
    fs.writeFileSync(path.join(dist, 'lazy.js'), 'export const value = 2')
    expect(canReuseBuild('esm', previous, { root, dist })).toBe(false)
  }))

  it.each(['missing', 'malformed', 'changed'])('%s build graph cannot reuse cached outputs', state => cacheFixture(({ root, dist, previous, targetGraph }) => {
    const file = path.join(dist, 'lark-doc-graph.json')
    if (state === 'missing') fs.unlinkSync(file)
    else fs.writeFileSync(file, state === 'malformed' ? '{' : JSON.stringify({ esm: { ...targetGraph, extra: {} } }))
    expect(canReuseBuild('esm', previous, { root, dist })).toBe(false)
  }))

  it('empty output records or an omitted expected entry cannot reuse the cache', () => cacheFixture(({ root, dist, previous }) => {
    expect(canReuseBuild('esm', { ...previous, outputs: [] }, { root, dist })).toBe(false)
    expect(canReuseBuild('esm', { ...previous, outputs: ['lazy.js'] }, { root, dist })).toBe(false)
  }))

  it('source additions, child CSS changes and font changes invalidate the cache', () => cacheFixture(({ root, dist, previous }) => {
    fs.writeFileSync(path.join(root, 'src/new.css'), 'body {}')
    expect(canReuseBuild('esm', previous, { root, dist })).toBe(false)
    fs.unlinkSync(path.join(root, 'src/new.css'))
    for (const file of ['src/styles/child.css', 'src/font.woff2']) {
      const initial = fs.readFileSync(path.join(root, file))
      fs.writeFileSync(path.join(root, file), 'changed')
      expect(canReuseBuild('esm', previous, { root, dist })).toBe(false)
      fs.writeFileSync(path.join(root, file), initial)
    }
  }))

  it('recursive CSS imports register their actual files as Rollup watch dependencies', () => cacheFixture(({ root }) => {
    const source = path.join(root, 'src/styles/main.css')
    const child = path.join(root, 'src/styles/child.css')
    fs.writeFileSync(source, '@import "./child.css";')
    fs.writeFileSync(child, 'body { color: red }')
    const result = { opts: { from: source }, messages: [] }
    const css = { removeAll() {}, append() {} }
    inlineCssImports().Once(css, { result })
    expect(result.messages).toContainEqual(expect.objectContaining({ type: 'dependency', file: child }))
  }))

  it('an input changed during the build or absent from the before snapshot cannot be cached', () => cacheFixture(({ root, previous }) => {
    const started = Object.fromEntries(previous.inputs.map(file => [file, {
      size: fs.statSync(path.join(root, file)).size,
      hash: createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'),
    }]))
    expect(assertStableInputs(started, previous.inputs, root)).toBe(previous.fingerprint)
    fs.writeFileSync(path.join(root, previous.inputs[0]), 'changed while building')
    expect(() => assertStableInputs(started, previous.inputs, root)).toThrow(/构建期间输入发生变化/)
    expect(() => assertStableInputs({}, previous.inputs, root)).toThrow(/构建期间输入发生变化/)
  }))

  it('math UMD injects CSS and resolves fonts beside the current script', () => cacheFixture(({ root }) => {
    const css = '@font-face{src:url(./fonts/test.woff2)}'
    const file = path.join(root, 'src/styles/font.css')
    fs.writeFileSync(file, css)
    const minifiedCss = css.replace('./fonts/', 'fonts/')
    const styles = []
    const document = { currentScript: { src: 'https://assets.test/vendor/lark-doc.math.js' }, head: { appendChild: style => styles.push(style) }, createElement: () => ({}) }
    runInNewContext(cssInjection('feature:math:umd')('css', file), { css: minifiedCss, document, URL })
    expect(styles[0].textContent).toContain('https://assets.test/vendor/fonts/test.woff2')
  }))

  it('Element ESM font assets use individual static URL literals for bundler analysis', () => cacheFixture(({ root }) => {
    const file = path.join(root, 'src/styles/font.css')
    fs.writeFileSync(file, '@font-face{src:url(./fonts/a.woff2),url("./fonts/b.woff")}')
    const code = cssInjection('elementEsm')('css', file)
    expect(code).toContain('new URL("./fonts/a.woff2",import.meta.url)')
    expect(code).toContain('new URL("./fonts/b.woff",import.meta.url)')
    expect(code).not.toContain('new URL(file,')
    const styles = []
    const document = { head: { appendChild: style => styles.push(style) }, createElement: () => ({}) }
    runInNewContext(code.replaceAll('import.meta.url', 'source'), { css: '@font-face{src:url(fonts/a.woff2)}', source: 'https://assets.test/vendor/css-chunk.js', document, URL })
    expect(styles[0].textContent).toContain('https://assets.test/vendor/fonts/a.woff2')
  }))

  it('real math config writes JS/CSS in features and verifies its normalized graph and hashes', () => cacheFixture(async ({ root, dist, previous }) => {
    const config = getRollupConfig('feature:math')
    const source = path.join(root, 'src/styles/math-fixture.css')
    fs.writeFileSync(source, '@font-face{src:url(./fonts/test.woff2)}')
    const sourceDist = getRollupConfig('esm').output.dir
    const options = {
      ...config.output,
      ...(config.output.file ? { file: path.join(dist, path.relative(sourceDist, config.output.file)) } : { dir: dist }),
    }
    const bundle = await rollup({ ...config, input: source })
    try {
      const result = await bundle.write(options)
      const output = normalizeOutput(result.output, options, dist)
      const outputs = output.map(item => item.fileName)
      expect(outputs).toContain('features/math.js')
      expect(outputs).toContain('features/math.css')
      expect(fs.existsSync(path.join(dist, 'features/math.css'))).toBe(true)
      expect(fs.readFileSync(path.join(dist, 'features/math.css'), 'utf8')).toContain('../fonts/test.woff2')
      const targetGraph = Object.fromEntries(output.filter(item => item.type === 'chunk').map(item => [item.fileName, {
        entry: item.isEntry, runtime: false, imports: item.imports, dynamicImports: item.dynamicImports,
      }]))
      fs.writeFileSync(path.join(dist, 'lark-doc-graph.json'), JSON.stringify({ 'feature:math': targetGraph }))
      const inputs = [...previous.inputs, 'src/styles/math-fixture.css']
      const hash = value => createHash('sha256').update(value).digest('hex')
      const entry = {
        inputs, sources: [...inputs].sort(), fingerprint: inputFingerprint(inputs, root), outputs,
        outputHashes: Object.fromEntries(outputs.map(file => [file, { size: fs.statSync(path.join(dist, file)).size, hash: hash(fs.readFileSync(path.join(dist, file))) }])),
        graphHash: hash(JSON.stringify(targetGraph)),
      }
      expect(canReuseBuild('feature:math', entry, { root, dist })).toBe(true)
      expect(graph.artifactFiles(dist, 'feature:math')).toEqual(['features/math.js'])
    } finally { await bundle.close() }
  }))

  it('output.file inside a subdirectory records DIST-relative paths and keeps externals external', () => cacheFixture(async ({ root, dist }) => {
    const source = path.join(root, 'src/entry.js')
    fs.writeFileSync(source, 'export { readFileSync } from "node:fs"')
    const bundle = await rollup({ input: source, external: ['node:fs'] })
    const options = { file: path.join(dist, 'nested/entry.js'), format: 'es' }
    try {
      const result = await bundle.write(options)
      const [entry] = normalizeOutput(result.output, options, dist)
      expect(entry.fileName).toBe('nested/entry.js')
      expect(entry.imports).toEqual(['node:fs'])
      expect(fs.readFileSync(path.join(dist, entry.fileName), 'utf8')).toContain('node:fs')
    } finally { await bundle.close() }
  }))

  it('subdirectory output graphs normalize internal static/dynamic dependencies together', () => cacheFixture(({ dist }) => {
    const chunk = (fileName, imports = [], dynamicImports = []) => ({ type: 'chunk', fileName, imports, dynamicImports })
    const output = normalizeOutput([
      chunk('entry.js', ['shared.js', 'external'], ['lazy.js']), chunk('shared.js'), chunk('lazy.js'),
    ], { dir: path.join(dist, 'nested') }, dist)
    expect(output.map(item => item.fileName)).toEqual(['nested/entry.js', 'nested/shared.js', 'nested/lazy.js'])
    expect(output[0].imports).toEqual(['nested/shared.js', 'external'])
    expect(output[0].dynamicImports).toEqual(['nested/lazy.js'])
  }))

  it('Rollup virtual watch IDs and directories never reach filesystem fingerprinting', () => cacheFixture(({ root }) => {
    const file = path.join(root, 'src/entry.js')
    const files = realInputFiles([file, `\0${file}?commonjs-proxy`, '\0commonjsHelpers.js', path.join(root, 'src'), path.join(root, 'missing.js')])
    expect(files).toEqual([file])
    expect(() => inputFingerprint(files.map(file => path.relative(root, file)), root)).not.toThrow()
  }))

  it('薄入口引用任意哈希区块时，初始资源统计不会漏掉实际内容', () => {
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'lark-doc-graph-test-'))
    try {
      fs.writeFileSync(path.join(dist, 'entry.js'), 'export * from "./hashed-heavy.js"')
      fs.writeFileSync(path.join(dist, 'hashed-heavy.js'), 'export const mermaidAPI = "heavy implementation"')
      fs.writeFileSync(path.join(dist, 'lark-doc-graph.json'), JSON.stringify({ lite: {
        'entry.js': { entry: true, imports: ['hashed-heavy.js'], dynamicImports: [] },
        'hashed-heavy.js': { entry: false, imports: [], dynamicImports: [] },
      } }))
      const files = graph.artifactFiles(dist, 'lite', false)
      expect(files).toContain('hashed-heavy.js')
      expect(graph.gzipBytes(dist, files)).toBeGreaterThan(graph.gzipBytes(dist, ['entry.js']))
      fs.unlinkSync(path.join(dist, 'hashed-heavy.js'))
      expect(() => graph.artifactFiles(dist, 'lite')).toThrow(/依赖区块缺失/)
    } finally { fs.rmSync(dist, { recursive: true, force: true }) }
  })
})
