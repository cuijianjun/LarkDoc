/**
 * 图片分享浮层：裁剪、样式与图片下载/分享面板。
 *
 * 从 `ui/overlays.js` 原样搬出，函数体一行未改。它是这几块里最独立的一块
 * （自带裁剪几何、网络策略与占位图），单独成文件后其余视图不必与它共享作用域。
 */
import { cloneShareExcerpt } from '../components/lark-doc/editor/shareContent'
import { imageCropGeometry, imageCropStyles } from '../core/media/image-crop'
import { createNetworkPolicy, BLOCKED_IMAGE_PLACEHOLDER } from '../core/policy/network'
import { safeUrl } from '../core/policy/url'
import { applyStyle, lockPageScroll, syncChildren } from './dom'
import { iconNode } from './icon'
import { button, callHandler, text } from './overlayShared'

function createImageShareView(handlers) {
  const root = text('div', 'lark-doc-image-share-layer')
  const dialog = text('section', 'lark-doc-image-share-dialog')
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  dialog.setAttribute('aria-label', '分享给')
  const header = text('header', 'lark-doc-image-share-header')
  const title = text('strong', '', '分享给')
  header.appendChild(title)
  const close = button('lark-doc-image-share-close', '', () => {
    if (mobile && confirming) { confirming = false; renderLayout(); renderResults(); return }
    callHandler(handlers, 'onImageShareClose')
  })
  close.setAttribute('aria-label', '关闭分享')
  close.appendChild(iconNode('close', 18))
  header.appendChild(close)
  const body = text('div', 'lark-doc-image-share-body')
  const selector = text('div', 'lark-doc-image-share-selector')
  const chips = text('div', 'lark-doc-image-share-recipients')
  const input = document.createElement('input')
  input.placeholder = '搜索'
  input.setAttribute('aria-label', '搜索接收人或会话')
  input.setAttribute('role', 'combobox')
  input.setAttribute('aria-autocomplete', 'list')
  const results = text('div', 'lark-doc-image-share-results')
  results.setAttribute('role', 'listbox')
  results.setAttribute('aria-label', '接收人或会话')
  const media = root.ownerDocument.defaultView.matchMedia?.('(max-width: 760px) and (pointer: coarse)')
  let current = null, available = false, unavailableReason = '', searchOpen = false, multi = false, activeIndex = 0, network = createNetworkPolicy()
  let mobile = false, confirming = false, destroyed = false, unlock = null
  const search = text('div', 'lark-doc-image-share-search')
  search.appendChild(iconNode('search', 20))
  const createGroup = button('lark-doc-image-share-create-group', '创建群组并转发')
  createGroup.disabled = true
  createGroup.title = '未配置创建群组并转发服务'
  const groupArrow = iconNode('chevron-right', 18); groupArrow.setAttribute('aria-hidden', 'true'); createGroup.appendChild(groupArrow)
  const mode = button('lark-doc-image-share-mode', '多选', () => {
    if (!current || current.sending) return
    if (multi && current.recipients.length) { confirming = true; searchOpen = false }
    else { multi = !multi; confirming = false }
    renderLayout(); renderResults(); paintPreview()
  })
  const summary = text('div', 'lark-doc-image-share-summary')
  const choose = item => {
    if (!current || current.sending || !root.isConnected || (mobile && confirming)) return
    const clearQuery = !multi && !!current.query
    if (mobile && !multi) confirming = !current.recipients.some(value => value.id === item.id && value.kind === item.kind)
    if (!multi) searchOpen = false
    callHandler(handlers, 'onImageShareRecipient', item.id, item.kind)
    if (clearQuery) callHandler(handlers, 'onImageShareQuery', '')
    renderResults()
  }
  function recipientAvatar(item) {
    // 代理对安全：emoji 昵称按码点取首字，不裂成半个字符（同 core/blocks/mention.js）。
    const avatar = text('span', 'lark-doc-image-share-avatar', item.kind === 'chat' ? '群' : Array.from(String(item.name || ''))[0] || '')
    if (safeUrl(item.avatar, true) && network.allows(item.avatar)) {
      const img = document.createElement('img')
      img.src = item.avatar; img.alt = ''
      avatar.replaceChildren(img)
    }
    return avatar
  }
  function renderResults() {
    results.replaceChildren()
    const visible = mobile ? !confirming : searchOpen
    results.hidden = !visible
    input.setAttribute('aria-expanded', String(visible))
    if (!current) return
    activeIndex = Math.min(activeIndex, Math.max(0, current.results.length - 1))
    const heading = text('div', 'lark-doc-image-share-results-head', current.query ? '搜索结果' : mobile ? '接收人或会话' : '最近对话')
    heading.hidden = !!current.query && (current.loading || !current.results.length)
    const mode = button('', multi ? '切换单选' : '切换多选', () => { multi = !multi; renderResults() })
    mode.addEventListener('mousedown', event => event.preventDefault())
    if (!mobile) heading.appendChild(mode)
    results.appendChild(heading)
    if (current.loading) results.appendChild(text('div', 'lark-doc-image-share-empty', '搜索中…'))
    else if (!current.results.length) { if (!unavailableReason) results.appendChild(text('div', 'lark-doc-image-share-empty', '没有匹配结果，换个关键词试试吧')) }
    else current.results.forEach((item, index) => {
      const selected = current.recipients.some(value => value.id === item.id && value.kind === item.kind)
      const row = button(`lark-doc-image-share-result${index === activeIndex ? ' is-active' : ''}`, '', () => choose(item))
      if (multi) row.appendChild(text('span', `lark-doc-image-share-check${selected ? ' is-checked' : ''}`, selected ? '✓' : ''))
      const avatar = recipientAvatar(item)
      const name = text('span', 'lark-doc-image-share-result-name', item.name)
      if (current.query && item.department) name.appendChild(text('small', '', item.department))
      row.append(avatar, name)
      if (!multi && selected) row.appendChild(text('span', 'lark-doc-image-share-selected', '✓'))
      row.setAttribute('role', 'option')
      row.setAttribute('aria-selected', String(selected))
      row.addEventListener('mousedown', event => event.preventDefault())
      results.appendChild(row)
    })
  }
  input.addEventListener('focus', () => { searchOpen = true; renderResults() })
  input.addEventListener('click', () => { if (current && !current.sending) { searchOpen = true; renderResults() } })
  input.addEventListener('input', () => { searchOpen = true; activeIndex = 0; callHandler(handlers, 'onImageShareQuery', input.value) })
  input.addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229 || !current || current.sending) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); searchOpen = true
      const count = current.results.length
      activeIndex = count ? (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + count) % count : 0
      renderResults()
      results.querySelector('.is-active')?.scrollIntoView?.({ block: 'nearest' })
    } else if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && searchOpen) {
      event.preventDefault(); event.stopPropagation()
      if (current.results[activeIndex] && !current.loading) choose(current.results[activeIndex])
    } else if (event.key === 'Backspace' && !input.value && current.recipients.length) {
      choose(current.recipients[current.recipients.length - 1])
    }
  })
  selector.append(chips, input, results)
  const preview = text('div', 'lark-doc-image-share-preview')
  const frame = text('figure', 'lark-doc-image-share-preview-frame')
  const excerpt = text('div', 'lark-doc-image-share-excerpt')
  const before = text('div', 'lark-doc-image-share-context is-before')
  const after = text('div', 'lark-doc-image-share-context is-after')
  const viewport = text('div')
  const image = document.createElement('img')
  const caption = text('figcaption')
  viewport.appendChild(image)
  excerpt.append(before, viewport, caption, after)
  frame.appendChild(excerpt)
  function paintContext(node, value) {
    if (value?.dom) node.replaceChildren(cloneShareExcerpt(value.dom, network))
    else node.textContent = value?.text || ''
  }
  function paintSelectionPreview() {
    const snapshot = current.preview
    const unsupported = !!snapshot.unsupported
    excerpt.classList.toggle('is-unsupported', unsupported)
    let content
    const width = unsupported ? 344 : Math.max(1, snapshot.width)
    const height = unsupported ? 198 : Math.max(1, snapshot.height)
    if (unsupported) {
      content = text('section', 'lark-doc-selection-share-unsupported')
      const title = text('header')
      const compass = iconNode('share-embed-compass', 16)
      compass.setAttribute('aria-hidden', 'true')
      title.append(compass, document.createTextNode('内嵌网页'))
      const body = text('div')
      const illustration = iconNode('share-unsupported-illustration', 75, 'lark-doc-selection-share-illustration')
      illustration.style.height = '70px'
      illustration.setAttribute('aria-hidden', 'true')
      body.append(illustration, text('p', '', '该内容暂不支持预览'))
      content.append(title, body)
    } else if (snapshot.dom) content = cloneShareExcerpt(snapshot.dom, network)
    else content = text('div', '', current.selection.text)
    const factor = unsupported ? 1 : Math.min(1, 340 / width)
    const excerptHeight = unsupported ? 286 : Math.ceil(height * factor + 122)
    const scale = Math.min(320 / 400, 254 / excerptHeight)
    viewport.className = 'lark-doc-selection-share-content ProseMirror'
    applyStyle(viewport, { position: 'relative', width: `${unsupported ? 344 : 340}px`, height: `${height * factor}px`, minHeight: '0', padding: '0', overflow: 'hidden', flexShrink: '0' })
    Object.assign(content.style, { width: `${width}px`, minWidth: '0', maxWidth: 'none', margin: '0', transform: `scale(${factor})`, transformOrigin: 'top left' })
    viewport.replaceChildren(content)
    Object.assign(excerpt.style, { height: `${excerptHeight}px`, transform: `scale(${scale})` })
    Object.assign(frame.style, { width: `${400 * scale + 2}px`, height: `${excerptHeight * scale}px` })
    paintContext(before, current.excerpt?.before)
    paintContext(after, current.excerpt?.after)
  }
  function paintPreview() {
    if (!current || (mobile && !confirming)) return
    if (current.target === 'selection') { paintSelectionPreview(); return }
    if (excerpt.classList.contains('is-unsupported')) applyStyle(viewport, {})
    excerpt.classList.remove('is-unsupported')
    viewport.className = ''
    if (viewport.firstChild !== image || viewport.childNodes.length !== 1) viewport.replaceChildren(image)
    const width = current.image.naturalWidth || image.naturalWidth, height = current.image.naturalHeight || image.naturalHeight
    const natural = imageCropGeometry(width, height, current.image.crop)
    if (!natural) return
    const displayWidth = Math.min((Number(current.image.width) || width) * natural.width / width, 340)
    const factor = displayWidth / natural.width
    const geometry = imageCropGeometry(width * factor, height * factor, current.image.crop)
    const styles = imageCropStyles(geometry)
    const excerptHeight = Math.ceil(geometry.height + 122 + (current.image.caption ? 28 : 0))
    const scale = Math.min(320 / 400, 254 / excerptHeight)
    Object.assign(excerpt.style, { height: `${excerptHeight}px`, transform: `scale(${scale})` })
    Object.assign(frame.style, { width: `${400 * scale + 2}px`, height: `${excerptHeight * scale}px` })
    applyStyle(viewport, styles.viewport)
    Object.assign(image.style, styles.image, { maxHeight: 'none' })
    paintContext(before, current.excerpt?.before)
    paintContext(after, current.excerpt?.after)
  }
  image.addEventListener('load', paintPreview)
  preview.appendChild(frame)
  const message = document.createElement('textarea')
  message.className = 'lark-doc-image-share-message'
  message.placeholder = '添加留言（内容会发送到飞书会话）'
  message.setAttribute('aria-label', '添加留言')
  message.addEventListener('input', () => callHandler(handlers, 'onImageShareMessage', message.value))
  body.append(selector, preview, message)
  const error = text('div', 'lark-doc-image-share-error')
  error.setAttribute('role', 'alert')
  const serviceNotice = text('div', 'lark-doc-image-share-empty lark-doc-image-share-service-notice')
  serviceNotice.setAttribute('role', 'status')
  const footer = text('footer', 'lark-doc-image-share-footer')
  const cancel = button('', '取消', () => callHandler(handlers, 'onImageShareClose'))
  const send = button('is-primary', '发送 (⌘+Enter)', () => { if (current && root.isConnected && !send.disabled) callHandler(handlers, 'onImageShareSend') })
  footer.append(cancel, send)
  dialog.append(header, body, error, footer)
  root.appendChild(dialog)
  root.addEventListener('mousedown', event => {
    if (event.target === root) { callHandler(handlers, 'onImageShareClose'); return }
    if (!selector.contains(event.target)) { searchOpen = false; renderResults() }
  })
  root.addEventListener('keydown', event => {
    if (!current || event.isComposing || event.keyCode === 229) return
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); callHandler(handlers, 'onImageShareClose') }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !send.disabled) { event.preventDefault(); callHandler(handlers, 'onImageShareSend') }
  })
  function renderLayout() {
    mobile = !!media?.matches
    if (!current?.recipients.length) confirming = false
    dialog.classList.toggle('is-mobile', mobile)
    dialog.classList.toggle('is-confirming', mobile && confirming)
    title.textContent = mobile && confirming ? '确认分享' : '分享给'
    close.setAttribute('aria-label', mobile && confirming ? '返回接收人' : '关闭分享')
    close.replaceChildren(iconNode(mobile && confirming ? 'chevronDown' : 'close', mobile ? 24 : 18))
    mode.textContent = multi ? current?.recipients.length ? `确定 (${current.recipients.length})` : '取消多选' : '多选'
    mode.setAttribute('aria-label', multi && current?.recipients.length ? '确认接收人' : multi ? '取消多选' : '多选接收人')
    mode.disabled = !!current?.sending
    mode.setAttribute('aria-pressed', String(multi))
    syncChildren(header, [{ node: title, on: true }, { node: close, on: true }, { node: mode, on: mobile && !confirming }])
    if (mobile) {
      if (input.parentNode !== search) search.appendChild(input)
      syncChildren(selector, [{ node: search, on: true }, { node: chips, on: !!current?.recipients.length }, { node: createGroup, on: true }, { node: results, on: true }])
    } else syncChildren(selector, [{ node: chips, on: true }, { node: input, on: true }, { node: results, on: true }])
    summary.textContent = `发送给：${(current?.recipients || []).map(item => item.name).join('、')}`
    syncChildren(body, [{ node: selector, on: !mobile || !confirming }, { node: summary, on: mobile && confirming },
      { node: preview, on: !mobile || confirming }, { node: message, on: !mobile || confirming }])
    syncChildren(dialog, [{ node: header, on: true }, { node: serviceNotice, on: !!unavailableReason }, { node: body, on: true }, { node: error, on: true }, { node: footer, on: !mobile || confirming }])
    send.disabled = !current || current.sending || !current.recipients.length || !available || (mobile && !confirming)
    send.textContent = current?.sending ? '发送中…' : mobile ? '发送' : '发送 (⌘+Enter)'
    if (mobile && current && root.isConnected && !unlock) unlock = lockPageScroll(root.ownerDocument.body)
    else if ((!mobile || !current) && unlock) { unlock(); unlock = null }
  }
  const mediaChanged = () => { if (!destroyed && current) { renderLayout(); renderResults(); paintPreview() } }
  media?.addEventListener?.('change', mediaChanged)
  if (!media?.addEventListener) media?.addListener?.(mediaChanged)
  return {
    el: root,
    update(state) {
      if (destroyed) return
      const opening = !current && !!state.imageShare
      current = state.imageShare
      available = !!state.imageShareAvailable
      unavailableReason = state.imageShareUnavailableReason || ''
      serviceNotice.textContent = unavailableReason
      network = createNetworkPolicy(state.imageShareNetwork)
      root.hidden = !current
      // 多选是偏好，关掉再打开要保留（0facf05 口径）；其余会话态清空。
      if (!current) { searchOpen = false; confirming = false; renderLayout(); return }
      if (opening) activeIndex = 0
      if (input.value !== current.query) input.value = current.query
      input.placeholder = current.recipients.length ? '' : '搜索'
      if (message.value !== current.message) message.value = current.message
      chips.replaceChildren()
      for (const item of current.recipients) {
        const chip = button('', '', () => choose(item))
        chip.append(recipientAvatar(item), document.createTextNode(`${item.name} ×`))
        chip.setAttribute('aria-label', `移除${item.name}`)
        chips.appendChild(chip)
      }
      if (current.target === 'selection') image.removeAttribute('src')
      else {
        const previewSrc = safeUrl(current.image.src, true) && network.allows(current.image.src) ? current.image.src : BLOCKED_IMAGE_PLACEHOLDER
        if (image.getAttribute('src') !== previewSrc) image.src = previewSrc
        image.alt = current.image.alt || '分享图片预览'
      }
      renderLayout()
      paintPreview()
      caption.textContent = current.image?.caption || ''
      error.textContent = current.error || ''
      error.hidden = !current.error
      input.disabled = message.disabled = current.sending
      send.title = available ? '' : unavailableReason || '分享暂不可用'
      renderResults()
      if (opening) queueMicrotask(() => { if (!destroyed && current && root.isConnected) (mobile ? close : input).focus({ preventScroll: true }) })
    },
    destroy() {
      destroyed = true; current = null; unlock?.(); unlock = null
      media?.removeEventListener?.('change', mediaChanged)
      if (!media?.removeEventListener) media?.removeListener?.(mediaChanged)
    },
  }
}

export { createImageShareView }
