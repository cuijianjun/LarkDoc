import { describe, expect, it, vi } from 'vitest'
import { cssInjection, elementPackNames, FEATURE_TARGETS, getRollupConfig, inlineCssImports, isRuntimeChunk, LAZY_PACKAGE_CALLERS, MERMAID_FILES, panelPresentationShape, versioningPresentationShape, commentInteractionShape, ROLLUP_TARGETS, sharedHostModules } from '../../rollup.config.mjs'
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
import sourceCommentsMixin from '../../src/components/lark-doc/editor/commentsMixin'
import { createCommentInteraction as sourceCommentInteraction } from '../../src/components/lark-doc/editor/commentInteraction'

const requireHere = createRequire(import.meta.url)
const pmNames = ['state', 'model', 'view', 'transform', 'commands', 'keymap', 'inputrules', 'schema-list', 'history', 'gapcursor', 'dropcursor', 'tables', 'changeset']

it('external checks recognize static imports and reexports without accepting lazy imports or text', () => {
  const requests = graph.staticModuleRequests(`
    import * as Y from 'yjs';
    export { isChangeOrigin as isRemoteTransaction } from '@tiptap/extension-collaboration';
    export * from '@tiptap/extension-collaboration-caret';
    export const misleading = '@hocuspocus/provider';
    const lazy = () => import('@hocuspocus/provider');
    // import 'fake-comment';
  `)
  expect(requests).toEqual(['yjs', '@tiptap/extension-collaboration', '@tiptap/extension-collaboration-caret'])
})

it('assembles the CI smoke host with the complete Element loader dependency files', () => {
  const workflow = fs.readFileSync(path.resolve(__dirname, '../../.github/workflows/e2e.yml'), 'utf8')
  const block = workflow.match(/name: Assemble smoke host directory\s+run: \|\n([\s\S]*?)(?=\n {6}- name:)/)
  expect(block).not.toBeNull()
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'lark-doc-ci-host-'))
  const files = ['lark-doc-element.umd.min.js', 'lark-doc-element.runtime.umd.min.js', 'features/highlight.umd.js', 'fonts/editor.woff2']
  try {
    for (const file of files) {
      const target = path.join(fixture, 'dist', file)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, file)
    }
    fs.mkdirSync(path.join(fixture, 'scripts/e2e'), { recursive: true })
    fs.writeFileSync(path.join(fixture, 'scripts/e2e/host.html'), '<div id="host"></div>')
    const result = spawnSync('sh', ['-eu', '-c', block[1].split('\n').map(line => line.trim()).join('\n')], { cwd: fixture, encoding: 'utf8' })
    expect(result.status, result.stderr).toBe(0)
    for (const file of files) expect(fs.existsSync(path.join(fixture, '.e2e-smoke', file)), file).toBe(true)
    expect(fs.readFileSync(path.join(fixture, '.e2e-smoke/index.html'), 'utf8')).toContain('id="host"')
  } finally { fs.rmSync(fixture, { recursive: true, force: true }) }
})

it('clean Element build includes its eager runtime and every local optional script', () => {
  // uiPanels / uiOverlays / export / uiExtra / background 只有 UMD 形态（按需加载，
  // 非 Element 宿主各自有自己的入口），跟随 element / elementRuntime 一起构建，
  // 但不进 esm 特性清单。清单本身就在 elementPackNames 里，避免两处各写一遍走偏。
  const features = elementPackNames.map(name => `feature:${name}:umd`)
  expect(features).toHaveLength(12)
  expect(targetsFor('element')).toEqual(['element', 'elementRuntime', 'elementPolyfills', ...features])
  expect(targetsFor('elementRuntime')).toEqual(['elementRuntime', 'elementPolyfills', ...features])
  for (const target of ['features', 'all']) expect(targetsFor(target)).toEqual(expect.arrayContaining(features))
  expect(new Set(targetsFor('all')).size).toBe(targetsFor('all').length)
})

it('splits the Element UI feature into disjoint factory tables', async () => {
  const { uiCoreFactories } = await import('../../src/features/ui-core-factories')
  const { uiPanelFactories } = await import('../../src/features/ui-panels-factories')
  const { uiOverlayFactories } = await import('../../src/features/ui-overlays-factories')
  const factories = [uiCoreFactories, uiPanelFactories, uiOverlayFactories].flatMap(Object.keys)
  // 重叠就是同一个工厂被打进两个包：谁先到谁生效，另一份纯属白下。
  expect(new Set(factories).size).toBe(factories.length)
  expect(typeof uiOverlayFactories.createShareInteraction).toBe('function')
  const { uiApi } = await import('../../src/features/ui')
  expect(Object.keys(uiApi).sort()).toEqual(factories.sort())
  // 虚拟入口按组名钉死加载槽位：面板类去 ui.panels，选区/悬浮类留在 ui。
  const alias = getRollupConfig('element').plugins.find(plugin => plugin.name === 'lark-doc-package-alias')
  const editorDir = path.resolve(__dirname, '../../src/components/lark-doc/editor')
  const generated = (source, importer) => alias.load(alias.resolveId(source, path.join(editorDir, importer)))
  expect(generated('../../../ui/panels', 'panelsUiMixin.js')).toContain('"ui.panels"')
  const translationImporter = path.join(editorDir, 'bubbleMenuMixin.js')
  expect(alias.transform('const module = await import("../../../ui/dialogs")', translationImporter).code).toContain("__larkDocLoadDocumentFeature('ui.panels')")
  const standardAlias = getRollupConfig('esm').plugins.find(plugin => plugin.name === 'lark-doc-package-alias')
  expect(standardAlias.resolveId('../../../ui/dialogs', translationImporter)).toBeNull()
  expect(uiPanelFactories.createSelectionTranslationDialog).toBeTypeOf('function')
  expect(generated('../../../ui/overlays', 'overlaysUiMixin.js')).toContain('"ui.overlays"')
  expect(generated('../../../ui/commandMenu', 'commandMenuUiMixin.js')).not.toContain('ui.panels')
  expect(generated('../../../ui/bubbleBar', 'bubbleMenuMixin.js')).not.toContain('ui.panels')
})

it('optional browser collaboration bundles installed peers while sharing the published PM runtime', () => {
  const config = getRollupConfig('collabBrowser')
  expect(config.input).toMatch(/src\/collab\/browser\.js$/)
  expect(config.external('yjs')).toBe(false)
  expect(config.external('@hocuspocus/provider')).toBe(false)
  expect(config.external('@tiptap/extension-collaboration')).toBe(false)
  expect(config.external('@tiptap/pm/state')).toBe(true)
  expect(config.output.paths('@tiptap/pm/state')).toBe('./pm/state.js')
  expect(config.output.inlineDynamicImports).toBe(true)
  expect(config.output.manualChunks).toBeUndefined()
  expect(targetsFor('collabBrowser')).toEqual(['pm', 'collabBrowser'])
  expect(targetsFor('all')).toContain('collabBrowser')
  expect(getRollupConfig('collab').external('yjs')).toBe(true)
})

it('bundles browser collaboration peers after external ESM and CJS builds reuse their Rollup cache', async () => {
  const caches = new Map(), peer = 'yjs'
  for (const target of ['collab', 'collabCjs', 'collabBrowser']) {
    const config = getRollupConfig(target), group = rollupCacheGroup(target)
    const bundle = await rollup({ input: 'virtual-entry', external: config.external, cache: caches.get(group), plugins: [{
      name: 'browser-peer-cache-fixture',
      resolveId(id) { if (id === 'virtual-entry' || id === peer) return id },
      load(id) { return id === 'virtual-entry' ? `export {value} from '${peer}'` : id === peer ? 'export const value = 42' : null },
    }] })
    try {
      caches.set(group, bundle.cache)
      const { output } = await bundle.generate({ format: config.output.format })
      const imports = output.flatMap(item => item.type === 'chunk' ? item.imports : [])
      if (target === 'collabBrowser') { expect(imports).not.toContain(peer); expect(output[0].code).toContain('42') }
      else expect(imports).toContain(peer)
    } finally { await bundle.close() }
  }
})

it('shares PM in native Element ESM after an inline UMD runtime builds first', async () => {
  const caches = new Map(), peer = '@tiptap/pm/state'
  for (const target of ['elementRuntime', 'elementEsm']) {
    const config = getRollupConfig(target), group = rollupCacheGroup(target)
    const bundle = await rollup({ input: 'virtual-element-entry', external: config.external, cache: caches.get(group), plugins: [{
      name: 'element-pm-cache-fixture',
      resolveId(id) { if (id === 'virtual-element-entry' || id === peer) return id },
      load(id) { return id === 'virtual-element-entry' ? `export {value} from '${peer}'` : id === peer ? 'export const value = 43' : null },
    }] })
    try {
      caches.set(group, bundle.cache)
      const { output } = await bundle.generate({ format: config.output.format, ...(target === 'elementRuntime' ? { name: 'Fixture' } : {}), paths: config.output.paths })
      if (target === 'elementEsm') { expect(output[0].imports).toContain('./pm/state.js'); expect(output[0].code).not.toContain('43') }
      else { expect(output[0].imports).toEqual([]); expect(output[0].code).toContain('43') }
    } finally { await bundle.close() }
  }
})

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

  it('编辑器低频 UI 在标准与 Element 入口延迟，目录保留同步且不拉入重面板', () => {
    const importer = path.resolve(__dirname, '../../src/components/lark-doc/editor/commandMenuUiMixin.js')
    const aliasFor = target => getRollupConfig(target).plugins.find(plugin => plugin.name === 'lark-doc-package-alias')
    const alias = aliasFor('element')
    for (const name of ['panels', 'dialogs', 'extendedOverlays', 'colorPalette', 'revision', 'isvPanel', 'reminder', 'calendarSearch', 'searchPanel', 'commandMenu', 'templateLibrary', 'overlays', 'notifications', 'tableTools', 'tableOverlays', 'linkTools', 'cellPlusTools', 'bubbleBar']) {
      const source = `../../../ui/${name}`
      const id = alias.resolveId(source, importer)
      expect(id).toMatch(/^\0lark-doc-element-ui:/)
      expect(alias.load(id)).toContain('createDeferredUi')
      expect(alias.resolveId(source, path.resolve(__dirname, '../../src/features/ui.js'))).toBeNull()
      for (const target of ['esm', 'cjs', 'lite', 'elementEsm']) {
        const deferred = aliasFor(target).resolveId(source, importer)
        expect(deferred).toMatch(/^\0lark-doc-element-ui:/)
        expect(aliasFor(target).load(deferred)).toContain('import(')
      }
      for (const target of ['feature:ui', 'feature:ui:umd']) expect(aliasFor(target).resolveId(source, importer)).toBeNull()
    }
    expect(alias.resolveId('../../../core/blocks/reminder', importer)).toBeNull()
    expect(alias.resolveId('../../../ui/shareEntry', importer)).toBeNull()
    expect(alias.load(alias.resolveId('../../../ui/panels', importer))).toContain('src/ui/outlinePanel.js')
    expect(targetsFor('all')).toContain('feature:ui:umd')
    expect(targetsFor('features')).toContain('feature:ui')
  })

  it('Element历史样式在真实冷UI注册前注入，标准公开样式仍完整', async () => {
    const root = path.resolve(__dirname, '../..'), styles = []
    const document = { head: { appendChild: node => styles.push(node.textContent) }, createElement: () => ({}) }
    const registry = new Map()
    const context = { document, Map, URL, __LARK_DOC_FEATURES__: registry }
    // 两支 UI 包的基础模块已换成转发 shim（见 rollup.config.mjs 的 sharedHostModules），
    // 求值时要能找到内核发布的表。这条用例只关心包有没有写 <style>，一次函数调用都不该发生，
    // 所以给一个可任意取属性 / 调用 / 迭代的桩 —— 真拿实现还得解决跨 realm 的 document 归属。
    const sharedStub = new Proxy(function () {}, {
      get: (_, key) => key === Symbol.iterator ? function* () {} : key === Symbol.toPrimitive ? () => '' : sharedStub,
      apply: () => sharedStub,
      construct: () => sharedStub,
    })
    context.__LARK_DOC_SHARED__ = new Proxy({}, { get: () => sharedStub })
    const hasSelector = (css, selector) => { let found = false; requireHere('postcss').parse(css).walkRules(rule => { if (rule.selectors?.includes(selector)) found = true }); return found }
    const versionLayer = '.lark-doc .lark-doc-version-layer'
    const slideStage = '.lark-doc .lark-doc-slide-stage'
    const templateLibrary = '.lark-doc-template-library'
    for (const target of ['esm', 'elementRuntime']) {
      const config = getRollupConfig(target), input = '\0styles-boundary-fixture'
      const bundle = await rollup({ ...config, input, plugins: [{ name: 'styles-boundary-fixture', resolveId: id => id === input ? input : null,
        load: id => id === input ? `import ${JSON.stringify(path.join(root, 'style.css'))}; export const styleEntry = true` : null }, ...config.plugins] })
      try {
        const { output } = await bundle.generate({ ...config.output, plugins: [] })
        const file = target === 'esm' ? 'lark-doc.css' : 'lark-doc-element.css'
        const css = String(output.find(item => item.type === 'asset' && item.fileName === file).source)
        for (const selector of [versionLayer, slideStage, templateLibrary]) {
          expect(hasSelector(css, selector), selector).toBe(target === 'esm')
        }
      } finally { await bundle.close() }
    }
    const config = getRollupConfig('feature:ui:umd'), bundle = await rollup(config)
    try {
      const { output } = await bundle.generate({ ...config.output, plugins: [] })
      runInNewContext(output.find(item => item.type === 'chunk').code, context)
      // 面板样式改成同目录独立表：脚本求值不再写 <style>，样式由 element 通道注入 <link>。
      expect(styles).toHaveLength(0)
      const css = output.find(item => item.type === 'asset' && item.fileName === 'lark-doc-element.ui.css')
      expect(hasSelector(String(css.source), versionLayer)).toBe(true)
      expect(hasSelector(String(css.source), templateLibrary)).toBe(false)
    } finally { await bundle.close() }
    const panelConfig = getRollupConfig('feature:uiPanels:umd'), panelBundle = await rollup(panelConfig)
    try {
      const { output } = await panelBundle.generate({ ...panelConfig.output, plugins: [] })
      const css = String(output.find(item => item.type === 'asset' && item.fileName === 'lark-doc-element.panels.css').source)
      expect(hasSelector(css, slideStage)).toBe(true)
      expect(hasSelector(css, templateLibrary)).toBe(true)
    } finally { await panelBundle.close() }
  }, 15000)

  it('标准入口真实构建图保留同步目录，重面板只存在于动态闭包', async () => {
    const config = getRollupConfig('esm')
    const alias = config.plugins.find(plugin => plugin.name === 'lark-doc-package-alias')
    const input = alias.resolveId('../../../ui/panels', path.resolve(__dirname, '../../src/components/lark-doc/editor/panelsUiMixin.js'))
    const bundle = await rollup({ ...config, input, plugins: [{ name: 'deferred-entry', resolveId: id => id === input ? input : null }, ...config.plugins] })
    try {
      const { output } = await bundle.generate({ ...config.output, plugins: [] })
      const chunks = new Map(output.filter(item => item.type === 'chunk').map(item => [item.fileName, item]))
      const visited = new Set(), modules = []
      const visit = name => { if (visited.has(name)) return; visited.add(name); const item = chunks.get(name); if (!item) return; modules.push(...Object.keys(item.modules)); item.imports.forEach(visit) }
      output.filter(item => item.type === 'chunk' && item.isEntry).forEach(item => visit(item.fileName))
      expect(modules.some(id => id.endsWith('/src/ui/outlinePanel.js'))).toBe(true)
      for (const file of ['panels.js', 'commentPanel.js', 'versionPanel.js', 'dialogs.js', 'commandMenu.js']) expect(modules.some(id => id.endsWith('/src/ui/' + file))).toBe(false)
      // panels.js 现在只是出口文件（纯 re-export），rollup 会把它摊平，重面板实现落在
      // commentPanel.js / versionPanel.js 这两个动态入口里。
      expect(output.some(item => item.type === 'chunk' && item.isDynamicEntry &&
        Object.keys(item.modules).some(id => /\/src\/ui\/(commentPanel|versionPanel)\.js$/.test(id)))).toBe(true)
    } finally { await bundle.close() }
  })

  it('真实 UI 独立脚本按需去重、失败可重试，面板状态和事件互相隔离', async () => {
    const dom = new JSDOM('', { url: 'https://assets.test/page', runScripts: 'outside-only', pretendToBeVisual: true })
    const context = dom.getInternalVMContext()
    const { document } = dom.window
    Object.defineProperty(dom.window, 'innerWidth', { configurable: true, value: 393 })
    const script = document.createElement('script')
    script.src = 'https://assets.test/vendor/lark-doc-element.umd.min.js'
    Object.defineProperty(document, 'currentScript', { value: script, configurable: true })
    const config = getRollupConfig('element')
    const input = '\0element-ui-fixture'
    const root = path.resolve(__dirname, '../..')
    const alias = config.plugins.find(plugin => plugin.name === 'lark-doc-package-alias')
    const panels = alias.resolveId('../../../ui/panels', path.join(root, 'src/components/lark-doc/editor/panelsUiMixin.js'))
    const bubble = alias.resolveId('../../../ui/bubbleBar', path.join(root, 'src/components/lark-doc/editor/bubbleMenuMixin.js'))
    const presentation = alias.resolveId('./panelPresentation', path.join(root, 'src/components/lark-doc/editor/commentPanelView.js'))
    const tablePresentation = alias.resolveId('./tablePresentation', path.join(root, 'src/components/lark-doc/editor/tableToolsUiMixin.js'))
    const commentInteraction = alias.resolveId('./commentInteraction', path.join(root, 'src/components/lark-doc/editor/commentsMixin.js'))
    const calloutPresentation = alias.resolveId('./calloutPresentation', path.join(root, 'src/components/lark-doc/editor/calloutColorMixin.js'))
    const versioningPresentation = alias.resolveId('./versioningPresentation', path.join(root, 'src/components/lark-doc/editor/versioningMixin.js'))
    const source = `import ${JSON.stringify(path.join(root, 'src/features/element.js'))};export {createDeferredUi} from ${JSON.stringify(path.join(root, 'src/features/element-ui.js'))};export {default as commandMenuUiMixin} from ${JSON.stringify(path.join(root, 'src/components/lark-doc/editor/commandMenuUiMixin.js'))};export {createCommentPanel} from ${JSON.stringify(panels)};export {createBubbleBar} from ${JSON.stringify(bubble)};export {createPanelPresentation} from ${JSON.stringify(presentation)};export {createTablePresentation} from ${JSON.stringify(tablePresentation)};export {createCommentInteraction} from ${JSON.stringify(commentInteraction)};export {createCalloutPresentation} from ${JSON.stringify(calloutPresentation)};export {createVersioningPresentation} from ${JSON.stringify(versioningPresentation)};export {createNativeOptionsHost} from ${JSON.stringify(path.join(root, 'src/editor/nativeOptionsHost.js'))};export {createWorkspace} from ${JSON.stringify(path.join(root, 'src/ui/workspace.js'))}`
    const bundle = await rollup({ ...config, input, plugins: [{ name: 'element-ui-fixture', resolveId: id => [input, panels, bubble, presentation, tablePresentation, commentInteraction, calloutPresentation, versioningPresentation].includes(id) ? id : null, load: id => id === input ? source : null }, ...config.plugins] })
    // 面板包按触发时机拆成两支：交互包（ui）与面板包（uiPanels）。这里两个都打，
    // 才能验证「各自去重、各自失败重试、样式表只下一次」以及跨包合并后的挂载。
    const coreFeature = await rollup(getRollupConfig('feature:ui:umd'))
    const panelsFeature = await rollup(getRollupConfig('feature:uiPanels:umd'))
    const commentHandles = []
    const presentationHosts = []
    const workspaces = []
    let bubbleHandle
    try {
      const main = await bundle.generate(config.output)
      const coreBuilt = await coreFeature.generate(getRollupConfig('feature:ui:umd').output)
      const panelsBuilt = await panelsFeature.generate(getRollupConfig('feature:uiPanels:umd').output)
      const coreCode = coreBuilt.output.find(item => item.type === 'chunk').code
      const panelsCode = panelsBuilt.output.find(item => item.type === 'chunk').code
      // 两支都必须是纯 UI 代码：编辑器内核（tiptap / prosemirror）一份都不能混进来。
      for (const built of [coreBuilt, panelsBuilt]) {
        expect(Object.keys(built.output[0].modules).some(id => /node_modules\/(?:@tiptap|prosemirror-)/.test(id))).toBe(false)
      }
      // 两支 UI 包的基础模块已换成转发 shim（rollup.config.mjs 的 sharedHostModules），
      // 求值前必须先有内核发布的共享表。线上这张表由 runtime 发布；这里把同一份源码打进
      // fixture 并在同一 realm 里执行，而不是把主 realm 的模块对象塞进 vm —— 那些函数闭包里
      // 的 document 属于另一个 jsdom 实例，真调起来会往错文档里建节点。
      const sharedInput = '\0shared-host-fixture'
      const sharedExports = Object.entries(sharedHostModules)
      const sharedSource = `${sharedExports.map(([file], index) => `import * as shared${index} from ${JSON.stringify(path.join(root, file))};`).join('\n')}
import { publishSharedModules } from ${JSON.stringify(path.join(root, 'src/core/features/shared-host.js'))};
import { registerFeature } from ${JSON.stringify(path.join(root, 'src/core/features/registry.js'))};
publishSharedModules({${sharedExports.map(([, name], index) => `${JSON.stringify(name)}: shared${index}`).join(', ')}, 'core.featureRegistration': { registerFeature }});`
      const sharedBundle = await rollup({ ...config, input: sharedInput, plugins: [{ name: 'shared-host-fixture', resolveId: id => id === sharedInput ? sharedInput : null, load: id => id === sharedInput ? sharedSource : null }, ...config.plugins] })
      try {
        const sharedBuilt = await sharedBundle.generate(config.output)
        runInContext(sharedBuilt.output.find(item => item.type === 'chunk').code, context)
      } finally {
        await sharedBundle.close()
      }
      runInContext(main.output[0].code, context)
      const visibility = { open: false, documentInline: true }
      const presenter = dom.window.LarkDoc.createPanelPresentation({ commentModel: {} })
      class CellSelection {}
      const table = dom.window.LarkDoc.createTablePresentation({ CellSelection })
      const commentInteractionMethods = dom.window.LarkDoc.createCommentInteraction({}).methods
      const commentInteractionHost = { commentMentionPicker: { scope: 'document', status: 'loading' } }
      expect(commentInteractionMethods.documentMentionKeydown.call(commentInteractionHost, 'document', 'Escape')).toBe(false)
      expect(commentInteractionHost.commentMentionPicker.scope).toBe('document')
      const anchor = { left: 12, top: 20 }, selection = new CellSelection()
      expect(table.methods.buildTableToolsPresentation.call({}, { open: true, anchor, cellKind: 'multi', selection })).toEqual({ open: true, anchor, cellKind: 'multi' })
      const tableRoot = document.createElement('section'); document.body.append(tableRoot)
      const tableEvent = vi.fn(); tableRoot.addEventListener('table-command', tableEvent)
      table.methods.dispatchToolbarAction.call({ $refs: { root: tableRoot } }, 'table-command', { current: 'before-load' })
      expect(tableEvent).not.toHaveBeenCalled()
      const runtime = dom.window.LarkDoc.createNativeOptionsHost({ options: { computed: {
        historical() { return presenter.computed.historicalOnly.call({ ed: this, documentOnly: false }) },
      }, methods: { buildCommentVisibility: () => visibility } }, state: { panelPresentationRevision: 0, commentHistorical: true } })
      presentationHosts.push(runtime)
      const callout = dom.window.LarkDoc.createNativeOptionsHost({ options: { computed: dom.window.LarkDoc.createCalloutPresentation().computed }, state: { calloutPresentationRevision: 0, calloutEmojiQuery: '嘿嘿', calloutEmojiCategory: 'all', calloutEmojiRecent: [] } })
      presentationHosts.push(callout)
      expect(callout.host.calloutEmojiCategories).toEqual([])
      expect(callout.host.filteredCalloutEmojiItems).toEqual([])
      const versioning = dom.window.LarkDoc.createVersioningPresentation({ groupVersionsByMonth: list => list.map(item => ({ key: item.id })) })
      const versioningRuntime = dom.window.LarkDoc.createNativeOptionsHost({ options: { computed: versioning.computed },
        state: { panelPresentationRevision: 0, versionList: [{ id: 'current' }] } })
      presentationHosts.push(versioningRuntime)
      expect(versioningRuntime.host.versionGroups).toEqual([])
      expect(versioningRuntime.host.versionSelectedDiff).toBeNull()
      expect(versioningRuntime.host.versionChangeCursor).toBe('')
      expect(versioningRuntime.host.versionRestoreConfirmText).toBe('')
      expect(versioning.methods.versionTimelineClass.call({})).toEqual({ selected: false })
      const previewElement = document.createElement('div')
      expect(() => versioning.methods.mountVersionDocumentPreview.call({}, previewElement, {})).toThrow('版本预览界面尚未加载')
      expect(previewElement.childNodes).toHaveLength(0)
      expect(runtime.host.historical).toBeUndefined()
      expect(presenter.methods.buildCommentState.call(runtime.host)).toBe(visibility)
      const scripts = []
      const append = document.head.appendChild.bind(document.head)
      document.head.appendChild = node => { if (node.tagName === 'SCRIPT') scripts.push(node); return append(node) }
      const settle = async () => { for (let i = 0; i < 24; i += 1) await Promise.resolve() }
      const makeWorkspace = () => {
        const headerHost = document.createElement('div'), panelHost = document.createElement('div')
        document.body.append(headerHost, panelHost)
        const handle = dom.window.LarkDoc.createWorkspace({ headerHost, panelHost })
        workspaces.push(handle)
        handle.update({ saveStatus: '同步保存入口', aiEnabled: true, aiOpen: false, historyEnabled: false, templatesEnabled: true, templateOpen: false })
        return { handle, headerHost, panelHost }
      }
      const retiredWorkspace = makeWorkspace(), currentWorkspace = makeWorkspace()
      await settle()
      expect(scripts).toHaveLength(0)
      expect(retiredWorkspace.headerHost.querySelector('[role="status"]').textContent).toBe('同步保存入口')
      const makeComments = (handlers = {}) => {
        const root = document.createElement('div'); root.className = 'lark-doc'
        const inlineHost = document.createElement('main'); inlineHost.className = 'lark-doc-main'
        const host = document.createElement('div'); root.append(inlineHost, host); document.body.append(root)
        const ui = dom.window.LarkDoc.createCommentPanel({ host, inlineHost, handlers })
        commentHandles.push(ui)
        return { ui, root, inlineHost }
      }
      const hiddenState = { open: false, documentInline: false, launcher: { visible: false } }
      const hidden = makeComments(); hidden.ui.update(hiddenState)
      const latePanelHost = document.createElement('div'), lateInlineHost = document.createElement('main')
      document.body.append(latePanelHost, lateInlineHost)
      const lateOwner = { setCommentDocumentDraft: vi.fn() }
      const lateHandlers = vi.fn(() => presenter.methods.panelsHandlers.call(lateOwner).comment)
      const latePanel = dom.window.LarkDoc.createCommentPanel({ host: latePanelHost, inlineHost: lateInlineHost,
        get handlers() { return lateHandlers() } })
      commentHandles.push(latePanel)
      latePanel.update(hiddenState)
      await settle()
      expect(scripts).toHaveLength(0)
      expect(lateHandlers).not.toHaveBeenCalled()
      retiredWorkspace.handle.update({ aiOpen: true, aiImageChat: true })
      retiredWorkspace.handle.focusImageAI()
      retiredWorkspace.handle.update({ aiOpen: false })
      const templateFocused = vi.fn()
      currentWorkspace.panelHost.addEventListener('focusin', templateFocused)
      currentWorkspace.handle.update({ templateOpen: true, templateQuery: '旧查询' })
      currentWorkspace.handle.focusTemplateSearch()
      currentWorkspace.handle.update({ templateQuery: '当前查询', readonly: true })

      const { default: panelsUiMixin } = await import('../../src/components/lark-doc/editor/panelsUiMixin')
      const { createMemoryCommentsProvider } = await import('../../src/core/comments/memory-provider')
      const provider = createMemoryCommentsProvider()
      const onDocumentComposerDraft = vi.fn(), onToggleSidebar = vi.fn()
      const footer = makeComments({ onDocumentComposerDraft })
      const commentContext = {
        $refs: { root: footer.root }, _mobileEditorMedia: { matches: true }, commentIdentityGeneration: 1,
        commentProvider: () => provider, featureEnabled: () => true, commentCan: () => true,
        commentAllowed: () => true, commentDraftImages: () => [], commentAuthorName: () => 'Alice',
        commentDocumentDraft: 'Alice 的旧草稿', commentDocumentReplyTarget: { principalId: 'alice', displayName: 'Alice' },
      }
      const buildComments = () => panelsUiMixin.methods.buildCommentState.call(commentContext)
      const initialCommentState = buildComments()
      expect(initialCommentState.open).toBe(false)
      expect(initialCommentState.documentInline).toBe(true)
      expect(initialCommentState.launcher.visible).toBe(true)
      // Each visibility flag must work independently; one instance cannot hide
      // a missing predicate branch by loading the shared feature for the other.
      footer.ui.update({ ...initialCommentState, launcher: { visible: false } })
      const launcher = makeComments({ onToggleSidebar })
      launcher.ui.update({ ...initialCommentState, documentInline: false })
      commentContext.commentIdentityGeneration = 2
      commentContext.commentDocumentDraft = 'Bob 的当前草稿'
      commentContext.commentDocumentReplyTarget = { principalId: 'bob', displayName: 'Bob' }
      const currentCommentState = { ...buildComments(), launcher: { visible: false } }
      footer.ui.update(currentCommentState)
      latePanel.update(currentCommentState)
      expect(lateHandlers).not.toHaveBeenCalled()
      lateOwner.setCommentDocumentDraft = vi.fn()
      await settle()
      expect(scripts).toHaveLength(0)
      const panelStyles = document.querySelector('link[data-lark-doc-feature="lark-doc-element.panels.css"]')
      expect([...document.querySelectorAll('link[data-lark-doc-feature]')].map(node => node.href))
        .toEqual(['https://assets.test/vendor/lark-doc-element.panels.css', 'https://assets.test/vendor/lark-doc-element.ui.css'])
      panelStyles.dispatchEvent(new dom.window.Event('load'))
      await settle()
      expect(scripts).toHaveLength(0)
      document.querySelector('link[data-lark-doc-feature="lark-doc-element.ui.css"]').dispatchEvent(new dom.window.Event('load'))
      await settle()
      expect(scripts.map(node => node.src)).toEqual(['https://assets.test/vendor/lark-doc-element.umd.min.uiPanels.js'])
      const hosts = [document.createElement('div'), document.createElement('div')]
      hosts.forEach(host => document.body.appendChild(host))
      const onQuery = vi.fn()
      // 与生成的虚拟入口一致：搜索栏归面板包，第 5 参显式钉住加载槽位。
      const ui = hosts.map((host, index) => dom.window.LarkDoc.createDeferredUi('createSearchPanel',
        { host, handlers: index === 0 ? { onQuery } : {} }, undefined, undefined, 'ui.panels'))
      const menuHost = document.createElement('div')
      document.body.appendChild(menuHost)
      const menuMethods = dom.window.LarkDoc.commandMenuUiMixin.methods
      const onReady = vi.fn(menu => { expect(menu.el.isConnected).toBe(true); menu.focusSearch(); expect(document.activeElement).toBe(menu.el.querySelector('input')) })
      const menuContext = { $refs: { commandMenuHost: menuHost }, commandMenuHandlers: () => ({}),
        menuOpen: false, onCommandMenuReady: onReady,
        buildCommandMenuState: () => ({ open: true, kind: 'plus', query: '', items: [], templates: [] }),
        refreshCommandMenu() { menuMethods.refreshCommandMenu.call(this) } }
      menuMethods.mountCommandMenu.call(menuContext)
      ui.forEach((panel, index) => panel.update({ open: true, query: `查询${index}` }))
      await settle()
      // 两支脚本各自一份：先被触发的面板包在前，命令菜单要的交互包在后。
      expect(scripts.map(node => node.src)).toEqual([
        'https://assets.test/vendor/lark-doc-element.umd.min.uiPanels.js',
        'https://assets.test/vendor/lark-doc-element.umd.min.ui.js',
      ])
      // 多实例共享同一组脚本，样式表也必须只注入一次。
      expect(document.querySelectorAll('link[data-lark-doc-feature]')).toHaveLength(2)
      scripts[0].onerror()
      await settle()
      expect(hosts.every(host => host.querySelector('[role="alert"]'))).toBe(true)
      expect(retiredWorkspace.panelHost.querySelector('[role="alert"]')).toBeNull()
      // 一个包失败不连坐另一个：命令菜单还在等自己那支脚本，不该冒出错误按钮。
      expect(menuHost.querySelector('[role="alert"]')).toBeNull()
      currentWorkspace.panelHost.querySelector('[role="alert"]').click()
      hosts.forEach(host => host.querySelector('[role="alert"]').click())
      footer.ui.update(currentCommentState)
      latePanel.update(currentCommentState)
      launcher.ui.update({ ...currentCommentState, documentInline: false, launcher: { visible: true } })
      const retired = makeComments()
      retired.ui.update(currentCommentState)
      retired.ui.update(hiddenState)
      await settle()
      expect(scripts.map(node => node.src)).toEqual([
        'https://assets.test/vendor/lark-doc-element.umd.min.uiPanels.js',
        'https://assets.test/vendor/lark-doc-element.umd.min.ui.js',
        'https://assets.test/vendor/lark-doc-element.umd.min.uiPanels.js',
      ])
      // 两支实现都到位，后到的那支并进同一张 API 表；先到的句柄也能看见新工厂。
      runInContext(coreCode, context)
      runInContext(panelsCode, context)
      scripts[1].onload()
      scripts[2].onload()
      await settle()
      expect(lateHandlers).toHaveBeenCalledOnce()
      const lateDraft = lateInlineHost.querySelector('textarea[aria-label="全文评论"]')
      lateDraft.value = '当前宿主输入'
      lateDraft.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
      expect(lateOwner.setCommentDocumentDraft).toHaveBeenCalledWith('当前宿主输入', [], [])
      // UI readiness alone is not reactive: the native panel's onReady revision
      // invalidates the cold computed cache before painting its full projection.
      expect(versioningRuntime.host.versionGroups).toEqual([])
      versioningRuntime.host.panelPresentationRevision++
      expect(versioningRuntime.host.versionGroups).toEqual([{ key: 'current' }])
      versioningRuntime.host.versionList = [{ id: 'new-current' }]
      expect(versioningRuntime.host.versionGroups).toEqual([{ key: 'new-current' }])
      expect(versioning.methods.versionActorLabel.call({}, { author: '当前作者' })).toBe('当前作者')
      expect(versioning.methods.versionTimelineClass.call({ versionSelectedId: 'current' }, { id: 'current' })).toEqual({ selected: true })
      expect(typeof versioning.methods.mountVersionDocumentPreview.call({}, previewElement, {})).toBe('function')
      expect(previewElement.textContent).toContain('无法预览此版本')
      callout.host.calloutPresentationRevision++
      expect(callout.host.calloutEmojiCategories).toHaveLength(9)
      expect(callout.host.filteredCalloutEmojiItems[0]).toMatchObject({ glyph: '😀', value: 'grinning', label: '嘿嘿' })
      callout.host.calloutEmojiQuery = 'absent-search-token'
      expect(callout.host.filteredCalloutEmojiItems).toEqual([])
      expect(commentInteractionMethods.documentMentionKeydown.call(commentInteractionHost, 'document', 'Escape')).toBe(true)
      expect(commentInteractionHost.commentMentionPicker).toBeNull()
      expect(retiredWorkspace.panelHost.childNodes).toHaveLength(0)
      const templateSearch = currentWorkspace.panelHost.querySelector('input[aria-label="搜索模板"]')
      expect(templateSearch.value).toBe('当前查询')
      expect(templateFocused).toHaveBeenCalled()
      currentWorkspace.handle.focusTemplateSearch()
      expect(document.activeElement).toBe(templateSearch)
      currentWorkspace.handle.update({ templateOpen: false })
      expect(currentWorkspace.panelHost.childNodes).toHaveLength(0)
      expect(runtime.host.historical).toBeUndefined()
      table.methods.dispatchToolbarAction.call({ $refs: { root: tableRoot } }, 'table-command', { current: 'loaded' })
      expect(tableEvent).toHaveBeenCalledOnce()
      expect(tableEvent.mock.calls[0][0].detail).toEqual({ current: 'loaded' })
      runtime.host.panelPresentationRevision++
      expect(runtime.host.historical).toBe(true)
      runtime.host.commentHistorical = false
      expect(runtime.host.historical).toBe(false)
      expect(footer.inlineHost.querySelector('.lark-doc-document-comment-heading')?.textContent).toBe('全文评论')
      const draft = footer.inlineHost.querySelector('textarea[aria-label="全文评论"]')
      expect(draft?.value).toBe('Bob 的当前草稿')
      expect(footer.inlineHost.textContent).toContain('回复：Bob')
      expect(footer.root.textContent).not.toContain('Alice')
      draft.value = 'Bob 新输入'; draft.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
      expect(onDocumentComposerDraft).toHaveBeenCalledWith('Bob 新输入', expect.anything())
      const launch = launcher.root.querySelector('[aria-label="展开评论"]')
      expect(launch?.isConnected).toBe(true)
      expect(launcher.inlineHost.querySelector('.lark-doc-document-comment-heading')).toBeNull()
      launch.click(); expect(onToggleSidebar).toHaveBeenCalledOnce()
      for (const item of [hidden, retired]) {
        expect(item.ui.el).toBeUndefined()
        expect(item.root.querySelector('.lark-doc-document-comment-heading, [aria-label="展开评论"]')).toBeNull()
      }
      const bubbleHost = document.createElement('div'); document.body.append(bubbleHost)
      const onCopy = vi.fn(), bubbleConfig = { mobile: true, ai: false, blockStyle: false, marks: [], canCopy: true }
      bubbleHandle = dom.window.LarkDoc.createBubbleBar(bubbleHost, { config: bubbleConfig, handlers: { onCopy } })
      expect(bubbleHandle.setConfig({ ...bubbleConfig })).toBe(false)
      bubbleHandle.update({ open: true, left: 20, top: 30 })
      expect(bubbleHandle.el?.parentNode).toBe(bubbleHost)
      bubbleHost.querySelector('[aria-label="复制选中文字"]').click()
      expect(onCopy).toHaveBeenCalledOnce()
      bubbleHandle.positionAlignMenu(); bubbleHandle.positionHeadingMenu(); bubbleHandle.hide()
      expect(bubbleHandle.el.isConnected).toBe(false)
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
      // 失败重试只补一次脚本，后续复用不再下载。
      expect(scripts).toHaveLength(3)
      ui[1].destroy()
    } finally { workspaces.forEach(handle => handle.destroy()); presentationHosts.forEach(runtime => runtime.destroy()); commentHandles.forEach(handle => handle.destroy()); bubbleHandle?.destroy(); await bundle.close(); await coreFeature.close(); await panelsFeature.close(); dom.window.close() }
  }, 30000)

  it('workspace action controls stay synchronous while inactive panels stay outside the initial graph', () => {
    const importer = path.resolve(__dirname, '../../src/ui/workspace.js')
    const alias = getRollupConfig('element').plugins.find(plugin => plugin.name === 'lark-doc-package-alias')
    const id = alias.resolveId('./workspacePanels', importer)
    expect(id).toBe('\0lark-doc-element-ui:workspacePanels')
    const code = alias.load(id)
    expect(code).toContain('createWorkspacePanels')
    expect(code).toContain('templatesEnabled')
    expect(code).toContain('historyEnabled')
    expect(code).toContain('aiEnabled')
    expect(code).toContain('s.notice')
    expect(alias.resolveId('../ui/workspace', path.resolve(__dirname, '../../src/mount/domRenderer.js'))).toBeNull()
  })

  it('comment UI interaction is deferred without changing the hot comment write or initial-link handlers', () => {
    const importer = path.resolve(__dirname, '../../src/components/lark-doc/editor/commentsMixin.js')
    const alias = getRollupConfig('element').plugins.find(plugin => plugin.name === 'lark-doc-package-alias')
    const id = alias.resolveId('./commentInteraction', importer)
    expect(id).toBe('\0lark-doc-comment-interaction')
    const code = alias.load(id)
    expect(code).toContain('documentMentionKeydown')
    expect(code).not.toContain('createCommentFromSelection')
    expect(code).not.toContain('openCommentLink')
    expect(code).not.toContain('clearUnavailableCommentView')
  })

  it('compiled comment boundary keeps automatic follow reads hot and cached UI continuations usable after withdrawal', async () => {
    const root = process.cwd(), importer = path.join(root, 'src/components/lark-doc/editor/commentsMixin.js')
    const config = getRollupConfig('esm'), alias = config.plugins.find(plugin => plugin.name === 'lark-doc-package-alias')
    const id = alias.resolveId('./commentInteraction', importer), input = '\0comment-recovery-fixture'
    const bundle = await rollup({ ...config, input, plugins: [{ name: 'comment-recovery-fixture', resolveId: source => [input, id].includes(source) ? source : null,
      load: source => source === input ? `export {createCommentInteraction} from ${JSON.stringify(id)};export {registerFeature} from ${JSON.stringify(path.join(root, 'src/core/features/registry.js'))}` : null }, ...config.plugins] })
    try {
      const { output } = await bundle.generate({ format: 'iife', name: 'CommentFixture' }), context = {}
      runInNewContext(output[0].code, context)
      const dependencies = { createCommentOperationId: () => 'original-follow-write' }
      const cold = context.CommentFixture.createCommentInteraction(dependencies).methods, coldNames = commentInteractionShape().methods
      // This is the production mixin merge boundary: hot own methods override the private cold facade.
      const hot = Object.fromEntries(Object.entries(sourceCommentsMixin.methods).filter(([name]) => !coldNames.includes(name)))
      const initial = { threadId: 'thread:1', following: false, muted: false, preferenceRevision: '0' }
      const acknowledged = { ...initial, following: true, preferenceRevision: '1' }, latest = { ...acknowledged, muted: true, preferenceRevision: '2' }
      let resolveWrite
      const provider = { isRemote: true, getFollowPreference: vi.fn().mockResolvedValueOnce(initial).mockResolvedValue(latest),
        follow: vi.fn(() => new Promise(resolve => { resolveWrite = resolve })), queryFollowOperation: vi.fn().mockResolvedValue(latest) }
      const owner = { ...sourceCommentsMixin.data(), ...hot, ...cold, commentProvider: () => provider, commentCan: () => true,
        commentOperationCurrent: () => () => true, $set: (object, key, value) => { object[key] = value }, clearUnavailableCommentView: vi.fn() }
      const reading = owner.loadCommentFollowPreference('thread:1')
      expect(provider.getFollowPreference).toHaveBeenCalledWith('thread:1')
      expect(reading?.then).toBeTypeOf('function')
      const link = vi.fn(), reconcile = vi.fn()
      await reading.catch(() => null).then(() => { link(); reconcile() })
      expect(link).toHaveBeenCalledOnce(); expect(reconcile).toHaveBeenCalledOnce()
      expect(owner.commentFollowPreferences['thread:1']).toEqual(initial)
      expect(provider.follow).not.toHaveBeenCalled(); expect(provider.queryFollowOperation).not.toHaveBeenCalled()
      expect(cold).not.toHaveProperty('loadCommentFollowPreference')
      const factory = vi.fn(value => {
        const implementation = sourceCommentInteraction(value), change = implementation.methods.changeCommentFollow
        implementation.methods.changeCommentFollow = function (...args) { const result = change.apply(this, args); context.originalWritePromise = result; return result }
        return implementation
      })
      const withdraw = context.CommentFixture.registerFeature('ui.ready', () => ({ createCommentInteraction: factory }))
      const pending = owner.changeCommentFollow('thread:1', 'follow')
      expect(pending).toBe(context.originalWritePromise)
      expect(provider.follow).toHaveBeenCalledWith(expect.objectContaining({ operationId: 'original-follow-write', threadId: 'thread:1' }))
      withdraw()
      const mention = { commentMentionPicker: { scope: 'document', status: 'loading' } }
      expect(cold.documentMentionKeydown.call(mention, 'document', 'Escape')).toBe(true)
      expect(mention.commentMentionPicker).toBeNull()
      owner.commentLoadGeneration++
      resolveWrite(acknowledged)
      await expect(pending).resolves.toEqual(acknowledged)
      expect(owner.commentFollowPreferences['thread:1']).toEqual(latest)
      expect(provider.getFollowPreference).toHaveBeenCalledTimes(2)
      expect(provider.queryFollowOperation).not.toHaveBeenCalled()
      owner.commentPendingFollowOperation = 'original-pending-follow'
      await expect(owner.queryPendingCommentFollow()).resolves.toEqual(latest)
      expect(provider.queryFollowOperation).toHaveBeenCalledExactlyOnceWith('original-pending-follow')
      expect(owner.commentPendingFollowOperation).toBe('')
      expect(factory).toHaveBeenCalledTimes(1)
    } finally { await bundle.close() }
  })

  it('table presentation is private to the loaded UI and keeps its full hot visibility boundary', () => {
    const alias = getRollupConfig('element').plugins.find(plugin => plugin.name === 'lark-doc-package-alias')
    const importer = path.resolve(__dirname, '../../src/components/lark-doc/editor/tableToolsUiMixin.js')
    const id = alias.resolveId('./tablePresentation', importer)
    expect(id).toBe('\0lark-doc-table-presentation')
    const code = alias.load(id)
    expect(code).toContain("readFeature('ui.ready')")
    expect(code).toContain('buildTableToolsPresentation')
    expect(code).not.toContain('TextSelection')
    expect(getRollupConfig('feature:ui').plugins.find(plugin => plugin.name === 'lark-doc-package-alias').resolveId('./tablePresentation', importer)).toBeNull()
  })

  it('private presenter metadata comes from literal functions and rejects an unknown spread', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../src/components/lark-doc/editor/panelPresentation.js'), 'utf8')
    const shape = panelPresentationShape(source)
    expect(shape.methods).toEqual(['panelsHandlers', 'buildVersionState', 'buildVersionPreviewState', 'buildCommentState'])
    expect(shape.commentPanelMethods).toContain('selectCommentParticipant')
    for (const keys of Object.values(shape)) expect(new Set(keys).size).toBe(keys.length)
    expect(() => panelPresentationShape(source.replace('const commentPanelMethods = {', 'const commentPanelMethods = { ...unknownRuntime,'))).toThrow('Unsupported private presentation shape')
  })

  it('keeps version UI factories synchronous and loads the read paths on first use', () => {
    const importer = path.resolve(__dirname, '../../src/components/lark-doc/editor/versioningMixin.js')
    const alias = getRollupConfig('element').plugins.find(plugin => plugin.name === 'lark-doc-package-alias')
    const id = alias.resolveId('./versioningPresentation', importer)
    expect(id).toBe('\0lark-doc-versioning-presentation')
    const shape = versioningPresentationShape()
    expect(shape.computed).toEqual(['versionRestoreConfirmText', 'versionGroups', 'versionPreviewPageRecord', 'versionPreviewTopBar', 'versionChangeCursor', 'versionSelectedDiff', 'versionCurrentProjection'])
    expect(shape.methods).toEqual(['loadVersions', 'selectVersion', 'loadVersionChanges', 'openNamedVersion', 'mountVersionDocumentPreview', 'versionItemName', 'versionItemDesc', 'versionKindLabel', 'versionActorLabel', 'versionTimelineClass', 'versionTimelineItem', 'enterVersionPreview', 'selectVersionPreview', 'mountVersionPreviewPage', 'unmountVersionPreviewPage', 'toggleVersionIndicator', 'closeVersionIndicator', 'versionPreviewLink', 'copyVersionPreviewLink', 'exitVersionPreview', 'toggleVersionShowChanges', 'stepVersionChange', 'stepVersion', 'versionPrev', 'versionNext', 'requestVersionRestore', 'confirmVersionRestore', 'restoreSelectedVersion', 'openVersionTrash', 'loadDeletedVersions', 'restoreDeletedVersion', 'purgeDeletedVersion', 'updateVersionTrash'])
    const code = alias.load(id)
    for (const hot of ['restoreVersion', 'queryRestoreVersion']) expect(code).not.toContain(hot)
    expect(code).toContain('loadFeature("ui.panels")')
    expect(code).not.toMatch(/import\(|TextSelection|new Editor/)
    expect(getRollupConfig('feature:ui').plugins.find(plugin => plugin.name === 'lark-doc-package-alias').resolveId('./versioningPresentation', importer)).toBeNull()
  })

  it('version panel actions keep cached delegates after registry withdrawal and reject actions before first load', async () => {
    const root = process.cwd(), importer = path.join(root, 'src/components/lark-doc/editor/versioningMixin.js')
    const config = getRollupConfig('esm'), alias = config.plugins.find(plugin => plugin.name === 'lark-doc-package-alias')
    const id = alias.resolveId('./versioningPresentation', importer), input = '\0version-action-fixture'
    const bundle = await rollup({ ...config, input, plugins: [{ name: 'version-action-fixture', resolveId: source => [input, id].includes(source) ? source : null,
      load: source => source === input ? `export {createVersioningPresentation} from ${JSON.stringify(id)};export {registerFeature} from ${JSON.stringify(path.join(root, 'src/core/features/registry.js'))}` : null }, ...config.plugins] })
    try {
      const { output } = await bundle.generate({ format: 'iife', name: 'VersionFixture' }), context = {}
      runInNewContext(output[0].code, context)
      const dependencies = { versionCapabilityGate: () => ({ allowed: true }) }
      const actions = context.VersionFixture.createVersioningPresentation(dependencies).methods
      for (const name of ['versionNext', 'confirmVersionRestore', 'purgeDeletedVersion']) expect(() => actions[name].call({})).toThrow('版本界面尚未加载')
      const { createVersioningPresentation } = await import('../../src/components/lark-doc/editor/versioningPresentation')
      const implementation = createVersioningPresentation(dependencies), original = Promise.resolve('original result')
      implementation.methods.restoreSelectedVersion = vi.fn(() => original)
      const factory = vi.fn(() => implementation), withdraw = context.VersionFixture.registerFeature('ui.ready', () => ({ createVersioningPresentation: factory }))
      const session = { documentId: 'doc1', _versioningProviderGeneration: 1, _authorizationGeneration: 2, _privateIdentityGeneration: 3 }
      const readScope = JSON.stringify(['doc1', 1, 2, 3]), record = { id: 'v1', documentId: 'doc1' }
      let resolveGet
      const provider = { get: vi.fn(() => new Promise(resolve => { resolveGet = resolve })) }
      const host = { session, versionNextDisabled: false, stepVersion: () => original, versionPanelOpen: true, versionRestoreDisabled: false,
        versionRestoreConfirmOpen: true, versionRestoreTargetId: 'v1', versionSelectedId: 'v1', versionPreview: { id: 'v1', readScope }, versionList: [record],
        _versionRestoreConfirmEpoch: 0, _versionRestoreConfirmation: { id: 'v1', session, provider, editor: {}, documentId: 'doc1', readScope },
        writable: () => true, versionContextMatches: () => true,
        closeVersionRestoreConfirm() { this.versionRestoreConfirmOpen = false; this._versionRestoreConfirmEpoch += 1 },
        restoreSelectedVersion(id) { return actions.restoreSelectedVersion.call(this, id) } }
      expect(actions.versionNext.call(host)).toBe(original)
      const pending = actions.confirmVersionRestore.call(host)
      expect(provider.get).toHaveBeenCalledWith('v1')
      withdraw()
      expect(actions.versionNext.call(host)).toBe(original)
      resolveGet(record)
      await expect(pending).resolves.toBe('original result')
      expect(implementation.methods.restoreSelectedVersion).toHaveBeenCalledWith('v1')
      expect(factory).toHaveBeenCalledTimes(1)
    } finally { await bundle.close() }
  })

  it('private sharing actions stay synchronous and retain a pending continuation after the UI registry is withdrawn', async () => {
    const root = path.resolve(__dirname, '../..')
    const importer = path.join(root, 'src/components/lark-doc/editor/shareMixin.js')
    const config = getRollupConfig('element')
    const alias = config.plugins.find(plugin => plugin.name === 'lark-doc-package-alias')
    const id = alias.resolveId('./shareInteraction', importer)
    expect(id).toBe('\0lark-doc-share-interaction')
    for (const target of ['esm', 'lite', 'cjs']) {
      expect(getRollupConfig(target).plugins.find(plugin => plugin.name === 'lark-doc-package-alias').resolveId('./shareInteraction', importer)).toBe(id)
    }
    expect(getRollupConfig('feature:ui:umd').plugins.find(plugin => plugin.name === 'lark-doc-package-alias').resolveId('./shareInteraction', importer)).toBeNull()
    const input = '\0share-action-fixture'
    const bundle = await rollup({ ...config, input, plugins: [{ name: 'share-action-fixture', resolveId: source => [input, id].includes(source) ? source : null,
      load: source => source === input ? `export {createShareInteraction} from ${JSON.stringify(id)};export {registerFeature} from ${JSON.stringify(path.join(root, 'src/core/features/registry.js'))}` : null }, ...config.plugins] })
    try {
      const { output } = await bundle.generate({ format: 'iife', name: 'ShareFixture' })
      const context = {}
      runInNewContext(output[0].code, context)
      const deps = { INVITE_SCOPES: { read: ['view'] }, emptyInvitation: () => ({ status: 'idle' }), unresolvedInvitation: () => false, safeUrl: () => true }
      const actions = context.ShareFixture.createShareInteraction(deps).methods
      expect(Object.keys(actions)).toEqual(['selectShareInviteCandidate', 'setShareInviteRole', 'cancelShareInvitation', 'submitShareInvitation', 'queryShareInvitation', 'finishShareInvitation', 'toggleImageShareRecipient', 'setImageShareMessage', 'submitSelectionShare', 'submitImageShare'])
      expect(() => actions.setImageShareMessage.call({}, 'cold')).toThrow('分享界面尚未加载')
      runInNewContext(fs.readFileSync(path.join(root, 'src/components/lark-doc/editor/shareInteraction.js'), 'utf8').replace('export function', 'function') + ';globalThis.shareFactory=createShareInteraction;', context)
      const withdraw = context.ShareFixture.registerFeature('ui.ready', () => ({ createShareInteraction: context.shareFactory }))
      const current = () => true
      let acknowledge
      const requestShare = vi.fn(() => new Promise(resolve => { acknowledge = resolve }))
      const source = { originType: 'share', sourceGrantKey: 'source-one', sourceRevision: '1', scopes: ['view'] }
      const host = { ...actions, shareCan: () => true, _shareInviteCurrent: current,
        shareInvitation: { status: 'confirm', role: 'read', operationId: 'original-operation', sourceGrantKey: 'source-one', candidate: { principalId: 'person-one' } },
        session: { requestShare }, loadShareMembers: vi.fn(async () => { host.shareMembers = { items: [{ principalId: 'person-one', sources: [source] }] } }),
        imageShare: { sending: false, message: '', results: [{ id: 'person-one', kind: 'user' }], recipients: [] } }
      expect(host.toggleImageShareRecipient('person-one', 'user')).toBeUndefined()
      expect(host.imageShare.recipients).toHaveLength(1)
      const pending = host.submitShareInvitation()
      expect(typeof pending.then).toBe('function')
      expect(requestShare).toHaveBeenCalledOnce()
      expect(host.shareInvitation.status).toBe('sending')
      withdraw()
      expect(host.setImageShareMessage('retained draft')).toBeUndefined()
      expect(host.imageShare.message).toBe('retained draft')
      acknowledge({ status: 'committed' })
      expect(await pending).toBe(true)
      expect(host.shareInvitation).toMatchObject({ operationId: 'original-operation', verified: true, status: 'committed' })
      expect(host.loadShareMembers).toHaveBeenCalledOnce()
    } finally { await bundle.close() }
  })

  it('private export actions preserve synchronous JSON and the original promise without loading a module early', async () => {
    const root = path.resolve(__dirname, '../..')
    const importer = path.join(root, 'src/components/lark-doc/editor/exportMixin.js')
    const config = getRollupConfig('element')
    const alias = config.plugins.find(plugin => plugin.name === 'lark-doc-package-alias')
    const id = alias.resolveId('./exportInteraction', importer)
    expect(id).toBe('\0lark-doc-export-interaction')
    expect(getRollupConfig('feature:ui:umd').plugins.find(plugin => plugin.name === 'lark-doc-package-alias').resolveId('./exportInteraction', importer)).toBeNull()
    const input = '\0export-action-fixture'
    const bundle = await rollup({ ...config, input, plugins: [{ name: 'export-action-fixture', resolveId: source => [input, id].includes(source) ? source : null,
      load: source => source === input ? `export {createExportInteraction} from ${JSON.stringify(id)};export {registerFeature} from ${JSON.stringify(path.join(root, 'src/core/features/registry.js'))}` : null }, ...config.plugins] })
    try {
      const { output } = await bundle.generate({ format: 'iife', name: 'ExportFixture' })
      const context = {}, loadExportModule = vi.fn(), loadRemoteConversionModule = vi.fn()
      runInNewContext(output[0].code, context)
      const actions = context.ExportFixture.createExportInteraction({ loadExportModule, loadRemoteConversionModule }).methods
      expect(Object.keys(actions)).toEqual(['submitExport', 'submitLocalExport', 'selectExportRoute', 'queryRemoteExport', 'submitRemoteExport', 'dispatchExport', 'dispatchMarkdown', 'createExportContext', 'readExportComments', 'dispatchDocx', 'dispatchPdf', 'currentDoc'])
      expect(() => actions.currentDoc.call({})).toThrow('导出界面尚未加载')
      expect(loadExportModule).not.toHaveBeenCalled()
      expect(loadRemoteConversionModule).not.toHaveBeenCalled()
      runInNewContext(fs.readFileSync(path.join(root, 'src/components/lark-doc/editor/exportInteraction.js'), 'utf8').replace('export function', 'function') + ';globalThis.exportFactory=createExportInteraction;', context)
      const withdraw = context.ExportFixture.registerFeature('ui.ready', () => ({ createExportInteraction: context.exportFactory }))
      const original = Promise.resolve('original result'), json = { type: 'doc', content: [] }
      const host = { exportRoute: 'local', submitLocalExport: () => original, editor: { getJSON: () => json } }
      expect(actions.submitExport.call(host)).toBe(original)
      expect(actions.currentDoc.call(host)).toBe(json)
      withdraw()
      expect(actions.currentDoc.call(host)).toBe(json)
      expect(actions.submitExport.call(host)).toBe(original)
      expect(loadExportModule).not.toHaveBeenCalled()
      expect(loadRemoteConversionModule).not.toHaveBeenCalled()
    } finally { await bundle.close() }
  })

  it('defers private block rows while preserving source factories and synchronous ready delegation', async () => {
    const root = process.cwd(), importer = path.join(root, 'src/components/lark-doc/editor/blockMenuMixin.js')
    const config = getRollupConfig('esm'), alias = config.plugins.find(plugin => plugin.name === 'lark-doc-package-alias')
    const id = alias.resolveId('./blockInteraction', importer)
    expect(id).toBe('\0lark-doc-block-interaction')
    for (const target of ['element', 'lite', 'cjs']) {
      expect(getRollupConfig(target).plugins.find(plugin => plugin.name === 'lark-doc-package-alias').resolveId('./blockInteraction', importer)).toBe(id)
    }
    expect(getRollupConfig('feature:ui:umd').plugins.find(plugin => plugin.name === 'lark-doc-package-alias').resolveId('./blockInteraction', importer)).toBeNull()
    const input = '\0block-action-fixture'
    const bundle = await rollup({ ...config, input, plugins: [{ name: 'block-action-fixture', resolveId: source => [input, id].includes(source) ? source : null,
      load: source => source === input ? `export {createBlockInteraction} from ${JSON.stringify(id)};export {registerFeature} from ${JSON.stringify(path.join(root, 'src/core/features/registry.js'))}` : null }, ...config.plugins] })
    try {
      const { output } = await bundle.generate({ format: 'iife', name: 'BlockFixture' }), context = {}
      runInNewContext(output[0].code, context)
      const dependencies = {}, actions = context.BlockFixture.createBlockInteraction(dependencies).methods
      expect(Object.keys(actions)).toEqual(['blockTypeAction', 'blockAction', 'tableHandleAction', 'copyBlockLink', 'blockAlignAction', 'blockColorAction', 'openBlockInsertMenu'])
      expect(() => actions.blockAlignAction.call({}, 'center')).toThrow('块菜单界面尚未加载')
      runInNewContext(fs.readFileSync(path.join(root, 'src/components/lark-doc/editor/blockInteraction.js'), 'utf8').replace('export function', 'function') + ';globalThis.blockFactory=createBlockInteraction;', context)
      const implementation = context.blockFactory(dependencies), original = Promise.resolve('original result'), receiver = {}
      implementation.methods.copyBlockLink = function (...args) { expect(this).toBe(receiver); expect(args).toEqual(['range']); return original }
      const factory = vi.fn(value => { expect(value).toBe(dependencies); return implementation })
      const withdraw = context.BlockFixture.registerFeature('ui.ready', () => ({ createBlockInteraction: factory }))
      const target = { pos: 4, node: {} }, applyBlockAttribute = vi.fn()
      const host = { writable: () => true, featureEnabled: () => true, handleActionRange: () => 'range', closeBlockMenu: vi.fn(), blockTextblockTarget: () => target, applyBlockAttribute }
      expect(actions.blockAlignAction.call(host, 'center')).toBeUndefined()
      expect(applyBlockAttribute).toHaveBeenCalledWith(target, 'textAlign', 'center')
      expect(actions.copyBlockLink.call(receiver, 'range')).toBe(original)
      withdraw()
      expect(actions.copyBlockLink.call(receiver, 'range')).toBe(original)
      expect(factory).toHaveBeenCalledTimes(1)
    } finally { await bundle.close() }
  })

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

  it('element has separate native ESM splitting and loader/runtime UMD inputs', () => {
    const esm = getRollupConfig('elementEsm')
    expect(esm.input).toMatch(/src\/web-component\/index\.js$/)
    expect(esm.output.format).toBe('es')
    expect(esm.output.entryFileNames).toBe('lark-doc-element.esm.js')
    expect(esm.output.inlineDynamicImports).toBe(false)
    expect(getRollupConfig('element').input).toMatch(/src\/web-component\/loader\.js$/)
    expect(getRollupConfig('elementRuntime').input).toMatch(/src\/web-component\/standalone\.js$/)
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
    expect(targetsFor('all')).toContain('elementRuntime')
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

  it('Element size includes the eagerly loaded runtime and its initial graph, not just the loader', () => cacheFixture(({ dist }) => {
    const loader = 'lark-doc-element.umd.min.js', runtime = 'lark-doc-element.runtime.umd.min.js'
    const node = (imports = [], dynamicImports = []) => ({ entry: true, imports, dynamicImports })
    const graphs = { element: { [loader]: node() }, elementRuntime: { [runtime]: node(['runtime-part.js'], ['lazy.js']), 'runtime-part.js': { ...node(), entry: false }, 'lazy.js': { ...node(), entry: false } } }
    for (const file of [loader, runtime, 'runtime-part.js', 'lazy.js']) fs.writeFileSync(path.join(dist, file), `/* ${file} */`)
    const save = () => fs.writeFileSync(path.join(dist, 'lark-doc-graph.json'), JSON.stringify(graphs))
    fs.writeFileSync(path.join(dist, 'lark-doc-manifest.json'), JSON.stringify({ features: {} }))
    save()
    expect(graph.artifactFiles(dist, 'element', false)).toEqual([loader, runtime, 'runtime-part.js'])
    expect(graph.artifactFiles(dist, 'element', true)).toContain('lazy.js')
    delete graphs.elementRuntime; save()
    expect(() => graph.artifactFiles(dist, 'element')).toThrow(/构建图缺少本地区块/)
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
    const bundle = await rollup({ ...config, input, plugins: [{ name: 'deferred-entry', resolveId: id => id === input ? input : null }, ...config.plugins] })
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

  it('an input changed during the build cannot be cached; absent ones are hashed on the spot', () => cacheFixture(({ root, previous }) => {
    const started = Object.fromEntries(previous.inputs.map(file => [file, {
      size: fs.statSync(path.join(root, file)).size,
      hash: createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'),
    }]))
    expect(assertStableInputs(started, previous.inputs, root)).toBe(previous.fingerprint)
    // 输入指纹收窄后，watchFiles 里会有「插件 addWatchFile 但从不 load」的文件（虚拟入口的源文件），
    // 它们没有基线读数。这类输入按当前读数补基线即可 —— 若在这里判死，每次全量构建都会失败。
    expect(() => assertStableInputs({}, previous.inputs, root)).not.toThrow()
    fs.writeFileSync(path.join(root, previous.inputs[0]), 'changed while building')
    expect(() => assertStableInputs(started, previous.inputs, root)).toThrow(/构建期间输入发生变化/)
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


describe('classic segmented document feature boundary', () => {
  it('maps each existing asynchronous share-link entry to its original namespace only in classic Element', () => {
    const root = path.resolve(__dirname, '../..')
    const plugin = getRollupConfig('elementRuntime').plugins.find(item => item.name === 'lark-doc-package-alias')
    for (const [file, links, access] of [['src/providers/authorization.js', 1, 1], ['src/components/lark-doc/editor/shareLinkMethods.js', 1, 0], ['src/providers/document-business.js', 0, 1]]) {
      const id = path.join(root, file), source = fs.readFileSync(id, 'utf8'), result = plugin.transform(source, id)
      expect(result).not.toBeNull()
      expect((result.code.match(/__larkDocLoadDocumentFeature\('document.shareLinks'\)/g) || []).length).toBe(links)
      expect((result.code.match(/__larkDocLoadDocumentFeature\('document.shareLinkAccess'\)/g) || []).length).toBe(access)
      const syntax = "import {x} from './share-links'; const label=\"import('./share-links')\"; const request=()=>import(variable)"
      expect(plugin.transform(syntax, id)).toBeNull()
      for (const target of ['esm', 'cjs', 'elementEsm', 'feature:document:umd']) {
        expect(getRollupConfig(target).plugins.find(item => item.name === 'lark-doc-package-alias').transform(source, id)).toBeNull()
      }
    }
  })

  it('keeps the paged import namespace synchronous while loading its implementation only through existing asynchronous callers', async () => {
    const root = path.resolve(__dirname, '../..'), source = path.join(root, 'src/editor/pagedDocumentSource.js')
    const config = getRollupConfig('elementRuntime'), alias = config.plugins.find(item => item.name === 'lark-doc-package-alias')
    const id = alias.resolveId('./pagedDocumentImportRuntime', source)
    expect(id).toBe('\0lark-doc-paged-import-runtime')
    const entry = '\0paged-import-boundary-fixture', registry = path.join(root, 'src/core/features/registry.js')
    const bundle = await rollup({ ...config, input: entry, plugins: [{ name: 'paged-import-boundary-fixture',
      resolveId: name => [entry, id].includes(name) ? name : null,
      load: name => name === entry ? `export {createPagedDocumentImportRuntime} from ${JSON.stringify(id)};export {registerFeature} from ${JSON.stringify(registry)}` : null,
    }, ...config.plugins] })
    try {
      const { output } = await bundle.generate({ format: 'iife', name: 'PagedImportFixture' })
      const context = { setTimeout, clearTimeout }
      runInNewContext(output[0].code, context)
      const api = context.PagedImportFixture.createPagedDocumentImportRuntime({})
      const arities = { yieldDocumentTask: 0, createPagedDocumentSource: 1, startPagedImport: 4, importPagedContent: 3, importWorkspaceFile: 3 }
      expect(Object.keys(api).sort()).toEqual(Object.keys(arities).sort())
      for (const [name, length] of Object.entries(arities)) expect(api[name].length, name).toBe(length)
      expect(() => api.yieldDocumentTask()).toThrow('分页导入尚未加载')
      runInNewContext(fs.readFileSync(path.join(root, 'src/editor/pagedDocumentImportRuntime.js'), 'utf8').replace('export function', 'function') + ';globalThis.importFactory=createPagedDocumentImportRuntime;', context)
      const withdraw = context.PagedImportFixture.registerFeature('document.pagedImport.ready', () => context.importFactory)
      const pending = api.createPagedDocumentSource('unused')
      expect(typeof pending.then).toBe('function')
      await expect(pending).rejects.toThrow('preparePage is required')
      withdraw()
      await expect(api.yieldDocumentTask()).resolves.toBeUndefined()
    } finally { await bundle.close() }
    // 文件导入在 `WorkspaceController.js` 的「文件导入导出域」里，白名单按导入方路径匹配。
    for (const file of ['src/editor/EditorController.js', 'src/workspace/workspaceTransferMethods.js']) {
      const pathName = path.join(root, file), code = fs.readFileSync(pathName, 'utf8')
      const transformed = alias.transform(code, pathName)
      expect(transformed.code.match(/__larkDocLoadDocumentFeature\('document.pagedImport'\)\.then/g)).toHaveLength(1)
      expect(transformed.code).toContain('=>import(')
      for (const target of ['esm', 'cjs', 'elementEsm', 'feature:document:umd']) {
        const plugin = getRollupConfig(target).plugins.find(item => item.name === 'lark-doc-package-alias')
        expect(plugin.transform(code, pathName)).toBeNull()
      }
    }
  })

  it('loads one classic pure model script, retries errors and preserves synchronous namespace functions', async () => {
    const config = getRollupConfig('elementRuntime'), entry = '\0classic-document-loader-fixture'
    const registry = path.resolve(__dirname, '../../src/core/features/registry.js')
    const scriptSource = path.resolve(__dirname, '../../src/features/element.js')
    const alias = config.plugins.find(plugin => plugin.name === 'lark-doc-package-alias')
    const paged = alias.resolveId('./pagedDocumentViewRuntime', path.resolve(__dirname, '../../src/editor/pagedDocumentView.js'))
    const loader = await rollup({ ...config, input: entry, plugins: [{ name: 'classic-document-loader-fixture',
      resolveId: id => [entry, paged].includes(id) ? id : null,
      load: id => id === entry ? `import ${JSON.stringify(scriptSource)};export{loadFeature}from ${JSON.stringify(registry)};export{createPagedDocumentViewRuntime}from ${JSON.stringify(paged)}` : null,
    }, ...config.plugins] })
    const featureConfig = getRollupConfig('feature:document:umd'), feature = await rollup(featureConfig)
    try {
      const loaderOutput = await loader.generate({ ...config.output, name: 'FixtureElementLoader' })
      const featureOutput = await feature.generate(featureConfig.output)
      const modelPath = path.resolve(__dirname, '../../src/editor/segmentedDocumentModel.js')
      const chunks = featureOutput.output.filter(item => item.type === 'chunk')
      expect(chunks).toHaveLength(1)
      expect(Object.keys(chunks[0].modules)).toContain(modelPath)
      expect(Object.keys(chunks[0].modules).some(id => /prosemirror-|@tiptap\/pm\//.test(id))).toBe(false)
      const scripts = [], context = { document: { currentScript: { src: 'https://cdn.example/sdk/lark-doc-element.runtime.umd.min.js' },
        createElement: () => ({ remove() { this.removed = true } }), head: { appendChild: node => scripts.push(node) } }, URL }
      runInNewContext(loaderOutput.output.find(item => item.type === 'chunk').code, context)
      const bridge = context.FixtureElementLoader.createPagedDocumentViewRuntime({})
      const existingView = {}, editor = { storage: { larkDoc: { pagedView: existingView } } }
      expect(bridge.preparePagedDocumentView.length).toBe(1)
      expect(bridge.scrollDocumentSelection.length).toBe(1)
      expect(() => bridge.preparePagedDocumentView(editor)).toThrow('分页视图尚未加载')
      expect(scripts).toHaveLength(0)
      const first = context.FixtureElementLoader.loadFeature('document.shareLinks').catch(error => error)
      const concurrent = context.FixtureElementLoader.loadFeature('document.segmented').catch(error => error)
      await vi.waitFor(() => expect(scripts).toHaveLength(1))
      expect(scripts[0].src).toBe('https://cdn.example/sdk/lark-doc-element.umd.min.document.js')
      expect(scripts[0].type).toBeUndefined()
      scripts[0].onerror(); expect((await first).message).toContain('无法加载本地特性包'); expect((await concurrent).message).toContain('无法加载本地特性包')
      expect(scripts[0].removed).toBe(true)
      const retry = context.FixtureElementLoader.loadFeature('document.shareLinkAccess')
      await vi.waitFor(() => expect(scripts).toHaveLength(2))
      runInNewContext(chunks[0].code, context); scripts[1].onload()
      await retry
      const api = await context.FixtureElementLoader.loadFeature('document.segmented')
      const shareLinks = await context.FixtureElementLoader.loadFeature('document.shareLinks')
      expect(Object.keys(shareLinks).sort()).toEqual(['createShareLinkAccessPort', 'createShareLinkPort', 'remoteShareLinkAction', 'shareLinkUrl'].sort())
      expect(shareLinks.then).toBeUndefined()
      const shareAccess = await context.FixtureElementLoader.loadFeature('document.shareLinkAccess')
      expect(Object.keys(shareAccess)).toEqual(['createHttpShareLinkAccessProvider'])
      expect(() => shareAccess.createHttpShareLinkAccessProvider({})).toThrow('SHARE_LINK_CONFIGURATION')
      expect(scripts).toHaveLength(2)
      const expected = [...fs.readFileSync(modelPath, 'utf8').matchAll(/^export (?:const|function) (\w+)/gm)].map(match => match[1]).sort()
      expect(Object.keys(api).sort()).toEqual(expected)
      expect(api.estimateBlockHeight({ image: true })).toBe(192)
      const model = api.createSegmentedDocumentModel({ childCount: 0 })
      expect(model.segmentCount).toBe(0); expect(model.then).toBeUndefined()
      expect(api.createLogicalScrollCoordinates([40, 80]).logicalHeight).toBe(120)
      expect(await context.FixtureElementLoader.loadFeature('document.segmented')).toBe(api)
      const pagedFactory = await context.FixtureElementLoader.loadFeature('document.pagedView')
      expect(pagedFactory).toBeTypeOf('function')
      expect(Object.keys(pagedFactory({}))).toEqual(['scrollDocumentSelection', 'preparePagedDocumentView'])
      expect(bridge.preparePagedDocumentView(editor)).toBe(existingView)
      expect(bridge.preparePagedDocumentView(editor).then).toBeUndefined()
      expect(scripts).toHaveLength(2)
      cacheFixture(({ dist }) => {
        const runtime = path.join(dist, 'lark-doc-element.runtime.umd.min.js')
        const payload = path.join(dist, 'lark-doc-element.umd.min.document.js')
        fs.writeFileSync(runtime, loaderOutput.output.find(item => item.type === 'chunk').code)
        const result = spawnSync(process.execPath, ['-e', `
          (async()=>{
            const fs=require('fs'),api=require(${JSON.stringify(runtime)});
            let missing=false;try{await api.loadFeature('document.segmented')}catch(error){missing=/Cannot find module/.test(error.message)}
            if(!missing)throw Error('Node must attempt the adjacent real document feature');
            fs.writeFileSync(${JSON.stringify(payload)},${JSON.stringify(chunks[0].code)});
            const model=await api.loadFeature('document.segmented');
            if(model.createSegmentedDocumentModel({childCount:0}).segmentCount!==0)throw Error('Missing real synchronous model');
            if(await api.loadFeature('document.segmented')!==model)throw Error('Duplicate model namespace');
            let classic=false;try{await api.loadFeature('math')}catch(error){classic=/同目录静态托管/.test(error.message)}
            if(!classic)throw Error('Node fallback must not change the existing six classic groups');
            console.log('adjacent-document-model-ready');
          })().catch(error=>{console.error(error);process.exitCode=1})
        `], { encoding: 'utf8' })
        expect(result.status, result.stderr).toBe(0)
        expect(result.stdout).toContain('adjacent-document-model-ready')
      })
    } finally { await loader.close(); await feature.close() }
    // 本用例要跑两次 rollup（loader + feature）再 runInNewContext 起两个 node 子进程，
    // 全量门禁下 maxWorkers:2 叠加并发文件负载必然越过默认 5000ms —— 与本文件其余重
    // 构建类用例（513/948/1009/1159 行）同口径，显式给 30000。
  }, 30000)
  it('rewrites only the existing awaited model imports for classic Element, preserving source and every synchronous export', () => {
    const id = path.resolve(__dirname, '../../src/mount/domRenderer.js')
    const source = fs.readFileSync(id, 'utf8')
    const plugin = getRollupConfig('elementRuntime').plugins.find(item => item.name === 'lark-doc-package-alias')
    expect(plugin.transform).toBeTypeOf('function')
    const result = plugin.transform(source, id)
    expect(result.code).not.toContain("import('../editor/segmentedDocumentModel')")
    expect(result.code.match(/__larkDocLoadDocumentFeature\('document.segmented'\)/g)).toHaveLength(2)
    const syntax = "import { x } from '../editor/segmentedDocumentModel';const label=\"import('../editor/segmentedDocumentModel')\";const request=()=>import(variable)"
    expect(plugin.transform(syntax, id)).toBeNull()
    expect(plugin.transform(source, id + '.other')).toBeNull()
    for (const target of ['esm', 'cjs', 'elementEsm', 'feature:document:umd']) {
      const other = getRollupConfig(target).plugins.find(item => item.name === 'lark-doc-package-alias')
      expect(other.transform(source, id)).toBeNull()
    }
  })
  it('gates the existing paged view callers and retains both import actions through the shared loader', () => {
    const root = path.resolve(__dirname, '../..')
    const plugin = getRollupConfig('elementRuntime').plugins.find(item => item.name === 'lark-doc-package-alias')
    for (const [file, count] of [['src/editor/pagedDocumentSource.js', 1], ['src/components/lark-doc/editor/viewModesMixin.js', 1]]) {
      const id = path.join(root, file), source = fs.readFileSync(id, 'utf8')
      const result = plugin.transform(source, id)
      expect(result.code.match(/__larkDocLoadDocumentFeature\('document.pagedView'\)\.then/g)).toHaveLength(count)
      expect(result.code).toContain('=>import(')
      for (const target of ['esm', 'cjs', 'elementEsm', 'feature:document:umd']) {
        expect(getRollupConfig(target).plugins.find(item => item.name === 'lark-doc-package-alias').transform(source, id)).toBeNull()
      }
      const unchanged = "import {x} from './pagedDocumentView'; const label=\"import('./pagedDocumentView')\"; const request=()=>import(variable)"
      expect(plugin.transform(unchanged, id)).toBeNull()
    }
    const runtime = fs.readFileSync(path.join(root, 'src/editor/pagedDocumentImportRuntime.js'), 'utf8')
    expect(runtime.match(/await loadPagedDocumentViewModule\(\)/g)).toHaveLength(2)
    const importer = path.join(root, 'src/editor/pagedDocumentView.js')
    expect(plugin.resolveId('./pagedDocumentViewRuntime', importer)).toBe('\0lark-doc-paged-view-runtime')
    expect(getRollupConfig('feature:document:umd').plugins.find(item => item.name === 'lark-doc-package-alias').resolveId('./pagedDocumentViewRuntime', importer)).toBeNull()
  })

  it('rewrites only the lazy call sites that a shipped feature pack actually registers', () => {
    const root = path.resolve(__dirname, '../..')
    const groups = fs.readFileSync(path.join(root, 'src/features/element.js'), 'utf8')
    // 名字必须真在 element.js 的 groups 里。改写成一个没人注册的名字，点下去拿到的是
    // 「特性包未注册」而不是回落到内核那份实现 —— 构建期看不出来，只能在这里卡住。
    const registered = new Set([...groups.matchAll(/'([\w.]+)'/g)].map(match => match[1]))
    expect(LAZY_PACKAGE_CALLERS.size).toBeGreaterThan(0)
    for (const [caller, requests] of LAZY_PACKAGE_CALLERS) {
      expect(fs.existsSync(caller), caller).toBe(true)
      for (const [source, feature] of requests) {
        expect(fs.existsSync(path.join(root, source)), source).toBe(true)
        expect(registered.has(feature), `${path.relative(root, caller)} → ${feature}`).toBe(true)
      }
    }
  })

  it('keeps docx and markdown out of the lazily loaded export pack', () => {
    const root = path.resolve(__dirname, '../..'), index = path.join(root, 'src/utils/export/index.js')
    const stub = path.join(root, 'src/core/features/stub.js')
    const alias = target => getRollupConfig(target).plugins.find(item => item.name === 'lark-doc-package-alias')
    // 包内照抄这两条边会把真 docx（raw 639 KB）拖进懒包，而 Element 里它们本来
    // 就走 office / markdown 特性包，包的实现由 loadFeature 兜住。
    for (const target of ['feature:export:umd', 'feature:export', 'elementRuntime', 'element']) {
      for (const request of ['./markdown.js', './docx.js']) expect(alias(target).resolveId(request, index), target).toBe(stub)
    }
    // 非 Element 宿主照旧拿真实现：这两条边是它们导出的唯一来源。
    for (const target of ['esm', 'cjs', 'lite', 'elementEsm']) {
      for (const request of ['./markdown.js', './docx.js']) expect(alias(target).resolveId(request, index), target).toBeNull()
    }
  })

  it('routes the deferred uiExtra pack through the shared host modules instead of repacking them', () => {
    const root = path.resolve(__dirname, '../..')
    const alias = getRollupConfig('feature:uiExtra:umd').plugins.find(item => item.name === 'lark-doc-package-alias')
    // 与内核同版本同目录部署，所以只留转发 shim；否则光 ui/icons 就要在包里再打一份 27 KB。
    expect(alias.resolveId('./dom', path.join(root, 'src/ui/documentInformation.js'))).toBe('\0lark-doc-shared-host:ui.dom')
    expect(alias.resolveId('./icon', path.join(root, 'src/ui/headingNumberMenu.js'))).toBe('\0lark-doc-shared-host:ui.icon')
    // 经典导出包也由同版本运行时加载，ESM 独立构建无这个运行时前提。
    expect(getRollupConfig('feature:export:umd').plugins.find(item => item.name === 'lark-doc-package-alias')
      .resolveId('./dom', path.join(root, 'src/ui/documentInformation.js'))).toBe('\0lark-doc-shared-host:ui.dom')
    expect(getRollupConfig('elementEsm').plugins.find(item => item.name === 'lark-doc-package-alias')
      .resolveId('./dom', path.join(root, 'src/ui/documentInformation.js'))).toBeNull()
  })

  it('ships both document feature formats in clean builds and freshness checks', () => {
    expect(FEATURE_TARGETS).toContain('feature:document:umd')
    expect(FEATURE_TARGETS).toContain('feature:document')
    expect(targetsFor('element')).toContain('feature:document:umd')
    expect(targetsFor('all')).toContain('feature:document')
    const source = fs.readFileSync(path.resolve(__dirname, '../../scripts/ensure-artifacts.mjs'), 'utf8')
    expect(source).toContain("file: 'dist/lark-doc-element.umd.min.document.js'")
    expect(source).toContain("file: 'dist/features/document.js'")
  })
  it('accounts for every classic feature in the real dynamic closure and fails closed for missing payloads', () => cacheFixture(({ dist }) => {
    const node = (entry = true) => ({ entry, imports: [], dynamicImports: [], runtime: false })
    const loader = 'lark-doc-element.umd.min.js', runtime = 'lark-doc-element.runtime.umd.min.js'
    const names = ['math', 'mermaid', 'highlight', 'markdown', 'office', 'ui', 'document']
    const features = Object.fromEntries(names.map(name => [name, { umd: `lark-doc-element.umd.min.${name}.js` }]))
    const graphs = { element: { [loader]: node() }, elementRuntime: { [runtime]: node() } }
    for (const [name, feature] of Object.entries(features)) graphs[`feature:${name}:umd`] = { [feature.umd]: node() }
    const save = () => fs.writeFileSync(path.join(dist, 'lark-doc-graph.json'), JSON.stringify(graphs))
    fs.writeFileSync(path.join(dist, 'lark-doc-manifest.json'), JSON.stringify({ features })); save()
    for (const file of [loader, runtime, ...Object.values(features).map(item => item.umd)]) fs.writeFileSync(path.join(dist, file), file)
    expect(graph.artifactFiles(dist, 'element', false)).toEqual([loader, runtime])
    expect(graph.artifactFiles(dist, 'element')).toEqual([loader, runtime, ...Object.values(features).map(item => item.umd)])
    expect(graph.artifactFiles(dist, 'elementRuntime')).toContain(features.document.umd)
    delete graphs['feature:document:umd']; save()
    expect(() => graph.artifactFiles(dist, 'element')).toThrow(/构建图缺少/)
    expect(graph.artifactFiles(dist, 'element', false)).toEqual([loader, runtime])
    graphs['feature:document:umd'] = { [features.document.umd]: node() }; save()
    fs.unlinkSync(path.join(dist, features.document.umd))
    expect(() => graph.artifactFiles(dist, 'element')).toThrow(/依赖区块缺失/)
  }))
})
