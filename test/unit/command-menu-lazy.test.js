// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { createNativeOptionsHost } from '../../src/editor/nativeOptionsHost'
import { createCommandMenu } from '../../src/ui/commandMenu'
import { createBlockHandle } from '../../src/ui/blockHandle'
import { createToolbar } from '../../src/ui/toolbar'
import commandMenuMixin from '../../src/components/lark-doc/editor/commandMenuMixin'
import commandMenuUiMixin from '../../src/components/lark-doc/editor/commandMenuUiMixin'
import overlayDismissMixin from '../../src/components/lark-doc/editor/overlayDismissMixin'
import blockHandleUiMixin from '../../src/components/lark-doc/editor/blockHandleUiMixin'
import blockMenuMixin from '../../src/components/lark-doc/editor/blockMenuMixin'
import toolbarUiMixin from '../../src/components/lark-doc/editor/toolbarUiMixin'
import toolbarCollapseMixin from '../../src/components/lark-doc/editor/toolbarCollapseMixin'
import viewModesMixin from '../../src/components/lark-doc/editor/viewModesMixin'
import isvMixin from '../../src/components/lark-doc/editor/isvMixin'
import isvPanelUiMixin from '../../src/components/lark-doc/editor/isvPanelUiMixin'
import { createLarkDocConfig } from '../../src/components/lark-doc/larkDocConfig'
import { diagramTypes } from '../../src/components/lark-doc/editor/constants'
import { registerFeature } from '../../src/core/features/registry'

const blockMenuBoundary = vi.hoisted(() => ({ deferred: false, factory: null }))
vi.mock('../../src/ui/blockHandleMenus', async () => {
  const actual = await vi.importActual('../../src/ui/blockHandleMenus')
  const { createDeferredUi } = await import('../../src/features/element-ui')
  blockMenuBoundary.factory = actual.createBlockHandleMenus
  return {
    ...actual,
    createBlockHandleMenus: options => blockMenuBoundary.deferred
      ? createDeferredUi('createBlockHandleMenus', options)
      : actual.createBlockHandleMenus(options),
  }
})

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
    r.host.destroyBlockHandle?.()
    r.destroy()
  })
  blockMenuBoundary.deferred = false
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
    h.host.editor = { isActive: () => false, view: { coordsAtPos: () => rect(), composing: false } }
    h.host.onSlash({ from: 1, to: 2, query: '标题' })
    await settle()
    expect(document.activeElement).toBe(input)
    // slash 菜单不挂搜索头（`head` 只在非 slash 时进插槽，0facf05:496 同款）：
    // 查询来自正文里的 `/标题`，焦点全程留在正文。
    expect(h.host._commandMenuUi.el.querySelector('.lark-doc-command-head')).toBeNull()
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
  it.each(['close', 'destroy', 'replace'])('退役菜单 %s 后，旧行点击和搜索 Enter 均不派发选择', action => {
    const root = rootNode(), onChoose = vi.fn(), ui = createCommandMenu({ host: root, handlers: { onChoose } })
    const state = { open: true, kind: 'plus', items: [{ id: 'heading1', label: 'H1', category: '基础' }], activeId: 'heading1' }
    let replacement
    try {
      ui.update(state)
      const row = root.querySelector('[data-command-id="heading1"]'), input = ui.el.querySelector('input')
      expect(row.isConnected).toBe(true)
      row.click()
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
      expect(onChoose).toHaveBeenCalledTimes(2)
      onChoose.mockClear()
      if (action === 'close') ui.update({ open: false })
      else ui.destroy()
      if (action === 'replace') {
        replacement = createCommandMenu({ host: root, handlers: { onChoose } })
        replacement.update(state)
      }
      expect(row.isConnected).toBe(false)
      row.click()
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
      expect(onChoose).not.toHaveBeenCalled()
      if (replacement) {
        root.querySelector('[data-command-id="heading1"]').click()
        expect(onChoose).toHaveBeenCalledOnce()
      }
    } finally { ui.destroy(); replacement?.destroy() }
  })
  it('取消后旧 DOM 不能写当前正文；重开复用的当前行仍可同步执行一次', async () => {
    const h = menuHost(), element = document.createElement('div')
    document.body.appendChild(element)
    const editor = new Editor({ element, extensions: [StarterKit], content: '<p>原正文</p>',
      editorProps: { handleScrollToSelection: () => true } })
    h.host.editor = editor
    const execute = h.host.executeCommand = vi.fn(id => id === 'heading1' && editor.commands.toggleHeading({ level: 1 }))
    const transaction = vi.fn()
    try {
      h.open(); await settle()
      const row = h.host._commandMenuUi.el.querySelector('[data-command-id="heading1"]')
      const input = h.host._commandMenuUi.el.querySelector('input')
      expect(row.isConnected).toBe(true)
      h.host.closeCommandMenu(); await settle()
      editor.commands.setContent('<p>当前正文</p>')
      const before = editor.getJSON()
      editor.on('transaction', transaction)
      row.click()
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
      expect(execute).not.toHaveBeenCalled()
      expect(transaction).not.toHaveBeenCalled()
      expect(editor.getJSON()).toEqual(before)
      h.open(); await settle()
      const currentRow = h.host._commandMenuUi.el.querySelector('[data-command-id="heading1"]')
      expect(currentRow).toBe(row)
      expect(currentRow.isConnected).toBe(true)
      currentRow.click()
      expect(execute).toHaveBeenCalledExactlyOnceWith('heading1', undefined, undefined)
      expect(editor.getJSON().content[0]).toMatchObject({ type: 'heading', attrs: { level: 1 } })
      expect(editor.state.doc.textContent).toBe('当前正文')
    } finally { editor.off('transaction', transaction); editor.destroy() }
  })
  it.each(['columns', 'table', 'templates', 'diagram', 'commands'])('关闭后旧 %s 子菜单选择入口不再派发命令', submenuType => {
    const root = rootNode(), onChoose = vi.fn()
    const ui = createCommandMenu({ host: root, handlers: { onChoose, onChooseDiagram: onChoose } })
    const item = { id: submenuType === 'templates' ? 'template' : submenuType, label: '选择', category: '基础', submenu: '选择', submenuType }
    try {
      ui.update({ open: true, kind: 'plus', items: [item], activeId: item.id,
        templates: [{ id: 'template-a', label: '模板 A' }], diagramTypes: [diagramTypes[0]] })
      root.querySelector('[data-command-id]').click()
      const row = ui.submenuEl.querySelector('button[role="menuitem"]')
      expect(row.isConnected).toBe(true)
      row.click()
      expect(onChoose).toHaveBeenCalledOnce()
      onChoose.mockClear()
      ui.update({ open: false })
      expect(row.isConnected).toBe(false)
      row.click()
      expect(onChoose).not.toHaveBeenCalled()
    } finally { ui.destroy() }
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
  it('恢复焦点的关闭回调不能打断下一批菜单', async () => {
    const h = menuHost()
    h.open()
    await settle()
    const focus = vi.spyOn(h.host, 'focus')
    h.host.editor = { isActive: () => false, view: { focus: vi.fn() } }
    h.host.trackTemplateMenu = vi.fn()
    const revision = h.host.menuRevision
    h.host.closeCommandMenu(true)
    expect(h.host.menuRevision).toBe(revision + 1)
    expect(focus).not.toHaveBeenCalled()
    expect(h.host.editor.view.focus).toHaveBeenCalledOnce()
    h.open()
    await settle()
    expect(focus).not.toHaveBeenCalled()
    expect(h.host.editor.view.focus).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(h.host._commandMenuUi.el.querySelector('input'))
  })
  it('触控 plus 聚焦关闭按钮，查询刷新不抢软键盘焦点', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const h = menuHost()
    h.open(); await settle()
    const close = h.host._commandMenuUi.el.querySelector('[aria-label="关闭插入面板"]')
    expect(document.activeElement).toBe(close)
    h.host.menuQuery = '表格'; await settle()
    expect(document.activeElement).toBe(close)
  })

  it('真实 Editor 关闭后重开，两帧后搜索框仍持有焦点', async () => {
    const frames = []
    vi.stubGlobal('requestAnimationFrame', callback => { frames.push(callback); return frames.length })
    const h = menuHost()
    const element = document.createElement('div'); document.body.appendChild(element)
    const editor = new Editor({ element, extensions: [StarterKit], content: '<p>正文</p>' })
    h.host.editor = editor
    h.host.focus = () => editor.commands.focus(undefined, { scrollIntoView: false })
    try {
      h.open(); await settle()
      h.host.closeCommandMenu(true)
      h.open(); await settle()
      for (let i = 0; i < 2; i += 1) { frames.splice(0).forEach(callback => callback()); await settle() }
      expect(document.activeElement).toBe(h.host._commandMenuUi.el.querySelector('input'))
    } finally { editor.destroy() }
  })

  it('采用主线传入的图表类型与专用回调，单次点击只执行一次', () => {
    const root = rootNode()
    const handlers = { onChoose: vi.fn(), onChooseDiagram: vi.fn() }
    const ui = createCommandMenu({ host: root, handlers })
    const diagram = { id: 'diagram', label: '图表', category: '基础', submenu: '图表', submenuType: 'diagram' }
    ui.update({ open: true, kind: 'slash', items: [diagram], activeId: 'diagram', diagramTypes: [diagramTypes[3]] })
    ui.choose()
    const buttons = ui.submenuEl.querySelectorAll('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0].getAttribute('aria-label')).toBe(diagramTypes[3].label)
    expect(buttons[0].querySelector('.lark-doc-diagram-icon svg')).not.toBeNull()
    buttons[0].click()
    expect(handlers.onChooseDiagram).toHaveBeenCalledExactlyOnceWith(diagramTypes[3].id)
    expect(handlers.onChoose).not.toHaveBeenCalled()
    ui.destroy()
  })
  it.each([[393, 852, 602], [393, 220, 150], [1280, 900, 100]])('模板子菜单按实际高度限制在%dx%d视窗内，末行可滚动触达', (width, height, triggerTop) => {
    vi.stubGlobal('innerWidth', width); vi.stubGlobal('innerHeight', height)
    vi.stubGlobal('matchMedia', query => ({ matches: width <= 760 && /max-width|pointer: coarse|hover: none/.test(query) }))
    const naturalHeight = 278.5, originalRect = HTMLElement.prototype.getBoundingClientRect
    // The approved five-template surface includes the heading and More row.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function() {
      if (this.classList.contains('lark-doc-command-submenu')) {
        const left = parseFloat(this.style.left) || 0, top = parseFloat(this.style.top) || 0
        const size = Math.min(naturalHeight, parseFloat(this.style.maxHeight) || naturalHeight)
        return { x: left, y: top, left, top, right: left + 250, bottom: top + size, width: 250, height: size }
      }
      if (this.classList.contains('lark-doc-template-more')) {
        const parent = this.parentNode, box = parent.getBoundingClientRect(), top = box.top + naturalHeight - 44 - parent.scrollTop
        return { left: box.left + 8, right: box.right - 8, top, bottom: top + 36, width: box.width - 16, height: 36 }
      }
      return originalRect.call(this)
    })
    const root = rootNode(), onChoose = vi.fn(), ui = createCommandMenu({ host: root, handlers: { onChoose } })
    const template = { id: 'template', label: '模板', category: '常用', submenu: '模板', submenuType: 'templates' }
    try {
      ui.update({ open: true, kind: 'plus', items: [template], activeId: 'template', templates: Array.from({ length: 5 }, (_, index) => ({ id: `template-${index}`, label: `模板${index}` })) })
      const trigger = root.querySelector('[data-command-id="template"]')
      trigger.getBoundingClientRect = () => rect(40, triggerTop)
      trigger.click()
      const menu = ui.submenuEl, box = menu.getBoundingClientRect()
      expect(box.top).toBeGreaterThanOrEqual(8)
      expect(box.bottom).toBeLessThanOrEqual(height - 8)
      expect(box.left).toBeGreaterThanOrEqual(8)
      expect(box.right).toBeLessThanOrEqual(width - 8)
      if (naturalHeight > height - 16) {
        expect(menu.style.overflowY).toBe('auto')
        menu.scrollTop = naturalHeight - box.height
        menu.dispatchEvent(new Event('scroll'))
      }
      const more = menu.querySelector('.lark-doc-template-more'), moreBox = more.getBoundingClientRect()
      expect(moreBox.top).toBeGreaterThanOrEqual(box.top)
      expect(moreBox.bottom).toBeLessThanOrEqual(box.bottom)
      if (width > 760) { expect(box.left).toBe(65); expect(box.top).toBe(triggerTop) }
      more.click()
      expect(onChoose).toHaveBeenCalledExactlyOnceWith({ id: 'template', templateLibrary: true })
    } finally { ui.destroy() }
  })
  it('本实例插入按钮不关闭菜单，其他实例插入按钮会关闭', () => {
    const root = rootNode()
    const own = document.createElement('button')
    own.setAttribute('aria-label', '插入')
    const child = document.createElement('span')
    own.appendChild(child)
    root.appendChild(own)
    const foreign = document.createElement('button')
    foreign.setAttribute('aria-label', '插入')
    document.body.appendChild(foreign)
    const ctx = { $refs: { root }, menuOpen: true, closeCommandMenu: vi.fn(), headingNumberMenu: { open: false } }
    overlayDismissMixin.methods.onDocumentPointerDown.call(ctx, { target: child })
    expect(ctx.closeCommandMenu).not.toHaveBeenCalled()
    overlayDismissMixin.methods.onDocumentPointerDown.call(ctx, { target: foreign })
    expect(ctx.closeCommandMenu).toHaveBeenCalledOnce()
  })
  it('禁用原因、hover 保活和图表子菜单在鼠标与 Enter 入口均保留', () => {
    const root = rootNode()
    const handlers = { onChoose: vi.fn(), onMenuEnter: vi.fn(), onMenuLeave: vi.fn() }
    const ui = createCommandMenu({ host: root, handlers })
    const diagram = { id: 'diagram', label: '图表', category: '基础', submenu: '图表', submenuType: 'diagram' }
    // plus 入口才挂搜索头（`head` 的 `on: state.kind !== 'slash'`，基线 0facf05:496 同款），
    // 而 Enter 只在搜索框内生效（`fromSearch = event.target === input`），所以这条用例走 plus。
    ui.update({ open: true, kind: 'plus', items: [diagram, { id: 'jira', label: 'Jira', category: '基础', tier: 'skip', reason: '未接入 Jira' }], activeId: 'diagram' })
    const skip = root.querySelector('[data-command-id="jira"]')
    expect(skip.disabled).toBe(true)
    expect(skip.title).toBe('')
    expect(skip.getAttribute('data-tooltip-title')).toBe('需要企业版接入')
    // 原因只进浮层提示，aria-label 还是这条命令自己的名字（见 commandMenu.js 的注释）。
    expect(skip.getAttribute('aria-label')).toBe('Jira')
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
    expect(handlers.blockTypeAction).not.toHaveBeenCalled()
    ui.updateChrome({ actionDisabled: false })
    type().click()
    expect(handlers.blockTypeAction).toHaveBeenCalledExactlyOnceWith('paragraph')
    ui.updateChrome({ buttonKind: 'empty' })
    root.querySelector('.lark-doc-empty-block-insert').dispatchEvent(new MouseEvent('mouseleave'))
    expect(handlers.scheduleCommandMenuClose).toHaveBeenCalledOnce()
    expect(blockHandleUiMixin.methods.blockHandleHandlers.call({}).scheduleCommandMenuClose).toBeTypeOf('function')
    ui.destroy()
  })
  it('工具栏插入与图表 hover 接线、标签、图标保留', async () => {
    const ctx = Object.fromEntries(['scheduleCommandMenuClose', 'cancelPopupHoverClose', 'openDiagramMenuOnHover', 'scheduleDiagramMenuClose', 'positionDiagramMenu'].map(name => [name, vi.fn()]))
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
    const menu = await vi.waitFor(() => {
      const current = ui.el.querySelector('.lark-doc-diagram-menu')
      expect(current).not.toBeNull()
      return current
    })
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

describe('块菜单私有 owner 冷边界', () => {
  function cold() {
    blockMenuBoundary.deferred = true
    vi.stubGlobal('__LARK_DOC_FEATURES__', new Map())
    let resolve, reject
    const promise = new Promise((yes, no) => { resolve = yes; reject = no })
    registerFeature('ui', () => promise)
    return { resolve: () => resolve({ createBlockHandleMenus: blockMenuBoundary.factory }), reject }
  }
  function open(ui, patch = {}) {
    ui.updateChrome({ visible: true, buttonKind: 'main', actionDisabled: false })
    return ui.updateMenu({ menuOpen: true, editAllowed: true, blockStyle: true,
      typeActions: [{ id: 'paragraph', label: '正文', icon: 'block-text' }], colors: [], ...patch })
  }
  function nativeHost(positionMenu) {
    const root = rootNode(), anchor = document.createElement('span'); root.appendChild(anchor)
    const positions = { menu: vi.fn(), align: vi.fn(), color: vi.fn() }
    const h = runtime({ mixins: [blockHandleUiMixin], methods: {
      writable() { return !this.effectiveReadonly }, featureEnabled: () => true,
      buildBlockHandleState() { return { visible: !this.effectiveReadonly, buttonKind: 'main', actionDisabled: false } },
      buildBlockMenuState() { return { menuOpen: this.blockMenuOpen, alignOpen: this.blockAlignMenuOpen,
        colorOpen: this.blockColorMenuOpen, typeActions: [], colors: [] } },
      positionBlockMenu: positionMenu || positions.menu, positionBlockAlignMenu: positions.align, positionBlockColorMenu: positions.color,
    } }, { editor: { isDestroyed: false }, nativeScopeValid: true, effectiveReadonly: false,
      blockMenuOpen: true, blockAlignMenuOpen: false, blockColorMenuOpen: false }, { root, blockHandleHost: anchor })
    h.host.mountBlockHandle()
    return { ...h, positions }
  }
  it('source 默认同步渲染，原 getter 和直接子节点身份在开合后保持', () => {
    const ui = createBlockHandle({ host: rootNode() })
    const nodes = [ui.menuEl, ui.alignMenuEl, ui.colorMenuEl, ui.alignTrigger, ui.colorTrigger]
    expect(open(ui, { alignOpen: true, colorOpen: true })).toBeUndefined()
    expect(ui.menuEl.querySelector('[aria-label="正文"]')).not.toBeNull()
    expect(ui.menuEl.parentElement).toBe(ui.el)
    expect(ui.alignMenuEl.parentElement).toBe(ui.el)
    expect(ui.colorMenuEl.parentElement).toBe(ui.menuEl)
    expect(ui.alignTrigger.parentElement).toBe(ui.menuEl)
    ui.updateMenu({ menuOpen: false, alignOpen: false, colorOpen: false })
    open(ui)
    expect([ui.menuEl, ui.alignMenuEl, ui.colorMenuEl, ui.alignTrigger, ui.colorTrigger]).toEqual(nodes)
    ui.destroy()
  })
  it.each(['coarse', 'synthetic'])('触摸 %s 悬停不抢先展开，明确点击只打开子菜单', async kind => {
    vi.stubGlobal('matchMedia', vi.fn(query => ({ matches: kind === 'coarse' && query === '(hover: none)' })))
    const gate = cold(), action = vi.fn(), opened = vi.fn()
    let ui
    ui = createBlockHandle({ host: rootNode(), handlers: {
      openBlockAlignMenuOnHover: event => { opened(event); ui.updateMenu({ alignOpen: true }) },
      openBlockColorMenuOnHover: event => { opened(event); ui.updateMenu({ colorOpen: true }) },
      blockAlignAction: action, blockColorAction: action,
    } })
    try {
      open(ui); gate.resolve(); await settle()
      for (const [trigger, submenu] of [[ui.alignTrigger, ui.alignMenuEl], [ui.colorTrigger, ui.colorMenuEl]]) {
        ui.updateMenu({ alignOpen: false, colorOpen: false }); opened.mockClear()
        const enter = new MouseEvent('mouseenter')
        if (kind === 'synthetic') Object.defineProperty(enter, 'sourceCapabilities', { value: { firesTouchEvents: true } })
        trigger.dispatchEvent(enter)
        expect(opened).not.toHaveBeenCalled()
        expect(submenu.isConnected).toBe(false)
        trigger.click()
        expect(opened).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'click' }))
        expect(submenu.isConnected).toBe(true)
        expect(action).not.toHaveBeenCalled()
      }
    } finally { ui.destroy() }
  })
  it.each(['align', 'color'])('桌面 %s 悬停与键盘聚焦仍同步展开', kind => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
    const opened = vi.fn()
    let ui
    const onOpen = event => { opened(event); ui.updateMenu({ [kind === 'align' ? 'alignOpen' : 'colorOpen']: true }) }
    ui = createBlockHandle({ host: rootNode(), handlers: {
      openBlockAlignMenuOnHover: onOpen, openBlockColorMenuOnHover: onOpen,
    } })
    try {
      open(ui)
      const trigger = kind === 'align' ? ui.alignTrigger : ui.colorTrigger
      const submenu = kind === 'align' ? ui.alignMenuEl : ui.colorMenuEl
      trigger.dispatchEvent(new MouseEvent('mouseenter'))
      expect(opened).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'mouseenter' }))
      expect(submenu.isConnected).toBe(true)
      ui.updateMenu({ alignOpen: false, colorOpen: false }); opened.mockClear()
      trigger.focus()
      expect(document.activeElement).toBe(trigger)
      expect(opened).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'focus' }))
      expect(submenu.isConnected).toBe(true)
    } finally { ui.destroy() }
  })
  it('首次冷开只显示热外壳，ready 使用最新禁用状态且不增加菜单 wrapper', async () => {
    const gate = cold(), onMenuReady = vi.fn(), blockTypeAction = vi.fn()
    const ui = createBlockHandle({ host: rootNode(), onMenuReady, handlers: { blockTypeAction } })
    const menu = ui.menuEl
    open(ui)
    expect(menu.querySelector('[aria-label="正文"]')).toBeNull()
    ui.updateMenu({ typeActions: [{ id: 'heading1', label: '标题 1', icon: 'heading-1', disabled: true }] })
    gate.resolve(); await settle()
    expect(ui.menuEl).toBe(menu)
    expect(menu.parentElement).toBe(ui.el)
    expect(menu.querySelector('.lark-doc-block-type-actions').parentElement).toBe(menu)
    const button = menu.querySelector('[aria-label="标题 1"]')
    expect(button.disabled).toBe(true); button.click()
    expect(blockTypeAction).not.toHaveBeenCalled()
    expect(menu.querySelector('[aria-label="正文"]')).toBeNull()
    expect(onMenuReady).toHaveBeenCalledOnce()
    ui.updateMenu({ typeActions: [{ id: 'heading1', label: '标题 1', icon: 'heading-1' }] })
    menu.querySelector('[aria-label="标题 1"]').click()
    expect(blockTypeAction).toHaveBeenCalledExactlyOnceWith('heading1')
    ui.destroy()
  })
  it.each(['close', 'hide', 'destroy'])('冷开后 %s，迟到 owner 不重开或通知', async action => {
    const gate = cold(), onMenuReady = vi.fn(), root = rootNode()
    const ui = createBlockHandle({ host: root, onMenuReady })
    open(ui)
    if (action === 'close') ui.updateMenu({ menuOpen: false })
    if (action === 'hide') ui.updateChrome({ visible: false })
    if (action === 'destroy') ui.destroy()
    const input = document.createElement('input'); document.body.appendChild(input); input.focus()
    gate.resolve(); await settle()
    expect(onMenuReady).not.toHaveBeenCalled()
    expect(root.querySelector('[aria-label="正文"]')).toBeNull()
    expect(document.activeElement).toBe(input)
    ui.destroy()
  })
  it('共享加载失败可重试，多实例仅为当前仍打开的菜单装配一次', async () => {
    const gate = cold(), firstReady = vi.fn(), secondReady = vi.fn()
    const first = createBlockHandle({ host: rootNode(), onMenuReady: firstReady })
    const second = createBlockHandle({ host: rootNode(), onMenuReady: secondReady })
    open(first); open(second)
    gate.reject(new Error('chunk unavailable')); await settle()
    await vi.waitFor(() => expect(first.menuEl.querySelector('[role="alert"]')).not.toBeNull())
    second.updateMenu({ menuOpen: false })
    registerFeature('ui', () => ({ createBlockHandleMenus: blockMenuBoundary.factory }))
    first.menuEl.querySelector('[role="alert"]').click(); await settle()
    expect(first.menuEl.querySelector('[aria-label="正文"]')).not.toBeNull()
    expect(first.menuEl.querySelector('[role="alert"]')).toBeNull()
    expect(firstReady).toHaveBeenCalledOnce()
    expect(second.menuEl.querySelector('[aria-label="正文"]')).toBeNull()
    expect(secondReady).not.toHaveBeenCalled()
    first.destroy(); second.destroy()
  })
  it('冷 owner 装满后调用真实定位方法重测完整列表并避开顶栏', async () => {
    vi.stubGlobal('innerWidth', 393); vi.stubGlobal('innerHeight', 852)
    const gate = cold(), h = nativeHost(blockMenuMixin.methods.positionBlockMenu)
    const ui = h.host._blockHandleUi, menu = ui.menuEl
    const header = document.createElement('header'); header.className = 'lark-doc-topbar'; h.host.$refs.root.prepend(header)
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 64, height: 64 })
    vi.spyOn(ui.el, 'getBoundingClientRect').mockReturnValue({ top: 477.5, bottom: 505.5, left: 4, right: 24, width: 20, height: 28 })
    vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue({ width: 230, height: 0 })
    vi.spyOn(menu, 'scrollHeight', 'get').mockImplementation(() => menu.querySelector('[role="menuitem"]') ? 543 : 0)
    expect(menu.scrollHeight).toBe(0)
    gate.resolve(); await settle()
    expect(menu.scrollHeight).toBe(543)
    expect(h.host.blockMenuStyle).toBeDefined()
    const top = 477.5 + Number.parseFloat(h.host.blockMenuStyle.top), height = Number.parseFloat(h.host.blockMenuStyle.maxHeight)
    expect(top).toBeGreaterThanOrEqual(72)
    expect(top + height).toBeLessThanOrEqual(469.5)
    expect(height).toBeGreaterThan(32)
  })

  it('已 warm 同步装配不触发 TDZ，nextTick 后才重新测量且不抢外部焦点', async () => {
    cold()
    registerFeature('ui.ready', () => ({ createBlockHandleMenus: blockMenuBoundary.factory }))
    const h = nativeHost()
    expect(h.positions.menu).not.toHaveBeenCalled()
    const input = document.createElement('input'); document.body.appendChild(input); input.focus()
    await settle()
    expect(h.positions.menu).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(input)
  })
  it.each(['close', 'readonly', 'retire', 'destroy'])('ready 已排队后 %s 不测量旧菜单', async action => {
    cold()
    registerFeature('ui.ready', () => ({ createBlockHandleMenus: blockMenuBoundary.factory }))
    const h = nativeHost()
    if (action === 'close') h.host.blockMenuOpen = false
    if (action === 'readonly') h.host.effectiveReadonly = true
    if (action === 'retire') h.host.nativeScopeValid = false
    if (action === 'destroy') h.host.destroyBlockHandle()
    await settle()
    expect(h.positions.menu).not.toHaveBeenCalled()
    expect(h.positions.align).not.toHaveBeenCalled()
    expect(h.positions.color).not.toHaveBeenCalled()
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
