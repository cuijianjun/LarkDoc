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
  '@tiptap/y-tiptap',
  '@hocuspocus/provider',
  'y-protocols',
  'lib0',
])
export const featureNames = ['math', 'mermaid', 'highlight', 'markdown', 'office', 'ui', 'document']
// Element 侧的面板包：`ui` 守选区/悬浮/表格/顶栏，`uiPanels` 守侧栏面板与对话框。
// uiPanels 只有 UMD 形态——非 Element 宿主统一走 features/ui.js 全量出口。
// export / uiExtra / background 同样只有 UMD 形态：它们装的是源码里本就写成
// `await import()` 的懒边界（点导出、开浮层、发起上传与转换），非 Element 宿主的
// es/cjs 产物本来就是多 chunk，那条边界天生成立，不需要包。
const elementOnlyPackNames = ['uiPanels', 'uiOverlays', 'export', 'uiExtra', 'background']
export const elementPackNames = [...featureNames, ...elementOnlyPackNames]
export const elementPackStyles = { ui: 'lark-doc-element.ui.css', uiPanels: 'lark-doc-element.panels.css' }
// UMD 入口未必与特性同名：ui 的两半各有一个入口，es 形态仍用 ui.js 全集。
const FEATURE_UMD_ENTRY = { ui: 'ui-core', uiPanels: 'ui-panels', uiOverlays: 'ui-overlays' }
const ELEMENT_UI_ENTRY = '\0lark-doc-element-ui:'
const UI_FALLBACK_ENTRY = '\0lark-doc-ui-fallback'
const PANEL_PRESENTATION_ENTRY = '\0lark-doc-panel-presentation'
const PANEL_PRESENTATION_SOURCE = resolve(ROOT, 'src/components/lark-doc/editor/panelPresentation.js')
const TABLE_PRESENTATION_ENTRY = '\0lark-doc-table-presentation'
const TABLE_PRESENTATION_SOURCE = resolve(ROOT, 'src/components/lark-doc/editor/tablePresentation.js')
const COMMENT_INTERACTION_ENTRY = '\0lark-doc-comment-interaction'
const COMMENT_INTERACTION_SOURCE = resolve(ROOT, 'src/components/lark-doc/editor/commentInteraction.js')
const CALLOUT_PRESENTATION_ENTRY = '\0lark-doc-callout-presentation'
const CALLOUT_PRESENTATION_SOURCE = resolve(ROOT, 'src/components/lark-doc/editor/calloutPresentation.js')
const VERSIONING_PRESENTATION_ENTRY = '\0lark-doc-versioning-presentation'
const VERSIONING_PRESENTATION_SOURCE = resolve(ROOT, 'src/components/lark-doc/editor/versioningPresentation.js')
const SHARE_INTERACTION_ENTRY = '\0lark-doc-share-interaction'
const SHARE_INTERACTION_SOURCE = resolve(ROOT, 'src/components/lark-doc/editor/shareInteraction.js')
const EXPORT_INTERACTION_ENTRY = '\0lark-doc-export-interaction'
const EXPORT_INTERACTION_SOURCE = resolve(ROOT, 'src/components/lark-doc/editor/exportInteraction.js')
const BLOCK_INTERACTION_ENTRY = '\0lark-doc-block-interaction'
const BLOCK_INTERACTION_SOURCE = resolve(ROOT, 'src/components/lark-doc/editor/blockInteraction.js')
const PAGED_VIEW_ENTRY = '\0lark-doc-paged-view-runtime'
const PAGED_VIEW_SOURCE = resolve(ROOT, 'src/editor/pagedDocumentView.js')
const PAGED_VIEW_RUNTIME_SOURCE = resolve(ROOT, 'src/editor/pagedDocumentViewRuntime.js')
const PAGED_IMPORT_ENTRY = '\0lark-doc-paged-import-runtime'
const PAGED_IMPORT_SOURCE = resolve(ROOT, 'src/editor/pagedDocumentSource.js')
const PAGED_IMPORT_RUNTIME_SOURCE = resolve(ROOT, 'src/editor/pagedDocumentImportRuntime.js')
const elementUiModules = {
  panels: ['createCommentPanel', 'createVersionPanel', 'createVersionToast'],
  dialogs: ['createEmbedDialog', 'createHelpDrawer', 'createLinkDialog', 'createMathDialog', 'createTablePickerDialog'],
  extendedOverlays: ['createExtendedOverlays'],
  colorPalette: ['createColorPalette'], revision: ['createRevisionPanels'], isvPanel: ['createIsvPanel'],
  reminder: ['createReminder'], calendarSearch: ['createCalendarSearch'], searchPanel: ['createSearchPanel'],
  commandMenu: ['createCommandMenu'], templateLibrary: ['createTemplateLibrary'],
  overlays: ['createDocumentOverlays'], notifications: ['createNotifications'],
  tableTools: ['createTableTools', 'createTableBoundaryTools'], tableOverlays: ['createTableOverlays'],
  cellPlusTools: ['createCellPlusTools'], linkTools: ['createLinkTools'],
  bubbleBar: ['createBubbleBar'],
  workspacePanels: ['createWorkspacePanels'],
  calloutTools: ['createCalloutTools'],
  topBarMenus: ['createTopBarMenus'],
  desktopHeaderDetails: ['createDesktopHeaderDetails'],
  scrollNavigator: ['createScrollNavigator'],
  blockHandleMenus: ['createBlockHandleMenus'],
}
// 侧栏面板/对话框/浮层：只有显式点击后才会变成可见，可以多等一个脚本。
// 其余（选区、悬浮块、表格工具、顶栏菜单、命令面板、callout 工具）都要在
// 鼠标一动时立刻出现，留在 ui 包。
const uiPanelPackGroups = new Set(['panels', 'dialogs', 'templateLibrary', 'workspacePanels',
  'reminder', 'searchPanel', 'revision', 'isvPanel', 'calendarSearch', 'notifications', 'desktopHeaderDetails', 'scrollNavigator'])
const uiOverlayPackGroups = new Set(['extendedOverlays', 'colorPalette', 'overlays'])

/**
 * 内核已完整持有、特性包只需转发的模块（阶段 5）。
 *
 * 拆 ui 子包后同一个模块会同时落在内核与两个包里。登记到这里，包内就只剩一段
 * 只列导出名的 shim，实现体读内核发布在宿主全局的那一份（见
 * src/core/features/shared-host.js）。
 *
 * 登记条件很硬：**内核里该模块的渲染长度必须不小于包里的需求**。内核是
 * tree-shaken 的，`segmentedDocumentModel` 内核只留 2,348 B 而 document 包要
 * 54,707 B —— 这种一提上来就是往首屏塞 52 KB，绝不能登记。判定方法见
 * docs/guide/performance.md「跨包重复」一节。
 *
 * 值必须是 src/web-component/standalone.js 发布时的同一个名字；
 * test/unit/build-contract.test.js 守着这条对齐。
 */
export const sharedHostModules = {
  'src/ui/icons.js': 'ui.icons',
  'src/ui/icon.js': 'ui.icon',
  'src/ui/dom.js': 'ui.dom',
  'src/ui/palette.js': 'ui.palette',
  'src/ui/menuLayout.js': 'ui.menuLayout',
  'src/ui/headingMenu.js': 'ui.headingMenu',
  'src/ui/diagramMenu.js': 'ui.diagramMenu',
  'src/ui/tooltip.js': 'ui.tooltip',
  'src/ui/hoverTips.js': 'ui.hoverTips',
  'src/ui/select.js': 'ui.select',
  'src/core/emoji/identity-data.js': 'core.emojiIdentityData',
  'src/core/emoji/identity.js': 'core.emojiIdentity',
  'src/core/policy/url.js': 'core.policyUrl',
  'src/core/policy/network.js': 'core.policyNetwork',
  'src/core/media/image-crop.js': 'core.imageCrop',
  'src/components/lark-doc/editor/commentImages.js': 'editor.commentImages',
  'src/components/lark-doc/editor/constants.js': 'editor.constants',
}
const SHARED_HOST_ENTRY = '\0lark-doc-shared-host:'
// 与内核同版本部署的按需包复用内核实现。标准构建仍自带实现。
const SHARED_HOST_TARGETS = new Set(['feature:ui:umd', 'feature:uiPanels:umd', 'feature:uiOverlays:umd', 'feature:uiExtra:umd', 'feature:export:umd', 'feature:background:umd'])
const sharedHostPaths = new Map(Object.entries(sharedHostModules).map(([file, name]) => [resolve(ROOT, file), name]))
const sharedHostNames = new Map(Object.entries(sharedHostModules).map(([file, name]) => [name, resolve(ROOT, file)]))
const lazyRuntimeExports = {
  '@tiptap/core': ['getTextBetween', 'getTextSerializersFromSchema'],
  '@tiptap/pm/history': ['closeHistory'],
  '@tiptap/pm/model': ['DOMSerializer', 'Fragment'],
  '@tiptap/pm/state': ['Plugin', 'PluginKey', 'TextSelection'],
  '@tiptap/pm/view': ['Decoration', 'DecorationSet'],
  'ui.imageViewer': ['createImageViewer'],
  'core.featureRegistration': ['registerFeature'],
}
const backgroundRuntimeImporters = new Set([
  'src/core/media/file-upload-tasks.js', 'src/core/media/image-insert.js', 'src/editor/documentSnapshot.js',
].map(file => resolve(ROOT, file)))

/** Read only literal private presentation keys; never evaluate application code. */
function privatePresentationShape(source, factoryName, namespaces) {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' })
  const factory = ast.body.find(node => node.type === 'ExportNamedDeclaration' && node.declaration?.id?.name === factoryName)?.declaration
  if (factory?.type !== 'FunctionDeclaration') throw new Error('Missing private panel presentation factory')
  const definitions = new Map()
  for (const statement of factory.body.body) if (statement.type === 'VariableDeclaration') {
    for (const item of statement.declarations) if (item.id.type === 'Identifier' && item.init?.type === 'ObjectExpression') definitions.set(item.id.name, item.init)
  }
  const keys = (name, seen = new Set()) => {
    if (seen.has(name) || !definitions.has(name)) throw new Error(`Unresolved private presentation keys: ${name}`)
    const next = new Set(seen).add(name)
    return definitions.get(name).properties.flatMap(property => {
      if (property.type === 'Property' && !property.computed) return [property.key.name || property.key.value]
      // The participant adapters preserve exactly the keys of their literal source.
      const from = property.argument
      const mapping = from?.arguments?.[0]
      const entries = mapping?.callee?.object
      if (property.type === 'SpreadElement' && from?.callee?.object?.name === 'Object' && from.callee.property?.name === 'fromEntries'
        && mapping?.callee?.property?.name === 'map' && entries?.callee?.object?.name === 'Object' && entries.callee.property?.name === 'entries'
        && entries.arguments?.[0]?.type === 'Identifier') return keys(entries.arguments[0].name, next)
      throw new Error(`Unsupported private presentation shape: ${name}`)
    })
  }
  return Object.fromEntries(Object.entries(namespaces).map(([namespace, name]) => [namespace, keys(name)]))
}

export function panelPresentationShape(source = readFileSync(PANEL_PRESENTATION_SOURCE, 'utf8')) {
  return privatePresentationShape(source, 'createPanelPresentation', { methods: 'methods', computed: 'commentPanelComputed',
    commentPanelMethods: 'commentPanelMethods', commentParticipantActions: 'commentParticipantActions' })
}

export function commentInteractionShape(source = readFileSync(COMMENT_INTERACTION_SOURCE, 'utf8')) {
  return privatePresentationShape(source, 'createCommentInteraction', { methods: 'methods' })
}

export function versioningPresentationShape(source = readFileSync(VERSIONING_PRESENTATION_SOURCE, 'utf8')) {
  return privatePresentationShape(source, 'createVersioningPresentation', { computed: 'computed', methods: 'methods' })
}

function deferredShareInteraction() {
  const { methods } = privatePresentationShape(readFileSync(SHARE_INTERACTION_SOURCE, 'utf8'), 'createShareInteraction', { methods: 'methods' })
  return `import {readFeature} from ${JSON.stringify(resolve(ROOT, 'src/core/features/registry.js'))};
export function createShareInteraction(dependencies){
 let implementation;
 function ready(){
  if(implementation)return implementation;
  const factory=readFeature('ui.ready')?.createShareInteraction;
  if(typeof factory!=='function')throw new Error('分享界面尚未加载');
  return implementation=factory(dependencies);
 }
 return {methods:Object.fromEntries(${JSON.stringify(methods)}.map(name=>[name,function(...args){return ready().methods[name].apply(this,args);}]))};
}`
}

function deferredExportInteraction() {
  const { methods } = privatePresentationShape(readFileSync(EXPORT_INTERACTION_SOURCE, 'utf8'), 'createExportInteraction', { methods: 'methods' })
  return `import {readFeature} from ${JSON.stringify(resolve(ROOT, 'src/core/features/registry.js'))};
export function createExportInteraction(dependencies){
 let implementation;
 function ready(){
  if(implementation)return implementation;
  const factory=readFeature('ui.ready')?.createExportInteraction;
  if(typeof factory!=='function')throw new Error('导出界面尚未加载');
  return implementation=factory(dependencies);
 }
 return {methods:Object.fromEntries(${JSON.stringify(methods)}.map(name=>[name,function(...args){return ready().methods[name].apply(this,args);}]))};
}`
}

function deferredBlockInteraction() {
  const { methods } = privatePresentationShape(readFileSync(BLOCK_INTERACTION_SOURCE, 'utf8'), 'createBlockInteraction', { methods: 'methods' })
  return `import {readFeature} from ${JSON.stringify(resolve(ROOT, 'src/core/features/registry.js'))};
export function createBlockInteraction(dependencies){
 let implementation;
 function ready(){
  if(implementation)return implementation;
  const factory=readFeature('ui.ready')?.createBlockInteraction;
  if(typeof factory!=='function')throw new Error('块菜单界面尚未加载');
  return implementation=factory(dependencies);
 }
 return {methods:Object.fromEntries(${JSON.stringify(methods)}.map(name=>[name,function(...args){return ready().methods[name].apply(this,args);}]))};
}`
}

function deferredVersioningPresentation(shape, element) {
  const actions = shape.methods.filter(name => !['mountVersionDocumentPreview', 'versionItemName', 'versionItemDesc', 'versionKindLabel', 'versionActorLabel', 'versionTimelineClass'].includes(name))
  const loader = element ? 'loadFeature("ui.panels")' : 'loadFeature("ui",dependencies.loadVersionUi)'
  return `import {loadFeature,readFeature} from ${JSON.stringify(resolve(ROOT, 'src/core/features/registry.js'))};
export function createVersioningPresentation(dependencies){
 let implementation;
 return Object.fromEntries(Object.entries(${JSON.stringify(shape)}).map(([namespace,keys])=>[namespace,Object.fromEntries(keys.map(name=>[name,function(...args){
  void this.panelPresentationRevision;
  if(implementation)return implementation[namespace][name].apply(this,args);
  const factory=readFeature('ui.ready')?.createVersioningPresentation;
  if(typeof factory==='function'){implementation=factory(dependencies);return implementation[namespace][name].apply(this,args);}
  if(name==='loadVersions'||name==='selectVersion'){
   const scope=this.versionOperationScope(), session=this.session, editor=this.editor;
   const current=()=>!this._isBeingDestroyed&&this.session===session&&this.editor===editor&&this.versionContextMatches(session,this.versionProvider,editor)&&scope===this.versionOperationScope();
   return ${loader}.then(api=>{
    if(!current())return name==='loadVersions'?[]:null;
    implementation||=api.createVersioningPresentation(dependencies);
    return implementation.methods[name].apply(this,args);
   },()=>{
    if(current())this[name==='loadVersions'?'versionError':'versionPreviewError']='版本界面暂时无法加载，请重试';
    return name==='loadVersions'?[]:null;
   });
  }
  if(${JSON.stringify(actions)}.includes(name))throw new Error('版本界面尚未加载');
  if(name==='mountVersionDocumentPreview')throw new Error('版本预览界面尚未加载');
  if(name==='versionDayGroups')return [];
  if(name==='versionSelectedDiff'||name==='versionCurrentProjection')return null;
  if(name==='versionTimelineClass')return {selected:false};
  return '';
 }]))]));
}`
}

function deferredPagedViewRuntime() {
  return `import {readFeature} from ${JSON.stringify(resolve(ROOT, 'src/core/features/registry.js'))};
export function createPagedDocumentViewRuntime(dependencies){
 let implementation;
 function ready(){
  if(implementation)return implementation;
  const factory=readFeature('document.pagedView.ready');
  if(typeof factory!=='function')throw new Error('分页视图尚未加载');
  return implementation=factory(dependencies);
 }
 return {
  scrollDocumentSelection(editor){return ready().scrollDocumentSelection.apply(this,arguments);},
  preparePagedDocumentView(editor){return ready().preparePagedDocumentView.apply(this,arguments);}
 };
}`
}

function deferredPagedImportRuntime() {
  return `import {readFeature} from ${JSON.stringify(resolve(ROOT, 'src/core/features/registry.js'))};
export function createPagedDocumentImportRuntime(dependencies){
 let implementation;
 function ready(){
  if(implementation)return implementation;
  const factory=readFeature('document.pagedImport.ready');
  if(typeof factory!=='function')throw new Error('分页导入尚未加载');
  return implementation=factory(dependencies);
 }
 return {
  yieldDocumentTask(){return ready().yieldDocumentTask.apply(this,arguments);},
  createPagedDocumentSource(content){return ready().createPagedDocumentSource.apply(this,arguments);},
  startPagedImport(controller,content,options,context){return ready().startPagedImport.apply(this,arguments);},
  importPagedContent(controller,job,content){return ready().importPagedContent.apply(this,arguments);},
  importWorkspaceFile(controller,file,importingEditor){return ready().importWorkspaceFile.apply(this,arguments);}
 };
}`
}

function deferredPanelPresentation(shape) {
  return `import {readFeature} from ${JSON.stringify(resolve(ROOT, 'src/core/features/registry.js'))};
export function createPanelPresentation(dependencies){
 let implementation;
 const result={};
 for(const [namespace,keys] of Object.entries(${JSON.stringify(shape)})) result[namespace]=Object.fromEntries(keys.map(name=>[name,function(...args){
  const owner=this.ed||this;void owner.panelPresentationRevision;
  const factory=readFeature('ui.ready')?.createPanelPresentation;
  if(factory){implementation ||= factory(dependencies);return implementation[namespace][name].apply(this,args);}
  if(namespace==='methods'){
   const fallback={buildCommentState:'buildCommentVisibility',buildVersionState:'buildVersionVisibility',buildSaveVersionState:'buildSaveVersionVisibility'}[name];
   return fallback?this[fallback](...args):null;
  }
 } ]));
 return result;
}`
}

function deferredTablePresentation() {
  return `import {readFeature} from ${JSON.stringify(resolve(ROOT, 'src/core/features/registry.js'))};
export function createTablePresentation(dependencies){
 let implementation;
 return {methods:Object.fromEntries(['tableSelectionAlignment','buildTableToolsPresentation','tableToolbarCommand','dispatchToolbarAction'].map(name=>[name,function(...args){
  const factory=readFeature('ui.ready')?.createTablePresentation;
  if(factory){implementation ||= factory(dependencies);return implementation.methods[name].apply(this,args);}
  if(name==='buildTableToolsPresentation'){const {selection,...visibility}=args[0];return visibility;}
  return false;
 }]))};
}`
}

function deferredCommentInteraction(shape) {
  return `import {readFeature} from ${JSON.stringify(resolve(ROOT, 'src/core/features/registry.js'))};
export function createCommentInteraction(dependencies){
 let implementation;
 return {methods:Object.fromEntries(${JSON.stringify(shape.methods)}.map(name=>[name,function(...args){
  if(implementation)return implementation.methods[name].apply(this,args);
  const factory=readFeature('ui.ready')?.createCommentInteraction;
  if(factory){implementation ||= factory(dependencies);return implementation.methods[name].apply(this,args);}
  return false;
 }]))};
}`
}

function deferredCalloutPresentation() {
  return `import {readFeature} from ${JSON.stringify(resolve(ROOT, 'src/core/features/registry.js'))};
export function createCalloutPresentation(){
 let implementation;
 return {computed:Object.fromEntries(['calloutEmojiCategories','filteredCalloutEmojiItems'].map(name=>[name,function(...args){
  void this.calloutPresentationRevision;
  const factory=readFeature('ui.ready')?.createCalloutPresentation;
  if(factory){implementation ||= factory();return implementation.computed[name].apply(this,args);}
  return [];
 }]))};
}`
}

export const PM_NAMES = ['state', 'model', 'view', 'transform', 'commands', 'keymap', 'inputrules', 'schema-list', 'history', 'gapcursor', 'dropcursor', 'tables', 'changeset']
const PM_ENTRY = '\0lark-doc-pm:'
const MERMAID_ENTRY = '\0lark-doc-mermaid'
const REACTION_CATALOG = resolve(ROOT, 'src/core/comments/reaction-catalog.json')
const REACTION_CATALOG_ENTRY = '\0lark-doc-reaction-catalog-assets'
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

/**
 * 从源码里读出导出名：shim 只转发这些名字，不复制实现。
 * 认不出来就报错，宁可构建失败，也不要在运行时少一个导出变成 undefined。
 */
export function declaredExports(source, name) {
  const names = []
  const collect = pattern => {
    if (pattern.type === 'Identifier') return names.push(pattern.name)
    if (pattern.type === 'ObjectPattern') return pattern.properties.forEach(property => collect(property.value || property.argument))
    if (pattern.type === 'ArrayPattern') return pattern.elements.forEach(element => element && collect(element))
    if (pattern.type === 'AssignmentPattern') return collect(pattern.left)
    if (pattern.type === 'RestElement') return collect(pattern.argument)
    throw new Error(`共享模块 ${name}：无法识别的导出模式 ${pattern.type}`)
  }
  for (const node of parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body) {
    if (node.type === 'ExportAllDeclaration') throw new Error(`共享模块 ${name}：不支持 export *，请改成具名导出`)
    if (node.type === 'ExportDefaultDeclaration') { names.push('default'); continue }
    if (node.type !== 'ExportNamedDeclaration') continue
    if (node.declaration) {
      const declaration = node.declaration
      if (declaration.type === 'VariableDeclaration') declaration.declarations.forEach(item => collect(item.id))
      else names.push(declaration.id.name)
    } else for (const specifier of node.specifiers) names.push(specifier.exported.name || specifier.exported.value)
  }
  return names
}

/** 生成转发 shim：包内只剩导出名清单，实现体由内核发布的那一份提供。 */
function sharedHostShim(name, names = declaredExports(readFileSync(sharedHostNames.get(name), 'utf8'), name)) {
  const lines = [
    'const __sharedTable = (typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : self).__LARK_DOC_SHARED__',
    `const __sharedModule = __sharedTable && __sharedTable[${JSON.stringify(name)}]`,
    `if (!__sharedModule) throw new Error("[lark-doc] 内核与特性包版本不匹配：缺少共享模块 ${name}。请让特性包与 lark-doc-element.runtime.umd.min.js 同版本同目录部署。")`,
  ]
  names.forEach((exportName, index) => {
    if (exportName === 'default') lines.push('export default __sharedModule.default')
    else if (/^[A-Za-z_$][\w$]*$/.test(exportName)) lines.push(`export const ${exportName} = __sharedModule.${exportName}`)
    else lines.push(`const __sharedExport${index} = __sharedModule[${JSON.stringify(exportName)}]\nexport { __sharedExport${index} as ${JSON.stringify(exportName)} }`)
  })
  return lines.join('\n')
}

/**
 * 「点下去才走」的懒边界 → 同名特性脚本。
 *
 * 这些 `import()` 在源码里本来就是按需的：点导出、开幻灯片、粘贴图片、发起转换、
 * 后台算统计才走。内核实为单文件 UMD，`inlineDynamicImports` 会把被 import 的实现
 * 压回首屏；换成正表里的加载器后，实现搬进同目录特性包（export / uiExtra /
 * background），首屏不再背它们。
 *
 * 换的只是**调用点本来就在 await 的那句 import()**，返回值仍是模块命名空间，
 * 调用方（命名空间解构、.then(module => ...)、createLazyView 的工厂入参）一行都不用改，
 * 因此不产生任何「UI 未到时显示什么」的新语义。
 */
export const LAZY_PACKAGE_CALLERS = new Map([
  [resolve(ROOT, 'src/components/lark-doc/ai/index.js'), [
    ['src/components/lark-doc/ai/http.js', 'ui.aiHttp'],
  ]],
  [resolve(ROOT, 'src/components/lark-doc/editor/exportMixin.js'), [
    ['src/utils/export/index.js', 'export.api'],
    ['src/utils/remoteConversion.js', 'export.remoteConversion'],
  ]],
  // Word 导出从 `WorkspaceController.js` 搬进了「文件导入导出域」，
  // 名单按**导入方文件路径**匹配，跟着换。
  [resolve(ROOT, 'src/workspace/workspaceTransferMethods.js'), [
    ['src/utils/export/index.js', 'export.api'],
  ]],
  // 会话里的三处懒加载分别落在「版本与转换域」和「资源绑定域」；名单按导入方
  // 文件路径匹配，拆文件时跟着换。
  [resolve(ROOT, 'src/session/sessionVersionMethods.js'), [
    ['src/utils/remoteConversion.js', 'export.remoteConversion'],
    ['src/core/versioning/snapshot.js', 'versioning.snapshot'],
  ]],
  [resolve(ROOT, 'src/session/sessionResourceMethods.js'), [
    ['src/session/resourceOutcome.js', 'session.resourceOutcome'],
  ]],
  [resolve(ROOT, 'src/components/lark-doc/editor/headingNumberMenuUiMixin.js'), [
    ['src/ui/headingNumberMenu.js', 'ui.headingNumberMenu'],
  ]],
  [resolve(ROOT, 'src/components/lark-doc/editor/topbarMoreMixin.js'), [
    ['src/ui/documentInformation.js', 'ui.documentInformation'],
  ]],
  [resolve(ROOT, 'src/components/lark-doc/editor/bubbleMenuMixin.js'), [
    ['src/ui/dialogs.js', 'ui.panels'],
  ]],
  [resolve(ROOT, 'src/components/lark-doc/editor/versioningMixin.js'), [
    ['src/ui/dialogs.js', 'ui.panels'],
    ['src/features/ui.js', 'ui.panels'],
  ]],
  [resolve(ROOT, 'src/components/lark-doc/editor/isvMixin.js'), [
    ['src/ui/dialogs.js', 'ui.panels'],
  ]],
  [resolve(ROOT, 'src/core/media/upload.js'), [
    ['src/core/media/http-upload.js', 'media.httpUpload'],
  ]],
  [resolve(ROOT, 'src/editor/nativeEditorHost.js'), [
    ['src/core/media/file-upload-tasks.js', 'media.fileUploadTasks'],
  ]],
  [resolve(ROOT, 'src/workspace/workspaceAIContextMethods.js'), [
    ['src/core/media/image-output.js', 'media.imageOutput'],
  ]],
  [resolve(ROOT, 'src/core/media/image-crop.js'), [
    ['src/core/media/image-output.js', 'media.imageOutput'],
  ]],
  [resolve(ROOT, 'src/core/nodeviews/image-viewer.js'), [
    ['src/core/media/image-output.js', 'media.imageOutput'],
  ]],
  [resolve(ROOT, 'src/core/nodeviews/file-block.js'), [
    ['src/core/nodeviews/video-popups.js', 'media.videoPopups'],
    ['src/core/nodeviews/file-download.js', 'media.fileDownload'],
  ]],
  [resolve(ROOT, 'src/core/nodeviews/poll.js'), [
    ['src/core/nodeviews/poll-tools.js', 'ui.pollTools'],
  ]],
  [resolve(ROOT, 'src/editor/EditorController.js'), [
    ['src/editor/documentSnapshot.js', 'document.snapshot'],
  ]],
  [resolve(ROOT, 'src/editor/nativeDocumentState.js'), [
    ['src/editor/documentSnapshot.js', 'document.snapshot'],
  ]],
  [resolve(ROOT, 'src/components/lark-doc/editor/stageUiMixin.js'), [
    ['src/ui/stage.js', 'ui.stage'],
  ]],
  [resolve(ROOT, 'src/components/lark-doc/editor/blockMenuMixin.js'), [
    ['src/editor/templateSave.js', 'ui.templateSave'],
  ]],
  [resolve(ROOT, 'src/mount/domRenderer.js'), [
    ['src/ui/dialogs.js', 'ui.importConfirmation'],
  ]],
])

function packageAlias(target = '') {
  const element = target === 'element' || target === 'elementRuntime'
  // export 特性包只服务 Element：它装的是内核首屏那两块懒代码。包内不再打包 markdown
  // 序列化与 docx —— Element 里这两条边本来就走 markdown / office 特性包，内核留的那份
  // import 只是给非 Element 宿主的兜底；照抄进包会白白多下一次 docx（gzip ~90 KiB）。
  const exportFeature = target === 'feature:export' || target === 'feature:export:umd'
  const deferredUi = element || ['esm', 'cjs', 'lite', 'elementEsm', 'legacy', 'legacyEsm', 'full', 'fullCjs'].includes(target)
  const aliases = new Map([
    ['lark-doc/katex.css', resolve(ROOT, 'src/styles/vendor/katex.css')],
    ['lark-doc/mermaid-vendor', resolve(ROOT, exportFeature || target === 'feature:office:umd'
      ? 'src/core/features/stub.js' : 'src/assets/vendor/mermaid/mermaid.min.js')],
    ...(target === 'lite' || element ? [
      ['katex', resolve(ROOT, 'src/core/features/stub.js')],
      ['docx', resolve(ROOT, 'src/core/features/stub.js')],
      ['marked', resolve(ROOT, 'src/core/features/stub.js')],
      ['turndown', resolve(ROOT, 'src/core/features/stub.js')],
      // Markdown parsing is a lazy feature in the element build. Keep the
      // synchronous export codec's API shape, but avoid bundling marked into
      // the first screen; the feature entry supplies the real parser on demand.
      ['marked', resolve(ROOT, 'src/core/features/stub.js')],
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
      if (SHARED_HOST_TARGETS.has(target) && importer === resolve(ROOT, 'src/features/ui-registry.js') && source === '../core/features/registry') return SHARED_HOST_ENTRY + 'core.featureRegistration'
      if (target === 'feature:background:umd') {
        if (backgroundRuntimeImporters.has(importer) && Object.prototype.hasOwnProperty.call(lazyRuntimeExports, source)) return SHARED_HOST_ENTRY + source
      }
      if (target === 'feature:uiOverlays:umd') {
        if (importer === resolve(ROOT, 'src/editor/templateSave.js') && source === '@tiptap/pm/model') return SHARED_HOST_ENTRY + source
        if (importer === resolve(ROOT, 'src/ui/stage.js') && source === '../core/nodeviews/image-viewer') return SHARED_HOST_ENTRY + 'ui.imageViewer'
      }
      // 与内核同版本部署的两支 UI 包：重复模块只留转发 shim，实现体读内核那一份。
      if (SHARED_HOST_TARGETS.has(target) && importer && source.startsWith('.') && !importer.startsWith('\0')) {
        const file = resolve(dirname(importer), source)
        const shared = sharedHostPaths.get(file) || sharedHostPaths.get(`${file}.js`)
        if (shared) return SHARED_HOST_ENTRY + shared
      }
      if (element && importer === PAGED_VIEW_SOURCE && source.startsWith('.')) {
        const file = resolve(dirname(importer), source)
        if (file === PAGED_VIEW_RUNTIME_SOURCE || `${file}.js` === PAGED_VIEW_RUNTIME_SOURCE) return PAGED_VIEW_ENTRY
      }
      if (element && importer === PAGED_IMPORT_SOURCE && source.startsWith('.')) {
        const file = resolve(dirname(importer), source)
        if (file === PAGED_IMPORT_RUNTIME_SOURCE || `${file}.js` === PAGED_IMPORT_RUNTIME_SOURCE) return PAGED_IMPORT_ENTRY
      }
      if (element && importer === resolve(ROOT, 'src/components/lark-doc/editor/blockMenuMixin.js') && source === '../../../features/ui') return UI_FALLBACK_ENTRY
      if (deferredUi && importer === resolve(ROOT, 'src/ui/workspace.js') && source === './workspacePanels') return ELEMENT_UI_ENTRY + 'workspacePanels'
      if (deferredUi && importer === resolve(ROOT, 'src/ui/topBar.js') && source === './topBarMenus') return ELEMENT_UI_ENTRY + 'topBarMenus'
      if (deferredUi && importer === resolve(ROOT, 'src/ui/topBar.js') && source === './desktopHeaderDetails') return ELEMENT_UI_ENTRY + 'desktopHeaderDetails'
      if (deferredUi && importer === resolve(ROOT, 'src/ui/topBar.js') && source === './scrollNavigator') return ELEMENT_UI_ENTRY + 'scrollNavigator'
      if (deferredUi && importer === resolve(ROOT, 'src/ui/blockHandle.js') && source === './blockHandleMenus') return ELEMENT_UI_ENTRY + 'blockHandleMenus'
      if (deferredUi && importer?.startsWith(resolve(ROOT, 'src/components/lark-doc/editor') + '/') && source.startsWith('.')) {
        const file = resolve(dirname(importer), source)
        if (file === PANEL_PRESENTATION_SOURCE || `${file}.js` === PANEL_PRESENTATION_SOURCE) return PANEL_PRESENTATION_ENTRY
        if (file === TABLE_PRESENTATION_SOURCE || `${file}.js` === TABLE_PRESENTATION_SOURCE) return TABLE_PRESENTATION_ENTRY
        if (file === COMMENT_INTERACTION_SOURCE || `${file}.js` === COMMENT_INTERACTION_SOURCE) return COMMENT_INTERACTION_ENTRY
        if (file === CALLOUT_PRESENTATION_SOURCE || `${file}.js` === CALLOUT_PRESENTATION_SOURCE) return CALLOUT_PRESENTATION_ENTRY
        if (file === VERSIONING_PRESENTATION_SOURCE || `${file}.js` === VERSIONING_PRESENTATION_SOURCE) return VERSIONING_PRESENTATION_ENTRY
        if (file === SHARE_INTERACTION_SOURCE || `${file}.js` === SHARE_INTERACTION_SOURCE) return SHARE_INTERACTION_ENTRY
        if (file === EXPORT_INTERACTION_SOURCE || `${file}.js` === EXPORT_INTERACTION_SOURCE) return EXPORT_INTERACTION_ENTRY
        if (file === BLOCK_INTERACTION_SOURCE || `${file}.js` === BLOCK_INTERACTION_SOURCE) return BLOCK_INTERACTION_ENTRY
      }
      if ((target === 'lite' || element) && importer === resolve(ROOT, 'src/core/nodeviews/code-languages.js') && source === '../../features/highlight') {
        return resolve(ROOT, 'src/core/features/stub.js')
      }
      if (deferredUi && importer?.startsWith(resolve(ROOT, 'src/components/lark-doc/editor') + '/') && source.startsWith('../../../ui/')) {
        const name = source.slice('../../../ui/'.length).replace(/\.js$/, '')
        // These async callers await the original dialog factory before opening.
        if (name === 'dialogs' && ['bubbleMenuMixin.js', 'versioningMixin.js', 'isvMixin.js'].some(file =>
          importer === resolve(ROOT, 'src/components/lark-doc/editor', file))) return null
        if (elementUiModules[name]) return ELEMENT_UI_ENTRY + name
      }
      // 独立 Element 已注册同目录特性脚本；只替换出口层的重复实现，不影响特性包自身。
      if ((element || exportFeature) && importer === resolve(ROOT, 'src/utils/export/index.js') &&
        (source === './markdown.js' || source === './docx.js')) return resolve(ROOT, 'src/core/features/stub.js')
      if (aliases.has(source)) return aliases.get(source)
      if (source.startsWith('lark-doc/')) {
        const relative = source.slice('lark-doc/'.length)
        const candidate = resolve(ROOT, 'src', relative)
        if (existsSync(candidate) || existsSync(`${candidate}.js`)) return candidate
      }
      return null
    },
    transform(code, id) {
      // These callers already await a module. Classic Element may load its
      // pure model through the existing script registry without changing any
      // synchronous model export or introducing another PM instance.
      if (!element) return null
      const modelCaller = id === resolve(ROOT, 'src/mount/domRenderer.js')
      const pagedCaller = [resolve(ROOT, 'src/editor/pagedDocumentSource.js'), resolve(ROOT, 'src/components/lark-doc/editor/viewModesMixin.js')].includes(id)
      const importCaller = [resolve(ROOT, 'src/editor/EditorController.js'), resolve(ROOT, 'src/workspace/workspaceTransferMethods.js')].includes(id)
      // 分享链接的两条异步入口按**导入方文件**白名单改写；`shareLinkAction` 现住在
      // `editor/shareLinkMethods.js`（`shareMixin.js` 拆出的方法域），名单里跟着换。
      const shareCaller = [
        resolve(ROOT, 'src/providers/authorization.js'),
        resolve(ROOT, 'src/components/lark-doc/editor/shareMixin.js'),
        resolve(ROOT, 'src/components/lark-doc/editor/shareLinkMethods.js'),
        resolve(ROOT, 'src/providers/document-business.js'),
      ].includes(id)
      // 导出、浮层、上传、转换与后台统计：见 LAZY_PACKAGE_CALLERS 的注释。
      const lazyPackages = LAZY_PACKAGE_CALLERS.get(id)
      if (!modelCaller && !pagedCaller && !importCaller && !shareCaller && !lazyPackages) return null
      const requests = []
      const visit = node => {
        if (!node || typeof node !== 'object') return
        if (node.type === 'ImportExpression' && node.source.type === 'Literal') {
          if (modelCaller && node.source.value === '../editor/segmentedDocumentModel') requests.push({ node, feature: 'document.segmented', namespace: false })
          if ((pagedCaller || importCaller) && typeof node.source.value === 'string') {
            const file = resolve(dirname(id), node.source.value)
            if (pagedCaller && (file === PAGED_VIEW_SOURCE || `${file}.js` === PAGED_VIEW_SOURCE)) requests.push({ node, feature: 'document.pagedView', namespace: true })
            if (importCaller && (file === PAGED_IMPORT_SOURCE || `${file}.js` === PAGED_IMPORT_SOURCE)) requests.push({ node, feature: 'document.pagedImport', namespace: true })
          }
          if (shareCaller && typeof node.source.value === 'string') {
            const file = resolve(dirname(id), node.source.value)
            for (const [source, feature] of [['src/providers/share-links.js', 'document.shareLinks'], ['src/providers/share-link-access.js', 'document.shareLinkAccess']]) {
              if (file === resolve(ROOT, source) || `${file}.js` === resolve(ROOT, source)) requests.push({ node, feature, namespace: false })
            }
          }
          if (lazyPackages && typeof node.source.value === 'string') {
            const file = resolve(dirname(id), node.source.value)
            for (const [source, feature] of lazyPackages) {
              if (file === resolve(ROOT, source) || `${file}.js` === resolve(ROOT, source)) requests.push({ node, feature, namespace: false })
            }
          }
        }
        for (const value of Object.values(node)) {
          if (Array.isArray(value)) value.forEach(visit)
          else if (value && typeof value === 'object') visit(value)
        }
      }
      visit(parse(code, { ecmaVersion: 'latest', sourceType: 'module' }))
      if (!requests.length) return null
      for (const { node, feature, namespace } of requests.sort((a, b) => b.node.start - a.node.start)) {
        const loaded = `__larkDocLoadDocumentFeature('${feature}')`
        const replacement = namespace ? `${loaded}.then(()=>${code.slice(node.start, node.end)})` : loaded
        code = code.slice(0, node.start) + replacement + code.slice(node.end)
      }
      return { code: `import {loadFeature as __larkDocLoadDocumentFeature} from ${JSON.stringify(resolve(ROOT, 'src/core/features/registry.js'))};\n${code}`, map: null }
    },
    load(id) {
      if (id.startsWith(SHARED_HOST_ENTRY)) {
        const name = id.slice(SHARED_HOST_ENTRY.length)
        if (Object.prototype.hasOwnProperty.call(lazyRuntimeExports, name)) return sharedHostShim(name, lazyRuntimeExports[name])
        this.addWatchFile?.(sharedHostNames.get(name))
        return sharedHostShim(name)
      }
      if (id === PAGED_IMPORT_ENTRY) {
        this.addWatchFile?.(PAGED_IMPORT_RUNTIME_SOURCE)
        return deferredPagedImportRuntime()
      }
      if (id === UI_FALLBACK_ENTRY) return 'export const uiApi = null;'
      if (id === PAGED_VIEW_ENTRY) {
        this.addWatchFile?.(PAGED_VIEW_RUNTIME_SOURCE)
        return deferredPagedViewRuntime()
      }
      if (id === PANEL_PRESENTATION_ENTRY) {
        this.addWatchFile?.(PANEL_PRESENTATION_SOURCE)
        return deferredPanelPresentation(panelPresentationShape())
      }
      if (id === TABLE_PRESENTATION_ENTRY) {
        this.addWatchFile?.(TABLE_PRESENTATION_SOURCE)
        return deferredTablePresentation()
      }
      if (id === COMMENT_INTERACTION_ENTRY) {
        this.addWatchFile?.(COMMENT_INTERACTION_SOURCE)
        return deferredCommentInteraction(commentInteractionShape())
      }
      if (id === CALLOUT_PRESENTATION_ENTRY) {
        this.addWatchFile?.(CALLOUT_PRESENTATION_SOURCE)
        return deferredCalloutPresentation()
      }
      if (id === VERSIONING_PRESENTATION_ENTRY) {
        this.addWatchFile?.(VERSIONING_PRESENTATION_SOURCE)
        return deferredVersioningPresentation(versioningPresentationShape(), element)
      }
      if (id === SHARE_INTERACTION_ENTRY) {
        this.addWatchFile?.(SHARE_INTERACTION_SOURCE)
        return deferredShareInteraction()
      }
      if (id === EXPORT_INTERACTION_ENTRY) {
        this.addWatchFile?.(EXPORT_INTERACTION_SOURCE)
        return deferredExportInteraction()
      }
      if (id === BLOCK_INTERACTION_ENTRY) {
        this.addWatchFile?.(BLOCK_INTERACTION_SOURCE)
        return deferredBlockInteraction()
      }
      if (!id.startsWith(ELEMENT_UI_ENTRY)) return null
      const name = id.slice(ELEMENT_UI_ENTRY.length)
      const visible = name === 'extendedOverlays' ? ',s=>s.linkHoverOpen||s.confirmOpen||s.relationOpen||s.codeLangOpen'
        : name === 'revision' ? ',s=>s.items&&s.items.length>0'
          : name === 'overlays' ? ',s=>s.sharePopoverOpen||s.permissionDialogOpen||s.secureLinkConfirmOpen||s.passwordDialogOpen||s.exportOpen||s.exportToast||s.exportPendingOperationId||s.imageShare'
            : name === 'cellPlusTools' || name === 'calloutTools' ? ',s=>s.visible'
              : name === 'workspacePanels' ? ',s=>(s.templateOpen&&s.templatesEnabled)||(s.historyOpen&&s.historyEnabled)||(s.aiOpen&&s.aiEnabled)||s.importOpener||s.notice'
                : name === 'topBarMenus' ? ',s=>s.headerVisible!==false&&((s.createMenuOpen&&!s.readonly)||(s.topbarMoreOpen&&!s.moreDismissed))'
                  : name === 'scrollNavigator' ? ',s=>s.enabled&&s.content?.isConnected&&window.matchMedia?.("(max-width: 760px) and (pointer: coarse)").matches'
                    : name === 'blockHandleMenus' ? ',s=>s.open'
          : ''
      return `import {createDeferredUi} from ${JSON.stringify(resolve(ROOT, 'src/features/element-ui.js'))};` +
        (name === 'panels' ? `export {createOutlinePanel} from ${JSON.stringify(resolve(ROOT, 'src/ui/outlinePanel.js'))};` : '') +
        elementUiModules[name].map(factory => {
          const predicate = factory === 'createCommentPanel' ? ',s=>s.open||s.documentInline||s.launcher?.visible'
            : factory === 'createVersionToast' ? ',s=>s.open||s.notice' : visible
          const elementPack = uiOverlayPackGroups.has(name) ? 'ui.overlays' : uiPanelPackGroups.has(name) ? 'ui.panels' : 'ui'
          const pack = element ? elementPack : 'ui'
          const fallback = element ? 'undefined' : `()=>import(${JSON.stringify(resolve(ROOT, 'src/features/ui.js'))}).then(module=>module.uiApi)`
          const signature = name === 'bubbleBar' ? '(host,options)' : 'options'
          const options = name === 'bubbleBar' ? '{...options,host}' : 'options'
          const args = [JSON.stringify(factory), options, predicate.slice(1) || 'undefined', fallback, JSON.stringify(pack)]
          return `export const ${factory}=${signature}=>createDeferredUi(${args.join(',')});`
        }).join('')
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

const deferredElementStyles = new Set(['src/styles/versioning.css', 'src/styles/deferred-ui.css',
  'src/styles/panel-tools.css', 'src/components/lark-doc/template-library.css'].map(file => resolve(ROOT, file)))

export function inlineCssImports({ deferredVersioning = false } = {}) {
  return {
    postcssPlugin: 'lark-doc-inline-css-imports',
    Once(root, { result }) {
      const sourceFile = result.opts.from
      const baseDir = sourceFile ? dirname(sourceFile) : ROOT
      const inline = (css, directory, seen = new Set()) => css.replace(/@import\s+["']([^"']+)["']\s*;?/g, (statement, request) => {
        if (!request.startsWith('.') || !request.endsWith('.css')) return statement
        const file = resolve(directory, request)
        if (deferredVersioning && deferredElementStyles.has(file)) return ''
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

/** UMD inlines dynamic imports, so the reaction catalogue ships as a same-directory asset. */
export function reactionCatalogAssets() {
  return {
    name: 'lark-doc-reaction-catalog-assets',
    resolveId(id, importer) {
      const file = isAbsolute(id) ? id : importer && id.startsWith('.') ? resolve(dirname(importer), id) : null
      return file === REACTION_CATALOG ? REACTION_CATALOG_ENTRY : null
    },
    load(id) { return id === REACTION_CATALOG_ENTRY ? 'export default null' : null },
    shouldTransformCachedModule({ id }) { return id === REACTION_CATALOG_ENTRY ? true : null },
    transform(_code, id) {
      if (id !== REACTION_CATALOG_ENTRY) return null
      this.addWatchFile(REACTION_CATALOG)
      this.emitFile({ type: 'asset', fileName: 'comment-reaction-catalog.json', source: readFileSync(REACTION_CATALOG, 'utf8') })
      return `const base = typeof document === 'undefined' ? '' : document.currentScript?.src || document.baseURI;
export default () => fetch(new URL('comment-reaction-catalog.json', base)).then(response => {
  if (!response.ok) throw new Error('表情加载失败，请重试');
  return response.json();
});`
    },
  }
}

export function cssInjection(target) {
  // elementRuntime / feature:ui 不再内联：样式字符串改成同目录独立 .css，
  // 由各自的加载器注入 <link>。样式因此可以边下载边解析，不必等 JS 求值；
  // 面板样式也只在面板真正要出现时才拉，首次打开前后没有第二份样式往返。
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
    ...(['element', 'elementRuntime'].includes(target) || target.endsWith(':umd') ? [reactionCatalogAssets()] : []),
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
      plugins: [inlineCssImports({ deferredVersioning: target === 'element' || target === 'elementRuntime' }), ...(target === 'feature:math' ? [{
        postcssPlugin: 'lark-doc-feature-font-paths',
        Declaration(declaration) { declaration.value = declaration.value.replace(/url\((["']?)\.\/fonts\//g, 'url($1../fonts/') },
      }] : [])],
      inject: cssInjection(target),
      extract: cssFile || false,
      minimize: ['element', 'elementRuntime', 'elementEsm', 'feature:math:umd', 'feature:ui:umd', 'feature:uiPanels:umd'].includes(target),
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
    input: resolve(ROOT, 'src/web-component/loader.js'),
    format: 'umd',
    file: 'lark-doc-element.umd.min.js',
    entryFileNames: 'lark-doc-element.umd.min.js',
    inlineDynamicImports: true,
    name: 'LarkDoc',
    css: null,
  },
  elementRuntime: {
    input: resolve(ROOT, 'src/web-component/standalone.js'),
    format: 'umd',
    file: 'lark-doc-element.runtime.umd.min.js',
    entryFileNames: 'lark-doc-element.runtime.umd.min.js',
    inlineDynamicImports: true,
    name: 'LarkDocRuntime',
    // 样式独立成文件：loader 用 <link> 并行拉，内核 JS 不再背 265 KB 字符串。
    css: 'lark-doc-element.css',
  },
  // 只有旧环境缺的 ES2022/2023 API。独立成文件后内核不再背 core-js 的 170+ 个
  // 内部模块，引导体按特性检测决定拉不拉（见 src/web-component/loader.js）。
  elementPolyfills: {
    input: resolve(ROOT, 'src/web-component/polyfills.js'),
    format: 'umd',
    file: 'lark-doc-element.polyfills.umd.min.js',
    entryFileNames: 'lark-doc-element.polyfills.umd.min.js',
    inlineDynamicImports: true,
    name: 'LarkDocPolyfills',
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
    inlineDynamicImports: false,
    css: null,
  },
  collabCjs: {
    input: resolve(ROOT, 'src/collab/index.js'),
    format: 'cjs',
    file: 'lark-doc-collab.common.js',
    entryFileNames: 'lark-doc-collab.common.js',
    inlineDynamicImports: false,
    css: null,
  },
  collabBrowser: {
    input: resolve(ROOT, 'src/collab/browser.js'),
    format: 'es',
    file: 'lark-doc-collab.browser.esm.js',
    entryFileNames: 'lark-doc-collab.browser.esm.js',
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
  const entry = format === 'umd' ? FEATURE_UMD_ENTRY[name] || name : name
  return {
    input: resolve(ROOT, `src/features/${entry}.js`),
    format,
    ...(format === 'umd' ? { file: `lark-doc-element.umd.min.${name}.js` } : { dir: DIST }),
    entryFileNames: format === 'umd' ? `lark-doc-element.umd.min.${name}.js` : `features/${name}.js`,
    inlineDynamicImports: true,
    name: format === 'umd' ? `LarkDocFeature${name[0].toUpperCase()}${name.slice(1)}` : undefined,
    css: format === 'umd'
      ? (elementPackStyles[name] || null)
      : (name === 'math' ? 'features/math.css' : null),
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
    ...(normalizedTarget === 'collab' ? { hoistTransitiveImports: false } : {}),
    entryFileNames: selected.entryFileNames,
    chunkFileNames: selected.chunkFileNames || 'lark-doc-[name]-[hash].js',
    inlineDynamicImports: selected.inlineDynamicImports,
    // Keep optional feature imports as native dynamic imports in CommonJS
    // consumers. Webpack 4 can then create a real lazy chunk for the Vue2
    // host instead of rewriting the import to a static require and pulling
    // all highlight grammars into the first screen.
    ...(selected.format === 'cjs' && !selected.inlineDynamicImports ? { dynamicImportInCjs: false } : {}),
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
export const FEATURE_TARGETS = [...featureNames.flatMap(name => [`feature:${name}`, `feature:${name}:umd`]), ...elementOnlyPackNames.map(name => `feature:${name}:umd`)]
const defaultTarget = process.env.ROLLUP_TARGET?.split(',')[0].trim() || undefined
export default getRollupConfig(['features', 'all', 'core'].includes(defaultTarget) ? 'esm' : defaultTarget)
