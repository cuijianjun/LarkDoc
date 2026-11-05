// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLarkDocConfig, mergeLegacyConfig } from '../../src/components/lark-doc/larkDocConfig'
import { createDomRenderer } from '../../src/mount/domRenderer'
import LarkDocEditor from '../../src/components/lark-doc/LarkDocEditor'

const cleanups = []

function mountEditor(config = {}) {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const renderer = createDomRenderer()
  const handle = renderer.mount({ element, props: {
    initialContent: '<p>上下文格式能力</p>', storage: 'none',
    config: { ...config, modes: { persist: false } },
  } })
  cleanups.push(() => { renderer.destroy(handle); element.remove() })
  return { renderer, handle, root: renderer.getRoot(handle), vm: handle.nativeHost.host }
}

afterEach(() => {
  cleanups.splice(0).reverse().forEach((cleanup) => cleanup())
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('spec002 默认上下文工具栏与宿主兼容', () => {
  it('默认不挂载格式工具栏，不关闭上下文格式能力', async () => {
    const config = createLarkDocConfig()
    expect(config.layout.toolbarVisible).toBe(false)
    expect(config.layout.toolbarFixed).toBe(false)
    for (const feature of ['marks', 'headings', 'blockStyle', 'insert', 'blockHandle']) expect(config.features[feature]).toBe(true)
    const { handle, root, vm } = mountEditor()
    expect(root.querySelector('.lark-doc-toolbar')).toBeNull()
    expect(vm._toolbarUi.el.isConnected).toBe(false)
    expect(vm._bubbleUi).toBeDefined()
    expect(vm._blockHandleUi).toBeDefined()
    vm.$frame = { requestFrame: vi.fn(() => 1), cancelFrame: vi.fn() }
    handle.editor.commands.setTextSelection({ from: 1, to: 4 })
    vm.bubbleVisible = true
    vm.refreshBubbleBar()
    expect(root.querySelector('.lark-doc-bubble')).not.toBeNull()
    vm.handleRange = vm.currentBlockRange()
    vm.blockMenuOpen = true
    vm.refreshBlockHandle()
    await vm.$nextTick()
    expect(root.querySelector('.lark-doc-block-menu')).not.toBeNull()
    expect(handle.editor.commands.toggleBold()).toBe(true)
    expect(handle.editor.isActive('bold')).toBe(true)
  })

  it('显式显示支持非吸附工具栏，原 toolbarFixed=true 仍可兼容开启', async () => {
    expect(createLarkDocConfig({ layout: { toolbarVisible: true } }).layout).toMatchObject({ toolbarVisible: true, toolbarFixed: false })
    expect(createLarkDocConfig({ layout: { toolbarFixed: true } }).layout).toMatchObject({ toolbarVisible: true, toolbarFixed: true })
    expect(createLarkDocConfig({ layout: { toolbarFixed: true, toolbarVisible: false } }).layout.toolbarVisible).toBe(false)
    expect(createLarkDocConfig({ layout: { toolbarVisible: 'true' } }).layout.toolbarVisible).toBe(false)
    expect(mergeLegacyConfig({ layout: { toolbarVisible: true } }).layout.toolbarVisible).toBe(true)
    const { renderer, handle, root, vm } = mountEditor({ layout: { toolbarVisible: true } })
    expect(vm._toolbarUi.el.isConnected).toBe(true)
    expect(root.classList.contains('lark-doc-toolbar-fixed')).toBe(false)
    renderer.update(handle, { config: { layout: { toolbarFixed: true } } })
    await vm.$nextTick()
    expect(vm._toolbarUi.el.isConnected).toBe(true)
    expect(root.classList.contains('lark-doc-toolbar-fixed')).toBe(true)
    renderer.update(handle, { config: { layout: { toolbarFixed: true, toolbarVisible: false } } })
    await vm.$nextTick()
    expect(vm._toolbarUi.el.isConnected).toBe(false)
  })

  it.each(['普通', '作用域'])('标题栏和格式栏都隐藏时仍呈现宿主%s操作节点及侧栏', async (kind) => {
    const config = createLarkDocConfig({ layout: { headerVisible: false } })
    expect(config.layout).toMatchObject({ headerVisible: false, toolbarVisible: false })
    const nativeHost = document.createElement('div')
    const slotPark = document.createElement('div')
    const headerActions = document.createElement('div')
    const sidePanel = document.createElement('div')
    const action = document.createElement('button')
    const click = vi.fn()
    action.addEventListener('click', click)
    // 作用域内容由宿主求值，原生 renderer 接收并保留同一批 DOM 节点。
    const scoped = vi.fn(({ title }) => { action.textContent = title; return action })
    headerActions.appendChild(kind === '作用域' ? scoped({ title: '宿主操作' }) : action)
    sidePanel.textContent = '宿主侧栏'
    slotPark.append(headerActions, sidePanel)
    document.body.append(nativeHost, slotPark)
    const vm = {
      $props: { value: '<p>正文</p>', config }, value: '<p>正文</p>', config,
      $refs: { nativeHost, slotPark, headerActions, sidePanel },
      $emit: vi.fn(), $nextTick: (callback) => Promise.resolve().then(callback),
    }
    Object.entries(LarkDocEditor.methods).forEach(([name, method]) => { vm[name] = method.bind(vm) })
    LarkDocEditor.mounted.call(vm)
    cleanups.push(() => { LarkDocEditor.beforeDestroy.call(vm); nativeHost.remove(); slotPark.remove() })
    const host = vm._nativeHandle.nativeHost.host
    await host.$nextTick()
    expect(host.$refs.actionsPark.contains(action)).toBe(true)
    expect(host.$refs.actionsPark.style.display).toBe('flex')
    expect(host.$refs.externalPanel.contains(sidePanel)).toBe(true)
    expect(host._toolbarUi.el.isConnected).toBe(false)
    action.click()
    expect(click).toHaveBeenCalledTimes(1)
    if (kind === '作用域') expect(scoped).toHaveBeenCalledExactlyOnceWith({ title: '宿主操作' })
    LarkDocEditor.beforeDestroy.call(vm)
    expect(headerActions.parentNode).toBe(slotPark)
    expect(sidePanel.parentNode).toBe(slotPark)
  })
})
