/* global globalThis */
/**
 * 导出统一出口（P6b-04 导出线）。
 *
 * 规格出处：requirements/04 §4.6.7②——Word / PDF / Markdown 三档共用一个弹窗壳，点「导出」
 * 后的导出入口收在这里。editor/exportMixin.js 在 Markdown/Word 派发时动态加载本文件，
 * 文件名与 PDF 则走轻量模块，避免同步打印路径把其它格式拖回首屏。
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
 *   5. 正文及评论必须有实际评论数据；附录与原生 Word 评论均来自同一只读投影。
 */
import { serializeMarkdown } from './markdown.js'
import { withExtension } from './fileName.js'
// 落盘从 utils/download.js 取，**不走** utils/importExport.js：
// 那条静态边会把 turndown + marked（两个 Markdown 引擎，合计 140 KiB raw）拖进编辑器首屏，
// 而导出 Markdown 只需要「把字符串写成文件」。importExport.js 现在只剩 `await import()`
// 一条入口，老老实实待在 import-export 按需区块里。
import { downloadBlob, downloadText } from '../download.js'
import { loadFeature } from '../../core/features/registry'
import { safeUrl, flattenHeadingContainers } from '../../core/documentOperations'
import { createNetworkPolicy } from '../../core/policy/network'

export { safeFileName, withExtension } from './fileName.js'
export { exportPdf } from './pdf.js'

/** Plain, immutable export projection; never include deleted replies or executable URLs. */
export function normalizeExportComments(threads) {
  const author = value => ({ id: typeof value?.id === 'string' ? value.id : '', name: typeof value?.name === 'string' ? value.name : '' })
  return (Array.isArray(threads) ? threads : []).filter(thread => thread && !thread.tombstone && !thread.deleted).map(thread => ({
    author: author(thread.author), quote: typeof thread.quote === 'string' ? thread.quote : '', resolved: thread.resolved === true,
    replies: (Array.isArray(thread.replies) ? thread.replies : []).filter(reply => reply && !reply.tombstone && !reply.deleted).map(reply => ({
      author: author(reply.author), content: typeof reply.content === 'string' ? reply.content : '',
      createdAt: Number.isFinite(reply.createdAt) && reply.createdAt > 0 ? reply.createdAt : 0,
      attachments: (Array.isArray(reply.attachments) ? reply.attachments : []).filter(item => safeUrl(item?.url, true)).map(item => ({ name: typeof item.name === 'string' ? item.name : '', url: item.url })),
    })),
  }))
}

function withCommentAppendix(doc, comments) {
  if (!comments?.length) return doc
  const paragraph = text => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] })
  const content = [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '评论' }] }]
  normalizeExportComments(comments).forEach((thread, index) => {
    content.push(paragraph(`${index + 1}. ${thread.author.name || thread.author.id || '作者未提供'}（${thread.resolved ? '已解决' : '未解决'}）`))
    if (thread.quote) content.push({ type: 'blockquote', content: [paragraph(thread.quote)] })
    thread.replies.forEach(reply => {
      content.push(paragraph(`${reply.author.name || reply.author.id || '作者未提供'}：${reply.content}`))
      reply.attachments.forEach(item => content.push(paragraph(`附件：${item.name || '图片'} ${/^data:/i.test(item.url) ? '[内嵌图片]' : item.url}`)))
    })
  })
  return { type: 'doc', content: [...nodesOf(doc), ...content] }
}

/** doc → 块数组：兼容 doc JSON、doc 节点实例与裸数组三种输入。 */
function nodesOf(doc) {
  if (Array.isArray(doc)) return flattenHeadingContainers({ type: 'doc', content: doc }).content
  if (!doc || typeof doc !== 'object') return []
  if (Array.isArray(doc.content)) return flattenHeadingContainers(doc).content
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
export async function collectImages(doc, options = {}) {
  const sources = collectImageSources(nodesOf(doc), [])
  const images = {}
  const failed = []
  for (let i = 0; i < sources.length; i += 1) {
    const src = sources[i]
    if (/^data:/i.test(src)) {
      try {
        const match = /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp);base64,([A-Za-z0-9+/]*={0,2})$/i.exec(src)
        const value = match?.[1]
        if (!value || value.length % 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error('invalid image data')
        if (typeof atob === 'function') images[src] = Uint8Array.from(atob(value), char => char.charCodeAt(0))
        else if (globalThis.Buffer) images[src] = Uint8Array.from(globalThis.Buffer.from(value, 'base64'))
        else throw new Error('image data decoder unavailable')
      } catch (_) { failed.push(src) }
      continue
    }
    if (typeof fetch !== 'function') { failed.push(src); continue }
    if (!safeUrl(src, true) || !createNetworkPolicy(options.network).allows(src) || (options.isCurrent && !options.isCurrent())) { failed.push(src); continue }
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
 * @returns {{ fileName: string, markdown: string, scope: string }|Promise} Element 独立特性加载时返回 Promise
 */
export function exportMarkdown(doc, options) {
  const settings = options || {}
  const scope = typeof settings.scope === 'string' ? settings.scope : ''
  const source = scope === 'textOnly' ? stripNodeTypes(nodesOf(doc), TEXT_ONLY_DROP_TYPES) : doc
  const result = serializeMarkdown(source)
  const fileName = withExtension(settings.fileName, 'md')
  const finish = markdown => {
    if (typeof settings.shouldDownload === 'function' && !settings.shouldDownload()) return null
    downloadText(markdown, fileName, 'text/markdown;charset=utf-8')
    return { fileName, markdown, scope }
  }
  return result && typeof result.then === 'function' ? result.then(finish) : finish(result)
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
 * @param {string} [options.scope] 内容范围；withComments 必须传实际 comments 并构建附录/原生评论。
 * @param {Function} [options.isCurrent] Optional final UI-context guard before download.
 * @returns {Promise<{ fileName: string, blob: Blob, failedImages: string[], scope: string }|null>}
 */
export async function exportDocx(doc, options) {
  const settings = options || {}
  const scope = typeof settings.scope === 'string' ? settings.scope : ''
  if (scope === 'withComments' && !Array.isArray(settings.comments)) throw new Error('未提供实际评论，无法导出正文及评论')
  const fileName = withExtension(settings.fileName, 'docx')
  let images = settings.images
  let failedImages = []
  if (!images) {
    const collected = await collectImages(doc, { network: settings.network, isCurrent: settings.isCurrent || settings.shouldDownload })
    images = collected.images
    failedImages = collected.failed
  }
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
  const blob = await buildDocx(withCommentAppendix(doc, scope === 'withComments' ? settings.comments : null), { images, title: settings.title || settings.fileName, comments: scope === 'withComments' ? normalizeExportComments(settings.comments) : [] })
  if ((typeof settings.isCurrent === 'function' && !settings.isCurrent()) || (typeof settings.shouldDownload === 'function' && !settings.shouldDownload())) throw new Error('导出条件已改变，已取消下载')
  downloadBlob(blob, fileName)
  return { fileName, blob, failedImages, scope }
}
