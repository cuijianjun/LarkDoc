import { Fragment } from '@tiptap/pm/model'

const safeCalloutEmojis = new Set(['💡', '📌', '⚠️', '✅', '💬', '🎯', '🔥', '🌟', '😄', '❤️', '👍', '🎉'])

// HTML 是导入适配器；所有 JSON 在写入编辑器前必须通过完整 schema 校验。
export function safeUrl(value, image = false) {
  if (typeof value !== 'string' || !value || Array.from(value).some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)) return false
  if (image && /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(value)) return true
  if (/^https?:\/\//i.test(value)) {
    try { const url = new URL(value); return !!url.hostname && !url.username && !url.password } catch (_) { return false }
  }
  return !image && (/^(mailto|tel):[^:<>]+$/i.test(value) || /^#[\w\u0080-\uffff-]+$/.test(value))
}

export function safeColor(value) {
  return typeof value === 'string' && (/^#[\da-f]{3,8}$/i.test(value) || /^(rgb|hsl)a?\([\d.,%\s+-]+\)$/i.test(value) || /^[a-z]+$/i.test(value))
}

export function safeAttachmentId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 1000 && !Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
}

function validateAttrs(type, attrs, definition) {
  if (attrs === undefined) return
  if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) throw new Error(`无效属性：${type}`)
  Object.keys(attrs).forEach((key) => {
    const value = attrs[key]
    if (!definition.attrs || !Object.prototype.hasOwnProperty.call(definition.attrs, key)) throw new Error(`不支持的属性：${type}.${key}`)
    // 公开 TextStyle HTML parser 用空字符串表示未设置的样式，这是合法的原生 JSON。
    if (type === 'textStyle' && value === '' && definition.attrs[key].default === null && ['color', 'backgroundColor', 'fontFamily', 'fontSize', 'lineHeight'].includes(key)) return
    if (value === null) {
      if (definition.attrs[key].default !== null) throw new Error(`必填属性不能为 null：${type}.${key}`)
      return
    }
    let valid = true
    if (key === 'src' || key === 'originalSrc') valid = value === '' || safeUrl(value, true)
    else if (key === 'attchId' || key === 'originalAttchId') valid = safeAttachmentId(value)
    else if (key === 'href') valid = safeUrl(value)
    else if (key === 'level') valid = Number.isInteger(value) && value >= 1 && value <= 9
    else if (key === 'indent') valid = Number.isInteger(value) && value >= 0 && value <= 8
    else if (key === 'width' || key === 'height') valid = Number.isFinite(value) && value >= (type === 'column' ? 10 : 40) && value <= (type === 'column' ? 90 : 2400)
    else if (key === 'lineHeight') valid = /^(normal|[1-4](\.\d{1,2})?)$/.test(String(value))
    else if (key === 'backgroundColor' || key === 'borderColor' || key === 'color') valid = safeColor(value)
    else if (key === 'emoji') valid = safeCalloutEmojis.has(value)
    else if (key === 'align') valid = ['left', 'center', 'right'].includes(value)
    else if (key === 'textAlign') valid = ['left', 'center', 'right', 'justify'].includes(value)
    else if (key === 'verticalAlign') valid = ['top', 'middle', 'bottom'].includes(value)
    else if (key === 'language') valid = typeof value === 'string' && /^[\w+-]{0,32}$/.test(value)
    else if (key === 'fontSize') valid = typeof value === 'string' && /^(?:[8-9]|[1-9]\d|1[0-9]\d|200)(px|pt)$/.test(value)
    else if (key === 'fontFamily') valid = typeof value === 'string' && value.length <= 100 && !/[;{}<>\\]/.test(value)
    else if (key === 'colwidth') valid = Array.isArray(value) && value.every((width) => Number.isInteger(width) && width > 0 && width <= 2400)
    else if (key === 'colspan' || key === 'rowspan' || key === 'start') valid = Number.isInteger(value) && value > 0 && value <= 10000
    else if (key === 'open' || key === 'checked') valid = typeof value === 'boolean'
    else if (key === 'target') valid = ['_blank', '_self'].includes(value)
    else if (key === 'rel') valid = typeof value === 'string' && /^[a-z\s-]*$/i.test(value)
    else valid = typeof value === 'string' && value.length <= 100000 && !value.includes('\u0000')
    if (!valid) throw new Error(`不安全或无效的属性：${type}.${key}`)
  })
}

export function validateDocument(json, schema) {
  if (!json || json.type !== 'doc') throw new Error('请输入有效的 Tiptap 文档 JSON')
  let count = 0
  function visit(item, depth) {
    if (!item || typeof item !== 'object' || depth > 100 || ++count > 100000) throw new Error('文档结构过深或过大')
    const type = schema.nodes[item.type]
    if (!type) throw new Error(`不支持的节点：${item.type}`)
    const unknown = Object.keys(item).find((key) => !['type', 'attrs', 'content', 'marks', 'text'].includes(key))
    if (unknown) throw new Error(`不支持的节点字段：${unknown}`)
    validateAttrs(item.type, item.attrs, type)
    if (item.type === 'text' && (typeof item.text !== 'string' || !item.text)) throw new Error('文本节点不能为空')
    if (item.type !== 'text' && item.text !== undefined) throw new Error('非文本节点包含 text')
    if (item.content !== undefined && !Array.isArray(item.content)) throw new Error('content 必须为数组')
    if (item.marks !== undefined && !Array.isArray(item.marks)) throw new Error('marks 必须为数组')
    ;(item.marks || []).forEach((mark) => {
      const markType = mark && schema.marks[mark.type]
      if (!markType) throw new Error(`不支持的格式：${mark && mark.type}`)
      if (Object.keys(mark).some((key) => !['type', 'attrs'].includes(key))) throw new Error('不支持的格式字段')
      validateAttrs(mark.type, mark.attrs, markType)
    })
    ;(item.content || []).forEach((child) => visit(child, depth + 1))
  }
  visit(json, 0)
  const node = schema.nodeFromJSON(json)
  node.check()
  node.descendants((child) => {
    if (child.type.name === 'image' && !safeUrl(child.attrs.src, true)) throw new Error('图片地址无效')
  })
  return node.toJSON()
}

export function sanitizeHTML(html) {
  if (typeof html !== 'string') throw new Error('HTML 必须为字符串')
  const container = document.createElement('div')
  container.innerHTML = html
  const tags = new Set(['P', 'DIV', 'SPAN', 'MARK', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'DEL', 'CODE', 'PRE', 'SUB', 'SUP', 'BLOCKQUOTE', 'HR', 'UL', 'OL', 'LI', 'A', 'IMG', 'FIGURE', 'FIGCAPTION', 'TABLE', 'TBODY', 'THEAD', 'TR', 'TH', 'TD', 'COLGROUP', 'COL', 'DETAILS', 'SUMMARY', 'LABEL', 'INPUT'])
  const dangerous = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'TEMPLATE', 'NOSCRIPT', 'LINK', 'META', 'BASE', 'FRAME', 'FRAMESET'])
  const attributes = new Set(['href', 'src', 'alt', 'title', 'width', 'colspan', 'rowspan', 'colwidth', 'start', 'open', 'type', 'checked', 'disabled', 'data-type', 'data-level', 'data-width', 'data-align', 'data-original-src', 'data-attch-id', 'data-original-attch-id', 'data-caption', 'data-latex', 'data-name', 'data-emoji', 'data-checked', 'data-colwidth', 'data-color', 'data-language', 'data-indent', 'class'])
  Array.from(container.querySelectorAll('*')).forEach((element) => {
    if (!container.contains(element)) return
    const tag = element.tagName.toUpperCase()
    if (dangerous.has(tag)) { element.remove(); return }
    if (!tags.has(tag)) {
      // 普通布局容器只拆外壳；原快照中的后代仍逐个清理，危险子树整段删除。
      while (element.firstChild) element.parentNode.insertBefore(element.firstChild, element)
      element.remove()
      return
    }
    Array.from(element.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase()
      if (name === 'style') {
        const style = element.style
        const allowed = {}
        ;['color', 'background-color', 'text-align', 'vertical-align', 'font-family', 'font-size', 'line-height', 'width', 'padding-left'].forEach((property) => {
          const value = style.getPropertyValue(property)
          if (value && !/[<>;{}\\]|url\s*\(|expression|var\s*\(/i.test(value)) allowed[property] = value
        })
        element.removeAttribute('style')
        Object.keys(allowed).forEach((property) => { element.style.setProperty(property, allowed[property]) })
      } else if (!attributes.has(name)) element.removeAttribute(name)
      else if (name === 'data-color' && (tag !== 'MARK' || !safeColor(attribute.value))) element.removeAttribute(name)
      else if (name === 'colwidth') {
        // Tiptap 输出 colwidth；每个跨列格保留对应的正整数列宽，沿用 JSON 的 2400 上限。
        const widths = attribute.value.split(',').map(Number)
        if (!['TH', 'TD'].includes(tag) || !/^\d+(,\d+)*$/.test(attribute.value) || widths.length !== Number(element.getAttribute('colspan') || 1) || !widths.every(width => Number.isInteger(width) && width > 0 && width <= 2400)) element.removeAttribute(name)
      } else if (name === 'href' && !safeUrl(attribute.value)) element.removeAttribute(name)
      else if ((name === 'src' || name === 'data-original-src') && !safeUrl(attribute.value, true)) element.removeAttribute(name)
      else if ((name === 'data-attch-id' || name === 'data-original-attch-id') && (!['IMG', 'FIGURE'].includes(tag) || !safeAttachmentId(attribute.value))) element.removeAttribute(name)
      else if (name === 'class' && !/^(language-[\w+-]+|tiptap-mathematics-render)$/.test(attribute.value)) element.removeAttribute(name)
      else if (name === 'data-align' && !['left', 'center', 'right'].includes(attribute.value)) element.removeAttribute(name)
    })
    if (element.tagName === 'INPUT') {
      if (element.getAttribute('type') !== 'checkbox') element.remove()
      else element.setAttribute('disabled', '')
    }
    if (element.tagName === 'A') element.setAttribute('rel', 'noopener noreferrer')
  })
  return container.innerHTML
}

export function getSlashMatch(state) {
  const { $from, empty } = state.selection
  if (!empty || $from.parent.type.name !== 'paragraph') return null
  const before = $from.parent.textBetween(0, $from.parentOffset, '\n', '\ufffc')
  const match = /(?:^|\s)\/([^/\s]*)$/.exec(before)
  if (!match) return null
  let inCode = false
  $from.parent.nodesBetween($from.parentOffset - match[1].length - 1, $from.parentOffset, (node) => { if (node.marks.some((mark) => mark.type.name === 'code')) inCode = true })
  return inCode ? null : { from: $from.pos - match[1].length - 1, to: $from.pos, query: match[1] }
}

export function findTextMatches(doc, query) {
  if (typeof query !== 'string' || !query) return []
  const matches = []
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return
    // 文本 Mark 不改变位置；叶节点占位防止跨公式/Emoji 错配。
    const value = node.textBetween(0, node.content.size, '', '\ufffc')
    pattern.lastIndex = 0
    let match = pattern.exec(value)
    while (match) {
      matches.push({ from: pos + 1 + match.index, to: pos + 1 + match.index + match[0].length })
      match = pattern.exec(value)
    }
  })
  return matches
}

export function replaceText(editor, query, replacement, all = false) {
  if (!editor.isEditable || typeof replacement !== 'string') return 0
  const matches = findTextMatches(editor.state.doc, query)
  const selection = editor.state.selection
  const current = matches.find((match) => match.from === selection.from && match.to === selection.to)
    || matches[editor.storage?.feishuDocument?.activeIndex || 0] || matches[0]
  const selected = all ? matches : current ? [current] : []
  if (!selected.length) return 0
  const tr = editor.state.tr
  selected.slice().reverse().forEach(({ from, to }) => {
    const marks = tr.doc.resolve(from).marks()
    if (replacement) tr.replaceWith(from, to, editor.state.schema.text(replacement, marks))
    else tr.delete(from, to)
  })
  editor.view.dispatch(tr)
  return selected.length
}

export function moveBlockRange(editor, from, to, target) {
  const { doc } = editor.state
  if (!editor.isEditable || ![from, to, target].every(Number.isInteger) || from < 0 || from >= to || to > doc.content.size || target < 0 || target > doc.content.size || (target >= from && target <= to)) return false
  const start = doc.resolve(from)
  const end = doc.resolve(to)
  const dest = doc.resolve(target)
  if (!start.sameParent(end) || start.textOffset || end.textOffset || dest.textOffset) return false
  const first = start.index()
  const last = end.index()
  if (start.pos !== start.posAtIndex(first) || end.pos !== end.posAtIndex(last) || dest.pos !== dest.posAtIndex(dest.index())) return false
  const slice = doc.slice(from, to)
  if (slice.openStart || slice.openEnd) return false
  let filler = Fragment.empty
  if (!start.parent.canReplace(first, last)) {
    const empty = start.parent.type.contentMatch.defaultType?.createAndFill()
    if (!empty) return false
    filler = Fragment.from(empty)
    if (!start.parent.canReplace(first, last, filler)) return false
  }
  const tr = editor.state.tr.replaceWith(from, to, filler)
  const insertAt = tr.mapping.map(target, target > to ? -1 : 1)
  const mapped = tr.doc.resolve(insertAt)
  if (!mapped.parent.canReplace(mapped.index(), mapped.index(), slice.content)) return false
  tr.insert(insertAt, slice.content)
  tr.doc.check()
  editor.view.dispatch(tr)
  return true
}

export function collectOutline(doc) {
  const result = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return
    const resolved = doc.resolve(pos)
    const hiddenByContainer = Array.from({ length: resolved.depth }, (_, index) => resolved.node(index + 1).type.name)
      .some((type) => ['callout', 'blockquote', 'detailsContent', 'column', 'tableCell', 'tableHeader'].includes(type))
    if (!hiddenByContainer) result.push({ pos, level: node.attrs.level, text: node.textContent })
  })
  return result
}

const independentSectionBlocks = new Set(['codeBlock', 'blockquote', 'callout', 'table', 'columns', 'image', 'horizontalRule'])
const isolatedHeadingContainers = new Set(['callout', 'blockquote', 'detailsContent', 'column', 'tableCell', 'tableHeader'])

function nodeIndent(node, fallback = 0) {
  return Number.isInteger(node?.attrs?.indent) ? node.attrs.indent : fallback
}

function sectionBlock(node, pos, role) {
  return { from: pos, to: pos + node.nodeSize, node, role }
}

/**
 * Resolve one heading's real section in its immediate parent container.
 * The returned blocks are the only blocks allowed to receive section state;
 * `to` is intentionally the first excluded sibling rather than a giant DOM range.
 */
export function resolveHeadingSection(doc, pos) {
  return resolveHeadingSectionMode(doc, pos, 'highlight')
}

/**
 * Resolve a heading section for either the local block hover or the document
 * folding model. Hover keeps independent root shells as visual boundaries;
 * folding follows the document rule and includes every following block until
 * the next same-or-higher heading.
 */
export function resolveHeadingSectionMode(doc, pos, mode = 'highlight') {
  if (pos < 0 || pos > doc.content.size) return null
  const heading = doc.nodeAt(pos)
  if (!heading || heading.type.name !== 'heading') return null
  const resolved = doc.resolve(pos)
  const parent = resolved.parent
  const baseIndent = nodeIndent(heading)
  let childIndent = baseIndent
  let hasDescendantHeading = false
  let end = resolved.end()
  let hasContent = false
  const blocks = [sectionBlock(heading, pos, 'heading')]
  const hasFollowingBoundary = (startIndex) => {
    for (let lookahead = startIndex + 1; lookahead < resolved.parent.childCount; lookahead += 1) {
      const candidate = resolved.parent.child(lookahead)
      if (candidate.type.name === 'heading' && candidate.attrs.level <= heading.attrs.level) return true
      if (parent.type.name === 'doc' && independentSectionBlocks.has(candidate.type.name)) return true
    }
    return false
  }
  for (let index = resolved.index() + 1; index < resolved.parent.childCount; index += 1) {
    const sibling = resolved.parent.child(index)
    const siblingPos = resolved.posAtIndex(index)
    if (sibling.type.name === 'heading') {
      if (sibling.attrs.level <= heading.attrs.level) { end = siblingPos; break }
      if (mode === 'fold') {
        blocks.push(sectionBlock(sibling, siblingPos, 'descendant-heading'))
        hasDescendantHeading = true
        hasContent = true
        continue
      }
      hasDescendantHeading = true
      // Missing indent attributes still represent a structural child heading.
      // Keep a minimum one-level step so a following root paragraph does not
      // become part of the parent section merely because both default to 0.
      childIndent = Math.max(baseIndent + 1, nodeIndent(sibling, baseIndent + 1))
      blocks.push(sectionBlock(sibling, siblingPos, 'descendant-heading'))
      hasContent = true
      continue
    }
    // At the document root these are independent canvas blocks. A nested
    // code/quote/callout remains part of its actual parent container.
    if (mode === 'highlight' && parent.type.name === 'doc' && independentSectionBlocks.has(sibling.type.name)) { end = siblingPos; break }
    // A paragraph that drops back out of a nested heading's structural path is
    // the next root-level block (the common H2 -> H3 -> root paragraph case).
    // A lower-indent paragraph is outside a nested heading when another
    // section boundary still follows. If this is the terminal section, the
    // paragraph is its trailing body even when it has no explicit indent.
    if (mode === 'highlight' && hasDescendantHeading && sibling.type.name === 'paragraph' && nodeIndent(sibling) < childIndent && hasFollowingBoundary(index)) { end = siblingPos; break }
    if (sibling.isBlock) {
      blocks.push(sectionBlock(sibling, siblingPos, 'body'))
      hasContent = true
    }
  }
  return { from: pos, to: end, headingPos: pos, heading, parent, blocks, hasContent, hasDescendantHeading }
}

export function resolveHeadingHighlightSection(doc, pos) {
  return resolveHeadingSectionMode(doc, pos, 'highlight')
}

export function isPageHeading(doc, pos) {
  if (!doc || pos < 0 || pos > doc.content.size) return false
  const heading = doc.nodeAt(pos)
  if (!heading || heading.type.name !== 'heading') return false
  const resolved = doc.resolve(pos)
  for (let depth = 1; depth <= resolved.depth; depth += 1) {
    if (isolatedHeadingContainers.has(resolved.node(depth).type.name)) return false
  }
  return true
}

export function foldedRange(doc, pos) {
  if (!isPageHeading(doc, pos)) return null
  const section = resolveHeadingSectionMode(doc, pos, 'fold')
  if (!section) return null
  return { from: pos + section.heading.nodeSize, to: section.to }
}

// 复制、剪切和拖动标题时沿用正文折叠的完整章节范围；视觉高亮仍使用
// resolveHeadingHighlightSection 的独立块边界，避免两个交互共享错误的 DOM 区段。
export function headingActionRange(doc, pos) {
  if (!doc || pos < 0 || pos > doc.content.size || !isPageHeading(doc, pos)) return null
  const section = resolveHeadingSectionMode(doc, pos, 'fold')
  if (!section || section.to <= pos + section.heading.nodeSize) return null
  return { from: pos, to: section.to, parentDepth: doc.resolve(pos).depth }
}
