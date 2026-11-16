/** 同步权限遮罩和分享入口；低频浮层在实际打开时加载。 */
import { mountNode, setAttr, setText } from './dom'
import { createLazyUi } from './lazy'

export function createOverlays({ host, handlers = {} } = {}) {
  const el = document.createElement('div')
  el.className = 'lark-doc-p6b-layer'
  const share = document.createElement('div')
  share.className = 'lark-doc-share-layer'
  const mask = document.createElement('div')
  mask.className = 'lark-doc-share-mask'
  mask.setAttribute('role', 'alertdialog')
  mask.setAttribute('aria-label', '你没有查看权限')
  const card = document.createElement('div')
  card.className = 'lark-doc-share-mask-card'
  const icon = document.createElement('span')
  icon.className = 'lark-doc-share-mask-icon'
  icon.setAttribute('aria-hidden', 'true')
  icon.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="9.5" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2.5"/></svg>'
  const title = document.createElement('p')
  title.className = 'lark-doc-share-mask-title'
  title.textContent = '你没有查看权限'
  const request = document.createElement('button')
  request.type = 'button'
  request.className = 'lark-doc-share-btn-filled'
  request.textContent = '申请权限'
  request.addEventListener('click', () => handlers.onRequestAccess?.())
  card.append(icon, title, request)
  mask.appendChild(card)
  const entry = document.createElement('div')
  entry.className = 'lark-doc-share-entry'
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'lark-doc-share-btn-filled'
  button.addEventListener('click', event => handlers.onToggleSharePopover?.(event))
  entry.appendChild(button)
  el.appendChild(share)
  const views = createLazyUi({
    load: () => import('./overlayViews'),
    create: module => module.createOverlays({ host: el, handlers }),
    isOpen: state => !!(state.sharePopoverOpen || state.permissionDialogOpen || state.secureLinkConfirmOpen || state.passwordDialogOpen || state.shareToast || state.exportOpen || state.exportToast || state.imageShare),
    onError: error => handlers.onLoadError?.(error),
  })
  return {
    el,
    update(state) {
      mountNode(host, el, true)
      mountNode(share, mask, !!state.shareViewMaskVisible)
      mountNode(share, entry, !!state.shareEntryVisible)
      setText(button, state.shareEntryLabel)
      setAttr(button, 'aria-label', state.shareEntryLabel)
      views.update(state)
    },
    destroy() { views.destroy(); el.remove() },
  }
}
