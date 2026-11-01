// @vitest-environment jsdom
import fs from 'fs'
import path from 'path'
import { transformSync } from '@babel/core'
import compiler from 'vue-template-compiler'
import Vue, { markRaw } from 'vue'
import { getSchema } from '@tiptap/core'
import { EditorState } from '@tiptap/pm/state'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import revisionMixin from '../../src/components/lark-doc/editor/revisionMixin'
import calloutColorMixin from '../../src/components/lark-doc/editor/calloutColorMixin'
import toolbarMenusMixin from '../../src/components/lark-doc/editor/toolbarMenusMixin'
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

const schema = getSchema(createLarkDocExtensions())
const revision = loadSfc('editor/RevisionPanel.vue')
const RevisionPanel = { ...revision.options, ...compiler.compileToFunctions(revision.template) }
const palette = loadSfc('editor/ColorPalette.vue')
const ColorPalette = { ...palette.options, ...compiler.compileToFunctions(palette.template) }
const callout = loadSfc('editor/CalloutTools.vue')
const CalloutTools = { ...callout.options, ...compiler.compileToFunctions(callout.template) }
const hosts = []
const item = (id = 'r1', text = '新增') => ({ id, text })

function stateOf(items) {
  return EditorState.create({ schema, doc: schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create(null, items.map(({ id, text }) => schema.text(text, [
      schema.marks.revision.create({ revisionId: id, kind: 'insert', author: '测试用户' }),
    ]))),
  ]) })
}

function mountRevision(items = [], interactionMode = 'suggest') {
  let resolvePanel
  const pending = new Promise((resolve) => { resolvePanel = resolve })
  const load = vi.fn(() => pending)
  const editor = loadSfc('LarkDocEditor.vue', {
    '../../adapters/vue2/nodeviews': { registerVue2NodeViews() {} },
  })
  const branch = editor.template.match(/<RevisionPanel\b[\s\S]*?\/>/)[0]
  const dom = document.createElement('div')
  dom.getBoundingClientRect = () => ({ right: 600, top: 100 })
  let anchorTop = 120
  let vm
  const engine = markRaw({
    state: stateOf(items), storage: { larkDocRevisionTracker: { active: false } },
    view: {
      dom,
      coordsAtPos: () => ({ top: anchorTop }),
      dispatch: (tr) => { engine.state = engine.state.apply(tr); vm.updateRevisionPanels() },
    },
  })
  vm = new Vue({
    components: { RevisionPanel: load },
    mixins: [revisionMixin],
    data() { return Vue.observable({ editor: engine, interactionMode }) },
    computed: { self() { return this } },
    methods: { writable() { return this.interactionMode !== 'read' } },
    ...compiler.compileToFunctions(`<div>${branch}</div>`),
  }).$mount()
  document.body.appendChild(vm.$el)
  hosts.push(vm)
  return {
    vm, load, engine,
    replace(next) { engine.state = stateOf(next); vm.updateRevisionPanels() },
    move(top) { anchorTop = top; window.dispatchEvent(new Event('scroll')) },
    async ready() {
      resolvePanel(RevisionPanel)
      await pending
      await Vue.nextTick()
      await Vue.nextTick()
    },
  }
}

function mountPalette() {
  let resolvePanel
  const pending = new Promise((resolve) => { resolvePanel = resolve })
  const load = vi.fn(() => pending)
  const editor = loadSfc('LarkDocEditor.vue', {
    '../../adapters/vue2/nodeviews': { registerVue2NodeViews() {} },
  })
  const branch = editor.template.match(/<ColorPalette\b[\s\S]*?\/>/)[0]
  const vm = new Vue({
    components: { ColorPalette: load },
    mixins: [calloutColorMixin, toolbarMenusMixin, overlayDismissMixin],
    data() { return {
      effectiveReadonly: false, headingNumberMenu: { open: false }, tableBoundary: { visible: false },
      editor: markRaw({ getAttributes: () => ({}) }),
    } },
    computed: { self() { return this } },
    watch: { effectiveReadonly: editor.options.watch.effectiveReadonly },
    methods: {
      writable() { return !this.effectiveReadonly },
      run() {}, focus() {},
      closeCommandMenu() {}, closeMentionPanel() {}, closeReminderPopover() {}, closeCalendarSearch() {},
      closeBlockMenu() {}, clearHandleHighlight() {}, closeBubbleAlignMenu() {}, updateTableBoundary() {},
    },
    ...compiler.compileToFunctions(`<div ref="root">${branch}</div>`),
  }).$mount()
  document.body.appendChild(vm.$el)
  hosts.push(vm)
  vm.editor.setEditable = vi.fn()
  vm.editor.emit = vi.fn()
  vi.spyOn(vm, 'run')
  vi.spyOn(vm, 'focus')
  const trigger = (left = 40, bottom = 80) => ({ currentTarget: { getBoundingClientRect: () => ({ left, bottom }) } })
  return {
    vm, load,
    open(target = 'textColor', left, bottom) { vm.toggleColorPalette(target, trigger(left, bottom)) },
    hover() { vm.openColorPaletteOnHover(trigger()) },
    async ready() {
      resolvePanel(ColorPalette)
      await pending
      await Vue.nextTick()
      await Vue.nextTick()
    },
  }
}

function mountCallout() {
  let resolveTools
  const pending = new Promise((resolve) => { resolveTools = resolve })
  const load = vi.fn(() => pending)
  const editor = loadSfc('LarkDocEditor.vue', {
    '../../adapters/vue2/nodeviews': { registerVue2NodeViews() {} },
  })
  const branch = editor.template.match(/<CalloutTools\b[\s\S]*?\/>/)[0]
  const element = document.createElement('div')
  element.getBoundingClientRect = () => ({ top: 200, right: 600 })
  const engine = markRaw({
    state: { selection: { $from: { depth: 1, node: () => ({ type: { name: 'callout' } }), before: () => 0 } } },
    view: { nodeDOM: () => element },
    getAttributes: () => ({}),
  })
  const vm = new Vue({
    components: { CalloutTools: load },
    mixins: [calloutColorMixin, overlayDismissMixin],
    data() { return { editor: engine, effectiveReadonly: false, calloutSelected: false, calloutsEnabled: true } },
    computed: { self() { return this } },
    methods: {
      writable() { return !this.effectiveReadonly && this.calloutSelected },
      featureEnabled() { return this.calloutsEnabled },
      run() {}, focus() {},
    },
    ...compiler.compileToFunctions(`<div ref="root"><div class="lark-doc-paper">${branch}</div></div>`),
  }).$mount()
  document.body.appendChild(vm.$el)
  hosts.push(vm)
  const paper = vm.$el.querySelector('.lark-doc-paper')
  paper.getBoundingClientRect = () => ({ top: 100, left: 20 })
  Object.defineProperty(paper, 'clientWidth', { value: 800 })
  vi.spyOn(vm, 'run')
  vi.spyOn(vm, 'focus')
  return {
    vm, load,
    select() { vm.calloutSelected = true; vm.updateCalloutTools() },
    async ready() {
      resolveTools(CalloutTools)
      await pending
      await Vue.nextTick()
      await Vue.nextTick()
    },
  }
}

afterEach(() => {
  for (const vm of hosts.splice(0)) vm.$destroy()
  document.body.innerHTML = ''
  window.localStorage.clear()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('RevisionPanel 纯渲染异步边界', () => {
  it.each([
    ['RevisionPanel', RevisionPanel], ['ColorPalette', ColorPalette], ['CalloutTools', CalloutTools],
  ])('公开编辑器保持同步选项对象，%s 模块只在异步工厂调用时加载', async (name, component) => {
    let loads = 0
    const dependencies = { '../../adapters/vue2/nodeviews': { registerVue2NodeViews() {} } }
    Object.defineProperty(dependencies, `./editor/${name}.vue`, {
      get() { loads += 1; return { __esModule: true, default: component } },
    })
    const { options } = loadSfc('LarkDocEditor.vue', dependencies)
    expect(options.name).toBe('LarkDocEditor')
    expect(options).toBeTypeOf('object')
    expect(loads).toBe(0)
    await expect(options.components[name]()).resolves.toMatchObject({ default: component })
    expect(loads).toBe(1)
  })

  it('无修订不加载，加载期间用最新修订与定位，挂载不抢焦点', async () => {
    const host = mountRevision()
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    await Vue.nextTick()
    expect(host.load).not.toHaveBeenCalled()
    host.replace([item()])
    await Vue.nextTick()
    expect(host.load).toHaveBeenCalledTimes(1)
    expect(host.vm.$el.querySelector('.lark-doc-revision-panel')).toBeNull()
    host.replace([item('r2', '最新建议')])
    host.move(230)
    await host.ready()
    const panel = host.vm.$el.querySelector('.lark-doc-revision-panel')
    expect(panel.textContent).toContain('最新建议')
    expect(panel.style.left).toBe('612px')
    expect(panel.style.top).toBe('230px')
    expect(document.activeElement).toBe(input)
  })

  it.each(['remove', 'destroy'])('加载中 %s 不会迟到复活面板，销毁仍清理父级监听', async (action) => {
    const host = mountRevision([item()])
    await Vue.nextTick()
    const remove = vi.spyOn(window, 'removeEventListener')
    const domRemove = vi.spyOn(host.engine.view.dom, 'removeEventListener')
    if (action === 'remove') host.replace([])
    else host.vm.$destroy()
    await host.ready()
    expect(host.vm.$el.querySelector('.lark-doc-revision-panel')).toBeNull()
    if (action === 'destroy') {
      expect(remove).toHaveBeenCalledWith('scroll', host.vm.onRevisionViewportChange, true)
      expect(remove).toHaveBeenCalledWith('resize', host.vm.onRevisionViewportChange)
      expect(domRemove).toHaveBeenCalledWith('pointerdown', host.vm.onRevisionPointerDown)
    }
  })

  it('只读初次打开仍显示面板，接受拒绝禁用，hover 不展开，切回可编辑恢复', async () => {
    const host = mountRevision([item()], 'read')
    await Vue.nextTick()
    await host.ready()
    const panel = () => host.vm.$el.querySelector('.lark-doc-revision-panel')
    expect(panel().classList.contains('is-readonly')).toBe(true)
    expect(panel().querySelector('.is-accept').disabled).toBe(true)
    expect(panel().querySelector('.is-reject').disabled).toBe(true)
    panel().dispatchEvent(new Event('mouseenter'))
    await Vue.nextTick()
    expect(panel().querySelector('.lark-doc-revision-input')).toBeNull()
    host.vm.interactionMode = 'suggest'
    await Vue.nextTick()
    panel().dispatchEvent(new Event('mouseenter'))
    await Vue.nextTick()
    expect(panel().querySelector('.is-accept').disabled).toBe(false)
    expect(panel().querySelector('.lark-doc-revision-input')).not.toBeNull()
    panel().dispatchEvent(new Event('mouseleave'))
    await Vue.nextTick()
    expect(panel().querySelector('.lark-doc-revision-input')).toBeNull()
  })

  it.each(['accept', 'reject'])('挂载后 %s 同步派发原命令，末条移除后隐藏，再次出现复用加载结果', async (action) => {
    const host = mountRevision([item()])
    await Vue.nextTick()
    await host.ready()
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    host.vm.$el.querySelector(`.is-${action}`).dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(host.vm.revisionPanels).toEqual([])
    expect(host.engine.state.doc.textContent).toBe(action === 'accept' ? '新增' : '')
    await Vue.nextTick()
    expect(host.vm.$el.querySelector('.lark-doc-revision-panel')).toBeNull()
    host.replace([item('r3', '重新出现')])
    await Vue.nextTick()
    expect(host.vm.$el.textContent).toContain('重新出现')
    expect(host.load).toHaveBeenCalledTimes(1)
  })
})

describe('ColorPalette 纯渲染异步边界', () => {
  it('关闭时不加载，首次挂载使用最新目标与定位且不抢焦点', async () => {
    const host = mountPalette()
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    expect(host.load).not.toHaveBeenCalled()
    host.open()
    await Vue.nextTick()
    expect(host.load).toHaveBeenCalledTimes(1)
    expect(host.vm.$el.querySelector('.lark-doc-color-palette')).toBeNull()
    host.open('calloutBorder', 90, 110)
    await host.ready()
    const panel = host.vm.$el.querySelector('.lark-doc-color-palette')
    expect(panel.getAttribute('aria-label')).toBe('高亮块边框颜色面板')
    expect(panel.style.left).toBe('90px')
    expect(panel.style.top).toBe('116px')
    expect(document.activeElement).toBe(input)
    expect(host.vm.focus).not.toHaveBeenCalled()
  })

  it.each(['toggle', 'escape', 'outside', 'hover', 'readonly', 'destroy'])('加载中 %s 关闭不会迟到复活或执行命令', async (action) => {
    vi.useFakeTimers()
    const host = mountPalette()
    host.open()
    await Vue.nextTick()
    if (action === 'toggle') host.open()
    if (action === 'escape') host.vm.closeOverlay()
    if (action === 'outside') host.vm.onDocumentPointerDown({ target: document.body })
    if (action === 'hover') { host.vm.scheduleColorPaletteClose(); vi.advanceTimersByTime(150) }
    if (action === 'readonly') { host.vm.effectiveReadonly = true; await Vue.nextTick() }
    if (action === 'destroy') host.vm.$destroy()
    await host.ready()
    expect(host.vm.$el.querySelector('.lark-doc-color-palette')).toBeNull()
    expect(host.vm.run).not.toHaveBeenCalled()
    if (action !== 'escape') expect(host.vm.focus).not.toHaveBeenCalled()
    if (action === 'readonly') expect(host.vm.colorPaletteOpen).toBe('')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('hover 加载期间离开再重入取消关闭，挂载后进出仍沿用原计时器', async () => {
    vi.useFakeTimers()
    const host = mountPalette()
    host.hover()
    await Vue.nextTick()
    host.vm.scheduleColorPaletteClose()
    vi.advanceTimersByTime(100)
    host.hover()
    vi.advanceTimersByTime(150)
    expect(host.vm.colorPaletteOpen).toBe('textColor')
    await host.ready()
    const panel = host.vm.$el.querySelector('.lark-doc-color-palette')
    panel.dispatchEvent(new Event('mouseleave'))
    vi.advanceTimersByTime(100)
    panel.dispatchEvent(new Event('mouseenter'))
    vi.advanceTimersByTime(150)
    expect(host.vm.colorPaletteOpen).toBe('textColor')
    panel.dispatchEvent(new Event('mouseleave'))
    vi.advanceTimersByTime(150)
    await Vue.nextTick()
    expect(host.vm.$el.querySelector('.lark-doc-color-palette')).toBeNull()
    expect(host.vm.run).not.toHaveBeenCalled()
  })

  it('销毁时父级清除 hover 计时器并退订主题，异步解析后不挂载', async () => {
    vi.useFakeTimers()
    const host = mountPalette()
    const unsubscribe = vi.spyOn(host.vm, '_unsubscribeTheme')
    host.hover()
    await Vue.nextTick()
    host.vm.scheduleColorPaletteClose()
    expect(vi.getTimerCount()).toBe(1)
    host.vm.$destroy()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(host.vm._unsubscribeTheme).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
    await host.ready()
    expect(host.vm.$el.querySelector('.lark-doc-color-palette')).toBeNull()
  })

  it('首次加载中关闭再重开使用最新状态，后续复用已解析模块', async () => {
    const host = mountPalette()
    host.open()
    await Vue.nextTick()
    host.open()
    await Vue.nextTick()
    host.open('calloutBackground', 110, 140)
    await host.ready()
    expect(host.vm.$el.querySelector('[aria-label="高亮块背景颜色面板"]').style.top).toBe('146px')
    host.open('calloutBackground')
    await Vue.nextTick()
    host.open('textBackground')
    await Vue.nextTick()
    expect(host.vm.$el.querySelector('.lark-doc-color-palette-text')).not.toBeNull()
    expect(host.load).toHaveBeenCalledTimes(1)
    expect(host.vm.run).not.toHaveBeenCalled()
  })

  it.each([
    ['textColor', 'setColor'], ['textBackground', 'setBackgroundColor'],
    ['calloutColor', 'color'], ['calloutBackground', 'backgroundColor'], ['calloutBorder', 'borderColor'],
  ])('%s 挂载后点击仍同步应用命令、记录最近颜色并关闭', async (target, command) => {
    const host = mountPalette()
    host.open(target)
    await Vue.nextTick()
    await host.ready()
    const panel = host.vm.$el.querySelector('.lark-doc-color-palette')
    const selector = target === 'textColor' ? '.lark-doc-color-letters button' : target === 'textBackground' ? '.lark-doc-color-grid button:not(.is-transparent)' : '.lark-doc-color-palette-section button:not(.is-transparent)'
    const button = panel.querySelector(selector)
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    button.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
    button.click()
    expect(host.vm.run).toHaveBeenCalledTimes(1)
    const value = target.startsWith('text') ? host.vm.textColorRecent[0] : host.vm.colorPaletteRecent[0]
    if (target.startsWith('text')) expect(host.vm.run).toHaveBeenCalledWith(command, value)
    else expect(host.vm.run).toHaveBeenCalledWith('updateAttributes', 'callout', { [command]: value })
    expect(value).toMatch(/^#[0-9a-f]{6}$/i)
    expect(host.vm.colorPaletteOpen).toBe('')
    await Vue.nextTick()
    expect(host.vm.$el.querySelector('.lark-doc-color-palette')).toBeNull()
  })

  it('恢复默认仍同步清理文字与背景颜色，关闭期间不执行额外命令', async () => {
    const host = mountPalette()
    host.open()
    await Vue.nextTick()
    await host.ready()
    host.vm.$el.querySelector('[aria-label="恢复默认颜色"]').click()
    expect(host.vm.run.mock.calls).toEqual([['unsetColor'], ['unsetBackgroundColor']])
    expect(host.vm.colorPaletteOpen).toBe('')
  })
})

describe('CalloutTools 按选区异步边界', () => {
  it('非高亮块选区不加载，首次挂载沿用父级定位且不抢焦点', async () => {
    const host = mountCallout()
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    expect(host.load).not.toHaveBeenCalled()
    host.select()
    await Vue.nextTick()
    expect(host.load).toHaveBeenCalledTimes(1)
    host.vm.calloutToolsPosition = { top: 86, left: 370 }
    await host.ready()
    const tools = host.vm.$el.querySelector('.lark-doc-callout-tools')
    expect(tools.style.top).toBe('86px')
    expect(tools.style.left).toBe('370px')
    expect(document.activeElement).toBe(input)
    expect(host.vm.focus).not.toHaveBeenCalled()
  })

  it.each(['selection', 'feature', 'readonly', 'destroy'])('加载中 %s 失效不迟到挂载，不执行命令', async (action) => {
    const host = mountCallout()
    host.select()
    await Vue.nextTick()
    if (action === 'selection') { host.vm.calloutSelected = false; host.vm.updateCalloutTools() }
    if (action === 'feature') host.vm.calloutsEnabled = false
    if (action === 'readonly') { host.vm.effectiveReadonly = true; host.vm.updateCalloutTools() }
    if (action === 'destroy') host.vm.$destroy()
    await host.ready()
    expect(host.vm.$el.querySelector('.lark-doc-callout-tools')).toBeNull()
    expect(host.vm.run).not.toHaveBeenCalled()
    expect(host.vm.focus).not.toHaveBeenCalled()
  })

  it('挂载后表情按钮才测量工具条，关闭与重挂载不引入异步命令或聚焦', async () => {
    const host = mountCallout()
    host.select()
    await Vue.nextTick()
    await host.ready()
    const tools = host.vm.$el.querySelector('.lark-doc-callout-tools')
    const measure = vi.fn(() => ({ bottom: 100 }))
    tools.getBoundingClientRect = measure
    const button = tools.querySelector('[aria-label="更换高亮块图标"]')
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    button.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
    button.click()
    expect(measure).toHaveBeenCalledTimes(1)
    expect(host.vm.calloutEmojiOpen).toBe(true)
    expect(host.vm.calloutEmojiPlacement).toBe('below')
    await Vue.nextTick()
    const picker = host.vm.$el.querySelector('.lark-doc-callout-emoji-picker')
    const option = picker.querySelector('[role="menuitem"]')
    const glyph = option.textContent.trim()
    option.click()
    expect(host.vm.run).toHaveBeenCalledWith('updateAttributes', 'callout', { emoji: glyph })
    expect(host.vm.calloutEmojiOpen).toBe(true)
    host.vm.closeOverlay()
    expect(host.vm.calloutEmojiOpen).toBe(false)
    host.vm.focus.mockClear()
    host.vm.calloutSelected = false
    host.vm.updateCalloutTools()
    await Vue.nextTick()
    expect(host.vm.$el.querySelector('.lark-doc-callout-tools')).toBeNull()
    host.select()
    await Vue.nextTick()
    expect(host.vm.$el.querySelector('.lark-doc-callout-tools')).not.toBeNull()
    expect(host.vm.$el.querySelector('.lark-doc-callout-emoji-picker')).toBeNull()
    expect(host.load).toHaveBeenCalledTimes(1)
    expect(host.vm.focus).not.toHaveBeenCalled()
    host.vm.$el.querySelector('[aria-label="恢复高亮块默认样式"]').click()
    expect(host.vm.run).toHaveBeenCalledTimes(2)
    expect(host.vm.run.mock.calls[1][0]).toBe('updateAttributes')
  })
})
