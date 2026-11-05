/**
 * lite 构建的「求值即抛错」占位模块（阶段 4）。
 *
 * Rollup lite target 把 katex / docx / marked / turndown / highlight.js / mammoth
 * 这些重依赖 alias 到本文件：模块一被求值就抛错，动态 import 随即 reject，
 * 调用方沿既有的 catch 走降级路径（公式留纯文本、代码块不高亮、导入导出
 * 给出可读提示）。宿主想要回这些能力时，加载 lark-doc/features/* 特性包
 * 即可，主产物无需更换。
 */
import { loadFeature, readFeature } from './registry'

const unavailable = () => {
  throw new Error('[lark-doc] lite 构建不含该可选依赖；请先加载对应特性包（lark-doc/features/*）')
}

// 保留可选依赖常用的导出形状，使 Rollup 能静态分析 lite 入口；真正调用时才报错。
export const marked = { parse(...args) {
  const feature = readFeature('markdown')
  if (!feature || !feature.marked) {
    if (feature && typeof feature.catch === 'function') feature.catch(() => {})
    return unavailable()
  }
  return feature.marked.parse(...args)
} }
export const serializeMarkdown = (...args) => loadFeature('markdown.serialize')
  .then(api => api.serializeMarkdown(...args))
export const buildDocx = unavailable
export const Document = unavailable
export const Packer = { toBlob: unavailable }
export const Paragraph = unavailable
export const TextRun = unavailable
export const HeadingLevel = { HEADING_1: 1, HEADING_2: 2, HEADING_3: 3, HEADING_4: 4, HEADING_5: 5, HEADING_6: 6 }
export const AlignmentType = { CENTER: 'center', LEFT: 'left', RIGHT: 'right' }
export const BorderStyle = { SINGLE: 'single' }
export const ExternalHyperlink = unavailable
export const ImageRun = unavailable
export const LevelFormat = { BULLET: 'bullet', DECIMAL: 'decimal' }
export const Shading = unavailable
export const Table = unavailable
export const TableCell = unavailable
export const TableRow = unavailable
export const VerticalAlign = { CENTER: 'center' }
export const WidthType = { DXA: 'dxa' }
export const defaultExport = unavailable
export default defaultExport
