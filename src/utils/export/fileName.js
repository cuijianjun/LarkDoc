/** 文件名工具独立于格式实现，避免编辑器取标题时加载 Markdown/Word 导出链。 */

/** 文件名里的非法字符（Windows 最严，顺带堵住路径分隔符）。 */
const UNSAFE_FILE_NAME_CHARS = /[\\/:*?"<>|]/g

/** 文件名最长 80 字符。 */
const FILE_NAME_MAX_LENGTH = 80

/** 拿不到标题时的兜底名。 */
const DEFAULT_FILE_NAME = 'document'

/**
 * 文件名安全化：折叠连续空白、去掉前导点，结果永远非空。
 * 与 importExport.js 的同名函数刻意不共享，保留导出线原有语义。
 */
export function safeFileName(value) {
  const cleaned = String(value === null || value === undefined ? '' : value)
    .replace(UNSAFE_FILE_NAME_CHARS, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+/, '')
    .slice(0, FILE_NAME_MAX_LENGTH)
  return cleaned || DEFAULT_FILE_NAME
}

/** 文件名 + 扩展名；截断发生在追加后缀之前。 */
export function withExtension(value, extension) {
  const base = safeFileName(value)
  return `${base}.${String(extension || '').replace(/^\./, '')}`
}
