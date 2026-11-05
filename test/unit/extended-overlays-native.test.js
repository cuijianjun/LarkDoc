// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDomRenderer } from '../../src/mount/domRenderer'
import { createExtendedOverlays } from '../../src/ui/extendedOverlays'
import { LINK_HOVER_DELAY, LINK_VIEW_MODES } from '../../src/components/lark-doc/editor/linkHoverMixin'
import { TOPBAR_MORE_ITEMS, TOPBAR_MORE_SUBPANELS } from '../../src/components/lark-doc/editor/topbarMoreMixin'
import { CREATE_MENU_ROWS } from '../../src/components/lark-doc/editor/createMenuMixin'
import { requestCodeLangPicker } from '../../src/components/lark-doc/editor/codeLangSignal'
import { registerExternalProvider, resetExternalProviders } from '../../src/core/embed/provider-registry'

const cleanups = []
function mount(props = {}, on = {}) {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const renderer = createDomRenderer()
  const handle = renderer.mount({ element, props: { storage: 'none', initialContent: '<p>正文</p>', ...props }, on })
  cleanups.push(() => { renderer.destroy(handle); element.remove() })
  return { ...handle, renderer, handle, vm: handle.nativeHost.host, tick: () => handle.nativeHost.host.$nextTick() }
}
function press(node, key) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  node.dispatchEvent(event)
  return event
}
function down(node) {
  const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
  node.dispatchEvent(event)
  return event
}
async function settle(vm) {
  for (let i = 0; i < 10; i += 1) await Promise.resolve()
  await vm.$nextTick()
}
afterEach(() => {
  cleanups.splice(0).reverse().forEach(cleanup => cleanup())
  resetExternalProviders()
  vi.restoreAllMocks()
  vi.useRealTimers()
  localStorage.clear()
})

describe('六个旧 Vue 的原生宿主迁移', () => {
  it('新建保留全部混排行、图标和宿主事件，关闭早于事件派发', async () => {
    const create = vi.fn(() => expect(vm.createMenuOpen).toBe(false))
    const { vm, root, tick } = mount({}, { 'create-menu': create })
    for (const item of CREATE_MENU_ROWS.filter(row => row.kind === 'item')) {
      root.querySelector('.lark-doc-create-btn').click()
      await tick()
      const menu = root.querySelector('.lark-doc-create-menu')
      expect([...menu.firstChild.children].map(row => row.textContent)).toEqual(CREATE_MENU_ROWS.map(row => row.label || ''))
      expect(menu.querySelectorAll('[role="separator"]')).toHaveLength(1)
      expect(menu.querySelector('[role="presentation"]').textContent).toBe('文档应用')
      expect(vm.$refs.createMenuList).toBe(menu.firstChild)
      const row = menu.querySelector(`[data-create-menu-id="${item.id}"]`)
      expect(row.querySelector('.lark-doc-icon').style.width).toBe('16px')
      expect(!!row.querySelector('.lark-doc-create-menu-arrow')).toBe(!!item.arrow)
      row.click()
      await tick()
      expect(root.querySelector('.lark-doc-create-menu')).toBeNull()
      expect(create).toHaveBeenLastCalledWith({ id: item.id, label: item.label, action: item.action })
    }
    expect(create).toHaveBeenCalledTimes(11)
  })

  it('更多的 23 个一级项和全部子项仍分发至原 mixin 动作', async () => {
    const { vm, root, tick } = mount({ capabilities: { canManagePermission: true } })
    const action = vi.spyOn(vm, 'runTopbarMoreAction').mockImplementation(() => vm.closeTopbarMore())
    for (const item of TOPBAR_MORE_ITEMS) {
      root.querySelector('.lark-doc-more-btn').click()
      await tick()
      expect(root.querySelectorAll('.lark-doc-topbar-more-list [role="menuitem"]')).toHaveLength(23)
      expect(root.querySelectorAll('.lark-doc-topbar-more-list [role="separator"]')).toHaveLength(8)
      root.querySelector(`[data-topbar-more-id="${item.id}"]`).click()
      await tick()
      if (item.kind !== 'submenu') {
        expect(action).toHaveBeenLastCalledWith(item.action, expect.objectContaining({ id: item.id }))
        continue
      }
      expect(vm.topbarMoreSubmenu).toBe(item.id)
      const entries = TOPBAR_MORE_SUBPANELS[item.id].filter(entry => entry.kind !== 'divider')
      for (const entry of entries) {
        const submenu = root.querySelector('.lark-doc-topbar-more-submenu')
        expect(submenu.closest('.lark-doc-topbar-more')).not.toBeNull()
        expect(submenu.getAttribute('aria-label')).toBe(`更多-${item.id}`)
        const row = [...submenu.querySelectorAll('button')].find(button => button.textContent === entry.label)
        row.click()
        await tick()
        if (entry.kind === 'switch') {
          expect(row.getAttribute('aria-checked')).toBe('true')
          expect(row.querySelector('.is-on')).not.toBeNull()
          expect(vm.topbarMoreOpen).toBe(true)
        } else {
          expect(action).toHaveBeenLastCalledWith(entry.action, entry)
          vm.topbarMoreOpen = true
          vm.topbarMoreSubmenu = item.id
          await tick()
        }
      }
      vm.closeTopbarMore()
      await tick()
    }
  })

  it('更多仍执行内置能力并保留两个开关和未内置动作的宿主事件', async () => {
    const emitted = vi.fn()
    const duplicate = vi.fn()
    const { vm, root, tick } = mount({}, { 'topbar-more': emitted, 'duplicate-document': duplicate })
    const cases = [
      ['slides', 'toggleSlides', []], ['find', 'openSearch', ['find']],
      ['width.standard', 'setWidthMode', ['standard']], ['width.wide', 'setWidthMode', ['wide']], ['width.full', 'setWidthMode', ['full']],
      ['export.word', 'openExportDialog', ['word']], ['export.pdf', 'openExportDialog', ['pdf']], ['export.markdown', 'openExportDialog', ['markdown']],
      ['save-version', 'openSaveVersionDialog', []], ['version.open', 'openVersionPanel', []],
      ['permission.manage', 'toggleSharePopover', [null]], ['permission.settings', 'openPermissionDialog', []], ['print', 'printDocument', []],
    ]
    for (const [action, method, args] of cases) {
      const spy = vi.spyOn(vm, method).mockImplementation(() => {})
      vm.topbarMoreOpen = true
      vm.runTopbarMoreAction(action, {})
      expect(spy).toHaveBeenCalledWith(...args)
      expect(vm.topbarMoreOpen).toBe(false)
      spy.mockRestore()
    }
    vm.runTopbarMoreAction('duplicate', {})
    expect(duplicate).toHaveBeenCalledWith(expect.objectContaining({ document: vm.editor.getJSON() }))
    root.querySelector('.lark-doc-more-btn').click()
    await tick()
    root.querySelector('[data-topbar-more-id="more"]').dispatchEvent(new MouseEvent('mouseenter'))
    await tick()
    const switches = root.querySelectorAll('[role="menuitemcheckbox"]')
    switches[0].click()
    switches[1].click()
    await tick()
    expect(emitted).toHaveBeenCalledWith({ action: 'more.show-author', on: true })
    expect(emitted).toHaveBeenCalledWith({ action: 'more.offline', on: true })
    expect(vm.topbarMoreOpen).toBe(true)
    root.querySelector('[data-topbar-more-id="history"]').click()
    expect(emitted).toHaveBeenCalledWith(expect.objectContaining({ action: 'history' }))
  })

  it('菜单保留测量 ref、禁用语义、键盘导航和单层 Esc', async () => {
    const { vm, root, tick, nativeHost } = mount()
    root.querySelector('.lark-doc-more-btn').click()
    await tick()
    const menu = vm.$refs.topbarMoreMenu
    vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 100, right: 280, width: 180, height: 300 })
    vm.topbarMoreAnchor = { left: 300, right: 328, top: 10, bottom: 38 }
    vm.measureTopbarMore()
    await tick()
    expect(menu.style.left).toBe('148px')
    expect(menu.style.top).toBe('42px')
    press(menu, 'Home')
    expect(document.activeElement.dataset.topbarMoreId).toBe('width')
    press(document.activeElement, 'End')
    expect(document.activeElement.dataset.topbarMoreId).toBe('delete')
    vm.linkHoverOpen = true
    const event = press(document.activeElement, 'Escape')
    await tick()
    expect(event.defaultPrevented).toBe(true)
    expect(vm.topbarMoreOpen).toBe(false)
    expect(vm.linkHoverOpen).toBe(true)
    expect(document.activeElement).toBe(root.querySelector('.lark-doc-more-btn'))
    nativeHost.state.sessionInstance._capabilities.canExport = false
    vm.$forceUpdate()
    root.querySelector('.lark-doc-more-btn').click()
    await tick()
    const exportRow = root.querySelector('[data-topbar-more-id="download-as"]')
    expect(exportRow.disabled).toBe(true)
    expect(exportRow.getAttribute('data-capability')).toBe('canExport')
    expect(exportRow.getAttribute('aria-disabled')).toBe('true')
    exportRow.click()
    expect(vm.topbarMoreSubmenu).toBe('')
    vm.setMode('read')
    await tick()
    expect(root.querySelector('.lark-doc-create-btn').disabled).toBe(true)
    expect(root.querySelector('[data-topbar-more-id="delete"]').disabled).toBe(true)
  })

  it('链接延迟悬浮、全部视图、编辑删除与更多动作保持接线', async () => {
    vi.useFakeTimers()
    const view = vi.fn()
    const more = vi.fn()
    const { vm, root, tick } = mount({ initialContent: '<p><a href="https://example.com">链接文案</a></p>' }, { 'link-view': view, 'link-more': more })
    const anchor = root.querySelector('.ProseMirror a')
    anchor.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    await vi.advanceTimersByTimeAsync(LINK_HOVER_DELAY - 1)
    expect(vm.linkHoverOpen).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await tick()
    const card = root.querySelector('.lark-doc-link-hover-card')
    expect(card.querySelector('a').textContent).toBe('链接文案')
    expect(card.querySelector('a').rel).toBe('noopener noreferrer')
    for (const mode of LINK_VIEW_MODES) {
      card.querySelector('[data-name="link-to-title"]').click()
      await tick()
      const row = [...card.querySelectorAll('[role="menuitemradio"]')].find(item => item.textContent === mode.label)
      row.click()
      await tick()
      expect(view).toHaveBeenLastCalledWith({ href: anchor.getAttribute('href'), view: mode.id })
      expect(card.querySelector('.lark-doc-link-hover-view-text').textContent).toBe(mode.label)
    }
    card.querySelector('[data-name="more"]').click()
    expect(more).toHaveBeenCalledWith({ href: anchor.getAttribute('href') })
    vm.openLinkHover(anchor)
    await tick()
    const open = vi.spyOn(vm, 'openLinkDialog').mockImplementation(() => {})
    root.querySelector('[data-name="edit-link"]').click()
    expect(open).toHaveBeenCalledWith(true)
    expect(vm.linkValue).toBe(anchor.getAttribute('href'))
    const run = vi.spyOn(vm, 'run').mockImplementation(() => true)
    vm.openLinkHover(anchor)
    await tick()
    root.querySelector('[data-name="delete-link"]').click()
    expect(run).toHaveBeenCalledWith('unsetLink')
    vm.setMode('read')
    vm.openLinkHover(anchor)
    await tick()
    expect(root.querySelector('[data-name="delete-link"]').disabled).toBe(true)
    expect(press(root.querySelector('[data-name="edit-link"]'), 'Escape').defaultPrevented).toBe(true)
    expect(vm.linkHoverOpen).toBe(false)
  })

  it('确认框完整保留勾选、回调、Promise、三条取消通路与卸载结算', async () => {
    const { vm, root, tick, renderer, handle } = mount()
    const accept = vi.fn(checked => { expect(vm.confirmOpen).toBe(false); expect(checked).toBe(true) })
    const result = vm.confirmDialog({ title: '<img src=x>', body: '操作说明', extra: '不再提示', confirmText: '继续', cancelText: '返回', onConfirm: accept })
    await tick()
    expect(root.querySelector('.lark-doc-confirm-title').textContent).toBe('<img src=x>')
    expect(root.querySelector('.lark-doc-confirm-title img')).toBeNull()
    expect(down(root.querySelector('.lark-doc-confirm-extra')).defaultPrevented).toBe(true)
    await tick()
    expect(root.querySelector('.lark-doc-confirm-extra').getAttribute('aria-pressed')).toBe('true')
    expect(down(root.querySelector('.lark-doc-confirm-btn.is-primary')).defaultPrevented).toBe(true)
    await expect(result).resolves.toBe(true)
    expect(accept).toHaveBeenCalledTimes(1)
    for (const close of [
      () => down(root.querySelector('.lark-doc-confirm-btn.is-plain')),
      () => down(root.querySelector('.lark-doc-confirm-mask')),
      () => press(root.querySelector('.lark-doc-confirm-btn'), 'Escape'),
    ]) {
      const pending = vm.confirmDialog({ onConfirm: accept })
      vm.relationOpen = true
      await tick()
      close()
      await expect(pending).resolves.toBe(false)
      expect(vm.relationOpen).toBe(true)
    }
    const replaced = vm.confirmDialog({})
    const pending = vm.confirmDialog({})
    await expect(replaced).resolves.toBe(false)
    renderer.destroy(handle)
    await expect(pending).resolves.toBe(false)
    expect(vm.$refs.codeLangInput).toBeUndefined()
    expect(vm.$refs.createMenu).toBeUndefined()
  })

  it('关联表格保留异步两步选择、返回、选中摘要和插入动作', async () => {
    const listBases = vi.fn(async () => [{ appToken: 'base-1', name: '项目', ownerName: '作者' }])
    const listTables = vi.fn(async () => [{ tableId: 'table-1', name: '任务' }])
    registerExternalProvider({ name: 'bitable', handlers: { listBases, listTables } })
    const confirmed = vi.fn()
    const { vm, root, tick } = mount({}, { 'relation-bitable-confirmed': confirmed })
    const run = vi.spyOn(vm, 'run').mockImplementation(() => expect(vm.relationOpen).toBe(false))
    vm.openRelationBitable()
    await tick()
    expect(root.querySelector('.lark-doc-relation-body').getAttribute('aria-busy')).toBe('true')
    await settle(vm)
    expect(root.querySelector('.lark-doc-relation-item-owner').textContent).toBe('所有者: 作者')
    expect(down(root.querySelector('.lark-doc-relation-item')).defaultPrevented).toBe(true)
    await settle(vm)
    expect(listTables).toHaveBeenCalledWith({ appToken: 'base-1' })
    down(root.querySelector('.lark-doc-relation-back'))
    await tick()
    expect(vm.relationStep).toBe('base')
    press(root.querySelector('.lark-doc-relation-item'), 'Enter')
    await settle(vm)
    down(root.querySelector('.lark-doc-relation-item'))
    await tick()
    expect(root.querySelector('.lark-doc-relation-selection').textContent).toBe('已选：项目 / 任务')
    expect(root.querySelector('.lark-doc-relation-btn.is-primary').disabled).toBe(false)
    down(root.querySelector('.lark-doc-relation-btn.is-primary'))
    expect(run).toHaveBeenCalledWith('setBitable', expect.objectContaining({ reference: { appToken: 'base-1', tableId: 'table-1', name: '任务' } }))
    expect(confirmed).toHaveBeenCalledWith({ appToken: 'base-1', tableId: 'table-1' })
  })

  it.each(['missing', 'empty', 'error'])('关联表格的 %s 状态可解释，取消和 Esc 不插入', async status => {
    if (status !== 'missing') registerExternalProvider({ name: 'bitable', handlers: { listBases: status === 'error' ? async () => { throw new Error('加载失败') } : async () => [] } })
    const { vm, root, tick } = mount()
    const run = vi.spyOn(vm, 'run')
    for (const close of [
      () => down(root.querySelector('.lark-doc-relation-mask')),
      () => down(root.querySelector('.lark-doc-relation-btn.is-plain')),
      () => press(root.querySelector('.lark-doc-relation-btn'), 'Escape'),
    ]) {
      vm.openRelationBitable()
      await settle(vm)
      expect(root.querySelector('.lark-doc-relation-empty').textContent).toContain(status === 'missing' ? '尚未接入' : status === 'empty' ? '还没有' : '加载失败')
      expect(root.querySelector('.lark-doc-relation-btn.is-primary').disabled).toBe(true)
      close()
      await tick()
      expect(vm.relationOpen).toBe(false)
    }
    expect(run).not.toHaveBeenCalled()
  })

  it('代码块通过信号打开原生语言选择器，搜索、键盘、鼠标与卸载退订均有效', async () => {
    const { vm, root, editor, tick, renderer, handle } = mount({ initialContent: '<pre><code>const value = 1</code></pre>' })
    const rect = { left: 100, right: 200, top: 100, bottom: 130 }
    requestCodeLangPicker({ editor: {}, pos: 0, language: 'plaintext', rect })
    await tick()
    expect(vm.codeLangOpen).toBe(false)
    requestCodeLangPicker({ editor, pos: 0, language: 'plaintext', rect, diagramEnabled: false })
    await tick()
    const input = root.querySelector('.lark-doc-code-lang-search-input')
    expect(vm.$refs.codeLangInput).toBe(input)
    expect(document.activeElement).toBe(input)
    expect(root.querySelectorAll('[role="option"]')).toHaveLength(71)
    input.value = 'java'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()
    expect(root.querySelectorAll('[role="option"]')).toHaveLength(2)
    press(input, 'ArrowUp')
    expect(root.querySelector('.is-cursor .lark-doc-code-lang-text').textContent).toBe('JavaScript')
    press(input, 'Enter')
    await tick()
    expect(editor.state.doc.firstChild.attrs.language).toBe('javascript')
    expect(editor.state.doc.textContent).toBe('const value = 1')
    expect(vm.codeLangOpen).toBe(false)
    requestCodeLangPicker({ editor, pos: 0, language: 'javascript', rect })
    await tick()
    input.value = 'zzzz'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()
    expect(root.querySelectorAll('[role="option"]')).toHaveLength(0)
    expect(() => press(input, 'Enter')).not.toThrow()
    vm.setCodeLangQuery('plain')
    await tick()
    root.querySelector('[role="option"]').click()
    expect(editor.state.doc.firstChild.attrs.language).toBe('plaintext')
    requestCodeLangPicker({ editor, pos: 0, language: 'plaintext', rect })
    await tick()
    vm.topbarMoreOpen = true
    press(input, 'Escape')
    expect(vm.codeLangOpen).toBe(false)
    expect(vm.topbarMoreOpen).toBe(true)
    renderer.destroy(handle)
    requestCodeLangPicker({ editor, pos: 0, language: 'go', rect })
    expect(root.querySelector('.lark-doc-code-lang')).toBeNull()
    expect(vm._codeLangOff).toBeNull()
  })

  it('扩展浮层只挂摘自己的节点，不影响共享宿主的其它 UI', () => {
    const host = document.createElement('div')
    const sibling = document.createElement('aside')
    host.appendChild(sibling)
    const ui = createExtendedOverlays({ host })
    ui.update({ confirmOpen: true, relationOpen: true, linkHoverOpen: true, codeLangOpen: true })
    expect(host.children).toHaveLength(5)
    ui.update({})
    expect([...host.children]).toEqual([sibling])
    ui.destroy()
    expect([...host.children]).toEqual([sibling])
  })
})
