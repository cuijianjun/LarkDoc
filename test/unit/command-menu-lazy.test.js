// @vitest-environment jsdom
import fs from 'fs'
import path from 'path'
import { transformSync } from '@babel/core'
import compiler from 'vue-template-compiler'
import Vue from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import commandMenuMixin from '../../src/components/lark-doc/editor/commandMenuMixin'
import isvMixin from '../../src/components/lark-doc/editor/isvMixin'
import overlayDismissMixin from '../../src/components/lark-doc/editor/overlayDismissMixin'

function loadSfc(relative, dependencies = {}) {
  const filename = path.resolve(__dirname, '../../src/components/lark-doc', relative)
  const source = compiler.parseComponent(fs.readFileSync(filename, 'utf8'))
  const { code } = transformSync(source.script.content, {
    filename, babelrc: false, configFile: false,
    plugins: ['@babel/plugin-transform-dynamic-import', '@babel/plugin-transform-modules-commonjs'],
  })
  const exports = {}
  new Function('require', 'exports', code)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name]
    return name.endsWith('.vue') ? { render: (h) => h('span') } : {}
  }, exports)
  return { options: exports.default, template: source.template.content }
}

const menu = loadSfc('CommandMenu.vue')
const CommandMenu = { ...menu.options, ...compiler.compileToFunctions(menu.template) }
const isvPanel = loadSfc('editor/IsvButtonPanel.vue')
const IsvButtonPanel = { ...isvPanel.options, ...compiler.compileToFunctions(isvPanel.template) }
const hosts = []
const rect = (left = 900, top = 680) => ({ left, top, bottom: top + 20, right: left + 20, width: 20, height: 20 })

function mountHost() {
  let resolveMenu
  const pending = new Promise((resolve) => { resolveMenu = resolve })
  const load = vi.fn(() => pending)
  const editor = loadSfc('LarkDocEditor.vue', {
    './CommandMenu.vue': { __esModule: true, default: CommandMenu },
    '../../adapters/vue2/nodeviews': { registerVue2NodeViews() {} },
  })
  const components = { ...editor.options.components }
  components.CommandMenu = load
  const branch = editor.template.match(/<command-menu\b[\s\S]*?\/>/)[0]
  const vm = new Vue({
    components,
    mixins: [commandMenuMixin],
    data() { return Vue.observable({ effectiveReadonly: false, savedSelection: null, templates: [], larkDocConfig: {} }) },
    beforeDestroy() { this.closeCommandMenu() },
    methods: {
      writable() { return !this.effectiveReadonly },
      featureEnabled: () => true,
      closeBlockMenu: vi.fn(), rememberSelection: vi.fn(), restoreSelection: vi.fn(),
      focus: vi.fn(), executeCommand: vi.fn(),
    },
    ...compiler.compileToFunctions(`<div ref="root">${branch}</div>`),
  }).$mount()
  document.body.appendChild(vm.$el)
  hosts.push(vm)
  vi.spyOn(vm, 'focus')
  vi.spyOn(vm, 'executeCommand')
  const position = vi.spyOn(vm, 'positionCommandMenu')
  return {
    vm, load, position, editor,
    open(kind = 'plus', anchor = rect()) {
      const trigger = document.createElement('button')
      trigger.getBoundingClientRect = () => anchor
      vm.openCommandMenu(kind, { currentTarget: trigger })
    },
    async ready() {
      resolveMenu(CommandMenu)
      await pending
      await Vue.nextTick()
      await Vue.nextTick()
    },
  }
}

function mountIsvHost() {
  let resolvePanel
  const pending = new Promise((resolve) => { resolvePanel = resolve })
  const load = vi.fn(() => pending)
  const editor = loadSfc('LarkDocEditor.vue', {
    '../../adapters/vue2/nodeviews': { registerVue2NodeViews() {} },
  })
  const coords = { value: rect(100, 150) }
  const setIsv = vi.fn(() => chain)
  const chain = { focus: () => chain, setIsv, run: vi.fn(() => true) }
  const branch = editor.template.match(/<IsvButtonPanel\b[\s\S]*?\/>/)[0]
  const vm = new Vue({
    components: { IsvButtonPanel: load },
    mixins: [isvMixin],
    data() { return Vue.observable({ effectiveReadonly: false }) },
    computed: { self() { return this } },
    beforeDestroy() { this.closeIsvPanel() },
    methods: { writable() { return !this.effectiveReadonly } },
    ...compiler.compileToFunctions(`<div ref="root">${branch}</div>`),
  }).$mount()
  vm.editor = { state: { selection: { from: 1 } }, view: { coordsAtPos: () => coords.value }, chain: () => chain }
  document.body.appendChild(vm.$el)
  hosts.push(vm)
  return {
    vm, load, coords, setIsv,
    async ready() {
      resolvePanel(IsvButtonPanel)
      await pending
      await Vue.nextTick()
      await Vue.nextTick()
    },
  }
}

function mockMenuLayout() {
  return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    if (this.classList.contains('lark-doc-command-menu')) return { ...rect(), width: 470, height: 300 }
    return rect()
  })
}

function slashEditor() {
  return { view: { coordsAtPos: vi.fn(() => rect(40, 100)), composing: false } }
}

afterEach(() => {
  for (const vm of hosts.splice(0)) vm.$destroy()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('CommandMenu 内部异步挂载', () => {
  it('真实门面保留公开选项对象，内部工厂在调用前不加载菜单模块', async () => {
    let loads = 0
    const { options } = loadSfc('LarkDocEditor.vue', {
      get './CommandMenu.vue'() { loads += 1; return { __esModule: true, default: CommandMenu } },
      '../../adapters/vue2/nodeviews': { registerVue2NodeViews() {} },
    })
    expect(options.name).toBe('LarkDocEditor')
    expect(options).toBeTypeOf('object')
    expect(loads).toBe(0)
    expect(options.components.CommandMenu).toBeTypeOf('function')
    await expect(options.components.CommandMenu()).resolves.toMatchObject({ default: CommandMenu })
    expect(loads).toBe(1)
    expect(options.components.IsvButtonPanel).toBeTypeOf('function')
    const { options: isvEditor } = loadSfc('LarkDocEditor.vue', {
      get './editor/IsvButtonPanel.vue'() { loads += 1; return { __esModule: true, default: IsvButtonPanel } },
      '../../adapters/vue2/nodeviews': { registerVue2NodeViews() {} },
    })
    expect(loads).toBe(1)
    await expect(isvEditor.components.IsvButtonPanel()).resolves.toMatchObject({ default: IsvButtonPanel })
    expect(loads).toBe(2)
  })

  it('首次加载期间不抢焦点，mounted-ready 后按真实尺寸定位并聚焦 plus 搜索框', async () => {
    mockMenuLayout()
    const host = mountHost()
    const ready = vi.spyOn(host.vm, 'onCommandMenuReady')
    expect(host.load).not.toHaveBeenCalled()
    host.open()
    await Vue.nextTick()
    expect(host.load).toHaveBeenCalledTimes(1)
    expect(host.vm.$refs.commandMenu).toBeUndefined()
    expect(document.activeElement).toBe(document.body)
    const calls = host.position.mock.calls.length
    await host.ready()
    expect(ready).toHaveBeenCalledWith(host.vm.$refs.commandMenu)
    expect(host.position.mock.calls.length).toBeGreaterThan(calls)
    expect(host.vm.menuMaxHeight).toBe(300)
    expect(host.vm.menuPosition).toEqual({ left: 546, top: 374 })
    expect(document.activeElement).toBe(host.vm.$refs.commandMenu.$refs.search)
    expect(host.vm.focus).not.toHaveBeenCalled()
  })

  it('首次 slash 挂载只定位，保留正文焦点和加载期间更新的查询串', async () => {
    mockMenuLayout()
    const host = mountHost()
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    host.vm.editor = slashEditor()
    host.vm.onSlash({ from: 1, to: 2, query: '' })
    await Vue.nextTick()
    host.vm.onSlash({ from: 1, to: 4, query: '标题' })
    await host.ready()
    expect(host.vm.$refs.commandMenu.query).toBe('标题')
    expect(host.vm.menuPosition).toEqual({ left: 40, top: 126 })
    expect(host.vm.menuMaxHeight).toBe(300)
    expect(document.activeElement).toBe(input)
  })

  it.each(['close', 'readonly', 'destroy'])('加载中 %s 后完成不复活菜单、不定位或聚焦', async (action) => {
    const host = mountHost()
    host.open()
    await Vue.nextTick()
    if (action === 'close') host.vm.closeCommandMenu()
    if (action === 'readonly') host.vm.effectiveReadonly = true
    if (action === 'destroy') host.vm.$destroy()
    const calls = host.position.mock.calls.length
    await host.ready()
    expect(host.vm.$refs.root?.querySelector('.lark-doc-command-menu') || null).toBeNull()
    expect(host.position).toHaveBeenCalledTimes(calls)
    expect(host.vm.focus).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(document.body)
  })

  it('加载中 plus 切 slash 不抢焦点，清除旧触发器并按最新光标定位', async () => {
    mockMenuLayout()
    const host = mountHost()
    host.open()
    await Vue.nextTick()
    host.vm.editor = slashEditor()
    host.vm.onSlash({ from: 1, to: 2, query: '' })
    await host.ready()
    expect(host.vm.menuTrigger).toBeNull()
    expect(host.vm.menuPosition).toEqual({ left: 40, top: 126 })
    expect(document.activeElement).toBe(document.body)
  })

  it('加载中关闭再打开以最新锚点定位聚焦，后续热打开仍正常', async () => {
    mockMenuLayout()
    const host = mountHost()
    host.open()
    await Vue.nextTick()
    host.vm.closeCommandMenu()
    host.open('plus', rect(50, 150))
    await host.ready()
    expect(host.load).toHaveBeenCalledTimes(1)
    expect(host.vm.menuPosition).toEqual({ left: 50, top: 176 })
    expect(document.activeElement).toBe(host.vm.$refs.commandMenu.$refs.search)
    host.vm.closeCommandMenu()
    await Vue.nextTick()
    host.open('plus', rect(70, 170))
    await Vue.nextTick()
    await Vue.nextTick()
    expect(host.vm.menuPosition).toEqual({ left: 70, top: 196 })
    expect(document.activeElement).toBe(host.vm.$refs.commandMenu.$refs.search)
  })

  it('已挂载的 slash 切 plus 复用实例时也能聚焦', async () => {
    const host = mountHost()
    host.vm.editor = slashEditor()
    host.vm.onSlash({ from: 1, to: 2, query: '' })
    await Vue.nextTick()
    await host.ready()
    const menuVm = host.vm.$refs.commandMenu
    host.open()
    await Vue.nextTick()
    await Vue.nextTick()
    expect(host.vm.$refs.commandMenu).toBe(menuVm)
    expect(document.activeElement).toBe(menuVm.$refs.search)
  })

  it.each(['close', 'readonly', 'destroy', 'reopen'])('mounted-ready 排队后 %s 时丢弃陈旧工作', async (action) => {
    const host = mountHost()
    host.open()
    await Vue.nextTick()
    await host.ready()
    const oldMenu = host.vm.$refs.commandMenu
    const focus = vi.spyOn(oldMenu, 'focusSearch')
    host.position.mockClear()
    host.vm.onCommandMenuReady(oldMenu)
    if (action === 'readonly') host.vm.effectiveReadonly = true
    else if (action === 'destroy') host.vm.$destroy()
    else {
      host.vm.closeCommandMenu()
      if (action === 'reopen') host.vm.openCommandMenu('slash')
    }
    await Vue.nextTick()
    expect(focus).not.toHaveBeenCalled()
    if (action !== 'reopen') expect(host.position).not.toHaveBeenCalled()
  })

  it('不接收已卸载实例的迟到 ready，也不执行关闭后的旧聚焦回调', async () => {
    const host = mountHost()
    host.open()
    await Vue.nextTick()
    await host.ready()
    const oldMenu = host.vm.$refs.commandMenu
    const focus = vi.spyOn(oldMenu, 'focusSearch')
    host.vm.closeCommandMenu(true)
    expect(host.vm.focus).toHaveBeenCalledTimes(1)
    await Vue.nextTick()
    host.open()
    await Vue.nextTick()
    await Vue.nextTick()
    host.vm.focus.mockClear()
    host.position.mockClear()
    host.vm.onCommandMenuReady(oldMenu)
    await Vue.nextTick()
    expect(focus).not.toHaveBeenCalled()
    expect(host.position).not.toHaveBeenCalled()
    host.vm.closeCommandMenu(true)
    host.open()
    host.vm.focus.mockClear()
    await Vue.nextTick()
    await Vue.nextTick()
    expect(host.vm.focus).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(host.vm.$refs.commandMenu.$refs.search)
  })

  it.each(['reopen', 'readonly', 'destroy'])('同步命令执行后 %s 不让旧恢复焦点回调抢焦点', async (action) => {
    const host = mountHost()
    host.open()
    await Vue.nextTick()
    await host.ready()
    host.vm.chooseCommand({ id: 'paragraph' })
    expect(host.vm.executeCommand).toHaveBeenCalledWith('paragraph', undefined)
    expect(host.vm.focus).toHaveBeenCalledTimes(2)
    if (action === 'reopen') host.open()
    if (action === 'readonly') host.vm.effectiveReadonly = true
    if (action === 'destroy') host.vm.$destroy()
    host.vm.focus.mockClear()
    await Vue.nextTick()
    await Vue.nextTick()
    expect(host.vm.focus).not.toHaveBeenCalled()
  })

  it('加载完成前键盘选择和执行仍同步，不等待组件模块', async () => {
    const host = mountHost()
    host.vm.openCommandMenu('slash')
    await Vue.nextTick()
    host.vm.moveCommand(1)
    const item = host.vm.filteredCommands[host.vm.activeCommandIndex]
    const event = { key: 'Enter', preventDefault: vi.fn() }
    const result = host.vm.onEditorKeydown(event)
    expect(result).toBeUndefined()
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(host.vm.executeCommand).toHaveBeenCalledWith(item.id, undefined)
    expect(host.vm.menuOpen).toBe(false)
    await host.ready()
    expect(host.vm.$refs.commandMenu).toBeUndefined()
  })
})

describe('IsvButtonPanel 低频异步挂载', () => {
  it('未打开不加载，首次 ready 按最新选区定位并聚焦按钮文字，确认仍同步插块', async () => {
    const host = mountIsvHost()
    expect(host.load).not.toHaveBeenCalled()
    host.vm.startIsvButton('open_link')
    await Vue.nextTick()
    expect(host.load).toHaveBeenCalledTimes(1)
    expect(host.vm.$refs.isvPanel).toBeUndefined()
    host.coords.value = rect(140, 180)
    await host.ready()
    expect(host.vm.isvPanelStyle).toEqual({ left: '140px', top: '206px' })
    expect(document.activeElement).toBe(host.vm.$el.querySelector('[aria-label="按钮文字"]'))
    host.vm.isvLinkUrl = 'https://example.com'
    expect(host.vm.confirmIsvButton()).toBeUndefined()
    expect(host.setIsv).toHaveBeenCalledTimes(1)
    expect(host.vm.isvPanelOpen).toBe(false)
  })

  it.each(['cancel', 'escape', 'outside', 'readonly', 'destroy'])('加载中 %s 后不会迟到挂载或抢焦点，也不插块', async (action) => {
    const host = mountIsvHost()
    host.vm.startIsvButton('open_link')
    await Vue.nextTick()
    if (action === 'cancel') host.vm.closeIsvPanel()
    if (action === 'escape') overlayDismissMixin.methods.onWindowKeydown.call({
      applyModeShortcut: () => false, headingNumberMenu: { open: false },
      isvPanelOpen: true, closeIsvPanel: () => host.vm.closeIsvPanel(),
    }, { key: 'Escape' })
    if (action === 'outside') overlayDismissMixin.methods.onDocumentPointerDown.call({
      isvPanelOpen: true, closeIsvPanel: () => host.vm.closeIsvPanel(),
      headingNumberMenu: { open: false }, $refs: host.vm.$refs,
    }, { target: document.body })
    if (action === 'readonly') host.vm.effectiveReadonly = true
    if (action === 'destroy') host.vm.$destroy()
    await host.ready()
    expect(host.vm.$refs.isvPanel).toBeUndefined()
    expect(document.activeElement).toBe(document.body)
    expect(host.setIsv).not.toHaveBeenCalled()
  })

  it.each(['close', 'readonly', 'destroy', 'reopen'])('ready 排队后 %s 时不执行旧面板的聚焦', async (action) => {
    const host = mountIsvHost()
    host.vm.startIsvButton('open_link')
    await Vue.nextTick()
    await host.ready()
    const panel = host.vm.$refs.isvPanel
    const focus = vi.spyOn(panel.$el.querySelector('[aria-label="按钮文字"]'), 'focus')
    host.vm.onIsvPanelReady(panel)
    if (action === 'readonly') host.vm.effectiveReadonly = true
    else if (action === 'destroy') host.vm.$destroy()
    else {
      host.vm.closeIsvPanel()
      if (action === 'reopen') host.vm.startIsvButton('follow_page')
    }
    await Vue.nextTick()
    await Vue.nextTick()
    expect(focus).not.toHaveBeenCalled()
    expect(host.setIsv).not.toHaveBeenCalled()
    if (action === 'reopen') {
      expect(host.vm.$refs.isvPanel).not.toBe(panel)
      expect(document.activeElement).toBe(host.vm.$refs.isvPanel.$el.querySelector('[aria-label="按钮文字"]'))
    }
  })

  it('加载中取消重开使用最新动作，缓存热打开和迟到旧 ready 均安全', async () => {
    const host = mountIsvHost()
    host.vm.startIsvButton('open_link')
    await Vue.nextTick()
    host.vm.closeIsvPanel()
    host.vm.startIsvButton('follow_page')
    await host.ready()
    expect(host.load).toHaveBeenCalledTimes(1)
    expect(host.vm.isvAction).toBe('follow_page')
    expect(host.vm.$el.querySelector('[aria-label="超链接地址"]')).toBeNull()
    const oldPanel = host.vm.$refs.isvPanel
    const focus = vi.spyOn(oldPanel.$el.querySelector('[aria-label="按钮文字"]'), 'focus')
    host.vm.closeIsvPanel()
    await Vue.nextTick()
    host.vm.startIsvButton('open_link')
    await Vue.nextTick()
    await Vue.nextTick()
    host.vm.onIsvPanelReady(oldPanel)
    await Vue.nextTick()
    expect(focus).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(host.vm.$refs.isvPanel.$el.querySelector('[aria-label="按钮文字"]'))
  })
})
