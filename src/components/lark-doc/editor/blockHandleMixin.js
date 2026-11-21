/**
 * blockHandleMixin — 区块句柄定位、区块范围计算与悬停高亮背景，以及区块拖拽移动。
 * 通过 this.editor、this.$refs.root、this.error 与主组件协作；与 blockMenuMixin 紧密配合
 * （菜单开合会调用本组的 setHandleHighlight/closeBlockMenu 相关方法，this 上均可直接访问）。
 * 采用 mixin 而非子组件：句柄与高亮 overlay 的 DOM 操作依赖主组件模板与 Vue 2 选项合并语义。
 */
import { closeHistory } from '@tiptap/pm/history'
import { headingActionRange, moveBlockRange, nodeAtSafe, resolveBlockTargetRange, resolveHeadingHighlightSection } from '../documentOperations'
import { moveDepthAllowed } from '../../../core/blocks/container-depth'

// 整框高亮的块：容器与原子对象对完整外框高亮，不给内部每行重复叠加背景。
// tableWrapper 是 ProseMirror 表格节点的实际 DOM（nodeDOM 返回包装层），必须一起识别。
const FRAME_BLOCK_SELECTOR = '.lark-doc-code, [data-type="codeBlock"], [data-type="callout"], blockquote, [data-type="columns"], [data-type="column"], table, .tableWrapper, figure[data-type="image"], figure[data-type="file"], hr'

export default {
  data() { return {
    blockHandlePosition: { top: 200, left: 0 }, handleRange: null, handleHideTimer: null,
    dragging: null, handlePressed: false, handleHovering: false, dropPosition: null, dropLineTop: 0,
  } },
  computed: {
    blockHandleStyle() { return { top: `${this.blockHandlePosition.top}px`, left: `${this.blockHandlePosition.left}px` } },
    handleIsEmptyParagraph() {
      if (!this.editor || !this.handleRange) return false
      const node = nodeAtSafe(this.editor?.state?.doc, this.handleRange.from)
      return this.handleBlockNode() === node && node?.type.name === 'paragraph' && node.content.size === 0
    },
    // 表格是整块目标（resolveBlockTargetRange 已把范围收敛成整表），句柄菜单走表格分支
    handleIsTable() {
      if (!this.editor || !this.handleRange) return false
      return nodeAtSafe(this.editor?.state?.doc, this.handleRange.from)?.type?.name === 'table'
    },
    handleGlyph() {
      if (!this.editor || !this.handleRange) return '＋'
      const doc = this.editor.state.doc
      const directNode = nodeAtSafe(doc, this.handleRange.from)
      const node = this.handleBlockNode() || directNode
      const glyphs = { paragraph: 'T', heading: 'H', bulletList: '•', orderedList: '1≡', taskList: '☑', listItem: '•', blockquote: '❝', codeBlock: '{}', horizontalRule: '≡', callout: '▤', details: '▾', columns: 'Ⅱ', table: '▦', image: '▧' }
      if (['listItem', 'taskItem'].includes(node?.type.name)) {
        const $pos = doc.resolve(Math.min(doc.content.size, this.handleRange.from + 1))
        for (let depth = $pos.depth; depth > 0; depth -= 1) {
          const name = $pos.node(depth).type.name
          if (name === 'taskList' || name === 'orderedList' || name === 'bulletList') return glyphs[name]
        }
      }
      if (node?.type?.name === 'heading') return `H${node.attrs?.level || 1}`
      return glyphs[node?.type?.name] || 'T'
    },
    handleIcon() {
      return this.handleIconFor(this.handleRange)
    },
  },
  methods: {
    handleIconFor(range) {
      if (!this.editor || !range) return 'plus'
      const doc = this.editor.state.doc
      const directNode = nodeAtSafe(doc, range.from)
      const node = this.handleNodeFor(range) || directNode
      let type = node?.type?.name || 'paragraph'
      if (['listItem', 'taskItem'].includes(type)) {
        const $pos = doc.resolve(Math.min(doc.content.size, range.from + 1))
        for (let depth = $pos.depth; depth > 0; depth -= 1) {
          const name = $pos.node(depth).type.name
          if (['taskList', 'orderedList', 'bulletList'].includes(name)) { type = name; break }
        }
      }
      if (type === 'heading') return `block-h${node.attrs?.level || 1}`
      return {
        paragraph: 'block-text', bulletList: 'block-bullet', orderedList: 'block-ordered', taskList: 'block-task',
        blockquote: 'block-quote', codeBlock: 'block-code', horizontalRule: 'horizontal-rule', callout: 'block-callout',
        details: 'block-details', columns: 'block-columns', column: 'block-columns', table: 'block-table', image: 'block-image',
      }[type] || 'block-text'
    },
    currentBlockRange() {
      if (!this.editor) return null
      const { selection } = this.editor.state
      if (selection.node) return { from: selection.from, to: selection.to }
      return this.rangeAt(selection.from, selection.to)
    },
    handleActionRange() {
      const selected = this.currentBlockRange()
      if (!selected) return this.handleRange
      const { selection, doc } = this.editor.state
      if (this.handleIsTable || this._tableHandleContext?.doc === doc) return this.handleRange || selected
      if (!selection.empty) {
        const start = doc.resolve(selected.from)
        const end = doc.resolve(selected.to)
        if (start.sameParent(end) && end.index() - start.index() > 1) return selected
      }
      return this.handleRange || selected
    },
    headingActionRange(range) {
      if (!range || !this.editor) return null
      const node = nodeAtSafe(this.editor?.state?.doc, range.from)
      return node?.type.name === 'heading' ? headingActionRange(this.editor.state.doc, range.from) : null
    },
    rangeAt(from, to = from) {
      // 上下层包含规则统一收敛在 documentOperations.resolveBlockTargetRange：
      // 表格整表、列表当前 item、容器整块、其余为顶层块，父子不会同时命中。
      const doc = this.editor.state.doc, range = resolveBlockTargetRange(doc, from, to)
      if (range?.container !== 'table') return range
      const $pos = doc.resolve(Math.max(0, Math.min(from, doc.content.size)))
      for (let depth = $pos.depth; depth > 0; depth--) {
        const cell = $pos.node(depth)
        if (!['tableCell', 'tableHeader'].includes(cell.type.name)) continue
        const start = $pos.start(depth)
        const local = resolveBlockTargetRange(cell, from - start, Math.max(0, Math.min(to - start, cell.content.size)))
        return local && { ...local, from: start + local.from, to: start + local.to, parentDepth: depth + local.parentDepth }
      }
      return range
    },
    blockHandleAnchorHidden(dom, checkVisibility = true) {
      const editorDom = this.editor?.view?.dom
      if (!(dom instanceof Element) || !editorDom?.contains(dom)) return true
      let renderBlock = dom, hidden = false
      while (renderBlock && renderBlock !== editorDom) {
        if (renderBlock.hidden || renderBlock.style?.display === 'none') hidden = true
        if (renderBlock.parentElement === editorDom) break
        renderBlock = renderBlock.parentElement
      }
      const unassigned = editorDom.shadowRoot && renderBlock?.parentElement === editorDom && !renderBlock.assignedSlot
      return !!(hidden || unassigned || checkVisibility && dom.checkVisibility?.({ contentVisibilityAuto: true }) === false)
    },
    hideBlockHandle() {
      this._blockHandleAnchor = null
      this.handleRange = null
      this.closeBlockMenu()
      this.clearHandleHighlight()
    },
    syncBlockHandleVisibility() {
      if (!this.handleRange) { this._blockHandleAnchor = null; return }
      const context = this._tableHandleContext
      if (context && context.doc !== this.editor.state.doc) {
        const current = this.rangeAt(this.editor.state.selection.from)
        this.positionBlockHandle(this.handleRange.from === context.table.from ? this.tableRangeFor(current) || current : current)
        return
      }
      // Window retirement only needs ancestry/assignment checks, not style resolution.
      if (this._blockHandleAnchor && this.blockHandleAnchorHidden(this._blockHandleAnchor, false)) this.hideBlockHandle()
    },
    positionBlockHandle(range, preserveHideTimer = false) {
      if (!range) return
      const dom = this.editor.view.nodeDOM(range.from)
      if (!(dom instanceof Element)) return
      if (this.blockHandleAnchorHidden(dom)) { this.hideBlockHandle(); return }
      this._blockHandleAnchor = dom
      if (this.blockMenuOpen && this.handleRange && (this.handleRange.from !== range.from || this.handleRange.to !== range.to)) this.closeBlockMenu()
      // 冷挂载只重排几何，保留此前离开正文安排的隐藏期限。
      if (!preserveHideTimer) clearTimeout(this.handleHideTimer)
      this.clearBlockMenuCloseTimer()
      const doc = this.editor.state.doc, table = this.tableRangeFor(range)
      let cell = table && range.from !== table.from ? range : null
      if (table && !cell) {
        const previous = this._tableHandleContext
        if (previous?.doc === doc && previous.table.from === table.from) cell = previous.cell
        else {
          const candidate = this.rangeAt(this.editor.state.selection.from)
          if (candidate && candidate.from > table.from && candidate.to < table.to) cell = candidate
        }
      }
      const other = cell && (range.from === table.from ? cell : table)
      this._tableHandleContext = other ? { doc, table, cell, other, position: this.blockHandleGeometry(other) } : null
      const previous = this.handleRange
      if (!previous || Object.keys(previous).length !== Object.keys(range).length
        || Object.keys(range).some(key => previous[key] !== range[key])) this.handleRange = range
      if (this.handleHovering || this.handlePressed || this.dragging || this.blockMenuOpen) this.setHandleHighlight(true)
      const position = this.blockHandleGeometry(range)
      if (!position) return
      if (this.blockHandlePosition?.top !== position.top || this.blockHandlePosition?.left !== position.left) this.blockHandlePosition = position
      else this.refreshBlockHandle()
    },
    tableRangeFor(range) {
      if (!range || !this.editor) return null
      const doc = this.editor.state.doc
      if (nodeAtSafe(doc, range.from)?.type.name === 'table') return range
      const $pos = doc.resolve(Math.min(doc.content.size, range.from + 1))
      for (let depth = $pos.depth; depth > 0; depth--) {
        if ($pos.node(depth).type.name === 'table') return { from: $pos.before(depth), to: $pos.after(depth), parentDepth: depth - 1, container: 'table' }
      }
      return null
    },
    activateSecondaryHandle(target, event) {
      if (!this.writable() || !this.featureEnabled('blockHandle') || target?.doc !== this.editor.state.doc) return false
      this.positionBlockHandle(target.range)
      this.handleHovering = true
      this.openBlockMenu(event)
      return true
    },
    blockHandleGeometry(range) {
      const dom = this.editor.view.nodeDOM(range.from), paper = this.$refs.root?.querySelector('.lark-doc-paper')
      if (!(dom instanceof Element) || !paper || this.blockHandleAnchorHidden(dom)) return null
      const isTable = nodeAtSafe(this.editor.state.doc, range.from)?.type.name === 'table'
      const tableAnchor = isTable && (dom.matches('table') ? dom : dom.querySelector('table'))
      const shell = this.blockShellElement(dom)
      const callout = dom.closest?.('[data-type="callout"]')
      const anchor = tableAnchor || shell || callout || dom
      const mobile = window.innerWidth <= 760
      const domRect = anchor.getBoundingClientRect(), paperRect = paper.getBoundingClientRect()
      // 整表与正文按钮尺寸不同，换目标时不能用上一个主句柄的尺寸。
      const handle = this.$refs.root?.querySelector(isTable
        ? '.lark-doc-block-handle-main[data-block-scope="table"]'
        : mobile ? '.lark-doc-block-handle-main:not([data-block-scope="table"]), .lark-doc-empty-block-insert' : '.lark-doc-block-handle-main:not([data-block-scope="table"])')
      const handleRect = handle?.getBoundingClientRect()
      const handleWidth = handleRect?.width || (mobile ? 20 : isTable ? 40 : 42), handleHeight = handleRect?.height || (mobile ? 28 : isTable ? 24 : 26)
      const position = (top, left) => ({
        top: Math.max(0, Math.round((top - paperRect.top - (paper.clientTop || 0)) * 2) / 2),
        left: mobile ? Math.max(4, Math.round(left - paperRect.left - (paper.clientLeft || 0))) : Math.round(left - paperRect.left - (paper.clientLeft || 0)),
      })
      if (isTable) return position(domRect.top - handleHeight - 4, domRect.left - handleWidth - 4)
      const cell = dom.closest('td,th'), cellRect = cell?.getBoundingClientRect()
      const tableRect = cell?.closest('table')?.getBoundingClientRect()
      // 句柄留在整表外，避免后列句柄遮挡前一格的点击和跨格拖选。
      const cellLeft = tableRect ? tableRect.left - handleWidth - (Math.abs(cellRect.left - tableRect.left) < 2 ? 20 : 8) : null
      if (anchor.matches('figure[data-type="image"]')) {
        const frame = (anchor.querySelector('.lark-doc-image-frame') || anchor).getBoundingClientRect()
        return position(frame.top, cellLeft ?? domRect.left - handleWidth - 12)

      }
      const foldToggle = anchor.querySelector('.lark-doc-heading-fold-toggle')
      const foldRect = foldToggle?.getBoundingClientRect()
      const isCodeBlock = anchor.matches('.lark-doc-code, [data-type="codeBlock"]')
      const textBounds = isCodeBlock || shell ? this.outerBlockBounds(anchor) : this.highlightStartBounds(anchor)
      // taskItem 的 label 有屏幕阅读器文本，其 Range 仍有墨迹坐标；只测正文内容。
      const firstLineAnchor = isCodeBlock ? anchor.querySelector('.lark-doc-code-toolbar') || anchor
        : anchor.matches('li') ? anchor.querySelector(':scope > div, :scope > p') || anchor : anchor
      const firstLineBounds = this.firstLineInkBounds(firstLineAnchor) || this.firstTextLineBounds(firstLineAnchor) || textBounds
      const left = cellLeft !== null ? cellLeft
        : foldRect ? foldRect.left - handleWidth - 10
          : anchor.matches?.('[data-type="callout"]') ? domRect.left - handleWidth - 12
            : (textBounds?.left ?? domRect.left) - handleWidth - 12
      const line = foldRect || firstLineBounds || domRect
      return position((line.top + line.bottom - handleHeight) / 2, left)
    },
    columnsRangeFor(range) {
      if (!range || !this.editor) return null
      const doc = this.editor.state.doc
      if (nodeAtSafe(doc, range.from)?.type.name === 'table') return null
      const probes = [range.from, range.from + 1, Math.max(range.from, range.to - 1)]
      for (const probe of probes) {
        const $from = doc.resolve(Math.min(doc.content.size, Math.max(0, probe)))
        for (let depth = $from.depth; depth >= 1; depth -= 1) {
          if (['tableCell', 'tableHeader'].includes($from.node(depth).type.name)) return null
          if ($from.node(depth).type.name === 'columns') return { from: $from.before(depth), to: $from.after(depth), parentDepth: depth - 1 }
        }
      }
      return null
    },
    detailsRangeFor(range) {
      if (!range || !this.editor || nodeAtSafe(this.editor?.state?.doc, range.from)?.type.name !== 'detailsSummary') return null
      const doc = this.editor.state.doc
      const $from = doc.resolve(Math.min(doc.content.size, Math.max(0, range.from + 1)))
      for (let depth = $from.depth; depth >= 1; depth -= 1) {
        if ($from.node(depth).type.name === 'details') return { from: $from.before(depth), to: $from.after(depth), parentDepth: depth - 1 }
      }
      return null
    },
    handleBlockNode() {
      return this.handleNodeFor(this.handleRange)
    },
    handleNodeFor(range) {
      if (!this.editor || !range) return null
      const doc = this.editor.state.doc
      const direct = nodeAtSafe(doc, range.from)
      if (!direct || direct.type.name !== 'paragraph' || range.parentDepth <= 0) return direct
      const parent = doc.resolve(range.from).node(range.parentDepth)
      return ['callout', 'details', 'columns', 'column'].includes(parent.type.name) ? parent : direct
    },
    handleHighlightRange() {
      if (!this.editor || !this.handleRange) return null
      // 任何块只要下面挂了缩进子块，高亮就覆盖整棵子树（飞书的遮罩就是一个矩形，
      // 段落 + 缩进的代码块也算一个整体）。无子块时退回单块范围。
      const section = resolveHeadingHighlightSection(this.editor.state.doc, this.handleRange.from)
      if (section?.hasContent) return { from: section.from, to: section.to, section: true }
      return { from: this.handleRange.from, to: this.handleRange.to }
    },
    textContentBounds(element) {
      if (typeof Element === 'undefined' || !(element instanceof Element) || typeof document.createTreeWalker !== 'function' || typeof NodeFilter === 'undefined') return element?.getBoundingClientRect?.() || null
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      const rects = []
      let textNode = walker.nextNode()
      while (textNode) {
        const value = textNode.textContent || ''
        const start = value.search(/\S/)
        const end = value.search(/\s*$/)
        if (start >= 0 && end > start) {
          const range = document.createRange()
          range.setStart(textNode, start)
          range.setEnd(textNode, end)
          Array.from(range.getClientRects()).forEach((rect) => {
            if (rect.width > 0 && rect.height > 0) rects.push(rect)
          })
        }
        textNode = walker.nextNode()
      }
      if (!rects.length) {
        // 空段落没有文本 rect：给出至少一行高的可点击区域，
        // 宽度只到光标处（不铺满整行，需求 13.4.3.1）。
        const fallbackRect = element.getBoundingClientRect()
        return { left: fallbackRect.left, top: fallbackRect.top, right: fallbackRect.left + Math.min(fallbackRect.width || 0, 24), bottom: fallbackRect.bottom }
      }
      return {
        left: Math.min(...rects.map((rect) => rect.left)),
        top: Math.min(...rects.map((rect) => rect.top)),
        right: Math.max(...rects.map((rect) => rect.right)),
        bottom: Math.max(...rects.map((rect) => rect.bottom)),
      }
    },
    firstTextLineBounds(element) {
      if (typeof Element === 'undefined' || !(element instanceof Element) || typeof document.createTreeWalker !== 'function' || typeof NodeFilter === 'undefined') return element?.getBoundingClientRect?.() || null
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      const rects = []
      let textNode = walker.nextNode()
      while (textNode) {
        const value = textNode.textContent || ''
        const start = value.search(/\S/)
        const end = value.search(/\s*$/)
        if (start >= 0 && end > start) {
          const range = document.createRange()
          range.setStart(textNode, start)
          range.setEnd(textNode, end)
          Array.from(range.getClientRects()).forEach((rect) => {
            if (rect.width > 0 && rect.height > 0) rects.push(rect)
          })
        }
        textNode = walker.nextNode()
      }
      if (!rects.length) return element.getBoundingClientRect()
      rects.sort((left, right) => left.top - right.top || left.left - right.left)
      const firstTop = rects[0].top
      const lineRects = rects.filter((rect) => Math.abs(rect.top - firstTop) <= 1)
      return {
        left: Math.min(...lineRects.map((rect) => rect.left)),
        top: Math.min(...lineRects.map((rect) => rect.top)),
        right: Math.max(...lineRects.map((rect) => rect.right)),
        bottom: Math.max(...lineRects.map((rect) => rect.bottom)),
      }
    },
    /**
     * 首行「正文字号」的墨迹范围。
     *
     * 直接对所有 rect 取并集会被上标、行内公式、上下标标注拉偏：它们在首行里
     * 更高/更低，中心落在正文中线之外，句柄就会像吊在行上方。这里先按高度分桶，
     * 取累计宽度最大的那一桶（= 正文字号），再用它的垂直中心对齐句柄。
     */
    firstLineInkBounds(element) {
      if (typeof Element === 'undefined' || !(element instanceof Element) || typeof document.createTreeWalker !== 'function' || typeof NodeFilter === 'undefined') return null
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      const rects = []
      let textNode = walker.nextNode()
      while (textNode) {
        const value = textNode.textContent || ''
        const start = value.search(/\S/)
        const end = value.search(/\s*$/)
        if (start >= 0 && end > start) {
          const range = document.createRange()
          range.setStart(textNode, start)
          range.setEnd(textNode, end)
          Array.from(range.getClientRects()).forEach((rect) => {
            if (rect.width > 0 && rect.height > 0) rects.push(rect)
          })
        }
        textNode = walker.nextNode()
      }
      if (!rects.length) return null
      const firstTop = Math.min(...rects.map((rect) => rect.top))
      const lineRects = rects.filter((rect) => rect.top - firstTop <= Math.max(4, Math.min(14, rect.height * 0.8)))
      const buckets = new Map()
      lineRects.forEach((rect) => {
        const key = Math.round(rect.height)
        const entry = buckets.get(key) || { width: 0, rects: [] }
        entry.width += rect.width
        entry.rects.push(rect)
        buckets.set(key, entry)
      })
      let dominant = null
      buckets.forEach((entry) => { if (!dominant || entry.width > dominant.width) dominant = entry })
      const picked = dominant ? dominant.rects : lineRects
      return {
        left: Math.min(...picked.map((rect) => rect.left)),
        top: Math.min(...picked.map((rect) => rect.top)),
        right: Math.max(...picked.map((rect) => rect.right)),
        bottom: Math.max(...picked.map((rect) => rect.bottom)),
      }
    },
    highlightStartBounds(element) {
      const bounds = this.textContentBounds(element)
      if (!bounds || !(element instanceof Element)) return bounds
      const result = { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom }
      // 列表编号/项目符号是首个可见内容的一部分，不能把高亮或句柄放到 marker 之后。
      if (element.matches('ol, ul, li, [data-type="taskList"], [data-type="taskItem"]')) {
        result.left = Math.min(result.left, element.getBoundingClientRect().left)
      }
      return result
    },
    outerBlockBounds(element) {
      if (!(element instanceof Element)) return element?.getBoundingClientRect?.() || null
      // 表格的 nodeDOM 是 .tableWrapper，实际外框取内部 table。
      const frame = element.matches('.tableWrapper')
        ? element.querySelector('table') || element
        : element.matches('.lark-doc-code, [data-type="codeBlock"]')
          ? element
          : element.closest('.lark-doc-code, [data-type="codeBlock"]') || element
      const rect = frame.getBoundingClientRect()
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
    },
    blockShellElement(element) {
      if (!(element instanceof Element)) return null
      const shell = element.closest('.lark-doc-code, [data-type="codeBlock"], blockquote, [data-type="callout"], [data-type="columns"], [data-type="column"], table, figure[data-type="image"], hr')
      const cell = element.closest('td,th')
      return cell && shell && !cell.contains(shell) ? null : shell
    },
    handleHighlightBounds(element) {
      if (!(element instanceof Element)) return element?.getBoundingClientRect?.() || null
      // 容器/原子对象按完整外框高亮；文本块同样按**整块盒子**高亮。
      // 飞书的悬停遮罩就是一个块矩形（.hovered-mask，整列宽、整块高），
      // 不按字形收窄、也不给每行单独画一条。
      if (element.matches(FRAME_BLOCK_SELECTOR)) return this.outerBlockBounds(element)
      const rect = element.getBoundingClientRect()
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
    },
    highlightContainer(element, root) {
      if (!(element instanceof Element)) return root
      return element.closest('[data-type="column"], [data-type="callout"], [data-type="detailsContent"], blockquote, li, td, th') || root
    },
    highlightContentRight(element, root) {
      return this.highlightContainer(element, root)?.getBoundingClientRect?.().right ?? root?.getBoundingClientRect?.().right ?? 0
    },
    /**
     * 块 hover 高亮的几何统一画在编辑器外层的独立 overlay 上。
     *
     * 为什么不直接给块写内联样式：块 hover 用的是 ProseMirror **节点装饰**，
     * 实测装饰变化会重建该块的 DOM，写在块上的内联 CSS 变量会被下一次渲染擦掉
     * （表现为高亮闪一下回到整行宽度）。overlay 由组件自己持有，不参与 PM 的 DOM 复用。
     */
    syncHandleHighlightBackdrop() {
      if (!this.editor || this.editor.isDestroyed || this._isBeingDestroyed || this._isDestroyed) return
      const root = this.editor.view.dom
      if (!root) return
      const overlayHost = root.parentElement || root
      this._handleHighlightOverlay?.remove()
      this._handleHighlightOverlay = null
      if (this.editor.storage?.larkDoc && !this.editor.storage.larkDoc.handleHover) return
      if (!this.editor.storage?.larkDoc) overlayHost.querySelector('.lark-doc-heading-hover-overlay')?.remove()
      const hoveredNodes = Array.from(root.querySelectorAll('.lark-doc-block-handle-hovered'))
      if (!hoveredNodes.length) return
      const hostRect = overlayHost.getBoundingClientRect()
      const rects = []
      const sectionNodes = hoveredNodes.filter((node) => node.classList.contains('lark-doc-heading-section-hovered'))
      if (sectionNodes.length) {
        // 章节：整段合成一个矩形（飞书行为）。逐块画会在块间距里露出白缝，
        // 看起来像「隔行没有分开高亮」。横向铺到内容列右边界。
        const boundsList = sectionNodes.map((node) => this.handleHighlightBounds(node)).filter(Boolean)
        if (!boundsList.length) return
        const left = Math.min(...boundsList.map((bounds) => bounds.left))
        const top = Math.min(...boundsList.map((bounds) => bounds.top))
        const bottom = Math.max(...boundsList.map((bounds) => bounds.bottom))
        const contentRight = this.highlightContentRight(sectionNodes[0], root)
        rects.push({ left, top, width: Math.max(0, contentRight - left), height: Math.max(0, bottom - top), section: true })
      } else {
        const node = hoveredNodes[0]
        const bounds = this.handleHighlightBounds(node)
        if (!bounds) return
        const left = bounds.left
        // 分割线等极扁的对象给一个可点击高度的热区。
        let { top, bottom } = bounds
        if (bottom - top < 16) {
          const middle = (top + bottom) / 2
          top = middle - 8
          bottom = middle + 8
        }
        rects.push({ left, top, width: Math.max(0, bounds.right - left), height: Math.max(0, bottom - top), section: false })
      }
      if (!rects.length) return
      const overlay = document.createElement('div')
      overlay.className = 'lark-doc-heading-hover-overlay'
      overlay.setAttribute('aria-hidden', 'true')
      rects.forEach((rect, index) => {
        const segment = document.createElement('span')
        segment.className = rect.section ? 'lark-doc-heading-hover-segment' : 'lark-doc-block-hover-segment'
        if (index === 0) segment.classList.add('is-first')
        if (index === rects.length - 1) segment.classList.add('is-last')
        segment.style.left = `${Math.round((rect.left - hostRect.left) * 2) / 2}px`
        segment.style.top = `${Math.round((rect.top - hostRect.top) * 2) / 2}px`
        segment.style.width = `${Math.round(rect.width * 2) / 2}px`
        segment.style.height = `${Math.round(rect.height * 2) / 2}px`
        overlay.appendChild(segment)
      })
      overlayHost.appendChild(overlay)
      this._handleHighlightOverlay = overlay
    },
    clearHandleHighlight() {
      if (!this.editor || this.editor.isDestroyed || !this.editor.commands?.setLarkDocHandleHover) return
      const current = this.editor.storage.larkDoc?.handleHover
      if (current) this.editor.commands.setLarkDocHandleHover(null)
      this.$nextTick(() => this.syncHandleHighlightBackdrop())
    },
    setHandleHighlight(active) {
      if (!this.editor || this.editor.isDestroyed || !this.editor.commands?.setLarkDocHandleHover) return
      const next = active ? this.handleHighlightRange() : null
      const current = this.editor.storage.larkDoc?.handleHover
      if (current?.from === next?.from && current?.to === next?.to && (current?.section === true) === (next?.section === true)) return
      this.editor.commands.setLarkDocHandleHover(next)
      this.$nextTick(() => this.syncHandleHighlightBackdrop())
    },
    refreshHandleHighlight() {
      this.setHandleHighlight(this.handleHovering || this.handlePressed || this.dragging || this.blockMenuOpen)
    },
    scheduleHandleHide() {
      clearTimeout(this.handleHideTimer)
      this.handleHideTimer = setTimeout(() => {
        if (this.dragging || this.handlePressed || this.blockMenuOpen || this.blockTypeMenuOpen) return
        this.clearHandleHighlight()
        this.handleRange = null
      }, 220)
    },
    onEditorPointerDown(event) {
      const editor = this.editor
      if (event.pointerType !== 'touch' || event.isPrimary === false || event.button !== 0 || event.defaultPrevented
        || !editor || editor.isDestroyed || this._isBeingDestroyed || this._isDestroyed || this.nativeScopeValid === false
        || !this.writable() || !this.featureEnabled('blockHandle') || this.dragging || this.handlePressed || this.columnResize || this._tableReorder) return
      const dom = editor.view.dom, target = event.target
      if (!dom.isConnected || !this.$refs.root?.contains(dom) || !dom.contains(target) || target?.closest?.('.ProseMirror') !== dom
        || target.closest('button,input,select,textarea,a,[role="button"],[contenteditable="false"],.column-resize-handle')) return
      const pos = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
      if (Number.isInteger(pos)) this.positionBlockHandle(this.rangeAt(pos))
    },
    onEditorPointerMove(event) {
      if (event.buttons || this.dragging || this.handlePressed || this.columnResize) return
      this.updateTableBoundaryHover(event)
      const pos = this.editor.view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
      if (Number.isInteger(pos)) this.positionBlockHandle(this.rangeAt(pos))
      else this.scheduleHandleHide()
    },
    onPaperPointerMove(event) {
      if (event.target?.closest?.('.ProseMirror, .lark-doc-table-boundary-tools')) return
      this.clearTableBoundaryHover()
    },
    onHandlePointerUp() {
      if (!this.handlePressed) return
      this.handlePressed = false
      this.refreshHandleHighlight()
    },
    // P0-03：句柄按下/拖拽结束的模板级赋值收敛为方法——子组件模板经 ed. 调用，避免 vue/no-mutating-props。
    pressHandle() { this.handlePressed = true },
    endBlockDrag() { this.handlePressed = false; this.dragging = null; this.dropPosition = null; this.refreshHandleHighlight() },
    // Callout handles sit outside the NodeView, but pointer positions resolve
    // into its contentDOM paragraph; dragging must preserve the outer module.
    blockDragRange(range) {
      if (!range || !this.editor) return range
      const doc = this.editor.state.doc
      const direct = nodeAtSafe(this.editor?.state?.doc, range.from)
      if (['callout', 'table'].includes(direct?.type.name)) return range
      const $from = doc.resolve(range.from)
      for (let depth = $from.depth; depth >= 1; depth -= 1) {
        if (['tableCell', 'tableHeader'].includes($from.node(depth).type.name)) return range
        if ($from.node(depth).type.name !== 'callout') continue
        return { from: $from.before(depth), to: $from.after(depth), parentDepth: depth - 1 }
      }
      return range
    },
    startBlockDrag(event) {
      if (!this.writable() || !this.featureEnabled('blockDrag')) return
      const selected = this.handleActionRange()
      const range = this.blockDragRange(this.headingActionRange(selected) || selected)
      if (!range) return
      this.dragging = { ...range, doc: this.editor.state.doc }
      this.refreshHandleHighlight()
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('application/x-lark-doc-block', 'move')
      }
    },
    onBlockDragOver(event) {
      if (!this.featureEnabled('blockDrag') || !this.dragging) return
      if (!this.writable() || this.dragging.doc !== this.editor.state.doc) { this.endBlockDrag(); return }
      const pos = this.editor.view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
      const rawTarget = Number.isInteger(pos) ? this.rangeAt(pos) : null
      const targetRange = this.blockDragRange(rawTarget)
      const sameRange = targetRange && this.dragging.from === targetRange.from && this.dragging.to === targetRange.to
      if (!targetRange || sameRange) {
        this.dropPosition = null
        this.dropLineTop = 0
        return
      }
      const dom = this.editor.view.nodeDOM(targetRange.from)
      const paper = this.$refs.root.querySelector('.lark-doc-paper')
      if (!(dom instanceof Element) || !paper) return
      const rect = dom.getBoundingClientRect()
      const before = event.clientY < rect.top + rect.height / 2
      this.dropPosition = before ? targetRange.from : targetRange.to
      this.dropLineTop = (before ? rect.top : rect.bottom) - paper.getBoundingClientRect().top
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    },
    onBlockDrop(event) {
      if (!this.dragging) return
      if (!this.featureEnabled('blockDrag') || !this.writable() || this.dragging.doc !== this.editor.state.doc) { this.endBlockDrag(); return }
      event.preventDefault()
      const source = this.dragging
      this.dragging = null
      this.handlePressed = false
      this.refreshHandleHighlight()
      const pos = this.dropPosition
      this.dropPosition = null
      if (!Number.isInteger(pos)) return
      this.editor.view.dispatch(closeHistory(this.editor.state.tr))
      if (!moveBlockRange(this.editor, source.from, source.to, pos)) this.error = moveDepthAllowed(this.editor, source.from, source.to, pos) ? '当前区块不能移动到这里' : '容器嵌套最多 5 层，不能移动到这里'
    },
  },
}
