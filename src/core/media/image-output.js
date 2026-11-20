export async function renderImageCrop(blob, crop) {
  let bitmap, objectUrl
  try {
    if (typeof createImageBitmap === 'function') bitmap = await createImageBitmap(blob)
    else {
      objectUrl = URL.createObjectURL(blob)
      const image = new Image()
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('无法读取图片')); image.src = objectUrl })
      bitmap = image
    }
    const width = bitmap.width || bitmap.naturalWidth, height = bitmap.height || bitmap.naturalHeight
    const [left, top, right, bottom] = crop
    const outputWidth = Math.max(1, Math.floor(width * (right - left))), outputHeight = Math.max(1, Math.floor(height * (bottom - top)))
    if (outputWidth * outputHeight > 32000000 || outputWidth > 32767 || outputHeight > 32767) throw new Error('图片过大，暂时无法下载裁剪图')
    const canvas = document.createElement('canvas')
    canvas.width = outputWidth
    canvas.height = outputHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法导出裁剪图')
    context.drawImage(bitmap, width * left, height * top, width * (right - left), height * (bottom - top), 0, 0, outputWidth, outputHeight)
    return await new Promise((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('无法导出裁剪图')), 'image/png'))
  } finally {
    bitmap?.close?.()
    if (objectUrl) URL.revokeObjectURL(objectUrl)
  }
}

export async function downloadViewerImage(item, { root, signal, crop, current }) {
  if (!current()) return
  const response = await fetch(item.src, { signal: signal })
  if (!response.ok) throw new Error('下载失败')
  let blob = await response.blob()
  if (!current()) return
  if (crop) blob = await renderImageCrop(blob, crop)
  if (!current()) return
  const url = URL.createObjectURL(blob), anchor = document.createElement('a')
  anchor.href = url
  anchor.download = Array.from(String(item.alt || '文档图片'), character => character.charCodeAt(0) < 32 ? '_' : character).join('').replace(/[/\\]/g, '_')
  if (crop) anchor.download = `${anchor.download.replace(/\.[a-z0-9]{1,8}$/i, '')}.png`
  root.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export async function prepareAIImageData(image, viewWindow, signal) {
  if (signal.aborted) throw new Error('已停止')
  const response = await (viewWindow.fetch || fetch)(image.src, { signal, credentials: 'same-origin', redirect: 'error' })
  if (!response.ok) throw new Error('读取图片失败，请重试')
  let blob = await response.blob()
  if (blob.size > 20 * 1024 * 1024) throw new Error('图片超过 20 MB，请使用较小的图片')
  // Encode the visible crop only. Never send originalSrc or hidden pixels to an AI provider.
  blob = await renderImageCrop(blob, image.crop || [0, 0, 1, 1])
  if (blob.size > 20 * 1024 * 1024) throw new Error('图片超过 20 MB，请使用较小的图片')
  if (signal.aborted) throw new Error('已停止')
  const url = await new Promise((resolve, reject) => {
    const reader = new (viewWindow.FileReader || FileReader)()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('读取图片失败，请重试'))
    reader.readAsDataURL(blob)
  })
  return { url, blockId: image.blockId, alt: image.alt }
}
