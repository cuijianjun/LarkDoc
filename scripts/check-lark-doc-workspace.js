'use strict'

const assert = require('assert')
const { Schema } = require('@tiptap/pm/model')
const { EditorState, TextSelection } = require('@tiptap/pm/state')

function feature(name) {
  try { return require(`../src/components/lark-doc/${name}`) } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND' && error.message.includes(`/lark-doc/${name}`)) return {}
    throw error
  }
}

const workspace = feature('workspace')
const ai = feature('mockAI')
assert.strictEqual(typeof workspace.createWorkspace, 'function', 'LarkDoc workspace must persist a local document')
assert.strictEqual(typeof ai.streamMock, 'function', 'Mock AI must stream and support cancellation')

const values = new Map([['tiptap-vue2:yjs:demo', 'unchanged']])
const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) }
const store = workspace.createWorkspace(storage)
const json = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'draft' }] }] }
assert.strictEqual(store.load(), null)
store.save({ title: 'Local', json })
assert.deepStrictEqual(store.load().json, json)
assert.strictEqual(store.load().title, 'Local')
assert.strictEqual(values.get('tiptap-vue2:yjs:demo'), 'unchanged')
assert([...values.keys()].filter(key => key !== 'tiptap-vue2:yjs:demo').every(key => key.startsWith('tiptap-vue2:lark-doc:')))
for (let index = 0; index < 23; index += 1) store.snapshot({ title: String(index), json })
assert.strictEqual(store.snapshots().length, 20)
assert.strictEqual(store.snapshots()[0].title, '22')
assert.strictEqual(store.snapshots()[19].title, '3')
assert.strictEqual(store.restore(store.snapshots()[0].id).title, '22')
assert.throws(() => store.restore('missing'), /不存在/)
assert.throws(() => store.save({ title: 'wrong', json: { type: 'script' } }), /文档/)
const corrupt = workspace.createWorkspace({ getItem: () => '{wrong', setItem: () => {} })
assert.throws(() => corrupt.load(), /损坏/)
const badSnapshots = workspace.createWorkspace({ getItem: () => JSON.stringify([{ id: 'x', title: 'x', json: { type: 'script' }, updatedAt: 1 }]) })
assert.throws(() => badSnapshots.snapshots(), /损坏/)
const denied = workspace.createWorkspace({ getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('quota') } })
assert.throws(() => denied.load(), /读取/)
assert.throws(() => denied.save({ title: 'Local', json }), /保存/)

assert.strictEqual(ai.AI_ACTIONS.length, 11)
assert.deepStrictEqual(ai.AI_CONTEXTS.map(item => item.value), ['none', 'selection', 'block', 'document'])
for (const action of ai.AI_ACTIONS) {
  const result = ai.mockResult(action.value, '项目计划需要周五确认。')
  assert(result.length > 0)
  assert.strictEqual(result, ai.mockResult(action.value, '项目计划需要周五确认。'))
}
assert.throws(() => ai.mockResult('unknown', 'text'), /操作/)

const schema = new Schema({ nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*' }, text: {} } })
const doc = schema.node('doc', null, [schema.node('paragraph', null, schema.text('abcdef'))])
const state = EditorState.create({ doc, selection: TextSelection.create(doc, 2, 5) })
const anchor = ai.createAnchor({ state })
assert.deepStrictEqual({ from: anchor.from, to: anchor.to, source: anchor.source }, { from: 2, to: 5, source: 'bcd' })
const before = state.tr.insertText('Z', 1)
ai.mapAnchor(anchor, before)
assert.deepStrictEqual({ from: anchor.from, to: anchor.to }, { from: 3, to: 6 })
assert(ai.anchorValid(anchor, before.doc))
const changed = state.apply(before).tr.insertText('X', 4, 5)
ai.mapAnchor(anchor, changed)
assert(!ai.anchorValid(anchor, changed.doc), 'A changed source must reject stale AI output')
const emptyState = EditorState.create({ doc, selection: TextSelection.create(doc, 3) })
assert.strictEqual(ai.createAnchor({ state: emptyState }).source, 'abcdef')

const contextEditor = { state }
const noneContext = ai.createContextSnapshot(contextEditor, 'none')
assert.deepStrictEqual({ scope: noneContext.scope, text: noneContext.text, truncated: noneContext.truncated }, { scope: 'none', text: '', truncated: false })
const selectionContext = ai.createContextSnapshot(contextEditor, 'selection')
assert.deepStrictEqual({ scope: selectionContext.scope, text: selectionContext.text, summary: selectionContext.summary }, { scope: 'selection', text: 'bcd', summary: '当前选区 · 3 字' })
const documentContext = ai.createContextSnapshot(contextEditor, 'document')
assert.strictEqual(documentContext.text, 'abcdef')
assert.strictEqual(documentContext.blockCount, 1)
const blockDoc = schema.node('doc', null, [schema.node('paragraph', null, schema.text('first')), schema.node('paragraph', null, schema.text('second'))])
const blockEditor = { state: EditorState.create({ doc: blockDoc, selection: TextSelection.create(blockDoc, 2) }) }
const blockContext = ai.createContextSnapshot(blockEditor, 'block')
assert.strictEqual(blockContext.text, 'first')
assert.strictEqual(blockContext.blockCount, 1)
const cappedContext = ai.createContextSnapshot(contextEditor, 'document', 3)
assert.strictEqual(cappedContext.text, '', 'An oversized single block must not be split silently')
assert.strictEqual(cappedContext.truncated, true)
assert.strictEqual(cappedContext.budgetExceeded, true)
assert(cappedContext.summary.includes('单块超出预算'))
const multiCappedContext = ai.createContextSnapshot(blockEditor, 'document', 7)
assert.strictEqual(multiCappedContext.text, 'first', 'Context budgets must stop before the next block')
assert.strictEqual(multiCappedContext.blockCount, 2)
const review = ai.createReviewResult('计划需要周五确认。')
assert(review.issues.length > 0 && review.issues[0].id && review.issues[0].suggestion)
assert.strictEqual(ai.createReviewResult('校对内容！！').issues[0].expected, '！！')
const proposal = ai.createToolProposal(documentContext)
assert.strictEqual(proposal.requiresConfirmation, true)
assert.strictEqual(proposal.operations[0].type, 'propose_insert')
assert.deepStrictEqual(proposal.target, { scope: 'document', from: 0, to: 8, source: 'abcdef' })

async function verifyStream() {
  let preview = ''
  let finished = 0
  await new Promise(resolve => {
    ai.streamMock('rewrite', '计划', { delay: 1, onChunk: value => { preview += value }, onDone: () => { finished += 1; resolve() } })
  })
  assert.strictEqual(preview, ai.mockResult('rewrite', '计划'))
  assert.strictEqual(finished, 1)
  const events = []
  await new Promise(resolve => {
    ai.streamMock('chat', '计划', { prompt: '请给一个标题', delay: 1, onStart: () => events.push('start'), onChunk: () => events.push('chunk'), onDone: () => { events.push('done'); resolve() } })
  })
  assert.strictEqual(events[0], 'start')
  assert.strictEqual(events[events.length - 1], 'done')
  await new Promise(resolve => {
    ai.streamMock('rewrite', '无回调也应正常完成', { delay: 1, onDone: resolve })
  })
  let lateWrites = 0
  const stopped = ai.streamMock('expand', 'text', { delay: 1, onChunk: () => { lateWrites += 1 }, onDone: () => { lateWrites += 1 } })
  stopped.cancel()
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.strictEqual(lateWrites, 0, 'Cancel must suppress queued chunks and completion')
  console.log('lark-doc workspace checks ok: independent drafts, snapshot retention, storage errors, 11 deterministic AI actions, range mapping, stale-source rejection and cancellation')
}

verifyStream().catch(error => { console.error(error); process.exitCode = 1 })
