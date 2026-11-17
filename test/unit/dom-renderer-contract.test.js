// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { Plugin } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { createDomRenderer } from '../../src/mount/domRenderer'
import { createRenderer, setRenderer } from '../../src/mount'
import { LarkDoc } from '../../src/LarkDoc'
import { createUploadProvider } from '../../src/core/media/upload'
import { diagramTypes } from '../../src/components/lark-doc/editor/constants'
import { DIAGRAM_SOURCES } from '../../src/ui/diagramMenu'
import { createMemoryCommentsProvider } from '../../src/core/comments/memory-provider'
import { createDocumentSession } from '../../src/session/DocumentSession'
import { BLOCKED_IMAGE_PLACEHOLDER, createNetworkPolicy } from '../../src/core/policy/network'
import { cloneShareExcerpt } from '../../src/components/lark-doc/editor/shareMixin'
import * as segmentedDocument from '../../src/editor/segmentedDocumentModel'
import { PAGED_IMPORT_META } from '../../src/core/transactionMetadata'
import { collectFoldRanges, foldedRange, resolveBlockTargetRange, moveBlockRange } from '../../src/core/documentOperations'
import { validateDerivedSnapshot } from '../../src/core/derive/snapshot'
import * as documentOperations from '../../src/core/documentOperations'
import { createDocumentDecorations } from '../../src/core/blocks/document-decorations'
import { documentKey } from '../../src/core/blocks/document-key'
import { DEFER_BLOCK_ID_META } from '../../src/core/blocks/block-fixes'
import { createWorkspace } from '../../src/ui/workspace'
import { createWorkspaceShell } from '../../src/ui/workspaceShell'
import { createSelect } from '../../src/ui/select'
import { placeMenu } from '../../src/ui/menuLayout'
import { createTableOverlays } from '../../src/ui/tableOverlays'

const ACTIONS = ['mount', 'update', 'destroy', 'getInstance', 'getRoot']
const mounted = []

describe('Safari 原生无障碍表格操作', () => {
  it('无指针的 click 选择整列整行，普通指针单击只触发一次', () => {
    const host = document.createElement('div'), onSelect = vi.fn()
    document.body.appendChild(host)
    const overlay = createTableOverlays({ host, handlers: { onSelect } })
    try {
      overlay.update({ open: true, columns: [{ index: 0, left: 0, width: 100 }], rows: [{ index: 0, top: 0, height: 40 }] })
      const column = host.querySelector('[aria-label="选择第 1 列"]'), row = host.querySelector('[aria-label="选择第 1 行"]')
      column.click(); row.click()
      expect(onSelect.mock.calls.map(args => args.slice(0, 2))).toEqual([['column', 0], ['row', 0]])
      onSelect.mockClear()
      column.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
      window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }))
      column.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
      expect(onSelect).toHaveBeenCalledTimes(1)
    } finally { overlay.destroy(); host.remove() }
  })
})

describe('菜单所属工作区与键盘焦点', () => {
  it('长菜单在触发器下方收缩滚动，不遮挡触发器', () => {
    const menu = document.createElement('div'); document.body.append(menu)
    menu.getBoundingClientRect = () => ({ width: 200, height: 684 })
    const h = Object.getOwnPropertyDescriptor(window, 'innerHeight')
    Object.defineProperty(window, 'innerHeight', { value: 700, configurable: true })
    try {
      const style = placeMenu(menu, { left: 350, right: 405, top: 7, bottom: 37 }, 8)
      expect(parseFloat(style.top)).toBeGreaterThanOrEqual(43)
      expect(parseFloat(style.maxHeight)).toBeLessThanOrEqual(649)
      expect(parseFloat(style.top) + parseFloat(style.maxHeight)).toBeLessThanOrEqual(692)
    } finally { Object.defineProperty(window, 'innerHeight', h); menu.remove() }
  })

  it('分数像素宽高的菜单定位不会因向上取整越过视窗安全边距', () => {
    const menu = document.createElement('div')
    document.body.appendChild(menu)
    vi.stubGlobal('innerWidth', 480); vi.stubGlobal('innerHeight', 680)
    vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue({ width: 325.4453125, height: 342.4453125 })
    try {
      placeMenu(menu, { left: 420, right: 474, top: 650, bottom: 680 }, 8, { align: 'end' })
      expect(parseFloat(menu.style.left) + 325.4453125).toBeLessThanOrEqual(472)
      expect(parseFloat(menu.style.top) + 342.4453125).toBeLessThanOrEqual(672)
    } finally { menu.remove(); vi.unstubAllGlobals() }
  })
  it('滚动父菜单里的下拉移到工作区根，窄短视窗内完整可滚动且仍可点击', () => {
    const root = document.createElement('div'), parent = document.createElement('div')
    root.className = 'lark-doc'; parent.className = 'lark-doc-header-menu'
    root.appendChild(parent); document.body.appendChild(root)
    const changed = vi.fn(), select = createSelect({ ariaLabel: '文档更多操作', options: [{ value: 'history', label: '历史记录', hint: '完整的历史记录说明' }], onChange: changed })
    parent.appendChild(select.el)
    vi.stubGlobal('innerWidth', 320); vi.stubGlobal('innerHeight', 180)
    const button = select.el.querySelector('button')
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({ left: 260, right: 310, top: 140, bottom: 170, width: 50, height: 30 })
    try {
      button.click()
      const menu = root.querySelector('[role="listbox"]')
      expect(menu.parentElement).toBe(root)
      expect(parseFloat(menu.style.maxWidth)).toBeLessThanOrEqual(304)
      expect(parseFloat(menu.style.maxHeight)).toBeLessThanOrEqual(164)
      menu.querySelector('button').click()
      expect(changed).toHaveBeenCalledWith('history')
      expect(root.querySelector('[role="listbox"]')).toBeNull()
      button.click()
      expect(root.querySelector('[role="listbox"]')).toBe(menu)
      parent.dispatchEvent(new Event('close'))
      expect(root.querySelector('[role="listbox"]')).toBeNull()
      button.click()
      const stale = menu.querySelector('button')
      select.destroy()
      expect(root.querySelector('[role="listbox"]')).toBeNull()
      stale.click(); button.click()
      expect(root.querySelector('[role="listbox"]')).toBeNull()
      expect(changed).toHaveBeenCalledTimes(1)
    } finally { select.destroy(); root.remove(); vi.unstubAllGlobals() }
  })
  it('悬浮后点击取得键盘焦点，Esc穿过本工作区隔离边界且不关闭另一工作区', () => {
    const shells = [createWorkspaceShell(), createWorkspaceShell()]
    const changed = vi.fn()
    const selects = shells.map(shell => {
      const select = createSelect({ ariaLabel: '测试字体', value: 'a', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], onChange: changed })
      shell.root.appendChild(select.el); document.body.appendChild(shell.root)
      return select
    })
    try {
      const [first, second] = selects.map(select => select.el.querySelector('button'))
      first.dispatchEvent(new MouseEvent('mouseenter')); first.click()
      expect(document.activeElement).toBe(first)
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
      expect(changed).toHaveBeenCalledWith('b')
      for (const trigger of [first, second]) trigger.dispatchEvent(new MouseEvent('mouseenter'))
      const input = document.createElement('input'); shells[0].root.appendChild(input); input.focus()
      for (const composing of [{ isComposing: true }, { keyCode: 229 }]) {
        const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...composing })
        input.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(false)
        expect(shells[0].root.querySelector('[role="listbox"]')).not.toBeNull()
      }
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      expect(shells[0].root.querySelector('[role="listbox"]')).toBeNull()
      expect(shells[1].root.querySelector('[role="listbox"]')).not.toBeNull()
      const remove = vi.spyOn(shells[1].root, 'removeEventListener')
      selects[1].destroy()
      expect(remove.mock.calls.some(([type, , capture]) => type === 'keydown' && capture === true)).toBe(true)
    } finally { selects.forEach(select => select.destroy()); shells.forEach(shell => shell.root.remove()) }
  })
})

describe('源模板插入与更多模板闭环', () => {
  it('完成提示使用独立正常布局宿主，关闭按钮保持可用', () => {
    const shell = createWorkspaceShell(), clearNotice = vi.fn()
    const ui = createWorkspace({ panelHost: shell.panelHost, noticeHost: shell.noticeHost, handlers: { clearNotice } })
    try {
      ui.update({ notice: '导入完成' })
      const notice = shell.root.querySelector('.lark-doc-notice')
      expect(notice).not.toBeNull()
      expect(shell.externalPanel.contains(notice)).toBe(false)
      expect(notice.parentElement).toBe(shell.noticeHost)
      notice.querySelector('button').click()
      expect(clearNotice).toHaveBeenCalledOnce()
      ui.update({ notice: '' })
      expect(shell.noticeHost.childElementCount).toBe(0)
    } finally { ui.destroy() }
  })
  it('查找按目标文本块滚动，不能把页容器当成命中目标', () => withTemplateDocument(async ({ host, editor }) => {
    await vi.dynamicImportSettled()
    const paragraph = editor.view.nodeDOM(editor.state.doc.firstChild.nodeSize)
    paragraph.scrollIntoView = vi.fn()
    paragraph.parentElement.scrollIntoView = vi.fn()
    const dispatch = vi.spyOn(editor.view, 'dispatch')
    host.searchQuery = '目标'; host.updateSearch(); host.nextMatch(1)
    expect(dispatch.mock.calls.some(([tr]) => tr.scrolledIntoView)).toBe(true)
    expect(paragraph.parentElement.scrollIntoView).not.toHaveBeenCalled()
  }))
  it('查找框持焦且native选区在正文外，仍按选中文本坐标滚动而不抢焦点', () => withTemplateDocument(async ({ host, editor }) => {
    const input = document.createElement('input'), outside = document.createElement('span')
    outside.textContent = 'outside'; document.body.append(input, outside)
    const scroll = vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
    const coords = vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({ top: 3000, bottom: 3020, left: 200, right: 220 })
    try {
      input.focus(); const native = document.getSelection(), range = document.createRange()
      range.selectNodeContents(outside); native.removeAllRanges(); native.addRange(range)
      host.searchQuery = '目标'; host.updateSearch(); await host.nextMatch(0)
      expect(coords).toHaveBeenCalledWith(editor.state.selection.head)
      expect(scroll).toHaveBeenCalled()
      expect(document.activeElement).toBe(input)
    } finally { scroll.mockRestore(); coords.mockRestore(); input.remove(); outside.remove() }
  }))
  async function withTemplateDocument(run, options = {}) {
    stubRangeLayout()
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, storage: 'none', title: '保留原文标题', content: '<p data-block-id="before_template">前文</p><p data-block-id="template_target">目标正文</p>', ...options })
    try { return await run({ doc, host: doc._handle.nativeHost.host, element, editor: doc.getEditor() }) }
    finally { doc.destroy(); element.remove() }
  }
  it('飞书标题编号菜单冷加载：独立重启、保留前缀及九位数确认', () => withTemplateDocument(async ({ editor, element }) => {
    editor.commands.setContent('<h1 data-numbering="true">甲</h1><h3 data-numbering="true" data-numbering-start="3">乙</h3><h3 data-numbering="true">丙</h3><h1 data-numbering="true">丁</h1>')
    const labels = () => [...element.querySelectorAll('.lark-doc-heading-number')].map(node => node.textContent)
    expect(labels()).toEqual(['1.', '1.3', '1.4', '2.'])
    const open = async () => { element.querySelector('h3 .lark-doc-heading-number').click(); await vi.dynamicImportSettled() }
    await open()
    expect(editor.state.selection.$from.parent.attrs.level).toBe(3)
    expect(editor.state.selection.$from.parent.textContent).toBe('乙')
    let menu = element.querySelector('[aria-label="编号设置"]')
    menu.querySelector('[data-menu-id="restart"]').click()
    let child = element.querySelector('[aria-label="重新开始编号"]')
    expect(child.parentElement).toBe(menu.parentElement)
    expect(menu.contains(child)).toBe(false)
    expect([...child.querySelectorAll('button')].map(node => node.textContent)).toEqual(['从 1. 开始', '从 1.1 开始'])
    child.querySelectorAll('button')[1].click()
    expect(labels()).toEqual(['1.', '1.1', '1.2', '2.'])
    await open()
    menu = element.querySelector('[aria-label="编号设置"]')
    menu.querySelector('[data-menu-id="restart"]').click()
    child = element.querySelector('[aria-label="重新开始编号"]')
    child.querySelector('button').click()
    expect(labels()).toEqual(['1.', '1.', '2.', '2.'])
    await open()
    element.querySelector('[data-menu-id="renumber"]').click()
    await Promise.resolve()
    const input = element.querySelector('[aria-label="编号值"]')
    input.value = '999999999'; input.dispatchEvent(new Event('input', { bubbles: true }))
    element.querySelector('[aria-label="确定编号"]').click()
    await Promise.resolve()
    expect(labels()).toEqual(['1.', '999999999.', '1000000000.', '2.'])
    expect(element.querySelector('[aria-label="编号设置"]')).toBeNull()
    expect(element.querySelector('[aria-label="重新开始编号"]')).toBeNull()
  }))
  it('飞书标题队列新增浅级标题时追溯更新，过期菜单不改错块', () => withTemplateDocument(async ({ editor, element }) => {
    editor.commands.setContent('<h3 data-numbering="true">甲</h3><h3 data-numbering="true">乙</h3>')
    const second = editor.state.doc.firstChild.nodeSize
    editor.view.dispatch(editor.state.tr.setNodeMarkup(second, undefined, { ...editor.state.doc.nodeAt(second).attrs, level: 1 }))
    expect([...element.querySelectorAll('.lark-doc-heading-number')].map(node => node.textContent)).toEqual(['1.1', '2.'])
    element.querySelector('.lark-doc-heading-number').click()
    await vi.dynamicImportSettled()
    editor.commands.insertContentAt(1, '新')
    const before = editor.state.doc
    element.querySelector('[data-menu-id="restart"]')?.click()
    element.querySelector('[aria-label="重新开始编号"] button')?.click()
    expect(editor.state.doc.eq(before)).toBe(true)
  }))
  it('飞书编号菜单切换同前缀目标不留旧子层，IME不提交或关闭', () => withTemplateDocument(async ({ editor, element }) => {
    editor.commands.setContent('<h1 data-numbering="true">甲</h1><h3 data-numbering="true">乙</h3><h3 data-numbering="true">丙</h3>')
    const widgets = () => element.querySelectorAll('h3 .lark-doc-heading-number')
    widgets()[1].click(); await vi.dynamicImportSettled()
    element.querySelector('[data-menu-id="restart"]').click()
    const stale = element.querySelector('[aria-label="重新开始编号"] button')
    widgets()[0].click(); await Promise.resolve()
    expect(element.querySelector('[aria-label="重新开始编号"]')).toBeNull()
    const before = editor.state.doc
    stale.click()
    expect(editor.state.doc.eq(before)).toBe(true)
    element.querySelector('[data-menu-id="restart"]').click()
    const child = element.querySelector('[aria-label="重新开始编号"]')
    expect(child.querySelectorAll('button')[1].disabled).toBe(true)
    for (const args of [{ isComposing: true }, { keyCode: 229 }]) {
      const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...args })
      child.dispatchEvent(escape)
      expect(escape.defaultPrevented).toBe(false)
      expect(child.isConnected).toBe(true)
    }
    element.querySelector('[data-menu-id="renumber"]').click(); await Promise.resolve()
    const input = element.querySelector('[aria-label="编号值"]')
    for (const args of [{ isComposing: true }, { keyCode: 229 }]) {
      const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...args })
      input.dispatchEvent(enter)
      expect(enter.defaultPrevented).toBe(false)
      expect(input.isConnected).toBe(true)
      expect(editor.state.doc.eq(before)).toBe(true)
    }
  }))
  it('飞书编号草稿失焦不提交，换目标后工具栏和输入落在新标题', () => withTemplateDocument(async ({ editor, element }) => {
    editor.commands.setContent('<h1 data-numbering="true">甲</h1><h3 data-numbering="true">乙</h3><h3 data-numbering="true">丙</h3>')
    element.querySelector('h3 .lark-doc-heading-number').click(); await vi.dynamicImportSettled()
    element.querySelector('[data-menu-id="renumber"]').click(); await Promise.resolve()
    const before = editor.state.doc, input = element.querySelector('[aria-label="编号值"]')
    input.value = '77'; input.dispatchEvent(new Event('input', { bubbles: true })); input.blur()
    expect(editor.state.doc.eq(before)).toBe(true)
    element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    await Promise.resolve()
    expect(element.querySelector('[aria-label="编号设置"]')).toBeNull()
    expect(editor.state.doc.eq(before)).toBe(true)
    element.querySelector('h3 .lark-doc-heading-number').click(); await Promise.resolve()
    element.querySelector('[data-menu-id="renumber"]').click(); await Promise.resolve()
    const again = element.querySelector('[aria-label="编号值"]')
    again.value = '77'; again.dispatchEvent(new Event('input', { bubbles: true }))
    element.querySelectorAll('h3 .lark-doc-heading-number')[1].click(); await Promise.resolve()
    expect(element.querySelector('[aria-label="编号设置"]')).not.toBeNull()
    expect(editor.state.selection.$from.parent.textContent).toBe('丙')
    expect(editor.state.doc.eq(before)).toBe(true)
  }))
  it('目录编号与正文同步：富文本标题、跳转、改名、层级、删除和撤销', () => withTemplateDocument(async ({ host, editor, element }) => {
    editor.commands.setContent('<h1 data-numbering="true"><strong>你好😀</strong></h1><h2 data-numbering="true"><a href="https://example.com">子标题</a></h2><h1 data-numbering="true">我也好</h1><h1>3. 原文编号</h1>')
    host.outlineOpen = true
    const labels = () => [...element.querySelectorAll('.lark-doc-outline-item > button:last-child')].map(node => node.textContent)
    const check = async expected => {
      await vi.waitFor(() => expect(labels()).toEqual(expected))
      expect([...element.querySelectorAll('.lark-doc-heading-number')].map(node => node.textContent)).toEqual(expected.filter(text => text !== '3. 原文编号').map(text => text.split(' ')[0]))
    }
    await check(['1. 你好😀', '1.1 子标题', '2. 我也好', '3. 原文编号'])
    const jump = [...element.querySelectorAll('.lark-doc-outline-item > button:last-child')][2]
    jump.click()
    expect(editor.state.selection.$from.parent.textContent).toBe('我也好')
    editor.commands.insertContent('改名')
    await check(['1. 你好😀', '1.1 子标题', '2. 改名我也好', '3. 原文编号'])
    editor.commands.setHeading({ level: 2 })
    await check(['1. 你好😀', '1.1 子标题', '1.2 改名我也好', '3. 原文编号'])
    const before = editor.state.doc
    editor.commands.deleteRange({ from: 0, to: editor.state.doc.firstChild.nodeSize })
    await check(['1. 子标题', '2. 改名我也好', '3. 原文编号'])
    editor.commands.undo()
    await vi.waitFor(() => expect(editor.state.doc.eq(before)).toBe(true))
    await check(['1. 你好😀', '1.1 子标题', '1.2 改名我也好', '3. 原文编号'])
  }))
  it('Markdown导入保留语义格式与任务状态，不按扩展名宣称发生降级', () => withTemplateDocument(async ({ doc, editor, element }) => {
    const content = '# 标题\n\n**加粗正文**\n\n> 引用\n\n```js\nconst value = 1\n```\n\n| 列甲 | 列乙 |\n| --- | --- |\n| A | B |\n\n- [x] 已完成\n- [ ] 待办\n'
    const controller = doc._handle.workspaceController
    const pending = controller.importDocument({ target: { files: [{ name: '格式.md', size: content.length, text: async () => content }], value: 'selected' } })
    await vi.waitFor(() => expect(element.querySelector('[role="dialog"]')).not.toBeNull())
    ;[...element.querySelectorAll('[role="dialog"] button')].find(button => button.textContent === '导入并替换').click()
    await pending
    expect(controller.state.notice).toBe('导入完成')
    const types = [], checked = []
    editor.state.doc.descendants(node => { types.push(node.type.name); if (node.type.name === 'taskItem') checked.push(node.attrs.checked) })
    expect(types).toEqual(expect.arrayContaining(['heading', 'blockquote', 'codeBlock', 'table']))
    expect(editor.getHTML()).toContain('<strong>加粗正文</strong>')
    expect(checked).toEqual([true, false])
  }))
  it('导入确认显示文件名、说明和独立操作区，取消保持原文', () => withTemplateDocument(async ({ doc, editor, element }) => {
    const before = editor.state.doc
    const pending = doc._handle.workspaceController.importDocument({ target: { files: [{ name: '示例.html', size: 10, text: async () => '<p>new</p>' }], value: 'selected' } })
    await vi.waitFor(() => expect(element.querySelector('[role="dialog"]')).not.toBeNull())
    const dialog = element.querySelector('[role="dialog"]')
    expect(dialog.classList.contains('lark-doc-import-confirm')).toBe(true)
    expect(dialog.textContent).toContain('示例.html')
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy()
    ;[...dialog.querySelectorAll('button')].find(button => button.textContent === '取消').click()
    await pending
    expect(editor.state.doc).toBe(before)
  }))
  it('关闭文档操作父弹窗同步收起其浮出的导出菜单', () => withTemplateDocument(async ({ host, element }) => {
    await vi.dynamicImportSettled()
    host.openHeaderMenuFrom({ currentTarget: { getBoundingClientRect: () => ({ left: 100, right: 140, top: 40, bottom: 70, width: 40, height: 30 }) } })
    await Promise.resolve()
    const button = element.querySelector('.lark-doc-header-menu button[aria-label="导出文档格式"]')
    expect(button).not.toBeNull(); button.click()
    expect(element.querySelector('.lark-doc-select-menu')).not.toBeNull()
    host.closeHeaderMenu()
    await vi.waitFor(() => expect(element.querySelector('.lark-doc-select-menu')).toBeNull())
  }, { config: { layout: { headerVisible: false } } }))
  it.each([[false, false], [false, true], [true, false], [true, true]])('嵌套Markdown任务独立保留父%s/子%s勾选，普通项不变', (parent, child) => withTemplateDocument(async ({ doc, editor, element }) => {
    const text = `- [${parent ? 'x' : ' '}] 父任务\n  - [${child ? 'x' : ' '}] 子任务\n- 普通项\n  - [x] 普通项下的完成任务\n`
    const pending = doc._handle.workspaceController.importDocument({ target: { files: [{ name: '嵌套.md', size: text.length, text: async () => text }], value: 'selected' } })
    await vi.waitFor(() => expect(element.querySelector('[role="dialog"]')).not.toBeNull())
    ;[...element.querySelectorAll('[role="dialog"] button')].find(button => button.textContent === '导入并替换').click()
    await pending
    const states = [], types = []
    editor.state.doc.descendants(node => { types.push(node.type.name); if (node.type.name === 'taskItem') states.push(node.attrs.checked) })
    expect(states).toEqual([parent, child, true])
    expect(types).toContain('listItem')
  }))
  it('列回退先收集真实跨度边界，再细分未知的三列合并区域', () => withTemplateDocument(async ({ doc, editor, host }) => {
    doc.setContent('<table><tr><td colspan="3"><p>整行合并</p></td></tr><tr><td colspan="2"><p>两列合并</p></td><td><p>第三列</p></td></tr></table>')
    editor.commands.setTextSelection(4)
    const table = editor.view.dom.querySelector('table'), wrapper = table.closest('.tableWrapper')
    const box = (left, width) => ({ left, right: left + width, top: 200, bottom: 280, width, height: 80 })
    vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue(box(100, 300))
    vi.spyOn(table, 'getBoundingClientRect').mockReturnValue(box(100, 300))
    Object.defineProperties(wrapper, { clientWidth: { configurable: true, value: 300 }, scrollWidth: { configurable: true, value: 300 } })
    ;[...table.querySelectorAll('td')].forEach((cell, i) => vi.spyOn(cell, 'getBoundingClientRect').mockReturnValue(i === 0 ? box(100, 300) : box(i === 1 ? 100 : 250, 150)))
    const previous = host._tableOverlaysUi, update = vi.fn()
    host._tableOverlaysUi = { update, destroy() {} }; host._tableUiClicked = true
    vi.spyOn(host, 'tableOverlayWrapper').mockReturnValue(wrapper); vi.spyOn(host, 'tableUiActive').mockReturnValue(true)
    try {
      host.refreshTableOverlays()
      expect(update.mock.calls.at(-1)[0].columns.map(col => col.width)).toEqual([75, 75, 150])
    } finally { host._tableOverlaysUi = previous }
  }))
  it.each([0, 50])('col几何不可用时，合并格按逻辑列回退并裁剪横滚区间，scroll=%s', scroll => withTemplateDocument(async ({ doc, editor, host }) => {
    doc.setContent('<table><tr><td colspan="2"><p>合并</p></td></tr><tr><td><p>A</p></td><td><p>B</p></td></tr></table>')
    editor.commands.setTextSelection(4)
    const table = editor.view.dom.querySelector('table'), wrapper = table.closest('.tableWrapper')
    const box = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height })
    vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue(box(100, 200, 150, 80))
    vi.spyOn(table, 'getBoundingClientRect').mockReturnValue(box(100 - scroll, 200, 200, 80))
    Object.defineProperties(wrapper, { clientWidth: { configurable: true, value: 150 }, scrollWidth: { configurable: true, value: 200 }, scrollLeft: { configurable: true, value: scroll } })
    ;[...table.querySelectorAll('td')].forEach((cell, index) => vi.spyOn(cell, 'getBoundingClientRect').mockReturnValue(index === 0 ? box(100 - scroll, 200, 200, 40) : box(100 - scroll + (index - 1) * 100, 240, 100, 40)))
    const previous = host._tableOverlaysUi, update = vi.fn()
    host._tableOverlaysUi = { update, destroy() {} }; host._tableUiClicked = true
    vi.spyOn(host, 'tableOverlayWrapper').mockReturnValue(wrapper)
    vi.spyOn(host, 'tableUiActive').mockReturnValue(true)
    try {
      host.refreshTableOverlays()
      const state = update.mock.calls.at(-1)[0]
      expect(state.columns).toHaveLength(2)
      expect(state.columns[0]).toMatchObject({ index: 0, left: 0, width: scroll ? 50 : 100 })
      expect(state.columns[1]).toMatchObject({ index: 1, left: scroll ? 50 : 100, width: scroll ? 100 : 50 })
    } finally { host._tableOverlaysUi = previous }
  }))
  it('v58 插入弹窗基础图标和常用文字项均不显示tips', () => withTemplateDocument(async ({ host, element }) => {
    host.openCommandMenu('plus'); await vi.dynamicImportSettled()
    const basic = element.querySelector('.lark-doc-command-section[data-category="基础"] button')
    const row = element.querySelector('.lark-doc-command-section[data-category="常用"] button')
    expect(basic).not.toBeNull(); expect(row).not.toBeNull()
    for (const button of [basic, row]) button.getBoundingClientRect = () => ({ left: 100, top: 200, right: 150, bottom: 230, width: 50, height: 30 })
    basic.dispatchEvent(new MouseEvent('mouseenter'))
    await new Promise(resolve => setTimeout(resolve, 180))
    expect(element.querySelector('[role="tooltip"]')).toBeNull()
    row.dispatchEvent(new MouseEvent('mouseenter'))
    await new Promise(resolve => setTimeout(resolve, 180))
    expect(element.querySelector('[role="tooltip"]')).toBeNull()
  }))
  it('分页兄弟索引只建立页目录且保留跨页块坐标', () => withTemplateDocument(async ({ doc, editor }) => {
    await doc.setContentAsync('<p>row</p>'.repeat(96), { pagedView: true, yieldToMain: async () => {} })
    const candidate = editor.state.doc.copy(editor.state.doc.content)
    const expected = []
    candidate.forEach((page, pos) => page.forEach((node, offset) => expected.push({ node, pos: pos + 1 + offset })))
    const scans = candidate.content.content.map(page => vi.spyOn(page, 'forEach'))
    try {
      const siblings = editor.schema.cached.segmentSiblings(candidate)
      expect(scans.every(scan => !scan.mock.calls.length)).toBe(true)
      expect(siblings.childCount).toBe(expected.length)
      for (let index = expected.length - 1; index >= 0; index--) {
        expect(siblings.child(index)).toBe(expected[index].node)
        expect(siblings.positionAt(index)).toBe(expected[index].pos)
        expect(siblings.indexAt(expected[index].pos)).toBe(index)
        expect(siblings.indexAt(expected[index].pos + 1)).toBeUndefined()
      }
    } finally { scans.forEach(scan => scan.mockRestore()) }
  }))
  it('未编号标题格式复用结构分析，编号变化重新分析并可撤销', () => withTemplateDocument(async ({ doc, editor }) => {
    await doc.setContentAsync('<p>head</p><p data-indent="1">child</p>' + '<p>tail</p>'.repeat(65), { pagedView: true, yieldToMain: async () => {} })
    const runtime = editor.storage.larkDoc.pagedView, before = editor.state.doc, analysis = runtime.readAnalysis(before)
    editor.chain().setTextSelection(2).setHeading({ level: 2 }).run()
    const formatted = runtime.readAnalysis(editor.state.doc)
    expect(formatted.headingNumbers).toBe(analysis.headingNumbers)
    expect(formatted.orderedListNumbers).toBe(analysis.orderedListNumbers)
    expect(formatted.foldRanges.get(1).node).toBe(editor.state.doc.nodeAt(1))
    editor.commands.updateAttributes('heading', { numbering: true })
    const numbered = runtime.readAnalysis(editor.state.doc)
    expect(numbered.headingNumbers).not.toBe(formatted.headingNumbers)
    expect(numbered.headingNumbers.size).toBe(1)
    editor.commands.undo()
    expect(runtime.readAnalysis(editor.state.doc).headingNumbers.size).toBe(0)
  }))
  it.each(['cancel', 'accept', 'destroy'])('导入使用异步页面确认且生命周期完成：%s', mode => withTemplateDocument(async ({ doc, element, editor }) => {
    const controller = doc._handle.workspaceController, before = editor.state.doc
    const nativeConfirm = vi.spyOn(window, 'confirm').mockImplementation(() => { throw new Error('native dialog must not run') })
    const file = { name: 'local.html', size: 100, text: vi.fn(async () => '<p>confirmed import</p>') }
    try {
      const pending = controller.importDocument({ target: { files: [file], value: 'selected' } })
      await vi.waitFor(() => expect(element.querySelector('[role="dialog"][aria-label="导入并替换正文"]')).not.toBeNull())
      expect(file.text).not.toHaveBeenCalled()
      const modal = element.querySelector('[role="dialog"][aria-label="导入并替换正文"]')
      expect(document.activeElement.textContent).toBe('取消')
      if (mode === 'destroy') doc.destroy()
      else if (mode === 'cancel') modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      else Array.from(modal.querySelectorAll('button')).find(button => button.textContent === '导入并替换').click()
      await pending
      expect(element.querySelector('[role="dialog"][aria-label="导入并替换正文"]')).toBeNull()
      expect(file.text).toHaveBeenCalledTimes(mode === 'accept' ? 1 : 0)
      expect(nativeConfirm).not.toHaveBeenCalled()
      if (mode === 'cancel') expect(editor.state.doc).toBe(before)
      if (mode === 'accept') { expect(editor.state.doc.textContent).toBe('confirmed import'); editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true) }
    } finally { nativeConfirm.mockRestore() }
  }))
  it('任务行保留可打开菜单的块句柄且不改变勾选状态', () => withTemplateDocument(async ({ doc, editor, host }) => {
    doc.setContent('<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>任务回归</p></li></ul>')
    host.handleRange = host.rangeAt(3)
    const from = host.handleRange.from, before = editor.state.doc.nodeAt(from)
    expect(before.type.name).toBe('taskItem')
    expect(host.buildBlockHandleState().buttonKind).toBe('main')
    expect(host.handleIcon).toBe('block-task')
    host.openBlockMenu()
    expect(host.blockMenuOpen).toBe(true)
    expect(editor.state.doc.nodeAt(from)).toBe(before)
    host.closeBlockMenu()
  }))
  it.each([false, true])('任务句柄对齐可见正文，不计入复选框隐藏标签，checked=%s', checked => withTemplateDocument(async ({ doc, editor, host, element }) => {
    doc.setContent(`<ul data-type="taskList"><li data-type="taskItem" data-checked="${checked}"><p>任务正文</p></li></ul>`)
    const box = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height })
    vi.spyOn(element.querySelector('.lark-doc-paper'), 'getBoundingClientRect').mockReturnValue(box(50, 20, 800, 800))
    const createRange = document.createRange.getMockImplementation()
    vi.spyOn(document, 'createRange').mockImplementation(() => {
      const range = createRange()
      range.getClientRects = () => [range.startContainer.parentElement?.closest('label') ? box(110, 212, 260, 20) : box(128, 205, 100, 20)]
      return range
    })
    const range = host.rangeAt(3), before = editor.state.doc
    host.positionBlockHandle(range)
    expect(host.blockHandlePosition.top).toBe(182)
    expect(editor.state.doc).toBe(before)
  }))
  it('表格句柄锚定真实边框，双句柄大小切换不改变首行中线', () => withTemplateDocument(async ({ doc, editor, host, element }) => {
    doc.setContent('<table><tr><td><p>A1</p></td><td><p>B1</p></td></tr></table>')
    const box = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height })
    const paper = element.querySelector('.lark-doc-paper')
    vi.spyOn(paper, 'getBoundingClientRect').mockReturnValue(box(50, 20, 800, 800))
    Object.defineProperty(paper, 'clientLeft', { configurable: true, value: 1 })
    vi.spyOn(editor.view.dom.querySelector('.tableWrapper'), 'getBoundingClientRect').mockReturnValue(box(100, 160, 600, 160))
    vi.spyOn(editor.view.dom.querySelector('table'), 'getBoundingClientRect').mockReturnValue(box(120, 200, 560, 80))
    vi.spyOn(host, 'firstLineInkBounds').mockReturnValue(box(130, 211, 30, 20))
    editor.commands.setTextSelection(4)
    host.positionBlockHandle(host.rangeAt(4))
    await vi.dynamicImportSettled()
    const tableButton = element.querySelector('[data-block-scope="table"]')
    vi.spyOn(tableButton, 'getBoundingClientRect').mockReturnValue(box(0, 0, 40, 24))
    host.positionBlockHandle(host._tableHandleContext.table)
    expect(host.blockHandlePosition).toEqual({ top: 152, left: 25 })
    host.positionBlockHandle(host._tableHandleContext.cell)
    expect(host.blockHandlePosition.top).toBe(188)
    expect(element.querySelectorAll('[data-block-scope="table"]')).toHaveLength(1)
    expect(element.querySelectorAll('[data-block-scope="cell"]')).toHaveLength(1)
  }))
  it.each([['', false, 240], ['图片下方说明', false, 240], ['', true, 240], ['图片下方说明', true, 240], ['', false, 1600], ['高图说明', true, 1600]])('图片句柄顶部对齐，不受浮条、说明和高度影响：%s，首次=%s，高=%s', (caption, cold, height) => withTemplateDocument(async ({ doc, editor, host, element }) => {
    doc.setContent({ type: 'doc', content: [
      { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'reefed' }] }] }] },
      { type: 'image', attrs: { src: 'data:image/png;base64,cG5n', caption } },
    ] })
    let imagePos
    editor.state.doc.descendants((node, pos) => { if (node.type.name === 'image') imagePos = pos })
    const range = { from: imagePos, to: imagePos + 1 }, image = editor.view.nodeDOM(imagePos)
    image.dispatchEvent(new MouseEvent('mouseenter'))
    host.handleRange = range; host.refreshBlockHandle()
    await vi.dynamicImportSettled()
    const paper = element.querySelector('.lark-doc-paper'), frame = image.querySelector('.lark-doc-image-frame'), handle = element.querySelector('.lark-doc-block-handle-main')
    expect(image.querySelector('.lark-doc-image-toolbar')).not.toBeNull()
    let scroll = 0
    const box = (left, top, width, height) => ({ left, top: top - scroll, right: left + width, bottom: top - scroll + height, width, height })
    vi.spyOn(paper, 'getBoundingClientRect').mockImplementation(() => box(50, 20, 800, 800))
    vi.spyOn(image, 'getBoundingClientRect').mockImplementation(() => box(100, 200, 600, 300))
    vi.spyOn(frame, 'getBoundingClientRect').mockImplementation(() => box(100, 200, 600, height))
    vi.spyOn(handle, 'getBoundingClientRect').mockReturnValue(box(0, 0, 42, 26))
    if (cold) handle.remove()
    vi.spyOn(host, 'firstLineInkBounds').mockImplementation(() => box(160, 150, 80, 18))
    const before = editor.state.doc
    host.positionBlockHandle(range)
    expect(host.blockHandlePosition.top).toBe(180)
    scroll = 80; host.positionBlockHandle(range)
    expect(host.blockHandlePosition.top).toBe(180)
    expect(editor.state.doc).toBe(before)
  }))

  it.each(['paragraph', 'image'])('后列%s句柄留在表外，保留前格的点击区域', kind => withTemplateDocument(async ({ doc, editor, host, element }) => {
    const text = value => ({ type: 'paragraph', content: [{ type: 'text', text: value }] })
    doc.setContent({ type: 'doc', content: [{ type: 'table', content: [{ type: 'tableRow', content: [
      { type: 'tableCell', content: [text('A1')] },
      { type: 'tableCell', content: [kind === 'image' ? { type: 'image', attrs: { src: 'data:image/png;base64,cG5n' } } : text('B1')] },
    ] }] }] })
    const box = left => ({ left, top: 200, right: left + 100, bottom: 240, width: 100, height: 40 })
    vi.spyOn(element.querySelector('.lark-doc-paper'), 'getBoundingClientRect').mockReturnValue(box(0))
    vi.spyOn(editor.view.dom.querySelector('table'), 'getBoundingClientRect').mockReturnValue(box(100))
    editor.view.dom.querySelectorAll('td').forEach((cell, i) => { vi.spyOn(cell, 'getBoundingClientRect').mockReturnValue(box(100 + i * 100)) })
    vi.spyOn(host, 'firstLineInkBounds').mockReturnValue(box(208))
    let pos
    editor.state.doc.descendants((node, at) => { if (node.type.name === kind && (kind === 'image' || node.textContent === 'B1')) pos = at })
    if (kind === 'image') vi.spyOn(editor.view.nodeDOM(pos), 'getBoundingClientRect').mockReturnValue(box(200))
    expect(host.blockHandleGeometry({ from: pos, to: pos + editor.state.doc.nodeAt(pos).nodeSize }).left).toBeLessThanOrEqual(58)
  }))
  it('正文拖选按住鼠标时不重定位浮动句柄', () => withTemplateDocument(async ({ host }) => {
    const position = vi.spyOn(host, 'positionBlockHandle')
    host.onEditorPointerMove({ buttons: 1, clientX: 100, clientY: 100 })
    expect(position).not.toHaveBeenCalled()
  }))
  it('表格内块拥有独立范围和双句柄，删除段落不删除整表', () => withTemplateDocument(async ({ doc, editor, host, element }) => {
    doc.setContent('<p>前文</p><table><tbody><tr><td><p>A1</p><p>A-next</p></td><td><p>B1</p></td></tr><tr><td><p>A2</p></td><td><p>B2</p></td></tr></tbody></table><p>后文</p>')
    let pos
    editor.state.doc.descendants((node, at) => { if (node.type.name === 'paragraph' && node.textContent === 'A1') pos = at })
    const range = host.rangeAt(pos + 1)
    expect(editor.state.doc.nodeAt(range.from).type.name).toBe('paragraph')
    editor.commands.setTextSelection(pos + 1); host.positionBlockHandle(range)
    await vi.dynamicImportSettled(); host.refreshBlockHandle()
    expect(element.querySelectorAll('[data-block-scope="table"]')).toHaveLength(1)
    expect(element.querySelectorAll('[data-block-scope="cell"]')).toHaveLength(1)
    host.blockAction('delete')
    expect(editor.view.dom.querySelectorAll('table')).toHaveLength(1)
    expect(editor.getText()).toContain('A-next')
    expect(editor.getText()).toContain('B1')
    editor.state.doc.check(); editor.commands.undo()
    expect(editor.getText()).toContain('A1')
  }))

  it('整表与单元格菜单可互换目标，标题行保持双句柄，类型转换和副本只改当前块', () => withTemplateDocument(async ({ doc, editor, host, element }) => {
    doc.setContent('<table><tbody><tr><td><p>A1</p><p>A-next</p></td><td><p>B1</p></td></tr><tr><td><p>A2</p></td><td><p>B2</p></td></tr></tbody></table>')
    let pos
    editor.state.doc.descendants((node, at) => { if (node.type.name === 'paragraph' && node.textContent === 'A1') pos = at })
    editor.commands.setTextSelection(pos + 1); host.positionBlockHandle(host.rangeAt(pos + 1))
    await vi.dynamicImportSettled()
    element.querySelector('[data-block-scope="table"]').dispatchEvent(new MouseEvent('mouseenter'))
    expect(host.handleIsTable).toBe(true)
    host.tableHandleAction('toggleHeaderRow')
    expect(editor.state.doc.firstChild.firstChild.firstChild.type.name).toBe('tableHeader')
    expect(host.blockMenuOpen).toBe(true)
    expect(element.querySelectorAll('[data-block-scope="cell"]')).toHaveLength(1)
    element.querySelector('[data-block-scope="cell"]').dispatchEvent(new MouseEvent('mouseenter'))
    expect(host.handleIsTable).toBe(false)
    host.blockTypeAction('heading2')
    expect(editor.view.dom.querySelector('th h2')?.textContent).toBe('A1')
    expect(editor.getText()).toContain('B1')
    host.positionBlockHandle(host.rangeAt(editor.state.selection.from)); host.blockAction('duplicate')
    expect(editor.view.dom.querySelectorAll('th h2')).toHaveLength(2)
    expect(editor.view.dom.querySelectorAll('table')).toHaveLength(1)
    editor.state.doc.check()
  }))

  it.each([false, true])('整表菜单均分全部逻辑列，保留合并格和相邻表并能一次撤销，嵌套=%s', nested => withTemplateDocument(async ({ doc, editor, host }) => {
    const inner = nested ? '<table><tr><td colwidth="50"><p>内表甲</p></td><td colwidth="90"><p>内表乙</p></td></tr></table>' : ''
    doc.setContent('<table><tr><td colwidth="80">' + inner + '<p>A1</p></td><td colwidth="180"><p>B1</p></td></tr><tr><td colspan="2" colwidth="80,180"><p>合并格</p></td></tr></table><p>保留段落</p><table><tr><td colwidth="220"><p>相邻表</p></td></tr></table>')
    host.handleRange = { from: 0, to: editor.state.doc.firstChild.nodeSize }
    host.tableHandleAction('distributeColumns')
    const table = editor.state.doc.firstChild
    expect(table.child(0).child(0).attrs.colwidth).toEqual([130])
    expect(table.child(0).child(1).attrs.colwidth).toEqual([130])
    expect(table.child(1).firstChild.attrs.colwidth).toEqual([130, 130])
    expect(editor.state.doc.child(2).firstChild.firstChild.attrs.colwidth).toEqual([220])
    if (nested) {
      const innerTable = table.firstChild.firstChild.firstChild
      expect(innerTable.firstChild.firstChild.attrs.colwidth).toEqual([50])
      expect(innerTable.firstChild.child(1).attrs.colwidth).toEqual([90])
    }
    editor.commands.undo()
    expect(editor.state.doc.firstChild.firstChild.firstChild.attrs.colwidth).toEqual([80])
    expect(editor.state.doc.firstChild.firstChild.child(1).attrs.colwidth).toEqual([180])
    editor.state.doc.check()
  }))
  it.each(['replace', 'edit', 'readonly', 'destroy', 'session'])('等待剪贴板时%s不再剪切旧范围或抢焦点', mode => withTemplateDocument(async ({ doc, editor, host }) => {
    doc.setContent('<p>原段落</p><p>保留正文</p>')
    let finish
    const session = host.session
    const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(() => new Promise(resolve => { finish = resolve })) } })
    const focus = vi.spyOn(editor.view, 'focus').mockImplementation(() => {})
    try {
      const pending = host.copyBlock({ from: 0, to: editor.state.doc.firstChild.nodeSize }, true)
      expect(finish).toBeTypeOf('function')
      if (mode === 'replace') doc.setContent('<p>替换后的正文</p>')
      if (mode === 'edit') editor.commands.insertContent('新输入')
      if (mode === 'readonly') doc.setReadonly(true)
      if (mode === 'session') host.session = { documentId: 'other-document' }
      const before = editor.state.doc
      if (mode === 'destroy') doc.destroy()
      focus.mockClear(); finish()
      expect(await pending).toBe(false)
      expect(editor.state.doc).toBe(before)
      expect(focus).not.toHaveBeenCalled()
      expect(host.error).not.toBe('已剪切区块')
    } finally {
      host.session = session
      if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard)
      else delete navigator.clipboard
    }
  }))
  it.each(['replace', 'edit', 'readonly'])('拖拽期间%s清除旧来源，不能移动新正文', mode => withTemplateDocument(async ({ doc, editor, host }) => {
    doc.setContent('<p>第一段</p><p>第二段</p>')
    host.handleRange = { from: 0, to: editor.state.doc.firstChild.nodeSize }
    host.startBlockDrag({}); host.dropPosition = editor.state.doc.content.size
    if (mode === 'replace') doc.setContent('<p>新第一段</p><p>新第二段</p>')
    if (mode === 'edit') editor.commands.insertContent('新输入')
    if (mode === 'readonly') doc.setReadonly(true)
    const before = editor.state.doc
    host.onBlockDrop({ preventDefault: vi.fn() })
    expect(editor.state.doc).toBe(before)
    expect(host.dragging).toBeNull()
    expect(host.dropPosition).toBeNull()
  }))
  it('副句柄焦点转交主句柄后按Enter仍操作整表', () => withTemplateDocument(async ({ doc, editor, host, element }) => {
    doc.setContent('<table><tbody><tr><td><p>A1</p></td><td><p>B1</p></td></tr></tbody></table>')
    editor.commands.setTextSelection(4); host.positionBlockHandle(host.rangeAt(4))
    await vi.dynamicImportSettled()
    element.querySelector('[data-block-scope="table"]').focus()
    const focused = document.activeElement
    expect(focused.dataset.blockScope).toBe('table')
    expect(focused.classList.contains('lark-doc-block-handle-extra')).toBe(false)
    const other = element.querySelector('.lark-doc-block-handle-extra')
    other.dispatchEvent(new MouseEvent('mouseenter'))
    expect(host.handleIsTable).toBe(true)
    focused.click()
    expect(host.handleIsTable).toBe(true)
    const move = new MouseEvent('mousemove')
    Object.defineProperty(move, 'movementX', { value: 1 })
    other.dispatchEvent(move)
    expect(host.handleIsTable).toBe(false)
  }))
  it.each([['align', 360], ['color', 360], ['align', 1024], ['color', 1024]])('v56 %s子菜单在%s宽度不遮挡自己的触发器且留在视口', (kind, width) => withTemplateDocument(async ({ doc, editor, host, element }) => {
    doc.setContent('<p>目标正文</p>')
    host.handleRange = { from: 0, to: editor.state.doc.firstChild.nodeSize }
    host.openBlockMenu(); await vi.dynamicImportSettled()
    if (kind === 'align') host.openBlockAlignMenuOnHover()
    else host.openBlockColorMenuOnHover()
    await Promise.resolve()
    vi.stubGlobal('innerWidth', width); vi.stubGlobal('innerHeight', 480)
    const trigger = [...element.querySelectorAll('.lark-doc-block-submenu-trigger')].find(e => e.getAttribute('aria-label') === (kind === 'align' ? '缩进和对齐' : '颜色'))
    const menu = element.querySelector(kind === 'align' ? '.lark-doc-block-submenu:not(.lark-doc-block-color-submenu)' : '.lark-doc-block-color-submenu')
    const rect = { left: 112, right: 326, top: 300, bottom: 332, width: 214, height: 32 }, height = kind === 'align' ? 237 : 365
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(rect)
    vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue({ width: 230, height })
    try {
      if (kind === 'align') host.positionBlockAlignMenu()
      else host.positionBlockColorMenu()
      const style = kind === 'align' ? host.blockAlignMenuStyle : host.blockColorMenuStyle
      const left = parseFloat(style.left), top = parseFloat(style.top), visibleHeight = Math.min(height, parseFloat(style.maxHeight) || height)
      expect(left).toBeGreaterThanOrEqual(8)
      expect(left + 230).toBeLessThanOrEqual(width - 8)
      expect(top).toBeGreaterThanOrEqual(8)
      expect(top + visibleHeight).toBeLessThanOrEqual(472)
      expect(left >= rect.right || left + 230 <= rect.left || top >= rect.bottom || top + visibleHeight <= rect.top).toBe(true)
    } finally { vi.unstubAllGlobals() }
  }))

  it.each(['align', 'color'])('v56 %s子菜单保持打开从窄短屏切到宽屏时重新测量自然高度', kind => withTemplateDocument(async ({ doc, editor, host, element }) => {
    doc.setContent('<p>目标正文</p>')
    host.handleRange = { from: 0, to: editor.state.doc.firstChild.nodeSize }
    host.openBlockMenu(); await vi.dynamicImportSettled()
    if (kind === 'align') host.openBlockAlignMenuOnHover()
    else host.openBlockColorMenuOnHover()
    await Promise.resolve()
    const trigger = [...element.querySelectorAll('.lark-doc-block-submenu-trigger')].find(e => e.getAttribute('aria-label') === (kind === 'align' ? '缩进和对齐' : '颜色'))
    const menu = element.querySelector(kind === 'align' ? '.lark-doc-block-submenu:not(.lark-doc-block-color-submenu)' : '.lark-doc-block-color-submenu')
    const height = kind === 'align' ? 237 : 365
    let rect = { left: 112, right: 326, top: 100, bottom: 132 }
    vi.spyOn(trigger, 'getBoundingClientRect').mockImplementation(() => rect)
    vi.spyOn(menu, 'getBoundingClientRect').mockImplementation(() => ({ width: 230, height: Math.min(height, parseFloat(menu.style.maxHeight) || height) }))
    const position = () => kind === 'align' ? host.positionBlockAlignMenu() : host.positionBlockColorMenu()
    try {
      vi.stubGlobal('innerWidth', 360); vi.stubGlobal('innerHeight', 180)
      position()
      expect(parseFloat(menu.style.maxHeight)).toBeLessThan(height)
      vi.stubGlobal('innerWidth', 1024); vi.stubGlobal('innerHeight', 480)
      rect = { left: 112, right: 326, top: 300, bottom: 332 }
      position()
      const style = kind === 'align' ? host.blockAlignMenuStyle : host.blockColorMenuStyle
      expect(parseFloat(style.left)).toBeGreaterThanOrEqual(rect.right)
      expect(parseFloat(style.top) + height).toBeLessThanOrEqual(472)
    } finally { vi.unstubAllGlobals() }
  }))

  it.each(['align', 'color'].flatMap(kind => ['mouseover', 'focus'].flatMap(input => ['type', 'ai', 'copy'].map(target => [kind, input, target]))))('v58 %s 子菜单通过%s回到%s普通项立即关闭且不改正文', (kind, input, target) => withTemplateDocument(async ({ doc, editor, host, element }) => {
    doc.setContent('<p>前文</p><p>目标正文</p>')
    host.handleRange = host.rangeAt(editor.state.doc.firstChild.nodeSize + 1)
    host.openBlockMenu(); await vi.dynamicImportSettled()
    const before = editor.state.doc, menu = element.querySelector('.lark-doc-block-menu')
    const trigger = menu.querySelector('[aria-label="' + (kind === 'align' ? '缩进和对齐' : '颜色') + '"]')
    trigger.dispatchEvent(new MouseEvent('mouseenter'))
    await Promise.resolve()
    expect(host[kind === 'align' ? 'blockAlignMenuOpen' : 'blockColorMenuOpen']).toBe(true)
    const button = menu.querySelector(target === 'type' ? '[aria-label="高亮块"]' : target === 'ai' ? '.lark-doc-block-menu-ai' : '[data-block-action="copy"]')
    if (input === 'focus') button.focus()
    else (button.querySelector('svg') || button).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    await Promise.resolve()
    expect(host.blockAlignMenuOpen).toBe(false)
    expect(host.blockColorMenuOpen).toBe(false)
    expect(element.querySelector('.lark-doc-block-submenu')).toBeNull()
    expect(host.blockMenuOpen).toBe(true)
    expect(editor.state.doc).toBe(before)
    if (input === 'focus') expect(document.activeElement).toBe(button)
  }))

  it.each([
    ['taskItem', '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>目标任务</p></li></ul>'],
    ['listItem', '<ul><li><p>目标任务</p></li></ul>'],
    ['blockquote', '<blockquote><p>目标任务</p></blockquote>'],
    ['callout', '<div data-type="callout"><p>目标任务</p></div>'],
  ].flatMap(([type, html]) => ['align', 'color'].map(action => [type, html, action])))('v58 %s容器内%s操作只作用目标文字且一次撤销', (type, html, action) => withTemplateDocument(async ({ doc, editor, host, element }) => {
    doc.setContent('<p>前文</p>' + html + '<p>尾文</p>')
    let range
    editor.state.doc.descendants((node, pos) => { if (!range && node.type.name === type && node.textContent === '目标任务') range = { from: pos, to: pos + node.nodeSize } })
    const before = editor.state.doc
    host.handleRange = range; host.openBlockMenu(); await vi.dynamicImportSettled()
    if (action === 'align') host.blockAlignAction('center')
    else host.blockColorAction('#ff0000')
    let target
    editor.state.doc.descendants(node => { if (node.isTextblock && node.textContent === '目标任务') target = node })
    if (action === 'align') expect(target.attrs.textAlign).toBe('center')
    else expect(target.firstChild.marks.some(mark => mark.type.name === 'textStyle' && mark.attrs.color === '#ff0000')).toBe(true)
    expect(editor.state.doc.firstChild.eq(before.firstChild)).toBe(true)
    expect(editor.state.doc.lastChild.eq(before.lastChild)).toBe(true)
    editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true)
  }))

  it('v58 容器缩进仍优先光标所在块，不被新文字边界定位改到首段', () => withTemplateDocument(async ({ doc, editor, host }) => {
    doc.setContent('<blockquote><p>首段</p><p>光标段</p></blockquote><p>尾文</p>')
    let range, cursor
    editor.state.doc.descendants((n, pos) => { if (n.type.name === 'blockquote') range = { from: pos, to: pos + n.nodeSize }; if (n.type.name === 'paragraph' && n.textContent === '光标段') cursor = pos + 1 })
    editor.commands.setTextSelection(cursor)
    expect(host.blockIndentTarget(range).node.textContent).toBe('光标段')
  }))

  it('v58 块菜单及两个子菜单无原生title并保留可访问名称', () => withTemplateDocument(async ({ host, element }) => {
    host.handleRange = host.rangeAt(1); host.openBlockMenu(); await vi.dynamicImportSettled()
    const menu = element.querySelector('.lark-doc-block-menu')
    expect(menu.querySelector('[title]')).toBeNull()
    for (const label of ['缩进和对齐', '颜色']) {
      const trigger = menu.querySelector('[aria-label="' + label + '"]')
      trigger.dispatchEvent(new MouseEvent('mouseenter')); await Promise.resolve()
      const panel = element.querySelector('[role="menu"][aria-label="' + label + '"]')
      expect(panel.querySelector('[title]')).toBeNull()
      expect([...panel.querySelectorAll('button')].every(button => (button.getAttribute('aria-label') || button.textContent).trim())).toBe(true)
    }
  }))

  it.each(['align', 'color'])('v58 移入%s子菜单内的按钮和焦点不关闭当前层', kind => withTemplateDocument(async ({ host, element }) => {
    host.handleRange = host.rangeAt(1); host.openBlockMenu(); await vi.dynamicImportSettled()
    const trigger = element.querySelector('.lark-doc-block-menu [aria-label="' + (kind === 'align' ? '缩进和对齐' : '颜色') + '"]')
    trigger.dispatchEvent(new MouseEvent('mouseenter')); await Promise.resolve()
    const panel = element.querySelector(kind === 'align' ? '.lark-doc-block-submenu:not(.lark-doc-block-color-submenu)' : '.lark-doc-block-color-submenu')
    const button = panel.querySelector('button')
    button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); button.focus(); await Promise.resolve()
    expect(panel.isConnected).toBe(true)
    expect(host[kind === 'align' ? 'blockAlignMenuOpen' : 'blockColorMenuOpen']).toBe(true)
    expect(document.activeElement).toBe(button)
  }))

  it.each(['mouseover', 'focus'])('v58 下方添加经%s回主菜单时收起且可继续进入对齐子菜单', input => withTemplateDocument(async ({ doc, editor, host, element }) => {
    doc.setContent('<p>目标正文</p>')
    host.handleRange = host.rangeAt(1); host.openBlockMenu(); await vi.dynamicImportSettled()
    const before = editor.state.doc, menu = element.querySelector('.lark-doc-block-menu')
    const add = menu.querySelector('[aria-label="在下方添加"]')
    add.dispatchEvent(new MouseEvent('mouseenter')); await vi.dynamicImportSettled()
    expect(host.menuOpen).toBe(true)
    const type = menu.querySelector('[aria-label="正文"]')
    if (input === 'focus') type.focus()
    else type.querySelector('svg').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    await Promise.resolve()
    expect(host.menuOpen).toBe(false)
    expect(host._blockInsertContext).toBeNull()
    expect(host.blockMenuOpen).toBe(true)
    const align = menu.querySelector('[aria-label="缩进和对齐"]')
    align.dispatchEvent(new MouseEvent('mouseenter')); await Promise.resolve()
    const panel = element.querySelector('.lark-doc-block-submenu')
    panel.querySelector('button').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    panel.querySelector('button').focus(); await Promise.resolve()
    expect(host.blockAlignMenuOpen).toBe(true)
    expect(editor.state.doc).toBe(before)
  }))

  it('冷菜单加载完成后重新定位，关闭后移除菜单', () => withTemplateDocument(async ({ host, element }) => {
    host.handleRange = host.rangeAt(1)
    const position = vi.spyOn(host, 'positionBlockMenu')
    host.openBlockMenu()
    await vi.dynamicImportSettled(); await Promise.resolve()
    expect(position).toHaveBeenCalledWith('.lark-doc-block-menu')
    expect(element.querySelector('.lark-doc-block-menu')).not.toBeNull()
    expect(host.blockMenuStyle.top).toBeDefined()
    host.closeBlockMenu()
    expect(element.querySelector('.lark-doc-block-menu')).toBeNull()
  }))

  it.each([
    ['taskItem', '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p><strong>目标正文</strong></p></li><li data-type="taskItem" data-checked="false"><p>另一任务</p></li></ul>'],
    ['listItem', '<ul><li><p><strong>目标正文</strong></p></li><li><p>另一项目</p></li></ul>'],
    ['blockquote', '<blockquote><p><strong>目标正文</strong></p></blockquote>'],
    ['codeBlock', '<pre><code>目标正文</code></pre>'],
  ])('六点%s菜单显示类型网格并只转换目标，内容和撤销保留', (kind, html) => withTemplateDocument(async ({ doc, editor, host, element }) => {
    doc.setContent('<p>前文</p>' + html + '<p>后文</p>')
    let target
    editor.state.doc.descendants((node, pos) => { if (!target && node.type.name === kind && node.textContent === '目标正文') target = { from: pos, to: pos + node.nodeSize } })
    let textBlockId
    editor.state.doc.descendants(node => { if (node.isTextblock && node.textContent === '目标正文') textBlockId = node.attrs.blockId })
    const before = editor.state.doc
    editor.commands.setTextSelection(1)
    host.handleRange = target; host.openBlockMenu()
    await vi.dynamicImportSettled()
    const grid = element.querySelector('.lark-doc-block-type-actions')
    expect(grid).not.toBeNull()
    expect(grid.querySelector('[aria-label="高亮块"]')).not.toBeNull()
    grid.querySelector('[aria-label="二级标题"]').click()
    expect(editor.view.dom.querySelector('h2')?.textContent).toBe('目标正文')
    expect(editor.state.doc.textContent).toBe(before.textContent)
    let converted
    editor.state.doc.descendants(node => { if (node.type.name === 'heading' && node.textContent === '目标正文') converted = node })
    expect(converted.attrs.blockId).toBe(textBlockId)
    if (kind === 'taskItem') {
      const tasks = []; editor.state.doc.descendants(node => { if (node.type.name === 'taskItem') tasks.push({ text: node.textContent, checked: node.attrs.checked }) })
      expect(tasks).toEqual([{ text: '另一任务', checked: false }])
    }
    expect(editor.commands.undo()).toBe(true)
    expect(editor.state.doc.eq(before)).toBe(true)
  }))

  it.each([[1, false, 0], [2, false, 0], [1, true, 0], [3, true, 1], [4, true, 2]])('v57 重复点击H%s编号%s缩进%s取消标题并保留内容身份和单次撤销', (level, numbering, indent) => withTemplateDocument(async ({ doc, editor, host, element }) => {
    doc.setContent(`<p>前文</p><p data-indent="1">中间</p><h${level} data-numbering="${numbering}" data-numbering-start="9" data-indent="${indent}"><strong>目标正文</strong></h${level}><h1 data-numbering="true">后标题</h1><p>尾文</p>`)
    let target
    editor.state.doc.descendants((node, pos) => { if (node.type.name === 'heading' && node.textContent === '目标正文') target = { node, pos } })
    const before = editor.state.doc
    host.handleRange = { from: target.pos, to: target.pos + target.node.nodeSize }
    host.openBlockMenu(); await vi.dynamicImportSettled()
    const label = `${'一二三四'[level - 1]}级标题`
    element.querySelector(`.lark-doc-block-type-actions [aria-label="${label}"]`).click()
    let converted
    editor.state.doc.descendants(node => { if (node.isTextblock && node.textContent === '目标正文') converted = node })
    expect(converted.type.name).toBe('paragraph')
    expect(converted.attrs.blockId).toBe(target.node.attrs.blockId)
    expect(converted.attrs.indent).toBe(indent)
    expect(converted.firstChild.marks.map(mark => mark.type.name)).toContain('bold')
    expect(editor.state.doc.textContent).toBe(before.textContent)
    expect(documentOperations.collectOutline(editor.state.doc).some(item => item.text.includes('目标正文'))).toBe(false)
    const lists = []; editor.state.doc.descendants(node => { if (node.type.name === 'orderedList') lists.push(node) })
    expect(lists).toHaveLength(numbering ? 1 : 0)
    if (numbering) {
      expect(lists[0].attrs.start).toBe(1)
      expect(lists[0].attrs.type).toBe(['1', 'a', 'i'][indent])
      expect([...documentOperations.computeOrderedListNumbers(editor.state.doc).values()].map(item => item.label)).toEqual(['1.', 'a.', 'i.'].slice(indent, indent + 1))
    }
    expect(editor.commands.undo()).toBe(true)
    expect(editor.state.doc.eq(before)).toBe(true)
  }))

  it.each(['1', 'a', 'i'])('v57 有序列表原生type=%s的显示与HTML往返一致', type => withTemplateDocument(async ({ doc, editor }) => {
    doc.setContent(`<ol type="${type}" start="2"><li><p>第二项</p></li></ol>`)
    const labels = () => [...documentOperations.computeOrderedListNumbers(editor.state.doc).values()].map(item => item.label)
    const expected = { 1: '2.', a: 'b.', i: 'ii.' }[type]
    expect(labels()).toEqual([expected])
    doc.setContent(editor.getHTML())
    expect(labels()).toEqual([expected])
    expect(editor.state.doc.firstChild.attrs.type || '1').toBe(type)
  }))

  it('v57 只读时拒绝当前标题取消，标题有序按钮仍仅切编号', () => withTemplateDocument(async ({ doc, editor, host }) => {
    doc.setContent('<h1 data-numbering="true">标题</h1>')
    host.handleRange = { from: 0, to: editor.state.doc.firstChild.nodeSize }
    expect(host.blockTypeAction('orderedList')).toBe(true)
    expect(editor.state.doc.firstChild.type.name).toBe('heading')
    expect(editor.state.doc.firstChild.attrs.numbering).toBe(false)
    expect(host.blockTypeAction('orderedList')).toBe(true)
    expect(editor.state.doc.firstChild.attrs.numbering).toBe(true)
    const before = editor.state.doc
    doc.setReadonly(true)
    expect(host.blockTypeAction('heading1')).toBe(false)
    expect(editor.state.doc).toBe(before)
  }))

  it.each([[false, 'disabled'], [true, 'disabled'], [false, 'allow'], [true, 'allow']])('v57 目标格式编号%s被%s策略限制时拒绝取消标题且不改历史', (numbering, policy) => withTemplateDocument(async ({ doc, editor, host }) => {
    doc.setContent(`<h1 data-numbering="${numbering}">目标正文</h1><p>尾文</p>`)
    const target = numbering ? 'orderedList' : 'paragraph'
    doc.patchProps({ config: { blockMenu: policy === 'disabled' ? { disabled: [target] } : { allow: ['heading1'] } } })
    host.handleRange = { from: 0, to: editor.state.doc.firstChild.nodeSize }
    const before = editor.state
    expect(host.blockTypeAction('heading1')).toBe(false)
    expect(editor.state).toBe(before)
  }))

  it.each([null, '1', 'a', 'i'].flatMap(type => ['before', 'after'].map(side => [type, side])))('v57 取消标题不合并相邻type=%s的%s列表或改其起点和格式', (type, side) => withTemplateDocument(async ({ doc, editor, host }) => {
    const neighbor = `<ol start="7"${type ? ` type="${type}"` : ''}><li><p><em>邻居</em></p></li></ol>`
    doc.setContent(`<p>前文</p>${side === 'before' ? neighbor : ''}<h3 data-indent="1" data-numbering="true">目标正文</h3>${side === 'after' ? neighbor : ''}<p>尾文</p>`)
    const before = editor.state.doc
    let heading, neighborBefore
    before.descendants((node, pos) => {
      if (node.type.name === 'heading') heading = { node, pos }
      if (node.type.name === 'orderedList') neighborBefore = node.toJSON()
    })
    host.handleRange = { from: heading.pos, to: heading.pos + heading.node.nodeSize }
    expect(host.blockTypeAction('heading3')).toBe(true)
    const lists = []; editor.state.doc.descendants(node => { if (node.type.name === 'orderedList') lists.push(node) })
    expect(lists).toHaveLength(2)
    expect(lists.find(node => node.textContent === '邻居').toJSON()).toEqual(neighborBefore)
    const converted = lists.find(node => node.textContent === '目标正文')
    expect(converted.attrs).toMatchObject({ start: 1, type: 'a' })
    expect(converted.firstChild.firstChild.attrs.blockId).toBe(heading.node.attrs.blockId)
    expect(editor.commands.undo()).toBe(true)
    expect(editor.state.doc.eq(before)).toBe(true)
  }))

  it('v57 取消编号标题时包裹失败不能提交部分转换', () => withTemplateDocument(async ({ doc, editor, host }) => {
    doc.setContent('<h1 data-numbering="true">目标正文</h1><p>尾文</p>')
    host.handleRange = { from: 0, to: editor.state.doc.firstChild.nodeSize }
    const before = editor.state.doc
    const blocked = vi.spyOn(editor.commandManager.rawCommands, 'wrapInList').mockImplementation(() => () => false)
    try {
      expect(host.blockTypeAction('heading1')).toBe(false)
      expect(editor.state.doc).toBe(before)
    } finally { blocked.mockRestore() }
  }))

  it('v57 选中文字链接只显示地址并聚焦，保留样式与撤销且拒绝危险协议', () => withTemplateDocument(async ({ doc, editor, host, element }) => {
    doc.setContent('<p><strong>链接文字</strong> 保留</p>')
    editor.commands.setTextSelection({ from: 1, to: 5 })
    const before = editor.state.doc
    host.openLinkDialog(); await vi.dynamicImportSettled()
    const dialog = element.querySelector('.lark-doc-link-dialog'), address = dialog.querySelector('[aria-label="链接地址"]')
    expect(dialog.querySelectorAll('input')).toHaveLength(1)
    expect(dialog.classList.contains('is-only-link')).toBe(true)
    expect(document.activeElement).toBe(address)
    address.value = 'javascript:alert(1)'; address.dispatchEvent(new Event('input', { bubbles: true }))
    expect(dialog.querySelector('button').disabled).toBe(true)
    address.value = 'https://example.com/parity'; address.dispatchEvent(new Event('input', { bubbles: true }))
    await Promise.resolve()
    dialog.querySelector('button').click()
    expect(editor.state.doc.textContent).toBe(before.textContent)
    expect(editor.state.doc.firstChild.firstChild.marks.map(mark => mark.type.name)).toEqual(expect.arrayContaining(['bold', 'link']))
    expect(editor.commands.undo()).toBe(true)
    expect(editor.state.doc.eq(before)).toBe(true)
  }))

  it.each([false, true])('v57 空光标或已有链接编辑=%s保持两字段与单次撤销', edit => withTemplateDocument(async ({ doc, editor, host, element }) => {
    doc.setContent(edit ? '<p><a href="https://example.com/old">原链接</a> 保留</p>' : '<p>保留正文</p>')
    editor.commands.setTextSelection(edit ? 2 : 1)
    const before = editor.state.doc
    host.openLinkDialog(); await vi.dynamicImportSettled()
    const dialog = element.querySelector('.lark-doc-link-dialog'), input = dialog.querySelector('[aria-label="链接文本"]'), address = dialog.querySelector('[aria-label="链接地址"]')
    expect(dialog.querySelectorAll('input')).toHaveLength(2)
    expect(dialog.classList.contains('is-only-link')).toBe(false)
    input.value = '新链接'; input.dispatchEvent(new Event('input', { bubbles: true }))
    address.value = 'https://example.com/new'; address.dispatchEvent(new Event('input', { bubbles: true }))
    await Promise.resolve()
    dialog.querySelector('button').click()
    expect(editor.getHTML()).toContain('href="https://example.com/new"')
    expect(editor.state.doc.textContent).toContain('新链接')
    expect(editor.commands.undo()).toBe(true)
    expect(editor.state.doc.eq(before)).toBe(true)
  }))

  it('v57 链接弹窗保持草稿跨视窗resize重新定位并在关闭后解绑', () => withTemplateDocument(async ({ doc, editor, host, element }) => {
    doc.setContent('<p>链接文字</p>'); editor.commands.setTextSelection({ from: 1, to: 5 })
    vi.stubGlobal('innerWidth', 1536); vi.stubGlobal('innerHeight', 782)
    vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({ left: 700, right: 710, top: 100, bottom: 128 })
    const added = vi.spyOn(window, 'addEventListener'), removed = vi.spyOn(window, 'removeEventListener')
    try {
      host.openLinkDialog(); await vi.dynamicImportSettled()
      const dialog = element.querySelector('.lark-doc-link-dialog'), input = dialog.querySelector('[aria-label="链接地址"]')
      const measure = vi.spyOn(dialog, 'getBoundingClientRect').mockImplementation(() => ({ width: Math.min(434, window.innerWidth - 16), height: 82 }))
      input.value = 'https://example.com/draft'; input.dispatchEvent(new Event('input', { bubbles: true }))
      await Promise.resolve(); host.refreshDialogs()
      const before = editor.state.doc
      vi.stubGlobal('innerWidth', 360); vi.stubGlobal('innerHeight', 180)
      window.dispatchEvent(new Event('resize'))
      expect(parseFloat(dialog.style.left) + 344).toBeLessThanOrEqual(352)
      expect(parseFloat(dialog.style.top) + 82).toBeLessThanOrEqual(172)
      expect(input.value).toBe('https://example.com/draft')
      expect(editor.state.doc).toBe(before)
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      await Promise.resolve()
      expect(dialog.isConnected).toBe(false)
      const resizeHandlers = added.mock.calls.filter(([type]) => type === 'resize').map(([, handler]) => handler)
      expect(resizeHandlers.length).toBeGreaterThan(0)
      resizeHandlers.forEach(handler => expect(removed.mock.calls.some(([type, value]) => type === 'resize' && value === handler)).toBe(true))
      measure.mockClear()
      window.dispatchEvent(new Event('resize'))
      expect(measure).not.toHaveBeenCalled()
    } finally { added.mockRestore(); removed.mockRestore(); vi.unstubAllGlobals() }
  }))

  it('v57 选中文字链接取消保留原文与选区并归还编辑焦点', () => withTemplateDocument(async ({ doc, editor, host, element }) => {
    doc.setContent('<p>链接文字</p>'); editor.commands.setTextSelection({ from: 1, to: 5 })
    const before = editor.state
    host.openLinkDialog(); await vi.dynamicImportSettled()
    const input = element.querySelector('[aria-label="链接地址"]')
    expect(document.activeElement).toBe(input)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(editor.state.doc).toBe(before.doc)
    expect(editor.state.selection.eq(before.selection)).toBe(true)
    expect(document.activeElement).toBe(editor.view.dom)
  }))

  it('v54 块菜单按已有标题级别加一级展开，包含隐藏容器中的未编号标题', () => withTemplateDocument(async ({ doc, editor, host, element }) => {
    doc.setContent('<h4>four</h4><p>body</p>')
    host.refreshDocumentState(); host.handleRange = { from: 0, to: editor.state.doc.firstChild.nodeSize }; host.openBlockMenu()
    await vi.dynamicImportSettled()
    expect(element.querySelector('[aria-label="四级标题"]')).not.toBeNull()
    expect(element.querySelector('[aria-label="五级标题"]')).not.toBeNull()
    expect(element.querySelector('[aria-label="六级标题"]')).toBeNull()
    doc.setContent('<div data-type="callout"><h6>hidden six</h6></div><p>body</p>')
    host.refreshDocumentState()
    expect(host.visibleBlockTypeActions.some(item => item.id === 'heading7')).toBe(true)
    expect(host.visibleBlockTypeActions.some(item => item.id === 'heading8')).toBe(false)
  }))

  it('v54 嵌套有序列表转H4保留编号、缩进、后代正文和撤销，并进入目录', () => withTemplateDocument(async ({ doc, editor, host }) => {
    doc.setContent('<h1 data-numbering="true">one</h1><h1 data-numbering="true">two</h1><ol><li><p>before</p><ol><li><p>target</p><ol><li><p>child</p></li></ol></li></ol></li></ol><p>after</p>')
    const before = editor.state.doc
    let pos, node; before.descendants((n,p) => { if(n.type.name === 'listItem' && n.firstChild.textContent === 'target') { pos=p;node=n } })
    host.handleRange = { from: pos, to: pos + node.nodeSize }
    expect(host.blockTypeAction('heading4')).toBe(true)
    const { collectOutline } = await import('../../src/core/documentOperations')
    const title = editor.getJSON().content.find(n => n.type === 'heading' && n.content?.[0]?.text === 'target')
    expect(title?.attrs).toMatchObject({level:4,numbering:true,indent:1})
    expect(collectOutline(editor.state.doc).some(n=>n.text==='2.1 target')).toBe(true)
    expect(editor.state.doc.textContent).toBe(before.textContent)
    editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true)
  }))

  it('v54 在下方添加只展开子菜单，取消不改正文', () => withTemplateDocument(async ({ doc, editor, host, element }) => {
    doc.setContent('<p>before</p><p>after</p>')
    host.handleRange = { from: 0, to: editor.state.doc.firstChild.nodeSize }; host.openBlockMenu()
    await vi.dynamicImportSettled()
    const before = editor.state.doc
    element.querySelector('.lark-doc-block-menu [aria-label="在下方添加"]').click()
    await vi.dynamicImportSettled()
    expect(host.menuOpen).toBe(true)
    expect(editor.state.doc).toBe(before)
    host.closeCommandMenu(true)
    expect(editor.state.doc).toBe(before)
  }))

  it.each(['ol', 'ul'])('v54 嵌套%s转标题只改变目标，保留显式起始、文字样式和区块身份', kind => withTemplateDocument(async ({ doc, editor, host }) => {
    doc.setContent(`<${kind} start="7"><li><p>parent</p><${kind} start="4"><li><p data-block-id="kept_heading"><strong>target</strong></p><${kind}><li><p>child</p></li></${kind}></li><li><p>sibling</p></li></${kind}></li></${kind}><p>after</p>`)
    const before = editor.state.doc
    let pos, node; before.descendants((n, p) => { if (n.type.name === 'listItem' && n.firstChild.textContent === 'target') { pos = p; node = n } })
    host.handleRange = { from: pos, to: pos + node.nodeSize }
    expect(host.blockTypeAction('heading4')).toBe(true)
    let heading; editor.state.doc.descendants(n => { if (n.type.name === 'heading') heading = n })
    expect(heading.attrs).toMatchObject({ level: 4, blockId: 'kept_heading', indent: 1, numbering: kind === 'ol', numberingStart: kind === 'ol' ? 4 : null })
    expect(heading.firstChild.marks.map(mark => mark.type.name)).toContain('bold')
    expect(editor.state.doc.textContent).toBe(before.textContent)
    editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true)
  }))

  it('v54 在下方添加拒绝过期目标，并保持未选择时正文和撤销历史不变', () => withTemplateDocument(async ({ doc, editor, host, element }) => {
    doc.setContent('<p>before</p><p>after</p>')
    host.handleRange = { from: 0, to: editor.state.doc.firstChild.nodeSize }; host.openBlockMenu()
    await vi.dynamicImportSettled()
    element.querySelector('.lark-doc-block-menu [aria-label="在下方添加"]').click()
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, 'new')
    const changed = editor.state.doc
    expect(host.chooseCommand({ id: 'code' })).toBe(false)
    expect(editor.state.doc).toBe(changed)
    expect(host.menuOpen).toBe(false)
  }))

  it('v54 下方添加的模板库在权限收回后拒绝旧按钮，不插空块', () => withTemplateDocument(async ({ doc, editor, host, element }) => {
    host.handleRange = { from: 0, to: editor.state.doc.firstChild.nodeSize }; host.openBlockMenu()
    await vi.dynamicImportSettled()
    element.querySelector('.lark-doc-block-menu [aria-label="在下方添加"]').click()
    host.openTemplateLibrary(); await vi.dynamicImportSettled()
    const stale = element.querySelector('[data-template-id="personal"] .lark-doc-template-use')
    const scope = host._templateInsertion, before = editor.state.doc
    doc.patchProps({ config: { blockMenu: { disabled: ['addBelow'] } } })
    expect(host.templateInsertionCurrent(scope)).toBe(false)
    stale.click()
    expect(editor.state.doc).toBe(before)
  }))

  it.each(['blockAlignMenuOpen', 'blockColorMenuOpen'])('v54 从%s进入下方添加关闭旧子层，真实指针仍可插入', flag => withTemplateDocument(async ({ doc, editor, host, element }) => {
    doc.setContent('<p>before</p><p>after</p>')
    const before = editor.state.doc
    host.handleRange = { from: 0, to: before.firstChild.nodeSize }; host.openBlockMenu()
    await vi.dynamicImportSettled()
    host[flag] = true
    element.querySelector('.lark-doc-block-menu [aria-label="在下方添加"]').click()
    await vi.dynamicImportSettled()
    expect(host[flag]).toBe(false)
    const code = element.querySelector('[data-command-id="code"]')
    code.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true })); code.click()
    expect(editor.state.doc.child(1).type.name).toBe('codeBlock')
    editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true)
  }))

  it('v54 下方添加在只换文档身份时拒绝旧选择', () => withTemplateDocument(async ({ doc, editor, host, element }) => {
    host.handleRange = { from: 0, to: editor.state.doc.firstChild.nodeSize }; host.openBlockMenu()
    await vi.dynamicImportSettled()
    element.querySelector('.lark-doc-block-menu [aria-label="在下方添加"]').click()
    const before = editor.state.doc
    doc.patchProps({ documentId: 'v54-other-document' })
    expect(editor.state.doc).toBe(before)
    expect(host.chooseCommand({ id: 'code' })).toBe(false)
    expect(editor.state.doc).toBe(before)
  }))

  it.each(['success', 'load-failure', 'edit-during-load'])('v54 下方添加图表在%s时无预提交空段，成功可一次撤销', mode => withTemplateDocument(async ({ doc, editor, host, element }) => {
    doc.setContent('<p>before</p><p>after</p>')
    host.handleRange = { from: 0, to: editor.state.doc.firstChild.nodeSize }; host.openBlockMenu()
    await vi.dynamicImportSettled()
    element.querySelector('.lark-doc-block-menu [aria-label="在下方添加"]').click()
    await vi.dynamicImportSettled()
    const before = editor.state.doc
    if (mode === 'load-failure') vi.doMock('../../src/ui/diagramMenu', () => { throw new Error('offline') })
    try {
      const pending = host.chooseCommand({ id: 'diagram', diagramType: 'flowchart' })
      expect(editor.state.doc).toBe(before)
      if (mode === 'edit-during-load') editor.commands.insertContentAt(editor.state.doc.content.size - 1, 'new')
      const current = editor.state.doc
      const result = await pending
      if (mode === 'success') {
        expect(result).toBe(true)
        expect(editor.state.doc.child(1).type.name).toBe('codeBlock')
        editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true)
      } else {
        expect(result).toBe(false)
        expect(editor.state.doc).toBe(current)
      }
    } finally { vi.doUnmock('../../src/ui/diagramMenu') }
  }))

  it('v54 下方添加图表只发布完整内容，宿主同步替换后不误插新正文', () => withTemplateDocument(async ({ doc, editor, host, element }) => {
    host.handleRange = { from: 0, to: editor.state.doc.firstChild.nodeSize }; host.openBlockMenu()
    await vi.dynamicImportSettled()
    element.querySelector('.lark-doc-block-menu [aria-label="在下方添加"]').click()
    await vi.dynamicImportSettled()
    let published
    const replace = () => {
      published = editor.getJSON()
      editor.off('update', replace)
      editor.commands.setContent('<p>host replacement</p>')
    }
    editor.on('update', replace)
    await host.chooseCommand({ id: 'diagram', diagramType: 'flowchart' })
    expect(published.content[1].type).toBe('codeBlock')
    expect(editor.state.doc.textContent).toBe('host replacement')
    expect(editor.state.doc.childCount).toBe(1)
  }))

  it('v54 下方添加图表的插入命令失败时不提交占位', () => withTemplateDocument(async ({ editor, host, element }) => {
    host.handleRange = { from: 0, to: editor.state.doc.firstChild.nodeSize }; host.openBlockMenu()
    await vi.dynamicImportSettled()
    element.querySelector('.lark-doc-block-menu [aria-label="在下方添加"]').click()
    await vi.dynamicImportSettled()
    const before = editor.state.doc
    const command = vi.spyOn(editor.commandManager.rawCommands, 'insertContent').mockImplementation(() => () => false)
    try {
      expect(await host.chooseCommand({ id: 'diagram', diagramType: 'flowchart' })).toBe(false)
      expect(editor.state.doc).toBe(before)
    } finally { command.mockRestore() }
  }))

  it('块菜单隐藏额外操作，下方添加展开真实插入选择并保持目标位置和单次撤销', () => withTemplateDocument(async ({ doc, editor, host, element }) => {
    doc.setContent('<p>前文</p><p>后文</p>')
    const before = editor.state.doc
    host.handleRange = { from: 0, to: editor.state.doc.firstChild.nodeSize }; host.openBlockMenu()
    await vi.dynamicImportSettled()
    const menu = element.querySelector('.lark-doc-block-menu')
    expect(menu.textContent).not.toMatch(/创建副本|上移区块|下移区块/)
    const add = [...menu.querySelectorAll('button')].find(b => b.textContent === '在下方添加')
    expect(add?.getAttribute('aria-haspopup')).toBe('menu')
    add.click(); await vi.dynamicImportSettled()
    expect(host.menuOpen).toBe(true)
    const code = element.querySelector('[data-command-id="code"]')
    code.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
    expect(host._blockInsertContext).toBeTruthy()
    code.click()
    expect(editor.state.doc.content.content.map(node => node.type.name)).toEqual(['paragraph', 'codeBlock', 'paragraph'])
    expect(editor.state.doc.textContent).toBe('前文后文')
    editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true)
  }))

  it('块菜单评论接真实composer并指向句柄块，未配置服务时明确禁用', () => withTemplateDocument(async ({ doc, editor, host, element }) => {
    host.handleRange = { from: 0, to: editor.state.doc.firstChild.nodeSize }; host.openBlockMenu()
    await vi.dynamicImportSettled()
    const unavailable = [...element.querySelectorAll('.lark-doc-block-menu button')].find(b => b.textContent === '评论')
    expect(unavailable).toBeTruthy(); expect(unavailable.disabled).toBe(true)
    host.session.setProvider('comments', createMemoryCommentsProvider())
    host.handleRange = { from: 0, to: editor.state.doc.firstChild.nodeSize }; host.openBlockMenu()
    await vi.dynamicImportSettled()
    const comment = [...element.querySelectorAll('.lark-doc-block-menu button')].find(b => b.textContent === '评论')
    expect(comment.disabled).toBe(false)
    for (const row of element.querySelectorAll('.lark-doc-block-menu-row')) expect(row.querySelector('svg'), row.textContent).not.toBeNull()
    comment.click(); await vi.dynamicImportSettled()
    expect(host.commentComposer).not.toBeNull()
    expect(host.commentComposer.quote).toBe('前文')
  }))
  it.each(['taskItem', 'listItem'])('%s下方添加后在新正文内执行插入，不把选区留在列表边界', kind => withTemplateDocument(async ({ doc, editor, host, element }) => {
    doc.setContent({ type: 'doc', content: [{ type: kind === 'taskItem' ? 'taskList' : 'bulletList', content: ['目标', '相邻'].map(text => ({ type: kind, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })) }, { type: 'paragraph', content: [{ type: 'text', text: '后文' }] }] })
    host.handleRange = { from: 1, to: 1 + editor.state.doc.firstChild.firstChild.nodeSize }; host.openBlockMenu()
    await vi.dynamicImportSettled()
    const add = [...element.querySelectorAll('.lark-doc-block-menu button')].find(b => b.textContent === '在下方添加')
    add.click(); await vi.dynamicImportSettled()
    const before = editor.state.doc
    host.chooseCommand({ id: 'code' })
    expect(editor.state.doc.child(1).type.name).toBe('codeBlock')
    expect(editor.state.doc.textContent).toBe('目标相邻后文')
    expect(editor.state.doc.child(2).firstChild.textContent).toBe('相邻')
    editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true)
  }))
  it.each(['duplicate', 'moveDown'])('菜单%s后恢复编辑器焦点，快捷键可以立即撤销', id => withTemplateDocument(async ({ editor, host, element }) => {
    const before = editor.state.doc
    host.handleRange = { from: 0, to: before.firstChild.nodeSize }; host.openBlockMenu()
    await vi.dynamicImportSettled()
    // Hidden from the Feishu-style menu, retained as public block commands.
    host.blockAction(id)
    expect(document.activeElement).toBe(editor.view.dom)
    const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })
    editor.view.dom.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(editor.state.doc.eq(before)).toBe(true)
  }))
  it('保留保存模板入口和图标，不恢复同步块与子文档；未接服务明确禁用', () => withTemplateDocument(async ({ host, editor, element }) => {
    host.handleRange = { from: 0, to: editor.state.doc.firstChild.nodeSize }; host.openBlockMenu()
    await vi.dynamicImportSettled()
    const save = [...element.querySelectorAll('.lark-doc-block-menu button')].find(b => b.textContent === '保存为模板')
    expect(save.disabled).toBe(true); expect(save.getAttribute('aria-description')).toContain('未配置')
    expect(save.querySelector('svg')).not.toBeNull()
    expect(element.querySelector('.lark-doc-block-menu').textContent).not.toMatch(/同步块|转换为子文档/)
  }))
  it('六点保存模板只取目标富文本并可重新插入，原文及来源身份保持', () => withTemplateDocument(async ({ doc, editor, host, element }) => {
    const saved = []
    doc.patchProps({ onSaveTemplate: vi.fn(async input => { saved.push(input); return { id: 'saved_template' } }) })
    doc.setContent('<p data-block-id="before_save">前文</p><ul data-type="taskList"><li data-type="taskItem" data-block-id="save_task" data-checked="true"><p><strong>模板任务</strong></p></li><li data-type="taskItem" data-checked="false"><p>相邻任务</p></li></ul><p>后文</p>')
    const before = editor.state.doc, beforeJSON = JSON.stringify(before.toJSON()), from = before.firstChild.nodeSize + 1
    editor.commands.setTextSelection(1); host.handleRange = { from, to: from + before.nodeAt(from).nodeSize }
    expect(host.templateSaveAllowed()).toBe(true)
    expect(host.blockAction('saveTemplate')).toBe(true); await vi.dynamicImportSettled()
    expect(host.error).toBe('')
    const dialog = element.querySelector('[aria-label="保存为模板"]'), input = dialog.querySelector('input')
    expect(document.activeElement).toBe(input)
    input.value = '  我的任务模板  '; input.dispatchEvent(new Event('input'))
    ;[...dialog.querySelectorAll('button')].find(b => b.textContent === '保存').click()
    await vi.waitFor(() => expect(element.querySelector('[aria-label="保存为模板"]')).toBeNull())
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ name: '我的任务模板', blockId: 'save_task', content: { type: 'doc' } })
    expect(saved[0].content.content[0].type).toBe('taskList')
    expect(saved[0].content.content[0].content).toHaveLength(1)
    expect(saved[0].html).toContain('<strong>模板任务</strong>')
    expect(saved[0].html).not.toMatch(/相邻任务|前文|后文|data-block-id/)
    expect(JSON.stringify(saved[0].content)).not.toContain('blockId')
    expect(editor.state.doc.eq(before)).toBe(true)
    expect(JSON.stringify(editor.state.doc.toJSON())).toBe(beforeJSON)
    expect(editor.state.doc.nodeAt(from).attrs.blockId).toBe('save_task')
    doc.patchProps({ templates: [{ id: 'saved_template', label: '我的任务模板', html: saved[0].html }] })
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    expect(host.insertEditorTemplate('saved_template')).toBe(true)
    const tasks = []; editor.state.doc.descendants(n => { if (n.type.name === 'taskItem') tasks.push({ text: n.textContent, checked: n.attrs.checked, id: n.attrs.blockId }) })
    expect(tasks.filter(n => n.text === '模板任务').map(n => n.checked)).toEqual([true, true])
    expect(new Set(tasks.map(n => n.id)).size).toBe(tasks.length)
    editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true)
  }))
  it('保存模板拒绝空名称、重复提交和未确认的保存，并保留错误供重试', () => withTemplateDocument(async ({ doc, editor, host, element }) => {
    let finish
    const save = vi.fn(() => new Promise(resolve => { finish = resolve }))
    doc.patchProps({ onSaveTemplate: save })
    host.handleRange = { from: 0, to: editor.state.doc.firstChild.nodeSize }; host.blockAction('saveTemplate')
    await vi.dynamicImportSettled()
    const dialog = element.querySelector('[aria-label="保存为模板"]'), input = dialog.querySelector('input')
    const submit = [...dialog.querySelectorAll('button')].find(b => b.textContent === '保存')
    input.value = ' '; input.dispatchEvent(new Event('input')); expect(submit.disabled).toBe(true)
    input.value = '重试模板'; input.dispatchEvent(new Event('input')); submit.click(); submit.click()
    expect(save).toHaveBeenCalledTimes(1); expect(submit.disabled).toBe(true)
    finish(false)
    await vi.waitFor(() => expect(dialog.querySelector('[role="alert"]').textContent).toContain('尚未保存'))
    expect(submit.disabled).toBe(false)
    save.mockRejectedValueOnce(new Error('模板服务不可用')); submit.click()
    await vi.waitFor(() => expect(dialog.querySelector('[role="alert"]').textContent).toBe('模板服务不可用'))
    expect(host.shareToast).toBeNull()
  }))
  it.each([['Enter', true, 13], ['Escape', true, 27], ['Enter', false, 229], ['Escape', false, 229]])('模板名称组词%s composing=%s code=%s不误保存或关闭', (key, isComposing, keyCode) => withTemplateDocument(async ({ doc, editor, host, element }) => {
    const save = vi.fn(async () => ({ id: 'ime_template' }))
    doc.patchProps({ onSaveTemplate: save }); host.handleRange = { from: 0, to: editor.state.doc.firstChild.nodeSize }
    host.blockAction('saveTemplate'); await vi.dynamicImportSettled()
    const dialog = element.querySelector('[aria-label="保存为模板"]'), input = dialog.querySelector('input')
    const event = new KeyboardEvent('keydown', { key, keyCode, isComposing, bubbles: true, cancelable: true })
    input.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(save).not.toHaveBeenCalled()
    expect(dialog.isConnected).toBe(true); expect(document.activeElement).toBe(input)
  }))
  it.each(['input', 'save'])('模板%s持焦提交后仍可按Escape取消忙态', focus => withTemplateDocument(async ({ doc, editor, host, element }) => {
    let finish, signal
    doc.patchProps({ onSaveTemplate: value => { signal = value.signal; return new Promise(resolve => { finish = resolve }) } })
    host.handleRange = { from: 0, to: editor.state.doc.firstChild.nodeSize }; host.blockAction('saveTemplate')
    await vi.dynamicImportSettled()
    const dialog = element.querySelector('[aria-label="保存为模板"]'), input = dialog.querySelector('input')
    const save = [...dialog.querySelectorAll('button')].find(button => button.textContent === '保存')
    if (focus === 'input') { input.focus(); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })) }
    else { save.focus(); save.click() }
    expect(input.readOnly).toBe(true); expect(save.disabled).toBe(true)
    expect(dialog.contains(document.activeElement)).toBe(true)
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(signal.aborted).toBe(true); expect(dialog.isConnected).toBe(false)
    finish({ id: 'late' }); await Promise.resolve(); await Promise.resolve()
    expect(host.shareToast).toBeNull()
  }))
  it.each(['replace', 'destroy'])('打开模板名称框时blur同步%s不会留下失效弹窗', action => withTemplateDocument(async ({ doc, editor, host, element }) => {
    const save = vi.fn(async () => ({ id: 'unwanted' }))
    doc.patchProps({ onSaveTemplate: save }); editor.view.focus()
    const onBlur = () => { editor.off('blur', onBlur); if (action === 'destroy') doc.destroy(); else doc.setContent('<p>同步替换的新正文</p>') }
    editor.on('blur', onBlur)
    host.handleRange = { from: 0, to: editor.state.doc.firstChild.nodeSize }; host.blockAction('saveTemplate')
    await vi.dynamicImportSettled()
    expect(element.querySelector('[aria-label="保存为模板"]')).toBeNull()
    expect(save).not.toHaveBeenCalled()
  }))
  it.each(['cancel', 'replace', 'readonly', 'handler', 'feature'])('保存模板等待期间%s会关闭并中止，晚到结果不报成功', action => withTemplateDocument(async ({ doc, editor, host, element }) => {
    let finish, signal
    doc.patchProps({ onSaveTemplate: input => { signal = input.signal; return new Promise(resolve => { finish = resolve }) } })
    host.handleRange = { from: 0, to: editor.state.doc.firstChild.nodeSize }; host.blockAction('saveTemplate')
    await vi.dynamicImportSettled()
    const dialog = element.querySelector('[aria-label="保存为模板"]')
    ;[...dialog.querySelectorAll('button')].find(b => b.textContent === '保存').click()
    if (action === 'cancel') [...dialog.querySelectorAll('button')].find(b => b.textContent === '取消').click()
    else if (action === 'replace') doc.setContent('<p>新的正文</p>')
    else if (action === 'readonly') doc.setReadonly(true)
    else if (action === 'handler') doc.patchProps({ onSaveTemplate: async () => ({ id: 'new' }) })
    else doc.patchProps({ config: { features: { templates: false } } })
    await vi.waitFor(() => expect(signal.aborted).toBe(true))
    expect(element.querySelector('[aria-label="保存为模板"]')).toBeNull()
    finish({ id: 'late_template' }); await Promise.resolve(); await Promise.resolve()
    expect(host.shareToast).toBeNull()
  }))

  it('任务转换后保留嵌套任务和相邻项，失败或关闭能力不会提交一半转换', () => withTemplateDocument(async ({ doc, editor, host }) => {
    doc.setContent('<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>父任务</p><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>子任务</p></li></ul></li><li data-type="taskItem" data-checked="true"><p>相邻任务</p></li></ul>')
    const item = editor.state.doc.firstChild.firstChild, range = { from: 1, to: 1 + item.nodeSize }
    host.handleRange = range
    const before = editor.state.doc
    const blocked = vi.spyOn(editor.commandManager.rawCommands, 'setHeading').mockImplementation(() => () => false)
    try { expect(host.blockTypeAction('heading2')).toBe(false); expect(editor.state.doc.eq(before)).toBe(true) }
    finally { blocked.mockRestore() }
    host.handleRange = range
    expect(host.blockTypeAction('heading2')).toBe(true)
    const tasks = []; editor.state.doc.descendants(node => { if (node.type.name === 'taskItem') tasks.push({ text: node.textContent, checked: node.attrs.checked }) })
    expect(tasks).toEqual([{ text: '子任务', checked: false }, { text: '相邻任务', checked: true }])
    expect(editor.state.doc.textContent).toBe(before.textContent)
    editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true)
    doc.patchProps({ config: { features: { headings: false } } }); host.handleRange = range
    expect(host.blockTypeAction('heading2')).toBe(false); expect(editor.state.doc.eq(before)).toBe(true)
  }))

  it('高亮块转换包裹原内容；AI和翻译按句柄内容而非旧光标取上下文', () => withTemplateDocument(async ({ doc, editor, host }) => {
    doc.setContent('<p>前文</p><p><strong>目标正文</strong></p><p>后文</p>')
    const from = editor.state.doc.firstChild.nodeSize, target = editor.state.doc.child(1)
    host.handleRange = { from, to: from + target.nodeSize }
    expect(host.blockTypeAction('callout')).toBe(true)
    const callout = editor.state.doc.child(1)
    expect(callout.type.name).toBe('callout')
    expect(callout.textContent).toBe('目标正文')
    expect(callout.firstChild.firstChild.marks.some(mark => mark.type.name === 'bold')).toBe(true)
    editor.commands.undo()
    const sent = []
    vi.spyOn(host, '$emit').mockImplementation((event, kind) => { if (event === 'ai-request') sent.push({ kind, text: editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to) }) })
    editor.commands.setTextSelection(1); host.handleRange = { from, to: from + target.nodeSize }
    host.requestBlockAI('rewrite')
    editor.commands.setTextSelection(1); host.handleRange = { from, to: from + target.nodeSize }
    host.blockAction('translate')
    expect(sent).toEqual([{ kind: 'rewrite', text: '目标正文' }, { kind: 'translate', text: '目标正文' }])
  }))
  it.each(['taskItem', 'listItem'])('%s转标题保留原正文ID与存量评论绑定，撤销恢复容器身份', kind => withTemplateDocument(async ({ doc, editor, host }) => {
    doc.setContent({ type: 'doc', content: [{ type: kind === 'taskItem' ? 'taskList' : 'bulletList', content: [{ type: kind, attrs: { blockId: 'wrapper_identity' }, content: [{ type: 'paragraph', attrs: { blockId: 'text_identity' }, content: [{ type: 'text', text: '已评论正文' }] }] }] }] })
    const provider = createMemoryCommentsProvider()
    await provider.createThread({ blockId: 'text_identity', author: { id: 'owner', name: '我' }, content: '已有评论', quote: '已评论正文', anchor: { blockId: 'text_identity', offset: 0, length: 5 } })
    host.session.setProvider('comments', provider); await host.loadComments()
    expect(host.commentThreads[0].bound).toBe(true)
    const before = editor.state.doc
    editor.commands.setTextSelection(3); host.handleRange = { from: 1, to: 1 + before.firstChild.firstChild.nodeSize }
    expect(host.blockTypeAction('heading2')).toBe(true)
    expect(editor.state.doc.firstChild.attrs.blockId).toBe('text_identity')
    expect(host.commentThreads[0].bound).toBe(true)
    expect(host.commentThreads[0].anchor.blockId).toBe('text_identity')
    editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true)
  }))
  it('代码转列表的准备步骤失败时不提交后续转换', () => withTemplateDocument(async ({ doc, editor, host }) => {
    doc.setContent('<pre><code>代码内容</code></pre>')
    const before = editor.state.doc
    host.handleRange = { from: 0, to: before.firstChild.nodeSize }
    const blocked = vi.spyOn(editor.commandManager.rawCommands, 'setParagraph').mockImplementation(() => () => false)
    try { expect(host.blockTypeAction('taskList')).toBe(false); expect(editor.state.doc.eq(before)).toBe(true) }
    finally { blocked.mockRestore() }
  }))
  it('六点菜单容器转换也遵守五层限制，失败不留下部分改动', () => withTemplateDocument(async ({ doc, editor, host }) => {
    let nested = { type: 'paragraph', content: [{ type: 'text', text: '最深正文' }] }
    for (let i = 0; i < 5; i += 1) nested = { type: 'blockquote', content: [nested] }
    doc.setContent({ type: 'doc', content: [nested] })
    const before = editor.state.doc
    let range
    before.descendants((node, pos) => { if (!range && node.type.name === 'paragraph') range = { from: pos, to: pos + node.nodeSize } })
    expect(range.from).toBe(5)
    editor.commands.setTextSelection(range.from + 1)
    host.handleRange = range
    expect(host.handleActionRange()).toEqual(range)
    expect(host.blockTypeTextRange(range)).toEqual({ from: 6, to: 10 })
    expect(host.blockTypeAction('callout')).toBe(false)
    expect(host.error).toBe('容器嵌套最多 5 层')
    expect(editor.state.doc.eq(before)).toBe(true)
  }))
  it.each(['columns', 'callout'])('嵌套%s中的整表删除与拖拽不提升到外层容器', kind => withTemplateDocument(async ({ doc, editor, host }) => {
    const table = { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A1' }] }] }] }] }
    const paragraph = text => ({ type: 'paragraph', content: [{ type: 'text', text }] })
    const outer = kind === 'columns'
      ? { type: 'columns', content: [{ type: 'column', content: [table, paragraph('同列保留')] }, { type: 'column', content: [paragraph('旁列保留')] }] }
      : { type: 'callout', content: [table, paragraph('高亮块保留')] }
    doc.setContent({ type: 'doc', content: [outer, paragraph('外部保留')] })
    let pos
    editor.state.doc.descendants((node, at) => { if (node.type.name === 'table') pos = at })
    const range = { from: pos, to: pos + editor.state.doc.nodeAt(pos).nodeSize }
    expect(host.blockDragRange(range)).toEqual(range)
    expect(host.columnsRangeFor(range)).toBeNull()
    host.handleRange = range; host.blockAction('delete')
    expect(editor.state.doc.firstChild.type.name).toBe(kind)
    expect(editor.getText()).toContain(kind === 'columns' ? '旁列保留' : '高亮块保留')
    expect(editor.getText()).toContain('外部保留')
    expect(editor.view.dom.querySelector('table')).toBeNull()
    editor.commands.undo(); expect(editor.view.dom.querySelector('table')).not.toBeNull()
  }))

  it.each([-100, 100, 500])('整表菜单避开两个句柄，左右可用空间=%s', left => withTemplateDocument(async ({ doc, editor, host, element }) => {
    doc.setContent('<table><tr><td><p>A1</p></td><td><p>B1</p></td></tr></table>')
    editor.commands.setTextSelection(4); host.positionBlockHandle(host.rangeAt(4))
    await vi.dynamicImportSettled()
    element.querySelector('[data-block-scope="table"]').dispatchEvent(new MouseEvent('mouseenter'))
    const box = x => ({ left: x, right: x + 42, top: 200, bottom: 226, width: 42, height: 26 })
    vi.spyOn(element.querySelector('.lark-doc-block-handle:not(.lark-doc-block-handle-secondary)'), 'getBoundingClientRect').mockReturnValue(box(left))
    vi.spyOn(element.querySelector('.lark-doc-block-handle-secondary'), 'getBoundingClientRect').mockReturnValue(box(left - 16))
    vi.spyOn(element.querySelector('.lark-doc-block-menu'), 'getBoundingClientRect').mockReturnValue({ ...box(0), width: 230 })
    vi.spyOn(element.querySelector('.lark-doc-editor-content'), 'getBoundingClientRect').mockReturnValue(box(left + 46))
    host.positionBlockMenu('.lark-doc-block-menu'); await Promise.resolve()
    const menuLeft = left + parseFloat(host.blockMenuStyle.left)
    expect(menuLeft).toBeGreaterThanOrEqual(8)
    expect(menuLeft + 230 <= left - 16 - 8 || menuLeft >= left + 42 + 8).toBe(true)
  }))
  it.each(['taskList', 'bulletList'])('分页列表%s内部的上移下移保持结构并可撤销', kind => withTemplateDocument(async ({ doc, editor, host }) => {
    const itemType = kind === 'taskList' ? 'taskItem' : 'listItem'
    const content = { type: 'doc', content: [{ type: kind, content: ['甲', '乙', '丙'].map(text => ({ type: itemType, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })) }, { type: 'paragraph', content: [{ type: 'text', text: '保留列表后文' }] }] }
    await doc.setContentAsync(content, { pagedView: true, yieldToMain: async () => {} })
    const target = text => { let pos; editor.state.doc.descendants((node, at) => { if (node.type.name === itemType && node.textContent === text) pos = at }); host.handleRange = host.rangeAt(pos + 1) }
    const order = () => doc.getJSON().content[0].content.map(node => node.content[0].content[0].text)
    const before = editor.state.doc
    target('乙'); host.blockAction('moveUp')
    expect(order()).toEqual(['乙', '甲', '丙'])
    editor.state.doc.check()
    expect(doc.getJSON().content[1].content[0].text).toBe('保留列表后文')
    doc.undo(); expect(editor.state.doc.eq(before)).toBe(true)
    target('乙'); host.blockAction('moveDown')
    expect(order()).toEqual(['甲', '丙', '乙'])
    editor.state.doc.check()
    doc.undo(); expect(editor.state.doc.eq(before)).toBe(true)
  }))
  it('分隔线快捷键遵循动态配置与只读状态', () => withTemplateDocument(async ({ doc, editor }) => {
    doc.setContent('<p>保留正文</p>')
    editor.commands.setTextSelection(1)
    editor.commands.keyboardShortcut('Mod-Alt-s')
    expect(editor.state.doc.content.content.some(node => node.type.name === 'horizontalRule')).toBe(true)
    doc.patchProps({ config: { features: { blockStyle: false } } })
    doc.setContent('<p>保留正文</p>')
    editor.commands.setTextSelection(1)
    const before = editor.state.doc
    editor.commands.keyboardShortcut('Mod-Alt-s')
    expect(editor.state.doc).toBe(before)
    doc.patchProps({ config: { features: { blockStyle: true }, commands: { disabled: ['divider'] } } })
    editor.commands.keyboardShortcut('Mod-Alt-s')
    expect(editor.state.doc).toBe(before)
    doc.patchProps({ config: { commands: { disabled: [] } } })
    editor.setEditable(false)
    editor.commands.keyboardShortcut('Mod-Alt-s')
    expect(editor.state.doc).toBe(before)
  }))
  const fileNodes = editor => {
    const result = []
    editor.state.doc.descendants(node => { if (node.type.name === 'fileBlock') result.push(node) })
    return result
  }
  it('附件按配置逐片重试，token-only 结果单次落块且单次撤销', () => withTemplateDocument(async ({ host, editor }) => {
    const before = editor.state.doc, chunks = [], failures = new Set()
    host.uploadFile = { chunked: true, chunkSize: 65536, retry: { attempts: 2, delay: 0 },
      upload: async (blob, ctx) => {
        chunks.push(ctx.chunk.index)
        if (ctx.chunk.index === 1 && !failures.size) { failures.add(1); throw Object.assign(new Error('retry'), { status: 503 }) }
        return { token: 'file_token' }
      } }
    await host.insertFileBlocks([new File([new Uint8Array(180000)], 'large.pdf', { type: 'application/pdf' })])
    expect(chunks).toEqual([0, 1, 1, 2])
    expect(fileNodes(editor).map(node => node.attrs.token)).toEqual(['file_token'])
    editor.commands.undo()
    expect(editor.state.doc.eq(before)).toBe(true)
  }))
  it('取消附件忽略迟到结果，同编辑器再次上传从已完成分片续传', () => withTemplateDocument(async ({ host, editor }) => {
    const contexts = []; let late, first = true
    host.uploadFile = { chunked: true, chunkSize: 65536, upload: async (blob, ctx) => {
      contexts.push(ctx)
      if (ctx.chunk.index === 1 && first) { first = false; return new Promise(resolve => { late = resolve }) }
      return { token: 'resumed_file' }
    } }
    const file = new File([new Uint8Array(180000)], 'resume.pdf', { type: 'application/pdf' })
    const pending = host.insertFileBlocks([file])
    await vi.waitFor(() => expect(contexts).toHaveLength(2))
    host.cancelFileUploads('cancelled')
    await pending
    late({ token: 'late_file' }); await Promise.resolve()
    expect(fileNodes(editor)).toHaveLength(0)
    await host.insertFileBlocks([file])
    expect(contexts.map(ctx => ctx.chunk.index)).toEqual([0, 1, 1, 2])
    expect(new Set(contexts.map(ctx => ctx.chunk.uploadId)).size).toBe(1)
    expect(fileNodes(editor).map(node => node.attrs.token)).toEqual(['resumed_file'])
  }))
  it.each(['readonly', 'replace', 'provider', 'permission', 'destroy'])('附件 %s 生命周期变化取消请求且不接受迟到插入', mode => withTemplateDocument(async ({ doc, host, editor }) => {
    let finish, context
    host.uploadFile = (file, ctx) => { context = ctx; return new Promise(resolve => { finish = resolve }) }
    const pending = host.insertFileBlocks([new File(['pdf'], 'late.pdf', { type: 'application/pdf' })])
    await vi.waitFor(() => expect(context).toBeTruthy())
    if (mode === 'readonly') doc.setReadonly(true)
    if (mode === 'replace') doc.setContent('<p>replacement</p>')
    if (mode === 'provider') doc.patchProps({ uploadFile: async () => ({ token: 'new_provider' }) })
    if (mode === 'permission') doc.patchProps({ config: { features: { files: false } } })
    if (mode === 'destroy') doc.destroy()
    await pending
    expect(context.signal.aborted).toBe(true)
    finish({ token: 'late_file' }); await Promise.resolve()
    expect(fileNodes(editor)).toHaveLength(0)
  }))
  it('附件最多三个文件并发，完成乱序仍按选择顺序单次落块', () => withTemplateDocument(async ({ host, editor }) => {
    const pendingFiles = new Map(); let running = 0, max = 0
    host.uploadFile = { concurrency: 2, upload: (file) => {
      running++; max = Math.max(max, running)
      return new Promise(resolve => pendingFiles.set(file.name, () => { running--; resolve({ token: file.name.replace('.', '_') }) }))
    } }
    const before = editor.state.doc
    const pending = host.insertFileBlocks(['a.pdf', 'b.pdf', 'c.pdf'].map(name => new File(['pdf'], name, { type: 'application/pdf' })))
    await vi.waitFor(() => expect(pendingFiles.size).toBe(2))
    pendingFiles.get('b.pdf')()
    await vi.waitFor(() => expect(pendingFiles.size).toBe(3))
    pendingFiles.get('c.pdf')(); pendingFiles.get('a.pdf')()
    await pending
    expect(max).toBe(2)
    expect(fileNodes(editor).map(node => node.attrs.name)).toEqual(['a.pdf', 'b.pdf', 'c.pdf'])
    editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true)
  }))
  it('setUploader 后附件 fallback 使用新来源，裸函数失败不自动重试', () => withTemplateDocument(async ({ doc, host, editor }) => {
    const old = vi.fn(async () => ({ token: 'old' })), current = vi.fn(async () => ({ token: 'current' }))
    doc.setUploader(old); doc.setUploader(current)
    await host.insertFileBlocks([new File(['pdf'], 'a.pdf', { type: 'application/pdf' })])
    expect(old).not.toHaveBeenCalled(); expect(current).toHaveBeenCalledOnce()
    expect(fileNodes(editor)[0].attrs.token).toBe('current')
    const fail = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    doc.setUploader(fail)
    await host.insertFileBlocks([new File(['pdf'], 'b.pdf', { type: 'application/pdf' })])
    expect(fail).toHaveBeenCalledOnce(); expect(fileNodes(editor)).toHaveLength(1)
  }))
  it.each(['heading', 'empty-heading', 'paragraph', 'ordered', 'bullet', 'same-size', 'ui', 'structure', 'multi-text', 'mark', 'heading-format', 'indent-format'])('分页结构分析复用且装饰与冷构造一致：%s', async mode => {
    const scans = ['collectFoldRanges', 'computeHeadingNumbers', 'computeOrderedListNumbers', 'computeBulletItems', 'collectBlockIdFixes'].map(name => vi.spyOn(documentOperations, name))
    try {
      await withTemplateDocument(async ({ doc, editor }) => {
        await doc.setContentAsync('<h1 data-numbering="true">one</h1><p data-indent="1">body</p><ol><li><p>ordered</p></li></ol><ul><li><p>bullet</p></li></ul><h2 data-numbering="true">two</h2><p>tail</p>', { pagedView: true, pageBlocks: 2, yieldToMain: async () => {} })
        let position, target
        const text = mode === 'paragraph' ? 'body' : mode === 'ordered' ? 'ordered' : mode === 'bullet' ? 'bullet' : 'one'
        editor.state.doc.descendants((node, pos) => { if (node.isTextblock && node.textContent === text) { position = pos; target = node } })
        editor.commands.setTextSelection(position + 2)
        scans.forEach(scan => scan.mockClear())
        if (mode === 'ui') editor.view.dispatch(editor.state.tr.setMeta(documentKey, { handleHover: null }))
        else if (mode === 'mark') editor.view.dispatch(editor.state.tr.addMark(position + 1, position + 2, editor.schema.marks.bold.create()))
        else if (mode === 'heading-format') editor.view.dispatch(editor.state.tr.setNodeMarkup(position, null, { ...target.attrs, level: 2 }))
        else if (mode === 'indent-format') editor.view.dispatch(editor.state.tr.setNodeMarkup(position, null, { ...target.attrs, indent: 1 }))
        else if (mode === 'structure') editor.view.dispatch(editor.state.tr.insertText('x', position + 2).setNodeMarkup(position, null, { ...target.attrs, numbering: false }))
        else if (mode === 'multi-text') editor.view.dispatch(editor.state.tr.insertText('x', position + 2).insertText('y', position + 3))
        else if (mode === 'empty-heading') editor.view.dispatch(editor.state.tr.delete(position + 1, position + 1 + target.content.size))
        else if (mode === 'same-size') editor.view.dispatch(editor.state.tr.insertText('X', position + 1, position + 2))
        else editor.commands.insertContent('界😀')
        if (mode === 'structure' || mode === 'multi-text') scans.forEach(scan => expect(scan).toHaveBeenCalled())
        else if (mode.endsWith('format') || mode === 'mark') expect(scans[4]).not.toHaveBeenCalled()
        else scans.forEach(scan => expect(scan).not.toHaveBeenCalled())
        const project = set => set.find().filter(item => !item.spec.ldPagedActive).map(item => {
          const dom = typeof item.type.toDOM === 'function' ? item.type.toDOM(editor.view, () => item.from) : item.type.toDOM
          return { from: item.from, to: item.to, category: item.spec.category, attrs: item.type.attrs || null, html: dom?.outerHTML || null }
        }).sort((a, b) => a.from - b.from || a.to - b.to || String(a.category).localeCompare(String(b.category)))
        const equivalent = () => expect(project(documentKey.get(editor.state).props.decorations(editor.state))).toEqual(project(createDocumentDecorations({ state: editor.state, storage: editor.storage.larkDoc, editor, enabled: () => true, options: {} })))
        equivalent()
        if (mode !== 'ui') { editor.commands.undo(); equivalent(); editor.commands.redo(); equivalent() }
      })
    } finally { scans.forEach(scan => scan.mockRestore()) }
  })
  it('分页查找共享异步结果，下一处不重扫结构且与全文命中相同', () => withTemplateDocument(async ({ doc, host, editor }) => {
    await doc.setContentAsync('<h1>飞书😀.*</h1><p>飞书😀.*</p><h2>飞书😀.*</h2>', { pagedView: true, pageBlocks: 1, yieldToMain: async () => {} })
    const expected = documentOperations.findTextMatches(editor.state.doc, '😀.*')
    const scan = vi.spyOn(documentOperations, 'findTextMatches'), fold = vi.spyOn(documentOperations, 'collectFoldRanges'), ids = vi.spyOn(documentOperations, 'foldableIdPositions')
    try {
      host.searchQuery = '😀.*'
      await host.updateSearch()
      expect(host.searchMatches).toEqual(expected)
      const calls = scan.mock.calls.length
      await host.nextMatch(1)
      expect(scan).toHaveBeenCalledTimes(calls)
      expect(fold).not.toHaveBeenCalled()
      expect(ids).not.toHaveBeenCalled()
      const hits = documentKey.get(editor.state).props.decorations(editor.state).find().filter(item => item.spec.category === 'search')
      expect(hits.map(hit => ({ from: hit.from, to: hit.to })).sort((a, b) => a.from - b.from)).toEqual(expected)
      expect(hits.filter(hit => hit.type.attrs.class.includes('search-active')).map(hit => hit.from)).toEqual([expected[1].from])
      expect(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to)).toBe('😀.*')
      host.closeSearch()
      expect(documentKey.get(editor.state).props.decorations(editor.state).find().filter(item => item.spec.category === 'search')).toHaveLength(0)
    } finally { scan.mockRestore(); fold.mockRestore(); ids.mockRestore() }
  }))
  it('公开分页查找命令等待结果后刷新高亮，编辑和关闭不泄漏旧查询', () => withTemplateDocument(async ({ doc, editor }) => {
    await doc.setContentAsync('<p>飞书😀.*</p><p>飞书😀.*</p>', { pagedView: true, pageBlocks: 1, yieldToMain: async () => {} })
    const hits = () => documentKey.get(editor.state).props.decorations(editor.state).find().filter(item => item.spec.category === 'search')
    editor.commands.setLarkDocSearch('😀.*', 1)
    await vi.waitFor(() => expect(hits()).toHaveLength(2))
    editor.commands.insertContent('😀.*')
    await vi.waitFor(() => expect(hits()).toHaveLength(3))
    editor.commands.setLarkDocSearch('飞书')
    editor.commands.setLarkDocSearch('')
    await Promise.resolve(); await Promise.resolve()
    expect(hits()).toHaveLength(0)
  }))
  it('带当前查询分页导入，锁内完成的搜索在解锁后刷新全部高亮', () => withTemplateDocument(async ({ doc, editor }) => {
    editor.commands.setLarkDocSearch('飞书')
    await doc.setContentAsync('<p>飞书一</p><p>飞书二</p><p>飞书三</p>', { pagedView: true, pageBlocks: 1, yieldToMain: () => new Promise(resolve => setTimeout(resolve, 0)) })
    await vi.waitFor(() => {
      const hits = documentKey.get(editor.state).props.decorations(editor.state).find().filter(item => item.spec.category === 'search')
      expect(hits).toHaveLength(3)
    })
  }))
  it('附件上下文保留真实文档ID，续传隔离键不替代宿主路由', () => withTemplateDocument(async ({ host }) => {
    const contexts = []
    host.uploadFile = async (file, ctx) => { contexts.push(ctx); return { token: 'route_file' } }
    await host.insertFileBlocks([new File(['file'], 'route.pdf', { type: 'application/pdf' })])
    expect(contexts[0].documentId).toBe('business-doc')
    expect(contexts[0].resumeScope).toMatch(/:/)
  }, { documentId: 'business-doc' }))
  it('附件上传期间锚点映射，完成保留当前光标并单次撤销插入', () => withTemplateDocument(async ({ host, editor }) => {
    let finish
    host.uploadFile = () => new Promise(resolve => { finish = resolve })
    editor.commands.setTextSelection(2)
    const pending = host.insertFileBlocks([new File(['file'], 'anchor.pdf', { type: 'application/pdf' })])
    await vi.waitFor(() => expect(finish).toBeTruthy())
    editor.commands.insertContent('X')
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    const before = editor.state.doc, selection = editor.state.selection.getBookmark()
    let transaction
    const observe = payload => { if (payload.transaction.docChanged) transaction = payload.transaction }
    editor.on('transaction', observe)
    finish({ token: 'anchor_file' }); await pending
    editor.off('transaction', observe)
    expect(editor.state.selection.eq(selection.map(transaction.mapping).resolve(editor.state.doc))).toBe(true)
    expect(fileNodes(editor)).toHaveLength(1)
    editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true)
  }))
  it('附件锚点被删除时取消，不向后来光标落块', () => withTemplateDocument(async ({ host, editor }) => {
    let finish, context
    host.uploadFile = (file, ctx) => { context = ctx; return new Promise(resolve => { finish = resolve }) }
    editor.commands.setTextSelection(2)
    const pending = host.insertFileBlocks([new File(['file'], 'anchor.pdf', { type: 'application/pdf' })])
    await vi.waitFor(() => expect(context).toBeTruthy())
    editor.view.dispatch(editor.state.tr.delete(0, editor.state.doc.firstChild.nodeSize))
    await pending; expect(context.signal.aborted).toBe(true)
    finish({ token: 'late_anchor' }); await Promise.resolve()
    expect(fileNodes(editor)).toHaveLength(0)
  }))
  it.each(['raw', 'duplicate', 'forged-complete'])('分页ID快速路径不信任未经验证的原始state：%s', mode => withTemplateDocument(async ({ editor }) => {
    const paragraph = text => editor.schema.node('paragraph', { blockId: mode === 'duplicate' ? 'duplicate_id' : null }, editor.schema.text(text))
    const invalid = editor.schema.node('doc', null, mode === 'duplicate' ? [paragraph('legacy'), paragraph('other')] : paragraph('legacy'))
    editor.view.updateState(EditorState.create({ schema: editor.schema, doc: invalid, plugins: editor.state.plugins }))
    if (mode === 'forged-complete') editor.view.dispatch(editor.state.tr.setMeta(PAGED_IMPORT_META, { phase: 'complete', id: 999 }).setMeta(DEFER_BLOCK_ID_META, true))
    const scan = vi.spyOn(documentOperations, 'collectBlockIdFixes')
    editor.commands.setTextSelection(2)
    editor.commands.insertContent('X')
    expect(scan).toHaveBeenCalled()
    expect(editor.state.doc.firstChild.attrs.blockId).toMatch(documentOperations.BLOCK_ID_PATTERN)
    expect(editor.state.doc.textContent).toBe(mode === 'duplicate' ? 'lXegacyother' : 'lXegacy')
    expect(new Set(editor.state.doc.content.content.map(node => node.attrs.blockId)).size).toBe(editor.state.doc.childCount)
  }))
  it.each(['cancel', 'callback-failure', 'complete'])('分页导入 %s 后评论绑定保持最终正文状态', mode => withTemplateDocument(async ({ doc, host, editor }) => {
    await vi.dynamicImportSettled()
    const blockId = editor.state.doc.firstChild.attrs.blockId
    host.commentThreads = [{ id: 'import_thread', blockId, replies: [], bound: true, resolved: false }]
    const before = editor.state, abort = new AbortController()
    const fail = ({ transaction }) => { if (transaction.getMeta(PAGED_IMPORT_META)?.phase === 'complete') throw new Error('final callback failed') }
    if (mode === 'callback-failure') editor.on('update', fail)
    try {
      const pending = doc.setContentAsync('<p>new1</p><p>new2</p><p>new3</p>', { pageBlocks: 1, pagedView: true, signal: abort.signal,
        yieldToMain: async () => { if (mode === 'cancel' && editor.storage.larkDoc.pagedImport) abort.abort() },
      })
      if (mode === 'complete') await pending
      else await expect(pending).rejects.toThrow()
      expect(host.commentThreads[0].bound).toBe(mode !== 'complete')
      if (mode !== 'complete') expect(editor.state).toBe(before)
    } finally { editor.off('update', fail) }
  }))
  it('分页取消导入保留浮层清理后的首提交前完整state', () => withTemplateDocument(async ({ doc, editor }) => {
    const controller = doc._handle.editorController, beforeReplace = controller.onBeforeContentReplace, abort = new AbortController()
    let checkpoint
    controller.onBeforeContentReplace = () => { beforeReplace?.(); editor.view.dispatch(editor.state.tr.setMeta('test-overlay-cleanup', true)) }
    const capture = ({ transaction }) => { if (!checkpoint && transaction.getMeta(PAGED_IMPORT_META)?.phase === 'page') checkpoint = editor.state }
    editor.on('beforeTransaction', capture)
    try {
      await expect(doc.setContentAsync('<p>replacement1</p><p>replacement2</p>', { pagedView: true, pageBlocks: 1, signal: abort.signal,
        yieldToMain: async () => { if (editor.storage.larkDoc.pagedImport) abort.abort() },
      })).rejects.toThrow()
      expect(checkpoint).toBeTruthy()
      expect(editor.state).toBe(checkpoint)
      expect(editor.isEditable).toBe(true)
    } finally { editor.off('beforeTransaction', capture); controller.onBeforeContentReplace = beforeReplace }
  }))
  it.each(['complete', 'abort'])('分页完成视图后让出主线程且保持导入锁：%s', mode => withTemplateDocument(async ({ doc, editor }) => {
    const abort = new AbortController(), before = doc.getText(), dispatch = editor.view.dispatch
    let completed = false, yieldedLocked = false
    const observe = ({ transaction }) => { if (transaction.getMeta(PAGED_IMPORT_META)?.phase === 'complete') completed = true }
    editor.on('transaction', observe)
    try {
      const pending = doc.setContentAsync('<p>replacement</p>'.repeat(80), { pagedView: true, signal: abort.signal, yieldToMain: async () => {
        if (!completed) return
        yieldedLocked = !editor.isEditable && editor.storage.larkDoc.pagedImport === false && editor.view.dispatch !== dispatch
        if (mode === 'abort') abort.abort()
      } })
      if (mode === 'abort') { await expect(pending).rejects.toThrow(); expect(doc.getText()).toBe(before) }
      else { await pending; expect(doc.getText()).toContain('replacement') }
      expect(yieldedLocked).toBe(true)
      expect(editor.isEditable).toBe(true)
      expect(editor.view.dispatch).toBe(dispatch)
    } finally { editor.off('transaction', observe) }
  }))
  it.each(['complete', 'abort'])('分页装饰冷构造在锁内分步准备并复用：%s', mode => withTemplateDocument(async ({ doc, editor }) => {
    const storage = editor.storage.larkDoc, prepare = storage.prepareDecorations, before = doc.getText(), abort = new AbortController()
    const samples = { samples: [] }
    vi.stubGlobal('__larkDocPerf', samples)
    let warming = false, called = false, preparedCount, completedCount
    storage.prepareDecorations = async (...args) => {
      warming = true; called = true
      try { await prepare(...args); preparedCount = samples.samples.length }
      finally { warming = false }
    }
    const observe = ({ transaction }) => { if (transaction.getMeta(PAGED_IMPORT_META)?.phase === 'complete') completedCount = samples.samples.length }
    editor.on('transaction', observe)
    try {
      const pending = doc.setContentAsync('<h1>prepared heading</h1>' + '<p data-indent="1">row</p>'.repeat(80), { pagedView: true, signal: abort.signal, yieldToMain: async () => {
        if (warming) { expect(editor.isEditable).toBe(false); expect(storage.pagedImport).toBe(true); if (mode === 'abort') abort.abort() }
      } })
      if (mode === 'abort') { await expect(pending).rejects.toThrow(); expect(doc.getText()).toBe(before) }
      else { await pending; expect(preparedCount).toBeGreaterThan(0); expect(completedCount).toBe(preparedCount); expect(editor.view.dom.querySelector('.lark-doc-heading-fold-toggle')).toBeTruthy() }
      expect(called).toBe(true)
      expect(editor.isEditable).toBe(true)
    } finally { storage.prepareDecorations = prepare; editor.off('transaction', observe); vi.unstubAllGlobals() }
  }))
  it('分页无字数上限时不在预解析分配整页码点数组', () => withTemplateDocument(async ({ doc, editor }) => {
    doc._handle.editorController.getMaxLength = () => 0
    const count = vi.spyOn(editor.storage.characterCount, 'characters')
    await doc.setContentAsync('<p>a😀b</p>', { pagedView: true, yieldToMain: async () => {} })
    expect(count.mock.calls.filter(([options]) => options?.node)).toHaveLength(0)
    expect(doc.getText()).toBe('a😀b')
  }))
  it('分页字数上限保留Unicode码点计数与拒绝时原文', () => withTemplateDocument(async ({ doc, editor }) => {
    const before = editor.state.doc
    doc._handle.editorController.getMaxLength = () => 2
    await expect(doc.setContentAsync('<p>a😀b</p>', { pagedView: true, yieldToMain: async () => {} })).rejects.toThrow('正文不能超过 2 字')
    expect(editor.state.doc).toBe(before)
    doc._handle.editorController.getMaxLength = () => 3
    await doc.setContentAsync('<p>a😀b</p>', { pagedView: true, yieldToMain: async () => {} })
    expect(doc.getText()).toBe('a😀b')
  }))
  it.each(['page-yield', 'decorate-yield', 'complete-yield', 'complete-reentrant'])('分页新异步导入在回滚后接管：%s', mode => withTemplateDocument(async ({ doc, editor }) => {
    const before = doc.getText()
    const storage = editor.storage.larkDoc, prepare = storage.prepareDecorations
    let phase, second, warming = false
    storage.prepareDecorations = async (...args) => { warming = true; try { return await prepare(...args) } finally { warming = false } }
    const replace = () => { second = doc.setContentAsync('<p>newest import</p>', { pagedView: true, yieldToMain: async () => {} }).then(() => 'complete', error => error.message) }
    const observe = ({ transaction }) => {
      phase = transaction.getMeta(PAGED_IMPORT_META)?.phase
      if (mode === 'complete-reentrant' && phase === 'complete' && !second) replace()
    }
    editor.on('transaction', observe)
    try {
      await expect(doc.setContentAsync('<p>superseded import</p>'.repeat(80), { pagedView: true, yieldToMain: async () => {
        if (!second && (mode === 'page-yield' && phase === 'page' || mode === 'decorate-yield' && warming || mode === 'complete-yield' && phase === 'complete')) replace()
      } })).rejects.toMatchObject({ name: 'AbortError' })
      expect(await second).toBe('complete')
      expect(doc.getText()).toBe('newest import')
      editor.commands.undo()
      expect(doc.getText()).toBe(before)
    } finally { storage.prepareDecorations = prepare; editor.off('transaction', observe) }
  }))
  it.each(['abort', 'readonly'])('分页导入锁定中同步%s不会遗留门控dispatch', mode => withTemplateDocument(async ({ doc, editor }) => {
    const before = editor.state, dispatch = editor.view.dispatch, setEditable = editor.setEditable, abort = new AbortController()
    let interrupted = false
    editor.setEditable = function (editable, ...args) {
      const result = setEditable.call(this, editable, ...args)
      if (!editable && !interrupted && editor.storage.larkDoc.pagedImport) {
        interrupted = true
        if (mode === 'abort') abort.abort()
        else doc.setReadonly(true)
      }
      return result
    }
    try {
      await expect(doc.setContentAsync('<p>replacement1</p><p>replacement2</p>', { pagedView: true, pageBlocks: 1, signal: abort.signal, yieldToMain: async () => {} })).rejects.toThrow()
      expect(interrupted).toBe(true)
      expect(editor.view.dispatch).toBe(dispatch)
      expect(editor.state).toBe(before)
      expect(editor.isEditable).toBe(mode === 'abort')
      expect(editor.storage.larkDoc.pagedImport).toBe(false)
    } finally { editor.setEditable = setEditable }
  }))
  it('首次分页投影可同步替换为大平面正文，不提前调用未加载的选区读取器', () => withTemplateDocument(async ({ doc, editor }) => {
    await doc.setContentAsync('<p>paged-first</p>', { pagedView: true, yieldToMain: async () => {} })
    const content = '<p>' + 'flat replacement '.repeat(32000) + '</p>'
    expect(() => doc.setContent(content)).not.toThrow()
    expect(editor.state.doc.firstChild.type.name).toBe('paragraph')
    expect(doc.getText()).toContain('flat replacement')
  }))
  it('分页容器留白命中只返回当前页可见正文，不爬出编辑器', () => withTemplateDocument(async ({ doc, editor }) => {
    await doc.setContentAsync('<p>first</p><p>second</p>', { pagedView: true, yieldToMain: async () => {} })
    const runtime = editor.storage.larkDoc.pagedView, page = editor.view.dom.firstElementChild
    const [first, second] = page.children, previous = document.elementFromPoint
    vi.spyOn(first, 'getBoundingClientRect').mockReturnValue({ bottom: 10 })
    vi.spyOn(second, 'getBoundingClientRect').mockReturnValue({ bottom: 30 })
    try {
      document.elementFromPoint = () => page
      expect(runtime.blockAtPoint(20, 20)).toBe(second)
      second.style.display = 'none'
      expect(runtime.blockAtPoint(20, 20)).toBe(first)
      first.style.display = 'none'
      expect(runtime.blockAtPoint(20, 20)).toBeNull()
      first.style.display = ''
      document.elementFromPoint = () => first
      expect(runtime.blockAtPoint(20, 20)).toBe(first)
      document.elementFromPoint = () => document.documentElement
      expect(runtime.blockAtPoint(20, 20)).toBeNull()
    } finally { document.elementFromPoint = previous }
  }))
  it('分页滚动窗口未变时保留原生选区与DOM，不重复更新PM视图', () => withTemplateDocument(async ({ doc, editor }) => {
    const previous = window.ResizeObserver
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
    try {
      await doc.setContentAsync('<p>stable window</p>'.repeat(80), { pagedView: true, yieldToMain: async () => {} })
      const runtime = editor.storage.larkDoc.pagedView
      runtime.refresh()
      const state = editor.state, first = runtime.getRenderedBlocks()[0]
      const update = vi.spyOn(editor.view, 'updateState')
      runtime.refresh(); runtime.refresh(); runtime.refresh()
      expect(update).not.toHaveBeenCalled()
      expect(editor.state).toBe(state)
      expect(runtime.getRenderedBlocks()[0]).toBe(first)
      expect(doc.getText()).toContain('stable window')
      runtime.setActive(false)
      expect(editor.view.dom.classList.contains('lark-doc-paged-layout')).toBe(false)
      runtime.setActive(true); runtime.refresh()
      expect(editor.view.dom.classList.contains('lark-doc-paged-layout')).toBe(true)
      expect(editor.view.dom.hasAttribute('data-ld-rendered-blocks')).toBe(true)
    } finally { window.ResizeObserver = previous }
  }))
  it('分页缓冲按视口距离挂载，远处滚动不额外保留整页正文', () => withTemplateDocument(async ({ doc, editor }) => {
    await doc.setContentAsync(Array.from({ length: 256 }, (_, i) => `<p>row${i} ${'content '.repeat(75)}</p>`).join(''), { pagedView: true, yieldToMain: async () => {} })
    const runtime = editor.storage.larkDoc.pagedView, root = editor.view.dom
    runtime.refresh()
    const targetText = editor.state.doc.child(4).firstChild.textContent
    const offset = runtime.getScrollCoordinates().logicalTop(4) + 2000
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({ top: -offset, bottom: 200000, left: 0, right: 800, width: 800, height: 200000 })
    runtime.refresh()
    expect(runtime.getRenderedBlocks().some(node => node.textContent === targetText)).toBe(true)
    expect(runtime.getRenderedBlocks().length).toBeLessThanOrEqual(96)
  }))
  it('分页原生滚动立即挂载当前视口并取消旧帧', () => withTemplateDocument(async ({ doc, editor }) => {
    await doc.setContentAsync(Array.from({ length: 256 }, (_, i) => `<p>row${i} ${'content '.repeat(75)}</p>`).join(''), { pagedView: true, yieldToMain: async () => {} })
    const runtime = editor.storage.larkDoc.pagedView, root = editor.view.dom
    let top = -100
    vi.spyOn(root, 'getBoundingClientRect').mockImplementation(() => ({ top, bottom: top + 200000, left: 0, right: 800, width: 800, height: 200000 }))
    runtime.refresh()
    const target = editor.state.doc.child(4).firstChild.textContent
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(98765)
    const cancel = vi.spyOn(window, 'cancelAnimationFrame')
    // Drain a preexisting scheduled frame before testing the next queued one.
    document.dispatchEvent(new Event('scroll'))
    runtime.schedule()
    top = -(runtime.getScrollCoordinates().logicalTop(4) + 2000)
    document.dispatchEvent(new Event('scroll'))
    expect(frame).toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledWith(98765)
    expect(runtime.getRenderedBlocks().some(node => node.textContent === target)).toBe(true)
  }))
  it('分页原生滚动忽略正文内独立滚动和导入锁定', () => withTemplateDocument(async ({ doc, editor }) => {
    await doc.setContentAsync('<p>scroll owner</p>'.repeat(80), { pagedView: true, yieldToMain: async () => {} })
    const runtime = editor.storage.larkDoc.pagedView, root = editor.view.dom
    runtime.refresh()
    const rect = vi.spyOn(root, 'getBoundingClientRect')
    root.firstElementChild.firstElementChild.dispatchEvent(new Event('scroll'))
    expect(rect).not.toHaveBeenCalled()
    editor.storage.larkDoc.pagedImport = true
    try { document.dispatchEvent(new Event('scroll')); expect(rect).not.toHaveBeenCalled() }
    finally { editor.storage.larkDoc.pagedImport = false }
  }))
  it('分页滚动事件后同帧继续滚动仍以最新视口绘制', () => withTemplateDocument(async ({ doc, editor }) => {
    await doc.setContentAsync(Array.from({ length: 256 }, (_, i) => `<p>row${i} ${'content '.repeat(75)}</p>`).join(''), { pagedView: true, yieldToMain: async () => {} })
    const runtime = editor.storage.larkDoc.pagedView, root = editor.view.dom
    let top = -100, queued
    vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => -top)
    vi.spyOn(root, 'getBoundingClientRect').mockImplementation(() => ({ top, bottom: top + 200000, left: 0, right: 800, width: 800, height: 200000 }))
    runtime.setActive(true); runtime.refresh()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { queued = callback; return 98766 })
    document.dispatchEvent(new Event('scroll'))
    expect(queued).toBeTypeOf('function')
    const target = editor.state.doc.child(4).firstChild.textContent
    top = -(runtime.getScrollCoordinates().logicalTop(4) + 2000)
    queued(0)
    expect(runtime.getRenderedBlocks().some(node => node.textContent === target)).toBe(true)
    expect(root.style.clipPath).toContain(`${Math.floor(-top - 256)}px`)
  }))
  it.each(['window', 'paper'])('分页冷页缩短同次挂载后一页且校正clip：%s', mode => withTemplateDocument(async ({ doc, editor }) => {
    await doc.setContentAsync(Array.from({ length: 256 }, (_, i) => `<p>row${i} ${'content '.repeat(75)}</p>`).join(''), { pagedView: true, yieldToMain: async () => {} })
    const runtime = editor.storage.larkDoc.pagedView, root = editor.view.dom, coordinates = runtime.getScrollCoordinates()
    const sizes = new Map(editor.state.doc.content.content.map((node, index) => [node.attrs.pageId, index === 4 ? 1000 : coordinates.height(index)]))
    let native = coordinates.top(4) + coordinates.height(4) / 2
    const paper = root.closest('.lark-doc-paper')
    if (mode === 'paper') {
      paper.style.overflowY = 'auto'
      Object.defineProperties(paper, { clientHeight: { configurable: true, value: 900 }, scrollHeight: { configurable: true, value: 500000 }, scrollTop: { configurable: true, get: () => native } })
      paper.scrollTo = options => { native = options.top }
    }
    vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => mode === 'paper' ? 0 : native)
    vi.spyOn(window, 'scrollTo').mockImplementation(options => { native = options.top })
    const layout = Element.prototype.getBoundingClientRect
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this === root) return { top: -native, bottom: 200000 - native, left: 0, right: 800, width: 800, height: 200000 }
      if (this === paper && mode === 'paper') return { top: 0, bottom: 900, left: 0, right: 800, width: 800, height: 900 }
      if (sizes.has(this.dataset?.ldPageId)) return { top: 0, bottom: sizes.get(this.dataset.ldPageId), height: sizes.get(this.dataset.ldPageId) }
      return layout.call(this)
    })
    const following = editor.state.doc.child(5).firstChild.textContent
    runtime.setActive(true); runtime.refresh()
    expect(runtime.getRenderedBlocks().some(node => node.textContent === following)).toBe(true)
    expect(root.style.clipPath).toContain(`${Math.floor(native - 256)}px`)
    if (mode === 'paper') expect(paper.style.clipPath).toContain('-256px')
  }))
  it('滚动冷页缩短，RO回调在下一RAF前挂载后一页且不强制测高', () => withTemplateDocument(async ({ doc, editor }) => {
    const previous = window.ResizeObserver
    let resized, delivering = false
    const observed = new Set(), disconnect = vi.fn(() => observed.clear())
    window.ResizeObserver = class { constructor(callback) { resized = callback } observe(node) { expect(delivering).toBe(false); observed.add(node) } unobserve(node) { observed.delete(node) } disconnect() { disconnect() } }
    try {
      await doc.setContentAsync(Array.from({ length: 256 }, (_, i) => `<p>row${i} ${'content '.repeat(75)}</p>`).join(''), { pagedView: true, yieldToMain: async () => {} })
      const runtime = editor.storage.larkDoc.pagedView, root = editor.view.dom, coordinates = runtime.getScrollCoordinates()
      let native = coordinates.top(4) + coordinates.height(4) / 2
      vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => native)
      vi.spyOn(window, 'scrollTo').mockImplementation(options => { native = options.top })
      vi.spyOn(root, 'getBoundingClientRect').mockImplementation(() => ({ top: -native, bottom: 200000 - native, left: 0, right: 800, width: 800, height: 200000 }))
      let frameId = 98767
      const frames = new Map()
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++frameId, callback); return frameId })
      vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => frames.delete(id))
      runtime.setActive(true)
      document.dispatchEvent(new Event('scroll'))
      const id = editor.state.doc.child(4).attrs.pageId
      const page = root.querySelector(`[data-ld-page-id="${id}"]`)
      const measure = vi.spyOn(page, 'getBoundingClientRect')
      delivering = true
      resized([{ target: page, borderBoxSize: [{ blockSize: 1000 }], contentRect: { height: 1000 } }])
      delivering = false
      expect(disconnect).toHaveBeenCalled()
      expect(observed.size).toBe(0)
      expect(measure).not.toHaveBeenCalled()
      const following = editor.state.doc.child(5).firstChild.textContent
      expect(runtime.getRenderedBlocks().some(node => node.textContent === following)).toBe(true)
      expect(root.style.clipPath).toContain(`${Math.floor(native - 256)}px`)
      const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(16))
      expect(observed.has(root)).toBe(true)
      expect([...root.querySelectorAll('[data-ld-page-id]')].filter(node => node.childElementCount).every(node => observed.has(node))).toBe(true)
    } finally { window.ResizeObserver = previous }
  }))
  it('分页二次实测重排不提前消费导航揭示目标', () => withTemplateDocument(async ({ doc, editor }) => {
    await doc.setContentAsync(Array.from({ length: 10 }, (_, i) => `<p>row${i}</p>`).join(''), { pagedView: true, pageBlocks: 1, yieldToMain: async () => {} })
    const runtime = editor.storage.larkDoc.pagedView, root = editor.view.dom, coordinates = runtime.getScrollCoordinates()
    const sizes = new Map(editor.state.doc.content.content.map((node, index) => [node.attrs.pageId, index === 4 ? 5000 : coordinates.height(index)]))
    let native = coordinates.top(5), target
    editor.state.doc.forEach((page, pos, index) => { if (index === 3) target = pos + 1 })
    vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => native)
    vi.spyOn(window, 'scrollTo').mockImplementation(options => { native = options.top })
    const layout = Element.prototype.getBoundingClientRect
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this === root) return { top: -native, bottom: 20000 - native, left: 0, right: 800, width: 800, height: 20000 }
      if (sizes.has(this.dataset?.ldPageId)) return { top: 0, bottom: sizes.get(this.dataset.ldPageId), height: sizes.get(this.dataset.ldPageId) }
      return layout.call(this)
    })
    expect(runtime.revealPosition(target)?.textContent).toBe('row3')
  }))
  it('分页滚动换窗不回写尚未同步的原生选区', () => withTemplateDocument(async ({ doc, editor }) => {
    await doc.setContentAsync(Array.from({ length: 256 }, (_, i) => `<p>row${i} ${'content '.repeat(75)}</p>`).join(''), { pagedView: true, yieldToMain: async () => {} })
    const runtime = editor.storage.larkDoc.pagedView, root = editor.view.dom
    let top = -100
    vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => -top)
    vi.spyOn(root, 'getBoundingClientRect').mockImplementation(() => ({ top, bottom: top + 200000, left: 0, right: 800, width: 800, height: 200000 }))
    runtime.refresh(); editor.view.focus()
    expect(editor.view.hasFocus()).toBe(true)
    const native = document.getSelection(), text = root.querySelectorAll('p')[1].firstChild
    native.setBaseAndExtent(text, 2, text, 5)
    const state = editor.state
    top = -(runtime.getScrollCoordinates().logicalTop(4) + 2000)
    document.dispatchEvent(new Event('scroll'))
    expect(editor.state).toBe(state)
    expect(native.anchorNode).toBe(text)
    expect(native.anchorOffset).toBe(2)
    expect(native.focusNode).toBe(text)
    expect(native.focusOffset).toBe(5)
    const target = editor.state.doc.child(4).firstChild.textContent
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, editor.view.posAtDOM(text, 2), editor.view.posAtDOM(text, 5))))
    runtime.refresh()
    expect(runtime.getRenderedBlocks().some(node => node.textContent === target)).toBe(true)
  }))
  it.each(['boundary', 'print'])('分页原生选区保护不阻断边界等价选区或打印：%s', mode => withTemplateDocument(async ({ doc, editor }) => {
    await doc.setContentAsync(Array.from({ length: 256 }, (_, i) => `<p>row${i} ${'content '.repeat(75)}</p>`).join(''), { pagedView: true, yieldToMain: async () => {} })
    const runtime = editor.storage.larkDoc.pagedView, root = editor.view.dom
    let top = -100
    vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => -top)
    vi.spyOn(root, 'getBoundingClientRect').mockImplementation(() => ({ top, bottom: top + 200000, left: 0, right: 800, width: 800, height: 200000 }))
    runtime.refresh(); editor.view.focus()
    const native = document.getSelection(), text = root.querySelectorAll('p')[1].firstChild
    if (mode === 'print') {
      native.setBaseAndExtent(text, 2, text, 5)
      window.dispatchEvent(new Event('beforeprint'))
      expect(root.querySelectorAll('p')).toHaveLength(256)
      window.dispatchEvent(new Event('afterprint'))
    } else {
      native.setBaseAndExtent(root, 0, root, 0)
      const target = editor.state.doc.child(4).firstChild.textContent
      top = -(runtime.getScrollCoordinates().logicalTop(4) + 2000)
      document.dispatchEvent(new Event('scroll'))
      expect(runtime.getRenderedBlocks().some(node => node.textContent === target)).toBe(true)
    }
  }))
  it('分页绘制范围在稳定窗口内随滚动更新且不重绘PM', () => withTemplateDocument(async ({ doc, editor }) => {
    const previous = window.ResizeObserver
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
    try {
      await doc.setContentAsync('<p>stable window</p>'.repeat(80), { pagedView: true, yieldToMain: async () => {} })
      const runtime = editor.storage.larkDoc.pagedView, root = editor.view.dom
      runtime.setActive(true)
      let top = -100
      vi.spyOn(root, 'getBoundingClientRect').mockImplementation(() => ({ top, bottom: top + 10000, left: 0, right: 800, width: 800, height: 10000 }))
      runtime.refresh()
      const before = root.style.clipPath, state = editor.state, update = vi.spyOn(editor.view, 'updateState')
      expect(before).toContain('inset(')
      top = -500; runtime.refresh()
      expect(root.style.clipPath).toContain('244px')
      expect(root.style.clipPath).not.toBe(before)
      expect(update).not.toHaveBeenCalled()
      expect(editor.state).toBe(state)
      runtime.setActive(false)
      runtime.refresh()
      expect(root.style.clipPath).toBe('')
      expect(root.closest('.lark-doc-paper').style.clipPath).toBe('')
      runtime.setActive(true); runtime.refresh()
      expect(root.style.clipPath).toContain('244px')
      expect(root.closest('.lark-doc-paper').style.clipPath).toContain('inset(')
    } finally { window.ResizeObserver = previous }
  }))
  it.each(['root', 'paper'])('分页绘制不覆盖宿主自有裁剪：%s', surface => withTemplateDocument(async ({ doc, editor }) => {
    const root = editor.view.dom, paper = root.closest('.lark-doc-paper')
    const target = surface === 'root' ? root : paper, other = surface === 'root' ? paper : root
    target.style.clipPath = 'inset(4px)'
    await doc.setContentAsync('<p>host clip</p>'.repeat(80), { pagedView: true, yieldToMain: async () => {} })
    const runtime = editor.storage.larkDoc.pagedView
    runtime.setActive(true)
    runtime.refresh()
    expect(target.style.clipPath).toBe('inset(4px)')
    expect(other.style.clipPath).toContain('inset(')
    runtime.setActive(false)
    expect(target.style.clipPath).toBe('inset(4px)')
    expect(other.style.clipPath).toBe('')
  }))
  it.each([
    ['focused', true, false, true, 1], ['blurred', false, false, true, 0],
    ['composing', true, true, true, 0], ['unchanged', true, false, false, 0],
    ['focus-lost-during-flush', true, false, true, 1], ['viewport-refresh', true, false, true, 0],
  ])('分页同步旧投影槽位后按需恢复原生选区：%s', (mode, focused, composing, changed, expectedFocus) => withTemplateDocument(async ({ doc, editor }) => {
    await doc.setContentAsync('<p>slot ownership</p>', { pagedView: true, yieldToMain: async () => {} })
    let hasFocus = focused
    const owner = { flushProjection: vi.fn(() => { if (mode === 'focus-lost-during-flush') hasFocus = false; return changed }) }
    editor.storage.larkDoc.projection = owner
    const focus = vi.spyOn(editor.view, 'focus').mockImplementation(() => {})
    vi.spyOn(editor.view, 'hasFocus').mockImplementation(() => hasFocus)
    vi.spyOn(editor.view, 'composing', 'get').mockReturnValue(composing)
    const next = mode === 'viewport-refresh' ? editor.state : editor.state.apply(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3)))
    editor.view.updateState(next)
    expect(owner.flushProjection).toHaveBeenCalled()
    expect(focus).toHaveBeenCalledTimes(expectedFocus)
  }))
  it('分页绘制适配CSSOM缩写序列化，稳定范围不重复写样式', () => withTemplateDocument(async ({ doc, editor }) => {
    const previous = window.ResizeObserver, root = editor.view.dom
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
    let clip = '', writes = 0
    Object.defineProperty(root.style, 'clipPath', { configurable: true, get: () => clip, set: value => { writes++; clip = value.replace(/ -100vw\)$/, ')') } })
    try {
      await doc.setContentAsync('<p>stable CSSOM</p>'.repeat(80), { pagedView: true, yieldToMain: async () => {} })
      const runtime = editor.storage.larkDoc.pagedView
      runtime.setActive(true); runtime.refresh()
      const before = writes
      runtime.refresh(); runtime.refresh(); runtime.refresh()
      expect(writes).toBe(before)
    } finally { delete root.style.clipPath; window.ResizeObserver = previous }
  }))
  it.each(['window-to-pane', 'pane-to-window'])('分页锚点不跨滚动容器复用：%s', direction => withTemplateDocument(async ({ doc, editor }) => {
    await doc.setContentAsync(Array.from({ length: 256 }, (_, i) => `<p>row${i} ${'content '.repeat(75)}</p>`).join(''), { pagedView: true, yieldToMain: async () => {} })
    const runtime = editor.storage.larkDoc.pagedView, root = editor.view.dom, parent = root.parentNode, pane = document.createElement('div')
    pane.style.overflowY = 'auto'
    Object.defineProperties(pane, { clientHeight: { value: 500 }, scrollHeight: { value: 200000 } })
    vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue({ top: 100, bottom: 600 })
    let top = -100
    vi.spyOn(root, 'getBoundingClientRect').mockImplementation(() => ({ top, bottom: top + 200000, left: 0, right: 800, width: 800, height: 200000 }))
    runtime.refresh()
    const targetText = editor.state.doc.child(4).firstChild.textContent, offset = runtime.getScrollCoordinates().logicalTop(4) + 2000
    const attach = () => { parent.insertBefore(pane, root); pane.appendChild(root); top = 100 - offset }
    const detach = () => { parent.insertBefore(root, pane); pane.remove(); top = -100 }
    try {
      if (direction === 'pane-to-window') { attach(); runtime.refresh() }
      runtime.prepareSelection()
      if (direction === 'window-to-pane') attach()
      else detach()
      runtime.refresh()
      expect(runtime.getRenderedBlocks().some(node => node.textContent === targetText)).toBe(direction === 'window-to-pane')
    } finally { if (pane.parentNode) detach() }
  }))
  it.each(['forward', 'backward'])('分页新原生滚动优先于待处理尺寸锚点：%s', direction => withTemplateDocument(async ({ doc, editor }) => {
    await doc.setContentAsync(Array.from({ length: 256 }, (_, i) => `<p>row${i} ${'content '.repeat(75)}</p>`).join(''), { pagedView: true, yieldToMain: async () => {} })
    const runtime = editor.storage.larkDoc.pagedView, root = editor.view.dom, descriptor = Object.getOwnPropertyDescriptor(window, 'scrollY')
    const targetText = editor.state.doc.child(4).firstChild.textContent, far = runtime.getScrollCoordinates().logicalTop(4) + 2000
    let native = direction === 'forward' ? 100 : far
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => native })
    vi.spyOn(root, 'getBoundingClientRect').mockImplementation(() => ({ top: -native, bottom: 200000 - native, left: 0, right: 800, width: 800, height: 200000 }))
    try {
      runtime.refresh(); runtime.refresh()
      runtime.prepareSelection()
      native = direction === 'forward' ? far : 100
      runtime.refresh()
      expect(runtime.getRenderedBlocks().some(node => node.textContent === targetText)).toBe(direction === 'forward')
    } finally { Object.defineProperty(window, 'scrollY', descriptor) }
  }))
  it('分页装饰只标记活动页，窗口未变复用同一装饰集', () => withTemplateDocument(async ({ doc, editor }) => {
    await doc.setContentAsync(Array.from({ length: 256 }, (_, i) => `<p>row${i} ${'content '.repeat(75)}</p>`).join(''), { pagedView: true, yieldToMain: async () => {} })
    const runtime = editor.storage.larkDoc.pagedView
    runtime.refresh()
    const first = runtime.decorations(editor.state, DecorationSet.empty)
    const pageDecorations = first.find().filter(item => item.spec.ldPagedActive !== undefined)
    expect(pageDecorations.length).toBeGreaterThan(0)
    expect(pageDecorations.every(item => item.spec.ldPagedActive)).toBe(true)
    expect(pageDecorations.length).toBeLessThan(editor.state.doc.childCount)
    expect(runtime.decorations(editor.state, DecorationSet.empty)).toBe(first)
  }))
  it('连续离屏页只保留聚合布局占位，物理坐标与完整正文不变', () => withTemplateDocument(async ({ doc, editor }) => {
    await doc.setContentAsync('<p>bounded layout</p>'.repeat(1000), { pagedView: true, pageBlocks: 1, yieldToMain: async () => {} })
    const runtime = editor.storage.larkDoc.pagedView, root = editor.view.dom, state = editor.state
    runtime.refresh()
    const active = [...root.children].filter(node => node.childElementCount)
    const boxes = [...root.children].filter(node => node.style.display !== 'none')
    expect(root.children.length).toBe(1000)
    expect(boxes.length).toBeLessThanOrEqual(active.length * 2 + 1)
    let before = 0
    const coordinates = runtime.getScrollCoordinates()
    for (let index = 0; index < root.children.length; index++) {
      const node = root.children[index]
      if (node.childElementCount) {
        expect(before).toBeCloseTo(coordinates.top(index), 7)
        before += coordinates.height(index)
      } else before += parseFloat(node.style.height) || 0
    }
    expect(before).toBeCloseTo(coordinates.physicalHeight, 7)
    expect(editor.state).toBe(state)
    expect(editor.getText().match(/bounded layout/g)).toHaveLength(1000)
  }))
  it('分页占位高度随宽度失效更新，保持正文身份', () => withTemplateDocument(async ({ doc, editor }) => {
    const previous = window.ResizeObserver, registrations = []
    window.ResizeObserver = class {
      constructor(callback) { this.callback = callback }
      observe(target) { registrations.push({ target, callback: this.callback }) }
      unobserve() {} disconnect() {}
    }
    try {
      await doc.setContentAsync(Array.from({ length: 256 }, (_, i) => `<p>row${i} ${'content '.repeat(75)}</p>`).join(''), { pagedView: true, yieldToMain: async () => {} })
      const runtime = editor.storage.larkDoc.pagedView, root = editor.view.dom
      runtime.refresh()
      const state = editor.state, spacer = [...root.children].find(node => !node.childNodes.length && parseFloat(node.style.height) > 0), index = [...root.children].indexOf(spacer)
      const before = parseFloat(spacer.style.height)
      registrations.find(entry => entry.target === root).callback([{ target: root, contentRect: { width: 400 } }])
      runtime.refresh()
      expect(editor.state).toBe(state)
      const nextActive = [...root.children].findIndex((node, at) => at > index && node.childNodes.length)
      const coordinates = runtime.getScrollCoordinates()
      expect(spacer.style.height).toBe(`${coordinates.top(nextActive < 0 ? root.children.length : nextActive) - coordinates.top(index)}px`)
      expect(parseFloat(spacer.style.height)).toBeGreaterThan(before)
    } finally { window.ResizeObserver = previous }
  }))
  it('分页非空基础装饰下仍保留视口前方的选区页', () => withTemplateDocument(async ({ doc, editor }) => {
    await doc.setContentAsync(Array.from({ length: 256 }, (_, i) => `<p>row${i} ${'content '.repeat(75)}</p>`).join(''), { pagedView: true, yieldToMain: async () => {} })
    const runtime = editor.storage.larkDoc.pagedView, root = editor.view.dom
    editor.commands.setTextSelection(2)
    runtime.refresh()
    const offset = runtime.getScrollCoordinates().logicalTop(4) + 2000
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({ top: -offset, bottom: 200000, left: 0, right: 800, width: 800, height: 200000 })
    runtime.refresh()
    const base = DecorationSet.create(editor.state.doc, [Decoration.node(1, 1 + editor.state.doc.firstChild.firstChild.nodeSize, { class: 'base-decoration' })])
    const activation = runtime.decorations(editor.state, base).find().filter(item => item.spec.ldPagedActive)
    expect(activation.some(item => item.from > editor.state.doc.child(0).nodeSize)).toBe(true)
    expect(activation.some(item => item.from === 0)).toBe(true)
  }))
  it('分页同高度编辑仍刷新失效测量，不等待不存在的RO尺寸变化', () => withTemplateDocument(async ({ doc, editor }) => {
    const previous = window.ResizeObserver, registrations = []
    window.ResizeObserver = class {
      constructor(callback) { this.callback = callback }
      observe(target) { registrations.push({ target, callback: this.callback }) }
      unobserve() {} disconnect() {}
    }
    try {
      await doc.setContentAsync('<p>same-height</p>', { pagedView: true, yieldToMain: async () => {} })
      const runtime = editor.storage.larkDoc.pagedView, page = editor.view.dom.firstElementChild
      const measured = vi.spyOn(page, 'getBoundingClientRect').mockReturnValue({ height: 1000, top: 0, bottom: 1000 })
      registrations.find(entry => entry.target === page).callback([{ target: page, borderBoxSize: [{ blockSize: 1000 }], contentRect: { height: 1000 } }])
      runtime.refresh()
      expect(runtime.getScrollCoordinates().logicalHeight).toBe(1000)
      measured.mockClear()
      runtime.setWindowCallback(() => {}); runtime.refresh()
      expect(measured).not.toHaveBeenCalled()
      editor.commands.insertContentAt(2, 'x')
      runtime.refresh()
      expect(measured).toHaveBeenCalled()
      expect(runtime.getScrollCoordinates().logicalHeight).toBe(1000)
    } finally { window.ResizeObserver = previous }
  }))
  it('分页视图释放离屏子DOM并保留公开正文和同一个Editor', () => withTemplateDocument(async ({ doc, editor }) => {
    const text = Array.from({ length: 40 }, (_, i) => `row${i}`)
    await doc.setContentAsync(text.map(value => `<p>${value}</p>`).join(''), { pagedView: true, pageBlocks: 4, yieldToMain: async () => {} })
    expect(doc.getEditor()).toBe(editor)
    expect(editor.state.doc.childCount).toBe(10)
    expect(editor.view.dom.querySelectorAll('p').length).toBeLessThan(40)
    expect(doc.getText()).toBe(text.join('\n\n'))
    expect(doc.getHTML()).toContain('row39')
    expect(doc.getJSON().content).toHaveLength(40)
    expect(JSON.stringify(doc.getJSON())).not.toContain('documentSegment')
    const imported = editor.state.doc
    expect(editor.commands.undo()).toBe(true)
    expect(doc.getText()).toContain('目标正文')
    expect(editor.commands.redo()).toBe(true)
    expect(editor.state.doc.eq(imported)).toBe(true)
    const json = doc.getJSON()
    const identity = editor.state.doc
    expect(await doc.setContentAsync(json, { pagedView: true, yieldToMain: async () => {} })).toBe(false)
    expect(editor.state.doc).toBe(identity)
    expect(doc.setContent(json)).toBe(false)
    expect(editor.state.doc).toBe(identity)
    const record = doc._handle.workspaceController.record()
    expect(validateDerivedSnapshot(record.derived, record.json)).not.toBeNull()
  }))
  it('分页视图打印时挂载全部正文并在结束后恢复窗口与文档身份', () => withTemplateDocument(async ({ doc, editor }) => {
    await doc.setContentAsync('<p>print row</p>'.repeat(80), { pagedView: true, pageBlocks: 4, yieldToMain: async () => {} })
    const runtime = editor.storage.larkDoc.pagedView, before = editor.state
    runtime.setActive(true)
    runtime.refresh()
    expect(editor.view.dom.style.clipPath).toContain('inset(')
    const paper = editor.view.dom.closest('.lark-doc-paper')
    expect(paper.style.clipPath).toContain('inset(')
    expect(editor.view.dom.querySelectorAll('p').length).toBeLessThan(80)
    window.dispatchEvent(new Event('beforeprint'))
    expect(editor.view.dom.style.clipPath).toBe('')
    expect(paper.style.clipPath).toBe('')
    expect(editor.view.dom.querySelectorAll('p')).toHaveLength(80)
    window.dispatchEvent(new Event('afterprint'))
    expect(editor.view.dom.style.clipPath).toContain('inset(')
    expect(paper.style.clipPath).toContain('inset(')
    expect(editor.view.dom.querySelectorAll('p').length).toBeLessThan(80)
    expect(editor.state).toBe(before)
    doc.setContent('<p>flat again</p>'); runtime.refresh()
    expect(editor.view.dom.style.clipPath).toBe('')
    expect(paper.style.clipPath).toBe('')
  }))
  it.each(['Backspace', 'Delete'])('分页视图 %s 跨边界连接正文且一次撤销恢复', key => withTemplateDocument(async ({ doc, editor }) => {
    await doc.setContentAsync('<p>one</p><p>two</p><p>three</p><p>four</p>', { pagedView: true, pageBlocks: 2, yieldToMain: async () => {} })
    const before = doc.getJSON(), first = editor.state.doc.firstChild
    editor.commands.setTextSelection(key === 'Backspace' ? first.nodeSize + 2 : first.nodeSize - 2)
    expect(editor.storage.larkDoc.pagedView.handleKeyDown(editor.view, { key })).toBe(true)
    expect(doc.getText()).toBe('one\n\ntwothree\n\nfour')
    expect(editor.commands.undo()).toBe(true)
    expect(doc.getJSON()).toEqual(before)
  }))
  it.each(['toggleBulletList', 'toggleBlockquote'])('分页视图跨页 %s 保留选区内所有块并可撤销', name => withTemplateDocument(async ({ doc, editor }) => {
    await doc.setContentAsync(Array.from({ length: 12 }, (_, i) => `<p>row${i}</p>`).join(''), { pagedView: true, pageBlocks: 2, yieldToMain: async () => {} })
    const before = doc.getJSON(), positions = []
    editor.state.doc.descendants((node, pos) => { if (node.isTextblock) positions.push(pos) })
    editor.commands.setTextSelection({ from: positions[0] + 1, to: positions.at(-1) + 6 })
    expect(editor.commands[name]()).toBe(true)
    let count = 0
    editor.state.doc.descendants(node => { if (node.isTextblock && node.textContent) count++ })
    expect(count).toBe(12)
    expect(doc.getHTML()).toContain(name === 'toggleBulletList' ? '<ul' : '<blockquote')
    expect(JSON.stringify(doc.getJSON())).not.toContain('documentSegment')
    expect(editor.commands.undo()).toBe(true)
    expect(doc.getJSON()).toEqual(before)
  }))
  it('分页视图粘贴超页正文自动拆段且拷贝不泄露内部段', () => withTemplateDocument(async ({ doc, editor }) => {
    await doc.setContentAsync('<p>original</p><p>end</p>', { pagedView: true, pageBlocks: 1, yieldToMain: async () => {} })
    const before = doc.getJSON()
    editor.commands.insertContentAt(1, Array.from({ length: 270 }, (_, i) => `<p>paste${i}</p>`).join(''))
    expect(editor.state.doc.content.content.every(node => node.type.name === 'documentSegment' && node.childCount <= 64)).toBe(true)
    expect(doc.getText()).toContain('paste269')
    const slice = editor.state.doc.slice(0, editor.state.doc.content.size)
    const copied = editor.view.props.transformCopied(slice, editor.view)
    expect(JSON.stringify(copied.toJSON())).not.toContain('documentSegment')
    expect(editor.commands.undo()).toBe(true)
    expect(doc.getJSON()).toEqual(before)
  }))
  it('分页视图跨页折叠和远处块定位仍使用真实正文位置', () => withTemplateDocument(async ({ doc, editor }) => {
    await doc.setContentAsync('<h1>head</h1>' + '<p data-indent="1">body</p>'.repeat(24) + '<h1>tail</h1><p>end</p>', { pagedView: true, pageBlocks: 3, yieldToMain: async () => {} })
    const positions = []
    editor.state.doc.descendants((node, pos) => { if (node.isTextblock) positions.push({ node, pos }) })
    const head = positions[0], tail = positions.at(-2), last = positions.at(-1)
    expect(foldedRange(editor.state.doc, head.pos).to).toBe(tail.pos)
    expect(collectFoldRanges(editor.state.doc).get(head.pos).to).toBe(tail.pos)
    expect(resolveBlockTargetRange(editor.state.doc, positions[3].pos + 1)).toMatchObject({ from: positions[3].pos, to: positions[3].pos + positions[3].node.nodeSize })
    expect(editor.view.dom.querySelector(`[data-block-id="${last.node.attrs.blockId}"]`)).toBeNull()
    const located = editor.storage.larkDoc.pagedView.revealBlockId(last.node.attrs.blockId)
    expect(located?.textContent).toBe('end')
    expect(editor.commands.toggleLarkDocFold(head.pos)).toBe(true)
    editor.storage.larkDoc.pagedView.refresh()
    expect(editor.view.dom.querySelectorAll('.ld-document-page[style*="height: 0px"]').length).toBeGreaterThan(0)
    expect(editor.commands.toggleLarkDocFold(head.pos)).toBe(true)
    expect(doc.getText()).toContain('body')
  }))
  it('分页视图句柄复制、复制章节及跨页移动不暴露内部段', () => withTemplateDocument(async ({ doc, editor, host }) => {
    await doc.setContentAsync('<h1>head</h1>' + '<p data-indent="1">body</p>'.repeat(8) + '<h1>tail</h1><p>end</p>', { pagedView: true, pageBlocks: 2, yieldToMain: async () => {} })
    const positions = []
    editor.state.doc.descendants((node, pos) => { if (node.isTextblock) positions.push({ node, pos }) })
    const head = positions[0].pos, tail = positions.at(-2).pos
    const before = doc.getJSON(), range = { from: head, to: tail }
    const copied = editor.storage.larkDoc.pagedView.copySlice(editor.state.doc.slice(head, tail))
    expect(JSON.stringify(copied.toJSON())).not.toContain('documentSegment')
    expect(resolveBlockTargetRange(editor.state.doc, positions[1].pos + 1, positions[2].pos).to).toBe(positions[2].pos)
    vi.spyOn(host, 'handleActionRange').mockReturnValue(range)
    host.blockAction('duplicate')
    expect(doc.getJSON().content.filter(node => node.type === 'heading' && node.content?.[0]?.text === 'head')).toHaveLength(2)
    expect(JSON.stringify(doc.getJSON())).not.toContain('documentSegment')
    editor.commands.undo()
    expect(doc.getJSON()).toEqual(before)
    const end = editor.state.doc.content.size - 1
    expect(moveBlockRange(editor, head, tail, end)).toBe(true)
    expect(doc.getJSON().content[0].content[0].text).toBe('tail')
    expect(JSON.stringify(doc.getJSON())).not.toContain('documentSegment')
    expect(editor.commands.undo()).toBe(true)
    expect(doc.getJSON()).toEqual(before)
  }))
  it('分页视图上方页异步长高后保持非选区阅读页挂载及阅读锚点', () => withTemplateDocument(async ({ doc, editor }) => {
    let resize, nativeTop = 0, firstHeight = 100
    const previousObserver = window.ResizeObserver
    const previousHitTest = document.elementFromPoint
    document.elementFromPoint = () => null
    window.ResizeObserver = class { constructor(callback) { resize = callback } observe() {} unobserve() {} disconnect() {} }
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      const height = this.classList.contains('ld-document-page') ? (this === editor.view.dom.firstElementChild ? firstHeight : 100) : 100
      const top = this === editor.view.dom ? -nativeTop : 0
      return { top, bottom: top + height, height, width: 800, left: 0, right: 800 }
    })
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(({ top }) => { nativeTop = top })
    const scrollY = vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => nativeTop)
    try {
      await doc.setContentAsync('<p>reading</p>'.repeat(40), { pagedView: true, pageBlocks: 1, yieldToMain: async () => {} })
      const runtime = editor.storage.larkDoc.pagedView
      runtime.refresh()
      nativeTop = runtime.getScrollCoordinates().toPhysical(runtime.getScrollCoordinates().logicalTop(20) + 10)
      runtime.refresh()
      const readingId = editor.state.doc.child(20).attrs.pageId
      firstHeight = 100000
      resize([{ target: editor.view.dom.firstElementChild, borderBoxSize: [{ blockSize: firstHeight }], contentRect: { height: firstHeight } }])
      runtime.refresh()
      const reading = editor.view.dom.querySelector(`[data-ld-page-id="${readingId}"]`)
      expect(reading?.querySelector('p')?.textContent).toBe('reading')
      expect(runtime.getScrollCoordinates().anchorAtPhysical(nativeTop).index).toBe(20)
      expect(editor.state.selection.$from.index(0)).toBe(0)
    } finally { window.ResizeObserver = previousObserver; document.elementFromPoint = previousHitTest; rect.mockRestore(); scroll.mockRestore(); scrollY.mockRestore() }
  }))
  it('分页视图折叠尾部跨多页后End与Shift选中最后可见正文', () => withTemplateDocument(async ({ doc, editor }) => {
    await doc.setContentAsync('<p>before</p>'.repeat(40) + '<h1>last visible</h1>' + '<p data-indent="1">hidden</p>'.repeat(30), { pagedView: true, pageBlocks: 2, yieldToMain: async () => {} })
    let heading
    editor.state.doc.descendants((node, pos) => { if (node.type.name === 'heading') heading = { node, pos } })
    expect(editor.commands.toggleLarkDocFold(heading.pos)).toBe(true)
    const runtime = editor.storage.larkDoc.pagedView
    runtime.refresh()
    expect(editor.view.dom.querySelector(`[data-block-id="${heading.node.attrs.blockId}"]`)).toBeNull()
    const anchor = editor.state.selection.anchor
    expect(runtime.handleKeyDown(editor.view, { key: 'End', ctrlKey: true, shiftKey: true })).toBe(true)
    expect(editor.state.selection.anchor).toBe(anchor)
    expect(editor.state.selection.head).toBe(heading.pos + heading.node.nodeSize - 1)
    expect(editor.view.dom.querySelector(`[data-block-id="${heading.node.attrs.blockId}"]`)).not.toBeNull()
    expect(runtime.handleKeyDown(editor.view, { key: 'Home', ctrlKey: true })).toBe(true)
    expect(editor.state.selection.head).toBe(2)
    expect(editor.state.selection.empty).toBe(true)
    expect(runtime.handleKeyDown(editor.view, { key: 'End', ctrlKey: true, altKey: true })).toBe(false)
    expect(runtime.handleKeyDown(editor.view, { key: 'End', ctrlKey: true, isComposing: true })).toBe(false)
    expect(editor.state.selection.head).toBe(2)
  }))
  it('分页Shift+End将图片节点选区规范成有效文本选区', () => withTemplateDocument(async ({ doc, editor }) => {
    await doc.setContentAsync('<p>before</p><img src="/fixture.png"><p>tail</p>', { pagedView: true, yieldToMain: async () => {} })
    let imagePos, tailEnd
    editor.state.doc.descendants((node, pos) => { if (node.type.name === 'image') imagePos = pos; if (node.isTextblock) tailEnd = pos + node.nodeSize - 1 })
    editor.commands.setNodeSelection(imagePos)
    const before = editor.state.doc
    expect(editor.storage.larkDoc.pagedView.handleKeyDown(editor.view, { key: 'End', ctrlKey: true, shiftKey: true })).toBe(true)
    expect(editor.state.selection).toBeInstanceOf(TextSelection)
    expect(editor.state.selection.$anchor.parent.isTextblock).toBe(true)
    expect(editor.state.selection.head).toBe(tailEnd)
    expect(editor.state.doc).toBe(before)
  }))
  it('原生DOM选区滚动只为可见固定工具栏预留高度和触发范围', () => withTemplateDocument(async ({ editor }) => {
    const toolbar = editor.view.dom.closest('.lark-doc').querySelector('.lark-doc-toolbar')
    toolbar.style.position = 'sticky'
    let height = 52
    vi.spyOn(toolbar, 'getBoundingClientRect').mockImplementation(() => ({ height }))
    editor.view.props.handleScrollToSelection(editor.view)
    expect(editor.view.someProp('scrollMargin').top).toBe(57)
    expect(editor.view.someProp('scrollThreshold').top).toBe(57)
    toolbar.style.top = '59px'
    editor.view.props.handleScrollToSelection(editor.view)
    expect(editor.view.someProp('scrollMargin').top).toBe(116)
    expect(editor.view.someProp('scrollThreshold').top).toBe(116)
    toolbar.style.display = 'none'
    editor.view.props.handleScrollToSelection(editor.view)
    expect(editor.view.someProp('scrollMargin').top).toBe(5)
    expect(editor.view.someProp('scrollThreshold').top).toBe(0)
    toolbar.style.display = 'flex'; height = 0
    editor.view.props.handleScrollToSelection(editor.view)
    expect(editor.view.someProp('scrollMargin').top).toBe(5)
    expect(editor.view.someProp('scrollThreshold').top).toBe(0)
  }))
  it.each([
    ['reading', '基本信息', 'columns', 6], ['personal', '目标完成情况', 'table', 1],
    ['report', '【工作内容】', 'table', 1], ['minutes', '会议主题：简要描述会议主题和目标', 'taskList', 1],
  ])('%s 插入真实结构且一次撤销完整恢复，重做和原标题保留', (id, text, type, count) => withTemplateDocument(async ({ doc, host, editor }) => {
    editor.commands.setTextSelection(editor.state.doc.firstChild.nodeSize + 1)
    const before = doc.getJSON()
    expect(host.chooseCommand({ id: 'template', templateId: id })).toBe(true)
    expect(doc.getText()).toContain(text)
    let total = 0
    const ids = []
    editor.state.doc.descendants(node => { if (node.type.name === type) total++; if (node.attrs.blockId) ids.push(node.attrs.blockId) })
    expect(total).toBe(count)
    expect(new Set(ids).size).toBe(ids.length)
    expect(doc.getTitle()).toBe('保留原文标题')
    expect(editor.commands.undo()).toBe(true)
    expect(doc.getJSON()).toEqual(before)
    expect(editor.commands.redo()).toBe(true)
    expect(doc.getText()).toContain(text)
  }))
  it('标准门面自定义模板和空数组保留明确覆盖语义', async () => {
    await withTemplateDocument(async ({ host, doc }) => {
      expect(host.templates.map(item => item.id)).toEqual(['custom'])
      expect(host.chooseCommand({ id: 'template', templateId: 'custom' })).toBe(true)
      expect(doc.getText()).toContain('自定义正文')
    }, { templates: [{ id: 'custom', label: '自定义', html: '<h2>自定义正文</h2>' }] })
    await withTemplateDocument(async ({ host, doc }) => {
      const before = doc.getJSON()
      expect(host.templates).toEqual([])
      expect(host.chooseCommand({ id: 'template', templateId: 'reading' })).toBe(false)
      expect(doc.getJSON()).toEqual(before)
    }, { templates: [] })
  })
  it('更多模板提供真实只读预览、前后浏览与Esc取消，保留映射选区', () => withTemplateDocument(async ({ doc, host, element, editor }) => {
    editor.commands.setTextSelection(editor.state.doc.firstChild.nodeSize + 1)
    expect(host.openTemplateLibrary()).toBe(true)
    editor.commands.insertContentAt(0, '<p>新前文</p>')
    const before = doc.getJSON()
    await vi.dynamicImportSettled()
    const library = element.querySelector('[aria-label="模板库"]')
    expect(library).not.toBeNull()
    library.querySelector('[data-template-id="personal"] .lark-doc-template-preview').click()
    const preview = library.querySelector('[aria-label="模板正文预览"]')
    expect(preview.textContent).toContain('全年目标')
    expect(preview.querySelector('[contenteditable="false"]')).not.toBeNull()
    expect(preview.querySelector('iframe,script')).toBeNull()
    const next = [...preview.querySelectorAll('button')].find(button => button.textContent === '下一个')
    next.click()
    expect(preview.textContent).toContain('【工作内容】')
    library.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
    expect(element.querySelector('[aria-label="模板库"]')).toBeNull()
    expect(doc.getJSON()).toEqual(before)
    expect(host.openTemplateLibrary()).toBe(true)
    await vi.dynamicImportSettled()
    element.querySelector('[data-template-id="personal"] .lark-doc-template-use').click()
    expect(doc.getText()).toContain('新前文')
    expect(doc.getText()).toContain('目标正文')
    expect(doc.getText()).toContain('全年目标')
    expect(element.querySelector('[aria-label="模板库"]')).toBeNull()
    expect(editor.commands.undo()).toBe(true)
    expect(doc.getJSON()).toEqual(before)
  }))
  it.each(['host-replace', 'readonly', 'feature-disabled'])('%s 后旧模板按钮不能修改当前正文', action => withTemplateDocument(async ({ doc, host, element }) => {
    expect(host.openTemplateLibrary()).toBe(true)
    await vi.dynamicImportSettled()
    const stale = element.querySelector('[data-template-id="personal"] .lark-doc-template-use')
    if (action === 'host-replace') doc.setContent('<p>新文档内容</p>')
    if (action === 'readonly') doc.setReadonly(true)
    if (action === 'feature-disabled') doc.patchProps({ config: { features: { templates: false } } })
    const before = doc.getJSON()
    stale.click()
    expect(doc.getJSON()).toEqual(before)
    if (action !== 'host-replace') expect(host.insertEditorTemplate('personal')).toBe(false)
  }))
  it.each(['reading', 'personal', 'report', 'minutes'])('真实Y.Doc中%s模板独立撤销，前一段输入不会一起丢失', async id => {
    const { Yjs, createCollabExtensions, isRemoteTransaction } = await import('../../src/collab')
    const ydoc = new Yjs.Doc({ gc: false })
    try {
      await withTemplateDocument(async ({ doc, host, editor }) => {
        editor.commands.insertContent('base')
        const manager = editor.state.plugins.map(plugin => plugin.getState(editor.state)?.undoManager).find(Boolean)
        expect(manager).toBeTruthy()
        manager.clear()
        manager.stopCapturing()
        editor.commands.insertContent(' prior')
        const before = doc.getJSON(), text = doc.getText()
        expect(host.chooseCommand({ id: 'template', templateId: id })).toBe(true)
        expect(doc.getText()).not.toBe(text)
        expect(manager.undoStack.length).toBe(2)
        doc.undo()
        expect(doc.getJSON()).toEqual(before)
        doc.undo()
        expect(doc.getText()).not.toContain(' prior')
        expect(doc.getText()).toContain('base')
        doc.redo()
        expect(doc.getText()).toBe(text)
        doc.redo()
        expect(doc.getText()).not.toBe(text)
      }, { content: '<p></p>', collab: { extensions: createCollabExtensions({ ydoc }), isRemoteTransaction } })
    } finally { ydoc.destroy() }
  })
})

describe('表格与链接选区分享真实门面', () => {
  const target = { type: 'linkEmbed', attrs: { blockId: 'shared_link', href: 'https://www.barenkeji.com', view: 'preview' } }
  async function withSelectionShare(run, options = {}) {
    stubRangeLayout()
    const element = document.createElement('div')
    document.body.appendChild(element)
    const onImageShare = vi.fn(), onSelectionShare = options.onSelectionShare || vi.fn(async () => true)
    const doc = new LarkDoc({ element, storage: 'none', onImageShare, onSelectionShare,
      mentionSource: [{ kind: 'user', id: 'recipient', name: '接收人' }], content: { type: 'doc', content: [target] }, ...options })
    try { return await run({ doc, host: doc._handle.nativeHost.host, element, onSelectionShare, onImageShare }) }
    finally { doc.destroy(); element.remove() }
  }
  function choose(host) { host.toggleImageShareRecipient('recipient', 'user') }
  it.each(['bookmark', 'linkEmbed'])('%s网页卡片摘录保留经网络策略允许的真实封面与图标', kind => withSelectionShare(async ({ host, element }) => {
    expect(host.openSelectionShareDialog(0)).toBe(true)
    await vi.waitFor(() => expect(element.querySelector('.lark-doc-image-share-preview .lark-doc-bookmark-cover')).not.toBeNull())
    const preview = element.querySelector('.lark-doc-image-share-preview')
    expect(preview.querySelector('.lark-doc-bookmark-cover').style.backgroundImage).toContain('https://assets.example.test/cover.png')
    expect(preview.querySelector('.lark-doc-bookmark-icon').style.backgroundImage).toContain('https://assets.example.test/icon.png')
    expect(preview.querySelector('iframe,script,button,a[href]')).toBeNull()
  }, { content: { type: 'doc', content: [{ type: kind, attrs: kind === 'bookmark' ? { blockId: 'shared_card_media', url: 'https://example.test', title: '网页卡片', cover: 'https://assets.example.test/cover.png', favicon: 'https://assets.example.test/icon.png' } : { blockId: 'shared_card_media', href: 'https://example.test', view: 'card', cardMeta: JSON.stringify({ title: '网页卡片', cover: 'https://assets.example.test/cover.png', favicon: 'https://assets.example.test/icon.png' }) } }] } }))
  it.each(['offline', 'allowlist'])('摘录%s不将伪本地图片路径当作离线资源', mode => {
    const source = document.createElement('div'), image = document.createElement('img')
    image.setAttribute('src', '/' + String.fromCharCode(92) + 'outside.example.test/track.png')
    source.appendChild(image)
    const clone = cloneShareExcerpt(source, createNetworkPolicy({ mode, allowlist: [] }))
    expect(clone.querySelector('img').getAttribute('src')).toBe(BLOCKED_IMAGE_PLACEHOLDER)
  })
  it('静态摘录只对合法网页卡片媒体保留单个URL，其余活动内容仍被清理', () => {
    const source = document.createElement('div')
    source.innerHTML = '<div class="lark-doc-bookmark-cover" style="background-image:url(https://denied.example/cover.png)"></div><div class="lark-doc-bookmark-icon" style="background-image:url(javascript:alert)"></div><div class="arbitrary" style="background-image:url(https://allowed.example/track.png)"></div><iframe src="https://allowed.example/frame"></iframe><button onclick="alert(1)">按钮</button><script>alert(1)</script>'
    const clone = cloneShareExcerpt(source, createNetworkPolicy({ mode: 'allowlist', allowlist: ['allowed.example'] }))
    expect(clone.querySelectorAll('[style*="url("]')).toHaveLength(0)
    expect(clone.querySelector('iframe,script,button,[onclick]')).toBeNull()
  })
  it('预览分享使用静态内嵌网页卡且派发独立回调，正文不变', () => withSelectionShare(async ({ doc, host, element, onSelectionShare, onImageShare }) => {
    const before = doc.getJSON()
    expect(host.openSelectionShareDialog(0)).toBe(true)
    await vi.waitFor(() => expect(element.querySelector('.lark-doc-image-share-dialog')).not.toBeNull())
    const preview = element.querySelector('.lark-doc-image-share-preview')
    expect(preview.textContent).toContain('内嵌网页')
    expect(preview.textContent).toContain('该内容暂不支持预览')
    expect(preview.querySelector('iframe,script,input,button')).toBeNull()
    await vi.waitFor(() => expect(element.querySelectorAll('.lark-doc-image-share-result')).toHaveLength(1))
    choose(host)
    host.setImageShareMessage('发送留言')
    expect(await host.submitImageShare()).toBe(true)
    expect(onImageShare).not.toHaveBeenCalled()
    expect(onSelectionShare).toHaveBeenCalledOnce()
    expect(onSelectionShare.mock.calls[0][0]).toMatchObject({ selection: { type: 'node', blockId: 'shared_link' }, recipients: [{ id: 'recipient', kind: 'user' }], message: '发送留言' })
    expect(onSelectionShare.mock.calls[0][0].url).toContain('#share-shared_link')
    expect(doc.getJSON()).toEqual(before)
  }))
  it('表格分享静态预览保留整表与所选格，回调content只取真实矩形', () => withSelectionShare(async ({ doc, host, element, onSelectionShare }) => {
    const editor = doc.getEditor()
    editor.commands.setContent({ type: 'doc', content: [{ type: 'table', attrs: { blockId: 'shared_table' }, content: Array.from({ length: 3 }, (_, row) => ({ type: 'tableRow', content: Array.from({ length: 3 }, (_, col) => ({ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: `${'ABC'[col]}${row + 1}` }] }] })) })) }] })
    const cells = []
    editor.state.doc.descendants((node, pos) => { if (node.type.name === 'tableCell') cells.push(pos) })
    editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, cells[0], cells[4])))
    expect(host.openSelectionShareDialog()).toBe(true)
    await vi.waitFor(() => expect(element.querySelectorAll('.lark-doc-image-share-preview td')).toHaveLength(9))
    const preview = element.querySelector('.lark-doc-image-share-preview')
    expect(preview.querySelectorAll('td.selectedCell')).toHaveLength(4)
    expect(preview.querySelector('button,input,iframe,[contenteditable]')).toBeNull()
    await vi.waitFor(() => expect(element.querySelectorAll('.lark-doc-image-share-result')).toHaveLength(1))
    choose(host)
    expect(await host.submitImageShare()).toBe(true)
    const sent = onSelectionShare.mock.calls[0][0].selection
    expect(sent).toMatchObject({ type: 'cell', blockId: 'shared_table' })
    expect(JSON.stringify(sent.content)).toContain('A1')
    expect(JSON.stringify(sent.content)).not.toContain('C1')
  }))
  it('表格块菜单提供真实分享和可解析的区块定位链接', () => withSelectionShare(async ({ doc, host }) => {
    doc.getEditor().commands.setContent('<table data-block-id="block_share_table"><tbody><tr><td><p>表格内容</p></td></tr></tbody></table>')
    host.handleRange = { from: 0, to: doc.getEditor().state.doc.firstChild.nodeSize }
    host.openBlockMenu(); await vi.dynamicImportSettled()
    expect(host.buildBlockMenuState().listActions.map(item => item.id)).toEqual(expect.arrayContaining(['share', 'copyLink']))
    expect(await host.blockAction('share')).toBe(true)
    expect(host.imageShare).toMatchObject({ target: 'selection', selection: { blockId: 'block_share_table', type: 'cell' } })
    host.closeImageShareDialog()
    host.copyShareText = vi.fn(async () => true)
    expect(await host.blockAction('copyLink')).toBe(true)
    expect(host.copyShareText.mock.calls[0][0]).toContain('#share-block_share_table')
  }))
  it.each([
    ['paragraph', '<p data-block-id="shared_normal">目标正文</p>'],
    ['taskItem', '<ul data-type="taskList"><li data-type="taskItem" data-block-id="shared_task"><p>目标任务</p></li></ul>'],
    ['codeBlock', '<pre data-block-id="shared_code"><code>const value = 1</code></pre>'],
  ])('六点%s菜单分享和复制链接绑定真实块锚点', (kind, html) => withSelectionShare(async ({ doc, host }) => {
    const editor = doc.getEditor()
    doc.setContent(html)
    let range, blockId
    editor.state.doc.descendants((node, pos) => { if (node.type.name === kind) { range = { from: pos, to: pos + node.nodeSize }; blockId = node.attrs.blockId } })
    host.handleRange = range
    expect(await host.blockAction('share')).toBe(true)
    expect(host.imageShare.selection.blockId).toBe(blockId)
    host.closeImageShareDialog(); host.handleRange = range
    host.copyShareText = vi.fn(async () => true)
    expect(await host.blockAction('copyLink')).toBe(true)
    const hash = new URL(host.copyShareText.mock.calls[0][0]).hash
    expect(hash).toBe(`#share-${blockId}`)
    const element = editor.view.dom.querySelector(`[data-block-id="${blockId}"]`)
    element.scrollIntoView = vi.fn()
    const previous = location.hash
    try { history.replaceState(null, '', hash); host.jumpSharedBlock(); expect(element.scrollIntoView).toHaveBeenCalledWith({ block: 'center' }) }
    finally { history.replaceState(null, '', previous || location.pathname) }
  }))
  it.each([false, true])('复制链接等待期间替换正文后忽略旧%s提示', rejected => withSelectionShare(async ({ doc, host }) => {
    doc.getEditor().commands.setContent('<table data-block-id="clipboard_table"><tbody><tr><td><p>复制原表</p></td></tr></tbody></table>')
    host.handleRange = { from: 0, to: doc.getEditor().state.doc.firstChild.nodeSize }
    let finish
    host.copyShareText = () => new Promise((resolve, reject) => { finish = () => rejected ? reject(new Error('旧剪贴板错误')) : resolve(true) })
    host.showShareToast = vi.fn()
    const errorBefore = host.error
    const pending = host.blockAction('copyLink')
    doc.getEditor().commands.setContent('<p>新文档正文</p>')
    finish()
    expect(await pending).toBe(false)
    expect(host.showShareToast).not.toHaveBeenCalled()
    expect(host.error).toBe(errorBefore)
  }))
  it('链接预览浮窗的分享按钮打开真实选区分享弹窗', () => withSelectionShare(async ({ host, element }) => {
    host.onLinkMouseOver({ target: element.querySelector('[data-type="link-embed"]') })
    await vi.waitFor(() => expect(element.querySelector('.lark-doc-link-tools')).not.toBeNull())
    const button = element.querySelector('.lark-doc-link-tools button[aria-label="分享"]')
    expect(button).not.toBeNull()
    button.click()
    expect(host.imageShare).toMatchObject({ target: 'selection', selection: { blockId: 'shared_link' } })
  }))
  it.each([{ crop: null }, { crop: [0.1, 0.1, 0.8, 0.8] }])('选区分享后切图片分享不能继承198px旧视窗（%j）', ({ crop }) => withSelectionShare(async ({ doc, host, element }) => {
    host.openSelectionShareDialog(0)
    await vi.waitFor(() => expect(element.querySelector('.lark-doc-selection-share-content')).not.toBeNull())
    expect(element.querySelector('.lark-doc-selection-share-content').style.height).toBe('198px')
    doc.getEditor().commands.setContent({ type: 'doc', content: [{ type: 'image', attrs: { blockId: 'image_after_selection', src: '/a.png', width: 323, naturalWidth: 323, naturalHeight: 275, crop } }] })
    host.openImageShareDialog({ ...doc.getEditor().state.doc.firstChild.attrs, pos: 0 })
    await vi.waitFor(() => expect(element.querySelector('.lark-doc-image-share-preview-frame img')).not.toBeNull())
    const image = element.querySelector('.lark-doc-image-share-preview-frame img')
    expect(image.parentElement.style.height).toBe('')
  }))
  it('未接分享服务时保留查看与取消，绝不派发图片服务假成功', () => withSelectionShare(async ({ host, element, onImageShare }) => {
    expect(host.openSelectionShareDialog(0)).toBe(true)
    await vi.waitFor(() => expect(element.querySelectorAll('.lark-doc-image-share-result')).toHaveLength(1))
    choose(host)
    const send = element.querySelector('.lark-doc-image-share-footer .is-primary')
    expect(send.disabled).toBe(true)
    expect(await host.submitImageShare()).toBe(false)
    expect(onImageShare).not.toHaveBeenCalled()
    expect(host.imageShare).not.toBeNull()
    host.closeImageShareDialog()
    expect(host.imageShare).toBeNull()
  }, { onSelectionShare: null }))
  it.each(['insert-before', 'delete-target'])('选区建立后 %s 只发送仍有效的真实块', change => withSelectionShare(async ({ doc, host, element, onSelectionShare }) => {
    host.openSelectionShareDialog(0)
    await vi.waitFor(() => expect(element.querySelectorAll('.lark-doc-image-share-result')).toHaveLength(1))
    choose(host)
    if (change === 'insert-before') doc.getEditor().commands.insertContentAt(0, '<p>前置段落</p>')
    else doc.getEditor().commands.setContent('<p data-block-id="replacement">新正文</p>')
    const result = await host.submitImageShare()
    if (change === 'insert-before') { expect(result).toBe(true); expect(onSelectionShare).toHaveBeenCalledOnce() }
    else { expect(result).toBe(false); expect(onSelectionShare).not.toHaveBeenCalled() }
  }))
  it('取消中止旧发送，迟到响应不能清除新打开的分享', () => {
    let finish, signal
    const onSelectionShare = vi.fn(input => { signal = input.signal; return new Promise(resolve => { finish = resolve }) })
    return withSelectionShare(async ({ host, element }) => {
      host.openSelectionShareDialog(0)
      await vi.waitFor(() => expect(element.querySelectorAll('.lark-doc-image-share-result')).toHaveLength(1))
      choose(host)
      const pending = host.submitImageShare()
      host.closeImageShareDialog()
      expect(signal.aborted).toBe(true)
      host.openSelectionShareDialog(0)
      const current = host.imageShare
      finish(true)
      expect(await pending).toBe(false)
      expect(host.imageShare).toBe(current)
    }, { onSelectionShare })
  })
  it('服务拒绝发送时保留接收人与留言，允许明确重试', () => {
    const onSelectionShare = vi.fn().mockRejectedValueOnce(new Error('选区发送失败')).mockResolvedValue(true)
    return withSelectionShare(async ({ host, element }) => {
      host.openSelectionShareDialog(0)
      await vi.waitFor(() => expect(element.querySelectorAll('.lark-doc-image-share-result')).toHaveLength(1))
      choose(host)
      host.setImageShareMessage('保留的留言')
      expect(await host.submitImageShare()).toBe(false)
      expect(host.imageShare).toMatchObject({ sending: false, message: '保留的留言', error: '选区发送失败', recipients: [{ id: 'recipient' }] })
      expect(await host.submitImageShare()).toBe(true)
      expect(onSelectionShare).toHaveBeenCalledTimes(2)
      expect(host.imageShare).toBeNull()
    }, { onSelectionShare })
  })
  it('发送等待期间撤销内容导出权限会中止并拒绝迟到确认', () => {
    let finish, signal
    const onSelectionShare = vi.fn(input => { signal = input.signal; return new Promise(resolve => { finish = resolve }) })
    return withSelectionShare(async ({ doc, host, element }) => {
      host.openSelectionShareDialog(0)
      await vi.waitFor(() => expect(element.querySelectorAll('.lark-doc-image-share-result')).toHaveLength(1))
      choose(host)
      const pending = host.submitImageShare()
      const session = doc.getSession()
      session.setProvider('authorization', { getCapabilities: async () => ({ canView: true, canExport: false }) })
      await session.refreshCapabilities()
      expect(signal.aborted).toBe(true)
      expect(host.imageShare).toBeNull()
      finish(true)
      expect(await pending).toBe(false)
      expect(host.openSelectionShareDialog(0)).toBe(false)
    }, { onSelectionShare })
  })
})

describe('图片 AI 真实门面接线', () => {
  it.each(['insert-before', 'delete', 'replace'])('图片准备期间 %s 保留有效提问或取消真实失效引用', async change => {
    stubRangeLayout()
    const element = document.createElement('div')
    document.body.appendChild(element)
    const stream = vi.fn(() => ({ cancel() {} }))
    const doc = new LarkDoc({ element, storage: 'none', ai: { supportsImages: true, stream }, content: { type: 'doc', content: [{ type: 'image', attrs: { src: '/image.png', blockId: 'image_ai' } }] } })
    try {
      await new Promise(resolve => setTimeout(resolve, 0))
      const editor = doc.getEditor(), workspace = doc.getWorkspace()
      workspace.openImageAI({ ...editor.state.doc.firstChild.attrs, pos: 0 })
      const controller = doc._handle.workspaceController
      let finish
      controller.prepareAIImage = () => new Promise(resolve => { finish = resolve })
      workspace.state.aiPrompt = '有效问题'
      const sending = workspace.sendAIChat()
      if (change === 'insert-before') editor.commands.insertContentAt(0, '<p>新段落</p>')
      if (change === 'delete') editor.commands.deleteRange({ from: 0, to: 1 })
      if (change === 'replace') editor.commands.updateAttributes('image', { src: '/other.png' })
      finish({ url: 'data:image/png;base64,YQ==', blockId: 'image_ai' })
      await sending
      if (change === 'insert-before') {
        expect(workspace.state.aiImage.pos).toBeGreaterThan(0)
        expect(stream).toHaveBeenCalledOnce()
        expect(stream.mock.calls[0][0].prompt).toBe('有效问题')
      } else {
        expect(stream).not.toHaveBeenCalled()
        expect(workspace.state.aiImage).toBeNull()
        expect(workspace.state.aiRunning).toBe(false)
      }
    } finally { doc.destroy(); element.remove() }
  })

  it('调整宽度、对齐和说明保留图片引用，实际裁剪或地址变化才使引用失效', async () => {
    stubRangeLayout()
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, storage: 'none', content: { type: 'doc', content: [{ type: 'image', attrs: { src: '/image.png', blockId: 'image_ai' } }] } })
    try {
      await new Promise(resolve => setTimeout(resolve, 0))
      const editor = doc.getEditor(), workspace = doc.getWorkspace()
      expect(workspace.openImageAI({ ...editor.state.doc.firstChild.attrs, pos: 0 })).toBe(true)
      for (const attrs of [{ width: 200 }, { align: 'left' }, { caption: 'new caption' }]) {
        editor.commands.updateAttributes('image', attrs)
        expect(workspace.state.aiImage?.blockId).toBe('image_ai')
        expect(workspace.state.aiError).toBe('')
      }
      editor.commands.updateAttributes('image', { crop: [0, 0, .5, 1] })
      expect(workspace.state.aiImage).toBeNull()
      expect(workspace.state.aiError).toContain('图片已改变')
      expect(workspace.openImageAI({ ...editor.state.doc.firstChild.attrs, pos: 0 })).toBe(true)
      editor.commands.updateAttributes('image', { src: '/other.png' })
      expect(workspace.state.aiImage).toBeNull()
    } finally { doc.destroy(); element.remove() }
  })

  it('不同 session 打开普通 AI 时看不到上一图片问答的草稿、问题和回复', async () => {
    stubRangeLayout()
    const element = document.createElement('div')
    document.body.appendChild(element)
    const sessionB = createDocumentSession({ documentId: 'image-ai-b', user: { id: 'b' } })
    const doc = new LarkDoc({ element, storage: 'none', ai: { stream(args) { args.onChunk('PRIVATE A ANSWER'); args.onDone(); return { cancel() {} } } }, content: { type: 'doc', content: [{ type: 'image', attrs: { src: '/image.png', blockId: 'image_ai' } }] } })
    try {
      const nodeView = doc.getEditor().view.docView.children.find(child => child.node.type.name === 'image').spec
      nodeView.mountToolbar()
      nodeView.dom.querySelector('[data-action="ai"]').click()
      await new Promise(resolve => setTimeout(resolve, 0))
      const panel = element.querySelector('[aria-label="图片问答"]')
      panel.querySelector('[aria-label="移除图片引用"]').click()
      const prompt = panel.querySelector('textarea')
      prompt.value = 'PRIVATE A QUESTION'
      prompt.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(resolve => setTimeout(resolve, 0))
      panel.querySelector('[aria-label="发送图片问答"]').click()
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(panel.textContent).toContain('PRIVATE A ANSWER')
      prompt.value = 'PRIVATE A DRAFT'
      prompt.dispatchEvent(new Event('input', { bubbles: true }))
      doc.patchProps({ session: sessionB })
      await new Promise(resolve => setTimeout(resolve, 0))
      const workspace = doc.getWorkspace()
      expect(workspace.state.aiMessages).toEqual([])
      expect(workspace.state.aiPrompt).toBe('')
      expect(workspace.state.aiPreview).toBe('')
      workspace.startAI('chat', { prompt: 'B question' })
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(element.querySelector('.lark-doc-ai-messages')).toBeNull()
      expect(element.textContent).not.toContain('PRIVATE A QUESTION')
      expect(element.textContent).not.toContain('PRIVATE A DRAFT')
    } finally { doc.destroy(); sessionB.dispose(); element.remove() }
  })

  it('工具条打开图片引用而不生成，移除引用不改正文，热禁用 AI 关闭侧栏并隐藏入口', async () => {
    stubRangeLayout()
    const element = document.createElement('div')
    document.body.appendChild(element)
    const stream = vi.fn(() => ({ cancel() {} }))
    const doc = new LarkDoc({ element, storage: 'none', ai: { supportsImages: true, stream }, content: { type: 'doc', content: [{ type: 'image', attrs: { src: '/image.png', blockId: 'image_ai' } }] } })
    try {
      const before = JSON.stringify(doc.getJSON())
      const nodeView = doc.getEditor().view.docView.children.find(child => child.node.type.name === 'image').spec
      nodeView.mountToolbar()
      const ask = nodeView.dom.querySelector('[data-action="ai"]')
      expect(ask.textContent).toBe('问问AI')
      ask.click()
      await new Promise(resolve => setTimeout(resolve, 0))
      const panel = element.querySelector('[aria-label="图片问答"]')
      expect(panel).not.toBeNull()
      expect(panel.querySelector('.lark-doc-image-ai-reference').hidden).toBe(false)
      expect(panel.querySelector('[aria-label="发送图片问答"]').disabled).toBe(true)
      expect(document.activeElement).toBe(panel.querySelector('textarea'))
      expect(stream).not.toHaveBeenCalled()
      panel.querySelector('[aria-label="移除图片引用"]').click()
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(panel.querySelector('.lark-doc-image-ai-reference').hidden).toBe(true)
      expect(JSON.stringify(doc.getJSON())).toBe(before)
      doc.patchProps({ config: { features: { ai: false } } })
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(element.querySelector('[aria-label="图片问答"]')).toBeNull()
      nodeView.mountToolbar()
      expect(nodeView.dom.querySelector('[data-action="ai"]')).toBeNull()
    } finally { doc.destroy(); element.remove() }
  })
})

describe('public reference content and asynchronous comments', () => {
  it.each(['offline', 'allowlist'])('does not restore blocked originals through image Reset in %s mode', async mode => {
    stubRangeLayout()
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, storage: 'none', config: { network: { mode, allowlist: ['allowed.example'] } }, content: { type: 'doc', content: [{ type: 'image', attrs: { src: 'https://blocked.example/original.png', blockId: 'image_a' } }] } })
    try {
      const editor = doc.getEditor(), view = editor.view.docView.children.find(child => child.node.type.name === 'image').spec
      view.mountToolbar()
      expect(editor.state.doc.firstChild.attrs.src).toBe(BLOCKED_IMAGE_PLACEHOLDER)
      expect(view.dom.querySelector('[data-action="reset"]')).toBeNull()
      expect(view.reset()).toBe(false)
      expect(editor.state.doc.firstChild.attrs.src).toBe(BLOCKED_IMAGE_PLACEHOLDER)
      expect(view.dom.querySelector('img').getAttribute('src')).toBeNull()
      doc.setContent({ type: 'doc', content: [{ type: 'image', attrs: { src: '/safe-crop.png', originalSrc: 'https://blocked.example/original.png', blockId: 'image_a' } }] })
      const replacement = editor.view.docView.children.find(child => child.node.type.name === 'image').spec
      expect(replacement.reset()).toBe(false)
      expect(editor.state.doc.firstChild.attrs.src).toBe('/safe-crop.png')
    } finally { doc.destroy(); element.remove() }
  })

  it('checks current policy on Reset while allowing metadata-only crop reset of a local image', () => {
    stubRangeLayout()
    const element = document.createElement('div')
    document.body.appendChild(element)
    const attrs = { blockId: 'image_a', src: '/safe-crop.png', originalSrc: 'https://blocked.example/original.png', width: 463, naturalWidth: 323, naturalHeight: 275, crop: [0, 0, 0.8704, 1] }
    const doc = new LarkDoc({ element, storage: 'none', content: { type: 'doc', content: [{ type: 'image', attrs }] } })
    try {
      doc.patchProps({ config: { network: { mode: 'offline' } } })
      const editor = doc.getEditor(), view = editor.view.docView.children.find(child => child.node.type.name === 'image').spec
      expect(view.reset()).toBe(true)
      expect(editor.state.doc.firstChild.attrs).toMatchObject({ src: '/safe-crop.png', crop: null, width: 463 })
    } finally { doc.destroy(); element.remove() }
  })

  it('locates viewer image comments by stable block identity after preceding text changes', async () => {
    stubRangeLayout()
    const element = document.createElement('div')
    document.body.appendChild(element)
    const comments = createMemoryCommentsProvider()
    const doc = new LarkDoc({ element, storage: 'none', comments, user: { id: 'me' }, content: { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'x' }] },
      { type: 'image', attrs: { blockId: 'image_a', src: '/a.png' } },
      { type: 'image', attrs: { blockId: 'image_b', src: '/b.png' } },
    ] } })
    try {
      const editor = doc.getEditor(), host = doc._handle.nativeHost.host
      const snapshot = { ...editor.state.doc.nodeAt(3).attrs, pos: 3 }
      editor.commands.deleteRange({ from: 1, to: 2 })
      const viewer = document.createElement('div')
      element.appendChild(viewer)
      host.openImageComments(snapshot, true, viewer)
      expect(host.commentSelectionRange().blockId).toBe('image_a')
      host.setCommentComposerDraft('A 的评论')
      await host.submitCommentComposer()
      expect((await comments.list())[0].blockId).toBe('image_a')
    } finally { doc.destroy(); element.remove() }
  })

  it('clears and reloads comments, private drafts and edits on session and provider replacement', async () => {
    stubRangeLayout()
    const element = document.createElement('div')
    document.body.appendChild(element)
    const provider = content => createMemoryCommentsProvider({ threads: [{ id: 'same', blockId: 'b1', author: { id: 'me' }, replies: [{ id: 'r1', author: { id: 'me' }, content }] }] })
    const sessionA = createDocumentSession({ documentId: 'a', user: { id: 'me' }, providers: { comments: provider('A 私有内容') } })
    const sessionB = createDocumentSession({ documentId: 'b', user: { id: 'me' }, providers: { comments: provider('B 内容') } })
    const doc = new LarkDoc({ element, storage: 'none', session: sessionA, content: '<p data-block-id="b1">正文</p>' })
    try {
      const host = doc._handle.nativeHost.host
      await host.loadComments()
      host.commentDrafts = { same: 'A 私有草稿' }
      host.beginCommentEdit('same', 'r1')
      doc.patchProps({ session: sessionB })
      await vi.waitFor(() => expect(host.commentThreads[0]?.replies[0]?.content).toBe('B 内容'))
      expect(host.commentDrafts).toEqual({})
      expect(host.commentEditing).toBeNull()
      host.commentDrafts = { same: 'B 草稿' }
      sessionB.setProvider('comments', provider('C 新来源'))
      await vi.waitFor(() => expect(host.commentThreads[0]?.replies[0]?.content).toBe('C 新来源'))
      expect(host.commentDrafts).toEqual({})
    } finally { doc.destroy(); await sessionA.dispose(); await sessionB.dispose(); element.remove() }
  })

  it('preserves the active edit DOM, draft and caret when another reply reloads', async () => {
    stubRangeLayout()
    const element = document.createElement('div')
    document.body.appendChild(element)
    const comments = createMemoryCommentsProvider({ threads: [{ id: 'thread', blockId: 'b1', author: { id: 'me' }, replies: [{ id: 'r1', author: { id: 'me' }, content: 'saved' }] }] })
    const doc = new LarkDoc({ element, storage: 'none', comments, user: { id: 'me' }, content: '<p data-block-id="b1">正文</p>' })
    try {
      const host = doc._handle.nativeHost.host
      await host.loadComments()
      host.beginCommentEdit('thread', 'r1')
      await vi.waitFor(() => expect(element.querySelector('.lark-doc-comment-edit-input')).not.toBeNull())
      const input = element.querySelector('.lark-doc-comment-edit-input')
      input.value = 'unsaved draft'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.focus()
      input.setSelectionRange(2, 2)
      await comments.reply({ threadId: 'thread', author: { id: 'other' }, content: 'remote reply' })
      await host.loadComments()
      expect(element.querySelector('.lark-doc-comment-edit-input')).toBe(input)
      expect(input.value).toBe('unsaved draft')
      expect(input.selectionStart).toBe(2)
      expect(await host.confirmCommentEdit('thread', 'r1', input.value)).toBe(true)
      expect(host.commentEditing).toBeNull()
      expect((await comments.list())[0].replies[0].content).toBe('unsaved draft')
    } finally { doc.destroy(); element.remove() }
  })

  it('closes an acknowledged image comment even if the post-write list refresh fails', async () => {
    stubRangeLayout()
    const element = document.createElement('div')
    document.body.appendChild(element)
    const comments = createMemoryCommentsProvider(), listStored = comments.list
    const doc = new LarkDoc({ element, storage: 'none', comments, user: { id: 'me' }, content: { type: 'doc', content: [{ type: 'image', attrs: { src: '/a.png', blockId: 'image_a' } }] } })
    try {
      const host = doc._handle.nativeHost.host
      await host.loadComments()
      host.beginCommentComposer(0)
      host.setCommentComposerDraft('已保存的评论')
      comments.list = vi.fn(async () => { throw new Error('refresh failed') })
      expect((await host.submitCommentComposer()).id).toBeTruthy()
      expect(host.commentComposer).toBeNull()
      expect(host.error).toContain('已保存')
      expect(await host.submitCommentComposer()).toBeNull()
      expect(await listStored()).toHaveLength(1)
    } finally { doc.destroy(); element.remove() }
  })

  it('shares a contextual image excerpt and selects recipients without changing the document', async () => {
    stubRangeLayout()
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, storage: 'none', onImageShare: vi.fn(async () => true),
      mentionSource: [{ kind: 'user', id: 'one', name: 'First' }, { kind: 'chat', id: 'two', name: 'Second' }],
      content: { type: 'doc', content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Before image', marks: [{ type: 'bold' }] }] },
        { type: 'image', attrs: { src: '/a.png', width: 323, naturalWidth: 323, naturalHeight: 275, blockId: 'image_a' } },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'After image' }] },
      ] } })
    try {
      const host = doc._handle.nativeHost.host, saved = doc.getJSON()
      const imagePos = doc.getEditor().state.doc.firstChild.nodeSize
      host.openImageShareDialog({ ...doc.getEditor().state.doc.nodeAt(imagePos).attrs, pos: imagePos })
      await vi.waitFor(() => expect(element.querySelectorAll('.lark-doc-image-share-result')).toHaveLength(2))
      const excerpt = element.querySelector('.lark-doc-image-share-excerpt')
      expect(excerpt.style.height).toBe('397px')
      expect(excerpt.querySelector('.is-before').textContent).toBe('Before image')
      expect(excerpt.querySelector('.is-before strong')).toBeTruthy()
      expect(excerpt.querySelector('[data-block-id]')).toBeNull()
      expect(excerpt.querySelector('.is-after').textContent).toBe('After image')
      host.$forceUpdate()
      await host.$nextTick()
      expect(host.imageShare).not.toBeNull()
      const input = element.querySelector('.lark-doc-image-share-selector input')
      input.focus()
      const results = element.querySelector('.lark-doc-image-share-results')
      element.querySelector('.lark-doc-image-share-result').click()
      expect(results.hidden).toBe(true)
      expect(document.activeElement).toBe(input)
      input.click()
      expect(results.hidden).toBe(false)
      element.querySelectorAll('.lark-doc-image-share-result')[1].click()
      expect(results.hidden).toBe(true)
      expect(host.imageShare.recipients.map(item => item.id)).toEqual(['one', 'two'])
      host.toggleImageShareRecipient('one', 'user')
      host.toggleImageShareRecipient('two', 'chat')
      await vi.waitFor(() => expect(element.querySelectorAll('.lark-doc-image-share-recipients button')).toHaveLength(0))
      input.click()
      element.querySelector('.lark-doc-image-share-results-head button').click()
      expect(element.querySelectorAll('.lark-doc-image-share-check')).toHaveLength(2)
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true }))
      expect(host.imageShare.recipients).toHaveLength(0)
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      expect(host.imageShare.recipients.map(item => item.id)).toEqual(['two'])
      await vi.waitFor(() => expect(element.querySelector('.lark-doc-image-share-recipients button')).toBeTruthy())
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }))
      expect(host.imageShare.recipients).toHaveLength(0)
      expect(doc.getJSON()).toEqual(saved)
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      expect(host.imageShare).toBeNull()
      host.openImageShareDialog({ ...doc.getEditor().state.doc.nodeAt(imagePos).attrs, pos: imagePos })
      const previous = host.session, replacement = createDocumentSession()
      try {
        host.session = replacement
        await host.$nextTick()
        expect(host.imageShare).toBeNull()
      } finally { host.session = previous; replacement.dispose() }
    } finally { doc.destroy(); element.remove() }
  })

  it('keeps a cropped small image at its displayed size in the share excerpt', async () => {
    stubRangeLayout()
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, storage: 'none', content: { type: 'doc', content: [
      { type: 'image', attrs: { src: '/a.png', width: 180, naturalWidth: 400, naturalHeight: 300, crop: [0, 0, .5, 1], caption: 'Caption', blockId: 'image_a' } },
    ] } })
    try {
      const host = doc._handle.nativeHost.host
      host.openImageShareDialog({ ...doc.getEditor().state.doc.firstChild.attrs, pos: 0 })
      await vi.waitFor(() => expect(element.querySelector('.lark-doc-image-share-excerpt')).toBeTruthy())
      const excerpt = element.querySelector('.lark-doc-image-share-excerpt')
      expect(excerpt.children[1].style.width).toBe('90px')
      expect(excerpt.style.height).toBe('285px')
      expect(excerpt.querySelector('figcaption').textContent).toBe('Caption')
      expect(excerpt.parentElement.style.width).toBe('322px')
      expect(excerpt.parentElement.style.height).toBe('228px')
    } finally { doc.destroy(); element.remove() }
  })

  it.each(['offline', 'allowlist', 'open'])('applies the live %s network gate to share avatars and copied context', async mode => {
    stubRangeLayout()
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, storage: 'none', config: { network: { mode, allowlist: ['allowed.example'] } },
      mentionSource: [{ kind: 'user', id: 'allowed', name: 'Allowed', avatar: 'https://allowed.example/avatar.png' }, { kind: 'user', id: 'blocked', name: 'Blocked', avatar: 'https://blocked.example/avatar.png' }],
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Context' }] }, { type: 'image', attrs: { src: '/a.png', blockId: 'image_a', naturalWidth: 400, naturalHeight: 300 } }] } })
    try {
      const editor = doc.getEditor(), host = doc._handle.nativeHost.host
      const context = editor.view.nodeDOM(0), remote = document.createElement('img')
      remote.src = 'https://blocked.example/context.png'
      remote.setAttribute('srcset', 'https://blocked.example/context-2x.png 2x')
      remote.setAttribute('onerror', 'window.leakedContext = true')
      context.appendChild(remote)
      const pos = editor.state.doc.firstChild.nodeSize
      host.openImageShareDialog({ ...editor.state.doc.nodeAt(pos).attrs, pos })
      await vi.waitFor(() => expect(element.querySelectorAll('.lark-doc-image-share-result')).toHaveLength(2))
      const share = element.querySelector('.lark-doc-image-share-dialog')
      const sources = [...share.querySelectorAll('.lark-doc-image-share-avatar img')].map(img => img.src)
      expect(sources).toEqual(mode === 'offline' ? [] : mode === 'allowlist' ? ['https://allowed.example/avatar.png'] : ['https://allowed.example/avatar.png', 'https://blocked.example/avatar.png'])
      const copy = share.querySelector('.is-before img')
      expect(copy.getAttribute('srcset')).toBeNull()
      expect(copy.getAttribute('onerror')).toBeNull()
      expect(copy.src).toBe(mode === 'open' ? remote.src : BLOCKED_IMAGE_PLACEHOLDER)
      if (mode === 'open') {
        doc.patchProps({ config: { network: { mode: 'offline' } } })
        await vi.waitFor(() => expect(share.querySelectorAll('.lark-doc-image-share-avatar img')).toHaveLength(0))
        expect(share.querySelector('.is-before img').src).toBe(BLOCKED_IMAGE_PLACEHOLDER)
      }
    } finally { doc.destroy(); element.remove() }
  })

  it('aborts and closes pending image sharing when the callback changes through patchProps', async () => {
    stubRangeLayout()
    const element = document.createElement('div')
    document.body.appendChild(element)
    let complete, signal
    const onImageShare = vi.fn(payload => { signal = payload.signal; return new Promise(resolve => { complete = resolve }) })
    const doc = new LarkDoc({ element, storage: 'none', onImageShare, content: { type: 'doc', content: [{ type: 'image', attrs: { src: '/a.png', blockId: 'image_a' } }] } })
    try {
      const host = doc._handle.nativeHost.host
      host.shareDocumentLink = () => 'http://localhost/document'
      const image = { ...doc.getEditor().state.doc.firstChild.attrs, pos: 0 }
      host.openImageShareDialog(image)
      host.imageShare = { ...host.imageShare, recipients: [{ id: 'test-user', kind: 'user' }] }
      const pending = host.submitImageShare()
      doc.patchProps({ onImageShare: vi.fn(async () => true) })
      await vi.waitFor(() => expect(host.imageShare).toBeNull())
      expect(signal.aborted).toBe(true)
      complete(true)
      expect(await pending).toBe(false)
    } finally { doc.destroy(); element.remove() }
  })

  it('passes host directories and actions through the real facade to candidates and node views', async () => {
    stubRangeLayout()
    const element = document.createElement('div')
    document.body.appendChild(element)
    const mentionSource = [{ id: 'u-parity', kind: 'user', name: 'Parity User' }]
    const event = { eventId: 'event-parity', title: 'Parity Event', start: '2026-11-11T10:00:00+08:00', end: '2026-11-11T11:00:00+08:00' }
    const calendarSource = { search: vi.fn(async () => [event]) }
    const onCalendarEventJoin = vi.fn()
    const calendarEventRefetch = vi.fn()
    const onIsvButtonAction = vi.fn()
    const onIsvCatalogJump = vi.fn()
    const doc = new LarkDoc({ element, storage: 'none', content: '<p></p>', mentionSource, calendarSource,
      onCalendarEventJoin, calendarEventRefetch, onIsvButtonAction, onIsvCatalogJump })
    try {
      const host = doc._handle.nativeHost.host
      host.startMention('mentionUser')
      await vi.waitFor(() => expect(host.mentionItems[0]?.id).toBe('u-parity'))
      host.setMentionNotify(false)
      host.chooseMention(host.mentionItems[0])
      expect(doc.getHTML()).toContain('Parity User')
      // Finish the mention command's scheduled focus before opening the next UI.
      await new Promise(resolve => requestAnimationFrame(resolve))
      host.startCalendarEvent()
      expect(calendarSource.search).toHaveBeenCalledWith({ query: '', range: 'future' })
      await vi.waitFor(() => expect({ open: host.calendarOpen, loading: host.calendarLoading, events: host.calendarEvents })
        .toEqual({ open: true, loading: false, events: [expect.objectContaining({ eventId: event.eventId })] }))
      await vi.waitFor(() => expect(element.querySelector('.lark-doc-calendar-search-row')?.textContent).toBe(event.title))
      element.querySelector('.lark-doc-calendar-search-row').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      element.querySelector('.lark-doc-calendar-join').click()
      expect(onCalendarEventJoin).toHaveBeenCalledWith({ eventId: event.eventId, title: event.title })
      const extensions = doc.getEditor().extensionManager.extensions
      expect(extensions.find(extension => extension.name === 'calendar_event').options.refetch).toBe(calendarEventRefetch)
      expect(extensions.find(extension => extension.name === 'isv').options.onCatalogJump).toBe(onIsvCatalogJump)
      doc.getEditor().commands.setIsv({ kind: 'button', action: 'follow_page', buttonText: 'Follow' })
      element.querySelector('.docx-button-component').click()
      expect(onIsvButtonAction).toHaveBeenCalledWith('follow_page', expect.objectContaining({ buttonText: 'Follow' }))
    } finally { doc.destroy(); element.remove() }
  })

  async function pendingComment(action) {
    stubRangeLayout()
    const comments = createMemoryCommentsProvider()
    const createThread = comments.createThread
    let complete
    comments.createThread = input => new Promise(resolve => { complete = async () => resolve(await createThread(input)) })
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, storage: 'none', content: '<p>alpha target omega</p>', comments,
      user: { id: 'u-parity', name: 'Parity' } })
    const host = doc._handle.nativeHost.host
    const editor = doc.getEditor()
    const markText = () => {
      const parts = []
      editor.state.doc.descendants(node => { if (node.isText && node.marks.some(mark => mark.type.name === 'comment')) parts.push(node.text) })
      return parts.join('')
    }
    try {
      editor.commands.setTextSelection({ from: 7, to: 13 })
      const pending = host.createCommentFromSelection('Review target')
      action({ doc, host, editor })
      await complete()
      const result = await pending
      return { result, marked: editor.isDestroyed ? '' : markText() }
    } finally { doc.destroy(); element.remove() }
  }

  it('keeps an in-flight comment on the same text when preceding typing moves its range', async () => {
    const result = await pendingComment(({ editor }) => editor.commands.insertContentAt(1, 'XXX '))
    expect(result.result?.id).toBeTruthy()
    expect(result.marked).toBe('target')
  })

  it.each(['readonly', 'destroy', 'replace', 'target', 'permission', 'provider'])('does not attach a late comment after %s', async action => {
    const result = await pendingComment(({ doc, host, editor }) => {
      if (action === 'readonly') doc.setReadonly(true)
      if (action === 'destroy') doc.destroy()
      if (action === 'replace') doc.setContent('<p>different document</p>')
      if (action === 'target') editor.commands.deleteRange({ from: 7, to: 13 })
      if (action === 'permission') vi.spyOn(host.session, 'can').mockImplementation(capability => capability !== 'canComment')
      if (action === 'provider') host.session.providers.comments = createMemoryCommentsProvider()
    })
    expect(result.result).toBeNull()
    expect(result.marked).toBe('')
  })
})

function stubRangeLayout() {
  const createRange = document.createRange.bind(document)
  vi.spyOn(document, 'createRange').mockImplementation(() => Object.assign(createRange(), {
    getClientRects: () => [],
    getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }),
  }))
}

function dispatchFileEvent(editor, source, files, html = '') {
  const event = new Event(source, { bubbles: true, cancelable: true })
  const transfer = { files, types: ['Files'], getData: type => type === 'text/html' ? html : '' }
  Object.defineProperty(event, source === 'paste' ? 'clipboardData' : 'dataTransfer', { value: transfer })
  if (source === 'drop') vi.spyOn(editor.view, 'posAtCoords').mockReturnValue({ pos: 1, inside: 0 })
  editor.view.dom.dispatchEvent(event)
  return event
}

describe('真实门面图片上传', () => {
  it('默认图片上限为 20 MB，并保留宿主自定义上限', () => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p></p>' })
    try {
      expect(doc._handle.nativeHost.host.effectiveImageMaxSize).toBe(20 * 1024 * 1024)
      doc.patchProps({ config: { limits: { maxImageSize: 1024 } } })
      expect(doc._handle.nativeHost.host.effectiveImageMaxSize).toBe(1024)
    } finally { doc.destroy(); element.remove() }
  })

  it('cancels an upload when images are disabled and rejects a provider that still resolves late', async () => {
    let finish, signal
    const element = document.createElement('div'); document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p>keep</p>', uploader: { upload: (_file, context) => { signal = context.signal; return new Promise(resolve => { finish = resolve }) } } })
    try {
      const pending = doc._handle.nativeHost.host.insertImageFiles([new File(['png'], 'delayed.png', { type: 'image/png' })])
      doc.patchProps({ config: { features: { images: false } } })
      expect(signal.aborted).toBe(true)
      finish({ url: '/late.png' })
      await pending
      expect(doc.getJSON().content.some(node => node.type === 'image')).toBe(false)
      expect(doc.getEditor().state.doc.textContent).toBe('keep')
    } finally { doc.destroy(); element.remove() }
  })

  it.each([true, false])('uses the current image policy for URL paste (initial=%s)', async initial => {
    const element = document.createElement('div'); document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p></p>', config: { features: { images: initial } } })
    const paste = () => {
      const event = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'clipboardData', { value: { files: [], getData: type => type === 'text/plain' ? 'https://example.com/photo.png' : '' } })
      doc.getEditor().view.dom.dispatchEvent(event)
      return event
    }
    try {
      doc.patchProps({ config: { features: { images: false } } })
      paste()
      expect(doc.getJSON().content.some(node => node.type === 'image')).toBe(false)
      expect(doc.getEditor().state.doc.textContent).toContain('https://example.com/photo.png')
      doc.patchProps({ config: { features: { images: true } } })
      doc.setContent('<p></p>')
      expect(paste().defaultPrevented).toBe(true)
      expect(doc.getJSON().content.some(node => node.type === 'image')).toBe(true)
    } finally { doc.destroy(); element.remove() }
  })

  it('does not consume a file paste or drop while the image capability is disabled', async () => {
    const upload = vi.fn(async () => ({ url: '/photo.png' }))
    const element = document.createElement('div'); document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p></p>', uploader: { upload } })
    try {
      vi.spyOn(doc.getEditor().view, 'posAtCoords').mockReturnValue({ pos: 1, inside: 0 })
      doc.patchProps({ config: { features: { images: false } } })
      for (const type of ['paste', 'drop']) {
        const event = new Event(type, { bubbles: true, cancelable: true })
        Object.defineProperty(event, type === 'paste' ? 'clipboardData' : 'dataTransfer', { value: { files: [new File(['png'], 'photo.png', { type: 'image/png' })], getData: () => '', types: ['Files'] } })
        doc.getEditor().view.dom.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(false)
      }
      await Promise.resolve()
      expect(upload).not.toHaveBeenCalled()
    } finally { doc.destroy(); element.remove() }
  })

  it.each(['object', 'function', 'legacy', 'provider', 'legacy-provider'])('%s uploader 实际执行并采用无附件 ID 的地址', async kind => {
    const upload = vi.fn(async () => ({ url: 'https://cdn.example.com/uploaded.png' }))
    const options = kind === 'legacy' ? { uploadImage: upload } : kind === 'legacy-provider' ? { uploadImage: createUploadProvider({ upload }) }
      : { uploader: kind === 'object' ? { upload } : kind === 'provider' ? createUploadProvider({ upload }) : upload }
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p></p>', ...options })
    try {
      await doc._handle.nativeHost.host.insertImageFiles([new File(['png'], 'a.png', { type: 'image/png' })])
      expect(upload).toHaveBeenCalledTimes(1)
      expect(doc.getJSON().content[0]).toMatchObject({ type: 'image', attrs: { src: 'https://cdn.example.com/uploaded.png', attchId: null } })
    } finally { doc.destroy(); element.remove() }
  })

  it.each(['data', 'local', 'failure', 'reject'])('%s 经公共管线通知应用且不会静默降级', async scenario => {
    const calls = []
    const upload = vi.fn(async () => {
      if (scenario === 'failure') throw new Error('denied')
      return { url: 'data:image/png;base64,cG5n' }
    })
    const uploader = {
      ...(scenario === 'local' ? {} : { upload }),
      beforeUpload: () => calls.push('before'),
      onStart: event => { expect(event.source).toBe('select'); calls.push('start') },
      onSuccess: () => calls.push('success'),
      onError: () => calls.push('error'),
      onReject: () => calls.push('reject'),
      onSettled: event => calls.push(event.status),
    }
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p></p>', uploader, config: { limits: { maxImageSize: scenario === 'reject' ? 1 : 1024 } } })
    try {
      await doc._handle.nativeHost.host.insertImageFiles([new File(['png'], 'a.png', { type: 'image/png' })])
      if (['data', 'local'].includes(scenario)) {
        expect(doc.getJSON().content[0]).toMatchObject({ type: 'image', attrs: { src: expect.stringMatching(/^data:image\/png;base64,/), attchId: null } })
        expect(calls).toEqual(['before', 'start', 'success', 'success'])
      } else {
        expect(doc.getJSON().content.some(node => node.type === 'image')).toBe(false)
        expect(calls).toEqual(scenario === 'reject' ? ['reject', 'rejected'] : ['before', 'start', 'error', 'error'])
      }
      expect(upload).toHaveBeenCalledTimes(['local', 'reject'].includes(scenario) ? 0 : 1)
    } finally { doc.destroy(); element.remove() }
  })

  it.each(['destroy', 'content', 'readonly', 'session'])('%s 取消不响应 signal 的请求，晚结果和排队文件不会写回', async action => {
    let complete
    const onCancel = vi.fn()
    const onSettled = vi.fn()
    const upload = vi.fn(() => new Promise(resolve => { complete = resolve }))
    const provider = createUploadProvider({ upload, onCancel, onSettled })
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p>old</p>', uploader: provider })
    try {
      const files = [new File(['one'], 'one.png', { type: 'image/png' }), new File(['two'], 'two.png', { type: 'image/png' })]
      const pending = doc._handle.nativeHost.host.insertImageFiles(files)
      expect(provider.pending()).toBe(1)
      if (action === 'destroy') doc.destroy()
      if (action === 'content') doc.setContent('<p>new</p>')
      if (action === 'readonly') { doc.setReadonly(true); doc.setReadonly(false) }
      if (action === 'session') doc.patchProps({ documentId: 'next-document' })
      await pending
      expect(provider.pending()).toBe(0)
      complete({ url: '/late.png' })
      await Promise.resolve()
      expect(upload).toHaveBeenCalledTimes(1)
      expect(onCancel).toHaveBeenCalledTimes(1)
      expect(onSettled).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 'cancelled' }))
      if (action !== 'destroy') expect(doc.getJSON().content.some(node => node.type === 'image')).toBe(false)
    } finally { doc.destroy(); element.remove() }
  })

  it('上传占位随正文编辑映射，完成时保留用户的新光标和原来的插入位置', async () => {
    stubRangeLayout()
    let complete
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p>first</p><p>second</p>', uploader: () => new Promise(resolve => { complete = resolve }) })
    try {
      const editor = doc.getEditor()
      editor.commands.setTextSelection(3)
      const pending = doc._handle.nativeHost.host.insertImageFiles([new File(['png'], 'a.png', { type: 'image/png' })])
      expect(element.querySelectorAll('.lark-doc-image-upload')).toHaveLength(1)
      expect(JSON.stringify(doc.getJSON())).not.toContain('blob:')
      editor.commands.insertContentAt(1, 'prefix')
      editor.commands.setTextSelection(editor.state.doc.content.size - 1)
      editor.commands.insertContent(' suffix')
      complete({ url: '/completed.png' })
      await pending
      expect(doc.getJSON().content.map(node => node.type)).toEqual(['paragraph', 'image', 'paragraph', 'paragraph'])
      expect(doc.getJSON().content.at(-1).content[0].text).toBe('second suffix')
      expect(editor.state.selection.$from.parent.textContent).toBe('second suffix')
      expect(element.querySelectorAll('.lark-doc-image-upload')).toHaveLength(0)
    } finally { doc.destroy(); element.remove() }
  })

  it('多文件预览保持顺序；删除上传占位会取消任务，晚结果不会复活图片', async () => {
    stubRangeLayout()
    const completions = []
    const onCancel = vi.fn()
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p></p>', uploader: { upload: () => new Promise(resolve => completions.push(resolve)), onCancel } })
    try {
      const files = ['one', 'two'].map(name => new File([name], `${name}.png`, { type: 'image/png' }))
      const pending = doc._handle.nativeHost.host.insertImageFiles(files)
      expect(element.querySelectorAll('.lark-doc-image-upload')).toHaveLength(2)
      element.querySelector('.lark-doc-image-upload').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
      doc.getEditor().view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }))
      await vi.waitFor(() => expect(completions).toHaveLength(2))
      completions[0]({ url: '/deleted.png' })
      completions[1]({ url: '/second.png' })
      await pending
      expect(onCancel).toHaveBeenCalledTimes(1)
      expect(doc.getJSON().content.filter(node => node.type === 'image').map(node => node.attrs.src)).toEqual(['/second.png'])
      expect(element.querySelectorAll('.lark-doc-image-upload')).toHaveLength(0)
    } finally { doc.destroy(); element.remove() }
  })

  it.each([false, true])('独立批次在同一空段落反向完成=%s，仍按预览顺序插入', async reverse => {
    const complete = {}
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p></p>', uploader: file => new Promise(resolve => { complete[file.name] = resolve }) })
    try {
      const host = doc._handle.nativeHost.host
      const first = host.insertImageFiles([new File(['one'], 'one.png', { type: 'image/png' })])
      const second = host.insertImageFiles([new File(['two'], 'two.png', { type: 'image/png' })])
      const order = reverse ? ['two', 'one'] : ['one', 'two']
      complete[`${order[0]}.png`]({ url: `/${order[0]}.png` })
      await (reverse ? second : first)
      expect(element.querySelectorAll('.lark-doc-image-upload')).toHaveLength(1)
      complete[`${order[1]}.png`]({ url: `/${order[1]}.png` })
      await Promise.all([first, second])
      expect(doc.getJSON().content.filter(node => node.type === 'image').map(node => node.attrs.src)).toEqual(['/one.png', '/two.png'])
    } finally { doc.destroy(); element.remove() }
  })

  it.each([false, true])('撤销上传占位（替换选区=%s）不会撤销先前正文，或让晚结果插回来', async selected => {
    let complete
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p>keep text</p>', uploader: () => new Promise(resolve => { complete = resolve }) })
    try {
      const editor = doc.getEditor()
      editor.commands.setTextSelection(selected ? { from: 1, to: 5 } : 1)
      const pending = doc._handle.nativeHost.host.insertImageFiles([new File(['png'], 'a.png', { type: 'image/png' })])
      editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }))
      await pending
      expect(element.querySelectorAll('.lark-doc-image-upload')).toHaveLength(0)
      expect(doc.getEditor().state.doc.textContent).toBe('keep text')
      complete({ url: '/late.png' })
      await Promise.resolve()
      expect(doc.getJSON().content.some(node => node.type === 'image')).toBe(false)
    } finally { doc.destroy(); element.remove() }
  })

  it.each([false, true])('后续输入先撤销，再撤销 pending；门面重做恢复原落点（选区=%s）', async selected => {
    stubRangeLayout()
    const complete = []
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p>keep</p>', uploader: () => new Promise(resolve => complete.push(resolve)) })
    try {
      const editor = doc.getEditor()
      editor.commands.setTextSelection(selected ? { from: 1, to: 5 } : 5)
      const pending = doc._handle.nativeHost.host.insertImageFiles([new File(['png'], 'a.png', { type: 'image/png' })])
      const enqueueDoc = doc.getJSON()
      editor.commands.insertContent(' later')
      doc.undo()
      expect(doc.getJSON()).toEqual(enqueueDoc)
      expect(editor.state.doc.textContent).toBe(selected ? '' : 'keep')
      expect(element.querySelectorAll('.lark-doc-image-upload')).toHaveLength(1)
      doc.undo()
      expect(element.querySelectorAll('.lark-doc-image-upload')).toHaveLength(0)
      await pending
      expect(editor.state.doc.textContent).toBe('keep')
      expect(element.querySelectorAll('.lark-doc-image-upload')).toHaveLength(0)
      doc.redo()
      expect(element.querySelectorAll('.lark-doc-image-upload')).toHaveLength(1)
      doc.redo()
      expect(editor.state.doc.textContent).toBe(selected ? ' later' : 'keep later')
      complete[0]({ url: '/stale.png' })
      complete[1]({ url: '/redo.png' })
      await vi.waitFor(() => expect(doc.getJSON().content.filter(node => node.type === 'image').map(node => node.attrs.src)).toEqual(['/redo.png']))
    } finally { doc.destroy(); element.remove() }
  })

  it('连续撤销两个选区上传后，连续重做仍恢复两张预览与文件顺序', async () => {
    stubRangeLayout()
    const completions = []
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p>aa bb cc</p>', uploader: () => new Promise(resolve => completions.push(resolve)) })
    try {
      const editor = doc.getEditor(), host = doc._handle.nativeHost.host
      editor.commands.setTextSelection({ from: 1, to: 3 })
      const first = host.insertImageFiles([new File(['one'], 'one.png', { type: 'image/png' })])
      editor.commands.setTextSelection({ from: 2, to: 4 })
      const second = host.insertImageFiles([new File(['two'], 'two.png', { type: 'image/png' })])
      doc.undo(); doc.undo()
      await Promise.all([first, second])
      expect(editor.state.doc.textContent).toBe('aa bb cc')
      doc.redo(); doc.redo()
      expect(editor.state.doc.textContent).toBe('  cc')
      expect(element.querySelectorAll('.lark-doc-image-upload')).toHaveLength(2)
      completions[2]({ url: '/one.png' })
      completions[3]({ url: '/two.png' })
      await vi.waitFor(() => expect(doc.getJSON().content.filter(node => node.type === 'image').map(node => node.attrs.src)).toEqual(['/one.png', '/two.png']))
    } finally { doc.destroy(); element.remove() }
  })

  it('协同上传选区的撤销边界保留上传前输入，重做只替换原选区', async () => {
    stubRangeLayout()
    const { Yjs, createCollabExtensions, isRemoteTransaction } = await import('../../src/collab')
    const ydoc = new Yjs.Doc({ gc: false })
    const element = document.createElement('div')
    document.body.appendChild(element)
    const complete = []
    const doc = new LarkDoc({ element, storage: 'none', content: '<p></p>', collab: { extensions: createCollabExtensions({ ydoc }), isRemoteTransaction }, uploader: () => new Promise(resolve => complete.push(resolve)) })
    try {
      const editor = doc.getEditor()
      editor.commands.insertContent('keep base')
      const undoManager = editor.state.plugins.map(plugin => plugin.getState(editor.state)?.undoManager).find(Boolean)
      undoManager.clear()
      undoManager.stopCapturing()
      editor.commands.insertContent(' prior')
      editor.commands.setTextSelection({ from: 1, to: 5 })
      const pending = doc._handle.nativeHost.host.insertImageFiles([new File(['png'], 'a.png', { type: 'image/png' })])
      doc.undo()
      await pending
      expect(editor.state.doc.textContent).toBe('keep base prior')
      doc.redo()
      expect(editor.state.doc.textContent).toBe(' base prior')
      complete[0]({ url: '/stale.png' })
      complete[1]({ url: '/redo.png' })
      await vi.waitFor(() => expect(doc.getJSON().content.filter(node => node.type === 'image').map(node => node.attrs.src)).toEqual(['/redo.png']))
    } finally { doc.destroy(); element.remove(); ydoc.destroy() }
  })

  it.each([false, true])('上传前输入与 pending 交错撤销重做仍保留正文和预览（选区=%s）', async selected => {
    stubRangeLayout()
    const complete = []
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p>keep</p>', uploader: () => new Promise(resolve => complete.push(resolve)) })
    try {
      const editor = doc.getEditor()
      editor.commands.setTextSelection(5)
      editor.commands.insertContent(' prior')
      if (selected) editor.commands.setTextSelection({ from: 1, to: 5 })
      const pending = doc._handle.nativeHost.host.insertImageFiles([new File(['png'], 'a.png', { type: 'image/png' })])
      doc.undo(); doc.undo()
      await pending
      expect(editor.state.doc.textContent).toBe('keep')
      doc.redo(); doc.redo()
      expect(editor.state.doc.textContent).toBe(selected ? ' prior' : 'keep prior')
      expect(element.querySelectorAll('.lark-doc-image-upload')).toHaveLength(1)
      complete[1]({ url: '/restored.png' })
      await vi.waitFor(() => expect(doc.getJSON().content.some(node => node.type === 'image')).toBe(true))
    } finally { doc.destroy(); element.remove() }
  })

  it('粘贴上传后连续输入位于图片下方段落，上传完成不改变段落顺序', async () => {
    stubRangeLayout()
    let complete
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p>before</p>', uploader: () => new Promise(resolve => { complete = resolve }) })
    try {
      const editor = doc.getEditor()
      editor.commands.setTextSelection(7)
      const pending = doc._handle.nativeHost.host.insertImageFiles([new File(['png'], 'a.png', { type: 'image/png' })], 7, 'paste')
      expect(editor.state.selection.$from.parent.textContent).toBe('')
      editor.commands.insertContent('after')
      complete({ url: '/middle.png' })
      await pending
      expect(doc.getJSON().content.map(node => node.type)).toEqual(['paragraph', 'image', 'paragraph'])
      expect(editor.state.doc.firstChild.textContent).toBe('before')
      expect(editor.state.doc.lastChild.textContent).toBe('after')
    } finally { doc.destroy(); element.remove() }
  })

  it('撤销后一个上传后，前一个上传完成并规范化 ID 不会阻断重做', async () => {
    const completions = []
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p></p>', uploader: () => new Promise(resolve => completions.push(resolve)) })
    try {
      const host = doc._handle.nativeHost.host
      const first = host.insertImageFiles([new File(['one'], 'one.png', { type: 'image/png' })])
      const second = host.insertImageFiles([new File(['two'], 'two.png', { type: 'image/png' })])
      doc.undo()
      await second
      completions[0]({ url: '/one.png' })
      await first
      doc.redo()
      expect(completions).toHaveLength(3)
      expect(element.querySelectorAll('.lark-doc-image-upload')).toHaveLength(1)
      completions[2]({ url: '/two.png' })
      await vi.waitFor(() => expect(doc.getJSON().content.filter(node => node.type === 'image').map(node => node.attrs.src)).toEqual(['/one.png', '/two.png']))
    } finally { doc.destroy(); element.remove() }
  })

  it.each(['pending-split', 'completed'])('协同上传 %s 的结构与图片进入自己的撤销事件', async scenario => {
    stubRangeLayout()
    const { Yjs, createCollabExtensions, isRemoteTransaction } = await import('../../src/collab')
    const ydoc = new Yjs.Doc({ gc: false })
    const element = document.createElement('div')
    document.body.appendChild(element)
    let complete
    const doc = new LarkDoc({ element, storage: 'none', content: '<p></p>', collab: { extensions: createCollabExtensions({ ydoc }), isRemoteTransaction }, uploader: () => new Promise(resolve => { complete = resolve }) })
    try {
      const editor = doc.getEditor()
      editor.commands.insertContent('keep')
      const manager = editor.state.plugins.map(plugin => plugin.getState(editor.state)?.undoManager).find(Boolean)
      manager.clear(); manager.stopCapturing()
      editor.commands.insertContent(' prior')
      if (scenario === 'completed') editor.commands.setTextSelection(1)
      const pending = doc._handle.nativeHost.host.insertImageFiles([new File(['png'], 'a.png', { type: 'image/png' })])
      if (scenario === 'pending-split') {
        expect(editor.state.doc.childCount).toBe(2)
        doc.undo()
        await pending
        expect(editor.state.doc.childCount).toBe(1)
        expect(editor.state.doc.textContent).toBe('keep prior')
      } else {
        complete({ url: '/uploaded.png' })
        await pending
        doc.undo()
        expect(editor.state.doc.textContent).toBe('keep prior')
        expect(doc.getJSON().content.some(node => node.type === 'image')).toBe(false)
        doc.redo()
        expect(doc.getJSON().content.some(node => node.type === 'image')).toBe(true)
      }
    } finally { doc.destroy(); element.remove(); ydoc.destroy() }
  })

  it.each([false, true])('真实拖入按目标段落上/下半区吸附（下方=%s），不拆字或抢光标', async below => {
    stubRangeLayout()
    let complete
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p>target text</p><p>caret here</p>', uploader: () => new Promise(resolve => { complete = resolve }) })
    try {
      const editor = doc.getEditor()
      editor.commands.setTextSelection(editor.state.doc.content.size - 1)
      vi.spyOn(editor.view, 'posAtCoords').mockReturnValue({ pos: 4, inside: 0 })
      vi.spyOn(editor.view.nodeDOM(0), 'getBoundingClientRect').mockReturnValue({ top: 100, height: 40 })
      const event = new MouseEvent('drop', { bubbles: true, cancelable: true, clientX: 120, clientY: below ? 130 : 110 })
      Object.defineProperty(event, 'dataTransfer', { value: { files: [new File(['png'], 'drop.png', { type: 'image/png' })], types: ['Files'], getData: () => '' } })
      editor.view.dom.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
      expect(editor.state.doc.childCount).toBe(2)
      expect(editor.state.selection.$from.parent.textContent).toBe('caret here')
      complete({ url: '/drop.png' })
      await vi.waitFor(() => expect(doc.getJSON().content.filter(node => node.type === 'image')).toHaveLength(1))
      expect(doc.getJSON().content.map(node => node.type)).toEqual(below ? ['paragraph', 'image', 'paragraph'] : ['image', 'paragraph', 'paragraph'])
      expect(editor.state.doc.textContent).toBe('target textcaret here')
      expect(editor.state.selection.$from.parent.textContent).toBe('caret here')
    } finally { doc.destroy(); element.remove() }
  })

  it('上传通知异常通过门面 error 渠道报告，错误监听器自己的异步异常也被接住', async () => {
    const failure = new Error('notification')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onError = vi.fn(async () => { throw new Error('error-listener') })
    const upload = vi.fn(async () => ({ url: '/ok.png' }))
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p></p>', onError, uploader: { upload, onStart: () => Promise.reject(failure) } })
    const handler = vi.fn(async () => { throw new Error('event-listener') })
    doc.on('error', handler)
    try {
      await doc._handle.nativeHost.host.insertImageFiles([new File(['png'], 'a.png', { type: 'image/png' })])
      await Promise.resolve()
      expect(onError).toHaveBeenCalledExactlyOnceWith(failure)
      expect(handler).toHaveBeenCalledExactlyOnceWith(failure)
      expect(upload).toHaveBeenCalledTimes(1)
      expect(error).toHaveBeenCalledTimes(2)
      expect(doc.getJSON().content[0].type).toBe('image')
    } finally { doc.destroy(); element.remove() }
  })

  it('成功回调抛错时应用 onCallbackError 和门面 error 均收到原异常，图片仍成功插入', async () => {
    const failure = new Error('success-notification')
    const onCallbackError = vi.fn()
    const onError = vi.fn()
    const onSettled = vi.fn()
    const handler = vi.fn()
    const upload = vi.fn(async () => ({ url: '/ok.png' }))
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({
      element, content: '<p></p>', onError,
      uploader: { upload, onCallbackError, onSettled, onSuccess: () => { throw failure } },
    })
    doc.on('error', handler)
    try {
      await doc._handle.nativeHost.host.insertImageFiles([new File(['png'], 'a.png', { type: 'image/png' })])
      expect(onCallbackError).toHaveBeenCalledExactlyOnceWith(failure)
      expect(onError).toHaveBeenCalledExactlyOnceWith(failure)
      expect(handler).toHaveBeenCalledExactlyOnceWith(failure)
      expect(onSettled).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 'success' }))
      expect(upload).toHaveBeenCalledTimes(1)
      expect(doc.getJSON().content[0]).toMatchObject({ type: 'image', attrs: { src: '/ok.png' } })
    } finally { doc.destroy(); element.remove() }
  })

  it('beforeUpload 同步换文档后不执行 upload，也不开始旧队列的第二张图', async () => {
    const upload = vi.fn(async () => ({ url: '/ok.png' }))
    const beforeUpload = vi.fn(() => { doc.setContent('<p>new</p>'); return true })
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p>old</p>', uploader: { upload, beforeUpload } })
    try {
      const file = new File(['png'], 'a.png', { type: 'image/png' })
      await doc._handle.nativeHost.host.insertImageFiles([file, file])
      expect(upload).not.toHaveBeenCalled()
      expect(beforeUpload).toHaveBeenCalledTimes(1)
      expect(doc.getJSON().content[0]).toMatchObject({ type: 'paragraph', content: [{ type: 'text', text: 'new' }] })
    } finally { doc.destroy(); element.remove() }
  })

  it('共享 Provider 的两个编辑器只取消自身任务', async () => {
    const complete = new Map()
    const onCancel = vi.fn()
    const provider = createUploadProvider({
      upload: (file, ctx) => new Promise(resolve => { complete.set(ctx.documentId, resolve) }),
      onCancel,
    })
    const elements = [document.createElement('div'), document.createElement('div')]
    elements.forEach(element => document.body.appendChild(element))
    const docs = elements.map((element, index) => new LarkDoc({ element, documentId: `doc-${index}`, content: '<p></p>', uploader: provider }))
    try {
      const file = new File(['png'], 'a.png', { type: 'image/png' })
      const pending = docs.map(doc => doc._handle.nativeHost.host.insertImageFiles([file]))
      expect(provider.pending()).toBe(2)
      docs[0].destroy()
      await pending[0]
      expect(provider.pending()).toBe(1)
      expect(onCancel).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ documentId: 'doc-0', reason: 'destroy' }))
      complete.get('doc-0')({ url: '/stale.png' })
      complete.get('doc-1')({ url: '/second.png' })
      await pending[1]
      expect(docs[1].getJSON().content[0]).toMatchObject({ type: 'image', attrs: { src: '/second.png' } })
      expect(provider.pending()).toBe(0)
    } finally {
      docs.forEach(doc => doc.destroy())
      elements.forEach(element => element.remove())
    }
  })

  it('paste/drop/select 保持 source、文件身份和独立 taskId；已有链接不触发上传', async () => {
    stubRangeLayout()
    const events = []
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p></p>', uploader: { upload: async file => ({ url: `/${file.name}` }), onSuccess: event => events.push(event) } })
    try {
      const editor = doc.getEditor()
      const pasted = new File(['one'], 'paste.png', { type: 'image/png' })
      const dropped = new File(['two'], 'drop.png', { type: 'image/png' })
      dispatchFileEvent(editor, 'paste', [pasted])
      await vi.waitFor(() => expect(events).toHaveLength(1))
      dispatchFileEvent(editor, 'drop', [dropped])
      await vi.waitFor(() => expect(events).toHaveLength(2))
      await doc._handle.nativeHost.host.onImageInput({ target: { files: [pasted], value: 'same-file' } })
      expect(events.map(event => event.source)).toEqual(['paste', 'drop', 'select'])
      expect(events.map(event => event.file)).toEqual([pasted, dropped, pasted])
      expect(new Set(events.map(event => event.taskId)).size).toBe(3)
      editor.commands.insertContent({ type: 'image', attrs: { src: '/existing.png' } })
      expect(events).toHaveLength(3)
    } finally { doc.destroy(); element.remove() }
  })

  it.each(['paste', 'drop'])('真实 %s 链对混合图片只插入一次，并通知被过滤的 MIME/缺失 MIME 图片', async source => {
    stubRangeLayout()
    const upload = vi.fn(async () => ({ url: '/accepted.png' }))
    const onReject = vi.fn()
    const onSettled = vi.fn()
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p></p>', uploader: { upload, onReject, onSettled } })
    const files = [
      new File(['png'], 'accepted.png', { type: 'image/png' }),
      new File(['svg'], 'vector.svg', { type: 'image/svg+xml' }),
      new File(['heic'], 'unsupported.heic', { type: 'image/heic' }),
      new File(['png'], 'missing.png', { type: '' }),
    ]
    try {
      dispatchFileEvent(doc.getEditor(), source, files)
      await vi.waitFor(() => expect(onSettled).toHaveBeenCalledTimes(4))
      expect(upload).toHaveBeenCalledExactlyOnceWith(files[0], expect.objectContaining({ source }))
      expect(onReject.mock.calls.map(([event]) => event.file)).toEqual(files.slice(1))
      expect(onReject.mock.calls.every(([event]) => event.code === 'UPLOAD_MIME' && event.source === source)).toBe(true)
      expect(onSettled.mock.calls.filter(([event]) => event.status === 'rejected')).toHaveLength(3)
      expect(doc.getJSON().content.filter(node => node.type === 'image')).toHaveLength(1)
    } finally { doc.destroy(); element.remove() }
  })

  it.each(['paste', 'drop'])('真实 %s 链的非图片附件继续交给后续插件', async source => {
    const uploader = { upload: vi.fn(), onReject: vi.fn(), onSettled: vi.fn() }
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p></p>', uploader })
    const files = [new File(['pdf'], 'a.pdf', { type: 'application/pdf' }), new File(['txt'], 'notes.txt', { type: '' })]
    const attachment = vi.fn((view, event) => {
      expect((event.clipboardData || event.dataTransfer).files).toEqual(files)
      return true
    })
    doc.getEditor().registerPlugin(new Plugin({ props: { [source === 'paste' ? 'handlePaste' : 'handleDrop']: attachment } }))
    try {
      dispatchFileEvent(doc.getEditor(), source, files)
      expect(attachment).toHaveBeenCalledTimes(1)
      await Promise.resolve()
      expect(uploader.upload).not.toHaveBeenCalled()
      expect(uploader.onReject).not.toHaveBeenCalled()
      expect(uploader.onSettled).not.toHaveBeenCalled()
    } finally { doc.destroy(); element.remove() }
  })

  it.each(['paste', 'drop'])('真实 %s 链的拒绝通知不吞掉伴随 HTML', async source => {
    stubRangeLayout()
    const onReject = vi.fn()
    const upload = vi.fn()
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p></p>', uploader: { upload, onReject } })
    try {
      dispatchFileEvent(doc.getEditor(), source, [new File(['svg'], 'a.svg', { type: 'image/svg+xml' })], '<p>保留 HTML 正文</p>')
      await vi.waitFor(() => expect(onReject).toHaveBeenCalledTimes(1))
      expect(doc.getText()).toContain('保留 HTML 正文')
      expect(upload).not.toHaveBeenCalled()
    } finally { doc.destroy(); element.remove() }
  })

  it('setUploader 原地更新回调并保留编辑器、正文、标题和撤销历史', async () => {
    const oldUpload = vi.fn(async () => ({ url: '/old.png' }))
    const upload = vi.fn(async () => ({ url: '/new.png' }))
    const onSuccess = vi.fn()
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p></p>', uploadImage: oldUpload })
    try {
      const editor = doc.getEditor()
      editor.commands.insertContent('编辑后的正文')
      doc.setTitle('编辑后的标题')
      const json = doc.getJSON()
      const uploader = { upload, onSuccess }
      expect(doc.setUploader(uploader)).toBe(doc)
      expect(doc.getEditor()).toBe(editor)
      expect(doc.getJSON()).toEqual(json)
      expect(doc.getTitle()).toBe('编辑后的标题')
      expect(doc.options.uploader).toBe(uploader)
      expect(doc.options.uploadImage).toBeUndefined()
      expect(editor.commands.undo()).toBe(true)
      expect(doc.getText()).toBe('')
      expect(editor.commands.redo()).toBe(true)
      expect(doc.getJSON()).toEqual(json)
      await doc._handle.nativeHost.host.insertImageFiles([new File(['png'], 'a.png', { type: 'image/png' })])
      expect(upload).toHaveBeenCalledTimes(1)
      expect(oldUpload).not.toHaveBeenCalled()
      expect(onSuccess).toHaveBeenCalledTimes(1)
      doc.destroy()
      expect(doc.setUploader(null)).toBe(doc)
    } finally { doc.destroy(); element.remove() }
  })

  it('切换到未知 Provider 协议后每次都明确失败，不复用旧上传实现', async () => {
    const upload = vi.fn(async () => ({ url: '/old.png' }))
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: '<p></p>', uploader: { upload } })
    const file = new File(['png'], 'a.png', { type: 'image/png' })
    try {
      await doc._handle.nativeHost.host.insertImageFiles([file])
      doc.setUploader({ [Symbol.for('lark-doc.uploadProvider')]: 99, upload })
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await doc._handle.nativeHost.host.insertImageFiles([file])
        expect(element.querySelector('.lark-doc-image-upload-error').textContent).toContain('不支持的上传 Provider 协议版本')
      }
      expect(upload).toHaveBeenCalledTimes(1)
    } finally { doc.destroy(); element.remove() }
  })
})

function mountRenderer(renderer, options) {
  document.body.appendChild(options.element)
  const handle = renderer.mount(options)
  mounted.push({ renderer, handle, host: options.element })
  return handle
}

describe('图表菜单交互', () => {
  function fixture(props = {}) {
    stubRangeLayout()
    vi.stubGlobal('mermaid', { initialize: vi.fn(), render: vi.fn(async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' })) })
    const renderer = createDomRenderer()
    const handle = mountRenderer(renderer, { element: document.createElement('div'), props: { initialContent: '<p></p>', ...props } })
    return { renderer, handle, root: renderer.getRoot(handle), host: handle.nativeHost.host, editor: handle.editor }
  }

  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it.each([['table', 'table'], ['columns', 'columns'], ['template', 'templates'], ['diagram', 'diagram']])('插入%s子菜单独立于滚动主菜单，关闭后不残留', async (id, kind) => {
    const { root, host } = fixture()
    root.querySelector('button[aria-label="插入"]').click()
    await vi.dynamicImportSettled()
    const menu = root.querySelector('.lark-doc-command-menu')
    menu.querySelector(`[data-command-id="${id}"]`).click()
    const submenu = root.querySelector(`.lark-doc-command-submenu.is-${kind}`)
    expect(submenu).not.toBeNull()
    expect(menu.contains(submenu)).toBe(false)
    expect(submenu.parentElement).toBe(menu.parentElement)
    host.closeCommandMenu()
    await Promise.resolve()
    expect(root.querySelector('.lark-doc-command-submenu')).toBeNull()
  })

  it.each([['template', 'templates', 250], ['table', 'table', 314], ['columns', 'columns', 196], ['diagram', 'diagram', 190]])('v58 窄屏%s子菜单避开父触发项，扩窗恢复自然高度', async (id, kind, width) => {
    const { root } = fixture()
    root.querySelector('button[aria-label="插入"]').click(); await vi.dynamicImportSettled()
    const menu = root.querySelector('.lark-doc-command-menu'), trigger = menu.querySelector('[data-command-id="' + id + '"]')
    trigger.click()
    const panel = root.querySelector('.lark-doc-command-submenu.is-' + kind)
    let rect = { left: 50, right: 330, top: 260, bottom: 296, width: 280, height: 36 }
    vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue({ top: 8, bottom: 392, height: 384 })
    vi.spyOn(trigger, 'getBoundingClientRect').mockImplementation(() => rect)
    vi.spyOn(panel, 'getBoundingClientRect').mockImplementation(() => ({ width, height: Math.min(300, parseFloat(panel.style.maxHeight) || 300) }))
    vi.stubGlobal('innerWidth', 360); vi.stubGlobal('innerHeight', 400)
    window.dispatchEvent(new Event('resize'))
    const left = parseFloat(panel.style.left), top = parseFloat(panel.style.top), height = Math.min(300, parseFloat(panel.style.maxHeight))
    expect(left).toBeGreaterThanOrEqual(8); expect(left + width).toBeLessThanOrEqual(352)
    expect(top).toBeGreaterThanOrEqual(8); expect(top + height).toBeLessThanOrEqual(392)
    expect(left < rect.right && left + width > rect.left && top < rect.bottom && top + height > rect.top).toBe(false)
    vi.stubGlobal('innerWidth', 1024); rect = { left: 300, right: 480, top: 120, bottom: 156, width: 180, height: 36 }
    window.dispatchEvent(new Event('resize'))
    expect(parseFloat(panel.style.maxHeight)).toBeGreaterThanOrEqual(300)
    expect(parseFloat(panel.style.left)).toBeGreaterThanOrEqual(485)
  })

  it('v58 模板子菜单不可用项不执行，点击可用项一次插入且可撤销', async () => {
    const { root, host, editor } = fixture({ initialContent: '<p>原文</p>', templates: [{ id: 'ok58', label: '可用模板', html: '<h2>模板内容</h2><p>模板正文</p>' }, { id: 'no58', label: '待接入模板', unavailable: '尚未接入' }] })
    const before = editor.state.doc
    root.querySelector('button[aria-label="插入"]').click(); await vi.dynamicImportSettled()
    root.querySelector('[data-command-id="template"]').dispatchEvent(new MouseEvent('mouseenter'))
    const panel = root.querySelector('.lark-doc-command-submenu.is-templates')
    const disabled = panel.querySelector('[aria-label="待接入模板"]')
    expect(disabled.disabled).toBe(true); disabled.click(); expect(editor.state.doc).toBe(before)
    panel.querySelector('[aria-label="可用模板"]').click(); await vi.dynamicImportSettled()
    expect(editor.state.doc.textContent).toContain('模板内容')
    expect(editor.state.doc.textContent).toContain('原文')
    expect(host.menuOpen).toBe(false)
    expect(root.querySelector('.lark-doc-command-submenu')).toBeNull()
    editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true)
  })

  it('v58 模板子菜单移入保活，切回普通项与Escape清除双层界面不改正文', async () => {
    const { root, host, editor } = fixture()
    root.querySelector('button[aria-label="插入"]').click(); await vi.dynamicImportSettled()
    const menu = root.querySelector('.lark-doc-command-menu'), before = editor.state.doc
    const template = menu.querySelector('[data-command-id="template"]')
    template.dispatchEvent(new MouseEvent('mouseenter'))
    const panel = root.querySelector('.lark-doc-command-submenu.is-templates')
    vi.useFakeTimers()
    panel.dispatchEvent(new MouseEvent('mouseleave'))
    panel.dispatchEvent(new MouseEvent('mouseenter'))
    await vi.advanceTimersByTimeAsync(300)
    expect(host.menuOpen).toBe(true)
    vi.useRealTimers()
    menu.querySelector('[data-command-id="callout"]').dispatchEvent(new MouseEvent('mouseenter'))
    expect(root.querySelector('.lark-doc-command-submenu')).toBeNull()
    expect(host.menuOpen).toBe(true)
    template.focus()
    const reopened = root.querySelector('.lark-doc-command-submenu.is-templates')
    expect(reopened).not.toBeNull()
    reopened.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await Promise.resolve()
    expect(root.querySelector('.lark-doc-command-menu,.lark-doc-command-submenu')).toBeNull()
    expect(editor.view.hasFocus()).toBe(true)
    expect(editor.state.doc).toBe(before)
  })

  it('独立表格子菜单内按下仍保活，点击2行3列实际插入并清除双层菜单', async () => {
    const { root, host, editor } = fixture()
    root.querySelector('button[aria-label="插入"]').click()
    await vi.dynamicImportSettled()
    root.querySelector('.lark-doc-command-menu [data-command-id="table"]').click()
    const choice = root.querySelector('.lark-doc-command-submenu [aria-label="2行3列"]')
    choice.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    expect(host.menuOpen).toBe(true)
    choice.click()
    await Promise.resolve()
    const table = editor.getJSON().content.find(node => node.type === 'table')
    expect(table.content).toHaveLength(2)
    expect(table.content.every(row => row.content.length === 3)).toBe(true)
    expect(root.querySelector('.lark-doc-command-menu,.lark-doc-command-submenu')).toBeNull()
  })

  it('切换子菜单移除旧层，触发项滚出主菜单后关闭，销毁后不残留', async () => {
    const { root, renderer, handle } = fixture()
    root.querySelector('button[aria-label="插入"]').click()
    await vi.dynamicImportSettled()
    const menu = root.querySelector('.lark-doc-command-menu')
    menu.querySelector('[data-command-id="table"]').click()
    const old = root.querySelector('.lark-doc-command-submenu')
    const columns = menu.querySelector('[data-command-id="columns"]')
    columns.click()
    expect(old.isConnected).toBe(false)
    expect(root.querySelectorAll('.lark-doc-command-submenu')).toHaveLength(1)
    vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue({ top: 50, bottom: 350, height: 300 })
    vi.spyOn(columns, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 100, width: 100, top: 400, bottom: 432, height: 32 })
    menu.dispatchEvent(new Event('scroll'))
    expect(root.querySelector('.lark-doc-command-submenu')).toBeNull()
    vi.spyOn(columns, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 100, width: 100, top: 100, bottom: 132, height: 32 })
    columns.click()
    expect(root.querySelector('.lark-doc-command-submenu')).not.toBeNull()
    renderer.destroy(handle)
    expect(document.querySelector('.lark-doc-command-submenu')).toBeNull()
  })

  it('表格子菜单在带偏移的小视窗内限制宽高，resize不抛错', async () => {
    const { root } = fixture()
    vi.stubGlobal('visualViewport', { width: 300, height: 200, offsetLeft: 10.25, offsetTop: 30.5, addEventListener() {}, removeEventListener() {} })
    root.querySelector('button[aria-label="插入"]').click()
    await vi.dynamicImportSettled()
    const trigger = root.querySelector('.lark-doc-command-menu [data-command-id="table"]')
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({ left: 270, right: 300, top: 210, bottom: 242, width: 30, height: 32 })
    trigger.click()
    window.dispatchEvent(new Event('resize'))
    const menu = root.querySelector('.lark-doc-command-submenu')
    expect(parseFloat(menu.style.left)).toBeGreaterThanOrEqual(18.25)
    expect(parseFloat(menu.style.left) + parseFloat(menu.style.width)).toBeLessThanOrEqual(302.25)
    expect(parseFloat(menu.style.top)).toBeGreaterThanOrEqual(38.5)
    expect(parseFloat(menu.style.top) + parseFloat(menu.style.maxHeight)).toBeLessThanOrEqual(222.5)
  })

  it.each(['table', 'template', 'diagram'])('%s独立子菜单保留IME保护，Escape同步归还编辑焦点', async id => {
    const { root, host, editor } = fixture()
    root.querySelector('button[aria-label="插入"]').click()
    await vi.dynamicImportSettled()
    root.querySelector(`.lark-doc-command-menu [data-command-id="${id}"]`).click()
    const choice = root.querySelector('.lark-doc-command-submenu button')
    choice.focus()
    for (const ime of [{ isComposing: true }, { keyCode: 229 }]) {
      choice.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...ime }))
      expect(host.menuOpen).toBe(true)
    }
    choice.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(editor.view.dom)
    await Promise.resolve()
    expect(root.querySelector('.lark-doc-command-menu,.lark-doc-command-submenu')).toBeNull()
  })

  it('application commands insert only link preview cards and guard stale dialogs', async () => {
    const { host, root, editor, renderer, handle } = fixture()
    const ids = ['sheet', 'bitable', 'whiteboard', 'mindMap', 'flowChart', 'umlDiagram', 'folderManager', 'wikiRecent', 'jiraIssue', 'jiraFilter', 'meegoView', 'meegoDetail', 'subscribeArticle']
    const inserted = []
    for (const id of ids) {
      editor.commands.setContent('<p></p>'); host.savedSelection = null
      host.executeCommand(id)
      await vi.dynamicImportSettled()
      expect(root.querySelector('[aria-label="应用链接"]'), id).toBeTruthy()
      host.setEmbedValue('javascript:alert(1)'); host.applyEmbedDialog()
      await vi.dynamicImportSettled()
      expect(host.embedDialog, id).toBe(id)
      expect(root.querySelector('.lark-doc-embed-dialog-error').textContent).toContain('http(s)')
      host.setEmbedValue(`https://www.figma.com/${id}`)
      const input = root.querySelector('[aria-label="应用链接"]')
      for (const ime of [{ isComposing: true }, { keyCode: 229 }]) {
        const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...ime })
        input.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(false)
        expect(host.embedDialog, id).toBe(id)
      }
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
      expect(host.embedDialog, id).toBeNull()
      inserted.push(editor.getJSON().content.find(node => node.type === 'bookmark').attrs.appKind)
    }
    const cards = editor.getJSON().content.filter(node => node.type === 'bookmark')
    expect(inserted).toEqual(ids)
    expect(cards).toHaveLength(1)
    expect(editor.getJSON().content.some(node => ['sheet', 'bitable', 'webEmbed', 'cardEmbed'].includes(node.type))).toBe(false)
    host.executeCommand('sheet'); host.setEmbedValue('https://example.com/sheet')
    editor.commands.setContent('<p>新的正文</p>'); host.applyEmbedDialog()
    expect(editor.state.doc.textContent).toBe('新的正文')
    expect(host.error).toContain('正文已变化')
    host.closeEmbedDialog()
    renderer.update(handle, { config: { features: { insert: false } } })
    host.executeCommand('sheet')
    expect(host.embedDialog).toBeNull()
  })

  it.each(['more', 'color', 'diagram', 'insert'])('跨浮层悬浮到%s时旧标题菜单仍按离开动作关闭', async target => {
    const { host, root } = fixture()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    host.openHeadingMenuOnHover(); host.scheduleHeadingMenuClose()
    if (target === 'more') host.openMoreMenuOnHover()
    if (target === 'color') host.openColorPaletteOnHover()
    if (target === 'diagram') host.openDiagramMenuOnHover()
    if (target === 'insert') root.querySelector('button[aria-label="插入"]').dispatchEvent(new MouseEvent('mouseenter'))
    await vi.advanceTimersByTimeAsync(200)
    expect(host.headingOpen).toBe(false)
    if (target !== 'insert') expect(({ more: host.moreMenuOpen, color: host.colorPaletteOpen, diagram: host.diagramMenuOpen })[target]).toBeTruthy()
  })

  it('查找面板键盘支持反向查找、切换替换和取消续写', async () => {
    const { root, host, editor } = fixture()
    host.openSearch('find'); await vi.dynamicImportSettled()
    const input = root.querySelector('#lark-doc-fr-find')
    const next = vi.spyOn(host, 'nextMatch').mockImplementation(() => {})
    for (const key of ['Enter', 'Escape', 'h']) {
      const event = new KeyboardEvent('keydown', { key, ctrlKey: true, shiftKey: true, isComposing: true, bubbles: true, cancelable: true })
      input.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
      expect(host.searchOpen).toBe(true)
      expect(host.searchTab).toBe('find')
    }
    expect(next).not.toHaveBeenCalled()
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }))
    expect(next).toHaveBeenCalledWith(-1)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }))
    expect(host.searchTab).toBe('replace')
    await Promise.resolve()
    root.querySelector('#lark-doc-fr-replace').focus()
    root.querySelector('#lark-doc-fr-replace').dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true }))
    await Promise.resolve()
    expect(document.activeElement).toBe(input)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(host.searchOpen).toBe(false)
    expect(document.activeElement).toBe(editor.view.dom)
  })

  it('全部替换禁用按钮后仍可Esc关闭并独立撤销', async () => {
    const { root, host, editor } = fixture({ initialContent: '<p>目标 目标</p>' })
    document.body.appendChild(root)
    host.openSearch('replace'); await vi.dynamicImportSettled()
    host.setSearchQuery('目标'); host.setReplacement('替换'); host.updateSearch()
    const replace = root.querySelector('.lark-doc-fr-btn.is-primary')
    await vi.waitFor(() => expect(replace.disabled).toBe(false))
    replace.focus(); replace.click()
    expect(editor.state.doc.textContent).toBe('替换 替换')
    await vi.waitFor(() => expect(replace.disabled).toBe(true))
    expect(document.activeElement).toBe(root.querySelector('#lark-doc-fr-find'))
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(host.searchOpen).toBe(false)
    expect(document.activeElement).toBe(editor.view.dom)
    editor.commands.undo()
    expect(editor.state.doc.textContent).toBe('目标 目标')
  })

  it('正文持焦时Esc只关闭当前编号菜单并保留编号与正文', async () => {
    const { root, host, editor } = fixture({ initialContent: '<ol><li><p>编号正文</p></li></ol>' })
    document.body.appendChild(root); editor.view.focus()
    const before = editor.state.doc
    host.openListNumberMenu({ pos: 1, value: 1 }); await vi.dynamicImportSettled()
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(host.headingNumberMenu.open).toBe(false)
    expect(editor.state.doc).toBe(before)
    expect(document.activeElement).toBe(editor.view.dom)
  })

  it('保存提示在进入本工作区弹窗控件时退出，不拦截下一个操作或立即查看', async () => {
    // 「版本已保存，可在 ··· 更多菜单中找到」这条提示只在版本历史入口打开时才有意义：
    // `features.versionHistory` 缺省 false 时 ⋯ 菜单整个不挂载（workspace.js 的
    // `versionMenu.el` 显隐由 historyEnabled / commentHistoryAvailable 决定）。
    const { root, host } = fixture({ config: { features: { versionHistory: true } } })
    document.body.appendChild(root)
    host.versionNotice = '版本已保存'; await vi.dynamicImportSettled()
    const noticeLink = root.querySelector('.lark-doc-version-notice-link')
    noticeLink.focus()
    expect(host.versionNotice).toBe('版本已保存')
    const outside = document.createElement('button'); outside.setAttribute('aria-haspopup', 'menu'); document.body.appendChild(outside)
    try {
      outside.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
      expect(host.versionNotice).toBe('版本已保存')
      const trigger = root.querySelector('[role="combobox"][aria-label="文档更多操作"]')
      trigger.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
      expect(host.versionNotice).toBe('')
      host.versionNotice = '再次保存'; trigger.focus()
      expect(host.versionNotice).toBe('')
    } finally { outside.remove() }
  })

  it('内嵌菜单的普通链接通过书签命令规范化后保留真实卡片', () => {
    const { host, editor } = fixture()
    host.openEmbedDialog('figma'); host.setEmbedValue('http://127.0.0.1:58742/local-page'); host.applyEmbedDialog()
    const bookmark = editor.getJSON().content.find(node => node.type === 'bookmark')
    expect(bookmark?.attrs.url).toBe('http://127.0.0.1:58742/local-page')
    expect(bookmark.attrs.recordId).toBeTruthy()
    expect(host.embedDialog).toBeNull()
  })

  it('内嵌菜单不因命令拒绝危险协议而关闭或破坏正文', async () => {
    const { root, host, editor } = fixture({ initialContent: '<p>保留正文</p>' })
    document.body.appendChild(root)
    const before = editor.state.doc
    host.openEmbedDialog('figma'); await vi.dynamicImportSettled()
    const input = root.querySelector('.lark-doc-embed-dialog-input'); input.focus()
    host.setEmbedValue('javascript://example.com/x'); host.applyEmbedDialog()
    expect(host.embedDialog).toBe('figma')
    expect(host.embedDialogRejected).toBe(true)
    expect(editor.state.doc).toBe(before)
    await new Promise(requestAnimationFrame)
    expect(document.activeElement).toBe(input)
    input.value = 'http://127.0.0.1:58742/fixed'; input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(host.embedDialogRejected).toBe(false)
    host.applyEmbedDialog()
    expect(editor.getJSON().content.some(node => node.type === 'bookmark' && node.attrs.url.endsWith('/fixed'))).toBe(true)
  })

  it('内嵌菜单命中的平台链接仍通过现有命令插入网页块', () => {
    const { host, editor } = fixture()
    host.openEmbedDialog('figma'); host.setEmbedValue('https://www.figma.com/file/test/Test'); host.applyEmbedDialog()
    const embed = editor.getJSON().content.find(node => node.type === 'webEmbed')
    expect(embed?.attrs.providerId).toBe('figma')
    expect(embed.attrs.src).toContain('https://www.figma.com/embed?')
    expect(host.embedDialog).toBeNull()
  })

  it('链接取消同步归还正文焦点且不提交草稿', async () => {
    const { root, host, editor } = fixture()
    host.openLinkDialog(); await vi.dynamicImportSettled()
    const before = editor.state.doc
    const input = root.querySelector('[aria-label="链接文本"]')
    input.value = '取消的草稿'; input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(host.linkDialog).toBe(false)
    expect(editor.state.doc).toBe(before)
    expect(document.activeElement).toBe(editor.view.dom)
  })

  it('插入搜索框取消同步归还正文焦点且保留选区', async () => {
    const { root, host, editor } = fixture({ initialContent: '<p>原文</p>' })
    editor.commands.setTextSelection(3)
    const before = editor.state.doc
    host.openCommandMenu('plus'); await vi.dynamicImportSettled()
    const input = root.querySelector('.lark-doc-command-menu input')
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(host.menuOpen).toBe(false)
    expect(editor.state.doc).toBe(before)
    expect(editor.state.selection.from).toBe(3)
    expect(document.activeElement).toBe(editor.view.dom)
  })

  it('链接确认与相邻打字分别撤销，确认同步返回正文', async () => {
    const { host, editor } = fixture({ initialContent: '<p>原文</p>' })
    editor.commands.setTextSelection(3); editor.commands.insertContent('前字')
    host.openLinkDialog(); host.linkText = '链接'; host.linkValue = 'https://example.com/a'
    host.applyLink()
    expect(document.activeElement).toBe(editor.view.dom)
    expect(editor.getText()).toBe('原文前字链接')
    editor.commands.insertContent('后字'); editor.commands.undo()
    expect(editor.getText()).toBe('原文前字链接')
    editor.commands.undo()
    expect(editor.getText()).toBe('原文前字')
  })

  it.each([true, false])('替换(all=%s)与前后打字分别撤销', async all => {
    const { host, editor } = fixture({ initialContent: '<p>目标 目标</p>' })
    editor.commands.setTextSelection(6); editor.commands.insertContent('前字')
    const before = editor.getText()
    host.searchQuery = '目标'; host.replacement = '替换'; host.updateSearch(); host.replace(all)
    const replaced = editor.getText()
    expect(replaced).toContain('替换')
    editor.commands.insertContent('后字'); editor.commands.undo()
    expect(editor.getText()).toBe(replaced)
    editor.commands.undo()
    expect(editor.getText()).toBe(before)
  })

  it('工具栏图表显示文字和箭头，六种菜单项各有不同的 SVG 图标', async () => {
    const { root } = fixture()
    const trigger = root.querySelector('button[aria-label="图表"]')
    expect(trigger.textContent).toContain('图表')
    expect(trigger.querySelector('.lark-doc-caret svg')).not.toBeNull()
    trigger.click()
    await vi.dynamicImportSettled()
    const items = [...root.querySelectorAll('.lark-doc-diagram-menu [role="menuitem"]')]
    expect(items.map(item => item.textContent)).toEqual(diagramTypes.map(item => item.label))
    const icons = items.map(item => item.querySelector('.lark-doc-diagram-menu-icon svg'))
    expect(icons.every(Boolean)).toBe(true)
    expect(new Set(icons.map(icon => icon.outerHTML)).size).toBe(diagramTypes.length)
  })

  it.each(['disabled', 'allow', 'readonly'])('图表打开后%s配置变化使旧按钮失效并清除浮层', async mode => {
    const { renderer, handle, root, host, editor } = fixture()
    root.querySelector('button[aria-label="图表"]').click(); await vi.dynamicImportSettled()
    const stale = root.querySelector('.lark-doc-diagram-menu button'), before = editor.state.doc
    renderer.update(handle, mode === 'readonly' ? { readonly: true } : { config: { commands: mode === 'disabled' ? { disabled: ['diagram'] } : { allow: ['blockquote'] } } })
    await Promise.resolve()
    stale.click(); host.insertDiagramType('flowchart'); host.toggleDiagramMenu(); host.openDiagramMenuOnHover()
    await vi.dynamicImportSettled()
    expect(editor.state.doc).toBe(before)
    expect(root.querySelector('.lark-doc-diagram-menu')).toBeNull()
  })

  it.each(['scroll', 'keydown'])('工具栏提示冷加载期间%s取消，空隙无异常，移出与销毁不残留', async dismiss => {
    const { renderer, handle, root, host } = fixture()
      const toolbar = root.querySelector('.lark-doc-toolbar'), button = toolbar.querySelector('button[aria-label="加粗"]')
    const errors = [], capture = event => errors.push(event.error)
    window.addEventListener('error', capture)
    try {
      toolbar.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
      button.getBoundingClientRect = () => ({ left: 100, top: 1, right: 140, bottom: 31, width: 40, height: 30 })
      button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      if (dismiss === 'scroll') window.dispatchEvent(new Event('scroll'))
      else button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await vi.dynamicImportSettled(); await new Promise(resolve => setTimeout(resolve, 180))
      expect(root.querySelector('[role="tooltip"]')).toBeNull()
      button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      await vi.dynamicImportSettled()
      await vi.waitFor(() => expect(root.querySelector('[role="tooltip"]')?.textContent).toBe('加粗'))
      window.dispatchEvent(new Event('scroll'))
      host.refreshToolbar()
      await new Promise(resolve => setTimeout(resolve, 180))
      expect(root.querySelector('[role="tooltip"]')).toBeNull()
      button.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
      expect(root.querySelector('[role="tooltip"]')).toBeNull()
      button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      renderer.destroy(handle)
      await vi.dynamicImportSettled()
      expect(root.querySelector('[role="tooltip"]')).toBeNull()
      expect(errors).toEqual([])
    } finally { window.removeEventListener('error', capture) }
  })

  it('图表项已有文字标签，不重复显示提示', async () => {
    const { root, host } = fixture()
    root.querySelector('button[aria-label="图表"]').click(); await vi.dynamicImportSettled()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const item = root.querySelector('.lark-doc-diagram-menu button')
    item.getBoundingClientRect = () => ({ left: 100, top: 120, right: 180, bottom: 150, width: 80, height: 30 })
    item.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    item.dispatchEvent(new MouseEvent('mouseenter'))
    await vi.advanceTimersByTimeAsync(150)
    expect(root.querySelectorAll('[role="tooltip"]')).toHaveLength(0)
    expect(item.getAttribute('aria-describedby')).toBeNull()
    host.closeDiagramMenu(); await Promise.resolve()
    expect(root.querySelector('[role="tooltip"]')).toBeNull()
  })
  // 「插入表格」已改成带 caret 的下拉（与「图表」同一套交互），因此也落进「真下拉」这一组。
  it.each(['图表', '页面宽度', '插入表格'])('顶部%s是下拉，不再显示原生和自绘tips', async label => {
    const { root } = fixture()
    const button = root.querySelector(`button[aria-label="${label}"]`)
    expect(button).not.toBeNull()
    button.getBoundingClientRect = () => ({ left: 100, top: 20, right: 140, bottom: 50, width: 40, height: 30 })
    button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    await vi.dynamicImportSettled(); await new Promise(resolve => setTimeout(resolve, 180))
    expect(button.getAttribute('title')).toBeNull()
    expect(root.querySelector('[role="tooltip"]')).toBeNull()
  })

  // 口径：没有下拉、又不是中文文字按钮的，一律要 tips。`aria-haspopup="dialog"`
  // 打开的是模态（弹窗里没有替代文案），不能像 menu / listbox 那样跳过。
  it.each(['查找', '设置链接', 'AI 助手'])('顶部纯图标按钮 %s 没有下拉，显示自绘tips', async label => {
    const { root } = fixture()
    const button = root.querySelector(`button[aria-label="${label}"]`)
    expect(button).not.toBeNull()
    button.getBoundingClientRect = () => ({ left: 100, top: 20, right: 140, bottom: 50, width: 40, height: 30 })
    button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    await vi.dynamicImportSettled()
    await vi.waitFor(() => expect(root.querySelector('[role="tooltip"]')?.textContent).toBe(label))
    expect(button.getAttribute('title')).toBeNull()
  })

  // 飞书口径：工具栏表格按钮先出 9×9 选择器，不静默插 2×3（`tablePicker` 曾被打回
  // `insertTable()`，弹窗组件挂着却没人调）。
  it('工具栏表格按钮先开 9×9 选择器，选 4 列 2 行才真正插入', async () => {
    const { root, host, editor } = fixture()
    root.querySelector('button[aria-label="插入表格"]').click()
    await vi.dynamicImportSettled()
    expect(host.tablePicker).toBe(true)
    await vi.waitFor(() => expect(root.querySelectorAll('.lark-doc-table-grid button')).toHaveLength(81))
    expect(root.querySelector('.lark-doc-table-grid-size').textContent).toBe('1 × 1')
    // 单元格 aria-label 是「先列后行」，索引 = (row-1)*9 + (col-1)：点第 2 行第 4 列。
    root.querySelectorAll('.lark-doc-table-grid button')[12].click()
    expect(host.tablePicker).toBe(false)
    await vi.waitFor(() => expect(editor.view.dom.querySelector('table')).not.toBeNull())
    const rows = editor.view.dom.querySelectorAll('table tr')
    expect(rows).toHaveLength(2)
    expect(rows[0].children.length).toBe(4)
  })

  // 纯点击（没有 hover 预热，键盘 Enter 就是这条路径）走 toggle：再一次收起。
  it('表格下拉再次点击收起，不走 hover 标志', async () => {
    const { root, host } = fixture()
    const trigger = root.querySelector('button[aria-label="插入表格"]')
    trigger.click()
    await vi.dynamicImportSettled()
    expect(host.tablePicker).toBe(true)
    await vi.waitFor(() => expect(root.querySelectorAll('.lark-doc-table-grid button')).toHaveLength(81))
    trigger.click()
    await vi.dynamicImportSettled()
    expect(host.tablePicker).toBe(false)
    expect(root.querySelector('.lark-doc-table-picker')).toBeNull()
  })

  it('图表冷加载完成前关闭不残留，重新打开正常展示', async () => {
    const { root, host } = fixture()
    const trigger = root.querySelector('button[aria-label="图表"]')
    trigger.click(); host.closeDiagramMenu()
    await vi.dynamicImportSettled()
    expect(root.querySelector('.lark-doc-diagram-menu')).toBeNull()
    trigger.click(); await vi.dynamicImportSettled()
    expect(root.querySelectorAll('.lark-doc-diagram-menu [role="menuitem"]')).toHaveLength(diagramTypes.length)
  })

  it('图表 hover 后点击保持打开，跨入菜单保活，离开后延迟关闭', async () => {
    const { root, host } = fixture()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const trigger = root.querySelector('button[aria-label="图表"]')
    trigger.dispatchEvent(new MouseEvent('mouseenter'))
    await vi.dynamicImportSettled()
    expect(host.diagramMenuOpen).toBe(true)
    trigger.click()
    expect(host.diagramMenuOpen).toBe(true)
    const menu = root.querySelector('.lark-doc-diagram-menu')
    trigger.dispatchEvent(new MouseEvent('mouseleave'))
    menu.dispatchEvent(new MouseEvent('mouseenter'))
    await vi.advanceTimersByTimeAsync(200)
    expect(host.diagramMenuOpen).toBe(true)
    menu.dispatchEvent(new MouseEvent('mouseleave'))
    await vi.advanceTimersByTimeAsync(200)
    expect(host.diagramMenuOpen).toBe(false)
  })

  it.each(['doc', 'selection', 'permission'])('图表示例冷加载期间%s变化不插入旧目标', async mode => {
    const { host, editor } = fixture({ initialContent: '<p>seed</p>' })
    const pending = host.insertDiagramType('pie')
    if (mode === 'doc') editor.commands.setContent('<p>new document</p>')
    else if (mode === 'selection') editor.commands.setTextSelection(3)
    else host.writable = () => false
    const current = editor.state.doc
    await pending
    expect(editor.state.doc).toBe(current)
    expect(editor.getJSON().content.some(node => node.type === 'codeBlock')).toBe(false)
  })

  it.each(['toolbar', 'plus', 'slash'])('%s 入口选择六种类型均插入对应 Mermaid 源码', async kind => {
    const { root, host, editor } = fixture()
    for (const type of diagramTypes) {
      editor.commands.setContent('<p></p>')
      if (kind === 'toolbar') root.querySelector('button[aria-label="图表"]').click()
      else if (kind === 'plus') root.querySelector('button[aria-label="插入"]').click()
      else editor.commands.insertContent('/图表')
      await vi.dynamicImportSettled()
      if (kind !== 'toolbar') {
        await vi.dynamicImportSettled()
        const item = root.querySelector('.lark-doc-command-menu [aria-label="图表"]')
        expect(item).not.toBeNull()
        item.click()
        await Promise.resolve()
      }
      const menu = root.querySelector(kind === 'toolbar' ? '.lark-doc-diagram-menu' : '.lark-doc-command-submenu.is-diagram')
      expect(menu).not.toBeNull()
      expect(menu.querySelectorAll('svg')).toHaveLength(diagramTypes.length)
      const item = [...menu.querySelectorAll('[role="menuitem"]')].find(item => item.textContent === type.label)
      item.click()
      await vi.dynamicImportSettled()
      const block = editor.getJSON().content.find(node => node.type === 'codeBlock')
      expect(block).toMatchObject({ attrs: { language: 'mermaid' }, content: [{ type: 'text', text: DIAGRAM_SOURCES[type.id] }] })
      expect(host.diagramMenuOpen).toBe(false)
      expect(host.menuOpen).toBe(false)
    }
  })

  it('斜杠图表按 Enter 先打开类型菜单，选择后才插入相应源码', async () => {
    const { root, editor } = fixture()
    editor.commands.insertContent('/图表')
    await Promise.resolve()
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await vi.dynamicImportSettled()
    const menu = root.querySelector('.lark-doc-command-submenu.is-diagram')
    expect(menu).not.toBeNull()
    expect(menu.querySelectorAll('[role="menuitem"]')).toHaveLength(diagramTypes.length)
    expect(editor.getJSON().content.some(node => node.type === 'codeBlock')).toBe(false)
    expect(editor.getText()).toBe('/图表')
    menu.querySelector('[aria-label="时序图"]').click()
    await Promise.resolve()
    await vi.dynamicImportSettled()
    const block = editor.getJSON().content.find(node => node.type === 'codeBlock')
    expect(block).toMatchObject({ attrs: { language: 'mermaid' }, content: [{ type: 'text', text: DIAGRAM_SOURCES.sequence }] })
    expect(root.querySelector('.lark-doc-command-menu')).toBeNull()
  })

  it('斜杠普通叶命令按 Enter 仍直接执行', async () => {
    const { root, editor } = fixture()
    editor.commands.insertContent('/引用')
    await Promise.resolve()
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await Promise.resolve()
    expect(editor.getJSON().content[0].type).toBe('blockquote')
    expect(root.querySelector('.lark-doc-command-menu')).toBeNull()
  })

  it.each([['分栏', 'columns'], ['模板', 'templates']])('斜杠 %s 按 Enter 复用已有二级菜单', async (label, kind) => {
    const { root, editor } = fixture()
    editor.commands.insertContent('/' + label)
    await Promise.resolve()
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await vi.dynamicImportSettled()
    expect(root.querySelector('.lark-doc-command-submenu.is-' + kind)).not.toBeNull()
    expect(editor.getText()).toBe('/' + label)
  })

  it('下方空间不足时图表菜单上翻，右侧不越过视口', async () => {
    const { root, host } = fixture()
    vi.stubGlobal('innerWidth', 360)
    vi.stubGlobal('innerHeight', 600)
    const trigger = root.querySelector('button[aria-label="图表"]')
    trigger.click()
    await vi.dynamicImportSettled()
    const menu = root.querySelector('.lark-doc-diagram-menu')
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({ left: 320, right: 352, top: 560, bottom: 592, width: 32, height: 32 })
    vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 180, top: 0, bottom: 246, width: 180, height: 246 })
    host.positionDiagramMenu()
    const { top, left, maxHeight } = host.diagramMenuStyle
    expect(parseFloat(top)).toBeGreaterThanOrEqual(8)
    expect(parseFloat(top) + parseFloat(maxHeight)).toBeLessThanOrEqual(560)
    expect(parseFloat(left) + 180).toBeLessThanOrEqual(352)
  })

  it.each(['toolbar', 'empty'])('%s 插入入口到菜单和图表子菜单保活，移开后收起', async kind => {
    const { root, host } = fixture()
    host.handleRange = { from: 0, to: 2 }
    await Promise.resolve()
    await vi.dynamicImportSettled()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const trigger = root.querySelector(kind === 'toolbar' ? 'button[aria-label="插入"]' : '.lark-doc-empty-block-insert')
    if (kind === 'toolbar') trigger.click()
    else trigger.dispatchEvent(new MouseEvent('mouseenter'))
    await vi.dynamicImportSettled()
    const menu = root.querySelector('.lark-doc-command-menu')
    trigger.dispatchEvent(new MouseEvent('mouseleave'))
    trigger.dispatchEvent(new MouseEvent('mouseenter'))
    await vi.advanceTimersByTimeAsync(200)
    expect(host.menuOpen).toBe(true)
    trigger.dispatchEvent(new MouseEvent('mouseleave'))
    menu.dispatchEvent(new MouseEvent('mouseenter'))
    await vi.advanceTimersByTimeAsync(200)
    expect(host.menuOpen).toBe(true)
    menu.querySelector('[aria-label="图表"]').click()
    const submenu = root.querySelector('.lark-doc-command-submenu.is-diagram')
    expect(submenu).not.toBeNull()
    menu.dispatchEvent(new MouseEvent('mouseleave'))
    submenu.dispatchEvent(new MouseEvent('mouseenter'))
    await vi.advanceTimersByTimeAsync(200)
    expect(host.menuOpen).toBe(true)
    submenu.dispatchEvent(new MouseEvent('mouseleave'))
    await vi.advanceTimersByTimeAsync(200)
    expect(host.menuOpen).toBe(false)
  })

  it.each([{ readonly: true }, { config: { features: { diagram: false } } }])('只读或关闭图表时不打开图表菜单', props => {
    const { root, host } = fixture(props)
    root.querySelector('button[aria-label="图表"]')?.dispatchEvent(new MouseEvent('mouseenter'))
    host.toggleDiagramMenu()
    expect(host.diagramMenuOpen).toBe(false)
  })
})

afterEach(() => {
  mounted.splice(0).reverse().forEach(({ renderer, handle, host }) => {
    renderer.destroy(handle)
    host.remove()
  })
  vi.restoreAllMocks()
  localStorage.clear()
})

function expectContract(renderer) {
  expect(Object.keys(renderer).filter(key => typeof renderer[key] === 'function')).toEqual(ACTIONS)
  ACTIONS.forEach(action => expect(typeof renderer[action]).toBe('function'))
}

describe('迁移期 DOM renderer 契约', () => {
  it('暴露且只暴露五个 renderer 动作', () => {
    expectContract(createDomRenderer())
  })

  it('在普通 DOM 宿主下创建等价根节点并提供实例', async () => {
    const host = document.createElement('div')
    const ready = vi.fn()
    // ready 是异步生命周期事件：只断言「最终会派发」，不绑定具体微任务数量。
    let resolveReady
    const readyFired = new Promise(resolve => { resolveReady = resolve })
    const renderer = createDomRenderer()
    const handle = mountRenderer(renderer, {
      element: host,
      props: { initialTitle: '迁移期文档', initialContent: '<p>正文</p>' },
      on: { ready: (payload) => { ready(payload); resolveReady() } },
    })

    expect(renderer.getRoot(handle)).toBe(host.firstElementChild)
    expect(renderer.getRoot(handle).className).toContain('lark-doc')
    expect(renderer.getRoot(handle).dataset.renderer).toBe('dom-migration')
    expect(renderer.getRoot(handle).querySelector('#lark-doc-editor')).not.toBeNull()
    expect(renderer.getRoot(handle).querySelector('.lark-doc-actions-host')).not.toBeNull()
    expect(renderer.getRoot(handle).querySelector('.lark-doc-external-panel')).not.toBeNull()
    expect(renderer.getInstance(handle)).toBe(handle.instance)
    const instance = renderer.getInstance(handle)
    expect(handle.editor).toBeInstanceOf(Editor)
    expect(handle.editor.state.selection).toBeInstanceOf(TextSelection)
    expect(handle.editor.state.doc.textContent).toBe('正文')
    expect(instance.getTitle()).toBe('迁移期文档')
    expect(instance.getText()).toContain('正文')
    ;[
      'getWorkspace', 'callWorkspace', 'record', 'onReady', 'queueSave', 'flushOnLeave', 'saveNow',
      'storageFailure', 'toggleHistory', 'createSnapshot', 'restoreSnapshot', 'importDocument',
      'exportDocument', 'currentAIContext', 'resetAIPreview', 'startAI', 'sendAIChat', 'regenerateAI',
      'stopAI', 'closeAI', 'copyAIPreview', 'acceptAI', 'insertAIResult', 'acceptReviewIssue',
      'ignoreReviewIssue', 'applyAIProposal', 'toggleSlides', 'isSlides',
    ].forEach((method) => expect(typeof instance[method]).toBe('function'))
    await readyFired
    expect(ready).toHaveBeenCalled()

    renderer.destroy(handle)
    expect(renderer.getRoot(handle)).toBeNull()
    expect(host.firstElementChild).toBeNull()
  })

  it.each([
    ['edit', false], ['suggest', false], ['read', false], ['edit', true],
  ])('modes.visible 经真实门面和顶栏 state 显隐，保留 %s 模式与宿主只读 %s', async (mode, readonly) => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const modes = { visible: false, default: mode, persist: false, labels: { read: '预览' } }
    const doc = new LarkDoc({ element, storage: 'none', content: '<p>保留正文</p>', readonly, config: { modes } })
    try {
      const editor = doc.getEditor()
      const host = doc._handle.nativeHost.host
      const root = element.querySelector('.lark-doc')
      const editable = mode !== 'read' && !readonly
      await vi.waitFor(() => expect(editor.isEditable).toBe(editable))
      expect(doc.getConfig().modes.visible).toBe(false)
      expect(host.buildTopBarState().modeVisible).toBe(false)
      expect(root.querySelector('.lark-doc-mode-select')).toBeNull()
      expect(root.querySelector('.lark-doc-topbar')).not.toBeNull()
      expect(host.mode).toBe(mode)
      const json = doc.getJSON()
      const actions = root.querySelector('.lark-doc-actions-host')
      const reading = root.querySelector('button[aria-label="阅读模式"], button[aria-label="退出阅读"]')
      expect(reading).not.toBeNull()

      doc.patchProps({ config: { modes: { ...modes, visible: true } } })
      await vi.waitFor(() => expect(root.querySelector('.lark-doc-mode-select')).not.toBeNull())
      const select = root.querySelector('.lark-doc-mode-select')
      select.querySelector('[role="combobox"]').click()
      expect(select.querySelectorAll('[role="option"]')).toHaveLength(3)
      expect(select.querySelectorAll('.lark-doc-select-item-label')[2].textContent).toBe('预览')
      doc.patchProps({ config: { modes } })
      await vi.waitFor(() => expect(root.querySelector('.lark-doc-mode-select')).toBeNull())
      expect(select.parentNode).toBeNull()
      expect(select.querySelector('[role="listbox"]')).toBeNull()
      expect(host.buildTopBarState().modeVisible).toBe(false)
      expect(host.mode).toBe(mode)
      expect(editor.isEditable).toBe(editable)
      expect(doc.getEditor()).toBe(editor)
      expect(doc.getJSON()).toEqual(json)
      expect(root.querySelector('.lark-doc-actions-host')).toBe(actions)
      expect(root.querySelector('.lark-doc-topbar').contains(actions)).toBe(true)
      expect(root.querySelector('button[aria-label="阅读模式"], button[aria-label="退出阅读"]')).toBe(reading)
    } finally { doc.destroy(); element.remove() }
  })

  it('连续切换三态只更新成功提示文字，保留同一成功图标和正文', async () => {
    const host = document.createElement('div')
    const renderer = createDomRenderer()
    const handle = mountRenderer(renderer, {
      element: host,
      props: { initialContent: '<p>正文</p>', config: { modes: { persist: false } } },
    })
    const root = renderer.getRoot(handle)
    const toast = root.querySelector('.lark-doc-mode-toast')
    const icon = toast.querySelector('.lark-doc-mode-toast-icon')
    expect(toast.hidden).toBe(true)
    expect(toast.getAttribute('role')).toBe('status')
    expect(icon).not.toBeNull()
    expect(icon.textContent).toBe('✓')
    expect(icon.getAttribute('aria-hidden')).toBe('true')
    const json = handle.editor.getJSON()

    for (const [index, label] of [[1, '修订'], [2, '阅读'], [0, '编辑']]) {
      root.querySelector('.lark-doc-mode-select [role="combobox"]').click()
      root.querySelectorAll('.lark-doc-mode-select [role="option"]')[index].click()
      await vi.waitFor(() => expect(toast.querySelector('.lark-doc-mode-toast-text')?.textContent).toBe(`已切换为${label}模式`))
      expect(toast.hidden).toBe(false)
      expect(toast.querySelector('.lark-doc-mode-toast-icon')).toBe(icon)
      expect(handle.editor.getJSON()).toEqual(json)
    }
  })

  it('DOM renderer 的演示显示完整富文档、单一返回入口且支持退出', async () => {
    const host = document.createElement('div')
    const renderer = createDomRenderer()
    const handle = mountRenderer(renderer, {
      element: host,
      props: { initialTitle: '演示文档', initialContent: '<h1>第一节</h1><p><strong>正文</strong></p><table><tr><td>表格正文</td></tr></table><h1>第二节</h1><p>末尾正文</p>' },
    })
    const instance = renderer.getInstance(handle)
    const root = renderer.getRoot(handle)
    const before = handle.editor.getJSON()

    expect(root.querySelector('.lark-doc-slide-stage')).toBeNull()
    instance.toggleSlides()
    expect(instance.isSlides()).toBe(true)
    expect(root.classList.contains('lark-doc-slides')).toBe(true)
    expect(root.querySelector('.lark-doc-paper').style.display).toBe('none')
    await vi.waitFor(() => expect(root.querySelector('.lark-doc-slide-stage strong')?.textContent).toBe('正文'))
    expect(root.querySelector('.lark-doc-slide-stage')?.textContent).toContain('演示文档')
    expect(root.querySelectorAll('.lark-doc-slide-stage header button')).toHaveLength(1)
    expect(root.querySelector('.lark-doc-slide-stage header button').textContent).toBe('返回')
    expect(root.querySelector('.lark-doc-slide-stage strong').textContent).toBe('正文')
    expect(root.querySelector('.lark-doc-slide-stage td').textContent).toBe('表格正文')
    expect(root.querySelector('.lark-doc-slide-stage').textContent).toContain('末尾正文')
    expect(root.querySelector('.lark-doc-slide-stage [contenteditable="true"]')).toBeNull()
    expect(handle.editor.getJSON()).toEqual(before)

    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(root.querySelector('.lark-doc-slide-counter')).toBeNull()

    root.querySelector('.lark-doc-slide-stage button:last-child').click()
    expect(instance.isSlides()).toBe(false)
    await Promise.resolve()
    expect(root.querySelector('.lark-doc-slide-stage')).toBeNull()
    expect(root.querySelector('.lark-doc-paper').style.display).toBe('')
    expect(handle.editor.getJSON()).toEqual(before)

    await Promise.resolve()
    renderer.destroy(handle)
  })

  it.each(['close', 'destroy'])('演示原生全屏等待期间%s，晚到成功会退出全屏且不重开副本', async action => {
    const renderer = createDomRenderer(), element = document.createElement('div')
    const handle = mountRenderer(renderer, { element, props: { initialContent: '<p>原文</p>' } })
    const instance = renderer.getInstance(handle), root = renderer.getRoot(handle)
    const previousDescriptor = Object.getOwnPropertyDescriptor(document, 'fullscreenElement')
    const previousExit = document.exitFullscreen
    let fullscreen = null, finish
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreen })
    document.exitFullscreen = vi.fn(async () => { fullscreen = null; document.dispatchEvent(new Event('fullscreenchange')) })
    root.requestFullscreen = vi.fn(() => new Promise(resolve => { finish = () => { fullscreen = root; document.dispatchEvent(new Event('fullscreenchange')); resolve() } }))
    try {
      instance.toggleSlides()
      await vi.waitFor(() => expect(root.requestFullscreen).toHaveBeenCalledOnce())
      if (action === 'destroy') renderer.destroy(handle)
      else instance.toggleSlides()
      finish()
      await vi.waitFor(() => expect(document.exitFullscreen).toHaveBeenCalledOnce())
      expect(fullscreen).toBeNull()
      expect(root.querySelector('.lark-doc-slide-stage')).toBeNull()
      if (action === 'close') {
        expect(instance.isSlides()).toBe(false)
        expect(handle.editor.state.doc.textContent).toBe('原文')
      }
    } finally {
      if (previousDescriptor) Object.defineProperty(document, 'fullscreenElement', previousDescriptor)
      else delete document.fullscreenElement
      document.exitFullscreen = previousExit
    }
  })

  it('工具栏投影使用真实 marks/options，并按配置裁剪入口', async () => {
    const host = document.createElement('div')
    const renderer = createDomRenderer()
    const handle = mountRenderer(renderer, {
      element: host,
      props: {
        initialContent: '<p>正文</p>',
        config: { toolbar: { marksAllow: ['bold', 'strike'] }, features: { ai: false, outline: false } },
      },
    })
    await Promise.resolve()
    const root = renderer.getRoot(handle)
    expect(root.querySelectorAll('.lark-doc-mark-bold')).toHaveLength(1)
    expect(root.querySelectorAll('.lark-doc-mark-strike')).toHaveLength(1)
    expect(root.querySelectorAll('.lark-doc-mark-italic')).toHaveLength(0)
    expect(root.querySelector('[aria-label="字体"]')).not.toBeNull()
    expect(root.querySelector('[aria-label="字号"]')).not.toBeNull()
    expect(root.querySelector('[aria-label="目录"]')).toBeNull()
    expect(root.querySelector('[aria-label="AI 助手"]')).toBeNull()
    renderer.destroy(handle)
  })

  it('正文标题切换走 setParagraph，清除格式同时清节点', async () => {
    const host = document.createElement('div')
    const renderer = createDomRenderer()
    const handle = mountRenderer(renderer, { element: host, props: { initialContent: '<p>正文</p>' } })
    await Promise.resolve()
    const root = renderer.getRoot(handle)
    const editor = handle.editor
    const commands = editor.commandManager.rawCommands
    const setParagraph = vi.spyOn(commands, 'setParagraph')
    const unsetAllMarks = vi.spyOn(commands, 'unsetAllMarks')
    const clearNodes = vi.spyOn(commands, 'clearNodes')
    editor.commands.setHeading({ level: 2 })
    editor.commands.setTextSelection({ from: 1, to: 3 })
    editor.commands.toggleBold()
    expect(editor.isActive('heading', { level: 2 })).toBe(true)
    expect(editor.isActive('bold')).toBe(true)
    root.querySelector('[aria-label="标题级别"]').click()
    await Promise.resolve()
    root.querySelector('.lark-doc-heading-menu button').click()
    root.querySelector('[aria-label="清除格式"]').click()
    expect(setParagraph).toHaveBeenCalledWith()
    expect(unsetAllMarks).toHaveBeenCalledWith()
    expect(clearNodes).toHaveBeenCalledWith()
    expect(editor.isActive('paragraph')).toBe(true)
    expect(editor.isActive('bold')).toBe(false)
    expect(editor.state.doc.textContent).toBe('正文')
    renderer.destroy(handle)
  })

  it('update props 触发重新投影，destroy 后不再接受延迟刷新', async () => {
    const host = document.createElement('div')
    const renderer = createDomRenderer()
    const handle = mountRenderer(renderer, { element: host, props: { initialContent: '<p>正文</p>' } })
    renderer.update(handle, { config: { features: { marks: false } } })
    await Promise.resolve()
    expect(renderer.getRoot(handle).querySelector('.lark-doc-mark-bold')).toBeNull()
    renderer.destroy(handle)
    handle.requestRender()
    await Promise.resolve()
    expect(renderer.getRoot(handle)).toBeNull()
  })

  it('运行时正文跨过大文档阈值时刷新滚动优化类，缩回后也会清除', async () => {
    const host = document.createElement('div')
    const renderer = createDomRenderer()
    const handle = mountRenderer(renderer, { element: host, props: { initialContent: '<p>正文</p>' } })
    // jsdom has no layout-backed Range rects; this test only checks the
    // renderer's threshold projection, so keep geometry out of the fixture.
    handle.nativeHost.host.updateHandleAndTable = () => {}
    handle.nativeHost.host.selectionBatcher().dispose()
    handle.editor.commands.setContent(`<p>${'x'.repeat(500001)}</p>`)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(renderer.getRoot(handle).classList.contains('lark-doc-large-document')).toBe(true)
    handle.editor.commands.setContent('<p>正文</p>')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(renderer.getRoot(handle).classList.contains('lark-doc-large-document')).toBe(false)
    renderer.destroy(handle)
  })

  it.each(['folded', 'unassigned', 'unassigned-legacy'])('未绘制的块%s移除旧句柄，不能留下撑高整页的绝对定位元素', kind => {
    stubRangeLayout()
    const renderer = createDomRenderer()
    const handle = mountRenderer(renderer, { element: document.createElement('div'), props: { initialContent: '<p>句柄锚点</p>' } })
    const host = handle.nativeHost.host
    host.selectionBatcher().dispose()
    const range = host.currentBlockRange(), node = handle.editor.view.nodeDOM(range.from)
    host.handleRange = range
    host.blockHandlePosition = { top: 125000, left: 0 }
    if (kind === 'folded') node.style.display = 'none'
    else if (kind === 'unassigned') Object.defineProperty(node, 'checkVisibility', { configurable: true, value: () => false })
    else handle.editor.view.dom.attachShadow({ mode: 'open' })
    const measure = vi.spyOn(node, 'getBoundingClientRect').mockImplementation(() => { throw new Error('hidden block layout') })
    try {
      host.positionBlockHandle(range)
      expect(host.handleRange).toBeNull()
      expect(measure).not.toHaveBeenCalled()
    } finally { renderer.destroy(handle) }
  })

  it('静止块句柄重复定位不重绘工作台', async () => {
    stubRangeLayout()
    const renderer = createDomRenderer()
    const handle = mountRenderer(renderer, { element: document.createElement('div'), props: { initialContent: '<p>固定位置</p>' } })
    const host = handle.nativeHost.host
    host.selectionBatcher().dispose()
    await new Promise(resolve => setTimeout(resolve, 50))
    host.positionBlockHandle(host.currentBlockRange())
    expect(host._blockHandleAnchor).toBe(handle.editor.view.nodeDOM(host.handleRange.from))
    const visible = vi.fn(() => true)
    Object.defineProperty(host._blockHandleAnchor, 'checkVisibility', { configurable: true, value: visible })
    host.syncBlockHandleVisibility()
    expect(visible).not.toHaveBeenCalled()
    await Promise.resolve()
    host.positionBlockHandle(host.handleRange)
    await Promise.resolve()
    const update = vi.spyOn(handle.workspaceUi, 'update')
    const position = { ...host.blockHandlePosition }
    for (let index = 0; index < 200; index += 1) host.positionBlockHandle({ ...host.handleRange })
    await Promise.resolve()
    expect(host.blockHandlePosition).toEqual(position)
    expect(update).not.toHaveBeenCalled()
  })

  it('折叠的纯元数据事务清理旧句柄锚点，不依赖再次定位', () => {
    stubRangeLayout()
    const renderer = createDomRenderer()
    const handle = mountRenderer(renderer, { element: document.createElement('div') })
    const host = handle.nativeHost.host, editor = handle.editor
    host.selectionBatcher().dispose()
    editor.commands.setContent({ type: 'doc', content: [
      { type: 'heading', attrs: { level: 1, blockId: 'fold_anchor' }, content: [{ type: 'text', text: '标题' }] },
      { type: 'paragraph', attrs: { indent: 1 }, content: [{ type: 'text', text: '折叠正文' }] },
    ] })
    const range = host.rangeAt(editor.state.doc.firstChild.nodeSize + 1)
    const node = editor.view.nodeDOM(range.from)
    host.handleRange = range
    host._blockHandleAnchor = node
    host.blockHandlePosition = { top: 125000, left: 0 }
    try {
      editor.commands.toggleLarkDocFold(0)
      expect(node.style.display).toBe('none')
      expect(host.handleRange).toBeNull()
      expect(host._blockHandleAnchor).toBeNull()
    } finally { renderer.destroy(handle) }
  })

  it('预挂载窗口中的句柄清理延至事务后，不能提前清除prepared选区', async () => {
    stubRangeLayout()
    let notifyWindow, preparing = false, completedDuringPrepare = false
    const projection = {
      setActive() {}, refresh() {}, destroy() {}, getRenderedBlocks: () => [],
      prepareSelection() { preparing = true; notifyWindow([]); preparing = false },
      completeSelection() { if (preparing) completedDuringPrepare = true },
    }
    vi.spyOn(segmentedDocument, 'createLargeDocumentProjection').mockImplementation(options => { notifyWindow = options.onRenderWindowChange; return projection })
    const renderer = createDomRenderer()
    const handle = mountRenderer(renderer, { element: document.createElement('div'), props: { initialContent: '<p>开始</p>' } })
    const host = handle.nativeHost.host, editor = handle.editor
    host.selectionBatcher().dispose()
    host.updateHandleAndTable = () => {}
    try {
      editor.commands.setContent(`<p>${'x'.repeat(500001)}</p>`)
      await new Promise(resolve => setTimeout(resolve, 50))
      await vi.dynamicImportSettled()
      expect(notifyWindow).toBeTypeOf('function')
      let once = true, clearedDuringPrepare = false
      const clear = vi.spyOn(host, 'syncBlockHandleVisibility').mockImplementation(() => {
        if (preparing) clearedDuringPrepare = true
        if (once) { once = false; editor.commands.setLarkDocHandleHover(null) }
      })
      editor.commands.setTextSelection(50000)
      expect(completedDuringPrepare).toBe(false)
      expect(clearedDuringPrepare).toBe(false)
      await Promise.resolve()
      expect(clear).toHaveBeenCalled()
      expect(editor.state.selection.from).toBe(50000)
    } finally { renderer.destroy(handle) }
  })

  it('段模型加载失败后同一正文不重复报错，换正文可重试且销毁后不补建', async () => {
    stubRangeLayout()
    vi.useFakeTimers()
    const create = vi.fn().mockRejectedValue(new Error('chunk unavailable'))
    vi.spyOn(segmentedDocument, 'createSegmentedDocumentReader').mockReturnValue({ create })
    const error = vi.fn()
    const renderer = createDomRenderer()
    const handle = mountRenderer(renderer, { element: document.createElement('div'), props: { initialContent: '<p>正文</p>' }, on: { error } })
    try {
      handle.editor.commands.setContent(`<p data-block-id="large_failed">${'x'.repeat(500001)}</p>`)
      await vi.advanceTimersByTimeAsync(500)
      await vi.dynamicImportSettled()
      await vi.advanceTimersByTimeAsync(1000)
      expect(create).toHaveBeenCalledOnce()
      expect(error).toHaveBeenCalledOnce()
      handle.nativeHost.host.helpOpen = true
      await vi.advanceTimersByTimeAsync(500)
      expect(create).toHaveBeenCalledOnce()
      handle.editor.commands.insertContentAt(2, '新')
      await vi.advanceTimersByTimeAsync(500)
      expect(create).toHaveBeenCalledTimes(2)
      handle.editor.commands.insertContentAt(2, '未完成')
      renderer.destroy(handle)
      await vi.advanceTimersByTimeAsync(1000)
      expect(create).toHaveBeenCalledTimes(2)
    } finally { renderer.destroy(handle); vi.useRealTimers() }
  })

  it('partial config patch 保留未修改的布局与网络段，文档操作入口不丢失', async () => {
    const host = document.createElement('div')
    const renderer = createDomRenderer()
    const handle = mountRenderer(renderer, {
      element: host,
      props: {
        initialContent: '<p>正文</p>',
        config: { layout: { headerVisible: false, toolbarFixed: true }, network: { mode: 'allowlist', allowlist: ['example.com'] } },
      },
    })
    await Promise.resolve()
    expect(renderer.getRoot(handle).querySelector('[aria-label="文档操作"]')).not.toBeNull()
    renderer.update(handle, { config: { features: { marks: false } } })
    await Promise.resolve()
    expect(handle.state.editorConfig.layout.headerVisible).toBe(false)
    expect(handle.state.editorConfig.layout.toolbarFixed).toBe(true)
    expect(handle.state.editorConfig.network).toEqual({ mode: 'allowlist', allowlist: ['example.com'] })
    expect(renderer.getRoot(handle).querySelector('[aria-label="文档操作"]')).not.toBeNull()
    expect(renderer.getRoot(handle).querySelector('.lark-doc-mark-bold')).toBeNull()
    renderer.destroy(handle)
  })

  it('mount/index 默认使用 DOM，Vue renderer 必须由宿主显式注入', () => {
    expect(createRenderer().name).toBe('dom-migration')
    expect(() => createRenderer({ renderer: 'vue2' })).toThrow(/隔离/)
    expect(createRenderer({ rendererFactory: createDomRenderer }).name).toBe('dom-migration')
    expect(typeof setRenderer).toBe('function')
    setRenderer(null)
  })
})


describe('真实工作台导入导出配置', () => {
  it('初始化与热更新均采用独立开关、格式白名单和文案，保持同一编辑器', async () => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, storage: 'none', content: '<p>保留正文</p>', config: {
      importExport: { importFormats: ['json'], exportFormats: ['json'], importLabel: '读取 JSON', exportLabel: '保存 JSON' },
    } })
    try {
      const editor = doc.getEditor()
      await vi.waitFor(() => expect(element.querySelector('input[aria-label="导入文档"]')?.accept).toBe('.json'))
      // 「文档操作」弹窗内不放原生 title（会弹黑底提示）：导入按钮只靠可见文案标识。
      const importButton = Array.from(element.querySelectorAll('.lark-doc-workspace-actions button'))
        .find(b => b.textContent.trim() === '读取 JSON')
      expect(importButton).toBeTruthy()
      expect(importButton.getAttribute('title')).toBeNull()
      const trigger = element.querySelector('[role="combobox"][aria-label="导出文档格式"]')
      expect(trigger.textContent).toContain('保存 JSON')
      trigger.click()
      expect(Array.from(element.querySelectorAll('[role="listbox"][aria-label="导出文档格式"] .lark-doc-select-item-label')).map(item => item.textContent)).toEqual(['保存 JSON', 'JSON（完整正文）'])
      doc.patchProps({ config: { importExport: { importEnabled: false, exportEnabled: false } } })
      await vi.waitFor(() => {
        expect(element.querySelector('input[aria-label="导入文档"]')).toBeNull()
        expect(element.querySelector('[role="combobox"][aria-label="导出文档格式"]')).toBeNull()
      })
      expect(doc.getEditor()).toBe(editor)
      expect(doc.getText()).toBe('保留正文')
    } finally { doc.destroy(); element.remove() }
  })
})


describe('真实门面媒体 HTML 回传', () => {
  it.each(['inline', 'link'])('%s 的 update/change 与 getHTML 一致，编辑器内仍保留媒体节点', async htmlMode => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, storage: 'none',
      content: '<p>正文</p><img src="data:image/png;base64,cG5n" alt="示例图片">',
      config: { media: { htmlMode }, performance: { changeDebounce: 0 } },
    })
    const updates = []
    const changes = []
    doc.on('update', event => updates.push(event))
    doc.on('change', event => changes.push(event))
    try {
      doc.getEditor().commands.insertContent('追加')
      await vi.waitFor(() => expect(changes.length).toBeGreaterThan(0))
      for (const event of [updates[updates.length - 1], changes[changes.length - 1]]) {
        expect(event.html).toBe(doc.getHTML())
        expect(event.json).toEqual(doc.getJSON())
        expect(event.html.includes('<img')).toBe(htmlMode === 'inline')
      }
      expect(doc.getEditor().getHTML()).toContain('<img')
      expect(doc.getJSON().content.some(node => node.type === 'image')).toBe(true)
    } finally { doc.destroy(); element.remove() }
  })
})


it('两个真实编辑器之间点击插入按钮会关闭另一个编辑器的菜单', async () => {
  const elements = [document.createElement('div'), document.createElement('div')]
  elements.forEach(element => document.body.appendChild(element))
  const docs = elements.map(element => new LarkDoc({ element, storage: 'none', content: '<p>正文</p>' }))
  try {
    const firstHost = docs[0]._handle.nativeHost.host
    firstHost.openCommandMenu('plus')
    await Promise.resolve()
    expect(firstHost.menuOpen).toBe(true)
    const own = elements[0].querySelector('button[aria-label="插入"] .lark-doc-icon')
    own.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(firstHost.menuOpen).toBe(true)
    const other = elements[1].querySelector('button[aria-label="插入"] .lark-doc-icon')
    other.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(firstHost.menuOpen).toBe(false)
  } finally { docs.forEach(doc => doc.destroy()); elements.forEach(element => element.remove()) }
})


it('斜杠菜单连续 ArrowDown 与 Enter 使用当前高亮项', async () => {
  stubRangeLayout()
  const element = document.createElement('div')
  document.body.appendChild(element)
  const doc = new LarkDoc({ element, storage: 'none', content: '<p></p>', config: { commands: { allow: ['blockquote', 'diagram'] } } })
  try {
    const editor = doc.getEditor()
    editor.commands.insertContent('/')
    const host = doc._handle.nativeHost.host
    await vi.waitFor(() => expect(host.menuOpen).toBe(true))
    expect(host.filteredCommands.map(item => item.id)).toEqual(['diagram', 'blockquote'])
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(doc.getJSON().content.some(node => node.type === 'blockquote')).toBe(true)
    expect(doc.getJSON().content.some(node => node.type === 'codeBlock')).toBe(false)
  } finally { doc.destroy(); element.remove() }
})


it('媒体配置热更新后 getConfig/getHTML 与实际 update/change 保持一致', async () => {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const doc = new LarkDoc({ element, storage: 'none', content: '<p>正文</p><img src="data:image/png;base64,cG5n" alt="原图">' })
  const events = { update: [], change: [] }
  Object.keys(events).forEach(name => doc.on(name, event => events[name].push(event)))
  try {
    const editor = doc.getEditor()
    const before = doc.getJSON()
    expect(doc.getConfig().media.htmlMode).toBe('inline')
    for (const htmlMode of ['link', 'inline']) {
      doc.patchProps({ config: { media: { htmlMode }, performance: { changeDebounce: 0 } } })
      expect(doc.getConfig().media.htmlMode).toBe(htmlMode)
      expect(doc.getJSON()).toEqual(before)
      editor.commands.insertContent('继续编辑')
      await vi.waitFor(() => {
        for (const name of ['update', 'change']) {
          const event = events[name][events[name].length - 1]
          expect(event.html).toBe(doc.getHTML())
          expect(event.json).toEqual(doc.getJSON())
        }
      })
      expect(doc.getHTML().includes('<img')).toBe(htmlMode === 'inline')
      expect(editor.getHTML()).toContain('<img')
      editor.commands.undo()
    }
    expect(doc.getEditor()).toBe(editor)
  } finally { doc.destroy(); element.remove() }
})


it('无工作台 state 的自注入 renderer 继续读取初始化配置，单次 HTML 覆盖仍优先', () => {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const html = '<img src="https://example.test/a.png" alt="原图">'
  const workspace = { getHTML: () => html }
  const rendererFactory = () => ({
    mount: () => ({}), update() {}, destroy() {}, getInstance: () => workspace, getRoot: () => element,
  })
  const doc = new LarkDoc({ element, rendererFactory, storage: 'none', config: { media: { htmlMode: 'link' } } })
  try {
    expect(doc.getConfig()).toBe(doc.config)
    expect(doc.getConfig().media.htmlMode).toBe('link')
    expect(doc.getHTML()).toContain('<a href="https://example.test/a.png"')
    expect(doc.getHTML()).not.toContain('<img')
    expect(doc.getHTML({ media: { mode: 'inline' } })).toBe(html)
  } finally { doc.destroy(); element.remove() }
})

describe('v12e card keyboard editing', () => {
  it('opens the existing card editor for Cmd+K on a node-selected link card', () => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, content: { type: 'doc', content: [{ type: 'bookmark', attrs: { url: 'https://example.com', title: 'Example' } }] } })
    try {
      doc.getEditor().commands.setNodeSelection(0)
      const host = doc._handle.nativeHost.host
      host.openLinkDialog()
      expect(host._linkDialogTarget?.node.type.name).toBe('bookmark')
      expect(host.linkValue).toBe('https://example.com')
      expect(host.linkText).toBe('Example')
    } finally { doc.destroy(); element.remove() }
  })
})


describe('最终补全：文本与表格AI真实编辑器闭环', () => {
  function chatFixture(content = '<p>前文</p><p>需要改写的文字</p>') {
    stubRangeLayout()
    const requests = [], cancel = vi.fn()
    const aiProvider = { contentFormat: 'text', stream: args => { requests.push(args); return { cancel } } }
    const renderer = createDomRenderer()
    const handle = mountRenderer(renderer, { element: document.createElement('div'), props: { initialContent: content, aiProvider, storage: 'none' } })
    return { renderer, handle, root: renderer.getRoot(handle), editor: handle.editor, workspace: handle.workspaceController, requests, cancel }
  }
  it('工具栏 AI 入口直接按动作进结果面板，不再先开问答', async () => {
    const { handle, editor, workspace, requests, root } = chatFixture()
    const start = editor.state.doc.firstChild.nodeSize + 1
    editor.commands.setTextSelection({ from: start, to: start + '需要改写的文字'.length })
    handle.nativeHost.host.$emit('ai-request', 'rewrite')
    expect(workspace.state.aiSelectionChat).toBe(false)
    expect(requests).toHaveLength(1)
    expect(requests[0].action).toBe('rewrite')
    expect(requests[0].text).toBe('需要改写的文字')
    await vi.waitFor(() => expect(root.querySelectorAll('.lark-doc-ai-actions .lark-doc-ai-action')).toHaveLength(11))
  })

  it('切动作清空旧结果并按新动作重跑一次', async () => {
    const { handle, workspace, requests } = chatFixture()
    handle.nativeHost.host.$emit('ai-request', 'rewrite')
    expect(requests).toHaveLength(1)
    requests[0].onChunk('旧结果'); requests[0].onDone()
    expect(workspace.state.aiPreview).toBe('旧结果')
    workspace.switchAIAction('expand')
    expect(workspace.state.aiAction).toBe('expand')
    expect(requests).toHaveLength(2)
    expect(requests[1].action).toBe('expand')
    expect(workspace.state.aiPreview).toBe('')
  })

  it('UI改写入口先引用后提问，流式回复可替换映射后的选区且撤销保留前文', async () => {
    const { handle, editor, workspace, requests, root } = chatFixture()
    const start = editor.state.doc.firstChild.nodeSize + 1
    editor.commands.setTextSelection({ from: start, to: start + '需要改写的文字'.length })
    handle.nativeHost.host.$emit('ai-request', { action: 'chat' })
    expect(workspace.state.aiSelectionChat).toBe(true)
    expect(requests).toHaveLength(0)
    await vi.waitFor(() => expect(root.querySelector('[aria-label="AI 问答"]')).not.toBeNull())
    const original = editor.getJSON()
    workspace.state.aiPrompt = '简短改写'
    await workspace.sendAIChat()
    expect(requests).toHaveLength(1)
    expect(requests[0].text).toBe('需要改写的文字')
    requests[0].onChunk('改写回复'); requests[0].onDone()
    editor.commands.insertContentAt(1, '新前缀')
    expect(workspace.acceptAI('replace')).toBe(true)
    expect(editor.getText()).toContain('新前缀前文')
    expect(editor.getText()).toContain('改写回复')
    editor.commands.undo()
    expect(editor.getText()).toContain('需要改写的文字')
    expect(original.content[1].content[0].text).toBe('需要改写的文字')
  })
  it('矩形选区只引用选中格；表格回复只能插入表后，不能破坏未选单元格', async () => {
    const rows = Array.from({ length: 3 }, (_, r) => `<tr>${Array.from({ length: 3 }, (_, c) => `<td><p>R${r}C${c}</p></td>`).join('')}</tr>`).join('')
    const { editor, workspace, requests } = chatFixture('<table>' + rows + '</table><p>后文</p>')
    const cells = []
    editor.state.doc.descendants((node, pos) => { if (node.type.name === 'tableCell') cells.push(pos) })
    editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, cells[0], cells[4])))
    expect(workspace.openSelectionAI()).toBe(true)
    workspace.state.aiPrompt = '分析选中格'
    await workspace.sendAIChat()
    expect(requests[0].text).toBe('R0C0\nR0C1\nR1C0\nR1C1')
    expect(requests[0].context.ranges).toHaveLength(4)
    expect(JSON.stringify(requests[0].context.content)).not.toContain('R0C2')
    requests[0].onChunk('表格分析回复'); requests[0].onDone()
    const before = editor.getJSON().content.find(node => node.type === 'table')
    expect(workspace.acceptAI('replace')).toBe(false)
    expect(editor.getJSON().content.find(node => node.type === 'table')).toEqual(before)
    expect(workspace.acceptAI('insert')).toBe(true)
    expect(editor.getJSON().content.find(node => node.type === 'table')).toEqual(before)
    expect(editor.getText()).toContain('表格分析回复')
  })
  it('缺provider保持配置状态；撤销编辑权限后拒绝旧流回复与应用', async () => {
    const { workspace, editor, requests, cancel } = chatFixture()
    editor.commands.setTextSelection({ from: 1, to: 3 })
    workspace.openSelectionAI()
    workspace.state.aiPrompt = '描述选区'
    await workspace.sendAIChat()
    workspace.setReadonly(true)
    requests[0].onChunk('过期回复'); requests[0].onDone()
    expect(cancel).toHaveBeenCalled()
    expect(workspace.state.aiOpen).toBe(false)
    expect(workspace.state.aiPreview).toBe('')
    expect(editor.getText()).not.toContain('过期回复')
  })
  it('关闭重开问答后旧输入与IME事件不能写入新会话，流式更新保留当前输入节点', async () => {
    const { workspace, root } = chatFixture()
    workspace.openSelectionAI()
    await vi.waitFor(() => expect(root.querySelector('[aria-label="AI 问答消息"]')).not.toBeNull())
    const previous = root.querySelector('[aria-label="AI 问答消息"]')
    workspace.closeAI(); workspace.openSelectionAI()
    await vi.waitFor(() => expect(root.querySelector('[aria-label="AI 问答消息"]')).not.toBe(previous))
    previous.value = '旧会话迟到输入'
    previous.dispatchEvent(new Event('input', { bubbles: true }))
    previous.dispatchEvent(new Event('compositionend', { bubbles: true }))
    expect(workspace.state.aiPrompt).toBe('')
    const current = root.querySelector('[aria-label="AI 问答消息"]')
    current.value = '当前问题'
    current.dispatchEvent(new Event('input', { bubbles: true }))
    expect(workspace.state.aiPrompt).toBe('当前问题')
    await workspace.sendAIChat()
    await Promise.resolve()
    expect(root.querySelector('[aria-label="AI 问答消息"]')).toBe(current)
  })
  it('未配置provider的新问答不执行mock生成', async () => {
    const { workspace, handle } = chatFixture()
    handle.workspaceController.props.aiProvider = null
    workspace.openSelectionAI()
    workspace.state.aiPrompt = '不可伪生成'
    await workspace.sendAIChat()
    expect(workspace.state.aiRunning).toBe(false)
    expect(workspace.state.aiPreview).toBe('')
    expect(workspace.state.aiError).toContain('配置')
  })
})
