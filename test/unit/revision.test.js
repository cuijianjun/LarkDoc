/**
 * P4-06 ③ 修订模式单测 —— jsdom（要建真 schema 与 state）。
 * 规格出处：requirements/07 §12.2（标记结构）/ §12.3（面板几何）/ §12.4（六按钮）/
 * §12.5（CRUD 闭环）/ §12.6（与评论面板的差异）。
 *
 * 六组用例各守一条「跑得通但会静默错」的口径：
 *
 * 1. `normalizeRevision` —— 枚举越界落 `insert`、空 id 现造、空作者落兜底。收口点只
 *    这一个，写路径（tracker）与展示路径（面板）都过它，别各自判。
 * 2. `collectRevisions` / `revisionAt` —— 同 id 相邻片段必须并成**一条**（连续键入会被
 *    ProseMirror 拆成多个文本节点），`to` 是**开区间**（光标停在末尾不算在修订里）。
 * 3. 决策表 —— insert+accept 留文字摘标记；insert+reject 连文字丢；delete+reject
 *    保留原文与段落边界（2026-11-10 源站闭环纠正旧 §12.5）。
 * 4. 面板几何 —— 三态高度 137 / 115 / 169，六按钮顺序（拒绝在前、接受在后）、图标
 *    两档 12/14、热区恒 16。
 * 5. tracker 纯函数 —— `deleteDecision` 三分支（keep / drop / mark）是与 IME、退格语义
 *    打交道的唯一闸门；`buildRevisionMarkTr` 必须 `addToHistory: false`。
 * 6. 规格层 —— 读 CSS / RevisionPanel.vue 文本，锁「两层 span」「颜色写死不走 --B700」
 *    「按钮无 title」「无 more-btn」这几条实测负结论。
 */
// @vitest-environment jsdom
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { afterEach, describe, expect, it } from 'vitest'
import { Editor, getSchema } from '@tiptap/core'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { sanitizeHTML, validateDocument } from '../../src/core/documentOperations'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import {
  REVISION_ACTIONS, REVISION_AUTHOR_FALLBACK, REVISION_AUTHOR_NAME_FALLBACK, REVISION_BUTTON_IDS,
  REVISION_BUTTONS, REVISION_HEIGHTS, REVISION_KINDS, REVISION_LABELS, REVISION_PANEL,
  REVISION_PANEL_TITLE, LarkDocRevision, collectRevisions, createRevisionId, normalizeRevision,
  readRevision, revisionAt, revisionDecision, revisionMarkOf, revisionPanelHeight, revisionRanges,
  revisionSummary,
} from '../../src/core/blocks/revision'
import {
  REVISION_TRACK_META, adjacentRevisionId, buildRevisionMarkTr, deleteDecision, deletionRange,
  insertedRanges, isBulkReplace, mergeRanges, revisionSpans,
} from '../../src/core/revision/tracker'
import { adjacentRevision, buildRevisionDecisionTr, revisionAnchor, revisionJumps, revisionTarget } from '../../src/core/revision/commands'
import { ICONS } from '../../src/ui/icons'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const css = fs.readFileSync(path.join(root, 'src/components/lark-doc/lark-doc.css'), 'utf8')
const panelUi = fs.readFileSync(path.join(root, 'src/ui/revision.js'), 'utf8')
const panelMixin = fs.readFileSync(path.join(root, 'src/components/lark-doc/editor/revisionUiMixin.js'), 'utf8')
const nativeHost = fs.readFileSync(path.join(root, 'src/editor/nativeEditorHost.js'), 'utf8')
const shell = fs.readFileSync(path.join(root, 'src/ui/workspaceShell.js'), 'utf8')
const modeMixin = fs.readFileSync(path.join(root, 'src/components/lark-doc/editor/viewModesMixin.js'), 'utf8')

const schema = getSchema(createLarkDocExtensions())
const revisionType = schema.marks.revision
const liveEditors = []
afterEach(() => liveEditors.splice(0).forEach(editor => editor.destroy()))

/** 造一段正文：`runs` 里每项 `{ text, attrs }`，带 attrs 的挂 revision mark。 */
function docOf(runs) {
  const inline = runs.map((run) => (run.attrs
    ? schema.text(run.text, [revisionType.create(run.attrs)])
    : schema.text(run.text)))
  return schema.nodes.doc.create(null, [schema.nodes.paragraph.create(null, inline)])
}

function stateOf(doc, caret) {
  return EditorState.create({
    schema,
    doc,
    selection: typeof caret === 'number' ? TextSelection.create(doc, caret) : undefined,
  })
}

describe('P4-06 修订属性收口（07 §12.2）', () => {
  it('枚举越界落 insert，空 id 现造，空作者落兜底', () => {
    expect(normalizeRevision({ kind: 'weird' }).kind).toBe('insert')
    expect(normalizeRevision(null).kind).toBe('insert')
    expect(normalizeRevision({ author: '' }).author).toBe(REVISION_AUTHOR_FALLBACK)
    expect(normalizeRevision({ revisionId: '' }).revisionId).toMatch(/^rev-/)
    expect(normalizeRevision({ revisionId: 'r1', author: 'u1', kind: 'delete' })).toEqual({ revisionId: 'r1', author: 'u1', kind: 'delete' })
    // 两种合法 kind 原样保留，不做「只认 insert」的收窄。
    expect(normalizeRevision({ kind: 'delete' }).kind).toBe('delete')
    expect(REVISION_KINDS).toEqual(['insert', 'delete'])
  })

  it('createRevisionId 带时间戳且同毫秒不撞', () => {
    const a = createRevisionId(1700000000000)
    const b = createRevisionId(1700000000000)
    expect(a.startsWith('rev-')).toBe(true)
    expect(a).not.toBe(b)
  })

  it('readRevision / revisionMarkOf 只认 revision，不造新 id', () => {
    expect(readRevision(null)).toBeNull()
    expect(readRevision({ type: { name: 'bold' }, attrs: {} })).toBeNull()
    const mark = revisionType.create({ revisionId: 'r9', author: 'u2', kind: 'delete' })
    expect(readRevision(mark)).toEqual({ revisionId: 'r9', author: 'u2', kind: 'delete' })
    expect(revisionMarkOf({ marks: [] })).toBeNull()
    expect(revisionMarkOf({ marks: [mark] })).toBe(mark)
    expect(revisionMarkOf(null)).toBeNull()
  })

  it('mark 严格两层：外层容器带 data-*，内层带 data-string / data-leaf', () => {
    const insert = revisionType.create({ revisionId: 'r1', author: 'u1', kind: 'insert' })
    const del = revisionType.create({ revisionId: 'r2', author: 'u1', kind: 'delete' })
    const out = revisionType.spec.toDOM(insert, true)
    expect(out[0]).toBe('span')
    expect(out[1].class).toBe('revision-container')
    expect(out[1]['data-inline-wrapper']).toBe('true')
    expect(out[1]['data-revision-id']).toBe('r1')
    expect(out[1]['data-revision-kind']).toBe('insert')
    expect(out[1]['data-revision-author']).toBe('u1')
    const inner = out[2]
    expect(inner[0]).toBe('span')
    expect(inner[1].class).toContain('text-revision')
    expect(inner[1].class).toContain('revision-id-r1')
    expect(inner[1].class).toContain('author-u1')
    expect(inner[1]['data-string']).toBe('true')
    expect(inner[1]['data-leaf']).toBe('true')
    // 新增态内层不带删除线类；颜色一律交给 CSS，不写 inline style。
    expect(inner[1].class).not.toContain('revision-linethrough')
    expect(out[1].style).toBeUndefined()
    expect(revisionType.spec.toDOM(del, true)[2][1].class).toContain('revision-linethrough')
    expect(LarkDocRevision.name).toBe('revision')
  })

  it('mark 不进 schema 时会静默丢属性（回归守卫）', () => {
    expect(revisionType).toBeTruthy()
    expect(revisionType.name).toBe('revision')
    // inclusive: false —— 否则在建议里继续键入会被旧 id 吞掉。
    expect(revisionType.spec.inclusive).toBe(false)
  })
})

describe('P4-06 建议收集（07 §12.2 / §12.5）', () => {
  it('同 id 相邻片段并成一条，不同 id 各自成条', () => {
    const doc = {
      descendants(fn) {
        const mark = (id) => ({ type: { name: 'revision' }, attrs: { revisionId: id, author: 'u1', kind: 'insert' } })
        fn({ isText: true, marks: [mark('r1')], nodeSize: 2, text: 'ab' }, 1)
        fn({ isText: true, marks: [mark('r1')], nodeSize: 2, text: 'cd' }, 3)
        fn({ isText: false, marks: [], nodeSize: 2, text: '' }, 5)
        fn({ isText: true, marks: [mark('r2')], nodeSize: 1, text: 'Z' }, 7)
      },
    }
    const items = collectRevisions(doc)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ revisionId: 'r1', from: 1, to: 5, text: 'abcd', kind: 'insert' })
    expect(items[1]).toMatchObject({ revisionId: 'r2', from: 7, to: 8 })
    expect(revisionRanges(doc, 'r1')).toEqual([{ from: 1, to: 5 }])
    expect(revisionRanges(doc, 'nope')).toEqual([])
    expect(collectRevisions(null)).toEqual([])
  })

  it('from 按文档序升序、text 逐段拼', () => {
    const real = docOf([
      { text: 'A', attrs: { revisionId: 'r1', author: 'u1', kind: 'insert' } },
      { text: '中' },
      { text: 'B', attrs: { revisionId: 'r2', author: 'u1', kind: 'delete' } },
    ])
    const items = collectRevisions(real)
    expect(items.map((item) => item.text)).toEqual(['A', 'B'])
    expect(items[0].from).toBeLessThan(items[1].from)
  })

  it('revisionAt 用开区间：末尾位置不算在修订里', () => {
    const doc = docOf([{ text: 'abc', attrs: { revisionId: 'r1', author: 'u1', kind: 'insert' } }])
    // 段落起点 1，文字占 1..4。
    expect(revisionAt(doc, 1)).toBe('r1')
    expect(revisionAt(doc, 3)).toBe('r1')
    expect(revisionAt(doc, 4)).toBe('')
    expect(revisionAt(doc, 0)).toBe('')
    expect(revisionAt(doc, 99)).toBe('')
  })
})

describe('P4-06 接受 / 拒绝决策表（07 §12.5）', () => {
  it('insert：accept 留文字、reject 丢文字', () => {
    expect(revisionDecision('insert', 'accept')).toEqual({ dropText: false })
    expect(revisionDecision('insert', 'reject')).toEqual({ dropText: true })
  })

  it('delete：接受删除、拒绝保留原文（2026-11-10 飞书实操）', () => {
    expect(revisionDecision('delete', 'accept')).toEqual({ dropText: true })
    expect(revisionDecision('delete', 'reject')).toEqual({ dropText: false })
  })

  it('动作越界按「只摘标记」处理，不乱删正文', () => {
    expect(revisionDecision('insert', 'whatever')).toEqual({ dropText: false })
    expect(REVISION_ACTIONS).toEqual(['accept', 'reject'])
  })

  it('决策真的落到文档：四格全覆盖', () => {
    const insertDoc = docOf([
      { text: '前' },
      { text: '新字', attrs: { revisionId: 'r1', author: 'u1', kind: 'insert' } },
      { text: '后' },
    ])
    const acceptTr = revisionTarget(insertDoc, 'r1') && buildRevisionDecisionTrFor(insertDoc, 'r1', 'accept')
    expect(acceptTr.doc.textContent).toBe('前新字后')
    expect(collectRevisions(acceptTr.doc)).toHaveLength(0)

    const rejectTr = buildRevisionDecisionTrFor(insertDoc, 'r1', 'reject')
    expect(rejectTr.doc.textContent).toBe('前后')

    const deleteDoc = docOf([
      { text: '前' },
      { text: '删字', attrs: { revisionId: 'r2', author: 'u1', kind: 'delete' } },
      { text: '后' },
    ])
    expect(buildRevisionDecisionTrFor(deleteDoc, 'r2', 'accept').doc.textContent).toBe('前后')
    expect(buildRevisionDecisionTrFor(deleteDoc, 'r2', 'reject').doc.textContent).toBe('前删字后')
  })

  it('id 不存在时返回 false（面板据此不派发）', () => {
    const doc = docOf([{ text: 'abc' }])
    expect(buildRevisionDecisionTrFor(doc, 'nope', 'accept')).toBe(false)
  })

  it('摘要按类型给前缀，正文取标记文字', () => {
    expect(revisionSummary({ kind: 'insert', text: '新' })).toEqual({ label: '新增', text: '新' })
    expect(revisionSummary({ kind: 'delete', text: 'C' })).toEqual({ label: '删除', text: 'C' })
    expect(revisionSummary({ kind: 'oops', text: null })).toEqual({ label: REVISION_LABELS.insert, text: '' })
  })
})

/** `buildRevisionDecisionTr` 要 state，这里用同一份 schema 造一个只读 state。 */
function buildRevisionDecisionTrFor(doc, revisionId, action) {
  // 延迟 require 会让「决策表」用例也能在没点开事务的场合跑；这里直接走 state。
  return buildRevisionDecisionTr(stateOf(doc), revisionId, action)
}

describe('Source-verified deletion and paragraph-boundary lifecycle', () => {
  function suggest(content, from, to = from, key = 'Backspace') {
    const editor = new Editor({ element: document.createElement('div'), extensions: createLarkDocExtensions(), content })
    liveEditors.push(editor)
    editor.storage.larkDocRevisionTracker.active = true
    editor.commands.setTextSelection({ from, to })
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    return editor
  }
  function decide(editor, action) {
    const item = collectRevisions(editor.state.doc)[0]
    expect(item).toBeTruthy()
    editor.view.dispatch(buildRevisionDecisionTr(editor.state, item.revisionId, action))
  }

  it('keeps cross-paragraph text as one suggestion, rejects without losing either paragraph, and undoes once', () => {
    const editor = suggest('<p>leftAAA</p><p>BBBend</p>', 5, 13)
    const items = collectRevisions(editor.state.doc)
    expect(editor.state.doc.childCount).toBe(2)
    expect(editor.state.doc.textContent).toBe('leftAAABBBend')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'delete', text: 'AAA\nBBB' })
    const marked = editor.getJSON()
    decide(editor, 'reject')
    expect(editor.state.doc.textContent).toBe('leftAAABBBend')
    expect(editor.state.doc.childCount).toBe(2)
    expect(collectRevisions(editor.state.doc)).toEqual([])
    editor.commands.undo()
    expect(editor.getJSON()).toEqual(marked)
    editor.commands.undo()
    expect(collectRevisions(editor.state.doc)).toEqual([])
    expect(editor.state.doc.textContent).toBe('leftAAABBBend')
  })

  it('accepts a partial cross-paragraph deletion by joining only the marked range and supports undo/redo', () => {
    const editor = suggest('<p>leftAAA</p><p>BBBend</p>', 5, 13)
    const marked = editor.getJSON()
    decide(editor, 'accept')
    expect(editor.state.doc.childCount).toBe(1)
    expect(editor.state.doc.textContent).toBe('leftend')
    expect(collectRevisions(editor.state.doc)).toEqual([])
    editor.commands.undo()
    expect(editor.getJSON()).toEqual(marked)
    editor.commands.redo()
    expect(editor.state.doc.textContent).toBe('leftend')
    expect(collectRevisions(editor.state.doc)).toEqual([])
  })

  it.each(['Backspace', 'Delete'])('suggests only the paragraph boundary for %s and preserves all text', key => {
    const editor = suggest('<p>left</p><p>right</p>', key === 'Backspace' ? 7 : 5, undefined, key)
    expect(editor.state.doc.childCount).toBe(2)
    expect(editor.state.doc.textContent).toBe('leftright')
    expect(collectRevisions(editor.state.doc)).toHaveLength(1)
    const marker = editor.view.dom.querySelector('[data-type="revision-boundary"]')
    expect(marker?.textContent).toBe('\u200b')
    const json = validateDocument(editor.getJSON(), editor.schema)
    const reloaded = new Editor({ extensions: createLarkDocExtensions(), content: sanitizeHTML(editor.getHTML()) })
    liveEditors.push(reloaded)
    expect(reloaded.getJSON()).toEqual(json)
    decide(editor, 'accept')
    expect(editor.state.doc.childCount).toBe(1)
    expect(editor.state.doc.textContent).toBe('leftright')
    editor.commands.undo()
    decide(editor, 'reject')
    expect(editor.state.doc.childCount).toBe(2)
    expect(editor.state.doc.textContent).toBe('leftright')
    expect(collectRevisions(editor.state.doc)).toEqual([])
  })

  it('does not delete unmarked text between separate fragments of the same suggestion', () => {
    const doc = docOf([{ text: 'A', attrs: { revisionId: 'same', kind: 'delete' } }, { text: 'keep' }, { text: 'B', attrs: { revisionId: 'same', kind: 'delete' } }])
    expect(collectRevisions(doc)).toHaveLength(1)
    expect(revisionAt(doc, 3)).toBe('')
    expect(buildRevisionDecisionTrFor(doc, 'same', 'accept').doc.textContent).toBe('keep')
  })

  it('keeps unmarked text subsequently inserted after a retained boundary', () => {
    const editor = suggest('<p>left</p><p>right</p>', 7)
    let boundaryPos = -1
    editor.state.doc.descendants((node, pos) => { if (node.type.name === 'revisionBoundary') boundaryPos = pos })
    editor.view.dispatch(editor.state.tr.insertText('KEEP', boundaryPos + 1).setMeta('larkDocRevisionSkip', true))
    decide(editor, 'accept')
    expect(editor.state.doc.childCount).toBe(1)
    expect(editor.state.doc.textContent).toBe('leftKEEPright')
  })

  it('does not produce suggestions from key events after the editor becomes readonly', () => {
    const editor = suggest('<p>text</p>', 1)
    editor.setEditable(false)
    editor.commands.setTextSelection(2)
    const saved = editor.getJSON()
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }))
    expect(editor.getJSON()).toEqual(saved)
  })

  it('never splits a UTF-16 surrogate pair during character deletion', () => {
    const doc = docOf([{ text: 'a😀b' }])
    expect(deletionRange(stateOf(doc, 4), false)).toEqual({ from: 2, to: 4 })
    expect(deletionRange(stateOf(doc, 2), true)).toEqual({ from: 2, to: 4 })
  })

  it.each(['insert-then-delete', 'delete-then-insert'])('keeps opposite revision kinds separate in %s and both decisions preserve the intended original', order => {
    for (const action of ['accept', 'reject']) {
      const editor = new Editor({ extensions: createLarkDocExtensions(), content: '<p data-block-id="b12345678">original</p>' })
      liveEditors.push(editor)
      editor.storage.larkDocRevisionTracker.active = true
      editor.commands.setTextSelection(1)
      if (order === 'insert-then-delete') {
        editor.commands.insertContent('NEW')
        editor.commands.setTextSelection(4)
        editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }))
      } else {
        editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }))
        editor.commands.setTextSelection(2)
        editor.commands.insertContent('NEW')
      }
      const items = collectRevisions(editor.state.doc)
      expect(items).toHaveLength(2)
      expect(new Set(items.map(item => item.kind))).toEqual(new Set(['insert', 'delete']))
      expect(new Set(items.map(item => item.revisionId)).size).toBe(2)
      decide(editor, action)
      decide(editor, action)
      expect(editor.state.doc.textContent).toBe(action === 'accept' ? 'NEWriginal' : 'original')
      expect(collectRevisions(editor.state.doc)).toEqual([])
    }
  })

  it.each(['accept', 'reject'])('supports source-verified code text deletion and %s without permitting ordinary formatting marks', action => {
    const editor = suggest('<pre><code>const</code></pre><p>end</p>', 2, 4)
    expect(editor.state.doc.firstChild.textContent).toBe('const')
    expect(collectRevisions(editor.state.doc)).toHaveLength(1)
    expect(collectRevisions(editor.state.doc)[0]).toMatchObject({ kind: 'delete', text: 'on' })
    editor.commands.setTextSelection({ from: 1, to: 5 })
    editor.commands.toggleBold()
    expect(editor.getHTML()).not.toContain('<strong>')
    decide(editor, action)
    expect(editor.state.doc.firstChild.textContent).toBe(action === 'accept' ? 'cst' : 'const')
    expect(editor.state.doc.childCount).toBe(2)
  })

  it.each(['accept', 'reject'])('clamps a code-anchored cross-zone drag to code text and %s preserves the paragraph', action => {
    const editor = suggest('<pre><code>abc</code></pre><p>def</p>', 2, 7)
    expect(editor.state.selection.from).toBeGreaterThanOrEqual(1)
    expect(editor.state.doc.childCount).toBe(2)
    expect(editor.state.doc.textContent).toBe('abcdef')
    expect(collectRevisions(editor.state.doc)).toHaveLength(1)
    expect(collectRevisions(editor.state.doc)[0].text).toBe('bc')
    decide(editor, action)
    expect(editor.state.doc.firstChild.textContent).toBe(action === 'accept' ? 'a' : 'abc')
    expect(editor.state.doc.child(1).textContent).toBe('def')
    expect(editor.state.doc.childCount).toBe(2)
  })

  it.each(['accept', 'reject'])('selects a whole code block when a paragraph-anchored drag enters its zone; %s retains the paragraph identity', action => {
    const editor = new Editor({ extensions: createLarkDocExtensions(), content: '<pre data-block-id="b12345678"><code>abc</code></pre><p data-block-id="b87654321">def</p>' })
    liveEditors.push(editor)
    const original = editor.getJSON()
    editor.storage.larkDocRevisionTracker.active = true
    editor.commands.setTextSelection({ from: 7, to: 2 })
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }))
    expect(editor.state.doc.childCount).toBe(2)
    expect(editor.state.doc.textContent).toBe('abcdef')
    expect(collectRevisions(editor.state.doc)).toHaveLength(1)
    const marked = editor.getJSON()
    expect(() => validateDocument(marked, editor.schema)).not.toThrow()
    const reload = new Editor({ extensions: createLarkDocExtensions(), content: sanitizeHTML(editor.getHTML()) })
    liveEditors.push(reload)
    expect(reload.getJSON()).toEqual(marked)
    decide(editor, action)
    if (action === 'reject') expect(editor.getJSON()).toEqual(original)
    else {
      expect(editor.state.doc.childCount).toBe(1)
      expect(editor.state.doc.firstChild.type.name).toBe('paragraph')
      expect(editor.state.doc.firstChild.attrs.blockId).toBe('b87654321')
      expect(editor.state.doc.firstChild.textContent).toBe('ef')
    }
    editor.commands.undo()
    expect(editor.getJSON()).toEqual(marked)
  })

  it.each([1, 2])('extends an existing whole-code deletion by %s unmarked paragraph characters', extra => {
    const editor = new Editor({ extensions: createLarkDocExtensions(), content: '<pre><code>abc</code></pre><p>def</p>' })
    liveEditors.push(editor)
    editor.storage.larkDocRevisionTracker.active = true
    editor.commands.setTextSelection({ from: 7, to: 2 })
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }))
    editor.commands.setTextSelection({ from: 7 + extra, to: 2 })
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }))
    expect(collectRevisions(editor.state.doc)).toHaveLength(1)
    expect(collectRevisions(editor.state.doc)[0].text).toBe('abc\n' + 'def'.slice(0, 1 + extra))
    decide(editor, 'accept')
    expect(editor.state.doc.childCount).toBe(1)
    expect(editor.state.doc.firstChild.textContent).toBe('def'.slice(1 + extra))
  })
})

describe('P4-06 跳转与锚点（07 §12.4 #1 #2 #3）', () => {
  const doc = docOf([
    { text: 'a', attrs: { revisionId: 'r1', author: 'u1', kind: 'insert' } },
    { text: '中' },
    { text: 'b', attrs: { revisionId: 'r2', author: 'u1', kind: 'insert' } },
    { text: '间' },
    { text: 'c', attrs: { revisionId: 'r3', author: 'u1', kind: 'delete' } },
  ])

  it('revisionJumps 按文档序给出三条', () => {
    expect(revisionJumps(doc).map((item) => item.revisionId)).toEqual(['r1', 'r2', 'r3'])
  })

  it('adjacentRevision 首尾越界返回空串（面板据此置灰）', () => {
    expect(adjacentRevision(doc, 'r1', 1)).toBe('r2')
    expect(adjacentRevision(doc, 'r2', -1)).toBe('r1')
    expect(adjacentRevision(doc, 'r1', -1)).toBe('')
    expect(adjacentRevision(doc, 'r3', 1)).toBe('')
    // 未知 id 当「从头开始」：向后取首条、向前取尾条。
    expect(adjacentRevision(doc, 'ghost', 1)).toBe('r1')
    expect(adjacentRevision(doc, 'ghost', -1)).toBe('r3')
  })

  it('revisionTarget 带上全部区间与 kind', () => {
    const target = revisionTarget(doc, 'r3')
    expect(target).toMatchObject({ revisionId: 'r3', kind: 'delete', author: 'u1' })
    expect(target.ranges.length).toBe(1)
    expect(revisionTarget(doc, 'ghost')).toBeNull()
  })

  it('revisionAnchor 给稳定的 #revision-<id>', () => {
    expect(revisionAnchor('r1')).toBe('#revision-r1')
    expect(revisionAnchor('')).toBe('')
    expect(revisionAnchor(null)).toBe('')
  })
})

describe('P4-06 面板几何与六按钮（07 §12.3 / §12.4）', () => {
  it('三态高度 137 / 115 / 169', () => {
    expect(REVISION_HEIGHTS).toEqual({ insert: 137, delete: 115, active: 169 })
    expect(revisionPanelHeight('insert', false)).toBe(137)
    expect(revisionPanelHeight('delete', false)).toBe(115)
    expect(revisionPanelHeight('insert', true)).toBe(169)
    expect(revisionPanelHeight('delete', true)).toBe(169)
    // 未知类型回落 insert 档，不返回 undefined。
    expect(revisionPanelHeight('oops', false)).toBe(137)
  })

  it('壳宽恒 270、radius 6、多实例间距 6', () => {
    expect(REVISION_PANEL.width).toBe(270)
    expect(REVISION_PANEL.radius).toBe(6)
    expect(REVISION_PANEL.gap).toBe(6)
    expect(REVISION_PANEL.headerHeight).toBe(32)
    expect(REVISION_PANEL.headerPadding).toBe('8px 12px 0')
    expect(REVISION_PANEL.controlsWidth).toBe(115)
    expect(REVISION_PANEL.controlsHeight).toBe(26)
    expect(REVISION_PANEL.controlsPadding).toBe('3px 5px')
    expect(REVISION_PANEL.replyHeight).toBe(83)
    expect(REVISION_PANEL.replyPadding).toBe('6px 12px')
    expect(REVISION_PANEL.avatarSize).toBe(32)
    expect(REVISION_PANEL.rightColumnWidth).toBe(200)
    expect(REVISION_PANEL.infoRowHeight).toBe(17)
    expect(REVISION_PANEL.bodyHeight).toBe(50)
    expect(REVISION_PANEL.bodyMarginTop).toBe(4)
    expect(REVISION_PANEL.hitSize).toBe(16)
    expect(REVISION_PANEL_TITLE).toBe('修订建议')
  })

  it('六项顺序不可颠倒：拒绝在前、接受在后，中间夹分割条', () => {
    expect(REVISION_BUTTON_IDS).toEqual(['go-next', 'go-previous', 'split', 'copyAnchor', 'reject', 'accept'])
    const rejectAt = REVISION_BUTTON_IDS.indexOf('reject')
    const acceptAt = REVISION_BUTTON_IDS.indexOf('accept')
    expect(rejectAt).toBeLessThan(acceptAt)
    expect(REVISION_BUTTONS.filter((btn) => btn.tooltip === '拒绝修订')).toHaveLength(1)
  })

  it('图标两档 12 / 14，热区统一 16；prev 默认禁用、无 tooltip', () => {
    const byId = {}
    REVISION_BUTTONS.forEach((btn) => { byId[btn.id] = btn })
    expect(byId['go-next'].iconSize).toBe(12)
    expect(byId['go-previous'].iconSize).toBe(12)
    expect(byId.copyAnchor.iconSize).toBe(14)
    expect(byId.reject.iconSize).toBe(12)
    expect(byId.accept.iconSize).toBe(14)
    expect(byId.split.iconSize).toBe(0)
    expect(byId['go-previous'].disabled).toBe(true)
    expect(byId['go-previous'].tooltip).toBe('')
    expect(byId.reject.tone).toBe('danger')
    expect(byId.accept.tone).toBe('success')
    expect(REVISION_PANEL.hitSize).toBe(16)
    expect(byId['go-next'].tooltip).toBe('下一个 (↓)')
    expect(byId.copyAnchor.tooltip).toBe('复制链接')
  })

  it('面板要用的图标键都在图标库里', () => {
    ['rev-next', 'rev-prev', 'rev-accept', 'rev-image', 'rev-avatar', 'link', 'close'].forEach((name) => {
      expect(ICONS[name], name).toBeTruthy()
      expect(ICONS[name].startsWith('<svg')).toBe(true)
    })
  })
})

describe('P4-06 tracker 纯函数（07 §12.2 删除语义）', () => {
  const type = revisionType

  it('mergeRanges 去零长、升序、相邻并段', () => {
    expect(mergeRanges([{ from: 5, to: 8 }, { from: 1, to: 3 }, { from: 3, to: 5 }, { from: 9, to: 9 }]))
      .toEqual([{ from: 1, to: 8 }])
    expect(mergeRanges(null)).toEqual([])
    expect(mergeRanges([{ from: 4, to: 2 }])).toEqual([])
  })

  it('insertedRanges 只取新增字符（纯删除不产生区间）', () => {
    const doc = docOf([{ text: 'abcdef' }])
    const insertTr = stateOf(doc).tr.insertText('XY', 3)
    const ranges = insertedRanges(insertTr)
    expect(ranges).toEqual([{ from: 3, to: 5 }])
    const deleteTr = stateOf(doc).tr.delete(2, 4)
    expect(insertedRanges(deleteTr)).toEqual([])
  })

  it('revisionSpans 按绝对位置切区间', () => {
    const doc = docOf([
      { text: 'A' },
      { text: 'BCD', attrs: { revisionId: 'r1', author: 'u1', kind: 'insert' } },
      { text: 'E' },
    ])
    const spans = revisionSpans(doc, 2, 4, type)
    expect(spans).toHaveLength(1)
    expect(spans[0]).toMatchObject({ from: 2, to: 4 })
    expect(revisionSpans(doc, 2, 4, null)).toEqual([])
    expect(revisionSpans(doc, 4, 4, type)).toEqual([])
  })

  it('deleteDecision 三分支：delete→keep、insert→drop、其余→mark', () => {
    const marked = docOf([
      { text: '前' },
      { text: 'D', attrs: { revisionId: 'r1', author: 'u1', kind: 'delete' } },
      { text: 'I', attrs: { revisionId: 'r2', author: 'u1', kind: 'insert' } },
      { text: 'N' },
    ])
    // '前'=1，'D'=2，'I'=3，'N'=4。
    expect(deleteDecision(marked, { from: 2, to: 3 }, type)).toBe('keep')
    expect(deleteDecision(marked, { from: 3, to: 4 }, type)).toBe('drop')
    expect(deleteDecision(marked, { from: 4, to: 5 }, type)).toBe('mark')
    // 只盖住一半 → 转成删除建议（不整段丢）。
    expect(deleteDecision(marked, { from: 1, to: 3 }, type)).toBe('mark')
  })

  it('deletionRange 捕获块内字符和跨段文本选区，文档两端没有删除目标', () => {
    const doc = docOf([{ text: 'abc' }])
    expect(deletionRange(stateOf(doc, 2), false)).toEqual({ from: 1, to: 2 })
    expect(deletionRange(stateOf(doc, 1), false)).toBeNull()
    expect(deletionRange(stateOf(doc, 2), true)).toEqual({ from: 2, to: 3 })
    expect(deletionRange(stateOf(doc, 4), true)).toBeNull()
    const twoBlocks = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, schema.text('ab')),
      schema.nodes.paragraph.create(null, schema.text('cd')),
    ])
    const cross = EditorState.create({ schema, doc: twoBlocks, selection: TextSelection.create(twoBlocks, 1, 6) })
    expect(deletionRange(cross, false)).toEqual({ from: 1, to: 6 })
  })

  it('adjacentRevisionId 只看光标前一个字符所在建议', () => {
    const doc = docOf([
      { text: 'ab', attrs: { revisionId: 'r1', author: 'u1', kind: 'insert' } },
      { text: 'cd' },
    ])
    // 'a'=1'b'=2 'c'=3 'd'=4：光标在 3 时前一个字符是 'b'（属于 r1）。
    expect(adjacentRevisionId(doc, 3, type)).toBe('r1')
    expect(adjacentRevisionId(doc, 1, type)).toBe('')
    expect(adjacentRevisionId(doc, 5, type)).toBe('')
    expect(adjacentRevisionId(doc, 3, null)).toBe('')
  })

  it('buildRevisionMarkTr 补 mark 且不进 undo 栈', () => {
    const doc = docOf([{ text: 'abc' }])
    const tr = buildRevisionMarkTr(stateOf(doc), { from: 1, to: 4 }, { revisionId: 'r1', author: 'u1', kind: 'insert' })
    expect(tr.getMeta('addToHistory')).toBe(false)
    expect(tr.getMeta(REVISION_TRACK_META)).toBe(true)
    expect(collectRevisions(tr.doc)).toHaveLength(1)
    expect(buildRevisionMarkTr(stateOf(doc), { from: 2, to: 2 }, {})).toBeNull()
  })

  it('isBulkReplace 只对「单 step 覆盖整篇」成立', () => {
    const doc = docOf([{ text: 'abc' }])
    const state = stateOf(doc)
    const whole = state.tr.replaceWith(0, doc.content.size, schema.nodes.paragraph.create(null, schema.text('xyz')))
    expect(isBulkReplace(state, whole)).toBe(true)
    const partial = state.tr.insertText('x', 2)
    expect(isBulkReplace(state, partial)).toBe(false)
    expect(isBulkReplace(state, null)).toBe(false)
  })
})

describe('P4-06 规格层：CSS 与面板结构（07 §12.2 / §12.4 / §12.6）', () => {
  it('修订色写死 #0442D2，不引 --B700 一类中间变量', () => {
    expect(css).toContain('--ld-revision: #0442d2')
    expect(css).toContain('--ld-revision-halo: rgba(4, 66, 210, .1)')
    expect(css).toContain('--ld-revision-reject: #f54a45')
    expect(css).toContain('--ld-revision-accept: #35bd4b')
    expect(css).not.toContain('--B700-raw')
  })

  it('外层容器画 2px 下划线，删除线 2px、行高 19', () => {
    expect(css).toContain('.revision-container {')
    expect(css).toContain('border-bottom: 2px solid')
    expect(css).toContain('.text-revision.revision-linethrough { text-decoration: line-through')
    expect(css).toContain('text-decoration-thickness: 2px')
    expect(css).toContain('line-height: 19px')
    // 删除态文字不染色：色由正文继承，别在这里写死。
    expect(css).toContain('[data-revision-kind="delete"] > .text-revision { color: inherit')
  })

  it('面板三态 + 打印隐藏 + 层壳退出布局', () => {
    expect(css).toContain('.lark-doc-revision-layer { display: contents')
    expect(css).toContain('width: 270px; border-radius: 6px')
    expect(css).toContain('.lark-doc .lark-doc-revision-panel { display: none !important; }')
  })

  it('面板模板：六个按钮按序、无 title、无 more-btn、头像走兜底图标', () => {
    expect(panelUi).toContain('buttons.map')
    expect(panelUi).toContain('button.disabled')
    expect(panelUi).toContain('button.split')
    expect(panelUi).toContain('item.active')
    expect(panelUi).toContain('回复...')
    expect(panelUi).toContain("iconNode('rev-avatar', 18)")
    // 07 §12.4：原生按钮只写 aria-label，不写 title / data-tooltip。
    expect(panelUi).not.toContain('title=')
    expect(panelUi).not.toContain('data-tooltip=')
    // 07 §12.6：没有评论那颗 more-btn，也没有「已解决」概念。
    expect(panelUi).not.toContain('comment-moremenu')
    expect(panelUi).not.toContain('more-btn')
    expect(panelUi).not.toContain('resolved')
  })

  it('宿主接线：面板挂上、事务里刷新、模式切换同步 tracker', () => {
    expect(shell).toContain("const revisionHost = ownerDocument.createElement('div')")
    expect(nativeHost).toContain("['RevisionPanels', 'refreshRevisionPanels']")
    expect(nativeHost).toContain('host[`mount${domain}`]()')
    expect(nativeHost).toContain('host.updateRevisionPanels()')
    expect(panelMixin).toContain('this.refreshRevisionPanels()')
    expect(panelMixin).toContain('createRevisionPanels')
    expect(modeMixin).toContain('syncRevisionTracking')
    // 切模式不重建编辑器：只翻 storage.active。
    expect(modeMixin).not.toContain('new Editor')
  })

  it('作者兜底名是「我」（面板显示用）', () => {
    expect(REVISION_AUTHOR_NAME_FALLBACK).toBe('我')
    expect(REVISION_AUTHOR_FALLBACK).toBe('local-user')
  })
})
