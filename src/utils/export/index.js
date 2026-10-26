/**
 * 导出统一出口（P6b-04 导出线）。
 *
 * 规格出处：requirements/04 §4.6.7②——Word / PDF / Markdown 三档共用一个弹窗壳，点「导出」
 * 后的派发收在这里。editor/exportMixin.js 只认识这个文件里的三个函数，不直接碰
 * markdown.js / docx.js / pdf.js —— 换格式实现时不用改 UI 层。
 *
 * 四条负结论（别实现）：
 *   1. **不把下载逻辑写进各格式模块**：markdown.js 只产字符串、docx.js 只产 Blob、
 *      pdf.js 只打标记。落盘与命名是出口层的职责，混进去会让单测必须伪造 `document`。
 *   2. **不改 utils/importExport.js**：那边的 `safeFileName` 是本文件 `safeFileName` 的
 *      「思路来源」，但它是被别处共用的函数，**改它会影响不在本线范围内的调用方**。
 *      所以这里自己实现一份（多做了空白折叠与前导点清理），两边不共享。
 *   3. **不做静默兜底**：图片取不到字节就是取不到，`collectImages` 跳过该图并在返回值里
 *      列出失败清单，由上层决定要不要提示 —— 不伪造占位图，那会让用户以为图还在。
 *   4. **不做格式嗅探**：导出哪种格式由调用方显式指定，不根据标题后缀或内容猜。
 *   5. **「导出正文及评论」不产评论内容**：`scope='withComments'` 只被原样记进返回值，
 *      不参与 docx / pdf 的构建 —— 评论线不在本线范围，伪造一块评论节点比不导更糟。
 */
import { serializeMarkdown } from './markdown.js'
import { printDocument } from './pdf.js'
import { downloadBlob, downloadText } from '../importExport.js'

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

/** doc → 块数组：兼容 doc JSON、doc 节点实例与裸数组三种输入。 */
function nodesOf(doc) {
  if (Array.isArray(doc)) return doc
  if (!doc || typeof doc !== 'object') return []
  if (Array.isArray(doc.content)) return doc.content
  // Fragment 里真正的数组还要再下一层。
  if (doc.content && Array.isArray(doc.content.content)) return doc.content.content
  return []
}

/** Markdown「仅文本」档要丢掉的节点类型（附件类在 markdown.js 的 BLOCK_SKIP 里已经不落盘）。 */
const TEXT_ONLY_DROP_TYPES = Object.freeze(['image'])

/**
 * 深拷一份去掉指定类型节点的块数组。
 *
 * 为什么要拷而不是就地删：入参可能是 `editor.getJSON()` 的结果，直接改会动到调用方手上的
 * 对象；而「仅文本」只是一档导出选项，不该反过来影响编辑器里的数据。
 */
function stripNodeTypes(nodes, types) {
  const kept = []
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]
    if (!node || typeof node !== 'object') continue
    if (types.indexOf(node.type) !== -1) continue
    if (Array.isArray(node.content)) {
      kept.push({ ...node, content: stripNodeTypes(node.content, types) })
      continue
    }
    kept.push(node)
  }
  return kept
}

/** 递归收集子树里所有 image 节点的 src。 */
function collectImageSources(nodes, found) {
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]
    if (!node || typeof node !== 'object') continue
    if (node.type === 'image') {
      const src = node.attrs && node.attrs.src
      if (typeof src === 'string' && src && found.indexOf(src) === -1) found.push(src)
      continue
    }
    if (Array.isArray(node.content)) collectImageSources(node.content, found)
  }
  return found
}

/**
 * 把图片 src → 字节。
 *
 * 只处理 `http(s)` 与 data URI 之外的常规地址；`data:` 开头的图片不抓取（它本身就是
 * 内联字节，fetch 一把既慢又没收益）。失败逐个跳过 —— 见负结论 3，不做占位兜底。
 *
 * @returns {Promise<{ images: object, failed: string[] }>}
 */
export async function collectImages(doc) {
  const sources = collectImageSources(nodesOf(doc), [])
  const images = {}
  const failed = []
  if (typeof fetch !== 'function') {
    for (let i = 0; i < sources.length; i += 1) failed.push(sources[i])
    return { images, failed }
  }
  for (let i = 0; i < sources.length; i += 1) {
    const src = sources[i]
    if (/^data:/i.test(src)) continue
    try {
      const response = await fetch(src)
      if (!response.ok) {
        failed.push(src)
        continue
      }
      images[src] = new Uint8Array(await response.arrayBuffer())
    } catch (error) {
      // 跨域失败是最常见的一种，记下来让上层决定提示，不代表导出失败。
      failed.push(src)
    }
  }
  return { images, failed }
}

/**
 * 导出 Markdown。
 *
 * @param {object|Array} doc 文档内容
 * @param {object} [options]
 * @param {string} [options.fileName] 不含扩展名的文件名
 * @param {string} [options.scope] 内容范围：`textOnly` = 仅文本（丢图片；附件类在
 *        markdown.js 的 BLOCK_SKIP 里本来就不落盘），其它值 = 所有内容
 * @returns {{ fileName: string, markdown: string, scope: string }}
 */
export function exportMarkdown(doc, options) {
  const settings = options || {}
  const scope = typeof settings.scope === 'string' ? settings.scope : ''
  const source = scope === 'textOnly' ? stripNodeTypes(nodesOf(doc), TEXT_ONLY_DROP_TYPES) : doc
  const markdown = serializeMarkdown(source)
  const fileName = withExtension(settings.fileName, 'md')
  downloadText(markdown, fileName, 'text/markdown;charset=utf-8')
  return { fileName, markdown, scope }
}

/**
 * 导出 Word。
 *
 * docx 依赖走**动态 import**：`docx` 这个包在浏览器端体积不小，而导出是低频动作，静态
 * 引入会把它算进编辑器首屏 chunk（utils/importExport.js 里也是这么处理的）。
 *
 * @param {object|Array} doc 文档内容
 * @param {object} [options]
 * @param {string} [options.fileName] 不含扩展名的文件名
 * @param {string} [options.title] 写入 docx 文档属性的标题
 * @param {object} [options.images] src → 字节；不传时自动 `collectImages`
 * @param {string} [options.scope] 内容范围（见负结论 5：只记录，不影响构建）
 * @returns {Promise<{ fileName: string, blob: Blob, failedImages: string[], scope: string }>}
 */
export async function exportDocx(doc, options) {
  const settings = options || {}
  const scope = typeof settings.scope === 'string' ? settings.scope : ''
  const fileName = withExtension(settings.fileName, 'docx')
  let images = settings.images
  let failedImages = []
  if (!images) {
    const collected = await collectImages(doc)
    images = collected.images
    failedImages = collected.failed
  }
  const { buildDocx } = await import('./docx.js')
  const blob = await buildDocx(doc, { images, title: settings.title || settings.fileName })
  downloadBlob(blob, fileName)
  return { fileName, blob, failedImages, scope }
}

/**
 * 导出 PDF（浏览器打印）。
 *
 * 文件名不在这里处理：打印出的 PDF 由用户在系统打印框里命名。
 *
 * @param {HTMLElement} [rootEl]
 * @param {object} [options]
 * @param {string} [options.title] 临时页眉标题
 * @param {string} [options.scope] 内容范围（见负结论 5：只记录，不影响打印）
 * @param {Function} [options.onPrinted]
 * @returns {{ ok: boolean, reason?: string, cleanup?: Function, scope: string }}
 */
export function exportPdf(rootEl, options) {
  const settings = options || {}
  const scope = typeof settings.scope === 'string' ? settings.scope : ''
  const result = printDocument(rootEl, { title: settings.title, onPrinted: settings.onPrinted })
  return { ...result, scope }
}
