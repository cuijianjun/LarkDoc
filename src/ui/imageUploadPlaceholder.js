import { isImageMime } from '../core/media/image-insert'

/** Ephemeral upload preview: never serialize a local blob URL into document JSON. */
export function createImageUploadPlaceholder({ ownerDocument, file, maxSize, onSelect }) {
  const el = ownerDocument.createElement('span')
  el.className = 'lark-doc-image-upload'
  el.contentEditable = 'false'
  el.setAttribute('role', 'img')
  el.setAttribute('aria-label', `正在上传 ${file.name || '图片'}`)
  const frame = ownerDocument.createElement('span')
  frame.className = 'lark-doc-image-upload-frame'
  const image = ownerDocument.createElement('img')
  image.alt = ''
  const URL = ownerDocument.defaultView.URL
  const url = isImageMime(file.type) && !(maxSize > 0 && file.size > maxSize) && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null
  if (url) image.src = url
  const mask = ownerDocument.createElement('span')
  mask.className = 'lark-doc-image-upload-mask'
  const badge = ownerDocument.createElement('span')
  badge.className = 'lark-doc-image-upload-progress'
  badge.setAttribute('role', 'progressbar')
  badge.setAttribute('aria-valuemin', '0')
  badge.setAttribute('aria-valuemax', '100')
  const spinner = ownerDocument.createElement('span')
  spinner.className = 'lark-doc-image-upload-spinner'
  const value = ownerDocument.createElement('span')
  value.className = 'lark-doc-image-upload-percent'
  badge.append(spinner, value)
  frame.append(image, mask, badge)
  el.appendChild(frame)
  const select = event => { event.preventDefault(); onSelect() }
  el.addEventListener('pointerdown', select)
  const update = percent => {
    const next = Math.min(100, Math.max(0, Math.round(Number(percent) || 0)))
    value.textContent = `${next}%`
    badge.setAttribute('aria-valuenow', String(next))
  }
  update(0)
  return {
    el, update,
    setSelected: selected => el.classList.toggle('is-selected', selected),
    destroy() { el.removeEventListener('pointerdown', select); if (url) URL.revokeObjectURL(url) },
  }
}

export function showImageUploadError(host, error) {
  const el = host.ownerDocument.createElement('div')
  el.className = 'lark-doc-image-upload-errors'
  const network = error?.name === 'NetworkError' || error?.name === 'TypeError' || /网络|Network|Failed to fetch/i.test(error?.message || '') || /网络|Network|Failed to fetch/i.test(error?.cause?.message || '')
  const messages = network ? ['上传失败，请检查网络连接后重试。', '上传图片失败'] : [error?.message || '上传图片失败']
  messages.forEach(message => {
    const toast = host.ownerDocument.createElement('div')
    toast.className = 'lark-doc-image-upload-error'
    toast.setAttribute('role', 'alert')
    const icon = host.ownerDocument.createElement('span')
    icon.className = 'lark-doc-image-upload-error-icon'
    icon.textContent = '!'
    const text = host.ownerDocument.createElement('span')
    text.textContent = message
    toast.append(icon, text)
    el.appendChild(toast)
  })
  host.appendChild(el)
  const timer = host.ownerDocument.defaultView.setTimeout(() => el.remove(), 5000)
  return () => { host.ownerDocument.defaultView.clearTimeout(timer); el.remove() }
}
