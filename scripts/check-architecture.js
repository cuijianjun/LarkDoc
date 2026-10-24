'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const sourceRoot = path.resolve(__dirname, '../src')
const originalLoader = require.extensions['.js']
require.extensions['.js'] = (module, filename) => {
  if (!filename.startsWith(sourceRoot + path.sep)) return originalLoader(module, filename)
  const { code } = require('@babel/core').transformSync(fs.readFileSync(filename, 'utf8'), {
    babelrc: false,
    configFile: false,
    plugins: ['@babel/plugin-transform-modules-commonjs'],
  })
  module._compile(code, filename)
}

const schema = require('../src/core/documentSchema')
const metadata = require('../src/core/transactionMetadata')
const { createDocumentSession } = require('../src/session/DocumentSession')
const { createCollaborationProvider } = require('../src/providers/collaboration')
const { createCommentsProvider } = require('../src/providers/comments')

const json = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '正文' }] }] }
const record = schema.createDocumentRecord({ documentId: 'doc-1', content: json, title: '标题' })
assert.strictEqual(record.documentId, 'doc-1')
assert.strictEqual(record.schemaVersion, schema.DOCUMENT_SCHEMA_VERSION)
assert.deepStrictEqual(schema.getDocumentContent({ json }), json)
assert.throws(() => schema.normalizeDocumentRecord({ json: { type: 'script' } }), /有效正文/)

const transaction = {
  values: new Map(),
  setMeta(key, value) { this.values.set(key, value); return this },
  getMeta(key) { return this.values.get(key) },
}
metadata.setTransactionMetadata(transaction, { origin: metadata.TRANSACTION_ORIGINS.AI, actorId: 'user-1' })
assert.strictEqual(metadata.getTransactionMetadata(transaction).origin, 'ai')
assert.strictEqual(metadata.getTransactionMetadata(transaction).actorId, 'user-1')

const persistence = { load() {}, save() {}, snapshots() {}, snapshot() {}, restore() {} }
const session = createDocumentSession({ documentId: 'doc-1', persistence, capabilities: { canEdit: false } })
assert.strictEqual(session.getProvider('persistence'), persistence)
assert.strictEqual(session.can('canEdit'), false)
assert.strictEqual(session.can('canView'), true)
assert.strictEqual(session.getDocumentRecord({ content: json }).content, json)
const editor = {
  getJSON: () => json,
  view: { dispatch: tr => { editor.lastTransaction = tr } },
}
session.attachEditor(editor)
session.dispatch(transaction, { origin: metadata.TRANSACTION_ORIGINS.IMPORT })
assert.strictEqual(metadata.getTransactionMetadata(editor.lastTransaction).origin, 'import')
assert.throws(() => createDocumentSession({ mode: 'collaborative' }), /collaboration Provider/)
assert.throws(() => createCollaborationProvider({ connect() {} }), /disconnect/)
assert.throws(() => createCommentsProvider({ list() {} }), /createThread/)

// P0-03：门面组件只做装配——模板拆成子组件后 LarkDocEditor.vue 必须持续瘦身（<700 行）。
const editorFacadeLines = fs.readFileSync(path.resolve(sourceRoot, 'components/lark-doc/LarkDocEditor.vue'), 'utf8').split('\n').length
assert(editorFacadeLines < 700, `LarkDocEditor.vue 应保持 <700 行（P0-03 模板拆分），当前 ${editorFacadeLines} 行`)

// P0-04：块定义拆进 core/blocks 后，单文件必须保持 <250 行——防止新块把逻辑重新堆回单文件。
const blocksDir = path.resolve(sourceRoot, 'core/blocks')
for (const file of fs.readdirSync(blocksDir).filter((name) => name.endsWith('.js')).sort()) {
  const lines = fs.readFileSync(path.join(blocksDir, file), 'utf8').split('\n').length
  assert(lines < 250, `core/blocks/${file} 应保持 <250 行（P0-04 拆块注册表），当前 ${lines} 行`)
}

// P0-05：命令表拆进 core/commands 后，单文件 <250 行，且命令 id 集合与顺序、tier 完整性不得漂移。
const commandsDir = path.resolve(sourceRoot, 'core/commands')
for (const file of fs.readdirSync(commandsDir).filter((name) => name.endsWith('.js')).sort()) {
  const lines = fs.readFileSync(path.join(commandsDir, file), 'utf8').split('\n').length
  assert(lines < 250, `core/commands/${file} 应保持 <250 行（P0-05 拆命令表），当前 ${lines} 行`)
}
// 走旧路径 shim require，连带验证转发链可用；id 清单与拆分前 commands.js 逐项一致。
const { COMMANDS } = require(path.resolve(sourceRoot, 'components/lark-doc/commands.js'))
const expectedCommandIds = [
  'paragraph', ...Array.from({ length: 9 }, (_, index) => `heading${index + 1}`),
  'orderedList', 'bulletList', 'taskList', 'code', 'diagram', 'blockquote', 'divider', 'link',
  'callout', 'columns', 'columns2', 'columns3', 'columns4', 'columns5', 'table', 'image',
  'inlineMath', 'blockMath', 'emoji', 'template', 'ai',
]
assert.deepStrictEqual(COMMANDS.map((item) => item.id), expectedCommandIds, '命令 id 集合与顺序必须与拆分前逐项一致（P0-05 验收：命令 id 集合不变）')
for (const item of COMMANDS) {
  assert(['required', 'skeleton', 'skip'].includes(item.tier), `命令 ${item.id} 缺少合法 tier 字段（P0-05：CommandDef 带 tier）`)
  assert(typeof item.group === 'string' && item.group, `命令 ${item.id} 缺少 group 字段（P0-05：CommandDef 归属 12 组之一）`)
}

console.log('architecture checks passed: document envelope, transaction metadata, session lifecycle, capability and provider contracts')
