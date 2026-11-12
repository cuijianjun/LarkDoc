// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { CellSelection, selectedRect } from '@tiptap/pm/tables'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import tableTools from '../../src/components/lark-doc/editor/tableToolsUiMixin'
import linkTools from '../../src/components/lark-doc/editor/linkToolsUiMixin'
import { createLinkTools } from '../../src/ui/linkTools'
import { serializeMarkdown } from '../../src/utils/export/markdown'
import { sanitizeHTML, validateDocument } from '../../src/core/documentOperations'
import toolbarMenus from '../../src/components/lark-doc/editor/toolbarMenusMixin'
import tableInteraction from '../../src/components/lark-doc/editor/tableInteractionMixin'
import tableCommands from '../../src/components/lark-doc/editor/tableToolsMixin'
import overlayDismiss from '../../src/components/lark-doc/editor/overlayDismissMixin'
import { createTableTools } from '../../src/ui/tableTools'
import { createLinkDialog } from '../../src/ui/dialogs'
import { createCommandMenu } from '../../src/ui/commandMenu'
import { filterCommands } from '../../src/core/commands'
import commandMenu from '../../src/components/lark-doc/editor/commandMenuMixin'
import blockHandleUi from '../../src/components/lark-doc/editor/blockHandleUiMixin'
import viewModes from '../../src/components/lark-doc/editor/viewModesMixin'

const editors = []
function editor(content, config, options = {}) {
  const value = new Editor({ extensions: createLarkDocExtensions({ config, ...options }), content })
  editors.push(value)
  return value
}
afterEach(() => editors.splice(0).forEach(value => value.destroy()))

function hostFor(ed) {
  document.body.appendChild(ed.view.dom)
  const host = { editor: ed, writable: () => true, featureEnabled: () => true }
  Object.entries(linkTools.methods).forEach(([key, method]) => { host[key] = method.bind(host) })
  return host
}

describe('公开LinkEmbed卡片元数据闭环', () => {
  const href = 'https://example.test/page'
  const meta = { title: '网站真实标题', desc: '网站摘要', favicon: 'https://images.example.test/icon.png', cover: 'https://images.example.test/cover.png' }
  const content = (attrs = {}) => ({ type: 'doc', content: [{ type: 'linkEmbed', attrs: { href, view: 'card', blockId: 'public_link_card', ...attrs } }] })
  it('命令保留cardMeta，渲染缓存的标题摘要与媒体，HTML往返不丢失', () => {
    const ed = editor('<p></p>')
    const cardMeta = JSON.stringify(meta)
    expect(ed.commands.setLinkEmbed({ href, view: 'card', title: '原始链接文字', cardMeta })).toBe(true)
    expect(ed.state.doc.firstChild.attrs.cardMeta).toBe(cardMeta)
    expect(ed.view.dom.querySelector('.lark-doc-bookmark-title')?.textContent).toBe(meta.title)
    expect(ed.view.dom.querySelector('.lark-doc-bookmark-summary')?.textContent).toBe(meta.desc)
    expect(ed.view.dom.querySelector('.lark-doc-bookmark-icon')?.style.backgroundImage).toContain(meta.favicon)
    expect(ed.view.dom.querySelector('.lark-doc-bookmark-cover')?.style.backgroundImage).toContain(meta.cover)
    const before = ed.getJSON()
    ed.commands.setContent(ed.getHTML())
    expect(ed.getJSON()).toEqual(before)
  })
  it('可移植HTML保留可点击原地址，仍解析为一个原子块', () => {
    const ed = editor(content({ title: '可读标题', cardMeta: JSON.stringify(meta) }))
    const html = ed.getHTML(), root = document.createElement('div')
    root.innerHTML = html
    const link = root.querySelector('[data-type="link-embed"] a')
    expect(link?.getAttribute('href')).toBe(href)
    expect(link?.getAttribute('target')).toBe('_blank')
    expect(link?.getAttribute('rel')).toContain('noopener')
    expect(link?.textContent.length).toBeGreaterThan(0)
    const restored = editor(html)
    expect(restored.state.doc.firstChild.type.name).toBe('linkEmbed')
    expect(restored.state.doc.firstChild.attrs.cardMeta).toBe(JSON.stringify(meta))
    expect(restored.state.doc.firstChild.childCount).toBe(0)
  })
  it('缓存媒体逐项遵守离线策略，保留纯文字卡片', () => {
    const ed = editor(content({ cardMeta: JSON.stringify(meta) }), { network: { mode: 'offline' } })
    expect(ed.view.dom.querySelector('.lark-doc-bookmark-title')?.textContent).toBe(meta.title)
    expect(ed.view.dom.querySelector('[style*="images.example.test"]')).toBeNull()
    expect(ed.state.doc.firstChild.attrs.cardMeta).toBe(JSON.stringify(meta))
  })
  it('无缓存时通过既有unfurl端口补齐并持久化真实元数据', async () => {
    const unfurl = vi.fn(async () => ({ ok: true, ...meta }))
    const ed = editor(content(), undefined, { unfurlProvider: unfurl })
    await vi.waitFor(() => expect(unfurl).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(JSON.parse(ed.state.doc.firstChild.attrs.cardMeta)?.title).toBe(meta.title))
    expect(ed.view.dom.querySelector('.lark-doc-bookmark-title')?.textContent).toBe(meta.title)
    expect(ed.view.dom.querySelector('.lark-doc-bookmark-cover')?.style.backgroundImage).toContain(meta.cover)
  })
  it.each(['delete', 'readonly', 'cached-override'])('请求等待期间%s不会被旧元数据污染', async action => {
    let finish
    const unfurl = vi.fn(() => new Promise(resolve => { finish = resolve }))
    const ed = editor(content(), undefined, { unfurlProvider: unfurl })
    await vi.waitFor(() => expect(unfurl).toHaveBeenCalledOnce())
    if (action === 'delete') ed.commands.setContent('<p>新的文档正文</p>')
    if (action === 'readonly') ed.setEditable(false)
    if (action === 'cached-override') ed.commands.updateAttributes('linkEmbed', { cardMeta: JSON.stringify({ title: '宿主新元数据' }) })
    const before = ed.getJSON()
    finish({ ok: true, ...meta })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(ed.getJSON()).toEqual(before)
  })
  it('命令拒绝不合法cardMeta且正文不变', () => {
    const ed = editor('<p>保留</p>'), before = ed.getJSON()
    expect(ed.commands.setLinkEmbed({ href, view: 'card', cardMeta: '{invalid' })).toBe(false)
    expect(ed.getJSON()).toEqual(before)
  })
  it('等待抓取时插入前文仍向映射后的原卡片写回', async () => {
    let finish
    const unfurl = vi.fn(() => new Promise(resolve => { finish = resolve }))
    const ed = editor(content(), undefined, { unfurlProvider: unfurl })
    await vi.waitFor(() => expect(unfurl).toHaveBeenCalledOnce())
    ed.commands.insertContentAt(0, '<p>新前文</p>')
    finish({ ok: true, ...meta })
    await vi.waitFor(() => expect(JSON.parse(ed.state.doc.child(1).attrs.cardMeta)?.title).toBe(meta.title))
    expect(ed.state.doc.firstChild.textContent).toBe('新前文')
    expect(ed.state.doc.child(1).attrs.blockId).toBe('public_link_card')
  })
  it.each(['href-update', 'same-type-replace'])('%s后旧地址结果不写入新地址卡片', async action => {
    const jobs = []
    const unfurl = vi.fn(url => new Promise(resolve => { jobs.push({ url, resolve }) }))
    const ed = editor(content(), undefined, { unfurlProvider: unfurl })
    await vi.waitFor(() => expect(jobs.length).toBe(1))
    const nextHref = 'https://new.example.test/page'
    if (action === 'href-update') ed.commands.updateAttributes('linkEmbed', { href: nextHref })
    else ed.commands.setContent(content({ href: nextHref, blockId: 'replacement_card' }))
    await vi.waitFor(() => expect(jobs.length).toBe(2))
    const before = ed.getJSON()
    jobs[0].resolve({ ok: true, ...meta })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(ed.getJSON()).toEqual(before)
    jobs[1].resolve({ ok: true, ...meta, title: '新网址正确标题' })
    await vi.waitFor(() => expect(JSON.parse(ed.state.doc.firstChild.attrs.cardMeta)?.title).toBe('新网址正确标题'))
    expect(ed.state.doc.firstChild.attrs.href).toBe(nextHref)
  })
  it('真实Yjs中插入卡片可独立撤销并保留前一段输入', async () => {
    const { Yjs, createCollabExtensions, isRemoteTransaction } = await import('../../src/collab')
    const ydoc = new Yjs.Doc()
    const ed = editor(undefined, undefined, { collab: { extensions: createCollabExtensions({ ydoc }), isRemoteTransaction } })
    try {
      ed.commands.setContent('<p>既有正文</p>')
      const manager = ed.state.plugins.map(plugin => plugin.getState(ed.state)?.undoManager).find(Boolean)
      manager.clear()
      manager.stopCapturing()
      ed.commands.setTextSelection(ed.state.doc.content.size - 1)
      ed.commands.insertContent(' 前一段输入')
      manager.stopCapturing()
      const before = ed.getJSON()
      expect(ed.commands.setLinkEmbed({ href, view: 'card', cardMeta: JSON.stringify(meta) })).toBe(true)
      expect(manager.undoStack.length).toBe(2)
      expect(ed.commands.undo()).toBe(true)
      expect(ed.getJSON()).toEqual(before)
      expect(ed.commands.redo()).toBe(true)
      expect(ed.state.doc.content.content.some(node => node.type.name === 'linkEmbed')).toBe(true)
    } finally { ed.destroy(); ydoc.destroy() }
  })
})

describe('协同块插入的稳定ID与撤销', () => {
  it.each(['paragraph', 'table', 'bookmark', 'codeBlock'])('%s随业务插入一起撤销和重做，保留前文与稳定ID', async kind => {
    const { Yjs, createCollabExtensions, isRemoteTransaction } = await import('../../src/collab')
    const ydoc = new Yjs.Doc()
    const ed = editor(undefined, undefined, { collab: { extensions: createCollabExtensions({ ydoc }), isRemoteTransaction } })
    try {
      ed.commands.setContent('<p data-block-id="collab_existing">既有正文</p>')
      const manager = ed.state.plugins.map(plugin => plugin.getState(ed.state)?.undoManager).find(Boolean)
      manager.clear()
      ed.commands.setTextSelection(ed.state.doc.content.size - 1)
      ed.commands.insertContent(' 前一段输入')
      manager.stopCapturing()
      const before = ed.getJSON()
      if (kind === 'paragraph') ed.commands.splitBlock()
      if (kind === 'table') ed.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: false })
      if (kind === 'bookmark') ed.commands.setBookmark({ url: 'https://example.test', title: '网站' })
      if (kind === 'codeBlock') ed.commands.setCodeBlock()
      const after = ed.getJSON(), ids = []
      ed.state.doc.descendants(node => { if (node.attrs.blockId) ids.push(node.attrs.blockId) })
      expect(new Set(ids).size).toBe(ids.length)
      expect(manager.undoStack.length).toBe(2)
      expect(ed.commands.undo()).toBe(true)
      expect(ed.getJSON()).toEqual(before)
      expect(ed.commands.redo()).toBe(true)
      expect(ed.getJSON()).toEqual(after)
    } finally { ed.destroy(); ydoc.destroy() }
  })
  it('显式非历史宿主写入及其补ID和尾段都不制造协同撤销记录', async () => {
    const { Yjs, createCollabExtensions, isRemoteTransaction } = await import('../../src/collab')
    const ydoc = new Yjs.Doc()
    const ed = editor(undefined, undefined, { collab: { extensions: createCollabExtensions({ ydoc }), isRemoteTransaction } })
    try {
      ed.commands.setContent('<p data-block-id="collab_host_before">既有正文</p>')
      const manager = ed.state.plugins.map(plugin => plugin.getState(ed.state)?.undoManager).find(Boolean)
      manager.clear()
      const node = ed.schema.nodes.codeBlock.create({ language: 'javascript' }, ed.schema.text('host content'))
      ed.view.dispatch(ed.state.tr.insert(ed.state.doc.content.size, node).setMeta('addToHistory', false))
      expect(manager.undoStack.length).toBe(0)
      expect(ed.getText()).toContain('host content')
      const ids = []
      ed.state.doc.descendants(node => { if (Object.hasOwn(node.attrs, 'blockId')) ids.push(node.attrs.blockId) })
      expect(ids.every(Boolean)).toBe(true)
    } finally { ed.destroy(); ydoc.destroy() }
  })
  it('真实双Y.Doc远端同步不补随机ID、不进入接收端撤销栈', async () => {
    const { Yjs, createCollabExtensions, isRemoteTransaction } = await import('../../src/collab')
    const a = new Yjs.Doc(), b = new Yjs.Doc()
    const first = editor(undefined, undefined, { collab: { extensions: createCollabExtensions({ ydoc: a }), isRemoteTransaction } })
    let second, forward
    try {
      first.commands.setContent('<p data-block-id="shared_existing">协同正文</p>')
      Yjs.applyUpdate(b, Yjs.encodeStateAsUpdate(a), 'peer')
      second = editor(undefined, undefined, { collab: { extensions: createCollabExtensions({ ydoc: b }), isRemoteTransaction } })
      const manager = second.state.plugins.map(plugin => plugin.getState(second.state)?.undoManager).find(Boolean)
      manager.clear()
      const extraWrites = []
      b.on('update', (_update, origin) => { if (origin !== 'peer') extraWrites.push(origin) })
      forward = update => Yjs.applyUpdate(b, update, 'peer')
      a.on('update', forward)
      first.commands.setTextSelection(first.state.doc.content.size - 1)
      first.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: false })
      await vi.waitFor(() => expect(second.getJSON()).toEqual(first.getJSON()))
      expect(manager.undoStack.length).toBe(0)
      expect(extraWrites).toHaveLength(0)
    } finally {
      if (forward) a.off('update', forward)
      first.destroy(); second?.destroy(); a.destroy(); b.destroy()
    }
  })
})

describe('斜杠菜单视口边界', () => {
  it.each([
    { top: 860, bottom: 886, above: true },
    { top: 940, bottom: 966, above: true },
    { top: 400, bottom: 426, above: false },
  ])('光标 top=$top 处保持菜单可见且空间不足时向上展开', ({ top, bottom, above }) => {
    const height = window.innerHeight
    const root = document.createElement('div'), menu = document.createElement('div')
    menu.className = 'lark-doc-command-menu'
    root.appendChild(menu)
    menu.getBoundingClientRect = () => ({ width: 232, height: 82 })
    Object.defineProperty(menu, 'scrollHeight', { value: 82 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 })
    const host = { menuOpen: true, menuKind: 'slash', menuAnchor: { left: 500, top, bottom }, slashMatch: { from: 1 },
      editor: { view: { coordsAtPos: () => ({ left: 500, top, bottom }) } }, $refs: { root } }
    try {
      commandMenu.methods.positionCommandMenu.call(host)
      expect(host.menuPosition.top).toBeGreaterThanOrEqual(8)
      expect(host.menuPosition.top + host.menuMaxHeight).toBeLessThanOrEqual(892)
      expect(host.menuMaxHeight).toBe(82)
      if (above) expect(host.menuPosition.top + host.menuMaxHeight).toBeLessThan(top)
      else expect(host.menuPosition.top).toBe(bottom + 6)
    } finally { Object.defineProperty(window, 'innerHeight', { configurable: true, value: height }) }
  })
})

describe('v12e link and cell interactions', () => {
  it('keeps the table size picker only in the global plus menu', () => {
    expect(filterCommands('', 'plus').find(item => item.id === 'table')?.submenuType).toBe('table')
    expect(filterCommands('', 'slash').find(item => item.id === 'table')?.submenu).toBeUndefined()
    const cell = filterCommands('', 'plus', null, 'cell')
    expect(cell.some(item => ['table', 'template'].includes(item.id))).toBe(false)
    expect(cell.some(item => item.id === 'inlineMath')).toBe(true)
    expect(filterCommands('', 'plus', { features: { tables: false } }).some(item => item.id === 'table')).toBe(false)
  })

  it('renders source plus icon slots and common aliases as separate stable buttons', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const menu = createCommandMenu({ host })
    const state = { open: true, kind: 'plus', items: filterCommands('', 'plus') }
    menu.update(state)
    const basic = menu.el.querySelector('[data-category="基础"]')
    expect([...basic.querySelectorAll('button')].map(button => button.dataset.commandId)).toEqual(['heading1', 'heading2', 'heading3', 'orderedList', 'bulletList', 'taskList', 'code', 'blockquote', 'callout', 'divider', 'link'])
    const tasks = [...menu.el.querySelectorAll('[data-command-id="taskList"]')]
    expect(tasks).toHaveLength(2)
    expect(tasks[0]).not.toBe(tasks[1])
    expect(basic.querySelectorAll('svg')).toHaveLength(11)
    menu.update({ ...state, activeId: 'taskList' })
    expect([...menu.el.querySelectorAll('[data-command-id="taskList"]')]).toEqual(tasks)
    menu.destroy(); host.remove()
  })

  it('previews and inserts a selected 9x9 plus table size with keyboard access', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const choose = vi.fn()
    const menu = createCommandMenu({ host, handlers: { onChoose: choose } })
    menu.update({ open: true, kind: 'plus', items: filterCommands('', 'plus') })
    menu.el.querySelector('[data-command-id="table"]').dispatchEvent(new MouseEvent('mouseenter'))
    const grid = menu.el.querySelector('.lark-doc-table-submenu-grid')
    expect(grid?.querySelectorAll('button')).toHaveLength(81)
    const cell = grid.querySelector('[data-row="2"][data-col="3"]')
    cell.focus()
    expect(menu.el.querySelector('.lark-doc-submenu-picker-head output').textContent).toBe('3 x 2')
    expect(grid.querySelectorAll('.is-preview')).toHaveLength(6)
    cell.click()
    expect(choose).toHaveBeenCalledWith({ id: 'table', tableSize: { rows: 2, cols: 3 } })
    menu.destroy(); host.remove()
  })

  it('closes a stale picker after disabling, allowlisting or entering a cell', () => {
    const host = document.createElement('div'); document.body.appendChild(host)
    const menu = createCommandMenu({ host })
    for (const items of [filterCommands('', 'plus', { commands: { disabled: ['table'] } }), filterCommands('', 'plus', { commands: { allow: ['image'] } }), filterCommands('', 'plus', null, 'cell')]) {
      menu.update({ open: true, kind: 'plus', items: filterCommands('', 'plus') })
      menu.el.querySelector('[data-command-id="table"]').dispatchEvent(new MouseEvent('mouseenter'))
      expect(menu.submenuEl).not.toBeNull()
      menu.update({ items })
      expect(menu.submenuEl).toBeNull()
    }
    menu.destroy(); host.remove()
  })

  it.each([{ commands: { disabled: ['table'] } }, { commands: { allow: ['image'] } }, { features: { tables: false } }])('rejects a stale table-size command after policy changes: %j', larkDocConfig => {
    const host = { writable: () => true, larkDocConfig, featureEnabled: name => larkDocConfig.features?.[name] !== false, insertTable: vi.fn(), closeCommandMenu: vi.fn(), menuKind: 'plus', filteredCommands: filterCommands('', 'plus', larkDocConfig), restoreSelection: vi.fn() }
    commandMenu.methods.chooseCommand.call(host, { id: 'table', tableSize: { rows: 3, cols: 4 } })
    expect(host.insertTable).not.toHaveBeenCalled()
    expect(host.restoreSelection).not.toHaveBeenCalled()
  })

  function tableHost(ed) {
    const host = hostFor(ed)
    for (const mixin of [tableCommands, tableInteraction, tableTools]) {
      Object.entries(mixin.methods).forEach(([key, method]) => { host[key] = method.bind(host) })
    }
    host.refreshTableUiVisibility = vi.fn()
    host.$nextTick = () => {}
    host.activeTableElement = () => ed.view.dom.querySelector('table')
    return host
  }

  const tableHTML = '<table><tr><td><p>A</p></td><td><p>B</p></td><td><p>C</p></td></tr><tr><td><p>D</p></td><td><p>E</p></td><td><p>F</p></td></tr></table>'

  it('inserts the Feishu default table with 100px columns as one undoable change', () => {
    const ed = editor('<p>keep me</p><p></p>')
    ed.commands.setTextSelection(ed.state.doc.content.size - 1)
    expect(ed.commands.insertLarkDocTable()).toBe(true)
    let table
    ed.state.doc.descendants(node => { if (node.type.name === 'table') table = node })
    expect(table.childCount).toBe(2)
    expect(table.firstChild.childCount).toBe(3)
    table.descendants(node => { if (node.type.name === 'tableCell') expect(node.attrs.colwidth).toEqual([100]) })
    expect(ed.commands.undo()).toBe(true)
    expect(ed.getHTML()).not.toContain('<table')
    expect(ed.state.doc.textContent).toBe('keep me')
    expect(ed.commands.redo()).toBe(true)
    expect(ed.view.dom.querySelectorAll('col')).toHaveLength(3)
    expect(ed.commands.insertLarkDocTable({ rows: 4, cols: 2 })).toBe(true)
    const $from = ed.state.selection.$from
    let inserted
    for (let depth = $from.depth; depth > 0; depth -= 1) if ($from.node(depth).type.name === 'table') { inserted = $from.node(depth); break }
    expect(inserted.childCount).toBe(4)
    expect(inserted.firstChild.childCount).toBe(2)
  })

  it('opens the real table block menu from the toolbar and closes it on the next click', () => {
    const host = { writable: () => true, featureEnabled: () => true, isActive: () => true, currentBlockRange: () => ({ from: 0, to: 50 }), positionBlockHandle: vi.fn(), openBlockMenu: vi.fn(), closeBlockMenu: vi.fn(), blockMenuOpen: false }
    tableCommands.methods.onTableToolbarClick.call(host)
    expect(host.positionBlockHandle).toHaveBeenCalledWith({ from: 0, to: 50 })
    expect(host.openBlockMenu).toHaveBeenCalledOnce()
    host.blockMenuOpen = true
    host.handleIsTable = true
    tableCommands.methods.onTableToolbarClick.call(host)
    expect(host.closeBlockMenu).toHaveBeenCalledOnce()
    host.isActive = () => false
    host.insertTable = vi.fn()
    tableCommands.methods.onTableToolbarClick.call(host)
    expect(host.insertTable).toHaveBeenCalledOnce()
  })

  it('keeps the own table trigger state until its click can close the open menu', () => {
    const root = document.createElement('div')
    root.innerHTML = '<div class="lark-doc-toolbar"><button aria-label="表格工具"><span>table</span></button></div>'
    const host = { $refs: { root }, blockMenuOpen: true, closeBlockMenu: vi.fn(), headingNumberMenu: { open: false } }
    overlayDismiss.methods.onDocumentPointerDown.call(host, { target: root.querySelector('span') })
    expect(host.closeBlockMenu).not.toHaveBeenCalled()
    const otherRoot = root.cloneNode(true)
    overlayDismiss.methods.onDocumentPointerDown.call(host, { target: otherRoot.querySelector('span') })
    expect(host.closeBlockMenu).toHaveBeenCalledOnce()
  })

  it.each(['row', 'column'])('focuses the new %s after an external insertion moves the hovered cell', axis => {
    const ed = editor('<p>before</p>' + tableHTML)
    const host = tableHost(ed)
    host.run = (name, ...args) => ed.commands[name](...args)
    host.$nextTick = fn => fn()
    const root = document.createElement('div')
    root.innerHTML = '<div class="lark-doc-paper"></div>'
    root.appendChild(ed.view.dom)
    host.$refs = { root }
    const table = ed.view.dom.querySelector('table')
    table.getBoundingClientRect = () => ({ left: 100, top: 100, right: 400, bottom: 260, width: 300, height: 160 })
    const cell = table.rows[1].cells[0]
    cell.getBoundingClientRect = () => ({ left: 100, top: 140, right: 200, bottom: 180, width: 100, height: 40 })
    host._tableBoundaryHoverCell = cell
    host._tableBoundaryHoverTable = table
    host.tableBoundary = { visible: true, hover: axis, rowIndex: 1, columnIndex: 0, rowSpan: 1, columnSpan: 1, style: {} }
    host.updateTableBoundary(table)
    ed.commands.setTextSelection(ed.view.posAtDOM(table.rows[0].cells[0].querySelector('p'), 0))
    ed.commands[axis === 'row' ? 'addRowBefore' : 'addColumnBefore']()
    ed.commands.setTextSelection(1)
    host.updateTableBoundary(table)
    expect(host.tableBoundary[axis === 'row' ? 'rowIndex' : 'columnIndex']).toBe(axis === 'row' ? 2 : 1)
    host.tableBoundaryAction(axis === 'row' ? 'addRowAfter' : 'addColumnAfter')
    const rect = selectedRect(ed.state)
    expect(axis === 'row' ? rect.top : rect.left).toBe(axis === 'row' ? 3 : 2)
    expect(ed.state.selection.$from.parent.textContent).toBe('')
  })

  it('keeps cell conversions within the source menu and preserves text for unsupported types', () => {
    const ed = editor(tableHTML)
    const host = tableHost(ed)
    host.run = (name, ...args) => ed.commands[name]?.(...args)
    ed.commands.setTextSelection({ from: 4, to: 5 })
    const before = ed.getJSON()
    for (const type of ['synced', 'callout', 'blockquote', 'unknown']) {
      expect(host.tableToolbarCommand('turninto', type)).toBe(false)
      expect(ed.getJSON()).toEqual(before)
    }
    expect(host.tableToolbarCommand('turninto', 'heading9')).toBe(true)
    expect(ed.isActive('heading', { level: 9 })).toBe(true)
    expect(ed.state.doc.textContent).toBe('ABCDEF')
    const ui = createTableTools({ host: document.body })
    ui.update({ open: true, cellKind: 'text', blockType: 'heading9' })
    ui.el.querySelector('[data-cmd="turninto"]').dispatchEvent(new MouseEvent('mouseenter'))
    expect(ui.el.querySelector('[data-value="synced"]')).toBeNull()
    const other = ui.el.querySelector('[data-value="other-headings"]')
    expect(other).toBeTruthy()
    other.focus()
    expect(other.getAttribute('aria-expanded')).toBe('true')
    expect(ui.el.querySelector('[data-value="heading9"]').getAttribute('aria-pressed')).toBe('true')
    ui.destroy()
  })

  it('reads alignment from the current cells after formatting, switching cells, undo and mixed selection', () => {
    const ed = editor(tableHTML)
    const host = tableHost(ed)
    host.larkDocConfig = { features: { tables: true } }
    host.tableTextAnchor = host.tableToolbarAnchor = () => ({ x: 100, y: 100 })
    host.cellAlignState = { textAlign: '', verticalAlign: '' }
    host.setAlign = value => ed.commands.setTextAlign(value)
    host.applyCellAlign = (key, value) => { ed.commands.setCellAttribute(key, value); host.cellAlignState[key] = value }
    const select = index => {
      const p = ed.view.dom.querySelectorAll('td p')[index]
      const from = ed.view.posAtDOM(p, 0)
      ed.commands.setTextSelection({ from, to: from + 1 })
    }
    select(0)
    host.tableToolbarCommand('align', 'align:center')
    host.tableToolbarCommand('align', 'valign:bottom')
    expect(host.buildTableToolsState()).toMatchObject({ textAlign: 'center', verticalAlign: 'bottom' })
    select(1)
    expect(host.buildTableToolsState()).toMatchObject({ textAlign: 'left', verticalAlign: 'top' })
    ed.commands.undo()
    select(0)
    expect(host.buildTableToolsState()).toMatchObject({ textAlign: 'left', verticalAlign: 'top' })
    ed.commands.redo()
    host.onTableSelectLine('column', 0)
    const mixed = host.buildTableToolsState()
    expect(mixed).toMatchObject({ textAlign: null, verticalAlign: null })
    const ui = createTableTools({ host: document.body })
    ui.update(mixed)
    ui.el.querySelector('[data-cmd="align"]').dispatchEvent(new MouseEvent('mouseenter'))
    expect(ui.el.querySelectorAll('[role="menuitem"][aria-pressed="true"]')).toHaveLength(0)
    select(0)
    ui.update(host.buildTableToolsState())
    expect(ui.el.querySelector('[data-value="align:center"]').getAttribute('aria-pressed')).toBe('true')
    ui.destroy()
  })

  it.each(['Delete', 'Backspace'])('clears a selected column with %s without deleting its structure', key => {
    const ed = editor(tableHTML)
    const host = tableHost(ed)
    host.onTableSelectLine('column', 1)
    const event = new KeyboardEvent('keydown', { key, cancelable: true })
    Object.defineProperty(event, 'target', { value: ed.view.dom })
    host.onTableDeleteKeyDown(event)
    expect(ed.state.doc.firstChild.firstChild.childCount).toBe(3)
    expect(ed.state.doc.textContent).toBe('ACDF')
    expect(event.defaultPrevented).toBe(true)
  })

  it('extends column selection from the original Shift anchor and exposes multi-column actions', () => {
    const ed = editor(tableHTML)
    const host = tableHost(ed)
    host.onTableSelectLine('column', 0)
    host.onTableSelectLine('column', 2, { shiftKey: true })
    expect(selectedRect(ed.state)).toMatchObject({ left: 0, right: 3, top: 0, bottom: 2 })
    host.onTableSelectLine('column', 1, { shiftKey: true })
    expect(selectedRect(ed.state)).toMatchObject({ left: 0, right: 2 })
    expect(host.tableCellSelectionKind(ed.state.selection)).toBe('columns')
    const ui = createTableTools({ host: document.body })
    ui.update({ open: true, cellKind: 'columns' })
    expect(ui.el.querySelector('[data-cmd="distributeColumns"]')).toBeTruthy()
    expect(ui.el.querySelector('[data-cmd="remove"]')).toBeTruthy()
    expect(ui.el.querySelector('[data-cmd="table-header"]')).toBeNull()
    ui.destroy()
    expect(host.deleteSelectedTableLine()).toBe(true)
    expect(ed.state.doc.firstChild.firstChild.childCount).toBe(1)
    expect(ed.state.doc.textContent).toBe('CF')
  })

  it('averages only the selected logical columns and preserves other widths across a spanning cell', () => {
    const ed = editor('<table><tr><td colwidth="100"><p>A</p></td><td colwidth="200"><p>B</p></td><td colwidth="300"><p>C</p></td></tr><tr><td colspan="2" colwidth="100,200"><p>D</p></td><td colwidth="300"><p>E</p></td></tr></table>')
    const host = tableHost(ed)
    host.onTableSelectLine('column', 0)
    host.onTableSelectLine('column', 1, { shiftKey: true })
    expect(host.distributeColumns()).toBe(true)
    const table = ed.state.doc.firstChild
    expect(table.child(0).child(0).attrs.colwidth).toEqual([150])
    expect(table.child(0).child(1).attrs.colwidth).toEqual([150])
    expect(table.child(0).child(2).attrs.colwidth).toEqual([300])
    expect(table.child(1).child(0).attrs.colwidth).toEqual([150, 150])
    expect(table.child(1).child(1).attrs.colwidth).toEqual([300])
  })

  it('keeps row selectors reachable when the floating toolbar cannot fit beside the table', () => {
    const ui = createTableTools({ host: document.body })
    ui.el.getBoundingClientRect = () => ({ width: 640, height: 42 })
    ui.update({ open: true, cellKind: 'line', anchor: { x: 530, y: 190, fallbackX: 700, fallbackY: 150, placement: 'left' } })
    expect(parseFloat(ui.el.style.top) + 42).toBeLessThanOrEqual(150)
    expect(parseFloat(ui.el.style.left)).toBeGreaterThanOrEqual(8)
    ui.destroy()
  })

  it('uses direct first-line header and merge/split actions without inventing submenus', () => {
    const ed = editor(tableHTML)
    const host = tableHost(ed)
    host.onTableSelectLine('column', 0)
    host.tableToolbarCommand('table-header')
    expect(ed.state.doc.firstChild.firstChild.firstChild.type.name).toBe('tableHeader')
    host.tableToolbarCommand('merge-cell')
    expect(ed.state.doc.firstChild.firstChild.firstChild.attrs.rowspan).toBe(2)
    host.tableToolbarCommand('merge-cell')
    expect(ed.state.doc.firstChild.firstChild.firstChild.attrs.rowspan).toBe(1)
    const picked = vi.fn()
    const ui = createTableTools({ host: document.body, handlers: { onCommand: picked } })
    ui.update({ open: true, cellKind: 'line', headerAxis: 'column', cellSelection: true, canMerge: true })
    ui.el.querySelector('[data-cmd="table-header"]').click()
    expect(picked).toHaveBeenCalledWith('table-header', null)
    expect(ui.el.querySelector('[role="menu"]')).toBeNull()
    ui.update({ open: true, cellKind: 'line', headerAxis: null, cellSelection: true, canMerge: true })
    expect(ui.el.querySelector('[data-cmd="table-header"]')).toBeNull()
    ui.destroy()
  })

  it('keeps command restrictions on direct header and merge actions', () => {
    const ed = editor(tableHTML)
    const host = tableHost(ed)
    host.larkDocConfig = { commands: { disabled: ['toggleHeaderColumn', 'mergeCells'] } }
    host.onTableSelectLine('column', 0)
    const before = ed.state.doc
    expect(host.tableToolbarCommand('table-header')).toBe(false)
    expect(host.tableToolbarCommand('merge-cell')).toBe(false)
    expect(ed.state.doc).toBe(before)
  })

  it('matches link form confirmation eligibility for blank text and unsafe protocols', () => {
    const ui = createLinkDialog({ host: document.body })
    ui.update({ open: true, text: '', value: 'https://example.com' })
    expect(ui.el.querySelector('button').disabled).toBe(false)
    ui.update({ text: 'text', value: 'javascript:alert(1)' })
    expect(ui.el.querySelector('button').disabled).toBe(true)
    ui.destroy()
  })

  it('allows scrolling and exposes eight preview resize handles', () => {
    const ed = editor({ type: 'doc', content: [{ type: 'linkEmbed', attrs: { href: 'https://example.com', view: 'preview' } }] })
    const frame = ed.view.dom.querySelector('iframe')
    expect(frame.style.pointerEvents).not.toBe('none')
    expect(ed.view.dom.querySelectorAll('.lark-doc-link-preview-resize')).toHaveLength(8)
  })

  it('bounds preview resize to the document width and right-aligns only overwide previews', async () => {
    const ed = editor({ type: 'doc', content: [{ type: 'linkEmbed', attrs: { href: 'https://example.com', view: 'preview' } }] })
    let contentWidth = 600
    Object.defineProperty(ed.view.dom, 'clientWidth', { configurable: true, get: () => contentWidth })
    const body = ed.view.dom.querySelector('.lark-doc-link-preview-body')
    const frame = body.querySelector('iframe')
    frame.getBoundingClientRect = () => ({ width: contentWidth, height: contentWidth * 0.562 })
    frame.dispatchEvent(new Event('load'))
    expect(body.style.maxWidth).toBe('762px')
    expect(parseFloat(body.style.height)).toBeCloseTo(337.2)
    ed.commands.updateAttributes('linkEmbed', { width: 740 })
    expect(body.parentElement.style.justifyContent).toBe('flex-end')
    ed.commands.updateAttributes('linkEmbed', { width: 580 })
    expect(body.parentElement.style.justifyContent).toBe('center')
    contentWidth = 400
    window.dispatchEvent(new Event('resize'))
    await vi.waitFor(() => expect(body.style.width).toBe('508px'))
    expect(body.style.maxWidth).toBe('508px')
    expect(ed.state.doc.firstChild.attrs.width).toBe(580)
  })

  it.each(['inline', 'card', 'preview'])('copies a real document anchor for %s and keeps original-URL copying distinct', async kind => {
    const href = 'https://www.barenkeji.com'
    const ed = editor(kind === 'inline' ? `<p data-block-id="link-inline"><a href="${href}">Example</a></p>` : { type: 'doc', content: [{ type: kind === 'card' ? 'bookmark' : 'linkEmbed', attrs: kind === 'card' ? { url: href, blockId: 'link-card' } : { href, view: 'preview', blockId: 'link-preview' } }] })
    const host = hostFor(ed)
    host.shareDocumentLink = () => 'https://docs.example.com/document?view=edit#old'
    host.copyShareText = vi.fn().mockResolvedValue(true)
    const element = ed.view.dom.querySelector(kind === 'inline' ? 'a' : kind === 'card' ? '[data-type="bookmark"]' : '[data-type="link-embed"]')
    const target = host.linkTargetAt(element)
    host._linkTarget = target
    const blockId = ed.state.doc.firstChild.attrs.blockId
    expect(await host.copyHoveredLink('rich')).toBe(true)
    expect(host.copyShareText).toHaveBeenLastCalledWith(`https://docs.example.com/document?view=edit#share-${blockId}`)
    host._linkTarget = target
    expect(await host.copyHoveredLink('url')).toBe(true)
    expect(host.copyShareText).toHaveBeenLastCalledWith(href)
    host._linkTarget = target
    ed.commands.insertContent('changed')
    expect(await host.copyHoveredLink('rich')).toBe(false)
    expect(host.copyShareText).toHaveBeenCalledTimes(2)
  })

  it('does not close a newer link target when an earlier clipboard write settles', async () => {
    const ed = editor('<p data-block-id="link-context"><a href="https://example.com">A</a> <a href="https://example.org">B</a></p>')
    const host = hostFor(ed)
    host.shareDocumentLink = () => 'https://docs.example.com/document'
    let resolve
    host.copyShareText = () => new Promise(done => { resolve = done })
    host.showShareToast = vi.fn()
    const targets = [...ed.view.dom.querySelectorAll('a')].map(anchor => host.linkTargetAt(anchor))
    host._linkTarget = targets[0]
    const copy = host.copyHoveredLink('rich')
    host._linkTarget = targets[1]
    resolve(true)
    expect(await copy).toBe(true)
    expect(host._linkTarget).toBe(targets[1])
    expect(host.showShareToast).not.toHaveBeenCalled()
    host.copyShareText = async () => false
    expect(await host.copyHoveredLink('url')).toBe(false)
    expect(host.error).toContain('复制失败')
    expect(host._linkTarget).toBe(targets[1])
  })

  it('preserves an explicitly restrictive host sandbox and allow policy for previews', () => {
    const ed = new Editor({ extensions: createLarkDocExtensions({ embedSandbox: 'allow-scripts', embedAllow: 'fullscreen' }), content: { type: 'doc', content: [{ type: 'linkEmbed', attrs: { href: 'https://example.com', view: 'preview' } }] } })
    editors.push(ed)
    expect(ed.view.dom.querySelector('iframe').getAttribute('sandbox')).toBe('allow-scripts')
    expect(ed.view.dom.querySelector('iframe').getAttribute('allow')).toBe('fullscreen')
  })

  it('returns keyboard focus to the editor when preview resizing starts outside the editor', () => {
    const ed = editor({ type: 'doc', content: [{ type: 'linkEmbed', attrs: { href: 'https://example.com', view: 'preview' } }] })
    const fixture = document.createElement('div')
    fixture.innerHTML = '<button>outside</button>'
    fixture.appendChild(ed.view.dom)
    document.body.appendChild(fixture)
    try {
      fixture.querySelector('button').focus()
      ed.view.dom.querySelector('.lark-doc-link-preview-resize.is-e').dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 820, clientY: 200, bubbles: true }))
      expect(document.activeElement).toBe(ed.view.dom)
    } finally {
      window.dispatchEvent(new Event('pointercancel'))
      fixture.remove()
    }
  })

  it('persists independently resized dimensions, restores them through HTML, and supports undo', () => {
    const ed = editor({ type: 'doc', content: [{ type: 'linkEmbed', attrs: { href: 'https://example.com', view: 'preview' } }] })
    const body = ed.view.dom.querySelector('.lark-doc-link-preview-body')
    body.getBoundingClientRect = () => ({ width: 820, height: 461 })
    body.querySelector('.is-e').dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 820, clientY: 230, bubbles: true }))
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 700, clientY: 230 }))
    window.dispatchEvent(new MouseEvent('pointerup'))
    expect(ed.state.doc.firstChild.attrs).toMatchObject({ width: 580, height: 461 })
    const copy = editor(sanitizeHTML(ed.getHTML()))
    expect(copy.state.doc.firstChild.attrs).toMatchObject({ width: 580, height: 461 })
    expect(ed.commands.undo()).toBe(true)
    expect(ed.state.doc.firstChild.attrs.width).toBeNull()
  })

  it('validates and reloads a tall resized preview through the public JSON gate', () => {
    const ed = editor('<p>text</p>')
    ed.commands.setLinkEmbed({ href: 'https://example.com', view: 'preview', width: 580, height: 3000 })
    const json = ed.getJSON()
    expect(() => validateDocument(json, ed.schema)).not.toThrow()
    expect(editor(json).state.doc.firstChild.attrs).toMatchObject({ width: 580, height: 3000 })
    expect(ed.commands.setLinkEmbed({ href: 'https://example.com', view: 'preview', height: 4001 })).toBe(false)
  })

  it.each(['readonly', 'disabled'])('does not fill a pending title after switching to %s', async mode => {
    let resolve
    const ed = new Editor({ extensions: createLarkDocExtensions({ unfurlProvider: () => new Promise(done => { resolve = done }) }), content: '<p><a href="http://www.a.com">http://www.a.com</a></p>' })
    editors.push(ed)
    const host = hostFor(ed)
    host._linkTarget = host.linkTargetAt(ed.view.dom.querySelector('a'))
    host.setLinkEmbedView('title')
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    if (mode === 'readonly') ed.setEditable(false)
    else host.larkDocConfig = { commands: { disabled: ['setLink'] } }
    const before = ed.state.doc
    resolve({ title: 'Late title' })
    await new Promise(done => setTimeout(done, 0))
    expect(ed.state.doc).toBe(before)
  })

  it('updates edited raw URL labels into title view and falls back to the URL for blank text', () => {
    const ed = editor('<p><a href="http://www.a.com">http://www.a.com</a></p>')
    const host = hostFor(ed)
    host._linkTarget = host.linkTargetAt(ed.view.dom.querySelector('a'))
    host.editHoveredLink()
    host.linkText = '自定义文字'
    expect(host.updateHoveredLink()).toBe(true)
    let target = host.linkTargetAt(ed.view.dom.querySelector('a'))
    expect(target).toMatchObject({ view: 'title', title: '自定义文字' })
    host._linkTarget = target
    host.editHoveredLink()
    host.linkText = ''
    host.linkValue = 'www.a.com'
    expect(host.updateHoveredLink()).toBe(true)
    target = host.linkTargetAt(ed.view.dom.querySelector('a'))
    expect(target).toMatchObject({ view: 'link', title: 'http://www.a.com', href: 'http://www.a.com' })
  })

  it('resolves a pending webpage title without overwriting later user edits', async () => {
    let resolve
    const ed = new Editor({ extensions: createLarkDocExtensions({ unfurlProvider: () => new Promise(done => { resolve = done }) }), content: '<p><a href="https://example.com">https://example.com</a></p>' })
    editors.push(ed)
    const host = hostFor(ed)
    host._linkTarget = host.linkTargetAt(ed.view.dom.querySelector('a'))
    host.setLinkEmbedView('title')
    expect(ed.state.doc.textContent).toBe('example.com')
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    resolve({ title: 'Website title', preview: false })
    await vi.waitFor(() => expect(ed.state.doc.textContent).toBe('Website title'))
    expect(ed.view.dom.querySelector('a').getAttribute('href')).toBe('https://example.com')
  })

  it('persists card metadata through HTML and uses the webpage title when leaving block views', () => {
    const href = 'https://example.com'
    const cover = 'https://example.com/cover.png'
    const ed = editor({ type: 'doc', content: [{ type: 'bookmark', attrs: { url: href, title: 'Site title', linkTitle: '原始文字', cover } }] })
    const host = hostFor(ed)
    expect(ed.view.dom.querySelector('.lark-doc-bookmark-cover')?.style.backgroundImage).toContain(cover)
    const html = ed.getHTML()
    ed.commands.setContent(sanitizeHTML(html))
    expect(ed.state.doc.firstChild.attrs.cover).toBe(cover)
    for (const kind of ['preview', 'title', 'card']) {
      host._linkTarget = host.linkTargetAt(ed.view.dom.querySelector('[data-type="bookmark"], [data-type="link-embed"], a'))
      expect(host.setLinkEmbedView(kind)).toBe(true)
      if (kind === 'title') expect(ed.state.doc.textContent).toBe('Site title')
    }
    expect(ed.state.doc.firstChild.attrs.cover).toBe(cover)
    expect(ed.state.doc.firstChild.attrs.title).toBe('Site title')
  })

  it('fetches site metadata through a function provider when switching a titled inline link to a card', async () => {
    const cover = 'https://example.com/cover.png'
    const unfurl = vi.fn(async () => ({ title: 'Site title', cover }))
    const ed = new Editor({ extensions: createLarkDocExtensions({ unfurlProvider: unfurl }), content: '<p><a href="https://example.com">原始文字</a></p>' })
    editors.push(ed)
    const host = hostFor(ed)
    host._linkTarget = host.linkTargetAt(ed.view.dom.querySelector('a'))
    host.setLinkEmbedView('card')
    await vi.waitFor(() => expect(ed.state.doc.firstChild.attrs.cover).toBe(cover))
    expect(unfurl).toHaveBeenCalledTimes(1)
    expect(ed.state.doc.firstChild.attrs.title).toBe('Site title')
    expect(ed.state.doc.firstChild.attrs.linkTitle).toBe('原始文字')
  })

  it('rejects a card conversion whose original link text cannot survive the JSON and HTML limit', () => {
    const unfurl = vi.fn(async () => ({ title: 'Site' }))
    const ed = new Editor({ extensions: createLarkDocExtensions({ unfurlProvider: unfurl }), content: `<p><a href="https://example.com">${'😀'.repeat(50001)}</a></p>` })
    editors.push(ed)
    const host = hostFor(ed)
    host._linkTarget = host.linkTargetAt(ed.view.dom.querySelector('a'))
    expect(host.setLinkEmbedView('card')).toBe(false)
    expect(ed.state.doc.firstChild.type.name).toBe('paragraph')
    expect(unfurl).not.toHaveBeenCalled()
  })

  it.each(['offline', 'allowlist'])('keeps a stored cover but creates no off-policy image in %s mode', mode => {
    const cover = 'https://tracker.invalid/cover.png'
    const ed = editor({ type: 'doc', content: [{ type: 'bookmark', attrs: { url: 'https://example.com', title: 'Site', cover } }] }, { network: { mode, allowlist: ['example.com'] } })
    expect(ed.getHTML()).toContain('data-cover=')
    expect(ed.view.dom.querySelector('.lark-doc-bookmark-cover')).toBeNull()
  })

  it('registers a persistent link block with a safe command and stable block ID', () => {
    const ed = editor('<p>text</p>')
    expect(typeof ed.commands.setLinkEmbed).toBe('function')
    expect(ed.commands.setLinkEmbed({ href: 'javascript:alert(1)' })).toBe(false)
    expect(ed.commands.setLinkEmbed({ href: 'https://example.com', title: 'Example', view: 'card' })).toBe(true)
    ed.commands.ensureLarkDocBlockIds()
    const block = ed.getJSON().content.find(node => node.type === 'linkEmbed')
    expect(block.attrs.blockId).toBeTruthy()
    expect(ed.view.dom.querySelector('[data-type="link-embed"] [role="link"]')).toBeTruthy()
  })

  it('does not create external preview resources under offline policy', () => {
    const ed = editor({ type: 'doc', content: [{ type: 'linkEmbed', attrs: { href: 'https://example.com', view: 'preview' } }] }, { network: { mode: 'offline' } })
    expect(ed.view.dom.querySelector('iframe, img')).toBeNull()
    expect(ed.view.dom.textContent).toContain('example.com')
  })

  it('rebuilds a legacy link block into the shared preview shell and settles at the measured aspect', () => {
    const ed = editor({ type: 'doc', content: [{ type: 'linkEmbed', attrs: { href: 'https://example.com', title: 'Example', view: 'card' } }] })
    ed.commands.setNodeSelection(0)
    ed.commands.updateAttributes('linkEmbed', { view: 'preview' })
    expect(ed.view.dom.querySelector('iframe')).toBeTruthy()
    expect(ed.view.dom.querySelector('.iframe-container').style.height).toBe('1000px')
    ed.view.dom.querySelector('iframe').dispatchEvent(new Event('load'))
    expect(parseFloat(ed.view.dom.querySelector('.iframe-container').style.height)).toBeCloseTo(820 * 0.562)
    expect(ed.view.dom.querySelector('[data-type="link-embed"] > a')).toBeNull()
  })

  it.each(['offline', 'allowlist'])('blocks off-policy card icons from sanitized HTML and JSON in %s mode', mode => {
    const config = { network: { mode, allowlist: ['example.com'] } }
    const attrs = { url: 'https://example.com', title: 'Example', favicon: 'https://tracker.invalid/pixel.png' }
    const ed = editor({ type: 'doc', content: [{ type: 'bookmark', attrs }] }, config)
    expect(ed.view.dom.querySelector('.lark-doc-bookmark-icon')).toBeNull()
    expect(ed.getJSON().content[0].attrs.favicon).toBe(attrs.favicon)
    const html = '<div data-type="bookmark" data-url="https://example.com" data-title="Example" data-favicon="https://tracker.invalid/pixel.png"></div>'
    const copy = editor(sanitizeHTML(html), config)
    expect(copy.view.dom.querySelector('.lark-doc-bookmark-icon')).toBeNull()
  })

  it('filters off-allowlist favicon metadata returned by the existing unfurl provider', async () => {
    const ed = new Editor({ extensions: createLarkDocExtensions({ config: { network: { mode: 'allowlist', allowlist: ['example.com'] } }, unfurlProvider: { unfurl: async () => ({ ok: true, title: 'Fetched', favicon: 'https://tracker.invalid/pixel.png' }) } }), content: { type: 'doc', content: [{ type: 'bookmark', attrs: { url: 'https://example.com' } }] } })
    editors.push(ed)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(ed.view.dom.querySelector('.lark-doc-bookmark-icon:not(.is-skeleton)')).toBeNull()
    expect(ed.getJSON().content[0].attrs.favicon).toBe('https://tracker.invalid/pixel.png')
  })

  it('fails closed when the host preview policy throws', () => {
    const ed = new Editor({ extensions: createLarkDocExtensions({ canEmbed() { throw new Error('policy failure') } }), content: { type: 'doc', content: [{ type: 'linkEmbed', attrs: { href: 'https://example.com', view: 'preview' } }] } })
    editors.push(ed)
    expect(ed.view.dom.querySelector('iframe')).toBeNull()
    expect(ed.view.dom.textContent).toContain('无法内嵌预览')
  })

  it('keeps attachment downloads out of the link navigation handler', () => {
    const ed = editor('<p>text</p>')
    const host = hostFor(ed)
    const anchor = document.createElement('a')
    anchor.href = 'https://example.com/file.pdf'
    anchor.setAttribute('download', '')
    ed.view.dom.appendChild(anchor)
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    anchor.addEventListener('click', host.onEditorLinkClick)
    anchor.addEventListener('click', e => e.preventDefault(), { once: true })
    // A delegated download must reach the browser without navigation interception.
    Object.defineProperty(event, 'target', { value: anchor })
    host.onEditorLinkClick(event)
    expect(event.defaultPrevented).toBe(false)
    anchor.remove()
  })

  it('opens a node-selected bookmark on click but still suppresses navigation during actual text selection', () => {
    const ed = editor({ type: 'doc', content: [{ type: 'bookmark', attrs: { url: 'https://example.com', title: 'Example' } }] })
    document.body.appendChild(ed.view.dom)
    ed.commands.setNodeSelection(0)
    const block = ed.view.dom.querySelector('[data-type="bookmark"]')
    const card = block.querySelector('.lark-doc-bookmark-card')
    const selection = window.getSelection()
    const range = document.createRange()
    range.selectNode(block)
    selection.removeAllRanges()
    selection.addRange(range)
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    try {
      card.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(open).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener')
      open.mockClear()
      range.selectNodeContents(card.querySelector('.lark-doc-bookmark-title').firstChild)
      selection.removeAllRanges()
      selection.addRange(range)
      card.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(open).not.toHaveBeenCalled()
    } finally { open.mockRestore(); selection.removeAllRanges() }
  })

  it('shows the cell plus only for a collapsed cursor inside one editable cell', () => {
    const ed = editor('<p>outside</p><table><tr><td><p>cell</p></td><td><p>next</p></td></tr></table>')
    const host = { editor: ed, featureEnabled: () => true, effectiveReadonly: false }
    const build = tableTools.methods.buildCellPlusState
    expect(typeof build).toBe('function')
    expect(build.call(host).visible).toBe(false)
    const cells = []
    ed.state.doc.descendants((node, pos) => { if (node.type.name === 'tableCell') cells.push(pos) })
    const cell = ed.view.nodeDOM(cells[0])
    cell.getBoundingClientRect = () => ({ left: 120, top: 80, width: 100, height: 40, right: 220, bottom: 120 })
    ed.commands.setTextSelection(cells[0] + 2)
    expect(build.call(host)).toMatchObject({ visible: true, left: 72, top: 87 })
    ed.view.nodeDOM(cells[1]).getBoundingClientRect = () => ({ left: 220, top: 80, width: 100, height: 40, right: 320, bottom: 120 })
    ed.commands.setTextSelection(cells[1] + 2)
    expect(build.call(host)).toMatchObject({ visible: true, left: 184, top: 87 })
    host.blockMenuOpen = true
    expect(build.call(host).visible).toBe(false)
    host.blockMenuOpen = false
    ed.view.dispatch(ed.state.tr.setSelection(CellSelection.create(ed.state.doc, ...cells)))
    expect(build.call(host).visible).toBe(false)
    host.effectiveReadonly = true
    expect(build.call(host).visible).toBe(false)
  })

  it('keeps the whole-table six-dot handle beside the active cell plus', () => {
    const host = { editor: {}, effectiveReadonly: false, featureEnabled: () => true, handleRange: { from: 0, to: 10 }, handleIsTable: true, buildCellPlusState: () => ({ visible: true }), handleBlockNode: () => null }
    expect(blockHandleUi.methods.buildBlockHandleState.call(host).visible).toBe(true)
    host.buildCellPlusState = () => ({ visible: false })
    expect(blockHandleUi.methods.buildBlockHandleState.call(host).visible).toBe(true)
    host.handleIsTable = false
    host.buildCellPlusState = () => ({ visible: true })
    expect(blockHandleUi.methods.buildBlockHandleState.call(host).visible).toBe(true)
  })

  it('converts a link in mixed text through all four views without dropping its neighbours', () => {
    const ed = editor('<p>before <a href="https://example.com"><strong>Example</strong></a> after</p>')
    const host = hostFor(ed)
    host._linkTarget = host.linkTargetAt(ed.view.dom.querySelector('a'))
    expect(host._linkTarget).toMatchObject({ from: 8, to: 15, title: 'Example', view: 'title' })
    for (const kind of ['link', 'card', 'preview']) {
      expect(host.setLinkEmbedView(kind)).toBe(true)
      expect(ed.state.doc.textContent).toContain('before ')
      expect(ed.state.doc.textContent).toContain(' after')
      host._linkTarget = host.linkTargetAt(ed.view.dom.querySelector('[data-type="link-embed"], [data-type="bookmark"]') || ed.view.dom.querySelector('a'))
      expect(host._linkTarget.view).toBe(kind)
    }
    expect(host.setLinkEmbedView('title')).toBe(true)
    expect(ed.state.doc.textContent).toBe('before example.com after')
    expect(ed.view.dom.querySelector('a').textContent).toBe('example.com')
    expect(ed.view.dom.querySelector('a').href).toBe('https://example.com/')
    expect(ed.commands.undo()).toBe(true)
    expect(ed.state.doc.toJSON().content.some(node => node.type === 'linkEmbed')).toBe(true)
  })

  it('edits the hovered link rather than the current selection, retaining neighbouring marks', () => {
    const ed = editor('<p><a href="https://first.example">first</a> and <a href="https://second.example"><strong>second</strong></a></p>')
    const host = hostFor(ed)
    ed.commands.setTextSelection(2)
    host._linkTarget = host.linkTargetAt(ed.view.dom.querySelectorAll('a')[1])
    expect(host.editHoveredLink()).toBe(true)
    host.linkValue = 'https://changed.example'
    host.linkText = 'changed'
    expect(host.updateHoveredLink()).toBe(true)
    const anchors = ed.view.dom.querySelectorAll('a')
    expect(anchors[0].href).toBe('https://first.example/')
    expect(anchors[1].href).toBe('https://changed.example/')
    expect(anchors[1].querySelector('strong').textContent).toBe('changed')
  })

  it('retains mixed inline formatting when editing only the URL', () => {
    const ed = editor('<p><a href="https://example.com"><strong>bold</strong><em>italic</em></a></p>')
    const host = hostFor(ed)
    host._linkTarget = host.linkTargetAt(ed.view.dom.querySelector('a'))
    host.editHoveredLink()
    host.linkValue = 'https://changed.example'
    expect(host.updateHoveredLink()).toBe(true)
    expect(ed.view.dom.querySelector('a strong').textContent).toBe('bold')
    expect(ed.view.dom.querySelector('a em').textContent).toBe('italic')
  })

  it('keeps URL view inline and resolves a domain title after sanitized HTML reload', () => {
    const ed = editor('<p>before <a href="https://example.com">Example</a> after</p>')
    const host = hostFor(ed)
    host._linkTarget = host.linkTargetAt(ed.view.dom.querySelector('a'))
    expect(host.setLinkEmbedView('link')).toBe(true)
    expect(ed.state.doc.childCount).toBe(1)
    expect(ed.view.dom.querySelector('a').textContent).toBe('https://example.com')
    const copy = editor(sanitizeHTML(ed.getHTML()))
    const restored = hostFor(copy)
    restored._linkTarget = restored.linkTargetAt(copy.view.dom.querySelector('a'))
    expect(restored.setLinkEmbedView('title')).toBe(true)
    expect(copy.state.doc.textContent).toBe('before example.com after')
  })

  it('adding a URL to selected formatted text and paragraphs preserves the selection structure', () => {
    for (const html of ['<p><strong>bold</strong><em>italic</em></p>', '<p>first</p><p>second</p>']) {
      const ed = editor(html)
      ed.commands.ensureLarkDocBlockIds()
      ed.commands.selectAll()
      const original = ed.getJSON()
      const host = { editor: ed, writable: () => true, linkValue: 'https://example.com', linkInsertMode: true, linkText: ed.state.doc.textBetween(ed.state.selection.from, ed.state.selection.to, ' '), restoreSelection() {} }
      toolbarMenus.methods.applyLink.call(host)
      const stripLink = node => ({ ...node, ...(node.marks ? { marks: node.marks.filter(mark => mark.type !== 'link') } : {}), ...(node.content ? { content: node.content.map(stripLink) } : {}) })
      const plain = JSON.parse(JSON.stringify(stripLink(ed.getJSON()), (key, value) => key === 'marks' && !value.length ? undefined : value))
      expect(plain).toEqual(original)
      expect(ed.view.dom.querySelectorAll('a').length).toBeGreaterThan(0)
    }
  })

  it('card conversion uses the existing bookmark model and metadata survives the sanitized HTML path', () => {
    const ed = editor('<p><a href="https://example.com">Example</a></p>')
    const host = hostFor(ed)
    host._linkTarget = host.linkTargetAt(ed.view.dom.querySelector('a'))
    expect(host.setLinkEmbedView('card')).toBe(true)
    expect(ed.state.doc.firstChild.type.name).toBe('bookmark')
    const copy = editor(sanitizeHTML(ed.getHTML()))
    expect(copy.getJSON()).toEqual(ed.getJSON())
    const restored = hostFor(copy)
    restored._linkTarget = restored.linkTargetAt(copy.view.dom.querySelector('[data-type="bookmark"]'))
    expect(restored.setLinkEmbedView('title')).toBe(true)
    expect(copy.state.doc.textContent).toBe('example.com')
  })

  it('preserves a valid 300-codepoint emoji bookmark title through sanitization', () => {
    const title = '😀'.repeat(300)
    const ed = editor({ type: 'doc', content: [{ type: 'bookmark', attrs: { url: 'https://example.com', title } }] })
    expect(editor(sanitizeHTML(ed.getHTML())).state.doc.firstChild.attrs.title).toBe(title)
  })

  it('preserves rich card metadata through preview and inline views including HTML reload', () => {
    const attrs = { url: 'https://example.com', title: '😀'.repeat(300), desc: 'Description', favicon: 'https://example.com/icon.png', recordId: 'record-1' }
    let ed = editor({ type: 'doc', content: [{ type: 'bookmark', attrs }] })
    let host = hostFor(ed)
    for (const kind of ['preview', 'card', 'title', 'link', 'card']) {
      host._linkTarget = host.linkTargetAt(ed.view.dom.querySelector('[data-type="bookmark"], [data-type="link-embed"], a'))
      expect(host.setLinkEmbedView(kind)).toBe(true)
      ed = editor(sanitizeHTML(ed.getHTML()))
      host = hostFor(ed)
    }
    expect(ed.getJSON().content.find(node => node.type === 'bookmark').attrs).toMatchObject(attrs)
  })

  it('rejects oversized or NUL inline title metadata without changing the document', () => {
    const ed = editor(`<p><a href="https://example.com">${'x'.repeat(100001)}</a></p>`)
    const host = hostFor(ed)
    host._linkTarget = host.linkTargetAt(ed.view.dom.querySelector('a'))
    host.editHoveredLink()
    const before = ed.state.doc
    expect(host.updateHoveredLink()).toBe(false)
    expect(ed.state.doc).toBe(before)
    ed.commands.setContent('<p><a href="https://example.com">Example</a></p>')
    host._linkTarget = host.linkTargetAt(ed.view.dom.querySelector('a'))
    host.setLinkEmbedView('link')
    host._linkTarget = host.linkTargetAt(ed.view.dom.querySelector('a'))
    host.editHoveredLink()
    host.linkText = 'nul\u0000title'
    expect(host.updateHoveredLink()).toBe(false)
    expect(ed.view.dom.querySelector('a').textContent).toBe('https://example.com')
  })

  it('keeps long custom labels separate from fetched card titles and rejects invalid block edits', () => {
    const ed = editor(`<p><a href="https://example.com">${'x'.repeat(513)}</a></p>`)
    const host = hostFor(ed)
    host._linkTarget = host.linkTargetAt(ed.view.dom.querySelector('a'))
    expect(host.setLinkEmbedView('card')).toBe(true)
    expect(ed.state.doc.firstChild.attrs.title).toBeNull()
    expect(ed.state.doc.firstChild.attrs.linkTitle).toHaveLength(513)
    ed.commands.setContent('<p>text</p>')
    ed.commands.setLinkEmbed({ href: 'https://example.com', title: 'Block' })
    host._linkTarget = host.linkTargetAt(ed.view.dom.querySelector('[data-type="link-embed"]'))
    host.editHoveredLink()
    for (const title of ['x'.repeat(100001), 'nul\u0000title']) {
      host.linkText = title
      expect(host.updateHoveredLink()).toBe(false)
      expect(ed.getJSON().content.find(node => node.type === 'linkEmbed').attrs.title).toBe('Block')
      expect(() => ed.state.doc.check()).not.toThrow()
    }
  })

  it('removes links but preserves their text for inline and block views', () => {
    const ed = editor('<p>before <a href="https://example.com">Example</a> after</p>')
    const host = hostFor(ed)
    host._linkTarget = host.linkTargetAt(ed.view.dom.querySelector('a'))
    expect(host.removeHoveredLink()).toBe(true)
    expect(ed.state.doc.textContent).toBe('before Example after')
    expect(ed.view.dom.querySelector('a')).toBeNull()
    ed.commands.setLinkEmbed({ href: 'https://example.com', title: 'Block', view: 'card' })
    host._linkTarget = host.linkTargetAt(ed.view.dom.querySelector('[data-type="link-embed"]'))
    expect(host.removeHoveredLink()).toBe(true)
    expect(ed.state.doc.textContent).toContain('Block')
    expect(ed.view.dom.querySelector('[data-type="link-embed"]')).toBeNull()
  })

  it('rejects stale hover edits, unsafe URLs, malformed attributes and readonly mutations', () => {
    const ed = editor('<p><a href="https://example.com">Example</a></p>')
    const host = hostFor(ed)
    host._linkTarget = host.linkTargetAt(ed.view.dom.querySelector('a'))
    host.editHoveredLink()
    host.linkValue = 'javascript:alert(1)'
    expect(host.updateHoveredLink()).toBe(false)
    host.linkValue = 'https://new.example'
    ed.commands.insertContent('new')
    expect(host.updateHoveredLink()).toBe(false)
    expect(ed.commands.setLinkEmbed({ href: 'https://example.com', title: 3 })).toBe(false)
    host._linkTarget = host.linkTargetAt(ed.view.dom.querySelector('a'))
    host.writable = () => false
    expect(host.setLinkEmbedView('card')).toBe(false)
    expect(host.removeHoveredLink()).toBe(false)
  })

  it('honors link feature and command gates for hovered mutations', () => {
    const ed = editor('<p><a href="https://example.com">Example</a></p>')
    const host = hostFor(ed)
    host._linkTarget = host.linkTargetAt(ed.view.dom.querySelector('a'))
    host.larkDocConfig = { commands: { disabled: ['link'] } }
    expect(host.editHoveredLink()).toBe(false)
    expect(host.setLinkEmbedView('card')).toBe(false)
    host.larkDocConfig.commands.disabled = ['unsetLink']
    expect(host.removeHoveredLink()).toBe(false)
    host.featureEnabled = name => name !== 'textStyle'
    expect(host.editHoveredLink()).toBe(false)
  })

  it('roundtrips HTML link blocks with their ID, and exports a readable Markdown link', () => {
    const ed = editor('<p>text</p>')
    ed.commands.setLinkEmbed({ href: 'https://example.com', title: 'Example', view: 'link' })
    ed.commands.ensureLarkDocBlockIds()
    const json = ed.getJSON()
    const copy = editor(sanitizeHTML(ed.getHTML()))
    expect(copy.getJSON()).toEqual(json)
    expect(serializeMarkdown(json)).toContain('[Example](https://example.com)')
  })

  it('sanitizes link block metadata only on the matching block and rejects hostile URLs', () => {
    const html = sanitizeHTML('<div data-type="link-embed" data-href="javascript:alert(1)" data-view="bad" data-title="Title"></div><p data-href="https://example.com" data-view="card" data-title="x">text</p>')
    const dom = document.createElement('div')
    dom.innerHTML = html
    expect(dom.querySelector('div').hasAttribute('data-href')).toBe(false)
    expect(dom.querySelector('div').hasAttribute('data-view')).toBe(false)
    expect(dom.querySelector('p').hasAttribute('data-href')).toBe(false)
    expect(dom.querySelector('p').hasAttribute('data-title')).toBe(false)
  })

  it('shows the complete URL, edit/remove controls and four views while preserving focus', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const chosen = []
    const ui = createLinkTools({ host, handlers: { onView: view => chosen.push(view) } })
    const href = 'https://example.com/complete/path?value=long'
    ui.update({ open: true, href, view: 'title', left: 20, top: 10, bottom: 30 })
    expect(ui.el.querySelector('a').textContent).toBe(href)
    expect(ui.el.querySelector('[aria-label="编辑链接"]')).toBeTruthy()
    expect(ui.el.querySelector('[aria-label="移除链接"]')).toBeTruthy()
    const event = new Event('pointerdown', { bubbles: true, cancelable: true })
    ui.el.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    ui.el.querySelector('[aria-haspopup]').click()
    expect(ui.el.querySelector('[role="menu"]').hidden).toBe(false)
    expect(ui.el.querySelectorAll('[role="menuitemradio"]')).toHaveLength(4)
    ui.el.querySelector('[data-view="card"]').click()
    expect(chosen).toEqual(['card'])
    const viewTrigger = ui.el.querySelector('.lark-doc-link-view-trigger')
    const titleIcon = viewTrigger.firstElementChild.innerHTML
    ui.update({ open: true, href, view: 'card', left: 20, top: 10, bottom: 30 })
    expect(viewTrigger.firstElementChild.innerHTML).toBe(ui.el.querySelector('[data-view="card"] .lark-doc-icon').innerHTML)
    expect(viewTrigger.firstElementChild.innerHTML).not.toBe(titleIcon)
    ui.update({ open: true, href, view: 'link', left: 20, top: 10, bottom: 30 })
    expect(viewTrigger.firstElementChild.innerHTML).toBe(ui.el.querySelector('[data-view="link"] .lark-doc-icon').innerHTML)
    ui.destroy()
    expect(host.children).toHaveLength(0)
    host.remove()
  })
})


describe('最终补全：当前查询与菜单权限', () => {
  function viewHost(ed) {
    const host = { ...viewModes.data(), editor: ed, writable: () => true, featureEnabled: () => true }
    Object.entries(viewModes.methods).forEach(([key, method]) => { host[key] = method.bind(host) })
    return host
  }
  it('A查询改B后立即替换只替换当前B命中', () => {
    const ed = editor('<p>AAA BBB AAA</p>'), host = viewHost(ed)
    host.searchQuery = 'AAA'; host.updateSearch()
    host.searchQuery = 'BBB'; host.scheduleSearchUpdate(); host.replacement = 'new'
    host.replace(false)
    expect(ed.getText()).toBe('AAA new AAA')
    host._searchDebounce?.cancel()
  })
  it('正文改变后立即替换重新计算位置而不破坏邻文', () => {
    const ed = editor('<p>AAA BBB</p>'), host = viewHost(ed)
    host.searchQuery = 'BBB'; host.updateSearch()
    ed.commands.insertContentAt(1, '前缀 ')
    host.replacement = '替换'; host.replace(false)
    expect(ed.getText()).toBe('前缀 AAA 替换')
  })
  it.each([
    { commands: { disabled: ['columns'] } },
    { commands: { disabled: ['columns2'] } },
    { commands: { allow: ['paragraph'] } },
    { features: { columns: false } },
  ])('分栏受限的迟到回调不删除slash或恢复选区 %j', config => {
    const ed = editor('<p>/columns</p>')
    const host = { editor: ed, larkDocConfig: config, writable: () => true, featureEnabled: () => true,
      menuKind: 'slash', slashMatch: { from: 1, to: 9 }, restoreSelection: vi.fn(), closeCommandMenu: vi.fn(), executeCommand: vi.fn() }
    const before = ed.getJSON()
    commandMenu.methods.chooseCommand.call(host, { id: 'columns2' })
    expect(ed.getJSON()).toEqual(before)
    expect(host.restoreSelection).not.toHaveBeenCalled()
    expect(host.closeCommandMenu).not.toHaveBeenCalled()
    expect(host.executeCommand).not.toHaveBeenCalled()
  })
  it.each([2, 5])('只允许columns时仍可执行内部%d栏选择', count => {
    const ed = editor('<p>保留正文</p>')
    const host = { editor: ed, larkDocConfig: { commands: { allow: ['columns'] } }, writable: () => true, run: vi.fn() }
    commandMenu.methods.executeCommand.call(host, 'columns' + count)
    expect(host.run).toHaveBeenCalledWith('insertColumns', count)
  })
  it('群和云文档使用已有真实候选源开放入口', () => {
    const commands = filterCommands('', 'slash')
    for (const id of ['mentionChat', 'mentionPage']) expect(commands.find(item => item.id === id)?.tier).toBe('required')
  })
  it('全屏拒绝保持实际状态并暴露失败原因', async () => {
    const root = document.createElement('div')
    root.requestFullscreen = vi.fn(async () => { throw new Error('拒绝全屏') })
    const host = { $refs: { root }, fullscreen: false, onFullscreenChange: vi.fn() }
    expect(await viewModes.methods.toggleFullscreen.call(host)).toBe(false)
    expect(host.fullscreen).toBe(false)
    expect(host.error).toBe('拒绝全屏')
    expect(host.onFullscreenChange).toHaveBeenCalledOnce()
  })
  it('不支持全屏时不假设进入全屏', async () => {
    const root = document.createElement('div'), host = { $refs: { root }, fullscreen: false, onFullscreenChange: vi.fn() }
    expect(await viewModes.methods.toggleFullscreen.call(host)).toBe(false)
    expect(host.error).toContain('不支持全屏')
    expect(host.fullscreen).toBe(false)
  })
})


describe('链接预览尺寸观察器生命周期', () => {
  it('观察器只排一帧，不在尺寸通知内写布局；销毁取消待处理帧', () => {
    const observers = [], frames = new Map()
    const PreviousRO = globalThis.ResizeObserver, previousRequest = window.requestAnimationFrame, previousCancel = window.cancelAnimationFrame
    let sequence = 0
    globalThis.ResizeObserver = class {
      constructor(callback) { this.callback = callback; this.targets = []; observers.push(this) }
      observe(target) { this.targets.push(target) }
      disconnect() { this.disconnected = true }
    }
    window.requestAnimationFrame = callback => { const id = ++sequence; frames.set(id, callback); return id }
    window.cancelAnimationFrame = id => frames.delete(id)
    let ed
    try {
      ed = editor({ type: 'doc', content: [{ type: 'linkEmbed', attrs: { href: 'https://example.com', view: 'preview' } }] })
      const body = ed.view.dom.querySelector('.lark-doc-link-preview-body')
      const observer = observers.find(item => item.targets.includes(body))
      expect(observer).toBeTruthy()
      body.style.maxWidth = '777px'
      observer.callback([]); observer.callback([])
      expect(body.style.maxWidth).toBe('777px')
      expect(frames.size).toBe(1)
      const [id, callback] = frames.entries().next().value
      frames.delete(id); callback()
      expect(body.style.maxWidth).not.toBe('777px')
      observer.callback([])
      expect(frames.size).toBe(1)
      ed.destroy()
      expect(observer.disconnected).toBe(true)
      expect(frames.size).toBe(0)
      observer.callback([])
      expect(frames.size).toBe(0)
    } finally {
      ed?.destroy()
      globalThis.ResizeObserver = PreviousRO
      window.requestAnimationFrame = previousRequest
      window.cancelAnimationFrame = previousCancel
    }
  })
})
