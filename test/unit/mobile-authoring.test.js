// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createToolbar } from '../../src/ui/toolbar'
import { createBlockHandle } from '../../src/ui/blockHandle'
import { createBubbleBar } from '../../src/ui/bubbleBar'
import blockHandleMixin from '../../src/components/lark-doc/editor/blockHandleMixin'
import blockMenuMixin from '../../src/components/lark-doc/editor/blockMenuMixin'
import blockHandleUiMixin from '../../src/components/lark-doc/editor/blockHandleUiMixin'
import { filterCommands } from '../../src/core/commands'
import { ICONS } from '../../src/ui/icons'
import { createLinkDialog } from '../../src/ui/dialogs'
import { createCommandMenu } from '../../src/ui/commandMenu'
import { createLinkTools } from '../../src/ui/linkTools'
import { LarkDoc } from '../../src/LarkDoc'
import { Editor } from '@tiptap/core'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import { Schema } from '@tiptap/pm/model'
import { createColorPalette } from '../../src/ui/colorPalette'
import { TEXT_COLOR_OPTIONS, TEXT_BACKGROUND_ROWS } from '../../src/ui/palette'
import { createTableOverlays } from '../../src/ui/tableOverlays'
import { createTableTools } from '../../src/ui/tableTools'

const fixtureSchema = new Schema({ nodes: { doc: { content: 'block+' }, paragraph: { group: 'block', content: 'text*' }, text: { group: 'inline' } } })

const originalWidth = window.innerWidth
const originalHeight = window.innerHeight
const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia')
const originalVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport')
const mounted = []
afterEach(() => {
  mounted.splice(0).forEach(ui => ui.destroy())
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalHeight })
  if (originalMatchMedia) Object.defineProperty(window, 'matchMedia', originalMatchMedia)
  else delete window.matchMedia
  if (originalVisualViewport) Object.defineProperty(window, 'visualViewport', originalVisualViewport)
  else delete window.visualViewport
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

function bar(width, viewport, handlers = {}) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: viewport })
  const host = document.createElement('div'); document.body.append(host)
  const ui = createBubbleBar(host, { config: { blockStyle: true, comment: true }, handlers })
  ui.el.getBoundingClientRect = () => ({ width, height: 42 })
  mounted.push(ui)
  return ui
}

describe('mobile body floating controls', () => {
  it('table toolbar renders a visible SVG for every action and nested alignment choice', () => {
    const ui = createTableTools({ host: document.body }); mounted.push(ui)
    for (const kind of ['text', 'line', 'multi', 'columns', 'rows']) {
      ui.update({ open: true, cellKind: kind, headerAxis: 'column' })
      const buttons = [...ui.el.querySelectorAll('.lark-doc-table-tools-bar button')]
      expect(buttons.length).toBeGreaterThan(5)
      for (const button of buttons) expect(button.querySelector('.lark-doc-table-tools-icon svg'), button.getAttribute('aria-label')).not.toBeNull()
    }
    ui.el.querySelector('[aria-label="对齐与缩进"]').click()
    for (const icon of ui.el.querySelectorAll('.lark-doc-table-tools-menu-icon')) expect(icon.querySelector('svg')).not.toBeNull()
  })
  function tableOverlay(handlers = {}) {
    const ui = createTableOverlays({ host: document.body, handlers }); mounted.push(ui)
    const state = { open: true, rows: [{ index: 0, top: 0, height: 48 }, { index: 1, top: 48, height: 48 }], columns: [{ index: 0, left: 0, width: 120 }] }
    ui.update(state)
    return { ui, state }
  }
  function tablePointer(target, type, y = 20, pointerId = 1) {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 20, clientY: y })
    Object.defineProperty(event, 'pointerType', { value: 'touch' })
    Object.defineProperty(event, 'pointerId', { value: pointerId })
    target.dispatchEvent(event)
  }
  it('table geometry repaint retains the active row control and its gesture', () => {
    const onSelect = vi.fn(), { ui, state } = tableOverlay({ onSelect })
    const row = ui.el.querySelector('[aria-label="选择第 1 行"]')
    row.focus(); tablePointer(row, 'pointerdown')
    ui.update({ ...state, rows: state.rows.map(item => ({ ...item, height: 52, top: item.top + 8 })) })
    expect(document.activeElement).toBe(row)
    expect(ui.el.querySelector('[aria-label="选择第 1 行"]')).toBe(row)
    tablePointer(window, 'pointerup')
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('row', 0, { shiftKey: false })
  })
  it('closing table controls cancels a pending touch and rejects retired keyboard actions', () => {
    const onSelect = vi.fn(), onReorderEnd = vi.fn(), onReorderCancel = vi.fn()
    const { ui } = tableOverlay({ onSelect, onReorderEnd, onReorderCancel })
    const row = ui.el.querySelector('[aria-label="选择第 1 行"]')
    tablePointer(row, 'pointerdown'); tablePointer(window, 'pointermove', 90)
    ui.update({ open: false })
    tablePointer(window, 'pointerup', 90)
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(onReorderCancel).toHaveBeenCalledOnce()
    expect(onReorderEnd).not.toHaveBeenCalled()
    expect(onSelect).not.toHaveBeenCalled()
  })
  it('table toolbar fallback reserves its gap above a narrow-screen selector band', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    const ui = createTableTools({ host: document.body }); mounted.push(ui)
    ui.el.getBoundingClientRect = () => ({ width: 359, height: 56 })
    ui.update({ open: true, cellKind: 'line', anchor: { x: 26, y: 250, placement: 'left', fallbackX: 28, fallbackY: 200 } })
    expect(parseFloat(ui.el.style.top) + 56).toBeLessThanOrEqual(188)
  })
  it.each(['closed', 'destroyed'])('retired table controls reject selector and scrollbar input (%s)', kind => {
    const onSelect = vi.fn(), onScrollRatio = vi.fn(), { ui, state } = tableOverlay({ onSelect, onScrollRatio })
    ui.update({ ...state, scrollVisible: true, thumbWidth: 30 })
    const row = ui.el.querySelector('[aria-label="选择第 1 行"]'), scrollbar = ui.el.querySelector('[role="scrollbar"]')
    scrollbar.getBoundingClientRect = () => ({ left: 0, width: 200 })
    if (kind === 'destroyed') ui.destroy()
    else ui.update({ ...state, open: false, scrollVisible: true })
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    tablePointer(row, 'pointerdown'); tablePointer(window, 'pointerup')
    tablePointer(scrollbar, 'pointerdown'); tablePointer(window, 'pointerup')
    scrollbar.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(onSelect).not.toHaveBeenCalled(); expect(onScrollRatio).not.toHaveBeenCalled()
    if (kind === 'destroyed') { ui.update(state); expect(ui.el.isConnected).toBe(false) }
  })
  it.each(['tableKey', 'documentKey'])('table gesture is canceled when its source changes (%s)', field => {
    const onReorderEnd = vi.fn(), onReorderCancel = vi.fn(), { ui, state } = tableOverlay({ onReorderEnd, onReorderCancel })
    const context = { tableKey: {}, documentKey: {} }
    ui.update({ ...state, ...context })
    tablePointer(ui.el.querySelector('[aria-label="选择第 1 行"]'), 'pointerdown')
    tablePointer(window, 'pointermove', 90)
    ui.update({ ...state, ...context, [field]: {} })
    tablePointer(window, 'pointerup', 90)
    expect(onReorderCancel).toHaveBeenCalledOnce()
    expect(onReorderEnd).not.toHaveBeenCalled()
  })
  it('table gesture ignores an unrelated touch ending', () => {
    const onSelect = vi.fn(), { ui } = tableOverlay({ onSelect })
    tablePointer(ui.el.querySelector('[aria-label="选择第 1 行"]'), 'pointerdown', 20, 1)
    tablePointer(window, 'pointerup', 20, 2)
    expect(onSelect).not.toHaveBeenCalled()
    tablePointer(window, 'pointerup', 20, 1)
    expect(onSelect).toHaveBeenCalledOnce()
  })
  it.each([true, false])('table gesture cancellation keeps the newer reentrant state (open=%s)', open => {
    let ui, next
    const made = tableOverlay({ onReorderCancel: () => ui.update({ ...next, open, drop: null, card: null }) })
    ui = made.ui
    tablePointer(ui.el.querySelector('[aria-label="选择第 1 行"]'), 'pointerdown')
    tablePointer(window, 'pointermove', 90)
    next = { ...made.state, documentKey: {}, drop: { axis: 'row', offset: 48 }, card: { text: 'old', axis: 'row', x: 0, y: 0 } }
    ui.update(next)
    expect(ui.el.classList.contains('is-reordering')).toBe(false)
    expect(ui.el.isConnected).toBe(open)
  })
  it('table gesture cancellation during clipping does not repaint the retired row state', () => {
    let ui, next
    const made = tableOverlay({ onReorderCancel: () => ui.update({ ...next, drop: null }) })
    ui = made.ui
    tablePointer(ui.el.querySelector('[aria-label="选择第 1 行"]'), 'pointerdown')
    tablePointer(window, 'pointermove', 90)
    next = { ...made.state, rows: [made.state.rows[1]], drop: { axis: 'row', offset: 48 } }
    ui.update(next)
    expect(ui.el.classList.contains('is-reordering')).toBe(false)
    expect(ui.el.querySelector('[aria-label="选择第 1 行"]')).toBeNull()
  })
  it.each(['closed', 'destroyed'])('retired table toolbar and submenu reject commands (%s)', kind => {
    const onCommand = vi.fn(), ui = createTableTools({ host: document.body, handlers: { onCommand } }); mounted.push(ui)
    const state = { open: true, cellKind: 'line' }
    ui.update(state)
    const bold = ui.el.querySelector('[aria-label="加粗"]'), turn = ui.el.querySelector('[aria-label="转换为"]')
    turn.click()
    const item = ui.el.querySelector('[data-value="heading1"]')
    if (kind === 'destroyed') ui.destroy()
    else ui.update({ open: false })
    bold.click(); item.click(); turn.click()
    expect(onCommand).not.toHaveBeenCalled()
    expect(ui.el.querySelector('.lark-doc-table-tools-menu')).toBeNull()
  })
  it('table toolbar flips below a selector band near the viewport top', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    const ui = createTableTools({ host: document.body }); mounted.push(ui)
    ui.el.getBoundingClientRect = () => ({ width: 377, height: 56 })
    ui.update({ open: true, cellKind: 'line', anchor: { x: 190, y: 24, placement: 'top', avoid: { left: 26, right: 367, top: 24, bottom: 40 } } })
    expect(parseFloat(ui.el.style.top)).toBeGreaterThanOrEqual(52)
  })
  it('table toolbar avoids the sticky header before deciding whether to flip', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    const ui = createTableTools({ host: document.body }); mounted.push(ui)
    ui.el.getBoundingClientRect = () => ({ width: 377, height: 56 })
    ui.update({ open: true, cellKind: 'line', anchor: { x: 190, y: 64, placement: 'top', safeTop: 50, avoid: { left: 26, right: 367, top: 64, bottom: 80 } } })
    expect(parseFloat(ui.el.style.top)).toBeGreaterThanOrEqual(92)
  })
  it('table toolbar leaves a tall row selector reachable when vertical placement cannot fit', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 852 })
    const ui = createTableTools({ host: document.body }); mounted.push(ui)
    ui.el.getBoundingClientRect = () => ({ width: Math.min(377, parseFloat(ui.el.style.maxWidth) || 377), height: 56 })
    ui.update({ open: true, cellKind: 'line', anchor: { x: 26, y: 400, placement: 'left', fallbackX: 28, fallbackY: 24, avoid: { left: 14, right: 26, top: 24, bottom: 840 } } })
    const left = parseFloat(ui.el.style.left), width = ui.el.getBoundingClientRect().width
    expect(left).toBeGreaterThanOrEqual(38)
    expect(left + width).toBeLessThanOrEqual(385)
  })
  it('真实宿主在横竖屏、键盘收起和销毁后正确维护附件栏及列表高亮', async () => {
    const createRange = document.createRange.bind(document)
    vi.spyOn(document, 'createRange').mockImplementation(() => Object.assign(createRange(), {
      getClientRects: () => [], getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }),
    }))
    const media = Object.assign(new EventTarget(), { matches: true })
    const viewport = Object.assign(new EventTarget(), { height: 552, offsetTop: 0 })
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 852 })
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => media })
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
    const element = document.createElement('div'); document.body.append(element)
    const doc = new LarkDoc({ element, storage: 'none', content: '<p>手机正文</p>', config: { layout: { toolbarVisible: false } } })
    mounted.push(doc)
    const editor = doc.getEditor(), host = doc._handle.nativeHost.host
    host.$refs.root.getBoundingClientRect = () => ({ left: 0, right: 393 })
    expect(element.querySelector('.lark-doc-mobile-edit-bar')).toBeNull()
    editor.view.dom.focus()
    await vi.waitFor(() => expect(element.querySelector('.lark-doc-mobile-edit-bar')).not.toBeNull())
    expect(element.querySelector('.lark-doc-toolbar').style.getPropertyValue('--ld-mobile-bottom')).toBe('300px')
    expect(element.querySelector('.lark-doc-toolbar').classList.contains('is-keyboard-raised')).toBe(true)
    host.handleRange = { from: 0, to: editor.state.doc.firstChild.nodeSize }
    await vi.waitFor(() => expect(element.querySelector('.lark-doc-block-handle.is-mobile-handle')).not.toBeNull())
    expect(element.querySelectorAll('.lark-doc-block-handle-dots circle')).toHaveLength(6)
    viewport.offsetTop = 48; viewport.dispatchEvent(new Event('scroll'))
    await vi.waitFor(() => expect(element.querySelector('.lark-doc-toolbar').style.getPropertyValue('--ld-mobile-bottom')).toBe('252px'))
    viewport.height = 852; viewport.offsetTop = 0; viewport.dispatchEvent(new Event('resize'))
    await vi.waitFor(() => expect(element.querySelector('.lark-doc-toolbar').style.getPropertyValue('--ld-mobile-bottom')).toBe('0px'))
    expect(element.querySelector('.lark-doc-toolbar').classList.contains('is-keyboard-raised')).toBe(false)
    media.matches = false; media.dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect(element.querySelector('.lark-doc-toolbar')).toBeNull())
    await vi.waitFor(() => expect(element.querySelector('.lark-doc-block-handle')).not.toBeNull())
    host.blockMenuOpen = true
    media.matches = true; media.dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect(element.querySelector('.lark-doc-mobile-edit-bar')).not.toBeNull())
    expect(element.querySelector('.lark-doc-block-handle.is-mobile-handle')).not.toBeNull()
    expect(host.blockMenuOpen).toBe(false)
    element.querySelector('[aria-label="段落类型"]').click()
    element.querySelector('[aria-label="有序列表"]').click()
    expect(editor.isActive('orderedList')).toBe(true)
    await vi.waitFor(() => expect(element.querySelector('[aria-label="有序列表"]').getAttribute('aria-pressed')).toBe('true'))
    element.querySelector('[aria-label="有序列表"]').click()
    await vi.waitFor(() => expect(element.querySelector('[aria-label="有序列表"]').getAttribute('aria-pressed')).toBe('false'))
    element.querySelector('[aria-label="收起键盘"]').click()
    await vi.waitFor(() => expect(element.querySelector('.lark-doc-toolbar')).toBeNull())
    expect(editor.isEditable).toBe(true)
    viewport.height = 852; viewport.dispatchEvent(new Event('resize'))
    expect(element.querySelector('.lark-doc-toolbar')).toBeNull()
    editor.view.dom.focus()
    await vi.waitFor(() => expect(element.querySelector('.lark-doc-mobile-edit-bar')).not.toBeNull())
    const beforeColor = doc.getJSON()
    element.querySelector('[aria-label="行内格式"]').click()
    element.querySelector('[aria-label="文字颜色"]').click()
    await vi.waitFor(() => expect(element.querySelector('.lark-doc-color-palette.is-mobile-sheet')).not.toBeNull())
    expect(editor.isFocused).toBe(false)
    expect(element.querySelector('.lark-doc-mobile-edit-bar')).toBeNull()
    expect(element.querySelectorAll('.lark-doc-color-grid button')).toHaveLength(16)
    element.querySelector('[aria-label="返回文字格式"]').click()
    await vi.waitFor(() => expect(editor.isFocused).toBe(true))
    expect(element.querySelector('.lark-doc-mobile-format-panel').dataset.panel).toBe('marks')
    expect(doc.getJSON()).toEqual(beforeColor)
    editor.commands.setTextSelection({ from: 1, to: 3 })
    editor.chain().setColor(TEXT_COLOR_OPTIONS[6].value).setBackgroundColor(TEXT_BACKGROUND_ROWS[0][1].value).run()
    const styled = doc.getJSON()
    element.querySelector('[aria-label="文字颜色"]').click()
    await vi.waitFor(() => expect(element.querySelector('[aria-label="恢复默认颜色"]')).not.toBeNull())
    element.querySelector('[aria-label="恢复默认颜色"]').click()
    await vi.waitFor(() => expect(doc.getJSON()).toEqual(beforeColor))
    editor.commands.undo(); expect(doc.getJSON()).toEqual(styled)
    editor.commands.redo(); expect(doc.getJSON()).toEqual(beforeColor)
    element.querySelector('[aria-label="文字颜色"]').click()
    await vi.waitFor(() => expect(element.querySelector('[aria-label="返回文字格式"]')).not.toBeNull())
    const staleBack = element.querySelector('[aria-label="返回文字格式"]')
    doc.setReadonly(true)
    await vi.waitFor(() => expect(element.querySelector('.lark-doc-color-palette')).toBeNull())
    staleBack.click()
    expect(editor.isFocused).toBe(false)
    expect(doc.getJSON()).toEqual(beforeColor)
    doc.setReadonly(false)
    await Promise.resolve(); await Promise.resolve()
    expect(element.querySelector('.lark-doc-mobile-edit-bar')).toBeNull()
    editor.commands.setTextSelection({ from: 1, to: 3 }); editor.view.dom.focus()
    await vi.waitFor(() => expect(element.querySelector('.lark-doc-mobile-edit-bar')).not.toBeNull())
    element.querySelector('[aria-label="行内格式"]').click()
    element.querySelector('[aria-label="文字颜色"]').click()
    await vi.waitFor(() => expect(element.querySelector('[aria-label="返回文字格式"]')).not.toBeNull())
    const retiredColor = element.querySelector('[aria-label="字体颜色 蓝色"]')
    const retiredReset = element.querySelector('[aria-label="恢复默认颜色"]')
    const retiredBack = element.querySelector('[aria-label="返回文字格式"]')
    const beforeFeature = doc.getJSON()
    doc.patchProps({ config: { layout: { toolbarVisible: false }, features: { textStyle: false } } })
    await vi.waitFor(() => expect(element.querySelector('.lark-doc-color-palette')).toBeNull())
    retiredColor.click(); retiredReset.click(); retiredBack.click()
    expect(doc.getJSON()).toEqual(beforeFeature)
    expect(editor.isFocused).toBe(false)
    doc.destroy(); mounted.splice(mounted.indexOf(doc), 1)
    const refresh = vi.spyOn(host, 'refreshToolbar')
    media.dispatchEvent(new Event('change')); viewport.dispatchEvent(new Event('resize')); window.dispatchEvent(new Event('resize'))
    expect(refresh).not.toHaveBeenCalled()
  })
  it.each([{ touch: true, noHover: false }, { touch: false, noHover: true }])('空段加号忽略兼容 hover，触控 click 只打开一次 (%j)', ({ touch, noHover }) => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: noHover }) })
    const openEmptyBlockInsertMenu = vi.fn()
    const ui = createBlockHandle({ host: document.body, handlers: { openEmptyBlockInsertMenu } }); mounted.push(ui)
    ui.updateChrome({ visible: true, buttonKind: 'empty' })
    const plus = ui.el.querySelector('[aria-label="插入内容"]')
    const hover = new MouseEvent('mouseenter')
    Object.defineProperty(hover, 'sourceCapabilities', { value: { firesTouchEvents: touch } })
    plus.dispatchEvent(hover)
    expect(openEmptyBlockInsertMenu).not.toHaveBeenCalled()
    plus.click()
    expect(openEmptyBlockInsertMenu).toHaveBeenCalledOnce()
  })

  it('桌面空段加号保留 hover 打开', () => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false }) })
    const openEmptyBlockInsertMenu = vi.fn()
    const ui = createBlockHandle({ host: document.body, handlers: { openEmptyBlockInsertMenu } }); mounted.push(ui)
    ui.updateChrome({ visible: true, buttonKind: 'empty' })
    ui.el.querySelector('[aria-label="插入内容"]').dispatchEvent(new MouseEvent('mouseenter'))
    expect(openEmptyBlockInsertMenu).toHaveBeenCalledOnce()
  })

  it('手机添加面板采用原生标题/基础/常用顺序，搜索按需打开且桌面数据不变', () => {
    let mobile = true
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ get matches() { return mobile } }) })
    const items = [
      { id: 'paragraph', label: '正文', category: '基础' },
      ...Array.from({ length: 9 }, (_, i) => ({ id: `heading${i + 1}`, label: `${i + 1}级标题`, category: i < 3 ? '基础' : '其他标题' })),
      ...['orderedList', 'bulletList', 'code', 'blockquote', 'link', 'divider'].map(id => ({ id, label: id, category: '基础' })),
      ...['taskList', 'callout', 'table', 'image', 'file', 'source_synced'].map(id => ({ id, label: id, category: '常用' })),
    ]
    const before = JSON.stringify(items)
    const onChoose = vi.fn()
    const ui = createCommandMenu({ host: document.body, handlers: { onChoose } }); mounted.push(ui)
    ui.update({ open: true, kind: 'plus', items })
    const ids = category => [...ui.el.querySelectorAll(`[data-category="${category}"] [data-command-id]`)].map(x => x.dataset.commandId)
    expect(ids('基础')).toEqual(['heading1','heading2','heading3','heading4','heading5','heading6','heading7','heading8','heading9','orderedList','bulletList','taskList','code','blockquote','link'])
    const headings = ui.el.querySelector('[aria-label="标题快捷项"]')
    const blocks = ui.el.querySelector('[aria-label="列表与块快捷项"]')
    expect(headings).not.toBeNull()
    expect(blocks).not.toBeNull()
    headings.scrollLeft = 160
    blocks.scrollLeft = 48
    headings.dispatchEvent(new Event('scroll'))
    blocks.dispatchEvent(new Event('scroll'))
    ui.update({ activeId: 'heading9' })
    expect(ui.el.querySelector('[aria-label="标题快捷项"]')).toBe(headings)
    expect(ui.el.querySelector('[aria-label="列表与块快捷项"]')).toBe(blocks)
    expect(headings.scrollLeft).toBe(160)
    expect(blocks.scrollLeft).toBe(48)
    expect(onChoose).not.toHaveBeenCalled()
    headings.querySelector('[data-command-id="heading9"]').click()
    expect(onChoose).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'heading9' }))
    expect(ids('常用').slice(0,5)).toEqual(['image','file','table','callout','source_synced'])
    expect(ui.el.querySelector('[data-command-id="file"] .lark-doc-command-label').textContent).toBe('文件')
    for (const icon of ui.el.querySelectorAll('[data-category="基础"] .lark-doc-command-icon, [data-category="常用"] .lark-doc-command-icon')) expect(icon.querySelector('svg')).not.toBeNull()
    expect(ui.el.querySelector('input').hidden).toBe(true)
    ui.el.querySelector('[aria-label="搜索命令"]').click()
    expect(ui.el.querySelector('input').hidden).toBe(false)
    expect(document.activeElement).toBe(ui.el.querySelector('input'))
    expect(JSON.stringify(items)).toBe(before)
    mobile = false; ui.update({})
    expect(ids('基础')[0]).toBe('paragraph')
    expect(ui.el.querySelector('input').hidden).toBe(false)
  })

  it('phone add panel shows task and callout once although the source list carries two desktop entries', () => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: true }) })
    const items = filterCommands('', 'plus', null, 'phone')
    expect(items.filter(item => item.id === 'taskList')).toHaveLength(2)
    expect(items.filter(item => item.id === 'callout')).toHaveLength(2)
    const ui = createCommandMenu({ host: document.body }); mounted.push(ui)
    ui.update({ open: true, kind: 'plus', items })
    const ids = [...ui.el.querySelectorAll('[data-category="基础"] [data-command-id], [data-category="常用"] [data-command-id]')].map(x => x.dataset.commandId)
    expect(ids.filter(id => id === 'taskList')).toHaveLength(1)
    expect(ids.filter(id => id === 'callout')).toHaveLength(1)
    expect(ids.slice(0, 15)).toEqual(['heading1','heading2','heading3','heading4','heading5','heading6','heading7','heading8','heading9','orderedList','bulletList','taskList','code','blockquote','link'])
  })

  it('every available phone add command uses SVG and restores its desktop glyph when the media changes', () => {
    let mobile = true
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ get matches() { return mobile } }) })
    const items = filterCommands('', 'plus', null, 'phone')
    const ui = createCommandMenu({ host: document.body }); mounted.push(ui)
    ui.update({ open: true, kind: 'plus', items })
    for (const item of items) {
      const icon = ui.el.querySelector(`[data-command-id="${item.id}"] .lark-doc-command-icon`)
      expect(icon?.querySelector('svg'), item.id).not.toBeNull()
    }
    const blockMath = ui.el.querySelector('[data-command-id="blockMath"] .lark-doc-command-icon')
    expect(blockMath.classList.contains('is-gray')).toBe(true)
    mobile = false; ui.update({})
    expect(blockMath.querySelector('svg')).toBeNull()
    expect(blockMath.style.width).toBe('')
    expect(blockMath.textContent).toBe('∑')
  })

  it('phone add headings, three-line numbering and complete quote shapes use dedicated SVG paths', () => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: true }) })
    const ui = createCommandMenu({ host: document.body }); mounted.push(ui)
    ui.update({ open: true, kind: 'plus', items: filterCommands('', 'plus', null, 'phone') })
    for (let level = 1; level <= 6; level++) {
      const icon = ui.el.querySelector(`[data-command-id="heading${level}"] .lark-doc-command-icon`)
      const expected = document.createElement('div'); expected.innerHTML = ICONS[`mobile-heading${level}`]
      expect(icon.firstElementChild.isEqualNode(expected.firstElementChild)).toBe(true)
      expect(icon.querySelector('text')).toBeNull()
      expect(icon.querySelectorAll('path')).toHaveLength(2)
    }
    const ordered = ui.el.querySelector('[data-command-id="orderedList"] .lark-doc-command-icon')
    expect(ordered.querySelector('text')).toBeNull()
    expect(ordered.querySelectorAll('g path')).toHaveLength(3)
    const quote = ui.el.querySelector('[data-command-id="blockquote"] .lark-doc-command-icon')
    const expectedQuote = document.createElement('div'); expectedQuote.innerHTML = ICONS['mobile-quote']
    expect(quote.firstElementChild.isEqualNode(expectedQuote.firstElementChild)).toBe(true)
    expect(quote.querySelectorAll('path[fill="currentColor"]')).toHaveLength(2)
    expect(ICONS['block-h1']).toContain('<text')
    expect(ICONS['block-ordered']).toContain('<text')
    expect(ICONS['block-quote']).not.toBe(ICONS['mobile-quote'])
  })

  it('coarse phone body handle uses six dots while readonly and feature gates remain closed', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    const host = {
      editor: {}, effectiveReadonly: false, handleRange: { from: 0, to: 2 },
      _mobileEditorMedia: { matches: true }, featureEnabled: () => true,
      handleBlockNode: () => null,
    }
    expect(blockHandleUiMixin.methods.buildBlockHandleState.call(host)).toMatchObject({ visible: true, mobile: true, buttonKind: 'main' })
    host._mobileEditorMedia.matches = false
    expect(blockHandleUiMixin.methods.buildBlockHandleState.call(host).visible).toBe(true)
    host.effectiveReadonly = true
    expect(blockHandleUiMixin.methods.buildBlockHandleState.call(host).visible).toBe(false)
    host.effectiveReadonly = false; host.featureEnabled = () => false
    expect(blockHandleUiMixin.methods.buildBlockHandleState.call(host).visible).toBe(false)
  })

  it('plus 提供关闭按钮和遮罩，关闭回执只触发一次且 slash 不保留遮罩', () => {
    const onClose = vi.fn()
    const ui = createCommandMenu({ host: document.body, handlers: { onClose } }); mounted.push(ui)
    ui.update({ open: true, kind: 'plus', items: [] })
    const close = ui.el.querySelector('[aria-label="关闭插入面板"]')
    expect(close).not.toBeNull()
    ui.focusClose()
    expect(document.activeElement).toBe(close)
    close.click()
    expect(onClose).toHaveBeenCalledOnce()
    const backdrop = document.querySelector('.lark-doc-command-backdrop')
    expect(backdrop).not.toBeNull()
    backdrop.click()
    expect(onClose).toHaveBeenCalledTimes(2)
    ui.update({ kind: 'slash' })
    expect(document.querySelector('.lark-doc-command-backdrop')).toBeNull()
  })

  it.each([{ touch: true, noHover: false }, { touch: false, noHover: true }])('ignores touch-generated hover before opening the plus table picker (%j)', ({ touch, noHover }) => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: noHover }) })
    const onChoose = vi.fn(), item = { id: 'table', label: '表格', category: '基础', submenu: '表格', submenuType: 'table' }
    const ui = createCommandMenu({ host: document.body, handlers: { onChoose } }); mounted.push(ui)
    ui.update({ open: true, kind: 'plus', items: [item] })
    const row = ui.el.querySelector('[data-command-id="table"]'), hover = new MouseEvent('mouseenter')
    Object.defineProperty(hover, 'sourceCapabilities', { value: { firesTouchEvents: touch } })
    row.dispatchEvent(hover)
    expect(ui.submenuEl).toBeNull()
    row.click()
    expect(onChoose).not.toHaveBeenCalled()
    expect(ui.submenuEl.querySelectorAll('[role="menuitem"]')).toHaveLength(81)
    ui.submenuEl.querySelector('[data-row="2"][data-col="3"]').click()
    expect(onChoose).toHaveBeenCalledExactlyOnceWith({ id: 'table', tableSize: { rows: 2, cols: 3 } })
  })

  it('keeps table submenu keyboard focus on touch devices and hover on desktop', () => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: true }) })
    const item = { id: 'table', label: '表格', category: '基础', submenu: '表格', submenuType: 'table' }
    const keyboard = createCommandMenu({ host: document.body }); mounted.push(keyboard)
    keyboard.update({ open: true, kind: 'plus', items: [item] })
    keyboard.el.querySelector('[data-command-id="table"]').focus()
    expect(keyboard.submenuEl).not.toBeNull()
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false }) })
    const desktop = createCommandMenu({ host: document.body }); mounted.push(desktop)
    desktop.update({ open: true, kind: 'plus', items: [item] })
    desktop.el.querySelector('[data-command-id="table"]').dispatchEvent(new MouseEvent('mouseenter'))
    expect(desktop.submenuEl).not.toBeNull()
  })

  it('keeps link actions reachable when a tall preview is only partially visible', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 852 })
    const ui = createLinkTools({ host: document.body }); mounted.push(ui)
    ui.el.getBoundingClientRect = () => ({ width: 377, height: 82 })
    ui.update({ open: true, href: 'https://example.com', view: 'preview', left: 26, right: 367, top: -20, bottom: 3000 })
    expect(parseFloat(ui.el.style.left)).toBe(8)
    expect(parseFloat(ui.el.style.top)).toBe(762)
    expect(parseFloat(ui.el.style.top) + 82).toBeLessThanOrEqual(844)
    const trigger = ui.el.querySelector('[aria-label="链接视图"]')
    trigger.click()
    const menu = ui.el.querySelector('[aria-label="链接显示视图"]')
    expect(menu.hidden).toBe(false)
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    menu.dispatchEvent(escape)
    expect(escape.defaultPrevented).toBe(true)
    expect(menu.hidden).toBe(true)
    expect(document.activeElement).toBe(trigger)
  })
  it('keeps a default command submenu across unrelated updates and closes it when its item is removed', () => {
    const ui = createCommandMenu({ host: document.body }); mounted.push(ui)
    ui.update({ open: true, kind: 'plus', activeId: 'parent', items: [{ id: 'parent', label: '更多', category: '基础', submenu: 'custom' }] })
    ui.choose()
    const submenu = ui.submenuEl
    expect(submenu).not.toBeNull()
    ui.update({ query: '无关状态刷新' })
    expect(ui.submenuEl).toBe(submenu)
    ui.update({ items: [] })
    expect(ui.submenuEl).toBeNull()
  })
  it('offers touch cancellation and removal only for an existing link', () => {
    const onClose = vi.fn(), onRemove = vi.fn(), ui = createLinkDialog({ host: document.body, handlers: { onClose, onRemove } }); mounted.push(ui)
    ui.update({ open: true, insertMode: true, value: 'https://example.com' })
    const cancel = [...ui.el.querySelectorAll('button')].find(e => e.textContent === '取消')
    const remove = [...ui.el.querySelectorAll('button')].find(e => e.textContent === '移除链接')
    expect(cancel).toBeTruthy(); expect(remove.hidden).toBe(true)
    cancel.click(); expect(onClose).toHaveBeenCalledOnce()
    ui.update({ insertMode: false, linkActive: true }); remove.click(); expect(onRemove).toHaveBeenCalledOnce()
    ui.update({ linkActive: false }); remove.click(); expect(onRemove).toHaveBeenCalledOnce()
  })

  it('denies invalid, composing and retired link-form submission', () => {
    const onApply = vi.fn(), onRemove = vi.fn(), ui = createLinkDialog({ host: document.body, handlers: { onApply, onRemove } }); mounted.push(ui)
    ui.update({ open: true, value: 'javascript:alert(1)', linkActive: true })
    const input = ui.el.querySelector('[aria-label="链接地址"]')
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(onApply).not.toHaveBeenCalled()
    ui.update({ value: 'https://example.com' })
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }))
    expect(onApply).not.toHaveBeenCalled()
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(onApply).toHaveBeenCalledOnce()
    const confirm = [...ui.el.querySelectorAll('button')].find(e => e.textContent === '确认')
    const remove = [...ui.el.querySelectorAll('button')].find(e => e.textContent === '移除链接')
    ui.update({ open: false }); confirm.click(); remove.click()
    expect(onApply).toHaveBeenCalledOnce(); expect(onRemove).not.toHaveBeenCalled()
  })

  it.each([{ fold: false }, { fold: true }, { fold: true, hiddenHandle: true }, { empty: true }])('keeps a cold block handle inside the phone gutter without covering a fold control (%j)', ({ fold, hiddenHandle, empty }) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    const root = document.createElement('section'), paper = document.createElement('div'), node = document.createElement('p')
    paper.className = 'lark-doc-paper'; root.append(paper); paper.append(node); document.body.append(root)
    const rect = { left: 44, right: 349, top: 100, bottom: 126 }
    node.getBoundingClientRect = () => rect
    paper.getBoundingClientRect = () => ({ left: 0, right: 393, top: 0 })
    if (hiddenHandle) {
      const button = document.createElement('button'); button.className = 'lark-doc-block-handle-main'; root.append(button)
    }
    if (empty) {
      const button = document.createElement('button'); button.className = 'lark-doc-block-handle-main'; root.append(button)
      button.getBoundingClientRect = () => ({ width: 20, height: 28 })
    }
    if (fold) {
      const widget = document.createElement('span'); widget.className = 'lark-doc-heading-fold-toggle'; node.append(widget)
      widget.getBoundingClientRect = () => ({ left: 26, right: 44, top: 100, bottom: 126 })
    }
    const host = { ...blockHandleMixin.methods, $refs: { root },
      editor: { state: { doc: fixtureSchema.node('doc', null, [fixtureSchema.node('paragraph')]) }, view: { dom: paper, nodeDOM: () => node } },
      clearBlockMenuCloseTimer() {}, blockShellElement: () => null, highlightStartBounds: () => rect, firstLineInkBounds: () => rect }
    blockHandleMixin.methods.positionBlockHandle.call(host, { from: 0, to: 2 })
    expect(host.blockHandlePosition.left).toBe(fold ? 4 : 12)
    expect(host.blockHandlePosition.left + 20).toBeLessThanOrEqual(fold ? 26 : 44)
    expect(host.blockHandlePosition.top).toBe(99)
  })

  it('clamps the measured strip inside the phone viewport and retains the final actions', () => {
    const onCopy = vi.fn(), onComment = vi.fn(), ui = bar(377, 393, { onCopy, onComment })
    ui.update({ left: 26, top: 100 })
    expect(parseFloat(ui.el.style.left)).toBe(8)
    expect(parseFloat(ui.el.style.left) + 377).toBeLessThanOrEqual(393 - 8)
    ui.el.querySelector('[aria-label="复制选中文字"]').click()
    ui.el.querySelector('[aria-label="添加评论"]').click()
    expect(onCopy).toHaveBeenCalledOnce(); expect(onComment).toHaveBeenCalledOnce()
  })

  it('preserves the desktop empty-block fallback rather than adopting the mobile insert size', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 })
    const root = document.createElement('section'), paper = document.createElement('div'), node = document.createElement('p'), button = document.createElement('button')
    paper.className = 'lark-doc-paper'; button.className = 'lark-doc-empty-block-insert'
    root.append(paper, button); paper.append(node); document.body.append(root)
    const rect = { left: 70, right: 830, top: 100, bottom: 126 }
    node.getBoundingClientRect = () => rect; paper.getBoundingClientRect = () => ({ left: 0, right: 900, top: 0 })
    button.getBoundingClientRect = () => ({ width: 28, height: 28 })
    const host = { ...blockHandleMixin.methods, $refs: { root },
      editor: { state: { doc: fixtureSchema.node('doc', null, [fixtureSchema.node('paragraph')]) }, view: { dom: paper, nodeDOM: () => node } },
      clearBlockMenuCloseTimer() {}, blockShellElement: () => null, highlightStartBounds: () => rect, firstLineInkBounds: () => rect }
    blockHandleMixin.methods.positionBlockHandle.call(host, { from: 0, to: 2 })
    expect(host.blockHandlePosition).toEqual({ left: 16, top: (rect.top + rect.bottom - 26) / 2 })
  })

  it('positions an open submenu after the strip has moved away from the screen edge', () => {
    const ui = bar(377, 393)
    const trigger = ui.el.querySelector('[aria-label="标题级别"]')
    trigger.getBoundingClientRect = () => ({ left: parseFloat(ui.el.style.left) + 5, top: 105, bottom: 137 })
    ui.update({ left: 26, top: 100, headingOpen: true })
    expect(ui.el.querySelector('[aria-label="划词标题级别"]').style.left).toBe('13px')
  })

  it('preserves the existing desktop positioning contract', () => {
    const ui = bar(418, 1280)
    ui.update({ left: 160, top: 100 }); expect(ui.el.style.left).toBe('160px')
    ui.update({ left: 1100, top: 100 }); expect(ui.el.style.left).toBe('1100px')
  })
})


describe('native phone editing accessory', () => {
  it('mounts a mobile color-sheet Back control and ignores a retired Back without changing desktop structure', () => {
    const onBack = vi.fn(), onLeave = vi.fn(), onApply = vi.fn()
    const ui = createColorPalette({ host: document.body, handlers: { onBack, onLeave, onApply } }); mounted.push(ui)
    ui.update({ open: true, isText: true, mobile: true, letters: TEXT_COLOR_OPTIONS, rows: TEXT_BACKGROUND_ROWS, recentText: [TEXT_COLOR_OPTIONS[6].value] })
    expect(ui.el.classList.contains('is-mobile-sheet')).toBe(true)
    expect(ui.el.querySelector('.lark-doc-color-sheet-head').textContent).toContain('颜色和高亮')
    expect(ui.el.querySelector('.lark-doc-color-letters button').classList.contains('is-active')).toBe(true)
    expect(ui.el.querySelector('.lark-doc-color-palette-text-recent')).toBeNull()
    ui.el.dispatchEvent(new MouseEvent('mouseleave'))
    expect(onLeave).not.toHaveBeenCalled()
    const back = ui.el.querySelector('[aria-label="返回文字格式"]')
    back.click(); expect(onBack).toHaveBeenCalledOnce()
    ui.update({ open: false }); back.click(); expect(onBack).toHaveBeenCalledOnce()
    ui.update({ open: true, mobile: false })
    expect(ui.el.querySelector('.lark-doc-color-sheet-head')).toBeNull()
    expect(ui.el.querySelector('.lark-doc-color-palette-text-recent')).not.toBeNull()
    ui.el.dispatchEvent(new MouseEvent('mouseleave')); expect(onLeave).toHaveBeenCalledOnce()
    ui.el.querySelector('[aria-label="字体颜色 蓝色"]').click()
    expect(onApply).toHaveBeenCalledExactlyOnceWith(TEXT_COLOR_OPTIONS[6].value, 'textColor')
  })
  function accessory(handlers = {}, state = {}) {
    const ui = createToolbar({ handlers, alignNames: { left: '左', center: '居中', right: '右' } })
    mounted.push(ui); document.body.appendChild(ui.el)
    const next = { mobileAccessory: true, features: { ai: false, insert: true },
      marks: [{ id: 'bold', label: '加粗', glyph: 'B' }, { id: 'italic', label: '斜体', glyph: 'I' }],
      indent: { level: 0, canIncrease: true }, ...state }
    ui.update(next)
    return { ui, next }
  }
  it('keeps the native five marks and color entry first while retaining extended formats', () => {
    const ids = ['bold', 'italic', 'underline', 'strike', 'code', 'subscript', 'superscript', 'highlight']
    const { ui } = accessory({}, { marks: ids.map(id => ({ id, label: id, glyph: id })) })
    ui.el.querySelector('[aria-label="行内格式"]').click()
    const labels = [...ui.el.querySelectorAll('.lark-doc-mobile-format-panel button')].map(n => n.getAttribute('aria-label'))
    expect(labels).toEqual([...ids.slice(0, 5), '文字颜色', ...ids.slice(5)])
  })
  it('opens native T/Aa/paragraph strips and delegates commands without duplicating the desktop bar', () => {
    const setHeading = vi.fn(), toggleMark = vi.fn(), setAlign = vi.fn(), run = vi.fn()
    const { ui } = accessory({ setHeading, toggleMark, setAlign, run })
    const bar = ui.el.querySelector('.lark-doc-mobile-edit-bar')
    expect(bar).not.toBeNull()
    bar.querySelector('[aria-label="段落类型"]').click()
    ui.el.querySelector('.lark-doc-mobile-format-panel [aria-label="二级标题"]').click()
    expect(setHeading).toHaveBeenCalledExactlyOnceWith(2)
    ui.el.querySelector('.lark-doc-mobile-format-panel [aria-label="有序列表"]').click()
    expect(run).toHaveBeenCalledExactlyOnceWith('toggleOrderedList')
    bar.querySelector('[aria-label="行内格式"]').click()
    ui.el.querySelector('.lark-doc-mobile-format-panel [aria-label="加粗"]').click()
    expect(toggleMark).toHaveBeenCalledExactlyOnceWith('bold')
    bar.querySelector('[aria-label="段落格式"]').click()
    ui.el.querySelector('.lark-doc-mobile-format-panel [aria-label="居中对齐"]').click()
    expect(setAlign).toHaveBeenCalledExactlyOnceWith('center')
  })
  it('keeps panel identity/pressed state on transactions, and cancels stale actions on readonly or desktop', () => {
    const toggleMark = vi.fn()
    const { ui, next } = accessory({ toggleMark })
    ui.el.querySelector('[aria-label="行内格式"]').click()
    const panel = ui.el.querySelector('.lark-doc-mobile-format-panel')
    const bold = panel.querySelector('[aria-label="加粗"]')
    ui.update({ ...next, active: { bold: true } })
    expect(ui.el.querySelector('.lark-doc-mobile-format-panel')).toBe(panel)
    expect(bold.getAttribute('aria-pressed')).toBe('true')
    ui.update({ ...next, readonly: true })
    bold.click(); expect(toggleMark).not.toHaveBeenCalled()
    ui.update({ ...next, mobileAccessory: false })
    expect(ui.el.querySelector('.lark-doc-mobile-edit-bar')).toBeNull()
    expect(ui.el.getAttribute('aria-label')).toBe('文档工具栏')
  })
  it('retires removed features even when an old mobile control receives a late click', () => {
    const setHeading = vi.fn(), toggleMark = vi.fn(), openCommandMenu = vi.fn()
    const { ui, next } = accessory({ setHeading, toggleMark, openCommandMenu })
    const plus = ui.el.querySelector('.lark-doc-mobile-edit-bar [aria-label="插入内容"]')
    ui.el.querySelector('[aria-label="段落类型"]').click()
    const h2 = ui.el.querySelector('.lark-doc-mobile-format-panel [aria-label="二级标题"]')
    ui.el.querySelector('[aria-label="行内格式"]').click()
    const bold = ui.el.querySelector('.lark-doc-mobile-format-panel [aria-label="加粗"]')
    ui.update({ ...next, groups: { headings: false, marks: false, textStyle: false, blockStyle: false }, features: { insert: false } })
    plus.click(); h2.click(); bold.click()
    expect(setHeading).not.toHaveBeenCalled(); expect(toggleMark).not.toHaveBeenCalled(); expect(openCommandMenu).not.toHaveBeenCalled()
  })

  it('T条保留原首段并追加代码、引用和配置允许的扩展标题，pressed只反映当前state', () => {
    const run = vi.fn(), setHeading = vi.fn()
    const { ui, next } = accessory({ run, setHeading }, { active: { codeBlock: true, blockquote: true } })
    const bar = ui.el.querySelector('.lark-doc-mobile-edit-bar'), firstButtons = [...bar.children]
    bar.querySelector('[aria-label="段落类型"]').click()
    const panel = ui.el.querySelector('.lark-doc-mobile-format-panel')
    const labels = [...panel.children].map(button => button.getAttribute('aria-label'))
    expect(labels.slice(0, 9)).toEqual(['正文', '一级标题', '二级标题', '三级标题', '任务列表', '有序列表', '无序列表', '代码块', '引用'])
    expect(labels).toContain('九级标题')
    const code = panel.querySelector('[aria-label="代码块"]'), quote = panel.querySelector('[aria-label="引用"]')
    expect(code.getAttribute('aria-pressed')).toBe('true'); expect(quote.getAttribute('aria-pressed')).toBe('true')
    code.click(); quote.click()
    expect(run.mock.calls.map(([command]) => command)).toEqual(['toggleCodeBlock', 'toggleBlockquote'])
    expect(setHeading).not.toHaveBeenCalled()
    ui.update({ ...next, active: {} })
    expect(code.getAttribute('aria-pressed')).toBe('false'); expect(quote.getAttribute('aria-pressed')).toBe('false')
    expect([...bar.children]).toEqual(firstButtons)
  })
  it('T条按显式heading options顺序、标签和禁用项显示，旧标题选择退休后不再执行', () => {
    const setHeading = vi.fn(), options = [{ level: null, label: '文本', glyph: 'T' }, { level: 9, label: '末级章节', glyph: 'H9' }, { level: 4, label: '四级章节', glyph: 'H4', disabled: true }]
    const { ui, next } = accessory({ setHeading }, { heading: { options, level: 9 } })
    ui.el.querySelector('[aria-label="段落类型"]').click()
    const panel = ui.el.querySelector('.lark-doc-mobile-format-panel'), ninth = panel.querySelector('[aria-label="末级章节"]')
    expect([...panel.children].slice(0, 3).map(button => button.textContent)).toEqual(['T', 'H9', 'H4'])
    expect(panel.querySelector('[aria-label="一级标题"]')).toBeNull()
    expect(ninth.getAttribute('aria-pressed')).toBe('true')
    expect(panel.querySelector('[aria-label="四级章节"]').disabled).toBe(true)
    ninth.click(); expect(setHeading).toHaveBeenCalledExactlyOnceWith(9)
    setHeading.mockClear(); ui.update({ ...next, heading: { options: [] } }); ninth.click()
    expect(setHeading).not.toHaveBeenCalled()
    expect(panel.querySelector('[aria-label="末级章节"]')).toBeNull()
  })
  it.each(['readonly', 'feature', 'group'])('T条代码引用在%s关闭后拒绝缓存按钮的late click', gate => {
    const run = vi.fn(), { ui, next } = accessory({ run })
    ui.el.querySelector('[aria-label="段落类型"]').click()
    const code = ui.el.querySelector('.lark-doc-mobile-format-panel [aria-label="代码块"]'), quote = ui.el.querySelector('.lark-doc-mobile-format-panel [aria-label="引用"]')
    expect(code).not.toBeNull(); expect(quote).not.toBeNull()
    ui.update({ ...next, ...(gate === 'readonly' ? { readonly: true } : gate === 'group' ? { groups: { blockStyle: false } } : { features: { codeBlocks: false, blockquote: false } }) })
    code.click(); quote.click()
    expect(run).not.toHaveBeenCalled()
    expect(ui.el.querySelector('.lark-doc-mobile-format-panel [aria-label="代码块"]')).toBeNull()
    expect(ui.el.querySelector('.lark-doc-mobile-format-panel [aria-label="引用"]')).toBeNull()
  })
  it.each(['codeBlock', 'blockquote'])('T条真实Editor %s转换只改选中段，一次Undo恢复；横滚无transaction或选区变动', kind => {
    const editor = new Editor({ extensions: createLarkDocExtensions(), content: { type: 'doc', content: ['前文', '正文'].map((text, index) => ({ type: 'paragraph', attrs: { blockId: `toolbar-block-${index}` }, content: [{ type: 'text', text }] })) } })
    mounted.push(editor)
    const view = editor.view, before = editor.getJSON()
    editor.commands.setTextSelection(editor.state.doc.firstChild.nodeSize + 1)
    const run = vi.fn(command => editor.chain()[command]().run()), { ui } = accessory({ run })
    ui.el.querySelector('[aria-label="段落类型"]').click()
    const panel = ui.el.querySelector('.lark-doc-mobile-format-panel'), originalDoc = editor.state.doc, originalSelection = editor.state.selection
    const transaction = vi.fn(); editor.on('transaction', transaction)
    try {
      panel.scrollLeft = 400; panel.dispatchEvent(new Event('scroll'))
      expect(run).not.toHaveBeenCalled(); expect(transaction).not.toHaveBeenCalled()
      expect(editor.state.doc).toBe(originalDoc); expect(editor.state.selection).toBe(originalSelection)
      panel.querySelector(`[aria-label="${kind === 'codeBlock' ? '代码块' : '引用'}"]`).click()
      expect(run).toHaveBeenCalledExactlyOnceWith(kind === 'codeBlock' ? 'toggleCodeBlock' : 'toggleBlockquote')
      expect(editor.getJSON().content[0]).toEqual(before.content[0])
      expect(editor.getJSON().content[1].type).toBe(kind)
      expect(editor.view).toBe(view)
      expect(editor.commands.undo()).toBe(true)
      expect(editor.getJSON()).toEqual(before)
    } finally { editor.off('transaction', transaction) }
  })

  it('captures selection before plus, hides the keyboard only by explicit action, and respects feature gates', () => {
    const rememberSelection = vi.fn(), openCommandMenu = vi.fn(), hideMobileKeyboard = vi.fn()
    const { ui, next } = accessory({ rememberSelection, openCommandMenu, hideMobileKeyboard })
    const plus = ui.el.querySelector('.lark-doc-mobile-edit-bar [aria-label="插入内容"]')
    plus.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); plus.click()
    expect(rememberSelection).toHaveBeenCalledOnce()
    expect(openCommandMenu).toHaveBeenCalledWith('plus', expect.any(Event))
    const plusIcon = plus.querySelector('.lark-doc-icon')
    expect(plusIcon.style.width).toBe('24px')
    expect(plusIcon.querySelector('svg circle')).not.toBeNull()
    ui.el.querySelector('[aria-label="收起键盘"]').click()
    expect(hideMobileKeyboard).toHaveBeenCalledOnce()
    expect(ui.el.querySelector('.lark-doc-mobile-edit-bar [aria-label="AI 改写"]')).toBeNull()
    ui.update({ ...next, features: { insert: false, ai: false } })
    expect(ui.el.querySelector('.lark-doc-mobile-edit-bar [aria-label="插入内容"]')).toBeNull()
  })
})


describe('native touch block-handle retap', () => {
  async function fixture() {
    const createRange = document.createRange.bind(document)
    vi.spyOn(document, 'createRange').mockImplementation(() => Object.assign(createRange(), {
      getClientRects: () => [], getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }),
    }))
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 852 })
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => Object.assign(new EventTarget(), { matches: true }) })
    const element = document.createElement('div'); document.body.append(element)
    const doc = new LarkDoc({ element, storage: 'none', content: `<p>${'a'.repeat(30)}</p><p>second</p>` })
    mounted.push(doc)
    const editor = doc.getEditor(), host = doc._handle.nativeHost.host, dom = editor.view.dom
    const bounds = { left: 0, right: 393, top: 94, bottom: 852, width: 393, height: 758 }
    host.$refs.root.getBoundingClientRect = () => bounds
    host.$refs.paper.getBoundingClientRect = () => bounds
    for (const node of dom.children) node.getBoundingClientRect = () => ({ left: 44, right: 349, top: 400, bottom: 426, width: 305, height: 26 })
    editor.commands.setTextSelection(28)
    // Drain the original selection-layout frame before arranging an unchanged-selection retap.
    await new Promise(resolve => requestAnimationFrame(resolve))
    host.hideBlockHandle()
    await vi.waitFor(() => expect(element.querySelector('[aria-label="块操作"]')).toBeNull())
    const posAtCoords = vi.spyOn(editor.view, 'posAtCoords').mockReturnValue({ pos: 28, inside: 0 })
    return { doc, editor, host, dom, element, posAtCoords }
  }
  function press(target, properties = {}) {
    const event = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, buttons: 1, button: 0, clientX: 196.5, clientY: 414.5 })
    // JSDOM's MouseEvent constructor truncates coordinates; PointerEvent touch input keeps fractions.
    for (const [key, value] of Object.entries({ pointerType: 'touch', isPrimary: true, clientX: 196.5, clientY: 414.5, ...properties })) Object.defineProperty(event, key, { value })
    target.dispatchEvent(event)
    return event
  }
  it.each([28, 34])('same-selection touch buttons=1 restores the hidden handle from coordinates (%i)', async pos => {
    const { doc, editor, host, dom, element, posAtCoords } = await fixture()
    const body = doc.getJSON(), selection = editor.state.selection, model = editor.state.doc
    posAtCoords.mockReturnValue({ pos, inside: 0 })
    host.scheduleHandleHide()
    const event = press(dom)
    expect(event.defaultPrevented).toBe(false)
    expect(posAtCoords).toHaveBeenCalledWith({ left: 196.5, top: 414.5 })
    expect(host.handleRange).toEqual(host.rangeAt(pos))
    await vi.waitFor(() => expect(element.querySelector('[aria-label="块操作"]')).not.toBeNull())
    await new Promise(resolve => setTimeout(resolve, 240))
    expect(host.handleRange).toEqual(host.rangeAt(pos))
    expect(editor.state.doc).toBe(model)
    expect(editor.state.selection).toBe(selection)
    expect(doc.getJSON()).toEqual(body)
  })
  it.each(['readonly', 'feature', 'drag', 'pressed', 'resize', 'reorder', 'secondary', 'mouse', 'control', 'foreign', 'detached', 'destroy'])('does not restore the handle for a retired or owned gesture (%s)', async kind => {
    const { doc, editor, host, dom, posAtCoords } = await fixture()
    if (kind === 'readonly') doc.setReadonly(true)
    if (kind === 'feature') doc.patchProps({ config: { features: { blockHandle: false } } })
    if (kind === 'drag') host.dragging = {}
    if (kind === 'pressed') host.handlePressed = true
    if (kind === 'resize') host.columnResize = {}
    if (kind === 'reorder') host._tableReorder = {}
    if (kind === 'detached') dom.closest('.lark-doc').remove()
    if (kind === 'destroy') { doc.destroy(); mounted.splice(mounted.indexOf(doc), 1) }
    let target = dom
    if (kind === 'control' || kind === 'foreign') {
      target = document.createElement(kind === 'control' ? 'button' : 'div')
      if (kind === 'foreign') target.className = 'ProseMirror'
      dom.append(target)
    }
    const body = kind === 'destroy' ? null : doc.getJSON(), selection = kind === 'destroy' ? null : editor.state.selection
    press(target, kind === 'secondary' ? { isPrimary: false } : kind === 'mouse' ? { pointerType: 'mouse' } : {})
    expect(posAtCoords).not.toHaveBeenCalled()
    if (target !== dom) target.remove()
    if (kind !== 'destroy') {
      expect(host.handleRange).toBeNull()
      expect(editor.state.selection).toBe(selection)
      expect(doc.getJSON()).toEqual(body)
    }
  })
})


describe('block menu visible viewport bounds', () => {
  it.each([0, 64])('keeps upward first-row controls clear of the viewport and %i px header', headerHeight => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 852 })
    const root = document.createElement('div')
    root.innerHTML = '<header class="lark-doc-topbar"></header><div class="lark-doc-block-handle"><div class="lark-doc-block-menu"></div></div><div class="ProseMirror"></div>'
    document.body.appendChild(root)
    const header = root.querySelector('header'), handle = root.querySelector('.lark-doc-block-handle'), menu = root.querySelector('.lark-doc-block-menu')
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: headerHeight, height: headerHeight })
    vi.spyOn(handle, 'getBoundingClientRect').mockReturnValue({ top: 477.5, bottom: 505.5, left: 4, right: 24, width: 20, height: 28 })
    vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue({ width: 230, height: 469.5 })
    vi.spyOn(menu, 'scrollHeight', 'get').mockReturnValue(543)
    vi.spyOn(root.querySelector('.ProseMirror'), 'getBoundingClientRect').mockReturnValue({ left: 44 })
    const host = { $refs: { root }, $nextTick: fn => fn() }
    blockMenuMixin.methods.positionBlockMenu.call(host, '.lark-doc-block-menu')
    const top = 477.5 + Number.parseFloat(host.blockMenuStyle.top), height = Number.parseFloat(host.blockMenuStyle.maxHeight)
    expect(top).toBeGreaterThanOrEqual(headerHeight + 8)
    expect(top + height).toBeLessThanOrEqual(477.5 - 8)
    expect(height).toBeGreaterThan(32)
    expect(Number.parseFloat(host.blockMenuStyle.left) + 4).toBeGreaterThanOrEqual(8)
  })
})
