/**
 * 浏览器落盘：Blob → 一次 `<a download>` 点击。
 *
 * 为什么单独一个文件：
 *   这两个函数原先长在 `utils/importExport.js` 里，而那个文件头顶钉着 `turndown`
 *   与 `marked`。任何想「下载一个字符串」的调用方（utils/export/index.js 就是）静态
 *   引它一次，就把两个 Markdown 引擎拖进了编辑器首屏。落盘本身只需要 `URL` 与
 *   `document.createElement`，与 Markdown 毫无关系 —— 拆出来之后，
 *   `utils/importExport.js` 只剩「格式转换」，可以老老实实待在按需区块里。
 *
 * 两条负结论（别在这里做）：
 *   1. **不做格式判断**：入参已经是 Blob / 字符串，MIME 由调用方给。这里不认识 `.md`，
 *      也不按扩展名猜类型 —— 猜错会让浏览器把 Markdown 当二进制下载。
 *   2. **不等待下载完成**：`anchor.click()` 之后立刻 `revokeObjectURL`（延到下一个宏任务），
 *      浏览器在点击时已把 URL 取走。加 `await` 只会让导出弹窗多闪一下。
 */
import { logger } from './logger'

/**
 * 触发一次下载。
 *
 * @param {Blob} blob 文件内容
 * @param {string} fileName 完整文件名（含扩展名）
 */
export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
  logger.info('export', 'file.downloaded', { format: fileName.split('.').pop() || 'unknown' })
}

/**
 * 文本落盘的便捷入口。
 *
 * @param {string} value 文本内容
 * @param {string} fileName 完整文件名（含扩展名）
 * @param {string} type MIME 类型
 */
export function downloadText(value, fileName, type) {
  downloadBlob(new Blob([value], { type }), fileName)
}
