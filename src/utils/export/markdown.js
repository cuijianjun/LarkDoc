/**
 * Markdown 往返 codec（P6b-04 导出线·核心）。
 *
 * 规格出处：requirements/04 §4.6.7②「三档同壳」里的 Markdown 档；块类型清单以
 * src/core/documentSchema.js 为准，节点名取自 extensions.js 装配出的真 schema
 * （paragraph / heading / bulletList / orderedList / listItem / taskList / taskItem /
 * blockquote / codeBlock / horizontalRule / table / tableRow / tableCell / tableHeader /
 * image / hardBreak / text）。
 *
 * 为什么**序列化不走 HTML 字符串**：
 *   utils/importExport.js 现有的 `htmlToMarkdown` 只是 `turndown` 的一行封装，输入是
 *   `editor.getHTML()` 的文本。走 HTML 会丢掉内联 mark 的边界与节点属性（代码块语言、
 *   任务勾选态、表格表头行、图片 alt/title 在这一步全没了），且 HTML 里还夹着编辑器
 *   自己的装饰节点。这里直接从 ProseMirror doc 走，每个分支对准 schema 节点名，
 *   「往返一致」才有落点。
 *
 * 为什么**解析仍要过一遍 HTML**：
 *   Markdown 的块结构（尤其嵌套列表、懒延续行、表格对齐行）自己写解析器极易出偏。
 *   marked 的 GFM 输出是稳定、可测的事实标准，所以解析走
 *   「marked → HTML → 自己的 HTML→doc 归一」。归一器不依赖 DOM（Node 单测与浏览器
 *   同路径），只认标签名与属性，从而保证 `serialize(parse(md))` 幂等。
 *
 * **解析半边不在这里**：`src/utils/export/markdown-parse.js`。本文件只做
 * `doc → Markdown`（导出），一行都不需要 marked；把 `import { marked }` 留在这里会把
 * 78.5 KiB 的 marked 钉进首屏 chunk（vue.config.js 的 `markdown` 按需组因此永不生效）。
 * 依赖方向固定为 parse → serialize：下面四个 `HTML_*` 表与 `clampHeadingLevel` 之所以
 * `export`，就是给解析半边复用的，**不要把它们改回模块私有**，也不要在本文件里 import
 * markdown-parse.js（会立刻把 marked 拉回首屏）。
 *
 * 六条负结论（别实现）：
 *   1. **不引入 GFM 之外的方言语法**：Markdown 没有下划线与高亮的原生写法，本文件用
 *      `<u>` / `<mark>` 两种**行内 HTML** 承载（marked 原样透传、归一器认这两个标签）。
 *      不发明 `==highlight==` 之类只在个别渲染器里生效的记号。
 *   2. **不把未知块硬塞成段落**：fileBlock / webEmbed / cardEmbed / bookmark /
 *      calendar_event / isv / sheet / poll / bitable / unknownBlock / blockMath 一律
 *      **跳过、不落 Markdown**（见 `INLINE_FALLBACK` 与 `BLOCK_SKIP`）；宁可少一段文本，
 *      也不产出一个「看着像正文、其实丢了结构」的 md。
 *   3. **不支持的 mark 组合不绕**：`代码 + 强调/链接` 在 Markdown 里只能保住外层时，
 *      按 `MD_MARK_WRAPPERS` 的固定顺序取内外层，不做二次转义。
 *   4. **不为围栏里的反引号转义**：代码块按内容里最长连续反引号 +1 取围栏长度，
 *      转义只发生在围栏外。
 *   5. **不做文件名 / 落盘**：文件名安全化与下载在 index.js，本文件只产正文字符串。
 *   6. **不碰编辑器实例**：入参是 doc（JSON 或节点实例），不读 editor 状态。
 */
/** 硬换行的落地写法：`\` + 换行（比行尾两空格更抗「被编辑器 trim」）。 */
export const MD_HARD_BREAK = '\\\n'

/** 块之间的分隔：空一行。 */
export const MD_BLOCK_SEPARATOR = '\n\n'

/**
 * 必须转义的字面量集合 —— 少任何一项，往返都会**静默丢语义**（不是报错，是语义变了）：
 *
 * | 字符 | 不转义的后果 |
 * | --- | --- |
 * | `\` | 反斜杠本身被当成转义符，紧随其后的字符被吃掉 |
 * | `` ` `` | 正文里的反引号开出一个代码段 |
 * | `*` | 正文里的 `*` 开出强调 / 列表项 |
 * | `_` | 正文里的 `_` 开出强调（GFM 里词内 `_` 同样生效） |
 * | `[` `]` | 正文里的 `[x]` 被当成任务列表勾选框 / 链接文本 |
 * | `#` | 行首的 `#` 变成标题 |
 * | `<` `>` | 正文里的 `<b>` 变成**真 HTML 标签**（顺带堵住标签注入） |
 * | `|` | 表格单元格里的 `|` 撑出多一列 |
 * | `~` | 连续两个 `~` 变成删除线 |
 */
export const MD_ESCAPE_CHARS = Object.freeze(['\\', '`', '*', '_', '[', ']', '#', '<', '>', '|', '~'])

/** 只有**行首**才有歧义的标记：无序列表 `-`/`+`、有序列表的 `.`。 */
export const MD_LINE_START_ESCAPE = Object.freeze(['-', '+', '.'])

/** Markdown 只有 1–6 级标题；飞书 schema 有 1–9，7 级以上夹紧到 6。 */
export const MD_HEADING_MIN = 1
export const MD_HEADING_MAX = 6

/**
 * mark → Markdown 包裹器。**数组末尾 = 最内层（最先裹上去）**，数组头 = 最外层：
 *   `code` 在最内（代码段内容不再被解析），`link` 在最外（链接文本里允许放代码段
 *   与强调）。同一段文字上有多个 mark 时**严格按本表顺序**包裹 —— 顺序不固定，
 *   第二轮序列化得到的字符串就会变，幂等无从谈起。
 */
export const MD_MARK_WRAPPERS = Object.freeze([
  { name: 'link', open: () => '[', close: (mark) => `](${linkHref(mark)})` },
  { name: 'bold', open: () => '**', close: () => '**' },
  { name: 'italic', open: () => '*', close: () => '*' },
  { name: 'strike', open: () => '~~', close: () => '~~' },
  { name: 'underline', open: () => '<u>', close: () => '</u>' },
  { name: 'highlight', open: () => '<mark>', close: () => '</mark>' },
  { name: 'code', open: (mark, text) => codeFence(text), close: (mark, text) => codeFence(text) },
])

/**
 * Markdown 没有对应节点的内联原子块 —— 退化成纯文本，别静默丢掉读法。
 * 注意：退化后**结构不往返**（mention 节点 → 普通文本），是刻意的取舍，见负结论 2。
 */
export const INLINE_FALLBACK = Object.freeze({
  emoji: (node) => node.attrs.name || '',
  mention: (node) => `@${node.attrs.name || node.attrs.id || ''}`,
  inlineMath: (node) => `$${node.attrs.latex || ''}$`,
})

/** 直接跳过（不落任何 Markdown）的块级节点 —— 见负结论 2。 */
export const BLOCK_SKIP = Object.freeze([
  'fileBlock', 'webEmbed', 'cardEmbed', 'bookmark', 'calendar_event',
  'isv', 'sheet', 'poll', 'bitable', 'unknownBlock', 'blockMath',
  // 17 §17.5 的外部服务块：未接入时是一张钥匙卡，落 Markdown 只会得到一行乱码式文案，
  // 与 unknownBlock 同口径跳过（保真走 JSON 通道，不走文本导出）。
  'externalBlock',
])

/** HTML 里「不产生节点、直接下钻」的容器（marked 的 thead/tbody 就是这种）。 */
export const HTML_TRANSPARENT = Object.freeze(['thead', 'tbody', 'tfoot', 'colgroup', 'html', 'body'])

/** HTML 空元素：没有闭合标签，别等 `</x>`。 */
export const HTML_VOID = Object.freeze(['br', 'img', 'hr', 'input', 'meta', 'link', 'col', 'area', 'base', 'source', 'wbr'])

/** HTML 块级标签：出现即打断当前行内累积。 */
export const HTML_BLOCK = Object.freeze([
  'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote',
  'pre', 'hr', 'table', 'tr', 'td', 'th', 'section', 'article', 'figure', 'dl', 'dt', 'dd',
  'main', 'header', 'footer', 'nav', 'aside',
])

export const HTML_ENTITIES = Object.freeze({
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
})

// —— 通用小工具（Object.freeze 常量 + for 循环，风格照 core/blocks/revision.js）——

function childrenOf(node) {
  if (!node || typeof node !== 'object') return []
  const content = node.content
  if (Array.isArray(content)) return content
  // ProseMirror 的 Fragment：`.content` 才是数组，别把 Fragment 当子节点遍历。
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

function hasMark(node, name) {
  const marks = node && node.marks
  if (!Array.isArray(marks)) return false
  for (let i = 0; i < marks.length; i += 1) {
    if (markName(marks[i]) === name) return true
  }
  return false
}

function findMark(node, name) {
  const marks = node && node.marks
  if (!Array.isArray(marks)) return null
  for (let i = 0; i < marks.length; i += 1) {
    if (markName(marks[i]) === name) return marks[i]
  }
  return null
}

/** 链接地址：`)` 与空格会截断行内链接语法，一律走尖括号形式。 */
function linkHref(mark) {
  const raw = String((mark && mark.attrs && mark.attrs.href) || '')
  if (!raw) return ''
  if (/[\s()<>]/.test(raw)) return `<${raw.replace(/\s/g, '%20')}>`
  return raw
}

/** 行内代码段的围栏：内容里有几个反引号就多垫一个，两端按需留空格防粘连。 */
function codeFence(text) {
  let longest = 0
  let run = 0
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '`') {
      run += 1
      if (run > longest) longest = run
    } else {
      run = 0
    }
  }
  const fence = '`'.repeat(longest + 1)
  const pad = /^`|`$/.test(text) ? ' ' : ''
  return `${fence}${pad}`
}

/**
 * 正文转义。
 *
 * `atLineStart` 由调用方告知「这段文本落在一行的开头」—— `+++` / `---` / `1.` 只在
 * 行首有歧义，行中不转义是为了让导出的 md 还能读。行内的换行一律落成硬换行标记，
 * 否则一个段落会被劈成两个块。
 */
export function escapeText(text, atLineStart) {
  const value = String(text === null || text === undefined ? '' : text).replace(/\r\n?/g, '\n')
  let out = ''
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i]
    const lineStart = Boolean(atLineStart) && i === 0
    const needEscape = MD_ESCAPE_CHARS.indexOf(char) !== -1
      || (lineStart && MD_LINE_START_ESCAPE.indexOf(char) !== -1)
    if (needEscape) out += '\\'
    out += char
  }
  // 换行必须在转义**之后**才换成硬换行标记：先换的话，标记自带的那根 `\` 会被下面的
  // 循环当成待转义字符，落成 `a\\<换行>b` —— 反解出来是「字面反斜杠 + 软换行」，
  // 硬换行反而丢了。
  return out.replace(/\n/g, MD_HARD_BREAK)
}

/**
 * 给多行文本的每一行加前缀。
 *
 * 空行默认不加前缀（避免行尾空格）。但**块引用必须传 `emptyPrefix`**：引用里的空行
 * 若不带 `>`，CommonMark 会把引用判成「到此为止」，一个引用被劈成两个 —— 语义就变了。
 */
export function prefixLines(text, firstPrefix, restPrefix, emptyPrefix) {
  const lines = String(text || '').split('\n')
  const empty = emptyPrefix === undefined ? '' : emptyPrefix
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i] === '') {
      lines[i] = empty
      continue
    }
    lines[i] = `${i === 0 ? firstPrefix : restPrefix}${lines[i]}`
  }
  return lines.join('\n')
}

// —— 序列化：doc → Markdown ——

function serializeImage(node) {
  // escapeText 已经处理过 `[` `]`，这里别再转一次（会变成 `\\[`）。
  const alt = escapeText(String(attrOf(node, 'alt', '') || ''), false)
  const src = linkHref({ attrs: { href: attrOf(node, 'src', '') } })
  const title = attrOf(node, 'title', '')
  const suffix = title ? ` "${String(title).replace(/"/g, '\\"')}"` : ''
  return `![${alt}](${src}${suffix})`
}

/** 兜底：把子树里的文本拼出来（原子块没 text 时也不至于整段消失）。 */
function textContentOf(node) {
  let out = ''
  const kids = childrenOf(node)
  for (let i = 0; i < kids.length; i += 1) {
    const kid = kids[i]
    if (kid.type === 'text') out += kid.text || ''
    else out += textContentOf(kid)
  }
  return out
}

function serializeInlineNode(node, atLineStart) {
  if (node.type === 'text') return escapeText(node.text, atLineStart)
  if (node.type === 'hardBreak') return MD_HARD_BREAK
  if (node.type === 'image') return serializeImage(node)
  const fallback = INLINE_FALLBACK[node.type]
  if (fallback) return escapeText(fallback(node), atLineStart)
  return escapeText(textContentOf(node), atLineStart)
}

/**
 * 一段行内内容 → 单「行」（硬换行以 `\` + 换行 表示）的 Markdown 字符串。
 *
 * 关键是**分层包裹**，不能「一个 text 节点就地裹完」。同一段上同时挂着 bold 与 italic
 * 时，正确写法是 `**粗 *斜* 粗**`；逐节点裹会写出 `**粗 *****斜***** 粗**`，五个星号
 * 在多数渲染器里被判成别的强调等级，往返当场断掉。做法是沿 `MD_MARK_WRAPPERS`
 * 从外到内逐层把「连续拥有同一个 mark（且 attrs 也相同）的节点段」圈出来，段内再
 * 递归进下一层。
 */
export function serializeInline(children) {
  // 行首状态要跨越递归传递（hardBreak 之后才算新行首），所以用共享的小状态对象。
  // `raw` 同理：它标记「当前正落在行内代码段里」，由 code 层进出时开关。
  return wrapRuns(children, 0, { atLineStart: true, raw: false })
}

function wrapRuns(nodes, startIndex, state) {
  for (let w = startIndex; w < MD_MARK_WRAPPERS.length; w += 1) {
    const wrapper = MD_MARK_WRAPPERS[w]
    if (!runsHaveMark(nodes, wrapper.name)) continue
    let out = ''
    let cursor = 0
    while (cursor < nodes.length) {
      const present = hasMark(nodes[cursor], wrapper.name)
      const anchor = present ? findMark(nodes[cursor], wrapper.name) : null
      let end = cursor + 1
      while (end < nodes.length) {
        if (hasMark(nodes[end], wrapper.name) !== present) break
        // 同一个 mark 但 attrs 不同（两个指向不同地址的相邻链接）必须切开。
        if (present && !sameMarkValue(anchor, findMark(nodes[end], wrapper.name))) break
        end += 1
      }
      if (!present) {
        out += wrapRuns(nodes.slice(cursor, end), w + 1, state)
      } else {
        // 进代码段前打开 raw：段内是字面量，不能转义（见 rawTextOf 的注释）。
        const wasRaw = state.raw
        if (wrapper.name === 'code') state.raw = true
        const inner = wrapRuns(nodes.slice(cursor, end), w + 1, state)
        state.raw = wasRaw
        out += `${wrapper.open(anchor, inner)}${inner}${wrapper.close(anchor, inner)}`
      }
      cursor = end
    }
    return out
  }
  return plainRuns(nodes, state)
}

function runsHaveMark(nodes, name) {
  for (let i = 0; i < nodes.length; i += 1) {
    if (hasMark(nodes[i], name)) return true
  }
  return false
}

function sameMarkValue(a, b) {
  if (!a || !b) return false
  return JSON.stringify(a.attrs || {}) === JSON.stringify(b.attrs || {})
}

/**
 * 行内代码段里的字面文本。
 *
 * 为什么**不走 escapeText**：代码段内容是字面量，`\` 在里面就是反斜杠本身。转义一次变
 * `\\`、下一轮再转一次变 `\\\\` —— 每转一轮翻倍，`serialize ∘ parse` 当场发散。
 * 反引号也不用转义：围栏长度已按内容里最长的反引号串 +1 取过（`codeFence`）。
 */
function rawTextOf(node) {
  const value = node.type === 'text' ? String(node.text || '') : textContentOf(node)
  // 代码段里的换行在 Markdown 里没有硬换行可言，一律落成空格（GFM 也是这么渲染的）。
  return value.replace(/\r\n?/g, ' ').replace(/\n/g, ' ')
}

/** 已无更高层 mark 可裹：直接落文本（hardBreak 在此重置行首状态）。 */
function plainRuns(nodes, state) {
  let out = ''
  for (let i = 0; i < nodes.length; i += 1) {
    out += state.raw ? rawTextOf(nodes[i]) : serializeInlineNode(nodes[i], state.atLineStart)
    state.atLineStart = nodes[i].type === 'hardBreak'
  }
  return out
}

export function clampHeadingLevel(level) {
  const value = Number(level)
  if (!Number.isFinite(value)) return MD_HEADING_MAX
  if (value < MD_HEADING_MIN) return MD_HEADING_MIN
  if (value > MD_HEADING_MAX) return MD_HEADING_MAX
  return Math.round(value)
}

/** 列表项标记：有序用序号、无序用 `-`、任务列表用勾选框。 */
function markerOf(node, index, kind) {
  if (kind === 'task') return node.attrs && node.attrs.checked ? '- [x] ' : '- [ ] '
  if (kind === 'ordered') return `${index + 1}. `
  return '- '
}

/**
 * 列表项里「可以紧贴上一块、不必空一行」的子块类型。
 *
 * 不空行的原因：空一行会让 CommonMark 把这两块判成**同一个列表项的松散延续**之外
 * 的东西，嵌套列表尤其明显（`- 二\n\n  - 二点一` 回来会多出一层空行，第二轮序列化
 * 就不稳定）。段落不行 —— 两个段落紧贴会被并成一段（懒延续行）。
 */
const MD_TIGHT_AFTER = Object.freeze([
  'bulletList', 'orderedList', 'taskList', 'blockquote', 'codeBlock', 'table',
])

/**
 * 列表项「内容列」的宽度 = 子块要缩进多少列。
 *
 * 为什么**不等于标记长度**：GFM 的勾选框 `[x] ` 是正文的一部分（marked 解析时从正文里
 * 剥掉它），内容列仍定在 `- ` 之后 —— 也就是 2 列。按标记长度 6 缩进子列表时，
 * marked 反解会把那行当成上一行的懒延续行，子列表塌回父项同一段，第二轮序列化就散了。
 *
 * 有序列表例外：序号本身就是标记，`10. ` 的内容列确实是 4 列，所以取标记长度。
 */
function contentIndentOf(kind, marker) {
  return kind === 'ordered' ? marker.length : 2
}

function serializeList(node, indent, kind) {
  const items = childrenOf(node)
  if (!items.length) return ''
  const blocks = []
  for (let i = 0; i < items.length; i += 1) {
    const block = serializeListItem(items[i], indent, kind, i)
    if (block !== '') blocks.push(block)
  }
  return blocks.join('\n')
}

function serializeListItem(node, indent, kind, index) {
  const marker = markerOf(node, index, kind)
  const firstPrefix = `${indent}${marker}`
  // 续行必须对齐到「内容列」，否则第二行会被判成代码块或正文。
  const restPrefix = `${indent}${' '.repeat(marker.length)}`
  const childIndent = `${indent}${' '.repeat(contentIndentOf(kind, marker))}`
  const kids = childrenOf(node)
  const out = []
  for (let i = 0; i < kids.length; i += 1) {
    const kid = kids[i]
    if (i === 0 && kid.type === 'paragraph') {
      out.push(prefixLines(serializeInline(childrenOf(kid)), firstPrefix, restPrefix))
      continue
    }
    const block = serializeBlock(kid, childIndent)
    if (!block) continue
    if (out.length && MD_TIGHT_AFTER.indexOf(kid.type) === -1) out.push('')
    out.push(block)
  }
  return out.join('\n')
}

function fenceAround(text) {
  let longest = 0
  let run = 0
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '`') {
      run += 1
      if (run > longest) longest = run
    } else {
      run = 0
    }
  }
  return '`'.repeat(Math.max(3, longest + 1))
}

function serializeCodeBlock(node, indent) {
  const text = textContentOf(node).replace(/\n$/, '')
  const fence = fenceAround(text)
  const language = String(attrOf(node, 'language', '') || '').trim()
  return prefixLines(`${fence}${language}\n${text}\n${fence}`, indent, indent)
}

/**
 * 表格：GFM 没有「无表头表格」，首行一律按表头落（并补一行分隔行）。
 * 这意味着**首行是普通单元格的表格往返后会变成表头单元格** —— 已知的不严格往返点，
 * 见文件末尾的取舍清单。
 */
function serializeTable(node, indent) {
  const rows = []
  const kids = childrenOf(node)
  for (let i = 0; i < kids.length; i += 1) {
    const row = serializeTableRow(kids[i])
    if (row.length) rows.push(row)
  }
  if (!rows.length) return ''
  const columnCount = rows[0].length
  const lines = []
  for (let i = 0; i < rows.length; i += 1) {
    const cells = []
    for (let c = 0; c < columnCount; c += 1) cells.push(rows[i][c] === undefined ? '' : rows[i][c])
    lines.push(`| ${cells.join(' | ')} |`)
    if (i === 0) {
      const divider = []
      for (let c = 0; c < columnCount; c += 1) divider.push('---')
      lines.push(`| ${divider.join(' | ')} |`)
    }
  }
  return prefixLines(lines.join('\n'), indent, indent)
}

function serializeTableRow(node) {
  const cells = []
  const kids = childrenOf(node)
  for (let i = 0; i < kids.length; i += 1) {
    const kid = kids[i]
    if (kid.type !== 'tableCell' && kid.type !== 'tableHeader') continue
    // 单元格里若有多块，退化成「块间用 <br> 拼接的单行」——表格单元格装不下块结构。
    const parts = []
    const blocks = childrenOf(kid)
    for (let b = 0; b < blocks.length; b += 1) {
      const text = serializeInline(childrenOf(blocks[b]))
      if (text !== '') parts.push(text)
    }
    cells.push(parts.join('<br>'))
  }
  return cells
}

/**
 * 单块序列化。返回**已带缩进前缀**的字符串；返回 `''` 表示这块不落 Markdown
 * （调用方会把它剔除，不留空行）。
 */
function serializeBlock(node, indent) {
  if (!node || typeof node !== 'object') return ''
  if (BLOCK_SKIP.indexOf(node.type) !== -1) return ''
  switch (node.type) {
    case 'paragraph': {
      const text = serializeInline(childrenOf(node))
      // 全空段落不落空行，否则文档里会出现一串无意义的分隔。
      return text === '' ? '' : prefixLines(text, indent, indent)
    }
    case 'heading': {
      const text = serializeInline(childrenOf(node))
      if (text === '') return ''
      const level = clampHeadingLevel(attrOf(node, 'level', MD_HEADING_MAX))
      return prefixLines(`${'#'.repeat(level)} ${text}`, indent, indent)
    }
    case 'blockquote': {
      // 子块用「零缩进」序列化：下面的 prefixLines 会把 `> ` 加到每一行，两层都加
      // `indent` 就会得到 `>   引用` 这种多出两个空格的引用（列表里的引用尤其明显）。
      const inner = serializeChildren(childrenOf(node), '')
      if (inner === '') return ''
      return prefixLines(inner, `${indent}> `, `${indent}> `, `${indent}>`)
    }
    case 'bulletList':
      return serializeList(node, indent, 'bullet')
    case 'orderedList':
      return serializeList(node, indent, 'ordered')
    case 'taskList':
      return serializeList(node, indent, 'task')
    case 'codeBlock':
      return serializeCodeBlock(node, indent)
    case 'horizontalRule':
      return `${indent}---`
    case 'table':
      return serializeTable(node, indent)
    default:
      return ''
  }
}

/** 一串块节点 → Markdown（块间空一行）。 */
function serializeChildren(nodes, indent) {
  const blocks = []
  for (let i = 0; i < nodes.length; i += 1) {
    const block = serializeBlock(nodes[i], indent)
    if (block === '') continue
    blocks.push(block)
  }
  return blocks.join(MD_BLOCK_SEPARATOR)
}

/**
 * 从 ProseMirror doc 直接序列化 Markdown。
 *
 * 入参既接受 `doc.toJSON()` 的普通对象，也接受 doc 节点实例（Fragment 走同一条路径），
 * 因为导出时手上是实例、单测里写的是 JSON。
 */
export function serializeMarkdown(doc) {
  if (!doc || typeof doc !== 'object') return ''
  const nodes = Array.isArray(doc) ? doc : childrenOf(doc)
  return serializeChildren(nodes, '')
}
