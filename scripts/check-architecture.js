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
// 🔴 内嵌网页 15 个 id 故意写成**字面量**而不是 `EMBED_MENU_ITEMS.map(...)`：
// 派生会让这条断言变成自证（preset 改了、这里跟着改，永远绿）。这里要守的是
// 「菜单顺序 == 03 §⑫ 的顺序」，所以必须与 presets.js 独立成两份，谁改都要对齐。
const expectedCommandIds = [
  'paragraph', ...Array.from({ length: 9 }, (_, index) => `heading${index + 1}`),
  'orderedList', 'bulletList', 'taskList', 'code', 'diagram', 'blockquote', 'divider', 'link',
  'callout', 'columns', 'columns2', 'columns3', 'columns4', 'columns5', 'table', 'image', 'file',
  'inlineMath', 'blockMath', 'template', 'ai',
  // P4-01 / P4-02a / P4-02b 补进来的 5 条（03 §3.4 ⑦ 的位置），同样是字面量：谁动顺序谁改两处。
  'mentionUser', 'mentionChat', 'mentionPage', 'reminder', 'calendar_event',
  'douyin_embed_video', 'bilibili', 'youku', 'iqiyi_video', 'byte_jimeng', 'figma', 'modao',
  'canva', 'jcode', 'codepen', 'feishu_survey', 'jinshuju', 'airtable', 'baidumap', 'autonavi',
]
assert.deepStrictEqual(COMMANDS.map((item) => item.id), expectedCommandIds, '命令 id 集合与顺序必须与拆分前逐项一致（P0-05 验收：命令 id 集合不变）')
for (const item of COMMANDS) {
  assert(['required', 'skeleton', 'skip'].includes(item.tier), `命令 ${item.id} 缺少合法 tier 字段（P0-05：CommandDef 带 tier）`)
  assert(typeof item.group === 'string' && item.group, `命令 ${item.id} 缺少 group 字段（P0-05：CommandDef 归属 12 组之一）`)
}

// P0-09：契约骨架——嵌入 preset 空壳、卡片 schema、协同客户端签名只做类型与数据，零实现。
const embedTypes = require(path.resolve(sourceRoot, 'core/embed/types'))
assert.strictEqual(embedTypes.EMBED_PRESETS.length, 15, '内嵌网页 preset 必须 15 条（requirements/03 §内嵌网页清单）')
assert.deepStrictEqual(
  new Set(embedTypes.EMBED_PRESETS.map((item) => item.id)).size, 15, 'EmbedDef preset id 不得重复')
for (const item of embedTypes.EMBED_PRESETS) {
  assert(['iframe', 'card'].includes(item.kind), `EmbedDef ${item.id} kind 非法`)
  assert(['required', 'skeleton', 'skip'].includes(item.tier), `EmbedDef ${item.id} 缺少合法 tier`)
}
const embedCard = require(path.resolve(sourceRoot, 'core/embed/card'))
assert.strictEqual(embedCard.cardSchema.cardVersion, 1, 'cardSchema 契约版本必须为 1')
const collab = require(path.resolve(sourceRoot, 'collab'))
assert.strictEqual(collab.COLLAB_PROTOCOL_VERSION, 1, '协同契约版本必须为 1')
for (const factory of ['createCollabExtensions', 'createHocuspocusBridge', 'createCommentAnchors']) {
  assert.throws(() => collab[factory]({}), /not implemented/, `${factory} 在 P6a 前必须保持未实现签名`)
}

// P0-11：DerivedIndex 骨架——六方法签名（09 §3.7.1）+ 兜底行为探针 + 装饰接线校验。
const derive = require(path.resolve(sourceRoot, 'core/derive/index'))
assert.strictEqual(typeof derive.createDerivedIndex, 'function', 'core/derive 必须导出 createDerivedIndex（09 §3.7 契约）')
assert.strictEqual(typeof derive.mergeRanges, 'function', 'core/derive 必须导出 mergeRanges（§3.7 纪律 1 的区间合并）')
assert.deepStrictEqual(
  derive.mergeRanges([{ from: 5, to: 9 }, { from: 0, to: 4 }, { from: 4, to: 12 }, { from: 20, to: 30 }]),
  [{ from: 0, to: 12 }, { from: 20, to: 30 }],
  'mergeRanges 必须把重叠/贴边区间收敛为互不重叠的升序区间（(0,4)+(4,12) 贴边可并；间隔 ≥1 的不并）',
)
// 最小探针验证六方法签名与 update 的兜底语义：区间来自 mapping.maps 并合并，返回 { changed, index }。
const probeIndex = derive.createDerivedIndex({ doc: {}, schema: null, rebuild: (state) => ({ probed: state }) })
for (const method of ['update', 'decorations', 'headingNumbers', 'outline', 'foldRanges', 'invalidate']) {
  assert.strictEqual(typeof probeIndex[method], 'function', `DerivedIndex 缺少 ${method} 方法（09 §3.7.1 契约）`)
}
const probeMap = { forEach: (fn) => { fn(2, 6); fn(10, 11); fn(4, 8) } }
const probeResult = probeIndex.update({ mapping: { maps: [probeMap] }, doc: { version: 2 } })
// (2,6)+(4,8) 相邻重叠并成 (2,8)；(10,11) 与前段有间隙保留为独立区间。
assert.deepStrictEqual(probeResult.changed, [{ from: 2, to: 8 }, { from: 10, to: 11 }], 'update 必须把 mapping 各段合并成互不重叠区间')
assert.strictEqual(probeResult.index, probeIndex, 'update 返回值必须携带 index 自身（09 §3.7.1 契约）')
// 装饰接线：props.decorations 必须委托 DerivedIndex，且接线文件不得直接全量重扫文档
// （硬规则 13 —— 具体计算在 document-decorations.js，P7-01 只换 update 实现）。
const documentExtensionSource = fs.readFileSync(path.resolve(sourceRoot, 'core/blocks/document.js'), 'utf8')
assert(/derivedIndex\.decorations\(state\)/.test(documentExtensionSource), 'props.decorations 必须走 DerivedIndex（09 §3.7 / 硬规则 13）')
assert(!/\bdoc\.descendants\b/.test(documentExtensionSource), '装饰接线文件不得直接全量重扫文档（硬规则 13），派生计算一律进 DerivedIndex')

// 决策 5 硬边界：本仓库不含任何自有服务端代码——hocuspocus 只准出现在 test/（e2e 内存实例）。
function walkJsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? walkJsFiles(full) : (entry.name.endsWith('.js') || entry.name.endsWith('.vue') ? [full] : [])
  })
}
// 只拦真实引入（import ... from / import '@...' / require('@...')）；注释与函数名（如 createHocuspocusBridge，09 §3.3 规格原文）提及不算违规。
for (const file of walkJsFiles(sourceRoot)) {
  const content = fs.readFileSync(file, 'utf8')
  const hocuspocusImport = /(?:\bfrom\s*|\bimport\s*|\brequire\s*\(\s*)['"][^'"]*hocuspocus/i.test(content)
  assert(!hocuspocusImport, `src/ 下禁止引入 hocuspocus（服务端代码不进本仓库）：${path.relative(sourceRoot, file)}`)
  if (file.includes(`${path.sep}core${path.sep}embed${path.sep}`)) {
    assert(!/\bfetch\s*\(|XMLHttpRequest|axios/.test(content), `core/embed/ 零网络（硬规则 9）：${path.relative(sourceRoot, file)}`)
  }
}

console.log('architecture checks passed: document envelope, transaction metadata, session lifecycle, capability and provider contracts')
