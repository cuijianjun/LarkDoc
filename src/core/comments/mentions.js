/* Comment offsets are UTF-16 positions in the unchanged plain content. */
const principal = value => typeof value === 'string' && /^[A-Za-z0-9._-]{1,128}(?![\s\S])/.test(value)
const boundary = (text, at) => !(at > 0 && at < text.length && /[\uD800-\uDBFF]/.test(text[at - 1]) && /[\uDC00-\uDFFF]/.test(text[at]))

export function normalizeCommentMentions(content, input = [], labels = false) {
  if (typeof content !== 'string' || !Array.isArray(input) || input.length > 100) throw new Error('COMMENT_MENTIONS_INVALID')
  let end = 0
  return input.map(value => {
    if (!value || !principal(value.principalId) || !Number.isSafeInteger(value.from) || !Number.isSafeInteger(value.to) ||
      value.from < end || value.from < 0 || value.to <= value.from + 1 || value.to > content.length ||
      !boundary(content, value.from) || !boundary(content, value.to) || content[value.from] !== '@' ||
      (labels && (typeof value.displayName !== 'string' || !value.displayName || value.displayName.includes('\0') ||
        !['@' + value.displayName, '@' + value.principalId].includes(content.slice(value.from, value.to))))) throw new Error('COMMENT_MENTIONS_INVALID')
    end = value.to
    return { principalId: value.principalId, from: value.from, to: value.to, ...(labels ? { displayName: value.displayName } : {}) }
  })
}

export function normalizeCommentReferences(content, input = [], labels = false) {
  if (typeof content !== 'string' || !Array.isArray(input) || input.length > 100) throw new Error('COMMENT_REFERENCES_INVALID')
  let end = 0
  return input.map(value => {
    if (!value || !principal(value.docId) || !Number.isSafeInteger(value.from) || !Number.isSafeInteger(value.to) ||
      value.from < end || value.from < 0 || value.to <= value.from || value.to > content.length ||
      !boundary(content, value.from) || !boundary(content, value.to) ||
      (labels && (typeof value.displayName !== 'string' || !value.displayName || value.displayName.length > 255 || /[\p{Cc}]/u.test(value.displayName) ||
        typeof value.readable !== 'boolean' || ![value.displayName, value.docId].includes(content.slice(value.from, value.to))))) throw new Error('COMMENT_REFERENCES_INVALID')
    end = value.to
    return { docId: value.docId, from: value.from, to: value.to, ...(labels ? { displayName: value.displayName, readable: value.readable } : {}) }
  })
}

export function normalizeCommentMetadata(content, mentions = [], references = [], labels = false) {
  const result = { mentions: normalizeCommentMentions(content, mentions, labels), references: normalizeCommentReferences(content, references, labels) }
  const spans = [...result.mentions, ...result.references].sort((a, b) => a.from - b.from)
  if (spans.length > 100 || spans.some((value, index) => index && value.from < spans[index - 1].to)) throw new Error('COMMENT_METADATA_OVERLAP')
  return result
}

export function commentMentionSegments(content, mentions = [], references = []) {
  let safe
  try {
    const labeledMentions = mentions.map(item => item && item.displayName ? item : { ...item, displayName: content.slice(item.from, item.to).replace(/^@/, '') })
    const labeledReferences = references.map(item => item && item.displayName ? item : { ...item, displayName: content.slice(item.from, item.to), readable: item.readable !== false })
    const value = normalizeCommentMetadata(content, labeledMentions, labeledReferences, true); safe = [...value.mentions, ...value.references].sort((a, b) => a.from - b.from)
  } catch { return [{ text: content || '' }] }
  const result = []; let at = 0
  safe.forEach(value => {
    if (value.from > at) result.push({ text: content.slice(at, value.from) })
    result.push({ ...value, text: content.slice(value.from, value.to) }); at = value.to
  })
  if (at < content.length || !result.length) result.push({ text: content.slice(at) })
  return result
}

/** Read-only projection for server RichText payloads; marks stay data-only until the UI renderer applies them. */
export function commentRichContentSegments(value) {
  const result = []
  let offset = 0
  const append = segment => { result.push(segment); offset += segment.text.length }
  const visit = node => {
    if (!node || typeof node !== 'object') return
    if (typeof node.text === 'string') { append({ text: node.text, marks: Array.isArray(node.marks) ? node.marks : [] }); return }
    if (node.type === 'hardBreak') { append({ text: '\n', marks: [] }); return }
    if (['commentMention', 'commentDocumentReference'].includes(node.type) && typeof node.attrs?.text === 'string') {
      const attrs = node.attrs
      append({ text: attrs.text, marks: [],
        ...(node.type === 'commentMention' && principal(attrs.principalId) ? { principalId: attrs.principalId, from: offset, to: offset + attrs.text.length } : {}),
        ...(node.type === 'commentDocumentReference' && principal(attrs.docId) ? { docId: attrs.docId, readable: attrs.readable !== false, from: offset, to: offset + attrs.text.length } : {}) })
      return
    }
    if (node.type === 'doc' && Array.isArray(node.content)) {
      node.content.forEach((child, index) => { if (index) append({ text: '\n', marks: [] }); visit(child) })
      return
    }
    if (Array.isArray(node.content)) node.content.forEach(visit)
  }
  visit(value)
  return result.length ? result : [{ text: '' }]
}

export function serializeCommentDocument(doc) {
  let content = ''; const mentions = [], references = []
  function inline(node) {
    if (node.type === 'text') content += node.text || ''
    else if (node.type === 'hardBreak') content += '\n'
    else if (node.type === 'commentMention') {
      const from = content.length; content += node.attrs.text
      mentions.push({ principalId: node.attrs.principalId, from, to: content.length })
    } else if (node.type === 'commentDocumentReference') {
      const from = content.length; content += node.attrs.text
      references.push({ docId: node.attrs.docId, from, to: content.length, ...(node.attrs.readable === false ? { readable: false } : {}) })
    } else (node.content || []).forEach(inline)
  }
  const blocks = doc.content || []
  blocks.forEach((node, index) => { if (index) content += '\n'; inline(node) })
  const value = normalizeCommentMetadata(content, mentions, references)
  // readable is draft presentation state only; the HTTP boundary strips it.
  return { content, mentions: value.mentions, ...(references.length ? { references: value.references.map((item, index) => ({ ...item, ...(references[index].readable === false ? { readable: false } : {}) })) } : {}) }
}

export function commentDraftDocument(content = '', mentions = [], references = []) {
  const metadata = normalizeCommentMetadata(content, mentions, references),
    valid = [...metadata.mentions, ...metadata.references.map((value, index) => ({ ...value, readable: references[index].readable !== false }))].sort((a, b) => a.from - b.from), nodes = []; let at = 0
  function text(value) {
    value.split('\n').forEach((part, index) => { if (index) nodes.push({ type: 'hardBreak' }); if (part) nodes.push({ type: 'text', text: part }) })
  }
  valid.forEach(value => {
    text(content.slice(at, value.from)); nodes.push(value.docId ? { type: 'commentDocumentReference', attrs: { docId: value.docId, text: content.slice(value.from, value.to), readable: value.readable } } : { type: 'commentMention', attrs: { principalId: value.principalId, text: content.slice(value.from, value.to) } }); at = value.to
  })
  text(content.slice(at))
  return { type: 'doc', content: [{ type: 'paragraph', ...(nodes.length ? { content: nodes } : {}) }] }
}
