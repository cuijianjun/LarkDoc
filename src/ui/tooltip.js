/** Shared, non-interactive tooltip. Content is always rendered as plain text. */
const inPopup = element => !!element.closest('[role="menu"], [role="listbox"], [role="dialog"], [role="alertdialog"]')

export function createTooltip({ host, delay = 150 }) {
  const owner = host.ownerDocument, win = owner.defaultView
  const tip = owner.createElement('div')
  tip.className = 'lark-doc-tooltip'
  tip.id = `lark-doc-tip-${Math.random().toString(36).slice(2)}`
  tip.setAttribute('role', 'tooltip')
  const bindings = new Set()
  let anchor = null, read = null, timer = null, destroyed = false
  const hide = () => {
    win.clearTimeout(timer); timer = null
    if (anchor) {
      const ids = (anchor.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== tip.id)
      if (ids.length) anchor.setAttribute('aria-describedby', ids.join(' '))
      else anchor.removeAttribute('aria-describedby')
    }
    anchor = null; read = null; tip.remove()
  }
  const render = () => {
    timer = null
    if (destroyed || !anchor?.isConnected || inPopup(anchor)) { hide(); return }
    const nativeTitle = anchor.getAttribute('title')
    if (nativeTitle) { anchor.dataset.tooltipTitle = nativeTitle; anchor.removeAttribute('title') }
    const content = read()
    if (content === null || content === false) { hide(); return }
    const data = content || {}
    const a = anchor.getBoundingClientRect()
    if (a.width <= 0 || a.height <= 0) { hide(); return }
    const title = data.title || anchor.dataset.tooltipTitle || anchor.getAttribute('aria-label') || anchor.textContent
    tip.replaceChildren()
    for (const line of [title + (data.shortcut ? ` (${data.shortcut})` : ''), data.markdown && `Markdown: ${data.markdown}`, data.description]) {
      if (!line) continue
      const row = owner.createElement('div'); row.textContent = line; tip.appendChild(row)
    }
    (host.closest('.lark-doc') || host).appendChild(tip)
    const ids = new Set((anchor.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean))
    ids.add(tip.id); anchor.setAttribute('aria-describedby', [...ids].join(' '))
    const b = tip.getBoundingClientRect()
    const center = a.left + a.width / 2
    const left = Math.max(8, Math.min(center - b.width / 2, win.innerWidth - b.width - 8))
    const below = a.top < b.height + 12
    tip.classList.toggle('is-below', below)
    tip.style.left = `${left}px`
    tip.style.top = `${Math.max(8, below ? a.bottom + 10 : a.top - b.height - 10)}px`
    tip.style.setProperty('--ld-tip-arrow', `${Math.max(10, Math.min(b.width - 10, center - left))}px`)
  }
  const show = (element, getContent = () => ({})) => {
    if (destroyed) return
    // Keep both native and custom hints out of popup controls.
    if (element.title) { element.dataset.tooltipTitle = element.title; element.removeAttribute('title') }
    if (inPopup(element)) { hide(); return }
    if (anchor === element) return
    hide(); anchor = element; read = getContent
    timer = win.setTimeout(render, delay)
  }
  win.addEventListener('scroll', hide, true)
  win.addEventListener('resize', hide)
  owner.addEventListener('keydown', hide, true)
  return {
    show, hide,
    refresh() { if (anchor && !timer) render() },
    bind(element, getContent = () => ({})) {
      const enter = () => show(element, getContent)
      const leave = () => { if (anchor === element) hide() }
      const events = [['mouseenter', enter], ['focus', enter], ['mouseleave', leave], ['blur', leave], ['mousedown', leave]]
      events.forEach(([name, handler]) => element.addEventListener(name, handler))
      const unbind = () => { leave(); events.forEach(([name, handler]) => element.removeEventListener(name, handler)); bindings.delete(unbind) }
      bindings.add(unbind)
      return unbind
    },
    destroy() { destroyed = true; hide(); [...bindings].forEach(unbind => unbind()); win.removeEventListener('scroll', hide, true); win.removeEventListener('resize', hide); owner.removeEventListener('keydown', hide, true) },
  }
}

/** The toolbar keeps only delegation in the initial graph; content loads on demand. */
export function createTooltipLayer({ host }) {
  const tip = createTooltip({ host })
  let anchor = null
  return {
    update(state = {}) {
      const next = state.open ? state.anchor : null
      if (next !== anchor) { anchor = next; if (next) tip.show(next); else tip.hide() }
      else tip.refresh()
    },
    destroy() { tip.destroy() },
  }
}
