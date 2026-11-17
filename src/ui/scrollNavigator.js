/** Phone document navigation. It observes the live scroll root; it never edits content. */
export function createScrollNavigator({ host } = {}) {
  const doc = host.ownerDocument, win = doc.defaultView
  const el = doc.createElement('aside'), thumb = doc.createElement('button'), preview = doc.createElement('nav')
  el.className = 'lark-doc-scroll-navigator'
  thumb.type = 'button'; thumb.setAttribute('aria-label', '快速文档导航'); thumb.setAttribute('aria-expanded', 'false'); thumb.textContent = '▴\n━\n▾'
  preview.className = 'lark-doc-scroll-preview'; preview.setAttribute('aria-label', '快速标题列表'); preview.hidden = true
  el.append(thumb, preview)
  let state = {}, destroyed = false, idle = null, drag = null, moved = false
  const eligible = () => !destroyed && state.enabled !== false && state.content?.isConnected && win.matchMedia?.('(max-width: 760px) and (pointer: coarse)').matches
  function scrollRoot() {
    if (state.scrollRoot) return state.scrollRoot
    for (let node = state.content?.parentElement; node && node !== doc.body; node = node.parentElement) {
      if (/(auto|scroll)/.test(win.getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight) return node
    }
    return doc.scrollingElement || doc.documentElement
  }
  const bounds = () => ({ top: 96, range: Math.max(1, win.innerHeight - 240) })
  function stopDrag() {
    if (!drag) return
    const pointerId = drag.pointerId
    drag = null
    try { if (pointerId !== undefined) thumb.releasePointerCapture?.(pointerId) } catch { /* The browser may have released capture already. */ }
  }
  function hide() { stopDrag(); el.remove(); preview.hidden = true; thumb.setAttribute('aria-expanded', 'false'); win.clearTimeout(idle); idle = null }
  function later() { win.clearTimeout(idle); if (!drag && preview.hidden) idle = win.setTimeout(hide, 2200) }
  function current() {
    let active = state.items?.[0]?.pos
    const root = scrollRoot(), top = root === doc.scrollingElement || root === doc.documentElement ? 110 : root.getBoundingClientRect().top + 60
    for (const item of state.items || []) {
      const node = state.headingElement?.(item.pos)
      if (node?.getBoundingClientRect().top <= top) active = item.pos
    }
    return active
  }
  function paint() {
    const root = scrollRoot(), max = Math.max(0, root.scrollHeight - root.clientHeight), range = bounds()
    thumb.style.top = `${range.top + (max ? root.scrollTop / max : 0) * range.range}px`
    const active = current()
    preview.querySelectorAll('[data-heading-pos]').forEach(row => row.classList.toggle('is-active', Number(row.dataset.headingPos) === active))
  }
  function show() { if (!eligible()) { hide(); return } if (!el.isConnected) host.appendChild(el); paint(); later() }
  function renderPreview() {
    preview.replaceChildren()
    const context = state.contextKey, content = state.content
    const live = button => eligible() && button.isConnected && context === state.contextKey && content === state.content
    for (const item of state.items || []) {
      const row = doc.createElement('button'); row.type = 'button'; row.textContent = item.text || '无标题'; row.dataset.headingPos = String(item.pos)
      row.style.paddingLeft = `${12 + Math.max(0, item.level - 1) * 10}px`
      row.addEventListener('click', () => { if (!live(row)) return; state.onHeading?.(item.pos); hide() }); preview.appendChild(row)
    }
    const open = doc.createElement('button'); open.type = 'button'; open.dataset.action = 'outline'; open.textContent = '打开文档目录'
    open.addEventListener('click', () => { if (!live(open)) return; state.onOutline?.(current()); hide() }); preview.appendChild(open)
  }
  function onScroll(event) {
    if (!eligible()) return
    const root = scrollRoot()
    if (![root, doc, win].includes(event.target)) return
    show()
  }
  thumb.addEventListener('click', () => {
    if (moved) { moved = false; return }
    if (!eligible()) return
    preview.hidden = !preview.hidden; thumb.setAttribute('aria-expanded', String(!preview.hidden)); paint(); later()
  })
  thumb.addEventListener('pointerdown', event => {
    if (!eligible() || (event.button !== undefined && event.button !== 0)) return
    drag = { y: event.clientY, top: parseFloat(thumb.style.top) || bounds().top, pointerId: event.pointerId }; moved = false; win.clearTimeout(idle)
    thumb.setPointerCapture?.(event.pointerId)
  })
  function move(event) {
    if (!drag || (event.pointerId !== undefined && drag.pointerId !== undefined && event.pointerId !== drag.pointerId)) return
    if (!eligible()) { hide(); return }
    const delta = event.clientY - drag.y
    if (!moved && Math.abs(delta) < 5) return
    moved = true; event.preventDefault()
    const range = bounds(), root = scrollRoot(), ratio = Math.max(0, Math.min(1, (drag.top + delta - range.top) / range.range))
    root.scrollTop = ratio * Math.max(0, root.scrollHeight - root.clientHeight); paint()
  }
  function finish() { if (!drag) return; if (!eligible()) { hide(); return } stopDrag(); later() }
  function outside(event) { if (!el.contains(event.target) && !drag) hide() }
  function resize() { if (!eligible()) hide(); else if (el.isConnected) paint() }
  win.addEventListener('scroll', onScroll, true); win.addEventListener('resize', resize)
  doc.addEventListener('pointermove', move, { passive: false }); doc.addEventListener('pointerup', finish); doc.addEventListener('pointercancel', finish); doc.addEventListener('pointerdown', outside)
  return {
    el,
    focus() { if (!eligible()) return; show(); thumb.focus({ preventScroll: true }) },
    update(patch = {}) {
      if (destroyed) return
      if (patch.contextKey !== undefined && patch.contextKey !== state.contextKey) hide()
      Object.assign(state, patch); renderPreview(); if (!eligible()) hide(); else if (el.isConnected) paint()
    },
    destroy() {
      if (destroyed) return
      destroyed = true; hide(); state = {}
      win.removeEventListener('scroll', onScroll, true); win.removeEventListener('resize', resize)
      doc.removeEventListener('pointermove', move); doc.removeEventListener('pointerup', finish); doc.removeEventListener('pointercancel', finish); doc.removeEventListener('pointerdown', outside)
    },
  }
}
