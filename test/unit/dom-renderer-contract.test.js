// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { createDomRenderer } from '../../src/mount/domRenderer'
import { createRenderer, setRenderer } from '../../src/mount'

const ACTIONS = ['mount', 'update', 'destroy', 'getInstance', 'getRoot']
const mounted = []

function mountRenderer(renderer, options) {
  document.body.appendChild(options.element)
  const handle = renderer.mount(options)
  mounted.push({ renderer, handle, host: options.element })
  return handle
}

afterEach(() => {
  mounted.splice(0).reverse().forEach(({ renderer, handle, host }) => {
    renderer.destroy(handle)
    host.remove()
  })
  vi.restoreAllMocks()
  localStorage.clear()
})

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
    const handle = mountRenderer(renderer, {
      element: host,
      props: { initialTitle: '迁移期文档', initialContent: '<p>正文</p>' },
      on: { ready },
    })

    expect(renderer.getRoot(handle)).toBe(host.firstElementChild)
    expect(renderer.getRoot(handle).className).toContain('lark-doc')
    expect(renderer.getRoot(handle).dataset.renderer).toBe('dom-migration')
    expect(renderer.getRoot(handle).querySelector('#lark-doc-editor')).not.toBeNull()
    expect(renderer.getRoot(handle).querySelector('.lark-doc-actions-host')).not.toBeNull()
    expect(renderer.getRoot(handle).querySelector('.lark-doc-external-panel')).not.toBeNull()
    expect(renderer.getInstance(handle)).toBe(handle.instance)
    const instance = renderer.getInstance(handle)
    expect(handle.editor).toBeInstanceOf(Editor)
    expect(handle.editor.state.selection).toBeInstanceOf(TextSelection)
    expect(handle.editor.state.doc.textContent).toBe('正文')
    expect(instance.getTitle()).toBe('迁移期文档')
    expect(instance.getText()).toContain('正文')
    ;[
      'getWorkspace', 'callWorkspace', 'record', 'onReady', 'queueSave', 'flushOnLeave', 'saveNow',
      'storageFailure', 'toggleHistory', 'createSnapshot', 'restoreSnapshot', 'importDocument',
      'exportDocument', 'currentAIContext', 'resetAIPreview', 'startAI', 'sendAIChat', 'regenerateAI',
      'stopAI', 'closeAI', 'copyAIPreview', 'acceptAI', 'insertAIResult', 'acceptReviewIssue',
      'ignoreReviewIssue', 'applyAIProposal', 'toggleSlides', 'isSlides',
    ].forEach((method) => expect(typeof instance[method]).toBe('function'))
    await Promise.resolve()
    expect(ready).toHaveBeenCalled()

    renderer.destroy(handle)
    expect(renderer.getRoot(handle)).toBeNull()
    expect(host.firstElementChild).toBeNull()
  })

  it('DOM renderer 的演示模式复用 stage DOM 契约并支持退出', async () => {
    const host = document.createElement('div')
    const renderer = createDomRenderer()
    const handle = mountRenderer(renderer, {
      element: host,
      props: { initialTitle: '演示文档', initialContent: '<p>正文</p>' },
    })
    const instance = renderer.getInstance(handle)
    const root = renderer.getRoot(handle)

    expect(root.querySelector('.lark-doc-slide-stage')).toBeNull()
    instance.toggleSlides()
    expect(instance.isSlides()).toBe(true)
    expect(root.classList.contains('lark-doc-slides')).toBe(true)
    expect(root.querySelector('.lark-doc-paper').style.display).toBe('none')
    expect(root.querySelector('.lark-doc-slide-stage')?.textContent).toContain('演示文档')
    expect(root.querySelectorAll('.lark-doc-slide-stage button')).toHaveLength(3)

    const next = root.querySelector('.lark-doc-slide-stage button:nth-child(2)')
    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(root.querySelector('.lark-doc-slide-counter').textContent).toBe('1 / 1')
    expect(next.disabled).toBe(true)

    root.querySelector('.lark-doc-slide-stage button:last-child').click()
    expect(instance.isSlides()).toBe(false)
    await Promise.resolve()
    expect(root.querySelector('.lark-doc-slide-stage')).toBeNull()
    expect(root.querySelector('.lark-doc-paper').style.display).toBe('')

    await Promise.resolve()
    renderer.destroy(handle)
  })

  it('工具栏投影使用真实 marks/options，并按配置裁剪入口', async () => {
    const host = document.createElement('div')
    const renderer = createDomRenderer()
    const handle = mountRenderer(renderer, {
      element: host,
      props: {
        initialContent: '<p>正文</p>',
        config: { toolbar: { marksAllow: ['bold', 'strike'] }, features: { ai: false, outline: false } },
      },
    })
    await Promise.resolve()
    const root = renderer.getRoot(handle)
    expect(root.querySelectorAll('.lark-doc-mark-bold')).toHaveLength(1)
    expect(root.querySelectorAll('.lark-doc-mark-strike')).toHaveLength(1)
    expect(root.querySelectorAll('.lark-doc-mark-italic')).toHaveLength(0)
    expect(root.querySelector('[aria-label="字体"]')).not.toBeNull()
    expect(root.querySelector('[aria-label="字号"]')).not.toBeNull()
    expect(root.querySelector('[aria-label="目录"]')).toBeNull()
    expect(root.querySelector('[aria-label="AI 助手"]')).toBeNull()
    renderer.destroy(handle)
  })

  it('正文标题切换走 setParagraph，清除格式同时清节点', async () => {
    const host = document.createElement('div')
    const renderer = createDomRenderer()
    const handle = mountRenderer(renderer, { element: host, props: { initialContent: '<p>正文</p>' } })
    await Promise.resolve()
    const root = renderer.getRoot(handle)
    const editor = handle.editor
    const commands = editor.commandManager.rawCommands
    const setParagraph = vi.spyOn(commands, 'setParagraph')
    const unsetAllMarks = vi.spyOn(commands, 'unsetAllMarks')
    const clearNodes = vi.spyOn(commands, 'clearNodes')
    editor.commands.setHeading({ level: 2 })
    editor.commands.setTextSelection({ from: 1, to: 3 })
    editor.commands.toggleBold()
    expect(editor.isActive('heading', { level: 2 })).toBe(true)
    expect(editor.isActive('bold')).toBe(true)
    root.querySelector('[aria-label="标题级别"]').click()
    await Promise.resolve()
    root.querySelector('.lark-doc-heading-menu button').click()
    root.querySelector('[aria-label="清除格式"]').click()
    expect(setParagraph).toHaveBeenCalledWith()
    expect(unsetAllMarks).toHaveBeenCalledWith()
    expect(clearNodes).toHaveBeenCalledWith()
    expect(editor.isActive('paragraph')).toBe(true)
    expect(editor.isActive('bold')).toBe(false)
    expect(editor.state.doc.textContent).toBe('正文')
    renderer.destroy(handle)
  })

  it('update props 触发重新投影，destroy 后不再接受延迟刷新', async () => {
    const host = document.createElement('div')
    const renderer = createDomRenderer()
    const handle = mountRenderer(renderer, { element: host, props: { initialContent: '<p>正文</p>' } })
    renderer.update(handle, { config: { features: { marks: false } } })
    await Promise.resolve()
    expect(renderer.getRoot(handle).querySelector('.lark-doc-mark-bold')).toBeNull()
    renderer.destroy(handle)
    handle.requestRender()
    await Promise.resolve()
    expect(renderer.getRoot(handle)).toBeNull()
  })

  it('mount/index 默认使用 DOM，Vue renderer 必须由宿主显式注入', () => {
    expect(createRenderer().name).toBe('dom-migration')
    expect(() => createRenderer({ renderer: 'vue2' })).toThrow(/隔离/)
    expect(createRenderer({ rendererFactory: createDomRenderer }).name).toBe('dom-migration')
    expect(typeof setRenderer).toBe('function')
    setRenderer(null)
  })
})
