// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createLazyUi } from '../../src/ui/lazy'
import { createOverlays } from '../../src/ui/overlays'
import { LarkDoc } from '../../src/LarkDoc'

const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }

describe('lazy UI lifecycle', () => {
  it('keeps closed panels cold and applies the latest state and focus once loaded', async () => {
    let resolve
    const load = vi.fn(() => new Promise(done => { resolve = done }))
    const view = { update: vi.fn(), focusInput: vi.fn(), destroy: vi.fn() }
    const create = vi.fn(() => view)
    const ui = createLazyUi({ load, create })
    ui.update({ open: false })
    expect(load).not.toHaveBeenCalled()
    ui.update({ open: true, value: 'old' })
    ui.focusInput()
    ui.update({ open: true, value: 'current' })
    await settle()
    expect(load).toHaveBeenCalledTimes(1)
    resolve({})
    await settle()
    expect(create).toHaveBeenCalledTimes(1)
    expect(view.update).toHaveBeenLastCalledWith({ open: true, value: 'current' })
    expect(view.focusInput).toHaveBeenCalledOnce()
    ui.destroy()
    expect(view.destroy).toHaveBeenCalledOnce()
  })

  it.each(['close', 'destroy'])('does not resurrect a panel after %s during loading', async action => {
    let resolve
    const create = vi.fn()
    const ui = createLazyUi({ load: () => new Promise(done => { resolve = done }), create })
    ui.update({ open: true })
    await settle()
    if (action === 'close') ui.update({ open: false })
    else ui.destroy()
    resolve({})
    await settle()
    expect(create).not.toHaveBeenCalled()
  })

  it('reports a failed load once, then retries when the user reopens', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({})
    const onError = vi.fn()
    const view = { update: vi.fn(), destroy: vi.fn() }
    const ui = createLazyUi({ load, create: () => view, onError })
    ui.update({ open: true })
    await settle()
    ui.update({ open: true, value: 'still open' })
    expect(load).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledOnce()
    ui.update({ open: false })
    ui.update({ open: true, value: 'retry' })
    await settle()
    expect(load).toHaveBeenCalledTimes(2)
    expect(view.update).toHaveBeenLastCalledWith({ open: true, value: 'retry' })
    ui.destroy()
  })

  it('does not report a late load failure after the user has closed the panel', async () => {
    let reject
    const onError = vi.fn()
    const ui = createLazyUi({ load: () => new Promise((_, fail) => { reject = fail }), onError })
    ui.update({ open: true })
    await settle()
    ui.update({ open: false })
    reject(new Error('cancelled request'))
    await settle()
    expect(onError).not.toHaveBeenCalled()
    ui.destroy()
  })

  it('leaves cold menu commands synchronous and only queues UI focus', async () => {
    let resolve
    const view = { update: vi.fn(), choose: vi.fn(), focusSearch: vi.fn(), destroy: vi.fn() }
    const ui = createLazyUi({ load: () => new Promise(done => { resolve = done }), create: () => view })
    ui.update({ open: true })
    ui.focusSearch()
    expect(ui.choose).toBeUndefined()
    await settle()
    resolve({})
    await settle()
    expect(view.focusSearch).toHaveBeenCalledOnce()
    expect(view.choose).not.toHaveBeenCalled()
    ui.choose()
    expect(view.choose).toHaveBeenCalledOnce()
    ui.destroy()
  })

  it.each(['current', 'moved', 'closed'])('only replays a submenu display for the current open item (%s)', async action => {
    let resolve
    const view = { update: vi.fn(), showSubmenu: vi.fn(), destroy: vi.fn() }
    const ui = createLazyUi({ load: () => new Promise(done => { resolve = done }), create: () => view })
    ui.update({ open: true, activeId: 'diagram' })
    ui.showSubmenu('diagram')
    await settle()
    if (action === 'moved') ui.update({ open: true, activeId: 'quote' })
    if (action === 'closed') ui.update({ open: false, activeId: 'diagram' })
    resolve({})
    await settle()
    expect(view.showSubmenu).toHaveBeenCalledTimes(action === 'current' ? 1 : 0)
    ui.destroy()
  })

  it('allows pointer dismissal and link leave while no lazy DOM exists', async () => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, storage: 'none', content: '<p>正文</p>' })
    const errors = []
    const onError = event => { errors.push(event.error); event.preventDefault() }
    window.addEventListener('error', onError)
    try {
      const host = doc._handle.nativeHost.host
      expect(host._linkToolsUi.el).toBeNull()
      expect(() => host.onLinkMouseOut({ relatedTarget: document.body })).not.toThrow()
      host.linkDialog = true
      expect(host._dialogsUi.link.el).toBeNull()
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      expect(host.linkDialog).toBe(false)
      await vi.dynamicImportSettled()
      expect(element.querySelector('.lark-doc-link-dialog')).toBeNull()
      expect(errors).toEqual([])
    } finally {
      window.removeEventListener('error', onError)
      doc.destroy()
      element.remove()
    }
  })

  it('cancels a cold bubble, then renders the current controls when selected again', async () => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, storage: 'none', content: '<p>可选择的正文</p>' })
    try {
      const host = doc._handle.nativeHost.host
      host.bubbleVisible = true
      host.refreshBubbleBar()
      expect(host._bubbleUi.el).toBeNull()
      host.bubbleVisible = false
      host.refreshBubbleBar()
      await vi.dynamicImportSettled()
      expect(element.querySelector('.lark-doc-bubble')).toBeNull()
      host.bubbleVisible = true
      host.refreshBubbleBar()
      await vi.dynamicImportSettled()
      expect(element.querySelector('.lark-doc-bubble button')).not.toBeNull()
      doc.setReadonly(true)
      await vi.waitFor(() => expect(element.querySelector('.lark-doc-bubble')).toBeNull())
    } finally { doc.destroy(); element.remove() }
  })

  it('renders permission masking and the share entry synchronously before any overlay loads', () => {
    const host = document.createElement('div')
    const onRequestAccess = vi.fn()
    const ui = createOverlays({ host, handlers: { onRequestAccess } })
    ui.update({ shareViewMaskVisible: true, shareEntryVisible: false, shareEntryLabel: '分享' })
    expect(host.querySelector('[aria-label="你没有查看权限"]')).not.toBeNull()
    expect(host.querySelector('.lark-doc-share-entry')).toBeNull()
    host.querySelector('.lark-doc-share-mask button').click()
    expect(onRequestAccess).toHaveBeenCalledOnce()
    ui.update({ shareViewMaskVisible: false, shareEntryVisible: true, shareEntryLabel: '分享只读链接' })
    expect(host.querySelector('.lark-doc-share-mask')).toBeNull()
    expect(host.querySelector('button').textContent).toBe('分享只读链接')
    expect(host.querySelector('.lark-doc-share-popover')).toBeNull()
    ui.destroy()
    expect(host.children).toHaveLength(0)
  })
})
