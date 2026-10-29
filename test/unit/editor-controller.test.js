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
})
