'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '../src/components/feishu')
const originalLoader = require.extensions['.js']
require.extensions['.js'] = (module, filename) => {
  if (filename.startsWith(root + path.sep)) {
    const { code } = require('@babel/core').transformSync(fs.readFileSync(filename, 'utf8'), {
      babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-modules-commonjs'],
    })
    module._compile(code, filename)
  } else originalLoader(module, filename)
}
assert(fs.existsSync(path.join(root, 'extensions.js')), 'Missing Feishu schema: H9 and serializable blocks are not implemented')
const { createFeishuExtensions } = require(path.join(root, 'extensions.js'))
const { safeUrl, validateDocument, getSlashMatch, findTextMatches, replaceText, moveBlockRange, collectOutline } = require(path.join(root, 'documentOperations.js'))
const { createFeishuConfig, isCommandEnabled, isBlockActionEnabled } = require(path.join(root, 'feishuConfig.js'))
const { filterCommands } = require(path.join(root, 'commands.js'))
const { getSchema, getExtensionField } = require('@tiptap/core')
const { EditorState, TextSelection } = require('@tiptap/pm/state')
const { history, undo } = require('@tiptap/pm/history')
const schema = getSchema(createFeishuExtensions())
function loadComponent(name) {
  const { parseComponent } = require('vue-template-compiler')
  const filename = path.join(root, name)
  const Module = require('module')
  const module = new Module(filename)
  module.filename = filename
  module.paths = Module._nodeModulePaths(root)
  const sfc = parseComponent(fs.readFileSync(filename, 'utf8'))
  const { code } = require('@babel/core').transformSync(sfc.script.content, { babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-modules-commonjs'] })
  const originalVueLoader = require.extensions['.vue']
  const originalCssLoader = require.extensions['.css']
  require.extensions['.vue'] = (child, childPath) => { child.exports = loadComponent(path.basename(childPath)) }
  require.extensions['.css'] = () => {}
  try { module._compile(code, filename); return module.exports.default }
  finally { require.extensions['.vue'] = originalVueLoader; require.extensions['.css'] = originalCssLoader }
}
const text = (value, marks) => ({ type: 'text', text: value, ...(marks ? { marks } : {}) })
const p = (value) => ({ type: 'paragraph', content: value ? [text(value)] : [] })
const doc = (content) => schema.nodeFromJSON({ type: 'doc', content })
function editorFor(document, selection) {
  const editor = { isEditable: true, state: EditorState.create({ schema, doc: document, selection }) }
  editor.view = { dispatch: (tr) => { editor.state = editor.state.apply(tr) } }
  return editor
}
function check(name, fn) { fn(); console.log(`PASS ${name}`) }

check('Public Feishu config gates features, commands, block actions and limits', () => {
  const config = createFeishuConfig({
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
})

check('ECS character limit uses the official filter, counts Unicode, and keeps over-limit initial text intact', () => {
  const extension = createFeishuExtensions({ maxLength: 3 }).find((ext) => ext.name === 'characterCount')
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
  assert.strictEqual(createFeishuExtensions().find((ext) => ext.name === 'characterCount').options.limit, 0)
})
check('Changing ECS maxLength updates the official filter without replacing or trimming the document', () => {
  const extension = createFeishuExtensions().find((ext) => ext.name === 'characterCount')
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
  const component = loadComponent('FeishuDocumentEditor.vue')
  const editor = editorFor(doc([p('old')]))
  editor.schema = schema
  const extension = createFeishuExtensions({ maxLength: 3 }).find((ext) => ext.name === 'characterCount')
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
  const extension = createFeishuExtensions({ onImageFiles: (files, pos) => calls.push({ files, pos }) }).find((ext) => ext.name === 'fileHandler')
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
check('JSON rejects unknown nodes, malformed structure and hostile attributes before replacement', () => {
  for (const content of [
    [{ type: 'unknown' }], [{ type: 'text', text: 'orphan' }],
    [{ type: 'image', attrs: { src: 'javascript:alert(1)' } }],
    [{ type: 'paragraph', attrs: { indent: -1 } }],
    [{ type: 'heading', attrs: { level: 10 } }],
    [{ type: 'paragraph', content: [text('x', [{ type: 'link', attrs: { href: 'data:text/html,bad' } }])] }],
    [{ type: 'columns', content: [{ type: 'column', content: [p('a')] }] }],
  ]) assert.throws(() => validateDocument({ type: 'doc', content }, schema))
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
  assert.deepStrictEqual(collectOutline(document), [{ pos: 0, level: 1, text: 'A' }, { pos: 10, level: 9, text: 'B' }])
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
  const extension = createFeishuExtensions().find((ext) => ext.name === 'feishuDocument')
  const storage = extension.config.addStorage()
  const context = { storage, editor: { isEditable: true } }
  const plugin = extension.config.addProseMirrorPlugins.call(context)[0]
  const commands = extension.config.addCommands.call(context)
  let state = EditorState.create({ schema, doc: doc([
    { type: 'heading', attrs: { level: 1 }, content: [text('A')] }, p('hidden'),
    { type: 'heading', attrs: { level: 1 }, content: [text('B')] }, p('visible'),
  ]), plugins: [plugin] })
  const command = (fn) => { const tr = state.tr; assert(fn({ tr, dispatch: () => {} })); state = state.apply(tr) }
  command(commands.toggleFeishuFold(0))
  assert(storage.folded.has(0))
  assert(plugin.props.decorations(state).find().some((item) => item.from === 3 && item.to === 11))
  command(commands.setFeishuSearch('hidden', 0))
  assert(plugin.props.decorations(state).find().some((item) => item.from === 4 && item.to === 10))
  command(commands.revealFeishuMatch(4, 10))
  assert.strictEqual(storage.folded.size, 0)
  command(commands.toggleFeishuFold(0))
  state = state.apply(state.tr.insert(0, schema.nodes.paragraph.create()))
  assert(storage.folded.has(2))
})
check('Slash suppresses composition, Escape and readonly states', () => {
  const notifications = []
  const extension = createFeishuExtensions({ onSlash: (match) => notifications.push(match) }).find((ext) => ext.name === 'feishuDocument')
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
  assert(fs.existsSync(path.join(root, 'ImageNode.vue')), 'Missing image NodeView: resize/crop/preview/caption are not implemented')
  const { parseComponent } = require('vue-template-compiler')
  const sfc = parseComponent(fs.readFileSync(path.join(root, 'ImageNode.vue'), 'utf8'))
  const { code } = require('@babel/core').transformSync(sfc.script.content, { babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-modules-commonjs'] })
  const Module = require('module')
  const module = new Module(path.join(root, 'ImageNode.vue'))
  module.paths = Module._nodeModulePaths(root)
  module._compile(code, path.join(root, 'ImageNode.vue'))
  const component = module.exports.default
  const editor = editorFor(doc([{ type: 'image', attrs: { src: 'data:image/png;base64,aGVsbG8=', width: 200 } }]))
  const vm = {
    editor, node: editor.state.doc.firstChild, error: '',
    updateAttributes: (attrs) => { editor.view.dispatch(editor.state.tr.setNodeMarkup(0, null, { ...editor.state.doc.firstChild.attrs, ...attrs })) },
  }
  component.methods.setWidth.call(vm, 320)
  assert.strictEqual(editor.state.doc.firstChild.attrs.width, 320)
  component.methods.setCaption.call(vm, '说明')
  assert.strictEqual(editor.state.doc.firstChild.attrs.caption, '说明')
  editor.isEditable = false
  component.methods.setWidth.call(vm, 500)
  component.methods.setCaption.call(vm, 'bad')
  assert.strictEqual(editor.state.doc.firstChild.attrs.width, 320)
  assert.strictEqual(editor.state.doc.firstChild.attrs.caption, '说明')
})
check('Resetting a cropped ECS image restores the attachment matching the original URL', () => {
  const component = loadComponent('ImageNode.vue')
  const editor = editorFor(doc([{ type: 'image', attrs: { src: 'https://example.com/cropped.png', attchId: 'cropped', originalSrc: 'https://example.com/original.png', originalAttchId: 'original' } }]))
  const vm = { editor, node: editor.state.doc.firstChild, updateAttributes: (attrs) => editor.view.dispatch(editor.state.tr.setNodeMarkup(0, null, { ...editor.state.doc.firstChild.attrs, ...attrs })) }
  component.methods.resetImage.call(vm)
  assert.strictEqual(editor.state.doc.firstChild.attrs.src, 'https://example.com/original.png')
  assert.strictEqual(editor.state.doc.firstChild.attrs.attchId, 'original')
})
check('Code language changes preserve code and highlighting escapes HTML', () => {
  assert(fs.existsSync(path.join(root, 'CodeNode.vue')), 'Missing code NodeView: language/highlight/copy are not implemented')
  const { parseComponent } = require('vue-template-compiler')
  const sfc = parseComponent(fs.readFileSync(path.join(root, 'CodeNode.vue'), 'utf8'))
  const { code } = require('@babel/core').transformSync(sfc.script.content, { babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-modules-commonjs'] })
  const Module = require('module')
  const module = new Module(path.join(root, 'CodeNode.vue'))
  module.paths = Module._nodeModulePaths(root)
  module._compile(code, path.join(root, 'CodeNode.vue'))
  const component = module.exports.default
  const document = doc([{ type: 'codeBlock', content: [text('const value = "<script>"')] }])
  const editor = editorFor(document)
  const vm = { editor, node: editor.state.doc.firstChild, message: '', updateAttributes: (attrs) => editor.view.dispatch(editor.state.tr.setNodeMarkup(0, null, attrs)) }
  component.methods.setLanguage.call(vm, 'javascript')
  vm.node = editor.state.doc.firstChild
  assert.strictEqual(vm.node.attrs.language, 'javascript')
  assert.strictEqual(vm.node.textContent, 'const value = "<script>"')
  const html = component.computed.highlighted.call(vm)
  assert(!html.includes('<script>'), 'Before the lazy highlighter resolves, code must remain escaped')
  editor.isEditable = false
  component.methods.setLanguage.call(vm, 'python')
  assert.strictEqual(editor.state.doc.firstChild.attrs.language, 'javascript')
})
async function checkCodeHighlightLazy() {
  const component = loadComponent('CodeNode.vue')
  const document = doc([{ type: 'codeBlock', content: [text('const value = "<script>"')] }])
  const editor = editorFor(document)
  editor.view.dispatch(editor.state.tr.setNodeMarkup(0, null, { language: 'javascript' }))
  const vm = {
    editor, node: editor.state.doc.firstChild, message: '', highlightedCode: '',
    extension: { options: { syntaxHighlight: true } },
    updateAttributes: (attrs) => editor.view.dispatch(editor.state.tr.setNodeMarkup(0, null, attrs)),
  }
  vm.refreshHighlighted = () => component.methods.refreshHighlighted.call(vm)
  component.methods.refreshHighlighted.call(vm)
  await new Promise(resolve => setTimeout(resolve, 40))
  const html = component.computed.highlighted.call(vm)
  assert(html.includes('hljs-keyword'), 'The highlighter should load after a code block is rendered')
  assert(!html.includes('<script>'))
  console.log('PASS CodeNode lazy-loads highlight.js core and escapes the fallback')
}
async function checkEcsUploadBoundary() {
  const component = loadComponent('FeishuDocumentEditor.vue')
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
  const component = loadComponent('ImageNode.vue')
  const editor = editorFor(doc([{ type: 'image', attrs: { src: 'https://example.com/original.png', attchId: 'original' } }]))
  const originalGlobals = { Image: global.Image, File: global.File, document: global.document }
  // Node 核心测试仅替代解码/canvas I/O；正文、schema 与裁剪后元数据更新均运行实际代码。
  global.Image = class { constructor() { this.naturalWidth = 100; this.naturalHeight = 100 } set src(value) { this.onload() } }
  global.File = class { constructor(parts, name, options) { this.size = parts[0].size; this.name = name; this.type = options.type } }
  global.document = { createElement: () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/png;base64,aGVsbG8=', toBlob: (callback) => callback({ size: 10, type: 'image/png' }) }) }
  const vm = {
    editor, node: editor.state.doc.firstChild, busy: false, dialog: 'crop', cropGeneration: 0, crop: { x: 0, y: 0, width: 50, height: 50 },
    extension: { options: { resolveImageFile: async () => ({ src: 'https://example.com/crop.png', attchId: 'crop-42' }) } },
    updateAttributes: (attrs) => editor.view.dispatch(editor.state.tr.setNodeMarkup(0, null, { ...editor.state.doc.firstChild.attrs, ...attrs })),
    closeDialog() { this.dialog = ''; this.cropGeneration += 1; this.busy = false },
  }
  try {
    await component.methods.applyCrop.call(vm)
    assert.strictEqual(editor.state.doc.firstChild.attrs.src, 'https://example.com/crop.png')
    assert.strictEqual(editor.state.doc.firstChild.attrs.attchId, 'crop-42')
    assert.strictEqual(editor.state.doc.firstChild.attrs.originalSrc, 'https://example.com/original.png')
    assert.strictEqual(editor.state.doc.firstChild.attrs.originalAttchId, 'original')
  } finally { Object.assign(global, originalGlobals) }
  console.log('PASS ECS crop updates the URL and attachment together and retains the original mapping')
}

// 可选的 DOM 回归使用已运行的真实页面；不模拟 DOM selector/remove/replaceWith 语义。
if (process.argv.includes('--browser-sanitizer')) {
  const browserSanitizerCheck = function browserSanitizerCheck() {
    const component = document.querySelector('.feishu-document').__vue__
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

checkCodeHighlightLazy().then(checkEcsUploadBoundary).then(checkEcsCropBoundary).then(() => console.log('Feishu core checks passed')).catch((error) => { console.error(error); process.exitCode = 1 })
