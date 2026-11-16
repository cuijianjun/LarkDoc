/**
 * blockMenuMixin — 区块菜单（类型/对齐/颜色子菜单）的开合、定位、悬停/焦点关闭调度与菜单动作。
 * 通过 this.editor、this.writable()、this.featureEnabled()、this.savedSelection 与主组件协作；
 * 依赖 blockHandleMixin 的 handleActionRange/setHandleHighlight/refreshHandleHighlight（this 上合并可见）。
 * 采用 mixin 而非子组件：菜单 DOM 挂在主模板的句柄内，依赖 Vue 2 选项合并语义，拆子组件会破坏定位逻辑。
 */
import { closeHistory } from '@tiptap/pm/history'
import { BLOCK_ID_PATTERN, clampBlockIndent, maxIndentAt, moveBlockRange, nodeAtSafe, safeUrl, stepBlockIndent } from '../documentOperations'
import { isBlockActionEnabled } from '../larkDocConfig'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { liftListItem } from '@tiptap/pm/schema-list'
import { wrapContainerAllowed } from '../../../core/blocks/container-depth'
import { blockActions, blockTypeActions } from './constants'
import { placeMenu } from '../../../ui/menuLayout'

function placeBlockSubmenu(menu, trigger) {
  const margin = 8, gap = 5
  // Clear a previous narrow clip on the still-open menu.
  menu.style.maxHeight = menu.style.maxWidth = menu.style.minWidth = ''
  const rect = trigger.getBoundingClientRect(), box = menu.getBoundingClientRect()
  const win = menu.ownerDocument.defaultView
  const right = rect.right + gap, left = rect.left - box.width - gap
  if (right + box.width + margin > win.innerWidth && left < margin) {
    // 窄屏锚定父菜单
    const p = trigger.parentElement
    return placeMenu(menu, p.offsetWidth ? p : rect, margin, { gap })
  }
  return {
    left: `${Math.round(right + box.width + margin <= win.innerWidth ? right : left)}px`,
    top: `${Math.round(Math.max(margin, Math.min(win.innerHeight - box.height - margin, rect.top)))}px`,
  }
}

export default {
  data() { return {
    blockMenuOpen: false, blockTypeMenuOpen: false, blockAlignMenuOpen: false, blockColorMenuOpen: false,
    blockMenuStyle: {}, blockAlignMenuStyle: {}, blockColorMenuStyle: {}, blockMenuCloseTimer: null, blockMenuHovering: false,
    blockActions, blockTypeActions,
  } },
  watch: {
    onSaveTemplate(value) { if (this._templateSaveRequest?.callback !== value) this.closeBlockTemplateSave(); this.refreshBlockMenu() },
    effectiveReadonly() { if (!this.templateSaveAllowed()) this.closeBlockTemplateSave() },
    larkDocConfig: { deep: true, handler() { if (!this.templateSaveAllowed()) this.closeBlockTemplateSave() } },
    session(value) { if (this._templateSaveRequest?.session !== value) this.closeBlockTemplateSave() },
    documentId(value) { if (this._templateSaveRequest?.documentId !== value) this.closeBlockTemplateSave() },
  },
  beforeDestroy() { this.closeBlockTemplateSave() },
  methods: {
    templateSaveAllowed() {
      return this.writable() && this.featureEnabled('templates') && isBlockActionEnabled(this.larkDocConfig, 'saveTemplate')
        && this.shareCan('canView') && this.shareCan('canExport') && typeof this.onSaveTemplate === 'function'
    },
    closeBlockTemplateSave() {
      this._templateSaveRequest = null
      this._templateSaveDialog?.destroy()
      this._templateSaveDialog = null
    },
    openBlockTemplateSave(range) {
      if (!this.templateSaveAllowed() || !range) return false
      this.closeBlockTemplateSave()
      const editor = this.editor, doc = editor.state.doc, session = this.session, documentId = session?.documentId, callback = this.onSaveTemplate
      const request = { callback, session, documentId: this.documentId }
      this._templateSaveRequest = request
      const current = () => this._templateSaveRequest === request && this.templateSaveAllowed()
        && this.editor === editor && !editor.isDestroyed && editor.state.doc === doc && this.session === session && session?.documentId === documentId && this.onSaveTemplate === callback
      import('../../../editor/templateSave').then(({ openTemplateSave }) => {
        if (!current()) return
        const dialog = openTemplateSave({ host: this, range, isCurrent: current })
        if (current()) this._templateSaveDialog = dialog
        else dialog?.destroy()
      }).catch(error => { if (current()) { this.error = error?.message || '模板保存界面无法打开，请重试'; this.closeBlockTemplateSave() } })
      return true
    },
    blockTextblockTarget(range) {
      if (!range || !this.editor) return null
      const doc = this.editor.state.doc
      const text = this.blockTypeTextRange(range)
      if (!text) return null
      const $pos = doc.resolve(text.from)
      for (let depth = $pos.depth; depth > 0; depth -= 1) {
        const node = $pos.node(depth)
        if (node.type.name === 'paragraph' || node.type.name === 'heading') return { node, pos: $pos.before(depth) }
      }
      const node = nodeAtSafe(this.editor?.state?.doc, range?.from)
      return node && (node.type.name === 'paragraph' || node.type.name === 'heading') ? { node, pos: range.from } : null
    },
    /**
     * 缩进目标：只要节点带 indent 属性就能整块缩进——文本块在前，
     * 代码块（飞书可整体缩进的盒子）在后。文本对齐仍只作用于文本块。
     */
    blockIndentTarget(range) {
      if (!range || !this.editor) return null
      const doc = this.editor.state.doc
      const node = nodeAtSafe(doc, range.from)
      const text = node?.isTextblock && this.blockTextblockTarget(range)
      if (text) return text
      if (node && Number.isInteger(node.attrs?.indent)) return { node, pos: range.from }
      // 容器（列表项等）自己没有 indent：优先用光标所在的那个块；
      // 光标不在范围内时取范围内最后一个带 indent 的块（例如 item 里的代码块）。
      // 这样「列表项里放一个代码块」也能单独缩它，而不是整个菜单都灰掉。
      const { selection } = this.editor.state
      if (selection.from >= range.from && selection.to <= range.to) {
        const $from = selection.$from
        for (let depth = $from.depth; depth > 0; depth -= 1) {
          if (Number.isInteger($from.node(depth).attrs?.indent)) return { node: $from.node(depth), pos: $from.before(depth) }
        }
      }
      let found = null
      doc.nodesBetween(range.from, Math.min(range.to, doc.content.size), (child, pos) => {
        if (!Number.isInteger(child.attrs?.indent)) return true
        found = { node: child, pos }
        return false
      })
      return found
    },
    applyBlockAttribute(target, name, value) {
      if (!this.writable() || !target?.node || value === null || value === undefined) return false
      const attrs = { ...target.node.attrs, [name]: name === 'indent' ? clampBlockIndent(value, this.maxBlockIndent) : value }
      const tr = this.editor.state.tr.setNodeMarkup(target.pos, target.node.type, attrs)
      if (!tr.docChanged) return false
      this.editor.view.dispatch(tr)
      this.editor.view.focus()
      this.$nextTick(() => this.positionBlockHandle(this.handleRange || this.currentBlockRange()))
      return true
    },
    blockAlignNode() {
      const range = this.handleActionRange()
      return this.blockTextblockTarget(range)?.node || null
    },
    blockAlignValue() { return this.blockAlignNode()?.attrs?.textAlign || 'left' },
    blockAlignIndent() { return Number(this.blockIndentTarget(this.handleActionRange())?.node?.attrs?.indent) || 0 },
    // 增加缩进的上限由「前一个块」决定：缩进 = 成为上一个块的子块，
    // 所以父容器里第一个块一级都缩不了（真飞书菜单项同样置灰）。
    blockAlignIndentLimit() {
      const target = this.blockIndentTarget(this.handleActionRange())
      if (!target || !this.editor) return 0
      return maxIndentAt(this.editor.state.doc, target.pos, this.maxBlockIndent)
    },
    blockAlignCanIncrease() { return this.blockAlignIndent() < this.blockAlignIndentLimit() },
    clearBlockMenuCloseTimer() {
      clearTimeout(this.blockMenuCloseTimer)
      this.blockMenuCloseTimer = null
    },
    blockMenuHasFocus() {
      const active = typeof document !== 'undefined' ? document.activeElement : null
      const handle = this.$refs.root?.querySelector('.lark-doc-block-handle')
      return Boolean(active && handle?.contains(active))
    },
    closeBlockMenu() {
      this.closeBlockInsertMenu()
      this.clearBlockMenuCloseTimer()
      this.blockMenuHovering = false
      this.blockMenuOpen = false
      this.blockTypeMenuOpen = false
      this.blockAlignMenuOpen = false
      this.blockColorMenuOpen = false
      this.blockAlignMenuStyle = {}
      this.blockColorMenuStyle = {}
      this.refreshHandleHighlight()
    },
    scheduleBlockMenuClose() {
      if (this._blockInsertContext && this.menuOpen) return
      this.clearBlockMenuCloseTimer()
      this.blockMenuCloseTimer = setTimeout(() => {
        this.blockMenuCloseTimer = null
        if (this.handleHovering || this.blockMenuHovering || this.handlePressed || this.dragging || this.blockMenuHasFocus()) return
        this.closeBlockMenu()
      }, 180)
    },
    onBlockHandleEnter() {
      this.clearBlockMenuCloseTimer()
      this.handleHovering = true
      this.refreshHandleHighlight()
    },
    onBlockHandleLeave(event) {
      if (event?.relatedTarget?.closest?.('.lark-doc-block-menu')) return
      // 表格开关会让表格重渲染，浏览器对着句柄派生一次假 mouseleave（鼠标其实没动）：
      // 短窗口内忽略，等真离开时再正常调度关闭。
      if (this._keepMenuThroughRender) { this.handleHovering = true; return }
      this.handleHovering = false
      if (this.blockMenuOpen && !this.handlePressed) this.scheduleBlockMenuClose()
      this.refreshHandleHighlight()
    },
    onBlockMenuEnter() {
      this.clearBlockMenuCloseTimer()
      this.blockMenuHovering = true
      this.refreshHandleHighlight()
    },
    onBlockMenuLeave(event) {
      if (event?.relatedTarget?.closest?.('.lark-doc-block-handle')) return
      this.blockMenuHovering = false
      if (this.blockMenuOpen && !this.handlePressed) this.scheduleBlockMenuClose()
      this.refreshHandleHighlight()
    },
    onBlockMenuFocusIn() {
      this.clearBlockMenuCloseTimer()
      this.refreshHandleHighlight()
    },
    onBlockMenuFocusOut(event) {
      if (event.relatedTarget && this.$refs.root?.querySelector('.lark-doc-block-handle')?.contains(event.relatedTarget)) return
      if (this.blockMenuOpen && !this.handlePressed) this.scheduleBlockMenuClose()
    },
    positionBlockMenu(selector) { return this._blockMenuPosition?.call(this, selector) },

    openBlockMenuOnHover() {
      if (!this.writable() || this.handleIsEmptyParagraph) return
      this.handleHovering = true
      this.openBlockMenu()
    },
    toggleBlockTypeMenu() { this.openBlockMenu() },
    openBlockMenu() {
      if (!this.writable() || this.handleIsEmptyParagraph) return
      this.clearBlockMenuCloseTimer()
      this.blockMenuOpen = true
      this.setHandleHighlight(true)
      this.blockTypeMenuOpen = false
      this.blockAlignMenuOpen = false
      this.blockColorMenuOpen = false
      this.blockAlignMenuStyle = {}
      this.blockColorMenuStyle = {}
      this.blockMenuStyle = {}
      this.positionBlockMenu('.lark-doc-block-menu')
    },
    toggleBlockMenu() { this.openBlockMenu() },
    openBlockAlignMenuOnHover() {
      if (!this.blockMenuOpen || !this.writable() || this.blockAlignMenuOpen) return
      this.blockAlignMenuOpen = true
      this.blockColorMenuOpen = false
      this.blockAlignMenuStyle = {}
      this.blockColorMenuStyle = {}
      this.$nextTick(() => this.positionBlockAlignMenu())
    },
    openBlockColorMenuOnHover() {
      if (!this.blockMenuOpen || !this.writable() || this.blockColorMenuOpen) return
      this.blockAlignMenuOpen = false
      this.blockColorMenuOpen = true
      this.blockAlignMenuStyle = {}
      this.blockColorMenuStyle = {}
      this.$nextTick(() => this.positionBlockColorMenu())
    },
    positionBlockAlignMenu() {
      if (!this.blockAlignMenuOpen) return
      const root = this.$refs.root
      const trigger = root?.querySelector('.lark-doc-block-submenu-trigger')
      const submenu = root?.querySelector('.lark-doc-block-submenu')
      if (!trigger || !submenu) return
      this.blockAlignMenuStyle = placeBlockSubmenu(submenu, trigger)
    },
    positionBlockColorMenu() {
      if (!this.blockColorMenuOpen) return
      const root = this.$refs.root
      const trigger = [...(root?.querySelectorAll('.lark-doc-block-submenu-trigger') || [])].find((element) => element.getAttribute('aria-label') === '颜色')
      const submenu = root?.querySelector('.lark-doc-block-color-submenu')
      if (!trigger || !submenu) return
      this.blockColorMenuStyle = placeBlockSubmenu(submenu, trigger)
    },
    blockAlignAction(id) {
      if (!this.writable() || !this.featureEnabled('blockStyle')) return
      const range = this.handleActionRange()
      if (!range) return
      this.closeBlockMenu()
      if (id === 'increaseIndent' || id === 'decreaseIndent') {
        const target = this.blockIndentTarget(range)
        if (!target) return
        const current = Number(target.node.attrs.indent) || 0
        // 增加受前一个块限制；减少只受 0 下限（可以一路减回文档开头）。
        const indent = stepBlockIndent(this.editor.state.doc, target.pos, current, id === 'increaseIndent' ? 1 : -1, this.maxBlockIndent)
        this.applyBlockAttribute(target, 'indent', indent)
        return
      }
      const target = this.blockTextblockTarget(range)
      if (!target) return
      this.applyBlockAttribute(target, 'textAlign', id)
    },
    blockColorAction(value) {
      if (!this.writable() || !this.featureEnabled('blockStyle')) return
      const range = this.handleActionRange()
      const target = this.blockTextblockTarget(range)
      if (!target) return
      const from = target.pos + 1
      const to = Math.max(from, target.pos + target.node.nodeSize - 1)
      this.closeBlockMenu()
      this.editor.commands.setTextSelection({ from, to })
      if (value) this.editor.chain().focus().setColor(value).run()
      else this.editor.chain().focus().unsetColor().run()
      this.editor.view.focus()
    },
    blockTypeTextRange(range) {
      const doc = this.editor?.state.doc, node = nodeAtSafe(doc, range?.from)
      if (!node || !['paragraph', 'heading', 'listItem', 'taskItem', 'bulletList', 'orderedList', 'taskList', 'blockquote', 'codeBlock', 'callout'].includes(node.type.name)) return null
      if (!Number.isInteger(range.to) || range.to > doc.content.size) return null
      // Seek the two text edges instead of scanning a potentially large container.
      const selection = TextSelection.between(doc.resolve(range.from), doc.resolve(range.to))
      return selection.from >= range.from && selection.to <= range.to ? { from: selection.from, to: selection.to } : null
    },
    blockTypeAction(id) {
      const feature = id === 'codeBlock' ? 'codeBlocks' : id === 'callout' ? 'callouts' : /^heading/.test(id) ? 'headings' : 'blockStyle'
      if (!this.writable() || !this.featureEnabled('blockStyle') || !this.featureEnabled(feature) || !isBlockActionEnabled(this.larkDocConfig, id)) return false
      if (!this.blockTypeActions.some(item => item.id === id) && !/^heading[1-9]$/.test(id)) return false
      const range = this.handleActionRange()
      const node = nodeAtSafe(this.editor?.state?.doc, range?.from)
      let text = this.blockTypeTextRange(range)
      if (!text) return false
      const numberToggle = id === 'orderedList' && node.type.name === 'heading'
      const unsetHeading = node.type.name === 'heading' && id === `heading${node.attrs.level}`
      if (unsetHeading) {
        id = node.attrs.numbering ? 'orderedList' : 'paragraph'
        if (!isBlockActionEnabled(this.larkDocConfig, id)) return false
      }
      const heading = /^heading[1-9]$/.test(id)
      const listItem = ['listItem', 'taskItem'].includes(node.type.name)
      let headingAttrs = null
      if (heading && listItem && node.firstChild?.type.name === 'paragraph') {
        // Change the selected item's text, preserving its descendants as blocks.
        text = { from: range.from + 2, to: range.from + node.firstChild.nodeSize }
        const $pos = this.editor.state.doc.resolve(range.from)
        let depth = 0
        for (let n = 0; n <= $pos.depth; n++) if (['orderedList', 'bulletList', 'taskList'].includes($pos.node(n).type.name)) depth++
        const ordered = $pos.parent.type.name === 'orderedList'
        const start = node.attrs.numberStart || ($pos.index() === 0 && $pos.parent.attrs.start > 1 ? $pos.parent.attrs.start : null)
        headingAttrs = { numbering: ordered, numberingStart: ordered ? start : null, indent: clampBlockIndent((node.firstChild.attrs.indent || 0) + Math.max(0, depth - 1)) }
      }
      this.closeBlockMenu()
      this.savedSelection = null
      if (numberToggle) return this.editor.commands.toggleLarkDocHeadingNumber(range.from)
      if (!unsetHeading && this.blockTypeActive(id)) return true
      // Each chain step gets the updated selection/doc. Keep lifting and type
      // conversion in one transaction, and abort it entirely if either fails.
      const chain = this.editor.chain().command(({ tr }) => { closeHistory(tr); return true }).setTextSelection(text)
      const item = ['taskItem', 'taskList'].includes(node.type.name) ? 'taskItem' : ['listItem', 'bulletList', 'orderedList'].includes(node.type.name) ? 'listItem' : null
      if (item || ['blockquote', 'callout'].includes(node.type.name)) chain.command(({ commands, tr }) => {
        let lifted
        if (heading && item) {
          // schema-list expects a fresh mapping for each lift. Reusing the
          // chain transaction makes its second lift read stale boundaries.
          let state = EditorState.create({ doc: tr.doc, selection: tr.selection })
          lifted = true
          for (let n = state.selection.$from.depth; n > 0; n--) {
            const $from = state.selection.$from
            let ancestor = null
            for (let d = $from.depth; d > 0; d--) if (['listItem', 'taskItem'].includes($from.node(d).type.name)) { ancestor = $from.node(d).type; break }
            if (!ancestor) break
            lifted = liftListItem(ancestor)(state, next => {
              next.steps.forEach(step => tr.step(step))
              state = state.apply(next)
              tr.setSelection(TextSelection.create(tr.doc, state.selection.anchor, state.selection.head))
            })
            if (!lifted) break
          }
        } else lifted = item ? commands.liftListItem(item) : commands.lift(node.type.name)
        if (!lifted) tr.setMeta('preventDispatch', true)
        return lifted
      })
      if ((node.type.name === 'codeBlock' || unsetHeading) && ['bulletList', 'orderedList', 'taskList'].includes(id)) chain.command(({ commands, tr }) => {
        const ok = commands.setParagraph()
        if (!ok) tr.setMeta('preventDispatch', true)
        return ok
      })
      chain.command(({ commands, tr }) => {
        if (tr.getMeta('preventDispatch')) return false
        let ok
        if (id === 'paragraph') ok = commands.setParagraph()
        else if (heading) ok = commands.setHeading({ level: Number(id.slice(-1)), ...headingAttrs })
        else if (id === 'bulletList') ok = commands.toggleBulletList()
        else if (id === 'orderedList') ok = unsetHeading
          ? commands.wrapInList('orderedList', { start: 1, type: ['1', 'a', 'i'][(node.attrs.indent || 0) % 3] })
          : commands.toggleOrderedList()
        else if (id === 'taskList') ok = commands.toggleTaskList()
        else if (id === 'codeBlock') ok = commands.setCodeBlock()
        else if (!wrapContainerAllowed({ doc: tr.doc }, tr.selection.from, tr.selection.to, 1)) { this.error = '容器嵌套最多 5 层'; ok = false }
        else ok = commands.wrapIn(id)
        if (!ok) { tr.setMeta('preventDispatch', true); return false }
        return true
      })
      // Keep the original text block identity through lifting and conversion;
      // replacing it with a removed wrapper's ID would orphan its comments.
      const changed = chain.run()
      if (!changed) return false
      this.editor.view.dispatch(closeHistory(this.editor.state.tr))
      this.handleRange = this.rangeAt(this.editor.state.selection.from)
      this.editor.view.focus()
      return changed
    },
    blockTypeActive(id) {
      if (!this.editor || !this.handleRange) return false
      const node = nodeAtSafe(this.editor?.state?.doc, this.handleRange?.from)
      if (!node) return false
      const type = ['taskItem', 'listItem'].includes(node.type.name) ? this.editor.state.doc.resolve(this.handleRange.from).parent.type.name : node.type.name
      if (id === 'paragraph') return node.type.name === 'paragraph'
      if (/^heading[1-9]$/.test(id)) return node.type.name === 'heading' && Number(node.attrs?.level) === Number(id.slice(-1))
      // heading 上的「有序列表」代表标题编号是否开启
      if (id === 'orderedList') return type === 'orderedList' || (node.type.name === 'heading' && node.attrs?.numbering === true)
      return type === id
    },
    // —— 表格句柄菜单（对齐飞书：标题行/标题列开关 + 均分列宽）——
    handleTableNode() {
      if (!this.editor || !this.handleRange) return null
      const node = nodeAtSafe(this.editor.state.doc, this.handleRange.from)
      return node?.type.name === 'table' ? node : null
    },
    // 与 tableToolsMixin.tableHeaderState 同一套判定，但按句柄目标节点算（不依赖当前选区）。
    handleTableHeaderState() {
      const table = this.handleTableNode()
      if (!table || !table.childCount) return { row: false, column: false }
      const row = table.child(0)
      const rowHeader = row.childCount > 0 && Array.from({ length: row.childCount }, (_, index) => row.child(index).type.name === 'tableHeader').every(Boolean)
      const columnHeader = Array.from({ length: table.childCount }, (_, index) => {
        const current = table.child(index)
        return current.childCount > 0 && current.child(0).type.name === 'tableHeader'
      }).every(Boolean)
      return { row: rowHeader, column: columnHeader }
    },
    tableHandleAction(id) {
      if (!this.writable() || !this.featureEnabled('tables')) return
      const range = this.handleRange
      if (!range) return
      // 表格命令都按当前选区定位：先把光标落进表格（isActive('table') 才成立）。
      const doc = this.editor.state.doc
      const table = nodeAtSafe(doc, range.from)
      if (table?.type.name !== 'table') return
      const firstTextPos = () => {
        let found = null
        doc.nodesBetween(range.from, Math.min(range.to, doc.content.size), (child, pos) => {
          if (found === null && child.isTextblock) { found = pos + 1; return false }
          return true
        })
        return found
      }
      if (id === 'distributeColumns') {
        // selectedRect 对跨格 TextSelection 仍只取首格，须选择全部行。
        this.closeBlockMenu()
        if (this.selectTableLine('row', 0, table.childCount - 1, { pos: range.from, node: table })) this.tableAction('distributeColumns')
        return
      }
      const first = firstTextPos()
      if (first !== null) this.editor.commands.setTextSelection(Math.min(first, doc.content.size))
      if (id === 'toggleHeaderRow' || id === 'toggleHeaderColumn') {
        // 开关保持菜单展开（飞书同款：点了能直接看到开关翻转）。
        this.tableAction(id)
        // 表格重渲染会派生一次假的 handle mouseleave：短窗口内忽略它。
        this._keepMenuThroughRender = true
        clearTimeout(this._keepMenuTimer)
        this._keepMenuTimer = setTimeout(() => { this._keepMenuThroughRender = false }, 350)
        return
      }
      this.closeBlockMenu()
      this.tableAction(id)
    },
    blockAction(id, overrideRange = null) {
      if (!this.writable() || !isBlockActionEnabled(this.larkDocConfig, id)) return
      this.closeBlockMenu()
      const selectedRange = overrideRange || this.handleActionRange()
      const sectionRange = ['copy', 'cut', 'duplicate', 'moveUp', 'moveDown', 'saveTemplate'].includes(id) ? this.headingActionRange(selectedRange) : null
      const range = id === 'delete'
        ? (this.columnsRangeFor(selectedRange) || this.detailsRangeFor(selectedRange) || selectedRange)
        : sectionRange || selectedRange
      if (!range) return
      if (id === 'comment') return this.commentEntryAvailable && this.beginCommentComposer(range.from)
      if (id === 'share') return this.openSelectionShareDialog(range.from)
      if (id === 'saveTemplate') return this.openBlockTemplateSave(range)
      if (id === 'copyLink') return this.copyBlockLink(range)
      if (id === 'copy' || id === 'cut') { this.copyBlock(range, id === 'cut'); return }
      if (id === 'translate') return this.requestBlockAI('translate', range)
      if (id === 'delete') { this.deleteBlockRange(range); return }
      const { from, to } = range
      this.editor.view.dispatch(closeHistory(this.editor.state.tr))
      const tr = this.editor.state.tr
      if (id === 'duplicate') { const slice = this.editor.state.doc.slice(from, to); tr.insert(to, (this.editor.storage.larkDoc?.pagedView?.copySlice(slice) || slice).content); this.editor.view.dispatch(tr) }
      else if (id === 'addBelow') {
        const paragraph = this.editor.schema.nodes.paragraph?.createAndFill()
        if (paragraph) {
          tr.insert(to, paragraph)
          // Fitting a paragraph between list items can split the list. Resolve
          // the inserted text position in the new document, not the old range.
          tr.setSelection(TextSelection.near(tr.doc.resolve(tr.mapping.map(to, -1)), 1))
          this.editor.view.dispatch(tr)
        }
      }
      else if (id === 'moveUp' || id === 'moveDown') {
        const paged = this.editor.storage.larkDoc?.pagedView
        const resolved = this.editor.state.doc.resolve(from)
        if (paged?.isDocument(this.editor.state.doc) && ['doc', 'documentSegment'].includes(resolved.parent.type.name)) {
          const target = paged.moveTarget(from, to, id)
          if (target !== null && moveBlockRange(this.editor, from, to, target)) this.editor.view.focus()
          return
        }
        const index = resolved.index()
        const endIndex = this.editor.state.doc.resolve(to).index()
        const targetIndex = id === 'moveUp' ? index - 1 : endIndex + 1
        if (targetIndex >= 0 && targetIndex <= resolved.parent.childCount) moveBlockRange(this.editor, from, to, resolved.posAtIndex(targetIndex, resolved.depth))
      }
      if (this.editor.state.doc !== tr.before) this.editor.view.focus()
    },
    requestBlockAI(kind, range = this.handleActionRange()) {
      if (!this.writable() || !this.featureEnabled('ai') || !range) return false
      this.closeBlockMenu()
      this.savedSelection = null
      const text = this.blockTypeTextRange(range)
      if (text) this.editor.commands.setTextSelection(text)
      else this.editor.commands.setNodeSelection(range.from)
      this.$emit('ai-request', kind)
      return true
    },
    closeBlockInsertMenu() {
      if (this._blockInsertContext) this.closeCommandMenu()
    },
    blockInsertionCurrent(append) { return !!this._blockInsertCurrent?.call(this, append) },
    openBlockInsertMenu(event) { return this._blockInsertRuntime?.call(this, event) ?? false },
    async copyBlockLink(range) {
      if (!this.shareCan('canView')) return false
      const editor = this.editor, session = this.session, doc = editor?.state.doc
      const node = nodeAtSafe(doc, range?.from), documentLink = this.shareDocumentLink()
      if (!node?.isBlock || !BLOCK_ID_PATTERN.test(node.attrs.blockId || '')) return false
      const current = () => this.editor === editor && !editor.isDestroyed && this.session === session
        && editor.state.doc === doc && this.shareCan('canView') && this.shareDocumentLink() === documentLink
      try {
        const url = new URL(documentLink, window.location.href)
        if (!/^https?:$/.test(url.protocol) || !safeUrl(url.href)) return false
        url.hash = `share-${node.attrs.blockId}`
        if (!await this.copyShareText(url.href)) throw new Error('复制失败，请检查剪贴板权限')
        if (!current()) return false
        this.showShareToast('success', '复制成功')
        return true
      } catch (error) { if (current()) this.error = error?.message || '复制失败，请检查剪贴板权限'; return false }
    },
    async copyBlock(range, cut = false) {
      const editor = this.editor, session = this.session, doc = editor?.state.doc, documentId = session?.documentId
      const allowed = () => this.writable() && isBlockActionEnabled(this.larkDocConfig, cut ? 'cut' : 'copy')
      if (!editor || editor.isDestroyed || !allowed() || !range) return false
      const current = () => this.editor === editor && !editor.isDestroyed && this.session === session
        && session?.documentId === documentId && editor.state.doc === doc && allowed()
      const slice = doc.slice(range.from, range.to)
      const fragment = (editor.storage.larkDoc?.pagedView?.copySlice(slice) || slice).content
      const text = fragment.textBetween(0, fragment.size, '\n')
      const content = fragment.toJSON()
      const structured = JSON.stringify({ schemaVersion: 1, type: 'lark-doc-block', content })
      let copied = false
      try {
        if (navigator.clipboard?.write && window.ClipboardItem) {
          const item = new window.ClipboardItem({
            'text/plain': new Blob([text], { type: 'text/plain' }),
            'application/x-lark-doc-block+json': new Blob([structured], { type: 'application/json' }),
          })
          await navigator.clipboard.write([item])
          copied = true
        }
      } catch (_) { copied = false }
      if (!current()) return false
      if (!copied) {
        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text)
            copied = true
          } else {
            const textarea = document.createElement('textarea')
            textarea.value = text
            textarea.setAttribute('readonly', 'true')
            textarea.style.position = 'fixed'
            textarea.style.opacity = '0'
            document.body.appendChild(textarea)
            textarea.select()
            copied = document.execCommand('copy')
            textarea.remove()
          }
        } catch (_) { copied = false }
      }
      if (!current()) return false
      if (!copied) { this.error = '无法访问剪贴板，区块未被修改；可手动选择后复制'; return false }
      if (cut) this.deleteBlockRange(range)
      this.error = cut ? '已剪切区块' : '已复制区块'
      editor.view.focus()
      return true
    },
  },
}
