// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'

vi.mock('@tiptap/core', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    Editor: class FakeEditor {
      constructor(options) {
        this.options = options
        this.isEditable = options.editable !== false
        this.schema = {}
        this.state = { doc: { content: { size: 0 } } }
        this.commands = {
          focus: () => this,
          insertContent: () => true,
          undo: () => true,
          redo: () => true,
        }
        this.view = { dispatch: () => {} }
        this.storage = { larkDoc: {}, characterCount: { characters: () => 0 } }
        this.html = options.content || '<p></p>'
        options.element.innerHTML = this.html
      }
      getHTML() { return this.html }
      getJSON() { return { type: 'doc', content: [] } }
      getText() { return this.html.replace(/<[^>]+>/g, '') }
      setEditable(value) { this.isEditable = value }
      on() {}
      off() {}
      emit() {}
      destroy() {}
      chain() { return this.commands }
    },
  }
})
vi.mock('../../src/components/lark-doc/extensions', () => ({
  createLarkDocExtensions: () => [],
}))
vi.mock('../../src/mount/vueRenderer', () => ({
  createVue2Renderer: () => ({ name: 'vue2' }),
}))

import { createDomRenderer } from '../../src/mount/domRenderer'
import { createRenderer } from '../../src/mount'

const ACTIONS = ['mount', 'update', 'destroy', 'getInstance', 'getRoot']

function expectContract(renderer) {
  expect(Object.keys(renderer).filter(key => typeof renderer[key] === 'function')).toEqual(ACTIONS)
  ACTIONS.forEach(action => expect(typeof renderer[action]).toBe('function'))
}

describe('迁移期 DOM renderer 契约', () => {
  it('暴露且只暴露五个 renderer 动作', () => {
    expectContract(createDomRenderer())
  })

  it('在普通 DOM 宿主下创建等价根节点并提供实例', async () => {
    const host = document.createElement('div')
    const ready = vi.fn()
    const renderer = createDomRenderer()
    const handle = renderer.mount({
      element: host,
      props: { initialTitle: '迁移期文档', initialContent: '<p>正文</p>' },
      on: { ready },
    })

    expect(renderer.getRoot(handle)).toBe(host.firstElementChild)
    expect(renderer.getRoot(handle).className).toContain('lark-doc')
    expect(renderer.getRoot(handle).dataset.renderer).toBe('dom-migration')
    expect(renderer.getRoot(handle).querySelector('#lark-doc-editor')).not.toBeNull()
    expect(renderer.getInstance(handle)).toBe(handle.instance)
    const instance = renderer.getInstance(handle)
    expect(instance.getTitle()).toBe('迁移期文档')
    expect(instance.getText()).toContain('正文')
    ;[
      'getWorkspace', 'callWorkspace', 'record', 'onReady', 'queueSave', 'flushOnLeave', 'saveNow',
      'storageFailure', 'toggleHistory', 'createSnapshot', 'restoreSnapshot', 'importDocument',
      'exportDocument', 'currentAIContext', 'resetAIPreview', 'startAI', 'sendAIChat', 'regenerateAI',
      'stopAI', 'closeAI', 'copyAIPreview', 'acceptAI', 'insertAIResult', 'acceptReviewIssue',
      'ignoreReviewIssue', 'applyAIProposal',
    ].forEach((method) => expect(typeof instance[method]).toBe('function'))
    await Promise.resolve()
    expect(ready).toHaveBeenCalled()

    renderer.destroy(handle)
    expect(renderer.getRoot(handle)).toBeNull()
    expect(host.firstElementChild).toBeNull()
  })

  it('mount/index 默认保持 Vue，DOM renderer 只在显式 opt-in 时启用', () => {
    expect(createRenderer().name).toBe('vue2')
    expect(createRenderer({ renderer: 'dom' }).name).toBe('dom-migration')
  })
})
