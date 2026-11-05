// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNativeOptionsHost } from '../../src/editor/nativeOptionsHost'
import { createCommandMenu } from '../../src/ui/commandMenu'
import { createBlockHandle } from '../../src/ui/blockHandle'
import { createToolbar } from '../../src/ui/toolbar'
import commandMenuMixin from '../../src/components/lark-doc/editor/commandMenuMixin'
import commandMenuUiMixin from '../../src/components/lark-doc/editor/commandMenuUiMixin'
import blockHandleUiMixin from '../../src/components/lark-doc/editor/blockHandleUiMixin'
import toolbarUiMixin from '../../src/components/lark-doc/editor/toolbarUiMixin'
import toolbarCollapseMixin from '../../src/components/lark-doc/editor/toolbarCollapseMixin'
import viewModesMixin from '../../src/components/lark-doc/editor/viewModesMixin'
import isvMixin from '../../src/components/lark-doc/editor/isvMixin'
import isvPanelUiMixin from '../../src/components/lark-doc/editor/isvPanelUiMixin'
import { createLarkDocConfig } from '../../src/components/lark-doc/larkDocConfig'
import { diagramTypes } from '../../src/components/lark-doc/editor/constants'

const runtimes = []
const rect = (left = 40, top = 100) => ({ left, top, bottom: top + 20, right: left + 20, width: 20, height: 20 })
const settle = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve() }
function runtime(options, state = {}, refs = {}) {
  const result = createNativeOptionsHost({ options, state, refs })
  runtimes.push(result)
  return result
}
function rootNode() { const root = document.createElement('div'); document.body.appendChild(root); return root }
function menuHost() {
  const root = rootNode()
  const r = runtime({
    mixins: [commandMenuMixin, commandMenuUiMixin],
    methods: {
      writable() { return !this.effectiveReadonly }, featureEnabled: () => true,
      cancelPopupHoverClose: vi.fn(), schedulePopupHoverClose: vi.fn(),
      closeBlockMenu: vi.fn(), rememberSelection: vi.fn(), restoreSelection: vi.fn(),
      focus: vi.fn(), executeCommand: vi.fn(),
    },
  }, { effectiveReadonly: false, templates: [], larkDocConfig: {}, savedSelection: null }, { root, commandMenuHost: root })
  r.host.mountCommandMenu()
  const trigger = document.createElement('button')
  trigger.getBoundingClientRect = () => rect()
  return { ...r, open: (kind = 'plus') => r.host.openCommandMenu(kind, { currentTarget: trigger }) }
}
function isvHost() {
  const root = rootNode()
  const coords = { value: rect() }
  const chain = { focus: () => chain, setIsv: vi.fn(() => chain), run: vi.fn(() => true) }
  const r = runtime({ mixins: [isvMixin, isvPanelUiMixin], methods: { writable() { return !this.effectiveReadonly } } }, {
    effectiveReadonly: false,
    editor: { state: { selection: { from: 1 } }, view: { coordsAtPos: () => coords.value }, chain: () => chain },
  }, { root, isvPanelHost: root })
  r.host.mountIsvPanel()
  return { ...r, coords, chain, root }
}
afterEach(() => {
  runtimes.splice(0).reverse().forEach(r => {
    r.host.destroyCommandMenu?.()
    r.host.destroyIsvPanel?.()
    r.destroy()
  })
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('命令菜单原生 options host', () => {
  it('首次 plus 打开后定位聚焦，slash 保留正文焦点', async () => {
    const h = menuHost()
    h.open()
    await settle()
    expect(document.activeElement).toBe(h.host._commandMenuUi.el.querySelector('input'))
    h.host.closeCommandMenu()
    const input = document.createElement('input'); document.body.appendChild(input); input.focus()
    h.host.editor = { view: { coordsAtPos: () => rect(), composing: false } }
    h.host.onSlash({ from: 1, to: 2, query: '标题' })
    await settle()
    expect(document.activeElement).toBe(input)
    expect(h.host._commandMenuUi.el.querySelector('input').value).toBe('标题')
  })
  it.each(['close', 'readonly', 'destroy', 'reopen'])('打开回调排队后 %s 不抢旧焦点', async action => {
    const h = menuHost()
    h.open()
    const focus = vi.spyOn(h.host._commandMenuUi, 'focusSearch')
    if (action === 'close') h.host.closeCommandMenu()
    if (action === 'readonly') h.host.effectiveReadonly = true
    if (action === 'destroy') h.destroy()
    if (action === 'reopen') { h.host.closeCommandMenu(); h.open('slash') }
    await settle()
    expect(focus).not.toHaveBeenCalled()
  })
  it('UI 迟到挂载按最新批次完成定位，旧实例 ready 无效', async () => {
    const h = menuHost()
    const old = h.host._commandMenuUi
    h.host.destroyCommandMenu()
    h.open()
    await settle()
    h.host.mountCommandMenu()
    await settle()
    expect(document.activeElement).toBe(h.host._commandMenuUi.el.querySelector('input'))
    const focus = vi.spyOn(old, 'focusSearch')
    h.host.onCommandMenuReady(old)
    await settle()
    expect(focus).not.toHaveBeenCalled()
  })
  it('禁用原因、hover 保活和图表子菜单在鼠标与 Enter 入口均保留', () => {
    const root = rootNode()
    const handlers = { onChoose: vi.fn(), onMenuEnter: vi.fn(), onMenuLeave: vi.fn() }
    const ui = createCommandMenu({ host: root, handlers })
    const diagram = { id: 'diagram', label: '图表', category: '基础', submenu: '图表', submenuType: 'diagram' }
    ui.update({ open: true, kind: 'slash', items: [diagram, { id: 'jira', label: 'Jira', category: '基础', tier: 'skip', reason: '未接入 Jira' }], activeId: 'diagram' })
    const skip = root.querySelector('[data-command-id="jira"]')
    expect(skip.disabled).toBe(true)
    expect(skip.title).toBe('未接入 Jira')
    expect(skip.getAttribute('aria-label')).toBe('未接入 Jira')
    ui.el.dispatchEvent(new MouseEvent('mouseenter'))
    ui.el.dispatchEvent(new MouseEvent('mouseleave'))
    root.querySelector('[data-command-id="diagram"]').click()
    expect(ui.submenuEl.querySelectorAll('button')).toHaveLength(diagramTypes.length)
    expect(ui.submenuEl.querySelector('svg')).not.toBeNull()
    ui.submenuEl.dispatchEvent(new MouseEvent('mouseenter'))
    ui.submenuEl.dispatchEvent(new MouseEvent('mouseleave'))
    ui.submenuEl.querySelector('button').click()
    expect(handlers.onChoose).toHaveBeenCalledWith({ id: 'diagram', diagramType: diagramTypes[0].id })
    root.querySelector('input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(ui.submenuEl.classList.contains('is-diagram')).toBe(true)
    expect(handlers.onMenuEnter).toHaveBeenCalledTimes(2)
    expect(handlers.onMenuLeave).toHaveBeenCalledTimes(2)
    ui.destroy()
  })
})

describe('块菜单与工具栏增量迁移', () => {
  it('异步块权限控制类型、副本及操作列表，状态变化能解除禁用', () => {
    const root = rootNode()
    const handlers = { blockTypeAction: vi.fn(), blockAction: vi.fn(), scheduleCommandMenuClose: vi.fn() }
    const ui = createBlockHandle({ host: root, handlers })
    ui.updateChrome({ visible: true, buttonKind: 'main', actionDisabled: true })
    expect(ui.mainEl.getAttribute('aria-disabled')).toBe('true')
    const patch = disabled => ({ menuOpen: true, editAllowed: !disabled, duplicateAllowed: !disabled, canDuplicate: true,
      typeActions: [{ id: 'paragraph', label: '正文', icon: 'block-text', disabled }],
      listActions: [{ id: 'copy', label: '复制', icon: 'copy', disabled }], colors: [] })
    ui.updateMenu(patch(true))
    const type = () => root.querySelector('[aria-label="正文"]')
    expect(type().disabled).toBe(true)
    type().click()
    expect(handlers.blockTypeAction).not.toHaveBeenCalled()
    expect(root.querySelector('.lark-doc-block-menu-duplicate').disabled).toBe(true)
    expect(ui.alignTrigger.getAttribute('aria-disabled')).toBe('true')
    expect(ui.colorTrigger.classList.contains('is-disabled')).toBe(true)
    expect(root.querySelector('.lark-doc-block-menu-row').disabled).toBe(true)
    ui.updateMenu(patch(false))
    expect(type().disabled).toBe(false)
    type().click()
    expect(handlers.blockTypeAction).toHaveBeenCalledWith('paragraph')
    ui.updateChrome({ buttonKind: 'empty' })
    root.querySelector('.lark-doc-empty-block-insert').dispatchEvent(new MouseEvent('mouseleave'))
    expect(handlers.scheduleCommandMenuClose).toHaveBeenCalledOnce()
    expect(blockHandleUiMixin.methods.blockHandleHandlers.call({}).scheduleCommandMenuClose).toBeTypeOf('function')
    ui.destroy()
  })
  it('工具栏插入与图表 hover 接线、标签、图标保留', () => {
    const ctx = Object.fromEntries(['scheduleCommandMenuClose', 'cancelPopupHoverClose', 'openDiagramMenuOnHover', 'scheduleDiagramMenuClose'].map(name => [name, vi.fn()]))
    const handlers = toolbarUiMixin.methods.toolbarHandlers.call(ctx)
    const ui = createToolbar({ handlers })
    ui.update({ features: { diagram: true }, diagram: { open: true, types: diagramTypes } })
    const insert = ui.el.querySelector('[aria-label="插入"]')
    expect(insert.getAttribute('aria-haspopup')).toBe('menu')
    insert.dispatchEvent(new MouseEvent('mouseenter')); insert.dispatchEvent(new MouseEvent('mouseleave'))
    const diagram = ui.el.querySelector('[aria-label="图表"]')
    expect(diagram.textContent).toContain('图表')
    expect(diagram.querySelector('.lark-doc-caret')).not.toBeNull()
    diagram.dispatchEvent(new MouseEvent('mouseenter')); diagram.dispatchEvent(new MouseEvent('mouseleave'))
    const menu = ui.el.querySelector('.lark-doc-diagram-menu')
    menu.dispatchEvent(new MouseEvent('mouseenter')); menu.dispatchEvent(new MouseEvent('mouseleave'))
    expect(menu.querySelectorAll('.lark-doc-diagram-menu-icon')).toHaveLength(diagramTypes.length)
    expect(ctx.cancelPopupHoverClose).toHaveBeenCalledTimes(2)
    expect(ctx.scheduleCommandMenuClose).toHaveBeenCalledOnce()
    expect(ctx.openDiagramMenuOnHover).toHaveBeenCalledOnce()
    expect(ctx.scheduleDiagramMenuClose).toHaveBeenCalledTimes(2)
    ui.destroy()
  })
  it('默认隐藏配置下不对暂存的工具栏绑定 observer，目录水合保持冻结', async () => {
    const root = rootNode(); const bar = document.createElement('div'); bar.className = 'lark-doc-toolbar'; root.appendChild(bar)
    const observer = vi.fn(); vi.stubGlobal('ResizeObserver', observer)
    const config = createLarkDocConfig()
    expect(config.layout.toolbarVisible).toBe(false)
    const r = runtime({ mixins: [toolbarCollapseMixin, viewModesMixin] }, { larkDocConfig: config }, { root })
    r.host.bindToolbarObserver()
    expect(observer).not.toHaveBeenCalled()
    expect(r.host._toolbarFitEpoch).toBe(1)
    r.host.hydrateOutline([{ pos: 1, level: 1, text: '章节' }])
    expect(Object.isFrozen(r.host.outline)).toBe(true)
    expect(r.host.outlineItems[0].text).toBe('章节')
    expect(r.host.modeLabel).toBe(r.host.modeOptions.find(item => item.id === r.host.mode).label)
    r.host.setMode('read')
    expect(r.host.reading).toBe(true)
    expect(r.host.modeLabel).toBe(r.host.modeOptions.find(item => item.id === 'read').label)
    await settle()
  })
})

describe('ISV 原生面板 ready', () => {
  it('首次打开按最新选区定位聚焦，输入更新不重复抢焦点，确认同步插块', async () => {
    const h = isvHost()
    h.host.startIsvButton('open_link')
    h.coords.value = rect(140, 180)
    await settle()
    expect(h.host.isvPanelStyle).toEqual({ left: '140px', top: '206px' })
    expect(document.activeElement).toBe(h.root.querySelector('[aria-label="按钮文字"]'))
    const focus = vi.spyOn(h.host._isvUi, 'focusText')
    h.host.isvLinkUrl = 'https://example.com'
    await settle()
    expect(focus).not.toHaveBeenCalled()
    h.host.confirmIsvButton()
    expect(h.chain.setIsv).toHaveBeenCalledOnce()
    expect(h.host.isvPanelOpen).toBe(false)
  })
  it.each(['close', 'readonly', 'destroy', 'reopen'])('ready 排队后 %s 不执行旧批次聚焦', async action => {
    const h = isvHost()
    h.host.startIsvButton('open_link')
    h.flush()
    const focus = vi.spyOn(h.host._isvUi, 'focusText')
    if (action === 'close') h.host.closeIsvPanel()
    if (action === 'readonly') h.host.effectiveReadonly = true
    if (action === 'destroy') h.destroy()
    if (action === 'reopen') { h.host.closeIsvPanel(); h.host.startIsvButton('follow_page') }
    await settle()
    expect(focus).toHaveBeenCalledTimes(action === 'reopen' ? 1 : 0)
    if (action === 'readonly') expect(h.root.querySelector('.lark-doc-isv-overlay')).toBeNull()
    expect(h.chain.setIsv).not.toHaveBeenCalled()
  })
})
