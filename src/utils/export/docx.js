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
 *   2. **不猜字体**：只用 `DOCX_FONT_*` 里写死的两个字体族（正文、等宽），不读用户主题、
 *      不做系统字体探测 —— 探测结果在不同机器上不一致，同一份文档导出两份排版不同更难查。
 *   3. **不支持的块不静默降级成段落**：fileBlock / webEmbed / cardEmbed / bookmark /
 *      calendar_event / isv / sheet / poll / bitable / unknownBlock / blockMath 一律跳过
 *      （与 markdown.js 的 `BLOCK_SKIP` 保持一致），宁可少一段，也不产出「看着是正文、
 *      其实丢了结构」的内容。
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
  TextRun, VerticalAlign, WidthType,
} from 'docx'
import { MD_HEADING_MAX, MD_HEADING_MIN } from './markdown.js'

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

/** 高亮色：marked → docx 只保留「有/无高亮」两态，颜色不跟着走。 */
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
export const DOCX_BLOCK_SKIP = Object.freeze([
  'fileBlock', 'webEmbed', 'cardEmbed', 'bookmark', 'calendar_event',
  'isv', 'sheet', 'poll', 'bitable', 'unknownBlock', 'blockMath',
])

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
  if (findMark(node, 'highlight')) options.highlight = DOCX_HIGHLIGHT_COLOR
  if (findMark(node, 'code')) {
    options.font = DOCX_FONT_CODE
    options.size = DOCX_CODE_SIZE
  }
  options.text = String(node.text === null || node.text === undefined ? '' : node.text)
  const link = findMark(node, 'link')
  const href = link && link.attrs ? String(link.attrs.href || '') : ''
  return href ? { href, run: new TextRun(options) } : { run: new TextRun(options) }
}

/**
 * 图片 → ImageRun。字节来自 `options.images`（src → Uint8Array/ArrayBuffer），取不到就
 * 跳过 —— 见负结论 4，这里不发请求。宽高缺省用 320×180，避免图片节点没写 attrs 时
 * ImageRun 因缺 transformation 报错。
 */
function runFromImage(node, images) {
  const src = String(attrOf(node, 'src', ''))
  const data = src ? images[src] : null
  if (!data) return null
  return new ImageRun({
    type: 'png',
    data,
    transformation: {
      width: Number(attrOf(node, 'width', 320)) || 320,
      height: Number(attrOf(node, 'height', 180)) || 180,
    },
  })
}

/**
 * 一段行内内容 → runs 数组。相邻且**指向同一地址**的文本合并进一个 ExternalHyperlink ——
 * 逐个包会把一句话拆成多个超链接对象，Word 里编辑与撤销行为都不一样。
 */
export function buildInlineRuns(children, images, inlineOptions) {
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
    const node = children[i]
    if (node.type === 'hardBreak') {
      flushLink()
      runs.push(new TextRun({ break: 1, font: DOCX_FONT_BODY, size: DOCX_BODY_SIZE }))
      continue
    }
    if (node.type === 'image') {
      flushLink()
      const image = runFromImage(node, images)
      if (image) runs.push(image)
      continue
    }
    if (node.type !== 'text') {
      // 内联原子块（emoji / mention 等）：子节点折上来，拿不到东西就整段跳过。
      flushLink()
      const kids = buildInlineRuns(childrenOf(node), images, inlineOptions)
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
  let runs = buildInlineRuns(childrenOf(node), images)
  if (taken.prefix) runs = [new TextRun({ text: taken.prefix, font: DOCX_FONT_BODY, size: DOCX_BODY_SIZE })].concat(runs)
  const options = paragraphOptions(extra)
  if (taken.numbering) options.numbering = taken.numbering
  options.children = withFallbackRun(runs)
  return new Paragraph(options)
}

function buildHeading(node, images, extra) {
  const taken = consumeExtra(extra)
  let runs = buildInlineRuns(childrenOf(node), images)
  if (taken.prefix) runs = [new TextRun({ text: taken.prefix })].concat(runs)
  const options = paragraphOptions(extra)
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
function buildBlockquote(node, images, depth) {
  const extra = { quote: true }
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
function buildList(node, images, depth, kind) {
  const items = childrenOf(node)
  const reference = `${kind}-${depth}`
  const out = []
  for (let i = 0; i < items.length; i += 1) {
    const checked = Boolean(attrOf(items[i], 'checked', false))
    const extra = {
      numbering: { reference, level: 0 },
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
function buildTable(node, images, depth) {
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
    for (let c = 0; c < cells.length; c += 1) builtCells.push(buildTableCell(cells[c], images, depth))
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
function buildTableCell(node, images, depth) {
  let paragraphs = buildDocxElements(childrenOf(node), images, depth + 1)
  if (!paragraphs.length) paragraphs = [new Paragraph(buildEmptyOptions())]
  const attrs = node.attrs || {}
  const options = { children: paragraphs, verticalAlign: VerticalAlign.CENTER }
  const background = String(attrs.backgroundColor || '').replace('#', '')
  if (background) options.shading = { type: Shading.CLEAR, fill: background, color: 'auto' }
  return new TableCell(options)
}

/** 分隔线：一个底下带 border 的空段落。docx 没有 native hr，这是通行做法。 */
function buildHorizontalRule() {
  return [new Paragraph({
    children: withFallbackRun([]),
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: DOCX_BORDER_COLOR, space: 1 } },
  })]
}

/** 单个块节点 → Word 元素数组。空数组 = 这个块不产出任何东西。 */
function buildBlock(node, images, depth, extra) {
  if (!node || typeof node !== 'object') return []
  if (DOCX_BLOCK_SKIP.indexOf(node.type) !== -1) return []
  switch (node.type) {
    case 'paragraph':
      return [buildParagraph(node, images, extra)]
    case 'heading':
      return [buildHeading(node, images, extra)]
    case 'blockquote':
      return buildBlockquote(node, images, depth)
    case 'bulletList':
      return buildList(node, images, depth, 'bullet')
    case 'orderedList':
      return buildList(node, images, depth, 'ordered')
    case 'taskList':
      return buildList(node, images, depth, 'task')
    case 'codeBlock':
      return [buildCodeBlock(node)]
    case 'horizontalRule':
      return buildHorizontalRule()
    case 'table':
      return buildTable(node, images, depth)
    default:
      return []
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
        levels: [{ level: 0, format: DOCX_LEVEL_FORMATS.bullet, text: '\u2022', alignment: AlignmentType.LEFT }],
      },
      {
        reference: 'ordered-0',
        levels: [{ level: 0, format: DOCX_LEVEL_FORMATS.ordered, text: '%1.', alignment: AlignmentType.LEFT }],
      },
      {
        reference: 'task-0',
        levels: [{ level: 0, format: DOCX_LEVEL_FORMATS.task, text: '\u2022', alignment: AlignmentType.LEFT }],
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
  const nodes = Array.isArray(docOrNodes) ? docOrNodes : childrenOf(docOrNodes)
  const children = buildDocxElements(nodes, images, 0)
  return new Document({
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
  const document = buildDocxDocument(docOrNodes, options)
  return Packer.toBlob(document)
}
