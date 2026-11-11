/** 文件名里的非法字符（Windows 最严，顺带堵住路径分隔符）。 */
const UNSAFE_FILE_NAME_CHARS = /[\\/:*?"<>|]/g

/** 文件名最长 80 字符：超了在多数文件系统上会被截断，截出乱码不如自己截。 */
const FILE_NAME_MAX_LENGTH = 80

/** 拿不到标题时的兜底名。 */
const DEFAULT_FILE_NAME = 'document'

/**
 * 文件名安全化（本线自己实现，与 importExport.js 的同名函数**刻意不共享**，见负结论 2）。
 *
 * 相比那份实现多的两步：
 *   - 折叠连续空白：编辑器标题里常有换行 / 全角空格，直接做文件名会出现一串怪字符；
 *   - 去掉前导点：`.md` 在 Unix 下是隐藏文件，`..` 更是直接指向父目录。
 *
 * @param {string} value 原始标题
 * @returns {string} 安全文件名（已兜底，永远非空）
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

/** 文件名 + 扩展名。`safeFileName` 不含点，后缀在这里加，避免 `a.md` 被剪成 `a.m`。 */
export function withExtension(value, extension) {
  const base = safeFileName(value)
  return `${base}.${String(extension || '').replace(/^\./, '')}`
}

