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
 *   5. **评论必须来自真实读取结果**：`withComments` 要求显式传入评论数组；缺失时拒绝导出。
 *      Word 使用原生批注与引用区，PDF 在打印期间临时追加可读评论。
 */
import { serializeMarkdown, normalizeExportDocument } from './markdown.js'
import { printDocument } from './pdf.js'
import { downloadBlob, downloadText } from '../importExport.js'
import { loadFeature } from '../../core/features/registry'
import { flattenHeadingContainers, safeUrl } from '../../core/documentOperations'
import { normalizeThread } from '../../core/comments/thread'
import { createNetworkPolicy } from '../../core/policy/network'
import { cropImageBlob, normalizeImageCrop } from '../../core/media/image-crop'
import { withExtension } from './fileName.js'
export { safeFileName, withExtension } from './fileName.js'

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
const TEXT_ONLY_DROP_TYPES = Object.freeze(['image', 'fileBlock'])

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
 * 内联字节，直接解码交给构建器，不产生请求）。失败逐个跳过 —— 见负结论 3，不做占位兜底。
 *
 * @returns {Promise<{ images: object, failed: string[] }>}
 */
export async function collectImages(doc, options = {}) {
  // Match the builder's flat JSON input, including public heading.children and PM nodes.
  const source = typeof doc?.toJSON === 'function' ? doc.toJSON() : doc
  const flat = flattenHeadingContainers({
    type: 'doc',
    content: nodesOf(source).map(node => typeof node?.toJSON === 'function' ? node.toJSON() : node),
  })
  const sources = collectImageSources(nodesOf(flat), [])
  const images = {}
  const failed = []
  const network = createNetworkPolicy(options.network)
  for (let i = 0; i < sources.length; i += 1) {
    const src = sources[i]
    if (typeof options.shouldDownload === 'function' && options.shouldDownload() !== true) throw new Error('导出条件已改变，请重新导出')
    if (/^data:/i.test(src)) {
      try {
        if (!safeUrl(src, true)) throw new Error('无效内联图片')
        const base64 = src.slice(src.indexOf(',') + 1)
        if (base64.length % 4 === 1 || (base64.includes('=') && base64.length % 4 !== 0)) throw new Error('无效图片编码')
        images[src] = typeof atob === 'function'
          ? Uint8Array.from(atob(base64), character => character.charCodeAt(0))
          : new Uint8Array(Buffer.from(base64, 'base64'))
      } catch (_) { failed.push(src) }
      continue
    }
    if (src.includes('\\') || !safeUrl(src, true) || !network.allows(src)) { failed.push(src); continue }
    try {
      const response = await fetch(src, { credentials: 'same-origin', redirect: 'error' })
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

/** A missing comments payload must never masquerade as an export containing comments. */
export function normalizeExportComments(comments) {
  if (!Array.isArray(comments)) throw new Error('未读取到评论，无法导出正文及评论')
  return comments.map(normalizeThread).filter(Boolean).map(thread => ({ ...thread,
    createdAt: Number.isFinite(new Date(thread.createdAt).getTime()) ? thread.createdAt : 0,
    replies: thread.replies.map(reply => ({ ...reply, createdAt: Number.isFinite(new Date(reply.createdAt).getTime()) ? reply.createdAt : 0 })),
  }))
}

async function prepareImageCrops(doc, images, failed) {
  const prepared = { ...images }
  let sequence = 0
  async function visit(node) {
    if (node.type === 'image') {
      const crop = normalizeImageCrop(node.attrs?.crop), src = node.attrs?.src
      if (!crop) return
      if (!prepared[src]) { if (src && !failed.includes(src)) failed.push(src); return }
      try {
        const blob = await cropImageBlob(new Blob([prepared[src]]), crop)
        const croppedSrc = `lark-doc-export-crop:${++sequence}`
        prepared[croppedSrc] = new Uint8Array(await blob.arrayBuffer())
        node.attrs = { ...node.attrs, src: croppedSrc, crop: null, naturalWidth: null, naturalHeight: null,
          width: (Number(node.attrs.width) || 320) * (crop[2] - crop[0]),
          height: Number(node.attrs.height) > 0 ? Number(node.attrs.height) * (crop[3] - crop[1]) : null }
      } catch (_) {
        if (!failed.includes(src)) failed.push(src)
        // Retain the failure, but give the builder no route to the original hidden pixels.
        node.attrs = { ...node.attrs, src: '' }
      }
    }
    for (const child of node.content || []) await visit(child)
  }
  await visit(doc)
  return prepared
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
  const input = typeof doc?.toJSON === 'function' ? doc.toJSON() : doc
  const flat = flattenHeadingContainers({ type: 'doc', content: nodesOf(input).map(node => typeof node?.toJSON === 'function' ? node.toJSON() : node) })
  const source = scope === 'textOnly' ? stripNodeTypes(flat.content, TEXT_ONLY_DROP_TYPES) : flat
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
 * @param {string} [options.scope] contentOnly 或 withComments；后者必须提供 comments 数组
 * @param {Function} [options.shouldDownload] 打包后同步复查；必须返回 true 才允许下载
 * @returns {Promise<{ fileName: string, blob: Blob, failedImages: string[], scope: string }>}
 */
export async function exportDocx(doc, options) {
  const settings = options || {}
  const scope = typeof settings.scope === 'string' ? settings.scope : ''
  const fileName = withExtension(settings.fileName, 'docx')
  const comments = scope === 'withComments' ? normalizeExportComments(settings.comments) : []
  // Work on a JSON snapshot so cropping and semantic fallbacks never change the editor.
  const source = normalizeExportDocument(doc)
  let images = settings.images
  let failedImages = []
  if (!images) {
    const collected = await collectImages(source, settings)
    images = collected.images
    failedImages = collected.failed
  }
  images = await prepareImageCrops(source, images, failedImages)
  // webpackChunkName 必须是 **"office"**：`utils/importExport.js` 里那条 `await import('docx')`
  // 已经占了这个名字，Rollup 的 office feature target 也按这个名字把 docx 收成一个
  // 按需区块。这里不标（或标别的名字）webpack 会另开一个自动命名的 async chunk 装 docx，
  // 于是 LARK_DOC_TARGET=umd 直接编译失败：
  //   Cache group "office" conflicts with existing chunk.（选中模块的父 chunk 不是它）
  // 阶段 4：外面包一层特性注册表（'office.buildDocx'）—— lite 构建里 docx 依赖被
  // alias 成 stub，./docx.js 求值即抛错 → reject → 调用方 catch 给可读提示；
  // 宿主加载 lark-doc/features/office.js（自带 buildDocx）后恢复 rich Word 导出。
  const { buildDocx } = await loadFeature('office.buildDocx', () =>
    import(/* webpackChunkName: "office" */ './docx.js'))
  const blob = await buildDocx(source, { images, title: settings.title || settings.fileName, comments })
  if (typeof settings.shouldDownload === 'function' && settings.shouldDownload() !== true) {
    throw new Error('导出已取消：文档、权限或导出条件已改变，请重新导出')
  }
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
 * @param {string} [options.scope] contentOnly 或 withComments；后者必须提供 comments 数组
 * @param {Function} [options.onPrinted]
 * @returns {{ ok: boolean, reason?: string, cleanup?: Function, scope: string }}
 */
export function exportPdf(rootEl, options) {
  const settings = options || {}
  const scope = typeof settings.scope === 'string' ? settings.scope : ''
  const comments = scope === 'withComments' ? normalizeExportComments(settings.comments) : []
  const result = printDocument(rootEl, { title: settings.title, onPrinted: settings.onPrinted, comments, shouldPrint: settings.shouldPrint })
  return { ...result, scope }
}
