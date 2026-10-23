/**
 * 扩展装配入口。
 *
 * createLarkDocExtensions 是 schema 的唯一来源：这里决定文档 JSON 认识哪些
 * 节点、mark 和属性；config.features 开关在此映射为各 Tiptap 扩展的启停，
 * 关闭能力只隐藏入口，历史 JSON 仍可解析。
 */
import { Extension, Node, mergeAttributes, nodeInputRule } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Heading from '@tiptap/extension-heading'
import OrderedList from '@tiptap/extension-ordered-list'
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
import { Plugin, PluginKey, Selection, TextSelection } from '@tiptap/pm/state'
import { Mapping } from '@tiptap/pm/transform'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { BLOCK_ID_PATTERN, BLOCK_ID_TYPES, INDENT_STEP_PX, MAX_BLOCK_INDENT, TEXT_FOLD_TYPES, blockIdAt, clampBlockIndent, clampHeadingNumberStart, collectBlockIdFixes, collectIndentFixes, computeHeadingNumbers, computeOrderedListNumbers, computeBulletItems, canContinueListNumber, previousSiblingOrderedList, findTextMatches, foldedRange, getSlashMatch, foldableIdPositions, isFoldableBlock, mapHeadingFoldKeys, nodeAtSafe, resolveHeadingHighlightSection, safeAttachmentId, safeColor, safeUrl, sanitizeHTML, stepBlockIndent } from './documentOperations'
import { createNetworkPolicy } from '../../networkPolicy'
// NodeView 由适配层注册进注册表；这里只查表，静态依赖里不许再出现 UI 框架。
import { getNodeView } from '../../registry/nodeviews'

let katexPromise
/**
 * KaTeX 与它的样式一起按需加载：katex.css 有 118 KB（产物 CSS 的 2/3），
 * 文档里没有公式时完全不必下载。样式写在 async 块里，webpack 会把它拆成
 * 独立的 CSS 块（lib 单文件构建则合并回主 CSS），无需运行时按 URL 拼路径。
 */
function loadKatex() {
  if (!katexPromise) {
    katexPromise = Promise.all([
      import(/* webpackChunkName: "math" */ 'katex'),
      import(/* webpackChunkName: "math" */ '../../styles/vendor/katex.css'),
    ]).then(([module]) => module.default || module)
  }
  return katexPromise
}

const documentKey = new PluginKey('larkDoc')
// 补块 id 的事务带这个标记：它对用户不可见，宿主不应把它当成一次内容修改。
const BLOCK_ID_META = 'larkDocBlockIds'
// 缩进归一是纯属性修正，同样不能冒泡成一次内容修改。
const INDENT_META = 'larkDocIndentNormalized'
const levels = [1, 2, 3, 4, 5, 6, 7, 8, 9]
const validateAttribute = (name, predicate) => (value) => { if (!predicate(value)) throw new Error(`无效属性：${name}`) }
const LarkDocCharacterCount = CharacterCount.extend({
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

/**
 * 行首编号标记（`1. ` / `1、` / `1。` / `1）`）→ 编号块。
 *
 * 返回 true 表示这次输入已经被消费（不再插入空格、也不再走 Tiptap 默认 input rule）。
 * 只在「标记正好从块的第一行第一个字符开始」时生效，和飞书一致：
 * 句子中间的 `1. ` 仍然是普通文本。
 */
const LINE_START_MARKER = /^(\d{1,3})\s*[.．。、)）]$/

export function applyLineStartMarker(view, from) {
  const { state } = view
  const $from = state.doc.resolve(from)
  const parent = $from.parent
  // 只认段落和标题：代码块 / 表格单元格里的 `1. ` 是内容，不能变成列表。
  if (parent.type.name !== 'paragraph' && parent.type.name !== 'heading') return false
  if (!parent.textContent) return false
  const before = parent.textBetween(0, $from.parentOffset, null, '\ufffc')
  const match = LINE_START_MARKER.exec(before)
  if (!match) return false
  const startNumber = Number(match[1])
  if (!Number.isInteger(startNumber) || startNumber < 1 || startNumber > 999) return false
  // 已经在一个列表项里：交给默认规则处理，避免把条目再包一层。
  if ($from.depth >= 2 && $from.node($from.depth - 1).type.name === 'listItem') return false
  const markerStart = from - before.length
  const blockPos = $from.before($from.depth)
  const tr = state.tr.delete(markerStart, from)
  if (parent.type.name === 'heading') {
    // 标题不能包进列表：保留标题（文字不动），把标记换成真的标题编号。
    tr.setNodeMarkup(blockPos, parent.type, { ...parent.attrs, numbering: true, numberingStart: startNumber })
    tr.setSelection(TextSelection.create(tr.doc, Math.min(markerStart, tr.doc.content.size)))
    view.dispatch(tr.scrollIntoView())
    return true
  }
  const orderedList = state.schema.nodes.orderedList
  const listItem = state.schema.nodes.listItem
  if (!orderedList || !listItem) return false
  const range = tr.doc.resolve(markerStart).blockRange()
  if (!range) return false
  try {
    tr.wrap(range, [{ type: orderedList, attrs: { start: startNumber } }, { type: listItem }])
  } catch (error) {
    return false
  }
  // 列表多包了两层（ol > li），光标跟着往里挪两级。
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(markerStart + 2, tr.doc.content.size))))
  view.dispatch(tr.scrollIntoView())
  return true
}

const LarkDocHeading = Heading.extend({
  addAttributes() {
    return {
      level: { default: 1, rendered: false, validate: validateAttribute('heading.level', (value) => levels.includes(value)) },
      // 标题编号 = 飞书里「把标题设为有序列表」，默认关闭（飞书新建标题也不带编号）。
      numbering: {
        default: false,
        parseHTML: (el) => el.getAttribute('data-numbering') === 'true',
        renderHTML: ({ numbering }) => (numbering ? { 'data-numbering': 'true' } : {}),
      },
      // 「重新开始编号 / 设置编号的值」的起点；null = 继续（跟着前序同级标题排）。
      numberingStart: {
        default: null,
        parseHTML: (el) => clampHeadingNumberStart(el.getAttribute('data-numbering-start')),
        renderHTML: ({ numberingStart }) => {
          const start = clampHeadingNumberStart(numberingStart)
          return start ? { 'data-numbering-start': start } : {}
        },
      },
    }
  },
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

/**
 * 有序列表：多一个 `continueFrom` 标记。
 *
 * 两个相邻的 `<ol>` 各自从 1 起算，飞书的「继续编号」能把它接到前一个列表后面。
 * 这里不落死数字，只记「这个列表接着前面的列表排」，序号仍由
 * computeOrderedListNumbers 每帧现算 —— 前一个列表增删条目时后面自动跟着变。
 */
const LarkDocOrderedList = OrderedList.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      continueFrom: {
        default: false,
        parseHTML: (el) => el.getAttribute('data-continue-from') === 'true',
        renderHTML: ({ continueFrom }) => (continueFrom ? { 'data-continue-from': 'true' } : {}),
      },
    }
  },
})

/**
 * 列表项的起始编号（等价 HTML `<li value="N">`）。
 *
 * 飞书里列表序号是可点的块级 UI，「重新开始编号 / 设置编号的值」作用在单个 item 上。
 * 这里只在这个 item 上记一个起点，编号串本身仍由 computeOrderedListNumbers
 * 每帧现算 —— 删除、移动、插入后编号自动接上，不需要补丁事务。
 */
const LarkDocListItemNumber = Extension.create({
  name: 'larkDocListItemNumber',
  addGlobalAttributes() {
    return [{
      types: ['listItem'],
      attributes: {
        numberStart: {
          default: null,
          parseHTML: (element) => {
            const value = Number(element.getAttribute('value'))
            return Number.isFinite(value) && value > 0 ? clampHeadingNumberStart(value) : null
          },
          renderHTML: ({ numberStart }) => (Number(numberStart) > 0 ? { value: clampHeadingNumberStart(numberStart) } : {}),
        },
      },
    }]
  },
})

/**
 * 块稳定标识（blockId）的全局属性。
 *
 * 所有「用户能当作一个块操作」的节点都带 `data-block-id`，落进 JSON 的 attrs 里，
 * 随文档一起保存/导入/导出。折叠集合、评论锚点、协同定位都按它引用块。
 * 结构性容器（listItem / tableRow / tableCell / column …）不编号：父块已经有 id。
 */
const LarkDocBlockId = Extension.create({
  name: 'larkDocBlockId',
  addGlobalAttributes() {
    return [{
      types: Array.from(BLOCK_ID_TYPES),
      attributes: {
        blockId: {
          default: null,
          parseHTML: (element) => {
            const id = element.getAttribute('data-block-id')
            return id && BLOCK_ID_PATTERN.test(id) ? id : null
          },
          renderHTML: ({ blockId }) => (typeof blockId === 'string' && BLOCK_ID_PATTERN.test(blockId) ? { 'data-block-id': blockId } : {}),
        },
      },
    }]
  },
})

/** 把缺失/重复的 blockId 补进当前事务；只改属性不改尺寸，位置不会失效。 */
function applyBlockIdFixes(tr, fixes = collectBlockIdFixes(tr.doc)) {
  if (!fixes.length) return false
  fixes.forEach(({ pos, id }) => {
    const node = tr.doc.nodeAt(pos)
    if (node) tr.setNodeMarkup(pos, undefined, { ...node.attrs, blockId: id })
  })
  tr.setMeta('addToHistory', false)
  tr.setMeta(BLOCK_ID_META, true)
  return true
}

/** 把超出上限的缩进一次性压回上限（老 JSON / 手工粘贴的正文），不进撤销栈。 */
function applyIndentFixes(tr, fixes = collectIndentFixes(tr.doc)) {
  if (!fixes.length) return false
  // 从后往前改，避免前面的 setNodeMarkup 让后面的位置失效。
  fixes.slice().sort((a, b) => b.pos - a.pos).forEach(({ pos, indent }) => {
    const node = tr.doc.nodeAt(pos)
    if (node && Number(node.attrs?.indent) !== indent) tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent })
  })
  tr.setMeta('addToHistory', false)
  tr.setMeta(INDENT_META, true)
  return true
}

/**
 * 块级缩进的下一步层级。
 *
 * 增加：受「前一个兄弟块」限制（飞书的块缩进就是「成为上一个块的子块」），
 * 第一个块没有前兄弟 → 一级都缩不了；前块 2 级 → 最多到 3 级。
 * 减少：只受 0 下限限制，可以一路减回文档开头（真飞书实测）。
 */
function nextBlockIndent(doc, $from, currentIndent, delta) {
  const pos = $from.depth > 0 ? $from.before($from.depth) : 0
  return stepBlockIndent(doc, pos, currentIndent, delta)
}

const Formatting = Extension.create({
  name: 'larkDocFormatting',
  addGlobalAttributes() {
    return [
      { types: ['paragraph', 'heading'], attributes: {
        // 缩进缩的是整块（飞书是块的外框右移、宽度变窄），所以用 margin 而不是 padding：
        // padding 只把文字推右，块盒子仍是整列宽，悬停高亮与句柄位置会跟飞书对不上。
        indent: { default: 0, parseHTML: (el) => clampBlockIndent(el.getAttribute('data-indent')), renderHTML: ({ indent }) => (clampBlockIndent(indent) ? { 'data-indent': clampBlockIndent(indent), style: `margin-left: ${clampBlockIndent(indent) * INDENT_STEP_PX}px` } : {}) },
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
    // 列表缩进和块缩进共用同一个上限：飞书最深层就是 5 级，列表再按 Tab 也不会无限下沉。
    const listDepth = () => {
      const { $from } = this.editor.state.selection
      let depth = 0
      for (let level = $from.depth; level > 0; level -= 1) {
        if (['listItem', 'taskItem'].includes($from.node(level).type.name)) depth += 1
      }
      return depth
    }
    const listCommand = (command) => {
      if (!this.editor.isEditable || this.editor.view.composing) return false
      if (command === 'sinkListItem' && listDepth() >= MAX_BLOCK_INDENT) return true
      const type = this.editor.isActive('taskItem') ? 'taskItem' : 'listItem'
      return this.editor.commands[command](type)
    }
    const indentCommand = (delta) => {
      if (!this.editor.isEditable || this.editor.view.composing) return false
      if (this.editor.isActive('taskItem') || this.editor.isActive('listItem')) return listCommand(delta > 0 ? 'sinkListItem' : 'liftListItem')

      const { selection } = this.editor.state
      if (['table', 'tableCell', 'tableHeader'].some((type) => this.editor.isActive(type))) return false
      // 代码块里 Tab 是缩进代码（飞书同样是插入空格），块级缩进走菜单或 ⌘] / ⌘[。
      if (this.editor.isActive('codeBlock')) {
        if (delta < 0) return false
        return this.editor.commands.insertContent('  ')
      }

      const blockType = selection.$from.parent.type.name
      if (!['paragraph', 'heading'].includes(blockType)) return false

      const currentIndent = Number(this.editor.getAttributes(blockType).indent) || 0
      const nextIndent = nextBlockIndent(this.editor.state.doc, selection.$from, currentIndent, delta)
      if (nextIndent === currentIndent) return true
      return this.editor.chain().focus().updateAttributes(blockType, { indent: nextIndent }).run()
    }
    // 飞书的块级缩进快捷键；Tab 在代码块里留给「插入空格」。
    const blockIndentCommand = (delta) => {
      if (!this.editor.isEditable || this.editor.view.composing) return false
      const { selection } = this.editor.state
      const node = selection.$from.parent
      if (!Number.isInteger(node.attrs?.indent)) return false
      const currentIndent = Number(node.attrs.indent) || 0
      const nextIndent = nextBlockIndent(this.editor.state.doc, selection.$from, currentIndent, delta)
      if (nextIndent === currentIndent) return true
      return this.editor.chain().focus().updateAttributes(node.type.name, { indent: nextIndent }).run()
    }
    return { Tab: () => indentCommand(1), 'Shift-Tab': () => indentCommand(-1), 'Mod-]': () => blockIndentCommand(1), 'Mod-[': () => blockIndentCommand(-1) }
  },
})

/** 图片扩展：figure/img 双层契约，所有 src 与附件 id 入 schema 前先做安全校验。 */
function imageExtension(resolveImageFile) {
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
      // 图片用自绘 renderHTML，全局属性不会自动合入外框，这里显式带上稳定块 id。
      if (typeof attrs.blockId === 'string' && BLOCK_ID_PATTERN.test(attrs.blockId)) figure['data-block-id'] = attrs.blockId
      if (safeUrl(attrs.originalSrc, true)) figure['data-original-src'] = attrs.originalSrc
      if (safeAttachmentId(attrs.attchId)) figure['data-attch-id'] = attrs.attchId
      if (safeAttachmentId(attrs.originalAttchId)) figure['data-original-attch-id'] = attrs.originalAttchId
      if (attrs.width) figure['data-width'] = attrs.width
      const image = { src: safeUrl(attrs.src, true) ? attrs.src : '', alt: attrs.alt || '', title: attrs.title || '' }
      if (safeAttachmentId(attrs.attchId)) image['data-attch-id'] = attrs.attchId
      if (attrs.width) image.width = Math.max(40, Math.min(2400, Number(attrs.width) || 640))
      return ['figure', figure, ['img', image], ['figcaption', {}, attrs.caption || '']]
    },
    // 图片 NodeView 查注册表：没注册就走上面的 renderHTML 默认渲染。
    addNodeView() { const view = getNodeView('image'); if (view) return view },
  }).configure({ allowBase64: true, resolveImageFile })
}

/** 代码块扩展：语言标记进 data-language，并透传图表/高亮性能配置。 */
function codeExtension(config) {
  return CodeBlock.extend({
    addAttributes() {
      return {
        language: { default: 'plaintext', parseHTML: (el) => el.getAttribute('data-language') || Array.from(el.firstElementChild?.classList || []).find((name) => name.startsWith('language-'))?.slice(9) || 'plaintext', renderHTML: ({ language }) => ({ 'data-language': /^[\w+-]{0,32}$/.test(language) ? language : 'plaintext' }) },
        // 飞书的代码块可以整体缩进（缩进的是盒子，不是盒内文本），上限与文本块一致。
        indent: {
          default: 0,
          parseHTML: (el) => clampBlockIndent(el.getAttribute('data-indent')),
          renderHTML: ({ indent }) => (clampBlockIndent(indent) ? { 'data-indent': clampBlockIndent(indent) } : {}),
        },
      }
    },
    // 代码块 NodeView（语言下拉 / 高亮 / 图表）查注册表。
    addNodeView() { const view = getNodeView('codeBlock'); if (view) return view },
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

const LarkDocEmoji = Node.create({
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
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'emoji', class: 'lark-doc-emoji' }), EMOJI_GLYPHS[name] || `:${name}:`]
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
            catch (_) { dom.textContent = `公式错误：${current.attrs.latex}`; dom.classList.add('lark-doc-math-error'); if (onError) onError('公式无法解析，请检查 LaTeX 语法') }
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
    name: 'larkDoc',
    priority: 1000,
    addStorage() { return { folded: new Set(), query: '', activeIndex: 0, handleHover: null } },
    addCommands() {
      return {
        setLarkDocSearch: (query, activeIndex = 0) => ({ tr, dispatch }) => { if (dispatch) tr.setMeta(documentKey, { search: String(query || ''), activeIndex }); return true },
        // 折叠状态存的是标题的 blockId（不是文档位置）：编辑、重命名、移动、删除
        // 都不会让它串到别的标题上，同名标题天然各自独立。
        toggleLarkDocFold: (pos) => ({ tr, dispatch }) => {
          const id = blockIdAt(tr.doc, pos)
          if (!id || !foldedRange(tr.doc, pos)) return false
          if (dispatch) tr.setMeta(documentKey, { toggleFoldId: id })
          return true
        },
        toggleLarkDocFoldById: (id) => ({ tr, dispatch }) => {
          if (typeof id !== 'string' || !id) return false
          if (dispatch) tr.setMeta(documentKey, { toggleFoldId: id })
          return true
        },
        resetLarkDocFolds: () => ({ tr, dispatch }) => { if (dispatch) tr.setMeta(documentKey, { resetFolds: true }); return true },
        revealLarkDocMatch: (from, to) => ({ tr, dispatch }) => { if (dispatch) tr.setMeta(documentKey, { reveal: { from, to } }); return true },
        setLarkDocHandleHover: (range) => ({ tr, dispatch }) => { if (dispatch) tr.setMeta(documentKey, { handleHover: range && Number.isInteger(range.from) && Number.isInteger(range.to) ? { from: range.from, to: range.to, section: range.section === true } : null }); return true },
        // 按 blockId 恢复折叠位（刷新/内容替换后由宿主调用）。
        foldLarkDocByIds: (ids) => ({ tr, dispatch }) => {
          const list = Array.isArray(ids) ? ids.map(String).filter(Boolean) : []
          if (!list.length) return false
          if (dispatch) tr.setMeta(documentKey, { foldIds: list.slice(0, 1000) })
          return true
        },
        // 兼容 0.6.x 之前的持久化内容：旧键是「层级\u0001文本\u0001同名序号」，
        // 这里按旧算法换算成 blockId 后再折叠；写回时自然迁移成 id。
        foldLarkDocByKeys: (keys) => ({ tr, dispatch }) => {
          const list = Array.isArray(keys) ? keys.map(String).filter(Boolean) : []
          if (!list.length) return false
          if (dispatch) tr.setMeta(documentKey, { foldByKeys: list.slice(0, 1000) })
          return true
        },
        // 给缺号/重号的块补 blockId（初始化与 setContent 后由宿主显式调用一次）。
        ensureLarkDocBlockIds: () => ({ tr, dispatch }) => {
          if (!dispatch) return collectBlockIdFixes(tr.doc).length > 0
          return applyBlockIdFixes(tr)
        },
        normalizeLarkDocIndents: () => ({ tr, dispatch }) => {
          if (!dispatch) return collectIndentFixes(tr.doc).length > 0
          return applyIndentFixes(tr)
        },
        /**
         * 标题编号的唯一写入口。`patch` 只带需要改的字段：
         * - `{ numbering: true }` 开启编号（继续前序）
         * - `{ numberingStart: null }` 继续标题编号
         * - `{ numberingStart: 3 }` 重新开始 / 设置编号的值
         * 编号值本身不落库，由 computeHeadingNumbers 每帧算，删除/移动会自动更新。
         */
        setLarkDocHeadingNumber: (pos, patch) => ({ tr, dispatch }) => {
          const node = nodeAtSafe(tr.doc, pos)
          if (!node || node.type.name !== 'heading') return false
          const next = { ...node.attrs }
          if (typeof patch?.numbering === 'boolean') next.numbering = patch.numbering
          if (patch && 'numberingStart' in patch) next.numberingStart = patch.numberingStart === null ? null : clampHeadingNumberStart(patch.numberingStart)
          if (next.numbering === node.attrs.numbering && next.numberingStart === node.attrs.numberingStart) return false
          if (dispatch) tr.setNodeMarkup(pos, node.type, next)
          return true
        },
        /** 切换某个标题的编号开关（飞书用 ⋮⋮ →「有序列表」触发）。 */
        toggleLarkDocHeadingNumber: (pos) => ({ tr, dispatch }) => {
          const node = nodeAtSafe(tr.doc, pos)
          if (!node || node.type.name !== 'heading') return false
          const next = { ...node.attrs, numbering: !node.attrs.numbering }
          if (!next.numbering) next.numberingStart = null
          if (dispatch) tr.setNodeMarkup(pos, node.type, next)
          return true
        },
        /**
         * 列表序号菜单的唯一写入口（点列表序号弹出，与标题编号共用一套菜单）：
         * - `null` 继续前序编号（清掉这个 item 的起点）
         * - `1` 重新开始编号
         * - `7` 设置编号的值
         * 只改该 item 的 numberStart，兄弟项的编号由 computeOrderedListNumbers 现算。
         * 显式起点会覆盖「继续编号」的接号，所以同时把列表上的 continueFrom 摘掉。
         */
        setLarkDocListItemNumber: (pos, numberStart) => ({ tr, dispatch }) => {
          const node = nodeAtSafe(tr.doc, pos)
          if (!node || node.type.name !== 'listItem') return false
          const $pos = tr.doc.resolve(pos)
          const parent = $pos.parent
          if (!parent || parent.type.name !== 'orderedList') return false
          const next = numberStart === null ? null : clampHeadingNumberStart(numberStart)
          const unlink = next !== null && parent.attrs?.continueFrom === true
          if (!unlink && next === (node.attrs?.numberStart ?? null)) return false
          if (dispatch) {
            if (unlink) tr.setNodeMarkup($pos.before(), parent.type, { ...parent.attrs, continueFrom: false })
            tr.setNodeMarkup(pos, node.type, { ...node.attrs, numberStart: next })
          }
          return true
        },
        /**
         * 「继续编号」对列表的服务端语义（点菜单第一项）：
         * 1. 该 item 有显式起点 → 清掉，回到接着上一个 item 数；
         * 2. 它是列表首项且前面紧邻另一个有序列表 → 给列表打上 continueFrom，接上前一个列表的序号。
         *
         * 第 2 条是「两个相邻列表都显示 1.」时点「继续编号」没反应的正解：
         * 此时 item 没有起点、列表也没有接号标记，只清起点等于什么都没做。
         */
        continueLarkDocListNumber: (pos) => ({ tr, dispatch }) => {
          const node = nodeAtSafe(tr.doc, pos)
          if (!node || node.type.name !== 'listItem') return false
          const $pos = tr.doc.resolve(pos)
          const parent = $pos.parent
          if (!parent || parent.type.name !== 'orderedList') return false
          const cleared = Number.isInteger(node.attrs?.numberStart)
          const linkable = $pos.index() === 0 && parent.attrs?.continueFrom !== true && !!previousSiblingOrderedList(tr.doc, $pos.before())
          if (!cleared && !linkable) return false
          if (dispatch) {
            if (cleared) tr.setNodeMarkup(pos, node.type, { ...node.attrs, numberStart: null })
            if (linkable) tr.setNodeMarkup($pos.before(), parent.type, { ...parent.attrs, continueFrom: true })
          }
          return true
        },
      }
    },
    addKeyboardShortcuts() {
      return {
        // 飞书为标题加编号的快捷键：Mac Cmd+Shift+7 / Win Ctrl+Shift+7
        'Mod-Shift-7': () => {
          const { $from } = this.editor.state.selection
          for (let depth = $from.depth; depth > 0; depth -= 1) {
            if ($from.node(depth).type.name === 'heading') return this.editor.commands.toggleLarkDocHeadingNumber($from.before(depth))
          }
          return false
        },
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
            const action = tr.getMeta(documentKey)
            if (action?.resetFolds) storage.folded.clear()
            if (action?.search !== undefined) { storage.query = action.search; storage.activeIndex = action.activeIndex }
            if (action?.handleHover !== undefined) storage.handleHover = action.handleHover
            if (action?.toggleFoldId) { if (storage.folded.has(action.toggleFoldId)) storage.folded.delete(action.toggleFoldId); else storage.folded.add(action.toggleFoldId) }
            if (action?.foldIds) {
              const index = foldableIdPositions(tr.doc)
              action.foldIds.forEach((id) => { if (index.has(id)) storage.folded.add(id) })
            }
            if (action?.reveal) {
              const index = foldableIdPositions(tr.doc)
              Array.from(storage.folded).forEach((id) => {
                const pos = index.get(id)
                if (pos === undefined) return
                const range = foldedRange(tr.doc, pos)
                if (range && action.reveal.from < range.to && action.reveal.to > range.from) storage.folded.delete(id)
              })
            }
            if (action?.foldByKeys) {
              // 旧版「层级+文本+同名序号」键 → 当前文档里对应标题的 blockId。
              const wanted = new Set(action.foldByKeys)
              mapHeadingFoldKeys(tr.doc).forEach((legacyKey, pos) => {
                if (!wanted.has(legacyKey)) return
                const id = blockIdAt(tr.doc, pos)
                if (id) storage.folded.add(id)
              })
            }
            // 标题被删除后，它的 id 会变成幽灵：跟着文档变化剪一次（折叠集合通常只有
            // 个位数，成本可忽略）。
            if (tr.docChanged && storage.folded.size) {
              const index = foldableIdPositions(tr.doc)
              Array.from(storage.folded).forEach((id) => { if (!index.has(id)) storage.folded.delete(id) })
            }
            return null
          },
        },
        // 新块（回车分段、粘贴、拖入、AI 插入）和重复块（复制粘贴）在这里补 blockId：
        // 已有 id 的块一字不动，只有缺失/重号的块在事务末尾被重新编号。
        // 注意它必须挂在 plugin spec 顶层，放进 props 里 ProseMirror 不会调用。
        appendTransaction: (transactions, oldState, newState) => {
          if (!transactions.some((transaction) => transaction.docChanged)) return null
          // 注意 appendMapping 返回 undefined，不能写成 reduce 的累加器。
          const mapping = new Mapping()
          transactions.forEach((transaction) => mapping.appendMapping(transaction.mapping))
          const fixes = collectBlockIdFixes(newState.doc, { doc: oldState.doc, mapping })
          if (!fixes.length) return null
          const tr = newState.tr
          return applyBlockIdFixes(tr, fixes) ? tr : null
        },
        props: {
          transformPastedHTML: (html) => network.filterHtml(sanitizeHTML(html)),
          /**
           * 行首 `1.` + 空格 → 编号块（飞书的 markdown 快捷输入）。
           *
           * Tiptap 自带的 input rule 只认半角 `1.`、且只能包段落；这里补齐三种情况：
           * 1. 中文输入法打出的全角标记（`1。` / `1、` / `1）`）——它们到不了 Tiptap 的正则；
           * 2. 标题行 —— 标题不能包进列表，改成「标题 + 编号」（蓝色 1.），文字原样保留；
           * 3. 段落 —— 删掉标记后包成有序列表，序号从用户输入的数字起算（3. 开头就是 3.）。
           */
          handleTextInput: (view, from, to, text) => {
            if (!enabled('shortcuts') || text !== ' ' || view.composing) return false
            return applyLineStartMarker(view, from)
          },
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
          // 新块（回车分段、粘贴、拖入、AI 插入）和重复块（复制粘贴）在这里补 blockId：
          // 已有 id 的块一字不动，只有缺失/重号的块在事务末尾被重新编号。
          decorations: (state) => {
            // 折叠集合存 blockId，装饰需要位置：一次扫描建索引，两处循环共用。
            const foldIndex = foldableIdPositions(state.doc)
            const decorations = findTextMatches(state.doc, storage.query).map(({ from, to }, index) => Decoration.inline(from, to, { class: index === storage.activeIndex ? 'lark-doc-search-hit lark-doc-search-active' : 'lark-doc-search-hit' }))
            const hover = storage.handleHover
            if (hover && hover.from >= 0 && hover.to > hover.from && hover.to <= state.doc.content.size) {
              const section = hover.section ? resolveHeadingHighlightSection(state.doc, hover.from) : null
              const blocks = section?.blocks || [{ from: hover.from, to: hover.to, node: state.doc.nodeAt(hover.from) }]
              blocks.forEach((block) => {
                if (!block.node?.isBlock || block.to <= block.from || block.to > state.doc.content.size) return
                decorations.push(Decoration.node(block.from, block.to, { class: `lark-doc-block-handle-hovered${hover.section ? ' lark-doc-heading-section-hovered' : ''}` }))
              })
            }
            state.doc.descendants((node, pos) => {
              // 折叠箭头挂在「有缩进子树的文本块」上：段落和标题都能折（飞书的
              // can-fold / fold-handler 也是按块给的，不限于标题）。
              if (!TEXT_FOLD_TYPES.has(node.type.name) || !isFoldableBlock(state.doc, pos)) return
              const range = foldedRange(state.doc, pos)
              if (!range || range.from >= range.to) return
              const foldId = node.attrs.blockId
              const collapsed = typeof foldId === 'string' && storage.folded.has(foldId)
              // 列表项的箭头要放进首个子段落里（item 内部第一个行内位置），
              // 文字块则在块内容起点 pos+1。
              const isItem = node.type.name === 'listItem' || node.type.name === 'taskItem'
              if (isItem && (!node.childCount || node.child(0).type.name !== 'paragraph')) return
              const widgetPos = isItem ? pos + 2 : pos + 1
              decorations.push(Decoration.widget(widgetPos, () => {
                const button = document.createElement('button')
                const label = collapsed ? '展开' : '收起'
                button.type = 'button'
                button.className = 'lark-doc-heading-fold-toggle'
                button.setAttribute('aria-label', label)
                button.setAttribute('aria-expanded', String(!collapsed))
                button.setAttribute('data-tooltip', label)
                button.setAttribute('data-glyph', collapsed ? '▸' : '▾')
                // 不要再设 title：浏览器原生 tooltip 会和 data-tooltip 的黑色气泡
                // 同时出现，变成「收起」重影（截图里上下两个）。读屏靠 aria-label。
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
                  const wasFolded = typeof foldId === 'string' && editor.storage.larkDoc.folded.has(foldId)
                  const range = foldedRange(editor.state.doc, pos)
                  // 光标落在即将隐藏的章节正文里：折叠后把焦点移回调用的标题，
                  // 避免选区留在 display:none 的后代中（13.6.1 焦点迁移规则）。
                  const caretInBody = !wasFolded && range && editor.state.selection.from >= range.from && editor.state.selection.from <= range.to
                  if (enabled('folding')) editor.commands.toggleLarkDocFold(pos)
                  if (caretInBody) editor.commands.setTextSelection(pos + 1)
                  editor.view.focus()
                  // 视口锚定：当前滚动位置落入被折叠内容时，把标题带回可视区。
                  if (!wasFolded) {
                    const dom = editor.view.nodeDOM(pos)
                    if (dom instanceof Element) dom.scrollIntoView({ block: 'nearest' })
                  }
                })
                return button
              }, { key: `lark-doc-heading-fold-${pos}-${collapsed ? 'closed' : 'open'}`, side: -1, ignoreSelection: true }))
            })
            // 标题编号：和折叠箭头落在同一个行内位置（pos+1）。push 顺序决定 DOM 顺序，
            // 箭头先 push、编号后 push，渲染出来才是飞书的「▾ 2. 标题」。
            // 编号是块级 UI，contenteditable=false，不进正文文本。
            computeHeadingNumbers(state.doc).forEach((info, pos) => {
              if (!state.doc.nodeAt(pos)) return
              decorations.push(Decoration.widget(pos + 1, () => {
                const button = document.createElement('button')
                button.type = 'button'
                button.className = 'lark-doc-heading-number'
                button.contentEditable = 'false'
                button.textContent = info.label
                button.setAttribute('data-number', info.label)
                button.setAttribute('data-level', String(info.level))
                button.setAttribute('aria-label', `标题编号 ${info.label}，点击设置编号`)
                button.setAttribute('data-tooltip', '设置编号')
                button.addEventListener('mousedown', (event) => event.preventDefault())
                button.addEventListener('click', (event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  if (!enabled('headings') || !editor.isEditable) return
                  const rect = button.getBoundingClientRect()
                  if (options.onHeadingNumberMenu) {
                    options.onHeadingNumberMenu({
                      pos,
                      label: info.label,
                      level: info.level,
                      // 「继续」在已经处于继续态时禁用 —— 与飞书菜单一致。
                      // 必须读**当前**编辑器状态：同标签的编号会复用同一个 widget DOM，
                      // 闭包里捕获的 state 是建 DOM 那一帧的旧状态（设过起点后仍判成连续态，
                      // 于是「继续编号」被误禁用、点了没反应）。
                      canContinue: Number.isInteger(nodeAtSafe(editor.state.doc, pos)?.attrs?.numberingStart),
                      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
                    })
                  }
                })
                return button
              }, { key: `lark-doc-heading-number-${pos}-${info.label}`, side: -1, ignoreSelection: true }))
            })
            // 列表序号 / 圆点：飞书把标记画在正文流里（序号是蓝色、contentEditable=false），
            // 不是浏览器的 ::marker —— 所以这里也走装饰层：箭头 → 标记 → 正文。
            // 标记进流之后，句柄和折叠箭头都以它为锚点往左让位，三者不会再互相压住。
            //
            // 有序序号在飞书里是**可点**的块级 UI（点它弹出编号菜单，和标题编号共用一套），
            // 所以这里渲染成 button；无序圆点保持纯展示的 span。
            const markerRect = (el) => {
              const rect = el.getBoundingClientRect()
              return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }
            }
            const pushListMarker = (pos, label, depth, className, value) => {
              const item = state.doc.nodeAt(pos)
              if (!item || item.firstChild?.type.name !== 'paragraph') return
              const interactive = className === 'lark-doc-list-number'
              decorations.push(Decoration.widget(pos + 2, () => {
                const marker = document.createElement(interactive ? 'button' : 'span')
                marker.className = className
                marker.contentEditable = 'false'
                marker.textContent = label
                marker.setAttribute('data-number', label)
                marker.setAttribute('data-depth', String(depth))
                if (!interactive) {
                  // 圆点是纯展示层：读屏按 <ul>/<li> 语义读，不重复念一遍。
                  marker.setAttribute('aria-hidden', 'true')
                  return marker
                }
                marker.type = 'button'
                marker.setAttribute('aria-label', `列表编号 ${label}，点击设置编号`)
                marker.addEventListener('mousedown', (event) => event.preventDefault())
                marker.addEventListener('click', (event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  if (!editor.isEditable || !options.onListNumberMenu) return
                  const current = nodeAtSafe(editor.state.doc, pos)
                  if (!current || current.type.name !== 'listItem') return
                  options.onListNumberMenu({
                    pos,
                    label,
                    depth,
                    // 编号实际值（a./i. 这类格式拿不回数字，菜单预填要用它）。
                    value,
                    // 「继续编号」只在这个 item 有显式起点时可点，与标题编号同款判断。
                    canContinue: canContinueListNumber(editor.state.doc, pos),
                    rect: markerRect(marker),
                  })
                })
                return marker
              }, { key: `${className}-${pos}-${label}`, side: -1, ignoreSelection: true }))
            }
            computeOrderedListNumbers(state.doc).forEach((info, pos) => pushListMarker(pos, info.label, info.depth, 'lark-doc-list-number', info.index))
            computeBulletItems(state.doc).forEach((info, pos) => pushListMarker(pos, '•', info.depth, 'lark-doc-list-bullet'))
            storage.folded.forEach((foldId) => {
              const pos = foldIndex.get(foldId)
              if (pos === undefined) return
              const range = foldedRange(state.doc, pos)
              if (!range) return
              const heading = state.doc.nodeAt(pos)
              decorations.push(Decoration.node(pos, pos + heading.nodeSize, { class: 'lark-doc-heading-folded' }))
              state.doc.nodesBetween(range.from, range.to, (node, at) => {
                // display:none 已退出布局与 Tab 顺序；aria-hidden 让屏幕阅读器
                // 同样认为被折叠的后代不可读（需求 13.6.1）。
                if (node.isBlock && at >= range.from && at + node.nodeSize <= range.to) {
                  decorations.push(Decoration.node(at, at + node.nodeSize, { class: 'lark-doc-fold-hidden', style: 'display: none', 'aria-hidden': 'true' }))
                  return false
                }
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
export function createLarkDocExtensions(options = {}) {
  const enabled = (name) => options.config?.features?.[name] !== false
  return [
    StarterKit.configure({ heading: false, codeBlock: false, orderedList: false, link: { openOnClick: false, autolink: true, isAllowedUri: (url) => safeUrl(url), HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } } }),
    LarkDocHeading, LarkDocOrderedList, codeExtension(options.config), imageExtension(options.resolveImageFile),
    Details.configure({ persist: true }), DetailsSummary, DetailsContent,
    Callout, Columns, Column, Formatting, LarkDocBlockId, LarkDocListItemNumber, Highlight.configure({ multicolor: true }),
    TaskList, TaskItem.configure({ nested: true }), TextAlign.configure({ types: ['paragraph', 'heading'] }),
    TextStyleKit, Subscript, Superscript, Typography, LarkDocEmoji,
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
