/** Pure filename helpers shared by the synchronous UI and lazy export implementations. */
const UNSAFE_FILE_NAME_CHARS = /[\\/:*?"<>|]/g
const FILE_NAME_MAX_LENGTH = 80
const DEFAULT_FILE_NAME = 'document'

export function safeFileName(value) {
  const cleaned = String(value === null || value === undefined ? '' : value)
    .replace(UNSAFE_FILE_NAME_CHARS, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+/, '')
    .slice(0, FILE_NAME_MAX_LENGTH)
  return cleaned || DEFAULT_FILE_NAME
}

export function withExtension(value, extension) {
  const base = safeFileName(value)
  return `${base}.${String(extension || '').replace(/^\./, '')}`
}
