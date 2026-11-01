// @vitest-environment jsdom
import fs from 'fs'
import path from 'path'
import { transformSync } from '@babel/core'
import compiler from 'vue-template-compiler'
import Vue, * as vue from 'vue'
import * as tiptap from '@tiptap/vue-2'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as extensions from '../../src/components/lark-doc/extensions'
import * as documentOperations from '../../src/components/lark-doc/documentOperations'
import * as larkDocConfig from '../../src/components/lark-doc/larkDocConfig'
import * as legacy from '../../src/legacy'
import selectionPacingMixin from '../../src/components/lark-doc/editor/selectionPacingMixin'
import blockHandleMixin from '../../src/components/lark-doc/editor/blockHandleMixin'
import tableToolsMixin from '../../src/components/lark-doc/editor/tableToolsMixin'
import commentsMixin from '../../src/components/lark-doc/editor/commentsMixin'
import revisionMixin from '../../src/components/lark-doc/editor/revisionMixin'
import toolbarMenusMixin from '../../src/components/lark-doc/editor/toolbarMenusMixin'
import toolbarCollapseMixin from '../../src/components/lark-doc/editor/toolbarCollapseMixin'
import viewModesMixin from '../../src/components/lark-doc/editor/viewModesMixin'
import * as diagram from '../../src/components/lark-doc/diagram'
import * as themeSignal from '../../src/components/lark-doc/themeSignal'
import * as codeLanguages from '../../src/components/lark-doc/editor/codeLanguages'
import * as codeLangSignal from '../../src/components/lark-doc/editor/codeLangSignal'
import { getNodeView, setNodeView } from '../../src/core/nodeviews/registry'

// 保留 .vue 导入门禁：执行真实 SFC 脚本与模板，真实挂载 EditorContent 和代码块 NodeView。
function loadOptions(relative, dependencies = {}) {
  const filename = path.resolve(__dirname, '../../src/components/lark-doc', relative)
  const content = fs.readFileSync(filename, 'utf8')
  const source = filename.endsWith('.vue') ? compiler.parseComponent(content) : null
  const { code } = transformSync(source ? source.script.content : content, {
    filename, babelrc: false, configFile: false,
    plugins: ['@babel/plugin-transform-modules-commonjs'],
  })
  const exports = {}
  new Function('require', 'exports', code)((name) => dependencies[name] || {}, exports)
  return { options: exports.default || exports, template: source?.template.content }
}

const { options: component } = loadOptions('LarkDocEditor.vue', {
  vue,
  '@tiptap/vue-2': tiptap,
  './extensions': extensions,
  './documentOperations': documentOperations,
  './larkDocConfig': larkDocConfig,
  '../../legacy': legacy,
  '../../adapters/vue2/nodeviews': { registerVue2NodeViews() {} },
})
const toolbar = loadOptions('editor/ToolbarBar.vue')
const ToolbarBar = {
  ...toolbar.options,
  ...compiler.compileToFunctions(toolbar.template),
  components: {
    LarkDocIcon: { render: (h) => h('i') },
    LarkDocSelect: { render: (h) => h('span') },
    LarkDocHeadingMenu: { render: (h) => h('span') },
  },
}
const codeNode = loadOptions('../../adapters/vue2/CodeNode.vue', {
  '@tiptap/vue-2': tiptap,
  '../../components/lark-doc/diagram': diagram,
  '../../components/lark-doc/themeSignal': themeSignal,
  '../../components/lark-doc/documentOperations': documentOperations,
  '../../components/lark-doc/editor/codeLanguages': codeLanguages,
  '../../components/lark-doc/editor/codeLangSignal': codeLangSignal,
})
const CodeNode = { ...codeNode.options, ...compiler.compileToFunctions(codeNode.template) }
const { options: nodeViews } = loadOptions('../../adapters/vue2/nodeviews.js', {
  vue,
  '@tiptap/vue-2': tiptap,
  '../../registry/nodeviews': { setNodeView },
  './CodeNode.vue': { __esModule: true, default: CodeNode },
})
const hosts = []
let previousCodeNodeView
let previousErrorHandler
let vueErrors

function mountEditor(propsData = {}) {
  const noops = Object.fromEntries([
    'restoreMode', 'restoreFolds', 'persistFolds', 'updateRevisionPanels',
    'syncHandleHighlightBackdrop', 'syncTableClip', 'updateTableBoundary',
    'clearTableBoundaryHover', 'updateHandleAndTable', 'clearHandleHighlight',
    'closeBubbleAlignMenu', 'closeCommandMenu', 'onFullscreenChange',
    'onWindowKeydown', 'onHandlePointerUp', 'onDocumentPointerDown', 'onDocumentScroll',
  ].map((name) => [name, vi.fn()]))
  const vm = new Vue({
    props: component.props,
    propsData: {
      value: '<p>plain</p><h2>heading</h2><p><strong>bold</strong> normal</p>',
      config: { performance: { stateUpdateFrame: false, changeDebounce: 0 } },
      ...propsData,
    },
    data() {
      return Vue.observable({
        ...viewModesMixin.data.call(this),
        ...toolbarMenusMixin.data.call(this),
        ...toolbarCollapseMixin.data.call(this),
        ...component.data.call(this),
      })
    },
    computed: {
      ...component.computed,
      ...toolbarMenusMixin.computed,
      ...toolbarCollapseMixin.computed,
    },
    beforeDestroy: [selectionPacingMixin.beforeDestroy, component.beforeDestroy, toolbarMenusMixin.beforeDestroy],
    destroyed: component.destroyed,
    methods: {
      ...viewModesMixin.methods,
      ...selectionPacingMixin.methods,
      ...toolbarMenusMixin.methods,
      ...toolbarCollapseMixin.methods,
      ...component.methods,
      ...noops,
      toolbarEnabled: (name) => ['headings', 'marks', 'textStyle'].includes(name),
      isGroupCollapsed: () => false,
      writable: () => true,
    },
    render(h) {
      return h('section', { ref: 'root', class: 'lark-doc' }, [
        h(ToolbarBar, { props: { ed: this } }),
        this.editor ? h(tiptap.EditorContent, { props: { editor: this.editor } }) : null,
      ])
    },
  })
  // 布局测量仍按现有机制排队；不让 jsdom 的零尺寸布局干扰响应式断言。
  vm.$frame = { requestFrame: vi.fn(() => 1), cancelFrame: vi.fn() }
  vm.$mount()
  hosts.push(vm)
  component.mounted.call(vm)
  expect(vm.error).toBe('')
  expect(vm.editor).toBeInstanceOf(tiptap.Editor)
  return vm
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
  nodeViews.registerVue2NodeViews()
  previousErrorHandler = Vue.config.errorHandler
  vueErrors = []
  Vue.config.errorHandler = (error, vm, info) => vueErrors.push({ error, component: vm?.$options.name, info })
})

afterEach(() => {
  try {
    for (const vm of hosts.splice(0)) vm.$destroy()
    expect(vueErrors.map(({ error, component, info }) => `${component}: ${info}: ${error.stack}`)).toEqual([])
  } finally {
    setNodeView('codeBlock', previousCodeNodeView)
    Vue.config.errorHandler = previousErrorHandler
    vi.restoreAllMocks()
  }
})

describe('Vue 2.7 编辑器响应式边界', () => {
  it('EditorContent 真实挂载原生代码块 NodeView，不递归遍历 schema 循环且正常销毁', async () => {
    const vm = mountEditor({ value: '<pre><code class="language-plaintext">hello</code></pre>' })
    await Vue.nextTick()
    await Vue.nextTick()
    expect(vueErrors.map(({ error }) => error.message)).toEqual([])
    expect(vm.editor.contentComponent.$options.name).toBe('EditorContent')
    const node = vm.editor.state.doc.firstChild
    expect(node.type.schema.nodes.codeBlock).toBe(node.type)
    expectRawEditor(vm.editor)
    expect(vm.$el.querySelector('.ProseMirror .lark-doc-code')).not.toBeNull()
    expect(vm.$el.querySelector('.lark-doc-code-input').textContent).toBe('hello')
    const codeVm = vm.editor.contentComponent.$children.find((child) => child.$options.name === 'LarkDocCodeNode')
    expect(codeVm.node).toBe(node)
    const highlighted = vi.spyOn(codeVm, 'refreshHighlighted')
    const scheduled = vi.spyOn(codeVm, 'scheduleDiagramRender')

    vm.editor.commands.setTextSelection({ from: 1, to: 3 })
    await Vue.nextTick()
    expect(vm.hasTextSelection).toBe(true)
    expect(button(vm, '设置链接').disabled).toBe(false)
    expect(highlighted).not.toHaveBeenCalled()
    expect(scheduled).not.toHaveBeenCalled()

    vm.editor.commands.insertContentAt(1, '<new>')
    await Vue.nextTick()
    expect(codeVm.node).not.toBe(node)
    expect(codeVm.node.textContent).toBe('<new>hello')
    expect(vm.$el.querySelector('.lark-doc-code-input').textContent).toBe('<new>hello')
    expect(vm.$el.querySelector('.lark-doc-code-highlight code').textContent).toBe('<new>hello')
    expect(highlighted).toHaveBeenCalledTimes(1)
    expect(scheduled).toHaveBeenCalledTimes(1)
    expectRawEditor(vm.editor)

    codeVm.updateAttributes({ language: 'mermaid' })
    await Vue.nextTick()
    expect(codeVm.lastLanguageSeen).toBe('mermaid')
    expect(codeVm.showPreview).toBe(true)
    expect(vm.$el.querySelector('.lark-doc-code-diagram .lark-doc-diagram')).not.toBeNull()
    expect(scheduled).toHaveBeenCalledTimes(2)
    codeVm.updateAttributes({ language: 'plaintext' })
    await Vue.nextTick()
    expect(codeVm.showPreview).toBe(false)
    expect(vm.$el.querySelector('.lark-doc-diagram')).toBeNull()
    const editor = vm.editor
    vm.$destroy()
    expect(codeVm._isDestroyed).toBe(true)
    expect(editor.isDestroyed).toBe(true)
    expect(editor.contentComponent).toBeNull()
  })

  it('Vditor 图表和普通代码块首次挂载及替换正文均创建真实 NodeView', async () => {
    const vm = mountEditor({ value: '<div class="language-mermaid">graph TD\n A --&gt; B</div><pre><code class="language-plaintext">hello</code></pre>' })
    await Vue.nextTick()
    await Vue.nextTick()
    expect(vm.$el.querySelectorAll('.ProseMirror .lark-doc-code')).toHaveLength(2)
    expect(vm.$el.querySelector('.lark-doc-code-diagram .lark-doc-diagram')).not.toBeNull()
    expect(vm.$el.querySelector('.lark-doc-code-input').textContent).toContain('graph TD')
    expect(vm.editor.contentComponent.$children.filter((child) => child.$options.name === 'LarkDocCodeNode')).toHaveLength(2)
    expectRawEditor(vm.editor)

    vm.editor.commands.setContent('<p>replacement</p>')
    await Vue.nextTick()
    expect(vm.$el.querySelectorAll('.lark-doc-code')).toHaveLength(0)
    expect(vm.$el.querySelector('.ProseMirror').textContent).toBe('replacement')
    expect(vm.editor.contentComponent.$children).toHaveLength(0)
    vm.editor.commands.setContent('<pre><code class="language-plaintext">again</code></pre>')
    await Vue.nextTick()
    expect(vm.$el.querySelector('.lark-doc-code-input').textContent).toBe('again')
    expectRawEditor(vm.editor)
  })

  it.each(['editor', 'component', 'removed'])('滚动帧排队后销毁 %s，不再访问 view 或更新浮层', (target) => {
    let frame
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => { frame = callback; return 1 })
    const readView = vi.fn(() => { throw new Error('不应访问已销毁 view') })
    const editor = { isDestroyed: false, get view() { return readView() } }
    const vm = {
      editor,
      outline: [{ pos: 0 }],
      currentBlockRange: vi.fn(),
      positionBlockHandle: vi.fn(),
      syncHandleHighlightBackdrop: vi.fn(),
      updateTableBoundary: vi.fn(),
      updateCalloutTools: vi.fn(),
    }
    component.methods.onDocumentScroll.call(vm)
    expect(frame).toBeTypeOf('function')
    if (target === 'editor') editor.isDestroyed = true
    if (target === 'component') vm._isBeingDestroyed = true
    if (target === 'removed') vm.editor = null
    expect(() => frame()).not.toThrow()
    expect(readView).not.toHaveBeenCalled()
    expect(vm.updateTableBoundary).not.toHaveBeenCalled()
    expect(vm.syncHandleHighlightBackdrop).not.toHaveBeenCalled()
    expect(vm._outlineFrame).toBeNull()
  })

  it.each([
    ['句柄背景', blockHandleMixin.methods.syncHandleHighlightBackdrop],
    ['表格裁切', tableToolsMixin.methods.syncTableClip],
    ['评论面板', commentsMixin.methods.placeCommentPanels],
    ['修订面板', revisionMixin.methods.placeRevisionPanels],
    ['句柄与表格', component.methods.updateHandleAndTable],
  ])('%s 的延迟刷新在 editor 或组件销毁后不读取 view', (name, method) => {
    const readView = vi.fn(() => { throw new Error('不应访问已销毁 view') })
    for (const flags of [{}, { _isBeingDestroyed: true }, { _isDestroyed: true }]) {
      const vm = {
        editor: { isDestroyed: Object.keys(flags).length === 0, get view() { return readView() } },
        commentPanels: [{}], revisionPanels: [{}],
        updateTableBoundary: vi.fn(),
        ...flags,
      }
      expect(() => method.call(vm)).not.toThrow()
      expect(vm.updateTableBoundary).not.toHaveBeenCalled()
    }
    expect(readView).not.toHaveBeenCalled()
  })

  it.each([
    ['评论', commentsMixin, 'onCommentViewportChange', 'onCommentPointerDown'],
    ['修订', revisionMixin, 'onRevisionViewportChange', 'onRevisionPointerDown'],
  ])('%s 的挂载回调晚于销毁时不绑定 DOM，清理也不读取失效 view', (name, mixin, viewport, pointer) => {
    let nextTick
    const readView = vi.fn(() => { throw new Error('不应访问已销毁 view') })
    const editor = { isDestroyed: false, get view() { return readView() } }
    const vm = {
      editor,
      $nextTick: (callback) => { nextTick = callback },
      [viewport]: vi.fn(), [pointer]: vi.fn(),
      loadComments: vi.fn(), syncRevisionTracking: vi.fn(), updateRevisionPanels: vi.fn(),
    }
    mixin.mounted.call(vm)
    editor.isDestroyed = true
    try {
      expect(() => nextTick()).not.toThrow()
      expect(vm.loadComments).not.toHaveBeenCalled()
      expect(vm.syncRevisionTracking).not.toHaveBeenCalled()
    } finally {
      expect(() => mixin.beforeDestroy.call(vm)).not.toThrow()
    }
    expect(readView).not.toHaveBeenCalled()
  })

  it('清除句柄高亮排队的 nextTick 晚于 editor 销毁时不读取 view', () => {
    let nextTick
    const readView = vi.fn(() => { throw new Error('不应访问已销毁 view') })
    const editor = {
      isDestroyed: false,
      get view() { return readView() },
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
    } finally {
      tableToolsMixin.beforeDestroy.call(vm)
    }
  })

  it.each([
    ['评论', commentsMixin, 'onCommentViewportChange', 'onCommentPointerDown', '_commentEditorDom'],
    ['修订', revisionMixin, 'onRevisionViewportChange', 'onRevisionPointerDown', '_revisionEditorDom'],
  ])('%s 在 editor 提前销毁后仍从原 DOM 解除监听并释放引用', (name, mixin, viewport, pointer, domKey) => {
    const dom = document.createElement('div')
    const readView = vi.fn(() => ({ dom }))
    const editor = { isDestroyed: false, get view() { return readView() } }
    const vm = {
      editor,
      $nextTick: (callback) => callback(),
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
    const vm = mountEditor()
    await Vue.nextTick()
    const editor = vm.editor
    vm.$destroy()
    expect(editor.isDestroyed).toBe(true)
    const host = { editor, commentPanels: [{}], revisionPanels: [{}] }
    for (const method of [
      blockHandleMixin.methods.syncHandleHighlightBackdrop,
      tableToolsMixin.methods.syncTableClip,
      commentsMixin.methods.placeCommentPanels,
      revisionMixin.methods.placeRevisionPanels,
    ]) expect(() => method.call(host)).not.toThrow()
  })

  it('真实 observable data 接收 Editor 时不深观察内部，也不冻结 editor/state', async () => {
    const vm = mountEditor()
    await Vue.nextTick()
    const editor = vm.editor
    expect(vm.$data.__ob__).toBeDefined()
    expect(vm.alignNames.__ob__).toBeDefined()
    expect(vm.editorInstance).toBe(editor)
    expect(Vue.observable({ editor }).editor).toBe(editor)
    expectRawEditor(editor)

    const previousState = editor.state
    expect(editor.commands.insertContent('new')).toBe(true)
    expect(editor.state).not.toBe(previousState)
    expectRawEditor(editor)
    vm.$destroy()
    expect(editor.isDestroyed).toBe(true)
    expect(vm.editorInstance).toBeNull()
  })

  it('纯选区事务使已缓存 computed 和真实工具栏子组件刷新，不依赖目录/字数变化', async () => {
    const vm = mountEditor()
    await Vue.nextTick()
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
    const revision = vm.editorRevision

    const headingPos = outline[0].pos + 1
    editor.commands.setTextSelection({ from: headingPos, to: headingPos + 2 })
    expect(vm.editorRevision).toBe(revision + 1)
    expect(vm.hasTextSelection).toBe(true)
    expect(vm.currentBlockLabel).toBe('H2')
    expect(vm.headingActiveLevel).toBe(2)
    await Vue.nextTick()
    expect(button(vm, '标题级别').textContent.trim()).toBe('H2')
    expect(button(vm, '设置链接').disabled).toBe(false)

    let boldPos
    doc.descendants((node, pos) => { if (node.isText && node.text === 'bold') boldPos = pos })
    editor.commands.setTextSelection(boldPos + 1)
    expect(vm.hasTextSelection).toBe(false)
    expect(vm.currentBlockLabel).toBe('正文')
    expect(vm.headingActiveLevel).toBeNull()
    expect(boldChecked(vm)).toBe(true)
    await Vue.nextTick()
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
    const vm = mountEditor()
    await Vue.nextTick()
    const editor = vm.editor
    const doc = editor.state.doc
    const selection = editor.state.selection
    const count = vm.wordCount
    const html = vm.html
    const selectionUpdate = vi.spyOn(vm, 'onSelectionUpdate')
    const refresh = vi.spyOn(vm, 'refreshDocumentState')
    expect(boldChecked(vm)).toBe(false)
    const revision = vm.editorRevision

    editor.commands.toggleBold()
    expect(vm.editorRevision).toBe(revision + 1)
    expect(editor.state.doc).toBe(doc)
    expect(editor.state.selection.eq(selection)).toBe(true)
    expect(selectionUpdate).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
    expect(boldChecked(vm)).toBe(true)
    await Vue.nextTick()
    expect(button(vm, '加粗').getAttribute('aria-pressed')).toBe('true')

    editor.commands.toggleBold()
    await Vue.nextTick()
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
    await Vue.nextTick()
    expect(button(vm, '标题级别').textContent.trim()).toBe('H3')

    editor.commands.insertContent('new')
    expect(vm.wordCount).toBe(count + 3)
    expect(vm.html).toContain('newplain')
    expectRawEditor(editor)
  })
})
