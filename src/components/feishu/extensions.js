/**
 * 扩展装配入口。
 *
 * createFeishuExtensions 是 schema 的唯一来源：这里决定文档 JSON 认识哪些
 * 节点、mark 和属性；config.features 开关在此映射为各 Tiptap 扩展的启停，
 * 关闭能力只隐藏入口，历史 JSON 仍可解析。
 */
import { Extension, Node, mergeAttributes, nodeInputRule } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Heading from '@tiptap/extension-heading'
import CodeBlock from '@tiptap/extension-code-block'
import Image, { inputRegex as imageInputRegex } from '@tiptap/extension-image'
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
import { VueNodeViewRenderer } from '@tiptap/vue-2'
import { Plugin, PluginKey, Selection, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { findTextMatches, foldedRange, getSlashMatch, isPageHeading, resolveHeadingHighlightSection, safeAttachmentId, safeColor, safeUrl, sanitizeHTML } from './documentOperations'
import { createNetworkPolicy } from '../../networkPolicy'

let katexPromise
function loadKatex() {
  if (!katexPromise) katexPromise = import('katex').then((module) => module.default || module)
  return katexPromise
}

const documentKey = new PluginKey('feishuDocument')
const levels = [1, 2, 3, 4, 5, 6, 7, 8, 9]
const validateAttribute = (name, predicate) => (value) => { if (!predicate(value)) throw new Error(`无效属性：${name}`) }
const FeishuCharacterCount = CharacterCount.extend({
  addProseMirrorPlugins() {
    // 官方 filter 持有本次 options；只更新该 limit，保留插件、光标与正文历史。
    this.storage.setLimit = (limit) => { this.options.limit = limit > 0 ? limit : 0 }
    return this.parent()
  },
})

const verticalBoundarySelection = (view, direction) => {
  const { state } = view
  const { selection } = state
  if (!selection.empty || !selection.$from.parent.isTextblock || !view.endOfTextblock(direction < 0 ? 'up' : 'down')) return null
  const current = view.coordsAtPos(selection.from)
  if (!current) return null
  // Resolve outside the current text block. `selection.to + 1` is still
  // inside a paragraph when the caret is at its first line, so ArrowDown
  // would otherwise rediscover the current block.
  const probe = direction < 0 ? selection.from - 1 : selection.$from.end() + 1
  const resolvedProbe = state.doc.resolve(Math.max(1, Math.min(state.doc.content.size, probe)))
  const target = Selection.findFrom(resolvedProbe, direction, true)
  if (!target || !target.$from.parent.isTextblock) return null
  const start = target.$from.start()
  const end = target.$from.end()
  const candidates = []
  for (let pos = start; pos <= end; pos += 1) {
    try {
      const coords = view.coordsAtPos(pos)
      if (!coords || !Number.isFinite(coords.top)) continue
      const lineIsBefore = coords.bottom <= current.top + 1
      const lineIsAfter = coords.top >= current.bottom - 1
      if ((direction < 0 && !lineIsBefore) || (direction > 0 && !lineIsAfter)) continue
      candidates.push({ pos, top: coords.top, x: (coords.left + coords.right) / 2 })
    } catch (error) {
      // Positions inside atom/leaf nodes may not have a browser caret box.
    }
  }
  if (!candidates.length) return null
  const targetLine = direction < 0 ? Math.max(...candidates.map((candidate) => candidate.top)) : Math.min(...candidates.map((candidate) => candidate.top))
  const lineCandidates = candidates.filter((candidate) => Math.abs(candidate.top - targetLine) <= 1.5)
  const targetX = (current.left + current.right) / 2
  const nearest = lineCandidates.reduce((best, candidate) => !best || Math.abs(candidate.x - targetX) < Math.abs(best.x - targetX) ? candidate : best, null)
  return nearest ? TextSelection.create(state.doc, nearest.pos) : null
}

const FeishuHeading = Heading.extend({
  addAttributes() { return { level: { default: 1, rendered: false, validate: validateAttribute('heading.level', (value) => levels.includes(value)) } } },
  parseHTML() {
    return levels.map((level) => ({ tag: level <= 6 ? `h${level}` : `div[data-type="heading"][data-level="${level}"]`, attrs: { level } }))
  },
  renderHTML({ node, HTMLAttributes }) {
    const level = levels.includes(node.attrs.level) ? node.attrs.level : 1
    return level <= 6 ? [`h${level}`, HTMLAttributes, 0] : ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'heading', 'data-level': level }), 0]
  },
}).configure({ levels })

const calloutEmojis = ['💡', '📌', '⚠️', '✅', '💬', '🎯', '🔥', '🌟', '😄', '❤️', '👍', '🎉']
const safeCalloutEmoji = (value) => calloutEmojis.includes(String(value)) ? String(value) : '💡'

const Callout = Node.create({
  name: 'callout', group: 'block', content: 'block+', defining: true,
  addAttributes() {
    return {
      backgroundColor: { default: null, parseHTML: (el) => safeColor(el.style.backgroundColor) ? el.style.backgroundColor : null, renderHTML: (attrs) => attrs.backgroundColor && safeColor(attrs.backgroundColor) ? { style: `background-color: ${attrs.backgroundColor}` } : {} },
      borderColor: { default: null, parseHTML: (el) => safeColor(el.style.borderColor) ? el.style.borderColor : null, renderHTML: (attrs) => attrs.borderColor && safeColor(attrs.borderColor) ? { style: `border-color: ${attrs.borderColor}` } : {} },
      color: { default: null, parseHTML: (el) => safeColor(el.style.color) ? el.style.color : null, renderHTML: (attrs) => attrs.color && safeColor(attrs.color) ? { style: `color: ${attrs.color}` } : {} },
      emoji: { default: '💡', validate: (value) => { if (!calloutEmojis.includes(String(value))) throw new Error('无效高亮块图标') }, parseHTML: (el) => safeCalloutEmoji(el.getAttribute('data-emoji')), renderHTML: (attrs) => ({ 'data-emoji': safeCalloutEmoji(attrs.emoji) }) },
    }
  },
  parseHTML() { return [{ tag: 'div[data-type="callout"]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'callout' }), 0] },
})

const Columns = Node.create({
  name: 'columns', group: 'block', content: 'column{2,5}', defining: true, isolating: true,
  parseHTML() { return [{ tag: 'div[data-type="columns"]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'columns' }), 0] },
})

const Column = Node.create({
  name: 'column', content: 'block+', isolating: true,
  addAttributes() {
    return { width: {
      default: 50,
      parseHTML: (el) => { const width = Number(el.getAttribute('data-width')); return width >= 10 && width <= 90 ? width : 50 },
      renderHTML: ({ width }) => ({ 'data-width': width, style: `flex-basis: ${Math.max(10, Math.min(90, Number(width) || 50))}%` }),
    } }
  },
  parseHTML() { return [{ tag: 'div[data-type="column"]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'column' }), 0] },
})

const Formatting = Extension.create({
  name: 'feishuFormatting',
  addGlobalAttributes() {
    return [
      { types: ['paragraph', 'heading'], attributes: {
        indent: { default: 0, parseHTML: (el) => Math.max(0, Math.min(8, Number(el.getAttribute('data-indent')) || 0)), renderHTML: ({ indent }) => indent ? { 'data-indent': indent, style: `padding-left: ${Math.max(0, Math.min(8, indent)) * 2}em` } : {} },
        lineHeight: { default: null, parseHTML: (el) => /^(normal|[1-4](\.\d{1,2})?)$/.test(el.style.lineHeight) ? el.style.lineHeight : null, renderHTML: ({ lineHeight }) => lineHeight && /^(normal|[1-4](\.\d{1,2})?)$/.test(String(lineHeight)) ? { style: `line-height: ${lineHeight}` } : {} },
      } },
      { types: ['tableCell', 'tableHeader'], attributes: {
        backgroundColor: { default: null, parseHTML: (el) => safeColor(el.style.backgroundColor) ? el.style.backgroundColor : null, renderHTML: ({ backgroundColor }) => backgroundColor && safeColor(backgroundColor) ? { style: `background-color: ${backgroundColor}` } : {} },
        textAlign: { default: null, parseHTML: (el) => ['left', 'center', 'right', 'justify'].includes(el.style.textAlign) ? el.style.textAlign : null, renderHTML: ({ textAlign }) => ['left', 'center', 'right', 'justify'].includes(textAlign) ? { style: `text-align: ${textAlign}` } : {} },
        verticalAlign: { default: null, parseHTML: (el) => ['top', 'middle', 'bottom'].includes(el.style.verticalAlign) ? el.style.verticalAlign : null, renderHTML: ({ verticalAlign }) => ['top', 'middle', 'bottom'].includes(verticalAlign) ? { style: `vertical-align: ${verticalAlign}` } : {} },
      } },
    ]
  },
  addKeyboardShortcuts() {
    const listCommand = (command) => {
      if (!this.editor.isEditable || this.editor.view.composing) return false
      const type = this.editor.isActive('taskItem') ? 'taskItem' : 'listItem'
      return this.editor.commands[command](type)
    }
    const indentCommand = (delta) => {
      if (!this.editor.isEditable || this.editor.view.composing) return false
      if (this.editor.isActive('taskItem') || this.editor.isActive('listItem')) return listCommand(delta > 0 ? 'sinkListItem' : 'liftListItem')

      const { selection } = this.editor.state
      const blockType = selection.$from.parent.type.name
      // Keep table navigation and code-block editing on their own extensions.
      if (!['paragraph', 'heading'].includes(blockType) || ['table', 'tableCell', 'tableHeader', 'codeBlock'].some((type) => this.editor.isActive(type))) return false

      const currentIndent = Number(this.editor.getAttributes(blockType).indent) || 0
      const nextIndent = Math.max(0, Math.min(8, currentIndent + delta))
      if (nextIndent === currentIndent) return true
      return this.editor.chain().focus().updateAttributes(blockType, { indent: nextIndent }).run()
    }
    return { Tab: () => indentCommand(1), 'Shift-Tab': () => indentCommand(-1) }
  },
})

/** 图片扩展：figure/img 双层契约，所有 src 与附件 id 入 schema 前先做安全校验。 */
function imageExtension(view, resolveImageFile) {
  return Image.extend({
    addAttributes() {
      return {
        ...this.parent(),
        alt: { default: null, parseHTML: (el) => (el.tagName === 'FIGURE' ? el.querySelector('img') : el)?.getAttribute('alt') || null },
        title: { default: null, parseHTML: (el) => (el.tagName === 'FIGURE' ? el.querySelector('img') : el)?.getAttribute('title') || null },
        src: { default: null, validate: validateAttribute('image.src', (value) => value === null || safeUrl(value, true)), parseHTML: (el) => { const src = el.tagName === 'FIGURE' ? el.querySelector('img')?.getAttribute('src') : el.getAttribute('src'); return safeUrl(src, true) ? src : null }, rendered: false },
        originalSrc: { default: null, validate: validateAttribute('image.originalSrc', (value) => value === null || safeUrl(value, true)), parseHTML: (el) => { const src = el.getAttribute('data-original-src'); return safeUrl(src, true) ? src : null }, rendered: false },
        attchId: { default: null, validate: validateAttribute('image.attchId', (value) => value === null || safeAttachmentId(value)), parseHTML: (el) => { const id = el.getAttribute('data-attch-id') || el.querySelector('img')?.getAttribute('data-attch-id'); return safeAttachmentId(id) ? id : null }, rendered: false },
        originalAttchId: { default: null, validate: validateAttribute('image.originalAttchId', (value) => value === null || safeAttachmentId(value)), parseHTML: (el) => { const id = el.getAttribute('data-original-attch-id'); return safeAttachmentId(id) ? id : null }, rendered: false },
        width: { default: null, validate: validateAttribute('image.width', (value) => value === null || Number.isFinite(value) && value >= 40 && value <= 2400), parseHTML: (el) => { const width = Number(el.getAttribute('data-width') || el.getAttribute('width')); return width >= 40 && width <= 2400 ? width : null }, rendered: false },
        align: { default: 'center', validate: validateAttribute('image.align', (value) => ['left', 'center', 'right'].includes(value)), parseHTML: (el) => ['left', 'center', 'right'].includes(el.getAttribute('data-align')) ? el.getAttribute('data-align') : 'center', rendered: false },
        caption: { default: '', parseHTML: (el) => el.getAttribute('data-caption') || el.querySelector('figcaption')?.textContent || '', rendered: false },
      }
    },
    parseHTML() { return [{ tag: 'figure[data-type="image"]', getAttrs: (el) => safeUrl(el.querySelector('img')?.getAttribute('src'), true) ? null : false }, { tag: 'img[src]', getAttrs: (el) => safeUrl(el.getAttribute('src'), true) ? null : false }] },
    addCommands() { return { setImage: (attrs) => ({ commands }) => safeUrl(attrs.src, true) && (!attrs.originalSrc || safeUrl(attrs.originalSrc, true)) && commands.insertContent({ type: this.name, attrs }) } },
    addInputRules() { return [nodeInputRule({ find: imageInputRegex, type: this.type, getAttributes: (match) => safeUrl(match[3], true) ? { src: match[3], alt: match[2], title: match[4] } : false })] },
    renderHTML({ node }) {
      const attrs = node.attrs
      const figure = { 'data-type': 'image', 'data-caption': attrs.caption || '', 'data-align': ['left', 'center', 'right'].includes(attrs.align) ? attrs.align : 'center' }
      if (safeUrl(attrs.originalSrc, true)) figure['data-original-src'] = attrs.originalSrc
      if (safeAttachmentId(attrs.attchId)) figure['data-attch-id'] = attrs.attchId
      if (safeAttachmentId(attrs.originalAttchId)) figure['data-original-attch-id'] = attrs.originalAttchId
      if (attrs.width) figure['data-width'] = attrs.width
      const image = { src: safeUrl(attrs.src, true) ? attrs.src : '', alt: attrs.alt || '', title: attrs.title || '' }
      if (safeAttachmentId(attrs.attchId)) image['data-attch-id'] = attrs.attchId
      if (attrs.width) image.width = Math.max(40, Math.min(2400, Number(attrs.width) || 640))
      return ['figure', figure, ['img', image], ['figcaption', {}, attrs.caption || '']]
    },
    ...(view ? { addNodeView() { return VueNodeViewRenderer(view) } } : {}),
  }).configure({ allowBase64: true, resolveImageFile })
}

/** 代码块扩展：语言标记进 data-language，并透传图表/高亮性能配置。 */
function codeExtension(view, config) {
  return CodeBlock.extend({
    addAttributes() {
      return { language: { default: 'plaintext', parseHTML: (el) => el.getAttribute('data-language') || Array.from(el.firstElementChild?.classList || []).find((name) => name.startsWith('language-'))?.slice(9) || 'plaintext', renderHTML: ({ language }) => ({ 'data-language': /^[\w+-]{0,32}$/.test(language) ? language : 'plaintext' }) } }
    },
    ...(view ? { addNodeView() { return VueNodeViewRenderer(view) } } : {}),
  }).configure({
    syntaxHighlight: config?.performance?.syntaxHighlight !== false,
    diagram: config?.features?.diagram !== false,
    diagramScriptUrl: (config?.performance && config.performance.diagramScriptUrl) || null,
  })
}

const EMOJI_GLYPHS = {
  smile: '😄', heart: '❤️', thumbsup: '👍', tada: '🎉', pin: '📌', warning: '⚠️',
  check: '✅', comment: '💬', target: '🎯', fire: '🔥', star: '🌟',
}

const FeishuEmoji = Node.create({
  name: 'emoji',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { name: { default: 'smile', parseHTML: (el) => el.getAttribute('data-name') || 'smile', renderHTML: ({ name }) => ({ 'data-name': String(name || 'smile').slice(0, 64) }) } }
  },
  parseHTML() { return [{ tag: 'span[data-type="emoji"]' }] },
  renderHTML({ node, HTMLAttributes }) {
    const name = String(node.attrs.name || 'smile').replace(/^:|:$/g, '').toLowerCase()
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'emoji', class: 'feishu-emoji' }), EMOJI_GLYPHS[name] || `:${name}:`]
  },
  addCommands() {
    return { setEmoji: (name) => ({ commands }) => commands.insertContent({ type: this.name, attrs: { name: String(name || 'smile').replace(/^:|:$/g, '').toLowerCase() } }) }
  },
})

/** 公式扩展：行内/块级共用一套实现，只差 group 与渲染容器。 */
function mathExtension(name, onError) {
  // 保留公式节点的 JSON/HTML 契约；KaTeX 只在公式节点实际挂载时加载。
  const isBlock = name === 'blockMath'
  return Node.create({
    name,
    group: isBlock ? 'block' : 'inline',
    inline: !isBlock,
    atom: true,
    selectable: true,
    addAttributes() {
      return { latex: { default: '', parseHTML: (el) => el.getAttribute('data-latex') || '', renderHTML: ({ latex }) => ({ 'data-latex': String(latex || '').slice(0, 4096) }) } }
    },
    parseHTML() { return [{ tag: `${isBlock ? 'div' : 'span'}[data-type="${isBlock ? 'block-math' : 'inline-math'}"]` }] },
    renderHTML({ node, HTMLAttributes }) {
      return [isBlock ? 'div' : 'span', mergeAttributes(HTMLAttributes, { 'data-type': isBlock ? 'block-math' : 'inline-math', class: 'tiptap-mathematics-render' }), String(node.attrs.latex || '')]
    },
    addNodeView() {
      return ({ node }) => {
        const dom = document.createElement(isBlock ? 'div' : 'span')
        let disposed = false
        let renderVersion = 0
        const render = (current) => {
          const version = ++renderVersion
          dom.className = 'tiptap-mathematics-render'
          dom.setAttribute('data-type', isBlock ? 'block-math' : 'inline-math')
          dom.setAttribute('data-latex', String(current.attrs.latex || '').slice(0, 4096))
          dom.textContent = current.attrs.latex
          loadKatex().then((katex) => {
            if (disposed || version !== renderVersion) return
            try { katex.render(current.attrs.latex, dom, { throwOnError: true, displayMode: isBlock, trust: false, strict: 'error' }) }
            catch (_) { dom.textContent = `公式错误：${current.attrs.latex}`; dom.classList.add('feishu-math-error'); if (onError) onError('公式无法解析，请检查 LaTeX 语法') }
          }).catch(() => { if (!disposed && version === renderVersion && onError) onError('公式渲染器加载失败') })
        }
        render(node)
        return { dom, update: (next) => { if (next.type !== node.type) return false; render(next); return true }, destroy: () => { disposed = true } }
      }
    },
  })
}

/** 文档级扩展：折叠、搜索、块把手、slash 监听与粘贴网络策略都挂在这个插件上。 */
function documentExtension(options) {
  const enabled = (name) => options.config?.features?.[name] !== false
  // 粘贴/拖入的 HTML 先做安全清洗，再按离线策略拦截远端图片地址。
  const network = createNetworkPolicy(options.config?.network)
  return Extension.create({
    name: 'feishuDocument',
    priority: 1000,
    addStorage() { return { folded: new Set(), query: '', activeIndex: 0, handleHover: null } },
    addCommands() {
      return {
        setFeishuSearch: (query, activeIndex = 0) => ({ tr, dispatch }) => { if (dispatch) tr.setMeta(documentKey, { search: String(query || ''), activeIndex }); return true },
        toggleFeishuFold: (pos) => ({ tr, dispatch }) => { if (!foldedRange(tr.doc, pos)) return false; if (dispatch) tr.setMeta(documentKey, { fold: pos }); return true },
        resetFeishuFolds: () => ({ tr, dispatch }) => { if (dispatch) tr.setMeta(documentKey, { resetFolds: true }); return true },
        revealFeishuMatch: (from, to) => ({ tr, dispatch }) => { if (dispatch) tr.setMeta(documentKey, { reveal: { from, to } }); return true },
        setFeishuHandleHover: (range) => ({ tr, dispatch }) => { if (dispatch) tr.setMeta(documentKey, { handleHover: range && Number.isInteger(range.from) && Number.isInteger(range.to) ? { from: range.from, to: range.to, section: range.section === true } : null }); return true },
      }
    },
    addProseMirrorPlugins() {
      const storage = this.storage
      const editor = this.editor
      let lastSlash = ''
      let dismissed = false
      const reportSlash = (view) => {
        const match = enabled('insert') && editor.isEditable && !view.composing && !dismissed ? getSlashMatch(view.state) : null
        const serialized = JSON.stringify(match)
        if (lastSlash !== serialized) { lastSlash = serialized; if (options.onSlash) options.onSlash(match) }
      }
      return [new Plugin({
        key: documentKey,
        state: {
          init: () => null,
          apply: (tr) => {
            if (tr.docChanged) { dismissed = false; storage.handleHover = null }
            storage.folded = new Set(Array.from(storage.folded).map((pos) => tr.mapping.map(pos)).filter((pos) => tr.doc.nodeAt(pos)?.type.name === 'heading'))
            const action = tr.getMeta(documentKey)
            if (action?.resetFolds) storage.folded.clear()
            if (action?.search !== undefined) { storage.query = action.search; storage.activeIndex = action.activeIndex }
            if (action?.handleHover !== undefined) storage.handleHover = action.handleHover
            if (action?.fold !== undefined) { if (storage.folded.has(action.fold)) storage.folded.delete(action.fold); else storage.folded.add(action.fold) }
            if (action?.reveal) storage.folded.forEach((pos) => { const range = foldedRange(tr.doc, pos); if (range && action.reveal.from < range.to && action.reveal.to > range.from) storage.folded.delete(pos) })
            return null
          },
        },
        props: {
          transformPastedHTML: (html) => network.filterHtml(sanitizeHTML(html)),
          handleKeyDown: (view, event) => {
            if (enabled('shortcuts') && event.key === 'Backspace' && !view.composing && !event.isComposing && !event.metaKey && !event.ctrlKey && !event.altKey && options.onBackspace?.(view)) {
              event.preventDefault()
              return true
            }
            // At a block boundary, keep the caret's horizontal goal when
            // crossing to the adjacent block. This makes ArrowUp and
            // ArrowDown symmetric instead of landing on the previous block's
            // end position.
            if (enabled('shortcuts') && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && !view.composing && !event.isComposing && !event.metaKey && !event.ctrlKey && !event.altKey) {
              const nextSelection = verticalBoundarySelection(view, event.key === 'ArrowUp' ? -1 : 1)
              if (nextSelection) {
                view.dispatch(view.state.tr.setSelection(nextSelection).scrollIntoView())
                event.preventDefault()
                return true
              }
            }
            if (event.key === 'Escape') { dismissed = true; reportSlash(view) }
            return false
          },
          handleDOMEvents: {
            compositionstart: () => { if (options.onSlash) options.onSlash(null); lastSlash = 'null'; return false },
            compositionend: (view) => { reportSlash(view); return false },
          },
          decorations: (state) => {
            const decorations = findTextMatches(state.doc, storage.query).map(({ from, to }, index) => Decoration.inline(from, to, { class: index === storage.activeIndex ? 'feishu-search-hit feishu-search-active' : 'feishu-search-hit' }))
            const hover = storage.handleHover
            if (hover && hover.from >= 0 && hover.to > hover.from && hover.to <= state.doc.content.size) {
              const section = hover.section ? resolveHeadingHighlightSection(state.doc, hover.from) : null
              const blocks = section?.blocks || [{ from: hover.from, to: hover.to, node: state.doc.nodeAt(hover.from) }]
              blocks.forEach((block) => {
                if (!block.node?.isBlock || block.to <= block.from || block.to > state.doc.content.size) return
                decorations.push(Decoration.node(block.from, block.to, { class: `feishu-block-handle-hovered${hover.section ? ' feishu-heading-section-hovered' : ''}` }))
              })
            }
            state.doc.descendants((node, pos) => {
              if (node.type.name !== 'heading' || !isPageHeading(state.doc, pos)) return
              const range = foldedRange(state.doc, pos)
              if (!range || range.from >= range.to) return
              const collapsed = storage.folded.has(pos)
              decorations.push(Decoration.widget(pos + 1, () => {
                const button = document.createElement('button')
                const label = collapsed ? '展开' : '收起'
                button.type = 'button'
                button.className = 'feishu-heading-fold-toggle'
                button.setAttribute('aria-label', label)
                button.setAttribute('aria-expanded', String(!collapsed))
                button.setAttribute('data-tooltip', label)
                button.setAttribute('data-glyph', collapsed ? '▸' : '▾')
                button.title = label
                button.contentEditable = 'false'
                button.addEventListener('mousedown', (event) => event.preventDefault())
                button.addEventListener('keydown', (event) => {
                  if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return
                  event.preventDefault()
                  event.stopPropagation()
                  button.click()
                })
                button.addEventListener('click', (event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  if (enabled('folding')) editor.commands.toggleFeishuFold(pos)
                  editor.view.focus()
                })
                return button
              }, { key: `feishu-heading-fold-${pos}-${collapsed ? 'closed' : 'open'}`, side: -1, ignoreSelection: true }))
            })
            storage.folded.forEach((pos) => {
              const range = foldedRange(state.doc, pos)
              if (!range) return
              const heading = state.doc.nodeAt(pos)
              decorations.push(Decoration.node(pos, pos + heading.nodeSize, { class: 'feishu-heading-folded' }))
              state.doc.nodesBetween(range.from, range.to, (node, at) => {
                if (node.isBlock && at >= range.from && at + node.nodeSize <= range.to) { decorations.push(Decoration.node(at, at + node.nodeSize, { class: 'feishu-fold-hidden', style: 'display: none' })); return false }
              })
            })
            return DecorationSet.create(state.doc, decorations)
          },
        },
        view: (view) => { reportSlash(view); return { update: reportSlash, destroy: () => { if (options.onSlash) options.onSlash(null) } } },
      })]
    },
  })
}

// 工厂不加载 Vue 单文件组件，可在无 DOM 的 Node 14 中检查 schema。
export function createFeishuExtensions(options = {}) {
  const enabled = (name) => options.config?.features?.[name] !== false
  return [
    StarterKit.configure({ heading: false, codeBlock: false, link: { openOnClick: false, autolink: true, isAllowedUri: (url) => safeUrl(url), HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } } }),
    FeishuHeading, codeExtension(options.codeView, options.config), imageExtension(options.imageView, options.resolveImageFile),
    Details.configure({ persist: true }), DetailsSummary, DetailsContent,
    Callout, Columns, Column, Formatting, Highlight.configure({ multicolor: true }),
    TaskList, TaskItem.configure({ nested: true }), TextAlign.configure({ types: ['paragraph', 'heading'] }),
    TextStyleKit, Subscript, Superscript, Typography, FeishuEmoji,
    FeishuCharacterCount.configure({ limit: options.maxLength > 0 ? options.maxLength : 0, autoTrim: false, textCounter: (text) => Array.from(text).length }),
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
