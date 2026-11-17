// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { createScrollNavigator } from '../../src/ui/scrollNavigator'
import { createTopBar } from '../../src/ui/topBar'
import { lockPageScroll } from '../../src/ui/dom'

let ui
const originalWidth = window.innerWidth, originalMedia = window.matchMedia
afterEach(() => {
  ui?.destroy(); document.body.replaceChildren(); vi.useRealTimers(); vi.restoreAllMocks()
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth }); window.matchMedia = originalMedia
})
it('shows only for body scrolling, navigates headings and drags without changing content, then cleans up', () => {
  vi.useFakeTimers()
  window.matchMedia = () => ({ matches: true })
  const host = document.createElement('section'), body = document.createElement('main'), other = document.createElement('div')
  host.append(body, other); document.body.append(host)
  Object.defineProperties(body, { scrollHeight: { value: 1800 }, clientHeight: { value: 600 } })
  const onHeading = vi.fn(), onOutline = vi.fn()
  ui = createScrollNavigator({ host })
  ui.update({ content: body, scrollRoot: body, contextKey: 'doc1', items: [{ pos: 4, text: '第一节', level: 1 }], onHeading, onOutline })
  other.dispatchEvent(new Event('scroll')); expect(ui.el.isConnected).toBe(false)
  body.dispatchEvent(new Event('scroll')); expect(ui.el.isConnected).toBe(true)
  ui.el.querySelector('[aria-label="快速文档导航"]').click()
  ui.el.querySelector('[data-heading-pos="4"]').click(); expect(onHeading).toHaveBeenCalledWith(4)
  body.dispatchEvent(new Event('scroll'))
  ui.el.querySelector('[aria-label="快速文档导航"]').click()
  ui.el.querySelector('[data-action="outline"]').click(); expect(onOutline).toHaveBeenCalledOnce()
  body.dispatchEvent(new Event('scroll'))
  const pointer = (type, y) => new MouseEvent(type, { clientY: y, bubbles: true, cancelable: true })
  const before = body.innerHTML
  ui.el.querySelector('button').dispatchEvent(pointer('pointerdown', 110))
  document.dispatchEvent(pointer('pointermove', 390)); document.dispatchEvent(pointer('pointerup', 390))
  expect(body.scrollTop).toBeGreaterThan(0); expect(body.innerHTML).toBe(before)
  vi.advanceTimersByTime(2500); expect(ui.el.isConnected).toBe(false)
  ui.destroy(); body.dispatchEvent(new Event('scroll')); expect(ui.el.isConnected).toBe(false)
})
it('resets on document change and never appears in desktop or denied state', () => {
  window.matchMedia = () => ({ matches: false })
  const host = document.createElement('section'), body = document.createElement('main'); host.append(body); document.body.append(host)
  ui = createScrollNavigator({ host }); ui.update({ content: body, scrollRoot: body, contextKey: 'doc1', items: [] })
  body.dispatchEvent(new Event('scroll')); expect(ui.el.isConnected).toBe(false)
  window.matchMedia = () => ({ matches: true }); ui.update({ enabled: false })
  body.dispatchEvent(new Event('scroll')); expect(ui.el.isConnected).toBe(false)
})

it('rejects a retired quick-outline entry after its document context changes', () => {
  window.matchMedia = () => ({ matches: true })
  const host = document.createElement('section'), body = document.createElement('main'); host.append(body); document.body.append(host)
  const onOutline = vi.fn()
  ui = createScrollNavigator({ host }); ui.update({ content: body, scrollRoot: body, contextKey: 'doc-a', items: [], onOutline })
  body.dispatchEvent(new Event('scroll')); ui.el.querySelector('button').click()
  const retired = ui.el.querySelector('[data-action="outline"]')
  ui.update({ contextKey: 'doc-b' }); retired.click()
  expect(onOutline).not.toHaveBeenCalled()
})

function pointerEvent(type, y, pointerId = 17) {
  return Object.defineProperty(new MouseEvent(type, { clientY: y, bubbles: true, cancelable: true }), 'pointerId', { value: pointerId })
}

it.each(['disabled', 'desktop', 'detached', 'context', 'destroy'])('retires a captured navigation drag after %s without consuming later movement', reason => {
  let phone = true
  window.matchMedia = () => ({ matches: phone })
  const host = document.createElement('section'), content = document.createElement('main')
  content.innerHTML = '<h1>正文</h1>'; host.append(content); document.body.append(host)
  Object.defineProperties(content, { scrollHeight: { value: 1800 }, clientHeight: { value: 600 } })
  content.scrollTop = 90
  ui = createScrollNavigator({ host })
  ui.update({ content, scrollRoot: content, contextKey: 'doc-a', items: [] })
  content.dispatchEvent(new Event('scroll'))
  const thumb = ui.el.querySelector('button'), captured = new Set()
  thumb.setPointerCapture = vi.fn(id => captured.add(id))
  thumb.releasePointerCapture = vi.fn(id => captured.delete(id))
  thumb.dispatchEvent(pointerEvent('pointerdown', 120))
  document.dispatchEvent(pointerEvent('pointermove', 170))
  expect(content.scrollTop).toBeGreaterThan(90)
  expect(captured).toEqual(new Set([17]))
  if (reason === 'disabled') ui.update({ enabled: false })
  if (reason === 'desktop') { phone = false; window.dispatchEvent(new Event('resize')) }
  if (reason === 'detached') content.remove()
  if (reason === 'context') ui.update({ contextKey: 'doc-b' })
  if (reason === 'destroy') ui.destroy()
  // Re-eligibility does not revive the original pointer's cancelled gesture.
  if (reason === 'disabled') ui.update({ enabled: true })
  if (reason === 'desktop') { phone = true; window.dispatchEvent(new Event('resize')) }
  const before = content.scrollTop, lateMove = pointerEvent('pointermove', 480)
  document.dispatchEvent(lateMove)
  document.dispatchEvent(pointerEvent('pointerup', 480))
  expect(content.scrollTop).toBe(before)
  expect(lateMove.defaultPrevented).toBe(false)
  expect(thumb.releasePointerCapture).toHaveBeenCalledExactlyOnceWith(17)
  expect(captured.size).toBe(0)
  expect(content.innerHTML).toBe('<h1>正文</h1>')
})

function scrolledOutline() {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
  window.matchMedia = () => ({ matches: true })
  const host = document.createElement('section'), main = document.createElement('main'), paper = document.createElement('div'), content = document.createElement('div'), overlay = document.createElement('div')
  host.className = 'lark-doc'; main.className = 'lark-doc-main'; main.style.overflow = 'auto'; main.style.overflowY = 'auto'; paper.className = 'lark-doc-paper'; content.className = 'lark-doc-editor-content'
  content.innerHTML = '<h1>第一节</h1><h2>第八节</h2><h2>最后一节</h2>'
  paper.append(content); main.append(paper); host.append(main, overlay); document.body.append(host)
  Object.defineProperties(main, { clientHeight: { value: 600 }, scrollHeight: { value: 4200 } }); main.scrollTop = 3500
  const heading = new Map([[4, content.children[0]], [8, content.children[1]], [12, content.children[2]]])
  for (const [pos, node] of heading) node.getBoundingClientRect = () => ({ top: pos === 12 ? 600 : -3500 + pos * 100 })
  const onHeading = vi.fn()
  let state = { title: '文档', referenceMobileMenu: true, headerVisible: true, outlineVisible: true, outlineOpen: false,
    mobileContextKey: 'doc-a|person-a', documentContent: content, activeHeading: 4, headingElement: pos => heading.get(pos),
    outlineItems: [...heading].map(([pos, node]) => ({ pos, level: pos === 4 ? 1 : 2, text: node.textContent })), onOutlineHeading: onHeading }
  const paint = () => ui.update(state)
  ui = createTopBar({ host, paperHost: paper, overlayHost: overlay, handlers: { toggleOutline: () => { state = { ...state, outlineOpen: !state.outlineOpen }; paint() } } })
  paint(); paper.querySelector('.lark-doc-mobile-document-header').getBoundingClientRect = () => ({ top: -3500, bottom: -3400 })
  const open = () => {
    main.dispatchEvent(new Event('scroll'))
    host.querySelector('[aria-label="快速文档导航"]').click()
    host.querySelector('[data-action="outline"]').click()
  }
  return { host, main, paper, content, overlay, onHeading, open, set: patch => { state = { ...state, ...patch }; paint() } }
}

it('keeps current pointer dragging and a fresh tap available for readonly reading navigation', () => {
  const { host, main, content, set } = scrolledOutline(), before = content.innerHTML
  set({ readonly: true }); main.scrollTop = 90
  main.dispatchEvent(new Event('scroll'))
  const thumb = host.querySelector('[aria-label="快速文档导航"]')
  thumb.dispatchEvent(pointerEvent('pointerdown', 120))
  document.dispatchEvent(pointerEvent('pointermove', 170))
  document.dispatchEvent(pointerEvent('pointerup', 170))
  expect(main.scrollTop).toBeGreaterThan(90)
  thumb.click()
  expect(thumb.getAttribute('aria-expanded')).toBe('false')
  thumb.dispatchEvent(pointerEvent('pointerdown', 180))
  document.dispatchEvent(pointerEvent('pointerup', 180))
  thumb.click()
  expect(thumb.getAttribute('aria-expanded')).toBe('true')
  expect(host.querySelector('[data-action="outline"]').isConnected).toBe(true)
  expect(content.innerHTML).toBe(before)
})

it('opens a fixed overlay outline from the scrolled float, keeps inside touch live and navigates its actual heading', () => {
  const { host, main, paper, content, overlay, onHeading, open } = scrolledOutline(), before = content.innerHTML, overflow = document.body.style.overflow
  open()
  const sheet = overlay.querySelector('[role="dialog"][aria-label="目录"]')
  expect(sheet).not.toBeNull()
  expect(paper.querySelector('.lark-doc-document-outline-popover')).toBeNull()
  expect(document.body.style.overflow).toBe('hidden'); expect(main.style.overflow).toBe('hidden')
  const active = sheet.querySelector('[data-heading-pos="8"]')
  expect(active.classList.contains('is-active')).toBe(true)
  active.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
  expect(sheet.isConnected).toBe(true)
  active.click()
  expect(onHeading).toHaveBeenCalledExactlyOnceWith(8)
  expect(overlay.querySelector('[role="dialog"][aria-label="目录"]')).toBeNull()
  expect(document.body.style.overflow).toBe(overflow); expect(main.style.overflow).toBe('auto')
  expect(content.innerHTML).toBe(before)
  host.querySelector('[aria-label="文内目录"]').click()
  expect(paper.querySelector('.lark-doc-document-outline-popover')).not.toBeNull()
  expect(overlay.querySelector('[aria-label="目录"]')).toBeNull()
})

it('closes float outline by X, Escape or backdrop and restores only its own scroll locks', () => {
  const { host, main, open } = scrolledOutline(), before = document.body.style.overflow
  const unlockOther = lockPageScroll(document.body)
  try {
    for (const close of ['button', 'escape', 'backdrop']) {
      open()
      const sheet = host.querySelector('[aria-label="目录"]')
      expect(sheet).not.toBeNull()
      const first = sheet.querySelector('[aria-label="关闭目录"]'), last = sheet.querySelector('[data-heading-pos="12"]')
      last.focus(); last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
      expect(document.activeElement).toBe(first)
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
      expect(document.activeElement).toBe(last)
      if (close === 'button') first.click()
      if (close === 'escape') sheet.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      if (close === 'backdrop') host.querySelector('.lark-doc-float-outline-mask').click()
      expect(host.querySelector('[aria-label="目录"]')).toBeNull()
      expect(document.body.style.overflow).toBe('hidden'); expect(main.style.overflow).toBe('auto')
    }
  } finally { unlockOther() }
  expect(document.body.style.overflow).toBe(before)
})

it.each(['context', 'denied', 'destroy', 'desktop'])('retires float outline and refuses old heading controls after %s', reason => {
  const fixture = scrolledOutline(), before = document.body.style.overflow
  fixture.open()
  const row = fixture.host.querySelector('[aria-label="目录"] [data-heading-pos="8"]')
  if (reason === 'context') fixture.set({ mobileContextKey: 'doc-b|person-b' })
  if (reason === 'denied') fixture.set({ outlineVisible: false })
  if (reason === 'destroy') ui.destroy()
  if (reason === 'desktop') { Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 }); window.matchMedia = () => ({ matches: false }); window.dispatchEvent(new Event('resize')) }
  expect(fixture.host.querySelector('[aria-label="目录"]')).toBeNull()
  expect(document.body.style.overflow).toBe(before); expect(fixture.main.style.overflow).toBe('auto')
  row.click(); expect(fixture.onHeading).not.toHaveBeenCalled()
})
