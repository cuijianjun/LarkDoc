/**
 * blockHandleMixin — 区块句柄定位、区块范围计算与悬停高亮背景，以及区块拖拽移动。
 * 通过 this.editor、this.$refs.root、this.error 与主组件协作；与 blockMenuMixin 紧密配合
 * （菜单开合会调用本组的 setHandleHighlight/closeBlockMenu 相关方法，this 上均可直接访问）。
 * 采用 mixin 而非子组件：句柄与高亮 overlay 的 DOM 操作依赖主组件模板与 Vue 2 选项合并语义。
 */
import { closeHistory } from '@tiptap/pm/history'
import { headingActionRange, moveBlockRange, resolveHeadingHighlightSection } from '../documentOperations'

export default {
  data() { return {
    blockHandlePosition: { top: 200, left: 0 }, handleRange: null, handleHideTimer: null,
    dragging: null, handlePressed: false, handleHovering: false, dropPosition: null, dropLineTop: 0,
  } },
  computed: {
    blockHandleStyle() { return { top: `${this.blockHandlePosition.top}px`, left: `${this.blockHandlePosition.left}px` } },
    handleIsEmptyParagraph() {
      if (!this.editor || !this.handleRange) return false
      const node = this.editor.state.doc.nodeAt(this.handleRange.from)
      return this.handleBlockNode() === node && node?.type.name === 'paragraph' && node.content.size === 0
    },
    handleIsTaskList() {
      if (!this.editor || !this.handleRange) return false
      const node = this.editor.state.doc.nodeAt(this.handleRange.from)
      return ['taskList', 'taskItem'].includes(node?.type?.name)
    },
    handleGlyph() {
      if (!this.editor || !this.handleRange) return '＋'
      const doc = this.editor.state.doc
      const directNode = doc.nodeAt(this.handleRange.from)
      const node = this.handleBlockNode() || directNode
      const glyphs = { paragraph: 'T', heading: 'H', bulletList: '•', orderedList: '1≡', taskList: '☑', listItem: '•', blockquote: '❝', codeBlock: '{}', horizontalRule: '≡', callout: '▤', details: '▾', columns: 'Ⅱ', table: '▦', image: '▧' }
      if (node?.type.name === 'listItem') {
        const $pos = doc.resolve(Math.min(doc.content.size, this.handleRange.from + 1))
        for (let depth = $pos.depth; depth > 0; depth -= 1) {
          const name = $pos.node(depth).type.name
          if (name === 'taskList' || name === 'orderedList' || name === 'bulletList') return glyphs[name]
        }
      }
      if (node?.type?.name === 'heading') return `H${node.attrs?.level || 1}`
      return glyphs[node?.type?.name] || 'T'
    },
  },
  methods: {
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
      if (!selection.empty) {
        const start = doc.resolve(selected.from)
        const end = doc.resolve(selected.to)
        if (start.sameParent(end) && end.index() - start.index() > 1) return selected
      }
      return this.handleRange || selected
    },
    headingActionRange(range) {
      if (!range || !this.editor) return null
      const node = this.editor.state.doc.nodeAt(range.from)
      return node?.type.name === 'heading' ? headingActionRange(this.editor.state.doc, range.from) : null
    },
    rangeAt(from, to = from) {
      const doc = this.editor.state.doc
      const $from = doc.resolve(from)
      const $to = doc.resolve(to)
      const containers = new Set(['doc', 'column', 'callout', 'detailsContent', 'bulletList', 'orderedList', 'taskList', 'columns', 'table', 'codeBlock', 'horizontalRule', 'image', 'details'])
      for (let depth = $from.depth; depth >= 1; depth -= 1) {
        if ($from.node(depth).type.name !== 'table' || $from.node(depth) !== $to.node(depth)) continue
        // 飞书把表格作为一个区块操作，表格内的行不能抢走左侧区块句柄。
        return { from: $from.before(depth), to: $from.after(depth), parentDepth: depth - 1 }
      }
      for (let depth = Math.min($from.depth, $to.depth); depth >= 0; depth -= 1) {
        if ($from.node(depth) !== $to.node(depth) || !containers.has($from.node(depth).type.name)) continue
        const startIndex = $from.index(depth)
        const endIndex = Math.min($from.node(depth).childCount, $to.index(depth) + Number($to.pos > $to.posAtIndex($to.index(depth), depth)))
        if (startIndex >= $from.node(depth).childCount) return null
        return { from: $from.posAtIndex(startIndex, depth), to: $from.posAtIndex(Math.max(startIndex + 1, endIndex), depth), parentDepth: depth }
      }
      return null
    },
    positionBlockHandle(range) {
      if (!range) return
      const dom = this.editor.view.nodeDOM(range.from)
      const paper = this.$refs.root?.querySelector('.feishu-paper')
      if (!(dom instanceof Element) || !paper) return
      if (this.blockMenuOpen && this.handleRange && (this.handleRange.from !== range.from || this.handleRange.to !== range.to)) this.closeBlockMenu()
      clearTimeout(this.handleHideTimer)
      this.clearBlockMenuCloseTimer()
      this.handleRange = range
      if (this.handleHovering || this.handlePressed || this.dragging || this.blockMenuOpen) this.setHandleHighlight(true)
      const shell = this.blockShellElement(dom)
      const callout = dom.closest?.('[data-type="callout"]')
      const anchor = shell instanceof Element ? shell : callout instanceof Element ? callout : dom
      const domRect = anchor.getBoundingClientRect()
      const paperRect = paper.getBoundingClientRect()
      const isCallout = anchor.matches?.('[data-type="callout"]')
      const isHeading = /^H[1-6]$/.test(anchor.tagName) || anchor.matches?.('[data-type="heading"]')
      const foldToggle = isHeading ? anchor.querySelector?.('.feishu-heading-fold-toggle') : null
      const foldRect = foldToggle instanceof Element ? foldToggle.getBoundingClientRect() : null
      const handleElement = this.$refs.root?.querySelector('.feishu-block-handle-main')
      const handleWidth = handleElement instanceof Element ? handleElement.getBoundingClientRect().width : 42
      const handleHeight = handleElement instanceof Element ? handleElement.getBoundingClientRect().height : 30
      const isCodeBlock = anchor.matches?.('.feishu-code, [data-type="codeBlock"]')
      const textBounds = isCodeBlock || shell instanceof Element ? this.outerBlockBounds(anchor) : this.highlightStartBounds(anchor)
      // 代码块的首行是飞书式语言/复制工具栏行；代码正文仍属于同一外壳高亮。
      const firstLineAnchor = isCodeBlock ? anchor.querySelector?.('.feishu-code-toolbar') || anchor : anchor
      const firstLineBounds = this.firstTextLineBounds(firstLineAnchor) || textBounds
      // 标题的折叠箭头会随文字对齐方式移动；以箭头实际位置为锚点，保持句柄与箭头固定间距。
      const handleLeft = foldRect
        ? foldRect.left - paperRect.left - handleWidth - 10
        : isCallout
          ? domRect.left - paperRect.left - handleWidth - 12
          : (textBounds ? textBounds.left : domRect.left) - paperRect.left - handleWidth - 12
      const verticalAnchor = foldRect || firstLineBounds
      const firstTop = verticalAnchor ? verticalAnchor.top : domRect.top
      const firstBottom = verticalAnchor ? verticalAnchor.bottom : domRect.bottom
      this.blockHandlePosition = {
        // 句柄垂直跟随首行文字；多行块仍锚定第一行，而不是整个块盒。
        top: Math.max(0, Math.round(((firstTop + firstBottom) / 2 - paperRect.top - (paper.clientTop || 0) - handleHeight / 2) * 2) / 2),
        // Keep the narrow handle immediately before the fold widget and the
        // text, regardless of paper padding or viewport width.
        left: Math.round(handleLeft),
      }
    },
    columnsRangeFor(range) {
      if (!range || !this.editor) return null
      const doc = this.editor.state.doc
      const probes = [range.from, range.from + 1, Math.max(range.from, range.to - 1)]
      for (const probe of probes) {
        const $from = doc.resolve(Math.min(doc.content.size, Math.max(0, probe)))
        for (let depth = $from.depth; depth >= 1; depth -= 1) {
          if ($from.node(depth).type.name === 'columns') return { from: $from.before(depth), to: $from.after(depth), parentDepth: depth - 1 }
        }
      }
      return null
    },
    detailsRangeFor(range) {
      if (!range || !this.editor || this.editor.state.doc.nodeAt(range.from)?.type.name !== 'detailsSummary') return null
      const doc = this.editor.state.doc
      const $from = doc.resolve(Math.min(doc.content.size, Math.max(0, range.from + 1)))
      for (let depth = $from.depth; depth >= 1; depth -= 1) {
        if ($from.node(depth).type.name === 'details') return { from: $from.before(depth), to: $from.after(depth), parentDepth: depth - 1 }
      }
      return null
    },
    handleBlockNode() {
      if (!this.editor || !this.handleRange) return null
      const doc = this.editor.state.doc
      const direct = doc.nodeAt(this.handleRange.from)
      if (!direct || direct.type.name !== 'paragraph' || this.handleRange.parentDepth <= 0) return direct
      const parent = doc.resolve(this.handleRange.from).node(this.handleRange.parentDepth)
      return ['callout', 'details', 'columns', 'column'].includes(parent.type.name) ? parent : direct
    },
    handleHighlightRange() {
      if (!this.editor || !this.handleRange) return null
      const node = this.editor.state.doc.nodeAt(this.handleRange.from)
      if (node?.type.name === 'heading') {
        const section = resolveHeadingHighlightSection(this.editor.state.doc, this.handleRange.from)
        if (section?.hasContent) return { from: section.from, to: section.to, section: true }
      }
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
      if (!rects.length) return element.getBoundingClientRect()
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
      const code = element.matches('.feishu-code, [data-type="codeBlock"]') ? element : element.closest('.feishu-code, [data-type="codeBlock"]')
      const rect = code?.getBoundingClientRect?.() || element.getBoundingClientRect()
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
    },
    blockShellElement(element) {
      if (!(element instanceof Element)) return null
      return element.closest('.feishu-code, [data-type="codeBlock"], blockquote, [data-type="callout"], [data-type="columns"], [data-type="column"], table, figure[data-type="image"], hr')
    },
    handleHighlightBounds(element) {
      if (!(element instanceof Element)) return element?.getBoundingClientRect?.() || null
      return element.matches('.feishu-code, [data-type="codeBlock"]') ? this.outerBlockBounds(element) : this.highlightStartBounds(element)
    },
    highlightContainer(element, root) {
      if (!(element instanceof Element)) return root
      return element.closest('[data-type="column"], [data-type="callout"], [data-type="detailsContent"], blockquote, li, td, th') || root
    },
    highlightContentRight(element, root) {
      return this.highlightContainer(element, root)?.getBoundingClientRect?.().right ?? root?.getBoundingClientRect?.().right ?? 0
    },
    syncHandleHighlightBackdrop() {
      const root = this.editor?.view?.dom
      if (!root) return
      const overlayHost = root.parentElement || root
      overlayHost.querySelector('.feishu-heading-hover-overlay')?.remove()
      const hoveredNodes = Array.from(root.querySelectorAll('.feishu-block-handle-hovered'))
      hoveredNodes.forEach((node) => {
        ['--feishu-block-hover-left', '--feishu-block-hover-top', '--feishu-block-hover-width', '--feishu-block-hover-height'].forEach((name) => node.style.removeProperty(name))
      })
      hoveredNodes.filter((node) => !node.classList.contains('feishu-heading-section-hovered')).forEach((node) => {
        const bounds = this.handleHighlightBounds(node)
        const nodeRect = node.getBoundingClientRect()
        if (!bounds || !nodeRect.width || !nodeRect.height) return
        const isCodeBlock = node.matches?.('.feishu-code, [data-type="codeBlock"]')
        const contentRight = isCodeBlock ? bounds.right : this.highlightContentRight(node, root)
        node.style.setProperty('--feishu-block-hover-left', `${bounds.left - nodeRect.left}px`)
        node.style.setProperty('--feishu-block-hover-top', `${bounds.top - nodeRect.top}px`)
        node.style.setProperty('--feishu-block-hover-width', `${Math.max(0, contentRight - bounds.left)}px`)
        node.style.setProperty('--feishu-block-hover-height', `${Math.max(0, bounds.bottom - bounds.top)}px`)
      })
      const sectionNodes = hoveredNodes.filter((node) => node.classList.contains('feishu-heading-section-hovered'))
      if (!sectionNodes.length) {
        return
      }
      const first = sectionNodes[0]
      const firstBounds = this.handleHighlightBounds(first)
      if (!firstBounds) return
      const hostRect = overlayHost.getBoundingClientRect()
      const left = firstBounds.left
      const contentRight = this.highlightContentRight(first, root)
      const overlay = document.createElement('div')
      overlay.className = 'feishu-heading-hover-overlay'
      overlay.setAttribute('aria-hidden', 'true')
      sectionNodes.forEach((node, index) => {
        const bounds = this.handleHighlightBounds(node)
        if (!bounds) return
        const segment = document.createElement('span')
        segment.className = 'feishu-heading-hover-segment'
        if (index === 0) segment.classList.add('is-first')
        if (index === sectionNodes.length - 1) segment.classList.add('is-last')
        segment.style.left = `${left - hostRect.left}px`
        segment.style.top = `${bounds.top - hostRect.top}px`
        segment.style.width = `${Math.max(0, contentRight - left)}px`
        segment.style.height = `${Math.max(0, bounds.bottom - bounds.top)}px`
        overlay.appendChild(segment)
      })
      if (overlay.childElementCount) overlayHost.appendChild(overlay)
    },
    clearHandleHighlight() {
      if (!this.editor || this.editor.isDestroyed || !this.editor.commands?.setFeishuHandleHover) return
      const current = this.editor.storage.feishuDocument?.handleHover
      if (current) this.editor.commands.setFeishuHandleHover(null)
      this.$nextTick(() => this.syncHandleHighlightBackdrop())
    },
    setHandleHighlight(active) {
      if (!this.editor || this.editor.isDestroyed || !this.editor.commands?.setFeishuHandleHover) return
      const next = active ? this.handleHighlightRange() : null
      const current = this.editor.storage.feishuDocument?.handleHover
      if (current?.from === next?.from && current?.to === next?.to && current?.section === next?.section) return
      this.editor.commands.setFeishuHandleHover(next)
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
    onEditorPointerMove(event) {
      if (this.dragging || this.handlePressed || this.columnResize) return
      this.updateTableBoundaryHover(event)
      const pos = this.editor.view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
      if (Number.isInteger(pos)) this.positionBlockHandle(this.rangeAt(pos))
      else this.scheduleHandleHide()
    },
    onPaperPointerMove(event) {
      if (event.target?.closest?.('.ProseMirror, .feishu-table-boundary-tools')) return
      this.clearTableBoundaryHover()
    },
    onHandlePointerUp() { this.handlePressed = false; this.refreshHandleHighlight() },
    // Callout handles sit outside the NodeView, but pointer positions resolve
    // into its contentDOM paragraph; dragging must preserve the outer module.
    blockDragRange(range) {
      if (!range || !this.editor) return range
      const doc = this.editor.state.doc
      const direct = doc.nodeAt(range.from)
      if (direct?.type.name === 'callout') return range
      const $from = doc.resolve(range.from)
      for (let depth = $from.depth; depth >= 1; depth -= 1) {
        if ($from.node(depth).type.name !== 'callout') continue
        return { from: $from.before(depth), to: $from.after(depth), parentDepth: depth - 1 }
      }
      return range
    },
    startBlockDrag(event) {
      if (!this.writable() || !this.featureEnabled('blockDrag')) return
      const selected = this.handleActionRange()
      this.dragging = this.blockDragRange(this.headingActionRange(selected) || selected)
      if (!this.dragging) return
      this.refreshHandleHighlight()
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('application/x-feishu-block', 'move')
      }
    },
    onBlockDragOver(event) {
      if (!this.featureEnabled('blockDrag') || !this.dragging) return
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
      const paper = this.$refs.root.querySelector('.feishu-paper')
      if (!(dom instanceof Element) || !paper) return
      const rect = dom.getBoundingClientRect()
      const before = event.clientY < rect.top + rect.height / 2
      this.dropPosition = before ? targetRange.from : targetRange.to
      this.dropLineTop = (before ? rect.top : rect.bottom) - paper.getBoundingClientRect().top
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    },
    onBlockDrop(event) {
      if (!this.featureEnabled('blockDrag') || !this.dragging || !this.writable()) return
      event.preventDefault()
      const source = this.dragging
      this.dragging = null
      this.handlePressed = false
      this.refreshHandleHighlight()
      const pos = this.dropPosition
      this.dropPosition = null
      if (!Number.isInteger(pos)) return
      this.editor.view.dispatch(closeHistory(this.editor.state.tr))
      if (!moveBlockRange(this.editor, source.from, source.to, pos)) this.error = '当前区块不能移动到这里'
    },
  },
}
