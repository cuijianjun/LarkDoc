import { isImportEnabled, resolveImportFormatId } from '../components/lark-doc/larkDocConfig'
import { loadFeature } from '../core/features/registry'
import { logger } from '../utils/logger'
import { DOMParser as ProseMirrorDOMParser, Fragment } from '@tiptap/pm/model'
import { Selection, EditorState } from '@tiptap/pm/state'
import { fixTables } from '@tiptap/pm/tables'
import { closeHistory } from '@tiptap/pm/history'
import { sanitizeHTML, validateDocument, createBlockId } from '../core/documentOperations'
import { normalizeImportedBlockAttributes, DEFER_BLOCK_ID_META } from '../core/blocks/block-fixes'
import { createNetworkPolicy } from '../networkPolicy'
import { setTransactionMetadata, TRANSACTION_ORIGINS, PAGED_IMPORT_META } from '../core/transactionMetadata'
import { migrateRecordContent } from '../core/migrations'
import { skipTrailingNodeMeta } from '@tiptap/extensions'
import { normalizeVditorHtml } from '../legacy/vditorHtml'

/** Bounded import pages. No whole-input DOM, JSON clone or model flattening. */
const VOID = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '))
const RAW = new Set('script style textarea title xmp iframe noembed noframes'.split(' '))
const BLOCK = /^(?:p|h[1-9]|div|section|article|blockquote|pre|ul|ol|table|figure|details|hr|img)$/
const abortError = () => Object.assign(new Error('导入已取消'), { name: 'AbortError' })
let documentFrameAt = 0
export const yieldDocumentTask = () => {
  const win = typeof window === 'undefined' ? null : window
  if (win?.requestAnimationFrame && !win.document.hidden) {
    const now = win.performance.now()
    if (now < documentFrameAt) documentFrameAt = 0
    if (now - documentFrameAt >= 8) return new Promise(resolve => {
      let frame, timer, settled = false
      const done = () => {
        if (settled) return
        settled = true; win.cancelAnimationFrame(frame); win.clearTimeout(timer)
        // Promise continuations inside RAF still run before painting. Resume
        // parsing in a separate task after the frame has returned to the host.
        win.setTimeout(() => { documentFrameAt = win.performance.now(); resolve() }, 0)
      }
      // A tab can become hidden while waiting for its next animation frame.
      timer = win.setTimeout(done, 32)
      frame = win.requestAnimationFrame(done)
    })
  }
  return win?.scheduler?.yield ? win.scheduler.yield() : new Promise(resolve => setTimeout(resolve, 0))
}

function* htmlPages(html, { pageBlocks, pageChars, maxBlockChars }) {
  // Script-data escaping is an HTML tree-builder state, not a tag boundary.
  // Preserve the whole-input rule, but scan bounded windows before parsing.
  // Seven overlapping characters retain a split <script plus its lookahead.
  let hasContent = false
  for (let offset = 0; offset < html.length; offset += 65536) {
    const probe = html.slice(offset, offset + 65536 + 7)
    if (/<script(?=[\s/>])/i.test(probe)) {
      if (html.length > maxBlockChars) throw new Error('含脚本的超大 HTML 请先移除脚本后导入')
      yield html; return
    }
    if (!hasContent && /\S/.test(probe)) hasContent = true
    yield null
  }
  if (!hasContent) { yield '<p></p>'; return }
  let start = 0, prefix = '', blocks = 0, scanned = 0
  const stack = []
  const transparent = () => stack.every(tag => tag.transparent)
  for (let index = 0; index < html.length;) {
    if (index - scanned >= 65536) { scanned = index; yield null }
    if (index - start > maxBlockChars) throw new Error('单个内容块过大，请拆分该容器后导入')
    if (html[index] !== '<') { index++; continue }
    const tokenStart = index
    if (html.startsWith('<!--', index) && !RAW.has(stack[stack.length - 1]?.name)) {
      index += 4
      while (index < html.length && !html.startsWith('-->', index)) {
        if (index - scanned >= 65536) { scanned = index; yield null }
        if (index - start > maxBlockChars) throw new Error('单个内容块过大，请拆分该容器后导入')
        index++
      }
      index = Math.min(html.length, index + 3)
      continue
    }
    const match = /^<(\/?)([a-z][\w:-]*)\b/i.exec(html.slice(index, index + 128))
    if (!match) { index++; continue }
    const closing = !!match[1], name = match[2].toLowerCase()
    if (RAW.has(stack[stack.length - 1]?.name) && !(closing && name === stack[stack.length - 1].name)) { index++; continue }
    index += match[0].length
    let quote = ''
    while (index < html.length) {
      const char = html[index++]
      if (quote) { if (char === quote) quote = '' }
      else if (char === '"' || char === "'") quote = char
      else if (char === '>') break
      if (index - scanned >= 65536) { scanned = index; yield null }
      if (index - start > maxBlockChars) throw new Error('单个内容块过大，请拆分该容器后导入')
    }
    let wrapperClose = false
    if (closing) {
      let at = stack.length - 1
      while (at >= 0 && stack[at].name !== name) at--
      if (at >= 0) { wrapperClose = stack[at].transparent && stack[at]; stack.splice(at) }
    } else if (!VOID.has(name)) {
      const open = html.slice(tokenStart, index)
      // Plain layout wrappers may span pages. Semantic div NodeViews may not.
      stack.push({ name, open, openedAt: tokenStart, transparent: /^(?:html|body|section|article)$/.test(name)
        || name === 'div' && !/\bdata-[\w-]+\s*=|\b(?:vditor-|language-|footnotes-)/i.test(open) })
      if (stack.length > 100) throw new Error('文档结构过深或过大')
    }
    if ((!wrapperClose || wrapperClose.openedAt >= start) && BLOCK.test(name) && (closing || VOID.has(name)) && transparent()) {
      blocks++
      if (blocks >= pageBlocks || index - start >= pageChars) {
        yield prefix + html.slice(start, index) + stack.slice().reverse().map(tag => `</${tag.name}>`).join('')
        start = index
        prefix = stack.map(tag => tag.open).join('')
        blocks = 0
      }
    }
  }
  if (html.length - start > maxBlockChars) throw new Error('单个内容块过大，请拆分该容器后导入')
  const tail = html.slice(start)
  // Closing layout wrappers alone must not create a synthetic empty paragraph.
  if (tail.replace(/<\s*\/\s*(?:div|html|body|section|article)\s*>/gi, '').trim()) yield prefix + tail
}

const jsonSpace = char => char === ' ' || char === '\t' || char === '\r' || char === '\n'

function* jsonArrayRanges(text, start, end) {
  let from = start, quoted = false, nested = 0, afterComma = false, scanned = start
  for (let index = start; index <= end; index++) {
    if (index - scanned >= 65536) { scanned = index; yield null }
    const char = text[index]
    if (quoted) { if (char === '\\') index++; else if (char === '"') quoted = false; continue }
    if (char === '"') quoted = true
    else if ((char === ',' || index === end) && !nested) {
      let to = index
      while (from < to && jsonSpace(text[from])) { from++; if (from - scanned >= 65536) { scanned = from; yield null } }
      let trimmed = 0
      while (to > from && jsonSpace(text[to - 1])) { to--; if (++trimmed % 65536 === 0) yield null }
      if (from < to) { yield [from, to]; afterComma = char === ',' }
      else if (char === ',' || afterComma) throw new Error('正文数组包含空项')
      from = index + 1
    } else if (char === '{' || char === '[') nested++
    else if (char === '}' || char === ']') nested--
  }
}

function* flatImportBlocks(node, depth = 0) {
  if (depth > 100) throw new Error('文档结构过深或过大')
  if (!node || typeof node !== 'object') throw new Error('无效的正文节点')
  if (Array.isArray(node)) { for (const child of node) yield* flatImportBlocks(child, depth + 1); return }
  if (node.type !== 'heading') { yield node; return }
  const next = { ...node }
  delete next.children
  yield next
  if (Array.isArray(node.children)) for (const child of node.children) yield* flatImportBlocks(child, depth + 1)
}

/** A large exported heading is a container of blocks, not one giant parse unit. */
function* parseJsonBlock(text, from, to, maxBlockChars, depth = 0) {
  if (depth > 100) throw new Error('文档结构过深或过大')
  if (to - from <= maxBlockChars) { yield* flatImportBlocks(JSON.parse(text.slice(from, to))); return }
  let start = -1, end = -1, level = 0, arrayDepth = -1, keys = 0, scanned = from
  if (text[from] === '[') {
    if (text[to - 1] !== ']') throw new Error('无效的正文数组')
    start = from; end = to - 1
  }
  else for (let index = from; index < to; index++) {
    if (index - scanned >= 65536) { scanned = index; yield null }
    const char = text[index]
    if (char === '"') {
      const at = index++
      for (; index < to; index++) {
        if (index - scanned >= 65536) { scanned = index; yield null }
        if (text[index] === '\\') index++
        else if (text[index] === '"') break
      }
      let colon = index + 1
      while (colon < to && jsonSpace(text[colon])) colon++
      if (level !== 1 || text[colon] !== ':' || index - at > 100 || JSON.parse(text.slice(at, index + 1)) !== 'children') continue
      let value = colon + 1
      while (value < to && jsonSpace(text[value])) value++
      if (++keys > 1 || text[value] !== '[') throw new Error('无效或重复的章节子级')
      start = value; arrayDepth = level + 1
    } else if (char === '{' || char === '[') {
      if (++level > 400) throw new Error('文档结构过深或过大')
    } else if (char === '}' || char === ']') {
      if (char === ']' && level === arrayDepth && start >= 0 && end < 0) end = index
      level--
    }
  }
  if (start < 0 || end < start || to - from - (end - start) > maxBlockChars) throw new Error('单个内容块过大，请拆分该容器后导入')
  if (text[from] !== '[') {
    const header = JSON.parse(text.slice(from, start) + '[]' + text.slice(end + 1, to))
    if (header.type !== 'heading') throw new Error('单个内容块过大，请拆分该容器后导入')
    delete header.children
    yield header
  }
  for (const range of jsonArrayRanges(text, start + 1, end)) {
    if (range === null) yield null
    else yield* parseJsonBlock(text, range[0], range[1], maxBlockChars, depth + 1)
  }
}

function* jsonTextPages(text, { pageBlocks, pageChars, maxBlockChars, metadata }) {
  let depth = 0, docDepth = 1, docActive = true, start = -1, end = -1, arrayDepth = -1, keys = 0, documentKeys = 0, scanned = 0
  // First locate the root content array and validate its surrounding envelope.
  // Strings are scanned in bounded turns, never matched by a backtracking regexp.
  for (let index = 0; index < text.length; index++) {
    if (index - scanned >= 65536) { scanned = index; yield null }
    const char = text[index]
    if (char === '"') {
      const from = index++
      for (; index < text.length; index++) {
        if (index - scanned >= 65536) { scanned = index; yield null }
        if (text[index] === '\\') index++
        else if (text[index] === '"') break
      }
      let colon = index + 1
      while (/\s/.test(text[colon] || '') && colon < text.length) colon++
      if (text[colon] !== ':' || index - from > 100) continue
      const key = JSON.parse(text.slice(from, index + 1))
      let value = colon + 1
      while (/\s/.test(text[value] || '') && value < text.length) value++
      if (key === 'document' && depth === 1 && text[value] === '{') {
        if (++documentKeys > 1) throw new Error('重复的文档字段')
        docDepth = 2; docActive = true; keys = 0; start = end = -1
      } else if (key === 'content' && depth === docDepth && docActive) {
        if (++keys > 1 || text[value] !== '[') throw new Error('无效或重复的正文数组')
        start = value; arrayDepth = depth + 1
      }
    } else if (char === '{' || char === '[') {
      if (++depth > 400) throw new Error('文档结构过深或过大')
    } else if (char === '}' || char === ']') {
      if (char === ']' && depth === arrayDepth && start >= 0 && end < 0) end = index
      if (char === '}' && depth === docDepth) docActive = false
      depth--
    }
  }
  if (start < 0 || end < start || text.length - (end - start) > maxBlockChars) throw new Error('无效或过大的文档信息')
  const record = JSON.parse(text.slice(0, start) + '[]' + text.slice(end + 1))
  const root = record.document || record
  if (!root || root.type !== 'doc' || !Array.isArray(root.content)) throw new Error('请输入有效的 Tiptap 文档 JSON')
  metadata.title = typeof record.title === 'string' ? record.title : undefined
  const page = []
  let chars = 0, any = false
  const options = { pageBlocks, pageChars, maxBlockChars }
  for (const range of jsonArrayRanges(text, start + 1, end)) {
    if (range === null) { yield null; continue }
    for (const node of parseJsonBlock(text, range[0], range[1], maxBlockChars)) {
      if (node === null) { yield null; continue }
      const size = JSON.stringify(node).length
      if (page.length && (page.length >= pageBlocks || chars + size > pageChars)) {
        const value = migrateRecordContent({ ...root, content: page.splice(0) }, record.schemaVersion)
        yield* jsonPages(value, options)
        chars = 0
      }
      page.push(node); chars += size; any = true
    }
  }
  if (page.length || !any) yield* jsonPages(migrateRecordContent({ ...root, content: page }, record.schemaVersion), options)
}

function* jsonPages(root, { pageBlocks, pageChars = 131072, maxBlockChars = 2097152 }) {
  if (!root || root.type !== 'doc' || !Array.isArray(root.content)) throw new Error('请输入有效的 Tiptap 文档 JSON')
  const page = []
  function* budget(node) {
    let chars = 0, values = 0
    function* scan(value, depth) {
      if (depth > 400) throw new Error('文档结构过深或过大')
      if (++values % 512 === 0) yield null
      if (typeof value === 'string') chars += value.length
      else if (value && typeof value === 'object') for (const key of Object.keys(value)) yield* scan(value[key], depth + 1)
      if (chars > maxBlockChars) throw new Error('单个内容块过大，请拆分该容器后导入')
    }
    yield* scan(node, 0)
    return chars
  }
  let chars = 0
  for (const node of root.content) {
    for (const next of flatImportBlocks(node)) {
      const size = yield* budget(next)
      if (page.length && chars + size > pageChars) { yield { ...root, content: page.splice(0) }; chars = 0 }
      page.push(next); chars += size
      if (page.length === pageBlocks) { yield { ...root, content: page.splice(0) }; chars = 0 }
    }
  }
  if (page.length || !root.content.length) yield { ...root, content: page }
}

export async function createPagedDocumentSource(content, {
  preparePage, signal, yieldToMain = yieldDocumentTask, pageBlocks = 128, pageChars = 131072, maxBlockChars = 2097152, format,
} = {}) {
  if (typeof preparePage !== 'function') throw new TypeError('preparePage is required')
  if (!Number.isInteger(pageBlocks) || pageBlocks < 1 || pageBlocks > 512) throw new RangeError('Invalid import page size')
  const pages = []
  let size = 0, blockCount = 0
  let pending = [], pendingSize = 0, template
  const flush = () => {
    if (pending.length) pages.push(template.copy(Fragment.fromArray(pending)))
    pending = []; pendingSize = 0
  }
  const check = () => { if (signal?.aborted) throw abortError() }
  const metadata = {}
  const options = { pageBlocks, pageChars, maxBlockChars, metadata }
  const input = typeof content === 'string' ? format === 'json' ? jsonTextPages(content, options) : htmlPages(content, options) : jsonPages(content, options)
  await yieldToMain()
  let lastYield = Date.now()
  for (const value of input) {
    check()
    if (value !== null) {
      const doc = await preparePage(value)
      check()
      if (doc) doc.forEach(node => {
        if (pending.length && (pending.length === pageBlocks || pendingSize + node.nodeSize > pageChars)) flush()
        if (!pending.length) template = doc
        pending.push(node); pendingSize += node.nodeSize
        blockCount++; size += node.nodeSize
      })
    }
    if (value !== null || Date.now() - lastYield >= 8) { await yieldToMain(); lastYield = Date.now() }
  }
  check()
  flush()
  return { pages, pageCount: pages.length, blockCount, size, ...metadata }
}


export async function startPagedImport(controller, content, options, { version, previous, wait, editor, initialDoc }) {
  if (wait) await previous.done
  if (version !== controller._importVersion) throw abortError()
  if (!editor || controller._destroyed || controller.editor !== editor) throw new Error('编辑器已失效')
  if (editor.state.doc !== initialDoc) throw new Error('正文已发生变化，已取消本次导入')
  const job = { id: version, abort: new AbortController(), committing: false, rollback: null, editor, initialDoc }
  let finish
  job.done = new Promise(resolve => { finish = resolve })
  controller._importJob = job
  try { return await importPagedContent(controller, job, content, options) }
  finally { if (controller._importJob === job) controller._importJob = null; finish() }
}

export async function importPagedContent(controller, job, content, options = {}) {
  const { editor, initialDoc } = job
  const importStarted = Date.now()
  const cancel = () => { job.abort.abort(); if (!job.dispatchDepth) job.rollback?.() }
  options.signal?.addEventListener('abort', cancel, { once: true })
  if (options.signal?.aborted) cancel()
  const check = () => {
    if (job.abort.signal.aborted || controller._destroyed || controller.editor !== editor || controller._importJob !== job) {
      throw Object.assign(new Error('导入已取消'), { name: 'AbortError' })
    }
  }
  try {
    check()
    const yieldToMain = options.yieldToMain || yieldDocumentTask
    const network = controller.getNetwork() || editor.storage.larkDoc?.network || createNetworkPolicy()
    const reservedIds = new Set()
    const normalize = editor.storage.larkDoc?.deferNormalization !== false
    // Compile the lazy view before parsing a large source fills the heap. It
    // is still installed only after validation, immediately before committing.
    const pagedModule = normalize && (options.pagedView === true || typeof content === 'string' && content.length > 500000)
      ? await import('./pagedDocumentView') : null
    check()
    if (editor.state.doc !== initialDoc) throw new Error('正文已发生变化，已取消本次导入')
    let characters = 0, report = null, meaningfulContent = false, maxPrepareMs = 0
    const maxLength = Number(controller.getMaxLength()) || 0
    const source = await createPagedDocumentSource(content, {
      pageBlocks: options.pageBlocks, signal: job.abort.signal, yieldToMain, format: options.format,
      preparePage: value => {
        const preparedAt = Date.now()
        check()
        let json = value
        if (typeof value === 'string') {
          const prepared = controller.prepareHTML(value, options.format)
          const html = typeof prepared === 'string' ? prepared : prepared.html
          if (typeof prepared !== 'string' && prepared.converted) {
            const pageReport = prepared.report
            if (!report) report = { ...pageReport, dropped: (pageReport?.dropped || []).slice() }
            else Object.keys(pageReport || {}).forEach(key => {
              if (typeof pageReport[key] === 'number') report[key] = (report[key] || 0) + pageReport[key]
              else if (key === 'dropped') report.dropped.push(...pageReport.dropped)
            })
          }
          if (!html.trim()) return null
          const dom = editor.view.dom?.ownerDocument?.createElement('div') || document.createElement('div')
          dom.innerHTML = html
          json = ProseMirrorDOMParser.fromSchema(editor.schema).parse(dom).toJSON()
        }
        json = network.applyDocument(validateDocument(json, editor.schema))
        let next = editor.schema.nodeFromJSON(validateDocument(json, editor.schema))
        const fixed = fixTables(EditorState.create({ schema: editor.schema, doc: next }))
        if (fixed) next = fixed.doc
        if (normalize) next = normalizeImportedBlockAttributes(next, reservedIds)
        next.descendants(node => { if (node.attrs.blockId) reservedIds.add(node.attrs.blockId) })
        next.descendants(node => { if (node.isText ? node.text.trim() : !node.isTextblock && node.type.name !== 'hardBreak') meaningfulContent = true })
        if (maxLength > 0) {
          characters += editor.storage.characterCount?.characters({ node: next }) ?? Array.from(next.textContent).length
          if (characters > maxLength) throw new Error(`正文不能超过 ${maxLength} 字`)
        }
        maxPrepareMs = Math.max(maxPrepareMs, Date.now() - preparedAt)
        return next
      },
    })
    check()
    if (editor.state.doc !== initialDoc) throw new Error('正文已发生变化，已取消本次导入')
    if (!source.pageCount) throw new Error('文件未包含可导入的正文或内容块')
    if (options.requireContent && !meaningfulContent) throw new Error('文件未包含可导入的正文或内容块')
    const trailing = editor.extensionManager?.extensions.find(extension => extension.name === 'trailingNode')
    const tailType = trailing && (trailing.options.node || editor.schema.topNodeType.contentMatch.defaultType?.name || 'paragraph')
    const last = source.pages[source.pages.length - 1].lastChild
    if (trailing && ![].concat(trailing.options.notAfter || [], tailType).includes(last?.type.name)) {
      let tail = editor.schema.topNodeType.create(null, editor.schema.nodes[tailType].createAndFill())
      if (normalize) tail = normalizeImportedBlockAttributes(tail, reservedIds)
      source.pages.push(tail); source.pageCount++; source.blockCount += tail.childCount; source.size += tail.content.size
    }
    const stats = { pageCount: source.pageCount, blockCount: source.blockCount, maxPageBlocks: Math.max(...source.pages.map(page => page.childCount)), title: source.title,
      preflightMs: Date.now() - importStarted, maxPrepareMs, maxCommitMs: 0, commitMs: 0, finalizeMs: 0 }
    let at = 0
    const initialContent = editor.storage.larkDoc?.pagedView?.logicalDocument(initialDoc) || initialDoc
    if (source.size === initialContent.content.size && source.pages.every(page => page.content.content.every(node => {
      const previous = initialContent.maybeChild(at++)
      return previous && node.eq(previous)
    }))) {
      if (editor.storage.larkDoc) editor.storage.larkDoc.lastPagedImport = stats
      controller.setImportReport(report)
      return false
    }
    if (!normalize) {
      // Shared collaboration bindings must never publish intermediate pages.
      const next = source.pages.reduce((doc, page) => doc.copy(doc.content.append(page.content)))
      const changed = controller.applyPreparedContent({ next, report }, options)
      if (editor.storage.larkDoc) editor.storage.larkDoc.lastPagedImport = stats
      return changed
    }
    if (options.pagedView === true || source.blockCount > 4096) {
      const { preparePagedDocumentView } = pagedModule || await import('./pagedDocumentView')
      check()
      if (editor.state.doc !== initialDoc) throw new Error('正文已发生变化，已取消本次导入')
      preparePagedDocumentView(editor)
      let viewPages = 0
      const viewSource = []
      let wrappedAt = Date.now()
      for (const page of source.pages) {
        const segments = []
        for (let index = 0; index < page.childCount; index += 32) {
          segments.push(editor.schema.nodes.documentSegment.create({ pageId: createBlockId() }, page.content.content.slice(index, index + 32)))
        }
        viewPages += segments.length
        viewSource.push(page.copy(Fragment.fromArray(segments)))
        if (Date.now() - wrappedAt >= 4) {
          await yieldToMain(); check()
          if (editor.state.doc !== initialDoc) throw new Error('正文已发生变化，已取消本次导入')
          wrappedAt = Date.now()
        }
      }
      source.pages = viewSource
      source.size += viewPages * 2
      stats.viewPageCount = viewPages
    }
    let original
    const originalDispatch = editor.view.dispatch
    const editable = editor.isEditable
    const readonlyVersion = controller._readonlyVersion
    const folded = editor.storage.larkDoc?.folded && new Set(editor.storage.larkDoc.folded)
    const storage = editor.storage.larkDoc || (editor.storage.larkDoc = {})
    const previousStats = storage.lastPagedImport
    const metadata = phase => ({ id: job.id, phase })
    const tagged = (tr, phase) => setTransactionMetadata(tr.setMeta(PAGED_IMPORT_META, metadata(phase)).setMeta(DEFER_BLOCK_ID_META, true).setMeta(skipTrailingNodeMeta, true).setMeta('preventUpdate', true),
      { origin: options.origin || TRANSACTION_ORIGINS.IMPORT })
    const unlock = () => {
      if (editor.view.dispatch === dispatch) editor.view.dispatch = originalDispatch
      storage.pagedImport = false
      job.committing = false
      if (controller._readonlyVersion === readonlyVersion) editor.setEditable?.(editable, false)
    }
    const dispatch = tr => {
      if (tr.getMeta(PAGED_IMPORT_META)?.id !== job.id) return
      job.dispatchDepth = (job.dispatchDepth || 0) + 1
      try { return originalDispatch.call(editor.view, tr) }
      finally { if (!--job.dispatchDepth && job.abort.signal.aborted) job.rollback?.() }
    }
    job.rollback = () => {
      if (!job.rollbackReady) return
      job.rollbackReady = false
      storage.lastPagedImport = previousStats
      if (folded) { storage.folded.clear(); folded.forEach(id => storage.folded.add(id)) }
      unlock()
      if (!editor.isDestroyed) {
        editor.view.updateState(original)
        editor.emit?.('update', { editor, transaction: tagged(original.tr, 'rollback'), appendedTransactions: [] })
      }
      job.rollback = null
    }
    controller.onBeforeContentReplace?.()
    check()
    original = editor.state
    storage.pagedImport = true
    job.committing = true
    job.rollbackReady = true
    editor.setEditable?.(false, false)
    check()
    // UI teardown and read-only locking can dispatch metadata transactions.
    // Roll back to the state immediately before the first owned page commit.
    original = editor.state
    editor.view.dispatch = dispatch
    storage.folded?.clear()
    const time = Date.now(), commitStarted = Date.now()
    let size = 0
    for (let index = 0; index < source.pages.length; index++) {
      check()
      const page = source.pages[index]
      let tr = editor.state.tr
      if (!index) {
        tr = closeHistory(tr).replaceWith(0, editor.state.doc.content.size, page.content)
        // A mapped end selection would follow every appended page and keep
        // materializing its remote tail during an otherwise locked import.
        tr.setSelection(Selection.atStart(tr.doc))
      }
      else tr = tr.insert(editor.state.doc.content.size, page.content)
      const before = editor.state.doc
      const commitAt = Date.now()
      dispatch(tagged(tr.setTime(time), 'page'))
      check()
      size += page.content.size
      if (editor.state.doc === before || editor.state.doc.content.size !== size) throw new Error('当前编辑器拒绝分页替换正文')
      stats.maxCommitMs = Math.max(stats.maxCommitMs, Date.now() - commitAt)
      await yieldToMain()
    }
    check()
    const finalizeAt = Date.now()
    if (stats.viewPageCount && storage.prepareDecorations) {
      await storage.prepareDecorations(yieldToMain, check)
      check()
      await yieldToMain()
      check()
    }
    const final = tagged(closeHistory(editor.state.tr).setSelection(Selection.atStart(editor.state.doc)).scrollIntoView(), 'complete')
    storage.pagedImport = false
    const beforeFinal = editor.state
    const validated = { id: job.id, doc: final.doc }
    storage.validatedPagedImport = validated
    try { dispatch(final) }
    finally { if (storage.validatedPagedImport === validated) delete storage.validatedPagedImport }
    check()
    if (editor.state === beforeFinal) throw new Error('当前编辑器拒绝完成分页导入')
    // Keep the rollback/dispatch lock while separating the final PM layout
    // from editable-state and host UI teardown in another browser task.
    await yieldToMain()
    check()
    unlock()
    storage.lastPagedImport = stats
    controller.onAfterContentReplace?.()
    check()
    controller.setImportReport(report)
    editor.emit?.('update', { editor, transaction: final, appendedTransactions: [] })
    check()
    stats.finalizeMs = Date.now() - finalizeAt
    stats.commitMs = Date.now() - commitStarted
    job.rollbackReady = false
    job.rollback = null
    return true
  } catch (error) {
    job.rollback?.()
    throw error
  } finally {
    options.signal?.removeEventListener('abort', cancel)
  }
}


async function readImportText(file, current) {
  if (file.size <= 1048576 || typeof TextDecoder !== 'function' || typeof file.slice !== 'function' || typeof file.arrayBuffer !== 'function') return file.text()
  // Blob.text decodes the entire source in one renderer task. Keep UTF-8
  // state across bounded byte reads, including split code points and BOMs.
  const decoder = new TextDecoder(), parts = []
  let started = Date.now()
  for (let offset = 0; offset < file.size; offset += 262144) {
    if (!current()) throw abortError()
    const bytes = await file.slice(offset, offset + 262144).arrayBuffer()
    if (!current()) throw abortError()
    parts.push(decoder.decode(bytes, { stream: true }))
    if (Date.now() - started >= 4) { await yieldDocumentTask(); started = Date.now() }
  }
  if (!current()) throw abortError()
  parts.push(decoder.decode())
  return parts.join('')
}

export async function importWorkspaceFile(controller, file, importingEditor) {
  if (!importingEditor || controller.getEditor() !== importingEditor || controller._disposed) return
  const format = resolveImportFormatId(controller.state.editorConfig, file.name.split('.').pop())
  if (!format) {
    controller.state.notice = `不支持的文件格式，可导入：${controller.state.editorConfig.importExport.importFormats.join(' / ').toUpperCase()}`
    return
  }
  if ((format === 'docx' || format === 'md') && file.size > 10 * 1024 * 1024) { controller.state.notice = `${format.toUpperCase()} 导入文件不能超过 10 MB`; return }
  controller.state.importing = true
  try {
    const initialDoc = importingEditor.state.doc
    const session = controller.getSession(), documentId = controller.props.documentId, sessionDocumentId = session?.documentId
    const message = '导入并替换当前正文？原正文可通过撤销恢复。'
    if (!await (controller.host.confirmImport ? controller.host.confirmImport(message, { fileName: file.name }) : controller.confirm(message))) return
    const checkCurrent = () => {
      if (controller._disposed || controller.getEditor() !== importingEditor || importingEditor.isDestroyed) return false
      if (controller.getSession() !== session || session?._destroyed || controller.props.documentId !== documentId || session?.documentId !== sessionDocumentId) return false
      if (!isImportEnabled(controller.state.editorConfig) || resolveImportFormatId(controller.state.editorConfig, file.name.split('.').pop()) !== format) return false
      if (typeof session?.can === 'function' && (!session.can('canView') || !session.can('canEdit'))) return false
      if (importingEditor.state.doc !== initialDoc) throw new Error('正文已发生变化，已取消本次导入')
      return controller.state.mode !== 'read' && !controller.state.forcedReadonly
    }
    if (!checkCurrent()) return
    let content
    let importedTitle
    let compatibilityWarnings = []
    let sourceReport = null
    if (format === 'docx') {
      const mammoth = await loadFeature('office.mammoth', () => import(/* webpackChunkName: "office" */ 'mammoth/mammoth.browser'))
      const result = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() }, { styleMap: ['u => u'] })
      content = sanitizeHTML(result.value)
      compatibilityWarnings = (result.messages || []).filter(item => item.type === 'warning' || item.type === 'error').map(item => item.message)
    } else {
      const text = await readImportText(file, checkCurrent)
      if (format === 'json') {
        if (controller.host.setContentAsync) content = text
        else {
          const value = JSON.parse(text)
          content = validateDocument(migrateRecordContent(value.document || value, value.schemaVersion), controller.getEditor().schema)
          if (typeof value.title === 'string') importedTitle = value.title
        }
      } else if (format === 'html') content = text
      else if (format === 'md') {
        const { markdownToHtml } = await import(/* webpackChunkName: "import-export" */ '../utils/importExport')
        const prepared = normalizeVditorHtml(await markdownToHtml(text))
        content = sanitizeHTML(prepared.html)
        if (prepared.converted) sourceReport = { ...prepared.report, source: 'markdown' }
      } else throw new Error('只支持 HTML / JSON / Markdown / DOCX')
    }
    const activeEditor = controller.getEditor()
    // The host aliases `readonly` to `source.importing`, so `effectiveReadonly` is
    // intentionally true during this read. Only abort for an actual read mode or a
    // forced readonly prop; otherwise every import would self-cancel here.
    const actuallyReadonly = controller.state.mode === 'read' || controller.state.forcedReadonly
    if (controller._disposed || !activeEditor || activeEditor.isDestroyed || actuallyReadonly || !checkCurrent()) return
    if (typeof content === 'string' && !controller.host.setContentAsync) {
      const container = (controller.getWindow().document || document).createElement('div')
      container.innerHTML = content
      const parsed = ProseMirrorDOMParser.fromSchema(controller.getEditor().schema).parse(container)
      content = validateDocument(parsed.toJSON(), controller.getEditor().schema)
      let hasContent = false
      parsed.descendants(node => { if (node.isText ? node.text.trim() : !node.isTextblock && node.type.name !== 'hardBreak') hasContent = true })
      if (!hasContent) throw new Error('文件未包含可导入的正文或内容块')
    }
    controller.closeAI()
    await controller.setContentAsync(content, { format: format === 'html' || format === 'json' ? format : 'auto', requireContent: true })
    if (format === 'json' && controller.host.setContentAsync) importedTitle = controller.getEditor().storage.larkDoc?.lastPagedImport?.title
    if (importedTitle !== undefined) controller.state.title = importedTitle
    if (sourceReport) controller.onImportReport(sourceReport)
    const report = controller.getImportReport()
    if (compatibilityWarnings.length) controller.onImportReport({ ...report, source: format, warnings: compatibilityWarnings })
    const warningCount = compatibilityWarnings.length + (report?.dropped?.length || 0)
    controller.state.notice = warningCount ? `导入完成；${warningCount} 项内容有兼容提示，请检查内容` : '导入完成'
    logger.info('import', 'lark-doc.document.imported', { format, status: 'success' })
  } catch (error) {
    if (!controller._disposed) controller.state.notice = `导入失败，原正文未替换：${error.message}`
    logger.warn('import', 'lark-doc.document.rejected', { status: 'failed' })
  } finally { if (!controller._disposed) controller.state.importing = false }
}
