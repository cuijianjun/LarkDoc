import { describe, expect, it, vi } from 'vitest'
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
})
