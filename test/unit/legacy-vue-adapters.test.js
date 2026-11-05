// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import Vue from 'vue'

Vue.config.productionTip = false
Vue.config.devtools = false

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
afterEach(() => { mounted.splice(0).forEach(vm => vm.$destroy()); mocks.handles.length = 0; mocks.readyOnMount = false; mocks.realRenderer = null; document.body.innerHTML = '' })
function mount(component, propsData) {
  const vm = new (Vue.extend(component))({ propsData }).$mount()
  document.body.appendChild(vm.$el)
  mounted.push(vm)
  return { vm, handle: mocks.handles[mocks.handles.length - 1] }
}

describe('无SFC Vue2 options 薄适配器', () => {
  it('保留组件名、v-model、标题事件与命令式转发，不自行创建业务状态', async () => {
    const { vm, handle } = mount(LarkDocEditor, { value: '<p>正文</p>', title: '初始', maxLength: 12 })
    expect(vm.$options.name).toBe('LarkDocEditor')
    expect(handle.props.initialContent).toBe('<p>正文</p>')
    expect(handle.props.config.limits.maxLength).toBe(12)
    expect(handle.props.config.features.persistence).toBe(false)
    expect(vm.getEditor()).toBe(handle.instance.getEditor())
    expect(vm.getJSON()).toEqual({ type: 'doc' })
    vm.html = '<p>替换</p>'
    expect(vm.html).toBe('<p>替换</p>')
    const input = vi.fn()
    const title = vi.fn()
    const ready = vi.fn()
    vm.$on('input', input).$on('update:title', title).$on('ready', ready)
    handle.on.change({ html: '<p>输入</p>' })
    expect(input).toHaveBeenCalledWith('<p>输入</p>')
    handle.setTitle('修改')
    handle.on.update({ title: '修改' })
    handle.on.update({})
    expect(title).toHaveBeenCalledExactlyOnceWith('修改')
    handle.setTitle('直接标题')
    handle.on['update:title']('直接标题')
    handle.on.update({})
    expect(title).toHaveBeenCalledTimes(2)
    handle.on['ai-request']('rewrite')
    expect(handle.instance.startAI).not.toHaveBeenCalled()
    handle.on.ready({ editor: vm.getEditor() })
    expect(ready).toHaveBeenCalledWith(vm.getEditor())
    vm.value = '<p>宿主</p>'
    await Vue.nextTick()
    expect(handle.instance.setContent).toHaveBeenLastCalledWith('<p>宿主</p>')
  })

  it('热更只传变化项，不重置会话、初始标题或外部只读状态', async () => {
    const session = { can: () => true }
    const { vm, handle } = mount(LarkDocWorkspace, { initialTitle: '标题', session, documentId: 'doc-1', config: { limits: { maxLength: 10 } } })
    expect(handle.props.foldPersistKey).toBe('doc-1')
    handle.on['ai-request']('rewrite')
    expect(handle.instance.startAI).toHaveBeenCalledExactlyOnceWith('rewrite')
    vm.readonly = true
    await Vue.nextTick()
    expect(handle.patches).toEqual([{ readonly: true }])
    vm.config.limits.maxLength = 20
    await Vue.nextTick()
    expect(handle.patches[1]).toEqual({ config: vm.config })
    expect(handle.patches[1]).not.toHaveProperty('initialTitle')
    expect(handle.patches[1]).not.toHaveProperty('session')
    const ready = vi.fn()
    vm.$on('ready', ready)
    const payload = { editor: vm.getEditor(), document: handle.instance }
    handle.on.ready(payload)
    expect(ready).toHaveBeenCalledWith(payload)
  })

  it('同步 ready 保持编辑器载荷，挂载后新增插槽仍可更新', async () => {
    mocks.readyOnMount = true
    const ready = vi.fn()
    const parent = new Vue({
      data: () => ({ visible: false }),
      render(h) { return h(LarkDocEditor, { on: { ready } }, this.visible ? [h('button', { slot: 'header-actions' }, '新增操作')] : []) },
    }).$mount()
    mounted.push(parent)
    const handle = mocks.handles[0]
    expect(ready).not.toHaveBeenCalled()
    await Vue.nextTick()
    expect(ready).toHaveBeenCalledExactlyOnceWith(handle.instance.getEditor())
    parent.visible = true
    await Vue.nextTick()
    expect(handle.nativeHost.host.$refs.actionsHost.textContent).toBe('新增操作')
    parent.visible = false
    await Vue.nextTick()
    expect(handle.nativeHost.host.$refs.actionsHost.textContent).toBe('')
  })

  it('真实 DOM facade 可挂载、编辑、转发标题并释放原生资源', { timeout: 60000 }, async () => {
    mocks.realRenderer = (await vi.importActual('../../src/mount/domRenderer')).createDomRenderer
    const ready = vi.fn()
    const input = vi.fn()
    const title = vi.fn()
    const vm = new (Vue.extend(LarkDocEditor))({ propsData: {
      value: '<p>原生正文</p>', title: '原生标题',
      config: { performance: { changeDebounce: 0 }, network: { mode: 'offline' } },
    } })
    mounted.push(vm)
    vm.$on('ready', payload => { expect(vm.getEditor()).toBe(payload); ready(payload) }).$on('input', input).$on('update:title', title)
    vm.$mount()
    document.body.appendChild(vm.$el)
    const handle = vm._nativeHandle
    await Vue.nextTick()
    expect(ready).toHaveBeenCalledExactlyOnceWith(vm.getEditor())
    expect(vm.getText()).toBe('原生正文')
    expect(vm.getTitle()).toBe('原生标题')
    vm.setContent('<p>替换正文</p>')
    expect(vm.getText()).toBe('替换正文')
    expect(input).toHaveBeenLastCalledWith(expect.stringContaining('替换正文'))
    vm.setTitle('新标题')
    expect(title).toHaveBeenCalledExactlyOnceWith('新标题')
    vm.value = '<p>宿主热更</p>'
    await Vue.nextTick()
    expect(vm.getText()).toBe('宿主热更')
    const editor = vm.getEditor()
    vm.$destroy()
    expect(editor.isDestroyed).toBe(true)
    expect(handle.root.isConnected).toBe(false)
  })

  it('插槽由宿主 Vue 更新，卸载前归还节点并销毁原生句柄', async () => {
    const parent = new Vue({
      data: () => ({ label: '操作' }),
      render(h) { return h(LarkDocEditor, { ref: 'editor' }, [
        h('button', { slot: 'header-actions' }, this.label),
        h('span', { slot: 'side-panel' }, this.label),
      ]) },
    }).$mount()
    mounted.push(parent)
    document.body.appendChild(parent.$el)
    const handle = mocks.handles[0]
    expect(handle.nativeHost.host.$refs.actionsHost.textContent).toBe('操作')
    expect(handle.nativeHost.host.$refs.externalPanel.textContent).toBe('操作')
    parent.label = '更新'
    await Vue.nextTick()
    expect(handle.nativeHost.host.$refs.actionsHost.textContent).toBe('更新')
    expect(handle.nativeHost.host.$refs.externalPanel.textContent).toBe('更新')
    parent.$destroy()
    expect(handle.destroyed).toBe(true)
    expect(handle.root.isConnected).toBe(false)
    expect(parent.$refs.editor).toBeUndefined()
  })
})
