/** Keep the latest view state while an unopened UI loads; never queue business actions. */
export function createLazyUi({ load, create, isOpen = state => !!state?.open, onError, onReady } = {}) {
  let state = null
  let ui = null
  let pending = null
  let attempted = false
  let destroyed = false
  let focus = null
  let submenuId = ''
  const open = () => !!state && isOpen(state)
  const start = () => {
    if (destroyed || pending || attempted || !open()) return
    attempted = true
    pending = Promise.resolve().then(load).then(module => {
      if (destroyed || !open()) return
      ui = create(module)
      ui.update(state)
      if (submenuId) ui.showSubmenu?.(submenuId)
      submenuId = ''
      if (focus) ui[focus.method]?.(...focus.args)
      focus = null
      onReady?.()
    }).catch(error => {
      if (!destroyed) {
        ui?.destroy()
        ui = null
        if (open()) onError?.(error)
      }
    }).finally(() => { pending = null })
  }
  const focusWhenReady = (method, args) => {
    if (destroyed) return
    if (ui) ui[method]?.(...args)
    else focus = { method, args }
  }
  return {
    get el() { return ui?.el || null },
    // Enter before a cold menu finishes loading still uses the controller's synchronous fallback.
    get choose() { return ui?.choose?.bind(ui) },
    update(next) {
      if (destroyed) return
      state = next
      if (!open()) { attempted = false; focus = null; submenuId = '' }
      else if (submenuId && next.activeId !== submenuId) submenuId = ''
      if (ui) ui.update(next)
      else start()
    },
    focusInput(...args) { focusWhenReady('focusInput', args) },
    focus(...args) { focusWhenReady('focus', args) },
    focusReply(...args) { focusWhenReady('focusReply', args) },
    focusSearch(...args) { focusWhenReady('focusSearch', args) },
    focusTableGrid(...args) { focusWhenReady('focusTableGrid', args) },
    focusFirstField(...args) { focusWhenReady('focusFirstField', args) },
    focusClose(...args) { focusWhenReady('focusClose', args) },
    focusTemplateSearch(...args) { focusWhenReady('focusTemplateSearch', args) },
    focusImageAI(...args) { focusWhenReady('focusImageAI', args) },
    showSubmenu(id) {
      if (destroyed || !open()) return
      if (ui) ui.showSubmenu?.(id)
      else submenuId = id
    },
    heightOf(...args) { return ui?.heightOf?.(...args) || 0 },
    destroy() { destroyed = true; focus = null; submenuId = ''; state = null; ui?.destroy(); ui = null },
  }
}

/** Load a DOM factory on first open while controllers keep ownership of commands and permissions. */
export function createLazyView(load, factory, options, config) {
  return createLazyUi({ load, create: module => module[factory](options), ...config })
}
