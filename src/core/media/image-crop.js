/** Non-destructive image crop bounds: [left, top, right, bottom], relative to the base image. */
export const FULL_IMAGE_CROP = Object.freeze([0, 0, 1, 1])

export const isImageDimension = value => Number.isFinite(value) && value > 0 && value <= 100000

export function isImageCrop(value) {
  return Array.isArray(value) && value.length === 4
    && value.every(number => typeof number === 'number' && Number.isFinite(number) && number >= 0 && number <= 1)
    && value[0] < value[2] && value[1] < value[3]
}

export function normalizeImageCrop(value) {
  if (!isImageCrop(value)) return null
  const crop = value.map(number => Math.round(number * 10000) / 10000)
  if (!isImageCrop(crop) || crop.every((number, index) => number === FULL_IMAGE_CROP[index])) return null
  return crop
}

export function parseImageCrop(value) {
  try { const crop = JSON.parse(value); return isImageCrop(crop) ? crop : null } catch (_) { return null }
}

export function imageCropGeometry(width, height, value) {
  if (!(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0)) return null
  const crop = isImageCrop(value) ? value : FULL_IMAGE_CROP
  const [left, top, right, bottom] = crop
  return { crop, baseWidth: width, baseHeight: height, width: width * (right - left), height: height * (bottom - top) }
}

/** Responsive projection: the viewport keeps its cropped ratio at narrower host widths. */
export function imageCropStyles(geometry) {
  if (!geometry) return null
  const [left, top, right, bottom] = geometry.crop
  const xScale = right - left
  const yScale = bottom - top
  return {
    viewport: { width: `${geometry.width}px`, maxWidth: '100%', aspectRatio: `${geometry.width} / ${geometry.height}`, position: 'relative', overflow: 'hidden' },
    image: { position: 'absolute', maxWidth: 'none', width: `${100 / xScale}%`, height: `${100 / yScale}%`, left: `${-100 * left / xScale}%`, top: `${-100 * top / yScale}%` },
  }
}

const clamp = (value, lower, upper) => Math.max(lower, Math.min(upper, value))

/** Drag in normalized coordinates; only committing rounds to the source's four decimal places. */
export function dragImageCrop(value, handle, dx, dy, minWidth = 0.0001, minHeight = 0.0001) {
  if (!isImageCrop(value) || !Number.isFinite(dx) || !Number.isFinite(dy)) return null
  let [left, top, right, bottom] = value
  minWidth = Math.min(right - left, Math.max(0.0001, Number.isFinite(minWidth) ? minWidth : 0.0001))
  minHeight = Math.min(bottom - top, Math.max(0.0001, Number.isFinite(minHeight) ? minHeight : 0.0001))
  if (handle === 'move') {
    const x = clamp(dx, -left, 1 - right)
    const y = clamp(dy, -top, 1 - bottom)
    return [left + x, top + y, right + x, bottom + y]
  }
  if (!['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'].includes(handle)) return null
  if (handle.includes('w')) left = clamp(left + dx, 0, right - minWidth)
  if (handle.includes('e')) right = clamp(right + dx, left + minWidth, 1)
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - minHeight)
  if (handle.includes('s')) bottom = clamp(bottom + dy, top + minHeight, 1)
  return [left, top, right, bottom]
}

export async function cropImageBlob(blob, crop) {
  const { renderImageCrop } = await import('./image-output')
  return renderImageCrop(blob, crop)
}
