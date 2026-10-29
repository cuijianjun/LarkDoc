import TurndownService from 'turndown'
import { marked } from 'marked'
import { downloadBlob } from './download'

// 落盘实现搬去了 utils/download.js（见那边的文件头：这两个函数不该背 turndown 的体积）。
// 这里**转出**一份，是为了不破坏既有调用契约 ——
// LarkDocWorkspace.vue 的 `await import('../../utils/importExport')` 仍在解构 downloadText。
export { downloadBlob, downloadText } from './download'

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })

export function markdownToHtml(markdown) {
  return marked.parse(markdown, { mangle: false, headerIds: false })
}

export function htmlToMarkdown(html) {
  return turndown.turndown(html)
}

export async function exportDocx(title, plainText) {
  // DOCX is only needed after an explicit export. Keep it out of the editor route's initial chunk.
  const { Document, Packer, Paragraph, TextRun } = await import(/* webpackChunkName: "office" */ 'docx')
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
