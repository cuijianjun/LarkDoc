// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TextSelection } from '@tiptap/pm/state'
import { undo } from '@tiptap/pm/history'
import { createCommentComposer } from '../../src/ui/commentComposer'
import { createTopBar } from '../../src/ui/topBar'
import { createCommentPanel } from '../../src/ui/panels'
import toolbarUiMixin from '../../src/components/lark-doc/editor/toolbarUiMixin'
import { runDocumentMenuAction } from '../../src/components/lark-doc/editor/documentMenuView'
import commentsMixin from '../../src/components/lark-doc/editor/commentsMixin'
import { createCommentInteraction } from '../../src/components/lark-doc/editor/commentInteraction'
import panelsUiMixin from '../../src/components/lark-doc/editor/panelsUiMixin'
import { createMobileLibrary } from '../../src/ui/mobileLibrary'
import { LarkDoc } from '../../src/LarkDoc'
import { createMemoryCommentsProvider } from '../../src/core/comments/memory-provider'

const editors = []
beforeEach(() => {
  vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [{ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }] })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => ({ left: 0, right: 1, top: 0, bottom: 1, width: 1, height: 1 }) })
})

describe('mobile header overflow', () => {
  it('leaves unrelated comment notices unchanged when library navigation fails', async () => {
    const authorization = { searchDocuments: vi.fn() }
    const session = { documentId: 'source', user: { id: 'alice' }, can: () => true, getProvider: name => name === 'authorization' ? authorization : undefined }
    const ed = { session, commentCan: () => true, commentOperationCurrent: () => () => true,
      onDocumentAction: vi.fn(async () => false), commentMessage: 'Existing comment notice' }
    expect(await toolbarUiMixin.methods.openMobileLibraryDocument.call(ed, 'target')).toBe(false)
    expect(ed.commentMessage).toBe('Existing comment notice')
    expect(ed.onDocumentAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'open-document-reference', documentId: 'target' }))
  })
  it('serializes library navigation until the current host handoff settles', async () => {
    const width = window.innerWidth; Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    const host = document.createElement('div'), trigger = document.createElement('button'); document.body.append(host, trigger)
    let finish
    const openDocument = vi.fn(() => new Promise(resolve => { finish = resolve }))
    const ui = createMobileLibrary({ host, trigger, scope: () => ({ current: () => true, provider: { searchDocuments: async () => ({ items: [{ docId: 'found', displayName: 'Found' }] }) } }), directory: async () => ({ status: 'resolved', items: [{ docId: 'first', displayName: 'First' }, { docId: 'second', displayName: 'Second' }] }), openDocument }); editors.push(ui)
    try {
      ui.update({}); ui.open(); for (let i = 0; i < 12; i++) await Promise.resolve()
      const rows = [...ui.el.querySelectorAll('.lark-doc-mobile-library-row')]
      rows[0].click(); rows[1].click()
      expect(openDocument).toHaveBeenCalledTimes(1); expect(rows[1].disabled).toBe(true)
      expect(ui.el.querySelector('[role="tree"]').getAttribute('aria-busy')).toBe('true')
      finish(false); for (let i = 0; i < 12; i++) await Promise.resolve()
      expect(rows.every(row => !row.disabled)).toBe(true)
      expect(ui.el.textContent).toContain('暂时无法打开该文档')
      rows[0].click()
      const input = ui.el.querySelector('input'); input.value = 'Found'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
      for (let i = 0; i < 12; i++) await Promise.resolve()
      const found = ui.el.querySelector('.lark-doc-mobile-library-row'); expect(found.disabled).toBe(true)
      found.click(); expect(openDocument).toHaveBeenCalledTimes(2)
      finish(false); for (let i = 0; i < 12; i++) await Promise.resolve()
      expect(found.disabled).toBe(false); expect(ui.el.querySelector('[role="status"]').textContent).toBe('')
    } finally { ui.destroy(); host.remove(); trigger.remove(); Object.defineProperty(window, 'innerWidth', { configurable: true, value: width }) }
  })
  it('resets focused library search controls when closing and reopening the drawer', async () => {
    const width = window.innerWidth; Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    const host = document.createElement('div'), trigger = document.createElement('button'); document.body.append(host, trigger)
    const ui = createMobileLibrary({ host, trigger, scope: () => ({ current: () => true }), directory: async () => ({ status: 'resolved', items: [] }) }); editors.push(ui)
    try {
      ui.update({}); ui.open()
      const input = ui.el.querySelector('input'), cancel = [...ui.el.querySelectorAll('button')].find(e => e.textContent === '取消')
      input.focus(); expect(cancel.hidden).toBe(false); expect(input.placeholder).toBe('输入关键词')
      input.value = 'old query'; ui.close(); ui.open()
      expect(input.value).toBe(''); expect(input.placeholder).toBe('搜索'); expect(cancel.hidden).toBe(true)
      expect(document.activeElement.getAttribute('aria-label')).toBe('收起知识库目录')
    } finally { ui.destroy(); host.remove(); trigger.remove(); Object.defineProperty(window, 'innerWidth', { configurable: true, value: width }) }
  })
  it('keeps a document icon and complete accessible title on navigable library branches', async () => {
    const width = window.innerWidth; Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    const host = document.createElement('div'), trigger = document.createElement('button'); document.body.append(host, trigger)
    const title = 'Long knowledge document '.repeat(8)
    const ui = createMobileLibrary({ host, trigger, scope: () => ({ current: () => true }), directory: async () => ({ status: 'resolved', items: [{ docId: 'branch', displayName: title, children: [{ docId: 'child', displayName: 'Child' }] }] }) }); editors.push(ui)
    try {
      ui.update({}); ui.open(); for (let i = 0; i < 12; i++) await Promise.resolve()
      const row = ui.el.querySelector('.lark-doc-mobile-library-row')
      expect(row.querySelector('svg rect')).not.toBeNull()
      expect(row.querySelector('.lark-doc-mobile-library-label')?.textContent).toBe(title)
      const expand = ui.el.querySelector('.lark-doc-mobile-library-expand'); expand.click()
      expect(expand.getAttribute('aria-label')).toBe(`收起 ${title}`)
    } finally { ui.destroy(); host.remove(); trigger.remove(); Object.defineProperty(window, 'innerWidth', { configurable: true, value: width }) }
  })
  it('distinguishes a configured mobile handoff failure from a missing integration', async () => {
    const width = window.innerWidth; Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    const host = document.createElement('div'), overlay = document.createElement('div'); document.body.append(host, overlay)
    const handler = vi.fn(), ui = createTopBar({ host, overlayHost: overlay, handlers: { mobileHostAction: async () => false } }); editors.push(ui)
    try {
      ui.update({ referenceMobileMenu: true, mobileHostHandler: handler })
      host.querySelector('.lark-doc-mobile-actions-toggle').click(); overlay.querySelector('.lark-doc-mobile-reference-items button').click()
      for (let i = 0; i < 12; i++) await Promise.resolve()
      expect(overlay.querySelector('[role="status"]').textContent).toBe('操作未完成，请重试。')
      ui.update({ referenceMobileMenu: true, mobileHostHandler: handler })
      expect(host.querySelector('.lark-doc-mobile-actions-toggle').getAttribute('aria-expanded')).toBe('true')
      ui.update({ referenceMobileMenu: true }); host.querySelector('.lark-doc-mobile-actions-toggle').click(); overlay.querySelector('.lark-doc-mobile-reference-items button').click()
      for (let i = 0; i < 12; i++) await Promise.resolve()
      expect(overlay.querySelector('[role="status"]').textContent).toBe('宿主尚未配置飞书打开方式。')
    } finally { ui.destroy(); host.remove(); overlay.remove(); Object.defineProperty(window, 'innerWidth', { configurable: true, value: width }) }
  })
  it('restores a pending mobile action after a disabled touch drops focus to body', async () => {
    const width = window.innerWidth; Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    const host = document.createElement('div'), overlay = document.createElement('div'); document.body.append(host, overlay)
    let finish
    const ui = createTopBar({ host, overlayHost: overlay, handlers: { mobileHostAction: () => new Promise(resolve => { finish = resolve }) } }); editors.push(ui)
    try {
      ui.update({ referenceMobileMenu: true, mobileHostHandler: () => {} }); host.querySelector('.lark-doc-mobile-actions-toggle').click()
      const action = overlay.querySelector('.lark-doc-mobile-reference-items button'); action.click()
      expect(action.disabled).toBe(true)
      document.activeElement.blur(); expect(document.activeElement).toBe(document.body)
      finish(false); for (let i = 0; i < 12; i++) await Promise.resolve()
      expect(document.activeElement).toBe(action)
    } finally { ui.destroy(); host.remove(); overlay.remove(); Object.defineProperty(window, 'innerWidth', { configurable: true, value: width }) }
  })
  it('preserves navigable document branches and discards retired library results', async () => {
    const width = window.innerWidth; Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    const host = document.createElement('div'), trigger = document.createElement('button'); document.body.append(host, trigger)
    let current = true, finish
    const searchDocuments = vi.fn(() => new Promise(resolve => { finish = resolve })), openDocument = vi.fn(async () => false)
    const ui = createMobileLibrary({ host, trigger, scope: () => ({ current: () => current, provider: { searchDocuments } }), directory: async () => ({ status: 'resolved', items: [{ docId: 'doc', displayName: 'Current', children: [{ docId: 'child', displayName: 'Child' }] }] }), openDocument, openSdk: vi.fn() }); editors.push(ui)
    try {
      ui.update({ currentDocumentId: 'doc', title: 'Current' }); ui.open()
      for (let i = 0; i < 12; i++) await Promise.resolve()
      expect(ui.el.querySelector('[aria-current="page"]').textContent).toContain('Current')
      ui.el.querySelector('[aria-label="展开 Current"]').click()
      expect(ui.el.querySelector('[role="group"]').hidden).toBe(false)
      ui.el.querySelector('[aria-current="page"]').click()
      for (let i = 0; i < 12; i++) await Promise.resolve()
      expect(openDocument).toHaveBeenCalledWith('doc')
      const input = ui.el.querySelector('input'); input.value = 'Secret'; input.dispatchEvent(new Event('input')); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
      current = false; ui.update({ currentDocumentId: 'other', title: 'Other' })
      finish({ items: [{ docId: 'secret', displayName: 'Secret old result' }] })
      for (let i = 0; i < 12; i++) await Promise.resolve()
      expect(ui.el.isConnected).toBe(false); expect(ui.el.textContent).not.toContain('Secret old result')
    } finally { ui.destroy(); host.remove(); trigger.remove(); Object.defineProperty(window, 'innerWidth', { configurable: true, value: width }) }
  })
  it('keeps library keyboard retry focus on a stable drawer control', async () => {
    const width = window.innerWidth; Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    const host = document.createElement('div'), trigger = document.createElement('button'); document.body.append(host, trigger)
    let finish
    const directory = vi.fn().mockRejectedValueOnce(new Error('unavailable')).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const ui = createMobileLibrary({ host, trigger, scope: () => ({ current: () => true }), directory, openDocument: vi.fn(), openSdk: vi.fn() }); editors.push(ui)
    try {
      ui.update({ currentDocumentId: 'doc', title: 'Current' }); ui.open()
      for (let i = 0; i < 12; i++) await Promise.resolve()
      const retry = [...ui.el.querySelectorAll('button')].find(e => e.textContent === '重试'); expect(retry.hidden).toBe(false)
      retry.focus(); retry.click()
      expect(document.activeElement.getAttribute('aria-label')).toBe('收起知识库目录')
      finish({ status: 'resolved', items: [] })
      for (let i = 0; i < 12; i++) await Promise.resolve()
      expect(ui.el.textContent).toContain('未找到文档'); expect(document.activeElement.getAttribute('aria-label')).toBe('收起知识库目录')
    } finally { ui.destroy(); host.remove(); trigger.remove(); Object.defineProperty(window, 'innerWidth', { configurable: true, value: width }) }
  })
  it('separates the H5 library and more menu from the retained SDK actions', async () => {
    const width = window.innerWidth; Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    const host = document.createElement('div'), overlay = document.createElement('div'), outline = vi.fn()
    document.body.append(host, overlay)
    const scope = { session: { documentId: 'doc' }, current: () => true, provider: { searchDocuments: vi.fn(async () => ({ items: [{ docId: 'doc', displayName: 'Current' }] })) } }
    const ui = createTopBar({ host, overlayHost: overlay, handlers: { libraryScope: () => scope, libraryDirectory: async () => null, openLibraryDocument: async () => true, toggleOutline: outline } }); editors.push(ui)
    try {
      ui.update({ referenceMobileMenu: true, libraryEnabled: true, currentDocumentId: 'doc', title: 'Current', modeOptions: [] })
      host.querySelector('.lark-doc-mobile-outline').click()
      for (let i = 0; i < 12; i++) await Promise.resolve()
      const library = overlay.querySelector('[role="dialog"][aria-label="我的文档库"]')
      expect(library).not.toBeNull(); expect(outline).not.toHaveBeenCalled()
      expect(library.querySelector('[aria-current="page"]').textContent).toContain('Current')
      const input = library.querySelector('input'); input.value = 'Cur'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      for (let i = 0; i < 12; i++) await Promise.resolve()
      expect(scope.provider.searchDocuments).toHaveBeenCalledWith({ query: 'Cur' })
      library.querySelector('[aria-label="文档功能"]').click()
      expect(host.querySelector('.lark-doc-topbar').classList.contains('is-mobile-actions-open')).toBe(true)
      expect(overlay.querySelector('[aria-label="我的文档库"]')).toBeNull()
      host.querySelector('.lark-doc-mobile-actions-cancel').click()
      host.querySelector('.lark-doc-mobile-actions-toggle').click()
      const more = overlay.querySelector('[role="dialog"][aria-label="更多文档操作"]')
      expect(more).not.toBeNull()
      expect([...more.querySelectorAll('button')].map(e => e.textContent)).toEqual(['用飞书打开', '举报', '取消'])
      more.querySelector('[aria-label="取消更多操作"]').click()
      expect(document.activeElement).toBe(host.querySelector('.lark-doc-mobile-actions-toggle'))
    } finally { ui.destroy(); host.remove(); overlay.remove(); Object.defineProperty(window, 'innerWidth', { configurable: true, value: width }) }
  })
  it('keeps the share fallback when the mobile member entry is disabled or the header is removed', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const ui = createTopBar({ host, handlers: { openMembers: vi.fn() } }); editors.push(ui)
    ui.update({ membersEnabled: true })
    expect(host.classList.contains('has-mobile-members-entry')).toBe(true)
    ui.update({ membersEnabled: false })
    expect(host.classList.contains('has-mobile-members-entry')).toBe(false)
    ui.update({ membersEnabled: true, headerVisible: false })
    expect(host.classList.contains('has-mobile-members-entry')).toBe(false)
    ui.update({ membersEnabled: true })
    ui.destroy()
    expect(host.classList.contains('has-mobile-members-entry')).toBe(false)
    host.remove()
  })
  it('projects the current mobile document title before the body while retaining cover and desktop structure', () => {
    const width = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    const host = document.createElement('div'), paper = document.createElement('div'), cover = document.createElement('div'), body = document.createElement('div')
    body.className = 'lark-doc-editor-content'; paper.append(cover, body); host.append(paper); document.body.append(host)
    const ui = createTopBar({ host, paperHost: paper }); editors.push(ui)
    try {
      ui.update({ title: '当前文档 <img src=x>', readonly: true })
      const title = paper.querySelector('h1')
      expect(title?.textContent).toBe('当前文档 <img src=x>')
      expect(title.querySelector('img')).toBeNull()
      const header = paper.querySelector('.lark-doc-mobile-document-header')
      expect(header.previousSibling).toBe(cover); expect(header.nextSibling).toBe(body)
      expect(title.parentNode.querySelector('[aria-label="文内目录"]')).not.toBeNull()
      ui.update({ title: '新的文档' }); expect(title.textContent).toBe('新的文档')
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 }); window.dispatchEvent(new Event('resize'))
      expect(paper.children).toHaveLength(2)
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 }); window.dispatchEvent(new Event('resize'))
      expect(paper.querySelector('h1').textContent).toBe('新的文档')
      ui.destroy(); expect(paper.children).toHaveLength(2)
    } finally { ui.destroy(); host.remove(); Object.defineProperty(window, 'innerWidth', { configurable: true, value: width }) }
  })

  it('consumes Escape on a listbox option before the editor root can steal focus', () => {
    const width = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    const host = document.createElement('div'), body = document.createElement('button')
    body.textContent = '正文'; document.body.append(host, body)
    const ui = createTopBar({ host }); editors.push(ui)
    host.addEventListener('keydown', event => { if (event.key === 'Escape') body.focus() })
    try {
      ui.update({ mode: 'edit', modeLabel: '编辑', modeOptions: [{ id: 'edit', label: '编辑' }, { id: 'view', label: '阅读' }] })
      const toggle = host.querySelector('.lark-doc-mobile-actions-toggle'), trigger = host.querySelector('.lark-doc-mode-select button')
      toggle.click(); trigger.click()
      const option = host.querySelector('[role="option"]'); option.focus()
      option.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      expect(toggle.getAttribute('aria-expanded')).toBe('true')
      expect(trigger.getAttribute('aria-expanded')).toBe('false'); expect(document.activeElement).toBe(trigger)
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      expect(toggle.getAttribute('aria-expanded')).toBe('false')
    } finally { ui.destroy(); host.remove(); body.remove(); Object.defineProperty(window, 'innerWidth', { configurable: true, value: width }) }
  })

  it('keeps focus in the open sheet when the focused mode is removed or disabled', () => {
    const width = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    const host = document.createElement('div'), actionsHost = document.createElement('div')
    actionsHost.innerHTML = '<button>宿主功能</button>'; document.body.append(host)
    const ui = createTopBar({ host, actionsHost }); editors.push(ui)
    try {
      const state = { mode: 'edit', modeLabel: '编辑', modeOptions: [{ id: 'edit', label: '编辑' }, { id: 'view', label: '阅读' }] }
      ui.update(state)
      host.querySelector('.lark-doc-mobile-actions-toggle').click()
      expect(document.activeElement).toBe(host.querySelector('.lark-doc-mode-select button'))
      ui.update({ ...state, modeVisible: false })
      expect(document.activeElement).toBe(actionsHost.firstElementChild)
      ui.update(state); host.querySelector('.lark-doc-mode-select button').focus()
      ui.update({ ...state, modeSwitchable: false })
      expect(document.activeElement).toBe(actionsHost.firstElementChild)
    } finally { ui.destroy(); host.remove(); Object.defineProperty(window, 'innerWidth', { configurable: true, value: width }) }
  })

  it('lets a host child menu consume Escape before dismissing and clearing the sheet', () => {
    const width = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    const host = document.createElement('div'), actionsHost = document.createElement('div')
    actionsHost.innerHTML = '<button aria-haspopup="menu" aria-expanded="false">主题</button><div role="menu" hidden><button>浅色</button></div>'
    const [trigger, menu] = actionsHost.children, choice = menu.firstElementChild
    trigger.onclick = () => { menu.hidden = false; trigger.setAttribute('aria-expanded', 'true'); choice.focus() }
    menu.onkeydown = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); menu.hidden = true; trigger.setAttribute('aria-expanded', 'false'); trigger.focus() } }
    actionsHost.addEventListener('lark-doc-actions-dismiss', () => { menu.hidden = true; trigger.setAttribute('aria-expanded', 'false') })
    document.body.append(host)
    const ui = createTopBar({ host, actionsHost }); editors.push(ui)
    try {
      ui.update({ modeVisible: false })
      const toggle = host.querySelector('.lark-doc-mobile-actions-toggle')
      toggle.click(); trigger.click()
      choice.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      expect(toggle.getAttribute('aria-expanded')).toBe('true')
      expect(menu.hidden).toBe(true); expect(document.activeElement).toBe(trigger)
      trigger.click(); host.querySelector('[aria-label="取消文档操作"]').click(); toggle.click()
      expect(menu.hidden).toBe(true)
    } finally { ui.destroy(); host.remove(); Object.defineProperty(window, 'innerWidth', { configurable: true, value: width }) }
  })

  it('opens a modal action sheet with Cancel, keyboard containment and resize cleanup', () => {
    const width = window.innerWidth, overflow = document.body.style.overflow
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    const host = document.createElement('div'), main = document.createElement('main'), actionsHost = document.createElement('div')
    host.className = 'lark-doc'; main.className = 'lark-doc-main'; main.style.overflow = 'auto'; host.append(main)
    actionsHost.innerHTML = '<button>宿主功能</button>'; document.body.append(host)
    const ui = createTopBar({ host, actionsHost }); editors.push(ui)
    try {
      ui.update({ title: '移动文档', modeVisible: false })
      const toggle = host.querySelector('[aria-label="文档操作"][aria-haspopup]')
      toggle.click()
      const sheet = host.querySelector('.lark-doc-header-actions'), cancel = sheet.querySelector('[aria-label="取消文档操作"]')
      expect(sheet.getAttribute('aria-modal')).toBe('true')
      expect(cancel).not.toBeNull()
      expect(document.body.style.overflow).toBe('hidden'); expect(main.style.overflow).toBe('hidden')
      expect(document.activeElement).toBe(actionsHost.firstElementChild)
      cancel.focus(); cancel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
      expect(document.activeElement).toBe(actionsHost.firstElementChild)
      actionsHost.firstElementChild.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
      expect(document.activeElement).toBe(cancel)
      cancel.click()
      expect(toggle.getAttribute('aria-expanded')).toBe('false'); expect(document.activeElement).toBe(toggle)
      expect(document.body.style.overflow).toBe(overflow); expect(main.style.overflow).toBe('auto')
      toggle.click()
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 }); window.dispatchEvent(new Event('resize'))
      expect(sheet.getAttribute('aria-modal')).toBeNull(); expect(sheet.getAttribute('role')).toBe('group')
      expect(host.querySelector('.lark-doc-mobile-actions-backdrop')).toBeNull()
      expect(cancel.parentNode).toBeNull(); expect(main.style.overflow).toBe('auto')
    } finally { ui.destroy(); host.remove(); Object.defineProperty(window, 'innerWidth', { configurable: true, value: width }); document.body.style.overflow = overflow }
  })

  it('keeps the page locked when an action opens a comment image modal before dismissing the sheet', () => {
    const width = window.innerWidth, overflow = document.body.style.overflow
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    const host = document.createElement('div'), main = document.createElement('main'), paper = document.createElement('div'), portal = document.createElement('div'), actionsHost = document.createElement('div')
    host.className = 'lark-doc'; main.className = 'lark-doc-main'; main.style.overflow = 'auto'; main.append(paper); host.append(main, portal); document.body.append(host)
    const comments = createCommentPanel({ host: portal, inlineHost: paper, handlers: { onCloseImage: () => comments.update({ imageViewer: null }) } }); editors.push(comments)
    comments.update({ remote: true, documentInline: true, items: [] })
    const image = document.createElement('button'); image.className = 'lark-doc-comment-entry-button'; image.textContent = '图片评论'
    image.addEventListener('click', () => comments.update({ imageViewer: { url: 'blob:fixture', fileName: 'fixture.png' } })); actionsHost.append(image)
    const ui = createTopBar({ host, actionsHost }); editors.push(ui)
    try {
      ui.update({ modeVisible: false }); const toggle = host.querySelector('[aria-label="文档操作"][aria-haspopup]')
      toggle.click(); expect(main.style.overflow).toBe('hidden')
      image.click(); expect(toggle.getAttribute('aria-expanded')).toBe('false')
      expect(document.body.style.overflow).toBe('hidden'); expect(main.style.overflow).toBe('hidden')
      host.querySelector('[aria-label="关闭图片预览"]').click()
      expect(document.body.style.overflow).toBe(overflow); expect(main.style.overflow).toBe('auto')
    } finally { ui.destroy(); comments.destroy(); host.remove(); Object.defineProperty(window, 'innerWidth', { configurable: true, value: width }); document.body.style.overflow = overflow }
  })

  it('keeps H5 navigation, identity and members in order and clears the previous identity', () => {
    const host = document.createElement('div'), home = vi.fn(), profile = vi.fn(), members = vi.fn()
    document.body.append(host)
    const ui = createTopBar({ host, handlers: { openHome: home, openProfile: profile, openMembers: members } })
    editors.push(ui)
    ui.update({ title: '手机文档', currentUser: { id: 'alice', name: 'Alice' }, homeEnabled: true, profileEnabled: true, membersEnabled: true, membersLabel: '管理成员', membersHasPopup: true })
    const controls = [...ui.el.children].filter(n => /lark-doc-mobile-|lark-doc-title-wrap/.test(n.className))
    expect(controls.map(n => n.className)).toEqual(['lark-doc-mobile-home', 'lark-doc-mobile-outline', 'lark-doc-title-wrap', 'lark-doc-mobile-avatar', 'lark-doc-mobile-members', 'lark-doc-mobile-actions-toggle'])
    host.querySelector('[aria-label="我的文档库"]').click()
    host.querySelector('[aria-label="当前用户：Alice"]').click()
    host.querySelector('[aria-label="管理成员"]').click()
    expect(home).toHaveBeenCalledOnce(); expect(profile).toHaveBeenCalledOnce(); expect(members).toHaveBeenCalledOnce()
    ui.update({ membersLabel: '分享只读链接', membersHasPopup: false, membersEnabled: true })
    const readonlyShare = host.querySelector('[aria-label="分享只读链接"]')
    expect(readonlyShare.hasAttribute('aria-haspopup')).toBe(false)
    expect(readonlyShare.hasAttribute('aria-expanded')).toBe(false)
    ui.update({ currentUser: { id: 'bob', name: 'Bob' } })
    expect(host.querySelector('.lark-doc-mobile-avatar').textContent).toBe('B')
    expect(host.textContent).not.toContain('Alice')
    ui.update({ currentUser: null, homeEnabled: false, profileEnabled: false, membersEnabled: false })
    expect(host.querySelector('.lark-doc-mobile-avatar').textContent).toBe('')
    expect(host.querySelector('[aria-label="未登录"]').disabled).toBe(true)
    host.querySelector('[aria-label="我的文档库"]').click()
    expect(home).toHaveBeenCalledOnce()
  })

  it('uses only the current actor profile and checks view capability at action time', async () => {
    const handler = vi.fn(), can = vi.fn(() => true)
    const ed = { session: { documentId: 'doc', user: { id: 'alice' }, can }, user: { id: 'bob', name: 'Previous actor' }, onDocumentAction: handler, larkDocConfig: { layout: {} }, modesConfig: {}, toggleSharePopover: vi.fn(), featureEnabled: () => true, shareCan: key => key === 'canView', shareEntryLabel: '分享只读链接' }
    const state = () => toolbarUiMixin.methods.buildTopBarState.call(ed)
    expect(state().currentUser).toEqual({ id: 'alice', name: '我' })
    ed.user = { id: 'alice', name: 'Alice' }
    expect(state().currentUser).toEqual({ id: 'alice', name: 'Alice' })
    expect(state().homeEnabled).toBe(true)
    expect(state().membersLabel).toBe('分享只读链接')
    expect(state().membersHasPopup).toBe(false)
    await toolbarUiMixin.methods.onMobileHeaderAction.call(ed, 'home')
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ action: 'home', documentId: 'doc', actorId: 'alice' }))
    can.mockReturnValue(false)
    expect(state().currentUser).toBe(null)
    expect(state().membersEnabled).toBe(false)
    await toolbarUiMixin.methods.onMobileHeaderAction.call(ed, 'profile')
    expect(handler).toHaveBeenCalledOnce()
    can.mockReturnValue(true); ed.session.user = null
    expect(state().currentUser).toBe(null)
    await toolbarUiMixin.methods.onMobileHeaderAction.call(ed, 'profile')
    expect(handler).toHaveBeenCalledOnce()
    ed.onDocumentAction = null
    expect(state().homeEnabled).toBe(false)
  })

  it('opens manage-members through the existing share action', async () => {
    const ed = { session: { can: () => true, getProvider: () => null }, onDocumentAction: vi.fn(), featureEnabled: () => true, toolbarEnabled: () => true, shareCan: () => true, closeHeaderMenu: vi.fn(), toggleSharePopover: vi.fn() }
    await runDocumentMenuAction(ed, 'manage-members', null, { type: 'click' })
    expect(ed.toggleSharePopover).toHaveBeenCalledOnce()
  })

  it('retains the actual host controls and desktop ordering, with dismissible mobile actions', () => {
    const host = document.createElement('div'), actionsHost = document.createElement('div'), outline = vi.fn(), libraryAction = vi.fn()
    document.body.append(host)
    actionsHost.innerHTML = '<button>全文评论</button><button>阅读模式</button>'
    const ui = createTopBar({ host, actionsHost, handlers: { toggleOutline: outline, openLibrary: libraryAction } })
    editors.push(ui)
    ui.update({ title: '移动文档', modeVisible: true, modeOptions: [] })
    const children = [...host.querySelector('.lark-doc-header-actions').children]
    expect(children[1]).toBe(actionsHost)
    const toggle = host.querySelector('[aria-label="文档操作"][aria-haspopup]')
    toggle.click()
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(host.querySelector('.lark-doc-topbar').classList.contains('is-mobile-actions-open')).toBe(true)
    host.querySelector('[aria-label="文档目录"]').click()
    expect(outline).toHaveBeenCalledOnce(); expect(libraryAction).not.toHaveBeenCalled()
    toggle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    toggle.click()
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    ui.update({ title: '移动文档', mode: 'edit', modeLabel: '编辑', modeOptions: [{ id: 'edit', label: '编辑' }, { id: 'view', label: '阅读' }] })
    toggle.click()
    const mode = host.querySelector('.lark-doc-mode-select button')
    mode.click()
    mode.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    mode.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(toggle)
    const width = window.innerWidth
    try {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
      const theme = document.createElement('button'), themeMenu = document.createElement('div')
      theme.textContent = '主题'; themeMenu.hidden = true
      theme.addEventListener('click', () => { themeMenu.hidden = false })
      actionsHost.append(theme, themeMenu)
      toggle.click(); theme.click()
      expect(toggle.getAttribute('aria-expanded')).toBe('true')
      expect(themeMenu.hidden).toBe(false)
    } finally { Object.defineProperty(window, 'innerWidth', { configurable: true, value: width }) }
  })
})

describe('local mobile selection composer', () => {
  const width = window.innerWidth
  afterEach(() => Object.defineProperty(window, 'innerWidth', { configurable: true, value: width }))
  async function localComment(options = {}) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    const element = document.createElement('div'); document.body.appendChild(element)
    const comments = createMemoryCommentsProvider(), createThread = vi.spyOn(comments, 'createThread')
    const doc = new LarkDoc({ element, storage: 'none', comments, user: { id: 'local-alice', name: 'Alice' },
      content: '<p>分隔正文</p>', ...options })
    editors.push(doc)
    const editor = doc.getEditor(), host = doc._handle.nativeHost.host
    await host.loadComments()
    editor.commands.setTextSelection({ from: 1, to: 3 })
    return { element, comments, createThread, doc, editor, host }
  }

  it('opens an empty local composer, cancels without writing and retains its draft', async () => {
    const { element, comments, createThread, editor, host } = await localComment()
    const baseline = editor.getJSON(), overflow = document.body.style.overflow
    expect(host.openSelectionComment()).toBe(true)
    await vi.waitFor(() => expect(element.querySelector('[aria-label="新评论"]')).not.toBeNull())
    expect(element.querySelector('[role="dialog"][aria-label="选区评论"]')).not.toBeNull()
    expect(element.querySelector('.lark-doc-comment-quote').textContent).toBe('分隔')
    host.setCommentCreateDraft('local draft')
    await vi.waitFor(() => expect(element.querySelector('[aria-label="新评论"]').textContent).toBe('local draft'))
    const send = element.querySelector('.lark-doc-comment-composer .is-filled')
    element.querySelector('[aria-label="取消新评论"]').click()
    await vi.waitFor(() => expect(element.querySelector('[aria-label="新评论"]')).toBeNull())
    expect(host.commentCreateDraft).toBe('local draft')
    send.click()
    expect(createThread).not.toHaveBeenCalled()
    expect(await comments.list()).toEqual([])
    expect(editor.getJSON()).toEqual(baseline)
    expect(document.body.style.overflow).toBe(overflow)
    expect(host.openSelectionComment()).toBe(true)
    await vi.waitFor(() => expect(element.querySelector('[aria-label="新评论"]').textContent).toBe('local draft'))
  })

  it('submits through the real local memory provider and binds only the selected text', async () => {
    const { element, comments, createThread, editor, host } = await localComment()
    expect(host.openSelectionComment()).toBe(true)
    host.setCommentCreateDraft('本地评论')
    await vi.waitFor(() => expect(element.querySelector('.lark-doc-comment-composer .is-filled')?.disabled).toBe(false))
    element.querySelector('.lark-doc-comment-composer .is-filled').click()
    await vi.waitFor(() => expect(host.commentComposerOpen).toBe(false))
    const threads = await comments.list()
    expect(createThread).toHaveBeenCalledOnce()
    expect(threads).toHaveLength(1)
    expect(threads[0]).toMatchObject({ quote: '分隔', replies: [{ content: '本地评论' }] })
    expect(editor.getText()).toBe('分隔正文')
    expect(editor.view.dom.querySelector('.lark-doc-comment')?.textContent).toBe('分隔')
  })

  it.each(['readonly', 'feature', 'capability', 'provider'])('rejects a local create entry after %s revocation', async reason => {
    const { element, createThread, doc, host } = await localComment()
    if (reason === 'readonly') doc.setReadonly(true)
    if (reason === 'feature') host.editorConfig.features.comments = false
    if (reason === 'capability') vi.spyOn(host.session, 'can').mockImplementation(capability => capability !== 'canComment')
    if (reason === 'provider') host.session.providers.comments = null
    expect(host.commentAllowed('create')).toBe(false)
    expect(host.openSelectionComment()).toBe(false)
    expect(element.querySelector('[aria-label="新评论"]')).toBeNull()
    expect(createThread).not.toHaveBeenCalled()
  })

  it('retires the local composer and draft when its provider identity changes', async () => {
    const { element, createThread, host } = await localComment()
    expect(host.openSelectionComment()).toBe(true); host.setCommentCreateDraft('private local draft')
    await vi.waitFor(() => expect(element.querySelector('[aria-label="新评论"]')).not.toBeNull())
    host.session.setProvider('comments', createMemoryCommentsProvider())
    await vi.waitFor(() => expect(element.querySelector('[aria-label="新评论"]')).toBeNull())
    expect(host.commentComposerContext).toBeNull(); expect(host.commentCreateDraft).toBe('')
    expect(createThread).not.toHaveBeenCalled()
  })
})

describe('mobile comment projection', () => {
  it('keeps ordinary rich reply retry scoped and disables mention controls after readonly', () => {
    const width = window.innerWidth; Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    const host = document.createElement('div'); document.body.append(host)
    const choose = vi.fn(), item = { id: 'thread', allowedReply: true, hasDraft: true, replies: [], textarea: { value: 'draft @', readonly: false }, mentionPicker: { status: 'unknown', operationId: 'original', candidates: [] } }
    let ui
    const retry = vi.fn(() => ui.update({ items: [{ ...item, mentionPicker: { status: 'loading', candidates: [] } }] }))
    ui = createCommentPanel({ host, composerFactory: createCommentComposer, handlers: { onRetryDocumentMention: retry, onChooseMention: choose } }); editors.push(ui)
    try {
      ui.update({ remote: true, open: true, mobileScope: 'selection', items: [item] })
      const action = ui.el.querySelector('[aria-label="查询原提及操作"]'); action.focus(); action.click()
      expect(retry).toHaveBeenCalledWith('reply/thread')
      expect(document.activeElement.getAttribute('aria-label')).toBe('回复')
      expect(ui.el.querySelectorAll('.lark-doc-comment-mention-skeleton > span')).toHaveLength(4)
      expect(ui.el.querySelector('[aria-label="回复"]').textContent).toBe('draft @')
      retry.mockClear()
      const readonly = { ...item, textarea: { ...item.textarea, readonly: true } }
      ui.update({ items: [{ ...readonly, mentionPicker: { status: 'error', candidates: [] } }] })
      ui.el.querySelector('[aria-label="重试"]').click(); expect(retry).not.toHaveBeenCalled()
      ui.update({ items: [{ ...readonly, mentionPicker: { status: 'ready', candidates: [{ principalId: 'bob', displayName: 'Bob' }] } }] })
      ui.el.querySelector('[role="option"]').click(); expect(choose).not.toHaveBeenCalled()
    } finally { ui.destroy(); host.remove(); Object.defineProperty(window, 'innerWidth', { configurable: true, value: width }) }
  })
  it('keeps retry keyboard focus inside the mention sheet through loading and recovery', () => {
    const width = window.innerWidth; Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    const host = document.createElement('div'), paper = document.createElement('div'); document.body.append(host, paper)
    let ui
    const draft = { open: true, value: '@Bo', readonly: false, canSubmit: true }
    const retry = vi.fn(() => ui.update({ documentComposer: { ...draft, mentionPicker: { status: 'loading', candidates: [] } } }))
    ui = createCommentPanel({ host, inlineHost: paper, composerFactory: createCommentComposer, handlers: { onRetryDocumentMention: retry } }); editors.push(ui)
    try {
      ui.update({ remote: true, documentInline: true, documentComposer: { ...draft, mentionPicker: { status: 'unknown', operationId: 'original-id', candidates: [] } } })
      const action = ui.el.querySelector('[aria-label="查询原提及操作"]'); action.focus(); action.click()
      expect(retry).toHaveBeenCalledWith('document')
      expect(document.activeElement.getAttribute('aria-label')).toBe('取消提及选择')
      expect(ui.el.querySelectorAll('.lark-doc-comment-mention-skeleton > span')).toHaveLength(4)
      ui.update({ documentComposer: { ...draft, mentionPicker: { status: 'ready', candidates: [{ principalId: 'bob', displayName: 'Bob' }] } } })
      expect(document.activeElement.getAttribute('aria-label')).toBe('取消提及选择')
      ui.update({ documentComposer: { ...draft, readonly: true, mentionPicker: { status: 'error', candidates: [] } } })
      expect(ui.el.querySelector('.lark-doc-document-mention-sheet').hidden).toBe(true)
    } finally { ui.destroy(); host.remove(); paper.remove(); Object.defineProperty(window, 'innerWidth', { configurable: true, value: width }) }
  })
  it('opens a mobile mention sheet with cancellable candidates and releases it on readonly or identity change', () => {
    const width = window.innerWidth, overflow = document.body.style.overflow
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    const host = document.createElement('div'), paper = document.createElement('div'), choose = vi.fn()
    document.body.append(host, paper)
    const draft = { open: true, value: 'draft @', canSubmit: true, mentionPicker: { candidates: [{ principalId: 'bob', displayName: 'Bob' }], index: 0 } }
    let ui
    const dismiss = vi.fn(() => { ui.update({ documentComposer: { ...draft, mentionPicker: null } }); return true })
    ui = createCommentPanel({ host, inlineHost: paper, composerFactory: createCommentComposer, handlers: { onDocumentMentionKeydown: dismiss, onChooseDocumentMention: choose } }); editors.push(ui)
    try {
      ui.update({ remote: true, documentInline: true, identityGeneration: 1, documentComposer: draft })
      const sheet = paper.querySelector('[role="dialog"][aria-label="你可能想提及"]')
      expect(sheet).not.toBeNull()
      expect(sheet.closest('.lark-doc-document-composer').classList.contains('is-mention-open')).toBe(true)
      expect(sheet.querySelector('[role="listbox"] [role="option"]').getAttribute('aria-label')).toBe('Bob')
      expect(document.body.style.overflow).toBe('hidden')
      sheet.querySelector('[role="option"]').focus()
      ui.update({ documentComposer: draft })
      expect(document.activeElement.getAttribute('aria-label')).toBe('Bob')
      const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
      document.activeElement.dispatchEvent(tab)
      expect(tab.defaultPrevented).toBe(true); expect(document.activeElement.getAttribute('aria-label')).toBe('取消提及选择')
      const reverseTab = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
      document.activeElement.dispatchEvent(reverseTab)
      expect(reverseTab.defaultPrevented).toBe(true); expect(document.activeElement.getAttribute('aria-label')).toBe('Bob')
      sheet.querySelector('[role="option"]').click(); expect(choose).toHaveBeenCalledWith(draft.mentionPicker.candidates[0])
      sheet.querySelector('[aria-label="取消提及选择"]').click()
      expect(dismiss).toHaveBeenCalledWith('document', 'Escape')
      expect(sheet.hidden).toBe(true)
      expect(sheet.closest('.lark-doc-document-composer').classList.contains('is-mention-open')).toBe(false)
      expect(document.activeElement.textContent).toBe('draft @')
      expect(document.body.style.overflow).toBe(overflow)
      ui.update({ documentComposer: { ...draft, readonly: true } })
      expect(sheet.hidden).toBe(true); expect(document.body.style.overflow).toBe(overflow)
      choose.mockClear(); sheet.querySelector('[role="option"]').click(); expect(choose).not.toHaveBeenCalled()
      ui.update({ documentComposer: draft })
      sheet.querySelector('[role="option"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      expect(sheet.hidden).toBe(true)
      ui.update({ documentComposer: draft })
      ui.update({ identityGeneration: 2 })
      expect(paper.textContent).not.toContain('Bob'); expect(paper.textContent).not.toContain('draft @')
      expect(document.body.style.overflow).toBe(overflow)
      ui.update({ documentComposer: draft })
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 }); window.dispatchEvent(new Event('resize'))
      expect(document.body.style.overflow).toBe(overflow)
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 }); window.dispatchEvent(new Event('resize'))
      expect(document.body.style.overflow).toBe('hidden')
      ui.destroy(); expect(document.body.style.overflow).toBe(overflow)
    } finally { ui.destroy(); host.remove(); paper.remove(); Object.defineProperty(window, 'innerWidth', { configurable: true, value: width }) }
  })
  it('does not return document focus after the user has already entered another comment input', async () => {
    const host = document.createElement('div'), body = document.createElement('div')
    body.contentEditable = 'true'; body.tabIndex = 0; host.append(body); document.body.append(host)
    const input = createCommentComposer(); editors.push(input); host.append(input.el)
    const ed = { $el: host, editor: { isDestroyed: false, view: { dom: body, focus: () => body.focus() }, commands: { focus: () => body.focus() } },
      commentOperationCurrent: () => () => true, clearCommentDraftImages: vi.fn(), refreshCommentDecorations: vi.fn(), $nextTick: callback => Promise.resolve().then(callback) }
    commentsMixin.methods.closeCommentComposer.call(ed)
    input.el.focus()
    await Promise.resolve()
    expect(document.activeElement).toBe(input.el)
  })

  it('announces comment failures without opening a modal, moving focus or locking scroll', () => {
    const host = document.createElement('div'), trigger = document.createElement('button')
    document.body.append(host, trigger); trigger.focus()
    const overflow = document.body.style.overflow
    const ui = createCommentPanel({ host }); editors.push(ui)
    ui.update({ remote: true, open: false, message: '请先选中要评论的文字。' })
    const notice = host.querySelector('[role="status"]')
    expect(notice?.textContent).toBe('请先选中要评论的文字。')
    expect(notice.getAttribute('aria-live')).toBe('polite')
    expect(ui.el.isConnected).toBe(false)
    expect(document.activeElement).toBe(trigger)
    expect(document.body.style.overflow).toBe(overflow)
    ui.update({ identityGeneration: 2 })
    expect(host.querySelector('[role="status"]')).toBeNull()
    ui.update({ message: 'new context' }); ui.destroy()
    expect(host.querySelector('[role="status"]')).toBeNull()
    trigger.remove()
  })

  it('projects a readable missing-collaboration message and clears it when view permission is lost', () => {
    let readable = true
    const ed = { commentRemote: true, commentCan: () => readable, commentAllowed: () => readable,
      commentDraftImages: () => [], commentAuthorName: () => '', editor: {},
      commentSelectionRange: () => ({ blockId: 'b', offset: 0, length: 2, text: '正文' }),
      commentDocumentDraft: 'preserved draft' }
    expect(commentsMixin.methods.openSelectionComment.call(ed)).toBe(false)
    expect(ed.commentMessage).toBe('当前文档尚未连接协同正文，无法创建选区评论。')
    expect(panelsUiMixin.methods.buildCommentState.call(ed).message).toBe(ed.commentMessage)
    expect(ed.commentDocumentDraft).toBe('preserved draft')
    expect(ed.commentComposerOpen).not.toBe(true)
    readable = false
    expect(panelsUiMixin.methods.buildCommentState.call(ed).message).toBe('')
  })

  it('renders the native document footer inline without locking page scroll and reuses its rich draft', () => {
    const width = window.innerWidth, overflow = document.body.style.overflow
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    const host = document.createElement('div'), paper = document.createElement('div')
    document.body.append(host, paper)
    const ui = createCommentPanel({ host, inlineHost: paper, composerFactory: createCommentComposer }); editors.push(ui)
    try {
      ui.update({ remote: true, documentInline: true, open: false, items: [
        { id: 'a', quote: 'anchor', replies: [] }, { id: 'doc', documentOnly: true, replies: [{ id: 'r', name: 'Alice', body: 'saved reply' }] },
      ], documentComposer: { open: true, value: 'footer draft', canSubmit: true } })
      expect(ui.el.parentNode).toBe(paper)
      expect(ui.el.querySelector('h2').textContent).toBe('全文评论')
      expect(ui.el.querySelector('[aria-modal]')).toBeNull()
      expect(ui.el.querySelector('[data-comment-thread="a"]')).toBeNull()
      expect(document.body.style.overflow).toBe(overflow)
      const input = ui.el.querySelector('.lark-doc-document-composer-input')
      expect(input.textContent).toContain('footer draft')
      const send = input.parentElement.querySelector('[aria-label="发送全文评论"]')
      expect(send.querySelector('svg')).not.toBeNull()
      expect(send.disabled).toBe(false)
      ui.update({ documentComposer: { open: true, value: '', canSubmit: true } })
      expect(send.disabled).toBe(true)
      expect(input.getAttribute('data-placeholder')).toBe('输入评论')
      ui.update({ documentComposer: { open: true, value: 'A\nB', canSubmit: true } })
      expect(input.style.height).toBe('64px')
      Object.defineProperty(input, 'scrollHeight', { configurable: true, get: () => input.isConnected ? 86 : 0 })
      ui.update({ documentComposer: { open: true, value: 'wrapped line', canSubmit: true } })
      expect(input.style.height).toBe('88px')
      // H5 typography follows the reference's rem scale, rather than a fixed 24px line.
      Object.defineProperty(input, 'scrollHeight', { configurable: true, get: () => 63 })
      Object.assign(input.style, { minHeight: '41.3px', lineHeight: '25.152px', padding: '6.5px 16.768px', border: '1px solid' })
      ui.update({ documentComposer: { open: true, value: 'A\nB', canSubmit: true } })
      expect(parseFloat(input.style.height)).toBeCloseTo(65.304, 3)
      ui.update({ documentComposer: { open: true, value: '', canSubmit: true } })
      expect(input.style.height).toBe('41.3px')
      ;['min-height', 'line-height', 'padding', 'border'].forEach(name => input.style.removeProperty(name))
      Object.defineProperty(input, 'scrollHeight', { configurable: true, get: () => input.isConnected ? 86 : 0 })
      ui.update({ documentComposer: { open: true, value: 'footer draft', canSubmit: true } })
      input.focus()
      const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
      input.dispatchEvent(tab); expect(tab.defaultPrevented).toBe(false)
      ui.update({ open: true, mobileOpen: true, mobileScope: 'selection', activeThreadId: 'a' })
      expect(ui.el.parentNode).toBe(host)
      expect(document.body.style.overflow).toBe('hidden')
      ui.update({ open: false })
      expect(ui.el.parentNode).toBe(paper)
      expect(ui.el.querySelector('.lark-doc-document-composer-input')).toBe(input)
      expect(input.textContent).toContain('footer draft')
      expect(document.activeElement).toBe(input)
      expect(input.style.height).toBe('88px')
      expect(document.body.style.overflow).toBe(overflow)
      ui.update({ identityGeneration: 2, documentInline: false, open: false, items: [] })
      expect(ui.el.isConnected).toBe(false)
      expect(input.textContent).not.toContain('footer draft')
    } finally { Object.defineProperty(window, 'innerWidth', { configurable: true, value: width }); document.body.style.overflow = overflow; paper.remove() }
  })

  it('keeps mobile document reply extensions reachable inside more without a separate action row', () => {
    const width = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    const host = document.createElement('div'), paper = document.createElement('div')
    document.body.append(host, paper)
    const onReplyControl = vi.fn(), onMenuItem = vi.fn()
    const ui = createCommentPanel({ host, inlineHost: paper, handlers: { onReplyControl, onMenuItem } }); editors.push(ui)
    try {
      const item = { id: 'doc', documentOnly: true, replies: [{ id: 'r', name: 'Alice', body: 'saved reply', menuOpen: true,
        menus: [{ id: 'edit', label: '编辑', visible: true }, { id: 'delete', label: '删除', visible: true, disabled: true }] }] }
      ui.update({ remote: true, documentInline: true, replyControls: [{ id: 'emoji', label: '添加表情回复' }, { id: 'quote', label: '引用回复' }, { id: 'more', label: '更多菜单' }], items: [item] })
      const row = ui.el.querySelector('.lark-doc-comment-reply-controls')
      expect([...row.querySelectorAll('button')].map(button => button.getAttribute('aria-label'))).toEqual(['更多菜单'])
      const menus = [...ui.el.querySelectorAll('[role="menuitem"]')]
      menus.find(menu => menu.textContent === '添加表情回复').click()
      expect(onReplyControl).toHaveBeenCalledWith('emoji', 'doc', 'r', expect.any(Event))
      menus.find(menu => menu.textContent === '引用回复').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      expect(onReplyControl).toHaveBeenCalledWith('quote', 'doc', 'r', expect.any(Event))
      menus.find(menu => menu.textContent === '编辑').click()
      expect(onMenuItem).toHaveBeenCalledWith('edit', 'doc', 'r')
      menus.find(menu => menu.textContent === '删除').click()
      expect(onMenuItem).toHaveBeenCalledTimes(1)
      ui.update({ items: [{ ...item, replies: [{ ...item.replies[0], canReact: false, canReply: false }] }] })
      const denied = [...ui.el.querySelectorAll('[role="menuitem"]')].find(menu => menu.textContent === '添加表情回复')
      expect(denied.getAttribute('aria-disabled')).toBe('true')
      denied.click()
      expect(onReplyControl).toHaveBeenCalledTimes(2)
      ui.update({ items: [{ ...item, replies: [{ ...item.replies[0], tombstone: true }] }] })
      expect([...ui.el.querySelectorAll('[role="menuitem"]')].some(menu => menu.textContent === '添加表情回复')).toBe(false)
      ui.update({ documentInline: false, open: true })
      expect(ui.el.querySelectorAll('.lark-doc-comment-reply-controls button')).toHaveLength(3)
    } finally { ui.destroy(); host.remove(); paper.remove(); Object.defineProperty(window, 'innerWidth', { configurable: true, value: width }) }
  })

  it('locks the editor main while an inline footer image modal is open', () => {
    const width = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    const host = document.createElement('div'), main = document.createElement('main'), paper = document.createElement('div')
    main.className = 'lark-doc-main'; main.style.overflow = 'auto'; main.append(paper); document.body.append(host, main)
    const ui = createCommentPanel({ host, inlineHost: paper, composerFactory: createCommentComposer }); editors.push(ui)
    try {
      ui.update({ remote: true, documentInline: true, imageViewer: { url: '/fixture.png', fileName: 'fixture' } })
      expect(main.style.overflow).toBe('hidden')
      ui.update({ imageViewer: null }); expect(main.style.overflow).toBe('auto')
      ui.update({ imageViewer: { url: '/fixture.png' } }); ui.destroy(); expect(main.style.overflow).toBe('auto')
    } finally { Object.defineProperty(window, 'innerWidth', { configurable: true, value: width }); main.remove() }
  })

  it('keeps anchored carousel separate from the full-document extension and exposes navigation/dismissal', () => {
    const width = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    const host = document.createElement('div'), onActivate = vi.fn(), onCloseMobile = vi.fn()
    document.body.append(host)
    const ui = createCommentPanel({ host, composerFactory: createCommentComposer, handlers: { onActivate, onCloseMobile } }); editors.push(ui)
    try {
      ui.update({ open: true, remote: true, mobileScope: 'selection', activeThreadId: 'a', items: [
        { id: 'a', quote: 'first', replies: [] }, { id: 'b', quote: 'second', replies: [] },
        { id: 'doc', documentOnly: true, replies: [] },
      ] })
      expect(ui.el.querySelector('[aria-label="选区评论轮播"]').children).toHaveLength(2)
      expect(ui.el.textContent).toContain('评论 1/2')
      expect(ui.el.querySelector('[data-comment-thread="doc"]')).toBeNull()
      ui.el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(onCloseMobile).not.toHaveBeenCalled()
      ui.el.querySelector('[aria-label="下一条评论"]').click()
      expect(onActivate).toHaveBeenCalledWith('b')
      ui.update({ activeThreadId: 'b' })
      expect(ui.el.textContent).toContain('评论 2/2')
      ui.el.querySelector('[aria-label="关闭评论"]').click()
      expect(onCloseMobile).toHaveBeenCalledOnce()
      ui.update({ mobileScope: 'document' })
      expect(ui.el.querySelector('[aria-label="全文评论扩展"]')).not.toBeNull()
      expect(ui.el.querySelector('[data-comment-thread="a"]')).toBeNull()
      ui.update({ items: [{ id: 'doc', documentOnly: true, replies: [], translation: { replyId: 'reply', sourceRevision: '1', language: 'en', current: true } }] })
      ui.el.querySelectorAll('button, input, select').forEach(node => { node.getBoundingClientRect = () => ({ left: 10, right: 50, top: 10, bottom: 46, width: 40, height: 36 }) })
      const language = ui.el.querySelector('[aria-label="翻译语言"]')
      language.focus()
      const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
      language.dispatchEvent(tab)
      expect(tab.defaultPrevented).toBe(false)
      expect(document.body.style.overflow).toBe('hidden')
      ui.update({ open: false })
      expect(document.body.style.overflow).toBe('')
    } finally { Object.defineProperty(window, 'innerWidth', { configurable: true, value: width }) }
  })

  it('erases closed inputs, rendered replies and their history immediately on identity invalidation', () => {
    const host = document.createElement('div'); document.body.append(host)
    const ui = createCommentPanel({ host, composerFactory: createCommentComposer }); editors.push(ui)
    ui.update({ open: true, remote: true, identityGeneration: 1, items: [{ id: 'secret', quote: 'private quote', replies: [{ id: 'reply', body: 'private body' }], textarea: { value: 'private draft' } }] })
    const input = ui.el.querySelector('[aria-label="回复"]'), card = ui.el.querySelector('[data-comment-thread="secret"]')
    input.focus()
    ui.update({ open: false })
    ui.update({ open: false, identityGeneration: 2 })
    expect(input.textContent).toBe('')
    expect(card.textContent).toBe('')
    expect(ui.el.textContent).not.toContain('private')
  })
})
function create(options = {}) {
  const editor = createCommentComposer({ label: '回复评论', placeholder: '回复评论', ...options })
  document.body.append(editor.el)
  editors.push(editor)
  return editor
}
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); document.body.textContent = ''; vi.restoreAllMocks() })

describe('comment rich input', () => {
  it('prepares the view before touch focus and claims selection without stealing focus on pointerdown', () => {
    const body = document.createElement('div')
    body.contentEditable = 'true'; body.tabIndex = 0; body.textContent = 'document selection'
    document.body.append(body); body.focus()
    const range = document.createRange(); range.selectNodeContents(body)
    document.getSelection().removeAllRanges(); document.getSelection().addRange(range)
    const editor = createCommentComposer(); editors.push(editor); document.body.append(editor.el)
    editor.el.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }))
    expect(editor.view).not.toBeNull()
    expect(document.activeElement).toBe(body)
    expect(document.getSelection().toString()).toBe('document selection')
    editor.el.focus()
    expect(editor.el.contains(document.getSelection().anchorNode)).toBe(true)
    expect(editor.el.contains(document.getSelection().focusNode)).toBe(true)
    expect(editor.getDraft().content).toBe('')
    expect(body.textContent).toBe('document selection')
  })

  it('renders inline mention/reference atoms with no idle EditorView and preserves UTF-16 offsets on edits', () => {
    const onChange = vi.fn(), editor = create({ onChange })
    editor.update({ value: '😀 @Bob doc', mentions: [{ principalId: 'bob', from: 3, to: 7 }], references: [{ docId: 'doc', from: 8, to: 11 }] })
    expect(editor.view).toBeNull()
    expect(editor.el.querySelector('[data-comment-mention]').textContent).toBe('@Bob')
    editor.el.focus()
    editor.view.dispatch(editor.view.state.tr.insertText('Hi ', 1))
    expect(editor.getDraft()).toMatchObject({ content: 'Hi 😀 @Bob doc', mentions: [{ principalId: 'bob', from: 6, to: 10 }], references: [{ docId: 'doc', from: 11, to: 14 }] })
    expect(onChange).toHaveBeenCalled()
    undo(editor.view.state, editor.view.dispatch)
    expect(editor.getDraft().content).toBe('😀 @Bob doc')
  })

  it('keeps the caret/history on echoed drafts, resets history across identities and handles read-only', () => {
    const editor = create()
    editor.update({ value: 'abc', scopeKey: 'alice/document' })
    editor.el.focus()
    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 2)).insertText('X'))
    const before = editor.view.state
    editor.update({ value: 'aXbc', scopeKey: 'alice/document' })
    expect(editor.view.state).toBe(before)
    editor.update({ value: 'bob', scopeKey: 'bob/document', readonly: true })
    expect(editor.el.getAttribute('contenteditable')).toBe('false')
    expect(undo(editor.view.state, editor.view.dispatch)).toBe(false)
    expect(editor.getDraft().content).toBe('bob')
  })

  it('pastes external HTML as text rather than trusting forged mention identities', () => {
    const editor = create()
    editor.el.focus()
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: { getData: type => type === 'text/plain' ? '@Admin\nnext' : '<span data-comment-mention="admin">@Admin</span>' } })
    editor.el.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(editor.getDraft()).toMatchObject({ content: '@Admin\nnext', mentions: [] })
    expect(editor.el.querySelector('[data-comment-mention]')).toBeNull()
  })

  it('undoes a chosen mention and retains the typing history before it', () => {
    const editor = create()
    editor.el.focus()
    editor.view.dispatch(editor.view.state.tr.insertText('@Bo'))
    editor.update({ value: '@Bob ', mentions: [{ principalId: 'bob', from: 0, to: 4 }] })
    undo(editor.view.state, editor.view.dispatch)
    expect(editor.getDraft()).toMatchObject({ content: '@Bo', mentions: [] })
    undo(editor.view.state, editor.view.dispatch)
    expect(editor.getDraft().content).toBe('')
  })

  it('does not forward IME confirmation keys to a mention picker', () => {
    const editor = create(), picker = vi.fn()
    editor.el.addEventListener('comment-keydown', picker)
    editor.el.focus()
    editor.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }))
    editor.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true }))
    expect(picker).not.toHaveBeenCalled()
  })

  it('recreates the IME view across identities and blocks paste/undo in readonly input', () => {
    const editor = create()
    editor.update({ value: 'secret', scopeKey: 'alice' }); editor.el.focus()
    editor.el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    const oldView = editor.view
    editor.update({ value: 'reader', scopeKey: 'reader', readonly: true })
    expect(editor.view).not.toBe(oldView)
    expect(editor.view.composing).toBe(false)
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: { getData: () => 'denied' } })
    editor.el.dispatchEvent(event)
    editor.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(editor.getDraft().content).toBe('reader')
  })
})

describe('comment keyboard capture and deferred focus', () => {
  function focusScope() {
    const root = document.createElement('div'), thread = document.createElement('div'), reply = document.createElement('div')
    const more = document.createElement('button'), menuItem = document.createElement('button'), foreign = document.createElement('textarea')
    thread.dataset.commentThread = 'keyboard-thread'; reply.dataset.commentReply = 'keyboard-reply'
    more.dataset.commentReplyControl = 'more'; more.textContent = '更多'; menuItem.textContent = '菜单操作'
    reply.append(more, menuItem); thread.append(reply); root.append(thread); document.body.append(root, foreign)
    const ticks = [], current = { operation: true, permission: true }
    const host = {
      $el: root, $refs: { root }, $nextTick: callback => { ticks.push(callback); return Promise.resolve() },
      commentOperationCurrent: () => () => current.operation, commentCan: () => current.permission,
      refreshPanels: vi.fn(), commentMenuThreadId: 'keyboard-thread', commentMenuCommentId: 'keyboard-reply',
      _commentReplyMenuAnchor: more,
    }
    host.closeCommentMenus = vi.fn(() => { host.commentMenuThreadId = ''; host.commentMenuCommentId = '' })
    host.restoreCommentReplyFocus = vi.fn(createCommentInteraction({}).methods.restoreCommentReplyFocus.bind(host))
    const capture = event => commentsMixin.methods.onCommentReactionKeydown.call(host, event)
    window.addEventListener('keydown', capture, true)
    const dispose = () => window.removeEventListener('keydown', capture, true)
    editors.push({ destroy: dispose })
    return { root, more, menuItem, foreign, host, current, flush: () => { ticks.splice(0).forEach(callback => callback()) } }
  }

  it('window Escape capture respects a real comment PM composition when event flags are false', () => {
    const scope = focusScope(), editor = create()
    scope.root.append(editor.el); editor.update({ value: '组字草稿' }); editor.el.focus()
    editor.el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    expect(editor.view.composing).toBe(true)
    const before = editor.getDraft(), escape = new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true })
    expect(escape.isComposing).toBe(false)
    editor.el.dispatchEvent(escape); scope.flush()
    expect(scope.host.closeCommentMenus).not.toHaveBeenCalled()
    expect(escape.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(editor.el)
    expect(editor.getDraft()).toEqual(before)
  })

  it('window Escape capture preserves Safari composition cooldown and closes normally after 500ms', () => {
    vi.useFakeTimers()
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15')
    try {
      const scope = focusScope(), editor = create()
      scope.root.append(editor.el); editor.update({ value: '保留草稿' }); editor.el.focus()
      editor.el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      expect(editor.view.composing).toBe(true)
      editor.el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
      expect(editor.view.composing).toBe(false)
      const before = editor.getDraft(), during = new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true })
      editor.el.dispatchEvent(during); scope.flush()
      expect(scope.host.closeCommentMenus).not.toHaveBeenCalled()
      expect(during.defaultPrevented).toBe(false); expect(document.activeElement).toBe(editor.el)
      vi.advanceTimersByTime(501)
      const after = new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true })
      editor.el.dispatchEvent(after); scope.flush()
      expect(scope.host.closeCommentMenus).toHaveBeenCalledOnce()
      expect(after.defaultPrevented).toBe(true); expect(document.activeElement).toBe(scope.more)
      expect(editor.getDraft()).toEqual(before)
    } finally { vi.useRealTimers() }
  })

  it('a queued More focus restoration does not override a newer foreign input focus', () => {
    const scope = focusScope()
    scope.menuItem.focus()
    scope.host.restoreCommentReplyFocus('keyboard-thread', 'keyboard-reply', scope.more)
    scope.foreign.focus(); scope.flush()
    expect(document.activeElement).toBe(scope.foreign)
  })

  it.each(['unchanged-owned', 'removed-menu'])('a queued More focus restoration retains its %s fallback', state => {
    const scope = focusScope()
    scope.menuItem.focus()
    scope.host.restoreCommentReplyFocus('keyboard-thread', 'keyboard-reply', scope.more)
    if (state === 'removed-menu') { scope.menuItem.remove(); expect(document.activeElement).toBe(document.body) }
    scope.flush()
    expect(document.activeElement).toBe(scope.more)
  })

  it.each(['operation', 'permission'])('a queued More focus restoration stops after %s retirement', gate => {
    const scope = focusScope()
    scope.menuItem.focus()
    scope.host.restoreCommentReplyFocus('keyboard-thread', 'keyboard-reply', scope.more)
    scope.current[gate] = false; scope.flush()
    expect(document.activeElement).toBe(scope.menuItem)
  })

  function shadowFocusScope(mode) {
    const scope = focusScope(), shadowHost = document.createElement('div')
    document.body.append(shadowHost)
    const shadow = shadowHost.attachShadow({ mode })
    shadow.append(scope.root, scope.foreign)
    scope.menuItem.focus()
    expect(document.activeElement).toBe(shadowHost)
    expect(shadow.activeElement).toBe(scope.menuItem)
    return { ...scope, shadow, shadowHost, next: vi.spyOn(scope.host, '$nextTick') }
  }

  it.each(['open', 'closed'])('window capture respects a real comment PM composition in a real %s ShadowRoot', mode => {
    // JSDOM lacks the public execCommand used by PM's Safari Shadow selection probe.
    const execCommand = Object.getOwnPropertyDescriptor(document, 'execCommand')
    Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false })
    try {
      const scope = shadowFocusScope(mode), editor = create()
      scope.root.append(editor.el); editor.update({ value: 'Shadow组字草稿' }); editor.el.focus()
      editor.el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, composed: true }))
      expect(editor.view.composing).toBe(true)
      expect(scope.shadow.activeElement).toBe(editor.el)
      const before = editor.getDraft(), escape = new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, composed: true, bubbles: true, cancelable: true })
      expect(escape.isComposing).toBe(false)
      editor.el.dispatchEvent(escape); scope.flush()
      expect(scope.host.closeCommentMenus).not.toHaveBeenCalled()
      expect(escape.defaultPrevented).toBe(false)
      expect(scope.shadow.activeElement).toBe(editor.el)
      expect(editor.getDraft()).toEqual(before)
    } finally { if (execCommand) Object.defineProperty(document, 'execCommand', execCommand); else delete document.execCommand }
  })

  it.each(['open', 'closed'])('queues and restores owned More focus inside a real %s ShadowRoot', mode => {
    const scope = shadowFocusScope(mode)
    scope.host.restoreCommentReplyFocus('keyboard-thread', 'keyboard-reply', scope.more)
    expect(scope.next).toHaveBeenCalledOnce()
    scope.flush()
    expect(scope.shadow.activeElement).toBe(scope.more)
    expect(document.activeElement).toBe(scope.shadowHost)
  })

  it.each(['open', 'closed'])('restores More after its queued menu owner is removed inside a real %s ShadowRoot', mode => {
    const scope = shadowFocusScope(mode)
    scope.host.restoreCommentReplyFocus('keyboard-thread', 'keyboard-reply', scope.more)
    scope.menuItem.remove()
    expect(scope.shadow.activeElement).toBeNull()
    expect(document.activeElement).toBe(document.body)
    expect(scope.next).toHaveBeenCalledOnce()
    scope.flush()
    expect(scope.shadow.activeElement).toBe(scope.more)
  })

  it.each(['open', 'closed'])('does not override newer foreign focus in the same real %s ShadowRoot', mode => {
    const scope = shadowFocusScope(mode)
    scope.host.restoreCommentReplyFocus('keyboard-thread', 'keyboard-reply', scope.more)
    scope.foreign.focus()
    expect(document.activeElement).toBe(scope.shadowHost)
    expect(scope.shadow.activeElement).toBe(scope.foreign)
    expect(scope.next).toHaveBeenCalledOnce()
    scope.flush()
    expect(scope.shadow.activeElement).toBe(scope.foreign)
  })
})

describe('T095 mobile local reaction picker', () => {
  const width = window.innerWidth, height = window.innerHeight, media = window.matchMedia
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 852 })
    window.matchMedia = () => Object.assign(new EventTarget(), { matches: true })
  })
  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
    window.matchMedia = media
  })
  function tap(button) {
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click']) {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true })
      if (type.startsWith('pointer')) Object.defineProperties(event, { pointerType: { value: 'touch' }, pointerId: { value: 1 }, isPrimary: { value: true } })
      button.dispatchEvent(event)
    }
  }
  async function localPicker({ shadow: shadowMode } = {}) {
    const element = document.createElement('div')
    let shadow = null
    if (shadowMode) {
      const owner = document.createElement('div'); document.body.append(owner)
      shadow = owner.attachShadow({ mode: shadowMode }); shadow.append(element)
    } else document.body.append(element)
    const comments = createMemoryCommentsProvider({ threads: [{ id: 'picker-thread', scope: 'document', blockId: null, anchor: null,
      author: { id: 'alice' }, replies: [{ id: 'picker-reply', author: { id: 'alice' }, content: 'existing comment' }] }] })
    const doc = new LarkDoc({ element, storage: 'none', comments, user: { id: 'alice' }, content: '<p>body stays unchanged</p>' }); editors.push(doc)
    const host = doc._handle.nativeHost.host
    await vi.waitFor(() => expect(doc.getWorkspace().state.initialized).toBe(true))
    await host.loadComments(); await host.$nextTick()
    host.commentSidebarOpen = true; host.commentMobileScope = 'document'; host.refreshPanels()
    const more = () => element.querySelector('[data-comment-reply="picker-reply"] [data-comment-reply-control="more"]')
    await vi.waitFor(() => expect(more()).not.toBeNull())
    const open = async () => {
      tap(more())
      await vi.waitFor(() => expect(element.querySelector('[aria-label="更多表情回复"]')).not.toBeNull())
      const plus = element.querySelector('[aria-label="更多表情回复"]')
      vi.spyOn(plus, 'getBoundingClientRect').mockImplementation(() => plus.isConnected
        ? { left: 354, right: 382, top: 712, bottom: 740, width: 28, height: 28 }
        : { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 })
      return plus
    }
    return { doc, host, element, comments, more, open, shadow, main: element.querySelector('.lark-doc-main') }
  }
  it('keeps the first touched picker fixed in the viewport and searchable without focus scrolling the main page', async () => {
    const { doc, host, element, comments, open, main } = await localPicker()
    const before = doc.getJSON(), threads = await comments.list(), plus = await open()
    main.scrollTop = 1456.5
    const original = HTMLElement.prototype.focus
    const calls = []
    // JSDOM does not perform browser focus scrolling. Model that observed event
    // only when the actual picker input is focused without preventScroll.
    vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (options) {
      if (this.matches('.lark-doc-comment-reaction-picker input')) {
        calls.push(options)
        if (!options?.preventScroll) { main.scrollTop -= 76; main.dispatchEvent(new Event('scroll')) }
      }
      return original.call(this, options)
    })
    tap(plus); await host.$nextTick(); await Promise.resolve()
    const picker = element.querySelector('.lark-doc-comment-reaction-picker')
    expect(picker).not.toBeNull(); expect(picker.isConnected).toBe(true)
    expect(picker.style.position).toBe('fixed'); expect(calls).toEqual([{ preventScroll: true }])
    expect(main.scrollTop).toBe(1456.5)
    const input = picker.querySelector('input'); expect(document.activeElement).toBe(input)
    input.value = '👍'; input.dispatchEvent(new Event('input', { bubbles: true })); await host.$nextTick()
    expect(host.commentReactionQuery).toBe('👍')
    expect(element.querySelector('.lark-doc-comment-reaction-grid button')).not.toBeNull()
    expect(doc.getJSON()).toEqual(before); expect(await comments.list()).toEqual(threads)
  })
  it('captures the plus geometry before closing the menu removes it', async () => {
    const { host, element, open } = await localPicker(), plus = await open()
    const close = host.closeCommentMenus
    vi.spyOn(host, 'closeCommentMenus').mockImplementation(function (...args) { const result = close.apply(this, args); this.refreshPanels(); return result })
    tap(plus); await host.$nextTick()
    expect(plus.isConnected).toBe(false)
    expect(host.commentReactionContext.position).toEqual({ left: 54, top: 504 })
    const picker = element.querySelector('.lark-doc-comment-reaction-picker')
    expect(picker.style.left).toBe('54px'); expect(picker.style.top).toBe('504px')
  })
  it('keeps composition Escape inside the picker, then returns ordinary Escape focus to More', async () => {
    const { host, element, more, open } = await localPicker()
    tap(await open()); await host.$nextTick()
    const input = element.querySelector('.lark-doc-comment-reaction-picker input')
    for (const flags of [{ isComposing: true }, { keyCode: 229 }]) {
      const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...flags })
      input.dispatchEvent(escape)
      expect(escape.defaultPrevented).toBe(false); expect(input.isConnected).toBe(true)
    }
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true }))
    await host.$nextTick(); expect(host.commentReactionContext).toBeNull()
    expect(document.activeElement).toBe(more())
  })
  it.each(['outside', 'scroll'])('still closes on real %s events without writing a reaction or the body', async action => {
    const { doc, host, element, comments, open, main } = await localPicker()
    const before = doc.getJSON(), threads = await comments.list()
    tap(await open()); await host.$nextTick()
    expect(host.commentReactionContext).not.toBeNull()
    if (action === 'outside') main.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    else main.dispatchEvent(new Event('scroll'))
    await host.$nextTick(); expect(host.commentReactionContext).toBeNull()
    expect(element.querySelector('.lark-doc-comment-reaction-picker')).toBeNull()
    expect(doc.getJSON()).toEqual(before); expect(await comments.list()).toEqual(threads)
  })
  it('does not run a queued picker focus after a newer foreign focus or actor retirement', async () => {
    const { host, element, doc, open } = await localPicker(), plus = await open()
    const foreign = document.createElement('textarea'); document.body.append(foreign)
    tap(plus); foreign.focus(); await host.$nextTick()
    expect(document.activeElement).toBe(foreign)
    host.closeCommentReaction(); host.refreshPanels()
    tap(await open()); doc.getSession().user = { id: 'bob' }; await host.$nextTick()
    expect(host.commentReactionContext).toBeNull()
    expect(document.activeElement).toBe(foreign)
    expect(element.querySelector('.lark-doc-comment-reaction-picker')).toBeNull()
  })
  it.each([false, true])('uses the real closed ShadowRoot focus owner, newer same-host foreign focus %s', async foreignWins => {
    const { host, element, open, shadow } = await localPicker({ shadow: 'closed' })
    const plus = await open(); plus.focus(); tap(plus)
    const foreign = document.createElement('textarea'); shadow.append(foreign)
    if (foreignWins) foreign.focus()
    await host.$nextTick()
    const input = element.querySelector('.lark-doc-comment-reaction-picker input')
    expect(input.isConnected).toBe(true)
    expect(document.activeElement).toBe(shadow.host)
    expect(shadow.activeElement).toBe(foreignWins ? foreign : input)
  })
  it('does not focus a picker after its real native owner is destroyed before the queued tick', async () => {
    const { doc, host, open } = await localPicker(), plus = await open(), focus = HTMLElement.prototype.focus, calls = []
    vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (options) {
      if (this.matches('.lark-doc-comment-reaction-picker input')) calls.push(options)
      return focus.call(this, options)
    })
    tap(plus); doc.destroy(); await host.$nextTick()
    expect(calls).toEqual([])
  })
  it('clears mobile fixed geometry on close before reopening the unchanged desktop local picker', async () => {
    expect(createCommentInteraction({}).methods.commentMenuPosition.length).toBe(3)
    const { host, element, open, more } = await localPicker()
    tap(await open()); await host.$nextTick()
    expect(element.querySelector('.lark-doc-comment-reaction-picker').style.position).toBe('fixed')
    host.closeCommentReaction(); host.refreshPanels()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 })
    host.openCommentReaction('picker-thread', 'picker-reply', { currentTarget: more() }); await host.$nextTick()
    expect(host.commentReactionContext.position).toBeNull()
    const picker = element.querySelector('.lark-doc-comment-reaction-picker')
    expect(picker.style.position).toBe(''); expect(picker.style.left).toBe(''); expect(picker.style.top).toBe('')
  })

})
