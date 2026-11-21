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
  vi.unstubAllGlobals()
})

describe('桌面工具栏、上下文格式与宿主兼容', () => {
  it('默认挂载桌面格式工具栏，并保留上下文格式能力', async () => {
    const config = createLarkDocConfig()
    expect(config.layout.toolbarVisible).toBe(true)
    expect(config.layout.toolbarFixed).toBe(false)
    for (const feature of ['marks', 'headings', 'blockStyle', 'insert', 'blockHandle']) expect(config.features[feature]).toBe(true)
    const { handle, root, vm } = mountEditor()
    const toolbar = root.querySelector('.lark-doc-toolbar')
    expect(toolbar).toBe(vm._toolbarUi.el)
    const labels = [...toolbar.querySelectorAll('button[aria-label]')].map(button => button.getAttribute('aria-label'))
    const primary = ['撤销', '重做', '标题级别', '加粗', '设置链接', '插入表格', '图表', '查找']
    expect(labels.filter(label => primary.includes(label))).toEqual(primary)
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

  it('紧凑标题栏保留格式栏，并把导入、下载和主题归入已有菜单', async () => {
    const { renderer, handle, root, vm } = mountEditor({ layout: { compactHeader: true } })
    const labels = vm.templates.map(item => item.label)
    expect(labels).toContain('读书笔记')
    expect(labels).toContain('会议纪要')
    expect(new Set(labels).size).toBe(labels.length)
    const header = root.querySelector('.lark-doc-topbar')
    expect(header.classList.contains('is-compact-header')).toBe(true)
    expect(header.querySelector('.lark-doc-workspace-actions')).toBeNull()
    expect(root.querySelector('.lark-doc-toolbar [aria-label="加粗"]')).not.toBeNull()
    for (const label of ['阅读模式', '查找', '目录', '页面宽度', '演示模式', '快捷键帮助']) {
      expect(root.querySelector(`.lark-doc-toolbar [aria-label="${label}"]`)).toBeNull()
    }
    const createRange = document.createRange.bind(document)
    vi.spyOn(document, 'createRange').mockImplementation(() => Object.assign(createRange(), {
      getClientRects: () => [], getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 0, right: 0 }),
    }))
    vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
    header.querySelector('[aria-label="查找"]').click()
    await vi.waitFor(() => expect(vm.searchOpen).toBe(true))
    vm.closeSearch()
    header.querySelector('.lark-doc-more-btn').click()
    await vi.waitFor(() => expect(root.querySelector('[data-topbar-more-id="width"]')).not.toBeNull())
    root.querySelector('[data-topbar-more-id="width"]').click()
    await vi.waitFor(() => expect(root.querySelector('.is-width-settings')).not.toBeNull())
    const widths = Array.from(root.querySelectorAll('.is-width-settings [role="menuitemradio"]'))
    expect(widths.map(item => item.textContent)).toEqual(['默认', '较宽', '全宽'])
    expect(widths[0].getAttribute('aria-checked')).toBe('true')
    widths[1].click()
    await vi.waitFor(() => expect(root.classList.contains('lark-doc-width-wide')).toBe(true))

    const importInput = root.querySelector('input[aria-label="导入文档"]')
    const openImport = vi.spyOn(importInput, 'click').mockImplementation(() => {})
    const proto = window.HTMLDialogElement.prototype
    Object.defineProperties(proto, {
      showModal: { configurable: true, value() { this.open = true } },
      close: { configurable: true, value() { this.open = false } },
    })
    cleanups.unshift(() => { delete proto.showModal; delete proto.close })
    const more = header.querySelector('.lark-doc-more-btn')
    const importItem = () => root.querySelector('[data-topbar-more-id="import"]')
    expect(header.querySelector('.lark-doc-create-btn')).toBeNull()
    more.click()
    await vi.waitFor(() => expect(importItem()).not.toBeNull())
    expect(root.querySelector('[data-topbar-more-id="upload-file"]')).not.toBeNull()
    importItem().click()
    await vi.waitFor(() => expect(root.querySelector('dialog[open]')).not.toBeNull())
    expect(openImport).not.toHaveBeenCalled()
    const dialog = root.querySelector('dialog[open]')
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(dialog.open).toBe(false)
    expect(document.activeElement).toBe(more)
    await vi.waitFor(() => expect(importItem()).toBeNull())
    more.click()
    await vi.waitFor(() => expect(importItem()).not.toBeNull())
    importItem().click()
    await vi.waitFor(() => expect(dialog.open).toBe(true))
    const options = [...dialog.querySelectorAll('.lark-doc-import-formats button')]
    expect(options.map(button => button.textContent)).toEqual([
      'HTML.html / .htm', 'JSON.json', 'Markdown.md / .markdown / .mark / .txt', 'Word.doc / .docx',
    ])
    options[2].click()
    expect(openImport).toHaveBeenCalledTimes(1)
    expect(importInput.accept).toBe('.md,.markdown,.mark,.txt')
    expect(dialog.open).toBe(false)
    expect(document.activeElement).toBe(more)
    await vi.waitFor(() => expect(importItem()).toBeNull())

    more.click()
    await vi.waitFor(() => expect(root.querySelector('[data-topbar-more-id="download"]')).not.toBeNull())
    expect([...root.querySelectorAll('[data-topbar-more-id]')].map(row => row.dataset.topbarMoreId)).toContain('theme')
    expect(root.querySelector('[data-topbar-more-id="history-comments"]')).not.toBeNull()
    root.querySelector('[data-topbar-more-id="download"]').click()
    await vi.waitFor(() => {
      const formats = [...root.querySelectorAll('.lark-doc-topbar-more-submenu button')].map(button => button.textContent)
      expect(formats).toEqual(['Word', 'PDF', 'Markdown', 'HTML', 'JSON（完整正文）', '纯文本'])
    })
    renderer.update(handle, { config: { layout: { compactHeader: true }, importExport: { importEnabled: false, exportEnabled: false } } })
    await vi.waitFor(() => expect(root.querySelector('[data-topbar-more-id="download"]').disabled).toBe(true))
    expect(importItem().disabled).toBe(true)
    expect(root.querySelector('[data-topbar-more-id="upload-file"]').disabled).toBe(false)
    expect(openImport).toHaveBeenCalledTimes(1)
  })

  it('可独立设置工具栏显隐和吸顶', async () => {
    expect(createLarkDocConfig({ layout: { toolbarVisible: true } }).layout).toMatchObject({ toolbarVisible: true, toolbarFixed: false })
    expect(createLarkDocConfig({ layout: { toolbarFixed: true } }).layout).toMatchObject({ toolbarVisible: true, toolbarFixed: true })
    expect(createLarkDocConfig({ layout: { toolbarFixed: true, toolbarVisible: false } }).layout.toolbarVisible).toBe(false)
    expect(createLarkDocConfig({ layout: { toolbarVisible: 'true' } }).layout.toolbarVisible).toBe(true)
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

  it('切到手机触屏时关闭桌面操作层并收回宿主按钮', async () => {
    const media = Object.assign(new EventTarget(), { matches: false })
    vi.stubGlobal('matchMedia', query => query.includes('pointer') ? media : { matches: true })
    const { root, vm } = mountEditor({ layout: { headerVisible: false } })
    const action = document.createElement('button')
    vm.$refs.actionsHost.append(action)
    root.querySelector('.lark-doc-toolbar [aria-label="文档操作"]').click()
    await vi.waitFor(() => expect(root.querySelector('.lark-doc-header-menu')?.contains(action)).toBe(true))
    media.matches = true
    media.dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect(vm.$refs.actionsPark.contains(action)).toBe(true))
    expect(vm.headerMenuOpen).toBe(false)
    expect(root.querySelector('.lark-doc-toolbar')).toBeNull()
  })

  it.each(['普通', '作用域'])('标题栏和格式栏都隐藏时仍呈现宿主%s操作节点及侧栏', async (kind) => {
    const config = createLarkDocConfig({ layout: { headerVisible: false, toolbarVisible: false } })
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
