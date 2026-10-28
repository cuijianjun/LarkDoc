'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '../src/components/lark-doc')
// 阶段 2：图片 / 代码块 NodeView 都已下沉为 core 的纯 DOM 实现
// （src/core/nodeviews/{image,code-block}.js），三端共用；Vue2 端只留注册表缝。
const sourceRoot = path.resolve(__dirname, '../src')
const originalLoader = require.extensions['.js']
require.extensions['.js'] = (module, filename) => {
  if (filename.startsWith(sourceRoot + path.sep)) {
    const { code } = require('@babel/core').transformSync(fs.readFileSync(filename, 'utf8'), {
      babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-modules-commonjs'],
    })
    module._compile(code, filename)
  } else originalLoader(module, filename)
}
assert(fs.existsSync(path.join(root, 'extensions.js')), 'Missing LarkDoc schema: H9 and serializable blocks are not implemented')
const { createLarkDocExtensions, applyLineStartMarker } = require(path.join(root, 'extensions.js'))
const { safeUrl, validateDocument, getSlashMatch, findTextMatches, replaceText, moveBlockRange, collectOutline, resolveHeadingSection, foldedRange, headingActionRange, isPageHeading, isFoldableBlock, foldableIdPositions, TEXT_FOLD_TYPES, formatHeadingNumber, computeHeadingNumbers, headingNumberAt, clampHeadingNumberStart, formatOrderedIndex, computeOrderedListNumbers, computeBulletItems, alphaListLabel, romanListLabel, mapHeadingFoldKeys, resolveBlockTargetRange } = require(path.join(root, 'documentOperations.js'))
const { createLarkDocConfig, isCommandEnabled, isBlockActionEnabled } = require(path.join(root, 'larkDocConfig.js'))
const { filterCommands } = require(path.join(root, 'commands.js'))
const { getSchema, getExtensionField } = require('@tiptap/core')
const { EditorState, TextSelection } = require('@tiptap/pm/state')
const { history, undo } = require('@tiptap/pm/history')
const schema = getSchema(createLarkDocExtensions())
function loadComponent(name, base = root) {
  const { parseComponent } = require('vue-template-compiler')
  const filename = path.join(base, name)
  const Module = require('module')
  const module = new Module(filename)
  module.filename = filename
  module.paths = Module._nodeModulePaths(base)
  const sfc = parseComponent(fs.readFileSync(filename, 'utf8'))
  const { code } = require('@babel/core').transformSync(sfc.script.content, { babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-modules-commonjs'] })
  const originalVueLoader = require.extensions['.vue']
  const originalCssLoader = require.extensions['.css']
  // SFC 里的相对 import 已被 require 解成绝对路径，按它自己的目录回装载，
  // 这样跨目录（如 ../../adapters/vue2/*.vue）也能命中。
  require.extensions['.vue'] = (child, childPath) => { child.exports = loadComponent(path.basename(childPath), path.dirname(childPath)) }
  require.extensions['.css'] = () => {}
  try {
    module._compile(code, filename)
    const component = module.exports.default
    // 编辑器拆分了 mixin（./editor/*）：这里模拟 Vue 2 的选项合并语义，
    // 让 component.methods/computed 与运行时 this 上的可调用面保持一致。
    const methods = { ...(component.methods || {}) }
    const computed = { ...(component.computed || {}) }
    for (const mixin of component.mixins || []) {
      Object.assign(methods, mixin.methods || {})
      Object.assign(computed, mixin.computed || {})
    }
    return { ...component, methods, computed }
  }
  finally { require.extensions['.vue'] = originalVueLoader; require.extensions['.css'] = originalCssLoader }
}
const text = (value, marks) => ({ type: 'text', text: value, ...(marks ? { marks } : {}) })
const p = (value) => ({ type: 'paragraph', content: value ? [text(value)] : [] })
const pi = (value, indent) => ({ type: 'paragraph', attrs: { indent }, content: value ? [text(value)] : [] })
const hi = (level, value, indent = 0) => ({ type: 'heading', attrs: { level, indent }, content: [text(value)] })
// 带编号属性的标题（飞书里「标题 + 有序列表」的等价物）
const hd = (level, value, attrs = {}) => ({ type: 'heading', attrs: { level, ...attrs }, content: [text(value)] })
const doc = (content) => schema.nodeFromJSON({ type: 'doc', content })
function editorFor(document, selection) {
  const editor = { isEditable: true, state: EditorState.create({ schema, doc: document, selection }) }
  editor.view = { dispatch: (tr) => { editor.state = editor.state.apply(tr) } }
  return editor
}
function check(name, fn) { fn(); console.log(`PASS ${name}`) }
// 图片 NodeView 已是 core 的纯 DOM 实现（src/core/nodeviews/image.js），构造它需要
// 真实元素/事件语义。这里只借用 jsdom 的 DOM 表面，断言仍打在 EditorState 上。
function openDom() {
  const { JSDOM } = require('jsdom')
  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  const previous = { window: global.window, document: global.document }
  global.window = dom.window
  global.document = dom.window.document
  return () => { global.window = previous.window; global.document = previous.document; dom.window.close() }
}
function withDom(fn) {
  const close = openDom()
  try { return fn() } finally { close() }
}
/**
 * 按 tiptap 的装配签名构造图片 NodeView。props 里没有现成的 updateAttributes，
 * 且 dispatch 之后 ProseMirror 会回调 update(node)；少了这一步，后续方法会拿
 * 旧 attrs 覆盖上一次写入。
 */
function imageNodeViewFor(attrs, options = {}) {
  const { createImageNodeView } = require(path.join(sourceRoot, 'core/nodeviews/image.js'))
  const editor = editorFor(doc([{ type: 'image', attrs }]))
  editor.isEditable = options.editable !== false
  const listeners = { transaction: [], update: [] }
  editor.on = (name, fn) => { listeners[name].push(fn); return editor }
  editor.off = (name, fn) => { listeners[name] = listeners[name].filter((item) => item !== fn); return editor }
  const emit = (name) => listeners[name].slice().forEach((fn) => fn())
  let nodeView = null
  const view = {
    get state() { return editor.state },
    dispatch(tr) {
      editor.state = editor.state.apply(tr)
      if (nodeView) nodeView.update(editor.state.doc.firstChild)
      emit('transaction')
      emit('update')
    },
  }
  const extension = { options: options.resolveImageFile ? { resolveImageFile: options.resolveImageFile } : {} }
  nodeView = createImageNodeView({ editor, view, node: editor.state.doc.firstChild, getPos: () => 0, extension })
  return { editor, nodeView, view, emit }
}

check('Public LarkDoc config gates features, commands, block actions and limits', () => {
  const config = createLarkDocConfig({
    features: { columns: false, ai: false },
    commands: { disabled: ['template'], allow: null },
    blockMenu: { disabled: ['delete'] },
    limits: { maxLength: 200, maxSnapshots: 3 },
  })
  assert.strictEqual(config.features.columns, false)
  assert.strictEqual(filterCommands('', 'slash', config).some(item => item.id === 'columns'), false)
  assert.strictEqual(filterCommands('', 'slash', config).some(item => item.id === 'template'), false)
  assert.strictEqual(isCommandEnabled(config, 'ai', 'ai'), false)
  assert.strictEqual(isBlockActionEnabled(config, 'delete'), false)
  assert.strictEqual(config.limits.maxLength, 200)
  assert.strictEqual(config.limits.maxSnapshots, 3)
  assert.strictEqual(config.layout.titleBarFixed, false)
  assert.strictEqual(createLarkDocConfig({ layout: { titleBarFixed: true } }).layout.titleBarFixed, true)
  assert.strictEqual(createLarkDocConfig({ layout: { titleBarFixed: 'true' } }).layout.titleBarFixed, false)
  assert.strictEqual(config.layout.toolbarFixed, false)
  assert.strictEqual(createLarkDocConfig({ layout: { toolbarFixed: true } }).layout.toolbarFixed, true)
  assert.strictEqual(createLarkDocConfig({ layout: { toolbarFixed: 'true' } }).layout.toolbarFixed, false)
  // headerVisible 默认开启，显式 false 时顶栏隐藏、操作移入工具栏下拉
  assert.strictEqual(config.layout.headerVisible, true)
  assert.strictEqual(createLarkDocConfig({ layout: { headerVisible: false } }).layout.headerVisible, false)
  assert.strictEqual(createLarkDocConfig({ layout: { headerVisible: 'false' } }).layout.headerVisible, true)
})

check('Handle hover bounds use text content rather than the full block row', () => {
  const component = loadComponent('LarkDocEditor.vue')
  const bounds = component.methods.textContentBounds
  const startBounds = component.methods.highlightStartBounds
  const firstLineBounds = component.methods.firstTextLineBounds
  const previous = { Element: global.Element, NodeFilter: global.NodeFilter, document: global.document }
  class FakeElement {
    getBoundingClientRect() { return { left: 0, top: 0, right: 800, bottom: 40, width: 800, height: 40 } }
    matches() { return false }
  }
  const textNode = { textContent: '缩进标题' }
  global.Element = FakeElement
  global.NodeFilter = { SHOW_TEXT: 4 }
  global.document = {
    createTreeWalker: () => { let visited = false; return { nextNode: () => (visited ? null : (visited = true, textNode)) } },
    createRange: () => ({ setStart() {}, setEnd() {}, getClientRects: () => [{ left: 32, top: 5, right: 180, bottom: 29, width: 148, height: 24 }] }),
  }
  try {
    const boundsResult = bounds.call({}, new FakeElement())
    assert.deepStrictEqual(boundsResult, { left: 32, top: 5, right: 180, bottom: 29 })
    assert(boundsResult.right < 800, 'hover bounds must end at the final text glyph')
    assert.deepStrictEqual(startBounds.call({ textContentBounds: bounds }, new FakeElement()), boundsResult)
    assert.deepStrictEqual(firstLineBounds.call({}, new FakeElement()), boundsResult)
  } finally {
    if (previous.Element) global.Element = previous.Element
    else delete global.Element
    if (previous.NodeFilter) global.NodeFilter = previous.NodeFilter
    else delete global.NodeFilter
    if (previous.document) global.document = previous.document
    else delete global.document
  }
})

check('Handle hover sections follow the indented subtree, not heading levels', () => {
  const component = loadComponent('LarkDocEditor.vue')
  // 飞书模型：章节 = 缩进更深的连续块。H2 后面未缩进的 H3/H4 是兄弟块，
  // 不属于 H2；缩进更深的普通段落、引用、代码块都属于它的子树。
  const document = doc([
    hi(2, '我是2', 1),
    pi('子段落', 2),
    { type: 'blockquote', content: [p('缩进继承的子引用')] },
    { type: 'codeBlock', content: [text('nested-code')] },
    hi(4, '你好 我是3', 1),
    pi('兄弟正文', 1),
  ])
  const positions = []
  document.forEach((node, pos) => positions.push({ node, pos }))
  const editor = { state: { doc: document } }
  const section = component.methods.handleHighlightRange.call({ editor, handleRange: { from: positions[0].pos, to: positions[0].pos + positions[0].node.nodeSize } })
  assert.strictEqual(section.section, true)
  assert.strictEqual(section.to, positions[4].pos, 'a non-indented H4 stays outside the H2 section')
  // 无 indent 属性的块沿用前一块的层级，子树不会被打断。
  const nested = component.methods.rangeAt.call({ editor }, positions[3].pos)
  assert(nested, 'the nested code block still resolves to one block target')
  const flatDocument = doc([hi(2, '叶标题'), hi(3, '同级 H3'), pi('同级正文', 0)])
  const flatPositions = []
  flatDocument.forEach((node, pos) => flatPositions.push({ node, pos }))
  const flat = component.methods.handleHighlightRange.call({ editor: { state: { doc: flatDocument } }, handleRange: { from: flatPositions[0].pos, to: flatPositions[0].pos + flatPositions[0].node.nodeSize } })
  assert.strictEqual(flat.section, undefined, 'a heading with no indented descendants stays a leaf block')
  // 目录仍按标题级别排：H3/H4 依旧挂在大纲里。
  const outline = collectOutline(document)
  assert.deepStrictEqual(outline.map((item) => item.level), [2, 4], 'the outline keeps heading levels independent of indentation')
})

check('Changing the active handle target closes a stale block menu', () => {
  const component = loadComponent('LarkDocEditor.vue')
  const previousElement = global.Element
  class FakeElement {
    constructor(rect) { this.rect = rect; this.tagName = 'P' }
    getBoundingClientRect() { return this.rect }
    matches() { return false }
    closest() { return null }
    querySelector() { return null }
  }
  global.Element = FakeElement
  try {
    const rect = { left: 10, top: 20, right: 40, bottom: 40, width: 30, height: 20 }
    const paragraph = new FakeElement(rect)
    const paper = new FakeElement(rect)
    const context = {
      editor: { view: { nodeDOM: () => paragraph } },
      $refs: { root: { querySelector: selector => selector === '.lark-doc-paper' ? paper : null } },
      handleRange: { from: 0, to: 2 },
      blockMenuOpen: true,
      handleHovering: false,
      handlePressed: false,
      dragging: null,
      closeBlockMenuCalls: 0,
      clearBlockMenuCloseTimer() {},
      closeBlockMenu() { this.closeBlockMenuCalls += 1; this.blockMenuOpen = false },
      setHandleHighlight() {},
      blockShellElement: () => null,
      highlightStartBounds: () => rect,
      firstLineInkBounds: () => rect,
      firstTextLineBounds: () => rect,
      outerBlockBounds: () => rect,
    }
    component.methods.positionBlockHandle.call(context, { from: 2, to: 4 })
    assert.strictEqual(context.closeBlockMenuCalls, 1, 'changing the active block while its menu is open must close that menu')
    assert.strictEqual(context.blockMenuOpen, false, 'a stale block menu cannot remain over the next block handle')
    context.blockMenuOpen = true
    component.methods.positionBlockHandle.call(context, { from: 2, to: 4 })
    assert.strictEqual(context.blockMenuOpen, true, 'repositioning the same active block must preserve its menu')
  } finally {
    if (previousElement) global.Element = previousElement
    else delete global.Element
  }
})

check('Empty block plus opens the insert menu while six-dot handles open block actions', () => {
  const component = loadComponent('LarkDocEditor.vue')
  // P0-03 拆分后空段落加号与六点句柄的模板绑定迁入 BlockHandleMenu.vue，静态断言随之扩源；
  // 子组件模板事件绑定带 ed. 前缀，这里统一归一化后再做字符串断言。
  const source = ['LarkDocEditor.vue', 'editor/BlockHandleMenu.vue']
    .map((name) => fs.readFileSync(path.join(root, name), 'utf8')).join('\n')
    .replace(/@([\w.]+=")ed\./g, '@$1')
  let insertCalls = 0
  let blockMenuCloses = 0
  let repositionCalls = 0
  const firstPlus = { getBoundingClientRect: () => ({ left: 10, top: 20, bottom: 40 }) }
  const secondPlus = { getBoundingClientRect: () => ({ left: 50, top: 60, bottom: 80 }) }
  const emptyParagraphPlus = {
    writable: () => true,
    handleIsEmptyParagraph: true,
    handleRange: { from: 12, to: 14 },
    savedSelection: { from: 1, to: 1 },
    menuOpen: false,
    menuKind: '',
    menuTrigger: null,
    menuAnchor: null,
    $nextTick(callback) { callback() },
    positionCommandMenu() { repositionCalls += 1 },
    closeBlockMenu() { blockMenuCloses += 1 },
    openCommandMenu(kind, event) { insertCalls += 1; this.lastInsert = { kind, event }; this.savedSelection = { from: 1, to: 1 } },
  }
  const event = { type: 'mouseenter', currentTarget: firstPlus }
  component.methods.openEmptyBlockInsertMenu.call(emptyParagraphPlus, event)
  assert.strictEqual(insertCalls, 1)
  assert.deepStrictEqual(emptyParagraphPlus.lastInsert, { kind: 'plus', event }, 'the empty paragraph plus opens the insertion command menu')
  assert.deepStrictEqual(emptyParagraphPlus.savedSelection, { from: 13, to: 13 }, 'insert commands target the empty paragraph even when the editor selection was elsewhere')
  assert.strictEqual(blockMenuCloses, 1, 'opening the empty paragraph plus clears a stale six-dot block menu')
  emptyParagraphPlus.menuOpen = true
  emptyParagraphPlus.menuKind = 'plus'
  emptyParagraphPlus.handleRange = { from: 20, to: 22 }
  component.methods.openEmptyBlockInsertMenu.call(emptyParagraphPlus, { type: 'click', currentTarget: secondPlus })
  assert.strictEqual(insertCalls, 1, 'the click following hover must not close the insertion menu')
  assert.deepStrictEqual(emptyParagraphPlus.savedSelection, { from: 21, to: 21 }, 'a repeated plus event keeps the current empty paragraph as the insertion target')
  assert.strictEqual(emptyParagraphPlus.menuTrigger, secondPlus, 'moving to another empty paragraph retargets the existing insert menu')
  assert.deepStrictEqual(emptyParagraphPlus.menuAnchor, { left: 50, top: 60, bottom: 80 }, 'the insert menu anchor follows the active empty paragraph')
  assert.strictEqual(repositionCalls, 1, 'retargeting the insert menu recalculates its position')
  assert.strictEqual(blockMenuCloses, 2, 'reusing the insertion menu also clears any stale block menu')
  assert(source.includes('@mouseenter="openEmptyBlockInsertMenu"') && source.includes('@click="openEmptyBlockInsertMenu"'), 'the empty plus must route hover and click to the insertion menu')
  assert(source.includes('@mouseenter="openBlockMenuOnHover"') && source.includes('@focus="openBlockMenuOnHover"'), 'the six-dot handle opens its separate block menu on hover or keyboard focus')

  let hoverMenuCalls = 0
  const wrapperHandle = {
    clearBlockMenuCloseTimer() {},
    handleHovering: false,
    refreshHandleHighlight() {},
    openBlockMenuOnHover() { hoverMenuCalls += 1 },
  }
  component.methods.onBlockHandleEnter.call(wrapperHandle)
  assert.strictEqual(hoverMenuCalls, 0, 'the wrapper hover must never open block actions before the six-dot button is entered')
  component.methods.openBlockMenuOnHover.call({ writable: () => true, handleIsEmptyParagraph: true, handleIsTaskList: false, openBlockMenu() { hoverMenuCalls += 1 } })
  assert.strictEqual(hoverMenuCalls, 0, 'the six-dot hover handler rejects an empty paragraph even when called directly')
  let directBlockMenuCalls = 0
  component.methods.openBlockMenu.call({ writable: () => true, handleIsEmptyParagraph: true, handleIsTaskList: false, clearBlockMenuCloseTimer() { directBlockMenuCalls += 1 }, setHandleHighlight() { directBlockMenuCalls += 1 }, positionBlockMenu() { directBlockMenuCalls += 1 } })
  assert.strictEqual(directBlockMenuCalls, 0, 'the block menu itself rejects an empty paragraph even when called directly')

  let opened = 0
  const taskHandle = {
    writable: () => true,
    handleIsTaskList: true,
    handleHovering: false,
    openBlockMenu() { opened += 1 },
  }
  component.methods.openBlockMenuOnHover.call(taskHandle)
  assert.strictEqual(opened, 0, 'task list handles remain excluded from the block menu')
})

check('Pointer movement over the editor can switch away from an open block menu', () => {
  const component = loadComponent('LarkDocEditor.vue')
  const calls = []
  const context = {
    dragging: null,
    handlePressed: false,
    columnResize: null,
    blockMenuOpen: true,
    blockTypeMenuOpen: false,
    editor: { view: { posAtCoords: () => ({ pos: 7 }) } },
    updateTableBoundaryHover() {},
    rangeAt(pos) { return { from: pos, to: pos + 2 } },
    positionBlockHandle(range) { calls.push(range) },
    scheduleHandleHide() { throw new Error('pointer over the editor should not schedule handle hiding') },
  }
  component.methods.onEditorPointerMove.call(context, { clientX: 10, clientY: 20 })
  assert.deepStrictEqual(calls, [{ from: 7, to: 9 }], 'an open menu must yield to a newly hovered editor block')
})

check('ECS character limit uses the official filter, counts Unicode, and keeps over-limit initial text intact', () => {
  const extension = createLarkDocExtensions({ maxLength: 3 }).find((ext) => ext.name === 'characterCount')
  assert(extension, 'Missing CharacterCount extension for the ECS maxLength contract')
  const context = { options: extension.options, storage: extension.config.addStorage() }
  extension.config.onBeforeCreate.call(context)
  const plugin = getExtensionField(extension, 'addProseMirrorPlugins', context)()[0]
  let state = EditorState.create({ schema, doc: doc([p('a😀')]), plugins: [plugin] })
  assert.strictEqual(context.storage.characters({ node: state.doc }), 2)
  state = state.apply(state.tr.insertText('b', 4))
  assert.strictEqual(state.doc.textContent, 'a😀b')
  state = state.apply(state.tr.insertText('c', 5))
  assert.strictEqual(state.doc.textContent, 'a😀b', 'Typing beyond maxLength must be rejected')
  state = EditorState.create({ schema, doc: doc([p('a')]), plugins: [plugin] })
  const paste = state.tr.insertText('bcd', 2).setMeta('paste', true)
  paste.setSelection(TextSelection.create(paste.doc, 5))
  state = state.apply(paste)
  assert.strictEqual(state.doc.textContent, 'abc', 'Paste must use the official limit filter')
  const oversized = doc([p('12345')])
  state = EditorState.create({ schema, doc: oversized, plugins: [plugin] })
  state = state.applyTransaction(state.tr.setSelection(TextSelection.create(state.doc, 1))).state
  assert.strictEqual(state.doc.textContent, '12345', 'Initial content must never silently trim')
  assert.strictEqual(createLarkDocExtensions().find((ext) => ext.name === 'characterCount').options.limit, 0)
})
check('Changing ECS maxLength updates the official filter without replacing or trimming the document', () => {
  const extension = createLarkDocExtensions().find((ext) => ext.name === 'characterCount')
  const context = { options: extension.options, storage: extension.config.addStorage() }
  extension.config.onBeforeCreate.call(context)
  const plugin = getExtensionField(extension, 'addProseMirrorPlugins', context)()[0]
  let state = EditorState.create({ schema, doc: doc([p('a'.repeat(201))]), plugins: [plugin] })
  assert.strictEqual(typeof context.storage.setLimit, 'function', 'Missing reactive CharacterCount limit adapter')
  context.storage.setLimit(200)
  state = state.apply(state.tr.insertText('b', 202))
  assert.strictEqual(state.doc.textContent.length, 201, 'Enabling a limit preserves old text and blocks growth')
  state = state.apply(state.tr.delete(200, 202))
  assert.strictEqual(state.doc.textContent.length, 199, 'An oversized document must remain reducible')
  state = state.apply(state.tr.insertText('c', 200))
  assert.strictEqual(state.doc.textContent.length, 200)
  state = state.apply(state.tr.insertText('d', 201))
  assert.strictEqual(state.doc.textContent.length, 200)
  context.storage.setLimit(0)
  state = state.apply(state.tr.insertText('e', 201))
  assert.strictEqual(state.doc.textContent.length, 201, 'Removing the limit must allow future growth')
})
check('ECS image attachment metadata survives JSON, HTML output and ordinary document edits', () => {
  const image = schema.nodes.image.create({ src: 'https://example.com/crop.png', originalSrc: 'https://example.com/original.png', attchId: 'crop-42', originalAttchId: 'image-21' })
  const editor = editorFor(doc([image.toJSON(), p('body')]))
  editor.view.dispatch(editor.state.tr.insertText('!', editor.state.doc.content.size - 1))
  const json = validateDocument(editor.state.doc.toJSON(), schema)
  assert.strictEqual(json.content[0].attrs.attchId, 'crop-42')
  assert.strictEqual(json.content[0].attrs.originalAttchId, 'image-21')
  const rendered = schema.nodes.image.spec.toDOM(editor.state.doc.firstChild)
  assert.strictEqual(rendered[1]['data-attch-id'], 'crop-42')
  assert.strictEqual(rendered[1]['data-original-attch-id'], 'image-21')
  assert.strictEqual(rendered[2][1]['data-attch-id'], 'crop-42')
  for (const value of [42, {}, '\u0000bad', 'bad\nvalue', 'x'.repeat(1001)]) {
    assert.throws(() => validateDocument({ type: 'doc', content: [{ type: 'image', attrs: { src: 'https://example.com/a.png', attchId: value } }] }, schema))
    assert.throws(() => schema.nodes.image.create({ src: 'https://example.com/a.png', attchId: value }).check())
  }
})
check('Explicit ECS content replacement rejects excessive Unicode text and preserves the existing body', () => {
  const component = loadComponent('LarkDocEditor.vue')
  const editor = editorFor(doc([p('old')]))
  editor.schema = schema
  const extension = createLarkDocExtensions({ maxLength: 3 }).find((ext) => ext.name === 'characterCount')
  const context = { options: extension.options, storage: extension.config.addStorage() }
  extension.config.onBeforeCreate.call(context)
  editor.storage = { characterCount: context.storage }
  const vm = { editor, maxLength: 3, savedSelection: { from: 1, to: 2 } }
  assert.throws(() => component.methods.setContent.call(vm, { type: 'doc', content: [p('ab😀c')] }), /3/)
  assert.strictEqual(editor.state.doc.textContent, 'old')
  assert.strictEqual(component.methods.setContent.call(vm, { type: 'doc', content: [p('ab😀')] }), true)
  assert.strictEqual(editor.state.doc.textContent, 'ab😀')
  assert.strictEqual(vm.savedSelection, null)
})
check('Official FileHandler routes accepted image files to the ECS upload boundary', () => {
  const calls = []
  const extension = createLarkDocExtensions({ onImageFiles: (files, pos) => calls.push({ files, pos }) }).find((ext) => ext.name === 'fileHandler')
  assert(extension, 'Missing official FileHandler for image paste/drop')
  const editor = { isEditable: true, state: { selection: { from: 7 } } }
  const plugin = extension.config.addProseMirrorPlugins.call({ name: extension.name, options: extension.options, editor })[0]
  const image = { type: 'image/png', size: 2 }
  const unsupported = { type: 'image/svg+xml', size: 2 }
  const event = { clipboardData: { files: [image, unsupported], getData: () => '<p>clipboard html</p>' }, preventDefault() {}, stopPropagation() {} }
  assert.strictEqual(plugin.props.handlePaste({}, event), true)
  assert.deepStrictEqual(calls, [{ files: [image], pos: 7 }])
  editor.isEditable = false
  plugin.props.handlePaste({}, event)
  assert.strictEqual(calls.length, 1, 'Readonly file handling must not invoke the upload callback')
})

check('H9 emits valid div HTML and round-trippable level attributes', () => {
  const h9 = schema.nodes.heading.create({ level: 9 }, schema.text('九级'))
  assert.deepStrictEqual(schema.nodes.heading.spec.toDOM(h9).slice(0, 2), ['div', { 'data-type': 'heading', 'data-level': 9 }])
  assert(schema.nodes.heading.spec.parseDOM.some((rule) => rule.tag === 'div[data-type="heading"][data-level="9"]'))
  assert.strictEqual(validateDocument({ type: 'doc', content: [h9.toJSON()] }, schema).content[0].attrs.level, 9)
})
check('JSON rejects malformed structure and hostile attributes before replacement; unknown nodes degrade to placeholder (P1-03)', () => {
  for (const content of [
    [{ type: 'text', text: 'orphan' }],
    [{ type: 'image', attrs: { src: 'javascript:alert(1)' } }],
    [{ type: 'paragraph', attrs: { indent: -1 } }],
    [{ type: 'heading', attrs: { level: 10 } }],
    [{ type: 'paragraph', content: [text('x', [{ type: 'link', attrs: { href: 'data:text/html,bad' } }])] }],
    [{ type: 'columns', content: [{ type: 'column', content: [p('a')] }] }],
  ]) assert.throws(() => validateDocument({ type: 'doc', content }, schema))
  // P1-03：未知节点不再硬拒绝，就地降级为 unknownBlock 占位卡（payload 保真）。
  const degraded = validateDocument({ type: 'doc', content: [{ type: 'unknown' }] }, schema)
  assert.strictEqual(degraded.content[0].type, 'unknownBlock')
  assert.strictEqual(degraded.content[0].attrs.unknownType, 'unknown')
  const json = { type: 'doc', content: [p('preserved')] }
  assert.deepStrictEqual(validateDocument(json, schema).content[0].content[0].text, 'preserved')
  assert.deepStrictEqual(json, { type: 'doc', content: [p('preserved')] })
})
check('Public text-style empty attributes roundtrip as unset formatting', () => {
  const json = { type: 'doc', content: [{ type: 'paragraph', content: [text('safe', [{ type: 'textStyle', attrs: { color: '', backgroundColor: '', fontFamily: '', fontSize: '', lineHeight: '' } }])] }] }
  const canonical = validateDocument(json, schema)
  assert.strictEqual(schema.nodeFromJSON(canonical).textContent, 'safe')
  assert.strictEqual(canonical.content[0].content[0].marks[0].attrs.backgroundColor, '')
})
check('URL policy blocks obfuscated scripts and persistent blob/SVG images', () => {
  for (const value of ['javascript:alert(1)', ' java\nscript:alert(1)', '//host/image', 'data:text/html,x', 'blob:http://host/a']) assert(!safeUrl(value, true), value)
  assert(!safeUrl('data:image/svg+xml;base64,PHN2Zz4=', true))
  assert(safeUrl('data:image/png;base64,aGVsbG8=', true))
  assert(safeUrl('https://example.com/image.png', true))
  assert(safeUrl('mailto:demo@example.com'))
})
check('Schema itself rejects unsafe image sources and invalid heading levels', () => {
  assert.throws(() => schema.nodeFromJSON({ type: 'image', attrs: { src: 'javascript:alert(1)' } }))
  assert.throws(() => schema.nodeFromJSON({ type: 'heading', attrs: { level: null } }))
  assert.throws(() => validateDocument({ type: 'doc', content: [{ type: 'heading', attrs: { level: null } }] }, schema))
})
check('Slash opens at line start or after space, not URL/code/nonempty selection', () => {
  for (const [value, expected] of [['/标题', true], ['文字 /表格', true], ['https://host/a', false], ['word/a', false]]) {
    const state = EditorState.create({ schema, doc: doc([p(value)]) })
    const selected = state.apply(state.tr.setSelection(TextSelection.create(state.doc, value.length + 1)))
    assert.strictEqual(!!getSlashMatch(selected), expected, value)
  }
  const listDoc = doc([{ type: 'bulletList', content: [{ type: 'listItem', content: [p('/列表')] }] }])
  let state = EditorState.create({ schema, doc: listDoc })
  state = state.apply(state.tr.setSelection(TextSelection.create(listDoc, 6)))
  assert.deepStrictEqual(getSlashMatch(state), { from: 3, to: 6, query: '列表' })
  const codeDoc = doc([{ type: 'codeBlock', content: [text('/代码')] }])
  state = EditorState.create({ schema, doc: codeDoc, selection: TextSelection.create(codeDoc, 4) })
  assert.strictEqual(getSlashMatch(state), null)
  state = EditorState.create({ schema, doc: doc([p('/abc')]), selection: TextSelection.create(doc([p('/abc')]), 1, 3) })
  assert.strictEqual(getSlashMatch(state), null)
})
check('Search crosses marks and replacement retains unrelated formatting', () => {
  const document = doc([{ type: 'paragraph', content: [text('ab', [{ type: 'bold' }]), text('cd'), text(' xy', [{ type: 'italic' }])] }, p('abcd')])
  assert.deepStrictEqual(findTextMatches(document, 'bc'), [{ from: 2, to: 4 }, { from: 11, to: 13 }])
  const editor = editorFor(document)
  assert.strictEqual(replaceText(editor, 'bc', 'Z', true), 2)
  assert.strictEqual(editor.state.doc.textContent, 'aZd xyaZd')
  const lastText = editor.state.doc.firstChild.lastChild
  assert.strictEqual(lastText.text, ' xy')
  assert.strictEqual(lastText.marks[0].type.name, 'italic')
  editor.isEditable = false
  assert.strictEqual(replaceText(editor, 'a', 'Q', true), 0)
})
check('Unicode search offsets use the original document and Slash ignores inline code', () => {
  assert.deepStrictEqual(findTextMatches(doc([p('İcat CAT')]), 'cat'), [{ from: 2, to: 5 }, { from: 6, to: 9 }])
  const code = doc([{ type: 'paragraph', content: [text('/a', [{ type: 'code' }])] }])
  assert.strictEqual(getSlashMatch(EditorState.create({ schema, doc: code, selection: TextSelection.create(code, 3) })), null)
})
check('Single replacement changes the selected occurrence rather than the first hit', () => {
  const document = doc([p('cat cat')])
  const editor = editorFor(document, TextSelection.create(document, 5, 8))
  assert.strictEqual(replaceText(editor, 'cat', 'Z'), 1)
  assert.strictEqual(editor.state.doc.textContent, 'cat Z')
})
check('Moves are atomic, preserve text, reject partial and illegal nested moves', () => {
  const editor = editorFor(doc([p('a'), p('b'), p('c')]))
  assert(moveBlockRange(editor, 0, 6, 9))
  assert.strictEqual(editor.state.doc.textContent, 'cab')
  assert(!moveBlockRange(editor, 1, 3, 9))
  assert.strictEqual(editor.state.doc.textContent, 'cab')
  const columns = doc([{ type: 'columns', content: [
    { type: 'column', attrs: { width: 50 }, content: [p('a'), p('b')] },
    { type: 'column', attrs: { width: 50 }, content: [p('c')] },
  ] }])
  const colEditor = editorFor(columns)
  assert(moveBlockRange(colEditor, 2, 5, 10))
  assert.strictEqual(colEditor.state.doc.child(0).child(0).textContent, 'b')
  assert.strictEqual(colEditor.state.doc.child(0).child(1).textContent, 'ac')
  assert(!moveBlockRange(colEditor, 0, colEditor.state.doc.content.size, 2))
})
check('Outline includes nested and ninth-level headings with document positions', () => {
  const document = doc([{ type: 'heading', attrs: { level: 1 }, content: [text('A')] }, p('body'), { type: 'callout', content: [{ type: 'heading', attrs: { level: 9 }, content: [text('B')] }] }])
  assert.deepStrictEqual(collectOutline(document), [{ pos: 0, level: 1, text: 'A' }])
})
check('Heading sections follow indentation, never heading levels', () => {
  // 飞书块模型只有父子（缩进）关系：章节 = 后续缩进更深的连续块。
  const h2 = hi(2, '你好我是1', 0)
  const h3 = hi(3, '你好 我是3', 1)
  const rootParagraph = pi('根级文字', 0)
  const nextText = p('22222')
  const code = { type: 'codeBlock', content: [text('独立代码')] }
  const list = { type: 'orderedList', content: [{ type: 'listItem', content: [p('1. 你好')] }, { type: 'listItem', content: [p('2. 我是')] }] }
  const nextHeading = hi(2, '下一章节')
  const document = doc([h2, h3, rootParagraph, nextText, code, nextHeading, list])
  const positions = []
  document.forEach((node, pos) => positions.push({ node, pos }))
  const section = resolveHeadingSection(document, positions[0].pos)
  assert.deepStrictEqual(section.blocks.map((block) => block.node.type.name), ['heading', 'heading'])
  assert.strictEqual(section.to, positions[2].pos, '回到同级缩进的段落结束章节')
  assert.deepStrictEqual(foldedRange(document, positions[0].pos), { from: positions[0].pos + positions[0].node.nodeSize, to: positions[2].pos }, '折叠范围与高亮范围是同一段缩进子树')
  // 用户反馈③：H2 缩进 1、子段落缩进 2、H4 也缩进 1 → 折叠 H2 不带 H4
  const userDocument = doc([hi(2, '我是2', 1), pi('你好 我是标题2', 2), hi(4, '你好 我是3', 1), pi('兄弟正文', 1)])
  const userPositions = []
  userDocument.forEach((node, pos) => userPositions.push({ node, pos }))
  const userSection = resolveHeadingSection(userDocument, userPositions[0].pos)
  assert.deepStrictEqual(userSection.blocks.map((block) => block.node.type.name), ['heading', 'paragraph'], '缩进更深的普通段落属于 H2，同级缩进的 H4 不属于')
  assert.deepStrictEqual(foldedRange(userDocument, userPositions[0].pos), { from: userPositions[0].pos + userPositions[0].node.nodeSize, to: userPositions[2].pos })
  assert.deepStrictEqual(collectOutline(userDocument).map((item) => item.level), [2, 4], '目录仍按标题级别收集，与折叠范围无关')
  // 缩进段落里插入的代码块（indent 默认 0）沿用上一层，不会把章节截断
  const nestedCode = doc([hi(2, '父标题', 1), pi('子段落', 2), { type: 'codeBlock', attrs: { indent: 0 }, content: [text('代码')] }, pi('同级兄弟', 1)])
  const nestedPositions = []
  nestedCode.forEach((node, pos) => nestedPositions.push({ node, pos }))
  assert.deepStrictEqual(foldedRange(nestedCode, nestedPositions[0].pos), { from: nestedPositions[0].pos + nestedPositions[0].node.nodeSize, to: nestedPositions[3].pos }, '未显式缩进的代码块仍然留在父标题的子树里')
  // 老文档：标题之间没有缩进 → 没有可折叠内容，箭头不出现
  const flat = doc([hi(2, 'A'), hi(3, 'B'), p('C')])
  assert.strictEqual(foldedRange(flat, 0), null, '同级缩进的标题没有折叠范围')
  assert.strictEqual(headingActionRange(flat, 0), null, '没有子树的标题不提供章节动作范围')
  // 容器内标题不进页面大纲/折叠模型
  const nestedHeadingDocument = doc([{ type: 'callout', content: [hi(2, '容器标题'), pi('容器正文', 1)] }])
  let nestedHeadingPos = -1
  nestedHeadingDocument.descendants((node, pos) => { if (node.type.name === 'heading') nestedHeadingPos = pos })
  assert.strictEqual(isPageHeading(nestedHeadingDocument, nestedHeadingPos), false, 'container headings stay out of the page heading fold/outline model')
})
check('Non-heading blocks fold and highlight their whole indented subtree', () => {
  // 用户实测（真飞书截图）：段落「你好」+ 缩进代码块「方法」、列表项「b. 4」+
  // 内部代码块「1」都能折叠，悬停时整块高亮。折叠范围 = 缩进子树，与块类型无关。
  const code = (value, indent) => ({ type: 'codeBlock', attrs: { indent }, content: [text(value)] })
  const document = doc([
    pi('你好', 0),
    code('方法', 1),
    pi('你好你好', 0),
    { type: 'orderedList', content: [{ type: 'listItem', content: [p('b. 4'), code('1', 1)] }] },
    p('普通段落'),
  ])
  const positions = []
  document.forEach((node, pos) => positions.push({ node, pos }))
  assert.strictEqual(isFoldableBlock(document, positions[0].pos), true, '段落是合法的可折叠块')
  assert.deepStrictEqual(foldedRange(document, positions[0].pos), { from: positions[1].pos, to: positions[1].pos + positions[1].node.nodeSize }, '段落的折叠范围就是它缩进的子块')
  // 悬停高亮与折叠共用同一段范围（resolveHeadingSectionMode 一套语义）
  const section = resolveHeadingSection(document, positions[0].pos)
  assert.deepStrictEqual(section.blocks.map((block) => block.node.type.name), ['paragraph', 'codeBlock'])
  assert.strictEqual(section.hasContent, true, '段落有子块 → 悬停整块高亮成一块')
  // 列表项：子树在自己内部（首个子段落之后）
  assert.strictEqual(isFoldableBlock(document, positions[3].pos + 1), true, '列表项是合法的可折叠块')
  const itemPos = positions[3].pos + 1
  const item = document.nodeAt(itemPos)
  assert.strictEqual(item.type.name, 'listItem')
  assert.deepStrictEqual(foldedRange(document, itemPos), { from: itemPos + 1 + item.child(0).nodeSize, to: itemPos + item.nodeSize - 1 }, '列表项折叠的是 item 内部的子块')
  assert.strictEqual(foldedRange(document, itemPos + 1), null, 'item 的首个段落不单独折叠（折叠入口归 item，否则同一处会有两个箭头）')
  // 段落后的列表在飞书块树里是宿主的子块（与标题同款），因此「你好你好」可折叠整个列表；
  // 同级段落（indent 0 的文本块）彼此之间仍然不产生折叠范围。
  assert.deepStrictEqual(foldedRange(document, positions[2].pos), { from: positions[3].pos, to: positions[3].pos + positions[3].node.nodeSize }, '段落后的列表是它的隐式子树（飞书块树语义）')
  assert.strictEqual(foldedRange(document, positions[4].pos), null, '末尾普通段落没有折叠范围')
  const plainList = doc([{ type: 'orderedList', content: [{ type: 'listItem', content: [p('只有文字')] }] }])
  assert.strictEqual(foldedRange(plainList, 1), null, '只有一段文字的列表项不提供折叠范围')
  // 箭头只能注入「内容以行内开头」的块；原子块有 foldedRange=null 兜底
  assert.deepStrictEqual([...TEXT_FOLD_TYPES].sort(), ['heading', 'listItem', 'paragraph', 'taskItem'])
  assert.strictEqual(TEXT_FOLD_TYPES.has('codeBlock'), false, '代码块不注入折叠箭头')
  // 折叠集合按 blockId 存，段落与列表项都必须进索引
  const withIds = doc([
    { type: 'paragraph', attrs: { indent: 0, blockId: 'pA' }, content: [text('你好')] },
    code('方法', 1),
    { type: 'orderedList', content: [{ type: 'listItem', attrs: { blockId: 'liA' }, content: [p('b. 4'), code('1', 1)] }] },
  ])
  const index = foldableIdPositions(withIds)
  assert.strictEqual(index.has('pA'), true, '段落进了可折叠索引')
  assert.strictEqual(index.has('liA'), true, '列表项进了可折叠索引')
  // 容器内的块不参与页面级折叠（折叠属于容器自身）
  const inCallout = doc([{ type: 'callout', content: [{ type: 'paragraph', attrs: { indent: 0, blockId: 'pB' }, content: [text('a')] }, pi('b', 1)] }])
  let calloutParagraphPos = -1
  inCallout.descendants((node, pos) => { if (node.attrs && node.attrs.blockId === 'pB') calloutParagraphPos = pos })
  assert.strictEqual(isFoldableBlock(inCallout, calloutParagraphPos), false, 'callout 内的段落不参与页面级折叠/高亮')
})
check('Heading numbering uses LarkDoc multi-level formats and restart semantics', () => {
  // 飞书：H1 → 「1.」带尾点，H2 → 「1.1」，H3 → 「1.1.1」；前导 0 省略。
  assert.strictEqual(formatHeadingNumber([1]), '1.')
  assert.strictEqual(formatHeadingNumber([1, 1]), '1.1')
  assert.strictEqual(formatHeadingNumber([2, 3]), '2.3')
  assert.strictEqual(formatHeadingNumber([2, 3, 4]), '2.3.4')
  assert.strictEqual(formatHeadingNumber([0, 1]), '1.', '文档直接从 H2 开始时不能显示 0.1')
  assert.strictEqual(formatHeadingNumber([]), '')

  const collect = (document) => {
    const map = computeHeadingNumbers(document)
    return [...map.values()].map((info) => info.label)
  }
  // 只统计「带编号」的标题；没开编号的标题不占号（飞书新建标题默认无编号）
  const basic = doc([hd(1, 'A', { numbering: true }), p('body'), hd(1, 'B', { numbering: true }), hd(1, 'C'), hd(1, 'D', { numbering: true })])
  assert.deepStrictEqual(collect(basic), ['1.', '2.', '3.'])
  // 多级：H2/H3 归到最近的上级；回到 H1 时深层计数归零
  const nested = doc([
    hd(1, 'A', { numbering: true }), hd(2, 'A1', { numbering: true }), hd(2, 'A2', { numbering: true }),
    hd(3, 'A2a', { numbering: true }), hd(1, 'B', { numbering: true }), hd(2, 'B1', { numbering: true }),
  ])
  assert.deepStrictEqual(collect(nested), ['1.', '1.1', '1.2', '1.2.1', '2.', '2.1'])
  // 「重新开始编号 / 设置编号的值」：从该值起算，后续同级兄弟继续它
  const restarted = doc([
    hd(1, 'A', { numbering: true }), hd(1, 'B', { numbering: true }),
    hd(1, 'C', { numbering: true, numberingStart: 5 }), hd(1, 'D', { numbering: true }),
  ])
  assert.deepStrictEqual(collect(restarted), ['1.', '2.', '5.', '6.'], '重新开始后同级兄弟继续该序列')
  // 层级前缀照样继承（H2 重新开始时是 1.5 而不是 5.）
  const nestedRestart = doc([
    hd(1, 'A', { numbering: true }), hd(2, 'A1', { numbering: true }),
    hd(2, 'A2', { numbering: true, numberingStart: 7 }), hd(2, 'A3', { numbering: true }),
  ])
  assert.deepStrictEqual(collect(nestedRestart), ['1.', '1.1', '1.7', '1.8'])
  // headingNumberAt 只认带编号的标题
  const positions = []
  basic.forEach((node, pos) => positions.push({ node, pos }))
  assert.strictEqual(headingNumberAt(basic, positions[0].pos).label, '1.')
  assert.strictEqual(headingNumberAt(basic, positions[3].pos), null, '没开编号的标题没有编号')
  // 起点的钳制：null / 空串 = 继续；越界压回 1..999
  assert.strictEqual(clampHeadingNumberStart(null), null)
  assert.strictEqual(clampHeadingNumberStart(undefined), null)
  assert.strictEqual(clampHeadingNumberStart(''), null)
  assert.strictEqual(clampHeadingNumberStart(0), 1)
  assert.strictEqual(clampHeadingNumberStart(-3), 1)
  assert.strictEqual(clampHeadingNumberStart(5000), 999)
  assert.strictEqual(clampHeadingNumberStart('12'), 12)
})
check('Heading numbering attributes round-trip through HTML and pass the sanitizer', () => {
  const numbered = schema.nodeFromJSON(hd(2, 'X', { numbering: true, numberingStart: 3 }))
  const rendered = schema.nodes.heading.spec.toDOM(numbered)
  assert.strictEqual(rendered[1]['data-numbering'], 'true')
  assert.strictEqual(rendered[1]['data-numbering-start'], 3)
  const plain = schema.nodes.heading.spec.toDOM(schema.nodeFromJSON(hd(2, 'Y')))
  assert.strictEqual(plain[1]['data-numbering'], undefined, '没开编号的标题不输出编号属性')
  assert.strictEqual(plain[1]['data-numbering-start'], undefined)
  // 越界起点被 JSON 校验拦下（sanitize 白名单由 check-vditor-html 的 jsdom 用例覆盖）
  assert.throws(() => validateDocument({ type: 'doc', content: [hd(1, 'Z', { numbering: true, numberingStart: 99999 })] }, schema), /不安全或无效|numberingStart/, '越界起点被 JSON 校验拦下')
  const imported = validateDocument({ type: 'doc', content: [hd(1, 'Z', { numbering: true, numberingStart: 3 })] }, schema)
  assert.strictEqual(imported.content[0].attrs.numberingStart, 3)
})
check('Heading numbering commands toggle, restart and skip empty transactions', () => {
  const extension = createLarkDocExtensions().find((ext) => ext.name === 'larkDoc')
  const context = { storage: extension.config.addStorage(), editor: { isEditable: true } }
  const commands = extension.config.addCommands.call(context)
  let state = EditorState.create({ schema, doc: doc([hd(1, 'A'), hd(1, 'B')]) })
  const run = (fn) => { const tr = state.tr; const ok = fn({ tr, dispatch: () => {} }); if (ok) state = state.apply(tr); return ok }
  assert.strictEqual(run(commands.toggleLarkDocHeadingNumber(0)), true)
  assert.strictEqual(state.doc.nodeAt(0).attrs.numbering, true)
  assert.strictEqual(state.doc.nodeAt(0).attrs.numberingStart, null, '开启编号默认是「继续」')
  assert.strictEqual(run(commands.setLarkDocHeadingNumber(0, { numberingStart: 4 })), true)
  assert.strictEqual(state.doc.nodeAt(0).attrs.numberingStart, 4)
  assert.strictEqual(run(commands.setLarkDocHeadingNumber(0, { numberingStart: 4 })), false, '值没变时不派发空事务')
  assert.strictEqual(run(commands.setLarkDocHeadingNumber(0, { numberingStart: null })), true)
  assert.strictEqual(state.doc.nodeAt(0).attrs.numberingStart, null, '「继续标题编号」= 清掉起点')
  // 非标题位置命令拒绝执行
  assert.strictEqual(run(commands.toggleLarkDocHeadingNumber(9999)), false)
  assert.strictEqual(run(commands.toggleLarkDocHeadingNumber(0)), true)
  assert.strictEqual(state.doc.nodeAt(0).attrs.numbering, false, '再点一次关闭编号')
})
check('Heading numbering recomputes after edits (delete/disable never leaves stale numbers)', () => {
  const labels = (document) => [...computeHeadingNumbers(document).values()].map((info) => info.label)
  const base = doc([hd(1, 'A', { numbering: true }), hd(1, 'B', { numbering: true }), hd(1, 'C', { numbering: true })])
  const positions = []
  base.forEach((node, pos) => positions.push({ node, pos }))
  assert.deepStrictEqual(labels(base), ['1.', '2.', '3.'])
  // 删掉第一个标题：后面两个自动前移成 1. / 2.（编号不是存下来的值）
  const afterDelete = EditorState.create({ schema, doc: base }).apply(
    EditorState.create({ schema, doc: base }).tr.delete(positions[0].pos, positions[1].pos)
  )
  assert.deepStrictEqual(labels(afterDelete.doc), ['1.', '2.'])
  // 关掉中间那个的编号：它不再占号，兄弟重新连续
  let state = EditorState.create({ schema, doc: base })
  const middle = state.doc.nodeAt(positions[1].pos)
  state = state.apply(state.tr.setNodeMarkup(positions[1].pos, middle.type, { ...middle.attrs, numbering: false }))
  assert.deepStrictEqual(labels(state.doc), ['1.', '2.'])
})
check('Ordered lists number 1./a./i. per nesting level, honor start, and keep markers out of text', () => {
  // 格式按层换：第 1 层阿拉伯数字、第 2 层小写字母、第 3 层小写罗马，再深回到数字。
  assert.strictEqual(formatOrderedIndex(1, 1), '1.')
  assert.strictEqual(formatOrderedIndex(12, 1), '12.')
  assert.strictEqual(formatOrderedIndex(1, 2), 'a.')
  assert.strictEqual(formatOrderedIndex(26, 2), 'z.')
  assert.strictEqual(formatOrderedIndex(27, 2), 'aa.')
  assert.strictEqual(formatOrderedIndex(4, 3), 'iv.')
  assert.strictEqual(formatOrderedIndex(9, 3), 'ix.')
  assert.strictEqual(formatOrderedIndex(1, 4), '1.')
  assert.strictEqual(alphaListLabel(52), 'az')
  assert.strictEqual(romanListLabel(1), 'i')
  assert.strictEqual(romanListLabel(14), 'xiv')

  const listDoc = doc([
    { type: 'orderedList', content: [
      { type: 'listItem', content: [p('一')] },
      { type: 'listItem', content: [p('二'), { type: 'orderedList', content: [
        { type: 'listItem', content: [p('二之一'), { type: 'orderedList', content: [{ type: 'listItem', content: [p('二之一之一')] }] }] },
        { type: 'listItem', content: [p('二之二')] },
      ] }] },
    ] },
    { type: 'orderedList', attrs: { start: 5 }, content: [{ type: 'listItem', content: [p('五')] }] },
  ])
  const markers = []
  computeOrderedListNumbers(listDoc).forEach((info, pos) => markers.push(`${listDoc.nodeAt(pos).firstChild.textContent}=${info.label}@${info.depth}`))
  // Map 的插入顺序 = 文档遍历顺序（先登记整层，再进嵌套层），这里只关心「谁该是几号几层」。
  assert.deepStrictEqual(markers.slice().sort(), ['一=1.@1', '二=2.@1', '二之一=a.@2', '二之一之一=i.@3', '二之二=b.@2', '五=5.@1'].sort())

  // 序号不进正文：getText() 只有列表项文字（飞书里序号也是 contentEditable=false 的按钮）。
  assert.strictEqual(listDoc.textBetween(0, listDoc.content.size, '\n'), '一\n二\n二之一\n二之一之一\n二之二\n五')
  // 圆点列表同样走装饰层，深度用来缩进。
  const bulletDoc = doc([{ type: 'bulletList', content: [
    { type: 'listItem', content: [p('A'), { type: 'bulletList', content: [{ type: 'listItem', content: [p('A1')] }] }] },
  ] }])
  const bullets = [...computeBulletItems(bulletDoc).values()].map((info) => info.depth)
  assert.deepStrictEqual(bullets, [1, 2])
})

check('List numbers are clickable like LarkDoc: restart and set-value write an item start', () => {
  const extension = createLarkDocExtensions().find((ext) => ext.name === 'larkDoc')
  const context = { storage: extension.config.addStorage(), editor: { isEditable: true } }
  const commands = extension.config.addCommands.call(context)
  const listDoc = doc([{ type: 'orderedList', content: [
    { type: 'listItem', content: [p('一')] },
    { type: 'listItem', content: [p('二')] },
    { type: 'listItem', content: [p('三')] },
  ] }])
  const labels = (document) => [...computeOrderedListNumbers(document).values()].map((info) => info.label)
  assert.deepStrictEqual(labels(listDoc), ['1.', '2.', '3.'])
  // 第二个 item 的位置 = 1（列表内容起点）+ 第一个 item 的 nodeSize
  const second = listDoc.child(0).child(0).nodeSize + 1
  let state = EditorState.create({ schema, doc: listDoc })
  const run = (fn) => { const tr = state.tr; const ok = fn({ tr, dispatch: () => {} }); if (ok) state = state.apply(tr); return ok }
  // 「重新开始编号」= 从该项起算 1，后面的兄弟接着数（不是拆成两个列表）
  assert.strictEqual(run(commands.setLarkDocListItemNumber(second, 1)), true)
  assert.deepStrictEqual(labels(state.doc), ['1.', '1.', '2.'])
  assert.strictEqual(state.doc.child(0).childCount, 3, '编号重开不拆列表')
  assert.strictEqual(run(commands.setLarkDocListItemNumber(second, 1)), false, '值没变时不派发空事务')
  // 「设置编号的值」
  assert.strictEqual(run(commands.setLarkDocListItemNumber(second, 7)), true)
  assert.deepStrictEqual(labels(state.doc), ['1.', '7.', '8.'])
  // 「继续编号」= 清掉这个 item 的起点，编号自动接上前面
  assert.strictEqual(run(commands.setLarkDocListItemNumber(second, null)), true)
  assert.deepStrictEqual(labels(state.doc), ['1.', '2.', '3.'])
  // 起点会被钳制；非列表项位置命令拒绝执行
  assert.strictEqual(run(commands.setLarkDocListItemNumber(second, 5000)), true)
  assert.strictEqual(state.doc.child(0).child(1).attrs.numberStart, 999)
  assert.strictEqual(run(commands.setLarkDocListItemNumber(0, 3)), false)
  assert.strictEqual(run(commands.setLarkDocListItemNumber(9999, 3)), false)

  // JSON 校验 + HTML 往返：起点等价 <li value>，越界值被拦下
  const withStart = { type: 'orderedList', content: [{ type: 'listItem', attrs: { numberStart: 5 }, content: [p('X')] }] }
  assert.strictEqual(validateDocument({ type: 'doc', content: [withStart] }, schema).content[0].content[0].attrs.numberStart, 5)
  assert.throws(() => validateDocument({ type: 'doc', content: [{ type: 'orderedList', content: [{ type: 'listItem', attrs: { numberStart: 99999 }, content: [p('X')] }] }] }, schema), /不安全或无效|numberStart/)
  const rendered = schema.nodes.listItem.spec.toDOM(schema.nodeFromJSON(withStart.content[0]))
  assert.strictEqual(rendered[1].value, 5)
  const plainItem = schema.nodes.listItem.spec.toDOM(schema.nodeFromJSON({ type: 'listItem', content: [p('Y')] }))
  assert.strictEqual(plainItem[1].value, undefined, '没有起点时不输出 value')
})

check('Line-start markers (1. / 3. / 1、) become numbered blocks at the block start only', () => {
  // 模拟「在块内 caretOffset 处按下空格」：before 就是光标前的整段文字。
  const run = (blockText, caretOffset, type = 'paragraph', attrs = {}) => {
    const node = type === 'heading'
      ? { type, attrs: { level: 1, ...attrs }, content: [text(blockText)] }
      : { type: 'paragraph', content: [text(blockText)] }
    let state = EditorState.create({ schema, doc: doc([node]) })
    const view = { state, dispatch: (tr) => { state = state.apply(tr) } }
    return { handled: applyLineStartMarker(view, 1 + caretOffset), doc: state.doc }
  }
  // 空行输入「1.」+ 空格 → 有序列表，序号从 1 起
  const first = run('1.', 2)
  assert.strictEqual(first.handled, true)
  assert.strictEqual(first.doc.firstChild.type.name, 'orderedList')
  assert.strictEqual(first.doc.firstChild.attrs.start, 1)
  assert.strictEqual(first.doc.firstChild.textContent, '')
  // 行首已有文字：标记被吃掉，后面的文字原样变成列表项内容
  const withText = run('3.回归结果', 2)
  assert.strictEqual(withText.handled, true)
  assert.strictEqual(withText.doc.firstChild.type.name, 'orderedList')
  assert.strictEqual(withText.doc.firstChild.attrs.start, 3)
  assert.strictEqual(withText.doc.firstChild.textContent, '回归结果')
  // 不是在行首输入（前面还有别的字）就不该触发
  assert.strictEqual(run('前言 1.', 6).handled, false)
  assert.strictEqual(run('内容', 2).handled, false)
  // 全角标记（中文输入法打出来的 1、1。1））同样认
  ;['1、', '1。', '1）'].forEach((marker) => {
    const full = run(marker, marker.length)
    assert.strictEqual(full.handled, true)
    assert.strictEqual(full.doc.firstChild.type.name, 'orderedList')
  })
  // 标题行：标题不能包进列表，改成「标题 + 编号」（蓝色 3.），文字保留
  const heading = run('3.回归结果', 2, 'heading')
  assert.strictEqual(heading.handled, true)
  assert.strictEqual(heading.doc.firstChild.type.name, 'heading')
  assert.strictEqual(heading.doc.firstChild.attrs.numbering, true)
  assert.strictEqual(heading.doc.firstChild.attrs.numberingStart, 3)
  assert.strictEqual(heading.doc.firstChild.textContent, '回归结果')
  // 已经在列表项里就不再包一层
  const listDoc = doc([{ type: 'orderedList', content: [{ type: 'listItem', content: [p('3.')] }] }])
  let listState = EditorState.create({ schema, doc: listDoc })
  const listView = { state: listState, dispatch: (tr) => { listState = listState.apply(tr) } }
  assert.strictEqual(applyLineStartMarker(listView, 3), false)
})

check('Callout style and emoji attributes are whitelisted and round-trip through HTML', () => {
  const callout = schema.nodeFromJSON({ type: 'callout', attrs: { backgroundColor: '#eff9f4', borderColor: '#00b887', color: '#263830', emoji: '🎉' }, content: [p('body')] })
  const rendered = schema.nodes.callout.spec.toDOM(callout)
  assert.strictEqual(rendered[1]['data-emoji'], '🎉')
  assert(rendered[1].style.includes('background-color: #eff9f4'))
  assert(rendered[1].style.includes('border-color: #00b887'))
  assert(rendered[1].style.includes('color: #263830'))
  assert.strictEqual(validateDocument({ type: 'doc', content: [callout.toJSON()] }, schema).content[0].attrs.emoji, '🎉')
  assert.throws(() => validateDocument({ type: 'doc', content: [{ type: 'callout', attrs: { emoji: 'javascript:alert(1)' }, content: [p('')] }] }, schema), /emoji|图标/)
})
check('Folds hide complete sections, remap on edits, and reveal hidden search hits', () => {
  const extension = createLarkDocExtensions().find((ext) => ext.name === 'larkDoc')
  const storage = extension.config.addStorage()
  const context = { storage, editor: { isEditable: true } }
  const plugin = extension.config.addProseMirrorPlugins.call(context)[0]
  const commands = extension.config.addCommands.call(context)
  let state = EditorState.create({ schema, doc: doc([
    hi(1, 'A'), pi('hidden', 1),
    hi(1, 'B'), p('visible'),
  ]), plugins: [plugin] })
  const command = (fn) => { const tr = state.tr; assert(fn({ tr, dispatch: () => {} })); state = state.apply(tr) }
  // 宿主挂载时会先补 blockId（LarkDocEditor.mounted）：折叠集合按 id 存，
  // 没有 id 就没有折叠位可谈。
  command(commands.ensureLarkDocBlockIds())
  const idA = state.doc.nodeAt(0).attrs.blockId
  const idB = state.doc.nodeAt(11).attrs.blockId
  assert(idA && idB && idA !== idB, 'every block receives a unique block id')
  command(commands.toggleLarkDocFold(0))
  assert(storage.folded.has(idA))
  assert.strictEqual(storage.folded.has(idB), false)
  assert(plugin.props.decorations(state).find().some((item) => item.from === 3 && item.to === 11))
  assert(plugin.props.decorations(state).find().some((item) => item.from === 3 && item.to === 11 && item.type.attrs && item.type.attrs['aria-hidden'] === 'true'), 'folded descendants are aria-hidden for screen readers')
  command(commands.setLarkDocSearch('hidden', 0))
  assert(plugin.props.decorations(state).find().some((item) => item.from === 4 && item.to === 10))
  command(commands.revealLarkDocMatch(4, 10))
  assert.strictEqual(storage.folded.size, 0)
  command(commands.toggleLarkDocFold(0))
  // 上方插入新块：折叠集合存 id，不需要跟着位置重映射。
  state = state.apply(state.tr.insert(0, schema.nodes.paragraph.create()))
  assert(storage.folded.has(idA), 'fold state follows the heading block, not its position')
  assert(state.doc.nodeAt(0).attrs.blockId, 'a new block gets its own id from the appendTransaction pass')
  assert.strictEqual(state.doc.nodeAt(2).attrs.blockId, idA)
})
check('Fold state is keyed by stable block ids (same-name headings never share it)', () => {
  const extension = createLarkDocExtensions().find((ext) => ext.name === 'larkDoc')
  const storage = extension.config.addStorage()
  const context = { storage, editor: { isEditable: true } }
  const plugin = extension.config.addProseMirrorPlugins.call(context)[0]
  const commands = extension.config.addCommands.call(context)
  let state = EditorState.create({ schema, doc: doc([
    hi(1, 'A'), pi('a-body', 1),
    hi(1, 'A'), pi('a2-body', 1),
    hi(2, 'B'), pi('b-body', 1),
  ]), plugins: [plugin] })
  const command = (fn) => { const tr = state.tr; assert(fn({ tr, dispatch: () => {} })); state = state.apply(tr) }
  command(commands.ensureLarkDocBlockIds())
  const idOf = (node, at) => state.doc.nodeAt(at).attrs.blockId
  const ids = [0, 11, 23].map((at) => idOf(null, at))
  assert(new Set(ids).size === 3, 'each block gets a distinct id, even when the text repeats')
  // 折叠第一个 A：只有它自己进入折叠集合，第二个同名 A 不受影响。
  command(commands.toggleLarkDocFold(0))
  assert.deepStrictEqual(Array.from(storage.folded), [ids[0]])
  assert.strictEqual(state.doc.nodeAt(11).attrs.blockId, ids[1])
  // 重命名不影响 id，也不影响折叠。
  state = state.apply(state.tr.insertText('2', 1, 2))
  assert.strictEqual(state.doc.nodeAt(0).attrs.blockId, ids[0], 'renaming keeps the block id')
  assert(storage.folded.has(ids[0]), 'renaming a folded heading keeps its fold state')
  // 删掉靠前的同名标题：第二个 A 的 id 不变、也绝不会继承前者的折叠状态
  //（旧版「层级+文本+同名序号」键会在这里整体前移，把折叠错挂到第二个 A 上）。
  state = state.apply(state.tr.delete(0, 11))
  assert.strictEqual(state.doc.nodeAt(0).attrs.blockId, ids[1], 'the remaining same-name heading keeps its own id')
  assert.strictEqual(storage.folded.has(ids[0]), false, 'deleting a heading drops its fold state')
  assert.strictEqual(storage.folded.has(ids[1]), false, 'the sibling same-name heading never inherits the fold state')
  assert.strictEqual(storage.folded.size, 0, 'no ghost ids survive a block deletion')
  // 内容替换（resetLarkDocFolds）后按 id 恢复折叠位
  command(commands.resetLarkDocFolds())
  command(commands.foldLarkDocByIds([ids[1]]))
  assert(storage.folded.has(ids[1]), 'folds restore by block id after content replacement')
  // 旧版派生键仍然可迁移
  command(commands.resetLarkDocFolds())
  const legacyKey = mapHeadingFoldKeys(state.doc).get(0)
  command(commands.foldLarkDocByKeys([legacyKey]))
  assert(storage.folded.has(ids[1]), 'legacy preference keys migrate onto the current block ids')
})
check('Block ids are unique, reissued on duplicates, and survive JSON/HTML round-trips', () => {
  const extension = createLarkDocExtensions().find((ext) => ext.name === 'larkDoc')
  const storage = extension.config.addStorage()
  const context = { storage, editor: { isEditable: true } }
  const plugin = extension.config.addProseMirrorPlugins.call(context)[0]
  const commands = extension.config.addCommands.call(context)
  let state = EditorState.create({ schema, doc: doc([p('段落一')]), plugins: [plugin] })
  const command = (fn) => { const tr = state.tr; assert(fn({ tr, dispatch: () => {} })); state = state.apply(tr) }
  command(commands.ensureLarkDocBlockIds())
  const first = state.doc.nodeAt(0).attrs.blockId
  assert(first)
  // 回车分段：tr.split 会复制 attrs，appendTransaction 必须给其中一半重发 id
  state = state.apply(state.tr.split(3, 1))
  const ids = []
  state.doc.forEach((node) => ids.push(node.attrs.blockId))
  assert.strictEqual(ids.length, 2)
  assert.strictEqual(new Set(ids).size, 2, 'splitting never leaves two blocks sharing an id')
  assert(ids.includes(first), 'the original block keeps its id after a split')
  // 复制粘贴到文档最前面：副本拿到新 id，原块（映射到插入点之后）保住自己的 id
  const copy = schema.nodes.paragraph.create({ blockId: first }, schema.text('复制'))
  state = state.apply(state.tr.insert(0, copy))
  assert(state.doc.nodeAt(0).attrs.blockId !== first, 'the pasted copy is re-issued a fresh id')
  assert.strictEqual(state.doc.nodeAt(4).attrs.blockId, first, 'the original block keeps its id when a copy is pasted before it')
  const paragraph = schema.nodes.paragraph.create({ blockId: 'bkeepme1' }, schema.text('X'))
  assert.strictEqual(schema.nodes.paragraph.spec.toDOM(paragraph)[1]['data-block-id'], 'bkeepme1', 'block ids render into HTML')
  const json = { type: 'doc', content: [paragraph.toJSON()] }
  assert.strictEqual(validateDocument(json, schema).content[0].attrs.blockId, 'bkeepme1', 'block ids survive JSON validation')
  assert.throws(() => validateDocument({ type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'bad id!' }, content: [] }] }, schema), /blockId|不安全/, 'unsafe block ids are rejected')
})
check('Fold preference storage survives intermediate host content (no wipe on mismatch)', () => {
  // 宿主挂载后还会再灌一次正文：恢复时若当前文档还不是最终内容，一条键都匹配不上。
  // 此时必须保留本地偏好，否则「写成空数组 → 后面那次恢复也读不到」= 刷新后折叠全丢。
  const component = loadComponent('LarkDocEditor.vue')
  const store = new Map()
  const previousWindow = global.window
  global.window = {
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    },
  }
  const KEY = 'lark-doc:folds:doc-1'
  const fakeEditor = (node) => {
    const foldStorage = { folded: new Set() }
    const idOf = (at) => node.nodeAt(at).attrs.blockId
    const editor = {
      state: { doc: node },
      storage: { larkDoc: foldStorage },
      commands: {
        foldLarkDocByIds(ids) {
          node.descendants((child) => { if (child.type.name === 'heading' && ids.includes(child.attrs.blockId)) foldStorage.folded.add(child.attrs.blockId) })
          return true
        },
        foldLarkDocByKeys(keys) {
          mapHeadingFoldKeys(node).forEach((key, pos) => {
            if (!keys.includes(key)) return
            const range = foldedRange(node, pos)
            if (range && range.to > range.from) foldStorage.folded.add(idOf(pos))
          })
          return true
        },
        resetLarkDocFolds() { foldStorage.folded.clear(); return true },
      },
    }
    const ctx = { foldPersistKey: 'doc-1', editor, $emit: () => {}, $forceUpdate: () => {} }
    ctx.foldStorageKey = component.methods.foldStorageKey.bind(ctx)
    ctx.persistFolds = component.methods.persistFolds.bind(ctx)
    ctx.restoreFolds = component.methods.restoreFolds.bind(ctx)
    return ctx
  }
  // 折叠范围按缩进子树算：正文必须缩进一层才是标题的子块。
  const headingDoc = (id, bodyText) => doc([{ type: 'heading', attrs: { level: 1, blockId: id }, content: [text('A')] }, pi(bodyText, 1)])
  const legacyKey = `1\u0001A\u00010`
  try {
    store.set(KEY, JSON.stringify(['bunknown1']))
    // 1) 正文还未灌入（没有标题的中间态）：恢复零命中，偏好必须原样保留
    const empty = fakeEditor(doc([p('章节 A 的正文段落')]))
    empty.restoreFolds()
    assert.strictEqual(store.get(KEY), JSON.stringify(['bunknown1']), 'intermediate content must not overwrite the stored preference')
    // 2) 之后真正的内容替换完成，同一条偏好可以恢复出折叠位
    const ready = fakeEditor(headingDoc('bh1', 'a-body'))
    store.set(KEY, JSON.stringify(['bh1']))
    ready.restoreFolds()
    assert.deepStrictEqual(Array.from(ready.editor.storage.larkDoc.folded), ['bh1'])
    assert.strictEqual(store.get(KEY), JSON.stringify(['bh1']))
    // 3) 用户主动展开全部：此时文档有标题，空集合要如实写盘
    ready.editor.storage.larkDoc.folded.clear()
    ready.persistFolds()
    assert.strictEqual(store.get(KEY), '[]', 'unfolding everything must persist an empty preference')
    // 4) 文档里根本没有标题时不写盘（回到中间态也不会误伤）
    store.set(KEY, JSON.stringify(['bh1']))
    fakeEditor(doc([p('no heading at all')])).persistFolds()
    assert.strictEqual(store.get(KEY), JSON.stringify(['bh1']))
    // 5) 旧版「层级+文本+同名序号」偏好在读取时迁移成 blockId 并写回
    store.set(KEY, JSON.stringify([legacyKey]))
    fakeEditor(headingDoc('bh9', 'a-body')).restoreFolds()
    assert.strictEqual(store.get(KEY), JSON.stringify(['bh9']), 'legacy preference keys migrate to block ids on read')
  } finally {
    global.window = previousWindow
  }
})
check('Block hover targets resolve one parent/child scope at a time', () => {
  const document = doc([
    p('plain'),
    { type: 'callout', content: [p('callout-body')] },
    { type: 'blockquote', content: [p('quote-body')] },
    {
      type: 'bulletList',
      content: [{
        type: 'listItem',
        content: [p('item-one'), { type: 'bulletList', content: [{ type: 'listItem', content: [p('nested-item')] }] }],
      }],
    },
    { type: 'codeBlock', content: [text('const answer = 42')] },
    {
      type: 'table',
      content: [{
        type: 'tableRow',
        content: [
          { type: 'tableCell', content: [p('cell-a')] },
          { type: 'tableCell', content: [p('cell-b')] },
        ],
      }],
    },
  ])
  const textPos = (value) => {
    let found = -1
    document.descendants((node, pos) => { if (found < 0 && node.isTextblock && node.textContent === value) found = pos + 1 })
    return found
  }
  const target = (value) => resolveBlockTargetRange(document, textPos(value))
  const typeAt = (range) => document.nodeAt(range.from).type.name
  // 普通段落：只命中自己，容器标记为空
  assert.strictEqual(typeAt(target('plain')), 'paragraph')
  assert.strictEqual(target('plain').container, null)
  // 整块容器（callout / blockquote）只暴露容器句柄，内部段落不单独成为目标
  const callout = target('callout-body')
  assert.strictEqual(typeAt(callout), 'callout')
  assert.strictEqual(callout.container, 'callout')
  assert.strictEqual(typeAt(target('quote-body')), 'blockquote')
  assert.strictEqual(target('quote-body').container, 'blockquote')
  // 列表命中当前 item；嵌套 item 的句柄不扩大到父项
  const item = target('item-one')
  assert.strictEqual(typeAt(item), 'listItem')
  assert(document.nodeAt(item.from).textContent.includes('item-one'))
  const nested = target('nested-item')
  assert.strictEqual(typeAt(nested), 'listItem')
  assert.strictEqual(document.nodeAt(nested.from).textContent, 'nested-item', 'nested item hover must not expand to its parent item')
  // 代码块按原子块、表格按整表命中（单元格不抢句柄）
  assert.strictEqual(typeAt(target('const answer = 42')), 'codeBlock')
  assert.strictEqual(typeAt(target('cell-a')), 'table')
  assert.strictEqual(target('cell-a').container, 'table')
  assert.strictEqual(target('cell-a').from, target('cell-b').from, 'both cells resolve to the same table target')
})
check('Slash suppresses composition, Escape and readonly states', () => {
  const notifications = []
  const extension = createLarkDocExtensions({ onSlash: (match) => notifications.push(match) }).find((ext) => ext.name === 'larkDoc')
  const editor = { isEditable: true }
  const plugin = extension.config.addProseMirrorPlugins.call({ storage: extension.config.addStorage(), editor })[0]
  const document = doc([p('/x')])
  const view = { state: EditorState.create({ schema, doc: document, selection: TextSelection.create(document, 3), plugins: [plugin] }), composing: false }
  const lifecycle = plugin.spec.view(view)
  assert.deepStrictEqual(notifications.pop(), { from: 1, to: 3, query: 'x' })
  view.composing = true
  lifecycle.update(view)
  assert.strictEqual(notifications.pop(), null)
  view.composing = false
  lifecycle.update(view)
  plugin.props.handleKeyDown(view, { key: 'Escape' })
  assert.strictEqual(notifications.pop(), null)
  view.state = view.state.apply(view.state.tr.insertText('y'))
  lifecycle.update(view)
  assert.strictEqual(notifications.pop().query, 'xy')
  editor.isEditable = false
  lifecycle.update(view)
  assert.strictEqual(notifications.pop(), null)
})
check('One undo restores all blocks moved by one drag operation', () => {
  const editor = editorFor(doc([p('a'), p('b'), p('c')]))
  editor.state = editor.state.reconfigure({ plugins: [history()] })
  assert(moveBlockRange(editor, 0, 6, 9))
  assert(undo(editor.state, editor.view.dispatch))
  assert.strictEqual(editor.state.doc.textContent, 'abc')
})
check('Moving a sole column paragraph leaves a valid empty block and undoes once', () => {
  const original = doc([{ type: 'columns', content: [
    { type: 'column', content: [p('a')] }, { type: 'column', content: [p('b')] },
  ] }])
  const editor = editorFor(original)
  editor.state = editor.state.reconfigure({ plugins: [history()] })
  assert(moveBlockRange(editor, 2, 5, 7))
  assert.strictEqual(editor.state.doc.firstChild.firstChild.textContent, '')
  assert.strictEqual(editor.state.doc.firstChild.lastChild.textContent, 'ab')
  assert(undo(editor.state, editor.view.dispatch))
  assert(editor.state.doc.eq(original))
})
check('Image resize/caption changes use document attributes and honor readonly', () => {
  withDom(() => {
    const { clampImageWidth } = require(path.join(sourceRoot, 'core/nodeviews/image.js'))
    assert.strictEqual(clampImageWidth(40), 40, '手柄拖到最窄时仍要成立')
    assert.strictEqual(clampImageWidth(2400), 2400)
    assert.strictEqual(clampImageWidth(39), null)
    assert.strictEqual(clampImageWidth(2401), null)
    assert.strictEqual(clampImageWidth('600px'), null, '带单位的裸值必须先剥单位再校验')

    const { editor, nodeView, emit } = imageNodeViewFor({ src: 'data:image/png;base64,aGVsbG8=', width: 200 })
    assert.strictEqual(nodeView.setWidth(320), true)
    assert.strictEqual(editor.state.doc.firstChild.attrs.width, 320)
    assert.strictEqual(nodeView.setCaption('说明'), true)
    assert.strictEqual(editor.state.doc.firstChild.attrs.caption, '说明')
    assert.strictEqual(nodeView.setAlign('right'), true)
    assert.strictEqual(editor.state.doc.firstChild.attrs.align, 'right')
    // 越界/非法宽度只反馈错误，不写文档。
    assert.strictEqual(nodeView.setWidth(10), false)
    assert.strictEqual(editor.state.doc.firstChild.attrs.width, 320)
    editor.isEditable = false
    emit('transaction')
    nodeView.mountToolbar()
    assert.strictEqual(nodeView.dom.querySelector('.lark-doc-image-toolbar'), null, '只读态不得挂载工具条')
    assert.strictEqual(nodeView.setWidth(500), false)
    assert.strictEqual(nodeView.setCaption('bad'), false)
    assert.strictEqual(nodeView.reset(), false)
    assert.strictEqual(editor.state.doc.firstChild.attrs.width, 320)
    assert.strictEqual(editor.state.doc.firstChild.attrs.caption, '说明')
  })
})
check('Resetting a cropped ECS image restores the attachment matching the original URL', () => {
  withDom(() => {
    const { editor, nodeView } = imageNodeViewFor({ src: 'https://example.com/cropped.png', attchId: 'cropped', originalSrc: 'https://example.com/original.png', originalAttchId: 'original' })
    assert.strictEqual(nodeView.reset(), true)
    assert.strictEqual(editor.state.doc.firstChild.attrs.src, 'https://example.com/original.png')
    assert.strictEqual(editor.state.doc.firstChild.attrs.attchId, 'original')
    // 没有原始映射时重置按钮与入口都必须失效。
    const plain = imageNodeViewFor({ src: 'https://example.com/only.png', attchId: 'only' })
    assert.strictEqual(plain.nodeView.reset(), false)
    assert.strictEqual(plain.editor.state.doc.firstChild.attrs.src, 'https://example.com/only.png')
  })
})
check('Code blocks indent as a box, capped at the LarkDoc nesting limit', () => {
  const component = loadComponent('LarkDocEditor.vue')
  const code = schema.nodes.codeBlock.create({ language: 'javascript' }, schema.text('x'))
  assert.strictEqual(code.attrs.indent, 0, 'code blocks default to the base level like LarkDoc')
  const indented = schema.nodes.codeBlock.create({ language: 'javascript', indent: 3 }, schema.text('x'))
  const rendered = schema.nodes.codeBlock.spec.toDOM(indented, () => {})
  assert.strictEqual(rendered[1]['data-indent'], 3, 'the indent level renders into HTML for export/round-trip')
  const parsed = validateDocument({ type: 'doc', content: [{ type: 'codeBlock', attrs: { language: 'javascript', indent: 4 }, content: [text('x')] }] }, schema)
  assert.strictEqual(parsed.content[0].attrs.indent, 4, 'JSON round-trips keep the nesting level')
  // 上限：飞书最深层是 6 层（5 级缩进，每级 25px），配置不能超过它。
  const { createLarkDocConfig } = require(path.join(root, 'larkDocConfig.js'))
  assert.strictEqual(createLarkDocConfig({ limits: { maxIndent: 99 } }).limits.maxIndent, 5)
  assert.strictEqual(createLarkDocConfig({}).limits.maxIndent, 5)
  // 块菜单的「增加缩进」要能找到代码块目标（文本对齐仍只认段落/标题）。
  const document = doc([{ type: 'codeBlock', content: [text('nested')] }])
  const context = { editor: { state: { doc: document } }, blockTextblockTarget: component.methods.blockTextblockTarget }
  const target = component.methods.blockIndentTarget.call(context, { from: 0, to: document.firstChild.nodeSize })
  assert(target && target.node.type.name === 'codeBlock', 'code blocks are valid indent targets')
  assert.strictEqual(component.methods.blockTextblockTarget.call(context, { from: 0, to: document.firstChild.nodeSize }), null, 'text alignment stays limited to text blocks')
})

check('Block indent stops at the LarkDoc cap on every entry point', () => {
  const ops = require(path.join(root, 'documentOperations.js'))
  assert.strictEqual(ops.clampBlockIndent(8), 5, 'anything above the LarkDoc nesting limit collapses to 5')
  assert.strictEqual(ops.clampBlockIndent(-3), 0)
  assert.strictEqual(ops.clampBlockIndent('3'), 3)
  assert.strictEqual(ops.clampBlockIndent(4, 2), 2, 'a host can lower the cap')
  assert.strictEqual(ops.clampBlockIndent(4, 99), 4, 'a host cannot raise it above the LarkDoc limit')

  // 段落缩进必须缩整块（margin），和代码块一致；padding 会把盒子留在整列宽。
  const paragraph = schema.nodes.paragraph.create({ indent: 2 }, schema.text('x'))
  const dom = schema.nodes.paragraph.spec.toDOM(paragraph, () => {})
  const style = String(dom[1].style || '')
  assert(style.includes(`margin-left: ${2 * ops.INDENT_STEP_PX}px`), `paragraph indent must shift the block box, got: ${style}`)
  assert(!style.includes('padding-left'), 'padding-left would keep the block full-width and break hover geometry')

  // 老 JSON / 外部内容里超上限的缩进要被归一，避免「减一级没反应」。
  const legacy = doc([pi('legacy', 8), pi('ok', 2)])
  const fixes = ops.collectIndentFixes(legacy)
  assert.strictEqual(fixes.length, 1)
  assert.strictEqual(fixes[0].indent, 5)
  assert.strictEqual(ops.collectIndentFixes(doc([pi('ok', 5)])).length, 0)

  // 工具栏 / 气泡菜单共用 changeIndent：到顶后不再写事务（否则看起来能一直点）。
  const component = loadComponent('LarkDocEditor.vue')
  const editor = editorFor(doc([pi('a', 4)]))
  const writes = []
  const vm = {
    editor,
    writable: () => true,
    maxBlockIndent: 5,
    blockIndentNode: component.methods.blockIndentNode,
    blockIndentPos: component.methods.blockIndentPos,
    setBlockAttribute(name, value) {
      writes.push([name, value])
      const at = this.blockIndentPos()
      const node = this.editor.state.doc.nodeAt(at)
      this.editor.view.dispatch(this.editor.state.tr.setNodeMarkup(at, null, { ...node.attrs, [name]: value }))
    },
  }
  // 第一个块没有前兄弟 → 增加缩进一级都加不了（真飞书菜单同样是灰的）。
  vm.editor = editorFor(doc([pi('a', 0)]), TextSelection.create(doc([pi('a', 0)]), 1))
  for (let i = 0; i < 3; i += 1) component.methods.changeIndent.call(vm, 1)
  assert.deepStrictEqual(writes, [], 'the first block cannot be indented at all')

  // 第二个块最多缩到「前一个块 + 1」；到顶后的点击全部丢弃。
  const pair = doc([pi('a', 0), pi('b', 0)])
  vm.editor = editorFor(pair, TextSelection.create(pair, pair.firstChild.nodeSize + 1))
  for (let i = 0; i < 4; i += 1) component.methods.changeIndent.call(vm, 1)
  assert.deepStrictEqual(writes.map(([, value]) => value), [1], 'indent stops at previousBlock + 1')

  // 减少缩进不受前块限制：从超限的老数据也能一路减回 0 并停住。
  writes.length = 0
  const deep = doc([pi('a', 4)])
  vm.editor = editorFor(deep, TextSelection.create(deep, 1))
  for (let i = 0; i < 9; i += 1) component.methods.changeIndent.call(vm, -1)
  assert.deepStrictEqual(writes.map(([, value]) => value), [3, 2, 1, 0], 'outdent floors at 0 and stops')
})

check('Block indent ceiling follows the previous block (LarkDoc tree model)', () => {
  const ops = require(path.join(root, 'documentOperations.js'))
  const posOfText = (document, value) => {
    let found = -1
    document.descendants((node, pos) => { if (node.isTextblock && node.textContent === value) found = pos })
    return found
  }

  // 顶层四块：第一个块无前兄弟 → 0；之后是「前一个块 + 1」。
  const flat = doc([p('a'), p('b'), pi('c', 2), p('d')])
  assert.strictEqual(ops.maxIndentAt(flat, posOfText(flat, 'a')), 0, '第一个块一级都缩不了')
  assert.strictEqual(ops.maxIndentAt(flat, posOfText(flat, 'b')), 1)
  assert.strictEqual(ops.maxIndentAt(flat, posOfText(flat, 'c')), 1, '前一个块是 0 级 → 上限 1')
  assert.strictEqual(ops.maxIndentAt(flat, posOfText(flat, 'd')), 3, '前一个块 2 级 → 上限 3')
  // 位置落在块内部（光标在文字里）也能算，取块起点所在容器。
  assert.strictEqual(ops.maxIndentAt(flat, posOfText(flat, 'd') + 1), 3)
  assert.strictEqual(ops.maxIndentAt(flat, -1), 0)
  assert.strictEqual(ops.maxIndentAt(flat, flat.content.size + 5), 0)

  // 列表项内部：代码块的前兄弟是 item 首段落（0 级）→ 上限 1。
  // 这正是真飞书截图里「代码块缩进一级后菜单提示已达最大缩进层级」的情形。
  const nested = doc([{
    type: 'orderedList',
    attrs: { start: 1 },
    content: [{ type: 'listItem', content: [p('b. 4'), { type: 'codeBlock', attrs: { indent: 1 }, content: [text('1')] }] }],
  }])
  let codePos = -1
  nested.descendants((node, pos) => { if (node.type.name === 'codeBlock') codePos = pos })
  assert.strictEqual(ops.maxIndentAt(nested, codePos), 1)
  assert.strictEqual(ops.stepBlockIndent(nested, codePos, 1, 1), 1, '已经到顶时增加缩进是空操作，不会反向归零')
  assert.strictEqual(ops.stepBlockIndent(nested, codePos, 1, -1), 0, '减少缩进不受前块限制')
  assert.strictEqual(ops.stepBlockIndent(nested, codePos, 0, -1), 0, '减少缩进在 0 停住')

  // 硬上限仍然生效：前块 5 级时，后块最多到 5（不是 6）。
  const deep = doc([pi('a', 5), p('b')])
  assert.strictEqual(ops.maxIndentAt(deep, posOfText(deep, 'b')), 5)
  assert.strictEqual(ops.stepBlockIndent(deep, posOfText(deep, 'b'), 5, 1), 5)

  // 老数据超顶时，增加缩进原地不动（不能把 4 级一下打到 0）。
  const over = doc([pi('a', 4)])
  assert.strictEqual(ops.stepBlockIndent(over, 0, 4, 1), 4)
})

check('Indent keyboard shortcuts follow the same previous-block ceiling', () => {
  const extensions = createLarkDocExtensions()
  const extension = extensions.find((item) => item.name === 'larkDocFormatting')
  assert(extension, '缺少 larkDocFormatting 扩展（缩进快捷键挂在这里）')
  const calls = []
  const mock = {
    isEditable: true,
    view: { composing: false },
    isActive: () => false,
    chain: () => {
      const api = { focus: () => api, updateAttributes: (type, attrs) => { calls.push([type, attrs]); return api }, run: () => true }
      return api
    },
  }
  const shortcuts = extension.config.addKeyboardShortcuts.call({ editor: mock })
  assert(typeof shortcuts['Mod-]'] === 'function' && typeof shortcuts['Mod-['] === 'function', '⌘] / ⌘[ 必须存在')

  const useDoc = (document) => {
    const selection = TextSelection.create(document, document.firstChild.nodeSize + 1)
    mock.state = EditorState.create({ schema, doc: document, selection })
  }

  // 前块 0 级 → 后块最多 1 级
  useDoc(doc([p('a'), p('b')]))
  shortcuts['Mod-]']()
  assert.deepStrictEqual(calls.map(([, attrs]) => attrs.indent), [1], '第二个块能缩 1 级')

  // 已经是 1 级 → 到顶，不再派发事务（否则会出现「点了没反应但进了撤销栈」）
  calls.length = 0
  useDoc(doc([p('a'), pi('b', 1)]))
  shortcuts['Mod-]']()
  assert.deepStrictEqual(calls, [], '到顶后不再写事务')

  // 减少缩进不受前块限制，能从 1 减到 0，再减就停住
  calls.length = 0
  useDoc(doc([p('a'), pi('b', 1)]))
  shortcuts['Mod-[']()
  useDoc(doc([p('a'), pi('b', 0)]))
  shortcuts['Mod-[']()
  assert.deepStrictEqual(calls.map(([, attrs]) => attrs.indent), [0], '减少缩进到 0 后停住')
})

/**
 * 按 tiptap 的装配签名构造代码块 NodeView。阶段 2 起代码块与图片一样是 core 的
 * 纯 DOM 实现（src/core/nodeviews/code-block.js），不再是 Vue SFC —— 这里照
 * imageNodeViewFor 的方式装配，断言打在 EditorState 与 NodeView 自己画的 DOM 上。
 */
function codeNodeViewFor(attrs, options = {}) {
  const { createCodeBlockNodeView } = require(path.join(sourceRoot, 'core/nodeviews/code-block.js'))
  const source = options.text != null ? options.text : 'const value = "<script>"'
  const editor = editorFor(doc([{ type: 'codeBlock', attrs, content: [text(source)] }]))
  editor.isEditable = options.editable !== false
  const listeners = { transaction: [], update: [] }
  editor.on = (name, fn) => { listeners[name].push(fn); return editor }
  editor.off = (name, fn) => { listeners[name] = listeners[name].filter((item) => item !== fn); return editor }
  const emit = (name) => listeners[name].slice().forEach((fn) => fn())
  let nodeView = null
  const view = {
    get state() { return editor.state },
    dispatch(tr) {
      editor.state = editor.state.apply(tr)
      if (nodeView) nodeView.update(editor.state.doc.firstChild)
      emit('transaction')
      emit('update')
    },
  }
  nodeView = createCodeBlockNodeView({
    editor, view, node: editor.state.doc.firstChild, getPos: () => 0,
    extension: { options: options.extensionOptions || {} },
  })
  return { editor, nodeView, view, emit }
}
const codeHighlightHtml = (nodeView) => nodeView.dom.querySelector('.lark-doc-code-highlight code').innerHTML

check('Code language changes preserve code and highlighting escapes HTML', () => {
  withDom(() => {
    const { editor, nodeView, emit } = codeNodeViewFor({})
    // 懒加载未落地前：高亮层必须是转义后的文本，绝不能出现可执行标签。
    assert(!codeHighlightHtml(nodeView).includes('<script>'), 'Before the lazy highlighter resolves, code must remain escaped')
    assert.strictEqual(nodeView.setLanguage('javascript'), true)
    assert.strictEqual(editor.state.doc.firstChild.attrs.language, 'javascript')
    assert.strictEqual(editor.state.doc.firstChild.textContent, 'const value = "<script>"')
    assert(!codeHighlightHtml(nodeView).includes('<script>'))
    // 语言清单之外的值一律拒绝，别把脏语言写进文档。
    assert.strictEqual(nodeView.setLanguage('rm -rf'), false)
    assert.strictEqual(editor.state.doc.firstChild.attrs.language, 'javascript')
    // 只读态：NodeView 经 transaction 同步 editable 后，改语言必须被挡住。
    editor.isEditable = false
    emit('transaction')
    assert.strictEqual(nodeView.getState().editable, false)
    assert.strictEqual(nodeView.setLanguage('python'), false)
    assert.strictEqual(editor.state.doc.firstChild.attrs.language, 'javascript')
    nodeView.destroy()
  })
})
async function checkCodeHighlightLazy() {
  const close = openDom()
  try {
    const { nodeView } = codeNodeViewFor({ language: 'javascript' })
    await new Promise(resolve => setTimeout(resolve, 40))
    const html = codeHighlightHtml(nodeView)
    assert(html.includes('hljs-keyword'), 'The highlighter should load after a code block is rendered')
    assert(!html.includes('<script>'))
    nodeView.destroy()
  } finally { close() }
  console.log('PASS CodeNode lazy-loads highlight.js core and escapes the fallback')
}
async function checkEcsUploadBoundary() {
  const component = loadComponent('LarkDocEditor.vue')
  assert.strictEqual(typeof component.methods.resolveImageFile, 'function', 'Missing reusable ECS upload boundary')
  const file = { type: 'image/png', size: 10, name: 'test.png' }
  let uploaded = 0
  const vm = { imageMaxSize: 20, writable: () => true, uploadImage: async () => { uploaded += 1; return { url: 'https://example.com/upload.png', attchId: 42 } } }
  const result = await component.methods.resolveImageFile.call(vm, file)
  assert.deepStrictEqual(result, { src: 'https://example.com/upload.png', attchId: '42' })
  await assert.rejects(component.methods.resolveImageFile.call(vm, { ...file, size: 21 }))
  assert.strictEqual(uploaded, 1, 'Oversized images must be rejected before calling ECS upload')
  await assert.rejects(component.methods.resolveImageFile.call(vm, { ...file, type: 'image/svg+xml' }))
  vm.uploadImage = async () => { throw new Error('Upload failed') }
  await assert.rejects(component.methods.resolveImageFile.call(vm, file), /Upload failed/)
  vm.uploadImage = async () => ({ url: 'javascript:alert(1)', attchId: 'bad' })
  await assert.rejects(component.methods.resolveImageFile.call(vm, file))
  let complete
  vm.uploadImage = () => new Promise((resolve) => { complete = resolve })
  const pending = component.methods.resolveImageFile.call(vm, file)
  vm.writable = () => false
  complete({ url: 'https://example.com/late.png', attchId: 'late' })
  assert.strictEqual(await pending, null, 'Read mode or route teardown must discard late upload results')
  console.log('PASS ECS upload validates type/size/result, preserves errors and discards late results')
}

async function checkEcsCropBoundary() {
  const close = openDom()
  const { window: domWindow } = global
  // Node 核心测试仅替代解码 / canvas I/O；正文、schema、裁剪区域校验与裁剪后
  // 元数据更新全部跑实际代码（src/core/nodeviews/image.js）。
  domWindow.Image = class {
    constructor() { this.naturalWidth = 100; this.naturalHeight = 100 }
    set src(value) { this.currentSrc = value; if (this.onload) this.onload() }
  }
  domWindow.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} })
  domWindow.HTMLCanvasElement.prototype.toBlob = (callback) => callback(new domWindow.Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }))
  let uploaded = 0
  const { editor, nodeView } = imageNodeViewFor(
    { src: 'https://example.com/original.png', attchId: 'original' },
    { resolveImageFile: async (file) => { uploaded += 1; assert(file && file.type === 'image/png', '裁剪结果必须以 PNG 走宿主上传'); return { src: 'https://example.com/crop.png', attchId: 'crop-42' } } },
  )
  try {
    assert.strictEqual(nodeView.openCrop(), true, '可编辑态下裁剪入口必须能打开对话框')
    // 越界区域不产生裁剪、也不得发起上传。
    nodeView.setCropArea({ x: 60, y: 0, width: 60, height: 50 })
    assert.strictEqual(await nodeView.applyCrop(), false)
    assert.strictEqual(uploaded, 0, '非法裁剪区域不得走到上传')
    nodeView.setCropArea({ x: 10, y: 10, width: 50, height: 50 })
    assert.strictEqual(await nodeView.applyCrop(), true)
    assert.strictEqual(uploaded, 1)
    assert.strictEqual(editor.state.doc.firstChild.attrs.src, 'https://example.com/crop.png')
    assert.strictEqual(editor.state.doc.firstChild.attrs.attchId, 'crop-42')
    assert.strictEqual(editor.state.doc.firstChild.attrs.originalSrc, 'https://example.com/original.png')
    assert.strictEqual(editor.state.doc.firstChild.attrs.originalAttchId, 'original')
    // 裁剪后可重置回原图，原映射跟着回到原附件。
    assert.strictEqual(nodeView.reset(), true)
    assert.strictEqual(editor.state.doc.firstChild.attrs.src, 'https://example.com/original.png')
    assert.strictEqual(editor.state.doc.firstChild.attrs.attchId, 'original')
  } finally {
    nodeView.destroy()
    close()
  }
  console.log('PASS ECS crop updates the URL and attachment together and retains the original mapping')
}

// 可选的 DOM 回归使用已运行的真实页面；不模拟 DOM selector/remove/replaceWith 语义。
if (process.argv.includes('--browser-sanitizer')) {
  const browserSanitizerCheck = function browserSanitizerCheck() {
    const component = document.querySelector('.lark-doc').__vue__
    const editor = component.getEditor()
    const original = component.getJSON()
    const assertBrowser = (condition, message) => { if (!condition) throw new Error(message) }
    const sanitize = (html) => {
      let result = html
      let transforms = 0
      editor.view.someProp('transformPastedHTML', (handler) => { result = handler(result, editor.view); transforms += 1; return false })
      assertBrowser(transforms > 0 && typeof result === 'string', 'Missing real clipboard HTML sanitizer')
      return result
    }
    try {
      const originalText = component.getText()
      component.setContent(original)
      assertBrowser(component.getText() === originalText, 'Initial getJSON → public setContent must preserve canonical document content')
      const wrappers = '<section><article><header><main>前缀<p>正文<strong onclick="alert(1)">加粗</strong><a href="javascript:alert(1)" onmouseover="alert(1)">链接</a></p>后缀</main></header></article></section>'
      const safe = sanitize(wrappers)
      const parsed = new DOMParser().parseFromString(safe, 'text/html')
      assertBrowser(parsed.body.textContent === '前缀正文加粗链接后缀', 'Ordinary unsupported wrappers must preserve safe descendants and text')
      assertBrowser(parsed.querySelector('p strong')?.textContent === '加粗', 'Safe strong formatting must survive wrapper sanitization')
      assertBrowser(!parsed.querySelector('[onclick], [onmouseover], a[href]'), 'Unsafe handlers and link protocols must be removed')
      component.setContent(wrappers)
      assertBrowser(component.getText().includes('正文加粗链接'), 'Public setContent must preserve nested safe paragraph text')
      assertBrowser(component.getHTML().includes('<strong>加粗</strong>'), 'Public setContent must preserve strong formatting')
      const hostile = '<section><p>安全正文</p><script>unsafeScript</script><style>unsafeStyle</style><iframe>unsafeFrame</iframe><object><p>unsafeObject</p></object><embed src="https://example.com/unsafe"><svg><foreignObject><p>unsafeSVG</p></foreignObject></svg></section>'
      const cleaned = sanitize(hostile)
      const hostileDOM = new DOMParser().parseFromString(cleaned, 'text/html')
      assertBrowser(hostileDOM.body.textContent === '安全正文', 'Dangerous active/embed/SVG subtrees must be removed entirely')
      assertBrowser(!hostileDOM.querySelector('script,style,iframe,object,embed,svg'), 'Dangerous tags must not survive')
      component.setContent(hostile)
      assertBrowser(component.getText().trim() === '安全正文', 'Public import must keep safe text and exclude unsafe subtrees')
      return 'PASS browser sanitizer wrappers, formatting, hostile subtrees, attributes, initial JSON roundtrip and public setContent'
    } finally { component.setContent(original) }
  }
  const { spawnSync } = require('child_process')
  // 浏览器控制器显式使用已安装的 Node 22；业务代码与核心测试仍使用项目固定的 Node 14。
  const result = spawnSync('/Users/cjjxw/.nvm/versions/node/v22.13.0/bin/node', [
    '/Users/cjjxw/.nvm/versions/node/v22.13.0/lib/node_modules/@playwright/cli/playwright-cli.js',
    '--session', 'schema-fix', 'run-code', `async (page) => await page.evaluate(${browserSanitizerCheck.toString()})`,
  ], { cwd: '/tmp', encoding: 'utf8', env: { ...process.env, PATH: `/Users/cjjxw/.nvm/versions/node/v22.13.0/bin:${process.env.PATH}` } })
  process.stdout.write(result.stdout || '')
  process.stderr.write(result.stderr || '')
  assert.strictEqual(result.status, 0, 'Installed browser controller must execute successfully')
  assert(!result.stdout.includes('### Error'), 'Browser sanitizer regression failed; see real DOM failure above')
  assert(result.stdout.includes('PASS browser sanitizer'), 'Browser regression must return a successful behavioral result')
}

checkCodeHighlightLazy().then(checkEcsUploadBoundary).then(checkEcsCropBoundary).then(() => console.log('LarkDoc core checks passed')).catch((error) => { console.error(error); process.exitCode = 1 })
