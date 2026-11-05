// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'

const mocks = vi.hoisted(() => ({ documents: [], handles: [], realEditor: false }))
vi.mock('../../src/LarkDoc', () => ({
  LarkDoc: class {
    constructor(options) {
      this.options = options
      this.title = options.title || ''
      this.editor = mocks.realEditor ? new Editor({
        element: document.createElement('div'), extensions: [StarterKit], content: options.content || '<p></p>',
      }) : null
      this.handlers = new Map()
      this.setUploader = vi.fn(uploader => { this.options.uploader = uploader })
      this.destroy = vi.fn(() => { this.handlers.clear(); this.editor?.destroy() })
      mocks.documents.push(this)
    }
    on(name, handler) { this.handlers.set(name, handler) }
    getEditor() { return this.editor }
    getJSON() { return this.editor?.getJSON() ?? { type: 'doc', content: [] } }
    getTitle() { return this.title }
    setTitle(title) { this.title = title }
    emit(name, payload) { this.handlers.get(name)?.(payload) }
  },
}))
vi.mock('../../src/mount/domRenderer', () => ({
  createDomRenderer: () => ({
    mount({ props }) {
      const handle = {
        props, patches: [],
        nativeHost: { host: { $refs: { actionsHost: document.createElement('div'), externalPanel: document.createElement('div') } } },
        workspaceUi: { el: document.createElement('div') },
      }
      mocks.handles.push(handle)
      return handle
    },
    update(handle, patch) { handle.patches.push(patch) },
    getInstance() { return { getTitle: () => '' } },
    destroy(handle) { handle.destroyed = true },
  }),
}))
import LarkDocEditor from '../../src/components/lark-doc/LarkDocEditor'
import LarkDocWorkspace from '../../src/components/lark-doc/LarkDocWorkspace'
import { LarkDocElement } from '../../src/web-component/LarkDocElement'
import { resolveVue3Attrs } from '../../src/adapters/vue3'
import { createReactLarkDoc } from '../../src/adapters/react'

customElements.define('lark-doc', LarkDocElement)

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  document.querySelectorAll('lark-doc').forEach(element => element.destroy())
  document.body.innerHTML = ''
  vi.runAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  mocks.documents.length = 0
  mocks.handles.length = 0
  mocks.realEditor = false
})

// Exercise the injected hook contract without adding React or Vue to the library dependencies.
function reactHost() {
  const slots = []
  let cursor = 0
  let pending = []
  const React = {
    forwardRef: render => render,
    createElement: (tag, attrs) => ({ tag, attrs }),
    useRef(value) { return slots[cursor++] ||= { current: value } },
    useImperativeHandle(ref, create) { ref.current = create() },
    useEffect(effect, deps) {
      const index = cursor++
      const previous = slots[index]
      if (previous && deps && deps.every((value, key) => Object.is(value, previous.deps[key]))) return
      pending.push(() => {
        previous?.cleanup?.()
        slots[index] = { deps, cleanup: effect() }
      })
    },
  }
  const Component = createReactLarkDoc(React)
  const ref = { current: null }
  const element = document.createElement('lark-doc')
  return {
    element, ref,
    render(props) {
      cursor = 0
      const view = Component(props, ref)
      view.attrs.ref.current = element
      pending.forEach(effect => effect())
      pending = []
      return view.attrs
    },
    unmount() {
      slots.forEach(slot => slot.cleanup?.())
      element.remove()
    },
  }
}

describe('adapter options property contract', () => {
  it.each([LarkDocEditor, LarkDocWorkspace])('Vue2 $name forwards uploader identity on mount and update', component => {
    expect(component.props.uploader?.type).toEqual([Object, Function])
    const uploader = { upload: vi.fn(), beforeUpload: vi.fn(), onSettled: vi.fn() }
    const props = Object.fromEntries(Object.entries(component.props).map(([key, option]) => [key,
      typeof option.default === 'function' && option.type !== Function ? option.default() : option.default]))
    const vm = {
      ...component.methods, ...props, uploader,
      $props: { ...props, uploader }, $emit: vi.fn(), $nextTick: vi.fn(),
      $refs: { nativeHost: document.createElement('div'), headerActions: document.createElement('div'), sidePanel: document.createElement('div'), slotPark: document.createElement('div') },
    }
    component.mounted.call(vm)
    const handle = mocks.handles[0]
    expect(handle.props.uploader).toBe(uploader)
    const next = { ...uploader, onSettled: vi.fn() }
    vm.uploader = vm.$props.uploader = next
    component.watch.uploader.handler.call(vm, next)
    expect(handle.patches).toEqual([{ uploader: next }])
    expect(handle.patches[0].uploader.onSettled).toBe(next.onSettled)
    component.beforeDestroy.call(vm)
    expect(handle.destroyed).toBe(true)
  })

  it('Vue3 returns options as an object property and combines direct uploader without serializing callbacks', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const options = { uploader: { upload: vi.fn(), onStart: vi.fn() } }
    expect(resolveVue3Attrs({ options }).options).toBe(options)
    const uploader = { upload: vi.fn(), onProgress: vi.fn() }
    const attrs = resolveVue3Attrs({ options, uploader, readonly: true })
    expect(attrs.options.uploader).toBe(uploader)
    expect(attrs).not.toHaveProperty('uploader')
    expect(attrs.readonly).toBe('')
    expect(warn).not.toHaveBeenCalled()
    const element = document.createElement('lark-doc')
    element.options = attrs.options
    document.body.appendChild(element)
    vi.runAllTimers()
    expect(mocks.documents[0].options.uploader.onProgress).toBe(uploader.onProgress)
  })

  it('Web Component uses the latest pre-mount options and updates uploader without rebuilding', () => {
    const element = document.createElement('lark-doc')
    const first = { uploader: { upload: vi.fn(), onSuccess: vi.fn() } }
    element.options = first
    document.body.appendChild(element)
    const second = { uploader: { upload: vi.fn(), onSuccess: vi.fn() } }
    element.options = second
    vi.runAllTimers()
    expect(mocks.documents).toHaveLength(1)
    expect(mocks.documents[0].options.uploader).toBe(second.uploader)
    const third = { uploader: { upload: vi.fn(), onSuccess: vi.fn() } }
    element.options = first
    element.options = third
    vi.runAllTimers()
    expect(mocks.documents).toHaveLength(1)
    expect(mocks.documents[0].destroy).not.toHaveBeenCalled()
    expect(mocks.documents[0].setUploader).toHaveBeenLastCalledWith(third.uploader)
    const change = vi.fn()
    element.addEventListener('lark-doc-change', change)
    mocks.documents[0].emit('change', {})
    expect(change).toHaveBeenCalledOnce()
    element.remove()
    vi.runAllTimers()
    expect(mocks.documents[0].destroy).toHaveBeenCalledOnce()
  })

  it.each(['Web Component', 'Vue3', 'React'])('%s uploader callback updates preserve edited content, title and undo history', environment => {
    mocks.realEditor = true
    const host = environment === 'React' ? reactHost() : null
    const element = host?.element ?? document.createElement('lark-doc')
    const initial = {
      content: '<p>初始正文</p>', title: '初始标题', uploader: { upload: vi.fn(), onSuccess: vi.fn() },
    }
    const update = props => {
      if (host) host.render(props)
      else element.options = environment === 'Vue3' ? resolveVue3Attrs(props).options : props.options
    }
    update({ options: initial })
    document.body.appendChild(element)
    vi.runAllTimers()
    const instance = element.getInstance()
    const editor = element.getEditor()
    editor.commands.insertContentAt(1, '用户输入')
    instance.setTitle('编辑后标题')
    const edited = editor.getJSON()
    expect(editor.can().undo()).toBe(true)
    const uploader = { ...initial.uploader, onSuccess: vi.fn() }
    update(host || environment === 'Vue3' ? { options: initial, uploader } : { options: { ...initial, uploader } })
    vi.runAllTimers()
    expect(element.getInstance()).toBe(instance)
    expect(element.getEditor()).toBe(editor)
    expect(editor.getJSON()).toEqual(edited)
    expect(instance.getTitle()).toBe('编辑后标题')
    expect(instance.setUploader).toHaveBeenCalledExactlyOnceWith(uploader)
    instance.options.uploader.onSuccess('result')
    expect(uploader.onSuccess).toHaveBeenCalledExactlyOnceWith('result')
    expect(initial.uploader.onSuccess).not.toHaveBeenCalled()
    expect(editor.commands.undo()).toBe(true)
    expect(editor.getText()).toBe('初始正文')
    expect(editor.commands.redo()).toBe(true)
    expect(editor.getJSON()).toEqual(edited)
    host?.unmount()
  })

  it('Web Component updates legacy uploadImage in place and ignores unchanged options', () => {
    const element = document.createElement('lark-doc')
    const uploadImage = vi.fn()
    element.options = { uploadImage }
    document.body.appendChild(element)
    vi.runAllTimers()
    const instance = element.getInstance()
    element.options = { uploadImage }
    expect(instance.setUploader).not.toHaveBeenCalled()
    const nextUploadImage = vi.fn()
    element.options = { uploadImage: nextUploadImage }
    vi.runAllTimers()
    expect(element.getInstance()).toBe(instance)
    expect(instance.setUploader).toHaveBeenCalledExactlyOnceWith(nextUploadImage)
    element.options = {}
    expect(instance.setUploader).toHaveBeenLastCalledWith(undefined)
  })

  it('necessary rebuilds retain current JSON and title, including edits while queued and repeated rebuilds', () => {
    mocks.realEditor = true
    const element = document.createElement('lark-doc')
    const initial = { content: '<p>初始正文</p>', title: '初始标题' }
    element.options = initial
    document.body.appendChild(element)
    vi.runAllTimers()
    const first = element.getInstance()
    first.getEditor().commands.insertContentAt(1, '用户输入')
    first.setTitle('编辑后标题')
    element.options = { ...initial, placeholder: '新配置' }
    first.getEditor().commands.insertContentAt(1, '排队期间')
    const edited = first.getJSON()
    vi.runAllTimers()
    expect(first.destroy).toHaveBeenCalledOnce()
    expect(element.getInstance().getJSON()).toEqual(edited)
    expect(element.getInstance().getTitle()).toBe('编辑后标题')
    element.options = { ...initial, placeholder: '再次更新' }
    vi.runAllTimers()
    expect(element.getInstance().getJSON()).toEqual(edited)
    expect(element.getInstance().getTitle()).toBe('编辑后标题')
  })

  it.each(['property', 'attribute'])('explicit new content via %s replaces current edits', source => {
    mocks.realEditor = true
    const element = document.createElement('lark-doc')
    if (source === 'property') element.options = { content: '<p>初始正文</p>' }
    else element.setAttribute('content', '<p>初始正文</p>')
    document.body.appendChild(element)
    vi.runAllTimers()
    element.getEditor().commands.insertContentAt(1, '用户输入')
    if (source === 'property') element.options = { content: '<p>新文档</p>' }
    else element.setAttribute('content', '<p>新文档</p>')
    // Coalescing another config update must not hide the explicit content replacement.
    element.setAttribute('placeholder', '新配置')
    vi.runAllTimers()
    expect(element.getEditor().getText()).toBe('新文档')
  })

  it('Web Component tolerates repeated connect and DOM moves without duplicate instances', () => {
    const element = document.createElement('lark-doc')
    document.body.appendChild(element)
    element.connectedCallback()
    vi.runAllTimers()
    const container = document.createElement('section')
    document.body.appendChild(container)
    container.appendChild(element)
    vi.runAllTimers()
    expect(mocks.documents).toHaveLength(1)
    expect(mocks.documents[0].destroy).not.toHaveBeenCalled()
  })

  it.each(['connect', 'rebuild'])('Web Component destroy cancels a queued %s', phase => {
    const element = document.createElement('lark-doc')
    document.body.appendChild(element)
    if (phase === 'rebuild') {
      vi.runAllTimers()
      element.options = { placeholder: '新配置' }
    }
    element.destroy()
    vi.runAllTimers()
    expect(element.getInstance()).toBeNull()
    expect(mocks.documents).toHaveLength(phase === 'connect' ? 0 : 1)
  })

  it('React forwards options/uploader properties, updates callbacks and removes event listeners', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const host = reactHost()
    const uploader = { upload: vi.fn(), onStart: vi.fn() }
    const options = { uploader, onReady: vi.fn() }
    const firstChange = vi.fn()
    const firstAttrs = host.render({ options, onChange: firstChange, readonly: true })
    expect(host.element.options).toBe(options)
    expect(firstAttrs).not.toHaveProperty('options')
    expect(firstAttrs).not.toHaveProperty('uploader')
    host.element.dispatchEvent(new CustomEvent('lark-doc-change', { detail: { payload: 'first' } }))
    expect(firstChange).toHaveBeenCalledOnce()
    const secondChange = vi.fn()
    const nextUploader = { ...uploader, onStart: vi.fn() }
    host.render({ options, uploader: nextUploader, onChange: secondChange })
    expect(host.element.options.uploader).toBe(nextUploader)
    expect(host.element.options.onReady).toBe(options.onReady)
    host.element.dispatchEvent(new CustomEvent('lark-doc-change', { detail: { payload: 'second' } }))
    expect(firstChange).toHaveBeenCalledOnce()
    expect(secondChange).toHaveBeenCalledExactlyOnceWith({ payload: 'second' }, expect.any(CustomEvent))
    host.render({ options: { ...options, uploader: { onSettled: vi.fn() } } })
    expect(host.element.options.uploader).not.toBe(nextUploader)
    host.render({})
    expect(host.element.options).toEqual({})
    host.unmount()
    host.element.dispatchEvent(new CustomEvent('lark-doc-change', { detail: {} }))
    expect(secondChange).toHaveBeenCalledOnce()
    expect(warn).not.toHaveBeenCalled()
  })

  it('Vue3 and React preserve the legacy uploadImage function as an options property', () => {
    const uploadImage = vi.fn()
    expect(resolveVue3Attrs({ uploadImage }).options?.uploadImage).toBe(uploadImage)
    const host = reactHost()
    const attrs = host.render({ uploadImage })
    expect(host.element.options.uploadImage).toBe(uploadImage)
    expect(attrs).not.toHaveProperty('upload-image')
    host.unmount()
  })
})

// Public element factory is another object-valued entry, not an attribute serializer.
it('createLarkDocElement 保留上传对象、函数和结构化配置', async () => {
  const { createLarkDocElement } = await import('../../src/web-component/index')
  const uploader = { upload: vi.fn(), onSuccess: vi.fn() }
  const content = { type: 'doc', content: [{ type: 'paragraph' }] }
  const element = createLarkDocElement({ uploader, content, title: 'factory title' })
  expect(element.options.uploader).toBe(uploader)
  expect(element.options.uploader.onSuccess).toBe(uploader.onSuccess)
  expect(element.options.content).toBe(content)
  expect(element.getAttribute('uploader')).toBeNull()
})

it('公开Element子类必要重建保留实时正文和标题', async () => {
  mocks.realEditor = true
  const { LarkDocElement: RuntimeElement } = await import('../../src/web-component/index')
  customElements.define('lark-doc-runtime-fixture', RuntimeElement)
  const element = document.createElement('lark-doc-runtime-fixture')
  element.options = { content: '<p>initial</p>', title: 'initial-title' }
  document.body.appendChild(element)
  vi.runAllTimers()
  element.getEditor().commands.insertContentAt(1, 'edited ')
  element.setTitle('edited-title')
  element.options = { ...element.options, placeholder: 'changed' }
  vi.runAllTimers()
  expect(element.getEditor().getText()).toBe('edited initial')
  expect(element.getTitle()).toBe('edited-title')
  element.destroy()
})
