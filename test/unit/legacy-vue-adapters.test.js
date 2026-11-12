// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ handles: [], readyOnMount: false, realRenderer: null }))
vi.mock('../../src/mount/domRenderer', () => ({
  createDomRenderer: () => mocks.realRenderer ? mocks.realRenderer() : ({
    mount({ element, props, on }) {
      const root = document.createElement('section')
      const actionsHost = document.createElement('div')
      const externalPanel = document.createElement('aside')
      const panelHost = document.createElement('div')
      externalPanel.appendChild(panelHost)
      root.append(actionsHost, externalPanel)
      element.appendChild(root)
      let html = props.initialContent
      let title = props.initialTitle
      const editor = {}
      const instance = {
        getEditor: () => editor, getHTML: () => html, getTitle: () => title,
        getJSON: () => ({ type: 'doc' }), getText: () => '正文',
        setContent: vi.fn(value => { html = value; return true }),
        focus: vi.fn(), startAI: vi.fn(),
      }
      const handle = { root, props, on, instance, patches: [], nativeHost: { host: { $refs: { actionsHost, externalPanel, panelHost } } }, workspaceUi: { el: document.createElement('div') } }
      handle.setTitle = value => { title = value }
      mocks.handles.push(handle)
      if (mocks.readyOnMount) on.ready({ editor, document: instance })
      return handle
    },
    update(handle, patch) { handle.patches.push(patch); Object.assign(handle.props, patch) },
    getInstance: handle => handle?.instance,
    destroy(handle) { handle.destroyed = true; handle.root.remove() },
  }),
}))
import LarkDocEditor from '../../src/components/lark-doc/LarkDocEditor'
import LarkDocWorkspace from '../../src/components/lark-doc/LarkDocWorkspace'

const mounted = []
afterEach(() => {
  mounted.splice(0).forEach(({ component, vm }) => { component.beforeDestroy.call(vm); vm.$el.remove() })
  vi.restoreAllMocks()
  mocks.handles.length = 0; mocks.readyOnMount = false; mocks.realRenderer = null; document.body.innerHTML = ''
})

// Invoke the public options contract explicitly. Vue2's reactivity/VNode patching
// belongs to the real consumer-browser tests; the library supplies no runtime.
function createHost(component, propsData = {}) {
  const props = Object.fromEntries(Object.entries(component.props).map(([key, option]) => [key,
    typeof option.default === 'function' && option.type !== Function ? option.default() : option.default]))
  Object.assign(props, propsData)
  const refs = Object.fromEntries(['nativeHost', 'slotPark', 'headerActions', 'sidePanel'].map(key => [key, document.createElement('div')]))
  refs.slotPark.append(refs.headerActions, refs.sidePanel)
  const root = document.createElement('div')
  root.append(refs.nativeHost, refs.slotPark)
  document.body.appendChild(root)
  const vm = {
    ...component.methods, ...props, $props: props, $refs: refs, $el: root,
    $emit: vi.fn(), $nextTick: callback => Promise.resolve().then(callback),
  }
  mounted.push({ component, vm })
  return vm
}
function mount(component, propsData) {
  const vm = createHost(component, propsData)
  component.mounted.call(vm)
  return { vm, handle: mocks.handles[mocks.handles.length - 1] }
}
const emitted = (vm, event) => vm.$emit.mock.calls.filter(([name]) => name === event).map(([, payload]) => payload)

describe('无SFC Vue2 options 薄适配器', () => {
  it('真实 renderer 的引用候选和按钮动作采用替换后的 props', { timeout: 60000 }, async () => {
    const createRange = document.createRange.bind(document)
    vi.spyOn(document, 'createRange').mockImplementation(() => Object.assign(createRange(), {
      getClientRects: () => [],
      getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }),
    }))
    mocks.realRenderer = (await vi.importActual('../../src/mount/domRenderer')).createDomRenderer
    const oldAction = vi.fn()
    const nextAction = vi.fn()
    const { vm } = mount(LarkDocWorkspace, {
      initialContent: '<p>正文</p>',
      mentionSource: [{ kind: 'user', id: 'old-user', name: 'Old User' }],
      calendarSource: [{ eventId: 'old-event', title: 'Old Event', start: '2026-11-11T10:00:00Z' }],
      onIsvButtonAction: oldAction,
    })
    const handle = vm._nativeHandle
    const next = {
      mentionSource: [{ kind: 'user', id: 'new-user', name: 'New User' }],
      calendarSource: [{ eventId: 'new-event', title: 'New Event', start: '2026-11-11T10:00:00Z' }],
      onIsvButtonAction: nextAction,
    }
    for (const [key, value] of Object.entries(next)) {
      vm[key] = vm.$props[key] = value
      LarkDocWorkspace.watch[key].handler.call(vm, value)
    }
    await Promise.resolve()
    const host = handle.nativeHost.host
    host.editor.commands.setIsv({ kind: 'button', action: 'follow_page', buttonText: 'Follow' })
    handle.root.querySelector('.docx-button-component').click()
    expect(nextAction).toHaveBeenCalledOnce()
    expect(oldAction).not.toHaveBeenCalled()
    host.onMention({ from: 1, to: 1, query: '' })
    await vi.waitFor(() => expect(host.mentionItems[0]?.id).toBe('new-user'))
    host.closeMentionPanel()
    await new Promise(resolve => requestAnimationFrame(resolve))
    host.startCalendarEvent()
    await vi.waitFor(() => expect(host.calendarEvents[0]?.eventId).toBe('new-event'))
  })

  it('保留组件名、v-model、标题事件与命令式转发，不自行创建业务状态', async () => {
    const { vm, handle } = mount(LarkDocEditor, { value: '<p>正文</p>', title: '初始', maxLength: 12 })
    expect(typeof LarkDocEditor).toBe('object')
    expect(LarkDocEditor.name).toBe('LarkDocEditor')
    expect(handle.props.initialContent).toBe('<p>正文</p>')
    expect(handle.props.config.limits.maxLength).toBe(12)
    expect(handle.props.config.features.persistence).toBe(false)
    expect(vm.getEditor()).toBe(handle.instance.getEditor())
    expect(vm.getJSON()).toEqual({ type: 'doc' })
    LarkDocEditor.computed.html.set.call(vm, '<p>替换</p>')
    expect(LarkDocEditor.computed.html.get.call(vm)).toBe('<p>替换</p>')
    handle.on.change({ html: '<p>输入</p>' })
    expect(emitted(vm, 'input')).toEqual(['<p>输入</p>'])
    handle.setTitle('修改')
    handle.on.update({ title: '修改' })
    handle.on.update({})
    expect(emitted(vm, 'update:title')).toEqual(['修改'])
    handle.setTitle('直接标题')
    handle.on['update:title']('直接标题')
    handle.on.update({})
    expect(emitted(vm, 'update:title')).toEqual(['修改', '直接标题'])
    handle.on['ai-request']('rewrite')
    expect(handle.instance.startAI).not.toHaveBeenCalled()
    handle.on.ready({ editor: vm.getEditor() })
    expect(emitted(vm, 'ready')).toEqual([vm.getEditor()])
    vm.value = vm.$props.value = '<p>宿主</p>'
    LarkDocEditor.watch.value.handler.call(vm, vm.value)
    expect(handle.instance.setContent).toHaveBeenLastCalledWith('<p>宿主</p>')
  })

  it('热更只传变化项，不重置会话、初始标题或外部只读状态', async () => {
    const session = { can: () => true }
    const { vm, handle } = mount(LarkDocWorkspace, { initialTitle: '标题', session, documentId: 'doc-1', config: { limits: { maxLength: 10 } } })
    expect(handle.props.foldPersistKey).toBe('doc-1')
    handle.on['ai-request']('rewrite')
    expect(handle.instance.startAI).toHaveBeenCalledExactlyOnceWith('rewrite')
    vm.readonly = vm.$props.readonly = true
    LarkDocWorkspace.watch.readonly.handler.call(vm, true)
    expect(handle.patches).toEqual([{ readonly: true }])
    vm.config.limits.maxLength = 20
    expect(LarkDocWorkspace.watch.config.deep).toBe(true)
    LarkDocWorkspace.watch.config.handler.call(vm, vm.config)
    expect(handle.patches[1]).toEqual({ config: vm.config })
    expect(handle.patches[1]).not.toHaveProperty('initialTitle')
    expect(handle.patches[1]).not.toHaveProperty('session')
    const payload = { editor: vm.getEditor(), document: handle.instance }
    handle.on.ready(payload)
    expect(emitted(vm, 'ready')).toEqual([payload])
  })

  it('同步 ready 保持编辑器载荷，挂载后新增插槽仍可更新', async () => {
    mocks.readyOnMount = true
    const { vm, handle } = mount(LarkDocEditor)
    expect(emitted(vm, 'ready')).toEqual([])
    await Promise.resolve()
    expect(emitted(vm, 'ready')).toEqual([handle.instance.getEditor()])
    const button = document.createElement('button')
    button.textContent = '新增操作'
    vm.$refs.headerActions.appendChild(button)
    expect(handle.nativeHost.host.$refs.actionsHost.textContent).toBe('新增操作')
    button.remove()
    expect(handle.nativeHost.host.$refs.actionsHost.textContent).toBe('')
  })

  it('真实 DOM facade 可挂载、编辑、转发标题并释放原生资源', { timeout: 60000 }, async () => {
    mocks.realRenderer = (await vi.importActual('../../src/mount/domRenderer')).createDomRenderer
    const ready = vi.fn()
    const input = vi.fn()
    const title = vi.fn()
    const vm = createHost(LarkDocEditor, {
      value: '<p>原生正文</p>', title: '原生标题',
      config: { performance: { changeDebounce: 0 }, network: { mode: 'offline' } },
    })
    vm.$emit.mockImplementation((event, payload) => {
      if (event === 'ready') { expect(vm.getEditor()).toBe(payload); ready(payload) }
      if (event === 'input') input(payload)
      if (event === 'update:title') title(payload)
    })
    LarkDocEditor.mounted.call(vm)
    const handle = vm._nativeHandle
    await Promise.resolve()
    expect(ready).toHaveBeenCalledExactlyOnceWith(vm.getEditor())
    expect(vm.getText()).toBe('原生正文')
    expect(vm.getTitle()).toBe('原生标题')
    vm.setContent('<p>替换正文</p>')
    expect(vm.getText()).toBe('替换正文')
    expect(input).toHaveBeenLastCalledWith(expect.stringContaining('替换正文'))
    vm.setTitle('新标题')
    expect(title).toHaveBeenCalledExactlyOnceWith('新标题')
    vm.value = vm.$props.value = '<p>宿主热更</p>'
    LarkDocEditor.watch.value.handler.call(vm, vm.value)
    expect(vm.getText()).toBe('宿主热更')
    const editor = vm.getEditor()
    LarkDocEditor.beforeDestroy.call(vm)
    expect(editor.isDestroyed).toBe(true)
    expect(handle.root.isConnected).toBe(false)
  })

  it('插槽由宿主 Vue 更新，卸载前归还节点并销毁原生句柄', async () => {
    const vm = createHost(LarkDocEditor)
    const button = document.createElement('button')
    const panel = document.createElement('span')
    button.textContent = panel.textContent = '操作'
    vm.$refs.headerActions.appendChild(button)
    vm.$refs.sidePanel.appendChild(panel)
    LarkDocEditor.mounted.call(vm)
    const handle = vm._nativeHandle
    expect(handle.nativeHost.host.$refs.actionsHost.textContent).toBe('操作')
    expect(handle.nativeHost.host.$refs.externalPanel.textContent).toBe('操作')
    button.textContent = panel.textContent = '更新'
    expect(handle.nativeHost.host.$refs.actionsHost.textContent).toBe('更新')
    expect(handle.nativeHost.host.$refs.externalPanel.textContent).toBe('更新')
    LarkDocEditor.beforeDestroy.call(vm)
    expect(handle.destroyed).toBe(true)
    expect(handle.root.isConnected).toBe(false)
    expect(vm.$refs.headerActions.parentNode).toBe(vm.$refs.slotPark)
    expect(vm.$refs.sidePanel.parentNode).toBe(vm.$refs.slotPark)
    expect(vm._nativeHandle).toBeNull()
    expect(vm._nativeRenderer).toBeNull()
  })

  it.each([LarkDocEditor, LarkDocWorkspace])('$name 把插槽交给宿主 h，保留原生挂载点和隐藏停泊点', component => {
    const header = [{}]
    const side = [{}]
    const h = (tag, data, children) => ({ tag, data, children })
    const tree = component.render.call({ $slots: { 'header-actions': header, 'side-panel': side } }, h)
    expect(tree.tag).toBe('div')
    expect(tree.data.class).toBe('lark-doc-vue2-adapter')
    expect(tree.children[0].data.ref).toBe('nativeHost')
    const park = tree.children[1]
    expect(park.data).toEqual({ ref: 'slotPark', style: { display: 'none' } })
    expect(park.children[0].data.ref).toBe('headerActions')
    expect(park.children[0].children).toBe(header)
    expect(park.children[1].data.ref).toBe('sidePanel')
    expect(park.children[1].children).toBe(side)
  })
})
