import { describe, expect, it, vi } from 'vitest'
import { Schema } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import { history, undo, redo } from '@tiptap/pm/history'
import { BLOCK_ID_PATTERN, MAX_BLOCK_INDENT } from '../../src/core/documentOperations'
import { createEditorController } from '../../src/editor/EditorController'

function createEditor() {
  return {
    isEditable: true,
    getHTML: () => '<p>正文</p>',
    getJSON: () => ({ type: 'doc', content: [] }),
    getText: () => '正文',
    commands: { focus: vi.fn() },
    setEditable: vi.fn(),
    emit: vi.fn(),
    destroy: vi.fn(),
  }
}

describe('EditorController 阶段7前置', () => {
  it('保留 editor facade 的正文读取与 focus API', () => {
    const editor = createEditor()
    const controller = createEditorController({ editor })

    expect(controller.getEditor()).toBe(editor)
    expect(controller.getHTML()).toBe('<p>正文</p>')
    expect(controller.getJSON()).toEqual({ type: 'doc', content: [] })
    expect(controller.getText()).toBe('正文')
    controller.focus()
    expect(editor.commands.focus).toHaveBeenCalledTimes(1)
  })

  it('快照包加载失败时仍发布当前正文，取消的快照不回退', async () => {
    vi.doMock('../../src/editor/documentSnapshot', () => { throw new Error('optional bundle unavailable') })
    try {
      const editor = { ...createEditor(), state: { doc: {} } }
      const controller = createEditorController({ editor })
      await expect(controller.getSnapshotAsync()).resolves.toEqual({
        html: '<p>正文</p>', json: { type: 'doc', content: [] }, text: '正文',
      })
      const abort = new AbortController()
      const cancelled = controller.getSnapshotAsync({ signal: abort.signal })
      abort.abort()
      await expect(cancelled).resolves.toBeNull()
    } finally {
      vi.doUnmock('../../src/editor/documentSnapshot')
    }
  })

  it('集中 readonly 与 title 的无 Vue 状态逻辑', () => {
    const editor = createEditor()
    const controller = createEditorController({ editor, title: '旧标题' })

    expect(controller.getTitle()).toBe('旧标题')
    expect(controller.setTitle('新标题')).toBe('新标题')
    expect(controller.getTitle()).toBe('新标题')
    expect(controller.setReadonly(true)).toBe(true)
    expect(editor.setEditable).toHaveBeenCalledWith(false)
    expect(editor.emit).toHaveBeenCalledWith('editableUpdate', { editable: false })
    expect(controller.setReadonly(false)).toBe(true)
    expect(editor.setEditable).toHaveBeenLastCalledWith(true)
  })

  it('同一 editor state 复用正文快照，状态变化后再重新序列化', () => {
    const editor = createEditor()
    editor.state = {}
    const html = vi.spyOn(editor, 'getHTML')
    const json = vi.spyOn(editor, 'getJSON')
    const text = vi.spyOn(editor, 'getText')
    const controller = createEditorController({ editor })

    controller.getHTML(); controller.getJSON(); controller.getText()
    controller.getHTML(); controller.getJSON(); controller.getText()
    expect(html).toHaveBeenCalledTimes(1)
    expect(json).toHaveBeenCalledTimes(1)
    expect(text).toHaveBeenCalledTimes(1)

    editor.state = {}
    controller.getJSON()
    expect(json).toHaveBeenCalledTimes(2)
  })

  it('destroy 负责 detach、editor cleanup，并且可幂等调用', () => {
    const editor = createEditor()
    const session = { detachEditor: vi.fn() }
    const cleanup = vi.fn()
    const controller = createEditorController({ editor, session })

    controller.destroy(cleanup)
    controller.destroy(cleanup)

    expect(session.detachEditor).toHaveBeenCalledTimes(1)
    expect(session.detachEditor).toHaveBeenCalledWith(editor)
    expect(editor.destroy).toHaveBeenCalledTimes(1)
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(controller.getEditor()).toBeNull()
  })

  it('按doc身份缓存各格式，选区变化不失效；导出对象由调用方独立持有', () => {
    const editor = createEditor()
    const doc = {}
    editor.state = { doc }
    const html = vi.spyOn(editor, 'getHTML')
    const json = vi.spyOn(editor, 'getJSON')
    const text = vi.spyOn(editor, 'getText')
    const controller = createEditorController({ editor })
    controller.getText()
    expect(html).not.toHaveBeenCalled()
    expect(json).not.toHaveBeenCalled()
    editor.state = { doc }
    controller.getText()
    expect(text).toHaveBeenCalledTimes(1)
    const first = controller.getJSON()
    first.content.push({ type: 'paragraph' })
    expect(controller.getJSON().content).toEqual([])
  })

  function importFixture(deferNormalization = true) {
    const schema = new Schema({ nodes: {
      doc: { content: 'paragraph+' }, text: {},
      paragraph: { content: 'text*', attrs: { blockId: { default: null }, indent: { default: 0 }, custom: { default: 'keep' } } },
    } })
    const before = schema.node('doc', null, [schema.node('paragraph', null, schema.text('原正文'))])
    const next = schema.node('doc', null, Array.from({ length: 40 }, (_, i) => schema.node('paragraph',
      { blockId: i < 2 ? 'existing' : null, indent: i === 2 ? 999 : 0 }, schema.text(`${i}` + '文'.repeat(13000)))))
    const transactions = [], idle = vi.fn(), after = vi.fn()
    const editor = {
      isEditable: true,
      state: EditorState.create({ schema, doc: before, plugins: [history()] }),
      storage: { larkDoc: { deferNormalization } },
      view: { dom: { ownerDocument: { defaultView: { requestIdleCallback: idle } } }, updateState(state) { editor.state = state }, dispatch(tr) {
        transactions.push(tr); editor.state = editor.state.apply(tr)
      } },
      commands: { resetLarkDocFolds: vi.fn(), ensureLarkDocBlockIds: vi.fn(() => false), normalizeLarkDocIndents: vi.fn(() => false) },
      destroy: vi.fn(),
    }
    return { before, next, editor, transactions, idle, after, controller: createEditorController({ editor, onAfterContentReplace: after }) }
  }

  it('异步导入分页提交，跨定时让行仍是一笔undo，首次编辑独立撤销', async () => {
    const { before, editor, controller, next, transactions } = importFixture()
    editor.schema = editor.state.schema
    const json = next.toJSON()
    json.content[2].attrs.indent = 8
    const result = await controller.setContentAsync(json, { pageBlocks: 8, yieldToMain: async () => {} })
    expect(result).toBe(true)
    const imports = transactions.filter(tr => tr.docChanged)
    expect(imports).toHaveLength(5)
    expect(imports.slice(1).every(tr => tr.steps[0].slice.content.childCount <= 8)).toBe(true)
    const imported = editor.state.doc
    editor.view.dispatch(editor.state.tr.insertText('after', 1))
    expect(undo(editor.state, editor.view.dispatch)).toBe(true)
    expect(editor.state.doc.eq(imported)).toBe(true)
    expect(undo(editor.state, editor.view.dispatch)).toBe(true)
    expect(editor.state.doc.eq(before)).toBe(true)
    expect(redo(editor.state, editor.view.dispatch)).toBe(true)
    expect(editor.state.doc.eq(imported)).toBe(true)
    const ids = []
    imported.descendants(node => { if (node.attrs.blockId) ids.push(node.attrs.blockId) })
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('分页提交拒绝并发命令和公开快照，取消完整恢复state及已有redo', async () => {
    const { before, editor, controller, next } = importFixture()
    editor.schema = editor.state.schema
    editor.view.dispatch(editor.state.tr.insertText('redo', 1))
    undo(editor.state, editor.view.dispatch)
    const original = editor.state, signal = new AbortController()
    let partial = false
    const json = next.toJSON()
    json.content[2].attrs.indent = 8
    await expect(controller.setContentAsync(json, { pageBlocks: 8, signal: signal.signal,
      yieldToMain: async () => {
        if (editor.state.doc.eq(before)) return
        partial = true
        const current = editor.state.doc
        editor.view.dispatch(editor.state.tr.insertText('blocked', 1))
        expect(editor.state.doc).toBe(current)
        expect(() => controller.getJSON()).toThrow('导入提交中')
        signal.abort()
      },
    })).rejects.toMatchObject({ name: 'AbortError' })
    expect(partial).toBe(true)
    expect(editor.state).toBe(original)
    expect(redo(editor.state, editor.view.dispatch)).toBe(true)
    expect(editor.state.doc.textContent).toContain('redo')
  })

  it('分页preflight失败不写入正文，事务被过滤时恢复原state', async () => {
    const { editor, controller } = importFixture()
    editor.schema = editor.state.schema
    const before = editor.state
    await expect(controller.setContentAsync({ type: 'doc', content: [{ type: 'paragraph' }, { type: 'text', text: '' }] },
      { pageBlocks: 1, yieldToMain: async () => {} })).rejects.toThrow()
    expect(editor.state).toBe(before)
    editor.view.dispatch = () => {}
    await expect(controller.setContentAsync({ type: 'doc', content: [{ type: 'paragraph' }] },
      { pageBlocks: 1, yieldToMain: async () => {} })).rejects.toThrow('拒绝')
    expect(editor.state).toBe(before)
  })

  it('大文档首次挂载已具备唯一块ID和合法缩进，不再排队全文属性事务，导入仍可撤销', () => {
    const { before, next, editor, transactions, idle, after, controller } = importFixture()
    expect(controller.applyPreparedContent({ next, report: null })).toBe(true)
    const normalized = editor.state.doc
    const ids = []
    normalized.forEach(node => {
      ids.push(node.attrs.blockId)
      expect(BLOCK_ID_PATTERN.test(node.attrs.blockId)).toBe(true)
      expect(node.attrs.custom).toBe('keep')
    })
    expect(new Set(ids).size).toBe(40)
    expect(ids[0]).toBe('existing')
    expect(normalized.child(2).attrs.indent).toBe(MAX_BLOCK_INDENT)
    expect(next.child(2).attrs).toMatchObject({ blockId: null, indent: 999 })
    expect(normalized.textContent).toBe(next.textContent)
    const changes = transactions.filter(tr => tr.docChanged)
    expect(changes).toHaveLength(1)
    expect(changes[0].steps).toHaveLength(1)
    expect(changes[0].doc.eq(normalized)).toBe(true)
    expect(changes[0].getMeta('addToHistory')).not.toBe(false)
    expect(editor.commands.ensureLarkDocBlockIds).not.toHaveBeenCalled()
    expect(editor.commands.normalizeLarkDocIndents).not.toHaveBeenCalled()
    expect(idle).not.toHaveBeenCalled()
    expect(after).toHaveBeenCalledTimes(1)
    const dispatch = tr => { editor.state = editor.state.apply(tr) }
    expect(undo(editor.state, dispatch)).toBe(true)
    expect(editor.state.doc.eq(before)).toBe(true)
    expect(redo(editor.state, dispatch)).toBe(true)
    expect(editor.state.doc.eq(normalized)).toBe(true)
    controller.destroy()
  })

  it('协同禁用本地批量归一化时，继续由原生命令同步处理，不改写导入模型', () => {
    const { next, editor, transactions, idle, controller } = importFixture(false)
    expect(controller.applyPreparedContent({ next })).toBe(true)
    expect(transactions.find(tr => tr.docChanged).doc.eq(next)).toBe(true)
    expect(editor.commands.ensureLarkDocBlockIds).toHaveBeenCalledTimes(1)
    expect(editor.commands.normalizeLarkDocIndents).toHaveBeenCalledTimes(1)
    expect(idle).not.toHaveBeenCalled()
    controller.destroy()
  })

  it.each(['replace', 'destroy', 'abort'])('快照模块加载期间%s，不返回另一份文档的快照', async action => {
    const editor = createEditor()
    editor.state = { doc: {} }
    const controller = createEditorController({ editor })
    const abort = new AbortController()
    const pending = controller.getSnapshotAsync({ signal: abort.signal })
    if (action === 'replace') editor.state = { doc: {} }
    if (action === 'destroy') controller.destroy()
    if (action === 'abort') abort.abort()
    expect(await pending).toBeNull()
    controller.destroy()
  })
})
