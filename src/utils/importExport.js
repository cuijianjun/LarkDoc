import TurndownService from 'turndown'
import { marked } from 'marked'
import { logger } from './logger'

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })

export function markdownToHtml(markdown) {
  return marked.parse(markdown, { mangle: false, headerIds: false })
}

export function htmlToMarkdown(html) {
  return turndown.turndown(html)
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
