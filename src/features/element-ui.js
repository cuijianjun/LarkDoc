/** Low-frequency UI factories keep a synchronous handle and load only when visible. */
import { loadFeature, readFeature } from '../core/features/registry'
import { configSignature } from '../ui/bubbleConfig'

export function createDeferredUi(name, options, visible = state => state.open, fallback, pack = 'ui') {
  let ui
  let state = {}
  let pending
  let destroyed = false
  let focus
  let errorNode
  let config = options.config
  let signature = configSignature(config)
  const host = options.host
  const clearError = () => { if (errorNode) errorNode.remove(); errorNode = null }
  const requestFocus = method => {
    if (destroyed || !visible(state)) return
    if (ui) ui[method]()
    else focus = method
  }
  const mount = api => {
    if (destroyed || !visible(state)) return
    clearError()
    ui = api[name](config === options.config ? options : { ...options, config })
    ui.update(state)
    if (focus) { const method = focus; focus = null; ui[method]() }
    if (options.onReady) options.onReady()
  }
  const update = patch => {
    if (destroyed) return
    if ('kind' in patch && patch.kind !== state.kind) focus = null
    state = { ...state, ...patch }
    if (!visible(state)) { focus = null; clearError() }
    if (ui) { ui.update(state); return }
    if (!visible(state) || pending) return
    // 预加载或前一次打开后保持同步，避免已缓存面板也多等一拍。
    // 面板包已按触发时机拆开：只有本包负责的那个工厂真的在表里才算就绪，
    // 否则去拉本包——拿半个 api 去 mount 只会在 api[name] 上撞到 undefined。
    const registered = readFeature('ui.ready')
    if (registered && typeof registered[name] === 'function') { mount(registered); return }
    pending = loadFeature(pack, fallback).then(mount).catch(error => {
      if (destroyed || !visible(state) || !host) return
      clearError()
      const document = host.ownerDocument
      errorNode = document.createElement('button')
      errorNode.type = 'button'
      errorNode.setAttribute('role', 'alert')
      errorNode.textContent = `${error.message}；点击重试`
      errorNode.addEventListener('click', () => update({}))
      host.appendChild(errorNode)
      const Event = document.defaultView.CustomEvent
      host.dispatchEvent(new Event('lark-doc-error', { bubbles: true, detail: { error } }))
    }).finally(() => { pending = null })
  }
  return {
    get el() { return ui && ui.el },
    get submenuEl() { return ui && ui.submenuEl },
    // A cold menu keeps the host fallback; once mounted Enter must use the
    // actual menu chooser so submenu commands retain their synchronous behavior.
    get choose() { return !destroyed && ui && typeof ui.choose === 'function' ? (...args) => ui.choose(...args) : undefined },
    update,
    hide() {
      if (destroyed) return
      state = { ...state, open: false }; focus = null; clearError()
      ui?.hide()
    },
    setConfig(next) {
      if (destroyed) return false
      const nextSignature = configSignature(next)
      const changed = signature !== nextSignature
      signature = nextSignature
      config = next
      return ui ? ui.setConfig(next) : changed
    },
    positionHeadingMenu() { ui?.positionHeadingMenu() },
    positionAlignMenu() { ui?.positionAlignMenu() },
    focusInput: () => requestFocus('focusInput'),
    focusFirstField: () => requestFocus('focusFirstField'),
    focusTableGrid: () => requestFocus('focusTableGrid'),
    focusClose: () => requestFocus('focusClose'),
    focusText: () => requestFocus('focusText'),
    focusSearch: () => requestFocus('focusSearch'),
    focusTemplateSearch: () => requestFocus('focusTemplateSearch'),
    focusImageAI: () => requestFocus('focusImageAI'),
    focus: () => requestFocus('focus'),
    destroy() { destroyed = true; focus = null; state = {}; clearError(); if (ui) ui.destroy(); ui = null },
  }
}
