/** Pure DOM link block. Preview loading obeys the host network policy. */
import { DOMSerializer } from '@tiptap/pm/model'
import { BOOKMARK_VARIANT, readBookmark, readBookmarkMeta, renderBookmarkCard, safeLinkCardMeta } from '../embed/bookmark'
import { safeUrl } from '../documentOperations'
import { createWebEmbedNodeView } from './web-embed'
import { DEFAULT_EMBED_SANDBOX } from '../embed/web-embed'
import { NodeSelection } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'

export const LINK_EMBED_VIEWS = Object.freeze(['link', 'card', 'preview'])
export const LINK_EMBED_DEFAULT_VIEW = 'card'
const CONTENT_ATTR = 'data-lark-doc-link-content'

export function createLinkEmbedNodeView(props) {
  const { node: initialNode, extension } = props
  if (initialNode.attrs.view === 'preview') {
    const adapt = node => ({ type: node.type, attrs: { ...node.attrs, src: node.attrs.href, height: 1000 } })
    const explicitSandbox = extension?.options.sandbox
    let sandbox = typeof explicitSandbox === 'string' && explicitSandbox ? explicitSandbox : DEFAULT_EMBED_SANDBOX
    // 跨站网页需要自己的 storage origin；同源内容仍保留默认的 opaque-origin 沙箱。
    try { if (!explicitSandbox && new URL(initialNode.attrs.href).origin !== window.location.origin) sandbox += ' allow-same-origin' } catch (_) { /* URL gate rejects invalid sources. */ }
    const preview = createWebEmbedNodeView({ ...props, node: adapt(initialNode), extension: { options: { ...extension?.options, sandbox } } })
    const body = preview.dom.querySelector('.iframe-container')
    body.classList.add('lark-doc-link-preview-body')
    let node = initialNode
    let cancelDrag = null
    let fitFrame = null
    let disposed = false
    const win = body.ownerDocument.defaultView
    let editorDom = props.view?.dom
    try { editorDom = editorDom || props.editor.view.dom } catch (_) { /* Pre-mount nodeview: measure on load. */ }
    const contentWidth = () => editorDom?.clientWidth || body.parentElement?.clientWidth || 820
    const maxWidth = () => Math.max(88, Math.min(1060, Math.floor(contentWidth() * 1.27), win.innerWidth - 24))
    const alignWidth = width => { preview.dom.style.justifyContent = width > Math.round(contentWidth()) ? 'flex-end' : 'center' }
    const editable = () => props.editor.isEditable !== false
    const measure = () => {
      const frame = preview.iframe()?.getBoundingClientRect()
      return frame?.width && frame.height ? frame : body.getBoundingClientRect()
    }
    const fit = () => {
      if (disposed || cancelDrag) return
      body.style.width = node.attrs.width ? `${Math.min(node.attrs.width, maxWidth())}px` : '100%'
      body.style.maxWidth = `${maxWidth()}px`
      alignWidth(node.attrs.width ? Math.min(node.attrs.width, maxWidth()) : contentWidth())
      if (preview.status() === 'ready') body.style.height = `${node.attrs.height || (measure().width || contentWidth()) * 0.562}px`
    }
    const mark = node => {
      preview.dom.classList.add('lark-doc-link-embed')
      preview.dom.setAttribute('data-type', 'link-embed')
      preview.dom.setAttribute('data-view', 'preview')
      preview.dom.setAttribute('data-href', node.attrs.href)
      if (node.attrs.blockId) preview.dom.setAttribute('data-block-id', node.attrs.blockId)
      preview.dom.classList.toggle('is-readonly', !editable())
      if (preview.status() === 'blocked') {
        const fallback = preview.dom.querySelector('.lark-doc-embed-fallback')
        const hint = document.createElement('span')
        hint.textContent = '无法内嵌预览，请点击链接打开：'
        const link = document.createElement('a')
        link.href = node.attrs.href
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
        link.textContent = node.attrs.href
        fallback.replaceChildren(hint, link)
      }
    }
    const commitSize = (width, height) => {
      const pos = props.getPos()
      const editor = props.editor
      if (!Number.isInteger(pos) || !editable()) return
      const live = editor.state.doc.nodeAt(pos)
      if (live?.type !== node.type || live.attrs.href !== node.attrs.href) return
      editor.view.dispatch(closeHistory(editor.state.tr).setNodeMarkup(pos, undefined, {
        ...live.attrs, width: Math.round(width), height: Math.round(height),
      }))
    }
    for (const side of ['w', 'e', 'n', 's', 'nw', 'ne', 'sw', 'se']) {
      const handle = document.createElement('div')
      handle.className = `lark-doc-link-preview-resize is-${side}`
      handle.setAttribute('role', 'button')
      handle.setAttribute('aria-label', `调整预览尺寸 ${side}`)
      handle.tabIndex = 0
      handle.addEventListener('pointerdown', event => {
        if (!editable() || event.button > 0) return
        event.preventDefault()
        event.stopPropagation()
        cancelDrag?.()
        const start = measure()
        const editor = props.editor
        const pos = props.getPos()
        if (!Number.isInteger(pos)) return
        editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)))
        editor.view.focus()
        const doc = editor.state.doc
        let width = start.width
        let height = start.height
        let moved = false
        body.classList.add('is-resizing')
        try { handle.setPointerCapture(event.pointerId) } catch (_) { /* Synthetic events have no pointer capture. */ }
        const move = next => {
          if (side.includes('w') || side.includes('e')) width = Math.max(88, Math.min(maxWidth(), start.width + (next.clientX - event.clientX) * (side.includes('w') ? -2 : 2)))
          if (side.includes('n') || side.includes('s')) height = Math.max(88, Math.min(4000, start.height + (next.clientY - event.clientY) * (side.includes('n') ? -1 : 1)))
          moved = true
          body.style.width = `${width}px`
          body.style.height = `${height}px`
          alignWidth(width)
        }
        const cleanup = () => {
          win.removeEventListener('pointermove', move, true)
          win.removeEventListener('pointerup', up, true)
          win.removeEventListener('pointercancel', cancel, true)
          body.classList.remove('is-resizing')
          try { handle.releasePointerCapture(event.pointerId) } catch (_) { /* Already released. */ }
          cancelDrag = null
        }
        const up = () => {
          cleanup()
          if (moved && editor.state.doc === doc) commitSize(width, height)
          else fit()
        }
        const cancel = () => { cleanup(); fit() }
        cancelDrag = cancel
        win.addEventListener('pointermove', move, true)
        win.addEventListener('pointerup', up, true)
        win.addEventListener('pointercancel', cancel, true)
      })
      handle.addEventListener('keydown', event => {
        if (!editable() || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
        event.preventDefault()
        event.stopPropagation()
        const box = measure()
        const step = event.shiftKey ? 10 : 1
        const width = Math.max(88, Math.min(maxWidth(), box.width + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0)))
        const height = Math.max(88, Math.min(4000, box.height + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0)))
        commitSize(width, height)
      })
      body.appendChild(handle)
    }
    const frame = preview.iframe()
    frame?.addEventListener('load', fit)
    // Resize delivery must not synchronously change an observed element's size.
    // The editor briefly becomes zero-width while entering/exiting presentation.
    const scheduleFit = () => {
      if (disposed || fitFrame !== null) return
      const request = win.requestAnimationFrame?.bind(win) || (callback => win.setTimeout(callback, 16))
      fitFrame = request(() => { fitFrame = null; if (!disposed) fit() })
    }
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleFit) : null
    observer?.observe(body)
    if (editorDom) observer?.observe(editorDom)
    win.addEventListener('resize', scheduleFit)
    mark(node)
    fit()
    return { ...preview, stopEvent(event) { return !!event.target?.closest?.('.lark-doc-link-preview-resize') || preview.stopEvent(event) }, destroy() { disposed = true; cancelDrag?.(); observer?.disconnect(); if (fitFrame !== null) { const cancel = win.cancelAnimationFrame?.bind(win) || win.clearTimeout.bind(win); cancel(fitFrame); fitFrame = null } win.removeEventListener('resize', scheduleFit); frame?.removeEventListener('load', fit); preview.destroy() }, update(next) {
      if (next.type !== node.type || next.attrs.view !== 'preview' || next.attrs.href !== node.attrs.href) return false
      node = next
      const ok = preview.update(adapt(next))
      mark(next)
      fit()
      return ok
    } }
  }
  let node = initialNode
  const options = extension?.options || {}
  const host = props.editor || extension?.editor
  let destroyed = false
  let pending = false
  let fetchToken = 0
  const dom = document.createElement('div')
  dom.className = 'lark-doc-link-embed'
  dom.setAttribute('data-type', 'link-embed')
  dom.contentEditable = 'false'

  function cachedMeta(attrs) {
    if (typeof attrs.cardMeta !== 'string' || !safeLinkCardMeta(attrs.cardMeta)) return null
    return readBookmarkMeta(JSON.parse(attrs.cardMeta))
  }

  function render() {
    const { href, title, view, blockId } = node.attrs
    dom.replaceChildren()
    dom.setAttribute('data-view', view)
    if (blockId) dom.setAttribute('data-block-id', blockId)
    else dom.removeAttribute('data-block-id')
    if (!safeUrl(href)) { dom.textContent = '链接无效'; return }
    dom.setAttribute('data-href', href)
    const link = document.createElement('a')
    link.href = href
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    link.setAttribute(CONTENT_ATTR, '')
    link.className = view === 'card' ? 'lark-doc-link-card' : 'lark-doc-link-embed-row'
    if (view === 'card') {
      const meta = cachedMeta(node.attrs)
      const data = readBookmark({ ...meta, url: href, title: meta?.title || title }) || { url: href, title: title || href }
      for (const key of ['favicon', 'cover']) {
        if (data[key] && typeof options.canLoadMedia === 'function') {
          try { if (!options.canLoadMedia(data[key])) data[key] = null } catch (_) { data[key] = null }
        }
      }
      dom.setAttribute('data-bookmark-state', pending ? 'loading' : 'ready')
      const card = DOMSerializer.renderSpec(dom.ownerDocument, pending ? renderBookmarkCard(null, BOOKMARK_VARIANT.loading) : renderBookmarkCard(data)).dom
      const target = card.querySelector('[role="link"]')
      if (target) {
        target.setAttribute(CONTENT_ATTR, '')
        const open = () => dom.ownerDocument.defaultView.open(href, '_blank', 'noopener,noreferrer')
        target.addEventListener('click', open)
        target.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open() } })
      }
      dom.appendChild(card)
    } else {
      dom.removeAttribute('data-bookmark-state')
      link.textContent = href
      dom.appendChild(link)
    }
  }

  function startFetch() {
    const provider = options.unfurl
    if (destroyed || node.attrs.view !== 'card' || cachedMeta(node.attrs) || !readBookmark({ url: node.attrs.href })
      || typeof provider?.unfurl !== 'function' || !host || host.isDestroyed || host.isEditable === false) return
    const requestedNode = node
    const token = ++fetchToken
    const currentPosition = () => {
      if (destroyed || token !== fetchToken || node !== requestedNode || options.unfurl !== provider
        || host.isDestroyed || host.isEditable === false || !host.state || !host.view) return null
      try {
        const pos = props.getPos?.()
        return Number.isInteger(pos) && host.state.doc.nodeAt(pos) === requestedNode ? pos : null
      } catch (_) { return null }
    }
    const fallback = () => {
      if (destroyed || host.isDestroyed || token !== fetchToken) return
      pending = false
      render()
    }
    pending = true
    render()
    // NodeViews can be constructed before their position and editor view are mounted.
    Promise.resolve().then(() => {
      if (currentPosition() === null) return null
      return provider.unfurl(requestedNode.attrs.href)
    }).then(result => {
      const pos = currentPosition()
      if (pos === null || !result || result.ok === false) { fallback(); return }
      const meta = readBookmarkMeta(result)
      const cardMeta = JSON.stringify({ title: meta.title, desc: meta.desc, favicon: meta.favicon, cover: meta.cover || null })
      if (!safeLinkCardMeta(cardMeta)) { fallback(); return }
      try {
        host.view.dispatch(host.state.tr.setNodeMarkup(pos, undefined, { ...requestedNode.attrs, cardMeta }).setMeta('addToHistory', false))
      } catch (_) { fallback() }
    }, fallback)
  }

  render()
  // Tiptap reports an unavailable view as destroyed during NodeView construction.
  Promise.resolve().then(startFetch)
  return {
    dom,
    update(next) {
      if (destroyed) return false
      if (next.type !== node.type || next.attrs.view === 'preview') { fetchToken += 1; pending = false; return false }
      const changed = next !== node
      if (changed) { fetchToken += 1; pending = false }
      node = next
      if (changed) { render(); startFetch() }
      return true
    },
    selectNode() { dom.classList.add('is-selected') },
    deselectNode() { dom.classList.remove('is-selected') },
    stopEvent(event) { return !!event.target?.closest?.(`[${CONTENT_ATTR}], iframe`) },
    ignoreMutation() { return true },
    destroy() { destroyed = true; fetchToken += 1 },
  }
}
