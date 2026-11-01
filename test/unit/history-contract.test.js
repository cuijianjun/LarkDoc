// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { undoDepth } from '@tiptap/pm/history'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import { buildRevisionDecisionTr } from '../../src/core/revision/commands'

const editors = []
function editorOf(content) {
  const editor = new Editor({ extensions: createLarkDocExtensions(), content })
  editors.push(editor)
  return editor
}
afterEach(() => { while (editors.length) editors.pop().destroy() })
function typeAtTime(editor, text, time) {
  const pos = editor.state.doc.content.size - 1
  editor.view.dispatch(editor.state.tr.insertText(text, pos).setTime(time))
}

describe('历史栈契约', () => {
  it('非协同编辑器使用 800ms 分组窗口和 100 步深度', () => {
    const extension = createLarkDocExtensions().find(item => item.name === 'starterKit')
    expect(extension.options.undoRedo).toMatchObject({ newGroupDelay: 800, depth: 100 })
  })

  it('真实事务：800ms 内合并，超过窗口后分组', () => {
    const editor = editorOf('<p></p>')
    typeAtTime(editor, 'A', 1000)
    typeAtTime(editor, 'B', 1700)
    typeAtTime(editor, 'C', 2501)
    expect(undoDepth(editor.state)).toBe(2)
    expect(editor.commands.undo()).toBe(true)
    expect(editor.getText()).toBe('AB')
    expect(editor.commands.undo()).toBe(true)
    expect(editor.getText()).toBe('')
  })

  it('严格保留最近 100 组，而不是底层 history 的 120 组延迟裁剪', () => {
    const editor = editorOf('<p></p>')
    for (let index = 0; index < 105; index += 1) typeAtTime(editor, 'x', 1000 + index * 1000)
    expect(undoDepth(editor.state)).toBe(100)
    for (let index = 0; index < 100; index += 1) expect(editor.commands.undo()).toBe(true)
    expect(editor.commands.undo()).toBe(false)
    expect(editor.getText()).toBe('xxxxx')
    for (let index = 0; index < 100; index += 1) expect(editor.commands.redo()).toBe(true)
    expect(editor.commands.redo()).toBe(false)
    expect(editor.getText()).toHaveLength(105)
  })

  it.each(['accept', 'reject'])('%s 不进入历史，也不能通过 redo 恢复决策前状态', (action) => {
    const editor = editorOf({ type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'p1' }, content: [
      { type: 'text', text: '建议', marks: [{ type: 'revision', attrs: { revisionId: 'r1', kind: 'insert', author: 'a' } }] },
    ] }] })
    editor.view.dispatch(buildRevisionDecisionTr(editor.state, 'r1', action))
    expect(undoDepth(editor.state)).toBe(0)
    expect(editor.commands.undo()).toBe(false)
    expect(editor.commands.redo()).toBe(false)
    expect(editor.getText()).toBe(action === 'accept' ? '建议' : '')
  })

  it('撤销触发正常 update 保存，刷新加载正文但不恢复历史栈', () => {
    const editor = editorOf({ type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'stable' } }] })
    let saved
    editor.on('update', () => { saved = JSON.parse(JSON.stringify(editor.getJSON())) })
    typeAtTime(editor, '保留', 1000)
    typeAtTime(editor, '撤回', 2000)
    editor.commands.undo()
    expect(saved.content[0].content[0].text).toBe('保留')
    const reloaded = editorOf(saved)
    expect(reloaded.getJSON().content[0].attrs.blockId).toBe('stable')
    expect(reloaded.getText()).toBe('保留')
    expect(reloaded.commands.undo()).toBe(false)
  })

  it('协同编辑器不装本地 UndoRedo，避免远端事务进入本地历史', () => {
    const extension = createLarkDocExtensions({ collab: { extensions: [] } }).find(item => item.name === 'starterKit')
    expect(extension.options.undoRedo).toBe(false)
  })
})
