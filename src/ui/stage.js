/** Full-document presentation. It only clones the live readonly view while open. */
import { mountNode, setText } from './dom'
import { iconNode } from './icon'
import { safeUrl } from '../core/documentOperations'
import { createNetworkPolicy, BLOCKED_IMAGE_PLACEHOLDER } from '../core/policy/network'
import { createImageViewer } from '../core/nodeviews/image-viewer'

const SVG_NS = 'http://www.w3.org/2000/svg'
let presentationSequence = 0
const EDITING_UI = 'script,link,meta,base,object,embed,template,noscript,animate,animateMotion,animateTransform,set,.lark-doc-heading-fold-toggle,.lark-doc-column-tools,.lark-doc-column-percentage,.column-resize-handle,.lark-doc-link-preview-resize,.lark-doc-code-fold-wrap,.lark-doc-code-language-menu,.lark-doc-code-copy,.lark-doc-code-copy-toast,.lark-doc-code-wrap,.lark-doc-math-editor,[data-lark-doc-image-ui],[data-lark-doc-link-ui]'

function resourceUrl(value, network, base, image = false) {
  if (typeof value !== 'string' || !value || /[\\\s]/.test(value)) return null
  if (image && safeUrl(value, true) && /^data:/i.test(value)) return value
  try {
    const url = new URL(value, base)
    if (!/^https?:$/.test(url.protocol) || !safeUrl(url.href, true)) return null
    const local = /^(?:\/(?!\/)|\.{1,2}\/)/.test(value) && url.origin === new URL(base).origin
    return network.allows(local ? value : url.href) ? url.href : null
  } catch (_) { return null }
}

function localSvgUrls(value, ids) {
  if (/\\|image-set\s*\(|expression|@import/i.test(value)) return null
  let valid = true
  const result = value.replace(/url\(\s*(['"]?)#([^\s)'"]+)\1\s*\)/gi, (_, quote, id) => {
    if (!ids?.has(id)) { valid = false; return '' }
    return `url("#${ids.get(id)}")`
  })
  return !valid || /url\s*\((?!["']?#)/i.test(result) ? null : result
}

function clonePresentation(source, state) {
  const document = source.ownerDocument.implementation.createHTMLDocument('')
  const clone = document.importNode(source, true)
  const network = createNetworkPolicy(state.getNetwork?.() || state.network)
  const base = source.ownerDocument.baseURI
  const svgScopes = new WeakMap()
  const prefix = `ld-presentation-${++presentationSequence}`
  clone.querySelectorAll(EDITING_UI).forEach(node => node.remove())
  // Controls that carry document content become static labels, not dead editor buttons.
  clone.querySelectorAll('input,textarea,select,button,form').forEach(control => {
    if (control.matches('input[type="file"],input[type="hidden"]')) { control.remove(); return }
    if (control.matches('input[type="checkbox"]')) { control.disabled = true; return }
    const label = document.createElement(control.tagName === 'FORM' ? 'div' : 'span')
    label.className = control.className
    if (['FORM','BUTTON'].includes(control.tagName)) label.append(...control.childNodes)
    else label.textContent = control.tagName === 'SELECT' ? control.selectedOptions[0]?.textContent || '' : control.value || control.getAttribute('placeholder') || control.textContent
    control.replaceWith(label)
  })
  clone.querySelectorAll('figure[data-type="image"]').forEach(figure => {
    if (figure.classList.contains('is-blocked')) return
    const index = state.images.findIndex(image => image.blockId === figure.getAttribute('data-block-id'))
    if (index < 0) return
    figure.setAttribute('data-presentation-image', String(index))
    figure.setAttribute('role', 'button')
    figure.setAttribute('aria-label', '查看图片')
  })
  clone.querySelectorAll('svg').forEach((svg, index) => {
    if (svg.parentElement?.closest('svg')) return
    const ids = new Map()
    for (const node of [svg, ...svg.querySelectorAll('[id]')]) {
      const id = node.getAttribute('id')
      if (id && !ids.has(id)) ids.set(id, `${prefix}-${index}-${ids.size}`)
    }
    for (const node of [svg, ...svg.querySelectorAll('*')]) svgScopes.set(node, ids)
  })
  for (const element of [clone, ...clone.querySelectorAll('*')]) {
    const tag = element.tagName.toLowerCase()
    const ids = svgScopes.get(element)
    const href = element.getAttribute('href') || element.getAttribute('xlink:href')
    const target = element.getAttribute('data-href') || element.getAttribute('data-url')
    if (tag === 'a' && safeUrl(href) && !(ids && href.startsWith('#'))) element.setAttribute('data-presentation-href', href)
    else if (target && safeUrl(target) && element.matches('[data-type="bookmark"],[data-type="link-embed"]')) {
      element.setAttribute('data-presentation-href', target)
      element.setAttribute('role', 'link')
    }
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase()
      if (name === 'id') {
        if (ids?.has(attribute.value)) element.setAttribute('id', ids.get(attribute.value))
        else element.removeAttribute(attribute.name)
      } else if (/^on/.test(name) || ['contenteditable','tabindex','data-block-id','data-record-id','autofocus','srcset','srcdoc','action','formaction','download','href','xlink:href','background','ping','autoplay'].includes(name)) element.removeAttribute(attribute.name)
      else if (name.startsWith('data-lark-doc-')) element.removeAttribute(attribute.name)
      else if (ids && ['aria-labelledby','aria-describedby'].includes(name)) {
        const references = attribute.value.split(/\s+/).map(id => ids.get(id)).filter(Boolean)
        if (references.length) element.setAttribute(attribute.name, references.join(' '))
        else element.removeAttribute(attribute.name)
      }
      else if (/url\s*\(/i.test(attribute.value) && name !== 'style') {
        const safe = ids && localSvgUrls(attribute.value, ids)
        if (safe) element.setAttribute(attribute.name, safe)
        else element.removeAttribute(attribute.name)
      }
    }
    if (ids && href?.startsWith('#') && ids.has(href.slice(1))) element.setAttribute('href', `#${ids.get(href.slice(1))}`)
    else if (element.namespaceURI === SVG_NS && ['image','feimage'].includes(tag)) {
      const src = resourceUrl(href, network, base, true)
      if (src) element.setAttribute('href', src)
    }
    if (tag === 'a' && element.hasAttribute('data-presentation-href')) {
      element.setAttribute('href', element.dataset.presentationHref)
      element.setAttribute('target', '_blank')
      element.setAttribute('rel', 'noopener noreferrer')
    }
    for (const property of Array.from(element.style || [])) {
      const value = element.style.getPropertyValue(property)
      if (!/url\s*\(|image-set\s*\(|expression|@import|\\/i.test(value)) continue
      const svgValue = ids && localSvgUrls(value, ids)
      const match = property === 'background-image' && element.matches('.lark-doc-bookmark-cover,.lark-doc-bookmark-icon,.lark-doc-embed-poster') && /^url\(\s*(?:"([^"\\]*)"|'([^'\\]*)'|([^\s"'()\\]+))\s*\)$/i.exec(value)
      const image = match && resourceUrl(match[1] ?? match[2] ?? match[3], network, base, true)
      if (svgValue) element.style.setProperty(property, svgValue)
      else if (image) element.style.setProperty(property, `url("${image.replace(/"/g, '%22')}")`)
      else element.style.removeProperty(property)
    }
    if (tag === 'style') {
      const css = ids && localSvgUrls(element.textContent, ids)
      if (!css) { element.remove(); continue }
      element.textContent = css.replace(/#([\w:-]+)/g, (match, id) => ids.has(id) ? `#${ids.get(id)}` : match)
    }
    if (element.hasAttribute('src')) {
      const src = ['img','iframe','video','audio','source','track'].includes(tag) && resourceUrl(element.getAttribute('src'), network, base, tag === 'img')
      if (src) element.setAttribute('src', src)
      else if (tag === 'img') element.setAttribute('src', BLOCKED_IMAGE_PLACEHOLDER)
      else element.removeAttribute('src')
    }
    if (element.hasAttribute('poster')) {
      const poster = resourceUrl(element.getAttribute('poster'), network, base, true)
      if (poster) element.setAttribute('poster', poster)
      else element.removeAttribute('poster')
    }
    if (tag === 'iframe' && !element.hasAttribute('sandbox')) element.setAttribute('sandbox', '')
    element.setAttribute('draggable', 'false')
    element.classList.remove('ProseMirror-focused','ProseMirror-selectednode','selectedCell','is-selected','is-resizing','lark-doc-block-handle-hovered','lark-doc-heading-section-hovered')
    if (element.hasAttribute('data-presentation-href') || element.hasAttribute('data-presentation-image')) element.tabIndex = 0
  }
  // Canvas-backed readonly blocks keep their rendered pixels without fetching or exporting them.
  const canvases = source.querySelectorAll('canvas')
  clone.querySelectorAll('canvas').forEach((canvas, index) => {
    try { if (canvases[index]) canvas.getContext('2d')?.drawImage(canvases[index], 0, 0) } catch (_) { /* A custom canvas may not expose a 2D context. */ }
  })
  clone.classList.add('ProseMirror', 'lark-doc-presentation-document')
  clone.setAttribute('contenteditable', 'false')
  return clone
}

/** Retains the stage factory/update/destroy contract; index/total no longer paginate. */
export function createSlideStage({ host, handlers = {} }) {
  const document = host?.ownerDocument || window.document
  const state = { open: false, title: '', text: '', source: null, images: [], network: null }
  const el = document.createElement('section')
  el.className = 'lark-doc-slide-stage'
  el.setAttribute('role', 'dialog')
  el.setAttribute('aria-modal', 'true')
  el.setAttribute('aria-label', '文档演示')
  el.tabIndex = 0
  const header = document.createElement('header')
  header.className = 'lark-doc-presentation-header'
  const back = document.createElement('button')
  back.type = 'button'
  const chevron = iconNode('chevronDown', 16, 'lark-doc-presentation-back-icon')
  chevron.setAttribute('aria-hidden', 'true')
  back.append(chevron, document.createTextNode('返回'))
  function onBack(event) { if (!destroyed && state.open) handlers.onExit?.(event) }
  back.addEventListener('click', onBack)
  header.appendChild(back)
  const content = document.createElement('div')
  content.className = 'lark-doc-presentation-content'
  const zoom = document.createElement('div')
  zoom.className = 'lark-doc-presentation-zoom'
  const title = document.createElement('h1')
  title.className = 'lark-doc-presentation-title'
  const body = document.createElement('div')
  zoom.append(title, body)
  content.append(zoom)
  el.append(header, content)
  let destroyed = false, refreshPending = false, sourceObserver = null, observed = null, viewer = null
  const win = document.defaultView || window
  const animationFrames = typeof win.requestAnimationFrame === 'function' && typeof win.cancelAnimationFrame === 'function'
  const requestFrame = animationFrames ? win.requestAnimationFrame.bind(win) : callback => win.setTimeout(callback, 16)
  const cancelFrame = animationFrames ? win.cancelAnimationFrame.bind(win) : win.clearTimeout.bind(win)
  let measureFrame = null, measuredHeight = null
  function measure() {
    if (!state.open || destroyed || measureFrame !== null) return
    // RO and source mutations only queue work. Rebuilding the observed subtree
    // or resizing its ancestor during notification delivery creates RO loops.
    measureFrame = requestFrame(() => {
      measureFrame = null
      if (!state.open || destroyed) return
      if (refreshPending) { refreshPending = false; refreshContent() }
      if (!state.open || destroyed) return
      const height = zoom.getBoundingClientRect().height || zoom.scrollHeight * 1.8
      if (height === measuredHeight) return
      measuredHeight = height
      content.style.height = `${height}px`
    })
  }
  const sizeObserver = win.ResizeObserver ? new win.ResizeObserver(measure) : null
  function closeViewer() { viewer?.destroy(); viewer = null }
  function refreshContent() {
    if (!state.open || destroyed) return
    if (state.isCurrent && !state.isCurrent()) { state.open = false; close(); return }
    closeViewer()
    const top = el.scrollTop
    setText(title, state.title)
    if (state.source) { body.className = ''; body.replaceChildren(clonePresentation(state.source, state)) }
    else { body.className = 'ProseMirror'; body.textContent = state.text }
    el.scrollTop = top
  }
  function scheduleRefresh() {
    if (!state.open || destroyed) return
    refreshPending = true
    measure()
  }
  function observe() {
    if (observed === state.source) return
    sourceObserver?.disconnect()
    observed = state.source
    sourceObserver = observed && win.MutationObserver ? new win.MutationObserver(scheduleRefresh) : null
    sourceObserver?.observe(observed, { childList: true, subtree: true, attributes: true, characterData: true })
  }
  function activate(target, event) {
    if (destroyed || !state.open || (state.isCurrent && !state.isCurrent())) { event.preventDefault(); return }
    const image = target.closest?.('[data-presentation-image]')
    if (image && el.contains(image)) {
      event.preventDefault()
      closeViewer()
      // The viewer filters denied items, so derive its index from that same allowed gallery.
      const network = createNetworkPolicy(state.getNetwork?.() || state.network)
      const selected = state.images[Number(image.dataset.presentationImage)]
      const images = state.images.filter(item => item.src !== BLOCKED_IMAGE_PLACEHOLDER && resourceUrl(item.src, network, document.baseURI, true))
      const index = images.indexOf(selected)
      if (index < 0) return
      viewer = createImageViewer({ host: el, images, index,
        canLoad: src => !!state.open && (!state.isCurrent || state.isCurrent()) && !!resourceUrl(src, createNetworkPolicy(state.getNetwork?.() || state.network), document.baseURI, true),
        onComment: handlers.onImageComment,
        onClose: () => { viewer = null; if (state.open) el.focus({ preventScroll: true }) },
      })
      return
    }
    const link = target.closest?.('[data-presentation-href]')
    if (!link || !el.contains(link) || !safeUrl(link.dataset.presentationHref)) return
    event.preventDefault()
    const selection = document.getSelection()
    if (selection && !selection.isCollapsed) return
    win.open(link.dataset.presentationHref, '_blank', 'noopener,noreferrer')
  }
  function onClick(event) { if (!event.target.closest?.('[data-lark-doc-image-ui]')) activate(event.target, event) }
  function onKeydown(event) {
    if (destroyed || !state.open) return
    if (event.target.closest?.('[data-lark-doc-image-ui]')) { event.stopPropagation(); return }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); handlers.onExit?.(event); return }
    if (['Enter',' '].includes(event.key) && event.target.closest?.('[data-presentation-image],[data-presentation-href]')) activate(event.target, event)
    // Let the browser scroll this full document; do not send arrows to old chapter handlers.
    event.stopPropagation()
  }
  el.addEventListener('click', onClick)
  el.addEventListener('keydown', onKeydown)
  function close() {
    closeViewer()
    sourceObserver?.disconnect()
    sourceObserver = null
    observed = null
    sizeObserver?.disconnect()
    if (measureFrame !== null) { cancelFrame(measureFrame); measureFrame = null }
    refreshPending = false
    win.removeEventListener('resize', measure)
    body.replaceChildren()
    setText(title, '')
    state.source = null
    state.images = []
    state.getNetwork = null
    state.isCurrent = null
    mountNode(host, el, false)
  }
  return {
    el,
    focus() { if (state.open) el.focus({ preventScroll: true }) },
    update(patch = {}) {
      if (destroyed) return
      const opening = !state.open && !!patch.open
      Object.assign(state, patch)
      if (!state.open) { close(); return }
      mountNode(host, el, true)
      observe()
      sizeObserver?.observe(zoom)
      win.addEventListener('resize', measure)
      scheduleRefresh()
      if (opening) { el.scrollTop = 0; el.focus({ preventScroll: true }) }
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      state.open = false
      close()
      back.removeEventListener('click', onBack)
      el.removeEventListener('click', onClick)
      el.removeEventListener('keydown', onKeydown)
    },
  }
}
