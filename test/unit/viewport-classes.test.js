// @vitest-environment jsdom
/**
 * 宽度态（`lark-doc-narrow`）的落点口径。
 *
 * 守的是一个**真实发生过**的缺陷：`classList.toggle(name, force)` 的 force 传
 * `undefined` 会退化成「每次翻转」，挂载时加一次之后永不摘除 —— 1440px 桌面也带
 * `lark-doc-narrow`，于是目录被 CSS 藏掉、纸张内边距收到 16px。所以这里不只断言
 * 「窄屏加得上」，更要断言「宽屏摘得掉、重复同步幂等」。
 *
 * 第二条守口径：窄屏态只跟 `(max-width: 760px)`，不跟 `(pointer: coarse)`。
 * 桌面把窗口拖到 <761px 时，目录/内边距必须与 CSS 媒体查询同进同退。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createWorkspaceShell } from '../../src/ui/workspaceShell'
import { createWorkspaceState } from '../../src/workspace/WorkspaceController'
import { createNativeEditorHost } from '../../src/editor/nativeEditorHost'
import { bindMobileEditorControls } from '../../src/editor/mobileEditorControls'

const mounted = []
const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia')
afterEach(() => {
  mounted.splice(0).forEach(undo => undo())
  if (originalMatchMedia) Object.defineProperty(window, 'matchMedia', originalMatchMedia)
  else delete window.matchMedia
  document.body.replaceChildren()
})

function mountNativeHost() {
  const shell = createWorkspaceShell(document)
  document.body.append(shell.root)
  const runtime = createNativeEditorHost({ shell, props: { documentId: 'doc-viewport' },
    state: { ...createWorkspaceState({ initialContent: '<p>正文</p>', initialTitle: '宽度态' }), editor: null, sessionInstance: null },
    resolveImageFile: { cancelAll() {} } })
  mounted.push(() => { runtime.destroy?.(); shell.root.remove() })
  return { shell, host: runtime.host }
}

/** 可控媒体查询：`narrow` 为宽度态，`coarse` 为触控态；改值后派发 change。 */
function stubMatchMedia(initial) {
  const state = { ...initial }, medias = []
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: query => {
    const media = new EventTarget()
    const widthOnly = !/pointer/.test(query)
    Object.defineProperty(media, 'media', { value: query })
    Object.defineProperty(media, 'matches', { get: () => widthOnly ? state.narrow : state.narrow && state.coarse })
    medias.push({ media, query })
    return media
  } })
  return { state, fire(query) { const hit = medias.find(item => item.query === query); hit?.media.dispatchEvent(new Event('change')) } }
}

const WIDTH = '(max-width: 760px)'
const MOBILE = '(max-width: 760px) and (pointer: coarse)'

describe('宽度态：桌面目录与纸张内边距不被手机规则接管', () => {
  it('宽屏不带 narrow，窄屏加上，回宽摘掉，重复同步幂等', () => {
    const { shell, host } = mountNativeHost()
    host.isNarrowViewport = false
    host.syncViewportClasses()
    expect(shell.root.classList.contains('lark-doc-narrow')).toBe(false)
    host.syncViewportClasses() // 幂等：旧写法在这里会翻转成 true
    expect(shell.root.classList.contains('lark-doc-narrow')).toBe(false)
    host.isNarrowViewport = true
    host.syncViewportClasses()
    expect(shell.root.classList.contains('lark-doc-narrow')).toBe(true)
    host.isNarrowViewport = false
    host.syncViewportClasses()
    expect(shell.root.classList.contains('lark-doc-narrow')).toBe(false)
  })

  it('窄屏态只跟宽度媒体，不跟触控；桌面拖窄进窄屏、拉回即退出', () => {
    const media = stubMatchMedia({ narrow: false, coarse: false })
    const shell = { root: document.createElement('div') }
    document.body.append(shell.root)
    const host = { isNarrowViewport: undefined, mobileEditorStyle: { left: 0, width: 0, bottom: 0 }, mobileEditorActive: false,
      menuOpen: false, colorPaletteOpen: '', isvPanelOpen: false, writable: () => true,
      closeBlockMenu() {}, refreshToolbar() {}, parkActionsHost() {}, bindToolbarObserver() {},
      refreshBlockHandle() {}, refreshBlockMenu() {}, refreshCommandMenu() {}, refreshColorPalette() {} }
    const listeners = []
    const listen = (target, type, handler, capture = false) => {
      target.addEventListener(type, handler, capture)
      listeners.push(() => target.removeEventListener(type, handler, capture))
    }
    bindMobileEditorControls({ host, editor: { isFocused: false, on() {}, off() {} }, shell, listen, listeners })
    mounted.push(() => listeners.splice(0).forEach(off => off()))

    expect(host.isNarrowViewport).toBe(false)
    expect(host._mobileEditorMedia.matches).toBe(false)
    media.state.narrow = true
    media.fire(WIDTH)
    expect(host.isNarrowViewport).toBe(true)
    expect(host._mobileEditorMedia.matches).toBe(false) // 桌面非触控：不进手机编辑条
    media.state.narrow = false
    media.fire(WIDTH)
    expect(host.isNarrowViewport).toBe(false)
  })
})
