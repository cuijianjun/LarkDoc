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
import overlaysUiMixin from '../../src/components/lark-doc/editor/overlaysUiMixin'
import { registerFeature } from '../../src/core/features/registry'

vi.mock('../../src/ui/overlays', async () => {
  const actual = await vi.importActual('../../src/ui/overlays')
  const { createDeferredUi } = await import('../../src/features/element-ui')
  return { ...actual, createDocumentOverlays: options => createDeferredUi('createDocumentOverlays', options,
    state => state.sharePopoverOpen || state.permissionDialogOpen || state.secureLinkConfirmOpen || state.passwordDialogOpen || state.exportOpen || state.exportToast || state.exportPendingOperationId || state.imageShare) }
})
vi.mock('../../src/ui/notifications', async () => {
  const { createDeferredUi } = await import('../../src/features/element-ui')
  return { createNotifications: options => createDeferredUi('createNotifications', options) }
})

const schema = getSchema(createLarkDocExtensions())
const hosts = []
const item = (id = 'r1', text = '新增') => ({ id, text })

async function tick() {
  await Promise.resolve()
  await vi.dynamicImportSettled()
}

// 控制器同步装配；按状态启动真实动态模块，等待导入完成后检查原交互与最新状态。
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

it('keeps denial/entry synchronous and cancels cold notifications without reviving a closed surface', async () => {
  const root = document.createElement('div'); document.body.append(root)
  let resolve
  const loader = vi.fn(() => new Promise(yes => { resolve = yes }))
  const stop = registerFeature('ui', loader)
  const context = {}
  const request = vi.fn(), measure = vi.fn()
  const close = vi.fn(function () { this.notifyOpen = false })
  const runtime = createNativeOptionsHost({ options: { mixins: [overlaysUiMixin], methods: {
    buildOverlaysState() { return { shareViewMaskVisible: this.denied, shareEntryVisible: true, shareEntryLabel: '分享', imageShare: this.imageShare } },
    notificationContext: () => context, notifyCurrent: value => value === context,
    requestShareAccess: request, measureNotify: measure,
    closeNotify: close,
    closeImageShareDialog: vi.fn(function () { this.imageShare = null }),
  } }, refs: { root, overlayHost: root }, state: {
    denied: true, imageShare: null, notifyOpen: false, notifyItems: [], notifyStyle: {}, notifyEmpty: true,
  } })
  const vm = runtime.host
  hosts.push(() => { vm.destroyOverlays(); runtime.destroy(); stop() })
  vm.mountOverlays(); runtime.mount()
  const settle = async () => { for (let i = 0; i < 12; i++) await tick() }
  await settle()
  expect(root.querySelector('[aria-label="你没有查看权限"]')).not.toBeNull()
  root.querySelector('.lark-doc-share-mask button').click()
  expect(request).toHaveBeenCalledOnce()
  expect(root.querySelector('button[aria-label="分享"]')).not.toBeNull()
  expect(loader).not.toHaveBeenCalled()
  vm.denied = false; vm.notifyOpen = true; await settle()
  expect(loader).toHaveBeenCalledOnce()
  expect(root.querySelector('.lark-doc-notify-popover')).toBeNull()
  const foreign = document.createElement('input'); document.body.append(foreign)
  foreign.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, isComposing: true }))
  expect(close).not.toHaveBeenCalled()
  root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  expect(close).toHaveBeenCalledWith(true)
  await settle()
  const actual = await vi.importActual('../../src/ui/notifications'), factory = vi.fn(actual.createNotifications)
  // A real UI module registers readiness even if its first surface was closed.
  hosts.push(registerFeature('ui.ready', () => ({ createNotifications: factory })))
  resolve({ createNotifications: factory }); await settle()
  expect(factory).not.toHaveBeenCalled()
  expect(root.querySelector('.lark-doc-notify-popover')).toBeNull()
  vm.notifyOpen = true; await settle()
  expect(factory).toHaveBeenCalledOnce()
  expect(root.querySelector('.lark-doc-notify-popover')).not.toBeNull()
  expect(measure).toHaveBeenCalledOnce()
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
    const button = host.vm.$el.querySelector(`.is-${action}`)
    button.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(host.vm.revisionPanels).toHaveLength(1)
    button.click()
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
  it('allows native focus only for the exact emoji search while preserving every tool selection guard', async () => {
    const host = mountCallout()
    host.select(); await host.ready()
    const tools = host.vm.$el.querySelector('.lark-doc-callout-tools')
    tools.querySelector('[aria-label="更换高亮块图标"]').click()
    await tick()
    const search = tools.querySelector('[aria-label="搜索高亮块图标"]')
    const searchDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    expect(search.dispatchEvent(searchDown)).toBe(true)
    expect(searchDown.defaultPrevented).toBe(false)
    search.focus()
    expect(document.activeElement).toBe(search)
    search.value = 'smile'
    search.dispatchEvent(new Event('input', { bubbles: true }))
    expect(host.vm.calloutEmojiQuery).toBe('smile')
    expect(host.vm.run).not.toHaveBeenCalled()
    expect(host.vm.focus).not.toHaveBeenCalled()
    const foreignInput = document.createElement('input')
    foreignInput.type = 'search'; tools.appendChild(foreignInput)
    const guarded = [foreignInput, tools, search.closest('label'),
      tools.querySelector('.lark-doc-callout-emoji-picker'),
      ...tools.querySelectorAll('button, input[type="color"]')]
    for (const control of guarded) {
      const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
      expect(control.dispatchEvent(down)).toBe(false)
      expect(down.defaultPrevented).toBe(true)
    }
  })

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

describe('native panel presentation boundary', () => {
  afterEach(() => vi.doUnmock('../../src/ui/panels'))
  it('keeps outline actions synchronous without evaluating closed panel handlers before their real factory mounts', async () => {
    const deferred = []
    vi.doMock('../../src/ui/panels', () => ({
      createOutlinePanel: options => ({ options, update: vi.fn(), destroy: vi.fn() }),
      ...Object.fromEntries(['createVersionPanel', 'createVersionToast', 'createCommentPanel'].map(name => [name, options => {
        deferred.push({ name, options })
        return { update: vi.fn(), destroy: vi.fn() }
      }])),
    }))
    const { default: panels } = await import('../../src/components/lark-doc/editor/panelsUiMixin?panel-handlers-cold')
    const root = document.createElement('div')
    const select = vi.fn(), jump = vi.fn()
    const vm = { $refs: { outlineHost: root, panelHost: root }, mountCover: vi.fn(), refreshPanels: vi.fn(),
      toggleOutlineOpen: vi.fn(), toggleOutline: vi.fn(), jumpHeading: jump, selectVersion: select,
      panelsHandlers: vi.fn(panels.methods.panelsHandlers), active: 'first' }
    panels.methods.mountPanels.call(vm)
    expect(vm.panelsHandlers).not.toHaveBeenCalled()
    vm._panelsUi.outline.options.handlers.onJump(23)
    expect(jump).toHaveBeenCalledWith(23)
    vm.selectVersion = vi.fn()
    const options = deferred.find(item => item.name === 'createVersionPanel').options
    options.handlers.onSelect('current')
    expect(vm.panelsHandlers).toHaveBeenCalledOnce()
    expect(vm.selectVersion).toHaveBeenCalledWith('current')
    expect(select).not.toHaveBeenCalled()
    panels.methods.destroyPanels.call(vm)
  })
  it('keeps inline comments, launcher, drafts and real counts available before a presenter is ready', async () => {
    const { default: panels } = await import('../../src/components/lark-doc/editor/panelsUiMixin')
    const root = document.createElement('div')
    const vm = { commentPanels: [{ id: 'selection' }], commentDocumentThreads: [{ id: 'document' }], commentSelectionCount: 1, commentUnread: 2,
      commentRemote: true, commentSidebarOpen: false, commentDocumentDraft: 'kept draft', commentDocumentMentions: [], commentDocumentReferences: [],
      commentDocumentLike: { snapshot: { total: '3', liked: true }, pending: '' }, _mobileEditorMedia: { matches: true }, $refs: { root },
      featureEnabled: () => true, commentCan: () => true, commentAllowed: () => true, commentDocumentCanSubmit: () => true, commentProvider: () => ({ isRemote: true }) }
    const state = panels.methods.buildCommentVisibility.call(vm)
    expect(state).toMatchObject({ open: false, documentInline: true, launcher: { visible: true }, documentCount: 1, selectionCount: 1, unread: 2,
      documentComposer: { value: 'kept draft', canSubmit: true } })
    expect(vm.commentDocumentDraft).toBe('kept draft')
    vm.commentCan = () => false
    expect(panels.methods.buildCommentVisibility.call(vm)).toMatchObject({ open: false, documentInline: false, launcher: { visible: false }, documentCount: 0, selectionCount: 0,
      documentComposer: { value: '', canSubmit: false } })
  })
  it('supplies real synchronous projection methods while retaining async action guards in their original functions', async () => {
    const { createPanelPresentation } = await import('../../src/components/lark-doc/editor/panelPresentation')
    const api = createPanelPresentation({ commentModel: {}, supportsDocumentAction: () => false,
      formatDocumentCommentTime: () => 'time', openCommentDocumentTarget: () => false })
    expect(api).not.toBeInstanceOf(Promise)
    expect(Object.keys(api.methods)).toEqual(['panelsHandlers', 'buildVersionState', 'buildVersionPreviewState', 'buildCommentState'])
    expect(api.computed.commentPanelTitle.call({ ed: {} })).toBe('评论')
    const opened = [], dismissed = []
    const handlers = api.methods.panelsHandlers.call({ openVersionPanel: () => opened.push(true), dismissVersionNotice: () => dismissed.push(true) })
    expect(typeof handlers.versionToast.onNoticeLink).toBe('function')
    handlers.versionToast.onNoticeLink()
    expect(opened).toEqual([true])
    expect(dismissed).toEqual([true])
    // 上传入口只是「读 input → 清值 → 交给 addCommentAttachments」的一层包装，
    // 能力判断在被调方（`commentCanAttach`），所以这里给个记录桩验证转交本身。
    const delegated = []
    const event = { target: { files: [], value: 'chosen' } }
    // 桶里的方法都以 `this.ed` 为接收者转交（`uploadImages.call(this.ed, …)`），
    // 所以桩要挂在 ed 上，而不是外层 owner。
    const work = api.commentPanelMethods.uploadCommentImageFiles.call({
      ed: { commentCanUploadImage: () => false, addCommentAttachments: async (scope, files) => { delegated.push([scope, files]) } },
    }, 'document', event)
    expect(work).toBeInstanceOf(Promise)
    await work
    expect(event.target.value).toBe('')
    expect(delegated).toEqual([['document', []]])
  })
  it('reprojects after a real panel becomes ready and ignores a retired panel callback', async () => {
    const factories = []
    vi.doMock('../../src/ui/panels', () => {
      const create = options => { const ui = { options, update: vi.fn(), destroy: vi.fn() }; factories.push(ui); return ui }
      return { createOutlinePanel: create, createVersionPanel: create, createVersionToast: create, createCommentPanel: create }
    })
    const { default: panels } = await import('../../src/components/lark-doc/editor/panelsUiMixin?panel-presentation-ready')
    const root = document.createElement('div')
    const vm = { $refs: { outlineHost: root, panelHost: root }, panelPresentationRevision: 0,
      panelsHandlers: () => ({ outline: {}, version: {}, versionToast: {}, comment: {} }), mountCover: vi.fn(), refreshPanels: vi.fn() }
    panels.methods.mountPanels.call(vm)
    expect(vm.refreshPanels).toHaveBeenCalledOnce()
    const ready = factories.filter(ui => typeof ui.options.onReady === 'function').map(ui => ui.options.onReady)
    expect(ready).toHaveLength(3)
    ready.forEach(callback => callback())
    expect(vm.panelPresentationRevision).toBe(3)
    expect(vm.refreshPanels).toHaveBeenCalledTimes(4)
    const original = vm._panelsUi
    vm._panelsUi = {}
    ready[0]()
    vm._panelsUi = original; vm._isDestroyed = true
    ready[1]()
    expect(vm.panelPresentationRevision).toBe(3)
    expect(vm.refreshPanels).toHaveBeenCalledTimes(4)
  })

})


describe('callout label presentation readiness', () => {
  afterEach(() => vi.doUnmock('../../src/ui/calloutTools'))

  it('reprojects only the live tools handle and never reopens or focuses a canceled picker', async () => {
    const factories = []
    vi.doMock('../../src/ui/calloutTools', () => ({ createCalloutTools: options => {
      const ui = { options, update: vi.fn(), destroy: vi.fn() }; factories.push(ui); return ui
    } }))
    const { default: mixin } = await import('../../src/components/lark-doc/editor/calloutToolsUiMixin?label-presentation-ready')
    const root = document.createElement('div')
    // 表情表跟着面板包走：工具条一出现就去预取，所以 onReady 会调到这个方法。
    const vm = { $refs: { calloutToolsHost: root }, calloutPresentationRevision: 0,
      calloutEmojiOpen: true, calloutEmojiQuery: 'pending query', refreshCalloutTools: vi.fn(), focus: vi.fn(),
      prefetchCalloutEmoji: mixin.methods.prefetchCalloutEmoji }
    mixin.methods.mountCalloutTools.call(vm)
    const first = factories[0]
    expect(first.options.onReady).toBeTypeOf('function')
    vm.calloutEmojiOpen = false; vm.calloutEmojiQuery = ''
    first.options.onReady()
    expect(vm.calloutPresentationRevision).toBe(1)
    expect(vm.refreshCalloutTools).toHaveBeenCalledTimes(2)
    expect(vm.calloutEmojiOpen).toBe(false)
    expect(vm.calloutEmojiQuery).toBe('')
    expect(vm.focus).not.toHaveBeenCalled()
    mixin.methods.destroyCalloutTools.call(vm)
    mixin.methods.mountCalloutTools.call(vm)
    first.options.onReady()
    expect(vm.calloutPresentationRevision).toBe(1)
    vm._isBeingDestroyed = true
    factories[1].options.onReady()
    vm._isBeingDestroyed = false; vm._isDestroyed = true
    factories[1].options.onReady()
    expect(vm.calloutPresentationRevision).toBe(1)
    expect(vm.refreshCalloutTools).toHaveBeenCalledTimes(3)
  })

  it('does not evaluate UI labels while the picker is closed or edit permission is denied', () => {
    const categories = vi.fn(() => ['笑脸']), items = vi.fn(() => [{ value: 'smile', glyph: '😄' }])
    const vm = { activeCalloutVisible: true, featureEnabled: () => true, effectiveReadonly: false,
      calloutEmojiOpen: false, calloutToolsStyle: {}, calloutColor: () => '',
      get calloutEmojiCategories() { return categories() }, get filteredCalloutEmojiItems() { return items() } }
    expect(calloutToolsUiMixin.methods.buildCalloutToolsState.call(vm)).toMatchObject({ visible: true, emojiOpen: false, categories: [], items: [] })
    expect(categories).not.toHaveBeenCalled(); expect(items).not.toHaveBeenCalled()
    vm.calloutEmojiOpen = true
    expect(calloutToolsUiMixin.methods.buildCalloutToolsState.call(vm)).toMatchObject({ categories: ['笑脸'], items: [{ value: 'smile', glyph: '😄' }] })
    vm.effectiveReadonly = true
    expect(calloutToolsUiMixin.methods.buildCalloutToolsState.call(vm)).toEqual({ visible: false, emojiOpen: false })
    expect(categories).toHaveBeenCalledOnce(); expect(items).toHaveBeenCalledOnce()
  })
})
