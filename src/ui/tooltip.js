/** Shared, non-interactive tooltip. Content is always rendered as plain text. */
const inPopup = element => !!element.closest('[role="menu"], [role="listbox"], [role="dialog"], [role="alertdialog"]')

/**
 * @param {object} options
 * @param {HTMLElement} options.host 提示层的挂载宿主（会挪到最近的 `.lark-doc` 里）
 * @param {number} [options.delay] 悬停多久出现
 * @param {boolean} [options.allowInPopup] 允许在 `role="menu"` 等弹层**内部**出提示。
 *   缺省关闭：弹层里的控件靠自身 label / `aria-description` 表达，不叠提示。
 *   但「➕ 菜单的纯图标格」这类**本身就是功能栏**的弹层需要开它（见 `hoverTips.js`）。
 */
export function createTooltip({ host, delay = 150, allowInPopup = false }) {
  const owner = host.ownerDocument, win = owner.defaultView
  const tip = owner.createElement('div')
  tip.className = 'lark-doc-tooltip'
  tip.id = `lark-doc-tip-${Math.random().toString(36).slice(2)}`
  tip.setAttribute('role', 'tooltip')
  const bindings = new Set()
  let anchor = null, read = null, timer = null, destroyed = false, globals = false
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
    if (destroyed || !anchor?.isConnected || (!allowInPopup && inPopup(anchor))) { hide(); return }
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
    const fullscreen = owner.fullscreenElement
    const container = fullscreen?.contains(anchor) ? fullscreen : host.closest('.lark-doc') || host
    container.appendChild(tip)
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
  /**
   * 全局收起监听**首次出提示时**才挂：没有悬停就没有 window 监听，
   * 宿主里成百个 UI 实例（句柄、表格浮窗、命令菜单）不会各占一份。
   */
  const bindGlobals = () => {
    if (globals || destroyed) return
    globals = true
    win.addEventListener('scroll', hide, true)
    win.addEventListener('resize', hide)
    owner.addEventListener('keydown', hide, true)
  }
  const unbindGlobals = () => {
    if (!globals) return
    globals = false
    win.removeEventListener('scroll', hide, true)
    win.removeEventListener('resize', hide)
    owner.removeEventListener('keydown', hide, true)
  }
  const show = (element, getContent = () => ({})) => {
    if (destroyed) return
    // Keep both native and custom hints out of popup controls.
    if (element.title) { element.dataset.tooltipTitle = element.title; element.removeAttribute('title') }
    if (!allowInPopup && inPopup(element)) { hide(); return }
    if (anchor === element) return
    hide(); anchor = element; read = getContent
    bindGlobals()
    timer = win.setTimeout(render, delay)
  }
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
    destroy() { destroyed = true; hide(); [...bindings].forEach(unbind => unbind()); unbindGlobals() },
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
