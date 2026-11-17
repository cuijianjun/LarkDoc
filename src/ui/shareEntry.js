/** Permission denial and the persistent share entry stay synchronous. */
import { mountNode, setAttr, setText, syncChildren } from './dom'

export function createShareEntry({ host, handlers = {} } = {}) {
  let current = {}, destroyed = false
  const node = (tag, className, value) => {
    const el = document.createElement(tag); el.className = className
    if (value !== undefined) el.textContent = value
    return el
  }
  const layer = node('div', 'lark-doc-share-layer')
  const mask = node('div', 'lark-doc-share-mask')
  setAttr(mask, 'role', 'alertdialog'); setAttr(mask, 'aria-label', '你没有查看权限')
  const card = node('div', 'lark-doc-share-mask-card'), icon = node('span', 'lark-doc-share-mask-icon')
  icon.setAttribute('aria-hidden', 'true')
  icon.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="9.5" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2.5"/></svg>'
  const request = node('button', 'lark-doc-share-btn-filled', '申请权限'); request.type = 'button'
  request.addEventListener('click', () => { if (!destroyed && mask.isConnected && current.shareViewMaskVisible) handlers.onRequestAccess?.() })
  card.append(icon, node('p', 'lark-doc-share-mask-title', '你没有查看权限'), request); mask.append(card)
  const entry = node('div', 'lark-doc-share-entry'), trigger = node('button', 'lark-doc-share-btn-filled')
  trigger.type = 'button'
  trigger.addEventListener('click', event => { if (!destroyed && entry.isConnected && current.shareEntryVisible) handlers.onToggleSharePopover?.(event) })
  entry.append(trigger)
  const toast = node('div', 'lark-doc-share-toast'), message = node('span', 'lark-doc-share-toast-text')
  toast.setAttribute('role', 'status'); toast.append(message)
  return {
    el: layer,
    update(state = {}) {
      if (destroyed) return
      current = state
      setText(trigger, state.shareEntryLabel); setAttr(trigger, 'aria-label', state.shareEntryLabel)
      toast.className = `lark-doc-share-toast is-${state.shareToast ? state.shareToast.kind : 'success'}`
      setText(message, state.shareToast && state.shareToast.text)
      syncChildren(layer, [{ node: mask, on: !!state.shareViewMaskVisible }, { node: entry, on: !!state.shareEntryVisible }, { node: toast, on: !!state.shareToast }])
      mountNode(host, layer, true)
    },
    destroy() { destroyed = true; current = {}; layer.remove() },
  }
}
