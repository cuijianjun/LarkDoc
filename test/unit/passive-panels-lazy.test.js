// @vitest-environment jsdom
import { getSchema } from '@tiptap/core'
import { EditorState } from '@tiptap/pm/state'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import { createNativeOptionsHost } from '../../src/editor/nativeOptionsHost'
import revisionMixin from '../../src/components/lark-doc/editor/revisionMixin'
import revisionUiMixin from '../../src/components/lark-doc/editor/revisionUiMixin'
import calloutColorMixin from '../../src/components/lark-doc/editor/calloutColorMixin'
import colorPaletteUiMixin from '../../src/components/lark-doc/editor/colorPaletteUiMixin'
import calloutToolsUiMixin from '../../src/components/lark-doc/editor/calloutToolsUiMixin'
import toolbarMenusMixin from '../../src/components/lark-doc/editor/toolbarMenusMixin'
import overlayDismissMixin from '../../src/components/lark-doc/editor/overlayDismissMixin'
import readingModeMixin from '../../src/components/lark-doc/editor/readingModeMixin'

const schema = getSchema(createLarkDocExtensions())
const hosts = []
const item = (id = 'r1', text = '新增') => ({ id, text })

async function tick() {
  await Promise.resolve()
  await Promise.resolve()
}

// 原生 UI 同步装配、按状态挂载；原异步加载窗口对应宿主待 flush 的微任务窗口。
function mountPanel(options, domain, state, extraRefs = {}) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const runtime = createNativeOptionsHost({
    options, state, refs: { root, [`${domain}Host`]: root, ...extraRefs },
  })
  const vm = runtime.host
  vm.$el = root
  const suffix = domain === 'revision' ? 'RevisionPanels' : domain[0].toUpperCase() + domain.slice(1)
  vm[`mount${suffix}`]()
  runtime.mount()
  const destroy = () => {
    if (vm._isDestroyed) return
    vm[`destroy${suffix}`]()
    runtime.destroy()
  }
  hosts.push(destroy)
  return { vm, runtime, destroy, ready: tick }
}

function stateOf(items) {
  return EditorState.create({ schema, doc: schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create(null, items.map(({ id, text }) => schema.text(text, [
      schema.marks.revision.create({ revisionId: id, kind: 'insert', author: '测试用户' }),
    ]))),
  ]) })
}

function mountRevision(items = [], interactionMode = 'suggest') {
  const dom = document.createElement('div')
  dom.getBoundingClientRect = () => ({ right: 600, top: 100 })
  let anchorTop = 120
  let host
  const engine = {
    state: stateOf(items), storage: { larkDocRevisionTracker: { active: false } },
    view: {
      dom, coordsAtPos: () => ({ top: anchorTop }),
      dispatch: (tr) => { engine.state = engine.state.apply(tr); host.vm.updateRevisionPanels() },
    },
  }
  host = mountPanel({
    mixins: [revisionMixin, revisionUiMixin],
    methods: { writable() { return this.interactionMode !== 'read' } },
  }, 'revision', { editor: engine, interactionMode })
  return {
    ...host, engine,
    replace(next) { engine.state = stateOf(next); host.vm.updateRevisionPanels() },
    move(top) { anchorTop = top; window.dispatchEvent(new Event('scroll')) },
  }
}

function mountPalette() {
  const host = mountPanel({
    mixins: [calloutColorMixin, toolbarMenusMixin, overlayDismissMixin, colorPaletteUiMixin],
    watch: { effectiveReadonly(value) { if (value) this.closeEditingOverlays() } },
    methods: {
      closeEditingOverlays: readingModeMixin.methods.closeEditingOverlays,
      writable() { return !this.effectiveReadonly }, run() {}, focus() {},
    },
  }, 'colorPalette', {
    effectiveReadonly: false, headingNumberMenu: { open: false },
    editor: { getAttributes: () => ({}) },
  })
  vi.spyOn(host.vm, 'run')
  vi.spyOn(host.vm, 'focus')
  const trigger = (left = 40, bottom = 80) => ({ currentTarget: { getBoundingClientRect: () => ({ left, bottom }) } })
  return {
    ...host,
    open(target = 'textColor', left, bottom) { host.vm.toggleColorPalette(target, trigger(left, bottom)) },
    hover() { host.vm.openColorPaletteOnHover(trigger()) },
  }
}

function mountCallout() {
  const element = document.createElement('div')
  element.getBoundingClientRect = () => ({ top: 200, right: 600 })
  const engine = {
    state: { selection: { $from: { depth: 1, node: () => ({ type: { name: 'callout' } }), before: () => 0 } } },
    view: { nodeDOM: () => element }, getAttributes: () => ({}),
  }
  const host = mountPanel({
    mixins: [calloutColorMixin, overlayDismissMixin, calloutToolsUiMixin],
    computed: { larkDocConfig() { return { features: { callouts: this.calloutsEnabled } } } },
    methods: {
      writable() { return !this.effectiveReadonly && this.calloutSelected },
      featureEnabled() { return this.calloutsEnabled }, run() {}, focus() {},
    },
  }, 'calloutTools', { editor: engine, effectiveReadonly: false, calloutSelected: false, calloutsEnabled: true })
  const paper = document.createElement('div')
  paper.className = 'lark-doc-paper'
  host.vm.$el.appendChild(paper)
  paper.getBoundingClientRect = () => ({ top: 100, left: 20 })
  Object.defineProperty(paper, 'clientWidth', { value: 800 })
  vi.spyOn(host.vm, 'run')
  vi.spyOn(host.vm, 'focus')
  return { ...host, select() { host.vm.calloutSelected = true; host.vm.updateCalloutTools() } }
}

afterEach(() => {
  hosts.splice(0).reverse().forEach((destroy) => destroy())
  document.body.innerHTML = ''
  window.localStorage.clear()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('原生被动面板按状态挂载边界', () => {
  it.each([
    ['修订', mountRevision, '_revisionUi', 'mountRevisionPanels', '.lark-doc-revision-panel'],
    ['颜色', mountPalette, '_colorPaletteUi', 'mountColorPalette', '.lark-doc-color-palette'],
    ['高亮块', mountCallout, '_calloutToolsUi', 'mountCalloutTools', '.lark-doc-callout-tools'],
  ])('%s 同步装配原生 UI，关闭时无面板 DOM，重复装配复用实例', async (name, mount, key, method, selector) => {
    const host = mount()
    const ui = host.vm[key]
    expect(ui.update).toBeTypeOf('function')
    expect(ui.destroy).toBeTypeOf('function')
    expect(host.vm.$el.querySelector(selector)).toBeNull()
    host.vm[method]()
    await host.ready()
    expect(host.vm[key]).toBe(ui)
    expect(host.vm.$el.querySelector(selector)).toBeNull()
  })
})

describe('RevisionPanel 原生渲染边界', () => {
  it('无修订不挂载，待刷新期间用最新修订与定位，挂载不抢焦点', async () => {
    const host = mountRevision()
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    await tick()
    expect(host.vm.$el.querySelector('.lark-doc-revision-panel')).toBeNull()
    host.replace([item()])
    expect(host.vm.$el.querySelector('.lark-doc-revision-panel')).toBeNull()
    host.replace([item('r2', '最新建议')])
    host.move(230)
    await host.ready()
    const panel = host.vm.$el.querySelector('.lark-doc-revision-panel')
    expect(panel.textContent).toContain('最新建议')
    expect(panel.querySelector('.lark-doc-revision-body').textContent).toBe('新增：“最新建议”')
    expect(panel.style.left).toBe('612px')
    expect(panel.style.top).toBe('230px')
    expect(document.activeElement).toBe(input)
  })

  it.each(['remove', 'destroy'])('待刷新期间 %s 不会迟到复活面板，销毁仍清理父级监听', async (action) => {
    const host = mountRevision()
    await tick()
    const remove = vi.spyOn(window, 'removeEventListener')
    const domRemove = vi.spyOn(host.engine.view.dom, 'removeEventListener')
    host.replace([item()])
    if (action === 'remove') host.replace([])
    else host.destroy()
    await host.ready()
    expect(host.vm.$el.querySelector('.lark-doc-revision-panel')).toBeNull()
    if (action === 'destroy') {
      expect(remove).toHaveBeenCalledWith('scroll', host.vm.onRevisionViewportChange, true)
      expect(remove).toHaveBeenCalledWith('resize', host.vm.onRevisionViewportChange)
      expect(domRemove).toHaveBeenCalledWith('pointerdown', host.vm.onRevisionPointerDown)
      expect(host.vm._revisionEditorDom).toBeNull()
    }
  })

  it('只读初次打开仍显示面板，接受拒绝禁用，hover 不展开，切回可编辑恢复', async () => {
    const host = mountRevision([item()], 'read')
    await host.ready()
    const panel = () => host.vm.$el.querySelector('.lark-doc-revision-panel')
    expect(panel().classList.contains('is-readonly')).toBe(true)
    expect(panel().querySelector('.is-accept').disabled).toBe(true)
    expect(panel().querySelector('.is-reject').disabled).toBe(true)
    panel().dispatchEvent(new Event('mouseenter'))
    await tick()
    expect(panel().querySelector('.lark-doc-revision-input')).toBeNull()
    host.vm.interactionMode = 'suggest'
    await tick()
    panel().dispatchEvent(new Event('mouseenter'))
    await tick()
    expect(panel().querySelector('.is-accept').disabled).toBe(false)
    expect(panel().querySelector('.lark-doc-revision-input')).not.toBeNull()
    panel().dispatchEvent(new Event('mouseleave'))
    await tick()
    expect(panel().querySelector('.lark-doc-revision-input')).toBeNull()
  })

  it.each(['accept', 'reject'])('挂载后 %s 同步派发原命令，末条移除后隐藏，再次出现复用 UI', async (action) => {
    const host = mountRevision([item()])
    await host.ready()
    const ui = host.vm._revisionUi
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    host.vm.$el.querySelector(`.is-${action}`).dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(host.vm.revisionPanels).toEqual([])
    expect(host.engine.state.doc.textContent).toBe(action === 'accept' ? '新增' : '')
    await tick()
    expect(host.vm.$el.querySelector('.lark-doc-revision-panel')).toBeNull()
    host.replace([item('r3', '重新出现')])
    await tick()
    expect(host.vm.$el.textContent).toContain('重新出现')
    expect(host.vm._revisionUi).toBe(ui)
  })
})

describe('ColorPalette 原生渲染边界', () => {
  it('关闭时不挂载，首次挂载使用最新目标与定位且不抢焦点', async () => {
    const host = mountPalette()
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    expect(host.vm.$el.querySelector('.lark-doc-color-palette')).toBeNull()
    host.open()
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

  it.each(['toggle', 'escape', 'outside', 'hover', 'readonly', 'destroy'])('待刷新期间 %s 关闭不会迟到复活或执行命令', async (action) => {
    vi.useFakeTimers()
    const host = mountPalette()
    host.open()
    if (action === 'toggle') host.open()
    if (action === 'escape') host.vm.closeOverlay()
    if (action === 'outside') host.vm.onDocumentPointerDown({ target: document.body })
    if (action === 'hover') { host.vm.scheduleColorPaletteClose(); vi.advanceTimersByTime(150) }
    if (action === 'readonly') host.vm.effectiveReadonly = true
    if (action === 'destroy') host.destroy()
    await host.ready()
    expect(host.vm.$el.querySelector('.lark-doc-color-palette')).toBeNull()
    expect(host.vm.run).not.toHaveBeenCalled()
    if (action !== 'escape') expect(host.vm.focus).not.toHaveBeenCalled()
    if (action === 'readonly') expect(host.vm.colorPaletteOpen).toBe('')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('hover 待刷新期间离开再重入取消关闭，挂载后进出仍沿用原计时器', async () => {
    vi.useFakeTimers()
    const host = mountPalette()
    host.hover()
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
    await tick()
    expect(host.vm.$el.querySelector('.lark-doc-color-palette')).toBeNull()
    expect(host.vm.run).not.toHaveBeenCalled()
  })

  it('销毁时父级清除 hover 计时器并退订主题，待刷新回调不挂载', async () => {
    vi.useFakeTimers()
    const host = mountPalette()
    const unsubscribe = vi.spyOn(host.vm, '_unsubscribeTheme')
    host.hover()
    host.vm.scheduleColorPaletteClose()
    expect(vi.getTimerCount()).toBe(1)
    host.destroy()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(host.vm._unsubscribeTheme).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
    await host.ready()
    expect(host.vm.$el.querySelector('.lark-doc-color-palette')).toBeNull()
  })

  it('待刷新期间关闭再重开使用最新状态，后续复用已装配 UI', async () => {
    const host = mountPalette()
    const ui = host.vm._colorPaletteUi
    host.open()
    host.open()
    host.open('calloutBackground', 110, 140)
    await host.ready()
    expect(host.vm.$el.querySelector('[aria-label="高亮块背景颜色面板"]').style.top).toBe('146px')
    host.open('calloutBackground')
    await tick()
    host.open('textBackground')
    await tick()
    expect(host.vm.$el.querySelector('.lark-doc-color-palette-text')).not.toBeNull()
    expect(host.vm._colorPaletteUi).toBe(ui)
    expect(host.vm.run).not.toHaveBeenCalled()
  })

  it.each([
    ['textColor', 'setColor'], ['textBackground', 'setBackgroundColor'],
    ['calloutColor', 'color'], ['calloutBackground', 'backgroundColor'], ['calloutBorder', 'borderColor'],
  ])('%s 挂载后点击仍同步应用命令、记录最近颜色并关闭', async (target, command) => {
    const host = mountPalette()
    host.open(target)
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
    await tick()
    expect(host.vm.$el.querySelector('.lark-doc-color-palette')).toBeNull()
  })

  it('恢复默认仍同步清理文字与背景颜色，关闭期间不执行额外命令', async () => {
    const host = mountPalette()
    host.open()
    await host.ready()
    host.vm.$el.querySelector('[aria-label="恢复默认颜色"]').click()
    expect(host.vm.run.mock.calls).toEqual([['unsetColor'], ['unsetBackgroundColor']])
    expect(host.vm.colorPaletteOpen).toBe('')
  })
})

describe('CalloutTools 按选区原生挂载边界', () => {
  it('非高亮块选区不挂载，首次挂载沿用父级定位且不抢焦点', async () => {
    const host = mountCallout()
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    expect(host.vm.$el.querySelector('.lark-doc-callout-tools')).toBeNull()
    host.select()
    host.vm.calloutToolsPosition = { top: 86, left: 370 }
    await host.ready()
    const tools = host.vm.$el.querySelector('.lark-doc-callout-tools')
    expect(tools.style.top).toBe('86px')
    expect(tools.style.left).toBe('370px')
    expect(document.activeElement).toBe(input)
    expect(host.vm.focus).not.toHaveBeenCalled()
  })

  it.each(['selection', 'feature', 'readonly', 'destroy'])('待刷新期间 %s 失效不迟到挂载，不执行命令', async (action) => {
    const host = mountCallout()
    host.select()
    if (action === 'selection') { host.vm.calloutSelected = false; host.vm.updateCalloutTools() }
    if (action === 'feature') host.vm.calloutsEnabled = false
    if (action === 'readonly') { host.vm.effectiveReadonly = true; host.vm.updateCalloutTools() }
    if (action === 'destroy') host.destroy()
    await host.ready()
    expect(host.vm.$el.querySelector('.lark-doc-callout-tools')).toBeNull()
    expect(host.vm.run).not.toHaveBeenCalled()
    expect(host.vm.focus).not.toHaveBeenCalled()
  })

  it('挂载后表情按钮才测量工具条，关闭与重挂载不引入异步命令或聚焦', async () => {
    const host = mountCallout()
    const ui = host.vm._calloutToolsUi
    host.select()
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
    await tick()
    const option = host.vm.$el.querySelector('.lark-doc-callout-emoji-picker [role="menuitem"]')
    const glyph = option.textContent.trim()
    option.click()
    expect(host.vm.run).toHaveBeenCalledWith('updateAttributes', 'callout', { emoji: glyph })
    expect(host.vm.calloutEmojiOpen).toBe(true)
    host.vm.closeOverlay()
    expect(host.vm.calloutEmojiOpen).toBe(false)
    host.vm.focus.mockClear()
    host.vm.calloutSelected = false
    host.vm.updateCalloutTools()
    await tick()
    expect(host.vm.$el.querySelector('.lark-doc-callout-tools')).toBeNull()
    host.select()
    await tick()
    expect(host.vm.$el.querySelector('.lark-doc-callout-tools')).not.toBeNull()
    expect(host.vm.$el.querySelector('.lark-doc-callout-emoji-picker')).toBeNull()
    expect(host.vm._calloutToolsUi).toBe(ui)
    expect(host.vm.focus).not.toHaveBeenCalled()
    host.vm.$el.querySelector('[aria-label="恢复高亮块默认样式"]').click()
    expect(host.vm.run).toHaveBeenCalledTimes(2)
    expect(host.vm.run.mock.calls[1][0]).toBe('updateAttributes')
  })
})
