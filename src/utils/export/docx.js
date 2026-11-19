/**
 * Word（.docx）转换器（P6b-04 导出线）。
 *
 * 规格出处：requirements/04 §4.6.7②「导出 PDF 设置 / 导出 Word 设置」面板触发的产物。
 * 面板只负责收集选项，**真正的文件生成在这里** —— 输入同样是 ProseMirror doc，
 * 与 markdown.js 共用一套「直接读 doc 节点」的路子：不经过 HTML，不经过 Markdown。
 *
 * 为什么**不用** utils/importExport.js 里那个 exportDocx：
 *   它是 `plainText.split('\n')` 后逐行塞 `Paragraph`，只能出纯文本；标题层级、列表
 *   编号、表格边线、代码块底纹、行内加粗全部丢失。UI 上那个「导出 Word」按钮如果出来
 *   的是一份没有格式的 txt，是功能缺陷而不是体验取舍。
 *
 * 五条负结论（别实现）：
 *   1. **不做分页 / 版式控制**：章节一律用默认页边距与纸型，纸张方向与页码交给 Word；
 *      打印分页是 print.css 的事，不在这里重复。
 *   2. **不猜字体**：保留正文显式字体，缺省用 `DOCX_FONT_*`；不探测系统字体或用户主题。
 *   3. 分栏用可编辑无边框表格、公式用原生数学结构；不支持的结构保留可读源码。
 *   4. **不做网络请求**：图片**只接受调用方给的字节**（`options.images`）。身为纯工具层，
 *      这里不 fetch、不读 canvas；取字节（含跨域兜底与失败占位）由 index.js 负责。
 *   5. **不做文件名 / 落盘**：只产出 Document 实例与 Blob，命名与下载在 index.js。
 *
 * 另有一条实现纪律：**不碰 docx 元素的内部字段**（如 `paragraph.options`）。所有附加样式
 * 都在构造期通过通用的 `extra` 选项下发 —— 依赖私有字段会在 docx 升级时静默失效。
 */
import {
  AlignmentType, BorderStyle, Document, ExternalHyperlink, HeadingLevel, ImageRun,
  LevelFormat, Packer, Paragraph, Shading, Table, TableCell, TableRow,
  TextRun, VerticalAlign, WidthType, TableLayoutType, CommentRangeStart, CommentRangeEnd, CommentReference,
} from 'docx'
import { MD_HEADING_MAX, MD_HEADING_MIN, BLOCK_SKIP, normalizeExportDocument } from './markdown.js'
import { mentionPlainText } from '../../core/blocks/mention'
import { clampBlockIndent, INDENT_STEP_PX, safeUrl } from '../../core/documentOperations'
import { CONTENT_NAMED_RGB } from '../../ui/palette'
import { isImageDimension } from '../../core/media/image-crop'
import { wordMath } from './docx-math'
import { prepareWordDiagrams } from './docx-visuals'

/** 正文字号（half-points）：21 = 10.5pt。 */
export const DOCX_BODY_SIZE = 21

/** 代码块等宽字号，比正文小一档，避免等宽字体撑破行宽。 */
export const DOCX_CODE_SIZE = 20

/** 正文 / 代码两个字体族 —— 见负结论 2，不探测、不读主题。 */
export const DOCX_FONT_BODY = '宋体'
export const DOCX_FONT_CODE = 'Courier New'

/** 表格列宽兜底（twips，1cm ≈ 567）。列宽属性取不到时用它。 */
export const DOCX_COLUMN_WIDTH = 3000

/** 代码块底纹色。 */
export const DOCX_CODE_SHADING = 'F2F3F5'

/** 引用左边线与表格边线的颜色。 */
export const DOCX_BORDER_COLOR = 'BFBFBF'

/** 引用块缩进（twips）。 */
export const DOCX_QUOTE_INDENT = 720

/** 未指定颜色的高亮使用此缺省；显式颜色转为 Word 底纹。 */
export const DOCX_HIGHLIGHT_COLOR = 'yellow'

/** 标题层级 → HeadingLevel + 字号（half-points）。 */
export const DOCX_HEADINGS = Object.freeze([
  { level: HeadingLevel.HEADING_1, size: 36 },
  { level: HeadingLevel.HEADING_2, size: 32 },
  { level: HeadingLevel.HEADING_3, size: 28 },
  { level: HeadingLevel.HEADING_4, size: 24 },
  { level: HeadingLevel.HEADING_5, size: 22 },
  { level: HeadingLevel.HEADING_6, size: 21 },
])

/** 三种列表的编号格式。任务列表没有原生勾选框（见 `buildList` 注释），借用项目符号。 */
export const DOCX_LEVEL_FORMATS = Object.freeze({
  bullet: LevelFormat.BULLET,
  ordered: LevelFormat.DECIMAL,
  task: LevelFormat.BULLET,
})

/** 与 markdown.js 的 `BLOCK_SKIP` 保持一致：不支持的块直接跳过（负结论 3）。 */
export const DOCX_BLOCK_SKIP = BLOCK_SKIP

// —— 小工具（风格照 core/blocks/revision.js：Object.freeze 常量 + for 循环）——

function childrenOf(node) {
  if (!node || typeof node !== 'object') return []
  const content = node.content
  if (Array.isArray(content)) return content
  // Fragment：真正的数组在 `.content.content` 里。
  if (content && Array.isArray(content.content)) return content.content
  return []
}

function attrOf(node, key, fallback) {
  const attrs = node && node.attrs
  if (!attrs) return fallback
  const value = attrs[key]
  if (value === null || value === undefined || value === '') return fallback
  return value
}

function markName(mark) {
  if (!mark) return ''
  if (typeof mark.type === 'string') return mark.type
  return mark.type && mark.type.name ? mark.type.name : ''
}

/** 找第一个指定 mark；没有返回 null（调用方据此决定要不要加对应样式）。 */
function findMark(node, name) {
  const marks = node && node.marks
  if (!Array.isArray(marks)) return null
  for (let i = 0; i < marks.length; i += 1) {
    if (markName(marks[i]) === name) return marks[i]
  }
  return null
}

/** 飞书 schema 的标题层级 → Word 的 0–5 下标（同 markdown.js 的夹紧语义）。 */
export function headingIndex(level) {
  const value = Number(level)
  if (!Number.isFinite(value)) return DOCX_HEADINGS.length - 1
  if (value < MD_HEADING_MIN) return 0
  if (value > MD_HEADING_MAX) return DOCX_HEADINGS.length - 1
  return Math.round(value) - 1
}

/** 子树纯文本：代码块正文靠它取值。 */
function textContentOf(node) {
  if (!node || typeof node !== 'object') return ''
  if (node.type === 'text') return String(node.text === null || node.text === undefined ? '' : node.text)
  let out = ''
  const kids = childrenOf(node)
  for (let i = 0; i < kids.length; i += 1) out += textContentOf(kids[i])
  return out
}

/**
 * `extra` → Paragraph 的顶层选项。
 *
 * `extra` 是构造期下发的样式包，**一次性**的选项（numbering / prefix）在 `consumeExtra`
 * 里用掉后立刻失效，避免同一段Northward-tests 列表项里两个块都挂上编号。
 */
function paragraphOptions(extra) {
  const options = {}
  if (!extra) return options
  if (extra.quote) {
    options.indent = { left: DOCX_QUOTE_INDENT }
    options.border = {
      left: { style: BorderStyle.SINGLE, size: 6, color: DOCX_BORDER_COLOR, space: 8 },
    }
  }
  return options
}

/** 取一次性选项（numbering / prefix）并把它们标记为已消费。 */
function consumeExtra(extra) {
  const taken = { numbering: null, prefix: '' }
  if (!extra || extra.used) return taken
  extra.used = true
  taken.numbering = extra.numbering || null
  taken.prefix = extra.prefix || ''
  return taken
}

// —— 行内 ——

/** 编辑器颜色转换为 Word RGB；不把任意 CSS 字符串写进 OpenXML。 */
function wordColor(value) {
  const source = typeof value === 'string' ? value.trim() : ''
  if (/^#[\da-f]{6}$/i.test(source)) return source.slice(1).toUpperCase()
  if (/^#[\da-f]{3}$/i.test(source)) return source.slice(1).split('').map(char => char + char).join('').toUpperCase()
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(source)
  if (rgb && rgb.slice(1, 4).every(channel => Number(channel) <= 255)) {
    const alpha = rgb[4] === undefined ? 1 : Number(rgb[4])
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) return null
    return rgb.slice(1, 4).map(channel => Math.round(Number(channel) * alpha + 255 * (1 - alpha)).toString(16).padStart(2, '0')).join('').toUpperCase()
  }
  const named = CONTENT_NAMED_RGB[source.toLowerCase()]
  return typeof named === 'string' ? named : null
}

function explicitParagraphStyle(node, options) {
  const attrs = node.attrs || {}
  if (['left', 'center', 'right', 'justify'].includes(attrs.textAlign)) {
    options.alignment = attrs.textAlign === 'justify' ? AlignmentType.JUSTIFIED : attrs.textAlign
  }
  const lineHeight = Number(attrs.lineHeight)
  if (/^[1-4](\.\d{1,2})?$/.test(String(attrs.lineHeight))) options.spacing = { line: Math.round(lineHeight * 240) }
  const indent = clampBlockIndent(attrs.indent)
  if (indent) options.indent = { ...options.indent, left: (options.indent?.left || 0) + indent * INDENT_STEP_PX * 15 }
  return options
}

/**
 * 单个 text 节点 → TextRun（可能带 link 归属信息）。
 *
 * `inlineOptions`（代码块字体 / 单元格样式）先落地，逐叶子的加粗斜体等**叠加**其上，
 * 最后 `code` 再把字体改回等宽 —— 顺序反了会让 `code` 的等宽效果被整段字体覆盖。
 */
function runFromText(node, inlineOptions) {
  const options = {
    size: DOCX_BODY_SIZE,
    font: DOCX_FONT_BODY,
  }
  if (inlineOptions) {
    for (const key in inlineOptions) {
      if (Object.prototype.hasOwnProperty.call(inlineOptions, key)) options[key] = inlineOptions[key]
    }
  }
  if (findMark(node, 'bold')) options.bold = true
  if (findMark(node, 'italic')) options.italics = true
  if (findMark(node, 'strike')) options.strike = true
  if (findMark(node, 'underline')) options.underline = {}
  const style = findMark(node, 'textStyle')?.attrs || {}
  const font = typeof style.fontFamily === 'string' ? style.fontFamily.split(',')[0].trim().replace(/^['"]|['"]$/g, '') : ''
  if (font && font.length <= 100 && !Array.from(font).some(char => char.charCodeAt(0) < 32)) options.font = font
  const size = /^(\d+(?:\.\d+)?)(px|pt)?$/.exec(String(style.fontSize || '').trim())
  if (size && Number(size[1]) > 0 && Number(size[1]) <= 400) options.size = Math.round(Number(size[1]) * (size[2] === 'pt' ? 2 : 1.5))
  const color = wordColor(style.color)
  if (color) options.color = color
  const highlight = findMark(node, 'highlight')
  const fill = wordColor(highlight?.attrs?.color || style.backgroundColor)
  if (fill) options.shading = { type: 'clear', fill }
  else if (highlight) options.highlight = DOCX_HIGHLIGHT_COLOR
  if (findMark(node, 'subscript')) options.subScript = true
  if (findMark(node, 'superscript')) options.superScript = true
  if (findMark(node, 'code')) {
    options.font = DOCX_FONT_CODE
    options.size = DOCX_CODE_SIZE
  }
  options.text = String(node.text === null || node.text === undefined ? '' : node.text)
  const link = findMark(node, 'link')
  const href = link && link.attrs ? String(link.attrs.href || '') : ''
  return href && !href.includes('\\') && safeUrl(href) ? { href, run: new TextRun(options) } : { run: new TextRun(options) }
}

/**
 * 图片 → ImageRun。字节来自 `options.images`（src → Uint8Array/ArrayBuffer），取不到就
 * 跳过 —— 见负结论 4，这里不发请求。宽高缺省用 320×180，避免图片节点没写 attrs 时
 * ImageRun 因缺 transformation 报错。
 */
function imageSize(data) {
  const bytes = data instanceof Uint8Array ? data : data instanceof ArrayBuffer ? new Uint8Array(data) : null
  if (!bytes) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length >= 24 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return [view.getUint32(16), view.getUint32(20)]
  if (bytes.length >= 10 && bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70) return [view.getUint16(6, true), view.getUint16(8, true)]
  if (bytes.length >= 26 && bytes[0] === 66 && bytes[1] === 77) return [Math.abs(view.getInt32(18, true)), Math.abs(view.getInt32(22, true))]
  if (bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2
    while (offset + 3 < bytes.length && bytes[offset] === 255) {
      const marker = bytes[offset + 1]
      if (marker === 255) { offset += 1; continue }
      if (marker === 217 || marker === 218) break
      const length = view.getUint16(offset + 2)
      if (length < 2 || offset + length + 2 > bytes.length) break
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker) && length >= 7) return [view.getUint16(offset + 7), view.getUint16(offset + 5)]
      offset += length + 2
    }
  }
  return null
}

function runFromImage(node, images, extra) {
  const src = String(attrOf(node, 'src', ''))
  const data = src ? images[src] : null
  // The public collector clears crop only after producing cropped bytes. Never embed hidden pixels.
  if (Array.isArray(node.attrs?.crop)) return new TextRun('可见裁剪图：此格式暂不支持安全导出裁剪图')
  if (!data) return null
  const measured = imageSize(data)
  const naturalWidth = Number(node.attrs?.naturalWidth ?? measured?.[0])
  const naturalHeight = Number(node.attrs?.naturalHeight ?? measured?.[1])
  const requestedWidth = Number(node.attrs?.width)
  const requestedHeight = Number(node.attrs?.height)
  const width = isImageDimension(requestedWidth) ? requestedWidth : 320
  const knownRatio = isImageDimension(naturalWidth) && isImageDimension(naturalHeight)
  const height = isImageDimension(requestedHeight) ? requestedHeight : knownRatio ? width * naturalHeight / naturalWidth : 180
  const scale = Math.min(1, (extra?.maxWidth || 600) / width)
  return new ImageRun({
    type: 'png',
    data,
    transformation: { width: width * scale, height: height * scale },
    altText: { title: String(node.attrs?.alt || node.attrs?.caption || '图片'), description: String(node.attrs?.caption || node.attrs?.alt || ''), name: '文档图片' },
  })
}

/**
 * 一段行内内容 → runs 数组。相邻且**指向同一地址**的文本合并进一个 ExternalHyperlink ——
 * 逐个包会把一句话拆成多个超链接对象，Word 里编辑与撤销行为都不一样。
 */
export function buildInlineRuns(children, images, inlineOptions, extra) {
  const runs = []
  let pending = null
  let pendingHref = ''
  const flushLink = () => {
    if (!pending) return
    runs.push(new ExternalHyperlink({ link: pendingHref, children: pending }))
    pending = null
    pendingHref = ''
  }
  for (let i = 0; i < children.length; i += 1) {
    const source = children[i]
    if (!source || typeof source !== 'object') continue
    if (source.type === 'inlineMath') {
      flushLink()
      runs.push(wordMath(source.attrs?.latex, false, extra?.report))
      continue
    }
    const fallback = source.type === 'mention' ? mentionPlainText({ type: { name: 'mention' }, attrs: source.attrs })
      : source.type === 'emoji' ? (source.attrs?.name || '') : null
    const node = fallback == null ? source : { ...source, type: 'text', text: fallback }
    if (node.type === 'hardBreak') {
      flushLink()
      runs.push(new TextRun({ break: 1, font: DOCX_FONT_BODY, size: DOCX_BODY_SIZE }))
      continue
    }
    if (node.type === 'image') {
      flushLink()
      const image = runFromImage(node, images, extra)
      if (image) runs.push(image)
      continue
    }
    if (node.type !== 'text') {
      // 内联原子块（emoji / mention 等）：子节点折上来，拿不到东西就整段跳过。
      flushLink()
      const kids = buildInlineRuns(childrenOf(node), images, inlineOptions, extra)
      for (let k = 0; k < kids.length; k += 1) runs.push(kids[k])
      continue
    }
    const piece = runFromText(node, inlineOptions)
    if (piece.href) {
      if (pending && pendingHref === piece.href) {
        pending.push(piece.run)
        continue
      }
      flushLink()
      pendingHref = piece.href
      pending = [piece.run]
      continue
    }
    flushLink()
    runs.push(piece.run)
  }
  flushLink()
  return runs
}

/** runs 为空时补一个空 TextRun：docx 的 Paragraph 不接受空 children。 */
function withFallbackRun(runs) {
  if (runs.length) return runs
  return [new TextRun({ text: '', font: DOCX_FONT_BODY, size: DOCX_BODY_SIZE })]
}

// —— 块 ——

function buildParagraph(node, images, extra) {
  const taken = consumeExtra(extra)
  let runs = buildInlineRuns(childrenOf(node), images, undefined, extra)
  if (taken.prefix) runs = [new TextRun({ text: taken.prefix, font: DOCX_FONT_BODY, size: DOCX_BODY_SIZE })].concat(runs)
  const options = explicitParagraphStyle(node, paragraphOptions(extra))
  if (taken.numbering) options.numbering = taken.numbering
  options.children = withFallbackRun(runs)
  return new Paragraph(options)
}

function buildHeading(node, images, extra) {
  const taken = consumeExtra(extra)
  let runs = buildInlineRuns(childrenOf(node), images, undefined, extra)
  if (taken.prefix) runs = [new TextRun({ text: taken.prefix })].concat(runs)
  const options = explicitParagraphStyle(node, paragraphOptions(extra))
  if (taken.numbering) options.numbering = taken.numbering
  options.children = withFallbackRun(runs)
  const preset = DOCX_HEADINGS[headingIndex(attrOf(node, 'level', DOCX_HEADINGS.length))]
  options.heading = preset.level
  return new Paragraph(options)
}

/**
 * 代码块：等宽字体 + 浅灰底纹，换行用 `break` 而不是拆成多个 Paragraph ——
 * 拆了以后每行都是独立段落，从 Word 里复制回 IDE 会多出一堆空行与段落标记。
 */
// 代码块是纯文本块，拿不到图片映射表也不需要 —— 其它 builder 都接 `images` 是因为
// 它们的子孙里可能有 image 节点，这里没有，所以签名刻意少一个参数。
function buildCodeBlock(node) {
  const text = textContentOf(node).replace(/\n$/, '')
  const lines = text.split('\n')
  const runs = []
  for (let i = 0; i < lines.length; i += 1) {
    if (i > 0) runs.push(new TextRun({ break: 1, font: DOCX_FONT_CODE, size: DOCX_CODE_SIZE }))
    if (lines[i] !== '') runs.push(new TextRun({ text: lines[i], font: DOCX_FONT_CODE, size: DOCX_CODE_SIZE }))
  }
  return new Paragraph({
    children: withFallbackRun(runs),
    shading: { type: Shading.CLEAR, fill: DOCX_CODE_SHADING, color: 'auto' },
  })
}

/** 引用：所有后代元素统一缩进 + 左边线，`extra.quote` 会一直往下传。 */
function buildBlockquote(node, images, depth, context) {
  const extra = { ...context, quote: true }
  const kids = buildDocxElements(childrenOf(node), images, depth + 1, extra)
  if (!kids.length) kids.push(new Paragraph(buildEmptyOptions(extra)))
  return kids
}

function buildEmptyOptions(extra) {
  const options = paragraphOptions(extra)
  options.children = withFallbackRun([])
  return options
}

/**
 * 列表。飞书的列表项里可以塞引用、代码块、嵌套列表，只取首个 paragraph 会把这些整段
 * 丢掉，所以**每个子块都单独产出元素**，编号只挂在第一个产出的元素上（`consumeExtra`
 * 保证一次）。
 *
 * 任务列表：Word 的原生勾选框是「内容控件」，跨版本（尤其 WPS 与旧版 Word）兼容性差、且
 * 不能在不启用开发工具的情况下编辑。这里改用 `[x] ` / `[ ] ` 文本前缀表达勾选态 ——
 * 代价是不能点击勾选，换来的是任何地方打开都长得一样。
 */
function buildList(node, images, depth, kind, context) {
  const items = childrenOf(node)
  const out = []
  for (let i = 0; i < items.length; i += 1) {
    const checked = Boolean(attrOf(items[i], 'checked', false))
    const extra = {
      ...context,
      numbering: { reference: `${kind}-0`, level: Math.min(context?.listDepth || 0, 8) },
      listDepth: (context?.listDepth || 0) + 1,
      prefix: kind === 'task' ? (checked ? '[x] ' : '[ ] ') : '',
      used: false,
    }
    const kids = childrenOf(items[i])
    for (let k = 0; k < kids.length; k += 1) {
      const elements = buildBlock(kids[k], images, depth + 1, extra)
      for (let e = 0; e < elements.length; e += 1) out.push(elements[e])
    }
  }
  return out
}

/**
 * 表格：**一律画全边框**。
 *
 * 原因：docx 的默认表格是「无边框网格」，导出到 Word 里看到的是一堆肉眼不可见的格子；
 * 飞书文档里的表格是有边线的，保不住边线等于丢了一半信息。
 * 列宽优先取单元格的 `colwidth`，取不到时按列数平分。
 */
function buildTable(node, images, depth, extra) {
  const rows = childrenOf(node)
  if (!rows.length) return []
  const firstRow = childrenOf(rows[0])
  const columnCount = Math.max(1, firstRow.length)
  const columnWidths = []
  for (let c = 0; c < columnCount; c += 1) {
    const attrs = (firstRow[c] && firstRow[c].attrs) || {}
    const widths = attrs.colwidth
    if (Array.isArray(widths) && Number(widths[c])) columnWidths.push(Number(widths[c]))
    else columnWidths.push(DOCX_COLUMN_WIDTH)
  }
  const tableRows = []
  for (let r = 0; r < rows.length; r += 1) {
    const cells = childrenOf(rows[r])
    const builtCells = []
    for (let c = 0; c < cells.length; c += 1) builtCells.push(buildTableCell(cells[c], images, depth, { ...extra, maxWidth: (extra?.maxWidth || 600) / columnCount }))
    // tableHeader 会让 Word 在跨页时重复表头行 —— 飞书表格首行即表头。
    tableRows.push(new TableRow({ children: builtCells, tableHeader: r === 0 }))
  }
  const thin = { style: BorderStyle.SINGLE, size: 2, color: DOCX_BORDER_COLOR }
  return [new Table({
    rows: tableRows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths,
    borders: {
      top: thin, bottom: thin, left: thin, right: thin,
      insideHorizontal: thin, insideVertical: thin,
    },
  })]
}

/**
 * 单元格：多个子块 → 多个段落；一个子块都没有时补空段落 —— 空 children 的 TableCell
 * 会让 Word 报「表格结构损坏」并尝试修复文档。
 */
function buildTableCell(node, images, depth, extra) {
  const paragraphs = buildDocxElements(childrenOf(node), images, depth + 1, extra)
  if (!(paragraphs[paragraphs.length - 1] instanceof Paragraph)) paragraphs.push(new Paragraph(buildEmptyOptions()))
  const attrs = node.attrs || {}
  const options = { children: paragraphs, verticalAlign: VerticalAlign.CENTER }
  const background = String(attrs.backgroundColor || '').replace('#', '')
  if (background) options.shading = { type: Shading.CLEAR, fill: background, color: 'auto' }
  return new TableCell(options)
}

/** Word 的分栏单元格保留富文本与宽度比例，嵌套表格之后必须有结束段落。 */
function buildColumns(node, images, depth, extra) {
  const columns = childrenOf(node)
  if (!columns.length) return []
  const weights = columns.map(column => {
    const width = Number(column.attrs?.width)
    return Number.isFinite(width) && width > 0 ? width : 100 / columns.length
  })
  const total = weights.reduce((sum, value) => sum + value, 0)
  const maxWidth = extra?.maxWidth || 600
  const widths = weights.map(value => value / total)
  const none = { style: BorderStyle.NIL, size: 0, color: 'auto' }
  return [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE }, layout: TableLayoutType.FIXED,
    columnWidths: widths.map(value => Math.round(value * maxWidth * 15)),
    borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none },
    rows: [new TableRow({ children: columns.map((column, index) => {
      const children = buildDocxElements(childrenOf(column), images, depth + 1, { report: extra?.report, maxWidth: Math.max(1, widths[index] * maxWidth - 16) })
      if (!(children[children.length - 1] instanceof Paragraph)) children.push(new Paragraph(buildEmptyOptions()))
      return new TableCell({ children, width: { size: widths[index] * 100, type: WidthType.PERCENTAGE }, verticalAlign: VerticalAlign.TOP,
        borders: { top: none, bottom: none, left: none, right: none }, margins: { left: 120, right: 120 } })
    }) })],
  })]
}

/** 分隔线：一个底下带 border 的空段落。docx 没有 native hr，这是通行做法。 */
function buildHorizontalRule() {
  return [new Paragraph({
    children: withFallbackRun([]),
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: DOCX_BORDER_COLOR, space: 1 } },
  })]
}

/**
 * 会议议程 → Word：一项 = 一段「**时长** 标题」+ 该项自己的内容块。
 *
 * 与 markdown.js 的 `- **20 分钟** 标题` 同口径（时长加粗、标题跟在其后、内容挂在项下）。
 * 为什么**不能走 default 分支**：default 只读 attrs 上的 title/latex，而标题正文在
 * `agendaTitle` 的文本节点里、时长在 `agendaItem.attrs.durationMinutes` 上 —— 两处都读不到，
 * 导出的 docx 里只剩内容段落、时长与标题整体消失。
 */
function buildAgenda(node, images, depth, extra) {
  const out = []
  const items = childrenOf(node)
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i] || {}
    const kids = childrenOf(item)
    const minutes = Number(item.attrs && item.attrs.durationMinutes)
    const runs = []
    if (Number.isFinite(minutes) && minutes > 0) runs.push(new TextRun({ text: `${minutes} 分钟`, bold: true, font: DOCX_FONT_BODY, size: DOCX_BODY_SIZE }))
    for (let k = 0; k < kids.length; k += 1) {
      if (kids[k].type !== 'agendaTitle') continue
      const title = buildInlineRuns(childrenOf(kids[k]), images, undefined, extra)
      if (runs.length && title.length) runs.push(new TextRun({ text: ' ', font: DOCX_FONT_BODY, size: DOCX_BODY_SIZE }))
      for (let t = 0; t < title.length; t += 1) runs.push(title[t])
    }
    if (runs.length) out.push(new Paragraph({ ...paragraphOptions(extra), children: runs }))
    for (let k = 0; k < kids.length; k += 1) {
      if (kids[k].type === 'agendaTitle') continue
      out.push(...buildDocxElements(childrenOf(kids[k]), images, depth + 1, extra))
    }
  }
  return out
}

/** 单个块节点 → Word 元素数组。空数组 = 这个块不产出任何东西。 */
function buildBlock(node, images, depth, extra) {
  if (!node || typeof node !== 'object') return []
  if (DOCX_BLOCK_SKIP.indexOf(node.type) !== -1) return []
  switch (node.type) {
    case 'paragraph':
      return [buildParagraph(node, images, extra)]
    case 'image': {
      const image = runFromImage(node, images, extra)
      return image ? [new Paragraph({ ...paragraphOptions(extra), children: [image] })] : []
    }
    case 'heading':
      return [buildHeading(node, images, extra)]
    case 'blockquote':
      return buildBlockquote(node, images, depth, extra)
    case 'bulletList':
      return buildList(node, images, depth, 'bullet', extra)
    case 'orderedList':
      return buildList(node, images, depth, 'ordered', extra)
    case 'taskList':
      return buildList(node, images, depth, 'task', extra)
    case 'codeBlock':
      return [buildCodeBlock(node)]
    case 'horizontalRule':
      return buildHorizontalRule()
    case 'table':
      return buildTable(node, images, depth, extra)
    case 'columns':
      return buildColumns(node, images, depth, extra)
    case 'column':
      return buildDocxElements(childrenOf(node), images, depth, extra)
    case 'blockMath':
      return [new Paragraph({ ...paragraphOptions(extra), alignment: AlignmentType.CENTER, children: [wordMath(node.attrs?.latex, true, extra?.report)] })]
    case 'agenda':
      return buildAgenda(node, images, depth, extra)
    default: {
      const attrs = node.attrs || {}, label = attrs.title || attrs.name || attrs.latex || ''
      const nested = buildDocxElements(childrenOf(node), images, depth, extra)
      return label ? [new Paragraph({ children: [new TextRun(String(label))] }), ...nested] : nested
    }
  }
}

/**
 * 一串块节点 → 扁平的 Word 元素数组。
 *
 * 对外导出是为了让单测能在**不打包**的前提下做结构断言（数段落数、看 Table 里几行）；
 * `Packer` 的产物是二进制，断言不到这些。
 */
export function buildDocxElements(nodes, images, depth, extra) {
  const list = images || {}
  const out = []
  for (let i = 0; i < nodes.length; i += 1) {
    const elements = buildBlock(nodes[i], list, depth || 0, extra)
    for (let e = 0; e < elements.length; e += 1) out.push(elements[e])
  }
  return out
}

/**
 * 多级列表配置。`bullet-0` / `ordered-0` / `task-0` 三个 reference 必须与 `buildList` 里
 * 拼出来的名字完全一致，否则 Word 打开时会提示编号引用缺失并退化成无编号。
 */
export function buildNumberingConfig() {
  return {
    config: [
      {
        reference: 'bullet-0',
        levels: Array.from({ length: 9 }, (_, level) => ({ level, format: DOCX_LEVEL_FORMATS.bullet, text: '\u2022', alignment: AlignmentType.LEFT })),
      },
      {
        reference: 'ordered-0',
        levels: Array.from({ length: 9 }, (_, level) => ({ level, format: DOCX_LEVEL_FORMATS.ordered, text: `%${level + 1}.`, alignment: AlignmentType.LEFT })),
      },
      {
        reference: 'task-0',
        levels: Array.from({ length: 9 }, (_, level) => ({ level, format: DOCX_LEVEL_FORMATS.task, text: '\u2022', alignment: AlignmentType.LEFT })),
      },
    ],
  }
}

/**
 * ProseMirror doc → docx `Document` 实例（尚未打包）。
 *
 * 半公开：单测用它做结构断言（不必真打包）。入参接受 doc JSON / doc 节点实例 / 块数组
 * 三种形态 —— 导出时手上是实例，单测里写的是 JSON，都要能进。
 *
 * @param {object|Array} docOrNodes 文档内容
 * @param {object} [options]
 * @param {object} [options.images] src → 图片字节（Uint8Array / ArrayBuffer）
 * @param {string} [options.title] 文档属性标题
 * @returns {Document}
 */
export function buildDocxDocument(docOrNodes, options) {
  const settings = options || {}
  const images = settings.images || {}
  const flat = normalizeExportDocument(docOrNodes, { format: 'word' })
  const children = buildDocxElements(flat.content, images, 0, { report: settings.report, maxWidth: 600 })
  const comments = []
  for (const thread of Array.isArray(settings.comments) ? settings.comments : []) {
    if (!thread || thread.tombstone || thread.deleted) continue
    for (const reply of Array.isArray(thread.replies) ? thread.replies : []) {
      if (!reply || reply.tombstone || reply.deleted) continue
      const id = comments.length, author = reply.author || thread.author || {}
      const quote = typeof thread.quote === 'string' ? thread.quote : ''
      comments.push({ id, author: String(author.name || author.id || '作者未提供'), date: new Date(Number.isFinite(reply.createdAt) && reply.createdAt > 0 ? reply.createdAt : 0),
        children: [new Paragraph({ children: [new TextRun(`引用：${quote || '[块级评论]'}`)] }), new Paragraph({ children: [new TextRun(typeof reply.content === 'string' ? reply.content : '')] })] })
      children.push(new Paragraph({ children: [new CommentRangeStart(id), new TextRun(`评论引用：${quote || '[块级评论]'}`), new CommentRangeEnd(id), new TextRun({ children: [new CommentReference(id)] })] }))
    }
  }
  return new Document({
    comments: { children: comments },
    title: String(settings.title || ''),
    numbering: buildNumberingConfig(),
    sections: [{
      children: children.length ? children : [new Paragraph(buildEmptyOptions())],
    }],
  })
}

/**
 * ProseMirror doc → docx Blob（`Packer.toBlob`，浏览器可用）。
 */
export async function buildDocx(docOrNodes, options) {
  const settings = options || {}
  const source = normalizeExportDocument(docOrNodes, { format: 'word' })
  const report = settings.report || {}
  const images = await prepareWordDiagrams(source, settings.images, settings, report)
  const document = buildDocxDocument(source, { ...settings, images, report })
  return Packer.toBlob(document)
}
