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

console.log('architecture checks passed: document envelope, transaction metadata, session lifecycle, capability and provider contracts')
