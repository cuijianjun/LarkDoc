/**
 * Markdown → doc 归一（往返 codec 的**解析半边**）。
 *
 * 为什么单独一个文件：
 *   解析要 `marked`（raw 78.5 KiB / gzip 约 26 KiB）。而导出线（serializeMarkdown）
 *   完全不碰 marked —— 它是`doc → 字符串`，一行不需要。两者原先同文件，`import { marked }`
 *   就把 marked 钉进了 esm / umd / element 的**首屏** chunk，`vue.config.js` 里那个
 *   `markdown` cacheGroup（`chunks: 'async'`）因此永远没有生效机会。
 *
 *   拆开之后 `marked` 只剩这一处引用，而本文件**只被单测静态引用**：
 *   - 运行期的 Markdown 导入走 `utils/importExport.js` 的 `markdownToHtml`（那条链路本来
 *     就是 `await import()`，落在 import-export 按需区块里）；
 *   - `parseMarkdown` 属于「md → doc JSON」的内部工具，从未进入公开导出面
 *     （`src/index.js` 不导出 utils/export），所以不落进库产物不构成 API 变更。
 *
 * 三条负结论（别在这里做）：
 *   1. **不要从 markdown.js 反向 import 本文件**：那会让 marked 顺着静态图回到首屏，
 *      拆分的唯一收益立刻归零。依赖方向只能是 parse → serialize。
 *   2. **不建 DOM**：归一器只认标签名与属性（`scanHtml` 是手写扫描器），Node 单测与浏览器
 *      走同一条路径，jsdom 只是让 `document` 存在，不参与解析。
 *   3. **不把 `HTML_*` 常量复制一份**：共享表（透明容器 / void 元素 / 块级标签 / 实体）
 *      的唯一来源是 markdown.js，复制会让「往返幂等」在两张表漂移时静默失效。
 */
import { marked } from 'marked'
import {
  HTML_TRANSPARENT,
  MD_HARD_BREAK,
  MD_HEADING_MAX,
  clampHeadingLevel,
  isBlockTag,
  scanHtml,
} from './markdown.js'

// —— 解析：Markdown → HTML → doc ——

/**
 * 子树 → 块数组。
 *
 * 行内内容**累积后**再包成一个段落：这样 `<li>文本<ul>…</ul></li>` 里的文本不会被丢，
 * 也不会把紧跟的嵌套列表吞进同一个段落。
 */
function blocksFromNodes(nodes) {
  const blocks = []
  let pending = []
  const flush = () => {
    if (!pending.length) return
    const inline = trimInlineEdges(mergeInlineRuns(inlineFromNodes(pending, [])))
    pending = []
    if (!inline.length) return
    blocks.push({ type: 'paragraph', content: inline })
  }
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]
    if (node.tag !== '#text' && isBlockTag(node.tag)) {
      flush()
      const block = blockFromNode(node)
      if (block) blocks.push(block)
      continue
    }
    // 行内标签（<strong>/<a>/<code>/<br>/<img> …）连自己一起进累积区。
    pending.push(node)
  }
  flush()
  return blocks
}

/**
 * 软换行归一。
 *
 * marked 把一个段落里的换行**原样留在 HTML**（`<p>第一行\n第二行</p>`）。CommonMark
 * 里软换行等价于一个空格，直接保留换行会在下一轮被 `escapeText` 落成硬换行标记，
 * 于是「一行变两行」，往返漂移。这里统一折成空格；代码块走 `collapseInline`，不受影响。
 */
function softenText(value) {
  return String(value === null || value === undefined ? '' : value).replace(/[ \t]*\r?\n[ \t]*/g, ' ')
}

/** 去掉块首尾的空白文本节点（HTML 缩进的产物），hardBreak 不算空白。 */
function trimInlineEdges(nodes) {
  const out = []
  for (let i = 0; i < nodes.length; i += 1) out.push(nodes[i])
  while (out.length && out[0].type === 'text' && out[0].text.trim() === '') out.shift()
  while (out.length && out[out.length - 1].type === 'text' && out[out.length - 1].text.trim() === '') out.pop()
  if (out.length && out[0].type === 'text') out[0] = { ...out[0], text: out[0].text.replace(/^\s+/, '') }
  const last = out.length - 1
  if (out.length && out[last].type === 'text') out[last] = { ...out[last], text: out[last].text.replace(/\s+$/, '') }
  return out
}

/** 行内累积区 → 纯文本（`<br>` 落成硬换行标记），供代码块取正文。 */
function collapseInline(nodes) {
  let out = ''
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]
    if (node.tag === '#text') {
      out += node.text
      continue
    }
    if (node.tag === 'br') {
      out += MD_HARD_BREAK
      continue
    }
    out += collapseInline(node.children || [])
  }
  return out
}

/**
 * 行内累积区 → doc 内联节点数组（带 mark）。
 *
 * 走「遍历 + 上下文 mark 栈」：`<strong><em>x</em></strong>` 得到的是 `x` 上同时挂
 * bold + italic，而不是嵌套结构 —— ProseMirror 的行内模型本来就是扁的。
 */
function inlineFromNodes(nodes, marks) {
  const result = []
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]
    if (node.tag === '#text') {
      const text = softenText(node.text)
      if (text !== '') result.push(withMarks({ type: 'text', text }, marks))
      continue
    }
    if (node.tag === 'br') {
      result.push(withMarks({ type: 'hardBreak' }, marks))
      continue
    }
    if (node.tag === 'img') {
      result.push(withMarks({
        type: 'image',
        attrs: { src: node.attrs.src || '', alt: node.attrs.alt || '', title: node.attrs.title || '' },
      }, marks))
      continue
    }
    const next = marks.slice()
    const mark = markFromTag(node)
    if (mark) next.push(mark)
    const kids = inlineFromNodes(node.children || [], next)
    for (let k = 0; k < kids.length; k += 1) result.push(kids[k])
  }
  return result
}

function withMarks(node, marks) {
  if (!marks.length) return node
  return { ...node, marks: marks.slice() }
}

/** 归并相邻、mark 完全相同的文本节点 —— 不并会在往返比较里产生假差异。 */
function mergeInlineRuns(nodes) {
  const out = []
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]
    const prev = out[out.length - 1]
    if (prev && node.type === 'text' && prev.type === 'text' && sameMarks(prev, node)) {
      prev.text += node.text
      continue
    }
    out.push(node)
  }
  return out
}

function sameMarks(a, b) {
  const left = a.marks || []
  const right = b.marks || []
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i += 1) {
    if (left[i].type !== right[i].type) return false
    if (JSON.stringify(left[i].attrs || {}) !== JSON.stringify(right[i].attrs || {})) return false
  }
  return true
}

function markFromTag(node) {
  switch (node.tag) {
    case 'strong':
    case 'b':
      return { type: 'bold' }
    case 'em':
    case 'i':
      return { type: 'italic' }
    case 'del':
    case 's':
      return { type: 'strike' }
    case 'u':
      return { type: 'underline' }
    case 'mark':
      return { type: 'highlight' }
    case 'code':
      return { type: 'code' }
    case 'a':
      return { type: 'link', attrs: { href: node.attrs.href || '' } }
    default:
      return null
  }
}

function blockFromNode(node) {
  if (node.tag === 'hr') return { type: 'horizontalRule' }
  if (node.tag === 'pre') return codeBlockFrom(node)
  if (node.tag === 'blockquote') return blockquoteFrom(node)
  if (node.tag === 'ul' || node.tag === 'ol') return listFrom(node)
  if (node.tag === 'table') return tableFrom(node)
  if (/^h[1-6]$/.test(node.tag)) return headingFrom(node)
  // `<p>` 与游离的 `<li>` / 未知块标签都按段落落，优先保住文本。
  return paragraphFrom(node)
}

function paragraphFrom(node) {
  const inline = trimInlineEdges(mergeInlineRuns(inlineFromNodes(node.children || [], [])))
  return { type: 'paragraph', content: inline }
}

function headingFrom(node) {
  const level = clampHeadingLevel(Number(String(node.tag).slice(1)) || MD_HEADING_MAX)
  const inline = trimInlineEdges(mergeInlineRuns(inlineFromNodes(node.children || [], [])))
  return { type: 'heading', attrs: { level }, content: inline }
}

function blockquoteFrom(node) {
  const kids = node.children || []
  // marked 的 blockquote 里通常是块；只有行内时（手写 HTML 的 `> 文本`）包一层段落。
  const hasBlock = kids.some((kid) => kid.tag !== '#text' && isBlockTag(kid.tag))
  const blocks = hasBlock ? blocksFromNodes(kids) : [paragraphFrom(node)]
  return { type: 'blockquote', content: blocks.length ? blocks : [{ type: 'paragraph' }] }
}

/** 列表：先判任务列表（子节点 `<li>` 开头是 checkbox input），再分有序 / 无序。 */
function listFrom(node) {
  const items = []
  const kids = node.children || []
  for (let i = 0; i < kids.length; i += 1) {
    if (kids[i].tag === 'li') items.push(kids[i])
    else if (isBlockTag(kids[i].tag)) {
      // 列表里夹着的非 li 块（少见）：按段落保住文本，别整段丢。
      const block = blockFromNode(kids[i])
      if (block) items.push({ tag: 'li', children: kids[i].children || [] })
    }
  }
  if (!items.length) return null
  const isTask = items.some((item) => Boolean(checkboxOf(item)))
  if (isTask) {
    return {
      type: 'taskList',
      content: items.map((item) => {
        const box = checkboxOf(item)
        const rest = item.children.filter((kid) => kid !== box)
        const blocks = blocksFromNodes(rest)
        return { type: 'taskItem', attrs: { checked: Boolean(box && box.attrs.checked !== undefined) }, content: blocks.length ? blocks : [{ type: 'paragraph' }] }
      }),
    }
  }
  const content = items.map((item) => {
    const blocks = blocksFromNodes(item.children || [])
    return { type: 'listItem', content: blocks.length ? blocks : [{ type: 'paragraph' }] }
  })
  if (node.tag === 'ol') return { type: 'orderedList', attrs: { start: 1 }, content }
  return { type: 'bulletList', content }
}

function checkboxOf(item) {
  const kids = item.children || []
  for (let i = 0; i < kids.length; i += 1) {
    const kid = kids[i]
    if (kid.tag === 'input' && String(kid.attrs.type || '').toLowerCase() === 'checkbox') return kid
  }
  return null
}

function codeBlockFrom(node) {
  const code = node.children.filter((kid) => kid.tag === 'code')[0] || node
  const matched = /language-([\w+#.-]+)/.exec(String(code.attrs.class || ''))
  const text = collapseInline(code.children || []).replace(/\n$/, '')
  const content = text === '' ? [] : [{ type: 'text', text }]
  return matched ? { type: 'codeBlock', attrs: { language: matched[1] }, content } : { type: 'codeBlock', content }
}

function tableFrom(node) {
  const rows = collectRows(node.children || [])
  if (!rows.length) return null
  const content = []
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]
    const cells = []
    for (let c = 0; c < row.cells.length; c += 1) {
      const cell = row.cells[c]
      const blocks = blocksFromNodes(cell.children)
      cells.push({ type: cell.header ? 'tableHeader' : 'tableCell', content: blocks.length ? blocks : [{ type: 'paragraph' }] })
    }
    content.push({ type: 'tableRow', content: cells })
  }
  return { type: 'table', content }
}

/** 表格行：`<thead>/<tbody>/<tfoot>` 是透明容器，行按文档序收。 */
function collectRows(nodes) {
  const rows = []
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]
    if (node.tag === 'tr') {
      const cells = []
      for (let c = 0; c < node.children.length; c += 1) {
        const kid = node.children[c]
        if (kid.tag === 'td') cells.push({ header: false, children: kid.children })
        else if (kid.tag === 'th') cells.push({ header: true, children: kid.children })
      }
      rows.push({ cells })
      continue
    }
    if (HTML_TRANSPARENT.indexOf(node.tag) !== -1) {
      const kids = collectRows(node.children || [])
      for (let k = 0; k < kids.length; k += 1) rows.push(kids[k])
    }
  }
  return rows
}

/**
 * Markdown → ProseMirror doc JSON。
 *
 * 走 marked（GFM）生成 HTML，再交给 `htmlToDoc` 归一。返回的 JSON 可直接喂
 * `editor.commands.setContent()`，且满足 `serializeMarkdown(parseMarkdown(md))` 幂等
 * （转义与缩进都取规范形式，见 `escapeText` / `prefixLines`）。
 */
export function parseMarkdown(markdown) {
  const html = marked.parse(String(markdown === null || markdown === undefined ? '' : markdown), { gfm: true, mangle: false, headerIds: false })
  const content = htmlToDoc(html)
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] }
}

/** HTML 字符串 → 块数组（marked 的产物可以直接喂进来）。 */
export function htmlToDoc(html) {
  return blocksFromNodes(scanHtml(html))
}
