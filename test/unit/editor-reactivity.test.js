// @vitest-environment jsdom
import { Editor } from '@tiptap/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDomRenderer } from '../../src/mount/domRenderer'
import blockHandleMixin from '../../src/components/lark-doc/editor/blockHandleMixin'
import tableToolsMixin from '../../src/components/lark-doc/editor/tableToolsMixin'
import commentsMixin from '../../src/components/lark-doc/editor/commentsMixin'
import revisionMixin from '../../src/components/lark-doc/editor/revisionMixin'
import { createCodeBlockNodeView } from '../../src/core/nodeviews/code-block'
import { getNodeView, setNodeView } from '../../src/core/nodeviews/registry'

const hosts = []
const codeViews = []
let previousCodeNodeView

async function tick() {
  await Promise.resolve()
  await Promise.resolve()
}

function mountEditor(props = {}) {
  const renderer = createDomRenderer()
  const element = document.createElement('div')
  document.body.appendChild(element)
  const handle = renderer.mount({ element, props: {
    initialContent: '<p>plain</p><h2>heading</h2><p><strong>bold</strong> normal</p>',
    storage: 'none',
    config: { layout: { toolbarVisible: true }, modes: { persist: false }, performance: { stateUpdateFrame: false, changeDebounce: 0 } },
    ...props,
  } })
  const vm = handle.nativeHost.host
  vm.$el = renderer.getRoot(handle)
  vm.$frame = { requestFrame: vi.fn(() => 1), cancelFrame: vi.fn() }
  const destroy = () => renderer.destroy(handle)
  hosts.push(() => { destroy(); element.remove() })
  expect(vm.error).toBe('')
  expect(vm.editor).toBeInstanceOf(Editor)
  return { vm, handle, destroy }
}

function expectRawEditor(editor) {
  const { state, view, schema } = editor
  const objects = [
    editor, editor.options, editor.options.extensions, editor.extensionManager,
    editor.extensionManager.extensions, editor.commandManager, editor.storage,
    schema, schema.nodes, schema.marks, state, state.config, state.plugins,
    state.doc, state.doc.content, state.doc.content.content, state.selection,
    state.selection.$from, view, view.props,
    ...editor.extensionManager.extensions, ...Object.values(editor.storage),
    ...state.plugins, ...state.plugins.map((plugin) => plugin.getState(state)),
  ]
  state.doc.descendants((node) => objects.push(node, node.attrs, node.content, node.marks, ...node.marks))
  for (const [index, object] of objects.entries()) {
    if (object && typeof object === 'object') expect(Object.hasOwn(object, '__ob__'), `${index}: ${object.constructor?.name}`).toBe(false)
  }
  expect(Object.isExtensible(editor)).toBe(true)
  expect(Object.isExtensible(state)).toBe(true)
}

const button = (vm, label) => vm.$el.querySelector(`button[aria-label="${label}"]`)
const boldChecked = (vm) => vm.toolbarSections.find((section) => section.id === 'marks').items.find((item) => item.label === '加粗').checked

beforeEach(() => {
  previousCodeNodeView = getNodeView('codeBlock')
  setNodeView('codeBlock', (props) => {
    const nodeView = createCodeBlockNodeView(props)
    vi.spyOn(nodeView, 'update')
    vi.spyOn(nodeView, 'destroy')
    codeViews.push(nodeView)
    return nodeView
  })
})

afterEach(() => {
  hosts.splice(0).reverse().forEach((cleanup) => cleanup())
  codeViews.length = 0
  setNodeView('codeBlock', previousCodeNodeView)
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('原生编辑器响应式边界', () => {
  it('真实挂载原生代码块 NodeView，不递归遍历 schema 循环且正常销毁', async () => {
    const { vm, handle, destroy } = mountEditor({ initialContent: '<pre><code class="language-plaintext">hello</code></pre>' })
    await tick()
    const node = vm.editor.state.doc.firstChild
    const codeView = codeViews.find((view) => vm.$el.contains(view.dom))
    codeView.update.mockClear()
    expect(node.type.schema.nodes.codeBlock).toBe(node.type)
    expect(vm.editor).toBe(handle.editor)
    expectRawEditor(vm.editor)
    expect(vm.$el.querySelector('.ProseMirror .lark-doc-code')).toBe(codeView.dom)
    expect(codeView.contentDOM.textContent).toBe('hello')
    const highlight = codeView.dom.querySelector('.lark-doc-code-highlight code')
    const mutations = []
    const observer = new MutationObserver((records) => mutations.push(...records))
    observer.observe(highlight, { childList: true, characterData: true, subtree: true })
    try {
      vm.editor.commands.setTextSelection({ from: 1, to: 3 })
      await tick()
      expect(vm.hasTextSelection).toBe(true)
      expect(button(vm, '设置链接').disabled).toBe(false)
      expect(codeView.update).not.toHaveBeenCalled()
      expect(mutations).toEqual([])

      vm.editor.commands.insertContentAt(1, '<new>')
      await tick()
      expect(vm.editor.state.doc.firstChild).not.toBe(node)
      expect(codeView.contentDOM.textContent).toBe('<new>hello')
      expect(highlight.textContent).toBe('<new>hello')
      expect(highlight.querySelector('new')).toBeNull()
      expect(codeView.update).toHaveBeenCalledTimes(1)
      expectRawEditor(vm.editor)

      expect(codeView.setLanguage('mermaid')).toBe(true)
      expect(codeView.getState().showPreview).toBe(true)
      expect(codeView.dom.querySelector('.lark-doc-diagram')).not.toBeNull()
      expect(codeView.setLanguage('plaintext')).toBe(true)
      expect(codeView.getState().showPreview).toBe(false)
      expect(codeView.dom.querySelector('.lark-doc-diagram')).toBeNull()
      const editor = vm.editor
      destroy()
      expect(codeView.destroy).toHaveBeenCalledTimes(1)
      expect(editor.isDestroyed).toBe(true)
      expect(handle.root.isConnected).toBe(false)
    } finally { observer.disconnect() }
  })

  it('Vditor 图表和普通代码块首次挂载及替换正文均创建真实 NodeView', async () => {
    const { vm } = mountEditor({ initialContent: '<div class="language-mermaid">graph TD\n A --&gt; B</div><pre><code class="language-plaintext">hello</code></pre>' })
    await tick()
    expect(vm.$el.querySelectorAll('.ProseMirror .lark-doc-code')).toHaveLength(2)
    expect(vm.$el.querySelector('.lark-doc-code-diagram .lark-doc-diagram')).not.toBeNull()
    expect(vm.$el.querySelector('.lark-doc-code-input').textContent).toContain('graph TD')
    expect(codeViews.filter((view) => vm.$el.contains(view.dom))).toHaveLength(2)
    expectRawEditor(vm.editor)
    vm.editor.commands.setContent('<p>replacement</p>')
    await tick()
    expect(vm.$el.querySelectorAll('.lark-doc-code')).toHaveLength(0)
    expect(vm.$el.querySelector('.ProseMirror').textContent).toBe('replacement')
    codeViews.forEach((view) => expect(view.destroy).toHaveBeenCalledTimes(1))
    vm.editor.commands.setContent('<pre><code class="language-plaintext">again</code></pre>')
    await tick()
    expect(codeViews.filter((view) => vm.$el.contains(view.dom))).toHaveLength(1)
    expect(vm.$el.querySelector('.lark-doc-code-input').textContent).toBe('again')
    expectRawEditor(vm.editor)
  })

  it.each(['editor', 'host', 'removed'])('滚动帧排队后销毁 %s，不再访问 view 或更新浮层', async (target) => {
    const { vm, destroy } = mountEditor()
    await tick()
    let frame
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => { frame = callback; return 1 })
    const original = vm.editor
    const readView = vi.fn(() => { throw new Error('不应访问已销毁 view') })
    const editor = { isDestroyed: false, get view() { return readView() } }
    const update = vi.spyOn(vm, 'updateTableBoundary')
    const highlight = vi.spyOn(vm, 'syncHandleHighlightBackdrop')
    vm.onDocumentScroll()
    expect(frame).toBeTypeOf('function')
    if (target === 'host') destroy()
    else vm.editor = target === 'removed' ? null : editor
    editor.isDestroyed = true
    update.mockClear()
    highlight.mockClear()
    try {
      expect(() => frame()).not.toThrow()
      expect(readView).not.toHaveBeenCalled()
      expect(update).not.toHaveBeenCalled()
      expect(highlight).not.toHaveBeenCalled()
      if (target !== 'host') expect(vm._outlineFrame).toBeNull()
    } finally { if (target !== 'host') vm.editor = original }
  })

  it.each([
    ['句柄背景', blockHandleMixin.methods.syncHandleHighlightBackdrop],
    ['表格裁切', tableToolsMixin.methods.syncTableClip],
    ['评论面板', commentsMixin.methods.placeCommentPanels],
    ['修订面板', revisionMixin.methods.placeRevisionPanels],
  ])('%s 的延迟刷新在 editor 或宿主销毁后不读取 view', (name, method) => {
    const readView = vi.fn(() => { throw new Error('不应访问已销毁 view') })
    for (const flags of [{}, { _isBeingDestroyed: true }, { _isDestroyed: true }]) {
      const vm = {
        editor: { isDestroyed: Object.keys(flags).length === 0, get view() { return readView() } },
        commentPanels: [{}], revisionPanels: [{}], ...flags,
      }
      expect(() => method.call(vm)).not.toThrow()
    }
    expect(readView).not.toHaveBeenCalled()
  })

  it('原生宿主的句柄与表格延迟刷新在 editor 销毁后不读取 view', async () => {
    const { vm } = mountEditor()
    await tick()
    const original = vm.editor
    const readView = vi.fn(() => { throw new Error('不应访问已销毁 view') })
    const update = vi.spyOn(vm, 'updateTableBoundary')
    vm.editor = { isDestroyed: true, get view() { return readView() } }
    try {
      expect(() => vm.updateHandleAndTable()).not.toThrow()
      expect(readView).not.toHaveBeenCalled()
      expect(update).not.toHaveBeenCalled()
    } finally { vm.editor = original }
  })

  it.each([
    ['评论', commentsMixin, 'onCommentViewportChange', 'onCommentPointerDown'],
    ['修订', revisionMixin, 'onRevisionViewportChange', 'onRevisionPointerDown'],
  ])('%s 的挂载回调晚于销毁时不绑定 DOM，清理也不读取失效 view', (name, mixin, viewport, pointer) => {
    let nextTick
    const readView = vi.fn(() => { throw new Error('不应访问已销毁 view') })
    const editor = { isDestroyed: false, get view() { return readView() } }
    const vm = {
      editor, $nextTick: (callback) => { nextTick = callback },
      [viewport]: vi.fn(), [pointer]: vi.fn(),
      loadComments: vi.fn(), syncRevisionTracking: vi.fn(), updateRevisionPanels: vi.fn(),
    }
    mixin.mounted.call(vm)
    editor.isDestroyed = true
    try {
      expect(() => nextTick()).not.toThrow()
      expect(vm.loadComments).not.toHaveBeenCalled()
      expect(vm.syncRevisionTracking).not.toHaveBeenCalled()
    } finally { expect(() => mixin.beforeDestroy.call(vm)).not.toThrow() }
    expect(readView).not.toHaveBeenCalled()
  })

  it('清除句柄高亮排队的 nextTick 晚于 editor 销毁时不读取 view', () => {
    let nextTick
    const readView = vi.fn(() => { throw new Error('不应访问已销毁 view') })
    const editor = {
      isDestroyed: false, get view() { return readView() },
      storage: { larkDoc: { handleHover: { from: 0, to: 3 } } },
      commands: { setLarkDocHandleHover: vi.fn() },
    }
    const vm = { editor, $nextTick: (callback) => { nextTick = callback } }
    vm.syncHandleHighlightBackdrop = blockHandleMixin.methods.syncHandleHighlightBackdrop.bind(vm)
    blockHandleMixin.methods.clearHandleHighlight.call(vm)
    expect(editor.commands.setLarkDocHandleHover).toHaveBeenCalledWith(null)
    editor.isDestroyed = true
    expect(() => nextTick()).not.toThrow()
    expect(readView).not.toHaveBeenCalled()
  })

  it('表格首屏重试帧晚于 editor 销毁时不读取 view', () => {
    let frame
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => { frame = callback; return 1 })
    const dom = document.createElement('div')
    const readView = vi.fn(() => ({ dom }))
    const editor = { isDestroyed: false, get view() { return readView() } }
    const vm = { editor, $nextTick: (callback) => callback() }
    vm.syncTableClip = tableToolsMixin.methods.syncTableClip.bind(vm)
    tableToolsMixin.mounted.call(vm)
    editor.isDestroyed = true
    readView.mockImplementation(() => { throw new Error('不应访问已销毁 view') })
    try {
      expect(() => frame()).not.toThrow()
      expect(readView).toHaveBeenCalledTimes(1)
    } finally { tableToolsMixin.beforeDestroy.call(vm) }
  })

  it.each([
    ['评论', commentsMixin, 'onCommentViewportChange', 'onCommentPointerDown', '_commentEditorDom'],
    ['修订', revisionMixin, 'onRevisionViewportChange', 'onRevisionPointerDown', '_revisionEditorDom'],
  ])('%s 在 editor 提前销毁后仍从原 DOM 解除监听并释放引用', (name, mixin, viewport, pointer, domKey) => {
    const dom = document.createElement('div')
    const readView = vi.fn(() => ({ dom }))
    const editor = { isDestroyed: false, get view() { return readView() } }
    const vm = {
      editor, $nextTick: (callback) => callback(),
      [viewport]: vi.fn(), [pointer]: vi.fn(),
      loadComments: vi.fn(), syncRevisionTracking: vi.fn(), updateRevisionPanels: vi.fn(),
    }
    mixin.mounted.call(vm)
    expect(vm[domKey]).toBe(dom)
    dom.dispatchEvent(new Event('pointerdown'))
    expect(vm[pointer]).toHaveBeenCalledTimes(1)
    editor.isDestroyed = true
    readView.mockImplementation(() => { throw new Error('不应访问已销毁 view') })
    expect(() => mixin.beforeDestroy.call(vm)).not.toThrow()
    dom.dispatchEvent(new Event('pointerdown'))
    expect(vm[pointer]).toHaveBeenCalledTimes(1)
    expect(vm[domKey]).toBeNull()
    expect(readView).toHaveBeenCalledTimes(1)
  })

  it('真实 editor 销毁后的延迟 DOM 刷新不触发 Tiptap view 代理错误', async () => {
    const { vm, destroy } = mountEditor()
    await tick()
    const editor = vm.editor
    destroy()
    expect(editor.isDestroyed).toBe(true)
    const host = { editor, commentPanels: [{}], revisionPanels: [{}] }
    for (const method of [
      blockHandleMixin.methods.syncHandleHighlightBackdrop, tableToolsMixin.methods.syncTableClip,
      commentsMixin.methods.placeCommentPanels, revisionMixin.methods.placeRevisionPanels,
    ]) expect(() => method.call(host)).not.toThrow()
  })

  it('原生响应式容器接收 Editor 保留全部内部身份，也不冻结 editor/state', async () => {
    const { vm, handle, destroy } = mountEditor()
    await tick()
    const editor = handle.editor
    expect(vm.editor).toBe(editor)
    expect(handle.nativeHost.state.editor).toBe(editor)
    expect(vm.editor.state).toBe(editor.state)
    expect(vm.editor.view).toBe(editor.view)
    expect(vm.editor.schema).toBe(editor.schema)
    expectRawEditor(editor)
    const previousState = editor.state
    expect(editor.commands.insertContent('new')).toBe(true)
    expect(editor.state).not.toBe(previousState)
    expect(vm.editor.state).toBe(editor.state)
    expectRawEditor(editor)
    destroy()
    expect(editor.isDestroyed).toBe(true)
    expect(handle.instance).toBeNull()
    expect(vm._isDestroyed).toBe(true)
  })

  it('纯选区事务使已缓存 computed 和真实工具栏刷新，不依赖目录/字数变化', async () => {
    const { vm } = mountEditor()
    await tick()
    const editor = vm.editor
    const doc = editor.state.doc
    const outline = vm.outline
    const count = vm.wordCount
    const refresh = vi.spyOn(vm, 'refreshDocumentState')
    expect(vm.hasTextSelection).toBe(false)
    expect(vm.currentBlockLabel).toBe('正文')
    expect(vm.headingActiveLevel).toBeNull()
    expect(boldChecked(vm)).toBe(false)
    expect(button(vm, '设置链接').disabled).toBe(true)
    const headingPos = outline[0].pos + 1
    editor.commands.setTextSelection({ from: headingPos, to: headingPos + 2 })
    expect(vm.hasTextSelection).toBe(true)
    expect(vm.currentBlockLabel).toBe('H2')
    expect(vm.headingActiveLevel).toBe(2)
    await tick()
    expect(button(vm, '标题级别').textContent.trim()).toBe('H2')
    expect(button(vm, '设置链接').disabled).toBe(false)
    let boldPos
    doc.descendants((node, pos) => { if (node.isText && node.text === 'bold') boldPos = pos })
    editor.commands.setTextSelection(boldPos + 1)
    expect(vm.hasTextSelection).toBe(false)
    expect(vm.currentBlockLabel).toBe('正文')
    expect(vm.headingActiveLevel).toBeNull()
    expect(boldChecked(vm)).toBe(true)
    await tick()
    expect(button(vm, '加粗').getAttribute('aria-pressed')).toBe('true')
    expect(button(vm, '设置链接').disabled).toBe(true)
    expect(editor.state.doc).toBe(doc)
    expect(vm.outline).toBe(outline)
    expect(vm.wordCount).toBe(count)
    expect(vm.savedSelection).toBeNull()
    expect(refresh).not.toHaveBeenCalled()
    expect(vm.$frame.requestFrame).toHaveBeenCalledTimes(1)
    expectRawEditor(editor)
  })

  it('stored marks 和内容事务均刷新依赖，即使选区或字数不变', async () => {
    const { vm } = mountEditor()
    await tick()
    const editor = vm.editor
    const doc = editor.state.doc
    const selection = editor.state.selection
    const count = vm.wordCount
    const html = vm.html
    const selectionUpdate = vi.spyOn(vm, 'onSelectionUpdate')
    const refresh = vi.spyOn(vm, 'refreshDocumentState')
    expect(boldChecked(vm)).toBe(false)
    editor.commands.toggleBold()
    expect(editor.state.doc).toBe(doc)
    expect(editor.state.selection.eq(selection)).toBe(true)
    expect(selectionUpdate).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
    expect(boldChecked(vm)).toBe(true)
    await tick()
    expect(button(vm, '加粗').getAttribute('aria-pressed')).toBe('true')
    editor.commands.toggleBold()
    await tick()
    expect(boldChecked(vm)).toBe(false)
    expect(button(vm, '加粗').getAttribute('aria-pressed')).toBe('false')
    editor.commands.setHeading({ level: 3 })
    expect(editor.state.selection.eq(selection)).toBe(true)
    expect(selectionUpdate).not.toHaveBeenCalled()
    expect(vm.wordCount).toBe(count)
    expect(vm.html).not.toBe(html)
    expect(vm.html).toContain('<h3')
    expect(vm.currentBlockLabel).toBe('H3')
    expect(vm.headingActiveLevel).toBe(3)
    expect(refresh).toHaveBeenCalled()
    await tick()
    expect(button(vm, '标题级别').textContent.trim()).toBe('H3')
    editor.commands.insertContent('new')
    expect(vm.wordCount).toBe(count + 3)
    expect(vm.html).toContain('newplain')
    expectRawEditor(editor)
  })
})
