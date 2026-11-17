// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import { CellSelection, TableMap } from '@tiptap/pm/tables'
import { createTableTools } from '../../src/ui/tableTools'
import { createTableOverlays } from '../../src/ui/tableOverlays'
import tableToolsUi from '../../src/components/lark-doc/editor/tableToolsUiMixin'
import bubbleMenu from '../../src/components/lark-doc/editor/bubbleMenuMixin'
import { createWorkspaceShell } from '../../src/ui/workspaceShell'

const mounted = []
const width = window.innerWidth, height = window.innerHeight
afterEach(() => {
  mounted.splice(0).forEach(ui => ui.destroy())
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
  document.body.replaceChildren()
})

function phoneTable(bottom = 215) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 852 })
  const wrapper = document.createElement('div')
  wrapper.innerHTML = '<table><tbody><tr><td>A1</td><td>B1</td><td></td></tr><tr><td>A2</td><td>B2</td><td></td></tr></tbody></table>'
  wrapper.getBoundingClientRect = () => ({ left: 26, right: 367, top: 111.5, bottom, width: 341, height: bottom - 111.5 })
  wrapper.querySelector('td').getBoundingClientRect = () => ({ left: 26, width: 114 })
  wrapper.querySelector('tr').getBoundingClientRect = () => ({ top: 111.5, bottom: 163.25, height: 51.75 })
  const host = { _mobileEditorMedia: { matches: true }, bubbleSafeTop: () => 50, tableOverlayWrapper: () => wrapper }
  const ui = createTableTools({ host: document.body }); mounted.push(ui)
  ui.el.getBoundingClientRect = () => ({ width: Math.min(377, parseFloat(ui.el.style.maxWidth) || 377), height: 56 })
  return { host, ui }
}

function expectSelectorsClear(ui, anchor) {
  const left = parseFloat(ui.el.style.left), top = parseFloat(ui.el.style.top)
  const rect = ui.el.getBoundingClientRect()
  expect(top).toBeGreaterThanOrEqual(50)
  expect(left + rect.width).toBeLessThanOrEqual(385)
  expect(top + rect.height).toBeLessThanOrEqual(844)
  for (const avoid of anchor.avoid) {
    expect(left >= avoid.right || left + rect.width <= avoid.left || top >= avoid.bottom || top + rect.height <= avoid.top).toBe(true)
  }
}

function pointer(target, type) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 83.5, clientY: 105.5 })
  Object.defineProperties(event, { pointerType: { value: 'touch' }, pointerId: { value: 1 } })
  target.dispatchEvent(event)
}

function physicalClick(target) {
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }))
}

describe('phone table toolbar selection controls', () => {
  it.each(['column', 'row'])('keeps the toolbar below native non-sticky chrome and clear of selectors (%s)', axis => {
    const { host, ui } = phoneTable()
    const shell = createWorkspaceShell(document)
    document.body.appendChild(shell.root)
    const topbar = document.createElement('header')
    topbar.className = 'lark-doc-topbar'
    topbar.style.position = 'relative'; topbar.style.display = 'flex'
    topbar.getBoundingClientRect = () => ({ top: 0, bottom: 64, width: 393, height: 64 })
    shell.topBarHost.appendChild(topbar)
    shell.main.getBoundingClientRect = () => ({ top: 94, bottom: 852, width: 393, height: 758 })
    shell.main.style.overflow = 'auto'
    const wrapper = host.tableOverlayWrapper()
    wrapper.getBoundingClientRect = () => ({ left: 26, right: 367, top: 106.75, bottom: 209.75, width: 341, height: 103 })
    shell.paper.appendChild(wrapper)
    host.$refs = shell
    host.bubbleSafeTop = () => bubbleMenu.methods.bubbleSafeTop.call(host)
    expect(host.bubbleSafeTop()).toBe(14)
    const anchor = tableToolsUi.methods.tableToolbarAnchor.call(host, { axis, index: 0 })
    expect(anchor.safeTop).toBe(100)
    ui.update({ open: true, cellKind: 'line', anchor })
    expect(parseFloat(ui.el.style.top)).toBeGreaterThanOrEqual(100)
    expectSelectorsClear(ui, anchor)
    host._mobileEditorMedia.matches = false
    const desktop = tableToolsUi.methods.tableToolbarAnchor.call(host, { axis, index: 0 })
    expect(desktop.safeTop).toBe(8)
    expect(desktop.avoid).toBeNull()
    expect(desktop).not.toHaveProperty('fallbackSafeTop')
  })

  it.each(['missing', 'detached', 'hidden', 'offscreen'])('keeps the legacy fallback for a %s native main', state => {
    const { host } = phoneTable()
    const shell = createWorkspaceShell(document)
    document.body.appendChild(shell.root)
    host.$refs = shell
    host.bubbleSafeTop = undefined
    shell.main.getBoundingClientRect = () => ({ top: state === 'offscreen' ? 900 : 94, bottom: 1658, width: 393, height: 758 })
    if (state === 'missing') shell.main.remove()
    if (state === 'detached') shell.root.remove()
    if (state === 'hidden') shell.main.style.visibility = 'hidden'
    expect(tableToolsUi.methods.tableToolbarAnchor.call(host, { axis: 'column', index: 0 }).safeTop).toBe(8)
  })

  it.each([
    [800, 56, false, 8],
    [750, 100, true, 8],
    [790, 40, true, 796],
    [782, 56, true, 788],
  ])('only raises native chrome safety at top %s when a %spx toolbar fits with bottom padding', (mainTop, toolbarHeight, connected, expected) => {
    const { host, ui } = phoneTable()
    const shell = createWorkspaceShell(document)
    document.body.appendChild(shell.root)
    shell.main.getBoundingClientRect = () => ({ top: mainTop, bottom: mainTop + 758, width: 393, height: 758 })
    const wrapper = host.tableOverlayWrapper()
    shell.paper.appendChild(wrapper)
    wrapper.getBoundingClientRect = () => ({ left: 26, right: 367, top: mainTop + 12, bottom: mainTop + 115, width: 341, height: 103 })
    host.$refs = shell
    host.bubbleSafeTop = undefined
    host._tableToolsUi = ui
    ui.el.getBoundingClientRect = () => ({ width: Math.min(377, parseFloat(ui.el.style.maxWidth) || 377), height: toolbarHeight })
    if (connected) ui.update({ open: true, cellKind: 'line' })
    const anchor = tableToolsUi.methods.tableToolbarAnchor.call(host, { axis: 'column', index: 0 })
    expect(anchor.safeTop).toBe(expected)
    ui.update({ open: true, cellKind: 'line', anchor })
    expect(parseFloat(ui.el.style.top) + toolbarHeight).toBeLessThanOrEqual(844)
    expectSelectorsClear(ui, anchor)
  })

  it.each(['column', 'row'])('keeps both selector axes and the sticky top bar reachable near the top (%s)', axis => {
    const { host, ui } = phoneTable()
    const anchor = tableToolsUi.methods.tableToolbarAnchor.call(host, { axis, index: 0 })
    expect(anchor.avoid).toHaveLength(2)
    ui.update({ open: true, cellKind: 'line', anchor })
    expectSelectorsClear(ui, anchor)
  })

  it('uses space beside the row controls when a tall table cannot fit the toolbar above or below', () => {
    const { host, ui } = phoneTable(840)
    const anchor = tableToolsUi.methods.tableToolbarAnchor.call(host, { axis: 'column', index: 0 })
    ui.update({ open: true, cellKind: 'line', anchor })
    expectSelectorsClear(ui, anchor)
    expect(parseFloat(ui.el.style.left)).toBeGreaterThanOrEqual(38)
  })

  it('keeps a feasible narrowed tall-table placement above the native floor before considering its old floor', () => {
    const { host, ui } = phoneTable(840)
    const shell = createWorkspaceShell(document)
    document.body.appendChild(shell.root)
    shell.main.getBoundingClientRect = () => ({ top: 94, bottom: 852, width: 393, height: 758 })
    shell.paper.appendChild(host.tableOverlayWrapper())
    host.$refs = shell
    host.bubbleSafeTop = () => 14
    const anchor = tableToolsUi.methods.tableToolbarAnchor.call(host, { axis: 'column', index: 0 })
    expect(anchor.safeTop).toBe(100)
    expect(anchor.fallbackSafeTop).toBe(14)
    ui.update({ open: true, cellKind: 'line', anchor })
    expect(parseFloat(ui.el.style.top)).toBeGreaterThanOrEqual(100)
    expect(parseFloat(ui.el.style.left)).toBeGreaterThanOrEqual(38)
    expect(ui.el.style.maxWidth).not.toBe('')
    expectSelectorsClear(ui, anchor)
  })

  it('does not merge a selected column when its touch click is retargeted to a newly shown toolbar', () => {
    const editor = new Editor({ extensions: [StarterKit, TableKit], content: '<table><tr><td>A1</td><td>B1</td><td></td></tr><tr><td>A2</td><td>B2</td><td></td></tr></table><p>after table</p>' })
    mounted.push(editor)
    const baseline = editor.getJSON(), transactions = []
    editor.on('transaction', ({ transaction }) => transactions.push(transaction.docChanged))
    const onCommand = vi.fn(id => { if (id === 'merge-cell') editor.commands.mergeCells() })
    const tools = createTableTools({ host: document.body, handlers: { onCommand } }); mounted.push(tools)
    const onSelect = vi.fn(() => {
      const doc = editor.state.doc, map = TableMap.get(doc.firstChild)
      editor.view.dispatch(editor.state.tr.setSelection(CellSelection.colSelection(doc.resolve(1 + map.map[0]), doc.resolve(1 + map.map[map.width]))))
      tools.update({ open: true, cellKind: 'line', canMergeCell: true })
    })
    const overlay = createTableOverlays({ host: document.body, handlers: { onSelect } }); mounted.push(overlay)
    overlay.update({ open: true, columns: [{ index: 0, left: 0, width: 114 }], rows: [] })
    pointer(overlay.el.querySelector('[aria-label="选择第 1 列"]'), 'pointerdown')
    pointer(window, 'pointerup')
    const merge = tools.el.querySelector('[data-cmd="merge-cell"]')
    // Chrome touch trace: selector pointerup selects the column; its compatibility
    // click then lands on the toolbar button newly moved under the finger.
    physicalClick(merge)
    expect(onSelect).toHaveBeenCalledOnce()
    expect(onCommand).not.toHaveBeenCalled()
    expect(transactions).toEqual([false])
    expect(editor.getJSON()).toEqual(baseline)

    // A new tap starting on the actual button is an independent authorized action.
    pointer(merge, 'pointerdown'); pointer(merge, 'pointerup'); physicalClick(merge)
    expect(onCommand).toHaveBeenCalledExactlyOnceWith('merge-cell', null)
    expect(transactions.filter(Boolean)).toHaveLength(1)
    expect(editor.commands.undo()).toBe(true)
    expect(editor.getJSON()).toEqual(baseline)
  })

  it.each(['pointerdown', 'click'])('keeps the original button when an earlier %s capture refresh detaches its SVG', phase => {
    const editor = new Editor({ extensions: [StarterKit, TableKit], content: '<table><tr><td>A1</td><td>B1</td></tr><tr><td>A2</td><td>B2</td></tr></table>' })
    mounted.push(editor)
    const doc = editor.state.doc, map = TableMap.get(doc.firstChild)
    editor.view.dispatch(editor.state.tr.setSelection(CellSelection.colSelection(doc.resolve(1 + map.map[0]), doc.resolve(1 + map.map[map.width]))))
    const baseline = editor.getJSON()
    const onCommand = vi.fn(id => { if (id === 'table-header') editor.commands.toggleHeaderColumn() })
    let detached = false, tools
    const refreshIcon = event => {
      const button = event.target.closest?.('button')
      if (!tools?.el.contains(button) || button.dataset.cmd !== 'table-header') return
      const icon = button.firstElementChild
      icon.replaceChildren(icon.firstElementChild.cloneNode(true))
      detached = !event.target.isConnected && event.target.closest('button') === null
      expect(event.composedPath()).toContain(button)
    }
    document.addEventListener(phase, refreshIcon, true)
    try {
      tools = createTableTools({ host: document.body, handlers: { onCommand } }); mounted.push(tools)
      tools.update({ open: true, cellKind: 'line', headerAxis: 'column', headerEnabled: true })
      const button = tools.el.querySelector('[data-cmd="table-header"]')
      pointer(button.querySelector('svg'), 'pointerdown')
      pointer(button, 'pointerup')
      button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      button.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }))
      physicalClick(button.querySelector('svg'))
      expect(detached).toBe(true)
      expect(onCommand).toHaveBeenCalledExactlyOnceWith('table-header', null)
      expect(editor.state.doc.firstChild.firstChild.firstChild.type.name).toBe('tableHeader')
      expect(editor.state.doc.firstChild.lastChild.firstChild.type.name).toBe('tableHeader')
      expect(editor.commands.undo()).toBe(true)
      expect(editor.getJSON()).toEqual(baseline)
    } finally { document.removeEventListener(phase, refreshIcon, true) }
  })

  it('rejects a compatibility click after its original toolbar button was disconnected during capture', () => {
    let tools
    const retireButton = event => { if (tools?.el.contains(event.target)) event.target.closest('button')?.remove() }
    document.addEventListener('pointerdown', retireButton, true)
    try {
      const onCommand = vi.fn()
      tools = createTableTools({ host: document.body, handlers: { onCommand } }); mounted.push(tools)
      const state = { open: true, cellKind: 'line', headerAxis: 'column', headerEnabled: true }
      tools.update(state)
      const button = tools.el.querySelector('[data-cmd="table-header"]')
      pointer(button.querySelector('svg'), 'pointerdown')
      expect(button.isConnected).toBe(false)
      tools.update(state)
      physicalClick(button)
      expect(onCommand).not.toHaveBeenCalled()
    } finally { document.removeEventListener('pointerdown', retireButton, true) }
  })

  it('closes an open More menu when its second physical click loses the target SVG during capture', () => {
    const editor = new Editor({ extensions: [StarterKit, TableKit], content: '<table><tr><td>A1</td><td>B1</td></tr></table>' })
    mounted.push(editor)
    const baseline = editor.getJSON(), onCommand = vi.fn()
    let tools, detached = false
    const refreshIcon = event => {
      const button = event.target.closest?.('button')
      if (!tools?.el.contains(button) || button.dataset.cmd !== 'more') return
      const icon = button.firstElementChild
      icon.replaceChildren(icon.firstElementChild.cloneNode(true))
      detached = !event.target.isConnected
    }
    document.addEventListener('pointerdown', refreshIcon, true)
    try {
      tools = createTableTools({ host: document.body, handlers: { onCommand } }); mounted.push(tools)
      tools.update({ open: true, cellKind: 'line' })
      const more = tools.el.querySelector('[data-cmd="more"]')
      more.click()
      const menu = tools.el.querySelector('[data-menu="more"]')
      expect(menu.isConnected).toBe(true)
      pointer(more.querySelector('svg'), 'pointerdown')
      pointer(more, 'pointerup')
      more.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      more.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }))
      physicalClick(more.querySelector('svg'))
      expect(detached).toBe(true)
      expect(more.getAttribute('aria-expanded')).toBe('false')
      expect(menu.isConnected).toBe(false)
      expect(tools.el.querySelector('[data-menu="more"]')).toBeNull()
      expect(onCommand).not.toHaveBeenCalled()
      expect(editor.getJSON()).toEqual(baseline)
    } finally { document.removeEventListener('pointerdown', refreshIcon, true) }
  })

  it.each(['mouseenter', 'focus'])('consumes a %s pre-open on the first physical click so the second click closes More', preopen => {
    const editor = new Editor({ extensions: [StarterKit, TableKit], content: '<table><tr><td>A1</td><td>B1</td></tr></table>' })
    mounted.push(editor)
    const baseline = editor.getJSON(), onCommand = vi.fn()
    const tools = createTableTools({ host: document.body, handlers: { onCommand } }); mounted.push(tools)
    tools.update({ open: true, cellKind: 'line' })
    const more = tools.el.querySelector('[data-cmd="more"]')
    more.dispatchEvent(new Event(preopen))
    const menu = tools.el.querySelector('[data-menu="more"]')
    expect(menu.isConnected).toBe(true)
    pointer(more.querySelector('svg'), 'pointerdown')
    pointer(more, 'pointerup')
    more.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    more.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }))
    physicalClick(more.querySelector('svg'))
    expect(more.getAttribute('aria-expanded')).toBe('true')
    expect(menu.isConnected).toBe(true)
    // No second mouseenter/focus occurs in the observed second touch.
    pointer(more.querySelector('svg'), 'pointerdown')
    physicalClick(more.querySelector('svg'))
    expect(more.getAttribute('aria-expanded')).toBe('false')
    expect(menu.isConnected).toBe(false)
    expect(tools.el.querySelector('[data-menu="more"]')).toBeNull()
    expect(onCommand).not.toHaveBeenCalled()
    expect(editor.getJSON()).toEqual(baseline)
  })

  it.each(['disabled', 'closed', 'other-ui'])('keeps the %s guard for a physical toolbar click', guard => {
    const onCommand = vi.fn(), tools = createTableTools({ host: document.body, handlers: { onCommand } }); mounted.push(tools)
    const state = { open: true, cellKind: 'line', headerAxis: 'column', headerEnabled: true }
    tools.update(state)
    const button = tools.el.querySelector('[data-cmd="table-header"]')
    if (guard === 'other-ui') {
      const other = createTableTools({ host: document.body }); mounted.push(other)
      other.update(state)
      pointer(other.el.querySelector('[data-cmd="table-header"] svg'), 'pointerdown')
    } else {
      pointer(button.querySelector('svg'), 'pointerdown')
      tools.update(guard === 'closed' ? { open: false } : { ...state, headerEnabled: false })
    }
    physicalClick(button)
    expect(onCommand).not.toHaveBeenCalled()
  })

  it('keeps keyboard and assistive clicks available without a pointer origin', () => {
    const onCommand = vi.fn(), ui = createTableTools({ host: document.body, handlers: { onCommand } }); mounted.push(ui)
    ui.update({ open: true, cellKind: 'line', canMergeCell: true })
    ui.el.querySelector('[data-cmd="merge-cell"]').click()
    expect(onCommand).toHaveBeenCalledExactlyOnceWith('merge-cell', null)
  })
})

describe('private table presenter readiness', () => {
  it('refreshes current table surfaces after cold mounting and ignores retired ready callbacks', async () => {
    const factories = []
    const create = options => { const ui = { options, update: vi.fn(), destroy: vi.fn() }; factories.push(ui); return ui }
    vi.doMock('../../src/ui/tableTools', () => ({ createTableTools: create, createTableBoundaryTools: create }))
    vi.doMock('../../src/ui/cellPlusTools', () => ({ createCellPlusTools: create }))
    let vm, methods
    try {
      const module = await import('../../src/components/lark-doc/editor/tableToolsUiMixin?table-presenter-ready')
      methods = module.default.methods
      const root = document.createElement('div')
      vm = { $refs: { tableToolsHost: root, tableBoundaryHost: root },
        refreshTableTools: vi.fn(), refreshTableBoundary: vi.fn(), mountTableOverlays: vi.fn() }
      methods.mountTableTools.call(vm)
      const ready = factories.map(ui => ui.options.onReady)
      expect(ready).toHaveLength(3)
      expect(ready.every(callback => typeof callback === 'function')).toBe(true)
      ready.forEach(callback => callback())
      expect(vm.refreshTableTools).toHaveBeenCalledTimes(4)
      expect(vm.refreshTableBoundary).toHaveBeenCalledTimes(4)
      const original = vm._tableToolsUi
      vm._tableToolsUi = {}; ready[0](); vm._tableToolsUi = original
      vm._isDestroyed = true; ready[1](); vm._isDestroyed = false
      methods.destroyTableTools.call(vm); ready[2]()
      expect(vm.refreshTableTools).toHaveBeenCalledTimes(4)
      expect(vm.refreshTableBoundary).toHaveBeenCalledTimes(4)
    } finally {
      if (vm?._tableToolsUi) methods.destroyTableTools.call(vm)
      vi.doUnmock('../../src/ui/tableTools'); vi.doUnmock('../../src/ui/cellPlusTools')
    }
  })
})
