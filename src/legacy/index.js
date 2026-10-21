/**
 * 旧数据兼容入口。
 *
 * 目前只覆盖 Vditor `getHTML()` 的产物；后续新增编辑器（Quill、UEditor 等）
 * 时在这里追加适配器，宿主的 setContent 调用方式保持不变。
 */
import { isVditorHtml, normalizeVditorHtml } from './vditorHtml'

export { isVditorHtml, normalizeVditorHtml }

/**
 * 识别 HTML 来源。
 * @param {string} html
 * @returns {{ legacy: boolean, source: 'vditor' | null }}
 */
export function detectLegacyHtml(html) {
  const legacy = isVditorHtml(html)
  return { legacy, source: legacy ? 'vditor' : null }
}

export default { isVditorHtml, detectLegacyHtml, normalizeVditorHtml }
