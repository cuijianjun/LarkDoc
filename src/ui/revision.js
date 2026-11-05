/** RevisionPanel 原生 DOM 积木（阶段 5-G）。 */
import { iconNode } from './icon'
import { applyStyle, mountNode, setAttr, setText, syncChildren } from './dom'

const ICONS = { 'go-next': 'rev-next', 'go-previous': 'rev-prev', copyAnchor: 'link', reject: 'close', accept: 'rev-accept' }

function makeButton(button, item, handlers) {
  const node = document.createElement('button')
  node.type = 'button'
  node.className = 'lark-doc-revision-btn'
  if (button.tone === 'danger') node.classList.add('is-reject')
  if (button.tone === 'success') node.classList.add('is-accept')
  setAttr(node, 'aria-label', button.tooltip)
  node.appendChild(iconNode(ICONS[button.id], button.iconSize))
  node.addEventListener('mousedown', (event) => { event.preventDefault(); handlers.onButton(button.id, item.id) })
  return node
}

function createPanel(item, buttons, handlers) {
  const panel = document.createElement('div')
  panel.className = 'lark-doc-revision-panel'
  panel.setAttribute('role', 'dialog')
  panel.addEventListener('mouseenter', () => handlers.onEnter(item.id))
  panel.addEventListener('mouseleave', () => handlers.onLeave())
  const head = document.createElement('div'); head.className = 'lark-doc-revision-head'
  const label = document.createElement('span'); label.className = 'lark-doc-revision-label'; head.appendChild(label)
  const controls = document.createElement('div'); controls.className = 'lark-doc-revision-controls'
  const cells = buttons.map((button) => {
    const cell = document.createElement('span'); cell.className = 'lark-doc-revision-cell'
    if (button.split) { const split = document.createElement('span'); split.className = 'lark-doc-revision-split'; split.setAttribute('aria-hidden', 'true'); cell.appendChild(split) }
    else cell.appendChild(makeButton(button, item, handlers))
    return cell
  })
  syncChildren(controls, cells.map((node) => ({ node, on: true }))); head.appendChild(controls)
  const reply = document.createElement('div'); reply.className = 'lark-doc-revision-reply'
  const avatar = document.createElement('span'); avatar.className = 'lark-doc-revision-avatar'; avatar.setAttribute('aria-hidden', 'true'); avatar.appendChild(iconNode('rev-avatar', 18))
  const main = document.createElement('div'); main.className = 'lark-doc-revision-main'
  const meta = document.createElement('div'); meta.className = 'lark-doc-revision-meta'
  const author = document.createElement('span'); author.className = 'lark-doc-revision-author'
  const time = document.createElement('span'); time.className = 'lark-doc-revision-time'; time.textContent = '刚刚 （编辑过）'; meta.append(author, time)
  const body = document.createElement('div'); body.className = 'lark-doc-revision-body'; const strong = document.createElement('b'); body.appendChild(strong); main.append(meta, body); reply.append(avatar, main)
  const input = document.createElement('div'); input.className = 'lark-doc-revision-input'
  const zone = document.createElement('div'); zone.className = 'lark-doc-revision-input-zone'; zone.setAttribute('role', 'textbox'); zone.setAttribute('aria-label', '回复'); zone.tabIndex = 0; zone.textContent = '回复...'
  const image = document.createElement('button'); image.type = 'button'; image.className = 'lark-doc-revision-input-btn'; image.setAttribute('aria-label', '插入图片'); image.addEventListener('mousedown', (event) => event.preventDefault()); image.appendChild(iconNode('rev-image', 16)); input.append(zone, image)
  panel.append(head, reply)
  panel.__ld = { label, controls, buttons: cells.flatMap((cell) => [...cell.querySelectorAll('button')]), author, strong, body, input }
  return panel
}

export function createRevisionPanels({ host, handlers = {} } = {}) {
  const layer = document.createElement('div'); layer.className = 'lark-doc-revision-layer'
  const entries = new Map()
  function updateItem(entry, item, state) {
    const panel = entry.node; const d = panel.__ld
    panel.className = `lark-doc-revision-panel${state.readonly ? ' is-readonly' : ''}`
    setAttr(panel, 'aria-label', state.title); applyStyle(panel, { ...item.style, height: `${item.height}px` })
    setText(d.label, state.title); setText(d.author, item.author); setText(d.strong, `${item.summary.label}：`)
    setText(d.body, `“${item.summary.text}”`); d.body.insertBefore(d.strong, d.body.firstChild)
    d.buttons.forEach((button) => { const id = button.getAttribute('aria-label') === '下一个 (↓)' ? 'go-next' : button.getAttribute('aria-label') === '复制链接' ? 'copyAnchor' : button.classList.contains('is-reject') ? 'reject' : 'accept'; button.disabled = item.disabled.includes(id) })
    syncChildren(panel, [{ node: panel.children[0], on: true }, { node: panel.children[1], on: true }, { node: d.input, on: item.active && !state.readonly }])
  }
  return {
    el: layer,
    update(state = {}) {
      const items = state.items || []; const wanted = new Set(items.map((item) => item.id))
      items.forEach((item) => { let entry = entries.get(item.id); if (!entry) { entry = { node: createPanel(item, state.buttons || [], handlers) }; entries.set(item.id, entry) } updateItem(entry, item, state) })
      entries.forEach((entry, id) => { if (!wanted.has(id)) { if (entry.node.parentNode) entry.node.remove(); entries.delete(id) } })
      syncChildren(layer, items.map((item) => ({ node: entries.get(item.id).node, on: true })))
      mountNode(host, layer, items.length > 0)
    },
    destroy() { entries.forEach((entry) => entry.node.remove()); entries.clear(); layer.remove() },
  }
}
