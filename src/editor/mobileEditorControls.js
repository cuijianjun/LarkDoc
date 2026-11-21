import { TextSelection } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
import { DEFAULT_TEXT_COLOR, MOBILE_TEXT_COLOR_OPTIONS, MOBILE_TEXT_BACKGROUND_ROWS } from '../ui/palette'
import colorPaletteUiMixin from '../components/lark-doc/editor/colorPaletteUiMixin'
import calloutColorMixin from '../components/lark-doc/editor/calloutColorMixin'

// Mobile controls share the native host's commands, selection and teardown ownership.
export const mobileEditorMethods = {
    refreshToolbar() {
      const ui = this._toolbarUi
      if (!ui) return
      const anchor = this.$refs.toolbarHost
      const touch = this._mobileEditorMedia?.matches === true
      const { toolbarVisible, headerVisible } = this.larkDocConfig.layout
      const desktop = !touch && toolbarVisible
      if (this.headerMenuOpen && (!desktop || headerVisible)) this.closeHeaderMenu()
      const mobile = !!(touch && this.mobileEditorActive && this.writable()
        && this.editor.state.selection instanceof TextSelection && !this.menuOpen && !this.isvPanelOpen)
      const colorSheet = mobile && !!this.colorPaletteOpen && this.colorPaletteIsText
      this.$refs.root.classList.toggle('has-mobile-editor-bar', mobile && !colorSheet)
      if (colorSheet || (!desktop && !mobile)) ui.el.remove()
      else if (ui.el.parentNode !== anchor.parentNode) anchor.before(ui.el)
      ui.update({ ...this.buildToolbarState(), mobileAccessory: mobile, mobileStyle: this.mobileEditorStyle,
        activeAlign: this.editor?.getAttributes?.(this.editor.isActive('heading') ? 'heading' : 'paragraph')?.textAlign || 'left' })
    },
    hideMobileKeyboard() {
      this.mobileEditorActive = false
      this.editor?.view.dom.blur()
    },
    buildColorPaletteState() {
      const state = colorPaletteUiMixin.methods.buildColorPaletteState.call(this)
      if (state.isText && !this.toolbarEnabled('textStyle')) return { open: false, mobile: false }
      const mobile = !!(state.open && state.isText && this._mobileEditorMedia?.matches)
      return { ...state, mobile, ...(mobile ? { letters: MOBILE_TEXT_COLOR_OPTIONS, rows: MOBILE_TEXT_BACKGROUND_ROWS } : {}) }
    },
    backFromMobileColors() {
      if (!this._mobileEditorMedia?.matches || !this.colorPaletteIsText || !this.toolbarEnabled('textStyle') || !this.writable()) return
      this.colorPaletteOpen = ''
      this.editor.view.dom.focus()
    },
    applyColorPalette(value, targetOverride) {
      const target = targetOverride || this.colorPaletteOpen
      if (['textColor', 'textBackground'].includes(target) && !this.toolbarEnabled('textStyle')) return
      return calloutColorMixin.methods.applyColorPalette.call(this, value, targetOverride)
    },
    resetTextColors() {
      if (!this.toolbarEnabled('textStyle') || !this.writable()) return
      this.restoreSelection()
      this.editor.view.dom.focus()
      this.editor.chain().command(({ tr }) => { closeHistory(tr); return true }).unsetColor().unsetBackgroundColor().run()
      this.appliedTextStyle.textColor = DEFAULT_TEXT_COLOR
      this.appliedTextStyle.backgroundColor = 'transparent'
      this.colorPaletteOpen = ''
    },
}

export function bindMobileEditorControls({ host, editor, shell, listen, listeners }) {
  const document = shell.root.ownerDocument, window = document.defaultView
  const mobileMedia = window.matchMedia?.('(max-width: 760px) and (pointer: coarse)')
  host._mobileEditorMedia = mobileMedia
  // narrow 只跟宽度同口径（不带 pointer），否则桌面把窗口拖窄到 <761px 时
  // 目录/纸张内边距会和 CSS 媒体查询打架。
  const narrowMedia = window.matchMedia?.('(max-width: 760px)')
  const narrowChanged = () => { host.isNarrowViewport = narrowMedia?.matches === true }
  host.isNarrowViewport = narrowMedia?.matches === true
  if (narrowMedia?.addEventListener) listen(narrowMedia, 'change', narrowChanged)
  else if (narrowMedia?.addListener) { narrowMedia.addListener(narrowChanged); listeners.push(() => narrowMedia.removeListener(narrowChanged)) }
  const mobileViewport = () => {
    const viewport = window.visualViewport, rect = shell.root.getBoundingClientRect()
    const next = { left: Math.max(0, rect.left), width: Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(0, rect.left)),
      bottom: Math.max(0, window.innerHeight - (viewport ? viewport.height + viewport.offsetTop : window.innerHeight)) }
    if (Object.keys(next).some(key => host.mobileEditorStyle[key] !== next[key])) host.mobileEditorStyle = next
    if (!mobileMedia?.matches) host.mobileEditorActive = false
  }
  const mobileFocus = () => { if (mobileMedia?.matches && host.writable()) { host.mobileEditorActive = true; mobileViewport() } }
  const mobileMediaChanged = () => {
    if (mobileMedia?.matches) {
      host.closeBlockMenu()
      if (host.tablePicker) host.closeTablePicker()
    }
    mobileViewport()
    if (editor.isFocused) mobileFocus()
    host.refreshToolbar()
    host.parkActionsHost()
    host.bindToolbarObserver()
    host.refreshBlockHandle()
    host.refreshBlockMenu()
    host.refreshCommandMenu()
    host.refreshColorPalette()
  }
  editor.on('focus', mobileFocus)
  listeners.push(() => editor.off('focus', mobileFocus))
  listen(window, 'resize', mobileViewport)
  if (window.visualViewport) { listen(window.visualViewport, 'resize', mobileViewport); listen(window.visualViewport, 'scroll', mobileViewport) }
  if (mobileMedia?.addEventListener) listen(mobileMedia, 'change', mobileMediaChanged)
  else if (mobileMedia?.addListener) { mobileMedia.addListener(mobileMediaChanged); listeners.push(() => mobileMedia.removeListener(mobileMediaChanged)) }
  listen(document, 'pointerdown', event => { if (!shell.root.contains(event.target)) host.mobileEditorActive = false }, true)
  mobileMediaChanged()
  listen(document, 'focusin', event => {
    if (host.menuOpen || host.colorPaletteOpen || host.isvPanelOpen || shell.editorEl.contains(event.target) || host._toolbarUi?.el.contains(event.target)) return
    host.mobileEditorActive = false
  })
}
