/**
 * 导入 / 导出的公共工具（Markdown 转换、文件下载、纯文本 Word 导出）。
 *
 * 阶段 4：marked / turndown 从顶层静态 import 改为按需加载。
 * 原因：它们整模块只服务 markdown 双向转换两件事，静态引会把两个依赖
 * 焊死在本模块的求值闭包里 —— lite 构建（依赖被 alias 成「求值即抛错」的
 * stub）会连 html / json / txt 导出一起拖死。改为经特性注册表
 * （'markdown' → { marked, TurndownService }）后：
 *   - 全量构建：行为不变，依赖仍落 "markdown" 按需区块；
 *   - lite 构建：fallback 里 import('marked') 命中 stub → reject，
 *     markdown 两项给可读报错，其余导出格式照常工作；
 *   - 宿主加载 lark-doc/features/markdown.js 后全部恢复。
 * 因此 markdownToHtml / htmlToMarkdown 从同步变为返回 Promise（唯一调用方
 * LarkDocWorkspace.vue 已同步改为 await）。
 */
import { loadFeature } from '../core/features/registry'
import { logger } from './logger'

let markdownApiPromise
let turndownInstance

/** markdown 双向转换的公共加载通道（特性注册优先，stub/内置兜底见文件头）。 */
function loadMarkdownApi() {
  if (!markdownApiPromise) {
    markdownApiPromise = loadFeature('markdown', () =>
      Promise.all([
        import(/* webpackChunkName: "markdown" */ 'marked'),
        import(/* webpackChunkName: "markdown" */ 'turndown'),
      ]).then(([markedModule, turndownModule]) => ({
        marked: markedModule.marked || markedModule.default || markedModule,
        TurndownService: turndownModule.default || turndownModule,
      })),
    )
  }
  return markdownApiPromise
}

export function markdownToHtml(markdown) {
  return loadMarkdownApi().then(({ marked }) =>
    marked.parse(markdown, { mangle: false, headerIds: false }))
}

export function htmlToMarkdown(html) {
  return loadMarkdownApi().then(({ TurndownService }) => {
    if (!turndownInstance) turndownInstance = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })
    return turndownInstance.turndown(html)
  })
}

export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
  logger.info('export', 'file.downloaded', { format: fileName.split('.').pop() || 'unknown' })
}

export function downloadText(value, fileName, type) {
  downloadBlob(new Blob([value], { type }), fileName)
}

export async function exportDocx(title, plainText) {
  // DOCX is only needed after an explicit export. Keep it out of the editor route's initial chunk.
  // 阶段 4：docx 也走特性注册表（'office.docx'），lite 构建下 alias 到 stub →
  // reject → 调用方 catch 给可读提示；宿主加载 features/office.js 后恢复。
  const docx = await loadFeature('office.docx', () =>
    import(/* webpackChunkName: "office" */ 'docx'))
  const { Document, Packer, Paragraph, TextRun } = docx
  const children = plainText.split(/\n+/).filter(Boolean).map((line) => new Paragraph({
    children: [new TextRun(line)],
  }))
  const doc = new Document({
    sections: [{
      children: [new Paragraph({ children: [new TextRun({ text: title, bold: true, size: 32 })] }), ...children],
    }],
  })
  const blob = await Packer.toBlob(doc)
  downloadBlob(blob, `${safeFileName(title)}.docx`)
}

export function safeFileName(value) {
  return String(value || 'document').replace(/[\\/:*?"<>|]/g, '-').slice(0, 80) || 'document'
}
