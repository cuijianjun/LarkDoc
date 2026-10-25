/**
 * 扩展装配入口。
 *
 * createLarkDocExtensions 是 schema 的唯一来源：这里决定文档 JSON 认识哪些
 * 节点、mark 和属性；config.features 开关在此映射为各 Tiptap 扩展的启停，
 * 关闭能力只隐藏入口，历史 JSON 仍可解析。
 *
 * P0-04 起本文件只做装配：块定义在 core/blocks/*.js，经 registry/blocks.js
 * 汇入；这里的扩展数组顺序逐项保持与拆分前一致 —— 顺序影响 schema 与
 * 插件优先级，schema 快照（test/fixtures/schema-v1.json）必须逐字节相同。
 */
import StarterKit from '@tiptap/starter-kit'
import { CharacterCount } from '@tiptap/extensions'
import FileHandler from '@tiptap/extension-file-handler'
import { Details, DetailsSummary, DetailsContent } from '@tiptap/extension-details'
import Highlight from '@tiptap/extension-highlight'
import Placeholder from '@tiptap/extension-placeholder'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyleKit } from '@tiptap/extension-text-style'
import Typography from '@tiptap/extension-typography'
import { safeUrl } from '../../core/documentOperations'
import {
  LarkDocHeading, LarkDocOrderedList, Callout, Columns, Column, Formatting,
  LarkDocBlockId, LarkDocListItemNumber, LarkDocEmoji, LarkDocBlockquote,
  UnknownBlock, codeExtension, imageExtension, mathExtension, documentExtension,
} from '../../registry/blocks'

const LarkDocCharacterCount = CharacterCount.extend({
  addProseMirrorPlugins() {
    // 官方 filter 持有本次 options；只更新该 limit，保留插件、光标与正文历史。
    this.storage.setLimit = (limit) => { this.options.limit = limit > 0 ? limit : 0 }
    return this.parent()
  },
})

// 工厂不加载 Vue 单文件组件，可在无 DOM 的 Node 14 中检查 schema。
export function createLarkDocExtensions(options = {}) {
  const enabled = (name) => options.config?.features?.[name] !== false
  return [
    // blockquote 换成自有 LarkDocBlockquote（P1-01：quote_container 兼容读取），
    // schema 规格与 StarterKit 内置版逐字节一致（content: 'block+' 容器），
    // 仅追加 parseHTML 规则；位置紧随 StarterKit，命令与 inputRule 原样继承。
    StarterKit.configure({ heading: false, codeBlock: false, orderedList: false, blockquote: false, link: { openOnClick: false, autolink: true, isAllowedUri: (url) => safeUrl(url), HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } } }),
    LarkDocBlockquote,
    LarkDocHeading, LarkDocOrderedList, codeExtension(options.config), imageExtension(options.resolveImageFile),
    Details.configure({ persist: true }), DetailsSummary, DetailsContent,
    Callout, Columns, Column, Formatting, LarkDocBlockId, LarkDocListItemNumber, Highlight.configure({ multicolor: true }),
    TaskList, TaskItem.configure({ nested: true }), TextAlign.configure({ types: ['paragraph', 'heading'] }),
    TextStyleKit, Subscript, Superscript, Typography, LarkDocEmoji, UnknownBlock,
    LarkDocCharacterCount.configure({ limit: options.maxLength > 0 ? options.maxLength : 0, autoTrim: false, textCounter: (text) => Array.from(text).length }),
    FileHandler.configure({
      allowedMimeTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'], consumePasteEvent: true,
      onPaste: (editor, files) => { if (enabled('images') && editor.isEditable && options.onImageFiles) options.onImageFiles(files, editor.state.selection.from) },
      onDrop: (editor, files, pos) => { if (enabled('images') && editor.isEditable && options.onImageFiles) options.onImageFiles(files, pos) },
    }),
    mathExtension('inlineMath', options.onError), mathExtension('blockMath', options.onError),
    Table.configure({ resizable: true }), TableRow, TableCell, TableHeader,
    Placeholder.configure({ placeholder: (options.config && options.config.text && options.config.text.placeholder) || '输入正文，或输入 / 插入内容' }), documentExtension(options),
  ]
}

export { applyLineStartMarker } from '../../registry/blocks'
